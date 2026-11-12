// novel_* 工具：让助手在对话里直接开书、查进度、读章节、写正文、跑流水线、导出。
// v0.2 起「流水线」拆成一份契约两个调用方：
//   novel_next 看下一步 → novel_context 取材料 →（agent 自己写）→ novel_commit 提交
//   novel_run 批量推进（同一个 chapter.js / 同一份 packet 契约）
// 每个工具都只做一层薄封装，真正的语义在 recipes/novel 与 ForgeEngine 里。

import { httpError } from './json.js'
import { countCjk } from '../forge/text.js'
import { audit as auditChapters } from '../recipes/novel/consistency.js'
import { canonProblems, canonStats, emptyCanon, migrateLedger } from '../recipes/novel/canon.js'
import { chapterRequirements } from '../recipes/novel/packet.js'
import { migrateOutline, nextActions, volumeOfChapter } from '../recipes/novel/plan.js'
import { commitChapter, ensureVolume, prepareChapter } from '../recipes/novel/chapter.js'

// 需要按 JSON 存的产物 key。ledger 保留：v1 项目还有账本，读的时候要能迁移。
const JSON_KEYS = new Set(['brief', 'characters', 'spine', 'outline', 'canon', 'ledger', 'blurb'])

// chapter.js 只接受同步 read：tools 层先把这些产物并发读进内存。
const BASE_KEYS = ['brief', 'bible', 'characters', 'spine', 'outline', 'canon', 'ledger']
const CHAPTER_PREFIXES = ['beats', 'summary', 'draft', 'review']

const STAGE_ORDER = ['premise', 'bible', 'characters', 'spine', 'outline', 'draft', 'review', 'revise', 'blurb']

const ACTION_LABELS = {
  'plan-volume': '展开卷纲',
  write: '写正文',
  check: '审校',
  revise: '修订',
  audit: '全书审校',
  done: '已完成',
}

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function defineTool(name, description, parameters, execute, options = {}) {
  const opts = typeof options === 'number' ? { timeoutMs: options } : options
  return {
    name,
    description,
    parameters,
    output: { schema: { type: 'object' }, render: opts.render ?? ((_args, value) => text(value)) },
    execute,
    timeoutMs: opts.timeoutMs ?? 60_000,
  }
}

function fmtNum(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'
}

function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 章 id 补零宽度跟随项目规模（大纲总章数）与已落盘的产物 key。新项目没有草稿时，
 *  300 章的项目也要按 ch005 解析，不能退回两位。 */
function outlineChapterTotal(outline, params = {}) {
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters.length : 0
  return Math.max(
    Number(params?.chapters) || 0,
    Number(outline?.totalChapters) || 0,
    chapters,
  )
}

function chapterIdWidth(keys = [], total = 0) {
  let width = Math.max(2, String(Math.max(0, Math.floor(Number(total) || 0))).length)
  for (const key of keys) {
    const matched = String(key ?? '').match(/^draft\/ch(\d+)$/)
    if (matched) width = Math.max(width, matched[1].length)
  }
  return width
}

function chapterIdOf(raw, keys = [], total = 0) {
  const match = String(raw ?? '').match(/(\d+)/)
  if (!match) return null
  return `ch${String(Number(match[1])).padStart(chapterIdWidth(keys, total), '0')}`
}

/** 先按大纲里的章 id / 序号定位，再退回补零推断（v1 项目没有 volume 章表时也能用）。 */
function resolveChapterId(raw, outline, keys = [], params = {}) {
  const input = String(raw ?? '').trim()
  if (!input) return null
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  if (chapters.some(chapter => chapter?.id === input)) return input
  const matched = input.match(/(\d+)/)
  if (!matched) return null
  const num = Number(matched[1])
  const byIndex = chapters.find(chapter => Number(chapter?.index) === num)
  if (byIndex?.id) return byIndex.id
  const byOrder = chapters[num - 1]
  if (byOrder?.id) return byOrder.id
  return chapterIdOf(input, keys, outlineChapterTotal(outline, params))
}

/** 第一条未展开的卷里，第一章的 id 大概长什么样（还没落卷表时给 novel_context 一个目标）。 */
function predictNextChapterId(outline) {
  const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
  const width = Math.max(2, String(outline?.totalChapters ?? 0).length)
  let before = 0
  for (const volume of volumes) {
    const ids = Array.isArray(volume?.chapterIds) ? volume.chapterIds.filter(Boolean) : []
    if (!volume?.planned && Number(volume?.targetChapters) > 0) {
      return `ch${String(before + 1).padStart(width, '0')}`
    }
    before += ids.length || Number(volume?.targetChapters) || 0
  }
  return null
}

function outlineSummary(outline) {
  const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  return {
    plannedChapters: chapters.length,
    totalChapters: Number(outline?.totalChapters) || chapters.length,
    plannedVolumes: volumes.filter(volume => volume?.planned).length,
    totalVolumes: volumes.length,
  }
}

const projectParam = {
  type: 'string',
  description: '项目 id、id 前缀或书名的一部分。省略时用最近更新的项目。',
}

async function resolve(engine, hint) {
  return engine.resolveProject(hint || 'active')
}

/** 读一个产物；优先走 store 的 knownMeta 快路径，长书不用每个 key 重解析一次 project.json。 */
async function readArtifact(engine, project, key) {
  const store = engine?.store
  if (store && typeof store.readArtifact === 'function') {
    try {
      return await store.readArtifact(project.id, key, undefined, project.artifacts ?? undefined)
    } catch {
      return null
    }
  }
  try {
    return await engine.getArtifact(project.id, key)
  } catch {
    return null
  }
}

/** 从 project.artifacts 索引 + stages.items 里收集章节级产物 key。 */
function artifactKeysOf(project, prefixes = CHAPTER_PREFIXES) {
  const wanted = new Set(prefixes)
  const keys = new Set()
  for (const key of Object.keys(project.artifacts ?? {})) {
    const slash = key.indexOf('/')
    if (slash > 0 && wanted.has(key.slice(0, slash))) keys.add(key)
  }
  for (const [id, state] of Object.entries(project.stages ?? {})) {
    if (!wanted.has(id)) continue
    for (const item of Object.keys(state?.items ?? {})) keys.add(`${id}/${item}`)
  }
  return [...keys]
}

