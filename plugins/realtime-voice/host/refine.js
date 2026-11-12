/**
 * Host-side HTTP contract for the realtime-voice plugin.
 *
 * The module is deliberately Cordis-free: handlers receive their dependencies
 * (translator lookup, server origin, logger) as plain functions, so the exact
 * wire contract can be driven by `node --test` without a running Harness.
 *
 * Routes:
 *   GET  /plugins/realtime-voice/health
 *   POST /plugins/realtime-voice/refine
 */

export const ROUTES = Object.freeze({
  health: '/plugins/realtime-voice/health',
  refine: '/plugins/realtime-voice/refine',
})

/** HTTP contract version reported by the health route (not the npm package version). */
export const HOST_API_VERSION = '0.2.0'

/** Same ceiling the on-device translator enforces; counted in UTF-16 code units. */
export const MAX_TEXT_CHARS = 4000

/** Hard cap for a refine request body; anything larger is answered 413 and destroyed. */
export const MAX_BODY_BYTES = 64 * 1024

/** Safety net on top of the translator's own 10s provider deadline. */
export const DEFAULT_TIMEOUT_MS = 20_000

/** Providers this route accepts. Paid DeepSeek routes need a durable Session, which this API has no way to supply. */
export const TRANSLATE_PROVIDERS = Object.freeze(['bing', 'google', 'google-direct'])

/**
 * Anonymous Google Translate endpoint, the same protocol the browser widget
 * uses. It keeps translation working on a profile that never installed the
 * opt-in `translator` service; when that service is mounted it wins, because it
 * lets the user pick a provider and honours the Host's own limits.
 */
export const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'

/** Upstream deadline for the direct path; the request-level guard is longer. */
const GOOGLE_TIMEOUT_MS = 9_000

/** Short tag → upstream tag. Unknown tags pass through unchanged. */
function languageTag(value, fallback) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === '' || raw === 'auto') return fallback
  const table = {
    zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', en: 'en', ja: 'ja', ko: 'ko',
    fr: 'fr', de: 'de', es: 'es', ru: 'ru', pt: 'pt', it: 'it', ar: 'ar', hi: 'hi',
    th: 'th', vi: 'vi', id: 'id', tr: 'tr', nl: 'nl', pl: 'pl',
  }
  return table[raw] ?? raw
}

/** Collapse the `translate_a/single` payload into one string. */
export function readGoogleTranslation(body) {
  if (!Array.isArray(body) || !Array.isArray(body[0])) return ''
  let out = ''
  for (const segment of body[0]) {
    if (Array.isArray(segment) && typeof segment[0] === 'string') out += segment[0]
  }
  return out.trim()
}

/**
 * Build a translator-shaped object (`resolve` + `translate`) backed by the
 * anonymous Google endpoint, so the refine route has one code path whether the
 * Host translator service exists or not.
 * @param {{fetchImpl?: typeof fetch}} [options]
 */
export function createGoogleDirectTranslator({ fetchImpl } = {}) {
  return {
    resolve(spec) {
      return {
        provider: 'google-direct',
        text: spec.text,
        targetLanguage: spec.targetLanguage ?? 'en',
        sourceLanguage: spec.sourceLanguage ?? 'auto',
      }
    },
    async translate(spec, signal) {
      // Resolved per call so a test (or a Host that replaces fetch) can stub it.
      const doFetch = fetchImpl ?? globalThis.fetch
      if (typeof doFetch !== 'function') throw new Error('fetch is unavailable')
      const query = new URLSearchParams({
        client: 'gtx',
        sl: languageTag(spec.sourceLanguage, 'auto'),
        tl: languageTag(spec.targetLanguage, 'en'),
        dt: 't',
        q: spec.text,
      })
      const timeout = AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
      const response = await doFetch(`${GOOGLE_ENDPOINT}?${query.toString()}`, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'dsh-realtime-voice/0.2' },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      })
      if (!response.ok) throw Object.assign(new Error(`google translate answered ${response.status}`), { status: response.status })
      const translated = readGoogleTranslation(await response.json())
      if (translated === '') throw new Error('google translate returned no text')
      return translated
    },
  }
}

const MODES = new Set(['cleanup', 'translate'])
const JSON_TYPE = 'application/json; charset=utf-8'

