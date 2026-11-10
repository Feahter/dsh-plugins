/**
 * Host surface for the `agents` half of the dsh-360 bundle.
 *
 * Discovers the live DSH agent surface — resident instruction files
 * (AGENTS.md / CLAUDE.md / instructions.md), subagent definitions
 * (`**​/agents/*.md`, `**​/.claude/agents/*.md`), and per-profile agent presets
 * (synthesized from `<DSH_HOME>/profiles/&lt;name&gt;/cordis.patch.yml`) — scores every
 * subject with the core rubric (`./agents/analyze.js`), caches the portfolio for
 * a minute, exposes it to the Web panel over `/api/dsh-360/agents/*`, and offers
 * the shared `dsh360_*` tool services (scan summary, report, optimize, evolve)
 * that `index.js` composes. Writes always go through `./agents/fixes.js` so every
 * change is backed up and reversible; the host additionally re-validates every
 * planned path before touching the disk.
 *
 * The credential boundary is the same as every first-party route: this server
 * is same-origin only, so a request is admitted by `connection.requestRejection`
 * and fails closed (503) when the connection service is absent.
 */

import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { discoverSubjects, subjectId } from './agents/collect.js';
import { analyzeSubject, buildPortfolio, matchUsage } from './agents/analyze.js';
import { applyPlan, listBackups, planFixes, pruneBackups, undoBackup } from './agents/fixes.js';
import { LESSONS_REL } from './agents/evolution.js';
import { renderMarkdown } from './agents/report.js';
import { collectUsage } from './usage.js';

const ROUTE_PREFIX = '/api/dsh-360/agents';
const MAX_BODY_BYTES = 256 * 1024;
const CACHE_TTL_MS = 60_000;
const MAX_LISTED_FILES = 200;
const MAX_LIST_DEPTH = 4;
const MAX_SUBJECT_BYTES = 512 * 1024;
const MAX_ACTION_IDS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const SUBJECT_KINDS = new Set(['instruction', 'agent', 'preset']);
const SEVERITY_RANK = { critical: 0, major: 1, minor: 2, info: 3 };
const SUBJECT_ID = /^(instr|agent|preset):[^\s/]{1,128}$/;
const BACKUP_ID = /^[A-Za-z0-9._-]{1,128}$/;
const REPORT_FILE = /^[A-Za-z0-9._-]+\.md$/;

class HarnessError extends Error {
  constructor(message, { code = 'internal', status = 500 } = {}) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.status = status;
  }
}

/** Core `FixError`s carry codes but no HTTP status; translate them for routes. */
const FIX_STATUS = {
  'no-actions': 409,
  'unsafe-path': 400,
  'not-found': 404,
  'invalid-argument': 400,
  'invalid-frontmatter': 400,
  'internal': 500,
};

function toHarnessError(error, context) {
  if (error instanceof HarnessError) return error;
  const code = error && typeof error.code === 'string' && FIX_STATUS[error.code] ? error.code : 'internal';
  const message = (error && error.message) || String(error);
  return new HarnessError(`${context}: ${message}`, { code, status: FIX_STATUS[code] || 500 });
}

// ------------------------------------------------------------------- config

function positiveInteger(value, fallback, max) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = Math.floor(value);
    if (parsed >= 1 && parsed <= max) return parsed;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (parsed >= 1 && parsed <= max) return parsed;
  }
  return fallback;
}

function expandHome(pathname) {
  if (pathname === '~') return homedir();
  if (pathname.startsWith('~/')) return join(homedir(), pathname.slice(2));
  return pathname;
}

// -------------------------------------------------------------- path guards

function isInsideRoot(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/**
 * Resolve a plan-relative write path and prove it stays under the subject
 * directory and inside the only writable surfaces the contract allows: the
 * subject's own file, `agent-notes/**`, and `.agents-360/lessons.md`.
 * Rejects absolute paths, `..` segments, NUL bytes, empty segments, and
 * anything else.
 */
function assertSafeRelPath(dir, relPath, subjectRel = null) {
  const root = resolve(dir);
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new HarnessError('A planned write has no path.', { code: 'unsafe-path', status: 400 });
  }
  if (relPath.includes('\u0000')) {
    throw new HarnessError('A planned write path contains a NUL byte.', { code: 'unsafe-path', status: 400 });
  }
  if (isAbsolute(relPath)) {
    throw new HarnessError(`Refusing absolute write path: ${relPath}`, { code: 'unsafe-path', status: 400 });
  }
  if (relPath.split(sep).includes('')) {
    throw new HarnessError(`Refusing write path with an empty segment: ${relPath}`, { code: 'unsafe-path', status: 400 });
  }
  const normalized = normalize(relPath);
  if (normalized === '..' || normalized.startsWith('..' + sep) || normalized.split(sep).includes('..')) {
    throw new HarnessError(`Refusing path traversal: ${relPath}`, { code: 'unsafe-path', status: 400 });
  }
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new HarnessError(`Refusing path outside the subject directory: ${relPath}`, { code: 'unsafe-path', status: 400 });
  }
  const relPosix = rel.split(sep).join('/');
  const subjectPosix = subjectRel ? subjectRel.split(sep).join('/') : null;
  const isOwnFile = subjectPosix !== null && relPosix === subjectPosix;
  const isNotes = relPosix.startsWith('agent-notes/');
  const isLessons = relPosix === LESSONS_REL;
  if (!isOwnFile && !isNotes && !isLessons) {
    throw new HarnessError(
      `Refusing to write "${relPosix}": only the subject file, agent-notes/**, and ${LESSONS_REL} are writable.`,
      { code: 'unsafe-path', status: 400 },
    );
  }
  return target;
}

/**
 * Re-check the real path of a write target (or its nearest existing ancestor)
 * so a symlinked `agent-notes/` cannot smuggle a write out of the subject dir.
 */
async function ensureInsideReal(dir, target) {
  let root;
  try {
    root = await realpath(dir);
  } catch {
    throw new HarnessError(`Subject directory is not resolvable: ${dir}`, { code: 'unsafe-path', status: 400 });
  }
  let cursor = target;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await realpath(cursor);
      if (!isInsideRoot(root, real)) {
        throw new HarnessError(`Refusing write that resolves outside the subject directory: ${target}`, {
          code: 'unsafe-path',
          status: 400,
        });
      }
      return;
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      if (!error || error.code !== 'ENOENT') {
        throw new HarnessError(`Cannot resolve write target: ${target}`, { code: 'unsafe-path', status: 400 });
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new HarnessError(`Cannot resolve write target: ${target}`, { code: 'unsafe-path', status: 400 });
      }
      cursor = parent;
    }
  }
  throw new HarnessError(`Cannot resolve write target: ${target}`, { code: 'unsafe-path', status: 400 });
}

function assertSafeReportFile(dir, filename) {
  if (typeof filename !== 'string' || !REPORT_FILE.test(filename) || filename.includes('..')) {
    throw new HarnessError('Unsafe report filename.', { code: 'unsafe-path', status: 400 });
  }
  const root = resolve(dir);
  const target = resolve(root, filename);
  if (!isInsideRoot(root, target) || relative(root, target) !== filename) {
    throw new HarnessError('Report path escapes the reports directory.', { code: 'unsafe-path', status: 400 });
  }
  return target;
}

// ------------------------------------------------------------------ helpers

function toPosix(pathname) {
  return pathname.split(sep).join('/');
}

function severityOf(finding) {
  if (!finding) return 9;
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, finding.severity)
    ? SEVERITY_RANK[finding.severity]
    : 9;
}

function topFindingOf(report) {
  const list = Array.isArray(report && report.findings) ? report.findings.filter((item) => item && item.title) : [];
  if (list.length === 0) return null;
  const sorted = list.slice().sort((a, b) => severityOf(a) - severityOf(b));
  const first = sorted[0];
  return { id: first.id ?? null, severity: first.severity ?? 'info', title: first.title };
}

function suggestionsOf(report) {
  return Array.isArray(report && report.suggestions) ? report.suggestions.filter((item) => item && item.id) : [];
}

function eligibleActionIds(report, safeOnly) {
  return suggestionsOf(report)
    .filter((item) => item.kind === 'auto' || (!safeOnly && item.kind === 'draft'))
    .map((item) => item.id);
}

