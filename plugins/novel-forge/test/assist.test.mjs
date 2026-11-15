// assist.test.mjs — 写作助手路由与 prompt 契约。
// 假 engine 记录 generate 实参，不联网、不碰磁盘。
// 运行：node --test test/assist.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import { handle } from '../src/host/routes.js'
import {
  runAssist,
  validateAssistInput,
  buildPremisePrompt,
  buildTonePrompt,
  buildTitlePrompt,
} from '../src/host/assist.js'

function makeFakeEngine(reply = '  改好的故事核  ') {
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

test('polish-premise：返回 trim 文本，带 sessionId/maxTokens/纪律词与输入', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, {
    task: 'polish-premise',
    text: '殡仪馆夜班，他发现死者名单里有自己',
    genre: '悬疑',
    tone: '冷峻',
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.text, '改好的故事核')

  const [args] = engine.calls
  assert.equal(args.sessionId, 'dsh-forge-assist')
  assert.equal(args.maxTokens, 900)
  assert.match(args.system, /不新增/)
  assert.ok(args.user.includes('殡仪馆夜班，他发现死者名单里有自己'))
  assert.match(args.user, /体裁：悬疑/)
  assert.match(args.user, /文风：冷峻/)
})

test('polish-tone：maxTokens 900，空的 genre/tone 不写行', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, { task: 'polish-tone', text: '冷、硬、克制' })
  assert.equal(result.status, 200)
  assert.equal(result.body.text, '改好的故事核')

  const [args] = engine.calls
  assert.equal(args.maxTokens, 900)
  assert.equal(args.sessionId, 'dsh-forge-assist')
  assert.match(args.system, /不新增/)
  assert.ok(args.user.includes('冷、硬、克制'))
  assert.equal(args.user.includes('体裁：'), false)
  assert.equal(args.user.includes('文风：'), false)
})

test('title：maxTokens 200，系统提示要求三行书名', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, { task: 'title', text: '殡仪馆夜班' })
  assert.equal(result.status, 200)
  assert.equal(result.body.text, '改好的故事核')

  const [args] = engine.calls
  assert.equal(args.maxTokens, 200)
  assert.ok(args.user.includes('殡仪馆夜班'))
  assert.match(args.system, /3 个书名/)
  assert.match(args.system, /不要编号/)
})

test('未知 task：400 invalid_params', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, { task: 'rewrite-everything', text: '一段话' }),
    error => error.status === 400 && error.code === 'invalid_params',
  )
  assert.equal(engine.calls.length, 0)
})

test('空 text：400 invalid_params', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, { task: 'title', text: '   ' }),
    error => error.status === 400 && error.code === 'invalid_params',
  )
  assert.equal(engine.calls.length, 0)
})

test('text 超过 4000 字：400 invalid_params', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, { task: 'title', text: '字'.repeat(4001) }),
    error => error.status === 400 && error.code === 'invalid_params',
  )
  assert.equal(engine.calls.length, 0)
})

test('engine.llm 缺失：503 LLM_UNAVAILABLE', async () => {
  await assert.rejects(
    () => call({}, { task: 'title', text: '殡仪馆夜班' }),
    error => error.status === 503 && error.code === 'LLM_UNAVAILABLE',
  )
})

test('engine.llm 没有 generate：503 LLM_UNAVAILABLE', async () => {
  await assert.rejects(
    () => call({ llm: {} }, { task: 'title', text: '殡仪馆夜班' }),
    error => error.status === 503 && error.code === 'LLM_UNAVAILABLE',
  )
})

test('模型返回空白：LLM_EMPTY', async () => {
  const engine = makeFakeEngine('   ')
  await assert.rejects(
    () => call(engine, { task: 'polish-tone', text: '冷' }),
    error => error.code === 'LLM_EMPTY',
  )
})

test('模型用代码块包裹时剥掉围栏', async () => {
  const engine = makeFakeEngine('```text\n改好的故事核\n```')
  const output = await runAssist({ engine, task: 'polish-premise', text: '一个故事' })
  assert.equal(output, '改好的故事核')
})

test('三个 prompt builder：system 每条 ≤600 字、合计 ≤1200 字', () => {
  const builders = [buildPremisePrompt, buildTonePrompt, buildTitlePrompt]
  const systems = builders.map(builder => builder({ text: '一个故事', genre: '悬疑', tone: '冷' }).system)
  for (const system of systems) {
    assert.ok(system.length <= 600, `system 超长：${system.length}`)
    assert.match(system, /不新增/)
  }
  assert.ok(systems.reduce((sum, system) => sum + system.length, 0) <= 1200)
})

test('validateAssistInput：直接调用时给出可读文案', () => {
  assert.equal(validateAssistInput({ task: 'title', text: '正常' }), null)
  assert.match(validateAssistInput({ task: 'nope', text: '正常' }), /任务/)
  assert.match(validateAssistInput({ task: 'title', text: '' }), /不能为空/)
})
