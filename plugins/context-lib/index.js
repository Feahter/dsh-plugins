/**
 * dsh-context-lib — 宿主半片。
 *
 * 一个本机「上下文资源库」：把设备上的文档 / 脚本 / 图片 / 会话登记成条目，
 * 提供 agent 工具（搜索、读取、写入、扫描）和浏览器面板用的 HTTP 路由，
 * 并把库的概要以 runtime context 的形式送进每一轮对话。
 *
 * 数据层（index.json / 扫描 / 检索）在 ./src/store.js，契约见 docs/API.md。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

import { LibraryError, createLibrary, resolveRoot } from './src/store.js'
import { preview, previewThumb } from './src/preview.js'

export const DEFAULTS = {
  rootDir: '',
  briefing: 'context',
  protocolSection: true,
  autoScan: false,
  maxEntries: 20000,
  maxPreviewChars: 1200,
  command: false,
}

const ROUTE_PREFIX = '/api/context-lib'
const SECTION_NAME = 'context-lib'
const BRIEF_TITLE = '## Context library (本机资源库)'
const TOOL_TIMEOUT_MS = 45_000
const MAX_BODY_BYTES = 1024 * 1024
const MAX_RAW_BYTES = 32 * 1024 * 1024
const MAX_TOOL_TEXT = 6000
/** 这些格式要走预览层转换，不能当纯文本直接读。 */
const CONVERTIBLE_EXTS = /^(doc|docx|rtf|rtfd|odt|pdf|xls|xlsx|ppt|pptx|key|pages|numbers|epub|html|htm|xhtml)$/i

export const inject = ['tools', 'systemPrompt']

// ------------------------------------------------------------------ config

function readConfig(raw) {
  const config = { ...DEFAULTS }
  const warnings = []
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(DEFAULTS, key)) warnings.push(`unknown config key "${key}" ignored`)
    }
    if (typeof raw.rootDir === 'string') config.rootDir = raw.rootDir
    if (raw.briefing === 'context' || raw.briefing === 'off') config.briefing = raw.briefing
    if (typeof raw.protocolSection === 'boolean') config.protocolSection = raw.protocolSection
    if (typeof raw.autoScan === 'boolean') config.autoScan = raw.autoScan
    if (Number.isFinite(raw.maxEntries)) config.maxEntries = Math.max(100, Math.floor(raw.maxEntries))
    if (Number.isFinite(raw.maxPreviewChars)) {
      config.maxPreviewChars = Math.min(4000, Math.max(200, Math.floor(raw.maxPreviewChars)))
    }
    if (typeof raw.command === 'boolean') config.command = raw.command
  }
  return { config, warnings }
}

// ---------------------------------------------------------------- helpers

const KIND_LABEL = {
  doc: '文档',
  script: '脚本',
  image: '图片',
  data: '数据',
  session: '会话',
  note: '笔记',
  other: '其他',
}

function shortBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
}

function day(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10)
}

