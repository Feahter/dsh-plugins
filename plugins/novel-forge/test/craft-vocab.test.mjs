import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkDraft } from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 3000 }
const NEW_KINDS = ['vocab-flat', 'dialogue-flat', 'dialogue-no-question']

function hasKind(result, kind) {
  return result.findings.some((finding) => finding.kind === kind)
}

function findingOf(result, kind) {
  return result.findings.find((finding) => finding.kind === kind)
}

const REPEAT_CLAUSE = '他走进屋子看了她一眼又走了出去。' // 15 个汉字

test('bigramTtr 与 charVariety 按汉字口径计算，保留 4 位小数', () => {
  const { stats } = checkDraft({ text: '他来了。他走了。', params: PARAMS })
  assert.equal(stats.cjk, 6)
  // 二字组：他来/来了/他去/走了，4 个全不重复
  assert.equal(stats.bigramTtr, 1)
  // 汉字：他/来/了/他/走/了，6 个里 4 个不重复
  assert.equal(stats.charVariety, 0.6667)
})

test('二字组不跨标点造组，标点前后各算各的', () => {
  const { stats } = checkDraft({ text: '他来。来了。', params: PARAMS })
  // 两段汉字串各 2 字，各只有 1 个二字组：他来 / 来了
  assert.equal(stats.bigramTtr, 1)
  // 汉字：他/来/来/了，4 个里 3 个不重复
  assert.equal(stats.charVariety, 0.75)
})

test('topBigrams 取前 5，排除 cast 人名与功能停用组', () => {
  const text = '老周老周老周。一个又一个。他来了。'
  const { stats } = checkDraft({
    text,
    params: PARAMS,
    cast: [{ name: '老周', role: '主角' }],
  })
  assert.ok(stats.topBigrams.length <= 5)
  const grams = stats.topBigrams.map((item) => item.gram)
  assert.ok(!grams.includes('老周'), `人名二字组不该进 topBigrams：${grams.join('/')}`)
  assert.ok(!grams.includes('一个'), `停用组不该进 topBigrams：${grams.join('/')}`)
  for (const item of stats.topBigrams) {
    assert.equal(typeof item.gram, 'string')
    assert.ok(item.count > 0)
  }
  for (let index = 1; index < stats.topBigrams.length; index += 1) {
    assert.ok(stats.topBigrams[index - 1].count >= stats.topBigrams[index].count)
  }
})

test('vocab-flat：≥800 字的重复文本触发 note，四要素齐全且带具体数字', () => {
  const text = REPEAT_CLAUSE.repeat(60) // 900 汉字
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.cjk, 900)
  assert.ok(result.stats.bigramTtr < 0.6)
  const finding = findingOf(result, 'vocab-flat')
  assert.ok(finding, '应触发 vocab-flat')
  assert.equal(finding.severity, 'note')
  assert.equal(finding.where, '全章')
  assert.match(finding.issue, /二字组多样性 \d/)
  assert.match(finding.issue, /低于 0\.6/)
  assert.ok(finding.fix.length > 0)
})

test('vocab-flat：<800 字的短章直接跳过（宁漏勿误报）', () => {
  const text = REPEAT_CLAUSE.repeat(40) // 600 汉字
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.cjk, 600)
  assert.ok(result.stats.bigramTtr < 0.6)
  assert.ok(!hasKind(result, 'vocab-flat'))
})

test('fixtures 里的成稿不触发三条新 note', () => {
  for (const name of ['skill-story.md', 'baseline-story.md']) {
    const text = readFileSync(new URL(`./fixtures/craft/${name}`, import.meta.url), 'utf8')
    const result = checkDraft({ text, params: PARAMS })
    for (const kind of NEW_KINDS) {
      assert.ok(!hasKind(result, kind), `${name} 不应触发 ${kind}`)
    }
  }
})
