// test/craft-adverb.test.mjs — 06-R3 的 9 个万能副词：独立词表、独立指标、3/千字 note。
import test from 'node:test'
import assert from 'node:assert/strict'

import { ADVERBS, UNIVERSAL_ADVERBS, checkDraft, countCjk } from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 3000 }
const FILLER = '雨水顺着瓦檐往下淌，石板路上没有人。'
const NINE = '她缓缓起身，微微一笑，轻轻点头，淡淡应了一声，静静站着，默默看着，悄悄走了，悠悠叹气，徐徐回头。'
const THREE = '她缓缓起身，微微一笑，轻轻点头。'

function buildText(prefix) {
  let text = prefix
  while (countCjk(text) < 3000) text += FILLER
  return text
}

test('万能副词：词表是 06 的 9 个，且不混进 ADVERBS 的 10 个', () => {
  assert.deepEqual(UNIVERSAL_ADVERBS, ['缓缓', '微微', '轻轻', '淡淡', '静静', '默默', '悄悄', '悠悠', '徐徐'])
  assert.equal(ADVERBS.length, 10)
  for (const word of UNIVERSAL_ADVERBS) assert.ok(!ADVERBS.includes(word), `${word} 不应混进 ADVERBS`)
})

test('万能副词：3000 字 9 次（3/千字）→ note', () => {
  const text = buildText(NINE)
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(countCjk(text) >= 3000)
  assert.ok(result.stats.universalAdverbPer1k >= 3, `实际 ${result.stats.universalAdverbPer1k}`)
  const finding = result.findings.find((item) => item.kind === 'adverb-universal')
  assert.ok(finding)
  assert.equal(finding.severity, 'note')
  assert.ok(!result.findings.some((item) => item.kind === 'adverb'), '两套词表互不串味')
})

test('万能副词：3000 字 3 次（1/千字）→ 不报', () => {
  const text = buildText(THREE)
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(result.stats.universalAdverbPer1k < 3)
  assert.ok(!result.findings.some((item) => item.kind === 'adverb-universal'))
})
