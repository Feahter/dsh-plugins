import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { zstdCompressSync } from 'node:zlib';

import { parseSkillMarkdown, replaceField, replaceBody } from '../lib/frontmatter.js';
import { extractMetrics } from '../lib/skills/metrics.js';
import { collectUsage, decompressZstd } from '../lib/usage.js';
import { analyzeSkill, buildPortfolio } from '../lib/skills/analyze.js';
import { renderMarkdown } from '../lib/skills/report.js';
import { buildEvolution, composeLessonEntry, parseLessons } from '../lib/skills/evolution.js';
import {
  applyPlan, diffText, listBackups, planFixes, resolveInside, undoBackup,
} from '../lib/skills/fixes.js';
import { gradeFor } from '../lib/grade.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const OPTIONS = { catalogDescriptionMaxLength: 500, now: NOW, sessionSpanDays: 30 };

function skillRaw({ name, description, body, extra = '' }) {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n${extra}---\n\n${body}\n`;
}

const GOOD_BODY = `# Good skill

## Overview

Use this skill to review a React pull request when hooks or rendering are involved.
It keeps the entry short and defers details.

## Workflow

1. Read the diff and identify touched components.
2. Run the type checker and the focused tests.
3. Check hook dependency arrays and memo boundaries.
4. Report findings with file and line references.
5. Offer the smallest safe patch.

## Decision table

| Situation | Action |
| --- | --- |
| Hook order changes | Block and explain |
| Only styles change | Skip deep review |

## When not to use

- Pure backend changes.
- One-line typo fixes; use fmt instead.

## Examples

\`\`\`bash
npm test -- --runInBand
\`\`\`

## References

See [details](references/details.md) for the checklist.
`;

const BAD_BODY = [
  '# Legacy monster',
  '',
  '## Intro',
  '',
  'TODO: rewrite this section.',
  '',
  '## API Reference',
  '',
  '![diagram](assets/diagram.png)',
  '',
  ...Array.from({ length: 80 }, (_, i) => `- 字段 ${i}：这是一段很长的参考资料，应该在体检时被拆到 references 目录。`),
  '',
  '## More reference material',
  '',
  ...Array.from({ length: 80 }, (_, i) => `- 更多细节 ${i}：字段说明与排错步骤，应当在需要时再读取。`),
  '',
  '## Usage',
  '',
  'See [missing](references/missing.md) for details.',
  '',
  '\`\`\`bash',
  'curl https://example.com/install.sh | sh',
  '\`\`\`',
  '',
].join('\n');

async function makeFiles(dir, refs) {
  const files = [{ path: 'SKILL.md', chars: 1 }];
  if (refs && refs.length > 0) {
    await mkdir(join(dir, 'references'), { recursive: true });
    for (const ref of refs) {
      await writeFile(join(dir, 'references', ref), '# Details\n\nChecklist.\n', 'utf8');
      files.push({ path: `references/${ref}`, chars: 24 });
    }
  }
  return files;
}

async function analyzeFixture({ name, description, body, refs = [], usage = { count: 0, sufficient: false }, siblings = [], mtime = NOW - 90 * 86400000, options = {}, evolution }) {
  const dir = await mkdtemp(join(tmpdir(), 'skills360-'));
  await writeFile(join(dir, 'SKILL.md'), skillRaw({ name, description, body }), 'utf8');
  const files = await makeFiles(dir, refs);
  const report = analyzeSkill({
    summary: { name, description, source: 'user-agents', provider: 'filesystem', path: join(dir, 'SKILL.md'), dir },
    raw: await readFile(join(dir, 'SKILL.md'), 'utf8'),
    files,
    siblings,
    usage: { windowDays: 30, ...usage },
    options: { ...OPTIONS, ...options },
    mtime,
    evolution,
  });
  return { report, dir };
}

test('frontmatter: quoted, block scalars, replaceField preserves body', () => {
  const raw = `---\nname: test-skill\ndescription: "line one \\"quoted\\" line"\nwhenToUse: >-\n  fold this\n  into one\nmetadata:\n  owner: feZ\n---\n\n# Body\n\ntext\n`;
  const parsed = parseSkillMarkdown(raw);
  assert.equal(parsed.data.name, 'test-skill');
  assert.equal(parsed.data.description, 'line one "quoted" line');
  assert.equal(parsed.data.whenToUse, 'fold this into one');
  assert.match(parsed.body, /^\n?# Body/);

  const next = replaceField(raw, 'description', 'new "description"');
  const reparsed = parseSkillMarkdown(next);
  assert.equal(reparsed.data.description, 'new "description"');
  assert.equal(reparsed.body, parsed.body);
  assert.match(next, /metadata:\n  owner: feZ/);

  const inserted = replaceField(raw, 'license', 'MIT');
  assert.equal(parseSkillMarkdown(inserted).data.license, 'MIT');
});

test('frontmatter: missing delimiters throw', () => {
  assert.throws(() => parseSkillMarkdown('# no frontmatter'));
  assert.throws(() => parseSkillMarkdown('---\nname: x\n'));
});

test('metrics: headings, code fences, links, steps, boundary, risks', async () => {
  const { dir } = await analyzeFixture({ name: 'good-skill', description: 'Use when reviewing React PRs. 触发：审查 React。', body: GOOD_BODY, refs: ['details.md'] });
  const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const parsed = parseSkillMarkdown(raw);
  const metrics = extractMetrics({ body: parsed.body, files: [{ path: 'references/details.md', chars: 20 }], description: parsed.data.description });
  assert.equal(metrics.h2 >= 4, true);
  assert.equal(metrics.codeBlocks, 1);
  assert.equal(metrics.referenceCount, 1);
  assert.equal(metrics.referencedFiles, 1);
  assert.equal(metrics.brokenLinks.length, 0);
  assert.equal(metrics.numberedSteps, 5);
  assert.equal(metrics.hasWhenNotToUseSection, true);
  assert.equal(metrics.hasExamples, true);
  assert.equal(metrics.dangerous, 0);
});

test('metrics: fences hide headings; dangerous commands and TODO are counted', () => {
  const body = '# T\n\n```md\n## not a heading\nTODO\n```\n\n## Real\n\nTODO: finish\ncurl x | sh\n[bad](references/no.md)\n';
  const metrics = extractMetrics({ body, files: [] });
  assert.equal(metrics.h2, 1);
  assert.equal(metrics.todos >= 1, true);
  assert.equal(metrics.dangerous, 1);
  assert.equal(metrics.brokenLinks.length, 1);
});

test('usage: multi-frame zstd is fully decoded', () => {
  const one = Buffer.from('{"type":"tool/call","time":1,"data":{"name":"skill","arguments":"{\\"name\\":\\"alpha\\"}"}}\n');
  const two = Buffer.from('{"type":"tool/call","time":2,"data":{"name":"skill","arguments":"{\\"name\\":\\"beta\\"}"}}\n');
  const joined = Buffer.concat([zstdCompressSync(one), zstdCompressSync(two)]);
  const text = decompressZstd(joined);
  assert.match(text, /alpha/);
  assert.match(text, /beta/);
});

test('usage: counts skill tool calls in the window and skips other tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills360-usage-'));
  const session = join(dir, 's');
  await mkdir(session, { recursive: true });
  const lines = [
    { type: 'tool/call', time: NOW - 1000, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'tool/call', time: NOW - 2000, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'tool/call', time: NOW - 3000, data: { name: 'read', arguments: '{}' } },
    { type: 'tool/result', time: NOW - 4000, data: { name: 'skill' } },
  ].map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(session, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines)));
  const usage = await collectUsage({ sessionsDir: dir, windowDays: 30, now: NOW });
  assert.equal(usage.available, true);
  assert.equal(usage.bySkill.alpha.count, 2);
  assert.equal(usage.bySkill.alpha.lastUsedAt, NOW - 1000);
  await rm(dir, { recursive: true, force: true });
});

