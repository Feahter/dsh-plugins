// assist-excerpt-expand.test.mjs — C3 选段润色 / B3 正文扩写 的 prompt 契约与确定性验收。
// 假 engine 记录 generate 实参，不联网、不碰磁盘。
// 运行：node --test test/assist-excerpt-expand.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import { handle } from '../src/host/routes.js'
import {
  ASSIST_TASKS,
  checkExpansion,
  runAssist,
  validateAssistInput,
  buildPassagePrompt,
  buildExpandPrompt,
} from '../src/host/assist.js'

function makeFakeEngine(reply = '  改好的正文  ') {
  const calls = []
  return {
    calls,
    llm: {
      generate: async args => {
        calls.push(args)
        return { text: reply }
      },
    },
  }
}

function call(engine, body) {
  return handle(
    { engine, modelInfo: () => ({ available: true }) },
    { method: 'POST', path: '/assist', query: {}, body },
  )
}

/** 用「字」补齐到恰好 n 个非空白字符。 */
function padTo(text, n) {
  const body = String(text)
  const current = body.replace(/\s+/g, '').length
  return body + '字'.repeat(Math.max(0, n - current))
}

const PASSAGE = '殡仪馆的灯管闪了三下，沈砚把名单翻到最后一页。'

test('ASSIST_TASKS 含 C3/B3 两个新任务', () => {
  assert.ok(ASSIST_TASKS.includes('polish-passage'))
  assert.ok(ASSIST_TASKS.includes('expand-scene'))
})

test('polish-passage：system 写全三条硬约束，user 带原文/意图/目标字数', async () => {
  const engine = makeFakeEngine()
  const output = await runAssist({
    engine,
    task: 'polish-passage',
    text: PASSAGE,
    intent: '更冷、更克制',
    genre: '悬疑',
    tone: '冷峻',
  })
  assert.equal(output, '改好的正文')

  const [args] = engine.calls
  assert.equal(args.sessionId, 'dsh-forge-assist')
  // ① 不改专名 ② 不改事实 ③ 控字数
  assert.match(args.system, /不新增或改动人名、地名、专名/)
  assert.match(args.system, /不改变既有事实与情节/)
  assert.match(args.system, /严格控制在目标字数内/)
  assert.match(args.system, /±15%/)
  // user 原文 + 目标字数 + 意图
  assert.ok(args.user.includes(PASSAGE))
  assert.match(args.user, /目标字数：原文 \d+ 字/)
  assert.match(args.user, /润色意图：更冷、更克制/)
  assert.match(args.user, /体裁：悬疑/)
  assert.match(args.user, /文风：冷峻/)
})

test('expand-scene：system 写全三条硬约束，user 带原文与目标字数', async () => {
  const engine = makeFakeEngine()
  const output = await runAssist({
    engine,
    task: 'expand-scene',
    text: '沈砚在殡仪馆值夜班，听见冷藏柜里有人敲。',
    targetChars: 1000,
    genre: '悬疑',
    tone: '冷峻',
  })
  assert.equal(output, '改好的正文')

  const [args] = engine.calls
  assert.equal(args.sessionId, 'dsh-forge-assist')
  assert.match(args.system, /不新增或改动人名、地名、专名/)
  assert.match(args.system, /不改变既有事实与情节/)
  assert.match(args.system, /严格控制在目标字数内/)
  assert.match(args.system, /800–1200/)
  assert.ok(args.user.includes('沈砚在殡仪馆值夜班，听见冷藏柜里有人敲。'))
  assert.match(args.user, /目标字数：1000 字/)
  assert.match(args.user, /体裁：悬疑/)
  assert.match(args.user, /文风：冷峻/)
})

test('expand-scene：targetChars 缺省/越界收敛到 800–1200', () => {
  assert.match(buildExpandPrompt({ text: '细纲' }).user, /目标字数：800 字/)
  assert.match(buildExpandPrompt({ text: '细纲', targetChars: 300 }).user, /目标字数：800 字/)
  assert.match(buildExpandPrompt({ text: '细纲', targetChars: 5000 }).user, /目标字数：1200 字/)
})

test('未知任务仍报「不支持的写作任务」', async () => {
  assert.equal(validateAssistInput({ task: 'rewrite-everything', text: '一段话' }), '不支持的写作任务')
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, { task: 'rewrite-everything', text: '一段话' }),
    error => error.status === 400 && error.code === 'invalid_params' && /不支持的写作任务/.test(error.message),
  )
  assert.equal(engine.calls.length, 0)
})

test('checkExpansion：900 字成稿且专名在 → ok', () => {
  const draft = padTo(`${PASSAGE}沈砚合上名单。`, 900)
  const result = checkExpansion(draft, { names: ['沈砚'] })
  assert.equal(result.chars, 900)
  assert.deepEqual(result.outside, [])
  assert.deepEqual(result.missingNames, [])
  assert.equal(result.ok, true)
})

test('checkExpansion：700 字 → outside 命中 below-min', () => {
  const draft = padTo(PASSAGE, 700)
  const result = checkExpansion(draft)
  assert.equal(result.chars, 700)
  assert.deepEqual(result.outside, ['below-min'])
  assert.equal(result.ok, false)
})

test('checkExpansion：超过 1200 字 → outside 命中 above-max', () => {
  const result = checkExpansion(padTo(PASSAGE, 1201))
  assert.deepEqual(result.outside, ['above-max'])
  assert.equal(result.ok, false)
})

test('checkExpansion：把「沈砚」写成「沈砚之」→ missingNames 命中', () => {
  const draft = padTo('沈砚之推门进来。', 900)
  const result = checkExpansion(draft, { names: ['沈砚'] })
  assert.equal(result.chars, 900)
  assert.deepEqual(result.outside, [])
  assert.deepEqual(result.missingNames, ['沈砚'])
  assert.equal(result.ok, false)
})

test('checkExpansion：只改表达、专名照抄 → 不误报', () => {
  const draft = padTo('沈砚推门进来，沈砚没有说话。', 900)
  const result = checkExpansion(draft, { names: ['沈砚', '殡仪馆'] })
  assert.deepEqual(result.missingNames, ['殡仪馆'])
})

test('两个新任务的 system ≤900 字，maxTokens 与仓库默认输出上限同量级', () => {
  const passage = buildPassagePrompt({ text: PASSAGE, intent: '更冷' })
  const expand = buildExpandPrompt({ text: '一句细纲', targetChars: 1000 })
  for (const prompt of [passage, expand]) {
    assert.ok(prompt.system.length <= 900, `system 超长：${prompt.system.length}`)
  }
  // 输入上限 4000 字，输出同量级；不设 16000/32000 这类超大预算。
  assert.ok(passage.maxTokens >= 1200 && passage.maxTokens <= 4096)
  assert.ok(expand.maxTokens >= 1200 && expand.maxTokens <= 4096)
})
