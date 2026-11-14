/**
 * Command service for hotkey voice control: plan a route, then deliver it.
 *
 * Ported from dsh-voice-control's `/plan` and `/dispatch` handlers. Routing
 * itself lives in `./router.js` (pure functions), Session I/O in `./sessions.js`
 * (bound to `ctx.sessionController`); this module is the thin, ctx-bound seam
 * the HTTP layer calls, so handlers stay free of framework details.
 *
 * Error shape follows `host/http.js`: thrown `httpError(status, code, message)`
 * values are already client-actionable (`classifyError` passes them through).
 */

import { httpError } from './http.js'
import { planRoute, resolveOrdinal, spokenConfirmation } from './router.js'
import { createSessionBridge } from './sessions.js'

/**
 * @typedef {object} PlanPayload
 * @property {string} utterance
 * @property {string} [currentSessionId]
 * @property {Array<{ sessionId: string, title?: string, score?: number }>} [pending]
 * @property {string} [cwd]
 */

/**
 * @typedef {object} SendPayload
 * @property {'prompt' | 'new' | 'cancel'} action
 * @property {string} [sessionId]
 * @property {string} [text]
 * @property {'queue' | 'steer'} [mode]
 * @property {string} [cwd]
 */

/**
 * @param {object} options
 * @param {any} options.ctx Cordis context; `ctx.get('sessionController')` is the only required service.
 * @param {() => number} [options.now] Clock seam used by the router (deterministic tests).
 */
export function createCommandService({ ctx, now = () => Date.now() }) {
  const bridge = createSessionBridge({
    // A missing service is a Host condition, not a caller mistake: 503 like the
    // other unavailable-service paths, instead of the bridge's generic Error.
    getController: () => {
      const controller = typeof ctx?.get === 'function' ? ctx.get('sessionController') : undefined
      if (controller === undefined || controller === null) {
        throw httpError(503, 'unavailable', 'session controller is unavailable in this profile')
      }
      return controller
    },
    getArchivedIds: () => {
      const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined
      const ids = registry?.archivedSessionIds
      return Array.isArray(ids) ? ids : []
    },
  })

  /**
   * Normalize a `pending` reply exactly like the original `/plan` handler: only
   * objects carrying a string `sessionId` survive, announced titles are reused,
   * and each candidate gets score 1 (they were already ranked).
   * @param {unknown} pending
   */
  function pendingCandidates(pending) {
    if (!Array.isArray(pending)) return []
    return pending
      .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.sessionId === 'string')
      .map((entry) => ({
        sessionId: entry.sessionId,
        title: typeof entry.title === 'string' ? entry.title : '',
        score: 1,
      }))
  }

  /**
   * Decide where an utterance should go. Mirrors the original `/plan` handler:
   * an answer to an earlier `ask` is resolved against the announced candidates
   * first, otherwise the pure router sees the Session list.
   * @param {PlanPayload} payload
   * @returns {Promise<{ ok: true, plan: any, confirmation: string }>}
   */
  async function plan(payload = {}) {
    const utterance = typeof payload?.utterance === 'string' ? payload.utterance : ''
    if (utterance.trim() === '') throw httpError(400, 'invalid', 'utterance is required')

    const sessions = await bridge.list()
    const pending = pendingCandidates(payload?.pending)
    if (pending.length > 0) {
      const ordinal = resolveOrdinal(utterance, pending)
      if (ordinal !== null) {
        const plan = {
          action: ordinal.action,
          sessionId: ordinal.sessionId,
          candidates: pending,
          confidence: 0.95,
          reason: ordinal.reason,
          text: utterance,
        }
        return { ok: true, plan, confirmation: spokenConfirmation(plan) }
      }
    }

    const plan = planRoute({
      utterance,
      sessions,
      currentSessionId: typeof payload?.currentSessionId === 'string' ? payload.currentSessionId : undefined,
      archivedIds: bridge.archivedIds(),
      cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
      now: now(),
    })
    return { ok: true, plan, confirmation: spokenConfirmation(plan) }
  }

  /**
   * Deliver a planned action. Mirrors the original `/dispatch` handler's action
   * branches; a prompt additionally checks that the Session exists so a typo
   * surfaces as 404 instead of a Host-side 500.
   * @param {SendPayload} payload
   * @returns {Promise<{ ok: true, action: 'prompt' | 'new', sessionId: string, text: string } | { ok: true, action: 'cancel' }>}
   */
  async function send(payload = {}) {
    const action = payload?.action
    if (action !== 'prompt' && action !== 'new' && action !== 'cancel') {
      throw httpError(400, 'invalid', 'action must be prompt, new or cancel')
    }

    if (action === 'cancel') {
      await bridge.cancel({ sessionId: String(payload?.sessionId ?? '') })
      return { ok: true, action: 'cancel' }
    }

    const text = typeof payload?.text === 'string' ? payload.text : ''
    if (text.trim() === '') throw httpError(400, 'invalid', 'text is required')

    if (action === 'new') {
      const created = await bridge.createAndPrompt({
        text,
        cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
      })
      return { ok: true, action: 'new', sessionId: created.sessionId, text }
    }

    const sessionId = String(payload?.sessionId ?? '')
    if (sessionId.trim() === '') throw httpError(404, 'not-found', 'session not found: sessionId is required')
    const sessions = await bridge.list()
    if (!sessions.some((session) => session.sessionId === sessionId)) {
      throw httpError(404, 'not-found', `session "${sessionId}" not found`)
    }

    const mode = payload?.mode === 'steer' ? 'steer' : 'queue'
    await bridge.prompt({ sessionId, text, mode })
    return { ok: true, action: 'prompt', sessionId, text }
  }

  return { plan, send }
}