function stampFor(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/**
 * Read a subject directory breadth-first to a fixed depth, without following
 * symlinks. Only the writable surfaces (`agent-notes/**` and the lessons
 * ledger) are returned, since those are what the analyzer and fix planner need
 * to resolve links and plan `fix.link-notes` / `fix.embed-lessons`.
 */
async function listSubjectFiles(dir) {
  const found = [];
  if (!dir) return found;

  async function walk(current, depth) {
    if (found.length >= MAX_LISTED_FILES) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (found.length >= MAX_LISTED_FILES) return;
      if (entry.name === 'node_modules') continue;
      if (entry.name.startsWith('.') && entry.name !== '.agents-360') continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_LIST_DEPTH) await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const rel = toPosix(relative(dir, absolute));
      if (!rel.startsWith('agent-notes/') && rel !== LESSONS_REL) continue;
      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      found.push({ path: rel, chars: info.size });
    }
  }

  await walk(dir, 1);
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return found.slice(0, MAX_LISTED_FILES);
}

async function readRaw(pathname) {
  if (!pathname) return null;
  try {
    return await readFile(pathname, 'utf8');
  } catch {
    return null;
  }
}

/** Read a subject file with a size cap; oversized files degrade to partial coverage. */
async function readRawCapped(pathname) {
  if (!pathname) return null;
  try {
    const info = await stat(pathname);
    if (info.size > MAX_SUBJECT_BYTES) return null;
    return await readFile(pathname, 'utf8');
  } catch {
    return null;
  }
}

/** Read the subject's `.agents-360/lessons.md` ledger verbatim; null when absent. */
async function readLessonsRaw(dir) {
  if (!dir) return null;
  return readRaw(join(dir, LESSONS_REL));
}

async function mtimeOf(pathname) {
  if (!pathname) return null;
  try {
    return (await stat(pathname)).mtimeMs;
  } catch {
    return null;
  }
}

// ------------------------------------------------------- profile presets

/**
 * Parse the YAML subset of a profile `cordis.patch.yml` needed to synthesize a
 * preset subject. No external deps: a line scanner extracts the three relevant
 * entries (`agent-default-model`, `agent-preset-registry`, `permission-presets`)
 * and their scalar/nested-map config values.
 */
