import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { ROUTE_PREFIX, apply, parseApiKey } from '../index.js'

const ORIGIN = 'http://127.0.0.1:63672'

/**
 * Fake IncomingMessage. The body is emitted on nextTick, after the handler has
 * attached its listeners (same trick as voice-control's host-entry test).
 */
function makeRequest({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = headers
  request.readableEnded = false
  process.nextTick(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body, 'utf8'))
    request.readableEnded = true
    request.emit('end')
  })
  return request
}

function makeResponse() {
  /** @type {Buffer[]} */
  const chunks = []
  const response = {
    status: 0,
    headers: {},
    body: '',
    writableEnded: false,
    destroyed: false,
    onEnd: undefined,
    writeHead(status, headers = {}) {
      this.status = status
      Object.assign(this.headers, headers)
      return this
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk))
      this.body = Buffer.concat(chunks).toString('utf8')
      this.writableEnded = true
      this.onEnd?.()
      return this
    },
  }
  return response
}

function call(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const request = makeRequest(options)
    const response = makeResponse()
    const timer = setTimeout(() => reject(new Error('route timed out')), 5_000)
    response.onEnd = () => {
      clearTimeout(timer)
      let json
      try {
        json = response.body === '' ? undefined : JSON.parse(response.body)
      } catch {
        json = undefined
      }
      resolve({ status: response.status, headers: response.headers, body: response.body, json })
    }
    Promise.resolve(handler(request, response)).catch((error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function createController({ sessions = ['s-1'], assistantText = '改好了，登录页文案现在更像人话了。' } = {}) {
  const prompts = []
  const controller = {
    async list() {
      return { items: sessions.map((id) => ({ sessionId: id, title: `会话 ${id}` })) }
    },
    async create() {
      const sessionId = `s-new-${sessions.length + 1}`
      sessions.push(sessionId)
      return { sessionId }
    },
    async prompt(payload) {
      if (!sessions.includes(payload.sessionId)) {
        throw new Error(`session "${payload.sessionId}" not found`)
      }
      prompts.push(payload)
      return { accepted: true }
    },
    async events() {
      return {
        cursor: 1,
        records: [
          {
            type: 'event',
            event: {
              type: 'assistant/message',
              data: {
                message: {
                  role: 'assistant',
                  content: [
                    { type: 'reasoning', text: '' },
                    { type: 'text', text: assistantText },
                  ],
                },
              },
            },
          },
        ],
      }
    },
  }
  return { controller, prompts }
}

function jsonResponse(payload) {
  const text = JSON.stringify(payload)
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => payload,
    text: async () => text,
  }
}

function wavResponse(wav) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'audio/wav' : null) },
    arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
    text: async () => '',
  }
}

function makeWav(dataLen) {
  const wav = Buffer.alloc(44 + dataLen, 1)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(0, 4) // deliberately wrong until the plugin patches it
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24_000, 24)
  wav.writeUInt32LE(48_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(0, 40) // patched by speak()
  return wav
}

const defaultStt = {
  listProviders: () => ['sensevoice', 'parakeet'],
  prepare: async () => ({ ok: true }),
  resolve: ({ audio, providerId }) => ({ audio, providerId }),
  transcribe: async (spec) => {
    if (!(spec.audio instanceof Uint8Array) && !Buffer.isBuffer(spec.audio)) throw new Error('audio must be bytes')
    return '打开语音插件，检查一下路由'
  },
}

function createContext({ controller, stt = defaultStt }) {
  const routes = new Map()
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const listeners = new Map()
  const effects = []
  const webServer = {
    register({ path, handler }) {
      routes.set(path, handler)
      return () => routes.delete(path)
    },
    getOrigin() {
      return ORIGIN
    },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get(name) {
      if (name === 'sessionController') return controller
      if (name === 'speechToText') return stt
      return undefined
    },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer'])
      callback({
        webServer,
        effect(fn) {
          effects.push(fn())
        },
      })
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
      return () => listeners.get(event)?.delete(listener)
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener)
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
  return { ctx, routes, listeners, effects }
}

/**
 * @param {object} [options]
 * @param {string[]} [options.replies] Model replies, consumed in order.
 * @param {string[]} [options.sessions]
 */
