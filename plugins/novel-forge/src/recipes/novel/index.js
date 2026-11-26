// novel recipe — 小说 recipe 定义（v0.2 agent-first）。
// 契约：docs/architecture-v2.md §2（卷章分层）、§3（9 段阶段表）、§4（正典）、§6（chapter.js）、§12（提示词）。
// 本文件只做编排：拼 prompt 输入 → 调 ctx.llm.generate → 校验/规范化 → 返回 artifacts。
// 每章的工作量是固定的：细纲 1 + 草稿 1 + 摘要/正典摊 0.5 + 审校 1 + 修订摊薄 = 3.5 次调用。
import { z } from 'zod'
import { createPrompts, SUMMARY_MARKER, sexOf } from './prompts/zh.js'
import { defaultCraft, draftVerdict, severityRank, countCjk, editRate } from './craft.js'
import { countUnquotedFindings, validateFindingQuotes } from './consistency.js'
import { chaptersOf } from './outline.js'
import { buildPacket, sliceBodyCap, sliceOf } from './packet.js'
import {
  continuationNote,
  continuationSpec,
  generateWithContinuation,
  joinProse,
  tailOfProse,
} from './continuation.js'
import * as plan from './plan.js'
import * as canonLib from './canon.js'
import { markdownExport, epubExport, outlineEditorExport } from './export.js'

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
// 网文向定位参数（v0.3）：各站读者预期不同，把「写给谁」变成显式输入。
const CHANNELS = ['男频', '女频', '通用']
const PLATFORMS = ['起点', '番茄', '晋江', '七猫', '未定']
const CADENCES = ['日更', '周更', '不定期']

export const paramsDefaults = {
  title: '',
  genre: '悬疑',
  audience: '成年',
  language: 'zh',
  chapters: 100,
  wordsPerChapter: 3000,
  chaptersPerVolume: 30,
  contextBudget: 12000,
  pov: '第三人称限知',
  tone: '',
  styleGuide: '',
  autoReview: true,
  reviewGate: true,
  seed: '',
  protagonistGender: 'auto',
  channel: '通用',
  platform: '未定',
  tags: '',
  sellingPoint: '',
  comps: '',
  updateCadence: '日更',
  goldenFinger: '',
  marketMode: 'off',
  marketYear: 0,
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
      description: '写一章的提示词预算（字符）。材料上限不随章号增长：各分片有固定 cap，包永远 ≤ 这个值',
    },
    pov: { type: 'string', enum: POVS },
    tone: { type: 'string', maxLength: 200 },
    styleGuide: { type: 'string', maxLength: 4000 },
    autoReview: { type: 'boolean' },
    reviewGate: { type: 'boolean' },
    quoteDowngrade: { type: 'boolean', description: '审校 finding 引文未命中正文时是否降一级（block→warn，warn→note）；默认 false，只标记不降级' },
    seed: { type: 'string', maxLength: 500 },
    protagonistGender: {
      type: 'string',
      enum: ['auto', '男', '女'],
      description: '主角性别：auto 交给模型定；男/女 则写死并在全书统一代词',
    },
    channel: {
      type: 'string',
      enum: CHANNELS,
      description: '男频/女频/通用：决定读者预期、爽点密度与章末钩子的写法',
    },
    platform: {
      type: 'string',
      enum: PLATFORMS,
      description: '目标平台（只记录，供 agent 与后续版本调优；不影响本轮提示词）',
    },
    tags: { type: 'string', maxLength: 120, description: '标签，逗号分隔 3–6 个（如 无限流,克苏鲁,群像）' },
    sellingPoint: { type: 'string', maxLength: 60, description: '一句话卖点：冲突 + 读者能持续得到的体验' },
    comps: { type: 'string', maxLength: 160, description: '对标作品，格式「书名：借什么机制」' },
    updateCadence: { type: 'string', enum: CADENCES, description: '更新节奏；影响卷末钩子与存稿建议' },
    goldenFinger: { type: 'string', maxLength: 200, description: '金手指/核心外挂：规则、边界、代价（可空）' },
    marketMode: {
      type: 'string',
      enum: ['off', 'year', 'tags'],
      description: '市场坐标：off 关闭；year 按某年榜单风向注入商业定位；tags 按已填标签匹配头部作品（只借机制）',
    },
    marketYear: {
      type: 'integer',
      minimum: 0,
      maximum: 2026,
      description: '对标年份 2015–2026，0=不指定；2026 为进行中年份',
    },
  },
}

// ---------------------------------------------------------------- 输出 schema（§4.4）

// 注意：模型少写一个字段，不该让整段已经付过费的调用作废。
// 只把「有它才有意义」的字段设成必填（logline/name/issue），其余 `.catch('')` 降级成空串，
// 下游 prompt 对空值都有兜底文案。
const soft = z.string().catch('')
const softList = z.array(z.string()).catch([])

// 短标签字段（X4 四件套这类）：超长就截断，不整段作废。
// 它们只是给后文 prompt 引用的提示，多写十几个字不是错误，模型也几乎不会正好卡在字数线上；
// 以前 `.max(30)` 硬拒会把整本书堵在 characters 阶段（2026-11-21 真实事故：wound 超长 → LLM_PARSE）。
const shortLabel = (limit = 30) =>
  z
    .string()
    .nullish()
    .transform((value) => {
      if (typeof value !== 'string') return undefined
      return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
    })

const briefSchema = z.object({
  title: soft,
  logline: z.string().min(1),
  theme: soft,
  promise: soft,
  ending: soft,
  genreTags: softList,
  // 故事创作方法的痕迹：读者诊断与被划掉的读法。软字段，模型漏写不影响立项。
  readers: soft,
  alternates: softList,
})

// v0.3 网文立项：全部软字段。定位失败不该让整本书开不了工，degraded 标记由调用方决定怎么提示。
const goldenFingerSchema = z.object({
  name: soft,
  rule: soft,
  cost: soft,
  growthAxis: soft,
  firstShowChapter: z.coerce.number().catch(1),
})

