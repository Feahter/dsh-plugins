/**
 * Taxonomy tests — the four-axis classification contract (TAXONOMY-SPEC §2–§3).
 *
 * Table-driven on purpose: the fixtures mirror real catalog entries (office,
 * code-review-expert, frontend-slides, guizang-voice, find-skills, commit,
 * deep-research, fmt) plus the two structural skill shapes (routing, layered)
 * and the agent kinds (agent / preset / instruction). Every tag is checked
 * against `taxonomyCatalog()` so the UI can never receive an id it cannot
 * label, and every classification is checked for determinism (two calls
 * deep-equal) and summary length (≤60).
 *
 * No disk I/O and no dependency on this machine's mutable skill catalog.
 */
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  AGENT_KINDS,
  ROLES,
  SCOPES,
  SKILL_KINDS,
  STATES,
  TAXONOMY_VERSION,
  classificationTags,
  classifyAgent,
  classifyLayer,
  classifyRole,
  classifySkill,
  summarize,
  taxonomyCatalog,
} from '../lib/taxonomy.js';
import { analyzeSkill, buildPortfolio as buildSkillPortfolio } from '../lib/skills/analyze.js';
import { analyzeSubject, buildPortfolio as buildAgentPortfolio } from '../lib/agents/analyze.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const CWD = process.cwd();
const HOME = homedir();

// ------------------------------------------------------------------ catalogs

function catalogIndex(surface) {
  const catalog = taxonomyCatalog(surface);
  const index = new Map();
  for (const axis of catalog.axes) index.set(axis.id, new Set(axis.values.map((value) => value.id)));
  return { catalog, index };
}

const SKILLS = catalogIndex('skills');
const AGENTS = catalogIndex('agents');

function assertValidTags(classification, surface, label) {
  const { index } = surface === 'agents' ? AGENTS : SKILLS;
  assert.ok(Array.isArray(classification.tags), `${label}: tags must be an array`);
  assert.deepEqual(classification.tags, classificationTags(classification), `${label}: tags must come from classificationTags`);
  for (const tag of classification.tags) {
    const separator = tag.indexOf(':');
    assert.ok(separator > 0, `${label}: malformed tag ${tag}`);
    const axis = tag.slice(0, separator);
    const id = tag.slice(separator + 1);
    assert.ok(index.has(axis), `${label}: unknown axis in tag ${tag}`);
    assert.ok(index.get(axis).has(id), `${label}: value ${id} missing from the ${axis} catalog`);
  }
  assert.ok(classification.summary.length > 0, `${label}: summary must not be empty`);
  assert.ok(classification.summary.length <= 60, `${label}: summary must be ≤60 chars, got ${classification.summary.length}`);
  const { role, kind, scope, state } = classification;
  for (const [axis, value] of [['role', role], ['kind', kind], ['scope', scope]]) {
    assert.ok(index.get(axis).has(value.id), `${label}: ${axis} ${value.id} not in catalog`);
    assert.equal(typeof value.label, 'string');
    assert.ok(value.label.length > 0, `${label}: ${axis} label missing`);
  }
  assert.ok(Array.isArray(state) && state.length > 0, `${label}: at least one usage state`);
  for (const entry of state) assert.ok(index.get('state').has(entry.id), `${label}: state ${entry.id} not in catalog`);
  const usageStates = state.map((entry) => entry.id).filter((id) => ['active', 'idle', 'unobserved'].includes(id));
  assert.equal(usageStates.length, 1, `${label}: exactly one usage state, got ${usageStates.join(',')}`);
}

// -------------------------------------------------------------- skill factory

function skillFixture({
  name,
  description,
  body = '# Fixture\n\nA short entry.\n',
  refs = 0,
  scripts = 0,
  source = 'agent-agents',
  path,
  usage,
  siblings = [],
  previousTotal = null,
}) {
  const raw = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
  const skillPath = path || join(HOME, '.agents', 'skills', name, 'SKILL.md');
  const dir = dirname(skillPath);
  const files = [{ path: 'SKILL.md', chars: raw.length }];
  for (let index = 0; index < refs; index += 1) files.push({ path: `references/ref-${index}.md`, chars: 40 });
  for (let index = 0; index < scripts; index += 1) files.push({ path: `scripts/run-${index}.sh`, chars: 40 });
  return analyzeSkill({
    summary: { name, description, source, path: skillPath, dir },
    raw,
    files,
    siblings,
    usage,
    options: { now: NOW, windowDays: 30, cwd: CWD },
    previousTotal,
  });
}

