/**
 * Render smoke test for the skills-360 Client half.
 *
 * Loads client.js through a fake module loader with a minimal React hook shim,
 * applies the plugin to a mock Client context, then renders the panel with
 * hand-picked hook state for each required UI state: loading, full portfolio
 * (A/B/D grades, six dimensions + evolution), detail (auto/draft/manual +
 * fix.add-lesson suggestions), the evolution editor, a not-scored dimension,
 * and a load error.
 * It cannot check pixels, but it proves every render branch completes without a
 * runtime error and shows the expected text.
 */
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ DOM stub

globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
};

// --------------------------------------------------------------- React shim

const NO_SEED = Symbol('no-seed');
let seeds = [];
let hookIndex = 0;

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
  useEffect() {},
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
      assert.equal(definition.id, 'skills-360');
      plugin = definition.factory((name) => {
        assert.equal(name, 'react');
        return ReactShim;
      });
    },
  },
  setTimeout() { return 0; },
  clearTimeout() {},
};

// zh locale so the required button/state strings surface in Chinese.
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

await import(new URL('./client.js', import.meta.url).href);
assert.ok(plugin, 'client module loaded');
plugin.apply(ctx);

const panel = registrations.get('main:skills-360');
assert.ok(panel, 'main panel registered under key skills-360');
const sidebar = registrations.get('sidebar.panellist:skills-360');
assert.ok(sidebar, 'sidebar panellist icon registered');
assert.equal(sidebar.options.order, 40);

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
      const rendered = node.type(node.props || {});
      return collectText(rendered, out);
    }
    collectText(node.props ? node.props.children : null, out);
  }
  return out;
}

function render(seedValues) {
  seeds = seedValues || [];
  hookIndex = 0;
  const tree = panel.component();
  return collectText(tree).join(' ');
}

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

// SPEC §4 evolution shape, shared by the six-dimension mock and the detail view.
function makeEvolution(overrides) {
  const base = {
    applicable: true,
    loads: 0,
    lessons: { count: 0, latestAt: null, linked: false, entries: [] },
    signals: {
      loads: 0,
      sessions: 0,
      reloads: 0,
      postLoadErrors: 0,
      corrections: 0,
      asks: 0,
      turnFailures: 0,
      lastSignalAt: null,
      samples: [],
    },
    pending: { score: 0, hasUnclosed: false, lastSignalAt: null, draft: null },
    promptRecall: { total: 0, matched: 0, recall: null, samples: [] },
    proposals: [],
  };
  const out = { ...base, ...(overrides || {}) };
  out.lessons = { ...base.lessons, ...((overrides && overrides.lessons) || {}) };
  out.signals = { ...base.signals, ...((overrides && overrides.signals) || {}) };
  out.pending = { ...base.pending, ...((overrides && overrides.pending) || {}) };
  return out;
}

function makeSkill({ name, source, description, total, grade, confidence, verdict, dimensions, evolution, findings = [], suggestions = [], overlaps = [] }) {
  return {
    name,
    source,
    provider: 'filesystem',
    path: '/skills/' + name + '/SKILL.md',
    dir: '/skills/' + name,
    description,
    whenToUse: null,
    coverage: 'full',
    mtime: Date.now(),
    metrics: {
      descriptionChars: description.length,
      catalogChars: Math.min(description.length, 500),
      catalogTruncated: description.length > 500,
      bodyLines: 220,
      bodyChars: 5600,
      estTokens: 1500,
      headings: 9,
      h2: 3,
      codeBlocks: 2,
      codeLines: 40,
      maxCodeBlockLines: 22,
      codeRatio: 0.04,
      references: [],
      referenceCount: 1,
      referencedFiles: 1,
      orphanReferences: 1,
      brokenLinks: [],
      numberedSteps: 5,
      commands: 4,
      hasExamples: true,
      hasWhenNotToUse: true,
      hasAntiPatterns: true,
      hasDecisionLanguage: true,
      todos: 0,
      secrets: 0,
      dangerous: 0,
      duplicateHeadings: 0,
      totalRefChars: 8000,
      overlapMax: overlaps.length ? overlaps[0].score : 0.1,
      overlapName: overlaps.length ? overlaps[0].name : null,
    },
    usage: { count: 6, lastUsedAt: Date.now() - DAY, windowDays: 30, exposureDays: 100, sufficient: true, perWeek: 1.4 },
    score: { total, grade, confidence, delta: null, dimensions },
    verdict: { code: verdict, label: { keep: '保留', watch: '观察', merge: '合并', archive: '归档' }[verdict], reason: '示例结论：分数 ' + total + '。' },
    evolution,
    findings,
    suggestions,
    overlaps,
  };
}

