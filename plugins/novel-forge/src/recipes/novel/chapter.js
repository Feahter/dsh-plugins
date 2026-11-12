// chapter.js — 单章工作单元（架构 v0.2 §6）。
//
// 这一层只做「一章从材料到正文」的纯逻辑：不读盘、不写盘、不发网络。
// 所有 IO 都由调用方注入：
//   - read(key)        → 已落盘产物内容（正文/摘要/细纲/canon/spine…），缺失返回 null；
//   - llm.generate(spec) → {text, usage?}，spec 为 {system, user, maxTokens, temperature, json}。
//
// 五个入口与 §6 一字不差：
//   inspectChapter / ensureVolume / prepareChapter / commitChapter / checkChapter
// 外加内联协议解析 splitInline（§12）。
import { buildPacket } from './packet.js'
import {
  emptyCanon,
  mergeCanon,
  queryCanon,
  formatCanon,
  canonStats,
  canonProblems,
  migrateLedger,
} from './canon.js'
import { checkChapter as checkConsistency } from './consistency.js'
import { checkDraft, severityRank } from './craft.js'
import {
  isV2,
  migrateOutline,
  volumeById,
  volumeOfChapter,
  mergeVolumeChapters,
} from './plan.js'
import { createPrompts } from './prompts/zh.js'
import { ForgeError } from '../../forge/errors.js'

const SUMMARY_MARKER = '<<<SUMMARY>>>'
const CANON_MARKER = '<<<CANON>>>'
const PLACEHOLDER_TEXT = /正文缺失|无法修订|无法摘要/
const DEFAULT_PROMPT_MAX_TOKENS = 4096
const FALLBACK_MAX_TOKENS = 16000
const VOLUME_PROMPT_BUDGET = 9000
// prepareChapter 一次最多连开几卷。签名里没有 volumeId，只能从前往后展开；
// 直接跳到很后面的章会按卷数消耗模型调用，超过这个数就报错让调用方先规划。
const MAX_VOLUME_EXPANSIONS = 6
const MAX_SUMMARY_CHARS = 240

// ---------------------------------------------------------------- 小工具

function text(value) {
  return String(value ?? '').trim()
}

