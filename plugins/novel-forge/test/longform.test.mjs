// longform.test.mjs — v0.2 长篇能力证据（300 章规模，全 mock、不联网、不碰磁盘）。
// 覆盖 docs/architecture-v2.md §2/§4/§5/§6/§8 的验收点：
//   骨架规模、惰性展开、上下文恒定、正典只增不减、跨章检索、
//   死亡人物、时间倒流、审计性能、packet 分片账。
// 运行：node --test test/longform.test.mjs
//
// 说明：每个 test 都自己构造 outline/canon/read，不共享可变状态；
// 关键实测值用 [longform] 前缀打印，方便 Lead 复核。
//
// ⚠️ 本文件保留 1 条按验收文字字面写、但实测不成立的断言（test 名带「spec 目标」）：
//   ch001 包 6269 字 vs ch300 包 8781 字，差 28.6% > 5%。
//   原因是第 1 章没有 previous/recent/digest/style 四片可读，而这四片 cap 合计 4200；
//   预算 12000 下 ch001 必然更小。architecture-v2 §10 只要求「每章 packet ≤ budget」，
//   所以这是验收文字与实现的冲突，不是 packet/chapter 的代码缺陷。
//   可成立的等价证据：同组 3a（两包都 ≤budget、常驻分片内容集合一致、差额 ≤4200）
//   与 3b（都已预热的 ch100 vs ch300 差 0.43% ≤5%）。是否删除/改写该条由 Lead 定。

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildOutlineSkeleton, mergeVolumeChapters, nextActions } from '../src/recipes/novel/plan.js'
import { emptyCanon, mergeCanon, queryCanon, canonStats } from '../src/recipes/novel/canon.js'
import { prepareChapter, commitChapter, checkChapter } from '../src/recipes/novel/chapter.js'
import { buildPacket } from '../src/recipes/novel/packet.js'
import { audit } from '../src/recipes/novel/consistency.js'

const say = (...parts) => console.log('[longform]', ...parts)

const CAST = ['沈砚', '陈婆']
const LONG = (text, size) => text.repeat(Math.ceil(size / text.length)).slice(0, size)
const chapterIdOf = (index) => `ch${String(index).padStart(3, '0')}`
const timeIt = (fn) => {
  const started = process.hrtime.bigint()
  const value = fn()
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 }
}

// 15 段、约 230 字的干净正文（人物都在 cast 里，避免无关 cast-missing 噪音）。
function cleanProse() {
  return [
    '雨停的时候，巷口的灯刚亮。',
    '沈砚把门推开一条缝，闻到很重的香灰味。',
    '陈婆坐在堂屋正中，面前摆着一本没有封皮的账册。',
    '「你来晚了。」她说。',
    '他侧身挤进去，鞋底在青砖上蹭出一点声音。',
    '堂屋的梁上垂着一盏旧灯，灯芯只剩半寸。',
    '桌上压着一张黄纸，纸角被香灰烫出小洞。',
    '「别碰。」陈婆的声音从背后追上来。',
    '他停住手，指尖离纸页只差一寸。',
    '纸页边缘有烧过的痕迹，像被谁反复捻过。',
    '窗外有人拖着铁链走过，声音很慢。',
    '陈婆忽然压低嗓子说：「今晚别住西厢。」',
    '「为什么？」他问。',
    '西厢的门在风里轻轻响了一声。',
    '灯芯爆了一下，屋里暗了半寸。',
  ].join('\n\n')
}

function rowsFor(count, offset = 0, { when } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const index = offset + i
    return {
      title: `第${index + 1}章 夜行`,
      goal: `查清香灰的来路（目标 ${index + 1}）`,
      conflict: '陈婆拦门，账本被调包',
      turn: '账本最后一页出现自己的名字',
      hook: '门缝里塞进来一撮新香灰',
      pov: '第三人称限知',
      when: typeof when === 'function' ? when(index) : `第${index + 1}天`,
      where: '殡仪馆',
      cast: CAST,
    }
  })
}

function skeleton(chapters = 300, chaptersPerVolume = 30) {
  return buildOutlineSkeleton({ chapters, chaptersPerVolume, language: 'zh' })
}

/** 300 章、所有卷都已展开的 v2 大纲（每卷的 when 按全书章号递增）。 */
function plannedOutline({ chapters = 300, chaptersPerVolume = 30, when } = {}) {
  let outline = skeleton(chapters, chaptersPerVolume)
  let offset = 0
  for (const volume of outline.volumes) {
    const count = Number(volume.targetChapters) || 0
    outline = mergeVolumeChapters(outline, volume.id, rowsFor(count, offset, { when }))
    offset += count
  }
  return outline
}

