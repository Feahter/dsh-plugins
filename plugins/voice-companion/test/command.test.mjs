import assert from 'node:assert/strict'
import test from 'node:test'

import { createCommandService } from '../host/command.js'

const NOW = Date.parse('2026-11-14T00:00:00+08:00')
const HOUR = 60 * 60 * 1000

// Deliberately mixed: one row carries the title where `sessionController.list()`
// actually puts it (a Session projection), the other uses a normalized row.
const ROWS = [
  {
    sessionId: 's-voice',
    updatedAt: NOW - 1 * HOUR,
    cwd: '/w',
    projections: { values: { title: '语音插件 骨架' } },
  },
  { sessionId: 's-report', title: '季度报表', updatedAt: NOW - 200 * HOUR, cwd: '/w' },
]

function createFakeContext(rows = ROWS) {
  const prompts = []
  const creates = []
  const cancels = []
  const controller = {
    async list() {
      return { items: rows }
    },
    async create(options) {
      creates.push(options)
      return { sessionId: 's-new' }
    },
    async prompt(request, signal) {
      prompts.push({ request, signal })
      return { accepted: true }
    },
    async cancel(request) {
      cancels.push(request)
      return { accepted: true }
    },
  }
  return {
    ctx: { get: (name) => (name === 'sessionController' ? controller : undefined) },
    controller,
    prompts,
    creates,
    cancels,
  }
}

function makeService(rows) {
  const fake = createFakeContext(rows)
  return { ...fake, service: createCommandService({ ctx: fake.ctx, now: () => NOW }) }
}

test('plan routes a clear title match and speaks the confirmation', async () => {
  const { service } = makeService()

  const result = await service.plan({
    utterance: '语音插件那个骨架继续弄',
    currentSessionId: 's-report',
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan.action, 'resume')
  assert.equal(result.plan.sessionId, 's-voice')
  assert.match(result.confirmation, /语音插件/)
})

test('plan resolves a reply to a previous ask by ordinal', async () => {
  const { service } = makeService()

  const result = await service.plan({
    utterance: '第二个',
    pending: [
      { sessionId: 'a', title: '甲' },
      { sessionId: 'b', title: '乙' },
    ],
  })

  assert.equal(result.plan.action, 'resume')
  assert.equal(result.plan.sessionId, 'b')
  assert.equal(result.plan.confidence, 0.95)
  assert.match(result.confirmation, /乙/)
})

test('plan rejects an empty utterance with 400', async () => {
  const { service } = makeService()

  await assert.rejects(
    service.plan({ utterance: '   ' }),
    (error) => error.status === 400 && error.code === 'invalid',
  )
  await assert.rejects(
    service.plan({}),
    (error) => error.status === 400 && error.code === 'invalid',
  )
})

test('plan reports a missing Session service as 503', async () => {
  const service = createCommandService({ ctx: { get: () => undefined }, now: () => NOW })

  await assert.rejects(
    service.plan({ utterance: '继续' }),
    (error) => error.status === 503 && error.code === 'unavailable',
  )
})

test('send delivers a prompt to an existing Session', async () => {
  const { service, prompts } = makeService()

  const result = await service.send({ action: 'prompt', sessionId: 's-voice', text: '把测试补上' })

  assert.deepEqual(result, { ok: true, action: 'prompt', sessionId: 's-voice', text: '把测试补上' })
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].request.sessionId, 's-voice')
  assert.equal(prompts[0].request.mode, 'queue')
  assert.deepEqual(prompts[0].request.content, [{ type: 'text', text: '把测试补上' }])
  assert.equal(typeof prompts[0].request.requestId, 'string')
  assert.ok(prompts[0].signal instanceof AbortSignal)
})

test('send forwards steer mode when asked', async () => {
  const { service, prompts } = makeService()

  await service.send({ action: 'prompt', sessionId: 's-voice', text: '先停一下', mode: 'steer' })

  assert.equal(prompts[0].request.mode, 'steer')
})

test('send creates a new Session and prompts it', async () => {
  const { service, creates, prompts } = makeService()

  const result = await service.send({ action: 'new', text: '新开一个写周报' })

  assert.deepEqual(result, { ok: true, action: 'new', sessionId: 's-new', text: '新开一个写周报' })
  assert.deepEqual(creates, [{}])
  assert.equal(prompts[0].request.sessionId, 's-new')
  assert.deepEqual(prompts[0].request.content, [{ type: 'text', text: '新开一个写周报' }])
})

test('send cancels the addressed Session', async () => {
  const { service, cancels } = makeService()

  const result = await service.send({ action: 'cancel', sessionId: 's-voice' })

  assert.deepEqual(result, { ok: true, action: 'cancel' })
  assert.deepEqual(cancels, [{ sessionId: 's-voice' }])
})

test('send rejects a prompt to an unknown Session with 404', async () => {
  const { service, prompts } = makeService()

  await assert.rejects(
    service.send({ action: 'prompt', sessionId: 's-ghost', text: '继续' }),
    (error) => error.status === 404 && error.code === 'not-found',
  )
  await assert.rejects(
    service.send({ action: 'prompt', text: '继续' }),
    (error) => error.status === 404 && error.code === 'not-found',
  )
  assert.equal(prompts.length, 0)
})

test('send rejects an unknown action with 400', async () => {
  const { service } = makeService()

  await assert.rejects(
    service.send({ action: 'dance', sessionId: 's-voice', text: '继续' }),
    (error) => error.status === 400 && error.code === 'invalid',
  )
})

test('send rejects empty text for prompt and new', async () => {
  const { service } = makeService()

  await assert.rejects(
    service.send({ action: 'prompt', sessionId: 's-voice', text: '  ' }),
    (error) => error.status === 400 && error.code === 'invalid',
  )
  await assert.rejects(
    service.send({ action: 'new' }),
    (error) => error.status === 400 && error.code === 'invalid',
  )
})
