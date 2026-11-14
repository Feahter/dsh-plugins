import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as store from '../src/store.js'

const { createLibrary, LibraryError, resolveRoot, classifyKind, mimeFor } = store

// ------------------------------------------------------------------ helpers

async function makeSandbox(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxlib-'))
  t.after(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })
  const root = path.join(base, 'library')
  const source = path.join(base, 'source')
  await fs.mkdir(source, { recursive: true })
  return { base, root, source }
}

async function makeLibrary(t, options) {
  const box = await makeSandbox(t)
  const lib = await createLibrary(box.root, options)
  await lib.init()
  return { ...box, lib }
}

/** 移除默认来源，保证测试只碰 tmpdir。 */
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

function expectCode(code) {
  return (error) => {
    assert.ok(error instanceof LibraryError, `期望 LibraryError，实际 ${error && error.name}`)
    assert.equal(error.code, code)
    return true
  }
}

async function scanOnce(lib, sourceId, extra = {}) {
  return lib.scan({ sourceId, ...extra })
}

// -------------------------------------------------------------------- tests

test('init 幂等，且只在 sources.json 缺失时写入默认来源', async (t) => {
  const { base, root } = await makeSandbox(t)
  const lib = await createLibrary(root)
  assert.equal(await lib.init(), lib)
  assert.equal(await lib.init(), lib)

  const sourcesFile = path.join(root, 'sources.json')
  const raw = JSON.parse(await fs.readFile(sourcesFile, 'utf8'))
  assert.deepEqual(raw.sources.map((source) => source.id), ['workspace', 'docs', 'dsh'])
  assert.deepEqual(raw.sources.map((source) => source.name), ['工作区', '文档', 'DSH'])
  assert.deepEqual(raw.sources.map((source) => source.depth), [4, 3, 3])
  for (const source of raw.sources) {
    assert.ok(path.isAbsolute(source.path))
    assert.equal(source.lastScanAt, null)
  }

  const before = await fs.readFile(sourcesFile, 'utf8')
  await lib.init()
  assert.equal(await fs.readFile(sourcesFile, 'utf8'), before)

  // 默认来源全部移除后，sources() 为空；init 不会重新种入。
  await pruneDefaultSources(lib)
  assert.deepEqual(await lib.sources(), [])
  await lib.init()
  assert.deepEqual(await lib.sources(), [])

  // 再次打开同一个根目录，不重复种默认来源。
  const reopened = await createLibrary(root)
  await reopened.init()
  assert.deepEqual(await reopened.sources(), [])

  assert.equal(await lib.get('cl_000000000000'), null)
  assert.ok(path.isAbsolute(resolveRoot({ rootDir: root })))
  assert.equal(resolveRoot({ rootDir: base }), path.resolve(base))
})

