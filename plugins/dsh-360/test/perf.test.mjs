/**
 * Performance-guard tests for the two hot paths of the agents surface:
 *
 *   1. the optimized conflict detector must produce exactly the same entries
 *      as the original pair-major algorithm (brute-force reference below);
 *   2. collectUsage must single-flight concurrent callers, reuse its digest for
 *      a short TTL, and expose clearUsageCache() for tests/benchmarks.
 *
 * The reference implementation is a literal copy of the pre-optimization
 * algorithm: it is intentionally O(n²) and only used on small synthetic bodies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectConflicts } from '../lib/agents/conflicts.js';
import { collectUsage, clearUsageCache } from '../lib/usage.js';
import { jaccard, normalizeText, overlapTokens } from '../lib/util.js';

// ---------------------------------------------------------------- reference

const RULE_LINE_RE = /(必须|不要|禁止|只用|always|never|must|should|avoid|don'?t|先[^，。]{0,12}再)/i;
const NEGATIVE_RE = /(不要|禁止|别|严禁|不得|不该|never|avoid|don'?t|must\s+not|should\s+not|do\s+not)/i;
const POSITIVE_RE = /(必须|一定|只用|always|must|should|先[^，。]{0,12}再)/i;

function referenceRuleLines(body) {
  return String(body).split('\n')
    .map((line, index) => ({ text: normalizeText(line), line: index + 1 }))
    .filter((entry) => entry.text.length >= 6 && entry.text.length <= 240
      && !/^#/.test(entry.text) && RULE_LINE_RE.test(entry.text));
}

function referenceStripPolarity(text) {
  return text
    .replace(/(必须|一定要|一定|只用|不要|禁止|千万别|别|严禁|不得|不该)/g, ' ')
    .replace(/\b(always|never|must\s+not|must|should\s+not|should|avoid|don'?t|do\s+not)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The pre-optimization O(n²) detector, verbatim in behavior. */
function referenceDetectConflicts(reports) {
  const list = (reports || []).filter((report) => report && typeof report.body === 'string' && report.id);
  const duplicates = new Map();
  const contradictions = new Map();

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const linesA = referenceRuleLines(a.body);
      const linesB = referenceRuleLines(b.body);
      if (!linesA.length || !linesB.length) continue;

      const aByText = new Map(linesA.map((entry) => [entry.text.toLowerCase(), entry]));
      for (const entryB of linesB) {
        const entryA = aByText.get(entryB.text.toLowerCase());
        if (!entryA) continue;
        const key = entryA.text.toLowerCase();
        const existing = duplicates.get(key);
        if (existing) {
          existing.count += 1;
          existing.subjects.add(a.id);
          existing.subjects.add(b.id);
          continue;
        }
        duplicates.set(key, {
          a: a.id, b: b.id, ruleA: entryA.text, ruleB: entryB.text,
          kind: 'duplicate', ratio: 1, lineA: entryA.line, lineB: entryB.line,
          count: 1, subjects: new Set([a.id, b.id]),
        });
      }

      for (const entryA of linesA) {
        const objectA = referenceStripPolarity(entryA.text);
        const polarA = NEGATIVE_RE.test(entryA.text) ? 'neg' : POSITIVE_RE.test(entryA.text) ? 'pos' : null;
        if (!objectA || objectA.length < 4 || !polarA) continue;
        for (const entryB of linesB) {
          const objectB = referenceStripPolarity(entryB.text);
          const polarB = NEGATIVE_RE.test(entryB.text) ? 'neg' : POSITIVE_RE.test(entryB.text) ? 'pos' : null;
          if (!objectB || objectB.length < 4 || !polarB) continue;
          if (polarA === polarB) continue;
          const ratio = jaccard(overlapTokens(objectA), overlapTokens(objectB));
          if (ratio < 0.4) continue;
          const key = [objectA, objectB].sort().join('\u0000');
          const existing = contradictions.get(key);
          if (existing) {
            existing.count += 1;
            existing.subjects.add(a.id);
            existing.subjects.add(b.id);
            continue;
          }
          contradictions.set(key, {
            a: a.id, b: b.id, ruleA: entryA.text, ruleB: entryB.text,
            kind: 'contradiction', ratio: Math.round(ratio * 1000) / 1000,
            lineA: entryA.line, lineB: entryB.line,
            count: 1, subjects: new Set([a.id, b.id]),
          });
        }
      }
    }
  }

  const materialize = (entry) => {
    const subjects = [...entry.subjects].sort();
    return { ...entry, subjects, count: subjects.length };
  };
  return [...duplicates.values()].map(materialize).concat([...contradictions.values()].map(materialize));
}

function stableKey(entry) {
  return JSON.stringify([
    entry.kind, entry.a, entry.b, entry.ruleA, entry.ruleB,
    entry.lineA, entry.lineB, entry.ratio, entry.count, entry.subjects,
  ]);
}

function sortEntries(entries) {
  return entries
    .map((entry) => ({ ...entry, subjects: [...entry.subjects].sort() }))
    .sort((left, right) => (stableKey(left) < stableKey(right) ? -1 : stableKey(left) > stableKey(right) ? 1 : 0));
}

/** A corpus that hits duplicates (3+ owners, case variants, repeated lines)
 *  and contradictions (equal objects, partial Jaccard, merged group keys). */
