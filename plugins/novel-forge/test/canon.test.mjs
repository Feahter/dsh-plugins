// canon.test.mjs — canon v2 契约测试：建库/合并幂等/冲突/检索/格式化/迁移/死亡判定。
// 只 import canon.js：并行施工期间其他 recipe 模块可能还没落盘。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANON_VERSION,
  emptyCanon,
  createCanon,
  mergeCanon,
  queryCanon,
  formatCanon,
  canonStats,
  canonProblems,
  migrateLedger,
  entityOf,
  isDead,
} from '../src/recipes/novel/canon.js'

const chapterId = (number) => `ch${String(number).padStart(4, '0')}`

function canonWithFacts(count, { tag = '', chapter = 'ch0001' } = {}) {
  const canon = emptyCanon()
  for (let i = 1; i <= count; i += 1) {
    canon.facts.push({
      id: `f${String(i).padStart(4, '0')}`,
      s: `人物${i}`,
      p: '状态',
      o: `状态${i}`,
      chapter,
      status: 'canon',
      tags: tag ? [tag] : [],
    })
  }
  return canon
}

test('canon：CANON_VERSION 与空正典形状', () => {
  assert.equal(CANON_VERSION, 2)
  assert.deepEqual(emptyCanon(), {
    version: 2,
    rules: [],
    facts: [],
    notes: [],
    threads: [],
    entities: {},
    timeline: [],
    invariants: [],
  })
  // 每次返回新对象，调用方改一个不会污染下一个。
  const first = emptyCanon()
  first.rules.push('视角：第一人称')
  assert.deepEqual(emptyCanon().rules, [])
})

test('canon：createCanon 从 brief/人物/参数/卷纲建初始正典', () => {
  const canon = createCanon({
    brief: { title: '守夜', logline: '守夜人寻找父亲死因', theme: '执念' },
    params: { pov: '第三人称限知', language: '中文', genre: '悬疑' },
    characters: {
      cast: [
        { name: '林砚', role: '主角', gender: '男', relations: [{ to: '陈婆', kind: '债主' }] },
        { name: '陈婆', role: '配角' },
      ],
    },
    spine: { volumes: [{ id: 'v01', title: '头七', goal: '林砚接下殡仪馆夜班', opens: ['守夜人袖口的香灰'] }] },
  })
  assert.equal(canon.version, 2)
  assert.deepEqual(canon.rules, ['视角：第三人称限知', '语言：中文', '类型：悬疑'])
  assert.equal(canon.notes.length, 3)
  assert.equal(canon.entities['林砚'].role, '主角')
  assert.equal(canon.entities['林砚'].relations[0].kind, '债主')
  assert.equal(canon.threads.length, 1)
  assert.equal(canon.threads[0].opened, 'v01')
  assert.equal(canon.timeline[0].chapter, 'v01')
})

test('canon：mergeCanon 不改入参、返回新对象', () => {
  const base = emptyCanon()
  const patch = {
    facts: [{ s: '林砚', p: '状态', o: '左手受伤', tags: ['character:林砚'] }],
    notes: [{ text: '守夜人换班是凌晨三点', tags: ['place:殡仪馆'] }],
  }
  const merged = mergeCanon(base, patch, { chapter: 'ch0003' })
  assert.notEqual(merged, base)
  assert.deepEqual(base, emptyCanon(), '入参不能被修改')
  assert.equal(merged.facts.length, 1)
  assert.equal(merged.facts[0].chapter, 'ch0003')
  assert.equal(merged.facts[0].status, 'canon')
  assert.equal(merged.notes[0].status, 'open')
})

test('canon：同一 patch 合并两次 deep-equal（幂等）', () => {
  const patch = {
    facts: [{ s: '林砚', p: '状态', o: '左手受伤', tags: ['character:林砚'] }],
    notes: [{ text: '殡仪馆只在午夜开门' }],
    threads: [{ text: '守夜人袖口的香灰', opened: 'ch0002' }],
    entities: { 林砚: { state: '左手受伤', knows: ['父亲死于头七'] } },
    timeline: [{ when: '头七当晚', event: '林砚守夜' }],
    invariants: ['死者不会在头七之外回来'],
  }
  const once = mergeCanon(emptyCanon(), patch, { chapter: 'ch0003' })
  const twice = mergeCanon(once, patch, { chapter: 'ch0003' })
  assert.deepEqual(twice, once)
  assert.equal(twice.facts.length, 1)
  assert.equal(twice.notes.length, 1)
  assert.equal(twice.threads.length, 1)
  assert.equal(twice.timeline.length, 1)
  assert.equal(twice.invariants.length, 1)
  assert.deepEqual(twice.entities['林砚'].knows, ['父亲死于头七'])
})

