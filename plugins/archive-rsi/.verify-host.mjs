#!/usr/bin/env node
/**
 * Stub-context acceptance harness for the `dsh-archive-rsi` HOST half.
 *
 * Written from DESIGN.md alone (the frozen build contract). It never installs
 * the bundle: it imports `index.js`/`archive.js`/`alchemy.js` directly, builds a
 * fake Cordis-like context (tools / systemPrompt / webServer / connection) and
 * drives every surface the contract describes: config, zstd decoding, facts,
 * the on-disk store, cohort metrics, R1-R10, the automatic §10 tags, the PDCA
 * loop, proposal adoption, the eleven `archive_*`/`rsi_*` tools, and the
 * `/api/archive-rsi/*` routes.
 *
 * Test roots live under $TMPDIR (or /tmp) and are removed before exit.
 * Exit code 0 only when every check passes.
 *
 * Usage: node archive-rsi/.verify-host.mjs [--skip-e2e]
 *
 * Signature notes (where DESIGN.md is silent): the return shape of
 * `readConfig` is `{ config, warnings }` and `applyProposal`/`revertProposal`
 * consult `proposal.adoption.beforeSha` as the "recorded" sha of DESIGN §6.1.
 * Both were confirmed by reading the exported function bodies, not by reading
 * the design intent of any module.
 */

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const indexModule = await import(pathToFileURL(path.join(HERE, 'index.js')).href);
const archiveModule = await import(pathToFileURL(path.join(HERE, 'archive.js')).href);
const alchemyModule = await import(pathToFileURL(path.join(HERE, 'alchemy.js')).href);
const workspaceArchiveModule = await import(pathToFileURL(path.join(HERE, 'workspace-archive.js')).href);

const { readConfig, finishCheck } = indexModule;
const {
  ArchiveStore,
  scanZstdFrames,
  decodeSessionFile,
  computeFacts,
  deriveTitle,
  renderTranscript,
  deriveAutoTags,
  mergeTags,
  strictTags,
  normalizeTags,
  DEFAULT_EDIT_TOOLS,
  DEFAULT_CHECK_TOOLS,
} = archiveModule;
const {
  cohortMetrics,
  median,
  percentile,
  deriveFindings,
  planRun,
  executeDo,
  executeCheck,
  proposalsFor,
  planProposals,
  proposalFingerprint,
  applyProposal,
  revertProposal,
  slugifySkill,
  DEFAULT_TARGETS,
  RUN_STATUSES,
  RUN_STALE_MS,
  summarizeRun,
} = alchemyModule;

// =============================================================== result plumbing

const SUMMARY = { pass: 0, fail: 0, skip: 0, records: [] };
const tempRoots = [];
const SKIPS = [];

function printPass(id, description, detail) {
  SUMMARY.pass += 1;
  SUMMARY.records.push({ id, description, ok: true, detail: detail || '' });
  console.log(`PASS  ${id}  ${description}${detail ? `  [${detail}]` : ''}`);
}

function printFail(id, description, detail) {
  SUMMARY.fail += 1;
  SUMMARY.records.push({ id, description, ok: false, detail: detail || '' });
  console.log(`FAIL  ${id}  ${description}  [${detail}]`);
}

function printSkip(id, description, reason) {
  SUMMARY.skip += 1;
  SKIPS.push({ id, description, reason });
  console.log(`SKIP  ${id}  ${description}  [${reason}]`);
}

async function check(id, description, fn) {
  try {
    const detail = await fn();
    printPass(id, description, typeof detail === 'string' ? detail : '');
  } catch (error) {
    printFail(id, description, (error && error.message) || String(error));
  }
}

// ===================================================================== asserts

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual, expected, what, eps = 1e-9) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    throw new Error(`${what}: expected a finite number ${expected}, got ${String(actual)}`);
  }
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

function assertMatch(value, regex, what) {
  if (typeof value !== 'string' || !regex.test(value)) {
    throw new Error(`${what}: ${JSON.stringify(value)} does not match ${regex}`);
  }
}

function assertArray(value, what) {
  if (!Array.isArray(value)) throw new Error(`${what}: expected an array, got ${typeof value}`);
}

function assertNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what}: expected a finite number, got ${JSON.stringify(value)}`);
  }
}

function collectNumbers(value, out = []) {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectNumbers(item, out);
  return out;
}

function sameSha(a, b) {
  return a === b;
}

/**
 * The caller-owned half of `entry.tags` (DESIGN §10.1): everything that is not
 * in `entry.autoTags`. Used by the pre-§10 update/PATCH checks, which assert an
 * exact manual list while the plugin-owned auto half must stay visible.
 */
function manualTags(entry) {
  const auto = new Set(Array.isArray(entry && entry.autoTags) ? entry.autoTags : []);
  return (Array.isArray(entry && entry.tags) ? entry.tags : []).filter((tag) => !auto.has(tag));
}

// =================================================================== utilities

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJson(file) {
  const text = await readText(file);
  if (text === null) throw new Error(`expected file to exist: ${file}`);
  return JSON.parse(text);
}

function sha256(bufferOrText) {
  return createHash('sha256').update(bufferOrText).digest('hex');
}

/** sha256 of a file's bytes, or null when it does not exist. */
async function fileState(target) {
  try {
    return sha256(await fs.readFile(target));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function makeBase(label) {
  const base = await fs.mkdtemp(path.join(tmpdir(), `dsh-archive-rsi-verify-${label}-`));
  tempRoots.push(base);
  return base;
}

async function realSessionFiles() {
  const root = path.join(homedir(), '.dsh', 'sessions');
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (/^session\..+\.jsonl\.zstd$/.test(entry.name)) files.push(target);
    }
  }
  await walk(root);
  files.sort();
  return files;
}

/** Copy `count` real session files into <base>/sessions/<slug>/<id>/session.v4.jsonl.zstd. */
async function copySessionFixture(base, files, count) {
  const root = path.join(base, 'sessions');
  const copies = [];
  for (let index = 0; index < Math.min(count, files.length); index += 1) {
    const source = files[index];
    const id = path.basename(path.dirname(source));
    const slug = path.basename(path.dirname(path.dirname(source))) || `slug-${index}`;
    const dir = path.join(root, slug, id);
    await fs.mkdir(dir, { recursive: true });
    const destination = path.join(dir, 'session.v4.jsonl.zstd');
    await fs.copyFile(source, destination);
    copies.push({ id, slug, file: destination, source });
  }
  return { root, copies };
}

function frame(body) {
  return zstdCompressSync(Buffer.from(body, 'utf8'));
}

/** Write one authored session as a concatenation of one-frame-per-JSONL-row. */
async function writeSessionFixture(sessionsRoot, slug, { header, events }) {
  const dir = path.join(sessionsRoot, slug, header.id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const rows = [header, ...events].map((row) => `${JSON.stringify(row)}\n`);
  await fs.writeFile(file, Buffer.concat(rows.map((row) => frame(row))));
  return { file, root: sessionsRoot };
}

/** Entry count of <root>/archive.json, 0 when absent/unreadable. */
async function entryCount(root) {
  try {
    const index = JSON.parse(await fs.readFile(path.join(root, 'archive.json'), 'utf8'));
    return Object.keys(index.entries || {}).length;
  } catch {
    return 0;
  }
}

/** Wait until the boot-path entry count stops changing (or ~20 s), then return it. */
async function waitForStableEntryCount(root) {
  let previous = await entryCount(root);
  let stable = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await sleep(100);
    const current = await entryCount(root);
    if (current === previous) {
      stable += 1;
      if (stable >= 5) return current;
    } else {
      previous = current;
      stable = 0;
    }
  }
  return previous;
}

// ============================================================== stub ctx (host)

function createStub({ connection, sectionOrder = 2300 } = {}) {
  const ref = { value: connection };
  const state = {
    disposers: [],
    tools: new Map(),
    sections: [],
    contexts: [],
    events: [],
    routes: [],
    commands: [],
    injections: [],
  };
  const ctx = {
    state,
    ref,
    effect(fn) {
      const disposer = fn();
      state.disposers.push(disposer);
      return disposer;
    },
    tools: {
      register(definition) {
        state.tools.set(definition.name, definition);
        return () => {};
      },
    },
    systemPrompt: {
      section(definition) {
        state.sections.push(definition);
        return () => {};
      },
      context(definition) {
        state.contexts.push(definition);
        return () => {};
      },
      getSectionOrder() {
        return sectionOrder;
      },
      getContextOrder() {
        return 100;
      },
    },
    on(event, handler) {
      state.events.push({ event, handler });
      return () => {};
    },
    get(name) {
      return name === 'connection' ? ref.value : undefined;
    },
    webServer: {
      register(definition) {
        state.routes.push(definition);
        return () => {};
      },
    },
    commands: {
      register(definition) {
        state.commands.push(definition);
        return () => {};
      },
    },
  };
  ctx.inject = (deps, callback) => {
    const child = Object.create(ctx);
    for (const dep of deps) if (Object.hasOwn(ctx, dep)) child[dep] = ctx[dep];
    state.injections.push([...deps]);
    callback(child);
    return () => {};
  };
  return { ctx, ref, state };
}

async function applyPlugin(options) {
  const stub = createStub({ connection: options.connection });
  const returned = indexModule.apply(stub.ctx, options.config);
  if (returned && typeof returned.then === 'function') await returned;
  await sleep(120);
  return stub;
}

async function callTool(stub, name, args = {}, agentId = 'session-verify') {
  const definition = stub.state.tools.get(name);
  if (!definition) throw new Error(`tool ${name} is not registered`);
  const exec = agentId ? { agent: { id: agentId } } : {};
  return definition.execute(args, exec);
}

// ============================================================== http fixtures

function makeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeRes() {
  return {
    status: undefined,
    headers: null,
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers || {};
    },
    end(chunk) {
      this.body = chunk === undefined ? '' : String(chunk);
    },
  };
}

async function httpCall(handler, options) {
  const res = makeRes();
  await handler(makeReq(options), res);
  let json = null;
  if (res.body) {
    try {
      json = JSON.parse(res.body);
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, body: res.body, json };
}

// ================================================================ facts builders

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = { ...base[key], ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** A complete DESIGN §3 SessionFacts object with neutral values. */
function makeFacts(overrides = {}) {
  const base = {
    sessionId: 's0',
    createdAt: 1_700_000_000_000,
    endedAt: 1_700_000_100_000,
    cwd: '/tmp/project',
    slug: 'project',
    origin: 'user',
    agentPreset: null,
    parentSession: null,
    delegationDepth: 0,
    title: 'fixture session',
    formatVersion: 4,
    counters: {
      events: 100,
      turns: 0,
      steps: 0,
      userMessages: 0,
      humanMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      toolErrors: 0,
      llmRetries: 0,
      subagentDescriptors: 0,
      teamTasks: 0,
      approvals: 0,
      commands: 0,
      interrupts: 0,
      compactions: 0,
    },
    tools: [],
    catalog: { bytes: 0, toolCount: 0, tools: [] },
    skillCatalog: { bytes: 0, entries: 0 },
    repeated: [],
    humanTexts: [],
    edits: { count: 0, seqs: [], byTool: {} },
    checks: { count: 0, seqs: [], lastSeq: 0 },
    afterLastEditChecks: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
    contextWindow: 0,
    peakInputTokens: 0,
    peakContextRatio: 0,
    turnEnds: {},
    durations: { totalMs: 0, maxTurnMs: 0, maxStepMs: 0 },
    errorSamples: [],
    interrupted: false,
  };
  return deepMerge(base, overrides);
}

function toolRow(name, calls, errors, errorCodes = {}) {
  return { name, calls, errors, errorCodes, resultBytes: 0, inputBytes: 0, firstSeq: 1, lastSeq: 10 };
}

/**
 * The three synthetic sessions used by the cohort-metrics checks. Every number
 * below is hand-computed from DESIGN §5.1 in the check that asserts it.
 */
function metricFacts() {
  const f1 = makeFacts({
    sessionId: 's1',
    createdAt: 1_700_000_000_000,
    counters: { turns: 4, toolCalls: 10, toolResults: 10, toolErrors: 2 },
    tools: [toolRow('a', 5, 2, { EINVALID: 2 })],
    catalog: { bytes: 40000, toolCount: 4, tools: [ { name: 'a', bytes: 12000 }, { name: 'b', bytes: 12000 }, { name: 'c', bytes: 12000 }, { name: 'd', bytes: 4000 } ] },
    skillCatalog: { bytes: 500, entries: 3 },
    repeated: [{ name: 'read', argKey: 'aaaaaaaaaaaa', times: 3, seqs: [5, 6, 7] }],
    humanTexts: [
      { seq: 31, chars: 15, text: 'no, that is wrong' },
      { seq: 32, chars: 12, text: 'still broken' },
    ],
    edits: { count: 2, seqs: [20, 21], byTool: { write: 2 } },
    checks: { count: 1, seqs: [22], lastSeq: 22 },
    afterLastEditChecks: 1,
    usage: { inputTokens: 300000, outputTokens: 100000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 400000 },
    peakContextRatio: 0.5,
    turnEnds: { completed: 4 },
    durations: { totalMs: 1000, maxTurnMs: 400, maxStepMs: 100 },
  });
  const f2 = makeFacts({
    sessionId: 's2',
    createdAt: 1_700_000_100_000,
    counters: { turns: 6, toolCalls: 5, toolResults: 5, toolErrors: 0 },
    tools: [toolRow('a', 5, 0, {})],
    catalog: { bytes: 52000, toolCount: 2, tools: [ { name: 'a', bytes: 26000 }, { name: 'e', bytes: 26000 } ] },
    skillCatalog: { bytes: 0, entries: 0 },
    humanTexts: [{ seq: 10, chars: 12, text: 'please continue' }],
    usage: { inputTokens: 200000, outputTokens: 100000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300000 },
    peakContextRatio: 0.2,
    turnEnds: { completed: 5, error: 1 },
    durations: { totalMs: 0, maxTurnMs: 0, maxStepMs: 0 },
  });
  const f3 = makeFacts({
    sessionId: 's3',
    createdAt: 1_700_000_200_000,
    counters: { turns: 5, toolCalls: 5, toolResults: 5, toolErrors: 1 },
    tools: [toolRow('a', 5, 1, { ENOENT: 1 })],
    catalog: { bytes: 30000, toolCount: 1, tools: [ { name: 'a', bytes: 30000 } ] },
    skillCatalog: { bytes: 800, entries: 5 },
    repeated: [{ name: 'grep', argKey: 'bbbbbbbbbbbb', times: 2, seqs: [40, 41] }],
    humanTexts: [
      { seq: 11, chars: 10, text: 'wrong again' },
      { seq: 12, chars: 20, text: "that's not what I asked" },
      { seq: 13, chars: 9, text: 'revert that' },
      { seq: 14, chars: 4, text: '还是不行' },
    ],
    edits: { count: 1, seqs: [30], byTool: { edit: 1 } },
    checks: { count: 0, seqs: [], lastSeq: 0 },
    afterLastEditChecks: 0,
    usage: { inputTokens: 100000, outputTokens: 100000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 200000 },
    peakContextRatio: 0.9,
    turnEnds: { completed: 4, aborted: 1 },
    durations: { totalMs: 3000, maxTurnMs: 900, maxStepMs: 200 },
  });
  return [f1, f2, f3];
}

/** A dirty corpus that carries evidence for every rule R1-R10. */
function ruleFacts() {
  const s1 = makeFacts({
    sessionId: 'rule-1',
    counters: { turns: 4, toolCalls: 10, toolErrors: 9 },
    tools: [toolRow('bash', 10, 9, { EINVALID: 9 })],
    catalog: { bytes: 40000, toolCount: 3, tools: [ { name: 'bash', bytes: 1000 }, { name: 'read', bytes: 1000 }, { name: 'write', bytes: 1000 } ] },
    errorSamples: [
      { seq: 12, tool: 'bash', code: 'EINVALID', reason: 'bad arguments', callPreview: '{"command":"x"}' },
      { seq: 14, tool: 'bash', code: 'invalid-arguments', reason: 'schema mismatch', callPreview: '{}' },
      { seq: 16, tool: 'bash', code: 'EINVALID', reason: 'bad arguments', callPreview: '{}' },
    ],
    repeated: [{ name: 'read', argKey: 'aaaaaaaaaaaa', times: 4, seqs: [5, 6, 7, 8] }],
    humanTexts: [
      { seq: 30, chars: 10, text: 'no, wrong' },
      { seq: 31, chars: 10, text: 'revert that' },
    ],
    edits: { count: 2, seqs: [20, 21], byTool: { write: 2 } },
    afterLastEditChecks: 0,
    usage: { inputTokens: 600000, outputTokens: 200000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 800000 },
    peakContextRatio: 0.7,
    turnEnds: { completed: 3, error: 1 },
    durations: { totalMs: 1000, maxTurnMs: 400, maxStepMs: 100 },
  });
  const s2 = makeFacts({
    sessionId: 'rule-2',
    counters: { turns: 3, toolCalls: 5, toolErrors: 1 },
    tools: [toolRow('bash', 5, 1, { EINVALID: 1 })],
    catalog: { bytes: 10000, toolCount: 1, tools: [ { name: 'bash', bytes: 1000 } ] },
    errorSamples: [{ seq: 3, tool: 'bash', code: 'EINVALID', reason: 'bad', callPreview: '{}' }],
    repeated: [{ name: 'grep', argKey: 'bbbbbbbbbbbb', times: 2, seqs: [1, 2] }],
    edits: { count: 1, seqs: [9], byTool: { edit: 1 } },
    afterLastEditChecks: 0,
    usage: { inputTokens: 70000, outputTokens: 30000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100000 },
    peakContextRatio: 0.3,
    turnEnds: { completed: 3 },
    durations: { totalMs: 0, maxTurnMs: 0, maxStepMs: 0 },
  });
  const s3 = makeFacts({
    sessionId: 'rule-3',
    counters: { turns: 3, toolCalls: 2, toolErrors: 0 },
    tools: [toolRow('read', 2, 0, {})],
    catalog: { bytes: 5000, toolCount: 1, tools: [ { name: 'read', bytes: 1000 } ] },
    usage: { inputTokens: 70000, outputTokens: 30000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100000 },
    peakContextRatio: 0.2,
    turnEnds: { completed: 3 },
    durations: { totalMs: 2000, maxTurnMs: 700, maxStepMs: 150 },
  });
  return [s1, s2, s3];
}

function cleanFacts() {
  const make = (id, tokens) => makeFacts({
    sessionId: id,
    counters: { turns: 4, toolCalls: 10, toolResults: 10, toolErrors: 0 },
    tools: [toolRow('bash', 10, 0, {})],
    catalog: { bytes: 9000, toolCount: 1, tools: [ { name: 'bash', bytes: 9000 } ] },
    humanTexts: [{ seq: 5, chars: 12, text: 'thanks, continue' }],
    edits: { count: 2, seqs: [10, 11], byTool: { write: 2 } },
    checks: { count: 2, seqs: [12, 13], lastSeq: 13 },
    afterLastEditChecks: 2,
    usage: { inputTokens: 40000, outputTokens: 10000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens },
    peakContextRatio: 0.2,
    turnEnds: { completed: 4 },
    durations: { totalMs: 1000, maxTurnMs: 400, maxStepMs: 100 },
  });
  return [make('clean-1', 50000), make('clean-2', 50000), make('clean-3', 50000)];
}

// ================================================================ proposal shape

const PROPOSAL_KINDS = ['prompt-section', 'agents-md-rule', 'skill-candidate', 'advisory'];
const PROPOSAL_STATUS = ['proposed', 'adopted', 'rejected', 'reverted'];
const RISKS = ['low', 'medium', 'high'];
const EFFECTS = ['decrease', 'increase'];

function makeProposal(overrides = {}) {
  const id = overrides.id || 'prop-20261108-120000-abcd';
  return {
    id,
    runId: 'run-20261108-120000-abcd',
    findingIds: ['f-R4-1'],
    kind: 'prompt-section',
    target: 'archive-rsi/lessons',
    title: 'Verification rule',
    rationale: 'Sessions often stop after an edit without re-running the checks.',
    body: 'Verification rule: after the last edit of a task, re-run the check suite before reporting done.',
    evidence: [{ sessionId: 's1', seq: 12 }],
    expectedMetric: 'verificationGapRate',
    expectedEffect: 'decrease',
    risk: 'low',
    status: 'proposed',
    createdAt: 1_700_000_000_000,
    adoptedAt: null,
    rejectedAt: null,
    revertedAt: null,
    adoption: null,
    evaluation: null,
    ...overrides,
  };
}

async function expectCodedError(fn, codePattern, what) {
  let value;
  try {
    value = await fn();
  } catch (error) {
    const code = error && error.code;
    if (!code) throw new Error(`${what}: threw without a .code (${(error && error.message) || error})`);
    assertMatch(String(code), codePattern, `${what}: error.code`);
    return { code: String(code), message: String((error && error.message) || '') };
  }
  if (value && typeof value === 'object' && value.ok === false && value.error) {
    const code = value.error.code;
    if (!code) throw new Error(`${what}: returned {ok:false} without error.code`);
    assertMatch(String(code), codePattern, `${what}: error.code`);
    return { code: String(code), message: String(value.error.message || '') };
  }
  throw new Error(`${what}: expected a coded rejection, got ${JSON.stringify(value).slice(0, 200)}`);
}

const REQUIRED_ARGS = {
  archive_get: ['id'],
  archive_update: ['id'],
  archive_delete: ['id'],
  rsi_act: ['runId'],
  rsi_adopt: ['proposalId'],
};

const TOOL_NAMES = [
  'archive_list',
  'archive_get',
  'archive_sync',
  'archive_update',
  'archive_autotag',
  'archive_delete',
  'rsi_plan',
  'rsi_run',
  'rsi_act',
  'rsi_status',
  'rsi_adopt',
];

const BAD_ARGS = {
  archive_list: { query: [], tag: 5, status: 7, workspace: {}, limit: 'many', offset: 'x', archived: 'yes' },
  archive_get: { id: 42, transcript: 'yes', maxChars: 'wide' },
  archive_sync: { refresh: 'yes' },
  archive_update: { id: {}, title: 5, tags: 'release', status: 9, note: [] },
  // `no-such-session` keeps the wrong-typed execution read-only: unknown ids are
  // rejected before the dry-run flag matters.
  archive_autotag: { id: 'no-such-session', dryRun: 'yes', limit: 'many' },
  archive_delete: { id: [], purge: 'yes' },
  rsi_plan: { days: 'x', workspace: [], tag: {}, limit: 'x', targets: 'nope' },
  rsi_run: { runId: 5, days: 'x', workspace: [], limit: {}, targets: 5 },
  rsi_act: { runId: 5 },
  rsi_status: { runId: [], limit: 'x' },
  rsi_adopt: { proposalId: {}, revert: 'yes', dryRun: 'y' },
};

// ======================================================================= phases

async function phaseConfig() {
  console.log('\n# 1. config (DESIGN §8)');

  const documented = {
    rootDir: '',
    sessionsDir: '',
    protocolSection: true,
    lessonsSection: true,
    syncOnBoot: true,
    maxTranscriptBytes: 262144,
    days: 30,
    limit: 40,
    agentsFile: '',
    skillsRoot: '',
    autoAdopt: false,
    // Added to DESIGN §8 after this harness was first written; see the
    // "contract revision" note printed in the header.
    autoRunEveryDays: 7,
    autoPropose: true,
  };

  try {
    assert(typeof readConfig === 'function', 'readConfig is not exported from index.js');
  } catch (error) {
    printFail('CFG.1', 'readConfig(undefined) returns the documented defaults with no warnings', error.message);
    printFail('CFG.2', 'unknown keys warn and are ignored; numbers are clamped', 'readConfig is not exported');
    printFail('CFG.3', 'a leading ~ in rootDir expands to the home directory', 'readConfig is not exported');
    printFail('CFG.4', 'a non-object config never throws', 'readConfig is not exported');
    return;
  }

  await check('CFG.1', 'readConfig(undefined) returns the documented defaults with no warnings', () => {
    const { config, warnings } = normalizeConfig(readConfig(undefined));
    const mismatches = [];
    for (const [key, expected] of Object.entries(documented)) {
      if (config[key] !== expected) mismatches.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(config[key])}`);
    }
    if (JSON.stringify(config.editTools) !== JSON.stringify(DEFAULT_EDIT_TOOLS)) {
      mismatches.push(`editTools: expected ${JSON.stringify(DEFAULT_EDIT_TOOLS)}, got ${JSON.stringify(config.editTools)}`);
    }
    if (JSON.stringify(config.checkTools) !== JSON.stringify(DEFAULT_CHECK_TOOLS)) {
      mismatches.push(`checkTools: expected ${JSON.stringify(DEFAULT_CHECK_TOOLS)}, got ${JSON.stringify(config.checkTools)}`);
    }
    if (warnings.length !== 0) mismatches.push(`warnings: expected none, got ${JSON.stringify(warnings)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${Object.keys(documented).length} defaults + editTools/checkTools`;
  });

  await check('CFG.2', 'unknown keys warn and are ignored; limit>500 clamps to 500 and maxTranscriptBytes<4096 to 4096', () => {
    const unknown = normalizeConfig(readConfig({ totallyUnknownKey: 1, anotherUnknown: 'x' }));
    const mismatches = [];
    if (unknown.warnings.length < 1) mismatches.push('no warning for unknown keys');
    if (Object.hasOwn(unknown.config, 'totallyUnknownKey')) mismatches.push('unknown key leaked into the config');
    const wide = normalizeConfig(readConfig({ limit: 9999, maxTranscriptBytes: 1 }));
    if (wide.config.limit !== 500) mismatches.push(`limit: expected 500, got ${JSON.stringify(wide.config.limit)}`);
    if (wide.config.maxTranscriptBytes !== 4096) mismatches.push(`maxTranscriptBytes: expected 4096, got ${JSON.stringify(wide.config.maxTranscriptBytes)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${unknown.warnings.length} warning(s): ${unknown.warnings.join(' | ')}`;
  });

  await check('CFG.3', 'a leading ~ in rootDir expands to the home directory', () => {
    const { config } = normalizeConfig(readConfig({ rootDir: '~/verify-rsi-root' }));
    const expected = path.join(homedir(), 'verify-rsi-root');
    const mismatches = [];
    if (config.rootDir !== expected) mismatches.push(`rootDir: expected ${expected}, got ${JSON.stringify(config.rootDir)}`);
    if (typeof config.rootDir === 'string' && config.rootDir.startsWith('~')) mismatches.push('rootDir still starts with ~');
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return config.rootDir;
  });

  await check('CFG.4', 'a non-object config (number/string/bool/array/null) never throws', () => {
    const failures = [];
    for (const raw of [42, 'nope', true, [1, 2], null]) {
      try {
        const { config } = normalizeConfig(readConfig(raw));
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
          failures.push(`${JSON.stringify(raw)}: returned ${typeof config}`);
        }
      } catch (error) {
        failures.push(`${JSON.stringify(raw)}: threw ${(error && error.message) || error}`);
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
    return '5 bad shapes';
  });

  await check('CFG.5', 'a key outside the §8 list warns and is ignored', () => {
    // §8 is the closed config; §8 also says "Unknown keys -> warning, ignored".
    // NOTE: the harness was authored before §8 gained `autoRunEveryDays` and
    // `autoPropose` (the continuous-loop knobs), so those two are documented keys
    // now and are asserted as accepted rather than as warnings.
    const documented = { autoRunEveryDays: 3, autoPropose: true };
    const { config: documentedConfig } = normalizeConfig(readConfig(documented));
    for (const [key, value] of Object.entries(documented)) {
      if (!Object.hasOwn(documentedConfig, key)) throw new Error(`documented §8 key ${key} was ignored`);
      if (documentedConfig[key] !== value) throw new Error(`documented §8 key ${key}: expected ${value}, got ${JSON.stringify(documentedConfig[key])}`);
    }
    const raw = { totallyMadeUp: 1 };
    const { config, warnings } = normalizeConfig(readConfig(raw));
    const mismatches = [];
    for (const key of Object.keys(raw)) {
      if (Object.hasOwn(config, key)) mismatches.push(`${key} was accepted (value ${JSON.stringify(config[key])})`);
    }
    const missing = Object.keys(raw).filter((key) => !warnings.some((warning) => String(warning).includes(key)));
    if (missing.length) mismatches.push(`no warning names ${missing.join(', ')} (warnings: ${JSON.stringify(warnings)})`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${warnings.length} warnings`;
  });
}

/** readConfig's return shape is not stated in DESIGN.md; accept both forms. */
function normalizeConfig(result) {
  if (result && typeof result === 'object' && result.config && typeof result.config === 'object') {
    return { config: result.config, warnings: Array.isArray(result.warnings) ? result.warnings : [] };
  }
  if (result && typeof result === 'object') return { config: result, warnings: [] };
  return { config: {}, warnings: [] };
}

async function phaseDecode() {
  console.log('\n# 2. zstd decoding (DESIGN §1)');

  const real = await realSessionFiles();
  if (real.length === 0) {
    printSkip('DEC.1', 'decodeSessionFile on a real fixture yields version 4 and >1 zstd frame', 'no ~/.dsh/sessions/**/session.v4.jsonl.zstd found');
  } else {
    await check('DEC.1', 'decodeSessionFile on a real fixture yields version 4, >1 zstd frame and >20 events', async () => {
      // Smallest file above 60 KiB: enough events, cheap to decode.
      const sized = [];
      for (const file of real) {
        const stat = await fs.stat(file);
        sized.push({ file, size: stat.size });
      }
      const candidate = sized.filter((item) => item.size > 60_000).sort((a, b) => a.size - b.size)[0] || sized[sized.length - 1];
      const base = await makeBase('decode');
      const copy = path.join(base, 'sessions', 'fixture-slug', path.basename(path.dirname(candidate.file)), 'session.v4.jsonl.zstd');
      await fs.mkdir(path.dirname(copy), { recursive: true });
      await fs.copyFile(candidate.file, copy);
      const decoded = decodeSessionFile(copy);
      assert(decoded && typeof decoded === 'object', 'decodeSessionFile did not return an object');
      assertArray(decoded.frames, 'frames');
      assertArray(decoded.events, 'events');
      const mismatches = [];
      if (!decoded.header || decoded.header.version !== 4) mismatches.push(`header.version: expected 4, got ${JSON.stringify(decoded.header && decoded.header.version)}`);
      if (decoded.frames.length <= 1) mismatches.push(`frames.length: expected >1, got ${decoded.frames.length}`);
      if (decoded.events.length <= 20) mismatches.push(`events.length: expected >20, got ${decoded.events.length}`);
      if (mismatches.length) throw new Error(mismatches.join('; '));
      return `${decoded.events.length} events, ${decoded.frames.length} frames, ${candidate.size} bytes`;
    });
  }

  const headerLine = '{"type":"session","version":4,"id":"synth-1","createdAt":1,"cwd":"/tmp","origin":"user","isSeeded":false}\n';
  const eventLine = (seq) => `${JSON.stringify({ type: 'turn/start', seq, time: 2 + seq, data: { turn: seq } })}\n`;
  const framesBody = [headerLine, eventLine(1), eventLine(2)];

  await check('DEC.2', 'a 3-frame concatenated file decodes to exactly the three JSONL payloads', async () => {
    const base = await makeBase('frames');
    const file = path.join(base, 'session.v4.jsonl.zstd');
    await fs.writeFile(file, Buffer.concat(framesBody.map((body) => frame(body))));
    const decoded = decodeSessionFile(file);
    const mismatches = [];
    if (!decoded.header || decoded.header.id !== 'synth-1') mismatches.push(`header.id: expected synth-1, got ${JSON.stringify(decoded.header && decoded.header.id)}`);
    if (decoded.header && decoded.header.version !== 4) mismatches.push(`header.version: expected 4, got ${decoded.header.version}`);
    if (decoded.frames.length !== 3) mismatches.push(`frames.length: expected 3, got ${decoded.frames.length}`);
    if (decoded.events.length !== 2) mismatches.push(`events.length: expected 2, got ${decoded.events.length}`);
    const seqs = (decoded.events || []).map((event) => event.seq);
    if (JSON.stringify(seqs) !== JSON.stringify([1, 2])) mismatches.push(`event seqs: expected [1,2], got ${JSON.stringify(seqs)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `3 frames -> header + ${decoded.events.length} events`;
  });

  await check('DEC.3', 'a truncated third frame yields tornStart and returns the first two frames instead of throwing', async () => {
    const base = await makeBase('torn');
    const file = path.join(base, 'session.v4.jsonl.zstd');
    const complete = framesBody.map((body) => frame(body));
    const truncated = complete[2].subarray(0, Math.max(4, Math.floor(complete[2].length / 2)));
    await fs.writeFile(file, Buffer.concat([complete[0], complete[1], truncated]));
    let decoded;
    try {
      decoded = decodeSessionFile(file);
    } catch (error) {
      throw new Error(`decodeSessionFile threw on a torn trailing frame: ${(error && error.message) || error}`);
    }
    const mismatches = [];
    // DESIGN §7.1: decodeSessionFile returns `{header, events}` — the header row is
    // surfaced as `header`, not counted in `events`. framesBody[0] is the header,
    // so two complete frames mean header + 1 event.
    if (decoded.events.length !== 1) mismatches.push(`events.length: expected the header plus 1 event row (header is not an event), got ${decoded.events.length}`);
    if (typeof decoded.tornStart !== 'number' || !Number.isFinite(decoded.tornStart)) {
      mismatches.push(`tornStart: expected a finite offset, got ${JSON.stringify(decoded.tornStart)}`);
    }
    if (decoded.header && decoded.header.id !== 'synth-1') mismatches.push(`header.id: expected synth-1, got ${decoded.header.id}`);
    if (mismatches.length) throw new Error(`${mismatches.join('; ')} (frames=${decoded.frames.length})`);
    return `tornStart=${decoded.tornStart}, frames=${decoded.frames.length}, events=${decoded.events.length}`;
  });
}

function factFixture() {
  const t0 = 1_700_000_000_000;
  const header = { type: 'session', version: 4, id: 'fixture-session', createdAt: t0, cwd: '/tmp/proj', origin: 'user', isSeeded: false };
  const events = [
    { type: 'turn/start', seq: 1, time: t0 + 1000, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: t0 + 1100, data: { content: [{ type: 'text', text: 'please run the suite' }], source: { kind: 'user' } } },
    {
      type: 'request/header',
      seq: 3,
      time: t0 + 1200,
      data: { header: { tools: [
        { name: 'bash', description: 'run a command', parameters: { type: 'object' } },
        { name: 'write', description: 'write a file', parameters: { type: 'object' } },
      ] } },
    },
    { type: 'request/context', seq: 4, time: t0 + 1300, data: { provider: 'p', model: 'm', contextWindow: 1000, systemPromptUpdate: false } },
    {
      type: 'assistant/message',
      seq: 5,
      time: t0 + 1400,
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: false, usage: { inputTokens: 400, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 450 } },
    },
    { type: 'tool/call', seq: 6, time: t0 + 1500, data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"/tmp/a.txt"}' } },
    { type: 'tool/result', seq: 7, time: t0 + 1600, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'tool/call', seq: 8, time: t0 + 1700, data: { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{"file_path":"/tmp/a.txt","content":"x"}' } },
    { type: 'tool/result', seq: 9, time: t0 + 1800, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c2', isError: false, content: [{ type: 'text', text: 'wrote' }] } } },
    { type: 'tool/call', seq: 10, time: t0 + 1900, data: { turn: 1, step: 1, callId: 'c3', name: 'bash', arguments: '{"command":"pnpm test"}' } },
    {
      type: 'tool/result',
      seq: 11,
      time: t0 + 2000,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'tool', toolCallId: 'c3', isError: true, content: [{ type: 'text', text: 'boom' }] },
        error: { name: 'ToolError', code: 'EINVALID', reason: 'bad arguments' },
      },
    },
    { type: 'turn/end', seq: 12, time: t0 + 3000, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 13, time: t0 + 3001, data: { turn: 2 } },
    { type: 'user/message', seq: 14, time: t0 + 3100, data: { content: [{ type: 'text', text: 'no, that is wrong' }], source: { kind: 'user' } } },
    {
      type: 'assistant/message',
      seq: 15,
      time: t0 + 3200,
      data: { turn: 2, step: 1, message: { role: 'assistant', content: [] }, stream: false, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 120 } },
    },
    { type: 'turn/end', seq: 16, time: t0 + 4000, data: { turn: 2, reason: { kind: 'aborted' } } },
  ];
  return { header, events };
}

/**
 * A synthetic session whose computed facts satisfy exactly T2 (`origin:user`)
 * and T4 (one edit, zero checks after it) — the two tags TAG.5/TAG.6/TAG.7
 * expect from the on-disk store.
 */
function autoTagFixture(id = 'auto-fixture') {
  const t0 = 1_700_000_000_000;
  const header = { type: 'session', version: 4, id, createdAt: t0, cwd: '/tmp/proj', origin: 'user', isSeeded: false };
  const events = [
    { type: 'turn/start', seq: 1, time: t0 + 1000, data: { turn: 1 } },
    // Short enough to stay below T13's 20-letter threshold, so no lang tag.
    { type: 'user/message', seq: 2, time: t0 + 1100, data: { content: [{ type: 'text', text: 'write it please' }], source: { kind: 'user' } } },
    { type: 'tool/call', seq: 3, time: t0 + 1200, data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"/tmp/a.txt","content":"x"}' } },
    { type: 'tool/result', seq: 4, time: t0 + 1300, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'wrote' }] } } },
    { type: 'assistant/message', seq: 5, time: t0 + 1400, data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: false, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } } },
    { type: 'turn/end', seq: 6, time: t0 + 1500, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  return { header, events };
}

