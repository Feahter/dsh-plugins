/**
 * Canonical task ledger: durable, human-readable, agent-agnostic state.
 *
 * The session is a run of a task; this module owns the task. Everything the
 * model must still know after a compaction, a restart, a model swap, or a
 * different agent goes through here, and nothing else.
 *
 * Design rules (see README):
 * - One canonical writer: a run leases a task before writing; writes without
 *   the current lease are refused, so two sessions cannot fork one task.
 * - Optimistic versioning: `state.version` increments on every accepted write,
 *   and callers may pass the version they read to detect a lost race.
 * - Append-only evidence: claims and decisions are never rewritten; a claim is
 *   resolved by appending a newer record with the same id, so refutations
 *   survive and the audit trail stays intact.
 * - Atomic commits: every file is written to a temp file in the same directory
 *   then renamed, so a crash never leaves a half-written charter or state.
 * - Fail-open at the edge, loud at the center: the plugin logs and reports
 *   failures, but a ledger problem never silently drops a run.
 *
 * All paths stay inside `<root>/tasks/<task-id>/`; ids and evidence names are
 * validated, so a hostile task id cannot escape the root.
 */

import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

export const STATUSES = ['open', 'blocked', 'done', 'archived'];
export const PHASES = ['intake', 'evidence', 'synthesis', 'delivery', 'closed'];
export const CLAIM_STATUSES = ['unverified', 'verified', 'refuted'];
export const EVIDENCE_GRADES = ['[图]', '[源]', '[文]', '[表]', '[推]', '[?]'];

const TASK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const RUN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SLUG_RE = /[^a-z0-9]+/g;
const MAX_INLINE_TEXT = 4 * 1024 * 1024; // 4 MiB of inline evidence per call
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

export class LedgerError extends Error {
  constructor(message, { code = 'ledger-error', hint = '', details = undefined } = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.hint = hint;
    if (details !== undefined) this.details = details;
  }
}

// ---------------------------------------------------------------- primitives

export function nowIso(date = new Date()) {
  return date.toISOString();
}

export function resolveRoot(config = {}) {
  const fromConfig = typeof config.rootDir === 'string' ? config.rootDir.trim() : '';
  if (fromConfig) return path.resolve(expandHome(fromConfig));
  const fromEnv = process.env.DSH_TASK_LEDGER_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(expandHome(fromEnv.trim()));
  return path.join(homedir(), '.dsh', 'task-ledger');
}

function expandHome(input) {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return path.join(homedir(), input.slice(2));
  return input;
}

export function slugify(input, fallback = 'task', maxLength = 48) {
  const slug = String(input || '')
    .toLowerCase()
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function assertTaskId(taskId) {
  if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) {
    throw new LedgerError(`Invalid task_id: ${JSON.stringify(taskId)}`, {
      code: 'invalid-task-id',
      hint: 'task_id must match /^[a-z0-9][a-z0-9._-]{0,79}$/; list ids with task_list.',
    });
  }
  return taskId;
}

function assertRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
    throw new LedgerError(`Invalid run_id: ${JSON.stringify(runId)}`, {
      code: 'invalid-run-id',
      hint: 'Use the run_id returned by task_resume for this run.',
    });
  }
  return runId;
}

function taskDir(root, taskId) {
  return path.join(root, 'tasks', assertTaskId(taskId));
}

function safeFileName(input) {
  const base = path.basename(String(input || 'evidence')).replace(/[^A-Za-z0-9._-]+/g, '-');
  const trimmed = base.replace(/^[.-]+/, '').slice(0, 80);
  return trimmed || 'evidence';
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(file, fallback = '') {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readJsonFile(file, fallback = null) {
  const text = await readTextFile(file, '');
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new LedgerError(`Corrupt JSON at ${file}: ${error.message}`, {
      code: 'corrupt-ledger',
      hint: 'Inspect the file; append-only logs can be repaired without losing history.',
    });
  }
}

export async function atomicWriteText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  await fs.writeFile(tmp, text, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function atomicWriteJson(file, value) {
  await atomicWriteText(file, JSON.stringify(value, null, 2) + '\n');
}

async function appendJsonl(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
}

async function readJsonl(file) {
  const text = await readTextFile(file, '');
  const records = [];
  const warnings = [];
  let index = 0;
  for (const line of text.split('\n')) {
    index += 1;
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
      else warnings.push(`line ${index}: not an object`);
    } catch {
      warnings.push(`line ${index}: unparsable JSON`);
    }
  }
  return { records, warnings };
}

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function uniqueId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process mutual exclusion per task directory. The lock file is created
 * with O_EXCL and carries its owner and timestamp; a stale lock (crashed run,
 * > LOCK_STALE_MS) is reclaimed, and the wait is bounded so a stuck writer
 * surfaces as an error instead of a hang.
 */
async function withTaskLock(taskPath, fn) {
  const lockPath = path.join(taskPath, '.write.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let handle = null;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, 'wx');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new LedgerError(`No task ledger at ${path.basename(taskPath)}.`, {
          code: 'task-not-found',
          hint: 'Call task_list to see known task ids.',
        });
      }
      if (!error || error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const stat = await fs.stat(lockPath);
        stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = false; // released between open and stat; retry immediately
      }
      if (stale) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() > deadline) {
        throw new LedgerError('Another writer holds this task ledger lock.', {
          code: 'ledger-busy',
          hint: 'Wait for the other run to finish, or raise ledger.lockTimeoutMs.',
        });
      }
      await sleep(25 + Math.floor(Math.random() * 25));
      continue;
    }
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: nowIso(), token: randomUUID() }),
        'utf8',
      );
      return await fn();
    } finally {
      await handle.close().catch(() => {});
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
  }
  throw new LedgerError('Unreachable ledger lock state.', { code: 'ledger-busy' });
}

