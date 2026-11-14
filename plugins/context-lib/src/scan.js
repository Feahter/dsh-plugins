/**
 * 扫描器：扩展名判定、目录遍历、单文件元数据抽取。
 *
 * 契约见 ../docs/API.md §4。纯函数 + 只读 IO，不碰索引，不修改被扫描文件。
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 单文件内容指纹 / 预览的尺寸上限：> 8MB 只记元数据。 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024

/** 文本文件默认最多读取的字节数。 */
export const TEXT_LIMIT_BYTES = 2 * 1024 * 1024

/** 单次扫描最多处理的候选文件数。 */
export const MAX_SCAN_FILES = 4000

/** 永远跳过的目录名（契约 §4，逐字对齐）。 */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pnpm-store',
  '.Trash',
  'Library',
  'Applications',
  'target',
  'vendor',
  '.idea',
  '.vscode',
])

/** 永远跳过的文件扩展名（契约 §4）。 */
const SKIP_FILE_EXTS = new Set(['log', 'tmp', 'lock', 'pyc'])

/** 扩展名白名单 → kind（契约 §4，逐字对齐）。 */
const EXT_KIND = new Map()
const EXT_MIME = new Map()

function register(kind, mime, exts) {
  for (const ext of exts) {
    EXT_KIND.set(ext, kind)
    EXT_MIME.set(ext, mime)
  }
}

register('doc', 'text/markdown', ['md', 'markdown'])
register('doc', 'text/html', ['html', 'htm', 'xhtml'])
register('doc', 'text/plain', ['txt', 'rst', 'org', 'tex'])
register('doc', 'application/pdf', ['pdf'])
register('doc', 'application/msword', ['doc'])
register('doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx'])
register('doc', 'application/vnd.oasis.opendocument.text', ['odt'])
register('doc', 'application/rtf', ['rtf'])
register('doc', 'application/epub+zip', ['epub'])

register('script', 'text/javascript', ['js', 'mjs', 'cjs'])
register('script', 'text/jsx', ['jsx'])
register('script', 'text/typescript', ['ts'])
register('script', 'text/tsx', ['tsx'])
register('script', 'text/x-python', ['py'])
register('script', 'text/x-shellscript', ['sh', 'bash', 'zsh'])
register('script', 'text/x-ruby', ['rb'])
register('script', 'text/x-go', ['go'])
register('script', 'text/x-rust', ['rs'])
register('script', 'text/x-java', ['java'])
register('script', 'text/x-kotlin', ['kt'])
register('script', 'text/x-c', ['c', 'h'])
register('script', 'text/x-c++', ['cpp', 'hpp'])
register('script', 'text/x-csharp', ['cs'])
register('script', 'text/x-php', ['php'])
register('script', 'text/x-lua', ['lua'])
register('script', 'text/x-perl', ['pl'])
register('script', 'text/x-r', ['r'])
register('script', 'text/x-sql', ['sql'])
register('script', 'text/x-swift', ['swift'])

register('image', 'image/png', ['png'])
register('image', 'image/jpeg', ['jpg', 'jpeg'])
register('image', 'image/gif', ['gif'])
register('image', 'image/webp', ['webp'])
register('image', 'image/svg+xml', ['svg'])
register('image', 'image/heic', ['heic'])
register('image', 'image/bmp', ['bmp'])
register('image', 'image/tiff', ['tiff'])
register('image', 'image/x-icon', ['ico'])
register('image', 'image/avif', ['avif'])

register('data', 'application/json', ['json'])
register('data', 'application/x-ndjson', ['jsonl'])
register('data', 'text/yaml', ['yaml', 'yml'])
register('data', 'application/toml', ['toml'])
register('data', 'text/plain', ['ini'])
register('data', 'text/csv', ['csv'])
register('data', 'text/tab-separated-values', ['tsv'])
register('data', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx'])
register('data', 'application/vnd.ms-excel', ['xls'])
register('data', 'application/vnd.apache.parquet', ['parquet'])
register('data', 'application/x-sqlite3', ['db', 'sqlite'])

export const SUPPORTED_EXTS = new Set(EXT_KIND.keys())

/** 可当 UTF-8 文本读取的扩展名。 */
const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'rst', 'org', 'tex',
  'html', 'htm', 'xhtml',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'sh', 'bash', 'zsh', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua', 'pl', 'r', 'sql', 'swift',
  'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv',
])

const GLOB_CACHE = new Map()

