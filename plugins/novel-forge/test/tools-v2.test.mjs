// tools-v2.test.mjs — v0.2 agent-first 工具层：novel_next / novel_context /
// novel_commit / novel_audit / novel_plan，以及 novel_status / novel_run 的改动。
// 全部用内存 fake engine：不联网、不碰磁盘、不调真模型。
// 运行：node --test test/tools-v2.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import { createTools } from '../src/host/tools.js'
import { buildOutlineSkeleton, mergeVolumeChapters } from '../src/recipes/novel/plan.js'
import { emptyCanon, mergeCanon } from '../src/recipes/novel/canon.js'

const PARAMS = {
  genre: '悬疑',
  chapters: 6,
  wordsPerChapter: 220,
  pov: '第三人称限知',
  contextBudget: 6000,
  language: 'zh',
}

const CHAPTER_PARAMS = {
  wordsPerChapter: 220,
  pov: '第三人称限知',
  contextBudget: 6000,
  language: 'zh',
}

/** 15 段、约 200 字、对话占比约 9.5%，在 craft 的干净区间内。 */
function cleanProse() {
  return [
    '雨停的时候，巷口的灯刚亮。',
    '「你来晚了。」陈婆把门推开一条缝。',
    '他侧身挤进去，闻到很重的香灰味。',
    '堂屋正中摆着一张旧桌。',
    '桌上压着一本没有封皮的账册。',
    '「别碰。」陈婆的声音从背后追上来。',
    '他停住手，指尖离纸页只差一寸。',
    '纸页边缘有烧过的痕迹。',
    '窗外有人拖着铁链走过。',
    '陈婆忽然压低嗓子说：「今晚别住西厢。」',
    '「为什么？」他问。',
    '西厢的门在风里轻轻响了一声。',
    '「我记住了。」他说。',
    '灯芯爆了一下，屋里暗了半寸。',
    '账册自己翻到了最后一页。',
  ].join('\n\n')
}

function rowsFor(count, prefix = '章') {
  return Array.from({ length: count }, (_, i) => ({
    title: `${prefix}${i + 1}`,
    goal: `目标${i + 1}`,
    conflict: `阻碍${i + 1}`,
    turn: `转折${i + 1}`,
    hook: `钩子${i + 1}`,
    pov: '第三人称限知',
    when: `第${i + 1}天`,
    where: '殡仪馆',
    cast: [],
  }))
}

/** 只建骨架、卷表全空的 v2 大纲（第一次 novel_next 的状态）。 */
function skeletonOutline({ chapters = 6, per = 6 } = {}) {
  return buildOutlineSkeleton({ chapters, chaptersPerVolume: per, language: 'zh' })
}

/** 所有卷都已展开、章表齐的 v2 大纲。 */
function plannedOutline({ chapters = 6, per = 6, prefix = '章' } = {}) {
  const base = skeletonOutline({ chapters, per })
  let outline = base
  for (const volume of base.volumes) {
    outline = mergeVolumeChapters(outline, volume.id, rowsFor(Number(volume.targetChapters), prefix))
  }
  return outline
}

const beatsPayload = {
  scenes: [
    { goal: '进殡仪馆', obstacle: '陈婆拦门', turn: '账本空白', detail: '香灰落在纸页上' },
  ],
  hook: '最后一页写着一个名字',
  cast: [],
}

function fakeLlm(handler) {
  const calls = []
  return {
    calls,
    async generate(spec) {
      calls.push(spec)
      return handler(spec, calls.length - 1)
    },
  }
}

/** 足够多的事实，用来验证 packet 真的按 contextBudget 裁过。 */
function fatCanon(facts = 60) {
  return mergeCanon(
    emptyCanon(),
    {
      facts: Array.from({ length: facts }, (_, i) => ({
        s: `人物${i}`,
        p: '位置',
        o: `地点${i}的详细描述`,
        chapter: 'ch01',
      })),
    },
    { chapter: 'ch01' },
  )
}

function stagesFixture() {
  const stages = {}
  for (const id of ['premise', 'bible', 'characters', 'spine', 'outline']) {
    stages[id] = { status: 'done', items: {} }
  }
  for (const id of ['draft', 'review', 'revise', 'blurb']) {
    stages[id] = { status: 'idle', items: {} }
  }
  // v1 遗留阶段：v2 渲染必须忽略它。
  stages.beats = { status: 'done', items: {} }
  return stages
}

