// novel recipe — 小说 recipe 定义（v0.2 agent-first）。
// 契约：docs/architecture-v2.md §2（卷章分层）、§3（9 段阶段表）、§4（正典）、§6（chapter.js）、§12（提示词）。
// 本文件只做编排：拼 prompt 输入 → 调 ctx.llm.generate → 校验/规范化 → 返回 artifacts。
// 每章的工作量是固定的：细纲 1 + 草稿 1 + 摘要/正典摊 0.5 + 审校 1 + 修订摊薄 = 3.5 次调用。
import { z } from 'zod'
import { createPrompts, SUMMARY_MARKER, sexOf } from './prompts/zh.js'
import { defaultCraft, severityRank, countCjk } from './craft.js'
import { chaptersOf } from './outline.js'
import { characterBrief } from './ledger.js'
import { buildPacket } from './packet.js'
import * as plan from './plan.js'
import * as canonLib from './canon.js'
import { markdownExport, epubExport } from './export.js'

// forge/errors.js 由引擎负责；并行施工/单测先行时用兼容兜底（形状一致，engine 只看 code）。
async function loadForgeError() {
  try {
    const mod = await import('../../forge/errors.js')
    if (typeof mod?.ForgeError === 'function') return mod.ForgeError
    if (typeof mod?.default === 'function') return mod.default
  } catch {
    // 引擎尚未落盘
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

// chapter.js 归 L5 并行施工：还没落盘时整个 recipe 仍要能被 import / validate；
// 执行到章节工作单元时再由 requireChapter() 抛可读的 BAD_RECIPE。
let chapterUnit = null
let chapterUnitError = null
try {
  chapterUnit = await import('./chapter.js')
} catch (err) {
  chapterUnitError = err
}

// ---------------------------------------------------------------- params

const GENRES = ['悬疑', '奇幻', '科幻', '都市', '历史', '言情', '恐怖', '武侠', '通用']
const AUDIENCES = ['成年', '青少年', '泛读者']
const POVS = ['第一人称', '第三人称限知', '第三人称全知']

export const paramsDefaults = {
  title: '',
  genre: '悬疑',
  audience: '成年',
  language: 'zh',
  chapters: 24,
  wordsPerChapter: 3000,
  chaptersPerVolume: 30,
  contextBudget: 12000,
  pov: '第三人称限知',
  tone: '',
  styleGuide: '',
  autoReview: true,
  reviewGate: false,
  seed: '',
  protagonistGender: 'auto',
}

const paramsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['premise'],
  properties: {
    premise: { type: 'string', minLength: 8, maxLength: 2000, description: '一句话故事核' },
    title: { type: 'string', maxLength: 80, description: '书名，空则由 premise 起名' },
    genre: { type: 'string', enum: GENRES },
    audience: { type: 'string', enum: AUDIENCES },
    language: { type: 'string', enum: ['zh', 'en'] },
    chapters: { type: 'integer', minimum: 6, maximum: 3000, description: '总章数；长书按卷惰性展开' },
    wordsPerChapter: { type: 'integer', minimum: 800, maximum: 8000 },
    chaptersPerVolume: {
      type: 'integer',
      minimum: 10,
      maximum: 60,
      description: '每卷章数；chapters/chaptersPerVolume 超过 40 卷时自动抬升以保证卷数 ≤40',
    },
    contextBudget: {
      type: 'integer',
      minimum: 4000,
      maximum: 30000,
      description: '写一章的提示词预算（字符）。第 N 章的写作材料和第 1 章一样大，不随章号增长',
    },
    pov: { type: 'string', enum: POVS },
    tone: { type: 'string', maxLength: 200 },
    styleGuide: { type: 'string', maxLength: 4000 },
    autoReview: { type: 'boolean' },
    reviewGate: { type: 'boolean' },
    seed: { type: 'string', maxLength: 500 },
    protagonistGender: {
      type: 'string',
      enum: ['auto', '男', '女'],
      description: '主角性别：auto 交给模型定；男/女 则写死并在全书统一代词',
    },
  },
}

// ---------------------------------------------------------------- 输出 schema（§4.4）

// 注意：模型少写一个字段，不该让整段已经付过费的调用作废。
// 只把「有它才有意义」的字段设成必填（logline/name/issue），其余 `.catch('')` 降级成空串，
// 下游 prompt 对空值都有兜底文案。
const soft = z.string().catch('')
const softList = z.array(z.string()).catch([])

const briefSchema = z.object({
  title: soft,
  logline: z.string().min(1),
  theme: soft,
  promise: soft,
  ending: soft,
  genreTags: softList,
})

const relationSchema = z.object({ to: soft, kind: soft })

const castSchema = z.object({
  name: z.string().min(1),
  role: soft,
  // 性别决定后文用「他」还是「她」。软字段：模型漏写不让整份档案作废，
  // 但 characters 阶段会记一条 warn，提示后文可能混用代词。
  gender: soft,
  want: soft,
  fear: soft,
  secret: soft,
  voice: soft,
  arc: soft,
  relations: z.array(relationSchema).catch([]),
})

const charactersSchema = z.object({ cast: z.array(castSchema).min(1) })

const sceneSchema = z.object({
  no: z.union([z.number(), z.string()]).catch(1),
  where: soft,
  when: soft,
  cast: softList,
  goal: soft,
  obstacle: soft,
  turn: soft,
  exit: soft,
  sensory: soft,
})

const beatsSchema = z.object({
  chapterId: z.string().optional(),
  title: soft,
  scenes: z.array(sceneSchema).min(1),
})

const findingSchema = z.object({
  severity: z.enum(['block', 'warn', 'note']),
  kind: z.string(),
  where: z.string(),
  issue: z.string().min(1),
  fix: z.string(),
})

const factPatchSchema = z.union([
  z.string(),
  z.object({ text: z.string().min(1), chapter: z.string().optional(), status: z.string().optional() }),
])

const threadPatchSchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    text: z.string().min(1),
    status: z.string().optional(),
    opened: z.string().optional(),
    closedIn: z.string().optional(),
  }),
])

const timelinePatchSchema = z.union([
  z.string(),
  z.object({ chapter: z.string().optional(), when: z.string().optional(), event: z.string().min(1) }),
])

