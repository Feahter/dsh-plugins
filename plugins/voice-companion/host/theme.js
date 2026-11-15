/**
 * Host half of "say one sentence, get a theme".
 *
 * One model call turns an utterance into a theme *patch* (`set` / `css` /
 * `name` / `message`). The patch is validated against the exact same schema the
 * browser applies (`src/client/theme.js`), so the Host can never hand the
 * client a key the client would refuse. Nothing is written to disk: the only
 * side effect of this module is spending one model call, which is why abuse is
 * contained with a rate limiter instead of auth (design doc 4.6).
 */

import { httpError } from './http.js'
import { THEME_VERSION, TOKEN_SCHEMA, sanitizeTheme } from '../src/client/theme.js'

export const MAX_UTTERANCE_CHARS = 200
export const MAX_BASE_BYTES = 8 * 1024
export const MAX_KEEP = 16
export const DESIGN_MAX_TOKENS = 900
export const DESIGN_TEMPERATURE = 0.35
export const DESIGN_TIMEOUT_MS = 20_000
export const RATE_LIMIT_PER_MINUTE = 8
export const RATE_LIMIT_PER_HOUR = 60
export const MAX_IN_FLIGHT = 2

/** The css part names `sanitizeTheme` understands (mirrors `src/client/theme.js`). */
const CSS_PARTS = 'root panel head dot label chip mode gear min start end stage bubble partial receipt sheet field ripple thinkDots core'.split(' ')

/** Token list, grouped by schema family, so it can never drift from the schema. */
const TOKEN_TABLE = (() => {
  /** @type {Map<string, string[]>} */
  const groups = new Map()
  for (const key of Object.keys(TOKEN_SCHEMA)) {
    const group = TOKEN_SCHEMA[key].group
    const keys = groups.get(group) ?? []
    keys.push(key)
    groups.set(group, keys)
  }
  return [...groups].map(([group, keys]) => `${group}: ${keys.join(',')}`).join('\n')
})()

const SYSTEM_PROMPT = `你是语音管家看板的主题设计师。把用户一句话翻译成主题补丁 JSON，只输出 JSON。
可用 token（只允许这些键）：
${TOKEN_TABLE}
规则：
1) 颜色只能 #rrggbb 或 rgba()；尺寸带 px；时长带 s/ms；不写选择器、不写 @、不写 url(。
2) 只写需要改的键。
3) css 只能给这些部件：${CSS_PARTS.join(',')}；值只能是声明（prop:value;）。
4) 暗色主题优先，对比度 ≥ 4.5:1。name ≤ 8 字，message ≤ 20 字。
输出：{"set":{...},"css":{...},"name":"...","message":"..."}`

const FEW_SHOT = [
  {
    user: '改成赛博朋克红黑，霓虹绿边框',
    assistant:
      '{"set":{"board.bgFrom":"#12040a","board.bgTo":"#05030a","board.borderColor":"#39ff88","accent.base":"#ff2a4d","bubble.bg":"rgba(255,42,77,.10)","core.palette.idle":"#ffd9e0,#ff2a4d,#8a0f22"},"css":{"panel":"box-shadow: 0 0 28px rgba(57,255,136,.35)"},"name":"赛博红黑","message":"红黑底，霓虹绿边框"}',
  },
  {
    user: '边框再亮一点，字大一号',
    assistant:
      '{"set":{"board.borderColor":"#66ffa6","bubble.fontSize":"13px","type.size":"14px"},"css":{},"name":"赛博红黑·亮","message":"边框更亮，字号 +1"}',
  },
  {
    user: '做成极简白，玻璃感弱一点',
    assistant:
      '{"set":{"board.bgFrom":"rgba(250,251,255,.92)","board.bgTo":"rgba(232,236,248,.94)","text.primary":"#141a2b","text.secondary":"#4a5570","board.blur":"6px","board.borderColor":"rgba(20,26,43,.10)"},"css":{},"name":"极简白","message":"浅色极简，弱玻璃"}',
  },
]

/**
 * @param {unknown} value
 * @returns {string}
 */
