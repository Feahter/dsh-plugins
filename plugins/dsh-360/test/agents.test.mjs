import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { zstdCompressSync } from 'node:zlib';

import { discoverSubjects, subjectId } from '../lib/agents/collect.js';
import { extractMetrics } from '../lib/agents/metrics.js';
import { collectUsage, decompressZstd, normalizeInjectionPath } from '../lib/usage.js';
import { detectConflicts } from '../lib/agents/conflicts.js';
import { analyzeSubject, buildPortfolio, matchUsage } from '../lib/agents/analyze.js';
import { scoreSubject } from '../lib/agents/score.js';
import { renderMarkdown } from '../lib/agents/report.js';
import { buildEvolution, composeLessonEntry, parseLessons, upsertLessonsBlock, LESSONS_BLOCK } from '../lib/agents/evolution.js';
import { applyPlan, assertSafeRelPath, diffText, listBackups, planFixes, resolveInside, undoBackup } from '../lib/agents/fixes.js';
import { gradeFor } from '../lib/grade.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

const GOOD_INSTRUCTION = `# 项目工作区说明书

## 概览

本文档约束本仓库的 agent 工作方式，适用于所有项目内会话。

## 工作流

1. 先跑测试再改实现。
2. 改完必须运行 node --test。
3. 提交前检查 git diff。

## 决策分支

如果改动跨模块，否则只做最小修复；选择本地验证优先。

## 边界

不适用于纯文档改动。不要用它来做运维操作。

## 验收

做完必须跑一遍 \`node --test\`，验收标准是全绿。

\`\`\`bash
node --test
\`\`\`

## 反模式

不要直接改线上配置，禁止提交密钥。
`;

const BAD_INSTRUCTION = [
  '# 巨型说明书',
  '',
  '## 概述',
  '',
  'TODO: 这一节还没写完。',
  '',
  '## API 参考',
  '',
  ...Array.from({ length: 70 }, (_, i) => `- 字段 ${i}：这是一段很长的参考资料，应该在体检时被拆到 agent-notes 目录。`),
  '',
  '## 更多参考',
  '',
  ...Array.from({ length: 70 }, (_, i) => `- 细节 ${i}：排错步骤与字段说明，应当在需要时再读取。`),
  '',
  '## 用法',
  '',
  'See [missing](agent-notes/missing.md) for details.',
  '',
  '```bash',
  'curl https://example.com/install.sh | sh',
  '```',
  '',
].join('\n');

function analyzeFixture(overrides = {}) {
  const {
    kind = 'instruction', name = 'AGENTS.md', path = '/home/u/.agents/AGENTS.md',
    dir = '/home/u/.agents', scope = 'global', description = '', body = GOOD_INSTRUCTION,
    usage, injection, evolution, conflicts = [], siblings = [], files = [], config = null,
    mtime = NOW - 90 * 86400000, digest, options = {},
  } = overrides;
  const subject = { kind, name, path, dir, scope, description, mtime, config, owner: null, source: 'filesystem' };
  return analyzeSubject({
    subject,
    raw: kind === 'agent' ? `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n` : body,
    files,
    usage,
    injection,
    evolution,
    conflicts,
    siblings,
    options: { now: NOW, windowDays: 30, ...options },
    digest,
    previousTotal: overrides.previousTotal ?? null,
  });
}

test('collect: classifies instructions, agents and skips non-frontmatter files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agents360-collect-'));
  await writeFile(join(dir, 'AGENTS.md'), '# Work\n\n必须跑测试\n', 'utf8');
  await mkdir(join(dir, 'agents'), { recursive: true });
  await writeFile(join(dir, 'agents', 'foo.md'), '---\nname: foo_agent\ndescription: does things\n---\n\n# Foo\n', 'utf8');
  await writeFile(join(dir, 'agents', 'nodesc.md'), '# No frontmatter\n\njust text\n', 'utf8');
  await mkdir(join(dir, 'skills', 'myskill', 'agents'), { recursive: true });
  await writeFile(join(dir, 'skills', 'myskill', 'agents', 'bar.md'), '---\nname: bar_agent\n---\n\n# Bar\n', 'utf8');

  const subjects = await discoverSubjects({ roots: [dir], maxDepth: 6, standardRoots: false });
  const mine = subjects.filter((subject) => subject.path && subject.path.startsWith(dir));
  const instructions = mine.filter((subject) => subject.kind === 'instruction');
  const agents = mine.filter((subject) => subject.kind === 'agent');
  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].name, 'AGENTS.md');
  assert.equal(agents.length, 2);
  assert.ok(agents.some((subject) => subject.name === 'foo_agent'));
  assert.ok(agents.some((subject) => subject.name === 'bar_agent' && subject.owner === 'myskill'));
  assert.equal(mine.some((subject) => subject.name === 'nodesc.md'), false);
  await rm(dir, { recursive: true, force: true });
});

