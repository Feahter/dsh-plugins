/**
 * 智能助手：快速总结、批量整理归类、自然语言找资料。
 *
 * 模型调用照抄 dsh-media-desk 的成熟用法：从宿主 ctx 取 `llm` 与
 * `agentDefaultModel`，不单独配密钥；模型不可用时显式报 assist-unavailable。
 *
 * 契约见 ../docs/API.md §6（GET /assist/status、POST /assist）。
 * 所有输出都要过一遍「只认契约字段」的清洗：模型多给的、给错的都丢掉，
 * 不让脏数据进面板，也不因为模型发挥失常就 500。
 */

import { randomUUID } from 'node:crypto'

import { LibraryError } from './store.js'

/** 插件在会话之外调模型，自己带一个会话标识（网关可能按会话路由）。 */
export const ASSIST_SESSION_ID = `dsh-context-lib-assist-${randomUUID()}`

const TIMEOUT_MS = 90_000
const SUMMARY_MAX_CHARS = 6000
const ORGANIZE_MAX_ITEMS = 30
const ORGANIZE_PREVIEW_CHARS = 300
const MAX_QUESTION = 2000
const MAX_FILTER_Q = 200
const MAX_TAGS = 8
const MAX_TAG_CHARS = 32
const MAX_COLLECTION_CHARS = 40
const MAX_TITLE_CHARS = 80
const MAX_REASON_CHARS = 300
const SNAPSHOT_MAX_CHARS = 1500
const RAW_ECHO_CHARS = 300
const KINDS = ['doc', 'script', 'image', 'data', 'session', 'note', 'other']
const KIND_SET = new Set(KINDS)

const SUMMARY_SYSTEM = [
  '你是「上下文资源库」的整理助手。',
  '只输出 JSON，不要输出解释、前言、Markdown 围栏或其他任何文字。',
].join('\n')

const ORGANIZE_SYSTEM = [
  '你是「上下文资源库」的归类助手。',
  '只输出 JSON，不要输出解释、前言、Markdown 围栏或其他任何文字。',
].join('\n')

const ASK_SYSTEM = [
  '你是「上下文资源库」的检索助手。',
  '只输出 JSON，不要输出解释、前言、Markdown 围栏或其他任何文字。',
].join('\n')

// ------------------------------------------------------------------ status

function selectionOf(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    return selection?.provider && selection?.model
      ? { provider: selection.provider, model: selection.model }
      : null
  } catch {
    return null
  }
}

/** 不给 ctx.get 抛错的机会：面板的 status 探测必须总是能答话。 */
export function assistStatus(ctx) {
  const missing = { ready: false, model: null, reason: '插件上下文不可用，拿不到模型服务。' }
  if (!ctx || typeof ctx.get !== 'function') return missing
  let llm = null
  try {
    llm = ctx.get('llm')
  } catch {
    return missing
  }
  const selection = selectionOf(ctx)
  if (!llm || typeof llm.prepareCall !== 'function') {
    return { ready: false, model: null, reason: '当前 Harness 没有 llm 服务，模型调用不可用。' }
  }
  if (!selection) {
    return { ready: false, model: null, reason: '没有默认模型：请在 Harness 里选一个 agent 默认模型。' }
  }
  return { ready: true, model: selection.model, reason: null }
}

// -------------------------------------------------------------- model call

async function callModel(ctx, { system, user, maxTokens }) {
  const status = assistStatus(ctx)
  if (!status.ready) {
    throw new LibraryError(`智能助手当前不可用：${status.reason}`, {
      code: 'assist-unavailable',
      hint: '在 Harness 里配置默认模型后重试。',
    })
  }
  const llm = ctx.get('llm')
  const selection = selectionOf(ctx)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const call = await llm.prepareCall(
      { provider: selection.provider, model: selection.model, maxTokens },
      controller.signal,
      (controls) => controls,
    )
    let text = ''
    for await (const chunk of call.stream({
      ...call.config,
      system,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: user }],
          source: { kind: 'dsh-context-lib-assist' },
        },
      ],
      sessionId: ASSIST_SESSION_ID,
      signal: controller.signal,
    })) {
      if (chunk.type === 'text-delta') {
        text += chunk.text ?? ''
      } else if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
        throw new LibraryError(`模型调用失败：${chunk.reason?.failure?.message || chunk.reason.kind}`, {
          code: 'assist-failed',
        })
      }
    }
    if (!text.trim()) throw new LibraryError('模型没有返回任何文本。', { code: 'assist-failed' })
    return { text, model: selection.model }
  } catch (error) {
    if (error instanceof LibraryError) throw error
    const message = controller.signal.aborted
      ? `模型调用超时（${TIMEOUT_MS / 1000} 秒）。`
      : `模型调用失败：${(error && error.message) || String(error)}`
    throw new LibraryError(message, { code: 'assist-failed' })
  } finally {
    clearTimeout(timer)
  }
}

