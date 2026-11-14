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
    const found = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined
    if (found === undefined || found === null) {
      throw boardError(503, 'service-missing', 'sessionController 不在本机')
    }
    return found
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