/** 章节级产物里已经存在的章 id（written / reviewed 的判定只靠索引，不读正文）。 */
function chapterIdsIn(project, prefix, extra = []) {
  const ids = new Set(extra)
  const head = `${prefix}/`
  for (const key of Object.keys(project.artifacts ?? {})) {
    if (!key.startsWith(head)) continue
    const id = key.slice(head.length)
    if (/^ch\d+$/.test(id)) ids.add(id)
  }
  for (const raw of Object.keys(project.stages?.[prefix]?.items ?? {})) {
    const id = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw
    if (/^ch\d+$/.test(id)) ids.add(id)
  }
  return ids
}

/**
 * chapter.js 的 read(key) 是同步的。先并发把可能用到的产物读进内存，再给一个同步闭包。
 * read.load(keys) 可以增量补读；read.put 用于刚落盘的产物回填。
 */
async function preloadProject(engine, project, { prefixes = CHAPTER_PREFIXES } = {}) {
  const cache = new Map()
  const read = key => (cache.has(key) ? cache.get(key) : null)
  read.put = (key, content) => {
    cache.set(key, content)
    return read
  }
  read.keys = () => [...cache.keys()]
  read.load = async keys => {
    const missing = [...new Set(keys ?? [])].filter(key => key && !cache.has(key))
    const loaded = await Promise.all(missing.map(async key => [key, await readArtifact(engine, project, key)]))
    for (const [key, artifact] of loaded) {
      if (artifact) cache.set(key, artifact.content)
    }
    return read
  }
  await read.load([...BASE_KEYS, ...artifactKeysOf(project, prefixes)])
  return read
}

/** outline 统一迁到 v2 内存视图；没有就返回 null。 */
function outlineOf(read, params = {}) {
  const raw = read('outline')
  if (!raw || typeof raw !== 'object') return null
  try {
    return migrateOutline(raw, { params })
  } catch {
    return null
  }
}

/** canon 缺失时从 v1 ledger 迁移（纯内存，提交时才落盘）。 */
function canonOf(read) {
  const canon = read('canon')
  if (canon && typeof canon === 'object') return canon
  const ledger = read('ledger')
  if (!ledger) return emptyCanon()
  try {
    return migrateLedger(ledger, { characters: read('characters') })
  } catch {
    return emptyCanon()
  }
}

function actionsOf({ project, outline, written, reviewed }) {
  const params = project.params ?? {}
  const audited = params.audited === true || outline?.audited === true || Boolean(outline?.auditedAt)
  return nextActions({
    outline,
    params: { ...params, audited },
    written: written ?? chapterIdsIn(project, 'draft'),
    reviewed: reviewed ?? chapterIdsIn(project, 'review'),
    audited,
  })
}

function actionLine(action) {
  const target = action.chapter || action.volume || ''
  const estimate = Number(action.estimate?.calls) > 0
    ? `约 ${action.estimate.calls} 次模型调用`
    : '不调模型'
  return `· ${ACTION_LABELS[action.action] ?? action.action}${target ? ` ${target}` : ''} —— ${action.why}（${estimate}）`
}

function actionsText(actions = []) {
  return actions.length ? actions.map(actionLine).join('\n') : '· 没有待办动作'
}

function canonLine(stats) {
  const safe = stats ?? {}
  return `正典：${fmtNum(safe.facts)} 条事实 · ${fmtNum(safe.notes)} 条笔记 · ${fmtNum(safe.threads)} 条线索（${fmtNum(safe.openThreads)} 未回收）· ${fmtNum(safe.entities)} 个人物（${fmtNum(safe.dead)} 已亡）`
}

function projectLine(project) {
  const stats = project.stats ?? {}
  const params = project.params ?? {}
  return `《${project.title}》 ${params.genre ?? ''} · ${fmtNum(stats.drafted)}/${fmtNum(stats.chapters)} 章 · ${fmtNum(stats.words)} 字 · ${fmtDate(project.updatedAt)}`
}

function stageLines(project) {
  const stages = project.stages ?? {}
  const mark = { done: '✓', running: '…', partial: '◐', error: '✗', paused: 'Ⅱ', idle: '·' }
  return STAGE_ORDER
    .filter(id => stages[id])
    .map(id => {
      const state = stages[id] ?? {}
      const items = state.items ?? {}
      const ids = Object.keys(items)
      const done = ids.filter(key => items[key] === 'done').length
      const suffix = ids.length ? ` ${done}/${ids.length}` : ''
      return `${mark[state.status] ?? '·'} ${id}${suffix}`
    })
    .join('  ')
}

/** 章号 → 所在卷。章还没落表时按各卷 targetChapters 累加定位（与 merge 的预留章号一致）。 */
function volumeForChapterId(outline, chapterId) {
  const chapter = (outline?.chapters ?? []).find(item => item?.id === chapterId)
  if (chapter) return volumeOfChapter(outline, chapterId)
  const matched = String(chapterId ?? '').match(/(\d+)/)
  const num = matched ? Number(matched[1]) : 0
  if (!num) return null
  let before = 0
  for (const volume of outline?.volumes ?? []) {
    const span = Math.max(0, Math.floor(Number(volume?.targetChapters) || 0))
    if (num > before && num <= before + span) return volume
    before += span
  }
  return null
}

/**
 * 卷纲懒展开：只展开目标章所在的那一卷，不把前面的卷一起拉进 outline。
 * ensureVolume 支持点名卷（options.volume），展开后立刻落盘，下次不用重算。
 */