// ------------------------------------------------------------------- audit

export async function appendAudit(root, entry) {
  const record = { at: nowIso(), ...entry };
  try {
    await appendJsonl(path.join(root, 'audit.jsonl'), record);
  } catch {
    // Audit is best-effort: never let logging break a run.
  }
  return record;
}

// ----------------------------------------------------------------- creation

function normalizeStringList(value, field) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) {
    throw new LedgerError(`${field} must be an array of strings.`, { code: 'invalid-argument' });
  }
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
}

function requireText(value, field, { max = 20_000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new LedgerError(`${field} is required.`, { code: 'invalid-argument' });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return trimmed.slice(0, max);
  }
  return trimmed;
}

function defaultState(taskId, at) {
  return {
    schema_version: SCHEMA_VERSION,
    task_id: taskId,
    phase: 'intake',
    status: 'open',
    open_questions: [],
    next_actions: [],
    blocked_reason: null,
    last_run_id: null,
    lease: null,
    version: 1,
    updated_at: at,
  };
}

export async function createTask(root, input = {}, config = {}) {
  const title = requireText(input.title, 'title', { max: 200 });
  const goal = requireText(input.goal, 'goal', { max: 8_000 });
  const at = nowIso();

  const charter = {
    schema_version: SCHEMA_VERSION,
    task_id: '',
    title,
    goal,
    research_questions: normalizeStringList(input.research_questions, 'research_questions'),
    acceptance: normalizeStringList(input.acceptance, 'acceptance'),
    evidence_bar: typeof input.evidence_bar === 'string' && input.evidence_bar.trim()
      ? input.evidence_bar.trim()
      : 'Primary sources preferred; record source_ref and evidence_hash for every verified claim.',
    budget: typeof input.budget === 'object' && input.budget ? input.budget : {},
    owner: typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim() : 'lead-agent',
    tags: normalizeStringList(input.tags, 'tags'),
    created_at: at,
    updated_at: at,
  };

  // The task directory is claimed with a non-recursive mkdir: that is the
  // atomic "reserve this id" step. It makes two concurrent opens of the same
  // title resolve to distinct ids instead of silently overwriting a charter,
  // and it makes an explicit duplicate id a hard error rather than last-writer
  // wins. A charter is immutable, so nothing may ever overwrite task.json.
  const tasksRoot = path.join(root, 'tasks');
  await fs.mkdir(tasksRoot, { recursive: true });
  const explicitId = typeof input.task_id === 'string' && input.task_id.trim()
    ? assertTaskId(input.task_id.trim())
    : null;
  let taskId = null;
  let dir = null;
  if (explicitId) {
    dir = taskDir(root, explicitId);
    try {
      await fs.mkdir(dir);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw new LedgerError(`Task ${explicitId} already exists; charters are immutable.`, {
          code: 'task-exists',
          hint: 'Omit task_id to allocate a new one, or task_resume the existing task.',
        });
      }
      throw error;
    }
    taskId = explicitId;
  } else {
    const day = at.slice(0, 10);
    const base = `${day}-${slugify(title)}`;
    for (let suffix = 1; suffix <= 200 && !dir; suffix += 1) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      const candidateDir = path.join(tasksRoot, assertTaskId(candidate));
      try {
        await fs.mkdir(candidateDir);
        dir = candidateDir;
        taskId = candidate;
      } catch (error) {
        if (error && error.code === 'EEXIST') continue;
        throw error;
      }
    }
    if (!dir) {
      throw new LedgerError(`Could not allocate a unique task id for "${title}".`, { code: 'id-exhausted' });
    }
  }

  try {
    charter.task_id = taskId;
    await fs.mkdir(path.join(dir, 'runs'));
    await fs.mkdir(path.join(dir, 'evidence'));
    await fs.mkdir(path.join(dir, 'artifacts'));

    const state = defaultState(taskId, at);
    await atomicWriteJson(path.join(dir, 'task.json'), charter);
    await atomicWriteJson(path.join(dir, 'state.json'), state);
    await appendJsonl(path.join(dir, 'decisions.jsonl'), {
      id: uniqueId('dec'),
      decision: 'Task opened.',
      rationale: 'Charter created; work begins from this ledger entry.',
      rejected: [],
      evidence_grade: '[?]',
      approved_by: charter.owner,
      at,
      run_id: null,
    });

    await (await import('./index-md.js')).regenerateIndex(root, config).catch(() => {});
    await appendAudit(root, { event: 'task_open', task_id: taskId, detail: { title } });
    return { charter, state };
  } catch (error) {
    // Do not leave a claimed id behind with a half-written charter.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

// ------------------------------------------------------------ read / resume

function resolveClaims(records) {
  const byId = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== 'string') continue;
    const previous = byId.get(record.id);
    byId.set(record.id, {
      ...record,
      revisions: (previous?.revisions || 0) + 1,
      first_at: previous?.first_at || record.at || null,
    });
  }
  return [...byId.values()].sort((a, b) => String(a.first_at || '').localeCompare(String(b.first_at || '')));
}