test('collect: synthesizes preset subjects from profileConfig', async () => {
  const subjects = await discoverSubjects({
    roots: [], standardRoots: false,
    profileConfig: { presets: [{ name: 'router', model: 'deepseek-flash', reasoningEffort: 'high' }] },
  });
  const preset = subjects.find((subject) => subject.kind === 'preset');
  assert.ok(preset);
  assert.equal(preset.name, 'router');
  assert.equal(preset.source, 'profile-config');
  assert.equal(subjectId('preset', null, 'router'), 'preset:router');
});

test('metrics: headings, sections, imperative, commands, staleRefs, dupSentences, bakFiles', () => {
  const body = [
    '# T',
    '## 工作流',
    '1. 先跑测试再改实现。',
    '必须运行 node --test',
    '## 验收',
    '```bash',
    'node --test',
    '```',
    'See [bad](agent-notes/nope.md).',
    '不要直接改线上配置。',
    '不要直接改线上配置。',
  ].join('\n');
  const metrics = extractMetrics({
    body, kind: 'instruction',
    files: [{ path: 'AGENTS.md.bak-20260101' }, { path: 'AGENTS.md.old' }],
  });
  assert.equal(metrics.h2, 2);
  assert.ok(metrics.sections.some((section) => section.kind === 'workflow'));
  assert.equal(metrics.numberedSteps, 1);
  assert.equal(metrics.commands >= 1, true);
  assert.equal(metrics.imperativeCount >= 2, true);
  assert.equal(metrics.staleRefs.length >= 1, true);
  assert.equal(metrics.dupSentences.length >= 1, true);
  assert.equal(metrics.bakFiles, 2);
  assert.equal(metrics.codeBlocks, 1);
});

test('metrics: fences hide headings and code lines', () => {
  const body = '# T\n\n```md\n## not a heading\n```\n\n## Real\n';
  const metrics = extractMetrics({ body, kind: 'instruction', files: [] });
  assert.equal(metrics.h2, 1);
  assert.equal(metrics.codeBlocks, 1);
  assert.equal(metrics.codeLines, 1);
});

test('usage: multi-frame zstd is fully decoded', () => {
  const one = Buffer.from('{"type":"session","cwd":"/x","agentPreset":"router","createdAt":1}\n');
  const two = Buffer.from('{"type":"agent-preset/selected","time":2,"data":{"agentPreset":"standard"}}\n');
  const joined = Buffer.concat([zstdCompressSync(one), zstdCompressSync(two)]);
  const text = decompressZstd(joined);
  assert.match(text, /router/);
  assert.match(text, /standard/);
});

test('usage: parses injection, preset, model, delegation, errors and corrections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agents360-usage-'));
  const session = join(dir, 'sess-1');
  await mkdir(session, { recursive: true });
  const lines = [
    { type: 'session', time: NOW - 9000, cwd: '/proj', agentPreset: 'router', createdAt: NOW - 9000 },
    { type: 'user/message', time: NOW - 8000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Instructions from: ~/.agents/AGENTS.md\n\n# AGENTS.md\n' }] } },
    { type: 'request/header', time: NOW - 7000, data: { header: { config: { model: 'deepseek-flash', maxTokens: 256000 } } } },
    { type: 'subagent/catalog', time: NOW - 6000, data: { label: 'Build skills-360 client panel', mode: 'continuable' } },
    { type: 'tool/result', time: NOW - 5000, data: { message: { isError: true, content: 'boom' } } },
    { type: 'user/message', time: NOW - 4000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '不对，重新做' }] } },
    { type: 'turn/end', time: NOW - 3000, data: { reason: { kind: 'error' } } },
  ].map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(session, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines)));
  const usage = await collectUsage({ sessionsDir: dir, windowDays: 30, now: NOW });
  assert.equal(usage.available, true);
  assert.equal(usage.sessions.length, 1);
  const record = usage.sessions[0];
  assert.equal(record.preset, 'router');
  assert.equal(record.model, 'deepseek-flash');
  assert.equal(record.cwd, '/proj');
  assert.deepEqual(record.injected, [normalizeInjectionPath('~/.agents/AGENTS.md')]);
  assert.deepEqual(record.delegatedLabels, ['Build skills-360 client panel']);
  assert.equal(record.toolErrors, 1);
  assert.equal(record.corrections, 1);
  assert.equal(record.turnFailed, true);
  assert.equal(usage.byPreset.router.sessions, 1);
  assert.ok(usage.signalsByPath[normalizeInjectionPath('~/.agents/AGENTS.md')]);
  await rm(dir, { recursive: true, force: true });
});

