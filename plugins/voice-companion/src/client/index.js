// Orchestration: avatar panel + audio engine + host routes.
// Plain fragment (no import/export); scripts/build-client.mjs wraps everything into the
// ModuleLoader factory. Depends on `createCharacter` art in characters.js, `createAvatar`
// (avatar.js), `createAudioEngine` (audio.js), `polish` (polish.js), `createDictation`
// (dictation.js) and `createHotkey` (hotkey.js) — build-client.mjs keeps that order.
// `voice-profile.js` is the one real ESM import: it is also loaded by node tests, so
// the build script must inline it as well.

import { clampSpeed, normalizeProfile, readVoiceProfile, writeVoiceProfile } from './voice-profile.js';

const API = '/api/voice-companion';
const POLL_MS = 1500;
const CHARACTER_KEY = 'dsh.voice-companion.character';
// The face store is owned by avatar.js; the bundle inlines both modules into one
// scope, so this module keeps its own alias instead of redeclaring FACE_KEY.
const FACE_STORE_KEY = 'dsh.voice-companion.face';
const MODE_KEY = 'dsh.voice-companion.mode';
// Pre-synthesised so the first 0.9 s after the user stops talking is never dead air:
// the filler starts playing while the model is still thinking.
const FILLERS = ['嗯，我看一下。', '好呀。', '我在呢。'];

function storedValue(key) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch (_error) {
    return '';
  }
}

function storeValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    /* private mode: the choice just does not survive a reload */
  }
}

// 刷新后若只存了 'custom' 而图被清掉（换设备、清缓存），回落到内置形象。
function storedFace() {
  try {
    const value = JSON.parse(storedValue(FACE_STORE_KEY));
    return value && typeof value.src === 'string' && /^data:image\//.test(value.src) ? value : null;
  } catch (_error) {
    return null;
  }
}

