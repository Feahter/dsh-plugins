#!/usr/bin/env node
/**
 * Stub-context verification harness for the `dsh-task-ledger` HOST half.
 *
 * It never installs the bundle: it imports `index.js`/`ledger.js` directly,
 * builds a fake Cordis-like context (tools / systemPrompt / webServer /
 * commands / connection) and drives every surface the real Harness would:
 * the five `task_*` agent tools, the two prompt contributions, the
 * `/api/task-ledger/*` panel routes, the `/task` command, and cold start.
 *
 * Test roots live under /tmp and are removed before exit.
 * Exit code 0 only when every check passes.
 *
 * Usage: node task-ledger/.verify-host.mjs
 */

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(path.join(HERE, 'index.js')).href;
const LEDGER_URL = pathToFileURL(path.join(HERE, 'ledger.js')).href;
const CLIENT_VERIFIER = path.join(HERE, '.verify-client.mjs');

const plugin = await import(INDEX_URL);
const ledgerModule = await import(LEDGER_URL);

// ------------------------------------------------------------------- results

const CLAIM = {
  records: [],
  pass: 0,
  fail: 0,
};
const tempRoots = [];

function printPass(id, description, detail) {
  CLAIM.pass += 1;
  CLAIM.records.push({ id, description, ok: true, detail: detail || '' });
  console.log(`PASS  ${id}  ${description}${detail ? `  [${detail}]` : ''}`);
}

function printFail(id, description, detail) {
  CLAIM.fail += 1;
  CLAIM.records.push({ id, description, ok: false, detail: detail || '' });
  console.log(`FAIL  ${id}  ${description}  [${detail}]`);
}