function clampText(text, max = MAX_TOOL_TEXT) {
  if (typeof text !== 'string') return ''
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`
}

function errorPayload(error, fallbackCode = 'library-error') {
  const code = error instanceof LibraryError ? error.code : fallbackCode
  return {
    ok: false,
    error: {
      message: (error && error.message) || String(error),
      code,
      ...(error && error.hint ? { hint: error.hint } : {}),
    },
  }
}

function failureText(value) {
  if (value && value.ok === false && value.error) {
    const hint = value.error.hint ? `\n${value.error.hint}` : ''
    return `[${value.error.code}] ${value.error.message}${hint}`
  }
  return ''
}

function bulletList(items, limit) {
  return items
    .slice(0, limit)
    .map((item) => `- ${item}`)
    .join('\n')
}

// ------------------------------------------------------------ tool factory

function defineTool(name, description, parameters, execute, renderText) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    execute: async (args, exec) => {
      try {
        return await execute(args || {}, exec || {})
      } catch (error) {
        return errorPayload(error)
      }
    },
    timeoutMs: TOOL_TIMEOUT_MS,
  }
}

function renderSearch(value) {
  const error = failureText(value)
  if (error) return error
  const { items, total, query } = value
  const head = query ? `资源库检索 "${query}"：${total} 条命中，显示 ${items.length} 条` : `资源库：${total} 条，显示 ${items.length} 条`
  if (!items.length) return `${head}\n\n（没有命中。可以放宽条件，或先 context_lib_scan 扫描来源。）`
  const lines = [head]
  for (const [index, item] of items.entries()) {
    lines.push(
      `${index + 1}. ${item.id} · ${KIND_LABEL[item.kind] || item.kind} · ${item.title}` +
        `\n   ${item.collection} · ${shortBytes(item.size)} · ${day(item.updatedAt)}${item.tags.length ? ` · #${item.tags.join(' #')}` : ''}` +
        (item.snippet ? `\n   ${item.snippet.replace(/\s+/g, ' ').slice(0, 180)}` : ''),
    )
  }
  lines.push('用 context_lib_read(id) 读正文；用 context_lib_update 改标签/归类。')
  return clampText(lines.join('\n'))
}

function renderRead(value) {
  const error = failureText(value)
  if (error) return error
  if (value.binary) {
    return [
      `${value.title}（${value.kind}，二进制）`,
      `路径：${value.path || '（库内笔记）'}`,
      `类型：${value.mime} · ${shortBytes(value.size)}`,
      value.hint || '用 read_image 读取该路径，或用系统工具打开。',
    ].join('\n')
  }
  const header = `${value.title}（${value.kind}${value.collection ? ` · ${value.collection}` : ''}）${value.truncated ? `｜已截断，共 ${value.totalLines ?? '?'} 行` : ''}`
  const note = value.truncated ? '\n\n…（正文未读完，用 startLine/endLine 继续）' : ''
  return clampText(`${header}\n\n${value.text}${note}`)
}

function renderItem(value, verb) {
  const error = failureText(value)
  if (error) return error
  const item = value.item || value
  return [
    `${verb}：${item.id} · ${item.title}`,
    `kind=${item.kind} · collection=${item.collection} · status=${item.status} · ${shortBytes(item.size)}`,
    `tags: ${item.tags.length ? item.tags.join(', ') : '（无）'}`,
    item.path ? `path: ${item.path}` : '',
    value.purged ? '注意：已从索引和库内副本中彻底删除（linked 的原文件未动）。' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function renderScan(value) {
  const error = failureText(value)
  if (error) return error
  const { results } = value
  if (!results.length) return '没有可扫描的来源。用 context_lib_sources 添加一个目录。'
  const lines = ['扫描完成：']
  for (const result of results) {
    lines.push(
      `- ${result.sourceId}: +${result.added} 新增 · ${result.updated} 更新 · ${result.unchanged} 未变 · ${result.removed} 移除 · ${result.skipped} 跳过 · ${(result.durationMs / 1000).toFixed(1)}s`,
    )
    for (const error of (result.errors || []).slice(0, 3)) lines.push(`  ! ${error.path}: ${error.message}`)
  }
  return lines.join('\n')
}

function renderStats(value) {
  const error = failureText(value)
  if (error) return error
  const { stats } = value
  const kinds = Object.entries(stats.counts.byKind || {})
    .map(([kind, count]) => `${KIND_LABEL[kind] || kind} ${count}`)
    .join(' · ')
  const lines = [
    `资源库 ${stats.root}`,
    `条目 ${stats.counts.active}（回收站 ${stats.counts.trashed}）· ${shortBytes(stats.bytes)} · 更新于 ${day(stats.updatedAt)}`,
    kinds || '（空）',
  ]
  if (stats.collections.length) {
    lines.push(`归类：${stats.collections.slice(0, 8).map((entry) => `${entry.name}(${entry.count})`).join(' · ')}`)
  }
  if (stats.sources.length) {
    lines.push(`来源：\n${bulletList(stats.sources.map((source) => `${source.id}: ${source.path}${source.lastScanAt ? ` · 扫描于 ${day(source.lastScanAt)}` : ' · 未扫描'}`), 8)}`)
  }
  return clampText(lines.join('\n'))
}

function renderPack(value) {
  const error = failureText(value)
  if (error) return error
  if (!value.total) return `集合 "${value.collection}" 里没有条目。`
  return clampText(`## 资源库集合：${value.collection}（${value.total} 条）\n\n${value.text}`, 16000)
}

// ------------------------------------------------------------------ tools

