/**
 * Host half of `dsh-archive-rsi`.
 *
 * Two surfaces, one store:
 * - Agent tools: `archive_*` (curate the historical session archive the harness
 *   itself has no CRUD for) and `rsi_*` (run the PDCA alchemy loop over it and
 *   adopt the resulting context patches).
 * - Web panel API `/api/archive-rsi/*`, a same-origin JSON surface for the
 *   management panel in `client.js`.
 *
 * `archive.js` owns the session files and the derived store; `alchemy.js` owns
 * the judgments (metrics, findings, proposals, adoption). This file only
 * translates Harness concepts (tool, route, prompt section) into those calls.
 *
 * Every tool returns `{ ok: false, error: { code, message } }` instead of
 * throwing: an exception would reach the model as an opaque tool failure and
 * lose the reason.
 */

import { homedir } from 'node:os';
import path from 'node:path';

import {
  AUTO_TAG_PREFIX,
  ArchiveStore,
  DEFAULT_AUTO_TAG_LIMIT,
  DEFAULT_CHECK_TOOLS,
  DEFAULT_EDIT_TOOLS,
  deriveAutoTags,
} from './archive.js';
import {
  DEFAULT_TARGETS,
  applyProposal,
  cohortMetrics,
  deriveFindings,
  evaluateAdoptions,
  executeCheck,
  executeDo,
  planRun,
  proposalsFor,
  revertProposal,
  summarizeRun,
  RUN_STALE_MS,
} from './alchemy.js';
import { SECTION_NAME, lessonsBlock, protocolText } from './protocol.js';
import { annotate, filterByHarnessArchive, readHarnessArchive } from './workspace-archive.js';

const ROUTE_PREFIX = '/api/archive-rsi';
const MAX_BODY_BYTES = 256 * 1024;
const TOOL_TIMEOUT_MS = 120_000;
/** Corpus cap for a single status/evaluation read; decode is the expensive part. */
const MAX_EVAL_SESSIONS = 200;
/**
 * Smallest Harness-archived cohort worth reporting. Below this the archived
 * slice is too small for a rate to mean anything, so the run widens to the
 * whole window and says so in `cohort.source`.
 */
const MIN_ARCHIVE_COHORT = 3;

export const DEFAULTS = {
  rootDir: '',
  sessionsDir: '',
  protocolSection: true,
  lessonsSection: true,
  syncOnBoot: true,
  maxTranscriptBytes: 262_144,
  days: 30,
  limit: 40,
  agentsFile: '',
  skillsRoot: '',
  autoAdopt: false,
  autoRunEveryDays: 7,
  autoPropose: true,
  autoTag: true,
  autoTagLimit: DEFAULT_AUTO_TAG_LIMIT,
  editTools: DEFAULT_EDIT_TOOLS,
  checkTools: DEFAULT_CHECK_TOOLS,
};

// `webServer` is NOT in this list: a headless or SDK composition has no Web
// server, and waiting for one would keep the tools from ever registering. The
// routes attach through a deferred child context when the service appears.
export const inject = ['tools', 'systemPrompt'];

// --------------------------------------------------------------- config

/** Expand a leading `~` and drop a trailing slash. */
function expandHome(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

/** Harness home: `$DSH_HOME` else `~/.dsh`. */
export function dshHome() {
  const configured = expandHome(process.env.DSH_HOME || '');
  if (configured) return configured;
  return path.join(homedir(), '.dsh');
}

/**
 * Merge the row's raw config over the defaults. Never throws: a bad value is
 * reported as a warning and the default wins, because a throwing `apply` would
 * take the whole profile down.
 */
export function readConfig(raw) {
  const config = { ...DEFAULTS };
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) warnings.push('config is not an object; using defaults');
    return { config, warnings };
  }
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULTS, key)) warnings.push(`unknown config key "${key}" ignored`);
  }
  const stringKeys = ['rootDir', 'sessionsDir', 'agentsFile', 'skillsRoot'];
  for (const key of stringKeys) {
    if (typeof raw[key] === 'string') config[key] = expandHome(raw[key]);
    else if (raw[key] !== undefined) warnings.push(`config "${key}" must be a string`);
  }
  const booleanKeys = ['protocolSection', 'lessonsSection', 'syncOnBoot', 'autoAdopt', 'autoPropose', 'autoTag'];
  for (const key of booleanKeys) {
    if (typeof raw[key] === 'boolean') config[key] = raw[key];
    else if (raw[key] !== undefined) warnings.push(`config "${key}" must be a boolean`);
  }
  if (raw.maxTranscriptBytes !== undefined) {
    if (Number.isFinite(raw.maxTranscriptBytes)) {
      config.maxTranscriptBytes = Math.min(4 * 1024 * 1024, Math.max(4096, Math.floor(raw.maxTranscriptBytes)));
    } else warnings.push('config "maxTranscriptBytes" must be a number');
  }
  if (raw.days !== undefined) {
    if (Number.isFinite(raw.days) && raw.days >= 0) config.days = Math.floor(raw.days);
    else warnings.push('config "days" must be a number >= 0');
  }
  if (raw.autoRunEveryDays !== undefined) {
    if (Number.isFinite(raw.autoRunEveryDays) && raw.autoRunEveryDays >= 0) {
      config.autoRunEveryDays = Math.min(365, raw.autoRunEveryDays);
    } else warnings.push('config "autoRunEveryDays" must be a number >= 0');
  }
  if (raw.autoTagLimit !== undefined) {
    if (Number.isFinite(raw.autoTagLimit) && raw.autoTagLimit >= 0) {
      config.autoTagLimit = Math.min(24, Math.floor(raw.autoTagLimit));
    } else warnings.push('config "autoTagLimit" must be a number >= 0');
  }
  if (raw.limit !== undefined) {
    if (Number.isFinite(raw.limit)) config.limit = Math.min(500, Math.max(1, Math.floor(raw.limit)));
    else warnings.push('config "limit" must be a number');
  }
  for (const key of ['editTools', 'checkTools']) {
    if (raw[key] === undefined) continue;
    const value = raw[key];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string' && item)) {
      config[key] = [...value];
    } else warnings.push(`config "${key}" must be an array of tool names`);
  }
  return { config, warnings };
}