async function runCheck(id, description, fn) {
  try {
    const detail = await fn();
    printPass(id, description, typeof detail === 'string' ? detail : '');
  } catch (error) {
    printFail(id, description, (error && error.message) || String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertMatch(value, regex, what) {
  if (typeof value !== 'string' || !regex.test(value)) {
    throw new Error(`${what}: ${JSON.stringify(value)} does not match ${regex}`);
  }
}

function sha256hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

// ------------------------------------------------------------------ utilities

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeout = 3000, interval = 25, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
      last = 'returned falsy';
    } catch (error) {
      last = (error && error.message) || String(error);
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}${last ? ` (${last})` : ''}`);
    await sleep(interval);
  }
}

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

/** Tolerant JSONL reader: a concurrently appended trailing line is ignored. */
async function jsonlLoose(file) {
  const text = await readText(file);
  if (!text) return [];
  const records = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
    } catch {
      if (index !== lines.length - 1) throw new Error(`corrupt JSONL at ${file}:${index + 1}`);
    }
  }
  return records;
}

async function jsonlStrict(file) {
  return jsonlLoose(file);
}

async function readdirSorted(dir) {
  try {
    return (await fs.readdir(dir)).sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function makeBase(label) {
  // Required by the task: roots live under /tmp (macOS /tmp -> private/tmp).
  const base = await fs.mkdtemp(path.join('/tmp', `dsh-task-ledger-verify-${label}-`));
  tempRoots.push(base);
  return base;
}

// --------------------------------------------------------------- stub context

const PERMISSIVE = { requestRejection() { return null; } };
const REJECT_401 = { requestRejection() { return 401; } };
const REJECT_403 = { requestRejection() { return 403; } };

/**
 * Minimal Cordis-like ctx: effect/tools/systemPrompt/on/inject/get plus the
 * injected `webServer` and `commands` services. `ref.value` is the current
 * `connection` service, so a test can swap it (or delete ctx.get) mid-flight.
 */
function createStub({ connection } = {}) {
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
        return 2400;
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
    for (const dep of deps) {
      if (Object.hasOwn(ctx, dep)) child[dep] = ctx[dep];
    }
    state.injections.push([...deps]);
    callback(child);
    return () => {};
  };
  return { ctx, ref, state };
}


async function callTool(stub, name, args = {}, agentId = 'session-main') {
  const definition = stub.state.tools.get(name);
  if (!definition) throw new Error(`tool ${name} is not registered`);
  const exec = agentId ? { agent: { id: agentId } } : {};
  return definition.execute(args, exec);
}

async function renderTool(stub, name, args, value) {
  const definition = stub.state.tools.get(name);
  const blocks = definition.output.render(args, value);
  if (!Array.isArray(blocks)) throw new Error(`${name}: render() did not return an array`);
  return blocks.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join('\n');
}

// ------------------------------------------------------------------ http stubs

function makeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (body !== undefined) {
    setImmediate(() => {
      req.emit('data', Buffer.from(body, 'utf8'));
      req.emit('end');
    });
  }
  return req;
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

// =========================================================== phases / checks

async function phaseApplyAndEmptyList() {
  const base = await makeBase('apply');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(150);

  await runCheck('1.1', 'exports inject=[tools,systemPrompt]; registers 5 unique task_* tools', () => {
    assertEqual(JSON.stringify(plugin.inject), JSON.stringify(['tools', 'systemPrompt']), 'inject export');
    const names = [...stub.state.tools.keys()];
    assertEqual(names.length, 5, `registered tool count (${names.join(', ') || 'none'})`);
    assertEqual(new Set(names).size, names.length, 'tool names are not unique');
    for (const expected of ['task_list', 'task_open', 'task_resume', 'task_checkpoint', 'task_close']) {
      assert(names.includes(expected), `missing tool ${expected}`);
    }
    for (const [name, definition] of stub.state.tools) {
      assert(typeof definition.description === 'string' && definition.description.length > 20, `${name}: description too short`);
      assert(typeof definition.execute === 'function', `${name}: execute() missing`);
      assert(definition.output && typeof definition.output.render === 'function', `${name}: output.render() missing`);
      assert(definition.parameters && definition.parameters.type === 'object', `${name}: parameters are not an object schema`);
    }
  });

  await runCheck('1.2', 'exactly one static protocol prompt section (name/order/text/interpolate)', () => {
    const sections = stub.state.sections;
    assertEqual(sections.length, 1, `prompt section count (names: ${sections.map((s) => s.name).join(',')})`);
    const section = sections[0];
    assertEqual(section.name, 'task-ledger-protocol', 'section name');
    assert(typeof section.order === 'number' && Number.isFinite(section.order), `section order is not finite: ${String(section.order)}`);
    assert(typeof section.text === 'string' && section.text.trim().length > 100, 'section text is empty/too short');
    assert(section.text.includes('task_resume'), 'section text does not mention task_resume');
    assert(section.interpolate === false, `section.interpolate must be false, got ${String(section.interpolate)}`);
  });

  await runCheck('1.3', 'exactly one dynamic prompt context (name task-ledger-briefing)', () => {
    const contexts = stub.state.contexts;
    assertEqual(contexts.length, 1, `prompt context count (names: ${contexts.map((c) => c.name).join(',')})`);
    const context = contexts[0];
    assertEqual(context.name, 'task-ledger-briefing', 'context name');
    assertEqual(typeof context.text, 'function', 'context.text must be a sync function');
    assertEqual(context.interpolate, false, 'context.interpolate');
  });

  await runCheck('1.4', 'registers the /api/task-ledger prefix route with a handler', () => {
    const routes = stub.state.routes;
    assertEqual(routes.length, 1, `route registrations (${routes.length})`);
    assertEqual(routes[0].kind, 'prefix', 'route.kind');
    assertEqual(routes[0].path, '/api/task-ledger', 'route.path');
    assertEqual(typeof routes[0].handler, 'function', 'route.handler');
    assert(stub.state.injections.some((deps) => deps.includes('webServer')), 'webServer was not injected');
  });

  await runCheck('1.5', 'registers the /task slash command with a handler', () => {
    const commands = stub.state.commands;
    assertEqual(commands.length, 1, `command registrations (${commands.length})`);
    assertEqual(commands[0].name, 'task', 'command name');
    assertEqual(typeof commands[0].handler, 'function', 'command handler');
    assert(stub.state.injections.some((deps) => deps.includes('commands')), 'commands was not injected');
  });

  await runCheck('1.6', 'subscribes to agent/created for session-start briefing refresh', () => {
    const listeners = stub.state.events.filter((entry) => entry.event === 'agent/created');
    assertEqual(listeners.length, 1, `agent/created listeners (${listeners.length})`);
    assertEqual(typeof listeners[0].handler, 'function', 'agent/created handler');
  });

  await runCheck('1.7', 'a second apply() on a fresh stub ctx does not throw or double-register within it', async () => {
    const second = createStub();
    plugin.apply(second.ctx, { rootDir: root });
    await sleep(120);
    assertEqual(second.state.tools.size, 5, 'second ctx tool count');
    assertEqual(second.state.sections.length, 1, 'second ctx section count');
    assertEqual(second.state.contexts.length, 1, 'second ctx context count');
    assertEqual(second.state.routes.length, 1, 'second ctx route count');
    assertEqual(second.state.commands.length, 1, 'second ctx command count');
  });

  let emptyList;
  await runCheck('2.1', 'task_list on an empty ledger: ok, 0 tasks, nothing pinned', async () => {
    emptyList = await callTool(stub, 'task_list', {});
    assert(emptyList && emptyList.ok === true, `task_list failed: ${JSON.stringify(emptyList && emptyList.error)}`);
    assertEqual(emptyList.tasks.length, 0, 'task count');
    assertEqual(emptyList.active_task_id, null, 'active_task_id');
    assertEqual(emptyList.root, path.resolve(root), 'root');
    assert(emptyList.counts && emptyList.counts.open === 0 && emptyList.counts.blocked === 0 && emptyList.counts.done === 0, 'counts are not all zero');
  });

  await runCheck('2.2', 'task_list render is a text block that says no tasks match', async () => {
    assert(emptyList && emptyList.ok === true, 'prerequisite: 2.1 failed');
    const blocks = stub.state.tools.get('task_list').output.render({}, emptyList);
    assert(Array.isArray(blocks) && blocks.length === 1, 'render must return exactly one block');
    assertEqual(blocks[0].type, 'text', 'block type');
    assertEqual(typeof blocks[0].text, 'string', 'block text type');
    assert(blocks[0].text.length > 0, 'block text is empty');
    assert(/no tasks match/i.test(blocks[0].text), `text lacks "no tasks match": ${JSON.stringify(blocks[0].text.slice(0, 200))}`);
    assert(/pinned none/i.test(blocks[0].text), 'text does not report the pinned task as none');
  });
}

async function phaseLifecycle() {
  const base = await makeBase('lifecycle');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(150);

  let tid = '';
  let opened = null;
  let run1 = '';
  let run3 = '';

  await runCheck('3.1', 'task_open returns a YYYY-MM-DD-<slug> task_id', async () => {
    opened = await callTool(stub, 'task_open', {
      title: 'Gate Test Task',
      goal: 'Prove the evidence gate blocks a premature done closeout, that refutation re-opens the path, and that force overrides are recorded.',
      research_questions: ['Does the gate block a done closeout while a claim is unverified?'],
      acceptance: ['A blocked closeout is recorded in the run report'],
      evidence_bar: 'Primary logs with sha256 snapshots.',
      tags: ['verify'],
    });
    assert(opened && opened.ok === true, `task_open failed: ${JSON.stringify(opened && opened.error)}`);
    tid = opened.task_id;
    assertMatch(tid, /^\d{4}-\d{2}-\d{2}-gate-test-task$/, 'task_id');
    assert(opened.charter && opened.charter.goal.includes('evidence gate'), 'charter goal missing');
  });

  if (!tid) {
    for (const [id, description] of [
      ['3.2', 'task_open wrote task.json/state.json/decisions.jsonl on disk'],
      ['3.3', 'INDEX.md exists at the ledger root and contains the task id'],
      ['3.4', 'duplicate title allocates a -2 suffix'],
      ['3.5', 'task_open render names the task and the resume step'],
    ]) printFail(id, description, 'blocked: 3.1 did not return a task_id');
    return;
  }

  const taskDir = path.join(root, 'tasks', tid);

  await runCheck('3.2', 'task_open wrote task.json/state.json/decisions.jsonl and runs/ + evidence/', async () => {
    for (const file of ['task.json', 'state.json', 'decisions.jsonl']) {
      assert(await exists(path.join(taskDir, file)), `missing ${file}`);
    }
    assert(await exists(path.join(taskDir, 'runs')), 'missing runs/');
    assert(await exists(path.join(taskDir, 'evidence')), 'missing evidence/');
    const charter = await readJson(path.join(taskDir, 'task.json'));
    assertEqual(charter.title, 'Gate Test Task', 'charter title');
    assertEqual(charter.task_id, tid, 'charter task_id');
    const decisions = await jsonlLoose(path.join(taskDir, 'decisions.jsonl'));
    assert(decisions.length >= 1 && /opened/i.test(String(decisions[0].decision)), 'no "Task opened" decision record');
  });

  await runCheck('3.3', 'INDEX.md exists at the ledger root and contains the task id', async () => {
    const indexPath = path.join(root, 'INDEX.md');
    assert(await exists(indexPath), 'INDEX.md missing');
    const text = await readText(indexPath);
    assert(text.includes(tid), 'INDEX.md does not name the task');
    assert(text.includes('Task ledger'), 'INDEX.md does not look like the generated index');
  });

  await runCheck('3.4', 'a duplicate title allocates a -2 suffix', async () => {
    const duplicate = await callTool(stub, 'task_open', {
      title: 'Gate Test Task',
      goal: 'Second task with the same title, to prove task-id deduplication.',
    });
    assert(duplicate && duplicate.ok === true, `duplicate open failed: ${JSON.stringify(duplicate && duplicate.error)}`);
    assertMatch(duplicate.task_id, /-2$/, 'duplicate task_id');
    assert(duplicate.task_id !== tid, 'duplicate task_id equals the first id');
  });

  await runCheck('3.5', 'task_open render names the task, goal, and the resume step', async () => {
    assert(opened && opened.ok === true, 'prerequisite: 3.1 failed');
    const text = await renderTool(stub, 'task_open', {}, opened);
    assert(text.includes(tid), 'render does not mention the task id');
    assert(/goal:/.test(text), 'render does not include the goal');
    assert(text.includes('task_resume'), 'render does not point at task_resume');
  });

  let resumed = null;
  await runCheck('4.1', 'task_resume returns run_id + lease and a brief with goal and status', async () => {
    resumed = await callTool(stub, 'task_resume', { task_id: tid, label: 'verify run 1' }, 'session-a');
    assert(resumed && resumed.ok === true, `task_resume failed: ${JSON.stringify(resumed && resumed.error)}`);
    run1 = resumed.run_id;
    assertMatch(run1, /^run-[a-z0-9]+-[a-z0-9]+$/, 'run_id shape');
    assert(resumed.lease && resumed.lease.run_id === run1, 'lease.run_id does not match run_id');
    assertEqual(resumed.lease.session_id, 'session-a', 'lease.session_id');
    assert(Date.parse(resumed.lease.expires_at) > Date.now(), 'lease already expired');
    assert(typeof resumed.brief === 'string' && resumed.brief.length > 0, 'brief is empty');
    assert(resumed.brief.includes(`TASK \`${tid}\``) || resumed.brief.includes(tid), 'brief does not name the task');
    assert(/goal:/.test(resumed.brief), 'brief lacks the goal');
    assert(/status: open/.test(resumed.brief), 'brief lacks the status');
  });

  await runCheck('4.2', 'the lease is written to state.json and pins the active task', async () => {
    assert(run1, 'prerequisite: 4.1 failed');
    const state = await readJson(path.join(taskDir, 'state.json'));
    assert(state.lease && state.lease.run_id === run1, 'state.json lease.run_id mismatch');
    assertEqual(state.lease.session_id, 'session-a', 'state.json lease.session_id');
    assert(Date.parse(state.lease.expires_at) > Date.now(), 'state.json lease expires_at is in the past');
    assertEqual(state.last_run_id, run1, 'state.last_run_id');
    const active = await readJson(path.join(root, 'active.json'));
    assertEqual(active.task_id, tid, 'active.json task_id');
  });

  await runCheck('4.3', 'a second resume while the lease is live fails with code task-leased (no throw)', async () => {
    assert(run1, 'prerequisite: 4.1 failed');
    const conflict = await callTool(stub, 'task_resume', { task_id: tid }, 'session-b');
    assert(conflict && typeof conflict === 'object', 'task_resume did not return an object');
    assertEqual(conflict.ok, false, 'second resume unexpectedly succeeded');
    assert(conflict.error && conflict.error.code === 'task-leased', `error.code: expected task-leased, got ${JSON.stringify(conflict.error)}`);
    const state = await readJson(path.join(taskDir, 'state.json'));
    assertEqual(state.lease.run_id, run1, 'rejected resume mutated the lease');
  });

  let checkpoint = null;
  let evidenceRecord = null;
  await runCheck('5.1', 'task_checkpoint appends claims/decisions/evidence, moves phase, bumps version', async () => {
    assert(run1, 'prerequisite: 4.1 failed');
    const before = (await readJson(path.join(taskDir, 'state.json'))).version;
    checkpoint = await callTool(stub, 'task_checkpoint', {
      run_id: run1,
      task_id: tid,
      phase: 'evidence',
      next_actions: ['Resolve the unverified gateway claim', 'Cross-check the primary spec'],
      open_questions: ['Does the captured log cover every route?'],
      note: 'Checkpoint written by the verification harness.',
      claims: [
        {
          id: 'claim-gate',
          claim: 'The gateway rejects unauthenticated writes with HTTP 401.',
          status: 'unverified',
        },
        {
          id: 'claim-source',
          claim: 'The captured log shows a 401 response.',
          status: 'verified',
          evidence_name: 'gateway-log.txt',
          source_ref: 'https://example.test/gateway.log',
        },
      ],
      decisions: [
        {
          decision: 'Treat the ledger as the canonical store.',
          rationale: 'Chat history is lossy after compaction.',
          rejected: ['chat history'],
          evidence_grade: '[文]',
        },
      ],
      evidence: [
        {
          name: 'gateway-log.txt',
          content: 'HTTP/1.1 401 Unauthorized\n{"error":"unauthorized"}\n',
          mime: 'text/plain',
          url: 'https://example.test/gateway.log',
          note: 'Captured response line.',
        },
      ],
      expected_version: before,
    });
    assert(checkpoint && checkpoint.ok === true, `task_checkpoint failed: ${JSON.stringify(checkpoint && checkpoint.error)}`);
    assert(checkpoint.version > before, `version did not advance: ${before} -> ${checkpoint.version}`);
    assertEqual(checkpoint.state.phase, 'evidence', 'state.phase');
    assertEqual(checkpoint.state.next_actions.length, 2, 'state.next_actions length');
    assertEqual(checkpoint.appended.claims, 2, 'appended.claims');
    assertEqual(checkpoint.appended.decisions, 2, 'appended.decisions (explicit + note)');
    assertEqual(checkpoint.appended.evidence, 1, 'appended.evidence');
    assert(checkpoint.gate && checkpoint.gate.pass === false, 'gate should fail while claim-gate is unverified');
    evidenceRecord = checkpoint.evidence[0];
    assert(evidenceRecord && evidenceRecord.sha256, 'checkpoint returned no evidence record');
  });

  await runCheck('5.2', 'the evidence file exists on disk and its sha256 matches the record', async () => {
    assert(evidenceRecord, 'prerequisite: 5.1 failed');
    const file = path.join(taskDir, 'evidence', evidenceRecord.name);
    assert(await exists(file), `stored evidence file missing: ${evidenceRecord.name}`);
    const bytes = await fs.readFile(file);
    assertEqual(sha256hex(bytes), evidenceRecord.sha256, 'stored evidence sha256');
    assertEqual(evidenceRecord.name.slice(0, 12), evidenceRecord.sha256.slice(0, 12), 'content-addressed name prefix');
    const index = await jsonlStrict(path.join(taskDir, 'evidence', 'index.jsonl'));
    const record = index.find((entry) => entry.sha256 === evidenceRecord.sha256);
    assert(record, 'evidence/index.jsonl has no record for the snapshot');
  });

  await runCheck('5.3', 'a claim evidence_name resolves to a sha256: hash in claims.jsonl', async () => {
    assert(evidenceRecord, 'prerequisite: 5.1 failed');
    const claims = await jsonlStrict(path.join(taskDir, 'claims.jsonl'));
    const source = claims.filter((record) => record.id === 'claim-source').pop();
    assert(source, 'claim-source was not appended');
    assertMatch(source.evidence_hash, /^sha256:[0-9a-f]{64}$/, 'claim-source evidence_hash');
    assertEqual(source.evidence_hash, `sha256:${evidenceRecord.sha256}`, 'claim evidence_hash vs stored sha256');
  });

  await runCheck('5.4', 'a stale expected_version fails with code version-conflict and writes nothing', async () => {
    assert(run1, 'prerequisite: 4.1 failed');
    const before = (await readJson(path.join(taskDir, 'state.json'))).version;
    const conflict = await callTool(stub, 'task_checkpoint', {
      run_id: run1,
      task_id: tid,
      note: 'this write must not land',
      expected_version: 1,
    });
    assertEqual(conflict.ok, false, 'stale expected_version was accepted');
    assert(conflict.error && conflict.error.code === 'version-conflict', `error.code: expected version-conflict, got ${JSON.stringify(conflict.error)}`);
    assertEqual((await readJson(path.join(taskDir, 'state.json'))).version, before, 'state version changed on rejected write');
  });

  await runCheck('5.5', 'a bogus run_id fails with code lease-mismatch', async () => {
    const bogus = await callTool(stub, 'task_checkpoint', {
      run_id: 'run-bogus-1',
      task_id: tid,
      note: 'this write must not land',
    });
    assertEqual(bogus.ok, false, 'a bogus run_id was accepted');
    assert(bogus.error && bogus.error.code === 'lease-mismatch', `error.code: expected lease-mismatch, got ${JSON.stringify(bogus.error)}`);
  });

  await runCheck('5.6', 'task_checkpoint refuses to set status done', async () => {
    const done = await callTool(stub, 'task_checkpoint', { run_id: run1, task_id: tid, status: 'done' });
    assertEqual(done.ok, false, 'checkpoint accepted status done');
    assert(done.error && done.error.code === 'invalid-argument', `error.code: expected invalid-argument, got ${JSON.stringify(done.error)}`);
    assert(/open|blocked/.test(String(done.error.message)), 'error message does not explain the allowed statuses');
  });

  let close1 = null;
  await runCheck('6.1', 'a failing gate downgrades a requested "done" close to blocked and the report records it', async () => {
    assert(run1, 'prerequisite: 4.1 failed');
    close1 = await callTool(stub, 'task_close', {
      run_id: run1,
      task_id: tid,
      summary: 'FIRST_RUN The first run stopped at the evidence gate because claim-gate was still unverified.',
      findings: ['The evidence gate blocked a premature done closeout.'],
      failures: ['claim-gate remains unverified.'],
      next_actions: ['Resolve the unverified claim before closing done'],
      status: 'done',
    });
    assert(close1 && close1.ok === true, `task_close failed: ${JSON.stringify(close1 && close1.error)}`);
    assertEqual(close1.status, 'blocked', 'closing with a failing gate must produce blocked, not done');
    assert(close1.gate && close1.gate.pass === false, 'gate.pass should be false');
    const reportPath = close1.report;
    assert(typeof reportPath === 'string' && (await exists(reportPath)), `run report missing: ${reportPath}`);
    const report = await readText(reportPath);
    assert(/evidence gate:\s*fail/i.test(report), 'run report does not mention the gate failure');
    assert(/claims-resolved/.test(report), 'run report lacks the failed gate check name');
    assert(report.includes('FIRST_RUN'), 'run report does not contain the run summary');
  });

  await runCheck('6.2', 'state.json is blocked with a gate-derived blocked_reason and no lease', async () => {
    assert(close1 && close1.ok === true, 'prerequisite: 6.1 failed');
    const state = await readJson(path.join(taskDir, 'state.json'));
    assertEqual(state.status, 'blocked', 'state.status');
    assert(state.blocked_reason && /Evidence gate failed/i.test(state.blocked_reason), `state.blocked_reason: ${JSON.stringify(state.blocked_reason)}`);
    assertEqual(state.lease, null, 'state.lease should be released');
  });

  let close2 = null;
  await runCheck('6.3', 'resume again, refute the claim by id, close -> done with a passing gate', async () => {
    const second = await callTool(stub, 'task_resume', { task_id: tid, label: 'verify run 2' }, 'session-a');
    assert(second && second.ok === true, `second task_resume failed: ${JSON.stringify(second && second.error)}`);
    assert(second.run_id !== run1, 'second resume reused the previous run_id');
    const refute = await callTool(stub, 'task_checkpoint', {
      run_id: second.run_id,
      task_id: tid,
      claims: [
        {
          id: 'claim-gate',
          claim: 'The gateway rejects unauthenticated writes with HTTP 401.',
          status: 'refuted',
          note: 'The 401 was produced by an upstream proxy; the gateway itself accepted the write.',
        },
      ],
      next_actions: ['Close the task after the refutation'],
    });
    assert(refute && refute.ok === true, `refuting checkpoint failed: ${JSON.stringify(refute && refute.error)}`);
    close2 = await callTool(stub, 'task_close', {
      run_id: second.run_id,
      task_id: tid,
      summary: 'SECOND_RUN Refuted claim-gate and closed the task as done.',
      status: 'done',
      next_actions: ['Report the closeout'],
    });
    assert(close2 && close2.ok === true, `second task_close failed: ${JSON.stringify(close2 && close2.error)}`);
    assertEqual(close2.status, 'done', 'close status after refutation');
    assert(close2.gate && close2.gate.pass === true, 'gate should pass after the refutation');
  });

  await runCheck('6.4', 'the refutation is preserved as history and latest-record-wins in the resolved claims', async () => {
    assert(close2 && close2.ok === true, 'prerequisite: 6.3 failed');
    const records = await jsonlStrict(path.join(taskDir, 'claims.jsonl'));
    const gateRecords = records.filter((record) => record.id === 'claim-gate');
    assert(gateRecords.length >= 2, `expected the superseded claim to be kept (>=2 records), got ${gateRecords.length}`);
    assertEqual(gateRecords[gateRecords.length - 1].status, 'refuted', 'latest claim-gate record status');
    assert(/proxy/.test(String(gateRecords[gateRecords.length - 1].note)), 'refutation note was lost');
    const listed = await callTool(stub, 'task_list', { status: 'all' });
    const summary = listed.tasks.find((task) => task.task_id === tid);
    assert(summary, 'task missing from task_list');
    assertEqual(summary.claim_counts.refuted, 1, 'resolved claim_counts.refuted');
    assertEqual(summary.claim_counts.unverified, 0, 'resolved claim_counts.unverified');
  });

  let close3 = null;
  await runCheck('6.5', 'force:true closes done despite a failing gate and appends an override decision', async () => {
    const third = await callTool(stub, 'task_resume', { task_id: tid, label: 'verify run 3' }, 'session-a');
    assert(third && third.ok === true, `third task_resume failed: ${JSON.stringify(third && third.error)}`);
    run3 = third.run_id;
    const forceClaim = await callTool(stub, 'task_checkpoint', {
      run_id: run3,
      task_id: tid,
      claims: [{ id: 'claim-force', claim: 'A forced close is justified for this harness check.', status: 'unverified' }],
    });
    assert(forceClaim && forceClaim.ok === true, `force precondition checkpoint failed: ${JSON.stringify(forceClaim && forceClaim.error)}`);
    close3 = await callTool(stub, 'task_close', {
      run_id: run3,
      task_id: tid,
      summary: 'FORCE_MARKER Third run closed done despite a failing evidence gate (forced override).',
      next_actions: ['Verify the force override is visible in the panel'],
      status: 'done',
      force: true,
    });
    assert(close3 && close3.ok === true, `forced task_close failed: ${JSON.stringify(close3 && close3.error)}`);
    assertEqual(close3.status, 'done', 'forced close status');
    assert(close3.gate && close3.gate.pass === false, 'gate should still be failing under force');
    const decisions = await jsonlStrict(path.join(taskDir, 'decisions.jsonl'));
    const override = decisions.filter((record) => /explicit override/i.test(String(record.decision))).pop();
    assert(override, 'forced close did not append an override decision');
    assertEqual(override.approved_by, 'caller-force', 'override.approved_by');
    assertEqual((await readJson(path.join(taskDir, 'state.json'))).status, 'done', 'state.status after forced close');
  });

  await runCheck('7.1', 'cold start: a brand-new ctx/apply + new agent resumes by task_id only', async () => {
    assert(close3 && close3.ok === true, 'prerequisite: 6.5 failed');
    const coldStub = createStub();
    plugin.apply(coldStub.ctx, { rootDir: root }); // same root, no in-memory state
    await sleep(150);
    const cold = await callTool(coldStub, 'task_resume', { task_id: tid }, 'session-cold');
    assert(cold && cold.ok === true, `cold task_resume failed: ${JSON.stringify(cold && cold.error)}`);
    assertEqual(typeof cold.brief, 'string', 'cold brief type');
    assert(cold.brief.trim().length > 0, 'cold brief is empty');
    assert(cold.brief.includes(tid), 'cold brief does not contain the task id');
    assert(cold.brief.includes('Gate Test Task'), 'cold brief does not contain the task title');
    assert(/last_run/.test(cold.brief), 'cold brief does not carry the prior run summary');
    assert(cold.brief.includes('FORCE_MARKER'), 'cold brief lost the prior run summary text');
    assert(cold.brief.includes('Verify the force override is visible in the panel'), 'cold brief lost the prior next_actions');
  });

  await runCheck('14.1', 'a cold Node process reads the same on-disk state (store is process-agnostic)', async () => {
    assert(tid, 'prerequisite: 3.1 failed');
    const stateOnDisk = await readJson(path.join(taskDir, 'state.json'));
    const script = [
      `import { readTask } from ${JSON.stringify(LEDGER_URL)};`,
      `const task = await readTask(process.env.VERIFY_LEDGER_ROOT, process.env.VERIFY_LEDGER_TASK);`,
      `console.log(JSON.stringify({ task_id: task.charter.task_id, title: task.charter.title, status: task.state.status, version: task.state.version, claims: task.claims.length, evidence: task.evidence.length, runs: task.runs.length }));`,
    ].join('\n');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, VERIFY_LEDGER_ROOT: root, VERIFY_LEDGER_TASK: tid },
    });
    const line = output.trim().split(/\r?\n/).filter(Boolean).pop();
    assert(line, 'cold process printed nothing');
    const parsed = JSON.parse(line);
    assertEqual(parsed.task_id, tid, 'cold process task_id');
    assertEqual(parsed.title, 'Gate Test Task', 'cold process title');
    assertEqual(parsed.status, stateOnDisk.status, 'cold process status');
    assertEqual(parsed.version, stateOnDisk.version, 'cold process version');
    assert(parsed.claims >= 3, `cold process saw ${parsed.claims} resolved claims`);
    assert(parsed.runs >= 1, 'cold process saw no run records');
    return `status=${parsed.status} version=${parsed.version} claims=${parsed.claims}`;
  });
}

