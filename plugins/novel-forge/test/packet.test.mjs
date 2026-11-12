// packet.test.mjs — 通用预算拼装器 + 单章材料包。
// 运行：node --test test/packet.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { assemble } from '../src/forge/budget.js'
import { emptyCanon, mergeCanon, queryCanon, formatCanon } from '../src/recipes/novel/canon.js'
import {
  SLICE_SPEC,
  buildPacket,
  chapterRequirements,
} from '../src/recipes/novel/packet.js'

const SEP = '\n\n'

function sumChars(report) {
  return report.slices.reduce((sum, s) => sum + s.chars, 0)
}

function keptCount(report) {
  return report.slices.filter((s) => s.chars > 0).length
}

function accountingHolds(report, separator = SEP) {
  const expected = sumChars(report) + Math.max(0, keptCount(report) - 1) * separator.length
  return expected === report.used
}

function long(text, chars) {
  return String(text).repeat(Math.ceil(chars / String(text).length)).slice(0, chars)
}

function bigFixture() {
  return {
    params: { wordsPerChapter: 3000, pov: '第三人称限知', tone: '冷、克制', contextBudget: 12000 },
    chapter: {
      id: 'ch0042',
      title: '香灰',
      goal: '在殡仪馆找到父亲的账本',
      conflict: '陈婆堵在门口',
      turn: '账本是空白的',
      hook: '门缝里多了一双眼睛',
      pov: '第三人称限知',
      cast: ['林砚', '陈婆'],
    },
    volume: { id: 'v02', title: '第二卷 守夜人' },
    beats: {
      goal: '拿到账本',
      conflict: '被陈婆跟踪',
      turn: '账本被调包',
      hook: '香灰再次出现',
      rhythm: '紧—缓—紧',
      beats: ['潜入殡仪馆', '翻找抽屉', '撞见守夜人'],
      scenes: [
        { when: '午夜', where: '殡仪馆', goal: '潜入', conflict: '门锁', turn: '门自己开了' },
        { when: '凌晨', where: '停尸间', goal: '找账本', hook: '抽屉里有呼吸声' },
      ],
      notes: '这一章要把香灰线索再压一次。',
    },
    previous: { id: 'ch0041', title: '门缝', hook: '门缝里有人塞进来一撮香灰' },
    previousSummary: long('林砚在殡仪馆守夜，听见走廊尽头有人走动。', 500),
    recentSummaries: [
      { id: 'ch0039', text: long('陈婆第一次来讨债。', 300) },
      { id: 'ch0040', text: long('父亲头七，纸钱烧了整夜。', 300) },
      { id: 'ch0041', text: long('香灰出现在门槛上。', 300) },
    ],
    volumeDigest: long('本卷写守夜人与殡仪馆之间的旧债。', 900),
    canonText: long('林砚：主角，左手受伤。陈婆：债主，知道头七的秘密。', 3000),
    castBrief: long('林砚（主角，左手受伤）\n陈婆（债主，警惕）\n守夜人（身份不明）', 1400),
    styleSample: long('雨落在瓦上，像有人数着脚步。', 1100),
    nextChapterGoal: '去城隍庙找老周问香灰的来路',
    mode: 'draft',
  }
}

// ---------------------------------------------------------------- budget.js

test('assemble：空 slices 返回空文本与完整报告', () => {
  const { text, report } = assemble({ slices: [], budget: 1000, separator: SEP })
  assert.equal(text, '')
  assert.equal(report.budget, 1000)
  assert.equal(report.used, 0)
  assert.equal(report.hardTruncated, false)
  assert.deepEqual(report.slices, [])
})

test('assemble：required 先按 cap 截断并锁定，极小预算下仍在', () => {
  const { text, report } = assemble({
    slices: [
      { name: 'must', text: '必'.repeat(100), cap: 40, required: true },
      { name: 'extra', text: '余'.repeat(500), priority: 1 },
    ],
    budget: 60,
  })
  const must = report.slices.find((s) => s.name === 'must')
  assert.equal(must.chars, 40)
  assert.equal(must.dropped, false)
  assert.equal(text.slice(0, 40), '必'.repeat(40))
  assert.ok(text.length <= 60)
})