/** Resolve the store root and the two adoption roots from config. */
export function resolvePaths(config) {
  return {
    root: config.rootDir || path.join(dshHome(), 'archive-rsi'),
    sessions: config.sessionsDir || path.join(dshHome(), 'sessions'),
    agentsFile: config.agentsFile || path.join(homedir(), '.agents', 'AGENTS.md'),
    skillsRoot: config.skillsRoot || path.join(homedir(), '.agents', 'skills'),
  };
}

// --------------------------------------------------------------- helpers

function failure(error) {
  return {
    ok: false,
    error: {
      code: (error && error.code) || 'internal',
      message: (error && error.message) || String(error),
    },
  };
}

function ok(payload) {
  return { ok: true, ...payload };
}

function asString(value, max = 2000) {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

function asId(value) {
  const id = asString(value, 200);
  return id && id.trim() ? id.trim() : undefined;
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asLimit(value, fallback, max = 500) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function asTags(value) {
  if (value === undefined) return undefined;
  // Do not filter: a dropped entry looks like a successful write, and the store
  // answers with `invalid-tag` for a real problem.
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
    throw Object.assign(new Error('tags must be an array of strings'), { code: 'invalid-tag' });
  }
  return value;
}

function asTargets(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw Object.assign(new Error('targets must be an array'), { code: 'bad-argument' });
  return value
    .filter((row) => row && typeof row === 'object' && typeof row.metric === 'string')
    .map((row) => ({
      metric: row.metric,
      op: ['<=', '>=', '<', '>'].includes(row.op) ? row.op : '<=',
      value: Number.isFinite(row.value) ? row.value : 0,
    }));
}

function requireId(value) {
  const id = asId(value);
  if (!id) throw Object.assign(new Error('`id` is required'), { code: 'bad-argument' });
  return id;
}

/** `value` is the tool result; keep the model-facing text short and stable. */
function renderJson(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * Build a ToolDefinition. `execute` may throw; the wrapper turns that into the
 * `{ ok: false }` contract so the model always sees the reason.
 */
function defineTool(name, description, parameters, execute, render = renderJson) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: render(value) }],
    },
    execute: async (args, exec) => {
      try {
        return await execute(args && typeof args === 'object' ? args : {}, exec || {});
      } catch (error) {
        return failure(error);
      }
    },
    timeoutMs: TOOL_TIMEOUT_MS,
  };
}

// --------------------------------------------------------------- cohort

/**
 * Pick the archive entries a run should analyze, newest first.
 *
 * The Harness's own archive is authoritative for "is this session archived", so
 * by default a cohort is the sessions the user actually archived. When nothing
 * is archived yet the selection falls back to the whole recent window and says
 * so in `source`, rather than reporting an empty run as a clean corpus.
 *
 * @param store - initialized ArchiveStore.
 * @param cohort - PdcaRun cohort `{days, workspace, tag, status, limit, onlyArchived?}`.
 * @param now - injected clock.
 * @returns `{ entries, source: 'harness-archive' | 'all', archivedTotal }`.
 */
async function selectCohort(store, cohort, now) {
  const since = cohort.days > 0 ? now - cohort.days * 86_400_000 : 0;
  const listing = await store.list({
    status: cohort.status || undefined,
    tag: cohort.tag || undefined,
    workspace: cohort.workspace || undefined,
    sort: 'newest',
    limit: 2000,
    offset: 0,
  });
  const limit = asLimit(cohort.limit, 40, 500);
  const inWindow = listing.entries.filter((entry) => !since || entry.createdAt >= since);
  const state = await readHarnessArchive(dshHome());
  const archivedTotal = state.archived.size;
  // Intersect before slicing: the archived sessions are usually the oldest part
  // of the window, so a slice-then-filter would silently return almost nothing.
  const archivedInWindow = inWindow.filter((entry) => state.archived.has(entry.id));
  if (cohort.onlyArchived !== false && archivedInWindow.length >= MIN_ARCHIVE_COHORT) {
    return { entries: archivedInWindow.slice(0, limit), source: 'harness-archive', archivedTotal, archivedInWindow: archivedInWindow.length };
  }
  return {
    entries: inWindow.slice(0, limit),
    source: archivedInWindow.length ? 'all-few-archived' : 'all',
    archivedTotal,
    archivedInWindow: archivedInWindow.length,
  };
}

/**
 * Run the check phase and guarantee the act-phase input exists.
 *
 * `executeCheck` owns this per the contract, but findings are the one field a
 * caller must not have to guess about: without them `rsi_act` has nothing to
 * turn into proposals, and a silent empty act phase looks like "no problems".
 */
export function finishCheck(run, facts, baselineMetrics) {
  const now = Date.now();
  const checked = executeCheck(run, facts, baselineMetrics, { now });
  const present = checked.act && Array.isArray(checked.act.findings) ? checked.act.findings : [];
  // An empty array from executeCheck is not evidence that the corpus is clean;
  // derive from the metrics whenever it comes back empty.
  const findings = present.length ? present : deriveFindings(checked.check.metrics, facts, checked.cohort);
  checked.act = { findings, proposalIds: checked.act && Array.isArray(checked.act.proposalIds) ? checked.act.proposalIds : [] };
  checked.phase = checked.act.proposalIds.length ? 'closed' : 'act';
  checked.status = 'checked';
  checked.finishedAt = now;
  return checked;
}

