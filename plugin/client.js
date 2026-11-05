window.__ModuleLoader__.load({
  id: 'dsh-realtime-voice',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'realtime-voice';
    const SAMPLE_RATE = 16000;
    const FRAME = 320; // 20 ms @ 16 kHz
    const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;

    // ---------------------------------------------------------------- locale
    const zh = {
      listen: '开始实时语音输入',
      stop: '停止实时语音输入',
      starting: '正在打开麦克风…',
      listening: '正在听… 停顿约 0.7 秒即断句写入输入框',
      partialHint: '识别中',
      empty: '没有识别到语音',
      insert: '插入',
      pending: '草稿已变化，转写结果已保留，可手动插入到光标处。',
      failed: '实时语音输入失败：{message}',
      permissionDenied: '麦克风权限被拒绝，请在系统/浏览器设置里允许后重试。',
      unavailable: '当前浏览器无法录音。',
      notReady: '本地语音模型尚未就绪，请先在插件管理里完成“语音输入”的模型准备。',
      preparing: '正在准备本地语音模型…',
      noInput: '输入框不可用，暂时无法插入文字。',
      stopped: '已停止实时语音输入。',
    };
    const en = {
      listen: 'Start realtime dictation',
      stop: 'Stop realtime dictation',
      starting: 'Opening the microphone…',
      listening: 'Listening… a ~0.7 s pause ends the sentence and writes it into the composer',
      partialHint: 'Recognizing',
      empty: 'No speech recognized',
      insert: 'Insert',
      pending: 'Your draft changed. The transcript is kept — insert it at the cursor.',
      failed: 'Realtime dictation failed: {message}',
      permissionDenied: 'Microphone permission was denied. Allow it and try again.',
      unavailable: 'This browser cannot record audio.',
      notReady: 'The local speech model is not ready yet. Prepare “Voice input” in the plugin manager first.',
      preparing: 'Preparing the local speech model…',
      noInput: 'The composer is unavailable, so the transcript cannot be inserted.',
      stopped: 'Realtime dictation stopped.',
    };

    // ------------------------------------------------------------ audio math
    function rms(samples) {
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      return samples.length ? Math.sqrt(sum / samples.length) : 0;
    }

    function concatFloat(parts) {
      let length = 0;
      for (const part of parts) length += part.length;
      const out = new Float32Array(length);
      let at = 0;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    }

    function float32ToPcm16(samples) {
      const out = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        out[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
      }
      return out;
    }

    function pcm16ToWav(pcm) {
      const bytes = new Uint8Array(44 + pcm.length * 2);
      const view = new DataView(bytes.buffer);
      const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i); };
      text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE');
      text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, pcm[i], true);
      return bytes;
    }

    function bytesToBase64(bytes) {
      let text = '';
      const CHUNK = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        text += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
      }
      return btoa(text);
    }

    /** Keep successive partial transcripts of one growing buffer; snapshots may revise. */
    function reconcilePartial(previous, next) {
      if (!next) return previous || '';
      if (!previous) return next;
      if (next === previous || next.startsWith(previous)) return next;
      if (previous.startsWith(next)) return previous;
      return next;
    }

    // ------------------------------------------------------------------- VAD
    /**
     * Energy VAD with pre-roll, pause endpointing and a calibration window.
     * The first ~400 ms only estimates the noise floor, so a loud room cannot
     * open a segment before the device level is known. Threshold is frozen once
     * a segment starts and re-estimated after each one.
     */
    function createVad(config) {
      const preRollFrames = Math.max(1, Math.round(config.preRollMs / FRAME_MS));
      const noiseWindow = [];
      const CALIBRATION_MS = 250;
      let pre = [];
      let segment = [];
      let voicedMs = 0;
      let silentMs = 0;
      let segmentMs = 0;
      let active = false;
      let elapsedMs = 0;
      let threshold = config.threshold;

      function calibrate(level) {
        noiseWindow.push(level);
        while (noiseWindow.length > 25) noiseWindow.shift();
        if (noiseWindow.length < 8) return;
        const sorted = noiseWindow.slice().sort((a, b) => a - b);
        const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
        threshold = Math.min(0.03, Math.max(0.006, p90 * 3));
      }

      function take() {
        const samples = concatFloat(segment);
        pre = []; segment = []; voicedMs = 0; silentMs = 0; segmentMs = 0; active = false;
        noiseWindow.length = 0;
        threshold = config.threshold;
        return samples;
      }

      return {
        get active() { return active; },
        current() { return concatFloat(segment); },
        reset() {
          pre = []; segment = []; voicedMs = 0; silentMs = 0; segmentMs = 0; active = false;
          elapsedMs = 0; noiseWindow.length = 0; threshold = config.threshold;
        },
        push(frame) {
          // The caller reuses one scratch buffer, so every retained frame must be a copy.
          const copy = frame.slice();
          const level = rms(copy);
          if (!active && elapsedMs < CALIBRATION_MS) {
            elapsedMs += FRAME_MS;
            calibrate(level);
            pre.push(copy);
            while (pre.length > preRollFrames) pre.shift();
            return { level, calibrating: true };
          }
          const voiced = level >= threshold;
          if (!active) {
            elapsedMs += FRAME_MS;
            pre.push(copy);
            while (pre.length > preRollFrames) pre.shift();
            voicedMs = voiced ? voicedMs + FRAME_MS : 0;
            if (voicedMs >= config.minSpeechMs) {
              active = true;
              segment = pre.slice();
              pre = [];
              segmentMs = segment.length * FRAME_MS;
              silentMs = 0;
              return { level, started: true };
            }
            if (!voiced) calibrate(level);
            return { level };
          }
          segment.push(copy);
          segmentMs += FRAME_MS;
          silentMs = voiced ? 0 : silentMs + FRAME_MS;
          if (silentMs >= config.minSilenceMs) return { level, segment: take(), reason: 'pause' };
          if (segmentMs >= config.maxSegmentMs) return { level, segment: take(), reason: 'limit' };
          return { level };
        },
      };
    }

    // --------------------------------------------------------------- runtime
    const debug = (typeof window !== 'undefined')
      ? (window.__realtimeVoiceDebug = window.__realtimeVoiceDebug || { clicks: 0, steps: [], error: null })
      : { clicks: 0, steps: [], error: null };
    function note(step, detail) {
      const line = detail === undefined ? step : step + ' ' + (() => { try { return JSON.stringify(detail); } catch (_) { return String(detail); } })();
      debug.steps.push(line);
      if (debug.steps.length > 80) debug.steps.shift();
      try { console.info('[realtime-voice]', line); } catch (_) {}
    }

    const stores = new Map();
    const engines = new Map();
    let runtime = null;

    /** Translator for components rendered without the slot's locale-bound `t` prop. */
    function fallbackTranslate(key, vars) {
      const dict = runtime && runtime.dict;
      if (!dict) return key;
      const text = dict[key] === undefined ? key : dict[key];
      if (!vars) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
    }

    function createStore() {
      let state = { phase: 'idle', partial: '', level: 0, error: '', pending: '', segmentActive: false, busyText: '' };
      const listeners = new Set();
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        set(patch) {
          const next = { ...state, ...patch };
          let changed = false;
          for (const key of Object.keys(patch)) if (next[key] !== state[key]) changed = true;
          if (!changed) return;
          state = next;
          for (const listener of listeners) listener();
        },
      };
    }

    function storeFor(sessionId) {
      let store = stores.get(sessionId);
      if (!store) { store = createStore(); stores.set(sessionId, store); }
      return store;
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    // ---------------------------------------------------------------- engine
    function createEngine(deps) {
      const store = deps.store;
      let media = null;
      let audioContext = null;
      let source = null;
      let processor = null;
      let sink = null;
      let vad = null;
      let ticker = null;
      let leftover = new Float32Array(0);
      let frameScratch = new Float32Array(FRAME);
      let frameFill = 0;
      let generation = 0;
      let inFlight = false;
      let lastCallAt = 0;
      let lastPartial = '';
      let previousInsert = '';
      let span = null;
      let levelFrames = 0;
      let inputActions = null;
      let translate = fallbackTranslate;
      let callController = null;
      let selection = null;
      let running = false;

      // Measured on this machine (sim/RESULTS.md): 700 ms cadence keeps every
      // partial call under the 600 ms comfort budget up to a 12 s window.
      const cadenceMs = 700;
      const slowCadenceMs = 1200;
      const partialWindowMs = 12000;
      const vadConfig = {
        threshold: 0.01,
        minSpeechMs: 120,
        minSilenceMs: 600,
        preRollMs: 300,
        maxSegmentMs: 15000,
      };

      function setActions(actions) { if (actions) inputActions = actions; }
      function setTranslator(t) { if (typeof t === 'function') translate = t; }

      /** Bound a remote call so a silent transport never freezes the recorder. */
      function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error((label || 'call') + ' timed out after ' + ms + ' ms'));
          }, ms);
          Promise.resolve(promise).then((value) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(value);
          }, (error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            reject(error);
          });
        });
      }

      function reportError(message) {
        store.set({ phase: 'error', error: message, partial: '', level: 0, busyText: '' });
      }

      async function transcribe(samples) {
        const wav = pcm16ToWav(float32ToPcm16(samples));
        const request = { audioBase64: bytesToBase64(wav) };
        if (selection && selection.providerId) request.providerId = selection.providerId;
        if (selection && selection.language) request.language = selection.language;
        const signal = callController ? callController.signal : undefined;
        return await deps.transcribe(request, signal);
      }

      function insert(text) {
        if (!text) return true;
        const actions = inputActions;
        if (!actions) return false;
        let target = span || actions.captureInsertion();
        if (actions.insertText(text, target)) { span = actions.captureInsertion(); previousInsert = text; return true; }
        target = actions.captureInsertion();
        if (actions.insertText(text, target)) { span = actions.captureInsertion(); previousInsert = text; return true; }
        return false;
      }

      function withSeparator(text) {
        if (!previousInsert || !text) return text;
        const tail = previousInsert[previousInsert.length - 1];
        const head = text[0];
        if (/[A-Za-z0-9]$/.test(tail) && /^[A-Za-z0-9]/.test(head)) return ' ' + text;
        return text;
      }

      async function finalize(samples, reason) {
        const run = ++generation;
        inFlight = false;
        vad && vad.reset();
        store.set({ partial: '', segmentActive: false });
        if (!samples || samples.length < SAMPLE_RATE * 0.2) return;
        inFlight = true;
        try {
          const result = await withTimeout(transcribe(samples), 20000, 'speech transcribe');
          if (run !== generation) return;
          if (!result || result.ok !== true) {
            const message = result && result.error ? result.error.message : 'unknown';
            reportError(translate('failed', { message }));
            return;
          }
          const text = (result.value && result.value.text ? result.value.text : '').trim();
          if (!text) { store.set({ partial: '' }); return; }
          const chunk = withSeparator(text);
          if (insert(chunk)) {
            store.set({ pending: '', partial: '' });
            if (reason === 'limit') store.set({ phase: 'listening' });
          } else {
            store.set({ pending: chunk, partial: '' });
          }
        } catch (error) {
          if (run === generation) reportError(translate('failed', { message: (error && error.message) || String(error) }));
        } finally {
          if (run === generation) inFlight = false;
        }
      }

      async function tick() {
        if (!vad || !vad.active || inFlight) return;
        if (store.get().phase !== 'listening') return;
        const now = Date.now();
        const full = vad.current();
        if (full.length < SAMPLE_RATE * 0.45) return;
        // Long utterances cost more per pass; back off instead of queueing work.
        const cadence = full.length > SAMPLE_RATE * 8 ? slowCadenceMs : cadenceMs;
        if (now - lastCallAt < cadence) return;
        const truncated = full.length > SAMPLE_RATE * (partialWindowMs / 1000);
        const samples = truncated ? full.subarray(full.length - SAMPLE_RATE * (partialWindowMs / 1000)) : full;
        lastCallAt = now;
        inFlight = true;
        const run = ++generation;
        try {
          const result = await withTimeout(transcribe(samples), 20000, 'speech transcribe');
          if (run !== generation) return;
          if (!result || result.ok !== true) {
            const message = result && result.error ? result.error.message : 'unknown';
            reportError(translate('failed', { message }));
            return;
          }
          const text = (result.value && result.value.text ? result.value.text : '').trim();
          lastPartial = reconcilePartial(truncated ? '' : lastPartial, text);
          store.set({ partial: truncated && lastPartial ? '…' + lastPartial : lastPartial });
        } catch (error) {
          if (run === generation) reportError(translate('failed', { message: (error && error.message) || String(error) }));
        } finally {
          if (run === generation) inFlight = false;
        }
      }

      function onFrame(frame) {
        if (!vad) return;
        const outcome = vad.push(frame);
        levelFrames += 1;
        if (levelFrames % 3 === 0) store.set({ level: Math.min(1, outcome.level * 9) });
        if (outcome.started) {
          lastPartial = '';
          store.set({ segmentActive: true, partial: '' });
        }
        if (outcome.segment) {
          const samples = outcome.segment;
          void finalize(samples, outcome.reason);
        }
      }

      function feed(samples) {
        let data = samples;
        if (leftover.length) {
          const merged = new Float32Array(leftover.length + data.length);
          merged.set(leftover, 0); merged.set(data, leftover.length);
          data = merged;
        }
        let offset = 0;
        while (data.length - offset >= FRAME) {
          frameScratch.set(data.subarray(offset, offset + FRAME));
          offset += FRAME;
          onFrame(frameScratch);
        }
        leftover = data.subarray(offset).slice();
      }

      function resampleTo16k(input, sourceRate) {
        if (sourceRate === SAMPLE_RATE) return input;
        const ratio = sourceRate / SAMPLE_RATE;
        const length = Math.max(1, Math.floor(input.length / ratio));
        const out = new Float32Array(length);
        for (let i = 0; i < length; i += 1) {
          const position = i * ratio;
          const base = Math.floor(position);
          const fraction = position - base;
          const a = input[base] || 0;
          const b = input[base + 1] || a;
          out[i] = a + (b - a) * fraction;
        }
        return out;
      }

      async function start() {
        note('start', store.get().phase);
        if (running) return;
        running = true;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof window.AudioContext === 'undefined') {
          running = false;
          reportError(translate('unavailable'));
          return;
        }
        if (store.get().phase !== 'starting') store.set({ phase: 'starting', error: '', partial: '', pending: '', level: 0 });
        try {
          let catalog = await withTimeout(deps.catalog(), 6000, 'speech catalog');
          const summary = () => (catalog && catalog.ok === true
            ? ((catalog.value && catalog.value.providers) || []).map((p) => p.id + ':' + ((p.preparation && p.preparation.phase) || '?')).join(',')
            : (catalog && catalog.error && catalog.error.message) || 'unknown');
          note('catalog', summary());
          if (!catalog || catalog.ok !== true) {
            const message = catalog && catalog.error ? catalog.error.message : 'unknown';
            running = false;
            reportError(translate('failed', { message }));
            return;
          }
          const phaseOf = (provider) => (provider.preparation && provider.preparation.phase) || '?';
          const isReady = () => {
            const providers = (catalog.value && catalog.value.providers) || [];
            return providers.some((provider) => phaseOf(provider) === 'ready' || phaseOf(provider) === 'standby');
          };
          if (!isReady() && ((catalog.value && catalog.value.providers) || []).length > 0) {
            // Cache exists on disk but the Host has not validated it in this process yet:
            // ask the provider to inspect/prepare, then poll its readiness.
            const target = catalog.value.providers[0];
            note('prepare:start', phaseOf(target));
            store.set({ busyText: translate('preparing') });
            try { await withTimeout(deps.prepare(target.id), 15000, 'speech prepare'); } catch (error) { note('prepare:error', (error && error.message) || String(error)); }
            for (let attempt = 0; attempt < 120 && running; attempt += 1) {
              if (isReady()) break;
              await new Promise((resolve) => window.setTimeout(resolve, 500));
              const next = await withTimeout(deps.catalog(), 6000, 'speech catalog').catch(() => null);
              if (next && next.ok === true) catalog = next;
            }
            note('prepare:result', summary());
            store.set({ busyText: '' });
          }
          if (!isReady()) {
            running = false;
            reportError(translate('notReady') + ' [' + summary() + ']');
            return;
          }
          selection = (catalog.value && catalog.value.selection) || null;
          callController = new AbortController();
        } catch (error) {
          reportError(translate('failed', { message: (error && error.message) || String(error) }));
          return;
        }
        try {
          note('getUserMedia:request');
          media = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
            video: false,
          });
        } catch (error) {
          running = false;
          reportError(error && error.name === 'NotAllowedError' ? translate('permissionDenied') : translate('failed', { message: (error && error.message) || String(error) }));
          return;
        }
        try {
          try {
            audioContext = new window.AudioContext({ sampleRate: SAMPLE_RATE });
          } catch (_unsupportedRate) {
            audioContext = new window.AudioContext();
          }
          source = audioContext.createMediaStreamSource(media);
          processor = audioContext.createScriptProcessor(1024, 1, 1);
          sink = audioContext.createGain();
          sink.gain.value = 0;
          processor.onaudioprocess = (event) => {
            if (store.get().phase !== 'listening') return;
            const channel = event.inputBuffer.getChannelData(0);
            feed(resampleTo16k(channel, audioContext.sampleRate));
          };
          source.connect(processor);
          processor.connect(sink);
          sink.connect(audioContext.destination);
          await audioContext.resume();
          note('audio', { sampleRate: audioContext.sampleRate, state: audioContext.state });
        } catch (error) {
          await release();
          running = false;
          reportError(translate('failed', { message: (error && error.message) || String(error) }));
          return;
        }
        vad = createVad(vadConfig);
        leftover = new Float32Array(0);
        lastPartial = '';
        lastCallAt = 0;
        span = inputActions ? inputActions.captureInsertion() : null;
        previousInsert = '';
        store.set({ phase: 'listening', error: '', partial: '', pending: '', segmentActive: false });
        note('listening');
        ticker = window.setInterval(() => { void tick(); }, 120);
      }

      async function release() {
        if (ticker !== null) { window.clearInterval(ticker); ticker = null; }
        if (processor) { try { processor.disconnect(); } catch (_) {} processor.onaudioprocess = null; processor = null; }
        if (source) { try { source.disconnect(); } catch (_) {} source = null; }
        if (sink) { try { sink.disconnect(); } catch (_) {} sink = null; }
        if (audioContext) { try { await audioContext.close(); } catch (_) {} audioContext = null; }
        if (media) { for (const track of media.getTracks()) { try { track.stop(); } catch (_) {} } media = null; }
        vad = null;
        leftover = new Float32Array(0);
      }

      /** Stop the microphone, committing anything the user already said. */
      async function stop() {
        if (!running) { store.set({ phase: 'idle', partial: '', level: 0, segmentActive: false }); return; }
        running = false;
        const current = vad ? vad.current() : null;
        store.set({ phase: 'starting', segmentActive: false });
        await release();
        if (current && current.length > SAMPLE_RATE * 0.2) {
          await finalize(current, 'stop');
        }
        if (callController) { try { callController.abort(); } catch (_) {} callController = null; }
        store.set({ phase: 'idle', partial: '', level: 0, segmentActive: false, error: '', busyText: '' });
      }

      return {
        store,
        setActions,
        setTranslator,
        start,
        stop,
        async toggle() {
          try {
            const phase = store.get().phase;
            if (phase === 'listening' || phase === 'starting') await stop();
            else await start();
          } catch (error) {
            debug.error = (error && error.stack) || String(error);
            note('toggle:error', debug.error);
            reportError(translate('failed', { message: (error && error.message) || String(error) }));
          }
        },
        async stop() { await stop(); },
        async insertPending() {
          const pending = store.get().pending;
          if (!pending) return;
          if (insert(pending)) store.set({ pending: '', phase: store.get().phase === 'idle' ? 'idle' : store.get().phase });
        },
        async dispose() { await stop(); },
      };
    }

    function engineFor(sessionId) {
      let engine = engines.get(sessionId);
      if (!engine) {
        engine = createEngine({
          store: storeFor(sessionId),
          transcribe: (request, signal) => runtime.transcribe(request, signal),
          catalog: () => runtime.catalog(),
          prepare: (providerId) => runtime.prepare(providerId),
        });
        engines.set(sessionId, engine);
      }
      return engine;
    }

    // ------------------------------------------------------------- components
    const MIC_ICON = h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      h('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }),
      h('path', { d: 'M5 11a7 7 0 0 0 14 0' }),
      h('path', { d: 'M12 18v3' }),
      h('path', { d: 'M8.5 21h7' }));

    const STOP_ICON = h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'currentColor', 'aria-hidden': 'true' },
      h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 }));

    function MicButton(props) {
      const { sessionId, inputActions, t } = props;
      const translate = typeof t === 'function' ? t : fallbackTranslate;
      const store = storeFor(sessionId);
      const state = useStore(store);
      const engineRef = React.useRef(null);
      engineRef.current = engineFor(sessionId);
      React.useEffect(() => {
        engineRef.current.setActions(inputActions);
        engineRef.current.setTranslator(translate);
      }, [inputActions, translate]);
      React.useEffect(() => () => { void engineRef.current.stop(); }, []);
      const active = state.phase === 'listening' || state.phase === 'starting';
      const label = active ? translate('stop') : translate('listen');
      return h('button', {
        type: 'button',
        className: 'rv-mic',
        'data-active': active ? 'true' : 'false',
        'aria-label': label,
        'aria-pressed': active ? 'true' : 'false',
        title: label,
        onClick: () => {
          debug.clicks += 1;
          note('click', { sessionId, hasActions: !!inputActions });
          const current = store.get().phase;
          const activeNow = current === 'listening' || current === 'starting';
          if (activeNow) {
            store.set({ phase: 'idle', partial: '', level: 0 });
            void engineRef.current.stop();
          } else {
            store.set({ phase: 'starting', error: '', partial: '', pending: '', level: 0 });
            void engineRef.current.start();
          }
        },
      }, active ? STOP_ICON : MIC_ICON);
    }

    function LivePanel(props) {
      const { sessionId, t } = props;
      const translate = typeof t === 'function' ? t : fallbackTranslate;
      const store = storeFor(sessionId);
      const state = useStore(store);
      const engine = engineFor(sessionId);
      if (state.phase === 'idle' && !state.pending && !state.error) return null;
      const bars = [];
      for (let index = 0; index < 5; index += 1) {
        const threshold = (index + 1) / 6;
        bars.push(h('span', { key: index, 'data-on': state.level >= threshold ? 'true' : 'false' }));
      }
      const status = state.busyText || (state.phase === 'starting' ? translate('starting')
        : state.phase === 'listening' ? translate('listening')
        : state.phase === 'error' ? '' : translate('stopped'));
      const children = [
        h('div', { key: 'head', className: 'rv-head' },
          h('span', { key: 'dot', className: 'rv-dot', 'data-active': state.phase === 'listening' ? 'true' : 'false' }),
          h('span', { key: 'status', className: 'rv-status' }, status),
          h('span', { key: 'bars', className: 'rv-bars' }, bars)),
      ];
      if (state.phase === 'listening' || state.partial) {
        children.push(h('div', { key: 'partial', className: 'rv-partial', 'data-empty': state.partial ? 'false' : 'true' },
          state.partial || (state.segmentActive ? translate('partialHint') + '…' : '…')));
      }
      if (state.error) children.push(h('div', { key: 'error', className: 'rv-error' }, state.error));
      if (state.pending) {
        children.push(h('div', { key: 'pending', className: 'rv-pending' },
          h('span', { className: 'rv-pendingText' }, translate('pending')),
          h('button', {
            type: 'button',
            className: 'rv-insert',
            onClick: () => { void engine.insertPending(); },
          }, translate('insert')),
          h('span', { className: 'rv-pendingText', style: { color: 'var(--dsw-alias-label-primary)' } }, state.pending)));
      }
      return h('div', { className: 'rv-panel', role: 'status', 'aria-live': 'polite' }, children);
    }

    // ----------------------------------------------------------------- styles
    const CSS = [
      '.rv-mic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:none;padding:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:50%;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.rv-mic:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}',
      '.rv-mic[data-active="true"]{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.rv-mic[data-active="true"]:hover{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.rv-panel{display:flex;flex-direction:column;gap:6px;margin:6px 10px 8px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.rv-head{display:flex;align-items:center;gap:8px;min-width:0}',
      '.rv-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}',
      '.rv-dot[data-active="true"]{background:var(--dsw-alias-state-error-primary);animation:rv-pulse 1.2s ease-in-out infinite}',
      '@keyframes rv-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.rv-status{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rv-bars{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex:none}',
      '.rv-bars>span{width:3px;height:12px;border-radius:1px;background:var(--dsw-alias-border-l1)}',
      '.rv-bars>span[data-on="true"]{background:var(--dsw-alias-state-success-primary)}',
      '.rv-partial{color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;max-height:72px;overflow:auto;overflow-wrap:anywhere}',
      '.rv-partial[data-empty="true"]{color:var(--dsw-alias-label-secondary);opacity:.7}',
      '.rv-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.rv-pending{display:flex;align-items:center;gap:8px;flex-wrap:wrap;overflow-wrap:anywhere}',
      '.rv-pendingText{flex:1;min-width:120px}',
      '.rv-insert{flex:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:20px;padding:0 10px;cursor:pointer}',
      '.rv-insert:hover{background:var(--dsw-alias-bg-layer-2)}',
    ].join('\n');

    // ------------------------------------------------------------------ mount
    function registerUi(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }));
      ctx.effect(() => {
        const tagId = 'dsh-realtime-voice/style';
        if (typeof document === 'undefined') return () => {};
        if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {};
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-realtime-voice';
        tag.dataset.pluginCss = tagId;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      });
      let localeId = '';
      try {
        const snapshot = ctx.locale.getLocale ? ctx.locale.getLocale() : undefined;
        localeId = String((snapshot && (snapshot.id || snapshot.locale)) || '');
      } catch (_localeError) { localeId = ''; }
      const dict = localeId.startsWith('zh') ? zh : en;
      runtime = {
        dict,
        speech: null,
        service() { return runtime && runtime.speech; },
        async transcribe(request, signal) {
          const service = runtime && runtime.speech;
          if (!service || typeof service.transcribe !== 'function') {
            return { ok: false, error: { code: 'not-mounted', message: fallbackTranslate('notReady') } };
          }
          return await service.transcribe(request, signal);
        },
        async prepare(providerId) {
          const service = runtime && runtime.speech;
          if (!service || typeof service.prepare !== 'function') return { ok: false, error: { code: 'not-mounted', message: fallbackTranslate('notReady') } };
          return await service.prepare(providerId);
        },
        async catalog() {
          const service = runtime && runtime.speech;
          if (!service || typeof service.catalog !== 'function') {
            return { ok: false, error: { code: 'not-mounted', message: fallbackTranslate('notReady') } };
          }
          return await service.catalog();
        },
      };
      ctx.effect(() => () => {
        for (const engine of engines.values()) void engine.dispose();
        engines.clear();
        runtime = null;
      });
      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'realtime-voice',
        order: 35,
        locale: NS,
      }, MicButton));
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'realtime-voice-live',
        order: 36,
        locale: NS,
      }, LivePanel));
    }

    const inject = ['remote', 'slots', 'locale'];

    function apply(ctx) {
      registerUi(ctx);
      // `remote.speech` is a guarded namespace service: it can only be read through an
      // inject scope that names it. The shipped voice-input client mounts it at boot.
      const speech = ctx.inject(['remote.speech'], (scope) => {
        if (!runtime) return () => {};
        try { runtime.speech = scope.remote.speech; } catch (_scopeError) { return () => {}; }
        note('speech-scope mounted');
        return () => { if (runtime) runtime.speech = null; };
      });
      return () => { try { if (speech && typeof speech.dispose === 'function') speech.dispose(); } catch (_disposeError) {} };
    }

    return { inject, apply };
  },
});
