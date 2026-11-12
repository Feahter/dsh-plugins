// 与宿主 REST 约定（docs/architecture.md §5.2）的唯一出口。
// 所有路径同源相对，前缀 /novel-forge；非 2xx 一律抛带 code 的 Error。

const BASE = '/novel-forge'

/** 统一的请求封装：JSON in / JSON out，错误信息优先取 error.message。 */
async function request(path, { method = 'GET', body, signal } = {}) {
  const init = {
    method,
    headers: { accept: 'application/json' },
    signal,
  }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`${BASE}${path}`, init)
  } catch (error) {
    // 网络层失败（宿主没起来 / 被中断）也给出可读中文。
    if (error?.name === 'AbortError') throw error
    throw new Error(`连不上墨炉服务：${error?.message ?? error}`)
  }

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`)
    error.code = payload?.error?.code || `HTTP_${response.status}`
    error.detail = payload?.error?.detail
    error.status = response.status
    throw error
  }
  return payload
}

const id = value => encodeURIComponent(String(value ?? ''))

// ------------------------------------------------------------------ 项目
export const listProjects = () => request('/projects').then(data => data?.projects ?? [])

export const createProject = payload => request('/projects', { method: 'POST', body: payload }).then(data => data.project)

export const getProject = projectId => request(`/projects/${id(projectId)}`)

export const patchProject = (projectId, patch) =>
  request(`/projects/${id(projectId)}`, { method: 'PATCH', body: patch }).then(data => data.project)

export const deleteProject = projectId => request(`/projects/${id(projectId)}`, { method: 'DELETE' })

export const estimateProject = projectId => request(`/projects/${id(projectId)}/estimate`).then(data => data.estimate)

export const estimateNew = (params, recipeId = 'novel') =>
  request('/estimate', { method: 'POST', body: { recipeId, params } }).then(data => data.estimate)

// ------------------------------------------------------------------ 产物
export const getArtifact = (projectId, key) =>
  request(`/projects/${id(projectId)}/artifact?key=${encodeURIComponent(key)}`).then(data => data.artifact)

export const putArtifact = (projectId, { key, kind, content }) =>
  request(`/projects/${id(projectId)}/artifact`, { method: 'PUT', body: { key, kind, content } }).then(data => data.artifact)

// ------------------------------------------------------------------ 运行
export const getRun = (projectId, after = 0) =>
  request(`/projects/${id(projectId)}/run${after ? `?after=${encodeURIComponent(after)}` : ''}`)

export const startRun = (projectId, options = {}) =>
  request(`/projects/${id(projectId)}/run`, { method: 'POST', body: options }).then(data => data.run)

export const cancelRun = projectId =>
  request(`/projects/${id(projectId)}/run/cancel`, { method: 'POST' }).then(data => data.run)

export const listRuns = projectId => request(`/projects/${id(projectId)}/runs`).then(data => data.runs ?? [])

export const continueReview = (projectId, options = {}) =>
  request(`/projects/${id(projectId)}/review/continue`, { method: 'POST', body: options }).then(data => data.run)

// ------------------------------------------------------------------ 导出
export const exportProject = (projectId, format) =>
  // 直接返回 { filename, path, mime, bytes }：再包一层 export 会让调用方二次解包成 undefined。
  request(`/projects/${id(projectId)}/export`, { method: 'POST', body: { format } }).then(data => data?.export ?? data)

// ------------------------------------------------------------------ 其他
export const getRecipes = () => request('/recipes').then(data => data.recipes ?? [])

export const getModel = () => request('/model')
