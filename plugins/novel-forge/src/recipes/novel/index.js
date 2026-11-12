// novel recipe — 小说 recipe 定义。
// 契约：docs/architecture.md §3.1（recipe 形状）、§4.1（params）、§4.2（stages）、§4.4（JSON 形状）。
// 本文件只做编排：拼 prompt 输入 → 调 ctx.llm.generate → 校验/规范化 → 返回 artifacts。
import { z } from 'zod'
import { createPrompts, SUMMARY_MARKER, sexOf } from './prompts/zh.js'
import { defaultCraft, severityRank, countCjk } from './craft.js'
import { normalizeOutline, chaptersOf } from './outline.js'
import { createLedger, mergeLedger, slimLedger, characterBrief, emptyLedger } from './ledger.js'
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
    chapters: { type: 'integer', minimum: 6, maximum: 120 },
    wordsPerChapter: { type: 'integer', minimum: 800, maximum: 8000 },
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

// 模型少给 ledgerPatch / verdict 是常态，不能因此丢掉整份审校结果：
// 两者可选，verdict 缺失时由 block/warn 计数推断（见 review stage）。
const reviewSchema = z.object({
  findings: z.array(findingSchema),
  ledgerPatch: ledgerPatchSchema.nullish(),
  verdict: z.enum(['pass', 'revise']).optional(),
})