const pitchSchema = z.object({
  version: z.coerce.number().catch(1),
  channel: soft,
  platform: soft,
  tags: softList,
  sellingPoint: soft,
  hookLine: soft,
  targetReader: soft,
  promise: soft,
  comps: z.array(z.object({ title: soft, why: soft })).catch([]),
  goldenFinger: goldenFingerSchema.catch({}),
  opening: z.object({ firstLine: soft, chapterOneQuestion: soft }).catch({}),
  degraded: z.boolean().catch(false),
})

const hookSchema = z.object({ type: soft, text: soft, strength: z.coerce.number().catch(3) })

const openerSchema = z.object({
  version: z.coerce.number().catch(1),
  strategy: soft,
  chapters: z
    .array(
      z.object({
        index: z.coerce.number().catch(1),
        title: soft,
        hook: hookSchema.catch({}),
        payoff: z.object({ level: soft, text: soft, chapterDue: z.coerce.number().catch(0) }).catch({}),
        infoDrop: z.object({ readerLearns: soft, characterLoses: soft }).catch({}),
        promiseBeat: soft,
        endHook: hookSchema.catch({}),
      }),
    )
    .catch([]),
  rules: z
    .object({ payoffEveryChapters: z.array(z.coerce.number()).catch([3, 5]), bigPayoffPerVolume: z.array(z.coerce.number()).catch([2, 3]) })
    .catch({}),
  degraded: z.boolean().catch(false),
})

const relationSchema = z.object({ to: soft, kind: soft })

