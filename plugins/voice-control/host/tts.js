/**
 * Server-side speech synthesis through the DeepSeek tools endpoint.
 *
 * Why the Host and not the browser: the API key already lives in
 * `~/.deepseek/config.toml` on this machine, and a browser `fetch` to
 * `api.deepseek.com` would need CORS plus a copy of the key in the page. The
 * Host proxying it keeps the key where it belongs.
 *
 * The endpoint streams a WAV whose RIFF/data size fields are zero (measured
 * 2026-11-13: a 6.4 s clip came back as 309164 bytes with `size=0`). Those
 * lengths are rewritten here so `decodeAudioData` and every media player accept
 * the buffer.
 */

export const TTS_ENDPOINT = 'https://api.deepseek.com/v1/tools/tts'

/** 24 kHz, 16-bit, mono — the format the endpoint documents for `pcm` and returns for `wav`. */
export const BYTES_PER_SECOND = 24_000 * 2

/** Voices the endpoint accepts. */
export const VOICES = Object.freeze(['stella', 'tide'])

/** Billing counts at most this many characters per request. */
export const MAX_TEXT_CHARS = 10_000

/**
 * Rewrite the two size fields a streaming WAV leaves at zero.
 *
 * Only touches a canonical 44-byte `RIFF/WAVE/fmt /data` header; anything else
 * is returned unchanged so a future server-side format change cannot corrupt it.
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
export function patchWavHeader(buffer) {
  if (buffer.length < 44) return buffer
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return buffer
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return buffer
  if (buffer.toString('ascii', 36, 40) !== 'data') return buffer
  const patched = Buffer.from(buffer)
  patched.writeUInt32LE(patched.length - 8, 4)
  patched.writeUInt32LE(patched.length - 44, 40)
  return patched
}

/**
 * Duration of a 24 kHz 16-bit mono WAV body.
 * @param {Buffer} buffer
 * @returns {number} milliseconds
 */
export function wavDurationMs(buffer) {
  return Math.round(((buffer.length - 44) / BYTES_PER_SECOND) * 1000)
}

/**
 * Pull the DeepSeek API key out of the user's config file.
 *
 * Accepts a top-level `api_key` and a `[providers.deepseek] api_key` entry; the
 * provider-scoped value wins because that is the one the CLI writes last.
 * @param {string} text  Raw TOML.
 * @returns {string | undefined}
 */
export function readApiKeyFromConfig(text) {
  let topLevel
  let scoped
  let section = ''
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(trimmed)
    if (header !== null) {
      section = header[1].trim()
      continue
    }
    const pair = /^api_key\s*=\s*"([^"]*)"\s*$/.exec(trimmed)
    if (pair === null) continue
    const value = pair[1].trim()
    if (value === '') continue
    if (section === '') topLevel = value
    else if (section === 'providers.deepseek') scoped = value
  }
  return scoped ?? topLevel
}

/**
 * @param {object} options
 * @param {() => Promise<string | undefined>} options.getApiKey
 * @param {typeof fetch} [options.fetchImpl]
 * @param {{ warn?: (message: string, error?: unknown) => void }} [options.logger]
 * @param {number} [options.timeoutMs]
 */
export function createSpeechSynthesizer({ getApiKey, fetchImpl = fetch, logger, timeoutMs = 45_000 }) {
  const cache = new Map()
  const warn = typeof logger?.warn === 'function'
    ? (message, error) => { try { logger.warn(message, error) } catch { /* logging must never break a route */ } }
    : () => {}

  return {
    /**
     * @param {string} text
     * @param {{ voiceId?: string }} [options]
     * @returns {Promise<{ wav: Buffer, durationMs: number, voiceId: string, cached: boolean }>}
     */
    async speak(text, { voiceId = 'stella' } = {}) {
      const trimmed = String(text ?? '').trim()
      if (trimmed === '') throw new Error('text must not be empty')
      if (trimmed.length > MAX_TEXT_CHARS) throw new Error(`text exceeds ${MAX_TEXT_CHARS} characters`)
      const voice = VOICES.includes(voiceId) ? voiceId : 'stella'
      const key = `${voice}\u0000${trimmed}`
      const hit = cache.get(key)
      if (hit !== undefined) return { ...hit, cached: true }

      const apiKey = await getApiKey()
      if (apiKey === undefined || apiKey === '') throw new Error('no DeepSeek api_key in ~/.deepseek/config.toml')

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(TTS_ENDPOINT, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ text: trimmed, voice_id: voice, format: 'wav' }),
          signal: controller.signal,
        })
        const contentType = response.headers.get('content-type') ?? ''
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(`synthesis failed: HTTP ${response.status} ${detail.slice(0, 200)}`)
        }
        if (contentType.includes('json')) {
          const payload = await response.json().catch(() => null)
          throw new Error(`synthesis returned JSON instead of audio: ${JSON.stringify(payload).slice(0, 200)}`)
        }
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length <= 44) throw new Error('synthesis returned no audio')
        const wav = patchWavHeader(bytes)
        const result = { wav, durationMs: wavDurationMs(wav), voiceId: voice }
        cache.set(key, result)
        if (cache.size > 32) {
          const oldest = cache.keys().next()
          if (!oldest.done) cache.delete(oldest.value)
        }
        return { ...result, cached: false }
      } catch (error) {
        warn('voice-control: speech synthesis failed', error)
        throw error
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
