/**
 * Host half of `dsh-task-ledger`.
 *
 * Three surfaces, one canonical store:
 * - Agent tools (`task_*`): open, resume, checkpoint, close a task.
 * - Prompt contract: a static protocol section plus a cheap dynamic runtime
 *   context carrying the current ledger snapshot, so a resumed session knows
 *   what it is continuing before the model plans.
 * - Web panel API: `/api/task-ledger/*`, a same-origin JSON surface for the
 *   management panel (list, detail, status, pinned task).
 *
 * The store lives in `ledger.js` and knows nothing about the Harness; this file
 * is the only place that translates Harness concepts (agent, session, step) to
 * ledger concepts (run, lease, version).
 */

import path from 'node:path';

import * as ledger from './ledger.js';
import { regenerateIndex } from './index-md.js';
import { SECTION_NAME, protocolText } from './protocol.js';

const ROUTE_PREFIX = '/api/task-ledger';
const MAX_BODY_BYTES = 256 * 1024;
const TOOL_TIMEOUT_MS = 45_000;

export const DEFAULTS = {
  rootDir: '',
  leaseTtlSeconds: 3600,
  protocolSection: true,
  briefing: 'context',
  briefingRefreshMs: 8_000,
  maxListedTasks: 60,
  command: true,
};

/** The prompt title is stable; only the pluggable body changes per task. */
const BRIEF_TITLE = '## Task ledger (external, canonical)';

export const inject = ['tools', 'systemPrompt'];

// --------------------------------------------------------------- config

function readConfig(raw) {
  const config = { ...DEFAULTS };
  const warnings = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(DEFAULTS, key)) warnings.push(`unknown config key "${key}" ignored`);
    }
    if (typeof raw.rootDir === 'string') config.rootDir = raw.rootDir;
    if (Number.isFinite(raw.leaseTtlSeconds)) config.leaseTtlSeconds = Math.max(60, Math.floor(raw.leaseTtlSeconds));
    if (typeof raw.protocolSection === 'boolean') config.protocolSection = raw.protocolSection;
    if (raw.briefing === 'context' || raw.briefing === 'off') config.briefing = raw.briefing;
    if (Number.isFinite(raw.briefingRefreshMs)) {
      config.briefingRefreshMs = Math.max(1_000, Math.floor(raw.briefingRefreshMs));
    }
    if (Number.isFinite(raw.maxListedTasks)) {
      config.maxListedTasks = Math.min(500, Math.max(1, Math.floor(raw.maxListedTasks)));
    }
    if (typeof raw.command === 'boolean') config.command = raw.command;
  }
  return { config, warnings };
}

// --------------------------------------------------------------- plumbing

function failure(error, fallbackCode = 'task-ledger-error') {
  if (error instanceof ledger.LedgerError) {
    return {
      ok: false,
      error: { message: error.message, code: error.code, ...(error.hint ? { hint: error.hint } : {}) },
    };
  }
  return {
    ok: false,
    error: {
      message: (error && error.message) || String(error),
      code: fallbackCode,
      hint: 'The ledger write did not complete; report this in the run report instead of claiming a closeout.',
    },
  };
}

function bulletList(items, { max = 12, prefix = '- ' } = {}) {
  if (!Array.isArray(items) || !items.length) return `${prefix}(none)`;
  const shown = items.slice(0, max).map((item) => `${prefix}${item}`);
  if (items.length > max) shown.push(`${prefix}… ${items.length - max} more`);
  return shown.join('\n');
}

function claimLine(claim) {
  const badge = claim.status === 'verified' ? 'verified' : claim.status === 'refuted' ? 'refuted' : 'UNVERIFIED';
  const cite = claim.source_ref || (claim.evidence_hash ? claim.evidence_hash.slice(0, 19) : '');
  const confidence = claim.confidence === null || claim.confidence === undefined ? '' : ` conf=${claim.confidence}`;
  return `- ${badge} ${claim.id}${confidence}: ${claim.claim}${cite ? ` — ${cite}` : ''}`;
}

function gateText(gate) {
  if (!gate) return '';
  const failed = gate.checks.filter((check) => !check.ok);
  if (!failed.length) return 'evidence gate: PASS';
  return ['evidence gate: FAIL', ...failed.map((check) => `- ${check.name}: ${check.detail}`)].join('\n');
}