function latestRuns(runRecords, limit = 10) {
  // A run is recorded twice by design: an "open" stub at resume and a closed
  // record at close. Fold them by run_id so counts and handoffs stay truthful.
  const byId = new Map();
  for (const run of runRecords) {
    if (!run || typeof run.run_id !== 'string') continue;
    const previous = byId.get(run.run_id);
    if (!previous) {
      byId.set(run.run_id, run);
      continue;
    }
    byId.set(run.run_id, {
      ...previous,
      ...run,
      started_at: previous.started_at || run.started_at || null,
      ended_at: run.ended_at || previous.ended_at || null,
      summary: run.summary || previous.summary || null,
      status_after: run.status_after || previous.status_after || null,
      next_actions: run.next_actions && run.next_actions.length ? run.next_actions : previous.next_actions || [],
    });
  }
  return [...byId.values()]
    .sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')))
    .slice(-limit);
}

export async function readTask(root, taskId) {
  const dir = taskDir(root, taskId);
  const charter = await readJsonFile(path.join(dir, 'task.json'), null);
  if (!charter) {
    throw new LedgerError(`No task ledger named ${taskId}.`, {
      code: 'task-not-found',
      hint: 'Call task_list to see known task ids.',
    });
  }
  const state = (await readJsonFile(path.join(dir, 'state.json'), null)) || defaultState(taskId, nowIso());
  const claimsRaw = await readJsonl(path.join(dir, 'claims.jsonl'));
  const decisionsRaw = await readJsonl(path.join(dir, 'decisions.jsonl'));
  const evidenceRaw = await readJsonl(path.join(dir, 'evidence', 'index.jsonl'));
  const runsRaw = await readJsonl(path.join(dir, 'runs', 'index.jsonl'));

  const claims = resolveClaims(claimsRaw.records);
  const decisions = decisionsRaw.records;
  const evidence = evidenceRaw.records;
  const runs = latestRuns(runsRaw.records);

  const warnings = [...claimsRaw.warnings, ...decisionsRaw.warnings, ...evidenceRaw.warnings, ...runsRaw.warnings];
  return { charter, state, claims, decisions, evidence, runs, warnings };
}

export function summarizeTask({ charter, state, claims, evidence, runs }) {
  const counts = { verified: 0, refuted: 0, unverified: 0 };
  for (const claim of claims) {
    const status = CLAIM_STATUSES.includes(claim.status) ? claim.status : 'unverified';
    counts[status] += 1;
  }
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  return {
    task_id: charter.task_id,
    title: charter.title,
    goal: charter.goal,
    status: state.status,
    phase: state.phase,
    tags: Array.isArray(charter.tags) ? charter.tags : [],
    created_at: charter.created_at,
    updated_at: state.updated_at,
    next_actions: Array.isArray(state.next_actions) ? state.next_actions : [],
    open_questions: Array.isArray(state.open_questions) ? state.open_questions : [],
    blocked_reason: state.blocked_reason || null,
    claim_count: claims.length,
    claim_counts: counts,
    evidence_count: evidence.length,
    run_count: runs.length,
    last_run_id: state.last_run_id || (lastRun ? lastRun.run_id : null),
    version: state.version,
    owner: charter.owner,
  };
}

export async function listTasks(root, { status = 'all', limit = 100 } = {}) {
  const tasksRoot = path.join(root, 'tasks');
  let entries = [];
  try {
    entries = await fs.readdir(tasksRoot, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return { tasks: [], warnings: [] };
    throw error;
  }
  const summaries = [];
  const warnings = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TASK_ID_RE.test(entry.name)) continue;
    try {
      const task = await readTask(root, entry.name);
      const summary = summarizeTask(task);
      if (status === 'all' || summary.status === status) summaries.push(summary);
      for (const warning of task.warnings) warnings.push(`${entry.name}: ${warning}`);
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }
  summaries.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return { tasks: summaries.slice(0, limit), warnings };
}

export async function getActiveTaskId(root) {
  const record = await readJsonFile(path.join(root, 'active.json'), null);
  return record && typeof record.task_id === 'string' ? record.task_id : null;
}

export async function setActiveTaskId(root, taskId, { sessionId = null } = {}) {
  const file = path.join(root, 'active.json');
  if (taskId === null) {
    await atomicWriteJson(file, { task_id: null, updated_at: nowIso(), session_id: sessionId });
    await appendAudit(root, { event: 'active_task_cleared', session_id: sessionId });
    return null;
  }
  assertTaskId(taskId);
  await readTask(root, taskId); // presence check
  await atomicWriteJson(file, { task_id: taskId, updated_at: nowIso(), session_id: sessionId });
  await appendAudit(root, { event: 'active_task_set', task_id: taskId, session_id: sessionId });
  return taskId;
}

function leaseExpiry(ttlSeconds) {
  return new Date(Date.now() + Math.max(60, ttlSeconds) * 1000).toISOString();
}

function leaseIsExpired(lease) {
  if (!lease || typeof lease.expires_at !== 'string') return true;
  const expires = Date.parse(lease.expires_at);
  return Number.isNaN(expires) || expires <= Date.now();
}

/**
 * Bind a run to a task: read the canonical state, take or renew the write
 * lease, and return the snapshot a fresh session needs to continue. A live
 * lease held by another run is a hard stop, because two writers on one ledger
 * is exactly the double-track drift this design exists to prevent.
 */
