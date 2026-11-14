// Voice profile: which TTS voice fills each slot, plus playback speed.
//
// This is a Browser module (no imports) so it also loads in node tests: the
// storage calls are guarded and fall back to the defaults outside a window.

/** localStorage key holding the profile. */
export const VOICE_KEY = 'dsh.voice-companion.voice';

/** Playback-rate window shared with the host /characters response. */
export const SPEED_MIN = 0.75;
export const SPEED_MAX = 1.35;

/** Slots of the character -> voice mapping that can be overridden. */
export const VOICE_SLOTS = ['base', 'bright', 'soft'];

/** Product default: follow each character's mapping, normal speed. */
export const DEFAULT_PROFILE = {
  map: {},
  speed: 1,
};

const KNOWN_VOICES = ['stella', 'tide'];
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Coerce a stored speed into [0.75, 1.35], rounded to 2 decimals. Anything that
 * is not a finite number (including the string "1.2") becomes 1.
 */
export function clampSpeed(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/**
 * Return a fresh, valid profile: unknown slots and unknown voice ids are
 * dropped, the speed is clamped, and any malformed input becomes the default.
 */
export function normalizeProfile(profile) {
  const source = isRecord(profile) ? profile : {};
  const incoming = isRecord(source.map) ? source.map : {};
  const map = {};

  for (const slot of VOICE_SLOTS) {
    const value = incoming[slot];
    if (typeof value !== 'string') continue;
    const voiceId = value.trim();
    if (voiceId === '' || !KNOWN_VOICES.includes(voiceId)) continue;
    map[slot] = voiceId;
  }

  return { map, speed: clampSpeed(source.speed) };
}

/** Read the profile from localStorage; corrupted or missing data yields defaults. */
export function readVoiceProfile() {
  try {
    const raw = window.localStorage.getItem(VOICE_KEY);
    if (!raw) return normalizeProfile(DEFAULT_PROFILE);
    return normalizeProfile(JSON.parse(raw));
  } catch (_error) {
    return normalizeProfile(DEFAULT_PROFILE);
  }
}

/**
 * Persist one profile and return the normalized copy that was written. Storage
 * failures (private mode, quota) are swallowed: the in-memory profile stays
 * usable for the current page.
 */
export function writeVoiceProfile(profile) {
  const normalized = normalizeProfile(profile);
  try {
    window.localStorage.setItem(VOICE_KEY, JSON.stringify(normalized));
  } catch (_error) {
    // Storage is best-effort; the caller keeps the returned profile in memory.
  }
  return normalized;
}
