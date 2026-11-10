/**
 * Render + API smoke test for the merged dsh-360 Client.
 *
 * Loads client.js through a fake module loader with a minimal React hook shim,
 * applies the plugin to a mock Client context, then drives the single panel
 * (title + two tabs) through the required UI states for BOTH surfaces:
 *   - registration: loader id / panel key / order 41 / single merged style tag
 *   - tab switching, default tab, tab badge counts
 *   - skills tab: list / detail / S~E grade filter / apply success+failure /
 *     evolution editor (rule required)
 *   - agents tab: same states + kind filter + pending-evolution badge
 *   - every fetch path under /api/dsh-360/skills or /api/dsh-360/agents
 *   - 18-bucket grade badges (S+, B-, E-) keyed to S/A/B/C/D/E colours
 *   - one surface failing does not affect the other tab
 */
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ DOM stub

const created = [];
globalThis.document = {
  querySelector: () => null,
  createElement: () => {
    const tag = { dataset: {}, textContent: '', remove() {} };
    created.push(tag);
    return tag;
  },
  head: { appendChild(tag) { tag.appended = true; } },
};

// --------------------------------------------------------------- React shim

const NO_SEED = Symbol('no-seed');
let seeds = [];
let hookIndex = 0;
let runEffects = false;

function element(type, props, ...children) {
  const merged = { ...(props || {}) };
  if (children.length === 1) merged.children = children[0];
  else if (children.length > 1) merged.children = children;
  return { type, props: merged };
}

const ReactShim = {
  createElement: element,
  useState(initial) {
    const seed = hookIndex < seeds.length ? seeds[hookIndex] : NO_SEED;
    hookIndex += 1;
    return [seed === NO_SEED ? initial : seed, () => {}];
  },
  useEffect(callback) {
    if (runEffects) callback();
  },
  useMemo(factory) {
    return factory();
  },
  useCallback(callback) {
    return callback;
  },
  useRef(value) {
    return { current: value };
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
};

// ------------------------------------------------------------- loader + ctx

let plugin = null;
const registrations = new Map();

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      assert.equal(definition.id, 'dsh-360', 'loader id must be the package name dsh-360');
      plugin = definition.factory((name) => {
        assert.equal(name, 'react', 'factory may only require react');
        return ReactShim;
      });
    },
  },
  setTimeout() { return 0; },
  clearTimeout() {},
  confirm() { return true; },
};

const localeSnapshot = { active: 'zh', revision: 1, locales: [{ id: 'zh', label: '中文' }] };
const locale = {
  register() { return () => {}; },
  bind() { return (key) => key; },
  subscribe() { return () => {}; },
  getSnapshot() { return localeSnapshot; },
  getLocale() { return localeSnapshot; },
};
const slots = {
  inject(_name, callback) { callback(); return () => {}; },
  register(options, component) {
    const key = options.name === 'main' ? 'main:' + options.key : options.name + ':' + options.id;
    registrations.set(key, { options, component });
    return () => {};
  },
};
const ctx = {
  slots,
  locale,
  effect(callback) {
    const disposer = callback();
    return typeof disposer === 'function' ? disposer : () => {};
  },
};

await import(new URL('../client.js', import.meta.url).href);
assert.ok(plugin, 'client module loaded');
assert.deepEqual(plugin.inject, ['slots', 'locale'], 'plugin injects slots + locale');
plugin.apply(ctx);

const panel = registrations.get('main:dsh-360');
assert.ok(panel, 'main panel registered under key dsh-360');
const sidebar = registrations.get('sidebar.panellist:dsh-360');
assert.ok(sidebar, 'sidebar panellist registered under id dsh-360');
assert.equal(panel.options.key, 'dsh-360');
assert.equal(sidebar.options.id, 'dsh-360');
assert.equal(sidebar.options.order, 41, 'order 41');

// ------------------------------------------------------------------ styles