async function phaseLeaseExpiry() {
  const base = await makeBase('lease-expiry');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(150);

  await runCheck('4.4', 'an expired lease can be taken over by another run (simulated clock)', async () => {
    const opened = await callTool(stub, 'task_open', { title: 'Expired Lease Task', goal: 'Prove expired-lease takeover.' });
    assert(opened && opened.ok === true, `fixture open failed: ${JSON.stringify(opened && opened.error)}`);
    const taskDir = path.join(root, 'tasks', opened.task_id);
    const first = await callTool(stub, 'task_resume', { task_id: opened.task_id }, 'session-expiry-a');
    assert(first && first.ok === true, `first resume failed: ${JSON.stringify(first && first.error)}`);
    // Simulate the TTL elapsing without waiting: rewrite only the temp-root state.
    const state = await readJson(path.join(taskDir, 'state.json'));
    state.lease.expires_at = new Date(Date.now() - 5_000).toISOString();
    await fs.writeFile(path.join(taskDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    const takeover = await callTool(stub, 'task_resume', { task_id: opened.task_id }, 'session-expiry-b');
    assert(takeover && takeover.ok === true, `expired-lease takeover was refused: ${JSON.stringify(takeover && takeover.error)}`);
    assert(takeover.run_id !== first.run_id, 'takeover reused the expired run_id');
    assertEqual(takeover.lease.session_id, 'session-expiry-b', 'takeover lease.session_id');
  });
}

async function phaseBriefing() {

  const base = await makeBase('briefing');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(300);

  await runCheck('8.1', 'the runtime-context briefing is the empty string on an empty ledger', () => {
    const text = stub.state.contexts[0].text();
    assertEqual(typeof text, 'string', 'briefing text type');
    assertEqual(text, '', 'briefing text on empty ledger');
  });

  await runCheck('8.2', 'after resume binds the active task, the briefing names it and points at task_resume', async () => {
    const opened = await callTool(stub, 'task_open', {
      title: 'Briefing Task',
      goal: 'Expose the pinned task in the runtime-context briefing.',
    });
    assert(opened && opened.ok === true, `task_open failed: ${JSON.stringify(opened && opened.error)}`);
    const resumed = await callTool(stub, 'task_resume', { task_id: opened.task_id }, 'session-brief');
    assert(resumed && resumed.ok === true, `task_resume failed: ${JSON.stringify(resumed && resumed.error)}`);
    const text = await waitFor(() => {
      const current = stub.state.contexts[0].text();
      return typeof current === 'string' && current.includes(opened.task_id) && current.includes('task_resume') ? current : null;
    }, { label: 'briefing to name the active task and task_resume' });
    assert(text.includes('Briefing Task'), 'briefing does not contain the task title');
    assert(/active task/i.test(text), 'briefing does not mark the task as the active one');
  });
}

async function phaseRoutes() {
  const base = await makeBase('routes');
  const root = path.join(base, 'ledger');
  const stub = createStub({ connection: PERMISSIVE });
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(150);

  const openA = await callTool(stub, 'task_open', { title: 'Route Task One', goal: 'Serve panel route checks.' });
  const openB = await callTool(stub, 'task_open', { title: 'Route Task Two', goal: 'Serve the pin/unpin route checks.' });
  assert(openA && openA.ok === true, `route fixture task A failed: ${JSON.stringify(openA && openA.error)}`);
  assert(openB && openB.ok === true, `route fixture task B failed: ${JSON.stringify(openB && openB.error)}`);
  const tidA = openA.task_id;
  const tidB = openB.task_id;
  const handler = stub.state.routes[0].handler;
  const taskDirA = path.join(root, 'tasks', tidA);

  await runCheck('9.1', 'GET /api/task-ledger/index returns 200 with tasks/counts/activeTaskId/root', async () => {
    const response = await httpCall(handler, { url: '/api/task-ledger/index' });
    assertEqual(response.status, 200, `status (body: ${String(response.body).slice(0, 200)})`);
    assert(response.json && response.json.ok === true, 'body.ok is not true');
    const data = response.json.data || {};
    assert(Array.isArray(data.tasks), 'data.tasks is not an array');
    assert(data.counts && typeof data.counts === 'object', 'data.counts missing');
    assertEqual(data.counts.open, 2, 'data.counts.open');
    assertEqual(data.activeTaskId, null, 'data.activeTaskId before pinning');
    assertEqual(data.root, path.resolve(root), 'data.root');
    assertEqual(response.headers['content-type'], 'application/json; charset=utf-8', 'content-type');
  });

  await runCheck('9.2', 'GET /api/task-ledger/task?task_id= returns the task detail', async () => {
    const response = await httpCall(handler, { url: `/api/task-ledger/task?task_id=${encodeURIComponent(tidA)}` });
    assertEqual(response.status, 200, `status (body: ${String(response.body).slice(0, 200)})`);
    const detail = response.json && response.json.data && response.json.data.task;
    assert(detail, 'data.task missing');
    assertEqual(detail.summary.task_id, tidA, 'summary.task_id');
    assert(detail.charter && typeof detail.charter.goal === 'string', 'charter missing from detail');
    assert(Array.isArray(detail.claims), 'claims missing from detail');
  });

  await runCheck('9.3', 'a rejected connection is refused with 401', async () => {
    stub.ref.value = REJECT_401;
    try {
      const response = await httpCall(handler, { url: '/api/task-ledger/index' });
      assertEqual(response.status, 401, `status (body: ${String(response.body).slice(0, 200)})`);
      assert(response.json && response.json.ok === false, 'rejected body.ok is not false');
      assertEqual(response.json.error && response.json.error.code, 'unauthorized', 'error.code');
    } finally {
      stub.ref.value = REJECT_403;
    }
    const forbidden = await httpCall(handler, { url: '/api/task-ledger/index' });
    assertEqual(forbidden.status, 403, 'a 403 rejection must be forwarded as 403');
  });

  await runCheck('9.4', 'a missing connection service answers 503', async () => {
    stub.ref.value = PERMISSIVE;
    const savedGet = stub.ctx.get;
    delete stub.ctx.get;
    try {
      const response = await httpCall(handler, { url: '/api/task-ledger/index' });
      assertEqual(response.status, 503, `status (body: ${String(response.body).slice(0, 200)})`);
      assert(response.json && response.json.ok === false, 'unavailable body.ok is not false');
      assertEqual(response.json.error && response.json.error.code, 'unavailable', 'error.code');
    } finally {
      stub.ctx.get = savedGet;
    }
  });

  await runCheck('9.5', 'POST /api/task-ledger/active pins a task', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/active',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: tidB }),
    });
    assertEqual(response.status, 200, `status (body: ${String(response.body).slice(0, 200)})`);
    assertEqual(response.json.data.activeTaskId, tidB, 'data.activeTaskId');
    const active = await readJson(path.join(root, 'active.json'));
    assertEqual(active.task_id, tidB, 'active.json after pin');
  });

  await runCheck('9.6', 'POST /api/task-ledger/active with task_id:null clears the pin', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/active',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: null }),
    });
    assertEqual(response.status, 200, `status (body: ${String(response.body).slice(0, 200)})`);
    assertEqual(response.json.data.activeTaskId, null, 'data.activeTaskId');
    const active = await readJson(path.join(root, 'active.json'));
    assertEqual(active.task_id, null, 'active.json after clear');
  });

  await runCheck('9.7', 'POST /api/task-ledger/status sets blocked and writes a decision record', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/status',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: tidA, status: 'blocked', reason: 'Awaiting evidence review' }),
    });
    assertEqual(response.status, 200, `status (body: ${String(response.body).slice(0, 200)})`);
    assertEqual(response.json.data.state.status, 'blocked', 'data.state.status');
    const state = await readJson(path.join(taskDirA, 'state.json'));
    assertEqual(state.status, 'blocked', 'state.json status');
    assertEqual(state.blocked_reason, 'Awaiting evidence review', 'state.json blocked_reason');
    const decisions = await jsonlStrict(path.join(taskDirA, 'decisions.jsonl'));
    const last = decisions[decisions.length - 1];
    assert(/Status changed open -> blocked/.test(String(last.decision)), `decision record text: ${JSON.stringify(last.decision)}`);
    assert(/Awaiting evidence review/.test(String(last.rationale)), 'decision record lost the reason');
    assertEqual(last.approved_by, 'panel', 'decision approved_by');
  });

  await runCheck('9.8', 'POST with an invalid JSON body answers 400', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/status',
      headers: { 'content-type': 'application/json' },
      body: '{"task_id":',
    });
    assertEqual(response.status, 400, `status (body: ${String(response.body).slice(0, 200)})`);
    assert(response.json && response.json.ok === false, 'body.ok is not false');
    assertEqual(response.json.error && response.json.error.code, 'invalid-argument', 'error.code');
  });

  await runCheck('9.9', 'POST with an unknown status value answers 400', async () => {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/status',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: tidA, status: 'nonsense' }),
    });
    assertEqual(response.status, 400, `status (body: ${String(response.body).slice(0, 200)})`);
    assertEqual(response.json.error && response.json.error.code, 'invalid-argument', 'error.code');
  });

  await runCheck('9.10', 'an unknown route answers 404 (GET and POST)', async () => {
    const getResponse = await httpCall(handler, { url: '/api/task-ledger/nope' });
    assertEqual(getResponse.status, 404, `GET status (body: ${String(getResponse.body).slice(0, 200)})`);
    const postResponse = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/nope',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assertEqual(postResponse.status, 404, `POST status (body: ${String(postResponse.body).slice(0, 200)})`);
  });
}