function briefFromSnapshot(snapshot, { maxActions = 6 } = {}) {
  const { charter, state, claims, evidence, runs } = snapshot;
  const counts = { verified: 0, unverified: 0, refuted: 0 };
  for (const claim of claims) counts[claim.status] = (counts[claim.status] || 0) + 1;
  const lines = [];
  lines.push(`TASK \`${charter.task_id}\` — ${charter.title}`);
  lines.push(`goal: ${charter.goal}`);
  lines.push(
    `status: ${state.status} · phase: ${state.phase} · version ${state.version}` +
      (state.blocked_reason ? ` · blocked: ${state.blocked_reason}` : ''),
  );
  if (state.next_actions && state.next_actions.length) {
    lines.push(`next_actions:\n${bulletList(state.next_actions, { max: maxActions })}`);
  }
  if (state.open_questions && state.open_questions.length) {
    lines.push(`open_questions:\n${bulletList(state.open_questions, { max: maxActions })}`);
  }
  lines.push(
    `claims ${claims.length} (verified ${counts.verified}, refuted ${counts.refuted}, unverified ${counts.unverified}) · evidence files ${evidence.length}`,
  );
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  if (lastRun) {
    lines.push(`last_run ${lastRun.run_id} (${lastRun.ended_at || 'open'}) — ${(lastRun.summary || '').slice(0, 300)}`);
  }
  const unresolved = claims.filter((claim) => claim.status === 'unverified').slice(0, maxActions);
  if (unresolved.length) lines.push(`unresolved claims:\n${bulletList(unresolved.map((claim) => `${claim.id}: ${claim.claim}`), { max: maxActions })}`);
  return lines.join('\n');
}

function defineTool(name, description, parameters, execute, renderText) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    execute: async (args, exec) => {
      try {
        return await execute(args || {}, exec || {});
      } catch (error) {
        return failure(error);
      }
    },
    timeoutMs: TOOL_TIMEOUT_MS,
  };
}

// ---------------------------------------------------------- brief provider

/**
 * The runtime-context contribution: a compact ledger snapshot that is
 * re-rendered cheaply and only costs tokens when it actually changes.
 *
 * Network-free and sync on the read path: building the text is async, so the
 * provider returns the latest cached snapshot and a stale cache schedules a
 * refresh for the next assembly instead of blocking a model step.
 */
