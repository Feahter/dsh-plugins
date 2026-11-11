// REST 路由：纯函数 handle() + 适配 DSH webServer 的 makeHandler()。
// handle() 不碰 req/res，测试可以直接喂 {method,path,query,body}。

import { readBody, sendJson, statusForError, httpError } from './json.js'

export const ROUTE_PREFIX = '/novel-forge'

export function stripPrefix(pathname) {
  if (pathname === ROUTE_PREFIX) return '/'
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null
  return pathname.slice(ROUTE_PREFIX.length)
}

function recipeView(recipe) {
  return {
    id: recipe.id,
    version: recipe.version,
    title: recipe.title,
    paramsSchema: recipe.paramsSchema,
    paramsDefaults: recipe.paramsDefaults,
    artifacts: recipe.artifacts,
    stages: (recipe.stages ?? []).map(stage => ({
      id: stage.id,
      title: stage.title,
      each: typeof stage.each === 'string' ? stage.each : null,
      review: stage.review === true,
      produces: stage.produces ?? [],
    })),
  }
}

function runView(run, after = 0) {
  if (!run) return null
  const { events, ...rest } = run
  const filtered = (events ?? []).filter(event => (event.seq ?? 0) > after)
  return { ...rest, events: filtered, seq: run.seq ?? 0 }
}

function listRecipes(engine) {
  if (typeof engine.listRecipes === 'function') return engine.listRecipes()
  return engine.recipes ?? []
}

async function getRunForProject(engine, project, after) {
  const runId = project.activeRunId
  if (runId) {
    const run = await engine.getRun(runId)
    if (run) return runView(run, after)
  }
  const runs = await engine.listRuns(project.id)
  return runView(runs?.[0] ?? null, after)
}

export async function handle({ engine, modelInfo }, request) {
  const method = (request.method ?? 'GET').toUpperCase()
  const path = request.path ?? '/'
  const query = request.query ?? {}
  const body = request.body ?? null
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 1 && parts[0] === 'recipes' && method === 'GET') {
    return { status: 200, body: { recipes: listRecipes(engine).map(recipeView) } }
  }

  if (parts.length === 1 && parts[0] === 'model' && method === 'GET') {
    return { status: 200, body: { model: modelInfo() } }
  }

  if (parts[0] !== 'projects') {
    throw httpError(404, 'NOT_FOUND', '接口不存在')
  }

  if (parts.length === 1) {
    if (method === 'GET') {
      const projects = await engine.listProjects()
      return { status: 200, body: { projects } }
    }
    if (method === 'POST') {
      const params = body?.params ?? body ?? {}
      const project = await engine.createProject({
        recipeId: body?.recipeId ?? 'novel',
        title: body?.title ?? params.title,
        params,
      })
      return { status: 201, body: { project } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  const id = decodeURIComponent(parts[1])
  const rest = parts.slice(2)

  if (rest.length === 0) {
    if (method === 'GET') {
      const project = await engine.getProject(id)
      const run = await getRunForProject(engine, project, 0)
      const runs = await engine.listRuns(project.id)
      return { status: 200, body: { project, run, runs } }
    }
    if (method === 'PATCH') {
      const project = await engine.updateProject(id, {
        title: body?.title,
        params: body?.params,
      })
      return { status: 200, body: { project } }
    }
    if (method === 'DELETE') {
      await engine.deleteProject(id)
      return { status: 200, body: { ok: true } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  if (rest[0] === 'artifact') {
    if (method === 'GET') {
      const key = typeof query.key === 'string' ? query.key : ''
      if (!key) throw httpError(400, 'BAD_PARAMS', '缺少 key')
      const artifact = await engine.getArtifact(id, key)
      if (!artifact) throw httpError(404, 'ARTIFACT_MISSING', `没有这个产物：${key}`)
      return { status: 200, body: { artifact } }
    }
    if (method === 'PUT') {
      if (!body || typeof body.key !== 'string' || !body.key) {
        throw httpError(400, 'BAD_PARAMS', '缺少 key')
      }
      const artifact = await engine.writeArtifact(id, body.key, {
        kind: body.kind === 'json' ? 'json' : 'md',
        content: body.content,
      }, { stage: 'manual' })
      return { status: 200, body: { artifact } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  if (rest[0] === 'run') {
    if (method === 'GET') {
      const project = await engine.getProject(id)
      const after = Number(query.after ?? 0) || 0
      const run = await getRunForProject(engine, project, after)
      return { status: 200, body: { run } }
    }
    if (method === 'POST' && rest[1] === 'cancel') {
      const project = await engine.getProject(id)
      if (!project.activeRunId) throw httpError(409, 'CONFLICT', '没有正在运行的写作任务')
      const run = await engine.cancelRun(project.activeRunId)
      return { status: 200, body: { run } }
    }
    if (method === 'POST') {
      const project = await engine.getProject(id)
      const options = body?.options ?? body ?? {}
      const run = await engine.startRun(project.id, options)
      return { status: 202, body: { run } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  if (rest[0] === 'runs' && method === 'GET') {
    const project = await engine.getProject(id)
    return { status: 200, body: { runs: await engine.listRuns(project.id) } }
  }

  if (rest[0] === 'estimate' && method === 'GET') {
    const project = await engine.getProject(id)
    return { status: 200, body: { estimate: await engine.estimate(project.id) } }
  }

  if (rest[0] === 'export' && method === 'POST') {
    const project = await engine.getProject(id)
    const format = typeof body?.format === 'string' ? body.format : 'markdown'
    const result = await engine.exportProject(project.id, format)
    return { status: 200, body: { export: result } }
  }

  if (rest[0] === 'review' && rest[1] === 'continue' && method === 'POST') {
    const project = await engine.getProject(id)
    if (!project.pendingReview) throw httpError(409, 'CONFLICT', '没有等待确认的步骤')
    const stages = project.pendingReview.nextStages ?? []
    const run = await engine.startRun(project.id, {
      stages: stages.length ? stages : undefined,
      autoApprove: body?.autoApprove ?? true,
    })
    return { status: 202, body: { run } }
  }

  throw httpError(404, 'NOT_FOUND', '接口不存在')
}

/**
 * 适配 DSH webServer 的 handler。
 * guard(req) 返回 falsy 放行，返回数字用该状态码拒绝（默认 403）。
 */
export function makeHandler({ engine, modelInfo, guard }) {
  const info = modelInfo ?? (() => ({ available: false, message: '未对接模型服务' }))
  return async function novelForgeHandler(req, res) {
    try {
      if (guard) {
        const rejection = await guard(req)
        if (rejection) {
          const status = Number.isInteger(rejection) ? rejection : 403
          sendJson(res, status, { error: { code: 'FORBIDDEN', message: '未授权' } })
          return
        }
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = stripPrefix(url.pathname)
      if (path === null) {
        sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const method = (req.method ?? 'GET').toUpperCase()
      const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : null
      const result = await handle(
        { engine, modelInfo: info },
        { method, path, query: Object.fromEntries(url.searchParams), body },
      )
      sendJson(res, result.status, result.body)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(res, statusForError(error), {
        error: {
          code: error?.code ?? 'INTERNAL',
          message: error?.message ?? String(error),
          detail: error?.detail,
        },
      })
    }
  }
}