export async function resumeTask(root, taskId, { sessionId = null, label = '', leaseTtlSeconds = 3600, bind = true } = {}) {
  assertTaskId(taskId);
  const dir = taskDir(root, taskId);
  const runId = `run-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`;
  const snapshot = await withTaskLock(dir, async () => {
    const task = await readTask(root, taskId);
    const lease = task.state.lease;
    const heldElsewhere =
      lease && !leaseIsExpired(lease) && lease.run_id && lease.run_id !== runId && lease.session_id !== sessionId;
    if (heldElsewhere) {
      throw new LedgerError(
        `Task ${taskId} is leased by ${lease.session_id || lease.run_id} until ${lease.expires_at}.`,
        {
          code: 'task-leased',
          hint: 'Wait for the holder to close its run, or resume after the lease expires.',
          details: { lease },
        },
      );
    }
    const at = nowIso();
    task.state.lease = {
      run_id: runId,
      session_id: sessionId,
      label: label || null,
      acquired_at: at,
      expires_at: leaseExpiry(leaseTtlSeconds),
    };
    task.state.version = Number(task.state.version || 0) + 1;
    task.state.updated_at = at;
    task.state.last_run_id = runId;
    await atomicWriteJson(path.join(dir, 'state.json'), task.state);
    return { ...task, run_id: runId };
  });

  if (bind) {
    await setActiveTaskId(root, taskId, { sessionId });
    await appendJsonl(path.join(dir, 'runs', 'index.jsonl'), {
      run_id: runId,
      task_id: taskId,
      session_id: sessionId,
      started_at: nowIso(),
      ended_at: null,
      summary: null,
      status_after: null,
      next_actions: [],
    }).catch(() => {});
    // Root-level run -> task binding: lets a write resolve its task from the
    // run id alone, and lets the panel show who last touched a task.
    await appendJsonl(path.join(root, 'runs.jsonl'), {
      run_id: runId,
      task_id: taskId,
      session_id: sessionId,
      at: nowIso(),
    }).catch(() => {});
  }
  await appendAudit(root, { event: 'task_resume', task_id: taskId, run_id: runId, session_id: sessionId });
  return {
    run_id: runId,
    lease: snapshot.state.lease,
    charter: snapshot.charter,
    state: snapshot.state,
    claims: snapshot.claims,
    decisions: snapshot.decisions,
    evidence: snapshot.evidence,
    runs: snapshot.runs,
    warnings: snapshot.warnings,
  };
}

function requireLease(state, runId) {
  const lease = state.lease;
  if (!lease || !lease.run_id) {
    throw new LedgerError('No active lease on this task.', {
      code: 'no-lease',
      hint: 'Call task_resume first; it returns the run_id that owns this run\'s writes.',
    });
  }
  if (lease.run_id !== runId) {
    throw new LedgerError(`Lease belongs to ${lease.run_id}, not ${runId}.`, {
      code: 'lease-mismatch',
      hint: 'Only the run that resumed the task may write it; resume again to take over.',
      details: { lease },
    });
  }
  if (leaseIsExpired(lease)) {
    throw new LedgerError('This run\'s lease expired.', {
      code: 'lease-expired',
      hint: 'Call task_resume to renew the lease before writing.',
    });
  }
}

function assertVersion(state, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) return;
  if (Number(expectedVersion) !== Number(state.version)) {
    throw new LedgerError(`Version conflict: expected ${expectedVersion}, current ${state.version}.`, {
      code: 'version-conflict',
      hint: `Use expected_version=${state.version} (or omit it) and re-apply the change on top of the current state. task_resume bumps the version, so do not reuse a value read before resuming.`,
      details: { current_version: state.version },
    });
  }
}

function normalizeClaim(input, runId, at, index) {
  if (!input || typeof input !== 'object') {
    throw new LedgerError('Each claim must be an object.', { code: 'invalid-argument' });
  }
  const claim = requireText(input.claim, `claims[${index}].claim`);
  const status = input.status === undefined ? 'unverified' : String(input.status);
  if (!CLAIM_STATUSES.includes(status)) {
    throw new LedgerError(`claims[${index}].status must be one of ${CLAIM_STATUSES.join(', ')}.`, {
      code: 'invalid-argument',
    });
  }
  const confidence = input.confidence === undefined ? null : Number(input.confidence);
  if (confidence !== null && (Number.isNaN(confidence) || confidence < 0 || confidence > 1)) {
    throw new LedgerError(`claims[${index}].confidence must be between 0 and 1.`, {
      code: 'invalid-argument',
    });
  }
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : uniqueId('claim'),
    claim,
    status,
    confidence,
    source_ref: typeof input.source_ref === 'string' ? input.source_ref.trim() : '',
    evidence_hash: typeof input.evidence_hash === 'string' ? input.evidence_hash.trim() : '',
    evidence_name: typeof input.evidence_name === 'string' ? input.evidence_name.trim() : '',
    note: typeof input.note === 'string' ? input.note.trim() : '',
    run_id: runId,
    at,
  };
}

function normalizeDecision(input, runId, at, index) {
  if (!input || typeof input !== 'object') {
    throw new LedgerError('Each decision must be an object.', { code: 'invalid-argument' });
  }
  const decision = requireText(input.decision, `decisions[${index}].decision`);
  const grade = typeof input.evidence_grade === 'string' && input.evidence_grade.trim()
    ? input.evidence_grade.trim()
    : '[?]';
  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : uniqueId('dec'),
    decision,
    rationale: typeof input.rationale === 'string' ? input.rationale.trim() : '',
    rejected: normalizeStringList(input.rejected, `decisions[${index}].rejected`),
    evidence_grade: grade,
    approved_by: typeof input.approved_by === 'string' && input.approved_by.trim()
      ? input.approved_by.trim()
      : 'lead-agent',
    run_id: runId,
    at,
  };
}

