/**
 * 测试用 recipe：三个 stage，覆盖静态 / each / review。
 * 不含任何宿主业务知识。
 */

import { setTimeout as sleep } from 'node:timers/promises'

const BASE_ITEMS = [
  { id: 'x1', name: '一' },
  { id: 'x2', name: '二' },
]

/**
 * @param {{
 *   failIds?: string[],
 *   onItemError?: 'continue'|'stop',
 *   betaDelayMs?: number,
 *   alphaDelayMs?: number,
 *   failStage?: string,
 *   review?: boolean,
 *   skip?: boolean,
 *   skipReason?: string,
 * }} [options]
 */
export function makeMockRecipe(options = {}) {
  const failIds = new Set(options.failIds || [])
  const review = options.review !== false

  const recipe = {
    id: 'mock',
    version: 1,
    title: 'Mock',
    paramsSchema: {
      type: 'object',
      properties: { tone: { type: 'string' } },
      additionalProperties: true,
    },
    paramsDefaults: { tone: 'plain' },
    artifacts: {
      a: { kind: 'json' },
      'b/*': { kind: 'md' },
      c: { kind: 'md' },
    },
    stages: [
      {
        id: 'alpha',
        title: 'Alpha',
        produces: ['a'],
        async run(ctx) {
          if (options.alphaDelayMs) await sleep(options.alphaDelayMs, undefined, { signal: ctx.signal })
          if (options.failStage === 'alpha') throw new Error('alpha exploded')
          return {
            artifacts: {
              a: { kind: 'json', content: { items: BASE_ITEMS, said: 'ok' } },
            },
            note: 'alpha done',
          }
        },
      },
      {
        id: 'beta',
        title: 'Beta',
        each: 'a.items',
        produces: ['b/*'],
        onItemError: options.onItemError || 'continue',
        async run(ctx) {
          if (options.betaDelayMs) await sleep(options.betaDelayMs, undefined, { signal: ctx.signal })
          if (failIds.has(ctx.item.id)) throw new Error(`boom ${ctx.item.id}`)
          const generated = await ctx.llm.generate({
            system: 'system prompt',
            user: `写 ${ctx.item.id}`,
            phase: 'beta',
            label: ctx.item.id,
            maxTokens: 128,
          })
          return {
            artifacts: {
              [`b/${ctx.item.id}`]: { kind: 'md', content: `# ${ctx.item.id}\n${generated.text}` },
            },
            note: `beta ${ctx.item.id}`,
          }
        },
      },
      {
        id: 'gamma',
        title: 'Gamma',
        review,
        produces: ['c'],
        async run() {
          if (options.failStage === 'gamma') throw new Error('gamma exploded')
          return { artifacts: { c: { kind: 'md', content: 'final text' } } }
        },
      },
    ],
  }

  if (options.skip) {
    recipe.stages[1].skip = () => options.skipReason || '条件满足，跳过'
  }
  return recipe
}

/**
 * 脚本化假模型。responses 以 phase 或 label 为键，值可为字符串或函数。
 * @param {{
 *   responses?: Record<string, string|((opts:any)=>any)>,
 *   calls?: any[],
 *   delayMs?: number,
 * }} [options]
 */
export function createFakeLlm(options = {}) {
  const responses = options.responses || {}
  const calls = options.calls || []
  return {
    calls,
    async generate(opts = {}) {
      calls.push(opts)
      if (options.delayMs) await sleep(options.delayMs, undefined, { signal: opts.signal })
      const key = opts.phase || opts.label || 'default'
      const value = responses[key] ?? responses.default ?? 'mock output'
      const raw = typeof value === 'function' ? await value(opts) : value
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      const result = { text, model: 'mock-model', chars: text.length }
      if (opts.json) {
        result.json = typeof raw === 'string' ? JSON.parse(raw) : raw
      }
      return result
    },
  }
}

export { BASE_ITEMS }
