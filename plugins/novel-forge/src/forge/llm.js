/**
 * LLM 网关：惰性取服务、prepareCall + stream、流式累积、重试、JSON 提取。
 * 不直接依赖宿主，service / resolveModel 都以回调注入。
 */

import { ForgeError, asForgeError } from './errors.js'
import { estimateTokens, extractJson, truncate } from './text.js'

const DEFAULT_RETRY_DELAYS = [1000, 3000]
// LLM_TIMEOUT 是瞬时故障，值得再试一次；LLM_AUTH 是配置问题，重试只会白等。
const RETRYABLE = new Set(['LLM_ERROR', 'LLM_EMPTY', 'LLM_TIMEOUT'])
const DEFAULT_IDLE_TIMEOUT_MS = 120000
const SESSION_PREFIX = 'dsh-forge-'

// 永久性失败的 failure.code（宿主侧错误）。命中就不重试，直接告诉用户去配模型。
const PERMANENT_CODES = new Set([
  'MISSING_CREDENTIAL',
  'INVALID_API_KEY',
  'INVALID_CREDENTIAL',
  'AUTH_FAILED',
  'PERMISSION_DENIED',
  'FORBIDDEN',
  'MODEL_NOT_FOUND',
])
const PERMANENT_MESSAGE = /no api key|missing (api )?key|invalid (api )?key|unauthori[sz]ed|forbidden|401|403|未配置|没有配置/i
// 上下文超限：重试三次也还是超，只会把整段 prompt 的输入费付三遍。
const CONTEXT_MESSAGE =
  /context (length|window)|maximum context|too many tokens|token limit|input is too long|prompt is too long|reduce the length|超出.*(上下文|长度)|上下文.*(超|上限)/i
const CONTEXT_HINT =
  '（这一段 prompt 超过了模型的上下文窗口。把每章目标字数或章节数调小，或换上下文更大的模型，再重跑这一步）'
// 额度/计费类：不是抖动，重试只会白等。
const QUOTA_CODES = new Set(['QUOTA_EXCEEDED', 'INSUFFICIENT_QUOTA', 'BILLING_ERROR', 'INSUFFICIENT_BALANCE'])
const QUOTA_MESSAGE = /insufficient (quota|balance)|quota exceeded|exceeded your current quota|余额不足|额度不足/i
const CONFIG_HINT = '（这是模型配置问题，不是网络抖动：请在 设置 → 模型 里配置 API key 后重试）'
const MAX_OUTPUT_TOKENS = 16000
// 「输出撞上限」在不同宿主的 finish 里写法不一，统一收在这里。
const TRUNCATED_KINDS = new Set(['length', 'max_tokens', 'max-tokens', 'max_output_tokens', 'truncated'])
const TRUNCATE_HINT =
  '（输出撞到了上限。可以调小每章目标字数，或换一个输出上限更高的模型；被截断的稿子不会当成完成品继续用下去）'

function finishKindOf(finish) {
  const reason = finish?.reason
  const kind =
    typeof reason === 'string'
      ? reason
      : reason?.kind ?? reason?.type ?? finish?.stopReason ?? finish?.stop_reason
  return kind ? String(kind) : ''
}

function failureText(reason, finish) {
  return String(reason?.failure?.message ?? reason?.message ?? finish?.message ?? reason?.code ?? reason ?? '')
}

function isPermanentFailure(reason) {
  const code = reason?.failure?.code ?? reason?.code
  if (code && PERMANENT_CODES.has(String(code))) return true
  const message = String(reason?.failure?.message ?? reason?.message ?? reason ?? '')
  return PERMANENT_MESSAGE.test(message)
}

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

/**
 * 流式迭代 + 空闲超时：模型卡住不出字时不能无限等（只能靠用户点取消）。
 * 超时后调用方 abort 掉底层流，避免连接吊着。
 */
