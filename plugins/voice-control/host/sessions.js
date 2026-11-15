/**
 * Host bridge from voice decisions to actual Sessions.
 *
 * Everything here goes through `ctx.sessionController`, the Host service
 * `dsh-api-session-controller` provides:
 *
 *   list({})                       → { items }        (cold-safe, never resumes an Agent)
 *   create({ cwd } | { workspaceId })
 *   prompt({ sessionId, requestId, mode, content: [{ type: 'text', text }] }, signal)
 *
 * `prompt` resolves or resumes the addressed Session itself, so a cold Session
 * accepts a spoken instruction without the user switching to it first.
 */

/** Admission deadline for one prompt call. */
const PROMPT_TIMEOUT_MS = 20_000

/**
 * Read the display title of one Session list row.
 *
 * `sessionController.list()` carries no top-level `title`: the title is the
 * `title` Session projection, delivered as a bare string inside
 * `row.projections.values` (see `@deepseek-ai/dsh-session-title`, whose view
 * schema is `string().min(1).nullable()`). A top-level `row.title` is still
 * honoured for callers that hand us an already-normalized row.
 * @param {any} row
 * @returns {string}
 */
export function readTitle(row) {
  if (row === null || typeof row !== 'object') return ''
  if (typeof row.title === 'string' && row.title.length > 0) return row.title
  const values = row.projections !== null && typeof row.projections === 'object' ? row.projections.values : undefined
  const projected = values !== null && typeof values === 'object' ? values.title : undefined
  return typeof projected === 'string' ? projected : ''
}

/**
 * Extract the fields the router needs from a Session list row.
 * @param {any} row
 * @returns {import('./router.js').SessionRow}
 */
export function toSessionRow(row) {
  return {
    sessionId: String(row.sessionId),
    title: readTitle(row),
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    blank: row.blank === true,
    running: row.running === true,
    cwd: typeof row.cwd === 'string' ? row.cwd : undefined,
  }
}

/**
 * @param {object} options
 * @param {() => any} options.getController  Returns `ctx.sessionController` or undefined.
 * @param {() => string[]} [options.getArchivedIds]
 */
export function createSessionBridge({ getController, getArchivedIds = () => [] }) {
  function controller() {
    const found = getController()
    if (found === undefined || found === null) {
      throw new Error('session controller is unavailable in this profile')
    }
    return found
  }

  return {
    /** @returns {Promise<import('./router.js').SessionRow[]>} */
    async list() {
      const result = await controller().list({})
      const items = Array.isArray(result?.items) ? result.items : []
      return items.map(toSessionRow)
    },

    /** @returns {string[]} */
    archivedIds() {
      const ids = getArchivedIds()
      return Array.isArray(ids) ? ids : []
    },

    /**
     * Create a Session and optionally send the first instruction into it.
     * @param {{ text?: string, cwd?: string }} options
     * @returns {Promise<{ sessionId: string, accepted: boolean }>}
     */
    async createAndPrompt({ text, cwd }) {
      const created = await controller().create(cwd === undefined ? {} : { cwd })
      const sessionId = String(created.sessionId)
      if (text === undefined || text.trim() === '') return { sessionId, accepted: false }
      await this.prompt({ sessionId, text })
      return { sessionId, accepted: true }
    },

    /**
     * Deliver one instruction to an addressed Session.
     * @param {{ sessionId: string, text: string, mode?: 'queue' | 'steer' }} options
     * @returns {Promise<{ sessionId: string, accepted: boolean }>}
     */
    async prompt({ sessionId, text, mode = 'queue' }) {
      if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId is required')
      if (typeof text !== 'string' || text.trim() === '') throw new Error('text is required')
      const requestId = globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const acknowledgement = await controller().prompt(
        {
          sessionId,
          requestId,
          mode,
          content: [{ type: 'text', text }],
        },
        AbortSignal.timeout(PROMPT_TIMEOUT_MS),
      )
      return { sessionId, accepted: acknowledgement?.accepted === true }
    },

    /**
     * Stop the active turn without dropping the pending inbox.
     * @param {{ sessionId: string }} options
     */
    async cancel({ sessionId }) {
      if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId is required')
      const acknowledgement = await controller().cancel({ sessionId })
      return { sessionId, accepted: acknowledgement?.accepted === true }
    },
  }
}