function createBriefer(root, config) {
  let text = '';
  let builtAt = 0;
  let pending = null;
  let lastError = null;

  async function build() {
    const overview = await ledger.ledgerOverview(root, { status: 'all', limit: config.maxListedTasks });
    const active = overview.activeTaskId
      ? overview.tasks.find((task) => task.task_id === overview.activeTaskId) || null
      : null;
    if (!active) {
      const actionable = overview.tasks.filter((task) => task.status === 'open' || task.status === 'blocked');
      if (!actionable.length) return '';
      const counts = overview.counts;
      const lines = [BRIEF_TITLE];
      lines.push(
        `active task: none pinned · ${counts.open} open · ${counts.blocked} blocked · ${counts.done} done · root \`${root}\``,
      );
      for (const task of actionable.slice(0, 5)) {
        const next = task.next_actions[0] ? ` · next: ${task.next_actions[0]}` : '';
        lines.push(`- \`${task.task_id}\` ${task.title} [${task.status}/${task.phase}]${next}`);
      }
      lines.push('Before planning: call `task_list`, then `task_resume` for the matching task_id.');
      return lines.join('\n');
    }
    const detail = await ledger.readTaskDetail(root, active.task_id);
    const counts = { verified: 0, unverified: 0, refuted: 0 };
    for (const claim of detail.claims) counts[claim.status] = (counts[claim.status] || 0) + 1;
    const lines = [BRIEF_TITLE];
    lines.push(
      `active task \`${active.task_id}\` — ${active.title} · status ${active.status} · phase ${active.phase} · version ${detail.state.version}${active.blocked_reason ? ` · blocked: ${active.blocked_reason}` : ''}`,
    );
    if (active.next_actions.length) lines.push(`next actions:\n${bulletList(active.next_actions, { max: 4 })}`);
    if (active.open_questions.length) lines.push(`open questions:\n${bulletList(active.open_questions, { max: 4 })}`);
    lines.push(
      `claims ${active.claim_count} (verified ${counts.verified}, refuted ${counts.refuted}, unverified ${counts.unverified}) · evidence ${active.evidence_count} · runs ${active.run_count}`,
    );
    const lastRun = detail.runs.length ? detail.runs[detail.runs.length - 1] : null;
    if (lastRun && lastRun.summary) lines.push(`last run ${lastRun.run_id} — ${lastRun.summary.slice(0, 220)}`);
    lines.push('Resume with `task_resume` before planning; write through `task_checkpoint`, close with `task_close`.');
    return lines.join('\n');
  }

  function refresh() {
    if (pending) return pending;
    pending = build()
      .then((next) => {
        text = next;
        builtAt = Date.now();
        lastError = null;
        return next;
      })
      .catch((error) => {
        lastError = error;
        return text;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  function current() {
    if (Date.now() - builtAt > config.briefingRefreshMs && !pending) void refresh();
    return text;
  }

  function status() {
    return { chars: text.length, builtAt, stale: Date.now() - builtAt > config.briefingRefreshMs, lastError: lastError ? String(lastError.message || lastError) : null };
  }

  void refresh();
  return { refresh, current, status };
}

// ------------------------------------------------------------- tool surface

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Existing claim id to supersede; omit to append a new claim.' },
    claim: { type: 'string', description: 'One falsifiable statement.' },
    status: { type: 'string', enum: ['unverified', 'verified', 'refuted'], description: 'Defaults to "unverified".' },
    confidence: { type: 'number', description: '0..1 subjective confidence.' },
    source_ref: { type: 'string', description: 'URL, file path, or source name that supports or refutes the claim.' },
    evidence_name: { type: 'string', description: 'Name of an evidence snapshot stored in this same call.' },
    evidence_hash: { type: 'string', description: 'sha256:... of the snapshot when already known.' },
    note: { type: 'string', description: 'Why the status is what it is (required in spirit for refutations).' },
  },
  required: ['claim'],
  additionalProperties: false,
};

const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Human/title name for the snapshot.' },
    url: { type: 'string', description: 'Where the snapshot came from.' },
    mime: { type: 'string', description: 'text/plain, text/html, application/json, application/pdf, image/png, ...' },
    content: { type: 'string', description: 'Inline snapshot text. Stored content-addressed; prefer this over linking.' },
    file_path: { type: 'string', description: 'Absolute path to copy into the ledger instead of inline content.' },
    note: { type: 'string', description: 'Why this snapshot is kept.' },
  },
  additionalProperties: false,
};

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', description: 'What was decided.' },
    rationale: { type: 'string', description: 'Why, including the tradeoff.' },
    rejected: { type: 'array', items: { type: 'string' }, description: 'Options considered and rejected.' },
    evidence_grade: { type: 'string', description: 'House evidence grade: [图] [源] [文] [表] [推] [?]' },
    approved_by: { type: 'string', description: 'Who approved it (person, agent, or "lead-agent").' },
  },
  required: ['decision'],
  additionalProperties: false,
};