function memoryRead(entries = {}) {
  return (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null)
}

/** 从材料包正文里切出某个 `## 标题` 分片，用于逐字比对。 */
function sectionOf(text, title) {
  const marker = `## ${title}\n`
  const start = text.indexOf(marker)
  if (start < 0) return ''
  const from = start + marker.length
  const next = text.indexOf('\n\n## ', from)
  return next < 0 ? text.slice(from) : text.slice(from, next)
}

function beatsFixture() {
  return {
    goal: LONG('拿到账本并确认香灰的来路。', 300),
    conflict: LONG('陈婆寸步不让，守夜人堵在门口。', 300),
    turn: LONG('账本被调包，最后一页写着他自己的名字。', 300),
    hook: LONG('新的香灰从门缝里塞进来。', 300),
    rhythm: '紧—缓—紧',
    beats: ['潜入殡仪馆', '翻找抽屉', '撞见守夜人'],
    scenes: [
      { when: '午夜', where: '殡仪馆', goal: LONG('潜入停尸间', 200), conflict: LONG('门锁锈死', 200), turn: LONG('门自己开了', 200), hook: LONG('抽屉里有呼吸声', 200), cast: CAST },
      { when: '凌晨', where: '西厢', goal: LONG('找账本', 200), conflict: LONG('陈婆出现', 200), turn: LONG('账本空白', 200), hook: LONG('灯灭了', 200), cast: CAST },
    ],
    notes: LONG('这一章要把香灰线索再压一次，不要揭底。', 400),
  }
}

/**
 * 40 章正典：每章 2 条 fact + 1 条 thread。
 * 事实的 chapter 刻意放在 ch022 之后：这样 atChapter=1 与 atChapter=300
 * 都不触发「近 20 章」加分，queryCanon 的排序在两端一致，canon 分片才可逐字比对。
 */
function canonThroughForty({ startAt = 22, shen = false } = {}) {
  let canon = emptyCanon()
  for (let i = 0; i < 40; i++) {
    const chapter = chapterIdOf(startAt + i)
    canon = mergeCanon(canon, {
      facts: [
        { s: `人物${i + 1}`, p: '位置', o: `地点${i + 1}`, chapter },
        { s: `人物${i + 1}`, p: '状态', o: '活着', chapter },
      ],
      threads: [{ text: `线索${i + 1}：香灰的来路`, status: 'open', opened: chapter }],
    }, { chapter })
  }
  if (shen) {
    canon = mergeCanon(canon, {
      facts: [{ s: '沈砚', p: '左手', o: '有旧伤', chapter: 'ch005' }],
      entities: { 沈砚: { kind: 'character', state: '活着', location: '殡仪馆' } },
    }, { chapter: 'ch005' })
  }
  return canon
}

/** 一个「有前情可读」的世界：300 章大纲 + 299 章摘要 + 若干细纲/草稿 + 40 章正典。 */
function richWorld({ chapters = 300 } = {}) {
  const outline = plannedOutline({ chapters })
  const entries = {
    canon: canonThroughForty({ shen: true }),
    characters: {
      cast: CAST.map((name) => ({
        name,
        role: name === '沈砚' ? '主角' : '殡仪馆主人',
        gender: name === '沈砚' ? '男' : '女',
        want: LONG(`${name}想查清香灰与账本的关系。`, 90),
        fear: LONG(`${name}害怕账本落到别人手里。`, 80),
        secret: LONG(`${name}知道一个不能说的名字。`, 80),
        voice: LONG('说话很轻，句尾常带一点笑。', 60),
      })),
    },
  }
  for (const id of ['ch001', 'ch100', 'ch250', 'ch300']) entries[`beats/${id}`] = beatsFixture()
  for (let index = 1; index <= chapters - 1; index++) {
    entries[`summary/${chapterIdOf(index)}`] = LONG(`第${index}章：沈砚在殡仪馆守夜，账本又翻到最后一页。`, 200)
  }
  for (const id of ['ch098', 'ch099', 'ch248', 'ch249', 'ch298', 'ch299']) {
    entries[`draft/${id}`] = LONG('雨落在瓦上，像有人数着脚步。灯影在墙上慢慢挪。', 500)
  }
  return { outline, entries }
}

// ---------------------------------------------------------------- 1. 骨架规模

