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
 *   - lazy surfaces: mount/switch/detail requests stay on the active tab
 *   - stale-while-revalidate: quick snapshot + aria-live banner, then fresh data;
 *     a quick 404 falls back to the normal scan
 *   - classification UI: taxonomy labels, role chips with counts, click-to-filter,
 *     card evidence/confidence, human summary line with data time and trend
 *   - optimization effect card: score delta, tokens saved, per-item toast, undo,
 *     and portfolio.lastApply rendered as 上次优化
 *
 * Hooks are seeded by order (see IDX below); a seed of NO_SEED reads the state
 * written by an earlier click, so handler-driven state can be observed.
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
//
// Hooks are seeded by order. A seed of NO_SEED (or a missing slot) means "not
// seeded this render": useState then falls back to a value written by an earlier
// event handler (stateStore) and only then to its initial value. That lets a test
// click a button, let the async handler finish, and render again to observe the
// state it wrote without a real React re-render loop.

const NO_SEED = Symbol('no-seed');
const stateStore = new Map();
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
    const index = hookIndex;
    hookIndex += 1;
    const seed = index < seeds.length ? seeds[index] : NO_SEED;
    const stored = stateStore.has(index) ? stateStore.get(index) : NO_SEED;
    const value = seed !== NO_SEED ? seed : (stored !== NO_SEED ? stored : initial);
    return [value, (next) => {
      const previous = stateStore.has(index) ? stateStore.get(index) : value;
      stateStore.set(index, typeof next === 'function' ? next(previous) : next);
    }];
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
assert.match(styleText, /prefers-reduced-motion/, 'animations respect prefers-reduced-motion');
assert.match(styleText, /\.d360-skeleton\{/, 'loading skeleton styles present');
assert.match(styleText, /\.d360-effect\{/, 'optimization effect card styles present');
console.log('PASS 1/13  loader id + panel key = dsh-360, order 41, single style tag (s360- + a360-, deduped keyframe, S~E colours, reduced motion)');

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

// A render where every hook starts unseeded (initial value or a stored write).
// `overrides` is a sparse { hookIndex: value } map; deliberately seeding an index
// to NO_SEED makes that hook read the stateStore instead of the fixture.
function sparseTree(overrides) {
  const values = new Array(HOOK_COUNT).fill(NO_SEED);
  for (const [index, value] of Object.entries(overrides || {})) {
    values[Number(index)] = value;
  }
  return treeOf(values);
}

function resetState() {
  stateStore.clear();
}

function seededWithStore(base, indices) {
  const values = base.slice();
  for (const index of indices) values[index] = NO_SEED;
  return values;
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

// The client must render these labels verbatim; it has no role dictionary of its
// own. Kind/scope/state labels come from the same taxonomy.
const TAXONOMY = {
  version: 1,
  axes: [
    {
      id: 'role',
      label: '职责',
      values: [
        { id: 'review', label: '审查验证' },
        { id: 'build', label: '编码实现' },
        { id: 'knowledge', label: '知识管理' },
        { id: 'ops', label: '运维治理' },
        { id: 'orchestrate', label: '编排调度' },
      ],
    },
    {
      id: 'layer',
      label: '层级',
      values: [
        { id: 'meta', label: '元技能' },
        { id: 'task', label: '任务技能' },
      ],
    },
    {
      id: 'kind',
      label: '类型',
      values: [
        { id: 'layered', label: '分层参考' },
        { id: 'scripted', label: '带脚本' },
        { id: 'prose', label: '单文件' },
        { id: 'instruction', label: '常驻说明书' },
        { id: 'agent', label: '子代理定义' },
        { id: 'preset', label: '运行预设' },
      ],
    },
    {
      id: 'scope',
      label: '范围',
      values: [
        { id: 'global', label: '全局' },
        { id: 'project', label: '项目' },
        { id: 'profile', label: '配置' },
      ],
    },
    {
      id: 'state',
      label: '状态',
      values: [
        { id: 'active', label: '在用' },
        { id: 'idle', label: '闲置' },
        { id: 'pending', label: '待沉淀' },
        { id: 'critical', label: '有严重问题' },
      ],
    },
  ],
};

function classification({ role, roleLabel, roleEvidence = [], roleConfidence = 0.85, layer, layerLabel, kind, kindLabel, scope, scopeLabel, state = [], summary }) {
  return {
    role: { id: role, label: roleLabel, confidence: roleConfidence, evidence: roleEvidence },
    ...(layer ? { layer: { id: layer, label: layerLabel } } : {}),
    kind: { id: kind, label: kindLabel },
    scope: { id: scope, label: scopeLabel },
    state: state.map((entry) => (typeof entry === 'string' ? { id: entry } : entry)),
    summary,
    tags: ['role:' + role].concat(layer ? ['layer:' + layer] : [], ['kind:' + kind, 'scope:' + scope])
      .concat(state.map((entry) => 'state:' + (typeof entry === 'string' ? entry : entry.id))),
  };
}

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

function makeSkill({ name, source, description, total, grade, letter, verdict, findings = [], suggestions = [], overlaps = [], evolution, classification: cls = null, delta = null }) {
  return {
    name,
    source,
    provider: 'filesystem',
    path: '/skills/' + name + '/SKILL.md',
    dir: '/skills/' + name,
    description,
    coverage: 'full',
    mtime: NOW,
    classification: cls,
    metrics: { descriptionChars: (description || '').length, catalogChars: 200, catalogTruncated: false, bodyLines: 220, estTokens: 1500, referenceCount: 1, referencedFiles: 1, orphanReferences: 1, overlapMax: overlaps.length ? overlaps[0].score : 0.1 },
    usage: { count: 6, lastUsedAt: NOW - DAY, perWeek: 1.4 },
    score: { total, grade, letter, confidence: 0.9, delta, dimensions: [dim('load', '按需加载', 16, 20, '有加载'), dim('disclosure', '渐进披露', 18, 25, '正文偏大'), dim('actionability', '可执行性', 15, 20, '步骤尚可'), dim('boundary', '边界与治理', 12, 15, '缺少何时不用'), dim('hygiene', '维护卫生', 7, 10, '存在孤儿引用'), dim('evolution', '持续进化', 4, 10, '经验过时')] },
    verdict: { code: verdict, reason: '示例结论：总分 ' + total + '。' },
    evolution: evolution || makeEvolution({}),
    findings,
    suggestions,
    overlaps,
  };
}

function makeSubject({ id, kind, name, title = null, scope, path, description = null, total, grade, letter, verdict, injection, usage, evolution, findings = [], suggestions = [], overlaps = [], classification: cls = null, delta = null }) {
  return {
    id, kind, name, title, scope,
    source: kind === 'preset' ? 'profile-config' : 'filesystem',
    path, dir: path.slice(0, path.lastIndexOf('/')), owner: null, mtime: NOW - 30 * DAY, coverage: 'full', description,
    classification: cls,
    metrics: { chars: 1899, estTokens: 1450, lines: 120, headings: 12, h2: 4, bullets: 30, numberedSteps: 3, commands: 4, imperativeCount: 9, codeBlocks: 2, codeRatio: 0.12, sections: [], localLinks: [], staleRefs: [], dupSentences: [], builtinOverlap: 0.22, todos: 0, secrets: 0, dangerous: 0, bakFiles: 2, frontmatter: { ok: true } },
    injection,
    usage,
    evolution,
    score: { total, grade, letter, confidence: 0.8, delta, dimensions: [dim('inject', '注入命中', 10, 20, '注入弱'), dim('layer', '分层与精简', 15, 25, '偏大'), dim('actionable', '可执行性', 12, 20, '尚可'), dim('governance', '边界与治理', 9, 15, '缺边界'), dim('hygiene', '维护卫生', 8, 10, '失效引用'), dim('evolution', '持续进化', 4, 10, '有未沉淀信号')] },
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

const skillAlpha = makeSkill({
  name: 'skill-alpha', source: 'user-agents', description: 'A well-tuned skill.', total: 97, grade: 'S+', letter: 'S', verdict: 'keep',
  classification: classification({
    role: 'review', roleLabel: '审查验证', roleEvidence: ['review', '审计'], roleConfidence: 0.85,
    layer: 'meta', layerLabel: '元技能',
    kind: 'layered', kindLabel: '分层参考', scope: 'global', scopeLabel: '全局',
    state: ['active'], summary: '审查代码改动并给出可落地改进建议',
  }),
  delta: 1.6,
});
const skillBravo = makeSkill({
  name: 'skill-bravo', source: 'custom', description: 'A mid-tier skill.', total: 73, grade: 'B-', letter: 'B', verdict: 'watch',
  // Deliberately different from the taxonomy label: the UI must prefer taxonomy.
  classification: classification({
    role: 'build', roleLabel: 'WRONG_CLASS_LABEL', roleEvidence: ['build'], roleConfidence: 0.75,
    layer: 'task', layerLabel: '任务技能',
    kind: 'scripted', kindLabel: '带脚本', scope: 'project', scopeLabel: '项目',
    state: ['pending'], summary: '执行构建与重构流程',
  }),
  delta: 2.4,
  evolution: pendingEvolution,
  findings: [{ id: 'f1', dimension: 'disclosure', severity: 'major', title: 'SKILL.md 过大', detail: '正文过大。', evidence: { file: 'SKILL.md', line: 1, excerpt: '---' }, suggestion: '拆到 references/', actionIds: ['fix.extract-sections'] }],
  suggestions: [autoSuggestion, lessonSuggestion, manualSuggestion],
  overlaps: [{ name: 'skill-delta', score: 0.45, sharedTriggers: ['bravo', 'delta'] }],
});
const skillDelta = makeSkill({
  name: 'skill-delta', source: 'user-agents', description: 'A stale skill.', total: 12, grade: 'E-', letter: 'E', verdict: 'archive',
  classification: classification({
    role: 'knowledge', roleLabel: '知识管理', roleEvidence: ['archive'], roleConfidence: 0.65,
    layer: 'task', layerLabel: '任务技能',
    kind: 'prose', kindLabel: '单文件', scope: 'global', scopeLabel: '全局',
    state: ['idle', 'critical'], summary: '沉淀历史经验与归档索引',
  }),
  evolution: notScoredEvolution,
});

const skillsPortfolio = {
  generatedAt: NOW, windowDays: 30, sessionsScanned: 68,
  taxonomy: TAXONOMY,
  trend: { generatedAt: NOW, previousGeneratedAt: NOW - DAY, avgDelta: 2.4, itemsChanged: 2 },
  lastApply: {
    surface: 'skills', at: NOW - 3600000, items: 2,
    scoreBefore: 60, scoreAfter: 62, delta: 2,
    tokensBefore: 3000, tokensAfter: 2500, tokensSaved: 500,
    gradeUps: 1, verdictChanges: 1, targets: [], backupIds: ['bk-last'],
  },
  totals: {
    skills: 3, avgScore: 60.7, grades: { S: 1, A: 0, B: 1, C: 0, D: 0, E: 1 },
    byRole: { review: 1, build: 1, knowledge: 1 },
    byKind: { layered: 1, scripted: 1, prose: 1 },
    byScope: { global: 2, project: 1 },
    catalogTokens: 1200, fullLoadTokens: 50000, zeroUse: 1,
  },
  skills: [skillDelta, skillBravo, skillAlpha],
  overlaps: [],
  issues: { zeroUse: ['skill-delta'], pendingEvolution: ['skill-bravo'] },
};

const bravoDetail = { ...skillBravo, raw: '---\nname: skill-bravo\n---\n\n# skill-bravo\n' + Array.from({ length: 250 }, (_, i) => 'line ' + (i + 1)).join('\n'), lastBackup: null };

const homeAgents = makeSubject({
  id: 'instr:home-agents', kind: 'instruction', name: 'AGENTS.md', title: '本地 agent 工作区', scope: 'global', path: '/Users/fuzhuo/.agents/AGENTS.md', description: '本地 agent 总线。',
  total: 88, grade: 'A', letter: 'A', verdict: 'keep',
  classification: classification({
    role: 'ops', roleLabel: '运维治理', roleEvidence: ['agent'], roleConfidence: 0.7,
    kind: 'instruction', kindLabel: '常驻说明书', scope: 'global', scopeLabel: '全局',
    state: ['active'], summary: '工作区常驻规则与总线约定',
  }),
  delta: 0.8,
  injection: { mode: 'always', sessionsSeen: 40, sessionsInjected: 12, tokensPerInjection: 700, lastInjectedAt: NOW - DAY, duplicatedWith: [] },
  usage: { sessions: 12, perWeek: 2.8, exposureDays: 120, presetSessions: 0, subagentRuns: 0 },
  evolution: makeEvolution({ lessons: { count: 3, latestAt: NOW - 3 * DAY, linked: true }, signals: { sessions: 12, corrections: 1, lastSignalAt: NOW - 3 * DAY } }),
});
const synthesis = makeSubject({
  id: 'agent:synthesis', kind: 'agent', name: 'synthesis_agent', scope: 'project', path: '/Users/fuzhuo/.agents/agents/synthesis.md', description: 'Synthesizes notes.',
  total: 73, grade: 'B-', letter: 'B', verdict: 'watch',
  classification: classification({
    role: 'knowledge', roleLabel: '知识管理', roleEvidence: ['notes'], roleConfidence: 0.6,
    kind: 'agent', kindLabel: '子代理定义', scope: 'project', scopeLabel: '项目',
    state: ['pending'], summary: '把散落笔记合成为结论',
  }),
  delta: -1.2,
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
  classification: classification({
    role: 'orchestrate', roleLabel: '编排调度', roleEvidence: ['router'], roleConfidence: 0.75,
    kind: 'preset', kindLabel: '运行预设', scope: 'profile', scopeLabel: '配置',
    state: ['idle'], summary: '按任务路由到对应子代理',
  }),
  injection: { mode: 'config', sessionsSeen: 12, sessionsInjected: 0, tokensPerInjection: null, lastInjectedAt: null, duplicatedWith: [] },
  usage: { sessions: 0, perWeek: 0, exposureDays: 200, presetSessions: 0, subagentRuns: 0 },
  evolution: notScoredEvolution,
});

const agentsPortfolio = {
  generatedAt: NOW, windowDays: 30, sessionsScanned: 68,
  roots: ['/Users/fuzhuo/.agents'],
  taxonomy: TAXONOMY,
  trend: { generatedAt: NOW, previousGeneratedAt: NOW - DAY, avgDelta: -0.5, itemsChanged: 1 },
  totals: {
    subjects: 3, avgScore: 57.7, grades: { S: 0, A: 1, B: 1, C: 0, D: 0, E: 1 },
    byRole: { ops: 1, knowledge: 1, orchestrate: 1 },
    byKind: { instruction: 1, agent: 1, preset: 1 },
    byScope: { global: 1, project: 1, profile: 1 },
    residentTokens: 4200, zeroInject: 1, conflicts: 1,
  },
  subjects: [presetRouter, synthesis, homeAgents],
  conflicts: [{ a: 'instr:home-agents', b: 'agent:synthesis', ruleA: '先跑测试再改实现', ruleB: '先改实现再补测试', kind: 'contradiction', ratio: 0.72, lineA: 12, lineB: 8 }],
  overlaps: [],
  issues: { zeroInject: ['agent:synthesis'] },
};

const synthesisDetail = { ...synthesis, raw: '---\nname: synthesis_agent\n---\n\n# synthesis_agent\n' + Array.from({ length: 250 }, (_, i) => 'line ' + (i + 1)).join('\n'), backup: null };

// useState seed order — MUST match Dsh360Page exactly (47 useState calls).
// 0 tab
// 1..23 skills surface (23): requested, loading, portfolio, loadError, refreshKey,
//      selected, detail, detailLoading, detailError, detailVersion, query,
//      roleFilter, kindFilter, scopeFilter, gradeFilter, verdictFilter, sourceFilter,
//      onlyProblems, notice, busy, lastBackupIds, evolveEditor, effect
// 24..46 agents surface (23): same shape with agentsRoleFilter
const IDX = {
  tab: 0,
  skillsRequested: 1, skillsLoading: 2, skillsPortfolio: 3, skillsLoadError: 4, skillsRefreshKey: 5,
  skillsSelected: 6, skillsDetail: 7, skillsDetailLoading: 8, skillsDetailError: 9, skillsDetailVersion: 10,
  skillsQuery: 11, skillsFiltersOpen: 12, skillsRoleFilter: 13, skillsLayerFilter: 14,
  skillsKindFilter: 15, skillsScopeFilter: 16, skillsGradeFilter: 17, skillsVerdictFilter: 18,
  skillsSourceFilter: 19, skillsOnlyProblems: 20, skillsNotice: 21, skillsBusy: 22,
  skillsLastBackupIds: 23, skillsEvolveEditor: 24, skillsEffect: 25,
  agentsRequested: 26, agentsLoading: 27, agentsPortfolio: 28, agentsLoadError: 29, agentsRefreshKey: 30,
  agentsSelected: 31, agentsDetail: 32, agentsDetailLoading: 33, agentsDetailError: 34, agentsDetailVersion: 35,
  agentsQuery: 36, agentsFiltersOpen: 37, agentsRoleFilter: 38, agentsKindFilter: 39, agentsScopeFilter: 40,
  agentsGradeFilter: 41, agentsVerdictFilter: 42, agentsOnlyProblems: 43, agentsOnlyEvolution: 44,
  agentsNotice: 45, agentsBusy: 46, agentsLastBackupIds: 47, agentsEvolveEditor: 48, agentsEffect: 49,
};
const HOOK_COUNT = 50;

function baseSeeds(tab) {
  const s = new Array(HOOK_COUNT).fill(null);
  s[IDX.tab] = tab;
  // The fixture represents a panel where both surfaces have already painted.
  s[IDX.skillsRequested] = true;
  s[IDX.skillsLoading] = false;
  s[IDX.skillsPortfolio] = skillsPortfolio;
  s[IDX.skillsLoadError] = '';
  s[IDX.skillsSelected] = 'skill-bravo';
  s[IDX.skillsDetail] = bravoDetail;
  s[IDX.skillsDetailLoading] = false;
  s[IDX.skillsDetailError] = '';
  s[IDX.skillsQuery] = '';
  s[IDX.skillsFiltersOpen] = true; // tests drive the filter panel directly
  s[IDX.skillsRoleFilter] = 'all';
  s[IDX.skillsLayerFilter] = 'all';
  s[IDX.skillsKindFilter] = 'all';
  s[IDX.skillsScopeFilter] = 'all';
  s[IDX.skillsGradeFilter] = 'all';
  s[IDX.skillsVerdictFilter] = 'all';
  s[IDX.skillsSourceFilter] = 'all';
  s[IDX.skillsOnlyProblems] = false;
  s[IDX.skillsNotice] = null;
  s[IDX.skillsBusy] = false;
  s[IDX.skillsLastBackupIds] = null;
  s[IDX.skillsEvolveEditor] = null;
  s[IDX.skillsEffect] = null;
  s[IDX.agentsRequested] = true;
  s[IDX.agentsLoading] = false;
  s[IDX.agentsPortfolio] = agentsPortfolio;
  s[IDX.agentsLoadError] = '';
  s[IDX.agentsSelected] = 'agent:synthesis';
  s[IDX.agentsDetail] = synthesisDetail;
  s[IDX.agentsDetailLoading] = false;
  s[IDX.agentsDetailError] = '';
  s[IDX.agentsQuery] = '';
  s[IDX.agentsFiltersOpen] = true;
  s[IDX.agentsRoleFilter] = 'all';
  s[IDX.agentsKindFilter] = 'all';
  s[IDX.agentsScopeFilter] = 'all';
  s[IDX.agentsGradeFilter] = 'all';
  s[IDX.agentsVerdictFilter] = 'all';
  s[IDX.agentsOnlyProblems] = false;
  s[IDX.agentsOnlyEvolution] = false;
  s[IDX.agentsNotice] = null;
  s[IDX.agentsBusy] = false;
  s[IDX.agentsLastBackupIds] = null;
  s[IDX.agentsEvolveEditor] = null;
  s[IDX.agentsEffect] = null;
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
const loadingTree = treeOf([]);
assert.ok(elementsBy(loadingTree, (el) => el.props
  && String(el.props.className || '').includes('d360-skeleton')).length >= 1,
'initial load renders a skeleton, not a blank panel');
assert.ok(elementsBy(loadingTree, (el) => el.props
  && String(el.props.className || '').includes('d360-skelBar')).length >= 1,
'skeleton has placeholder bars');
console.log('PASS 2/13  initial render defaults to the skills tab (skeleton + skills subtitle + title)');

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
console.log('PASS 3/13 tab switching + badge counts (skills=3, agents=3)');

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
console.log('PASS 4/13 skills tab: list (S+/B-/E-), detail, S~E filter, apply toasts, evolve editor');

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
console.log('PASS 5/13 agents tab: list (kinds/pending), detail, kind filter, apply toast, evolve editor');

// 6. Every fetch path is under /api/dsh-360/skills or /api/dsh-360/agents.
const calls = [];
function applyEffectFor(url) {
  const agents = url.includes('/agents');
  const key = agents ? 'agent:synthesis' : 'skill-bravo';
  return {
    surface: agents ? 'agents' : 'skills',
    at: NOW,
    items: 1,
    scoreBefore: 72.3,
    scoreAfter: 78.9,
    delta: 6.6,
    tokensBefore: 2740,
    tokensAfter: 1500,
    tokensSaved: 1240,
    gradeUps: 1,
    verdictChanges: 1,
    backupIds: ['bk-apply'],
    targets: [{ key, before: 72.3, after: 78.9, delta: 6.6, gradeBefore: 'B-', gradeAfter: 'B' }],
  };
}
function payloadFor(url) {
  if (url.endsWith('/apply')) return { backupId: 'bk-apply', changed: 1, report: { score: { total: 80 } }, effect: applyEffectFor(url) };
  if (url.endsWith('/apply-all')) return { backupId: 'bk-all', backupIds: ['bk-all'], applied: [{ id: 'x', actions: ['fix.extract-sections'] }], skipped: [], effect: applyEffectFor(url) };
  if (url.endsWith('/undo')) return { backupId: 'bk-apply', restored: ['x'], removed: [] };
  if (url.endsWith('/export')) return { path: '/tmp/dsh-360-report.md', markdown: '# report' };
  if (url.endsWith('/evolve')) return { dryRun: false, backupId: 'bk-evolve', changed: true, beforeTotal: 73, afterTotal: 80, lesson: { trigger: 't', rule: 'r', evidence: 'e' }, report: { score: { total: 80 } } };
  if (url.includes('/subject')) return synthesisDetail;
  if (url.includes('/skill')) return bravoDetail;
  if (url.includes('/scan')) return url.includes('/agents') ? agentsPortfolio : skillsPortfolio;
  return {};
}
const baseFetch = async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ ok: true, data: payloadFor(url) }) };
};
globalThis.fetch = baseFetch;

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
assert.deepEqual(stateStore.get(IDX.skillsLastBackupIds), ['bk-all'], 'apply-all keeps every backup id for batch undo');

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
assert.deepEqual(stateStore.get(IDX.agentsLastBackupIds), ['bk-all'], 'agents apply-all keeps every backup id');

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
console.log('PASS 6/13  all fetch paths use /api/dsh-360/skills/* or /api/dsh-360/agents/* (POST apply/apply-all/undo/export/evolve)');

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
console.log('PASS 7/13  18-bucket badges render S+/B-/E- with letter-keyed colour classes');

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
console.log('PASS 8/13  a failing skills surface leaves the agents tab usable (error shown only in its tab)');

// 9. Lazy surfaces: mount paints only the active tab; the other is requested on
// the first switch, and detail requests follow their own surface.
resetState();
calls.length = 0;
runEffects = true;
try {
  render([]); // initial mount: skills tab, no data
  await flush();
  const mountScans = calls.filter((call) => call.url.includes('/scan'));
  assert.ok(mountScans.length >= 1, 'mount starts a scan');
  assert.ok(mountScans.every((call) => call.url.startsWith('/api/dsh-360/skills/')),
    'mount only scans the active skills surface');
  assert.ok(!calls.some((call) => call.url.startsWith('/api/dsh-360/agents/')),
    'mount never calls the agents surface');
  assert.equal(calls[0].url, '/api/dsh-360/skills/scan?quick=1', 'first request is the quick snapshot');
  assert.ok(calls.some((call) => call.url === '/api/dsh-360/skills/scan?view=list'),
    'then the fresh list-view scan (no bodies/findings)');
} finally {
  runEffects = false;
}

// First switch to agents: skills already painted, agents still empty.
resetState();
calls.length = 0;
const switchSeeds = new Array(HOOK_COUNT).fill(NO_SEED);
switchSeeds[IDX.tab] = 'agents';
switchSeeds[IDX.skillsRequested] = true;
switchSeeds[IDX.skillsLoading] = false;
switchSeeds[IDX.skillsPortfolio] = skillsPortfolio;
switchSeeds[IDX.agentsRequested] = true;
switchSeeds[IDX.agentsLoading] = true;
switchSeeds[IDX.agentsPortfolio] = null;
runEffects = true;
try {
  treeOf(switchSeeds);
  await flush();
} finally {
  runEffects = false;
}
const switchScans = calls.filter((call) => call.url.includes('/scan'));
assert.equal(switchScans.filter((call) => call.url.endsWith('/scan?quick=1')).length, 1, 'switch asks for the other surface once (quick)');
assert.equal(switchScans.filter((call) => call.url.endsWith('/scan?view=list')).length, 1, 'switch asks for the other surface once (fresh list view)');
assert.ok(switchScans.every((call) => call.url.startsWith('/api/dsh-360/agents/')),
  'switching tabs scans only the newly active surface');
assert.ok(!calls.some((call) => call.url.startsWith('/api/dsh-360/skills/')),
  'switching tabs does not re-scan the already painted surface');

// Detail fetching also stays on the surface that owns it.
resetState();
calls.length = 0;
const skillsDetailSeeds = new Array(HOOK_COUNT).fill(NO_SEED);
skillsDetailSeeds[IDX.tab] = 'skills';
skillsDetailSeeds[IDX.skillsRequested] = true;
skillsDetailSeeds[IDX.skillsLoading] = false;
skillsDetailSeeds[IDX.skillsPortfolio] = skillsPortfolio;
skillsDetailSeeds[IDX.skillsSelected] = 'skill-bravo';
skillsDetailSeeds[IDX.skillsDetail] = null;
runEffects = true;
try {
  treeOf(skillsDetailSeeds);
  await flush();
} finally {
  runEffects = false;
}
assert.ok(calls.some((call) => call.url === '/api/dsh-360/skills/skill?name=skill-bravo'), 'skills GET /skill');
assert.ok(!calls.some((call) => call.url.startsWith('/api/dsh-360/agents/')), 'skills detail does not touch agents');

resetState();
calls.length = 0;
const agentsDetailSeeds = new Array(HOOK_COUNT).fill(NO_SEED);
agentsDetailSeeds[IDX.tab] = 'agents';
agentsDetailSeeds[IDX.agentsRequested] = true;
agentsDetailSeeds[IDX.agentsLoading] = false;
agentsDetailSeeds[IDX.agentsPortfolio] = agentsPortfolio;
agentsDetailSeeds[IDX.agentsSelected] = 'agent:synthesis';
agentsDetailSeeds[IDX.agentsDetail] = null;
runEffects = true;
try {
  treeOf(agentsDetailSeeds);
  await flush();
} finally {
  runEffects = false;
}
assert.ok(calls.some((call) => call.url === '/api/dsh-360/agents/subject?id=agent%3Asynthesis'), 'agents GET /subject');
assert.ok(!calls.some((call) => call.url.startsWith('/api/dsh-360/skills/')), 'agents detail does not touch skills');
console.log('PASS 9/13  lazy surfaces: mount/switch/detail requests stay on the active tab');

// 10. Stale-while-revalidate: quick snapshot paints with an aria-live banner, the
// fresh scan replaces it; a 404 on quick falls back to the normal scan path.
const okResponse = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const failResponse = (status, message) => ({
  ok: false,
  status,
  json: async () => ({ ok: false, error: { message } }),
});
const previousFetch = globalThis.fetch;
resetState();
calls.length = 0;
const quickPortfolio = { ...skillsPortfolio, generatedAt: NOW - 60000, cachedAt: NOW - 60000, stale: true };
const freshSkill = makeSkill({
  name: 'skill-fresh', source: 'user-agents', description: 'Just scanned.', total: 81, grade: 'B+', letter: 'B', verdict: 'keep',
  classification: classification({
    role: 'review', roleLabel: '审查验证', kind: 'prose', kindLabel: '单文件', scope: 'global', scopeLabel: '全局',
    state: ['active'], summary: '刷新后才出现的技能',
  }),
});
const freshPortfolio = {
  ...skillsPortfolio,
  generatedAt: NOW,
  totals: { ...skillsPortfolio.totals, skills: 4, grades: { S: 1, A: 0, B: 2, C: 0, D: 0, E: 1 } },
  skills: skillsPortfolio.skills.concat([freshSkill]),
};
let releaseFresh;
const freshGate = new Promise((resolve) => { releaseFresh = resolve; });
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  if (url === '/api/dsh-360/skills/scan?quick=1') return okResponse(quickPortfolio);
  if (url === '/api/dsh-360/skills/scan?view=list') {
    await freshGate;
    return okResponse(freshPortfolio);
  }
  return okResponse({});
};
runEffects = true;
try {
  treeOf(['skills']);
  await flush();
} finally {
  runEffects = false;
}
assert.ok(calls.some((call) => call.url === '/api/dsh-360/skills/scan?quick=1'), 'quick scan requested first');
const liveSeed = { [IDX.tab]: 'skills', [IDX.skillsSelected]: '', [IDX.skillsDetail]: null };
const staleTree = sparseTree(liveSeed);
const staleText = textOf(staleTree);
assert.match(staleText, /更新于 .*，正在刷新/, 'stale banner text');
assert.match(staleText, /skill-delta/, 'quick snapshot renders before the fresh scan');
assert.ok(elementsBy(staleTree, (el) => el.props && el.props['aria-live'] === 'polite'
  && textOf(el).includes('正在刷新')).length >= 1, 'stale banner is aria-live="polite"');
assert.ok(!elementsBy(staleTree, (el) => String(el.props && el.props.className || '').includes('s360-spinner')).length,
  'no spinner while a stale snapshot is painted');
assert.ok(!elementsBy(staleTree, (el) => String(el.props && el.props.className || '').includes('d360-skeleton')).length,
  'no skeleton while a stale snapshot is painted');
assert.equal(stateStore.get(IDX.skillsPortfolio).stale, true, 'quick snapshot is marked stale');

releaseFresh();
await flush();
const freshTree = sparseTree(liveSeed);
const freshText = textOf(freshTree);
assert.match(freshText, /skill-fresh/, 'fresh scan replaces the snapshot');
assert.doesNotMatch(freshText, /正在刷新/, 'stale banner disappears after the fresh scan');
assert.equal(stateStore.get(IDX.skillsPortfolio).stale, undefined, 'fresh portfolio has no stale flag');

// quick 404 -> normal scan path, no stale banner.
resetState();
calls.length = 0;
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  if (url === '/api/dsh-360/skills/scan?quick=1') return failResponse(404, 'no snapshot yet');
  if (url === '/api/dsh-360/skills/scan?view=list') return okResponse(skillsPortfolio);
  return okResponse({});
};
runEffects = true;
try {
  treeOf(['skills']);
  await flush();
} finally {
  runEffects = false;
}
assert.equal(calls[0].url, '/api/dsh-360/skills/scan?quick=1', 'quick is attempted first');
assert.ok(calls.some((call) => call.url === '/api/dsh-360/skills/scan?view=list'), '404 falls back to the normal list scan');
const fallbackText = textOf(sparseTree(liveSeed));
assert.doesNotMatch(fallbackText, /正在刷新/, 'no stale banner without a snapshot');
assert.match(fallbackText, /skill-alpha/, 'normal scan renders');
globalThis.fetch = previousFetch;
console.log('PASS 10/13  quick snapshot shows an aria-live stale banner, fresh scan replaces it, 404 falls back');

