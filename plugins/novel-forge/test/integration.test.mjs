// 集成测试：真引擎 + 真小说配方 + 假提示词 + 假模型，落临时目录跑完整流水线。
// 证明"引擎 ↔ 配方 ↔ 存储 ↔ 导出"四层接得上，且不依赖网络/模型。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

import { ForgeEngine } from '../src/forge/engine.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'

const PREMISE = '殡仪馆夜班的新人发现，停尸柜里的亡者会在凌晨三点开口说话'

function fakePrompts() {
  const one = () => ({ system: '你是小说家。', user: '写。', maxTokens: 4000, temperature: 0.8 })
  // §12 的 12 个 builder：v0.2 没有 outline（骨架由脚本搭）。
  // 卷纲/细纲在 chapter.js 内部调用，不传 phase；用 user 前缀让假模型认得出阶段
  // （同时验证 createNovelRecipe({ prompts }) 真的把这两个 builder 注入进去了）。
  return {
    premise: one, bible: one, characters: one, spine: one,
    volumeChapters: () => ({ ...one(), user: '【卷纲】写。' }),
    beats: () => ({ ...one(), user: '【细纲】写。' }),
    draft: one, summary: one,
    canonPatch: one, review: one, revise: one, blurb: one,
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
  // 模型多给 1 章：v2 的卷纲展开仍按 targetChapters 截断。标题故意不带「第 N 章」，
  // 让 normalizeProse 统一拼章头。
  const chapterRows = Array.from({ length: 7 }, (_, index) => ({
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

  // chapter.js 的卷纲/细纲调用不带 phase：只能靠 prompt 文本认阶段。
  const promptKind = (opts = {}) => {
    const text = `${opts.system ?? ''}\n${opts.user ?? ''}`
    if (text.includes('【卷纲】')) return 'volumeChapters'
    if (text.includes('【细纲】')) return 'beats'
    return null
  }

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
    if (phase === 'characters') {
      return {
        cast: [
          { name: '沈砚', role: '主角', gender: '男', want: '查清名册真相', fear: '自己也在名册上', secret: '他能听见亡者说话', voice: '克制、短句', arc: '从旁观到承担' },
          { name: '老周', role: '守夜人', gender: '男', want: '平安退休', fear: '旧事败露', secret: '名册是他改的', voice: '油滑、爱打岔', arc: '从阻拦到坦白' },
        ],
      }
    }
    if (phase === 'spine') {
      // v0.2：spine 是 JSON，卷数与脚本的卷计划对齐（6 章 / 每卷 30 → 1 卷）。
      return {
        mainline: '沈砚从替亡者了结遗愿，走到承认自己也在名册上',
        ending: '他在头七夜里烧掉名册，留下殡仪馆的钥匙',
        volumes: [
          {
            title: '卷一 夜班',
            goal: '入职并接下第一桩亡者遗愿',
            arc: '从怕鬼到敢听亡者说话',
            cast: ['沈砚', '老周'],
            opens: ['名册第三行是谁改的'],
            closes: [],
          },
        ],
      }
    }
    if (phase === 'volumeChapters') {
      return { chapters: chapterRows }
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
    if (phase === 'canonPatch') {
      return {
        facts: [{ s: '名册', p: '第三行', o: '被人改过' }],
        threads: [{ text: '谁改了名册', status: 'open' }],
        entities: { 沈砚: { location: '灵堂', state: '警觉', knows: ['亡者会说话'] } },
      }
    }
    if (phase === 'review') {
      // v0.2 写 canonPatch；ledgerPatch 只用于兼容旧工程。
      return {
        findings: [{ severity: 'note', kind: 'pacing', where: '中段', issue: '节奏略慢', fix: '压缩一句' }],
        canonPatch: {
          facts: [{ s: '名册', p: '第三行', o: '被人改过' }],
          notes: [{ text: '名册第三行的墨迹是新的' }],
          threads: [{ text: '谁改了名册', status: 'open' }],
          entities: { 沈砚: { location: '灵堂', state: '警觉', knows: ['亡者会说话'] } },
          timeline: [{ when: '凌晨三点', event: '老人开口' }],
        },
        verdict: 'pass',
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
      const explicit = opts.phase ?? opts.label
      const phase = explicit ?? promptKind(opts)
      calls.push({ phase, chars: (opts.user ?? '').length })
      const value = payload({ ...opts, phase })
      // spine 在 v0.2 是 JSON；文本阶段只有正文/摘要/设定/简介。
      if (phase === 'prose' || phase === 'revise' || phase === 'summary' || phase === 'bible' || phase === 'blurb') {
        return { text: value, chars: 1000, model: 'fake' }
      }
      return { text: JSON.stringify(value), chars: 1000, model: 'fake' }
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

  const saved = await engine.getProject(project.id)
  assert.equal(saved.stages.premise.status, 'done')
  assert.equal(saved.stages.spine.status, 'done')
  assert.equal(saved.stages.outline.status, 'done')
  assert.equal(saved.stages.draft.status, 'done')
  assert.equal(Object.keys(saved.stages.draft.items).length, 6)

  // §3 的九段阶段表，一条流水线跑下来全部完成。
  const STAGES = ['premise', 'bible', 'characters', 'spine', 'outline', 'draft', 'review', 'revise', 'blurb']
  assert.deepEqual(Object.keys(saved.stages).sort(), [...STAGES].sort())
  for (const id of STAGES) assert.equal(saved.stages[id].status, 'done', `${id} 应当完成`)
  assert.equal(saved.activeRunId, null)
  assert.equal(saved.pendingReview, null)

  // 大纲：脚本搭 6 章骨架，卷纲模型多给 1 章，按 targetChapters 截掉。
  const outline = await engine.getArtifact(project.id, 'outline')
  assert.equal(outline.content.version, 2)
  assert.equal(outline.content.totalChapters, 6)
  assert.equal(outline.content.chapters.length, 6)
  assert.deepEqual(outline.content.chapters.map((chapter) => chapter.id), ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'])
  assert.equal(outline.content.volumes.length, 1)
  assert.equal(outline.content.volumes[0].id, 'v01')
  assert.equal(outline.content.volumes[0].planned, true)
  assert.equal(outline.content.volumes[0].targetChapters, 6)

  // v2 的调用计数：8 个单次阶段之外，每章「细纲 + 正文 + 摘要 + 正典补丁 + 审校」。
  const count = (phase) => llm.calls.filter((call) => call.phase === phase).length
  assert.equal(count('volumeChapters'), 1, '短篇一次展开全部卷')
  assert.equal(count('beats'), 6)
  assert.equal(count('prose'), 6)
  // 正文没带内联摘要/正典补丁时各补一次；命中 warn 的章还会被修订并重新摘要。
  assert.ok(count('summary') >= 6, `summary=${count('summary')}`)
  assert.equal(count('canonPatch'), 6)
  assert.equal(count('review'), 6)
  assert.ok(llm.calls.length >= 30, `calls=${llm.calls.length}`)

  // 每章四件套齐全（细纲在 draft 阶段补，不再有独立 beats 阶段）
  for (const id of ['ch01', 'ch03', 'ch06']) {
    assert.ok(await engine.getArtifact(project.id, `beats/${id}`), `${id} beats`)
    const draft = await engine.getArtifact(project.id, `draft/${id}`)
    assert.match(draft.content, /^## 第\d+章/)
    assert.ok(await engine.getArtifact(project.id, `summary/${id}`), `${id} summary`)
    assert.ok(await engine.getArtifact(project.id, `review/${id}`), `${id} review`)
  }

  // 审校补丁合并进了 canon.json（v1 的 ledger.json 不再写）
  const canon = await engine.getArtifact(project.id, 'canon')
  assert.equal(canon.content.version, 2)
  assert.ok(canon.content.facts.some((fact) => fact.o === '被人改过'))
  assert.ok(canon.content.notes.some((note) => note.text.includes('名册第三行')))
  assert.ok(canon.content.threads.some((thread) => thread.text.includes('名册')))
  assert.equal(await engine.getArtifact(project.id, 'ledger'), null)

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

  // 解包核对：6 章各自一个 xhtml，且正文真的进了书里（没有 unzip 就跳过）。
  const listing = await new Promise((resolve) => {
    execFile('unzip', ['-l', epub.path], (error, stdout) => resolve(error ? null : stdout))
  })
  if (listing) {
    const chapters = (listing.match(/OEBPS\/\d+_\d+-\d+\.xhtml/g) ?? []).length
    assert.equal(chapters, 6, listing)
    const first = await new Promise((resolve) => {
      execFile('unzip', ['-p', epub.path, 'OEBPS/0_1-1.xhtml'], (error, stdout) => resolve(error ? '' : stdout))
    })
    assert.match(first, /第1章/)
  }
})

test('reviewGate：大纲与草稿后各停一次，continue 能续跑', async (t) => {
  const { engine, project } = await setup(t, { reviewGate: true })
  const gates = []
  let run = await engine.startRun(project.id)
  let final = null
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await waitRun(engine, run.id)
    if (result.status !== 'paused') {
      final = result
      break
    }
    const paused = await engine.getProject(project.id)
    gates.push(paused.pendingReview.stage)
    if (gates.length === 1) {
      assert.equal(paused.pendingReview.stage, 'outline')
      assert.deepEqual(paused.pendingReview.nextStages, ['draft', 'review', 'revise', 'blurb'])
    }
    if (gates.length === 2) {
      assert.equal(paused.pendingReview.stage, 'draft')
      assert.deepEqual(paused.pendingReview.nextStages, ['review', 'revise', 'blurb'])
      assert.equal(Object.keys(paused.stages.draft.items).length, 6)
    }
    run = await engine.startRun(project.id, { stages: paused.pendingReview.nextStages })
  }

  // v2 的 gate 挂在 outline/draft/review/revise 四段上；关键是前两次停在
  // 「大纲可以否掉」和「草稿可以否掉」的位置，且继续跑一定能收尾。
  assert.deepEqual(gates.slice(0, 2), ['outline', 'draft'])
  assert.ok(gates.length >= 2)
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

test('window：一轮最多推进 N 章，没排到的章 defer 成 pending，下一轮从断点接着写', async (t) => {
  const { engine, project } = await setup(t)
  const boot = await engine.startRun(project.id, { stages: ['premise', 'bible', 'characters', 'spine', 'outline'] })
  await waitRun(engine, boot.id)

  const first = await engine.startRun(project.id, { stages: ['draft'], window: 2 })
  await waitRun(engine, first.id)
  const afterFirst = await engine.getProject(project.id)
  const draftedOnce = Object.keys(afterFirst.artifacts).filter(key => key.startsWith('draft/'))
  assert.deepEqual(draftedOnce.sort(), ['draft/ch01', 'draft/ch02'], '一轮只写 2 章')
  // defer 而不是静默 done：否则阶段显示完成、后续 run 直接跳过，永远写不完。
  assert.equal(afterFirst.stages.draft.status, 'partial')
  assert.equal(afterFirst.stages.draft.items.ch03, 'pending', '第一个被推迟的章记 pending')
  assert.deepEqual(Object.keys(afterFirst.stages.draft.items).sort(), ['ch01', 'ch02', 'ch03'], '推迟后就停手，不再逐个登记')

  const second = await engine.startRun(project.id, { stages: ['draft'], window: 2 })
  await waitRun(engine, second.id)
  const afterSecond = await engine.getProject(project.id)
  const draftedTwice = Object.keys(afterSecond.artifacts).filter(key => key.startsWith('draft/'))
  assert.deepEqual(draftedTwice.sort(), ['draft/ch01', 'draft/ch02', 'draft/ch03', 'draft/ch04'])

  const third = await engine.startRun(project.id, { stages: ['draft'], window: 10 })
  await waitRun(engine, third.id)
  const afterThird = await engine.getProject(project.id)
  const drafts = Object.keys(afterThird.artifacts).filter(key => key.startsWith('draft/'))
  assert.equal(drafts.length, 6, '窗口大于剩余章数时一次补齐')
  assert.equal(afterThird.stages.draft.status, 'done')
})

test('window + force：force 重跑也受窗口限制，只重写候选章的前 N 个', async (t) => {
  const { engine, llm, project } = await setup(t)
  const boot = await engine.startRun(project.id, { stages: ['premise', 'bible', 'characters', 'spine', 'outline'] })
  await waitRun(engine, boot.id)

  // 先按窗口写完 4 章，后 2 章留到下一轮。
  const first = await engine.startRun(project.id, { stages: ['draft'], window: 4 })
  await waitRun(engine, first.id)
  const afterFirst = await engine.getProject(project.id)
  assert.deepEqual(
    Object.keys(afterFirst.artifacts).filter(key => key.startsWith('draft/')).sort(),
    ['draft/ch01', 'draft/ch02', 'draft/ch03', 'draft/ch04'],
    '先写完 4 章',
  )

  // force 会把 6 章全塞进 work；候选章仍按章序取前 window 个，不能因为「已有草稿」就永不 defer。
  const proseBefore = llm.calls.filter((call) => call.phase === 'prose').length
  const forced = await engine.startRun(project.id, { stages: ['draft'], force: true, window: 2 })
  const run = await waitRun(engine, forced.id)
  const rewritten = llm.calls.filter((call) => call.phase === 'prose').length - proseBefore
  assert.equal(rewritten, 2, `force + window=2 应只重写 2 章，实际 ${rewritten} 章`)

  const after = await engine.getProject(project.id)
  assert.equal(after.stages.draft.status, 'partial', '还有候选章没写，阶段不能标 done')
  assert.equal(after.stages.draft.items.ch03, 'pending', '第 3 个候选章 defer 成 pending')
  assert.equal(run.status, 'done', 'run 本身正常结束，窗口只影响阶段完成度')
  assert.equal(after.stages.draft.items.ch04, 'done', '推迟后就停手，ch04 保持上一轮的结果')
})

test('window + 占位草稿：占位章算候选，同样受窗口限制', async (t) => {
  const { engine, llm, project } = await setup(t)
  const boot = await engine.startRun(project.id, { stages: ['premise', 'bible', 'characters', 'spine', 'outline'] })
  await waitRun(engine, boot.id)
  const first = await engine.startRun(project.id, { stages: ['draft'], window: 2 })
  await waitRun(engine, first.id)

  // 历史行为会把模型回声写进 draft/*；isStale 视其为未完成，这一章必须重写。
  await engine.writeArtifact(project.id, 'draft/ch01', {
    kind: 'md',
    content: '正文缺失，无法修订。请重写。',
  })

  const proseBefore = llm.calls.filter((call) => call.phase === 'prose').length
  const second = await engine.startRun(project.id, { stages: ['draft'], window: 2 })
  await waitRun(engine, second.id)
  const rewritten = llm.calls.filter((call) => call.phase === 'prose').length - proseBefore
  // 候选按章序是 [ch01(占位), ch03, ch04, …]：占位章也占窗口名额，不能白嫖成第 3 章。
  assert.equal(rewritten, 2, `占位章应和缺章一起占窗口，实际写了 ${rewritten} 章`)

  const after = await engine.getProject(project.id)
  assert.deepEqual(
    Object.keys(after.artifacts).filter(key => key.startsWith('draft/')).sort(),
    ['draft/ch01', 'draft/ch02', 'draft/ch03'],
    '本轮只补占位 ch01 与缺章 ch03',
  )
  assert.equal(after.stages.draft.status, 'partial')
  assert.equal(after.stages.draft.items.ch04, 'pending', '第 3 个候选章 defer 成 pending')
})