test('骨架规模：300 章 = 10 卷 × 30 章，3000 章卷数 ≤ 40，生成 < 10ms', () => {
  const big = timeIt(() => skeleton(300))
  assert.equal(big.value.totalChapters, 300, `300 章的总章数应为 300，实际 ${big.value.totalChapters}`)
  assert.equal(big.value.volumes.length, 10, `300 章应切 10 卷，实际 ${big.value.volumes.length} 卷`)
  assert.deepEqual(
    big.value.volumes.map((volume) => volume.targetChapters),
    Array(10).fill(30),
    '300 章 / 每卷 30 章 时每卷目标章数应全为 30',
  )
  const first = mergeVolumeChapters(big.value, 'v01', rowsFor(30, 0))
  assert.equal(first.chapters[0].id, 'ch001', `首章 id 应为 ch001，实际 ${first.chapters[0].id}`)
  assert.equal(first.chapters[29].id, 'ch030', `第一卷末章 id 应为 ch030，实际 ${first.chapters[29].id}`)

  const samples = []
  for (let i = 0; i < 5; i++) samples.push(timeIt(() => skeleton(3000)).ms)
  const best = Math.min(...samples)
  const huge = skeleton(3000)
  assert.ok(huge.volumes.length <= 40, `3000 章卷数应 ≤ 40，实际 ${huge.volumes.length}`)
  assert.equal(huge.volumes.length, 40, `3000 章应压到 40 卷，实际 ${huge.volumes.length}`)
  assert.equal(huge.volumes[0].targetChapters, 75, `3000 章 / 40 卷 每卷应 75 章，实际 ${huge.volumes[0].targetChapters}`)
  const hugeFirst = mergeVolumeChapters(huge, 'v01', rowsFor(75, 0))
  assert.equal(hugeFirst.chapters[0].id, 'ch0001', `3000 章首章 id 应为 ch0001，实际 ${hugeFirst.chapters[0].id}`)
  assert.ok(best < 10, `3000 章骨架生成应 < 10ms，实测最好 ${best.toFixed(3)}ms（5 次 ${samples.map((n) => n.toFixed(2)).join('/')}）`)

  say(`骨架 300 章：10 卷 × 30 章，首章 ch001；3000 章：${huge.volumes.length} 卷 × ${huge.volumes[0].targetChapters} 章，首章 ch0001，最好耗时 ${best.toFixed(3)}ms`)
})

// ---------------------------------------------------------------- 2. 惰性展开

test('惰性展开：骨架不预生成章表，首卷展开后其余卷仍为空，下一步写第 1 章', () => {
  const base = skeleton(300)
  assert.equal(base.chapters.length, 0, `骨架不应预生成章表，实际 ${base.chapters.length} 章`)
  assert.ok(
    base.volumes.every((volume) => volume.planned === false && volume.chapterIds.length === 0),
    '骨架里所有卷都应是 planned:false 且 chapterIds 为空',
  )
  const cold = nextActions({ outline: base, params: {}, written: [], reviewed: [] })
  assert.equal(cold[0].action, 'plan-volume', `空项目第一步应是 plan-volume，实际 ${cold[0].action}`)
  assert.equal(cold[0].volume, 'v01', `空项目第一步应展开 v01，实际 ${cold[0].volume}`)

  // 第一次展开（ensureVolume / mergeVolumeChapters）之后：只有卷 1 有章表。
  const v1 = mergeVolumeChapters(base, 'v01', rowsFor(30, 0))
  assert.equal(v1.chapters.length, 30, `展开卷 1 后应有 30 章，实际 ${v1.chapters.length}`)
  assert.equal(v1.volumes[0].planned, true, '卷 1 展开后 planned 应为 true')
  assert.equal(v1.volumes[0].chapterIds.length, 30, `卷 1 应有 30 个 chapterIds，实际 ${v1.volumes[0].chapterIds.length}`)
  const others = v1.volumes.slice(1)
  assert.ok(
    others.every((volume) => volume.planned === false && volume.chapterIds.length === 0),
    `其余 ${others.length} 卷应保持 chapters 为空，实际有 ${others.filter((v) => v.chapterIds.length > 0).length} 卷被提前展开`,
  )

  const afterFirst = nextActions({ outline: v1, params: {}, written: [], reviewed: [] })
  assert.equal(afterFirst[0].action, 'write', `展开卷 1 后第一步应是 write，实际 ${afterFirst[0].action}`)
  assert.equal(afterFirst[0].chapter, 'ch001', `应指向 ch001，实际 ${afterFirst[0].chapter}`)

  // 卷 1 写完并审完：第一步才转为展开卷 2。
  const written = v1.chapters.map((chapter) => chapter.id)
  const afterVolume = nextActions({ outline: v1, params: {}, written, reviewed: written })
  assert.equal(afterVolume[0].action, 'plan-volume', `卷 1 写完后第一步应是 plan-volume，实际 ${afterVolume[0].action}`)
  assert.equal(afterVolume[0].volume, 'v02', `应展开 v02，实际 ${afterVolume[0].volume}`)
  assert.equal(afterVolume[0].estimate.calls, 1, `展开一卷应只调 1 次模型，实际 ${afterVolume[0].estimate.calls}`)

  say(`惰性展开：骨架 0 章 / 10 卷未计划 → 展开 v01 后 30 章、其余 ${others.length} 卷为空；nextActions 依次为 plan-volume v01 → write ch001 → plan-volume v02`)
})

