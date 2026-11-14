// 与宿主半片通信：统一前缀 /api/context-lib，返回 {ok:true,data} / {ok:false,error}。
const BASE = '/api/context-lib'

function buildQuery(query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

function makeError(message, payload, status) {
  const error = new Error(String(message))
  error.code = payload?.error?.code
  error.hint = payload?.error?.hint
  error.status = status
  return error
}

/**
 * request('/items', { method: 'POST', body: {...}, signal })
 * 非 2xx 或 ok:false 都抛 Error（带 code/hint/status），调用方只需 try/catch。
 */
export async function request(path, init = {}) {
  const { method = 'GET', body, signal, headers } = init
  const options = {
    method,
    signal,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(headers ?? {}) },
  }
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  let response
  try {
    response = await fetch(BASE + path, options)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw makeError(`网络请求失败：${error?.message ?? '未知错误'}`, null, 0)
  }
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok || payload?.ok === false) {
    const message = payload?.error?.message ?? payload?.message ?? (text && !payload ? text : `HTTP ${response.status}`)
    throw makeError(message, payload, response.status)
  }
  if (payload && typeof payload === 'object' && 'ok' in payload) return payload.data
  return payload
}

export function getState(options) {
  return request('/state', options)
}

export function getItems(query = {}, options = {}) {
  return request(`/items${buildQuery(query)}`, options)
}

export function getItem(id, options) {
  return request(`/items/${encodeURIComponent(id)}`, options)
}

export function getContent(id, { maxChars, startLine, endLine, signal } = {}) {
  return request(`/items/${encodeURIComponent(id)}/content${buildQuery({ maxChars, startLine, endLine })}`, { signal })
}

export function rawUrl(id) {
  return `${BASE}/items/${encodeURIComponent(id)}/raw`
}

/** 文档预览：{kind:'text'|'thumb'|'image'|'none', text?, url?, note?}。 */
export function getPreview(id, { maxChars, signal } = {}) {
  return request(`/items/${encodeURIComponent(id)}/preview${buildQuery({ maxChars })}`, { signal })
}

export function thumbUrl(id) {
  return `${BASE}/items/${encodeURIComponent(id)}/thumb`
}

export function createItem(payload, options) {
  return request('/items', { ...options, method: 'POST', body: payload })
}

export function updateItem(id, patch, options) {
  return request(`/items/${encodeURIComponent(id)}`, { ...options, method: 'PATCH', body: patch })
}

export function deleteItem(id, options) {
  return request(`/items/${encodeURIComponent(id)}`, { ...options, method: 'DELETE' })
}

export function restoreItem(id, options) {
  return request(`/items/${encodeURIComponent(id)}/restore`, { ...options, method: 'POST' })
}

export function purgeItem(id, options) {
  return request(`/items/${encodeURIComponent(id)}/purge`, { ...options, method: 'DELETE' })
}

/** 在访达里选中这个条目对应的原文件（宿主执行 open -R）。 */
export function revealItem(id, options) {
  return request(`/items/${encodeURIComponent(id)}/reveal`, { ...options, method: 'POST' })
}

export function scanSources({ sourceId, force = false } = {}, options) {
  return request('/scan', { ...options, method: 'POST', body: { sourceId, force } })
}

export function listSources(options) {
  return request('/sources', options)
}

export function addSource(payload, options) {
  return request('/sources', { ...options, method: 'POST', body: payload })
}

export function removeSource(id, options) {
  return request(`/sources/${encodeURIComponent(id)}`, { ...options, method: 'DELETE' })
}

export function getTrash({ limit = 50, offset = 0 } = {}, options) {
  return request(`/trash${buildQuery({ limit, offset })}`, options)
}

/** 智能助手就绪状态：{ready, model, reason}；未就绪时 model 为 null。 */
export function getAssistStatus(options) {
  return request('/assist/status', options)
}

/**
 * 智能助手：{mode:'summary', id} / {mode:'organize', ids} / {mode:'ask', question}。
 * 返回 {mode, model, text, actions}，错误沿用 request() 的抛错约定。
 */
export function assist(payload, options) {
  return request('/assist', { ...options, method: 'POST', body: payload })
}