// 11. Classification UI + human summary: taxonomy labels, grouped chips, click-to-
// filter, and the one-sentence header.
resetState();
text = render(baseSeeds('skills'));
assert.match(text, /职责/);
assert.match(text, /类型/);
assert.match(text, /范围/);
assert.match(text, /等级/);
assert.match(text, /审查验证/, 'role label comes from the taxonomy');
assert.match(text, /编码实现/);
assert.doesNotMatch(text, /WRONG_CLASS_LABEL/, 'taxonomy label wins over the classification label');
assert.match(text, /3 个技能，2 个待处理；最该先看 skill-delta/, 'human summary sentence');
assert.match(text, /数据时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/, 'data time in the summary');
assert.match(text, /较上次平均分 \+2\.4，2 项变化/, 'trend delta in the summary');
assert.match(text, /待沉淀/, 'pending state badge');
assert.match(text, /在用/, 'active state badge');
assert.match(text, /闲置/, 'idle state badge');
assert.match(text, /有严重问题/, 'critical state badge');
assert.match(text, /↑ \+2\.4/, 'row delta is textual and signed');

const richTree = treeOf(baseSeeds('skills'));
assert.ok(elementsBy(richTree, (el) => String(el.props && el.props.className || '').includes('d360-stateDot')).length >= 3,
  'state badges use a dot, not colour alone');
