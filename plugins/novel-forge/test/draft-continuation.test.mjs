// 续写测试：长章撞到输出上限时，用半截稿当锚点接着写。
// 用假 generate，不联网、不碰磁盘。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateWithContinuation,
  joinProse,
  tailOfProse,
  trimOverlap,
} from '../src/recipes/novel/continuation.js'

function truncated(partial) {
  const err = new Error('模型输出被截断')
  err.code = 'LLM_TRUNCATED'
  err.detail = { maxTokens: 3520, chars: partial.length, kind: 'length', text: partial }
  return err
}

function fakeGenerate(script) {
  const calls = []
  return {
    calls,
    async generate(spec) {
      calls.push(spec)
      const step = script[Math.min(calls.length - 1, script.length - 1)]
      if (typeof step === 'function') return step(spec)
      if (step instanceof Error) throw step
      return { text: step }
    },
  }
}

const SPEC = { system: '你是小说作者。', user: '写第一章：雨夜。', maxTokens: 3920, temperature: 0.9 }

test('一次写完：只调一次，正文原样返回', async () => {
  const gen = fakeGenerate(['他推开门，雨声灌了进来。'])
  const result = await generateWithContinuation({ generate: gen.generate, spec: SPEC })
  assert.equal(result.parts, 1)
  assert.equal(result.truncated, false)
  assert.equal(result.text, '他推开门，雨声灌了进来。')
  assert.equal(gen.calls.length, 1)
  assert.equal(gen.calls[0], SPEC)
})

test('截断一次：带半截稿续写，拼接后去重断点句', async () => {
  const first = '雨夜。他站在门口，雨水顺着伞骨往下滴。'
  const cont = '他站在门口，雨水顺着伞骨往下滴。门里有人叫他的名字。'
  const gen = fakeGenerate([truncated(first), cont])
  const result = await generateWithContinuation({
    generate: gen.generate,
    spec: SPEC,
    maxParts: 3,
    targetChars: 1600,
  })
  assert.equal(result.parts, 2)
  assert.equal(result.truncated, false)
  // 断点句只留一次
  assert.equal(result.text.match(/雨水顺着伞骨往下滴/g).length, 1)
  assert.match(result.text, /门里有人叫他的名字/)
  // 第二次请求必须把续写指令和上文结尾带上，且 system 不变
  assert.equal(gen.calls[1].system, SPEC.system)
  assert.match(gen.calls[1].user, /【续写指令】/)
  assert.match(gen.calls[1].user, /--- 上文结尾 ---/)
  assert.match(gen.calls[1].user, /还要写大约 \d+ 字/)
})

test('续到底仍被截断：抛 LLM_TRUNCATED，带回已拼出的正文', async () => {
  const gen = fakeGenerate([truncated('第一段。'), truncated('第二段。'), truncated('第三段。')])
  await assert.rejects(
    () =>
      generateWithContinuation({
        generate: gen.generate,
        spec: SPEC,
        maxParts: 1,
      }),
    (err) => {
      assert.equal(err.code, 'LLM_TRUNCATED')
      assert.equal(err.detail.partsAttempted, 2)
      assert.ok(err.detail.partialChars > 0)
      assert.match(err.partialText, /第一段/)
      assert.match(err.partialText, /第二段/)
      return true
    },
  )
  assert.equal(gen.calls.length, 2)
})

test('半截稿为空：没有锚点，直接抛，不空转', async () => {
  const gen = fakeGenerate([truncated('')])
  await assert.rejects(
    () => generateWithContinuation({ generate: gen.generate, spec: SPEC }),
    (err) => err.code === 'LLM_TRUNCATED',
  )
  assert.equal(gen.calls.length, 1)
})

test('非截断错误原样抛出，不吞成续写', async () => {
  const boom = new Error('闸门关了')
  boom.code = 'LLM_AUTH'
  const gen = fakeGenerate([boom])
  await assert.rejects(
    () => generateWithContinuation({ generate: gen.generate, spec: SPEC }),
    (err) => err.code === 'LLM_AUTH',
  )
})

test('tailOfProse：短文本原样，长文本从句子边界起头', () => {
  assert.equal(tailOfProse('太短。'), '太短。')
  const long = `${'甲'.repeat(500)}。${'乙'.repeat(600)}`
  const tail = tailOfProse(long, 600)
  assert.ok(tail.length <= 600)
  assert.ok(!tail.startsWith('甲'))
  assert.ok(tail.startsWith('乙'))
  // 句子边界离末尾太近时退回硬切，不报错也不返回空
  assert.equal(tailOfProse(`${'甲'.repeat(800)}。最后一句。`, 600).length, 600)
})

test('trimOverlap：重叠 12 字以上才切，太短不动', () => {
  assert.equal(trimOverlap('一二三四五六七八九十十一十二', '一二三四五六七八九十十一十二'), '')
  assert.equal(trimOverlap('前面很长的一句话。', '短'), '短')
  assert.equal(joinProse('甲段。', '乙段。'), '甲段。\n\n乙段。')
})

