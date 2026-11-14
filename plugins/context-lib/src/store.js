/**
 * 资源库数据层：索引、检索、写入、回收站、扫描。
 *
 * 契约见 ../docs/API.md。设计要点：
 * - index.json 是唯一真相，原子写（tmp + fsync + rename）+ .bak 回退；
 * - 扫描来的文件是 linked（只记路径，不动原文件），本库笔记是 note（正文落 notes/）；
 * - 所有写操作走进程内 promise 队列；扫描额外用 scan.lock 做跨进程互斥，
 *   进程内并发 scan 直接抛 library-busy；
 * - 检索在内存里做，索引上限 maxEntries（默认 2 万）。
 */

import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  SKIP_DIRS,
  classifyKind,
  extOf,
  inspectFile,
  isTextFile,
  mimeForExt,
  walkFiles,
} from './scan.js'

export { SKIP_DIRS, classifyKind }

export function mimeFor(ext) {
  return mimeForExt(ext)
}

const INDEX_VERSION = 1
const ID_BYTES = 6
const MAX_TITLE = 200
const MAX_CONTENT_BYTES = 2 * 1024 * 1024
const MAX_COLLECTION = 40
const MAX_TAGS = 24
const MAX_TAG = 32
const MAX_FILES = 4000
const DEFAULT_DEPTH = 6
const LOCK_TTL_MS = 10 * 60 * 1000
const KINDS = new Set(['doc', 'script', 'image', 'data', 'session', 'note', 'other'])

export class LibraryError extends Error {
  constructor(message, { code = 'library-error', hint = '' } = {}) {
    super(message)
    this.name = 'LibraryError'
    this.code = code
    if (hint) this.hint = hint
  }
}

// ------------------------------------------------------------------ helpers

function expandHome(input) {
  if (typeof input !== 'string') return ''
  const value = input.trim()
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

/** 根目录：展开 ~，默认 ~/.dsh/context-lib，返回绝对路径。 */
export function resolveRoot({ rootDir } = {}) {
  const chosen = expandHome(rootDir) || path.join(os.homedir(), '.dsh', 'context-lib')
  return path.resolve(chosen)
}

function newId() {
  return `cl_${randomBytes(ID_BYTES).toString('hex')}`
}

function nowIso() {
  return new Date().toISOString()
}

function clampText(text, max) {
  if (typeof text !== 'string') return ''
  return text.length <= max ? text : text.slice(0, max)
}

function sanitizeCollection(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_COLLECTION)
  return text || 'inbox'
}

function sanitizeTags(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/^#+/, '').trim().slice(0, MAX_TAG)
    if (!tag) continue
    if (!out.includes(tag)) out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

function validateTags(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new LibraryError('tags 必须是字符串数组。', { code: 'invalid-argument' })
  }
  return sanitizeTags(value)
}

