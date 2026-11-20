/**
 * Route-level test for the Host half.
 *
 * `index.js` is the only file that talks to the Cordis context, so this test
 * fakes that context, captures the six registered routes, and drives them with
 * plain request/response objects. No GUI, no network, no microphone.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import fs, { readFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { classifyError } from '../host/http.js'
import { apply, ROUTE_PREFIX } from '../index.js'

/** Minimal IncomingMessage stand-in. */
function makeRequest({ method, url = '/', headers = {}, body }) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = { host: '127.0.0.1:63672', ...headers }
  request.readableEnded = false
  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    // Emit on the next tick so the handler's listeners are attached first.
    process.nextTick(() => {
      request.emit('data', Buffer.from(text, 'utf8'))
      request.emit('end')
    })
  }
  return request
}

/** Minimal ServerResponse stand-in that records what was written. */
function makeResponse() {
  const response = {
    status: 0,
    headers: {},
    body: '',
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) {
      response.status = status
      response.headers = headers ?? {}
      return response
    },
    end(body) {
      response.writableEnded = true
      if (typeof body === 'string') response.body += body
      else if (Buffer.isBuffer(body)) response.body += body.toString('utf8')
      if (response.onEnd !== undefined) response.onEnd()
    },
  }
  return response
}

/** Call one captured handler and resolve with the parsed response. */
function call(handler, options) {
  return new Promise((resolve, reject) => {
    const request = makeRequest(options)
    const response = makeResponse()
    response.onEnd = () => {
      try {
        resolve({ status: response.status, json: JSON.parse(response.body || 'null'), headers: response.headers })
      } catch (error) {
        reject(error)
      }
    }
    Promise.resolve(handler(request, response)).catch(reject)
  })
}

/** Sessions the fake controller serves. */
const SESSIONS = [
  // A real `sessionController.list()` row: the title lives in the `title` Session projection,
  // not at the row's top level (`@deepseek-ai/dsh-session-title` view schema is `string().min(1).nullable()`).
  {
    sessionId: 's-voice',
    updatedAt: 1_700_000_000_000,
    blank: false,
    running: false,
    cwd: '/Users/fuzhuo/Documents/deepseek-harness/default-workspace',
    projections: { kind: 'sequenced', asOfSeq: 12, values: { title: '语音控制插件' } },
  },
  { sessionId: 's-context', title: '资源库插件 dsh-context-lib', updatedAt: 1_700_000_100_000, blank: false, running: true, cwd: '/Users/fuzhuo/Documents/deepseek-harness/default-workspace' },
  { sessionId: 's-old', title: '很旧的会话', updatedAt: 1_600_000_000_000, blank: false, running: false, cwd: '/tmp/elsewhere' },
]

function makeContext({ sessions = SESSIONS, archived = [], onPrompt, stt = true } = {}) {
  const routes = new Map()
  const prompts = []
  const transcriptions = []
  const speechToText = stt === true
    ? {
      listProviders: () => ['sensevoice'],
      prepare() {},
      resolve(request) {
        return { provider: { info: { id: request.providerId ?? 'sensevoice' } }, audio: request.audio, language: request.language }
      },
      async transcribe(spec) {
        transcriptions.push({ providerId: spec.provider.info.id, bytes: spec.audio?.length })
        return { text: '把语音控制插件的测试补上', audioSeconds: 1.5, inferenceSeconds: 0.3 }
      },
    }
    : stt
  const controller = {
    async list() {
      return { items: sessions }
    },
    async create() {
      return { sessionId: 's-new' }
    },
    async prompt(request, signal) {
      prompts.push(request)
      assert.ok(signal !== undefined, 'prompt must be given an AbortSignal')
      onPrompt?.(request)
      return { accepted: true }
    },
    async cancel() {
      return { accepted: true }
    },
  }
  const webServer = {
    register({ path, handler }) {
      routes.set(path, handler)
      return () => routes.delete(path)
    },
    getOrigin() {
      return 'http://127.0.0.1:63672'
    },
  }
  const ctx = {
    logger: { warn() {}, info() {}, error() {} },
    get(name) {
      if (name === 'sessionController') return controller
      if (name === 'workspaceRegistry') return { archivedSessionIds: archived }
      if (name === 'speechToText') return speechToText
      return undefined
    },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer'])
      callback({ webServer, effect: (fn) => { fn(); return () => {} } })
      return () => {}
    },
    effect(fn) {
      fn()
      return () => {}
    },
  }
  apply(ctx)
  return { routes, prompts, controller, transcriptions }
}

function routeFor(routes, name) {
  const handler = routes.get(`${ROUTE_PREFIX}/${name}`)
  assert.ok(handler !== undefined, `route ${name} must be registered`)
  return handler
}