const OFFICE_BODY = [
  '# Office',
  '',
  'Create, edit, inspect, or convert documents.',
  '',
  '## Load the right skill',
  '',
  '- `office-docx` — Word documents',
  '- `office-pptx` — presentations',
  '- `office-xlsx` — spreadsheets',
  '- `office-render` — page images',
].join('\n');

const OFFICE_SIBLINGS = [
  { name: 'office-docx', description: 'Word documents' },
  { name: 'office-pptx', description: 'PowerPoint decks' },
  { name: 'office-xlsx', description: 'Excel workbooks' },
  { name: 'office-render', description: 'Render document pages' },
];

const SKILL_CASES = [
  {
    name: 'office',
    fixture: {
      name: 'office',
      description: 'Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs.',
      body: OFFICE_BODY,
      source: 'bundled',
      siblings: OFFICE_SIBLINGS,
    },
    expect: { role: 'utility', kind: 'routing', scope: 'bundled', states: ['unobserved'] },
  },
  {
    name: 'code-review-expert',
    fixture: {
      name: 'code-review-expert',
      description: '以资深工程师视角审查当前 git 改动，查 SOLID 违背、安全风险和可落地改进。Use when：要 code review、审代码、看 diff、合并前把关。不适用于代码品味/审美评审（用 code-taste）。',
      refs: 5,
      usage: { count: 4, sufficient: true, exposureDays: 30 },
    },
    expect: { role: 'review', kind: 'layered', scope: 'global', states: ['active'] },
  },
  {
    name: 'frontend-slides',
    fixture: {
      name: 'frontend-slides',
      description: '从零创建、或把 PowerPoint 转成带动画、有设计感的 HTML 幻灯片。Use when：要做演示/PPT/幻灯片、把 PPTX 转网页、给演讲或 pitch 做 slides、先看风格预览。不适用于先想清结构/方法论、PPTX 成品（用 office-pptx）。',
      refs: 8,
      source: 'agent-claude',
    },
    expect: { role: 'design', kind: 'layered', scope: 'global', states: ['unobserved'] },
  },
  {
    name: 'guizang-voice',
    fixture: {
      name: 'guizang-voice',
      description: '个人语气档案：从用户旧文章与对话里的修改意见学其语气，存本机档案。Use when：学习我的语气、用我的口吻、按我的风格写、建语气档案。',
      source: 'filesystem',
      path: join(HOME, '.agents', 'skills', 'guizang-voice', 'SKILL.md'),
      usage: { count: 0, sufficient: true, exposureDays: 30, firstSeen: NOW - 30 * 86_400_000 },
    },
    expect: { role: 'write', kind: 'prose', scope: 'global', states: ['idle'] },
  },
  {
    name: 'find-skills',
    fixture: {
      name: 'find-skills',
      description: '帮用户发现、查找并安装现成的 agent skill。Use when：问「有没有能做 X 的 skill」「找个 skill」「怎么扩展能力」，或想安装技能。触发词：find-skills、找技能、安装 skill、skills CLI、extend capabilities。不适用于从零写一个新 skill。',
      refs: 1,
    },
    // `find` is a utility keyword, so a discovery/install router lands in utility.
    expect: { role: 'utility', kind: 'layered', scope: 'global', states: ['unobserved'] },
  },
  {
    name: 'commit',
    fixture: {
      name: 'commit',
      description: '生成符合 Conventional Commits 的提交，提交前先过检查。Use when：要 commit、提交改动、写 commit message、整理提交历史。触发词：commit、提交、conventional commit、feat/fix/chore、squash。',
    },
    expect: { role: 'ops', kind: 'prose', scope: 'global', states: ['unobserved'] },
  },
  {
    name: 'deep-research',
    fixture: {
      name: 'deep-research',
      description: 'Universal deep research agent team. 13-agent pipeline for rigorous academic research on any topic. Covers research question formulation, systematic literature search, paper review, meta-analysis, editorial review, 研究, 深度研究. Triggers on: research, literature review, 研究.',
      refs: 24,
    },
    expect: { role: 'research', kind: 'layered', scope: 'global', states: ['unobserved'] },
  },
  {
    name: 'fmt',
    fixture: {
      name: 'fmt',
      description: '用 Prettier 格式化代码。Use when：要格式化、排版、统一风格、提交前整理，或对全项目跑一次 format。触发词：fmt、format、prettier、格式化代码、code style。不适用于 lint 规则修复（eslint --fix）或类型检查（tsc）。',
    },
    // `code`/`fix`/`修复` outweigh `format`/`格式`, so the keyword score says build.
    expect: { role: 'build', kind: 'prose', scope: 'global', states: ['unobserved'] },
  },
  {
    name: 'session-router (routing)',
    fixture: {
      name: 'session-router',
      description: '会话入口：按任务调度子代理，把请求分发到合适的技能。',
      body: [
        '# Session Router',
        '',
        'Route the request to the right skill.',
        '',
        '- `commit` — small changes',
        '- `deep-research` — open questions',
      ].join('\n'),
      source: 'filesystem',
      path: join(CWD, '.dsh', 'skills', 'session-router', 'SKILL.md'),
      siblings: [{ name: 'commit', description: 'Commit changes' }, { name: 'deep-research', description: 'Research' }],
    },
    expect: { role: 'orchestrate', kind: 'routing', scope: 'project', states: ['unobserved'] },
  },
  {
    name: 'academic-paper (layered)',
    fixture: {
      name: 'academic-paper',
      description: '写学术论文：从研究问题到成稿的完整流程，包含文献、数据与报告。',
      refs: 10,
    },
    expect: { role: 'research', kind: 'layered', scope: 'global', states: ['unobserved'] },
  },
  {
    name: 'loss-analysis (scripted)',
    fixture: {
      name: 'loss-analysis',
      description: '分析损失与失败原因，输出研究结论。',
      scripts: 2,
      source: 'vendor',
      path: '/opt/vendor/skills/loss-analysis/SKILL.md',
    },
    expect: { role: 'research', kind: 'scripted', scope: 'custom', states: ['unobserved'] },
  },
];