function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncateChars(text, max) {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/**
 * Build the chat-completions messages for one theme design call.
 * @param {object} [input]
 * @param {unknown} [input.utterance]
 * @param {unknown} [input.base] Current theme; shown to the model so relative asks ("再亮一点") have a reference.
 * @param {unknown} [input.keep] Token keys the user pinned; shown and enforced.
 * @returns {Array<{ role: 'system' | 'user' | 'assistant', content: string }>}
 */
export function buildDesignerMessages({ utterance, base, keep } = {}) {
  const text = asTrimmedString(utterance)
  /** @type {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} */
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const example of FEW_SHOT) {
    messages.push({ role: 'user', content: example.user })
    messages.push({ role: 'assistant', content: example.assistant })
  }

  /** @type {string[]} */
  const context = []
  if (base !== undefined && base !== null) {
    let serialized
    try {
      serialized = JSON.stringify(base)
    } catch {
      serialized = ''
    }
    if (serialized !== '') context.push(`当前主题：${serialized}`)
  }
  const pinned = normalizeKeep(keep)
  if (pinned.length > 0) context.push(`不要改这些键：${pinned.join(',')}`)

  messages.push({
    role: 'user',
    content: context.length === 0 ? text : `${context.join('\n')}\n${text}`,
  })
  return messages
}

/**
 * Unwrap a model reply into `{ set, css, name, message }`.
 *
 * Tolerates ```json fences and prose around the object (same strategy as
 * `parseDecision`); returns `null` when no candidate parses as an object.
 * @param {unknown} rawText
 * @returns {{ set: Record<string, unknown>, css: Record<string, unknown>, name: string, message: string } | null}
 */