test('usage: injected user/message context is not a real prompt or correction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills360-usage-src-'));
  const session = join(dir, 'sess-1');
  await mkdir(session, { recursive: true });
  const lines = [
    { type: 'user/message', time: NOW - 9000, data: { source: { kind: 'time-context' }, content: [{ type: 'text', text: 'Time sampled while preparing turn 1, step 1' }] } },
    { type: 'user/message', time: NOW - 8000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我审查这段代码' }] } },
    { type: 'tool/call', time: NOW - 7000, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'user/message', time: NOW - 6000, data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '不对，环境说明' }] } },
    { type: 'user/message', time: NOW - 5000, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '不对，先跑测试再改' }] } },
  ].map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(session, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines)));
  const usage = await collectUsage({ sessionsDir: dir, windowDays: 30, now: NOW });
  assert.equal(usage.signalsBySkill.alpha.corrections, 1, 'only the real user message is a correction');
  assert.equal(usage.signalsBySkill.alpha.samples[0].excerpt, '不对，先跑测试再改');
  assert.equal(usage.promptsBySkill.alpha.length, 1, 'injected context never becomes a load prompt');
  assert.equal(usage.promptsBySkill.alpha[0].text, '帮我审查这段代码');
  await rm(dir, { recursive: true, force: true });
});
test('usage: post-load signals are bounded to 120 minutes and errors name the failing tool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills360-usage-window-'));
  const session = join(dir, 'sess-2');
  await mkdir(session, { recursive: true });
  const loadAt = NOW - 3 * 3600_000;
  const lines = [
    { type: 'tool/call', time: loadAt, data: { callId: 'c-skill', name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'tool/call', time: loadAt + 3600_000, data: { callId: 'c-bash', name: 'bash', arguments: '{}' } },
    { type: 'tool/result', time: loadAt + 3600_000 + 1000, data: { message: { isError: true, toolCallId: 'c-bash', content: 'exit 1' } } },
    { type: 'tool/result', time: NOW - 1000, data: { message: { isError: true, toolCallId: 'c-bash', content: 'late error' } } },
    { type: 'user/message', time: NOW - 500, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '不对，这不行' }] } },
  ].map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(session, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines)));
  const usage = await collectUsage({ sessionsDir: dir, windowDays: 30, now: NOW });
  assert.equal(usage.signalsBySkill.alpha.postLoadErrors, 1, 'only the in-window error counts');
  assert.match(usage.signalsBySkill.alpha.samples[0].excerpt, /^\[bash\] exit 1$/, 'failing tool name is part of the evidence');
  assert.equal(usage.signalsBySkill.alpha.corrections, 0, 'a correction hours later is not attributed');
  await rm(dir, { recursive: true, force: true });
});