function buildTools({ getLibrary }) {
  async function library() {
    const lib = await getLibrary()
    return lib
  }

  const search = defineTool(
    'context_lib_search',
    '检索本机上下文资源库（文档 / 脚本 / 图片 / 数据 / 会话 / 笔记）。先查库再考虑联网；返回条目 id、类型、归类、标签与摘要。',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，空格分隔多个词（AND）；中文整词也可以。留空表示只按筛选列目录。' },
        kind: { type: 'string', enum: ['doc', 'script', 'image', 'data', 'session', 'note', 'other'], description: '只查某类资源。' },
        collection: { type: 'string', description: '只查某个归类。' },
        tag: { type: 'string', description: '只查带某标签的条目。' },
        source: { type: 'string', description: '只查某个扫描源，如 workspace / docs / dsh。' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数，默认 10。' },
        offset: { type: 'integer', minimum: 0, description: '分页偏移。' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const result = await lib.list({
        q: args.query || '',
        kind: args.kind || '',
        collection: args.collection || '',
        tag: args.tag || '',
        source: args.source || '',
        status: 'active',
        sort: args.query ? 'relevance' : 'updated',
        limit: args.limit || 10,
        offset: args.offset || 0,
      })
      return { ...result, query: args.query || '' }
    },
    renderSearch,
  )

  const read = defineTool(
    'context_lib_read',
    '读取资源库条目的正文（可指定行范围）。二进制（图片/PDF 等）返回本机路径，再用 read_image 或系统工具读取。',
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: '条目 id（context_lib_search 返回的 cl_ 开头 id）。' },
        startLine: { type: 'integer', minimum: 1, description: '从第几行开始（1 基）。' },
        endLine: { type: 'integer', minimum: 1, description: '读到第几行（含）。' },
        maxChars: { type: 'integer', minimum: 200, maximum: 200000, description: '最多返回多少字符，默认 20000。' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const entry = await lib.get(String(args.id || ''))
      if (!entry) throw new LibraryError(`条目 ${args.id} 不存在。`, { code: 'item-not-found' })
      if (entry.kind === 'image' || entry.kind === 'other') {
        const resolved = resolveAssetPath(entry)
        return {
          id: entry.id,
          title: entry.title,
          kind: entry.kind,
          collection: entry.collection,
          mime: entry.mime,
          size: entry.size,
          path: resolved,
          binary: true,
          hint: entry.kind === 'image' ? '用 read_image 工具读取该路径。' : '这是二进制条目，用系统工具打开或 context_lib_search 找同主题的文本条目。',
        }
      }
      // 文档类格式先走预览层：docx/rtf/odt 用 textutil 抽文本，html 剥标签，pdf/xlsx 只能出缩略图。
      if (CONVERTIBLE_EXTS.test(String(entry.ext || ''))) {
        const converted = await preview(entry, lib.root, { maxChars: args.maxChars || 20000 })
        if (converted.kind === 'text') {
          return {
            id: entry.id,
            title: entry.title,
            kind: entry.kind,
            collection: entry.collection,
            mime: entry.mime,
            size: entry.size,
            path: resolveAssetPath(entry),
            text: converted.text,
            chars: converted.chars,
            truncated: converted.truncated,
            converted: true,
            note: converted.note,
          }
        }
        return {
          id: entry.id,
          title: entry.title,
          kind: entry.kind,
          collection: entry.collection,
          mime: entry.mime,
          size: entry.size,
          path: resolveAssetPath(entry),
          binary: true,
          hint: converted.kind === 'thumb'
            ? `这个格式没有可抽取的文本，面板里能看缩略图（${ROUTE_PREFIX}/items/${entry.id}/thumb）。`
            : `${converted.note || '无法转换这个格式'}，用系统工具打开本机路径。`,
        }
      }
      const text = await lib.readText(entry.id, {
        startLine: args.startLine,
        endLine: args.endLine,
        maxChars: args.maxChars || 20000,
      })
      if (!text.text) {
        return {
          id: entry.id,
          title: entry.title,
          kind: entry.kind,
          mime: entry.mime,
          size: entry.size,
          path: resolveAssetPath(entry),
          binary: true,
          hint: '该条目没有可抽取的文本（二进制格式）。',
        }
      }
      return { ...text, kind: entry.kind, collection: entry.collection }
    },
    renderRead,
  )

  const put = defineTool(
    'context_lib_put',
    '在资源库里新建一条笔记（markdown）。适合把结论、摘录、记忆片段落在库里，供后续会话检索。',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题。' },
        content: { type: 'string', description: '正文（markdown）。' },
        collection: { type: 'string', description: '归类，默认 inbox。' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签。' },
        notes: { type: 'string', description: '给这条记录加一句备注。' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const item = await lib.create({
        title: String(args.title || '').trim(),
        content: String(args.content || ''),
        kind: 'note',
        collection: args.collection || 'inbox',
        tags: args.tags || [],
        notes: args.notes || '',
      })
      return { item }
    },
    (value) => renderItem(value, '已写入'),
  )

  const update = defineTool(
    'context_lib_update',
    '修改资源库条目的标题、标签、归类、备注；笔记还可以改正文。扫描来的文件条目不动原文件。',
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: '条目 id。' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        collection: { type: 'string' },
        notes: { type: 'string' },
        content: { type: 'string', description: '仅笔记（kind=note）可改正文。' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const item = await lib.update(String(args.id || ''), {
        ...(typeof args.title === 'string' ? { title: args.title } : {}),
        ...(Array.isArray(args.tags) ? { tags: args.tags } : {}),
        ...(typeof args.collection === 'string' ? { collection: args.collection } : {}),
        ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
        ...(typeof args.content === 'string' ? { content: args.content } : {}),
      })
      return { item }
    },
    (value) => renderItem(value, '已更新'),
  )

  const remove = defineTool(
    'context_lib_delete',
    '把条目移入回收站（默认），或彻底删除（purge=true）。扫描来的 linked 条目只移除索引，不会删除用户原文件。',
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        purge: { type: 'boolean', description: 'true 时彻底删除，不可恢复。' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const id = String(args.id || '')
      if (args.purge) {
        await lib.purge(id)
        return { item: { id, title: id, kind: 'note', collection: '', status: 'purged', tags: [], size: 0 }, purged: true }
      }
      const item = await lib.remove(id)
      return { item }
    },
    (value) => renderItem(value, value.purged ? '已彻底删除' : '已移入回收站'),
  )

  const scan = defineTool(
    'context_lib_scan',
    '扫描来源目录，把新文件登记进资源库（增量：只处理新增/改动/删除）。不修改用户文件。',
    {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '只扫某个来源；省略则扫全部来源。' },
        force: { type: 'boolean', description: 'true 时忽略 size/mtime 缓存重新抽取预览。' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const ids = args.sourceId ? [String(args.sourceId)] : (await lib.sources()).map((source) => source.id)
      const results = []
      for (const sourceId of ids) {
        try {
          results.push({ sourceId, ...(await lib.scan({ sourceId, force: Boolean(args.force) })) })
        } catch (error) {
          results.push({
            sourceId,
            added: 0,
            updated: 0,
            unchanged: 0,
            removed: 0,
            skipped: 0,
            errors: [{ path: sourceId, message: (error && error.message) || String(error) }],
            durationMs: 0,
          })
        }
      }
      return { results }
    },
    renderScan,
  )

  const stats = defineTool(
    'context_lib_stats',
    '资源库概况：条目数、类型分布、归类、标签、来源与最近更新时间。',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => ({ stats: await (await library()).stats() }),
    renderStats,
  )

  const sources = defineTool(
    'context_lib_sources',
    '管理扫描来源（目录）：列出、添加、移除。添加后面板或 context_lib_scan 才会登记其中文件。',
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove'], description: '默认 list。' },
        name: { type: 'string', description: 'action=add 时的来源名。' },
        path: { type: 'string', description: 'action=add 时的绝对目录路径（支持 ~）。' },
        id: { type: 'string', description: 'action=remove 时的来源 id。' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      const action = args.action || 'list'
      if (action === 'add') {
        const source = await lib.addSource({ name: String(args.name || ''), path: String(args.path || '') })
        return { sources: await lib.sources(), source }
      }
      if (action === 'remove') {
        await lib.removeSource(String(args.id || ''))
        return { sources: await lib.sources() }
      }
      return { sources: await lib.sources() }
    },
    (value) => {
      const error = failureText(value)
      if (error) return error
      const lines = ['扫描来源：']
      if (!value.sources.length) lines.push('- （无）')
      for (const source of value.sources) {
        lines.push(
          `- ${source.id} · ${source.name} → ${source.path}${source.missing ? '（目录不存在）' : ''}` +
            `${source.lastScanAt ? ` · 上次扫描 ${day(source.lastScanAt)}` : ' · 未扫描'} · ${source.count} 条`,
        )
      }
      return lines.join('\n')
    },
  )

  const pack = defineTool(
    'context_lib_pack',
    '把一个集合（归类）的条目按最近更新拼成一段可直接读的上下文，用于一次性加载某个主题的全部资料。',
    {
      type: 'object',
      properties: {
        collection: { type: 'string', description: '归类名。' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多拼几条，默认 20。' },
        maxChars: { type: 'integer', minimum: 1000, maximum: 60000, description: '总字符上限，默认 12000。' },
      },
      required: ['collection'],
      additionalProperties: false,
    },
    async (args) => {
      const lib = await library()
      return lib.pack(String(args.collection || ''), {
        limit: args.limit || 20,
        maxChars: args.maxChars || 12000,
      })
    },
    renderPack,
  )

  return [search, read, put, update, remove, scan, stats, sources, pack]
}

function resolveAssetPath(entry) {
  if (!entry) return null
  if (entry.storage === 'linked') return entry.path
  return null
}

// --------------------------------------------------------------- briefing

function createBriefer(getLibrary, config) {
  let text = ''
  let builtAt = 0
  let pending = null

  async function build() {
    const lib = await getLibrary()
    const stats = await lib.stats()
    const lines = [BRIEF_TITLE]
    if (!stats.counts.active) {
      lines.push('库是空的。用 `context_lib_scan` 扫描来源，或 `context_lib_put` 写入第一条笔记。')
      return lines.join('\n')
    }
    lines.push(
      `本机已索引 ${stats.counts.active} 条资源（回收站 ${stats.counts.trashed}）· 归类：` +
        (stats.collections.slice(0, 6).map((entry) => `${entry.name}(${entry.count})`).join(' · ') || '无') +
        ` · ${day(stats.updatedAt)} 更新`,
    )
    const recent = await lib.list({ status: 'active', sort: 'updated', limit: 4 })
    if (recent.items.length) {
      lines.push('最近：')
      for (const item of recent.items) {
        lines.push(`- ${item.id} · ${item.title}（${item.kind} · ${item.collection}）`)
      }
    }
    lines.push('找资料先 `context_lib_search`，命中后 `context_lib_read(id)`；不要先联网。')
    return lines.join('\n')
  }

  function refresh() {
    if (pending) return pending
    pending = build()
      .then((next) => {
        text = next
        builtAt = Date.now()
        return next
      })
      .catch(() => text)
      .finally(() => {
        pending = null
      })
    return pending
  }

  return {
    current() {
      if (!text) return ''
      if (Date.now() - builtAt > Math.max(5_000, config.briefingRefreshMs || 8_000)) void refresh()
      return text
    },
    refresh,
  }
}

// ------------------------------------------------------------------- HTTP

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        fail(new LibraryError('请求体超过 1MB。', { code: 'invalid-argument' }))
        if (typeof req.destroy === 'function') req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', fail)
  })
}