/** @param {import('node:http').IncomingMessage} request */
function headerValue(request, name) {
  const value = request.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

/** @param {string | undefined} value */
function parseUrl(value) {
  if (typeof value !== 'string' || value === '') return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * Write one JSON response. Returns false when the response already finished,
 * so a late client disconnect never throws `ERR_STREAM_WRITE_AFTER_END`.
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 */
export function sendJson(response, status, payload, headers = {}) {
  if (response.writableEnded || response.destroyed) return false
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': JSON_TYPE,
    'cache-control': 'no-store',
    'content-length': String(body.length),
    ...headers,
  })
  response.end(body)
  return true
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, string>} [headers]
 */
export function sendFailure(response, status, code, message, headers) {
  return sendJson(response, status, { ok: false, code, message }, headers)
}

/**
 * Health payload. `translate` is always true: the route answers through the
 * Host translator service when it is mounted and falls back to the anonymous
 * Google endpoint otherwise. `cleanup` stays false because this build does not
 * wire the LLM path, so the client keeps its local rule-based cleanup.
 * @param {unknown} translator
 */
export function healthPayload(translator) {
  const hasTranslator = translator !== undefined && translator !== null
  return {
    ok: true,
    version: HOST_API_VERSION,
    capabilities: {
      translate: true,
      cleanup: false,
      providers: hasTranslator ? [...TRANSLATE_PROVIDERS].filter(provider => provider !== 'google-direct') : ['google-direct'],
    },
  }
}

/**
 * Validate and normalize a refine payload. Never echoes the input text back in
 * an error message.
 * @param {unknown} payload
 * @returns {{ok: true, value: {text: string, mode: 'cleanup'|'translate', targetLanguage?: string, sourceLanguage?: string, provider?: string}}
 *   | {ok: false, status: number, code: string, message: string}}
 */
export function parseRefineRequest(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, status: 400, code: 'invalid', message: 'request body must be a JSON object' }
  }
  const body = /** @type {Record<string, unknown>} */ (payload)
  const mode = body.mode
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    return { ok: false, status: 400, code: 'invalid', message: "'mode' must be 'cleanup' or 'translate'" }
  }
  if (typeof body.text !== 'string') {
    return { ok: false, status: 400, code: 'invalid', message: "'text' must be a string" }
  }
  const text = body.text.trim()
  if (text === '') {
    return { ok: false, status: 400, code: 'invalid', message: "'text' must not be empty" }
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { ok: false, status: 413, code: 'too-long', message: `'text' exceeds ${MAX_TEXT_CHARS} characters` }
  }
  const targetLanguage = optionalString(body.targetLanguage)
  const sourceLanguage = optionalString(body.sourceLanguage)
  const provider = optionalString(body.provider)
  if (targetLanguage.invalid) {
    return { ok: false, status: 400, code: 'invalid', message: "'targetLanguage' must be a non-empty string" }
  }
  if (sourceLanguage.invalid) {
    return { ok: false, status: 400, code: 'invalid', message: "'sourceLanguage' must be a non-empty string" }
  }
  if (provider.invalid) {
    return { ok: false, status: 400, code: 'invalid', message: "'provider' must be a non-empty string" }
  }
  if (mode === 'translate' && targetLanguage.value === undefined) {
    return { ok: false, status: 400, code: 'invalid', message: "'targetLanguage' is required when mode is 'translate'" }
  }
  if (provider.value !== undefined && !TRANSLATE_PROVIDERS.includes(provider.value)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid',
      message: `'provider' must be one of: ${TRANSLATE_PROVIDERS.join(', ')}`,
    }
  }
  return {
    ok: true,
    value: {
      text,
      mode: /** @type {'cleanup'|'translate'} */ (mode),
      ...(targetLanguage.value === undefined ? {} : { targetLanguage: targetLanguage.value }),
      ...(sourceLanguage.value === undefined ? {} : { sourceLanguage: sourceLanguage.value }),
      ...(provider.value === undefined ? {} : { provider: provider.value }),
    },
  }
}

function optionalString(value) {
  if (value === undefined || value === null) return { value: undefined, invalid: false }
  if (typeof value !== 'string' || value.trim() === '') return { value: undefined, invalid: true }
  return { value: value.trim(), invalid: false }
}

/**
 * Same-origin fence: absent Origin is allowed (curl, tests, native callers),
 * `null` is allowed (file:// pages under Electron), and any other Origin must
 * match the Host header or the web server's own origin.
 * @param {import('node:http').IncomingMessage} request
 * @param {string | undefined} serverOrigin
 */