test('skill taxonomy table: role / kind / scope / state', () => {
  for (const testCase of SKILL_CASES) {
    const report = skillFixture(testCase.fixture);
    const classification = report.classification;
    assert.ok(classification, `${testCase.name}: analyzeSkill must attach classification`);
    assert.equal(classification.role.id, testCase.expect.role, `${testCase.name}: role`);
    assert.equal(classification.kind.id, testCase.expect.kind, `${testCase.name}: kind`);
    assert.equal(classification.scope.id, testCase.expect.scope, `${testCase.name}: scope`);
    assert.deepEqual(
      classification.state.map((entry) => entry.id),
      testCase.expect.states,
      `${testCase.name}: state`,
    );
    assertValidTags(classification, 'skills', testCase.name);
  }
});

test('skill taxonomy: determinism (two scans and two classify calls are deep-equal)', () => {
  for (const testCase of SKILL_CASES) {
    const first = skillFixture(testCase.fixture);
    const second = skillFixture(testCase.fixture);
    assert.deepEqual(first.classification, second.classification, `${testCase.name}: scan must be deterministic`);
    assert.deepEqual(
      classifySkill(first),
      classifySkill(first),
      `${testCase.name}: classifySkill must be deterministic`,
    );
  }
});

test('skill taxonomy: extra state badges derive from overlaps / pending / findings', () => {
  const report = skillFixture(SKILL_CASES[1].fixture);
  const flagged = {
    ...report,
    usage: { count: 0, sufficient: true, exposureDays: 30 },
    overlaps: [{ name: 'code-taste', score: 0.72 }],
    evolution: { ...report.evolution, pending: { hasUnclosed: true } },
    findings: [...(report.findings || []), { id: 'hyg.security', severity: 'critical', title: 'secret' }],
  };
  const classification = classifySkill(flagged, { bodyLines: report.metrics.bodyLines });
  assert.deepEqual(
    classification.state.map((entry) => entry.id),
    ['idle', 'pending', 'overlap', 'critical'],
  );
  assert.ok(classification.tags.includes('state:critical'));
});

