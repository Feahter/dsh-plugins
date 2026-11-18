/**
 * Host half of the realtime-voice bundle.
 *
 * Speech recognition stays a Client concern (the browser captures audio and
 * calls the existing `speech/transcribe` Host Remote). This half only exposes
 * three local HTTP routes under the web server origin:
 *
 *   GET  /plugins/realtime-voice/health   — capability probe
 *   POST /plugins/realtime-voice/refine   — translate (and, when wired, cleanup)
 *   GET  /plugins/realtime-voice/version  — this plugin's own release check
 *
 * Both routes are registered through `ctx.inject(['webServer'], ...)`, so a
 * build without a web server simply never mounts them instead of failing the
 * plugin tree. Translation prefers the opt-in Host `translator` service and
 * falls back to Google's anonymous endpoint when that service is absent, so the
 * feature works on a stock profile without installing anything; the client can
 * still opt out per machine (settings → 在线翻译).
 */
import { createHealthHandler, createRefineHandler, ROUTES } from './host/refine.js'
import { createVersionChecker, createVersionRoute } from './version-check.js'

/** No prefix dispatcher here: the version probe is its own exact route. */
export const VERSION_ROUTE = '/plugins/realtime-voice/version'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const versionChecker = createVersionChecker({ pluginName: 'dsh-realtime-voice' })
  ctx.inject(['webServer'], (ctx) => {
    ctx.effect(() => {
      const health = ctx.webServer.register({
        kind: 'exact',
        path: ROUTES.health,
        handler: createHealthHandler({
          getTranslator: () => ctx.get('translator'),
        }),
      })
      const refine = ctx.webServer.register({
        kind: 'exact',
        path: ROUTES.refine,
        handler: createRefineHandler({
          getTranslator: () => ctx.get('translator'),
          getServerOrigin: () => {
            try {
              return ctx.webServer.getOrigin()
            } catch {
              return undefined
            }
          },
          logger: ctx.logger,
        }),
      })
      const version = ctx.webServer.register({
        kind: 'exact',
        path: VERSION_ROUTE,
        handler: createVersionRoute({
          checker: versionChecker,
          getConnection: () => ctx.get('connection'),
        }),
      })
      return () => {
        refine()
        health()
        version()
      }
    }, 'realtime-voice: HTTP routes')
  })
}
