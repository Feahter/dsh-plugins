/**
 * Host half of the skills-360 bundle.
 *
 * Discovers the live DSH skill catalog through `ctx.skills`, scores every skill
 * with the core rubric (`lib/analyze.js`), caches the portfolio for a minute,
 * exposes it to the Web panel over `/api/skills-360/*`, and offers three agent
 * tools (`skills360_*`). Writes always go through `lib/fixes.js` so every
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

import { analyzeSkill, buildPortfolio } from './lib/analyze.js';
import { applyPlan, listBackups, planFixes, pruneBackups, undoBackup } from './lib/fixes.js';
import { parseSkillMarkdown } from './lib/frontmatter.js';
import { renderMarkdown } from './lib/report.js';
import { collectUsage } from './lib/usage.js';

const ROUTE_PREFIX = '/api/skills-360';
const MAX_BODY_BYTES = 256 * 1024;
const CACHE_TTL_MS = 60_000;
const MAX_LISTED_FILES = 200;
const MAX_SCAN_DEPTH = 2;
const MAX_ACTION_IDS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = Object.freeze({
  windowDays: 30,
  catalogDescriptionMaxLength: 500,
  backupsKeep: 20,
  evolution: true,
});

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2, info: 3 };
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    windowDays: positiveInteger(raw.windowDays, DEFAULTS.windowDays, 3650),
    catalogDescriptionMaxLength: positiveInteger(
      raw.catalogDescriptionMaxLength,
      DEFAULTS.catalogDescriptionMaxLength,
      4000,
    ),
    backupsKeep: positiveInteger(raw.backupsKeep, DEFAULTS.backupsKeep, 1000),
    evolution: raw.evolution === false ? false : DEFAULTS.evolution,
  };
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured.trim());
  return join(homedir(), '.dsh');
}

// -------------------------------------------------------------- path guards

function isInsideRoot(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/**
 * Resolve a plan-relative write path and prove it stays under the skill
 * directory and inside the only two writable surfaces the contract allows:
 * `SKILL.md` and `references/**`. Rejects absolute paths, `..` segments, NUL
 * bytes, empty segments, and anything else.
 */
function assertSafeRelPath(dir, relPath) {
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
    throw new HarnessError(`Refusing path outside the skill directory: ${relPath}`, { code: 'unsafe-path', status: 400 });
  }
  const relPosix = rel.split(sep).join('/');
  if (relPosix !== 'SKILL.md' && !/^references\/[A-Za-z0-9._-]+\.md$/.test(relPosix)) {
    throw new HarnessError(
      `Refusing to write "${relPosix}": only SKILL.md and ASCII references/*.md are writable.`,
      { code: 'unsafe-path', status: 400 },
    );
  }
  return target;
}

/**
 * Re-check the real path of a write target (or its nearest existing ancestor)
 * so a symlinked `references/` cannot smuggle a write out of the skill dir.
 */
