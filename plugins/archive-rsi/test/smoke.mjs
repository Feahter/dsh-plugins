#!/usr/bin/env node
/**
 * Minimal regression harness for dsh-archive-rsi (the plugin shipped with no
 * tests; `.verify-host.mjs` is a 3k-line acceptance script, too slow/broad to
 * run as a smoke check).
 *
 * Covers the pure projections and the two store invariants that are easy to
 * regress: sync idempotency, corrupt-session containment, and the
 * `baselines.json` read-modify-write serialization.
 *
 * Usage: node test/smoke.mjs   (exit code 0 = all checks passed)
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ArchiveStore,
  computeFacts,
  deriveAutoTags,
  mergeTags,
  scanZstdFrames,
} from '../archive.js';
import { cohortMetrics, median, percentile, planProposals } from '../alchemy.js';

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    fail += 1;
    console.log(`FAIL ${name}\n     ${(error && error.stack) || error}`);
  }
}

// ---------------------------------------------------------------- fixtures

const HEADER = { type: 'session', id: 'sess-smoke', cwd: '/tmp/smoke', createdAt: 1_700_000_000_000 };

function sessionRows() {
  return [
    HEADER,
    { type: 'turn/start', seq: 1, time: 1_700_000_000_100, data: { turn: 0 } },
    {
      type: 'user/message',
      seq: 2,
      time: 1_700_000_000_200,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'please fix the bug' }] },
    },
    {
      type: 'assistant/message',
      seq: 3,
      time: 1_700_000_000_300,
      data: { usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } },
    },
    { type: 'tool/call', seq: 4, time: 1_700_000_000_400, data: { name: 'bash', callId: 'c1', arguments: '{"command":"npm test && npm test"}' } },
    { type: 'tool/result', seq: 5, time: 1_700_000_000_500, data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'turn/end', seq: 6, time: 1_700_000_000_600, data: { turn: 0, reason: { kind: 'completed' } } },
  ];
}

const tempRoots = [];

async function makeStore() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-rsi-smoke-'));
  tempRoots.push(base);
  const sessions = path.join(base, 'sessions');
  const dir = path.join(sessions, 'smoke', 'sess-smoke');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'session.v4.jsonl'), sessionRows().map((row) => JSON.stringify(row)).join('\n') + '\n');
  const store = new ArchiveStore({ rootDir: path.join(base, 'archive'), sessionRoots: [sessions], autoTag: false });
  await store.init();
  return { base, sessions, dir, store };
}

// ------------------------------------------------------------------ checks

await check('computeFacts: turns / humans / tools / repeated calls / edits', () => {
  const facts = computeFacts({ header: HEADER, events: sessionRows() });
  assert.equal(facts.counters.turns, 1);
  assert.equal(facts.counters.humanMessages, 1);
  assert.equal(facts.counters.toolCalls, 1);
  assert.equal(facts.tools.find((row) => row.name === 'bash').calls, 1);
  assert.equal(facts.usage.inputTokens, 1000);
  assert.equal(facts.title, 'please fix the bug');
  assert.ok(Array.isArray(facts.humanTexts));
});

await check('computeFacts: malformed events degrade instead of throwing', () => {
  const facts = computeFacts({
    header: null,
    events: [null, 42, {}, { type: 'tool/call', data: { arguments: '{not json' } }, { type: 'user/message', data: { content: 'not-an-array' } }],
  });
  assert.equal(facts.counters.toolCalls, 1);
  assert.equal(facts.tools.find((row) => row.name === 'unknown').calls, 1);
});

await check('scanZstdFrames: a torn tail is reported, not thrown', () => {
  const scan = scanZstdFrames(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  assert.deepEqual(scan.frames, []);
  assert.equal(scan.tornStart, 0);
});

await check('percentile / median: nearest rank, never NaN', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([NaN, 'x'], 0.5), 0);
  assert.equal(median([5, 1, 3]), 3);
});

await check('deriveAutoTags + mergeTags: deterministic, manual tags survive', () => {
  const facts = computeFacts({ header: HEADER, events: sessionRows() });
  const auto = deriveAutoTags(facts, { cohortMedianTokens: 0 });
  assert.deepEqual(auto, deriveAutoTags(facts, { cohortMedianTokens: 0 }));
  const merged = mergeTags(['my-tag'], auto);
  assert.ok(merged.includes('my-tag'));
});

await check('cohortMetrics: empty corpus is all zeros (no NaN)', () => {
  const metrics = cohortMetrics([]);
  const values = Object.values(metrics).filter((value) => typeof value === 'number');
  assert.ok(values.length > 0);
  assert.ok(values.every((value) => Number.isFinite(value)));
});

await check('planProposals: a run with no findings creates nothing', () => {
  const plan = planProposals({ id: 'run-x', findings: [], check: { metrics: {} } }, { existing: [] });
  assert.deepEqual(plan.proposals, []);
});

await check('planProposals: advisory findings are suppressed unless includeAdvisories is set', () => {
  const run = {
    id: 'run-adv',
    act: {
      findings: [
        {
          id: 'f-R1-1',
          rule: 'R1',
          severity: 'high',
          title: 'Tool "edit" fails 26.6% of calls',
          detail: '107 of 402 calls to edit failed.',
          metric: 'toolErrorRate',
          evidence: [],
          tool: 'edit',
          count: 107,
          advice: 'Rewrite the tool description.',
        },
      ],
    },
  };
  const byDefault = planProposals(run, { existing: [] });
  assert.deepEqual(byDefault.proposals, []);
  assert.equal(byDefault.suppressed.length, 1);
  assert.equal(byDefault.suppressed[0].reason, 'advisory-not-adoptable');
  const legacy = planProposals(run, { existing: [], includeAdvisories: true });
  assert.equal(legacy.proposals.length, 1);
  assert.equal(legacy.proposals[0].kind, 'advisory');
  assert.deepEqual(legacy.suppressed, []);
});

await check('sync: idempotent (second pass is skipped)', async () => {
  const { store } = await makeStore();
  const first = await store.sync();
  assert.equal(first.imported, 1);
  assert.equal(first.failed.length, 0);
  const second = await store.sync();
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);
});

await check('sync: one corrupt session is reported, other sessions still import', async () => {
  const { sessions, store } = await makeStore();
  const badDir = path.join(sessions, 'smoke', 'sess-bad');
  await fs.mkdir(badDir, { recursive: true });
  // No session header row at all: decodeBytes rejects this file.
  await fs.writeFile(path.join(badDir, 'session.v4.jsonl'), '{"broken\n');
  const result = await store.sync();
  assert.equal(result.imported, 1);
  assert.equal(result.failed.length, 1);
});

await check('saveBaseline: concurrent writes do not lose entries', async () => {
  const { store } = await makeStore();
  await Promise.all(Array.from({ length: 25 }, (_, index) => store.saveBaseline(`run-${index}`, { index })));
  const baselines = await store.readBaselines();
  assert.equal(Object.keys(baselines).length, 25);
});

for (const base of tempRoots) await fs.rm(base, { recursive: true, force: true });

console.log(`\narchive-rsi smoke: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
