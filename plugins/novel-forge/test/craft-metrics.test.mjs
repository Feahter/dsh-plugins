// test/craft-metrics.test.mjs — 与 story-craft/story_check.py 对齐的量化指标。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ADVERBS,
  ABSTRACT_EMOTION_WORDS,
  AI_CLICHES,
  AI_PATTERNS,
  SENSORY_WORDS,
  checkDraft,
  countCjk,
  dialogueRatio,
  distinctNameDensity,
} from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 3000 }

function kinds(result) {
  return result.findings.filter((finding) => finding.kind)
}

function hasKind(result, kind, severity) {
  return result.findings.some(
    (finding) => finding.kind === kind && (severity === undefined || finding.severity === severity),
  )
}

// 长句（每句 35 字上下）+ 抽象情绪词 + 没有任何感官词，正文 ≥800 字。
function longAbstractText() {
  const emotions = ['焦虑', '疲惫', '迷茫', '孤独', '委屈', '失落', '沮丧', '烦躁', '不安', '难过']
  const base = '他坐在办公室里反复思考今天会议上每个人说过的话却始终没有找到问题的答案'
  const sentences = Array.from({ length: 24 }, (_, index) => base + (index < 8 ? emotions[index] : '') + '。')
  return sentences.join('')
}

// 短句 + 具体动作与感官细节，没有抽象情绪词，正文 ≥800 字。
function shortSensoryText() {
  const sentences = [
    '他推开门。', '冷风扑在脸上。', '走廊的灯闪了一下。', '脚步声从尽头传来。',
    '他握紧手里的钥匙。', '钥匙很硬。', '墙皮粗糙。', '水珠顺着窗玻璃往下滑。',
    '外面有股霉味。', '他听见自己的呼吸。', '电梯响了。', '门缝里透出白光。',
    '地板踩上去吱呀作响。', '有人咳了一声。', '空气里有股烟味。', '他抬头看灯。',
    '灯泡在轻轻晃。', '影子贴在墙上。', '走廊尽头是黑的。', '他停下脚步。',
  ]
  let text = ''
  for (let index = 0; countCjk(text) < 900; index += 1) text += sentences[index % sentences.length]
  return text
}

// 对话占比约 10%：叙述占大多数，少量引语，恰好落进 8%–15%。
function tenPercentDialogueText() {
  const narration = [
    '雨从傍晚开始下，街灯在水面上摊开一片模糊的黄，他沿着巷子慢慢走。',
    '屋檐往下滴水，他数着水滴落地的声音，不知道还要等多久。',
    '远处有车经过，轮胎压过积水，声音拖得很长。',
  ]
  const quote = '“我在这儿等你很久了，你怎么才来。”'
  let text = ''
  for (let index = 0; index < 20; index += 1) {
    text += narration[index % narration.length] + (index % 4 === 0 ? quote : '')
  }
  return text
}

test('指标：三张词表与 AI 模式表都已导出且非空', () => {
  for (const list of [SENSORY_WORDS, ABSTRACT_EMOTION_WORDS, ADVERBS]) {
    assert.ok(Array.isArray(list))
    assert.ok(list.length > 0)
  }
  assert.ok(Array.isArray(AI_PATTERNS))
  assert.ok(AI_PATTERNS.length >= 9)
  for (const pattern of AI_PATTERNS) {
    assert.ok(pattern.re instanceof RegExp)
    assert.equal(typeof pattern.label, 'string')
    assert.ok(pattern.re.global, 'AI_PATTERNS 的正则必须带 g 标记')
  }
  // 新表不能挤进 AI_CLICHES：现有测试仍断言 13 条。
  assert.equal(AI_CLICHES.length, 13)
})

test('指标：长句 + 抽象情绪 + 无感官词 → 句长/情绪/感官三条 warn', () => {
  const text = longAbstractText()
  assert.ok(countCjk(text) >= 800)
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(hasKind(result, 'sentence-length', 'warn'), `缺少句长 warn：${kinds(result).map((f) => f.kind)}`)
  assert.ok(hasKind(result, 'emotion', 'warn'), `缺少情绪 warn：${kinds(result).map((f) => f.kind)}`)
  assert.ok(hasKind(result, 'sensory', 'warn'), `缺少感官 warn：${kinds(result).map((f) => f.kind)}`)
})

test('指标：短句 + 具体动作/感官 → 句长/情绪/感官都不报', () => {
  const text = shortSensoryText()
  assert.ok(countCjk(text) >= 800)
  const result = checkDraft({ text, params: PARAMS })
  for (const kind of ['sentence-length', 'emotion', 'sensory']) {
    assert.ok(!hasKind(result, kind), `不应出现 ${kind}：${kinds(result).map((f) => f.kind)}`)
  }
})

test('指标：「不是……而是……」→ AI腔 warn', () => {
  const result = checkDraft({ text: '他不是不想去，而是不知道该怎么面对她。', params: PARAMS })
  assert.ok(hasKind(result, 'ai-pattern', 'warn'))
  const finding = result.findings.find((item) => item.kind === 'ai-pattern')
  assert.match(finding.issue, /不是…而是/)
})

test('指标：对话占比 10% → 对话 note，且不报 <8% 的 warn', () => {
  const text = tenPercentDialogueText()
  const ratio = dialogueRatio(text)
  assert.ok(ratio >= 0.08 && ratio < 0.15, `合成文本对话比应落进 8%–15%，实际 ${ratio}`)
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(hasKind(result, 'dialogue', 'note'))
  assert.ok(!result.findings.some((finding) => finding.kind === 'dialogue' && finding.severity === 'warn'))
})

test('指标：7 个名字各出现 2 次、约 1500 字 → 认知负荷 note', () => {
  const names = ['林晚', '沈砚', '顾遥', '苏禾', '江迟', '陆宁', '白榆']
  const filler = '雨落在青石板上，声音很轻，巷子深处没有人，只有一盏灯在风里晃。'
  let text = names.map((name) => `${name}走了两步，又停下。`).join('')
  text += names.map((name) => `后来${name}没有再说话。`).join('')
  while (countCjk(text) < 1500) text += filler

  const density = distinctNameDensity(text, names)
  assert.equal(density.names, 7)
  assert.ok(density.per1500 > 5)

  const cast = names.map((name) => ({ name, role: '配角' }))
  const result = checkDraft({ text, params: PARAMS, cast })
  assert.ok(hasKind(result, 'name-density', 'note'))
})

test('指标：stats 新字段都是有限数；空正文不除零', () => {
  const text = shortSensoryText()
  const { stats } = checkDraft({ text, params: PARAMS })
  const fields = [
    'sentences',
    'avgSentenceLen',
    'maxSentenceLen',
    'shortSentenceRatio',
    'sensoryPer1k',
    'abstractEmotionPer1k',
    'adverbPer1k',
    'aiMarkerCount',
    'nameDensity',
  ]
  for (const field of fields) {
    assert.equal(typeof stats[field], 'number', `${field} 应为数字`)
    assert.ok(Number.isFinite(stats[field]), `${field} 应为有限数`)
  }
  for (const field of ['cjk', 'dialogueRatio', 'paragraphs', 'sceneCount']) {
    assert.ok(Number.isFinite(stats[field]), `原有字段 ${field} 应保持为有限数`)
  }

  const empty = checkDraft({ text: '   \n\n  ', params: PARAMS })
  for (const field of [...fields, 'cjk']) {
    assert.equal(empty.stats[field], 0, `空正文的 ${field} 应为 0`)
  }
  assert.ok(Array.isArray(empty.findings))
})
