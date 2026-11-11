import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ForgeEngine,
  ForgeError,
  Store,
  createLlmGateway,
  normalizeStageList,
  validateRecipe,
} from '../src/forge/index.js'
import { createFakeLlm, makeMockRecipe } from './fixtures/mock-recipe.mjs'

async function setup(t, recipeOptions = {}, engineOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'forge-engine-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const recipe = makeMockRecipe(recipeOptions)
  const llm = engineOptions.llm || createFakeLlm()
  const engine = new ForgeEngine({ root, recipes: [recipe], llm, ...engineOptions })
  return { root, engine, recipe, llm }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(fn, { timeout = 5000, interval = 10, label = 'condition' } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`)
    await sleep(interval)
  }
}

async function waitRun(engine, runId) {
  return waitFor(
    async () => {
      const run = await engine.getRun(runId)
      if (run.status === 'running') return null
      if (!run.endedAt) return null
      return run
    },
    { label: `run ${runId}` },
  )
}

function eventTypes(run) {
  return (run.events || []).map((event) => event.type)
}

function stageOrder(run) {
  return (run.events || [])
    .filter((event) => event.type === 'stage-start')
    .map((event) => event.data.stage)
}

// ------------------------------------------------------------------ 执行顺序

test('按 recipe 顺序执行并写出产物', async (t) => {
  const { engine, llm } = await setup(t, { review: false })
  const project = await engine.createProject({ title: '顺序' })
  const run = await engine.startRun(project.id)

  assert.equal(run.status, 'running')
  assert.equal(run.options.stages.join(','), 'alpha,beta,gamma')

  const final = await waitRun(engine, run.id)
  assert.equal(final.status, 'done')
  assert.equal(final.error, null)
  assert.equal(final.progress.done, 4)
  assert.deepEqual(stageOrder(final), ['alpha', 'beta', 'gamma'])

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.alpha.status, 'done')
  assert.equal(saved.stages.beta.status, 'done')
  assert.equal(saved.stages.gamma.status, 'done')
  assert.equal(saved.artifacts.a.kind, 'json')
  assert.equal(saved.artifacts['b/x1'].kind, 'md')
  assert.equal(saved.artifacts.c.kind, 'md')
  assert.equal(saved.activeRunId, null)

  const a = await engine.getArtifact(project.id, 'a')
  assert.equal(a.content.said, 'ok')
  assert.equal(a.content.items.length, 2)

  assert.equal(llm.calls.length, 2)
  assert.equal(llm.calls[0].system, 'system prompt')
  assert.equal(llm.calls[0].maxTokens, 128)
  assert.ok(llm.calls[0].signal)
  assert.equal(final.stats.calls, 2)

  const list = await engine.listProjects()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, project.id)
  assert.equal(list[0].artifactCount, 4)
})

test('第二次运行跳过已完成产物且不产生新版本', async (t) => {
  const { engine, llm } = await setup(t, { review: false })
  const project = await engine.createProject({ title: '跳过' })
  await waitRun(engine, (await engine.startRun(project.id)).id)
  const before = await engine.getProject(project.id)

  const second = await engine.startRun(project.id)
  const final = await waitRun(engine, second.id)
  assert.equal(final.status, 'done')
  assert.ok(final.events.some((event) => event.type === 'log' && event.data.message.includes('已完成')))

  const after = await engine.getProject(project.id)
  assert.equal(after.artifacts.a.version, before.artifacts.a.version)
  assert.equal(after.artifacts['b/x1'].version, before.artifacts['b/x1'].version)
  assert.equal(llm.calls.length, 2)
})

test('force 重跑已完成 stage 并递增版本', async (t) => {
  const { engine, llm } = await setup(t, { review: false })
  const project = await engine.createProject({ title: '强制' })
  await waitRun(engine, (await engine.startRun(project.id)).id)

  const forced = await engine.startRun(project.id, { force: true })
  const final = await waitRun(engine, forced.id)
  assert.equal(final.status, 'done')
  assert.equal(final.options.force, true)

  const after = await engine.getProject(project.id)
  assert.equal(after.artifacts.a.version, 2)
  assert.equal(after.artifacts['b/x1'].version, 2)
  assert.equal(after.artifacts.c.version, 2)
  assert.equal(llm.calls.length, 4)
})

test('stage.skip 跳过 stage，force 时不调用 skip', async (t) => {
  const { engine, llm } = await setup(t, { review: false, skip: true, skipReason: '没东西可写' })
  const project = await engine.createProject({ title: '跳过条件' })

  const first = await engine.startRun(project.id)
  const paused = await waitRun(engine, first.id)
  assert.equal(paused.status, 'done')
  const skipped = paused.events.find((event) => event.type === 'stage-end' && event.data.stage === 'beta')
  assert.equal(skipped.data.status, 'skipped')
  assert.equal(llm.calls.length, 0)
  assert.equal(await engine.getArtifact(project.id, 'b/x1'), null)

  const forced = await engine.startRun(project.id, { force: true })
  const final = await waitRun(engine, forced.id)
  assert.equal(final.status, 'done')
  const betaEnd = final.events.find((event) => event.type === 'stage-end' && event.data.stage === 'beta')
  assert.equal(betaEnd.data.status, 'done')
  assert.equal(llm.calls.length, 2)
  assert.ok(await engine.getArtifact(project.id, 'b/x1'))
})

// ---------------------------------------------------------------- 失败与取消

test('each item 失败默认 continue，stage 标 partial', async (t) => {
  const { engine, llm } = await setup(t, { review: false, failIds: ['x1'] })
  const project = await engine.createProject({ title: '继续' })
  const final = await waitRun(engine, (await engine.startRun(project.id)).id)

  assert.equal(final.status, 'done')
  assert.equal(final.error, null)
  assert.ok(final.events.some((event) => event.type === 'item-error' && event.data.item === 'x1'))
  assert.ok(llm.calls.length === 1)

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'partial')
  assert.equal(saved.stages.beta.items.x1, 'error')
  assert.equal(saved.stages.beta.items.x2, 'done')
  assert.equal(saved.stages.gamma.status, 'done')
  assert.equal(await engine.getArtifact(project.id, 'b/x1'), null)
  assert.ok(await engine.getArtifact(project.id, 'b/x2'))
  assert.equal(saved.lastError.code, 'INTERNAL')
  assert.equal(saved.lastError.item, 'x1')
})

test('onItemError=stop 时整条 run 失败', async (t) => {
  const { engine } = await setup(t, { review: false, failIds: ['x1'], onItemError: 'stop' })
  const project = await engine.createProject({ title: '停止' })
  const final = await waitRun(engine, (await engine.startRun(project.id)).id)

  assert.equal(final.status, 'error')
  assert.equal(final.error.code, 'INTERNAL')
  assert.ok(final.error.message.includes('boom x1'))
  assert.ok(eventTypes(final).includes('run-error'))

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'error')
  assert.equal(saved.stages.beta.items.x1, 'error')
  assert.equal(saved.stages.gamma.status, 'idle')
  assert.equal(await engine.getArtifact(project.id, 'b/x2'), null)
  assert.equal(saved.activeRunId, null)
})

test('静态 stage 抛错时 run 失败并记录 lastError', async (t) => {
  const { engine } = await setup(t, { review: false, failStage: 'alpha' })
  const project = await engine.createProject({ title: '静态失败' })
  const final = await waitRun(engine, (await engine.startRun(project.id)).id)

  assert.equal(final.status, 'error')
  assert.equal(final.error.message, 'alpha exploded')
  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.alpha.status, 'error')
  assert.equal(saved.lastError.stage, 'alpha')
})

test('取消运行：当前 item 回 pending，run cancelled', async (t) => {
  const { engine } = await setup(t, { review: false, betaDelayMs: 400 })
  const project = await engine.createProject({ title: '取消' })
  const run = await engine.startRun(project.id)

  await waitFor(
    async () => {
      const saved = await engine.getProject(project.id)
      return saved.stages.beta?.items?.x1 === 'running'
    },
    { label: 'beta x1 running' },
  )

  const cancelled = await engine.cancelRun(run.id)
  assert.equal(cancelled.status, 'cancelled')

  const final = await waitRun(engine, run.id)
  assert.equal(final.status, 'cancelled')
  assert.ok(final.endedAt)
  assert.ok(eventTypes(final).includes('run-end'))

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.items.x1, 'pending')
  assert.equal(saved.activeRunId, null)
})

// ------------------------------------------------------------------ review

test('review gate 暂停并写 pendingReview，继续后完成', async (t) => {
  const { engine } = await setup(t, { review: true })
  const project = await engine.createProject({ title: '审阅' })
  const run = await engine.startRun(project.id)
  const paused = await waitRun(engine, run.id)

  assert.equal(paused.status, 'paused')
  assert.ok(eventTypes(paused).includes('run-paused'))
  const saved = await engine.getProject(project.id)
  assert.equal(saved.pendingReview.stage, 'gamma')
  assert.ok(Array.isArray(saved.pendingReview.nextStages))
  assert.equal(saved.activeRunId, null)
  assert.ok(await engine.getArtifact(project.id, 'c'))

  const resumed = await engine.startRun(project.id, { stages: ['gamma'] })
  const final = await waitRun(engine, resumed.id)
  assert.equal(final.status, 'done')
  const after = await engine.getProject(project.id)
  assert.equal(after.pendingReview, null)
})

test('autoApprove=true 时 review 不暂停', async (t) => {
  const { engine } = await setup(t, { review: true })
  const project = await engine.createProject({ title: '自动批准' })
  const final = await waitRun(engine, (await engine.startRun(project.id, { autoApprove: true })).id)

  assert.equal(final.status, 'done')
  assert.ok(!eventTypes(final).includes('run-paused'))
  const saved = await engine.getProject(project.id)
  assert.equal(saved.pendingReview, null)
  assert.equal(saved.stages.gamma.status, 'done')
})

// ------------------------------------------------------------------ dryRun

test('dryRun 校验流程但不调模型、不写产物', async (t) => {
  const { engine, llm } = await setup(t, { review: false })
  const project = await engine.createProject({ title: '演练' })
  // 上游产物已存在，dryRun 才能解析 each 路径
  await engine.writeArtifact(
    project.id,
    'a',
    { kind: 'json', content: { items: [{ id: 'x1' }, { id: 'x2' }] } },
    { stage: 'alpha' },
  )

  const final = await waitRun(engine, (await engine.startRun(project.id, { dryRun: true })).id)

  assert.equal(final.status, 'done')
  assert.equal(final.options.dryRun, true)
  assert.equal(llm.calls.length, 0)
  assert.equal(eventTypes(final).includes('artifact'), false)

  const saved = await engine.getProject(project.id)
  assert.deepEqual(Object.keys(saved.artifacts), ['a'])
  assert.equal(saved.artifacts.a.version, 1)
  assert.equal(saved.stages.beta.items.x1, 'done')
  assert.equal(saved.stages.beta.items.x2, 'done')
  assert.equal(await engine.getArtifact(project.id, 'b/x1'), null)
  assert.equal(await engine.getArtifact(project.id, 'c'), null)
})

// ------------------------------------------------------------ 并发 / 恢复

test('同一项目只允许一个活动 run', async (t) => {
  const { engine } = await setup(t, { review: false, betaDelayMs: 300 })
  const project = await engine.createProject({ title: '并发' })
  const run = await engine.startRun(project.id)

  await assert.rejects(
    () => engine.startRun(project.id),
    (err) => err instanceof ForgeError && err.code === 'RUN_ACTIVE' && err.detail.runId === run.id,
  )

  await engine.cancelRun(run.id)
  await waitRun(engine, run.id)
})

test('recover 把残留 running 标 interrupted 并修正项目状态', async (t) => {
  const { root, engine } = await setup(t)
  const store = new Store(root)
  const now = new Date().toISOString()
  const projectId = 'proj_recover'
  const runId = 'run_recover'

  await store.createProject({
    schemaVersion: 1,
    id: projectId,
    title: '恢复',
    recipe: 'mock',
    recipeVersion: 1,
    createdAt: now,
    updatedAt: now,
    params: {},
    artifacts: {},
    stages: {
      alpha: { status: 'done' },
      beta: { status: 'running', items: { x1: 'running', x2: 'pending' } },
      gamma: { status: 'idle' },
    },
    stats: { calls: 1, estTokensIn: 1, estTokensOut: 1 },
    activeRunId: runId,
    pendingReview: null,
    lastError: null,
  })
  await store.writeRun(projectId, {
    schemaVersion: 1,
    id: runId,
    projectId,
    status: 'running',
    startedAt: now,
    endedAt: null,
    options: {},
    current: { stage: 'beta', item: 'x1', label: 'Beta · x1' },
    progress: { done: 1, total: 2 },
    seq: 3,
    events: [],
    error: null,
    stats: { calls: 1, estTokensIn: 1, estTokensOut: 1 },
  })

  const fixed = await engine.recover()
  assert.equal(fixed.length, 1)
  assert.deepEqual(fixed[0], { projectId, runId })

  const run = await engine.getRun(runId)
  assert.equal(run.status, 'interrupted')
  assert.equal(run.error.code, 'INTERRUPTED')

  const project = await engine.getProject(projectId)
  assert.equal(project.activeRunId, null)
  assert.equal(project.stages.beta.status, 'partial')
  assert.equal(project.stages.beta.items.x1, 'pending')
  assert.equal(project.lastError.code, 'INTERRUPTED')
})

// ------------------------------------------------------- stages / from / to

test('stages 与 from/to 选择执行范围', async (t) => {
  const { engine } = await setup(t, { review: false })
  const project = await engine.createProject({ title: '范围' })
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)

  const ranged = await engine.startRun(project.id, { from: 'beta', to: 'beta' })
  assert.deepEqual(ranged.options.stages, ['beta'])
  const final = await waitRun(engine, ranged.id)
  assert.equal(final.status, 'done')

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'done')
  assert.equal(saved.stages.gamma.status, 'idle')
  assert.equal(await engine.getArtifact(project.id, 'c'), null)
})

test('未知 stage / 冲突选项被拒绝', async (t) => {
  const { engine } = await setup(t)
  const project = await engine.createProject({ title: '非法' })

  await assert.rejects(
    () => engine.startRun(project.id, { stages: ['nope'] }),
    (err) => err instanceof ForgeError && err.code === 'BAD_STAGE',
  )
  await assert.rejects(
    () => engine.startRun(project.id, { stages: ['alpha'], from: 'alpha' }),
    (err) => err instanceof ForgeError && err.code === 'BAD_PARAMS',
  )
  await assert.rejects(
    () => engine.startRun(project.id, { from: 'gamma', to: 'alpha' }),
    (err) => err instanceof ForgeError && err.code === 'BAD_STAGE',
  )

  const recipe = makeMockRecipe()
  assert.throws(() => normalizeStageList(recipe, { stages: ['nope'] }), (err) => err.code === 'BAD_STAGE')
})

test('items 过滤只跑指定 item，未知 item 报 BAD_PARAMS', async (t) => {
  const { engine, llm } = await setup(t, { review: false })
  const project = await engine.createProject({ title: '过滤' })
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)
  llm.calls.length = 0

  const filtered = await engine.startRun(project.id, { stages: ['beta'], items: ['x2'] })
  assert.deepEqual(filtered.options.items, ['x2'])
  const final = await waitRun(engine, filtered.id)
  assert.equal(final.status, 'done')
  assert.equal(llm.calls.length, 1)
  assert.ok(await engine.getArtifact(project.id, 'b/x2'))
  assert.equal(await engine.getArtifact(project.id, 'b/x1'), null)

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.items.x2, 'done')
  assert.equal(saved.stages.beta.items.x1, undefined)

  const bad = await engine.startRun(project.id, { stages: ['beta'], items: ['zzz'] })
  const badFinal = await waitRun(engine, bad.id)
  assert.equal(badFinal.status, 'error')
  assert.equal(badFinal.error.code, 'BAD_PARAMS')
})

// -------------------------------------------------------------- LLM 网关

function scriptedService(scripts) {
  let index = 0
  const service = {
    calls: 0,
    prepareCall(config) {
      return {
        config,
        async stream(args) {
          service.calls += 1
          const script = scripts[Math.min(index, scripts.length - 1)]
          index += 1
          return script(args)
        },
      }
    },
  }
  return service
}

function chunksOf(...chunks) {
  return async function* stream() {
    for (const chunk of chunks) yield chunk
  }
}

const selection = { provider: 'prov', model: 'mock-1' }

test('LLM 网关累积 text-delta 并透传 system/session', async (t) => {
  let seen = null
  const service = scriptedService([
    async (args) => {
      seen = args
      return chunksOf(
        { type: 'text-delta', text: 'he' },
        { type: 'text-delta', text: 'llo' },
        { type: 'finish', reason: { kind: 'stop' } },
      )(args)
    },
  ])
  const gateway = createLlmGateway({ service, resolveModel: () => selection })

  const result = await gateway.generate({ system: 'sys', user: 'hi', sessionId: 's-1' })
  assert.equal(result.text, 'hello')
  assert.equal(result.model, 'mock-1')
  assert.equal(result.chars, 5)
  assert.equal(seen.system, 'sys')
  assert.equal(seen.sessionId, 's-1')
  assert.equal(seen.messages[0].content[0].text, 'hi')
  assert.equal(seen.messages[0].source.kind, 'dsh-forge')
  assert.equal(service.calls, 1)
})

test('LLM 网关 json 模式从围栏中提取 JSON', async (t) => {
  const service = scriptedService([chunksOf({ type: 'text-delta', text: '```json\n{"ok":true}\n```' })])
  const gateway = createLlmGateway({ service, resolveModel: () => selection })
  const result = await gateway.generate({ user: 'x', json: true })
  assert.deepEqual(result.json, { ok: true })
})

test('LLM 网关对网络错误重试后成功', async (t) => {
  const service = scriptedService([
    async () => {
      throw new Error('network down')
    },
    chunksOf({ type: 'text-delta', text: 'ok' }),
  ])
  const gateway = createLlmGateway({ service, resolveModel: () => selection, retryDelays: [1] })
  const result = await gateway.generate({ user: 'x' })
  assert.equal(result.text, 'ok')
  assert.equal(service.calls, 2)
})

test('LLM 网关空文本重试后成功', async (t) => {
  const service = scriptedService([
    async function* empty() {},
    chunksOf({ type: 'text-delta', text: 'second' }),
  ])
  const gateway = createLlmGateway({ service, resolveModel: () => selection, retryDelays: [1] })
  const result = await gateway.generate({ user: 'x' })
  assert.equal(result.text, 'second')
  assert.equal(service.calls, 2)
})

test('LLM 网关连续空文本时逐次加倍 maxTokens', async (t) => {
  const seen = []
  const service = scriptedService([
    async function* empty1() {},
    async function* empty2() {},
    (args) => {
      seen.push(args.maxTokens)
      return chunksOf({ type: 'text-delta', text: 'third' })(args)
    },
  ])
  const gateway = createLlmGateway({ service, resolveModel: () => selection, retryDelays: [1] })
  const result = await gateway.generate({ user: 'x', maxTokens: 1000 })
  assert.equal(result.text, 'third')
  assert.deepEqual(seen, [4000])
})

test('LLM 网关 json 解析失败抛 LLM_PARSE 并带 raw', async (t) => {
  const service = scriptedService([chunksOf({ type: 'text-delta', text: 'not json at all' })])
  const gateway = createLlmGateway({ service, resolveModel: () => selection, maxRetries: 0 })
  await assert.rejects(
    () => gateway.generate({ user: 'x', json: true }),
    (err) => err.code === 'LLM_PARSE' && err.detail.raw === 'not json at all',
  )
})

test('LLM 网关 finish reason=error 抛 LLM_ERROR', async (t) => {
  const service = scriptedService([
    chunksOf({ type: 'finish', reason: { kind: 'error' }, message: 'upstream failed' }),
  ])
  const gateway = createLlmGateway({ service, resolveModel: () => selection, maxRetries: 0 })
  await assert.rejects(
    () => gateway.generate({ user: 'x' }),
    (err) => err.code === 'LLM_ERROR' && err.message.includes('upstream failed'),
  )
})

test('LLM 网关缺少模型时抛 LLM_UNAVAILABLE', async (t) => {
  const service = scriptedService([chunksOf({ type: 'text-delta', text: 'x' })])
  const gateway = createLlmGateway({ service, resolveModel: () => null, maxRetries: 0 })
  await assert.rejects(
    () => gateway.generate({ user: 'x' }),
    (err) => err.code === 'LLM_UNAVAILABLE',
  )

  const noService = createLlmGateway({ resolveModel: () => selection, maxRetries: 0 })
  await assert.rejects(
    () => noService.generate({ user: 'x' }),
    (err) => err.code === 'LLM_UNAVAILABLE',
  )
})

test('LLM 网关已取消时抛 LLM_ABORTED', async (t) => {
  const controller = new AbortController()
  controller.abort()
  const gateway = createLlmGateway({ service: {}, resolveModel: () => selection })
  await assert.rejects(
    () => gateway.generate({ user: 'x', signal: controller.signal }),
    (err) => err.code === 'LLM_ABORTED',
  )
})

// ------------------------------------------------------------ recipe 校验

test('validateRecipe 拒绝重复 id / 空 stages / 非法 produces', () => {
  const base = makeMockRecipe({ review: false })

  assert.throws(
    () => validateRecipe({ ...base, stages: [] }),
    (err) => err.code === 'BAD_RECIPE',
  )
  assert.throws(
    () =>
      validateRecipe({
        id: 'dup',
        stages: [
          { id: 'a', run: () => ({}) },
          { id: 'a', run: () => ({}) },
        ],
      }),
    (err) => err.code === 'BAD_RECIPE' && err.message.includes('重复'),
  )
  assert.throws(
    () =>
      validateRecipe({
        id: 'bad',
        stages: [{ id: 'a', run: () => ({}), produces: ['../escape'] }],
      }),
    (err) => err.code === 'BAD_RECIPE',
  )
  assert.throws(
    () =>
      validateRecipe({
        id: 'bad2',
        stages: [{ id: 'a', run: () => ({}), each: 42 }],
      }),
    (err) => err.code === 'BAD_RECIPE',
  )
  assert.throws(
    () =>
      validateRecipe({
        id: 'bad3',
        stages: [{ id: 'a', run: () => ({}), review: 'yes' }],
      }),
    (err) => err.code === 'BAD_RECIPE',
  )
})

test('normalizeStageList 按 recipe 顺序返回并拒绝未知 id', () => {
  const recipe = makeMockRecipe()
  assert.deepEqual(
    normalizeStageList(recipe, { stages: ['gamma', 'alpha'] }).map((stage) => stage.id),
    ['alpha', 'gamma'],
  )
  assert.deepEqual(
    normalizeStageList(recipe, { from: 'beta', to: 'gamma' }).map((stage) => stage.id),
    ['beta', 'gamma'],
  )
  assert.throws(() => normalizeStageList(recipe, { stages: ['nope'] }), (err) => err.code === 'BAD_STAGE')
  assert.throws(() => normalizeStageList(recipe, { from: 'gamma', to: 'alpha' }), (err) => err.code === 'BAD_STAGE')
  assert.throws(
    () => normalizeStageList(recipe, { stages: ['alpha'], from: 'alpha' }),
    (err) => err.code === 'BAD_PARAMS',
  )
})