async function phaseFacts() {
  console.log('\n# 3. SessionFacts (DESIGN §3)');

  await check('FACT.1', 'computeFacts matches the hand-computed facts for the authored event fixture', () => {
    const { header, events } = factFixture();
    const facts = computeFacts({ header, events, file: '/tmp/fixture/session.v4.jsonl.zstd', slug: 'fixture' });
    assert(facts && typeof facts === 'object', 'computeFacts returned no object');

    const checks = [
      ['counters.toolCalls', facts.counters && facts.counters.toolCalls, 3],
      ['counters.toolErrors', facts.counters && facts.counters.toolErrors, 1],
      ['tools[0].name', facts.tools && facts.tools[0] && facts.tools[0].name, 'bash'],
      ['tools[0].errorCodes.EINVALID', facts.tools && facts.tools[0] && facts.tools[0].errorCodes && facts.tools[0].errorCodes.EINVALID, 1],
      ['edits.count', facts.edits && facts.edits.count, 1],
      ['afterLastEditChecks', facts.afterLastEditChecks, 1],
      ['peakContextRatio', facts.peakContextRatio, 0.4],
      ['catalog.toolCount', facts.catalog && facts.catalog.toolCount, 2],
      ['turnEnds.completed', facts.turnEnds && facts.turnEnds.completed, 1],
      ['counters.turns', facts.counters && facts.counters.turns, 2],
      ['contextWindow', facts.contextWindow, 1000],
      ['usage.inputTokens', facts.usage && facts.usage.inputTokens, 500],
      ['edits.seqs.length', Array.isArray(facts.edits && facts.edits.seqs) ? facts.edits.seqs.length : null, 1],
    ];
    const mismatches = [];
    for (const [label, actual, expected] of checks) {
      if (actual !== expected) mismatches.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    if (mismatches.length) throw new Error(`${mismatches.length} mismatch(es): ${mismatches.join('; ')}`);
    return `${checks.length} fields`;
  });

  await check('FACT.2', 'computeFacts counts only human turns as humanTexts and pairs tool errors by callId', () => {
    const { header, events } = factFixture();
    const facts = computeFacts({ header, events, file: '/tmp/fixture/session.v4.jsonl.zstd', slug: 'fixture' });
    const mismatches = [];
    if (!Array.isArray(facts.humanTexts)) mismatches.push('humanTexts is not an array');
    else if (facts.humanTexts.length !== 2) mismatches.push(`humanTexts.length: expected 2 human messages, got ${facts.humanTexts.length}`);
    if (!Array.isArray(facts.errorSamples)) mismatches.push('errorSamples is not an array');
    else if (facts.errorSamples.length !== 1) mismatches.push(`errorSamples.length: expected 1, got ${facts.errorSamples.length}`);
    else {
      const sample = facts.errorSamples[0];
      if (sample.code !== 'EINVALID') mismatches.push(`errorSamples[0].code: expected EINVALID, got ${JSON.stringify(sample.code)}`);
      if (sample.tool !== 'bash') mismatches.push(`errorSamples[0].tool: expected bash, got ${JSON.stringify(sample.tool)}`);
      if (sample.seq !== 11) mismatches.push(`errorSamples[0].seq: expected 11, got ${JSON.stringify(sample.seq)}`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${facts.humanTexts.length} human texts, ${facts.errorSamples.length} error sample`;
  });
}

async function phaseStore() {
  console.log('\n# 4. on-disk store (DESIGN §2, §7.1)');

  const real = await realSessionFiles();

  await check('STO.1', 'init() on an empty dir creates archive.json at the store root', async () => {
    const base = await makeBase('init');
    const root = path.join(base, 'archive');
    const emptySessions = path.join(base, 'empty-sessions');
    await fs.mkdir(emptySessions, { recursive: true });
    const store = new ArchiveStore({ rootDir: root, sessionRoots: [emptySessions] });
    const result = await store.init();
    assert(result && typeof result === 'object', 'init() did not return an object');
    assertEqual(result.created, true, 'init().created');
    assert(await exists(path.join(root, 'archive.json')), 'archive.json missing');
    const index = await readJson(path.join(root, 'archive.json'));
    assertEqual(index.version, 1, 'archive.json version');
    assert(index.entries && typeof index.entries === 'object', 'archive.json entries is not an object');
    assertEqual(Object.keys(index.entries).length, 0, 'entries count');
    return `${root}`;
  });

  await check('STO.2', 'init() on a corrupt archive.json renames it to archive.json.corrupt-* and starts fresh', async () => {
    const base = await makeBase('corrupt-index');
    const root = path.join(base, 'archive');
    const emptySessions = path.join(base, 'empty-sessions');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(emptySessions, { recursive: true });
    await fs.writeFile(path.join(root, 'archive.json'), 'this is not json {');
    const store = new ArchiveStore({ rootDir: root, sessionRoots: [emptySessions] });
    await store.init();
    const names = await fs.readdir(root);
    const renamed = names.filter((name) => name.startsWith('archive.json.corrupt-'));
    assert(renamed.length >= 1, `no archive.json.corrupt-* file (root has: ${names.join(', ')})`);
    const index = await readJson(path.join(root, 'archive.json'));
    assertEqual(index.version, 1, 'fresh archive.json version');
    assertEqual(Object.keys(index.entries || {}).length, 0, 'fresh entries count');
    const renamedText = await readText(path.join(root, renamed[0]));
    assert(renamedText.includes('not json'), 'the corrupt bytes were not preserved');
    return renamed.join(', ');
  });

  if (real.length < 2) {
    printSkip('STO.3', 'sync imports 2 real session copies, then skips them, then refreshes exactly one', 'need 2 real session files, found ' + real.length);
    printSkip('STO.4', 'a corrupt body lands in sync().failed without aborting the other import', 'need 2 real session files, found ' + real.length);
    printSkip('STO.5', 'update applies title/tags/note/status and rejects invalid values with a code', 'need 2 real session files');
    printSkip('STO.6', 'remove({purge:false}) trashes the entry; remove({purge:true}) deletes it', 'need 2 real session files');
    return;
  }

  const base = await makeBase('sync');
  const fixture = await copySessionFixture(base, real, 2);
  const root = path.join(base, 'archive');
  const store = new ArchiveStore({ rootDir: root, sessionRoots: [fixture.root] });
  let ids = [];

  await check('STO.3', 'sync imports 2, then skips 2, then refreshes exactly 1 after a file append', async () => {
    await store.init();
    const first = await store.sync({ refresh: true });
    const mismatches = [];
    if (first.imported !== 2) mismatches.push(`first imported: expected 2, got ${JSON.stringify(first.imported)}`);
    if (!Array.isArray(first.failed) || first.failed.length !== 0) mismatches.push(`first failed: expected [], got ${JSON.stringify(first.failed)}`);
    const second = await store.sync({ refresh: false });
    if (second.imported !== 0) mismatches.push(`second imported: expected 0, got ${JSON.stringify(second.imported)}`);
    if (second.skipped !== 2) mismatches.push(`second skipped: expected 2, got ${JSON.stringify(second.skipped)}`);

    const index = await store.index();
    ids = Object.keys(index.entries);
    if (ids.length !== 2) mismatches.push(`index entries: expected 2, got ${ids.length}`);

    // Append one more valid zstd frame to one session file.
    const target = fixture.copies[0].file;
    const appended = `${JSON.stringify({ type: 'turn/start', seq: 9999, time: Date.now(), data: { turn: 99 } })}\n`;
    await fs.appendFile(target, frame(appended));
    // DESIGN §7.1: `refresh:true` re-decodes EVERY discovered file, so it would
    // legitimately report 2. The incremental behaviour this check is about is the
    // `refresh:false` path.
    const third = await store.sync({ refresh: false });
    if (third.refreshed !== 1) mismatches.push(`third refreshed: expected 1, got ${JSON.stringify(third.refreshed)}`);
    if (third.imported !== 0) mismatches.push(`third imported: expected 0, got ${JSON.stringify(third.imported)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `imported=${first.imported} skipped=${second.skipped} refreshed=${third.refreshed}`;
  });

  await check('STO.4', 'a corrupt session body lands in sync().failed and the good session still imports', async () => {
    const badBase = await makeBase('sync-bad');
    const good = await copySessionFixture(badBase, real, 1);
    const badDir = path.join(good.root, 'broken-slug', 'broken-session');
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(path.join(badDir, 'session.v4.jsonl.zstd'), frame('{"this":"is not a valid event body"}\n{"also":'));
    const badRoot = path.join(badBase, 'archive');
    const badStore = new ArchiveStore({ rootDir: badRoot, sessionRoots: [good.root] });
    await badStore.init();
    const result = await badStore.sync({ refresh: true });
    const mismatches = [];
    if (!Array.isArray(result.failed)) mismatches.push('failed is not an array');
    else if (result.failed.length !== 1) mismatches.push(`failed.length: expected 1, got ${result.failed.length}`);
    else {
      const failure = result.failed[0];
      if (!failure || typeof failure.file !== 'string' || !failure.file.includes('broken-session')) {
        mismatches.push(`failed[0].file: expected the broken session path, got ${JSON.stringify(failure && failure.file)}`);
      }
      if (!failure || !failure.error) mismatches.push('failed[0].error is missing');
    }
    if (result.imported !== 1) mismatches.push(`imported: expected the 1 good session, got ${JSON.stringify(result.imported)}`);
    const index = await badStore.index();
    if (Object.keys(index.entries).length !== 1) mismatches.push(`index entries: expected 1, got ${Object.keys(index.entries).length}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${result.imported} imported, ${result.failed.length} failed`;
  });

  await check('STO.5', 'update applies title/tags/note/status and rejects an invalid tag and status with a code', async () => {
    const id = ids[0];
    assert(id, 'prerequisite: STO.3 produced no entry id');
    const entry = await store.update(id, { title: 'Renamed by verifier', tags: ['Release', 'ops:2026'], note: 'note text', status: 'pinned' });
    const mismatches = [];
    if (!entry || typeof entry !== 'object') mismatches.push('update returned no entry');
    else {
      if (entry.title !== 'Renamed by verifier') mismatches.push(`title: expected "Renamed by verifier", got ${JSON.stringify(entry.title)}`);
      // §10.1: tags = manual ∪ auto. The manual half stays exact; the auto half
      // computed by sync() must remain visible and unduplicated.
      const manual = manualTags(entry);
      if (JSON.stringify(manual) !== JSON.stringify(['release', 'ops:2026'])) {
        mismatches.push(`tags: expected manual ["release","ops:2026"], got ${JSON.stringify(entry.tags)} (manual ${JSON.stringify(manual)})`);
      }
      if (JSON.stringify(entry.tags) !== JSON.stringify([...manual, ...(entry.autoTags || [])])) {
        mismatches.push(`tags: expected manual ∪ auto, got ${JSON.stringify(entry.tags)} (auto ${JSON.stringify(entry.autoTags)})`);
      }
      if (entry.note !== 'note text') mismatches.push(`note: expected "note text", got ${JSON.stringify(entry.note)}`);
      if (entry.status !== 'pinned') mismatches.push(`status: expected pinned, got ${JSON.stringify(entry.status)}`);
    }
    // §2.1 defines the stored tag charset; the acceptance list requires
    // `update` to reject an invalid tag with a coded error. Both are asserted:
    // a conforming tag normalizes, an out-of-charset tag is refused.
    const normalized = await store.update(id, { tags: ['RSI', 'ops:2026', 'rsI'] });
    const normalizedManual = manualTags(normalized);
    if (JSON.stringify(normalizedManual) !== JSON.stringify(['rsi', 'ops:2026'])) {
      mismatches.push(`normalized tags: expected ["rsi","ops:2026"], got ${JSON.stringify(normalized.tags)} (manual ${JSON.stringify(normalizedManual)})`);
    }
    let invalidTagCode = null;
    try {
      const accepted = await store.update(id, { tags: ['Not A Tag!'] });
      mismatches.push(`invalid tag was accepted (tags became ${JSON.stringify(accepted && accepted.tags)}) instead of a coded rejection`);
    } catch (error) {
      invalidTagCode = error && error.code;
      if (!invalidTagCode) mismatches.push('invalid tag threw without a .code');
    }
    const statusError = await expectCodedError(() => store.update(id, { status: 'exploded' }), /status|invalid/i, 'invalid status');
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${id}: tag=${invalidTagCode || 'ACCEPTED'} / status=${statusError.code}`;
  });

  await check('STO.6', 'remove({purge:false}) trashes the entry; remove({purge:true}) makes get() return null', async () => {
    const trashId = ids[0];
    const purgeId = ids[1];
    const trashed = await store.remove(trashId, { purge: false });
    assert(trashed && trashed.removed !== false, `remove({purge:false}) reported removed=${JSON.stringify(trashed && trashed.removed)}`);
    const trashedEntry = await store.get(trashId);
    assert(trashedEntry && trashedEntry.entry, 'trashed entry disappeared from get()');
    assertEqual(trashedEntry.entry.status, 'trash', 'trashed entry status');
    const purged = await store.remove(purgeId, { purge: true });
    assert(purged && purged.purged === true, `remove({purge:true}).purged: expected true, got ${JSON.stringify(purged && purged.purged)}`);
    const gone = await store.get(purgeId);
    assertEqual(gone, null, 'get() after purge');
    assert(!(await exists(path.join(root, 'sessions', `${purgeId}.json`))), 'purge left sessions/<id>.json behind');
    assert(await exists(path.join(root, 'sessions', `${trashId}.json`)), 'trash removed the derived facts file (it must stay recoverable)');
    return `${trashId} -> trash, ${purgeId} -> purged`;
  });
}

async function phaseMetrics() {
  console.log('\n# 5. cohort metrics (DESIGN §5.1)');

  const facts = metricFacts();
  let metrics = null;

  await check('MET.1', 'cohortMetrics on 3 synthetic facts matches hand-computed values', () => {
    metrics = cohortMetrics(facts);
    const t = 15; // 4 + 6 + 5 turns
    const expected = {
      sessions: 3,
      turns: t,
      toolCalls: 20,
      toolResults: 20,
      toolErrors: 3,
      toolErrorRate: 3 / 20,
      corrections: 5, // s1: 2, s2: 0, s3: 4 capped at 3
      correctionRate: 5 / t,
      verificationGapRate: 1 / 2, // one of two sessions with edits
      peakContextRatioP50: 0.5,
      peakContextRatioP90: 0.9,
      catalogBytes: 52000,
      catalogToolCount: 4,
      catalogWasteRate: (0.75 + 0.5 + 0) / 3,
      skillCatalogBytes: 800,
      totalTokens: 900000,
      inputTokens: 600000,
      outputTokens: 300000,
      tokensPerTurn: 60000,
      turnFailureRate: 2 / t, // error + aborted
      repeatedCallSessions: 2,
      avgDurationMs: 2000,
      p90DurationMs: 3000,
    };
    const mismatches = [];
    for (const [key, want] of Object.entries(expected)) {
      const got = metrics[key];
      if (typeof want === 'number' && !Number.isInteger(want)) {
        if (typeof got !== 'number' || !Number.isFinite(got) || Math.abs(got - want) > 1e-9) mismatches.push(`${key}: expected ${want}, got ${JSON.stringify(got)}`);
      } else if (got !== want) {
        mismatches.push(`${key}: expected ${want}, got ${JSON.stringify(got)}`);
      }
    }
    const firstTool = Array.isArray(metrics.tools) ? metrics.tools[0] : null;
    if (!firstTool || firstTool.name !== 'a') mismatches.push(`tools[0].name: expected "a", got ${JSON.stringify(firstTool && firstTool.name)}`);
    else {
      if (firstTool.calls !== 15) mismatches.push(`tools[0].calls: expected 15, got ${firstTool.calls}`);
      if (firstTool.errors !== 3) mismatches.push(`tools[0].errors: expected 3, got ${firstTool.errors}`);
      if (Math.abs(firstTool.errorRate - 0.2) > 1e-9) mismatches.push(`tools[0].errorRate: expected 0.2, got ${firstTool.errorRate}`);
      if (!firstTool.errorCodes || firstTool.errorCodes.EINVALID !== 2 || firstTool.errorCodes.ENOENT !== 1) mismatches.push(`tools[0].errorCodes: expected {EINVALID:2,ENOENT:1}, got ${JSON.stringify(firstTool.errorCodes)}`);
    }
    if (mismatches.length) throw new Error(`${mismatches.length} mismatch(es): ${mismatches.join('; ')}`);
    return `${Object.keys(expected).length + 4} values`;
  });

  await check('MET.2', 'cohortMetrics([]) is all zeros with no NaN/Infinity anywhere', () => {
    const empty = cohortMetrics([]);
    const numbers = collectNumbers(empty);
    const bad = numbers.filter((value) => !Number.isFinite(value));
    if (bad.length) throw new Error(`non-finite numbers: ${bad.map(String).join(', ')}`);
    const nonZero = numbers.filter((value) => value !== 0);
    if (nonZero.length) throw new Error(`expected all zeros, found ${nonZero.length} non-zero value(s): ${nonZero.slice(0, 5).join(', ')}`);
    if (empty.sessions !== 0) throw new Error(`sessions: expected 0, got ${empty.sessions}`);
    if (numbers.length < 15) throw new Error(`only ${numbers.length} numeric leaves; expected the §5.1 scalar set`);
    return `${numbers.length} numeric leaves, all 0`;
  });

  await check('MET.3', 'percentile/median edge cases: empty, single, p=1', () => {
    const mismatches = [];
    const finite = (label, value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) mismatches.push(`${label}: expected a finite number, got ${JSON.stringify(value)}`);
      return value;
    };
    finite('percentile([], 0.5)', percentile([], 0.5));
    finite('percentile([], 1)', percentile([], 1));
    finite('median([])', median([]));
    if (percentile([5], 0.5) !== 5) mismatches.push(`percentile([5], 0.5): expected 5, got ${percentile([5], 0.5)}`);
    if (median([5]) !== 5) mismatches.push(`median([5]): expected 5, got ${median([5])}`);
    if (percentile([1, 2, 3], 1) !== 3) mismatches.push(`percentile([1,2,3], 1): expected 3, got ${percentile([1, 2, 3], 1)}`);
    if (percentile([1, 2, 3], 0) !== 1) mismatches.push(`percentile([1,2,3], 0): expected 1, got ${percentile([1, 2, 3], 0)}`);
    if (median([1, 2, 3]) !== 2) mismatches.push(`median([1,2,3]): expected 2, got ${median([1, 2, 3])}`);
    // DESIGN defines only nearest-rank percentile; it never says whether the even
    // median averages the middle pair. Both 2 (nearest-rank) and 2.5 (average) are
    // defensible, so only membership is asserted here — see the ambiguity note.
    const even = median([1, 2, 3, 4]);
    if (even !== 2 && even !== 2.5) mismatches.push(`median([1,2,3,4]): expected 2 (nearest-rank) or 2.5 (averaged), got ${JSON.stringify(even)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `empty/single/p=1/p=0/even median (${even})`;
  });
}

async function phaseRules() {
  console.log('\n# 6. rules R1-R10 (DESIGN §5.2, §5.3)');

  const facts = ruleFacts();
  const sessions = new Set(facts.map((fact) => fact.sessionId));
  const base = cohortMetrics(facts);
  const cohort = { days: 0, workspace: null, tag: null, status: 'all', limit: 10, onlyArchived: false };

  function metricsFor(rule) {
    const metrics = { ...base };
    if (rule === 'R5') {
      metrics.correctionRate = 0.4;
      metrics.corrections = 4;
    } else if (rule === 'R7') {
      metrics.catalogBytes = 50000;
    }
    return metrics;
  }

  function findingFor(rule) {
    const findings = deriveFindings(metricsFor(rule), facts, cohort);
    const match = (findings || []).find((finding) => finding.rule === rule);
    if (!match) {
      const seen = (findings || []).map((finding) => finding.rule).join(',') || 'none';
      throw new Error(`${rule} did not fire; findings: ${seen}`);
    }
    return match;
  }

  function assertEvidence(finding, rule) {
    const evidence = finding.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0) throw new Error(`${rule}: evidence is empty`);
    for (const entry of evidence) {
      if (!entry || typeof entry.sessionId !== 'string' || !sessions.has(entry.sessionId)) {
        throw new Error(`${rule}: evidence entry is not a cohort {sessionId, seq}: ${JSON.stringify(entry)}`);
      }
      if (!Number.isInteger(entry.seq) || entry.seq < 0) throw new Error(`${rule}: evidence seq is not a non-negative integer: ${JSON.stringify(entry)}`);
    }
    return evidence.length;
  }

  const expectation = {
    R1: 'high', R2: 'high', R3: 'medium', R4: 'high', R5: 'high',
    R6: 'medium', R7: 'medium', R8: 'medium', R9: 'high', R10: 'low',
  };

  for (const rule of Object.keys(expectation)) {
    await check(`RUL.${rule}`, `${rule} fires with non-empty evidence of real {sessionId, seq} shape`, () => {
      const finding = findingFor(rule);
      const mismatches = [];
      if (finding.rule !== rule) mismatches.push(`rule: ${finding.rule}`);
      if (typeof finding.id !== 'string' || !finding.id.startsWith('f-')) mismatches.push(`id: ${JSON.stringify(finding.id)}`);
      if (typeof finding.title !== 'string' || !finding.title.trim()) mismatches.push('title is empty');
      if (typeof finding.detail !== 'string' || !finding.detail.trim()) mismatches.push('detail is empty');
      if (typeof finding.advice !== 'string' || !finding.advice.trim()) mismatches.push('advice is empty');
      if (typeof finding.metric !== 'string' || !finding.metric) mismatches.push('metric is empty');
      if (typeof finding.count !== 'number') mismatches.push(`count: ${JSON.stringify(finding.count)}`);
      const evidenceCount = assertEvidence(finding, rule);
      if (finding.severity !== expectation[rule]) {
        mismatches.push(`severity: expected ${expectation[rule]}, got ${JSON.stringify(finding.severity)}`);
      }
      if (mismatches.length) throw new Error(mismatches.join('; '));
      return `${evidenceCount} evidence, severity ${finding.severity}`;
    });
  }

  await check('RUL.CLEAN', 'a clean corpus yields no R1/R2/R4/R5/R7/R8/R9', () => {
    const clean = cleanFacts();
    const metrics = cohortMetrics(clean);
    const findings = deriveFindings(metrics, clean, { days: 0, onlyArchived: false, status: 'all', limit: 10 });
    const forbidden = ['R1', 'R2', 'R4', 'R5', 'R7', 'R8', 'R9'];
    const fired = (findings || []).filter((finding) => forbidden.includes(finding.rule)).map((finding) => `${finding.rule}:${finding.title}`);
    if (fired.length) throw new Error(`clean corpus fired ${fired.join(', ')}`);
    const others = (findings || []).map((finding) => finding.rule);
    return others.length ? `only [${others.join(',')}] fired` : 'no findings at all';
  });

  await check('RUL.EMPTY', 'an empty cohort yields findings [] without a crash', () => {
    const findings = deriveFindings(cohortMetrics([]), [], { days: 0, onlyArchived: false });
    assertArray(findings, 'findings');
    assertEqual(findings.length, 0, 'findings length');
    return '0 findings';
  });
}

async function phaseAutotags() {
  console.log('\n# 6b. automatic tags (DESIGN §10)');

  // DESIGN §2.1: lowercase ASCII `a-z 0-9 . _ : -` plus Han characters from the
  // CJK Extension A (U+3400-U+4DBF), Unified (U+4E00-U+9FFF) and Compatibility
  // (U+F900-U+FAFF) blocks. Spaces and every other punctuation mark stay banned.
  const CHARSET = /^auto:(?:[a-z0-9._:-]|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])+$/;
  const VERIFY_GAP = 'auto:验证缺口';
  const ORIGIN_USER = 'auto:来源:直接对话';

  // T1-T7 in one crafted facts object: every health tag plus origin/preset.
  const healthFacts = makeFacts({
    sessionId: 'tag-health',
    origin: 'user',
    agentPreset: 'router',
    counters: { corrections: 2 },
    tools: [toolRow('bash', 2, 3, { EINVAL: 3 })],
    repeated: [{ name: 'read', argKey: 'aaaaaaaaaaaa', times: 2, seqs: [3, 4] }],
    edits: { count: 1, seqs: [5], byTool: { write: 1 } },
    afterLastEditChecks: 0,
    turnEnds: { completed: 1, error: 1 },
    peakContextRatio: 0.2,
  });

  await check('TAG.1', 'T1-T7 fire together and the health tags precede origin/preset in priority order', () => {
    const expected = [
      'auto:错误热点:einval',
      VERIFY_GAP,
      'auto:轮次异常',
      'auto:重复调用',
      'auto:用户纠正',
      ORIGIN_USER,
      'auto:预设:router',
    ];
    const tags = deriveAutoTags(healthFacts, { limit: 20 });
    assertArray(tags, 'deriveAutoTags(...)');
    if (JSON.stringify(tags) !== JSON.stringify(expected)) {
      throw new Error(`tags: expected ${JSON.stringify(expected)}, got ${JSON.stringify(tags)}`);
    }
    const healthPrefixes = ['auto:错误热点:', 'auto:验证缺口', 'auto:轮次异常', 'auto:重复调用', 'auto:用户纠正'];
    const lastHealth = Math.max(...healthPrefixes.map((prefix) => tags.findIndex((tag) => tag === prefix || tag.startsWith(prefix))));
    const firstOrigin = tags.findIndex((tag) => tag.startsWith('auto:来源:'));
    const firstPreset = tags.findIndex((tag) => tag.startsWith('auto:预设:'));
    if (!(lastHealth < firstOrigin && lastHealth < firstPreset)) {
      throw new Error(`priority: health index ${lastHealth} must precede origin ${firstOrigin} and preset ${firstPreset} (${JSON.stringify(tags)})`);
    }
    return `${tags.length} tags: ${tags.join(' ')}`;
  });

  await check('TAG.2', 'T8/T9 are mutually exclusive and T10 needs a positive cohort median', () => {
    const pressure = deriveAutoTags(makeFacts({ sessionId: 'tag-ctx-high', origin: 'user', peakContextRatio: 0.65 }));
    const heavy = deriveAutoTags(makeFacts({ sessionId: 'tag-ctx-mid', origin: 'user', peakContextRatio: 0.45 }));
    const costFacts = makeFacts({ sessionId: 'tag-cost', origin: 'user', usage: { totalTokens: 900000 } });
    const cost = deriveAutoTags(costFacts, { cohortMedianTokens: 200000 });
    const noMedian = deriveAutoTags(costFacts, { cohortMedianTokens: 0 });
    const mismatches = [];
    if (!pressure.includes('auto:上下文吃紧')) mismatches.push(`0.65: missing auto:上下文吃紧 (${JSON.stringify(pressure)})`);
    if (pressure.includes('auto:上下文偏重')) mismatches.push(`0.65: auto:上下文偏重 must not fire (${JSON.stringify(pressure)})`);
    if (!heavy.includes('auto:上下文偏重')) mismatches.push(`0.45: missing auto:上下文偏重 (${JSON.stringify(heavy)})`);
    if (heavy.includes('auto:上下文吃紧')) mismatches.push(`0.45: auto:上下文吃紧 must not fire (${JSON.stringify(heavy)})`);
    if (!cost.includes('auto:成本偏高')) mismatches.push(`900k vs median 200k: missing auto:成本偏高 (${JSON.stringify(cost)})`);
    if (noMedian.includes('auto:成本偏高')) mismatches.push(`median 0: auto:成本偏高 must be skipped (${JSON.stringify(noMedian)})`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return 'pressure/heavy exclusive; cost.high gated on the median';
  });

  await check('TAG.3', 'T12 tags the top tools charset-safely and T13 detects zh/en only from human text', () => {
    const tools = makeFacts({
      sessionId: 'tag-tools',
      origin: 'user',
      tools: [toolRow('mcp__a__b', 7, 0, {}), toolRow('bash', 6, 0, {}), toolRow('read', 5, 0, {})],
    });
    const tagSet = deriveAutoTags(tools);
    const zh = deriveAutoTags(makeFacts({
      sessionId: 'tag-zh',
      origin: 'user',
      humanTexts: [{ seq: 1, chars: 21, text: '请检查这个文件然后重新运行测试并且报告结果' }],
    }));
    const en = deriveAutoTags(makeFacts({
      sessionId: 'tag-en',
      origin: 'user',
      humanTexts: [{ seq: 1, chars: 40, text: 'please re-run the checks and report the results' }],
    }));
    const none = deriveAutoTags(makeFacts({ sessionId: 'tag-none', origin: 'user', humanTexts: [] }));
    const mismatches = [];
    if (!tagSet.includes('auto:常用工具:mcp__a__b')) mismatches.push(`missing the mcp tool tag (${JSON.stringify(tagSet)})`);
    if (!tagSet.includes('auto:常用工具:bash')) mismatches.push(`missing auto:常用工具:bash (${JSON.stringify(tagSet)})`);
    if (tagSet.includes('auto:常用工具:read')) mismatches.push(`auto:常用工具:read is outside the top two tools (${JSON.stringify(tagSet)})`);
    const mcpTag = tagSet.find((tag) => tag.includes('mcp'));
    if (!mcpTag) mismatches.push('no mcp tool tag to charset-check');
    else if (!CHARSET.test(mcpTag)) mismatches.push(`mcp tool tag ${JSON.stringify(mcpTag)} is not charset-safe`);
    if (!zh.includes('auto:语言:中文')) mismatches.push(`Chinese-only text: missing auto:语言:中文 (${JSON.stringify(zh)})`);
    if (zh.includes('auto:语言:英文')) mismatches.push(`Chinese-only text: auto:语言:英文 must not fire (${JSON.stringify(zh)})`);
    if (!en.includes('auto:语言:英文')) mismatches.push(`ASCII-only text: missing auto:语言:英文 (${JSON.stringify(en)})`);
    if (en.includes('auto:语言:中文')) mismatches.push(`ASCII-only text: auto:语言:中文 must not fire (${JSON.stringify(en)})`);
    if (none.some((tag) => tag.startsWith('auto:语言:'))) mismatches.push(`empty humanTexts: a lang tag fired (${JSON.stringify(none)})`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `tools ${tagSet.filter((tag) => tag.startsWith('auto:常用工具:')).join(',')}; lang zh/en/none`;
  });

  await check('TAG.4', 'limit is honoured (3/0) and every tag matches the charset and the 32-char cap', () => {
    const full = deriveAutoTags(healthFacts, { limit: 20 });
    const three = deriveAutoTags(healthFacts, { limit: 3 });
    const zero = deriveAutoTags(healthFacts, { limit: 0 });
    const longPreset = deriveAutoTags(makeFacts({
      sessionId: 'tag-long',
      origin: 'user',
      agentPreset: 'a-very-long-preset-name-that-exceeds-the-cap',
    }));
    const mismatches = [];
    if (three.length !== 3) mismatches.push(`limit 3: expected exactly 3 tags, got ${three.length}`);
    if (JSON.stringify(three) !== JSON.stringify(full.slice(0, 3))) {
      mismatches.push(`limit 3: expected ${JSON.stringify(full.slice(0, 3))}, got ${JSON.stringify(three)}`);
    }
    if (!Array.isArray(zero) || zero.length !== 0) mismatches.push(`limit 0: expected [], got ${JSON.stringify(zero)}`);
    for (const tag of [...full, ...three, ...longPreset]) {
      if (!CHARSET.test(tag)) mismatches.push(`tag ${JSON.stringify(tag)} does not match ${CHARSET}`);
      if (tag.length > 32) mismatches.push(`tag ${JSON.stringify(tag)} is ${tag.length} chars (> 32)`);
    }
    const longTag = longPreset.find((tag) => tag.startsWith('auto:预设:'));
    if (!longTag) mismatches.push('a long preset produced no preset tag to truncate');
    else if (longTag.length > 32) mismatches.push(`truncated preset tag is ${longTag.length} chars (> 32)`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    const longest = Math.max(...[...full, ...longPreset].map((tag) => tag.length));
    return `limit 3 -> ${three.length}, limit 0 -> 0, longest ${longest} chars`;
  });

  let autoBase = null;
  let autoStore = null;
  let autoId = '';

  await check('TAG.5', 'sync() derives T2/T4 into entry.autoTags and keeps them visible in entry.tags', async () => {
    autoBase = await makeBase('autotag-sync');
    const authored = await writeSessionFixture(path.join(autoBase, 'sessions'), 'auto-slug', autoTagFixture('auto-fixture'));
    autoStore = new ArchiveStore({ rootDir: path.join(autoBase, 'archive'), sessionRoots: [authored.root] });
    await autoStore.init();
    const synced = await autoStore.sync({ refresh: true });
    assertEqual(synced.imported, 1, 'sync().imported');
    const index = await autoStore.index();
    autoId = Object.keys(index.entries)[0];
    assert(autoId, 'sync() imported no entry');
    const got = await autoStore.get(autoId);
    assert(got && got.entry, 'get() returned no entry after sync');
    const expected = [VERIFY_GAP, ORIGIN_USER];
    const mismatches = [];
    if (JSON.stringify(got.entry.autoTags) !== JSON.stringify(expected)) {
      mismatches.push(`autoTags: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got.entry.autoTags)}`);
    }
    if (JSON.stringify(got.entry.tags) !== JSON.stringify(expected)) {
      mismatches.push(`tags (no manual tags yet): expected ${JSON.stringify(expected)}, got ${JSON.stringify(got.entry.tags)}`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${autoId}: ${expected.join(', ')}`;
  });

  await check('TAG.6', 'update() keeps the manual and auto halves; autotag() re-derives without duplicating either', async () => {
    assert(autoStore && autoId, 'prerequisite: TAG.5 failed');
    const expectedAuto = [VERIFY_GAP, ORIGIN_USER];
    const updated = await autoStore.update(autoId, { tags: ['manual-keep'] });
    const mismatches = [];
    if (!updated || typeof updated !== 'object') mismatches.push('update() returned no entry');
    else {
      const updatedManual = manualTags(updated);
      if (JSON.stringify(updatedManual) !== JSON.stringify(['manual-keep'])) {
        mismatches.push(`manual tags after update: expected ["manual-keep"], got ${JSON.stringify(updatedManual)}`);
      }
      if (JSON.stringify(updated.tags) !== JSON.stringify(['manual-keep', ...expectedAuto])) {
        mismatches.push(`tags after update: expected ${JSON.stringify(['manual-keep', ...expectedAuto])}, got ${JSON.stringify(updated.tags)}`);
      }
    }
    const retagged = await autoStore.autotag({ id: autoId });
    let entry = retagged && retagged.entry;
    if (!entry) entry = (await autoStore.get(autoId)).entry;
    if (!entry) throw new Error('autotag() left no entry to inspect');
    const manual = manualTags(entry);
    if (JSON.stringify(manual) !== JSON.stringify(['manual-keep'])) mismatches.push(`manual tags after autotag: ${JSON.stringify(manual)}`);
    if (JSON.stringify(entry.autoTags) !== JSON.stringify(expectedAuto)) {
      mismatches.push(`autoTags after autotag: expected ${JSON.stringify(expectedAuto)}, got ${JSON.stringify(entry.autoTags)}`);
    }
    if (JSON.stringify(entry.tags) !== JSON.stringify(['manual-keep', ...expectedAuto])) {
      mismatches.push(`tags after autotag: expected ${JSON.stringify(['manual-keep', ...expectedAuto])}, got ${JSON.stringify(entry.tags)}`);
    }
    const seen = new Set();
    for (const tag of entry.tags || []) {
      if (seen.has(tag)) mismatches.push(`duplicate tag ${JSON.stringify(tag)}`);
      seen.add(tag);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${entry.tags.length} tags: ${entry.tags.join(', ')}`;
  });

  await check('TAG.7', 'autotag({dryRun:true}) writes nothing but reports updated>=1 and the sample tags', async () => {
    assert(autoStore && autoBase && autoId, 'prerequisite: TAG.5 failed');
    const indexFile = path.join(autoBase, 'archive', 'archive.json');
    const before = await fileState(indexFile);
    const result = await autoStore.autotag({ dryRun: true });
    const after = await fileState(indexFile);
    const mismatches = [];
    if (before === null) mismatches.push(`${indexFile} does not exist`);
    if (!sameSha(before, after)) mismatches.push(`archive.json sha changed: ${before} -> ${after}`);
    if (!result || typeof result !== 'object') mismatches.push('autotag() returned no object');
    else {
      if (!(typeof result.updated === 'number' && result.updated >= 1)) {
        mismatches.push(`updated: expected a number >= 1, got ${JSON.stringify(result.updated)}`);
      }
      assertArray(result.sample, 'autotag().sample');
      if (!result.sample.some((row) => Array.isArray(row.autoTags) && row.autoTags.includes(ORIGIN_USER))) {
        mismatches.push(`sample does not carry ${ORIGIN_USER}: ${JSON.stringify(result.sample)}`);
      }
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `updated=${result.updated}, sha ${String(before).slice(0, 12)} unchanged`;
  });

  await check('TAG.8', 'autoTag:false derives nothing during sync; mergeTags dedupes and caps at 24', async () => {
    const base = await makeBase('autotag-disabled');
    const authored = await writeSessionFixture(path.join(base, 'sessions'), 'auto-slug', autoTagFixture('auto-off'));
    const store = new ArchiveStore({ rootDir: path.join(base, 'archive'), sessionRoots: [authored.root], autoTag: false });
    await store.init();
    await store.sync({ refresh: true });
    const index = await store.index();
    const id = Object.keys(index.entries)[0];
    assert(id, 'sync() imported no entry');
    let entry = index.entries[id];
    const mismatches = [];
    if (!Array.isArray(entry.autoTags) || entry.autoTags.length !== 0) {
      mismatches.push(`autoTags with autoTag:false: expected [], got ${JSON.stringify(entry.autoTags)}`);
    }
    if ((entry.tags || []).some((tag) => String(tag).startsWith('auto:'))) {
      mismatches.push(`auto: tags leaked into tags: ${JSON.stringify(entry.tags)}`);
    }
    await store.update(id, { tags: ['manual-only'] });
    await store.sync({ refresh: true });
    entry = (await store.index()).entries[id];
    if (JSON.stringify(entry.tags) !== JSON.stringify(['manual-only'])) {
      mismatches.push(`manual tag was not preserved across a disabled sync: ${JSON.stringify(entry.tags)}`);
    }
    if ((entry.autoTags || []).length !== 0) mismatches.push(`autoTag:false derived ${JSON.stringify(entry.autoTags)}`);
    const merged = mergeTags(['a'], ['a', 'b']);
    if (JSON.stringify(merged) !== JSON.stringify(['a', 'b'])) {
      mismatches.push(`mergeTags(['a'],['a','b']): expected ["a","b"], got ${JSON.stringify(merged)}`);
    }
    const capped = mergeTags(
      Array.from({ length: 20 }, (_, i) => `m${i}`),
      Array.from({ length: 20 }, (_, i) => `auto:x${i}`),
    );
    if (capped.length !== 24) mismatches.push(`mergeTags cap: expected 24 total, got ${capped.length}`);
    if (new Set(capped).size !== capped.length) mismatches.push('mergeTags produced duplicates at the cap');
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `autoTag:false -> ${entry.tags.length} manual tag(s); mergeTags cap 24`;
  });

  await check('TAG.9', 'strictTags accepts Han and rejects spaces/punctuation; normalizeTags preserves Han', () => {
    const accepted = strictTags(['验证缺口', 'auto:错误热点:文件版本过期', 'mcp__a__b', 'a.b-c_d:e']);
    const mismatches = [];
    if (JSON.stringify(accepted) !== JSON.stringify(['验证缺口', 'auto:错误热点:文件版本过期', 'mcp__a__b', 'a.b-c_d:e'])) {
      mismatches.push(`strictTags accepted set: expected the four tags verbatim, got ${JSON.stringify(accepted)}`);
    }
    for (const bad of ['not a tag', 'bad,tag', 'bad!tag', 'space tag', '中文 空格']) {
      try {
        strictTags([bad]);
        mismatches.push(`strictTags must reject ${JSON.stringify(bad)}`);
      } catch (error) {
        if (!error || error.code !== 'invalid-tag') mismatches.push(`strictTags(${JSON.stringify(bad)}): expected invalid-tag code, got ${JSON.stringify(error && error.code)}`);
      }
    }
    const normalized = normalizeTags(['  MCP__A__B  ', '验证缺口', 'A,B!C', 'SPACE TAG']);
    const expectedNormalized = ['mcp__a__b', '验证缺口', 'a-b-c', 'space-tag'];
    if (JSON.stringify(normalized) !== JSON.stringify(expectedNormalized)) {
      mismatches.push(`normalizeTags: expected ${JSON.stringify(expectedNormalized)}, got ${JSON.stringify(normalized)}`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `strictTags accepts Han; normalizeTags -> ${normalized.join(', ')}`;
  });

  await check('TAG.10', 'known error codes map to Chinese labels; unlisted codes keep their lowercase code', () => {
    const known = deriveAutoTags(makeFacts({ sessionId: 'tag-err-known', origin: 'user', tools: [toolRow('bash', 2, 3, { FS_STALE_VERSION: 3 })] }));
    const unlisted = deriveAutoTags(makeFacts({ sessionId: 'tag-err-unlisted', origin: 'user', tools: [toolRow('bash', 2, 3, { EINVAL: 3 })] }));
    const unknown = deriveAutoTags(makeFacts({ sessionId: 'tag-err-unknown', origin: 'user', tools: [toolRow('bash', 2, 3, { UNKNOWN: 3 })] }));
    const mismatches = [];
    if (!known.includes('auto:错误热点:文件版本过期')) mismatches.push(`FS_STALE_VERSION: missing 文件版本过期 (${JSON.stringify(known)})`);
    if (!unlisted.includes('auto:错误热点:einval')) mismatches.push(`EINVAL: missing lowercase einval (${JSON.stringify(unlisted)})`);
    if (!unknown.includes('auto:错误热点:未知错误')) mismatches.push(`unknown: missing 未知错误 (${JSON.stringify(unknown)})`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return 'FS_STALE_VERSION->文件版本过期, EINVAL->einval, unknown->未知错误';
  });
}

async function phasePdca() {
  console.log('\n# 7. PDCA (DESIGN §5, §6)');

  const facts = metricFacts();
  let run = null;
  let proposals = null;

  await check('PDC.1', 'plan -> do -> check on 3 synthetic facts yields a consistent run', () => {
    const planned = planRun({ cohort: { days: 0, limit: 10 } });
    assert(planned && typeof planned === 'object', 'planRun returned no run');
    assertMatch(planned.id, /^run-\d{8}-\d{6}-[a-z0-9]{4}$/, 'run.id');
    assertArray(planned.plan && planned.plan.targets, 'plan.targets');
    assertEqual(planned.plan.targets.length, DEFAULT_TARGETS.length, 'default target count');
    const done = executeDo(planned, facts) || planned;
    const checked = executeCheck(done, facts, null) || done;
    run = checked;

    const mismatches = [];
    if (!Array.isArray(run.do && run.do.sessionIds)) mismatches.push('do.sessionIds is not an array');
    else if (run.do.sessionIds.length !== 3) mismatches.push(`do.sessionIds.length: expected 3, got ${run.do.sessionIds.length}`);
    if (!run.check || typeof run.check !== 'object') mismatches.push('check is missing');
    else {
      if (!run.check.metrics || run.check.metrics.sessions !== 3) mismatches.push(`check.metrics.sessions: expected 3, got ${JSON.stringify(run.check.metrics && run.check.metrics.sessions)}`);
      if (!Array.isArray(run.check.verdicts)) mismatches.push('check.verdicts is not an array');
      else {
        for (const verdict of run.check.verdicts) {
          if (!['pass', 'fail', 'inconclusive'].includes(verdict.verdict)) mismatches.push(`verdict ${JSON.stringify(verdict.verdict)} is not pass|fail|inconclusive`);
        }
        if (run.check.verdicts.length !== run.plan.targets.length) {
          mismatches.push(`verdict count: expected ${run.plan.targets.length}, got ${run.check.verdicts.length}`);
        }
        // A pass/fail verdict must agree with its own metric and target.
        for (const verdict of run.check.verdicts) {
          if (verdict.verdict === 'inconclusive') continue;
          const actual = verdict.actual;
          const target = verdict.target;
          if (typeof actual !== 'number' || typeof target !== 'number') continue;
          let shouldPass;
          if (verdict.op === '<=') shouldPass = actual <= target;
          else if (verdict.op === '>=') shouldPass = actual >= target;
          else if (verdict.op === '<') shouldPass = actual < target;
          else if (verdict.op === '>') shouldPass = actual > target;
          else continue;
          if (verdict.verdict === 'pass' && !shouldPass) mismatches.push(`${verdict.metric}: pass but ${actual} ${verdict.op} ${target} is false`);
          if (verdict.verdict === 'fail' && shouldPass) mismatches.push(`${verdict.metric}: fail but ${actual} ${verdict.op} ${target} is true`);
        }
      }
    }
    if (!Array.isArray(run.act && run.act.findings)) mismatches.push('act.findings is not an array');
    if (run.phase !== 'act') mismatches.push(`phase: expected act after executeCheck, got ${JSON.stringify(run.phase)}`);
    if (mismatches.length) throw new Error(`${mismatches.length} mismatch(es): ${mismatches.join('; ')}`);
    return `${run.check.verdicts.length} verdicts from ${run.check.verdicts.map((verdict) => verdict.verdict).join('/')}`;
  });

  await check('PDC.2', 'proposalsFor(run) yields §6-shaped proposals, deduped, with evidence copied from findings', () => {
    assert(run, 'prerequisite: PDC.1 failed');
    proposals = proposalsFor(run);
    assertArray(proposals, 'proposals');
    if (proposals.length === 0) throw new Error('proposalsFor returned no proposals for a run with findings');

    const findingIds = new Set((run.act.findings || []).map((finding) => finding.id));
    const evidenceOf = new Map((run.act.findings || []).map((finding) => [finding.id, finding.evidence || []]));
    const problems = [];
    const seen = new Set();

    for (const proposal of proposals) {
      const label = proposal && proposal.id ? proposal.id : JSON.stringify(proposal).slice(0, 60);
      if (!proposal || typeof proposal !== 'object') { problems.push(`${label}: not an object`); continue; }
      if (typeof proposal.id !== 'string' || !/^prop-\d{8}-\d{6}-[a-z0-9]{4}$/.test(proposal.id)) problems.push(`${label}: id does not match prop-<yyyymmdd-hhmmss>-<4rand>`);
      if (proposal.runId !== run.id) problems.push(`${label}: runId ${JSON.stringify(proposal.runId)} !== ${run.id}`);
      if (!PROPOSAL_KINDS.includes(proposal.kind)) problems.push(`${label}: kind ${JSON.stringify(proposal.kind)}`);
      if (typeof proposal.target !== 'string') problems.push(`${label}: target is not a string`);
      if (typeof proposal.title !== 'string' || !proposal.title.trim()) problems.push(`${label}: title is empty`);
      if (typeof proposal.rationale !== 'string' || !proposal.rationale.trim()) problems.push(`${label}: rationale is empty`);
      if (typeof proposal.body !== 'string' || !proposal.body.trim()) problems.push(`${label}: body is empty`);
      if (!EFFECTS.includes(proposal.expectedEffect)) problems.push(`${label}: expectedEffect ${JSON.stringify(proposal.expectedEffect)}`);
      if (typeof proposal.expectedMetric !== 'string' || !proposal.expectedMetric) problems.push(`${label}: expectedMetric is empty`);
      if (!RISKS.includes(proposal.risk)) problems.push(`${label}: risk ${JSON.stringify(proposal.risk)}`);
      if (!PROPOSAL_STATUS.includes(proposal.status)) problems.push(`${label}: status ${JSON.stringify(proposal.status)}`);
      if (proposal.status !== 'proposed') problems.push(`${label}: status expected proposed, got ${proposal.status}`);
      if (typeof proposal.createdAt !== 'number' || !Number.isFinite(proposal.createdAt)) problems.push(`${label}: createdAt is not a number`);
      if (proposal.evaluation !== null) problems.push(`${label}: evaluation must be null before a later rsi_check`);
      if (!Array.isArray(proposal.findingIds) || proposal.findingIds.length === 0) problems.push(`${label}: findingIds is empty`);
      for (const findingId of proposal.findingIds || []) {
        if (!findingIds.has(findingId)) problems.push(`${label}: findingIds references unknown ${findingId}`);
      }
      if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) problems.push(`${label}: evidence is empty`);
      const allowed = new Set();
      for (const findingId of proposal.findingIds || []) for (const entry of evidenceOf.get(findingId) || []) allowed.add(`${entry.sessionId}#${entry.seq}`);
      for (const entry of proposal.evidence || []) {
        if (!entry || typeof entry.sessionId !== 'string' || !Number.isInteger(entry.seq)) problems.push(`${label}: evidence is not {sessionId, seq}: ${JSON.stringify(entry)}`);
        else if (!allowed.has(`${entry.sessionId}#${entry.seq}`)) problems.push(`${label}: evidence ${entry.sessionId}#${entry.seq} is not copied from a finding`);
      }
      const key = `${proposal.kind}|${proposal.target}|${proposal.expectedMetric}`;
      if (seen.has(key)) problems.push(`${label}: duplicate (kind,target,expectedMetric) ${key}`);
      seen.add(key);
    }
    if (problems.length) throw new Error(`${problems.length} problem(s): ${problems.slice(0, 6).join('; ')}`);
    return `${proposals.length} proposals, kinds ${[...new Set(proposals.map((proposal) => proposal.kind))].join('/')}`;
  });

  await check('PDC.3', 'planRun/executeDo/finishCheck/summarizeRun expose the status + timing lifecycle', () => {
    const planned = planRun({ cohort: { days: 0, limit: 5 } });
    const mismatches = [];
    if (planned.status !== 'planned') mismatches.push(`planRun.status: expected planned, got ${JSON.stringify(planned.status)}`);
    if (typeof planned.startedAt !== 'number' || !Number.isFinite(planned.startedAt)) mismatches.push(`planRun.startedAt: expected a finite number, got ${JSON.stringify(planned.startedAt)}`);
    if (planned.finishedAt !== null) mismatches.push(`planRun.finishedAt: expected null, got ${JSON.stringify(planned.finishedAt)}`);
    const done = executeDo(planned, facts);
    if (done.status !== 'running') mismatches.push(`executeDo.status: expected running, got ${JSON.stringify(done.status)}`);
    const checked = finishCheck(done, facts, null);
    if (checked.status !== 'checked') mismatches.push(`finishCheck.status: expected checked, got ${JSON.stringify(checked.status)}`);
    if (typeof checked.finishedAt !== 'number' || !Number.isFinite(checked.finishedAt)) mismatches.push(`finishCheck.finishedAt: expected a finite number, got ${JSON.stringify(checked.finishedAt)}`);
    const summary = summarizeRun(checked, { now: checked.finishedAt + 1 });
    if (summary.status !== 'checked') mismatches.push(`summary.status: expected checked, got ${JSON.stringify(summary.status)}`);
    if (typeof summary.durationMs !== 'number' || !(summary.durationMs >= 0)) mismatches.push(`summary.durationMs: expected a non-negative number, got ${JSON.stringify(summary.durationMs)}`);
    if (summary.running !== false) mismatches.push(`summary.running: expected false for a checked run, got ${JSON.stringify(summary.running)}`);
    if (summary.stalled !== false) mismatches.push(`summary.stalled: expected false for a checked run, got ${JSON.stringify(summary.stalled)}`);
    if (!summary.targets || typeof summary.targets !== 'object') mismatches.push('summary.targets is missing');
    else if (summary.targets.total !== checked.check.verdicts.length) mismatches.push(`summary.targets.total: expected ${checked.check.verdicts.length}, got ${JSON.stringify(summary.targets.total)}`);
    if (typeof summary.findings !== 'number' || typeof summary.proposals !== 'number') mismatches.push('summary.findings/proposals are not numbers');
    // stalled/running semantics on a run with no finishedAt.
    const staleMs = 600_000;
    const runningRun = { id: 'run-x', status: 'running', phase: 'do', createdAt: 1000, updatedAt: 2000, finishedAt: null };
    const fresh = summarizeRun(runningRun, { now: 2001, staleMs });
    if (fresh.running !== true || fresh.stalled !== false) mismatches.push(`fresh running run: expected running=true/stalled=false, got running=${JSON.stringify(fresh.running)} stalled=${JSON.stringify(fresh.stalled)}`);
    const stale = summarizeRun(runningRun, { now: 2000 + staleMs + 1, staleMs });
    if (stale.running !== false || stale.stalled !== true) mismatches.push(`stale running run: expected running=false/stalled=true, got running=${JSON.stringify(stale.running)} stalled=${JSON.stringify(stale.stalled)}`);
    // status derivation from phase when status is absent.
    const legacy = summarizeRun({ phase: 'check', createdAt: 1000, updatedAt: 2000 }, { now: 3000 });
    if (legacy.status !== 'checked') mismatches.push(`legacy phase=check: expected checked, got ${JSON.stringify(legacy.status)}`);
    if (legacy.finishedAt !== 2000) mismatches.push(`legacy finishedAt: expected 2000 (updatedAt fallback), got ${JSON.stringify(legacy.finishedAt)}`);
    // A duration needs a recorded start: pre-`startedAt` runs report none rather
    // than the createdAt->updatedAt gap, which is 0 for a single-write run.
    if (legacy.startedAt !== null) mismatches.push(`legacy startedAt: expected null, got ${JSON.stringify(legacy.startedAt)}`);
    if (legacy.durationMs !== null) mismatches.push(`legacy durationMs: expected null without startedAt, got ${JSON.stringify(legacy.durationMs)}`);
    const measured = summarizeRun({ phase: 'check', startedAt: 1000, createdAt: 900, updatedAt: 3000, finishedAt: 3000 }, { now: 4000 });
    if (measured.durationMs !== 2000) mismatches.push(`startedAt-measured durationMs: expected 2000, got ${JSON.stringify(measured.durationMs)}`);
    // A crashed marker is retired as "failed", which is neither running nor stalled.
    const failed = summarizeRun({ status: 'failed', phase: 'plan', createdAt: 1000, updatedAt: 2000 }, { now: 3000 });
    if (failed.running !== false || failed.stalled !== false) mismatches.push(`failed run: expected running=false/stalled=false, got running=${JSON.stringify(failed.running)} stalled=${JSON.stringify(failed.stalled)}`);
    if (failed.status !== 'failed') mismatches.push(`failed run: status should stay failed, got ${JSON.stringify(failed.status)}`);
    // executeCheck is an exported API: it must not hand back a "running" status.
    const checkedDirect = executeCheck(done, facts, null);
    if (checkedDirect.status !== 'checked') mismatches.push(`executeCheck.status: expected checked, got ${JSON.stringify(checkedDirect.status)}`);
    if (!Number.isFinite(checkedDirect.finishedAt)) mismatches.push(`executeCheck.finishedAt: expected a finite number, got ${JSON.stringify(checkedDirect.finishedAt)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `planned->running->checked; durationMs=${summary.durationMs}; targets=${summary.targets.total}`;
  });

  await check('PDC.4', 'proposals are deduped by content fingerprint inside a run and against stored ones', () => {
    const finding = (id, count, title) => ({
      id, rule: 'R1', severity: 'high', tool: 'edit', count, title,
      detail: `${count} of 10 calls to edit failed.`, metric: 'toolErrorRate', evidence: [],
    });
    const run = {
      id: 'run-dedupe', createdAt: 1000, act: {
        findings: [finding('f-1', 4, 'Tool "edit" fails 40.0% of calls'), finding('f-2', 9, 'Tool "edit" fails 90.0% of calls')],
        proposalIds: [],
      },
    };
    const mismatches = [];
    const first = planProposals(run, { now: 2000, agentsFile: '/tmp/agents.md', skillsRoot: '/tmp/skills' });
    if (first.proposals.length !== 1) mismatches.push(`two same-tool findings must collapse to one proposal, got ${first.proposals.length}`);
    const fp = first.proposals[0] && first.proposals[0].fingerprint;
    if (!fp) mismatches.push('the proposal carries no fingerprint');
    // The count moved, so the title text differs — the fingerprint must not.
    const other = proposalFingerprint({
      kind: first.proposals[0].kind, target: first.proposals[0].target,
      expectedMetric: first.proposals[0].expectedMetric, title: 'Tool "edit" fails 12.5% of calls',
    });
    if (other !== fp) mismatches.push(`fingerprint drifted with the count: ${JSON.stringify({ fp, other })}`);

    const reused = planProposals(run, { now: 3000, existing: first.proposals });
    if (reused.proposals.length !== 0 || reused.reused.length !== 1) {
      mismatches.push(`an open duplicate must be reused (created ${reused.proposals.length}, reused ${reused.reused.length})`);
    }
    const adopted = planProposals(run, { now: 3000, existing: [{ ...first.proposals[0], status: 'adopted' }] });
    if (adopted.proposals.length !== 0 || adopted.skipped.length !== 1) {
      mismatches.push(`an adopted proposal must not be re-proposed (created ${adopted.proposals.length}, skipped ${adopted.skipped.length})`);
    }
    const rejected = planProposals(run, { now: 3000, existing: [{ ...first.proposals[0], status: 'rejected' }] });
    if (rejected.proposals.length !== 1) {
      mismatches.push(`a rejected proposal may be proposed again, got ${rejected.proposals.length}`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `1 proposal for 2 same-tool findings; reuse/adopted/rejected semantics hold (${fp.slice(0, 40)}…)`;
  });
}

async function phaseAdoption() {
  console.log('\n# 8. proposal adoption (DESIGN §6.1)');

  const base = await makeBase('adopt');
  const root = path.join(base, 'root');
  const agentsDir = path.join(base, 'agents');
  const agentsFile = path.join(agentsDir, 'AGENTS.md');
  const skillsRoot = path.join(base, 'skills');
  const originalAgents = '# My rules\n\nKeep this line.\n';
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.writeFile(agentsFile, originalAgents);
  const options = { rootDir: root, agentsFile, skillsRoot };

  const promptProposal = makeProposal({
    id: 'prop-20261108-120000-aaaa',
    kind: 'prompt-section',
    target: 'archive-rsi/lessons',
    expectedMetric: 'verificationGapRate',
    adoption: null,
  });
  const agentsProposal = makeProposal({
    id: 'prop-20261108-120000-bbbb',
    kind: 'agents-md-rule',
    target: agentsFile,
    title: 'Check the model tier before long mechanical work',
    body: 'Before a long mechanical run, confirm the model tier and the remaining budget.',
    expectedMetric: 'turnFailureRate',
    evidence: [{ sessionId: 's2', seq: 3 }],
    adoption: { path: agentsFile, backupPath: null, beforeSha: sha256(Buffer.from(originalAgents, 'utf8')), afterSha: null, bytes: 0, mode: 'append' },
  });
  const skillProposal = makeProposal({
    id: 'prop-20261108-120000-cccc',
    kind: 'skill-candidate',
    target: path.join(skillsRoot, 'verify-after-edit', 'SKILL.md'),
    title: 'Verify after edit',
    body: '# Verify after edit\n\nRe-run the check suite after the last edit and attach the output.',
    expectedMetric: 'verificationGapRate',
    evidence: [{ sessionId: 's1', seq: 12 }],
    adoption: null,
  });

  let adoptedPrompt = null;
  let adoptedAgents = null;
  let adoptedSkill = null;
  const states = {};

  await check('ADO.1', 'applyProposal(prompt-section) writes <root>/lessons.md; revert restores it byte-identically', async () => {
    const lessonsFile = path.join(root, 'lessons.md');
    states.promptBefore = await fileState(lessonsFile);
    adoptedPrompt = await applyProposal(promptProposal, options);
    const mismatches = [];
    if (adoptedPrompt.status !== 'adopted') mismatches.push(`status: expected adopted, got ${JSON.stringify(adoptedPrompt.status)}`);
    if (!(await exists(lessonsFile))) mismatches.push('lessons.md was not created');
    else {
      const text = await readText(lessonsFile);
      if (!text.includes(promptProposal.body)) mismatches.push('lessons.md does not contain the proposal body');
    }
    if (!adoptedPrompt.adoption || adoptedPrompt.adoption.path !== lessonsFile) {
      mismatches.push(`adoption.path: expected ${lessonsFile}, got ${JSON.stringify(adoptedPrompt.adoption && adoptedPrompt.adoption.path)}`);
    }
    if (adoptedPrompt.adoption && !['append', 'replace', 'create'].includes(adoptedPrompt.adoption.mode)) {
      mismatches.push(`adoption.mode: ${JSON.stringify(adoptedPrompt.adoption.mode)}`);
    }
    const reverted = await revertProposal(adoptedPrompt, options);
    const after = await fileState(lessonsFile);
    if (reverted.status !== 'reverted') mismatches.push(`reverted.status: expected reverted, got ${JSON.stringify(reverted.status)}`);
    if (!sameSha(after, states.promptBefore)) mismatches.push(`lessons.md sha after revert: expected ${states.promptBefore}, got ${after}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return states.promptBefore === null ? 'created then removed' : 'restored byte-identically';
  });

  await check('ADO.2', 'applyProposal(agents-md-rule) appends a marker block and revert restores the original bytes', async () => {
    const before = await fileState(agentsFile);
    adoptedAgents = await applyProposal(agentsProposal, options);
    const mismatches = [];
    if (adoptedAgents.status !== 'adopted') mismatches.push(`status: expected adopted, got ${JSON.stringify(adoptedAgents.status)}`);
    const text = await readText(agentsFile);
    if (!text.startsWith(originalAgents)) mismatches.push('the original bytes are no longer a prefix of AGENTS.md');
    if (!text.includes(`<!-- archive-rsi: ${agentsProposal.id} -->`)) mismatches.push('the archive-rsi marker block is missing');
    if (!text.includes(agentsProposal.body)) mismatches.push('the rule body was not appended');
    const adoption = adoptedAgents.adoption || {};
    if (adoption.mode !== 'append') mismatches.push(`adoption.mode: expected append, got ${JSON.stringify(adoption.mode)}`);
    if (typeof adoption.backupPath !== 'string' || !(await exists(adoption.backupPath))) mismatches.push(`adoption.backupPath: expected an existing backup, got ${JSON.stringify(adoption.backupPath)}`);
    const reverted = await revertProposal(adoptedAgents, options);
    const after = await fileState(agentsFile);
    if (reverted.status !== 'reverted') mismatches.push(`reverted.status: expected reverted, got ${JSON.stringify(reverted.status)}`);
    if (!sameSha(after, before)) mismatches.push(`AGENTS.md sha after revert: expected ${before}, got ${after}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `sha ${before.slice(0, 12)} restored`;
  });

  await check('ADO.3', 'applyProposal(skill-candidate) creates <skillsRoot>/<slug>/SKILL.md; revert removes it', async () => {
    const skillFile = skillProposal.target;
    const before = await fileState(skillFile);
    adoptedSkill = await applyProposal(skillProposal, options);
    const mismatches = [];
    if (adoptedSkill.status !== 'adopted') mismatches.push(`status: expected adopted, got ${JSON.stringify(adoptedSkill.status)}`);
    if (!(await exists(skillFile))) mismatches.push(`${skillFile} was not created`);
    else {
      const text = await readText(skillFile);
      if (!text.includes(skillProposal.body)) mismatches.push('SKILL.md does not contain the proposal body');
    }
    const reverted = await revertProposal(adoptedSkill, options);
    const after = await fileState(skillFile);
    if (reverted.status !== 'reverted') mismatches.push(`reverted.status: expected reverted, got ${JSON.stringify(reverted.status)}`);
    if (!sameSha(after, before)) mismatches.push(`SKILL.md sha after revert: expected ${before}, got ${after}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${path.relative(skillsRoot, skillFile)} created then removed`;
  });

  await check('ADO.4', 'slugifySkill produces a safe directory name', () => {
    const cases = [
      ['Verify after edit!', 'verify-after-edit'],
      ['  ', 'skill'],
      ['Ünïcode / Terms', 'unicode-terms'],
    ];
    const mismatches = [];
    for (const [input, expected] of cases) {
      const got = slugifySkill(input);
      if (got !== expected) mismatches.push(`${JSON.stringify(input)}: expected ${expected}, got ${JSON.stringify(got)}`);
      if (!/^[a-z0-9-]+$/.test(got)) mismatches.push(`${JSON.stringify(input)}: unsafe slug ${JSON.stringify(got)}`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `${cases.length} slugs`;
  });

  // ---- refusals -------------------------------------------------------
  await check('REF.1', 'adopting an advisory proposal is refused with not-adoptable', async () => {
    const advisory = makeProposal({ id: 'prop-20261108-120000-dddd', kind: 'advisory', target: '', body: 'Tool description recommendation.' });
    const error = await expectCodedError(() => applyProposal(advisory, options), /not-adoptable/, 'advisory adopt');
    return error.code;
  });

  await check('REF.2', 'a target outside the allowed roots is refused with path-outside-root', async () => {
    const outside = makeProposal({
      id: 'prop-20261108-120000-eeee',
      kind: 'agents-md-rule',
      target: path.join(path.dirname(tmpdir()), 'not-allowed', 'AGENTS.md'),
      body: 'escape attempt',
    });
    const error = await expectCodedError(() => applyProposal(outside, options), /path-outside-root/, 'outside-root adopt');
    return error.code;
  });

  await check('REF.3', 'a target edited after the proposal was created is refused with target-changed', async () => {
    const before = await readText(agentsFile);
    try {
      const stale = makeProposal({
        id: 'prop-20261108-120000-ffff',
        kind: 'agents-md-rule',
        target: agentsFile,
        body: 'A rule written against the old AGENTS.md.',
        adoption: { path: agentsFile, backupPath: null, beforeSha: sha256(Buffer.from(before, 'utf8')), afterSha: null, bytes: 0, mode: 'append' },
      });
      await fs.appendFile(agentsFile, '\nEdited by someone else after the proposal.\n');
      const error = await expectCodedError(() => applyProposal(stale, options), /target-changed/, 'target-changed adopt');
      return error.code;
    } finally {
      await fs.writeFile(agentsFile, before);
    }
  });

  await check('REF.4', 'adopting an already-adopted proposal is refused with not-proposed', async () => {
    assert(adoptedPrompt, 'prerequisite: ADO.1 failed');
    const error = await expectCodedError(() => applyProposal(adoptedPrompt, options), /not-proposed/, 're-adopt');
    return error.code;
  });
}

async function phaseWiring() {
  console.log('\n# 9. plugin wiring (DESIGN §7.3)');

  const base = await makeBase('wiring');
  const root = path.join(base, 'root');
  const stub = await applyPlugin({ config: { rootDir: root } });

  await check('WIR.1', 'apply() registers exactly the 11 §7.3 tools with valid definitions', () => {
    const names = [...stub.state.tools.keys()];
    const mismatches = [];
    if (names.length !== 11) mismatches.push(`tool count: expected 11, got ${names.length} (${names.join(', ')})`);
    if (new Set(names).size !== names.length) mismatches.push('tool names are not unique');
    for (const expected of TOOL_NAMES) if (!names.includes(expected)) mismatches.push(`missing tool ${expected}`);
    for (const extra of names.filter((name) => !TOOL_NAMES.includes(name))) mismatches.push(`unexpected tool ${extra}`);
    if (!names.includes('archive_autotag')) mismatches.push('§7.3 tool archive_autotag is not registered');
    for (const [name, definition] of stub.state.tools) {
      if (typeof definition.description !== 'string' || definition.description.length < 20) mismatches.push(`${name}: description too short`);
      if (!definition.parameters || definition.parameters.type !== 'object') mismatches.push(`${name}: parameters are not an object schema`);
      if (typeof definition.execute !== 'function') mismatches.push(`${name}: execute() missing`);
      if (!definition.output || typeof definition.output.render !== 'function') mismatches.push(`${name}: output.render() missing`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `11 tools: ${names.join(', ')}`;
  });

  await check('WIR.2', 'exactly one prompt section named tool:archive-rsi with a finite numeric order', () => {
    const mismatches = [];
    const sections = stub.state.sections;
    if (sections.length !== 1) mismatches.push(`section count: expected 1, got ${sections.length} (${sections.map((section) => section.name).join(', ')})`);
    const section = sections[0];
    if (!section) throw new Error('no prompt section registered');
    if (section.name !== 'tool:archive-rsi') mismatches.push(`section name: expected tool:archive-rsi, got ${JSON.stringify(section.name)}`);
    if (typeof section.order !== 'number' || !Number.isFinite(section.order)) mismatches.push(`section order is not finite: ${JSON.stringify(section.order)}`);
    else if (section.order !== 2310) mismatches.push(`section order: expected getSectionOrder('TOOL_SESSION_QUERY')+10 = 2310 (stub returns 2300), got ${section.order}`);
    if (typeof section.text !== 'string' && typeof section.text !== 'function') mismatches.push('section text is neither a string nor a function');
    if (typeof section.text === 'string' && !section.text.trim()) mismatches.push('section text is empty');
    if (stub.state.contexts.length !== 0) mismatches.push(`§7.3 says no systemPrompt.context in v1, but ${stub.state.contexts.length} registered`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `order ${section.order}`;
  });

  await check('WIR.3', 'exactly one prefix route on /api/archive-rsi with a handler', () => {
    const routes = stub.state.routes;
    assertEqual(routes.length, 1, `route count (${routes.map((route) => `${route.kind} ${route.path}`).join(', ')})`);
    assertEqual(routes[0].kind, 'prefix', 'route.kind');
    assertEqual(routes[0].path, '/api/archive-rsi', 'route.path');
    assertEqual(typeof routes[0].handler, 'function', 'route.handler');
    return `${routes[0].kind} ${routes[0].path}`;
  });

  await check('WIR.4', 'every tool output.render(args, result) returns a ContentBlock[] whose first block is text', async () => {
    const problems = [];
    for (const [name, definition] of stub.state.tools) {
      let result;
      try {
        result = await definition.execute(BAD_ARGS[name] || {}, { agent: { id: 'session-render' } });
      } catch (error) {
        problems.push(`${name}: execute() threw during the render fixture (${(error && error.message) || error})`);
        continue;
      }
      let blocks;
      try {
        blocks = definition.output.render({}, result);
      } catch (error) {
        problems.push(`${name}: render() threw (${(error && error.message) || error})`);
        continue;
      }
      if (!Array.isArray(blocks)) problems.push(`${name}: render() returned ${typeof blocks}, not an array`);
      else if (blocks.length === 0) problems.push(`${name}: render() returned an empty array`);
      else if (!blocks[0] || blocks[0].type !== 'text') problems.push(`${name}: first block is ${JSON.stringify(blocks[0])}, expected {type:'text'}`);
      else if (typeof blocks[0].text !== 'string') problems.push(`${name}: first block text is ${typeof blocks[0].text}`);
    }
    if (problems.length) throw new Error(problems.join('; '));
    return `${stub.state.tools.size} tools`;
  });

  await check('WIR.5', 'with syncOnBoot:false nothing is imported and no run is written before the first tool call', async () => {
    // §7.3 lists exactly one boot side effect: "sync on boot". With that switched
    // off, a fresh store must still be empty when the first tool call arrives.
    const real = await realSessionFiles();
    if (real.length < 1) return 'no real sessions to observe (vacuous)';
    const bootBase = await makeBase('boot');
    const fixture = await copySessionFixture(bootBase, real, 2);
    const bootRoot = path.join(bootBase, 'root');
    await applyPlugin({
      config: { rootDir: bootRoot, sessionsDir: fixture.root, syncOnBoot: false },
    });
    const entries = await waitForStableEntryCount(bootRoot);
    const runs = await fs.readdir(path.join(bootRoot, 'runs')).catch(() => []);
    const proposals = await fs.readdir(path.join(bootRoot, 'proposals')).catch(() => []);
    const mismatches = [];
    if (entries !== 0) mismatches.push(`the store imported ${entries} session(s) at boot although syncOnBoot is false`);
    if (runs.length !== 0) mismatches.push(`the plugin wrote ${runs.length} PDCA run(s) at boot without a tool call`);
    if (proposals.length !== 0) mismatches.push(`the plugin wrote ${proposals.length} proposal(s) at boot without a tool call`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return 'store untouched at boot';
  });
}

async function phaseBadArgs() {
  console.log('\n# 10. tool argument validation (DESIGN §7.3)');

  const base = await makeBase('badargs');
  const emptySessions = path.join(base, 'sessions');
  await fs.mkdir(emptySessions, { recursive: true });
  const stub = await applyPlugin({
    config: { rootDir: path.join(base, 'root'), sessionsDir: emptySessions, syncOnBoot: false },
  });

  await check('BAD.1', 'calling every tool with {} never throws; tools with a required arg return ok:false', async () => {
    const problems = [];
    for (const name of TOOL_NAMES) {
      let result;
      try {
        result = await callTool(stub, name, {});
      } catch (error) {
        problems.push(`${name}({}): threw ${(error && error.message) || error}`);
        continue;
      }
      if (!result || typeof result !== 'object') {
        problems.push(`${name}({}): returned ${JSON.stringify(result)}`);
        continue;
      }
      if (typeof result.ok !== 'boolean') problems.push(`${name}({}): ok is ${typeof result.ok}`);
      try {
        JSON.stringify(result);
      } catch (error) {
        problems.push(`${name}({}): result is not JSON-serializable`);
      }
      const required = REQUIRED_ARGS[name];
      if (required && result.ok !== false) {
        problems.push(`${name}({}): expected ok:false for the missing required arg [${required.join(',')}], got ok:${result.ok}`);
      }
      if (required && result.ok === false) {
        if (!result.error || typeof result.error.code !== 'string' || !result.error.code) problems.push(`${name}({}): error.code missing`);
        if (!result.error || typeof result.error.message !== 'string' || !result.error.message) problems.push(`${name}({}): error.message missing`);
      }
      if (!required && result.ok !== true) {
        problems.push(`${name}({}): expected ok:true (no required args), got ${JSON.stringify(result.error || result).slice(0, 160)}`);
      }
    }
    if (problems.length) throw new Error(problems.join('; '));
    return `${TOOL_NAMES.length} tools, ${Object.keys(REQUIRED_ARGS).length} with required args`;
  });

  await check('BAD.2', 'calling every tool with wrong-typed args never throws', async () => {
    const problems = [];
    for (const name of TOOL_NAMES) {
      let result;
      try {
        result = await callTool(stub, name, BAD_ARGS[name]);
      } catch (error) {
        problems.push(`${name}(badTypes): threw ${(error && error.message) || error}`);
        continue;
      }
      if (!result || typeof result !== 'object') problems.push(`${name}(badTypes): returned ${JSON.stringify(result)}`);
      else if (typeof result.ok !== 'boolean') problems.push(`${name}(badTypes): ok is ${typeof result.ok}`);
      else if (REQUIRED_ARGS[name] && result.ok !== false) {
        problems.push(`${name}(badTypes): expected ok:false for the wrong-typed required arg, got ok:true`);
      }
      try {
        JSON.stringify(result);
      } catch {
        problems.push(`${name}(badTypes): result is not JSON-serializable`);
      }
    }
    if (problems.length) throw new Error(problems.join('; '));
    return `${TOOL_NAMES.length} tools`;
  });

  await check('BAD.3', 'unknown ids/runIds/proposalIds return a coded error or the documented no-op result, never a throw', async () => {
    const problems = [];
    const cases = [
      ['rsi_act', { runId: 'run-19990101-000000-zzzz' }, /not-found|missing|unknown/],
      ['rsi_adopt', { proposalId: 'prop-19990101-000000-zzzz' }, /not-found|missing|unknown/],
      ['archive_update', { id: 'no-such-session', title: 'x' }, /not-found|missing|unknown/],
      ['archive_get', { id: 'no-such-session' }, /not-found|missing|unknown/],
    ];
    for (const [name, args, pattern] of cases) {
      let result;
      try {
        result = await callTool(stub, name, args);
      } catch (error) {
        problems.push(`${name}: threw ${(error && error.message) || error}`);
        continue;
      }
      if (!result || result.ok !== false) problems.push(`${name}: expected ok:false, got ${JSON.stringify(result).slice(0, 160)}`);
      else if (!result.error || !pattern.test(String(result.error.code))) problems.push(`${name}: error.code ${JSON.stringify(result.error && result.error.code)} does not match ${pattern}`);
    }
    // §7.3's archive_delete return shape is `{ok, removed, purged}`, so an
    // unknown id may legitimately be a no-op instead of a coded error.
    try {
      const deleted = await callTool(stub, 'archive_delete', { id: 'no-such-session' });
      if (!deleted || typeof deleted !== 'object') problems.push('archive_delete: returned no object');
      else if (deleted.ok === true) {
        if (deleted.removed !== false || deleted.purged !== false) problems.push(`archive_delete: ok:true must report removed:false/purged:false, got ${JSON.stringify(deleted)}`);
      } else if (deleted.ok === false) {
        if (!deleted.error || !/not-found|missing|unknown/.test(String(deleted.error.code))) problems.push(`archive_delete: error.code ${JSON.stringify(deleted.error && deleted.error.code)} is not not-found`);
      } else problems.push(`archive_delete: ok is ${JSON.stringify(deleted.ok)}`);
    } catch (error) {
      problems.push(`archive_delete: threw ${(error && error.message) || error}`);
    }
    if (problems.length) throw new Error(problems.join('; '));
    return `${cases.length + 1} unknown-id calls`;
  });
}

async function phaseRoutes() {
  console.log('\n# 11. web routes (DESIGN §7.3)');

  const real = await realSessionFiles();
  if (real.length < 2) {
    for (const id of ['WEB.1', 'WEB.2', 'WEB.3', 'WEB.4', 'WEB.5', 'WEB.6', 'WEB.7', 'WEB.8', 'WEB.9']) {
      printSkip(id, 'web route behaviour', 'need 2 real session files, found ' + real.length);
    }
    return;
  }

  const base = await makeBase('routes');
  const fixture = await copySessionFixture(base, real, 2);
  const stub = await applyPlugin({
    connection: { requestRejection() { return undefined; } },
    config: { rootDir: path.join(base, 'root'), sessionsDir: fixture.root, syncOnBoot: false },
  });
  const handler = stub.state.routes[0] && stub.state.routes[0].handler;
  if (!handler) {
    for (const id of ['WEB.1', 'WEB.2', 'WEB.3', 'WEB.4', 'WEB.5', 'WEB.6', 'WEB.7', 'WEB.8', 'WEB.9']) printFail(id, 'web route behaviour', 'no route handler registered');
    return;
  }

  let entryId = '';
  let pageId = '';
  let pageFull = '';
  await callTool(stub, 'archive_sync', { refresh: true });

  await check('WEB.1', 'GET /api/archive-rsi/overview returns 200 with {ok:true} when the connection allows it', async () => {
    const response = await httpCall(handler, { url: '/api/archive-rsi/overview' });
    assertEqual(response.status, 200, 'status');
    assert(response.json && response.json.ok === true, `body.ok: ${JSON.stringify(response.json).slice(0, 200)}`);
    assert(response.json.corpus && typeof response.json.corpus.sessions === 'number', 'body.corpus.sessions missing');
    return `sessions=${response.json.corpus.sessions}`;
  });

  await check('WEB.2', 'PATCH /api/archive-rsi/sessions/:id updates the entry with a JSON body', async () => {
    const listed = await callTool(stub, 'archive_list', {});
    assert(listed && listed.ok === true && Array.isArray(listed.entries) && listed.entries.length > 0, 'no synced entry to patch');
    entryId = listed.entries[0].id;
    const response = await httpCall(handler, {
      method: 'PATCH',
      url: `/api/archive-rsi/sessions/${encodeURIComponent(entryId)}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Patched by verifier', note: 'route note', tags: ['route'], status: 'pinned' }),
    });
    assertEqual(response.status, 200, `status (body ${JSON.stringify(response.json).slice(0, 200)})`);
    assert(response.json && response.json.ok === true, `body.ok: ${JSON.stringify(response.json).slice(0, 200)}`);
    const fetched = await callTool(stub, 'archive_get', { id: entryId });
    assert(fetched && fetched.ok === true && fetched.entry, 'archive_get after PATCH failed');
    const mismatches = [];
    if (fetched.entry.title !== 'Patched by verifier') mismatches.push(`title: ${JSON.stringify(fetched.entry.title)}`);
    if (fetched.entry.note !== 'route note') mismatches.push(`note: ${JSON.stringify(fetched.entry.note)}`);
    // §10.1: the plugin-owned auto half stays visible after a manual PATCH.
    const manual = manualTags(fetched.entry);
    if (JSON.stringify(manual) !== JSON.stringify(['route'])) {
      mismatches.push(`manual tags: expected ["route"], got ${JSON.stringify(fetched.entry.tags)} (manual ${JSON.stringify(manual)})`);
    }
    if (JSON.stringify(fetched.entry.tags) !== JSON.stringify([...manual, ...(fetched.entry.autoTags || [])])) {
      mismatches.push(`tags: expected manual ∪ auto, got ${JSON.stringify(fetched.entry.tags)}`);
    }
    if (fetched.entry.status !== 'pinned') mismatches.push(`status: ${JSON.stringify(fetched.entry.status)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return entryId;
  });

  await check('WEB.3', 'POST /api/archive-rsi/sync returns the sync counts', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/archive-rsi/sync',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh: true }),
    });
    assertEqual(response.status, 200, `status (body ${JSON.stringify(response.json).slice(0, 200)})`);
    assert(response.json && response.json.ok === true, 'body.ok is not true');
    const mismatches = [];
    for (const key of ['scanned', 'imported', 'refreshed', 'skipped']) {
      if (typeof response.json[key] !== 'number') mismatches.push(`${key}: expected a number, got ${JSON.stringify(response.json[key])}`);
    }
    if (!Array.isArray(response.json.failed)) mismatches.push('failed: expected an array');
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `scanned=${response.json.scanned} imported=${response.json.imported}`;
  });

  await check('WEB.4', 'an unknown path under the prefix returns 404', async () => {
    const response = await httpCall(handler, { url: '/api/archive-rsi/definitely-not-a-route' });
    assertEqual(response.status, 404, 'status');
    assert(response.json && response.json.ok === false, 'body.ok should be false');
    return '404';
  });

  await check('WEB.5', 'a 401 rejection from ctx.connection.requestRejection yields 401', async () => {
    stub.ref.value = { requestRejection() { return 401; } };
    const response = await httpCall(handler, { url: '/api/archive-rsi/overview' });
    assertEqual(response.status, 401, 'status');
    stub.ref.value = { requestRejection() { return undefined; } };
    return '401';
  });

  await check('WEB.6', 'a missing connection service yields 503', async () => {
    stub.ref.value = undefined;
    const response = await httpCall(handler, { url: '/api/archive-rsi/overview' });
    assertEqual(response.status, 503, 'status');
    assert(response.json && response.json.ok === false, 'body.ok should be false');
    stub.ref.value = { requestRejection() { return undefined; } };
    return '503';
  });

  await check('WEB.7', 'POST /api/archive-rsi/autotag with {dryRun:true} returns {ok:true} and a numeric updated', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/archive-rsi/autotag',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    assertEqual(response.status, 200, `status (body ${JSON.stringify(response.json).slice(0, 200)})`);
    assert(response.json && response.json.ok === true, `body.ok: ${JSON.stringify(response.json).slice(0, 200)}`);
    assertNumber(response.json.updated, 'body.updated');
    if (!(response.json.updated >= 1)) throw new Error(`body.updated: expected >= 1, got ${JSON.stringify(response.json.updated)}`);
    return `updated=${response.json.updated}`;
  });

  await check('WEB.8', 'POST /api/archive-rsi/runs returns a checked run and journals run.do/run.check', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/archive-rsi/runs',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 0, limit: 5 }),
    });
    assertEqual(response.status, 200, `status (body ${JSON.stringify(response.json).slice(0, 200)})`);
    assert(response.json && response.json.ok === true, `body.ok: ${JSON.stringify(response.json).slice(0, 200)}`);
    const run = response.json.run;
    assert(run && typeof run.id === 'string', 'run.id missing');
    assertEqual(run.status, 'checked', 'run.status');
    const journalText = await readText(path.join(base, 'root', 'journal.jsonl'));
    if (!journalText) throw new Error('journal.jsonl is missing after POST /runs');
    const actions = journalText.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line).action; } catch { return ''; } });
    if (!actions.includes('run.do')) throw new Error(`journal has no run.do action (actions: ${JSON.stringify(actions)})`);
    if (!actions.includes('run.check')) throw new Error(`journal has no run.check action (actions: ${JSON.stringify(actions)})`);
    return `${run.id} status=${run.status}; journal actions ${[...new Set(actions)].join('/')}`;
  });

  await check('WEB.9', 'GET /overview lastRun is a summary and autoRun is complete', async () => {
    const response = await httpCall(handler, { url: '/api/archive-rsi/overview' });
    assertEqual(response.status, 200, 'status');
    const body = response.json;
    assert(body && body.ok === true, `body.ok: ${JSON.stringify(body).slice(0, 200)}`);
    const mismatches = [];
    if (!body.lastRun || typeof body.lastRun !== 'object') mismatches.push('lastRun: expected a summary object');
    else {
      for (const key of ['status', 'targets', 'durationMs', 'running', 'stalled']) {
        if (!Object.hasOwn(body.lastRun, key)) mismatches.push(`lastRun.${key}: missing`);
      }
      if (body.lastRun.check !== undefined || body.lastRun.do !== undefined || body.lastRun.plan !== undefined) {
        mismatches.push('lastRun must be a summary, not the full run (check/do/plan leaked)');
      }
      if (!body.lastRun.targets || typeof body.lastRun.targets.total !== 'number') mismatches.push('lastRun.targets.total: expected a number');
      if (typeof body.lastRun.running !== 'boolean' || typeof body.lastRun.stalled !== 'boolean') mismatches.push('lastRun.running/stalled: expected booleans');
    }
    if (!body.autoRun || typeof body.autoRun !== 'object') mismatches.push('autoRun: expected an object');
    else {
      for (const key of ['enabled', 'everyDays', 'dueAt', 'due']) {
        if (!Object.hasOwn(body.autoRun, key)) mismatches.push(`autoRun.${key}: missing`);
      }
      if (typeof body.autoRun.enabled !== 'boolean' || typeof body.autoRun.due !== 'boolean') mismatches.push('autoRun.enabled/due: expected booleans');
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `lastRun status=${body.lastRun.status} targets=${body.lastRun.targets.total} autoRun.enabled=${body.autoRun.enabled}`;
  });

  await check('WEB.10', 'a crashed running marker is retired to failed and loses the baseline race', async () => {
    const runsDir = path.join(base, 'root', 'runs');
    const names = await fs.readdir(runsDir).catch(() => []);
    const finished = [];
    for (const name of names) {
      const run = await readJson(path.join(runsDir, name)).catch(() => null);
      if (run && (run.status === 'checked' || run.status === 'closed')) finished.push(run);
    }
    if (finished.length === 0) throw new Error('prerequisite: no finished run from WEB.8 to use as a baseline');
    const newest = finished.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    const zombieId = 'run-20200101-000000-zzzz';
    const zombie = {
      id: zombieId,
      createdAt: Date.now() + 60_000,
      updatedAt: Date.now() - 3_600_000,
      phase: 'plan',
      status: 'running',
      startedAt: Date.now() - 3_600_000,
      finishedAt: null,
      cohort: {},
      plan: { baselineRunId: null, targets: [], hypotheses: [] },
      do: { sessionIds: [], analyzedAt: null, coverage: { requested: 0, analyzed: 0, skipped: 0, failures: [] } },
      check: { metrics: {}, perSession: [], verdicts: [], deltas: [] },
      act: { findings: [], proposalIds: [] },
    };
    await fs.writeFile(path.join(runsDir, `${zombieId}.json`), `${JSON.stringify(zombie, null, 2)}\n`);

    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/archive-rsi/runs',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 0, limit: 3 }),
    });
    assertEqual(response.status, 200, `status (body ${JSON.stringify(response.json).slice(0, 200)})`);
    const retired = await readJson(path.join(runsDir, `${zombieId}.json`));
    if (retired.status !== 'failed') throw new Error(`crashed marker status: expected failed, got ${JSON.stringify(retired.status)}`);
    if (!Number.isFinite(retired.finishedAt)) throw new Error(`crashed marker finishedAt: expected a number, got ${JSON.stringify(retired.finishedAt)}`);
    const baselineRunId = response.json.run && response.json.run.plan && response.json.run.plan.baselineRunId;
    if (baselineRunId !== newest.id) {
      throw new Error(`baselineRunId: expected the newest finished run ${JSON.stringify(newest.id)}, got ${JSON.stringify(baselineRunId)}`);
    }
    return `crashed ${zombieId} -> failed; baseline=${baselineRunId}`;
  });

  await check('WEB.11', 'POST /runs/:id/act persists proposals that the list route then returns in full', async () => {
    const runsDir = path.join(base, 'root', 'runs');
    const now = Date.now();
    const runId = 'run-20260101-000001-actt';
    const synthetic = {
      id: runId,
      createdAt: now - 60_000,
      updatedAt: now - 50_000,
      startedAt: now - 60_000,
      finishedAt: now - 50_000,
      phase: 'act',
      status: 'checked',
      cohort: { days: 0, limit: 5, workspace: null, tag: null, status: 'all' },
      plan: { baselineRunId: null, targets: [{ metric: 'toolErrorRate', op: '<=', value: 0.05 }], hypotheses: [] },
      do: { sessionIds: ['session-route-1'], analyzedAt: now - 55_000, coverage: { requested: 1, analyzed: 1, skipped: 0, failures: [] } },
      check: {
        metrics: { sessions: 1, toolCalls: 10, toolErrors: 4 },
        perSession: [],
        verdicts: [{ metric: 'toolErrorRate', op: '<=', target: 0.05, actual: 0.4, verdict: 'fail' }],
        deltas: [],
      },
      act: {
        findings: [{
          id: 'f-R1-1', rule: 'R1', severity: 'high', title: 'Tool "edit" fails 40.0% of calls',
          detail: '4 of 10 calls to edit failed (40.0%).',
          metric: 'toolErrorRate', evidence: [{ sessionId: 'session-route-1', seq: 12 }],
          tool: 'edit', count: 4, advice: 'Rewrite the edit tool description.',
        }, {
          id: 'f-R4-1', rule: 'R4', severity: 'high', title: 'No verification after the last edit (75.0%)',
          detail: '3 of 4 sessions with edits ran no check command after the final edit.',
          metric: 'verificationGapRate', evidence: [{ sessionId: 'session-route-1', seq: 20 }],
          tool: null, count: 3, advice: 'After the last edit, run one check command.',
        }],
        proposalIds: [],
      },
    };
    await fs.writeFile(path.join(runsDir, `${runId}.json`), `${JSON.stringify(synthetic, null, 2)}\n`);

    const acted = await httpCall(handler, {
      method: 'POST',
      url: `/api/archive-rsi/runs/${encodeURIComponent(runId)}/act`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assertEqual(acted.status, 200, `act status (body ${JSON.stringify(acted.json).slice(0, 200)})`);
    const created = acted.json && Array.isArray(acted.json.proposals) ? acted.json.proposals : [];
    if (created.length < 2) throw new Error(`act returned ${created.length} proposals for a run with two findings; the list check below needs more than one`);

    // No `limit` in the URL: an absent query parameter must mean "the default",
    // not "one row". This is the regression that hid generated proposals.
    const all = await httpCall(handler, { url: '/api/archive-rsi/proposals?status=proposed' });
    assertEqual(all.status, 200, 'proposals status');
    const listed = all.json && Array.isArray(all.json.proposals) ? all.json.proposals : [];
    if (listed.length < created.length) {
      throw new Error(`GET /proposals without limit returned ${listed.length} of ${created.length} generated proposals`);
    }
    const ids = new Set(listed.map((item) => item.id));
    const missing = created.filter((item) => !ids.has(item.id)).map((item) => item.id);
    if (missing.length) throw new Error(`list route is missing proposed ids: ${missing.slice(0, 3).join(', ')}`);

    const stored = await readJson(path.join(runsDir, `${runId}.json`));
    if (stored.status !== 'closed') throw new Error(`run status after act: expected closed, got ${JSON.stringify(stored.status)}`);
    if (!Array.isArray(stored.act && stored.act.proposalIds) || stored.act.proposalIds.length !== created.length) {
      throw new Error(`run.act.proposalIds: expected ${created.length}, got ${JSON.stringify(stored.act && stored.act.proposalIds)}`);
    }
    return `${created.length} proposals generated, all ${listed.length} listed; no-limit default honoured`;
  });

  await check('WEB.12', 'GET /sessions/:id?transcript=1 is not capped to a single character by an absent maxChars', async () => {
    const listing = await httpCall(handler, { url: '/api/archive-rsi/sessions?limit=1' });
    assertEqual(listing.status, 200, 'sessions status');
    const entry = listing.json && Array.isArray(listing.json.entries) ? listing.json.entries[0] : null;
    assert(entry && typeof entry.id === 'string', 'no session to inspect');
    const detail = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(entry.id)}?transcript=1` });
    assertEqual(detail.status, 200, 'session detail status');
    const transcript = detail.json && typeof detail.json.transcript === 'string' ? detail.json.transcript : '';
    if (transcript.length <= 1) {
      throw new Error(`transcript length ${transcript.length}: an absent maxChars must fall back to the default cap, not 1`);
    }
    return `transcript ${transcript.length} chars (default cap honoured)`;
  });

  await check('WEB.13', 'acting on two runs with the same finding reuses one proposal instead of duplicating it', async () => {
    const runsDir = path.join(base, 'root', 'runs');
    const proposalsDir = path.join(base, 'root', 'proposals');
    const stamp = Date.now();
    const build = (id, at) => ({
      id, createdAt: at, updatedAt: at + 10, startedAt: at, finishedAt: at + 10,
      phase: 'act', status: 'checked',
      cohort: { days: 0, limit: 5, workspace: null, tag: null, status: 'all' },
      plan: { baselineRunId: null, targets: [{ metric: 'toolErrorRate', op: '<=', value: 0.05 }], hypotheses: [] },
      do: { sessionIds: ['session-dedupe'], analyzedAt: at, coverage: { requested: 1, analyzed: 1, skipped: 0, failures: [] } },
      check: { metrics: { sessions: 1 }, perSession: [], verdicts: [], deltas: [] },
      act: {
        findings: [{
          id: 'f-R1-1', rule: 'R1', severity: 'high', title: 'Tool "edit" fails 40.0% of calls',
          detail: '4 of 10 calls to edit failed (40.0%).', metric: 'toolErrorRate',
          evidence: [], tool: 'edit', count: 4, advice: 'Rewrite the edit tool description.',
        }],
        proposalIds: [],
      },
    });
    const idA = 'run-20260102-000001-ddup';
    const idB = 'run-20260102-000002-ddup';
    await fs.writeFile(path.join(runsDir, `${idA}.json`), `${JSON.stringify(build(idA, stamp - 5000), null, 2)}\n`);
    await fs.writeFile(path.join(runsDir, `${idB}.json`), `${JSON.stringify(build(idB, stamp - 4000), null, 2)}\n`);

    const act = async (id) => httpCall(handler, {
      method: 'POST',
      url: `/api/archive-rsi/runs/${encodeURIComponent(id)}/act`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const first = await act(idA);
    assertEqual(first.status, 200, `first act status (${JSON.stringify(first.json).slice(0, 160)})`);
    const createdIds = (first.json.proposals || []).map((item) => item.id);
    if (createdIds.length === 0) throw new Error('first act created no proposal');
    const filesAfterFirst = (await fs.readdir(proposalsDir)).filter((name) => name.endsWith('.json')).length;

    const second = await act(idB);
    assertEqual(second.status, 200, `second act status (${JSON.stringify(second.json).slice(0, 160)})`);
    if (Number(second.json.created) !== 0) throw new Error(`second run should create 0 proposals, got ${second.json.created}`);
    if (Number(second.json.reused) < 1) throw new Error(`second run should reuse >= 1 proposal, got ${second.json.reused}`);
    const filesAfterSecond = (await fs.readdir(proposalsDir)).filter((name) => name.endsWith('.json')).length;
    if (filesAfterSecond !== filesAfterFirst) {
      throw new Error(`proposal files grew from ${filesAfterFirst} to ${filesAfterSecond}: dedupe failed`);
    }

    // Same run twice: the second call must be a no-op, not another copy.
    const third = await act(idA);
    assertEqual(third.status, 200, 'repeat act status');
    if (Number(third.json.created) !== 0) throw new Error(`repeat act created ${third.json.created} proposals`);
    const filesAfterThird = (await fs.readdir(proposalsDir)).filter((name) => name.endsWith('.json')).length;
    if (filesAfterThird !== filesAfterFirst) throw new Error(`repeat act added files: ${filesAfterFirst} -> ${filesAfterThird}`);

    const storedB = await readJson(path.join(runsDir, `${idB}.json`));
    const idsB = Array.isArray(storedB.act && storedB.act.proposalIds) ? storedB.act.proposalIds : [];
    if (idsB.length !== 1 || !createdIds.includes(idsB[0])) {
      throw new Error(`run B proposalIds should reference the reused proposal, got ${JSON.stringify(idsB)}`);
    }
    return `run A created ${createdIds.length}, run B reused ${second.json.reused}, files stayed ${filesAfterFirst}`;
  });

  await check('WEB.14', 'GET /sessions/:id?transcript=1 paginates: offset slices concatenate to the original and transcriptTotal equals the full length', async () => {
    const listing = await httpCall(handler, { url: '/api/archive-rsi/sessions?limit=1' });
    assertEqual(listing.status, 200, 'sessions status');
    const entry = listing.json && Array.isArray(listing.json.entries) ? listing.json.entries[0] : null;
    assert(entry && typeof entry.id === 'string', 'no session to inspect');
    pageId = entry.id;
    const mdPath = path.join(base, 'root', 'sessions', `${pageId}.md`);
    pageFull = await readText(mdPath);
    if (!pageFull || pageFull.length <= 2000) {
      throw new Error(`fixture transcript too short for pagination: ${pageFull ? pageFull.length : 0} chars`);
    }
    const p1 = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(pageId)}?transcript=1&maxChars=1000&offset=0` });
    const p2 = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(pageId)}?transcript=1&maxChars=1000&offset=1000` });
    assertEqual(p1.status, 200, 'first page status');
    assertEqual(p2.status, 200, 'second page status');
    const mismatches = [];
    if (p1.json.transcriptOffset !== 0) mismatches.push(`first transcriptOffset: expected 0, got ${JSON.stringify(p1.json.transcriptOffset)}`);
    if (p2.json.transcriptOffset !== 1000) mismatches.push(`second transcriptOffset: expected 1000, got ${JSON.stringify(p2.json.transcriptOffset)}`);
    if (p1.json.transcript !== pageFull.slice(0, 1000)) mismatches.push('first slice is not the original [0,1000) fragment');
    const joined = (p1.json.transcript || '') + (p2.json.transcript || '');
    if (joined !== pageFull.slice(0, 2000)) mismatches.push('concatenated slices are not the original [0,2000) fragment');
    if (p1.json.transcriptTotal !== pageFull.length) {
      mismatches.push(`transcriptTotal: expected ${pageFull.length}, got ${JSON.stringify(p1.json.transcriptTotal)}`);
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `total=${p1.json.transcriptTotal}, slices ${p1.json.transcript.length}+${p2.json.transcript.length}`;
  });

  await check('WEB.15', 'transcriptTruncated is true mid-stream and false when the final slice reaches the end', async () => {
    assert(pageId && pageFull, 'prerequisite: WEB.14 failed');
    const total = pageFull.length;
    const first = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(pageId)}?transcript=1&maxChars=1000&offset=0` });
    assertEqual(first.status, 200, 'first status');
    if (first.json.transcriptTruncated !== true) {
      throw new Error(`first slice (offset=0): expected transcriptTruncated=true, got ${JSON.stringify(first.json.transcriptTruncated)}`);
    }
    const tailOffset = total - 100;
    const tail = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(pageId)}?transcript=1&maxChars=1000&offset=${tailOffset}` });
    assertEqual(tail.status, 200, 'tail status');
    if (tail.json.transcript.length !== 100) throw new Error(`tail slice: expected 100 chars, got ${tail.json.transcript.length}`);
    if (tail.json.transcript !== pageFull.slice(tailOffset)) throw new Error('tail slice does not match the original tail');
    if (tail.json.transcriptTruncated !== false) {
      throw new Error(`tail slice: expected transcriptTruncated=false, got ${JSON.stringify(tail.json.transcriptTruncated)}`);
    }
    return `first.truncated=true, tail(offset=${tailOffset}).truncated=false`;
  });

  await check('WEB.16', 'offset beyond the total clamps to total: empty transcript, no error, transcriptTruncated=false', async () => {
    assert(pageId && pageFull, 'prerequisite: WEB.14 failed');
    const total = pageFull.length;
    const response = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(pageId)}?transcript=1&maxChars=1000&offset=${total + 500}` });
    assertEqual(response.status, 200, 'status');
    const mismatches = [];
    if (response.json.transcript !== '') mismatches.push(`transcript: expected "", got ${JSON.stringify(response.json.transcript).slice(0, 80)}`);
    if (response.json.transcriptOffset !== total) mismatches.push(`transcriptOffset: expected ${total}, got ${JSON.stringify(response.json.transcriptOffset)}`);
    if (response.json.transcriptTruncated !== false) mismatches.push(`transcriptTruncated: expected false, got ${JSON.stringify(response.json.transcriptTruncated)}`);
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `offset=${total + 500} -> empty slice, transcriptOffset=${response.json.transcriptOffset}`;
  });

  await check('WEB.17', 'deleting a session transcript cache re-renders it on demand and rewrites the file', async () => {
    const listing = await httpCall(handler, { url: '/api/archive-rsi/sessions?limit=1' });
    assertEqual(listing.status, 200, 'sessions status');
    const entry = listing.json && Array.isArray(listing.json.entries) ? listing.json.entries[0] : null;
    assert(entry && typeof entry.id === 'string', 'no session to inspect');
    const id = entry.id;
    const mdPath = path.join(base, 'root', 'sessions', `${id}.md`);
    await fs.rm(mdPath, { force: true });
    if (await exists(mdPath)) throw new Error('failed to delete the transcript cache');
    const response = await httpCall(handler, { url: `/api/archive-rsi/sessions/${encodeURIComponent(id)}?transcript=1` });
    assertEqual(response.status, 200, 'status');
    if (!(typeof response.json.transcript === 'string' && response.json.transcript.length > 0)) {
      throw new Error(`transcript is empty after cache deletion (got ${JSON.stringify(response.json.transcript === null ? 'null' : response.json.transcript && response.json.transcript.length)})`);
    }
    if (!(await exists(mdPath))) throw new Error('transcript cache was not re-written after on-demand render');
    const rewritten = await readText(mdPath);
    if (!rewritten || rewritten.length === 0) throw new Error('rewritten cache is empty');
    if (rewritten.length !== response.json.transcriptTotal) {
      throw new Error(`rewritten length ${rewritten.length} != transcriptTotal ${JSON.stringify(response.json.transcriptTotal)}`);
    }
    const returned = response.json.transcript;
    if (returned !== rewritten.slice(0, returned.length)) {
      throw new Error('returned transcript is not the prefix of the rewritten cache');
    }
    return `${id}: cache re-rendered (${rewritten.length} chars)`;
  });
}

async function phaseE2E() {
  console.log('\n# 12. real-corpus end-to-end, read-only (DESIGN §9.3)');

  const real = await realSessionFiles();
  if (real.length === 0) {
    for (const id of ['E2E.1', 'E2E.2', 'E2E.3', 'E2E.4', 'E2E.5']) printSkip(id, 'real-corpus end-to-end', 'no real sessions found');
    return;
  }

  const base = await makeBase('e2e');
  const root = path.join(base, 'root');
  const workspaceFile = path.join(homedir(), '.dsh', 'storages', 'workspace.json');
  const workspaceBefore = await fileState(workspaceFile);
  const stub = await applyPlugin({
    connection: { requestRejection() { return undefined; } },
    // Only §8 config keys here: `autoRunEveryDays` is not in DESIGN §8, so using
    // it to suppress a boot sync would silently excuse the deviation this check
    // is meant to expose.
    config: {
      rootDir: root,
      sessionsDir: path.join(homedir(), '.dsh', 'sessions'),
      syncOnBoot: false,
    },
  });
  // Let any debounced boot work settle first: this transaction must measure what
  // `archive_sync` itself does, not a race with the boot path.
  const bootEntries = await waitForStableEntryCount(root);

  let synced = 0;
  await check('E2E.1', 'archive_sync over the real corpus imports at least 30 sessions', async () => {
    const result = await callTool(stub, 'archive_sync', { refresh: true });
    assert(result && result.ok === true, `archive_sync failed: ${JSON.stringify(result && result.error)}`);
    synced = result.imported;
    if (!(result.imported >= 30)) {
      throw new Error(
        `imported: expected >= 30, got ${JSON.stringify(result.imported)} (scanned ${result.scanned}, refreshed ${result.refreshed}, skipped ${result.skipped}; `
        + `the index already held ${bootEntries} entries before the call, so a boot-time path imported the corpus first)`,
      );
    }
    return `scanned=${result.scanned} imported=${result.imported} skipped=${result.skipped}`;
  });

  await check('E2E.1b', 'the real corpus is indexed with >= 30 SessionFacts records', async () => {
    const index = await readJson(path.join(root, 'archive.json'));
    const ids = Object.keys(index.entries || {});
    if (ids.length < 30) throw new Error(`index entries: expected >= 30, got ${ids.length}`);
    const derived = (await fs.readdir(path.join(root, 'sessions')).catch(() => [])).filter((name) => name.endsWith('.json'));
    if (derived.length < 30) throw new Error(`sessions/<id>.json facts files: expected >= 30, got ${derived.length}`);
    return `${ids.length} entries, ${derived.length} facts files`;
  });

  let runId = '';
  await check('E2E.2', 'rsi_run({days:0, limit:10}) persists a run', async () => {
    const result = await callTool(stub, 'rsi_run', { days: 0, limit: 10 });
    assert(result && result.ok === true, `rsi_run failed: ${JSON.stringify(result && result.error)}`);
    assert(result.run && typeof result.run.id === 'string', 'run.id missing');
    runId = result.run.id;
    const file = path.join(root, 'runs', `${runId}.json`);
    if (!(await exists(file))) throw new Error(`run was not persisted to ${file}`);
    const stored = await readJson(file);
    assertEqual(stored.id, runId, 'persisted run id');
    assertArray(stored.check && stored.check.verdicts, 'persisted check.verdicts');
    assertEqual(stored.status, 'checked', 'persisted run status');
    assertNumber(stored.finishedAt, 'persisted run finishedAt');
    return `${runId} (cohort ${result.run.cohort && result.run.cohort.source}, sessions ${result.run.check && result.run.check.metrics && result.run.check.metrics.sessions})`;
  });

  await check('E2E.3', 'rsi_act yields at least one proposal and writes it under the temp root', async () => {
    assert(runId, 'prerequisite: E2E.2 failed');
    const result = await callTool(stub, 'rsi_act', { runId });
    assert(result && result.ok === true, `rsi_act failed: ${JSON.stringify(result && result.error)}`);
    assertArray(result.proposals, 'proposals');
    if (result.proposals.length < 1) throw new Error('rsi_act returned no proposals');
    const first = result.proposals[0];
    const file = path.join(root, 'proposals', `${first.id}.json`);
    if (!(await exists(file))) throw new Error(`proposal was not persisted to ${file}`);
    return `${result.proposals.length} proposals (${[...new Set(result.proposals.map((proposal) => proposal.kind))].join('/')})`;
  });

  await check('E2E.4', 'archive_list({archived:true}) returns only entries with harnessArchived === true', async () => {
    const result = await callTool(stub, 'archive_list', { archived: true, limit: 200 });
    assert(result && result.ok === true, `archive_list failed: ${JSON.stringify(result && result.error)}`);
    assertArray(result.entries, 'entries');
    const violations = result.entries.filter((entry) => entry.harnessArchived !== true);
    if (violations.length) throw new Error(`${violations.length} entr(ies) do not carry harnessArchived === true, e.g. ${JSON.stringify(violations[0].id)}`);
    const after = await fileState(workspaceFile);
    if (!sameSha(after, workspaceBefore)) throw new Error('~/.dsh/storages/workspace.json changed during the read-only smoke');
    return `${result.entries.length} archived entries of ${synced} imported`;
  });

  await check('E2E.5', 'rsi_status reports the run status summary and the autoRun schedule', async () => {
    const result = await callTool(stub, 'rsi_status', {});
    assert(result && result.ok === true, `rsi_status failed: ${JSON.stringify(result && result.error)}`);
    const mismatches = [];
    if (!result.status || typeof result.status !== 'object') mismatches.push('status: expected an object');
    else {
      if (typeof result.status.running !== 'boolean') mismatches.push('status.running: expected a boolean');
      if (!result.status.lastRun || typeof result.status.lastRun !== 'object') mismatches.push('status.lastRun: expected a summary object');
      if (!result.status.autoRun || typeof result.status.autoRun !== 'object') mismatches.push('status.autoRun: expected an object');
      else if (typeof result.status.autoRun.enabled !== 'boolean') mismatches.push('status.autoRun.enabled: expected a boolean');
    }
    if (mismatches.length) throw new Error(mismatches.join('; '));
    return `running=${result.status.running} lastRun.status=${result.status.lastRun && result.status.lastRun.status}`;
  });
}

// ======================================================================== main

async function phaseTranscriptContract() {
  console.log('\n# 13. transcript contract (block cap + maxChars clamp)');

  await check('TXT.1', 'an assistant text of 6000 chars survives renderTranscript intact (no 4000-char hard cut)', () => {
    const longText = 'x'.repeat(6000);
    const t0 = 1_700_000_000_000;
    const header = { type: 'session', version: 4, id: 'long-assistant', createdAt: t0, cwd: '/tmp', origin: 'user', isSeeded: false };
    const events = [
      { type: 'turn/start', seq: 1, time: t0 + 1000, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: t0 + 1100, data: { content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } },
      { type: 'assistant/message', seq: 3, time: t0 + 1200, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: longText }] }, stream: false } },
      { type: 'turn/end', seq: 4, time: t0 + 1300, data: { turn: 1, reason: { kind: 'completed' } } },
    ];
    const facts = computeFacts({ header, events, file: '/tmp/x/session.v4.jsonl.zstd', slug: 'x' });
    const rendered = renderTranscript(facts, events, { maxBytes: 1_000_000 });
    if (!rendered.includes(longText)) {
      throw new Error('the 6000-char assistant text was cut from the transcript (block cap still active?)');
    }
    return `6000-char assistant text fully present (rendered ${rendered.length} chars)`;
  });

  await check('TXT.2', 'maxChars is clamped to [1000, 400000]', async () => {
    const base = await makeBase('clamp');
    const root = path.join(base, 'root');
    const sessionsRoot = path.join(base, 'sessions');
    const t0 = 1_700_000_000_000;
    const header = { type: 'session', version: 4, id: 'clamp-fixture', createdAt: t0, cwd: '/tmp', origin: 'user', isSeeded: false };
    const events = [{ type: 'turn/start', seq: 1, time: t0 + 1000, data: { turn: 1 } }];
    const longText = 'y'.repeat(12000);
    // 40 blocks * 12002 chars ≈ 480k chars: above the old 200k ceiling and above
    // the new 400k ceiling, so both ends of the clamp are observable.
    for (let index = 0; index < 40; index += 1) {
      events.push({
        type: 'assistant/message',
        seq: 2 + index,
        time: t0 + 2000 + index,
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: longText }] }, stream: false },
      });
    }
    events.push({ type: 'turn/end', seq: 999, time: t0 + 99000, data: { turn: 1, reason: { kind: 'completed' } } });
    await writeSessionFixture(sessionsRoot, 'clamp-slug', { header, events });
    const stub = await applyPlugin({
      connection: { requestRejection() { return undefined; } },
      config: { rootDir: root, sessionsDir: sessionsRoot, syncOnBoot: false, maxTranscriptBytes: 1048576 },
    });
    const handler = stub.state.routes[0] && stub.state.routes[0].handler;
    if (!handler) throw new Error('no route handler registered');
    await callTool(stub, 'archive_sync', { refresh: true });

    // Floor: maxChars=10 must rise to 1000, not stay at 10.
    const small = await httpCall(handler, { url: '/api/archive-rsi/sessions/clamp-fixture?transcript=1&maxChars=10' });
    assertEqual(small.status, 200, 'maxChars=10 status');
    if (small.json.transcript.length !== 1000) {
      throw new Error(`maxChars=10: expected 1000 chars, got ${small.json.transcript.length}`);
    }
    if (small.json.transcriptTruncated !== true) {
      throw new Error(`maxChars=10: expected transcriptTruncated=true, got ${JSON.stringify(small.json.transcriptTruncated)}`);
    }

    // Ceiling: a ~480k-char transcript must be cut at 400k, not 200k.
    const big = await httpCall(handler, { url: '/api/archive-rsi/sessions/clamp-fixture?transcript=1&maxChars=999999' });
    assertEqual(big.status, 200, 'maxChars=999999 status');
    const total = big.json.transcriptTotal;
    if (!(total > 400000)) throw new Error(`fixture transcript too short (${total}): cannot observe the 400000 ceiling`);
    if (big.json.transcript.length !== 400000) {
      throw new Error(`maxChars=999999: expected exactly 400000 chars, got ${big.json.transcript.length}`);
    }
    if (big.json.transcriptTruncated !== true) {
      throw new Error(`maxChars=999999: expected transcriptTruncated=true, got ${JSON.stringify(big.json.transcriptTruncated)}`);
    }
    if (big.json.transcriptOffset !== 0) throw new Error(`maxChars=999999: expected transcriptOffset=0, got ${JSON.stringify(big.json.transcriptOffset)}`);
    return `maxChars=10 -> 1000; maxChars=999999 -> 400000 of ${total}`;
  });

  // The model-facing `archive_get` must page exactly like the panel route: a
  // 1 MiB transcript cannot be read through a single 200k slice, and a slice
  // that silently stops early looks like the end of the conversation.
  await check('TXT.3', 'archive_get pages the transcript by offset and reports transcriptOffset/Total/Truncated', async () => {
    const base = await makeBase('tool-page');
    const root = path.join(base, 'root');
    const sessionsRoot = path.join(base, 'sessions');
    const t0 = 1_700_000_000_000;
    const header = { type: 'session', version: 4, id: 'page-fixture', createdAt: t0, cwd: '/tmp', origin: 'user', isSeeded: false };
    const events = [{ type: 'turn/start', seq: 1, time: t0 + 1000, data: { turn: 1 } }];
    // 4 blocks x ~4000 chars => total well above the 12000 default, so the
    // default page is observably shorter than the transcript.
    for (let index = 0; index < 4; index += 1) {
      events.push({
        type: 'assistant/message',
        seq: 2 + index,
        time: t0 + 2000 + index,
        data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: `BLOCK${index}:` + 'q'.repeat(3993) }] }, stream: false },
      });
    }
    events.push({ type: 'turn/end', seq: 99, time: t0 + 9000, data: { turn: 1, reason: { kind: 'completed' } } });
    await writeSessionFixture(sessionsRoot, 'page-slug', { header, events });
    const stub = await applyPlugin({
      connection: { requestRejection() { return undefined; } },
      config: { rootDir: root, sessionsDir: sessionsRoot, syncOnBoot: false, maxTranscriptBytes: 1048576 },
    });
    await callTool(stub, 'archive_sync', { refresh: true });

    const full = await callTool(stub, 'archive_get', { id: 'page-fixture', transcript: true, maxChars: 400000 });
    assert(full && full.ok === true, `archive_get failed: ${JSON.stringify(full).slice(0, 200)}`);
    assert(typeof full.transcript === 'string' && full.transcript.length > 16_000, `transcript too short: ${full.transcript && full.transcript.length}`);
    assertEqual(full.transcriptTruncated, false, 'full read transcriptTruncated');
    assertEqual(full.transcriptTotal, full.transcript.length, 'transcriptTotal');
    assertEqual(full.transcriptOffset, 0, 'transcriptOffset of the first page');

    const total = full.transcriptTotal;
    const a = await callTool(stub, 'archive_get', { id: 'page-fixture', transcript: true, maxChars: 2000, offset: 0 });
    const b = await callTool(stub, 'archive_get', { id: 'page-fixture', transcript: true, maxChars: 2000, offset: 2000 });
    assertEqual(a.transcript.length, 2000, 'first page length');
    assertEqual(b.transcriptOffset, 2000, 'second page offset');
    assertEqual(a.transcript + b.transcript, full.transcript.slice(0, 4000), 'two pages concatenated');
    assertEqual(a.transcriptTruncated, true, 'first page transcriptTruncated');

    // Default page size stays 12000 for the tool, and the floor still clamps.
    const dflt = await callTool(stub, 'archive_get', { id: 'page-fixture', transcript: true });
    assertEqual(dflt.transcript.length, 12_000, 'default maxChars');
    assertEqual(dflt.transcriptTruncated, true, 'default page transcriptTruncated');
    const floored = await callTool(stub, 'archive_get', { id: 'page-fixture', transcript: true, maxChars: 10 });
    assertEqual(floored.transcript.length, 1000, 'maxChars floor');

    // Reading past the end is an empty page, not an error or a silent restart.
    const past = await callTool(stub, 'archive_get', { id: 'page-fixture', transcript: true, maxChars: 1000, offset: total + 5000 });
    assertEqual(past.transcript, '', 'slice past the end');
    assertEqual(past.transcriptOffset, total, 'offset clamped to total');
    assertEqual(past.transcriptTruncated, false, 'truncated past the end');

    return `total=${total}; 2x2000 pages reassemble; default 12000; floor 1000; past-end empty`;
  });
}

async function main() {
  console.log('dsh-archive-rsi host verification — stub context (DESIGN.md is the only contract)');
  console.log(`plugin: ${path.join(HERE, 'index.js')}`);
  const designSha = sha256(await fs.readFile(path.join(HERE, 'DESIGN.md'))).slice(0, 16);
  console.log(`contract: DESIGN.md sha256 ${designSha} (DESIGN was edited during verification; this is the checked revision)`);
  console.log(`temp roots: ${tmpdir()}/dsh-archive-rsi-verify-*`);
  console.log(`real corpus: ${path.join(homedir(), '.dsh', 'sessions')}`);

  const phases = [
    ['config', phaseConfig],
    ['decode', phaseDecode],
    ['facts', phaseFacts],
    ['store', phaseStore],
    ['metrics', phaseMetrics],
    ['rules', phaseRules],
    ['autotags', phaseAutotags],
    ['pdca', phasePdca],
    ['adoption', phaseAdoption],
    ['wiring', phaseWiring],
    ['bad args', phaseBadArgs],
    ['routes', phaseRoutes],
    ['transcript', phaseTranscriptContract],
  ];
  if (!process.argv.includes('--skip-e2e')) phases.push(['e2e', phaseE2E]);

  for (const [name, fn] of phases) {
    const before = SUMMARY.pass + SUMMARY.fail + SUMMARY.skip;
    try {
      await fn();
    } catch (error) {
      printFail(`PHASE.${name}`, `${name} phase aborted`, (error && error.stack) || String(error));
    }
    if (SUMMARY.pass + SUMMARY.fail + SUMMARY.skip === before) {
      printFail(`PHASE.${name}`, `${name} phase executed no checks`, 'phase produced no PASS/FAIL/SKIP line');
    }
  }
}

process.on('unhandledRejection', (reason) => {
  printFail('CRASH.unhandledRejection', 'no unhandled promise rejection during the run', (reason && reason.message) || String(reason));
});

let cleanupOk = true;
try {
  await main();
} catch (error) {
  printFail('harness', 'unexpected harness failure', (error && error.stack) || String(error));
} finally {
  for (const base of tempRoots) {
    try {
      await fs.rm(base, { recursive: true, force: true });
      if (await exists(base)) throw new Error(`temp root still exists: ${base}`);
    } catch (error) {
      cleanupOk = false;
      printFail('cleanup', `remove temp root ${base}`, (error && error.message) || String(error));
    }
  }
  if (cleanupOk) console.log(`\ncleanup: removed ${tempRoots.length} temp root(s) under ${tmpdir()}`);
}

console.log('\n================ SUMMARY ================');
for (const record of SUMMARY.records) {
  if (!record.ok) console.log(`FAILED  ${record.id}  ${record.description} — ${record.detail}`);
}
for (const skip of SKIPS) console.log(`SKIPPED ${skip.id}  ${skip.description} — ${skip.reason}`);
console.log(`checks: ${SUMMARY.pass + SUMMARY.fail}   PASS: ${SUMMARY.pass}   FAIL: ${SUMMARY.fail}   SKIP: ${SUMMARY.skip}`);
if (SUMMARY.skip > 0) console.log(`verify-host skips: ${SUMMARY.skip} (${SKIPS.map((skip) => skip.id).join(', ')})`);
console.log(`verify-host: ${SUMMARY.pass} pass / ${SUMMARY.fail} fail`);
process.exit(SUMMARY.fail === 0 ? 0 : 1);