/** Load SessionFacts for the given entries, decoding anything not yet derived. */
async function loadFacts(store, entries) {
  const facts = [];
  const failures = [];
  for (const entry of entries) {
    try {
      const record = await store.get(entry.id);
      if (record && record.facts) facts.push(record.facts);
      else failures.push({ sessionId: entry.id, error: 'facts unavailable' });
    } catch (error) {
      failures.push({ sessionId: entry.id, error: (error && error.message) || String(error) });
    }
  }
  return { facts, failures };
}

// --------------------------------------------------------------- PDCA

/** Cohort defaults for a run whose caller passed no explicit args. */
function runCohort(args, config) {
  return {
    days: Number.isFinite(args.days) ? Math.max(0, Math.floor(args.days)) : config.days,
    workspace: asString(args.workspace, 400) || null,
    tag: asString(args.tag, 64) || null,
    // Undefined keeps the store default (kept entries only): a cohort must not
    // silently include sessions the user dropped into the plugin's trash.
    status: ['archived', 'pinned', 'trash', 'all'].includes(args.status) ? args.status : undefined,
    limit: asLimit(args.limit, config.limit, 500),
  };
}

/**
 * plan -> do -> check, persisted.
 *
 * Shared by `rsi_plan` (plan only), `rsi_run` and the boot-time auto run, so the
 * continuous loop and the on-demand loop can never drift apart.
 */
async function runOnce({ store, config, args, execute, ensureReady }) {
  const store1 = ensureReady ? await ensureReady() : store;
  await store1.sync({ refresh: false });
  const now = Date.now();
  const cohort = runCohort(args, config);
  const runs = await store1.listRuns({ limit: 20 });
  // A crash between the running marker and the final write leaves a run that
  // says "running" forever. That entry would sit at the head of the list, poison
  // the baseline choice and defer the auto run by a whole cycle, so retire it.
  const head = runs[0];
  if (head && head.status === 'running' && now - (head.updatedAt || head.createdAt || 0) > RUN_STALE_MS) {
    await store1.saveRun({ ...head, status: 'failed', updatedAt: now, finishedAt: head.updatedAt || head.createdAt || now });
  }
  const baselines = await store1.readBaselines();
  // Prefer the newest run that actually checked something; fall back to the
  // newest stored baseline, so a plan-only or retired run cannot silently drop
  // the deltas of the next pass.
  // "Finished" means the run reached check/act, not merely that a check block
  // exists: a crashed marker can carry an empty check skeleton.
  const isFinished = (run) => Boolean(run)
    && (run.status === 'checked' || run.status === 'closed'
      || (!run.status && run.check && Array.isArray(run.check.verdicts)));
  const lastChecked = runs.find(isFinished);
  let baselineRunId = lastChecked ? lastChecked.id : '';
  if (!baselineRunId) {
    const newest = Object.keys(baselines)
      .map((id) => ({ id, ts: (baselines[id] && baselines[id].ts) || 0 }))
      .sort((a, b) => b.ts - a.ts)[0];
    baselineRunId = newest ? newest.id : null;
  }
  const baseline = baselineRunId && baselines[baselineRunId] ? baselines[baselineRunId].metrics : null;
  let run = planRun({ cohort, targets: asTargets(args.targets), baselineRunId }, { now });
  if (!execute) {
    await store1.saveRun(run);
    await store1.journal('run.plan', run.id, { cohort });
    return run;
  }
  // Persist a running marker (same id, so no new run file) before the analysis
  // starts, so a concurrent reader or a crash mid-run sees "running", not the
  // last finished run.
  await store1.saveRun({ ...run, status: 'running', updatedAt: Date.now() });
  const selection = await selectCohort(store1, cohort, now);
  const entries = selection.entries;
  run.cohort.source = selection.source;
  run.cohort.harnessArchivedTotal = selection.archivedTotal;
  run.cohort.archivedInWindow = selection.archivedInWindow;
  const { facts, failures } = await loadFacts(store1, entries);
  run = executeDo(run, facts);
  run.do.coverage.requested = entries.length;
  run.do.coverage.skipped = failures.length;
  run.do.coverage.failures = failures.slice(0, 10);
  run = finishCheck(run, facts, baseline);
  await store1.saveRun(run);
  await store1.saveBaseline(run.id, run.check.metrics);
  await store1.journal('run.do', run.id, { analyzed: run.do.sessionIds.length, failures: failures.length });
  await store1.journal('run.check', run.id, { verdicts: run.check.verdicts });
  return run;
}

// --------------------------------------------------------------- tools

