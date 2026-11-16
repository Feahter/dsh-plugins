// test/consistency.test.mjs — 确定性一致性检查的 8 条规则（正例 + 不误报）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import { checkChapter, audit } from '../src/recipes/novel/consistency.js'

function baseCanon(overrides = {}) {
  return {
    version: 2,
    rules: [],
    notes: [],
    threads: [],
    timeline: [],
    invariants: [],
    facts: [],
    entities: { 林砚: { kind: 'character', aliases: ['砚哥'] } },
    ...overrides,
  }
}

function ofKind(findings, kind) {
  return findings.filter((finding) => finding.kind === kind)
}

function chaptersTo(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `ch${String(index + 1).padStart(4, '0')}`,
  }))
}

// 1. dead-character ---------------------------------------------------------

test('dead-character：死亡人物在 cast 且正文出现 3 次 → 有且仅有一条 block', () => {
  const canon = baseCanon({
    entities: { 陈婆: { kind: 'character', aliases: ['陈阿婆'] } },
    facts: [{ s: '陈婆', p: '状态', o: '死亡', chapter: 'ch0010', status: 'canon' }],
  })
  const findings = checkChapter({
    text: '陈婆推门进来。陈婆坐下。陈婆笑了。',
    canon,
    chapter: { id: 'ch0020', cast: ['陈婆'] },
  })
  const hits = ofKind(findings, 'dead-character')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'block')
  assert.equal(hits[0].where, 'ch0020')
  assert.match(hits[0].issue, /陈婆/)
  assert.ok(hits[0].fix.length > 0)
})

test('dead-character：正文只出现 1 次且不在 cast → 不报', () => {
  const canon = baseCanon({
    entities: { 陈婆: { kind: 'character' } },
    facts: [{ s: '陈婆', p: '状态', o: '死亡', chapter: 'ch0010', status: 'canon' }],
  })
  const findings = checkChapter({
    text: '陈婆来过一次。',
    canon,
    chapter: { id: 'ch0020', cast: [] },
  })
  assert.deepEqual(ofKind(findings, 'dead-character'), [])
})

test('dead-character：canon 有更晚的「活着」事实 → 复活，不报', () => {
  const canon = baseCanon({
    entities: { 陈婆: { kind: 'character' } },
    facts: [
      { s: '陈婆', p: '状态', o: '死亡', chapter: 'ch0010', status: 'canon' },
      { s: '陈婆', p: '状态', o: '活着', chapter: 'ch0015', status: 'canon' },
    ],
  })
  const findings = checkChapter({
    text: '陈婆推门进来。陈婆坐下。陈婆笑了。',
    canon,
    chapter: { id: 'ch0020', cast: ['陈婆'] },
  })
  assert.deepEqual(ofKind(findings, 'dead-character'), [])
})

test('dead-character：死亡人物的别名出现在正文/cast 也能抓住', () => {
  const canon = baseCanon({
    entities: { 陈婆: { kind: 'character', aliases: ['陈阿婆'] } },
    facts: [{ s: '陈婆', p: '状态', o: '死亡', chapter: 'ch0010', status: 'canon' }],
  })
  const findings = checkChapter({
    text: '陈阿婆推门进来。陈阿婆坐下。',
    canon,
    chapter: { id: 'ch0020', cast: ['陈阿婆'] },
  })
  const hits = ofKind(findings, 'dead-character')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /陈婆/)
})

test('dead-character：「死里逃生」不是死亡，下章出场不报', () => {
  const canon = baseCanon({
    entities: { 沈砚: { kind: 'character' } },
    facts: [{ s: '沈砚', p: '状态', o: '死里逃生', chapter: 'ch003', status: 'canon' }],
  })
  const findings = checkChapter({
    text: '沈砚推开停尸间的门。沈砚在名册上找到第三行。',
    canon,
    chapter: { id: 'ch004', cast: ['沈砚'] },
  })
  assert.deepEqual(ofKind(findings, 'dead-character'), [])
})

test('dead-character：「已死」仍判死，下章出场照报 block', () => {
  const canon = baseCanon({
    entities: { 沈砚: { kind: 'character' } },
    facts: [{ s: '沈砚', p: '状态', o: '已死', chapter: 'ch003', status: 'canon' }],
  })
  const findings = checkChapter({
    text: '沈砚推开停尸间的门。沈砚在名册上找到第三行。',
    canon,
    chapter: { id: 'ch004', cast: ['沈砚'] },
  })
  const hits = ofKind(findings, 'dead-character')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'block')
})

