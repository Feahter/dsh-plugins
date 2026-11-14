/**
 * Task board: dispatch work into a DSH Session and report completion back to
 * the phone call.
 *
 * The board subscribes to `agent/status` / `agent/error` on the Host context.
 * A tracked Session that stops running (or errors) produces one `task-done` /
 * `task-failed` event in a bounded queue; the browser polls `/events` and
 * interrupts playback to announce it.
 */

const QUEUE_LIMIT = 50
const PROMPT_TIMEOUT_MS = 20_000
const EVENTS_TIMEOUT_MS = 2_000
const SUMMARY_MAX = 200
const SPOKEN_DETAIL_MAX = 40

/** Permission preset a dispatched Session should run under. */
export const TASK_PERMISSION_PRESET = 'danger-full-access'
/** Reasoning effort a dispatched Session should use when the model supports it. */
export const TASK_REASONING_EFFORT = 'high'
/** Preference order when the model does not offer `high`. */
const EFFORT_FALLBACKS = [TASK_REASONING_EFFORT, 'max', 'medium', 'low', 'off']

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function boardError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max).trim()}…`
}

/**
 * @param {unknown} agent
 * @returns {string}
 */
function agentSessionId(agent) {
  if (agent === null || typeof agent !== 'object') return ''
  const candidate = agent.id ?? agent.sessionId ?? agent.session?.id
  return typeof candidate === 'string' ? candidate : ''
}

/**
 * Pull the newest assistant text out of a Session's event history.
 *
 * `sessionController.events` is the public surface for this; the internal
 * `assistantOutput` helper is not exposed, so we scan assistant/message
 * records for text blocks ourselves.
 * @param {any} controller
 * @param {string} sessionId
 * @returns {Promise<string | undefined>}
 */
async function readLastAssistantText(controller, sessionId) {
  if (controller === null || typeof controller !== 'object' || typeof controller.events !== 'function') {
    return undefined
  }
  const page = await controller.events(
    { address: { kind: 'session', sessionId }, maxMessages: 20 },
    AbortSignal.timeout(EVENTS_TIMEOUT_MS),
  )
  const records = Array.isArray(page?.records) ? page.records : []
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const event = records[index]?.event ?? records[index]
    if (event?.type !== 'assistant/message') continue
    const content = event?.data?.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim()
    if (text !== '') return text
  }
  return undefined
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '出了点问题'
}

/**
 * @param {object} options
 * @param {any} options.ctx Host context; only `get`, `on`, `off` and `logger` are used.
 * @param {() => number} [options.now]
 */
export function createTaskBoard({ ctx, now = () => Date.now() } = {}) {
  if (ctx === null || typeof ctx !== 'object') throw new Error('createTaskBoard needs the Host context')
  const logger = ctx.logger ?? console

  let sequence = 0
  /** @type {Array<{ id: number, type: string, text: string, summary: string, sessionId: string, title: string, at: number }>} */
  const queue = []
  /** @type {Map<string, { taskId: string, sessionId: string, title: string, text: string, dispatchedAt: number }>} */
  const tracked = new Map()
  let watching = false
  /** @type {Array<() => void>} */
  let unwatch = []

  function controller() {
    const found = service('sessionController')
    if (found === undefined || found === null) {
      throw boardError(503, 'service-missing', 'sessionController 不在本机')
    }
    return found
  }

  /**
   * All optional Host services are looked up through here: a Host that does not
   * expose one simply yields `undefined`, and callers treat that as "skip".
   * @param {string} name
   */
  function service(name) {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  }

  /**
   * Resolve the preset name to apply: the canonical name when the profile has
   * it, otherwise the first preset whose sandbox mode matches.
   * @param {any} presets
   * @returns {string | undefined}
   */
  function pickPresetName(presets) {
    if (presets === null || presets === undefined) return undefined
    const listed = typeof presets.names === 'function' ? presets.names() : presets.names
    const names = Array.isArray(listed) ? listed.filter((name) => typeof name === 'string') : []
    if (names.includes(TASK_PERMISSION_PRESET)) return TASK_PERMISSION_PRESET
    for (const name of names) {
      let resolved
      try {
        resolved = typeof presets.resolve === 'function' ? presets.resolve(name) : undefined
      } catch {
        resolved = undefined
      }
      if (resolved?.sandbox === TASK_PERMISSION_PRESET) return name
    }
    return undefined
  }

  /**
   * Read a preset name out of `current(session)` whether it hands back a string
   * or the resolved preset object.
   * @param {unknown} value
   * @returns {string}
   */
  function currentPresetName(value) {
    if (typeof value === 'string') return value
    if (value !== null && typeof value === 'object') {
      if (typeof value.name === 'string') return value.name
      if (typeof value.preset === 'string') return value.preset
    }
    return ''
  }

  /**
   * Switch the Session to the full-access preset before the prompt is queued.
   * Idempotent: a Session already on the target preset is left alone.
   * @param {string} sessionId
   */
  function applyPermission(sessionId) {
    const presets = service('permissionPresets')
    if (presets === null || presets === undefined || typeof presets.set !== 'function') return
    const sessions = service('sessions')
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    if (session === undefined || session === null) return
    const name = pickPresetName(presets)
    if (name === undefined) {
      logger.warn?.(`[voice-companion] permission preset "${TASK_PERMISSION_PRESET}" is not available`)
      return
    }
    if (typeof presets.current === 'function') {
      let current
      try {
        current = presets.current(session)
      } catch {
        current = undefined
      }
      if (currentPresetName(current) === name) return
    }
    presets.set(session, name)
  }

  /**
   * Ask the model registry which reasoning efforts this model accepts.
   * `resolveModelInfo` may return a Promise, so the whole read is awaited.
   * @param {string} provider
   * @param {string} modelId
   * @returns {Promise<string[] | undefined>}
   */
  async function readEfforts(provider, modelId) {
    const llm = service('llm')
    if (llm === null || llm === undefined || typeof llm.resolveModelInfo !== 'function') return undefined
    let info
    try {
      info = await llm.resolveModelInfo(provider, modelId)
    } catch (error) {
      logger.warn?.(`[voice-companion] could not resolve model info: ${errorMessage(error)}`)
      return undefined
    }
    const reasoning = info?.reasoning
    if (reasoning === null || reasoning === undefined) return undefined
    const raw = typeof reasoning === 'string' || Array.isArray(reasoning) ? reasoning : reasoning.efforts
    if (typeof raw === 'string') return [raw]
    if (!Array.isArray(raw)) return undefined
    return raw
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
      .filter((entry) => typeof entry === 'string' && entry !== '')
  }

  /**
   * Select high reasoning effort for the Session's next step. Falls back along
   * EFFORT_FALLBACKS; when the model advertises nothing we still try `high` and
   * let a rejection be warned about, never thrown.
   * @param {string} sessionId
   */
  async function applyEffort(sessionId) {
    const agents = service('agents')
    const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
    if (agent === null || agent === undefined) return
    const model = agent.model
    if (model === null || model === undefined || typeof model !== 'object') return

    let current
    try {
      current = typeof model.current === 'function' ? await model.current() : undefined
    } catch (error) {
      logger.warn?.(`[voice-companion] could not read current model: ${errorMessage(error)}`)
      return
    }
    const provider = current?.provider
    const modelId = current?.model
    if (typeof provider !== 'string' || provider === '' || typeof modelId !== 'string' || modelId === '') return

    let effort = TASK_REASONING_EFFORT
    const efforts = await readEfforts(provider, modelId)
    if (Array.isArray(efforts) && efforts.length > 0) {
      const supported = EFFORT_FALLBACKS.find((candidate) => efforts.includes(candidate))
      if (supported !== undefined) effort = supported
    }
    if (typeof model.select !== 'function') return
    try {
      await model.select({ provider, model: modelId, reasoningEffort: effort })
    } catch (error) {
      logger.warn?.(`[voice-companion] could not select reasoning effort: ${errorMessage(error)}`)
    }
  }

  /**
   * Apply permission + reasoning defaults for a Session. Every step is
   * best-effort: a missing service or a failing call must never fail dispatch.
   * @param {string} sessionId
   */
  async function applyDefaults(sessionId) {
    try {
      applyPermission(sessionId)
    } catch (error) {
      logger.warn?.(`[voice-companion] could not apply permission preset: ${errorMessage(error)}`)
    }
    try {
      await applyEffort(sessionId)
    } catch (error) {
      logger.warn?.(`[voice-companion] could not apply reasoning effort: ${errorMessage(error)}`)
    }
  }

  /**
   * @param {string} sessionId
   * @param {string} text
   * @param {string} title
   */
  async function promptSession(sessionId, text, title) {
    const requestId =
      globalThis.crypto?.randomUUID?.() ?? `vc-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const signal = AbortSignal.timeout(PROMPT_TIMEOUT_MS)
    const ack = await controller().prompt(
      {
        sessionId,
        requestId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      signal,
    )
    if (ack?.accepted === false) throw boardError(502, 'upstream', '任务没有被会话接收')
    logger.info?.(`[voice-companion] dispatched "${title}" to ${sessionId}`)
  }

  /**
   * @param {{ taskId: string, sessionId: string, title: string, text: string }} entry
   * @param {'task-done' | 'task-failed'} type
   * @param {unknown} [failure]
   */
  async function settle(entry, type, failure) {
    let detail
    if (type === 'task-done') {
      try {
        detail = await readLastAssistantText(
          typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined,
          entry.sessionId,
        )
      } catch (error) {
        logger.warn?.(`[voice-companion] could not read last assistant text: ${errorMessage(error)}`)
        detail = undefined
      }
    } else {
      detail = errorMessage(failure)
    }

    const summary = truncate(detail ?? entry.title, SUMMARY_MAX)
    const spokenDetail =
      detail !== undefined && truncate(detail, SPOKEN_DETAIL_MAX) !== entry.title
        ? truncate(detail, SPOKEN_DETAIL_MAX)
        : ''
    const text =
      type === 'task-done'
        ? `老板，「${entry.title}」做完了。${spokenDetail}`.trim()
        : `老板，「${entry.title}」没做成。${spokenDetail}`.trim()

    sequence += 1
    queue.push({
      id: sequence,
      type,
      text,
      summary,
      sessionId: entry.sessionId,
      title: entry.title,
      at: now(),
    })
    while (queue.length > QUEUE_LIMIT) queue.shift()
  }

  /**
   * @param {any} payload
   */
  async function onAgentStatus(payload) {
    const sessionId = agentSessionId(payload?.agent)
    if (sessionId === '') return
    const entry = tracked.get(sessionId)
    if (entry === undefined) return
    const status = typeof payload?.status === 'string' ? payload.status : ''
    if (status === '' || status === 'running') return
    // Remove before the async read so a duplicate status event cannot enqueue
    // the same completion twice.
    tracked.delete(sessionId)
    await settle(entry, 'task-done')
  }

  /**
   * @param {any} payload
   */
  async function onAgentError(payload) {
    const sessionId = agentSessionId(payload?.agent)
    if (sessionId === '') return
    const entry = tracked.get(sessionId)
    if (entry === undefined) return
    tracked.delete(sessionId)
    await settle(entry, 'task-failed', payload?.error)
  }

  /**
   * A freshly created Session has no Agent yet at dispatch time; `agent/created`
   * is the earliest point where model defaults can be applied to it.
   * @param {any} payload
   */
  async function onAgentCreated(payload) {
    const sessionId = agentSessionId(payload?.agent)
    if (sessionId === '') return
    if (!tracked.has(sessionId)) return
    await applyDefaults(sessionId)
  }

  function watch() {
    if (watching) return () => stopWatching()
    watching = true
    const cleanups = []
    const subscribe = (name, handler) => {
      if (typeof ctx.on !== 'function') return
      const listener = (payload) => {
        void handler(payload).catch((error) => {
          logger.warn?.(`[voice-companion] ${name} handler failed: ${errorMessage(error)}`)
        })
      }
      const off = ctx.on(name, listener)
      if (typeof off === 'function') cleanups.push(off)
      else if (typeof ctx.off === 'function') cleanups.push(() => ctx.off(name, listener))
    }
    subscribe('agent/status', onAgentStatus)
    subscribe('agent/error', onAgentError)
    subscribe('agent/created', onAgentCreated)
    unwatch = cleanups
    return () => stopWatching()
  }

  function stopWatching() {
    if (!watching) return
    watching = false
    for (const cleanup of unwatch) {
      try {
        cleanup()
      } catch {
        // Disposal must stay best-effort; a dead Session cannot be un-watched.
      }
    }
    unwatch = []
  }

  return {
    /**
     * @param {{ text?: unknown, sessionId?: unknown, title?: unknown, cwd?: unknown }} input
     * @returns {Promise<{ taskId: string, sessionId: string, title: string }>}
     */
    async dispatch({ text, sessionId, title, cwd } = {}) {
      const body = asString(text)
      if (body === '') throw boardError(400, 'invalid', '任务内容不能为空')

      let targetSessionId = asString(sessionId)
      if (sessionId !== undefined && sessionId !== null && targetSessionId === '') {
        throw boardError(400, 'invalid', 'sessionId 必须是字符串')
      }
      if (targetSessionId === '') {
        const created = await controller().create(cwd === undefined ? {} : { cwd })
        targetSessionId = String(created?.sessionId ?? created?.id ?? '')
        if (targetSessionId === '') throw boardError(502, 'upstream', '新建会话没有返回 sessionId')
      }

      const taskTitle = truncate(asString(title) || body, 12) || '新任务'
      const taskId = `vc-task-${now()}-${Math.random().toString(16).slice(2, 8)}`
      const entry = { taskId, sessionId: targetSessionId, title: taskTitle, text: body, dispatchedAt: now() }
      // Apply permission/reasoning defaults before the prompt is queued. The
      // 20s prompt timeout still bounds the whole dispatch.
      await applyDefaults(targetSessionId)
      // Track before prompting: the Session may start and finish fast, and the
      // status event must find an entry by then.
      tracked.set(targetSessionId, entry)
      try {
        await promptSession(targetSessionId, body, taskTitle)
      } catch (error) {
        tracked.delete(targetSessionId)
        throw error
      }
      return { taskId, sessionId: targetSessionId, title: taskTitle }
    },

    watch,
    stop: stopWatching,

    /**
     * @param {number} [since] Cursor returned by the previous poll; 0 on first call.
     * @returns {{ events: Array<any>, cursor: number }}
     */
    poll(since = 0) {
      const from = Number.isSafeInteger(since) && since >= 0 ? since : 0
      const events = queue.filter((event) => event.id > from)
      const cursor = events.length === 0 ? from : events[events.length - 1].id
      return { events, cursor }
    },

    /** Number of Sessions currently being watched. */
    get tracked() {
      return tracked.size
    },
  }
}
