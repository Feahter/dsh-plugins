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
/** How many tasks the task view can page through. */
const HISTORY_LIMIT = 50
/** Session events read for one live timeline request. */
const TIMELINE_MAX = 60
/** Upper bound for a single node's text; the canvas truncates visually. */
const NODE_TEXT_MAX = 1_200
/** Beyond this the middle of a long run folds into one "省略" node. */
const NODE_LIMIT = 36

/** Human labels for the tools dispatched tasks normally use. */
const TOOL_LABELS = {
  bash: '运行命令',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  grep: '搜索内容',
  glob: '查找文件',
  todo_write: '更新计划',
  todowrite: '更新计划',
  'web_search': '联网搜索',
  'web-fetch': '读取网页',
  web_fetch: '读取网页',
  task_list: '查看任务',
  task_resume: '接续任务',
  task_checkpoint: '记录进度',
  task_close: '收尾任务',
  subagent_scout: '子代理侦察',
  subagent_worker: '子代理执行',
  subagent_deep: '子代理深研',
  subagent_review: '子代理审查',
  spawn_teammate: '派出队友',
  send_message: '给队友发消息',
  team_task_create: '建团队任务',
  team_task_update: '更新团队任务',
  present: '交付文件',
}

/**
 * @param {string} text
 * @param {number} max
 */
function trimText(text, max) {
  const value = String(text === null || text === undefined ? '' : text)
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

/**
 * Reduce a tool's raw JSON arguments to the one line a node card shows:
 * the field a human would look at, and for `todo_write` the plan itself.
 * @param {string} name
 * @param {string} raw
 * @returns {string}
 */
export function summarizeToolArguments(name, raw) {
  const text = asString(raw)
  if (text === '') return ''
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return trimText(text, 200)
  }
  if (parsed === null || typeof parsed !== 'object') return trimText(String(parsed), 200)
  if (Array.isArray(parsed)) return trimText(text, 200)
  if ((name === 'todo_write' || name === 'todowrite') && Array.isArray(parsed.todos)) {
    const marks = { completed: '✓', in_progress: '▶', pending: '○' }
    return parsed.todos
      .map((item) => `${marks[item?.status] ?? '○'} ${asString(item?.content)}`)
      .join('\n')
  }
  for (const key of [
    'command',
    'file_path',
    'path',
    'pattern',
    'query',
    'url',
    'prompt',
    'description',
    'text',
    'session_id',
  ]) {
    if (typeof parsed[key] === 'string' && parsed[key].trim() !== '') {
      return trimText(parsed[key], 240)
    }
  }
  const pairs = Object.entries(parsed)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  return trimText(pairs.join(' · '), 240)
}

/**
 * Text of the last assistant message in a session timeline.
 * @param {any[]} events
 * @returns {string | undefined}
 */
