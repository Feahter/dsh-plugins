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
    'universalAdverbPer1k',
    'aiMarkerCount',
    'aiMarkerPer1k',
    'nameDensity',
    'scenePer1k',
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

// ---- P0-2 场景软切：没有 ***/※※，只靠空行与段首时间/地点信号 ----
test('指标：无分隔符、三处段首「第二天」→ sceneCount 4', () => {
  const text = [
    '他推开门，屋里没有人。',
    '第二天他回到办公室，桌上多了一封信。',
    '第二天傍晚，雨停了，他在楼下等她。',
    '第二天清晨，她来了，带着一只旧箱子。',
  ].join('\n\n')
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.sceneCount, 4)
  assert.ok(hasKind(result, 'scene', 'note'), `缺少场景密度 note：${kinds(result).map((f) => f.kind)}`)

  const withBeats = checkDraft({ text, params: PARAMS, beats: { scenes: [{ cast: [] }, { cast: [] }] } })
  assert.equal(withBeats.stats.sceneCount, 2, 'beats.scenes 优先于正文软切')
})

// ---- P0-3 AI 标记：区间合并，长框架里的词只算一次 ----
test('指标：长框架内重叠的 AI 词只计一次', () => {
  const result = checkDraft({ text: '空气仿佛凝固了。', params: PARAMS })
  assert.equal(result.stats.aiMarkerCount, 1)
  assert.ok(hasKind(result, 'ai-density', 'warn'))
})

test('指标：成批套词合并为一条 warn，保留密度和排比读数', () => {
  const text = '他缓缓推门，似乎听见一丝风声。那不是脚步声，而是门轴响了。'
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(hasKind(result, 'ai-cliche', 'warn'))
  for (const kind of ['ai-density', 'ai-pattern']) {
    const finding = result.findings.find((item) => item.kind === kind)
    assert.equal(finding?.severity, 'note')
    assert.match(finding.issue, /已计入上条 AI 腔统计/)
  }
})

test('指标：抽象情绪超过 12/千字只报 warn', () => {
  const result = checkDraft({ text: '她焦虑不安，感到难过。', params: PARAMS })
  assert.ok(result.stats.abstractEmotionPer1k > 12)
  assert.deepEqual(result.findings.filter((f) => f.kind === 'emotion').map((f) => f.severity), ['warn'])
})

// ---- P0-4 抽象情绪：>3/千字只 note，>6 warn ----
test('指标：抽象情绪约 4/千字 → 只有 note，不升 warn/block', () => {
  const filler = '雨落在青石板上声音很轻'
  let text = ''
  while (countCjk(text) < 1900) text += filler
  text += '焦虑疲惫迷茫孤独焦虑疲惫迷茫孤独'
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(
    result.stats.abstractEmotionPer1k > 3 && result.stats.abstractEmotionPer1k <= 6,
    `密度应落在 3–6：${result.stats.abstractEmotionPer1k}`,
  )
  const emotion = result.findings.filter((finding) => finding.kind === 'emotion')
  assert.deepEqual(emotion.map((finding) => finding.severity), ['note'])
})

// ---- P0-5 对话上限：>45% 只 note ----
test('指标：对话 50% → 只有 note，不加 block', () => {
  const quote = '“我们今天去河边看柳树，顺便把船修好。”'
  const narration = '他把工具箱放在门槛上，抬头看了看天。'
  const text = (quote + narration).repeat(12)
  assert.ok(dialogueRatio(text) > 0.45, `对话比应 >0.45：${dialogueRatio(text)}`)
  const result = checkDraft({ text, params: PARAMS })
  const dialogue = result.findings.filter((finding) => finding.kind === 'dialogue')
  assert.ok(dialogue.some((finding) => finding.severity === 'note'))
  assert.ok(!dialogue.some((finding) => finding.severity === 'block'))
})

// ---- P0-6 引号格式：按行栈配对 ----
test('指标：全角引号混用与未闭合各报一条 note', () => {
  const result = checkDraft({ text: '“你来了。\n\n她点头。\n\n「走吧。」', params: PARAMS })
  const mix = result.findings.filter((finding) => finding.kind === 'quote-mix')
  const unclosed = result.findings.filter((finding) => finding.kind === 'quote-unclosed')
  assert.equal(mix.length, 1)
  assert.equal(unclosed.length, 1)
  assert.equal(mix[0].severity, 'note')
  assert.equal(unclosed[0].severity, 'note')
})

test('指标：对话引号内缺句末标点 → note', () => {
  const result = checkDraft({ text: '“你来了”她说。', params: PARAMS })
  const finding = result.findings.find((item) => item.kind === 'quote-punct')
  assert.ok(finding)
  assert.equal(finding.severity, 'note')
})

// ---- P1 非回归：感官只判下限，刷满不报 ----
test('指标：视觉词刷满不产生感官 warn', () => {
  const filler = '白光落在红墙上，影子黑而长，窗框亮得刺眼。'
  let text = ''
  while (countCjk(text) < 900) text += filler
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(result.stats.sensoryPer1k > 2)
  assert.ok(!hasKind(result, 'sensory'))
})