const ledgerPatchSchema = z.object({
  facts: z.array(factPatchSchema).optional(),
  threads: z.array(threadPatchSchema).optional(),
  characters: z
    .record(
      z.string(),
      z.object({
        // role 必须声明：zod 默认剥掉未声明字段，主角保护（ledger.limitCharacters）靠它。
        role: z.string().optional(),
        location: z.string().optional(),
        state: z.string().optional(),
        knows: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  timeline: z.array(timelinePatchSchema).optional(),
  canonRules: z.array(z.string()).optional(),
})

// §4.4：正典补丁形状宽松收（facts/notes/threads/entities/timeline/invariants 都交给 mergeCanon），
// 模型多写字段不该让整章补丁作废。
const canonPatchSchema = z.object({}).passthrough()

// 模型少给 ledgerPatch / canonPatch / verdict 是常态，不能因此丢掉整份审校结果：
// 三者可选，verdict 缺失时由 block/warn 计数推断（见 review stage）。
const reviewSchema = z.object({
  findings: z.array(findingSchema),
  ledgerPatch: ledgerPatchSchema.nullish(),
  canonPatch: canonPatchSchema.nullish(),
  verdict: z.enum(['pass', 'revise']).optional(),
})

const blurbSchema = z.object({
  title: z.string().min(1),
  tagline: z.string(),
  blurb: z.string(),
  tags: z.array(z.string()),
})

// v2：spine 是结构化 JSON；卷数与卷计划的对齐在 alignSpine 里做（模型多给/少给都不算错）。
const spineVolumeSchema = z.object({
  title: z.string().catch(''),
  goal: z.string().catch(''),
  arc: z.string().catch(''),
  cast: z.array(z.string()).catch([]),
  opens: z.array(z.string()).catch([]),
  closes: z.array(z.string()).catch([]),
})
const spineSchema = z.object({
  mainline: z.string().min(1),
  ending: z.string().catch(''),
  volumes: z.array(spineVolumeSchema).catch([]),
})

// ---------------------------------------------------------------- helpers

function clip(value, max = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function parseError(stage, message, raw, max = 2000) {
  return new ForgeError('LLM_PARSE', `${stage}：${message}`, { raw: clip(raw, max) })
}

/** 取尾部若干字符，把「断在哪」写进错误信息——不然用户只看到「解析失败」，无从判断。 */
function tailOf(text, max = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(-max) : flat
}

/**
 * 判断输出是不是「JSON 写到一半断了」：字符串外的开括号多于闭括号。
 * 截断（撞输出上限、流被掐）是最常见的解析失败原因，单独识别出来才能对症重试。
 */
export function looksCutJson(text) {
  const raw = String(text ?? '')
  let open = 0
  let close = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') open += 1
    else if (ch === '}' || ch === ']') close += 1
  }
  return open > 0 && open > close
}

/**
 * 模型在「正文缺失」时被要求回声的占位文本（历史行为）。这种产物等于没有：
 * 它会让下游阶段以为有正文，进而把占位符当章节内容继续加工。
 */
const PLACEHOLDER_TEXT = /正文缺失|无法修订|无法摘要/

export function isPlaceholderText(text) {
  const value = String(text ?? '').trim()
  if (!value || value.length > 400) return false
  return PLACEHOLDER_TEXT.test(value)
}

/** 读正文；占位符/空串一律当成「没有正文」。 */
function draftOf(ctx, id) {
  const text = textOf(ctx, `draft/${id}`)
  return isPlaceholderText(text) ? '' : text
}

function parseFailureMessage(text, cut) {
  const chars = String(text ?? '').length
  const tail = tailOf(text)
  const why = cut ? '，写到一半就断了（像是撞到输出上限或被流中断）' : ''
  return `模型返回的不是合法 JSON（输出 ${chars} 字${why}${tail ? `，结尾是「${tail}」` : ''}）`
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

/**
 * 扫出「括号配平」的顶层片段。模型常在 JSON 前面写一段带大括号的思考，
 * 「第一个 { 到最后一个 }」会从错误的起点截取；配平扫描能跳过那段噪声。
 * 字符串里的括号与转义不参与配平。
 */
function jsonSpans(raw, limit = 12) {
  const spans = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (ch === '}' || ch === ']') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        spans.push(raw.slice(start, i + 1))
        start = -1
        if (spans.length >= limit) break
      }
      continue
    }
    if (depth === 0 && /[^\s,;]/.test(ch)) start = -1
  }
  return spans
}

/** 手写 JSON 的常见毛病：// 与块注释、字符串外的尾逗号。 */
function repairJsonText(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j += 1
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += ch
  }
  return out
}

/**
 * 抽取 JSON：整体 → 代码围栏 → 配平片段 → 修复版。
 * 一次解析失败等于把整段 prompt 的输入费扔掉，所以尽量抢救。
 */
export function extractJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return undefined
  const candidates = [raw]
  for (const fenced of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = fenced[1]?.trim()
    if (body) candidates.push(body)
  }
  candidates.push(...jsonSpans(raw))
  candidates.push(...jsonSpans(repairJsonText(raw)))
  const seen = new Set()
  for (const candidate of candidates) {
    const source = candidate.trim()
    if (!source || seen.has(source)) continue
    seen.add(source)
    try {
      return JSON.parse(source)
    } catch {
      /* next */
    }
    const repaired = repairJsonText(source)
    if (repaired !== source) {
      try {
        return JSON.parse(repaired)
      } catch {
        /* next */
      }
    }
  }
  return undefined
}

/**
 * 细纲被截断时的抢救：从 `"scenes": [ ...` 里逐个取出已经写完整的场，重新编号。
 * 只收结构完整、能过 sceneSchema 的场；一场都救不出时返回空数组，让调用方照常报错。
 */