test('assemble：低优先级片段先被 drop，report 标记 dropped', () => {
  const { text, report } = assemble({
    slices: [
      { name: 'brief', text: '要求', required: true, cap: 100 },
      { name: 'body', text: '正'.repeat(200), priority: 1, cap: 200 },
      { name: 'next', text: '下章目标', priority: 5 },
      { name: 'style', text: '文风样本', priority: 6 },
    ],
    budget: 120,
  })
  const next = report.slices.find((s) => s.name === 'next')
  const style = report.slices.find((s) => s.name === 'style')
  assert.equal(next.dropped, true)
  assert.equal(style.dropped, true)
  assert.equal(next.chars, 0)
  assert.ok(!text.includes('下章目标'))
  assert.ok(!text.includes('文风样本'))
  assert.ok(text.length <= 260)
})

test('assemble：按 priority 升序分配，同 priority 保持输入顺序', () => {
  const { report } = assemble({
    slices: [
      { name: 'p5', text: '五'.repeat(30), priority: 5 },
      { name: 'p1', text: '一'.repeat(30), priority: 1 },
      { name: 'p1b', text: '乙'.repeat(30), priority: 1 },
      { name: 'p3', text: '三'.repeat(30), priority: 3 },
    ],
    budget: 80,
  })
  const kept = report.slices.filter((s) => s.chars > 0).map((s) => s.name)
  assert.deepEqual(kept, ['p1', 'p1b', 'p3'])
  assert.equal(report.slices.find((s) => s.name === 'p5').dropped, true)
})

test('assemble：cap 截断片段并标记 truncated', () => {
  const { text, report } = assemble({
    slices: [{ name: 'a', text: '字'.repeat(50), cap: 20 }],
    budget: 1000,
  })
  const row = report.slices[0]
  assert.equal(row.chars, 20)
  assert.equal(row.allocated, 20)
  assert.equal(row.truncated, true)
  assert.equal(text, '字'.repeat(20))
})

test('assemble：title 输出 ## 标题 行且计入长度', () => {
  const { text, report } = assemble({
    slices: [{ name: 'a', title: '标题', text: '正文', cap: 100 }],
    budget: 1000,
  })
  assert.equal(text, '## 标题\n正文')
  assert.equal(report.slices[0].chars, text.length)
  assert.equal(report.used, text.length)
})

test('assemble：chars 之和 + 分隔符精确等于 used', () => {
  const { text, report } = assemble({
    slices: [
      { name: 'a', title: '甲', text: '甲'.repeat(30), required: true, cap: 100 },
      { name: 'b', text: '乙'.repeat(80), priority: 2, cap: 100 },
      { name: 'c', text: '丙'.repeat(80), priority: 3, cap: 100 },
    ],
    budget: 180,
  })
  assert.equal(accountingHolds(report), true)
  assert.equal(text.length, report.used)
})

test('assemble：同输入两次调用 text 全等（纯函数）', () => {
  const input = {
    slices: [
      { name: 'a', title: '甲', text: '内容'.repeat(20), required: true, cap: 120 },
      { name: 'b', text: '材料'.repeat(60), priority: 2, cap: 200 },
      { name: 'c', text: '尾'.repeat(20), priority: 6 },
    ],
    budget: 300,
  }
  const first = assemble(input)
  const second = assemble(input)
  assert.equal(first.text, second.text)
  assert.deepEqual(first.report, second.report)
})

test('assemble：required 自身超预算时兜底截断并标记 hardTruncated', () => {
  const { text, report } = assemble({
    slices: [{ name: 'must', text: '必'.repeat(100), required: true }],
    budget: 50,
  })
  assert.equal(text.length, 50)
  assert.equal(report.used, 50)
  assert.equal(report.hardTruncated, true)
  assert.equal(report.slices[0].chars, 50)
  assert.equal(accountingHolds(report), true)
})

test('assemble：缺省 cap 为 Infinity', () => {
  const { report } = assemble({ slices: [{ name: 'a', text: 'x' }], budget: 100 })
  assert.equal(report.slices[0].cap, Infinity)
  assert.equal(report.slices[0].chars, 1)
})

// ---------------------------------------------------------------- packet.js

