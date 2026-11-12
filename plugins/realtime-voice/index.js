/**
 * Host half of the realtime-voice bundle.
 *
 * Speech recognition stays a Client concern (the browser captures audio and
 * calls the existing `speech/transcribe` Host Remote). This half only exposes
 * two local HTTP routes under the web server origin:
 *
 *   GET  /plugins/realtime-voice/health  — capability probe
 *   POST /plugins/realtime-voice/refine  — translate (and, when wired, cleanup)
 *
 * Both routes are registered through `ctx.inject(['webServer'], ...)`, so a
 * build without a web server simply never mounts them instead of failing the
 * plugin tree. Translation prefers the opt-in Host `translator` service and
 * falls back to Google's anonymous endpoint when that service is absent, so the
 * feature works on a stock profile without installing anything; the client can
 * still opt out per machine (settings → 在线翻译).
 */
import { createHealthHandler, createRefineHandler, ROUTES } from './host/refine.js'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
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
      return () => {
        refine()
        health()
      }
    }, 'realtime-voice: HTTP routes')
  })
}