function normalizeEvidence(input, index) {
  if (!input || typeof input !== 'object') {
    throw new LedgerError('Each evidence item must be an object.', { code: 'invalid-argument' });
  }
  const hasContent = typeof input.content === 'string' && input.content.length > 0;
  const hasPath = typeof input.file_path === 'string' && input.file_path.trim();
  if (!hasContent && !hasPath) {
    throw new LedgerError(`evidence[${index}] needs "content" or "file_path" so the snapshot is reproducible.`, {
      code: 'invalid-argument',
    });
  }
  if (hasContent && input.content.length > MAX_INLINE_TEXT) {
    throw new LedgerError(`evidence[${index}] content exceeds ${MAX_INLINE_TEXT} bytes; write it to a file first.`, {
      code: 'invalid-argument',
    });
  }
  return {
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '',
    url: typeof input.url === 'string' ? input.url.trim() : '',
    mime: typeof input.mime === 'string' && input.mime.trim() ? input.mime.trim() : 'text/plain',
    note: typeof input.note === 'string' ? input.note.trim() : '',
    content: hasContent ? input.content : null,
    file_path: hasPath ? input.file_path.trim() : null,
  };
}

async function storeEvidence(root, taskId, runId, inputs, at) {
  const records = [];
  const dir = path.join(taskDir(root, taskId), 'evidence');
  await fs.mkdir(dir, { recursive: true });
  for (let index = 0; index < inputs.length; index += 1) {
    const item = normalizeEvidence(inputs[index], index);
    const bytes = item.content !== null ? Buffer.from(item.content, 'utf8') : await fs.readFile(item.file_path);
    const digest = sha256(bytes);
    const originalName = item.name || (item.url ? path.basename(new URL(item.url, 'https://x/').pathname) : 'evidence');
    const ext = path.extname(safeFileName(originalName)) || mimeExtension(item.mime);
    const storedName = `${digest.slice(0, 12)}-${safeFileName(path.basename(originalName, path.extname(originalName)))}${ext}`;
    await fs.writeFile(path.join(dir, storedName), bytes);
    const record = {
      name: storedName,
      title: item.name || originalName,
      url: item.url,
      mime: item.mime,
      sha256: digest,
      bytes: bytes.length,
      fetched_at: at,
      run_id: runId,
      note: item.note,
    };
    await appendJsonl(path.join(dir, 'index.jsonl'), record);
    records.push(record);
  }
  return records;
}