async function nextWithTimeout(iterator, ms) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return iterator.next()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ForgeError('LLM_TIMEOUT', `模型 ${Math.round(ms / 1000)} 秒没有新输出，已中断`, { idleTimeoutMs: ms }))
    }, ms)
  })
  try {
    return await Promise.race([iterator.next(), timeout])
  } finally {
    clearTimeout(timer)
  }
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
    const outer = opts.signal || outerSignal
    if (outer?.aborted) throw abortedError()

    // 内部 controller：外部取消（用户点取消）与空闲超时都能切断底层流。
    const controller = new AbortController()
    const onOuterAbort = () => controller.abort()
    outer?.addEventListener?.('abort', onOuterAbort, { once: true })
    const chosenSignal = controller.signal

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
    const idleTimeout = opts.idleTimeoutMs ?? config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    const iterator = iterable[Symbol.asyncIterator]?.() ?? iterable[Symbol.iterator]?.()
    try {
      while (iterator) {
        const step = await nextWithTimeout(iterator, idleTimeout)
        if (step.done) break
        const chunk = step.value
        if (outer?.aborted) throw abortedError()
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
    } catch (err) {
      // 超时/外部取消都要把底层连接断掉，否则模型侧会继续烧 token。
      // 注意：不能 await iterator.return()——生成器若正卡在 await 上，return 会一直吊着。
      controller.abort()
      try { Promise.resolve(iterator?.return?.()).catch(() => {}) } catch { /* 忽略 */ }
      if (err instanceof ForgeError && err.code === 'LLM_TIMEOUT') throw err
      if (outer?.aborted) throw abortedError()
      if (isAbort(err)) throw abortedError(err)
      throw asForgeError(err, 'LLM_ERROR')
    } finally {
      outer?.removeEventListener?.('abort', onOuterAbort)
    }

    if (outer?.aborted) throw abortedError()
    const finishKind = finishKindOf(finish)
    if (finish) {
      const reason = finish.reason
      const kind = finishKind
      if (kind === 'error') {
        const message = String(finish.message || reason?.message || '模型调用失败')
        const detailText = failureText(reason, finish)
        const failureCode = String(reason?.failure?.code ?? reason?.code ?? '')
        if (CONTEXT_MESSAGE.test(detailText)) {
          throw new ForgeError('LLM_CONTEXT', `${message}${CONTEXT_HINT}`, {
            provider,
            model,
            code: failureCode || null,
            promptChars: (opts.system?.length ?? 0) + (opts.user?.length ?? 0),
          })
        }
        if (QUOTA_CODES.has(failureCode) || QUOTA_MESSAGE.test(detailText)) {
          throw new ForgeError('LLM_QUOTA', `${message}（额度或计费问题，重试没有用：请检查账户余额 / 套餐额度）`, {
            provider,
            model,
            code: failureCode || null,
          })
        }
        if (isPermanentFailure(reason) || isPermanentFailure(finish)) {
          // 没配 key / 权限不足：重试只会让每个章节都白等 4 秒，直接报可执行的错
          throw new ForgeError('LLM_AUTH', `${message}${CONFIG_HINT}`, {
            provider,
            model,
            failure: reason?.failure ?? reason ?? null,
          })
        }
        throw new ForgeError('LLM_ERROR', message, reason)
      }
      if (kind === 'aborted') throw abortedError(reason)
      if (TRUNCATED_KINDS.has(kind)) {
        // 截断的正文/JSON 是废稿：静默落盘会让后续审校、修订、摘要全部白花钱。
        throw new ForgeError(
          'LLM_TRUNCATED',
          `模型输出被截断（达到输出上限 ${opts.maxTokens ?? MAX_OUTPUT_TOKENS} tokens）${TRUNCATE_HINT}`,
          { maxTokens: opts.maxTokens ?? null, chars: text.length, kind },
        )
      }
    }
    if (!text.trim()) {
      throw new ForgeError('LLM_EMPTY', '模型返回了空文本')
    }

    const chars = text.length
    const result = { text, json: undefined, model, chars, finishKind: finishKind || null }
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
      // 最多加倍两次（预算 1→2→4，最坏 4× 原始输出预算）——空返回的几枪输出为 0，
      // 真花钱的是 reasoning；让第三次有机会成，比整炉失败重跑便宜。
      let maxTokens = Number(opts.maxTokens) || 4096
      let doublings = 0
      let attempts = 0
      let failedAttempts = 0

      for (let i = 0; i < totalAttempts; i += 1) {
        if (chosenSignal?.aborted) throw abortedError()
        attempts += 1
        try {
          const result = await attempt({ ...opts, maxTokens, signal: chosenSignal })
          // 重试次数要能回溯：失败那几次的输入 token 是真花掉的，账不能只记成功那次。
          return { ...result, attempts, failedAttempts }
        } catch (err) {
          if (isAbort(err) || chosenSignal?.aborted) throw abortedError(err)
          const fe = asForgeError(err, 'LLM_ERROR')
          // 让调用方（引擎）能按「实际尝试次数」记账：失败那几次的输入是真付过钱的。
          fe.detail = { ...(fe.detail ?? {}), attempts, failedAttempts }
          lastError = fe
          failedAttempts += 1
          if (fe.code === 'LLM_EMPTY' && doublings < 2 && maxTokens < MAX_OUTPUT_TOKENS) {
            maxTokens = Math.min(MAX_OUTPUT_TOKENS, maxTokens * 2)
            doublings += 1
          }
          // 截断说明 budget 不够：抬到 1.6× 再试一次；已经在上限就直接报可执行的错。
          if (fe.code === 'LLM_TRUNCATED') {
            if (i > 0 || maxTokens >= MAX_OUTPUT_TOKENS) throw fe
            maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.round(maxTokens * 1.6))
            const delay = delays[Math.min(i, delays.length - 1)] ?? 1000
            await abortableSleep(delay, chosenSignal)
            continue
          }
          // 超时只补一枪：再挂一次就该让用户知道，而不是继续等
          if (fe.code === 'LLM_TIMEOUT' && i > 0) throw fe
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
