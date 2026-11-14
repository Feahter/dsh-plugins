/**
 * Minimal HTTP plumbing for the voice-companion routes.
 *
 * JSON in, JSON out, `no-store`, same-origin only. Kept dependency-free so the
 * route layer can be unit-tested with plain request/response stand-ins.
 */

/** @type {const} */
const JSON_TYPE = 'application/json; charset=utf-8'

/** Hard cap for any request body on these routes. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/**
 * An error that already knows its HTTP shape. Route-level code uses this for
 * caller mistakes (400) and missing local services (503); `classifyError`
 * otherwise maps plain errors.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @returns {Error & { status: number, code: string }}
 */
export function httpError(status, code, message) {
  const error = new Error(message)
  return Object.assign(error, { status, code })
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(response, status, payload) {
  if (response.writableEnded || response.destroyed) return
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': JSON_TYPE,
    'cache-control': 'no-store',
    'content-length': String(body.length),
  })
  response.end(body)
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
export function sendFailure(response, status, code, message, extra = {}) {
  sendJson(response, status, { ok: false, code, message, ...extra })
}

/**
 * Read a request body with a hard size cap.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} [limit]
 * @returns {Promise<{ ok: true, body: Buffer } | { ok: false, status: number, code: string, message: string }>}
 */
export function readBody(request, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    if (request.readableEnded) {
      resolve({ ok: true, body: Buffer.alloc(0) })
      return
    }
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
      resolve(result)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) {
        settle({ ok: false, status: 413, code: 'too-long', message: `request body exceeds ${limit} bytes` })
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => settle({ ok: true, body: Buffer.concat(chunks) })
    const onError = () => settle({ ok: false, status: 400, code: 'invalid', message: 'request body could not be read' })
    const onAborted = () => settle({ ok: false, status: 0, code: 'cancelled', message: 'client disconnected' })
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onAborted)
  })
}

/**
 * Only accept a request whose Origin matches the serving Host. A missing
 * Origin (curl, some same-origin fetches) is allowed because these routes sit
 * behind the Host's own auth anyway.
 * @param {import('node:http').IncomingMessage} request
 * @param {() => string | undefined} getOrigin
 * @returns {boolean}
 */
export function originAllowed(request, getOrigin) {
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  let expected
  try {
    expected = getOrigin()
  } catch {
    expected = undefined
  }
  if (expected === undefined || expected === '') return true
  try {
    return new URL(origin).host === new URL(expected).host
  } catch {
    return false
  }
}

/**
 * Wrap a JSON POST handler with method, origin and body parsing.
 * @param {object} options
 * @param {(payload: any, request: import('node:http').IncomingMessage) => Promise<{ status?: number, body: unknown }>} options.handle
 * @param {() => string | undefined} [options.getOrigin]
 * @param {string} [options.method]
 */
export function jsonRoute({ handle, getOrigin = () => undefined, method = 'POST' }) {
  return async function route(request, response) {
    try {
      if (request.method !== method) {
        if (!response.writableEnded) response.writeHead(405, { allow: method }).end()
        return
      }
      if (!originAllowed(request, getOrigin)) {
        sendFailure(response, 403, 'forbidden', 'cross-origin request rejected')
        return
      }
      const raw = await readBody(request)
      if (!raw.ok) {
        if (raw.code === 'cancelled') return
        sendFailure(response, raw.status, raw.code, raw.message)
        return
      }
      let payload = {}
      const text = raw.body.toString('utf8').trim()
      if (text !== '') {
        try {
          payload = JSON.parse(text)
        } catch {
          sendFailure(response, 400, 'invalid', '请求体不是合法的 JSON')
          return
        }
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        sendFailure(response, 400, 'invalid', '请求体必须是一个 JSON 对象')
        return
      }
      const result = await handle(payload, request)
      sendJson(response, result.status ?? 200, result.body)
    } catch (error) {
      const failure = classifyError(error)
      sendFailure(response, failure.status, failure.code, failure.message)
    }
  }
}

/**
 * Map a thrown handler error onto a client-actionable status.
 *
 * `sessionController` reports a missing Session as a plain Error whose message
 * says "not found"; that is the caller's mistake, not a broken Host, so it must
 * not surface as 500 and read like a crash in the HUD.
 * @param {unknown} error
 * @returns {{ status: number, code: string, message: string }}
 */
export function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const candidate = /** @type {{ status?: unknown, code?: unknown }} */ (error)
  if (typeof candidate?.status === 'number' && typeof candidate?.code === 'string') {
    return { status: candidate.status, code: candidate.code, message }
  }
  if (/\bnot found\b/i.test(message)) return { status: 404, code: 'not-found', message }
  if (/\binvalid\b.*\b(wav|audio)\b/i.test(message)) return { status: 415, code: 'unsupported-audio', message: 'audio must be 16 kHz mono 16-bit PCM WAV' }
  return { status: 500, code: 'failed', message }
}

/**
 * Wrap a plain GET handler.
 * @param {(request: import('node:http').IncomingMessage) => Promise<{ status?: number, body: unknown }>} handle
 */
export function getRoute(handle) {
  return async function route(request, response) {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        if (!response.writableEnded) response.writeHead(405, { allow: 'GET' }).end()
        return
      }
      const result = await handle(request)
      sendJson(response, result.status ?? 200, result.body)
    } catch (error) {
      const failure = classifyError(error)
      sendFailure(response, failure.status, failure.code, failure.message)
    }
  }
}