// ---- 集成：走真实 draft 阶段，第一枪截断后续写，整章不该失败 ----

import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { createScriptedPrompts, createFakeCtx, sampleOutlineV2, sampleBeats, SAMPLE_PARAMS } from './fixtures/novel-fixtures.mjs'

test('draft 阶段：第一枪被截断时续写拼接，不整章失败', async () => {
  const recipe = createNovelRecipe({ prompts: createScriptedPrompts() })
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, wordsPerChapter: 1600 },
    item: chapter,
    artifacts: {
      outline: { kind: 'json', content: outline },
      [`beats/${chapter.id}`]: { kind: 'json', content: sampleBeats(chapter.id) },
    },
    outputs: [
      () => {
        throw truncated('他推开门，雨声灌了进来。')
      },
      {
        text: '门里有人叫他的名字。\n<<<SUMMARY>>>\n沈砚回到殡仪馆，听见死者叫出他父亲的名字。\n<<<CANON>>>\n{"facts":[],"threads":[]}',
      },
    ],
  })
  const stage = recipe.stages.find((item) => item.id === 'draft')
  const result = await stage.run(ctx)
  const draft = result.artifacts[`draft/${chapter.id}`]?.content ?? ctx.read(`draft/${chapter.id}`)?.content
  assert.match(String(draft), /雨声灌了进来/)
  assert.match(String(draft), /门里有人叫他的名字/)
  // 第二枪必须带上续写指令
  assert.match(String(ctx.calls[1]?.user), /【续写指令】/)
})

test('draft 阶段：一枪连正文都没吐（推理烧光预算）时，换「直接开写」再要一次', async () => {
  const recipe = createNovelRecipe({ prompts: createScriptedPrompts() })
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, wordsPerChapter: 3000 },
    item: chapter,
    artifacts: {
      outline: { kind: 'json', content: outline },
      [`beats/${chapter.id}`]: { kind: 'json', content: sampleBeats(chapter.id) },
    },
    outputs: [
      () => {
        throw truncated('')
      },
      {
        text: '第二枪终于有正文了。\n<<<SUMMARY>>>\n沈砚查清父亲的名字。\n<<<CANON>>>\n{"facts":[],"threads":[]}',
      },
    ],
  })
  const stage = recipe.stages.find((item) => item.id === 'draft')
  const result = await stage.run(ctx)
  const draft = String(result.artifacts[`draft/${chapter.id}`]?.content ?? '')
  assert.match(draft, /第二枪终于有正文了/)
  const proseCalls = ctx.calls.filter((call) => call.label === 'draft')
  assert.equal(proseCalls.length, 2)
  assert.match(String(proseCalls[1].user), /直接写正文第一句/)
})

// ---- 2026-11-22 事故回归：正文调用必须关思考，否则 4500 字的章还没开写就撞输出上限 ----

test('draft 阶段：正文调用带 reasoningEffort=off，续写也带', async () => {
  const recipe = createNovelRecipe({ prompts: createScriptedPrompts() })
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, wordsPerChapter: 1600 },
    item: chapter,
    artifacts: {
      outline: { kind: 'json', content: outline },
      [`beats/${chapter.id}`]: { kind: 'json', content: sampleBeats(chapter.id) },
    },
    outputs: [
      () => {
        throw truncated('他推开门，雨声灌了进来。')
      },
      {
        text: '门里有人叫他的名字。\n<<<SUMMARY>>>\n沈砚回到殡仪馆，听见死者叫出他父亲的名字。\n<<<CANON>>>\n{"facts":[],"threads":[]}',
      },
    ],
  })
  const stage = recipe.stages.find((item) => item.id === 'draft')
  await stage.run(ctx)
  const proseCalls = ctx.calls.filter((call) => call.label === 'draft')
  assert.equal(proseCalls.length, 2)
  for (const call of proseCalls) assert.equal(call.reasoningEffort, 'off')
})

test('draft 阶段：空正文截断后的「直接开写」那一枪同样关思考', async () => {
  const recipe = createNovelRecipe({ prompts: createScriptedPrompts() })
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, wordsPerChapter: 3000 },
    item: chapter,
    artifacts: {
      outline: { kind: 'json', content: outline },
      [`beats/${chapter.id}`]: { kind: 'json', content: sampleBeats(chapter.id) },
    },
    outputs: [
      () => {
        throw truncated('')
      },
      { text: '第二枪终于有正文了。\n<<<SUMMARY>>>\n沈砚查清父亲的名字。\n<<<CANON>>>\n{"facts":[],"threads":[]}' },
    ],
  })
  const stage = recipe.stages.find((item) => item.id === 'draft')
  await stage.run(ctx)
  const proseCalls = ctx.calls.filter((call) => call.label === 'draft')
  assert.equal(proseCalls.length, 2)
  for (const call of proseCalls) assert.equal(call.reasoningEffort, 'off')
})