const styleTags = created.filter((tag) => tag.dataset.plugin === 'dsh-360');
assert.equal(styleTags.length, 1, 'exactly one style tag with data-plugin="dsh-360"');
const styleTag = styleTags[0];
assert.equal(styleTag.dataset.pluginCss, 'dsh-360/style', 'data-plugin-css="dsh-360/style"');
assert.ok(styleTag.appended, 'style tag appended to head');
const styleText = styleTag.textContent;
assert.match(styleText, /s360-/, 's360- classes retained');
assert.match(styleText, /a360-/, 'a360- classes retained');
assert.match(styleText, /@keyframes d360-spin/, 'deduped keyframe d360-spin');
assert.doesNotMatch(styleText, /@keyframes s360-spin/, 'no s360-spin keyframe');
assert.doesNotMatch(styleText, /@keyframes a360-spin/, 'no a360-spin keyframe');
// 18-bucket colour mapping: S gold / A green / B blue / C amber / D orange / E red.
for (const p of ['s360-', 'a360-']) {
  assert.match(styleText, new RegExp('\\' + '.' + p + 'gradeS\\{'), p + 'gradeS rule');
  assert.match(styleText, new RegExp('\\' + '.' + p + 'gradeA\\{'), p + 'gradeA rule');
  assert.match(styleText, new RegExp('\\' + '.' + p + 'gradeB\\{'), p + 'gradeB rule');
  assert.match(styleText, new RegExp('\\' + '.' + p + 'gradeC\\{'), p + 'gradeC rule');
  assert.match(styleText, new RegExp('\\' + '.' + p + 'gradeD\\{'), p + 'gradeD rule');
  assert.match(styleText, new RegExp('\\' + '.' + p + 'gradeE\\{'), p + 'gradeE rule');
}
assert.match(styleText, /#b8860b/, 'S gold colour present');
assert.match(styleText, /#e8590c/, 'D orange colour present');
console.log('PASS 1/8  loader id + panel key = dsh-360, order 41, single style tag (s360- + a360-, deduped keyframe, S~E colours)');

// ------------------------------------------------------- element serializer

function collectText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object') {
    if (typeof node.type === 'function') {
      return collectText(node.type(node.props || {}), out);
    }
    collectText(node.props ? node.props.children : null, out);
  }
  return out;
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node === 'object') {
    if (typeof node.type === 'function') {
      walk(node.type(node.props || {}), visit);
      return;
    }
    visit(node);
    walk(node.props ? node.props.children : null, visit);
  }
}

function textOf(node) {
  return collectText(node).join(' ').replace(/\s+/g, ' ').trim();
}

function treeOf(seedValues) {
  seeds = seedValues || [];
  hookIndex = 0;
  return panel.component();
}

function render(seedValues) {
  return textOf(treeOf(seedValues));
}

function findButton(tree, label) {
  let found = null;
  walk(tree, (el) => {
    if (found || el.type !== 'button') return;
    if (textOf(el) === label) found = el;
  });
  return found;
}

function buttonsIn(node) {
  const out = [];
  walk(node, (el) => { if (el.type === 'button') out.push(el); });
  return out;
}

function elementsBy(tree, predicate) {
  const out = [];
  walk(tree, (el) => { if (predicate(el)) out.push(el); });
  return out;
}

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// ----------------------------------------------------------------- mock data

const DAY = 86400000;
const NOW = Date.now();

function dim(id, label, score, max, summary, extra) {
  const base = {
    id,
    label,
    score,
    max,
    summary,
    items: [{ id: id + '.item', label: label + '条目', score, max, detail: summary }],
  };
  return typeof extra === 'object' && extra ? { ...base, ...extra } : base;
}

function makeEvolution(overrides) {
  const base = {
    applicable: true,
    lessons: { count: 0, latestAt: null, linked: false, entries: [] },
    signals: { sessions: 0, loads: 0, reloads: 0, postLoadErrors: 0, corrections: 0, asks: 0, turnFailures: 0, lastSignalAt: null, samples: [] },
    pending: { score: 0, hasUnclosed: false, lastSignalAt: null, draft: null },
    proposals: [],
  };
  const out = { ...base, ...(overrides || {}) };
  out.lessons = { ...base.lessons, ...((overrides && overrides.lessons) || {}) };
  out.signals = { ...base.signals, ...((overrides && overrides.signals) || {}) };
  out.pending = { ...base.pending, ...((overrides && overrides.pending) || {}) };
  return out;
}

const pendingEvolution = makeEvolution({
  lessons: { count: 1, latestAt: NOW - 120 * DAY, linked: false },
  signals: { sessions: 6, reloads: 1, postLoadErrors: 1, corrections: 2, turnFailures: 1, lastSignalAt: NOW - DAY },
  pending: { score: 12, hasUnclosed: true, lastSignalAt: NOW - DAY, draft: { trigger: '用户说“不对，应该先跑测试再改实现”', rule: '', evidence: 'session session-bravo-1' } },
  proposals: [{ id: 'evolution.add-lesson', title: '沉淀一条经验', why: '有未闭环信号', evidence: 'session session-bravo-1', draft: { trigger: '用户说“不对，应该先跑测试再改实现”', rule: '', evidence: 'session session-bravo-1' } }],
});

const notScoredEvolution = makeEvolution({ applicable: false });