/** 按字符数截断（中文场景按 code point 更稳妥）。 */
function clip(value, maxChars) {
  const chars = Array.from(String(value ?? ''))
  if (chars.length <= maxChars) return chars.join('')
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`
}

function uniqueStrings(values) {
  const out = []
  for (const value of values ?? []) {
    const item = text(value)
    if (item && !out.includes(item)) out.push(item)
  }
  return out
}

/** 正文像占位符就没有正文（历史版本模型会回声「正文缺失」）。 */
function isPlaceholder(body) {
  const value = text(body)
  if (!value) return true
  if (value.length > 400) return false
  return PLACEHOLDER_TEXT.test(value)
}

function safeRead(read, key) {
  if (typeof read !== 'function' || !key) return null
  try {
    return read(key) ?? null
  } catch {
    return null
  }
}

/** 去掉 ```json … ``` 围栏。 */
function stripFence(value) {
  const raw = text(value)
  const matched = raw.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/)
  return matched ? matched[1].trim() : raw
}

/**
 * 宽松 JSON 解析：整段、代码围栏里的内容、或第一个 {/[ 到最后一个 }/] 的片段。
 * 解析不出来返回 undefined，绝不抛错（内联块坏了不能连累正文）。
 */
function parseJsonLoose(value) {
  if (value && typeof value === 'object') return value
  const raw = stripFence(value)
  if (!raw) return undefined
  const candidates = [raw]
  for (const matched of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(matched[1])
  }
  const start = raw.search(/[[{]/)
  if (start >= 0) {
    const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
    if (end > start) candidates.push(raw.slice(start, end + 1))
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim())
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // 换下一个候选
    }
  }
  return undefined
}

/** read 出来的对象（兼容 JSON 字符串）。 */
function readJson(read, key) {
  const value = safeRead(read, key)
  if (typeof value === 'string') {
    const parsed = parseJsonLoose(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function readText(read, key) {
  const value = safeRead(read, key)
  return typeof value === 'string' ? value : ''
}

function llmText(result) {
  if (typeof result === 'string') return result
  return typeof result?.text === 'string' ? result.text : ''
}

/** engine 可能给 result.json（对象）、json 字符串、或只有 text；三种都收。 */
function payloadOf(result) {
  const raw = result?.json
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = parseJsonLoose(raw)
    if (parsed !== undefined) return parsed
  }
  return parseJsonLoose(llmText(result))
}

// ---------------------------------------------------------------- 正典 / 人物

function normalizeCanon(canon) {
  if (canon && typeof canon === 'object' && !Array.isArray(canon)) return canon
  if (typeof canon === 'string') {
    const parsed = parseJsonLoose(canon)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }
  return null
}

function hasCanon(read) {
  if (normalizeCanon(safeRead(read, 'canon'))) return true
  return Boolean(readJson(read, 'ledger'))
}

/** 读 canon；没有 canon 但旧 ledger 存在时按 §4.3 迁移一次（纯函数，不落盘）。 */
function loadCanon(read) {
  const canon = normalizeCanon(safeRead(read, 'canon'))
  if (canon) return canon
  const ledger = readJson(read, 'ledger')
  if (ledger) {
    try {
      return migrateLedger(ledger, { characters: safeRead(read, 'characters') })
    } catch {
      return emptyCanon()
    }
  }
  return emptyCanon()
}

function charactersOf(read) {
  const data = safeRead(read, 'characters')
  if (Array.isArray(data)) return { cast: data }
  if (data && typeof data === 'object') return data
  return { cast: [] }
}

function castList(characters) {
  const list = Array.isArray(characters) ? characters : characters?.cast
  return Array.isArray(list) ? list.filter((item) => item && typeof item === 'object') : []
}

function namesOf(list) {
  const out = []
  for (const entry of Array.isArray(list) ? list : []) {
    const name = typeof entry === 'string' ? text(entry) : text(entry?.name)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

function chapterCastNames(chapter) {
  return namesOf(chapter?.cast)
}

function beatsCastNames(beats) {
  const out = namesOf(beats?.cast)
  for (const scene of Array.isArray(beats?.scenes) ? beats.scenes : []) {
    for (const name of namesOf(scene?.cast)) {
      if (!out.includes(name)) out.push(name)
    }
  }
  return out
}

/**
 * 人物小传：人物档案是 castBrief 的唯一来源（ledger.js 不在本章白名单里）。
 * 只取本章相关人物；没有档案时退回名字列表，至少让模型知道谁在场。
 */
function castBriefOf(characters, names, maxChars = 1500) {
  const people = castList(characters)
  const wanted = new Set(names)
  const picked = wanted.size ? people.filter((person) => wanted.has(text(person.name))) : people
  if (!picked.length) {
    return clip(names.map((name) => `- ${name}`).join('\n'), maxChars)
  }
  const lines = picked.map((person) => {
    const head = uniqueStrings([person.name, person.gender, person.role]).join(' · ')
    const detail = uniqueStrings([
      person.want ? `想要：${text(person.want)}` : '',
      person.fear ? `害怕：${text(person.fear)}` : '',
      person.secret ? `秘密：${text(person.secret)}` : '',
      person.voice ? `口吻：${text(person.voice)}` : '',
    ])
    return detail.length ? `- ${head}\n  ${detail.join('；')}` : `- ${head}`
  })
  return clip(lines.join('\n'), maxChars)
}

// ---------------------------------------------------------------- 大纲 / 上下文

/** v1 outline 在内存里迁到 v2（幂等）；迁不动就原样返回，让上层拿到明确报错。 */
function outlineV2(outline, params) {
  if (isV2(outline)) return outline
  if (outline && typeof outline === 'object' && Array.isArray(outline.chapters) && outline.chapters.length) {
    try {
      return migrateOutline(outline, { params })
    } catch {
      return outline
    }
  }
  return outline && typeof outline === 'object' ? outline : { version: 2, volumes: [], chapters: [] }
}

function chaptersOf(outline) {
  return Array.isArray(outline?.chapters) ? outline.chapters.filter(Boolean) : []
}

function findChapter(outline, chapterId) {
  return chaptersOf(outline).find((chapter) => chapter.id === chapterId) ?? null
}

function chapterIndexOf(outline, chapterId) {
  return chaptersOf(outline).findIndex((chapter) => chapter.id === chapterId)
}

function previousOf(outline, chapterId) {
  const chapters = chaptersOf(outline)
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  return index > 0 ? chapters[index - 1] : null
}

function nextOf(outline, chapterId) {
  const chapters = chaptersOf(outline)
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  return index >= 0 && index + 1 < chapters.length ? chapters[index + 1] : null
}

function unplannedVolume(outline) {
  const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
  return volumes.find((volume) => volume && !volume.planned && Number(volume.targetChapters) > 0) ?? null
}

/** 卷内已写章节的摘要，拼成给下一卷看的「前情」。 */
function digestOfVolume(read, outline, volume, { maxChars = 1000 } = {}) {
  if (!volume) return ''
  const ids = Array.isArray(volume.chapterIds) && volume.chapterIds.length
    ? volume.chapterIds
    : chaptersOf(outline).filter((chapter) => chapter.volume === volume.id).map((chapter) => chapter.id)
  const lines = []
  for (const id of ids) {
    const summary = readText(read, `summary/${id}`)
    if (!summary) continue
    const chapter = findChapter(outline, id)
    lines.push(`【${chapter?.title || id}】${summary}`)
  }
  return clip(lines.join('\n'), maxChars)
}

/** 同一卷里本章之前各章的摘要。 */
function volumeDigestOf(read, outline, chapter, maxChars = 1000) {
  if (!chapter?.volume) return ''
  const lines = []
  for (const item of chaptersOf(outline)) {
    if (item.volume !== chapter.volume) continue
    if (Number(item.index) >= Number(chapter.index)) break
    const summary = readText(read, `summary/${item.id}`)
    if (summary) lines.push(`【${item.title || item.id}】${summary}`)
  }
  return clip(lines.join('\n'), maxChars)
}

/** 上一卷（或全书此前）最近几章摘要，给卷纲 prompt 用。 */
function previousDigestForVolume(read, outline, volume, maxChars = 800) {
  const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
  const index = volumes.findIndex((item) => item?.id === volume?.id)
  const previous = index > 0 ? volumes[index - 1] : null
  if (!previous) {
    // 第一卷：把此前已写的摘要都算进来（断电续跑的场景）。
    const ids = chaptersOf(outline).map((chapter) => chapter.id)
    const lines = []
    for (const id of ids.slice(0, 6)) {
      const summary = readText(read, `summary/${id}`)
      if (summary) lines.push(`【${id}】${summary}`)
    }
    return clip(lines.join('\n'), maxChars)
  }
  return digestOfVolume(read, outline, previous, { maxChars })
}

/** 风格样本：最近两章的开头 + 结尾各 160 字，避免把整章塞进材料包。 */
function styleSampleOf(read, outline, chapter) {
  const chapters = chaptersOf(outline)
  const index = chapters.findIndex((item) => item.id === chapter?.id)
  if (index < 0) return ''
  const samples = []
  for (const item of chapters.slice(Math.max(0, index - 2), index)) {
    const draft = readText(read, `draft/${item.id}`)
    if (!draft || isPlaceholder(draft)) continue
    samples.push(`${clip(draft.slice(0, 160), 160)}\n……\n${clip(draft.slice(-160), 160)}`)
  }
  return clip(samples.join('\n\n'), 1200)
}

/** packet 的「最近三章」：不含紧邻的上一章（上一章单独成片）。 */
function recentSummariesOf(read, outline, chapter) {
  const chapters = chaptersOf(outline)
  const index = chapters.findIndex((item) => item.id === chapter?.id)
  if (index < 0) return []
  const out = []
  for (const item of chapters.slice(Math.max(0, index - 4), Math.max(0, index - 1))) {
    const summary = readText(read, `summary/${item.id}`)
    if (summary) out.push({ id: item.id, title: item.title, text: summary })
  }
  return out
}

function nextChapterGoalOf(outline, chapter) {
  const next = nextOf(outline, chapter?.id)
  if (!next) return ''
  return clip(uniqueStrings([next.goal, next.turn]).join('；'), 300)
}

/** 给 prompt 构造器的 read 适配器（prompts/zh.js 的 beats 期望 ctx.text/json/has）。 */
function promptIO(read) {
  return {
    text: (key, maxChars = 2000) => clip(readText(read, key), maxChars),
    json: (key) => readJson(read, key),
    has: (key) => safeRead(read, key) != null,
    fit: (value, maxChars) => clip(value, maxChars),
    read: (key) => safeRead(read, key),
  }
}

// ---------------------------------------------------------------- 内联协议

/**
 * 拆正文 / 摘要 / 正典补丁（§12）。
 * 正文永远保留：尾块坏了只记 parseError，绝不抛错。
 * @param {string} text
 * @returns {{body:string, summary:string|null, canonPatch:object|null, hadSummary:boolean, hadCanon:boolean, parseError:string|null}}
 */
export function splitInline(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '')
  const result = {
    body: raw.trim(),
    summary: null,
    canonPatch: null,
    hadSummary: false,
    hadCanon: false,
    parseError: null,
  }
  if (!raw.trim()) return result

  try {
    const summaryAt = raw.indexOf(SUMMARY_MARKER)
    const canonAt = raw.indexOf(CANON_MARKER)
    if (summaryAt < 0 && canonAt < 0) return result

    result.hadSummary = summaryAt >= 0
    result.hadCanon = canonAt >= 0
    const cut = Math.min(...[summaryAt, canonAt].filter((at) => at >= 0))
    result.body = raw.slice(0, cut).trim()

    if (summaryAt >= 0) {
      const end = canonAt > summaryAt ? canonAt : raw.length
      let summary = stripFence(raw.slice(summaryAt + SUMMARY_MARKER.length, end))
      summary = summary.replace(/^(?:本章)?摘要\s*[:：]\s*/, '').trim()
      result.summary = summary || null
    }

    if (canonAt >= 0) {
      const end = summaryAt > canonAt ? summaryAt : raw.length
      const block = stripFence(raw.slice(canonAt + CANON_MARKER.length, end))
      if (block) {
        const parsed = parseJsonLoose(block)
        if (parsed === undefined) {
          result.parseError = 'CANON 块不是合法 JSON'
        } else if (Array.isArray(parsed)) {
          // 数组按「事实补丁」处理（§6）。
          result.canonPatch = { facts: parsed }
        } else if (parsed && typeof parsed === 'object') {
          result.canonPatch = parsed
        } else {
          result.parseError = 'CANON 块必须是对象或数组'
        }
      }
    }
  } catch (error) {
    // 理论上走不到；兜底仍然只记错误，正文保留已经切好的部分。
    if (!result.body) result.body = raw.trim()
    result.parseError = `内联块解析失败：${error instanceof Error ? error.message : String(error)}`
  }

  return result
}

// ---------------------------------------------------------------- 检查

function normalizeFinding(finding) {
  if (!finding || typeof finding !== 'object') return null
  const severity = ['block', 'warn', 'note'].includes(finding.severity) ? finding.severity : 'note'
  return {
    severity,
    kind: text(finding.kind) || 'unknown',
    where: text(finding.where),
    issue: text(finding.issue),
    fix: text(finding.fix),
  }
}

function dedupeFindings(findings) {
  const seen = new Set()
  const out = []
  for (const finding of findings) {
    if (!finding || !finding.issue) continue
    const key = `${finding.severity}\u0000${finding.kind}\u0000${finding.where}\u0000${finding.issue}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(finding)
  }
  return out
}