export function salvageScenes(raw) {
  const text = String(raw ?? '')
  const at = text.search(/"scenes"\s*:\s*\[/)
  if (at < 0) return []
  const body = text.slice(text.indexOf('[', at) + 1)
  const scenes = []
  for (const span of jsonSpans(body, 24)) {
    const value = extractJson(span)
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const parsed = sceneSchema.safeParse({ ...value, no: scenes.length + 1 })
    if (parsed.success) scenes.push(parsed.data)
  }
  return scenes.map((scene, index) => ({ ...scene, no: index + 1 }))
}

function has(ctx, key) {
  try {
    return typeof ctx.has === 'function' ? Boolean(ctx.has(key)) : false
  } catch {
    return false
  }
}

function jsonOr(ctx, key, fallback = null) {
  if (!has(ctx, key)) return fallback
  try {
    return ctx.json(key) ?? fallback
  } catch {
    return fallback
  }
}

/** 给确定性检查用的最小人物表：名字 + 角色 + 性别，不含自由文本。 */
export function castForCheck(data) {
  const cast = data && Array.isArray(data.cast) ? data.cast : []
  return cast
    .filter((member) => member && member.name)
    .map((member) => ({
      name: String(member.name),
      role: String(member.role ?? ''),
      gender: String(member.gender ?? '').trim(),
    }))
}

function textOf(ctx, key) {
  try {
    return typeof ctx.text === 'function' ? String(ctx.text(key) ?? '') : ''
  } catch {
    return ''
  }
}

function fit(ctx, text, maxChars) {
  if (typeof ctx.fit === 'function') return ctx.fit(text, maxChars)
  const value = String(text ?? '')
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 6))}…（已截断）`
}

function withPromptContext(ctx, extra) {
  if (!ctx || typeof ctx !== 'object') return { ...extra }
  return Object.assign(Object.create(ctx), extra)
}

function promptSpec(ctx, promptFn, stage) {
  const spec = typeof promptFn === 'function' ? promptFn(ctx) : null
  if (!spec || typeof spec.user !== 'string' || typeof spec.system !== 'string') {
    throw new ForgeError('BAD_RECIPE', `prompts.${stage} 必须返回 { system, user }`, { stage })
  }
  const maxTokens = Number(spec.maxTokens)
  return {
    system: spec.system,
    user: spec.user,
    maxTokens: Number.isFinite(maxTokens) ? Math.min(32000, Math.max(256, Math.round(maxTokens))) : 4096,
    temperature: Number.isFinite(Number(spec.temperature)) ? Number(spec.temperature) : undefined,
  }
}

/** 截断重试时追加的说明：只要求「先把 JSON 写完整」，不改别的要求。 */
function cutRetryNote(chars, tail) {
  return [
    `【上一次输出没能解析成 JSON（${chars} 字，结尾是「${tail}」），像是写到一半就断了】`,
    '这次务必先保证 JSON 完整闭合：',
    '- 只输出一个 JSON 对象，前后不要任何说明，不要 markdown 围栏；',
    '- 条目数与字段长度宁可取小值，也要让每个括号先配对完；',
    '- 写到最后一个字段就立刻收尾，不要补充解释。',
  ].join('\n')
}

async function askJson(ctx, stage, spec, { extra, maxTokens } = {}) {
  const result = await ctx.llm.generate({
    system: spec.system,
    user: extra ? `${spec.user}\n\n${extra}` : spec.user,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : spec.maxTokens,
    temperature: spec.temperature,
    json: true,
    phase: spec.phase ?? stage,
    label: stage,
  })
  const text = String(result?.text ?? '')
  let data = result?.json
  if (data == null) data = extractJson(text)
  return { data, text }
}

async function callJson(ctx, stage, promptFn, schema, { phase, retryCut = true } = {}) {
  const spec = { ...promptSpec(ctx, promptFn, stage), phase: phase ?? stage }
  let { data, text } = await askJson(ctx, stage, spec)
  if (data === undefined && retryCut && looksCutJson(text)) {
    // 截断（撞输出上限／流被掐）几乎必然发生在 JSON 中途：抬一次预算重来，
    // 比整章失败、用户手动重跑整条流水线便宜得多。只在「像被截断」时重试，避免为脏格式双付费。
    const budget = Math.min(16000, Math.max(1200, Math.round(spec.maxTokens * 1.6)))
    ;({ data, text } = await askJson(ctx, stage, spec, {
      extra: cutRetryNote(String(text).length, tailOf(text)),
      maxTokens: budget,
    }))
  }
  if (data === undefined) {
    throw parseError(stage, parseFailureMessage(text, looksCutJson(text)), text, 12000)
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const error = parseError(stage, `JSON 字段不合契约（${formatZod(parsed.error)}）`, data)
    // detail.raw 会被 clip 截断；把原始对象挂在 detail.data 上，供降级路径抢救可用字段。
    if (error.detail && typeof error.detail === 'object') error.detail.data = data
    throw error
  }
  return parsed.data
}

async function callText(ctx, stage, promptFn, { phase, maxTokens, temperature } = {}) {
  const spec = promptSpec(ctx, promptFn, stage)
  const result = await ctx.llm.generate({
    system: spec.system,
    user: spec.user,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : spec.maxTokens,
    temperature: Number.isFinite(temperature) ? temperature : spec.temperature,
    json: false,
    phase: phase ?? stage,
    label: stage,
  })
  return String(result?.text ?? '').trim()
}

function parseBlurbMarkdown(text) {
  const source = stripFence(text)
  const pick = (re) => (source.match(re) || [])[1]?.trim() ?? ''
  const title = pick(/^#\s*《([^》]+)》/m) || pick(/^#\s*(.+)$/m)
  const tagline = pick(/一句话卖点[：:]\s*(.+)/)
  const blurb = pick(/##\s*简介\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const tagsLine = pick(/##\s*标签\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const tags = tagsLine
    .split(/[\/、,，|]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  return {
    title,
    tagline,
    blurb: blurb || (title || tagline ? '' : source),
    tags,
  }
}

function stripFence(text) {
  const source = String(text ?? '').trim()
  const fenced = source.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i)
  return (fenced ? fenced[1] : source).trim()
}

function ensureHeading(markdown, heading) {
  const text = stripFence(markdown)
  if (!text) throw new ForgeError('LLM_PARSE', `${heading} 内容为空`)
  if (/^#\s/.test(text)) return text
  return `${heading}\n\n${text}`
}

const CHINESE_NUMERALS = '[0-9０-９一二三四五六七八九十百千零两]'

function normalizeProse(raw, { no, title }) {
  let text = stripFence(raw)
  text = text.replace(/^(?:以下是|这是)[^\n]*\n+/, '').trim()
  if (!text) throw new ForgeError('LLM_PARSE', `第 ${no} 章正文为空`, { raw: clip(raw) })
  text = text.replace(/^\s*#{1,4}\s*第\s*[^\n]*章[^\n]*\n+/, '').trim()
  const normalizedTitle = String(title ?? '').trim()
  const heading = `## 第${no}章${normalizedTitle ? ` ${normalizedTitle}` : ''}`
  return `${heading}\n\n${text}`
}

// draft/revise 的同一枪里带着摘要：按标记切开。
// 只有「切出来且看起来真的是摘要」才认，否则让调用方回退到独立摘要调用——
// 省一次往返是优化，摘要正确性是前提。
function takeInlineSummary(raw) {
  const text = String(raw ?? '')
  const at = text.lastIndexOf(SUMMARY_MARKER)
  if (at < 0) return { prose: text, summary: '' }
  const tail = text.slice(at + SUMMARY_MARKER.length).trim()
  const looksRight = tail.length >= 16 && tail.length <= 2200 && /发生|知情|钩子|时空/.test(tail)
  return { prose: text.slice(0, at), summary: looksRight ? tail : '' }
}

// 摘要再失败也不能把已经付过费的正文丢掉：退回「旧摘要」或正文首段截取，
// 至少让这一章的稿子落盘、下游 prompt 有个可读的参照。
function rescueSummary(ctx, item, text, why) {
  const previous = textOf(ctx, `summary/${item.id}`)
  if (previous) return previous
  const body = String(text ?? '')
    .replace(/^#{1,6}.*$/m, '')
    .replace(/\s+/g, ' ')
    .trim()
  const head = Array.from(body).slice(0, 240).join('')
  return `自动摘要（${why}）：${head}${body.length > 240 ? '…' : ''}`
}

function normalizeSummary(raw) {
  const text = stripFence(raw).replace(/^摘要[:：]\s*/, '').trim()
  if (!text) throw new ForgeError('LLM_PARSE', '章节摘要为空')
  return text
}

function chapterNumber(ctx) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0
  return index + 1
}

function collectCastNames(beats, outlineChapter) {
  const names = []
  const push = (name) => {
    const value = String(name ?? '').trim()
    if (value && !names.includes(value)) names.push(value)
  }
  for (const name of outlineChapter?.cast ?? []) push(name)
  for (const scene of beats?.scenes ?? []) {
    for (const name of scene?.cast ?? []) push(name)
  }
  return names
}

function draftMaxTokens(params = {}) {
  const words = Number(params.wordsPerChapter) || paramsDefaults.wordsPerChapter
  return Math.min(16000, Math.max(1200, Math.round(words * 2.2)))
}

function clampInt(value, fallback, min, max) {
  const number = Number(value)
  const base = Number.isFinite(number) ? Math.round(number) : fallback
  return Math.min(max, Math.max(min, base))
}

function hasPatch(patch) {
  if (!patch || typeof patch !== 'object') return false
  return ['facts', 'notes', 'threads', 'entities', 'characters', 'timeline', 'canonRules', 'invariants'].some((key) => {
    const value = patch[key]
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object') return Object.keys(value).length > 0
    return false
  })
}

function countSeverities(findings) {
  return findings.reduce(
    (acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
      return acc
    },
    { block: 0, warn: 0, note: 0 },
  )
}

/**
 * 审校结果整份不合契约时，逐条抢救还能用的字段：
 * findings 逐项过 findingSchema，ledgerPatch 合法才收，verdict 交给 block/warn 计数推断。
 */
function salvageReview(error) {
  const raw = error?.detail?.data ?? extractJson(error?.detail?.raw)
  const findings = []
  if (raw && Array.isArray(raw.findings)) {
    for (const item of raw.findings) {
      const parsed = findingSchema.safeParse(item)
      if (parsed.success) findings.push(parsed.data)
    }
  }
  const rawPatch = raw?.canonPatch ?? raw?.ledgerPatch
  const patch = rawPatch == null ? null : canonPatchSchema.safeParse(rawPatch)
  return {
    findings,
    canonPatch: patch?.success ? patch.data : null,
    ledgerPatch: patch?.success ? patch.data : null,
    verdict: undefined,
  }
}

