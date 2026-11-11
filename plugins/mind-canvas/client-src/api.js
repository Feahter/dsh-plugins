// 与宿主半片通信。同源相对路径，Web 端和桌面端都一样。
const BASE = '/mind-canvas'

async function request(path, { method = 'GET', body, signal } = {}) {
  const init = {
    method,
    signal,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let response
  try {
    response = await fetch(BASE + path, init)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new Error(`网络请求失败：${error?.message ?? '未知错误'}`)
  }
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.error ?? payload?.message ?? `HTTP ${response.status}`
    const error = new Error(String(message))
    error.status = response.status
    throw error
  }
  return payload
}

export function getState(options) {
  return request('/state', options)
}

export function putState(state, options) {
  return request('/state', { ...options, method: 'PUT', body: state })
}

export function listInspirations(options) {
  return request('/inspirations', options)
}

export function expandNode(payload, options) {
  return request('/expand', { ...options, method: 'POST', body: payload })
}
