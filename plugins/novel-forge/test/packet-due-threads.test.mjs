// packet-due-threads.test.mjs — 到期线索先于正典进入单章材料包。
// 运行：node --test test/packet-due-threads.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { SLICE_SPEC, buildPacket } from '../src/recipes/novel/packet.js'
import { prepareChapter } from '../src/recipes/novel/chapter.js'
import { emptyCanon, mergeCanon } from '../src/recipes/novel/canon.js'
import { buildOutlineSkeleton, mergeVolumeChapters } from '../src/recipes/novel/plan.js'

const HINT = '以上线索已到期，本章必须回应或显式延后'
const DUE_SECTION = '## 到期待收线索'

function rowsFor(count) {
  return Array.from({ length: count }, (_, i) => ({
    title: `章${i + 1}`,
    goal: `目标${i + 1}`,
    conflict: `阻碍${i + 1}`,
    turn: `转折${i + 1}`,
    hook: `钩子${i + 1}`,
    pov: '第三人称限知',
    when: `第${i + 1}天`,
    where: '殡仪馆',
    cast: [],
  }))
}

function plannedOutline({ chapters = 6, per = 6 } = {}) {
  const base = buildOutlineSkeleton({ chapters, chaptersPerVolume: per, language: 'zh' })
  let outline = base
  for (const volume of base.volumes ?? []) {
    outline = mergeVolumeChapters(outline, volume.id, rowsFor(Number(volume.targetChapters) || per))
  }
  return outline
}

function memoryRead(entries = {}) {
  return (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null)
}

/** 取材料包里某个 `## 标题` 段的正文（不含标题行）。 */
function sectionOf(text, title) {
  const marker = `## ${title}`
  const start = text.indexOf(marker)
  if (start < 0) return ''
  const bodyStart = start + marker.length
  const next = text.indexOf('\n\n## ', bodyStart)
  return text.slice(bodyStart, next < 0 ? text.length : next).trim()
}

const beats = {
  goal: '拿到账本',
  conflict: '被陈婆跟踪',
  turn: '账本被调包',
  hook: '香灰再次出现',
  scenes: [{ goal: '潜入殡仪馆', obstacle: '门锁', turn: '门自己开了' }],
}

// ---------------------------------------------------------------- 切片定义

