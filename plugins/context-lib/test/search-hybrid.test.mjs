import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createLibrary, LibraryError } from '../src/store.js'

// ------------------------------------------------------------------ helpers

async function makeLibrary(t, options) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxlib-search-'))
  t.after(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })
  const lib = await createLibrary(path.join(base, 'library'), options)
  await lib.init()
  await pruneDefaultSources(lib)
  return { base, lib }
}

async function pruneDefaultSources(lib) {
  for (const id of ['workspace', 'docs', 'dsh']) {
    try {
      await lib.removeSource(id)
    } catch (error) {
      if (!(error instanceof LibraryError) || error.code !== 'source-not-found') throw error
    }
  }
}

async function put(dir, rel, content) {
  const file = path.join(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
  return file
}

/**
 * 改动前的关键词打分参考实现（逐字照抄旧 scoreEntry），只用于回归对照：
 * mode:'keyword' 的命中集合与顺序必须和它一致。
 */
function legacyScore(entry, tokens, rawQuery) {
  const title = String(entry.title ?? '').toLowerCase()
  const tags = entry.tags.join(' ').toLowerCase()
  const collection = String(entry.collection ?? '').toLowerCase()
  const pathText = String(entry.path ?? '').toLowerCase()
  const preview = String(entry.preview ?? '').toLowerCase()
  let score = 0
  for (const token of tokens) {
    let hit = false
    if (title.includes(token)) {
      score += 6
      hit = true
    }
    if (tags.includes(token)) {
      score += 4
      hit = true
    }
    if (collection.includes(token)) {
      score += 2
      hit = true
    }
    if (pathText.includes(token)) {
      score += 2
      hit = true
    }
    if (preview.includes(token)) {
      score += 1
      hit = true
    }
    if (!hit) return null
  }
  const whole = String(rawQuery ?? '').trim().toLowerCase()
  if (whole && /[\u4e00-\u9fff]/.test(whole)) {
    if (title.includes(whole) || tags.includes(whole) || preview.includes(whole)) score += 3
  }
  return score
}

function legacyOrder(entries, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  return entries
    .map((entry) => ({ entry, score: legacyScore(entry, tokens, q) }))
    .filter((item) => item.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt))
    })
    .map((item) => item.entry.id)
}

// -------------------------------------------------------------------- tests

test('10 条 fixture 语料：纯关键词搜不到、hybrid 能搜到（热更新 / hotReload）', async (t) => {
  const { lib } = await makeLibrary(t)
  const corpus = [
    { title: '热 更新 手册', content: '第一行\n构建时热 更新资源\n第三行', collection: 'docs' },
    { title: '发布记录', content: 'hot reload pipeline 说明', collection: 'docs' },
    { title: '部署清单', content: '生产发布前逐项检查', collection: 'ops' },
    { title: '知识管理', content: '笔记与资料归档方式', collection: 'docs' },
    { title: '版本更新检查', content: '检查远端最新版本', collection: 'ops' },
    { title: 'pnpm 安装记录', content: 'pnpm install 与锁文件', collection: 'ops' },
    { title: '会话与 Session', content: '持久会话数据说明', collection: 'docs' },
    { title: '自动 reload 工具', content: 'watch 模式下自动 reload', collection: 'scripts' },
    { title: '回收站说明', content: '软删、恢复与彻底删除', collection: 'docs' },
    { title: '扫描来源', content: '增量扫描与删除对账', collection: 'docs' },
  ]
  const created = []
  for (const item of corpus) created.push(await lib.create(item))

  // 热更新：关键词整串搜不到「热 更新」，hybrid 通过 bigram「更新」命中；
  // 标题命中排在正文命中之前（第 5 条只有正文命中）。
  assert.equal((await lib.list({ q: '热更新', mode: 'keyword' })).total, 0)
  const cjk = await lib.list({ q: '热更新' })
  assert.equal(cjk.total, 2)
  assert.equal(cjk.items[0].id, created[0].id)
  assert.equal(cjk.items[1].id, created[4].id)

  // hotReload：关键词整串搜不到，hybrid 拆成 hot + reload；只有 reload 的干扰项不命中。
  assert.equal((await lib.list({ q: 'hotReload', mode: 'keyword' })).total, 0)
  const latin = await lib.list({ q: 'hotReload' })
  assert.equal(latin.total, 1)
  assert.equal(latin.items[0].id, created[1].id)
})

