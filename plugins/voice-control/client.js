window.__ModuleLoader__.load({
  id: 'dsh-voice-control',
  factory(require) {
    'use strict';

    // ---------------------------------------------------------------- constants

    const ROUTE_PREFIX = '/api/voice-control';
    const PLAN_PATH = ROUTE_PREFIX + '/plan';
    const DISPATCH_PATH = ROUTE_PREFIX + '/dispatch';
    const SPEAK_PATH = ROUTE_PREFIX + '/speak';
    const TRANSCRIBE_PATH = ROUTE_PREFIX + '/transcribe';

    const HOTKEY_KEY = 'dsh.voice-control.hotkey';
    const HOTKEY_TIP_KEY = 'dsh.voice-control.hotkey-tip';
    const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';
    const HOTKEY_RESERVED = new Set(['ctrl+w', 'ctrl+t', 'ctrl+n', 'ctrl+r', 'meta+q', 'meta+w', 'meta+m', 'alt+f4']);

    const SAMPLE_RATE = 16000;
    const MIN_PRESS_MS = 300;
    const MAX_RECORD_MS = 60000;
    const PENDING_TTL_MS = 30000;
    const HUD_HIDE_MS = 1200;
    const HUD_NOTICE_MS = 9000;
    const ERROR_HIDE_MS = 9000;
    const SPEAK_GUARD_MS = 500;
    const PLAN_TIMEOUT_MS = 20000;
    const SPEAK_TIMEOUT_MS = 40000;
    const TRANSCRIBE_TIMEOUT_MS = 60000;

    const STATE = {
      IDLE: 'idle',
      LISTENING: 'listening',
      TRANSCRIBING: 'transcribing',
      ROUTING: 'routing',
      SPEAKING: 'speaking',
      ERROR: 'error',
    };

    const LABEL = {
      idle: '待命',
      listening: '正在听',
      transcribing: '识别中',
      routing: '路由中',
      speaking: '播报中',
      error: '错误',
    };

    const DOT_COLOR = {
      idle: '#8b93a7',
      listening: '#ff5c5c',
      transcribing: '#f0b429',
      routing: '#4f8cff',
      speaking: '#3ecf8e',
      error: '#ff5c5c',
    };

    const noop = () => {};

    function voiceError(code, message) {
      const error = new Error(message || code);
      error.code = code || 'error';
      return error;
    }

    function hostErrorCode(payload) {
      return (payload && typeof payload.code === 'string' && payload.code) || 'host';
    }

    function hostErrorMessage(payload) {
      return (payload && typeof payload.message === 'string' && payload.message) || '服务返回了错误';
    }

    // The HUD never logs what was heard; only codes and messages leave this module.
    function noteError(code, message) {
      try {
        if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
          console.warn('[dsh-voice-control] ' + String(code || 'error') + ': ' + String(message || ''));
        }
      } catch (_ignore) {}
    }

    // ------------------------------------------------------------------- clock

    // Injectable so the offline harness never has to wait 300 ms for real.
    const clock = {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    };

    function setClock(next) {
      if (typeof next === 'function') {
        clock.now = next;
        return;
      }
      if (!next || typeof next !== 'object') return;
      const keys = ['now', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
      for (const key of keys) {
        if (typeof next[key] === 'function') clock[key] = next[key];
      }
    }

    function resetClock() {
      clock.now = () => Date.now();
      clock.setTimeout = (fn, ms) => setTimeout(fn, ms);
      clock.clearTimeout = (id) => clearTimeout(id);
      clock.setInterval = (fn, ms) => setInterval(fn, ms);
      clock.clearInterval = (id) => clearInterval(id);
    }

    // ------------------------------------------------------------ pure helpers

    function parseHotkey(spec) {
      const text = typeof spec === 'string' && spec.trim() !== '' ? spec.trim() : DEFAULT_HOTKEY;
      const parts = text.split('+').map((part) => part.trim()).filter((part) => part !== '');
      const key = parts.length > 0 ? parts[parts.length - 1] : 'Space';
      const binding = {
        spec: parts.length > 0 ? parts.join('+') : DEFAULT_HOTKEY,
        key: key === '' ? 'Space' : key,
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
      };
      for (let index = 0; index < parts.length - 1; index += 1) {
        const token = parts[index].toLowerCase();
        if (token === 'ctrl' || token === 'control' || token === 'controlleft' || token === 'controlright' || token === 'cmdorctrl') binding.ctrl = true;
        else if (token === 'shift' || token === 'shiftleft' || token === 'shiftright') binding.shift = true;
        else if (token === 'alt' || token === 'option' || token === 'altleft' || token === 'altright') binding.alt = true;
        else if (token === 'meta' || token === 'cmd' || token === 'command' || token === 'win' || token === 'super' || token === 'metaleft' || token === 'metaright') binding.meta = true;
      }
      return binding;
    }

    function matchesHotkey(event, binding) {
      if (!event || !binding) return false;
      if (!!event.ctrlKey !== !!binding.ctrl) return false;
      if (!!event.shiftKey !== !!binding.shift) return false;
      if (!!event.altKey !== !!binding.alt) return false;
      if (!!event.metaKey !== !!binding.meta) return false;
      const target = String(binding.key || '').toLowerCase();
      const rawKey = typeof event.key === 'string' ? event.key : '';
      const code = typeof event.code === 'string' ? event.code : '';
      if (target === 'space') return code === 'Space' || rawKey === ' ' || rawKey === 'Spacebar';
      if (rawKey !== '' && rawKey.toLowerCase() === target) return true;
      if (code !== '' && code.toLowerCase() === target) return true;
      return false;
    }

    // A chord is released key by key; the user may let go of a modifier before
    // Space. That keyup no longer matches the full chord, but it must still end
    // the press or the microphone stays open until the window loses focus.
    function modifierReleased(event, binding) {
      if (!event || !binding) return false;
      const code = typeof event.code === 'string' ? event.code.toLowerCase() : '';
      const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (binding.ctrl && (code.startsWith('control') || key === 'control')) return true;
      if (binding.shift && (code.startsWith('shift') || key === 'shift')) return true;
      if (binding.alt && (code.startsWith('alt') || key === 'alt')) return true;
      if (binding.meta && (code.startsWith('meta') || key === 'meta' || key === 'os')) return true;
      return false;
    }

    function readHotkeySpec() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          const stored = localStorage.getItem(HOTKEY_KEY);
          if (typeof stored === 'string' && stored.trim() !== '') return stored;
        }
      } catch (_storageError) {}
      return DEFAULT_HOTKEY;
    }

    // Binding candidates: the user's chord, the same chord plus a modifier, then
    // the in-app button. Reserved browser chords are skipped before the attempt.
    function hotkeyCanonical(binding) {
      const mods = [];
      if (binding.meta) mods.push('meta');
      if (binding.ctrl) mods.push('ctrl');
      if (binding.alt) mods.push('alt');
      if (binding.shift) mods.push('shift');
      let key = String(binding.key || '').toLowerCase();
      if (/^key[a-z]$/.test(key)) key = key.slice(3);
      mods.push(key);
      return mods.join('+');
    }

    function hotkeyCandidates(spec) {
      const base = parseHotkey(spec);
      const list = [base.spec];
      if (!base.alt) list.push('AltLeft+' + base.spec);
      if (!base.ctrl) list.push('ControlLeft+' + base.spec);
      if (!base.alt && !base.ctrl) list.push('ControlLeft+AltLeft+' + base.spec);
      return list.filter((item, index) => list.indexOf(item) === index);
    }

    function hotkeyNotice(result) {
      if (!result || result.mode === 'hotkey') return '';
      const original = (result && result.original) || DEFAULT_HOTKEY;
      if (result.mode === 'fallback') {
        return '热键 ' + original + ' 无法注册（可能被其他应用占用），已切换到 ' + result.spec
          + '。 / Hotkey ' + original + ' could not be registered (maybe taken); using ' + result.spec + ' instead.';
      }
      return '热键 ' + original + ' 不可用（可能被其他应用占用，或只在窗口聚焦时生效）；请用右下角「按住说话」按钮。'
        + ' / Hotkey unavailable (maybe taken, or only while focused); use the “Hold to talk” button at the bottom right.';
    }

    function bindHotkey(target, spec, handlers) {
      const original = parseHotkey(spec).spec;
      const candidates = hotkeyCandidates(original);
      const tried = [];
      const failed = () => {
        const result = { ok: false, mode: 'button', spec: '', binding: null, original, tried, notice: '' };
        result.notice = hotkeyNotice(result);
        return result;
      };
      if (!target || typeof target.addEventListener !== 'function') {
        tried.push({ spec: original, reason: 'no-target' });
        return failed();
      }
      for (const candidate of candidates) {
        const parsed = parseHotkey(candidate);
        if (HOTKEY_RESERVED.has(hotkeyCanonical(parsed))) {
          tried.push({ spec: candidate, reason: 'reserved' });
          continue;
        }
        try {
          target.addEventListener('keydown', handlers.onKeyDown);
          target.addEventListener('keyup', handlers.onKeyUp);
          const result = {
            ok: true,
            mode: candidate === original ? 'hotkey' : 'fallback',
            spec: candidate,
            binding: parsed,
            original,
            tried,
            notice: '',
          };
          if (result.mode === 'fallback') result.notice = hotkeyNotice(result);
          return result;
        } catch (error) {
          tried.push({ spec: candidate, reason: 'error', message: (error && error.message) || String(error) });
          try {
            if (typeof target.removeEventListener === 'function') target.removeEventListener('keydown', handlers.onKeyDown);
          } catch (_removeError) {}
          try {
            if (typeof target.removeEventListener === 'function') target.removeEventListener('keyup', handlers.onKeyUp);
          } catch (_removeError) {}
        }
      }
      return failed();
    }

    // Float32 mono @ 16 kHz -> 44 byte header + PCM16 little endian.
    function encodeWave(samples) {
      const bytes = new Uint8Array(44 + samples.length * 2);
      const view = new DataView(bytes.buffer);
      const writeText = (at, value) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(at + index, value.charCodeAt(index));
      };
      writeText(0, 'RIFF');
      view.setUint32(4, bytes.length - 8, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, SAMPLE_RATE, true);
      view.setUint32(28, SAMPLE_RATE * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeText(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      for (let index = 0; index < samples.length; index += 1) {
        const raw = samples[index];
        const value = raw > 1 ? 1 : raw < -1 ? -1 : raw;
        view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      }
      return bytes;
    }

    // 8192 at a time: `String.fromCharCode(...bytes)` blows the stack on long audio.
    function toBase64(bytes) {
      let text = '';
      const chunk = 8192;
      for (let index = 0; index < bytes.length; index += chunk) {
        text += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      if (typeof btoa === 'function') return btoa(text);
      if (typeof Buffer !== 'undefined') return Buffer.from(text, 'binary').toString('base64');
      return '';
    }

    function base64ToBytes(base64) {
      let binary = '';
      if (typeof atob === 'function') binary = atob(base64);
      else if (typeof Buffer !== 'undefined') binary = Buffer.from(base64, 'base64').toString('binary');
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index) & 0xff;
      return bytes;
    }

    function audioContextCtor() {
      if (typeof AudioContext !== 'undefined' && AudioContext) return AudioContext;
      if (typeof window !== 'undefined' && window) {
        if (window.AudioContext) return window.AudioContext;
        if (window.webkitAudioContext) return window.webkitAudioContext;
      }
      return null;
    }

    function offlineContextCtor() {
      if (typeof OfflineAudioContext !== 'undefined' && OfflineAudioContext) return OfflineAudioContext;
      if (typeof window !== 'undefined' && window) {
        if (window.OfflineAudioContext) return window.OfflineAudioContext;
        if (window.webkitOfflineAudioContext) return window.webkitOfflineAudioContext;
      }
      return null;
    }

    // The active session id is not part of a documented uiWorkspace contract; probe for
    // the obvious shapes and omit the field when nothing is readable (never scrape the DOM).
    function readCurrentSessionId(ctx) {
      if (!ctx || typeof ctx.get !== 'function') return null;
      const read = (value) => (typeof value === 'string' && value !== '' ? value : null);
      const safeGet = (name) => {
        try {
          return ctx.get(name);
        } catch (_getError) {
          return null;
        }
      };
      const workspace = safeGet('uiWorkspace');
      if (workspace) {
        let snapshot = null;
        try {
          if (typeof workspace.getSnapshot === 'function') snapshot = workspace.getSnapshot();
        } catch (_snapshotError) {
          snapshot = null;
        }
        const direct =
          read(snapshot && snapshot.sessionId) ||
          read(snapshot && snapshot.currentSessionId) ||
          read(snapshot && snapshot.activeSessionId) ||
          read(workspace.sessionId) ||
          read(workspace.currentSessionId) ||
          read(workspace.activeSessionId);
        if (direct) return direct;
      }
      const sessions = safeGet('sessions');
      const list = sessions && sessions.list;
      if (list && typeof list.getSnapshot === 'function') {
        let snapshot = null;
        try {
          snapshot = list.getSnapshot();
        } catch (_listError) {
          snapshot = null;
        }
        const id =
          read(snapshot && snapshot.activeId) ||
          read(snapshot && snapshot.currentId) ||
          read(snapshot && snapshot.sessionId);
        if (id) return id;
      }
      return null;
    }

    // ---------------------------------------------------------------- recording

    function mapCaptureError(error) {
      const name = error && error.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return voiceError('permission', '麦克风权限被拒绝 · Microphone access denied — macOS：系统设置 → 隐私与安全性 → 麦克风，允许 DeepSeek Harness 后重试 / allow it in System Settings → Privacy & Security → Microphone, then retry.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        return voiceError('deviceMissing', '没有检测到麦克风 · No microphone found — 连接麦克风或检查系统输入设备后重试 / connect one and retry.');
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        return voiceError('busy', '麦克风被其他应用占用 · Microphone is busy — 关掉占用麦克风的应用后重试 / quit the app using it, then retry.');
      }
      return voiceError('capture', '无法打开麦克风 · Could not open the microphone');
    }

    function stopStream(stream) {
      if (!stream || typeof stream.getTracks !== 'function') return;
      let tracks = [];
      try {
        tracks = stream.getTracks() || [];
      } catch (_trackError) {
        tracks = [];
      }
      for (const track of tracks) {
        try {
          if (track && typeof track.stop === 'function') track.stop();
        } catch (_stopError) {}
      }
    }

    class Recording {
      constructor() {
        this.startedAt = clock.now();
        this.stream = null;
        this.recorder = null;
        this.context = null;
        this.analyser = null;
        this.meterTimer = null;
        this.chunks = [];
        this.level = 0;
        this.cancelled = false;
        this.ready = this.open();
        // Never leave an unhandled rejection: the caller awaits `ready` when it matters.
        this.ready.catch(noop);
      }

      async open() {
        const media = typeof navigator !== 'undefined' && navigator ? navigator.mediaDevices : null;
        if (!media || typeof media.getUserMedia !== 'function') throw voiceError('unavailable', '麦克风不可用');
        let stream = null;
        try {
          stream = await media.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
        } catch (error) {
          throw mapCaptureError(error);
        }
        if (this.cancelled) {
          stopStream(stream);
          throw voiceError('cancelled', '已取消');
        }
        this.stream = stream;
        this.attachMeter(stream);
        const Recorder = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
        if (!Recorder) {
          this.teardown();
          throw voiceError('unavailable', '录音不可用');
        }
        const recorder = new Recorder(stream);
        this.recorder = recorder;
        recorder.ondataavailable = (event) => {
          if (event && event.data && event.data.size > 0) this.chunks.push(event.data);
        };
        recorder.start();
      }

      attachMeter(stream) {
        const Context = audioContextCtor();
        if (!Context) return;
        try {
          this.context = new Context();
          this.analyser = this.context.createAnalyser();
          this.analyser.fftSize = 256;
          const buffer = new Float32Array(this.analyser.fftSize);
          const source = this.context.createMediaStreamSource(stream);
          source.connect(this.analyser);
          this.meterTimer = clock.setInterval(() => {
            try {
              this.analyser.getFloatTimeDomainData(buffer);
              let sum = 0;
              for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index];
              this.level = Math.sqrt(sum / buffer.length);
            } catch (_meterError) {}
          }, 100);
        } catch (_meterSetupError) {
          this.analyser = null;
        }
      }

      stopMeter() {
        if (this.meterTimer !== null) {
          clock.clearInterval(this.meterTimer);
          this.meterTimer = null;
        }
        const context = this.context;
        this.context = null;
        this.analyser = null;
        if (context && typeof context.close === 'function') {
          try {
            const closed = context.close();
            if (closed && typeof closed.catch === 'function') closed.catch(noop);
          } catch (_closeError) {}
        }
      }

      teardown() {
        stopStream(this.stream);
        this.stream = null;
        this.stopMeter();
      }

      async stop() {
        try {
          await this.ready;
        } catch (error) {
          this.teardown();
          throw error;
        }
        if (this.cancelled) {
          this.teardown();
          throw voiceError('cancelled', '已取消');
        }
        const recorder = this.recorder;
        if (recorder && recorder.state !== 'inactive') {
          await new Promise((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            try {
              recorder.onstop = done;
              recorder.stop();
            } catch (_stopError) {
              done();
            }
            clock.setTimeout(done, 1000);
          });
        }
        this.teardown();
        return this.encode();
      }

      async encode() {
        if (this.chunks.length === 0) throw voiceError('empty', '没有录到声音');
        const mimeType = (this.recorder && this.recorder.mimeType) || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        const buffer = await blob.arrayBuffer();
        const Context = audioContextCtor();
        const Offline = offlineContextCtor();
        if (!Context || !Offline) throw voiceError('unavailable', '音频解码不可用');
        const context = this.context || new Context();
        let decoded = null;
        try {
          decoded = await context.decodeAudioData(buffer.slice(0));
        } catch (_decodeError) {
          throw voiceError('decode', '无法解码录音');
        }
        const seconds = Math.min(Number(decoded && decoded.duration) || 0, MAX_RECORD_MS / 1000);
        const frames = Math.max(1, Math.floor(seconds * SAMPLE_RATE));
        const offline = new Offline(1, frames, SAMPLE_RATE);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start(0);
        const rendered = await offline.startRendering();
        return encodeWave(rendered.getChannelData(0));
      }

      abort() {
        this.cancelled = true;
        const recorder = this.recorder;
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch (_abortError) {}
        }
        this.recorder = null;
        this.chunks = [];
        this.teardown();
      }
    }

    // ------------------------------------------------------------------ runtime

    const runtime = {
      ctx: null,
      speech: null,
      hotkey: parseHotkey(DEFAULT_HOTKEY),
      binding: { mode: 'pending', spec: DEFAULT_HOTKEY, notice: '' },
      state: STATE.IDLE,
      detail: '',
      candidates: null,
      press: null,
      locked: false,
      pending: null,
      pendingTimer: null,
      hideTimer: null,
      inflight: null,
      playing: null,
      speakToken: 0,
      transcribeAbort: null,
      hud: null,
      fallback: null,
      disposers: [],
    };

    function track(promise) {
      runtime.inflight = promise;
      const clear = () => {
        if (runtime.inflight === promise) runtime.inflight = null;
      };
      promise.then(clear, clear);
      return promise;
    }

    async function whenIdle() {
      for (let guard = 0; guard < 20; guard += 1) {
        const current = runtime.inflight;
        if (!current) return;
        await current.catch(noop);
        if (runtime.inflight === current) return;
      }
    }

    function status() {
      return {
        state: runtime.state,
        label: LABEL[runtime.state] || '',
        detail: runtime.detail,
        pending: Array.isArray(runtime.pending) ? runtime.pending.length : 0,
        hotkey: runtime.binding && runtime.binding.spec,
        binding: runtime.binding,
        fallback: !!runtime.fallback,
      };
    }

    // ---------------------------------------------------------------------- HUD

    function ensureHud() {
      if (runtime.hud) return runtime.hud;
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc || typeof doc.createElement !== 'function' || !doc.body || typeof doc.body.appendChild !== 'function') return null;
      const root = doc.createElement('div');
      root.setAttribute('data-dsh-voice-control', 'hud');
      root.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:32px',
        'transform:translateX(-50%)',
        'z-index:9999',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'max-width:min(720px,82vw)',
        'padding:9px 16px',
        'border-radius:999px',
        'background:rgba(18,20,26,.92)',
        'color:#f4f6fb',
        'font:13px/1.45 system-ui,-apple-system,"PingFang SC",sans-serif',
        'box-shadow:0 10px 30px rgba(0,0,0,.28)',
        'pointer-events:none',
        'opacity:.98',
        'transition:opacity .18s ease',
      ].join(';');
      const dot = doc.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex:none;background:#8b93a7';
      const label = doc.createElement('span');
      label.style.cssText = 'font-weight:600;white-space:nowrap';
      const detail = doc.createElement('span');
      detail.style.cssText = 'opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw';
      root.appendChild(dot);
      root.appendChild(label);
      root.appendChild(detail);
      doc.body.appendChild(root);
      runtime.hud = { root, dot, label, detail };
      return runtime.hud;
    }

    function formatCandidates(candidates) {
      if (!Array.isArray(candidates) || candidates.length === 0) return '';
      return candidates
        .map((candidate, index) => (index + 1) + '，' + String((candidate && candidate.title) || (candidate && candidate.sessionId) || ''))
        .join('；');
    }

    function renderHud() {
      const hud = ensureHud();
      if (!hud) return;
      const candidates = formatCandidates(runtime.candidates);
      hud.label.textContent = LABEL[runtime.state] || '';
      hud.detail.textContent = candidates || runtime.detail || '';
      hud.dot.style.background = DOT_COLOR[runtime.state] || DOT_COLOR.idle;
      hud.root.style.display = '';
      hud.root.setAttribute('data-state', runtime.state);
    }

    function hideHud() {
      if (!runtime.hud) return;
      runtime.hud.root.style.display = 'none';
    }

    function removeHud() {
      const hud = runtime.hud;
      runtime.hud = null;
      if (!hud) return;
      try {
        if (hud.root && typeof hud.root.remove === 'function') hud.root.remove();
      } catch (_removeError) {}
    }

    function announce(text) {
      const value = typeof text === 'string' ? text.trim() : '';
      if (!value) return '';
      runtime.detail = value;
      runtime.candidates = null;
      renderHud();
      if (runtime.hideTimer !== null) {
        clock.clearTimeout(runtime.hideTimer);
        runtime.hideTimer = null;
      }
      runtime.hideTimer = clock.setTimeout(() => {
        runtime.hideTimer = null;
        if (runtime.state === STATE.IDLE) hideHud();
      }, HUD_NOTICE_MS);
      return value;
    }

    // The in-app entry that always works, even when the chord is taken or the
    // window cannot receive the key. It is the advertised fallback in the HUD.
    function mountFallback() {
      if (runtime.fallback) return runtime.fallback;
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc || !doc.body || typeof doc.createElement !== 'function' || typeof doc.body.appendChild !== 'function') return null;
      const button = doc.createElement('button');
      button.setAttribute('data-dsh-voice-control', 'fallback');
      button.setAttribute('type', 'button');
      button.setAttribute('aria-label', '按住说话 / Hold to talk');
      button.textContent = '按住说话 / Hold to talk';
      button.style.cssText = [
        'position:fixed',
        'right:18px',
        'bottom:18px',
        'z-index:2147483000',
        'padding:8px 14px',
        'border-radius:999px',
        'border:1px solid rgba(140,170,255,.28)',
        'background:rgba(18,20,26,.9)',
        'color:#f4f6fb',
        'font:600 12px/1.2 system-ui,-apple-system,"PingFang SC",sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,.26)',
        'cursor:pointer',
      ].join(';');
      const down = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        beginPress();
      };
      const up = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        endPress();
      };
      const click = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
      };
      if (typeof button.addEventListener === 'function') {
        button.addEventListener('pointerdown', down);
        button.addEventListener('pointerup', up);
        button.addEventListener('pointerleave', up);
        button.addEventListener('pointercancel', up);
        button.addEventListener('click', click);
      }
      doc.body.appendChild(button);
      runtime.fallback = { button, down, up, click };
      return runtime.fallback;
    }

    function unmountFallback() {
      const fallback = runtime.fallback;
      runtime.fallback = null;
      if (!fallback || !fallback.button) return;
      try {
        if (typeof fallback.button.remove === 'function') fallback.button.remove();
        else if (fallback.button.parentNode && typeof fallback.button.parentNode.removeChild === 'function') {
          fallback.button.parentNode.removeChild(fallback.button);
        }
      } catch (_removeError) {}
    }

    function announceFocusTip() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem(HOTKEY_TIP_KEY) === '1') return false;
        if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(HOTKEY_TIP_KEY, '1');
      } catch (_storageError) {}
      announce('热键只在窗口聚焦时生效；右下角「按住说话」按钮始终可用。 / Hotkey works only while this window is focused; the corner “Hold to talk” button always works.');
      return true;
    }

    function scheduleHide() {
      if (runtime.hideTimer !== null) {
        clock.clearTimeout(runtime.hideTimer);
        runtime.hideTimer = null;
      }
      runtime.hideTimer = clock.setTimeout(() => {
        runtime.hideTimer = null;
        if (runtime.state === STATE.IDLE) hideHud();
      }, HUD_HIDE_MS);
    }

    function setState(nextState, patch) {
      runtime.state = nextState;
      runtime.detail = patch && typeof patch.hint === 'string' ? patch.hint : '';
      runtime.candidates = patch && Array.isArray(patch.candidates) ? patch.candidates : null;
      renderHud();
      if (nextState === STATE.IDLE) scheduleHide();
    }

    // --------------------------------------------------------------- host calls

    async function fetchJson(path, body, timeoutMs) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? clock.setTimeout(() => controller.abort(), timeoutMs || PLAN_TIMEOUT_MS) : null;
      try {
        const response = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
          signal: controller ? controller.signal : undefined,
        });
        const raw = typeof response.text === 'function' ? await response.text() : '';
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_parseError) {
          parsed = null;
        }
        const ok = response.status === undefined ? !!parsed : response.status < 400;
        return { status: response.status, body: parsed, ok: ok && !!parsed };
      } finally {
        if (timer !== null) clock.clearTimeout(timer);
      }
    }

    async function transcribeOverHttp(audioBytes) {
      const result = await fetchJson(TRANSCRIBE_PATH, { audioBase64: toBase64(audioBytes) }, TRANSCRIBE_TIMEOUT_MS);
      const body = result && result.body ? result.body : null;
      if (result && result.ok && body && body.ok === true) {
        return typeof body.text === 'string' ? body.text.trim() : '';
      }
      const reason = body && typeof body.error === 'string' ? body.error : `HTTP ${result ? result.status : '?'}`;
      throw voiceError('speech', reason);
    }

    function transcribe(audioBytes) {
      const speech = runtime.speech;
      if (!speech || typeof speech.transcribe !== 'function') {
        return transcribeOverHttp(audioBytes);
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      runtime.transcribeAbort = controller;
      return Promise.resolve(speech.transcribe({ audioBase64: toBase64(audioBytes) }, controller ? controller.signal : undefined))
        .then((result) => {
          if (!result || result.ok !== true) {
            const detail = result && result.error ? result.error : null;
            throw voiceError((detail && detail.code) || 'speech', (detail && detail.message) || '本机识别失败');
          }
          return result.value && typeof result.value.text === 'string' ? result.value.text.trim() : '';
        })
        .finally(() => {
          if (runtime.transcribeAbort === controller) runtime.transcribeAbort = null;
        });
    }

    function playAudio(payload) {
      return new Promise((resolve) => {
        const AudioCtor = typeof Audio !== 'undefined' ? Audio : null;
        let url = null;
        let audio = null;
        let timer = null;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer !== null) clock.clearTimeout(timer);
          try {
            if (audio && typeof audio.pause === 'function') audio.pause();
          } catch (_pauseError) {}
          try {
            if (url && typeof URL !== 'undefined' && URL && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
          } catch (_revokeError) {}
          if (runtime.playing && runtime.playing.audio === audio) runtime.playing = null;
          resolve();
        };
        if (!AudioCtor || !payload || typeof payload.audioBase64 !== 'string') {
          finish();
          return;
        }
        try {
          const bytes = base64ToBytes(payload.audioBase64);
          const blob = new Blob([bytes], { type: payload.mimeType || 'audio/wav' });
          url = URL.createObjectURL(blob);
          audio = new AudioCtor(url);
        } catch (_audioError) {
          finish();
          return;
        }
        audio.onended = finish;
        audio.onerror = finish;
        runtime.playing = { audio, finish };
        timer = clock.setTimeout(finish, (Number(payload.durationMs) || 0) + SPEAK_GUARD_MS);
        try {
          const played = audio.play();
          if (played && typeof played.catch === 'function') played.catch(finish);
        } catch (_playError) {
          finish();
        }
      });
    }

    function stopPlayback() {
      const playing = runtime.playing;
      if (!playing) return;
      runtime.playing = null;
      try {
        if (playing.audio && typeof playing.audio.pause === 'function') playing.audio.pause();
      } catch (_pauseError) {}
      playing.finish();
    }

    async function speak(text) {
      const sentence = typeof text === 'string' ? text.trim() : '';
      if (sentence === '') return;
      const token = ++runtime.speakToken;
      setState(STATE.SPEAKING, { hint: sentence });
      try {
        const response = await fetchJson(SPEAK_PATH, { text: sentence }, SPEAK_TIMEOUT_MS);
        const payload = response.body;
        if (!payload || payload.ok !== true || typeof payload.audioBase64 !== 'string') {
          throw voiceError(hostErrorCode(payload), hostErrorMessage(payload));
        }
        await playAudio(payload);
      } catch (error) {
        // TTS is a nice-to-have: the plan already ran, so surface it and move on.
        noteError(error && error.code ? error.code : 'tts', (error && error.message) || '播报失败');
      }
      if (token === runtime.speakToken && runtime.state === STATE.SPEAKING) {
        renderHud();
        runtime.state = STATE.IDLE;
        renderHud();
        scheduleHide();
      }
    }

    // ------------------------------------------------------------------- routing

    function isCandidate(value) {
      return !!value && typeof value === 'object' && typeof value.sessionId === 'string';
    }

    function clearPendingTimer() {
      if (runtime.pendingTimer !== null) {
        clock.clearTimeout(runtime.pendingTimer);
        runtime.pendingTimer = null;
      }
    }

    function armPendingTimer() {
      clearPendingTimer();
      runtime.pendingTimer = clock.setTimeout(() => {
        runtime.pendingTimer = null;
        runtime.pending = null;
      }, PENDING_TTL_MS);
    }

    function fail(error) {
      const code = (error && error.code) || 'error';
      const message = (error && error.message) || '出错了';
      noteError(code, message);
      runtime.locked = false;
      setState(STATE.ERROR, { hint: message });
      clock.setTimeout(() => {
        if (runtime.state === STATE.ERROR) setState(STATE.IDLE);
      }, ERROR_HIDE_MS);
    }

    async function applyPlan(plan, confirmation, utterance) {
      const sentence = typeof confirmation === 'string' ? confirmation : '';
      const action = plan && plan.action;
      if (action === 'ask') {
        runtime.pending = Array.isArray(plan.candidates) ? plan.candidates.filter(isCandidate).slice(0, 5) : [];
        armPendingTimer();
        await speak(sentence);
        // Stay armed: the next press is the answer, so the numbered choices stay visible.
        setState(STATE.IDLE, { hint: sentence, candidates: runtime.pending });
        runtime.locked = false;
        return;
      }
      const request = action === 'new'
        ? { action: 'new', text: utterance }
        : { action: 'prompt', sessionId: plan && plan.sessionId, text: utterance };
      const response = await fetchJson(DISPATCH_PATH, request);
      const payload = response.body;
      if (!payload || payload.ok !== true) throw voiceError(hostErrorCode(payload), hostErrorMessage(payload));
      runtime.pending = null;
      clearPendingTimer();
      await speak(sentence);
      setState(STATE.IDLE);
      runtime.locked = false;
    }

    async function route(utterance) {
      const text = String(utterance || '').trim();
      if (text === '') {
        setState(STATE.IDLE, { hint: '没听清，再说一次' });
        runtime.locked = false;
        return;
      }
      setState(STATE.ROUTING, { hint: text });
      const body = { utterance: text };
      const sessionId = readCurrentSessionId(runtime.ctx);
      if (sessionId) body.currentSessionId = sessionId;
      if (Array.isArray(runtime.pending) && runtime.pending.length > 0) body.pending = runtime.pending;
      const response = await fetchJson(PLAN_PATH, body);
      const payload = response.body;
      if (!payload || payload.ok !== true || !payload.plan) throw voiceError(hostErrorCode(payload), hostErrorMessage(payload));
      await applyPlan(payload.plan, payload.confirmation, text);
    }

    async function finishPress(press) {
      const recording = press.recording;
      const held = clock.now() - recording.startedAt;
      if (held < MIN_PRESS_MS) {
        recording.abort();
        runtime.locked = false;
        setState(STATE.IDLE, { hint: '按住说话' });
        return;
      }
      setState(STATE.TRANSCRIBING);
      let audio = null;
      try {
        audio = await recording.stop();
      } catch (error) {
        fail(error);
        return;
      }
      let text = '';
      try {
        text = await transcribe(audio);
      } catch (error) {
        fail(error);
        return;
      }
      if (text === '') {
        runtime.locked = false;
        setState(STATE.IDLE, { hint: '没听清，再说一次' });
        return;
      }
      try {
        await route(text);
      } catch (error) {
        fail(error);
      }
    }

    // ---------------------------------------------------------------- the press

    function beginPress() {
      if (runtime.press) return;
      if (runtime.locked) return;
      if (runtime.state === STATE.SPEAKING) stopPlayback();
      let recording = null;
      try {
        recording = new Recording();
      } catch (error) {
        fail(error);
        return;
      }
      runtime.press = { recording };
      runtime.locked = true;
      setState(STATE.LISTENING);
      recording.ready.catch((error) => {
        if (runtime.press && runtime.press.recording === recording) {
          runtime.press = null;
          runtime.locked = false;
          fail(error);
        }
      });
    }

    function endPress() {
      const press = runtime.press;
      if (!press) return;
      runtime.press = null;
      track(finishPress(press));
    }

    function abortPress() {
      const press = runtime.press;
      if (!press) return;
      runtime.press = null;
      try {
        press.recording.abort();
      } catch (_abortError) {}
      runtime.locked = false;
      setState(STATE.IDLE, { hint: '已取消' });
    }

    function preventDefault(event) {
      if (!event) return;
      try {
        if (typeof event.preventDefault === 'function') event.preventDefault();
      } catch (_preventError) {}
    }

    function install() {
      const doc = typeof document !== 'undefined' ? document : null;
      const keyTarget = doc && typeof doc.addEventListener === 'function' ? doc : null;
      const blurTarget =
        typeof window !== 'undefined' && window && typeof window.addEventListener === 'function' ? window : keyTarget;
      const onKeyDown = (event) => {
        if (!matchesHotkey(event, runtime.hotkey)) return;
        if (event.defaultPrevented) return;
        if (event.repeat) return;
        preventDefault(event);
        beginPress();
      };
      const onKeyUp = (event) => {
        if (!event) return;
        const matched = matchesHotkey(event, runtime.hotkey);
        const released = !!runtime.press && modifierReleased(event, runtime.hotkey);
        if (!matched && !released) return;
        preventDefault(event);
        endPress();
      };
      const onBlur = () => {
        abortPress();
      };
      const bound = bindHotkey(keyTarget, runtime.hotkey.spec, { onKeyDown, onKeyUp });
      runtime.binding = bound;
      if (bound.ok) {
        runtime.hotkey = bound.binding;
        if (bound.mode === 'fallback') announce(bound.notice);
        else announceFocusTip();
      } else {
        announce(bound.notice);
      }
      if (blurTarget && typeof blurTarget.addEventListener === 'function') {
        try {
          blurTarget.addEventListener('blur', onBlur);
        } catch (_blurError) {}
      }
      mountFallback();
      return () => {
        if (bound.ok && keyTarget && typeof keyTarget.removeEventListener === 'function') {
          keyTarget.removeEventListener('keydown', onKeyDown);
          keyTarget.removeEventListener('keyup', onKeyUp);
        }
        if (blurTarget && typeof blurTarget.removeEventListener === 'function') {
          blurTarget.removeEventListener('blur', onBlur);
        }
        unmountFallback();
        removeHud();
      };
    }

    // --------------------------------------------------------------------- apply

    function apply(ctx) {
      runtime.ctx = ctx || null;
      runtime.hotkey = parseHotkey(readHotkeySpec());

      const disposers = [];
      const pushDisposer = (candidate) => {
        if (typeof candidate === 'function') disposers.push(candidate);
      };

      // `remote.speech` is a guarded namespace service: it is only readable through an
      // inject scope that names it (same convention as dsh-realtime-voice).
      if (ctx && typeof ctx.inject === 'function') {
        try {
          const scope = ctx.inject(['remote.speech'], (injected) => {
            try {
              runtime.speech = injected.remote.speech;
            } catch (_scopeError) {
              runtime.speech = null;
            }
            return () => {
              runtime.speech = null;
            };
          });
          if (scope && typeof scope.dispose === 'function') pushDisposer(() => scope.dispose());
          else pushDisposer(scope);
        } catch (_injectError) {
          runtime.speech = null;
        }
      }
      if (!runtime.speech && ctx && typeof ctx.get === 'function') {
        try {
          const remote = ctx.get('remote');
          if (remote && remote.speech) runtime.speech = remote.speech;
        } catch (_remoteError) {}
      }

      if (ctx && typeof ctx.effect === 'function') {
        pushDisposer(ctx.effect(() => install(), 'voice-control: hotkey listeners'));
      } else {
        pushDisposer(install());
      }

      const api = {
        start: () => beginPress(),
        stop: () => endPress(),
        status: () => status(),
        plan: (text) => track(route(text)),
      };
      try {
        if (typeof window !== 'undefined' && window) window.__dshVoiceControl = api;
      } catch (_exposeError) {}

      return () => {
        try {
          if (runtime.transcribeAbort && typeof runtime.transcribeAbort.abort === 'function') runtime.transcribeAbort.abort();
        } catch (_abortError) {}
        runtime.transcribeAbort = null;
        stopPlayback();
        abortPress();
        clearPendingTimer();
        if (runtime.hideTimer !== null) {
          clock.clearTimeout(runtime.hideTimer);
          runtime.hideTimer = null;
        }
        runtime.pending = null;
        runtime.locked = false;
        for (const dispose of disposers) {
          try {
            dispose();
          } catch (_disposeError) {}
        }
        disposers.length = 0;
        removeHud();
        try {
          if (typeof window !== 'undefined' && window) delete window.__dshVoiceControl;
        } catch (_deleteError) {}
        runtime.ctx = null;
        runtime.speech = null;
      };
    }

    function reset() {
      clearPendingTimer();
      if (runtime.hideTimer !== null) {
        clock.clearTimeout(runtime.hideTimer);
        runtime.hideTimer = null;
      }
      runtime.pending = null;
      runtime.detail = '';
      runtime.candidates = null;
      runtime.locked = false;
      runtime.press = null;
      runtime.state = STATE.IDLE;
      runtime.inflight = null;
    }

    const inject = ['remote'];

    return {
      inject,
      apply,
      __test: {
        encodeWave,
        toBase64,
        base64ToBytes,
        parseHotkey,
        matchesHotkey,
        modifierReleased,
        hotkeyCandidates,
        bindHotkey,
        hotkeyNotice,
        readCurrentSessionId,
        setClock,
        resetClock,
        whenIdle,
        status,
        reset,
        MIN_PRESS_MS,
        DEFAULT_HOTKEY,
      },
    };
  },
});
