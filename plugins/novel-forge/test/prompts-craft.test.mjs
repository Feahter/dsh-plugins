import test from 'node:test'
import assert from 'node:assert/strict'

import { createPrompts } from '../src/recipes/novel/prompts/zh.js'
import { createFakeCtx } from './fixtures/novel-fixtures.mjs'

const STAGES = [
  'pitch',
  'premise',
  'bible',
  'characters',
  'spine',
  'opener',
  'volumeChapters',
  'beats',
  'draft',
  'summary',
  'canonPatch',
  'review',
  'revise',
  'blurb',
]

const SYSTEM_LIMIT = 2500

test('14 个 builder 都能用假 ctx 调用，system 均不超过 2500 字符', () => {
  const prompts = createPrompts()
  const lengths = []

  for (const stage of STAGES) {
    const build = prompts[stage]
    assert.equal(typeof build, 'function', `${stage} 不是 builder`)

    const out = build(createFakeCtx())
    assert.equal(typeof out.system, 'string', `${stage} 的 system 不是字符串`)
    assert.equal(typeof out.user, 'string', `${stage} 的 user 不是字符串`)

    lengths.push([stage, out.system.length])
    assert.ok(
      out.system.length <= SYSTEM_LIMIT,
      `${stage} 的 system 有 ${out.system.length} 字符，超过 ${SYSTEM_LIMIT}`
    )
  }

  console.log('\nsystem 长度（上限 %d）：', SYSTEM_LIMIT)
  for (const [stage, length] of lengths) console.log('  %s: %d', stage.padEnd(16), length)

  assert.equal(lengths.length, STAGES.length)
})

test('premise：读者诊断、三种读法、故事核、核心物件都进了 system；user 契约含新字段', () => {
  const prompts = createPrompts()
  const out = prompts.premise(createFakeCtx())

  for (const keyword of ['三种读法', '读者', '故事核', '物件']) {
    assert.ok(out.system.includes(keyword), `premise system 缺「${keyword}」`)
  }

  assert.ok(out.user.includes('readers'), 'premise user 契约缺 readers 字段')
  assert.ok(out.user.includes('alternates'), 'premise user 契约缺 alternates 字段')
})

test('draft：预期三段式、落点三选一、一个场景一设定都在；且不出现「不是…而是」', () => {
  const prompts = createPrompts()
  const out = prompts.draft(createFakeCtx())

  for (const keyword of ['预期', '落点', '一个场景']) {
    assert.ok(out.system.includes(keyword), `draft system 缺「${keyword}」`)
  }

  assert.ok(!out.system.includes('不是…而是'), 'draft system 里出现了它自己要禁的「不是…而是」')
})

test('review：三闸、机器读数与修复动作都在 system 里', () => {
  const prompts = createPrompts()
  const out = prompts.review(createFakeCtx())

  for (const keyword of ['认知负荷', '预期', '自我嵌入', '机器读数']) {
    assert.ok(out.system.includes(keyword), `review system 缺「${keyword}」`)
  }

  assert.ok(out.user.includes('【机器读数】'), 'review user 缺【机器读数】段')
  assert.ok(out.user.includes('无机器读数'), 'review user 在无读数时缺显式兜底')
  assert.match(out.system, /逐字.*8–120/)
  assert.match(out.user, /findings\[\]\.quote/)
  assert.match(out.user, /"quote"\s*:\s*"[^"\n]+"/)
})

test('review：机器读数按 ctx.craftStats 渲染成读者可用的数字', () => {
  const prompts = createPrompts()
  const ctx = createFakeCtx()
  // 用 checkDraft 的真实 stats 形状，不手写别名键。
  ctx.craftStats = {
    cjk: 3200,
    paragraphs: 41,
    sceneCount: 6,
    sentences: 210,
    avgSentenceLen: 18.4,
    maxSentenceLen: 41,
    shortSentenceRatio: 32.5,
    dialogueRatio: 0.32,
    sensoryPer1k: 7.1,
    abstractEmotionPer1k: 2.2,
    adverbPer1k: 4.5,
    aiMarkerCount: 1,
    nameDensity: 2.3,
  }

  const out = prompts.review(ctx)
  for (const expected of [
    '全章 3200 字',
    '平均句长 18.4 字',
    '最长句 41 字',
    '对话比 32%',
    '感官密度 7.1/千字',
    '抽象情绪密度 2.2/千字',
    'AI 标记 1 处',
    '活跃人名 2.3 个/1500 字',
  ]) {
    assert.ok(out.user.includes(expected), `review user 未渲染「${expected}」`)
  }
})

test('review：0 是有效读数，不能被当成缺失隐藏', () => {
  const prompts = createPrompts()
  const ctx = createFakeCtx()
  ctx.craftStats = {
    cjk: 1500,
    paragraphs: 20,
    sceneCount: 4,
    sentences: 80,
    avgSentenceLen: 12,
    maxSentenceLen: 24,
    shortSentenceRatio: 40,
    dialogueRatio: 0,
    sensoryPer1k: 5,
    abstractEmotionPer1k: 0,
    adverbPer1k: 3,
    aiMarkerCount: 0,
    nameDensity: 0,
  }

  const out = prompts.review(ctx)
  assert.ok(out.user.includes('AI 标记 0 处'), 'AI 标记 0 处被隐藏')
  assert.ok(out.user.includes('抽象情绪密度 0/千字'), '抽象情绪 0 被隐藏')
  assert.ok(out.user.includes('对话比 0%'), '对话比 0 被隐藏')
})

test('revise：修改顺序为 结构 → 场景 → 句子 → 字词', () => {
  const prompts = createPrompts()
  const out = prompts.revise(createFakeCtx())

  const start = out.system.indexOf('修改顺序')
  assert.ok(start >= 0, 'revise system 缺「修改顺序」')

  const orderBlock = out.system.slice(start)
  const positions = ['结构', '场景', '句子', '字词'].map((word) => {
    const at = orderBlock.indexOf(word)
    assert.ok(at >= 0, `revise system 缺「${word}」`)
    return [word, at]
  })

  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i - 1][1] < positions[i][1],
      `revise 顺序错误：${positions[i - 1][0]} 应排在 ${positions[i][0]} 之前`
    )
  }
})

test('新条款：段长与章末落点、beats 单场信息与 function、人物 need/wound/lie/exit 都在', () => {
  const prompts = createPrompts()
  const ctx = createFakeCtx()

  const draft = prompts.draft(ctx)
  for (const keyword of ['段落中位 20–80 字', '不许连续三段同长', '章末停在动作或画面']) {
    assert.ok(draft.system.includes(keyword), `draft system 缺「${keyword}」`)
  }

  const beats = prompts.beats(ctx)
  for (const keyword of ['每场只新增一个信息或一个人物', '同场有台词的具名角色 ≤4', 'scenes[].function']) {
    assert.ok(beats.user.includes(keyword), `beats user 契约缺「${keyword}」`)
  }
  assert.ok(beats.user.includes('"function":'), 'beats 示例缺 function 字段')

  const characters = prompts.characters(ctx)
  for (const field of ['need', 'wound', 'lie', 'exit']) {
    assert.ok(
      characters.user.includes(`cast[].${field}`),
      `characters user 契约缺 cast[].${field}`
    )
    assert.ok(
      characters.user.includes(`"${field}":`),
      `characters 示例缺 ${field} 字段`
    )
  }
})
