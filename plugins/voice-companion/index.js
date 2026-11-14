/**
 * voice-companion — Host half.
 *
 * Every voice surface the assistant has lives here: the persona phone call
 * (health, turn, sentence TTS, event queue), the push-to-talk command lane
 * (plan, send) and the local transcription fallback (transcribe). The browser
 * half owns microphone capture and playback; this half never touches audio
 * devices.
 *
 * Routes are same-origin siblings under /api/voice-companion so the bundled
 * client can reach all of them with one prefix.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { getRoute, httpError, jsonRoute } from './host/http.js'
import { createBrain, splitSentences } from './host/persona.js'
import { createSentenceSpeaker, VOICES } from './host/tts.js'
import { createTaskBoard } from './host/tasks.js'
import { createCommandService } from './host/command.js'
import { CHARACTER_VOICES, selectVoice, selectVoices, voiceCatalog } from './host/voice.js'
import { DEFAULT_CHARACTER, listCharacters, resolveCharacter } from './src/client/characters.js'

export const name = 'voice-companion'
export const ROUTE_PREFIX = '/api/voice-companion'
export const VERSION = '0.2.0'

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.toml')
const CONFIG_TTL_MS = 60_000
const TITLES_TTL_MS = 5_000

/**
 * Read `api_key` from a config.toml. `[providers.deepseek]` wins over the
 * top-level key, matching the rest of the Host's provider resolution.
 * @param {string} text
 * @returns {string | undefined}
 */
export function parseApiKey(text) {
  let topLevel
  let provider
  let section = ''
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim().replace(/["']/g, '')
      continue
    }
    const match = /^api_key\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line)
    if (match === null) continue
    const value = match[1].trim()
    if (value === '') continue
    if (section === '') topLevel = value
    else if (section === 'providers.deepseek') provider = value
  }
  return provider ?? topLevel
}

/**
 * @param {string} configPath
 * @returns {Promise<string | undefined>}
 */