const alphaEvolution = makeEvolution({
  loads: 8,
  lessons: {
    count: 3,
    latestAt: NOW - 3 * DAY,
    linked: true,
    entries: [
      { at: NOW - 3 * DAY, trigger: '用户说“跑一下体检”', rule: '先跑 scan 再解释分数', evidence: 'session alpha-1', line: 1 },
    ],
  },
  signals: {
    loads: 8,
    sessions: 4,
    lastSignalAt: NOW - 3 * DAY,
    corrections: 1,
    samples: [
      { kind: 'correction', at: NOW - 3 * DAY, sessionId: 'session-alpha-1', excerpt: '不对，先给结论再说细节' },
    ],
  },
  pending: { score: 0, hasUnclosed: false, lastSignalAt: NOW - 3 * DAY, draft: null },
  promptRecall: { total: 4, matched: 3, recall: 0.75, samples: [] },
});

const bravoDraft = {
  trigger: '用户说“不对，应该先跑测试再改实现”',
  rule: '',
  evidence: 'session session-bravo-1',
};

const bravoEvolution = makeEvolution({
  loads: 3,
  lessons: {
    count: 1,
    latestAt: NOW - 120 * DAY,
    linked: false,
    entries: [
      { at: NOW - 120 * DAY, trigger: '用户说“先看现状”', rule: '先读文件再改', evidence: 'session bravo-old', line: 2 },
    ],
  },
  signals: {
    loads: 3,
    sessions: 2,
    reloads: 1,
    postLoadErrors: 1,
    corrections: 2,
    turnFailures: 1,
    lastSignalAt: NOW - DAY,
    samples: [
      { kind: 'correction', at: NOW - DAY, sessionId: 'session-bravo-1', excerpt: '不对，应该先跑测试再改实现' },
      { kind: 'error', at: NOW - 2 * DAY, sessionId: 'session-bravo-2', excerpt: 'node: command failed' },
      { kind: 'reload', at: NOW - 2 * DAY, sessionId: 'session-bravo-2', excerpt: '同一会话第二次加载' },
    ],
  },
  pending: { score: 12, hasUnclosed: true, lastSignalAt: NOW - DAY, draft: bravoDraft },
  promptRecall: { total: 3, matched: 1, recall: 0.33, samples: ['帮我把 bravo 弄干净'] },
  proposals: [
    {
      id: 'evolution.add-lesson',
      title: '沉淀一条“触发→做法”经验',
      why: '窗口内出现 5 个加载后信号（纠错/报错/重复加载），还没有对应经验。',
      evidence: 'session session-bravo-1',
      draft: bravoDraft,
    },
  ],
});

const deltaEvolution = makeEvolution({
  applicable: false,
  lessons: { count: 0, latestAt: null, linked: false, entries: [] },
  pending: { score: 0, hasUnclosed: false, lastSignalAt: null, draft: null },
});

const alpha = makeSkill({
  name: 'skill-alpha',
  source: 'user-agents',
  description: 'A well-tuned skill for alpha tasks.',
  total: 92,
  grade: 'A',
  confidence: 0.9,
  verdict: 'keep',
  evolution: alphaEvolution,
  dimensions: [
    dim('load', '按需加载', 18, 20, '触发词密集，按需加载频繁。'),
    dim('disclosure', '渐进披露', 23, 25, '正文精简，references 有入口索引。'),
    dim('actionability', '可执行性', 18, 20, '步骤清晰。'),
    dim('boundary', '边界与治理', 14, 15, '边界明确。'),
    dim('hygiene', '维护卫生', 9, 10, '卫生良好。'),
    dim('evolution', '持续进化', 10, 10, '经验已沉淀并接进入口。'),
  ],
});

