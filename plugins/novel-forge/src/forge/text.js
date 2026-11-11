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

const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/

/**
 * 从模型输出里提取 JSON：整体解析 → 剥代码围栏 → 首尾括号截取。
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
  const fenced = raw.match(FENCE)
  if (fenced && fenced[1] && fenced[1].trim()) candidates.push(fenced[1].trim())

  const brace = raw.indexOf('{')
  const bracket = raw.indexOf('[')
  let start = -1
  if (brace >= 0 && (bracket < 0 || brace < bracket)) start = brace
  else if (bracket >= 0) start = bracket
  if (start >= 0) {
    const open = raw[start]
    const close = open === '{' ? '}' : ']'
    const end = raw.lastIndexOf(close)
    if (end > start) candidates.push(raw.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 继续尝试下一种
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
