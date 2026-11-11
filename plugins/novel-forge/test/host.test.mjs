// 宿主半片测试：路由纯函数 + DSH handler 适配 + novel_* 工具。
// 用假 engine，不碰磁盘、不调模型。

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { handle, makeHandler, stripPrefix, ROUTE_PREFIX } from '../src/host/routes.js'
import { createTools } from '../src/host/tools.js'
import { ForgeError } from '../src/forge/errors.js'

const PROJECT = {
  id: 'p_20261111_ab12',
  title: '长夜将明',
  recipe: 'novel',
  params: { premise: '殡仪馆夜班', genre: '悬疑', chapters: 6, wordsPerChapter: 3000 },
  stats: { chapters: 6, drafted: 2, words: 6400, calls: 4 },
  stages: {
    premise: { status: 'done' },
    outline: { status: 'done' },
    draft: { status: 'partial', items: { ch01: 'done', ch02: 'done' } },
  },
  artifacts: { outline: { kind: 'json', version: 1 }, 'draft/ch01': { kind: 'md', version: 1 } },
  activeRunId: null,
  pendingReview: null,
  updatedAt: '2026-11-11T12:00:00.000Z',
}

function makeFakeEngine(overrides = {}) {
  const calls = []
  const runs = [
    {
      id: 'r_20261111_cd34',
      projectId: PROJECT.id,
      status: 'done',
      seq: 6,
      events: [1, 2, 3, 4, 5, 6].map(seq => ({ seq, type: 'log', data: { message: `e${seq}` } })),
    },
  ]
  const engine = {
    calls,
    listRecipes: () => [{
      id: 'novel',
      version: 1,
      title: '长篇小说',
      paramsSchema: { type: 'object' },
      paramsDefaults: { chapters: 24 },
      artifacts: { outline: { kind: 'json' } },
      stages: [{ id: 'premise', title: '故事核心', produces: ['brief'] }, { id: 'draft', title: '草稿', each: 'outline.chapters', review: true, produces: ['draft/*'] }],
    }],
    listProjects: async () => [PROJECT],
    createProject: async input => { calls.push(['createProject', input]); return { ...PROJECT, id: 'p_new' } },
    getProject: async id => { calls.push(['getProject', id]); return PROJECT },
    resolveProject: async hint => { calls.push(['resolveProject', hint]); return PROJECT },
    updateProject: async (id, patch) => { calls.push(['updateProject', id, patch]); return { ...PROJECT, ...patch } },
    deleteProject: async id => { calls.push(['deleteProject', id]) },
    getArtifact: async (id, key) => {
      calls.push(['getArtifact', id, key])
      if (key === 'missing') return null
      return { key, kind: key.startsWith('beats') ? 'json' : 'md', content: key === 'outline' ? { chapters: [] } : '正文' }
    },
    writeArtifact: async (id, key, value, by) => { calls.push(['writeArtifact', id, key, value, by]); return { key, kind: value.kind, bytes: 10, meta: { version: 2 } } },
    startRun: async (id, options) => { calls.push(['startRun', id, options]); return { id: 'r_new', status: 'running', options } },
    cancelRun: async id => { calls.push(['cancelRun', id]); return { id, status: 'cancelled' } },
    getRun: async id => runs.find(run => run.id === id) ?? null,
    listRuns: async () => runs,
    estimate: async () => ({ calls: 30, estTokensIn: 90000, estTokensOut: 40000, chapters: 6 }),
    estimateFor: (recipeId, params) => ({ calls: 150, chapters: params?.chapters ?? 24, estTokensIn: 500000, estTokensOut: 150000 }),
    exportProject: async (id, format) => ({ filename: `book.${format === 'epub' ? 'epub' : 'md'}`, path: '/tmp/book.md', mime: 'text/markdown', bytes: 100 }),
    ...overrides,
  }
  return engine
}

async function call(engine, method, path, { query = {}, body = null } = {}) {
  return handle({ engine, modelInfo: () => ({ available: true, provider: 'deepseek', model: 'deepseek-v4' }) }, { method, path, query, body })
}

test('stripPrefix 只认自己的前缀', () => {
  assert.equal(stripPrefix(`${ROUTE_PREFIX}/projects`), '/projects')
  assert.equal(stripPrefix(ROUTE_PREFIX), '/')
  assert.equal(stripPrefix('/mind-canvas/state'), null)
  assert.equal(stripPrefix('/novel-forge-x'), null)
})

test('POST /estimate 不需要项目，透传参数给 recipe', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, 'POST', '/estimate', { body: { recipeId: 'novel', params: { chapters: 12, wordsPerChapter: 2000 } } })
  assert.equal(result.status, 200)
  assert.equal(result.body.estimate.calls, 150)
  assert.equal(result.body.estimate.chapters, 12)
})

test('GET /projects 返回列表', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, 'GET', '/projects')
  assert.equal(result.status, 200)
  assert.equal(result.body.projects.length, 1)
  assert.equal(result.body.projects[0].title, '长夜将明')
})

