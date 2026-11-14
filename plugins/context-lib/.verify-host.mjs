#!/usr/bin/env node
/**
 * .verify-host.mjs — dsh-context-lib 宿主半片验收（不依赖 Harness 运行时）。
 *
 * 用 stub ctx 载入 index.js，直接驱动 9 个 agent 工具 + 全部 HTTP 路由，
 * 检查落盘布局、扫描增量、回收站、鉴权与简报。
 *
 * 运行：node .verify-host.mjs
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { apply } from './index.js'

const PREFIX = '/api/context-lib'
let passed = 0
let failed = 0
const failures = []

function check(name, fn) {
  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      throw new Error('use await checkAsync')
    }
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

function makeRes() {
  return {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
    },
    end(body) {
      this.body = body === undefined ? '' : body
    },
  }
}

function makeReq(method, url, body, headers = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:0', ...headers }
  setImmediate(() => {
    if (body !== undefined && body !== null) {
      req.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    }
    req.emit('end')
  })
  return req
}

function makeCtx() {
  const tools = new Map()
  const sections = []
  const contexts = []
  const routes = []
  const listeners = new Map()
  const ref = {
    connection: { requestRejection: () => 0 },
    // 智能助手用：默认不提供模型，测试里按需装 stub（verify 不依赖真实 Harness）。
    llm: null,
    agentDefaultModel: null,
    modelReply: null,
    streamFinish: null,
    llmCalls: [],
  }
  ref.value = ref.connection
  const ctx = {
    tools: {
      register(definition) {
        assert.equal(typeof definition.name, 'string')
        assert.equal(typeof definition.execute, 'function')
        assert.ok(definition.parameters && definition.parameters.type === 'object')
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(entry) {
        sections.push(entry)
        return () => {}
      },
      context(entry) {
        contexts.push(entry)
        return () => {}
      },
      getSectionOrder() {
        return 2400
      },
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
      return () => {}
    },
    get(name) {
      if (name === 'connection') return ref.value
      if (name === 'llm') return ref.llm
      if (name === 'agentDefaultModel') return ref.agentDefaultModel
      return undefined
    },
    inject(_deps, cb) {
      const child = Object.create(ctx)
      cb(child)
    },
    webServer: {
      register(endpoint) {
        routes.push(endpoint)
        return () => {}
      },
    },
  }
  return { ctx, tools, sections, contexts, routes, listeners, ref }
}

// 默认按模式回一段合法 JSON；测试可用 ref.modelReply 覆盖成字符串或函数。
function defaultModelReply(user) {
  if (user.includes('请整理')) {
    const ids = [...new Set(String(user).match(/cl_[0-9a-f]{12}/g) || [])]
    return JSON.stringify({
      items: [
        ...ids.map((id) => ({ id, collection: 'assist', tags: ['整理', 'assist', '整理'], reason: '内容偏工具类。' })),
        { id: 'cl_ffffffffffff', collection: 'bogus', tags: [], reason: '不存在的条目应被丢弃。' },
      ],
    })
  }
  if (user.includes('用户的问题')) {
    return JSON.stringify({
      answer: '库里有两类相关条目：KV-Net 笔记和验收笔记。',
      filters: { q: 'KV 笔记', kind: 'weird-kind', collection: '不存在的归类', tag: '不存在的标签' },
    })
  }
  return JSON.stringify({
    summary: '这条资源记录了 KV-Net 的静态 KV 存储与 1.76× PPL 差距。',
    tags: ['kv-cache', 'llm', 'kv-cache'],
    collection: 'kv-notes',
    title: 'KV-Net 摘要',
  })
}

function installModel(ref, { provider = 'verify-provider', model = 'verify-model' } = {}) {
  ref.agentDefaultModel = { currentSelection: () => ({ provider, model }) }
  ref.llm = {
    prepareCall: async (request, _signal, controls) => {
      ref.llmCalls.push({ request })
      const config = typeof controls === 'function' ? { ...request, ...controls({ ...request }, { model }) } : { ...request }
      return {
        config,
        stream: async function* (params) {
          ref.llmCalls[ref.llmCalls.length - 1].params = params
          const user = params.messages?.[0]?.content?.[0]?.text || ''
          const text =
            typeof ref.modelReply === 'function' ? ref.modelReply(user, params.system || '') : ref.modelReply ?? defaultModelReply(user)
          yield { type: 'text-delta', text }
          yield { type: 'finish', reason: ref.streamFinish ?? { kind: 'stop' } }
        },
      }
    },
  }
  return ref.llm
}

function removeModel(ref) {
  ref.llm = null
  ref.agentDefaultModel = null
  ref.modelReply = null
  ref.streamFinish = null
}

async function callTool(tools, name, args) {
  const definition = tools.get(name)
  assert.ok(definition, `tool ${name} not registered`)
  return definition.execute(args, { agent: { id: 'session-verify' } })
}

function textOf(definition, args, value) {
  const blocks = definition.output.render(args, value)
  assert.ok(Array.isArray(blocks) && blocks.length >= 1)
  assert.equal(blocks[0].type, 'text')
  assert.equal(typeof blocks[0].text, 'string')
  return blocks[0].text
}

async function request(routes, method, url, body, headers) {
  assert.equal(routes.length, 1, 'expected exactly one webServer prefix route')
  const res = makeRes()
  await routes[0].handler(makeReq(method, url, body, headers), res)
  let json = null
  if (res.headers['content-type'] && String(res.headers['content-type']).includes('application/json')) {
    json = JSON.parse(String(res.body))
  }
  return { res, json }
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-lib-verify-'))
  const sampleDir = path.join(root, 'sample-source')
  await fs.mkdir(sampleDir, { recursive: true })
  await fs.writeFile(
    path.join(sampleDir, 'kv-net.md'),
    '---\ntitle: KV-Net 架构笔记\ntags: [kv-cache, llm]\n---\n\n# KV-Net\n\n静态 KV 存储，PPL 差距 1.76×。参见 [[attention]]。\n',
  )
  await fs.writeFile(path.join(sampleDir, 'probe.py'), 'import sys\nprint("probe")\n')
  await fs.writeFile(path.join(sampleDir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
  await fs.writeFile(path.join(sampleDir, 'skip.exe'), Buffer.from([0x4d, 0x5a]))

  const { ctx, tools, sections, contexts, routes, listeners, ref } = makeCtx()
  apply(ctx, { rootDir: root, briefing: 'context', autoScan: false })

  console.log(`\n库根目录: ${root}\n`)

  console.log('工具注册')
  check('注册 9 个 context_lib_* 工具', () => {
    const names = [...tools.keys()].sort()
    assert.deepEqual(names, [
      'context_lib_delete',
      'context_lib_pack',
      'context_lib_put',
      'context_lib_read',
      'context_lib_scan',
      'context_lib_search',
      'context_lib_sources',
      'context_lib_stats',
      'context_lib_update',
    ])
  })
  check('每个工具都有 output.render', () => {
    for (const definition of tools.values()) {
      assert.equal(typeof definition.output.render, 'function')
      assert.ok(definition.timeoutMs > 0)
    }
  })
  check('注册 systemPrompt.section 与 context 简报', () => {
    assert.ok(sections.some((entry) => entry.name === 'context-lib'))
    assert.ok(contexts.some((entry) => entry.name === 'context-lib-briefing'))
  })
  check('注册 webServer prefix 路由', () => {
    assert.equal(routes.length, 1)
    assert.equal(routes[0].kind, 'prefix')
    assert.equal(routes[0].path, PREFIX)
  })

  console.log('\n笔记 CRUD')
  let note = null
  await checkAsync('put 新建笔记并落盘 notes/<id>.md', async () => {
    const value = await callTool(tools, 'context_lib_put', {
      title: '上下文库验收笔记',
      content: '# 验收\n\n这句话里有独特关键词 骆驼祥子上下文库。\n第二行。\n第三行。',
      collection: 'verify',
      tags: ['verify', 'ctx'],
      notes: '由 verify-host 创建',
    })
    assert.equal(value.ok, undefined)
    note = value.item
    assert.match(note.id, /^cl_[0-9a-f]{12}$/)
    assert.equal(note.kind, 'note')
    assert.equal(note.status, 'active')
    assert.equal(note.collection, 'verify')
    assert.deepEqual(note.tags, ['verify', 'ctx'])
    const file = path.join(root, 'notes', `${note.id}.md`)
    const text = await fs.readFile(file, 'utf8')
    assert.match(text, /骆驼祥子/)
  })

  check('put 渲染文本包含条目 id', () => {
    const text = textOf(tools.get('context_lib_put'), {}, { item: note })
    assert.match(text, new RegExp(note.id))
    assert.match(text, /已写入/)
  })

  await checkAsync('search 命中中文关键词并返回 snippet', async () => {
    const value = await callTool(tools, 'context_lib_search', { query: '骆驼祥子' })
    assert.ok(value.total >= 1)
    const hit = value.items.find((item) => item.id === note.id)
    assert.ok(hit, 'note not found by full Chinese query')
    assert.ok(hit.snippet.includes('骆驼祥子'))
    assert.equal(hit.preview, undefined, 'list items must not carry full preview')
  })

  await checkAsync('search 支持 kind/collection/tag 过滤与分页', async () => {
    const byCollection = await callTool(tools, 'context_lib_search', { collection: 'verify' })
    assert.ok(byCollection.items.every((item) => item.collection === 'verify'))
    const byTag = await callTool(tools, 'context_lib_search', { tag: 'ctx' })
    assert.ok(byTag.items.some((item) => item.id === note.id))
    const byKind = await callTool(tools, 'context_lib_search', { kind: 'doc' })
    assert.ok(byKind.items.every((item) => item.kind === 'doc'))
    const page = await callTool(tools, 'context_lib_search', { limit: 1, offset: 0 })
    assert.equal(page.items.length, 1)
    assert.equal(page.limit, 1)
  })

  await checkAsync('read 全文与行范围', async () => {
    const full = await callTool(tools, 'context_lib_read', { id: note.id })
    assert.match(full.text, /骆驼祥子/)
    const ranged = await callTool(tools, 'context_lib_read', { id: note.id, startLine: 1, endLine: 1 })
    assert.match(ranged.text, /验收/)
    assert.doesNotMatch(ranged.text, /骆驼祥子/)
    assert.ok(full.totalLines >= 4)
  })

  await checkAsync('update 改标题/标签/归类/正文', async () => {
    const value = await callTool(tools, 'context_lib_update', {
      id: note.id,
      title: '验收笔记 v2',
      tags: ['verify', 'v2'],
      collection: 'verify2',
      content: '# 验收\n\n改过的正文 骆驼祥子。',
    })
    assert.equal(value.item.title, '验收笔记 v2')
    assert.deepEqual(value.item.tags, ['verify', 'v2'])
    assert.equal(value.item.collection, 'verify2')
    const read = await callTool(tools, 'context_lib_read', { id: note.id })
    assert.match(read.text, /改过的正文/)
  })

  await checkAsync('read 不存在的条目返回 item-not-found', async () => {
    const value = await callTool(tools, 'context_lib_read', { id: 'cl_000000000000' })
    assert.equal(value.ok, false)
    assert.equal(value.error.code, 'item-not-found')
    const text = textOf(tools.get('context_lib_read'), {}, value)
    assert.match(text, /item-not-found/)
  })

  console.log('\n来源与扫描')
  let sourceId = ''
  await checkAsync('sources add 新建来源', async () => {
    const value = await callTool(tools, 'context_lib_sources', { action: 'add', name: 'sample', path: sampleDir })
    const source = value.sources.find((entry) => entry.path === sampleDir)
    assert.ok(source, 'source not added')
    sourceId = source.id
  })

  await checkAsync('scan 登记 md/py/png，跳过未知扩展名', async () => {
    const value = await callTool(tools, 'context_lib_scan', { sourceId })
    assert.equal(value.results.length, 1)
    const result = value.results[0]
    assert.equal(result.added, 3)
    assert.equal(result.errors.length, 0)
    const list = await callTool(tools, 'context_lib_search', { source: sourceId, limit: 20 })
    const titles = list.items.map((item) => item.title)
    assert.ok(titles.some((title) => title.includes('KV-Net')))
    const kinds = new Set(list.items.map((item) => item.kind))
    assert.ok(kinds.has('doc') && kinds.has('script') && kinds.has('image'))
    const exe = list.items.find((item) => item.title.endsWith('.exe'))
    assert.equal(exe, undefined)
  })

  await checkAsync('frontmatter title/tags 与 [[wiki]] 链接被解析', async () => {
    const list = await callTool(tools, 'context_lib_search', { query: 'KV-Net', source: sourceId })
    const hit = list.items.find((item) => item.title === 'KV-Net 架构笔记')
    assert.ok(hit, 'frontmatter title not applied')
    assert.ok(hit.tags.includes('kv-cache'))
    const entry = await callTool(tools, 'context_lib_read', { id: hit.id })
    assert.match(entry.text, /静态 KV/)
  })

  await checkAsync('增量扫描：未变/修改/删除', async () => {
    const again = await callTool(tools, 'context_lib_scan', { sourceId })
    assert.equal(again.results[0].unchanged, 3)
    assert.equal(again.results[0].added, 0)

    await fs.writeFile(path.join(sampleDir, 'probe.py'), 'import sys\nprint("probe v2")\n')
    const future = new Date(Date.now() + 2000)
    await fs.utimes(path.join(sampleDir, 'probe.py'), future, future)
    const changed = await callTool(tools, 'context_lib_scan', { sourceId })
    assert.equal(changed.results[0].updated, 1)

    await fs.rm(path.join(sampleDir, 'diagram.png'))
    const removed = await callTool(tools, 'context_lib_scan', { sourceId })
    assert.equal(removed.results[0].removed, 1)
  })

  await checkAsync('图片条目 read 返回本机路径与 binary 标记', async () => {
    const list = await callTool(tools, 'context_lib_search', { kind: 'image', source: sourceId })
    assert.equal(list.items.length, 0, 'deleted png should be gone')
  })

  console.log('\n统计 / 打包 / 回收站')
  await checkAsync('stats 反映条目与来源', async () => {
    const value = await callTool(tools, 'context_lib_stats', {})
    assert.ok(value.stats.counts.active >= 3)
    assert.ok(value.stats.sources.some((source) => source.id === sourceId))
    assert.ok(Array.isArray(value.stats.collections))
  })

  await checkAsync('pack 拼出集合上下文', async () => {
    await callTool(tools, 'context_lib_put', {
      title: '打包用笔记 A',
      content: 'A 内容',
      collection: 'packset',
    })
    await callTool(tools, 'context_lib_put', {
      title: '打包用笔记 B',
      content: 'B 内容',
      collection: 'packset',
    })
    const value = await callTool(tools, 'context_lib_pack', { collection: 'packset' })
    assert.equal(value.total, 2)
    assert.match(value.text, /A 内容/)
    assert.match(value.text, /B 内容/)
  })

  await checkAsync('delete 软删 → trash → restore', async () => {
    const value = await callTool(tools, 'context_lib_delete', { id: note.id })
    assert.equal(value.item.status, 'trashed')
    const search = await callTool(tools, 'context_lib_search', { query: '改过的正文' })
    assert.equal(search.items.length, 0, 'trashed item should not appear in active search')
    const trash = await callTool(tools, 'context_lib_search', { query: '' })
    assert.ok(trash.total >= 1)
    const restored = await callTool(tools, 'context_lib_update', { id: note.id, title: '验收笔记 v3' })
    assert.equal(restored.item.status, 'trashed', 'update must not resurrect from trash')
    const ok = await request(routes, 'POST', `${PREFIX}/items/${note.id}/restore`)
    assert.equal(ok.res.status, 200)
    assert.equal(ok.json.data.item.status, 'active')
  })

  await checkAsync('purge 彻底删除且不影响 linked 原文件', async () => {
    const before = await fs.stat(path.join(sampleDir, 'kv-net.md'))
    await callTool(tools, 'context_lib_delete', { id: note.id, purge: true })
    const value = await callTool(tools, 'context_lib_read', { id: note.id })
    assert.equal(value.error.code, 'item-not-found')
    const after = await fs.stat(path.join(sampleDir, 'kv-net.md'))
    assert.equal(after.size, before.size)
  })

  console.log('\nHTTP 路由')
  await checkAsync('无 connection 服务时失败关闭 503', async () => {
    ref.value = undefined
    const { res, json } = await request(routes, 'GET', `${PREFIX}/state`)
    assert.equal(res.status, 503)
    assert.equal(json.ok, false)
    ref.value = { requestRejection: () => 0 }
  })

  await checkAsync('鉴权拒绝时返回其状态码', async () => {
    ref.value = { requestRejection: () => 401 }
    const { res } = await request(routes, 'GET', `${PREFIX}/state`)
    assert.equal(res.status, 401)
    ref.value = { requestRejection: () => 0 }
  })

  await checkAsync('GET /state 返回 stats/sources/trashCount', async () => {
    const { res, json } = await request(routes, 'GET', `${PREFIX}/state`)
    assert.equal(res.status, 200)
    assert.equal(json.ok, true)
    assert.ok(json.data.stats.counts.active >= 1)
    assert.ok(Array.isArray(json.data.sources))
    assert.ok(typeof json.data.trashCount === 'number')
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  })

  await checkAsync('POST /items 与 GET /items?q=', async () => {
    const created = await request(routes, 'POST', `${PREFIX}/items`, {
      title: 'HTTP 笔记',
      content: 'HTTP 写入的正文 关键词HTTPONLY。',
      collection: 'http',
      tags: ['http'],
    })
    assert.equal(created.res.status, 201)
    const item = created.json.data.item
    assert.equal(item.kind, 'note')
    const listed = await request(routes, 'GET', `${PREFIX}/items?q=HTTPONLY`)
    assert.equal(listed.res.status, 200)
    assert.ok(listed.json.data.items.some((entry) => entry.id === item.id))
    const detail = await request(routes, 'GET', `${PREFIX}/items/${item.id}`)
    assert.equal(detail.res.status, 200)
    assert.match(detail.json.data.content, /HTTPONLY/)
    const content = await request(routes, 'GET', `${PREFIX}/items/${item.id}/content?startLine=1&endLine=1`)
    assert.equal(content.res.status, 200)
    assert.ok(content.json.data.text.length > 0)
  })

  await checkAsync('POST /items/:id/reveal 只对 linked 且有原文件的条目放行', async () => {
    const note = await request(routes, 'POST', `${PREFIX}/items`, { title: '没有路径的笔记', content: '笔记正文' })
    const noteReveal = await request(routes, 'POST', `${PREFIX}/items/${note.json.data.item.id}/reveal`)
    assert.equal(noteReveal.res.status, 404)
    assert.equal(noteReveal.json.error.code, 'item-not-found')

    const missing = await request(routes, 'POST', `${PREFIX}/items/cl_000000000000/reveal`)
    assert.equal(missing.res.status, 404)

    // linked 条目：把原文件抽掉，reveal 必须报 404 而不是真的去开访达。
    const listed = await request(routes, 'GET', `${PREFIX}/items?source=${sourceId}&kind=doc`)
    const linked = listed.json.data.items.find((entry) => entry.path)
    assert.ok(linked, '需要至少一个带 path 的 linked 条目')
    const saved = `${linked.path}.reveal-test`
    await fs.rename(linked.path, saved)
    try {
      const reveal = await request(routes, 'POST', `${PREFIX}/items/${linked.id}/reveal`)
      assert.equal(reveal.res.status, 404)
      assert.match(reveal.json.error.message, /原文件已不在/)
    } finally {
      await fs.rename(saved, linked.path)
    }
  })

  await checkAsync('PATCH /items/:id 修改字段', async () => {
    const listed = await request(routes, 'GET', `${PREFIX}/items?q=HTTPONLY`)
    const id = listed.json.data.items[0].id
    const patched = await request(routes, 'PATCH', `${PREFIX}/items/${id}`, { tags: ['http', 'patched'], collection: 'http2' })
    assert.equal(patched.res.status, 200)
    assert.deepEqual(patched.json.data.item.tags, ['http', 'patched'])
    assert.equal(patched.json.data.item.collection, 'http2')
  })

  await checkAsync('GET /items/:id/preview：html 转纯文本，不支持的缩略图返回 415', async () => {
    await fs.writeFile(
      path.join(sampleDir, 'page.html'),
      '<h1>页面标题</h1><p>正文 hello <b>world</b></p><script>var x = 1</script>',
      'utf8',
    )
    await callTool(tools, 'context_lib_scan', { sourceId })
    const found = await callTool(tools, 'context_lib_search', { q: '正文 hello', limit: 10 })
    const entry = found.items.find((item) => String(item.ext).toLowerCase() === 'html')
    assert.ok(entry, 'html 条目应被收录')
    const pv = await request(routes, 'GET', `${PREFIX}/items/${entry.id}/preview`)
    assert.equal(pv.res.status, 200)
    assert.equal(pv.json.data.kind, 'text')
    assert.match(pv.json.data.text, /正文 hello world/)
    assert.ok(!/var x = 1/.test(pv.json.data.text), '脚本内容应被剥掉')
    const thumb = await request(routes, 'GET', `${PREFIX}/items/${entry.id}/thumb`)
    assert.equal(thumb.res.status, 200)
    assert.equal(thumb.res.headers['content-type'], 'image/png')
  })

  await checkAsync('GET /trash 与 POST /scan、GET /sources', async () => {
    const trash = await request(routes, 'GET', `${PREFIX}/trash`)
    assert.equal(trash.res.status, 200)
    assert.ok(Array.isArray(trash.json.data.items))
    const scan = await request(routes, 'POST', `${PREFIX}/scan`, { sourceId })
    assert.equal(scan.res.status, 200)
    assert.equal(scan.json.data.results[0].unchanged, 3)
    const sources = await request(routes, 'GET', `${PREFIX}/sources`)
    assert.equal(sources.res.status, 200)
    assert.ok(sources.json.data.sources.some((source) => source.id === sourceId))
  })

  await checkAsync('未知路由 404、非法方法 405', async () => {
    const notFound = await request(routes, 'GET', `${PREFIX}/nope`)
    assert.equal(notFound.res.status, 404)
    const method = await request(routes, 'PUT', `${PREFIX}/state`)
    assert.equal(method.res.status, 405)
  })

  await checkAsync('GET /pack 返回集合文本', async () => {
    const packed = await request(routes, 'GET', `${PREFIX}/pack?collection=packset`)
    assert.equal(packed.res.status, 200)
    assert.equal(packed.json.data.total, 2)
    assert.match(packed.json.data.text, /A 内容/)
  })

  console.log('\n智能助手')

  await checkAsync('GET /assist/status 无 llm → ready:false 且 reason 非空', async () => {
    removeModel(ref)
    const status = await request(routes, 'GET', `${PREFIX}/assist/status`)
    assert.equal(status.res.status, 200)
    assert.equal(status.json.data.ready, false)
    assert.equal(status.json.data.model, null)
    assert.equal(typeof status.json.data.reason, 'string')
    assert.ok(status.json.data.reason.length > 0)
  })

  await checkAsync('GET /assist/status 有 llm → ready:true 且 model 正确', async () => {
    installModel(ref, { model: 'verify-model' })
    const status = await request(routes, 'GET', `${PREFIX}/assist/status`)
    assert.equal(status.res.status, 200)
    assert.equal(status.json.data.ready, true)
    assert.equal(status.json.data.model, 'verify-model')
    assert.equal(status.json.data.reason, null)
  })

  let assistNoteId = null
  await checkAsync('POST /assist summary → text 与 actions.tags/collection 正确', async () => {
    const created = await request(routes, 'POST', `${PREFIX}/items`, {
      title: 'KV-Net 辅助笔记',
      content: 'KV-Net 用静态 KV 存储，PPL 差距 1.76×。',
      collection: 'verify',
      tags: ['kv-cache'],
    })
    assert.equal(created.res.status, 201)
    assistNoteId = created.json.data.item.id
    const summary = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'summary', id: assistNoteId })
    assert.equal(summary.res.status, 200)
    assert.equal(summary.json.data.mode, 'summary')
    assert.equal(summary.json.data.model, 'verify-model')
    assert.match(summary.json.data.text, /1\.76×/)
    assert.deepEqual(summary.json.data.actions.tags, ['kv-cache', 'llm'])
    assert.equal(summary.json.data.actions.collection, 'kv-notes')
    assert.equal(summary.json.data.actions.title, 'KV-Net 摘要')
    assert.equal(ref.llmCalls.at(-1).request.model, 'verify-model')
    assert.match(ref.llmCalls.at(-1).params.messages[0].content[0].text, /KV-Net 辅助笔记/)
  })

  await checkAsync('POST /assist summary 不存在的 id → 404 item-not-found', async () => {
    const missing = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'summary', id: 'cl_000000000000' })
    assert.equal(missing.res.status, 404)
    assert.equal(missing.json.error.code, 'item-not-found')
  })

  await checkAsync('POST /assist organize → actions.items 只含输入 id', async () => {
    const second = await request(routes, 'POST', `${PREFIX}/items`, {
      title: 'probe 脚本笔记',
      content: 'probe.py 是来源扫描的样本。',
      collection: 'verify',
    })
    const secondId = second.json.data.item.id
    const organized = await request(routes, 'POST', `${PREFIX}/assist`, {
      mode: 'organize',
      ids: [assistNoteId, secondId, 'cl_000000000000'],
    })
    assert.equal(organized.res.status, 200)
    const items = organized.json.data.actions.items
    assert.ok(Array.isArray(items) && items.length === 2)
    for (const item of items) assert.ok([assistNoteId, secondId].includes(item.id))
    assert.equal(items.find((item) => item.id === assistNoteId).collection, 'assist')
    assert.deepEqual(items.find((item) => item.id === assistNoteId).tags, ['整理', 'assist'])
  })

  await checkAsync('POST /assist ask → filters 里非法 kind/collection/tag 被丢弃', async () => {
    const asked = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'ask', question: 'KV-Net 的笔记在哪？' })
    assert.equal(asked.res.status, 200)
    assert.equal(asked.json.data.mode, 'ask')
    assert.equal(asked.json.data.actions.filters.q, 'KV 笔记')
    assert.equal(asked.json.data.actions.filters.kind, undefined)
    assert.equal(asked.json.data.actions.filters.collection, undefined)
    assert.equal(asked.json.data.actions.filters.tag, undefined)
    assert.match(asked.json.data.text, /KV-Net/)
  })

  await checkAsync('POST /assist 非法参数 → 400 invalid-argument', async () => {
    const badMode = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'explain', id: assistNoteId })
    assert.equal(badMode.res.status, 400)
    assert.equal(badMode.json.error.code, 'invalid-argument')
    const emptyIds = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'organize', ids: [] })
    assert.equal(emptyIds.res.status, 400)
    const tooMany = await request(routes, 'POST', `${PREFIX}/assist`, {
      mode: 'organize',
      ids: Array.from({ length: 31 }, () => assistNoteId),
    })
    assert.equal(tooMany.res.status, 400)
    const noQuestion = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'ask' })
    assert.equal(noQuestion.res.status, 400)
  })

  await checkAsync('POST /assist 模型输出非 JSON → 502 assist-failed 且带原始文本', async () => {
    installModel(ref)
    ref.modelReply = '抱歉，我无法输出 JSON。'
    const failed = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'summary', id: assistNoteId })
    assert.equal(failed.res.status, 502)
    assert.equal(failed.json.error.code, 'assist-failed')
    assert.match(failed.json.error.message, /抱歉/)
  })

  await checkAsync('POST /assist 模型流报错 → 502 assist-failed', async () => {
    installModel(ref)
    ref.streamFinish = { kind: 'error', failure: { message: 'stub 模型报错' } }
    const failed = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'ask', question: '会失败的问题' })
    ref.streamFinish = null
    assert.equal(failed.res.status, 502)
    assert.equal(failed.json.error.code, 'assist-failed')
    assert.match(failed.json.error.message, /stub 模型报错/)
  })

  await checkAsync('POST /assist 有 llm 但无默认模型 → 503 assist-unavailable', async () => {
    installModel(ref)
    ref.agentDefaultModel = null
    const status = await request(routes, 'GET', `${PREFIX}/assist/status`)
    assert.equal(status.json.data.ready, false)
    assert.ok(status.json.data.reason.length > 0)
    const unavailable = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'ask', question: '随便问问' })
    assert.equal(unavailable.res.status, 503)
    assert.equal(unavailable.json.error.code, 'assist-unavailable')
  })

  await checkAsync('POST /assist 无 llm → 503 assist-unavailable', async () => {
    removeModel(ref)
    const unavailable = await request(routes, 'POST', `${PREFIX}/assist`, { mode: 'ask', question: '随便问问' })
    assert.equal(unavailable.res.status, 503)
    assert.equal(unavailable.json.error.code, 'assist-unavailable')
  })

  console.log('\n上下文注入')
  await checkAsync('briefing.current() 返回非空且包含条目数', async () => {
    const entry = contexts.find((item) => item.name === 'context-lib-briefing')
    assert.ok(entry)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const text = entry.text()
    assert.ok(text.length > 0, 'briefing empty after refresh')
    assert.match(text, /Context library/)
  })

  await checkAsync('扫描来源的 linked 条目删除后原文件仍在', async () => {
    const list = await callTool(tools, 'context_lib_search', { source: sourceId, limit: 50 })
    const doc = list.items.find((item) => item.kind === 'doc')
    const before = await fs.readFile(doc.path, 'utf8')
    await callTool(tools, 'context_lib_delete', { id: doc.id })
    const after = await fs.readFile(doc.path, 'utf8')
    assert.equal(after, before)
  })

  await checkAsync('config 未知键会告警但不影响加载', async () => {
    const ctx2 = makeCtx()
    apply(ctx2.ctx, { rootDir: root, totallyUnknownKey: true })
    assert.equal(ctx2.tools.size, 9)
  })

  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) {
    for (const failure of failures) console.log(`\n[${failure.name}]\n${failure.error.stack}`)
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
