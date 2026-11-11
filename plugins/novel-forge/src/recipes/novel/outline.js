// outline.js — 卷章大纲的 JSON 规范化、章节 id 重排与查询。
// 契约：docs/architecture.md §4.2 / §4.4。
// 模型给的 id 一律不可信：扁平化后由本模块重排 ch01、ch02……
import { z } from 'zod'

// ForgeError 由引擎提供；并行施工期间 forge/ 可能还没落盘，用兼容的兜底类，
// 保证 code/message/detail 形状一致（engine 只看 err.code）。
async function loadForgeError() {
  try {
    const mod = await import('../../forge/errors.js')
    if (typeof mod?.ForgeError === 'function') return mod.ForgeError
    if (typeof mod?.default === 'function') return mod.default
  } catch {
    // forge/errors.js 尚未就绪
  }
  return class ForgeError extends Error {
    constructor(code, message, detail) {
      super(message)
      this.name = 'ForgeError'
      this.code = code
      this.detail = detail
    }
  }
}

const ForgeError = await loadForgeError()

function clip(value, max = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function fail(message, raw) {
  throw new ForgeError('LLM_PARSE', message, { raw: clip(raw) })
}

function formatZod(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : []
  return issues
    .map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('；')
}

const chapterSchema = z.object({
  id: z.unknown().optional(),
  title: z.string().min(1),
  goal: z.string(),
  conflict: z.string(),
  turn: z.string(),
  hook: z.string(),
  pov: z.string(),
  when: z.string(),
  where: z.string(),
  cast: z.array(z.unknown()),
})

const volumeSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  chapters: z.array(chapterSchema).min(1),
})

function normalizeCast(cast) {
  const names = []
  for (const entry of cast ?? []) {
    if (typeof entry === 'string') {
      const name = entry.trim()
      if (name) names.push(name)
    } else if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
      const name = entry.name.trim()
      if (name) names.push(name)
    }
  }
  return [...new Set(names)]
}

function parseMaybeJson(raw) {
  if (typeof raw !== 'string') return raw
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : text
  try {
    return JSON.parse(body)
  } catch {
    const start = body.search(/[{[]/)
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        /* fallthrough */
      }
    }
    return undefined
  }
}

export function chapterId(index, total = 0) {
  const width = Math.max(2, String(Math.max(total, index + 1)).length)
  return `ch${String(index + 1).padStart(width, '0')}`
}

/**
 * 规范化模型返回的 outline。
 * @param {object|string} raw
 * @param {{chapters?: number, language?: string}} opts
 * @returns {{volumes: Array, chapters: Array, totalChapters: number}}
 */
export function normalizeOutline(raw, { chapters, language = 'zh' } = {}) {
  const data = parseMaybeJson(raw)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('outline 必须是 JSON 对象', raw)
  }

  let volumesRaw = Array.isArray(data.volumes) ? data.volumes : null
  if (!volumesRaw && Array.isArray(data.chapters)) {
    volumesRaw = [{ title: '', purpose: '', chapters: data.chapters }]
  }
  if (!volumesRaw || volumesRaw.length === 0) {
    fail('outline.volumes 必须是非空数组', raw)
  }

  const parsed = z.array(volumeSchema).safeParse(volumesRaw)
  if (!parsed.success) {
    fail(`outline 字段不合契约（${formatZod(parsed.error)}）`, raw)
  }

  // 扁平收集：章节先按顺序排，再按计划章数裁剪，最后重新挂回卷
  const flat = []
  for (let v = 0; v < parsed.data.length; v += 1) {
    for (const chapter of parsed.data[v].chapters) {
      flat.push({
        volume: v,
        chapter: {
          id: null, // 裁剪、重排后统一生成
          title: chapter.title.trim(),
          goal: chapter.goal.trim(),
          conflict: chapter.conflict.trim(),
          turn: chapter.turn.trim(),
          hook: chapter.hook.trim(),
          pov: chapter.pov.trim(),
          when: chapter.when.trim(),
          where: chapter.where.trim(),
          cast: normalizeCast(chapter.cast),
        },
      })
    }
  }
  if (flat.length === 0) fail('outline 里没有章节', raw)

  // params.chapters 是成本/统计/UI 的唯一口径：模型多给一律裁掉，少给不补
  const planned = Math.floor(Number(chapters))
  const limit = Number.isFinite(planned) && planned > 0 ? planned : 0
  const dropped = limit > 0 && flat.length > limit ? flat.length - limit : 0
  const kept = dropped > 0 ? flat.slice(0, limit) : flat

  // 按裁剪后的总数确定 id 宽度：ch01…ch24 / ch001…ch120
  kept.forEach((entry, index) => {
    entry.chapter.id = chapterId(index, kept.length)
  })

  const volumes = parsed.data.map((volume) => ({
    title: volume.title.trim(),
    purpose: volume.purpose.trim(),
    chapters: [],
  }))
  for (const entry of kept) volumes[entry.volume].chapters.push(entry.chapter)

  // 只把“真实存在的卷”留下（空卷剔除）
  const nonEmpty = volumes.filter((volume) => volume.chapters.length > 0)
  const allChapters = kept.map((entry) => entry.chapter)

  return {
    volumes: nonEmpty,
    chapters: allChapters,
    totalChapters: allChapters.length,
    language,
    ...(dropped > 0 ? { trimmed: dropped } : {}),
  }
}

/** 从 outline 内容 / project 对象里取章节数组（扁平）。 */
export function chaptersOf(project) {
  if (!project) return []
  const candidates = [
    project,
    project?.outline,
    project?.content,
    project?.artifacts?.outline?.content,
    project?.artifacts?.outline,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.every((item) => item == null || typeof item === 'object')) {
      return candidate.filter((item) => item && typeof item === 'object')
    }
    if (candidate && typeof candidate === 'object' && Array.isArray(candidate.chapters)) {
      return candidate.chapters.filter((item) => item && typeof item === 'object')
    }
  }
  return []
}

/** 按 id 找章；找不到返回 null。 */
export function chapterById(project, id) {
  if (!id) return null
  return chaptersOf(project).find((chapter) => chapter.id === id) ?? null
}

export default { normalizeOutline, chaptersOf, chapterById, chapterId }
