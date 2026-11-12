// 引擎状态机回归：部分 item 不能冒充「本阶段完成」；合并落盘不能丢尾部事件。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine, Store } from '../src/forge/index.js'
import { ForgeError } from '../src/forge/errors.js'
import { createFakeLlm, makeMockRecipe } from './fixtures/mock-recipe.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'forge-state-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({ root, recipes: [makeMockRecipe({ review: false })], llm: createFakeLlm() })
  return { root, engine }
}

async function waitRun(engine, runId, timeout = 5000) {
  const started = Date.now()
  for (;;) {
    const run = await engine.getRun(runId)
    if (run.status !== 'running' && run.endedAt) return run
    if (Date.now() - started > timeout) throw new Error('timeout waiting for run')
    await sleep(10)
  }
}

test('只跑部分 item：阶段标 partial 而不是 done，并留一条 warn', async (t) => {
  const { engine } = await setup(t)
  const project = await engine.createProject({ title: '部分' })

  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)

  const run = await engine.startRun(project.id, { stages: ['beta'], items: ['x2'] })
  const final = await waitRun(engine, run.id)

  assert.equal(final.status, 'done')
  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'partial', '只写了 x2，beta 不能算完成')
  assert.equal(saved.stages.beta.items.x2, 'done')

  const stageEnd = final.events.filter((event) => event.type === 'stage-end').at(-1)
  assert.equal(stageEnd.data.status, 'partial')

  const warn = final.events.filter((event) => event.type === 'log' && event.data.level === 'warn')
  assert.ok(
    warn.some((event) => /1\/2/.test(event.data.message)),
    `应记录「仅完成 1/2」，实际：${warn.map((event) => event.data.message).join(' | ')}`,
  )
})

test('isStale：产物存在但内容是占位符时不算完成，重跑会重新生成', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-stale-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const recipe = makeMockRecipe({ review: false })
  const beta = recipe.stages.find((stage) => stage.id === 'beta')
  beta.isStale = ({ key, artifact }) => key.startsWith('b/') && String(artifact?.content ?? '').includes('正文缺失')
  const engine = new ForgeEngine({ root, recipes: [recipe], llm: createFakeLlm() })
  const project = await engine.createProject({ title: '占位' })

  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha', 'beta'] })).id)
  const good = (await engine.getProject(project.id)).artifacts['b/x1']
  assert.ok(good, 'b/x1 应当已生成')

  // 模拟历史版本写坏的占位产物：文件与记录都在，但内容不是正文
  const store = new Store(root)
  await store.writeArtifact(project.id, 'b/x1', { kind: 'md', content: '# x1\n正文缺失，无法修订' })

  const run = await engine.startRun(project.id, { stages: ['beta'], items: ['x1'] })
  const final = await waitRun(engine, run.id)
  assert.equal(final.status, 'done')

  const skipped = final.events.filter((event) => event.type === 'log' && /跳过/.test(event.data.message))
  assert.ok(!skipped.some((event) => event.data.message.includes('b/x1') || event.data.message.includes('Beta/x1')), '占位产物不应被当成已完成')
  const regenerated = await store.readArtifact(project.id, 'b/x1', 'md', null)
  assert.ok(!String(regenerated.content).includes('正文缺失'), '重跑后正文应当被真正重写')
})

test('补齐剩下 item 后阶段回到 done', async (t) => {
  const { engine } = await setup(t)
  const project = await engine.createProject({ title: '补齐' })

  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['beta'], items: ['x2'] })).id)
  assert.equal((await engine.getProject(project.id)).stages.beta.status, 'partial')

  await waitRun(engine, (await engine.startRun(project.id, { stages: ['beta'], items: ['x1'] })).id)
  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'done')
  assert.equal(saved.stages.beta.items.x1, 'done')
  assert.equal(saved.stages.beta.items.x2, 'done')
})