function buildTools({ root, config, briefer }) {
  const tools = [];

  tools.push(
    defineTool(
      'task_list',
      'List task-ledger tasks with status, phase, claim/evidence counts, next action, and which task is pinned active. Call this first at the start of any long-running request: it is the routing step that decides whether the work continues an existing task or opens a new one. Read-only and cheap.',
      {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'blocked', 'done', 'archived', 'all'],
            description: 'Filter by lifecycle status. Defaults to "open"; use "all" to see finished tasks too.',
          },
          limit: { type: 'integer', description: 'Maximum tasks to return (1-200). Defaults to 60.' },
        },
        additionalProperties: false,
      },
      async (args) => {
        const status = typeof args.status === 'string' ? args.status : 'open';
        const allowed = ['open', 'blocked', 'done', 'archived', 'all'];
        if (!allowed.includes(status)) throw new ledger.LedgerError(`status must be one of ${allowed.join(', ')}.`, { code: 'invalid-argument' });
        const limit = Number.isFinite(args.limit) ? Math.min(200, Math.max(1, Math.floor(args.limit))) : config.maxListedTasks;
        const overview = await ledger.ledgerOverview(root, { status, limit });
        return { ok: true, root, active_task_id: overview.activeTaskId, counts: overview.counts, tasks: overview.tasks, warnings: overview.warnings };
      },
      (value) => {
        if (!value || value.ok === false) return failureText(value);
        const lines = [
          `ledger \`${value.root}\` · open ${value.counts.open} · blocked ${value.counts.blocked} · done ${value.counts.done} · pinned ${value.active_task_id ? `\`${value.active_task_id}\`` : 'none'}`,
        ];
        if (!value.tasks.length) {
          lines.push('(no tasks match this filter)');
        } else {
          for (const task of value.tasks) {
            const next = task.next_actions.length ? ` · next: ${task.next_actions[0]}` : '';
            const blocked = task.blocked_reason ? ` · blocked: ${task.blocked_reason}` : '';
            lines.push(
              `- \`${task.task_id}\` ${task.title} [${task.status}/${task.phase}] v${task.version} claims ${task.claim_count} evidence ${task.evidence_count}${next}${blocked} · updated ${task.updated_at}`,
            );
          }
          lines.push('Next: `task_resume` the matching task_id before planning; `task_open` if none matches.');
        }
        if (value.warnings && value.warnings.length) lines.push(`warnings: ${value.warnings.slice(0, 5).join(' | ')}`);
        return lines.join('\n');
      },
    ),
  );

  tools.push(
    defineTool(
      'task_open',
      'Create a new task ledger: an immutable charter (goal, research questions, acceptance criteria, evidence bar, budget, tags) plus initial state. Use it when a request starts work that will outlive this conversation; then call task_resume to take the run lease. Returns the new task_id.',
      {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short task title, used in the id and the index.' },
          goal: { type: 'string', description: 'What must be true when this task is done.' },
          research_questions: { type: 'array', items: { type: 'string' }, description: 'Questions the work must answer.' },
          acceptance: { type: 'array', items: { type: 'string' }, description: 'Explicit acceptance criteria.' },
          evidence_bar: { type: 'string', description: 'What counts as evidence for this task.' },
          budget: { type: 'object', description: 'Free-form budget, for example { "max_runs": 5, "max_hours": 3 }.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Labels for routing and filtering.' },
          owner: { type: 'string', description: 'Accountable owner label. Defaults to "lead-agent".' },
          task_id: { type: 'string', description: 'Optional explicit id (lowercase, [a-z0-9._-]). Defaults to date + title slug.' },
        },
        required: ['title', 'goal'],
        additionalProperties: false,
      },
      async (args) => {
        const created = await ledger.createTask(root, args, config);
        void briefer.refresh();
        return { ok: true, task_id: created.charter.task_id, charter: created.charter, state: created.state };
      },
      (value) => {
        if (!value || value.ok === false) return failureText(value);
        return [
          `opened task \`${value.task_id}\` (status ${value.state.status}, phase ${value.state.phase})`,
          `goal: ${value.charter.goal}`,
          `evidence bar: ${value.charter.evidence_bar}`,
          value.charter.research_questions.length ? `research questions:\n${bulletList(value.charter.research_questions)}` : '',
          'Next: call `task_resume` with this task_id to take the run lease before writing.',
        ]
          .filter(Boolean)
          .join('\n');
      },
    ),
  );

  tools.push(
    defineTool(
      'task_resume',
      'Resume a task from the ledger: read the canonical state, take the single-writer lease for this run, and return a run_id that every write must carry. Use this instead of reconstructing prior work from chat history, after a compaction, in a fresh session, or before answering a question about an existing task. Fails when another live run holds the lease.',
      {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task id from task_list or from the user.' },
          label: { type: 'string', description: 'Optional label for this run (what this session is doing).' },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
      async (args, exec) => {
        const snapshot = await ledger.resumeTask(root, args.task_id, {
          sessionId: exec.agent && exec.agent.id ? String(exec.agent.id) : null,
          label: typeof args.label === 'string' ? args.label : '',
          leaseTtlSeconds: config.leaseTtlSeconds,
        });
        void briefer.refresh();
        return { ok: true, run_id: snapshot.run_id, lease: snapshot.lease, brief: briefFromSnapshot(snapshot), snapshot: {
          charter: snapshot.charter,
          state: snapshot.state,
          claims: snapshot.claims,
          evidence: snapshot.evidence.map((item) => ({ name: item.name, url: item.url, sha256: item.sha256, fetched_at: item.fetched_at })),
          runs: snapshot.runs.map((run) => ({ run_id: run.run_id, started_at: run.started_at, ended_at: run.ended_at, summary: run.summary, next_actions: run.next_actions })),
          warnings: snapshot.warnings,
        } };
      },
      (value) => {
        if (!value || value.ok === false) return failureText(value);
        return [
          `run_id: \`${value.run_id}\` (lease until ${value.lease && value.lease.expires_at ? value.lease.expires_at : 'unknown'})`,
          `state version: ${value.snapshot.state.version} — use this as expected_version for this run's checkpoint/close (task_resume bumps the version, so never reuse a value read before resuming)`,
          '',
          value.brief,
          '',
          'Write with `task_checkpoint` (pass this run_id); finish with `task_close`.',
        ].join('\n');
      },
    ),
  );

  tools.push(
    defineTool(
      'task_checkpoint',
      'Write progress to the ledger: append evidence snapshots, claims, and decisions, and update phase / next actions / open questions. This is the only sanctioned way to advance a task mid-run — never write ledger files directly. Requires the run_id from task_resume and fails on a stale lease or stale expected_version.',
      {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'The run_id returned by task_resume.' },
          task_id: { type: 'string', description: 'Task id; optional when the run_id is already known.' },
          phase: { type: 'string', enum: ['intake', 'evidence', 'synthesis', 'delivery'], description: 'Move the task phase forward.' },
          status: { type: 'string', enum: ['open', 'blocked'], description: 'Set status; use task_close for done.' },
          blocked_reason: { type: 'string', description: 'Why the task is blocked (used with status "blocked").' },
          open_questions: { type: 'array', items: { type: 'string' }, description: 'Replacement open-question list.' },
          next_actions: { type: 'array', items: { type: 'string' }, description: 'Replacement next-action list; this is the handoff to the next run.' },
          note: { type: 'string', description: 'Free-text run note, appended as a decision record.' },
          claims: { type: 'array', items: CLAIM_SCHEMA, description: 'Claims to append (same id supersedes an earlier claim).' },
          decisions: { type: 'array', items: DECISION_SCHEMA, description: 'Decisions to append.' },
          evidence: { type: 'array', items: EVIDENCE_SCHEMA, description: 'Evidence snapshots to store (content-addressed under evidence/).' },
          expected_version: { type: 'integer', description: 'Optimistic lock: the state version returned by task_resume or by your last write. task_resume bumps the version, so do not reuse a value from task_list.' },
        },
        required: ['run_id'],
        additionalProperties: false,
      },
      async (args) => {
        const taskId = await resolveTaskId(root, args);
        const result = await ledger.checkpointTask(root, taskId, args.run_id, args, config);
        void briefer.refresh();
        return { ok: true, task_id: taskId, version: result.state.version, state: result.state, appended: result.appended, gate: result.gate, evidence: result.evidence };
      },
      (value) => {
        if (!value || value.ok === false) return failureText(value);
        const appended = value.appended;
        return [
          `checkpoint written: task \`${value.task_id}\` now v${value.version} (${appended.claims} claims, ${appended.decisions} decisions, ${appended.evidence} evidence files appended)`,
          gateText(value.gate),
          `next actions:\n${bulletList(value.state.next_actions)}`,
          value.state.blocked_reason ? `blocked: ${value.state.blocked_reason}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    ),
  );

  tools.push(
    defineTool(
      'task_close',
      'Close the current run: write the run handoff report (summary, findings, failures, next actions, open questions), run the evidence gate, update the task state, and release the lease. Use it at the end of every run, including failed ones (status "blocked"). A failing gate blocks "done" unless force is set, and any override is recorded.',
      {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'The run_id returned by task_resume for this run.' },
          task_id: { type: 'string', description: 'Task id; optional when the run_id is already known.' },
          summary: { type: 'string', description: 'What this run did and where the task now stands. Required.' },
          findings: { type: 'array', items: { type: 'string' }, description: 'Concrete findings worth keeping.' },
          failures: { type: 'array', items: { type: 'string' }, description: 'What failed, was refused, or remains unproven.' },
          next_actions: { type: 'array', items: { type: 'string' }, description: 'What the next run should do first.' },
          open_questions: { type: 'array', items: { type: 'string' }, description: 'Questions still open.' },
          status: { type: 'string', enum: ['done', 'blocked'], description: 'Outcome. Defaults to "done"; a failing gate downgrades it to "blocked".' },
          blocked_reason: { type: 'string', description: 'Why the task is blocked, when status is "blocked".' },
          force: { type: 'boolean', description: 'Close as done even though the evidence gate fails (recorded as an override decision).' },
          claims: { type: 'array', items: CLAIM_SCHEMA, description: 'Final claims to append before gating.' },
          decisions: { type: 'array', items: DECISION_SCHEMA, description: 'Final decisions to append before gating.' },
          evidence: { type: 'array', items: EVIDENCE_SCHEMA, description: 'Final evidence snapshots to store.' },
          expected_version: { type: 'integer', description: 'Optimistic lock: the state version returned by task_resume or by your last write.' },
        },
        required: ['run_id', 'summary'],
        additionalProperties: false,
      },
      async (args) => {
        const taskId = await resolveTaskId(root, args);
        const result = await ledger.closeTask(root, taskId, args.run_id, args, config);
        void briefer.refresh();
        return {
          ok: true,
          task_id: taskId,
          run_id: args.run_id,
          status: result.state.status,
          version: result.state.version,
          gate: result.gate,
          run: result.run,
          report: path.join(root, 'tasks', taskId, 'runs', `${args.run_id}.md`),
        };
      },
      (value) => {
        if (!value || value.ok === false) return failureText(value);
        return [
          `run closed: task \`${value.task_id}\` is now **${value.status}** (v${value.version})`,
          gateText(value.gate),
          `handoff report: \`${value.report}\``,
          `next actions:\n${bulletList(value.run.next_actions)}`,
          value.run.failures.length ? `failures recorded:\n${bulletList(value.run.failures, { max: 6 })}` : '',
          value.status === 'blocked' ? 'Task is blocked; nothing more will run until it is reopened or the blocker is cleared.' : 'Task is done; do not keep working it in this session.',
        ]
          .filter(Boolean)
          .join('\n');
      },
    ),
  );

  return tools;
}