function mimeExtension(mime) {
  const table = {
    'text/html': '.html',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'application/json': '.json',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  return table[String(mime || '').toLowerCase()] || '.txt';
}

export function checkEvidenceGate(claims, charter = {}) {
  const unverified = claims.filter((claim) => claim.status === 'unverified');
  const verifiedWithoutSource = claims.filter(
    (claim) => claim.status === 'verified' && !claim.evidence_hash && !claim.source_ref,
  );
  const checks = [
    {
      name: 'claims-resolved',
      ok: unverified.length === 0,
      detail: unverified.length ? `${unverified.length} claim(s) still unverified` : 'every claim has a resolved status',
      claim_ids: unverified.map((claim) => claim.id),
    },
    {
      name: 'verified-claims-cite-evidence',
      ok: verifiedWithoutSource.length === 0,
      detail: verifiedWithoutSource.length
        ? `${verifiedWithoutSource.length} verified claim(s) cite no evidence`
        : 'verified claims carry source_ref or evidence_hash',
      claim_ids: verifiedWithoutSource.map((claim) => claim.id),
    },
  ];
  return {
    pass: checks.every((check) => check.ok),
    checks,
    evidence_bar: charter.evidence_bar || null,
  };
}

/**
 * One write entry point for the run: append claims/decisions/evidence, patch
 * the mutable state, and bump the version atomically. Everything is validated
 * before the first byte is written.
 */
export async function checkpointTask(root, taskId, runId, patch = {}, config = {}) {
  assertTaskId(taskId);
  assertRunId(runId);
  const dir = taskDir(root, taskId);
  const at = nowIso();
  const claimsInput = Array.isArray(patch.claims) ? patch.claims : [];
  const decisionsInput = Array.isArray(patch.decisions) ? patch.decisions : [];
  const evidenceInput = Array.isArray(patch.evidence) ? patch.evidence : [];
  const claims = claimsInput.map((item, index) => normalizeClaim(item, runId, at, index));
  const decisions = decisionsInput.map((item, index) => normalizeDecision(item, runId, at, index));

  const result = await withTaskLock(dir, async () => {
    const task = await readTask(root, taskId);
    requireLease(task.state, runId);
    assertVersion(task.state, patch.expected_version);
    const state = task.state;

    if (patch.phase !== undefined) {
      const phase = String(patch.phase);
      if (!PHASES.includes(phase)) {
        throw new LedgerError(`phase must be one of ${PHASES.join(', ')}.`, { code: 'invalid-argument' });
      }
      state.phase = phase;
    }
    if (patch.status !== undefined) {
      const status = String(patch.status);
      if (!['open', 'blocked'].includes(status)) {
        throw new LedgerError('task_checkpoint may set status to "open" or "blocked" only; use task_close to finish.', {
          code: 'invalid-argument',
        });
      }
      state.status = status;
      state.blocked_reason = status === 'blocked'
        ? (typeof patch.blocked_reason === 'string' && patch.blocked_reason.trim() ? patch.blocked_reason.trim() : state.blocked_reason)
        : null;
    } else if (patch.blocked_reason !== undefined) {
      state.blocked_reason = typeof patch.blocked_reason === 'string' && patch.blocked_reason.trim()
        ? patch.blocked_reason.trim()
        : null;
    }
    if (patch.open_questions !== undefined) {
      state.open_questions = normalizeStringList(patch.open_questions, 'open_questions');
    }
    if (patch.next_actions !== undefined) {
      state.next_actions = normalizeStringList(patch.next_actions, 'next_actions');
    }
    if (typeof patch.note === 'string' && patch.note.trim()) {
      decisions.push(normalizeDecision({ decision: patch.note, rationale: 'run note' }, runId, at, decisions.length));
    }

    const storedEvidence = await storeEvidence(root, taskId, runId, evidenceInput, at);
    for (const claim of claims) {
      if (!claim.evidence_hash && claim.evidence_name) {
        const found = storedEvidence.find((item) => item.name === claim.evidence_name || item.title === claim.evidence_name);
        if (found) claim.evidence_hash = `sha256:${found.sha256}`;
      }
      await appendJsonl(path.join(dir, 'claims.jsonl'), claim);
    }
    for (const decision of decisions) {
      await appendJsonl(path.join(dir, 'decisions.jsonl'), decision);
    }

    state.lease.expires_at = leaseExpiry(Number(config.leaseTtlSeconds) || 3600);
    state.version = Number(state.version || 0) + 1;
    state.updated_at = at;
    await atomicWriteJson(path.join(dir, 'state.json'), state);

    const claimsAfter = resolveClaims([...task.claims, ...claims]);
    return {
      state,
      claims: claimsAfter,
      appended: { claims: claims.length, decisions: decisions.length, evidence: storedEvidence.length },
      evidence: storedEvidence,
      gate: checkEvidenceGate(claimsAfter, task.charter),
    };
  });

  await appendAudit(root, {
    event: 'task_checkpoint',
    task_id: taskId,
    run_id: runId,
    detail: { version: result.state.version, appended: result.appended },
  });
  const { regenerateIndex } = await import('./index-md.js');
  await regenerateIndex(root, config).catch(() => {});
  return result;
}

/**
 * Close the run: write the machine summary and the human handoff report,
 * apply the evidence gate, update state, release the lease, regenerate the
 * index. `status` defaults to "done"; a failing gate downgrades the outcome to
 * "blocked" unless the caller explicitly forces the override, which is
 * recorded as a decision instead of being swallowed.
 */
export async function closeTask(root, taskId, runId, input = {}, config = {}) {
  assertTaskId(taskId);
  assertRunId(runId);
  const dir = taskDir(root, taskId);
  const at = nowIso();
  const summary = requireText(input.summary || input.report, 'summary', { max: 8_000 });
  const nextActions = normalizeStringList(input.next_actions, 'next_actions');
  const openQuestions = normalizeStringList(input.open_questions, 'open_questions');
  const findings = normalizeStringList(input.findings, 'findings');
  const failures = normalizeStringList(input.failures, 'failures');
  const force = input.force === true;
  const claimsInput = Array.isArray(input.claims) ? input.claims : [];
  const decisionsInput = Array.isArray(input.decisions) ? input.decisions : [];
  const evidenceInput = Array.isArray(input.evidence) ? input.evidence : [];
  const claims = claimsInput.map((item, index) => normalizeClaim(item, runId, at, index));
  const decisions = decisionsInput.map((item, index) => normalizeDecision(item, runId, at, index));

  const result = await withTaskLock(dir, async () => {
    const task = await readTask(root, taskId);
    requireLease(task.state, runId);
    assertVersion(task.state, input.expected_version);
    const storedEvidence = await storeEvidence(root, taskId, runId, evidenceInput, at);
    for (const claim of claims) {
      if (!claim.evidence_hash && claim.evidence_name) {
        const found = storedEvidence.find((item) => item.name === claim.evidence_name || item.title === claim.evidence_name);
        if (found) claim.evidence_hash = `sha256:${found.sha256}`;
      }
      await appendJsonl(path.join(dir, 'claims.jsonl'), claim);
    }
    for (const decision of decisions) {
      await appendJsonl(path.join(dir, 'decisions.jsonl'), decision);
    }

    const claimsAfter = resolveClaims([...task.claims, ...claims]);
    const gate = checkEvidenceGate(claimsAfter, task.charter);
    let status = 'done';
    if (input.status === 'blocked') status = 'blocked';
    if (status === 'done' && !gate.pass && !force) status = 'blocked';
    if (status === 'done' && !gate.pass && force) {
      await appendJsonl(path.join(dir, 'decisions.jsonl'), normalizeDecision({
        decision: 'Closed as done despite a failing evidence gate (explicit override).',
        rationale: `Gate checks: ${gate.checks.map((check) => `${check.name}=${check.ok}`).join(', ')}`,
        rejected: [],
        evidence_grade: '[?]',
        approved_by: 'caller-force',
      }, runId, at, 0));
    }

    const runRecord = {
      run_id: runId,
      task_id: taskId,
      session_id: task.state.lease?.session_id || null,
      started_at: (task.runs.find((run) => run.run_id === runId) || {}).started_at || task.state.lease?.acquired_at || at,
      ended_at: at,
      summary,
      findings,
      failures,
      next_actions: nextActions,
      open_questions: openQuestions,
      claims_added: claims.length,
      decisions_added: decisions.length,
      evidence_added: storedEvidence.length,
      gate,
      status_after: status,
    };
    await atomicWriteJson(path.join(dir, 'runs', `${runId}.json`), runRecord);
    await atomicWriteText(path.join(dir, 'runs', `${runId}.md`), renderRunReport(runRecord, task.charter));
    await appendJsonl(path.join(dir, 'runs', 'index.jsonl'), {
      run_id: runId,
      task_id: taskId,
      session_id: runRecord.session_id,
      started_at: runRecord.started_at,
      ended_at: at,
      summary,
      status_after: status,
      next_actions: nextActions,
    });

    const state = task.state;
    state.status = status;
    state.phase = status === 'done' ? 'closed' : state.phase === 'closed' ? 'delivery' : state.phase;
    state.next_actions = nextActions;
    state.open_questions = openQuestions;
    state.blocked_reason = status === 'blocked'
      ? (typeof input.blocked_reason === 'string' && input.blocked_reason.trim()
        ? input.blocked_reason.trim()
        : status === 'blocked' && !gate.pass ? 'Evidence gate failed: resolve unverified claims or cite evidence.' : state.blocked_reason)
      : null;
    state.last_run_id = runId;
    state.lease = null;
    state.version = Number(state.version || 0) + 1;
    state.updated_at = at;
    await atomicWriteJson(path.join(dir, 'state.json'), state);

    return { state, run: runRecord, claims: claimsAfter, evidence: storedEvidence, gate, appended: { claims: claims.length, decisions: decisions.length, evidence: storedEvidence.length } };
  });

  const activeTaskId = await getActiveTaskId(root).catch(() => null);
  if (activeTaskId === taskId && result.state.status !== 'open' && result.state.status !== 'blocked') {
    await setActiveTaskId(root, null).catch(() => {});
  }
  const { regenerateIndex } = await import('./index-md.js');
  await regenerateIndex(root, config).catch(() => {});
  await appendAudit(root, {
    event: 'task_close',
    task_id: taskId,
    run_id: runId,
    detail: { status: result.state.status, gate: result.gate.pass, forced: force },
  });
  return result;
}

export function renderRunReport(run, charter) {
  const lines = [];
  lines.push(`# Run ${run.run_id} — ${charter.title}`);
  lines.push('');
  lines.push(`- task: \`${run.task_id}\``);
  lines.push(`- session: \`${run.session_id || 'unknown'}\``);
  lines.push(`- window: ${run.started_at} → ${run.ended_at}`);
  lines.push(`- outcome: **${run.status_after}**`);
  lines.push(`- evidence gate: ${run.gate.pass ? 'pass' : 'fail'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(run.summary || '(none)');
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  lines.push(run.findings.length ? run.findings.map((item) => `- ${item}`).join('\n') : '- (none recorded)');
  lines.push('');
  lines.push('## Failures');
  lines.push('');
  lines.push(run.failures.length ? run.failures.map((item) => `- ${item}`).join('\n') : '- (none recorded)');
  lines.push('');
  lines.push('## Next actions');
  lines.push('');
  lines.push(run.next_actions.length ? run.next_actions.map((item) => `- [ ] ${item}`).join('\n') : '- (none)');
  lines.push('');
  lines.push('## Open questions');
  lines.push('');
  lines.push(run.open_questions.length ? run.open_questions.map((item) => `- ${item}`).join('\n') : '- (none)');
  lines.push('');
  lines.push('## Gate checks');
  lines.push('');
  for (const check of run.gate.checks) {
    lines.push(`- ${check.ok ? 'PASS' : 'FAIL'} \`${check.name}\`: ${check.detail}`);
  }
  lines.push('');
  lines.push('> Handoff: this report plus `state.json` and `claims.jsonl` is enough to resume. Do not summarize from chat history.');
  lines.push('');
  return lines.join('\n');
}