const evidenceNode = elementsBy(richTree, (el) => typeof (el.props && el.props.title) === 'string'
  && el.props.title.includes('依据'))[0];
assert.ok(evidenceNode, 'role evidence is exposed as a title tooltip');
const cardFilter = elementsBy(richTree, (el) => el.type === 'button' && textOf(el) === '按职责筛选')[0];
assert.ok(cardFilter, 'classification card offers 按职责筛选');

resetState();
const cardTree = treeOf(baseSeeds('skills'));
elementsBy(cardTree, (el) => el.type === 'button' && textOf(el) === '按职责筛选')[0].props.onClick();
assert.equal(stateStore.get(IDX.skillsRoleFilter), 'build', '按职责筛选 applies the role filter');

const chipTree = treeOf(baseSeeds('skills'));
const roleChips = elementsBy(chipTree, (el) => el.type === 'button' && el.props && el.props['data-axis'] === 'role');
const reviewChip = roleChips.find((el) => el.props['data-value'] === 'review');
assert.ok(reviewChip, 'role chip for review exists');
assert.equal(textOf(reviewChip), '审查验证 1', 'role chip label + count from totals.byRole');
assert.equal(reviewChip.props['aria-pressed'], 'false', 'inactive chip has aria-pressed=false');

resetState();
const clickTree = treeOf(baseSeeds('skills'));
elementsBy(clickTree, (el) => el.type === 'button' && el.props && el.props['data-axis'] === 'role'
  && el.props['data-value'] === 'review')[0].props.onClick();
