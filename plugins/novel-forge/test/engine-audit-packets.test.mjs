// test/engine-audit-packets.test.mjs — 第 2 路（引擎/recipe）检修的回归用例。
// 运行：node --test test/engine-audit*.test.mjs
//
// 覆盖两处缺陷：
//   1) packet.report 从来没有 overBudget 字段，index.js 里两条「材料包超预算」warn 是死分支；
//   2) 分片 cap 记在「渲染后的整块」上（含 `## 标题\n`），而正文生产者都是按 cap 截断的，
//      于是分片填满时 assemble 会把正文最后几个字符再切掉——「…（已截断）」标记或
//      到期线索的提示语被切成半句，且没有任何截断标记。

import test from 'node:test'
import assert from 'node:assert/strict'

import { SLICE_SPEC, buildPacket } from '../src/recipes/novel/packet.js'
import { dueThreadsText } from '../src/recipes/novel/chapter.js'
import { formatCanon } from '../src/recipes/novel/canon.js'
import { characterBrief } from '../src/recipes/novel/ledger.js'
import { fit } from '../src/forge/text.js'

const HINT = '以上线索已到期，本章必须回应或显式延后'
const MARK = '…（已截断）'

const sliceCap = (name) => SLICE_SPEC.find((slice) => slice.name === name).cap

/** 材料包里某个分片渲染后的整块（标题行 + 正文），用于核对 cap 口径。 */
function sectionBlock(packet, name) {
  const spec = SLICE_SPEC.find((slice) => slice.name === name)
  return packet.sections[name] ?? (spec ? '' : '')
}

function baseInput(extra = {}) {
  return {
    params: { contextBudget: 12000, wordsPerChapter: 3000, pov: '第三人称限知' },
    chapter: { id: 'ch0042', index: 42, title: '香灰', goal: '找到账本' },
    beats: { goal: '拿到账本', conflict: '被陈婆跟踪', turn: '账本被调包', hook: '香灰再次出现' },
    ...extra,
  }
}

// ---------------------------------------------------------------- report.overBudget

test('report.overBudget：预算塞爆时为 true，宽松预算时为 false', () => {
  const loose = buildPacket(baseInput({ canonText: '林砚：主角。', dueThreads: '' }))
  assert.equal(loose.report.overBudget, false, '宽松预算下不应标记超预算')

  const packed = buildPacket(
    baseInput({
      params: { contextBudget: 1200, wordsPerChapter: 3000, pov: '第三人称限知' },
      beats: { goal: '拿到账本'.repeat(80), conflict: '被陈婆跟踪'.repeat(80) },
      canonText: '林砚：主角，左手受伤。'.repeat(300),
      castBrief: '林砚（主角）\n陈婆（债主）'.repeat(60),
      nextChapterGoal: '去城隍庙'.repeat(30),
      styleSample: '雨落在瓦上，像有人数着脚步。'.repeat(60),
    }),
  )
  assert.equal(packed.report.overBudget, true, '预算被裁到塞不下时必须标记超预算')
  assert.ok(packed.text.length <= 1200)
})

test('report.overBudget：空材料包不误报', () => {
  const empty = buildPacket({ params: { contextBudget: 12000 }, chapter: { id: 'ch0001' } })
  assert.equal(empty.report.overBudget, false)
})

// ---------------------------------------------------------------- 分片末尾不被无标记切掉

test('到期线索填满 600 字符时，提示语仍然完整（不被 packet 再切掉）', () => {
  const canon = {
    threads: Array.from({ length: 14 }, (_, i) => ({
      id: `t${String(i + 1).padStart(2, '0')}`,
      opened: 'ch0001',
      dueIn: 3,
      status: 'open',
      text: `第${i + 1}条到期待收线索：失踪的信件与那把断掉的钥匙始终没有下落`,
    })),
  }
  const dueThreads = dueThreadsText(canon, { index: 5 })
  assert.ok(dueThreads.endsWith(HINT), '条目本身就该保住提示语')

  const packet = buildPacket(baseInput({ chapter: { id: 'ch0005', index: 5 }, dueThreads }))
  const section = packet.sections.dueThreads ?? ''
  assert.ok(section.endsWith(HINT), `材料包里的提示语被切掉了：${JSON.stringify(section.slice(-30))}`)
  const row = packet.report.slices.find((slice) => slice.name === 'dueThreads')
  assert.ok(row.allocated <= row.cap, `分片整块不应超过 cap：${row.allocated} > ${row.cap}`)
})

test('正典填满 3200 字符时，「…（已截断）」标记不被切掉', () => {
  // pad=3 时 formatCanon 正好把预算用满（3200），是 cap 边界最容易踩到的形状。
  const facts = Array.from({ length: 120 }, (_, i) => ({
    s: `主体${i}`,
    p: '持有',
    o: `${'东西'.repeat(3)}甲甲甲`,
    chapter: `ch${String(i + 1).padStart(4, '0')}`,
  }))
  const canonText = formatCanon(
    { facts, threads: [], rules: [], notes: [], entities: [], timeline: [], invariants: [] },
    { maxChars: 3200 },
  )
  assert.equal(canonText.length, 3200, '构造前提：正典正文正好填满 3200')
  assert.ok(canonText.endsWith(MARK))

  const packet = buildPacket(baseInput({ canonText }))
  const section = packet.sections.canon ?? ''
  assert.ok(section.endsWith(MARK), `材料包里的截断标记被切掉了：${JSON.stringify(section.slice(-20))}`)
  const row = packet.report.slices.find((slice) => slice.name === 'canon')
  assert.ok(row.allocated <= row.cap, `分片整块不应超过 cap：${row.allocated} > ${row.cap}`)
})

test('人物速查与文风样本填满分片时，末尾标记同样保留', () => {
  const cast = Array.from({ length: 8 }, (_, i) => ({
    name: `人物${i}`,
    role: '配角',
    want: '想要一件东西'.repeat(9),
    fear: '怕一件事'.repeat(9),
    secret: '藏着一个秘密'.repeat(9),
    voice: '说话很慢很轻'.repeat(9),
  }))
  const castBrief = characterBrief(cast, [], 1500)
  assert.equal(castBrief.length, 1500, '构造前提：人物速查正好填满 1500')
  const styleSample = fit('雨落在瓦上，像有人数着脚步。'.repeat(100), 1200)
  assert.equal(styleSample.length, 1200, '构造前提：文风样本正好填满 1200')

  const packet = buildPacket(baseInput({ castBrief, styleSample }))
  for (const name of ['cast', 'style']) {
    const block = sectionBlock(packet, name)
    assert.ok(block.endsWith(MARK), `${name} 分片的截断标记被切掉了：${JSON.stringify(block.slice(-20))}`)
    const row = packet.report.slices.find((slice) => slice.name === name)
    assert.ok(row.allocated <= sliceCap(name), `${name} 整块 ${row.allocated} 超过 cap ${sliceCap(name)}`)
  }
})