test('canon：facts 按 s|p|o 归一化去重（空白差异算同一条）', () => {
  const canon = mergeCanon(emptyCanon(), {
    facts: [
      { s: ' 林砚 ', p: '状态', o: '左手  受伤' },
      { s: '林砚', p: '状态', o: '左手 受伤' },
    ],
  })
  assert.equal(canon.facts.length, 1)
  assert.equal(canon.facts[0].s, '林砚')
  assert.equal(canon.facts[0].o, '左手 受伤')
})

test('canon：notes 按文本归一化去重，threads 按文本去重', () => {
  const canon = mergeCanon(emptyCanon(), {
    notes: [{ text: '殡仪馆只在午夜开门' }, { text: ' 殡仪馆只在午夜开门 ' }],
    threads: [{ text: '香灰' }, { text: '香灰', opened: 'ch0009' }],
  }, { chapter: 'ch0001' })
  assert.equal(canon.notes.length, 1)
  assert.equal(canon.threads.length, 1)
  assert.equal(canon.threads[0].opened, 'ch0001', '默认用调用方章节')
})

test('canon：threads 闭合指向同一 id，重复合并不改变结果', () => {
  const opened = mergeCanon(emptyCanon(), { threads: [{ id: 't03', text: '香灰', opened: 'ch0002' }] }, { chapter: 'ch0002' })
  const closedPatch = { threads: [{ id: 't03', status: 'closed', closedIn: 'ch0042' }] }
  const closed = mergeCanon(opened, closedPatch)
  assert.equal(closed.threads.length, 1)
  assert.equal(closed.threads[0].id, 't03')
  assert.equal(closed.threads[0].status, 'closed')
  assert.equal(closed.threads[0].closedIn, 'ch0042')
  assert.deepEqual(mergeCanon(closed, closedPatch), closed)
})

test('canon：同 s|p 不同 o 两条都保留，canonProblems 报 canon-conflict', () => {
  const canon = mergeCanon(emptyCanon(), {
    facts: [
      { s: '林砚', p: '状态', o: '死亡', chapter: 'ch0010' },
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0012' },
    ],
  })
  assert.equal(canon.facts.length, 2, '绝不覆盖已有事实')
  assert.equal(canon.facts[0].conflict, true)
  assert.equal(canon.facts[1].conflict, true)
  const problems = canonProblems(canon)
  const conflicts = problems.filter((finding) => finding.kind === 'canon-conflict')
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].severity, 'warn')
  assert.equal(conflicts[0].where, '林砚|状态')
  assert.match(conflicts[0].issue, /死亡/)
  assert.match(conflicts[0].issue, /左手受伤/)
})

