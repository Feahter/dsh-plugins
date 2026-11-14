// Push-to-talk over a global hotkey: hold Ctrl+Shift+Space → record → release →
// /transcribe → /plan → /send. This is a plain ESM fragment with no imports:
// scripts/build-client.mjs strips `export` and inlines it into the same
// ModuleLoader factory as avatar.js/audio.js/index.js, so every top-level name
// below is prefixed `hotkey`/`HOTKEY_` on purpose. In particular there is no
// `__test` export (avatar.js already owns that name) — the test hook is
// `__hotkeyTest`.

const HOTKEY_DEFAULT_SPEC = 'ControlLeft+ShiftLeft+Space';
const HOTKEY_STORAGE_KEY = 'dsh.voice-companion.hotkey';
const HOTKEY_SAMPLE_RATE = 16000;
const HOTKEY_MIN_PRESS_MS = 300;
const HOTKEY_MAX_RECORD_MS = 60000;
const HOTKEY_PENDING_TTL_MS = 30000;
const HOTKEY_HUD_HIDE_MS = 4000;
const HOTKEY_SPEAK_GUARD_MS = 800;
const HOTKEY_BUFFER_SIZE = 4096;

const HOTKEY_LABELS = {
  idle: '待命',
  recording: '录音中',
  transcribing: '识别中',
  routing: '投递中',
  failed: '失败',
  done: '完成',
};

const HOTKEY_STYLE_TEXT = `
.vc-hotkey-hud{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:8px;max-width:min(78vw,560px);padding:8px 14px;border-radius:999px;background:rgba(22,24,29,.92);color:#f4f5f7;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.22);pointer-events:none;transition:opacity .18s ease,visibility .18s ease}
.vc-hotkey-hud[data-visible="0"]{opacity:0;visibility:hidden}
.vc-hotkey-dot{width:7px;height:7px;border-radius:50%;background:#9aa0a6;flex:0 0 auto}
.vc-hotkey-dot[data-phase="recording"]{background:#ff5f57;animation:vc-hotkey-pulse 1s ease-in-out infinite}
.vc-hotkey-dot[data-phase="transcribing"]{background:#f5c451}
.vc-hotkey-dot[data-phase="routing"]{background:#5b9dff}
.vc-hotkey-dot[data-phase="done"]{background:#51c46a}
.vc-hotkey-dot[data-phase="failed"]{background:#ff5f57}
.vc-hotkey-label{font-weight:600;white-space:nowrap}
.vc-hotkey-detail{opacity:.82;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42vw}
@keyframes vc-hotkey-pulse{50%{opacity:.35}}
`;

const hotkeyClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (id) => clearTimeout(id),
};

const hotkeyStyledDocuments = new WeakSet();
const hotkeyNoop = () => {};

function hotkeySetClock(next) {
  if (!next || typeof next !== 'object') return;
  if (typeof next.now === 'function') hotkeyClock.now = next.now;
  if (typeof next.setTimeout === 'function') hotkeyClock.setTimeout = next.setTimeout;
  if (typeof next.clearTimeout === 'function') hotkeyClock.clearTimeout = next.clearTimeout;
}

function hotkeyResetClock() {
  hotkeyClock.now = () => Date.now();
  hotkeyClock.setTimeout = (callback, delay) => setTimeout(callback, delay);
  hotkeyClock.clearTimeout = (id) => clearTimeout(id);
}

function hotkeyFailure(message, code) {
  const error = new Error(message);
  error.vcHotkey = true;
  error.code = code || 'hotkey';
  return error;
}

function hotkeyErrorMessage(error) {
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  if (error && typeof error.message === 'string' && error.message.trim() !== '') return error.message.trim();
  return '未知错误';
}

function hotkeyNoteError(scope, error) {
  try {
    const text = error && error.message ? error.message : String(error);
    console.warn('[voice-companion hotkey] ' + scope + ': ' + text);
  } catch {
    // console itself can be unavailable in exotic hosts; never surface this.
  }
}

function hotkeySafeCall(callback, value) {
  if (typeof callback !== 'function') return;
  try {
    callback(value);
  } catch (error) {
    hotkeyNoteError('callback', error);
  }
}

function hotkeyPreventDefault(event) {
  if (!event) return;
  try {
    if (typeof event.preventDefault === 'function') event.preventDefault();
  } catch {
    // Some synthetic events expose a throwing preventDefault; ignore.
  }
}