// -------------------------------------------------------------- agent factory

function agentFixture({
  kind = 'agent',
  name,
  description = '',
  body = '# 定义\n\n做一件事。\n',
  path,
  scope,
  source = 'filesystem',
  usage,
  injection,
  evolution,
  conflicts = [],
}) {
  const dir = path ? dirname(path) : null;
  const subject = {
    kind,
    name,
    description,
    path: path || null,
    dir,
    scope: scope || null,
    source,
    mtime: NOW - 90 * 86_400_000,
    owner: null,
  };
  return analyzeSubject({
    subject,
    raw: kind === 'agent'
      ? `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`
      : undefined,
    body: kind === 'agent' ? undefined : body,
    usage,
    injection,
    evolution,
    conflicts,
    options: { now: NOW, windowDays: 30, cwd: CWD },
  });
}

const AGENT_CASES = [
  {
    name: 'code-reviewer',
    fixture: {
      kind: 'agent',
      name: 'code-reviewer',
      description: '资深代码审查者：负责 review 改动、验证结果并挑出风险。',
      path: join(HOME, '.agents', 'skills', 'team', 'agents', 'code-reviewer.md'),
      scope: 'skill',
      usage: { sessions: 3, sufficient: true, exposureDays: 30 },
    },
    expect: { role: 'review', kind: 'agent', scope: 'skill', states: ['active'] },
  },
  {
    name: 'scan-researcher',
    fixture: {
      kind: 'agent',
      name: 'scan-researcher',
      description: '扫描与研究：探索代码、调查依赖、分析数据。',
      path: join(CWD, 'agents', 'scan-researcher.md'),
      scope: 'project',
      usage: { sessions: 0, sufficient: true, exposureDays: 30 },
    },
    expect: { role: 'research', kind: 'agent', scope: 'project', states: ['idle'] },
  },
  {
    name: 'draft-writer',
    fixture: {
      kind: 'agent',
      name: 'draft-writer',
      description: '写作与文案：把要点写成稿子，按语气润色。',
      path: join(HOME, '.agents', 'skills', 'writing', 'agents', 'draft-writer.md'),
      scope: 'skill',
    },
    expect: { role: 'write', kind: 'agent', scope: 'skill', states: ['unobserved'] },
  },
  {
    name: 'intake-agent',
    fixture: {
      kind: 'agent',
      name: 'intake-agent',
      description: '接收任务并分派给下游 agent，维护流程。',
      path: join(HOME, '.agents', 'skills', 'intake', 'agents', 'intake-agent.md'),
      scope: 'skill',
    },
    expect: { role: 'orchestrate', kind: 'agent', scope: 'skill', states: ['unobserved'] },
  },
  {
    name: 'preset router',
    fixture: {
      kind: 'preset',
      name: 'router',
      description: '按模型与推理档位路由会话。',
      scope: 'profile',
      source: 'profile-config',
      body: '',
      usage: { sessions: 12, sufficient: true, presetSessions: 12 },
    },
    expect: { role: 'orchestrate', kind: 'preset', scope: 'profile', states: ['active'] },
  },
  {
    name: 'instruction',
    fixture: {
      kind: 'instruction',
      name: 'AGENTS.md',
      description: '',
      body: '# 项目工作区说明书\n\n必须跑测试再改实现。\n',
      path: join(CWD, 'AGENTS.md'),
      scope: 'project',
      usage: { sessions: 0, sufficient: true, exposureDays: 30 },
      injection: { mode: 'workspace', sessionsSeen: 20, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 300, duplicatedWith: [] },
    },
    expect: { role: 'ops', kind: 'instruction', scope: 'project', states: ['idle'] },
  },
];