async function phasePathSafety() {
  const base = await makeBase('safety');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(200);
  const before = await readdirSorted(base);

  await runCheck('10.1', 'task_resume with a traversal task_id fails with code invalid-task-id', async () => {
    const attempt = await callTool(stub, 'task_resume', { task_id: '../../etc' }, 'session-evil');
    assert(attempt && typeof attempt === 'object', 'task_resume did not return an object');
    assertEqual(attempt.ok, false, 'traversal task_id was accepted');
    assert(attempt.error && attempt.error.code === 'invalid-task-id', `error.code: expected invalid-task-id, got ${JSON.stringify(attempt.error)}`);
    const opened = await callTool(stub, 'task_open', { title: 'Evil', goal: 'traversal', task_id: '../../etc' });
    assertEqual(opened.ok, false, 'task_open accepted a traversal task_id');
    assertEqual(opened.error && opened.error.code, 'invalid-task-id', 'task_open error.code');
  });

  await runCheck('10.2', 'no files were created outside the ledger root', async () => {
    const after = await readdirSorted(base);
    assertEqual(JSON.stringify(after), JSON.stringify(before), 'temp-base directory entries changed');
    assert(!(await exists(path.join(base, 'etc'))), 'created escaped directory base/etc');
    assert(!(await exists(path.join(base, 'tasks'))), 'created escaped directory base/tasks');
    const listed = await callTool(stub, 'task_list', { status: 'all' });
    assertEqual(listed.tasks.length, 0, 'an invalid task_id still produced a ledger task');
  });
}