function makeSkill({ name, source, description, total, grade, letter, verdict, findings = [], suggestions = [], overlaps = [], evolution }) {
  return {
    name,
    source,
    provider: 'filesystem',
    path: '/skills/' + name + '/SKILL.md',
    dir: '/skills/' + name,
    description,
    coverage: 'full',
    mtime: NOW,
    metrics: { descriptionChars: (description || '').length, catalogChars: 200, catalogTruncated: false, bodyLines: 220, estTokens: 1500, referenceCount: 1, referencedFiles: 1, orphanReferences: 1, overlapMax: overlaps.length ? overlaps[0].score : 0.1 },
    usage: { count: 6, lastUsedAt: NOW - DAY, perWeek: 1.4 },
    score: { total, grade, letter, confidence: 0.9, delta: null, dimensions: [dim('load', '按需加载', 16, 20, '有加载'), dim('disclosure', '渐进披露', 18, 25, '正文偏大'), dim('actionability', '可执行性', 15, 20, '步骤尚可'), dim('boundary', '边界与治理', 12, 15, '缺少何时不用'), dim('hygiene', '维护卫生', 7, 10, '存在孤儿引用'), dim('evolution', '持续进化', 4, 10, '经验过时')] },
    verdict: { code: verdict, reason: '示例结论：总分 ' + total + '。' },
    evolution: evolution || makeEvolution({}),
    findings,
    suggestions,
    overlaps,
  };
}

function makeSubject({ id, kind, name, title = null, scope, path, description = null, total, grade, letter, verdict, injection, usage, evolution, findings = [], suggestions = [], overlaps = [] }) {
  return {
    id, kind, name, title, scope,
    source: kind === 'preset' ? 'profile-config' : 'filesystem',
    path, dir: path.slice(0, path.lastIndexOf('/')), owner: null, mtime: NOW - 30 * DAY, coverage: 'full', description,
    metrics: { chars: 1899, estTokens: 1450, lines: 120, headings: 12, h2: 4, bullets: 30, numberedSteps: 3, commands: 4, imperativeCount: 9, codeBlocks: 2, codeRatio: 0.12, sections: [], localLinks: [], staleRefs: [], dupSentences: [], builtinOverlap: 0.22, todos: 0, secrets: 0, dangerous: 0, bakFiles: 2, frontmatter: { ok: true } },
    injection,
    usage,
    evolution,
    score: { total, grade, letter, confidence: 0.8, delta: null, dimensions: [dim('inject', '注入命中', 10, 20, '注入弱'), dim('layer', '分层与精简', 15, 25, '偏大'), dim('actionable', '可执行性', 12, 20, '尚可'), dim('governance', '边界与治理', 9, 15, '缺边界'), dim('hygiene', '维护卫生', 8, 10, '失效引用'), dim('evolution', '持续进化', 4, 10, '有未沉淀信号')] },
    verdict: { code: verdict, reason: '示例结论：总分 ' + total + '。' },
    findings,
    suggestions,
    overlaps,
  };
}

const autoSuggestion = {
  id: 'fix.extract-sections', kind: 'auto', title: '把参考型章节拆到 references/',
  why: '正文预计减少约 400 tokens，可撤销。', risk: '低：原内容逐字搬移，不删改。',
  action: { type: 'extract-sections', params: { sections: ['reference'] } },
  preview: { before: '## 参考', after: '见 references/ref.md' },
};
const lessonSuggestion = {
  id: 'fix.add-lesson', kind: 'draft', title: '沉淀一条“触发→做法”',
  why: '有未闭环信号。', risk: '中：会追加经验并接进入口；可撤销。',
  action: { type: 'add-lesson', params: { lesson: { trigger: '用户说“不对，应该先跑测试再改实现”', rule: '', evidence: 'session session-bravo-1' } } },
  preview: { before: '（未沉淀）', after: '用户说“不对” → （待补做法）' },
};
const manualSuggestion = {
  id: 'fix.manual', kind: 'manual', title: '修复失效链接',
  why: '存在坏链。', risk: '需人工判断。', action: null,
};

