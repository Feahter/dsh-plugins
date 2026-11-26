// 流水线四个确定缺陷的回归测试：审校失效、字数补写、check 产物、完成度分母。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import {
  createFakeCtx,
  textOut,
  sampleOutlineV2,
  sampleBeats,
  sampleProse,
  SAMPLE_PARAMS,
} from './fixtures/novel-fixtures.mjs'

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

function cjk(count) {
  const unit = '沈砚走进灵堂，雨声敲着玻璃。'
  return unit.repeat(Math.ceil(count / unit.length)).slice(0, count)
}

function draftCtx({ wordsPerChapter, body, outputs }) {
  const outline = sampleOutlineV2({ chapters: 6 })
  const chapter = outline.chapters[0]
  return createFakeCtx({
    params: { ...SAMPLE_PARAMS, wordsPerChapter, pov: '第三人称全知' },
    item: chapter,
    items: outline.chapters,
    artifacts: {
      outline: { kind: 'json', content: outline },
      [`beats/${chapter.id}`]: { kind: 'json', content: sampleBeats(chapter.id) },
    },
    outputs,
  })
}

// ---------------------------------------------------------------- R1

test('R1 review.isStale：draft 比 review 新 → 重审；更旧 / revise 回写 → 不重审', () => {
  const review = createNovelRecipe().stages.find((stage) => stage.id === 'review')
  assert.equal(typeof review.isStale, 'function')
  const stale = (draftAt, reviewAt, byStage = 'draft') =>
    review.isStale({
      key: 'review/ch001',
      artifact: { kind: 'json', meta: { updatedAt: reviewAt } },
      project: {
        artifacts: {
          'draft/ch001': { kind: 'md', updatedAt: draftAt, by: { stage: byStage } },
          'review/ch001': { kind: 'json', updatedAt: reviewAt },
        },
      },
    })

  assert.equal(
    stale('2026-11-24T15:28:33.222Z', '2026-11-22T16:16:40.997Z'),
    true,
    'force 重写正文后，旧审校必须失效',
  )
  assert.equal(stale('2026-11-20T10:00:00.000Z', '2026-11-22T16:16:40.997Z'), false, '正文比审校旧，不重审')
  assert.equal(
    stale('2026-11-24T15:28:33.222Z', '2026-11-22T16:16:40.997Z', 'revise'),
    false,
    'revise 回写正文不触发审校失效',
  )
})

// ---------------------------------------------------------------- R2

test('R2 字数不足（1000/4500）：调用一次续写，仍不足也落盘并带 length finding', async () => {
  const recipe = createNovelRecipe()
  const ctx = draftCtx({
    wordsPerChapter: 4500,
    outputs: [
      textOut(sampleProse({ body: cjk(1000), canon: { notes: [{ text: '雨夜值班' }] } })),
      textOut(cjk(200)),
    ],
  })
  const out = await recipe.stages.find((stage) => stage.id === 'draft').run(ctx)

  const toppedUp = ctx.calls.filter((call) => call.label === 'continue')
  assert.equal(toppedUp.length, 1, '字数不足应补写一次')
  assert.match(String(toppedUp[0].user), /【续写指令】/)
  assert.ok(out.artifacts['draft/ch01'], '补写后仍不足也要落盘')
  assert.ok(String(out.artifacts['draft/ch01'].content).length > cjk(1000).length, '补写内容应拼进正文')
  const check = out.artifacts['check/ch01']
  assert.ok(check, 'draft 阶段应落 check 产物')
  assert.ok(
    check.content.findings.some((finding) => finding.kind === 'length'),
    '仍不足时保留 length finding',
  )
})

test('R2 字数达标（4200/4500）：不调用续写', async () => {
  const recipe = createNovelRecipe()
  const ctx = draftCtx({
    wordsPerChapter: 4500,
    outputs: [textOut(sampleProse({ body: cjk(4200), canon: { notes: [{ text: '雨夜值班' }] } }))],
  })
  const out = await recipe.stages.find((stage) => stage.id === 'draft').run(ctx)
  assert.equal(ctx.calls.filter((call) => call.label === 'continue').length, 0, '达标不应多花一次调用')
  assert.equal(ctx.calls.length, 1)
  assert.ok(out.artifacts['draft/ch01'])
})

// ---------------------------------------------------------------- R3

