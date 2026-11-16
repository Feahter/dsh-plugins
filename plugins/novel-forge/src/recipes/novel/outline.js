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

// 模型偶尔漏一两个章节字段是常态：除 title / goal 外一律兜底，
// 不能因为 when/where/conflict/turn/hook/pov/cast 缺一个就丢掉整份大纲。
const chapterSchema = z.object({
  id: z.unknown().optional(),
  title: z.string().min(1),
  goal: z.string(),
  conflict: z.string().catch(''),
  turn: z.string().catch(''),
  hook: z.string().catch(''),
  pov: z.string().catch(''),
  when: z.string().catch(''),
  where: z.string().catch(''),
  cast: z.array(z.unknown()).catch([]),
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

/** 全书中点章号：只收正数；缺省/非法静默丢弃，老项目不因此报错。 */
function optionalMidpoint(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
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

  // v0.2 卷章大纲（version:2）已经是脚本建好的骨架 / 惰性展开结果：
  // 再走一次 v1 扁平化会丢掉卷状态（planned/chapterIds）并因空卷报错，因此原样返回。
  // 只对 version:2 生效，v1 短篇行为保持不变。
  if (data.version === 2) return data

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
  const midpoint = optionalMidpoint(data.midpointChapter)

  return {
    volumes: nonEmpty,
    chapters: allChapters,
    totalChapters: allChapters.length,
    language,
    ...(midpoint != null ? { midpointChapter: midpoint } : {}),
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

// ---- X12 黄金三章契约（纯函数；已接进 novel_audit 与 novel_next，见 src/host/tools.js） ----

const OPENING_BANNED_PHRASES = ['后来', '不久', '更大的']

const PAYOFF_LEVEL_VALUE = {
  none: 0, 无: 0, 零: 0, 0: 0,
  small: 1, 小: 1, 1: 1,
  medium: 2, 中: 2, 2: 2,
  large: 3, 大: 3, 3: 3,
}

function openingText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function payoffLevelOf(payoff) {
  const raw = payoff?.level
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw)
  const key = openingText(raw).toLowerCase()
  return PAYOFF_LEVEL_VALUE[key] ?? 0
}

function openingChapter(outline, opener, index) {
  const openerList = Array.isArray(opener?.chapters) ? opener.chapters : []
  const outlineList = Array.isArray(outline?.chapters) ? outline.chapters : []
  const fromOpener =
    openerList.find((chapter) => Number(chapter?.index) === index) ?? openerList[index - 1] ?? null
  const fromOutline = outlineList[index - 1] ?? null
  const infoDrop = fromOpener?.infoDrop ?? fromOutline?.infoDrop ?? null
  const payoff = fromOpener?.payoff ?? fromOutline?.payoff ?? null
  const hook = fromOpener?.hook ?? null
  const endHook = fromOpener?.endHook ?? fromOutline?.endHook ?? null
  return {
    id: fromOpener?.id ?? fromOutline?.id ?? `ch${String(index).padStart(4, '0')}`,
    infoDrop: infoDrop && typeof infoDrop === 'object' ? infoDrop : null,
    promiseBeat: openingText(fromOpener?.promiseBeat) || openingText(fromOutline?.promiseBeat),
    payoff: payoff && typeof payoff === 'object' ? payoff : null,
    hookType:
      openingText(hook?.type) ||
      openingText(fromOpener?.hookType) ||
      openingText(fromOutline?.hookType),
    endHookType:
      openingText(endHook?.type) ||
      openingText(fromOutline?.endHookType) ||
      openingText(fromOpener?.endHookType),
    hookText:
      openingText(hook?.text) ||
      (typeof fromOutline?.hook === 'string' ? fromOutline.hook.trim() : ''),
  }
}

function openingIssue(chapter, issue, fix) {
  return {
    severity: 'note',
    kind: 'opening-contract',
    where: chapter?.id ?? '前三章',
    issue,
    fix,
  }
}

/**
 * 黄金三章 0/1 契约（07-platform-practice.md:120）。
 * 只做确定性判定：不调模型、不读写、不接流水线。缺 opener 工件时静默返回 ok。
 * @returns {{ ok: boolean, issues: Array<{severity:'note',kind:'opening-contract',where:string,issue:string,fix:string}> }}
 */
export function checkOpeningContract({ outline = null, opener = null } = {}) {
  if (!opener || typeof opener !== 'object') return { ok: true, issues: [] }
  const first = openingChapter(outline, opener, 1)
  const second = openingChapter(outline, opener, 2)
  const third = openingChapter(outline, opener, 3)
  const issues = []

  const infoDrop = first.infoDrop
  const hasInfoDrop = Boolean(
    infoDrop && (openingText(infoDrop.readerLearns) || openingText(infoDrop.characterLoses)),
  )
  if (!hasInfoDrop || !first.promiseBeat) {
    const missing = []
    if (!hasInfoDrop) missing.push('infoDrop 为空')
    if (!first.promiseBeat) missing.push('promiseBeat 为空')
    issues.push(
      openingIssue(
        first,
        `第 1 章缺黄金三章契约：${missing.join('、')}`,
        '第 1 章补上读者能获得的信息（infoDrop.readerLearns）和一句本章承诺（promiseBeat），再往下排',
      ),
    )
  }

  const payoff = second.payoff
  const hasPayoff = payoffLevelOf(payoff) >= 1 || Boolean(openingText(payoff?.text))
  if (!hasPayoff) {
    issues.push(
      openingIssue(
        second,
        '第 2 章没有可感知的兑现：payoff.level 为 none/0 且文本为空',
        '第 2 章给一次小兑现（payoff.level=small 或更高），并写清兑现了什么',
      ),
    )
  }

  // 第 3 章章末钩必须换型；优先对照第 1 章的 endHook.type，缺省退回 hook.type。
  const firstHookType = first.endHookType || first.hookType
  if (!third.endHookType || !firstHookType) {
    const missing = []
    if (!third.endHookType) missing.push('第 3 章 endHook.type')
    if (!firstHookType) missing.push('第 1 章 endHook/hook.type')
    issues.push(
      openingIssue(
        third,
        `无法判定第 3 章章末钩是否换型：${missing.join('、')} 缺失`,
        '给第 1/3 章补钩子类型，并让第 3 章换一种钩子类型（如悬念→反转）',
      ),
    )
  } else if (third.endHookType === firstHookType) {
    issues.push(
      openingIssue(
        third,
        `第 3 章 endHook.type「${third.endHookType}」与第 1 章相同，黄金三章钩子没有换型`,
        '把第 3 章章末钩换成与第 1 章不同的类型（危机/悬念/反转/情绪悬置/新信息）',
      ),
    )
  }

  const chapters = [first, second, third]
  const banned = OPENING_BANNED_PHRASES.filter((word) =>
    chapters.some((chapter) => chapter.hookText.includes(word)),
  )
  if (banned.length) {
    issues.push({
      severity: 'note',
      kind: 'opening-contract',
      where: '前三章',
      issue: `前三章 hook.text 出现空转词「${banned.join('」「')}」；这类钩子只说时间推移或抬价，没有具体危机`,
      fix: '把「后来/不久/更大的」改成具体的人、物、时限或直接后果（谁在什么时候要什么）',
    })
  }

  return { ok: issues.length === 0, issues }
}

export default { normalizeOutline, chaptersOf, chapterById, chapterId }
