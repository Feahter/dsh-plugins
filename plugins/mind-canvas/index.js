/**
 * 脑图创意画布的宿主半片。
 *
 * 两件事：
 * 1. 同源 JSON 路由 `/mind-canvas/*`：整份读写脑图、从自媒体工作台导入灵感、让模型发散子想法。
 * 2. `mind_canvas_*` 工具：让助手直接读这张脑图、往里面加节点。
 *
 * 没有运行时依赖（只用 Node 内置模块），装到任何 DSH 上都不会因为少包而启动失败。
 */
import { Store, validateState, dshHome } from './src/store.js'
import { readInspirations } from './src/inspirations.js'
import { buildPrompt, callModel, modelInfo, normalizeIdeas } from './src/llm.js'
import { outline, addChildren, findNode, summarize } from './src/outline.js'

export const ROUTE_PREFIX = '/mind-canvas'
const MAX_BODY_BYTES = 9 * 1024 * 1024
const MAX_EXPAND_COUNT = 8

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** 读请求体，超过上限直接断开，避免被一个坏请求拖住。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        const error = new Error('请求体太大')
        error.status = 413
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve(null)
      try {
        resolve(JSON.parse(text))
      } catch {
        const error = new Error('请求体不是合法 JSON')
        error.status = 400
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Web 服务不会替插件路由鉴权，每个请求都自己检查 Host/Origin 和登录凭证。
 * 拿不到鉴权服务时一律拒绝（和 media-desk 同一套规矩）。
 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export async function route(ctx, store, req, res, url) {
  const method = (req.method ?? 'GET').toUpperCase()
  const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'

  if (path === '/state' && method === 'GET') {
    const state = await store.read()
    const info = await store.info()
    json(res, 200, { state, savedAt: info.mtimeMs ? new Date(info.mtimeMs).toISOString() : null, bytes: info.bytes })
    return
  }

  if (path === '/state' && (method === 'PUT' || method === 'POST')) {
    const body = await readBody(req)
    const state = body?.state ?? body
    const problem = validateState(state)
    if (problem) {
      json(res, 400, { error: { message: problem, code: 'invalid-state' } })
      return
    }
    const result = await store.write(state)
    json(res, 200, { ok: true, ...result })
    return
  }

  if (path === '/inspirations' && method === 'GET') {
    json(res, 200, { items: await readInspirations() })
    return
  }

  if (path === '/expand' && method === 'POST') {
    const body = (await readBody(req)) ?? {}
    const info = modelInfo(ctx)
    if (!info) {
      json(res, 503, { error: { message: '没有可用模型：先在设置里选一个助手模型', code: 'no-model' } })
      return
    }
    const prompt = buildPrompt({
      text: typeof body.text === 'string' ? body.text : '',
      count: Math.min(MAX_EXPAND_COUNT, Number(body.count) || 4),
      angle: typeof body.angle === 'string' ? body.angle : '',
      siblings: Array.isArray(body.siblings) ? body.siblings : [],
      lang: body.lang === 'en' ? 'en' : 'zh',
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45_000)
    try {
      const text = await callModel(ctx, { ...prompt, signal: controller.signal })
      const ideas = normalizeIdeas(text, prompt.count)
      if (ideas.length === 0) {
        json(res, 502, { error: { message: '模型没有给出可用的子想法，再试一次', code: 'empty-ideas' } })
        return
      }
      json(res, 200, { ideas, model: info.model })
    } finally {
      clearTimeout(timer)
    }
    return
  }

  json(res, 404, { error: { message: '接口不存在', code: 'not-found' } })
}

// ---------------------------------------------------------------------- tools

function textOutput(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function defineTool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: { schema: { type: 'object' }, render: (_args, value) => textOutput(value) },
    execute,
    timeoutMs: 30_000,
  }
}

const docParam = {
  type: 'string',
  description: '脑图标题（可以是标题的一部分，不区分大小写）。省略时用当前正在看的那张。',
}

async function resolveDoc(store, hint) {
  const state = await store.read()
  if (!state || !Array.isArray(state.docs) || state.docs.length === 0) {
    throw new Error('还没有任何脑图。先在侧栏的脑图创意画布上建一张。')
  }
  if (!hint) {
    return state.docs.find(doc => doc.id === state.activeId) ?? state.docs[0]
  }
  const needle = String(hint).trim().toLowerCase()
  return state.docs.find(doc => doc.title.toLowerCase().includes(needle))
    ?? state.docs.find(doc => doc.id === hint)
    ?? null
}

export function createTools(store) {
  return [
    defineTool(
      'mind_canvas_read',
      'Read a mind map as a Markdown outline (title, stats, and the parent → child tree). Use it before adding nodes so you branch the right place.',
      { type: 'object', properties: { doc: docParam }, additionalProperties: false },
      async args => {
        const doc = await resolveDoc(store, args?.doc)
        if (!doc) throw new Error(`没找到脑图：${args?.doc ?? ''}`)
        return { id: doc.id, title: doc.title, ...summarize(doc), outline: outline(doc) }
      },
    ),
    defineTool(
      'mind_canvas_add',
      'Add child nodes to an existing node of a mind map (or new roots when no parent is matched). Returns the created node texts. Prefer 3-6 short, concrete child ideas.',
      {
        type: 'object',
        properties: {
          doc: docParam,
          parent: { type: 'string', description: '父节点的文字（部分匹配即可）。省略或匹配不到时，作为新的根节点加进去。' },
          ideas: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 12,
            description: '要加的节点文字，每条一句，尽量短。',
          },
        },
        required: ['ideas'],
        additionalProperties: false,
      },
      async args => {
        const state = await store.read()
        const doc = await resolveDoc(store, args?.doc)
        if (!doc) throw new Error(`没找到脑图：${args?.doc ?? ''}`)
        const parent = findNode(doc, args?.parent)
        const { doc: next, added } = addChildren(doc, {
          parentId: parent?.id ?? null,
          texts: Array.isArray(args?.ideas) ? args.ideas : [],
        })
        const docs = state.docs.map(item => (item.id === next.id ? next : item))
        await store.write({ ...state, docs, activeId: next.id, revision: (state.revision ?? 0) + 1 })
        return {
          doc: next.title,
          parent: parent?.text ?? null,
          added,
          hint: added.length > 1 ? '画布上点「整理成树」会把新节点排整齐。' : undefined,
        }
      },
    ),
  ]
}

// --------------------------------------------------------------------- plugin

export const name = 'dsh-mind-canvas'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    const store = new Store()

    for (const definition of createTools(store)) {
      ctx.effect(() => ctx.get('tools')?.register?.(definition))
    }

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          const rejection = requestRejection(ctx, req)
          if (rejection) {
            json(res, rejection, { error: { message: '未授权', code: 'unauthorized' } })
            return
          }
          const url = new URL(req.url ?? '/', 'http://localhost')
          await route(ctx, store, req, res, url)
        } catch (error) {
          if (res.headersSent) {
            res.end()
            return
          }
          json(res, Number.isInteger(error?.status) ? error.status : 500, {
            error: { message: error?.message ?? String(error), code: error?.code ?? 'internal' },
          })
        }
      },
    }), 'dsh-mind-canvas: /mind-canvas routes')
  },
}

export { dshHome }