function countLines(text) {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function previewText(content, max) {
  return clampText(String(content ?? '').trim(), max)
}

function sha256(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
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

function sortCounts(map, keyName) {
  return [...map.entries()]
    .map(([name, count]) => ({ [keyName]: name, count }))
    .sort((a, b) => b.count - a.count || String(a[keyName]).localeCompare(String(b[keyName])))
}

function collectCounts(values) {
  const map = new Map()
  for (const value of values) map.set(value, (map.get(value) || 0) + 1)
  return map
}

function slugify(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'source'
}

function defaultSources() {
  const home = os.homedir()
  const seeds = [
    ['workspace', '工作区', path.join(home, 'Documents', 'deepseek-harness', 'default-workspace'), 4, []],
    ['docs', '文档', path.join(home, 'Documents'), 3, ['node_modules', '.git']],
    ['dsh', 'DSH', path.join(home, '.dsh'), 3, []],
  ]
  return seeds.map(([id, name, sourcePath, depth, exclude]) => ({
    id,
    name,
    path: path.resolve(sourcePath),
    kind: 'mixed',
    include: [],
    exclude,
    hidden: false,
    depth,
    lastScanAt: null,
    lastResult: null,
  }))
}

function normalizeSource(raw, index = 0) {
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `source-${index + 1}`
  const sourcePath = typeof raw?.path === 'string' && raw.path ? path.resolve(expandHome(raw.path)) : ''
  return {
    id,
    name: clampText(String(raw?.name ?? id).trim(), 80) || id,
    path: sourcePath,
    kind: typeof raw?.kind === 'string' && raw.kind.trim() ? raw.kind.trim() : 'mixed',
    include: Array.isArray(raw?.include) ? raw.include.filter((item) => typeof item === 'string') : [],
    exclude: Array.isArray(raw?.exclude) ? raw.exclude.filter((item) => typeof item === 'string') : [],
    hidden: Boolean(raw?.hidden),
    depth: Number.isFinite(Number(raw?.depth)) ? Math.min(20, Math.max(0, Math.trunc(Number(raw.depth)))) : DEFAULT_DEPTH,
    lastScanAt: typeof raw?.lastScanAt === 'string' ? raw.lastScanAt : null,
    lastResult: raw?.lastResult && typeof raw.lastResult === 'object' ? raw.lastResult : null,
  }
}

function normalizeEntry(id, raw) {
  const stamp = nowIso()
  const ext = typeof raw?.ext === 'string' ? raw.ext.toLowerCase().replace(/^\./, '') : (raw?.path ? extOf(raw.path) : 'md')
  const kind = KINDS.has(raw?.kind) ? raw.kind : 'other'
  const hasPath = typeof raw?.path === 'string' && raw.path
  const storage = raw?.storage === 'note' || raw?.storage === 'blob' || raw?.storage === 'linked'
    ? raw.storage
    : hasPath ? 'linked' : 'note'
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : id,
    title: clampText(String(raw?.title ?? ''), MAX_TITLE),
    kind,
    ext,
    mime: typeof raw?.mime === 'string' && raw.mime ? raw.mime : mimeFor(ext),
    collection: sanitizeCollection(raw?.collection),
    tags: sanitizeTags(raw?.tags),
    sourceId: raw?.sourceId == null ? null : String(raw.sourceId),
    storage,
    path: hasPath ? raw.path : null,
    blob: typeof raw?.blob === 'string' ? raw.blob : null,
    size: Number.isFinite(Number(raw?.size)) ? Number(raw.size) : 0,
    mtimeMs: Number.isFinite(Number(raw?.mtimeMs)) ? Number(raw.mtimeMs) : 0,
    sha256: typeof raw?.sha256 === 'string' ? raw.sha256 : null,
    status: raw?.status === 'trashed' ? 'trashed' : 'active',
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt ? raw.createdAt : stamp,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : stamp,
    trashedAt: typeof raw?.trashedAt === 'string' ? raw.trashedAt : null,
    preview: typeof raw?.preview === 'string' ? raw.preview : '',
    lines: raw?.lines === null || Number.isFinite(Number(raw?.lines)) ? (raw.lines === null ? null : Number(raw.lines)) : null,
    links: Array.isArray(raw?.links) ? raw.links.filter((item) => typeof item === 'string') : [],
    meta: raw?.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {},
    notes: typeof raw?.notes === 'string' ? raw.notes : '',
  }
}

function cloneEntry(entry) {
  return {
    ...entry,
    tags: [...entry.tags],
    links: [...entry.links],
    meta: { ...entry.meta },
  }
}

function makeSnippet(preview, q) {
  const text = collapse(preview)
  if (!text) return ''
  const tokens = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    const index = text.toLowerCase().indexOf(token)
    if (index < 0) continue
    const start = Math.max(0, index - 80)
    const end = Math.min(text.length, index + 80)
    return text.slice(start, end)
  }
  return text.slice(0, 160)
}

function scoreEntry(entry, tokens, rawQuery) {
  const title = String(entry.title ?? '').toLowerCase()
  const tags = entry.tags.join(' ').toLowerCase()
  const collection = String(entry.collection ?? '').toLowerCase()
  const pathText = String(entry.path ?? '').toLowerCase()
  const preview = String(entry.preview ?? '').toLowerCase()
  let score = 0
  for (const token of tokens) {
    let hit = false
    if (title.includes(token)) {
      score += 6
      hit = true
    }
    if (tags.includes(token)) {
      score += 4
      hit = true
    }
    if (collection.includes(token)) {
      score += 2
      hit = true
    }
    if (pathText.includes(token)) {
      score += 2
      hit = true
    }
    if (preview.includes(token)) {
      score += 1
      hit = true
    }
    if (!hit) return null
  }
  const whole = String(rawQuery ?? '').trim().toLowerCase()
  if (whole && /[\u4e00-\u9fff]/.test(whole)) {
    if (title.includes(whole) || tags.includes(whole) || preview.includes(whole)) score += 3
  }
  return score
}

function summaryOf(entry, q) {
  return {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    ext: entry.ext,
    collection: entry.collection,
    tags: [...entry.tags],
    sourceId: entry.sourceId,
    storage: entry.storage,
    path: entry.storage === 'linked' ? entry.path : null,
    size: entry.size,
    status: entry.status,
    updatedAt: entry.updatedAt,
    snippet: q ? makeSnippet(entry.preview, q) : collapse(entry.preview).slice(0, 160),
  }
}

function collectionForKind(kind) {
  if (kind === 'image') return 'images'
  if (kind === 'script') return 'scripts'
  return 'inbox'
}

// ------------------------------------------------------------------ Library