export function requestOriginAllowed(request, serverOrigin) {
  const origin = headerValue(request, 'origin')
  if (origin === undefined || origin === 'null') return true
  const parsed = parseUrl(origin)
  if (parsed === undefined) return false
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = headerValue(request, 'host') ?? parseUrl(serverOrigin)?.host
  if (host === undefined) return false
  const authority = parseUrl(`${parsed.protocol}//${host}`)
  return authority !== undefined && authority.host.toLowerCase() === parsed.host.toLowerCase()
}

/**
 * Read a bounded request body. Resolves with `{ok:false, code:'too-long'}` as
 * soon as the cap is crossed; the caller owns the 413 response.
 * @param {import('node:http').IncomingMessage} request
 * @param {number} [limit]
 * @returns {Promise<{ok: true, body: Buffer} | {ok: false, status: number, code: string, message: string}>}
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
    const onEnd = () => { settle({ ok: true, body: Buffer.concat(chunks) }) }
    const onError = () => { settle({ ok: false, status: 400, code: 'invalid', message: 'request body could not be read' }) }
    const onAborted = () => { settle({ ok: false, status: 0, code: 'cancelled', message: 'client disconnected' }) }
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onAborted)
  })
}

/**
 * 413 for an oversized body, then destroy the response as required by the
 * contract. `connection: close` keeps an uploading client from hanging.
 * @param {import('node:http').ServerResponse} response
 * @param {string} message
 */
export function rejectOversized(response, message) {
  if (response.writableEnded || response.destroyed) return
  const body = Buffer.from(JSON.stringify({ ok: false, code: 'too-long', message }), 'utf8')
  response.writeHead(413, {
    'content-type': JSON_TYPE,
    'cache-control': 'no-store',
    'content-length': String(body.length),
    connection: 'close',
  })
  response.end(body, () => { response.destroy() })
}

/**
 * Map a translator rejection to the route's public failure shape. Only codes
 * (never arbitrary error text) decide the status; messages of coded errors are
 * safe diagnostics that never include the submitted text.
 * @param {unknown} error
 */
export function classifyFailure(error) {
  const code = typeof error === 'object' && error !== null && typeof (/** @type {any} */ (error).code) === 'string'
    ? /** @type {any} */ (error).code
    : undefined
  if (code === 'TRANSLATION_TEXT_LIMIT') {
    return { status: 413, code: 'too-long', message: `'text' exceeds ${MAX_TEXT_CHARS} characters` }
  }
  if (code === 'TRANSLATION_TIMEOUT') {
    return { status: 504, code: 'timeout', message: 'translation timed out' }
  }
  if (code === 'TRANSLATION_UNAVAILABLE') {
    return { status: 503, code: 'unavailable', message: 'translation provider is unavailable' }
  }
  const message = code !== undefined && typeof (/** @type {any} */ (error).message) === 'string'
    ? /** @type {any} */ (error).message.slice(0, 300)
    : 'translation failed'
  return { status: 502, code: 'failed', message }
}

/**
 * Run one translation with a hard deadline and client-disconnect cancellation.
 * @param {{resolve: Function, translate: Function}} translator
 * @param {any} spec
 * @param {{request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, timeoutMs: number}} options
 */
async function translateSafely(translator, spec, { request, response, timeoutMs }) {
  const controller = new AbortController()
  let timedOut = false
  let disconnected = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('refine timeout'))
  }, timeoutMs)
  timer.unref?.()
  const onDisconnect = () => {
    // A normal end sets writableEnded and removes this listener; anything else
    // (including an already-destroyed socket) means the peer went away, which
    // is exactly what should cancel the provider call.
    if (response.writableEnded) return
    disconnected = true
    controller.abort(new Error('client disconnected'))
  }
  response.once('close', onDisconnect)
  request.once('aborted', onDisconnect)
  try {
    const text = await translator.translate(spec, controller.signal)
    return { ok: true, text: typeof text === 'string' ? text : String(text) }
  } catch (error) {
    if (disconnected) return { ok: false, cancelled: true }
    if (timedOut) return { ok: false, status: 504, code: 'timeout', message: `translation exceeded ${timeoutMs}ms` }
    return { ok: false, error, ...classifyFailure(error) }
  } finally {
    clearTimeout(timer)
    response.off('close', onDisconnect)
    request.off('aborted', onDisconnect)
  }
}

