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
import { buildPacket, DUE_THREADS_SPEC, loreHaystack, loreTextOf, materialsTextOf, sliceBodyCap, sliceOf } from './packet.js'
import {
  emptyCanon,
  mergeCanon,
  queryCanon,
  formatCanon,
  canonStats,
  canonProblems,
  chapterNumber,
  entityOf,
  migrateLedger,
  recordAppearances,
} from './canon.js'
import { checkChapter as checkConsistency } from './consistency.js'
import { checkDraft, draftVerdict, severityRank } from './craft.js'
import {
  isV2,
  migrateOutline,
  volumeById,
  volumeOfChapter,
  mergeVolumeChapters,
} from './plan.js'
import { createPrompts, genrePromise } from './prompts/zh.js'
import { ForgeError } from '../../forge/errors.js'

const SUMMARY_MARKER = '<<<SUMMARY>>>'
const CANON_MARKER = '<<<CANON>>>'
// 标记只有独立成行才算协议分隔符；行内出现是正文（角色可能就在写这三个符号）。
const SUMMARY_LINE = /^<<<SUMMARY>>>\s*$/m
const CANON_LINE = /^<<<CANON>>>\s*$/m
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

export function chapterCastFor(chapter, beats) {
  return uniqueStrings([...chapterCastNames(chapter), ...beatsCastNames(beats)])
}

const CAST_CAPS = { core: 180, major: 100, minor: 60, missing: 24 }

// 已落盘的旧 cast 沿用完整卡。新档案由 characters stage 推断并写入 tier。
export function castTier(person) {
  const tier = text(person?.tier).toLowerCase()
  return ['core', 'major', 'minor'].includes(tier) ? tier : 'core'
}

function namedCard(people, name) {
  const exact = people.find((person) => text(person.name) === name)
  if (exact) return exact
  const matches = people.filter((person) => namesOf(person.aliases).includes(name))
  return matches.length === 1 ? matches[0] : null
}

/** 按本章点名顺序匹配，低层先让出预算。 */
export function castBriefFor(characters, names, maxChars = 1500) {
  const people = castList(characters)
  const candidates = volumeCharacters(characters?.volume?.newCharacters)
  const rows = namesOf(names).map((name) => {
    const person = namedCard(people, name)
    const candidate = candidates.find((card) => card.name === name)
    if (candidate && !person) {
      const head = `- ${name}（C3·本卷新增）`.slice(0, CAST_CAPS.major)
      const detail = [candidate.want && `想要${candidate.want}`, candidate.pressure && `压着${candidate.pressure}`].filter(Boolean)
      return { tier: 'major', head, line: (detail.length ? `${head}：${detail.join('；')}` : head).slice(0, CAST_CAPS.major) }
    }
    if (!person) {
      const hint = '（档案缺档：只写动作和功能，不要给他编人生史）'
      const line = `- ${name}${hint.slice(0, CAST_CAPS.missing)}`
      return { tier: 'missing', head: line, line }
    }
    const tier = castTier(person)
    const head = `- ${uniqueStrings([name, person.gender, person.role]).join(' · ')}`
    const aliases = namesOf([person.name, ...namesOf(person.aliases)]).filter((alias) => alias !== name)
    const detail = uniqueStrings([
      aliases.length ? `别名：${aliases.join('、')}` : '',
      person.recognitionTag ? `标签：${text(person.recognitionTag)}` : '',
      person.want ? `想要：${text(person.want)}` : '',
      tier !== 'minor' && person.pressure ? `压力：${text(person.pressure)}` : '',
      tier === 'core' && person.fear ? `害怕：${text(person.fear)}` : '',
      tier === 'core' && person.secret ? `秘密：${text(person.secret)}` : '',
      tier === 'core' && person.voice ? `口吻：${text(person.voice)}` : '',
    ]).join('；')
    const limit = CAST_CAPS[tier]
    return { tier, head: head.slice(0, limit), line: (detail ? `${head}｜${detail}` : head).slice(0, limit) }
  })
  const tiers = Object.keys(CAST_CAPS)
  rows.sort((left, right) => tiers.indexOf(left.tier) - tiers.indexOf(right.tier))
  const render = () => rows.map(({ line }) => line).join('\n')
  let output = render()
  for (const tier of ['minor', 'major']) {
    for (const row of rows.slice().reverse()) {
      if (output.length <= maxChars) return output
      if (row.tier !== tier) continue
      const length = Math.max(row.head.length, row.line.length - (output.length - maxChars))
      row.line = row.line.slice(0, length)
      output = render()
    }
  }
  // 极端预算只保留能容纳的完整行，避免半张核心卡或半句缺档指令。
  while (output.length > maxChars && rows.length) {
    rows.pop()
    output = render()
  }
  return output
}