const bravo = makeSkill({
  name: 'skill-bravo',
  source: 'custom',
  description: 'A mid-tier skill that needs some cleanup and overlaps with another skill.',
  total: 72,
  grade: 'B',
  confidence: 0.7,
  verdict: 'watch',
  evolution: bravoEvolution,
  dimensions: [
    dim('load', '按需加载', 16, 20, '有加载，但触发词偏少。'),
    dim('disclosure', '渐进披露', 18, 25, '正文偏大，渐进披露不足。'),
    dim('actionability', '可执行性', 15, 20, '步骤尚可。'),
    dim('boundary', '边界与治理', 12, 15, '缺少何时不用。'),
    dim('hygiene', '维护卫生', 7, 10, '存在孤儿引用。'),
    dim('evolution', '持续进化', 4, 10, '经验过时，且有 5 个未沉淀信号。'),
  ],
  findings: [
    {
      id: 'disclosure.body-too-large',
      dimension: 'disclosure',
      severity: 'major',
      title: 'SKILL.md 过大，渐进披露不足',
      detail: '正文约 5600 字符，超过单次加载预算。',
      evidence: { file: 'SKILL.md', line: 1, excerpt: '---\nname: skill-bravo\n---' },
      suggestion: '把参考型章节拆到 references/。',
      actionIds: ['fix.extract-sections'],
    },
    {
      id: 'evolution.pending',
      dimension: 'evolution',
      severity: 'major',
      title: '5 个调用后信号尚未沉淀',
      detail: '纠错 2、报错 1、重复加载 1、失败 1，最近一条在昨天。',
      evidence: { file: 'references/lessons.md', line: 1, excerpt: '（未沉淀）' },
      suggestion: '用面板沉淀一条“触发→做法”，或直接让 skills360_evolve 写入。',
      actionIds: ['fix.add-lesson'],
    },
  ],
  suggestions: [
    {
      id: 'fix.extract-sections',
      kind: 'auto',
      title: '把 3 个参考型章节拆到 references/',
      why: '正文预计减少约 2000 tokens，可撤销。',
      risk: '低：原内容逐字搬移，不删改。',
      action: { type: 'extract-sections', params: { sections: ['reference'] } },
      preview: { before: '## 参考\n...', after: '见 references/reference.md' },
    },
    {
      id: 'fix.rewrite-description',
      kind: 'draft',
      title: '重写描述，补触发句式',
      why: '当前描述缺少触发句式。',
      risk: '会改写内容，需人工确认。',
      action: { type: 'rewrite-description', params: {} },
      preview: { before: 'A mid-tier skill...', after: 'A mid-tier skill. Use when: ...' },
    },
    {
      id: 'fix.add-lesson',
      kind: 'draft',
      title: '沉淀一条“触发→做法”经验',
      why: '窗口内出现 5 个加载后信号（纠错/报错/重复加载），还没有对应经验。',
      risk: '中：会向 references/lessons.md 追加一条经验并接进入口；可撤销。',
      action: { type: 'add-lesson', params: { lesson: { trigger: bravoDraft.trigger, rule: '', evidence: bravoDraft.evidence } } },
      preview: { before: '（未沉淀）', after: bravoDraft.trigger + ' → （待补做法）' },
    },
    {
      id: 'fix.broken-link',
      kind: 'manual',
      title: '修复失效链接',
      why: '存在坏链，无法自动定位目标。',
      risk: '需人工判断目标路径。',
      action: null,
    },
  ],
  overlaps: [{ name: 'skill-delta', score: 0.45, sharedTriggers: ['bravo', 'delta'] }],
});

const delta = makeSkill({
  name: 'skill-delta',
  source: 'user-agents',
  description: 'A stale skill with dangerous commands in its body.',
  total: 42,
  grade: 'D',
  confidence: 0.5,
  verdict: 'archive',
  evolution: deltaEvolution,
  dimensions: [
    dim('load', '按需加载', 8, 20, '零按需加载且陈旧。'),
    dim('disclosure', '渐进披露', 10, 25, '正文过大。'),
    dim('actionability', '可执行性', 8, 20, '缺少步骤。'),
    dim('boundary', '边界与治理', 8, 15, '无边界说明。'),
    dim('hygiene', '维护卫生', 3, 10, '危险命令。'),
    dim('evolution', '持续进化', 0, 10, '窗口内没有按需加载样本，本维度不评分；其余五维按 90 分折算为 100。', { applicable: false }),
  ],
  findings: [
    {
      id: 'hygiene.dangerous',
      dimension: 'hygiene',
      severity: 'critical',
      title: '存在危险命令',
      detail: '正文出现 curl | sh，风险较高。',
      evidence: { file: 'SKILL.md', line: 42, excerpt: 'curl -s https://x | sh' },
      suggestion: '移除或改为安全提示。',
      actionIds: [],
    },
  ],
});