function countFindings(findings) {
  const counts = { block: 0, warn: 0, note: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

function verdictOf(counts) {
  return counts.block > 0 || counts.warn >= 3 ? 'revise' : 'pass'
}

/**
 * 一致性 + craft 检查的共用入口；commitChapter 也走这里，避免两套判定。
 * @returns {{findings:Array, counts:object, verdict:string, stats:object}}
 */
function runChecks({
  text: body,
  canon,
  chapter,
  previousChapter,
  params = {},
  beats,
  cast,
  characters,
  extraFindings = [],
}) {
  const where = chapter?.id || '本章'
  const consistencyFindings = checkConsistency({
    text: body,
    canon,
    chapter,
    previousChapter,
    params,
    beats,
    cast,
  }) ?? []
  const craftResult = checkDraft({
    text: body,
    params,
    beats,
    previousHook: previousChapter?.hook ?? '',
    cast: castList(characters),
  }) ?? { findings: [], stats: {} }
  const canonFindings = canonProblems(canon, Number.isFinite(chapter?.index) ? { atChapter: chapter.index } : {}) ?? []

  const findings = dedupeFindings(
    [
      ...consistencyFindings.map(normalizeFinding).filter(Boolean),
      ...(craftResult.findings ?? []).map(normalizeFinding).filter(Boolean),
      ...canonFindings.map(normalizeFinding).filter(Boolean),
      ...extraFindings.map(normalizeFinding).filter(Boolean),
    ],
  ).sort((a, b) => severityRank(a.severity) - severityRank(b.severity))

  const counts = countFindings(findings)
  return {
    findings,
    counts,
    verdict: verdictOf(counts),
    stats: craftResult.stats ?? {},
  }
}

// ---------------------------------------------------------------- 审阅

/**
 * 看一章缺什么（§6）。
 * @returns {{chapter:object|null, volume:object|null, ready:boolean, missing:string[], found:boolean}}
 */
export function inspectChapter({ outline, chapterId, read } = {}) {
  const current = outline && typeof outline === 'object' ? outline : {}
  const chapter = findChapter(current, chapterId)
  if (!chapter) {
    return { chapter: null, volume: null, ready: false, missing: [], found: false }
  }
  const volume = isV2(current) ? volumeOfChapter(current, chapterId) : null
  const missing = []
  if (!volume || !volume.planned) missing.push('volume-plan')
  if (!readJson(read, `beats/${chapterId}`)) missing.push('beats')
  if (isPlaceholder(readText(read, `draft/${chapterId}`))) missing.push('draft')
  if (!hasCanon(read)) missing.push('canon')
  return {
    chapter,
    volume,
    ready: missing.length === 0,
    missing,
    found: true,
  }
}

// ---------------------------------------------------------------- 卷纲

/** prompts/zh.js 还没有 volumeChapters 时的兜底（L6 落盘后自动让位）。 */
function fallbackVolumePrompt(ctx) {
  const volume = ctx?.volume ?? {}
  const params = ctx?.params ?? {}
  const count = Number(volume.targetChapters) || 0
  const lines = []
  const system = [
    '你是长篇小说的卷纲策划。',
    '只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。',
    '章节要按顺序推进，每章必须有可写的事件、冲突和转折；不要写概括性的主题句。',
  ].join('\n')

  lines.push(`【任务】为第 ${volume.index ?? '?'} 卷《${volume.title || '未命名'}》展开 ${count} 章细纲。`)
  if (volume.goal) lines.push(`【本卷目标】${text(volume.goal)}`)
  if (volume.opens?.length) lines.push(`【本卷开线】${uniqueStrings(volume.opens).join('；')}`)
  if (volume.closes?.length) lines.push(`【本卷收线】${uniqueStrings(volume.closes).join('；')}`)
  const meta = uniqueStrings([params.genre, params.pov, params.tone]).join(' · ')
  if (meta) lines.push(`【基调】${meta}`)
  if (params.wordsPerChapter) lines.push(`【单章字数】约 ${params.wordsPerChapter} 字`)

  const spine = typeof ctx?.spine === 'string' ? ctx.spine : text(JSON.stringify(ctx?.spine ?? ''))
  if (spine && spine !== '""') lines.push(`【全书卷纲】\n${clip(spine, 1600)}`)
  const bible = text(ctx?.bible)
  if (bible) lines.push(`【世界设定】\n${clip(bible, 1200)}`)
  const characters = ctx?.characters
  const brief = castBriefOf(characters, [], 900)
  if (brief) lines.push(`【人物档案】\n${brief}`)
  const previous = text(ctx?.previousDigest)
  if (previous) lines.push(`【前情提要】\n${clip(previous, 900)}`)
  if (ctx?.existingTitles) lines.push(`【已用章节标题（避免重复）】${clip(ctx.existingTitles, 500)}`)

  lines.push([
    '【输出格式】',
    '{"chapters":[{"title":"","goal":"","conflict":"","turn":"","hook":"","pov":"","when":"","where":"","cast":[]}]}',
    `要求：chapters 恰好 ${count} 条，按顺序编号；title 不重复；cast 只填本章实际出场的人物名；`,
    'goal 写「谁要做什么」，conflict 写「谁/什么阻拦」，turn 写「结果如何反转」，hook 写「章末未解决的问题」。',
  ].join('\n'))

  return {
    system,
    user: clip(lines.join('\n\n'), VOLUME_PROMPT_BUDGET),
    maxTokens: Math.min(FALLBACK_MAX_TOKENS, 800 + count * 240),
    temperature: 0.7,
  }
}

function volumePromptContext({ outline, params, read, volume, language }) {
  const allChapters = chaptersOf(outline)
  const existingTitles = uniqueStrings(allChapters.map((chapter) => chapter.title)).join('、')
  // 卷首章号：提示词（尤其 L6 的 volumeChapters）依赖它算章号区间；
  // 前面的卷即使没展开，也按其 targetChapters 占位，保证卷间章号连续。
  const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
  const at = volumes.findIndex((item) => item && item.id === volume?.id)
  const before = at > 0 ? volumes.slice(0, at) : []
  const startChapter = before.reduce((sum, item) => sum + (Number(item?.targetChapters) || 0), 1)
  return {
    params,
    volume: { ...volume, startChapter: Number(volume?.startChapter) || startChapter },
    language,
    // 原样给：spine 可能是 markdown，也可能是带 volumes 的 JSON 对象，
    // 提示词自己的 ctx.json('spine') 比字符串裁剪更能保住结构。
    spine: safeRead(read, 'spine'),
    bible: readText(read, 'bible'),
    characters: safeRead(read, 'characters'),
    previousDigest: previousDigestForVolume(read, outline, volume),
    existingTitles: clip(existingTitles, 600),
    ...promptIO(read),
  }
}

/** 只保留能落成章的行；标题与目标都空的丢掉。 */
function normalizeVolumeRows(rows, volume) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue
    const title = text(row.title)
    const goal = text(row.goal)
    if (!title && !goal) continue
    out.push({
      title,
      goal,
      conflict: text(row.conflict),
      turn: text(row.turn),
      hook: text(row.hook),
      pov: text(row.pov) || text(volume?.pov),
      when: text(row.when),
      where: text(row.where),
      cast: namesOf(row.cast),
    })
  }
  return out
}