function parseJson(text) {
  if (!text) return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new LibraryError('请求体必须是 JSON。', { code: 'invalid-argument' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LibraryError('请求体必须是 JSON 对象。', { code: 'invalid-argument' })
  }
  return value
}

function sendJson(res, method, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(method === 'HEAD' ? {} : { 'content-length': String(Buffer.byteLength(text, 'utf8')) }),
  })
  if (method === 'HEAD') res.end()
  else res.end(text)
}

async function sendFile(res, method, file, mime, { maxBytes = MAX_RAW_BYTES, cacheControl = 'no-store' } = {}) {
  const stat = await fs.stat(file).catch(() => null)
  if (!stat || !stat.isFile()) throw new LibraryError('文件已不存在。', { code: 'item-not-found' })
  if (stat.size > maxBytes) throw new LibraryError('文件超过 32MB，请直接打开本机路径。', { code: 'too-large' })
  const bytes = await fs.readFile(file)
  const contentType = /^(text\/|application\/(json|xml|javascript|svg\+xml))/i.test(mime) && !/charset=/i.test(mime)
    ? `${mime}; charset=utf-8`
    : mime
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': cacheControl,
    'content-length': String(bytes.length),
  })
  if (method === 'HEAD') res.end()
  else res.end(bytes)
}

