// 第 1 路（A）宿主与 API 层检修的回归测试：入参校验与状态码语义。
// 每个用例都对应一处「修之前会错」的行为，红→绿可复现：
//   1. 路由把坏掉的百分号转义交给 decodeURIComponent，抛 URIError → 500 INTERNAL
//   2. PUT /artifact 缺 content 把产物写成字面量 "null"（覆盖原正文）
//   3. PUT /artifact 的 json 产物接受非法 JSON，落盘后永久 ARTIFACT_CORRUPT
//   4. POST /run 的 window 负数/零/字符串被静默吞掉（引擎归一成 null = 不限）
//   5. 未知 recipeId / 未知导出格式被当成 500（BAD_RECIPE / EXPORT_FAILED）
//   6. novel_read 缺产物抛无 code 的 Error；novel_write 缺 content 覆盖产物

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { handle } from '../src/host/routes.js'
import { statusForError } from '../src/host/json.js'
import { createTools } from '../src/host/tools.js'

const PREMISE = '殡仪馆夜班的新人发现，停尸柜里的亡者会在凌晨三点开口说话'

/** 真引擎 + 真配方（落临时目录）：路径安全、产物读写、导出格式都走真实实现。 */
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'novel-forge-audit-a-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const engine = new ForgeEngine({
    root,
    recipes: [createNovelRecipe()],
    llm: { async generate() { return { text: '正文。', chars: 3 } }, async info() { return { available: true } } },
  })
  const project = await engine.createProject({
    title: '长夜将明',
    params: { premise: PREMISE, chapters: 6, wordsPerChapter: 800 },
  })
  const tools = new Map(createTools(engine).map(tool => [tool.name, tool]))
  return { engine, project, tools, root }
}

/** 假引擎：只验证「校验发生在进引擎之前」时用，避免真跑流水线。 */
function makeCountingEngine() {
  const calls = { startRun: [], writeArtifact: [], createProject: [], exportProject: [], estimateFor: [] }
  const recipe = {
    id: 'novel',
    version: 1,
    title: '长篇小说',
    paramsSchema: { type: 'object' },
    paramsDefaults: {},
    artifacts: { bible: { kind: 'md' } },
    stages: [{ id: 'premise', title: '故事核心' }, { id: 'draft', title: '草稿' }],
    exports: { markdown: {}, epub: {}, 'outline-editor': {} },
  }
  const project = {
    id: 'p_20261116_a1',
    title: '长夜将明',
    recipe: 'novel',
    params: { premise: PREMISE },
    stats: {},
    stages: {},
    artifacts: { bible: { kind: 'md', version: 1 } },
    activeRunId: null,
    pendingReview: null,
  }
  return {
    calls,
    listRecipes: () => [recipe],
    listProjects: async () => [project],
    getProject: async () => project,
    resolveProject: async () => project,
    listRuns: async () => [],
    getRun: async () => null,
    startRun: async (id, options) => {
      calls.startRun.push({ id, options })
      return { id: 'run-1', status: 'running', options }
    },
    estimateFor: (recipeId, params) => {
      calls.estimateFor.push({ recipeId, params })
      return { calls: 10 }
    },
    createProject: async input => {
      calls.createProject.push(input)
      return { ...project, id: 'p_new' }
    },
    exportProject: async (id, format) => {
      calls.exportProject.push({ id, format })
      return { filename: 'book.md', path: '/tmp/book.md', mime: 'text/markdown', bytes: 1 }
    },
    writeArtifact: async (id, key, spec) => {
      calls.writeArtifact.push({ id, key, spec })
      return { key, kind: spec.kind, content: spec.content, meta: { version: 2, bytes: 1 } }
    },
    getArtifact: async () => null,
  }
}

/** 把 handle() 的 throw 折成 {status, code}：断言语义，不绑测试写法。 */
async function call(engine, method, path, { query, body } = {}) {
  try {
    const result = await handle({ engine, modelInfo: () => ({ available: true }) }, { method, path, query, body })
    return { status: result.status, body: result.body }
  } catch (error) {
    return { status: statusForError(error), code: error?.code ?? null, message: String(error?.message ?? error) }
  }
}