/**
 * Build the GET health handler.
 * @param {{getTranslator: () => unknown}} options
 */
export function createHealthHandler({ getTranslator }) {
  return function healthHandler(request, response) {
    if (request.method !== 'GET') {
      if (!response.writableEnded) response.writeHead(405, { allow: 'GET' }).end()
      return
    }
    let translator
    try {
      translator = getTranslator()
    } catch {
      translator = undefined
    }
    sendJson(response, 200, healthPayload(translator))
  }
}

/**
 * Build the POST refine handler.
 * @param {{
 *   getTranslator: () => any,
 *   getServerOrigin?: () => string | undefined,
 *   logger?: {warn: (message: string, error?: unknown) => void},
 *   timeoutMs?: number,
 * }} options
 */
export function createRefineHandler({ getTranslator, getServerOrigin = () => undefined, logger, timeoutMs = DEFAULT_TIMEOUT_MS, directTranslator }) {
  const warn = typeof logger?.warn === 'function'
    ? (message, error) => { try { logger.warn(message, error) } catch { /* logging must never break a route */ } }
    : () => {}
  // Built lazily: a profile with the Host translator service never touches it.
  const fallback = directTranslator ?? createGoogleDirectTranslator()

  return async function refineHandler(request, response) {
    try {
      if (request.method !== 'POST') {
        if (!response.writableEnded) response.writeHead(405, { allow: 'POST' }).end()
        return
      }
      let serverOrigin
      try {
        serverOrigin = getServerOrigin()
      } catch {
        serverOrigin = undefined
      }
      if (!requestOriginAllowed(request, serverOrigin)) {
        sendFailure(response, 403, 'forbidden', 'cross-origin request rejected')
        return
      }
      const body = await readBody(request)
      if (!body.ok) {
        if (body.code === 'cancelled') return
        if (body.status === 413) {
          rejectOversized(response, body.message)
          return
        }
        sendFailure(response, 400, 'invalid', body.message)
        return
      }
      let payload
      try {
        payload = JSON.parse(body.body.toString('utf8'))
      } catch {
        sendFailure(response, 400, 'invalid', 'request body is not valid JSON')
        return
      }
      const parsed = parseRefineRequest(payload)
      if (!parsed.ok) {
        sendFailure(response, parsed.status, parsed.code, parsed.message)
        return
      }
      if (parsed.value.mode === 'cleanup') {
        sendFailure(response, 503, 'unavailable', 'cleanup mode needs the Host LLM service, which this build does not wire')
        return
      }
      let translator
      try {
        translator = getTranslator()
      } catch (error) {
        warn('realtime-voice: translator lookup failed', error)
        translator = undefined
      }
      if (translator === undefined || translator === null || typeof translator.translate !== 'function') {
        // The opt-in translator service is absent; the anonymous endpoint keeps
        // the feature alive instead of answering 503.
        translator = fallback
      }
      let spec
      try {
        spec = translator.resolve({
          text: parsed.value.text,
          targetLanguage: parsed.value.targetLanguage,
          ...(parsed.value.sourceLanguage === undefined ? {} : { sourceLanguage: parsed.value.sourceLanguage }),
          ...(parsed.value.provider === undefined ? {} : { provider: parsed.value.provider }),
        })
      } catch (error) {
        const failure = classifyFailure(error)
        warn('realtime-voice: refine resolve failed', error)
        sendFailure(response, failure.status, failure.code, failure.message)
        return
      }
      const started = performance.now()
      const outcome = await translateSafely(translator, spec, { request, response, timeoutMs })
      if (!outcome.ok) {
        if (outcome.cancelled) return
        warn('realtime-voice: refine translation failed', outcome.error)
        sendFailure(response, outcome.status, outcome.code, outcome.message)
        return
      }
      sendJson(response, 200, {
        ok: true,
        text: outcome.text,
        provider: spec.provider,
        ms: Math.round(performance.now() - started),
      })
    } catch (error) {
      // The webserver owns a last-resort guard, but keep this route explicit:
      // never leak a stack trace and never throw past the handler.
      warn('realtime-voice: refine route failed unexpectedly', error)
      if (!response.headersSent) sendFailure(response, 502, 'failed', 'translation failed')
      else response.destroy()
    }
  }
}