function syntheticCorpus() {
  return [
    {
      id: 'instr:a',
      body: [
        '# A',
        '# 必须先跑测试（heading is not a rule line）',
        '必须短',
        '必须先跑测试再提交代码。',
        '',
        '必须先跑测试再提交代码。',
        '不要删除 node_modules 目录。',
        'Always run tests before merge.',
        '必须 alpha beta gamma',
        `必须 ${'x'.repeat(300)}`,
      ].join('\n'),
    },
    {
      id: 'instr:b',
      body: [
        '# B',
        '必须先跑测试再提交代码。',
        '必须删除 node_modules 目录。',
        'Never run tests before merge.',
        '不要 alpha beta delta',
        '必须 alpha beta delta',
      ].join('\n'),
    },
    {
      id: 'instr:c',
      body: [
        '# C',
        '必须先跑测试再提交代码。',
        '必须 alpha beta delta',
      ].join('\n'),
    },
    {
      id: 'instr:d',
      body: [
        '# D',
        '不要 alpha beta gamma',
        'always run tests before merge.',
      ].join('\n'),
    },
    {
      id: 'instr:e',
      body: [
        '# E',
        '必须先跑测试再提交代码。',
      ].join('\n'),
    },
    {
      // ratio exactly 0.4 with instr:a's 3-token rule, plus a below-threshold
      // pair that shares tokens but must be rejected.
      id: 'instr:f',
      body: [
        '# F',
        '不要 alpha beta delta epsilon',
        '不要 alpha epsilon zeta eta',
      ].join('\n'),
    },
    {
      // Size-asymmetric pair (3 tokens vs 6, Jaccard 0.5): guards the
      // necessary size bound used to skip hopeless contradiction pairs.
      id: 'instr:g',
      body: [
        '# G',
        '必须 alpha beta gamma delta epsilon zeta',
      ].join('\n'),
    },
  ];
}

// ------------------------------------------------------------------- tests

test('conflicts: optimized detector equals the brute-force reference', () => {
  const reports = syntheticCorpus();
  const expected = sortEntries(referenceDetectConflicts(reports));
  const actual = sortEntries(detectConflicts(reports));

  const kinds = expected.reduce((map, entry) => {
    map[entry.kind] = (map[entry.kind] || 0) + 1;
    return map;
  }, {});
  assert.ok(kinds.duplicate >= 2, `corpus must exercise duplicates (${JSON.stringify(kinds)})`);
  assert.ok(kinds.contradiction >= 2, `corpus must exercise contradictions (${JSON.stringify(kinds)})`);
  assert.ok(expected.some((entry) => entry.count >= 3), 'corpus must exercise a 3+ owner group');
  assert.ok(expected.some((entry) => entry.kind === 'contradiction' && entry.ratio === 0.4),
    'corpus must exercise the exact 0.4 Jaccard boundary');
  assert.ok(expected.some((entry) => entry.kind === 'contradiction' && entry.ratio === 0.5
    && entry.ruleB === '必须 alpha beta gamma delta epsilon zeta'),
  'corpus must exercise a size-asymmetric 3-vs-6 contradiction');

  assert.deepEqual(actual, expected);
  for (const entry of actual) {
    assert.equal(entry.count, entry.subjects.length);
    assert.deepEqual(entry.subjects, [...entry.subjects].sort());
  }

  // Deterministic: a second run returns the same order and values.
  assert.deepEqual(sortEntries(detectConflicts(reports)), actual);
});

test('conflicts: pathological duplicate subject ids keep pair semantics', () => {
  const reports = [
    { id: 'same:id', body: '# A\n\n只允许同一条规则。\n' },
    { id: 'same:id', body: '# B\n\n只允许同一条规则。\n' },
    { id: 'instr:other', body: '# C\n\n只允许另一条规则。\n' },
  ];
  assert.deepEqual(sortEntries(detectConflicts(reports)), sortEntries(referenceDetectConflicts(reports)));
});

test('usage: concurrent calls share one scan, cache hits skip the filesystem', async () => {
  clearUsageCache();
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-perf-usage-'));
  const session = join(dir, 'sess-1');
  await mkdir(session, { recursive: true });
  const now = Date.now();
  const lines = [
    { type: 'session', time: now - 2000, cwd: '/perf', agentPreset: 'router', createdAt: now - 2000 },
    { type: 'user/message', time: now - 1000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'load alpha' }] } },
    { type: 'tool/call', time: now, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
  ].map((line) => JSON.stringify(line)).join('\n');
  const file = join(session, 'session.v4.jsonl');
  await writeFile(file, lines);

  try {
    const options = { sessionsDir: dir, windowDays: 30, now };
    const first = collectUsage(options);
    const second = collectUsage(options);
    assert.equal(first, second, 'concurrent callers must share one promise/scan');

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b, 'both callers receive the same digest object');
    assert.equal(a.sessionsScanned, 1);
    assert.equal(a.bySkill.alpha.count, 1);

    // Removing the log cannot change a cached digest: no second parse happened.
    await rm(file);
    const cached = await collectUsage(options);
    assert.equal(cached, a, 'TTL cache returns the same immutable digest');
    assert.equal(cached.sessionsScanned, 1, 'cache hit did not re-read the directory');

    // clearUsageCache() forces a fresh scan and a new digest object.
    clearUsageCache();
    const fresh = await collectUsage(options);
    assert.notEqual(fresh, a);
    assert.equal(fresh.sessionsScanned, 0, 'after reset the removed log is gone');
  } finally {
    clearUsageCache();
    await rm(dir, { recursive: true, force: true });
  }
});
