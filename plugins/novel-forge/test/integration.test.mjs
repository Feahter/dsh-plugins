// 集成测试：真引擎 + 真小说配方 + 假提示词 + 假模型，落临时目录跑完整流水线。
// 证明"引擎 ↔ 配方 ↔ 存储 ↔ 导出"四层接得上，且不依赖网络/模型。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'

const PREMISE = '殡仪馆夜班的新人发现，停尸柜里的亡者会在凌晨三点开口说话'

function fakePrompts() {
  const one = () => ({ system: '你是小说家。', user: '写。', maxTokens: 4000, temperature: 0.8 })
  return {
    premise: one, bible: one, characters: one, spine: one, outline: one,
    beats: one, draft: one, summary: one, review: one, revise: one, blurb: one,
  }
}

const PROSE = [
  '雨落在灵堂的玻璃上，像有人用指甲一下一下地敲。沈砚把名册翻开，手指停在第三行。',
  '「你确定要查下去？」老周把搪瓷杯搁下，杯底和桌面碰出一声闷响。',
  '沈砚没答。他听见三号柜里有呼吸声，很轻，像隔着一层棉布。',
  '走廊尽头的灯闪了两下。老周的脸色在忽明忽暗里变得很难看。',
  '「三点之前必须走。」老周说，「这地方夜里不干净。」',
  '沈砚抬头看钟。两点五十七分。名册上的墨迹还没干透，散着一点腥气。',
  '三号柜的门自己弹开一条缝。白汽从缝里漫出来，贴着地面爬。',
  '他蹲下去，看见里面的人睁着眼。那张脸他认得，是昨天刚送来的老人。',
  '「你来了。」老人说。声音沙哑，像砂纸磨过木头。',
  '沈砚后退半步，后腰撞上推车。金属托盘上的器械哗啦响成一片。',
  '老周在门外喊他名字。他没回头，只盯着那双眼睛。',
  '「名册上第三行，」老人慢慢说，「写错了。」',
].join('\n\n')

function fakeLlm() {
  const calls = []
  const outlineChapters = Array.from({ length: 7 }, (_, index) => ({
    title: `第${index + 1}夜`,
    goal: `查清第 ${index + 1} 位亡者的遗愿`,
    conflict: '老周阻拦，名册被人改过',
    turn: '亡者说出一个活人的名字',
    hook: `名册第 ${index + 2} 行出现新的墨迹`,
    pov: '沈砚',
    when: '凌晨三点',
    where: '殡仪馆灵堂',
    cast: ['沈砚', '老周'],
  }))

  const payload = (opts) => {
    const phase = opts.phase ?? opts.label
    if (phase === 'premise') {
      return {
        title: '长夜将明',
        logline: PREMISE,
        theme: '记忆与告别',
        promise: '每章替一位亡者了结遗愿',
        ending: '沈砚烧掉名册，离开殡仪馆',
        genreTags: ['悬疑', '民俗'],
      }
    }
    if (phase === 'outline') {
      return { volumes: [{ title: '卷一 夜班', purpose: '入职与第一桩怪事', chapters: outlineChapters }] }
    }
    if (phase === 'beats') {
      return {
        title: '夜班',
        scenes: [
          { no: 1, where: '灵堂', when: '凌晨', cast: ['沈砚', '老周'], goal: '熟悉流程', obstacle: '老周支开他', turn: '听见柜中呼吸', exit: '名册第三行', sensory: '雨声与消毒水' },
          { no: 2, where: '三号柜', when: '三点', cast: ['沈砚', '亡者'], goal: '确认声音', obstacle: '恐惧', turn: '亡者开口', exit: '名册写错', sensory: '白汽与铁锈味' },
        ],
      }
    }
    if (phase === 'review') {
      return {
        findings: [{ severity: 'note', kind: 'pacing', where: '中段', issue: '节奏略慢', fix: '压缩一句' }],
        ledgerPatch: {
          facts: [{ text: '名册第三行被人改过', chapter: 'ch01' }],
          threads: [{ text: '谁改了名册', status: 'open' }],
          characters: { 沈砚: { location: '灵堂', state: '警觉', knows: ['亡者会说话'] } },
          timeline: [{ chapter: 'ch01', when: '凌晨三点', event: '老人开口' }],
        },
        verdict: 'pass',
      }
    }
    if (phase === 'characters') {
      return {
        cast: [
          { name: '沈砚', role: '主角', want: '查清名册真相', fear: '自己也在名册上', secret: '他能听见亡者说话', voice: '克制、短句', arc: '从旁观到承担' },
          { name: '老周', role: '守夜人', want: '平安退休', fear: '旧事败露', secret: '名册是他改的', voice: '油滑、爱打岔', arc: '从阻拦到坦白' },
        ],
      }
    }
    if (phase === 'blurb') {
      return '# 《长夜将明》\n\n一句话卖点：有些名字，死了才被写对\n\n## 简介\n殡仪馆夜班新人……\n\n## 标签\n悬疑 / 灵异'
    }
    if (phase === 'prose' || phase === 'revise') return PROSE
    if (phase === 'summary') return '沈砚第一夜值班，听见三号柜里的亡者开口，亡者说名册第三行写错了。'
    return '设定文本。'
  }

  return {
    calls,
    async generate(opts) {
      calls.push({ phase: opts.phase ?? opts.label, chars: (opts.user ?? '').length })
      const phase = opts.phase ?? opts.label
      if (phase === 'prose' || phase === 'revise' || phase === 'summary' || phase === 'bible' || phase === 'spine' || phase === 'blurb') {
        return { text: payload(opts), chars: 1000, model: 'fake' }
      }
      return { text: JSON.stringify(payload(opts)), chars: 1000, model: 'fake' }
    },
    async info() {
      return { available: true, provider: 'fake', model: 'fake' }
    },
  }
}

