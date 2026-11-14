import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TASK_PERMISSION_PRESET,
  TASK_REASONING_EFFORT,
  createTaskBoard,
} from '../host/tasks.js'

/** Let the board's fire-and-forget `agent/created` handler finish. */
function tick() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Minimal Host context: no HTTP, no index.js. Every service can be switched off
 * to mirror a Host that does not expose it.
 * @param {object} [options]
 */
function createHarness({
  names = ['ask', TASK_PERMISSION_PRESET],
  resolves = {},
  currentPreset = 'ask',
  efforts = ['off', 'low', 'high'],
  reasoning = undefined,
  missingServices = [],
  setThrows = false,
  selectThrows = false,
} = {}) {
  const order = []
  const logs = { prompts: [], set: [], select: [], warn: 0 }
  const listeners = new Map()
  const agent = {
    id: 's1',
    session: { id: 's1' },
    model: {
      current: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
      select: async (input) => {
        order.push('select')
        logs.select.push(input)
        if (selectThrows) throw new Error('select boom')
      },
    },
  }
  const session = { id: 's1' }
  const controller = {
    create: async () => ({ sessionId: 's1', id: 's1' }),
    prompt: async (request) => {
      order.push('prompt')
      logs.prompts.push(request)
      return {}
    },
    events: async () => ({ records: [] }),
  }
  const services = {
    sessionController: controller,
    sessions: { get: (sessionId) => (sessionId === 's1' ? session : undefined) },
    agents: { get: (sessionId) => (sessionId === 's1' ? agent : undefined) },
    llm: {
      resolveModelInfo: async () =>
        reasoning !== undefined ? reasoning : { reasoning: { efforts } },
    },
    permissionPresets: {
      names,
      resolve(name) {
        if (resolves[name] !== undefined) return resolves[name]
        return name === TASK_PERMISSION_PRESET
          ? { sandbox: 'danger-full-access' }
          : { sandbox: 'workspace-write' }
      },
      current: () => currentPreset,
      set(targetSession, name) {
        order.push('set')
        logs.set.push([targetSession, name])
        if (setThrows) throw new Error('set boom')
      },
    },
  }
  const ctx = {
    logger: {
      info() {},
      warn() {
        logs.warn += 1
      },
      error() {},
    },
    get(name) {
      if (missingServices.includes(name)) return undefined
      return services[name]
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
      return () => listeners.get(event)?.delete(listener)
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
  const board = createTaskBoard({ ctx, now: () => 1_000 })
  return { board, ctx, logs, order, agent, session }
}

test('new session dispatch sets full-access preset and high effort before prompting', async () => {
  assert.equal(TASK_PERMISSION_PRESET, 'danger-full-access')
  assert.equal(TASK_REASONING_EFFORT, 'high')
  const { board, logs, order } = createHarness()

  const result = await board.dispatch({ text: '做点事', title: '干活' })

  assert.equal(result.sessionId, 's1')
  assert.equal(logs.set.length, 1)
  assert.equal(logs.set[0][1], 'danger-full-access')
  assert.deepEqual(logs.select, [
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  ])
  assert.equal(logs.prompts.length, 1)
  assert.equal(logs.prompts[0].sessionId, 's1')
  assert.deepEqual(order, ['set', 'select', 'prompt'])
  assert.equal(logs.warn, 0)
})

test('effort falls back to max when high is unavailable', async () => {
  const { board, logs } = createHarness({ efforts: ['low', 'medium', 'max'] })

  await board.dispatch({ text: 'x' })

  assert.equal(logs.select.length, 1)
  assert.equal(logs.select[0].reasoningEffort, 'max')
})

test('empty effort list still attempts high', async () => {
  const { board, logs } = createHarness({ efforts: [] })

  await board.dispatch({ text: 'x' })

  assert.equal(logs.select.length, 1)
  assert.equal(logs.select[0].reasoningEffort, 'high')
})

test('missing reasoning info still attempts high', async () => {
  const { board, logs } = createHarness({ reasoning: {} })

  await board.dispatch({ text: 'x' })

  assert.equal(logs.select.length, 1)
  assert.equal(logs.select[0].reasoningEffort, 'high')
})

test('preset is found by sandbox mode when the canonical name is absent', async () => {
  const { board, logs } = createHarness({
    names: ['ask', 'yolo'],
    resolves: { ask: { sandbox: 'workspace-write' }, yolo: { sandbox: 'danger-full-access' } },
  })

  await board.dispatch({ text: 'x' })

  assert.equal(logs.set.length, 1)
  assert.equal(logs.set[0][1], 'yolo')
})

test('a session already on the target preset is not switched again', async () => {
  const { board, logs } = createHarness({ currentPreset: 'danger-full-access' })

  await board.dispatch({ text: 'x' })

  assert.equal(logs.set.length, 0)
  assert.equal(logs.select.length, 1)
})

test('missing optional services never block dispatch', async () => {
  const { board, logs } = createHarness({
    missingServices: ['permissionPresets', 'sessions', 'agents', 'llm'],
  })

  const result = await board.dispatch({ text: 'x' })

  assert.equal(result.sessionId, 's1')
  assert.equal(logs.prompts.length, 1)
  assert.equal(logs.set.length, 0)
  assert.equal(logs.select.length, 0)
  assert.equal(logs.warn, 0)
})

test('agent/created applies defaults to tracked sessions only', async () => {
  const { board, ctx, logs } = createHarness()
  board.watch()
  await board.dispatch({ text: 'x' })

  const setsAfterDispatch = logs.set.length
  const selectsAfterDispatch = logs.select.length

  ctx.emit('agent/created', { agent: { id: 's1' }, source: 'test' })
  await tick()
  await tick()

  assert.equal(logs.set.length, setsAfterDispatch + 1)
  assert.equal(logs.select.length, selectsAfterDispatch + 1)

  ctx.emit('agent/created', { agent: { id: 's2' }, source: 'test' })
  await tick()
  await tick()

  assert.equal(logs.set.length, setsAfterDispatch + 1)
  assert.equal(logs.select.length, selectsAfterDispatch + 1)
})

test('failing services warn instead of throwing', async () => {
  const { board, logs } = createHarness({ setThrows: true, selectThrows: true })

  const result = await board.dispatch({ text: 'x' })

  assert.equal(result.sessionId, 's1')
  assert.equal(logs.prompts.length, 1)
  assert.ok(logs.warn >= 2, `expected at least 2 warnings, got ${logs.warn}`)
})