const castSchema = z.object({
  name: z.string().min(1),
  role: soft,
  tier: soft.transform((value) => value.trim().toLowerCase()),
  aliases: softList.transform((values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 3)),
  recognitionTag: shortLabel(20).catch(undefined),
  firstVolume: z.number().nullish().catch(undefined),
  // 性别决定后文用「他」还是「她」。软字段：模型漏写不让整份档案作废，
  // 但 characters 阶段会记一条 warn，提示后文可能混用代词。
  gender: soft,
  want: soft,
  fear: soft,
  secret: soft,
  voice: soft,
  arc: soft,
  // X4 四件套（wound → lie → want/need，exit 是退场条件）。全部可选：
  // 老项目/弱模型没写也照常过，写了才进档案供后文引用。各 30 字上限，超长截断而不是整份作废。
  need: shortLabel(30),
  wound: shortLabel(30),
  lie: shortLabel(30),
  exit: shortLabel(30),
  // v0.3：金手指的压力面。模型愿意写就留着，让 draft 提示词能引用；
  // 缺省不报错（老项目/弱模型没有这一层，正文靠卷纲里的代价兜）。
  power: soft,
  growth: soft,
  cost: soft,
  pressure: soft,
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
  quote: z.string().optional(),
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
  // v0.3：opens 可带 { text, dueIn }（dueIn = 绝对章号），字符串是旧形状，两种都收。
  opens: z
    .array(z.union([z.string(), z.object({ text: soft, dueIn: z.coerce.number().optional() })]))
    .catch([]),
  closes: z.array(z.string()).catch([]),
  // v0.3：卷级爽点/钩子/单元弧。这些字段要穿过 schema，否则 zod 会静默剥掉，
  // 骨架拿不到 → 卷纲提示词里也就没有可兑现的排期。
  payoffs: z
    .array(z.object({ atChapter: z.coerce.number().optional(), level: soft, text: soft }))
    .catch([]),
  cliffhanger: soft,
  unitArcs: z.array(z.string()).catch([]),
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

async function askJson(ctx, stage, spec, { extra, maxTokens, reasoningEffort } = {}) {
  const result = await ctx.llm.generate({
    system: spec.system,
    user: extra ? `${spec.user}\n\n${extra}` : spec.user,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : spec.maxTokens,
    temperature: spec.temperature,
    json: true,
    phase: spec.phase ?? stage,
    label: stage,
    ...(typeof reasoningEffort === 'string' ? { reasoningEffort } : {}),
  })
  const text = String(result?.text ?? '')
  let data = result?.json
  if (data == null) data = extractJson(text)
  return { data, text }
}

async function callJson(ctx, stage, promptFn, schema, { phase, retryCut = true } = {}) {
  const spec = { ...promptSpec(ctx, promptFn, stage), phase: phase ?? stage }
  let data
  let text
  let truncated
  try {
    ;({ data, text } = await askJson(ctx, stage, spec))
  } catch (error) {
    if (!retryCut || error?.code !== 'LLM_TRUNCATED') throw error
    truncated = error
    text = String(error.detail?.text ?? '')
  }
  if (data === undefined && retryCut && (looksCutJson(text) || truncated)) {
    // 截断的那一枪往往是「思考 + JSON」一起吃预算：补枪时关思考，把预算还给 JSON 本身。
    ;({ data, text } = await requireChapter().retryCutJson(
      (options) => askJson(ctx, stage, spec, { ...options, reasoningEffort: 'off' }),
      spec.maxTokens,
      text,
      truncated,
    ))
  }
  if (data === undefined) {
    if (truncated && looksCutJson(text)) throw truncated
    throw parseError(stage, parseFailureMessage(text, looksCutJson(text)), text, 12000)
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issues = formatZod(parsed.error)
    // 字段级不合契约（超长、类型不对、枚举越界）以前直接判死整段，一本书可能因此作废。
    // 小载荷补一枪「只改这几个字段」比重跑整条流水线便宜得多；载荷大就别赌预算，直接报错。
    const repaired = await retryOnSchemaMismatch(ctx, stage, spec, schema, data, issues)
    if (repaired) return repaired
    const error = parseError(stage, `JSON 字段不合契约（${issues}）`, data)
    // detail.raw 会被 clip 截断；把原始对象挂在 detail.data 上，供降级路径抢救可用字段。
    if (error.detail && typeof error.detail === 'object') error.detail.data = data
    throw error
  }
  return parsed.data
}

/** 字段级契约失败后的一次补枪上限：超过这个体量，重发整份 JSON 的代价高于让用户手动重跑。 */
const SCHEMA_REPAIR_MAX_CHARS = 4000

function schemaRepairNote(issues) {
  return [
    '',
    '【上一枪输出的 JSON 形状不合契约，只需修正下列位置】',
    `- ${issues}`,
    '- 其余字段原样保留，重新输出**完整**的 JSON 对象；',
    '- 不要输出解释、不要用 markdown 代码围栏。',
  ].join('\n')
}

async function retryOnSchemaMismatch(ctx, stage, spec, schema, data, issues) {
  let size = 0
  try {
    size = JSON.stringify(data).length
  } catch {
    return null
  }
  if (size > SCHEMA_REPAIR_MAX_CHARS) return null
  try {
    const again = await askJson(ctx, stage, spec, { extra: schemaRepairNote(issues) })
    if (again.data === undefined) return null
    const check = schema.safeParse(again.data)
    return check.success ? check.data : null
  } catch {
    // 补枪本身失败（网络/预算/脚本化测试没排这一枪）时保留原始错误，别让二次失败盖掉真因。
    return null
  }
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

/**
 * 生成长正文（草稿 / 修订）：撞到模型输出上限时带着半截稿续写，而不是整章失败。
 * 中文 1600 字的章按 wordsPerChapter*2.2 要 3520 tokens，换个输出上限低的模型就必撞；
 * 重跑同参数还会撞在同一条线上，所以只能续写。
 */
// 正文阶段主动关思考：宿主把 max_tokens 同时算「思考 + 正文」，推理一长，
// 4500 字的章还没开始写就撞上限（2026-11-22 真实事故：ch001 两枪 0 字，整炉失败）。
// 写小说不需要「先想清楚再动笔」，关掉最省最稳；宿主不支持时网关会静默降级。
const PROSE_REASONING_EFFORT = 'off'

const EMPTY_TRUNCATE_NOTE = [
  '',
  '【注意】上一枪你把整个输出预算花在了思考上，正文一个字都没写出来。',
  '这一枪不要列提纲、不要分析、不要复述要求，直接写正文第一句，边写边想。',
].join('\n')

async function callTextContinued(ctx, stage, promptFn, { phase, maxTokens, temperature, targetChars = 0, continueFrom = '', label } = {}) {
  const spec = promptSpec(ctx, promptFn, stage)
  const base = {
    system: spec.system,
    user: spec.user,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : spec.maxTokens,
    temperature: Number.isFinite(temperature) ? temperature : spec.temperature,
    stage,
    reasoningEffort: PROSE_REASONING_EFFORT,
  }
  // 贴着已有正文的结尾补写，而不是重跑整章：字数不足时的一次补写靠它。
  const fromTail = (text) =>
    continuationNote({
      tail: tailOfProse(text),
      chars: countCjk(text),
      remaining: targetChars > 0 ? Math.max(0, targetChars - countCjk(text)) : 0,
    })
  const firstUser = continueFrom ? `${base.user}\n\n${fromTail(continueFrom)}` : base.user
  const once = async (user) => {
    const { text, parts } = await generateWithContinuation({
      spec: { ...base, user },
      targetChars,
      maxParts: 3,
      generate: (next) =>
        ctx.llm.generate({
          system: next.system,
          user: next.user,
          maxTokens: next.maxTokens,
          temperature: next.temperature,
          json: false,
          phase: phase ?? stage,
          label: label ?? stage,
          // 正文阶段关思考，把输出预算留给正文（见 PROSE_REASONING_EFFORT）。
          reasoningEffort: next.reasoningEffort ?? PROSE_REASONING_EFFORT,
          // 长章正文由 continuation 负责「接着写」，不让网关再整篇重生成一遍。
          escalate: false,
        }),
      onPart: ({ part, chars }) => {
        if (typeof ctx.warn === 'function') {
          ctx.warn(`输出被截断（已写出 ${chars} 字），正在续写第 ${part} 段`)
        }
      },
    })
    return { text: String(text ?? '').trim(), parts }
  }

  let outcome
  try {
    outcome = await once(firstUser)
  } catch (err) {
    // 幂等重跑一次：上一枪一个字都没吐（预算全烧在推理上），没有半截稿可续，
    // 只能把「别分析了，直接写」讲明白再要一次。
    const empty = err?.code === 'LLM_TRUNCATED' && !String(err?.detail?.text ?? '').trim()
    if (!empty) throw err
    if (typeof ctx.warn === 'function') ctx.warn('这一枪连正文都没吐出来（推理吃光了预算），换成「直接开写」再要一次')
    outcome = await once(`${firstUser}\n${EMPTY_TRUNCATE_NOTE}`)
  }
  if (outcome.parts > 1 && typeof ctx.warn === 'function') ctx.warn(`${stage} 分 ${outcome.parts} 段续写完成`)
  return outcome.text
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

// 「续写本章」的字数口径：与工作台/统计一致，按非空白字符数算；
// 目标字数是全书统一口径（wordsPerChapter），不是「这一次写多少」。
function proseChars(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

// 续写返回的正文可能带：代码围栏、章标题、「以下是续写」之类的前缀，
// 以及 draft 同一枪里的 <<<SUMMARY>>> / <<<CANON>>> 尾巴。落盘前只留正文。
function continuationBody(unit, raw) {
  const source = String(raw ?? '')
  const split = typeof unit?.splitInline === 'function' ? unit.splitInline(source) : { body: source }
  let text = stripFence(split?.body ?? source)
  text = text.replace(/^(?:以下是|这是|下面继续|续写如下)[^\n]*\n+/, '').trim()
  text = text.replace(/^\s*#{1,4}\s*第\s*[^\n]*章[^\n]*\n+/, '').trim()
  return text
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

/** 续写时用来算「还差多少字」：目标章长（字），不是 token 预算。 */
function chapterTargetChars(params = {}) {
  return Math.max(200, Math.round(Number(params.wordsPerChapter) || paramsDefaults.wordsPerChapter))
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
// 本轮窗口（§7）：候选名单必须在 run 开头定一次，不能边写边算——
// 边写边算会让名单越来越短，每章都落在窗口第 0 位，window 等于失效。
//
// 候选 = 本轮确实要写正文的章：没写过 / force 重写 / 草稿是占位回声。
// 只收「没有 draft」会把 force 与占位重写漏在窗口外：它们不占名额、也永不 defer，
// window 就被绕过（window=2 实际写 4 章）。已写且不 stale 的章不进候选，
// 交给引擎的「已完成」判定跳过，否则正常续跑会重写。
const RUN_WINDOWS = new Map()

/** 这一章本轮要不要写正文：没写过、草稿是占位回声，或本轮 force 全量重写。 */
function needsDraft(ctx, id) {
  if (!has(ctx, `draft/${id}`)) return true
  return isPlaceholderText(textOf(ctx, `draft/${id}`))
}

function outsideWindow(ctx, id, outline) {
  const size = Number(ctx.run?.options?.window) || 0
  if (size <= 0) return false
  const run = ctx.run ?? {}
  const force = run.options?.force === true
  const requested = Array.isArray(run.options?.items) ? new Set(run.options.items.map(String)) : null
  const key = String(run.id ?? 'run')
  let window = RUN_WINDOWS.get(key)
  // force/window 变了说明不是同一轮（正常 startRun 每次都是新 run id）；
  // 命中旧的 run id 时宁可重算，也不能拿过期名单。
  if (!window || window.force !== force || window.size !== size) {
    const candidates = chaptersOf(outline)
      .map((chapter) => String(chapter?.id ?? ''))
      .filter((chapterId) => chapterId && (!requested || requested.has(chapterId)))
      .filter((chapterId) => force || needsDraft(ctx, chapterId))
    window = { force, size, candidates }
    if (RUN_WINDOWS.size > 64) RUN_WINDOWS.clear()
    RUN_WINDOWS.set(key, window)
  }
  // 不在候选里（已写且不 stale）→ -1，不 defer；它该由引擎跳过，不该被窗口卡住。
  const position = window.candidates.indexOf(String(id))
  return position >= window.size
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

/**
 * 把黄金三章的钩子/爽点/信息差写回章表。只补空字段，重复运行不会覆盖手改。
 */
function applyOpener(outline, opener) {
  if (!opener || !Array.isArray(opener.chapters) || opener.chapters.length === 0) {
    return { outline, changed: false }
  }
  const byIndex = new Map((outline.chapters ?? []).filter(Boolean).map((chapter) => [Number(chapter.index), chapter]))
  let changed = false
  for (const row of opener.chapters) {
    const no = Math.floor(Number(row?.index))
    const chapter = byIndex.get(no)
    if (!chapter) continue
    const hook = row?.hook && typeof row.hook === 'object' ? row.hook : {}
    const endHook = row?.endHook && typeof row.endHook === 'object' ? row.endHook : {}
    const next = { ...chapter }
    if (!next.hookType) {
      const type = String(endHook.type || hook.type || '').trim()
      if (type) next.hookType = type
    }
    if (!next.hookStrength) {
      const raw = Number(endHook.strength || hook.strength)
      next.hookStrength = Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : 0
    }
    const payoffText = String(row?.payoff?.text ?? '').trim()
    if (!next.payoff && payoffText) {
      const level = String(row?.payoff?.level ?? '')
      next.payoff = { level: ['small', 'medium', 'large'].includes(level) ? level : 'small', text: payoffText }
    }
    if (!next.infoDrop && row?.infoDrop && typeof row.infoDrop === 'object') {
      const readerLearns = String(row.infoDrop.readerLearns ?? '').trim()
      const characterLoses = String(row.infoDrop.characterLoses ?? '').trim()
      if (readerLearns || characterLoses) next.infoDrop = { readerLearns, characterLoses }
    }
    if (!next.title && row?.title) next.title = String(row.title).trim()
    if (JSON.stringify(next) !== JSON.stringify(chapter)) {
      byIndex.set(no, next)
      changed = true
    }
  }
  if (!changed) return { outline, changed: false }
  return {
    outline: { ...outline, chapters: (outline.chapters ?? []).map((chapter) => byIndex.get(Number(chapter?.index)) ?? chapter) },
    changed: true,
  }
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
      // opens 可带 { text, dueIn }：dueIn 是绝对章号，canon 用它排回收期。
      opens: plan.normalizeOpens(entry.opens),
      closes: asList(entry.closes),
      payoffs: plan.normalizePayoffs(entry.payoffs),
      cliffhanger: String(entry.cliffhanger ?? '').trim().slice(0, 40),
      unitArcs: asList(entry.unitArcs).slice(0, 3),
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

function normalizeFinding(raw, { model = false } = {}) {
  const severity = ['block', 'warn', 'note'].includes(raw?.severity) ? raw.severity : 'warn'
  return {
    severity,
    kind: String(raw?.kind ?? 'logic'),
    where: String(raw?.where ?? ''),
    issue: String(raw?.issue ?? '').trim() || '审校给出了一条没有描述的问题',
    fix: String(raw?.fix ?? ''),
    ...(model ? { quote: typeof raw?.quote === 'string' ? raw.quote : '' } : {}),
    ...(model && typeof raw?.quoted === 'boolean' ? { quoted: raw.quoted } : {}),
  }
}

/**
 * 兜底拼包：prepareChapter 没给 packet 时用；revise 永远自己拼（mode:'revise'）。
 * 返回 buildPacket 的 {text,report,sections}，text 就是 draft/revise 的 user。
 */
function castBriefForContext(ctx, chapter, volume, beats, canon) {
  return requireChapter().chapterCastBrief({
    characters: jsonOr(ctx, 'characters', {}), chapter, volume, beats, canon, maxChars: sliceBodyCap(sliceOf('cast')),
  })
}

function assemblePacket(ctx, { chapter, volume, beats, canon, dueThreads = '', mode = 'draft', revisionFindings = [] }) {
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
    genreText: requireChapter().genreTextOf(params, readerOf(ctx)),
    canonText: canonTextFor(canon, names, id, sliceBodyCap(sliceOf('canon'))),
    dueThreads,
    castBrief: castBriefForContext(ctx, chapter, volume, beats, canon),
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
      produces: ['brief', 'pitch'],
      review: false,
      async run(ctx) {
        const params = ctx.params ?? {}
        // 第一步先定「写给谁、凭什么追」：定位错了，后面的世界/人物/卷纲全是白写。
        // 失败不阻断：写 degraded 标记，brief 仍照常产出，人可以在项目里补。
        let pitch = null
        if (typeof prompts.pitch === 'function') {
          try {
            pitch = await callJson(ctx, 'pitch', prompts.pitch, pitchSchema)
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            const warn = typeof ctx.warn === 'function' ? ctx.warn : ctx.log
            warn(`商业定位生成失败，已跳过：${err?.message ?? err}`)
            pitch = {
              version: 1,
              degraded: true,
              channel: params.channel ?? '通用',
              platform: params.platform ?? '未定',
              tags: [],
              comps: [],
              goldenFinger: {},
            }
          }
        }
        const data = await callJson(ctx, 'premise', prompts.premise, briefSchema)
        const title = String(params.title ?? '').trim() || String(data.title ?? '').trim() || '未命名'
        const brief = { ...data, title }
        const artifacts = { brief: { kind: 'json', content: brief } }
        if (pitch) artifacts.pitch = { kind: 'json', content: pitch }
        return {
          artifacts,
          note: pitch
            ? `商业定位：${pitch.channel ?? '通用'}${pitch.sellingPoint ? ` · ${pitch.sellingPoint}` : ''}；故事核心：${brief.logline}`
            : `故事核心：${brief.logline}`,
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
        const counts = { core: 0, major: 0, minor: 0 }
        const nearNames = []
        for (const [index, member] of cast.entries()) {
          if (!Object.hasOwn(counts, member.tier)) {
            member.tier = /主角|对手|反派|女主/.test(member.role) ? 'core' : 'major'
          }
          counts[member.tier] += 1
          for (const other of cast.slice(0, index)) {
            const left = Array.from(member.name.normalize('NFKC'))
            const right = Array.from(other.name.normalize('NFKC'))
            if (left.length === right.length && left.filter((char, i) => char !== right[i]).length <= (left.length > 1 ? 1 : 0)) {
              nearNames.push(`${other.name}／${member.name}`)
            }
          }
        }
        if (nearNames.length && typeof warn === 'function') {
          await warn.call(ctx, `人物名字接近：${nearNames.join('、')}，同章安排出场时请区分称呼`)
        }
        return {
          artifacts: { characters: { kind: 'json', content: data } },
          note: `人物档案：${cast.length} 人（核心 ${counts.core}、阶段 ${counts.major}、登记 ${counts.minor}）${notes.length ? `（${notes.join('；')}）` : ''}`,
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
      produces: ['outline', 'canon', 'opener'],
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
        const pitch = jsonOr(ctx, 'pitch', null)
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
            // P1-2：中点章是全书字段，spine/pitch 里带就用；两者都没带时取全书正中，
            // 否则这个校验永远拿不到值（spineSchema / pitchSchema 目前没有该字段）。
            midpointChapter: spine?.midpointChapter ?? pitch?.midpointChapter ?? Math.round(total / 2),
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

        // 黄金三章：只做一次。长篇每轮展开一卷都会重入 outline，已有就直接用。
        let opener = jsonOr(ctx, 'opener', null)
        if (!opener && typeof prompts.opener === 'function') {
          const rows = chaptersOf(outline).slice(0, 3)
          try {
            opener = await callJson(
              withPromptContext(ctx, {
                brief: jsonOr(ctx, 'brief', null),
                pitch: jsonOr(ctx, 'pitch', null),
                spine,
                chapters: rows,
                openerChapters: rows,
              }),
              'opener',
              prompts.opener,
              openerSchema,
              { phase: 'opener' },
            )
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            const warn = typeof ctx.warn === 'function' ? ctx.warn : ctx.log
            warn(`黄金三章生成失败，已按章纲兜底：${err?.message ?? err}`)
            opener = {
              version: 1,
              degraded: true,
              strategy: '',
              chapters: rows.map((row, offset) => ({
                index: Number(row.index) || offset + 1,
                title: row.title ?? '',
                hook: { type: row.hookType || '悬念', text: row.hook ?? '', strength: row.hookStrength || 3 },
                payoff: { level: 'small', text: row.payoff?.text ?? '', chapterDue: 0 },
                infoDrop: { readerLearns: '', characterLoses: '' },
                promiseBeat: '',
                endHook: { type: row.hookType || '悬念', text: row.hook ?? '', strength: row.hookStrength || 3 },
              })),
              rules: { payoffEveryChapters: [3, 5], bigPayoffPerVolume: [2, 3] },
            }
          }
        }
        if (opener) {
          const applied = applyOpener(outline, opener)
          outline = applied.outline
          if (applied.changed) changed = true
        }

        const seeded = seedCanon(ctx, spine)
        if (seeded.source === 'ledger') ctx.log('已把连续性账本迁移为正典 v2')
        const artifacts = {}
        if (seeded.changed) artifacts.canon = { kind: 'json', content: seeded.canon }
        if (opener) artifacts.opener = { kind: 'json', content: opener }
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
        const packet = prepared?.packet ?? assemblePacket(ctx, { chapter, volume, beats, canon, dueThreads: unit.dueThreadsText?.(canon, chapter) ?? '' })
        if (packet?.report?.overBudget) ctx.warn(`${id} 写作材料超出 contextBudget，packet 已按优先级裁剪`)

        const promptCtx = withPromptContext(ctx, {
          chapter,
          volume: volume ?? null,
          beats,
          packet,
          canonText: canonTextFor(canon, castNamesFor(beats, chapter, volume), id),
          language,
        })
        const raw = await callTextContinued(promptCtx, 'draft', prompts.draft, {
          phase: 'prose',
          maxTokens: draftMaxTokens(params) + 400,
          targetChars: chapterTargetChars(params),
        })
        const inline = unit.splitInline(raw)
        let body = normalizeProse(inline?.body ?? '', { no: chapterNoOf(ctx, chapter), title: chapter.title ?? item.title })
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

        // 字数验收：低于目标 0.8 先贴着正文结尾补写一次；补不齐也照样落盘，由 craft 的 length finding 如实提示。
        const target = chapterTargetChars(params)
        const floor = Math.round(target * 0.8)
        if (countCjk(body) < floor) {
          const before = countCjk(body)
          try {
            const extra = await callTextContinued(promptCtx, 'draft', prompts.draft, {
              // 单独标 phase：这是补写，不是本章第一次成稿（调用计数/成本核算要能分开看）。
              phase: 'topup',
              maxTokens: draftMaxTokens(params) + 400,
              targetChars: target,
              continueFrom: body,
              label: 'continue',
            })
            const appended = continuationBody(unit, extra)
            if (appended) {
              const merged = joinProse(body, appended)
              if (countCjk(merged) > before) body = merged
            }
          } catch (err) {
            if (err?.code === 'LLM_ABORTED') throw err
            ctx.warn(`${id} 字数不足（${before}/${target} 字），补写失败：${err?.message ?? err}`)
          }
          if (countCjk(body) < floor) {
            ctx.warn(`${id} 补写后仍不足 ${floor} 字（${countCjk(body)}/${target}），保留 length 告警`)
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
        // draft 阶段已经算过的检查结果不能丢：审校前也要能看见这些问题。
        artifacts[`check/${id}`] = {
          kind: 'json',
          content: { findings: committed?.findings ?? [], counts, verdict: committed?.verdict ?? null },
        }
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
      // 正文被 draft 阶段重写后，旧 review 是对旧稿的判决：让这一章重新审校。
      // 只认 draft 阶段的重写，不认 revise 的回写（否则每次修订都会把审校打回未完成，来回打转）。
      isStale: ({ key, artifact, project }) => {
        const id = String(key).slice('review/'.length)
        const draft = project?.artifacts?.[`draft/${id}`]
        if (!draft || draft.by?.stage !== 'draft') return false
        const reviewAt = Date.parse(artifact?.meta?.updatedAt ?? project?.artifacts?.[key]?.updatedAt ?? '') || 0
        const draftAt = Date.parse(draft.updatedAt ?? '') || 0
        return reviewAt < draftAt
      },
      onItemError: 'continue',
      async run(ctx) {
        const unit = requireChapter()
        const params = ctx.params ?? {}
        const item = ctx.item ?? {}
        const id = String(item.id)
        const source = draftOf(ctx, id)
        // 占位稿不是正文：审它只会产生假问题，还可能触发一次无意义的修订。
        // skipped：不是完成。以前只返回空产物，引擎会记 done——10 章正文就配出 50 章「审校完成」。
        if (!source || isPlaceholderText(source)) return { artifacts: {}, skipped: true, note: `${id} 还没有正文，跳过审校` }

        const outline = currentOutline(ctx) ?? { chapters: [item] }
        // 审校也要看到最新正典：canon 还没落盘时先种一份，避免写回时把已有内容截短。
        const seeded = seedCanon(ctx, jsonOr(ctx, 'spine', null)).canon
        const read = readerOf(ctx, { outline, canon: seeded })
        const checked = unit.checkChapter({ read, params, outline, chapterId: id, text: source })
        const canon = checked?.canon ?? seeded
        const beats = jsonOr(ctx, `beats/${id}`, null)
        const previous = siblingChapter(outline, id, -1)
        const next = siblingChapter(outline, id, 1)
        const reviewChapter = (outline.chapters ?? []).find((row) => row?.id === id) ?? item
        const volume = plan.volumeOfChapter(outline, id) ?? plan.volumeById(outline, reviewChapter.volume)
        const promptCtx = withPromptContext(ctx, {
          chapter: reviewChapter,
          beats,
          castBrief: castBriefForContext(ctx, reviewChapter, volume, beats, canon),
          draft: source,
          draftText: source,
          canonText: canonTextFor(canon, castNamesFor(beats, item), id),
          previousSummary: previous ? textOf(ctx, `summary/${previous.id}`) : '',
          nextGoal: next ? `下一章目标：${next.goal ?? ''}（本章不要提前解决）` : '',
          // 确定性体检的读数：让审校先看数字，再判断机器看不见的东西。
          craftStats: checked?.stats ?? {},
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
        const rawFindings = data.findings ?? []
        const needsQuoteCheck = (finding) => !degraded || finding.quote !== undefined
        const checkedQuotes = validateFindingQuotes(source, rawFindings.filter(needsQuoteCheck), {
          downgrade: params.quoteDowngrade === true,
        }).values()
        // 抢救时只校验已给引文的意见，保留原来的顺序。
        const modelFindings = rawFindings.map((finding) =>
          normalizeFinding(needsQuoteCheck(finding) ? checkedQuotes.next().value : finding, { model: true }),
        )
        const findings = [...modelFindings, ...deterministic.map((finding) => normalizeFinding(finding))]
        findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        const counts = countSeverities(findings)
        const unquotedFindings = countUnquotedFindings(modelFindings)
        const verdict = draftVerdict(findings)
        const patch = data.canonPatch ?? data.ledgerPatch ?? null
        const artifacts = {
          [`review/${id}`]: {
            kind: 'json',
            content: { findings, canonPatch: hasPatch(patch) ? patch : null, verdict, unquotedFindings },
          },
        }
        if (hasPatch(patch)) artifacts.canon = { kind: 'json', content: canonLib.mergeCanon(canon, patch, { chapter: id }) }
        return {
          artifacts,
          note:
            `${id} 审校：block ${counts.block} / warn ${counts.warn} / note ${counts.note}，${verdict === 'pass' ? '通过' : '需要修订'}` +
            (degraded ? '（模型输出降级，仅保留确定性检查与可抢救意见）' : '') +
            (unquotedFindings > 0 ? `；其中 ${unquotedFindings} 条引文未命中正文` : ''),
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
        // 这两种「还没轮到」都记 skipped（不是 done），否则续跑会把它们当已完成永久跳过。
        const review = jsonOr(ctx, `review/${id}`, null)
        if (!review) return { artifacts: {}, skipped: true, note: `${id} 尚未审校，跳过修订` }
        if (review.verdict !== 'revise') {
          const note = review.verdict === 'pass'
            ? '审校通过，未覆盖正文；剩余 warn 可人工润色'
            : '审校缺少有效修订判定，未覆盖正文'
          return { artifacts: {}, skipped: true, note: `${id} ${note}，跳过修订` }
        }
        const source = draftOf(ctx, id)
        // 同 review：占位稿不能被当成正文再改一遍（v0.1 的保护保留）。
        if (!source || isPlaceholderText(source)) {
          return { artifacts: {}, skipped: true, note: `${id} 还没有正文，跳过修订` }
        }
        // alwaysRun 只保证「有新的审校意见时会覆盖」；已经在审校之后改过的章节，续跑时不再改一遍。
        const draftArtifact = typeof ctx.read === 'function' ? ctx.read(`draft/${id}`) : null
        const reviewArtifact = typeof ctx.read === 'function' ? ctx.read(`review/${id}`) : null
        const reviewVersion = reviewArtifact?.meta?.version ?? ctx.project?.artifacts?.[`review/${id}`]?.version ?? 1
        if (reviewVersion >= 3) {
          return { artifacts: {}, skipped: true, note: `${id} 已到第 ${reviewVersion} 次审校，停止自动修订，请人工介入` }
        }
        // 引擎把 stage 的 result.meta 持久化到产物的 meta.by；新正文替换时标记自然清除。
        if (draftArtifact?.meta?.by?.stopAutoRevision === true) {
          return { artifacts: {}, skipped: true, note: `${id} 上次改动不足 5%，停止自动修订，请人工介入` }
        }
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
          dueThreads: unit.dueThreadsText?.(canon, chapter) ?? '',
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
        const raw = await callTextContinued(promptCtx, 'revise', prompts.revise, {
          phase: 'revise',
          maxTokens: draftMaxTokens(params) + 400,
          targetChars: chapterTargetChars(params),
        })
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

        const stopAutoRevision = editRate(continuationBody(unit, source), continuationBody(unit, text)) < 0.05
        return {
          artifacts: {
            [`draft/${id}`]: { kind: 'md', content: text },
            [`summary/${id}`]: { kind: 'md', content: summary },
          },
          ...(stopAutoRevision ? { meta: { stopAutoRevision } } : {}),
          note: `${id} 已修订（${actionable.length} 条 block/warn）${stopAutoRevision ? '；改动不足 5%，停止自动修订' : ''}`,
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
      pitch: { kind: 'json', title: '商业定位' },
      opener: { kind: 'json', title: '黄金三章' },
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

    /**
     * 「一键续写本章」：从 draft/<chapterId> 的断点接着写，不重写整章、不碰下一章。
     * ctx 与 stage 同形（read/text/json/llm/warn），落盘交给 engine.continueChapter，
     * 因为 recipe 不应该知道 store/版本滚动。返回 { chapterId, beforeChars, afterChars, truncated, text }。
     */
    async continueChapter(ctx, arg = {}) {
      const unit = requireChapter()
      const params = ctx?.params ?? {}
      const language = params.language ?? 'zh'
      const chapterId = String(arg?.chapterId ?? arg?.chapter ?? '').trim()
      if (!chapterId) throw new ForgeError('BAD_PARAMS', '续写需要章 id，例如 ch03', { chapterId: '' })

      const outline = currentOutline(ctx)
      if (!outline) {
        throw new ForgeError('NOT_FOUND', '还没有大纲：先跑一次 outline 阶段，再续写这一章', { chapterId })
      }
      const chapter = chaptersOf(outline).find((item) => String(item?.id) === chapterId) ?? null
      if (!chapter) {
        throw new ForgeError('NOT_FOUND', `大纲里没有 ${chapterId} 这一章：先展开它所在的卷纲，再续写`, {
          chapterId,
        })
      }

      const existing = draftOf(ctx, chapterId).trim()
      if (!existing) {
        throw new ForgeError('CONFLICT', '这一章还没有正文：先跑一次 draft 再续写', { chapterId })
      }

      const target = chapterTargetChars(params)
      const beforeChars = proseChars(existing)
      if (beforeChars >= target) {
        return {
          chapterId,
          beforeChars,
          afterChars: beforeChars,
          truncated: false,
          text: existing,
          skipped: true,
          note: `这一章已有 ${beforeChars} 字，达到目标 ${target} 字，不再续写`,
        }
      }
      if (!ctx?.llm || typeof ctx.llm.generate !== 'function') {
        throw new ForgeError('LLM_UNAVAILABLE', '模型服务未就绪：先在设置里选一个模型再续写', { chapterId })
      }

      // 和 draft 阶段同一条取材路径：beats/canon/volume 缺了就现补（只读，不落盘）。
      let volume = plan.volumeOfChapter(outline, chapterId) ?? plan.volumeById(outline, chapter.volume)
      const read = readerOf(ctx, { outline })
      const prepared = await unit.prepareChapter(
        { outline, params, chapterId, read, llm: ctx.llm, language },
        { prompts },
      )
      volume = prepared?.volume ?? volume
      const activeChapter = prepared?.chapter ?? chapter
      const beats = prepared?.beats ?? jsonOr(ctx, `beats/${chapterId}`, null)
      const canon = prepared?.canon ?? seedCanon(ctx, jsonOr(ctx, 'spine', null)).canon
      const packet = prepared?.packet ?? assemblePacket(ctx, {
        chapter: activeChapter,
        volume,
        beats,
        canon,
        dueThreads: unit.dueThreadsText?.(canon, activeChapter) ?? '',
      })
      if (packet?.report?.overBudget && typeof ctx.warn === 'function') {
        ctx.warn(`${chapterId} 的写作材料超出 contextBudget，续写已按 packet 优先级裁剪`)
      }
      const promptCtx = withPromptContext(ctx, {
        chapter: activeChapter,
        volume: volume ?? null,
        beats,
        packet,
        canonText: canonTextFor(canon, castNamesFor(beats, activeChapter, volume), chapterId),
        language,
      })
      const spec = promptSpec(promptCtx, prompts.draft, 'draft')
      const remaining = target - beforeChars
      const maxTokens = Math.min(
        draftMaxTokens(params) + 400,
        Math.max(1200, Math.round(remaining * 2.2)),
      )

      let text = existing
      let truncated = false
      // 首段之外最多再续 2 段（撞输出上限时才续）；部分文本一律先接上，别把已付费的字丢掉。
      const maxParts = 2
      for (let round = 0; round <= maxParts; round += 1) {
        const chars = proseChars(text)
        const next = continuationSpec(
          { system: spec.system, user: spec.user, maxTokens, temperature: spec.temperature },
          {
            tail: tailOfProse(text),
            chars,
            remaining: Math.max(0, target - chars),
          },
        )
        try {
          const result = await ctx.llm.generate({
            system: next.system,
            user: next.user,
            maxTokens: next.maxTokens,
            temperature: next.temperature,
            json: false,
            phase: 'prose',
            label: 'continue',
            reasoningEffort: PROSE_REASONING_EFFORT,
            escalate: false,
          })
          text = joinProse(text, continuationBody(unit, result?.text ?? ''))
          break
        } catch (err) {
          if (err?.code !== 'LLM_TRUNCATED') throw err
          const partial = String(err?.detail?.text ?? '')
          if (!partial.trim()) throw err
          text = joinProse(text, continuationBody(unit, partial))
          if (round >= maxParts) {
            truncated = true
            break
          }
          if (typeof ctx.warn === 'function') {
            ctx.warn(`续写撞到输出上限（已写到 ${proseChars(text)} 字），接着再续第 ${round + 2} 段`)
          }
        }
      }

      const afterChars = proseChars(text)
      if (afterChars <= beforeChars) {
        throw new ForgeError('LLM_EMPTY', '模型这次没有接着写（只重复了已有结尾）：再点一次，或先改一下正文', {
          chapterId,
          beforeChars,
        })
      }
      return { chapterId, beforeChars, afterChars, truncated, text }
    },

    /**
     * 校正历史脏状态：v0.7.0 及以前，review/revise 对还没有正文的章返回空产物，引擎把它记成 done，
     * 于是 10 章正文能配出「审校 50 章、修订 47 章」。这里按「这一阶段必须为该章产出过东西」回收假 done：
     * review 认 review/<id>；revise 认 review/<id> 且 draft/<id>（修订因没有 block/warn 而零产物是合法的，不能只认产物）。
     * 只回收 done，error/skipped 保留原样。返回改动条数，0 表示不需要落盘。
     */
    reconcile(project) {
      const stages = project?.stages ?? {}
      const artifacts = project?.artifacts ?? {}
      const has = (key) => Boolean(artifacts[key])
      const stamp = (key) => Date.parse(artifacts[key]?.updatedAt ?? '') || 0
      // 正文被 draft 阶段重写后，旧 review 是对旧稿的判决：引文对不上、问题清单也不适用。
      // 只认 draft 阶段的重写，不认 revise 的回写——否则每次修订都会把审校再次打成未完成，来回打转。
      const reviewedAfterDraft = (id) => {
        if (!has(`review/${id}`)) return false
        const draft = artifacts[`draft/${id}`]
        if (!draft || draft.by?.stage !== 'draft') return true
        return stamp(`review/${id}`) >= stamp(`draft/${id}`)
      }
      let changed = 0
      const sweep = (stageId, keep) => {
        const entry = stages[stageId]
        if (!entry?.items) return
        let touched = 0
        for (const [id, status] of Object.entries(entry.items)) {
          // 只纠正假 done：skipped 是「现在做不了」，本来就是诚实的中间态。
          if (status !== 'done' || keep(id)) continue
          entry.items[id] = 'pending'
          touched += 1
        }
        if (touched > 0 && entry.status === 'done') entry.status = 'partial'
        changed += touched
      }
      sweep('review', (id) => reviewedAfterDraft(id))
      sweep('revise', (id) => has(`review/${id}`) && has(`draft/${id}`))
      return changed
    },

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

      // §12 成本模型：固定 7 段（pitch/brief/bible/characters/spine/blurb + 首卷章纲与 opener 摊）
      // + 每章 3.5 次（细纲 1、草稿 1、摘要/正典补丁摊 0.5、审校 1 + 修订摊薄）
      // + 卷纲每卷 1 次。关键性质：每章都是同一份 ≤ contextBudget 的 packet，成本随章数线性增长。
      const perChapter = autoReview ? 3.5 : 2.5
      const calls = Math.ceil(7 + chapters * perChapter + volumePlans)

      const fixedIn = 32000
      const fixedOut = 13700
      const prose = (ratio) => Math.round(wordsPerChapter * ratio)
      // 草稿/修订的输入就是 packet，因此按 contextBudget 估，而不是按章号累加：
      // 每章都是一份 ≤ contextBudget 的包，成本随章数线性增长。
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
          `每章材料是一份固定上限的 packet（${perChapter} 次调用），不随章号增长；` +
          `预计输入约 ${estTokensIn} tokens、输出约 ${estTokensOut} tokens` +
          (autoReview ? '（含自动审校+修订）' : '（不含审校）'),
      }
    },

    exports: {
      markdown: { title: 'Markdown', run: markdownExport },
      epub: { title: 'EPUB', run: epubExport },
      'outline-editor': { title: '编辑审稿单', run: outlineEditorExport },
    },
  }
}

export const novelRecipe = createNovelRecipe()

export { paramsSchema, chaptersOf }
export default novelRecipe