// ---------------------------------------------------------------- v2 章节工作单元

/**
 * chapter.js 归 L5 并行施工：文件还没落盘时整个 recipe 仍要能被 import / validate，
 * 只有真跑到章节工作单元时才抛可读的 BAD_RECIPE，而不是 import 阶段整体炸掉。
 */
function requireChapter() {
  if (chapterUnit && typeof chapterUnit.prepareChapter === 'function') return chapterUnit
  const why = chapterUnitError?.message ?? 'chapter.js 没有导出 prepareChapter'
  throw new ForgeError('BAD_RECIPE', `章节工作单元不可用：${why}`, { file: 'src/recipes/novel/chapter.js' })
}

/** chapter.js 的 read 契约：json → 对象，md → 字符串，没有 → null。 */
// 本轮窗口（§7）：缺章名单必须在 run 开头定一次，不能边写边算——
// 边写边算会让名单越来越短，每章都落在窗口第 0 位，window 等于失效。
const RUN_WINDOWS = new Map()

function outsideWindow(ctx, id, outline) {
  const size = Number(ctx.run?.options?.window) || 0
  if (size <= 0) return false
  const key = String(ctx.run?.id ?? 'run')
  let pending = RUN_WINDOWS.get(key)
  if (!pending) {
    pending = new Set(
      chaptersOf(outline)
        .filter((chapter) => chapter?.id && !has(ctx, `draft/${chapter.id}`))
        .map((chapter) => String(chapter.id)),
    )
    if (RUN_WINDOWS.size > 64) RUN_WINDOWS.clear()
    RUN_WINDOWS.set(key, pending)
  }
  const list = [...pending]
  const position = list.indexOf(String(id))
  return position >= size
}

function readerOf(ctx, overrides = {}) {
  return (key) => {
    const name = String(key)
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name]
    const artifact = typeof ctx.read === 'function' ? ctx.read(name) : null
    if (!artifact) return null
    return artifact.kind === 'json' ? artifact.content : String(artifact.content ?? '')
  }
}

/** 读 v2 outline；v1 项目先做内存迁移（是否落盘由 outline stage 决定）。 */
function currentOutline(ctx) {
  const outline = jsonOr(ctx, 'outline', null)
  if (!outline) return null
  return plan.isV2(outline) ? outline : plan.migrateOutline(outline, { params: ctx.params ?? {} })
}

function chaptersTotal(params = {}) {
  return clampInt(params.chapters, paramsDefaults.chapters, 6, 3000)
}

function perVolumeOf(params = {}) {
  return clampInt(params.chaptersPerVolume, paramsDefaults.chaptersPerVolume, 10, 60)
}

/** §2 / §3：卷计划。spine 的 prompt ctx 与落盘对齐都走这一份，保证两边卷数一致。 */
function volumePlanFor(params = {}) {
  const total = chaptersTotal(params)
  const per = plan.effectivePerVolume(total, perVolumeOf(params))
  const count = Math.max(1, plan.volumeCount(total, per))
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, offset) => ({
    index: offset + 1,
    title: `第${offset + 1}卷`,
    // 末卷吃余数：与 plan.buildOutlineSkeleton 的切分保持一致。
    targetChapters: offset === count - 1 ? total - base * (count - 1) : base,
  }))
}

/** 把模型给的 spine 强制对齐卷计划：多了裁、少了补兜底卷，卷标题永不为空。 */
function alignSpine(raw, volumePlan) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const source = Array.isArray(data.volumes) ? data.volumes : []
  const asList = (value) =>
    Array.isArray(value)
      ? value
          .map((row) => String(row ?? '').trim())
          .filter(Boolean)
      : []
  const volumes = volumePlan.map((slot, offset) => {
    const entry = source[offset] && typeof source[offset] === 'object' ? source[offset] : {}
    return {
      id: plan.volumeId(slot.index),
      index: slot.index,
      title: String(entry.title ?? '').trim() || slot.title,
      goal: String(entry.goal ?? '').trim(),
      arc: String(entry.arc ?? '').trim(),
      cast: asList(entry.cast),
      opens: asList(entry.opens),
      closes: asList(entry.closes),
      targetChapters: slot.targetChapters,
    }
  })
  const notes = []
  if (source.length > volumes.length) notes.push(`模型多给 ${source.length - volumes.length} 卷，已按卷计划裁掉`)
  if (source.length < volumes.length) notes.push(`模型少给 ${volumes.length - source.length} 卷，已用兜底卷补足`)
  return {
    spine: {
      version: 2,
      mainline: String(data.mainline ?? '').trim(),
      ending: String(data.ending ?? '').trim(),
      volumes,
    },
    notes,
  }
}

/**
 * canon 种子（§4.3）：v2 canon 直接用；旧形状合并；只有 ledger 的 v1 项目迁移，且不删 ledger。
 * 幂等：重复调用不会改变已有 v2 canon。
 */
function seedCanon(ctx, spine) {
  const existing = jsonOr(ctx, 'canon', null)
  if (existing && typeof existing === 'object' && Number(existing.version) === canonLib.CANON_VERSION) {
    return { canon: existing, source: 'canon', changed: false }
  }
  if (existing && typeof existing === 'object') {
    return { canon: canonLib.mergeCanon(canonLib.emptyCanon(), existing, {}), source: 'canon', changed: true }
  }
  const ledger = jsonOr(ctx, 'ledger', null)
  if (ledger && typeof ledger === 'object') {
    return {
      canon: canonLib.migrateLedger(ledger, { characters: jsonOr(ctx, 'characters', null) }),
      source: 'ledger',
      changed: true,
    }
  }
  return {
    canon: canonLib.createCanon({
      brief: jsonOr(ctx, 'brief', {}),
      characters: jsonOr(ctx, 'characters', null),
      params: ctx.params ?? {},
      spine: spine ?? {},
    }),
    source: 'new',
    changed: true,
  }
}

/** 正典提示词片段：按本章出场人物 + 章号裁剪，永不超预算。 */
function canonTextFor(canon, names, chapterId, maxChars = 3200) {
  try {
    const slice = canonLib.queryCanon(canon, { cast: names, atChapter: chapterId, limit: 80 })
    return canonLib.formatCanon(slice, { maxChars })
  } catch {
    return ''
  }
}

function siblingChapter(outline, chapterId, offset) {
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  const index = chapters.findIndex((chapter) => chapter?.id === chapterId)
  if (index < 0) return null
  return chapters[index + offset] ?? null
}

function chapterNoOf(ctx, chapter) {
  const match = String(chapter?.id ?? '').match(/^ch0*(\d+)$/i)
  if (match) {
    const no = Number(match[1])
    if (Number.isInteger(no) && no > 0) return no
  }
  return chapterNumber(ctx)
}

function castNamesFor(beats, chapter, volume) {
  const names = collectCastNames(beats, chapter)
  for (const name of volume?.cast ?? []) {
    const value = String(name ?? '').trim()
    if (value && !names.includes(value)) names.push(value)
  }
  return names
}

function recentSummaries(outline, ctx, chapterId) {
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  const index = chapters.findIndex((chapter) => chapter?.id === chapterId)
  const start = Math.max(0, index - 3)
  return chapters
    .slice(start, Math.max(0, index))
    .map((chapter) => ({ id: chapter.id, text: textOf(ctx, `summary/${chapter.id}`) }))
    .filter((row) => row.text)
}