function extractPatchEntries(raw) {
  const entries = [];
  const lines = String(raw ?? '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (/^- /.test(line)) {
      if (current) entries.push(current);
      current = { header: line, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) entries.push(current);
  return entries.map((entry) => {
    const idMatch = /^- id:\s*["']?([^"']+?)["']?\s*$/.exec(entry.header);
    const nameMatch = /^-\s*(?:name|insert):\s*["']?([^"']+?)["']?\s*$/.exec(entry.header);
    return {
      id: idMatch ? idMatch[1].trim() : null,
      name: nameMatch ? nameMatch[1].trim() : null,
      header: entry.header,
      body: entry.body.join('\n'),
    };
  });
}

function scalarInBlock(body, key) {
  const match = new RegExp(`^\\s*${key}:\\s*["']?([^"'\n]+)`, 'm').exec(body || '');
  if (!match) return null;
  return match[1].replace(/!!js\s+/, '').trim();
}

function nestedKeys(body, key) {
  const lines = String(body ?? '').split('\n');
  let baseIndent = null;
  const keys = [];
  for (const line of lines) {
    const match = /^(\s*)([A-Za-z0-9._-]+):(.*)$/.exec(line);
    if (!match) continue;
    const indent = match[1].length;
    const name = match[2];
    const rest = match[3].trim();
    if (baseIndent === null) {
      if (name === key) baseIndent = indent;
      continue;
    }
    if (indent <= baseIndent) break;
    if (rest === '') keys.push(name);
  }
  return keys;
}

function parseProfilePatch(raw) {
  const entries = extractPatchEntries(raw);
  const findById = (id) => entries.find((entry) => entry.id === id) || null;
  const findByName = (substring) => entries.find((entry) => entry.name && entry.name.includes(substring)) || null;
  const modelEntry = findById('agent-default-model');
  const registryEntry = findById('agent-preset-registry');
  const permissionEntry = findById('permission') || findByName('permission-presets');
  return {
    model: modelEntry
      ? { provider: scalarInBlock(modelEntry.body, 'provider'), model: scalarInBlock(modelEntry.body, 'model') }
      : null,
    registry: registryEntry
      ? {
          default: scalarInBlock(registryEntry.body, 'default'),
          selectedDefault: scalarInBlock(registryEntry.body, 'selectedDefault'),
        }
      : null,
    permissions: permissionEntry ? nestedKeys(permissionEntry.body, 'presets') : [],
  };
}

function extractPresetDefinitions(raw, filePath) {
  const text = String(raw ?? '');
  const out = [];
  const marker = /name:\s*['"]@deepseek-ai\/dsh-agent-preset['"]/g;
  let hit;
  while ((hit = marker.exec(text)) !== null) {
    const windowText = text.slice(hit.index, hit.index + 6000);
    const configAt = windowText.indexOf('config:');
    const block = configAt >= 0 ? windowText.slice(configAt) : windowText;
    const id = /^\s*id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/m.exec(block);
    if (!id) continue;
    const name = /^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(block.slice(block.indexOf('id:') + 3));
    const description = /^\s*description:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(block);
    const order = /^\s*order:\s*(-?\d+)/m.exec(block);
    const plugins = [...block.matchAll(/name:\s*['"]@deepseek-ai\/[\w.-]+['"]/g)].length;
    out.push({
      id: id[1],
      name: name ? name[1].trim() : id[1],
      description: description ? description[1].trim() : '',
      order: order ? Number(order[1]) : 0,
      plugins,
      path: filePath,
    });
  }
  return out;
}

/** Patch layers owned by workspace plugins (one level under cwd), so router-mode's
 *  `preset-router` row is discoverable without hard-coding its path. */
async function collectPluginPresetDefinitions(cwd) {
  const defs = [];
  const seen = new Set();
  const rootsToScan = [cwd, process.cwd()].filter(Boolean);
  for (const root of rootsToScan) {
    if (seen.has(root)) continue;
    seen.add(root);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const candidate = join(root, entry.name, 'cordis.patch.yml');
      const raw = await readRawCapped(candidate);
      if (raw === null) continue;
      defs.push(...extractPresetDefinitions(raw, candidate));
    }
  }
  return defs;
}

function synthesizePresetBody(name, preset) {
  const lines = [`# Agent 预设: ${name}`, ''];
  if (preset && preset.profile) lines.push(`所属 profile：\`${preset.profile}\``, '');
  if (preset && preset.def) {
    lines.push('## 预设定义', '');
    lines.push(`- name: ${preset.def.name || name}`);
    lines.push(`- order: ${preset.def.order ?? 0}`);
    lines.push(`- plugins: ${preset.def.plugins ?? 0} 行`);
    if (preset.def.description) lines.push(`- description: ${preset.def.description}`);
    lines.push('');
  }
  lines.push('合成自 profile 配置与插件 patch 的 agent 预设体检说明（kind=preset，只读，不参与写盘）。');
  lines.push('');
  lines.push('## 模型 (agent-default-model)');
  lines.push('');
  if (preset && preset.model) {
    lines.push(`- provider: ${preset.model.provider ?? '未配置'}`);
    lines.push(`- model: ${preset.model.model ?? '未配置'}`);
  } else {
    lines.push('- 未配置默认模型');
  }
  lines.push('');
  lines.push('## 预设注册表 (agent-preset-registry)');
  lines.push('');
  if (preset && preset.registry) {
    lines.push(`- default: ${preset.registry.default ?? '未配置'}`);
    lines.push(`- selectedDefault: ${preset.registry.selectedDefault ?? '未配置'}`);
  } else {
    lines.push('- 未配置预设注册表');
  }
  lines.push('');
  lines.push('## 权限预设 (permission-presets)');
  lines.push('');
  if (preset && Array.isArray(preset.permissions) && preset.permissions.length > 0) {
    for (const permission of preset.permissions) lines.push(`- ${permission}`);
  } else {
    lines.push('- 未配置权限预设');
  }
  lines.push('');
  return lines.join('\n');
}

// --------------------------------------------------------------------- host

function createAgentsHost(ctx, config, paths) {
  const statePath = paths.statePath;
  const backupRoot = paths.backupDir;
  const reportDir = paths.reportDir;
  const sessionsDir = join(paths.home, 'sessions');
  const profilesDir = join(paths.home, 'profiles');

  /** key = cwd|windowDays -> { at, promise } */
  const cache = new Map();
  let queue = Promise.resolve();

  function logInfo(message) {
    try {
      ctx.logger?.info?.(message);
    } catch {
      // Logging must never break a request.
    }
  }

  function logWarn(message) {
    try {
      ctx.logger?.warn?.(message);
    } catch {
      // Logging must never break a request.
    }
  }

  function invalidate() {
    cache.clear();
  }

  /** Serialise every write path: plan -> apply -> re-analyze is one critical section. */
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function resolveRoots(cwdOverride) {
    const configured = Array.isArray(config.roots) ? config.roots : [];
    const base = configured.length > 0
      ? configured.slice()
      : [process.cwd(), join(homedir(), '.agents'), join(homedir(), '.deepseek')];
    if (cwdOverride) {
      const resolved = resolve(expandHome(cwdOverride));
      if (!base.includes(resolved)) base.unshift(resolved);
    }
    return base;
  }

  function coerceState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const byId = value.byId && typeof value.byId === 'object' && !Array.isArray(value.byId) ? value.byId : {};
    return {
      generatedAt: Number.isFinite(value.generatedAt) ? value.generatedAt : null,
      avgScore: Number.isFinite(value.avgScore) ? value.avgScore : null,
      totals: value.totals && typeof value.totals === 'object' ? value.totals : null,
      byId,
      rubricVersion: typeof value.rubricVersion === 'string' ? value.rubricVersion : null,
    };
  }

  async function readState() {
    try {
      const whole = JSON.parse(await readFile(statePath, 'utf8'));
      const slice = whole && typeof whole === 'object' && !Array.isArray(whole) && whole.agents
        ? whole.agents
        : whole;
      return coerceState(slice);
    } catch {
      return null;
    }
  }

  async function saveState(portfolio, reports) {
    const byId = {};
    for (const report of reports) {
      if (report && typeof report.id === 'string') byId[report.id] = report.score?.total ?? null;
    }
    const snapshot = {
      generatedAt: portfolio?.generatedAt ?? Date.now(),
      avgScore: portfolio?.totals?.avgScore ?? null,
      totals: portfolio?.totals ?? null,
      byId,
      rubricVersion: typeof portfolio?.rubricVersion === 'string' ? portfolio.rubricVersion : null,
    };
    try {
      let whole = {};
      try {
        const parsed = JSON.parse(await readFile(statePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) whole = parsed;
      } catch {
        // fresh or corrupt state: start a new object, preserving nothing.
      }
      const existing = coerceState(whole.agents);
      if (existing && Number(existing.generatedAt) > snapshot.generatedAt) return;
      whole.agents = snapshot;
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(whole, null, 2) + '\n', 'utf8');
    } catch (error) {
      logWarn(`agents-360: cannot persist scan state: ${(error && error.message) || String(error)}`);
    }
  }

  async function safeCollectUsage(windowDays, now) {
    try {
      const result = await collectUsage({ sessionsDir, windowDays, now });
      if (!result || typeof result !== 'object') {
        return {
          sessionsScanned: 0, spanDays: 0, available: false,
          sessions: [], signalsByPath: {}, byPreset: {},
        };
      }
      return {
        sessionsScanned: Number.isFinite(result.sessionsScanned) ? result.sessionsScanned : 0,
        spanDays: Number.isFinite(result.spanDays) ? result.spanDays : 0,
        available: result.available !== false,
        sessions: Array.isArray(result.sessions) ? result.sessions : [],
        signalsByPath: result.signalsByPath && typeof result.signalsByPath === 'object' ? result.signalsByPath : {},
        byPreset: result.byPreset && typeof result.byPreset === 'object' ? result.byPreset : {},
      };
    } catch (error) {
      logWarn(`agents-360: usage collection failed: ${(error && error.message) || String(error)}`);
      return {
        sessionsScanned: 0, spanDays: 0, available: false,
        sessions: [], signalsByPath: {}, byPreset: {},
      };
    }
  }

  async function discoverPresets(now) {
    let entries;
    try {
      entries = await readdir(profilesDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const pluginDefs = await collectPluginPresetDefinitions(config.cwd || process.cwd());
    const presets = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const patchPath = join(profilesDir, entry.name, 'cordis.patch.yml');
      const raw = await readRawCapped(patchPath);
      if (raw === null) continue;
      let parsed;
      try {
        parsed = parseProfilePatch(raw);
      } catch (error) {
        logWarn(`agents-360: cannot parse profile patch ${patchPath}: ${(error && error.message) || String(error)}`);
        continue;
      }
      if (!parsed.model && !parsed.registry && parsed.permissions.length === 0) continue;

      // One subject per *preset id* (router / standard / …), because sessions
      // record `agent-preset/selected: <preset id>` — a profile-named subject
      // could never match real usage.
      const defs = new Map();
      for (const def of [...pluginDefs, ...extractPresetDefinitions(raw, patchPath)]) {
        if (!defs.has(def.id)) defs.set(def.id, def);
      }
      const registryIds = [parsed.registry?.selectedDefault, parsed.registry?.default]
        .filter((value) => typeof value === 'string' && value.length > 0);
      for (const id of registryIds) {
        if (!defs.has(id)) defs.set(id, { id, name: id, description: '', order: 0, plugins: 0, path: patchPath });
      }
      const mtime = await mtimeOf(patchPath);
      const base = {
        kind: 'preset',
        dir: join(profilesDir, entry.name),
        owner: null,
        source: 'profile-config',
        scope: 'profile',
        config: {
          model: parsed.model && typeof parsed.model.model === 'string' ? parsed.model.model : null,
          provider: parsed.model && typeof parsed.model.provider === 'string' ? parsed.model.provider : null,
          default: parsed.registry && typeof parsed.registry.default === 'string' ? parsed.registry.default : null,
          selectedDefault: parsed.registry && typeof parsed.registry.selectedDefault === 'string' ? parsed.registry.selectedDefault : null,
          permissions: parsed.permissions,
        },
      };
      if (defs.size === 0) {
        // Profile without any declared preset: keep one profile-level subject.
        const preset = {
          ...base,
          name: entry.name,
          description: '',
          path: patchPath,
          mtime,
          preset: { ...parsed, profile: entry.name },
        };
        preset.id = subjectId('preset', null, entry.name);
        presets.push(preset);
        continue;
      }
      for (const def of defs.values()) {
        const preset = {
          ...base,
          name: def.id,
          description: def.description || '',
          path: def.path || patchPath,
          mtime,
          preset: { ...parsed, profile: entry.name, def },
        };
        preset.id = subjectId('preset', null, `${entry.name}.${def.id}`);
        presets.push(preset);
      }
    }
    return presets;
  }

  async function loadSubject(subject) {
    if (subject.kind === 'preset') {
      const body = synthesizePresetBody(subject.name, subject.preset);
      return { raw: body, body };
    }
    const raw = await readRawCapped(subject.path);
    return { raw, body: null };
  }

  async function analyzeOne({ subject, siblings, digest, now, windowDays, previousState }) {
    const path = typeof subject.path === 'string' && subject.path !== '' ? subject.path : null;
    const dir = typeof subject.dir === 'string' && subject.dir !== '' ? subject.dir : (path ? dirname(path) : null);
    const { raw, body } = await loadSubject(subject);

    const id = subject.id ?? subjectId(subject.kind, path, subject.name);
    const fullSubject = {
      kind: subject.kind,
      name: subject.name,
      description: typeof subject.description === 'string' ? subject.description : '',
      path,
      dir,
      owner: subject.owner ?? null,
      mtime: subject.mtime ?? null,
      source: subject.source ?? 'filesystem',
      scope: subject.scope ?? null,
      config: subject.config ?? null,
      id,
    };

    let usage = null;
    let injection = null;
    let signals = null;
    try {
      const matched = matchUsage(fullSubject, digest, { now, windowDays });
      usage = matched && matched.usage ? matched.usage : null;
      injection = matched && matched.injection ? matched.injection : null;
      signals = matched && matched.signals ? matched.signals : null;
    } catch (error) {
      logWarn(`agents-360: matchUsage failed for ${id}: ${(error && error.message) || String(error)}`);
    }

    const files = dir ? await listSubjectFiles(dir) : [];
    const lessonsRaw = dir ? await readLessonsRaw(dir) : null;

    const report = analyzeSubject({
      subject: fullSubject,
      raw: raw === null ? undefined : raw,
      body: body === null ? undefined : body,
      files,
      usage,
      injection,
      signals,
      siblings,
      options: {
        now,
        windowDays,
        usageAvailable: digest.available,
        catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
      },
      evolution: { lessonsRaw },
    });

    if (report && typeof report === 'object') {
      if (!report.path && path) report.path = path;
      if (!report.dir && dir) report.dir = dir;
      if (!report.usage && usage) report.usage = usage;
      if (!report.injection && injection) report.injection = injection;
      if (report.score && report.score.delta == null && previousState && typeof report.id === 'string') {
        const prev = previousState.byId ? previousState.byId[report.id] : null;
        if (typeof prev === 'number' && typeof report.score.total === 'number') {
          report.score.delta = Math.round((report.score.total - prev) * 10) / 10;
        }
      }
    }
    return report;
  }

  async function scan({ cwd, windowDays }) {
    const now = Date.now();
    const previousState = await readState();
    const roots = resolveRoots(cwd);
    const digest = await safeCollectUsage(windowDays, now);

    let discovered = [];
    try {
      const result = await discoverSubjects({ roots, maxDepth: config.maxDepth, now });
      discovered = Array.isArray(result) ? result.filter((item) => item && item.name) : [];
    } catch (error) {
      logWarn(`agents-360: discoverSubjects failed: ${(error && error.message) || String(error)}`);
    }
    const presets = await discoverPresets(now);
    const subjects = [...discovered, ...presets];

    // Read every subject once so sibling views can carry body text for overlap.
    const loaded = [];
    for (const subject of subjects) {
      loaded.push({ subject, ...(await loadSubject(subject)) });
    }

    const siblingViews = loaded.map(({ subject, raw }) => ({
      id: subject.id ?? subjectId(subject.kind, subject.path ?? null, subject.name),
      kind: subject.kind,
      name: subject.name,
      description: typeof subject.description === 'string' ? subject.description : '',
      body: subject.kind === 'instruction' ? raw : null,
      path: subject.path ?? null,
      dir: subject.dir ?? null,
      scope: subject.scope ?? null,
    }));

    const reports = [];
    for (const entry of loaded) {
      const id = entry.subject.id ?? subjectId(entry.subject.kind, entry.subject.path ?? null, entry.subject.name);
      const report = await analyzeOne({
        subject: entry.subject,
        siblings: siblingViews.filter((item) => item.id !== id),
        digest,
        now,
        windowDays,
        previousState,
      });
      if (report && typeof report === 'object') reports.push(report);
    }

    const portfolio = buildPortfolio(reports, {
      generatedAt: now,
      windowDays,
      sessionsScanned: digest.sessionsScanned ?? 0,
      usageAvailable: digest.available,
      roots,
      previous: previousState
        ? {
            generatedAt: previousState.generatedAt,
            avgScore: previousState.avgScore,
            totals: previousState.totals,
            rubricVersion: previousState.rubricVersion ?? null,
          }
        : null,
      options: {
        now,
        windowDays,
        sessionsScanned: digest.sessionsScanned ?? 0,
        catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
      },
    });

    await saveState(portfolio, reports);
    logInfo(`agents-360: scanned ${reports.length} subjects in ${digest.sessionsScanned} sessions`);
    return portfolio;
  }

  function cacheKey(cwd, windowDays) {
    return `${cwd || ''}|${windowDays}|${config.maxDepth}`;
  }

  async function getPortfolio({ cwd = null, windowDays = config.windowDays, refresh = false } = {}) {
    const effectiveWindow = positiveInteger(windowDays, config.windowDays, 3650);
    const key = cacheKey(cwd, effectiveWindow);
    if (refresh) cache.delete(key);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.promise;

    const entry = { at: now, promise: null };
    entry.promise = scan({ cwd, windowDays: effectiveWindow }).catch((error) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    return entry.promise;
  }

  function filterPortfolio(portfolio, kind) {
    if (!kind || !portfolio || !Array.isArray(portfolio.subjects)) return portfolio;
    if (!SUBJECT_KINDS.has(kind)) {
      throw new HarnessError(`Query parameter "kind" must be one of instruction, agent, preset.`, {
        code: 'invalid-argument',
        status: 400,
      });
    }
    return { ...portfolio, subjects: portfolio.subjects.filter((item) => item && item.kind === kind) };
  }

  function findReport(portfolio, id) {
    const report = (portfolio.subjects || []).find((item) => item && item.id === id);
    if (!report) {
      throw new HarnessError(`No subject with id "${id}" in the current scan.`, {
        code: 'not-found',
        status: 404,
      });
    }
    return report;
  }

  async function listBackupsSafe() {
    try {
      const result = await listBackups(backupRoot);
      if (!Array.isArray(result)) return [];
      const sorted = result.slice().sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));
      return sorted.slice(0, config.backupsKeep).map((item) => ({
        ...item,
        subject: item.subject ?? item.skill ?? item.name ?? null,
      }));
    } catch (error) {
      logWarn(`agents-360: cannot list backups: ${(error && error.message) || String(error)}`);
      return [];
    }
  }

  async function getSubjectDetail(id) {
    const portfolio = await getPortfolio({});
    const report = findReport(portfolio, id);
    let raw = null;
    let body = null;
    if (report.kind === 'preset') {
      raw = await readRawCapped(report.path);
      const parsed = raw === null ? { model: null, registry: null, permissions: [] } : parseProfilePatch(raw);
      body = synthesizePresetBody(report.name, parsed);
    } else {
      raw = await readRawCapped(report.path);
      body = raw;
    }
    const backups = await listBackupsSafe();
    const lastBackup = backups.find((item) => item && item.subject === id) ?? null;
    return { ...report, body: body ?? '', raw: raw ?? '', backup: lastBackup };
  }

  function assertWritable(report) {
    if (report.kind === 'preset' || report.source === 'profile-config') {
      throw new HarnessError(
        `Subject "${report.id}" is synthesized from profile config and cannot be modified.`,
        { code: 'unsafe-path', status: 400 },
      );
    }
    if (!report.dir || !report.path) {
      throw new HarnessError(
        `Subject "${report.id}" has no local file; it cannot be modified.`,
        { code: 'unsafe-path', status: 400 },
      );
    }
  }

  async function buildPlan(report, actionIds) {
    assertWritable(report);
    const raw = await readRawCapped(report.path);
    if (raw === null) {
      throw new HarnessError(`Cannot read ${report.path}.`, { code: 'not-found', status: 404 });
    }
    const files = await listSubjectFiles(report.dir);
    let plan;
    try {
      plan = await planFixes({ report, raw, files, actionIds });
    } catch (error) {
      throw toHarnessError(error, 'The fix planner rejected the plan');
    }
    if (!plan || typeof plan !== 'object') {
      throw new HarnessError('The fix planner returned no plan.', { code: 'internal', status: 500 });
    }
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const writes = [
      ...(Array.isArray(plan.writes) ? plan.writes : []),
      ...actions.flatMap((action) => (Array.isArray(action && action.writes) ? action.writes : [])),
    ];
    const subjectRel = toPosix(relative(report.dir, report.path));
    for (const write of writes) {
      const relativePath = write && typeof write.path === 'string' ? write.path : null;
      const target = assertSafeRelPath(report.dir, relativePath, subjectRel);
      await ensureInsideReal(report.dir, target);
    }
    return { plan, actions };
  }

  async function reanalyzeAfterWrite(report, portfolio) {
    const raw = report.kind === 'preset' ? null : await readRawCapped(report.path);
    const files = report.dir ? await listSubjectFiles(report.dir) : [];
    const lessonsRaw = report.dir ? await readLessonsRaw(report.dir) : null;
    const siblings = (portfolio.subjects || [])
      .filter((item) => item && item.id !== report.id)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        description: typeof item.description === 'string' ? item.description : '',
        body: item.kind === 'instruction' ? (typeof item.body === 'string' ? item.body : null) : null,
        path: item.path ?? null,
        dir: item.dir ?? null,
        scope: item.scope ?? null,
      }));
    const signals = report.evolution && typeof report.evolution === 'object' ? report.evolution.signals : null;

    const fresh = analyzeSubject({
      subject: {
        kind: report.kind,
        name: report.name,
        description: typeof report.description === 'string' ? report.description : '',
        path: report.path,
        dir: report.dir,
        owner: report.owner ?? null,
        mtime: await mtimeOf(report.path),
        source: report.source ?? 'filesystem',
        scope: report.scope ?? null,
        config: report.config ?? null,
        id: report.id,
      },
      raw: raw === null ? undefined : raw,
      files,
      usage: report.usage,
      injection: report.injection,
      signals,
      siblings,
      options: {
        now: Date.now(),
        windowDays: config.windowDays,
        usageAvailable: true,
        catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
      },
      evolution: { lessonsRaw },
      previousTotal: report.score?.total ?? null,
    });
    if (fresh && typeof fresh === 'object') {
      if (!fresh.path) fresh.path = report.path;
      if (!fresh.dir) fresh.dir = report.dir;
      if (!fresh.usage) fresh.usage = report.usage;
      if (!fresh.injection) fresh.injection = report.injection;
      if (report.id) fresh.id = report.id;
    }
    return fresh;
  }

  async function applyOne(report, actionIds, portfolio) {
    const { plan, actions } = await buildPlan(report, actionIds);
    if (actions.length === 0) {
      const reasons = (Array.isArray(plan.skipped) ? plan.skipped : [])
        .map((item) => `${item && item.id ? item.id : '?'}: ${(item && item.reason) || 'skipped'}`)
        .join('; ');
      throw new HarnessError(
        `No executable actions for "${report.id}"${reasons ? ` (${reasons})` : ''}.`,
        { code: 'no-actions', status: 409 },
      );
    }
    let result;
    try {
      result = await applyPlan({
        plan,
        subjectDir: report.dir,
        backupRoot,
        now: Date.now(),
        report,
      });
    } catch (error) {
      throw toHarnessError(error, `Cannot apply fixes to "${report.id}"`);
    }
    for (const changed of Array.isArray(result?.changed) ? result.changed : []) {
      const relativePath = changed && typeof changed.path === 'string' ? changed.path : null;
      const target = assertSafeRelPath(report.dir, relativePath, toPosix(relative(report.dir, report.path)));
      await ensureInsideReal(report.dir, target);
    }
    try {
      await pruneBackups(backupRoot, config.backupsKeep);
    } catch (error) {
      logWarn(`agents-360: cannot prune backups: ${(error && error.message) || String(error)}`);
    }
    const beforeTotal = report.score?.total ?? null;
    const afterReport = await reanalyzeAfterWrite(report, portfolio);
    invalidate();
    return {
      backupId: result?.backupId ?? null,
      changed: Array.isArray(result?.changed) ? result.changed : [],
      diff: typeof result?.diff === 'string' ? result.diff : '',
      report: afterReport,
      actionIds: actions.map((action) => action.id),
      skippedActions: Array.isArray(plan.skipped) ? plan.skipped : [],
      beforeTotal,
      afterTotal: afterReport?.score?.total ?? null,
    };
  }

  async function applyActions(id, actionIds) {
    return serial(async () => {
      const portfolio = await getPortfolio({});
      const report = findReport(portfolio, id);
      const known = new Set(suggestionsOf(report).map((item) => item.id));
      const unknown = actionIds.filter((actionId) => !known.has(actionId));
      if (unknown.length > 0) {
        throw new HarnessError(
          `Unknown action id${unknown.length > 1 ? 's' : ''} for "${id}": ${unknown.join(', ')}. ` +
            'actionIds must come from the current scan suggestions.',
          { code: 'invalid-argument', status: 400 },
        );
      }
      const result = await applyOne(report, actionIds, portfolio);
      logInfo(`agents-360: applied ${result.actionIds.length} action(s) to ${id} (backup ${result.backupId})`);
      return {
        backupId: result.backupId,
        changed: result.changed,
        diff: result.diff,
        report: result.report,
        actionIds: result.actionIds,
        beforeTotal: result.beforeTotal,
        afterTotal: result.afterTotal,
      };
    });
  }

  async function applyAll({ id = null, safeOnly = true } = {}) {
    return serial(async () => {
      const portfolio = await getPortfolio({});
      let targets;
      if (id) {
        targets = [findReport(portfolio, id)];
      } else {
        targets = (portfolio.subjects || []).filter((item) => item && item.id && item.source !== 'profile-config');
      }
      const applied = [];
      const skipped = [];
      const backupIds = [];
      for (const report of targets) {
        const ids = eligibleActionIds(report, safeOnly);
        if (ids.length === 0) {
          skipped.push({
            id: report.id,
            reason: suggestionsOf(report).length === 0 ? 'no-actions' : 'no-eligible-actions',
          });
          continue;
        }
        try {
          const result = await applyOne(report, ids, portfolio);
          applied.push({
            id: report.id,
            actionIds: result.actionIds,
            actions: result.actionIds,
            beforeTotal: result.beforeTotal,
            afterTotal: result.afterTotal,
            backupId: result.backupId,
          });
          if (result.backupId) backupIds.push(result.backupId);
        } catch (error) {
          skipped.push({
            id: report.id,
            reason: (error && error.message) || String(error),
            code: (error && error.code) || 'internal',
          });
        }
      }
      invalidate();
      logInfo(`agents-360: apply-all touched ${applied.length} subject(s), skipped ${skipped.length}`);
      return {
        applied,
        skipped,
        backupIds,
        backupId: backupIds.length > 0 ? backupIds[backupIds.length - 1] : null,
      };
    });
  }

  async function undo(backupId, backupIds = null) {
    return serial(async () => {
      const ids = Array.isArray(backupIds) && backupIds.length > 0
        ? backupIds.slice().reverse()
        : [backupId ?? null];
      const backups = [];
      for (const id of ids) {
        if (id !== null && id !== undefined) {
          if (typeof id !== 'string' || !BACKUP_ID.test(id) || id.includes('..')) {
            throw new HarnessError('Argument "backupId" is not a valid backup id.', {
              code: 'invalid-argument',
              status: 400,
            });
          }
        }
        try {
          backups.push(await undoBackup({ backupRoot, backupId: id ?? undefined }));
        } catch (error) {
          throw toHarnessError(error, `Cannot undo backup${id ? ` "${id}"` : ''}`);
        }
      }
      invalidate();
      const restored = backups.flatMap((item) => item.restored || []);
      const removed = backups.flatMap((item) => item.removed || []);
      const last = backups[0] || null;
      logInfo(`agents-360: undid ${backups.length} backup(s)`);
      return {
        backupId: last?.backupId ?? backupId ?? null,
        backups,
        restored,
        removed,
      };
    });
  }

  async function writeMarkdown(markdown) {
    await mkdir(reportDir, { recursive: true });
    const filename = `agents-360-${stampFor(new Date())}.md`;
    const target = assertSafeReportFile(reportDir, filename);
    await ensureInsideReal(reportDir, target);
    await writeFile(target, markdown, 'utf8');
    return { path: target };
  }

  async function exportReport({ portfolio = null } = {}) {
    const current = portfolio ?? (await getPortfolio({}));
    const markdown = renderMarkdown(current, { detail: true });
    const saved = await writeMarkdown(markdown);
    logInfo(`agents-360: exported report to ${saved.path}`);
    return { path: saved.path, markdown };
  }

  /** Dry-run planning for the optimize tool: reads only, never writes. */
  async function planOnly(report, actionIds) {
    const { plan, actions } = await buildPlan(report, actionIds);
    const writes = Array.isArray(plan.writes) ? plan.writes : [];
    return {
      id: report.id,
      actionIds: actions.map((action) => action.id),
      actions: actions.map((action) => ({
        id: action.id,
        type: action.type,
        title: action.title,
        note: action.note,
      })),
      writes: writes.map((write) => ({
        path: write.path,
        chars: typeof write.content === 'string' ? write.content.length : 0,
      })),
      skipped: Array.isArray(plan.skipped) ? plan.skipped : [],
      beforeTotal: report.score?.total ?? null,
    };
  }

  /** Plan a lesson write (`fix.add-lesson`) and re-validate every write path. */
  async function buildEvolvePlan(report, lesson) {
    assertWritable(report);
    const raw = await readRawCapped(report.path);
    if (raw === null) {
      throw new HarnessError(`Cannot read ${report.path}.`, { code: 'not-found', status: 404 });
    }
    const files = await listSubjectFiles(report.dir);
    const lessonsRaw = await readLessonsRaw(report.dir);
    let plan;
    try {
      plan = await planFixes({ report, raw, files, actionIds: ['fix.add-lesson'], lesson, lessonsRaw });
    } catch (error) {
      throw toHarnessError(error, 'The fix planner rejected the lesson plan');
    }
    if (!plan || typeof plan !== 'object') {
      throw new HarnessError('The fix planner returned no plan.', { code: 'internal', status: 500 });
    }
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const writes = [
      ...(Array.isArray(plan.writes) ? plan.writes : []),
      ...actions.flatMap((action) => (Array.isArray(action && action.writes) ? action.writes : [])),
    ];
    const subjectRel = toPosix(relative(report.dir, report.path));
    for (const write of writes) {
      const relativePath = write && typeof write.path === 'string' ? write.path : null;
      const target = assertSafeRelPath(report.dir, relativePath, subjectRel);
      await ensureInsideReal(report.dir, target);
    }
    return { plan, actions };
  }

  async function evolve({ id, lesson, dryRun = false }) {
    return serial(async () => {
      if (typeof id !== 'string' || !SUBJECT_ID.test(id)) {
        throw new HarnessError('Argument "id" must be a valid subject id (kind:slug).', {
          code: 'not-found',
          status: 404,
        });
      }
      const normalizedLesson = normalizeLesson(lesson);
      const portfolio = await getPortfolio({});
      const report = findReport(portfolio, id);
      const { plan, actions } = await buildEvolvePlan(report, normalizedLesson);
      if (actions.length === 0) {
        const reasons = (Array.isArray(plan.skipped) ? plan.skipped : [])
          .map((item) => `${item && item.id ? item.id : '?'}: ${(item && item.reason) || 'skipped'}`)
          .join('; ');
        throw new HarnessError(
          `No executable lesson write for "${id}"${reasons ? ` (${reasons})` : ''}.`,
          { code: 'no-actions', status: 409 },
        );
      }
      if (dryRun) {
        return {
          dryRun: true,
          plan: { writes: Array.isArray(plan.writes) ? plan.writes : [] },
          actions,
          skipped: Array.isArray(plan.skipped) ? plan.skipped : [],
        };
      }
      let result;
      try {
        result = await applyPlan({ plan, subjectDir: report.dir, backupRoot, now: Date.now(), report });
      } catch (error) {
        throw toHarnessError(error, `Cannot write lesson for "${id}"`);
      }
      for (const changed of Array.isArray(result?.changed) ? result.changed : []) {
        const relativePath = changed && typeof changed.path === 'string' ? changed.path : null;
        const target = assertSafeRelPath(report.dir, relativePath, toPosix(relative(report.dir, report.path)));
        await ensureInsideReal(report.dir, target);
      }
      try {
        await pruneBackups(backupRoot, config.backupsKeep);
      } catch (error) {
        logWarn(`agents-360: cannot prune backups: ${(error && error.message) || String(error)}`);
      }
      const beforeTotal = report.score?.total ?? null;
      const afterReport = await reanalyzeAfterWrite(report, portfolio);
      invalidate();
      logInfo(`agents-360: evolved ${id} (backup ${result.backupId})`);
      return {
        dryRun: false,
        backupId: result?.backupId ?? null,
        changed: Array.isArray(result?.changed) ? result.changed : [],
        diff: typeof result?.diff === 'string' ? result.diff : '',
        beforeTotal,
        afterTotal: afterReport?.score?.total ?? null,
        lesson: normalizedLesson,
        report: afterReport,
      };
    });
  }

  return {
    config,
    backupRoot,
    reportDir,
    getPortfolio,
    filterPortfolio,
    invalidate,
    getSubjectDetail,
    applyActions,
    applyAll,
    undo,
    listBackups: listBackupsSafe,
    exportReport,
    writeMarkdown,
    planOnly,
    findReport,
    buildPlan,
    buildEvolvePlan,
    evolve,
  };
}