function buildTools({ store, config, paths, state, ensureReady }) {
  const tools = [];

  tools.push(
    defineTool(
      'archive_list',
      'List the session archive (historical DSH sessions imported by archive_sync). Filters: free-text query over title/workspace/tags, a tag, this plugin\'s own status (archived|pinned|trash|all), a workspace substring, and `archived` for the Harness\'s own archive flag. Returns headline metrics plus `harnessArchived`/`harnessPinned` per session.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text filter over title, workspace and tags.' },
          tag: { type: 'string', description: 'Exact tag filter.' },
          status: { type: 'string', enum: ['archived', 'pinned', 'trash', 'all'], description: 'Lifecycle filter, default all.' },
          workspace: { type: 'string', description: 'Substring match on the session cwd.' },
          archived: { type: 'boolean', description: 'true keeps only sessions the Harness itself has archived, false only unarchived ones.' },
          limit: { type: 'number', description: 'Max entries, default 20.' },
          offset: { type: 'number', description: 'Pagination offset.' },
        },
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const query = {
          query: asString(args.query, 200),
          tag: asString(args.tag, 64),
          status: ['archived', 'pinned', 'trash'].includes(args.status) ? args.status : 'all',
          workspace: asString(args.workspace, 400),
          sort: 'newest',
        };
        const offset = Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0;
        const limit = asLimit(args.limit, 20, 200);
        const archiveState = await readHarnessArchive(dshHome());
        const mode = typeof args.archived === 'boolean' ? args.archived : undefined;
        let entries;
        let total;
        if (mode === undefined) {
          const listing = await store1.list({ ...query, limit, offset });
          entries = listing.entries;
          total = listing.total;
        } else {
          // The store paginates, so a Harness-archive filter has to run over the
          // whole result set before slicing: archived sessions are usually the
          // oldest ones and would never appear on the first page.
          const all = await store1.list({ ...query, limit: 2000, offset: 0 });
          const filtered = filterByHarnessArchive(all.entries, archiveState, mode);
          entries = filtered.slice(offset, offset + limit);
          total = filtered.length;
        }
        return ok({
          total,
          harnessArchive: { sessions: archiveState.archived.size, error: archiveState.error },
          entries: entries.map((raw) => {
            const entry = annotate(raw, archiveState);
            return {
              id: entry.id,
              title: entry.title,
              createdAt: entry.createdAt,
              workspace: entry.workspace,
              origin: entry.origin,
              status: entry.status,
              harnessArchived: entry.harnessArchived,
              harnessPinned: entry.harnessPinned,
              tags: entry.tags,
              autoTags: entry.autoTags || [],
              metrics: entry.metrics,
            };
          }),
        });
      },
    ),
  );

  tools.push(
    defineTool(
      'archive_get',
      'Read one archived session: curated metadata, the derived facts (turns, per-tool call/error counts, context pressure, edits vs checks, repeated calls) and optionally the rendered transcript.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id from archive_list.' },
          transcript: { type: 'boolean', description: 'Include the rendered Markdown transcript.' },
          maxChars: { type: 'number', description: 'Cap the transcript length, default 12000.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const id = requireId(args.id);
        const record = await store1.get(id);
        if (!record) return { ok: false, error: { code: 'not-found', message: `no archived session "${id}"` } };
        const archiveState = await readHarnessArchive(dshHome());
        const payload = { entry: annotate(record.entry, archiveState), facts: record.facts };
        if (asBoolean(args.transcript, false)) {
          const text = await store1.transcript(id);
          const cap = asLimit(args.maxChars, 12_000, 200_000);
          payload.transcript = text ? text.slice(0, cap) : null;
          payload.transcriptTruncated = Boolean(text && text.length > cap);
        }
        return ok(payload);
      },
    ),
  );

  tools.push(
    defineTool(
      'archive_sync',
      'Scan the harness session directory and import/refresh archived sessions. Idempotent: unchanged files are skipped. Never modifies the original session files.',
      {
        type: 'object',
        properties: {
          refresh: { type: 'boolean', description: 'Re-decode every discovered file even when unchanged.' },
        },
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const result = await store1.sync({ refresh: asBoolean(args.refresh, false) });
        return ok({
          scanned: result.scanned,
          imported: result.imported,
          refreshed: result.refreshed,
          skipped: result.skipped,
          failed: result.failed.slice(0, 10),
          failedCount: result.failed.length,
        });
      },
    ),
  );

  tools.push(
    defineTool(
      'archive_update',
      'Curate one archived session: title, tags, note, or lifecycle status (archived|pinned|trash). Only the archive metadata changes.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id.' },
          title: { type: 'string', description: 'Replacement title (max 200 chars).' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list (max 24).' },
          note: { type: 'string', description: 'Replacement note (max 4000 chars).' },
          status: { type: 'string', enum: ['archived', 'pinned', 'trash'], description: 'Lifecycle status.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const id = requireId(args.id);
        const patch = {
          title: asString(args.title, 200),
          note: asString(args.note, 4000),
          tags: asTags(args.tags),
          status: ['archived', 'pinned', 'trash'].includes(args.status) ? args.status : undefined,
        };
        const entry = await store1.update(id, patch);
        return ok({ entry });
      },
    ),
  );

  tools.push(
    defineTool(
      'archive_autotag',
      'Recompute the automatic tags (auto:*: preset, origin, error hotspot, verification gap, turn failure, repeat, correction, context pressure, cost outlier, scale, top tools, language) for one archived session or the whole archive. Deterministic — no model call — manual-tag safe, and idempotent. dryRun computes without writing.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id; omit to retag the whole archive.' },
          dryRun: { type: 'boolean', description: 'Compute and report without writing.' },
          limit: { type: 'number', description: 'Max auto tags per session (default from config).' },
        },
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        if (config.autoTag === false) {
          return {
            ok: false,
            error: { code: 'auto-tag-disabled', message: 'autoTag is false in this profile; the archive_autotag tool is read-only' },
          };
        }
        const result = await store1.autotag({
          id: asId(args.id) || '',
          dryRun: asBoolean(args.dryRun, false),
          limit: Number.isFinite(args.limit) ? Math.max(0, Math.floor(args.limit)) : null,
        });
        return ok({ prefix: AUTO_TAG_PREFIX, ...result });
      },
    ),
  );

  tools.push(
    defineTool(
      'archive_delete',
      'Remove an archived session from the archive. Without purge it moves to trash (recoverable); with purge it also deletes the derived facts/transcript. The original DSH session file is never touched.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session id.' },
          purge: { type: 'boolean', description: 'Permanently drop the archive entry and its derived files.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const id = requireId(args.id);
        const result = await store1.remove(id, { purge: asBoolean(args.purge, false) });
        return ok(result);
      },
    ),
  );

  // ------------------------------------------------------------ PDCA loop

  const createRun = (args, options) => runOnce({ store, config, args, execute: options.execute, ensureReady });

  tools.push(
    defineTool(
      'rsi_plan',
      'PDCA "plan": fix a cohort of archived sessions and the target metrics a run will be judged against. Do not analyze anything.',
      {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Cohort window in days; 0 = all history.' },
          workspace: { type: 'string', description: 'Restrict to sessions whose cwd contains this.' },
          tag: { type: 'string', description: 'Restrict to archive tag.' },
          status: { type: 'string', enum: ['archived', 'pinned', 'trash', 'all'], description: 'Lifecycle filter, default all.' },
          limit: { type: 'number', description: 'Max sessions in the cohort.' },
          targets: {
            type: 'array',
            description: 'Override target metrics: [{metric, op, value}].',
            items: { type: 'object', properties: { metric: { type: 'string' }, op: { type: 'string' }, value: { type: 'number' } } },
          },
        },
        additionalProperties: false,
      },
      async (args) => ok({ run: await createRun(args, { execute: false }) }),
    ),
  );

  tools.push(
    defineTool(
      'rsi_run',
      'PDCA "do + check": analyze the cohort (including a fresh sync), compute the metrics, compare them with the target metrics and with the previous run, and persist the run. Returns the run with findings available through rsi_act.',
      {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Cohort window in days; 0 = all history.' },
          workspace: { type: 'string', description: 'Restrict to sessions whose cwd contains this.' },
          tag: { type: 'string', description: 'Restrict to archive tag.' },
          status: { type: 'string', enum: ['archived', 'pinned', 'trash', 'all'] },
          limit: { type: 'number', description: 'Max sessions in the cohort.' },
          targets: {
            type: 'array',
            description: 'Override target metrics: [{metric, op, value}].',
            items: { type: 'object', properties: { metric: { type: 'string' }, op: { type: 'string' }, value: { type: 'number' } } },
          },
        },
        additionalProperties: false,
      },
      async (args) => ok({ run: await createRun(args, { execute: true }) }),
    ),
  );

  tools.push(
    defineTool(
      'rsi_act',
      'PDCA "act": derive findings from a completed run and turn them into concrete proposals (prompt lessons, AGENTS.md rules, skill candidates, advisories). Proposals are saved unapplied.',
      {
        type: 'object',
        properties: { runId: { type: 'string', description: 'Run id from rsi_run.' } },
        required: ['runId'],
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const id = requireId(args.runId);
        const run = await store1.getRun(id);
        if (!run) return { ok: false, error: { code: 'not-found', message: `no run "${id}"` } };
        if (!run.check) return { ok: false, error: { code: 'not-checked', message: 'run has no check phase yet; call rsi_run' } };
        const findings = run.act && Array.isArray(run.act.findings) ? run.act.findings : null;
        if (!findings) {
          return {
            ok: false,
            error: { code: 'no-findings', message: 'run.act.findings missing; re-run rsi_run to regenerate this run' },
          };
        }
        const proposals = proposalsFor(run);
        for (const proposal of proposals) await store1.saveProposal(proposal);
        run.act.proposalIds = proposals.map((proposal) => proposal.id);
        run.phase = 'closed';
        run.status = 'closed';
        await store1.saveRun(run);
        await store1.journal('run.act', run.id, { proposals: run.act.proposalIds.length });
        return ok({ run, proposals });
      },
    ),
  );

  tools.push(
    defineTool(
      'rsi_status',
      'Report the corpus, the last run, the open/accepted proposals, and re-evaluate already-adopted proposals against the sessions that came after adoption (the closing half of the loop).',
      {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Inspect one run instead of the latest.' },
          limit: { type: 'number', description: 'Max runs/proposals to list, default 10.' },
          evaluate: { type: 'boolean', description: 'Re-evaluate adopted proposals, default true.' },
        },
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const limit = asLimit(args.limit, 10, 100);
        const index = await store1.index();
        const entries = Object.values(index.entries);
        const runs = await store1.listRuns({ limit });
        const proposals = await store1.listProposals({ limit: 100 });
        const adopted = proposals.filter((proposal) => proposal.status === 'adopted');
        let evaluated = [];
        if (asBoolean(args.evaluate, true) && adopted.length) {
          const candidates = entries
            .filter((entry) => entry.status !== 'trash')
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_EVAL_SESSIONS);
          const { facts } = await loadFacts(store1, candidates);
          if (facts.length) {
            const cohort = await selectCohort(
              store1,
              { days: 0, limit: MAX_EVAL_SESSIONS, status: undefined, onlyArchived: false },
              Date.now(),
            );
            const limited = new Set(cohort.entries.map((entry) => entry.id));
            const scoped = facts.filter((item) => limited.has(item.sessionId));
            evaluated = evaluateAdoptions(
              adopted.filter((proposal) => !proposal.evaluation),
              scoped,
              { minSessions: 3 },
            );
            for (const proposal of evaluated) await store1.saveProposal(proposal);
          }
        }
        const archiveState = await readHarnessArchive(dshHome());
        const corpus = {
          sessions: entries.length,
          harnessArchived: archiveState.archived.size,
          harnessPinned: archiveState.pinned.size,
          archived: entries.filter((entry) => entry.status === 'archived').length,
          pinned: entries.filter((entry) => entry.status === 'pinned').length,
          trash: entries.filter((entry) => entry.status === 'trash').length,
          totalBytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
          metrics: cohortMetrics(
            (await loadFacts(store1, entries.slice(0, MAX_EVAL_SESSIONS))).facts,
          ),
        };
        const run = args.runId ? await store1.getRun(requireId(args.runId)) : runs[0] || null;
        const lastRunSummary = runs[0] ? summarizeRun(runs[0]) : null;
        const statusEveryDays = config.autoRunEveryDays;
        const statusAutoEnabled = statusEveryDays > 0;
        const statusAutoDueAt = statusAutoEnabled && lastRunSummary
          ? lastRunSummary.createdAt + statusEveryDays * 86_400_000
          : null;
        const statusAutoDue = statusAutoEnabled ? !lastRunSummary || Date.now() >= statusAutoDueAt : false;
        return ok({
          corpus,
          run,
          runs,
          status: {
            running: lastRunSummary ? lastRunSummary.running : false,
            lastRun: lastRunSummary,
            autoRun: {
              enabled: statusAutoEnabled,
              everyDays: statusEveryDays,
              dueAt: statusAutoDueAt,
              due: statusAutoDue,
            },
          },
          proposals: {
            proposed: proposals.filter((p) => p.status === 'proposed').slice(0, limit),
            adopted: adopted.slice(0, limit),
            rejected: proposals.filter((p) => p.status === 'rejected').length,
            reverted: proposals.filter((p) => p.status === 'reverted').length,
          },
          evaluations: evaluated,
          targets: DEFAULT_TARGETS,
          lastError: state.lastError ? String(state.lastError.message || state.lastError) : null,
        });
      },
    ),
  );

  tools.push(
    defineTool(
      'rsi_adopt',
      'Apply or revert one proposal. Adoption is reversible: a backup is written first and the change is recorded in the journal. Advisory proposals cannot be adopted.',
      {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'Proposal id from rsi_act.' },
          revert: { type: 'boolean', description: 'Revert a previously adopted proposal.' },
          dryRun: { type: 'boolean', description: 'Validate without writing.' },
        },
        required: ['proposalId'],
        additionalProperties: false,
      },
      async (args) => {
        const store1 = await ensureReady();
        const id = requireId(args.proposalId);
        const proposal = await store1.getProposal(id);
        if (!proposal) return { ok: false, error: { code: 'not-found', message: `no proposal "${id}"` } };
        if (asBoolean(args.dryRun, false)) {
          return ok({
            proposal,
            dryRun: true,
            willWrite: proposal.kind !== 'advisory',
            authority: proposal.kind === 'advisory' ? 'none' : 'reversible',
          });
        }
        const roots = { rootDir: paths.root, agentsFile: paths.agentsFile, skillsRoot: paths.skillsRoot };
        const next = asBoolean(args.revert, false)
          ? await revertProposal(proposal, roots)
          : await applyProposal(proposal, roots);
        await store1.saveProposal(next);
        await store1.journal(
          asBoolean(args.revert, false) ? 'proposal.revert' : 'proposal.adopt',
          next.id,
          { kind: next.kind, target: next.target },
        );
        state.lessons = await store1.lessonsText();
        return ok({ proposal: next });
      },
    ),
  );

  return tools;
}