async function sendRaw(res, method, entry, root) {
  let file = null
  if (entry.storage === 'linked') file = entry.path
  else if (entry.storage === 'note') file = path.join(root, 'notes', `${entry.id}.md`)
  else if (entry.storage === 'blob' && entry.blob) file = path.join(root, 'blobs', entry.blob)
  if (!file) throw new LibraryError('该条目没有可读取的字节。', { code: 'invalid-content' })
  await sendFile(res, method, file, entry.mime || 'application/octet-stream')
}

function httpStatusFor(error) {
  const code = error instanceof LibraryError ? error.code : ''
  if (['invalid-argument', 'invalid-source', 'invalid-content'].includes(code)) return 400
  if (code === 'item-not-found' || code === 'source-not-found') return 404
  if (code === 'library-busy') return 409
  if (code === 'too-large') return 413
  if (code === 'preview-unavailable') return 415
  if (code === 'unsupported-platform') return 501
  return 500
}

/** 在 Finder 里定位文件（macOS 的 open -R）。不经过 shell，参数单独传，路径里的空格/引号不会被解释。 */
function revealInFinder(target) {
  return new Promise((resolve, reject) => {
    execFile('open', ['-R', target], { timeout: 5000 }, (error) => {
      if (error) reject(new LibraryError(`无法在访达中打开：${error.message}`, { code: 'reveal-failed' }))
      else resolve()
    })
  })
}