test('混合检索：keyword 搜不到、hybrid 能搜到（CJK bigram / camelCase 拆词）', async (t) => {
  const { lib } = await makeLibrary(t)

  const spaced = await lib.create({
    title: '热 更新 手册',
    content: '第一行\n构建时热 更新资源\n第三行',
    tags: ['dev'],
    collection: 'docs',
  })
  const camel = await lib.create({
    title: '发布记录',
    content: 'hot reload pipeline 说明',
    tags: ['dev'],
    collection: 'docs',
  })

  // 中文：正文写「热 更新」，query 是连着的「热更新」。
  assert.equal((await lib.list({ q: '热更新', mode: 'keyword' })).total, 0)
  const cjk = await lib.list({ q: '热更新' })
  assert.equal(cjk.total, 1)
  assert.equal(cjk.items[0].id, spaced.id)
  assert.equal(cjk.items[0].line, 2)
  assert.ok(cjk.items[0].snippet.includes('更新'))
  assert.ok(cjk.items[0].scoreParts.bm25 > 0)

  // 英文：camelCase 拆成 hot + reload；keyword 只看整串 hotreload，搜不到。
  assert.equal((await lib.list({ q: 'hotReload', mode: 'keyword' })).total, 0)
  const latin = await lib.list({ q: 'hotReload' })
  assert.equal(latin.total, 1)
  assert.equal(latin.items[0].id, camel.id)
  assert.equal(latin.items[0].line, 1)
})

test('精确标题命中排在正文命中之前', async (t) => {
  const { lib } = await makeLibrary(t)
  const titleDoc = await lib.create({ title: '部署清单', content: '普通说明', collection: 'ops' })
  const bodyDoc = await lib.create({ title: '普通文档', content: '部署清单\n部署清单', collection: 'ops' })

  const result = await lib.list({ q: '部署清单' })
  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map((item) => item.id), [titleDoc.id, bodyDoc.id])
  assert.ok(result.items[0].scoreParts.title > 0)
  assert.equal(result.items[1].scoreParts.title, 0)
  assert.ok(result.items[0].scoreParts.phrase > result.items[1].scoreParts.phrase)
  assert.ok(result.items[0].score > result.items[1].score)
})

test('确定性：同 query 同数据两次结果一致，同分按 id 升序', async (t) => {
  const { lib } = await makeLibrary(t)
  const first = await lib.create({ title: '同分条目', content: '完全一样的内容', collection: 'docs' })
  const second = await lib.create({ title: '同分条目', content: '完全一样的内容', collection: 'docs' })

  const runA = await lib.list({ q: '同分条目', limit: 10 })
  const runB = await lib.list({ q: '同分条目', limit: 10 })
  assert.equal(JSON.stringify(runA), JSON.stringify(runB))
  assert.deepEqual(runA.items.map((item) => item.id), [first.id, second.id].sort())
  assert.equal(runA.items[0].score, runA.items[1].score)
})

test('mode:keyword 与旧关键词实现一致（回归）', async (t) => {
  const { lib } = await makeLibrary(t)
  const n1 = await lib.create({ title: 'Alpha Guide', content: 'node.js 工具链说明', tags: ['tools', 'JS'], collection: 'docs' })
  const n2 = await lib.create({ title: 'Beta Notes', content: 'alpha beta gamma', tags: ['notes'], collection: 'docs' })
  const n3 = await lib.create({ title: 'Gamma', content: '完全无关的内容', collection: 'misc' })
  const entries = [await lib.get(n1.id), await lib.get(n2.id), await lib.get(n3.id)]

  for (const q of ['alpha', 'alpha js', 'js', 'node.js', '不存在的词', 'gamma', '完全无关']) {
    const keyword = await lib.list({ q, mode: 'keyword' })
    assert.deepEqual(keyword.items.map((item) => item.id), legacyOrder(entries, q), `q=${q}`)
  }

  const alpha = await lib.list({ q: 'alpha', mode: 'keyword' })
  assert.equal(alpha.total, 2)
  assert.equal(alpha.items[0].id, n1.id)
  assert.ok(alpha.items[1].snippet.toLowerCase().includes('alpha'))
  // keyword 模式保持旧返回结构：不附加 score / scoreParts / source / line。
  for (const key of ['score', 'scoreParts', 'source', 'line']) {
    assert.ok(!Object.hasOwn(alpha.items[0], key), `keyword 条目不应有 ${key}`)
  }

  // q 为空时 hybrid/keyword 完全一致，且仍是旧字段集合。
  assert.deepEqual(
    (await lib.list({})).items.map((item) => item.id).sort(),
    (await lib.list({ mode: 'keyword' })).items.map((item) => item.id).sort(),
  )
  const empty = await lib.list({})
  assert.deepEqual(
    Object.keys(empty.items[0]).sort(),
    ['collection', 'ext', 'id', 'kind', 'path', 'snippet', 'size', 'sourceId', 'status', 'tags', 'title', 'updatedAt', 'storage'].sort(),
  )
})