async function runTool(tools, name, args) {
  try {
    return { ok: true, value: await tools.get(name).execute(args) }
  } catch (error) {
    return { ok: false, status: statusForError(error), code: error?.code ?? null, message: String(error?.message ?? error) }
  }
}

// ------------------------------------------------ 1. 坏掉的百分号转义 → 400

test('路由：项目 id 的坏百分号转义返回 400 BAD_PARAMS，不是 500', async t => {
  const { engine } = await setup(t)
  const result = await call(engine, 'GET', '/projects/%zz')
  assert.equal(result.status, 400)
  assert.equal(result.code, 'BAD_PARAMS')
})

test('路由：章节 id 的坏百分号转义返回 400 BAD_PARAMS，不是 500', async t => {
  const { engine, project } = await setup(t)
  const result = await call(engine, 'POST', `/projects/${project.id}/chapters/%E4%ZZ/continue`)
  assert.equal(result.status, 400)
  assert.equal(result.code, 'BAD_PARAMS')
})

test('路由：合法的百分号转义照旧解码', async t => {
  const { engine, project } = await setup(t)
  const result = await call(engine, 'GET', `/projects/${encodeURIComponent(project.id)}`)
  assert.equal(result.status, 200)
  assert.equal(result.body.project.id, project.id)
})

// ------------------------------------------- 2. PUT /artifact 缺 content

test('PUT artifact：缺 content 返回 400，且不把产物写成 "null"', async t => {
  const { engine, project } = await setup(t)
  await engine.writeArtifact(project.id, 'bible', { kind: 'md', content: '原来的世界观' }, { stage: 'manual' })

  const written = await call(engine, 'PUT', `/projects/${project.id}/artifact`, { body: { key: 'bible' } })
  assert.equal(written.status, 400)
  assert.equal(written.code, 'BAD_PARAMS')

  const read = await call(engine, 'GET', `/projects/${project.id}/artifact`, { query: { key: 'bible' } })
  assert.equal(read.status, 200)
  assert.equal(read.body.artifact.content, '原来的世界观')
  assert.equal(read.body.artifact.meta.version, 1, '不许因为一次缺参写入就把版本顶上去')
})

test('PUT artifact：json 产物收到非法 JSON 返回 400，产物不会被写成坏文件', async t => {
  const { engine, project } = await setup(t)

  const written = await call(engine, 'PUT', `/projects/${project.id}/artifact`, {
    body: { key: 'outline', kind: 'json', content: 'oops' },
  })
  assert.equal(written.status, 400)
  assert.equal(written.code, 'BAD_PARAMS')

  const read = await call(engine, 'GET', `/projects/${project.id}/artifact`, { query: { key: 'outline' } })
  assert.equal(read.code, 'ARTIFACT_MISSING', '不合格的写入不该留下一个永久 ARTIFACT_CORRUPT 的产物')
})

test('PUT artifact：合法 md / json 内容照旧写得进去', async t => {
  const { engine, project } = await setup(t)
  const md = await call(engine, 'PUT', `/projects/${project.id}/artifact`, { body: { key: 'bible', content: '世界观' } })
  assert.equal(md.status, 200)
  const json = await call(engine, 'PUT', `/projects/${project.id}/artifact`, {
    body: { key: 'outline', kind: 'json', content: { chapters: [] } },
  })
  assert.equal(json.status, 200)
  const read = await call(engine, 'GET', `/projects/${project.id}/artifact`, { query: { key: 'outline' } })
  assert.deepEqual(read.body.artifact.content, { chapters: [] })
})

// ------------------------------------------------------- 3. POST /run window