/**
 * 内存 fake engine + 项目。
 * files 是唯一的产物存储；project.artifacts 是写进 project.json 的索引。
 */
function makeHarness({
  outline = null,
  canon = null,
  ledger = null,
  characters = null,
  params = {},
  drafts = {},
  summaries = {},
  beats = {},
  reviews = [],
  llm = null,
} = {}) {
  const project = {
    id: 'proj-wu',
    title: '雾城纪事',
    recipe: 'novel',
    params: { ...PARAMS, ...params },
    stats: { chapters: 6, drafted: 0, words: 0 },
    stages: stagesFixture(),
    artifacts: {},
    activeRunId: null,
    pendingReview: null,
    updatedAt: '2026-11-12T09:00:00.000Z',
  }

  const files = new Map()
  const put = (key, content, kind = 'json') => files.set(key, { kind, content, version: 1 })
  if (outline) put('outline', outline)
  if (canon) put('canon', canon)
  if (ledger) put('ledger', ledger)
  if (characters) put('characters', characters)
  for (const [id, content] of Object.entries(beats)) put(`beats/${id}`, content)
  for (const [id, content] of Object.entries(summaries)) put(`summary/${id}`, content, 'md')
  for (const [id, content] of Object.entries(drafts)) put(`draft/${id}`, content, 'md')
  for (const id of reviews) put(`review/${id}`, { verdict: 'pass' }, 'json')

  for (const [key, entry] of files) project.artifacts[key] = { kind: entry.kind, version: entry.version }

  const calls = { read: [], writeArtifact: [], startRun: [] }

  const engine = {
    llm,
    calls,
    files,
    async listProjects() {
      return [project]
    },
    async resolveProject(hint) {
      if (!hint || hint === 'active' || hint === project.id || project.title.includes(String(hint))) return project
      const error = new Error(`没有项目：${hint}`)
      error.status = 404
      throw error
    },
    async getArtifact(_projectId, key) {
      calls.read.push(key)
      const entry = files.get(key)
      return entry ? { key, kind: entry.kind, content: entry.content, meta: { kind: entry.kind, version: entry.version } } : null
    },
    async writeArtifact(_projectId, key, spec, by = {}) {
      const version = (files.get(key)?.version ?? 0) + 1
      files.set(key, { kind: spec.kind, content: spec.content, version })
      project.artifacts[key] = { kind: spec.kind, version }
      calls.writeArtifact.push({ key, kind: spec.kind, content: spec.content, by })
      return { key, kind: spec.kind, content: spec.content, meta: { kind: spec.kind, version } }
    },
    async startRun(_projectId, options = {}) {
      calls.startRun.push(options)
      return { id: 'run-1', status: 'running', options }
    },
    async listRuns() {
      return []
    },
    async cancelRun(id) {
      return { id, status: 'cancelled' }
    },
    async estimate() {
      return { calls: 1, estTokensIn: 1000, estTokensOut: 500, chapters: 6 }
    },
    async exportProject() {
      return { path: '/tmp/book.md', mime: 'text/markdown', bytes: 100 }
    },
  }

  const draftIds = Object.keys(drafts)
  project.stats.drafted = draftIds.length
  project.stats.words = draftIds.reduce((sum, id) => sum + Array.from(String(drafts[id])).length, 0)
  if (outline?.totalChapters) project.stats.chapters = outline.totalChapters

  return { project, engine, files, calls }
}

function toolFor(engine, name) {
  const found = createTools(engine).find(item => item.name === name)
  assert.ok(found, `缺少工具 ${name}`)
  return found
}

async function run(engine, name, args = {}) {
  const tool = toolFor(engine, name)
  const value = await tool.execute(args)
  return { tool, value, text: tool.output.render({}, value).map(part => part.text).join('\n') }
}

// ---------------------------------------------------------------- novel_status

