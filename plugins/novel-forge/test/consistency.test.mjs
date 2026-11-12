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

  const start = performance.now()
  const findings = audit({ chapters, canon })
  const elapsed = performance.now() - start

  assert.ok(elapsed < 100, `audit 用时 ${elapsed.toFixed(1)}ms，超过 100ms`)
  assert.ok(findings.length >= 200)
  assert.ok(elapsed >= 0)
})