function setup({ replies = [], sessions = ['s-1'], stt } = {}) {
  const { controller, prompts } = createController({ sessions })
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = init?.body === undefined ? undefined : JSON.parse(init.body)
    calls.push({ url: String(url), init, body })
    if (String(url).endsWith('/chat/completions')) {
      const content = replies.shift()
      if (content === undefined) throw new Error('unexpected model call')
      return jsonResponse({ choices: [{ message: { content } }] })
    }
    if (String(url).includes('/v1/tools/tts')) {
      return wavResponse(makeWav(4_800))
    }
    throw new Error(`unexpected fetch: ${url}`)
  }

  const { ctx, routes } = createContext({ controller, ...(stt === undefined ? {} : { stt }) })
  let clock = 1_000
  apply(ctx, {
    fetchImpl,
    getApiKey: async () => 'test-key',
    now: () => (clock += 10),
  })

  const route = (suffix) => {
    const handler = routes.get(`${ROUTE_PREFIX}${suffix}`)
    assert.equal(typeof handler, 'function', `missing route ${suffix}`)
    return handler
  }

  return { ctx, routes, route, prompts, calls, controller }
}

const post = (payload) => ({
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

test('GET /health exposes providers, voices, key state and tracked tasks', async () => {
  const app = setup()
  const response = await call(app.route('/health'), {
    method: 'GET',
    url: `${ROUTE_PREFIX}/health`,
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.version, '0.3.0')
  assert.deepEqual(response.json.tts.voices, ['stella', 'tide'])
  assert.equal(response.json.tts.apiKeyConfigured, true)
  assert.deepEqual(response.json.asr.providers, ['sensevoice', 'parakeet'])
  assert.equal(response.json.tasks.tracked, 0)
  assert.deepEqual(response.json.tasks.defaults, { permission: 'danger-full-access', reasoningEffort: 'high' })
  assert.equal(response.json.character, 'whale')
  assert.deepEqual(response.json.characters, ['whale', 'chibi'])
  assert.equal(response.json.commands.sessions, true)
  assert.equal(response.json.tts.catalog.length, 2)
})

test('GET /characters lists the cast with the voice each one speaks', async () => {
  const app = setup()
  const response = await call(app.route('/characters'), {
    method: 'GET',
    url: `${ROUTE_PREFIX}/characters`,
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.defaultCharacter, 'whale')
  assert.deepEqual(response.json.characters.map((entry) => entry.id), ['whale', 'chibi'])
  assert.deepEqual(response.json.characters.map((entry) => entry.voice), ['tide', 'stella'])
  assert.equal(response.json.characters[1].name, '小肥鱼')
  assert.deepEqual(response.json.voices.map((voice) => voice.id), ['stella', 'tide'])
  // The client clamps playback speed to the same window.
  assert.deepEqual(response.json.speed, { min: 0.75, max: 1.35 })
})

test('POST /turn answers a chat turn without dispatching', async () => {
  const app = setup({ replies: ['{"say":"好呀。"}'] })
  const response = await call(app.route('/turn'), post({ utterance: '你好' }))

  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.kind, 'chat')
  assert.equal(response.json.reply, '好呀。')
  assert.deepEqual(response.json.say, ['好呀。'])
  assert.equal(response.json.task, null)
  assert.equal(app.prompts.length, 0)

  const request = app.calls.find((entry) => entry.url.endsWith('/chat/completions'))
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.init.headers.authorization, 'Bearer test-key')
  assert.equal(request.body.stream, false)
  assert.equal(request.body.temperature, 0.6)
  assert.equal(request.body.max_tokens, 300)
})

test('POST /turn parses a fenced decision', async () => {
  const app = setup({ replies: ['```json\n{"say":"好呀。"}\n```'] })
  const response = await call(app.route('/turn'), post({ utterance: '你好' }))
  assert.equal(response.status, 200)
  assert.deepEqual(response.json.say, ['好呀。'])
  assert.equal(response.json.kind, 'chat')
})

test('POST /turn dispatches a task through sessionController.prompt', async () => {
  const app = setup({
    replies: ['{"say":"好，我去办，办完叫你。","task":{"title":"查资料","text":"查一下 Node 26 的新特性"}}'],
  })
  const response = await call(app.route('/turn'), post({ utterance: '帮我查下 Node 26', sessionId: 's-1' }))

  assert.equal(response.status, 200)
  assert.equal(response.json.kind, 'task')
  assert.equal(response.json.task.sessionId, 's-1')
  assert.equal(response.json.task.title, '查资料')
  assert.equal(response.json.task.text, '查一下 Node 26 的新特性')
  assert.equal(typeof response.json.task.taskId, 'string')
  assert.ok(response.json.task.taskId.length > 0)

  assert.equal(app.prompts.length, 1)
  const prompt = app.prompts[0]
  assert.equal(prompt.sessionId, 's-1')
  assert.equal(prompt.mode, 'queue')
  assert.equal(typeof prompt.requestId, 'string')
  assert.deepEqual(prompt.content, [{ type: 'text', text: '查一下 Node 26 的新特性' }])
})

test('POST /dispatch rejects empty text with 400', async () => {
  const app = setup()
  const response = await call(app.route('/dispatch'), post({ text: '   ' }))
  assert.equal(response.status, 400)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'invalid')
  assert.equal(app.prompts.length, 0)
})

test('POST /speak returns a playable WAV and caches repeats', async () => {
  const app = setup()
  const dataLen = 4_800

  const [first, second] = await Promise.all([
    call(app.route('/speak'), post({ text: '你好。' })),
    call(app.route('/speak'), post({ text: '你好。' })),
  ])
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal([first.json.cached, second.json.cached].sort().join(','), 'false,true')

  const wav = Buffer.from(first.json.audioBase64, 'base64')
  assert.equal(wav.length, 44 + dataLen)
  assert.equal(wav.readUInt32LE(40), dataLen)
  assert.equal(wav.readUInt32LE(4), 44 + dataLen - 8)
  assert.equal(first.json.mimeType, 'audio/wav')
  // No voiceId and no character: the whale's own base voice, not the TTS default.
  assert.equal(first.json.voiceId, 'tide')
  assert.equal(first.json.durationMs, 100)

  const third = await call(app.route('/speak'), post({ text: '你好。' }))
  assert.equal(third.json.cached, true)

  const ttsCalls = app.calls.filter((entry) => entry.url.includes('/v1/tools/tts'))
  assert.equal(ttsCalls.length, 1)
  assert.equal(ttsCalls[0].body.voice_id, 'tide')
  assert.equal(ttsCalls[0].body.format, 'wav')
})

test('POST /speak follows the character and honours an explicit voiceId', async () => {
  const app = setup()

  const chibi = await call(app.route('/speak'), post({ text: '你好呀。', character: 'chibi' }))
  assert.equal(chibi.json.voiceId, 'stella')

  // The chibi's soft voice is tide: an apology should change her tone.
  const soft = await call(app.route('/speak'), post({ text: '抱歉，我弄错了。', character: 'chibi' }))
  assert.equal(soft.json.voiceId, 'tide')

  const explicit = await call(app.route('/speak'), post({ text: '你好呀。', character: 'chibi', voiceId: 'tide' }))
  assert.equal(explicit.json.voiceId, 'tide')

  const unknown = await call(app.route('/speak'), post({ text: '嗯。', character: 'nobody' }))
  assert.equal(unknown.json.voiceId, 'tide')
})

test('POST /turn returns one voice per sentence for the active character', async () => {
  const app = setup({ replies: ['{"say":"好的，我这就去看。"}'] })
  const response = await call(app.route('/turn'), post({ utterance: '看看日志', character: 'chibi' }))
  assert.equal(response.status, 200)
  assert.equal(response.json.say.length, response.json.voices.length)
  assert.deepEqual(response.json.voices, ['stella'])

  const whale = setup({ replies: ['{"say":"好的，我这就去看。"}'] })
  const whaleResponse = await call(whale.route('/turn'), post({ utterance: '看看日志' }))
  assert.deepEqual(whaleResponse.json.voices, ['tide'])
})

test('POST /turn honours a custom voiceMap from the client', async () => {
  const app = setup({ replies: ['{"say":"好耶！太棒了。"}'] })
  const response = await call(
    app.route('/turn'),
    post({ utterance: '看看日志', character: 'whale', voiceMap: { bright: 'tide' } }),
  )

  assert.equal(response.status, 200)
  assert.equal(response.json.say.length, 2)
  // Opening stays on the whale base; the bright second sentence follows the map
  // (tide instead of the whale default stella).
  assert.deepEqual(response.json.voices, ['tide', 'tide'])
})

test('POST /speak honours a custom voiceMap and drops invalid slots', async () => {
  const app = setup()

  const custom = await call(
    app.route('/speak'),
    post({ text: '好耶！', character: 'whale', voiceMap: { bright: 'tide' } }),
  )
  assert.equal(custom.json.voiceId, 'tide')

  // An unknown slot value is ignored, so the whale default bright voice wins.
  const invalid = await call(
    app.route('/speak'),
    post({ text: '好耶！', character: 'whale', voiceMap: { bright: 'nova' } }),
  )
  assert.equal(invalid.json.voiceId, 'stella')
})

test('POST /plan rejects an empty utterance with 400', async () => {
  const app = setup()
  const response = await call(app.route('/plan'), post({ utterance: '  ' }))
  assert.equal(response.status, 400)
  assert.equal(response.json.code, 'invalid')
})

test('POST /plan answers a resume utterance without needing a session', async () => {
  const app = setup({ sessions: ['s-1', 's-2'] })
  const response = await call(app.route('/plan'), post({ utterance: '继续刚才那个会话' }))
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(typeof response.json.plan.action, 'string')
  assert.equal(typeof response.json.confirmation, 'string')
})

test('POST /send writes a prompt into an existing session', async () => {
  const app = setup({ sessions: ['s-1'] })
  const response = await call(app.route('/send'), post({ action: 'prompt', sessionId: 's-1', text: '把日志贴出来' }))
  assert.equal(response.status, 200)
  assert.equal(response.json.action, 'prompt')
  assert.equal(app.prompts.length, 1)
  assert.equal(app.prompts[0].sessionId, 's-1')
})

test('POST /send maps an unknown session to 404 and a bad action to 400', async () => {
  const app = setup()
  const missing = await call(app.route('/send'), post({ action: 'prompt', sessionId: 'nope', text: '喂' }))
  assert.equal(missing.status, 404)
  const bad = await call(app.route('/send'), post({ action: 'teleport', text: '喂' }))
  assert.equal(bad.status, 400)
})

test('GET /events reports completion once and advances the cursor', async () => {
  const app = setup({
    replies: ['{"say":"好，我去办，办完叫你。","task":{"title":"改文案","text":"把登录页文案改口语一点"}}'],
  })
  const turn = await call(app.route('/turn'), post({ utterance: '改下登录页文案', sessionId: 's-1' }))
  assert.equal(turn.json.kind, 'task')

  app.ctx.emit('agent/status', { agent: { id: 's-1' }, status: 'running' })
  app.ctx.emit('agent/status', { agent: { id: 's-1' }, status: 'idle' })

  let response
  for (let attempt = 0; attempt < 100; attempt += 1) {
    response = await call(app.route('/events'), {
      method: 'GET',
      url: `${ROUTE_PREFIX}/events?since=0`,
    })
    if (response.json.events.length > 0) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.equal(response.status, 200)
  assert.equal(response.json.events.length, 1)
  const event = response.json.events[0]
  assert.equal(event.type, 'task-done')
  assert.match(event.text, /^老板，「改文案」做完了。/)
  assert.match(event.summary, /改好了/)
  assert.equal(event.sessionId, 's-1')
  assert.ok(response.json.cursor >= 1)

  const after = await call(app.route('/events'), {
    method: 'GET',
    url: `${ROUTE_PREFIX}/events?since=${response.json.cursor}`,
  })
  assert.deepEqual(after.json.events, [])
  assert.equal(after.json.cursor, response.json.cursor)

  const health = await call(app.route('/health'), { method: 'GET', url: `${ROUTE_PREFIX}/health` })
  assert.equal(health.json.tasks.tracked, 0)
})

test('POST /dispatch maps a missing session to 404', async () => {
  const app = setup()
  const response = await call(app.route('/dispatch'), post({ text: '干活', sessionId: 'missing' }))
  assert.equal(response.status, 404)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'not-found')
})

test('POST /turn rejects a missing utterance with 400', async () => {
  const app = setup()
  const response = await call(app.route('/turn'), post({ utterance: '  ' }))
  assert.equal(response.status, 400)
  assert.equal(response.json.code, 'invalid')
})

test('POST routes reject a cross-origin page with 403', async () => {
  const app = setup()
  const response = await call(app.route('/dispatch'), {
    method: 'POST',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ text: '干活' }),
  })
  assert.equal(response.status, 403)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'forbidden')
  assert.equal(app.prompts.length, 0)
})