function volumeDigest(outline, ctx, chapterId) {
  const volume = plan.volumeOfChapter(outline, chapterId)
  if (!volume) return ''
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  const index = chapters.findIndex((chapter) => chapter?.id === chapterId)
  const lines = []
  for (const chapter of chapters.slice(0, Math.max(0, index))) {
    if (chapter?.volume !== volume.id) continue
    const summary = textOf(ctx, `summary/${chapter.id}`)
    if (summary) lines.push(`- ${chapter.id}：${summary}`)
  }
  return fit(ctx, lines.join('\n'), 1000)
}

function findingLine(finding) {
  const where = String(finding?.where ?? '').trim()
  const issue = String(finding?.issue ?? '').trim()
  const fix = String(finding?.fix ?? '').trim()
  return `${finding?.severity ?? 'warn'}${where ? `｜${where}` : ''}：${issue}${fix ? ` → ${fix}` : ''}`
}

function normalizeFinding(raw) {
  const severity = ['block', 'warn', 'note'].includes(raw?.severity) ? raw.severity : 'warn'
  return {
    severity,
    kind: String(raw?.kind ?? 'logic'),
    where: String(raw?.where ?? ''),
    issue: String(raw?.issue ?? '').trim() || '审校给出了一条没有描述的问题',
    fix: String(raw?.fix ?? ''),
  }
}

/**
 * 兜底拼包：prepareChapter 没给 packet 时用；revise 永远自己拼（mode:'revise'）。
 * 返回 buildPacket 的 {text,report,sections}，text 就是 draft/revise 的 user。
 */
function assemblePacket(ctx, { chapter, volume, beats, canon, mode = 'draft', revisionFindings = [] }) {
  const params = ctx.params ?? {}
  const outline = currentOutline(ctx) ?? { chapters: [] }
  const id = String(chapter?.id ?? '')
  const previous = siblingChapter(outline, id, -1)
  const next = siblingChapter(outline, id, 1)
  const names = castNamesFor(beats, chapter, volume)
  return buildPacket({
    params,
    chapter,
    volume: volume ?? null,
    beats,
    previous,
    previousSummary: previous ? textOf(ctx, `summary/${previous.id}`) : '',
    recentSummaries: recentSummaries(outline, ctx, id),
    volumeDigest: volumeDigest(outline, ctx, id),
    canonText: canonTextFor(canon, names, id),
    castBrief: characterBrief(jsonOr(ctx, 'characters', {})?.cast ?? [], names, 1500),
    styleSample: fit(ctx, params.styleGuide ?? '', 1200),
    nextChapterGoal: next ? `下一章目标：${next.goal ?? ''}（本章不要提前解决）` : '',
    revisionFindings,
    mode,
  })
}

/** 审查/修订共用：关闭自动审校时跳过，返回值就是事件流里的跳过原因。 */
function skipAutoReview(project) {
  return project?.params?.autoReview === false ? '未开启自动审校' : false
}

// ---------------------------------------------------------------- recipe

/**
 * @param {{prompts?: object, craft?: {checkDraft: Function}}} deps
 */