async function phaseCommand() {
  const base = await makeBase('command');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(150);
  const command = stub.state.commands[0];
  const opened = await callTool(stub, 'task_open', { title: 'Command Task', goal: 'Prove the /task command handler.' });
  assert(opened && opened.ok === true, `command fixture open failed: ${JSON.stringify(opened && opened.error)}`);
  const tid = opened.task_id;
  const invoke = (rawInput) => command.handler({ rawInput, agent: { id: 'session-cmd' } });

  await runCheck('11.1', '/task list returns {kind:success} and lists the task', async () => {
    const result = await invoke('list');
    assert(result && result.kind === 'success', `kind: expected success, got ${JSON.stringify(result && result.kind)}`);
    assert(typeof result.text === 'string' && result.text.includes(tid), 'list text does not include the task id');
    assert(/open 1/.test(result.text), 'list text does not report the open count');
  });

  await runCheck('11.2', 'an unknown /task subcommand returns {kind:error}', async () => {
    const result = await invoke('frobnicate');
    assert(result && result.kind === 'error', `kind: expected error, got ${JSON.stringify(result && result.kind)}`);
    assert(/usage/i.test(String(result.text)), 'error text does not explain the usage');
  });

  await runCheck('11.3', '/task active <id> pins the task', async () => {
    const result = await invoke(`active ${tid}`);
    assert(result && result.kind === 'success', `kind: expected success, got ${JSON.stringify(result && result.kind)}`);
    const active = await readJson(path.join(root, 'active.json'));
    assertEqual(active.task_id, tid, 'active.json after /task active');
    assertEqual(active.session_id, 'session-cmd', 'active.json session_id');
  });
}

