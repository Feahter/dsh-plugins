// 路由层的小工具：JSON 收发、请求体读取、错误形状。
// 与 mind-canvas 保持同一套规矩：同源、JSON、上限、错误码统一。

export const MAX_BODY_BYTES = 10 * 1024 * 1024

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** 读 JSON 请求体；空体返回 null；超限/坏 JSON 抛带 status 的错误。 */
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('请求体太大')
        error.status = 413
        error.code = 'TOO_LARGE'
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve(null)
      try {
        resolve(JSON.parse(text))
      } catch {
        const error = new Error('请求体不是合法 JSON')
        error.status = 400
        error.code = 'BAD_BODY'
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function httpError(status, code, message, detail) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

/** ForgeError.code → HTTP status。未知错误统一 500。 */
export const CODE_STATUS = {
  NOT_FOUND: 404,
  BAD_PARAMS: 400,
  BAD_STAGE: 400,
  BAD_BODY: 400,
  BAD_RECIPE: 500,
  RUN_ACTIVE: 409,
  CONFLICT: 409,
  ARTIFACT_MISSING: 404,
  ARTIFACT_CORRUPT: 500,
  TOO_LARGE: 413,
  LLM_UNAVAILABLE: 503,
  LLM_ERROR: 502,
  LLM_ABORTED: 409,
  LLM_PARSE: 502,
  LLM_EMPTY: 502,
  LLM_AUTH: 400,
  LLM_TIMEOUT: 504,
  LLM_TRUNCATED: 502,
  LLM_CONTEXT: 400,
  LLM_QUOTA: 402,
  EXPORT_FAILED: 500,
}

export function statusForError(error) {
  if (Number.isInteger(error?.status)) return error.status
  return CODE_STATUS[error?.code] ?? 500
}
