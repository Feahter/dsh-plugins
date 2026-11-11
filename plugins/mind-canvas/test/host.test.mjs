// 宿主半片：落盘、校验、路由、导入、工具。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Store, validateState } from '../src/store.js'
import { mapInspirations } from '../src/inspirations.js'
import { outline, addChildren, findNode, summarize } from '../src/outline.js'
import { buildPrompt, normalizeIdeas, extractJson } from '../src/llm.js'
import { createTools, route } from '../index.js'

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'mc-test-'))
  return { store: new Store(dir), dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

function sampleState() {
  return {
    version: 1,
    activeId: 'd1',
    revision: 3,
    docs: [{
      id: 'd1',
      title: '选题',
      layout: 'tree-right',
      nodes: [
        { id: 'n1', text: 'AI 工具怎么讲', parentId: null, x: 0, y: 0, tone: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'n2', text: '实测对比', parentId: 'n1', x: 240, y: -40, tone: 'a', createdAt: '2026-01-01T00:01:00.000Z' },
      ],
    }],
  }
}

// --------------------------------------------------------------- 存储

test('写入再读出是同一条数据（原子替换后文件可解析）', async () => {
  const { store, cleanup } = await tempStore()
  try {
    assert.equal(await store.read(), null)
    await store.write(sampleState())
    const back = await store.read()
    assert.deepEqual(back, sampleState())
    const onDisk = JSON.parse(await readFile(store.file, 'utf8'))
    assert.equal(onDisk.docs[0].nodes.length, 2)
    const info = await store.info()
    assert.ok(info.bytes > 0 && info.mtimeMs > 0)
  } finally {
    await cleanup()
  }
})

test('文件被写坏时退回上一份好数据，而不是把界面打空', async () => {
  const { store, cleanup } = await tempStore()
  try {
    await store.write(sampleState())
    await writeFile(store.file, '{ 这不是 json', 'utf8')
    const back = await store.read()
    assert.deepEqual(back, sampleState())
  } finally {
    await cleanup()
  }
})

test('并发写不会互相覆盖（串行队列）', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const jobs = []
    for (let index = 0; index < 5; index += 1) {
      const state = sampleState()
      state.revision = index
      jobs.push(store.write(state))
    }
    await Promise.all(jobs)
    const back = await store.read()
    assert.equal(back.revision, 4)
  } finally {
    await cleanup()
  }
})

test('validateState 挡住坏形状', () => {
  assert.match(validateState(null), /对象/)
  assert.match(validateState({ docs: [] }), /不能为空/)
  assert.match(validateState({ activeId: 'x', docs: [{ id: '', nodes: [] }] }), /doc\.id/)
  assert.match(validateState({ activeId: 'd', docs: [{ id: 'd', nodes: [{ id: 'n', text: 'x', parentId: null, x: 'a', y: 0 }] }] }), /node\.x \/ node\.y/)
  assert.equal(validateState(sampleState()), null)
})

// --------------------------------------------------------------- 导入

test('灵感映射只保留标题级字段，按时间倒序', () => {
  const items = mapInspirations({
    items: [
      { id: 'a', title: '旧', createdAt: '2026-01-01T00:00:00.000Z', production: { secret: 1 } },
      { id: 'b', title: '  ', createdAt: '2026-02-01T00:00:00.000Z', kind: 'quote' },
      { id: 'c', title: '新', createdAt: '2026-03-01T00:00:00.000Z', platform: '小红书', tags: ['a', 3] },
    ],
  })
  assert.deepEqual(items.map(item => item.id), ['c', 'b', 'a'])
  assert.equal(items[1].title, '（无标题灵感）')
  assert.deepEqual(items[0].tags, ['a'])
  assert.equal('production' in items[0], false)
})

test('没有自媒体工作台时导入列表为空而不是报错', async () => {
  const { readInspirations } = await import('../src/inspirations.js')
  const items = await readInspirations({ DSH_HOME: join(tmpdir(), 'definitely-missing-home') })
  assert.deepEqual(items, [])
})

// --------------------------------------------------------------- 大纲 / 加节点