test('POST /projects 透传 params 并返回 201', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, 'POST', '/projects', {
    body: { title: '长夜将明', params: { premise: '殡仪馆夜班' } },
  })
  assert.equal(result.status, 201)
  const [, input] = engine.calls.find(entry => entry[0] === 'createProject')
  assert.equal(input.recipeId, 'novel')
  assert.equal(input.params.premise, '殡仪馆夜班')
  assert.equal(input.title, '长夜将明')
})

test('GET /projects/:id 带 active run 与历史', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, 'GET', '/projects/p1')
  assert.equal(result.status, 200)
  assert.equal(result.body.project.id, PROJECT.id)
  assert.equal(result.body.run.id, 'r_20261111_cd34')
  assert.equal(result.body.runs.length, 1)
})

test('PATCH / DELETE 走 engine', async () => {
  const engine = makeFakeEngine()
  const patched = await call(engine, 'PATCH', '/projects/p1', { body: { title: '新名' } })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.project.title, '新名')
  const deleted = await call(engine, 'DELETE', '/projects/p1')
  assert.equal(deleted.status, 200)
  assert.equal(deleted.body.ok, true)
})

test('artifact 缺失 404，写入透传 kind', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, 'GET', '/projects/p1/artifact', { query: { key: 'missing' } }),
    error => error.code === 'ARTIFACT_MISSING' && error.status === 404,
  )
  const written = await call(engine, 'PUT', '/projects/p1/artifact', {
    body: { key: 'draft/ch01', kind: 'md', content: '新正文' },
  })
  assert.equal(written.status, 200)
  const entry = engine.calls.find(item => item[0] === 'writeArtifact')
  assert.equal(entry[3].content, '新正文')
  assert.equal(entry[4].stage, 'manual')
})

test('POST run 返回 202，GET run 按 after 过滤事件', async () => {
  const engine = makeFakeEngine()
  const started = await call(engine, 'POST', '/projects/p1/run', { body: { from: 'draft', items: ['ch03'] } })
  assert.equal(started.status, 202)
  assert.equal(started.body.run.id, 'r_new')
  const entry = engine.calls.find(item => item[0] === 'startRun')
  assert.deepEqual(entry[2], { from: 'draft', items: ['ch03'] })

  const polled = await call(engine, 'GET', '/projects/p1/run', { query: { after: '4' } })
  assert.equal(polled.status, 200)
  assert.deepEqual(polled.body.run.events.map(event => event.seq), [5, 6])
  assert.equal(polled.body.run.seq, 6)
})

test('没有运行时 cancel 返回 409', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, 'POST', '/projects/p1/run/cancel'),
    error => error.code === 'CONFLICT' && error.status === 409,
  )
})

test('审稿门：没有待确认返回 409，有则续跑 nextStages', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(
    () => call(engine, 'POST', '/projects/p1/review/continue'),
    error => error.status === 409,
  )
  const engine2 = makeFakeEngine({
    getProject: async () => ({ ...PROJECT, pendingReview: { stage: 'outline', nextStages: ['beats', 'draft'] } }),
  })
  const result = await call(engine2, 'POST', '/projects/p1/review/continue', { body: { autoApprove: true } })
  assert.equal(result.status, 202)
  const entry = engine2.calls.find(item => item[0] === 'startRun')
  assert.deepEqual(entry[2].stages, ['beats', 'draft'])
  assert.equal(entry[2].autoApprove, true)
})

test('GET /recipes 隐藏函数，只给 UI 需要的形状', async () => {
  const engine = makeFakeEngine()
  const result = await call(engine, 'GET', '/recipes')
  assert.equal(result.status, 200)
  const [recipe] = result.body.recipes
  assert.equal(recipe.stages[1].each, 'outline.chapters')
  assert.equal(recipe.stages[1].review, true)
  assert.equal(typeof recipe.stages[0].each, 'object')
  assert.equal(recipe.stages[0].each, null)
})

test('GET /model 与 POST /export', async () => {
  const engine = makeFakeEngine()
  const model = await call(engine, 'GET', '/model')
  assert.equal(model.body.model.available, true)
  const exported = await call(engine, 'POST', '/projects/p1/export', { body: { format: 'epub' } })
  assert.equal(exported.status, 200)
  assert.equal(exported.body.export.filename, 'book.epub')
})

test('未知路由 404，方法不支持 405', async () => {
  const engine = makeFakeEngine()
  await assert.rejects(() => call(engine, 'GET', '/nope'), error => error.status === 404)
  await assert.rejects(() => call(engine, 'PUT', '/projects/p1'), error => error.status === 405)
})

test('ForgeError 映射成对应状态码', async () => {
  const engine = makeFakeEngine({
    startRun: async () => { throw new ForgeError('RUN_ACTIVE', '这本书正在跑') },
  })
  await assert.rejects(
    () => call(engine, 'POST', '/projects/p1/run', { body: {} }),
    error => error.code === 'RUN_ACTIVE',
  )
})

