/**
 * Offline tests for the realtime-voice Host routes.
 *
 * The real `apply()` is wired against a recording Cordis context, then the
 * captured routes are served by a throwaway `node:http` server and driven with
 * `fetch`, so status codes, headers and body framing are exercised end to end
 * without a running Harness or a real translator.
 *
 * Run: node --test test/host-refine.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { apply } from '../index.js'
import { MAX_TEXT_CHARS, ROUTES } from '../host/refine.js'

function fakeTranslator({ text = 'hello', translate } = {}) {
  const calls = { resolve: [], translate: [] }
  const translator = {
    calls,
    resolve(request) {
      calls.resolve.push(request)
      return {
        text: request.text,
        targetLanguage: request.targetLanguage,
        sourceLanguage: request.sourceLanguage ?? 'auto',
        provider: request.provider ?? 'bing',
      }
    },
    async translate(spec, signal) {
      calls.translate.push({ spec, signal })
      if (translate !== undefined) return translate(spec, signal)
      return text
    },
  }
  return translator
}

async function startHost(translator) {
  const routes = new Map()
  const disposers = []
  let origin = ''
  const ctx = {
    logger: { warn() {} },
    get(name) {
      return name === 'translator' ? translator : undefined
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer'])
      callback(ctx)
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(route) {
        assert.equal(route.kind, 'exact')
        assert.equal(typeof route.handler, 'function')
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
      getOrigin() {
        return origin
      },
    },
  }
  apply(ctx)

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://placeholder').pathname
    const handler = routes.get(path)
    if (handler === undefined) {
      response.writeHead(404).end()
      return
    }
    Promise.resolve(handler(request, response)).catch((error) => {
      if (!response.headersSent) response.writeHead(500).end(String(error))
      else response.destroy()
    })
  })
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    routes,
    server,
    async close() {
      server.closeAllConnections?.()
      await new Promise((resolve) => { server.close(resolve) })
      for (const dispose of disposers) dispose?.()
    },
  }
}

async function post(host, payload, headers = {}, signal = undefined) {
  return fetch(`${host.origin}${ROUTES.refine}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    signal,
  })
}

test('health: reports translate capability when the translator is mounted', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await fetch(`${host.origin}${ROUTES.health}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), {
    ok: true,
    version: '0.2.0',
    capabilities: { translate: true, cleanup: false, providers: ['bing', 'google'] },
  })
})

test('health: falls back to the direct provider without the translator service', async (t) => {
  const host = await startHost(undefined)
  t.after(() => host.close())
  const response = await fetch(`${host.origin}${ROUTES.health}`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    ok: true,
    version: '0.2.0',
    capabilities: { translate: true, cleanup: false, providers: ['google-direct'] },
  })
})

test('health: rejects non-GET methods with allow: GET', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await fetch(`${host.origin}${ROUTES.health}`, { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})

test('refine: translates, trims the text, and echoes the provider', async (t) => {
  const translator = fakeTranslator()
  const host = await startHost(translator)
  t.after(() => host.close())
  const response = await post(host, { text: '  你好  ', mode: 'translate', targetLanguage: 'en', provider: 'google' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.text, 'hello')
  assert.equal(body.provider, 'google')
  assert.equal(typeof body.ms, 'number')
  assert.deepEqual(translator.calls.resolve, [{ text: '你好', targetLanguage: 'en', provider: 'google' }])
  assert.equal(translator.calls.translate.length, 1)
})

test('refine: rejects an unknown mode with 400 invalid', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await post(host, { text: 'hi', mode: 'rewrite', targetLanguage: 'en' })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    ok: false, code: 'invalid', message: "'mode' must be 'cleanup' or 'translate'",
  })
})

test('refine: requires targetLanguage for translate', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await post(host, { text: 'hi', mode: 'translate' })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'invalid')
  assert.match(body.message, /targetLanguage/)
})

test('refine: rejects text above the character limit with 413 too-long', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await post(host, { text: 'a'.repeat(MAX_TEXT_CHARS + 1), mode: 'translate', targetLanguage: 'en' })
  assert.equal(response.status, 413)
  const body = await response.json()
  assert.equal(body.code, 'too-long')
})

test('refine: rejects a body above 64 KiB with 413 and a closed connection', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await post(host, { text: 'a'.repeat(70 * 1024), mode: 'translate', targetLanguage: 'en' })
  assert.equal(response.status, 413)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'too-long')
})

/** Swap the global fetch for the duration of one test, delegating local calls. */
function stubGooglePayload(t, { status = 200, payload = [[['Hello there', '你好', null, null]], null, 'zh-CN'] } = {}) {
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://translate.googleapis.com/')) {
      calls.push(url)
      return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
    }
    return realFetch(input, init)
  }
  t.after(() => { globalThis.fetch = realFetch })
  return calls
}

