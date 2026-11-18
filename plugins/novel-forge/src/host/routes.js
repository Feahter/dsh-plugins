// REST 路由：纯函数 handle() + 适配 DSH webServer 的 makeHandler()。
// handle() 不碰 req/res，测试可以直接喂 {method,path,query,body}。

import { readBody, sendJson, statusForError, httpError } from './json.js'
import { runAssist, validateAssistInput } from './assist.js'

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
  // engine.recipes 是 Map<id, recipe>，直接 .map 会炸；兼容数组与 Map 两种形状。
  const recipes = engine.recipes
  if (recipes instanceof Map) return [...recipes.values()]
  return Array.isArray(recipes) ? recipes : []
}

async function getRunForProject(engine, project, after) {
  const runId = project.activeRunId
  if (runId) {
    const run = await engine.getRun(runId)
    if (run) return runView(run, after)
  }
  // 没有 activeRunId 时回退到最近一次 run；必须取完整 run（带 events），
  // listRuns 是摘要投影，客户端拿它渲染事件流会是空的。
  const runs = await engine.listRuns(project.id)
  const latest = runs?.[0]
  return runView(latest ? await engine.getRun(latest.id) : null, after)
}

/** 引擎注册的 recipe id 集合；取不到时是空集合（调用方据此跳过校验）。 */
function knownRecipeIds(engine) {
  return new Set(listRecipes(engine).map(recipe => recipe?.id).filter(Boolean))
}

/** 客户端给的 recipeId 不存在是参数错误：别让它穿到引擎变成 BAD_RECIPE(500)。 */
function assertKnownRecipe(engine, recipeId) {
  if (recipeId === undefined || recipeId === null) return
  const ids = knownRecipeIds(engine)
  if (ids.size === 0) return
  if (typeof recipeId !== 'string' || !ids.has(recipeId)) {
    throw httpError(400, 'BAD_PARAMS', `没有这个 recipe：${String(recipeId)}；可用：${[...ids].join(' / ')}`)
  }
}

/** 引擎注册的导出格式集合；取不到时是空集合。 */
function exportFormats(engine) {
  const formats = new Set()
  for (const recipe of listRecipes(engine)) {
    for (const key of Object.keys(recipe?.exports ?? {})) formats.add(key)
  }
  return formats
}

/** 未知导出格式是参数错误：引擎那边会当成 EXPORT_FAILED(500) 抛出来。 */
function assertExportFormat(engine, format) {
  const formats = exportFormats(engine)
  if (formats.size === 0) return
  const key = format === 'md' ? 'markdown' : format
  if (!formats.has(key)) {
    throw httpError(400, 'BAD_PARAMS', `不支持的导出格式：${String(format)}；可用：${[...formats].join(' / ')}`)
  }
}

/** 路径段解码：百分号转义坏掉时 decodeURIComponent 会抛 URIError（→ 500 INTERNAL），折成 400。 */
function decodePart(raw, label) {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw httpError(400, 'BAD_PARAMS', `${label} 不是合法的 URL 编码：${String(raw)}`)
  }
}