export function parseThemeReply(rawText) {
  const raw = asTrimmedString(rawText)
  if (raw === '') return null

  /** @type {string[]} */
  const candidates = []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  if (fenced !== null) candidates.push(fenced[1].trim())
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1))
  candidates.push(raw)

  for (const candidate of candidates) {
    let parsed
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!plain(parsed)) continue
    return {
      set: plain(parsed.set) ? parsed.set : {},
      css: plain(parsed.css) ? parsed.css : {},
      name: asTrimmedString(parsed.name),
      message: asTrimmedString(parsed.message),
    }
  }
  return null
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeKeep(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const entry of value) {
    const text = asTrimmedString(entry)
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out.slice(0, MAX_KEEP)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUtterance(value) {
  const text = asTrimmedString(value)
  if (text === '') throw httpError(400, 'invalid', 'utterance 不能为空')
  if (Array.from(text).length > MAX_UTTERANCE_CHARS) {
    throw httpError(400, 'invalid', `utterance 不能超过 ${MAX_UTTERANCE_CHARS} 个字符`)
  }
  return text
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
function normalizeBase(value) {
  if (value === undefined || value === null) return undefined
  if (!plain(value)) throw httpError(400, 'invalid', 'base 必须是一个对象')
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw httpError(400, 'invalid', 'base 无法序列化')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BASE_BYTES) {
    throw httpError(400, 'invalid', `base 不能超过 ${MAX_BASE_BYTES} 字节`)
  }
  return value
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function validateKeep(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw httpError(400, 'invalid', 'keep 必须是数组')
  if (value.length > MAX_KEEP) throw httpError(400, 'invalid', `keep 不能超过 ${MAX_KEEP} 项`)
  return normalizeKeep(value)
}

/**
 * Sliding-window rate limiter, in-process only. A plugin restart resets it,
 * which design doc 4.6 calls acceptable.
 * @param {{ now?: () => number }} [options]
 */
export function createRateLimiter({ now = () => Date.now() } = {}) {
  /** @type {number[]} */
  let minute = []
  /** @type {number[]} */
  let hour = []
  let inFlight = 0

  const reject = () => httpError(429, 'rate-limited', '主题设计请求太频繁，稍后再试')

  function acquire() {
    const current = now()
    minute = minute.filter((at) => at > current - 60_000)
    hour = hour.filter((at) => at > current - 3_600_000)
    if (inFlight >= MAX_IN_FLIGHT) throw reject()
    if (minute.length >= RATE_LIMIT_PER_MINUTE || hour.length >= RATE_LIMIT_PER_HOUR) throw reject()
    minute.push(current)
    hour.push(current)
    inFlight += 1
  }

  function release() {
    if (inFlight > 0) inFlight -= 1
  }

  return {
    acquire,
    release,
    get inFlight() {
      return inFlight
    },
    get minuteCount() {
      return minute.length
    },
    get hourCount() {
      return hour.length
    },
  }
}

const defaultLimiter = createRateLimiter()

/**
 * Validate one model reply and turn it into a patch.
 * @param {NonNullable<ReturnType<typeof parseThemeReply>>} reply
 * @param {{ base?: Record<string, unknown>, keep: string[] }} context
 */
function applyReply(reply, { base, keep }) {
  /** @type {string[]} */
  const dropped = []

  // Host layer only accepts schema keys; anything else is dropped (not an error).
  /** @type {Record<string, unknown>} */
  const tokens = {}
  for (const key of Object.keys(reply.set)) {
    if (!Object.prototype.hasOwnProperty.call(TOKEN_SCHEMA, key)) {
      dropped.push(`token:${key}`)
      continue
    }
    if (keep.includes(key)) continue
    tokens[key] = reply.set[key]
  }

  /** @type {Record<string, unknown>} */
  const css = {}
  for (const part of Object.keys(reply.css)) {
    if (!CSS_PARTS.includes(part)) {
      dropped.push(`css:${part}:unknown`)
      continue
    }
    css[part] = reply.css[part]
  }

  const sanitized = sanitizeTheme({ v: THEME_VERSION, tokens, css })
  for (const entry of sanitized.dropped) dropped.push(entry)

  // `sanitized.theme.tokens` is defaults + accepted patch, so "accepted?" has to
  // be read from `dropped` — value presence alone would smuggle in defaults.
  const rejected = new Set(sanitized.dropped)
  /** @type {Record<string, unknown>} */
  const patchTokens = {}
  for (const key of Object.keys(tokens)) {
    if (rejected.has(`token:${key}`)) continue
    patchTokens[key] = sanitized.theme.tokens[key]
  }
  /** @type {Record<string, unknown>} */
  const patchCss = {}
  for (const part of Object.keys(css)) {
    if (sanitized.theme.css[part] !== undefined) patchCss[part] = sanitized.theme.css[part]
  }

  const fallbackName = base !== undefined && typeof base.name === 'string' ? base.name.trim() : ''
  const named = sanitizeTheme({
    v: THEME_VERSION,
    ...(reply.name === '' && fallbackName === '' ? {} : { name: reply.name || fallbackName }),
    tokens: patchTokens,
    css: patchCss,
  })

  if (Object.keys(patchTokens).length === 0 && Object.keys(patchCss).length === 0 && reply.name === '') {
    // An empty patch is a failure, never a success: applying it would silently
    // leave the theme untouched while telling the user it changed.
    throw httpError(502, 'model-empty-patch', '模型没有给出任何可用的主题改动')
  }

  return {
    theme: { v: THEME_VERSION, name: named.theme.name, tokens: patchTokens, css: patchCss },
    changed: [...Object.keys(patchTokens), ...Object.keys(patchCss).map((part) => `css.${part}`)],
    dropped,
    message: truncateChars(reply.message, 20),
  }
}

/**
 * One utterance -> one sanitized theme patch.
 * @param {object} input
 * @param {{ request: (messages: Array<{ role: string, content: string }>, options?: object) => Promise<{ text: string, model?: string, usage?: { promptTokens?: number, completionTokens?: number } }> }} input.brain
 * @param {unknown} input.utterance
 * @param {unknown} [input.base]
 * @param {unknown} [input.keep]
 * @param {ReturnType<typeof createRateLimiter>} [input.limiter] Test seam; one limiter per Host instance.
 * @returns {Promise<{ theme: { v: number, name: string, tokens: Record<string, unknown>, css: Record<string, unknown> }, changed: string[], dropped: string[], message: string, model: string, usage: { promptTokens: number, completionTokens: number } }>}
 */
export async function designTheme({ brain, utterance, base, keep, limiter } = {}) {
  const text = normalizeUtterance(utterance)
  const currentBase = normalizeBase(base)
  const pinned = validateKeep(keep)
  if (brain === null || typeof brain !== 'object' || typeof brain.request !== 'function') {
    throw httpError(500, 'failed', 'designTheme 需要一个可用的 brain')
  }

  const bucket = limiter ?? defaultLimiter
  bucket.acquire()
  try {
    const reply = await brain.request(buildDesignerMessages({ utterance: text, base: currentBase, keep: pinned }), {
      maxTokens: DESIGN_MAX_TOKENS,
      temperature: DESIGN_TEMPERATURE,
      timeoutMs: DESIGN_TIMEOUT_MS,
    })
    const parsed = parseThemeReply(reply?.text)
    if (parsed === null) throw httpError(502, 'upstream', '模型返回的主题补丁无法解析')
    const applied = applyReply(parsed, { base: currentBase, keep: pinned })
    return {
      ...applied,
      model: typeof reply?.model === 'string' && reply.model !== '' ? reply.model : 'deepseek-flash',
      usage: {
        promptTokens: Number.isFinite(reply?.usage?.promptTokens) ? reply.usage.promptTokens : 0,
        completionTokens: Number.isFinite(reply?.usage?.completionTokens) ? reply.usage.completionTokens : 0,
      },
    }
  } finally {
    bucket.release()
  }
}