test('agent taxonomy table: role / kind / scope / state', () => {
  for (const testCase of AGENT_CASES) {
    const report = agentFixture(testCase.fixture);
    const classification = report.classification;
    assert.ok(classification, `${testCase.name}: analyzeSubject must attach classification`);
    assert.equal(classification.role.id, testCase.expect.role, `${testCase.name}: role`);
    assert.equal(classification.kind.id, testCase.expect.kind, `${testCase.name}: kind`);
    assert.equal(classification.scope.id, testCase.expect.scope, `${testCase.name}: scope`);
    assert.deepEqual(
      classification.state.map((entry) => entry.id),
      testCase.expect.states,
      `${testCase.name}: state`,
    );
    assertValidTags(classification, 'agents', testCase.name);
  }
});

test('agent taxonomy: determinism and stale-ref / conflict badges', () => {
  for (const testCase of AGENT_CASES) {
    const first = agentFixture(testCase.fixture);
    const second = agentFixture(testCase.fixture);
    assert.deepEqual(first.classification, second.classification, `${testCase.name}: scan must be deterministic`);
    assert.deepEqual(classifyAgent(first), classifyAgent(first), `${testCase.name}: classifyAgent must be deterministic`);
  }

  const report = agentFixture(AGENT_CASES[0].fixture);
  const flagged = {
    ...report,
    metrics: { ...report.metrics, staleRefs: [{ ref: 'missing.md', line: 3 }] },
    findings: [...(report.findings || []), { id: 'gov.conflicts', severity: 'critical', title: '跨文件冲突' }],
  };
  const classification = classifyAgent(flagged);
  const stateIds = classification.state.map((entry) => entry.id);
  assert.ok(stateIds.includes('stale-ref'), 'stale-ref badge');
  assert.ok(stateIds.includes('conflict'), 'conflict badge');
  assert.ok(stateIds.includes('critical'), 'critical badge');
  assertValidTags(classification, 'agents', 'flagged agent');
});

// -------------------------------------------------------------- role scoring

test('classifyRole: weights, boundary, tie order, confidence, fallback', () => {
  assert.equal(classifyRole({ name: 'audit' }).id, 'review');
  assert.equal(classifyRole({ name: 'audit' }).confidence, 0.65);

  assert.equal(classifyRole({ description: '请审计这段改动' }).id, 'review');

  // name ×3 beats description ×1
  assert.equal(classifyRole({ name: 'verify', description: 'code' }).id, 'review');
  assert.equal(classifyRole({ name: 'code', description: '审查' }).id, 'build');

  // name tie: table order puts review before build (SPEC §2.1)
  assert.equal(classifyRole({ name: 'code-review' }).id, 'review');

  // English word boundary: no substring hits
  assert.equal(classifyRole({ name: 'codex' }).id, 'other');
  assert.equal(classifyRole({ name: 'coder' }).id, 'other');
  // underscores are separators, so snake_case identifiers still match
  assert.equal(classifyRole({ name: 'code_review_helper' }).id, 'review');
  // Known limitation, pinned so a keyword fix is a visible behavior change:
  // §2.1 lists `review` but not `reviewer`, and name `code` ×3 outvotes the
  // `reviewer` is an explicit review keyword, so a bare `code-reviewer` name
  // (code ×3 in the name) still resolves to review through the noun.
  assert.equal(classifyRole({ name: 'code-reviewer' }).id, 'review');

  // zero hits → other / 0.3 / no evidence
  const fallback = classifyRole({ name: 'zzz', description: 'nothing useful' });
  assert.deepEqual(fallback, { id: 'other', label: '其他', confidence: 0.3, evidence: [] });

  // confidence formula: 0.55 + 0.1 per distinct hit, capped at 0.95, ≤5 evidence
  const twoHits = classifyRole({ name: 'research', description: '分析' });
  assert.equal(twoHits.confidence, 0.75);
  assert.deepEqual(twoHits.evidence, ['research', '分析']);
  const capped = classifyRole({ name: 'review audit verify test quality' });
  assert.equal(capped.confidence, 0.95);
  assert.equal(capped.evidence.length, 5);
});

test('classifyRole: deterministic and body-agnostic', () => {
  const input = { name: 'deep-research', description: '研究分析' };
  const first = classifyRole(input);
  assert.deepEqual(first, classifyRole(input));
  // SPEC §2.1 scores name + description only; body must not change the result.
  assert.deepEqual(first, classifyRole({ ...input, body: 'code commit design 审查' }));
});

