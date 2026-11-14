/**
 * Sentence-level TTS with a tiny in-memory cache.
 *
 * The client asks for one sentence at a time and immediately starts playing it
 * while requesting the next one. Repeats ("嗯", "好呀") are extremely common in
 * a phone call, so caching by sentence is worth it; concurrent calls for the
 * same sentence must not fan out into duplicate upstream requests.
 *
 * This module is self-contained on purpose: the voice-companion plugin must not
 * import from the voice-control plugin.
 */

export const VOICES = ['stella', 'tide']
export const DEFAULT_VOICE = 'stella'
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

const BYTES_PER_SECOND = 24_000 * 2 // 24 kHz, 16-bit mono PCM
const TTS_PATH = '/v1/tools/tts'
const TTS_TIMEOUT_MS = 30_000

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function ttsError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

/**
 * Rewrite the RIFF and data chunk sizes so browsers accept the clip.
 *
 * The upstream service streams PCM WAV with placeholder sizes; without this,
 * `<audio>` may refuse to play or report a bogus duration.
 * @param {Buffer} wav
 * @returns {Buffer}
 */
export function patchWavHeader(wav) {
  if (
    wav.length >= 44 &&
    wav.toString('ascii', 0, 4) === 'RIFF' &&
    wav.toString('ascii', 8, 12) === 'WAVE' &&
    wav.toString('ascii', 36, 40) === 'data'
  ) {
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.writeUInt32LE(wav.length - 44, 40)
  }
  return wav
}

/**
 * @param {Buffer} wav
 * @returns {number}
 */
export function wavDurationMs(wav) {
  const dataBytes = Math.max(0, wav.length - 44)
  return Math.round((dataBytes / BYTES_PER_SECOND) * 1000)
}

/**
 * @param {object} options
 * @param {string | (() => string | Promise<string | undefined> | undefined)} [options.apiKey]
 * @param {string} [options.baseUrl]
 * @param {string} [options.voiceId]
 * @param {number} [options.maxEntries]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createSentenceSpeaker({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  voiceId = DEFAULT_VOICE,
  maxEntries = 64,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createSentenceSpeaker needs a fetch implementation')

  const cacheLimit = Number.isFinite(maxEntries) && maxEntries >= 1 ? Math.floor(maxEntries) : 64
  /** @type {Map<string, { wav: Buffer, durationMs: number, voiceId: string }>} */
  const cache = new Map()
  /** @type {Map<string, Promise<{ wav: Buffer, durationMs: number, voiceId: string }>>} */
  const inflight = new Map()

  async function readKey() {
    const value = typeof apiKey === 'function' ? await apiKey() : apiKey
    return typeof value === 'string' ? value.trim() : ''
  }

  async function synthesize(text, voice) {
    const key = await readKey()
    if (key === '') throw ttsError(503, 'service-missing', '没有配置 DeepSeek API key')

    const url = `${String(baseUrl).replace(/\/+$/, '')}${TTS_PATH}`
    let response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ text, voice_id: voice, format: 'wav' }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw ttsError(502, 'upstream', `连不上语音服务：${detail}`)
    }

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        detail = ''
      }
      throw ttsError(502, 'upstream', `语音服务返回 HTTP ${response.status}${detail === '' ? '' : `：${detail}`}`)
    }

    const contentType = response.headers?.get?.('content-type') ?? ''
    if (/application\/json/i.test(contentType)) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        detail = ''
      }
      throw ttsError(502, 'upstream', `语音服务返回了错误：${detail || 'unknown error'}`)
    }

    let bytes
    try {
      bytes = Buffer.from(await response.arrayBuffer())
    } catch {
      throw ttsError(502, 'upstream', '语音服务的响应读取失败')
    }
    if (bytes.length <= 44) throw ttsError(502, 'upstream', 'synthesis returned no audio')

    const wav = patchWavHeader(bytes)
    return { wav, durationMs: wavDurationMs(wav), voiceId: voice }
  }

  return {
    voices: [...VOICES],
    defaultVoice: voiceId || DEFAULT_VOICE,

    /**
     * @param {unknown} text
     * @param {{ voiceId?: string }} [options]
     * @returns {Promise<{ wav: Buffer, durationMs: number, cached: boolean, voiceId: string }>}
     */
    async speak(text, options = {}) {
      const sentence = typeof text === 'string' ? text.trim() : ''
      if (sentence === '') throw ttsError(400, 'invalid', 'text 不能为空')
      const voice =
        typeof options.voiceId === 'string' && options.voiceId.trim() !== ''
          ? options.voiceId.trim()
          : voiceId || DEFAULT_VOICE
      const key = `${voice}\u0000${sentence}`

      const hit = cache.get(key)
      if (hit !== undefined) {
        // Refresh insertion order so the hottest sentences survive eviction.
        cache.delete(key)
        cache.set(key, hit)
        return { wav: hit.wav, durationMs: hit.durationMs, cached: true, voiceId: hit.voiceId }
      }

      const pending = inflight.get(key)
      if (pending !== undefined) {
        const result = await pending
        return { wav: result.wav, durationMs: result.durationMs, cached: true, voiceId: result.voiceId }
      }

      const promise = synthesize(sentence, voice)
      inflight.set(key, promise)
      try {
        const result = await promise
        cache.set(key, result)
        while (cache.size > cacheLimit) {
          const oldest = cache.keys().next().value
          if (oldest === undefined) break
          cache.delete(oldest)
        }
        return { wav: result.wav, durationMs: result.durationMs, cached: false, voiceId: result.voiceId }
      } finally {
        inflight.delete(key)
      }
    },
  }
}