const skillAlpha = makeSkill({ name: 'skill-alpha', source: 'user-agents', description: 'A well-tuned skill.', total: 97, grade: 'S+', letter: 'S', verdict: 'keep' });
const skillBravo = makeSkill({
  name: 'skill-bravo', source: 'custom', description: 'A mid-tier skill.', total: 73, grade: 'B-', letter: 'B', verdict: 'watch',
  evolution: pendingEvolution,
  findings: [{ id: 'f1', dimension: 'disclosure', severity: 'major', title: 'SKILL.md 过大', detail: '正文过大。', evidence: { file: 'SKILL.md', line: 1, excerpt: '---' }, suggestion: '拆到 references/', actionIds: ['fix.extract-sections'] }],
  suggestions: [autoSuggestion, lessonSuggestion, manualSuggestion],
  overlaps: [{ name: 'skill-delta', score: 0.45, sharedTriggers: ['bravo', 'delta'] }],
});
const skillDelta = makeSkill({ name: 'skill-delta', source: 'user-agents', description: 'A stale skill.', total: 12, grade: 'E-', letter: 'E', verdict: 'archive', evolution: notScoredEvolution });

const skillsPortfolio = {
  generatedAt: NOW, windowDays: 30, sessionsScanned: 68,
  totals: { skills: 3, avgScore: 60.7, grades: { S: 1, A: 0, B: 1, C: 0, D: 0, E: 1 }, catalogTokens: 1200, fullLoadTokens: 50000, zeroUse: 1 },
  skills: [skillDelta, skillBravo, skillAlpha],
  overlaps: [],
  issues: { zeroUse: ['skill-delta'], pendingEvolution: ['skill-bravo'] },
};

const bravoDetail = { ...skillBravo, raw: '---\nname: skill-bravo\n---\n\n# skill-bravo\n' + Array.from({ length: 250 }, (_, i) => 'line ' + (i + 1)).join('\n'), lastBackup: null };

const homeAgents = makeSubject({
  id: 'instr:home-agents', kind: 'instruction', name: 'AGENTS.md', title: '本地 agent 工作区', scope: 'global', path: '/Users/fuzhuo/.agents/AGENTS.md', description: '本地 agent 总线。',
  total: 88, grade: 'A', letter: 'A', verdict: 'keep',
  injection: { mode: 'always', sessionsSeen: 40, sessionsInjected: 12, tokensPerInjection: 700, lastInjectedAt: NOW - DAY, duplicatedWith: [] },
  usage: { sessions: 12, perWeek: 2.8, exposureDays: 120, presetSessions: 0, subagentRuns: 0 },
  evolution: makeEvolution({ lessons: { count: 3, latestAt: NOW - 3 * DAY, linked: true }, signals: { sessions: 12, corrections: 1, lastSignalAt: NOW - 3 * DAY } }),
});
const synthesis = makeSubject({
  id: 'agent:synthesis', kind: 'agent', name: 'synthesis_agent', scope: 'project', path: '/Users/fuzhuo/.agents/agents/synthesis.md', description: 'Synthesizes notes.',
  total: 73, grade: 'B-', letter: 'B', verdict: 'watch',
  injection: { mode: 'on-demand', sessionsSeen: 20, sessionsInjected: 0, tokensPerInjection: 1450, lastInjectedAt: null, duplicatedWith: [] },
  usage: { sessions: 2, perWeek: 0.2, exposureDays: 60, presetSessions: 0, subagentRuns: 2 },
  evolution: pendingEvolution,
  findings: [{ id: 'f2', dimension: 'layer', severity: 'major', title: '正文过大', detail: '约 1450 tokens。', evidence: { file: 'agents/synthesis.md', line: 1, excerpt: '# synthesis_agent' }, suggestion: '拆到 agent-notes/', actionIds: ['fix.extract-sections'] }],
  suggestions: [autoSuggestion, lessonSuggestion, manualSuggestion],
  overlaps: [{ id: 'agent:builder', name: 'builder', score: 0.62, sharedTriggers: ['构建'] }],
});
const presetRouter = makeSubject({
  id: 'preset:router', kind: 'preset', name: 'router', scope: 'profile', path: '<profile>/presets/router.json', coverage: 'partial',
  total: 12, grade: 'E-', letter: 'E', verdict: 'archive',
  injection: { mode: 'config', sessionsSeen: 12, sessionsInjected: 0, tokensPerInjection: null, lastInjectedAt: null, duplicatedWith: [] },
  usage: { sessions: 0, perWeek: 0, exposureDays: 200, presetSessions: 0, subagentRuns: 0 },
  evolution: notScoredEvolution,
});

const agentsPortfolio = {
  generatedAt: NOW, windowDays: 30, sessionsScanned: 68,
  roots: ['/Users/fuzhuo/.agents'],
  totals: { subjects: 3, avgScore: 57.7, grades: { S: 0, A: 1, B: 1, C: 0, D: 0, E: 1 }, residentTokens: 4200, zeroInject: 1, conflicts: 1 },
  subjects: [presetRouter, synthesis, homeAgents],
  conflicts: [{ a: 'instr:home-agents', b: 'agent:synthesis', ruleA: '先跑测试再改实现', ruleB: '先改实现再补测试', kind: 'contradiction', ratio: 0.72, lineA: 12, lineB: 8 }],
  overlaps: [],
  issues: { zeroInject: ['agent:synthesis'] },
};