// 2. timeline-regress -------------------------------------------------------

test('timeline-regress：本章「第 3 天」早于上一章「第 5 天」→ warn', () => {
  const findings = checkChapter({
    text: '他醒来。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', when: '第 3 天' },
    previousChapter: { id: 'ch0002', when: '第 5 天' },
  })
  const hits = ofKind(findings, 'timeline-regress')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.match(hits[0].issue, /第 3 天/)
})

test('timeline-regress：顺序正确（第 6 天晚于第 5 天）→ 不报', () => {
  const findings = checkChapter({
    text: '他醒来。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', when: '第 6 天' },
    previousChapter: { id: 'ch0002', when: '第 5 天' },
  })
  assert.deepEqual(ofKind(findings, 'timeline-regress'), [])
})

test('timeline-regress：无法解析的 when（头七当晚）→ 跳过，不报', () => {
  const findings = checkChapter({
    text: '他醒来。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', when: '头七当晚' },
    previousChapter: { id: 'ch0002', when: '第 5 天' },
  })
  assert.deepEqual(ofKind(findings, 'timeline-regress'), [])
})

// 3. cast-missing -----------------------------------------------------------

test('cast-missing：细纲 cast 有「林砚」正文没有 → warn', () => {
  const findings = checkChapter({
    text: '屋里空无一人。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', cast: ['林砚'] },
  })
  const hits = ofKind(findings, 'cast-missing')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.match(hits[0].issue, /林砚/)
})

test('cast-missing：cast 里的人物正文出现过 → 不报', () => {
  const findings = checkChapter({
    text: '林砚推门进来。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', cast: ['林砚'] },
  })
  assert.deepEqual(ofKind(findings, 'cast-missing'), [])
})

// 4. thread-stale（仅 audit）------------------------------------------------

test('thread-stale：opened 距今 39 章 → 不报', () => {
  const canon = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', status: 'open' }],
  })
  const findings = audit({ chapters: chaptersTo(40), canon })
  assert.deepEqual(ofKind(findings, 'thread-stale'), [])
})

test('thread-stale：opened 距今 40 章 → audit 报一条 note', () => {
  const canon = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', status: 'open' }],
  })
  const findings = audit({ chapters: chaptersTo(41), canon })
  const hits = ofKind(findings, 'thread-stale')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.equal(hits[0].where, 'ch0001')
  assert.match(hits[0].issue, /40 章未回收/)
})

test('thread-stale：checkChapter 不报；已回收线索 audit 也不报', () => {
  const open = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', status: 'open' }],
  })
  const chapterFindings = checkChapter({
    text: '他走了。',
    canon: open,
    chapter: { id: 'ch0080' },
  })
  assert.deepEqual(ofKind(chapterFindings, 'thread-stale'), [])

  const closed = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', status: 'closed', closedIn: 'ch0030' }],
  })
  assert.deepEqual(ofKind(audit({ chapters: chaptersTo(80), canon: closed }), 'thread-stale'), [])
})

// 5. name-drift -------------------------------------------------------------

test('name-drift：未登记人名出现 3 次 → note', () => {
  const findings = checkChapter({
    text: '周野推门。周野坐下。周野没有说话。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', cast: [] },
  })
  const hits = ofKind(findings, 'name-drift')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.match(hits[0].issue, /周野/)
  assert.match(hits[0].issue, /3 次/)
})

test('name-drift：白名单虚词高频出现 → 不报', () => {
  const findings = checkChapter({
    text: '声音。声音。声音。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', cast: [] },
  })
  assert.deepEqual(ofKind(findings, 'name-drift'), [])
})

test('name-drift：白名单词的超串（什么时候）→ 不报', () => {
  const findings = checkChapter({
    text: '什么时候。什么时候。什么时候。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', cast: [] },
  })
  assert.deepEqual(ofKind(findings, 'name-drift'), [])
})

test('name-drift：canon 别名命中 → 不报', () => {
  const findings = checkChapter({
    text: '砚哥推门。砚哥坐下。砚哥走了。',
    canon: baseCanon(),
    chapter: { id: 'ch0003', cast: [] },
  })
  assert.deepEqual(ofKind(findings, 'name-drift'), [])
})

// 6. invariant-hit ----------------------------------------------------------