/** Compact, stable text for prompt/context injection. */
export function renderResumeBrief(snapshot, { maxActions = 6 } = {}) {
  const { charter, state, claims, evidence, runs } = snapshot;
  const lines = [];
  lines.push(`TASK ${charter.task_id} · ${charter.title}`);
  lines.push(`goal: ${charter.goal}`);
  lines.push(`status: ${state.status} · phase: ${state.phase} · version: ${state.version}${state.blocked_reason ? ` · blocked: ${state.blocked_reason}` : ''}`);
  if (Array.isArray(state.next_actions) && state.next_actions.length) {
    lines.push(`next_actions: ${state.next_actions.slice(0, maxActions).join(' | ')}`);
  }
  if (Array.isArray(state.open_questions) && state.open_questions.length) {
    lines.push(`open_questions: ${state.open_questions.slice(0, maxActions).join(' | ')}`);
  }
  const verified = claims.filter((claim) => claim.status === 'verified').length;
  const refuted = claims.filter((claim) => claim.status === 'refuted').length;
  const pending = claims.filter((claim) => claim.status === 'unverified').length;
  lines.push(`claims: ${claims.length} (verified ${verified}, refuted ${refuted}, unverified ${pending}) · evidence files: ${evidence.length}`);
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  if (lastRun) {
    lines.push(`last_run: ${lastRun.run_id} (${lastRun.ended_at || 'open'}) — ${(lastRun.summary || '').slice(0, 300)}`);
    if (Array.isArray(lastRun.next_actions) && lastRun.next_actions.length) {
      lines.push(`last_run.next_actions: ${lastRun.next_actions.slice(0, maxActions).join(' | ')}`);
    }
  }
  lines.push('Resume protocol: call task_resume (not a fresh plan), then task_checkpoint for evidence, then task_close with a run report.');
  return lines.join('\n');
}