test('create / update / readText：笔记落盘、字段与正文按契约变化', async (t) => {
  const { root, lib } = await makeLibrary(t)
  await pruneDefaultSources(lib)

  const content = '# 标题\n\n[[目标]] 内容 hello'
  const created = await lib.create({
    title: '笔记一',
    content,
    tags: ['alpha', '#beta', 'alpha'],
    collection: 'docs',
    notes: '一句备注',
  })

  assert.match(created.id, /^cl_[0-9a-f]{12}$/)
  assert.equal(created.kind, 'note')
  assert.equal(created.ext, 'md')
  assert.equal(created.storage, 'note')
  assert.equal(created.status, 'active')
  assert.equal(created.title, '笔记一')
  assert.equal(created.collection, 'docs')
  assert.deepEqual(created.tags, ['alpha', 'beta'])
  assert.equal(created.sourceId, null)
  assert.equal(created.path, null)
  assert.equal(created.size, Buffer.byteLength(content, 'utf8'))
  assert.equal(created.lines, 3)
  assert.deepEqual(created.links, ['目标'])
  assert.equal(created.notes, '一句备注')
  assert.ok(created.preview.includes('# 标题'))
  assert.match(created.sha256, /^[0-9a-f]{64}$/)

  const noteFile = path.join(root, 'notes', `${created.id}.md`)
  assert.equal(await fs.readFile(noteFile, 'utf8'), content)

  const got = await lib.get(created.id)
  assert.equal(got.id, created.id)
  got.tags.push('被外部篡改')
  assert.deepEqual((await lib.get(created.id)).tags, ['alpha', 'beta'])

  const read = await lib.readText(created.id)
  assert.equal(read.id, created.id)
  assert.equal(read.title, '笔记一')
  assert.equal(read.text, content)
  assert.equal(read.totalLines, 3)
  assert.equal(read.bytes, Buffer.byteLength(content, 'utf8'))
  assert.equal(read.truncated, false)

  const line3 = await lib.readText(created.id, { startLine: 3, endLine: 3 })
  assert.equal(line3.text, '[[目标]] 内容 hello')
  assert.equal(line3.truncated, true)

  const limited = await lib.readText(created.id, { maxChars: 5 })
  assert.equal(limited.text.length, 5)
  assert.equal(limited.truncated, true)

  const updated = await lib.update(created.id, {
    title: '笔记二',
    tags: ['gamma'],
    collection: 'inbox',
    content: '# 新标题\n正文',
  })
  assert.equal(updated.id, created.id)
  assert.equal(updated.title, '笔记二')
  assert.deepEqual(updated.tags, ['gamma'])
  assert.equal(updated.collection, 'inbox')
  assert.equal(updated.size, Buffer.byteLength('# 新标题\n正文', 'utf8'))
  assert.equal(updated.lines, 2)
  assert.deepEqual(updated.links, [])
  assert.ok(updated.preview.includes('# 新标题'))
  assert.equal(await fs.readFile(noteFile, 'utf8'), '# 新标题\n正文')
  assert.equal((await lib.readText(created.id)).text, '# 新标题\n正文')

  const titleOnly = await lib.update(created.id, { title: '只改标题' })
  assert.equal(titleOnly.title, '只改标题')
  assert.equal(titleOnly.collection, 'inbox')
  assert.deepEqual(titleOnly.tags, ['gamma'])
  assert.equal((await lib.readText(created.id)).text, '# 新标题\n正文')

  assert.equal((await lib.stats()).counts.active, 1)
  assert.equal((await lib.stats()).counts.notes, 1)
  assert.equal((await lib.stats()).counts.byKind.note, 1)
  assert.equal((await lib.stats()).bytes, Buffer.byteLength('# 新标题\n正文', 'utf8'))
})

test('remove / restore / purge：回收站与 linked 原文件保护', async (t) => {
  const { lib, source } = await makeLibrary(t)
  await pruneDefaultSources(lib)

  const note = await lib.create({ title: '回收站笔记', content: '内容' })
  const noteFile = path.join(lib.root, 'notes', `${note.id}.md`)

  const trashed = await lib.remove(note.id)
  assert.equal(trashed.status, 'trashed')
  assert.equal(typeof trashed.trashedAt, 'string')
  assert.equal((await lib.get(note.id)).status, 'trashed')

  const active = await lib.list()
  assert.equal(active.total, 0)
  const trash = await lib.listTrash()
  assert.equal(trash.total, 1)
  assert.equal(trash.items[0].id, note.id)
  assert.equal(trash.items[0].status, 'trashed')

  const restored = await lib.restore(note.id)
  assert.equal(restored.status, 'active')
  assert.equal(restored.trashedAt, null)
  assert.equal((await lib.listTrash()).total, 0)
  assert.equal((await lib.list()).total, 1)

  const purged = await lib.purge(note.id)
  assert.deepEqual(purged, { id: note.id })
  assert.equal(await lib.get(note.id), null)
  await assert.rejects(fs.access(noteFile), { code: 'ENOENT' })
  await assert.rejects(lib.readText(note.id), expectCode('item-not-found'))
  await assert.rejects(lib.remove(note.id), expectCode('item-not-found'))
  await assert.rejects(lib.restore(note.id), expectCode('item-not-found'))
  await assert.rejects(lib.purge(note.id), expectCode('item-not-found'))

  // linked：purge 只删索引，原文件必须留着。
  const original = await put(source, 'keep.md', '# 要保留的文件\n正文')
  const added = await lib.addSource({ name: 'Keep', path: source })
  await scanOnce(lib, added.id)
  const listed = await lib.list({ source: added.id })
  assert.equal(listed.total, 1)
  const linked = await lib.get(listed.items[0].id)
  assert.equal(linked.storage, 'linked')
  assert.equal(linked.path, original)

  await lib.remove(linked.id)
  const linkedPurged = await lib.purge(linked.id)
  assert.deepEqual(linkedPurged, { id: linked.id })
  assert.equal(await lib.get(linked.id), null)
  assert.equal(await fs.readFile(original, 'utf8'), '# 要保留的文件\n正文')
})

