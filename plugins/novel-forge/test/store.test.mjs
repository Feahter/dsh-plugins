import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeError, LIMITS, Store } from '../src/forge/index.js'

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'forge-store-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const store = new Store(root)
  return { root, store }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function projectOf(id, extra = {}) {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id,
    title: id,
    recipe: 'mock',
    recipeVersion: 1,
    createdAt: now,
    updatedAt: now,
    params: {},
    artifacts: {},
    stages: {},
    stats: { calls: 0, estTokensIn: 0, estTokensOut: 0 },
    activeRunId: null,
    pendingReview: null,
    lastError: null,
    ...extra,
  }
}

async function seed(t) {
  const { root, store } = await setup(t)
  const id = 'proj_one'
  await store.createProject(projectOf(id))
  return { root, store, id }
}

// ------------------------------------------------------------------ 原子写

test('atomicWrite 使用 tmp+rename，不留临时文件', async (t) => {
  const { root, store } = await setup(t)
  const file = join(root, 'nested', 'demo.txt')

  const bytes = await store.atomicWrite(file, 'hello 世界')
  assert.equal(bytes, Buffer.byteLength('hello 世界'))
  assert.equal(await readFile(file, 'utf8'), 'hello 世界')

  const names = await readdir(join(root, 'nested'))
  assert.deepEqual(names, ['demo.txt'])
  assert.equal(names.some((name) => name.includes('.tmp-')), false)
})

test('atomicWrite 超限抛 TOO_LARGE 且不落文件', async (t) => {
  const { root, store } = await setup(t)
  const file = join(root, 'big.bin')
  await assert.rejects(
    () => store.atomicWrite(file, Buffer.alloc(11), { limit: 10, label: 'big.bin' }),
    (err) => err.code === 'TOO_LARGE' && err.detail.limit === 10,
  )
  assert.equal(await exists(file), false)
})

// -------------------------------------------------------------------- 版本

test('产物版本保留最近 3 份，内容递增', async (t) => {
  const { root, store, id } = await seed(t)

  for (let i = 1; i <= 5; i += 1) {
    await store.writeArtifact(id, 'draft/ch01', { kind: 'md', content: `v${i}` })
  }

  const current = await store.readArtifact(id, 'draft/ch01')
  assert.equal(current.content, 'v5')
  assert.equal(current.meta.version, 5)

  const versions = await readdir(join(root, 'projects', id, 'artifacts', '.versions'))
  const mine = versions.filter((name) => name.startsWith('draft__ch01.')).sort()
  assert.deepEqual(mine, ['draft__ch01.2.md', 'draft__ch01.3.md', 'draft__ch01.4.md'])

  const v4 = await readFile(join(root, 'projects', id, 'artifacts', '.versions', 'draft__ch01.4.md'), 'utf8')
  assert.equal(v4, 'v4')
})

test('JSON 产物读写往返并记录元数据', async (t) => {
  const { store, id } = await seed(t)
  await store.writeArtifact(id, 'a', { kind: 'json', content: { items: [1, 2] } }, { stage: 'alpha' })

  const artifact = await store.readArtifact(id, 'a')
  assert.deepEqual(artifact.content, { items: [1, 2] })
  assert.equal(artifact.kind, 'json')
  assert.equal(artifact.meta.version, 1)
  assert.equal(artifact.meta.by.stage, 'alpha')
  assert.equal(await store.hasArtifact(id, 'a'), true)
  assert.equal(await store.readArtifact(id, 'missing'), null)
  assert.equal(await store.hasArtifact(id, 'missing'), false)
})

test('损坏的 project.json / JSON 产物报 ARTIFACT_CORRUPT', async (t) => {
  const { root, store, id } = await seed(t)
  await store.writeArtifact(id, 'a', { kind: 'json', content: { ok: true } })

  const artifactPath = store.artifactPath(id, 'a', 'json')
  await writeFile(artifactPath, '{not json', 'utf8')
  await assert.rejects(
    () => store.readArtifact(id, 'a'),
    (err) => err.code === 'ARTIFACT_CORRUPT' && err.detail.key === 'a',
  )

  const projectFile = join(root, 'projects', id, 'project.json')
  await writeFile(projectFile, '{"broken":', 'utf8')
  await assert.rejects(
    () => store.readProject(id),
    (err) => err.code === 'ARTIFACT_CORRUPT' && err.detail.projectId === id,
  )
})

// ---------------------------------------------------------------- 路径安全

