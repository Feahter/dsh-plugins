/**
 * Voice catalog and adaptive voice selection.
 *
 * Pure functions only: no IO, no imports, no timers. The host router uses these
 * to turn a character + sentence into one of the TTS voice ids that
 * `host/tts.js` accepts.
 */

/** @typedef {'bright' | 'warm'} VoiceTone */
/** @typedef {{ id: string, label: string, tone: VoiceTone }} Voice */
/** @typedef {'whale' | 'chibi'} CharacterId */
/** @typedef {'auto' | 'bright' | 'calm'} VoiceMode */
/** @typedef {'bright' | 'soft' | 'calm'} Emotion */
/** @typedef {{ base?: string, bright?: string, soft?: string }} VoiceMap */

/** @type {ReadonlyArray<Voice>} */
export const VOICE_CATALOG = Object.freeze([
  { id: 'stella', label: '明亮', tone: 'bright' },
  { id: 'tide', label: '温柔', tone: 'warm' },
])

/** @type {ReadonlyArray<string>} */
export const VOICE_IDS = Object.freeze(VOICE_CATALOG.map((voice) => voice.id))

/**
 * Per-character mapping. `soft` is only used by emotion-based selection;
 * `base` is the stable opening voice and the final fallback.
 * @type {Readonly<Record<CharacterId, { base: string, bright: string, soft: string }>>}
 */
export const CHARACTER_VOICES = Object.freeze({
  whale: Object.freeze({ base: 'tide', bright: 'stella', soft: 'tide' }),
  chibi: Object.freeze({ base: 'stella', bright: 'stella', soft: 'tide' }),
})

const DEFAULT_CHARACTER = 'whale'
const FALLBACK_VOICE = 'tide'

/** Slots of CHARACTER_VOICES that a custom profile may override. */
const VOICE_SLOTS = ['base', 'bright', 'soft']

/** @type {ReadonlyArray<string>} */
const BRIGHT_WORDS = ['哈哈', '太棒', '好耶', '厉害']
/** @type {ReadonlyArray<string>} */
const SOFT_WORDS = ['抱歉', '对不起', '不好意思', '辛苦', '慢慢', '别急', '难过']
/** @type {ReadonlyArray<string>} */
const BRIGHT_PUNCTUATION = ['！', '!']

/**
 * @param {unknown} text
 * @returns {string}
 */
function asText(text) {
  return typeof text === 'string' ? text : ''
}

/**
 * @param {string} source
 * @param {ReadonlyArray<string>} needles
 * @returns {number} earliest index, or -1
 */
function earliestIndex(source, needles) {
  let best = -1
  for (const needle of needles) {
    const index = source.indexOf(needle)
    if (index === -1) continue
    if (best === -1 || index < best) best = index
  }
  return best
}

/**
 * Classify one sentence by its text.
 *
 * Rule: every signal is positional.
 * - Bright signals: `！` `!` 哈哈 太棒 好耶 厉害.
 * - Soft signals: 抱歉 对不起 不好意思 辛苦 慢慢 别急 难过.
 * - Only one kind present -> that kind.
 * - Both kinds present -> whichever signal appears first wins; on the same
 *   index bright wins (a terminal exclamation reads as excitement).
 * - No signal -> `calm`.
 *
 * This means `抱歉！` is `soft` (抱歉 starts at 0, `！` at 2) while `！抱歉` is
 * `bright`, which keeps the "first thing said sets the tone" intent.
 * @param {unknown} text
 * @returns {Emotion}
 */
export function detectEmotion(text) {
  const source = asText(text)
  if (source === '') return 'calm'

  const brightAt = earliestIndex(source, [...BRIGHT_WORDS, ...BRIGHT_PUNCTUATION])
  const softAt = earliestIndex(source, SOFT_WORDS)

  if (brightAt === -1 && softAt === -1) return 'calm'
  if (brightAt === -1) return 'soft'
  if (softAt === -1) return 'bright'
  return brightAt <= softAt ? 'bright' : 'soft'
}

/**
 * Normalize a client-supplied voice mode. Unknown values fall back to `auto`.
 * @param {unknown} mode
 * @returns {VoiceMode}
 */
export function resolveVoiceMode(mode) {
  if (mode === 'bright' || mode === 'calm' || mode === 'auto') return mode
  return 'auto'
}

/**
 * Validate a client-supplied voice map.
 *
 * Only `base` / `bright` / `soft` survive, values must be non-empty strings
 * inside `available` (or the built-in catalog when `available` is omitted), and
 * the result is always a new object — possibly empty.
 * @param {unknown} map
 * @param {Array<unknown>} [available] non-empty array restricts values to its ids
 * @returns {VoiceMap}
 */