test('novel_status：阶段顺序是 v2 的 9 段（无 beats），并报计划章数 / 卷数与正典统计', async () => {
  const canon = mergeCanon(
    emptyCanon(),
    {
      facts: [{ s: '林砚', p: '状态', o: '死亡', chapter: 'ch03' }],
      notes: [{ text: '夜里不点灯' }],
      threads: [{ text: '失踪的账册', opened: 'ch01', status: 'open' }],
      entities: { 林砚: { role: '入殓师' } },
    },
    { chapter: 'ch03' },
  )
  const { engine } = makeHarness({ outline: plannedOutline(), canon, drafts: { ch01: cleanProse() } })
  const { value, text } = await run(engine, 'novel_status')

  assert.equal(value.outline.plannedChapters, 6)
  assert.equal(value.outline.totalChapters, 6)
  assert.equal(value.outline.plannedVolumes, 1)
  assert.equal(value.canon.stats.facts, 1)
  assert.equal(value.canon.stats.notes, 1)
  assert.equal(value.canon.stats.openThreads, 1)
  assert.equal(value.canon.stats.dead, 1)

  assert.match(text, /计划 6 章 · 已展开 1 卷/)
  assert.match(text, /正典：1 条事实/)
  assert.ok(!text.includes('beats'), 'v2 阶段行不该再出现 beats')

  const order = ['premise', 'bible', 'characters', 'spine', 'outline', 'draft', 'review', 'revise', 'blurb']
  let last = -1
  for (const id of order) {
    const at = text.indexOf(` ${id}`)
    assert.ok(at > last, `${id} 的顺序不对`)
    last = at
  }
})

test('novel_status：v1 项目（没有 canon，只有 ledger）不崩，且读时不落盘', async () => {
  const v1Outline = {
    chapters: [{ title: '雨夜' }, { title: '账册' }],
    volumes: [{ title: '第一卷' }],
  }
  const ledger = {
    facts: [{ text: '林砚|位置|殡仪馆' }],
    threads: [{ text: '失踪的账册', opened: 'ch01', status: 'open' }],
  }
  const { engine, calls, files } = makeHarness({
    outline: v1Outline,
    ledger,
    characters: { cast: [{ name: '林砚', role: '入殓师' }] },
    params: { chapters: 3 },
  })
  const { value, text } = await run(engine, 'novel_status')

  assert.equal(value.outline.plannedChapters, 2)
  assert.equal(value.outline.totalChapters, 3)
  assert.equal(value.canon.stats.facts, 1)
  assert.equal(value.canon.stats.entities, 1)
  assert.match(text, /计划 3 章/)
  assert.equal(calls.writeArtifact.length, 0)
  assert.ok(!files.has('canon'), 'v1 项目读路径不该写 canon')
})

// ---------------------------------------------------------------- novel_next

test('novel_next：空骨架 → 先展开第一卷', async () => {
  const { engine } = makeHarness({ outline: skeletonOutline() })
  const { value, text } = await run(engine, 'novel_next')

  assert.equal(value.actions[0].action, 'plan-volume')
  assert.equal(value.actions[0].volume, 'v01')
  assert.equal(value.progress.written, 0)
  assert.match(text, /展开卷纲 v01/)
})

test('novel_next：写了一部分 → 先写下一章，再审已写的章', async () => {
  const { engine } = makeHarness({ outline: plannedOutline(), drafts: { ch01: cleanProse() } })
  const { value } = await run(engine, 'novel_next')

  assert.deepEqual(value.actions.slice(0, 2).map(item => `${item.action}:${item.chapter}`), ['write:ch02', 'check:ch01'])
  assert.equal(value.progress.written, 1)
})

test('novel_next：全部写完并审完 → 提示全书审校', async () => {
  const drafts = Object.fromEntries(['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'].map(id => [id, cleanProse()]))
  const { engine } = makeHarness({
    outline: plannedOutline(),
    drafts,
    reviews: ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'],
  })
  const { value } = await run(engine, 'novel_next')

  assert.equal(value.actions.length, 1)
  assert.equal(value.actions[0].action, 'audit')
  assert.equal(value.actions[0].estimate.calls, 0)
})

test('novel_next：已审校（auditedAt）后 → done，不再要求审校', async () => {
  const outline = plannedOutline()
  outline.auditedAt = '2026-11-12T10:00:00.000Z'
  const drafts = Object.fromEntries(['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'].map(id => [id, cleanProse()]))
  const { engine } = makeHarness({
    outline,
    drafts,
    reviews: ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'],
  })
  const { value } = await run(engine, 'novel_next')

  assert.equal(value.actions[0].action, 'done')
})