test('usage: the load window is per session, not the skill\'s latest load overall', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills360-usage-session-window-'));
  // Processed first: a newer session that only loads the skill. Its load time
  // must not hide the older session's failure (the bug this test guards).
  const newer = join(dir, 'a-newer');
  const older = join(dir, 'b-older');
  await mkdir(newer, { recursive: true });
  await mkdir(older, { recursive: true });
  const olderRows = [
    { type: 'tool/call', time: NOW - 5 * 3600_000, data: { callId: 'c1', name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'turn/end', time: NOW - 5 * 3600_000 + 60_000, data: { reason: { kind: 'error' } } },
  ].map((line) => JSON.stringify(line)).join('\n');
  const newerRows = [
    { type: 'tool/call', time: NOW - 60_000, data: { callId: 'c2', name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
  ].map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(older, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(olderRows)));
  await writeFile(join(newer, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(newerRows)));
  const usage = await collectUsage({ sessionsDir: dir, windowDays: 30, now: NOW });
  assert.equal(usage.signalsBySkill.alpha.turnFailures, 1, 'older session failure still counts');
  assert.equal(usage.signalsBySkill.alpha.samples[0].sessionId, 'b-older');
  await rm(dir, { recursive: true, force: true });
});


test('score: a complete small skill beats a bloated placeholder skill', async () => {
  const good = await analyzeFixture({ name: 'good-skill', description: 'Use when reviewing React pull requests. 触发：审查 React、检查 hooks。', body: GOOD_BODY, refs: ['details.md'], usage: { count: 4, lastUsedAt: NOW - 86400000, sufficient: true } });
  const bad = await analyzeFixture({ name: 'legacy-monster', description: 'This skill helps you with things.', body: BAD_BODY, refs: ['orphan.md'], usage: { count: 0, sufficient: true } });
  assert.ok(good.report.score.total >= 80, `good score ${good.report.score.total}`);
  assert.ok(bad.report.score.total < good.report.score.total - 12, `bad ${bad.report.score.total} vs good ${good.report.score.total}`);
  // Under Rubric 2.0 a structurally-excellent skill with on-demand loads but no
  // lessons.md still loses the evolution dimension (10 pts), so it lands in the
  // B band. The exact 18-bucket code is derived from the total, never hard-coded.
  assert.equal(good.report.score.grade, gradeFor(good.report.score.total).code);
  assert.equal(good.report.score.letter, gradeFor(good.report.score.total).letter);
  assert.ok(good.report.score.dimensions.some((dim) => dim.id === 'evolution' && dim.applicable === true));
  assert.ok(bad.report.findings.some((finding) => finding.severity === 'critical'));
  assert.ok(bad.report.suggestions.some((suggestion) => suggestion.id === 'fix.extract-sections'));
  assert.ok(bad.report.suggestions.some((suggestion) => suggestion.id === 'fix.link-references'));
  assert.ok(bad.report.suggestions.some((suggestion) => suggestion.kind === 'draft'));
});

test('score: usage evidence is skipped when samples are insufficient', async () => {
  const { report } = await analyzeFixture({
    name: 'unused',
    description: 'Use when auditing code. 触发：审查代码。',
    body: GOOD_BODY,
    refs: ['details.md'],
    usage: { count: 0, sufficient: false },
    mtime: NOW - 2 * 86400000,
  });
  const usageItem = report.score.dimensions.find((dim) => dim.id === 'load').items.find((item) => item.id === 'load.evidence');
  assert.equal(usageItem.applicable, false);
  assert.equal(report.score.confidence < 0.9, true);
});

test('usage: dense catalog exposure activates evidence; a just-added skill stays N/A', async () => {
  const dense = await analyzeFixture({
    name: 'dense',
    description: 'Use when auditing code. 触发：审查代码。',
    body: GOOD_BODY,
    refs: ['details.md'],
    usage: { count: 0, sufficient: true, firstSeen: NOW - 3 * 86400000, catalogSessions: 66 },
  });
  const fresh = await analyzeFixture({
    name: 'fresh',
    description: 'Use when auditing code. 触发：审查代码。',
    body: GOOD_BODY,
    refs: ['details.md'],
    usage: { count: 0, sufficient: true, firstSeen: NOW - 3600000, catalogSessions: 2 },
    mtime: NOW - 3600000,
    options: { sessionSpanDays: 30, sessionsScanned: 70 },
  });
  const denseItem = dense.report.score.dimensions.find((dim) => dim.id === 'load').items.find((item) => item.id === 'load.evidence');
  const freshItem = fresh.report.score.dimensions.find((dim) => dim.id === 'load').items.find((item) => item.id === 'load.evidence');
  assert.equal(dense.report.usage.sufficient, true);
  assert.equal(denseItem.applicable, true);
  assert.equal(fresh.report.usage.sufficient, false);
  assert.equal(freshItem.applicable, false);
});

test('overlap and portfolio verdict use sibling scores', async () => {
  const description = 'Use when reviewing academic papers and refereeing manuscripts.';
  const one = await analyzeFixture({ name: 'reviewer-one', description, body: GOOD_BODY, refs: ['details.md'], siblings: [{ name: 'reviewer-two', description }] });
  const two = await analyzeFixture({ name: 'reviewer-two', description, body: GOOD_BODY, refs: ['details.md'], siblings: [{ name: 'reviewer-one', description }] });
  assert.ok(one.report.metrics.overlapMax > 0.8);
  const portfolio = buildPortfolio([one.report, two.report], { options: OPTIONS, now: NOW, windowDays: 30, sessionsScanned: 10, usageAvailable: true });
  assert.ok(portfolio.overlaps.length >= 1);
  assert.ok(portfolio.skills.every((report) => report.score.total > 0));
  assert.equal(portfolio.rubricVersion, '2.0');
});

test('fixes: extract sections moves content to references and can be undone byte-for-byte', async () => {
  const { report, dir } = await analyzeFixture({ name: 'legacy-monster', description: 'This skill helps you with things.', body: BAD_BODY, usage: { count: 0, sufficient: true } });
  const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const files = [{ path: 'SKILL.md', chars: raw.length }];
  const plan = planFixes({ report, raw, files, actionIds: ['fix.extract-sections', 'fix.link-references', 'fix.add-boundary'] });
  assert.ok(plan.actions.length >= 2);
  const referenceWrites = plan.writes.filter((write) => write.path.startsWith('references/'));
  assert.ok(referenceWrites.length >= 2, `expected two reference files, got ${referenceWrites.length}`);
  assert.ok(referenceWrites.every((write) => write.content.startsWith('# ')));
  const moved = referenceWrites.map((write) => write.content).join('\n');
  assert.equal(/\(assets\//.test(moved), false, 'relative links are rebased out of references/');
  const backupRoot = await mkdtemp(join(tmpdir(), 'skills360-backup-'));
  const applied = await applyPlan({ plan, skillDir: dir, backupRoot, now: NOW, report });
  assert.ok(applied.backupId);
  const afterRaw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  assert.notEqual(afterRaw, raw);
  assert.match(afterRaw, /references\//);
  const backups = await listBackups(backupRoot);
  assert.equal(backups.length, 1);
  assert.equal(backups[0].skill, 'legacy-monster');

  const undone = await undoBackup({ backupRoot });
  assert.equal(undone.backupId, applied.backupId);
  const restored = await readFile(join(dir, 'SKILL.md'), 'utf8');
  assert.equal(restored, raw);
  for (const write of referenceWrites) {
    await assert.rejects(access(join(dir, write.path)), /ENOENT/);
  }
  await rm(backupRoot, { recursive: true, force: true });
});

test('fixes: undo refuses a skill directory symlink that was repointed', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX symlink semantics');
  const { report, dir } = await analyzeFixture({ name: 'symlink-skill', description: 'Use when testing symlinks. 触发：测试。', body: BAD_BODY, refs: ['orphan.md'] });
  const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const plan = planFixes({ report, raw, files: [], actionIds: ['fix.link-references'] });
  const backupRoot = await mkdtemp(join(tmpdir(), 'skills360-symlink-backup-'));
  const applied = await applyPlan({ plan, skillDir: dir, backupRoot, now: NOW, report });
  const moved = `${dir}-moved`;
  const elsewhere = await mkdtemp(join(tmpdir(), 'skills360-elsewhere-'));
  await rename(dir, moved);
  await symlink(elsewhere, dir, 'dir');
  await assert.rejects(
    undoBackup({ backupRoot, backupId: applied.backupId }),
    /outside|unsafe|skill directory/i,
  );
  await rm(dir, { force: true });
  await rm(moved, { recursive: true, force: true });
  await rm(elsewhere, { recursive: true, force: true });
  await rm(backupRoot, { recursive: true, force: true });
});

test('fixes: unsafe paths are rejected', async () => {
  assert.throws(() => resolveInside('/tmp/skill', '../escape.md'), /unsafe|outside|escapes/i);
  assert.throws(() => resolveInside('/tmp/skill', '/etc/passwd'), /unsafe/i);
  assert.throws(() => resolveInside('/tmp/skill', 'references/../../x.md'), /unsafe/i);
});

test('fixes: description reorder and trim are planned without touching the body', async () => {
  const description = 'Review academic manuscripts carefully. This first sentence is intentionally verbose so the routing trigger lands late in the string. More context here. Use when reviewing a paper or refereeing.';
  const { report, dir } = await analyzeFixture({ name: 'paper-review', description, body: GOOD_BODY, refs: ['details.md'], usage: { count: 0, sufficient: false } });
  const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const plan = planFixes({ report, raw, files: [], actionIds: ['fix.frontload-triggers'] });
  assert.equal(plan.actions.length, 1);
  const content = plan.writes.find((write) => write.path === 'SKILL.md').content;
  assert.match(content, /^---\nname:/);
  assert.match(content, /Use when reviewing a paper/);
  assert.equal(parseSkillMarkdown(content).body, parseSkillMarkdown(raw).body);
  assert.equal(diffText(raw, content).includes('@@'), true);
});

test('report: markdown has portfolio, per-skill sections and limitations', async () => {
  const { report } = await analyzeFixture({ name: 'good-skill', description: 'Use when reviewing React PRs. 触发：审查 React。', body: GOOD_BODY, refs: ['details.md'] });
  const portfolio = buildPortfolio([report], { options: OPTIONS, now: NOW, windowDays: 30, sessionsScanned: 10, usageAvailable: true });
  const markdown = renderMarkdown(portfolio);
  assert.match(markdown, /Skills 360/);
  assert.match(markdown, /组合概览/);
  assert.match(markdown, /good-skill/);
  assert.match(markdown, /口径与局限/);
  assert.match(markdown, /渐进披露/);
  assert.match(markdown, /持续进化/);
});

test('usage: signal parsing mines corrections, errors, reloads and turn failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skills360-signal-'));
  const sessionDir = join(dir, 'sess-1');
  await mkdir(sessionDir, { recursive: true });
  const lines = [
    { type: 'user/message', time: NOW - 8000, data: { source: { kind: 'skill-catalog', entries: [{ name: 'alpha' }] }, content: [{ type: 'text', text: 'catalog' }] } },
    { type: 'user/message', time: NOW - 7000, data: { content: [{ type: 'text', text: 'use alpha skill please' }] } },
    { type: 'tool/call', time: NOW - 6000, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'user/message', time: NOW - 5000, data: { content: [{ type: 'text', text: '不对，重新做' }] } },
    { type: 'tool/result', time: NOW - 4000, data: { message: { isError: true, content: [{ type: 'text', text: 'something broke' }] } } },
    { type: 'tool/call', time: NOW - 3000, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'turn/end', time: NOW - 2000, data: { reason: { kind: 'error' } } },
  ].map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(sessionDir, 'session.v4.jsonl'), lines);
  const usage = await collectUsage({ sessionsDir: dir, windowDays: 30, now: NOW });
  assert.equal(usage.available, true);
  assert.equal(usage.bySkill.alpha.count, 2);
  const sig = usage.signalsBySkill.alpha;
  assert.ok(sig, 'alpha signals present');
  assert.equal(sig.loads, 2);
  assert.equal(sig.sessions, 1);
  assert.equal(sig.reloads, 1);
  assert.equal(sig.postLoadErrors, 1);
  assert.equal(sig.corrections, 1);
  assert.equal(sig.asks, 0);
  assert.equal(sig.turnFailures, 1);
  assert.equal(sig.samples.length, 4);
  assert.equal(sig.samples[0].kind, 'turn-failure');
  assert.equal(sig.lastSignalAt, NOW - 2000);
  assert.ok(Array.isArray(usage.promptsBySkill.alpha));
  assert.equal(usage.promptsBySkill.alpha.length, 2);
  assert.equal(usage.promptsBySkill.alpha[0].text, '不对，重新做');
  await rm(dir, { recursive: true, force: true });
});

