// Audio engine: microphone → energy VAD → incremental ASR → sentence playback.
// Written as a plain fragment (no import/export): scripts/build-client.mjs inlines it
// into the ModuleLoader factory together with avatar.js and index.js.

const SAMPLE_RATE = 16000;
const FRAME_MS = 20;
const FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;

/** RMS of a Float32 frame, 0..1. */
function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const v = frame[i];
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, frame.length));
}

function concatFloat(chunks) {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function floatToPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Canonical 44-byte-header mono 16 kHz 16-bit WAV — the only shape /transcribe accepts. */
function pcm16ToWav(pcm) {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(label + ' timed out after ' + ms + ' ms'));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Energy VAD with noise-floor calibration, pre-roll and pause endpointing — same shape as
 * the shipped realtime-voice plugin, tuned for conversational turn taking (650 ms pause).
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
    threshold = Math.min(0.05, Math.max(0.008, p90 * 3));
  }

  function take() {
    const samples = concatFloat(segment);
    pre = [];
    segment = [];
    voicedMs = 0;
    silentMs = 0;
    segmentMs = 0;
    active = false;
    noiseWindow.length = 0;
    threshold = config.threshold;
    return samples;
  }

  return {
    get active() {
      return active;
    },
    get threshold() {
      return threshold;
    },
    current() {
      return concatFloat(segment);
    },
    reset() {
      pre = [];
      segment = [];
      voicedMs = 0;
      silentMs = 0;
      segmentMs = 0;
      active = false;
      elapsedMs = 0;
      noiseWindow.length = 0;
      threshold = config.threshold;
    },
    push(frame) {
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

/**
 * Engine: one microphone stream, one VAD, partial re-decoding every `cadenceMs`,
 * a sentence playback queue that can be interrupted by the next user turn.
 */
function createAudioEngine(deps) {
  const state = {
    phase: 'idle', // idle | listening | thinking | speaking | error
    level: 0,
    partial: '',
    error: '',
  };
  const vadConfig = {
    threshold: 0.012,
    minSpeechMs: 150,
    minSilenceMs: 650,
    preRollMs: 320,
    maxSegmentMs: 20000,
  };
  // 700 ms cadence keeps every local decode under ~250 ms up to a 12 s window (measured).
  const cadenceMs = 700;
  const partialWindowMs = 12000;

  let media = null;
  let audioContext = null;
  let source = null;
  let processor = null;
  let sink = null;
  let vad = null;
  let leftover = new Float32Array(0);
  let frameScratch = new Float32Array(FRAME);
  let frameFill = 0;
  let inFlight = false;
  let lastCallAt = 0;
  let lastPartial = '';
  let generation = 0;
  let running = false;
  let disposed = false;

  // playback
  let playQueue = [];
  let playing = false;
  let currentSource = null;
  let prefetched = new Map();
  let bargeMs = 0;

  function emit() {
    deps.onState && deps.onState({ ...state });
  }

  function setPhase(phase, extra) {
    state.phase = phase;
    if (extra && typeof extra.partial === 'string') state.partial = extra.partial;
    if (extra && typeof extra.error === 'string') state.error = extra.error;
    if (phase !== 'speaking') state.level = 0;
    emit();
  }

  // ------------------------------------------------------------------ ASR
  async function transcribe(samples) {
    const wav = pcm16ToWav(floatToPcm16(samples));
    const audioBase64 = bytesToBase64(wav);
    if (deps.transcribeRemote) {
      const result = await withTimeout(deps.transcribeRemote({ audioBase64 }), 20000, 'speech transcribe');
      if (result && result.ok === true) return (result.value && result.value.text) || '';
      if (result && result.error && result.error.code === 'not-mounted') {
        // fall through to the host route
      } else if (result && result.error) {
        throw new Error(result.error.message || 'transcribe failed');
      }
    }
    const text = await deps.transcribeHttp(audioBase64);
    return text;
  }

  async function redecode() {
    if (!vad || !vad.active || inFlight) return;
    const now = Date.now();
    if (now - lastCallAt < cadenceMs) return;
    const samples = vad.current();
    if (samples.length < SAMPLE_RATE * 0.3) return;
    const windowSamples = samples.length > (SAMPLE_RATE * partialWindowMs) / 1000
      ? samples.subarray(samples.length - (SAMPLE_RATE * partialWindowMs) / 1000)
      : samples;
    inFlight = true;
    lastCallAt = now;
    const run = generation;
    try {
      const text = (await transcribe(windowSamples)).trim();
      if (run !== generation) return;
      if (text && text !== lastPartial) {
        lastPartial = text;
        state.partial = text;
        deps.onPartial && deps.onPartial(text);
      }
    } catch (_error) {
      // a failed partial is not worth surfacing: the final decode will retry
    } finally {
      inFlight = false;
    }
  }

  async function finalize(samples) {
    const run = ++generation;
    vad && vad.reset();
    lastPartial = '';
    state.partial = '';
    if (!samples || samples.length < (SAMPLE_RATE * 0.25)) {
      setPhase(running ? 'listening' : 'idle', { partial: '' });
      return;
    }
    setPhase('thinking', { partial: '' });
    try {
      const text = (await transcribe(samples)).trim();
      if (run !== generation) return;
      if (!text) {
        setPhase(running ? 'listening' : 'idle');
        return;
      }
      deps.onFinal && (await deps.onFinal(text));
    } catch (error) {
      setPhase('error', { error: (error && error.message) || String(error) });
      setTimeout(() => {
        if (running && !disposed) setPhase('listening');
      }, 2500);
    }
  }

  // -------------------------------------------------------------- playback
  function prefetch(entries) {
    for (const entry of entries) {
      if (prefetched.has(entry.index)) continue;
      const promise = deps.speakSentence(entry.text, entry.voiceId).catch((error) => ({ error }));
      prefetched.set(entry.index, promise);
    }
  }

  async function playOne(bytes) {
    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const data = new Float32Array(analyser.fftSize);
    const src = audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    analyser.connect(audioContext.destination);
    currentSource = src;
    const done = new Promise((resolve) => {
      src.onended = () => resolve();
    });
    src.start();
    const tick = () => {
      if (currentSource !== src) return;
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
      deps.onLevel && deps.onLevel(Math.min(1, peak * 1.6));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await done;
    if (currentSource === src) currentSource = null;
    deps.onLevel && deps.onLevel(0);
  }

  function interrupt() {
    playQueue = [];
    prefetched.clear();
    if (currentSource) {
      try {
        currentSource.stop();
      } catch (_error) {
        /* already stopped */
      }
      currentSource = null;
    }
    playing = false;
    deps.onLevel && deps.onLevel(0);
  }

  async function playSentences(sentences) {
    if (!Array.isArray(sentences) || !sentences.length) {
      setPhase(running ? 'listening' : 'idle');
      return;
    }
    interrupt();
    // Entries are either plain sentences or `{ text, voiceId }` pairs, so the host can
    // give every sentence its own voice without the engine knowing about characters.
    playQueue = sentences.map((entry, index) =>
      typeof entry === 'string' ? { text: entry, index } : { text: entry.text, voiceId: entry.voiceId, index },
    );
    prefetch(playQueue.slice(0, 2));
    playing = true;
    setPhase('speaking');
    while (playQueue.length) {
      const item = playQueue.shift();
      let payload;
      try {
        payload = await (prefetched.get(item.index) || deps.speakSentence(item.text, item.voiceId));
      } catch (error) {
        payload = { error };
      }
      prefetched.delete(item.index);
      if (!playing) return;
      if (!payload || payload.error || !payload.audioBase64) {
        // keep the conversation flowing: skip this sentence, surface nothing
        continue;
      }
      // Prefetch the next two while this one plays, never re-fetching a played index.
      prefetch(playQueue.slice(0, 2));
      try {
        await playOne(base64ToBytes(payload.audioBase64));
      } catch (_error) {
        /* decode failure: skip */
      }
      if (running) deps.onLevel && deps.onLevel(0);
    }
    playing = false;
    if (!disposed) setPhase(running ? 'listening' : 'idle');
  }

  /** Play one already-synthesised clip right away (latency filler). */
  async function playClip(payload) {
    if (!payload || !payload.audioBase64 || !audioContext || !running) return;
    interrupt();
    playing = true;
    setPhase('speaking');
    try {
      await playOne(base64ToBytes(payload.audioBase64));
    } catch (_error) {
      /* skip a broken clip */
    }
    if (!disposed && playing) {
      playing = false;
      setPhase(running ? 'listening' : 'idle');
    }
  }

  // ------------------------------------------------------------- lifecycle
  function onFrame(frame) {
    if (!vad) return;
    // barge-in: talking over the companion stops playback
    const level = rms(frame);
    if (state.phase === 'speaking') {
      bargeMs = level >= Math.max(0.02, vad.threshold * 1.6) ? bargeMs + FRAME_MS : 0;
      deps.onLevel && deps.onLevel(Math.min(1, level * 1.6));
      if (bargeMs >= 220) {
        bargeMs = 0;
        interrupt();
        vad.reset();
        setPhase('listening');
      }
      return;
    }
    const outcome = vad.push(frame);
    state.level = Math.min(1, outcome.level * 1.8);
    if (outcome.started) setPhase('listening');
    if (outcome.segment) {
      void finalize(outcome.segment);
      return;
    }
    if (outcome.calibrating) return;
    void redecode();
  }

  async function start() {
    if (running || disposed) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPhase('error', { error: 'microphone unavailable' });
      return;
    }
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      setPhase('error', { error: (error && error.message) || 'microphone permission denied' });
      return;
    }
    media.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (running) stop();
      });
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioContext.state === 'suspended') await audioContext.resume();
    source = audioContext.createMediaStreamSource(media);
    processor = audioContext.createScriptProcessor(1024, 1, 1);
    sink = audioContext.createGain();
    sink.gain.value = 0;
    vad = createVad(vadConfig);
    frameFill = 0;
    leftover = new Float32Array(0);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let offset = 0;
      if (leftover.length) {
        const need = FRAME - frameFill;
        const take = Math.min(need, input.length);
        frameScratch.set(input.subarray(0, take), frameFill);
        frameFill += take;
        offset = take;
        if (frameFill === FRAME) {
          onFrame(frameScratch);
          frameFill = 0;
        }
      }
      while (offset + FRAME <= input.length) {
        onFrame(input.subarray(offset, offset + FRAME));
        offset += FRAME;
      }
      if (offset < input.length) {
        leftover = input.slice(offset);
        frameScratch.set(leftover, 0);
        frameFill = leftover.length;
      } else {
        leftover = new Float32Array(0);
      }
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(audioContext.destination);
    running = true;
    setPhase('listening');
  }

  function stop() {
    running = false;
    interrupt();
    if (processor) {
      try {
        processor.disconnect();
      } catch (_error) {
        /* noop */
      }
      processor.onaudioprocess = null;
      processor = null;
    }
    if (source) {
      try {
        source.disconnect();
      } catch (_error) {
        /* noop */
      }
      source = null;
    }
    if (sink) {
      try {
        sink.disconnect();
      } catch (_error) {
        /* noop */
      }
      sink = null;
    }
    if (media) {
      media.getTracks().forEach((track) => track.stop());
      media = null;
    }
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    vad = null;
    setPhase('idle');
  }

  function dispose() {
    disposed = true;
    stop();
    prefetched.clear();
    playQueue = [];
  }

  return {
    start,
    stop,
    dispose,
    speak: playSentences,
    playClip,
    interrupt,
    setThinking: () => setPhase('thinking'),
    get phase() {
      return state.phase;
    },
    get listening() {
      return running;
    },
  };
}