test('dueThreads：独立分片 cap 600，既有 canon 分片值不变', () => {
  const canon = SLICE_SPEC.find((slice) => slice.name === 'canon')
  assert.equal(canon.cap, 3200)
  assert.equal(canon.priority, 3)

  const packet = buildPacket({
    params: { contextBudget: 6000 },
    chapter: { id: 'ch0042', index: 42, title: '香灰' },
    dueThreads: `- 三号柜里的手机（到期：第 42 章）\n${HINT}`,
    mode: 'draft',
  })
  const row = packet.report.slices.find((slice) => slice.name === 'dueThreads')
  assert.ok(row, '缺少 dueThreads 分片')
  assert.equal(row.cap, 600)
  assert.ok(row.chars > 0)
  assert.match(packet.sections.dueThreads, /^## 到期待收线索\n/)
})

// ---------------------------------------------------------------- buildPacket

test('buildPacket：到期线索排在正典之前，且总字符不超 contextBudget', () => {
  const dueThreads = `- 三号柜里的手机（到期：第 42 章）\n${HINT}`
  const packet = buildPacket({
    params: { contextBudget: 12000, wordsPerChapter: 3000, pov: '第三人称限知' },
    chapter: { id: 'ch0042', index: 42, title: '香灰', goal: '在殡仪馆找到账本', conflict: '陈婆堵门' },
    volume: { id: 'v02', title: '第二卷' },
    beats,
    canonText: '林砚：主角，左手受伤。\n陈婆：债主，知道头七的秘密。',
    dueThreads,
    mode: 'draft',
  })

  assert.ok(packet.text.includes(dueThreads), '到期线索与提示行应逐字进入正文')
  const dueAt = packet.text.indexOf(DUE_SECTION)
  const canonAt = packet.text.indexOf('## 正典')
  assert.ok(dueAt >= 0, '缺少到期待收线索分片')
  assert.ok(canonAt >= 0, '缺少正典分片')
  assert.ok(dueAt < canonAt, `到期线索应在正典之前：due=${dueAt} canon=${canonAt}`)
  assert.equal(sectionOf(packet.text, '到期待收线索').includes(HINT), true)
  assert.ok(packet.text.length <= 12000, `packet 超预算：${packet.text.length}`)
  assert.ok(packet.report.used <= 12000)
})

test('buildPacket：预算紧张时到期线索仍先于正典保留', () => {
  const dueThreads = `- 三号柜里的手机（到期：第 42 章）\n${HINT}`
  const packet = buildPacket({
    params: { contextBudget: 1500, wordsPerChapter: 3000, pov: '第三人称限知' },
    chapter: { id: 'ch0042', index: 42, title: '香灰', goal: '在殡仪馆找到账本', conflict: '陈婆堵门' },
    volume: { id: 'v02', title: '第二卷' },
    beats,
    canonText: '林砚：主角，左手受伤。'.repeat(400),
    dueThreads,
    mode: 'draft',
  })

  assert.ok(packet.text.includes('- 三号柜里的手机（到期：第 42 章）'))
  assert.ok(packet.text.includes(HINT))
  assert.ok(packet.text.length <= 1500, `packet 超预算：${packet.text.length}`)
  assert.ok(packet.report.used <= 1500)
  assert.ok(packet.text.indexOf(DUE_SECTION) < packet.text.indexOf('## 正典'))
})

test('buildPacket：没有 dueThreads 时不产生空分片', () => {
  const packet = buildPacket({
    params: { contextBudget: 6000 },
    chapter: { id: 'ch01', index: 1, title: '开头' },
    canonText: '林砚：主角。',
    mode: 'draft',
  })
  assert.equal(packet.text.includes(DUE_SECTION), false)
  assert.equal(packet.sections.dueThreads, undefined)
})

// ---------------------------------------------------------------- prepareChapter

test('prepareChapter：只把到期且未关闭的线索置顶，未来线索与已收线索不进入', async () => {
  const outline = plannedOutline()
  const canon = mergeCanon(
    emptyCanon(),
    {
      threads: [
        { id: 't01', text: '三号柜里的手机', status: 'open', dueIn: 2, opened: 'ch01' },
        { id: 't02', text: '袖口的香灰', status: 'open', dueIn: 5, opened: 'ch01' },
        { id: 't03', text: '已收的旧账', status: 'closed', closedIn: 'ch03', dueIn: 2, opened: 'ch01' },
      ],
    },
    { chapter: 'ch01' },
  )
  const prepared = await prepareChapter({
    outline,
    params: { wordsPerChapter: 3000, pov: '第三人称限知', contextBudget: 6000, language: 'zh' },
    chapterId: 'ch02',
    read: memoryRead({ canon, 'beats/ch02': beats }),
    llm: null,
    language: 'zh',
  })

  const due = sectionOf(prepared.packet.text, '到期待收线索')
  assert.match(due, /三号柜里的手机（到期：第 2 章）/)
  assert.match(due, /以上线索已到期，本章必须回应或显式延后/)
  assert.doesNotMatch(due, /袖口的香灰/, '未到期线索不应进入到期清单')
  assert.doesNotMatch(due, /已收的旧账/, '已关闭线索不应进入到期清单')
  assert.ok(
    prepared.packet.text.indexOf(DUE_SECTION) < prepared.packet.text.indexOf('## 正典'),
    '到期线索应在正典之前',
  )
  assert.ok(prepared.packet.text.length <= 6000, `packet 超预算：${prepared.packet.text.length}`)
  assert.ok(prepared.packet.report.used <= 6000)
})