test('invariant-hit：正文命中 invariants 词句 → warn', () => {
  const canon = baseCanon({ invariants: ['死者不会在头七之外回来'] })
  const findings = checkChapter({
    text: '老人说，死者不会在头七之外回来。',
    canon,
    chapter: { id: 'ch0003' },
  })
  const hits = ofKind(findings, 'invariant-hit')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.match(hits[0].issue, /死者不会在头七之外回来/)
})

test('invariant-hit：正文没命中 → 不报', () => {
  const canon = baseCanon({ invariants: ['死者不会在头七之外回来'] })
  const findings = checkChapter({
    text: '老人说，头七那晚下雨。',
    canon,
    chapter: { id: 'ch0003' },
  })
  assert.deepEqual(ofKind(findings, 'invariant-hit'), [])
})

// 7. canon-conflict（仅 audit）---------------------------------------------

test('canon-conflict：同 s|p 两条 canon 值不同 → 只在 audit 报 warn', () => {
  const canon = baseCanon({
    facts: [
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0010', status: 'canon' },
      { s: '林砚', p: '状态', o: '双手完好', chapter: 'ch0020', status: 'canon' },
    ],
  })
  const findings = audit({ chapters: chaptersTo(2), canon })
  const hits = ofKind(findings, 'canon-conflict')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.equal(hits[0].where, 'ch0020')
  assert.match(hits[0].issue, /左手受伤/)
  assert.match(hits[0].issue, /双手完好/)

  const chapterFindings = checkChapter({
    text: '林砚站着。',
    canon,
    chapter: { id: 'ch0020' },
  })
  assert.deepEqual(ofKind(chapterFindings, 'canon-conflict'), [])
})

test('canon-conflict：一条 canon 一条 retracted → 不算冲突', () => {
  const canon = baseCanon({
    facts: [
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0010', status: 'canon' },
      { s: '林砚', p: '状态', o: '双手完好', chapter: 'ch0020', status: 'retracted' },
    ],
  })
  assert.deepEqual(ofKind(audit({ chapters: chaptersTo(2), canon }), 'canon-conflict'), [])
})

// 8. fact-contradict --------------------------------------------------------

test('fact-contradict：正文同时出现 s 与 retracted 的 o（≥4 字）→ note', () => {
  const canon = baseCanon({
    facts: [
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0010', status: 'retracted' },
    ],
  })
  const findings = checkChapter({
    text: '林砚抬起手，左手受伤的地方还在疼。',
    canon,
    chapter: { id: 'ch0020' },
  })
  const hits = ofKind(findings, 'fact-contradict')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.match(hits[0].issue, /左手受伤/)
})

test('fact-contradict：正文没出现旧事实 o → 不报', () => {
  const canon = baseCanon({
    facts: [
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0010', status: 'retracted' },
    ],
  })
  const findings = checkChapter({
    text: '林砚抬起手，伤口已经好了。',
    canon,
    chapter: { id: 'ch0020' },
  })
  assert.deepEqual(ofKind(findings, 'fact-contradict'), [])
})

// 排序 / 容错 / 性能 -------------------------------------------------------

test('排序：block → warn → note，同级按 kind 字典序，再按 where', () => {
  const canon = baseCanon({
    entities: { 陈婆: { kind: 'character' }, 林砚: { kind: 'character', aliases: ['砚哥'] } },
    facts: [
      { s: '陈婆', p: '状态', o: '死亡', chapter: 'ch0010', status: 'canon' },
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0030', status: 'retracted' },
    ],
    invariants: ['死者不会在头七之外回来'],
  })
  const findings = checkChapter({
    text: '陈婆走进屋。陈婆问：“你来了。”陈婆又笑。死者不会在头七之外回来。周野说。周野笑。周野走。林砚抬起手，左手受伤。',
    canon,
    chapter: { id: 'ch0040', cast: ['陈婆', '林砚'], when: '第 2 天' },
    previousChapter: { id: 'ch0039', when: '第 5 天' },
  })
  assert.deepEqual(
    findings.map((finding) => finding.kind),
    ['dead-character', 'invariant-hit', 'timeline-regress', 'fact-contradict', 'name-drift'],
  )
  const ranks = findings.map((finding) => ({ block: 0, warn: 1, note: 2 })[finding.severity])
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
})

test('容错：canon 缺字段 / 传 null 不抛错', () => {
  assert.deepEqual(checkChapter({ text: '他走了。', canon: null, chapter: { id: 'ch0001' } }), [])
  assert.deepEqual(audit({}), [])
  assert.deepEqual(audit({ chapters: [{ id: 'ch0001', text: '他走了。' }], canon: {} }), [])
})