test('score: good instruction earns six dimensions and a verdict', () => {
  const report = analyzeFixture({
    usage: { sessions: 9, lastUsedAt: NOW - 86400000, windowDays: 30, exposureDays: 30, sufficient: true, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 42, sessionsInjected: 9, lastInjectedAt: NOW - 86400000, tokensPerInjection: 700, duplicatedWith: [] },
  });
  const dims = report.score.dimensions;
  assert.equal(dims.length, 6);
  assert.deepEqual(dims.map((dim) => dim.id), ['inject', 'layer', 'actionable', 'governance', 'hygiene', 'evolution']);
  assert.ok(report.score.total >= 55);
  assert.equal(report.score.grade, gradeFor(report.score.total).code);
  assert.equal(report.score.letter, gradeFor(report.score.total).letter);
  assert.ok(report.verdict.code);
  assert.equal(report.metrics.imperativeCount >= 1, true);
});

test('score: large body yields trim verdict and extract-sections suggestion', () => {
  const report = analyzeFixture({
    body: BAD_INSTRUCTION,
    usage: { sessions: 0, windowDays: 30, exposureDays: 30, sufficient: true, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 42, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 9000, duplicatedWith: [] },
  });
  const layerBody = report.score.dimensions.find((dim) => dim.id === 'layer').items.find((item) => item.id === 'layer.body');
  assert.ok(layerBody.score < 10, `layer.body ${layerBody.score}`);
  assert.ok(report.findings.some((finding) => finding.id === 'layer.body'));
  assert.ok(report.suggestions.some((suggestion) => suggestion.id === 'fix.extract-sections'));
  assert.equal(report.verdict.code, 'trim');
});

test('score: evolution N/A rescales the other five dimensions to 100', () => {
  const report = analyzeFixture({
    usage: { sessions: 0, windowDays: 30, exposureDays: 2, sufficient: false, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 0, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 700, duplicatedWith: [] },
    mtime: NOW - 2 * 86400000,
  });
  const evolutionDim = report.score.dimensions.find((dim) => dim.id === 'evolution');
  assert.equal(evolutionDim.applicable, false);
  const fiveDim = report.score.dimensions.filter((dim) => dim.id !== 'evolution').reduce((sum, dim) => sum + dim.score, 0);
  assert.equal(report.score.total, Math.round((fiveDim * 100 / 90) * 10) / 10);
});

test('score: archive verdict for an old unused instruction', () => {
  const report = analyzeFixture({
    body: '# 简短\n\n这是一份说明书。\n\nTODO: 待完善。\n\n[missing](agent-notes/x.md)\n',
    usage: { sessions: 0, windowDays: 30, exposureDays: 90, sufficient: true, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 42, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 60, duplicatedWith: [] },
    mtime: NOW - 90 * 86400000,
    siblings: [],
  });
  assert.ok(report.score.total < 55, `total ${report.score.total}`);
  assert.equal(report.verdict.code, 'archive');
});

test('conflicts: detects cross-file duplicate with ratio 1', () => {
  const reports = [
    { id: 'instr:a', body: '# A\n\n必须跑测试再提交。\n' },
    { id: 'instr:b', body: '# B\n\n必须跑测试再提交。\n' },
  ];
  const conflicts = detectConflicts(reports);
  assert.ok(conflicts.some((conflict) => conflict.kind === 'duplicate' && conflict.ratio === 1));
});

test('conflicts: detects contradiction between positive and negative rules', () => {
  const reports = [
    { id: 'instr:a', body: '# A\n\n必须删除 node_modules 目录。\n' },
    { id: 'instr:b', body: '# B\n\n不要删除 node_modules 目录。\n' },
  ];
  const conflicts = detectConflicts(reports);
  assert.ok(conflicts.some((conflict) => conflict.kind === 'contradiction' && conflict.ratio > 0));
});