test('SLICE_SPEC：严格匹配 §5.2 的 cap/priority/required', () => {
  assert.deepEqual(
    SLICE_SPEC.map((s) => [s.name, s.cap, s.priority, s.required]),
    [
      ['brief', 900, 0, true],
      ['beats', 2500, 1, false],
      ['previous', 800, 2, false],
      ['recent', 1200, 2, false],
      ['digest', 1000, 3, false],
      ['canon', 3200, 3, false],
      ['cast', 1500, 4, false],
      ['next', 300, 5, false],
      ['style', 1200, 6, false],
    ],
  )
})

test('buildPacket：任意 budget（4000/8000/12000/20000）都硬性不超预算', () => {
  for (const budget of [4000, 8000, 12000, 20000]) {
    const input = bigFixture()
    input.params.contextBudget = budget
    const { text, report } = buildPacket(input)
    assert.ok(text.length <= budget, `budget ${budget}: ${text.length}`)
    assert.equal(report.used, text.length)
    assert.equal(report.budget, budget)
    assert.equal(accountingHolds(report), true)
  }
})

test('buildPacket({}) 不崩，只保留必需的写作要求分片', () => {
  const { text, report, sections } = buildPacket({})
  assert.equal(typeof text, 'string')
  assert.equal(report.used, text.length)
  assert.deepEqual(Object.keys(sections), ['brief'])
  assert.ok(text.includes('## 写作要求'))
  assert.equal(report.budget, 12000)
})

test('buildPacket：低优先级 style/next 在 4000 预算下先被 drop', () => {
  const input = bigFixture()
  input.params.contextBudget = 4000
  const { text, report } = buildPacket(input)
  const byName = Object.fromEntries(report.slices.map((s) => [s.name, s]))
  assert.equal(byName.style.dropped, true)
  assert.equal(byName.next.dropped, true)
  assert.equal(byName.brief.dropped, false)
  assert.ok(!text.includes('## 文风'))
  assert.ok(!text.includes('## 下一章目标'))
})

test('buildPacket：极小预算下 required brief 仍在（被截断）', () => {
  const { text, report } = buildPacket({
    params: { contextBudget: 150 },
    chapter: { id: 'ch0005', title: '夜行', goal: '找到账本' },
  })
  const brief = report.slices.find((s) => s.name === 'brief')
  assert.ok(brief)
  assert.equal(brief.dropped, false)
  assert.ok(brief.chars > 0)
  assert.ok(text.length <= 150)
  assert.ok(text.startsWith('## 写作要求'))
})

test('buildPacket：第 5 章与第 500 章同 budget 包大小差 < 5%', () => {
  const base = bigFixture()
  const small = buildPacket({
    ...base,
    chapter: { ...base.chapter, id: 'ch0005' },
  })
  const large = buildPacket({
    ...base,
    chapter: { ...base.chapter, id: 'ch0500' },
  })
  const diff = Math.abs(small.text.length - large.text.length)
  const ratio = diff / Math.max(small.text.length, large.text.length)
  assert.ok(ratio < 0.05, `diff ratio ${ratio}`)
})

test('buildPacket：revise 模式把【需修正】插在 brief 之后且为 required', () => {
  const input = bigFixture()
  input.mode = 'revise'
  input.revisionFindings = ['第 3 段视角越界：写了陈婆的内心', '禁语「突然」出现 2 次']
  const { text, report, sections } = buildPacket(input)
  const names = report.slices.map((s) => s.name)
  assert.equal(names[0], 'brief')
  assert.equal(names[1], 'revision')
  const revision = report.slices[1]
  assert.equal(revision.cap, 1500)
  assert.equal(revision.dropped, false)
  assert.ok(text.includes('## 需修正'))
  assert.ok(text.includes('视角越界'))
  assert.ok(sections.revision)
})

test('chapterRequirements：默认值与 chapter 覆盖', () => {
  assert.deepEqual(chapterRequirements({}), {
    words: 3000,
    pov: '第三人称限知',
    banned: ['……', '突然', '不由得'],
  })
  const custom = chapterRequirements({
    params: { wordsPerChapter: 5000, pov: '第一人称' },
    chapter: { pov: '第三人称全知', words: 2000 },
  })
  assert.equal(custom.words, 2000)
  assert.equal(custom.pov, '第三人称全知')
  assert.deepEqual(custom.banned, ['……', '突然', '不由得'])
})

