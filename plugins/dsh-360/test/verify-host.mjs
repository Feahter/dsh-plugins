/**
 * Standalone verification for the merged dsh-360 Host.
 *
 * Builds a throwaway skill tree + subject tree + shared DSH_HOME (usage
 * sessions + one profile preset) under `fs.mkdtemp`, wires a mock Cordis
 * context (`ctx.tools` / `ctx.webServer` / `ctx.get` / `ctx.skills`), imports
 * the real plugin, and drives it end to end:
 *
 *   1. registration (3 routes: skills/agents prefix + health; 4 dsh360_* tools)
 *   2. health route ({ version, surfaces })
 *   3. skills + agents scan/detail (scores, findings, usage evidence)
 *   4. apply + undo byte-for-byte restore on BOTH surfaces
 *   5. all four tools (scan both/skills/agents, report, optimize dryRun,
 *      evolve dryRun)
 *   6. auth (401 rejection, 503 without connection)
 *   7. error mapping + path-traversal / symlink-escape refusal
 *   8. backup roots / report dir land under <DSH_HOME>/dsh-360/
 *
 * Every WRITE is scoped to the temp fixtures via skill name / subject id, so
 * the real `~/.claude` / `~/.dsh` surfaces that discovery also walks are only
 * ever READ, never modified.
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'dsh360-'));
process.once('exit', () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

const dshHome = join(root, 'dsh');
const skillsRoot = join(root, 'skills');
const subjectsRoot = join(root, 'subjects');
const dataDir = join(dshHome, 'dsh-360');
const skillsBackupRoot = join(dataDir, 'backups', 'skills');
const agentsBackupRoot = join(dataDir, 'backups', 'agents');
const reportDir = join(dataDir, 'reports');

process.env.DSH_HOME = dshHome;

const captured = {
  tools: new Map(),
  routes: [],
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
      captured.routes.push(route);
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
`;

const GOOD_CHECKLIST = `# Accessibility checklist

- Landmarks present.
- Every control has a name.
- Focus order matches visual order.
`;

const BAD_LONG_DESCRIPTION = [
  'Use when the user wants to organise scattered notes into a searchable archive with tags and an index.',
  'It collects loose notes, groups them by topic, tags each entry, builds a table of contents, tracks revisions, exports weekly digests, and keeps a changelog.',
].join(' ');

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

const AGENTS_MD = `# 项目说明书

## 概述

快速开始：先读本文件，再跑下面的检查。

## 工作流

1. 读取配置。
2. 检查依赖。
3. 运行 \`node --test\`。
4. 提交前检查。

## 边界

本说明书仅适用于本仓库；不要用它来做其他项目的决策。
`;

const AGENT_MD = `---
name: frobnicate-inspector
description: "Inspect a repository for structural drift. Use when the user asks to run the frobnicate inspector."
---
# Frobnicate Inspector

## Overview

Inspect the repository and note key modules.

## Workflow

1. Read the entry files.
2. Check for TODO markers.
`;

const AGENT_NOTES = `# Checklist

- Verify entry files.
- Verify TODO scan.
`;

const PROFILE_PATCH = `- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
    model: deepseek-flash

- id: agent-preset-registry
  name: "@deepseek-ai/dsh-agent-preset-registry"
  config:
    default: standard
    selectedDefault: router

- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
      danger-full-access:
        sandbox: danger-full-access
`;

const instrPath = join(subjectsRoot, 'AGENTS.md');
const agentPath = join(subjectsRoot, 'agents', 'myagent.md');

async function writeFixtures() {
  // skills
  await mkdir(join(skillsRoot, 'good', 'references'), { recursive: true });
  await writeFile(join(skillsRoot, 'good', 'SKILL.md'), GOOD, 'utf8');
  await writeFile(join(skillsRoot, 'good', 'references', 'checklist.md'), GOOD_CHECKLIST, 'utf8');
  await mkdir(join(skillsRoot, 'bad', 'references'), { recursive: true });
  await writeFile(join(skillsRoot, 'bad', 'SKILL.md'), BAD, 'utf8');
  await writeFile(join(skillsRoot, 'bad', 'references', 'orphan.md'), BAD_ORPHAN, 'utf8');

  // agents
  await mkdir(join(subjectsRoot, 'agents'), { recursive: true });
  await mkdir(join(subjectsRoot, 'agent-notes'), { recursive: true });
  await writeFile(instrPath, AGENTS_MD, 'utf8');
  await writeFile(agentPath, AGENT_MD, 'utf8');
  await writeFile(join(subjectsRoot, 'agent-notes', 'checklist.md'), AGENT_NOTES, 'utf8');

  // profile preset
  await mkdir(join(dshHome, 'profiles', 'desktop'), { recursive: true });
  await writeFile(join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), PROFILE_PATCH, 'utf8');

  // shared usage sessions: drive both surfaces.
  const now = Date.now();
  for (let index = 0; index < 5; index += 1) {
    const dir = join(dshHome, 'sessions', 'ws', `sess-${index}`);
    await mkdir(dir, { recursive: true });
    const rows = [
      { type: 'session', cwd: subjectsRoot, agentPreset: 'router', time: now - 600_000 },
      { type: 'request/header', data: { header: { config: { model: 'deepseek-flash' } } }, time: now - 590_000 },
      { type: 'system/message', data: { text: `Instructions from: ${instrPath}\nYou are an AI agent.` }, time: now - 580_000 },
      { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'good' }) }, time: now - 570_000 },
      { type: 'subagent/catalog', data: { label: 'frobnicate-inspector' }, time: now - 560_000 },
      { type: 'agent-preset/selected', data: { agentPreset: 'router' }, time: now - 550_000 },
    ];
    if (index === 0) {
      // post-load correction -> error -> reload -> non-completed turn: opens a
      // pending evolution signal for the `good` skill.
      rows.push(
        { type: 'user/message', data: { text: '不对，不是这样，重新做' }, time: now - 540_000 },
        { type: 'tool/result', data: { message: { isError: true, content: 'checklist step failed' } }, time: now - 530_000 },
        { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'good' }) }, time: now - 520_000 },
        { type: 'turn/end', data: { reason: { kind: 'interrupted' } }, time: now - 510_000 },
      );
    }
    await writeFile(join(dir, 'session.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }

  // Backdate the fixture files so exposureDays is non-trivial.
  const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await utimes(join(skillsRoot, 'good', 'SKILL.md'), past, past);
  await utimes(join(skillsRoot, 'bad', 'SKILL.md'), past, past);
  await utimes(instrPath, past, past);
  await utimes(agentPath, past, past);
}

const scanCalls = { list: 0 };

function mockSkills() {
  const skills = [
    {
      name: 'good',
      dir: join(skillsRoot, 'good'),
      description: 'Review a React component tree for accessibility gaps. Use when the user asks for an a11y review, a WCAG audit, a keyboard navigation check, or an ARIA labelling review.',
    },
    {
      name: 'bad',
      dir: join(skillsRoot, 'bad'),
      description: BAD_LONG_DESCRIPTION,
    },
  ];
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

function routeFor(path) {
  const matches = captured.routes
    .filter((route) => route.path === path || path.startsWith(route.path + '/'))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0] || null;
}

async function request(method, path, body, headers) {
  const route = routeFor(path);
  assert.ok(route, `no registered route matches ${path}`);
  const req = fakeRequest(method, path, body, headers);
  const res = fakeResponse();
  await route.handler(req, res);
  let payload = null;
  try {
    payload = res.body ? JSON.parse(res.body) : null;
  } catch {
    payload = res.body;
  }
  return { status: res.statusCode, headers: res.headers, body: payload };
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// --------------------------------------------------------------- run

await writeFixtures();
ctx.skills = mockSkills();

const plugin = await import(new URL('../index.js', import.meta.url).href + '?verify=' + Date.now());
plugin.apply(ctx, {
  windowDays: 30,
  catalogDescriptionMaxLength: 500,
  backupsKeep: 20,
  evolution: true,
  roots: [subjectsRoot],
  maxDepth: 6,
});

// 1. registration surface -------------------------------------------------
assert.equal(captured.tools.size, 4, 'four dsh360_* tools registered');
assert.deepEqual(
  [...captured.tools.keys()].sort(),
  ['dsh360_evolve', 'dsh360_optimize', 'dsh360_report', 'dsh360_scan'],
);

const routePaths = captured.routes.map((route) => route.path).sort();
assert.deepEqual(routePaths, ['/api/dsh-360/agents', '/api/dsh-360/health', '/api/dsh-360/skills']);
for (const route of captured.routes) {
  assert.equal(route.kind, 'prefix', `${route.path} is a prefix route`);
  assert.equal(typeof route.handler, 'function', `${route.path} has a handler`);
}

console.log('PASS 1 registration:', routePaths.join(', '), '| tools',
  [...captured.tools.keys()].sort().join(', '));

// 2. health route ---------------------------------------------------------
let response = await request('GET', '/api/dsh-360/health');
assert.equal(response.status, 200);
assert.equal(response.body.ok, true);
assert.equal(response.body.data.surfaces[0], 'skills');
assert.equal(response.body.data.surfaces[1], 'agents');
assert.equal(typeof response.body.data.version, 'string');
console.log('PASS 2 health:', JSON.stringify(response.body.data));

// 3. skills scan/detail ---------------------------------------------------
response = await request('GET', '/api/dsh-360/skills/scan');
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.ok, true);
let skillsPortfolio = response.body.data;
assert.equal(skillsPortfolio.totals.skills, 2, 'two skills scored');
assert.equal(skillsPortfolio.sessionsScanned, 5, 'usage fixtures scanned');
assert.equal(skillsPortfolio.usageAvailable, true);
for (const report of skillsPortfolio.skills) {
  assert.equal(typeof report.score.total, 'number', `score for ${report.name}`);
  assert.ok(report.score.total >= 0 && report.score.total <= 100);
  assert.ok(typeof report.score.grade === 'string' && report.score.grade.length >= 1);
  assert.ok(['S', 'A', 'B', 'C', 'D', 'E'].includes(report.score.letter), `letter for ${report.name}`);
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.suggestions));
}
const goodReport = skillsPortfolio.skills.find((report) => report.name === 'good');
assert.ok(goodReport.usage.count >= 5, 'skill-load usage evidence reached good');

response = await request('GET', '/api/dsh-360/skills/skill?name=good');
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok(response.body.data.body.includes('Accessibility Review'), 'skill body returned');
assert.ok(response.body.data.raw.startsWith('---'), 'skill raw markdown returned');
console.log('PASS 3 skills scan/detail:', skillsPortfolio.skills.length, 'skills | good usage',
  goodReport.usage.count);

// 4. agents scan/detail ---------------------------------------------------
response = await request('GET', '/api/dsh-360/agents/scan');
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.ok, true);
let agentsPortfolio = response.body.data;
assert.ok(Array.isArray(agentsPortfolio.subjects) && agentsPortfolio.subjects.length >= 2);
for (const report of agentsPortfolio.subjects) {
  assert.equal(typeof report.score.total, 'number', `score for ${report.id}`);
  assert.ok(report.score.total >= 0 && report.score.total <= 100);
  assert.ok(['S', 'A', 'B', 'C', 'D', 'E'].includes(report.score.letter));
  assert.ok(Array.isArray(report.findings));
  assert.ok(Array.isArray(report.suggestions));
}
const instrReport = agentsPortfolio.subjects.find((report) => report.path === instrPath);
const agentReport = agentsPortfolio.subjects.find((report) => report.path === agentPath);
const presetReport = agentsPortfolio.subjects.find((report) => report.kind === 'preset');
assert.ok(instrReport, 'instruction subject present');
assert.ok(agentReport, 'agent subject present');
assert.ok(presetReport, 'profile preset subject synthesized');
assert.equal(instrReport.kind, 'instruction');
assert.equal(agentReport.kind, 'agent');
assert.ok(instrReport.injection.sessionsInjected >= 2, 'injection evidence reached the instruction subject');
assert.ok(agentReport.usage.subagentRuns >= 1, 'delegation evidence reached the agent subject');

response = await request('GET', '/api/dsh-360/agents/subject?id=' + encodeURIComponent(instrReport.id));
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok(response.body.data.body.includes('项目说明书'), 'subject body returned');
console.log('PASS 4 agents scan/detail:', agentsPortfolio.subjects.length, 'subjects |',
  'instruction + agent + preset discovered');

// 5. tools (read-only) ----------------------------------------------------
const scanTool = captured.tools.get('dsh360_scan');
const reportTool = captured.tools.get('dsh360_report');
const optimizeTool = captured.tools.get('dsh360_optimize');
const evolveTool = captured.tools.get('dsh360_evolve');

// scan both / skills / agents
const bothScan = await scanTool.execute({});
assert.equal(typeof bothScan.surfaces.skills, 'object');
assert.equal(typeof bothScan.surfaces.agents, 'object');
assert.equal(bothScan.surfaces.skills.skills.length, 2, 'skills summary in both scan');
assert.ok(Array.isArray(bothScan.surfaces.agents.subjects), 'agents summary in both scan');

const skillsScan = await scanTool.execute({ surface: 'skills' });
assert.deepEqual(Object.keys(skillsScan.surfaces), ['skills']);
assert.equal(skillsScan.surfaces.skills.skills.length, 2);

const agentsScan = await scanTool.execute({ surface: 'agents' });
assert.deepEqual(Object.keys(agentsScan.surfaces), ['agents']);
assert.ok(Array.isArray(agentsScan.surfaces.agents.subjects));

const fullScan = await scanTool.execute({ surface: 'skills', detail: 'full' });
assert.doesNotThrow(() => JSON.stringify(fullScan), 'full scan is JSON-serializable');

// report (merged markdown, two sections)
const markdown = await reportTool.execute({});
assert.ok(markdown.markdown.length > 200, 'merged markdown has substance');
assert.equal(markdown.path, undefined, 'save defaults to false');
const skillsOnly = await reportTool.execute({ surface: 'skills' });
assert.ok(skillsOnly.markdown.length > 100, 'skills-only report');

// report save -> <DSH_HOME>/dsh-360/reports/dsh-360-<stamp>.md
const savedReport = await reportTool.execute({ save: true });
assert.ok(typeof savedReport.path === 'string', 'report save returns a path');
assert.ok(savedReport.path.startsWith(reportDir), 'merged report lands in dsh-360/reports');
assert.ok(savedReport.path.includes('dsh-360-'), 'merged report uses the dsh-360- filename');

// optimize dryRun (both surfaces)
const beforeOptimizeHashes = new Map();
beforeOptimizeHashes.set('bad', sha256(await readFile(join(skillsRoot, 'bad', 'SKILL.md'))));
beforeOptimizeHashes.set('instr', sha256(await readFile(instrPath)));

const skillsOptimize = await optimizeTool.execute({ surface: 'skills', dryRun: true });
assert.equal(skillsOptimize.dryRun, true);
assert.ok(Array.isArray(skillsOptimize.plans));
const agentsOptimize = await optimizeTool.execute({ surface: 'agents', dryRun: true });
assert.equal(agentsOptimize.dryRun, true);
assert.ok(Array.isArray(agentsOptimize.plans));
assert.equal(sha256(await readFile(join(skillsRoot, 'bad', 'SKILL.md'))), beforeOptimizeHashes.get('bad'), 'optimize dryRun must not touch SKILL.md');
assert.equal(sha256(await readFile(instrPath)), beforeOptimizeHashes.get('instr'), 'optimize dryRun must not touch AGENTS.md');

// evolve dryRun (both surfaces)
const skillsEvolve = await evolveTool.execute({ surface: 'skills', dryRun: true });
assert.equal(skillsEvolve.dryRun, true);
assert.ok(Array.isArray(skillsEvolve.proposals));
const agentsEvolve = await evolveTool.execute({ surface: 'agents', dryRun: true });
assert.equal(agentsEvolve.dryRun, true);
assert.ok(Array.isArray(agentsEvolve.proposals));

// missing surface -> invalid-argument
await assert.rejects(
  () => optimizeTool.execute({ dryRun: true }),
  (error) => error && error.code === 'invalid-argument',
  'optimize without surface -> invalid-argument',
);
await assert.rejects(
  () => evolveTool.execute({ dryRun: true }),
  (error) => error && error.code === 'invalid-argument',
  'evolve without surface -> invalid-argument',
);

console.log('PASS 5 tools: scan both/skills/agents | report', markdown.markdown.length,
  'chars | optimize dryRun', skillsOptimize.plans.length + agentsOptimize.plans.length,
  'plans | evolve dryRun', skillsEvolve.proposals.length + agentsEvolve.proposals.length, 'proposals');

// 6. skills apply + undo (byte restore) -----------------------------------
let fresh = (await request('GET', '/api/dsh-360/skills/scan?refresh=1')).body.data;
let badReport = fresh.skills.find((report) => report.name === 'bad');
const badAuto = badReport.suggestions.filter((suggestion) => suggestion.kind === 'auto');
assert.ok(badAuto.length >= 1, 'bad fixture has an auto suggestion');
const badChosen = badAuto.find((suggestion) => suggestion.id === 'fix.link-references') || badAuto[0];
const badBefore = await readFile(join(skillsRoot, 'bad', 'SKILL.md'));

response = await request('POST', '/api/dsh-360/skills/apply', { name: 'bad', actionIds: [badChosen.id] });
assert.equal(response.status, 200, JSON.stringify(response.body));
const skillsApplied = response.body.data;
assert.ok(typeof skillsApplied.backupId === 'string' && skillsApplied.backupId.length > 0, 'backupId returned');
assert.ok(Array.isArray(skillsApplied.changed) && skillsApplied.changed.length >= 1, 'changed files reported');
assert.equal(typeof skillsApplied.beforeTotal, 'number');
assert.equal(typeof skillsApplied.afterTotal, 'number');
assert.notEqual(sha256(await readFile(join(skillsRoot, 'bad', 'SKILL.md'))), sha256(badBefore), 'SKILL.md really changed');
await access(join(skillsBackupRoot, skillsApplied.backupId, 'manifest.json'));

response = await request('POST', '/api/dsh-360/skills/undo', { backupId: skillsApplied.backupId });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok((await readFile(join(skillsRoot, 'bad', 'SKILL.md'))).equals(badBefore), 'skills undo restored SKILL.md byte-for-byte');
console.log('PASS 6 skills apply+undo:', badChosen.id, '| backup', skillsApplied.backupId, '| restored byte-for-byte');

// 7. agents apply + undo (byte restore) ----------------------------------
fresh = (await request('GET', '/api/dsh-360/agents/scan?refresh=1')).body.data;
const freshInstr = fresh.subjects.find((report) => report.id === instrReport.id);
const instrAuto = freshInstr.suggestions.filter((suggestion) => suggestion.kind === 'auto');
assert.ok(instrAuto.length >= 1, 'instruction fixture has an auto suggestion');
const instrChosen = instrAuto.find((suggestion) => suggestion.id === 'fix.link-notes') || instrAuto[0];
const instrBefore = await readFile(instrPath);

response = await request('POST', '/api/dsh-360/agents/apply', { id: instrReport.id, actionIds: [instrChosen.id] });
assert.equal(response.status, 200, JSON.stringify(response.body));
const agentsApplied = response.body.data;
assert.ok(typeof agentsApplied.backupId === 'string' && agentsApplied.backupId.length > 0);
assert.ok(Array.isArray(agentsApplied.changed) && agentsApplied.changed.length >= 1);
assert.notEqual(sha256(await readFile(instrPath)), sha256(instrBefore), 'AGENTS.md really changed');
await access(join(agentsBackupRoot, agentsApplied.backupId, 'manifest.json'));

response = await request('POST', '/api/dsh-360/agents/undo', { backupId: agentsApplied.backupId });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok((await readFile(instrPath)).equals(instrBefore), 'agents undo restored AGENTS.md byte-for-byte');
console.log('PASS 7 agents apply+undo:', instrChosen.id, '| backup', agentsApplied.backupId, '| restored byte-for-byte');

// 7b. remaining route endpoints (backups / apply-all / evolve) ------------
response = await request('GET', '/api/dsh-360/skills/backups');
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok(Array.isArray(response.body.data), 'skills /backups returns an array');
response = await request('GET', '/api/dsh-360/agents/backups');
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok(Array.isArray(response.body.data), 'agents /backups returns an array');

// evolve route dryRun (read-only) on both surfaces
const goodName = 'good';
response = await request('POST', '/api/dsh-360/skills/evolve', {
  name: goodName,
  lesson: { trigger: '用户说不要改测试', rule: '先跑现有测试再改实现' },
  dryRun: true,
});
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.data.dryRun, true);
assert.ok(Array.isArray(response.body.data.plan.writes), 'skills evolve dryRun plan carries writes');

response = await request('POST', '/api/dsh-360/agents/evolve', {
  id: instrReport.id,
  lesson: { trigger: '用户说不要改测试', rule: '先跑现有测试再改实现' },
  dryRun: true,
});
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.equal(response.body.data.dryRun, true);
assert.ok(Array.isArray(response.body.data.plan.writes), 'agents evolve dryRun plan carries writes');

// apply-all (scoped by name/id) then batch undo restores byte-for-byte
const badBeforeAll = await readFile(join(skillsRoot, 'bad', 'SKILL.md'));
response = await request('POST', '/api/dsh-360/skills/apply-all', { name: 'bad', safeOnly: true });
assert.equal(response.status, 200, JSON.stringify(response.body));
const skillsAll = response.body.data;
assert.ok(Array.isArray(skillsAll.applied) && skillsAll.applied.length >= 1, 'skills apply-all applied something');
assert.ok(skillsAll.applied.every((entry) => entry.name === 'bad'), 'skills apply-all scoped to bad');
response = await request('POST', '/api/dsh-360/skills/undo', { backupIds: skillsAll.backupIds });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok((await readFile(join(skillsRoot, 'bad', 'SKILL.md'))).equals(badBeforeAll), 'skills apply-all undone byte-for-byte');

const instrBeforeAll = await readFile(instrPath);
response = await request('POST', '/api/dsh-360/agents/apply-all', { id: instrReport.id, safeOnly: true });
assert.equal(response.status, 200, JSON.stringify(response.body));
const agentsAll = response.body.data;
assert.ok(Array.isArray(agentsAll.applied) && agentsAll.applied.length >= 1, 'agents apply-all applied something');
assert.ok(agentsAll.applied.every((entry) => entry.id === instrReport.id), 'agents apply-all scoped to instruction');
response = await request('POST', '/api/dsh-360/agents/undo', { backupIds: agentsAll.backupIds });
assert.equal(response.status, 200, JSON.stringify(response.body));
assert.ok((await readFile(instrPath)).equals(instrBeforeAll), 'agents apply-all undone byte-for-byte');
console.log('PASS 7b route coverage: backups | evolve dryRun | apply-all + batch undo (both surfaces)');

// 8. auth ----------------------------------------------------------------
captured.rejection = 401;
response = await request('GET', '/api/dsh-360/skills/scan');
assert.equal(response.status, 401);
assert.equal(response.body.ok, false);
assert.equal(response.body.error.code, 'unauthorized');
response = await request('GET', '/api/dsh-360/health');
assert.equal(response.status, 401, 'health route also rejects');
captured.rejection = undefined;

captured.connection = false;
response = await request('GET', '/api/dsh-360/skills/scan');
assert.equal(response.status, 503);
assert.equal(response.body.error.code, 'unavailable');
response = await request('GET', '/api/dsh-360/health');
assert.equal(response.status, 503, 'health route fails closed without connection');
captured.connection = true;
console.log('PASS 8 auth: rejection -> 401, missing connection -> 503');

// 9. errors + path safety -------------------------------------------------
response = await request('POST', '/api/dsh-360/skills/apply', { name: 'bad', actionIds: ['fix.not-a-real-action'] });
assert.equal(response.status, 400);
assert.equal(response.body.error.code, 'invalid-argument');

response = await request('POST', '/api/dsh-360/skills/apply', { name: '../../etc/passwd', actionIds: [badChosen.id] });
assert.ok(response.status === 404 || response.status === 400, 'path-like skill name rejected');

response = await request('GET', '/api/dsh-360/skills/skill?name=not-a-skill');
assert.equal(response.status, 404);
assert.equal(response.body.error.code, 'not-found');

response = await request('GET', '/api/dsh-360/agents/subject?id=' + encodeURIComponent('instruction:not-there'));
assert.equal(response.status, 404);
assert.equal(response.body.error.code, 'not-found');

response = await request('POST', '/api/dsh-360/skills/undo', { backupId: '../../etc' });
assert.equal(response.status, 400);
assert.equal(response.body.error.code, 'invalid-argument');

response = await request('PUT', '/api/dsh-360/skills/scan', {});
assert.equal(response.status, 405);
assert.equal(response.headers.allow, 'GET, HEAD, POST');

response = await request('GET', '/api/dsh-360/skills/nope');
assert.equal(response.status, 404);
assert.equal(response.body.error.code, 'not-found');

// path guards + symlink escape (both surfaces)
const skillsInternals = (await import(new URL('../lib/host-skills.js', import.meta.url).href)).__internals;
const agentsInternals = (await import(new URL('../lib/host-agents.js', import.meta.url).href)).__internals;

assert.throws(() => skillsInternals.assertSafeRelPath(join(skillsRoot, 'bad'), '../x'), /path traversal|unsafe/);
assert.throws(() => skillsInternals.assertSafeRelPath(join(skillsRoot, 'bad'), '/etc/passwd'), /absolute|unsafe/i);
assert.throws(() => skillsInternals.assertSafeRelPath(join(skillsRoot, 'bad'), 'scripts/run.sh'), /only SKILL.md|Refusing to write/);
assert.throws(() => skillsInternals.assertSafeReportFile(reportDir, '../evil.md'), /Unsafe report|escapes/);

assert.throws(() => agentsInternals.assertSafeRelPath(subjectsRoot, '../x', 'AGENTS.md'), /path traversal|unsafe/);
assert.throws(() => agentsInternals.assertSafeRelPath(subjectsRoot, '/etc/passwd', 'AGENTS.md'), /absolute|unsafe/i);
assert.throws(() => agentsInternals.assertSafeRelPath(subjectsRoot, 'scripts/run.sh', 'AGENTS.md'), /only the subject file|Refusing to write/);
assert.throws(() => agentsInternals.assertSafeReportFile(reportDir, '../evil.md'), /Unsafe report|escapes/);

// symlinked references/ must not smuggle a write out of the skill dir
const escapeSkill = join(root, 'symlink-skill');
const outsideRefs = join(root, 'outside-refs');
await mkdir(escapeSkill, { recursive: true });
await mkdir(outsideRefs, { recursive: true });
await writeFile(join(escapeSkill, 'SKILL.md'), '---\nname: escape\ndescription: "x"\n---\n# x\n', 'utf8');
await symlink(outsideRefs, join(escapeSkill, 'references'), 'dir');
await assert.rejects(
  () => skillsInternals.ensureInsideReal(escapeSkill, join(escapeSkill, 'references', 'evil.md')),
  /outside the skill directory|unsafe/i,
);

// symlinked agent-notes/ must not smuggle a write out of the subject dir
const escapeSubject = join(root, 'symlink-subject');
const outsideNotes = join(root, 'outside-notes');
await mkdir(escapeSubject, { recursive: true });
await mkdir(outsideNotes, { recursive: true });
await writeFile(join(escapeSubject, 'AGENTS.md'), '# x\n', 'utf8');
await symlink(outsideNotes, join(escapeSubject, 'agent-notes'), 'dir');
await assert.rejects(
  () => agentsInternals.ensureInsideReal(escapeSubject, join(escapeSubject, 'agent-notes', 'evil.md')),
  /outside the subject directory|unsafe/i,
);
console.log('PASS 9 errors: unknown action -> 400, missing name/id -> 404, traversal/symlink -> refused');

// 10. export route -> report dir under dsh-360 ----------------------------
response = await request('POST', '/api/dsh-360/skills/export', {});
assert.equal(response.status, 200);
assert.ok(response.body.data.path.startsWith(reportDir), 'skills export lands in dsh-360/reports');
response = await request('POST', '/api/dsh-360/agents/export', {});
assert.equal(response.status, 200);
assert.ok(response.body.data.path.startsWith(reportDir), 'agents export lands in dsh-360/reports');
console.log('PASS 10 export: reports under', reportDir.replace(root, '<tmp>'));

// cleanup
await rm(root, { recursive: true, force: true });

console.log('\n✓ ALL CHECKS PASSED — dsh-360 host verification complete.');