async function readApiKey(configPath) {
  try {
    return parseApiKey(await readFile(configPath, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 60 s cache around the config file. A missing key is cached too: /health is
 * polled by the client, and re-reading the file every 1.5 s is pointless.
 * @param {string} configPath
 */
function createApiKeyReader(configPath) {
  let cachedAt = 0
  let cachedValue
  return async function getApiKey() {
    const current = Date.now()
    if (cachedAt !== 0 && current - cachedAt < CONFIG_TTL_MS) return cachedValue
    cachedValue = await readApiKey(configPath)
    cachedAt = current
    return cachedValue
  }
}

/**
 * @param {any} ctx
 * @returns {string[]}
 */
function asrProviderIds(ctx) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('speechToText') : undefined
    const listed = typeof service?.listProviders === 'function' ? service.listProviders() : []
    const items = Array.isArray(listed) ? listed : Array.isArray(listed?.items) ? listed.items : []
    const ids = items
      .map((item) => (typeof item === 'string' ? item : item?.id ?? item?.providerId))
      .filter((id) => typeof id === 'string' && id !== '')
    return [...new Set(ids)].slice(0, 20)
  } catch {
    return []
  }
}

/**
 * @param {any} row
 * @returns {string}
 */
function sessionTitle(row) {
  if (row === null || typeof row !== 'object') return ''
  if (typeof row.title === 'string' && row.title.trim() !== '') return row.title.trim()
  const projected = row.projections?.values?.title
  return typeof projected === 'string' ? projected.trim() : ''
}

/**
 * Session titles give the persona a little memory of what the boss has been
 * doing. Kept best-effort and cached: a broken title projection must never
 * break the phone call.
 * @param {any} ctx
 */
function createTitleLister(ctx) {
  let cachedAt = 0
  /** @type {string[]} */
  let cached = []
  return async function listTitles() {
    const current = Date.now()
    if (cachedAt !== 0 && current - cachedAt < TITLES_TTL_MS) return cached
    const controller = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined
    if (controller === null || typeof controller !== 'object' || typeof controller.list !== 'function') {
      return []
    }
    try {
      const result = await controller.list({})
      const items = Array.isArray(result?.items) ? result.items : []
      cached = items.map(sessionTitle).filter((title) => title !== '').slice(0, 12)
      cachedAt = current
      return cached
    } catch {
      return []
    }
  }
}

/**
 * @param {any} ctx
 * @param {object} [options] Test seams; Cordis calls `apply(ctx)` with no options.
 */
export function apply(ctx, options = {}) {
  const logger = ctx.logger ?? console
  const configPath = typeof options.configPath === 'string' ? options.configPath : CONFIG_PATH
  const getApiKey = typeof options.getApiKey === 'function' ? options.getApiKey : createApiKeyReader(configPath)
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  const brain = createBrain({
    fetchImpl,
    apiKey: getApiKey,
    model: options.model,
    baseUrl: options.baseUrl,
  })
  const speaker = createSentenceSpeaker({
    apiKey: getApiKey,
    baseUrl: options.baseUrl,
    fetchImpl,
  })
  const board = createTaskBoard({ ctx, now })
  const commands = createCommandService({ ctx, now })
  const listTitles = createTitleLister(ctx)

  /**
   * Which voice speaks which sentence. The Host decides so every client (panel,
   * hotkey, future surfaces) hears the same voice; an explicit `voiceId` from
   * the caller still wins.
   * @param {string[]} sentences
   * @param {any} payload
   */
  function planVoices(sentences, payload) {
    const requested = typeof payload?.voiceId === 'string' ? payload.voiceId.trim() : ''
    if (requested !== '') return sentences.map(() => requested)
    return selectVoices({
      character: payload?.character,
      sentences,
      mode: payload?.voiceMode,
      available: VOICES,
    })
  }

  /** @param {any} payload */
  async function handleTurn(payload) {
    const utterance = typeof payload.utterance === 'string' ? payload.utterance.trim() : ''
    if (utterance === '') throw httpError(400, 'invalid', 'utterance 不能为空')
    if (
      payload.sessionId !== undefined &&
      payload.sessionId !== null &&
      (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '')
    ) {
      throw httpError(400, 'invalid', 'sessionId 必须是非空字符串')
    }
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : undefined
    const history = Array.isArray(payload.history) ? payload.history : []
    const sessionTitles = await listTitles()

    const decision = await brain.decide({ utterance, history, sessionTitles })
    const sentences = splitSentences(decision.say)
    const say = sentences.length > 0 ? sentences : [decision.say || '嗯，我在。']

    let task = null
    let kind = 'chat'
    if (decision.task !== null) {
      const dispatched = await board.dispatch({
        text: decision.task.text,
        sessionId,
        title: decision.task.title,
      })
      task = {
        taskId: dispatched.taskId,
        sessionId: dispatched.sessionId,
        title: dispatched.title,
        text: decision.task.text,
      }
      kind = 'task'
    }

    return { body: { ok: true, reply: decision.say, say, voices: planVoices(say, payload), task, kind } }
  }

  /** @param {any} payload */
  async function handleSpeak(payload) {
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (text === '') throw httpError(400, 'invalid', 'text 不能为空')
    let requestedVoice =
      typeof payload.voiceId === 'string' && payload.voiceId.trim() !== ''
        ? payload.voiceId.trim()
        : ''
    if (requestedVoice === '') {
      requestedVoice = selectVoice({
        character: payload.character,
        text,
        index: payload.index,
        total: payload.total,
        mode: payload.voiceMode,
        available: VOICES,
      })
    }
    const result = await speaker.speak(text, { voiceId: requestedVoice })
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
  }

  /**
   * Push-to-talk routing: which Session should this utterance reach, and how.
   * @param {any} payload
   */
  async function handlePlan(payload) {
    return { body: await commands.plan(payload) }
  }

  /** @param {any} payload */
  async function handleSend(payload) {
    return { body: await commands.send(payload) }
  }

  /**
   * The cast the browser half can render, plus the voice each one prefers. The
   * client uses this to draw the picker without hardcoding names.
   */
  async function handleCharacters() {
    return {
      body: {
        ok: true,
        defaultCharacter: DEFAULT_CHARACTER,
        characters: listCharacters().map((entry) => ({
          ...entry,
          voice: CHARACTER_VOICES[entry.id]?.base ?? entry.voice,
        })),
        voices: voiceCatalog(),
      },
    }
  }

  /** @param {any} payload */
  async function handleDispatch(payload) {
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (text === '') throw httpError(400, 'invalid', 'text 不能为空')
    if (
      payload.sessionId !== undefined &&
      payload.sessionId !== null &&
      (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '')
    ) {
      throw httpError(400, 'invalid', 'sessionId 必须是非空字符串')
    }
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : undefined
    const title = typeof payload.title === 'string' ? payload.title.trim() : undefined
    const dispatched = await board.dispatch({ text, sessionId, title })
    return { body: { ok: true, taskId: dispatched.taskId, sessionId: dispatched.sessionId } }
  }

  /** @param {import('node:http').IncomingMessage} request */
  async function handleEvents(request) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const raw = url.searchParams.get('since')
    let since = 0
    if (raw !== null && raw !== '') {
      if (!/^\d+$/.test(raw)) throw httpError(400, 'invalid', 'since 必须是非负整数')
      since = Number(raw)
      if (!Number.isSafeInteger(since)) throw httpError(400, 'invalid', 'since 超出范围')
    }
    const { events, cursor } = board.poll(since)
    return {
      body: {
        ok: true,
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          text: event.text,
          summary: event.summary,
          sessionId: event.sessionId,
          title: event.title,
        })),
        cursor,
      },
    }
  }

  /**
   * Local speech recognition for the browser half's fallback path: when the
   * speech Remote is unavailable the client posts base64 WAV here instead.
   * @param {any} payload
   */
  async function handleTranscribe(payload) {
    const audioBase64 = typeof payload.audioBase64 === 'string' ? payload.audioBase64 : ''
    if (audioBase64 === '') throw httpError(400, 'invalid', 'audioBase64 不能为空')
    const service = typeof ctx.get === 'function' ? ctx.get('speechToText') : undefined
    if (!service) throw httpError(503, 'unavailable', '语音识别服务不可用')
    const providerId =
      typeof payload.providerId === 'string' && payload.providerId !== ''
        ? payload.providerId
        : asrProviderIds(ctx)[0]
    if (!providerId) throw httpError(503, 'unavailable', '没有可用的语音识别 provider')
    try {
      await Promise.resolve(service.prepare(providerId)).catch(() => {})
      const spec = await service.resolve({ audio: Buffer.from(audioBase64, 'base64'), providerId })
      const text = await service.transcribe?.(spec, AbortSignal.timeout(60_000))
      return {
        body: {
          ok: true,
          text: typeof text === 'string' ? text : String(text?.text ?? ''),
          providerId,
        },
      }
    } catch (error) {
      throw httpError(502, 'upstream-failed', error instanceof Error ? error.message : String(error))
    }
  }

  async function handleHealth() {
    const key = await getApiKey()
    return {
      body: {
        ok: true,
        version: VERSION,
        character: DEFAULT_CHARACTER,
        characters: listCharacters().map((entry) => entry.id),
        tts: {
          voices: [...VOICES],
          catalog: voiceCatalog(),
          apiKeyConfigured: typeof key === 'string' && key.trim() !== '',
        },
        asr: { providers: asrProviderIds(ctx) },
        tasks: { tracked: board.tracked },
        commands: {
          sessions:
            typeof ctx.get === 'function' &&
            ctx.get('sessionController') !== undefined &&
            ctx.get('sessionController') !== null,
        },
      },
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
      const stopWatch = board.watch()
      /** @type {Array<() => void>} */
      const disposers = []
      const register = (suffix, handler) => {
        const off = server.register({ kind: 'exact', path: `${ROUTE_PREFIX}${suffix}`, handler })
        if (typeof off === 'function') disposers.push(off)
        else if (typeof off?.dispose === 'function') disposers.push(() => off.dispose())
      }

      register('/health', getRoute(handleHealth))
      register('/turn', jsonRoute({ handle: handleTurn, getOrigin: origin }))
      register('/speak', jsonRoute({ handle: handleSpeak, getOrigin: origin }))
      register('/dispatch', jsonRoute({ handle: handleDispatch, getOrigin: origin }))
      register('/events', getRoute(handleEvents))
      register('/transcribe', jsonRoute({ handle: handleTranscribe, getOrigin: origin }))
      register('/plan', jsonRoute({ handle: handlePlan, getOrigin: origin }))
      register('/send', jsonRoute({ handle: handleSend, getOrigin: origin }))
      register('/characters', getRoute(handleCharacters))

      logger.info?.('[voice-companion] routes registered')
      return () => {
        try {
          stopWatch?.()
        } catch {
          // best effort
        }
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // best effort
          }
        }
      }
    }, 'voice-companion routes')
  })
}
