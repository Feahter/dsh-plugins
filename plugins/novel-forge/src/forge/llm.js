/**
 * LLM 网关：惰性取服务、prepareCall + stream、流式累积、重试、JSON 提取。
 * 不直接依赖宿主，service / resolveModel 都以回调注入。
 */

import { ForgeError, asForgeError } from './errors.js'
import { estimateTokens, extractJson, truncate } from './text.js'

const DEFAULT_RETRY_DELAYS = [1000, 3000]
const RETRYABLE = new Set(['LLM_ERROR', 'LLM_EMPTY'])
const SESSION_PREFIX = 'dsh-forge-'

function abortedError(detail) {
  return new ForgeError('LLM_ABORTED', '模型调用已取消', detail)
}

function isAbort(err) {
  return (
    err instanceof ForgeError && err.code === 'LLM_ABORTED'
  ) || (err && typeof err === 'object' && err.name === 'AbortError')
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      reject(abortedError())
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function waitStream(stream) {
  if (!stream) return null
  if (typeof stream[Symbol.asyncIterator] === 'function') return stream
  if (Array.isArray(stream)) return stream
  if (stream.events && typeof stream.events[Symbol.asyncIterator] === 'function') return stream.events
  if (typeof stream[Symbol.iterator] === 'function') return stream
  return null
}

function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const input = usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens
  const output = usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens
  const out = {}
  if (typeof input === 'number') out.inputTokens = input
  if (typeof output === 'number') out.outputTokens = output
  return Object.keys(out).length ? out : null
}

/**
 * @param {{
 *   service?: any | (() => any),
 *   resolveModel?: () => any | Promise<any>,
 *   onEvent?: (event: object) => void | Promise<void>,
 *   signal?: AbortSignal,
 *   sessionId?: string,
 *   retryDelays?: number[],
 *   maxRetries?: number,
 * }} [config]
 */