const synthesisDetail = { ...synthesis, raw: '---\nname: synthesis_agent\n---\n\n# synthesis_agent\n' + Array.from({ length: 250 }, (_, i) => 'line ' + (i + 1)).join('\n'), backup: null };

// useState seed order — MUST match Dsh360Page:
// 0 tab
// 1..18 skills (18)
// 19..38 agents (20)
const IDX = {
  tab: 0,
  skillsLoading: 1, skillsPortfolio: 2, skillsLoadError: 3, skillsRefreshKey: 4, skillsSelected: 5,
  skillsDetail: 6, skillsDetailLoading: 7, skillsDetailError: 8, skillsDetailVersion: 9, skillsQuery: 10,
  skillsGradeFilter: 11, skillsVerdictFilter: 12, skillsSourceFilter: 13, skillsOnlyProblems: 14,
  skillsNotice: 15, skillsBusy: 16, skillsLastBackupIds: 17, skillsEvolveEditor: 18,
  agentsLoading: 19, agentsPortfolio: 20, agentsLoadError: 21, agentsRefreshKey: 22, agentsSelected: 23,
  agentsDetail: 24, agentsDetailLoading: 25, agentsDetailError: 26, agentsDetailVersion: 27, agentsQuery: 28,
  agentsKindFilter: 29, agentsGradeFilter: 30, agentsVerdictFilter: 31, agentsScopeFilter: 32, agentsOnlyProblems: 33,
  agentsOnlyEvolution: 34, agentsNotice: 35, agentsBusy: 36, agentsLastBackupIds: 37, agentsEvolveEditor: 38,
};

function baseSeeds(tab) {
  const s = new Array(39).fill(null);
  s[IDX.tab] = tab;
  s[IDX.skillsLoading] = false;
  s[IDX.skillsPortfolio] = skillsPortfolio;
  s[IDX.skillsLoadError] = '';
  s[IDX.skillsSelected] = 'skill-bravo';
  s[IDX.skillsDetail] = bravoDetail;
  s[IDX.skillsDetailLoading] = false;
  s[IDX.skillsDetailError] = '';
  s[IDX.skillsQuery] = '';
  s[IDX.skillsGradeFilter] = 'all';
  s[IDX.skillsVerdictFilter] = 'all';
  s[IDX.skillsSourceFilter] = 'all';
  s[IDX.skillsOnlyProblems] = false;
  s[IDX.skillsNotice] = null;
  s[IDX.skillsBusy] = false;
  s[IDX.skillsLastBackupIds] = null;
  s[IDX.skillsEvolveEditor] = null;
  s[IDX.agentsLoading] = false;
  s[IDX.agentsPortfolio] = agentsPortfolio;
  s[IDX.agentsLoadError] = '';
  s[IDX.agentsSelected] = 'agent:synthesis';
  s[IDX.agentsDetail] = synthesisDetail;
  s[IDX.agentsDetailLoading] = false;
  s[IDX.agentsDetailError] = '';
  s[IDX.agentsQuery] = '';
  s[IDX.agentsKindFilter] = 'all';
  s[IDX.agentsGradeFilter] = 'all';
  s[IDX.agentsVerdictFilter] = 'all';
  s[IDX.agentsScopeFilter] = 'all';
  s[IDX.agentsOnlyProblems] = false;
  s[IDX.agentsOnlyEvolution] = false;
  s[IDX.agentsNotice] = null;
  s[IDX.agentsBusy] = false;
  s[IDX.agentsLastBackupIds] = null;
  s[IDX.agentsEvolveEditor] = null;
  return s;
}

// ---------------------------------------------------------------- assertions

// 2. Default tab is skills; tab bar shows both tabs + badge counts.
let text = render([]);
assert.match(text, /正在加载/);
assert.match(text, /按需加载 \/ 渐进披露/); // skills surface is the default
assert.match(text, /360 体检/);
assert.match(text, /技能/);
assert.match(text, /Agents/);
console.log('PASS 2/8  initial render defaults to the skills tab (loading + skills subtitle + title)');