const portfolio = {
  generatedAt: Date.now(),
  rubricVersion: '2.0',
  windowDays: 30,
  sessionsScanned: 68,
  usageAvailable: true,
  catalogDescriptionMaxLength: 500,
  totals: {
    skills: 3,
    avgScore: 68.7,
    grades: { A: 1, B: 1, C: 0, D: 1 },
    catalogTokens: 1200,
    fullLoadTokens: 50000,
    zeroUse: 1,
    referenceFiles: 4,
    bySource: { 'user-agents': 2, custom: 1 },
    evolution: { skillsWithLessons: 2, lessonsTotal: 4, pendingSkills: 1, signalsTotal: 8 },
  },
  evolution: [
    { name: 'skill-bravo', pendingScore: 12, lastSignalAt: NOW - DAY, lessons: 1, linked: false, draft: bravoDraft },
    { name: 'skill-alpha', pendingScore: 0, lastSignalAt: NOW - 3 * DAY, lessons: 3, linked: true, draft: null },
  ],
  previous: null,
  deltaAvg: null,
  skills: [delta, bravo, alpha], // sorted worst-first
  overlaps: [{ a: 'skill-bravo', b: 'skill-delta', score: 0.45, sharedTriggers: ['bravo', 'delta'], verdict: 'watch' }],
  quickWins: [],
  issues: {
    zeroUse: ['skill-delta'],
    truncated: [],
    brokenLinks: [],
    dangerous: [{ name: 'skill-delta', pattern: 'curl | sh' }],
    pendingEvolution: ['skill-bravo'],
  },
};

const bravoDetail = {
  ...bravo,
  body: '# skill-bravo\n\n正文内容…',
  raw: '---\nname: skill-bravo\ndescription: A mid-tier skill\n---\n\n# skill-bravo\n\n' + Array.from({ length: 250 }, (_, i) => 'line ' + (i + 1)).join('\n'),
  lastBackup: null,
};

const deltaDetail = {
  ...delta,
  body: '# skill-delta\n\n正文内容…',
  raw: '---\nname: skill-delta\ndescription: A stale skill\n---\n\n# skill-delta\n',
  lastBackup: null,
};

// Seed order: loading, portfolio, loadError, refreshKey, selected, detail,
// detailLoading, detailError, detailVersion, query, gradeFilter, verdictFilter,
// sourceFilter, onlyProblems, notice, busy, lastBackupIds, evolveEditor.
function fullSeeds() {
  return [
    false,          // loading
    portfolio,      // portfolio
    '',             // loadError
    0,              // refreshKey
    'skill-bravo',  // selected
    bravoDetail,    // detail
    false,          // detailLoading
    '',             // detailError
    0,              // detailVersion
    '',             // query
    'all',          // gradeFilter
    'all',          // verdictFilter
    'all',          // sourceFilter
    false,          // onlyProblems
    null,           // notice
    false,          // busy
    null,           // lastBackupIds
    null,           // evolveEditor (closed)
  ];
}

// ---------------------------------------------------------------- assertions

// 1. Loading state (no data), six-dimension subtitle.
let text = render();
assert.match(text, /正在加载/);
assert.match(text, /按需加载 \/ 渐进披露 \/ 可执行性 \/ 边界 \/ 卫生 \/ 持续进化 六维评分/);
console.log('PASS 1/8  loading state renders subtitle + "正在加载" without throwing');

// 2. Full portfolio (A/B/D grades), list rows + "待进化" badge from evolution.pending.
text = render(fullSeeds());
assert.match(text, /skill-alpha/);
assert.match(text, /skill-bravo/);
assert.match(text, /skill-delta/);
assert.match(text, /92\.0/); // alpha score badge
assert.match(text, /72\.0/); // bravo score badge
assert.match(text, /42\.0/); // delta score badge
assert.match(text, /保留/); // keep verdict
assert.match(text, /观察/); // watch verdict
assert.match(text, /归档/); // archive verdict
assert.match(text, /待进化/); // bravo row badge (pending.hasUnclosed)
assert.match(text, /加载 6 次/); // "loads" framing, not "uses"
console.log('PASS 2/8  portfolio renders A/B/D, verdicts, "待进化" badge, load counts');

// 3. Detail: six dimensions, evolution block, auto/draft/manual + lesson action.
text = render(fullSeeds());
assert.match(text, /六维评分/);
assert.doesNotMatch(text, /五维评分/);
assert.match(text, /按需加载/);
assert.match(text, /持续进化/);
assert.match(text, /经验数/);
assert.match(text, /未接进入口/);
assert.match(text, /调用后信号/);
assert.match(text, /纠错/);
assert.match(text, /报错/);
assert.match(text, /重复加载/);
assert.match(text, /待闭环提案/);
assert.match(text, /待补做法/);
assert.match(text, /沉淀经验/); // fix.add-lesson button + pending proposal button
assert.match(text, /一键优化/);
assert.match(text, /生成草稿/);
assert.match(text, /手动处理/);
assert.match(text, /关键指标/);
assert.match(text, /重叠技能/);
assert.match(text, /查看源码/);
console.log('PASS 3/8  detail renders six dimensions, evolution block, lesson action, suggestion kinds');