function hotkeyStopStream(stream) {
  if (!stream) return;
  try {
    const tracks = typeof stream.getTracks === 'function'
      ? stream.getTracks()
      : typeof stream.getAudioTracks === 'function'
        ? stream.getAudioTracks()
        : [];
    for (const track of tracks || []) {
      try {
        if (track && typeof track.stop === 'function') track.stop();
      } catch {
        // A track that is already ended can throw; nothing useful to do.
      }
    }
  } catch (error) {
    hotkeyNoteError('stream', error);
  }
}

function hotkeyAudioContextCtor() {
  if (typeof window !== 'undefined' && window) {
    if (typeof window.AudioContext === 'function') return window.AudioContext;
    if (typeof window.webkitAudioContext === 'function') return window.webkitAudioContext;
  }
  if (typeof AudioContext !== 'undefined' && typeof AudioContext === 'function') return AudioContext;
  return null;
}

function hotkeyMapCaptureError(error) {
  const name = error && typeof error.name === 'string' ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return hotkeyFailure('麦克风权限被拒绝', 'permission');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return hotkeyFailure('没有可用的麦克风', 'no-device');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return hotkeyFailure('麦克风被占用', 'busy');
  }
  return hotkeyFailure('麦克风不可用', 'capture');
}

function hotkeyIsModifierToken(token) {
  return token === 'ctrl'
    || token === 'control'
    || token === 'cmdorctrl'
    || token === 'controlleft'
    || token === 'controlright'
    || token === 'shift'
    || token === 'shiftleft'
    || token === 'shiftright'
    || token === 'alt'
    || token === 'option'
    || token === 'altleft'
    || token === 'altright'
    || token === 'meta'
    || token === 'cmd'
    || token === 'command'
    || token === 'win'
    || token === 'super'
    || token === 'metaleft'
    || token === 'metaright';
}

/**
 * Parse a hotkey spec such as "ControlLeft+ShiftLeft+Space" or "Alt+KeyM".
 * Modifier tokens set the modifier flags; the last non-modifier token is the
 * key, matched against both KeyboardEvent.code and KeyboardEvent.key.
 */
export function parseHotkey(spec) {
  const raw = typeof spec === 'string' && spec.trim() !== '' ? spec.trim() : HOTKEY_DEFAULT_SPEC;
  const parts = raw.split('+').map((part) => part.trim()).filter((part) => part !== '');
  const binding = {
    spec: parts.length ? parts.join('+') : HOTKEY_DEFAULT_SPEC,
    key: '',
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };
  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === 'ctrl' || token === 'control' || token === 'controlleft' || token === 'controlright' || token === 'cmdorctrl') {
      binding.ctrl = true;
    } else if (token === 'shift' || token === 'shiftleft' || token === 'shiftright') {
      binding.shift = true;
    } else if (token === 'alt' || token === 'option' || token === 'altleft' || token === 'altright') {
      binding.alt = true;
    } else if (token === 'meta' || token === 'cmd' || token === 'command' || token === 'win' || token === 'super' || token === 'metaleft' || token === 'metaright') {
      binding.meta = true;
    } else {
      binding.key = part;
    }
  }
  return binding;
}

export function matchesHotkey(event, binding) {
  if (!event || !binding) return false;
  if (!!event.ctrlKey !== !!binding.ctrl) return false;
  if (!!event.shiftKey !== !!binding.shift) return false;
  if (!!event.altKey !== !!binding.alt) return false;
  if (!!event.metaKey !== !!binding.meta) return false;

  const target = String(binding.key || '').toLowerCase();
  if (target === '' || target === 'none') return false;
  const key = typeof event.key === 'string' ? event.key : '';
  const code = typeof event.code === 'string' ? event.code : '';

  if (target === 'space' || target === ' ') {
    return code === 'Space' || key === ' ' || key === 'Spacebar';
  }
  if (key !== '' && key.toLowerCase() === target) return true;
  if (code !== '' && code.toLowerCase() === target) return true;
  return false;
}

function hotkeyIsModifierRelease(event, binding) {
  if (!event || !binding) return false;
  const code = typeof event.code === 'string' ? event.code.toLowerCase() : '';
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (binding.ctrl && (code.startsWith('control') || key === 'control')) return true;
  if (binding.shift && (code.startsWith('shift') || key === 'shift')) return true;
  if (binding.alt && (code.startsWith('alt') || key === 'alt')) return true;
  if (binding.meta && (code.startsWith('meta') || key === 'meta' || key === 'os')) return true;
  return false;
}