async function ensureInsideReal(dir, target) {
  let root;
  try {
    root = await realpath(dir);
  } catch {
    throw new HarnessError(`Skill directory is not resolvable: ${dir}`, { code: 'unsafe-path', status: 400 });
  }
  let cursor = target;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await realpath(cursor);
      if (!isInsideRoot(root, real)) {
        throw new HarnessError(`Refusing write that resolves outside the skill directory: ${target}`, {
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
 * Read a skill directory breadth-first to a fixed depth, without following
 * symlinks. Only `stat.size` is used: the analyzer needs sizes, not bodies.
 */
async function listSkillFiles(dir) {
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
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_SCAN_DEPTH) await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      if (entry.name === 'SKILL.md') continue;
      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      found.push({ path: toPosix(relative(dir, absolute)), chars: info.size });
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

/** Read a skill's `references/lessons.md` verbatim; null when absent. */
async function readLessonsRaw(dir) {
  if (!dir) return null;
  return readRaw(join(dir, 'references', 'lessons.md'));
}

function bodyFromFile(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = parseSkillMarkdown(raw);
    if (parsed && typeof parsed.body === 'string') return parsed.body;
  } catch {
    // Invalid frontmatter is a scoring finding, never a host failure.
  }
  return null;
}

function coerceState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const byName = value.byName && typeof value.byName === 'object' && !Array.isArray(value.byName)
    ? value.byName
    : {};
  return {
    generatedAt: Number.isFinite(value.generatedAt) ? value.generatedAt : null,
    avgScore: Number.isFinite(value.avgScore) ? value.avgScore : null,
    totals: value.totals && typeof value.totals === 'object' ? value.totals : null,
    byName,
    rubricVersion: typeof value.rubricVersion === 'string' ? value.rubricVersion : null,
  };
}

// --------------------------------------------------------------------- host

function createHost(ctx, config) {
  const dshHome = resolveDshHome();
  const statePath = join(dshHome, 'skills-360', 'state.json');
  const backupRoot = join(dshHome, 'skills-360', 'backups');
  const reportDir = join(dshHome, 'skills-360', 'reports');
  const sessionsDir = join(dshHome, 'sessions');

  /** key = cwd|windowDays|catalogDescriptionMaxLength -> { at, promise } */
  const cache = new Map();
  let queue = Promise.resolve();
  // The most recent usage collection (incl. evolution signals/prompts), kept
  // so re-analysis after a write can rebuild `report.evolution` without a full
  // session re-scan.
  let lastUsage = null;

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

  async function readState() {
    try {
      return coerceState(JSON.parse(await readFile(statePath, 'utf8')));
    } catch {
      return null;
    }
  }

  async function saveState(portfolio, reports) {
    const byName = {};
    for (const report of reports) {
      if (report && typeof report.name === 'string') byName[report.name] = report.score?.total ?? null;
    }
    const snapshot = {
      generatedAt: portfolio?.generatedAt ?? Date.now(),
      avgScore: portfolio?.totals?.avgScore ?? null,
      totals: portfolio?.totals ?? null,
      byName,
      rubricVersion: typeof portfolio?.rubricVersion === 'string' ? portfolio.rubricVersion : null,
    };
    try {
      const existing = await readState();
      // Never let a slower, older scan overwrite a newer snapshot.
      if (existing && Number(existing.generatedAt) > snapshot.generatedAt) return;
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    } catch (error) {
      logWarn(`skills-360: cannot persist scan state: ${(error && error.message) || String(error)}`);
    }
  }

  async function safeCollectUsage(windowDays, now) {
    const emptyEvolution = { signals: {}, prompts: {} };
    const evolutionEnabled = config.evolution !== false;
    try {
      const result = await collectUsage({ sessionsDir, windowDays, now });
      if (!result || typeof result !== 'object') {
        return { byName: {}, catalog: {}, sessionsScanned: 0, spanDays: 0, available: false, ...emptyEvolution };
      }
      return {
        byName: result.byName && typeof result.byName === 'object' ? result.byName : {},
        catalog: result.catalog && typeof result.catalog === 'object' ? result.catalog : {},
        sessionsScanned: Number.isFinite(result.sessionsScanned) ? result.sessionsScanned : 0,
        spanDays: Number.isFinite(result.spanDays) ? result.spanDays : 0,
        available: result.available !== false,
        signals: evolutionEnabled && result.signals && typeof result.signals === 'object' ? result.signals : {},
        prompts: evolutionEnabled && result.prompts && typeof result.prompts === 'object' ? result.prompts : {},
      };
    } catch (error) {
      logWarn(`skills-360: usage collection failed: ${(error && error.message) || String(error)}`);
      return { byName: {}, catalog: {}, sessionsScanned: 0, spanDays: 0, available: false, ...emptyEvolution };
    }
  }

  function usageFor(name, usage, mtime, now, windowDays) {
    const record = (usage.byName && usage.byName[name]) || {};
    const count = Number.isFinite(record.count) ? Math.max(0, Math.floor(record.count)) : 0;
    const lastUsedAt = Number.isFinite(record.lastUsedAt) ? record.lastUsedAt : null;
    const exposureDays = mtime === null || mtime === undefined
      ? 0
      : Math.min(Math.max((now - mtime) / DAY_MS, 0), 365);
    // Exposure is recomputed inside lib/analyze.js, which also accepts the
    // session-window span as a better age proxy than a fresh mtime. Here we
    // only assert that the sample is large enough to be worth judging.
    const exact = usage.catalog && usage.catalog[name];
    const sufficient = Boolean(usage.available) && usage.sessionsScanned >= 5;
    return {
      count,
      lastUsedAt,
      windowDays,
      exposureDays: Math.round(exposureDays * 10) / 10,
      sufficient,
      perWeek: Math.round((count / Math.max(windowDays / 7, 1)) * 100) / 100,
      firstSeen: exact && Number.isFinite(exact.firstSeen) ? exact.firstSeen : null,
      catalogSessions: exact && Number.isFinite(exact.sessions) ? exact.sessions : 0,
    };
  }

  async function analyzeOne({ summary, siblings, usage, now, windowDays, previousState, cwd }) {
    const name = typeof summary.name === 'string' ? summary.name : String(summary.name ?? '');
    const path = typeof summary.path === 'string' && summary.path !== '' ? summary.path : null;
    const dir = path ? dirname(path) : null;

    const raw = await readRaw(path);
    let body = null;
    if (raw === null) {
      try {
        const definition = await ctx.skills.get(name, cwd ? { cwd } : {});
        const content = definition && typeof definition.content === 'string'
          ? definition.content
          : definition && typeof definition.body === 'string'
            ? definition.body
            : null;
        body = typeof content === 'string' ? content : null;
      } catch {
        body = null;
      }
    }

    let mtime = null;
    if (path) {
      try {
        mtime = (await stat(path)).mtimeMs;
      } catch {
        mtime = null;
      }
    }

    const files = dir ? await listSkillFiles(dir) : [];
    const usageInfo = usageFor(name, usage, mtime, now, windowDays);
    const lessonsRaw = await readLessonsRaw(dir);
    const evolution = {
      signals: usage.signals && usage.signals[name] ? usage.signals[name] : null,
      prompts: usage.prompts && usage.prompts[name] ? usage.prompts[name] : null,
      lessonsRaw,
    };
    const summaryForAnalyze = {
      name,
      description: typeof summary.description === 'string' ? summary.description : '',
      whenToUse: typeof summary.whenToUse === 'string' ? summary.whenToUse : null,
      source: typeof summary.source === 'string' ? summary.source : 'unknown',
      provider: typeof summary.provider === 'string' ? summary.provider : 'unknown',
      path,
      dir,
    };

    const report = analyzeSkill({
      summary: summaryForAnalyze,
      raw: raw === null ? undefined : raw,
      body: raw === null && body !== null ? body : undefined,
      files,
      usage: usageInfo,
      siblings,
      options: {
        catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
        now,
        windowDays,
        sessionSpanDays: usage.spanDays ?? 0,
        sessionsScanned: usage.sessionsScanned ?? 0,
      },
      mtime,
      evolution,
      previousTotal: previousState && previousState.byName ? previousState.byName[name] ?? null : null,
    });

    // The core owns these shapes; fill only what a partial read cannot supply.
    if (report && typeof report === 'object') {
      if (!report.path && path) report.path = path;
      if (!report.dir && dir) report.dir = dir;
      if (!report.usage) report.usage = usageInfo;
      // Address skills by their catalog name (what `ctx.skills.get()` takes),
      // even when the frontmatter `name` disagrees — that mismatch is itself a
      // scored finding, not an addressing identity.
      if (name) report.name = name;
    }
    return report;
  }

  async function scan({ cwd, windowDays }) {
    const now = Date.now();
    const previousState = await readState();
    const usage = await safeCollectUsage(windowDays, now);
    lastUsage = usage;
    const summaries = await ctx.skills.list(cwd ? { cwd } : {});
    const list = Array.isArray(summaries) ? summaries.filter((item) => item && item.name) : [];
    const siblings = list.map((item) => ({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
    }));

    const reports = [];
    for (const summary of list) {
      const report = await analyzeOne({ summary, siblings, usage, now, windowDays, previousState, cwd });
      if (report && typeof report === 'object') reports.push(report);
    }

    const options = {
      catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
      now,
      windowDays,
      sessionSpanDays: usage.spanDays ?? 0,
      sessionsScanned: usage.sessionsScanned ?? 0,
    };
    const portfolio = buildPortfolio(reports, {
      generatedAt: now,
      windowDays,
      sessionsScanned: usage.sessionsScanned,
      usageAvailable: usage.available,
      options,
      previous: previousState
        ? {
            generatedAt: previousState.generatedAt,
            avgScore: previousState.avgScore,
            totals: previousState.totals,
            rubricVersion: previousState.rubricVersion ?? null,
          }
        : null,
    });

    await saveState(portfolio, reports);
    logInfo(`skills-360: scanned ${reports.length} skills in ${usage.sessionsScanned} sessions`);
    return portfolio;
  }

  function cacheKey(cwd, windowDays) {
    return `${cwd || ''}|${windowDays}|${config.catalogDescriptionMaxLength}`;
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

  function findReport(portfolio, name) {
    const report = (portfolio.skills || []).find((item) => item && item.name === name);
    if (!report) {
      throw new HarnessError(`No skill named "${name}" in the current catalog.`, {
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
      return sorted.slice(0, config.backupsKeep);
    } catch (error) {
      logWarn(`skills-360: cannot list backups: ${(error && error.message) || String(error)}`);
      return [];
    }
  }

  async function getSkillDetail(name, { cwd = null } = {}) {
    if (typeof name !== 'string' || !SKILL_NAME.test(name)) {
      throw new HarnessError('Query parameter "name" must be a kebab-case skill name.', {
        code: 'not-found',
        status: 404,
      });
    }
    const portfolio = await getPortfolio({ cwd });
    const report = findReport(portfolio, name);
    const raw = await readRaw(report.path);
    let body = bodyFromFile(raw);
    if (body === null) {
      try {
        const definition = await ctx.skills.get(name, cwd ? { cwd } : {});
        if (definition && typeof definition.content === 'string') body = definition.content;
        else if (definition && typeof definition.body === 'string') body = definition.body;
      } catch {
        body = null;
      }
    }
    const backups = await listBackupsSafe();
    const lastBackup = backups.find((item) => item && item.skill === name) ?? null;
    return { ...report, body: body ?? '', raw: raw ?? '', lastBackup };
  }

  function assertWritable(report) {
    if (!report.dir || !report.path) {
      throw new HarnessError(
        `Skill "${report.name}" has no local directory; it cannot be modified.`,
        { code: 'unsafe-path', status: 400 },
      );
    }
  }

  async function buildPlan(report, actionIds) {
    assertWritable(report);
    const raw = await readRaw(report.path);
    if (raw === null) {
      throw new HarnessError(`Cannot read ${report.path}.`, { code: 'not-found', status: 404 });
    }
    const files = await listSkillFiles(report.dir);
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
    // `planFixes` returns both a top-level `writes` array and per-action
    // `writes`; every planned path is re-validated here, not trusted from core.
    const writes = [
      ...(Array.isArray(plan.writes) ? plan.writes : []),
      ...actions.flatMap((action) => (Array.isArray(action && action.writes) ? action.writes : [])),
    ];
    for (const write of writes) {
      const relativePath = write && typeof write.path === 'string' ? write.path : null;
      const target = assertSafeRelPath(report.dir, relativePath);
      await ensureInsideReal(report.dir, target);
    }
    return { plan, actions };
  }

  async function reanalyzeAfterWrite(report, portfolio) {
    const raw = await readRaw(report.path);
    const files = report.dir ? await listSkillFiles(report.dir) : [];
    const lessonsRaw = await readLessonsRaw(report.dir);
    let mtime = null;
    if (report.path) {
      try {
        mtime = (await stat(report.path)).mtimeMs;
      } catch {
        mtime = null;
      }
    }
    const siblings = (portfolio.skills || [])
      .filter((item) => item && item.name && item.name !== report.name)
      .map((item) => ({ name: item.name, description: item.description || '' }));
    const summary = {
      name: report.name,
      description: report.description || '',
      whenToUse: report.whenToUse ?? null,
      source: report.source || 'unknown',
      provider: report.provider || 'unknown',
      path: report.path,
      dir: report.dir,
    };
    const fresh = analyzeSkill({
      summary,
      raw: raw === null ? undefined : raw,
      body: undefined,
      files,
      usage: report.usage,
      siblings,
      options: {
        catalogDescriptionMaxLength: config.catalogDescriptionMaxLength,
        now: Date.now(),
        windowDays: config.windowDays,
        sessionSpanDays: report.usage?.sessionSpanDays ?? 0,
        sessionsScanned: report.usage?.sessionsScanned ?? 0,
      },
      mtime,
      evolution: {
        signals: lastUsage && lastUsage.signals && lastUsage.signals[report.name] ? lastUsage.signals[report.name] : null,
        prompts: lastUsage && lastUsage.prompts && lastUsage.prompts[report.name] ? lastUsage.prompts[report.name] : null,
        lessonsRaw,
      },
      previousTotal: report.score?.total ?? null,
    });
    if (fresh && typeof fresh === 'object') {
      if (!fresh.path) fresh.path = report.path;
      if (!fresh.dir) fresh.dir = report.dir;
      if (!fresh.usage) fresh.usage = report.usage;
      if (report.name) fresh.name = report.name;
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
        `No executable actions for "${report.name}"${reasons ? ` (${reasons})` : ''}.`,
        { code: 'no-actions', status: 409 },
      );
    }
    let result;
    try {
      result = await applyPlan({
        plan,
        skillDir: report.dir,
        backupRoot,
        now: Date.now(),
        report,
      });
    } catch (error) {
      throw toHarnessError(error, `Cannot apply fixes to "${report.name}"`);
    }
    for (const changed of Array.isArray(result?.changed) ? result.changed : []) {
      const relativePath = changed && typeof changed.path === 'string' ? changed.path : null;
      const target = assertSafeRelPath(report.dir, relativePath);
      await ensureInsideReal(report.dir, target);
    }
    try {
      await pruneBackups(backupRoot, config.backupsKeep);
    } catch (error) {
      logWarn(`skills-360: cannot prune backups: ${(error && error.message) || String(error)}`);
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

  async function applyActions(name, actionIds) {
    return serial(async () => {
      const portfolio = await getPortfolio({});
      const report = findReport(portfolio, name);
      const known = new Set(suggestionsOf(report).map((item) => item.id));
      const unknown = actionIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new HarnessError(
          `Unknown action id${unknown.length > 1 ? 's' : ''} for "${name}": ${unknown.join(', ')}. ` +
            'actionIds must come from the current scan suggestions.',
          { code: 'invalid-argument', status: 400 },
        );
      }
      const result = await applyOne(report, actionIds, portfolio);
      logInfo(`skills-360: applied ${result.actionIds.length} action(s) to ${name} (backup ${result.backupId})`);
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

  async function applyAll({ name = null, safeOnly = true } = {}) {
    return serial(async () => {
      const portfolio = await getPortfolio({});
      let targets;
      if (name) {
        targets = [findReport(portfolio, name)];
      } else {
        targets = (portfolio.skills || []).filter((item) => item && item.name);
      }
      const applied = [];
      const skipped = [];
      const backupIds = [];
      for (const report of targets) {
        const ids = eligibleActionIds(report, safeOnly);
        if (ids.length === 0) {
          skipped.push({
            name: report.name,
            reason: suggestionsOf(report).length === 0 ? 'no-actions' : 'no-eligible-actions',
          });
          continue;
        }
        try {
          const result = await applyOne(report, ids, portfolio);
          applied.push({
            name: report.name,
            actionIds: result.actionIds,
            // INTERFACE §4 spells this key `actions`; keep both so the panel
            // and the tool contract can each read the shape they expect.
            actions: result.actionIds,
            beforeTotal: result.beforeTotal,
            afterTotal: result.afterTotal,
            backupId: result.backupId,
          });
          if (result.backupId) backupIds.push(result.backupId);
        } catch (error) {
          skipped.push({
            name: report.name,
            reason: (error && error.message) || String(error),
            code: (error && error.code) || 'internal',
          });
        }
      }
      invalidate();
      logInfo(`skills-360: apply-all touched ${applied.length} skill(s), skipped ${skipped.length}`);
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
      logInfo(`skills-360: undid ${backups.length} backup(s)`);
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
    const filename = `skills-360-${stampFor(new Date())}.md`;
    const target = assertSafeReportFile(reportDir, filename);
    await ensureInsideReal(reportDir, target);
    await writeFile(target, markdown, 'utf8');
    return { path: target };
  }

  async function exportReport({ portfolio = null } = {}) {
    const current = portfolio ?? (await getPortfolio({}));
    const markdown = renderMarkdown(current, { detail: true });
    const saved = await writeMarkdown(markdown);
    logInfo(`skills-360: exported report to ${saved.path}`);
    return { path: saved.path, markdown };
  }

  /** Dry-run planning for the optimize tool: reads only, never writes. */
  async function planOnly(report, actionIds) {
    const { plan, actions } = await buildPlan(report, actionIds);
    // The planner returns writes at the plan level; actions only carry ids.
    const writes = Array.isArray(plan.writes) ? plan.writes : [];
    return {
      name: report.name,
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
    const raw = await readRaw(report.path);
    if (raw === null) {
      throw new HarnessError(`Cannot read ${report.path}.`, { code: 'not-found', status: 404 });
    }
    const files = await listSkillFiles(report.dir);
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
    for (const write of writes) {
      const relativePath = write && typeof write.path === 'string' ? write.path : null;
      const target = assertSafeRelPath(report.dir, relativePath);
      await ensureInsideReal(report.dir, target);
    }
    return { plan, actions };
  }

  async function evolve({ name, lesson, dryRun = false, cwd = null }) {
    return serial(async () => {
      if (typeof name !== 'string' || !SKILL_NAME.test(name)) {
        throw new HarnessError('Argument "name" must be a kebab-case skill name.', {
          code: 'not-found',
          status: 404,
        });
      }
      const normalizedLesson = normalizeLesson(lesson);
      const portfolio = await getPortfolio({ cwd });
      const report = findReport(portfolio, name);
      const { plan, actions } = await buildEvolvePlan(report, normalizedLesson);
      if (actions.length === 0) {
        const reasons = (Array.isArray(plan.skipped) ? plan.skipped : [])
          .map((item) => `${item && item.id ? item.id : '?'}: ${(item && item.reason) || 'skipped'}`)
          .join('; ');
        throw new HarnessError(
          `No executable lesson write for "${name}"${reasons ? ` (${reasons})` : ''}.`,
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
        result = await applyPlan({ plan, skillDir: report.dir, backupRoot, now: Date.now(), report });
      } catch (error) {
        throw toHarnessError(error, `Cannot write lesson for "${name}"`);
      }
      for (const changed of Array.isArray(result?.changed) ? result.changed : []) {
        const relativePath = changed && typeof changed.path === 'string' ? changed.path : null;
        const target = assertSafeRelPath(report.dir, relativePath);
        await ensureInsideReal(report.dir, target);
      }
      try {
        await pruneBackups(backupRoot, config.backupsKeep);
      } catch (error) {
        logWarn(`skills-360: cannot prune backups: ${(error && error.message) || String(error)}`);
      }
      const beforeTotal = report.score?.total ?? null;
      const afterReport = await reanalyzeAfterWrite(report, portfolio);
      invalidate();
      logInfo(`skills-360: evolved ${name} (backup ${result.backupId})`);
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
    dshHome,
    backupRoot,
    reportDir,
    getPortfolio,
    invalidate,
    getSkillDetail,
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
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
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
      'The skills-360 route needs the Harness connection service.',
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
        const portfolio = await host.getPortfolio({ windowDays, refresh });
        return okPayload(portfolio);
      }
      if (route === '/skill') {
        const name = searchParams.get('name') || '';
        return okPayload(await host.getSkillDetail(name));
      }
      if (route === '/backups') {
        return okPayload(await host.listBackups());
      }
      return failPayload(404, 'Unknown route: GET ' + route, 'not-found');
    }

    if (effectiveMethod === 'POST') {
      const body = parseJsonBody(bodyText);
      if (route === '/apply') {
        const name = requireStringArg(body.name, 'name', 200);
        const actionIds = optionalActionIds(body.actionIds);
        if (actionIds.length === 0) {
          throw new HarnessError('Argument "actionIds" must name at least one current suggestion; use /apply-all for a batch.', {
            code: 'invalid-argument',
            status: 400,
          });
        }
        return okPayload(await host.applyActions(name, actionIds));
      }
      if (route === '/apply-all') {
        const name = body.name === undefined || body.name === null
          ? null
          : requireStringArg(body.name, 'name', 200);
        const safeOnly = body.safeOnly !== false;
        return okPayload(await host.applyAll({ name, safeOnly }));
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
        const name = requireStringArg(body.name, 'name', 200);
        const lesson = body.lesson;
        const dryRun = body.dryRun === true;
        return okPayload(await host.evolve({ name, lesson, dryRun }));
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

function textOutput(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function defineTool(name, description, parameters, execute, render) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: render || ((_args, value) => textOutput(value)),
    },
    execute,
    timeoutMs: 60000,
  };
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

function optionalToolCwd(args, host) {
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

function optionalToolNames(value, max = 200) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new HarnessError('Argument "names" must be an array of skill names.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const names = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (names.length > max) {
    throw new HarnessError(`Argument "names" accepts at most ${max} entries.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return names.length > 0 ? names : null;
}

function summaryPortfolio(portfolio) {
  const skills = Array.isArray(portfolio.skills) ? portfolio.skills : [];
  return {
    generatedAt: portfolio.generatedAt ?? null,
    windowDays: portfolio.windowDays ?? null,
    sessionsScanned: portfolio.sessionsScanned ?? null,
    usageAvailable: portfolio.usageAvailable ?? false,
    totals: portfolio.totals ?? null,
    deltaAvg: portfolio.deltaAvg ?? null,
    skills: skills.map((report) => ({
      name: report.name,
      total: report.score?.total ?? null,
      // INTERFACE §5 names this field `score`; keep `total` too so both the
      // tool contract and the portfolio shape stay readable.
      score: report.score?.total ?? null,
      grade: report.score?.grade ?? null,
      confidence: report.score?.confidence ?? null,
      verdict: report.verdict?.code ?? null,
      verdictCode: report.verdict?.code ?? null,
      verdictLabel: report.verdict?.label ?? null,
      usage: {
        count: report.usage?.count ?? 0,
        lastUsedAt: report.usage?.lastUsedAt ?? null,
        perWeek: report.usage?.perWeek ?? null,
        sufficient: report.usage?.sufficient ?? false,
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
    overlaps: Array.isArray(portfolio.overlaps) ? portfolio.overlaps : [],
    quickWins: Array.isArray(portfolio.quickWins) ? portfolio.quickWins : [],
  };
}

function createTools(host) {
  const scanTool = defineTool(
    'skills360_scan',
    'Score every skill in the current DeepSeek Harness catalog end to end: catalog trigger surface, real usage, overlap with neighbours, progressive disclosure (SKILL.md size and references), actionability, boundary/governance, maintenance hygiene, and continuous evolution (lessons and closed-loop signals). Call it when the user asks to audit, score, inventory, or clean up their skills; asks why a skill never triggers; complains a description is too long, a SKILL.md is huge, or skills overlap; or wants to know which skills to merge/archive. detail="summary" (default) returns a compact per-skill list with totals, usage, verdict and the top finding; detail="full" returns the whole portfolio with metrics, findings and suggestions. cwd (absolute) scans project-local skills for that workspace; omit it for the global catalog.',
    {
      type: 'object',
      properties: {
        windowDays: { type: 'integer', description: 'Usage window in days (1-3650). Defaults to the plugin config (30).' },
        refresh: { type: 'boolean', description: 'Bypass the 60s scan cache and rescan now.' },
        cwd: { type: 'string', description: 'Absolute workspace path, to include that project\'s .dsh/skills and .agents/skills.' },
        detail: { type: 'string', enum: ['summary', 'full'], description: '"summary" (default) for compact scores, "full" for the complete portfolio.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const windowDays = optionalToolInteger(args, 'windowDays', host.config.windowDays, 3650);
      const cwd = optionalToolCwd(args, host);
      const detail = args && args.detail === 'full' ? 'full' : 'summary';
      const refresh = Boolean(args && (args.refresh === true || args.refresh === 'true'));
      const portfolio = await host.getPortfolio({ windowDays, cwd, refresh });
      return lossless(detail === 'full' ? portfolio : summaryPortfolio(portfolio));
    },
  );

  const reportTool = defineTool(
    'skills360_report',
    'Render the skills-360 health report as Chinese Markdown: per-skill scores, dimensions, findings, suggestions, overlaps, portfolio cost and quick wins. Call it when the user wants a readable/shareable audit, a before/after summary, or asks to export the skills report to a file (save=true writes it under $DSH_HOME/skills-360/reports and returns the path). Pass names to report on a subset; detail=false for the short table form.',
    {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Skill names to include; omit for all skills.' },
        detail: { type: 'boolean', description: 'Include per-skill detail. Defaults to true.' },
        save: { type: 'boolean', description: 'Also write the Markdown under $DSH_HOME/skills-360/reports. Defaults to false.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const offered = optionalToolNames(args && args.names);
      const portfolio = await host.getPortfolio({});
      let selected = portfolio;
      if (offered) {
        const byName = new Map((portfolio.skills || []).map((report) => [report.name, report]));
        const missing = offered.filter((name) => !byName.has(name));
        if (missing.length > 0) {
          throw new HarnessError(`Unknown skill name(s): ${missing.join(', ')}`, {
            code: 'not-found',
            status: 404,
          });
        }
        const chosen = offered.map((name) => byName.get(name));
        const names = new Set(chosen.map((report) => report.name));
        selected = {
          ...portfolio,
          skills: chosen,
          quickWins: (portfolio.quickWins || []).filter((win) => names.has(win.name)),
          overlaps: (portfolio.overlaps || []).filter((pair) => names.has(pair.a) && names.has(pair.b)),
          issues: {
            zeroUse: (portfolio.issues?.zeroUse || []).filter((name) => names.has(name)),
            truncated: (portfolio.issues?.truncated || []).filter((name) => names.has(name)),
            brokenLinks: (portfolio.issues?.brokenLinks || []).filter((item) => names.has(item.name)),
            dangerous: (portfolio.issues?.dangerous || []).filter((item) => names.has(item.name)),
          },
        };
      }
      const markdown = renderMarkdown(selected, { detail: args?.detail !== false });
      if (args && args.save === true) {
        const saved = await host.writeMarkdown(markdown);
        return { markdown, path: saved.path };
      }
      return { markdown };
    },
    (_args, value) => {
      if (value && typeof value.markdown === 'string') {
        const text = value.path ? `Saved to ${value.path}\n\n${value.markdown}` : value.markdown;
        return textOutput(text);
      }
      return textOutput(value);
    },
  );

  const optimizeTool = defineTool(
    'skills360_optimize',
    'Plan or apply the safe mechanical fixes that skills-360 suggests: link orphan references, extract oversized sections into references/, trim over-long descriptions, and front-load trigger sentences. Every write goes to a backup that can be undone. Call it when the user says "optimize/fix/clean up my skills", "apply the suggestions", "make the catalog cheaper", or wants to preview the fixes first (dryRun=true). safeOnly=true (default) applies only content-lossless auto actions; draft actions (description rewrite, boundary skeleton) are skipped unless safeOnly=false. Pass names and/or actionIds to narrow the scope. dryRun defaults to true and returns the plan without writing; pass dryRun=false to apply (after the user confirms). Use skills360_evolve to write a lesson back into a skill instead of fixing mechanics.',
    {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Skill names to optimize; omit for the whole catalog.' },
        actionIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these suggestion ids (from skills360_scan detail="full").' },
        safeOnly: { type: 'boolean', description: 'Only auto (content-lossless) actions. Defaults to true.' },
        dryRun: { type: 'boolean', description: 'Return the plan without writing anything. Defaults to true; pass false to write.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const safeOnly = !args || args.safeOnly !== false;
      // Preview by default: an agent tool that can rewrite every skill should
      // require an explicit dryRun=false before it touches real files.
      const dryRun = !args || args.dryRun !== false;
      const requestedNames = optionalToolNames(args && args.names);
      const requestedIds = args && args.actionIds !== undefined && args.actionIds !== null
        ? optionalActionIds(args.actionIds)
        : null;

      const portfolio = await host.getPortfolio({});
      const allReports = (portfolio.skills || []).filter((report) => report && report.name);
      let targets = allReports;
      if (requestedNames) {
        const byName = new Map(allReports.map((report) => [report.name, report]));
        const missing = requestedNames.filter((name) => !byName.has(name));
        if (missing.length > 0) {
          throw new HarnessError(`Unknown skill name(s): ${missing.join(', ')}`, {
            code: 'not-found',
            status: 404,
          });
        }
        targets = requestedNames.map((name) => byName.get(name));
      }

      if (requestedIds) {
        const known = new Set();
        for (const report of targets) {
          for (const suggestion of suggestionsOf(report)) known.add(suggestion.id);
        }
        const unknown = requestedIds.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          throw new HarnessError(
            `Unknown action id(s): ${unknown.join(', ')}. Use skills360_scan detail="full" to read current ids.`,
            { code: 'invalid-argument', status: 400 },
          );
        }
      }

      const skipped = [];
      if (dryRun) {
        const plans = [];
        for (const report of targets) {
          const ids = requestedIds
            ? requestedIds.filter((id) => suggestionsOf(report).some((item) => item.id === id))
            : eligibleActionIds(report, safeOnly);
          if (ids.length === 0) {
            skipped.push({ name: report.name, reason: 'no-eligible-actions' });
            continue;
          }
          try {
            const plan = await host.planOnly(report, ids);
            if (plan.actionIds.length === 0) {
              skipped.push({
                name: report.name,
                reason: 'no-executable-actions',
                skipped: plan.skipped,
              });
              continue;
            }
            plans.push(plan);
          } catch (error) {
            skipped.push({ name: report.name, reason: (error && error.message) || String(error) });
          }
        }
        return lossless({ dryRun: true, plans, skipped, totals: portfolio.totals ?? null });
      }

      const applied = [];
      const backupIds = [];
      for (const report of targets) {
        const ids = requestedIds
          ? requestedIds.filter((id) => suggestionsOf(report).some((item) => item.id === id))
          : eligibleActionIds(report, safeOnly);
        if (ids.length === 0) {
          skipped.push({ name: report.name, reason: 'no-eligible-actions' });
          continue;
        }
        try {
          const result = await host.applyActions(report.name, ids);
          applied.push({
            name: report.name,
            actionIds: result.actionIds,
            // INTERFACE §4 spells this key `actions`; keep both so the panel
            // and the tool contract can each read the shape they expect.
            actions: result.actionIds,
            beforeTotal: result.beforeTotal,
            afterTotal: result.afterTotal,
            backupId: result.backupId,
          });
          if (result.backupId) backupIds.push(result.backupId);
        } catch (error) {
          skipped.push({
            name: report.name,
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
    },
  );

  const evolveTool = defineTool(
    'skills360_evolve',
    'Write a hard-won lesson back into a skill\'s references/lessons.md so the next load reads it. Call it when the user says a skill just got it wrong / corrected you / asked you to remember this lesson in the skill, or when skills360_scan shows a skill with unclosed evolution signals (corrections, post-load errors, reloads, turn failures) that have no matching lesson yet. The signal and evidence are supplied by the plugin from local session logs; you write the lesson text (trigger -> concrete rule). dryRun defaults to true: it lists pending proposals (only hasUnclosed skills, <=10, highest pendingScore first, optionally filtered by names) without writing. Pass dryRun=false with name + lesson to write, which returns backupId/beforeTotal/afterTotal/evolution.',
    {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Only list proposals for these skill names (dryRun mode).' },
        name: { type: 'string', description: 'Skill to write a lesson for (required when dryRun=false).' },
        lesson: { type: 'object', description: '{ trigger, rule, evidence? } — trigger and rule required; evidence optional (a session id or note).' },
        dryRun: { type: 'boolean', description: 'Default true: list unclosed proposals. false writes a lesson.' },
        cwd: { type: 'string', description: 'Absolute workspace path for project-local skills.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const dryRun = !args || args.dryRun !== false;
      const cwd = optionalToolCwd(args, host);
      if (dryRun) {
        const requestedNames = optionalToolNames(args && args.names);
        const portfolio = await host.getPortfolio({ cwd });
        const proposals = [];
        for (const report of portfolio.skills || []) {
          const pending = report.evolution?.pending;
          if (!pending || pending.hasUnclosed !== true) continue;
          if (requestedNames && !requestedNames.includes(report.name)) continue;
          proposals.push({
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
        proposals.sort((a, b) => (b.pendingScore - a.pendingScore) || a.name.localeCompare(b.name));
        const result = {
          dryRun: true,
          proposals: proposals.slice(0, 10),
          totals: portfolio.totals?.evolution ?? null,
        };
        if (proposals.length === 0) {
          result.note = 'No skills have unclosed evolution signals right now.';
        }
        return lossless(result);
      }
      const name = args && typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) {
        throw new HarnessError('dryRun=false requires "name" (kebab-case skill name) and "lesson".', {
          code: 'invalid-argument',
          status: 400,
        });
      }
      const lesson = args && args.lesson;
      if (!lesson || typeof lesson !== 'object') {
        throw new HarnessError('dryRun=false requires a "lesson" object with trigger and rule.', {
          code: 'invalid-argument',
          status: 400,
        });
      }
      const result = await host.evolve({ name, lesson, dryRun: false, cwd });
      return lossless({
        dryRun: false,
        name,
        backupId: result.backupId,
        beforeTotal: result.beforeTotal,
        afterTotal: result.afterTotal,
        lesson: result.lesson,
        evolution: result.report?.evolution ?? null,
      });
    },
  );

  return [scanTool, reportTool, optimizeTool, evolveTool];
}

// ------------------------------------------------------------------ plugin

export const inject = ['skills', 'tools', 'webServer'];

export function apply(ctx, config = {}) {
  const normalized = normalizeConfig(config);
  const host = createHost(ctx, normalized);

  for (const definition of createTools(host)) {
    ctx.effect(() => ctx.tools.register(definition));
  }
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createRouteHandler(ctx, host),
    }),
  );
}

/**
 * Verification seam only: the path guards are the security boundary the Host
 * re-applies before any write, so the standalone verifier exercises them
 * directly (traversal, absolute paths, symlinked references).
 */
export const __internals = Object.freeze({
  assertSafeRelPath,
  ensureInsideReal,
  assertSafeReportFile,
  isInsideRoot,
  normalizeConfig,
  listSkillFiles,
});
