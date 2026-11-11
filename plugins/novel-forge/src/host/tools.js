// novel_* 工具：让助手在对话里直接开书、查进度、读章节、跑流水线、导出。
// 每个工具都只做一层薄封装，真正的语义在 ForgeEngine 里。

import { httpError } from './json.js'

const JSON_KEYS = new Set(['brief', 'characters', 'outline', 'ledger', 'blurb'])

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

function chapterIdOf(raw) {
  const match = String(raw ?? '').match(/(\d+)/)
  if (!match) return null
  return `ch${String(Number(match[1])).padStart(2, '0')}`
}

const projectParam = {
  type: 'string',
  description: '项目 id、id 前缀或书名的一部分。省略时用最近更新的项目。',
}

async function resolve(engine, hint) {
  return engine.resolveProject(hint || 'active')
}

function projectLine(project) {
  const stats = project.stats ?? {}
  const params = project.params ?? {}
  return `《${project.title}》 ${params.genre ?? ''} · ${fmtNum(stats.drafted)}/${fmtNum(stats.chapters)} 章 · ${fmtNum(stats.words)} 字 · ${fmtDate(project.updatedAt)}`
}

function stageLines(project) {
  const stages = project.stages ?? {}
  const order = ['premise', 'bible', 'characters', 'spine', 'outline', 'beats', 'draft', 'review', 'revise', 'blurb']
  const mark = { done: '✓', running: '…', partial: '◐', error: '✗', paused: 'Ⅱ', idle: '·' }
  return order
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
          chapters: { type: 'number', description: '章数，6–120，默认 24。' },
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
      '看某个项目的详细进度：十个阶段的完成情况、每章状态、字数、当前运行、是否有等待确认的审稿门。',
      { type: 'object', properties: { project: projectParam }, additionalProperties: false },
      async args => {
        const project = await resolve(engine, args.project)
        const runs = await engine.listRuns(project.id)
        const active = project.activeRunId ? runs.find(run => run.id === project.activeRunId) ?? null : null
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
          activeRun: active ? { id: active.id, status: active.status, current: active.current, progress: active.progress } : null,
          recentRuns: runs.slice(0, 5).map(run => ({ id: run.id, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt })),
        }
      },
      { render: (_args, value) => {
        const project = value.project
        const lines = [projectLine(project), `阶段：${stageLines(project)}`]
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
      'novel_read',
      '读项目里的产物：给 key 读单个产物（brief/bible/characters/spine/outline/ledger/blurb/manuscript），给 chapter 读该章的细纲、草稿、审校、摘要。',
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
          const id = chapterIdOf(args.chapter)
          if (!id) throw new Error(`看不懂章节号：${args.chapter}`)
          const keys = [`beats/${id}`, `draft/${id}`, `review/${id}`, `summary/${id}`]
          const out = { ok: true, project: project.title, chapter: id }
          for (const key of keys) {
            const artifact = await engine.getArtifact(project.id, key)
            out[key.split('/')[0]] = artifact ? artifact.content : null
          }
          return out
        }
        if (args.key) {
          const artifact = await engine.getArtifact(project.id, args.key)
          if (!artifact) throw new Error(`没有这个产物：${args.key}`)
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
        return { ok: true, key: args.key, bytes: artifact?.bytes ?? null, version: artifact?.meta?.version ?? null }
      },
      { render: (_args, value) => text(`已保存 ${value.key}${value.version ? `（v${value.version}）` : ''}。`) },
    ),

    defineTool(
      'novel_run',
      '启动写作流水线（后台跑，立刻返回 runId）。可选 from/to/stages 只跑一段；force 强制重跑已完成的部分；dryRun 只校验不调模型。',
      {
        type: 'object',
        properties: {
          project: projectParam,
          from: { type: 'string', description: '从哪个阶段开始：premise/bible/characters/spine/outline/beats/draft/review/revise/blurb。' },
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
        const options = {}
        for (const key of ['from', 'to', 'stages', 'items', 'force', 'autoApprove', 'dryRun']) {
          if (args[key] !== undefined) options[key] = args[key]
        }
        const run = await engine.startRun(project.id, options)
        return { ok: true, project: { id: project.id, title: project.title }, run: { id: run.id, status: run.status, options: run.options } }
      },
      {
        timeoutMs: 120_000,
        render: (_args, value) => text(`已开炉：《${value.project.title}》\nrun ${value.run.id} · ${value.run.status}\n用 novel_status 看进度；面板里能看实时事件。`),
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

export function registerNovelTools(tools, engine) {
  const offs = []
  for (const definition of createTools(engine)) {
    const off = tools.register?.(definition)
    if (typeof off === 'function') offs.push(off)
  }
  return offs
}