test('宿主大纲与子节点追加', () => {
  const doc = sampleState().docs[0]
  assert.match(outline(doc), /^## AI 工具怎么讲$/m)
  assert.deepEqual(summarize(doc), { nodes: 2, roots: 1, depth: 2 })
  assert.equal(findNode(doc, '实测')?.id, 'n2')

  const { doc: next, added } = addChildren(doc, { parentId: 'n1', texts: ['方法一', '  方法二  ', ''] })
  assert.deepEqual(added, ['方法一', '方法二'])
  assert.equal(next.nodes.length, 4)
  assert.ok(next.nodes.filter(node => node.parentId === 'n1').every(node => node.x > 0))
})

test('找不到父节点时落到根上', () => {
  const doc = sampleState().docs[0]
  const { doc: next } = addChildren(doc, { parentId: null, texts: ['新根'] })
  assert.equal(summarize(next).roots, 2)
})

// --------------------------------------------------------------- 模型输出

test('从模型输出里抠 JSON 的三种包装都能认', () => {
  assert.deepEqual(extractJson('{"ideas":["a"]}'), { ideas: ['a'] })
  assert.deepEqual(extractJson('好的：\n```json\n{"ideas":["a"]}\n```\n完'), { ideas: ['a'] })
  assert.deepEqual(extractJson('前言 {"ideas":["a"]} 后记'), { ideas: ['a'] })
})

test('子想法清洗：去编号、去重、限数量', () => {
  const long = 'x'.repeat(200)
  const ideas = normalizeIdeas(`{"ideas":["1. 实测对比","- 实测对比","反常识角度","", "${long}"]}`, 3)
  assert.deepEqual(ideas, ['实测对比', '反常识角度'])
})

test('提示词带上起点、已有子想法和数量', () => {
  const prompt = buildPrompt({ text: 'AI 工具', count: 3, angle: '选题', siblings: ['a'], lang: 'zh' })
  assert.match(prompt.user, /AI 工具/)
  assert.match(prompt.user, /已经有：a/)
  assert.match(prompt.user, /方向：选题/)
  assert.match(prompt.user, /给出 3 个/)
  assert.equal(prompt.count, 3)
  const english = buildPrompt({ text: 'AI tools', count: 2, lang: 'en' })
  assert.match(english.user, /Give 2 child ideas/)
})

// --------------------------------------------------------------- 大纲只有一份

test('客户端别名、导出模块、宿主工具三处生成的 Markdown 完全一致', async () => {
  const { toOutline } = await import('../client-src/model.js')
  const { renderExport } = await import('../client-src/export.js')
  const { outline } = await import('../src/outline.js')
  const doc = sampleState().docs[0]
  const a = toOutline(doc)
  const b = renderExport(doc, 'markdown')
  const c = outline(doc)
  assert.equal(a, b, 'model.toOutline 应该就是 export.toMarkdown')
  assert.equal(b, c, '宿主 outline 应该和导出格式一致')
  assert.match(b, /^  - 实测对比$/m, '子级缩进两格')
})

// --------------------------------------------------------------- 路由

function fakeReq({ method = 'GET', url = '/mind-canvas/state', body = null } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  setImmediate(() => {
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
    setHeader(name, value) { res.headers[name] = value },
    end(chunk) { res.body += chunk ?? ''; res.headersSent = true },
  }
  return res
}

async function call(ctx, store, options) {
  const res = fakeRes()
  await route(ctx, store, fakeReq(options), res, new URL(options.url ?? '/mind-canvas/state', 'http://localhost'))
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers }
}

test('GET /state 在没有文件时返回 null 而不是报错', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const result = await call({ get: () => undefined }, store, { url: '/mind-canvas/state' })
    assert.equal(result.status, 200)
    assert.equal(result.json.state, null)
  } finally {
    await cleanup()
  }
})

test('PUT /state 写入后 GET 能读回来', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const put = await call({ get: () => undefined }, store, { method: 'PUT', body: sampleState() })
    assert.equal(put.status, 200)
    assert.equal(put.json.ok, true)
    const get = await call({ get: () => undefined }, store, { url: '/mind-canvas/state' })
    assert.equal(get.json.state.docs[0].title, '选题')
  } finally {
    await cleanup()
  }
})

test('PUT /state 形状不对返回 400 且不写盘', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const put = await call({ get: () => undefined }, store, { method: 'PUT', body: { docs: 'nope' } })
    assert.equal(put.status, 400)
    assert.match(put.json.error.message, /docs/)
    assert.equal(await store.read(), null)
  } finally {
    await cleanup()
  }
})

test('POST /state 也接受（sendBeacon 的兜底路径）', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const result = await call({ get: () => undefined }, store, { method: 'POST', body: { state: sampleState() } })
    assert.equal(result.status, 200)
    assert.ok(await store.read())
  } finally {
    await cleanup()
  }
})

test('没有模型时 /expand 返回 503，不会假装发散成功', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const result = await call({ get: () => undefined }, store, { method: 'POST', url: '/mind-canvas/expand', body: { text: 'x' } })
    assert.equal(result.status, 503)
    assert.match(result.json.error.message, /模型/)
  } finally {
    await cleanup()
  }
})

test('未知接口 404', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const result = await call({ get: () => undefined }, store, { url: '/mind-canvas/nope' })
    assert.equal(result.status, 404)
  } finally {
    await cleanup()
  }
})

// --------------------------------------------------------------- 工具

test('mind_canvas_read / mind_canvas_add 能读能写', async () => {
  const { store, cleanup } = await tempStore()
  try {
    await store.write(sampleState())
    const tools = createTools(store)
    const read = tools.find(tool => tool.name === 'mind_canvas_read')
    const add = tools.find(tool => tool.name === 'mind_canvas_add')

    const readOut = await read.execute({})
    assert.equal(readOut.title, '选题')
    assert.match(readOut.outline, /实测对比/)

    const addOut = await add.execute({ parent: '实测', ideas: ['对比一', '对比二'] })
    assert.deepEqual(addOut.added, ['对比一', '对比二'])
    assert.equal(addOut.parent, '实测对比')

    const after = await store.read()
    assert.equal(after.docs[0].nodes.length, 4)
    assert.equal(after.revision, 4)
    assert.ok(after.docs[0].nodes.some(node => node.text === '对比二'))
  } finally {
    await cleanup()
  }
})

test('没有脑图时工具给出可读的错误', async () => {
  const { store, cleanup } = await tempStore()
  try {
    const tools = createTools(store)
    const read = tools.find(tool => tool.name === 'mind_canvas_read')
    await assert.rejects(() => read.execute({}), /还没有任何脑图/)
  } finally {
    await cleanup()
  }
})
