import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { ROUTE_PREFIX, apply } from '../index.js'
import { buildDesignerMessages, createRateLimiter, designTheme } from '../host/theme.js'

const ORIGIN = 'http://127.0.0.1:63672'

/** Fake IncomingMessage: body is emitted after the handler attaches listeners. */
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

function createContext() {
  const routes = new Map()
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
    get() {
      return undefined
    },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer'])
      callback({
        webServer,
        effect(fn) {
          fn()
        },
      })
    },
    on() {
      return () => {}
    },
    off() {},
    emit() {},
  }
  return { ctx, routes }
}

/**
 * @param {object} [options]
 * @param {string[]} [options.replies] Raw model replies, consumed in order.
 * @param {() => Promise<string>} [options.getApiKey]
 * @param {(url: string, init: any) => Promise<any>} [options.fetchImpl]
 */
function setup({ replies = [], getApiKey = async () => 'test-key', fetchImpl } = {}) {
  const calls = []
  const defaultFetch = async (url, init) => {
    const body = init?.body === undefined ? undefined : JSON.parse(init.body)
    calls.push({ url: String(url), init, body })
    if (String(url).endsWith('/chat/completions')) {
      const content = replies.shift()
      if (content === undefined) throw new Error('unexpected model call')
      return jsonResponse({
        model: 'deepseek-flash',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1180, completion_tokens: 236 },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }
  const { ctx, routes } = createContext()
  let clock = 1_000
  apply(ctx, {
    fetchImpl: fetchImpl ?? defaultFetch,
    getApiKey,
    now: () => (clock += 10),
  })

  const route = (suffix) => {
    const handler = routes.get(`${ROUTE_PREFIX}${suffix}`)
    assert.equal(typeof handler, 'function', `missing route ${suffix}`)
    return handler
  }

  return { ctx, routes, route, calls }
}

const post = (payload) => ({
  method: 'POST',
  headers: { origin: ORIGIN, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

const fenced = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

test('buildDesignerMessages carries the token table, rules and three few-shots', () => {
  const messages = buildDesignerMessages({
    utterance: '边框再亮一点',
    base: { v: 1, name: '赛博红黑', tokens: {}, css: {} },
    keep: ['board.width'],
  })

  assert.equal(messages[0].role, 'system')
  assert.match(messages[0].content, /board\.bgFrom/)
  assert.match(messages[0].content, /core\.palette\.idle/)
  assert.match(messages[0].content, /"set"/)
  assert.match(messages[0].content, /rgba\(\)/)
  assert.equal(messages.filter((message) => message.role === 'assistant').length, 3)
  assert.equal(messages.filter((message) => message.role === 'user').length, 4)
  assert.equal(messages.length, 8)
  // base + keep give relative asks ("再亮一点") something to hold on to.
  assert.match(messages.at(-1).content, /当前主题/)
  assert.match(messages.at(-1).content, /board\.width/)
  assert.match(messages.at(-1).content, /边框再亮一点/)
})

test('POST /theme/design turns a fenced reply into a sanitized patch', async () => {
  const app = setup({
    replies: [
      fenced({
        set: {
          'board.bgFrom': '#12040a',
          'accent.base': '#ff2a4d',
          'core.palette.idle': '#ffd9e0,#ff2a4d,#8a0f22',
        },
        css: { panel: 'box-shadow: 0 0 28px rgba(57,255,136,.35)' },
        name: '赛博红黑',
        message: '红黑底，霓虹绿边框',
      }),
    ],
  })
  const response = await call(
    app.route('/theme/design'),
    post({ utterance: '改成赛博朋克红黑，霓虹绿边框' }),
  )

  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.theme.v, 1)
  assert.equal(response.json.theme.name, '赛博红黑')
  assert.equal(response.json.theme.tokens['board.bgFrom'], '#12040a')
  assert.equal(response.json.theme.tokens['accent.base'], '#ff2a4d')
  assert.deepEqual(response.json.changed, [
    'board.bgFrom',
    'accent.base',
    'core.palette.idle',
    'css.panel',
  ])
  assert.equal(response.json.message, '红黑底，霓虹绿边框')
  assert.equal(response.json.model, 'deepseek-flash')
  assert.deepEqual(response.json.usage, { promptTokens: 1180, completionTokens: 236 })

  const request = app.calls.find((entry) => entry.url.endsWith('/chat/completions'))
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(request.init.headers.authorization, 'Bearer test-key')
  assert.equal(request.body.max_tokens, 900)
  assert.equal(request.body.temperature, 0.35)
})

test('illegal keys and values are dropped, not fatal', async () => {
  const app = setup({
    replies: [
      JSON.stringify({
        set: {
          evil: 'x',
          'board.bgFrom': 'javascript:alert(1)',
          'accent.base': '#ff2a4d',
        },
        css: { evilPart: 'color:red' },
        name: '',
        message: '能改的先改',
      }),
    ],
  })
  const response = await call(app.route('/theme/design'), post({ utterance: '改个颜色' }))

  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(response.json.theme.tokens), ['accent.base'])
  assert.deepEqual(response.json.changed, ['accent.base'])
  assert.deepEqual(response.json.theme.css, {})
  assert.ok(response.json.dropped.includes('token:evil'))
  assert.ok(response.json.dropped.includes('token:board.bgFrom'))
  assert.ok(response.json.dropped.includes('css:evilPart:unknown'))
})

test('an empty patch is a failure, not a success', async () => {
  const app = setup({ replies: ['{"set":{},"css":{}}'] })
  const response = await call(app.route('/theme/design'), post({ utterance: '改一下' }))

  assert.equal(response.status, 502)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'model-empty-patch')
})

test('unparseable model text maps to 502 upstream', async () => {
  const app = setup({ replies: ['抱歉，我只能聊天，不会改主题。'] })
  const response = await call(app.route('/theme/design'), post({ utterance: '改一下' }))

  assert.equal(response.status, 502)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'upstream')
})

test('POST /theme/design rejects an empty or over-long utterance before any model call', async () => {
  const app = setup()

  const empty = await call(app.route('/theme/design'), post({ utterance: '   ' }))
  assert.equal(empty.status, 400)
  assert.equal(empty.json.code, 'invalid')

  const long = await call(app.route('/theme/design'), post({ utterance: '改'.repeat(201) }))
  assert.equal(long.status, 400)
  assert.equal(long.json.code, 'invalid')

  assert.equal(app.calls.length, 0)
})

test('POST /theme/design rejects a base over 8KB before any model call', async () => {
  const app = setup()
  const response = await call(
    app.route('/theme/design'),
    post({ utterance: '改成红色', base: { v: 1, tokens: {}, css: {}, blob: 'x'.repeat(9_000) } }),
  )

  assert.equal(response.status, 400)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'invalid')
  assert.equal(app.calls.length, 0)
})