assert.equal(stateStore.get(IDX.skillsRoleFilter), 'review', 'clicking a role chip applies that filter');

const filteredSeeds = baseSeeds('skills');
filteredSeeds[IDX.skillsRoleFilter] = NO_SEED;
filteredSeeds[IDX.skillsSelected] = '';
filteredSeeds[IDX.skillsDetail] = null;
const filteredTree = treeOf(filteredSeeds);
const filteredText = textOf(filteredTree);
assert.match(filteredText, /1 个技能/, 'role filter narrows the count');
const filteredRows = elementsBy(filteredTree, (el) => el.type === 'button' && el.props && el.props.className === 's360-row');
assert.equal(filteredRows.length, 1, 'role filter leaves one row');
assert.match(textOf(filteredRows[0]), /skill-alpha/);
const pressedChip = elementsBy(filteredTree, (el) => el.type === 'button' && el.props
  && el.props['data-axis'] === 'role' && el.props['data-value'] === 'review')[0];
assert.equal(pressedChip.props['aria-pressed'], 'true', 'active chip has aria-pressed=true');
elementsBy(filteredTree, (el) => el.type === 'button' && el.props
  && el.props['data-axis'] === 'role' && el.props['data-value'] === 'all')[0].props.onClick();
assert.equal(stateStore.get(IDX.skillsRoleFilter), 'all', 'the 全部 chip resets the axis');