// ------------------------------------------------------------------ summarize

test('summarize: first sentence, H1 fallback, role fallback, ≤60 chars', () => {
  assert.equal(summarize({ description: '审查代码改动并给出可落地改进建议。Use when：需要 review。' }), '审查代码改动并给出可落地改进建议');
  const long = summarize({ description: '一'.repeat(120) });
  assert.ok(long.length <= 60);
  assert.ok(long.endsWith('…'));

  assert.equal(summarize({ description: '', title: '项目工作区说明书' }), '项目工作区说明书');
  assert.equal(summarize({ description: '', body: '# 从正文取标题\n\n内容' }), '从正文取标题');

  const fromRole = summarize({ name: 'mystery', classification: { role: { id: 'other', label: '其他' } } });
  assert.equal(fromRole, '其他：mystery');
});

// ------------------------------------------------------------------- catalog

test('taxonomyCatalog: single source of truth per surface', () => {
  const skills = taxonomyCatalog('skills');
  const agents = taxonomyCatalog('agents');
  assert.equal(skills.version, TAXONOMY_VERSION);
  assert.equal(TAXONOMY_VERSION, 2);
  assert.deepEqual(skills.axes.map((axis) => axis.id), ['role', 'layer', 'kind', 'scope', 'state']);
  assert.deepEqual(skills.axes.map((axis) => axis.label), ['职责', '层级', '形态', '范围', '状态']);
  assert.deepEqual(agents.axes.map((axis) => axis.label), ['职责', '类型', '范围', '状态']);

  assert.equal(skills.axes[0].values.length, ROLES.length);
  assert.equal(skills.axes[0].values.length, 10);
  assert.equal(skills.axes[1].values.length, 2);
  assert.equal(skills.axes[1].values[0].id, 'meta');
  assert.equal(skills.axes[2].values.length, SKILL_KINDS.length);
  assert.equal(skills.axes[2].values.length, 4);
  assert.equal(agents.axes[1].values.length, AGENT_KINDS.length);
  assert.equal(agents.axes[1].values.length, 3);
  assert.equal(skills.axes[3].values.length, SCOPES.length);
  assert.equal(skills.axes[3].values.length, 6);
  assert.equal(skills.axes[4].values.length, STATES.length);
  assert.equal(skills.axes[4].values.length, 8);
  for (const axis of skills.axes) {
    for (const value of axis.values) {
      assert.equal(typeof value.id, 'string');
      assert.ok(value.id.length > 0);
      assert.equal(typeof value.label, 'string');
      assert.ok(value.label.length > 0, `${axis.id}:${value.id} needs a Chinese label`);
    }
  }
  assert.ok(skills.axes[0].values.every((value) => typeof value.description === 'string' && value.description.length > 0));
  // Kind sets differ per surface but share the axis id.
  assert.deepEqual(skills.axes[2].values.map((value) => value.id), ['layered', 'scripted', 'routing', 'prose']);
  assert.deepEqual(agents.axes[1].values.map((value) => value.id), ['instruction', 'agent', 'preset']);
  // Unknown surface falls back to skills.
  assert.deepEqual(taxonomyCatalog('nonsense'), skills);
});

test('classificationTags: stable axis order and de-duplicated states', () => {
  const classification = {
    role: { id: 'review', label: '审查验证' },
    layer: { id: 'meta', label: '元技能' },
    kind: { id: 'layered', label: '分层参考' },
    scope: { id: 'global', label: '全局' },
    state: [{ id: 'active', label: '在用' }, { id: 'active', label: '在用' }, { id: 'pending', label: '待沉淀' }],
  };
  assert.deepEqual(classificationTags(classification), [
    'role:review',
    'layer:meta',
    'kind:layered',
    'scope:global',
    'state:active',
    'state:pending',
  ]);
  // The helper de-duplicates exact tags, keeping first occurrence order.
  assert.deepEqual(classificationTags({ ...classification, state: [{ id: 'active' }] }), [
    'role:review',
    'layer:meta',
    'kind:layered',
    'scope:global',
    'state:active',
  ]);
  assert.deepEqual(classificationTags(null), []);
});