/** 从模型输出里取 JSON：先去 ``` 围栏，再取第一个 { 到最后一个 }。 */
export function extractJson(text) {
  const source = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  const raw = String(text ?? '').trim().slice(0, RAW_ECHO_CHARS)
  if (start < 0 || end <= start) {
    throw new LibraryError(`模型输出不是 JSON（原始文本前 ${RAW_ECHO_CHARS} 字符：${raw || '空'}）`, {
      code: 'assist-failed',
    })
  }
  try {
    const value = JSON.parse(source.slice(start, end + 1))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value
  } catch {
    throw new LibraryError(`模型输出的 JSON 解析失败（原始文本前 ${RAW_ECHO_CHARS} 字符：${raw || '空'}）`, {
      code: 'assist-failed',
    })
  }
}

// ----------------------------------------------------------------- helpers

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanTags(value, max = MAX_TAGS) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const tags = []
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().slice(0, MAX_TAG_CHARS)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= max) break
  }
  return tags
}

function cleanCollection(value) {
  return textOf(value).slice(0, MAX_COLLECTION_CHARS)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function librarySnapshot(stats) {
  const counts = stats?.counts || {}
  const kinds = Object.entries(counts.byKind || {})
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ')
  const collections = (stats?.collections || []).map((item) => `${item.name}(${item.count})`)
  const tags = (stats?.tags || []).slice(0, 60).map((item) => `${item.name}(${item.count})`)
  const sources = (stats?.sources || []).map((item) => `${item.name}(${item.count})`)
  return [
    `条目数：${counts.active ?? 0}；按类型：${kinds || '无'}`,
    `归类：${collections.join(', ') || '无'}`,
    `标签：${tags.join(', ') || '无'}`,
    `来源：${sources.join(', ') || '无'}`,
  ]
    .join('\n')
    .slice(0, SNAPSHOT_MAX_CHARS)
}

// ------------------------------------------------------------------- modes

async function runSummary(ctx, lib, body) {
  const id = textOf(body.id)
  if (!id) throw new LibraryError('summary 需要 id。', { code: 'invalid-argument' })
  const entry = await lib.get(id)
  if (!entry) throw new LibraryError(`条目 ${id} 不存在。`, { code: 'item-not-found' })
  const content = await lib.readText(id, { maxChars: SUMMARY_MAX_CHARS })
  const user = [
    '请为下面这条资源写一段总结（120 字以内），并给出更合适的归类、标签与标题。',
    '',
    `id: ${entry.id}`,
    `标题: ${entry.title}`,
    `类型: ${entry.kind}`,
    `现有归类: ${entry.collection}`,
    `现有标签: ${entry.tags.join(', ') || '无'}`,
    '正文（可能被截断）：',
    '"""',
    content.text || entry.preview || '',
    '"""',
    '',
    '只输出一个 JSON 对象：',
    '{"summary":"...","tags":["..."],"collection":"...","title":"..."}',
    `要求：tags 最多 ${MAX_TAGS} 个短标签；collection 是简短归类名（可沿用现有归类）；title 不超过 60 字；不要编造正文里没有的事实。`,
  ].join('\n')

  const result = await callModel(ctx, { system: SUMMARY_SYSTEM, user, maxTokens: 1200 })
  const parsed = extractJson(result.text)
  const summary = textOf(parsed.summary)
  if (!summary) throw new LibraryError('模型没有给出 summary 字段。', { code: 'assist-failed' })
  const actions = {}
  const title = textOf(parsed.title).slice(0, MAX_TITLE_CHARS)
  if (title) actions.title = title
  const tags = cleanTags(parsed.tags)
  if (tags.length) actions.tags = tags
  const collection = cleanCollection(parsed.collection)
  if (collection) actions.collection = collection
  return {
    mode: 'summary',
    model: result.model,
    text: summary,
    actions: Object.keys(actions).length ? actions : null,
  }
}

async function runOrganize(ctx, lib, body) {
  const raw = body.ids
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ORGANIZE_MAX_ITEMS) {
    throw new LibraryError(`organize 需要 1..${ORGANIZE_MAX_ITEMS} 个 id。`, { code: 'invalid-argument' })
  }
  const ids = []
  for (const value of raw) {
    const id = textOf(value)
    if (id && !ids.includes(id)) ids.push(id)
  }
  if (!ids.length) throw new LibraryError('organize 需要至少一个有效 id。', { code: 'invalid-argument' })

  const entries = []
  for (const id of ids) {
    const entry = await lib.get(id)
    if (entry) entries.push(entry)
  }
  if (!entries.length) throw new LibraryError('这些条目都不存在。', { code: 'item-not-found' })

  const input = entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    collection: entry.collection,
    tags: entry.tags,
    preview: String(entry.preview ?? '').slice(0, ORGANIZE_PREVIEW_CHARS),
  }))
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const user = [
    '请整理下面这些资源，为每条重新给出归类、标签和一句简短理由。',
    '条目（JSON）：',
    JSON.stringify(input),
    '',
    '只输出一个 JSON 对象：',
    '{"items":[{"id":"...","collection":"...","tags":["..."],"reason":"..."}]}',
    '要求：id 必须是上面出现过的 id；tags 0..8 个短标签；collection 是简短归类名；reason 一句话说明为什么这样归类。',
  ].join('\n')

  const result = await callModel(ctx, { system: ORGANIZE_SYSTEM, user, maxTokens: 2500 })
  const parsed = extractJson(result.text)
  if (!Array.isArray(parsed.items)) {
    throw new LibraryError('模型输出缺少 items 数组。', { code: 'assist-failed' })
  }
  const seen = new Set()
  const items = []
  for (const value of parsed.items) {
    if (!isPlainObject(value)) continue
    const id = textOf(value.id)
    if (!id || !byId.has(id) || seen.has(id)) continue
    seen.add(id)
    const entry = byId.get(id)
    items.push({
      id,
      collection: cleanCollection(value.collection) || entry.collection,
      tags: cleanTags(value.tags),
      reason: textOf(value.reason).slice(0, MAX_REASON_CHARS),
    })
  }
  return { mode: 'organize', model: result.model, text: `已整理 ${items.length} 条资源。`, actions: { items } }
}