resetState();
const layerTree = treeOf(baseSeeds('skills'));
const metaChip = elementsBy(layerTree, (el) => el.type === 'button' && el.props
  && el.props['data-axis'] === 'layer' && el.props['data-value'] === 'meta')[0];
assert.ok(metaChip, 'layer chip for meta exists');
assert.equal(textOf(metaChip), '元技能 1', 'meta chip label + count');
metaChip.props.onClick();
assert.equal(stateStore.get(IDX.skillsLayerFilter), 'meta', 'clicking 元技能 filters to meta skills');
const metaSeeds = baseSeeds('skills');
metaSeeds[IDX.skillsLayerFilter] = NO_SEED;
metaSeeds[IDX.skillsSelected] = '';
metaSeeds[IDX.skillsDetail] = null;
const metaTree = treeOf(metaSeeds);
const metaRows = elementsBy(metaTree, (el) => el.type === 'button' && el.props && el.props.className === 's360-row');
assert.equal(metaRows.length, 1, 'meta filter leaves one row');
assert.match(textOf(metaRows[0]), /skill-alpha/);
assert.match(textOf(metaTree), /元技能/, 'meta badge renders on the row/detail');

const agentsSummaryText = render(baseSeeds('agents'));
assert.match(agentsSummaryText, /3 个对象，2 个待处理；最该先看 router/, 'agents summary sentence');