export function lastAssistantText(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
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
 * Tool result text, used as the node's small print.
 * @param {any} event
 * @returns {string}
 */
function toolResultText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return trimText(
    content
      .filter((part) => typeof part?.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim(),
    240,
  )
}

/**
 * Turn one task plus its session events into the ordered node chain the canvas
 * draws: what was said → what was dispatched → what the agent actually did →
 * how it ended. Pure so the shape is unit-testable without a Host.
 *
 * @param {object} input
 * @param {{ title?: string, text?: string, utterance?: string, sessionId?: string }} input.task
 * @param {any[]} [input.events] Chronological session events.
 * @param {boolean} [input.running]
 * @param {string} [input.failure]
 * @returns {Array<{ id: string, kind: string, title: string, content: string, status: string, detail?: string }>}
 */
export function buildTaskNodes({ task, events = [], running = false, failure } = {}) {
  const nodes = []
  let sequence = 0
  const push = (node) => {
    sequence += 1
    nodes.push({ id: `n${sequence}`, ...node })
    return nodes[nodes.length - 1]
  }

  const heard = asString(task?.utterance) || asString(task?.text)
  if (heard !== '') {
    push({ kind: 'heard', title: '听到', content: trimText(heard, NODE_TEXT_MAX), status: 'done' })
  }
  push({
    kind: 'dispatch',
    title: '派活',
    content: trimText(asString(task?.text) || heard, NODE_TEXT_MAX),
    status: 'done',
    detail: `会话 ${shortSession(task?.sessionId)} · 完全访问 · 推理 high`,
  })

  /** @type {Map<string, any>} */
  const byCallId = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    const type = event?.type
    const data = event?.data ?? {}
    if (type === 'tool/call') {
      const callId = typeof data.callId === 'string' ? data.callId : ''
      const node = push({
        kind: 'tool',
        title: TOOL_LABELS[data.name] ?? (asString(data.name) || '工具调用'),
        content: summarizeToolArguments(data.name, data.arguments),
        status: running ? 'active' : 'pending',
        detail: asString(data.name),
      })
      if (callId !== '') byCallId.set(callId, node)
      continue
    }
    if (type === 'tool/result') {
      const node = byCallId.get(typeof data.callId === 'string' ? data.callId : '')
      if (node === undefined) continue
      const failed = data?.message?.isError === true
      node.status = failed ? 'error' : 'done'
      const text = toolResultText(event)
      if (text !== '') node.detail = `${node.detail ? node.detail + ' · ' : ''}${failed ? '失败：' : ''}${text}`
      byCallId.delete(typeof data.callId === 'string' ? data.callId : '')
      continue
    }
    if (type === 'assistant/message') {
      const content = data?.message?.content
      if (!Array.isArray(content)) continue
      const text = content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
        .trim()
      if (text === '') continue
      push({ kind: 'message', title: '回复', content: trimText(text, NODE_TEXT_MAX), status: 'done' })
    }
  }

  // A run that stopped with a call still open marks that call as the step it
  // died on, rather than leaving it looking merely "pending".
  if (!running) {
    for (const node of byCallId.values()) {
      node.status = failure === undefined ? 'done' : 'error'
    }
  }

  const hasActive = nodes.some((node) => node.status === 'active')
  if (running && !hasActive) {
    push({ kind: 'live', title: '下一步', content: '模型正在继续…', status: 'active' })
  }
  if (!running) {
    push(
      failure === undefined
        ? { kind: 'result', title: '交付', content: trimText(asString(task?.summary) || '做完了', NODE_TEXT_MAX), status: 'done' }
        : { kind: 'result', title: '没做成', content: trimText(failure, NODE_TEXT_MAX), status: 'error' },
    )
  }

  if (nodes.length <= NODE_LIMIT) return nodes
  const head = nodes.slice(0, 5)
  const tail = nodes.slice(nodes.length - (NODE_LIMIT - 6))
  const gap = {
    id: 'n-gap',
    kind: 'gap',
    title: '…',
    content: `中间省略 ${nodes.length - head.length - tail.length} 个节点`,
    status: 'done',
  }
  return [...head, gap, ...tail]
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function shortSession(value) {
  const id = asString(value)
  if (id === '') return '新会话'
  if (id.length <= 10) return id
  return `${id.slice(0, 6)}…${id.slice(-3)}`
}

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
 * Read a Session's recent events for the task view. `sessionController.events`
 * is the public surface for this; the internal `assistantOutput` helper is not
 * exposed, so the timeline is read raw and interpreted here.
 * @param {any} controller
 * @param {string} sessionId
 * @param {AbortSignal} [signal]
 * @returns {Promise<any[]>}
 */
async function readSessionTimeline(controller, sessionId, signal) {
  if (controller === null || typeof controller !== 'object' || typeof controller.events !== 'function') {
    return []
  }
  let page
  try {
    page = await controller.events(
      { address: { kind: 'session', sessionId }, maxMessages: TIMELINE_MAX },
      signal ?? AbortSignal.timeout(EVENTS_TIMEOUT_MS),
    )
  } catch {
    return []
  }
  const records = Array.isArray(page?.records) ? page.records : Array.isArray(page) ? page : []
  return records.map((record) => record?.event ?? record).filter((event) => event !== null && typeof event === 'object')
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
  /**
   * Every task this Host dispatched, newest last. The task view pages through
   * this; `tracked` only holds the ones still running.
   * @type {Array<{ taskId: string, sessionId: string, title: string, text: string, utterance: string, dispatchedAt: number, status: 'running' | 'done' | 'failed', settledAt: number | null, summary: string, nodes: any[] | null }>}
   */
  const history = []
  /** @type {Map<string, { taskId: string, sessionId: string, title: string, text: string, utterance: string, dispatchedAt: number, status: 'running' | 'done' | 'failed', settledAt: number | null, summary: string, nodes: any[] | null }>} */
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
   * @param {AbortSignal} [signal]
   */
  async function applyPermission(sessionId, signal) {
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
    signal?.throwIfAborted()
    await presets.set(session, name)
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
   * @param {AbortSignal} [signal]
   */
  async function applyEffort(sessionId, signal) {
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

    signal?.throwIfAborted()
    let effort = TASK_REASONING_EFFORT
    const efforts = await readEfforts(provider, modelId)
    if (Array.isArray(efforts) && efforts.length > 0) {
      const supported = EFFORT_FALLBACKS.find((candidate) => efforts.includes(candidate))
      if (supported !== undefined) effort = supported
    }
    if (typeof model.select !== 'function') return
    signal?.throwIfAborted()
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
   * @param {AbortSignal} [signal]
   */
  async function applyDefaults(sessionId, signal) {
    signal?.throwIfAborted()
    try {
      await applyPermission(sessionId, signal)
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn?.(`[voice-companion] could not apply permission preset: ${errorMessage(error)}`)
    }
    signal?.throwIfAborted()
    try {
      await applyEffort(sessionId, signal)
    } catch (error) {
      signal?.throwIfAborted()
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
   * @param {{ taskId: string, sessionId: string, title: string, text: string, utterance: string }} entry
   * @param {'task-done' | 'task-failed'} type
   * @param {unknown} [failure]
   */
  async function settle(entry, type, failure) {
    let timeline = []
    if (type === 'task-done') {
      timeline = await readSessionTimeline(service('sessionController'), entry.sessionId)
    }
    let detail
    if (type === 'task-done') {
      detail = lastAssistantText(timeline)
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

    // Freeze the node chain at settle time: the session log stays on disk, but
    // the snapshot keeps the canvas stable even if the log is later pruned.
    entry.status = type === 'task-done' ? 'done' : 'failed'
    entry.settledAt = now()
    entry.summary = summary
    entry.nodes = buildTaskNodes({
      task: entry,
      events: timeline,
      running: false,
      failure: type === 'task-failed' ? summary : undefined,
    })

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

  /**
   * Public shape of one task. Nodes are not included; `detail` returns them.
   * @param {any} entry
   */
  function taskSummary(entry) {
    return {
      taskId: entry.taskId,
      sessionId: entry.sessionId,
      title: entry.title,
      text: entry.text,
      utterance: entry.utterance,
      status: entry.status,
      dispatchedAt: entry.dispatchedAt,
      settledAt: entry.settledAt,
      summary: entry.summary,
      nodeCount: Array.isArray(entry.nodes) ? entry.nodes.length : null,
    }
  }

  return {
    /**
     * @param {{ text?: unknown, sessionId?: unknown, title?: unknown, utterance?: unknown, cwd?: unknown, signal?: AbortSignal }} input
     * @returns {Promise<{ taskId: string, sessionId: string, title: string }>}
     */
    async dispatch({ text, sessionId, title, utterance, cwd, signal } = {}) {
      signal?.throwIfAborted()
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
      const entry = {
        taskId,
        sessionId: targetSessionId,
        title: taskTitle,
        text: body,
        utterance: asString(utterance) || body,
        dispatchedAt: now(),
        status: 'running',
        settledAt: null,
        summary: '',
        nodes: null,
      }
      history.push(entry)
      while (history.length > HISTORY_LIMIT) history.shift()
      // Apply defaults before committing work to the queue. Once prompt() is
      // invoked, its existing timeout and task tracking own the outcome.
      await applyDefaults(targetSessionId, signal)
      signal?.throwIfAborted()
      // Track before prompting: the Session may start and finish fast, and the
      // status event must find an entry by then.
      tracked.set(targetSessionId, entry)
      try {
        await promptSession(targetSessionId, body, taskTitle)
      } catch (error) {
        tracked.delete(targetSessionId)
        // The task view should still show a dispatch that never landed, with
        // the reason, instead of a card stuck on "running" forever.
        entry.status = 'failed'
        entry.settledAt = now()
        entry.summary = errorMessage(error)
        entry.nodes = buildTaskNodes({ task: entry, events: [], running: false, failure: entry.summary })
        throw error
      }
      return { taskId, sessionId: targetSessionId, title: taskTitle }
    },

    watch,
    stop: stopWatching,

    /**
     * Newest first; the task view's left rail.
     * @returns {Array<any>}
     */
    list() {
      return history.slice().reverse().map(taskSummary)
    },

    /**
     * One task plus its node chain. A running task reads the Session's events
     * on every call, which is what makes the canvas live; a settled task serves
     * the snapshot frozen at settle time.
     * @param {{ taskId?: unknown, live?: boolean }} [input]
     * @returns {Promise<{ task: any, nodes: any[] }>}
     */
    async detail({ taskId, live = true } = {}) {
      const id = asString(taskId)
      const entry = history.find((candidate) => candidate.taskId === id)
      if (entry === undefined) throw boardError(404, 'not-found', '没有这个任务')
      let nodes = entry.nodes
      if (entry.status === 'running' && live !== false) {
        const timeline = await readSessionTimeline(service('sessionController'), entry.sessionId)
        nodes = buildTaskNodes({ task: entry, events: timeline, running: true })
      } else if (!Array.isArray(nodes)) {
        nodes = buildTaskNodes({
          task: entry,
          events: [],
          running: false,
          failure: entry.status === 'failed' ? entry.summary : undefined,
        })
      }
      return { task: taskSummary(entry), nodes }
    },

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