test('POST /run：window 负数/零/非整数给 400，且不启动 run', async t => {
  const engine = makeCountingEngine()
  for (const window of [-3, 0, 2.5, '5']) {
    const result = await call(engine, 'POST', '/projects/p_20261116_a1/run', { body: { window } })
    assert.equal(result.status, 400, `window=${JSON.stringify(window)} 应该 400，实际 ${result.status}`)
    assert.equal(result.code, 'BAD_PARAMS')
  }
  assert.deepEqual(engine.calls.startRun, [], '校验没过就不该进引擎')
})

test('POST /run：window 合法时照旧透传', async t => {
  const engine = makeCountingEngine()
  const result = await call(engine, 'POST', '/projects/p_20261116_a1/run', { body: { window: 5 } })
  assert.equal(result.status, 202)
  assert.equal(engine.calls.startRun.length, 1)
  assert.equal(engine.calls.startRun[0].options.window, 5)
})

// ---------------------------------------- 4. 未知 recipeId / 未知导出格式

test('POST /estimate：未知 recipeId 给 400 BAD_PARAMS，不是 500 BAD_RECIPE', async t => {
  const engine = makeCountingEngine()
  const result = await call(engine, 'POST', '/estimate', { body: { recipeId: 'nope' } })
  assert.equal(result.status, 400)
  assert.equal(result.code, 'BAD_PARAMS')
  assert.deepEqual(engine.calls.estimateFor, [])
})

test('POST /projects：未知 recipeId 给 400 BAD_PARAMS', async t => {
  const engine = makeCountingEngine()
  const result = await call(engine, 'POST', '/projects', {
    body: { recipeId: 'nope', params: { premise: PREMISE } },
  })
  assert.equal(result.status, 400)
  assert.equal(result.code, 'BAD_PARAMS')
  assert.deepEqual(engine.calls.createProject, [])
})

test('POST export：未知格式给 400 BAD_PARAMS，不是 500 EXPORT_FAILED', async t => {
  const { engine, project } = await setup(t)
  const result = await call(engine, 'POST', `/projects/${project.id}/export`, { body: { format: 'garbage' } })
  assert.equal(result.status, 400)
  assert.equal(result.code, 'BAD_PARAMS')
})

test('POST export：真 recipes 注册的三种格式照旧可导出', async t => {
  const { engine, project } = await setup(t)
  for (const format of ['markdown', 'epub', 'outline-editor']) {
    const result = await call(engine, 'POST', `/projects/${project.id}/export`, { body: { format } })
    assert.equal(result.status, 200, `${format} 应该能导出，实际 ${result.status} ${result.code ?? ''}`)
  }
})

// --------------------------------------------------------------- 5. 工具层

test('novel_read：缺产物给 404 ARTIFACT_MISSING，不是无 code 的 Error', async t => {
  const { tools, project } = await setup(t)
  const result = await runTool(tools, 'novel_read', { project: project.id, key: 'nope' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ARTIFACT_MISSING')
  assert.equal(result.status, 404)
})

test('novel_write：缺 content 返回 400，且不覆盖既有产物', async t => {
  const { tools, engine, project } = await setup(t)
  await engine.writeArtifact(project.id, 'bible', { kind: 'md', content: '原来的世界观' }, { stage: 'manual' })

  const result = await runTool(tools, 'novel_write', { project: project.id, key: 'bible' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_PARAMS')

  const read = await engine.getArtifact(project.id, 'bible')
  assert.equal(read.content, '原来的世界观')
})

test('novel_run：window 负数给 400，且不启动 run', async t => {
  const engine = makeCountingEngine()
  const tools = new Map(createTools(engine).map(tool => [tool.name, tool]))
  const result = await runTool(tools, 'novel_run', { project: 'p_20261116_a1', window: -5 })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_PARAMS')
  assert.deepEqual(engine.calls.startRun, [])
})

test('novel_export：未知格式给 400，且不落盘', async t => {
  const engine = makeCountingEngine()
  const tools = new Map(createTools(engine).map(tool => [tool.name, tool]))
  const result = await runTool(tools, 'novel_export', { project: 'p_20261116_a1', format: 'garbage' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_PARAMS')
  assert.deepEqual(engine.calls.exportProject, [])
})