test('GET /dispatch reports 405 and the allowed method', async () => {
  const app = setup()
  const response = await call(app.route('/dispatch'), { method: 'GET' })
  assert.equal(response.status, 405)
  assert.equal(response.body, '')
  assert.equal(response.headers.allow, 'POST')
})

test('parseApiKey prefers the providers.deepseek key', () => {
  const config = [
    'api_key = "top-level-key"',
    'model = "deepseek-flash"',
    '',
    '[providers.deepseek]',
    'api_key = "provider-key"',
  ].join('\n')
  assert.equal(parseApiKey(config), 'provider-key')
  assert.equal(parseApiKey('api_key = "only-top"\n'), 'only-top')
  assert.equal(parseApiKey('[providers.other]\napi_key = "other"\n'), undefined)
})

test('POST /transcribe turns base64 audio into text with the local provider', async () => {
  const { route } = setup()
  const response = await call(
    route('/transcribe'),
    post({ audioBase64: Buffer.from('RIFF....WAVE').toString('base64') }),
  )
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.text, '打开语音插件，检查一下路由')
  assert.equal(response.json.providerId, 'sensevoice')
})

test('POST /transcribe rejects empty audio with 400', async () => {
  const { route } = setup()
  const response = await call(route('/transcribe'), post({ audioBase64: '' }))
  assert.equal(response.status, 400)
  assert.equal(response.json.code, 'invalid')
})

test('POST /transcribe reports 503 when the speech service is missing', async () => {
  const { route } = setup({ stt: null })
  const response = await call(route('/transcribe'), post({ audioBase64: 'AAAA' }))
  assert.equal(response.status, 503)
  assert.equal(response.json.code, 'unavailable')
})