// ------------------------------------------------------------------- routes

function okPayload(data) {
  return { status: 200, payload: { ok: true, data } };
}

function failPayload(status, message, code) {
  return { status, payload: { ok: false, error: { message, code } } };
}

function parseJsonBody(text) {
  if (!text) return {};
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new HarnessError('Request body is too large.', { code: 'invalid-argument', status: 413 });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HarnessError('Request body must be a JSON object.', { code: 'invalid-argument', status: 400 });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HarnessError('Request body must be a JSON object.', { code: 'invalid-argument', status: 400 });
  }
  return parsed;
}

function readNodeBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectBody(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HarnessError('Request body is too large.', { code: 'invalid-argument', status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

function resolveConnection(ctx) {
  try {
    return ctx.get('connection');
  } catch {
    return undefined;
  }
}

function requireStringArg(value, key, maxLength = 512) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HarnessError(`Missing required argument "${key}".`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HarnessError(`Argument "${key}" is too long (max ${maxLength} characters).`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return trimmed;
}

function requireSubjectId(value, maxLength = 200) {
  const id = requireStringArg(value, 'id', maxLength);
  if (!SUBJECT_ID.test(id)) {
    throw new HarnessError('Subject id must be "kind:slug" with a kind prefix of instr, agent, or preset.', {
      code: 'not-found',
      status: 404,
    });
  }
  return id;
}

function optionalActionIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new HarnessError('Argument "actionIds" must be an array of strings.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const ids = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new HarnessError('Argument "actionIds" must contain non-empty strings.', {
        code: 'invalid-argument',
        status: 400,
      });
    }
    const trimmed = item.trim();
    if (trimmed.length > 200) {
      throw new HarnessError('Argument "actionIds" contains an over-long id.', {
        code: 'invalid-argument',
        status: 400,
      });
    }
    if (!ids.includes(trimmed)) ids.push(trimmed);
  }
  if (ids.length === 0) {
    throw new HarnessError('Argument "actionIds" must not be empty.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  if (ids.length > MAX_ACTION_IDS) {
    throw new HarnessError(`Argument "actionIds" accepts at most ${MAX_ACTION_IDS} entries.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return ids;
}

/** Validate/coerce a lesson payload: trigger 1..200, rule 1..500, evidence 0..200. */
function normalizeLesson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessError('Argument "lesson" must be an object with "trigger" and "rule".', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const strip = (text) => String(text == null ? '' : text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  const trigger = strip(value.trigger);
  const rule = strip(value.rule);
  const evidence = strip(value.evidence);
  if (!trigger) {
    throw new HarnessError('lesson.trigger must be non-empty (1..200 characters).', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  if (trigger.length > 200) {
    throw new HarnessError('lesson.trigger is too long (max 200 characters).', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  if (!rule) {
    throw new HarnessError('lesson.rule must be non-empty (1..500 characters): write a concrete, executable rule before saving.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  if (rule.length > 500) {
    throw new HarnessError('lesson.rule is too long (max 500 characters).', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  if (evidence.length > 200) {
    throw new HarnessError('lesson.evidence is too long (max 200 characters).', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return { trigger, rule, evidence };
}

function optionalQueryInteger(searchParams, key, fallback) {
  const raw = searchParams.get(key);
  if (raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) {
    throw new HarnessError(`Query parameter "${key}" must be an integer between 1 and 3650.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return parsed;
}

function truthyQuery(searchParams, key) {
  const raw = searchParams.get(key);
  return raw === '1' || raw === 'true' || raw === 'yes';
}

async function dispatchRoute({ method, pathname, searchParams, headers, bodyText, connection, host }) {
  if (!connection || typeof connection.requestRejection !== 'function') {
    return failPayload(
      503,
      'The agents-360 route needs the Harness connection service.',
      'unavailable',
    );
  }
  const rejection = connection.requestRejection({ headers });
  if (rejection) {
    return failPayload(rejection, 'Unauthorized', 'unauthorized');
  }
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(ROUTE_PREFIX + '/')) {
    return failPayload(404, 'Not found', 'not-found');
  }
  const route = pathname.slice(ROUTE_PREFIX.length) || '/';
  const effectiveMethod = method === 'HEAD' ? 'GET' : method;

  try {
    if (effectiveMethod === 'GET') {
      if (route === '/scan') {
        const refresh = truthyQuery(searchParams, 'refresh');
        const windowDays = optionalQueryInteger(searchParams, 'windowDays', host.config.windowDays);
        const kind = searchParams.get('kind') || null;
        if (kind && !SUBJECT_KINDS.has(kind)) {
          return failPayload(400, 'Query parameter "kind" must be one of instruction, agent, preset.', 'invalid-argument');
        }
        const portfolio = await host.getPortfolio({ windowDays, refresh });
        return okPayload(host.filterPortfolio(portfolio, kind));
      }
      if (route === '/subject') {
        const id = searchParams.get('id') || '';
        return okPayload(await host.getSubjectDetail(requireSubjectId(id)));
      }
      if (route === '/backups') {
        return okPayload(await host.listBackups());
      }
      return failPayload(404, 'Unknown route: GET ' + route, 'not-found');
    }

    if (effectiveMethod === 'POST') {
      const body = parseJsonBody(bodyText);
      if (route === '/apply') {
        const id = requireSubjectId(body.id);
        const actionIds = optionalActionIds(body.actionIds);
        if (actionIds.length === 0) {
          throw new HarnessError('Argument "actionIds" must name at least one current suggestion; use /apply-all for a batch.', {
            code: 'invalid-argument',
            status: 400,
          });
        }
        return okPayload(await host.applyActions(id, actionIds));
      }
      if (route === '/apply-all') {
        const id = body.id === undefined || body.id === null
          ? null
          : requireSubjectId(body.id);
        const safeOnly = body.safeOnly !== false;
        return okPayload(await host.applyAll({ id, safeOnly }));
      }
      if (route === '/undo') {
        const backupId = body.backupId === undefined || body.backupId === null
          ? null
          : requireStringArg(body.backupId, 'backupId', 128);
        const backupIds = optionalBackupIds(body.backupIds);
        return okPayload(await host.undo(backupId, backupIds));
      }
      if (route === '/export') {
        return okPayload(await host.exportReport());
      }
      if (route === '/evolve') {
        const id = requireSubjectId(body.id);
        const lesson = body.lesson;
        const dryRun = body.dryRun === true;
        return okPayload(await host.evolve({ id, lesson, dryRun }));
      }
      return failPayload(404, 'Unknown route: POST ' + route, 'not-found');
    }

    return {
      status: 405,
      payload: { ok: false, error: { message: 'Method not allowed', code: 'invalid-argument' } },
      headers: { allow: 'GET, HEAD, POST' },
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return failPayload(499, 'Request aborted.', 'aborted');
    }
    if (error instanceof HarnessError) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
      return failPayload(status, error.message, error.code);
    }
    return failPayload(500, (error && error.message) || String(error), 'internal');
  }
}

function sendNodeResponse(res, method, status, payload, extraHeaders) {
  const text = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(extraHeaders || {}),
  };
  if (method !== 'HEAD') headers['content-length'] = String(Buffer.byteLength(text, 'utf8'));
  res.writeHead(status, headers);
  if (method === 'HEAD') res.end();
  else res.end(text);
}