// tab bar: two buttons, badges = item counts, switching via seed.
let tree = treeOf(baseSeeds('skills'));
let tabButtons = elementsBy(tree, (el) => el.type === 'button' && el.props && el.props['data-tab']);
assert.equal(tabButtons.length, 2, 'two tab buttons');
assert.equal(tabButtons[0].props['data-tab'], 'skills');
assert.equal(tabButtons[1].props['data-tab'], 'agents');
const badgeTexts = elementsBy(tree, (el) => el.props && String(el.props.className || '').includes('d360-tabBadge')).map((el) => textOf(el));
assert.deepEqual(badgeTexts, ['3', '3'], 'tab badges show skills=3, agents=3');

text = render(baseSeeds('agents'));
assert.match(text, /注入命中 \/ 分层与精简/); // agents surface active
assert.match(text, /synthesis_agent/);
assert.doesNotMatch(text, /按需加载 \/ 渐进披露/); // skills surface not rendered
console.log('PASS 3/8  tab switching + badge counts (skills=3, agents=3)');

// 4. Skills tab: list (S+/B-/E- badges), detail, S~E grade filter, apply toast, evolve editor.
text = render(baseSeeds('skills'));
assert.match(text, /skill-alpha/);
assert.match(text, /skill-bravo/);
assert.match(text, /skill-delta/);
assert.match(text, /S\+/);
assert.match(text, /B-/);
assert.match(text, /E-/);
assert.match(text, /保留/);
assert.match(text, /观察/);
assert.match(text, /归档/);
assert.match(text, /待进化/); // bravo pending badge
assert.match(text, /六维评分/);
assert.match(text, /关键指标/);
assert.match(text, /重叠技能/);
assert.match(text, /本技能全部安全优化/);
assert.match(text, /S~E 分布/);

// grade letter filter: 'S' keeps only skill-alpha.
const gradeSSeeds = baseSeeds('skills');
gradeSSeeds[IDX.skillsSelected] = '';
gradeSSeeds[IDX.skillsDetail] = null;
gradeSSeeds[IDX.skillsGradeFilter] = 'S';
text = render(gradeSSeeds);
assert.match(text, /1 个技能/);
assert.match(text, /skill-alpha/);
assert.doesNotMatch(text, /skill-bravo/);

// apply success + failure toasts (skills).
const okSeeds = baseSeeds('skills');
okSeeds[IDX.skillsNotice] = { kind: 'success', text: '已应用，备份 bk-1，分数 73.0 → 80.0' };
okSeeds[IDX.skillsLastBackupIds] = ['bk-1'];
text = render(okSeeds);
assert.match(text, /bk-1/);
assert.match(text, /73\.0 → 80\.0/);
assert.match(text, /撤销上次/);

const failSeeds = baseSeeds('skills');
failSeeds[IDX.skillsNotice] = { kind: 'error', text: '操作失败：disk full' };
text = render(failSeeds);
assert.match(text, /操作失败：disk full/);

// evolution editor (rule required).
const editorSeeds = baseSeeds('skills');
editorSeeds[IDX.skillsEvolveEditor] = { trigger: '用户说“不对”', rule: '', evidence: 'session x' };
text = render(editorSeeds);
assert.match(text, /沉淀经验/);
assert.match(text, /触发/);
assert.match(text, /做法/);
assert.match(text, /证据/);
assert.match(text, /必填/);
assert.match(text, /写入经验/);
assert.match(text, /取消/);
console.log('PASS 4/8  skills tab: list (S+/B-/E-), detail, S~E filter, apply toasts, evolve editor');

// 5. Agents tab: list (kinds, pending), detail (dimensions, injection, conflicts), kind filter.
text = render(baseSeeds('agents'));
assert.match(text, /AGENTS\.md/);
assert.match(text, /synthesis_agent/);
assert.match(text, /router/);
assert.match(text, /说明书/);
assert.match(text, /子代理/);
assert.match(text, /预设/);
assert.match(text, /注入 12\/40/);
assert.match(text, /待进化/); // synthesis pending
assert.match(text, /六维评分/);
assert.match(text, /注入证据/);
assert.match(text, /按需/);
assert.match(text, /0 \/ 20/);
assert.match(text, /跨文件冲突/);
assert.match(text, /矛盾/);
assert.match(text, /重叠对象/);
assert.match(text, /本对象全部安全优化/);
assert.match(text, /3 个对象/);

// kind filter: only agents.
const kindSeeds = baseSeeds('agents');
kindSeeds[IDX.agentsSelected] = '';
kindSeeds[IDX.agentsDetail] = null;
kindSeeds[IDX.agentsKindFilter] = 'agent';
text = render(kindSeeds);
assert.match(text, /1 个对象/);
assert.match(text, /synthesis_agent/);
assert.doesNotMatch(text, /AGENTS\.md/);