async function expandVolumeFor(engine, project, read, outline, chapterId, params) {
  const llm = engine.llm
  const chapter = (outline?.chapters ?? []).find(item => item?.id === chapterId)
  const volume = volumeForChapterId(outline, chapterId)
  const empty = { outline, calls: 0, persisted: false, expandedVolumes: 0, volume: volume?.id ?? null }
  if (!volume || volume.planned) return { ...empty, chapterReady: Boolean(chapter) }
  if (!llm || typeof llm.generate !== 'function') {
    throw httpError(
      409,
      'VOLUME_NOT_PLANNED',
      `第 ${chapterId} 章所在卷还没展开，而当前没有可用模型。先用 novel_plan 展开卷纲（会调引擎的模型），再用 novel_context 取材料。`,
    )
  }
  const result = await ensureVolume(
    { outline, params, read, llm, language: params.language || 'zh' },
    { volume: volume.id },
  )
  const calls = Number(result.calls) || 0
  if (!result.created) return { ...empty, calls }
  await engine.writeArtifact(project.id, 'outline', { kind: 'json', content: result.outline }, { stage: 'agent' })
  read.put('outline', result.outline)
  return {
    outline: result.outline,
    calls,
    persisted: true,
    expandedVolumes: 1,
    volume: volume.id,
    chapterReady: (result.outline?.chapters ?? []).some(item => item?.id === chapterId),
  }
}

