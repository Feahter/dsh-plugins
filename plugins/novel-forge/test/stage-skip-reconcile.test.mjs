// 「现在做不了」不能被记成「已完成」。
// 2026-11-23 真实事故：墨炉只写了 10 章正文，审校/修订却显示 50/47 章完成——
// review/revise 对没有正文的章返回空产物，引擎一律记 done；续跑时这些章还会被当成已完成永久跳过。
// 这里锁三件事：引擎认 skipped、recipe 的跳过路径标 skipped、历史假 done 能被 reconcile 回收。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { createFakeLlm, makeMockRecipe } from './fixtures/mock-recipe.mjs'
import { createNovelRecipe } from '../src/recipes/novel/index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitRun(engine, runId, timeout = 5000) {
  const started = Date.now()
  for (;;) {
    const run = await engine.getRun(runId)
    if (run.status !== 'running' && run.endedAt) return run
    if (Date.now() - started > timeout) throw new Error('timeout waiting for run')
    await sleep(10)
  }
}

async function setup(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'forge-skip-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({ root, recipes: [makeMockRecipe({ review: false, ...options })], llm: createFakeLlm() })
  return { root, engine }
}

test('引擎：skipped 的条目记 skipped、不算进度、阶段 partial，下次运行还会再试', async (t) => {
  const { engine } = await setup(t, { skipIds: ['x1'] })
  const project = await engine.createProject({ title: '跳过' })
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)

  const first = await waitRun(engine, (await engine.startRun(project.id, { stages: ['beta'] })).id)
  let saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.items.x1, 'skipped', '没有产物的「做不了」不能记 done')
  assert.equal(saved.stages.beta.items.x2, 'done')
  assert.equal(saved.stages.beta.status, 'partial', '有 skipped 条目时阶段不能标完成')
  assert.equal(first.progress.done, 1, 'beta 只有 x2 算完成，skipped 不占进度')
  assert.equal(first.progress.total, 2, 'skipped 的条目仍在待办总数里（只是没完成）')

  // 再跑一遍：skipped 不是「已完成」，必须重新进入工作队列（而不是被 #isComplete 跳过）。
  const second = await waitRun(engine, (await engine.startRun(project.id, { stages: ['beta'] })).id)
  saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.items.x1, 'skipped')
  const notes = second.events.filter((event) => event.type === 'log' && /跳过 x1/.test(event.data.message ?? ''))
  assert.equal(notes.length, 1, '第二次运行仍应尝试 x1 并记录跳过原因')
})

test('novel：没有正文时 review / revise 返回 skipped 而不是空产物', async (t) => {
  const recipe = createNovelRecipe()
  const review = recipe.stages.find((stage) => stage.id === 'review')
  const revise = recipe.stages.find((stage) => stage.id === 'revise')
  const bareCtx = (item) => ({
    item,
    params: {},
    has: () => false,
    read: () => null,
    text: () => '',
    json: () => null,
    readJson: () => null,
  })

  const reviewOut = await review.run(bareCtx({ id: 'ch011' }))
  assert.equal(reviewOut.skipped, true, '还没写正文的章，审校是「现在做不了」')
  assert.deepEqual(reviewOut.artifacts, {})

  const reviseOut = await revise.run(bareCtx({ id: 'ch011' }))
  assert.equal(reviseOut.skipped, true, '还没审校的章，修订是「现在做不了」')
  assert.deepEqual(reviseOut.artifacts, {})
})

test('novel.reconcile：回收 review/revise 的假 done，skipped/error 不动', () => {
  const recipe = createNovelRecipe()
  const project = {
    stages: {
      review: {
        status: 'done',
        items: { ch001: 'done', ch002: 'done', ch003: 'skipped', ch004: 'error' },
      },
      revise: {
        status: 'done',
        items: { ch001: 'done', ch002: 'done', ch003: 'done' },
      },
    },
    artifacts: {
      'review/ch001': { kind: 'json' },
      'draft/ch001': { kind: 'md' },
      'draft/ch002': { kind: 'md' },
    },
  }
  const changed = recipe.reconcile(project)
  assert.equal(changed, 3, 'ch002 没审校（review+revise 都假）、ch003 没正文（revise 假），共 3 条')
  assert.equal(project.stages.review.items.ch001, 'done', '有审校产物的是真完成')
  assert.equal(project.stages.review.items.ch002, 'pending')
  assert.equal(project.stages.review.items.ch003, 'skipped', 'skipped 是诚实的中间态，不回退')
  assert.equal(project.stages.review.items.ch004, 'error')
  assert.equal(project.stages.revise.items.ch001, 'done')
  assert.equal(project.stages.revise.items.ch002, 'pending', '没审校过的章，修订的 done 也是假的')
  assert.equal(project.stages.revise.items.ch003, 'pending')
  assert.equal(project.stages.review.status, 'partial')
  assert.equal(project.stages.revise.status, 'partial')
  assert.equal(recipe.reconcile(project), 0, '收敛后再次校正应为 0（幂等）')
})

test('引擎：读项目时应用 reconcile 并落盘', async (t) => {
  const { engine } = await setup(t, { skipIds: [] })
  const recipe = engine.recipes.get('mock')
  // 只认「这一阶段真的为该条写过产物」：b/x1 有产物才算完成。
  recipe.reconcile = (project) => {
    const items = project?.stages?.beta?.items ?? {}
    let changed = 0
    for (const [id, status] of Object.entries(items)) {
      if (status !== 'done' || project.artifacts?.[`b/${id}`]) continue
      items[id] = 'pending'
      changed += 1
    }
    if (changed && project.stages.beta.status === 'done') project.stages.beta.status = 'partial'
    return changed
  }

  const project = await engine.createProject({ title: '校正' })
  await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha'] })).id)
  const stale = await engine.store.readProject(project.id)
  stale.stages.beta = { status: 'done', items: { x1: 'done', x2: 'done' } }
  await engine.store.saveProject(stale)

  const fixed = await engine.getProject(project.id)
  assert.equal(fixed.stages.beta.items.x1, 'pending')
  assert.equal(fixed.stages.beta.status, 'partial')

  // 必须落盘，而不只是改了返回对象。
  const onDisk = await engine.store.readProject(project.id)
  assert.equal(onDisk.stages.beta.items.x1, 'pending')
})

test('novel.reconcile：draft 重写晚于 review → 审校回退 pending；revise 回写不算', () => {
  const recipe = createNovelRecipe()
  const project = {
    stages: {
      review: { status: 'done', items: { ch001: 'done', ch002: 'done' } },
      revise: { status: 'done', items: { ch001: 'done', ch002: 'done' } },
    },
    artifacts: {
      'draft/ch001': { kind: 'md', updatedAt: '2026-11-24T15:28:33.222Z', by: { stage: 'draft' } },
      'review/ch001': { kind: 'json', updatedAt: '2026-11-22T16:16:40.997Z' },
      'draft/ch002': { kind: 'md', updatedAt: '2026-11-24T15:28:33.222Z', by: { stage: 'revise' } },
      'review/ch002': { kind: 'json', updatedAt: '2026-11-22T16:16:40.997Z' },
    },
  }
  assert.equal(recipe.reconcile(project), 1)
  assert.equal(project.stages.review.items.ch001, 'pending', '旧稿审校必须重审')
  assert.equal(project.stages.review.items.ch002, 'done', 'revise 回写不触发审校失效（否则来回打转）')
  assert.equal(project.stages.review.status, 'partial')
})
