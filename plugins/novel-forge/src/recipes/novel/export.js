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
    .replace(/^\s*#{1,4}\s*第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]*\n+/, '')
    .trim()
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
    content: marked.parse(`## 第${chapter.no}章 ${chapter.title}\n\n${chapter.body}`),
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

export const exports = {
  markdown: { title: 'Markdown', run: markdownExport },
  epub: { title: 'EPUB', run: epubExport },
}

export default exports