test('性能：audit 在 300 章 + 5000 facts 上 < 100ms', () => {
  const facts = Array.from({ length: 5000 }, (_, index) => ({
    id: `f${index}`,
    s: `角色${index}`,
    p: '状态',
    o: `状态${index}`,
    chapter: `ch${String((index % 300) + 1).padStart(4, '0')}`,
    status: 'canon',
  }))
  const threads = Array.from({ length: 200 }, (_, index) => ({
    id: `t${index}`,
    text: `线索${index}`,
    opened: 'ch0001',
    status: 'open',
  }))
  const canon = { facts, threads, entities: {}, invariants: [], notes: [] }
  const chapters = chaptersTo(300)

  // 取三次的最快值：并发负载下单次计时会被 GC 与调度抖动带偏（实测偶发 113/171ms），
  // 而"实现变慢"会同时抬高每一次，所以最小值仍守得住 100ms 这条线。
  let elapsed = Infinity
  let findings = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const start = performance.now()
    findings = audit({ chapters, canon })
    elapsed = Math.min(elapsed, performance.now() - start)
  }

  assert.ok(elapsed < 100, `audit 用时 ${elapsed.toFixed(1)}ms（三次最快），超过 100ms`)
  assert.ok(findings.length >= 200)
  assert.ok(elapsed >= 0)
})

// 9. 结构层（P0-1 dueIn / P1-1 turn / P1-2 midpoint / P1-9 hook）-------------

test('thread-stale：dueIn=3 而 distance=5 → warn，写清计划章与当前章', () => {
  const canon = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', dueIn: 3, status: 'open' }],
  })
  const findings = audit({ chapters: chaptersTo(6), canon })
  const hits = ofKind(findings, 'thread-stale')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.match(hits[0].issue, /计划第 3 章回收/)
  assert.match(hits[0].issue, /已到第 6 章/)

  // 边界：排期章 == 当前章 不算过期（dueIn 是绝对章号）
  const onTime = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', dueIn: 6, status: 'open' }],
  })
  assert.deepEqual(ofKind(audit({ chapters: chaptersTo(6), canon: onTime }), 'thread-stale'), [])

  // 有 dueIn 时不再落到 40 章 note：50 章只报一条 warn
  const far = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', dueIn: 3, status: 'open' }],
  })
  const farHits = ofKind(audit({ chapters: chaptersTo(50), canon: far }), 'thread-stale')
  assert.equal(farHits.length, 1)
  assert.equal(farHits[0].severity, 'warn')
})

test('thread-stale：dueIn 缺省时 5 章不报（40 章兜底不变）', () => {
  const canon = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0001', status: 'open' }],
  })
  assert.deepEqual(ofKind(audit({ chapters: chaptersTo(6), canon }), 'thread-stale'), [])
  assert.deepEqual(ofKind(audit({ chapters: chaptersTo(40), canon }), 'thread-stale'), [])
})

test('thread-stale：dueIn 是绝对章号，晚开篇也按排期报（不能只看开了几章）', () => {
  // 第 40 章才开的线索、排期第 45 章回收，走到第 50 章时 distance 只有 10，但排期已过
  const canon = baseCanon({
    threads: [{ id: 't01', text: '守夜人袖口的香灰', opened: 'ch0040', dueIn: 45, status: 'open' }],
  })
  const hits = ofKind(audit({ chapters: chaptersTo(50), canon }), 'thread-stale')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.match(hits[0].issue, /计划第 45 章回收/)
  assert.match(hits[0].issue, /已到第 50 章/)
})

test('turn-flat：turn 读不出「从 X 到 Y」→ note，不 block', () => {
  const findings = audit({ chapters: [{ id: 'ch0003', turn: '他沉默地走了' }] })
  const hits = ofKind(findings, 'turn-flat')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.equal(hits[0].where, 'ch0003')
  assert.match(hits[0].issue, /从 X 到 Y/)
  assert.ok(hits[0].fix.length > 0)

  // 有变化词但太短，同样读不出完整弧线
  assert.equal(ofKind(audit({ chapters: [{ id: 'ch0004', turn: '他变了' }] }), 'turn-flat').length, 1)
})

test('turn-flat：能复述成「从 X 到 Y」的 turn → 不报', () => {
  const findings = audit({
    chapters: [
      { id: 'ch0003', turn: '他从抗拒变成接受' },
      { id: 'ch0004', turn: '他再也回不去故乡了' },
      { id: 'ch0005', turn: '他失去最后一位亲人' },
    ],
  })
  assert.deepEqual(ofKind(findings, 'turn-flat'), [])
})