test('R3 draft 落盘 check/<id>：findings/counts/verdict 不丢', async () => {
  const recipe = createNovelRecipe()
  const ctx = draftCtx({
    wordsPerChapter: 4500,
    outputs: [
      textOut(sampleProse({ body: cjk(120), canon: { notes: [{ text: '雨夜值班' }] } })),
      textOut(cjk(20)),
    ],
  })
  const out = await recipe.stages.find((stage) => stage.id === 'draft').run(ctx)
  assert.ok(Object.keys(out.artifacts).includes('check/ch01'))
  const content = out.artifacts['check/ch01'].content
  assert.deepEqual(Object.keys(content).sort(), ['counts', 'findings', 'verdict'])
  assert.ok(Array.isArray(content.findings) && content.findings.length > 0, 'commitChapter 的 findings 不能丢')
  for (const finding of content.findings) {
    assert.equal(typeof finding.severity, 'string')
    assert.equal(typeof finding.kind, 'string')
  }
  assert.equal(typeof content.counts, 'object')
  assert.ok(['pass', 'revise'].includes(content.verdict))
})

// ---------------------------------------------------------------- R4

function subsetRecipe(count = 50) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `ch${String(index + 1).padStart(3, '0')}`,
  }))
  return {
    id: 'subset',
    version: 1,
    title: 'Subset',
    paramsSchema: { type: 'object', properties: {}, additionalProperties: true },
    paramsDefaults: {},
    artifacts: { a: { kind: 'json' }, 'b/*': { kind: 'md' } },
    stages: [
      {
        id: 'alpha',
        title: 'Alpha',
        produces: ['a'],
        async run() {
          return { artifacts: { a: { kind: 'json', content: { items } } } }
        },
      },
      {
        id: 'beta',
        title: 'Beta',
        each: 'a.items',
        produces: ['b/*'],
        async run(ctx) {
          return { artifacts: { [`b/${ctx.item.id}`]: { kind: 'md', content: ctx.item.id } } }
        },
      },
    ],
  }
}

async function subsetRun(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'forge-subset-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({ root, recipes: [subsetRecipe()] })
  const project = await engine.createProject({ title: '定向子集' })
  const items = Array.from({ length: 20 }, (_, index) => `ch${String(index + 1).padStart(3, '0')}`)
  const run = await waitRun(
    engine,
    (await engine.startRun(project.id, { stages: ['alpha', 'beta'], items, autoApprove: true, ...options })).id,
  )
  return { engine, project, run }
}

test('R4 50 章只跑 ch001–ch020：阶段收尾 done，覆盖按子集 20/20', async (t) => {
  const { engine, project, run } = await subsetRun(t)
  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'done', `不应是 partial：${run.status}`)
  assert.equal(Object.values(saved.stages.beta.items).filter((status) => status === 'done').length, 20)
  const partialLog = run.events.find(
    (event) => event.type === 'log' && /仅完成 \d+\/\d+ 个条目/.test(event.data?.message ?? ''),
  )
  assert.equal(partialLog, undefined, '子集全部完成时不该出现「20/50」完成度告警')
})

test('R4 子集里有 1 条没完成：分母是本轮 20，不是全书 50', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'forge-subset-skip-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const recipe = subsetRecipe()
  recipe.stages[1].run = async (ctx) => {
    if (ctx.item.id === 'ch001') return { artifacts: {}, skipped: true, note: '还没轮到' }
    return { artifacts: { [`b/${ctx.item.id}`]: { kind: 'md', content: ctx.item.id } } }
  }
  const engine = new ForgeEngine({ root, recipes: [recipe] })
  const project = await engine.createProject({ title: '定向子集失败' })
  const items = Array.from({ length: 20 }, (_, index) => `ch${String(index + 1).padStart(3, '0')}`)
  const run = await waitRun(engine, (await engine.startRun(project.id, { stages: ['alpha', 'beta'], items, autoApprove: true })).id)
  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.beta.status, 'partial')
  const log = run.events.find(
    (event) => event.type === 'log' && /仅完成 \d+\/\d+ 个条目/.test(event.data?.message ?? ''),
  )
  assert.ok(log, '应有完成度告警')
  assert.match(log.data.message, /19\/20/, '分母应是本轮 20 条，而不是全书 50 条')
})