function voiceError(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

async function requestJson(path, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const response = await fetch(API + path, {
      method: (options && options.method) || 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_error) {
      throw voiceError('format', 'host returned non-JSON: ' + text.slice(0, 120));
    }
    if (!response.ok || !body || body.ok !== true) {
      const message = body && (body.message || (body.error && body.error.message));
      throw voiceError(body && body.code ? body.code : 'http', message || 'request failed (' + response.status + ')');
    }
    return body;
  } catch (error) {
    if (error && error.name === 'AbortError') throw voiceError('timeout', '请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function apply(ctx) {
  const runtime = {
    avatar: null,
    engine: null,
    dictation: null,
    hotkey: null,
    disposers: [],
    history: [],
    cursor: 0,
    poller: null,
    fillers: [],
    fillerIndex: 0,
    active: false,
    sessionId: undefined,
    character: resolveCharacter(storedValue(CHARACTER_KEY), storedFace()).id,
    voiceProfile: readVoiceProfile(),
    mode: storedValue(MODE_KEY) === 'dictation' ? 'dictation' : 'call',
    logger: (ctx && ctx.logger) || null,
  };

  const log = (step, detail) => {
    try {
      console.info('[voice-companion]', detail === undefined ? step : step + ' ' + JSON.stringify(detail));
    } catch (_error) {
      /* console may be gone after HMR */
    }
    if (runtime.logger && runtime.logger.info) {
      try {
        runtime.logger.info('voice-companion: ' + step);
      } catch (_error) {
        /* noop */
      }
    }
  };

  async function speak(text, voiceId) {
    const body = { text, character: runtime.character, voiceMap: runtime.voiceProfile.map };
    if (voiceId) body.voiceId = voiceId;
    const payload = await requestJson('/speak', { method: 'POST', body }, 30000);
    return payload;
  }

  async function warmFillers() {
    if (runtime.fillers.length) return;
    const payloads = await Promise.all(
      FILLERS.map((text) =>
        requestJson(
          '/speak',
          { method: 'POST', body: { text, character: runtime.character, voiceMap: runtime.voiceProfile.map } },
          30000,
        ).catch(
          () => null,
        ),
      ),
    );
    runtime.fillers = payloads.filter((payload) => payload && payload.audioBase64);
    log('fillers:warm', { count: runtime.fillers.length, character: runtime.character });
  }

  /**
   * Dictation mode: the same microphone feed, but each recognised sentence lands in
   * the composer instead of the conversation.
   * @param {string} text
   */
  function dictate(text) {
    const cleaned = typeof polish === 'function' ? polish(text) : text;
    const inserted = runtime.dictation ? runtime.dictation.insert(cleaned) : false;
    runtime.avatar && runtime.avatar.setPartial(inserted ? '' : cleaned);
    runtime.avatar && runtime.avatar.setSubtitle(cleaned, { role: 'user' });
    return inserted;
  }

  function playFiller() {
    if (!runtime.fillers.length) return false;
    const payload = runtime.fillers[runtime.fillerIndex % runtime.fillers.length];
    runtime.fillerIndex += 1;
    void runtime.engine.playClip(payload);
    return true;
  }

  async function handleTurn(utterance) {
    runtime.avatar && runtime.avatar.setPartial('');
    runtime.avatar && runtime.avatar.setSubtitle(utterance, { role: 'user' });
    runtime.engine.setThinking();
    playFiller();
    let reply;
    try {
      reply = await requestJson(
        '/turn',
        {
          method: 'POST',
          body: {
            utterance,
            character: runtime.character,
            history: runtime.history.slice(-6),
            voiceMap: runtime.voiceProfile.map,
          },
        },
        45000,
      );
    } catch (error) {
      log('turn:error', error && error.message);
      runtime.avatar && runtime.avatar.setState('error');
      await runtime.engine.speak(['抱歉，我这边出了点问题。']);
      return;
    }
    const say = Array.isArray(reply.say) && reply.say.length ? reply.say : [reply.reply || '我在。'];
    runtime.history.push({ role: 'user', text: utterance });
    runtime.history.push({ role: 'assistant', text: say.join('') });
    if (runtime.history.length > 24) runtime.history.splice(0, runtime.history.length - 24);
    runtime.avatar && runtime.avatar.setSubtitle(say.join(''), { role: 'assistant' });
    // The host picks a voice per sentence (character base, bright or soft); keep the
    // pairing so one reply never changes timbre halfway through.
    const voices = Array.isArray(reply.voices) ? reply.voices : [];
    await runtime.engine.speak(
      say.map((text, index) => ({ text, voiceId: voices[index], rate: runtime.voiceProfile.speed })),
    );
  }

  async function pollEvents() {
    if (!runtime.active) return;
    try {
      const body = await requestJson('/events?since=' + runtime.cursor, null, 10000);
      runtime.cursor = typeof body.cursor === 'number' ? body.cursor : runtime.cursor;
      for (const event of body.events || []) {
        log('event', { id: event.id, type: event.type });
        runtime.avatar && runtime.avatar.setSubtitle(event.text, { role: 'assistant' });
        runtime.engine.interrupt();
        await runtime.engine.speak([{ text: event.text, voiceId: event.voiceId }]);
      }
    } catch (error) {
      log('events:error', error && error.message);
    }
  }

  function startPolling() {
    if (runtime.poller) return;
    runtime.poller = setInterval(() => {
      void pollEvents();
    }, POLL_MS);
  }

  function stopPolling() {
    if (!runtime.poller) return;
    clearInterval(runtime.poller);
    runtime.poller = null;
  }

  async function startCall() {
    if (runtime.active) return;
    runtime.active = true;
    runtime.avatar && runtime.avatar.setSubtitle('喂，我在。', { role: 'assistant' });
    await runtime.engine.start();
    if (!runtime.engine.listening) {
      runtime.active = false;
      return;
    }
    startPolling();
    void warmFillers();
    try {
      await runtime.engine.speak(['喂，我在。']);
    } catch (_error) {
      /* silence is fine */
    }
  }

  function endCall() {
    runtime.active = false;
    stopPolling();
    runtime.engine.interrupt();
    runtime.engine.stop();
    runtime.avatar && runtime.avatar.setState('idle');
    runtime.avatar && runtime.avatar.setSubtitle('通话结束。');
  }

  /**
   * Switch the cast. The picker calls this; the choice survives a reload and the
   * pre-warmed fillers are dropped so they never come out in the previous voice.
   * @param {string} id
   */
  function setCharacter(id) {
    const next = resolveCharacter(id, storedFace()).id;
    if (next === runtime.character) return runtime.character;
    runtime.character = next;
    storeValue(CHARACTER_KEY, next);
    runtime.fillers = [];
    runtime.fillerIndex = 0;
    if (runtime.avatar) {
      runtime.avatar.setCharacter(next);
      const labels = resolveCharacter(next, storedFace()).labels || {};
      runtime.avatar.setSubtitle(labels.idle || '');
    }
    log('character', { id: next });
    return next;
  }

  /**
   * Persist one voice profile and drop the pre-warmed fillers so the next line
   * already uses the new voice. The settings panel calls this; it touches no
   * call state, only the profile.
   * @param {{ map?: Record<string, string>, speed?: number }} profile
   */
  function setVoiceProfile(profile) {
    runtime.voiceProfile = writeVoiceProfile(normalizeProfile(profile));
    runtime.fillers = [];
    runtime.fillerIndex = 0;
    log('voice', { map: runtime.voiceProfile.map, speed: runtime.voiceProfile.speed });
    return runtime.voiceProfile;
  }

  /**
   * Audition one voice without starting or stopping a call: a fixed line at the
   * current speed, no history and no polling.
   * @param {unknown} voiceId
   */
  function previewVoice(voiceId) {
    if (!runtime.engine) return;
    const id = typeof voiceId === 'string' && voiceId.trim() !== '' ? voiceId.trim() : undefined;
    void runtime.engine.speak([
      {
        text: '你好呀，我是大肥鱼，现在的声音就是这样。',
        voiceId: id,
        rate: clampSpeed(runtime.voiceProfile.speed),
      },
    ]);
  }

  /**
   * call = talk to 大肥鱼 (replies are spoken); dictation = the same microphone feed
   * lands in the composer instead.
   * @param {'call'|'dictation'} next
   */
  function setMode(next) {
    runtime.mode = next === 'dictation' ? 'dictation' : 'call';
    storeValue(MODE_KEY, runtime.mode);
    if (runtime.avatar) runtime.avatar.setMode(runtime.mode);
    log('mode', { mode: runtime.mode });
    return runtime.mode;
  }

  function mount() {
    if (typeof document === 'undefined' || !document.body) return;
    const host = document.createElement('div');
    host.id = 'dsh-voice-companion-root';
    document.body.appendChild(host);
    runtime.host = host;

    runtime.avatar = createAvatar({
      mount: host,
      character: runtime.character,
      mode: runtime.mode,
      onAction: (name, value) => {
        if (name === 'start') void startCall();
        if (name === 'end') endCall();
        if (name === 'character') setCharacter(value);
        if (name === 'mode') setMode(value);
        if (name === 'face') log('face', value);
        if (name === 'voice') setVoiceProfile(value && typeof value === 'object' && value.profile ? value.profile : value);
        if (name === 'preview') previewVoice(value && typeof value === 'object' ? value.voiceId : value);
      },
    });

    runtime.engine = createAudioEngine({
      onState: (state) => {
        runtime.avatar && runtime.avatar.setState(state.phase);
        if (state.phase === 'error' && state.error) {
          runtime.avatar && runtime.avatar.setSubtitle(state.error);
        }
      },
      onPartial: (text) => runtime.avatar && runtime.avatar.setPartial(text),
      onLevel: (level) => runtime.avatar && runtime.avatar.setLevel(level),
      onFinal: (text) => (runtime.mode === 'dictation' ? dictate(text) : handleTurn(text)),
      speakSentence: (text, voiceId) => speak(text, voiceId),
      transcribeRemote: runtime.transcribeRemote,
      transcribeHttp: async (audioBase64) => {
        const body = await requestJson('/transcribe', { method: 'POST', body: { audioBase64 } }, 60000);
        return body.text;
      },
    });

    // Dictation: insert polished speech into the DSH composer. The slot registration
    // is best-effort — without React the companion still talks, it just cannot type.
    runtime.dictation = createDictation({
      onStatus: (status) => log('dictation:status', status),
      onSubtitle: (text) => runtime.avatar && runtime.avatar.setPartial(text),
      onInserted: (text) => log('dictation:inserted', { chars: text.length }),
      onError: (message) => runtime.avatar && runtime.avatar.setSubtitle(message),
    });
    try {
      runtime.dictation.install(ctx, typeof require === 'function' ? require : undefined);
    } catch (error) {
      log('dictation:install-failed', error && error.message);
    }

    // Push-to-talk routing (Ctrl+Shift+Space): speak once, the host decides whether
    // that is a new task, a resume, or a confirmation of the previous one.
    runtime.hotkey = createHotkey({
      requestJson,
      currentSessionId: () => runtime.sessionId,
      onPhase: (phase) => log('hotkey:phase', phase),
      onSubtitle: (text) => runtime.avatar && runtime.avatar.setSubtitle(text),
    });
    try {
      runtime.hotkey.install();
    } catch (error) {
      log('hotkey:install-failed', error && error.message);
    }

    // Prefer the shipped local speech Remote (no audio leaves the machine); the host
    // /transcribe route stays as the fallback when the bundle is disabled.
    runtime.disposers.push(
      ctx.inject(['remote.speech'], (scope) => {
        try {
          const service = scope.remote.speech;
          if (service && typeof service.transcribe === 'function') {
            runtime.engine.transcribeRemote = (request) => service.transcribe(request);
            void service.prepare && service.prepare();
          }
        } catch (_error) {
          /* fallback stays null */
        }
        return () => {};
      }),
    );

    window.__dshVoiceCompanion = {
      start: startCall,
      stop: endCall,
      status: () => ({ active: runtime.active, phase: runtime.engine && runtime.engine.phase, cursor: runtime.cursor }),
      say: (text) => runtime.engine.speak([text]),
      character: (id) => (id === undefined ? runtime.character : setCharacter(id)),
      mode: (next) => (next === undefined ? runtime.mode : setMode(next)),
      voice: () => runtime.voiceProfile,
      setVoice: (profile) => setVoiceProfile(profile),
      session: (id) => {
        if (id !== undefined) runtime.sessionId = id;
        return runtime.sessionId;
      },
    };
  }

  mount();

  return () => {
    endCall();
    for (const dispose of runtime.disposers) {
      try {
        dispose();
      } catch (_error) {
        /* noop */
      }
    }
    runtime.disposers.length = 0;
    runtime.hotkey && runtime.hotkey.dispose();
    runtime.dictation && runtime.dictation.dispose();
    runtime.engine && runtime.engine.dispose();
    runtime.avatar && runtime.avatar.dispose();
    if (runtime.host && runtime.host.remove) runtime.host.remove();
    delete window.__dshVoiceCompanion;
  };
}

// No `inject` here on purpose: `webServer` is a Host service, and the renderer's
// web boot fails when a client entry waits on a service that never exists
// ("pending (waiting for service: webServer)"). This half talks to the Host
// through same-origin /api routes and pulls `remote.speech` opportunistically.
const voiceCompanion = {
  apply(ctx) {
    const disposer = apply(ctx);
    if (ctx && ctx.effect) ctx.effect(() => disposer);
    return disposer;
  },
  __test: { requestJson, apply },
};