test('全量跑一遍仍然是 done，不因新规则误判', async (t) => {
  const { engine } = await setup(t)
  const project = await engine.createProject({ title: '全量' })
  await waitRun(engine, (await engine.startRun(project.id)).id)
  const saved = await engine.getProject(project.id)
  for (const stage of ['alpha', 'beta', 'gamma']) {
    assert.equal(saved.stages[stage].status, 'done', `${stage} 应为 done`)
  }
})

test('高频事件合并落盘：run 结束后磁盘 run.json 与内存一致，不丢尾部事件', async (t) => {
  const { root, engine } = await setup(t)
  const project = await engine.createProject({ title: '落盘' })
  const final = await waitRun(engine, (await engine.startRun(project.id)).id)

  // getRun 用内存态，可能比落盘早一瞬；这里等磁盘追平再断言（超时即代表丢事件）。
  const store = new Store(root)
  const started = Date.now()
  let onDisk = await store.readRun(final.id, project.id)
  while (onDisk.seq !== final.seq && Date.now() - started < 3000) {
    await sleep(20)
    onDisk = await store.readRun(final.id, project.id)
  }
  assert.ok(onDisk, 'run.json 应该存在')
  assert.equal(onDisk.status, 'done')
  assert.equal(onDisk.seq, final.seq, '磁盘 seq 必须追平内存')
  assert.equal(onDisk.events.length, final.events.length)
  assert.equal(onDisk.events.at(-1).type, 'run-end', '最后一条事件必须落盘')
})

test('运行中也能读到接近实时的进度（合并写有 200ms 上限）', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-state-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({
    root,
    recipes: [makeMockRecipe({ review: false, betaDelayMs: 120 })],
    llm: createFakeLlm(),
  })
  const project = await engine.createProject({ title: '实时' })
  const run = await engine.startRun(project.id)
  // 等第一条 stage-start 之后、run 还没结束时读盘
  await sleep(400)
  const onDisk = await new Store(root).readRun(run.id, project.id)
  assert.ok(onDisk, '运行中的 run.json 应该已经存在')
  assert.ok(onDisk.seq > 0, '运行中就有事件落盘，崩溃时不会整段丢失')
})

test('取消后阶段状态不再是 running（UI 不会一直显示在跑）', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-state-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({
    root,
    recipes: [makeMockRecipe({ review: false, betaDelayMs: 400 })],
    llm: createFakeLlm(),
  })
  const project = await engine.createProject({ title: '取消态' })
  const run = await engine.startRun(project.id)
  const started = Date.now()
  while (Date.now() - started < 4000) {
    const saved = await engine.getProject(project.id)
    if (saved.stages.beta?.items?.x1 === 'running') break
    await sleep(10)
  }
  await engine.cancelRun(run.id)
  const final = await waitRun(engine, run.id)
  assert.equal(final.status, 'cancelled')
  const saved = await engine.getProject(project.id)
  assert.notEqual(saved.stages.beta.status, 'running', '取消后 beta 不该停在 running')
  assert.equal(saved.stages.beta.status, 'partial')
  assert.equal(saved.stages.beta.items.x1, 'pending')
})

test('单个产物文件丢了，项目还能继续跑（重新生成而不是整本书报废）', async (t) => {
  const { root, engine } = await setup(t)
  const project = await engine.createProject({ title: '坏产物' })
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)
  const saved = await engine.getProject(project.id)
  assert.ok(saved.artifacts.a, 'alpha 应该已经写了 a')

  // 模拟手工清理 / 同步工具把文件删掉，project.json 里的 meta 还在。
  const store = new Store(root)
  await rm(store.artifactPath(project.id, 'a', 'json'), { force: true })

  const run = await engine.startRun(project.id, { stages: ['alpha'] })
  const final = await waitRun(engine, run.id)
  assert.equal(final.status, 'done', `不该整本书报废：${final.error?.message ?? ''}`)
  const warn = final.events.filter((event) => event.type === 'log' && event.data.level === 'warn')
  assert.ok(warn.some((event) => /a 已丢失或损坏/.test(event.data.message)), '应记录一条 warn')
  assert.ok(await engine.getArtifact(project.id, 'a'), '产物应被重新生成')
})

