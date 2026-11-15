// test/craft-name-tag.test.mjs — P1-7 千字具名密度 / P1-10 对话标签（09 §5.2）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { checkDraft, countCjk } from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 3000 }
const NAME_BLOCK = '林默点头。周野回头。阿棠笑了。林默说好。周野走了。阿棠坐下。'
const CAST = [{ name: '林默' }, { name: '周野' }, { name: '阿棠' }]

function hasKind(result, kind, severity) {
  return result.findings.some(
    (finding) => finding.kind === kind && (severity === undefined || finding.severity === severity),
  )
}

function withCjk(target, block = NAME_BLOCK) {
  const pad = target - countCjk(block)
  assert.ok(pad >= 0, `block 已超过目标字数：${target}`)
  return block + '雨。'.repeat(pad)
}

function pickStats(stats, keys) {
  return Object.fromEntries(keys.map((key) => [key, stats[key]]))
}

test('P1-7 千字一点五名报 note', () => {
  const text = withCjk(1900)
  assert.equal(countCjk(text), 1900)
  const result = checkDraft({ text, params: PARAMS, cast: CAST })

  assert.equal(result.stats.namePer1k, 1.6)
  assert.equal(hasKind(result, 'name-density', 'note'), true)
  const finding = result.findings.find((item) => item.kind === 'name-density')
  assert.equal(finding.where, '全章')
  assert.match(finding.issue, /1\.6/)
  assert.match(finding.issue, /活跃具名 3 人/)
  assert.match(finding.fix, /合并|身份称呼/)
})

test('P1-7 恰好 1.5/千字不报', () => {
  const text = withCjk(2000)
  assert.equal(countCjk(text), 2000)
  const result = checkDraft({ text, params: PARAMS, cast: CAST })

  assert.equal(result.stats.namePer1k, 1.5)
  assert.equal(hasKind(result, 'name-density'), false)
})

test('P1-7 无 cast 台账：不猜人名，只按传入名单算全书密度', () => {
  const text = withCjk(1900)
  const result = checkDraft({ text, params: PARAMS })

  assert.equal(result.stats.namePer1k, 0)
  assert.equal(hasKind(result, 'name-density'), false)
})

test('P1-10 一行里贴两个标签报 warn，issue 带每行个数与命中标签', () => {
  const text = `他说：“${'雨'.repeat(20)}”他说。\n\n`.repeat(3)
  const result = checkDraft({ text, params: PARAMS })

  assert.equal(result.stats.dialogueTags, 6)
  assert.equal(hasKind(result, 'dialogue-tag', 'warn'), true)
  const finding = result.findings.find((item) => item.kind === 'dialogue-tag')
  assert.equal(finding.where, '全章')
  assert.match(finding.issue, /6 个 \/ 3 行/)
  assert.match(finding.issue, /2 个\/行/)
  assert.match(finding.issue, /「说」/)
  assert.match(finding.fix, /动作节拍|删掉/)
})

test('P1-10 一话一标是常态：每 100 字对话标签再高也不报', () => {
  // 短句对话一行 7 字，6 个标签 / 6 行 = 1 个/行；按 100 字算是 50/100 字，
  // 05-R7 的逐字阈值会把这种正常写法判成病，所以判据按行不按字。
  const text = '“走吧。”他说。\n\n'.repeat(6)
  const result = checkDraft({ text, params: PARAMS })

  assert.equal(result.stats.dialogueTags, 6)
  assert.equal(result.stats.dialogueTagPer100Chars, 50)
  assert.equal(hasKind(result, 'dialogue-tag'), false)
})

test('P1-10 每行恰好 1.5 个标签不报', () => {
  const text = '“好。”他说，“走。”他问。\n\n“嗯。”他说。'
  const result = checkDraft({ text, params: PARAMS })

  assert.equal(result.stats.dialogueTags, 3)
  assert.equal(hasKind(result, 'dialogue-tag'), false)
})

test('P1-10 副词标签报 warn：密度未超限也报，命中词进 issue', () => {
  const longLine = '“今天的雨下得真大，路上一个人也没有，我们等雨小一点再走吧。”她望着窗外。\n\n'
  const text = `${longLine.repeat(4)}“好。”他非常平静地说。`
  const result = checkDraft({ text, params: PARAMS })

  assert.ok(result.stats.dialogueTagPer100Chars < 2)
  assert.equal(result.stats.adverbTagCount, 1)
  assert.equal(hasKind(result, 'dialogue-tag', 'warn'), true)
  const finding = result.findings.find((item) => item.kind === 'dialogue-tag')
  assert.match(finding.issue, /副词标签 1 个/)
  assert.match(finding.issue, /100%/)
  assert.match(finding.issue, /非常/)
})

test('P1-10 「说道」只算一个标签，不把「道」重复计数', () => {
  const result = checkDraft({ text: '“你来了。”他说道。', params: PARAMS })

  assert.equal(result.stats.dialogueTags, 1)
  assert.equal(result.stats.adverbTagCount, 0)
})

test('回归：既有 stats 数值不变（新增字段不影响旧口径）', () => {
  const result = checkDraft({ text: '“你来了。”她说。\n\n他点头，走进屋里。', params: PARAMS })
  const existing = {
    cjk: 12,
    dialogueRatio: 0.25,
    paragraphs: 2,
    sceneCount: 1,
    scenePer1k: 83.3,
    sentences: 3,
    avgSentenceLen: 4,
    maxSentenceLen: 7,
    shortSentenceRatio: 100,
    sensoryPer1k: 0,
    abstractEmotionPer1k: 0,
    adverbPer1k: 0,
    universalAdverbPer1k: 0,
    aiMarkerCount: 0,
    aiMarkerPer1k: 0,
    nameDensity: 0,
  }
  assert.deepEqual(pickStats(result.stats, Object.keys(existing)), existing)
  assert.equal(result.stats.namePer1k, 0)
})