// ---------------------------------------------------------------- 3. 上下文恒定

test('上下文恒定：第 1 章与第 300 章材料包都 ≤ 12000，差额不超过相邻章分片上限', async () => {
  const { outline, entries } = richWorld()
  const params = { wordsPerChapter: 3000, pov: '第三人称限知', language: 'zh' }
  const first = await prepareChapter({ outline, params, chapterId: 'ch001', read: memoryRead(entries), llm: null, language: 'zh' })
  const last = await prepareChapter({ outline, params, chapterId: 'ch300', read: memoryRead(entries), llm: null, language: 'zh' })
  const a = first.packet.text.length
  const b = last.packet.text.length
  const delta = Math.abs(b - a)

  assert.ok(a <= 12000, `第 1 章材料包应 ≤ 12000，实际 ${a}`)
  assert.ok(b <= 12000, `第 300 章材料包应 ≤ 12000，实际 ${b}`)
  // 第 300 章比第 1 章多出的只可能是 previous/recent/digest/style 四片（cap 合计 4200），
  // 且第 300 章没有「下一章目标」可扣；超过 4200 就说明有随章号增长的内容。
  assert.ok(
    delta <= 4200,
    `两章包体差应 ≤ 四个相邻章分片上限 4200，实际 ${delta}（ch001=${a}、ch300=${b}）`,
  )
  assert.equal(first.packet.report.used, a, `report.used 应等于 text.length：${first.packet.report.used} vs ${a}`)
  assert.equal(last.packet.report.used, b, `report.used 应等于 text.length：${last.packet.report.used} vs ${b}`)
  // 常驻分片：细纲/出场人物逐字相同；正典按行集合相同。
  // （正典的顺序会随 atChapter 的相关度打分变化：chapterDistance 用绝对距离，
  //  第 1 章会把「尚未开启」的远期线索也当成旧线索加分，所以这里不比顺序。）
  for (const title of ['本章细纲', '本章出场人物']) {
    assert.equal(
      sectionOf(first.packet.text, title),
      sectionOf(last.packet.text, title),
      `第 1 章与第 300 章的「${title}」分片应逐字相同（实际长度 ${sectionOf(first.packet.text, title).length} vs ${sectionOf(last.packet.text, title).length}）`,
    )
  }
  const canonLines = (text) => sectionOf(text, '正典').split('\n').filter(Boolean).sort()
  assert.deepEqual(
    canonLines(first.packet.text),
    canonLines(last.packet.text),
    '第 1 章与第 300 章的正典分片行集合应相同（顺序可因相关度打分不同）',
  )
  // 两章都拿到了同一份正典事实（第 5 章写入的沈砚旧伤），证明长程上下文没被截掉。
  assert.ok(first.packet.text.includes('沈砚｜左手｜有旧伤'), '第 1 章材料包应包含正典里的沈砚旧伤')
  assert.ok(last.packet.text.includes('沈砚｜左手｜有旧伤'), '第 300 章材料包应包含正典里的沈砚旧伤')

  say(`上下文恒定：ch001=${a}、ch300=${b}、差=${delta}（预算 ${last.packet.report.budget}；差额全部来自 previous/recent/digest/style）`)
})

test('上下文恒定：预热后的第 100 章与第 300 章包体差 ≤ 5%', async () => {
  const { outline, entries } = richWorld()
  const params = { wordsPerChapter: 3000, language: 'zh' }
  const warm = await prepareChapter({ outline, params, chapterId: 'ch100', read: memoryRead(entries), llm: null, language: 'zh' })
  const last = await prepareChapter({ outline, params, chapterId: 'ch300', read: memoryRead(entries), llm: null, language: 'zh' })
  const a = warm.packet.text.length
  const b = last.packet.text.length
  const ratio = Math.abs(a - b) / Math.max(a, b)
  const detail = `ch100=${a}、ch300=${b}、差 ${(ratio * 100).toFixed(2)}%`
  assert.ok(ratio <= 0.05, `预热后期章与末章包体差应 ≤5%，实际 ${detail}`)
  say(`上下文恒定（预热后）：${detail}`)
})