function failureText(value) {
  const error = (value && value.error) || {};
  return [
    `ledger call failed: ${error.message || 'unknown error'}${error.code ? ` (${error.code})` : ''}`,
    error.hint ? `hint: ${error.hint}` : '',
    'Nothing was written. Report this failure rather than assuming the write landed.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function resolveTaskId(root, args) {
  if (typeof args.task_id === 'string' && args.task_id.trim()) return args.task_id.trim();
  if (typeof args.run_id !== 'string' || !args.run_id.trim()) {
    throw new ledger.LedgerError('run_id is required.', { code: 'invalid-argument', hint: 'Call task_resume first; it returns the run_id.' });
  }
  return ledger.resolveTaskForRun(root, args.run_id.trim());
}

// ---------------------------------------------------------------- commands

function buildCommand({ root, config, briefer }) {
  return {
    name: 'task',
    description: 'Inspect or drive the task ledger: list | show <id> | active <id> | done <id> | block <id> <reason> | clear',
    input: { hint: '[list | show <task_id> | active <task_id> | done <task_id> | block <task_id> <reason> | clear]' },
    handler: async (invocation) => {
      const raw = String(invocation.rawInput || '').trim();
      const [sub, ...rest] = raw.split(/\s+/);
      const taskId = rest[0];
      try {
        if (!sub || sub === 'list') {
          const overview = await ledger.ledgerOverview(root, { status: 'all', limit: config.maxListedTasks });
          const lines = [
            `ledger ${root} · open ${overview.counts.open} · blocked ${overview.counts.blocked} · done ${overview.counts.done} · pinned ${overview.activeTaskId || 'none'}`,
          ];
          for (const task of overview.tasks) {
            const next = task.next_actions[0] ? ` · next: ${task.next_actions[0]}` : '';
            lines.push(`- ${task.task_id}  ${task.title}  [${task.status}/${task.phase}]${next}`);
          }
          if (!overview.tasks.length) lines.push('(no tasks yet — the agent creates them with task_open)');
          return { kind: 'success', text: lines.join('\n') };
        }
        if (sub === 'show' && taskId) {
          const detail = await ledger.readTaskDetail(root, taskId);
          const lines = [
            `${detail.summary.task_id}  ${detail.summary.title}`,
            `status ${detail.summary.status} · phase ${detail.summary.phase} · v${detail.state.version}`,
            `goal: ${detail.charter.goal}`,
            `next: ${detail.summary.next_actions.join(' | ') || '(none)'}`,
            `claims ${detail.summary.claim_count} (verified ${detail.summary.claim_counts.verified}, refuted ${detail.summary.claim_counts.refuted}, unverified ${detail.summary.claim_counts.unverified}) · evidence ${detail.summary.evidence_count}`,
          ];
          for (const claim of detail.claims.slice(0, 10)) lines.push(claimLine(claim));
          return { kind: 'success', text: lines.join('\n') };
        }
        if (sub === 'active' && taskId) {
          await ledger.setActiveTaskId(root, taskId, { sessionId: invocation.agent ? String(invocation.agent.id) : null });
          await briefer.refresh();
          return { kind: 'success', text: `pinned ${taskId}; the runtime context now carries its snapshot.` };
        }
        if (sub === 'clear') {
          await ledger.setActiveTaskId(root, null);
          await briefer.refresh();
          return { kind: 'success', text: 'no active task pinned.' };
        }
        if (sub === 'done' && taskId) {
          await ledger.setTaskStatus(root, taskId, 'done', { reason: rest.slice(1).join(' ') || 'Marked done from /task.', actor: 'command' });
          await briefer.refresh();
          return { kind: 'success', text: `${taskId} marked done.` };
        }
        if ((sub === 'block' || sub === 'blocked') && taskId) {
          await ledger.setTaskStatus(root, taskId, 'blocked', { reason: rest.slice(1).join(' '), actor: 'command' });
          await briefer.refresh();
          return { kind: 'success', text: `${taskId} marked blocked.` };
        }
        return { kind: 'error', text: 'usage: /task [list | show <id> | active <id> | done <id> | block <id> <reason> | clear]' };
      } catch (error) {
        return { kind: 'error', text: `${error.message || error}${error.hint ? ` — ${error.hint}` : ''}` };
      }
    },
  };
}

// ----------------------------------------------------------------- routes

function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new ledger.LedgerError('Request body is too large.', { code: 'invalid-argument' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

function parseJsonBody(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new ledger.LedgerError('Request body must be a JSON object.', { code: 'invalid-argument' });
  }
}

function sendNodeResponse(res, method, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(method === 'HEAD' ? {} : { 'content-length': String(Buffer.byteLength(text, 'utf8')) }),
  });
  if (method === 'HEAD') res.end();
  else res.end(text);
}