// ---------------------------------------------------------------- novel_context

test('novel_context：packet 不超过 contextBudget，report 有分片账与 requirements', async () => {
  const { engine } = makeHarness({
    outline: plannedOutline(),
    canon: fatCanon(60),
    beats: { ch01: beatsPayload },
    params: { contextBudget: 1200 },
  })
  const { value, text } = await run(engine, 'novel_context', { chapter: 'ch01' })

  assert.equal(value.chapter.id, 'ch01')
  assert.ok(value.packet.text.length <= 1200, `packet 超预算：${value.packet.text.length}`)
  assert.equal(value.packet.report.budget, 1200)
  assert.equal(value.packet.report.used, value.packet.text.length)
  const sliceNames = value.packet.report.slices.map(slice => slice.name)
  assert.ok(sliceNames.includes('beats') && sliceNames.includes('canon'), `分片账缺项：${sliceNames.join(',')}`)
  assert.ok(value.packet.report.slices.some(slice => slice.truncated), '预算 1200 时应至少截断一个分片')
  assert.equal(value.requirements.words, CHAPTER_PARAMS.wordsPerChapter)
  assert.equal(value.requirements.pov, CHAPTER_PARAMS.pov)
  assert.deepEqual(value.requirements.banned, ['……', '突然', '不由得'])
  assert.equal(value.calls, 0)
  assert.equal(value.persisted.outline, false)
  assert.equal(value.persisted.beats, false)
  assert.match(text, /分片：/)
})

test('novel_context：缺省章节 = novel_next 的 write 目标', async () => {
  const { engine } = makeHarness({
    outline: plannedOutline(),
    drafts: { ch01: cleanProse() },
    beats: { ch02: beatsPayload },
  })
  const { value } = await run(engine, 'novel_context')

  assert.equal(value.chapter.id, 'ch02')
})

test('novel_context：生成细纲时立刻落盘 beats/<章>（stage agent）', async () => {
  const llm = fakeLlm(() => ({ text: JSON.stringify(beatsPayload) }))
  const { engine, files, calls } = makeHarness({
    outline: plannedOutline(),
    llm,
  })
  const { value } = await run(engine, 'novel_context', { chapter: 'ch01' })

  assert.equal(llm.calls.length, 1)
  assert.equal(value.calls, 1)
  assert.equal(value.persisted.beats, true)
  assert.ok(files.has('beats/ch01'))
  const written = calls.writeArtifact.find(entry => entry.key === 'beats/ch01')
  assert.equal(written.by.stage, 'agent')
})

test('novel_context：目标章所在卷未展开 → 先展开卷纲并落盘 outline，再落细纲', async () => {
  const llm = fakeLlm((_spec, index) => ({
    text: JSON.stringify(index === 0 ? { chapters: rowsFor(6, '窄巷') } : beatsPayload),
  }))
  const { engine, files, calls } = makeHarness({ outline: skeletonOutline(), llm })
  const { value } = await run(engine, 'novel_context', { chapter: 'ch01' })

  assert.equal(llm.calls.length, 2)
  assert.equal(value.calls, 2)
  assert.equal(value.persisted.outline, true)
  assert.equal(value.persisted.beats, true)

  const saved = files.get('outline').content
  assert.equal(saved.volumes[0].planned, true)
  assert.equal(saved.volumes[0].chapterIds.length, 6)
  assert.equal(saved.chapters[0].id, 'ch01')

  const outlineWrite = calls.writeArtifact.find(entry => entry.key === 'outline')
  assert.equal(outlineWrite.by.stage, 'agent')
  assert.ok(files.has('beats/ch01'))
})

// ---------------------------------------------------------------- novel_commit

