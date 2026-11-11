import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildEffect,
  clearSnapshotLastApply,
  mergeEffects,
  readLastApply,
  readSnapshot,
  toSnapshot,
  writeLastApply,
  writeSnapshot,
} from '../lib/client-cache.js';

const RANKS = { S: 1, A: 4, B: 7, 'B-': 8, C: 10, D: 13, E: 16 };

function report(name, total, grade, estTokens) {
  return {
    name,
    id: `agent:${name}`,
    kind: 'agent',
    score: { total, grade, letter: grade[0], rank: RANKS[grade] ?? 10, confidence: 0.8, delta: 1.2 },
    verdict: { code: 'keep', label: '保留' },
    metrics: { estTokens, referenceCount: 2 },
    usage: { count: 2, sufficient: true, lastUsedAt: 1 },
    evolution: { applicable: true, lessons: { count: 1 }, pending: { hasUnclosed: false } },
    classification: {
      role: { id: 'review', label: '审查验证' },
      kind: { id: 'layered', label: '分层参考' },
      scope: { id: 'global', label: '全局' },
      state: [{ id: 'active', label: '在用' }],
      summary: '审查代码',
      tags: ['role:review'],
    },
    body: 'x'.repeat(5000),
    findings: [{ id: 'f', title: '问题' }],
    suggestions: [{ id: 's' }],
  };
}

test('toSnapshot keeps classification and strips heavy fields', () => {
  const portfolio = {
    generatedAt: 1,
    totals: { skills: 1, byRole: { review: 1 } },
    taxonomy: { version: 1, axes: [] },
    lastApply: { items: 1 },
    skills: [report('alpha', 80, 'A', 900)],
    subjects: [report('beta', 60, 'C', 1200)],
    extra: 'drop me',
  };
  const snapshot = toSnapshot(portfolio);
  assert.equal(snapshot.generatedAt, 1);
  assert.deepEqual(snapshot.totals, { skills: 1, byRole: { review: 1 } });
  assert.equal(snapshot.extra, undefined, 'allow-list drops unknown top-level keys');
  for (const item of [...snapshot.skills, ...snapshot.subjects]) {
    assert.equal(item.body, undefined, 'body is not in the list snapshot');
    assert.equal(item.findings, undefined, 'findings come from the detail route');
    assert.equal(item.suggestions, undefined);
    assert.equal(item.metrics, undefined);
    assert.equal(item.classification.role.id, 'review', 'classification survives');
    assert.deepEqual(item.classification.tags, ['role:review']);
    assert.equal(item.usage.count, 2);
    assert.equal(item.evolution.lessons.count, 1);
  }
});

test('snapshot round-trip marks stale and carries cachedAt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-snapshot-'));
  try {
    const path = join(dir, 'cache', 'skills-portfolio.json');
    await writeSnapshot(path, { generatedAt: 2, skills: [report('alpha', 80, 'A', 900)] });
    const stored = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(stored.skills.length, 1);
    assert.equal(stored.stale, undefined, 'stale is added on read, not stored');
    const snapshot = await readSnapshot(path);
    assert.equal(snapshot.stale, true);
    assert.equal(typeof snapshot.cachedAt, 'number');
    assert.equal(snapshot.generatedAt, 2);
    assert.equal(await readSnapshot(join(dir, 'missing.json')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('lastApply round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-lastapply-'));
  try {
    const path = join(dir, 'cache', 'skills-last-apply.json');
    assert.equal(await readLastApply(path), null);
    await writeLastApply(path, { surface: 'skills', items: 1, delta: 5 });
    assert.deepEqual(await readLastApply(path), { surface: 'skills', items: 1, delta: 5 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildEffect reports score/token delta and grade-ups', () => {
  const before = report('alpha', 60, 'C', 1000);
  const after = report('alpha', 70, 'B-', 800);
  const effect = buildEffect({ surface: 'skills', targets: [{ key: 'alpha', before, after }], at: 9 });
  assert.equal(effect.surface, 'skills');
  assert.equal(effect.at, 9);
  assert.equal(effect.items, 1);
  assert.equal(effect.scoreBefore, 60);
  assert.equal(effect.scoreAfter, 70);
  assert.equal(effect.delta, 10);
  assert.equal(effect.tokensBefore, 1000);
  assert.equal(effect.tokensAfter, 800);
  assert.equal(effect.tokensSaved, 200);
  assert.equal(effect.gradeUps, 1);
  assert.equal(effect.targets[0].key, 'alpha');
});

test('mergeEffects folds per-target effects (item-weighted score, summed tokens)', () => {
  const one = buildEffect({
    surface: 'agents',
    targets: [{ key: 'a', before: report('a', 60, 'C', 1000), after: report('a', 70, 'B-', 1000) }],
    at: 1,
  });
  const two = buildEffect({
    surface: 'agents',
    targets: [{ key: 'b', before: report('b', 50, 'D', 500), after: report('b', 50, 'D', 400) }],
    at: 2,
  });
  const merged = mergeEffects('agents', [one, two], 3);
  assert.equal(merged.items, 2);
  assert.equal(merged.scoreBefore, 55);
  assert.equal(merged.scoreAfter, 60);
  assert.equal(merged.delta, 5);
  assert.equal(merged.tokensBefore, 1500);
  assert.equal(merged.tokensAfter, 1400);
  assert.equal(merged.tokensSaved, 100);
  assert.equal(merged.gradeUps, 1);
  assert.equal(merged.targets.length, 2);
  assert.equal(mergeEffects('agents', []), null);
});

test('concurrent snapshot writes are serialized and newest generatedAt wins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-race-'));
  try {
    const path = join(dir, 'cache', 'agents-portfolio.json');
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeSnapshot(path, {
      generatedAt: 1000 + index,
      subjects: [report(`r${index}`, 60 + index, 'C', 1000)],
    })));
    const snapshot = await readSnapshot(path);
    assert.ok(snapshot, 'snapshot exists after concurrent writes');
    assert.equal(snapshot.generatedAt, 1019, 'the newest scan wins');
    assert.equal(snapshot.subjects[0].name, 'r19');
    // A slower/older scan must not repaint over the newer snapshot.
    await writeSnapshot(path, { generatedAt: 5, subjects: [report('old', 1, 'E', 10)] });
    assert.equal((await readSnapshot(path)).generatedAt, 1019);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clearSnapshotLastApply removes the stale effect but keeps the list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-clear-'));
  try {
    const path = join(dir, 'cache', 'skills-portfolio.json');
    await writeSnapshot(path, {
      generatedAt: 7,
      lastApply: { items: 2, backupIds: ['bk-1', 'bk-2'] },
      skills: [report('alpha', 80, 'A', 900)],
    });
    await clearSnapshotLastApply(path);
    const snapshot = await readSnapshot(path);
    assert.equal(snapshot.lastApply, null);
    assert.equal(snapshot.generatedAt, 7, 'list data survives');
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.stale, true, 'still served through the stale path');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