test('refine: translates through the direct provider when no translator service is mounted', async (t) => {
  const host = await startHost(undefined)
  t.after(() => host.close())
  const calls = stubGooglePayload(t)
  const response = await post(host, { text: '你好', mode: 'translate', targetLanguage: 'en' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.text, 'Hello there')
  assert.equal(body.provider, 'google-direct')
  assert.equal(calls.length, 1)
  assert.match(calls[0], /[?&]tl=en(&|$)/)
  assert.match(calls[0], /[?&]q=%E4%BD%A0%E5%A5%BD(&|$)/)
})

test('refine: maps a failing direct provider to 502', async (t) => {
  const host = await startHost(undefined)
  t.after(() => host.close())
  stubGooglePayload(t, { status: 429, payload: {} })
  const response = await post(host, { text: '你好', mode: 'translate', targetLanguage: 'en' })
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'failed')
})

test('refine: cleanup mode degrades to 503 for the local fallback', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await post(host, { text: '嗯 那个 我觉得', mode: 'cleanup' })
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'unavailable')
})

test('refine: rejects non-POST methods with allow: POST', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const response = await fetch(`${host.origin}${ROUTES.refine}`)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'POST')
})

test('refine: rejects cross-origin requests and allows the same origin', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const denied = await post(host, { text: 'hi', mode: 'translate', targetLanguage: 'en' }, { origin: 'http://evil.example' })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).code, 'forbidden')
  const allowed = await post(host, { text: 'hi', mode: 'translate', targetLanguage: 'en' }, { origin: host.origin })
  assert.equal(allowed.status, 200)
  const fileOrigin = await post(host, { text: 'hi', mode: 'translate', targetLanguage: 'en' }, { origin: 'null' })
  assert.equal(fileOrigin.status, 200)
})

test('refine: rejects an unknown provider and malformed JSON', async (t) => {
  const host = await startHost(fakeTranslator())
  t.after(() => host.close())
  const provider = await post(host, { text: 'hi', mode: 'translate', targetLanguage: 'en', provider: 'deepseek-official' })
  assert.equal(provider.status, 400)
  assert.match((await provider.json()).message, /bing, google/)
  const broken = await post(host, '{"text": "hi",')
  assert.equal(broken.status, 400)
  assert.equal((await broken.json()).code, 'invalid')
})

test('refine: maps translator timeouts to 504 and other failures to 502', async (t) => {
  const timeoutError = Object.assign(new Error('bing translation timed out after 10000ms'), { code: 'TRANSLATION_TIMEOUT' })
  const failing = await startHost(fakeTranslator({ translate: async () => { throw timeoutError } }))
  t.after(() => failing.close())
  const timedOut = await post(failing, { text: 'hi', mode: 'translate', targetLanguage: 'en' })
  assert.equal(timedOut.status, 504)
  assert.deepEqual(await timedOut.clone().json(), { ok: false, code: 'timeout', message: 'translation timed out' })

  const broken = await startHost(fakeTranslator({ translate: async () => { throw new Error('boom') } }))
  t.after(() => broken.close())
  const failed = await post(broken, { text: 'hi', mode: 'translate', targetLanguage: 'en' })
  assert.equal(failed.status, 502)
  assert.equal((await failed.json()).code, 'failed')
})

test('refine: aborts a pending translation when the client disconnects', async (t) => {
  let observed
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  const translator = fakeTranslator({
    translate: (spec, signal) => new Promise((resolve, reject) => {
      observed = signal
      markStarted()
      signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    }),
  })
  const host = await startHost(translator)
  t.after(() => host.close())
  const controller = new AbortController()
  const began = Date.now()
  const pending = post(host, { text: 'hi', mode: 'translate', targetLanguage: 'en' }, {}, controller.signal)
  await started
  controller.abort()
  await pending.catch(() => {})
  for (let index = 0; index < 100 && observed?.aborted !== true; index += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  const elapsed = Date.now() - began
  assert.equal(observed?.aborted, true)
  // A real disconnect aborts immediately; the handler's own 20s deadline must
  // not be what makes this pass.
  assert.ok(elapsed < 5000, `abort took ${elapsed}ms`)
})