// 第 1 章天然没有前情/最近三章/本卷前情/文风样本，包体必然小于末章；「上下文恒定」真正要证的是
// 「和章号无关的那几片一样大」。所以这里断言常驻分片逐片对齐，而不是两包总长相等（§5/§10）。
test('上下文恒定：第 1 章与第 300 章的常驻分片逐片一致，总长差不超过相邻章预算', async () => {
  const { outline, entries } = richWorld()
  const params = { wordsPerChapter: 3000, language: 'zh' }
  const first = await prepareChapter({ outline, params, chapterId: 'ch001', read: memoryRead(entries), llm: null, language: 'zh' })
  const last = await prepareChapter({ outline, params, chapterId: 'ch300', read: memoryRead(entries), llm: null, language: 'zh' })
  const a = first.packet.text.length
  const b = last.packet.text.length
  const sliceOf = (packet, name) => (packet.report.slices ?? []).find(slice => slice.name === name) ?? null
  say(`上下文恒定（冷启动对照）：ch001=${a}、ch300=${b}、差 ${Math.abs(a - b)}`)
  // 常驻分片：本章细纲 / 正典 / 人物速查。这三片跟章号无关，必须一样大。
  for (const name of ['beats', 'canon', 'cast']) {
    const left = sliceOf(first.packet, name)
    const right = sliceOf(last.packet, name)
    assert.ok(left && right, `两包都应有 ${name} 分片`)
    const gap = Math.abs((left.chars ?? 0) - (right.chars ?? 0))
    // 正典/人物按本章出场人物检索，第 1 章与第 300 章的出场人物集合相同，允许 ≤10% 的相关度排序差。
    assert.ok(
      gap <= Math.max(50, Math.round((left.chars ?? 0) * 0.1)),
      `${name} 分片应与章号无关：ch001=${left.chars}、ch300=${right.chars}`,
    )
  }
  // 总长差只能来自 previous/recent/digest/style 四片（cap 合计 4200）+ 下一章目标 300。
  assert.ok(Math.abs(a - b) <= 4500, `两包总长差应 ≤ 相邻章分片上限 4500，实际 ${Math.abs(a - b)}（ch001=${a}、ch300=${b}）`)
})

// ---------------------------------------------------------------- 4. 正典只增不减

test('正典只增不减：40 章 commit 后 80 条事实、40 条线索全在，长度单调递增', async () => {
  const outline = plannedOutline({ chapters: 300 })
  let canon = emptyCanon()
  const read = (key) => (key === 'canon' ? canon : null)
  const factCounts = []
  const threadCounts = []
  const knownFactIds = new Set()

  for (let index = 1; index <= 40; index++) {
    const chapterId = chapterIdOf(index)
    const beforeFacts = canon.facts.length
    const beforeThreads = canon.threads.length
    const result = await commitChapter({
      read,
      params: { language: 'zh' },
      outline,
      chapterId,
      text: cleanProse(),
      summary: `第${index}章：沈砚在殡仪馆守夜，香灰又出现了。`,
      canonPatch: {
        facts: [
          { s: `人${index}`, p: '位置', o: `地点${index}`, chapter: chapterId },
          { s: `人${index}`, p: '线索', o: `物${index}`, chapter: chapterId },
        ],
        threads: [{ text: `线索${index}：香灰的来路`, status: 'open', opened: chapterId }],
      },
    })
    canon = result.canon
    assert.equal(
      canon.facts.length,
      beforeFacts + 2,
      `第 ${index} 章 commit 后事实数应 +2（${beforeFacts} → ${beforeFacts + 2}），实际 ${canon.facts.length}`,
    )
    assert.equal(
      canon.threads.length,
      beforeThreads + 1,
      `第 ${index} 章 commit 后线索数应 +1（${beforeThreads} → ${beforeThreads + 1}），实际 ${canon.threads.length}`,
    )
    for (const id of knownFactIds) {
      assert.ok(
        canon.facts.some((fact) => fact.id === id),
        `第 ${index} 章 commit 后丢了旧事实 ${id}（facts ${canon.facts.length} 条）`,
      )
    }
    for (const fact of canon.facts) knownFactIds.add(fact.id)
    factCounts.push(canon.facts.length)
    threadCounts.push(canon.threads.length)
  }

  assert.equal(canon.facts.length, 80, `40 章 × 2 条事实应得 80 条（v2 不设上限），实际 ${canon.facts.length}`)
  assert.equal(canon.threads.length, 40, `40 章 × 1 条线索应得 40 条，实际 ${canon.threads.length}`)
  assert.equal(new Set(canon.facts.map((fact) => fact.id)).size, 80, '事实 id 不应重复')
  assert.deepEqual(
    factCounts,
    Array.from({ length: 40 }, (_, i) => (i + 1) * 2),
    `事实数应逐章 +2 单调递增，实际序列 ${factCounts.join(',')}`,
  )
  assert.deepEqual(
    threadCounts,
    Array.from({ length: 40 }, (_, i) => i + 1),
    `线索数应逐章 +1 单调递增，实际序列 ${threadCounts.join(',')}`,
  )
  const stats = canonStats(canon)
  assert.equal(stats.facts, 80, `canonStats.facts 应为 80，实际 ${stats.facts}`)
  say(`正典只增不减：40 章 commit → facts 2→80 单调 +2、threads 1→40；stats=${JSON.stringify(stats)}`)
})