test('midpoint-drift：midpointChapter=0.3（全书 30%）→ note', () => {
  const outline = {
    version: 2,
    totalChapters: 10,
    midpointChapter: 0.3,
    chapters: chaptersTo(10),
    volumes: [],
  }
  const hits = ofKind(audit({ outline }), 'midpoint-drift')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.match(hits[0].issue, /第 3 章/)
  assert.match(hits[0].issue, /30%/)
})

test('midpoint-drift：midpointChapter=0.5 → 静默；缺字段 → 静默', () => {
  const outline = {
    version: 2,
    totalChapters: 10,
    midpointChapter: 0.5,
    chapters: chaptersTo(10),
    volumes: [],
  }
  assert.deepEqual(ofKind(audit({ outline }), 'midpoint-drift'), [])

  const missing = { version: 2, totalChapters: 10, chapters: chaptersTo(10), volumes: [] }
  assert.deepEqual(ofKind(audit({ outline: missing }), 'midpoint-drift'), [])
})

test('midpoint-drift：章号写法 5/10 静默，3/10 报 note', () => {
  const ok = { version: 2, totalChapters: 10, midpointChapter: 5, chapters: chaptersTo(10) }
  assert.deepEqual(ofKind(audit({ outline: ok }), 'midpoint-drift'), [])

  const early = { version: 2, totalChapters: 10, midpointChapter: 3, chapters: chaptersTo(10) }
  const hits = ofKind(audit({ outline: early }), 'midpoint-drift')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /第 3 章/)
})

test('hook-streak：连续三章 hookStrength=2 → warn', () => {
  const chapters = [
    { id: 'ch0001', hookStrength: 3 },
    { id: 'ch0002', hookStrength: 2 },
    { id: 'ch0003', hookStrength: 2 },
    { id: 'ch0004', hookStrength: 2 },
    { id: 'ch0005', hookStrength: 4 },
  ]
  const hits = ofKind(audit({ chapters }), 'hook-streak')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.match(hits[0].issue, /连续 3 章/)
  assert.match(hits[0].issue, /ch0002/)
  assert.match(hits[0].issue, /ch0004/)
})

test('hook-streak：只有两章 ≤2 → 不报', () => {
  const chapters = [
    { id: 'ch0001', hookStrength: 3 },
    { id: 'ch0002', hookStrength: 2 },
    { id: 'ch0003', hookStrength: 2 },
    { id: 'ch0004', hookStrength: 4 },
  ]
  assert.deepEqual(ofKind(audit({ chapters }), 'hook-streak'), [])
})

test('hook-share：5 分章占比 >20% → note；恰好 20% 不报', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    id: `ch${String(i + 1).padStart(4, '0')}`,
    hookStrength: i < 3 ? 5 : 3,
  }))
  const hits = ofKind(audit({ chapters: many }), 'hook-share')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.match(hits[0].issue, /30\.0%/)

  const atTwenty = Array.from({ length: 10 }, (_, i) => ({
    id: `ch${String(i + 1).padStart(4, '0')}`,
    hookStrength: i < 2 ? 5 : 3,
  }))
  assert.deepEqual(ofKind(audit({ chapters: atTwenty }), 'hook-share'), [])
})

test('hook：hookStrength 全缺 → audit 不报错也不多报', () => {
  assert.deepEqual(audit({ chapters: chaptersTo(5) }), [])
  assert.deepEqual(
    ofKind(audit({ chapters: chaptersTo(5), canon: baseCanon() }), 'hook-streak'),
    [],
  )
  assert.deepEqual(
    ofKind(audit({ chapters: chaptersTo(5), canon: baseCanon() }), 'hook-share'),
    [],
  )
})

// ---- P1-3 首末呼应 ---------------------------------------------------------

test('bookend-flat：首末同地且 turn 同向（都得到）→ note', () => {
  const chapters = [
    { id: 'ch0001', where: '码头', turn: '他从老周手里得到了钥匙' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `ch${String(i + 2).padStart(4, '0')}` })),
    { id: 'ch0010', where: '码头', turn: '他终于得到了自由' },
  ]
  const hits = ofKind(audit({ chapters }), 'bookend-flat')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.match(hits[0].issue, /码头/)
  assert.match(hits[0].issue, /得到/)
})