test('list：检索 AND、计分排序、过滤、分页、snippet、facets', async (t) => {
  const { lib } = await makeLibrary(t)
  await pruneDefaultSources(lib)

  const n1 = await lib.create({
    title: 'Alpha Guide',
    content: 'node.js 工具链说明',
    tags: ['tools', 'JS'],
    collection: 'docs',
  })
  const n2 = await lib.create({
    title: 'Beta Notes',
    content: 'alpha beta gamma',
    tags: ['notes'],
    collection: 'docs',
  })
  const n3 = await lib.create({
    title: 'Gamma',
    content: '完全无关的内容',
    collection: 'misc',
  })

  const all = await lib.list()
  assert.equal(all.total, 3)
  assert.equal(all.items.length, 3)
  for (const item of all.items) {
    assert.ok(Object.hasOwn(item, 'snippet'))
    assert.ok(!Object.hasOwn(item, 'preview'))
    assert.deepEqual(
      Object.keys(item).sort(),
      ['collection', 'ext', 'id', 'kind', 'path', 'snippet', 'size', 'sourceId', 'status', 'tags', 'title', 'updatedAt', 'storage'].sort(),
    )
    // note 条目没有本机文件路径；linked 条目必须带。
    assert.equal(item.path, null)
    assert.ok(item.snippet.length <= 160)
  }

  const search = await lib.list({ q: 'alpha' })
  assert.equal(search.total, 2)
  assert.equal(search.items[0].id, n1.id)
  assert.equal(search.items[1].id, n2.id)
  assert.ok(search.items[1].snippet.toLowerCase().includes('alpha'))
  assert.ok(search.items[0].snippet.length <= 160)

  const andSearch = await lib.list({ q: 'alpha js' })
  assert.equal(andSearch.total, 1)
  assert.equal(andSearch.items[0].id, n1.id)

  assert.equal((await lib.list({ q: '不存在的词' })).total, 0)
  assert.equal((await lib.list({ kind: 'note' })).total, 3)
  assert.equal((await lib.list({ collection: 'docs' })).total, 2)
  assert.equal((await lib.list({ tag: 'tools' })).total, 1)
  assert.equal((await lib.list({ collection: 'docs', kind: 'note' })).total, 2)

  const facets = all.facets
  assert.deepEqual(facets.kinds.find((item) => item.kind === 'note'), { kind: 'note', count: 3 })
  assert.deepEqual(facets.collections.find((item) => item.name === 'docs'), { name: 'docs', count: 2 })
  assert.deepEqual(facets.tags.find((item) => item.name === 'tools'), { name: 'tools', count: 1 })

  const page1 = await lib.list({ limit: 1, offset: 0 })
  const page2 = await lib.list({ limit: 1, offset: 1 })
  assert.equal(page1.total, 3)
  assert.equal(page1.items.length, 1)
  assert.equal(page2.items.length, 1)
  assert.notEqual(page1.items[0].id, page2.items[0].id)
  assert.equal((await lib.list({ limit: 999 })).items.length, 3)

  const byTitle = await lib.list({ sort: 'title' })
  assert.deepEqual(byTitle.items.map((item) => item.title), ['Alpha Guide', 'Beta Notes', 'Gamma'])

  await lib.remove(n3.id)
  assert.equal((await lib.list()).total, 2)
  assert.equal((await lib.list({ status: 'trashed' })).total, 1)
  assert.equal((await lib.list({ status: 'all' })).total, 3)
})