test('evolution: parseLessons and composeLessonEntry round-trip', () => {
  const composed = composeLessonEntry({ at: NOW, trigger: '用户说不要改测试', rule: '先跑现有测试再改实现', evidence: 'session abc123' });
  const parsed = parseLessons(composed);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.entries[0].trigger, '用户说不要改测试');
  assert.equal(parsed.entries[0].rule, '先跑现有测试再改实现');
  assert.equal(parsed.entries[0].evidence, 'session abc123');
  assert.equal(parseLessons('- [2026-99-99] 触发：x → 做法：y').count, 0);
});

test('evolution: upsertLessonsBlock is idempotent', () => {
  const raw = '# Title\n\n一些正文。\n';
  const entries = [composeLessonEntry({ at: NOW, trigger: 't', rule: 'r' })];
  const once = upsertLessonsBlock(raw, entries);
  const twice = upsertLessonsBlock(once, entries);
  assert.equal(twice, once);
  assert.equal((once.match(new RegExp(LESSONS_BLOCK.start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
});

test('evolution: buildEvolution computes pending, draft and proposals', () => {
  const evolution = buildEvolution({
    signals: { corrections: 1, postLoadErrors: 1, asks: 0, turnFailures: 1, reloads: 0, sessions: 1, lastSignalAt: NOW - 1000, samples: [{ kind: 'correction', at: NOW - 1000, sessionId: 's1', excerpt: '不对' }] },
    usage: { sessions: 1 },
    lessons: { count: 0, latestAt: null, entries: [] },
    linked: false,
    now: NOW,
  });
  assert.equal(evolution.applicable, true);
  assert.equal(evolution.pending.score, 1 * 3 + 1 * 2 + 1 * 2);
  assert.equal(evolution.pending.hasUnclosed, true);
  assert.equal(evolution.pending.draft.trigger, '不对');
  assert.equal(evolution.proposals.length, 1);
});

test('matchUsage: instruction global attribution and injected sessions', () => {
  const digest = {
    available: true,
    sessions: [
      { id: 's1', cwd: '/proj', preset: 'router', startedAt: NOW - 1000, injected: ['/home/u/.agents/AGENTS.md'], delegatedLabels: [], toolErrors: 0, corrections: 0, asks: 0, turnFailed: false },
      { id: 's2', cwd: '/proj', preset: 'router', startedAt: NOW - 2000, injected: [], delegatedLabels: [], toolErrors: 0, corrections: 0, asks: 0, turnFailed: false },
    ],
    signalsByPath: { '/home/u/.agents/AGENTS.md': { corrections: 0, postLoadErrors: 0, asks: 0, turnFailures: 0, reloads: 0, sessions: 1, lastSignalAt: null, samples: [] } },
    byPreset: { router: { sessions: 2, lastUsedAt: NOW - 1000 } },
  };
  const subject = { kind: 'instruction', name: 'AGENTS.md', path: '/home/u/.agents/AGENTS.md', dir: '/home/u/.agents', scope: 'global', mtime: NOW - 10 * 86400000 };
  const { usage, injection } = matchUsage(subject, digest, { now: NOW, windowDays: 30 });
  assert.equal(injection.sessionsSeen, 2);
  assert.equal(injection.sessionsInjected, 1);
  assert.equal(injection.mode, 'always');
  assert.equal(usage.sessions, 1);
  assert.equal(usage.exposureDays, 10);
});

test('matchUsage: project instruction uses cwd coverage; agent and preset attribute runs', () => {
  const digest = {
    available: true,
    sessions: [
      { id: 's1', cwd: '/proj/sub', preset: 'router', startedAt: NOW - 1000, injected: [], delegatedLabels: ['Build synthesis report'], toolErrors: 0, corrections: 0, asks: 0, turnFailed: false },
      { id: 's2', cwd: '/other', preset: 'router', startedAt: NOW - 2000, injected: [], delegatedLabels: [], toolErrors: 0, corrections: 0, asks: 0, turnFailed: false },
    ],
    signalsByPath: {},
    byPreset: { router: { sessions: 2, lastUsedAt: NOW - 1000 } },
  };
  const projInstruction = { kind: 'instruction', name: 'AGENTS.md', path: '/proj/AGENTS.md', dir: '/proj', scope: 'project', mtime: NOW - 10 * 86400000 };
  const projUsage = matchUsage(projInstruction, digest, { now: NOW });
  assert.equal(projUsage.injection.sessionsSeen, 1, 'only cwd under /proj counts');

  const agent = { kind: 'agent', name: 'synthesis_agent', description: 'Writes synthesis reports', scope: 'skill', mtime: NOW - 10 * 86400000 };
  const agentUsage = matchUsage(agent, digest, { now: NOW });
  assert.equal(agentUsage.usage.subagentRuns, 1);
  assert.equal(agentUsage.usage.sessions, 1);

  const preset = { kind: 'preset', name: 'router', scope: 'profile', mtime: NOW - 10 * 86400000 };
  const presetUsage = matchUsage(preset, digest, { now: NOW });
  assert.equal(presetUsage.usage.presetSessions, 2);
  assert.equal(presetUsage.injection.mode, 'config');
});

test('fixes: extract-sections moves to agent-notes and can be undone byte-for-byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agents360-fix-'));
  const path = join(dir, 'AGENTS.md');
  const raw = BAD_INSTRUCTION;
  await writeFile(path, raw, 'utf8');
  const report = analyzeFixture({ body: BAD_INSTRUCTION, path, dir });
  const plan = planFixes({ report, raw, files: [{ path: 'AGENTS.md', chars: raw.length }], actionIds: ['fix.extract-sections'] });
  assert.ok(plan.actions.length >= 1);
  const noteWrites = plan.writes.filter((write) => write.path.startsWith('agent-notes/'));
  assert.ok(noteWrites.length >= 1, `expected agent-notes writes, got ${plan.writes.map((write) => write.path)}`);
  const backupRoot = await mkdtemp(join(tmpdir(), 'agents360-backup-'));
  const applied = await applyPlan({ plan, subjectDir: dir, backupRoot, now: NOW, report });
  assert.ok(applied.backupId);
  const afterRaw = await readFile(path, 'utf8');
  assert.notEqual(afterRaw, raw);
  assert.match(afterRaw, /agent-notes\//);
  const backups = await listBackups(backupRoot);
  assert.equal(backups.length, 1);

  const undone = await undoBackup({ backupRoot });
  assert.equal(undone.backupId, applied.backupId);
  const restored = await readFile(path, 'utf8');
  assert.equal(restored, raw);
  for (const write of noteWrites) {
    await assert.rejects(access(join(dir, write.path)), /ENOENT/);
  }
  await rm(backupRoot, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
});

test('fixes: unsafe paths are rejected', () => {
  assert.throws(() => assertSafeRelPath('../escape.md'), /unsafe/);
  assert.throws(() => assertSafeRelPath('/etc/passwd'), /unsafe/);
  assert.throws(() => assertSafeRelPath('agent-notes/../../x.md'), /unsafe/);
  assert.throws(() => assertSafeRelPath('arbitrary/thing.md'), /outside|unsafe/);
  assert.throws(() => resolveInside('/tmp/subject', '../x.md', 'AGENTS.md'), /unsafe|outside|escape/i);
});

test('fixes: add-lesson is rejected when the rule is empty', () => {
  const report = analyzeFixture({ usage: { sessions: 1, windowDays: 30, exposureDays: 5, sufficient: false, presetSessions: 0, subagentRuns: 0 }, injection: { mode: 'always', sessionsSeen: 0, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 700, duplicatedWith: [] } });
  const plan = planFixes({ report, raw: GOOD_INSTRUCTION, files: [], actionIds: ['fix.add-lesson'], lesson: { trigger: '用户说不要改测试', rule: '' }, now: NOW });
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.skipped.some((skip) => skip.id === 'fix.add-lesson' && /做法|rule/.test(skip.reason)));
});

test('fixes: link-notes and embed-lessons plan writes', () => {
  const dir = '/home/u/.agents';
  const report = analyzeFixture({
    path: join(dir, 'AGENTS.md'), dir,
    files: [{ path: 'agent-notes/details.md', chars: 100 }],
  });
  const linkPlan = planFixes({ report, raw: '# T\n\n内容。\n', files: [{ path: 'agent-notes/details.md', chars: 100 }], actionIds: ['fix.link-notes'], now: NOW });
  assert.ok(linkPlan.actions.length >= 1);
  assert.match(linkPlan.writes.find((write) => write.path === 'AGENTS.md').content, /agent-notes\/details\.md/);

  const embedReport = analyzeFixture({ path: join(dir, 'AGENTS.md'), dir, evolution: { lessonsRaw: '- [2026-11-01] 触发：x → 做法：y' } });
  const embedPlan = planFixes({ report: embedReport, raw: '# T\n\n内容。\n', files: [], actionIds: ['fix.embed-lessons'], lessonsRaw: '- [2026-11-01] 触发：x → 做法：y', now: NOW });
  assert.ok(embedPlan.actions.length >= 1);
  assert.match(embedPlan.writes.find((write) => write.path === 'AGENTS.md').content, /agents-360:lessons:start/);
});

test('report: renders portfolio, per-subject sections and limitations', () => {
  const report = analyzeFixture({
    usage: { sessions: 9, windowDays: 30, exposureDays: 30, sufficient: true, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 42, sessionsInjected: 9, lastInjectedAt: NOW - 86400000, tokensPerInjection: 700, duplicatedWith: [] },
  });
  const portfolio = buildPortfolio([report], { now: NOW, windowDays: 30, sessionsScanned: 10, usageAvailable: true, roots: ['~/.agents'] });
  const markdown = renderMarkdown(portfolio);
  assert.match(markdown, /Agents 360/);
  assert.match(markdown, /组合概览/);
  assert.match(markdown, /AGENTS\.md/);
  assert.match(markdown, /口径与局限/);
  assert.match(markdown, /注入命中/);
  assert.match(markdown, /持续进化/);
});

test('score: contradiction is penalized with a critical governance finding', () => {
  const reports = [
    analyzeFixture({ name: 'AGENTS.md', body: '# A\n\n必须删除 node_modules 目录。\n' }),
    analyzeFixture({ name: 'CLAUDE.md', path: '/home/u/.claude/CLAUDE.md', dir: '/home/u/.claude', body: '# B\n\n不要删除 node_modules 目录。\n' }),
  ];
  const conflicts = detectConflicts(reports);
  assert.ok(conflicts.some((conflict) => conflict.kind === 'contradiction'));
  const report = analyzeFixture({
    name: 'AGENTS.md',
    body: '# A\n\n必须删除 node_modules 目录。\n',
    conflicts: [{ a: 'AGENTS.md', b: 'CLAUDE.md', kind: 'contradiction', ratio: 0.8, lineA: 3, lineB: 3 }],
  });
  const govConflicts = report.score.dimensions.find((dim) => dim.id === 'governance').items.find((item) => item.id === 'gov.conflicts');
  assert.equal(govConflicts.score, 0);
  assert.ok(report.findings.some((finding) => finding.id === 'gov.conflicts' && finding.severity === 'critical'));
});

test('score: inject evidence N/A when instruction sessionsSeen is below 5', () => {
  const report = analyzeFixture({
    usage: { sessions: 0, windowDays: 30, exposureDays: 2, sufficient: false, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 2, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 700, duplicatedWith: [] },
    mtime: NOW - 2 * 86400000,
  });
  const evidence = report.score.dimensions.find((dim) => dim.id === 'inject').items.find((item) => item.id === 'inject.evidence');
  assert.equal(evidence.applicable, false);
  assert.ok(report.score.confidence < 0.9);
});

test('diffText: produces a unified-style diff with context', () => {
  const diff = diffText('a\nb\nc\nd\n', 'a\nb\nX\nd\n', 1);
  assert.match(diff, /@@/);
  assert.match(diff, /\+X/);
  assert.match(diff, /-c/);
});

test('portfolio: buildPortfolio sorts worst-first and computes residentTokens', () => {
  const good = analyzeFixture({
    name: 'AGENTS.md',
    usage: { sessions: 9, windowDays: 30, exposureDays: 30, sufficient: true, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 42, sessionsInjected: 9, lastInjectedAt: NOW - 86400000, tokensPerInjection: 700, duplicatedWith: [] },
  });
  const bad = analyzeFixture({
    name: 'instructions.md', path: '/home/u/.deepseek/instructions.md', dir: '/home/u/.deepseek',
    body: BAD_INSTRUCTION,
    usage: { sessions: 0, windowDays: 30, exposureDays: 30, sufficient: true, presetSessions: 0, subagentRuns: 0 },
    injection: { mode: 'always', sessionsSeen: 42, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 9000, duplicatedWith: [] },
  });
  const portfolio = buildPortfolio([good, bad], { now: NOW, windowDays: 30, sessionsScanned: 10, usageAvailable: true });
  assert.equal(portfolio.subjects[0].score.total <= portfolio.subjects[1].score.total, true);
  assert.equal(portfolio.totals.instructions, 2);
  assert.equal(portfolio.totals.residentTokens, good.injection.tokensPerInjection + bad.injection.tokensPerInjection);
  assert.equal(portfolio.rubricVersion, '1.0');
});