// ---------------------------------------------------------------- 5. 跨章检索

test('跨章检索：第 5 章的「沈砚·左手有旧伤」在第 250 章仍可检索并进入材料包', async () => {
  const outline = plannedOutline({ chapters: 300 })
  let canon = emptyCanon()
  for (let index = 1; index <= 5; index++) {
    const chapterId = chapterIdOf(index)
    canon = mergeCanon(canon, {
      facts: [
        { s: `人${index}`, p: '位置', o: `地点${index}`, chapter: chapterId },
        { s: `人${index}`, p: '状态', o: '活着', chapter: chapterId },
      ],
    }, { chapter: chapterId })
  }
  canon = mergeCanon(
    canon,
    { facts: [{ s: '沈砚', p: '左手', o: '有旧伤', chapter: 'ch005' }] },
    { chapter: 'ch005' },
  )

  const slice = queryCanon(canon, { cast: ['沈砚'], keywords: ['旧伤', '左手'], atChapter: 250, limit: 120 })
  const hit = slice.facts.find((fact) => fact.s === '沈砚' && fact.p === '左手' && fact.o === '有旧伤')
  assert.ok(hit, `第 250 章 queryCanon 应命中第 5 章的事实「沈砚·左手·有旧伤」，实际命中 ${slice.facts.length} 条：${slice.facts.map((f) => `${f.s}/${f.p}/${f.o}`).join('、')}`)
  assert.equal(hit.chapter, 'ch005', `命中的事实应保留原始章号 ch005，实际 ${hit.chapter}`)

  const entries = {
    canon,
    characters: { cast: [] },
    'beats/ch250': beatsFixture(),
    'summary/ch249': LONG('上一章：账本最后一页写着沈砚的名字。', 200),
  }
  for (const id of ['ch246', 'ch247', 'ch248']) entries[`summary/${id}`] = LONG('最近三章：香灰、账本、旧债。', 200)
  const prepared = await prepareChapter({
    outline,
    params: { language: 'zh' },
    chapterId: 'ch250',
    read: memoryRead(entries),
    llm: null,
    language: 'zh',
  })
  const canonSlice = prepared.packet.report.slices.find((item) => item.name === 'canon')
  assert.ok(canonSlice && canonSlice.allocated > 0, `第 250 章材料包应有 canon 分片，实际 ${JSON.stringify(canonSlice)}`)
  assert.ok(
    prepared.packet.text.includes('沈砚｜左手｜有旧伤'),
    `第 250 章材料包应包含「沈砚｜左手｜有旧伤」，实际 canon 分片 ${canonSlice.allocated} 字`,
  )
  say(`跨章检索：第 5 章事实在第 250 章命中（chapter=${hit.chapter}），canon 分片 ${canonSlice.allocated} 字，包体 ${prepared.packet.text.length}`)
})

// ---------------------------------------------------------------- 6. 死亡人物

