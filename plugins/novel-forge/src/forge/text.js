/**
 * 纯文本工具。无 I/O、无业务词汇。
 */

import { ForgeError } from './errors.js'

export const TRUNCATE_MARK = '…（已截断）'

const KEY_CHARS = /^[A-Za-z0-9_\-/.]+$/
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu

/**
 * 校验 artifact key：相对路径、无 `..`、无反斜杠、字符集受限。
 * @param {string} key
 * @returns {string}
 */
export function safeKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new ForgeError('BAD_PARAMS', '产物 key 必须是非空字符串')
  }
  if (key.length > 240) {
    throw new ForgeError('BAD_PARAMS', `产物 key 过长（${key.length}）`, { key })
  }
  if (key.startsWith('/') || key.startsWith('\\') || key.includes('\\')) {
    throw new ForgeError('BAD_PARAMS', `产物 key 不允许绝对路径或反斜杠：${key}`, { key })
  }
  if (!KEY_CHARS.test(key)) {
    throw new ForgeError('BAD_PARAMS', `产物 key 含非法字符：${key}`, { key })
  }
  const segments = key.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new ForgeError('BAD_PARAMS', `产物 key 含非法路径段：${key}`, { key })
    }
  }
  // `.versions` 是产物历史归档目录：放行会让人用 `.versions/x.1` 覆盖任意产物的旧版本。
  if (segments[0] === '.versions') {
    throw new ForgeError('BAD_PARAMS', `产物 key 不允许写入保留目录：${key}`, { key })
  }
  return key
}

/**
 * 按点路径取嵌套值。缺失返回 undefined。
 * @param {unknown} obj
 * @param {string} path
 */
export function dotGet(obj, path) {
  if (path === undefined || path === null || path === '') return obj
  const parts = String(path).split('.').filter((p) => p !== '')
  let cur = obj
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

/**
 * 截断到 maxChars 以内（含省略标记），maxChars <= 0 时返回空串。
 * @param {string} text
 * @param {number} maxChars
 */
export function truncate(text, maxChars = 0) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  const max = Math.max(0, Number(maxChars) || 0)
  if (s.length <= max) return s
  if (max <= TRUNCATE_MARK.length) return TRUNCATE_MARK.slice(0, max)
  return s.slice(0, max - TRUNCATE_MARK.length) + TRUNCATE_MARK
}

export const fit = truncate

/** 中文字符数（CJK 统一表意文字 + 扩展 A + 兼容区）。 */
export function countCjk(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  const matches = s.match(CJK)
  return matches ? matches.length : 0
}

/** 粗略 token 估算：中文约 1.6 字/token，英文约 4 字符/token。 */
export function estimateTokens(chars) {
  const n = Math.max(0, Number(chars) || 0)
  return Math.ceil(n / 1.6)
}

const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/g

/**
 * 扫出所有「括号配平」的顶层片段。模型常在 JSON 前面写一段带大括号的思考，
 * 首尾括号截取会从错误的 { 开始，配平扫描能跳过那段噪声。
 * 字符串里的括号与转义不参与配平。
 */
function balancedSpans(raw, limit = 12) {
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
    if (ch === '"') { inString = true; continue }
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
    if (depth === 0 && /[^\s,;]/.test(ch)) {
      // 顶层出现非括号内容：说明前面的片段不是 JSON，重置
      start = -1
    }
  }
  return spans
}

/** 常见的手写 JSON 毛病：尾逗号、// 与块注释、中文引号、单引号键。 */
function repairJson(text) {
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
    if (ch === '"') { inString = true; out += ch; continue }
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
      // 尾逗号：只在字符串外、后面紧跟 } 或 ] 时删掉
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j += 1
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += ch
  }
  return out
}

/**
 * 从模型输出里提取 JSON：整体 → 代码围栏 → 配平片段 → 修复版。
 * 真实模型（尤其推理模型）常把思考写在 JSON 前面，或留尾逗号/注释；
 * 每一次解析失败都等于把整段 prompt 的输入费扔掉，所以这里尽量抢救。
 * 全部失败抛 LLM_PARSE（调用方可补 raw）。
 * @param {string} text
 */
export function extractJson(text) {
  if (typeof text !== 'string') {
    throw new ForgeError('LLM_PARSE', '模型输出不是文本')
  }
  const raw = text.trim()
  if (!raw) throw new ForgeError('LLM_PARSE', '模型输出为空')

  /** @type {string[]} */
  const candidates = [raw]
  for (const fenced of raw.matchAll(FENCE)) {
    const body = fenced[1]?.trim()
    if (body) candidates.push(body)
  }
  candidates.push(...balancedSpans(raw))
  candidates.push(...balancedSpans(repairJson(raw)))

  const seen = new Set()
  for (const candidate of candidates) {
    const source = candidate.trim()
    if (!source || seen.has(source)) continue
    seen.add(source)
    try {
      return JSON.parse(source)
    } catch {
      const repaired = repairJson(source)
      if (repaired !== source) {
        try {
          return JSON.parse(repaired)
        } catch {
          // 继续尝试下一种
        }
      }
    }
  }
  throw new ForgeError('LLM_PARSE', '无法从模型输出中解析 JSON')
}

/** 生成宽松的 slug：保留中文与字母数字，其余折叠为 `-`。 */
export function slugify(text, fallback = 'artifact') {
  const s = String(text ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return s || fallback
}