/**
 * 展开下一卷卷纲（§3/§6）。只处理 planned:false 的卷；同卷重复调用不会重复请求模型。
 * @returns {{outline:object, calls:number, created:boolean}}
 */
export async function ensureVolume({ outline, params = {}, read, llm, language }, ...rest) {
  const options = rest[0] ?? {}
  const current = outlineV2(outline, params)
  const target = unplannedVolume(current)
  if (!target) return { outline: current, calls: 0, created: false }
  if (!llm || typeof llm.generate !== 'function') {
    throw new ForgeError('BAD_RECIPE', 'ensureVolume 需要注入 llm.generate')
  }

  const builders = resolvePrompts(options)
  const builder = typeof builders.volumeChapters === 'function'
    ? builders.volumeChapters
    : fallbackVolumePrompt
  const lang = language || params.language || current.language || 'zh'
  const ctx = { ...volumePromptContext({ outline: current, params, read, volume: target, language: lang }), language: lang }

  let spec
  try {
    spec = await builder(ctx)
  } catch (error) {
    throw new ForgeError(
      'BAD_RECIPE',
      `卷纲 prompt 构造失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!spec || typeof spec !== 'object' || !spec.user) {
    throw new ForgeError('BAD_RECIPE', '卷纲 prompt 必须返回 {system,user}')
  }

  const result = await llm.generate({
    system: String(spec.system ?? ''),
    user: String(spec.user ?? ''),
    maxTokens: Number.isFinite(spec.maxTokens) ? Math.round(spec.maxTokens) : DEFAULT_PROMPT_MAX_TOKENS,
    temperature: Number.isFinite(spec.temperature) ? spec.temperature : 0.7,
    json: true,
  })

  const payload = payloadOf(result)
  const rows = Array.isArray(payload) ? payload : payload?.chapters
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ForgeError('LLM_PARSE', `第 ${target.id} 卷卷纲：模型没有返回章节数组`, {
      text: clip(llmText(result), 800),
    })
  }

  const normalized = normalizeVolumeRows(rows, target).slice(0, Math.max(1, target.targetChapters))
  if (!normalized.length) {
    throw new ForgeError('LLM_PARSE', `第 ${target.id} 卷卷纲：章节都没有标题或目标`, {
      text: clip(llmText(result), 800),
    })
  }

  const next = mergeVolumeChapters(current, target.id, normalized)
  const expanded = volumeById(next, target.id)
  if (!expanded || !expanded.planned) {
    throw new ForgeError('LLM_PARSE', `第 ${target.id} 卷卷纲合并后为空`)
  }
  return { outline: next, calls: 1, created: true }
}

// ---------------------------------------------------------------- 细纲 + 材料包

function beatsPromptContext({ outline, params, read, chapter, volume, language }) {
  const chapters = chaptersOf(outline)
  const index = chapters.findIndex((item) => item.id === chapter?.id)
  const previous = index > 0 ? chapters[index - 1] : null
  const characters = charactersOf(read)
  const names = chapterCastNames(chapter)
  const canon = loadCanon(read)
  const canonText = formatCanon(
    queryCanon(canon, {
      cast: names,
      keywords: uniqueStrings([chapter?.goal, chapter?.conflict]),
      location: chapter?.where,
      atChapter: chapter?.index,
      limit: 120,
    }),
    { maxChars: 3200 },
  )
  return {
    params,
    item: chapter,
    items: chapters,
    index,
    chapter,
    volume,
    previousSummary: previous ? readText(read, `summary/${previous.id}`) : '',
    canonText,
    castBrief: castBriefOf(characters, names, 1500),
    language,
    ...promptIO(read),
  }
}

function normalizeBeats(raw, chapter) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ForgeError('LLM_PARSE', `第 ${chapter.id} 章细纲：模型没有返回 JSON 对象`)
  }
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes.filter((scene) => scene && typeof scene === 'object')
    : []
  const beats = Array.isArray(raw.beats) ? raw.beats : []
  if (!scenes.length && !beats.length) {
    throw new ForgeError('LLM_PARSE', `第 ${chapter.id} 章细纲：scenes/beats 都是空的`)
  }
  return {
    ...raw,
    chapterId: chapter.id,
    title: text(raw.title) || chapter.title,
    scenes,
    beats,
    cast: namesOf(raw.cast),
  }
}

function resolvePrompts(options = {}) {
  let base = {}
  try {
    base = createPrompts() ?? {}
  } catch {
    base = {}
  }
  return { ...base, ...(options?.prompts ?? {}) }
}

/**
 * 生成一章材料包（§3/§6）：审阅 → 缺卷则展开 → 缺细纲则生成 → buildPacket。
 * 返回的 beats 由调用方负责落盘（本层不写盘）。
 * @returns {Promise<{chapter:object, volume:object|null, beats:object|null, packet:{text:string,report:object}, canon:object, calls:number}>}
 */
export async function prepareChapter({ outline, params = {}, chapterId, read, llm, language }, ...rest) {
  const options = rest[0] ?? {}
  const builders = resolvePrompts(options)
  const lang = language || params.language || 'zh'
  let current = outlineV2(outline, params)
  let chapter = findChapter(current, chapterId)
  let calls = 0

  // 卷纲懒展开：签名没有 volumeId，只能从第一条未规划的卷开始。
  for (let guard = 0; guard < MAX_VOLUME_EXPANSIONS; guard += 1) {
    const volume = isV2(current) ? volumeOfChapter(current, chapterId) : null
    if (chapter && volume?.planned) break
    if (!unplannedVolume(current)) break
    const result = await ensureVolume({ outline: current, params, read, llm, language: lang }, options)
    calls += result.calls
    current = result.outline
    chapter = findChapter(current, chapterId)
    if (!result.created) break
  }

  if (!chapter) {
    throw new ForgeError('NOT_FOUND', `大纲里没有 ${chapterId}；请先按顺序展开它所在卷的卷纲`)
  }

  const volume = isV2(current) ? volumeOfChapter(current, chapterId) : null
  const previous = previousOf(current, chapterId)
  let beats = readJson(read, `beats/${chapterId}`)

  if (!beats) {
    if (!llm || typeof llm.generate !== 'function') {
      throw new ForgeError('BAD_RECIPE', 'prepareChapter 生成细纲需要注入 llm.generate')
    }
    const builder = typeof builders.beats === 'function' ? builders.beats : null
    if (!builder) throw new ForgeError('BAD_RECIPE', 'prompts.beats 不可用')
    const ctx = beatsPromptContext({ outline: current, params, read, chapter, volume, language: lang })
    const spec = await builder(ctx)
    if (!spec || typeof spec !== 'object' || !spec.user) {
      throw new ForgeError('BAD_RECIPE', '细纲 prompt 必须返回 {system,user}')
    }
    const result = await llm.generate({
      system: String(spec.system ?? ''),
      user: String(spec.user ?? ''),
      maxTokens: Number.isFinite(spec.maxTokens) ? Math.round(spec.maxTokens) : DEFAULT_PROMPT_MAX_TOKENS,
      temperature: Number.isFinite(spec.temperature) ? spec.temperature : 0.8,
      json: true,
    })
    calls += 1
    beats = normalizeBeats(payloadOf(result), chapter)
  }

  const canon = loadCanon(read)
  const names = uniqueStrings([...chapterCastNames(chapter), ...beatsCastNames(beats)])
  const canonText = formatCanon(
    queryCanon(canon, {
      cast: names,
      keywords: uniqueStrings([chapter.goal, chapter.conflict]),
      location: chapter.where,
      atChapter: chapter.index,
      limit: 120,
    }),
    { maxChars: 3200 },
  )
  const characters = charactersOf(read)
  const packet = buildPacket({
    params,
    chapter,
    volume,
    beats,
    previous: previous ? { id: previous.id, title: previous.title, hook: previous.hook } : null,
    previousSummary: previous ? readText(read, `summary/${previous.id}`) : '',
    recentSummaries: recentSummariesOf(read, current, chapter),
    volumeDigest: volumeDigestOf(read, current, chapter),
    canonText,
    castBrief: castBriefOf(characters, names, 1500),
    styleSample: styleSampleOf(read, current, chapter),
    nextChapterGoal: nextChapterGoalOf(current, chapter),
    revisionFindings: [],
    mode: options.mode === 'revise' ? 'revise' : 'draft',
  })

  return {
    chapter,
    volume,
    beats,
    packet: { text: packet.text, report: packet.report },
    canon,
    calls,
  }
}

// ---------------------------------------------------------------- 提交

function normalizePatch(patch) {
  if (!patch) return null
  if (Array.isArray(patch)) return patch.length ? { facts: patch } : null
  if (typeof patch === 'string') {
    const parsed = parseJsonLoose(patch)
    return parsed ? normalizePatch(parsed) : null
  }
  if (typeof patch !== 'object') return null
  return Object.keys(patch).length ? patch : null
}

/**
 * 提交一章：拆内联块 → 合并 canon → 检查 → 返回待落盘产物（§6）。
 * 文本为空/占位直接抛 LLM_PARSE；尾块坏掉只丢补丁，不丢正文。
 * @returns {{artifacts:{draft:{kind:string,content:string}, summary:{kind:string,content:string}}, canon:object, stats:object, findings:Array, counts:object, verdict:string}}
 */
export function commitChapter({ read, params = {}, outline, chapterId, text, summary, canonPatch } = {}) {
  const split = splitInline(text)
  if (isPlaceholder(split.body)) {
    throw new ForgeError('LLM_PARSE', `第 ${chapterId} 章正文为空或为占位文本`)
  }

  const current = outlineV2(outline, params)
  const chapter = findChapter(outline, chapterId)
    ?? findChapter(current, chapterId)
    ?? { id: chapterId, title: '', cast: [], index: undefined }
  const previous = previousOf(outline, chapterId) ?? previousOf(current, chapterId)
  const canon = loadCanon(read)
  const patch = normalizePatch(canonPatch ?? split.canonPatch)
  const merged = patch ? mergeCanon(canon, patch, { chapter: chapterId }) : canon

  const extraFindings = []
  if (split.parseError) {
    extraFindings.push({
      severity: 'warn',
      kind: 'canon-parse-error',
      where: chapterId,
      issue: split.parseError,
      fix: '让模型按 §12 重发 CANON 块，或手工补一条正典补丁；本章正文已保留',
    })
  }

  let finalSummary = String(summary ?? '').trim() || String(split.summary ?? '').trim()
  if (!finalSummary) {
    // 摘要缺失不阻塞：用正文前 240 字兜底（严格截断，不加省略号），并留一条 note 给下游。
    finalSummary = Array.from(split.body).slice(0, MAX_SUMMARY_CHARS).join('')
    extraFindings.push({
      severity: 'note',
      kind: 'summary-missing',
      where: chapterId,
      issue: '模型没有给出内联摘要，已用正文前 240 字兜底',
      fix: '下一章开局前可手工补写 200–400 字摘要，摘要会进入后续材料包',
    })
  }

  const characters = charactersOf(read)
  const names = uniqueStrings([...chapterCastNames(chapter), ...beatsCastNames(readJson(read, `beats/${chapterId}`))])
  const cast = names.length ? names : null
  const checked = runChecks({
    text: split.body,
    canon: merged,
    chapter,
    previousChapter: previous,
    params,
    beats: readJson(read, `beats/${chapterId}`),
    cast,
    characters,
    extraFindings,
  })

  return {
    artifacts: {
      draft: { kind: 'md', content: split.body },
      summary: { kind: 'md', content: finalSummary },
    },
    canon: merged,
    stats: canonStats(merged),
    findings: checked.findings,
    counts: checked.counts,
    verdict: checked.verdict,
  }
}

// ---------------------------------------------------------------- 章检查

/**
 * 检查一章正文（§6/§8）：consistency + craft + canon 结构问题，合并去重排序。
 * @returns {{findings:Array, counts:object, verdict:'pass'|'revise', canon:object}}
 */
export function checkChapter({ read, params = {}, outline, chapterId, text } = {}) {
  const current = outlineV2(outline, params)
  const chapter = findChapter(outline, chapterId)
    ?? findChapter(current, chapterId)
    ?? { id: chapterId, title: '', cast: [], index: undefined }
  const previous = previousOf(outline, chapterId) ?? previousOf(current, chapterId)
  const canon = loadCanon(read)
  const characters = charactersOf(read)
  const beats = readJson(read, `beats/${chapterId}`)
  const names = uniqueStrings([...chapterCastNames(chapter), ...beatsCastNames(beats)])

  const checked = runChecks({
    text: String(text ?? ''),
    canon,
    chapter,
    previousChapter: previous,
    params,
    beats,
    cast: names.length ? names : null,
    characters,
  })

  return {
    findings: checked.findings,
    counts: checked.counts,
    verdict: checked.verdict,
    canon,
  }
}

export default {
  inspectChapter,
  ensureVolume,
  prepareChapter,
  commitChapter,
  checkChapter,
  splitInline,
}