// Old host without taxonomy/classification: still renders, hides role chips and
// shows the honest classification empty state instead of guessing labels.
const bareSeeds = baseSeeds('skills');
bareSeeds[IDX.skillsPortfolio] = {
  ...skillsPortfolio,
  taxonomy: null,
  skills: skillsPortfolio.skills.map((skill) => ({ ...skill, classification: null })),
};
bareSeeds[IDX.skillsDetail] = { ...bravoDetail, classification: null };
const bareText = render(bareSeeds);
assert.match(bareText, /skill-alpha/, 'list still renders without classification');
assert.match(bareText, /这次扫描还没有分类信息/, 'detail explains the missing classification');
assert.doesNotMatch(bareText, /审查验证/, 'no role label is invented without taxonomy');
console.log('PASS 11/13  taxonomy-driven role chips filter the list; summary/time/trend and state badges render');

// 12. Optimization effect: apply response -> persistent card with score delta,
// tokens saved, per-item toast, and an undo entry.
resetState();
calls.length = 0;
let effectTree = treeOf(baseSeeds('skills'));
buttonsIn(elementsBy(effectTree, (el) => el.type === 'li' && el.props && el.props['data-kind'] === 'auto')[0])[0].props.onClick();
await flush();
assert.ok(calls.some((call) => call.url === '/api/dsh-360/skills/apply'), 'effect test apply call');
const storedEffect = stateStore.get(IDX.skillsEffect);
assert.ok(storedEffect && storedEffect.tokensSaved === 1240, 'apply response effect is kept');