async function dispatchRoute({ method, pathname, searchParams, headers, bodyText, connection, root, getLibrary, briefer }) {
  if (!connection || typeof connection.requestRejection !== 'function') {
    return {
      status: 503,
      payload: { ok: false, error: { message: '资源库面板需要 Harness connection 服务。', code: 'unavailable' } },
    }
  }
  const rejection = connection.requestRejection({ headers })
  if (rejection) {
    return { status: rejection, payload: { ok: false, error: { message: 'Unauthorized', code: 'unauthorized' } } }
  }
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(`${ROUTE_PREFIX}/`)) {
    return { status: 404, payload: { ok: false, error: { message: 'Not found', code: 'not-found' } } }
  }
  const route = pathname.slice(ROUTE_PREFIX.length) || '/'
  const verb = method === 'HEAD' ? 'GET' : method
  const segments = route.split('/').filter(Boolean)
  const lib = await getLibrary()
  try {
    if (verb === 'GET') {
      if (segments.length === 0 || segments[0] === 'state') {
        const [stats, sources] = await Promise.all([lib.stats(), lib.sources()])
        const trash = await lib.listTrash({ limit: 1 })
        return {
          status: 200,
          payload: {
            ok: true,
            data: {
              stats,
              sources,
              kinds: stats.counts.byKind,
              collections: stats.collections,
              trashCount: trash.total,
              root,
            },
          },
        }
      }
      if (segments[0] === 'items' && segments.length === 1) {
        const status = searchParams.get('status') || 'active'
        const result = await lib.list({
          q: searchParams.get('q') || '',
          kind: searchParams.get('kind') || '',
          collection: searchParams.get('collection') || '',
          tag: searchParams.get('tag') || '',
          source: searchParams.get('source') || '',
          status,
          sort: searchParams.get('sort') || 'relevance',
          limit: Number(searchParams.get('limit') || 50),
          offset: Number(searchParams.get('offset') || 0),
        })
        return { status: 200, payload: { ok: true, data: result } }
      }
      if (segments[0] === 'items' && segments[1]) {
        const id = decodeURIComponent(segments[1])
        const entry = await lib.get(id)
        if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
        if (segments[2] === 'content') {
          const text = await lib.readText(id, {
            startLine: Number(searchParams.get('startLine') || 0) || undefined,
            endLine: Number(searchParams.get('endLine') || 0) || undefined,
            maxChars: Number(searchParams.get('maxChars') || 20000),
          })
          return { status: 200, payload: { ok: true, data: { ...text, binary: entry.kind === 'image' && !text.text } } }
        }
        if (segments[2] === 'raw') {
          return { status: 200, raw: { entry, root } }
        }
        if (segments[2] === 'preview') {
          const result = await preview(entry, root, {
            maxChars: Number(searchParams.get('maxChars') || 20000) || 20000,
          })
          if (result.kind === 'thumb') {
            return {
              status: 200,
              payload: {
                ok: true,
                data: {
                  kind: 'thumb',
                  url: `${ROUTE_PREFIX}/items/${encodeURIComponent(id)}/thumb`,
                  cached: result.cached === true,
                },
              },
            }
          }
          return { status: 200, payload: { ok: true, data: result } }
        }
        if (segments[2] === 'thumb') {
          const result = await previewThumb(entry, root)
          if (result.kind !== 'thumb') {
            throw new LibraryError(result.note || '这个条目无法生成缩略图。', { code: 'preview-unavailable' })
          }
          return { status: 200, file: { path: result.path, mime: 'image/png' } }
        }
        let content = null
        if (entry.kind !== 'image' && entry.kind !== 'other') {
          const text = await lib.readText(id, { maxChars: 20000 })
          content = text.text
        }
        return { status: 200, payload: { ok: true, data: { item: entry, content } } }
      }
      if (segments[0] === 'trash') {
        const result = await lib.listTrash({
          limit: Number(searchParams.get('limit') || 50),
          offset: Number(searchParams.get('offset') || 0),
        })
        return { status: 200, payload: { ok: true, data: result } }
      }
      if (segments[0] === 'sources') {
        return { status: 200, payload: { ok: true, data: { sources: await lib.sources() } } }
      }
      if (segments[0] === 'pack') {
        const collection = searchParams.get('collection') || ''
        const result = await lib.pack(collection, {
          limit: Number(searchParams.get('limit') || 20),
          maxChars: Number(searchParams.get('maxChars') || 12000),
        })
        return { status: 200, payload: { ok: true, data: result } }
      }
      return { status: 404, payload: { ok: false, error: { message: `Unknown route: GET ${route}`, code: 'not-found' } } }
    }

    if (verb === 'POST') {
      const body = parseJson(bodyText)
      if (segments[0] === 'items' && segments.length === 1) {
        const item = await lib.create({
          title: String(body.title || '').trim(),
          content: typeof body.content === 'string' ? body.content : '',
          kind: 'note',
          collection: body.collection || 'inbox',
          tags: Array.isArray(body.tags) ? body.tags : [],
          notes: typeof body.notes === 'string' ? body.notes : '',
        })
        void briefer.refresh()
        return { status: 201, payload: { ok: true, data: { item } } }
      }
      if (segments[0] === 'items' && segments[1] && segments[2] === 'restore') {
        const item = await lib.restore(decodeURIComponent(segments[1]))
        void briefer.refresh()
        return { status: 200, payload: { ok: true, data: { item } } }
      }
      if (segments[0] === 'scan') {
        const ids = body.sourceId ? [String(body.sourceId)] : (await lib.sources()).map((source) => source.id)
        const results = []
        for (const sourceId of ids) {
          try {
            results.push({ sourceId, ...(await lib.scan({ sourceId, force: Boolean(body.force) })) })
          } catch (error) {
            results.push({
              sourceId,
              added: 0,
              updated: 0,
              unchanged: 0,
              removed: 0,
              skipped: 0,
              errors: [{ path: sourceId, message: (error && error.message) || String(error) }],
              durationMs: 0,
            })
          }
        }
        void briefer.refresh()
        return { status: 200, payload: { ok: true, data: { results } } }
      }
      if (segments[0] === 'items' && segments[1] && segments[2] === 'reveal') {
        const entry = await lib.get(decodeURIComponent(segments[1]))
        if (!entry || entry.storage !== 'linked' || !entry.path) {
          throw new LibraryError('这条没有原文件路径（笔记或库内副本）', {
            code: 'item-not-found',
            hint: '只有 linked 条目才有本机文件位置；note/blob 存在库里。',
          })
        }
        if (process.platform !== 'darwin') {
          throw new LibraryError('当前系统不支持在访达中显示', {
            code: 'unsupported-platform',
            hint: 'reveal 只实现了 macOS 的 open -R。',
          })
        }
        try {
          await fs.access(entry.path)
        } catch {
          throw new LibraryError(`原文件已不在：${entry.path}`, {
            code: 'item-not-found',
            hint: '重新扫描来源可把失效条目清掉。',
          })
        }
        await revealInFinder(entry.path)
        return { status: 200, payload: { ok: true, data: { revealed: true, path: entry.path } } }
      }
      if (segments[0] === 'sources') {
        const source = await lib.addSource({
          name: String(body.name || ''),
          path: String(body.path || ''),
          depth: Number(body.depth) || 6,
        })
        return { status: 201, payload: { ok: true, data: { source, sources: await lib.sources() } } }
      }
      return { status: 404, payload: { ok: false, error: { message: `Unknown route: POST ${route}`, code: 'not-found' } } }
    }

    if (verb === 'PATCH') {
      const body = parseJson(bodyText)
      if (segments[0] === 'items' && segments[1]) {
        const item = await lib.update(decodeURIComponent(segments[1]), {
          ...(typeof body.title === 'string' ? { title: body.title } : {}),
          ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
          ...(typeof body.collection === 'string' ? { collection: body.collection } : {}),
          ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
          ...(typeof body.content === 'string' ? { content: body.content } : {}),
        })
        void briefer.refresh()
        return { status: 200, payload: { ok: true, data: { item } } }
      }
      return { status: 404, payload: { ok: false, error: { message: `Unknown route: PATCH ${route}`, code: 'not-found' } } }
    }

    if (verb === 'DELETE') {
      if (segments[0] === 'items' && segments[1] && segments[2] === 'purge') {
        const id = decodeURIComponent(segments[1])
        await lib.purge(id)
        void briefer.refresh()
        return { status: 200, payload: { ok: true, data: { id } } }
      }
      if (segments[0] === 'items' && segments[1]) {
        const item = await lib.remove(decodeURIComponent(segments[1]))
        void briefer.refresh()
        return { status: 200, payload: { ok: true, data: { item } } }
      }
      if (segments[0] === 'sources' && segments[1]) {
        const id = decodeURIComponent(segments[1])
        await lib.removeSource(id)
        void briefer.refresh()
        return { status: 200, payload: { ok: true, data: { id } } }
      }
      return { status: 404, payload: { ok: false, error: { message: `Unknown route: DELETE ${route}`, code: 'not-found' } } }
    }

    return { status: 405, payload: { ok: false, error: { message: `Method not allowed: ${method}`, code: 'method-not-allowed' } } }
  } catch (error) {
    return {
      status: httpStatusFor(error),
      payload: { ok: false, error: { message: (error && error.message) || String(error), code: (error && error.code) || 'internal' } },
    }
  }
}

