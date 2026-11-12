// LLM 网关测试：重试分类、空闲超时、流式累积、JSON 提取、取消。
// 用假 service，不联网、不碰磁盘。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlmGateway } from '../src/forge/llm.js'

/** 造一个假 service：calls 记录每次 stream 的参数，respond 决定这一枪吐什么。 */
function fakeService(respond) {
  const calls = []
  return {
    calls,
    async prepareCall(config, signal) {
      return {
        config,
        async stream(args) {
          calls.push({ config, args, signal })
          const index = calls.length - 1
          return respond(index, args)
        },
      }
    },
  }
}

function textStream(pieces, { finish = { kind: 'stop' }, usage } = {}) {
  return (async function* () {
    for (const piece of pieces) yield { type: 'text-delta', text: piece }
    yield { type: 'finish', reason: finish, usage }
  })()
}

const MODEL = () => 'acme/model-x'
const fast = { retryDelays: [1, 1], maxRetries: 2 }

test('正常流：累积文本、上报 usage 与模型', async () => {
  const service = fakeService(() => textStream(['你', '好'], { usage: { inputTokens: 12, outputTokens: 3 } }))
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  const result = await gw.generate({ user: '写一句', maxTokens: 100 })
  assert.equal(result.text, '你好')
  assert.equal(result.model, 'model-x')
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3 })
  assert.equal(service.calls.length, 1)
  assert.equal(service.calls[0].config.provider, 'acme')
  assert.equal(service.calls[0].args.maxTokens, 100)
})

test('永久性配置错误不重试：直接 LLM_AUTH，且给出配置指引', async () => {
  const service = fakeService(() => (async function* () {
    yield {
      type: 'finish',
      reason: { kind: 'error', message: 'llm: no API key', failure: { code: 'MISSING_CREDENTIAL' } },
    }
  })())
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  await assert.rejects(
    () => gw.generate({ user: 'x' }),
    (err) => {
      assert.equal(err.code, 'LLM_AUTH')
      assert.match(err.message, /API key|模型/)
      return true
    },
  )
  assert.equal(service.calls.length, 1, '永久性错误不该重试')
})

test('瞬时错误重试后成功：总共三次调用', async () => {
  const service = fakeService((index) => {
    if (index < 2) {
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'error', message: '上游 500' } }
      })()
    }
    return textStream(['好'])
  })
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  const result = await gw.generate({ user: 'x' })
  assert.equal(result.text, '好')
  assert.equal(service.calls.length, 3)
})

test('空文本：加倍 maxTokens 再试，第二次成功', async () => {
  const service = fakeService((index) => {
    if (index === 0) return textStream(['   '])
    return textStream(['正文'])
  })
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  const result = await gw.generate({ user: 'x', maxTokens: 2000 })
  assert.equal(result.text, '正文')
  assert.equal(service.calls.length, 2)
  assert.equal(service.calls[1].args.maxTokens, 4000)
})

test('一直空文本：抛 LLM_EMPTY，且不超过重试上限', async () => {
  const service = fakeService(() => textStream(['']))
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  await assert.rejects(() => gw.generate({ user: 'x', maxTokens: 100 }), (err) => err.code === 'LLM_EMPTY')
  assert.equal(service.calls.length, 3)
})

test('空闲超时：模型不出字时抛 LLM_TIMEOUT，而不是无限等', async () => {
  const service = fakeService(() => (async function* () {
    // 永不产出
    await new Promise(() => {})
  })())
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast, idleTimeoutMs: 40 })
  const started = Date.now()
  await assert.rejects(
    () => gw.generate({ user: 'x' }),
    (err) => err.code === 'LLM_TIMEOUT',
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2000, `应在空闲超时后很快失败，实际 ${elapsed}ms`)
})

test('外部取消：抛 LLM_ABORTED，不写内容', async () => {
  const controller = new AbortController()
  const service = fakeService(() => (async function* () {
    await new Promise(resolve => setTimeout(resolve, 5))
    yield { type: 'text-delta', text: '半句' }
  })())
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast, signal: controller.signal })
  const pending = gw.generate({ user: 'x' })
  setTimeout(() => controller.abort(), 1)
  await assert.rejects(() => pending, (err) => err.code === 'LLM_ABORTED')
})

test('JSON 模式：能抠出被代码块包裹的 JSON，坏 JSON 抛 LLM_PARSE', async () => {
  const ok = createLlmGateway({
    service: fakeService(() => textStream(['好的：\n```json\n{"a":1}\n```'])),
    resolveModel: MODEL,
    ...fast,
  })
  const result = await ok.generate({ user: 'x', json: true })
  assert.deepEqual(result.json, { a: 1 })

  const bad = createLlmGateway({
    service: fakeService(() => textStream(['不是 JSON'])),
    resolveModel: MODEL,
    ...fast,
  })
  await assert.rejects(() => bad.generate({ user: 'x', json: true }), (err) => err.code === 'LLM_PARSE')
})