function hotkeyReadSpec() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
      const stored = localStorage.getItem(HOTKEY_STORAGE_KEY);
      if (typeof stored === 'string' && stored.trim() !== '') return stored.trim();
    }
  } catch {
    // localStorage can throw in privacy mode; fall back to the default binding.
  }
  return HOTKEY_DEFAULT_SPEC;
}

function hotkeyConcatFloat(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function hotkeyResample(samples, fromRate, toRate) {
  if (!samples || samples.length === 0) return new Float32Array(0);
  if (!(fromRate > 0) || !(toRate > 0) || fromRate === toRate) return samples;
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(samples.length - 1, index + 1);
    const fraction = position - index;
    out[i] = samples[index] * (1 - fraction) + samples[next] * fraction;
  }
  return out;
}

function hotkeyEncodeWave(samples) {
  const length = samples && samples.length ? samples.length : 0;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, HOTKEY_SAMPLE_RATE, true);
  view.setUint32(28, HOTKEY_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function hotkeyBytesToBase64(bytes) {
  if (!bytes || bytes.length === 0) return '';
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  return '';
}

function hotkeyBase64ToBytes(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  if (clean === '') return new Uint8Array(0);
  if (typeof atob === 'function') {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    return bytes;
  }
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  return new Uint8Array(0);
}

function hotkeyIsCandidate(candidate) {
  return !!candidate
    && typeof candidate === 'object'
    && typeof candidate.sessionId === 'string'
    && candidate.sessionId !== '';
}

function hotkeyPlanTitle(plan) {
  if (!plan || typeof plan !== 'object') return '';
  if (typeof plan.title === 'string' && plan.title.trim() !== '') return plan.title.trim();
  if (typeof plan.sessionTitle === 'string' && plan.sessionTitle.trim() !== '') return plan.sessionTitle.trim();
  const candidates = Array.isArray(plan.candidates) ? plan.candidates : [];
  const match = candidates.find((candidate) => candidate && candidate.sessionId === plan.sessionId);
  if (match && typeof match.title === 'string' && match.title.trim() !== '') return match.title.trim();
  return '';
}

function hotkeyEnsureStyles(doc) {
  if (!doc || hotkeyStyledDocuments.has(doc)) return;
  hotkeyStyledDocuments.add(doc);
  try {
    const style = doc.createElement('style');
    style.setAttribute('data-vc-hotkey-style', '');
    style.textContent = HOTKEY_STYLE_TEXT;
    const host = doc.head || doc.body;
    if (host && typeof host.appendChild === 'function') host.appendChild(style);
  } catch (error) {
    hotkeyNoteError('style', error);
  }
}

/**
 * Create the browser half of push-to-talk.
 *
 * @param {object} deps
 * @param {Function} deps.requestJson  index.js requestJson(path, {method, body})
 * @param {Function} [deps.onPhase]    idle|recording|transcribing|routing|failed|done
 * @param {Function} [deps.onSubtitle] recognized text / question / failure reason
 * @param {string|Function} [deps.currentSessionId] optional active Session id
 */
export function createHotkey(deps) {
  const options = deps && typeof deps === 'object' ? deps : {};
  const requestJson = typeof options.requestJson === 'function' ? options.requestJson : null;

  const state = {
    installed: false,
    disposed: false,
    phase: 'idle',
    detail: '',
    hotkey: parseHotkey(hotkeyReadSpec()),
    recording: null,
    pending: null,
    pipeline: null,
    playback: null,
    playbackContext: null,
    hideTimer: null,
    pendingTimer: null,
    recordTimer: null,
    hud: null,
    doc: null,
    win: null,
    listeners: null,
    token: 0,
  };

  function hotkeyCurrentSessionId() {
    try {
      const value = typeof options.currentSessionId === 'function'
        ? options.currentSessionId()
        : options.currentSessionId;
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    } catch {
      return null;
    }
  }

  function clearHideTimer() {
    if (state.hideTimer !== null) {
      hotkeyClock.clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
  }

  function clearPendingTimer() {
    if (state.pendingTimer !== null) {
      hotkeyClock.clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function clearRecordTimer() {
    if (state.recordTimer !== null) {
      hotkeyClock.clearTimeout(state.recordTimer);
      state.recordTimer = null;
    }
  }

  function clearPending() {
    clearPendingTimer();
    state.pending = null;
  }

  function armPending() {
    clearPendingTimer();
    if (!Array.isArray(state.pending) || state.pending.length === 0) return;
    state.pendingTimer = hotkeyClock.setTimeout(() => {
      state.pendingTimer = null;
      state.pending = null;
    }, HOTKEY_PENDING_TTL_MS);
  }

  function ensureHud() {
    if (state.hud) return state.hud;
    const doc = state.doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') return null;
    const host = doc.body || doc.documentElement;
    if (!host || typeof host.appendChild !== 'function') return null;
    hotkeyEnsureStyles(doc);
    try {
      const root = doc.createElement('div');
      root.setAttribute('data-vc-hotkey-hud', '');
      root.setAttribute('class', 'vc-hotkey-hud');
      root.setAttribute('data-visible', '0');
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');

      const dot = doc.createElement('span');
      dot.setAttribute('class', 'vc-hotkey-dot');
      dot.setAttribute('aria-hidden', 'true');
      dot.setAttribute('data-phase', 'idle');

      const label = doc.createElement('span');
      label.setAttribute('class', 'vc-hotkey-label');

      const detail = doc.createElement('span');
      detail.setAttribute('class', 'vc-hotkey-detail');

      root.appendChild(dot);
      root.appendChild(label);
      root.appendChild(detail);
      host.appendChild(root);
      state.hud = { root, dot, label, detail };
      return state.hud;
    } catch (error) {
      hotkeyNoteError('hud', error);
      return null;
    }
  }

  function renderHud() {
    const hud = ensureHud();
    if (!hud) return;
    const label = HOTKEY_LABELS[state.phase] || '';
    hud.dot.setAttribute('data-phase', state.phase);
    hud.root.setAttribute('data-state', state.phase);
    hud.label.textContent = label;
    hud.detail.textContent = state.detail || '';
    const visible = state.phase !== 'idle' || state.detail !== '';
    hud.root.setAttribute('data-visible', visible ? '1' : '0');
  }

  function hideHud() {
    if (!state.hud) return;
    try {
      state.hud.root.setAttribute('data-visible', '0');
    } catch {
      // The HUD may already be detached.
    }
  }

  function removeHud() {
    const hud = state.hud;
    state.hud = null;
    if (!hud || !hud.root) return;
    try {
      if (typeof hud.root.remove === 'function') hud.root.remove();
      else if (hud.root.parentNode && typeof hud.root.parentNode.removeChild === 'function') hud.root.parentNode.removeChild(hud.root);
    } catch (error) {
      hotkeyNoteError('hud-remove', error);
    }
  }

  function scheduleHide() {
    clearHideTimer();
    state.hideTimer = hotkeyClock.setTimeout(() => {
      state.hideTimer = null;
      if (state.disposed) return;
      const terminal = state.phase === 'done' || state.phase === 'failed';
      hideHud();
      if (terminal) {
        state.phase = 'idle';
        state.detail = '';
        renderHud();
        hotkeySafeCall(options.onPhase, 'idle');
      } else if (state.phase === 'idle') {
        state.detail = '';
        renderHud();
      }
    }, HOTKEY_HUD_HIDE_MS);
  }

  function setPhase(phase, detail) {
    if (state.disposed) return;
    state.phase = phase;
    state.detail = typeof detail === 'string' ? detail : '';
    if (phase !== 'done' && phase !== 'failed' && phase !== 'idle') clearHideTimer();
    renderHud();
    hotkeySafeCall(options.onPhase, phase);
    if (phase === 'done' || phase === 'failed' || (phase === 'idle' && state.detail !== '')) scheduleHide();
  }

  function fail(error, prefix) {
    if (state.disposed) return;
    const reason = hotkeyErrorMessage(error);
    const message = prefix && reason.indexOf(prefix) !== 0 ? prefix + reason : reason;
    hotkeyNoteError('fail', error);
    stopPlayback();
    setPhase('failed', message);
    hotkeySafeCall(options.onSubtitle, message);
  }

  function stale(capture) {
    return state.disposed || !capture || capture.token !== state.token;
  }

  function stopCapture(capture) {
    if (!capture) return { bytes: hotkeyEncodeWave(new Float32Array(0)), samples: 0 };
    capture.stopped = true;
    if (capture.processor) {
      try {
        capture.processor.onaudioprocess = null;
      } catch {
        // Ignore a frozen processor object.
      }
    }
    for (const node of [capture.processor, capture.source, capture.gain]) {
      if (node && typeof node.disconnect === 'function') {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    }
    hotkeyStopStream(capture.stream);
    const context = capture.context;
    capture.context = null;
    if (context && typeof context.close === 'function') {
      try {
        const closed = context.close();
        if (closed && typeof closed.catch === 'function') closed.catch(hotkeyNoop);
      } catch {
        // Ignore a context that is already closed.
      }
    }
    const chunks = capture.chunks || [];
    capture.chunks = [];
    const merged = hotkeyConcatFloat(chunks);
    const resampled = hotkeyResample(merged, capture.inputRate || HOTKEY_SAMPLE_RATE, HOTKEY_SAMPLE_RATE);
    return { bytes: hotkeyEncodeWave(resampled), samples: resampled.length };
  }

  async function callJson(path, body) {
    if (!requestJson) throw hotkeyFailure('宿主接口不可用', 'unavailable');
    const payload = await requestJson(path, { method: 'POST', body });
    if (payload && payload.ok === false) {
      throw hotkeyFailure(typeof payload.message === 'string' && payload.message.trim() !== '' ? payload.message : '服务返回错误', 'host');
    }
    return payload && typeof payload === 'object' ? payload : {};
  }

  function playbackContext() {
    if (state.playbackContext) return state.playbackContext;
    const Ctor = hotkeyAudioContextCtor();
    if (!Ctor) return null;
    try {
      state.playbackContext = new Ctor();
      return state.playbackContext;
    } catch (error) {
      hotkeyNoteError('audio-context', error);
      return null;
    }
  }

  function unlockPlayback() {
    const context = playbackContext();
    if (!context || typeof context.resume !== 'function') return;
    try {
      if (context.state !== 'suspended') return;
      const resumed = context.resume();
      if (resumed && typeof resumed.catch === 'function') resumed.catch(hotkeyNoop);
    } catch {
      // Autoplay policy can still refuse; speech is best-effort.
    }
  }

  function stopPlayback() {
    const playing = state.playback;
    if (!playing) return;
    state.playback = null;
    try {
      if (playing.source && typeof playing.source.stop === 'function') playing.source.stop(0);
    } catch {
      // The source may have ended already.
    }
    try {
      if (typeof playing.finish === 'function') playing.finish();
    } catch {
      // finish is idempotent.
    }
  }

  async function speakText(text) {
    const sentence = typeof text === 'string' ? text.trim() : '';
    if (sentence === '' || state.disposed) return;
    try {
      const payload = await callJson('/speak', { text: sentence });
      if (state.disposed) return;
      const encoded = typeof payload.audioBase64 === 'string' ? payload.audioBase64 : '';
      if (encoded === '') return;
      const context = playbackContext();
      if (!context || typeof context.decodeAudioData !== 'function' || typeof context.createBufferSource !== 'function') return;
      const bytes = hotkeyBase64ToBytes(encoded);
      if (bytes.length === 0) return;
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await context.decodeAudioData(copy);
      if (state.disposed) return;

      stopPlayback();
      const source = context.createBufferSource();
      source.buffer = decoded;
      if (typeof source.connect === 'function') source.connect(context.destination);
      const durationMs = Number(payload.durationMs) > 0
        ? Number(payload.durationMs)
        : Number(decoded && decoded.duration) > 0
          ? Number(decoded.duration) * 1000
          : 4000;

      let settled = false;
      let timer = null;
      let resolveDone = hotkeyNoop;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          hotkeyClock.clearTimeout(timer);
          timer = null;
        }
        try {
          source.onended = null;
        } catch {
          // Ignore.
        }
        if (state.playback && state.playback.source === source) state.playback = null;
        resolveDone();
      };
      state.playback = { source, finish };
      source.onended = finish;
      timer = hotkeyClock.setTimeout(finish, durationMs + HOTKEY_SPEAK_GUARD_MS);
      if (state.playback) state.playback.timer = timer;
      try {
        source.start(0);
      } catch {
        finish();
      }
      await done;
    } catch (error) {
      hotkeyNoteError('speak', error);
    }
  }

  async function openCapture(capture) {
    const media = typeof navigator !== 'undefined' && navigator ? navigator.mediaDevices : null;
    if (!media || typeof media.getUserMedia !== 'function') throw hotkeyFailure('麦克风不可用', 'unavailable');
    let stream = null;
    try {
      stream = await media.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: HOTKEY_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (error) {
      throw hotkeyMapCaptureError(error);
    }
    if (capture.cancelled || stale(capture)) {
      hotkeyStopStream(stream);
      throw hotkeyFailure('已取消', 'cancelled');
    }
    capture.stream = stream;

    const Ctor = hotkeyAudioContextCtor();
    if (!Ctor) {
      hotkeyStopStream(stream);
      throw hotkeyFailure('录音不可用', 'audio-context');
    }
    let context = null;
    try {
      context = new Ctor({ sampleRate: HOTKEY_SAMPLE_RATE });
    } catch {
      try {
        context = new Ctor();
      } catch (error) {
        hotkeyStopStream(stream);
        throw hotkeyFailure('录音不可用', 'audio-context');
      }
    }
    capture.context = context;
    try {
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        const resumed = context.resume();
        if (resumed && typeof resumed.catch === 'function') resumed.catch(hotkeyNoop);
      }
    } catch {
      // ScriptProcessor still works on some hosts without a resumed context.
    }

    try {
      if (typeof context.createScriptProcessor !== 'function') throw hotkeyFailure('录音不可用', 'processor');
      const processor = context.createScriptProcessor(HOTKEY_BUFFER_SIZE, 1, 1);
      if (!processor || typeof processor.connect !== 'function') throw hotkeyFailure('录音不可用', 'processor');
      capture.processor = processor;
      capture.inputRate = Number(context.sampleRate) > 0 ? Number(context.sampleRate) : HOTKEY_SAMPLE_RATE;
      processor.onaudioprocess = (event) => {
        if (capture.cancelled || capture.stopped || state.disposed) return;
        const input = event && event.inputBuffer;
        if (!input || typeof input.getChannelData !== 'function') return;
        const data = input.getChannelData(0);
        if (!data || data.length === 0) return;
        if ((capture.samples || 0) >= capture.inputRate * (HOTKEY_MAX_RECORD_MS / 1000)) return;
        capture.samples = (capture.samples || 0) + data.length;
        capture.chunks.push(new Float32Array(data));
      };
      if (typeof context.createMediaStreamSource !== 'function') throw hotkeyFailure('录音不可用', 'source');
      const source = context.createMediaStreamSource(stream);
      capture.source = source;
      source.connect(processor);
      if (typeof context.createGain === 'function') {
        const gain = context.createGain();
        capture.gain = gain;
        try {
          gain.gain.value = 0;
        } catch {
          // Ignore.
        }
        processor.connect(gain);
        gain.connect(context.destination);
      } else {
        processor.connect(context.destination);
      }
    } catch (error) {
      stopCapture(capture);
      throw error && error.vcHotkey ? error : hotkeyFailure('录音不可用', 'capture');
    }

    if (capture.cancelled || stale(capture)) {
      stopCapture(capture);
      throw hotkeyFailure('已取消', 'cancelled');
    }
  }

  async function route(capture, text) {
    const body = { utterance: text };
    const current = hotkeyCurrentSessionId();
    if (current) body.currentSessionId = current;
    if (Array.isArray(state.pending) && state.pending.length > 0) {
      body.pending = state.pending.map((candidate) => ({
        sessionId: candidate.sessionId,
        title: typeof candidate.title === 'string' ? candidate.title : '',
      }));
    }

    let payload = null;
    try {
      payload = await callJson('/plan', body);
    } catch (error) {
      fail(error, '路由失败：');
      return;
    }
    if (stale(capture)) return;

    const plan = payload.plan && typeof payload.plan === 'object' ? payload.plan : {};
    const confirmation = typeof payload.confirmation === 'string' && payload.confirmation.trim() !== ''
      ? payload.confirmation.trim()
      : typeof plan.confirmation === 'string' && plan.confirmation.trim() !== ''
        ? plan.confirmation.trim()
        : '';
    const action = typeof plan.action === 'string' && plan.action !== '' ? plan.action : 'prompt';

    if (action === 'ask') {
      const question = typeof plan.question === 'string' && plan.question.trim() !== ''
        ? plan.question.trim()
        : confirmation !== ''
          ? confirmation
          : '要投递到哪个会话？';
      const candidates = Array.isArray(plan.candidates) ? plan.candidates.filter(hotkeyIsCandidate) : [];
      state.pending = candidates.slice(0, 5);
      armPending();
      hotkeySafeCall(options.onSubtitle, question);
      setPhase('done', question);
      void speakText(question);
      return;
    }

    const request = action === 'cancel'
      ? { action: 'cancel' }
      : action === 'new'
        ? { action: 'new', text }
        : { action: 'prompt', sessionId: plan.sessionId, text };
    if (!request.sessionId && action !== 'cancel' && action !== 'new') {
      fail(hotkeyFailure('没有可投递的会话', 'no-session'), '投递失败：');
      return;
    }

    let sent = null;
    try {
      sent = await callJson('/send', request);
    } catch (error) {
      fail(error, '投递失败：');
      return;
    }
    if (stale(capture)) return;

    clearPending();
    const title = hotkeyPlanTitle(plan) || hotkeyPlanTitle(sent);
    const detail = title !== '' ? '投递到 ' + title : (confirmation !== '' ? confirmation : '已投递');
    hotkeySafeCall(options.onSubtitle, confirmation !== '' ? confirmation : detail);
    setPhase('done', detail);
    void speakText(confirmation !== '' ? confirmation : detail);
  }

  async function finishPress(capture) {
    try {
      await capture.ready;
    } catch (error) {
      if (stale(capture)) return;
      fail(error);
      return;
    }
    if (stale(capture)) {
      stopCapture(capture);
      return;
    }

    const held = Math.max(0, hotkeyClock.now() - capture.startedAt);
    const recorded = stopCapture(capture);
    if (held < HOTKEY_MIN_PRESS_MS) {
      setPhase('idle', '按住热键说完再松手');
      return;
    }
    if (!recorded.samples || recorded.samples === 0) {
      fail(hotkeyFailure('没有录到声音', 'empty'));
      return;
    }

    setPhase('transcribing', '');
    let text = '';
    try {
      const payload = await callJson('/transcribe', { audioBase64: hotkeyBytesToBase64(recorded.bytes) });
      text = typeof payload.text === 'string' ? payload.text.trim() : '';
    } catch (error) {
      if (stale(capture)) return;
      fail(error, '识别失败：');
      return;
    }
    if (stale(capture)) return;
    if (text === '') {
      fail(hotkeyFailure('没听清，再说一次', 'empty-text'));
      return;
    }
    hotkeySafeCall(options.onSubtitle, text);
    setPhase('routing', '');
    await route(capture, text);
  }

  function press() {
    // Programmatic press() works before install(); dispose() makes it inert.
    if (state.disposed) return false;
    if (state.recording) return false;
    if (state.phase === 'transcribing' || state.phase === 'routing') return false;
    if (state.pipeline) return false;

    clearHideTimer();
    stopPlayback();
    const capture = {
      token: state.token,
      startedAt: hotkeyClock.now(),
      chunks: [],
      samples: 0,
      stopped: false,
      cancelled: false,
      stream: null,
      context: null,
      processor: null,
      source: null,
      gain: null,
      inputRate: HOTKEY_SAMPLE_RATE,
      ready: null,
    };
    state.recording = capture;
    unlockPlayback();
    setPhase('recording', '');
    clearRecordTimer();
    state.recordTimer = hotkeyClock.setTimeout(() => {
      state.recordTimer = null;
      if (state.recording === capture) release();
    }, HOTKEY_MAX_RECORD_MS);

    capture.ready = openCapture(capture);
    capture.ready.catch(hotkeyNoop);
    capture.ready.catch((error) => {
      if (state.recording !== capture) return;
      state.recording = null;
      clearRecordTimer();
      fail(error);
    });
    return true;
  }

  function release() {
    const capture = state.recording;
    if (!capture) return false;
    state.recording = null;
    clearRecordTimer();
    const pipeline = finishPress(capture);
    state.pipeline = pipeline;
    pipeline.then(
      () => {
        if (state.pipeline === pipeline) state.pipeline = null;
      },
      (error) => {
        if (state.pipeline === pipeline) state.pipeline = null;
        if (!state.disposed) fail(error);
      },
    );
    return true;
  }

  function abortPress() {
    const capture = state.recording;
    if (!capture) return;
    state.recording = null;
    clearRecordTimer();
    capture.cancelled = true;
    stopCapture(capture);
    if (!state.disposed) setPhase('idle', '已取消');
  }

  function uninstallListeners() {
    const listeners = state.listeners;
    state.listeners = null;
    state.installed = false;
    if (!listeners) return;
    try {
      if (listeners.keyTarget && typeof listeners.keyTarget.removeEventListener === 'function') {
        listeners.keyTarget.removeEventListener('keydown', listeners.onKeyDown);
        listeners.keyTarget.removeEventListener('keyup', listeners.onKeyUp);
      }
    } catch {
      // Ignore.
    }
    try {
      if (listeners.blurTarget && typeof listeners.blurTarget.removeEventListener === 'function') {
        listeners.blurTarget.removeEventListener('blur', listeners.onBlur);
      }
    } catch {
      // Ignore.
    }
  }

  function install() {
    if (state.installed) return uninstallListeners;
    state.disposed = false;
    state.hotkey = parseHotkey(hotkeyReadSpec());
    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;
    state.doc = doc;
    state.win = win;
    if (doc) hotkeyEnsureStyles(doc);
    const keyTarget = doc && typeof doc.addEventListener === 'function' ? doc : win;
    if (!keyTarget || typeof keyTarget.addEventListener !== 'function') return hotkeyNoop;

    const onKeyDown = (event) => {
      if (!event || event.repeat) return;
      if (event.defaultPrevented) return;
      if (!matchesHotkey(event, state.hotkey)) return;
      hotkeyPreventDefault(event);
      press();
    };
    const onKeyUp = (event) => {
      if (!event) return;
      const matched = matchesHotkey(event, state.hotkey);
      const modifierReleased = state.recording && hotkeyIsModifierRelease(event, state.hotkey);
      if (!matched && !modifierReleased) return;
      hotkeyPreventDefault(event);
      release();
    };
    const onBlur = () => {
      abortPress();
    };

    try {
      keyTarget.addEventListener('keydown', onKeyDown);
      keyTarget.addEventListener('keyup', onKeyUp);
    } catch (error) {
      hotkeyNoteError('listeners', error);
      return hotkeyNoop;
    }
    const blurTarget = win && win !== keyTarget && typeof win.addEventListener === 'function' ? win : keyTarget;
    try {
      blurTarget.addEventListener('blur', onBlur);
    } catch {
      // A browser without blur is still usable.
    }

    state.listeners = { keyTarget, blurTarget, onKeyDown, onKeyUp, onBlur };
    state.installed = true;
    return uninstallListeners;
  }

  function dispose() {
    state.disposed = true;
    state.token += 1;
    uninstallListeners();
    clearHideTimer();
    clearPendingTimer();
    clearRecordTimer();
    stopPlayback();
    const capture = state.recording;
    state.recording = null;
    if (capture) {
      capture.cancelled = true;
      stopCapture(capture);
    }
    const context = state.playbackContext;
    state.playbackContext = null;
    if (context && typeof context.close === 'function') {
      try {
        const closed = context.close();
        if (closed && typeof closed.catch === 'function') closed.catch(hotkeyNoop);
      } catch {
        // Ignore.
      }
    }
    removeHud();
    clearPending();
    state.pipeline = null;
    state.phase = 'idle';
    state.detail = '';
  }

  function status() {
    return {
      phase: state.phase,
      label: HOTKEY_LABELS[state.phase] || '',
      detail: state.detail,
      pending: Array.isArray(state.pending) ? state.pending.length : 0,
      installed: state.installed,
      recording: !!state.recording,
      hotkey: state.hotkey.spec,
    };
  }

  return { install, dispose, status, press, release, abort: abortPress };
}

// Test hooks only. The name must stay distinct from avatar.js's `__test`
// because the build inlines every client fragment into one scope.
export const __hotkeyTest = {
  encodeWave: hotkeyEncodeWave,
  bytesToBase64: hotkeyBytesToBase64,
  base64ToBytes: hotkeyBase64ToBytes,
  resample: hotkeyResample,
  setClock: hotkeySetClock,
  resetClock: hotkeyResetClock,
  DEFAULT_HOTKEY: HOTKEY_DEFAULT_SPEC,
  MIN_PRESS_MS: HOTKEY_MIN_PRESS_MS,
  HUD_HIDE_MS: HOTKEY_HUD_HIDE_MS,
  PENDING_TTL_MS: HOTKEY_PENDING_TTL_MS,
  SAMPLE_RATE: HOTKEY_SAMPLE_RATE,
};
