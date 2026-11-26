import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { ForgeEngine } from '../src/forge/engine.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { createTools } from '../src/host/tools.js'
import { emptyCanon } from '../src/recipes/novel/canon.js'
import { prepareChapter } from '../src/recipes/novel/chapter.js'
import { SAMPLE_PARAMS, sampleBeats, sampleOutlineV2 } from './fixtures/novel-fixtures.mjs'

const ORIGINAL = '雨夜，沈砚在门外停下，手指按着把手。'
const EXTRA = '突然，白榆从门后走出，递来一枚铜印。'
const OLD_SUMMARY = '沈砚还在等门开。'

async function setup(t, failAt) {
  const root = await mkdtemp(join(tmpdir(), 'forge-continue-memory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prompt = user => ({ system: '测试', user })
  const prompts = {
    draft: () => prompt('写正文。'),
    summary: ctx => prompt(ctx.draft),
    canonPatch: ctx => prompt(ctx.summary),
    review: ctx => prompt(ctx.draft),
  }
  const requests = []
  const llm = {
    async generate(options) {
      requests.push(options)
      if (options.phase === failAt) throw new Error('模拟模型失败')
      switch (options.phase) {
        case 'prose': return { text: EXTRA }
        case 'summary': return { text: options.user }
        case 'canonPatch': return { text: JSON.stringify({ entities: { 白榆: { state: '已交出铜印' }, 未出场者: { lastSeen: 'ch01' } } }) }
        case 'review': return { text: '{"findings":[],"verdict":"pass"}' }
        default: assert.fail(`未预期的模型调用 ${options.phase}`)
      }
    },
  }
  const engine = new ForgeEngine({ root, recipes: [createNovelRecipe({ prompts })], llm })
  const { id } = await engine.createProject({ recipeId: 'novel', title: '续写记忆', params: { ...SAMPLE_PARAMS, autoReview: true } })
  const outline = sampleOutlineV2({ chapters: 3 })
  const [chapter, nextChapter] = outline.chapters
  const chapterId = chapter.id
  const put = (key, kind, content, stage = 'draft') => engine.writeArtifact(id, key, { kind, content }, { stage })
  const get = key => engine.getArtifact(id, key)
  await put('outline', 'json', outline)
  const beats = sampleBeats(chapterId)
  beats.scenes[0].cast = ['白榆', '未出场者']
  await put(`beats/${chapterId}`, 'json', beats)
  await put(`draft/${chapterId}`, 'md', ORIGINAL, 'manual')
  const oldSummary = await put(`summary/${chapterId}`, 'md', OLD_SUMMARY)
  const oldCanon = await put('canon', 'json', emptyCanon())
  await put(`review/${chapterId}`, 'json', { findings: [], verdict: 'pass' }, 'review')
  const project = await engine.getProject(id)
  project.artifacts[`review/${chapterId}`].updatedAt = '2000-01-01T00:00:00.000Z'
  project.stages.review = { status: 'done', items: { [chapterId]: 'done' } }
  await engine.store.saveProject(project)
  const next = createTools(engine).find(tool => tool.name === 'novel_next')
  return { engine, id, chapterId, get, next, requests, oldSummary, oldCanon, outline, nextChapter }
}

test('续写以合并全文重建记忆和检查，并让流水线重新审校', async t => {
  const { engine, id, chapterId, get, next, requests, outline, nextChapter } = await setup(t)
  assert.equal((await next.execute({})).progress.reviewed, 1)
  const result = await engine.continueChapter(id, chapterId)
  assert.deepEqual(result.warnings, [])
  assert.ok(result.afterChars > result.beforeChars)
  const summary = (await get(`summary/${chapterId}`)).content
  assert.ok(summary.includes(ORIGINAL) && summary.includes(EXTRA))
  assert.equal(requests.find(request => request.phase === 'canonPatch').user, summary)
  const canon = (await get('canon')).content
  assert.equal(canon.entities.白榆.state, '已交出铜印')
  assert.equal(canon.entities.白榆.lastSeen, chapterId)
  assert.ok(!canon.entities.未出场者?.lastSeen)
  const { findings } = (await get(`check/${chapterId}`)).content
  assert.ok(findings.length > 0)
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['fix', 'issue', 'kind', 'severity', 'where'])
  }
  const fresh = await engine.getProject(id)
  assert.equal(fresh.stages.review.items[chapterId], 'pending')
  assert.equal((await next.execute({})).progress.reviewed, 0)
  const prepared = await prepareChapter({ outline, chapterId: nextChapter.id, read: key => ({
    [`summary/${chapterId}`]: summary,
    [`beats/${nextChapter.id}`]: sampleBeats(nextChapter.id),
    canon,
  })[key] })
  assert.ok(prepared.packet.text.includes(EXTRA))

  const run = await engine.startRun(id, { stages: ['review'], items: [chapterId], autoApprove: true })
  for (let i = 0; i < 1000 && (await engine.getRun(run.id)).status === 'running'; i++) {
    await delay(20)
  }
  const final = await engine.getRun(run.id)
  assert.equal(final.status, 'done', JSON.stringify(final.events.slice(-5)))
  assert.equal(requests.find(request => request.phase === 'review').user, result.text)
  assert.equal((await next.execute({})).progress.reviewed, 1)
})

for (const phase of ['summary', 'canonPatch']) {
  test(`续写后 ${phase} 失败仍保存正文和检查，摘要与正典均保留旧版`, async t => {
    const { engine, id, chapterId, get, next, oldSummary, oldCanon } = await setup(t, phase)
    const result = await engine.continueChapter(id, chapterId)
    assert.ok(result.warnings.some(warning => warning.includes('模拟模型失败')))
    assert.ok((await get(`draft/${chapterId}`)).content.includes(EXTRA))
    assert.ok((await get(`check/${chapterId}`)).content.findings.length > 0)
    const summary = await get(`summary/${chapterId}`)
    const canon = await get('canon')
    assert.equal(summary.content, oldSummary.content)
    assert.equal(summary.meta.version, oldSummary.meta.version)
    assert.deepEqual(canon.content, oldCanon.content)
    assert.equal(canon.meta.version, oldCanon.meta.version)
    assert.equal((await engine.getProject(id)).stages.review.items[chapterId], 'pending')
    assert.equal((await next.execute({})).progress.reviewed, 0)
  })
}
