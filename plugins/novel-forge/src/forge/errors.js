/**
 * 通用创作引擎错误类型。
 *
 * code 是宿主/客户端之间唯一的稳定契约，message 只用于人读。
 */

export const ERROR_CODES = Object.freeze([
  'NOT_FOUND',
  'BAD_PARAMS',
  'BAD_STAGE',
  'RUN_ACTIVE',
  'ARTIFACT_MISSING',
  'ARTIFACT_CORRUPT',
  'TOO_LARGE',
  'LLM_UNAVAILABLE',
  'LLM_ERROR',
  'LLM_ABORTED',
  'LLM_PARSE',
  'LLM_EMPTY',
  'BAD_RECIPE',
  'EXPORT_FAILED',
  'CONFLICT',
  'INTERNAL',
])

export class ForgeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [detail]
   */
  constructor(code, message, detail) {
    super(String(message))
    this.name = 'ForgeError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }

  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail }
  }
}

export function isForgeError(err) {
  return err instanceof ForgeError
}

/**
 * 把任意异常收敛成 ForgeError，保留原异常在 cause 上。
 * @param {unknown} err
 * @param {string} [fallbackCode]
 */
export function asForgeError(err, fallbackCode = 'INTERNAL') {
  if (err instanceof ForgeError) return err
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err)
  const wrapped = new ForgeError(fallbackCode, message, undefined)
  wrapped.cause = err
  return wrapped
}

/** HTTP 状态码映射（宿主直接使用）。 */
export const HTTP_STATUS = Object.freeze({
  NOT_FOUND: 404,
  BAD_PARAMS: 400,
  BAD_STAGE: 400,
  RUN_ACTIVE: 409,
  CONFLICT: 409,
  TOO_LARGE: 413,
  LLM_UNAVAILABLE: 502,
  LLM_ERROR: 502,
  LLM_ABORTED: 502,
  LLM_PARSE: 502,
  LLM_EMPTY: 502,
  ARTIFACT_MISSING: 404,
  ARTIFACT_CORRUPT: 500,
  BAD_RECIPE: 500,
  EXPORT_FAILED: 500,
  INTERNAL: 500,
})

export function httpStatusFor(code) {
  return HTTP_STATUS[code] ?? 500
}
