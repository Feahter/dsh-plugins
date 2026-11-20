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
/**
 * Every id this store creates is `cl_<hex>`; loading an index that carries some
 * other id (a hand-edited file, a merge from another tool) must not let that id
 * steer a filesystem path. `notes/<id>.md` and `blobs/<blob>` are joined below.
 */
const SAFE_ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function isSafeEntryId(value) {
  return typeof value === 'string' && SAFE_ENTRY_ID.test(value)
}

/** Resolve `relative` under `base`; null when it escapes or is empty. */
function resolveInside(base, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null
  const root = path.resolve(base)
  const target = path.resolve(root, relative)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

/**
 * `target` 是否严格位于 `base` 之内。
 * 只用于 linked 条目：扫描器写进索引的路径是 `来源目录 + 相对路径` 拼出来的
 * 绝对路径，所以这里按字面解析，不做 realpath（与写入形态保持一致）。
 */
function isInsideBase(base, target) {
  if (typeof base !== 'string' || !base || typeof target !== 'string' || !target) return false
  if (!path.isAbsolute(target)) return false
  const root = path.resolve(base)
  const rel = path.relative(root, path.resolve(target))
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

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

/** hybrid 的 snippet：按「原文 → term → 分词变体」顺序找第一个命中位置。 */
function makeHybridSnippet(preview, analysis) {
  const text = collapse(preview)
  if (!text) return ''
  const probes = [analysis.raw, ...analysis.terms.map((term) => term.term), ...analysis.variants]
  const lower = text.toLowerCase()
  for (const probe of probes) {
    if (!probe || probe.length < 2) continue
    const index = lower.indexOf(probe)
    if (index < 0) continue
    return text.slice(Math.max(0, index - 80), Math.min(text.length, index + 80))
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

// ------------------------------------------------------- hybrid search
//
// 检索分两段，避免为每个 query 全量分词 3862 条正文：
// 1) 粗扫：每条 entry 缓存一条「检索串」——正文原样（CJK 子串命中）+
//    拉丁词用 \u0001 包起来（整词命中，避免 js 命中 json）。在这条串上算
//    候选（仍要求每个 query term 至少一个变体命中，保持 AND）和 BM25 的 df。
// 2) 精算：只对候选条目分词（title/meta/body 三字段 tf），算 BM25；分词结果
//    进 this._tokenCache（key 是 id + updatedAt），宽查询第二次起不再分词。
//
// 排序分 = weights.phrase * 短语分 + weights.bm25 * BM25 分；同分按 id 升序，
// 保证同数据同 query 两次结果完全一致。

const LATIN_MARK = '\u0001'
const SEARCH_BM25_K1 = 1.2
const SEARCH_BM25_B = Object.freeze({ title: 0.5, meta: 0.5, body: 0.75 })
const SEARCH_TOKEN_CACHE_SIZE = 3000
// 行号只对返回的这一页找。索引里的 preview 只取正文前 1200 字符，所以命中行
// 基本都在文件头部；读前 64KB 足够，也避免一次 query 读几 MB。
const LINE_SCAN_BYTES = 64 * 1024
const SEARCH_FIELDS = Object.freeze(['title', 'meta', 'body'])
const DEFAULT_SEARCH_WEIGHTS = Object.freeze({
  phrase: 3,
  bm25: 1,
  fieldBoost: Object.freeze({ title: 2, meta: 1.2, body: 1 }),
  phraseField: Object.freeze({ title: 4, tags: 3, path: 2, body: 1 }),
})

function isCjkCode(code) {
  return (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0xac00 && code <= 0xd7af)
}

function containsCjk(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (isCjkCode(text.charCodeAt(index))) return true
  }
  return false
}

function isAsciiWordCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isLatinRunCode(code) {
  return isAsciiWordCode(code) || code === 95 /* _ */ || code === 45 /* - */ || code === 46 /* . */
}

/** 把一段拉丁字母 run 按 camelCase / 缩写边界切开，输出小写词（长度 >=2）。 */
function pushLatinWords(out, source, start, end) {
  if (end - start < 2) return
  let wordStart = start
  for (let cursor = start + 1; cursor <= end; cursor += 1) {
    const previous = source.charCodeAt(cursor - 1)
    const current = cursor < end ? source.charCodeAt(cursor) : -1
    const previousLower = previous >= 97 && previous <= 122
    const previousUpper = previous >= 65 && previous <= 90
    const currentUpper = current >= 65 && current <= 90
    const camelBreak = previousLower && currentUpper
    const acronymBreak = previousUpper && currentUpper
      && cursor + 1 < end
      && source.charCodeAt(cursor + 1) >= 97
      && source.charCodeAt(cursor + 1) <= 122
    if (camelBreak || acronymBreak) {
      if (cursor - wordStart >= 2) out.push(source.slice(wordStart, cursor).toLowerCase())
      wordStart = cursor
    }
  }
  if (end - wordStart >= 2) out.push(source.slice(wordStart, end).toLowerCase())
}

/**
 * 分词：CJK 按 bigram（长度 2 的整词只取一次；2<长度<=8 额外保留整词），
 * 拉丁按 `_ - .` 与 camelCase 拆词。两字以上才进词表，减少噪声。
 */
function tokenizeSearchText(text) {
  const out = []
  if (typeof text !== 'string' || !text) return out
  const source = text.normalize('NFKC')
  let index = 0
  while (index < source.length) {
    const code = source.charCodeAt(index)
    if (isCjkCode(code)) {
      let end = index + 1
      while (end < source.length && isCjkCode(source.charCodeAt(end))) end += 1
      const runLength = end - index
      if (runLength === 1) out.push(source.slice(index, end))
      else {
        for (let cursor = index; cursor + 1 < end; cursor += 1) {
          out.push(source.slice(cursor, cursor + 2))
        }
        if (runLength > 2 && runLength <= 8) out.push(source.slice(index, end))
      }
      index = end
      continue
    }
    if (isAsciiWordCode(code)) {
      let end = index + 1
      while (end < source.length && isLatinRunCode(source.charCodeAt(end))) end += 1
      let start = index
      for (let cursor = index; cursor <= end; cursor += 1) {
        const next = cursor < end ? source.charCodeAt(cursor) : -1
        if (cursor === end || !isAsciiWordCode(next)) {
          pushLatinWords(out, source, start, cursor)
          start = cursor + 1
        }
      }
      index = end
      continue
    }
    index += 1
  }
  return out
}

/** 把一段拉丁 run 的整词、分隔符片段、camelCase 片段都写入检索串（重复无害）。 */
function appendLatinMarks(chunks, run) {
  const lower = run.toLowerCase()
  chunks.push(LATIN_MARK, lower, LATIN_MARK)
  let start = 0
  for (let cursor = 0; cursor <= run.length; cursor += 1) {
    const code = cursor < run.length ? run.charCodeAt(cursor) : -1
    if (cursor < run.length && code !== 95 && code !== 45 && code !== 46) continue
    if (cursor - start >= 2) {
      const piece = run.slice(start, cursor).toLowerCase()
      if (piece !== lower) chunks.push(LATIN_MARK, piece, LATIN_MARK)
      const words = []
      pushLatinWords(words, run, start, cursor)
      for (const word of words) {
        if (word !== lower && word !== piece) chunks.push(LATIN_MARK, word, LATIN_MARK)
      }
    }
    start = cursor + 1
  }
}

/**
 * 一条 entry 的检索串，拆成两段：
 * - text：原文字段 + 小写（CJK 子串匹配、混合词匹配用）；
 * - latin：`\u0001整词\u0001` 串（拉丁整词匹配用，避免 js 命中 json）。
 * 两段都只在第一次查询时建，之后挂在 _haystackCache 上。
 */
function buildSearchHaystack(entry) {
  const textChunks = []
  const latinChunks = []
  const parts = [entry.title, entry.tags.join(' '), entry.collection, entry.path || '', entry.preview]
  for (const part of parts) {
    const source = String(part ?? '').normalize('NFKC')
    let last = 0
    let index = 0
    while (index < source.length) {
      if (!isAsciiWordCode(source.charCodeAt(index))) {
        index += 1
        continue
      }
      let end = index + 1
      while (end < source.length && isLatinRunCode(source.charCodeAt(end))) end += 1
      textChunks.push(source.slice(last, index))
      appendLatinMarks(latinChunks, source.slice(index, end))
      index = end
      last = end
    }
    textChunks.push(source.slice(last))
    textChunks.push('\n')
  }
  return { text: textChunks.join('').toLowerCase(), latin: latinChunks.join('') }
}

/** query 原文 → 每个空白 term 的变体（全局去重，供 df 与 BM25 共用）。 */
function analyzeQuery(rawQuery) {
  const raw = String(rawQuery ?? '').normalize('NFKC').trim()
  const variants = []
  const variantIndex = new Map()
  const intern = (value) => {
    if (variantIndex.has(value)) return variantIndex.get(value)
    const index = variants.length
    variants.push(value)
    variantIndex.set(value, index)
    return index
  }
  // 注意：camelCase 必须在原文上切，先 toLowerCase 会丢掉 safeStorage 的边界。
  const terms = raw.split(/\s+/).filter(Boolean).map((piece) => {
    const term = piece.toLowerCase()
    const indexes = []
    const seen = new Set()
    for (const token of tokenizeSearchText(piece)) {
      if (seen.has(token)) continue
      seen.add(token)
      indexes.push(intern(token))
    }
    // 分词已经拆出多个词时不再额外保留整串（safeStorage / context_lib 的整串
    // 对候选筛选没有增益，只会多扫一遍 3862 条）。分词无结果时兜底成整串。
    if (!indexes.length) indexes.push(intern(term))
    // 拉丁 camel/snake/kebab 拆出来的多个词必须全部命中（safeStorage 不能只靠
    // 一个 storage 就召回）；CJK 的 bigram 仍是任一命中（「热 更新」只有「更新」）。
    const matchAll = indexes.length > 1 && !containsCjk(piece) && /[A-Za-z0-9]/.test(piece)
    return { term, variants: indexes, matchAll }
  })
  return {
    raw: raw.toLowerCase().replace(/\s+/g, ' '),
    terms,
    variants,
    needles: variants.map((variant) => {
      // 单字符拉丁词不进 latin 词表（最少 2 字），退回 text 子串匹配。
      if (containsCjk(variant) || variant.length < 2) return { field: 'text', value: variant }
      return { field: 'latin', value: `${LATIN_MARK}${variant}${LATIN_MARK}` }
    }),
  }
}

function mergeSearchWeights(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
  const overrideFieldBoost = override.fieldBoost && typeof override.fieldBoost === 'object' ? override.fieldBoost : {}
  const overridePhraseField = override.phraseField && typeof override.phraseField === 'object' ? override.phraseField : {}
  return {
    phrase: number(override.phrase, base.phrase),
    bm25: number(override.bm25, base.bm25),
    fieldBoost: {
      title: number(overrideFieldBoost.title, base.fieldBoost.title),
      meta: number(overrideFieldBoost.meta, base.fieldBoost.meta),
      body: number(overrideFieldBoost.body, base.fieldBoost.body),
    },
    phraseField: {
      title: number(overridePhraseField.title, base.phraseField.title),
      tags: number(overridePhraseField.tags, base.phraseField.tags),
      path: number(overridePhraseField.path, base.phraseField.path),
      body: number(overridePhraseField.body, base.phraseField.body),
    },
  }
}

function tokenCounts(tokens) {
  const counts = new Map()
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1)
  return counts
}

function buildSearchTokenRecord(entry) {
  const title = tokenizeSearchText(entry.title)
  const meta = tokenizeSearchText(`${entry.tags.join(' ')} ${entry.collection} ${entry.path || ''}`)
  const body = tokenizeSearchText(entry.preview)
  return {
    title: tokenCounts(title),
    meta: tokenCounts(meta),
    body: tokenCounts(body),
    titleLength: title.length,
    metaLength: meta.length,
    bodyLength: body.length,
  }
}

function roundScore(value) {
  return Math.round(value * 1e6) / 1e6
}

/** 以固定并发跑 map，避免一页 200 条时同时打开太多文件。 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function summaryOf(entry, q, extras) {
  const item = {
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
  if (extras) Object.assign(item, extras)
  return item
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
    // 单次扫描文件上限：默认 MAX_FILES；选项只为测试能造小场景，不改变生产语义。
    this.maxFiles = Number.isFinite(options.maxFiles) ? Math.max(1, Math.trunc(options.maxFiles)) : MAX_FILES
    this.index = { version: INDEX_VERSION, updatedAt: null, entries: {} }
    this.sourceList = []
    this._queue = Promise.resolve()
    this._initPromise = null
    this._initialized = false
    this._scanning = false
    // 外部进程（另一个 dsh 实例 / 直接跑 store API 的脚本）改过磁盘时，用它判断要不要重新读。
    this._diskStamps = { index: null, sources: null }
    // 混合检索缓存：检索串按 id+updatedAt 缓存；分词只缓存真正命中的条目（LRU 上限防膨胀）。
    this.searchWeights = mergeSearchWeights(DEFAULT_SEARCH_WEIGHTS, options.searchWeights)
    this.maxSearchTokenCache = Number.isFinite(options.searchTokenCacheSize)
      ? Math.max(16, Math.trunc(options.searchTokenCacheSize))
      : SEARCH_TOKEN_CACHE_SIZE
    this._haystackCache = new Map()
    this._tokenCache = new Map()
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
    // Sources load first: linked entries are only accepted when their path sits
    // inside a registered source, so the allow-list must exist before the index
    // is parsed (otherwise every linked entry would look out-of-bounds).
    const sources = await this._loadSources()
    this.sourceList = sources.sources
    if (sources.changed) await this._saveSources()
    const loaded = await this._loadIndex()
    this.index = loaded.index
    // Normalization is kept in memory. Only dropped entries require a startup write.
    if (loaded.existed && loaded.dropped.length) await this._saveIndex()
    this._diskStamps.index = await this._stampOf(this.indexPath)
    this._diskStamps.sources = await this._stampOf(this.sourcesPath)
    this._initialized = true
    return this
  }


  _parseIndex(text) {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      throw new Error('index.json 结构不正确')
    }
    const entries = {}
    const dropped = []
    const kept = []
    for (const [id, raw] of Object.entries(parsed.entries)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        dropped.push({ id, reason: '条目结构不是对象' })
        continue
      }
      const normalized = normalizeEntry(id, raw)
      if (!isSafeEntryId(id) || !isSafeEntryId(normalized.id)) {
        // Never expose an entry whose id would resolve outside notes/ or blobs/
        // (or collide with a path separator).
        dropped.push({ id, reason: 'id 不在安全字符集内' })
        continue
      }
      if (normalized.id !== id) {
        // 键只是查找索引，磁盘路径用的是 entry.id（notes/<entry.id>.md 等），
        // 所以键与 id 不一致不构成越界风险。真实库里确实有这类历史条目
        // （同一文件分两批扫描过，键与 id 各自都是合法 id）：保留它，按原键收录，
        // 否则下一次加载会连同索引项与手工标签一起丢掉。
        kept.push({ id, entryId: normalized.id })
      }
      if (normalized.storage === 'linked') {
        // index.json is untrusted input: a hand-edited `{storage:'linked',
        // path:'~/.ssh/id_rsa'}` would otherwise let readText/raw serve any file
        // on the machine. 扫描产出的 linked 路径天然落在其来源目录内。
        const reason = this.linkedPathReason(normalized.path)
        if (reason) {
          dropped.push({ id, reason })
          continue
        }
      }
      entries[id] = normalized
    }
    if (dropped.length) {
      // One aggregate warn per load: a tampered index can drop many entries and
      // a per-entry log would flood the host output.
      const head = dropped.slice(0, 8).map((item) => `${item.id}（${item.reason}）`).join('、')
      const rest = dropped.length > 8 ? ` 等共 ${dropped.length} 条` : ''
      console.warn(`[context-lib] index.json 加载时丢弃了 ${dropped.length} 条不符合规则的条目：${head}${rest}`)
    }
    if (kept.length) {
      // 只是键与条目 id 不一致，条目本身已保留；提示一次便于排查历史数据的来源。
      console.warn(`[context-lib] index.json 有 ${kept.length} 条条目的索引键与自身 id 不一致，已按原键保留（不是数据丢失）`)
    }
    return {
      index: { version: INDEX_VERSION, updatedAt: parsed.updatedAt ?? null, entries },
      dropped,
      kept,
    }
  }

  /**
   * linked 条目的 path 必须落在某个已注册来源目录之内。
   * 返回 null 表示合法，否则返回可诊断的原因（用于 warn 与丢弃）。
   */
  linkedPathReason(entryPath) {
    if (typeof entryPath !== 'string' || !entryPath) return 'linked 条目缺少 path'
    if (!path.isAbsolute(entryPath)) return 'linked path 不是绝对路径'
    const roots = this.sourceList.map((source) => source?.path).filter(Boolean)
    if (!roots.length) return '没有任何已注册来源'
    if (!roots.some((root) => isInsideBase(root, entryPath))) return 'linked path 不在任何已注册来源目录内'
    return null
  }

  async _loadIndex() {
    const fresh = { version: INDEX_VERSION, updatedAt: null, entries: {} }
    let text = null
    let existed = false
    try {
      text = await fs.readFile(this.indexPath, 'utf8')
      existed = true
    } catch (error) {
      // A missing file is a first run; any other failure (EACCES, EMFILE,
      // EISDIR) must be reported. Falling through to an empty index would let
      // the next write replace a perfectly good index.json with almost nothing.
      if (error.code !== 'ENOENT') throw error
      text = null
    }
    if (text !== null) {
      try {
        const parsed = this._parseIndex(text)
        return { ...parsed, existed: true }
      } catch (error) {
        try {
          const backup = this._parseIndex(await fs.readFile(this.backupPath, 'utf8'))
          console.warn(`[context-lib] index.json 损坏，已从 .bak 恢复：${error.message}`)
          return { ...backup, existed: false }
        } catch {
          const aside = `${this.indexPath}.corrupt-${Date.now()}`
          await fs.rename(this.indexPath, aside).catch(() => {})
          console.warn(`[context-lib] index.json 无法解析，已移到 ${aside}，从空索引起步。`)
          return { index: fresh, dropped: [], existed: false }
        }
      }
    }
    return { index: fresh, dropped: [], existed }
  }

  async _loadSources() {
    let text
    try {
      text = await fs.readFile(this.sourcesPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { sources: defaultSources(), changed: true }
      // EACCES/EMFILE/etc.: do not rename or replace the file we merely failed
      // to read — the next save would persist defaults over the user's sources.
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(text)
      if (!parsed || !Array.isArray(parsed.sources)) throw new Error('sources.json 结构不正确')
    } catch {
      // The bytes are corrupt rather than unreadable: keep them beside the new
      // file for inspection, then start from the defaults.
      await fs.rename(this.sourcesPath, `${this.sourcesPath}.corrupt-${Date.now()}`).catch(() => {})
      return { sources: defaultSources(), changed: true }
    }
    const normalized = parsed.sources.map((source, index) => normalizeSource(source, index))
    return { sources: normalized, changed: JSON.stringify(normalized) !== JSON.stringify(parsed.sources) }
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
    // init() 负责第一次加载。未初始化时先不要在这里重载：那时 sourceList 还是
    // 空表，linked 条目的来源校验会把扫描来的记录误判成越界（虽然 init 随后
    // 会重载纠正，但会刷一条误导性的 warn）。
    if (!this._initialized) return
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

  // ------------------------------------------------------------ hybrid search

  _searchHaystack(entry) {
    const key = `${entry.id}\u0000${entry.updatedAt}`
    const cached = this._haystackCache.get(key)
    if (cached !== undefined) return cached
    const haystack = buildSearchHaystack(entry)
    if (this._haystackCache.size >= this.maxEntries + 1000) this._haystackCache.clear()
    this._haystackCache.set(key, haystack)
    return haystack
  }

  _searchTokens(entry) {
    const key = `${entry.id}\u0000${entry.updatedAt}`
    const cached = this._tokenCache.get(key)
    if (cached) {
      // 命中就挪到队尾：Map 的插入顺序当 LRU 用。
      this._tokenCache.delete(key)
      this._tokenCache.set(key, cached)
      return cached
    }
    const record = buildSearchTokenRecord(entry)
    this._tokenCache.set(key, record)
    while (this._tokenCache.size > this.maxSearchTokenCache) {
      const oldest = this._tokenCache.keys().next().value
      this._tokenCache.delete(oldest)
    }
    return record
  }

  /**
   * 返回 `{matched:[{entry,score,scoreParts}], analysis}`。
   * df / idf 在本次 status 过滤后的候选池上算；排序只用分数，最终同分由 list() 按 id 兜底。
   */
  _hybridSearch(base, rawQuery, weightsOverride) {
    const weights = mergeSearchWeights(this.searchWeights, weightsOverride)
    const analysis = analyzeQuery(rawQuery)
    const { variants, needles } = analysis
    const df = new Uint32Array(variants.length)
    const matchedEntries = []
    for (const entry of base) {
      const haystack = this._searchHaystack(entry)
      const hit = new Uint8Array(variants.length)
      let allTerms = true
      for (const term of analysis.terms) {
        let termHit = term.matchAll
        for (const variantIndex of term.variants) {
          if (!hit[variantIndex]) {
            const needle = needles[variantIndex]
            const field = needle.field === 'latin' ? haystack.latin : haystack.text
            hit[variantIndex] = field.includes(needle.value) ? 1 : 0
          }
          if (term.matchAll) {
            if (!hit[variantIndex]) termHit = false
          } else if (hit[variantIndex]) {
            termHit = true
          }
        }
        if (!termHit) allTerms = false
      }
      for (let index = 0; index < hit.length; index += 1) {
        if (hit[index]) df[index] += 1
      }
      if (allTerms) matchedEntries.push(entry)
    }

    const idf = new Float64Array(variants.length)
    for (let index = 0; index < variants.length; index += 1) {
      if (df[index] > 0) {
        idf[index] = Math.log(1 + (base.length - df[index] + 0.5) / (df[index] + 0.5))
      }
    }

    const records = matchedEntries.map((entry) => this._searchTokens(entry))
    const sums = { title: 0, meta: 0, body: 0 }
    for (const record of records) {
      for (const field of SEARCH_FIELDS) sums[field] += record[`${field}Length`]
    }
    const average = {}
    for (const field of SEARCH_FIELDS) {
      average[field] = records.length ? sums[field] / records.length : 1
    }

    const matched = matchedEntries.map((entry, position) => {
      const record = records[position]
      const titleLower = entry.title.toLowerCase()
      const tagsLower = entry.tags.join(' ').toLowerCase()
      const pathLower = String(entry.path ?? '').toLowerCase()
      const bodyLower = String(entry.preview ?? '').toLowerCase()
      const parts = { phrase: 0, bm25: 0, title: 0, meta: 0, body: 0 }

      // 精确短语：query 原文出现在字段里；标题 > 标签/路径 > 正文。
      if (analysis.raw.length >= 2) {
        if (titleLower.includes(analysis.raw)) parts.phrase += weights.phraseField.title
        if (tagsLower.includes(analysis.raw)) parts.phrase += weights.phraseField.tags
        if (pathLower.includes(analysis.raw)) parts.phrase += weights.phraseField.path
        if (bodyLower.includes(analysis.raw)) parts.phrase += weights.phraseField.body
      }
      // 多词 query：每个 term 的整词命中再加一份，弥补拆分后丢掉的“原词”信号。
      if (analysis.terms.length > 1) {
        for (const term of analysis.terms) {
          if (term.term.length < 2) continue
          if (titleLower.includes(term.term)) parts.phrase += 1.5
          if (tagsLower.includes(term.term)) parts.phrase += 1
          if (pathLower.includes(term.term)) parts.phrase += 1
          if (bodyLower.includes(term.term)) parts.phrase += 0.5
        }
      }

      // BM25：变体是全局去重的（同一个 bigram 不因 query 重复写两次而重复计分）。
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
        const variantIdf = idf[variantIndex]
        if (!variantIdf) continue
        const variant = variants[variantIndex]
        for (const field of SEARCH_FIELDS) {
          const tf = record[field].get(variant)
          if (!tf) continue
          const length = record[`${field}Length`]
          const fieldAverage = average[field] || 1
          const norm = 1 - SEARCH_BM25_B[field] + SEARCH_BM25_B[field] * (length / fieldAverage)
          const contribution = weights.fieldBoost[field] * variantIdf
            * (tf * (SEARCH_BM25_K1 + 1)) / (tf + SEARCH_BM25_K1 * norm)
          parts[field] += contribution
          parts.bm25 += contribution
        }
      }

      const score = weights.phrase * parts.phrase + weights.bm25 * parts.bm25
      return {
        entry,
        score,
        scoreParts: {
          phrase: roundScore(parts.phrase),
          bm25: roundScore(parts.bm25),
          title: roundScore(parts.title),
          meta: roundScore(parts.meta),
          body: roundScore(parts.body),
        },
      }
    })
    return { matched, analysis }
  }

  /** 只给这一页算 source / line（行号按 query 命中强度取最强的一行）。 */
  async _attachSearchLocations(items, page, analysis, query) {
    const locate = query.line !== false
    const locations = await mapWithConcurrency(page, 8, async ({ entry }) => {
      const source = this._contentFile(entry)
      if (!source) return { source: null, line: null }
      if (!locate) return { source, line: null }
      return { source, line: await this._bestLine(entry, source, analysis) }
    })
    for (let index = 0; index < items.length; index += 1) {
      items[index].source = locations[index].source
      items[index].line = locations[index].line
    }
  }

  async _bestLine(entry, file, analysis) {
    if (entry.storage !== 'note' && !isTextFile(entry.path || entry.blob || '')) return null
    let handle = null
    try {
      handle = await fs.open(file, 'r')
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size === 0) return null
      const bytes = Math.min(stat.size, LINE_SCAN_BYTES)
      const buffer = Buffer.alloc(bytes)
      await handle.read(buffer, 0, bytes, 0)
      const lines = buffer.toString('utf8').split(/\r?\n/)
      let bestIndex = -1
      let bestScore = 0
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].toLowerCase()
        if (!line.trim()) continue
        let score = 0
        if (analysis.raw.length >= 2 && line.includes(analysis.raw)) score += 10
        for (const term of analysis.terms) {
          if (term.term && line.includes(term.term)) score += 3
        }
        if (!score) {
          for (const variant of analysis.variants) {
            if (line.includes(variant)) {
              score += 1
              break
            }
          }
        }
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      }
      // 只有标题/路径命中、正文没有命中时，给第 1 行当“打开位置”（而不是 null）：
      // 调用方拿到的 line 始终是可跳转的行号；空文件/二进制仍是 null。
      return bestScore > 0 ? bestIndex + 1 : (lines.some((line) => line.trim()) ? 1 : null)
    } catch {
      return null
    } finally {
      if (handle) await handle.close().catch(() => {})
    }
  }

  async list(query = {}) {
    await this.init()
    await this._syncFromDisk()
    const q = typeof query.q === 'string' ? query.q : ''
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
    // 只有显式传 mode:'keyword' 才走旧逻辑；默认 hybrid（q 为空时两者等价）。
    const mode = query.mode === 'keyword' ? 'keyword' : 'hybrid'
    let base = Object.values(this.index.entries)
    const status = query.status || 'active'
    if (status === 'active' || status === 'trashed') base = base.filter((entry) => entry.status === status)

    let matched = []
    let search = null
    if (!tokens.length) {
      matched = base.map((entry) => ({ entry, score: 0 }))
    } else if (mode === 'keyword') {
      for (const entry of base) {
        const score = scoreEntry(entry, tokens, q)
        if (score !== null) matched.push({ entry, score })
      }
    } else {
      search = this._hybridSearch(base, q, query.weights)
      matched = search.matched
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
      if (sort === 'relevance' && tokens.length) {
        if (b.score !== a.score) return b.score - a.score
        // hybrid 同分按 id 定序（keyword 保持旧行为：落到 updatedAt）。
        if (search) return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
      }
      return String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt))
    })

    const total = filtered.length
    const limitValue = Number(query.limit)
    const limit = Number.isFinite(limitValue) ? Math.min(200, Math.max(1, Math.trunc(limitValue))) : 50
    const offsetValue = Number(query.offset)
    const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.trunc(offsetValue)) : 0
    const page = filtered.slice(offset, offset + limit)
    const items = page.map(({ entry, score, scoreParts }) => {
      if (!search) return summaryOf(entry, tokens.length ? q : '')
      const extras = {
        score: roundScore(score),
        snippet: makeHybridSnippet(entry.preview, search.analysis),
      }
      if (query.scoreParts !== false && query.debug !== false) extras.scoreParts = scoreParts
      return summaryOf(entry, q, extras)
    })
    if (search) await this._attachSearchLocations(items, page, search.analysis, query)
    return { total, limit, offset, items, facets }
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
    // The id in an index file is untrusted input: only ids shaped like the ones
    // this store mints may name a file under notes/.
    if (entry.storage === 'note') {
      return isSafeEntryId(entry.id) ? path.join(this.notesDir, `${entry.id}.md`) : null
    }
    // Defense in depth: _parseIndex already drops linked entries outside the
    // registered sources, but a caller could hand this a hand-built entry.
    if (entry.storage === 'linked') return this.linkedPathReason(entry.path) === null ? entry.path : null
    // Blob paths are documented as nested (`ab/cd/<sha>`) but must stay under blobs/.
    if (entry.storage === 'blob' && entry.blob) return resolveInside(this.blobsDir, entry.blob)
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
      if (entry.storage === 'note' || entry.storage === 'blob') {
        const file = this._contentFile(entry)
        // null = a tampered/unsafe id or blob path: never rm outside the store.
        if (file) await fs.rm(file, { force: true })
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
      aggregate.incomplete = results.some((result) => result.incomplete === true)
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
      maxFiles: this.maxFiles,
      hidden: source.hidden,
      include: source.include,
      exclude: source.exclude,
    })
    result.skipped += walked.skipped
    const walkedErrors = Array.isArray(walked.errors) ? walked.errors : []
    for (const error of walkedErrors) {
      if (result.errors.length >= 20) break
      result.errors.push(error)
    }
    // A directory that could not be read is not evidence that its files were
    // deleted. Skip this run's removal pass so a transient EACCES/EMFILE can't
    // silently drop (and later re-add without user tags) a whole subtree.
    // Truncation is the same kind of 「没走完」: files past the cap were never
    // seen, so they must not be reconciled away either.
    const incomplete = walkedErrors.length > 0 || walked.truncated === true
    if (walkedErrors.length > 0) {
      result.incomplete = true
      result.errors.push({
        path: source.path,
        message: '部分目录读取失败，本次未执行删除对账（避免把暂时读不到的文件当成已删除）。',
      })
    }
    if (walked.truncated) {
      result.skipped += 1
      result.incomplete = true
      result.errors.push({
        path: source.path,
        message: `达到单次扫描文件上限 ${this.maxFiles}，其余文件本次跳过；本次未执行删除对账。`,
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
      if (incomplete) break // see above: keep entries this run could not verify
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