function createRouteHandler(ctx, host) {
  return async (req, res) => {
    const method = req.method || 'GET';
    const headers = req.headers || {};
    try {
      let pathname = '/';
      let searchParams = new URLSearchParams();
      try {
        const url = new URL(req.url || '/', 'http://' + (headers.host || '127.0.0.1'));
        pathname = url.pathname;
        searchParams = url.searchParams;
      } catch {
        sendNodeResponse(res, method, 400, {
          ok: false,
          error: { message: 'Malformed request URL.', code: 'invalid-argument' },
        });
        return;
      }
      let bodyText = '';
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        bodyText = await readNodeBody(req);
      }
      const result = await dispatchRoute({
        method,
        pathname,
        searchParams,
        headers,
        bodyText,
        connection: resolveConnection(ctx),
        host,
      });
      sendNodeResponse(res, method, result.status, result.payload, result.headers);
    } catch (error) {
      const status = error instanceof HarnessError && Number.isInteger(error.status)
        ? error.status
        : 500;
      sendNodeResponse(res, method, status, {
        ok: false,
        error: {
          message: (error && error.message) || String(error),
          code: (error && error.code) || 'internal',
        },
      });
    }
  };
}

// -------------------------------------------------------------------- tools

/** Tool outputs must be lossless JSON: drop undefined/function fields. */
function lossless(value) {
  return JSON.parse(JSON.stringify(value));
}