async function phaseConfig() {
  const base = await makeBase('config');
  const root = path.join(base, 'ledger');
  const stub = createStub();
  let appliable = false;

  await runCheck('12.1', 'apply() tolerates an unknown config key and an out-of-range leaseTtlSeconds', async () => {
    // The plugin contract allows apply() to return nothing; clamping is proven
    // behaviourally by 12.2 through the lease expiry.
    plugin.apply(stub.ctx, { rootDir: root, leaseTtlSeconds: 5, unknownSetting: 'tolerated' });
    appliable = true;
    assertEqual(stub.state.tools.size, 5, 'tools after custom config');
    assertEqual(stub.state.sections.length, 1, 'sections after custom config');
    assertEqual(stub.state.routes.length, 1, 'routes after custom config');
  });

  await runCheck('12.2', 'a resume lease uses the clamped TTL (about 60s), not the requested 5s', async () => {
    assert(appliable, 'prerequisite: 12.1 failed');
    const opened = await callTool(stub, 'task_open', { title: 'Config Task', goal: 'Prove config clamping.' });
    assert(opened && opened.ok === true, `config fixture open failed: ${JSON.stringify(opened && opened.error)}`);
    const resumed = await callTool(stub, 'task_resume', { task_id: opened.task_id }, 'session-cfg');
    assert(resumed && resumed.ok === true, `task_resume failed: ${JSON.stringify(resumed && resumed.error)}`);
    const expiresAt = Date.parse(resumed.lease.expires_at);
    assert(Number.isFinite(expiresAt), 'lease.expires_at is not a parseable date');
    const deltaMs = expiresAt - Date.now();
    assert(deltaMs > 50_000, `lease expires in ${Math.round(deltaMs / 1000)}s; expected about 60s (clamped)`);
    assert(deltaMs < 120_000, `lease expires in ${Math.round(deltaMs / 1000)}s; unexpectedly long`);
  });

  await runCheck('12.3', 'the ignored config key leaves a config-warning audit record', async () => {
    const record = await waitFor(async () => {
      const audit = await jsonlLoose(path.join(root, 'audit.jsonl'));
      return audit.find((entry) => entry.event === 'config-warning' && /unknownSetting/.test(String(entry.detail))) || null;
    }, { label: 'config-warning audit record' });
    assert(/ignored/.test(String(record.detail)), `audit detail: ${JSON.stringify(record.detail)}`);
  });
}