export function normalizeVoiceMap(map, available) {
  /** @type {VoiceMap} */
  const normalized = {}
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return normalized

  const allowed = Array.isArray(available) && available.length > 0 ? available : VOICE_IDS
  for (const slot of VOICE_SLOTS) {
    const value = map[slot]
    if (typeof value !== 'string') continue
    const voiceId = value.trim()
    if (voiceId === '' || !allowed.includes(voiceId)) continue
    normalized[slot] = voiceId
  }
  return normalized
}

/**
 * @param {unknown} character
 * @param {string} [fallback]
 * @returns {{ base: string, bright: string, soft: string }}
 */
function mappingFor(character, fallback = DEFAULT_CHARACTER) {
  const key = typeof character === 'string' ? character : ''
  return CHARACTER_VOICES[key] ?? CHARACTER_VOICES[fallback]
}

/**
 * The effective mapping for one speaker: the character default with any valid
 * custom slot layered on top. Missing or invalid slots keep the default.
 * @param {unknown} character
 * @param {unknown} voiceMap
 * @returns {{ base: string, bright: string, soft: string }}
 */
function resolveMapping(character, voiceMap) {
  const mapping = mappingFor(character)
  const custom = normalizeVoiceMap(voiceMap)
  if (Object.keys(custom).length === 0) return mapping
  return { ...mapping, ...custom }
}

/**
 * @param {string} desired
 * @param {string} base
 * @param {Array<unknown>} available
 * @returns {string}
 */
function narrowToAvailable(desired, base, available) {
  for (const candidate of [desired, base, FALLBACK_VOICE]) {
    if (available.includes(candidate)) return candidate
  }
  // The caller may enable voices this module does not know yet. Returning one
  // of its ids honours "must be in available" without inventing a new id.
  for (const candidate of available) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return FALLBACK_VOICE
}

/**
 * Pick the voice for one sentence.
 * @param {object} [input]
 * @param {unknown} [input.character]
 * @param {unknown} [input.text]
 * @param {unknown} [input.index]
 * @param {unknown} [input.total]
 * @param {unknown} [input.mode]
 * @param {unknown} [input.available] non-empty array restricts the result to its ids
 * @param {unknown} [input.voiceMap] per-slot overrides, missing slots use the character mapping
 * @returns {string}
 */
export function selectVoice({ character, text, index, total, mode, available, voiceMap } = {}) {
  void index
  void total
  const mapping = resolveMapping(character, voiceMap)
  const resolved = resolveVoiceMode(mode)

  /** @type {string} */
  let desired
  if (resolved === 'bright') {
    desired = mapping.bright
  } else if (resolved === 'calm') {
    desired = mapping.base
  } else {
    const emotion = detectEmotion(text)
    desired = emotion === 'bright' ? mapping.bright : emotion === 'soft' ? mapping.soft : mapping.base
  }

  if (Array.isArray(available) && available.length > 0) {
    return narrowToAvailable(desired, mapping.base, available)
  }
  return desired
}

/**
 * Map a whole utterance to one voice id per sentence.
 *
 * The first sentence always uses the character's base voice so an opening line
 * sounds stable; later sentences follow `selectVoice`. No alternating or
 * "variety for its own sake" logic.
 * @param {object} [input]
 * @param {unknown} [input.character]
 * @param {unknown} [input.sentences]
 * @param {unknown} [input.mode]
 * @param {unknown} [input.available]
 * @param {unknown} [input.voiceMap] per-slot overrides, missing slots use the character mapping
 * @returns {string[]}
 */
export function selectVoices({ character, sentences, mode, available, voiceMap } = {}) {
  if (!Array.isArray(sentences) || sentences.length === 0) return []
  const mapping = resolveMapping(character, voiceMap)
  const total = sentences.length

  return sentences.map((sentence, index) => {
    if (index === 0) {
      if (Array.isArray(available) && available.length > 0) {
        return narrowToAvailable(mapping.base, mapping.base, available)
      }
      return mapping.base
    }
    return selectVoice({ character, text: sentence, index, total, mode, available, voiceMap })
  })
}

/**
 * A detached copy of the catalog: callers may mutate the result freely.
 * @returns {Array<{ id: string, label: string, tone: VoiceTone }>}
 */
export function voiceCatalog() {
  return VOICE_CATALOG.map((voice) => ({ ...voice }))
}