export function chapterCastBrief({ characters, chapter, volume, beats, canon, maxChars = 1500 }) {
  const names = chapterCastFor(chapter, beats)
  const people = castList(characters)
  const at = chapterNumber(chapter?.id)
  const cards = [...people]
  const candidateNames = new Set(volumeCharacters(volume?.newCharacters).map(({ name }) => name))
  const hints = new Map()
  for (const name of names) {
    const found = entityOf(canon, name)
    if (found?.entity.kind !== 'character') continue
    const { entity } = found
    const prior = (Array.isArray(entity.appearances) ? entity.appearances : [])
      .map(chapterNumber).filter((number) => number >= 0 && number < at)
    const last = prior.length ? Math.max(...prior) : -1
    const first = chapterNumber(entity.firstSeen)
    if (!namedCard(people, name) && !candidateNames.has(name) && (last >= 0 || (first >= 0 && first < at))) {
      cards.push({ name, role: entity.role, tier: 'minor', aliases: entity.aliases, recognitionTag: entity.recognitionTag })
    }
    if (last >= 0 && at - last >= 6 && !hints.has(found.name)) {
      const tag = namedCard(people, name)?.recognitionTag || entity.recognitionTag
      hints.set(found.name, `再登场提示：${name} 已 ${at - last} 章未出场——第一次入场给一句读者能认回来的旧标签（${tag || 'recognitionTag/旧事'}），不要重新自我介绍`)
    }
  }
  const reminders = []
  let remaining = maxChars
  for (const hint of hints.values()) {
    if (hint.length + 1 > remaining) break
    reminders.push(hint)
    remaining -= hint.length + 1
  }
  return [castBriefFor({ cast: cards, volume }, names, remaining), ...reminders].filter(Boolean).join('\n')
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

/** 世界设定：bible 前 600 字；新模板把「核心设定与约束」放在第二段。 */
function worldBriefOf(read) {
  const bible = readText(read, 'bible')
  if (!bible) return ''
  return clip(bible, 600)
}

function clipAtSentence(value, maxChars, marker) {
  if (value.length <= maxChars) return value
  const head = value.slice(0, maxChars - marker.length)
  const end = Math.max(...['。', '！', '？', '；'].map((mark) => head.lastIndexOf(mark)))
  return `${end >= 0 ? head.slice(0, end + 1) : head}${marker}`
}

/** draft 和 revise 从同一组工件生成类型锚。 */
export function genreTextOf(params, read) {
  const genre = text(params?.genre) || '通用'
  const finger = readJson(read, 'pitch')?.goldenFinger
  const core = [text(finger?.name), text(finger?.rule)].filter(Boolean).join('：')
    || text(readJson(read, 'brief')?.logline)
  return [
    `类型：${genre}`,
    `类型承诺：${genrePromise(genre)}`,
    `核心设定：${clipAtSentence(core, 60, '…')}`,
    '硬要求：每章至少一次让核心设定以代价或后果的形式显形；不得用程序、手续、编号等周边细节替代它。',
  ].join('\n')
}

/** 商业定位：只把会影响单章写法的字段压成一行清单，不进 JSON 原文。 */
// Cap 包含材料包标题，先让出标题空间，使句末与标记不会再被分片 cap 二次裁剪。
function pitchTextOf(read) {
  const maxChars = sliceBodyCap(sliceOf('pitch'))
  const pitch = readJson(read, 'pitch')
  if (!pitch || typeof pitch !== 'object') return ''
  const lines = []
  const add = (label, value) => {
    const body = text(value)
    if (body) lines.push(`${label}：${body}`)
  }
  add('频道', pitch.channel)
  add('平台', pitch.platform)
  add('标签', Array.isArray(pitch.tags) ? pitch.tags.join('、') : pitch.tags)
  add('卖点', pitch.sellingPoint)
  add('开篇问题', pitch.opening?.chapterOneQuestion ?? pitch.hookLine)
  add('目标读者', pitch.targetReader)
  add('类型承诺', pitch.promise)
  const finger = pitch.goldenFinger
  if (finger && typeof finger === 'object' && (finger.name || finger.rule)) {
    const parts = [finger.name, finger.rule, finger.cost].map((item) => text(item)).filter(Boolean)
    if (parts.length) lines.push(`金手指：${parts.join(' · ')}`)
  }
  return clipAtSentence(lines.join('\n'), maxChars, '…（已截断）')
}

/** 黄金三章：本章在 1–3 章内时，把该章的钩子与信息差单独交给细纲。 */
function openerChapterOf(read, chapter) {
  const opener = readJson(read, 'opener')
  if (!opener || !Array.isArray(opener.chapters)) return null
  const no = Math.floor(Number(chapter?.index))
  if (!Number.isFinite(no) || no < 1 || no > 3) return null
  return opener.chapters.find((row) => Math.floor(Number(row?.index)) === no) ?? null
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
    const body = draft.replace(/^##[^\r\n]*(?:\r?\n|$)/, '')
    if (!body) continue
    samples.push(`${clip(body.slice(0, 160), 160)}\n……\n${clip(body.slice(-160), 160)}`)
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
    const summaryMatch = SUMMARY_LINE.exec(raw)
    const canonMatch = CANON_LINE.exec(raw)
    const summaryAt = summaryMatch ? summaryMatch.index : -1
    const canonAt = canonMatch ? canonMatch.index : -1
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
  const canonFindings = canonProblems(
    canon,
    Number.isFinite(chapter?.index) ? { atChapter: chapter.index, chapterOnly: true } : {},
  ) ?? []

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
    verdict: draftVerdict(findings),
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
  const brief = castBriefFor(characters, namesOf(castList(characters)), 900)
  if (brief) lines.push(`【人物档案】\n${brief}`)
  const previous = text(ctx?.previousDigest)
  if (previous) lines.push(`【前情提要】\n${clip(previous, 900)}`)
  if (ctx?.existingTitles) lines.push(`【已用章节标题（避免重复）】${clip(ctx.existingTitles, 500)}`)
  if (ctx?.threads) lines.push(`【未回收线索（threadDue 只能引用这里）】\n${clip(ctx.threads, 600)}`)

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

/** 未回收线索清单：卷纲要求 threadDue 只能引用这里的文本（otherwise 只能 warn）。 */
function openThreadsForVolume(read, maxChars = 600) {
  const canon = readJson(read, 'canon')
  const threads = Array.isArray(canon?.threads) ? canon.threads : []
  const lines = []
  for (const thread of threads) {
    if (!thread || typeof thread !== 'object') continue
    if (String(thread.status ?? '') === 'closed') continue
    const id = text(thread.id)
    const due = Math.floor(Number(thread.dueIn))
    const dueTag = Number.isFinite(due) && due > 0 ? ` due:ch${String(due).padStart(4, '0')}` : ''
    const body = text(thread.text)
    if (!body) continue
    lines.push(`- ${id}${dueTag} ${body}`)
  }
  return clip(lines.join('\n'), maxChars)
}

const DUE_THREAD_HINT = '以上线索已到期，本章必须回应或显式延后'

/** 已到期（dueIn <= 本章号）且未关闭的线索：独立成片，先于正典进入材料包。 */
export function dueThreadsText(canon, chapter, maxChars = DUE_THREADS_SPEC.cap) {
  const at = Math.floor(Number(chapter?.index))
  if (!Number.isFinite(at) || at < 1) return ''
  const lines = []
  for (const thread of Array.isArray(canon?.threads) ? canon.threads : []) {
    if (!thread || typeof thread !== 'object') continue
    if (String(thread.status ?? '').trim() === 'closed' || thread.closedIn) continue
    const due = Math.floor(Number(thread.dueIn))
    if (!Number.isFinite(due) || due > at) continue
    const body = text(thread.text)
    if (!body) continue
    lines.push(`- ${body}（到期：第 ${due} 章）`)
  }
  if (!lines.length) return ''
  // 提示行必须活着：先给提示留位置，再截线索清单。
  // maxChars 是 packet 的整片 cap，而 cap 计在渲染后的整块上（含 `## 到期待收线索\n`
  // 这 10 个字符），所以这里还要把标题开销让出来——否则清单填满 600 时，末尾的
  // 提示语会被 packet 切掉半句。
  const overhead = `## ${DUE_THREADS_SPEC.title}\n`.length
  const room = Math.max(0, maxChars - overhead - DUE_THREAD_HINT.length - 1)
  return `${clip(lines.join('\n'), room)}\n${DUE_THREAD_HINT}`
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
    threads: openThreadsForVolume(read),
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
      hookType: text(row.hookType),
      hookStrength: row.hookStrength,
      payoff: row.payoff,
      infoDrop: row.infoDrop,
      track: text(row.track),
      unitArc: text(row.unitArc),
      threadDue: Array.isArray(row.threadDue) ? row.threadDue : [],
    })
  }
  return out
}