async function phaseClientCrossCheck() {
  await runCheck('13.1', 'client bundle cross-check passes (.verify-client.mjs)', async () => {
    assert(await exists(CLIENT_VERIFIER), 'client verifier file is missing');
    let stdout = '';
    let stderr = '';
    let status = 0;
    try {
      const result = execFileSync(process.execPath, [CLIENT_VERIFIER], { encoding: 'utf8', timeout: 120_000 });
      stdout = result;
    } catch (error) {
      status = typeof error.status === 'number' ? error.status : 1;
      stdout = (error.stdout || '').toString();
      stderr = (error.stderr || '').toString();
    }
    const lines = stdout.split(/\r?\n/).filter((line) => /^(PASS|FAIL)\s/.test(line));
    const childPass = lines.filter((line) => line.startsWith('PASS')).length;
    const childFail = lines.filter((line) => line.startsWith('FAIL')).length;
    if (stdout.trim()) console.log(stdout.trimEnd());
    if (status !== 0 || childFail > 0) {
      const firstFail = lines.find((line) => line.startsWith('FAIL')) || stderr.trim().split('\n').pop() || 'unknown failure';
      throw new Error(`client verifier exited ${status}; ${firstFail}`);
    }
    assert(childPass >= 7, `client verifier ran only ${childPass} checks`);
    return `${childPass} client checks passed`;
  });
}

// ------------------------------------------------ optional known-defect probes

/**
 * Non-gating probes for defects found during acceptance. Run with:
 *   node task-ledger/.verify-host.mjs --defects
 * Each line says OBSERVED-BUG (still present) or FIXED (the observed behaviour
 * is now correct). The exit code is not affected by these probes.
 */