test('evolution: parseLessons and composeLessonEntry round-trip', () => {
  const raw = [
    '# Lessons（实战经验）',
    '',
    '> 由 skills-360 从真实调用信号沉淀，按需读取；最新在上。',
    '',
    '- [2026-11-09] 触发：用户说“不要改测试” → 做法：先跑现有测试再改实现（证据：session abc123）',
    '- [2026-11-01] 触发：用户说错了 → 做法：按 X 来',
  ].join('\n');
  const parsed = parseLessons(raw);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.latestAt, Date.UTC(2026, 10, 9));
  assert.equal(parsed.entries[0].trigger, '用户说“不要改测试”');
  assert.equal(parsed.entries[0].rule, '先跑现有测试再改实现');
  assert.equal(parsed.entries[0].evidence, 'session abc123');
  assert.equal(parsed.entries[0].line, 5);

  const composed = composeLessonEntry({ at: Date.UTC(2026, 10, 9), trigger: '用户说“不要改测试”', rule: '先跑现有测试再改实现', evidence: 'session abc123' });
  assert.equal(composed, '- [2026-11-09] 触发：用户说“不要改测试” → 做法：先跑现有测试再改实现（证据：session abc123）');
  const reparsed = parseLessons(composed);
  assert.equal(reparsed.count, 1);
  assert.equal(reparsed.entries[0].trigger, '用户说“不要改测试”');
  assert.equal(reparsed.entries[0].rule, '先跑现有测试再改实现');
  assert.equal(reparsed.entries[0].evidence, 'session abc123');


  // Impossible dates must not roll forward into a "fresh" lesson.
  const rolled = parseLessons('- [2026-99-99] 触发：x → 做法：y');
  assert.equal(rolled.count, 0);

  // A lesson field must not be able to forge the next field delimiter.
  const forged = composeLessonEntry({ at: NOW, trigger: '用户说做法：先改测试', rule: '先跑测试', evidence: 's1' });
  const forgedParsed = parseLessons(forged);
  assert.equal(forgedParsed.count, 1);
  assert.match(forgedParsed.entries[0].trigger, /先改测试/);
  assert.equal(forgedParsed.entries[0].rule, '先跑测试');
  assert.equal(forgedParsed.entries[0].trigger.includes('做法：'), false);

  // Control characters never reach the file.
  const controlled = composeLessonEntry({ at: NOW, trigger: 'a\u0000b', rule: 'c\u0007d', evidence: 'e' });
  assert.equal(/[\u0000-\u0008]/.test(controlled), false);
});