// 4. Evolution editor open: prefilled trigger/evidence + required rule textarea.
const editorSeeds = fullSeeds();
editorSeeds[17] = {
  trigger: bravoDraft.trigger,
  rule: '',
  evidence: bravoDraft.evidence,
};
text = render(editorSeeds);
assert.match(text, /沉淀经验/);
assert.match(text, /触发/);
assert.match(text, /做法/);
assert.match(text, /证据/);
assert.match(text, /必填/);
assert.match(text, /写入经验/);
assert.match(text, /取消/);
console.log('PASS 4/8  evolution editor renders prefilled fields + "写入经验"');

// 5. Not-scored dimension (applicable:false) keeps the section but says so.
const naSeeds = fullSeeds();
naSeeds[4] = 'skill-delta';
naSeeds[5] = deltaDetail;
text = render(naSeeds);
assert.match(text, /本维度不评分/);
assert.match(text, /持续进化/);
assert.match(text, /窗口内没有按需加载样本/);
assert.match(text, /尚未沉淀/);
assert.match(text, /没有待闭环的信号/);
console.log('PASS 5/8  applicable:false dimension shows "本维度不评分" and empty evolution state');

// 6. Load error with retry.
text = render([false, null, 'network down']);
assert.match(text, /加载失败/);
assert.match(text, /network down/);
assert.match(text, /重试/);
console.log('PASS 6/8  error state renders "重试" retry');

// 7. Success toast (post-action state) shows backupId + before→after score.
const toastSeeds = fullSeeds();
toastSeeds[14] = { kind: 'success', text: '已应用，备份 bk-1，分数 72.0 → 78.0' };
toastSeeds[16] = 'bk-1'; // lastBackupId enables the undo button
text = render(toastSeeds);
assert.match(text, /bk-1/);
assert.match(text, /72\.0 → 78\.0/);
assert.match(text, /撤销上次/);
console.log('PASS 7/8  post-action toast renders backupId, before→after, undo button');

// 8. English locale: the same states surface the synced en keys (no zh leaked
//    into the evolution block, dimension N/A label, or editor).
localeSnapshot.active = 'en';
localeSnapshot.revision += 1;
text = render(fullSeeds());
assert.match(text, /Score skills across on-demand loading, progressive disclosure, actionability, boundary, hygiene, and continuous evolution/);
assert.match(text, /Six dimensions/);
assert.match(text, /Continuous evolution/);
assert.match(text, /Add lesson/);
assert.match(text, /Needs lesson/);
assert.match(text, /Open proposals/);
assert.match(text, /Post-load signals/);
assert.doesNotMatch(text, /待进化/);
assert.doesNotMatch(text, /沉淀经验/);
assert.doesNotMatch(text, /六维评分/);
assert.doesNotMatch(text, /写入经验/);

const editorEnSeeds = fullSeeds();
editorEnSeeds[17] = { trigger: bravoDraft.trigger, rule: '', evidence: bravoDraft.evidence };
text = render(editorEnSeeds);
assert.match(text, /Write lesson/);
assert.match(text, /Rule/);
assert.match(text, /Required/);

const naEnSeeds = fullSeeds();
naEnSeeds[4] = 'skill-delta';
naEnSeeds[5] = deltaDetail;
text = render(naEnSeeds);
assert.match(text, /Not scored this window/);
assert.match(text, /No on-demand loads this window/);
localeSnapshot.active = 'zh';
localeSnapshot.revision += 1;
console.log('PASS 8/8  English locale renders the synced six-dimension + evolution copy');

// Sidebar icon renders as an SVG at the requested size.
for (const props of [{ size: 20, active: false }, { size: 20, active: true }]) {
  hookIndex = 0;
  seeds = [];
  const svg = sidebar.component(props);
  assert.equal(svg.type, 'svg');
  assert.equal(svg.props.width, 20);
  assert.equal(svg.props.height, 20);
}
console.log('PASS sidebar icon renders as SVG (20x20)');

console.log('client render smoke test passed: 8/8 render states + registration + sidebar icon');