// pending-only filter.
const pendingSeeds = baseSeeds('agents');
pendingSeeds[IDX.agentsSelected] = '';
pendingSeeds[IDX.agentsDetail] = null;
pendingSeeds[IDX.agentsOnlyEvolution] = true;
text = render(pendingSeeds);
assert.match(text, /1 个对象/);
assert.match(text, /synthesis_agent/);
assert.doesNotMatch(text, /AGENTS\.md/);

// evolve editor (rule required) + apply toast.
const agentsOkSeeds = baseSeeds('agents');
agentsOkSeeds[IDX.agentsNotice] = { kind: 'success', text: '已应用，备份 bk-2，分数 73.0 → 80.0' };
agentsOkSeeds[IDX.agentsLastBackupIds] = ['bk-2'];
text = render(agentsOkSeeds);
assert.match(text, /上次备份：bk-2/);
assert.match(text, /撤销上次/);

const agentsEditorSeeds = baseSeeds('agents');
agentsEditorSeeds[IDX.agentsEvolveEditor] = { trigger: '用户说“不对”', rule: '', evidence: 'session x' };
text = render(agentsEditorSeeds);
assert.match(text, /沉淀规则/);
assert.match(text, /规则/);
assert.match(text, /必填/);
assert.match(text, /写入规则/);
console.log('PASS 5/8  agents tab: list (kinds/pending), detail, kind filter, apply toast, evolve editor');

// 6. Every fetch path is under /api/dsh-360/skills or /api/dsh-360/agents.
const calls = [];
function payloadFor(url) {
  if (url.endsWith('/apply')) return { backupId: 'bk-apply', changed: 1, report: { score: { total: 80 } } };
  if (url.endsWith('/apply-all')) return { backupId: 'bk-all', applied: [{ id: 'x', actions: ['fix.extract-sections'] }], skipped: [] };
  if (url.endsWith('/undo')) return { backupId: 'bk-apply', restored: ['x'], removed: [] };
  if (url.endsWith('/export')) return { path: '/tmp/dsh-360-report.md', markdown: '# report' };
  if (url.endsWith('/evolve')) return { dryRun: false, backupId: 'bk-evolve', changed: true, beforeTotal: 73, afterTotal: 80, lesson: { trigger: 't', rule: 'r', evidence: 'e' }, report: { score: { total: 80 } } };
  if (url.includes('/subject')) return synthesisDetail;
  if (url.includes('/skill')) return bravoDetail;
  if (url.includes('/scan')) return url.includes('/agents') ? agentsPortfolio : skillsPortfolio;
  return {};
}
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ ok: true, data: payloadFor(url) }) };
};

// skills surface handlers.
let driveTree = treeOf(baseSeeds('skills'));
buttonsIn(elementsBy(driveTree, (el) => el.type === 'li' && el.props && el.props['data-kind'] === 'auto')[0])[0].props.onClick();
await flush();
assert.ok(calls.some((c) => c.url === '/api/dsh-360/skills/apply'), 'skills /apply');
assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/apply')).init.body).name, 'skill-bravo');

driveTree = treeOf(baseSeeds('skills'));
findButton(driveTree, '全部安全优化').props.onClick();
await flush();
assert.ok(calls.some((c) => c.url === '/api/dsh-360/skills/apply-all'), 'skills /apply-all');
assert.equal(JSON.parse(calls.filter((c) => c.url.endsWith('/apply-all')).pop().init.body).safeOnly, true);

// agents surface handlers.
driveTree = treeOf(baseSeeds('agents'));
buttonsIn(elementsBy(driveTree, (el) => el.type === 'li' && el.props && el.props['data-kind'] === 'auto')[0])[0].props.onClick();
await flush();
assert.ok(calls.some((c) => c.url === '/api/dsh-360/agents/apply'), 'agents /apply');
assert.equal(JSON.parse(calls.filter((c) => c.url.endsWith('/apply')).pop().init.body).id, 'agent:synthesis');

driveTree = treeOf(baseSeeds('agents'));
findButton(driveTree, '本对象全部安全优化').props.onClick();
await flush();
assert.equal(JSON.parse(calls.filter((c) => c.url.endsWith('/apply-all')).pop().init.body).id, 'agent:synthesis');

driveTree = treeOf(baseSeeds('agents'));
findButton(driveTree, '导出报告').props.onClick();
await flush();
assert.ok(calls.some((c) => c.url === '/api/dsh-360/agents/export'), 'agents /export');