function resolveConnection(ctx) {
  try {
    return ctx.get('connection');
  } catch {
    return undefined;
  }
}

/** One request, one decision. Every route fails closed when admission is unavailable. */
async function dispatchRoute({ method, pathname, searchParams, headers, bodyText, connection, root, config, briefer }) {
  if (!connection || typeof connection.requestRejection !== 'function') {
    return { status: 503, payload: { ok: false, error: { message: 'The task ledger panel needs the Harness connection service.', code: 'unavailable' } } };
  }
  const rejection = connection.requestRejection({ headers });
  if (rejection) {
    return { status: rejection, payload: { ok: false, error: { message: 'Unauthorized', code: 'unauthorized' } } };
  }
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(ROUTE_PREFIX + '/')) {
    return { status: 404, payload: { ok: false, error: { message: 'Not found', code: 'not-found' } } };
  }
  const route = pathname.slice(ROUTE_PREFIX.length) || '/';
  const verb = method === 'HEAD' ? 'GET' : method;
  try {
    if (verb === 'GET') {
      if (route === '/index' || route === '/') {
        const status = searchParams.get('status') || 'all';
        const statuses = ['open', 'blocked', 'done', 'archived', 'all'];
        if (!statuses.includes(status)) {
          throw new ledger.LedgerError(`status must be one of ${statuses.join(', ')}.`, { code: 'invalid-argument' });
        }
        const overview = await ledger.ledgerOverview(root, { status, limit: 200 });
        return {
          status: 200,
          payload: { ok: true, data: { tasks: overview.tasks, counts: overview.counts, activeTaskId: overview.activeTaskId, root } },
        };
      }
      if (route === '/task') {
        const taskId = searchParams.get('task_id');
        if (!taskId) throw new ledger.LedgerError('task_id is required.', { code: 'invalid-argument' });
        return { status: 200, payload: { ok: true, data: { task: await ledger.readTaskDetail(root, taskId) } } };
      }
      return { status: 404, payload: { ok: false, error: { message: `Unknown route: GET ${route}`, code: 'not-found' } } };
    }
    if (verb === 'POST') {
      const body = parseJsonBody(bodyText);
      if (route === '/status') {
        const status = String(body.status || '');
        const state = await ledger.setTaskStatus(root, String(body.task_id || ''), status, {
          reason: typeof body.reason === 'string' ? body.reason : '',
          actor: 'panel',
          config,
        });
        void briefer.refresh();
        const detail = await ledger.readTaskDetail(root, String(body.task_id));
        return { status: 200, payload: { ok: true, data: { task: detail.summary, state } } };
      }
      if (route === '/active') {
        const next = body.task_id === null ? null : String(body.task_id || '');
        await ledger.setActiveTaskId(root, next);
        void briefer.refresh();
        return { status: 200, payload: { ok: true, data: { activeTaskId: next } } };
      }
      return { status: 404, payload: { ok: false, error: { message: `Unknown route: POST ${route}`, code: 'not-found' } } };
    }
    return { status: 405, payload: { ok: false, error: { message: `Method not allowed: ${method}`, code: 'method-not-allowed' } } };
  } catch (error) {
    return { status: httpStatusFor(error), payload: { ok: false, error: { message: (error && error.message) || String(error), code: (error && error.code) || 'internal' } } };
  }
}