// ------------------------------------------------------------- portfolio glue

test('portfolio: taxonomy + byRole/byKind/byScope + trend (skills)', () => {
  const review = skillFixture({ ...SKILL_CASES[1].fixture, previousTotal: 70 });
  const office = skillFixture({ ...SKILL_CASES[0].fixture, previousTotal: 50 });
  const portfolio = buildSkillPortfolio([review, office], {
    generatedAt: NOW,
    windowDays: 30,
    sessionsScanned: 10,
    usageAvailable: true,
    previous: { generatedAt: NOW - 86_400_000, avgScore: 60, rubricVersion: '2.0' },
  });
  assert.equal(portfolio.taxonomy.version, TAXONOMY_VERSION);
  assert.deepEqual(portfolio.totals.byRole, { review: 1, utility: 1 });
  assert.deepEqual(portfolio.totals.byKind, { layered: 1, routing: 1 });
  assert.deepEqual(portfolio.totals.byScope, { bundled: 1, global: 1 });
  assert.equal(portfolio.trend.generatedAt, NOW);
  assert.equal(portfolio.trend.previousGeneratedAt, NOW - 86_400_000);
  assert.equal(typeof portfolio.trend.itemsChanged, 'number');
  assert.equal(portfolio.trend.itemsChanged, 2);
  assert.equal(Number.isFinite(portfolio.trend.avgDelta), true);
  // A first scan (no comparable previous) must not invent a "0 changed" trend.
  const firstScan = buildSkillPortfolio([review, office], {
    generatedAt: NOW,
    windowDays: 30,
    sessionsScanned: 10,
    usageAvailable: true,
  });
  assert.deepEqual(firstScan.trend, {
    generatedAt: NOW,
    previousGeneratedAt: null,
    avgDelta: null,
    itemsChanged: null,
  });
  // Backward compatibility: existing keys stay.
  assert.equal(portfolio.rubricVersion, '2.0');
  assert.equal(portfolio.skills.length, 2);
  assert.ok(portfolio.totals.bySource);
});

test('portfolio: taxonomy + byRole/byKind/byScope + trend (agents)', () => {
  const reviewer = agentFixture({ ...AGENT_CASES[0].fixture });
  const preset = agentFixture({ ...AGENT_CASES[4].fixture });
  const portfolio = buildAgentPortfolio([reviewer, preset], {
    generatedAt: NOW,
    windowDays: 30,
    sessionsScanned: 10,
    usageAvailable: true,
    roots: [join(CWD, '.agents')],
  });
  assert.equal(portfolio.taxonomy.axes.find((axis) => axis.id === 'kind').label, '类型');
  assert.deepEqual(portfolio.totals.byKind, { agent: 1, preset: 1 });
  assert.deepEqual(portfolio.totals.byScope, { skill: 1, profile: 1 });
  assert.ok(portfolio.totals.byRole.review >= 1);
  assert.ok(portfolio.totals.byRole.orchestrate >= 1);
  assert.equal(portfolio.trend.previousGeneratedAt, null);
  assert.equal(portfolio.trend.avgDelta, null);
  assert.equal(portfolio.trend.itemsChanged, null);
  assert.equal(portfolio.subjects.length, 2);
  assert.ok(portfolio.totals.byScope);
});

test('portfolio (agents): conflicting subjects get the conflict badge without mutating inputs', () => {
  const left = agentFixture({
    kind: 'instruction',
    name: 'AGENTS.md',
    description: '',
    body: '# A\n\n必须删除 node_modules 目录。\n',
    path: '/home/u/.agents/AGENTS.md',
    scope: 'global',
  });
  const right = agentFixture({
    kind: 'instruction',
    name: 'CLAUDE.md',
    description: '',
    body: '# B\n\n不要删除 node_modules 目录。\n',
    path: '/home/u/.claude/CLAUDE.md',
    scope: 'global',
  });
  const portfolio = buildAgentPortfolio([left, right], {
    generatedAt: NOW,
    windowDays: 30,
    sessionsScanned: 10,
    usageAvailable: true,
  });
  assert.ok(portfolio.conflicts.length >= 1, 'contradiction detected');
  assert.equal(portfolio.subjects.length, 2);
  for (const subject of portfolio.subjects) {
    assert.ok(
      subject.classification.state.some((state) => state.id === 'conflict'),
      `${subject.name}: conflict badge`,
    );
    assert.ok(subject.classification.tags.includes('state:conflict'));
    const original = subject.id === left.id ? left : right;
    assert.equal(
      original.classification.state.some((state) => state.id === 'conflict'),
      false,
      `${subject.name}: classification is cloned, inputs are not mutated`,
    );
  }
  // Conflict is the last state in the catalog, so appending keeps catalog order.
  assert.equal(portfolio.subjects[0].classification.state.at(-1).id, 'conflict');
});