/** 只取章表数组开头连续闭合的对象，不补括号，不把嵌套对象当成章。 */
function closedChapterRows(value) {
  const source = String(value ?? '').trimStart().replace(/^```(?:json)?\s*/i, '')
  const chapters = /"chapters"\s*:/.exec(source)
  const arrayStart = source.startsWith('[') ? 0 : source.indexOf('[', chapters ? chapters.index + chapters[0].length : 0)
  if (arrayStart < 0) return []
  const rows = []
  let cursor = arrayStart + 1
  while (/\s/.test(source.charAt(cursor))) cursor += 1
  while (source[cursor] === '{') {
    const start = cursor++
    const closers = ['}']
    let quoted = false
    let escaped = false
    for (; cursor < source.length && closers.length; cursor += 1) {
      const ch = source[cursor]
      if (quoted) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') quoted = false
      } else if (ch === '"') quoted = true
      else if (ch === '{') closers.push('}')
      else if (ch === '[') closers.push(']')
      else if ((ch === '}' || ch === ']') && closers.pop() !== ch) return rows
    }
    if (closers.length) break
    try {
      rows.push(JSON.parse(source.slice(start, cursor)))
    } catch {
      break
    }
    const comma = /^\s*,\s*/.exec(source.slice(cursor))
    if (!comma) break
    cursor += comma[0].length
  }
  return rows
}

const VOLUME_BATCH_SIZE = 12

/** 卷纲新人物是软字段。坏条目不影响章表，重名保留首次给出的简卡。 */
function volumeCharacters(value) {
  const cards = new Map()
  const label = (input) => typeof input === 'string' ? input.trim() : ''
  for (const item of Array.isArray(value) ? value : []) {
    const name = label(item?.name)
    if (!name || cards.has(name)) continue
    cards.set(name, { name, role: label(item.role), want: label(item.want), pressure: label(item.pressure) })
  }
  return [...cards.values()]
}

/**
 * 展开下一卷卷纲（§3/§6）。只处理 planned:false 的卷；同卷重复调用不会重复请求模型。
 * @returns {{outline:object, calls:number, created:boolean}}
 */
export async function ensureVolume({ outline, params = {}, read, llm, language }, ...rest) {
  const options = rest[0] ?? {}
  const current = outlineV2(outline, params)
  // options.volume 可以点名展开某一卷（novel_context 直接取第 250 章时只展开 v09，
  // 不把前面的卷一起拉进来）。点名卷已计划/不存在时返回 created:false，不退回顺序展开。
  const requested = options?.volume !== undefined ? options.volume : null
  let target = null
  if (requested !== null) {
    const wanted = String(requested)
    const matched = (current.volumes ?? []).find(
      (volume) => volume && (volume.id === wanted || String(volume.index) === wanted),
    )
    if (!matched || matched.planned || !(Number(matched.targetChapters) > 0)) {
      return { outline: current, calls: 0, created: false }
    }
    target = matched
  } else {
    target = unplannedVolume(current)
  }
  if (!target) return { outline: current, calls: 0, created: false }
  if (!llm || typeof llm.generate !== 'function') {
    throw new ForgeError('BAD_RECIPE', 'ensureVolume 需要注入 llm.generate')
  }

  const builders = resolvePrompts(options)
  const builder = typeof builders.volumeChapters === 'function'
    ? builders.volumeChapters
    : fallbackVolumePrompt
  const lang = language || params.language || current.language || 'zh'
  const ctx = volumePromptContext({ outline: current, params, read, volume: target, language: lang })
  const first = ctx.volume.startChapter
  const total = Math.floor(Number(target.targetChapters))
  const normalized = []
  let calls = 0
  let newCharacters = volumeCharacters(target.newCharacters)
  let continuing = false

  while (normalized.length < total) {
    const start = first + normalized.length
    const batch = Math.floor(normalized.length / VOLUME_BATCH_SIZE) + 1
    const end = first + Math.min(total, batch * VOLUME_BATCH_SIZE) - 1
    const count = end - start + 1
    const previous = normalized.at(-1)
    const batchCtx = {
      ...ctx,
      volume: { ...ctx.volume, startChapter: start, targetChapters: count, newCharacters },
      fullVolume: ctx.volume,
      existingTitles: [clip(normalized.map((row) => row.title).filter(Boolean).join('、'), 600), ctx.existingTitles]
        .filter(Boolean).join('、'),
    }
    let spec
    try {
      spec = await builder(batchCtx)
    } catch (error) {
      throw new ForgeError(
        'BAD_RECIPE',
        `卷纲 prompt 构造失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!spec || typeof spec !== 'object' || !spec.user) {
      throw new ForgeError('BAD_RECIPE', '卷纲 prompt 必须返回 {system,user}')
    }

    const registered = newCharacters.length ? `\n本卷已经登记的 C3 人物：${newCharacters.map(({ name }) => name).join('、')}。可沿用名字，无须重复登记。` : ''
    const request = `【本批章号】第 ${start}–${end} 章，只返回这 ${count} 章。${registered}`
    const resume = continuing ? `\n从第 ${start} 章继续，不要重复已有章。` : ''
    const bridge = previous ? `\n上一章《${previous.title}》的章末钩子：${clip(previous.hook, 300)}` : ''
    calls += 1
    let result
    try {
      result = await llm.generate({
        system: String(spec.system ?? ''),
        user: `${spec.user}\n\n${request}${resume}${bridge}`,
        maxTokens: Number.isFinite(spec.maxTokens) ? Math.round(spec.maxTokens) : DEFAULT_PROMPT_MAX_TOKENS,
        temperature: Number.isFinite(spec.temperature) ? spec.temperature : 0.7,
        json: true,
        phase: 'volumeChapters',
      })
    } catch (error) {
      if (error?.code !== 'LLM_TRUNCATED') throw error
      const accepted = []
      for (const row of closedChapterRows(error.detail?.text).slice(0, count)) {
        const [chapter] = normalizeVolumeRows([row], target)
        if (!chapter) break
        accepted.push(chapter)
      }
      if (!accepted.length) {
        throw new ForgeError(
          'LLM_TRUNCATED',
          `第 ${target.id} 卷（${first}–${first + total - 1} 章）第 ${batch} 批（${start}–${end} 章）：${error.message}`,
          error.detail,
        )
      }
      normalized.push(...accepted)
      continuing = accepted.length < count
      continue
    }
    continuing = false

    const payload = payloadOf(result)
    const rows = Array.isArray(payload) ? payload : payload?.chapters
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForgeError('LLM_PARSE', `第 ${target.id} 卷卷纲：模型没有返回章节数组`, {
        text: clip(llmText(result), 800),
      })
    }
    const accepted = normalizeVolumeRows(rows, target).slice(0, count)
    if (!accepted.length) {
      throw new ForgeError('LLM_PARSE', `第 ${target.id} 卷卷纲：章节都没有标题或目标`, {
        text: clip(llmText(result), 800),
      })
    }
    normalized.push(...accepted)
    newCharacters = volumeCharacters([...newCharacters, ...volumeCharacters(payload?.newCharacters)])
  }

  const next = mergeVolumeChapters(current, target.id, normalized)
  next.volumes = next.volumes.map((volume) => volume.id === target.id ? { ...volume, newCharacters } : volume)
  const expanded = volumeById(next, target.id)
  if (!expanded || !expanded.planned) {
    throw new ForgeError('LLM_PARSE', `第 ${target.id} 卷卷纲合并后为空`)
  }
  return { outline: next, calls, created: true }
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
    castBrief: chapterCastBrief({ characters, chapter, volume, canon }),
    openerChapter: openerChapterOf(read, chapter),
    language,
    ...promptIO(read),
  }
}

