/**
 * Standalone verification for the skills-360 Host half.
 *
 * Builds three throwaway skills in an `fs.mkdtemp` directory, wires a mock
 * Cordis context (`ctx.skills` / `ctx.tools` / `ctx.webServer` / `ctx.get`),
 * imports the real plugin, and drives it end to end:
 *
 *   1. scan (3 skills, scores, findings, usage evidence)
 *   2. skill detail (body + raw + suggestions)
 *   3. apply (file really changes, backup manifest, before/after scores)
 *   4. undo (byte-for-byte restore)
 *   5. apply-all safeOnly (auto only, never draft)
 *   6. auth (401 rejection, 503 without connection)
 *   7. error mapping + path-traversal / symlink-escape refusal
 *   8. all three agent tools (scan summary, report markdown, optimize dryRun)
 *
 * Never touches the real skill roots: everything lives under the temp dir and
 * `DSH_HOME` points inside it, so usage/state/backups/reports are disposable.
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'skills360-'));
// Safety net: even a failed assertion leaves no temp skills behind.
process.once('exit', () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best effort
  }
});
const dshHome = join(root, 'dsh');
const skillsRoot = join(root, 'skills');
const backupRoot = join(dshHome, 'skills-360', 'backups');
const reportDir = join(dshHome, 'skills-360', 'reports');

process.env.DSH_HOME = dshHome;

const captured = {
  tools: new Map(),
  route: null,
  effects: 0,
  rejection: undefined,
  connection: true,
};

const fakeConnection = {
  requestRejection() {
    return captured.rejection;
  },
};

const ctx = {
  get(name) {
    return name === 'connection' && captured.connection ? fakeConnection : undefined;
  },
  tools: {
    register(definition) {
      assert.equal(captured.tools.has(definition.name), false, 'duplicate tool ' + definition.name);
      captured.tools.set(definition.name, definition);
      return () => captured.tools.delete(definition.name);
    },
  },
  webServer: {
    register(route) {
      captured.route = route;
      return () => {};
    },
  },
  effect(callback) {
    captured.effects += 1;
    const disposer = callback();
    return typeof disposer === 'function' ? disposer : () => {};
  },
};

// ---------------------------------------------------------------- fixtures

const GOOD = `---
name: good
description: "Review a React component tree for accessibility gaps. Use when the user asks for an a11y review, a WCAG audit, a keyboard navigation check, or an ARIA labelling review."
---
# Accessibility Review

## Overview

Quick start: inspect the component tree, then run the checklist below.

## Workflow

1. Read the component tree and note interactive elements.
2. Check landmarks, headings, and page titles.
3. Check keyboard order and focus traps.
4. Check every control for an accessible name.
5. Write findings as file:line with a concrete fix.

## When not to use

Do not use for backend-only changes or pure CSS refactors.

## Example

\`\`\`jsx
<button type="button" aria-label="Save">Save</button>
\`\`\`

## References

- [Checklist](references/checklist.md)
- [Patterns](references/patterns.md)
`;

const GOOD_CHECKLIST = `# Accessibility checklist

- Landmarks present.
- Every control has a name.
- Focus order matches visual order.
`;

const GOOD_PATTERNS = `# ARIA patterns

- Button: native button first.
- Dialog: role plus focus trap.
`;

const MEDIUM_REFERENCE_LINES = Array.from(
  { length: 180 },
  (_, index) => `- \`field_${String(index).padStart(3, '0')}\`: parameter documentation for the reference API surface, including accepted values and defaults.`,
).join('\n');

const MEDIUM = `---
name: medium
description: "Document and query the internal billing API. Use when the user asks for endpoint docs, payload fields, error codes, or retry guidance."
---
# Billing API guide

## Overview

Quick start: pick the endpoint, then read the field reference below.

## Workflow

1. Identify the resource.
2. Read the matching fields.
3. Check error codes.

## Reference API

${MEDIUM_REFERENCE_LINES}
`;

const MEDIUM_ORPHAN = `# Billing response codes

- 200 ok
- 402 payment required
- 429 retry later
`;

const BAD_LONG_DESCRIPTION = [
  'Use when the user wants to organise scattered notes into a searchable archive with tags and an index.',
  'It collects loose notes, groups them by topic, tags each entry, builds a table of contents, tracks revisions, exports weekly digests, and keeps a changelog.',
  'It also normalises headings, removes duplicate bullet points, links related notes, records source URLs, and suggests follow-up questions for the weekly review.',
  'The archive keeps every note searchable while the index stays short, and the workflow repeats the same structure for every folder so the result stays predictable over time.',
  'Notes are filed under a date prefix, tagged with a topic prefix, and cross-linked from the index page so a later reader can jump straight to the right entry without scanning the whole archive.',
].join(' ');

// Deliberately missing `name:` (frontmatter field gap) and carrying a TODO and
// a broken local link, while the description is long enough for an auto trim.
const BAD = `---
description: "${BAD_LONG_DESCRIPTION}"
---
# Note organiser

## Overview

A note organiser that mostly works.

## Steps

1. Read the inbox.
2. File the notes.

TODO: finish the tagging step.

See [Missing ref](references/missing.md) for details.
`;

const BAD_ORPHAN = `# Tag rules

- One topic tag per note.
- One status tag per note.
`;

const skills = [
  { name: 'good', dir: join(skillsRoot, 'good'), description: 'Review a React component tree for accessibility gaps. Use when the user asks for an a11y review, a WCAG audit, a keyboard navigation check, or an ARIA labelling review.' },
  { name: 'medium', dir: join(skillsRoot, 'medium'), description: 'Document and query the internal billing API. Use when the user asks for endpoint docs, payload fields, error codes, or retry guidance.' },
  { name: 'bad', dir: join(skillsRoot, 'bad'), description: BAD_LONG_DESCRIPTION },
];

async function writeSkillFixtures() {
  await mkdir(join(skillsRoot, 'good', 'references'), { recursive: true });
  await writeFile(join(skillsRoot, 'good', 'SKILL.md'), GOOD, 'utf8');
  await writeFile(join(skillsRoot, 'good', 'references', 'checklist.md'), GOOD_CHECKLIST, 'utf8');
  await writeFile(join(skillsRoot, 'good', 'references', 'patterns.md'), GOOD_PATTERNS, 'utf8');

  await mkdir(join(skillsRoot, 'medium', 'references'), { recursive: true });
  await writeFile(join(skillsRoot, 'medium', 'SKILL.md'), MEDIUM, 'utf8');
  await writeFile(join(skillsRoot, 'medium', 'references', 'orphan.md'), MEDIUM_ORPHAN, 'utf8');

  await mkdir(join(skillsRoot, 'bad', 'references'), { recursive: true });
  await writeFile(join(skillsRoot, 'bad', 'SKILL.md'), BAD, 'utf8');
  await writeFile(join(skillsRoot, 'bad', 'references', 'orphan.md'), BAD_ORPHAN, 'utf8');

  // Backdate the instruction files so `exposureDays` is old enough for the
  // usage dimension to be *applicable*; usage sufficiency then comes from the
  // session fixtures below rather than from a zero-day-old file.
  const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  for (const skill of skills) await utimes(join(skill.dir, 'SKILL.md'), past, past);
}

async function writeUsageFixtures() {
  const now = Date.now();
  const line = (name) => JSON.stringify({
    type: 'tool/call',
    data: { name: 'skill', arguments: JSON.stringify({ name }) },
    time: now - 60_000,
  });
  for (let index = 0; index < 5; index += 1) {
    const dir = join(dshHome, 'sessions', 'workspace', `session-${index}`);
    await mkdir(dir, { recursive: true });
    const rows = [line('good')];
    if (index === 0) rows.push(line('good'), line('good'), line('medium'));
    await writeFile(join(dir, 'session.jsonl'), rows.join('\n') + '\n', 'utf8');
  }
}

const scanCalls = { list: 0 };

function mockSkills() {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return {
    async list() {
      scanCalls.list += 1;
      return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        whenToUse: null,
        path: join(skill.dir, 'SKILL.md'),
        source: 'user-agents',
        provider: 'filesystem',
      }));
    },
    async get(name) {
      const skill = byName.get(name);
      if (!skill) return undefined;
      const raw = await readFile(join(skill.dir, 'SKILL.md'), 'utf8');
      const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
      return {
        name: skill.name,
        description: skill.description,
        path: join(skill.dir, 'SKILL.md'),
        source: 'user-agents',
        provider: 'filesystem',
        content: match ? raw.slice(match[0].length) : raw,
      };
    },
  };
}

// ------------------------------------------------- request/response helpers

function fakeRequest(method, path, body, headers) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = path;
  request.headers = headers || { host: '127.0.0.1:60304' };
  return request;
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    finished: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk);
      this.finished = true;
    },
  };
}

async function request(method, path, body, headers) {
  const req = fakeRequest(method, path, body, headers);
  const res = fakeResponse();
  await captured.route.handler(req, res);
  let payload = null;
  try {
    payload = res.body ? JSON.parse(res.body) : null;
  } catch {
    payload = res.body;
  }
  return { status: res.statusCode, headers: res.headers, body: payload };
}

const readSkillFile = (name) => readFile(join(skillsRoot, name, 'SKILL.md'));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// --------------------------------------------------------------- run

await writeSkillFixtures();
await writeUsageFixtures();
ctx.skills = mockSkills();

const plugin = await import(new URL('./index.js', import.meta.url).href + '?verify=' + Date.now());
plugin.apply(ctx, {
  windowDays: 30,
  catalogDescriptionMaxLength: 500,
  backupsKeep: 20,
});

// Registration surface.
assert.equal(captured.tools.size, 4, 'four skills360_* tools registered');
assert.deepEqual([...captured.tools.keys()].sort(), ['skills360_evolve', 'skills360_optimize', 'skills360_report', 'skills360_scan']);
assert.ok(captured.route, 'web route registered');
assert.equal(captured.route.kind, 'prefix');
assert.equal(captured.route.path, '/api/skills-360');
assert.equal(typeof captured.route.handler, 'function');
assert.equal(captured.route.resource, undefined, 'registered as a raw WebRoute handler');

// ------------------------------------------------------- 1. scan
let response = await request('GET', '/api/skills-360/scan');
assert.equal(response.status, 200);
assert.equal(response.body.ok, true);
let portfolio = response.body.data;
assert.equal(portfolio.totals.skills, 3, 'all three fixtures scored');
assert.equal(portfolio.skills.length, 3);
assert.equal(portfolio.sessionsScanned, 5, 'usage fixtures were scanned');
assert.equal(portfolio.usageAvailable, true);
for (const report of portfolio.skills) {
  assert.equal(typeof report.score.total, 'number', `score for ${report.name}`);
  assert.ok(report.score.total >= 0 && report.score.total <= 100);
  assert.ok(['A', 'B', 'C', 'D'].includes(report.score.grade));
  assert.ok(Array.isArray(report.findings) && report.findings.length > 0, `findings for ${report.name}`);
  assert.ok(Array.isArray(report.suggestions), `suggestions for ${report.name}`);
}
const sortedTotals = portfolio.skills.map((report) => report.score.total);
assert.deepEqual(sortedTotals, sortedTotals.slice().sort((a, b) => a - b), 'worst skills first');
const goodReport = portfolio.skills.find((report) => report.name === 'good');
assert.ok(goodReport.usage.count >= 3, 'usage evidence reached the good skill');
assert.ok(goodReport.usage.sufficient, 'usage dimension is applicable');

// Cache: a second GET inside the 60s TTL must not rediscover; refresh=1 must.
const callsAfterFirstScan = scanCalls.list;
const cachedScan = await request('GET', '/api/skills-360/scan');
assert.equal(cachedScan.body.data.generatedAt, portfolio.generatedAt, '60s cache reused');
assert.equal(scanCalls.list, callsAfterFirstScan, 'cached scan did not rediscover skills');
await request('GET', '/api/skills-360/scan?refresh=1');
assert.equal(scanCalls.list, callsAfterFirstScan + 1, 'refresh=1 forces a rescan');
// Concurrent cold scans share one in-flight promise.
const sharedBefore = scanCalls.list;
await Promise.all([
  request('GET', '/api/skills-360/scan?windowDays=41'),
  request('GET', '/api/skills-360/scan?windowDays=41'),
]);
assert.equal(scanCalls.list, sharedBefore + 1, 'concurrent scans share one promise');

// Config fallback for out-of-range values.
const normalized = plugin.__internals.normalizeConfig({ windowDays: -1, catalogDescriptionMaxLength: 'abc', backupsKeep: 0 });
assert.deepEqual(normalized, { windowDays: 30, catalogDescriptionMaxLength: 500, backupsKeep: 20, evolution: true });

console.log('PASS 1 scan:', portfolio.totals.skills, 'skills,', portfolio.totals.avgScore, 'avg,',
  portfolio.skills.map((report) => `${report.name}=${report.score.total}${report.score.grade}`).join(' '),
  '| cache hit/refresh/concurrent ok');

// ------------------------------------------------------- 2. detail
response = await request('GET', '/api/skills-360/skill?name=good');
assert.equal(response.status, 200);
const detail = response.body.data;
assert.ok(detail.body.includes('Accessibility Review'), 'body returned');
assert.ok(detail.raw.startsWith('---'), 'raw skill markdown returned');
assert.ok(detail.raw.includes('name: good'));
assert.ok(Array.isArray(detail.suggestions));
assert.equal(detail.lastBackup, null, 'no backup yet');
assert.equal(detail.score.grade, goodReport.score.grade);
console.log('PASS 2 detail: body', detail.body.length, 'chars, raw', detail.raw.length, 'chars, suggestions', detail.suggestions.length);

// ------------------------------------------------------- 8a. tools (read-only, before any mutation)
const scanTool = captured.tools.get('skills360_scan');
const fullScan = await scanTool.execute({ detail: 'full' });
assert.ok(fullScan && Array.isArray(fullScan.skills) && fullScan.skills[0].score.dimensions, 'full scan keeps dimensions');
assert.doesNotThrow(() => JSON.stringify(fullScan), 'full scan is JSON-serializable');
const reportTool = captured.tools.get('skills360_report');
const optimizeTool = captured.tools.get('skills360_optimize');

const summary = await scanTool.execute({});
assert.equal(summary.totals.skills, 3);
assert.equal(summary.skills.length, 3);
const summaryGood = summary.skills.find((entry) => entry.name === 'good');
assert.equal(typeof summaryGood.total, 'number');
assert.equal(typeof summaryGood.verdict, 'string');
assert.ok('topFinding' in summaryGood);
assert.ok(Array.isArray(summary.overlaps));
assert.ok(Array.isArray(summary.quickWins));
const full = await scanTool.execute({ detail: 'full' });
assert.equal(full.skills.length, 3);
assert.ok(full.skills[0].metrics && typeof full.skills[0].metrics.bodyChars === 'number');

const markdown = await reportTool.execute({});
assert.ok(markdown.markdown.length > 200, 'markdown report has substance');
assert.ok(markdown.markdown.includes('# Skills 360'));
assert.match(markdown.markdown, /SkillReport|技能|总分|平均分/);
assert.equal(markdown.path, undefined, 'save defaults to false');

const beforeOptimizeHashes = new Map();
for (const skill of skills) beforeOptimizeHashes.set(skill.name, sha256(await readSkillFile(skill.name)));

const dryRun = await optimizeTool.execute({ dryRun: true });
assert.equal(dryRun.dryRun, true);
assert.ok(dryRun.plans.length >= 1, 'dry-run found at least one eligible plan');
assert.ok(dryRun.plans.every((plan) => plan.actionIds.length > 0));
assert.ok(
  dryRun.plans.some((plan) => plan.writes.some((write) => write.path === 'SKILL.md')),
  'dry-run reports the planned writes',
);
for (const skill of skills) {
  assert.equal(sha256(await readSkillFile(skill.name)), beforeOptimizeHashes.get(skill.name), `dryRun must not touch ${skill.name}`);
}
console.log('PASS 8 tools: scan totals', summary.totals.skills, '| report', markdown.markdown.length,
  'chars | optimize dryRun', dryRun.plans.length, 'plans, files untouched');

// ------------------------------------------------------- export route (bonus contract §4)
response = await request('POST', '/api/skills-360/export', {});
assert.equal(response.status, 200);
assert.ok(response.body.data.path.endsWith('.md'));
assert.ok(response.body.data.path.startsWith(reportDir));
const exported = await readFile(response.body.data.path, 'utf8');
assert.ok(exported.startsWith('# Skills 360'));
console.log('PASS export:', response.body.data.path.replace(root, '<tmp>'));

// ------------------------------------------------------- 3. apply
let fresh = (await request('GET', '/api/skills-360/scan?refresh=1')).body.data;
let badReport = fresh.skills.find((report) => report.name === 'bad');
const badAuto = badReport.suggestions.filter((suggestion) => suggestion.kind === 'auto');
assert.ok(badAuto.length >= 1, 'the bad fixture has an auto suggestion to apply');
const chosen = badAuto.find((suggestion) => suggestion.id === 'fix.link-references') || badAuto[0];
const badBefore = await readSkillFile('bad');
const badBeforeHash = sha256(badBefore);

response = await request('POST', '/api/skills-360/apply', { name: 'bad', actionIds: [chosen.id] });
assert.equal(response.status, 200, JSON.stringify(response.body));
const applied = response.body.data;
assert.ok(typeof applied.backupId === 'string' && applied.backupId.length > 0, 'backupId returned');
assert.ok(Array.isArray(applied.changed) && applied.changed.length >= 1, 'changed files reported');
assert.ok(applied.changed.some((entry) => entry.path === 'SKILL.md'), 'SKILL.md changed');
assert.equal(typeof applied.beforeTotal, 'number');
assert.equal(typeof applied.afterTotal, 'number');
assert.equal(typeof applied.report.score.total, 'number', 're-analyzed report carries a fresh score');
assert.ok(typeof applied.diff === 'string' && applied.diff.length > 0, 'diff returned');

const badAfter = await readSkillFile('bad');
assert.notEqual(sha256(badAfter), badBeforeHash, 'the file really changed on disk');
if (chosen.id === 'fix.link-references') {
  assert.ok(
    badAfter.includes('## References') || badAfter.includes('## 参考资源'),
    'link-references appended a reference section',
  );
}

const manifestPath = join(backupRoot, applied.backupId, 'manifest.json');
await access(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.id, applied.backupId);
assert.equal(manifest.skill, 'bad');
assert.ok(Array.isArray(manifest.files) && manifest.files.some((file) => file.path === 'SKILL.md'));
assert.ok(manifest.actions.includes(chosen.id));
console.log('PASS 3 apply:', chosen.id, 'on bad |', applied.beforeTotal, '->', applied.afterTotal,
  '| backup', applied.backupId, '| changed', applied.changed.length);

// ------------------------------------------------------- 4. undo
const backupsResponse = await request('GET', '/api/skills-360/backups');
assert.equal(backupsResponse.status, 200);
assert.ok(backupsResponse.body.data.some((entry) => entry.id === applied.backupId));

response = await request('POST', '/api/skills-360/undo', { backupId: applied.backupId });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.data.backupId, applied.backupId);
assert.ok(response.body.data.restored.includes('SKILL.md'));
const badRestored = await readSkillFile('bad');
assert.ok(badRestored.equals(badBefore), 'undo restored the file byte for byte');
console.log('PASS 4 undo: restored SKILL.md byte-for-byte (', badRestored.length, 'bytes )');

// ------------------------------------------------------- 5. apply-all safeOnly
fresh = (await request('GET', '/api/skills-360/scan?refresh=1')).body.data;
const autoIds = new Map();
const draftIds = new Map();
for (const report of fresh.skills) {
  autoIds.set(report.name, new Set(report.suggestions.filter((item) => item.kind === 'auto').map((item) => item.id)));
  draftIds.set(report.name, new Set(report.suggestions.filter((item) => item.kind === 'draft').map((item) => item.id)));
}
const allDraftIds = [...draftIds.values()].flatMap((set) => [...set]);
assert.ok(allDraftIds.length >= 1, 'fixtures produce draft suggestions');
assert.ok([...autoIds.values()].some((set) => set.size > 0), 'fixtures produce auto suggestions');

response = await request('POST', '/api/skills-360/apply-all', { safeOnly: true });
assert.equal(response.status, 200, JSON.stringify(response.body));
const applyAll = response.body.data;
assert.ok(Array.isArray(applyAll.applied) && applyAll.applied.length >= 1, 'apply-all applied something');
assert.equal(applyAll.backupIds.length, applyAll.applied.length, 'one backup per applied skill');
for (const entry of applyAll.applied) {
  assert.ok(Array.isArray(entry.actionIds) && entry.actionIds.length >= 1, `actionIds for ${entry.name}`);
  assert.equal(typeof entry.beforeTotal, 'number');
  assert.equal(typeof entry.afterTotal, 'number');
  for (const actionId of entry.actionIds) {
    assert.ok(autoIds.get(entry.name).has(actionId), `${actionId} is an auto action for ${entry.name}`);
    assert.equal(allDraftIds.includes(actionId), false, `${actionId} must never be applied by safeOnly`);
  }
}
const mediumAfterAll = await readFile(join(skillsRoot, 'medium', 'SKILL.md'), 'utf8');
assert.equal(
  /^##\s+(?:何时不用|when not to use)\b/im.test(mediumAfterAll),
  false,
  'draft boundary skeleton was not applied',
);
assert.ok(applyAll.applied.some((entry) => entry.name === 'bad'), 'bad skill autos applied');
console.log('PASS 5 apply-all safeOnly: applied',
  applyAll.applied.map((entry) => `${entry.name}[${entry.actionIds.join(',')}]`).join(' '),
  '| skipped', applyAll.skipped.length, '| drafts withheld', allDraftIds.join(','));

// 5b. batch undo reverses every backup of the apply-all run.
response = await request('POST', '/api/skills-360/undo', { backupIds: applyAll.backupIds });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.data.backups.length, applyAll.backupIds.length);
assert.ok(response.body.data.restored.length >= applyAll.backupIds.length);
console.log('PASS 5b batch undo:', response.body.data.backups.length, 'backup(s) restored');

// ------------------------------------------------------- 6. auth
captured.rejection = 401;
response = await request('GET', '/api/skills-360/scan');
assert.equal(response.status, 401);
assert.equal(response.body.ok, false);
assert.equal(response.body.error.code, 'unauthorized');
captured.rejection = undefined;

response = await request('GET', '/api/skills-360/scan');
assert.equal(response.status, 200);

captured.connection = false;
response = await request('GET', '/api/skills-360/scan');
assert.equal(response.status, 503);
assert.equal(response.body.error.code, 'unavailable');
captured.connection = true;
console.log('PASS 6 auth: rejection -> 401, missing connection -> 503, restored -> 200');

// ------------------------------------------------------- 7. errors + path safety
response = await request('POST', '/api/skills-360/apply', { name: 'bad', actionIds: ['fix.not-a-real-action'] });
assert.equal(response.status, 400, JSON.stringify(response.body));
assert.equal(response.body.error.code, 'invalid-argument');

response = await request('POST', '/api/skills-360/apply', { name: '../../etc/passwd', actionIds: ['fix.link-references'] });
assert.ok(response.status === 404 || response.status === 400, 'traversal-ish skill name rejected');

response = await request('POST', '/api/skills-360/apply', { name: 'bad', actionIds: ['../../x'] });
assert.equal(response.status, 400, 'action id that looks like a path is rejected');

response = await request('GET', '/api/skills-360/skill?name=not-a-skill');
assert.equal(response.status, 404);
assert.equal(response.body.error.code, 'not-found');

response = await request('GET', '/api/skills-360/skill?name=' + encodeURIComponent('../../etc/passwd'));
assert.equal(response.status, 404, 'path-like name is not a catalog name');

response = await request('POST', '/api/skills-360/undo', { backupId: '../../etc' });
assert.equal(response.status, 400);
assert.equal(response.body.error.code, 'invalid-argument');

response = await request('PUT', '/api/skills-360/scan', {});
assert.equal(response.status, 405);
assert.equal(response.headers.allow, 'GET, HEAD, POST');

const { __internals } = plugin;
const badDir = join(skillsRoot, 'bad');
assert.throws(() => __internals.assertSafeRelPath(badDir, '../x'), /Refusing path traversal|unsafe/);
assert.throws(() => __internals.assertSafeRelPath(badDir, '/etc/passwd'), /absolute|unsafe/i);
assert.throws(() => __internals.assertSafeRelPath(badDir, 'references/../../x'), /Refusing path traversal|unsafe/);
assert.throws(() => __internals.assertSafeRelPath(badDir, 'scripts/run.sh'), /only SKILL.md|Refusing to write/);
assert.throws(() => __internals.assertSafeReportFile(reportDir, '../evil.md'), /Unsafe report|escapes/);

// A symlinked `references/` must not smuggle a write outside the skill dir.
const escapeSkill = join(root, 'symlink-skill');
const outsideRefs = join(root, 'outside-refs');
await mkdir(escapeSkill, { recursive: true });
await mkdir(outsideRefs, { recursive: true });
await writeFile(join(escapeSkill, 'SKILL.md'), '---\nname: escape\ndescription: "x"\n---\n# x\n', 'utf8');
await symlink(outsideRefs, join(escapeSkill, 'references'), 'dir');
await assert.rejects(
  () => __internals.ensureInsideReal(escapeSkill, join(escapeSkill, 'references', 'evil.md')),
  /outside the skill directory|unsafe/i,
  'symlinked references/ is refused at write time',
);
console.log('PASS 7 errors: unknown action -> 400, missing name -> 404, traversal/symlink -> refused');

// ------------------------------------------------------- 9. evolution (v0.2)
// Synthetic session: skill load -> user correction -> tool error -> reload ->
// non-completed turn. Core's collectUsage turns this into pending signals.
{
  const now = Date.now();
  const evoDir = join(dshHome, 'sessions', 'evo-ws', 'evo-session-1');
  await mkdir(evoDir, { recursive: true });
  const evoRows = [
    { type: 'user/message', data: { text: '加载无障碍审查技能' }, time: now - 6 * 60_000 },
    { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'good' }) }, time: now - 5 * 60_000 },
    { type: 'user/message', data: { text: '不对，不是这样，重新做' }, time: now - 4 * 60_000 },
    { type: 'tool/result', data: { message: { isError: true, content: 'checklist step failed' } }, time: now - 3 * 60_000 },
    { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'good' }) }, time: now - 2 * 60_000 },
    { type: 'turn/end', data: { reason: { kind: 'interrupted' } }, time: now - 1 * 60_000 },
  ].map((row) => JSON.stringify(row));
  await writeFile(join(evoDir, 'session.jsonl'), evoRows.join('\n') + '\n', 'utf8');
}

fresh = (await request('GET', '/api/skills-360/scan?refresh=1')).body.data;
const goodEvo = fresh.skills.find((report) => report.name === 'good');
assert.ok(goodEvo.evolution, 'evolution block present on report');
assert.equal(goodEvo.evolution.pending.hasUnclosed, true, 'pending evolution signal detected for good');
const summaryGoodEvo = (await scanTool.execute({})).skills.find((entry) => entry.name === 'good');
assert.ok(summaryGoodEvo && typeof summaryGoodEvo.evolution === 'object', 'scan summary carries evolution');
assert.equal(summaryGoodEvo.evolution.hasUnclosed, true, 'scan summary reflects pending signal');
console.log('PASS 9a evolution scan: good hasUnclosed =', goodEvo.evolution.pending.hasUnclosed,
  '| pendingScore', goodEvo.evolution.pending.score);

// --- POST /evolve dryRun (no write)
const goodBeforeHash2 = sha256(await readSkillFile('good'));
const lessonsPath = join(skillsRoot, 'good', 'references', 'lessons.md');
await assert.rejects(() => access(lessonsPath), /ENOENT/, 'lessons.md absent before evolve');

response = await request('POST', '/api/skills-360/evolve', {
  name: 'good',
  lesson: { trigger: '用户说不要改测试', rule: '先跑现有测试再改实现', evidence: 'session evo-session-1' },
  dryRun: true,
});
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.data.dryRun, true);
assert.ok(Array.isArray(response.body.data.plan.writes), 'dryRun plan carries writes');
assert.equal(sha256(await readSkillFile('good')), goodBeforeHash2, 'evolve dryRun must not touch SKILL.md');
await assert.rejects(() => access(lessonsPath), /ENOENT/, 'evolve dryRun must not create lessons.md');

// --- POST /evolve write
response = await request('POST', '/api/skills-360/evolve', {
  name: 'good',
  lesson: { trigger: '用户说不要改测试', rule: '先跑现有测试再改实现', evidence: 'session evo-session-1' },
});
assert.equal(response.status, 200, JSON.stringify(response.body));
const evolved = response.body.data;
assert.equal(evolved.dryRun, false);
assert.ok(typeof evolved.backupId === 'string' && evolved.backupId.length > 0, 'evolve returns backupId');
await access(lessonsPath);
const lessonsText = await readFile(lessonsPath, 'utf8');
assert.match(lessonsText, /先跑现有测试再改实现/, 'lessons.md contains the rule');
const goodAfterEvo = await readFile(join(skillsRoot, 'good', 'SKILL.md'), 'utf8');
assert.match(goodAfterEvo, /lessons\.md/, 'SKILL.md links lessons.md');
await access(join(backupRoot, evolved.backupId, 'manifest.json'));
assert.equal(evolved.report.evolution.lessons.count, 1, 're-analyzed lessons count is 1');
assert.equal(evolved.report.evolution.pending.hasUnclosed, false, 'writing a lesson closes the same-day signal loop');
assert.equal(typeof evolved.beforeTotal, 'number');
assert.equal(typeof evolved.afterTotal, 'number');
console.log('PASS 9b evolve write: backup', evolved.backupId,
  '| lessons.count', evolved.report.evolution.lessons.count,
  '| SKILL.md links lessons.md');

// --- undo restores
response = await request('POST', '/api/skills-360/undo', { backupId: evolved.backupId });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(sha256(await readSkillFile('good')), goodBeforeHash2, 'undo restores SKILL.md byte-for-byte');
await assert.rejects(() => access(lessonsPath), /ENOENT/, 'undo removes lessons.md');
console.log('PASS 9c evolve undo: SKILL.md restored, lessons.md removed');

// --- skills360_evolve tool
const evolveTool = captured.tools.get('skills360_evolve');
const proposals = await evolveTool.execute({});
assert.equal(proposals.dryRun, true);
assert.ok(Array.isArray(proposals.proposals), 'proposals is an array');
assert.ok(proposals.proposals.some((p) => p.name === 'good' && p.hasUnclosed === true), 'good is an unclosed proposal');
assert.ok(proposals.totals && typeof proposals.totals === 'object', 'totals.evolution carried');
const filtered = await evolveTool.execute({ names: ['good'] });
assert.ok(filtered.proposals.every((p) => p.name === 'good'), 'names filter applied');

const toolWrite = await evolveTool.execute({
  name: 'good',
  lesson: { trigger: '用户纠正了触发词', rule: '按用户原话补触发词' },
  dryRun: false,
});
assert.equal(toolWrite.dryRun, false);
assert.equal(toolWrite.name, 'good');
assert.ok(typeof toolWrite.backupId === 'string' && toolWrite.backupId.length > 0, 'tool write returns backupId');
assert.ok(toolWrite.evolution && typeof toolWrite.evolution === 'object', 'tool write returns evolution');
assert.equal(typeof toolWrite.beforeTotal, 'number');
assert.equal(typeof toolWrite.afterTotal, 'number');
await access(lessonsPath);
const closedProposals = await evolveTool.execute({});
assert.equal(closedProposals.proposals.some((item) => item.name === 'good'), false,
  'a written lesson closes the proposal list');
console.log('PASS 9d evolve tool: dryRun proposals', proposals.proposals.length,
  '| write backupId', toolWrite.backupId, '| closed proposals', closedProposals.proposals.length);

await assert.rejects(
  evolveTool.execute({ name: 'good', lesson: { trigger: 'x', rule: '   ' }, dryRun: false }),
  (error) => error && error.code === 'invalid-argument',
  'empty rule -> invalid-argument',
);
console.log('PASS 9e evolve tool: empty rule rejected (400/invalid-argument)');

// ------------------------------------------------------- cleanup
await rm(root, { recursive: true, force: true });

console.log('\nALL CHECKS PASSED — host verification complete (9 groups).');