test('没有可用模型：LLM_UNAVAILABLE，且不重试', async () => {
  const service = fakeService(() => textStream(['x']))
  const gw = createLlmGateway({ service, resolveModel: () => null, ...fast })
  await assert.rejects(() => gw.generate({ user: 'x' }), (err) => err.code === 'LLM_UNAVAILABLE')
  assert.equal(service.calls.length, 0)
})

test('输出截断：先抬预算重试一次，仍截断就报 LLM_TRUNCATED，不把废稿当成功', async () => {
  const service = fakeService(() => textStream(['写到一半'], { finish: { kind: 'length' } }))
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  await assert.rejects(
    () => gw.generate({ user: '写一章', maxTokens: 1000 }),
    (err) => {
      assert.equal(err.code, 'LLM_TRUNCATED')
      assert.match(err.message, /截断/)
      assert.match(err.message, /调小每章目标字数|输出上限更高/)
      assert.equal(err.detail.maxTokens, 1600)
      return true
    },
  )
  assert.equal(service.calls.length, 2)
  // 第二次必须抬了预算，否则重试没有意义
  assert.equal(service.calls[0].args.maxTokens, 1000)
  assert.equal(service.calls[1].args.maxTokens, 1600)
})

test('截断后抬预算成功：返回正文，并记下尝试次数', async () => {
  const service = fakeService((index) =>
    index === 0
      ? textStream(['前半段'], { finish: { kind: 'length' } })
      : textStream(['前半段', '后半段'], { finish: { kind: 'stop' } }),
  )
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  const result = await gw.generate({ user: '写一章', maxTokens: 1000 })
  assert.equal(result.text, '前半段后半段')
  assert.equal(result.attempts, 2)
  assert.equal(result.failedAttempts, 1)
  assert.equal(result.finishKind, 'stop')
})

test('重试计数：成功那次也要带上失败次数，供成本记账', async () => {
  const service = fakeService((index) => {
    if (index < 2) return textStream([], { finish: { kind: 'error', message: '上游 500' } })
    return textStream(['成了'])
  })
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  const result = await gw.generate({ user: 'x' })
  assert.equal(result.attempts, 3)
  assert.equal(result.failedAttempts, 2)
  assert.equal(service.calls.length, 3)
})

test('空文本逐次加倍但不超过上限：预算 1→2→4', async () => {
  const service = fakeService(() => textStream([]))
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  await assert.rejects(() => gw.generate({ user: 'x', maxTokens: 1000 }), (err) => {
    assert.equal(err.code, 'LLM_EMPTY')
    return true
  })
  const budgets = service.calls.map((call) => call.args.maxTokens)
  assert.deepEqual(budgets, [1000, 2000, 4000])
})

test('上下文超限：不重试，直接给可执行的提示（避免付三遍全额输入）', async () => {
  const service = fakeService(
    () =>
      (async function* () {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            message: 'This model\'s maximum context length is 65536 tokens, however you requested 90000 tokens',
            failure: { code: 'INVALID_REQUEST' },
          },
        }
      })(),
  )
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  await assert.rejects(
    () => gw.generate({ user: 'x'.repeat(500), maxTokens: 1000 }),
    (err) => {
      assert.equal(err.code, 'LLM_CONTEXT')
      assert.match(err.message, /上下文窗口|调小/)
      return true
    },
  )
  assert.equal(service.calls.length, 1)
})

test('额度不足：不重试，明确告诉用户是账户问题', async () => {
  const service = fakeService(
    () =>
      (async function* () {
        yield {
          type: 'finish',
          reason: { kind: 'error', message: 'insufficient balance', failure: { code: 'BILLING_ERROR' } },
        }
      })(),
  )
  const gw = createLlmGateway({ service, resolveModel: MODEL, ...fast })
  await assert.rejects(
    () => gw.generate({ user: 'x' }),
    (err) => {
      assert.equal(err.code, 'LLM_QUOTA')
      assert.match(err.message, /额度|余额/)
      return true
    },
  )
  assert.equal(service.calls.length, 1)
})

test('JSON 抢救：推理前的碎片、尾逗号、注释都不该让整段调用作废', async () => {
  const { extractJson } = await import('../src/forge/text.js')
  assert.deepEqual(extractJson('我先算 {草稿} 再输出：\n{"verdict":"pass","findings":[]}'), {
    verdict: 'pass',
    findings: [],
  })
  assert.deepEqual(extractJson('```json\n{"a":[1,2,],"b":{"c":3,}}\n```'), { a: [1, 2], b: { c: 3 } })
  assert.deepEqual(extractJson('{"a":1 // 说明\n,"b":2}'), { a: 1, b: 2 })
  // 字符串里的 ,} 是正文，不能被修复逻辑改坏
  assert.deepEqual(extractJson('{"text":"他说,}","list":[1,2],}'), { text: '他说,}', list: [1, 2] })
})