function createRouteHandler(services) {
  return async (req, res) => {
    const method = req.method || 'GET'
    const headers = req.headers || {}
    try {
      let pathname = '/'
      let searchParams = new URLSearchParams()
      try {
        const url = new URL(req.url || '/', `http://${headers.host || '127.0.0.1'}`)
        pathname = url.pathname
        searchParams = url.searchParams
      } catch {
        sendJson(res, method, 400, { ok: false, error: { message: 'Malformed request URL.', code: 'invalid-argument' } })
        return
      }
      let bodyText = ''
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') bodyText = await readBody(req)
      const result = await dispatchRoute({
        method,
        pathname,
        searchParams,
        headers,
        bodyText,
        connection: services.ctx.get('connection'),
        root: services.root,
        getLibrary: services.getLibrary,
        briefer: services.briefer,
      })
      if (result.raw) {
        await sendRaw(res, method, result.raw.entry, result.raw.root)
        return
      }
      if (result.file) {
        await sendFile(res, method, result.file.path, result.file.mime)
        return
      }
      sendJson(res, method, result.status, result.payload)
    } catch (error) {
      sendJson(res, method, httpStatusFor(error), {
        ok: false,
        error: { message: (error && error.message) || String(error), code: (error && error.code) || 'internal' },
      })
    }
  }
}