test('bookend：首末同地但 turn 反向（得到→失去）→ 不报', () => {
  const chapters = [
    { id: 'ch0001', where: '码头', turn: '他得到了钥匙' },
    { id: 'ch0002', where: '街市', turn: '他失去了同伴' },
    { id: 'ch0003', where: '码头', turn: '他失去了自由' },
  ]
  assert.deepEqual(ofKind(audit({ chapters }), 'bookend-flat'), [])
})

test('bookend：任一章 where 缺失 → 不报', () => {
  const chapters = [
    { id: 'ch0001', turn: '他得到了钥匙' },
    { id: 'ch0002', where: '码头', turn: '他得到了自由' },
  ]
  assert.deepEqual(ofKind(audit({ chapters }), 'bookend-flat'), [])
})

// ---- P1-8 兑现章专名漂移 ---------------------------------------------------

test('name-drift：兑现章新专名出现 2 次且不在 facts → note', () => {
  const canon = baseCanon({
    threads: [{ id: 't1', text: '血书之谜', opened: 'ch0001', status: 'closed', closedIn: 'ch0005' }],
    facts: [{ s: '林砚', p: '身份', o: '捕快', chapter: 'ch0001', status: 'canon' }],
  })
  const chapters = [
    { id: 'ch0001', text: '林砚出门。' },
    { id: 'ch0005', text: '沈砚推门。沈砚坐下。' },
  ]
  const hits = ofKind(audit({ chapters, canon }), 'name-drift')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.equal(hits[0].where, 'ch0005')
  assert.match(hits[0].issue, /沈砚/)
  assert.match(hits[0].issue, /2 次/)
})

test('name-drift：兑现章专名只出现 1 次 → 不报', () => {
  const canon = baseCanon({
    threads: [{ id: 't1', text: '血书之谜', opened: 'ch0001', status: 'closed', closedIn: 'ch0005' }],
    facts: [{ s: '林砚', p: '身份', o: '捕快', chapter: 'ch0001', status: 'canon' }],
  })
  const chapters = [{ id: 'ch0005', text: '沈砚推门。' }]
  assert.deepEqual(ofKind(audit({ chapters, canon }), 'name-drift'), [])
})

test('name-drift：无 canon / facts 为空 / 无兑现章 → 全部静默', () => {
  const chapters = [{ id: 'ch0005', text: '沈砚推门。沈砚坐下。' }]
  assert.deepEqual(ofKind(audit({ chapters }), 'name-drift'), [])
  assert.deepEqual(ofKind(audit({ chapters, canon: baseCanon() }), 'name-drift'), [])
  const canon = baseCanon({
    threads: [{ id: 't1', text: '血书之谜', opened: 'ch0001', status: 'open', closedIn: null }],
    facts: [{ s: '林砚', p: '身份', o: '捕快', chapter: 'ch0001', status: 'canon' }],
  })
  assert.deepEqual(ofKind(audit({ chapters, canon }), 'name-drift'), [])
})

// ---- X1 B 线合流 -----------------------------------------------------------

test('bline-unmerged：有 B 线标记但 58% 后无合流 → note', () => {
  const chapters = Array.from({ length: 10 }, (_, i) => ({
    id: `ch${String(i + 1).padStart(4, '0')}`,
    turn: '推进一个阶段',
    hook: '新的麻烦出现',
  }))
  const outline = {
    version: 2,
    totalChapters: 10,
    volumes: [{ title: '卷一', purpose: '开场', chapters: [], opens: ['B线：沈砚与父亲和解'] }],
    chapters,
  }
  const hits = ofKind(audit({ outline }), 'bline-unmerged')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.equal(hits[0].where, '全书')
  assert.match(hits[0].issue, /第 6 章/)
})

test('bline：无 B 线标记 → 完全静默；中点后已合流 → 不报', () => {
  const chapters = Array.from({ length: 10 }, (_, i) => ({
    id: `ch${String(i + 1).padStart(4, '0')}`,
    turn: '推进一个阶段',
    hook: '新的麻烦出现',
  }))
  const noMarker = {
    version: 2,
    totalChapters: 10,
    volumes: [{ title: '卷一', purpose: '开场', chapters: [], opens: ['A线：查清血书'] }],
    chapters,
  }
  assert.deepEqual(ofKind(audit({ outline: noMarker }), 'bline-unmerged'), [])

  const merged = structuredClone(noMarker)
  merged.volumes[0].opens = ['B线：沈砚与父亲和解']
  merged.chapters[7].turn = 'B线与主线合流，沈砚交出账本'
  assert.deepEqual(ofKind(audit({ outline: merged }), 'bline-unmerged'), [])
})