const effectSeeds = sealedEffectSeeds();
const effectText = textOf(treeOf(effectSeeds));
assert.match(effectText, /本次优化：1 项，分数 72\.3 → 78\.9（\+6\.6），省 1,240 tokens/, 'effect card score delta + tokens saved');
assert.match(effectText, /skill-bravo 72\.3 → 78\.9/, 'toast shows per-item before -> after');
assert.match(effectText, /撤销上次/, 'effect card offers undo');
assert.doesNotMatch(effectText, /上次优化/, 'the current effect replaces the last-apply card');

effectTree = treeOf(effectSeeds);
const effectUndo = elementsBy(effectTree, (el) => el.type === 'button'
  && String(el.props.className || '').includes('d360-effectUndo'))[0];
assert.ok(effectUndo, 'effect card undo button exists');
effectUndo.props.onClick();
await flush();
assert.ok(calls.some((call) => call.url === '/api/dsh-360/skills/undo'), 'effect card undo calls /undo');
assert.equal(stateStore.get(IDX.skillsEffect), null, 'undo clears the current effect');

const afterUndoText = textOf(treeOf(sealedEffectSeeds()));
assert.doesNotMatch(afterUndoText, /本次优化/, 'undo removes 本次优化');
// The shim does not re-render from the updated portfolio state, so the seeded
// lastApply still paints here; the host clears it on undo (verify-host 6b) and
// the panel also nulls the in-memory copy before refetching.
assert.match(afterUndoText, /上次优化：2 项，分数 60\.0 → 62\.0（\+2\.0），省 500 tokens/, 'portfolio.lastApply fixture still renders in the shim');
console.log('PASS 12/13  apply effect card shows score delta + tokens saved, per-item toast, undo and 上次优化');