test('buildPacket：previous 含钩子，recent 渲染最近三章', () => {
  const { text } = buildPacket({
    params: { contextBudget: 12000 },
    chapter: { id: 'ch0010', title: '夜行', goal: '找账本' },
    previous: { id: 'ch0009', title: '门缝', hook: '门缝里塞进来一撮香灰' },
    previousSummary: '林砚守了一夜。',
    recentSummaries: [
      { id: 'ch0007', text: '旧一' },
      { id: 'ch0008', text: '旧二' },
      { id: 'ch0009', text: '旧三' },
      { id: 'ch0010', text: '最新' },
    ],
  })
  assert.ok(text.includes('## 上一章结尾'))
  assert.ok(text.includes('钩子：门缝里塞进来一撮香灰'))
  assert.ok(text.includes('## 最近三章'))
  assert.ok(text.includes('旧二'))
  assert.ok(text.includes('旧三'))
  assert.ok(text.includes('最新'))
  assert.ok(!text.includes('旧一'))
})

test('buildPacket：beats 对象拼成目标/冲突/转折/钩子/节奏与场景', () => {
  const { text, sections } = buildPacket({
    params: { contextBudget: 12000 },
    chapter: { id: 'ch0010', title: '夜行', goal: '找账本' },
    beats: {
      goal: '拿到账本',
      conflict: '陈婆阻拦',
      turn: '账本空白',
      hook: '香灰再现',
      rhythm: '紧—缓',
      scenes: [{ goal: '潜入', conflict: '门锁' }],
      extra: '额外信息',
    },
  })
  for (const token of ['目标：拿到账本', '冲突：陈婆阻拦', '转折：账本空白', '钩子：香灰再现', '节奏：紧—缓', '场景 1', '额外信息']) {
    assert.ok(text.includes(token), token)
  }
  assert.ok(sections.beats.includes('目标：拿到账本'))
})

test('buildPacket：sections 与正文块逐字一致、report 可核对', () => {
  const input = bigFixture()
  input.params.contextBudget = 8000
  const { text, report, sections } = buildPacket(input)
  const blocks = Object.values(sections)
  assert.ok(blocks.length > 0)
  assert.equal(blocks.join(SEP), text)
  assert.equal(accountingHolds(report), true)
  for (const row of report.slices) {
    if (row.chars > 0) assert.ok(sections[row.name].length === row.chars)
  }
})

// ---------------------------------------------------------------- canon 分节预算（T3）

test('buildPacket：第 500 章仍带未回收线索，且总长 ≤ budget', () => {
  let canon = emptyCanon()
  for (let ch = 1; ch <= 500; ch += 1) {
    const id = `ch${String(ch).padStart(3, '0')}`
    canon = mergeCanon(
      canon,
      {
        facts: [
          { s: `人物${ch % 40}`, p: '状态', o: `在第${ch}章留下的旧伤`, chapter: id, tags: ch % 9 === 0 ? ['沈砚'] : [] },
          { s: `物件${ch % 30}`, p: '位置', o: `第${ch}章被移动过`, chapter: id },
        ],
      },
      { chapter: id },
    )
  }
  canon = mergeCanon(
    canon,
    {
      threads: Array.from({ length: 8 }, (_, i) => ({
        text: `线索${i + 1}：账册第${i + 3}页的名字`,
        opened: `ch00${i + 1}`,
        status: 'open',
      })),
    },
    { chapter: 'ch500' },
  )
  const slice = queryCanon(canon, {
    cast: ['沈砚', '陈婆'],
    keywords: ['账册'],
    atChapter: 'ch500',
    limit: 120,
  })
  const canonText = formatCanon(slice, { maxChars: 3200 })
  const input = bigFixture()
  input.chapter = { ...input.chapter, id: 'ch0500', index: 500, title: '第五百章' }
  input.canonText = canonText
  input.params.contextBudget = 12000
  const { text } = buildPacket(input)
  assert.ok(text.includes('【未回收线索】'), 'ch500 的 canon 分片必须带线索区块')
  assert.ok(text.includes('账册第3页'), '至少一条线索正文要进材料包')
  assert.ok(text.length <= 12000, `ch500 packet ${text.length} 超出 12000`)
})