export async function renderTaskMarkdown(root, taskId) {
  const task = await readTask(root, taskId);
  const summary = summarizeTask(task);
  const lines = [];
  lines.push(`# ${summary.title}`);
  lines.push('');
  lines.push(`\`${summary.task_id}\``);
  lines.push('');
  lines.push(`- status: **${summary.status}** · phase: ${summary.phase}`);
  lines.push(`- updated: ${summary.updated_at}`);
  lines.push(`- claims: ${summary.claim_count} (verified ${summary.claim_counts.verified}, refuted ${summary.claim_counts.refuted}, unverified ${summary.claim_counts.unverified}) · evidence: ${summary.evidence_count}`);
  if (summary.blocked_reason) lines.push(`- blocked: ${summary.blocked_reason}`);
  lines.push('');
  lines.push('## Goal');
  lines.push('');
  lines.push(task.charter.goal);
  lines.push('');
  if (task.charter.research_questions.length) {
    lines.push('## Research questions');
    lines.push('');
    for (const question of task.charter.research_questions) lines.push(`- ${question}`);
    lines.push('');
  }
  lines.push('## Next actions');
  lines.push('');
  lines.push(task.state.next_actions.length ? task.state.next_actions.map((item) => `- [ ] ${item}`).join('\n') : '- (none)');
  lines.push('');
  lines.push('## Open questions');
  lines.push('');
  lines.push(task.state.open_questions.length ? task.state.open_questions.map((item) => `- ${item}`).join('\n') : '- (none)');
  lines.push('');
  if (task.claims.length) {
    lines.push('## Claims');
    lines.push('');
    for (const claim of task.claims) {
      const badge = claim.status === 'verified' ? '✓' : claim.status === 'refuted' ? '✗' : '?';
      const cite = claim.source_ref ? ` — ${claim.source_ref}` : '';
      lines.push(`- ${badge} ${claim.claim}${cite}`);
    }
    lines.push('');
  }
  if (task.runs.length) {
    lines.push('## Runs');
    lines.push('');
    for (const run of task.runs) {
      lines.push(`- \`${run.run_id}\` ${run.ended_at || 'open'} — ${(run.summary || '').slice(0, 160)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Export used by the panel route and by `task_list` when a full record is asked for. */
export async function readTaskDetail(root, taskId) {
  const task = await readTask(root, taskId);
  return {
    summary: summarizeTask(task),
    charter: task.charter,
    state: task.state,
    claims: task.claims,
    decisions: task.decisions.slice(-50),
    runs: task.runs,
    evidence: task.evidence.slice(-50),
    warnings: task.warnings,
  };
}

/** Resolve the task a run id belongs to (root-level binding written by resume). */
export async function resolveTaskForRun(root, runId) {
  assertRunId(runId);
  const { records } = await readJsonl(path.join(root, 'runs.jsonl'));
  let found = null;
  for (const record of records) {
    if (record && record.run_id === runId) found = record;
  }
  if (!found) {
    throw new LedgerError(`Unknown run_id ${runId}.`, {
      code: 'run-not-found',
      hint: 'Call task_resume for the task; it returns the run_id that owns this run\'s writes.',
    });
  }
  return found.task_id;
}

/**
 * Administrative status change from the panel or a slash command: a human
 * decision, not a run write. It still takes the ledger lock and bumps the
 * version, so it cannot corrupt a concurrent run, but it does not require the
 * lease — the human may legitimately mark a blocked task done while a run is
 * stalled. Every such change is audited and explains itself in the decisions
 * log, so a later run can see why the state moved without it.
 */
export async function setTaskStatus(root, taskId, status, { reason = '', actor = 'ui', config = {} } = {}) {
  assertTaskId(taskId);
  if (!STATUSES.includes(status)) {
    throw new LedgerError(`status must be one of ${STATUSES.join(', ')}.`, { code: 'invalid-argument' });
  }
  const dir = taskDir(root, taskId);
  const at = nowIso();
  const state = await withTaskLock(dir, async () => {
    const task = await readTask(root, taskId);
    const next = task.state;
    const previous = next.status;
    next.status = status;
    next.blocked_reason = status === 'blocked'
      ? (String(reason || '').trim() || next.blocked_reason || 'Marked blocked from the management surface.')
      : null;
    if (status === 'done' || status === 'archived') {
      next.phase = 'closed';
      next.lease = null;
    }
    next.version = Number(next.version || 0) + 1;
    next.updated_at = at;
    await atomicWriteJson(path.join(dir, 'state.json'), next);
    await appendJsonl(path.join(dir, 'decisions.jsonl'), {
      id: uniqueId('dec'),
      decision: `Status changed ${previous} -> ${status} from the ${actor} surface.`,
      rationale: String(reason || '').trim() || 'Human override; no run report attached.',
      rejected: [],
      evidence_grade: '[?]',
      approved_by: actor,
      run_id: null,
      at,
    });
    return next;
  });
  if (status === 'done' || status === 'archived') {
    const activeTaskId = await getActiveTaskId(root).catch(() => null);
    if (activeTaskId === taskId) await setActiveTaskId(root, null, { sessionId: null }).catch(() => {});
  }
  await appendAudit(root, { event: 'task_status', task_id: taskId, detail: { status, actor } });
  const { regenerateIndex } = await import('./index-md.js');
  await regenerateIndex(root, config).catch(() => {});
  return state;
}

/** Ledger-wide view for the panel: counts, pinned task, and every summary. */
export async function ledgerOverview(root, { status = 'all', limit = 200 } = {}) {
  const { tasks, warnings } = await listTasks(root, { status, limit });
  const activeTaskId = await getActiveTaskId(root).catch(() => null);
  const counts = { open: 0, blocked: 0, done: 0, archived: 0 };
  for (const task of tasks) {
    if (Object.hasOwn(counts, task.status)) counts[task.status] += 1;
  }
  return { tasks, counts, activeTaskId, warnings };
}