test('score / scoreParts / 权重可配，source 与 line 可关', async (t) => {
  const { lib } = await makeLibrary(t)
  await lib.create({ title: '部署清单', content: '第一行\n部署清单说明\n第三行', collection: 'ops' })

  const result = await lib.list({ q: '部署清单' })
  const item = result.items[0]
  assert.equal(typeof item.score, 'number')
  assert.deepEqual(Object.keys(item.scoreParts).sort(), ['bm25', 'body', 'meta', 'phrase', 'title'])
  assert.ok(path.isAbsolute(item.source))
  assert.equal(item.line, 2)

  const bm25Only = await lib.list({ q: '部署清单', weights: { phrase: 0, bm25: 1 } })
  assert.ok(Math.abs(bm25Only.items[0].score - bm25Only.items[0].scoreParts.bm25) < 1e-6)
  const phraseOnly = await lib.list({ q: '部署清单', weights: { phrase: 1, bm25: 0 } })
  assert.ok(Math.abs(phraseOnly.items[0].score - phraseOnly.items[0].scoreParts.phrase) < 1e-6)

  const noParts = await lib.list({ q: '部署清单', scoreParts: false })
  assert.equal(noParts.items[0].scoreParts, undefined)
  assert.equal(typeof noParts.items[0].score, 'number')

  const noLine = await lib.list({ q: '部署清单', line: false })
  assert.ok(path.isAbsolute(noLine.items[0].source))
  assert.equal(noLine.items[0].line, null)
})

test('createLibrary 的 searchWeights 作为默认权重，单次 weights 覆盖它', async (t) => {
  const { lib } = await makeLibrary(t, { searchWeights: { phrase: 0, bm25: 1 } })
  await lib.create({ title: '部署清单', content: '部署清单', collection: 'ops' })

  const defaults = await lib.list({ q: '部署清单' })
  assert.ok(Math.abs(defaults.items[0].score - defaults.items[0].scoreParts.bm25) < 1e-6)

  const override = await lib.list({ q: '部署清单', weights: { phrase: 1, bm25: 0 } })
  assert.ok(Math.abs(override.items[0].score - override.items[0].scoreParts.phrase) < 1e-6)
})

test('hybrid 下 kind/collection/tag/source 过滤与 facets 语义不变', async (t) => {
  const { lib } = await makeLibrary(t)
  await lib.create({ title: '部署清单', content: '部署清单', collection: 'ops', tags: ['run'] })
  await lib.create({ title: '普通文档', content: '部署清单', collection: 'ops' })
  await lib.create({ title: '另一篇', content: '部署清单', collection: 'misc' })

  const all = await lib.list({ q: '部署清单' })
  assert.equal(all.total, 3)
  assert.equal(all.facets.collections.find((entry) => entry.name === 'ops').count, 2)

  assert.equal((await lib.list({ q: '部署清单', collection: 'ops' })).total, 2)
  assert.equal((await lib.list({ q: '部署清单', tag: 'run' })).total, 1)
  assert.equal((await lib.list({ q: '部署清单', kind: 'note' })).total, 3)

  // facets 仍按 q 命中集算，不受额外筛选影响（旧语义）。
  const scoped = await lib.list({ q: '部署清单', collection: 'nope' })
  assert.equal(scoped.total, 0)
  assert.equal(scoped.facets.collections.find((entry) => entry.name === 'ops').count, 2)
})

test('linked 文件的 source 是原文件绝对路径，line 指向正文命中行', async (t) => {
  const { base, lib } = await makeLibrary(t)
  const sourceDir = path.join(base, 'source')
  const file = await put(sourceDir, 'guide.md', '# 指南\n第一行\n热 更新 步骤\n最后一行\n')
  await lib.addSource({ name: 'Tmp', path: sourceDir })
  const scanned = await lib.scan({ sourceId: 'tmp' })
  assert.equal(scanned.added, 1)

  const found = await lib.list({ q: '热更新' })
  assert.equal(found.total, 1)
  assert.equal(found.items[0].storage, 'linked')
  assert.equal(found.items[0].source, file)
  assert.equal(found.items[0].line, 3)
})
