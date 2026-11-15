// test/craft-ending.test.mjs — 08-C2 开篇 / 08-C3 感官五桶 / 08-C4 + 06-R6 章末落点。
import test from 'node:test'
import assert from 'node:assert/strict'

import { SENSORY_BUCKETS, SENSORY_WORDS, checkDraft } from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 3000 }

function hasKind(result, kind, severity) {
  return result.findings.some(
    (finding) => finding.kind === kind && (severity === undefined || finding.severity === severity),
  )
}

function endingFindings(result) {
  return result.findings.filter((finding) => String(finding.kind).startsWith('ending-'))
}

test('P1-4 开篇：前 3 句只铺环境、无冲突动作 → opening note', () => {
  const result = checkDraft({
    text: '夜色压下来。风从街道尽头吹过。窗外没有一盏灯。',
    params: PARAMS,
  })
  assert.equal(hasKind(result, 'opening', 'note'), true)
})

test('P1-4 开篇：首句对话+动作 → 不报', () => {
  const result = checkDraft({
    text: '“快跑！”他推开门冲进雨里。',
    params: PARAMS,
  })
  assert.equal(hasKind(result, 'opening'), false)
})

test('P1-5 五桶：视觉占八成 → sensory-vision note', () => {
  const result = checkDraft({
    text: '白光落在红墙上，影子黑而长，窗框亮得刺眼。',
    params: PARAMS,
  })
  assert.equal(hasKind(result, 'sensory-vision', 'note'), true)
  assert.equal(result.stats.sensoryBuckets.visualRatio, 1)
})

test('P1-5 五桶：五桶各命中 → 不报', () => {
  const result = checkDraft({
    text: '他听见铃声，闻到霉味，指尖冰凉，背上全是汗，眼前一片红。',
    params: PARAMS,
  })
  assert.equal(hasKind(result, 'sensory-vision'), false)
  const buckets = result.stats.sensoryBuckets
  for (const name of Object.keys(SENSORY_BUCKETS)) {
    assert.ok(buckets[name] >= 1, `${name} 桶应至少命中一次`)
  }
})

test('P1-5 词表：五桶恰好切分 SENSORY_WORDS（parity 保护）', () => {
  const flat = Object.values(SENSORY_BUCKETS).flat().sort()
  assert.deepEqual(flat, [...SENSORY_WORDS].sort())
})

test('P1-6/P1-11 末句「他终于明白了一切。」→ 只报 ending-summary 一条', () => {
  const result = checkDraft({
    text: '雨停之后，他站在门口。他终于明白了一切。',
    params: PARAMS,
  })
  const endings = endingFindings(result)
  assert.equal(endings.length, 1)
  assert.equal(endings[0].kind, 'ending-summary')
  assert.equal(endings[0].severity, 'note')
})

test('P1-6 落点：末句动作「他推开门冲了出去。」→ 不报', () => {
  const result = checkDraft({
    text: '他推开门冲了出去。',
    params: PARAMS,
  })
  assert.equal(endingFindings(result).length, 0)
})

test('P1-6 落点：无动作的「了。」内省收尾 → ending-mode', () => {
  const result = checkDraft({
    text: '灯灭了。',
    params: PARAMS,
  })
  assert.equal(hasKind(result, 'ending-mode', 'note'), true)
})