/** Map ledger error codes to HTTP statuses; unknown failures stay 500. */
function httpStatusFor(error) {
  const code = error instanceof ledger.LedgerError ? error.code : '';
  if (['invalid-argument', 'invalid-task-id', 'invalid-run-id'].includes(code)) return 400;
  if (['task-not-found', 'run-not-found'].includes(code)) return 404;
  if (code === 'task-exists' || code === 'ledger-busy') return 409;
  return 500;
}

function createRouteHandler(services) {
  return async (req, res) => {
    const method = req.method || 'GET';
    const headers = req.headers || {};
    try {
      let pathname = '/';
      let searchParams = new URLSearchParams();
      try {
        const url = new URL(req.url || '/', `http://${headers.host || '127.0.0.1'}`);
        pathname = url.pathname;
        searchParams = url.searchParams;
      } catch {
        sendNodeResponse(res, method, 400, { ok: false, error: { message: 'Malformed request URL.', code: 'invalid-argument' } });
        return;
      }
      let bodyText = '';
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') bodyText = await readNodeBody(req);
      const result = await dispatchRoute({
        method,
        pathname,
        searchParams,
        headers,
        bodyText,
        connection: resolveConnection(services.ctx),
        root: services.root,
        config: services.config,
        briefer: services.briefer,
      });
      sendNodeResponse(res, method, result.status, result.payload);
    } catch (error) {
      sendNodeResponse(res, method, httpStatusFor(error), { ok: false, error: { message: (error && error.message) || String(error), code: (error && error.code) || 'internal' } });
    }
  };
}