test('the in-process bucket allows 8 calls a minute and rejects the 9th', async () => {
  const app = setup({
    replies: Array.from({ length: 8 }, () => '{"set":{"accent.base":"#ff2a4d"}}'),
  })

  for (let index = 0; index < 8; index += 1) {
    const response = await call(app.route('/theme/design'), post({ utterance: `第 ${index} 次` }))
    assert.equal(response.status, 200, `call ${index + 1} should pass`)
  }
  const ninth = await call(app.route('/theme/design'), post({ utterance: '第九次' }))
  assert.equal(ninth.status, 429)
  assert.equal(ninth.json.ok, false)
  assert.equal(ninth.json.code, 'rate-limited')
  assert.equal(app.calls.length, 8)
})

test('designTheme shares one bucket per limiter and never reaches the brain past the cap', async () => {
  let modelCalls = 0
  const brain = {
    request: async () => {
      modelCalls += 1
      return {
        text: '{"set":{"accent.base":"#ff2a4d"}}',
        model: 'stub',
        usage: { promptTokens: 1, completionTokens: 1 },
      }
    },
  }
  const limiter = createRateLimiter({ now: () => 5_000 })

  for (let index = 0; index < 8; index += 1) {
    await designTheme({ brain, utterance: '改成红色', limiter })
  }
  await assert.rejects(
    () => designTheme({ brain, utterance: '改成红色', limiter }),
    (error) => {
      assert.equal(error.status, 429)
      assert.equal(error.code, 'rate-limited')
      return true
    },
  )
  assert.equal(modelCalls, 8)
})

test('POST /theme/design reports 503 when no API key is configured', async () => {
  const app = setup({ getApiKey: async () => '' })
  const response = await call(app.route('/theme/design'), post({ utterance: '改成红色' }))

  assert.equal(response.status, 503)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'service-missing')
})

test('POST /theme/design maps a non-2xx upstream to 502 upstream', async () => {
  const app = setup({
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  })
  const response = await call(app.route('/theme/design'), post({ utterance: '改成红色' }))

  assert.equal(response.status, 502)
  assert.equal(response.json.ok, false)
  assert.equal(response.json.code, 'upstream')
  assert.match(response.json.message, /HTTP 500/)
})