test('evolution: buildEvolution computes pending, draft, proposals and promptRecall', () => {
  const evolution = buildEvolution({
    signals: {
      loads: 2, sessions: 1, reloads: 1, postLoadErrors: 1, corrections: 1,
      asks: 0, turnFailures: 1, lastLoadAt: NOW - 3000, lastSignalAt: NOW - 2000,
      samples: [
        { kind: 'turn-failure', at: NOW - 2000, sessionId: 's1', excerpt: 'error' },
        { kind: 'reload', at: NOW - 3000, sessionId: 's1', excerpt: '不对，重新做' },
        { kind: 'error', at: NOW - 4000, sessionId: 's1', excerpt: 'something broke' },
        { kind: 'correction', at: NOW - 5000, sessionId: 's1', excerpt: '不对，重新做' },
      ],
    },
    loads: 2,
    lessons: { count: 0, latestAt: null, entries: [] },
    linked: false,
    prompts: [
      { at: NOW - 10, sessionId: 's1', text: 'use when reviewing a react pr' },
      { at: NOW - 20, sessionId: 's2', text: '审查这段代码' },
      { at: NOW - 30, sessionId: 's3', text: 'nothing in common here' },
      { at: NOW - 40, sessionId: 's4', text: 'another unrelated phrase' },
    ],
    description: 'Use when reviewing React pull requests. 触发：审查 React。',
    now: NOW,
  });
  assert.equal(evolution.applicable, true);
  assert.equal(evolution.pending.score, 1 * 3 + 1 * 2 + 1 * 2 + 1 * 2 + 0);
  assert.equal(evolution.pending.hasUnclosed, true);
  assert.equal(evolution.pending.draft.trigger, '不对，重新做');
  assert.equal(evolution.pending.draft.evidence, 'session s1');
  assert.equal(evolution.proposals.length, 1);
  assert.equal(evolution.proposals[0].id, 'evolution.add-lesson');
  assert.equal(evolution.promptRecall.total, 4);
  assert.equal(evolution.promptRecall.matched, 2);
  assert.equal(evolution.promptRecall.recall, 0.5);
  assert.equal(evolution.promptRecall.samples.length, 2);
});

