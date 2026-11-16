/**
 * 预览层：把「本机已有的文档」变成能看的文本或缩略图。
 *
 * 设计原则：
 * - 只用 macOS 自带工具（textutil / qlmanage），不引第三方依赖、不联网；
 * - 转换结果按「源文件路径 + 大小 + mtime」缓存在 <root>/cache/thumbs；
 * - 任何一步失败都降级成 {kind:'none', note}，不让预览错误冒泡成 500。
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** textutil 能读成纯文本的格式（docx/rtf/odt/doc 都是它支持的）。 */
const TEXTUTIL_EXTS = new Set(['doc', 'docx', 'rtf', 'rtfd', 'odt', 'wordml', 'webarchive'])
/** html 自己剥标签，比 textutil 稳（textutil 对无 charset 声明的文件会乱码）。 */
const HTML_EXTS = new Set(['html', 'htm', 'xhtml'])
/** Quick Look 有渲染器、适合出缩略图的格式。 */
const THUMB_EXTS = new Set(['pdf', 'xlsx', 'xls', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'epub'])
/** 直接当图片显示的格式（浏览器原生能解码）。 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])
/** 纯文本 / 代码：走已有的 content 通道，不需要预览层。 */
const PLAIN_EXTS = new Set([
  'md', 'markdown', 'txt', 'rst', 'org', 'tex',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'sh', 'bash', 'zsh', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua', 'pl', 'r', 'sql', 'swift',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv',
])

const MAX_TEXT_CHARS = 20000
const MAX_BUFFER = 8 * 1024 * 1024
const THUMB_SIZE = 1200

const extOf = (file) => path.extname(String(file || '')).slice(1).toLowerCase()

/** 这个条目在面板里应该怎么预览。 */
export function previewKind(entry) {
  if (!entry) return 'none'
  const kind = String(entry.ext || extOf(entry.path || '')).toLowerCase()
  if (entry.kind === 'note') return 'text'
  if (IMAGE_EXTS.has(kind)) return 'image'
  if (HTML_EXTS.has(kind)) return 'text'
  if (TEXTUTIL_EXTS.has(kind)) return 'text'
  if (THUMB_EXTS.has(kind)) return 'thumb'
  if (PLAIN_EXTS.has(kind)) return 'text'
  return 'none'
}

/** Entry ids minted by the store; an index file is untrusted input. */
const SAFE_ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Resolve `relative` under `base`; null when it escapes or is empty. */
function resolveInside(base, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null
  const root = path.resolve(base)
  const target = path.resolve(root, relative)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

/** `target` 是否严格位于 `base` 之内（linked 条目只允许读已注册来源里的文件）。 */
function isInsideBase(base, target) {
  if (typeof base !== 'string' || !base || typeof target !== 'string' || !target) return false
  if (!path.isAbsolute(target)) return false
  const rel = path.relative(path.resolve(base), path.resolve(target))
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/**
 * 条目 → 磁盘上的真实文件（note / linked / blob 三种 storage）。
 * `sources` 是已注册来源的路径数组：给了就要求 linked path 落在其中某个之内
 * （store 已在加载索引时丢弃越界条目，这里是读取层的第二道闸）。
 */
export function entryFile(entry, root, sources) {
  if (!entry) return null
  if (entry.storage === 'note') {
    return SAFE_ENTRY_ID.test(String(entry.id ?? '')) ? path.join(root, 'notes', `${entry.id}.md`) : null
  }
  if (entry.storage === 'linked') {
    const target = entry.path
    if (!target) return null
    if (Array.isArray(sources)) {
      const roots = sources.map((source) => (typeof source === 'string' ? source : source?.path)).filter(Boolean)
      if (!roots.some((base) => isInsideBase(base, target))) return null
    }
    return target
  }
  if (entry.storage === 'blob' && entry.blob) return resolveInside(path.join(root, 'blobs'), entry.blob)
  return null
}

function run(command, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: MAX_BUFFER, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** HTML → 可读纯文本（去脚本、去标签、解常见实体）。 */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3(9|4);/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractWithTextutil(file) {
  const out = await run('textutil', ['-convert', 'txt', '-stdout', file], { timeout: 20000 })
  return String(out || '').trim()
}

/**
 * 文本预览。返回 {kind:'text', text, truncated, note?} 或 {kind:'none', note}。
 */
export async function previewText(entry, root, { maxChars = MAX_TEXT_CHARS, sources } = {}) {
  const file = entryFile(entry, root, sources)
  const kind = previewKind(entry)
  if (kind !== 'text') return { kind: 'none', note: '这个格式没有文本预览，试试缩略图。' }
  let text = ''
  try {
    const ext = String(entry.ext || '').toLowerCase()
    if (entry.storage === 'note' || PLAIN_EXTS.has(ext)) {
      text = await fs.readFile(file, 'utf8')
    } else if (HTML_EXTS.has(ext)) {
      text = htmlToText(await fs.readFile(file, 'utf8'))
    } else {
      text = await extractWithTextutil(file)
    }
  } catch (error) {
    return { kind: 'none', note: `无法转换：${error && error.message ? error.message : error}` }
  }
  const truncated = text.length > maxChars
  return {
    kind: 'text',
    text: truncated ? `${text.slice(0, maxChars)}\n\n…（已截断）` : text,
    chars: text.length,
    truncated,
    note: TEXTUTIL_EXTS.has(String(entry.ext || '').toLowerCase()) ? '经系统 textutil 转成纯文本' : undefined,
  }
}

function thumbCacheKey(file, stat) {
  return crypto
    .createHash('sha1')
    .update(`${file}:${stat.size}:${stat.mtimeMs}:${THUMB_SIZE}`)
    .digest('hex')
}

/**
 * Quick Look 缩略图。返回 {kind:'thumb', path, cached} 或 {kind:'none', note}。
 */
export async function previewThumb(entry, root, { sources } = {}) {
  const file = entryFile(entry, root, sources)
  if (!file) return { kind: 'none', note: '这条没有原文件。' }
  try {
    const stat = await fs.stat(file)
    const cacheDir = path.join(root, 'cache', 'thumbs')
    const target = path.join(cacheDir, `${thumbCacheKey(file, stat)}.png`)
    try {
      const cached = await fs.stat(target)
      if (cached.size > 0) return { kind: 'thumb', path: target, cached: true }
    } catch {
      // 未命中，继续生成
    }
    await fs.mkdir(cacheDir, { recursive: true })
    const tmpDir = await fs.mkdtemp(path.join(root, 'cache', 'tmp-'))
    try {
      await new Promise((resolve, reject) => {
        execFile('qlmanage', ['-t', '-s', String(THUMB_SIZE), '-o', tmpDir, file], { timeout: 25000 }, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      const produced = (await fs.readdir(tmpDir)).find((name) => name.endsWith('.png'))
      if (!produced) return { kind: 'none', note: 'Quick Look 没有生成缩略图。' }
      await fs.rename(path.join(tmpDir, produced), target)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
    return { kind: 'thumb', path: target, cached: false }
  } catch (error) {
    return { kind: 'none', note: `无法生成缩略图：${error && error.message ? error.message : error}` }
  }
}

/** 统一入口：面板调一次就知道该渲染什么。 */
export async function preview(entry, root, { maxChars = MAX_TEXT_CHARS, sources } = {}) {
  const kind = previewKind(entry)
  if (kind === 'image') return { kind: 'image' }
  if (kind === 'text') return previewText(entry, root, { maxChars, sources })
  if (kind === 'thumb') return previewThumb(entry, root, { sources })
  return { kind: 'none', note: '暂不支持这种格式的预览。' }
}