export async function handle({ engine, modelInfo, activation, versionChecker }, request) {
  const method = (request.method ?? 'GET').toUpperCase()
  const path = request.path ?? '/'
  const query = request.query ?? {}
  const body = request.body ?? null
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 1 && parts[0] === 'version' && method === 'GET') {
    if (!versionChecker) {
      return { status: 503, body: { ok: false, error: { code: 'UNAVAILABLE', message: '版本自查未接入' } } }
    }
    const data = await versionChecker.check({ refresh: query.refresh === '1' })
    return { status: 200, body: { ok: true, data } }
  }

  if (parts.length === 1 && parts[0] === 'recipes' && method === 'GET') {
    return { status: 200, body: { recipes: listRecipes(engine).map(recipeView) } }
  }

  if (parts.length === 1 && parts[0] === 'model' && method === 'GET') {
    return { status: 200, body: { model: modelInfo() } }
  }

  if (parts.length === 1 && parts[0] === 'estimate' && method === 'POST') {
    assertKnownRecipe(engine, body?.recipeId)
    const estimate = engine.estimateFor(body?.recipeId, body?.params ?? {})
    return { status: 200, body: { estimate } }
  }

  // 面板开关：novel_* 工具默认闲置，只有这里点开才进模型提示。
  if (parts.length === 1 && parts[0] === 'tools' && activation) {
    if (method === 'GET') {
      return { status: 200, body: { tools: activation.state() } }
    }
    if (method === 'POST') {
      const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : ''
      if (body?.enabled === true) {
        if (conversationId) {
          activation.enable(conversationId)
        } else {
          const result = activation.enableLatest()
          if (result?.code === 'NO_SESSION') {
            throw httpError(409, 'NO_SESSION', '还没有可接手的对话')
          }
        }
      } else {
        // 不给 id 就是「全部关掉」。
        activation.disable(conversationId)
      }
      return { status: 200, body: { tools: activation.state() } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  // 写作助手：纯文本改写，不落项目、不写产物。
  if (parts.length === 1 && parts[0] === 'assist') {
    if (method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
    const task = body?.task
    const text = body?.text
    const problem = validateAssistInput({ task, text })
    if (problem) throw httpError(400, 'invalid_params', problem)
    const output = await runAssist({
      engine,
      task,
      text,
      genre: body?.genre,
      tone: body?.tone,
      intent: body?.intent,
      targetChars: body?.targetChars,
    })
    return { status: 200, body: { text: output } }
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
      assertKnownRecipe(engine, body?.recipeId)
      const project = await engine.createProject({
        recipeId: body?.recipeId ?? 'novel',
        title: body?.title ?? params.title,
        params,
      })
      return { status: 201, body: { project } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  const id = decodePart(parts[1], '项目 id')
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
      const kind = body.kind === 'json' ? 'json' : 'md'
      // content 缺省时存储层会把它写成字面量 "null"，等于用一次缺参写入覆盖掉整篇产物。
      if (body.content === undefined || body.content === null) {
        throw httpError(400, 'BAD_PARAMS', '缺少 content')
      }
      // json 产物写进非法 JSON 就是永久 ARTIFACT_CORRUPT（版本还归档不掉），必须挡在落盘前。
      if (kind === 'json' && typeof body.content === 'string') {
        try {
          JSON.parse(body.content)
        } catch {
          throw httpError(400, 'BAD_PARAMS', `${body.key} 是 json 产物，content 必须是合法 JSON`)
        }
      }
      const artifact = await engine.writeArtifact(id, body.key, {
        kind,
        content: body.content,
      }, { stage: 'manual' })
      return { status: 200, body: { artifact } }
    }
    throw httpError(405, 'METHOD_NOT_ALLOWED', '方法不支持')
  }

  if (rest[0] === 'chapters' && rest[1] && rest[2] === 'continue' && method === 'POST') {
    const project = await engine.getProject(id)
    const chapterId = decodePart(rest[1], '章节 id')
    const result = await engine.continueChapter(project.id, chapterId)
    return { status: 200, body: { continue: result } }
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
      // window 的口径是「本轮最多推进多少章」；引擎会把非正整数静默归一成 null（= 不限章数），
      // 所以这里必须挡住，否则「最多 10 章」会被悄悄变成「跑完为止」。
      if (options?.window !== undefined && options?.window !== null) {
        const window = options.window
        if (!Number.isInteger(window) || window < 1) {
          throw httpError(400, 'BAD_PARAMS', 'window 必须是 ≥ 1 的整数')
        }
      }
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
    assertExportFormat(engine, format)
    const result = await engine.exportProject(project.id, format)
    return { status: 200, body: { export: result } }
  }

  if (rest[0] === 'review' && rest[1] === 'continue' && method === 'POST') {
    const project = await engine.getProject(id)
    if (!project.pendingReview) throw httpError(409, 'CONFLICT', '没有等待确认的步骤')
    const stages = project.pendingReview.nextStages ?? []
    const run = await engine.startRun(project.id, {
      stages: stages.length ? stages : undefined,
      // 只有调用方明确要求「后面别再问我了」才自动放行；默认继续按审稿门逐个确认，
      // 否则点一次「确认并继续」会把后面所有 gate 静默跳过。
      autoApprove: body?.autoApprove === true,
    })
    return { status: 202, body: { run } }
  }

  throw httpError(404, 'NOT_FOUND', '接口不存在')
}

/**
 * 适配 DSH webServer 的 handler。
 * guard(req) 返回 falsy 放行，返回数字用该状态码拒绝（默认 403）。
 */
export function makeHandler({ engine, modelInfo, guard, activation, versionChecker }) {
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
        { engine, modelInfo: info, activation, versionChecker },
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
