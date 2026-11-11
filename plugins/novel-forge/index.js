/**
 * 墨炉 · Novel Forge 的宿主半片。
 *
 * 两件事：
 * 1. 同源 JSON 路由 `/novel-forge/*`：项目、产物、运行、导出，给侧栏面板用。
 * 2. `novel_*` 工具：让助手在对话里直接开书、查进度、跑流水线。
 *
 * 底层是通用创作引擎（src/forge），小说只是 recipes/novel 这一份配方。
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { ForgeEngine } from './src/forge/engine.js'
import { createLlmGateway } from './src/forge/llm.js'
import { ForgeError } from './src/forge/errors.js'
import { novelRecipe } from './src/recipes/novel/index.js'
import { makeHandler, ROUTE_PREFIX } from './src/host/routes.js'
import { registerNovelTools } from './src/host/tools.js'

export const name = 'dsh-novel-forge'

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh')
}

/** 读宿主当前选中的助手模型；没选就明确告诉用户去设置里选。 */
export function modelInfo(ctx) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (!selection?.provider || !selection?.model) {
    return {
      available: false,
      provider: null,
      model: null,
      message: '未选择助手模型：先在设置里选一个模型，墨炉才能开炉。',
    }
  }
  return { available: true, provider: selection.provider, model: selection.model, message: '' }
}

export default {
  inject: ['webServer', 'connection', 'tools'],

  apply(ctx) {
    const root = join(dshHome(), 'novel-forge')

    const gateway = createLlmGateway({
      service: () => ctx.get('llm'),
      resolveModel: () => {
        const info = modelInfo(ctx)
        if (!info.available) throw new ForgeError('LLM_UNAVAILABLE', info.message)
        return { provider: info.provider, model: info.model }
      },
    })

    const engine = new ForgeEngine({ root, recipes: [novelRecipe], llm: gateway })

    // 上次进程被杀时残留的 running 记录，启动时收尾，避免项目永远显示"运行中"。
    Promise.resolve()
      .then(() => engine.recover?.())
      .catch(error => console.warn('[novel-forge] 恢复中断的运行失败：', error?.message ?? error))

    ctx.effect(() => {
      const offs = registerNovelTools(ctx.get('tools'), engine)
      return () => offs.forEach(off => off?.())
    }, 'dsh-novel-forge: novel_* tools')

    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: makeHandler({
        engine,
        modelInfo: () => modelInfo(ctx),
        guard: req => {
          const connection = ctx.get('connection')
          if (typeof connection?.requestRejection !== 'function') return 403
          return connection.requestRejection({ headers: req.headers })
        },
      }),
    }), 'dsh-novel-forge: /novel-forge routes')
  },
}