test('novel_commit：落 draft / summary / canon，正典增长，verdict=pass', async () => {
  const canon = mergeCanon(
    emptyCanon(),
    { facts: [{ s: '林砚', p: '状态', o: '活着', chapter: 'ch01' }] },
    { chapter: 'ch01' },
  )
  const { engine, files, calls } = makeHarness({ outline: plannedOutline(), canon })
  const text = `${cleanProse()}\n\n<<<SUMMARY>>>\n他进了殡仪馆，陈婆警告他别住西厢。\n<<<CANON>>>\n[{"s":"林砚","p":"位置","o":"殡仪馆"}]`
  const { value, text: rendered } = await run(engine, 'novel_commit', { chapter: 'ch02', text })

  assert.equal(value.written.draft.key, 'draft/ch02')
  assert.equal(value.written.summary.key, 'summary/ch02')
  assert.equal(value.written.canon.key, 'canon')
  assert.equal(files.get('draft/ch02').content, cleanProse())
  assert.equal(files.get('summary/ch02').content, '他进了殡仪馆，陈婆警告他别住西厢。')
  assert.equal(value.canon.stats.facts, 2)
  assert.equal(files.get('canon').content.facts.length, 2)
  assert.equal(value.verdict, 'pass')
  assert.equal(value.findings.some(item => item.severity === 'block'), false)
  assert.match(rendered, /verdict pass/)

  for (const entry of calls.writeArtifact) assert.equal(entry.by.stage, 'agent')
  assert.ok(value.nextActions.some(item => item.action === 'write'))
})

test('novel_commit：空正文 → 400 EMPTY_TEXT，且不解析项目', async () => {
  const { engine, calls } = makeHarness({ outline: plannedOutline() })
  await assert.rejects(
    () => run(engine, 'novel_commit', { chapter: 'ch01', text: '   ' }),
    error => error.code === 'EMPTY_TEXT' && error.status === 400,
  )
  assert.equal(calls.writeArtifact.length, 0)
  assert.equal(calls.read.length, 0)
})

test('novel_commit：没给 chapter 且大纲里推不出 → 可读 400', async () => {
  const { engine } = makeHarness({ outline: plannedOutline(), canon: emptyCanon() })
  await assert.rejects(
    () => run(engine, 'novel_commit', { text: cleanProse() }),
    error => error.code === 'BAD_PARAMS' && error.status === 400,
  )
})

// ---------------------------------------------------------------- novel_audit

test('novel_audit：抓到植入的死亡人物与 40 章未回收线索，并给统计', async () => {
  const outline = plannedOutline({ chapters: 45, per: 45 })
  const canon = mergeCanon(
    emptyCanon(),
    {
      facts: [{ s: '林砚', p: '状态', o: '死亡', chapter: 'ch03' }],
      threads: [{ text: '失踪的账册', opened: 'ch01', status: 'open' }],
    },
    { chapter: 'ch03' },
  )
  const { engine } = makeHarness({
    outline,
    canon,
    drafts: { ch45: '林砚推门进来。屋里没人应声。林砚又喊了一声。' },
  })
  const { value, text } = await run(engine, 'novel_audit')

  assert.equal(value.stats.chapters, 45)
  assert.equal(value.stats.drafted, 1)
  assert.ok(value.stats.words > 0)
  assert.equal(value.stats.openThreads, 1)
  assert.equal(value.stats.oldestOpen.distance, 44)
  assert.ok(value.findings.some(item => item.kind === 'dead-character'), '应报死亡人物')
  assert.ok(value.findings.some(item => item.kind === 'thread-stale'), '应报未回收线索')
  assert.match(text, /最久未回收：失踪的账册/)
})

test('novel_audit：干净项目不报死亡人物 / 未回收线索，并记下 outline.auditedAt', async () => {
  const canon = mergeCanon(
    emptyCanon(),
    {
      facts: [{ s: '林砚', p: '状态', o: '活着', chapter: 'ch01' }],
      threads: [{ text: '账册', opened: 'ch05', status: 'open' }],
    },
    { chapter: 'ch05' },
  )
  const { engine, calls } = makeHarness({ outline: plannedOutline(), canon, drafts: { ch01: cleanProse() } })
  const { value } = await run(engine, 'novel_audit')

  assert.equal(value.findings.some(item => item.kind === 'dead-character'), false)
  assert.equal(value.findings.some(item => item.kind === 'thread-stale'), false)
  // 干净的一次体检会把 outline.auditedAt 记上（否则 novel_next 会一直催 audit）；只写这一件。
  assert.equal(calls.writeArtifact.length, 1)
  assert.equal(calls.writeArtifact[0].key, 'outline')
  assert.ok(calls.writeArtifact[0].content.auditedAt, 'outline.auditedAt 应被写上')
  assert.equal(value.markedAudited, true)
})

