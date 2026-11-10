/**
 * Subject discovery for agents-360: instruction files, agent definitions and
 * profile presets. Pure filesystem walk — no network, no DSH services, no
 * throwing on unreadable directories.
 *
 * Three subject kinds (see INTERFACE.md §1):
 *   - instruction: AGENTS.md / CLAUDE.md / instructions.md
 *   - agent:       files under an `agents/` dir (or `.claude/agents`) with name/description
 *   - preset:      synthesized from the host's profile config, never read from disk
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { parseSkillMarkdown } from '../frontmatter.js';
import { slugify } from '../util.js';

const INSTRUCTION_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'instructions.md']);

// Directories that are never config and must not be traversed. `backups` and
// `Archive` come from the contract; the rest are high-volume caches/logs that
// would otherwise make a `~/.claude` walk explode (216 telemetry dirs, etc.).
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'Archive', 'backups', 'cache',
  'logs', 'telemetry', 'transcripts', 'sessions', 'file-history', '.Trash',
  'tmp', 'temp', '.turbo', 'coverage', '.next', '.cache', '.yarn',
]);

/**
 * Normalize a user-supplied root: expand `~`, resolve `.`/`..` to absolute.
 * @param {string} root
 * @returns {string}
 */
function normalizeRoot(root) {
  let value = String(root || '').trim();
  if (!value) return '';
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = join(homedir(), value.slice(2));
  }
  return resolve(value);
}

/** First path segment relative to `home`, or '' when equal. */
function homeTop(absolute, home) {
  const rel = relative(home, absolute);
  if (!rel) return '';
  return rel.split(sep)[0];
}

/**
 * Determine the scope of an instruction file. Home-level config directories
 * (`~/.agents`, `~/.deepseek`, `~/.claude`, …) are global; skill-local files
 * are skill scope; everything else is project scope.
 * @param {string} path absolute path
 * @returns {'global'|'project'|'skill'}
 */
export function scopeForInstruction(path, home = homedir()) {
  const top = homeTop(path, home);
  if (top && top.startsWith('.')) return 'global';
  if (/[/\\]skills[/\\]/.test(path)) return 'skill';
  return 'project';
}

/** Owner name when a file lives under `<…>/skills/<name>/…`. */
function skillOwner(path) {
  const match = /[/\\]skills[/\\]([^/\\]+)[/\\]/.exec(path);
  return match ? match[1] : null;
}

/**
 * Stable, routing-safe subject id: `${kind}:${slug}`.
 * @param {string} kind instruction|agent|preset
 * @param {string} path absolute path or null
 * @param {string} name subject name (agent/preset)
 * @returns {string}
 */
export function subjectId(kind, path, name) {
  if (kind === 'preset') return `preset:${slugify(name || 'preset', 'preset')}`;
  if (kind === 'agent') {
    return `agent:${slugify(name || basename(String(path || '')).replace(/\.md$/i, ''), 'agent')}`;
  }
  const dir = path ? dirname(path) : '';
  const base = basename(dir);
  const file = path ? basename(path).replace(/\.md$/i, '') : 'instructions';
  if (base.startsWith('.')) return `instr:home-${slugify(base.slice(1), 'home')}`;
  const owner = skillOwner(path || '');
  if (owner) return `instr:skill-${slugify(owner, 'skill')}`;
  return `instr:${slugify(`${relative(process.cwd(), dir)}-${file}`, 'instr')}`;
}