// --------------------------------------------------------------- routes

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function httpStatusFor(error) {
  const code = (error && error.code) || 'internal';
  if (code === 'not-found') return 404;
  if (code === 'bad-argument' || code === 'invalid-tag' || code === 'invalid-status') return 400;
  if (code === 'not-adoptable' || code === 'target-changed' || code === 'path-outside-root') return 409;
  return 500;
}

async function readJsonBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      throw Object.assign(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`), { code: 'bad-argument' });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { code: 'bad-argument' });
  }
}

/**
 * Build the panel handler. Fails closed when the connection service is missing,
 * and reuses its Host/Origin/browser-auth checks for every route, because a raw
 * `webServer` route is not authenticated by the carrier.
 */
export function buildPanelHandler({ store, paths, state, config, ensureReady, getConnection }) {
  return async function handler(req, res) {
    const connection = typeof getConnection === 'function' ? getConnection() : undefined;
    if (!connection || typeof connection.requestRejection !== 'function') {
      sendJson(res, 503, { ok: false, error: { code: 'unavailable', message: 'connection service unavailable' } });
      return;
    }
    const rejection = connection.requestRejection({ headers: req.headers || {} });
    if (rejection) {
      sendJson(res, rejection, { ok: false, error: { code: 'unauthorized', message: 'request rejected' } });
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const segments = url.pathname
      .slice(ROUTE_PREFIX.length)
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    const method = (req.method || 'GET').toUpperCase();
    try {
      const store1 = await ensureReady();
      const body = method === 'GET' || method === 'HEAD' ? {} : await readJsonBody(req);
      const result = await route({ store: store1, paths, state, config, url, segments, method, body, ensureReady });
      if (result === undefined) {
        sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `${method} ${url.pathname} not found` } });
        return;
      }
      sendJson(res, result.status || 200, result.payload);
    } catch (error) {
      sendJson(res, httpStatusFor(error), {
        ok: false,
        error: { code: (error && error.code) || 'internal', message: (error && error.message) || String(error) },
      });
    }
  };
}

async function route({ store, paths, config, url, segments, method, body, ensureReady }) {
  const [first, second, third] = segments;

  if (!first) return undefined;

  if (first === 'overview' && method === 'GET') {
    const index = await store.index();
    const entries = Object.values(index.entries);
    const archiveState = await readHarnessArchive(dshHome());
    const runs = await store.listRuns({ limit: 5 });
    const proposals = await store.listProposals({ limit: 100 });
    const lastRun = runs[0] ? summarizeRun(runs[0]) : null;
    const autoEveryDays = config.autoRunEveryDays;
    const autoEnabled = autoEveryDays > 0;
    const autoDueAt = autoEnabled && lastRun ? lastRun.createdAt + autoEveryDays * 86_400_000 : null;
    const autoDue = autoEnabled ? !lastRun || Date.now() >= autoDueAt : false;
    return {
      payload: {
        ok: true,
        corpus: {
          sessions: entries.length,
          archived: entries.filter((entry) => entry.status === 'archived').length,
          pinned: entries.filter((entry) => entry.status === 'pinned').length,
          trash: entries.filter((entry) => entry.status === 'trash').length,
          tags: [...new Set(entries.flatMap((entry) => entry.tags || []))].slice(0, 50),
          workspaces: [...new Set(entries.map((entry) => entry.workspace).filter(Boolean))].slice(0, 50),
          totalBytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
          harnessArchived: archiveState.archived.size,
          harnessPinned: archiveState.pinned.size,
          harnessArchiveError: archiveState.error,
        },
        lastRun,
        autoRun: {
          enabled: autoEnabled,
          everyDays: autoEveryDays,
          dueAt: autoDueAt,
          due: autoDue,
        },
        proposals: {
          proposed: proposals.filter((p) => p.status === 'proposed').length,
          adopted: proposals.filter((p) => p.status === 'adopted').length,
          rejected: proposals.filter((p) => p.status === 'rejected').length,
          reverted: proposals.filter((p) => p.status === 'reverted').length,
        },
        root: paths.root,
      },
    };
  }

  if (first === 'sessions' && !second && method === 'GET') {
    const listing = await store.list({
      query: url.searchParams.get('query') || undefined,
      tag: url.searchParams.get('tag') || undefined,
      status: url.searchParams.get('status') || 'all',
      workspace: url.searchParams.get('workspace') || undefined,
      limit: asLimit(Number(url.searchParams.get('limit')), 50, 200),
      offset: Number(url.searchParams.get('offset')) || 0,
      sort: url.searchParams.get('sort') || 'newest',
    });
    const archiveState = await readHarnessArchive(dshHome());
    return {
      payload: {
        ok: true,
        ...listing,
        entries: listing.entries.map((entry) => annotate(entry, archiveState)),
        harnessArchive: { sessions: archiveState.archived.size, error: archiveState.error },
      },
    };
  }

  if (first === 'sessions' && second && !third) {
    if (method === 'GET') {
      const record = await store.get(second);
      if (!record) return { status: 404, payload: { ok: false, error: { code: 'not-found', message: 'no such session' } } };
      const archiveState = await readHarnessArchive(dshHome());
      const payload = { ok: true, entry: annotate(record.entry, archiveState), facts: record.facts };
      if (url.searchParams.get('transcript')) {
        const text = await store.transcript(second);
        const cap = asLimit(Number(url.searchParams.get('maxChars')), 24_000, 200_000);
        payload.transcript = text ? text.slice(0, cap) : null;
        payload.transcriptTruncated = Boolean(text && text.length > cap);
      }
      return { payload };
    }
    if (method === 'PATCH' || method === 'POST') {
      const entry = await store.update(second, {
        title: typeof body.title === 'string' ? body.title : undefined,
        note: typeof body.note === 'string' ? body.note : undefined,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
        status: typeof body.status === 'string' ? body.status : undefined,
      });
      return { payload: { ok: true, entry } };
    }
    if (method === 'DELETE') {
      const purge = ['1', 'true', 'yes'].includes(String(url.searchParams.get('purge') || '').toLowerCase());
      const result = await store.remove(second, { purge });
      return { payload: { ok: true, ...result } };
    }
  }

  if (first === 'autotag' && method === 'POST') {
    const result = await store.autotag({
      id: typeof body.id === 'string' ? body.id : '',
      dryRun: body.dryRun === true,
      limit: Number.isFinite(body.limit) ? Math.max(0, Math.floor(body.limit)) : null,
    });
    return { payload: { ok: true, prefix: AUTO_TAG_PREFIX, ...result } };
  }

  if (first === 'sync' && method === 'POST') {
    const result = await store.sync({ refresh: Boolean(body.refresh) });
    return {
      payload: {
        ok: true,
        scanned: result.scanned,
        imported: result.imported,
        refreshed: result.refreshed,
        skipped: result.skipped,
        failedCount: result.failed.length,
        failed: result.failed.slice(0, 10),
      },
    };
  }

  if (first === 'runs' && !second) {
    if (method === 'GET') {
      const runs = await store.listRuns({ limit: asLimit(Number(url.searchParams.get('limit')), 20, 100) });
      return { payload: { ok: true, runs } };
    }
    if (method === 'POST') {
      // Reuse the shared `runOnce` pipeline so the panel-triggered run writes
      // the journal and behaves exactly like `rsi_run` / the auto run.
      const run = await runOnce({ store, config, args: body, execute: true, ensureReady });
      return { payload: { ok: true, run } };
    }
  }

  if (first === 'runs' && second && !third && method === 'GET') {
    const run = await store.getRun(second);
    if (!run) return { status: 404, payload: { ok: false, error: { code: 'not-found', message: 'no such run' } } };
    return { payload: { ok: true, run } };
  }

  if (first === 'runs' && second && third === 'act' && method === 'POST') {
    const run = await store.getRun(second);
    if (!run) return { status: 404, payload: { ok: false, error: { code: 'not-found', message: 'no such run' } } };
    if (!run.check) {
      return { status: 409, payload: { ok: false, error: { code: 'not-checked', message: 'run has no check phase' } } };
    }
    const proposals = proposalsFor(run);
    for (const proposal of proposals) await store.saveProposal(proposal);
    run.act.proposalIds = proposals.map((proposal) => proposal.id);
    run.phase = 'closed';
    run.status = 'closed';
    await store.saveRun(run);
    return { payload: { ok: true, run, proposals } };
  }

  if (first === 'proposals' && !second && method === 'GET') {
    const proposals = await store.listProposals({
      status: url.searchParams.get('status') || undefined,
      runId: url.searchParams.get('runId') || undefined,
      limit: asLimit(Number(url.searchParams.get('limit')), 50, 200),
    });
    return { payload: { ok: true, proposals } };
  }

  if (first === 'proposals' && second && method === 'POST') {
    const proposal = await store.getProposal(second);
    if (!proposal) return { status: 404, payload: { ok: false, error: { code: 'not-found', message: 'no such proposal' } } };
    if (third === 'reject') {
      const next = { ...proposal, status: 'rejected', rejectedAt: Date.now() };
      await store.saveProposal(next);
      return { payload: { ok: true, proposal: next } };
    }
    if (third === 'adopt') {
      const roots = { rootDir: paths.root, agentsFile: paths.agentsFile, skillsRoot: paths.skillsRoot };
      const next = body.revert ? await revertProposal(proposal, roots) : await applyProposal(proposal, roots);
      await store.saveProposal(next);
      return { payload: { ok: true, proposal: next } };
    }
  }

  if (first === 'metrics' && method === 'GET') {
    const index = await store.index();
    const entries = Object.values(index.entries).sort((a, b) => a.createdAt - b.createdAt);
    const baselines = await store.readBaselines();
    return {
      payload: {
        ok: true,
        series: entries.map((entry) => ({
          id: entry.id,
          createdAt: entry.createdAt,
          metrics: entry.metrics,
        })),
        baselines: Object.entries(baselines).map(([id, value]) => ({ runId: id, ts: value.ts, metrics: value.metrics })),
      },
    };
  }

  return undefined;
}

// ------------------------------------------------------------------ plugin

export function apply(ctx, rawConfig) {
  const { config, warnings } = readConfig(rawConfig);
  const paths = resolvePaths(config);
  const store = new ArchiveStore({
    rootDir: paths.root,
    sessionRoots: [paths.sessions],
    editTools: config.editTools,
    checkTools: config.checkTools,
    maxTranscriptBytes: config.maxTranscriptBytes,
    autoTag: config.autoTag,
    autoTagLimit: config.autoTagLimit,
  });
  const state = { lessons: '', lastError: null, ready: null, bootSync: null };

  state.ready = (async () => {
    await store.init();
    state.lessons = config.lessonsSection ? await store.lessonsText() : '';
    for (const warning of warnings) await store.journal('config.invalid', 'config', { warning });
    if (config.syncOnBoot) {
      state.bootSync = store
        .sync({ refresh: false })
        .catch((error) => {
          state.lastError = error;
          return null;
        });
    }
    return store;
  })().catch((error) => {
    state.lastError = error;
    // Keep the tools alive: they report the failure per call instead of the
    // whole profile failing to boot.
    return store;
  });

  const ensureReady = async () => {
    await state.ready;
    // Serialize against the boot sync so two writers never race on archive.json.
    if (state.bootSync) await state.bootSync.catch(() => null);
    return store;
  };

  /**
   * The "continuous" half of the loop.
   *
   * A plugin cannot wake itself on a timer without claiming a reminder session,
   * so continuity is anchored to process lifetime: whenever the Harness starts
   * and the last run is older than `autoRunEveryDays`, the PDCA loop runs once in
   * the background. It writes a run and (unless `autoPropose` is off) proposals,
   * never an adoption — `autoAdopt` only ever applies one `prompt-section`
   * lesson, which is in-plugin text and cannot touch a user file.
   */
  const autoRun = async () => {
    try {
      const runs = await store.listRuns({ limit: 5 });
      // A running marker or a retired (failed) run is not a completed pass, so it
      // must not postpone the next attempt by a whole cycle.
      const last = runs.find((run) => run && run.status !== 'running' && run.status !== 'failed') || null;
      const due = !last || Date.now() - (last.createdAt || 0) >= config.autoRunEveryDays * 86_400_000;
      if (!due) return;
      const run = await runOnce({ store, config, args: {}, execute: true, ensureReady: async () => store });
      let proposals = [];
      if (config.autoPropose) {
        proposals = proposalsFor(run);
        for (const proposal of proposals) await store.saveProposal(proposal);
        run.act.proposalIds = proposals.map((proposal) => proposal.id);
        await store.journal('run.act', run.id, { proposals: run.act.proposalIds.length, auto: true });
      }
      // Close the run regardless of autoPropose so the latest run always reads
      // as finished, not as a stuck "running" heartbeat.
      run.phase = 'closed';
      run.status = 'closed';
      await store.saveRun(run);
      if (config.autoAdopt) {
        const adoptable = proposals.find((proposal) => proposal.kind === 'prompt-section');
        if (adoptable) {
          const adopted = await applyProposal(adoptable, {
            rootDir: paths.root,
            agentsFile: paths.agentsFile,
            skillsRoot: paths.skillsRoot,
          });
          await store.saveProposal(adopted);
          await store.journal('proposal.adopt', adopted.id, { kind: adopted.kind, auto: true });
          state.lessons = await store.lessonsText();
        }
      }
      await store.journal('run.auto', run.id, { proposals: proposals.length, autoAdopt: config.autoAdopt });
    } catch (error) {
      state.lastError = error;
    }
  };

  // `syncOnBoot: false` means "no boot-time background work": the continuous run
  // syncs as part of its own pass, so starting it would contradict that setting.
  if (config.autoRunEveryDays > 0 && config.syncOnBoot) {
    state.ready
      .then(() => (state.bootSync ? state.bootSync.catch(() => null) : null))
      .then(autoRun)
      .catch((error) => {
        state.lastError = error;
      });
  }

  for (const definition of buildTools({ store, config, paths, state, ensureReady })) {
    ctx.effect(() => ctx.tools.register(definition));
  }

  if (config.protocolSection) {
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: Number.isFinite(ctx.systemPrompt.getSectionOrder('TOOL_SESSION_QUERY'))
          ? ctx.systemPrompt.getSectionOrder('TOOL_SESSION_QUERY') + 10
          : 2310,
        text: () => [protocolText(), config.lessonsSection ? lessonsBlock(state.lessons) : ''].filter(Boolean).join('\n\n'),
        interpolate: false,
      }),
    );
  }

  // The panel exists only where a Web server does. The connection service is
  // looked up per request so a profile without it fails closed (503) instead of
  // failing the plugin at boot.
  ctx.inject(['webServer'], (webCtx) => {
    const handler = buildPanelHandler({
      store,
      paths,
      state,
      config,
      ensureReady,
      getConnection: () => ctx.get('connection'),
    });
    ctx.effect(() =>
      webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler,
      }),
    );
  });
}