// ------------------------------------------------------------------ plugin

export function apply(ctx, rawConfig) {
  const { config, warnings } = readConfig(rawConfig);
  const root = ledger.resolveRoot({ rootDir: config.rootDir });
  const briefer = createBriefer(root, config);

  for (const warning of warnings) {
    void ledger.appendAudit(root, { event: 'config-warning', detail: warning });
  }

  for (const definition of buildTools({ root, config, briefer })) {
    ctx.effect(() => ctx.tools.register(definition));
  }

  if (config.protocolSection) {
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: Number.isFinite(ctx.systemPrompt.getSectionOrder('TOOL_GOAL'))
          ? ctx.systemPrompt.getSectionOrder('TOOL_GOAL') + 50
          : 2450,
        text: protocolText({ root }),
        interpolate: false,
      }),
    );
  }

  if (config.briefing === 'context') {
    ctx.effect(() =>
      ctx.systemPrompt.context({
        name: 'task-ledger-briefing',
        order: 130,
        text: () => briefer.current(),
        interpolate: false,
      }),
    );
    // A session start is the moment external edits (another agent, a manual
    // file fix) must be picked up before the model sees the snapshot.
    ctx.effect(() => {
      const dispose = ctx.on('agent/created', () => {
        void briefer.refresh();
      });
      return typeof dispose === 'function' ? dispose : () => {};
    });
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createRouteHandler({ ctx: webCtx, root, config, briefer }),
      }),
    );
  });

  if (config.command) {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.effect(() => commandCtx.commands.register(buildCommand({ root, config, briefer })));
    });
  }

  // Keep the derived index honest at load time even if it was deleted.
  void regenerateIndex(root, config).catch((error) => {
    void ledger.appendAudit(root, { event: 'index-regenerate-failed', detail: String((error && error.message) || error) });
  });
  void ledger.appendAudit(root, { event: 'plugin-loaded', detail: { root, protocolSection: config.protocolSection, briefing: config.briefing } });
}