/** Best-effort frontmatter name/description for an agent file. */
function readAgentMeta(raw) {
  try {
    const parsed = parseSkillMarkdown(raw);
    return {
      name: typeof parsed.data.name === 'string' ? parsed.data.name.trim() : '',
      description: typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '',
    };
  } catch {
    // no `---` block: fall back to a plain `key:` scan of the first lines
  }
  const head = String(raw).split('\n').slice(0, 60).join('\n');
  const name = /^name\s*:\s*(.+)$/m.exec(head);
  const description = /^description\s*:\s*(.+)$/m.exec(head);
  return {
    name: name ? name[1].trim().replace(/^["']|["']$/g, '') : '',
    description: description ? description[1].trim() : '',
  };
}

async function walk(root, maxDepth, out, state) {
  const dirs = [root];
  const seen = state.seen;
  while (dirs.length > 0) {
    const dir = dirs.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const depth = state.depth.get(dir) ?? 0;
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const childDirs = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (depth + 1 > maxDepth) continue;
        childDirs.push(path);
        state.depth.set(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      await classifyFile(path, out, state, depth);
    }
    // breadth-first so shallow config wins deterministically
    dirs.push(...childDirs);
  }
}

async function classifyFile(path, out, state, depth) {
  const name = basename(path);
  const isAgentPath = /[/\\](?:\.claude[/\\])?agents[/\\]/.test(path);

  if (isAgentPath) {
    let raw;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return;
    }
    const meta = readAgentMeta(raw);
    if (!meta.name && !meta.description) return;
    out.push({
      kind: 'agent',
      name: meta.name || basename(path).replace(/\.md$/i, ''),
      description: meta.description || '',
      path,
      dir: dirname(path),
      owner: skillOwner(path),
      mtime: null,
      source: 'filesystem',
      scope: 'skill',
    });
    return;
  }

  if (INSTRUCTION_NAMES.has(name)) {
    out.push({
      kind: 'instruction',
      name,
      path,
      dir: dirname(path),
      owner: skillOwner(path),
      mtime: null,
      source: 'filesystem',
      scope: scopeForInstruction(path),
    });
  }
}

/** Fill mtime for discovered filesystem subjects (best effort). */
async function fillMtimes(subjects) {
  await Promise.all(subjects.map(async (subject) => {
    if (!subject.path) return;
    try {
      const info = await stat(subject.path);
      if (info.isFile()) subject.mtime = info.mtimeMs;
    } catch {
      // keep null
    }
  }));
}

/**
 * Synthesize preset subjects from the host's profile config. Accepts a single
 * object, an array, or `{ presets: [...] }`.
 * @param {unknown} profileConfig
 * @returns {object[]}
 */
function presetsFromProfileConfig(profileConfig, now) {
  if (!profileConfig) return [];
  const list = Array.isArray(profileConfig)
    ? profileConfig
    : Array.isArray(profileConfig.presets)
      ? profileConfig.presets
      : [profileConfig];
  return list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      kind: 'preset',
      name: String(entry.name || entry.preset || entry.id || 'default'),
      description: typeof entry.description === 'string' ? entry.description : '',
      config: entry.config || entry,
      path: null,
      dir: null,
      owner: null,
      mtime: Number(entry.mtime) || now,
      source: 'profile-config',
      scope: 'profile',
    }));
}

/**
 * Discover instruction and agent subjects under `roots`.
 * @param {{roots:string[], maxDepth?:number, now?:number, include?:string[], exclude?:string[], profileConfig?:unknown}} input
 * @returns {Promise<{kind:string,name:string,path:string|null,dir:string|null,owner:string|null,mtime:number|null,source:string,scope:string,description?:string}[]>}
 */
export async function discoverSubjects({
  roots,
  maxDepth = 4,
  now = Date.now(),
  include = [],
  exclude = [],
  profileConfig = null,
  standardRoots = true,
}) {
  const home = homedir();
  const standard = standardRoots ? [join(home, '.claude'), join(home, '.dsh', 'agents')] : [];
  const baseRoots = [...(Array.isArray(roots) ? roots : []), ...(Array.isArray(include) ? include : [])];
  const resolved = [...baseRoots.map(normalizeRoot).filter(Boolean), ...standard];
  const excludeSet = new Set(
    (Array.isArray(exclude) ? exclude : []).map(normalizeRoot).filter(Boolean),
  );
  const seen = new Set();
  const state = { seen, depth: new Map() };
  const out = [];

  for (const root of [...new Set(resolved)]) {
    if (!root || excludeSet.has(root)) continue;
    let info;
    try {
      info = await stat(root);
    } catch {
      continue;
    }
    if (!info.isDirectory()) {
      // a directly-passed file root (e.g. a single AGENTS.md)
      if (info.isFile() && /\.md$/i.test(root) && INSTRUCTION_NAMES.has(basename(root))) {
        out.push({
          kind: 'instruction', name: basename(root), path: root, dir: dirname(root),
          owner: skillOwner(root), mtime: info.mtimeMs, source: 'filesystem',
          scope: scopeForInstruction(root, home),
        });
      }
      continue;
    }
    state.depth.set(root, 0);
    await walk(root, maxDepth, out, state);
  }

  await fillMtimes(out);
  out.push(...presetsFromProfileConfig(profileConfig, now));

  // Two files can share a basename (e.g. several `code-reviewer.md` clones);
  // ids must stay unique or reports/backups/UI rows collide.
  const used = new Map();
  for (const subject of out) {
    if (subject.id) continue;
    const base = subjectId(subject.kind, subject.path, subject.name);
    const seenCount = used.get(base) || 0;
    used.set(base, seenCount + 1);
    subject.id = seenCount === 0
      ? base
      : `${base}-${createHash('sha1').update(String(subject.path || subject.name)).digest('hex').slice(0, 4)}`;
  }
  return out;
}

export { INSTRUCTION_NAMES, SKIP_DIRS };