// skills evolve submit.
const submitSeeds = baseSeeds('skills');
submitSeeds[IDX.skillsEvolveEditor] = { trigger: 't', rule: '先跑测试再改实现', evidence: 'e' };
driveTree = treeOf(submitSeeds);
findButton(driveTree, '写入经验').props.onClick();
await flush();
const evolveCall = calls.find((c) => c.url.endsWith('/evolve'));
assert.ok(evolveCall, 'skills /evolve');
assert.equal(evolveCall.url, '/api/dsh-360/skills/evolve');
assert.equal(JSON.parse(evolveCall.init.body).lesson.rule, '先跑测试再改实现');

// undo (skills, with a seeded backup id so the button is enabled).
driveTree = treeOf((() => { const s = baseSeeds('skills'); s[IDX.skillsLastBackupIds] = ['bk-1']; return s; })());
findButton(driveTree, '撤销上次').props.onClick();
await flush();
assert.ok(calls.some((c) => c.url === '/api/dsh-360/skills/undo'), 'skills /undo');

// every recorded call uses a dsh-360 surface prefix.
for (const call of calls) {
  assert.ok(
    call.url.startsWith('/api/dsh-360/skills/') || call.url.startsWith('/api/dsh-360/agents/'),
    'unexpected api path ' + call.url,
  );
}

// effects: initial scans + details.
calls.length = 0;
runEffects = true;
render(baseSeeds('skills'));
runEffects = false;
await flush();
assert.ok(calls.some((c) => c.url === '/api/dsh-360/skills/scan'), 'skills GET /scan');
assert.ok(calls.some((c) => c.url === '/api/dsh-360/agents/scan'), 'agents GET /scan');
assert.ok(calls.some((c) => c.url === '/api/dsh-360/skills/skill?name=skill-bravo'), 'skills GET /skill');
assert.ok(calls.some((c) => c.url === '/api/dsh-360/agents/subject?id=agent%3Asynthesis'), 'agents GET /subject');
console.log('PASS 6/8  all fetch paths use /api/dsh-360/skills/* or /api/dsh-360/agents/* (GET scan/detail + POST apply/apply-all/undo/export/evolve)');

// 7. 18-bucket grade badge rendering + colour mapping.
text = render(baseSeeds('skills'));
assert.match(text, /S\+/);
assert.match(text, /B-/);
assert.match(text, /E-/);
tree = treeOf(baseSeeds('skills'));
const gradeSpans = elementsBy(tree, (el) => el.type === 'span' && String(el.props.className || '').includes('grade'));
const hasLetterClass = gradeSpans.some((el) => /gradeS\b/.test(el.props.className));
assert.ok(hasLetterClass, 'grade badge keyed by letter (gradeS), not 18-bucket code');
assert.ok(!gradeSpans.some((el) => /gradeS\+/.test(el.props.className)), 'no code-keyed class like gradeS+');
console.log('PASS 7/8  18-bucket badges render S+/B-/E- with letter-keyed colour classes');

// 8. One surface failing does not affect the other tab.
const skillsFailed = baseSeeds('skills');
skillsFailed[IDX.skillsLoadError] = 'skills down';
skillsFailed[IDX.skillsPortfolio] = null;
skillsFailed[IDX.skillsSelected] = '';
skillsFailed[IDX.skillsDetail] = null;
skillsFailed[IDX.agentsPortfolio] = agentsPortfolio; // agents still loaded
text = render(skillsFailed);
assert.match(text, /加载失败/);
assert.match(text, /skills down/);
assert.match(text, /重试/);

const agentsStillWorks = baseSeeds('agents');
agentsStillWorks[IDX.skillsLoadError] = 'skills down';
agentsStillWorks[IDX.skillsPortfolio] = null;
agentsStillWorks[IDX.agentsPortfolio] = agentsPortfolio;
text = render(agentsStillWorks);
assert.match(text, /synthesis_agent/);
assert.doesNotMatch(text, /skills down/); // error confined to its own tab
console.log('PASS 8/8  a failing skills surface leaves the agents tab usable (error shown only in its tab)');

// Sidebar icon renders as an SVG at the requested size.
for (const props of [{ size: 20, active: false }, { size: 20, active: true }]) {
  hookIndex = 0;
  seeds = [];
  const svg = sidebar.component(props);
  assert.equal(svg.type, 'svg');
  assert.equal(svg.props.width, 20);
  assert.equal(svg.props.height, 20);
}
const label = sidebar.options.label();
assert.equal(typeof label, 'string');
assert.ok(label.length > 0);
console.log('PASS sidebar icon renders as SVG (20x20) and label() returns a string');

console.log('\n✓ dsh-360 client render smoke test passed: 8/8 + registration + style + sidebar icon');