test('apply registers the six routes under the plugin prefix', () => {
  const { routes } = makeContext()
  assert.deepEqual([...routes.keys()].sort(), [
    `${ROUTE_PREFIX}/dispatch`,
    `${ROUTE_PREFIX}/health`,
    `${ROUTE_PREFIX}/plan`,
    `${ROUTE_PREFIX}/speak`,
    `${ROUTE_PREFIX}/transcribe`,
    `${ROUTE_PREFIX}/version`,
  ])
})

test('version reports this plugin\'s own release against the repo index', async () => {
  const { routes } = makeContext()
  const handler = routeFor(routes, 'version')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const homepage = 'https://github.com/Feahter/dsh-plugins/tree/main/plugins/voice-control'
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { plugins: [{ name: 'dsh-voice-control', homepage, versions: [{ version: '0.0.1' }, { version: '99.0.0' }] }] }
    },
  })
  try {
    // A non-GET never touches the index.
    const refused = await call(handler, { method: 'POST' })
    assert.equal(refused.status, 405)

    const result = await call(handler, { method: 'GET', url: `${ROUTE_PREFIX}/version?refresh=1` })
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true)
    assert.equal(result.json.data.plugin, 'dsh-voice-control')
    assert.equal(result.json.data.current, pkg.version)
    assert.equal(result.json.data.latest, '99.0.0')
    assert.equal(result.json.data.updateAvailable, true)
    assert.equal(result.json.data.failed, false)
    assert.equal(result.json.data.homepage, homepage)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('health reports the local recognizer, the voices and the session count', async () => {
  const { routes } = makeContext()
  const result = await call(routeFor(routes, 'health'), { method: 'GET' })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.deepEqual(result.json.asr.providers, ['sensevoice'])
  assert.deepEqual(result.json.tts.voices, ['stella', 'tide'])
  assert.equal(result.json.sessions.count, 3)
})

test('plan routes a titled utterance to that Session', async () => {
  const { routes } = makeContext()
  const result = await call(routeFor(routes, 'plan'), {
    method: 'POST',
    body: { utterance: '语音控制插件接下来要做什么' },
  })
  assert.equal(result.json.ok, true)
  assert.equal(result.json.plan.action, 'resume')
  assert.equal(result.json.plan.sessionId, 's-voice')
  assert.match(result.json.confirmation, /语音控制插件/)
})

test('plan asks instead of guessing when two titles tie', async () => {
  const { routes } = makeContext({
    sessions: [
      { sessionId: 'a', title: '语音控制插件', updatedAt: 1, blank: false, running: false },
      { sessionId: 'b', title: '语音控制面板', updatedAt: 1, blank: false, running: false },
    ],
  })
  const result = await call(routeFor(routes, 'plan'), { method: 'POST', body: { utterance: '语音控制' } })
  assert.equal(result.json.plan.action, 'ask')
  assert.equal(result.json.plan.candidates.length, 2)
})

test('plan resolves an ordinal reply against the announced candidates', async () => {
  const { routes } = makeContext()
  const pending = [
    { sessionId: 'x', title: '候选甲', score: 1 },
    { sessionId: 'y', title: '候选乙', score: 1 },
  ]
  const result = await call(routeFor(routes, 'plan'), {
    method: 'POST',
    body: { utterance: '第二个', pending },
  })
  assert.equal(result.json.plan.action, 'resume')
  assert.equal(result.json.plan.sessionId, 'y')
})

test('plan resolves "新开" against pending candidates as a new Session', async () => {
  const { routes } = makeContext()
  const pending = [{ sessionId: 'x', title: '候选甲', score: 1 }]
  const result = await call(routeFor(routes, 'plan'), {
    method: 'POST',
    body: { utterance: '新开', pending },
  })
  assert.equal(result.json.plan.action, 'new')
})

test('dispatch prompt forwards the text to the addressed Session', async () => {
  const { routes, prompts } = makeContext()
  const result = await call(routeFor(routes, 'dispatch'), {
    method: 'POST',
    body: { action: 'prompt', sessionId: 's-voice', text: '继续说插件的事' },
  })
  assert.equal(result.json.ok, true)
  assert.equal(result.json.accepted, true)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].sessionId, 's-voice')
  assert.equal(prompts[0].mode, 'queue')
  assert.deepEqual(prompts[0].content, [{ type: 'text', text: '继续说插件的事' }])
})

test('dispatch new creates a Session and sends the first instruction', async () => {
  const { routes, prompts } = makeContext()
  const result = await call(routeFor(routes, 'dispatch'), {
    method: 'POST',
    body: { action: 'new', text: '开一个新的活' },
  })
  assert.equal(result.json.sessionId, 's-new')
  assert.equal(result.json.accepted, true)
  assert.equal(prompts[0].sessionId, 's-new')
})