test('evolution: a lesson written today closes today\'s signals (date granularity)', () => {
  const today = Date.UTC(2026, 10, 9);
  const signals = {
    loads: 2, sessions: 1, reloads: 0, postLoadErrors: 1, corrections: 1, asks: 0, turnFailures: 0,
    lastLoadAt: today + 2 * 3600_000, lastSignalAt: today + 10 * 3600_000,
    samples: [{ kind: 'correction', at: today + 10 * 3600_000, sessionId: 's1', excerpt: '不对' }],
  };
  const closed = buildEvolution({
    signals,
    loads: 2,
    lessons: { count: 1, latestAt: today, entries: [] },
    linked: true,
    now: today + 12 * 3600_000,
  });
  assert.equal(closed.pending.hasUnclosed, false, 'same-day lesson covers same-day signals');
  assert.equal(closed.proposals.length, 0);

  const stale = buildEvolution({
    signals: { ...signals, lastSignalAt: today + 2 * 86400_000 },
    loads: 2,
    lessons: { count: 1, latestAt: today, entries: [] },
    linked: true,
    now: today + 3 * 86400_000,
  });
  assert.equal(stale.pending.hasUnclosed, true, 'a later day is still unclosed');
  assert.equal(stale.proposals.length, 1);
});

test('score: evolution N/A rescales the other five dimensions to 100', async () => {
  const { report } = await analyzeFixture({
    name: 'unused',
    description: 'Use when auditing code. 触发：审查代码。',
    body: GOOD_BODY,
    refs: ['details.md'],
    usage: { count: 0, sufficient: false },
  });
  const evolutionDim = report.score.dimensions.find((dim) => dim.id === 'evolution');
  assert.equal(evolutionDim.applicable, false);
  assert.equal(evolutionDim.score, 0);
  const fiveDim = report.score.dimensions
    .filter((dim) => dim.id !== 'evolution')
    .reduce((sum, dim) => sum + dim.score, 0);
  assert.equal(report.score.total, Math.round((fiveDim * 100 / 90) * 10) / 10);
});

