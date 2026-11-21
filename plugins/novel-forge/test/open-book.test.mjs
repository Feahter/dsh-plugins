// 打开书稿目录：宿主只按项目推导路径，客户端不能传路径；目录没生成时不调起系统命令。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDirectory } from '../src/host/open.js'
import { bookDirectory } from '../src/forge/bookrepo.js'
import { handle } from '../src/host/routes.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'novel-open-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const engine = {
    store: { projectDir: (id) => join(root, id) },
    activeRunId: undefined,
    listRuns: async () => [],
    getProject: async (id) => ({ id, recipe: 'novel', title: '长夜' }),
    listProjects: async () => [],
  }
  const open = async (directory) => {
    calls.push(directory)
    return { command: 'open', directory }
  }
  const ctx = { engine, openDirectory: open }
  return { root, calls, ctx, engine }
}

test('openDirectory：macOS 用 open，把目录作为唯一参数', async () => {
  const calls = []
  const run = async (command, args) => { calls.push([command, ...args]) }
  const result = await openDirectory('/tmp/book', { platform: 'darwin', run })
  assert.deepEqual(calls, [['open', '/tmp/book']])
  assert.equal(result.directory, '/tmp/book')
})

test('openDirectory：不支持的平台与缺失命令都给可读错误码', async () => {
  await assert.rejects(openDirectory('/tmp/book', { platform: 'freebsd', run: async () => {} }), { code: 'UNSUPPORTED_PLATFORM' })
  const missing = Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })
  await assert.rejects(openDirectory('/tmp/book', { platform: 'linux', run: async () => { throw missing } }), { code: 'OPEN_UNAVAILABLE' })
})

test('openDirectory：Windows 里 explorer 返回非 0 不算失败', async () => {
  const run = async () => { throw Object.assign(new Error('exit 1'), { code: 1 }) }
  const result = await openDirectory('C:\\book', { platform: 'win32', run })
  assert.equal(result.directory, 'C:\\book')
})

test('GET 详情：书稿目录未生成时 bookReady=false，路径照给', async (t) => {
  const { ctx, engine, root } = await fixture(t)
  const response = await handle(ctx, { method: 'GET', path: '/projects/p1' })
  assert.equal(response.status, 200)
  assert.equal(response.body.bookPath, bookDirectory(engine.store, 'p1'))
  assert.equal(response.body.bookReady, false)
  assert.equal(response.body.bookPath.startsWith(root), true)
})

test('POST open：目录没生成 → 404 BOOK_MISSING，且不调起系统命令', async (t) => {
  const { ctx, calls } = await fixture(t)
  await assert.rejects(
    () => handle(ctx, { method: 'POST', path: '/projects/p1/open' }),
    error => error.status === 404 && error.code === 'BOOK_MISSING',
  )
  assert.deepEqual(calls, [])
})

test('POST open：目录就绪 → 调起打开并回传路径；GET 同步变 bookReady=true', async (t) => {
  const { ctx, calls, engine } = await fixture(t)
  const directory = bookDirectory(engine.store, 'p1')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'README.md'), '# 长夜\n')

  const opened = await handle(ctx, { method: 'POST', path: '/projects/p1/open' })
  assert.equal(opened.status, 200)
  assert.equal(opened.body.opened, true)
  assert.equal(opened.body.path, directory)
  assert.deepEqual(calls, [directory])

  const detail = await handle(ctx, { method: 'GET', path: '/projects/p1' })
  assert.equal(detail.body.bookReady, true)
})

test('POST open：非小说配方 → 400 BAD_PARAMS，不碰文件系统', async (t) => {
  const { ctx, engine, calls } = await fixture(t)
  engine.getProject = async (id) => ({ id, recipe: 'other' })
  await assert.rejects(
    () => handle(ctx, { method: 'POST', path: '/projects/p1/open' }),
    error => error.status === 400 && error.code === 'BAD_PARAMS',
  )
  assert.deepEqual(calls, [])
})

test('POST open：GET 方法不被接受', async (t) => {
  const { ctx } = await fixture(t)
  await assert.rejects(
    () => handle(ctx, { method: 'GET', path: '/projects/p1/open' }),
    error => error.status === 404,
  )
})