test('dispatch rejects a prompt or cancel without a target as 400, not 500', async () => {
  const { routes, prompts } = makeContext()
  const prompt = await call(routeFor(routes, 'dispatch'), {
    method: 'POST',
    body: { action: 'prompt', text: '继续说' },
  })
  assert.equal(prompt.status, 400)
  assert.equal(prompt.json.code, 'invalid')
  const cancel = await call(routeFor(routes, 'dispatch'), {
    method: 'POST',
    body: { action: 'cancel' },
  })
  assert.equal(cancel.status, 400)
  assert.equal(cancel.json.code, 'invalid')
  assert.equal(prompts.length, 0)
})

test('dispatch rejects an unknown action', async () => {
  const { routes } = makeContext()
  const result = await call(routeFor(routes, 'dispatch'), { method: 'POST', body: { action: 'explode' } })
  assert.equal(result.status, 400)
  assert.equal(result.json.ok, false)
})

test('plan rejects an empty utterance', async () => {
  const { routes } = makeContext()
  const result = await call(routeFor(routes, 'plan'), { method: 'POST', body: { utterance: '   ' } })
  assert.equal(result.status, 400)
})

test('routes reject a cross-origin request', async () => {
  const { routes } = makeContext()
  const result = await call(routeFor(routes, 'plan'), {
    method: 'POST',
    headers: { origin: 'http://evil.example' },
    body: { utterance: '你好' },
  })
  assert.equal(result.status, 403)
})

test('GET on a POST route answers 405', async () => {
  const { routes } = makeContext()
  const result = await call(routeFor(routes, 'plan'), { method: 'GET' })
  assert.equal(result.status, 405)
})

test('speak returns playable wav bytes and repairs the size fields', async (t) => {
  const originalReadFile = readFile
  const configPath = join(homedir(), '.deepseek', 'config.toml')
  const config = t.mock.method(fs, 'readFile', (path, ...args) =>
    path === configPath ? Promise.resolve('api_key = "fixture-token"') : originalReadFile(path, ...args))
  syncBuiltinESMExports()
  const payload = Buffer.alloc(48_000, 7)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.write('WAVE', 8, 'ascii')
  header.write('data', 36, 'ascii')
  const wav = Buffer.concat([header, payload])
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer fixture-token')
    return new Response(wav, { status: 200, headers: { 'content-type': 'audio/wav' } })
  })
  try {
    const { routes } = makeContext()
    const result = await call(routeFor(routes, 'speak'), { method: 'POST', body: { text: '好的，马上办。' } })
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true)
    assert.ok(result.json.durationMs > 0)
    const decoded = Buffer.from(result.json.audioBase64, 'base64')
    assert.equal(decoded.readUInt32LE(40), 48_000)
    assert.equal(fetch.mock.callCount(), 1)
  } finally {
    config.mock.restore()
    syncBuiltinESMExports()
  }
})

test('transcribe decodes the recording and returns the local transcript', async () => {
  const { routes, transcriptions } = makeContext()
  const result = await call(routeFor(routes, 'transcribe'), {
    method: 'POST',
    body: { audioBase64: Buffer.alloc(3200, 1).toString('base64') },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.text, '把语音控制插件的测试补上')
  assert.equal(result.json.providerId, 'sensevoice')
  assert.equal(transcriptions.length, 1)
  assert.equal(transcriptions[0].bytes, 3200)
})

test('transcribe rejects an empty recording before it reaches the recognizer', async () => {
  const { routes, transcriptions } = makeContext()
  const result = await call(routeFor(routes, 'transcribe'), { method: 'POST', body: { audioBase64: '' } })
  assert.equal(result.status, 400)
  assert.equal(result.json.ok, false)
  assert.equal(transcriptions.length, 0)
})

test('transcribe reports an unavailable recognizer instead of failing quietly', async () => {
  const { routes } = makeContext({ stt: null })
  const result = await call(routeFor(routes, 'transcribe'), {
    method: 'POST',
    body: { audioBase64: Buffer.alloc(3200, 1).toString('base64') },
  })
  assert.equal(result.status, 503)
  assert.match(result.json.error, /speech-to-text service is unavailable/)
})

test('handler errors become client-actionable statuses', () => {
  assert.deepEqual(classifyError(new Error('session "nope" not found')), {
    status: 404,
    code: 'not-found',
    message: 'session "nope" not found',
  })
  assert.equal(classifyError(new Error('Invalid speech WAV')).status, 415)
  assert.equal(classifyError(new Error('boom')).status, 500)
})