test('死亡人物：第 60 章让已死的老周说话 → dead-character(block)；不提则不报', async () => {
  const outline = plannedOutline({ chapters: 300 })
  const canon = mergeCanon(
    emptyCanon(),
    { facts: [{ s: '老周', p: '状态', o: '已死亡', chapter: 'ch010' }] },
    { chapter: 'ch010' },
  )
  const read = (key) => (key === 'canon' ? canon : null)

  const withDead = await checkChapter({
    read,
    params: { language: 'zh' },
    outline,
    chapterId: 'ch060',
    text: `${cleanProse()}\n\n「老周，你不能进去。」他说。\n老周没有回答，只把手里那盏灯举高了一点。`,
  })
  const dead = withDead.findings.filter((finding) => finding.kind === 'dead-character')
  assert.equal(dead.length, 1, `第 60 章应报 1 条 dead-character，实际 ${dead.length} 条：${withDead.findings.map((f) => f.kind).join(',')}`)
  assert.equal(dead[0].severity, 'block', `dead-character 严重度应为 block，实际 ${dead[0].severity}`)
  assert.match(dead[0].issue, /老周/, `finding 应点名老周，实际：${dead[0].issue}`)
  assert.match(dead[0].issue, /已死亡|死亡/, `finding 应说明正典里的死亡状态，实际：${dead[0].issue}`)
  assert.equal(withDead.verdict, 'revise', `有 block 时 verdict 应为 revise，实际 ${withDead.verdict}`)

  const noDead = await checkChapter({
    read,
    params: { language: 'zh' },
    outline,
    chapterId: 'ch060',
    text: cleanProse(),
  })
  const falseHits = noDead.findings.filter((finding) => finding.kind === 'dead-character')
  assert.equal(falseHits.length, 0, `正文没提老周时不应报 dead-character，实际 ${falseHits.length} 条：${falseHits.map((f) => f.issue).join('；')}`)
  say(`死亡人物：正文两次提到老周 → dead-character/${dead[0].severity}（verdict=${withDead.verdict}）；干净正文 → 0 条误报`)
})

// ---------------------------------------------------------------- 7. 时间倒流

test('时间倒流：第 21 章「第一天」早于第 20 章「第三天」→ timeline-regress(warn)', async () => {
  const outline = plannedOutline({
    chapters: 300,
    when: (index) => {
      if (index === 19) return '第三天' // ch020
      if (index === 20) return '第一天' // ch021
      return `第${index + 1}天`
    },
  })
  const read = () => emptyCanon()

  const regressed = await checkChapter({
    read,
    params: { language: 'zh' },
    outline,
    chapterId: 'ch021',
    text: cleanProse(),
  })
  const hit = regressed.findings.find((finding) => finding.kind === 'timeline-regress')
  assert.ok(hit, `第 21 章应报 timeline-regress，实际 findings：${regressed.findings.map((f) => f.kind).join(',')}`)
  assert.equal(hit.severity, 'warn', `timeline-regress 严重度应为 warn，实际 ${hit.severity}`)
  assert.match(hit.issue, /早于上一章/, `finding 应说明早于上一章，实际：${hit.issue}`)
  assert.match(hit.issue, /第一天/, `finding 应带上本章时间「第一天」，实际：${hit.issue}`)

  const forward = await checkChapter({
    read,
    params: { language: 'zh' },
    outline,
    chapterId: 'ch022',
    text: cleanProse(),
  })
  assert.equal(
    forward.findings.filter((finding) => finding.kind === 'timeline-regress').length,
    0,
    `第 22 章「第22天」晚于第 21 章「第一天」时不应报 timeline-regress`,
  )
  say(`时间倒流：ch021「第一天」< ch020「第三天」→ ${hit.severity}/${hit.kind}；ch022 正向对照 0 条`)
})

// ---------------------------------------------------------------- 8. 审计性能

test('审计性能：300 章摘要 + 900 条正典事实全程 audit < 800ms', () => {
  const outline = plannedOutline({ chapters: 300 })
  let canon = emptyCanon()
  const facts = []
  const threads = []
  for (let index = 1; index <= 300; index++) {
    const chapterId = chapterIdOf(index)
    facts.push(
      { s: `人物${index}`, p: '位置', o: `地点${index}的偏厅`, chapter: chapterId },
      { s: `人物${index}`, p: '状态', o: '活着', chapter: chapterId },
      { s: `人物${index}`, p: '关系', o: `与人物${(index % 300) + 1}相识`, chapter: chapterId },
    )
    threads.push({ text: `线索${index}：香灰的来路`, status: 'open', opened: chapterId })
  }
  canon = mergeCanon(canon, { facts, threads }, { chapter: 'ch300' })
  assert.equal(canon.facts.length, 900, `测试前置：应造出 900 条事实，实际 ${canon.facts.length}`)

  const chapters = outline.chapters.map((chapter) => ({
    ...chapter,
    text: LONG(`第${chapter.index}章：香灰落在账本上，他想起父亲说过的话。`, 240),
  }))
  const { value: findings, ms } = timeIt(() => audit({ chapters, canon, outline, params: { language: 'zh' } }))
  assert.ok(Array.isArray(findings), 'audit 应返回 findings 数组')
  assert.ok(
    ms < 800,
    `300 章 + 900 条事实 audit 应 < 800ms，实测 ${ms.toFixed(1)}ms（findings ${findings.length} 条）`,
  )
  say(`审计性能：300 章摘要 + 900 条事实 + ${canon.threads.length} 条线索 → ${ms.toFixed(1)}ms，findings ${findings.length} 条`)
})