// 13. Filters are collapsed behind an icon; active count + clear-all work.
resetState();
const closedFilterSeeds = baseSeeds('skills');
closedFilterSeeds[IDX.skillsFiltersOpen] = false;
const closedFilterTree = treeOf(closedFilterSeeds);
const filterBtn = elementsBy(closedFilterTree, (el) => el.type === 'button'
  && String(el.props.className || '').includes('d360-filterBtn'))[0];
assert.ok(filterBtn, 'filter icon button exists');
assert.equal(filterBtn.props['aria-expanded'], 'false', 'filters start collapsed');
const closedPanel = elementsBy(closedFilterTree, (el) => String(el.props.className || '').includes('d360-filterPanel'))[0];
assert.equal(closedPanel.props.hidden, true, 'filter panel is hidden until the icon is clicked');
filterBtn.props.onClick();
assert.equal(stateStore.get(IDX.skillsFiltersOpen), true, 'icon opens the filter panel');

const activeFilterSeeds = baseSeeds('skills');
activeFilterSeeds[IDX.skillsFiltersOpen] = false;
activeFilterSeeds[IDX.skillsRoleFilter] = 'review';
const activeFilterTree = treeOf(activeFilterSeeds);
const countBadge = elementsBy(activeFilterTree, (el) => String(el.props.className || '').includes('d360-filterCount'))[0];
assert.ok(countBadge, 'active filter count renders');
assert.equal(textOf(countBadge), '1');
const clearBtn = elementsBy(activeFilterTree, (el) => el.type === 'button'
  && String(el.props.className || '').includes('d360-clearFilters'))[0];
assert.ok(clearBtn, 'clear-all affordance appears when a filter is active');
clearBtn.props.onClick();
assert.equal(stateStore.get(IDX.skillsRoleFilter), 'all', 'clear-all resets the axes');
console.log('PASS 13/13  filters collapsed behind icon, active count and clear-all');

function sealedEffectSeeds() {
  return seededWithStore(baseSeeds('skills'), [
    IDX.skillsEffect,
    IDX.skillsNotice,
    IDX.skillsLastBackupIds,
    IDX.skillsBusy,
  ]);
}

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

console.log('\n✓ dsh-360 client render smoke test passed: 13/13 + registration + style + sidebar icon');