test('getRunEvents 返回 dropped，调用方知道历史被截断', async (t) => {
  const { engine } = await setup(t)
  const project = await engine.createProject({ title: '截断' })
  const final = await waitRun(engine, (await engine.startRun(project.id)).id)
  const page = await engine.getRunEvents(final.id, 0)
  assert.equal(typeof page.dropped, 'number')
  assert.equal(page.seq, final.seq)
})

test('safeKey 拒绝写保留目录 .versions', async () => {
  await assert.rejects(
    async () => (await import('../src/forge/text.js')).safeKey('.versions/x.1'),
    (err) => err.code === 'BAD_PARAMS',
  )
})

test('连续 LOG 事件与失败收尾并发时，run-error 不会被旧快照盖掉', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-state-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const recipe = makeMockRecipe({ review: false })
  recipe.stages[0].run = async (ctx) => {
    for (let i = 0; i < 40; i += 1) ctx.log(`第 ${i} 行`)
    throw Object.assign(new Error('boom'), { code: 'INTERNAL' })
  }
  const engine = new ForgeEngine({ root, recipes: [recipe], llm: createFakeLlm() })
  const project = await engine.createProject({ title: '并发落盘' })
  for (let round = 0; round < 5; round += 1) {
    const run = await engine.startRun(project.id, { force: true })
    const final = await waitRun(engine, run.id)
    assert.equal(final.status, 'error')
    // 终态写是异步落盘的：轮询到磁盘上的 seq 追上内存快照为止（上限 3 秒）。
    const file = join(root, 'projects', project.id, 'runs', `${run.id}.json`)
    let onDisk = null
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      onDisk = JSON.parse(await readFile(file, 'utf8'))
      if (onDisk.seq >= final.seq) break
      await sleep(5)
    }
    assert.ok(onDisk.events.some((event) => event.type === 'run-error'), `第 ${round + 1} 轮磁盘上缺 run-error`)
    assert.equal(onDisk.events.at(-1).type, 'run-error')
    assert.equal(onDisk.seq, final.seq)
  }
})

test('调用失败也要记账：失败的尝试不能记 0 次调用', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-account-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  // 模拟 llm.js 的重试收尾：抛错时把 attempts 挂在 detail 上（3 次尝试 = 2 次重试）
  const llm = {
    async generate() {
      throw new ForgeError('LLM_EMPTY', '模型返回了空文本', { attempts: 3, failedAttempts: 2 })
    },
  }
  const engine = new ForgeEngine({
    root,
    recipes: [makeMockRecipe({ review: false, onItemError: 'stop' })],
    llm,
  })
  const project = await engine.createProject({ title: '记账' })

  // beta 是唯一会调模型的阶段：首项失败即停（stop），所以只尝试了一个 item
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)
  const final = await waitRun(engine, (await engine.startRun(project.id, { stages: ['beta'] })).id)
  assert.equal(final.status, 'error')
  // 3 次尝试全部付过输入 token，账上必须是 3 次，不能是 0
  assert.equal(final.stats.calls, 3)
  assert.ok(final.stats.estTokensIn > 0, '失败调用也应记录输入 token')
  assert.equal(final.stats.estTokensOut, 0)

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stats.calls, 3, '项目级也要记上')
})

test('成功的重试链路按尝试次数记账', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-account2-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const llm = {
    async generate() {
      return { text: 'mock output', model: 'mock', chars: 11, attempts: 2, failedAttempts: 1 }
    },
  }
  const engine = new ForgeEngine({ root, recipes: [makeMockRecipe({ review: false })], llm })
  const project = await engine.createProject({ title: '记账 2' })
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)
  const final = await waitRun(engine, (await engine.startRun(project.id, { stages: ['beta'] })).id)
  const llmEvents = final.events.filter((event) => event.type === 'llm')
  assert.ok(llmEvents.length > 0)
  assert.equal(llmEvents[0].data.attempts, 2)
  assert.equal(final.stats.calls, 4, 'beta 两个 item × 每次 2 次尝试')
})