export function createNovelRecipe({ prompts = createPrompts(), craft = defaultCraft } = {}) {
  const stages = [
    {
      id: 'premise',
      title: '故事核心',
      produces: ['brief'],
      review: false,
      async run(ctx) {
        const data = await callJson(ctx, 'premise', prompts.premise, briefSchema)
        const title = String(ctx.params?.title ?? '').trim() || String(data.title ?? '').trim() || '未命名'
        const brief = { ...data, title }
        return {
          artifacts: { brief: { kind: 'json', content: brief } },
          note: `故事核心：${brief.logline}`,
        }
      },
    },
    {
      id: 'bible',
      title: '世界设定',
      produces: ['bible'],
      review: false,
      async run(ctx) {
        const text = await callText(ctx, 'bible', prompts.bible, { maxTokens: 4096 })
        return {
          artifacts: { bible: { kind: 'md', content: ensureHeading(text, '# 世界设定') } },
          note: '世界设定完成',
        }
      },
    },
    {
      id: 'characters',
      title: '人物档案',
      produces: ['characters'],
      review: false,
      async run(ctx) {
        const data = await callJson(ctx, 'characters', prompts.characters, charactersSchema)
        const warn = typeof ctx.warn === 'function' ? ctx.warn : ctx.log
        const notes = []
        const cast = Array.isArray(data.cast) ? data.cast : []

        // 主角标记要能被下游认出来：craft 的代词检查、ledger 的主角保护都只认 role === '主角'。
        // 模型常写「主人公」「主视角」，归一化，避免一条规则对不上就静默失效。
        for (const member of cast) {
          if (!/^(主人公|主视角|视角人物|第一主角|pov|protagonist)$/i.test(String(member.role ?? '').trim())) continue
          member.role = '主角'
        }
        if (cast.length && !cast.some((member) => member.role === '主角')) {
          cast[0].role = '主角'
          notes.push(`没标主角，已把「${cast[0].name ?? '第一位人物'}」当主角`)
        }

        // 用户在建项目时把性别定死了，就以用户为准：模型写成别的性别时改回来并说明，
        // 否则代词对照会按模型的错性别展开，正文越写越乱。
        const wanted = ['男', '女'].includes(String(ctx.params?.protagonistGender ?? '')) ? String(ctx.params.protagonistGender) : ''
        if (wanted) {
          const leads = cast.filter((member) => member.role === '主角')
          const changed = leads.filter((member) => sexOf(member.gender) !== wanted)
          for (const member of changed) member.gender = wanted
          if (changed.length) notes.push(`主角性别按你的选择定为「${wanted}」`)
        }

        const missing = castForCheck(data).filter((member) => !member.gender)
        if (missing.length) {
          // 不阻断：老项目/弱模型的档案可能没写性别。留一条 warn，让人知道
          // 后面正文出现「他/她」混用不是玄学，而是这里缺了依据。
          const message = `人物档案缺少性别：${missing.map((member) => member.name).join('、')}——正文可能混用代词，建议在人物档案里补 gender`
          if (typeof warn === 'function') await warn.call(ctx, message)
        }
        return {
          artifacts: { characters: { kind: 'json', content: data } },
          note: `人物档案：${cast.length} 人${notes.length ? `（${notes.join('；')}）` : ''}`,
        }
      },
    },
    {
      id: 'spine',
      title: '情感脊柱',
      produces: ['spine'],
      review: false,
      async run(ctx) {
        // §12：spine 是 JSON，且卷数必须等于卷计划；ctx.volumePlan 由脚本算好，模型不许自己发明卷数。
        const volumePlan = volumePlanFor(ctx.params ?? {})
        const data = await callJson(withPromptContext(ctx, { volumePlan }), 'spine', prompts.spine, spineSchema)
        const aligned = alignSpine(data, volumePlan)
        return {
          artifacts: { spine: { kind: 'json', content: aligned.spine } },
          note: `情感脊柱完成：${volumePlan.length} 卷${aligned.notes.length ? `（${aligned.notes.join('；')}）` : ''}`,
        }
      },
    },
    {
      id: 'outline',
      title: '卷章大纲',
      produces: ['outline', 'canon'],
      review: (project) => project?.params?.reviewGate === true,
      // 长书只摊开第 1 卷；后面每卷等上一卷写完再惰性展开，靠这里把 outline 判成「还没完」。
      isStale: ({ key, artifact }) => {
        if (key !== 'outline') return false
        const outline = artifact?.content
        if (!outline || !Array.isArray(outline.volumes)) return false
        const total = Number(outline.totalChapters) || chaptersOf(outline).length
        if (total > 0 && total <= 60) return false
        return outline.volumes.some((volume) => volume && volume.planned !== true)
      },
      async run(ctx) {
        // 0 次模型（除卷纲惰性展开）：骨架由 plan.js 纯脚本搭，canon 只做种子/迁移。
        const params = ctx.params ?? {}
        const language = params.language ?? 'zh'
        const total = chaptersTotal(params)
        const spine = jsonOr(ctx, 'spine', null)
        let outline = jsonOr(ctx, 'outline', null)
        let changed = false
        if (outline && !plan.isV2(outline)) {
          outline = plan.migrateOutline(outline, { params })
          changed = true
        }
        if (!outline) {
          outline = plan.buildOutlineSkeleton({
            chapters: total,
            chaptersPerVolume: perVolumeOf(params),
            spine,
            language,
          })
          changed = true
        }

        // §2：≤60 章一次把所有卷的章纲摊开；长书只展开下一卷，且要等已列出的章节都写完，
        // 避免一次 abort 后重跑就把后面几卷一起摊开、把整本书的章纲都提前生成。
        const pending = (outline.volumes ?? []).filter((volume) => volume && volume.planned !== true)
        const listed = Array.isArray(outline.chapters) ? outline.chapters : []
        const listedWritten = listed.length > 0 && listed.every((chapter) => has(ctx, `draft/${chapter?.id}`))
        const expand = total <= 60 ? pending : !listed.length || listedWritten ? pending.slice(0, 1) : []
        let calls = 0
        if (expand.length) {
          const unit = requireChapter()
          const read = readerOf(ctx, { outline })
          for (const volume of expand) {
            const ensured = await unit.ensureVolume({ outline, params, read, llm: ctx.llm, language }, { prompts })
            calls += Number(ensured?.calls) || 0
            if (ensured?.created) changed = true
            outline = ensured?.outline ?? outline
          }
        }

        const seeded = seedCanon(ctx, spine)
        if (seeded.source === 'ledger') ctx.log('已把连续性账本迁移为正典 v2')
        const artifacts = {}
        if (seeded.changed) artifacts.canon = { kind: 'json', content: seeded.canon }
        if (changed) artifacts.outline = { kind: 'json', content: outline }
        return {
          artifacts,
          note:
            `大纲骨架 ${chaptersOf(outline).length}/${outline.totalChapters ?? total} 章、${(outline.volumes ?? []).length} 卷` +
            `（本轮展开 ${expand.length} 卷、${calls} 次模型调用；正典来自 ${seeded.source}）`,
        }
      },
    },
    {
      id: 'draft',
      title: '章节草稿',
      each: 'outline.chapters',
      produces: ['draft/*', 'summary/*', 'beats/*', 'canon', 'outline'],
      review: (project) => project?.params?.reviewGate === true,
      // 历史版本会把「正文缺失，无法修订」这类回声写进 draft/*；它们不算完成。
      isStale: ({ key, artifact }) => /^draft\//.test(key) && isPlaceholderText(artifact?.content),
      onItemError: 'stop',
      async run(ctx) {
        const unit = requireChapter()
        const params = ctx.params ?? {}
        const language = params.language ?? 'zh'
        const item = ctx.item ?? {}
        const id = String(item.id)
        let outline = currentOutline(ctx) ?? { chapters: [item] }
        let volume = plan.volumeOfChapter(outline, id) ?? plan.volumeById(outline, item.volume)

        // §7 window：一轮最多推进 N 章。排在本轮窗口之外的章节直接跳过，
        // 下一轮 novel_run 会从剩下没写的章节继续——长篇手动一点的节奏靠它控。
        if (outsideWindow(ctx, id, outline)) {
          // defer：这一条留到下一轮，条目保持 pending、阶段标 partial，
          // 这样紧接着再跑一次 novel_run 会从断点接着写，而不是「已完成」被跳过。
          return { artifacts: {}, defer: true, note: `${id} 在本轮窗口之外，留到下一轮` }
        }

        // 长书续跑时，轮到未展开的卷就先把这一卷的章纲补出来（每卷 1 次）。
        let expanded = false
        if (volume && volume.planned !== true) {
          const ensured = await unit.ensureVolume({ outline, params, read: readerOf(ctx, { outline }), llm: ctx.llm, language }, { prompts })
          outline = ensured?.outline ?? outline
          volume = plan.volumeById(outline, volume.id) ?? volume
          expanded = true
        }

        const read = readerOf(ctx, { outline })
        const hadBeats = has(ctx, `beats/${id}`)
        const prepared = await unit.prepareChapter({ outline, params, chapterId: id, read, llm: ctx.llm, language }, { prompts })
        const chapter = prepared?.chapter ?? item
        volume = prepared?.volume ?? volume
        const beats = prepared?.beats ?? jsonOr(ctx, `beats/${id}`, null)
        const canon = prepared?.canon ?? seedCanon(ctx, jsonOr(ctx, 'spine', null)).canon
        const packet = prepared?.packet ?? assemblePacket(ctx, { chapter, volume, beats, canon })
        if (packet?.report?.overBudget) ctx.warn(`${id} 写作材料超出 contextBudget，packet 已按优先级裁剪`)

        const promptCtx = withPromptContext(ctx, {
          chapter,
          volume: volume ?? null,
          beats,
          packet,
          canonText: canonTextFor(canon, castNamesFor(beats, chapter, volume), id),
          language,
        })
        const raw = await callText(promptCtx, 'draft', prompts.draft, { phase: 'prose', maxTokens: draftMaxTokens(params) + 400 })
        const inline = unit.splitInline(raw)
        const body = normalizeProse(inline?.body ?? '', { no: chapterNoOf(ctx, chapter), title: chapter.title ?? item.title })
        if (!body) throw parseError('draft', '草稿正文为空', raw)

        // 内联摘要/正典补丁缺省时补小调用；补不出来只 warn，不阻断这一章。
        let summary = inline?.summary ?? ''
        if (!summary) {
          try {
            summary = normalizeSummary(
              await callText(withPromptContext(ctx, { chapter, draft: body, beats }), 'summary', prompts.summary, {
                phase: 'summary',
                maxTokens: 800,
              }),
            )
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            ctx.warn(`${id} 摘要生成失败：${err?.message ?? err}`)
            summary = rescueSummary(ctx, item, body, '摘要调用失败')
          }
        }

        let canonPatch = inline?.canonPatch ?? null
        if (!hasPatch(canonPatch) && typeof prompts.canonPatch === 'function') {
          try {
            canonPatch = await callJson(
              withPromptContext(ctx, { chapter, summary, beats, canonText: canonTextFor(canon, castNamesFor(beats, chapter, volume), id) }),
              'canonPatch',
              prompts.canonPatch,
              canonPatchSchema,
              { phase: 'canonPatch' },
            )
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            ctx.warn(`${id} 正典补丁生成失败：${err?.message ?? err}`)
            canonPatch = null
          }
        }

        // commit 时 canon 可能还没落盘（首次运行由 outline stage 种下），beats 也可能刚在本轮生成：
        // 用内存覆盖喂给它，避免 commitChapter 退回空正典后把已有 canon 写小。
        const commitRead = readerOf(ctx, {
          outline,
          canon,
          [`beats/${id}`]: beats,
        })
        const committed = unit.commitChapter({ read: commitRead, params, outline, chapterId: id, text: body, summary, canonPatch })
        // commitChapter 的 artifacts 是 {kind, content} 对象：要取 content，直接 String() 会落成 [object Object]。
        const draft = String(committed?.artifacts?.draft?.content ?? body)
        const finalSummary = String(committed?.artifacts?.summary?.content ?? summary)
        const artifacts = {
          [`draft/${id}`]: { kind: 'md', content: draft },
          [`summary/${id}`]: { kind: 'md', content: finalSummary },
          canon: { kind: 'json', content: committed?.canon ?? canon },
        }
        // 只写这一轮新生成/新展开的东西，避免每章都重写全局产物。
        if (!hadBeats && beats) artifacts[`beats/${id}`] = { kind: 'json', content: beats }
        if (expanded) artifacts.outline = { kind: 'json', content: outline }
        const cjk = Number(committed?.stats?.cjk) || countCjk(draft)
        const counts = committed?.counts ?? countSeverities(committed?.findings ?? [])
        return {
          artifacts,
          note: `第 ${chapterNoOf(ctx, chapter)} 章草稿完成：${cjk} 字${counts.block ? `（block ${counts.block}）` : ''}`,
        }
      },
    },
    {
      id: 'review',
      title: '章节审校',
      each: 'outline.chapters',
      produces: ['review/*'],
      review: (project) => project?.params?.reviewGate === true,
      skip: skipAutoReview,
      onItemError: 'continue',
      async run(ctx) {
        const unit = requireChapter()
        const params = ctx.params ?? {}
        const item = ctx.item ?? {}
        const id = String(item.id)
        const source = draftOf(ctx, id)
        // 占位稿不是正文：审它只会产生假问题，还可能触发一次无意义的修订。
        if (!source || isPlaceholderText(source)) return { artifacts: {}, note: `${id} 还没有正文，跳过审校` }

        const outline = currentOutline(ctx) ?? { chapters: [item] }
        // 审校也要看到最新正典：canon 还没落盘时先种一份，避免写回时把已有内容截短。
        const seeded = seedCanon(ctx, jsonOr(ctx, 'spine', null)).canon
        const read = readerOf(ctx, { outline, canon: seeded })
        const checked = unit.checkChapter({ read, params, outline, chapterId: id, text: source })
        const canon = checked?.canon ?? seeded
        const beats = jsonOr(ctx, `beats/${id}`, null)
        const previous = siblingChapter(outline, id, -1)
        const next = siblingChapter(outline, id, 1)
        const promptCtx = withPromptContext(ctx, {
          chapter: item,
          beats,
          draft: source,
          draftText: source,
          canonText: canonTextFor(canon, castNamesFor(beats, item), id),
          previousSummary: previous ? textOf(ctx, `summary/${previous.id}`) : '',
          nextGoal: next ? `下一章目标：${next.goal ?? ''}（本章不要提前解决）` : '',
        })

        let data
        let degraded = false
        try {
          data = await callJson(promptCtx, 'review', prompts.review, reviewSchema)
        } catch (err) {
          if (err?.code !== 'LLM_EMPTY' && err?.code !== 'LLM_PARSE') throw err
          // 审校整份不合契约时逐条抢救，确定性检查仍然兜底（v0.1 行为保留）。
          degraded = true
          data = salvageReview(err)
        }

        const deterministic = Array.isArray(checked?.findings) ? checked.findings : []
        const findings = [...(data.findings ?? []), ...deterministic].map(normalizeFinding)
        findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        const counts = countSeverities(findings)
        const verdict = counts.block > 0 || counts.warn >= 3 ? 'revise' : 'pass'
        const patch = data.canonPatch ?? data.ledgerPatch ?? null
        const artifacts = {
          [`review/${id}`]: { kind: 'json', content: { findings, canonPatch: hasPatch(patch) ? patch : null, verdict } },
        }
        if (hasPatch(patch)) artifacts.canon = { kind: 'json', content: canonLib.mergeCanon(canon, patch, { chapter: id }) }
        return {
          artifacts,
          note:
            `${id} 审校：block ${counts.block} / warn ${counts.warn} / note ${counts.note}，${verdict === 'pass' ? '通过' : '需要修订'}` +
            (degraded ? '（模型输出降级，仅保留确定性检查与可抢救意见）' : ''),
        }
      },
    },
    {
      id: 'revise',
      title: '定点修订',
      each: 'outline.chapters',
      produces: ['draft/*', 'summary/*'],
      review: (project) => project?.params?.reviewGate === true,
      // 修订永远覆盖写 draft/*：不能因为产物已存在就被跳过。
      alwaysRun: true,
      skip: skipAutoReview,
      onItemError: 'continue',
      async run(ctx) {
        const unit = requireChapter()
        const params = ctx.params ?? {}
        const item = ctx.item ?? {}
        const id = String(item.id)
        // 先看有没有审校意见：没有意见就没有修订的目标，哪怕正文在也一样。
        const review = jsonOr(ctx, `review/${id}`, null)
        if (!review) return { artifacts: {}, note: `${id} 尚未审校，跳过修订` }
        const source = draftOf(ctx, id)
        // 同 review：占位稿不能被当成正文再改一遍（v0.1 的保护保留）。
        if (!source || isPlaceholderText(source)) return { artifacts: {}, note: `${id} 还没有正文，跳过修订` }
        // alwaysRun 只保证「有新的审校意见时会覆盖」；已经在审校之后改过的章节，续跑时不再改一遍。
        const draftArtifact = typeof ctx.read === 'function' ? ctx.read(`draft/${id}`) : null
        const reviewArtifact = typeof ctx.read === 'function' ? ctx.read(`review/${id}`) : null
        const draftedAt = String(draftArtifact?.meta?.updatedAt ?? '')
        const reviewedAt = String(reviewArtifact?.meta?.updatedAt ?? '')
        if (draftedAt && reviewedAt && draftedAt >= reviewedAt) {
          return { artifacts: {}, note: `${id} 上次审校后已经修订过，跳过` }
        }
        const actionable = (review?.findings ?? []).filter((finding) => finding?.severity === 'block' || finding?.severity === 'warn')
        if (!actionable.length) return { artifacts: {}, note: `${id} 没有 block/warn 问题，跳过修订` }

        // §6：revise 直接 buildPacket(mode:'revise')，把待修问题作为最高优先级切片。
        const outline = currentOutline(ctx) ?? { chapters: [item] }
        const chapter = (outline.chapters ?? []).find((row) => row?.id === id) ?? item
        const volume = plan.volumeOfChapter(outline, id) ?? plan.volumeById(outline, chapter.volume)
        const beats = jsonOr(ctx, `beats/${id}`, null)
        const canon = jsonOr(ctx, 'canon', null) ?? seedCanon(ctx, jsonOr(ctx, 'spine', null)).canon
        const packet = assemblePacket(ctx, {
          chapter,
          volume,
          beats,
          canon,
          mode: 'revise',
          revisionFindings: actionable.map(findingLine),
        })

        const promptCtx = withPromptContext(ctx, {
          chapter,
          volume: volume ?? null,
          beats,
          packet,
          findings: actionable,
          draft: source,
          draftText: source,
        })
        const raw = await callText(promptCtx, 'revise', prompts.revise, { phase: 'revise', maxTokens: draftMaxTokens(params) + 400 })
        const inline = unit.splitInline(raw)
        const text = normalizeProse(inline?.body ?? '', { no: chapterNoOf(ctx, chapter), title: chapter.title ?? item.title })

        // 修订只能改问题，不能偷偷把整章删短/注水（v0.1 的长度保护保留）。
        const before = countCjk(source)
        const after = countCjk(text)
        if (before > 0 && (after / before < 0.8 || after / before > 1.25)) {
          throw parseError('revise', `修订稿长度异常：原 ${before} 字 → 新 ${after} 字（允许 0.8–1.25 倍，修订稿已丢弃未落盘）`, raw)
        }

        let summary = inline?.summary ?? ''
        if (!summary) {
          try {
            summary = normalizeSummary(
              await callText(withPromptContext(ctx, { chapter, draft: text, beats }), 'summary', prompts.summary, {
                phase: 'summary',
                maxTokens: 800,
              }),
            )
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            ctx.warn(`${id} 修订后摘要生成失败：${err?.message ?? err}`)
            summary = textOf(ctx, `summary/${id}`) || rescueSummary(ctx, item, text, '修订后摘要调用失败')
          }
        }

        return {
          artifacts: {
            [`draft/${id}`]: { kind: 'md', content: text },
            [`summary/${id}`]: { kind: 'md', content: summary },
          },
          note: `${id} 已修订（${actionable.length} 条 block/warn）`,
        }
      },
    },
    {
      id: 'blurb',
      title: '封面文案',
      produces: ['blurb'],
      review: false,
      async run(ctx) {
        // prompts.blurb 的出口是 Markdown（人读的封面文案），不是 JSON：
        // 在这里解析回结构化字段，写盘仍是 json。
        const raw = await callText(ctx, 'blurb', prompts.blurb, { phase: 'blurb' })
        const parsed = parseBlurbMarkdown(raw)
        const title = String(ctx.params?.title ?? '').trim() || parsed.title || '未命名'
        const plain = stripFence(raw)
          .replace(/^#{1,6}\s*/gm, '')
          .trim()
        const content = {
          title,
          tagline: parsed.tagline,
          // 模型没按约定给「## 简介」时，退一步把整段干净文本当简介，别丢产出。
          blurb: parsed.blurb || plain,
          tags: parsed.tags,
        }
        const checked = blurbSchema.safeParse(content)
        if (!checked.success) throw parseError('blurb', `封面文案字段不合契约（${formatZod(checked.error)}）`, raw)
        return {
          artifacts: { blurb: { kind: 'json', content: checked.data } },
          note: `封面文案：《${checked.data.title}》`,
        }
      },
    },
  ]

  return {
    id: 'novel',
    version: 2,
    title: '长篇小说',

    paramsSchema,
    paramsDefaults: { ...paramsDefaults },

    artifacts: {
      brief: { kind: 'json', title: '故事核心' },
      bible: { kind: 'md', title: '世界观设定' },
      characters: { kind: 'json', title: '人物档案' },
      spine: { kind: 'json', title: '情感脊柱（分卷 JSON）' },
      outline: { kind: 'json', title: '卷章大纲' },
      canon: { kind: 'json', title: '连续性正典' },
      blurb: { kind: 'json', title: '封面文案' },
      'beats/*': { kind: 'json', title: '章节细纲' },
      'draft/*': { kind: 'md', title: '章节草稿' },
      'summary/*': { kind: 'md', title: '章节摘要' },
      'review/*': { kind: 'json', title: '章节审校' },
      manuscript: { kind: 'md', title: '全书合稿' },
    },

    stages,

    /** 领域统计：已写章节/字数/卷进度，供引擎写进 project.stats、UI 展示。 */
    stats(project, read) {
      let chapters = clampInt(project?.params?.chapters, paramsDefaults.chapters, 6, 3000)
      let volumes = 0
      let plannedVolumes = 0
      try {
        if (read.has('outline')) {
          const outline = read.json('outline')
          const listed = chaptersOf(outline)
          // 长书只列出已展开的卷：进度要按全书总章数算，不能用「已展开章数」冒充总章数。
          if (Number(outline?.totalChapters) > 0) chapters = Number(outline.totalChapters)
          else if (listed.length) chapters = listed.length
          volumes = Array.isArray(outline?.volumes) ? outline.volumes.length : 0
          plannedVolumes = (outline?.volumes ?? []).filter((volume) => volume && volume.planned === true).length
        }
      } catch {
        // 大纲还没落盘或格式未定：退回 params
      }
      let drafted = 0
      let words = 0
      for (const key of Object.keys(project?.artifacts || {})) {
        if (!key.startsWith('draft/')) continue
        let text = ''
        try {
          text = read.text(key)
        } catch {
          continue
        }
        if (!text) continue
        drafted += 1
        words += text.replace(/\s+/g, '').length
      }
      return { chapters, drafted, words, volumes, plannedVolumes }
    },

    estimate(params = {}) {
      const merged = { ...paramsDefaults, ...params }
      const chapters = clampInt(merged.chapters, paramsDefaults.chapters, 6, 3000)
      const wordsPerChapter = clampInt(merged.wordsPerChapter, paramsDefaults.wordsPerChapter, 800, 8000)
      const autoReview = merged.autoReview !== false
      const tokens = (chars) => Math.ceil(chars / 1.6) // §3.4：中文约 1.6 字/token
      // 卷数走 plan 的同一套算法：chapters/chaptersPerVolume 超过 40 卷时会自动抬升每卷章数。
      const volumePlans = plan.volumeCount(chapters, perVolumeOf(merged))

      // §12 成本模型：固定 6 段 + 每章 3.5 次（细纲 1、草稿 1、摘要/正典补丁摊 0.5、审校 1 + 修订摊薄）
      // + 卷纲每卷 1 次。关键性质：第 N 章的写作材料和第 1 章一样大，成本随章数线性增长。
      const perChapter = autoReview ? 3.5 : 2.5
      const calls = Math.ceil(6 + chapters * perChapter + volumePlans)

      const fixedIn = 25279
      const fixedOut = 10177
      const prose = (ratio) => Math.round(wordsPerChapter * ratio)
      // 草稿/修订的输入就是 packet，因此按 contextBudget 估，而不是按章号累加：
      // 第 N 章的写作材料和第 1 章一样大。
      const budget = clampInt(merged.contextBudget, paramsDefaults.contextBudget, 4000, 30000)
      const perChapterIn =
        budget + // 草稿 packet（硬上限）
        (autoReview ? Math.round(budget * 0.5) + prose(1.1) + 2500 : 0) + // 审校材料 + 正文；修订复用 packet
        2100 // 细纲 + 摘要/正典补丁小调用
      const perChapterOut =
        1757 + // 细纲
        prose(1.03) + // 草稿正文
        (autoReview ? 1053 + prose(1.07) : 0) // 审校结论 + 修订正文
      const estTokensIn = tokens(fixedIn + volumePlans * 1500 + chapters * perChapterIn)
      const estTokensOut = tokens(fixedOut + volumePlans * 900 + chapters * perChapterOut)

      return {
        chapters,
        calls,
        volumePlans,
        estTokensIn,
        estTokensOut,
        note:
          `约 ${calls} 次模型调用；${chapters} 章 × ${wordsPerChapter} 字，约 ${volumePlans} 卷（每卷约 ${Math.ceil(chapters / Math.max(1, volumePlans))} 章）；` +
          `第 N 章的写作材料和第 1 章一样大（每章 ${perChapter} 次调用 + 一份固定上限的 packet）；` +
          `预计输入约 ${estTokensIn} tokens、输出约 ${estTokensOut} tokens` +
          (autoReview ? '（含自动审校+修订）' : '（不含审校）'),
      }
    },

    exports: {
      markdown: { title: 'Markdown', run: markdownExport },
      epub: { title: 'EPUB', run: epubExport },
    },
  }
}

export const novelRecipe = createNovelRecipe()

export { paramsSchema, chaptersOf }
export default novelRecipe