const blurbSchema = z.object({
  title: z.string().min(1),
  tagline: z.string(),
  blurb: z.string(),
  tags: z.array(z.string()),
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

function previousChapter(ctx) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0
  return ctx.items?.[index - 1] ?? null
}

function nextChapter(ctx) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0
  return ctx.items?.[index + 1] ?? null
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

/** 按 §4.3 预算拼装写章材料；每一块都过 ctx.fit。 */
function buildDraftMaterials(ctx) {
  const item = ctx.item ?? {}
  const beats = jsonOr(ctx, `beats/${item.id}`, null)
  const previous = previousChapter(ctx)
  const next = nextChapter(ctx)

  const materials = {
    beats: fit(ctx, textOf(ctx, `beats/${item.id}`), 2500),
    previousSummary: previous ? fit(ctx, textOf(ctx, `summary/${previous.id}`), 800) : '',
    ledger: fit(ctx, slimLedger(jsonOr(ctx, 'ledger', emptyLedger()), { maxChars: 3000 }), 3000),
    nextGoal: next ? fit(ctx, `目标：${next.goal ?? ''}\n转折：${next.turn ?? ''}`, 400) : '',
    characters: fit(
      ctx,
      characterBrief(
        jsonOr(ctx, 'characters', {})?.cast ?? [],
        collectCastNames(beats, item),
        1500,
      ),
      1500,
    ),
    styleGuide: fit(ctx, ctx.params?.styleGuide ?? '', 1500),
    previousHook: previous?.hook ?? '',
  }
  return materials
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
  return ['facts', 'threads', 'characters', 'timeline', 'canonRules'].some((key) => {
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
  const patch = raw?.ledgerPatch == null ? null : ledgerPatchSchema.safeParse(raw.ledgerPatch)
  return {
    findings,
    ledgerPatch: patch?.success ? patch.data : null,
    verdict: undefined,
  }
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
        const text = await callText(ctx, 'spine', prompts.spine, { maxTokens: 4096 })
        return {
          artifacts: { spine: { kind: 'md', content: ensureHeading(text, '# 情感脊柱') } },
          note: '情感脊柱完成',
        }
      },
    },
    {
      id: 'outline',
      title: '卷章大纲',
      produces: ['outline', 'ledger'],
      review: (project) => project?.params?.reviewGate === true,
      async run(ctx) {
        const spec = promptSpec(ctx, prompts.outline, 'outline')
        const result = await ctx.llm.generate({
          system: spec.system,
          user: spec.user,
          maxTokens: spec.maxTokens,
          temperature: spec.temperature,
          json: true,
          phase: 'outline',
          label: 'outline',
        })
        const raw = result?.json ?? extractJson(result?.text)
        if (raw === undefined) throw parseError('outline', '模型返回的不是合法 JSON', result?.text)
        const outline = normalizeOutline(raw, {
          chapters: ctx.params?.chapters,
          language: ctx.params?.language,
        })
        const ledger = createLedger({
          brief: jsonOr(ctx, 'brief', {}),
          outline,
          params: ctx.params ?? {},
        })
        return {
          artifacts: {
            outline: { kind: 'json', content: outline },
            ledger: { kind: 'json', content: ledger },
          },
          note: outline.trimmed
            ? `卷章大纲：${outline.totalChapters} 章（模型多给 ${outline.trimmed} 章，已按计划裁掉）`
            : `卷章大纲：${outline.totalChapters} 章`,
        }
      },
    },
    {
      id: 'beats',
      title: '章节细纲',
      each: 'outline.chapters',
      produces: ['beats/*'],
      review: false,
      async run(ctx) {
        const item = ctx.item ?? {}
        let data
        let note = null
        try {
          data = await callJson(ctx, 'beats', prompts.beats, beatsSchema)
        } catch (err) {
          if (err?.code !== 'LLM_PARSE') throw err
          const salvaged = salvageScenes(err?.detail?.raw)
          if (!salvaged.length) throw err
          // 细纲写不完整时，草稿阶段会退回「只有卷章大纲」，质量损失比少几场大得多。
          if (typeof ctx.log === 'function') {
            await ctx.log(`${item.id} 细纲没写完整，已从截断输出里抢救出 ${salvaged.length} 场继续`, {
              salvaged: salvaged.length,
            })
          }
          data = { title: '', scenes: salvaged }
          note = `${item.id} 细纲被截断：只抢救到 ${salvaged.length} 场，草稿按可用部分写`
        }
        const beats = {
          chapterId: item.id,
          title: String(data.title ?? '').trim() || String(item.title ?? '').trim(),
          scenes: data.scenes.map((scene, index) => ({ ...scene, no: index + 1 })),
        }
        return {
          artifacts: { [`beats/${item.id}`]: { kind: 'json', content: beats } },
          note: note ?? `${item.id} 细纲：${beats.scenes.length} 场`,
        }
      },
    },
    {
      id: 'draft',
      title: '章节草稿',
      each: 'outline.chapters',
      produces: ['draft/*', 'summary/*'],
      review: (project) => project?.params?.reviewGate === true,
      // 历史版本会把「正文缺失，无法修订」这类回声写进 draft/*；它们不算完成，
      // 否则项目永久停在「已完成」，用户重跑也会被跳过。
      isStale: ({ key, artifact }) => /^draft\//.test(key) && isPlaceholderText(artifact?.content),
      onItemError: 'stop',
      async run(ctx) {
        const item = ctx.item ?? {}
        const no = chapterNumber(ctx)
        const materials = buildDraftMaterials(ctx)
        const promptCtx = withPromptContext(ctx, { materials })

        const raw = await callText(promptCtx, 'draft', prompts.draft, {
          phase: 'prose',
          maxTokens: draftMaxTokens(ctx.params) + 400,
        })
        const inline = takeInlineSummary(raw)
        const text = normalizeProse(inline.prose, { no, title: item.title })

        const summaryCtx = withPromptContext(ctx, {
          materials,
          draft: text,
          draftText: text,
          chapterTitle: item.title,
          chapterNo: no,
        })
        let summary = ''
        if (inline.summary) {
          summary = normalizeSummary(inline.summary)
        } else {
          try {
            summary = normalizeSummary(
              await callText(summaryCtx, 'summary', prompts.summary, { phase: 'summary', maxTokens: 800 }),
            )
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            summary = rescueSummary(ctx, item, text, `模型未给出摘要：${err?.message ?? err}`)
          }
        }

        const { stats } = craft.checkDraft({
          text,
          params: ctx.params,
          beats: null,
          cast: castForCheck(jsonOr(ctx, 'characters', null)),
        })
        return {
          artifacts: {
            [`draft/${item.id}`]: { kind: 'md', content: text },
            [`summary/${item.id}`]: { kind: 'md', content: summary },
          },
          note: `第 ${no} 章草稿完成，${stats.cjk} 字`,
        }
      },
    },
    {
      id: 'review',
      title: '连续性审校',
      each: 'outline.chapters',
      produces: ['review/*'],
      review: false,
      skip: (project) => (project?.params?.autoReview === false ? '未开启自动审校' : false),
      async run(ctx) {
        const item = ctx.item ?? {}
        // 没有正文就没什么可审的：以前会把「正文缺失」占位符喂给模型，
        // 模型照着回声一段，审校结论和后续修订全在加工空气，还白付一次调用。
        const source = draftOf(ctx, item.id)
        if (!source) return { artifacts: {}, note: `${item.id} 还没有正文，跳过审校` }
        let degraded = false
        let data
        try {
          data = await callJson(ctx, 'review', prompts.review, reviewSchema)
        } catch (err) {
          // 审校是增值环节：模型空返回/JSON 不合法时，不应让整炉失败；
          // 退回确定性检查（AI 腔、对话比、钩子兑现等），并在 note 里标明降级。
          if (err?.code !== 'LLM_EMPTY' && err?.code !== 'LLM_PARSE') throw err
          degraded = true
          data = salvageReview(err)
        }
        const draftText = source
        const beats = jsonOr(ctx, `beats/${item.id}`, null)
        const deterministic = craft.checkDraft({
          text: draftText,
          params: ctx.params ?? {},
          beats,
          previousHook: previousChapter(ctx)?.hook ?? '',
          cast: castForCheck(jsonOr(ctx, 'characters', null)),
        })

        const findings = [...data.findings, ...deterministic.findings]
          .map((finding) => ({
            severity: finding.severity,
            kind: finding.kind,
            where: finding.where,
            issue: finding.issue,
            fix: finding.fix,
          }))
          .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        const counts = countSeverities(findings)
        // 契约（prompts/zh.js review）：有 block，或 warn ≥ 3 → revise。
        // 模型给的 verdict 不可信（常整份漏给或与 findings 冲突），一律按计数推断。
        const verdict = counts.block > 0 || counts.warn >= 3 ? 'revise' : 'pass'
        const review = { findings, ledgerPatch: data.ledgerPatch ?? null, verdict }

        const artifacts = { [`review/${item.id}`]: { kind: 'json', content: review } }
        if (hasPatch(data.ledgerPatch)) {
          artifacts.ledger = {
            kind: 'json',
            content: mergeLedger(jsonOr(ctx, 'ledger', emptyLedger()), data.ledgerPatch, item.id),
          }
        }
        return {
          artifacts,
          note: `审校 ${item.id}：block ${counts.block} / warn ${counts.warn} / note ${counts.note} → ${verdict}${
            degraded ? '（模型未返回可用审校结果，仅保留确定性检查）' : ''
          }`,
        }
      },
    },
    {
      id: 'revise',
      title: '修订',
      each: 'outline.chapters',
      produces: ['draft/*', 'summary/*'],
      // 修订和草稿写同一批 key：不加 alwaysRun 会被「draft 已完成」整段跳过，
      // 审校结论就永远落不到正文上（审校-修订闭环静默失效）。
      alwaysRun: true,
      review: false,
      skip: (project) => (project?.params?.autoReview === false ? '未开启自动审校' : false),
      async run(ctx) {
        const item = ctx.item ?? {}
        if (!ctx.has(`review/${item.id}`)) {
          return { artifacts: {}, note: `${item.id} 尚未审校，跳过修订` }
        }
        const draftText = draftOf(ctx, item.id)
        if (!draftText) {
          return { artifacts: {}, note: `${item.id} 还没有正文，跳过修订（先补草稿）` }
        }
        const review = jsonOr(ctx, `review/${item.id}`, null)
        const actionable = (review?.findings ?? []).filter(
          (finding) => finding.severity === 'block' || finding.severity === 'warn',
        )
        if (!actionable.length) {
          return { artifacts: {}, note: `${item.id} 无 block/warn 问题，跳过修订` }
        }

        const no = chapterNumber(ctx)
        const materials = buildDraftMaterials(ctx)
        const promptCtx = withPromptContext(ctx, {
          materials,
          draft: draftText,
          draftText,
          review,
          findings: actionable,
          chapterTitle: item.title,
          chapterNo: no,
        })

        const prose = await callText(promptCtx, 'revise', prompts.revise, {
          phase: 'revise',
          maxTokens: draftMaxTokens(ctx.params) + 400,
        })
        const inline = takeInlineSummary(prose)
        const text = normalizeProse(inline.prose, { no, title: item.title })
        // 模型只回一段片段也会被当成整章覆盖：按中文字数把「明显不是同一章篇幅」的修订稿挡在落盘前。
        const before = countCjk(draftText)
        const after = countCjk(text)
        if (before > 0 && (after / before < 0.8 || after / before > 1.25)) {
          throw parseError(
            'revise',
            `修订稿长度异常（原 ${before} 字 → 新 ${after} 字），已丢弃未落盘`,
            prose,
          )
        }
        let summary = ''
        if (inline.summary) {
          summary = normalizeSummary(inline.summary)
        } else {
          try {
            summary = normalizeSummary(
              await callText(
                withPromptContext(promptCtx, { draft: text, draftText: text, reviseSummary: true }),
                'summary',
                prompts.summary,
                { phase: 'summary', maxTokens: 800 },
              ),
            )
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            summary = rescueSummary(ctx, item, text, `修订后未给出摘要：${err?.message ?? err}`)
          }
        }

        return {
          artifacts: {
            [`draft/${item.id}`]: { kind: 'md', content: text },
            [`summary/${item.id}`]: { kind: 'md', content: summary },
          },
          note: `${item.id} 已修订（${actionable.length} 条问题）`,
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
    version: 1,
    title: '长篇小说',

    paramsSchema,
    paramsDefaults: { ...paramsDefaults },

    artifacts: {
      brief: { kind: 'json', title: '故事核心' },
      bible: { kind: 'md', title: '世界观设定' },
      characters: { kind: 'json', title: '人物档案' },
      spine: { kind: 'md', title: '情感脊柱' },
      outline: { kind: 'json', title: '卷章大纲' },
      ledger: { kind: 'json', title: '连续性账本' },
      blurb: { kind: 'json', title: '封面文案' },
      'beats/*': { kind: 'json', title: '章节细纲' },
      'draft/*': { kind: 'md', title: '章节草稿' },
      'summary/*': { kind: 'md', title: '章节摘要' },
      'review/*': { kind: 'json', title: '章节审校' },
      manuscript: { kind: 'md', title: '全书合稿' },
    },

    stages,

    /** 领域统计：已写字数/已写章节，供引擎写进 project.stats、UI 展示。 */
    stats(project, read) {
      let total = clampInt(project?.params?.chapters, paramsDefaults.chapters, 6, 120)
      try {
        if (read.has('outline')) {
          const listed = chaptersOf(read.json('outline'))
          if (listed.length) total = listed.length
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
      return { chapters: total, drafted, words }
    },

    estimate(params = {}) {
      const merged = { ...paramsDefaults, ...params }
      const chapters = clampInt(merged.chapters, paramsDefaults.chapters, 6, 120)
      const wordsPerChapter = clampInt(merged.wordsPerChapter, paramsDefaults.wordsPerChapter, 800, 8000)
      const autoReview = merged.autoReview !== false
      const tokens = (chars) => Math.ceil(chars / 1.6) // §3.4：中文约 1.6 字/token

      // 每章 4 次：细纲 / 草稿（含内联摘要）/ 审校 / 修订（含内联摘要）；不开审校只有 2 次。
      const calls = 6 + chapters * (autoReview ? 4 : 2)
      // 以下常量来自 12 章 × 3000 字的实测聚合（docs/architecture.md §6.5），
      // 只保留「随字数线性增长」的那部分乘 wordsPerChapter；误差约 ±1%。
      const fixedIn = 25279
      const fixedOut = 10177
      const prose = (ratio) => Math.round(wordsPerChapter * ratio)
      const perChapterIn =
        5483 + // 细纲
        6324 + // 草稿（含摘要契约与账本/文风）
        (autoReview ? 6331 + prose(1.05) + 4581 + prose(1.05) : 0) // 审校 + 修订
      const perChapterOut =
        1757 + // 细纲
        prose(1.03) + // 草稿正文
        (autoReview ? 1053 + prose(1.07) : 0) // 审校结论 + 修订正文
      const estTokensIn = tokens(fixedIn + chapters * perChapterIn)
      const estTokensOut = tokens(fixedOut + chapters * perChapterOut)

      return {
        chapters,
        calls,
        estTokensIn,
        estTokensOut,
        note:
          `约 ${calls} 次模型调用；${chapters} 章 × ${wordsPerChapter} 字；` +
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