// ---------------------------------------------------------------- handler 层

function fakeReq({ method = 'GET', url = '/', body = null, headers = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  process.nextTick(() => {
    if (body !== null) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(key, value) { res.headers[key] = value },
    end(chunk) { res.body += chunk ?? ''; res.headersSent = true },
  }
  return res
}

test('handler：guard 拒绝返回 403，且不触达 engine', async () => {
  const engine = makeFakeEngine()
  const handler = makeHandler({ engine, guard: () => 403 })
  const res = fakeRes()
  await handler(fakeReq({ url: '/novel-forge/projects', headers: { origin: 'http://evil' } }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(engine.calls.length, 0)
  assert.match(JSON.parse(res.body).error.code, /FORBIDDEN/)
})

test('handler：正常请求走完，错误体带 code', async () => {
  const engine = makeFakeEngine()
  const handler = makeHandler({ engine, modelInfo: () => ({ available: false, message: '没模型' }) })
  const res = fakeRes()
  await handler(fakeReq({ url: '/novel-forge/projects' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).projects.length, 1)

  const bad = fakeRes()
  await handler(fakeReq({ method: 'PUT', url: '/novel-forge/projects/p1', body: { x: 1 } }), bad)
  assert.equal(bad.statusCode, 405)
  assert.equal(JSON.parse(bad.body).error.code, 'METHOD_NOT_ALLOWED')
})

test('handler：坏 JSON 返回 400，超大 body 返回 413', async () => {
  const engine = makeFakeEngine()
  const handler = makeHandler({ engine })
  const bad = fakeRes()
  await handler(fakeReq({ method: 'POST', url: '/novel-forge/projects', body: '{oops' }), bad)
  assert.equal(bad.statusCode, 400)
  assert.equal(JSON.parse(bad.body).error.code, 'BAD_BODY')

  const { MAX_BODY_BYTES } = await import('../src/host/json.js')
  const huge = fakeRes()
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/novel-forge/projects'
  req.headers = {}
  req.destroy = () => {}
  process.nextTick(() => {
    req.emit('data', Buffer.alloc(MAX_BODY_BYTES + 10))
    req.emit('end')
  })
  await handler(req, huge)
  assert.equal(huge.statusCode, 413)
})

// ------------------------------------------------------------------- tools

test('novel_* 工具齐全，参数必填项正确', () => {
  const tools = createTools(makeFakeEngine())
  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'novel_cancel', 'novel_create', 'novel_export', 'novel_list',
    'novel_read', 'novel_run', 'novel_status', 'novel_write',
  ])
  const create = tools.find(tool => tool.name === 'novel_create')
  assert.deepEqual(create.parameters.required, ['premise'])
  assert.equal(create.parameters.additionalProperties, false)
  const run = tools.find(tool => tool.name === 'novel_run')
  assert.equal(run.timeoutMs, 120_000)
})

test('novel_list 渲染中文摘要', async () => {
  const engine = makeFakeEngine()
  const tool = createTools(engine).find(item => item.name === 'novel_list')
  const value = await tool.execute({})
  assert.equal(value.count, 1)
  const [part] = tool.output.render({}, value)
  assert.match(part.text, /长夜将明/)
  assert.match(part.text, /2\/6 章/)
})

test('novel_create 过滤 undefined 并用 estimate', async () => {
  const engine = makeFakeEngine()
  const tool = createTools(engine).find(item => item.name === 'novel_create')
  const value = await tool.execute({ premise: '殡仪馆夜班', chapters: 6 })
  assert.equal(value.project.id, 'p_new')
  assert.equal(value.estimate.calls, 30)
  const entry = engine.calls.find(item => item[0] === 'createProject')
  assert.equal(entry[1].params.chapters, 6)
  assert.equal('genre' in entry[1].params, false)
})

test('novel_read 按章读四件套，novel_write JSON 反序列化', async () => {
  const engine = makeFakeEngine()
  const tools = createTools(engine)
  const read = tools.find(item => item.name === 'novel_read')
  const value = await read.execute({ chapter: '3' })
  assert.equal(value.chapter, 'ch03')
  assert.equal(value.draft, '正文')

  const write = tools.find(item => item.name === 'novel_write')
  const saved = await write.execute({ key: 'beats/ch03', content: '{"scenes":[]}' })
  assert.equal(saved.ok, true)
  const entry = engine.calls.find(item => item[0] === 'writeArtifact')
  assert.equal(entry[2], 'beats/ch03')
  assert.deepEqual(entry[3].content, { scenes: [] })
  assert.equal(entry[3].kind, 'json')

  await assert.rejects(
    () => write.execute({ key: 'beats/ch03', content: 'not json' }),
    error => error.code === 'BAD_PARAMS',
  )
})