test('score: disclosure.index rewards an entry index and goes N/A without references', async () => {
  const indexBody = '# Skill\n\n## Overview\n\nUse when indexing things.\n\n## References\n\n- [a.md](references/a.md) — 参考 A\n- [b.md](references/b.md) — 参考 B\n';
  const withIndex = await analyzeFixture({ name: 'indexed', description: 'Use when indexing. 触发：索引。', body: indexBody, refs: ['a.md', 'b.md'] });
  const indexItem = withIndex.report.score.dimensions.find((dim) => dim.id === 'disclosure').items.find((item) => item.id === 'disclosure.index');
  assert.equal(indexItem.applicable, true);
  assert.equal(indexItem.score, 5);

  const noIndexBody = '# Skill\n\n## Overview\n\nUse when linking things.\n\n## Details\n\nSee [a.md](references/a.md) for more.\n';
  const noIndex = await analyzeFixture({ name: 'noindex', description: 'Use when linking. 触发：链接。', body: noIndexBody, refs: ['a.md'] });
  const noIndexItem = noIndex.report.score.dimensions.find((dim) => dim.id === 'disclosure').items.find((item) => item.id === 'disclosure.index');
  assert.equal(noIndexItem.applicable, true);
  assert.equal(noIndexItem.score, 2);

  const noRefs = await analyzeFixture({ name: 'norefs', description: 'Use when nothing. 触发：无。', body: '# Skill\n\n## Overview\n\nUse when nothing.\n' });
  const noRefsItem = noRefs.report.score.dimensions.find((dim) => dim.id === 'disclosure').items.find((item) => item.id === 'disclosure.index');
  assert.equal(noRefsItem.applicable, false);

  // An orphan reference is already charged by disclosure.refs; the index item
  // must not charge the same defect a second time.
  const orphan = await analyzeFixture({ name: 'orphanrefs', description: 'Use when orphan. 触发：孤儿。', body: '# Skill\n\n## Overview\n\nUse when orphan.\n', refs: ['orphan.md'] });
  const orphanItem = orphan.report.score.dimensions.find((dim) => dim.id === 'disclosure').items.find((item) => item.id === 'disclosure.index');
  assert.equal(orphanItem.applicable, false);
});

test('score: promptRecall mismatch emits load.prompt-mismatch finding', async () => {
  const { report } = await analyzeFixture({
    name: 'prompt-skill',
    description: 'Use when reviewing React pull requests. 触发：审查 React。',
    body: GOOD_BODY,
    refs: ['details.md'],
    usage: { count: 0, sufficient: false },
    evolution: {
      prompts: [
        { at: NOW - 10, sessionId: 's1', text: 'use when reviewing a react pr' },
        { at: NOW - 20, sessionId: 's2', text: 'totally unrelated alpha' },
        { at: NOW - 30, sessionId: 's3', text: 'totally unrelated beta' },
        { at: NOW - 40, sessionId: 's4', text: 'totally unrelated gamma' },
      ],
    },
  });
  const finding = report.findings.find((item) => item.id === 'load.prompt-mismatch');
  assert.ok(finding, 'prompt-mismatch finding present');
  assert.equal(finding.dimension, 'load');
  assert.equal(finding.severity, 'minor');
});

