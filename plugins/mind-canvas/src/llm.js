// 「AI 发散」：用宿主当前默认模型，把一个节点展开成几条子想法。
// 模型不可用时显式报错，绝不静默造数据冒充 AI 结果。
import { randomUUID } from 'node:crypto'

/** 插件在会话之外调模型，自己带一个会话标识。 */
export const PLUGIN_SESSION_ID = `dsh-mind-canvas-${randomUUID()}`

const INPUT_LIMIT = 500

export function currentSelection(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
    return selection?.provider && selection?.model ? selection : null
  } catch {
    return null
  }
}

export function modelInfo(ctx) {
  if (!ctx.get('llm')) return null
  const selection = currentSelection(ctx)
  if (!selection) return null
  return { provider: selection.provider, model: selection.model }
}

/** 从模型输出里抠出 JSON，容忍外面包了代码块或前后有说明文字。 */
export function extractJson(text) {
  const source = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source)
  const body = fenced ? fenced[1] : source
  const start = body.search(/[[{]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('模型没有返回 JSON')
  return JSON.parse(body.slice(start, end + 1))
}

export function buildPrompt({ text, count, angle, siblings, lang }) {
  const want = Math.max(1, Math.min(8, Number(count) || 4))
  const previous = (Array.isArray(siblings) ? siblings : [])
    .filter(item => typeof item === 'string' && item.trim())
    .slice(0, 12)
  const english = lang === 'en'
  const system = english
    ? 'You are an editor who helps people think in trees. You only ever answer with JSON.'
    : '你是一个帮人把想法往下想的编辑。你只输出 JSON，不写解释。'
  const user = english
    ? [
      `Starting point: ${String(text ?? '').slice(0, INPUT_LIMIT)}`,
      previous.length ? `Already there: ${previous.map(item => item.slice(0, 60)).join(' / ')}` : '',
      angle ? `Direction: ${String(angle).slice(0, 200)}` : '',
      `Give ${want} child ideas. Each 4-12 words, concrete enough to grow further, no filler, no numbering.`,
      'Do not repeat the starting point or the existing ideas.',
      'Answer as {"ideas": ["...", "..."]}',
    ].filter(Boolean).join('\n')
    : [
      `起点：${String(text ?? '').slice(0, INPUT_LIMIT)}`,
      previous.length ? `已经有：${previous.map(item => item.slice(0, 60)).join(' / ')}` : '',
      angle ? `方向：${String(angle).slice(0, 200)}` : '',
      `给出 ${want} 个往下想的子想法。每个 6 到 18 个字，具体到能继续往下长，不要空话、不要编号。`,
      '不要重复起点，也不要重复已有的子想法。',
      '按 {"ideas": ["...", "..."]} 输出。',
    ].filter(Boolean).join('\n')
  return { system, user, count: want }
}

/**
 * 调一次模型拿子想法。
 * @param {object} ctx - Cordis 上下文。
 * @param {{system: string, user: string, signal?: AbortSignal}} request - 提示词。
 * @returns {Promise<string>} 模型返回的完整文本。
 */
export async function callModel(ctx, { system, user, signal }) {
  const info = modelInfo(ctx)
  if (!info) throw new Error('没有可用模型：先在设置里选一个助手模型')
  const llm = ctx.get('llm')
  const call = await llm.prepareCall({ provider: info.provider, model: info.model, maxTokens: 1200 }, signal)
  let text = ''
  for await (const chunk of call.stream({
    ...call.config,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'dsh-mind-canvas' } }],
    sessionId: PLUGIN_SESSION_ID,
    signal,
  })) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
      throw new Error(chunk.reason.failure?.message || '模型调用失败')
    }
  }
  return text
}

/** 把模型输出整理成干净的字符串数组。 */
export function normalizeIdeas(raw, count) {
  const parsed = extractJson(raw)
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.ideas) ? parsed.ideas : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const clean = item.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim()
    if (!clean || clean.length > 80) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= Math.max(1, Math.min(8, Number(count) || 4))) break
  }
  return out
}