async function waitFor(fn, { timeout = 20_000, interval = 20 } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('等待超时')
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

async function setup(t, { reviewGate = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'novel-forge-it-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const llm = fakeLlm()
  const engine = new ForgeEngine({ root, recipes: [createNovelRecipe({ prompts: fakePrompts() })], llm })
  const project = await engine.createProject({
    title: '长夜将明',
    params: { premise: PREMISE, chapters: 6, wordsPerChapter: 800, pov: '第三人称限知', reviewGate },
  })
  return { engine, llm, project, root }
}

async function waitRun(engine, runId) {
  return waitFor(async () => {
    const run = await engine.getRun(runId)
    return run && run.status !== 'running' ? run : null
  })
}

test('整条流水线：6 章从故事核跑到导出', async (t) => {
  const { engine, llm, project } = await setup(t)
  const started = await engine.startRun(project.id, { autoApprove: true })
  const final = await waitRun(engine, started.id)

  assert.equal(final.status, 'done', JSON.stringify(final.error))
  assert.equal(final.options.autoReview, undefined) // 参数在 project.params 上
  assert.ok(llm.calls.length >= 30)

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.premise.status, 'done')
  assert.equal(saved.stages.draft.status, 'done')
  assert.equal(Object.keys(saved.stages.draft.items).length, 6)
  assert.equal(saved.activeRunId, null)
  assert.equal(saved.pendingReview, null)

  // 大纲裁剪：模型给 7 章，计划 6 章
  const outline = await engine.getArtifact(project.id, 'outline')
  assert.equal(outline.content.totalChapters, 6)
  assert.equal(outline.content.trimmed, 1)
  assert.equal(outline.content.chapters.at(-1).id, 'ch06')

  if (!(await engine.getArtifact(project.id, 'review/ch01'))) {
    console.log('STAGES', JSON.stringify(saved.stages, null, 2))
    console.log('LOGS', (await engine.getRun(final.id)).events.filter(e => e.type === 'log' || e.type === 'stage-end' || e.type === 'stage-start').map(e => `${e.type}:${JSON.stringify(e.data)}`).join('\n'))
  }
  // 每章四件套齐全
  for (const id of ['ch01', 'ch03', 'ch06']) {
    assert.ok(await engine.getArtifact(project.id, `beats/${id}`), `${id} beats`)
    const draft = await engine.getArtifact(project.id, `draft/${id}`)
    assert.match(draft.content, /^## 第\d+章/)
    assert.ok(await engine.getArtifact(project.id, `summary/${id}`), `${id} summary`)
    assert.ok(await engine.getArtifact(project.id, `review/${id}`), `${id} review`)
  }

  // 审校合并进了 ledger
  const ledger = await engine.getArtifact(project.id, 'ledger')
  assert.ok(ledger.content.facts.length >= 1)
  assert.ok(ledger.content.threads.some((thread) => thread.text.includes('名册')))

  // 领域统计：recipe.stats 钩子应把已写章节/字数写回 project.stats
  const afterStats = await engine.getProject(project.id)
  assert.equal(afterStats.stats?.drafted, 6)
  assert.ok((afterStats.stats?.words ?? 0) > 0, `words=${afterStats.stats?.words}`)
  assert.equal(afterStats.stats?.chapters, 6)

  // 导出 Markdown
  const exported = await engine.exportProject(project.id, 'md')
  const markdown = await readFile(exported.path, 'utf8')
  assert.match(markdown, /长夜将明/)
  assert.equal((markdown.match(/^## 第\d+章/gm) ?? []).length, 6)
  assert.ok(exported.bytes > 1000)

  // 导出 EPUB（epub-gen-memory 真打包，zip 头 PK）
  const epub = await engine.exportProject(project.id, 'epub')
  const epubBuffer = await readFile(epub.path)
  assert.equal(epubBuffer.subarray(0, 2).toString('latin1'), 'PK')
  assert.ok(epubBuffer.length > 2000, `epub ${epubBuffer.length} bytes`)
  assert.match(epub.filename, /\.epub$/)
})

test('reviewGate：大纲与草稿后各停一次，continue 能续跑', async (t) => {
  const { engine, project } = await setup(t, { reviewGate: true })
  const started = await engine.startRun(project.id)
  const first = await waitRun(engine, started.id)

  assert.equal(first.status, 'paused')
  const afterOutline = await engine.getProject(project.id)
  assert.equal(afterOutline.pendingReview.stage, 'outline')
  assert.deepEqual(afterOutline.pendingReview.nextStages, ['beats', 'draft', 'review', 'revise', 'blurb'])

  const second = await engine.startRun(project.id, { stages: afterOutline.pendingReview.nextStages })
  const secondRun = await waitRun(engine, second.id)
  assert.equal(secondRun.status, 'paused')
  const afterDraft = await engine.getProject(project.id)
  assert.equal(afterDraft.pendingReview.stage, 'draft')
  assert.deepEqual(afterDraft.pendingReview.nextStages, ['review', 'revise', 'blurb'])
  assert.equal(Object.keys(afterDraft.stages.draft.items).length, 6)

  const third = await engine.startRun(project.id, { stages: afterDraft.pendingReview.nextStages })
  const final = await waitRun(engine, third.id)
  assert.equal(final.status, 'done', JSON.stringify(final.error))

  const done = await engine.getProject(project.id)
  assert.equal(done.pendingReview, null)
  assert.equal(done.stages.revise.status, 'done')
  assert.ok(await engine.getArtifact(project.id, 'blurb'))
})

test('autoReview=false：审校/修订被跳过，导出仍可用', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'novel-forge-it-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({ root, recipes: [createNovelRecipe({ prompts: fakePrompts() })], llm: fakeLlm() })
  const project = await engine.createProject({
    params: { premise: PREMISE, chapters: 6, wordsPerChapter: 800, autoReview: false },
  })
  const final = await waitRun(engine, (await engine.startRun(project.id, { autoApprove: true })).id)
  assert.equal(final.status, 'done', JSON.stringify(final.error))
  assert.ok(!(await engine.getArtifact(project.id, 'review/ch01')))
  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.review.status, 'skipped')
  assert.ok(await engine.getArtifact(project.id, 'blurb'))
})