export function createLlmGateway(config = {}) {
  const {
    service,
    resolveModel,
    onEvent,
    signal: outerSignal,
    sessionId,
    retryDelays = DEFAULT_RETRY_DELAYS,
    maxRetries = 2,
  } = config

  const getService = typeof service === 'function' ? service : () => service
  let lastModel = null

  async function selectModel() {
    if (typeof resolveModel !== 'function') return null
    try {
      const selection = await resolveModel()
      if (!selection) return null
      if (typeof selection === 'string') {
        const [provider, model] = selection.includes('/') ? selection.split('/') : [undefined, selection]
        return provider && model ? { provider, model } : null
      }
      const provider = selection.provider ?? selection.providerId
      const model = selection.model ?? selection.modelId
      if (!provider || !model) return null
      return { provider, model }
    } catch {
      return null
    }
  }

  async function attempt(opts) {
    const chosenSignal = opts.signal || outerSignal
    if (chosenSignal?.aborted) throw abortedError()

    const svc = await getService()
    if (!svc || typeof svc.prepareCall !== 'function') {
      throw new ForgeError('LLM_UNAVAILABLE', '模型服务未就绪，请先在设置里选择模型')
    }
    const selection = await selectModel()
    if (!selection) {
      throw new ForgeError('LLM_UNAVAILABLE', '还没有选择模型，请先在设置里选一个')
    }
    const { provider, model } = selection
    lastModel = selection

    const call = await svc.prepareCall(
      { provider, model, maxTokens: opts.maxTokens ?? 4096, temperature: opts.temperature },
      chosenSignal,
    )
    if (!call || typeof call.stream !== 'function') {
      throw new ForgeError('LLM_ERROR', '模型接口不可用（缺少 stream）')
    }

    const streamArgs = {
      ...(call.config || {}),
      system: opts.system ?? '',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: opts.user ?? '' }],
          source: { kind: 'dsh-forge' },
        },
      ],
      sessionId: opts.sessionId || sessionId || `${SESSION_PREFIX}adhoc`,
      signal: chosenSignal,
    }
    if (opts.maxTokens !== undefined) streamArgs.maxTokens = opts.maxTokens
    if (opts.temperature !== undefined) streamArgs.temperature = opts.temperature

    const stream = await call.stream(streamArgs)
    const iterable = waitStream(stream)
    if (!iterable) throw new ForgeError('LLM_ERROR', '模型流不可读')

    let text = ''
    let finish = null
    let usage = null
    for await (const chunk of iterable) {
      if (chosenSignal?.aborted) throw abortedError()
      if (typeof chunk === 'string') {
        text += chunk
        continue
      }
      if (!chunk || typeof chunk !== 'object') continue

      if (chunk.type === 'text-delta' || chunk.type === 'text' || chunk.type === 'delta') {
        const piece = chunk.text ?? chunk.delta ?? chunk.content
        if (typeof piece === 'string') text += piece
      } else if (chunk.type === 'finish' || chunk.type === 'done') {
        finish = chunk
        if (chunk.usage) usage = chunk.usage
      } else if (chunk.type === 'error') {
        const message = chunk.error?.message || chunk.message || '模型调用失败'
        throw new ForgeError('LLM_ERROR', String(message), chunk.error || chunk)
      }
      if (chunk.usage) usage = chunk.usage
      if (finish) break
    }

    if (chosenSignal?.aborted) throw abortedError()
    if (finish) {
      const reason = finish.reason
      const kind = typeof reason === 'string' ? reason : reason?.kind
      if (kind === 'error') {
        throw new ForgeError('LLM_ERROR', finish.message || reason?.message || '模型调用失败', reason)
      }
      if (kind === 'aborted') throw abortedError(reason)
    }
    if (!text.trim()) {
      throw new ForgeError('LLM_EMPTY', '模型返回了空文本')
    }

    const chars = text.length
    const result = { text, json: undefined, model, chars }
    if (opts.json) {
      try {
        result.json = extractJson(text)
      } catch (err) {
        const fe = asForgeError(err, 'LLM_PARSE')
        throw new ForgeError('LLM_PARSE', fe.message, { raw: truncate(text, 2000) })
      }
    }
    const mapped = mapUsage(usage)
    if (mapped) result.usage = mapped
    result.estTokens = estimateTokens(chars)

    if (typeof onEvent === 'function') {
      try {
        await onEvent({
          type: 'llm',
          phase: opts.phase ?? null,
          label: opts.label ?? null,
          chars,
          model,
          json: Boolean(opts.json),
        })
      } catch {
        // 事件回调失败不影响结果
      }
    }
    return result
  }

  return {
    /**
     * @param {{system?: string, user: string, maxTokens?: number, temperature?: number,
     *   json?: boolean, phase?: string, label?: string, signal?: AbortSignal, sessionId?: string}} opts
     */
    async generate(opts = {}) {
      const chosenSignal = opts.signal || outerSignal
      const delays = Array.isArray(retryDelays) && retryDelays.length ? retryDelays : DEFAULT_RETRY_DELAYS
      const totalAttempts = Math.max(1, Number(maxRetries) + 1)
      let lastError = null
      // 空文本常见于推理模型把预算烧在 reasoning 上：逐次加倍 maxTokens 再试。
      let maxTokens = opts.maxTokens

      for (let i = 0; i < totalAttempts; i += 1) {
        if (chosenSignal?.aborted) throw abortedError()
        try {
          return await attempt({ ...opts, maxTokens, signal: chosenSignal })
        } catch (err) {
          if (isAbort(err) || chosenSignal?.aborted) throw abortedError(err)
          const fe = asForgeError(err, 'LLM_ERROR')
          lastError = fe
          if (fe.code === 'LLM_EMPTY' && maxTokens && maxTokens < 16000) {
            maxTokens = Math.min(16000, maxTokens * 2)
          }
          if (!RETRYABLE.has(fe.code) || i >= totalAttempts - 1) throw fe
          const delay = delays[Math.min(i, delays.length - 1)] ?? 1000
          await abortableSleep(delay, chosenSignal)
        }
      }
      throw lastError || new ForgeError('LLM_ERROR', '模型调用失败')
    },

    /** 供宿主 /model 查询用；不触发调用。 */
    async info() {
      const selection = await selectModel()
      return {
        available: Boolean(selection && typeof getService() === 'object' && getService()),
        provider: selection?.provider ?? null,
        model: selection?.model ?? lastModel?.model ?? null,
      }
    },
  }
}