// ------------------------------------------------------------- prompt text

function protocolText() {
  return [
    '## Context library（本机资源库）',
    '本机已挂载一个上下文资源库（`context_lib_*` 工具）：文档、脚本、图片、数据、会话、笔记都在里面，按标题/标签/路径/正文摘要检索。',
    '- 找资料：`context_lib_search` 先查库（可带 kind/collection/tag 过滤）；命中后 `context_lib_read(id)`。',
    '- 二进制（图片/PDF）用 `context_lib_read` 拿本机路径，再交给 `read_image`。',
    '- 沉淀：`context_lib_put` 写笔记；`context_lib_update` 改标签/归类；`context_lib_delete` 软删。',
    '- 维护：`context_lib_scan` 增量扫描；`context_lib_sources` 增删来源；`context_lib_stats` 看概况。',
    '库里有答案时优先用库，查不到再联网。',
  ].join('\n')
}

// ------------------------------------------------------------------ plugin

export function apply(ctx, rawConfig) {
  const { config, warnings } = readConfig(rawConfig)
  const root = resolveRoot({ rootDir: config.rootDir })

  const libraryPromise = Promise.resolve(
    createLibrary(root, {
      maxEntries: config.maxEntries,
      maxPreviewChars: config.maxPreviewChars,
    }),
  ).then((library) => library.init().then(() => library))
  // 失败不要变成 unhandled rejection：工具与面板各自会拿到同一个错误。
  libraryPromise.catch(() => {})
  const getLibrary = () => libraryPromise

  const briefer = createBriefer(getLibrary, config)

  for (const definition of buildTools({ getLibrary })) {
    ctx.effect(() => ctx.tools.register(definition))
  }

  if (config.protocolSection) {
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: Number.isFinite(ctx.systemPrompt.getSectionOrder('TOOL_GOAL'))
          ? ctx.systemPrompt.getSectionOrder('TOOL_GOAL') + 50
          : 2450,
        text: protocolText(),
        interpolate: false,
      }),
    )
  }

  if (config.briefing === 'context') {
    ctx.effect(() =>
      ctx.systemPrompt.context({
        name: 'context-lib-briefing',
        order: 132,
        text: () => briefer.current(),
        interpolate: false,
      }),
    )
    ctx.effect(() => {
      const dispose = ctx.on('agent/created', () => {
        void briefer.refresh()
      })
      return typeof dispose === 'function' ? dispose : () => {}
    })
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() =>
      webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createRouteHandler({ ctx: webCtx, root, getLibrary, briefer }),
      }),
    )
  })

  // 首屏简报：启动时预热，避免第一轮对话看到空文本。
  void briefer.refresh()

  if (config.autoScan) {
    void libraryPromise
      .then((library) => library.sources())
      .then(async (sources) => {
        for (const source of sources) {
          try {
            await (await libraryPromise).scan({ sourceId: source.id })
          } catch {
            /* 单源失败不影响插件加载 */
          }
        }
        void briefer.refresh()
      })
      .catch(() => {})
  }

  for (const warning of warnings) console.warn(`[context-lib] ${warning}`)
}