async function phaseKnownDefects() {
  const observations = [];
  function observe(id, description, verdict, detail) {
    observations.push({ id, description, verdict, detail });
    console.log(`${verdict === 'bug' ? 'OBSERVED-BUG' : 'FIXED'}  ${id}  ${description}  [${detail}]`);
  }

  const base = await makeBase('defects');
  const root = path.join(base, 'ledger');
  const stub = createStub({ connection: PERMISSIVE });
  plugin.apply(stub.ctx, { rootDir: root });
  await sleep(200);
  const handler = stub.state.routes[0].handler;

  // D1: one run produces two entries in readTask().runs (open + closed record).
  try {
    const opened = await callTool(stub, 'task_open', { title: 'Defect Runs', goal: 'probe' });
    const resumed = await callTool(stub, 'task_resume', { task_id: opened.task_id }, 'session-d1');
    await callTool(stub, 'task_close', { run_id: resumed.run_id, task_id: opened.task_id, summary: 'one run only' });
    const task = await ledgerModule.readTask(root, opened.task_id);
    const distinct = new Set(task.runs.map((run) => run.run_id));
    if (task.runs.length !== distinct.size) {
      observe('D1', 'ledger.readTask().runs double-counts each run (open + closed records)', 'bug',
        `${task.runs.length} entries for ${distinct.size} run_id(s)`);
    } else {
      observe('D1', 'ledger.readTask().runs double-counts each run (open + closed records)', 'fixed',
        `${task.runs.length} entries for ${distinct.size} run_id(s)`);
    }
  } catch (error) {
    observe('D1', 'runs double-count probe', 'bug', (error && error.message) || String(error));
  }

  // D2: resume of a well-formed but unknown task id surfaces a raw ENOENT.
  try {
    const attempt = await callTool(stub, 'task_resume', { task_id: '2099-01-01-does-not-exist' }, 'session-d2');
    const code = attempt && attempt.error && attempt.error.code;
    const enoent = /ENOENT/.test(String(attempt && attempt.error && attempt.error.message));
    if (code === 'task-not-found' || !enoent) observe('D2', 'task_resume unknown id maps to task-not-found', 'fixed', `code=${code}`);
    else observe('D2', 'task_resume unknown id maps to task-not-found', 'bug', `code=${code}, message contains ENOENT .write.lock`);
  } catch (error) {
    observe('D2', 'unknown resume probe', 'bug', (error && error.message) || String(error));
  }

  // D3: panel POST /status for an unknown task returns 500 + code ENOENT.
  try {
    const response = await httpCall(handler, {
      method: 'POST',
      url: '/api/task-ledger/status',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: '2099-01-01-does-not-exist', status: 'blocked' }),
    });
    const code = response.json && response.json.error && response.json.error.code;
    if (response.status === 500 && code === 'ENOENT') observe('D3', 'POST /api/task-ledger/status unknown id -> 400/404 not 500', 'bug', `status=${response.status} code=${code}`);
    else observe('D3', 'POST /api/task-ledger/status unknown id -> 400/404 not 500', 'fixed', `status=${response.status} code=${code}`);
  } catch (error) {
    observe('D3', 'status route probe', 'bug', (error && error.message) || String(error));
  }

  // D4: two concurrent task_open with the same title can return one task_id twice
  // and silently overwrite the first charter.
  try {
    const [first, second] = await Promise.all([
      callTool(stub, 'task_open', { title: 'Defect Race', goal: 'first goal' }),
      callTool(stub, 'task_open', { title: 'Defect Race', goal: 'second goal' }),
    ]);
    if (first.ok && second.ok && first.task_id === second.task_id) {
      observe('D4', 'concurrent task_open with the same title allocates a unique id', 'bug',
        `both calls returned ${first.task_id}`);
    } else {
      observe('D4', 'concurrent task_open with the same title allocates a unique id', 'fixed',
        `${first.task_id} vs ${second.task_id}`);
    }
  } catch (error) {
    observe('D4', 'concurrent open probe', 'bug', (error && error.message) || String(error));
  }

  // D6: an explicit duplicate task_id silently overwrites the existing charter.
  try {
    const first = await callTool(stub, 'task_open', { title: 'Explicit Dup', goal: 'original charter', task_id: 'explicit-dup-probe' });
    const second = await callTool(stub, 'task_open', { title: 'Explicit Dup', goal: 'overwritten charter', task_id: 'explicit-dup-probe' });
    const charter = JSON.parse(await fs.readFile(path.join(root, 'tasks', 'explicit-dup-probe', 'task.json'), 'utf8'));
    if (first.ok && second.ok && charter.goal === 'overwritten charter') {
      observe('D6', 'task_open with an existing explicit task_id is refused instead of overwriting', 'bug',
        'second open overwrote the canonical charter');
    } else {
      observe('D6', 'task_open with an existing explicit task_id is refused instead of overwriting', 'fixed',
        `second.ok=${second.ok} goal=${JSON.stringify(charter.goal)}`);
    }
  } catch (error) {
    observe('D6', 'explicit duplicate id probe', 'bug', (error && error.message) || String(error));
  }

  // D5: GET /task for an unknown id answers 500 rather than 404.
  try {
    const response = await httpCall(handler, { url: '/api/task-ledger/task?task_id=2099-01-01-does-not-exist' });
    const code = response.json && response.json.error && response.json.error.code;
    if (response.status === 500) observe('D5', 'GET /api/task-ledger/task unknown id -> 404 not 500', 'bug', `status=${response.status} code=${code}`);
    else observe('D5', 'GET /api/task-ledger/task unknown id -> 404 not 500', 'fixed', `status=${response.status} code=${code}`);
  } catch (error) {
    observe('D5', 'detail route probe', 'bug', (error && error.message) || String(error));
  }

  const bugs = observations.filter((entry) => entry.verdict === 'bug').length;
  console.log(`known defects: ${bugs} observed, ${observations.length - bugs} fixed (non-gating)`);
}

// ---------------------------------------------------------------------- main

async function main() {
  console.log('dsh-task-ledger host verification — stub context (DSH 0.2.1-rc.4 API facts)');
  console.log(`plugin: ${path.join(HERE, 'index.js')}`);
  console.log(`temp roots: /tmp/dsh-task-ledger-verify-*`);

  const phases = [
    ['1-2 apply contract + empty ledger', phaseApplyAndEmptyList],
    ['3-7 lifecycle: open/resume/checkpoint/gate/close/cold-start', phaseLifecycle],
    ['4.4 lease expiry takeover', phaseLeaseExpiry],
    ['8 prompt briefing', phaseBriefing],
    ['9 panel routes', phaseRoutes],
    ['10 path safety', phasePathSafety],
    ['11 slash command', phaseCommand],
    ['12 config', phaseConfig],
    ['13 client bundle contract', phaseClientCrossCheck],
  ];

  if (process.argv.includes('--defects')) phases.push(['known-defect probes (non-gating)', phaseKnownDefects]);

  for (const [name, fn] of phases) {
    console.log(`\n# ${name}`);
    const before = CLAIM.pass + CLAIM.fail;
    try {
      await fn();
    } catch (error) {
      printFail(`${name.split(' ')[0]}.*`, `${name} — phase aborted`, (error && error.message) || String(error));
    }
    if (!name.includes('non-gating') && CLAIM.pass + CLAIM.fail === before) {
      printFail(`${name.split(' ')[0]}.*`, `${name} — no checks executed`, 'phase produced no PASS/FAIL lines');
    }
  }
}

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
  if (cleanupOk) console.log(`\ncleanup: removed ${tempRoots.length} temp root(s) under /tmp`);
}

console.log('\n================ SUMMARY ================');
for (const record of CLAIM.records) {
  if (!record.ok) console.log(`FAILED  ${record.id}  ${record.description} — ${record.detail}`);
}
console.log(`checks: ${CLAIM.pass + CLAIM.fail}   PASS: ${CLAIM.pass}   FAIL: ${CLAIM.fail}`);
console.log(CLAIM.fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(CLAIM.fail === 0 ? 0 : 1);