test('scan：新增 / unchanged / 修改 updated / 删除 removed 与元数据抽取', async (t) => {
  const { lib, source } = await makeLibrary(t)
  await pruneDefaultSources(lib)

  const aFile = await put(
    source,
    'a.md',
    '---\ntitle: 前端笔记\ntags: [alpha, beta]\n---\n# 忽略我\n\n正文 [[关联条目]]\n',
  )
  const pyFile = await put(source, 'sub/tool-name.py', 'print("hi")\n')
  const txtFile = await put(source, 'raw.txt', '第一行\n第二行')
  const pngFile = await put(source, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await put(source, 'node_modules/ignored.md', '# 应跳过')
  await put(source, '.hidden.md', '# 默认跳过')
  await put(source, 'trace.log', 'log')
  await put(source, 'deep/x/y/z.md', '# 深度外')

  const added = await lib.addSource({ name: 'Scan Source', path: source, depth: 2 })
  assert.equal(added.id, 'scan-source')
  assert.equal(added.depth, 2)
  assert.equal(added.count, 0)

  const first = await scanOnce(lib, added.id)
  assert.equal(first.sourceId, 'scan-source')
  assert.equal(first.added, 4)
  assert.equal(first.updated, 0)
  assert.equal(first.removed, 0)
  assert.equal(first.unchanged, 0)
  assert.equal(first.skipped, 2)
  assert.deepEqual(first.errors, [])
  assert.equal(typeof first.durationMs, 'number')

  const listed = await lib.list({ source: added.id, limit: 50 })
  assert.equal(listed.total, 4)
  const titles = listed.items.map((item) => item.title).sort()
  assert.deepEqual(titles, ['image', 'raw', 'tool name', '前端笔记'].sort())

  const aEntry = await lib.get(listed.items.find((item) => item.title === '前端笔记').id)
  assert.equal(aEntry.sourceId, 'scan-source')
  assert.equal(aEntry.storage, 'linked')
  assert.equal(aEntry.kind, 'doc')
  assert.equal(aEntry.ext, 'md')
  assert.equal(aEntry.collection, 'inbox')
  assert.equal(aEntry.path, aFile)
  assert.deepEqual(aEntry.tags, ['alpha', 'beta'])
  assert.deepEqual(aEntry.links, ['关联条目'])
  assert.ok(aEntry.preview.includes('正文 [[关联条目]]'))
  assert.equal(aEntry.size, (await fs.stat(aFile)).size)
  assert.match(aEntry.sha256, /^[0-9a-f]{64}$/)

  const pyEntry = await lib.get(listed.items.find((item) => item.title === 'tool name').id)
  assert.equal(pyEntry.kind, 'script')
  assert.equal(pyEntry.collection, 'scripts')
  assert.equal(pyEntry.mime, 'text/x-python')
  assert.equal(pyEntry.path, pyFile)

  const pngEntry = await lib.get(listed.items.find((item) => item.title === 'image').id)
  assert.equal(pngEntry.kind, 'image')
  assert.equal(pngEntry.collection, 'images')
  const pngRead = await lib.readText(pngEntry.id)
  assert.equal(pngRead.text, '')
  assert.equal(pngRead.binary, true)
  assert.equal(pngRead.bytes, (await fs.stat(pngFile)).size)

  const txtEntry = await lib.get(listed.items.find((item) => item.title === 'raw').id)
  const txtRead = await lib.readText(txtEntry.id)
  assert.equal(txtRead.text, '第一行\n第二行')
  assert.equal(txtRead.totalLines, 2)
  assert.equal(txtRead.truncated, false)
  assert.equal(txtRead.binary, undefined)
  assert.equal(await fs.readFile(txtFile, 'utf8'), '第一行\n第二行')

  const second = await scanOnce(lib, added.id)
  assert.equal(second.added, 0)
  assert.equal(second.updated, 0)
  assert.equal(second.unchanged, 4)
  assert.equal(second.removed, 0)

  // 改内容 + mtime：同一 id，updated 1。
  await fs.writeFile(
    aFile,
    '---\ntitle: 前端笔记\ntags: [alpha]\n---\n\n新正文 [[新链接]]\n',
    'utf8',
  )
  await fs.utimes(aFile, new Date(), new Date(Date.now() + 2000))
  const third = await scanOnce(lib, added.id)
  assert.equal(third.updated, 1)
  assert.equal(third.added, 0)
  assert.equal(third.unchanged, 3)
  const aAfter = await lib.get(aEntry.id)
  assert.equal(aAfter.id, aEntry.id)
  assert.deepEqual(aAfter.tags, ['alpha'])
  assert.deepEqual(aAfter.links, ['新链接'])
  assert.ok(aAfter.preview.includes('新正文'))

  // 只 touch、不改内容：sha 未变，算 unchanged 而不是 updated。
  await fs.utimes(txtFile, new Date(), new Date(Date.now() + 4000))
  const fourth = await scanOnce(lib, added.id)
  assert.equal(fourth.added, 0)
  assert.equal(fourth.updated, 0)
  assert.equal(fourth.unchanged, 4)

  // 源内删除：removed 且不进回收站。
  await fs.rm(pyFile)
  const fifth = await scanOnce(lib, added.id)
  assert.equal(fifth.removed, 1)
  assert.equal(fifth.unchanged, 3)
  assert.equal(await lib.get(pyEntry.id), null)
  assert.equal((await lib.list({ source: added.id })).total, 3)

  const sources = await lib.sources()
  const scanSource = sources.find((item) => item.id === 'scan-source')
  assert.equal(scanSource.count, 3)
  assert.equal(scanSource.missing, false)
  assert.equal(typeof scanSource.lastScanAt, 'string')
})

test('scan：>8MB 只记元数据（preview 空、sha256 null）', async (t) => {
  const { lib, source } = await makeLibrary(t)
  await pruneDefaultSources(lib)
  const bigFile = path.join(source, 'huge.md')
  await fs.writeFile(bigFile, '')
  await fs.truncate(bigFile, 8 * 1024 * 1024 + 1)

  const added = await lib.addSource({ name: 'Big', path: source })
  const result = await scanOnce(lib, added.id)
  assert.equal(result.added, 1)
  assert.equal(result.errors.length, 0)

  const listed = await lib.list({ source: added.id })
  const entry = await lib.get(listed.items[0].id)
  assert.equal(entry.title, 'huge')
  assert.equal(entry.size, 8 * 1024 * 1024 + 1)
  assert.equal(entry.preview, '')
  assert.equal(entry.sha256, null)
  assert.equal(entry.lines, null)

  const again = await scanOnce(lib, added.id)
  assert.equal(again.unchanged, 1)
})

test('scan：include/exclude、hidden、跳过目录与扩展名白名单', async (t) => {
  const { lib, source, base } = await makeLibrary(t)
  await pruneDefaultSources(lib)
  await put(source, 'keep.md', '# keep')
  await put(source, 'secret.md', '# secret')
  await put(source, 'sub/note.md', '# note')
  await put(source, 'sub/secret.md', '# secret sub')
  await put(source, '.hidden.md', '# hidden')
  await put(source, 'skip.tmp', 'tmp')

  const filtered = await lib.addSource({
    name: 'Filter Source',
    path: source,
    include: ['*.md'],
    exclude: ['secret*'],
  })
  const result = await scanOnce(lib, filtered.id)
  assert.equal(result.added, 2)
  assert.equal(result.skipped, 4)
  const titles = (await lib.list({ source: filtered.id })).items.map((item) => item.title).sort()
  assert.deepEqual(titles, ['keep', 'note'])

  // addSource 按 path 去重，hidden 源必须换一个独立目录才能生效。
  const hiddenDir = path.join(base, 'hidden-source')
  await put(hiddenDir, 'keep.md', '# keep')
  await put(hiddenDir, 'secret.md', '# secret')
  await put(hiddenDir, 'sub/note.md', '# note')
  await put(hiddenDir, 'sub/secret.md', '# secret sub')
  await put(hiddenDir, '.hidden.md', '# dotfile')
  await put(hiddenDir, 'skip.tmp', 'tmp')

  const hiddenSource = await lib.addSource({ name: 'Hidden Source', path: hiddenDir, hidden: true })
  const hiddenResult = await scanOnce(lib, hiddenSource.id)
  assert.equal(hiddenResult.added, 5)
  const hiddenTitles = (await lib.list({ source: hiddenSource.id })).items.map((item) => item.title)
  assert.ok(hiddenTitles.includes('dotfile'))
  assert.equal((await lib.list({ source: hiddenSource.id })).total, 5)
})

test('scan：并发触发 library-busy，锁在结束后释放，陈旧锁可恢复', async (t) => {
  const { lib, root } = await makeLibrary(t)
  await pruneDefaultSources(lib)
  const source = path.join(root, '..', 'lock-source')
  await fs.mkdir(source, { recursive: true })
  for (let index = 0; index < 5; index += 1) {
    await put(source, `note-${index}.md`, `# note ${index}\n`)
  }
  const added = await lib.addSource({ name: 'Lock Source', path: source })
  const lockPath = path.join(lib.root, 'scan.lock')

  const firstScan = scanOnce(lib, added.id)
  await assert.rejects(scanOnce(lib, added.id), expectCode('library-busy'))
  const done = await firstScan
  assert.equal(done.added, 5)
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' })

  // 陈旧的锁（超过 10 分钟）应被自动清掉。
  await fs.writeFile(lockPath, JSON.stringify({ pid: 1, at: Date.now() }))
  const old = new Date(Date.now() - 11 * 60 * 1000)
  await fs.utimes(lockPath, old, old)
  const recovered = await scanOnce(lib, added.id)
  assert.equal(recovered.added, 0)
  assert.equal(recovered.unchanged, 5)
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' })

  // 新鲜的锁：抛 library-busy，且不删别人的锁。
  await fs.writeFile(lockPath, JSON.stringify({ pid: 2, at: Date.now() }))
  await assert.rejects(scanOnce(lib, added.id), expectCode('library-busy'))
  assert.ok((await fs.stat(lockPath)).isFile())
  await fs.rm(lockPath, { force: true })

  // 另一个 Library 实例共享同一根目录，也认这把锁。
  const other = await createLibrary(lib.root)
  await other.init()
  await fs.writeFile(lockPath, JSON.stringify({ pid: 3, at: Date.now() }))
  await assert.rejects(other.scan({ sourceId: added.id }), expectCode('library-busy'))
  await fs.rm(lockPath, { force: true })
})

test('sources：增删、slug 冲突、缺失标记、统计与级联删索引', async (t) => {
  const { lib, source, base } = await makeLibrary(t)
  await pruneDefaultSources(lib)
  assert.deepEqual(await lib.sources(), [])

  const first = await lib.addSource({ name: 'Docs One', path: source })
  assert.equal(first.id, 'docs-one')
  assert.equal(first.name, 'Docs One')
  assert.equal(first.depth, 6)
  assert.equal(first.count, 0)
  assert.equal(first.missing, false)
  assert.deepEqual(first.include, [])
  assert.deepEqual(first.exclude, [])

  const duplicatePath = await lib.addSource({ name: '另一个名字', path: source })
  assert.equal(duplicatePath.id, first.id)

  const secondDir = path.join(base, 'source-two')
  await fs.mkdir(secondDir, { recursive: true })
  const second = await lib.addSource({ name: 'Docs One', path: secondDir, depth: 2 })
  assert.equal(second.id, 'docs-one-2')
  assert.equal(second.depth, 2)

  await assert.rejects(
    lib.addSource({ name: 'Missing', path: path.join(base, 'does-not-exist') }),
    expectCode('invalid-source'),
  )
  await assert.rejects(
    lib.addSource({ name: 'Bad Include', path: source, include: '*.md' }),
    expectCode('invalid-argument'),
  )

  const listed = await lib.sources()
  assert.deepEqual(listed.map((item) => item.id), ['docs-one', 'docs-one-2'])
  assert.equal(listed[0].count, 0)
  assert.equal(listed[1].missing, false)

  await fs.rm(secondDir, { recursive: true, force: true })
  const missing = await lib.sources()
  assert.equal(missing.find((item) => item.id === 'docs-one-2').missing, true)

  await lib.removeSource('docs-one-2')
  assert.deepEqual((await lib.sources()).map((item) => item.id), ['docs-one'])
  await assert.rejects(lib.removeSource('docs-one-2'), expectCode('source-not-found'))

  const noteFile = await put(source, 'note.md', '# 源内笔记\n正文')
  await scanOnce(lib, 'docs-one')
  assert.equal((await lib.list()).total, 1)
  const entry = (await lib.list()).items[0]
  const counted = (await lib.sources()).find((item) => item.id === 'docs-one')
  assert.equal(counted.count, 1)

  await lib.removeSource('docs-one')
  assert.deepEqual(await lib.sources(), [])
  assert.equal(await lib.get(entry.id), null)
  assert.equal((await lib.list()).total, 0)
  assert.equal(await fs.readFile(noteFile, 'utf8'), '# 源内笔记\n正文')
})

test('pack：按集合拼接 preview，超 maxChars 截断并标注', async (t) => {
  const { lib } = await makeLibrary(t)
  await pruneDefaultSources(lib)

  const longBody = '内容'.repeat(100)
  await lib.create({ title: 'Pack A', content: longBody, collection: 'pack' })
  await lib.create({ title: 'Pack B', content: longBody, collection: 'packx' })
  await lib.create({ title: 'Pack C', content: longBody, collection: 'pack' })

  const full = await lib.pack('pack')
  assert.equal(full.collection, 'pack')
  assert.equal(full.total, 2)
  assert.equal(typeof full.text, 'string')
  assert.ok(full.text.includes('## Pack A'))
  assert.ok(full.text.includes('## Pack C'))
  assert.ok(!full.text.includes('Pack B'))
  assert.ok(full.text.length < 12000)

  const small = await lib.pack('pack', { maxChars: 120 })
  assert.equal(small.total, 2)
  assert.ok(small.text.length <= 120)
  assert.match(small.text, /截断/)

  const limited = await lib.pack('pack', { limit: 1 })
  assert.equal((limited.text.match(/^## /gm) || []).length, 1)

  const empty = await lib.pack('nothing')
  assert.deepEqual(empty, { collection: 'nothing', total: 0, text: '' })
})

test('错误码：item-not-found / invalid-argument / invalid-source / source-not-found', async (t) => {
  const { lib, source, base } = await makeLibrary(t)
  await pruneDefaultSources(lib)

  await assert.rejects(lib.create({}), expectCode('invalid-argument'))
  await assert.rejects(lib.create({ title: '   ' }), expectCode('invalid-argument'))
  await assert.rejects(lib.create({ title: 'x', kind: 'weird' }), expectCode('invalid-argument'))
  await assert.rejects(lib.create({ title: 'x', content: 42 }), expectCode('invalid-argument'))

  const note = await lib.create({ title: '正常笔记', content: '正文' })
  await assert.rejects(lib.update(note.id, { tags: 'tags' }), expectCode('invalid-argument'))
  await assert.rejects(lib.update(note.id, { title: '' }), expectCode('invalid-argument'))
  await assert.rejects(lib.update(note.id, { collection: 42 }), expectCode('invalid-argument'))
  await assert.rejects(lib.update(note.id, { notes: 42 }), expectCode('invalid-argument'))
  await assert.rejects(lib.update(note.id, { content: 42 }), expectCode('invalid-argument'))

  const missing = 'cl_ffffffffffff'
  await assert.rejects(lib.readText(missing), expectCode('item-not-found'))
  await assert.rejects(lib.update(missing, { title: 'x' }), expectCode('item-not-found'))
  await assert.rejects(lib.remove(missing), expectCode('item-not-found'))
  await assert.rejects(lib.restore(missing), expectCode('item-not-found'))
  await assert.rejects(lib.purge(missing), expectCode('item-not-found'))

  await assert.rejects(
    lib.addSource({ name: 'Missing', path: path.join(base, 'nope') }),
    expectCode('invalid-source'),
  )
  await assert.rejects(lib.removeSource('nope'), expectCode('source-not-found'))
  await assert.rejects(lib.scan({ sourceId: 'nope' }), expectCode('source-not-found'))

  const added = await lib.addSource({ name: 'Linked', path: source })
  await put(source, 'linked.md', '# linked\n')
  await scanOnce(lib, added.id)
  const linked = (await lib.list({ source: added.id })).items[0]
  await assert.rejects(lib.update(linked.id, { content: 'x' }), expectCode('invalid-argument'))

  const error = await lib.readText(missing).catch((err) => err)
  assert.equal(error.name, 'LibraryError')
  assert.equal(error.code, 'item-not-found')
  assert.ok(error.message.length > 0)
})

test('导出与工具函数：classifyKind / mimeFor / resolveRoot', async () => {
  for (const name of ['LibraryError', 'resolveRoot', 'classifyKind', 'mimeFor', 'createLibrary', 'Library']) {
    assert.equal(typeof store[name], 'function', `缺少导出 ${name}`)
  }
  assert.ok(store.SKIP_DIRS instanceof Set)

  assert.equal(classifyKind('/tmp/a.md'), 'doc')
  assert.equal(classifyKind('/tmp/a.txt'), 'doc')
  assert.equal(classifyKind('/tmp/a.py'), 'script')
  assert.equal(classifyKind('/tmp/a.png'), 'image')
  assert.equal(classifyKind('/tmp/a.jsonl'), 'data')
  assert.equal(classifyKind(path.join('/tmp', 'sessions', 'abc.jsonl')), 'session')
  assert.equal(classifyKind('/tmp/a.unknown'), 'other')

  assert.equal(mimeFor('md'), 'text/markdown')
  assert.equal(mimeFor('.PDF'), 'application/pdf')
  assert.equal(mimeFor('py'), 'text/x-python')
  assert.equal(mimeFor('nope'), 'application/octet-stream')

  const root = '/tmp/ctxlib-root-check'
  assert.equal(resolveRoot({ rootDir: root }), path.resolve(root))
  const homeRoot = resolveRoot({ rootDir: '~/ctxlib-home-check' })
  assert.equal(homeRoot, path.join(os.homedir(), 'ctxlib-home-check'))
  assert.equal(resolveRoot({}), path.join(os.homedir(), '.dsh', 'context-lib'))
})

test('磁盘被外部进程改写后，本实例在下次操作前自动重载', async (t) => {
  const { root, lib } = await makeLibrary(t)
  await pruneDefaultSources(lib)
  const first = await lib.create({ title: '本进程写的', content: '一句话' })

  // 第二个实例模拟“另一个进程”：直接改磁盘上的 index.json
  const other = await createLibrary(root)
  await other.init()
  const second = await other.create({ title: '外部进程写的', content: '外部内容' })

  const stats = await lib.stats()
  assert.equal(stats.counts.active, 2, '本实例应看到外部新增的条目')
  assert.ok(await lib.get(second.id), '外部条目应可读')
  assert.ok(await lib.get(first.id), '自己写过的条目仍在')
})