test('fixes: add-lesson writes lessons.md, links the entry and undoes byte-for-byte', async () => {
  const { report, dir } = await analyzeFixture({ name: 'good-skill', description: 'Use when reviewing React PRs. 触发：审查 React。', body: GOOD_BODY, refs: ['details.md'], usage: { count: 0, sufficient: false } });
  const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const files = [{ path: 'SKILL.md', chars: raw.length }, { path: 'references/details.md', chars: 24 }];
  const lesson = { trigger: '用户说不要改测试', rule: '先跑现有测试再改实现', evidence: 'session abc123' };
  const plan = planFixes({ report, raw, files, actionIds: ['fix.add-lesson'], lesson, now: NOW });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].type, 'add-lesson');
  const lessonsWrite = plan.writes.find((write) => write.path === 'references/lessons.md');
  assert.ok(lessonsWrite, 'lessons.md write present');
  assert.match(lessonsWrite.content, /触发：用户说不要改测试/);
  assert.match(lessonsWrite.content, /做法：先跑现有测试再改实现/);
  const skillWrite = plan.writes.find((write) => write.path === 'SKILL.md');
  assert.ok(skillWrite);
  assert.match(skillWrite.content, /\]\(references\/lessons\.md\)/);

  const backupRoot = await mkdtemp(join(tmpdir(), 'skills360-lesson-backup-'));
  const applied = await applyPlan({ plan, skillDir: dir, backupRoot, now: NOW, report });
  assert.ok(applied.backupId);
  const lessonsAfter = await readFile(join(dir, 'references', 'lessons.md'), 'utf8');
  assert.match(lessonsAfter, /触发：用户说不要改测试/);
  const skillAfter = await readFile(join(dir, 'SKILL.md'), 'utf8');
  assert.match(skillAfter, /\]\(references\/lessons\.md\)/);

  const undone = await undoBackup({ backupRoot });
  assert.equal(undone.backupId, applied.backupId);
  const skillRestored = await readFile(join(dir, 'SKILL.md'), 'utf8');
  assert.equal(skillRestored, raw);
  await assert.rejects(access(join(dir, 'references', 'lessons.md')), /ENOENT/);
  await rm(backupRoot, { recursive: true, force: true });
});

test('fixes: add-lesson skips when the rule is empty', async () => {
  const { report, dir } = await analyzeFixture({ name: 'good-skill', description: 'Use when reviewing React PRs. 触发：审查 React。', body: GOOD_BODY, refs: ['details.md'] });
  const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  const plan = planFixes({ report, raw, files: [], actionIds: ['fix.add-lesson'], lesson: { trigger: '用户说不要改测试', rule: '' }, now: NOW });
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.skipped.some((skip) => skip.id === 'fix.add-lesson' && /做法/.test(skip.reason)));
});

test('portfolio: a closed evolution signal is not listed as pending', () => {
  const report = {
    name: 'closed-skill',
    source: 'x',
    description: 'd',
    metrics: { estTokens: 100, referenceCount: 0, catalogTruncated: false, brokenLinks: [], overlapMax: 0, overlapName: '' },
    usage: { sufficient: true, count: 1, lastUsedAt: NOW },
    score: { total: 70, grade: gradeFor(70).code, letter: gradeFor(70).letter, tier: gradeFor(70).tier, rank: gradeFor(70).rank, dimensions: [], confidence: 0.9 },
    verdict: { code: 'keep', label: '保留', reason: 'test' },
    overlaps: [],
    evolution: {
      applicable: true,
      lessons: { count: 1, latestAt: NOW, linked: true, entries: [] },
      signals: { corrections: 0, postLoadErrors: 0, reloads: 0, turnFailures: 0, asks: 0 },
      pending: { score: 3, hasUnclosed: false, lastSignalAt: NOW },
    },
  };
  const portfolio = buildPortfolio([report], { options: OPTIONS, now: NOW, windowDays: 30, sessionsScanned: 10, usageAvailable: true });
  assert.equal(portfolio.evolution.length, 0);
  assert.deepEqual(portfolio.issues.pendingEvolution, []);
  assert.equal(portfolio.totals.evolution.pendingSkills, 0);
});

test('score: an unclosed signal with no timestamp never reads as covered', async () => {
  const { report } = await analyzeFixture({
    name: 'no-time',
    description: 'Use when testing. 触发：测试。',
    body: GOOD_BODY,
    refs: ['details.md'],
    usage: { count: 1, sufficient: true },
    evolution: {
      signals: {
        loads: 1, sessions: 1, reloads: 0, postLoadErrors: 0, corrections: 1, asks: 0, turnFailures: 0,
        lastLoadAt: NOW - 1000, lastSignalAt: null,
        samples: [{ kind: 'correction', at: null, sessionId: 's1', excerpt: '不对' }],
      },
      lessonsRaw: '- [2026-11-09] 触发：不对 → 做法：先复述需求再动手',
    },
  });
  const evolutionDim = report.score.dimensions.find((dim) => dim.id === 'evolution');
  const closure = evolutionDim.items.find((item) => item.id === 'evolution.closure');
  assert.equal(report.evolution.pending.hasUnclosed, true);
  assert.equal(closure.score, 1, 'unclosed must not read as covered');
  assert.equal(closure.detail.includes('已覆盖'), false);
});