test('real office/tooling objects keep a useful role (regression)', () => {
  const cases = [
    { name: 'office-docx', description: 'Create, read, edit, and validate Word documents (.docx)', role: 'utility' },
    { name: 'office-pptx', description: 'Create, read, edit, and validate PowerPoint presentations (.pptx)', role: 'utility' },
    { name: 'office-xlsx', description: 'Read, create, edit, and validate Excel workbooks, data, and formulas (.xlsx)', role: 'utility' },
    { name: 'office-recalculate', description: 'Refresh spreadsheet formula caches and verify calculated values', role: 'utility' },
    { name: 'performance-optimizer', description: '跨语言性能瓶颈定位与优化方法论：profiling、复杂度、缓存、并发、内存泄漏', role: 'build' },
    { name: 'visualization_agent', description: 'Generates publication-quality figure specifications and chart descriptions', role: 'design' },
    { name: 'formatter_agent', description: 'Formats the final manuscript output to target journal style', role: 'utility' },
    { name: 'structure_architect_agent', description: 'Designs the papers section architecture and detailed outline', role: 'design' },
  ];
  for (const item of cases) {
    assert.equal(classifyRole(item).id, item.role, `${item.name}: ${JSON.stringify(classifyRole(item))}`);
  }
});

test('null/undefined reports are safe', () => {
  assert.equal(classifyRole(null).id, 'other');
  assert.equal(classifyRole(undefined).id, 'other');
  assert.equal(summarize(null), '');
  assert.equal(summarize(undefined), '');
});

test('skills carry a layer axis: meta vs task', () => {
  const meta = ['find-skills', 'prompt-optimizer', 'context-optimizer', 'loss-analysis'];
  for (const name of meta) {
    const layer = classifyLayer({ name, description: '' });
    assert.equal(layer.id, 'meta', `${name}: explicit meta name`);
  }
  const task = [
    ['office-docx', 'Create, read, edit, and validate Word documents'],
    ['handoff', '把当前会话压缩成交接文档，供另一个 agent 接手'],
    ['e2e-test-quality', 'E2E 测试的质量评尺'],
    ['guizang-page-skill', '将文档、文章或笔记渲染为精排单页 HTML'],
  ];
  for (const [name, description] of task) {
    assert.equal(classifyLayer({ name, description }).id, 'task', `${name}: task skill`);
  }
  const catalog = taxonomyCatalog('skills');
  assert.deepEqual(catalog.axes.map((axis) => axis.id), ['role', 'layer', 'kind', 'scope', 'state']);
  assert.deepEqual(taxonomyCatalog('agents').axes.map((axis) => axis.id), ['role', 'kind', 'scope', 'state']);
});

test('classifySkill attaches layer + layer tags, and totals.byLayer counts them', () => {
  const reports = [
    skillFixture({ name: 'find-skills', description: '帮用户发现、查找并安装现成的 agent skill。' }),
    skillFixture({ name: 'office-docx', description: 'Create, read, edit, and validate Word documents (.docx).' }),
  ];
  for (const report of reports) {
    assert.ok(report.classification.layer, `${report.name}: layer present`);
    assert.ok(report.classification.tags.includes(`layer:${report.classification.layer.id}`));
  }
  const portfolio = buildSkillPortfolio(reports, { taxonomy: taxonomyCatalog('skills') });
  assert.equal(portfolio.totals.byLayer.meta, 1);
  assert.equal(portfolio.totals.byLayer.task, 1);
});
