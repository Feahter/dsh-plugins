/**
 * dsh-voice-control — Host half.
 *
 * Responsibilities kept on this side of the fence:
 *   - the DeepSeek API key (it lives in ~/.deepseek/config.toml, never in a page)
 *   - speech synthesis through /v1/tools/tts
 *   - Session listing / addressing / creation via ctx.sessionController
 *   - the routing rules, so they can be unit-tested without a browser
 *
 * The browser half talks to these four routes over same-origin fetch, the same
 * way the realtime-voice plugin already does on this profile.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { classifyError, getRoute, jsonRoute } from './host/http.js'
import { planRoute, resolveOrdinal, spokenConfirmation } from './host/router.js'
import { createSessionBridge } from './host/sessions.js'
import { createSpeechSynthesizer, readApiKeyFromConfig, VOICES } from './host/tts.js'

export const name = 'dsh-voice-control'

/** Route prefix. Must match the client half. */
export const ROUTE_PREFIX = '/api/voice-control'

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.toml')

/** Re-reading the TOML on every utterance is wasteful; a minute is plenty. */
const CONFIG_TTL_MS = 60_000

/**
 * @param {object} ctx  Cordis context of the Host process.
 */
export function apply(ctx) {
  const logger = ctx.logger ?? console

  /** @type {{ value?: string, readAt: number }} */
  const keyCache = {}

  async function getApiKey() {
    const now = Date.now()
    if (keyCache.value !== undefined && now - keyCache.readAt < CONFIG_TTL_MS) return keyCache.value
    let text = ''
    try {
      text = await readFile(CONFIG_PATH, 'utf8')
    } catch {
      text = ''
    }
    const key = readApiKeyFromConfig(text)
    keyCache.value = key
    keyCache.readAt = now
    return key
  }

  const synthesizer = createSpeechSynthesizer({ getApiKey, logger })

  const bridge = createSessionBridge({
    getController: () => ctx.get('sessionController'),
    getArchivedIds: () => {
      const registry = ctx.get('workspaceRegistry')
      const ids = registry?.archivedSessionIds
      return Array.isArray(ids) ? ids : []
    },
  })

  function asrProviderIds() {
    const service = ctx.get('speechToText')
    if (service === undefined || service === null) return []
    try {
      const providers = service.listProviders?.()
      const list = Array.isArray(providers) ? providers : providers?.items
      if (!Array.isArray(list)) return []
      return list.map((entry) => (typeof entry === 'string' ? entry : entry?.id ?? entry?.providerId)).filter(Boolean)
    } catch (error) {
      logger.warn?.('voice-control: could not list speech providers', error)
      return []
    }
  }

  ctx.inject(['webServer'], (serverCtx) => {
    serverCtx.effect(() => {
      const server = serverCtx.webServer
      const origin = () => {
        try {
          return serverCtx.webServer.getOrigin()
        } catch {
          return undefined
        }
      }
      const disposers = []

      disposers.push(server.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/health`,
        handler: getRoute(async () => {
          let sessionCount
          let sessionError
          try {
            sessionCount = (await bridge.list()).length
          } catch (error) {
            sessionError = error instanceof Error ? error.message : String(error)
          }
          return {
            body: {
              ok: true,
              version: '0.1.0',
              tts: { voices: [...VOICES], apiKeyConfigured: (await getApiKey()) !== undefined },
              asr: { providers: asrProviderIds() },
              sessions: { available: sessionError === undefined, count: sessionCount, error: sessionError },
            },
          }
        }),
      }))

      disposers.push(server.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/transcribe`,
        handler: jsonRoute({
          getOrigin: origin,
          handle: async (payload) => {
            const audioBase64 = typeof payload?.audioBase64 === 'string' ? payload.audioBase64 : ''
            if (audioBase64 === '') {
              return { status: 400, body: { ok: false, error: 'audioBase64 is required' } }
            }
            const service = ctx.get('speechToText')
            if (service === undefined || service === null) {
              return { status: 503, body: { ok: false, error: 'speech-to-text service is unavailable' } }
            }
            const available = asrProviderIds()
            if (available.length === 0) {
              return { status: 503, body: { ok: false, error: 'no speech provider is registered' } }
            }
            const providerId = typeof payload?.providerId === 'string' && payload.providerId !== ''
              ? payload.providerId
              : available[0]
            try {
              await Promise.resolve(service.prepare?.(providerId)).catch(() => {})
              const spec = service.resolve({ audio: Buffer.from(audioBase64, 'base64'), providerId })
              const result = await service.transcribe(spec, AbortSignal.timeout(60000))
              const text = typeof result?.text === 'string' ? result.text : ''
              return {
                body: {
                  ok: true,
                  text,
                  providerId,
                  audioSeconds: typeof result?.audioSeconds === 'number' ? result.audioSeconds : undefined,
                  inferenceSeconds: typeof result?.inferenceSeconds === 'number' ? result.inferenceSeconds : undefined,
                },
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              logger.warn?.('voice-control: transcription failed', message)
              const failure = classifyError(error)
              return failure.status === 500
                ? { status: 502, body: { ok: false, code: 'upstream-failed', message } }
                : { status: failure.status, body: { ok: false, code: failure.code, message: failure.message } }
            }
          },
        }),
      }))

      disposers.push(server.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/plan`,
        handler: jsonRoute({
          getOrigin: origin,
          handle: async (payload) => {
            const utterance = typeof payload?.utterance === 'string' ? payload.utterance : ''
            if (utterance.trim() === '') {
              return { status: 400, body: { ok: false, code: 'invalid', message: 'utterance is required' } }
            }
            const sessions = await bridge.list()
            // A reply to an earlier `ask`: "第一个" / "新开" is meaningless to the
            // title matcher, so resolve it against the candidates we announced.
            const pending = Array.isArray(payload?.pending)
              ? payload.pending
                  .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.sessionId === 'string')
                  .map((entry) => ({ sessionId: entry.sessionId, title: typeof entry.title === 'string' ? entry.title : '', score: 1 }))
              : []
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
                return { body: { ok: true, plan, confirmation: spokenConfirmation(plan) } }
              }
            }
            const plan = planRoute({
              utterance,
              sessions,
              currentSessionId: typeof payload?.currentSessionId === 'string' ? payload.currentSessionId : undefined,
              archivedIds: bridge.archivedIds(),
              cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
              now: Date.now(),
            })
            return { body: { ok: true, plan, confirmation: spokenConfirmation(plan) } }
          },
        }),
      }))

      disposers.push(server.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/dispatch`,
        handler: jsonRoute({
          getOrigin: origin,
          handle: async (payload) => {
            const action = payload?.action
            const text = typeof payload?.text === 'string' ? payload.text : ''
            const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
            if (action !== 'cancel' && text.trim() === '') {
              return { status: 400, body: { ok: false, code: 'invalid', message: 'text is required' } }
            }
            if (action === 'new') {
              const created = await bridge.createAndPrompt({
                text,
                cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined,
              })
              return { body: { ok: true, ...created } }
            }
            if (action === 'cancel') {
              // A missing target is a parameter error; letting the bridge throw
              // its plain Error turned this into a 500 Host failure.
              if (sessionId === '') {
                return { status: 400, body: { ok: false, code: 'invalid', message: 'sessionId is required' } }
              }
              const result = await bridge.cancel({ sessionId })
              return { body: { ok: true, ...result } }
            }
            if (action !== 'prompt') {
              return { status: 400, body: { ok: false, code: 'invalid', message: 'action must be prompt, new or cancel' } }
            }
            if (sessionId === '') {
              return { status: 400, body: { ok: false, code: 'invalid', message: 'sessionId is required' } }
            }
            const mode = payload?.mode === 'steer' ? 'steer' : 'queue'
            const result = await bridge.prompt({ sessionId, text, mode })
            return { body: { ok: true, ...result } }
          },
        }),
      }))

      disposers.push(server.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/speak`,
        handler: jsonRoute({
          getOrigin: origin,
          handle: async (payload) => {
            const text = typeof payload?.text === 'string' ? payload.text : ''
            if (text.trim() === '') {
              return { status: 400, body: { ok: false, code: 'invalid', message: 'text is required' } }
            }
            const voiceId = typeof payload?.voiceId === 'string' ? payload.voiceId : 'stella'
            const result = await synthesizer.speak(text, { voiceId })
            return {
              body: {
                ok: true,
                audioBase64: result.wav.toString('base64'),
                mimeType: 'audio/wav',
                durationMs: result.durationMs,
                voiceId: result.voiceId,
                cached: result.cached,
              },
            }
          },
        }),
      }))

      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* already gone */
          }
        }
      }
    }, 'voice-control routes')
  })
}