async function runAsk(ctx, lib, body) {
  const question = textOf(body.question)
  if (!question) throw new LibraryError('ask 需要 question。', { code: 'invalid-argument' })
  if (question.length > MAX_QUESTION) {
    throw new LibraryError(`question 不能超过 ${MAX_QUESTION} 字符。`, { code: 'invalid-argument' })
  }
  const stats = await lib.stats()
  const snapshot = librarySnapshot(stats)
  const user = [
    `用户的问题：${question}`,
    '',
    '库现状：',
    snapshot,
    '',
    '请先回答问题；如果用户想找资料，再给出可选的检索过滤条件。',
    '只输出一个 JSON 对象：',
    '{"answer":"...","filters":{"q":"...","kind":"doc|script|image|data|session|note|other","collection":"...","tag":"..."}}',
    '要求：filters 可以省略字段；q 是检索关键词（不超过 200 字符）；kind/collection/tag 必须取上面「库现状」里出现过的值；不要输出其他字段。',
  ].join('\n')

  const result = await callModel(ctx, { system: ASK_SYSTEM, user, maxTokens: 1500 })
  const parsed = extractJson(result.text)
  const answer = textOf(parsed.answer)
  if (!answer) throw new LibraryError('模型没有给出 answer 字段。', { code: 'assist-failed' })

  const rawFilters = isPlainObject(parsed.filters) ? parsed.filters : {}
  const collections = new Set((stats.collections || []).map((item) => item.name))
  const tags = new Set((stats.tags || []).map((item) => item.name))
  const filters = {}
  const q = textOf(rawFilters.q).slice(0, MAX_FILTER_Q)
  if (q) filters.q = q
  const kind = textOf(rawFilters.kind)
  if (KIND_SET.has(kind)) filters.kind = kind
  const collection = textOf(rawFilters.collection)
  if (collection && collections.has(collection)) filters.collection = collection
  const tag = textOf(rawFilters.tag)
  if (tag && tags.has(tag)) filters.tag = tag
  return { mode: 'ask', model: result.model, text: answer, actions: { filters } }
}

// ------------------------------------------------------------------ export

/** 校验入参 → 调模型 → 清洗成面板契约。任何失败都抛 LibraryError。 */
export async function runAssist({ ctx, lib, body }) {
  const mode = textOf(body?.mode)
  if (!['summary', 'organize', 'ask'].includes(mode)) {
    throw new LibraryError(`未知的助手模式：${mode || '(空)'}`, {
      code: 'invalid-argument',
      hint: 'mode 只能是 summary / organize / ask。',
    })
  }
  if (mode === 'summary') return runSummary(ctx, lib, body)
  if (mode === 'organize') return runOrganize(ctx, lib, body)
  return runAsk(ctx, lib, body)
}