export function createTools(engine) {
  return [
    defineTool(
      'novel_list',
      '列出本机所有小说项目：书名、类型、已写章数、字数、最近更新。用户问“我有哪些书/写到哪了”时先用它。',
      { type: 'object', properties: {}, additionalProperties: false },
      async () => {
        const projects = await engine.listProjects()
        return {
          ok: true,
          count: projects.length,
          projects: projects.map(project => ({
            id: project.id,
            title: project.title,
            genre: project.params?.genre ?? '',
            chapters: project.stats?.chapters ?? project.params?.chapters ?? 0,
            drafted: project.stats?.drafted ?? 0,
            words: project.stats?.words ?? 0,
            updatedAt: project.updatedAt,
            running: Boolean(project.activeRunId),
          })),
          hint: projects.length ? '用 novel_status 看某一本的阶段进度。' : '还没有项目：用 novel_create 给一句话故事核开书。',
        }
      },
      { render: (_args, value) => text(value.projects.length
        ? value.projects.map(project => `${project.running ? '▶ ' : ''}《${project.title}》 ${project.genre} · ${fmtNum(project.drafted)}/${fmtNum(project.chapters)} 章 · ${fmtNum(project.words)} 字 · ${fmtDate(project.updatedAt)} · ${project.id}`).join('\n')
        : '还没有小说项目。用 novel_create 开一本。') },
    ),

    defineTool(
      'novel_create',
      '新建一个小说项目。只需一句话故事核（premise），其他参数可选。创建后不会自动开写，需要 novel_run 启动流水线。',
      {
        type: 'object',
        properties: {
          premise: { type: 'string', description: '一句话故事核，8–2000 字。', minLength: 8, maxLength: 2000 },
          title: { type: 'string', description: '书名；留空则由模型起名。' },
          genre: { type: 'string', description: '类型：悬疑/奇幻/科幻/都市/历史/言情/恐怖/武侠/通用。' },
          chapters: { type: 'number', description: '章数，6–3000，默认 24。超过 60 章按卷惰性展开。' },
          chaptersPerVolume: { type: 'number', description: '每卷章数，10–60，默认 30；卷数超过 40 时脚本会自动抬高。' },
          contextBudget: { type: 'number', description: '单章写作材料包的字数预算，默认 12000。长篇不必调大：各分片有固定上限，包不会越写越长。' },
          wordsPerChapter: { type: 'number', description: '每章字数，800–8000，默认 3000。' },
          pov: { type: 'string', description: '第一人称/第三人称限知/第三人称全知。' },
          tone: { type: 'string', description: '文风关键词，如“冷、克制、潮湿的温情”。' },
          styleGuide: { type: 'string', description: '用户给的写作规矩或样本段落。' },
        },
        required: ['premise'],
        additionalProperties: false,
      },
      async args => {
        const params = {
          premise: args.premise,
          title: args.title ?? '',
          genre: args.genre,
          chapters: args.chapters,
          chaptersPerVolume: args.chaptersPerVolume,
          contextBudget: args.contextBudget,
          wordsPerChapter: args.wordsPerChapter,
          pov: args.pov,
          tone: args.tone,
          styleGuide: args.styleGuide,
        }
        for (const key of Object.keys(params)) if (params[key] === undefined) delete params[key]
        const project = await engine.createProject({ recipeId: 'novel', title: args.title, params })
        const estimate = await engine.estimate(project.id)
        return { ok: true, project: { id: project.id, title: project.title }, estimate }
      },
      { render: (_args, value) => text(`已开书：《${value.project.title}》（${value.project.id}）\n预估：${value.estimate.calls ?? '?'} 次模型调用，约 ${fmtNum(value.estimate.estTokensIn)} tokens 输入。\n下一步：novel_run 启动；或先在墨炉面板里看看设定。`) },
    ),

    defineTool(
      'novel_status',
      '看某个项目的详细进度：九个阶段的完成情况、计划章数与已展开卷数、正典规模（事实/线索/死亡人物）、每章状态、当前运行、是否有等待确认的审稿门。v1 项目（没有 canon）也能读。',
      { type: 'object', properties: { project: projectParam }, additionalProperties: false },
      async args => {
        const project = await resolve(engine, args.project)
        const runs = await engine.listRuns(project.id)
        const active = project.activeRunId ? runs.find(run => run.id === project.activeRunId) ?? null : null
        const read = await preloadProject(engine, project, { prefixes: [] })
        const outline = outlineOf(read, project.params ?? {})
        const canon = canonOf(read)
        return {
          ok: true,
          project: {
            id: project.id,
            title: project.title,
            params: project.params,
            stats: project.stats,
            stages: project.stages,
            pendingReview: project.pendingReview,
            lastError: project.lastError,
          },
          outline: outline ? outlineSummary(outline) : null,
          canon: { stats: canonStats(canon) },
          activeRun: active ? { id: active.id, status: active.status, current: active.current, progress: active.progress } : null,
          recentRuns: runs.slice(0, 5).map(run => ({ id: run.id, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt })),
        }
      },
      { render: (_args, value) => {
        const project = value.project
        const lines = [projectLine(project)]
        if (value.outline) {
          lines.push(`计划 ${fmtNum(value.outline.totalChapters)} 章 · 已展开 ${fmtNum(value.outline.plannedVolumes)} 卷（章表 ${fmtNum(value.outline.plannedChapters)} 章）`)
        }
        lines.push(canonLine(value.canon?.stats))
        lines.push(`阶段：${stageLines(project)}`)
        if (project.pendingReview) lines.push(`等待确认：${project.pendingReview.stage}（继续用面板或 novel_run from=${project.pendingReview.nextStages?.[0] ?? ''}）`)
        if (value.activeRun) {
          const run = value.activeRun
          lines.push(`运行中：${run.current?.label ?? run.current?.stage ?? ''} · ${fmtNum(run.progress?.done)}/${fmtNum(run.progress?.total)} · ${run.status}`)
        }
        if (project.lastError) lines.push(`上次错误：${project.lastError.message ?? project.lastError}`)
        return text(lines.join('\n'))
      } },
    ),

    defineTool(
      'novel_next',
      '看这本书的下一步该做什么（最多 5 条，按顺序）：展开卷纲 / 写某章 / 审校某章 / 全书审校。不调模型。agent-first 分工：先用这个判断；要自己写正文就走 novel_context → 写 → novel_commit；想让引擎批量写就用 novel_run（长篇每轮只展开一卷）。',
      { type: 'object', properties: { project: projectParam }, additionalProperties: false },
      async args => {
        const project = await resolve(engine, args.project)
        const read = await preloadProject(engine, project, { prefixes: [] })
        const outline = outlineOf(read, project.params ?? {})
        if (!outline) {
          throw httpError(409, 'NO_OUTLINE', '项目还没有大纲：先 novel_run 跑 premise→outline，或 novel_create 重新开书。')
        }
        const written = chapterIdsIn(project, 'draft')
        const reviewed = chapterIdsIn(project, 'review')
        const actions = actionsOf({ project, outline, written, reviewed })
        return {
          ok: true,
          project: { id: project.id, title: project.title },
          outline: outlineSummary(outline),
          progress: { written: written.size, reviewed: reviewed.size },
          actions,
          hint: actions.some(action => action.action === 'write')
            ? '要自己写：novel_context 取材料 → 写正文 → novel_commit 提交。交给引擎：novel_run（长篇每轮只展开一卷）。'
            : '按上面的顺序推进；批量跑可以用 novel_run。',
        }
      },
      { render: (_args, value) => text([
        `《${value.project.title}》 计划 ${fmtNum(value.outline.totalChapters)} 章 · 已展开 ${fmtNum(value.outline.plannedVolumes)} 卷 · 已写 ${fmtNum(value.progress.written)} 章 · 已审 ${fmtNum(value.progress.reviewed)} 章`,
        '下一步：',
        actionsText(value.actions),
      ].join('\n')) },
    ),

    defineTool(
      'novel_context',
      '取某一章的材料包（材料包 + 该章要求 + 正典 + 下一步），给 agent 自己写正文用。缺省章节 = 下一步要写的章。准备过程中新展开的卷纲/细纲会立刻落盘。写完用 novel_commit 提交。长篇（>60 章）每轮只展开一卷，需要多轮 novel_plan/novel_context。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          chapter: { type: 'string', description: '章号，如 ch03 或 3。省略时取下一步要写的章。' },
        },
        additionalProperties: false,
      },
      async args => {
        const project = await resolve(engine, args.project)
        const params = project.params ?? {}
        const read = await preloadProject(engine, project, { prefixes: ['summary'] })
        const outline = outlineOf(read, params)
        if (!outline) {
          throw httpError(409, 'NO_OUTLINE', '项目还没有大纲：先 novel_run 跑 premise→outline，再取材料。')
        }
        const knownKeys = Object.keys(project.artifacts ?? {})
        let chapterId = args.chapter
          ? resolveChapterId(args.chapter, outline, knownKeys, params)
          : null
        if (args.chapter && !chapterId) throw httpError(400, 'BAD_PARAMS', `看不懂章节号：${args.chapter}`)
        if (!chapterId) {
          const actions = actionsOf({ project, outline })
          const write = actions.find(action => action.action === 'write')
          const check = actions.find(action => action.action === 'check')
          chapterId = write?.chapter ?? check?.chapter ?? predictNextChapterId(outline)
        }
        if (!chapterId) {
          throw httpError(404, 'CHAPTER_NOT_FOUND', '全书都已经写完，没有下一步要写的章；用 novel_audit 检查全书。')
        }

        // 目标章可能还没落卷表：先补读它的细纲和前两章正文，再按需展开卷纲。
        const chapters = Array.isArray(outline.chapters) ? outline.chapters : []
        const at = chapters.findIndex(chapter => chapter?.id === chapterId)
        const styleKeys = at > 0 ? chapters.slice(Math.max(0, at - 2), at).map(chapter => `draft/${chapter.id}`) : []
        await read.load([`beats/${chapterId}`, ...styleKeys])

        const expanded = await expandVolumeFor(engine, project, read, outline, chapterId, params)
        const chapter = (expanded.outline.chapters ?? []).find(item => item?.id === chapterId) ?? null
        if (!chapter) {
          throw httpError(409, 'CHAPTER_NOT_PLANNED', `第 ${chapterId} 章还不在章表里；先 novel_plan 展开它所在的卷。`)
        }
        const volume = volumeOfChapter(expanded.outline, chapterId)
        if (!volume?.planned) {
          throw httpError(409, 'VOLUME_NOT_PLANNED', `第 ${chapterId} 章所在卷还没展开；先 novel_plan。`)
        }
        // 刚展开的卷会带来新的「前两章」：补读它们的正文当风格样本。
        const expandedChapters = Array.isArray(expanded.outline.chapters) ? expanded.outline.chapters : []
        const expandedAt = expandedChapters.findIndex(item => item?.id === chapterId)
        if (expandedAt > 0) {
          await read.load(
            expandedChapters.slice(Math.max(0, expandedAt - 2), expandedAt).map(item => `draft/${item.id}`),
          )
        }

        const prepared = await prepareChapter({
          outline: expanded.outline,
          params,
          chapterId,
          read,
          llm: engine.llm,
          language: params.language || 'zh',
        })
        let beatsPersisted = false
        if (prepared.calls > 0 && prepared.beats) {
          await engine.writeArtifact(project.id, `beats/${chapterId}`, { kind: 'json', content: prepared.beats }, { stage: 'agent' })
          read.put(`beats/${chapterId}`, prepared.beats)
          beatsPersisted = true
        }
        const requirements = chapterRequirements({ params, chapter: prepared.chapter })
        const conflicts = canonProblems(prepared.canon, { atChapter: prepared.chapter?.index })
        const actions = actionsOf({ project, outline: expanded.outline })
        return {
          ok: true,
          project: { id: project.id, title: project.title },
          chapter: {
            id: prepared.chapter.id,
            index: prepared.chapter.index,
            title: prepared.chapter.title,
            goal: prepared.chapter.goal ?? '',
            pov: requirements.pov,
          },
          packet: { text: prepared.packet.text, report: prepared.packet.report },
          requirements,
          canon: { stats: canonStats(prepared.canon), conflicts },
          nextActions: actions,
          calls: expanded.calls + prepared.calls,
          persisted: {
            outline: expanded.persisted,
            beats: beatsPersisted,
            volume: expanded.volume,
            expandedVolumes: expanded.expandedVolumes,
          },
        }
      },
      {
        timeoutMs: 180_000,
        render: (_args, value) => {
          const report = value.packet.report ?? {}
          const slices = (report.slices ?? [])
            .filter(slice => Number(slice.allocated) > 0)
            .map(slice => `${slice.name} ${fmtNum(slice.allocated)}`)
            .join(' · ')
          const lines = [
            `《${value.project.title}》 第 ${fmtNum(value.chapter.index)} 章《${value.chapter.title || value.chapter.id}》`,
            `视角：${value.requirements.pov} · 目标 ${fmtNum(value.requirements.words)} 字 · 禁用：${value.requirements.banned.join('、')}`,
            canonLine(value.canon.stats),
            `材料包：${fmtNum(value.packet.text.length)} 字 / 预算 ${fmtNum(report.budget)}${report.hardTruncated ? '（硬截断）' : ''}`,
            `分片：${slices || '（空）'}`,
            value.persisted.outline || value.persisted.beats
              ? `已落盘：${[value.persisted.outline ? '卷纲' : '', value.persisted.beats ? '细纲' : ''].filter(Boolean).join('、')}`
              : '材料包已就绪（没有新生成的内容需要落盘）',
            '写完用 novel_commit 提交。',
            '下一步：',
            actionsText(value.nextActions),
          ]
          return text(lines.join('\n'))
        },
      },
    ),

    defineTool(
      'novel_commit',
      '提交一章正文（agent 自己写的）：写 draft/<章>、summary/<章> 和 canon，并跑确定性校验。正文里可以带 <<<SUMMARY>>> / <<<CANON>>> 内联块；summary 参数优先于内联摘要。空正文会报错。返回 verdict（pass/revise）与下一步。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          chapter: { type: 'string', description: '章号，如 ch03 或 3。省略时必须能从正文上下文推断——建议总是给。' },
          text: { type: 'string', description: '整章正文（可含内联 SUMMARY/CANON 块）。' },
          summary: { type: 'string', description: '本章摘要，200–400 字；省略时用内联摘要或正文前 240 字兜底。' },
          canonPatch: { type: 'object', description: '正典补丁（可选）；省略时用内联 CANON 块。', additionalProperties: true },
        },
        required: ['text'],
        additionalProperties: false,
      },
      async args => {
        if (!String(args.text ?? '').trim()) {
          throw httpError(400, 'EMPTY_TEXT', '正文为空：novel_commit 需要整章正文（可以带 <<<SUMMARY>>> / <<<CANON>>> 内联块）。')
        }
        const project = await resolve(engine, args.project)
        const params = project.params ?? {}
        const read = await preloadProject(engine, project, { prefixes: [] })
        const outline = outlineOf(read, params)
        const knownKeys = Object.keys(project.artifacts ?? {})
        const chapterId = resolveChapterId(args.chapter, outline, knownKeys, params)
        if (!chapterId) throw httpError(400, 'BAD_PARAMS', `看不懂章节号：${args.chapter ?? '（未给）'}；给 chapter，如 ch03 或 3。`)
        // 显式章号必须已经在大纲里（v1 会在 outlineOf 里内存迁移成 v2）。否则允许落盘等于
        // 把正文写进一本还没有这章的书：novel_next / 正典 / 审校全都对不上。
        const inOutline = (outline?.chapters ?? []).some(chapter => chapter?.id === chapterId)
        if (!inOutline) {
          throw httpError(
            404,
            'CHAPTER_NOT_FOUND',
            `大纲里没有第 ${chapterId} 章；先 novel_plan 展开所在卷，再提交。`,
            { chapter: chapterId },
          )
        }
        await read.load([`beats/${chapterId}`])

        const result = commitChapter({
          read,
          params,
          outline,
          chapterId,
          text: args.text,
          summary: args.summary,
          canonPatch: args.canonPatch,
        })
        const draftArtifact = await engine.writeArtifact(project.id, `draft/${chapterId}`, result.artifacts.draft, { stage: 'agent' })
        const summaryArtifact = await engine.writeArtifact(project.id, `summary/${chapterId}`, result.artifacts.summary, { stage: 'agent' })
        const canonArtifact = await engine.writeArtifact(project.id, 'canon', { kind: 'json', content: result.canon }, { stage: 'agent' })
        // 确定性校验结果落成 review/<章>：novel_next 才不会对已提交的章反复建议 check，
        // 也留下「当时抓到了什么」的记录。它不是模型审校，用 deterministic 标出来。
        await engine.writeArtifact(
          project.id,
          `review/${chapterId}`,
          { kind: 'json', content: { findings: result.findings, canonPatch: null, verdict: result.verdict, deterministic: true } },
          { stage: 'agent' },
        )

        const written = chapterIdsIn(project, 'draft', [chapterId])
        const actions = outline ? actionsOf({ project, outline, written }) : []
        const chapterMeta = (outline?.chapters ?? []).find(chapter => chapter?.id === chapterId) ?? null
        return {
          ok: true,
          project: { id: project.id, title: project.title },
          chapter: { id: chapterId, title: chapterMeta?.title ?? '' },
          written: {
            draft: { key: `draft/${chapterId}`, version: draftArtifact?.meta?.version ?? null },
            summary: { key: `summary/${chapterId}`, version: summaryArtifact?.meta?.version ?? null },
            canon: { key: 'canon', version: canonArtifact?.meta?.version ?? null },
          },
          words: countCjk(result.artifacts.draft.content),
          findings: result.findings,
          counts: result.counts,
          verdict: result.verdict,
          canon: { stats: result.stats },
          nextActions: actions,
        }
      },
      {
        timeoutMs: 60_000,
        render: (_args, value) => {
          const lines = [
            `已提交 ${value.written.draft.key} · ${fmtNum(value.words)} 字 · verdict ${value.verdict}`,
            canonLine(value.canon.stats),
          ]
          if (value.findings?.length) {
            lines.push(`校验发现 ${value.findings.length} 条：`)
            for (const finding of value.findings.slice(0, 5)) {
              lines.push(`· [${finding.severity}] ${finding.where ?? ''}：${finding.issue ?? ''}`)
            }
            if (value.findings.length > 5) lines.push(`· …还有 ${value.findings.length - 5} 条`)
          } else {
            lines.push('校验：没有发现硬伤。')
          }
          lines.push('下一步：', actionsText(value.nextActions))
          return text(lines.join('\n'))
        },
      },
    ),

    defineTool(
      'novel_audit',
      '全书确定性审校：读全部已写正文 + 正典 + 大纲，跑 consistency.audit 与 canonProblems，并给统计（章数/字数/未回收线索/最久未回收）。不调模型；没有 block 时把 outline.auditedAt 记上，这样 novel_next 不再反复提 audit。用在整卷写完、或 novel_next 提示 audit 时。',
      { type: 'object', properties: { project: projectParam }, additionalProperties: false },
      async args => {
        const project = await resolve(engine, args.project)
        const params = project.params ?? {}
        const read = await preloadProject(engine, project, { prefixes: ['draft', 'beats'] })
        const outline = outlineOf(read, params)
        const canon = canonOf(read)
        const chapters = (outline?.chapters ?? []).map(chapter => {
          const draft = read(`draft/${chapter.id}`)
          return {
            ...chapter,
            text: typeof draft === 'string' ? draft : '',
            beats: read(`beats/${chapter.id}`) ?? null,
          }
        })
        const findings = auditChapters({ chapters, canon, outline, params })
        const problems = canonProblems(canon)
        const drafted = chapters.filter(chapter => chapter.text.trim())
        const words = drafted.reduce((sum, chapter) => sum + countCjk(chapter.text), 0)
        const stats = canonStats(canon)
        const stale = openThreadRows(canon, chapters.length)
        // 干净的一次体检才记账：有 block 还标「已审」会让 novel_next 提前放行。
        const blocking = findings.filter(finding => finding?.severity === 'block')
        let markedAudited = false
        if (!blocking.length && outline) {
          try {
            await engine.writeArtifact(
              project.id,
              'outline',
              { kind: 'json', content: { ...outline, auditedAt: new Date().toISOString() } },
              { stage: 'agent' },
            )
            markedAudited = true
          } catch {
            // 记不上不影响这次体检的结论
          }
        }
        return {
          ok: true,
          project: { id: project.id, title: project.title },
          outline: outline ? outlineSummary(outline) : null,
          stats: {
            chapters: chapters.length,
            drafted: drafted.length,
            words,
            avgWords: drafted.length ? Math.round(words / drafted.length) : 0,
            openThreads: stats.openThreads,
            oldestOpen: stale[0] ?? null,
          },
          canon: { stats, problems },
          findings,
          markedAudited,
        }
      },
      {
        timeoutMs: 60_000,
        render: (_args, value) => {
          const stats = value.stats
          const lines = [
            `《${value.project.title}》 已写 ${fmtNum(stats.drafted)}/${fmtNum(stats.chapters)} 章 · ${fmtNum(stats.words)} 字（平均 ${fmtNum(stats.avgWords)}）`,
            canonLine(value.canon.stats),
          ]
          if (stats.oldestOpen) lines.push(`最久未回收：${stats.oldestOpen.text}（自 ${stats.oldestOpen.opened || '?'} 起${stats.oldestOpen.distance != null ? `，${stats.oldestOpen.distance} 章` : ''}）`)
          if (!value.findings.length) {
            lines.push(value.markedAudited ? '审校：没有发现问题。（已记 outline.auditedAt）' : '审校：没有发现问题。')
          } else {
            const order = { block: 0, warn: 1, note: 2 }
            const sorted = value.findings.slice().sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
            lines.push(`审校发现 ${sorted.length} 条：`)
            for (const finding of sorted.slice(0, 12)) {
              lines.push(`· [${finding.severity}] ${finding.where ?? ''}：${finding.issue ?? ''}`)
            }
            if (sorted.length > 12) lines.push(`· …还有 ${sorted.length - 12} 条`)
          }
          return text(lines.join('\n'))
        },
      },
    ),

    defineTool(
      'novel_plan',
      '展开某一卷（或第一条未计划的卷）的章表：幂等，已计划就空跑。tools 层没有模型直连，实际用 engine.startRun(project, {stages:["outline"]}) 触发；长篇每轮只展开一卷。返回 run id，用 novel_status 看进度。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          volume: { type: 'string', description: '卷号，如 v02 或 2。省略时取第一条未计划的卷。' },
        },
        additionalProperties: false,
      },
      async args => {
        const project = await resolve(engine, args.project)
        const params = project.params ?? {}
        const read = await preloadProject(engine, project, { prefixes: [] })
        const outline = outlineOf(read, params)
        if (!outline) {
          throw httpError(409, 'NO_OUTLINE', '项目还没有大纲：先 novel_run 跑 premise→outline，再展开卷纲。')
        }
        const volumes = Array.isArray(outline.volumes) ? outline.volumes : []
        const pending = volumes.find(volume => volume && !volume.planned && Number(volume.targetChapters) > 0) ?? null
        let chosen = pending
        if (args.volume) {
          const matched = String(args.volume).match(/(\d+)/)
          if (!matched) throw httpError(400, 'BAD_PARAMS', `看不懂卷号：${args.volume}`)
          const wanted = `v${String(Number(matched[1])).padStart(2, '0')}`
          chosen = volumes.find(volume => volume?.id === wanted || Number(volume?.index) === Number(matched[1])) ?? null
          if (!chosen) throw httpError(404, 'VOLUME_NOT_FOUND', `大纲里没有 ${wanted}；共 ${volumes.length} 卷。`)
        }
        if (!chosen) {
          return { ok: true, project: { id: project.id, title: project.title }, planned: true, hint: '所有卷都已展开；用 novel_status 看进度，或 novel_context 取材料。' }
        }
        if (chosen.planned) {
          return {
            ok: true,
            project: { id: project.id, title: project.title },
            planned: true,
            volume: { id: chosen.id, title: chosen.title, chapters: chosen.chapterIds?.length ?? 0 },
            hint: `${chosen.id} 的章表已经在了；用 novel_context 取下一章材料。`,
          }
        }
        const warning = pending && pending.id !== chosen.id
          ? `卷纲只能按顺序展开：这轮先展开 ${pending.id}（${pending.title || ''}），${chosen.id} 要等后续轮次。`
          : null
        // 上一卷还没写完时展开下一卷会重排章号（mergeVolumeChapters 会重发 id），
        // 所以这里直接拒绝并说明还差几章——比启动一个什么也不做的 run 更诚实。
        const written = new Set(
          Object.keys(project.artifacts ?? {})
            .filter(key => key.startsWith('draft/'))
            .map(key => key.slice('draft/'.length)),
        )
        const listed = Array.isArray(outline.chapters) ? outline.chapters : []
        const missing = listed.filter(chapter => chapter?.id && !written.has(String(chapter.id)))
        if (missing.length) {
          return {
            ok: true,
            skipped: true,
            project: { id: project.id, title: project.title },
            volume: { id: chosen.id, title: chosen.title, targetChapters: chosen.targetChapters },
            blockedBy: { chapter: missing[0].id, remaining: missing.length },
            warning,
            hint: `${chosen.id} 还不能展开：前一卷还有 ${missing.length} 章没写（从 ${missing[0].id} 起）。先写完再展开，章号才不会重排。用 novel_next 继续写。`,
          }
        }
        const run = await engine.startRun(project.id, { stages: ['outline'] })
        return {
          ok: true,
          project: { id: project.id, title: project.title },
          volume: { id: chosen.id, title: chosen.title, targetChapters: chosen.targetChapters },
          run: { id: run.id, status: run.status, options: run.options },
          warning,
          hint: '卷纲在后台跑；用 novel_status 看进度，完成后用 novel_context 取该卷第一章的材料。',
        }
      },
      {
        timeoutMs: 180_000,
        render: (_args, value) => {
          if (value.skipped) {
            return text(`这轮先不展开：${value.blockedBy.chapter} 等 ${fmtNum(value.blockedBy.remaining)} 章还没写。\n${value.hint}`)
          }
          if (value.planned) {
            const volume = value.volume ? `${value.volume.id}《${value.volume.title || ''}》` : ''
            return text(`${volume ? `${volume} ` : ''}已经计划好，无需再展开。\n${value.hint}`)
          }
          const lines = [
            `已触发卷纲展开：${value.volume.id}《${value.volume.title || ''}》· ${fmtNum(value.volume.targetChapters)} 章`,
            `run ${value.run.id} · ${value.run.status}`,
          ]
          if (value.warning) lines.push(`注意：${value.warning}`)
          lines.push('用 novel_status 看进度；完成后 novel_context 取材料。')
          return text(lines.join('\n'))
        },
      },
    ),

    defineTool(
      'novel_read',
      '读项目里的产物：给 key 读单个产物（brief/bible/characters/spine/outline/canon/ledger/blurb/manuscript），给 chapter 读该章的细纲、草稿、审校、摘要。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          key: { type: 'string', description: '产物 key，如 outline、bible、draft/ch03。' },
          chapter: { type: 'string', description: '章节，如 ch03 或 3。' },
        },
        additionalProperties: false,
      },
      async args => {
        const project = await resolve(engine, args.project)
        if (args.chapter) {
          const knownKeys = Object.keys(project.artifacts ?? {})
          const id = chapterIdOf(args.chapter, knownKeys)
          if (!id) throw httpError(400, 'BAD_PARAMS', `看不懂章节号：${args.chapter}`)
          const kinds = ['beats', 'draft', 'review', 'summary']
          const out = { ok: true, project: project.title, chapter: id }
          for (const kind of kinds) {
            const artifact = await engine.getArtifact(project.id, `${kind}/${id}`)
            out[kind] = artifact ? artifact.content : null
          }
          if (kinds.every(kind => out[kind] == null)) {
            const chapterKeys = knownKeys.filter(key => /^(beats|draft|review|summary)\/ch\d+$/.test(key))
            const width = chapterIdWidth(knownKeys)
            throw httpError(
              404,
              'CHAPTER_NOT_FOUND',
              `第 ${args.chapter} 章映射为 ${id}，但项目里没有这一章的产物。` +
                (chapterKeys.length
                  ? `已有章节产物：${chapterKeys.slice(0, 8).join('、')}${chapterKeys.length > 8 ? ' …' : ''}`
                  : '项目还没有任何章节产物。'),
              { chapter: id, width },
            )
          }
          return out
        }
        if (args.key) {
          const artifact = await engine.getArtifact(project.id, args.key)
          if (!artifact) {
            // v2 项目没有 ledger（换成了 canon）：给一句说明，别让人以为项目坏了。
            if (args.key === 'ledger') {
              return {
                ok: true,
                project: project.title,
                key: args.key,
                kind: 'md',
                content: '这个项目没有 ledger：v0.2 起连续性状态存在 canon（读 key=canon）。老的 ledger 会在下次运行时自动迁移。',
              }
            }
            throw new Error(`没有这个产物：${args.key}`)
          }
          return { ok: true, project: project.title, key: args.key, kind: artifact.kind, content: artifact.content }
        }
        const keys = Object.keys(project.artifacts ?? {})
        return { ok: true, project: project.title, keys, hint: '给 key 或 chapter 再读具体内容。' }
      },
      { render: (_args, value) => {
        if (value.keys) return text(`《${value.project}》现有产物：\n${value.keys.join('\n')}`)
        if (value.content !== undefined) {
          const body = typeof value.content === 'string' ? value.content : JSON.stringify(value.content, null, 2)
          return text(body.length > 20000 ? `${body.slice(0, 20000)}\n…（已截断）` : body)
        }
        const parts = []
        for (const key of ['beats', 'draft', 'review', 'summary']) {
          if (value[key] == null) continue
          const body = typeof value[key] === 'string' ? value[key] : JSON.stringify(value[key], null, 2)
          parts.push(`===== ${key} =====\n${body.length > 8000 ? `${body.slice(0, 8000)}\n…（已截断）` : body}`)
        }
        return text(parts.join('\n\n'))
      } },
    ),

    defineTool(
      'novel_write',
      '手改一个产物（比如用户说“把第三章开头改成……”“这段设定不对”）。跑流水线时不能改。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          key: { type: 'string', description: '产物 key，如 draft/ch03、bible。' },
          content: { type: 'string', description: '新内容：markdown 或 JSON 字符串。' },
        },
        required: ['key', 'content'],
        additionalProperties: false,
      },
      async args => {
        const project = await resolve(engine, args.project)
        const declared = project.artifacts?.[args.key]?.kind
        const kind = declared === 'json' || JSON_KEYS.has(args.key) || args.key.startsWith('beats/') || args.key.startsWith('review/')
          ? 'json'
          : 'md'
        let content = args.content
        if (kind === 'json') {
          try {
            content = JSON.parse(args.content)
          } catch {
            throw httpError(400, 'BAD_PARAMS', `${args.key} 需要 JSON 字符串`)
          }
        }
        const artifact = await engine.writeArtifact(project.id, args.key, { kind, content }, { stage: 'manual' })
        return { ok: true, key: args.key, bytes: artifact?.meta?.bytes ?? null, version: artifact?.meta?.version ?? null }
      },
      { render: (_args, value) => text(`已保存 ${value.key}${value.version ? `（v${value.version}）` : ''}。`) },
    ),

    defineTool(
      'novel_run',
      '把流水线往前推：后台跑、立刻返回 runId。默认按当前进度最多推进 window 章（默认 10）；长篇每轮只展开一卷。可选 from/to/stages 只跑一段；force 强制重跑已完成的部分；dryRun 只校验不调模型。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          window: { type: 'integer', minimum: 1, maximum: 200, description: '最多推进多少章，1–200，默认 10；长篇每轮只展开一卷。' },
          from: { type: 'string', description: '从哪个阶段开始：premise/bible/characters/spine/outline/draft/review/revise/blurb。' },
          to: { type: 'string', description: '到哪个阶段为止（含）。' },
          stages: { type: 'array', items: { type: 'string' }, description: '显式阶段列表，按 recipe 顺序执行。' },
          items: { type: 'array', items: { type: 'string' }, description: '只跑这些章节，如 ["ch03"]。' },
          force: { type: 'boolean', description: '已完成也重跑。' },
          autoApprove: { type: 'boolean', description: '跳过审稿门。' },
          dryRun: { type: 'boolean', description: '只校验，不调模型。' },
        },
        additionalProperties: false,
      },
      async args => {
        const project = await resolve(engine, args.project)
        const options = { window: args.window ?? 10 }
        for (const key of ['from', 'to', 'stages', 'items', 'force', 'autoApprove', 'dryRun']) {
          if (args[key] !== undefined) options[key] = args[key]
        }
        const run = await engine.startRun(project.id, options)
        return {
          ok: true,
          project: { id: project.id, title: project.title },
          window: options.window,
          run: { id: run.id, status: run.status, options: run.options },
        }
      },
      {
        timeoutMs: 120_000,
        render: (_args, value) => text(`已开炉：《${value.project.title}》\nrun ${value.run.id} · ${value.run.status} · 本轮最多 ${fmtNum(value.window)} 章（长篇每轮只展开一卷）\n用 novel_status 看进度；面板里能看实时事件。`),
      },
    ),

    defineTool(
      'novel_cancel',
      '取消当前正在跑的写作任务。已完成的章节保留。',
      { type: 'object', properties: { project: projectParam }, additionalProperties: false },
      async args => {
        const project = await resolve(engine, args.project)
        if (!project.activeRunId) return { ok: false, message: '没有正在运行的任务' }
        const run = await engine.cancelRun(project.activeRunId)
        return { ok: true, run: { id: run.id, status: run.status } }
      },
      { render: (_args, value) => text(value.ok ? `已取消 ${value.run.id}。` : value.message) },
    ),

    defineTool(
      'novel_export',
      '把书导出成文件：markdown 或 epub。返回落盘路径。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          format: { type: 'string', enum: ['markdown', 'epub'], description: '导出格式，默认 markdown。' },
        },
        additionalProperties: false,
      },
      async args => {
        const project = await resolve(engine, args.project)
        const result = await engine.exportProject(project.id, args.format ?? 'markdown')
        return { ok: true, export: result }
      },
      {
        timeoutMs: 120_000,
        render: (_args, value) => text(`已导出：${value.export.path}\n${fmtNum(value.export.bytes)} 字节 · ${value.export.mime}`),
      },
    ),
  ]
}

/** canon 里还没回收的线索，按「自哪章起多久没动」倒序。 */
function openThreadRows(canon, currentChapter) {
  const threads = Array.isArray(canon?.threads) ? canon.threads : []
  const rows = []
  for (const thread of threads) {
    if (!thread || typeof thread !== 'object') continue
    if (String(thread.status ?? '').trim() === 'closed' || thread.closedIn) continue
    const opened = String(thread.opened ?? '').trim()
    const matched = opened.match(/(\d+)/)
    const distance = matched && currentChapter ? currentChapter - Number(matched[1]) : null
    rows.push({
      text: String(thread.text ?? thread.title ?? thread.id ?? opened ?? '').trim() || opened,
      opened,
      distance,
    })
  }
  rows.sort((a, b) => (b.distance ?? -1) - (a.distance ?? -1))
  return rows
}

export function registerNovelTools(tools, engine) {
  const offs = []
  for (const definition of createTools(engine)) {
    const off = tools.register?.(definition)
    if (typeof off === 'function') offs.push(off)
  }
  return offs
}