/** 小写扩展名（不带点）；无扩展名 / 点文件返回 ''。 */
export function extOf(file) {
  const ext = path.extname(String(file ?? '')).slice(1).toLowerCase()
  return ext
}

/** 路径 → kind；sessions 目录里的 .jsonl/.json 归为 session。 */
export function classifyKind(absPath) {
  const file = String(absPath ?? '')
  const ext = extOf(file)
  if ((ext === 'jsonl' || ext === 'json') && /(^|[\\/])sessions?([\\/]|$)/i.test(file)) {
    return 'session'
  }
  return EXT_KIND.get(ext) || 'other'
}

/** 扩展名 → MIME；未知应用返回 application/octet-stream。 */
export function mimeForExt(ext) {
  const clean = String(ext ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
  return EXT_MIME.get(clean) || 'application/octet-stream'
}

/** 是否是可读文本文件（按扩展名）。 */
export function isTextFile(file) {
  return TEXT_EXTS.has(extOf(file))
}

function titleFromFileName(file) {
  const base = path.basename(String(file ?? ''))
  const ext = extOf(base)
  const stem = ext ? base.slice(0, base.length - ext.length - 1) : base
  const title = stem.replace(/[-_]+/g, ' ').trim()
  return title || base || '未命名'
}

function countLines(text) {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function splitInlineList(raw) {
  const out = []
  let current = ''
  let quote = ''
  for (const ch of String(raw ?? '')) {
    if (quote) {
      if (ch === quote) quote = ''
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ',') {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out.map((item) => item.trim()).filter(Boolean)
}

function parseFrontmatter(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  const empty = { data: {}, body: source }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (!match) return empty
  const data = {}
  let lastKey = ''
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (pair) {
      lastKey = pair[1].toLowerCase()
      const raw = pair[2].trim()
      if (!raw) data[lastKey] = []
      else if (raw.startsWith('[') && raw.endsWith(']')) data[lastKey] = splitInlineList(raw.slice(1, -1))
      else data[lastKey] = raw.replace(/^["']|["']$/g, '')
      continue
    }
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && lastKey) {
      if (!Array.isArray(data[lastKey])) data[lastKey] = data[lastKey] ? [data[lastKey]] : []
      data[lastKey].push(item[1].trim().replace(/^["']|["']$/g, ''))
    }
  }
  return { data, body: source.slice(match[0].length) }
}

/** frontmatter.tags（数组或逗号分隔字符串）→ 标签数组。 */
export function normalizeTags(value) {
  let list = []
  if (Array.isArray(value)) list = value
  else if (typeof value === 'string') list = value.split(',')
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/^#+/, '').trim()
    if (!tag || out.includes(tag)) continue
    out.push(tag)
  }
  return out
}

function firstHeading(text) {
  const match = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(String(text ?? ''))
  return match ? match[1].trim() : ''
}

function wikiLinks(text) {
  const links = []
  const pattern = /\[\[([^\[\]]+?)\]\]/g
  const source = String(text ?? '')
  let match
  while ((match = pattern.exec(source)) !== null) {
    const target = match[1].split('|')[0].split('#')[0].trim()
    if (target && !links.includes(target)) links.push(target)
    if (links.length >= 100) break
  }
  return links
}

function globToRegExp(pattern) {
  const cached = GLOB_CACHE.get(pattern)
  if (cached) return cached
  let re = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const ch = pattern[index]
    if (ch === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          re += '(?:.*/)?'
          index += 2
        } else {
          re += '.*'
          index += 1
        }
      } else {
        re += '[^/]*'
      }
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      continue
    }
    if ('.+^${}()|[]\\'.includes(ch)) re += `\\${ch}`
    else re += ch
  }
  re += '$'
  const compiled = new RegExp(re)
  GLOB_CACHE.set(pattern, compiled)
  return compiled
}

/** glob 是否匹配相对路径；不含 / 的模式同时匹配 basename。 */
export function matchGlob(relPath, pattern) {
  const rel = String(relPath ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
  const raw = String(pattern ?? '').trim()
  if (!raw) return false
  const clean = raw.replace(/^\.\//, '').replace(/\/$/, '')
  if (!clean) return false
  if (!clean.includes('/')) return globToRegExp(clean).test(rel.split('/').pop() || rel)
  return globToRegExp(clean).test(rel)
}

function matchesAny(relPath, patterns) {
  return patterns.some((pattern) => matchGlob(relPath, pattern))
}

function patternList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim())
  return []
}

/**
 * 递归遍历来源目录。
 * 深度按目录层级计：根目录文件为 0，根下第一层子目录里的文件为 1。
 * 返回 { files, truncated, skipped }；不跟随符号链接。
 */
export async function walkFiles(source, options = {}) {
  const root = typeof source === 'string' ? source : source?.path
  const files = []
  const result = { files, truncated: false, skipped: 0 }
  if (!root) return result

  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Math.max(0, Math.trunc(Number(options.maxDepth))) : 6
  const maxFiles = Number.isFinite(Number(options.maxFiles)) ? Math.max(1, Math.trunc(Number(options.maxFiles))) : MAX_SCAN_FILES
  const hidden = Boolean(options.hidden)
  const include = patternList(options.include)
  const exclude = patternList(options.exclude)
  let stopped = false

  async function visit(dir, depth) {
    if (stopped) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const entry of entries) {
      if (stopped) return
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      const dot = entry.name.startsWith('.')

      if (entry.isSymbolicLink()) {
        if (!entry.isDirectory()) result.skipped += 1
        continue
      }
      if (!hidden && dot) {
        if (entry.isFile()) result.skipped += 1
        continue
      }
      if (entry.isDirectory()) {
        if (depth + 1 > maxDepth) continue
        if (SKIP_DIRS.has(entry.name)) continue
        if (exclude.length && matchesAny(rel, exclude)) continue
        await visit(abs, depth + 1)
        continue
      }
      if (!entry.isFile()) continue

      const ext = extOf(entry.name)
      if (SKIP_FILE_EXTS.has(ext) || !SUPPORTED_EXTS.has(ext)) {
        result.skipped += 1
        continue
      }
      if (include.length && !matchesAny(rel, include)) {
        result.skipped += 1
        continue
      }
      if (exclude.length && matchesAny(rel, exclude)) {
        result.skipped += 1
        continue
      }
      if (files.length >= maxFiles) {
        result.truncated = true
        result.skipped += 1
        stopped = true
        return
      }
      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      files.push({
        path: abs,
        size: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
        ext,
        kind: classifyKind(abs),
      })
      if (files.length >= maxFiles) {
        // 只有真正还有下一个候选文件时才标记截断；先不置位，等循环再遇到文件。
        continue
      }
    }
  }

  await visit(root, 0)
  return result
}

async function hashFile(file) {
  const hash = createHash('sha256')
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024)
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

async function readHead(file, bytes) {
  const limit = Math.max(0, Math.trunc(bytes))
  if (!limit) return Buffer.alloc(0)
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * 抽取单个文件元数据（不含 id / sourceId / 状态等索引字段）。
 * 返回 { path, ext, kind, mime, size, mtimeMs, sha256, title, tags, preview, lines, links, meta }。
 */
export async function inspectFile(file, options = {}) {
  const target = typeof file === 'string' ? file : file?.path
  const maxPreviewChars = Number.isFinite(options.maxPreviewChars) ? Math.max(0, options.maxPreviewChars) : 1200
  const maxTextBytes = Number.isFinite(options.maxTextBytes) ? Math.max(1, options.maxTextBytes) : TEXT_LIMIT_BYTES
  const stat = options.stat && Number.isFinite(options.stat.size)
    ? { size: options.stat.size, mtimeMs: options.stat.mtimeMs }
    : await fs.stat(target)
  const ext = extOf(target)
  const nameTitle = titleFromFileName(target)
  const info = {
    path: target,
    ext,
    kind: classifyKind(target),
    mime: mimeForExt(ext),
    size: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs ?? 0),
    sha256: null,
    title: nameTitle,
    tags: [],
    preview: '',
    lines: null,
    links: [],
    meta: {},
  }

  if (stat.size > MAX_FILE_BYTES) return info

  info.sha256 = await hashFile(target)
  if (!isTextFile(target)) return info

  const toRead = Math.min(stat.size, maxTextBytes)
  const text = (await readHead(target, toRead)).toString('utf8')
  const { data, body } = parseFrontmatter(text)
  const fmTitle = typeof data.title === 'string' ? data.title.trim() : ''
  info.title = (fmTitle || firstHeading(body) || nameTitle).slice(0, 200)
  info.tags = normalizeTags(data.tags)
  info.preview = body.trim().slice(0, maxPreviewChars)
  info.lines = countLines(text)
  info.links = wikiLinks(body)
  if (Object.keys(data).length) info.meta.frontmatter = data
  return info
}

// 兼容别名：store 侧历史上用 kindOf / mimeOf 这两个名字。
export const kindOf = classifyKind
export const mimeOf = mimeForExt