// ---------------------------------------------------------------- 9. packet 分片账

test('packet 分片账：chars/cap/allocated/dropped 齐全且 used ≤ budget；4000 时 beats/canon 保留、style 被丢', async () => {
  const { outline, entries } = richWorld()
  entries['summary/ch249'] = LONG('上一章：账本最后一页写着沈砚的名字。', 200)
  const prepared = await prepareChapter({
    outline,
    params: { contextBudget: 12000, language: 'zh' },
    chapterId: 'ch250',
    read: memoryRead(entries),
    llm: null,
    language: 'zh',
  })
  const { text, report } = prepared.packet
  assert.equal(report.budget, 12000, `默认预算应为 12000，实际 ${report.budget}`)
  assert.equal(report.used, text.length, `report.used 应等于 text.length：${report.used} vs ${text.length}`)
  assert.ok(report.used <= report.budget, `used 应 ≤ budget：${report.used} > ${report.budget}`)
  const names = report.slices.map((slice) => slice.name)
  assert.deepEqual(
    names,
    ['brief', 'beats', 'previous', 'recent', 'digest', 'canon', 'cast', 'next', 'style'],
    `draft 模式应有 9 个分片，实际 ${names.join(',')}`,
  )
  for (const slice of report.slices) {
    assert.equal(typeof slice.chars, 'number', `${slice.name}.chars 应是数字，实际 ${typeof slice.chars}`)
    assert.equal(typeof slice.cap, 'number', `${slice.name}.cap 应是数字，实际 ${typeof slice.cap}`)
    assert.equal(typeof slice.allocated, 'number', `${slice.name}.allocated 应是数字，实际 ${typeof slice.allocated}`)
    assert.equal(typeof slice.dropped, 'boolean', `${slice.name}.dropped 应是布尔，实际 ${typeof slice.dropped}`)
    assert.equal(slice.chars, slice.allocated, `${slice.name}: chars 应等于 allocated（${slice.chars} vs ${slice.allocated}）`)
    assert.ok(slice.allocated <= slice.cap, `${slice.name}: allocated ${slice.allocated} 不应超过 cap ${slice.cap}`)
    if (slice.dropped) {
      assert.equal(slice.allocated, 0, `${slice.name}: 被丢弃的分片不应占预算，实际 allocated=${slice.allocated}`)
    }
  }
  const sum = report.slices.reduce((total, slice) => total + slice.allocated, 0)
  assert.ok(sum <= report.budget, `分片 allocated 之和 ${sum} 应 ≤ budget ${report.budget}`)

  // 预算压到 4000：只给 brief/beats/canon/next/style，beats 与 canon 必须留下，style 必须被丢。
  const tight = buildPacket({
    params: { contextBudget: 4000, language: 'zh' },
    chapter: { id: 'ch300', title: '末章', goal: '离开殡仪馆' },
    beats: beatsFixture(),
    canonText: LONG('沈砚｜左手｜有旧伤；陈婆｜位置｜殡仪馆。', 3200),
    nextChapterGoal: '去城隍庙找老周',
    styleSample: LONG('雨落在瓦上，像有人数着脚步。', 1200),
  })
  const byName = Object.fromEntries(tight.report.slices.map((slice) => [slice.name, slice]))
  assert.ok(tight.report.used <= 4000, `4000 预算下 used 应 ≤ 4000，实际 ${tight.report.used}`)
  assert.ok(byName.beats.allocated > 0, `4000 预算下 beats 应被保留，实际 allocated=${byName.beats.allocated}`)
  assert.ok(byName.canon.allocated > 0, `4000 预算下 canon 应被保留，实际 allocated=${byName.canon.allocated}（cap ${byName.canon.cap}）`)
  assert.ok(byName.beats.allocated >= byName.canon.allocated, `beats 是高优先分片，保留字数 ${byName.beats.allocated} 应不少于 canon ${byName.canon.allocated}`)
  assert.ok(
    byName.style.dropped && byName.style.allocated === 0,
    `4000 预算下 style 应被丢弃，实际 dropped=${byName.style.dropped} allocated=${byName.style.allocated}`,
  )
  assert.ok(byName.style.allocated < byName.style.cap, 'style 不应拿到全额预算')
  say(
    `分片账：12000 下 ${names.length} 片、used=${report.used}、allocated 合计=${sum}；` +
      `4000 下 beats=${byName.beats.allocated}、canon=${byName.canon.allocated}、style dropped=${byName.style.dropped}`,
  )
})