export class Library {
  constructor(root, options = {}) {
    this.root = root
    this.indexPath = path.join(root, 'index.json')
    this.backupPath = `${this.indexPath}.bak`
    this.sourcesPath = path.join(root, 'sources.json')
    this.notesDir = path.join(root, 'notes')
    this.blobsDir = path.join(root, 'blobs')
    this.lockPath = path.join(root, 'scan.lock')
    this.maxPreviewChars = Number.isFinite(options.maxPreviewChars) ? Math.max(0, options.maxPreviewChars) : 1200
    this.maxTextBytes = Number.isFinite(options.maxTextBytes) ? Math.max(1, options.maxTextBytes) : 2 * 1024 * 1024
    this.maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, options.maxEntries) : 20000
    this.index = { version: INDEX_VERSION, updatedAt: null, entries: {} }
    this.sourceList = []
    this._queue = Promise.resolve()
    this._initPromise = null
    this._scanning = false
    // 外部进程（另一个 dsh 实例 / 直接跑 store API 的脚本）改过磁盘时，用它判断要不要重新读。
    this._diskStamps = { index: null, sources: null }
  }

  // -------------------------------------------------------------- lifecycle

  init() {
    if (!this._initPromise) {
      this._initPromise = this._init().catch((error) => {
        this._initPromise = null
        throw error
      })
    }
    return this._initPromise
  }

  async _init() {
    await fs.mkdir(this.root, { recursive: true })
    await fs.mkdir(this.notesDir, { recursive: true })
    await fs.mkdir(this.blobsDir, { recursive: true })
    const loaded = await this._loadIndex()
    this.index = loaded.index
    if (loaded.repaired && loaded.existed) await this._saveIndex()
    const sources = await this._loadSources()
    this.sourceList = sources.sources
    if (sources.changed) await this._saveSources()
    this._diskStamps.index = await this._stampOf(this.indexPath)
    this._diskStamps.sources = await this._stampOf(this.sourcesPath)
    return this
  }


  _parseIndex(text) {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      throw new Error('index.json 结构不正确')
    }
    const entries = {}
    let repaired = false
    for (const [id, raw] of Object.entries(parsed.entries)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        repaired = true
        continue
      }
      const normalized = normalizeEntry(id, raw)
      if (JSON.stringify(normalized) !== JSON.stringify(raw)) repaired = true
      entries[id] = normalized
    }
    return {
      index: { version: INDEX_VERSION, updatedAt: parsed.updatedAt ?? null, entries },
      repaired,
    }
  }

  async _loadIndex() {
    const fresh = { version: INDEX_VERSION, updatedAt: null, entries: {} }
    let text = null
    let existed = false
    try {
      text = await fs.readFile(this.indexPath, 'utf8')
      existed = true
    } catch (error) {
      if (error.code !== 'ENOENT') text = null
    }
    if (text !== null) {
      try {
        const parsed = this._parseIndex(text)
        return { ...parsed, existed: true }
      } catch (error) {
        try {
          const backup = this._parseIndex(await fs.readFile(this.backupPath, 'utf8'))
          console.warn(`[context-lib] index.json 损坏，已从 .bak 恢复：${error.message}`)
          return { ...backup, repaired: true, existed: false }
        } catch {
          const aside = `${this.indexPath}.corrupt-${Date.now()}`
          await fs.rename(this.indexPath, aside).catch(() => {})
          console.warn(`[context-lib] index.json 无法解析，已移到 ${aside}，从空索引起步。`)
          return { index: fresh, repaired: false, existed: false }
        }
      }
    }
    return { index: fresh, repaired: false, existed }
  }

  async _loadSources() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.sourcesPath, 'utf8'))
      if (!parsed || !Array.isArray(parsed.sources)) throw new Error('sources.json 结构不正确')
      const normalized = parsed.sources.map((source, index) => normalizeSource(source, index))
      return { sources: normalized, changed: JSON.stringify(normalized) !== JSON.stringify(parsed.sources) }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await fs.rename(this.sourcesPath, `${this.sourcesPath}.corrupt-${Date.now()}`).catch(() => {})
      }
      return { sources: defaultSources(), changed: true }
    }
  }

  async _writeFileAtomic(file, content) {
    const dir = path.dirname(file)
    await fs.mkdir(dir, { recursive: true })
    const tmp = path.join(dir, `.tmp-${path.basename(file)}-${process.pid}-${randomBytes(3).toString('hex')}`)
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(tmp, file)
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw error
    }
  }

  async _stampOf(file) {
    try {
      const stat = await fs.stat(file)
      return `${stat.size}:${stat.mtimeMs}`
    } catch {
      return null
    }
  }

  /**
   * 磁盘被别人改过就重新加载，避免本进程拿着旧快照把外部写入覆盖掉。
   * 只在串行队列里调用，读操作看到的是同一份索引。
   */
  async _syncFromDisk() {
    if (!this.index) return
    const indexStamp = await this._stampOf(this.indexPath)
    const sourcesStamp = await this._stampOf(this.sourcesPath)
    if (indexStamp !== this._diskStamps.index) {
      const loaded = await this._loadIndex()
      this.index = loaded.index
      this._diskStamps.index = indexStamp
    }
    if (sourcesStamp !== this._diskStamps.sources) {
      const sources = await this._loadSources()
      this.sourceList = sources.sources
      this._diskStamps.sources = sourcesStamp
    }
  }

  async _saveIndex() {
    this.index.updatedAt = nowIso()
    const text = `${JSON.stringify(this.index, null, 2)}\n`
    await fs.copyFile(this.indexPath, this.backupPath).catch(() => {})
    await this._writeFileAtomic(this.indexPath, text)
    this._diskStamps.index = await this._stampOf(this.indexPath)
  }

  async _saveSources() {
    const text = `${JSON.stringify({ version: INDEX_VERSION, sources: this.sourceList }, null, 2)}\n`
    await this._writeFileAtomic(this.sourcesPath, text)
    this._diskStamps.sources = await this._stampOf(this.sourcesPath)
  }

  _run(fn) {
    const guarded = async () => {
      await this._syncFromDisk()
      return fn()
    }
    const next = this._queue.then(guarded, guarded)
    this._queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  // ------------------------------------------------------------------ reads

  async get(id) {
    await this.init()
    await this._syncFromDisk()
    const entry = this.index.entries[id]
    return entry ? cloneEntry(entry) : null
  }

  async stats() {
    await this.init()
    await this._syncFromDisk()
    const all = Object.values(this.index.entries)
    const active = all.filter((entry) => entry.status === 'active')
    const byKind = {}
    const collections = new Map()
    const tags = new Map()
    let bytes = 0
    for (const entry of active) {
      byKind[entry.kind] = (byKind[entry.kind] || 0) + 1
      collections.set(entry.collection, (collections.get(entry.collection) || 0) + 1)
      for (const tag of entry.tags) tags.set(tag, (tags.get(tag) || 0) + 1)
      bytes += entry.size || 0
    }
    return {
      root: this.root,
      counts: {
        active: active.length,
        trashed: all.length - active.length,
        notes: active.filter((entry) => entry.storage === 'note').length,
        byKind,
      },
      collections: sortCounts(collections, 'name'),
      tags: sortCounts(tags, 'name'),
      sources: this.sourceList.map((source) => ({
        id: source.id,
        name: source.name,
        path: source.path,
        count: active.filter((entry) => entry.sourceId === source.id).length,
        lastScanAt: source.lastScanAt,
      })),
      bytes,
      updatedAt: this.index.updatedAt,
    }
  }

  async list(query = {}) {
    await this.init()
    await this._syncFromDisk()
    const q = typeof query.q === 'string' ? query.q : ''
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
    let base = Object.values(this.index.entries)
    const status = query.status || 'active'
    if (status === 'active' || status === 'trashed') base = base.filter((entry) => entry.status === status)

    const matched = []
    for (const entry of base) {
      if (!tokens.length) {
        matched.push({ entry, score: 0 })
        continue
      }
      const score = scoreEntry(entry, tokens, q)
      if (score !== null) matched.push({ entry, score })
    }

    const facets = {
      kinds: sortCounts(collectCounts(matched.map(({ entry }) => entry.kind)), 'kind'),
      collections: sortCounts(collectCounts(matched.map(({ entry }) => entry.collection)), 'name'),
      tags: sortCounts(collectCounts(matched.flatMap(({ entry }) => entry.tags)), 'name'),
    }

    let filtered = matched
    if (query.kind) filtered = filtered.filter(({ entry }) => entry.kind === query.kind)
    if (query.collection) filtered = filtered.filter(({ entry }) => entry.collection === query.collection)
    if (query.tag) filtered = filtered.filter(({ entry }) => entry.tags.includes(query.tag))
    if (query.source) filtered = filtered.filter(({ entry }) => entry.sourceId === query.source)

    const sort = query.sort || 'relevance'
    filtered.sort((a, b) => {
      if (sort === 'title') return a.entry.title.localeCompare(b.entry.title, 'zh-Hans-CN')
      if (sort === 'size') return (b.entry.size || 0) - (a.entry.size || 0)
      if (sort === 'relevance' && tokens.length && b.score !== a.score) return b.score - a.score
      return String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt))
    })

    const total = filtered.length
    const limitValue = Number(query.limit)
    const limit = Number.isFinite(limitValue) ? Math.min(200, Math.max(1, Math.trunc(limitValue))) : 50
    const offsetValue = Number(query.offset)
    const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.trunc(offsetValue)) : 0
    const page = filtered.slice(offset, offset + limit)
    return {
      total,
      limit,
      offset,
      items: page.map(({ entry }) => summaryOf(entry, tokens.length ? q : '')),
      facets,
    }
  }

  async listTrash({ limit = 50, offset = 0 } = {}) {
    const listed = await this.list({ status: 'trashed', sort: 'updated', limit, offset })
    return { total: listed.total, items: listed.items }
  }

  async readText(id, options = {}) {
    await this.init()
    await this._syncFromDisk()
    const entry = this.index.entries[id]
    if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
    const file = this._contentFile(entry)
    if (!file) {
      return { id, title: entry.title, text: '', truncated: false, totalLines: 0, bytes: 0, binary: true }
    }
    let stat
    try {
      stat = await fs.stat(file)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new LibraryError(`条目 ${id} 的正文文件已不存在：${file}`, {
          code: 'item-not-found',
          hint: 'linked 条目的原文件可能被移走；重新扫描或删除该条目。',
        })
      }
      throw error
    }

    const textual = entry.storage === 'note' || isTextFile(entry.path || entry.blob || '')
    if (!textual) {
      return { id, title: entry.title, text: '', truncated: false, totalLines: 0, bytes: stat.size, binary: true }
    }

    const readBytes = Math.min(stat.size, this.maxTextBytes)
    const handle = await fs.open(file, 'r')
    let source = ''
    try {
      const buffer = Buffer.alloc(readBytes)
      if (readBytes > 0) await handle.read(buffer, 0, readBytes, 0)
      source = buffer.toString('utf8')
    } finally {
      await handle.close()
    }
    const sourceTruncated = stat.size > readBytes
    const lines = source ? source.split(/\r?\n/) : []
    const totalLines = lines.length

    const firstValue = Number(options.startLine)
    const lastValue = Number(options.endLine)
    const first = Number.isFinite(firstValue) ? Math.max(1, Math.trunc(firstValue)) : 1
    const last = Number.isFinite(lastValue) ? Math.min(totalLines, Math.trunc(lastValue)) : totalLines
    let text = ''
    if (last >= first && totalLines > 0) text = lines.slice(first - 1, last).join('\n')

    const maxValue = Number(options.maxChars)
    const maxChars = Number.isFinite(maxValue) ? Math.max(1, Math.trunc(maxValue)) : 20000
    const truncated = sourceTruncated || first > 1 || last < totalLines || text.length > maxChars
    text = clampText(text, maxChars)
    return {
      id,
      title: entry.title,
      text,
      truncated,
      totalLines,
      bytes: Buffer.byteLength(text, 'utf8'),
    }
  }

  _contentFile(entry) {
    if (entry.storage === 'note') return path.join(this.notesDir, `${entry.id}.md`)
    if (entry.storage === 'linked') return entry.path || null
    if (entry.storage === 'blob' && entry.blob) return path.join(this.blobsDir, entry.blob)
    return null
  }

  // ---------------------------------------------------------------- writes

  async create(input = {}) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      if (Object.keys(this.index.entries).length >= this.maxEntries) {
        throw new LibraryError(`条目数已达上限 ${this.maxEntries}。`, { code: 'invalid-argument' })
      }
      if (typeof input.title !== 'string' || !input.title.trim()) {
        throw new LibraryError('标题不能为空。', { code: 'invalid-argument' })
      }
      if (input.content !== undefined && input.content !== null && typeof input.content !== 'string') {
        throw new LibraryError('content 必须是字符串。', { code: 'invalid-argument' })
      }
      const kind = input.kind === undefined || input.kind === null ? 'note' : String(input.kind)
      if (!KINDS.has(kind)) {
        throw new LibraryError(`未知 kind：${kind}`, { code: 'invalid-argument' })
      }
      const content = input.content ?? ''
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
        throw new LibraryError('正文超过 2MB。', {
          code: 'invalid-argument',
          hint: '把长文拆成多条，或把文件留在原目录用扫描登记。',
        })
      }
      const id = newId()
      const stamp = nowIso()
      const entry = {
        id,
        title: clampText(input.title.trim(), MAX_TITLE),
        kind,
        ext: 'md',
        mime: 'text/markdown',
        collection: sanitizeCollection(input.collection),
        tags: sanitizeTags(input.tags),
        sourceId: null,
        storage: 'note',
        path: null,
        blob: null,
        size: Buffer.byteLength(content, 'utf8'),
        mtimeMs: Date.now(),
        sha256: sha256(content),
        status: 'active',
        createdAt: stamp,
        updatedAt: stamp,
        trashedAt: null,
        preview: previewText(content, this.maxPreviewChars),
        lines: countLines(content),
        links: wikiLinks(content),
        meta: input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta : {},
        notes: clampText(String(input.notes ?? ''), 4000),
      }
      await this._writeFileAtomic(path.join(this.notesDir, `${id}.md`), content)
      this.index.entries[id] = entry
      await this._saveIndex()
      return cloneEntry(entry)
    })
  }

  async update(id, patch = {}) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      const entry = this.index.entries[id]
      if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new LibraryError('patch 必须是对象。', { code: 'invalid-argument' })
      }
      if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) {
        throw new LibraryError('标题不能为空。', { code: 'invalid-argument' })
      }
      if (patch.collection !== undefined && typeof patch.collection !== 'string') {
        throw new LibraryError('collection 必须是字符串。', { code: 'invalid-argument' })
      }
      if (patch.notes !== undefined && typeof patch.notes !== 'string') {
        throw new LibraryError('notes 必须是字符串。', { code: 'invalid-argument' })
      }
      const tags = validateTags(patch.tags)
      let content = null
      if (patch.content !== undefined) {
        if (typeof patch.content !== 'string') {
          throw new LibraryError('content 必须是字符串。', { code: 'invalid-argument' })
        }
        if (entry.storage !== 'note') {
          throw new LibraryError('只有库内笔记可以改正文；扫描来的文件请直接改原文件再扫描。', {
            code: 'invalid-argument',
          })
        }
        if (Buffer.byteLength(patch.content, 'utf8') > MAX_CONTENT_BYTES) {
          throw new LibraryError('正文超过 2MB。', { code: 'invalid-argument' })
        }
        content = patch.content
      }

      if (patch.title !== undefined) entry.title = clampText(patch.title.trim(), MAX_TITLE)
      if (tags !== undefined) entry.tags = tags
      if (patch.collection !== undefined) entry.collection = sanitizeCollection(patch.collection)
      if (patch.notes !== undefined) entry.notes = clampText(patch.notes, 4000)
      if (content !== null) {
        entry.size = Buffer.byteLength(content, 'utf8')
        entry.sha256 = sha256(content)
        entry.preview = previewText(content, this.maxPreviewChars)
        entry.lines = countLines(content)
        entry.links = wikiLinks(content)
        entry.mtimeMs = Date.now()
        await this._writeFileAtomic(path.join(this.notesDir, `${entry.id}.md`), content)
      }
      entry.updatedAt = nowIso()
      await this._saveIndex()
      return cloneEntry(entry)
    })
  }

  async remove(id) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      const entry = this.index.entries[id]
      if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
      if (entry.status !== 'trashed') {
        entry.status = 'trashed'
        entry.trashedAt = nowIso()
        entry.updatedAt = entry.trashedAt
        await this._saveIndex()
      }
      return cloneEntry(entry)
    })
  }

  async restore(id) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      const entry = this.index.entries[id]
      if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
      entry.status = 'active'
      entry.trashedAt = null
      entry.updatedAt = nowIso()
      await this._saveIndex()
      return cloneEntry(entry)
    })
  }

  async purge(id) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      const entry = this.index.entries[id]
      if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
      if (entry.storage === 'note') {
        await fs.rm(path.join(this.notesDir, `${entry.id}.md`), { force: true })
      } else if (entry.storage === 'blob' && entry.blob) {
        await fs.rm(path.join(this.blobsDir, entry.blob), { force: true })
      }
      // linked：只删索引，绝不删除用户原文件。
      delete this.index.entries[id]
      await this._saveIndex()
      return { id }
    })
  }

  // --------------------------------------------------------------- sources

  async sources() {
    await this.init()
    await this._syncFromDisk()
    const result = []
    for (const source of this.sourceList) {
      const stat = await fs.stat(source.path).catch(() => null)
      result.push({
        id: source.id,
        name: source.name,
        path: source.path,
        kind: source.kind,
        include: [...source.include],
        exclude: [...source.exclude],
        hidden: source.hidden,
        depth: source.depth,
        lastScanAt: source.lastScanAt,
        count: Object.values(this.index.entries).filter(
          (entry) => entry.sourceId === source.id && entry.status === 'active',
        ).length,
        missing: !stat || !stat.isDirectory(),
      })
    }
    return result
  }

  async addSource(input = {}) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      const resolved = path.resolve(expandHome(typeof input.path === 'string' ? input.path : ''))
      const stat = await fs.stat(resolved).catch(() => null)
      if (!stat || !stat.isDirectory()) {
        throw new LibraryError(`目录不存在或不是目录：${resolved}`, { code: 'invalid-source' })
      }
      if (input.include !== undefined && !Array.isArray(input.include)) {
        throw new LibraryError('include 必须是字符串数组。', { code: 'invalid-argument' })
      }
      if (input.exclude !== undefined && !Array.isArray(input.exclude)) {
        throw new LibraryError('exclude 必须是字符串数组。', { code: 'invalid-argument' })
      }

      const existing = this.sourceList.find((source) => path.resolve(source.path) === resolved)
      const withCount = (source) => ({
        ...normalizeSource(source),
        count: Object.values(this.index.entries).filter(
          (entry) => entry.sourceId === source.id && entry.status === 'active',
        ).length,
        missing: false,
      })
      if (existing) return withCount(existing)

      const rawName = typeof input.name === 'string' && input.name.trim()
        ? input.name.trim()
        : path.basename(resolved) || 'source'
      const base = slugify(rawName)
      let id = base
      let suffix = 2
      while (this.sourceList.some((source) => source.id === id)) {
        id = `${base}-${suffix}`
        suffix += 1
      }
      const depthValue = Number(input.depth)
      const source = {
        id,
        name: clampText(rawName, 80),
        path: resolved,
        kind: typeof input.kind === 'string' && input.kind.trim() ? input.kind.trim() : 'mixed',
        include: input.include ?? [],
        exclude: input.exclude ?? [],
        hidden: Boolean(input.hidden),
        depth: Number.isFinite(depthValue) ? Math.min(20, Math.max(0, Math.trunc(depthValue))) : DEFAULT_DEPTH,
        lastScanAt: null,
        lastResult: null,
      }
      this.sourceList.push(source)
      await this._saveSources()
      return { ...source, count: 0, missing: false }
    })
  }

  async removeSource(id) {
    return this._run(async () => {
      await this.init()
    await this._syncFromDisk()
      const source = this.sourceList.find((item) => item.id === id)
      if (!source) throw new LibraryError(`来源 ${id} 不存在。`, { code: 'source-not-found' })
      for (const [entryId, entry] of Object.entries(this.index.entries)) {
        if (entry.sourceId === id) delete this.index.entries[entryId]
      }
      this.sourceList = this.sourceList.filter((item) => item.id !== id)
      await this._saveSources()
      await this._saveIndex()
      return { id }
    })
  }

  // ------------------------------------------------------------------- scan

  async _acquireScanLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await fs.writeFile(
          this.lockPath,
          JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
          { flag: 'wx' },
        )
        return
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const stat = await fs.stat(this.lockPath).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          await fs.rm(this.lockPath, { force: true })
          continue
        }
        throw new LibraryError('另一个扫描正在进行。', {
          code: 'library-busy',
          hint: '等它结束后再试；确认没有扫描时可以删除 scan.lock。',
        })
      }
    }
    throw new LibraryError('无法获取扫描锁。', { code: 'library-busy' })
  }

  async _releaseScanLock() {
    await fs.rm(this.lockPath, { force: true }).catch(() => {})
  }

  async scan({ sourceId, force = false, onProgress } = {}) {
    if (this._scanning) {
      throw new LibraryError('另一个扫描正在进行。', {
        code: 'library-busy',
        hint: '等当前扫描结束后再试。',
      })
    }
    this._scanning = true
    try {
      return await this._run(() => this._scanQueued({ sourceId, force, onProgress }))
    } finally {
      this._scanning = false
    }
  }

  async _scanQueued({ sourceId, force, onProgress }) {
    await this.init()
    await this._syncFromDisk()
    const startedAt = Date.now()
    let targets
    if (sourceId !== undefined && sourceId !== null && sourceId !== '') {
      targets = this.sourceList.filter((source) => source.id === sourceId)
      if (!targets.length) throw new LibraryError(`来源 ${sourceId} 不存在。`, { code: 'source-not-found' })
    } else {
      targets = [...this.sourceList]
    }
    if (!targets.length) {
      return {
        sourceId: null,
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        skipped: 0,
        errors: [],
        durationMs: 0,
      }
    }

    await this._acquireScanLock()
    try {
      const results = []
      for (const source of targets) {
        results.push(await this._scanOne(source, { force, onProgress }))
      }
      await this._saveSources()
      await this._saveIndex()
      if (targets.length === 1 && sourceId) return results[0]
      const aggregate = {
        sourceId: null,
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        skipped: 0,
        errors: [],
        durationMs: 0,
        results,
      }
      for (const result of results) {
        aggregate.added += result.added
        aggregate.updated += result.updated
        aggregate.removed += result.removed
        aggregate.unchanged += result.unchanged
        aggregate.skipped += result.skipped
        aggregate.errors.push(...result.errors)
      }
      aggregate.errors = aggregate.errors.slice(0, 20)
      aggregate.durationMs = Date.now() - startedAt
      return aggregate
    } finally {
      await this._releaseScanLock()
    }
  }

  async _scanOne(source, { force, onProgress }) {
    const result = {
      sourceId: source.id,
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
      durationMs: 0,
    }
    const startedAt = Date.now()
    const stat = await fs.stat(source.path).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      result.errors.push({ path: source.path, message: '来源目录不存在或不是目录。' })
      source.lastScanAt = nowIso()
      source.lastResult = { added: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0, errors: 1 }
      result.durationMs = Date.now() - startedAt
      return result
    }

    const walked = await walkFiles(source, {
      maxDepth: source.depth,
      maxFiles: MAX_FILES,
      hidden: source.hidden,
      include: source.include,
      exclude: source.exclude,
    })
    result.skipped += walked.skipped
    if (walked.truncated) {
      result.skipped += 1
      result.errors.push({
        path: source.path,
        message: `达到单次扫描文件上限 ${MAX_FILES}，其余文件本次跳过。`,
      })
    }

    const existingByPath = new Map()
    for (const entry of Object.values(this.index.entries)) {
      if (entry.sourceId === source.id && entry.storage === 'linked' && entry.path) {
        existingByPath.set(entry.path, entry)
      }
    }

    const seen = new Set()
    const total = walked.files.length
    let capReported = false
    const report = (extra = {}) => {
      if (typeof onProgress !== 'function') return
      try {
        onProgress({
          sourceId: source.id,
          processed: seen.size,
          total,
          added: result.added,
          updated: result.updated,
          unchanged: result.unchanged,
          removed: result.removed,
          skipped: result.skipped,
          ...extra,
        })
      } catch {
        // 进度回调异常不影响扫描。
      }
    }
    report({ phase: 'start' })

    for (const file of walked.files) {
      seen.add(file.path)
      const existing = existingByPath.get(file.path)
      if (existing && !force && existing.size === file.size && Math.floor(existing.mtimeMs) === file.mtimeMs) {
        result.unchanged += 1
        report()
        continue
      }
      try {
        const described = await inspectFile(file, {
          stat: { size: file.size, mtimeMs: file.mtimeMs },
          maxPreviewChars: this.maxPreviewChars,
          maxTextBytes: this.maxTextBytes,
        })
        if (existing) {
          const sameSha = typeof existing.sha256 === 'string'
            && typeof described.sha256 === 'string'
            && existing.sha256 === described.sha256
          existing.title = described.title
          existing.kind = described.kind
          existing.ext = described.ext
          existing.mime = described.mime
          existing.path = described.path
          existing.size = described.size
          existing.mtimeMs = described.mtimeMs
          existing.sha256 = described.sha256
          existing.preview = described.preview
          existing.lines = described.lines
          existing.links = described.links
          existing.tags = described.tags.length ? sanitizeTags(described.tags) : existing.tags
          existing.meta = described.meta
          existing.updatedAt = nowIso()
          if (sameSha) result.unchanged += 1
          else result.updated += 1
        } else {
          if (Object.keys(this.index.entries).length >= this.maxEntries) {
            result.skipped += 1
            if (!capReported) {
              capReported = true
              result.errors.push({
                path: file.path,
                message: `索引条目数已达上限 ${this.maxEntries}，新文件本次跳过。`,
              })
            }
            report()
            continue
          }
          const stamp = nowIso()
          const entry = normalizeEntry(newId(), {
            title: described.title,
            kind: described.kind,
            ext: described.ext,
            mime: described.mime,
            collection: collectionForKind(described.kind),
            tags: sanitizeTags(described.tags),
            sourceId: source.id,
            storage: 'linked',
            path: described.path,
            size: described.size,
            mtimeMs: described.mtimeMs,
            sha256: described.sha256,
            status: 'active',
            createdAt: stamp,
            updatedAt: stamp,
            trashedAt: null,
            preview: described.preview,
            lines: described.lines,
            links: described.links,
            meta: described.meta,
            notes: '',
          })
          this.index.entries[entry.id] = entry
          result.added += 1
        }
      } catch (error) {
        if (result.errors.length < 20) {
          result.errors.push({ path: file.path, message: error?.message || String(error) })
        }
      }
      report()
    }

    for (const [filePath, entry] of existingByPath) {
      if (seen.has(filePath)) continue
      delete this.index.entries[entry.id]
      result.removed += 1
    }

    source.lastScanAt = nowIso()
    source.lastResult = {
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      unchanged: result.unchanged,
      skipped: result.skipped,
      errors: result.errors.length,
    }
    result.durationMs = Date.now() - startedAt
    report({ phase: 'done' })
    return result
  }

  // ------------------------------------------------------------------- pack

  async pack(collection, { limit = 20, maxChars = 12000 } = {}) {
    await this.init()
    await this._syncFromDisk()
    const name = sanitizeCollection(collection)
    const limitValue = Number(limit)
    const maxValue = Number(maxChars)
    const take = Number.isFinite(limitValue) ? Math.min(100, Math.max(1, Math.trunc(limitValue))) : 20
    const budget = Number.isFinite(maxValue) ? Math.max(1, Math.trunc(maxValue)) : 12000
    const listed = await this.list({ collection: name, status: 'active', sort: 'updated', limit: take, offset: 0 })
    const chunks = []
    let used = 0
    let truncated = false
    for (const item of listed.items) {
      const entry = this.index.entries[item.id]
      if (!entry) continue
      const chunk = `## ${entry.title}\n${entry.preview || ''}`.trimEnd()
      const separator = chunks.length ? '\n\n---\n\n' : ''
      if (used + separator.length + chunk.length > budget) {
        truncated = true
        break
      }
      chunks.push(chunk)
      used += separator.length + chunk.length
      if (chunks.length >= take) break
    }
    let text = chunks.join('\n\n---\n\n')
    if (truncated) {
      const marker = `\n\n…（已截断，共 ${listed.total} 条）`
      if (text.length + marker.length <= budget) {
        text += marker
      } else {
        text = text.slice(0, Math.max(0, budget - marker.length)) + marker
      }
    }
    return { collection: name, total: listed.total, text }
  }
}

export async function createLibrary(root, options = {}) {
  const rootDir = typeof root === 'string' ? root : root?.rootDir ?? root?.path
  return new Library(resolveRoot({ rootDir }), options)
}