test('safeKey 拒绝路径穿越、绝对路径与反斜杠', async (t) => {
  const { root, store, id } = await seed(t)
  const badKeys = ['../evil', 'a/../../evil', '/etc/passwd', 'a\\b', '', 'a//b', 'a/./b', '..']

  for (const key of badKeys) {
    await assert.rejects(
      () => store.writeArtifact(id, key, { kind: 'md', content: 'x' }),
      (err) => err instanceof ForgeError && err.code === 'BAD_PARAMS',
      `write ${JSON.stringify(key)}`,
    )
    await assert.rejects(
      () => store.readArtifact(id, key),
      (err) => err instanceof ForgeError && err.code === 'BAD_PARAMS',
      `read ${JSON.stringify(key)}`,
    )
  }

  assert.equal(await exists(join(root, 'evil.md')), false)
  assert.equal(await exists(join(root, 'projects', 'evil.md')), false)
  assert.equal(await exists(join(root, 'trash', 'evil.md')), false)
})

// ------------------------------------------------------------------ 大小上限

test('artifact / project / run 超限分别抛 TOO_LARGE', async (t) => {
  const { root, store, id } = await seed(t)

  await assert.rejects(
    () => store.writeArtifact(id, 'huge', { kind: 'md', content: 'x'.repeat(LIMITS.artifact + 1) }),
    (err) => err.code === 'TOO_LARGE' && err.detail.limit === LIMITS.artifact,
  )

  const project = await store.readProject(id)
  project.title = 'x'.repeat(LIMITS.project + 1)
  await assert.rejects(
    () => store.saveProject(project),
    (err) => err.code === 'TOO_LARGE' && err.detail.limit === LIMITS.project,
  )

  const run = {
    schemaVersion: 1,
    id: 'run_big',
    projectId: id,
    status: 'running',
    events: [{ seq: 1, type: 'log', data: { message: 'x'.repeat(LIMITS.run + 1) } }],
  }
  await assert.rejects(
    () => store.writeRun(id, run),
    (err) => err.code === 'TOO_LARGE' && err.detail.limit === LIMITS.run,
  )

  assert.equal(await exists(join(root, 'projects', id, 'runs', 'run_big.json')), false)
})

// --------------------------------------------------------------------- trash

test('trashProject 用 rename 移入 trash，原项目消失', async (t) => {
  const { root, store, id } = await seed(t)
  const projectDir = join(root, 'projects', id)
  assert.equal(await exists(projectDir), true)

  const moved = await store.trashProject(id)
  assert.equal(moved.from, projectDir)
  assert.equal(await exists(moved.from), false)
  assert.equal(await exists(moved.to), true)
  assert.ok(moved.to.startsWith(join(root, 'trash')))

  await assert.rejects(
    () => store.readProject(id),
    (err) => err.code === 'NOT_FOUND',
  )
  assert.deepEqual(await store.listProjectIds(), [])
  assert.deepEqual(await store.listProjects(), [])
})

test('trashProject 对不存在项目抛 NOT_FOUND', async (t) => {
  const { store } = await setup(t)
  await assert.rejects(
    () => store.trashProject('proj_missing'),
    (err) => err.code === 'NOT_FOUND',
  )
})

// -------------------------------------------------------------------- 串行

test('同一 key 的并发写被串行化，版本不丢', async (t) => {
  const { root, store, id } = await seed(t)

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.writeArtifact(id, 'race', { kind: 'md', content: `v${i}` }),
    ),
  )

  const project = await store.readProject(id)
  assert.equal(project.artifacts.race.version, 10)

  const versions = await readdir(join(root, 'projects', id, 'artifacts', '.versions'))
  assert.equal(versions.length, 3)

  const names = await readdir(join(root, 'projects', id, 'artifacts'))
  assert.equal(names.some((name) => name.includes('.tmp-')), false)
})

test('不同项目的并发写互不影响', async (t) => {
  const { store } = await setup(t)
  await store.createProject(projectOf('proj_a'))
  await store.createProject(projectOf('proj_b'))

  await Promise.all([
    store.writeArtifact('proj_a', 'same', { kind: 'md', content: 'A' }),
    store.writeArtifact('proj_b', 'same', { kind: 'md', content: 'B' }),
  ])

  assert.equal((await store.readArtifact('proj_a', 'same')).content, 'A')
  assert.equal((await store.readArtifact('proj_b', 'same')).content, 'B')
})