function optionalToolInteger(args, key, fallback, max) {
  const value = args && args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HarnessError(`Argument "${key}" must be an integer.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const parsed = Math.floor(value);
  if (parsed < 1 || parsed > max) {
    throw new HarnessError(`Argument "${key}" must be between 1 and ${max}.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return parsed;
}

function optionalToolCwd(args) {
  const value = args && args.cwd;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new HarnessError('Argument "cwd" must be an absolute workspace path.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return resolve(value);
}

function optionalBackupIds(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new HarnessError('Argument "backupIds" must be an array of strings.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  if (value.length > 30) {
    throw new HarnessError('Argument "backupIds" accepts at most 30 ids.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return value.map((item) => {
    if (typeof item !== 'string' || !BACKUP_ID.test(item) || item.includes('..')) {
      throw new HarnessError('Argument "backupIds" contains an invalid id.', {
        code: 'invalid-argument',
        status: 400,
      });
    }
    return item;
  });
}

function optionalToolSubjectIds(value, max = 200) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new HarnessError('Argument "ids" must be an array of subject ids.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const ids = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (ids.length > max) {
    throw new HarnessError(`Argument "ids" accepts at most ${max} entries.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return ids.length > 0 ? ids : null;
}

function summaryPortfolio(portfolio) {
  const subjects = Array.isArray(portfolio.subjects) ? portfolio.subjects : [];
  return {
    generatedAt: portfolio.generatedAt ?? null,
    windowDays: portfolio.windowDays ?? null,
    sessionsScanned: portfolio.sessionsScanned ?? null,
    usageAvailable: portfolio.usageAvailable ?? false,
    totals: portfolio.totals ?? null,
    deltaAvg: portfolio.deltaAvg ?? null,
    subjects: subjects.map((report) => ({
      id: report.id,
      name: report.name,
      kind: report.kind,
      total: report.score?.total ?? null,
      score: report.score?.total ?? null,
      grade: report.score?.grade ?? null,
      confidence: report.score?.confidence ?? null,
      verdict: report.verdict?.code ?? null,
      verdictCode: report.verdict?.code ?? null,
      verdictLabel: report.verdict?.label ?? null,
      usage: {
        sessions: report.usage?.sessions ?? 0,
        lastUsedAt: report.usage?.lastUsedAt ?? null,
        sufficient: report.usage?.sufficient ?? false,
        sessionsInjected: report.injection?.sessionsInjected ?? null,
        sessionsSeen: report.injection?.sessionsSeen ?? null,
        subagentRuns: report.usage?.subagentRuns ?? null,
        presetSessions: report.usage?.presetSessions ?? null,
      },
      topFinding: topFindingOf(report),
      evolution: {
        applicable: report.evolution?.applicable ?? false,
        lessons: report.evolution?.lessons?.count ?? 0,
        linked: report.evolution?.lessons?.linked ?? false,
        pendingScore: report.evolution?.pending?.score ?? 0,
        hasUnclosed: report.evolution?.pending?.hasUnclosed ?? false,
        lastSignalAt: report.evolution?.pending?.lastSignalAt ?? null,
        draft: report.evolution?.pending?.draft ?? null,
      },
    })),
    conflicts: Array.isArray(portfolio.conflicts) ? portfolio.conflicts : [],
    quickWins: Array.isArray(portfolio.quickWins) ? portfolio.quickWins : [],
  };
}

// ----------------------------------------------------------------- surface

export function createAgentsSurface({ ctx, config, paths }) {
  const host = createAgentsHost(ctx, config, paths);

  /** Full portfolio for a scan, optionally filtered to one subject kind. */
  async function scanSurface({ windowDays, refresh, cwd, kind } = {}) {
    const portfolio = await host.getPortfolio({ windowDays, cwd, refresh });
    return host.filterPortfolio(portfolio, kind);
  }

  /** Report service: filter by ids + render markdown (no file save). */
  async function reportService({ ids, detail } = {}) {
    const offered = optionalToolSubjectIds(ids);
    const portfolio = await host.getPortfolio({});
    let selected = portfolio;
    if (offered) {
      const byId = new Map((portfolio.subjects || []).map((report) => [report.id, report]));
      const missing = offered.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new HarnessError(`Unknown subject id(s): ${missing.join(', ')}`, {
          code: 'not-found',
          status: 404,
        });
      }
      const chosen = offered.map((id) => byId.get(id));
      const idSet = new Set(chosen.map((report) => report.id));
      selected = {
        ...portfolio,
        subjects: chosen,
        quickWins: (portfolio.quickWins || []).filter((win) => idSet.has(win.id)),
        overlaps: (portfolio.overlaps || []).filter((pair) => idSet.has(pair.a) && idSet.has(pair.b)),
      };
    }
    const markdown = renderMarkdown(selected, { detail: detail !== false });
    return { markdown };
  }

  /** Optimize service: plan (dryRun) or apply the safe mechanical fixes. */
  async function optimizeService({ ids, actionIds, safeOnly, dryRun } = {}) {
    const safe = safeOnly !== false;
    const dry = dryRun !== false;
    const requestedIds = optionalToolSubjectIds(ids);
    const requestedActionIds = actionIds !== undefined && actionIds !== null
      ? optionalActionIds(actionIds)
      : null;

    const portfolio = await host.getPortfolio({});
    const allReports = (portfolio.subjects || []).filter((report) => report && report.id);
    let targets = allReports;
    if (requestedIds) {
      const byId = new Map(allReports.map((report) => [report.id, report]));
      const missing = requestedIds.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new HarnessError(`Unknown subject id(s): ${missing.join(', ')}`, {
          code: 'not-found',
          status: 404,
        });
      }
      targets = requestedIds.map((id) => byId.get(id));
    }

    if (requestedActionIds) {
      const known = new Set();
      for (const report of targets) {
        for (const suggestion of suggestionsOf(report)) known.add(suggestion.id);
      }
      const unknown = requestedActionIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new HarnessError(
          `Unknown action id(s): ${unknown.join(', ')}. Use dsh360_scan detail="full" to read current ids.`,
          { code: 'invalid-argument', status: 400 },
        );
      }
    }

    const skipped = [];
    if (dry) {
      const plans = [];
      for (const report of targets) {
        const targetIds = requestedActionIds
          ? requestedActionIds.filter((id) => suggestionsOf(report).some((item) => item.id === id))
          : eligibleActionIds(report, safe);
        if (targetIds.length === 0) {
          skipped.push({ id: report.id, reason: 'no-eligible-actions' });
          continue;
        }
        try {
          const plan = await host.planOnly(report, targetIds);
          if (plan.actionIds.length === 0) {
            skipped.push({ id: report.id, reason: 'no-executable-actions', skipped: plan.skipped });
            continue;
          }
          plans.push(plan);
        } catch (error) {
          skipped.push({ id: report.id, reason: (error && error.message) || String(error) });
        }
      }
      return lossless({ dryRun: true, plans, skipped, totals: portfolio.totals ?? null });
    }

    const applied = [];
    const backupIds = [];
    for (const report of targets) {
      const targetIds = requestedActionIds
        ? requestedActionIds.filter((id) => suggestionsOf(report).some((item) => item.id === id))
        : eligibleActionIds(report, safe);
      if (targetIds.length === 0) {
        skipped.push({ id: report.id, reason: 'no-eligible-actions' });
        continue;
      }
      try {
        const result = await host.applyActions(report.id, targetIds);
        applied.push({
          id: report.id,
          actionIds: result.actionIds,
          actions: result.actionIds,
          beforeTotal: result.beforeTotal,
          afterTotal: result.afterTotal,
          backupId: result.backupId,
        });
        if (result.backupId) backupIds.push(result.backupId);
      } catch (error) {
        skipped.push({
          id: report.id,
          reason: (error && error.message) || String(error),
          code: (error && error.code) || 'internal',
        });
      }
    }
    return lossless({
      dryRun: false,
      applied,
      skipped,
      backupIds,
      backupId: backupIds.length > 0 ? backupIds[backupIds.length - 1] : null,
    });
  }

  /** Evolve dry-run service: list unclosed proposals (≤10). */
  async function evolveProposalsService({ ids } = {}) {
    const requestedIds = optionalToolSubjectIds(ids);
    const portfolio = await host.getPortfolio({});
    const proposals = [];
    for (const report of portfolio.subjects || []) {
      const pending = report.evolution?.pending;
      if (!pending || pending.hasUnclosed !== true) continue;
      if (requestedIds && !requestedIds.includes(report.id)) continue;
      proposals.push({
        id: report.id,
        name: report.name,
        pendingScore: pending.score ?? 0,
        hasUnclosed: true,
        lastSignalAt: pending.lastSignalAt ?? null,
        lessons: report.evolution?.lessons?.count ?? 0,
        linked: report.evolution?.lessons?.linked ?? false,
        draft: pending.draft ?? null,
        evidence: pending.draft?.evidence ?? null,
      });
    }
    proposals.sort((a, b) => (b.pendingScore - a.pendingScore) || String(a.id).localeCompare(String(b.id)));
    const result = {
      dryRun: true,
      proposals: proposals.slice(0, 10),
      totals: portfolio.totals?.evolution ?? null,
    };
    if (proposals.length === 0) {
      result.note = 'No subjects have unclosed evolution signals right now.';
    }
    return lossless(result);
  }

  /** Evolve write service: write a lesson back into .agents-360/lessons.md. */
  async function evolveWriteService({ id, lesson } = {}) {
    const subjectIdArg = typeof id === 'string' ? id.trim() : '';
    if (!subjectIdArg) {
      throw new HarnessError('dryRun=false requires "id" (subject id) and "lesson".', {
        code: 'invalid-argument',
        status: 400,
      });
    }
    if (!lesson || typeof lesson !== 'object') {
      throw new HarnessError('dryRun=false requires a "lesson" object with trigger and rule.', {
        code: 'invalid-argument',
        status: 400,
      });
    }
    const result = await host.evolve({ id: subjectIdArg, lesson, dryRun: false });
    return lossless({
      dryRun: false,
      id: subjectIdArg,
      backupId: result.backupId,
      beforeTotal: result.beforeTotal,
      afterTotal: result.afterTotal,
      lesson: result.lesson,
      evolution: result.report?.evolution ?? null,
    });
  }

  return {
    id: 'agents',
    routePrefix: ROUTE_PREFIX,
    routes: [{ kind: 'prefix', path: ROUTE_PREFIX, handler: createRouteHandler(ctx, host) }],
    // INTERFACE §4 contract.
    scan: scanSurface,
    detail: ({ id } = {}) => host.getSubjectDetail(id),
    apply: (id, actionIds) => host.applyActions(id, actionIds),
    applyAll: (opts = {}) => host.applyAll(opts),
    undo: (backupId, backupIds = null) => host.undo(backupId, backupIds),
    backups: () => host.listBackups(),
    exportReport: (opts = {}) => host.exportReport(opts),
    evolve: (opts = {}) => host.evolve(opts),
    invalidate: () => host.invalidate(),
    // Tool services (consumed by index.js dsh360_* tools).
    summary: (portfolio) => summaryPortfolio(portfolio),
    report: reportService,
    optimize: optimizeService,
    evolveProposals: evolveProposalsService,
    evolveWrite: evolveWriteService,
  };
}

/**
 * Verification seam only: the path guards are the security boundary the Host
 * re-applies before any write, so the standalone verifier exercises them
 * directly (traversal, absolute paths, symlinked agent-notes).
 */
export const __internals = Object.freeze({
  assertSafeRelPath,
  ensureInsideReal,
  assertSafeReportFile,
  isInsideRoot,
  listSubjectFiles,
  parseProfilePatch,
  synthesizePresetBody,
});
