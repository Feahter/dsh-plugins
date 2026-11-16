// export.js — 全书组装与导出（Markdown / EPUB）。
// 契约：docs/architecture.md §4.6。只读 ctx 的产物，不调模型。
import { chaptersOf } from './outline.js'
import { countCjk } from './craft.js'

function safeJson(ctx, key, fallback = null) {
  try {
    if (typeof ctx.has === 'function' && !ctx.has(key)) return fallback
    if (typeof ctx.json !== 'function') return fallback
    return ctx.json(key) ?? fallback
  } catch {
    return fallback
  }
}

function safeText(ctx, key) {
  try {
    if (typeof ctx.text !== 'function') return ''
    return ctx.text(key) ?? ''
  } catch {
    return ''
  }
}

function stripFence(markdown) {
  const text = String(markdown ?? '').trim()
  const fenced = text.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i)
  return fenced ? fenced[1].trim() : text
}

export function stripChapterHeading(markdown) {
  return stripFence(markdown)
    // 模型常写「第一章 头七」而不带井号；两种都要剥，否则导出会多一行重复标题。
    .replace(/^\s*(?:#{1,4}\s*)?第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]*\n+/, '')
    .trim()
}

/** EPUB 里不要原始 HTML：正文里的 <script>/<img onerror> 会被阅读器执行成 XSS。 */
function escapeAngle(text) {
  return String(text ?? '').replace(/</g, '&lt;')
}

/** `<slug>-<yyyyMMdd>.<ext>`：保留中文，去掉路径非法字符。 */
export function slugify(title, fallback = '未命名') {
  const raw = String(title ?? '').normalize('NFKC')
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return cleaned || fallback
}

export function dateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function exportFilename(title, ext, date = new Date()) {
  return `${slugify(title)}-${dateStamp(date)}.${ext}`
}

/** 汇总书名/简介/正文。只收已有草稿的章，章号仍按 outline 原序。 */
export function buildManuscript(ctx) {
  const params = ctx.params ?? {}
  const outline = safeJson(ctx, 'outline', {})
  const brief = safeJson(ctx, 'brief', {}) ?? {}
  const blurbArtifact = safeJson(ctx, 'blurb', null)
  const outlineChapters = chaptersOf(outline)

  const title = String(
    blurbArtifact?.title || brief.title || params.title || '未命名',
  ).trim()
  const blurb = String(blurbArtifact?.blurb || blurbArtifact?.tagline || brief.logline || '').trim()

  const chapters = []
  outlineChapters.forEach((chapter, index) => {
    const body = stripChapterHeading(safeText(ctx, `draft/${chapter.id}`))
    if (!body) return
    chapters.push({
      no: index + 1,
      id: chapter.id,
      title: String(chapter.title ?? '').trim(),
      body,
    })
  })

  const words = chapters.reduce((total, chapter) => total + countCjk(chapter.body), 0)
  return { title, blurb, chapters, words }
}

export function manuscriptMarkdown(manuscript) {
  const { title, blurb, chapters, words } = manuscript
  const lines = [`# ${title}`, '']
  if (blurb) {
    lines.push(`> ${blurb}`, '')
  }

  if (chapters.length) {
    lines.push('## 目录', '')
    for (const chapter of chapters) {
      lines.push(`- 第${chapter.no}章 ${chapter.title}`)
    }
    lines.push('')
  }

  for (const chapter of chapters) {
    lines.push('---', '', `## 第${chapter.no}章 ${chapter.title}`, '', chapter.body, '')
  }

  lines.push('---', '', `共 ${chapters.length} 章 ｜ 约 ${words} 字`, '')
  return lines.join('\n')
}

export async function markdownExport(ctx) {
  const manuscript = buildManuscript(ctx)
  const text = manuscriptMarkdown(manuscript)
  return {
    filename: exportFilename(manuscript.title, 'md'),
    mime: 'text/markdown; charset=utf-8',
    buffer: Buffer.from(text, 'utf8'),
  }
}

export async function epubExport(ctx) {
  const manuscript = buildManuscript(ctx)
  const language = ctx.params?.language === 'en' ? 'en' : 'zh'
  const { marked } = await import('marked')
  const imported = await import('epub-gen-memory')
  const epub = imported.default?.default ?? imported.default ?? imported

  const content = manuscript.chapters.map((chapter) => ({
    title: `第${chapter.no}章 ${chapter.title}`,
    // 只转义尖括号：保留 markdown 语法，同时让正文里的裸 HTML 变成纯文本。
    content: marked.parse(`## 第${chapter.no}章 ${escapeAngle(chapter.title)}\n\n${escapeAngle(chapter.body)}`),
  }))

  if (!content.length) {
    content.push({ title: '序', content: marked.parse(`# ${manuscript.title}\n\n（尚无草稿）`) })
  }

  const buffer = await epub(
    {
      title: manuscript.title,
      author: '墨炉',
      lang: language,
      description: manuscript.blurb || undefined,
    },
    content,
  )

  return {
    filename: exportFilename(manuscript.title, 'epub'),
    mime: 'application/epub+zip',
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  }
}

// ---- 编辑审稿单（outline-editor）：纯确定性表格，不调模型 ----

const OUTLINE_EDITOR_COLUMNS = [
  '章号', '标题', 'POV', '目标', '冲突', '转折', '钩子类型', '钩子强度',
  '爽点等级', '伏笔(立)', '伏笔(收)', '字数预算', '状态', '审校结论',
]

const DASH = '—'

function safeHas(ctx, key) {
  try {
    return typeof ctx.has === 'function' && ctx.has(key) === true
  } catch {
    return false
  }
}

function cell(value) {
  if (value === null || value === undefined) return DASH
  const text = String(value).trim()
  return text || DASH
}

/** plan.js 把 payoff 规范成 { level, text }；旧数据可能是纯字符串。 */
function payoffOfChapter(chapter) {
  const payoff = chapter?.payoff
  if (payoff && typeof payoff === 'object' && !Array.isArray(payoff)) {
    return { level: payoff.level, text: payoff.text }
  }
  if (typeof payoff === 'string') return { level: '', text: payoff }
  return { level: '', text: '' }
}

function threadOpenText(chapter) {
  const list = Array.isArray(chapter?.threadDue) ? chapter.threadDue : []
  return list
    .map((item) => (typeof item === 'string' ? item : item && typeof item === 'object' ? item.text : ''))
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .join('、')
}

function hookStrengthCell(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DASH
  return String(value).trim()
}

/**
 * 审校结论：review/* 的真实 schema 是 { findings, canonPatch, verdict }
 * （见 src/recipes/novel/index.js 的 review 阶段 / reviewSchema）。
 * 这里只读不推断：verdict 缺失时按与生产代码相同的 block/warn 阈值判定。
 */
function reviewConclusion(ctx, id) {
  let artifact = null
  try {
    artifact = typeof ctx.read === 'function' && id ? ctx.read(`review/${id}`) : null
  } catch {
    artifact = null
  }
  if (!artifact) return DASH

  let data = artifact?.content ?? artifact
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return DASH
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return DASH

  const findings = Array.isArray(data.findings) ? data.findings : []
  const counts = { block: 0, warn: 0, note: 0 }
  for (const finding of findings) {
    const severity = finding?.severity
    if (severity === 'block' || severity === 'warn' || severity === 'note') counts[severity] += 1
  }

  const verdict = data.verdict === 'pass'
    ? '通过'
    : data.verdict === 'revise'
      ? '需修订'
      : counts.block > 0 || counts.warn >= 3 ? '需修订' : '通过'
  const top =
    findings.find((finding) => finding?.severity === 'block' && String(finding?.issue ?? '').trim()) ??
    findings.find((finding) => finding?.severity === 'warn' && String(finding?.issue ?? '').trim()) ??
    findings.find((finding) => String(finding?.issue ?? '').trim())
  const issue = String(top?.issue ?? '').trim()
  const head = `${verdict}（block ${counts.block} / warn ${counts.warn} / note ${counts.note}）`
  return issue ? `${head}：${issue}` : head
}

function outlineEditorTitle(ctx) {
  const params = ctx.params ?? {}
  const outline = safeJson(ctx, 'outline', {})
  const brief = safeJson(ctx, 'brief', {}) ?? {}
  const blurbArtifact = safeJson(ctx, 'blurb', null)
  // project.title 是 novel_create 时给的书名，优先级低于作者后来改过的 brief/blurb。
  return String(
    blurbArtifact?.title || brief.title || params.title || ctx.project?.title || outline?.title || '未命名',
  ).trim() || '未命名'
}

function collectOutlineEditor(ctx) {
  const outline = safeJson(ctx, 'outline', {})
  const chapters = chaptersOf(outline)
  const params = ctx.params ?? {}
  const budgetRaw = params.wordsPerChapter ?? 3000
  const budget = Number.isFinite(Number(budgetRaw)) && String(budgetRaw).trim() !== ''
    ? String(budgetRaw)
    : '3000'

  let written = 0
  let reviewed = 0
  const rows = chapters.map((chapter, index) => {
    const id = String(chapter.id ?? '')
    const hasDraft = Boolean(id) && safeHas(ctx, `draft/${id}`)
    const hasReview = Boolean(id) && safeHas(ctx, `review/${id}`)
    if (hasDraft) written += 1
    if (hasReview) reviewed += 1
    // 审校发生在成稿之后：有 review 就算「已审」，否则才看有没有草稿。
    const status = hasReview ? '已审' : hasDraft ? '已写' : '未写'
    const payoff = payoffOfChapter(chapter)
    return [
      String(index + 1),
      cell(chapter.title),
      cell(chapter.pov),
      cell(chapter.goal),
      cell(chapter.conflict),
      cell(chapter.turn),
      cell(chapter.hookType),
      hookStrengthCell(chapter.hookStrength),
      cell(payoff.level),
      cell(threadOpenText(chapter)),
      cell(payoff.text),
      cell(budget),
      status,
      reviewConclusion(ctx, id),
    ]
  })

  return {
    title: outlineEditorTitle(ctx),
    rows,
    total: chapters.length,
    written,
    reviewed,
  }
}

function markdownCell(value) {
  // 表格单元格里的 `|` 与换行不转义就会把 14 列撑破。
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

/** RFC4180：字段含逗号/双引号/换行时整体加引号，内部双引号翻倍。 */
function csvCell(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function outlineEditorExport(ctx) {
  const { title, rows, total, written, reviewed } = collectOutlineEditor(ctx)
  const base = `${slugify(title)}-编辑审稿单`

  const markdown = [
    `# 《${title}》编辑审稿单`,
    `共 ${total} 章 · 已写 ${written} 章 · 已审 ${reviewed} 章`,
    '',
    `| ${OUTLINE_EDITOR_COLUMNS.join(' | ')} |`,
    `| ${OUTLINE_EDITOR_COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`),
    '',
  ].join('\n')

  const csv = [
    OUTLINE_EDITOR_COLUMNS.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
    '',
  ].join('\r\n')

  return {
    filename: `${base}.md`,
    mime: 'text/markdown; charset=utf-8',
    buffer: Buffer.from(markdown, 'utf8'),
    extras: [
      { filename: `${base}.csv`, buffer: Buffer.from(`\ufeff${csv}`, 'utf8') },
    ],
  }
}

export const exports = {
  markdown: { title: 'Markdown', run: markdownExport },
  epub: { title: 'EPUB', run: epubExport },
  'outline-editor': { title: '编辑审稿单', run: outlineEditorExport },
}

export default exports