test('novel_audit：有 block 时不记 auditedAt（别让 novel_next 提前放行）', async () => {
  const canon = mergeCanon(
    emptyCanon(),
    { facts: [{ s: '老周', p: '状态', o: '死亡', chapter: 'ch01' }], threads: [] },
    { chapter: 'ch01' },
  )
  const { engine, calls } = makeHarness({ outline: plannedOutline(), canon, drafts: { ch05: '老周点点头，把茶杯放下。过了一会儿，老周又说起从前。' } })
  const { value } = await run(engine, 'novel_audit')

  assert.ok(value.findings.some(item => item.kind === 'dead-character'), '应抓到死亡人物')
  assert.equal(value.markedAudited, false)
  assert.equal(calls.writeArtifact.some(item => item.key === 'outline'), false)
})

// ---------------------------------------------------------------- novel_run / novel_plan

test('novel_run：window 传进 engine.startRun 的 options，默认 10', async () => {
  const { engine, calls } = makeHarness({ outline: plannedOutline() })

  const first = await run(engine, 'novel_run', { window: 3 })
  assert.equal(first.value.window, 3)
  assert.equal(first.value.run.id, 'run-1')
  assert.equal(calls.startRun[0].window, 3)
  assert.match(first.text, /本轮最多 3 章/)

  await run(engine, 'novel_run')
  assert.equal(calls.startRun[1].window, 10)
})

test('novel_plan：未展开的卷 → startRun(stages:["outline"])', async () => {
  const { engine, calls } = makeHarness({ outline: skeletonOutline() })
  const { value, text } = await run(engine, 'novel_plan', { volume: 'v01' })

  assert.equal(value.planned, undefined)
  assert.equal(value.run.id, 'run-1')
  assert.deepEqual(calls.startRun, [{ stages: ['outline'] }])
  assert.match(text, /已触发卷纲展开/)
})

test('novel_plan：卷表已在 → 幂等空跑，不启动 run', async () => {
  const { engine, calls } = makeHarness({ outline: plannedOutline() })
  const { value, text } = await run(engine, 'novel_plan', { volume: 'v01' })

  assert.equal(value.planned, true)
  assert.equal(calls.startRun.length, 0)
  assert.match(text, /已经计划好/)
})

test('novel_plan：上一卷还没写完 → 不启动 run，返回 skipped 与卡点章', async () => {
  // v01 章表已展开但只写了第 1 章：此时展开 v02 会重排章号，必须先写完。
  const outline = mergeVolumeChapters(skeletonOutline({ chapters: 12, per: 6 }), 'v01', rowsFor(6))
  const { engine, calls } = makeHarness({ outline, drafts: { ch01: cleanProse() } })
  const { value } = await run(engine, 'novel_plan', { volume: 'v02' })

  assert.equal(value.skipped, true)
  assert.equal(value.ok, true)
  assert.equal(calls.startRun.length, 0, '不启动 run，避免和紧接着的续写抢 RUN_ACTIVE')
  assert.equal(value.blockedBy.chapter, 'ch02')
  assert.equal(value.blockedBy.remaining, 5)
})

// ---------------------------------------------------------------- novel_write（JSON_KEYS）

test('novel_write：canon / spine 按 JSON 解析，ledger 保留（v1 兼容）', async () => {
  const { engine, calls } = makeHarness({ outline: plannedOutline() })
  await run(engine, 'novel_write', { key: 'canon', content: '{"facts":[]}' })
  await run(engine, 'novel_write', { key: 'spine', content: '{"volumes":[]}' })
  await run(engine, 'novel_write', { key: 'ledger', content: '{"facts":[]}' })

  assert.deepEqual(calls.writeArtifact.map(entry => entry.kind), ['json', 'json', 'json'])
  assert.deepEqual(calls.writeArtifact[0].content, { facts: [] })
  assert.deepEqual(calls.writeArtifact[1].content, { volumes: [] })
})
