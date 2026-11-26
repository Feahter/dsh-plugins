// tool-activation.test.mjs — novel_* 工具的条件注册开关。
// 默认闲置（0 token），只有 activation 白名单里的会话才在 when 里返回 true。
// 全部内存 fake：不联网、不碰磁盘、不调真模型。
// 运行：node --test test/tool-activation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import { registerNovelTools } from '../src/host/tools.js'
import { createActivation } from '../src/host/activation.js'
import { handle } from '../src/host/routes.js'

/** 记录每次 register(definition, options) 的实参个数与内容。 */
function fakeTools() {
  const calls = []
  return {
    calls,
    register(...args) {
      calls.push({ definition: args[0], options: args[1], argCount: args.length })
      return () => {}
    },
  }
}

const fakeEngine = {}
const modelInfo = () => ({ available: true, provider: 'deepseek', model: 'deepseek-v4' })

test('registerNovelTools：16 个工具全部带 options.when', () => {
  const activation = createActivation()
  const tools = fakeTools()
  registerNovelTools(tools, fakeEngine, { activation })

  assert.equal(tools.calls.length, 16)
  for (const call of tools.calls) {
    assert.equal(call.argCount, 2)
    assert.equal(typeof call.options?.when, 'function')
    assert.equal(typeof call.definition?.name, 'string')
    assert.ok(call.definition.name.startsWith('novel_'))
  }
})

test('when：未知会话 false，enable 后 true，disable 后 false', () => {
  const activation = createActivation()
  const tools = fakeTools()
  registerNovelTools(tools, fakeEngine, { activation })
  const { when } = tools.calls[0].options

  assert.equal(when({ agent: { id: 'x' } }), false)
  assert.equal(activation.isActive({ id: 'x' }), false)

  activation.enable('x')
  assert.equal(when({ agent: { id: 'x' } }), true)

  activation.disable('x')
  assert.equal(when({ agent: { id: 'x' } }), false)
})

test('when 会 observe 最近一次求值的会话 id', () => {
  const activation = createActivation()
  const tools = fakeTools()
  registerNovelTools(tools, fakeEngine, { activation })
  const { when } = tools.calls[0].options

  when({ agent: { id: 's1' } })
  assert.equal(activation.state().latest, 's1')

  when({ agent: { id: 's2' } })
  assert.equal(activation.state().latest, 's2')
})

test('enableLatest：没 observe 过返回 NO_SESSION，observe 后启用最近会话', () => {
  const activation = createActivation()
  assert.deepEqual(activation.enableLatest(), { ok: false, code: 'NO_SESSION' })

  activation.observe({ id: 'latest-1' })
  const result = activation.enableLatest()
  assert.equal(result.ok, true)
  assert.equal(result.sessionId, 'latest-1')
  assert.equal(activation.isActive({ id: 'latest-1' }), true)
})

test('disable 不传 id 清空全部', () => {
  const activation = createActivation()
  activation.enable('a')
  activation.enable('b')
  activation.disable()
  assert.deepEqual(activation.state().active, [])
})

test('老宿主兼容：不传 activation 时 register 只收到一个参数', () => {
  const tools = fakeTools()
  registerNovelTools(tools, fakeEngine)

  assert.equal(tools.calls.length, 16)
  for (const call of tools.calls) {
    assert.equal(call.argCount, 1)
    assert.equal(call.options, undefined)
  }
})

test('路由：POST /tools 开启会话后 GET /tools 能看到它', async () => {
  const activation = createActivation()
  const post = await handle(
    { engine: fakeEngine, modelInfo, activation },
    { method: 'POST', path: '/tools', body: { enabled: true, conversationId: 's1' } },
  )
  assert.equal(post.status, 200)
  assert.equal(post.body.tools.latest, null)
  assert.deepEqual(post.body.tools.active, ['s1'])

  const get = await handle(
    { engine: fakeEngine, modelInfo, activation },
    { method: 'GET', path: '/tools' },
  )
  assert.equal(get.status, 200)
  assert.deepEqual(get.body.tools.active, ['s1'])
  assert.equal(activation.isActive({ id: 's1' }), true)
})

test('路由：POST /tools 没有会话可接手时 409 NO_SESSION', async () => {
  const activation = createActivation()
  await assert.rejects(
    () => handle(
      { engine: fakeEngine, modelInfo, activation },
      { method: 'POST', path: '/tools', body: { enabled: true } },
    ),
    error => error.status === 409 && error.code === 'NO_SESSION',
  )
})

test('路由：POST /tools enabled:false 不带 id 清空全部', async () => {
  const activation = createActivation()
  activation.enable('s1')
  activation.enable('s2')
  const result = await handle(
    { engine: fakeEngine, modelInfo, activation },
    { method: 'POST', path: '/tools', body: { enabled: false } },
  )
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.tools.active, [])
})