/** 追加 JSON 补救指令，并把重试预算限制在网关上限内。 */
export async function retryCutJson(ask, maxTokens, text, originalError) {
  const raw = String(text ?? '')
  const tail = raw.replace(/\s+/g, ' ').trim().slice(-120)
  const extra = [
    `【上一次输出没能解析成 JSON（${raw.length} 字，结尾是「${tail}」），像是写到一半就断了】`,
    '这次务必先保证 JSON 完整闭合：',
    '- 只输出一个 JSON 对象，前后不要任何说明，不要 markdown 围栏；',
    '- 条目数与字段长度宁可取小值，也要让每个括号先配对完；',
    '- 写到最后一个字段就立刻收尾，不要补充解释。',
  ].join('\n')
  const budget = Math.min(16000, Math.max(Math.ceil(maxTokens * 1.6), originalError?.detail?.maxTokens ?? 0))
  try {
    return await ask({ extra, maxTokens: budget })
  } catch (error) {
    if (originalError && error?.code === 'LLM_TRUNCATED') throw originalError
    throw error
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
    const request = {
      system: String(spec.system ?? ''),
      user: String(spec.user ?? ''),
      maxTokens: Number.isFinite(spec.maxTokens) ? Math.round(spec.maxTokens) : DEFAULT_PROMPT_MAX_TOKENS,
      temperature: Number.isFinite(spec.temperature) ? spec.temperature : 0.8,
      json: true,
      phase: 'beats',
    }
    calls += 1
    let result
    try {
      result = await llm.generate(request)
    } catch (error) {
      if (error?.code !== 'LLM_TRUNCATED') throw error
      calls += 1
      result = await retryCutJson(
        // 截断的一枪多半是「思考 + JSON」一起吃预算：补枪关思考，把预算还给 JSON 本身。
        ({ extra, maxTokens }) => llm.generate({
          ...request,
          user: `${request.user}\n\n${extra}`,
          maxTokens,
          reasoningEffort: 'off',
        }),
        request.maxTokens,
        error.detail?.text,
        error,
      )
    }
    beats = normalizeBeats(payloadOf(result), chapter)
  }

  const canon = loadCanon(read)
  const names = chapterCastFor(chapter, beats)
  const canonText = formatCanon(
    queryCanon(canon, {
      cast: names,
      keywords: uniqueStrings([chapter.goal, chapter.conflict]),
      location: chapter.where,
      atChapter: chapter.index,
      limit: 120,
    }),
    { maxChars: sliceBodyCap(sliceOf('canon')) },
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
    dueThreads: dueThreadsText(canon, chapter),
    loreText: loreTextOf(readJson(read, 'lorebook')?.entries, loreHaystack(chapter, beats)),
    materialsText: materialsTextOf(readJson(read, 'materials')?.entries),
    castBrief: chapterCastBrief({ characters, chapter, volume, beats, canon, maxChars: sliceBodyCap(sliceOf('cast')) }),
    worldBrief: worldBriefOf(read),
    genreText: genreTextOf(params, read),
    pitchText: pitchTextOf(read),
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
  return Object.keys(patch).length ? { ...patch } : null
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
  // 本次出场只能由正文核验，状态补丁其余字段仍照常合并。
  for (const field of ['entities', 'characters']) {
    if (!patch?.[field] || typeof patch[field] !== 'object' || Array.isArray(patch[field])) continue
    patch[field] = Object.fromEntries(Object.entries(patch[field]).map(([name, state]) => {
      if (!state || typeof state !== 'object' || Array.isArray(state)) return [name, state]
      const { firstSeen, lastSeen, chapter, ...rest } = state
      return [name, rest]
    }))
  }
  let merged = patch ? mergeCanon(canon, patch, { chapter: chapterId }) : canon
  const beats = readJson(read, `beats/${chapterId}`)
  const characters = charactersOf(read)
  const names = chapterCastFor(chapter, beats)
  const verified = new Set()
  for (const name of names) {
    const found = entityOf(merged, name)
    if (found && found.entity.kind !== 'character') continue
    const card = namedCard(castList(characters), name)
    const spellings = namesOf([name, found?.name, ...namesOf(found?.entity.aliases), card?.name, ...namesOf(card?.aliases)])
    if (spellings.some((spelling) => split.body.includes(spelling))) verified.add(found?.name ?? card?.name ?? name)
  }
  merged = recordAppearances(merged, [...verified], chapterId)

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

  const cast = names.length ? names : null
  const checked = runChecks({
    text: split.body,
    canon: merged,
    chapter,
    previousChapter: previous,
    params,
    beats,
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
    // craft 的量化读数（句长/感官/情绪/AI 标记…）：review 提示词要用它先看数字。
    stats: checked.stats,
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