test('canon：旧事实置 retracted 后不再报冲突', () => {
  let canon = mergeCanon(emptyCanon(), {
    facts: [
      { s: '林砚', p: '状态', o: '死亡', chapter: 'ch0010' },
      { s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0012' },
    ],
  })
  canon = mergeCanon(canon, { facts: [{ s: '林砚', p: '状态', o: '死亡', status: 'retracted' }] })
  assert.equal(canon.facts.length, 2)
  assert.equal(canon.facts[0].status, 'retracted')
  assert.equal(canon.facts[0].conflict, undefined)
  assert.equal(canonProblems(canon).filter((finding) => finding.kind === 'canon-conflict').length, 0)
})

test('canon：合并 200 条事实一条不丢（不设总数上限）', () => {
  const facts = []
  for (let i = 1; i <= 200; i += 1) {
    facts.push({ s: `人物${i}`, p: '位置', o: `地点${i}`, chapter: chapterId(i) })
  }
  const canon = mergeCanon(emptyCanon(), { facts, notes: [{ text: '注记' }] })
  assert.equal(canon.facts.length, 200)
  assert.equal(canon.notes.length, 1)
})

test('canon：queryCanon 出场者相关优先，且两次调用 deep-equal', () => {
  const canon = emptyCanon()
  canon.facts.push(
    { id: 'f0001', s: '路人甲', p: '状态', o: '在喝茶', chapter: 'ch0001', status: 'canon', tags: [] },
    { id: 'f0002', s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0001', status: 'canon', tags: ['character:林砚'] },
    { id: 'f0003', s: '林砚', p: '位置', o: '殡仪馆', chapter: 'ch0001', status: 'canon', tags: ['character:林砚'] },
  )
  const query = { cast: ['林砚'], keywords: ['殡仪馆'], location: '殡仪馆', atChapter: 'ch0005', limit: 10 }
  const slice = queryCanon(canon, query)
  assert.equal(slice.facts[0].s, '林砚')
  assert.equal(slice.facts[1].s, '林砚')
  assert.equal(slice.facts[2].s, '路人甲')
  assert.deepEqual(queryCanon(canon, query), slice, '排序必须确定')
  assert.equal(slice.truncated, false)
})

test('canon：queryCanon 近章事实加分，旧章排后', () => {
  const canon = emptyCanon()
  canon.facts.push(
    { id: 'f0001', s: '旧事', p: '状态', o: '第一章的旧闻', chapter: 'ch0001', status: 'canon', tags: [] },
    { id: 'f0002', s: '新事', p: '状态', o: '第四十五章的新事', chapter: 'ch0045', status: 'canon', tags: [] },
  )
  const slice = queryCanon(canon, { atChapter: 'ch0050', limit: 10 })
  assert.equal(slice.facts[0].id, 'f0002')
})

test('canon：queryCanon 未回收线索优先，开口越早越靠前', () => {
  const canon = emptyCanon()
  canon.threads.push(
    { id: 't01', text: '第一章的伏笔', opened: 'ch0002', status: 'open', closedIn: null, payoff: '' },
    { id: 't02', text: '刚开的线', opened: 'ch0090', status: 'open', closedIn: null, payoff: '' },
    { id: 't03', text: '已回收的线', opened: 'ch0001', status: 'closed', closedIn: 'ch0010', payoff: '已用' },
  )
  const slice = queryCanon(canon, { atChapter: 'ch0100', limit: 10 })
  assert.deepEqual(slice.threads.map((thread) => thread.id), ['t01', 't02', 't03'])
})

test('canon：queryCanon limit 裁剪并置 truncated', () => {
  const canon = canonWithFacts(5)
  const slice = queryCanon(canon, { atChapter: 'ch0001', limit: 2 })
  assert.equal(slice.facts.length, 2)
  assert.equal(slice.truncated, true)
  // 同分按 id 升序。
  assert.deepEqual(slice.facts.map((fact) => fact.id), ['f0001', 'f0002'])
})

test('canon：formatCanon 输出【】小标题，空切片返回空串', () => {
  assert.equal(formatCanon(emptyCanon()), '')
  assert.equal(formatCanon(null), '')
  const slice = {
    rules: ['视角：第三人称限知'],
    invariants: ['死者不会在头七之外回来'],
    facts: [{ s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0003' }],
    notes: [{ text: '殡仪馆只在午夜开门', chapter: 'ch0002' }],
    threads: [
      { id: 't01', text: '香灰', opened: 'ch0002', status: 'open' },
      { id: 't02', text: '已回收', opened: 'ch0001', status: 'closed' },
    ],
    entities: [{ name: '林砚', role: '主角', location: '殡仪馆', state: '左手受伤', knows: ['父亲死于头七'] }],
    timeline: [{ chapter: 'ch0003', when: '头七当晚', event: '林砚守夜' }],
  }
  const text = formatCanon(slice, { maxChars: 3000 })
  for (const title of ['【硬规则】', '【不可违背】', '【已确立事实】', '【连续性注记】', '【未回收线索】', '【人物状态】', '【时间线】']) {
    assert.ok(text.includes(title), `缺少小标题 ${title}`)
  }
  assert.ok(text.includes('林砚｜状态｜左手受伤'))
  assert.ok(!text.includes('已回收'), '闭合线索不进 prompt')
})

test('canon：formatCanon 超限截断并标「…（已截断）」', () => {
  const slice = {
    notes: Array.from({ length: 30 }, (_, index) => ({ text: `第${index}条很长的连续性注记，用来撑爆预算`, chapter: 'ch0001' })),
  }
  const text = formatCanon(slice, { maxChars: 120 })
  assert.ok(text.length <= 120)
  assert.ok(text.endsWith('…（已截断）'))
})

test('canon：canonStats 统计规模、未回收线索、死亡与冲突', () => {
  const canon = emptyCanon()
  canon.entities['林砚'] = { kind: 'character', gender: '男', role: '主角', aliases: [], firstSeen: '', lastSeen: 'ch0012', location: '', state: '', knows: [], relations: [] }
  canon.facts.push(
    { id: 'f0001', s: '林砚', p: '状态', o: '死亡', chapter: 'ch0010', status: 'canon', tags: [] },
    { id: 'f0002', s: '林砚', p: '状态', o: '左手受伤', chapter: 'ch0012', status: 'canon', tags: [] },
  )
  canon.notes.push({ id: 'n0001', text: '注记', chapter: 'ch0001', status: 'open', tags: [] })
  canon.threads.push(
    { id: 't01', text: '开线', opened: 'ch0002', status: 'open', closedIn: null, payoff: '' },
    { id: 't02', text: '收线', opened: 'ch0001', status: 'closed', closedIn: 'ch0003', payoff: '' },
  )
  assert.deepEqual(canonStats(canon), {
    facts: 2,
    notes: 1,
    threads: 2,
    openThreads: 1,
    entities: 1,
    dead: 1,
    conflicts: 1,
  })
})

test('canon：migrateLedger 字段映射、旧 text 全进 notes、可识别三元组进 facts', () => {
  const ledger = {
    facts: [
      { text: '林砚|状态|死亡', chapter: 'ch0001', status: 'canon' },
      { text: '陈婆的债主是林砚', chapter: 'ch0002', status: 'open' },
      { text: '殡仪馆只在午夜开门', chapter: 'ch0003', status: 'closed' },
    ],
    threads: [{ id: 't01', text: '袖口的香灰', opened: 'ch0002', status: 'open', closedIn: null }],
    timeline: [{ chapter: 'ch0003', when: '头七当晚', event: '林砚守夜' }],
    characters: { 林砚: { location: '殡仪馆', state: '夜班', knows: ['父亲死于头七'] } },
    canonRules: ['视角：第三人称限知'],
  }
  const canon = migrateLedger(ledger, { characters: { cast: [{ name: '陈婆', role: '配角' }] } })
  assert.equal(canon.version, 2)
  assert.equal(canon.notes.length, 3, '旧 text facts 一条都不能少，全进 notes')
  assert.equal(canon.facts.length, 2, '两种结构化写法都被识别')
  assert.deepEqual(canon.facts.map((fact) => `${fact.s}|${fact.p}|${fact.o}`), ['林砚|状态|死亡', '陈婆|债主|林砚'])
  assert.equal(canon.facts[0].status, 'canon')
  assert.equal(canon.facts[1].status, 'open')
  assert.equal(canon.rules[0], '视角：第三人称限知')
  assert.equal(canon.threads[0].id, 't01')
  assert.equal(canon.timeline[0].event, '林砚守夜')
  assert.equal(canon.entities['陈婆'].role, '配角')
  assert.equal(canon.entities['林砚'].state, '夜班')
  assert.deepEqual(canon.entities['林砚'].knows, ['父亲死于头七'])
})

test('canon：migrateLedger 幂等（已是 v2 原样返回）', () => {
  const v2 = mergeCanon(emptyCanon(), { facts: [{ s: '甲', p: '状态', o: '活着' }] }, { chapter: 'ch0001' })
  assert.equal(migrateLedger(v2), v2, 'v2 输入直接返回同一对象')
  const v1 = { facts: [{ text: '甲的年龄是三十', chapter: 'ch0001' }], threads: [], timeline: [], canonRules: [] }
  const migrated = migrateLedger(v1)
  assert.deepEqual(migrateLedger(migrated), migrated)
})

test('canon：isDead 判定死亡、复活与不会误判', () => {
  let canon = mergeCanon(emptyCanon(), {
    facts: [{ s: '林砚', p: '状态', o: '死亡', chapter: 'ch0010' }],
  })
  assert.equal(isDead(canon, '林砚'), true)
  assert.equal(isDead(canon, '陈婆'), false)

  // 更晚的「未死」事实视为复活。
  canon = mergeCanon(canon, { facts: [{ s: '林砚', p: '状态', o: '未死', chapter: 'ch0020' }] })
  assert.equal(isDead(canon, '林砚'), false)

  // 再往后重新死亡。
  canon = mergeCanon(canon, { facts: [{ s: '林砚', p: '生死', o: '已死', chapter: 'ch0030' }] })
  assert.equal(isDead(canon, '林砚'), true)

  // retracted 的死亡事实不参与判定。
  canon = mergeCanon(canon, { facts: [{ s: '陈婆', p: '状态', o: '死亡', chapter: 'ch0010', status: 'retracted' }] })
  assert.equal(isDead(canon, '陈婆'), false)

  // 非死亡谓词不误判。
  const other = mergeCanon(emptyCanon(), { facts: [{ s: '王五', p: '位置', o: '死亡谷', chapter: 'ch0001' }] })
  assert.equal(isDead(other, '王五'), false)
})

test('canon：entityOf 命中本名与别名', () => {
  const canon = emptyCanon()
  canon.entities['林砚'] = { kind: 'character', aliases: ['守夜人'], role: '主角' }
  const hit = entityOf(canon, '守夜人')
  assert.equal(hit.name, '林砚')
  assert.equal(hit.entity.role, '主角')
  assert.deepEqual(entityOf(canon, '林砚').name, '林砚')
  assert.equal(entityOf(canon, '不存在'), null)
})

test('canon：空 patch 无变更（deep-equal）', () => {
  const canon = mergeCanon(emptyCanon(), {
    facts: [{ s: '林砚', p: '状态', o: '死亡' }],
    threads: [{ text: '香灰' }],
  }, { chapter: 'ch0001' })
  assert.deepEqual(mergeCanon(canon, {}, { chapter: 'ch0099' }), canon)
})

test('canon：兼容 v1 ledgerPatch（text facts / characters / canonRules）', () => {
  const canon = mergeCanon(emptyCanon(), {
    facts: [{ text: '殡仪馆只在午夜开门', chapter: 'ch0002', status: 'canon' }],
    characters: { 林砚: { role: '主角', location: '殡仪馆', state: '夜班', knows: ['父亲死于头七'] } },
    canonRules: ['视角：第三人称限知'],
  }, { chapter: 'ch0003' })
  assert.equal(canon.facts.length, 0, '自由文本不能伪装成三元组')
  assert.equal(canon.notes.length, 1, '旧 text fact 必须落进 notes')
  assert.equal(canon.notes[0].text, '殡仪馆只在午夜开门')
  assert.equal(canon.entities['林砚'].state, '夜班')
  assert.deepEqual(canon.entities['林砚'].knows, ['父亲死于头七'])
  assert.deepEqual(canon.rules, ['视角：第三人称限知'])
})

test('canon：5000 facts + 2000 notes 下 queryCanon 仍在毫秒级', () => {
  const canon = canonWithFacts(5000, { tag: 'character:林砚', chapter: 'ch0005' })
  for (let i = 1; i <= 2000; i += 1) {
    canon.notes.push({
      id: `n${String(i).padStart(4, '0')}`,
      text: `第${i}条注记`,
      chapter: 'ch0006',
      status: 'open',
      tags: ['place:殡仪馆'],
    })
  }
  const query = { cast: ['林砚'], keywords: ['殡仪馆'], location: '殡仪馆', atChapter: 'ch1000', limit: 48 }
  const started = Date.now()
  const slice = queryCanon(canon, query)
  const elapsed = Date.now() - started
  assert.ok(elapsed < 200, `queryCanon 耗时 ${elapsed}ms，超出 200ms 余量`)
  assert.equal(slice.facts.length, 48)
  assert.equal(slice.truncated, true)
  console.log(`# canon 性能：5000 facts + 2000 notes queryCanon = ${elapsed}ms`)
})
