// Fake-DOM harness for src/client/hotkey.js. No browser, no microphone, no
// network: navigator.mediaDevices/AudioContext/localStorage/requestJson are all
// deterministic stubs so the hold-to-talk pipeline can be asserted end to end.
import assert from 'node:assert/strict';
import { createHotkey, parseHotkey, matchesHotkey, __hotkeyTest } from '../src/client/hotkey.js';

// ---------------------------------------------------------------------------
// Fake DOM
// ---------------------------------------------------------------------------

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.style = {};
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.remove();
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child) child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    const set = this.listeners.get(type);
    if (set) set.delete(handler);
  }

  dispatch(type, event) {
    const set = this.listeners.get(type);
    if (!set) return 0;
    for (const handler of [...set]) handler(event);
    return set.size;
  }

  listenerCount(type) {
    const set = this.listeners.get(type);
    return set ? set.size : 0;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('document');
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
    this.documentElement = new FakeElement('html');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tag) {
    return new FakeElement(tag);
  }
}

// ---------------------------------------------------------------------------
// Fake clock
// ---------------------------------------------------------------------------

let now = 0;
let nextTimerId = 1;
const timers = new Map();
const timerErrors = [];

function fakeSetTimeout(callback, delay) {
  const id = nextTimerId++;
  const ms = Number(delay);
  timers.set(id, { at: now + (Number.isFinite(ms) && ms > 0 ? ms : 0), callback });
  return id;
}

function fakeClearTimeout(id) {
  timers.delete(id);
}

function advance(ms) {
  now += Math.max(0, Number(ms) || 0);
  for (;;) {
    let dueId = null;
    let due = null;
    for (const [id, timer] of timers) {
      if (timer.at <= now && (!due || timer.at < due.at)) {
        dueId = id;
        due = timer;
      }
    }
    if (!due) break;
    timers.delete(dueId);
    try {
      due.callback();
    } catch (error) {
      timerErrors.push(error);
    }
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function waitForPhase(hotkey, wanted, attempts = 100) {
  const targets = Array.isArray(wanted) ? wanted : [wanted];
  for (let i = 0; i < attempts; i += 1) {
    const current = hotkey.status();
    if (targets.includes(current.phase)) return current;
    await settle();
  }
  throw new Error(
    'timed out waiting for phase ' + targets.join('/') + ', last=' + hotkey.status().phase,
  );
}

// ---------------------------------------------------------------------------
// Fake browser globals
// ---------------------------------------------------------------------------

const audioContexts = [];

class FakeAudioContext {
  constructor(options) {
    this.options = options || {};
    this.sampleRate = Number(this.options.sampleRate) > 0 ? Number(this.options.sampleRate) : 48000;
    this.state = 'running';
    this.destination = { kind: 'destination' };
    this.closed = false;
    this.resumeCalls = 0;
    this.processors = [];
    this.mediaSources = [];
    this.bufferSources = [];
    this.decodedInputs = [];
    audioContexts.push(this);
  }

  resume() {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }

  createScriptProcessor(size, inputChannels, outputChannels) {
    const node = {
      size,
      inputChannels,
      outputChannels,
      onaudioprocess: null,
      connects: 0,
      disconnects: 0,
      connect() {
        this.connects += 1;
      },
      disconnect() {
        this.disconnects += 1;
      },
    };
    this.processors.push(node);
    return node;
  }

  createMediaStreamSource(stream) {
    const node = {
      stream,
      connected: false,
      disconnected: false,
      connect() {
        this.connected = true;
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    this.mediaSources.push(node);
    return node;
  }

  createGain() {
    return {
      gain: { value: 1 },
      connects: 0,
      disconnects: 0,
      connect() {
        this.connects += 1;
      },
      disconnect() {
        this.disconnects += 1;
      },
    };
  }

  createBufferSource() {
    const node = {
      buffer: null,
      onended: null,
      started: false,
      stopped: false,
      connect() {},
      disconnect() {},
      start() {
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
    };
    this.bufferSources.push(node);
    return node;
  }

  decodeAudioData(buffer) {
    this.decodedInputs.push(buffer);
    return Promise.resolve({
      duration: 0.12,
      sampleRate: 16000,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(1920),
    });
  }
}

const doc = new FakeDocument();
const win = new FakeElement('window');
win.AudioContext = FakeAudioContext;

const store = new Map();
const fakeLocalStorage = {
  getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
  setItem: (key, value) => store.set(String(key), String(value)),
  removeItem: (key) => store.delete(String(key)),
};

const mic = {
  permission: 'granted',
  calls: 0,
  lastConstraints: null,
  tracks: [],
};

async function fakeGetUserMedia(constraints) {
  mic.calls += 1;
  mic.lastConstraints = constraints;
  if (mic.permission === 'denied') {
    const error = new Error('Permission denied');
    error.name = 'NotAllowedError';
    throw error;
  }
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  mic.tracks.push(track);
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  return stream;
}

globalThis.document = doc;
globalThis.window = win;
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getUserMedia: fakeGetUserMedia } },
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: fakeLocalStorage,
  configurable: true,
  writable: true,
});
globalThis.AudioContext = FakeAudioContext;

__hotkeyTest.setClock({
  now: () => now,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
});

const originalWarn = console.warn;
const warnings = [];
console.warn = (...args) => {
  warnings.push(args.map((value) => String(value)).join(' '));
};

// ---------------------------------------------------------------------------
// Fake host + module instance
// ---------------------------------------------------------------------------

const calls = [];
let scenario = {};

function resetScenario(overrides = {}) {
  scenario = {
    transcribeText: '投到日志会话',
    transcribeError: null,
    plan: {
      action: 'prompt',
      sessionId: 's1',
      candidates: [{ sessionId: 's1', title: '日志会话' }],
    },
    confirmation: '好的，投到日志会话',
    planError: null,
    sendError: null,
    speakError: null,
    ...overrides,
  };
  calls.length = 0;
}

resetScenario();

const SPEAK_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

async function fakeRequestJson(path, options) {
  const request = {
    path,
    method: options && options.method,
    body: options && options.body,
  };
  calls.push(request);
  if (path === '/transcribe') {
    if (scenario.transcribeError) throw scenario.transcribeError;
    return { ok: true, text: scenario.transcribeText };
  }
  if (path === '/plan') {
    if (scenario.planError) throw scenario.planError;
    return { ok: true, plan: scenario.plan, confirmation: scenario.confirmation };
  }
  if (path === '/send') {
    if (scenario.sendError) throw scenario.sendError;
    const body = request.body || {};
    return { ok: true, action: body.action, sessionId: body.sessionId || null };
  }
  if (path === '/speak') {
    if (scenario.speakError) throw scenario.speakError;
    return {
      ok: true,
      audioBase64: SPEAK_WAV_BASE64,
      mimeType: 'audio/wav',
      durationMs: 120,
      voiceId: 'test',
      cached: false,
    };
  }
  throw new Error('unexpected request path: ' + path);
}

const phases = [];
const subtitles = [];
const hotkey = createHotkey({
  requestJson: fakeRequestJson,
  currentSessionId: () => 'current-1',
  onPhase: (phase) => phases.push(phase),
  onSubtitle: (text) => subtitles.push(text),
});

// ---------------------------------------------------------------------------
// Fake event helpers
// ---------------------------------------------------------------------------

function keyEvent(code, key, modifiers = {}) {
  return {
    code,
    key,
    ctrlKey: !!modifiers.ctrl,
    shiftKey: !!modifiers.shift,
    altKey: !!modifiers.alt,
    metaKey: !!modifiers.meta,
    repeat: !!modifiers.repeat,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

const defaultDown = () => keyEvent('Space', ' ', { ctrl: true, shift: true });
const defaultUp = () => keyEvent('Space', ' ', { ctrl: true, shift: true });

function hudRoot() {
  return doc.body.children.find((child) => child.getAttribute('data-vc-hotkey-hud') !== null) || null;
}

function hudPart(className) {
  const root = hudRoot();
  if (!root) return null;
  return root.children.find((child) => child.getAttribute('class') === className) || null;
}

function hudText() {
  const label = hudPart('vc-hotkey-label');
  const detail = hudPart('vc-hotkey-detail');
  return {
    label: label ? label.textContent : '',
    detail: detail ? detail.textContent : '',
    visible: hudRoot() ? hudRoot().getAttribute('data-visible') : null,
    state: hudRoot() ? hudRoot().getAttribute('data-state') : null,
  };
}

function activeRecordingContext() {
  for (let i = audioContexts.length - 1; i >= 0; i -= 1) {
    if (!audioContexts[i].closed && audioContexts[i].processors.length > 0) return audioContexts[i];
  }
  return null;
}

function feedAudio(samples) {
  const context = activeRecordingContext();
  assert.ok(context, 'expected an open recording AudioContext');
  const processor = context.processors[context.processors.length - 1];
  assert.ok(processor && typeof processor.onaudioprocess === 'function', 'expected a live ScriptProcessor');
  processor.onaudioprocess({
    inputBuffer: {
      getChannelData: () => new Float32Array(samples).fill(0.25),
    },
  });
  return context;
}

async function holdAndRelease({ holdMs = 400, samples = 320 } = {}) {
  const down = defaultDown();
  doc.dispatch('keydown', down);
  await settle();
  assert.equal(hotkey.status().phase, 'recording', 'keydown should start recording');
  assert.equal(down.defaultPrevented, true, 'the hotkey keydown should be prevented');
  feedAudio(samples);
  advance(holdMs);
  const up = defaultUp();
  doc.dispatch('keyup', up);
  assert.equal(up.defaultPrevented, true, 'the hotkey keyup should be prevented');
  return waitForPhase(hotkey, ['done', 'failed', 'idle']);
}

const corePaths = () => calls.map((call) => call.path).filter((path) => path !== '/speak');
const findCall = (path) => calls.find((call) => call.path === path) || null;

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('ok   ' + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log('FAIL ' + name);
    console.log(error && error.stack ? error.stack : String(error));
  }
}

async function main() {
  await check('parseHotkey: default is Ctrl+Shift+Space', () => {
    const binding = parseHotkey();
    assert.equal(binding.ctrl, true);
    assert.equal(binding.shift, true);
    assert.equal(binding.alt, false);
    assert.equal(binding.meta, false);
    assert.equal(binding.key, 'Space');
    assert.equal(binding.spec, 'ControlLeft+ShiftLeft+Space');
  });

  await check('parseHotkey: Alt+KeyM and empty fallback', () => {
    const binding = parseHotkey('Alt+KeyM');
    assert.equal(binding.ctrl, false);
    assert.equal(binding.alt, true);
    assert.equal(binding.key, 'KeyM');
    assert.equal(parseHotkey('').key, 'Space');
    assert.equal(parseHotkey('   ').spec, 'ControlLeft+ShiftLeft+Space');
  });

  await check('matchesHotkey: modifiers must match exactly', () => {
    const binding = parseHotkey('ControlLeft+ShiftLeft+Space');
    assert.equal(matchesHotkey(keyEvent('Space', ' ', { ctrl: true, shift: true }), binding), true);
    assert.equal(matchesHotkey(keyEvent('Space', ' ', { ctrl: true }), binding), false);
    assert.equal(matchesHotkey(keyEvent('Space', ' ', { ctrl: true, shift: true, alt: true }), binding), false);
    assert.equal(matchesHotkey(keyEvent('KeyM', 'm', { alt: true }), parseHotkey('Alt+KeyM')), true);
    assert.equal(matchesHotkey(keyEvent('KeyM', 'm', {}), parseHotkey('Alt+KeyM')), false);
  });

  await check('encodeWave: RIFF/WAVE, mono, 16 kHz, PCM16', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = __hotkeyTest.encodeWave(samples);
    assert.equal(bytes.length, 44 + samples.length * 2);
    const buffer = Buffer.from(bytes);
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
    assert.equal(buffer.toString('ascii', 12, 16), 'fmt ');
    assert.equal(buffer.readUInt16LE(20), 1, 'PCM format');
    assert.equal(buffer.readUInt16LE(22), 1, 'mono');
    assert.equal(buffer.readUInt32LE(24), 16000, 'sample rate');
    assert.equal(buffer.readUInt16LE(34), 16, 'bit depth');
    assert.equal(buffer.readUInt32LE(40), samples.length * 2, 'data size');
    assert.equal(buffer.toString('ascii', 36, 40), 'data');
  });

  await check('resample: 48 kHz → 16 kHz keeps duration', () => {
    const input = new Float32Array(480);
    for (let i = 0; i < input.length; i += 1) input[i] = i / input.length;
    const output = __hotkeyTest.resample(input, 48000, 16000);
    assert.equal(output.length, 160);
    assert.equal(__hotkeyTest.resample(input, 16000, 16000).length, 480);
  });

  await check('base64: round-trips arbitrary WAV bytes', () => {
    const bytes = __hotkeyTest.encodeWave(new Float32Array([0, 0.25, -0.75]));
    const encoded = __hotkeyTest.bytesToBase64(bytes);
    const decoded = __hotkeyTest.base64ToBytes(encoded);
    assert.deepEqual([...decoded], [...bytes]);
  });

  await check('install: default binding, injected style, no dupe on reinstall', () => {
    const uninstall = hotkey.install();
    assert.equal(typeof uninstall, 'function');
    assert.equal(hotkey.status().installed, true);
    assert.equal(hotkey.status().hotkey, 'ControlLeft+ShiftLeft+Space');
    assert.equal(doc.listenerCount('keydown'), 1);
    assert.equal(doc.listenerCount('keyup'), 1);
    assert.equal(win.listenerCount('blur'), 1);
    const styles = doc.head.children.filter((child) => child.getAttribute('data-vc-hotkey-style') !== null);
    assert.equal(styles.length, 1);
    assert.ok(styles[0].textContent.includes('.vc-hotkey-hud'));
    hotkey.install();
    assert.equal(doc.listenerCount('keydown'), 1, 'repeat install must not stack listeners');
    assert.equal(doc.head.children.filter((child) => child.getAttribute('data-vc-hotkey-style') !== null).length, 1);
  });

  await check('hold → release: transcribe → plan → send with a 16 kHz WAV', async () => {
    resetScenario();
    phases.length = 0;
    subtitles.length = 0;
    mic.lastConstraints = null;

    const done = await holdAndRelease({ holdMs: 400, samples: 320 });
    assert.equal(done.phase, 'done');
    assert.deepEqual(phases, ['recording', 'transcribing', 'routing', 'done']);
    assert.deepEqual(corePaths(), ['/transcribe', '/plan', '/send']);

    assert.equal(mic.calls, 1);
    assert.equal(mic.lastConstraints.video, false);
    assert.equal(mic.lastConstraints.audio.channelCount, 1);
    assert.equal(mic.lastConstraints.audio.sampleRate, 16000);

    const transcribeBody = findCall('/transcribe').body;
    assert.ok(typeof transcribeBody.audioBase64 === 'string' && transcribeBody.audioBase64.length > 0);
    const wav = Buffer.from(transcribeBody.audioBase64, 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.ok(wav.readUInt32LE(40) > 0, 'recorded audio should not be empty');

    const planBody = findCall('/plan').body;
    assert.equal(planBody.utterance, '投到日志会话');
    assert.equal(planBody.currentSessionId, 'current-1');
    assert.equal(planBody.pending, undefined);

    const sendBody = findCall('/send').body;
    assert.deepEqual(sendBody, { action: 'prompt', sessionId: 's1', text: '投到日志会话' });
    assert.equal(subtitles.includes('投到日志会话'), true);
    assert.equal(subtitles.at(-1), '好的，投到日志会话');
    assert.equal(hotkey.status().pending, 0);

    const hud = hudText();
    assert.equal(hud.label, '完成');
    assert.equal(hud.detail, '投递到 日志会话');
    assert.equal(hud.visible, '1');
    assert.equal(hud.state, 'done');

    assert.ok(findCall('/speak'), 'confirmation should be spoken through /speak');
    assert.equal(findCall('/speak').body.text, '好的，投到日志会话');
    assert.equal(audioContexts.filter((context) => context.bufferSources.length > 0).length > 0, true);

    advance(4000);
    assert.equal(hotkey.status().phase, 'idle', 'HUD should auto-hide and return to idle after 4 s');
    const hidden = hudText();
    assert.equal(hidden.visible, '0');
    assert.equal(phases.at(-1), 'idle');
  });

  await check('ask → pending → second utterance carries pending into /plan', async () => {
    resetScenario({
      transcribeText: '投到日志还是周报',
      plan: {
        action: 'ask',
        candidates: [
          { sessionId: 's1', title: '日志会话' },
          { sessionId: 's2', title: '周报' },
        ],
      },
      confirmation: '要投到日志还是周报？',
    });
    phases.length = 0;
    subtitles.length = 0;

    const asked = await holdAndRelease({ holdMs: 400, samples: 320 });
    assert.equal(asked.phase, 'done');
    assert.equal(asked.pending, 2);
    assert.equal(subtitles.at(-1), '要投到日志还是周报？');
    assert.equal(findCall('/send'), null, 'ask must not dispatch anything');
    assert.equal(findCall('/speak').body.text, '要投到日志还是周报？');
    assert.equal(hudText().detail, '要投到日志还是周报？');

    resetScenario({
      transcribeText: '投到周报',
      plan: {
        action: 'prompt',
        sessionId: 's2',
        candidates: [
          { sessionId: 's1', title: '日志会话' },
          { sessionId: 's2', title: '周报' },
        ],
      },
      confirmation: '已投到周报',
    });
    phases.length = 0;
    subtitles.length = 0;

    const routed = await holdAndRelease({ holdMs: 400, samples: 320 });
    assert.equal(routed.phase, 'done');
    assert.equal(routed.pending, 0);

    const planBody = findCall('/plan').body;
    assert.deepEqual(planBody.pending, [
      { sessionId: 's1', title: '日志会话' },
      { sessionId: 's2', title: '周报' },
    ]);
    const sendBody = findCall('/send').body;
    assert.deepEqual(sendBody, { action: 'prompt', sessionId: 's2', text: '投到周报' });
    assert.equal(hudText().detail, '投递到 周报');
    assert.equal(subtitles.at(-1), '已投到周报');
  });

  await check('failure: denied microphone → failed phase + Chinese subtitle, no requests', async () => {
    mic.permission = 'denied';
    calls.length = 0;
    subtitles.length = 0;
    phases.length = 0;

    assert.equal(hotkey.press(), true);
    const failed = await waitForPhase(hotkey, 'failed');
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.recording, false);
    assert.equal(calls.length, 0);
    assert.ok(subtitles.at(-1).includes('麦克风权限被拒绝'), 'subtitle should explain the denial');
    assert.equal(hudText().label, '失败');
    assert.ok(hudText().detail.includes('麦克风权限被拒绝'));
    assert.deepEqual(phases, ['recording', 'failed']);
    mic.permission = 'granted';
  });

  await check('failure: transcribe rejects → failed, plan/send are never called', async () => {
    resetScenario({ transcribeError: new Error('speech service exploded') });
    subtitles.length = 0;

    const failed = await holdAndRelease({ holdMs: 400, samples: 320 });
    assert.equal(failed.phase, 'failed');
    assert.deepEqual(corePaths(), ['/transcribe']);
    assert.equal(findCall('/plan'), null);
    assert.equal(findCall('/send'), null);
    assert.ok(subtitles.at(-1).includes('识别失败'), 'subtitle should mention recognition failure');
    assert.ok(subtitles.at(-1).includes('speech service exploded'));
    assert.equal(hotkey.status().pending, 0);
    resetScenario();
  });

  await check('short press: releases before 300 ms do not hit the host', async () => {
    resetScenario();
    calls.length = 0;
    phases.length = 0;

    doc.dispatch('keydown', defaultDown());
    await settle();
    assert.equal(hotkey.status().phase, 'recording');
    advance(100);
    doc.dispatch('keyup', defaultUp());
    const idle = await waitForPhase(hotkey, 'idle');
    assert.equal(idle.phase, 'idle');
    assert.ok(idle.detail.includes('按住热键'));
    assert.deepEqual(calls, []);
    advance(4000);
    assert.equal(hudText().visible, '0');
  });

  await check('dispose: stops mic/context, removes listeners + HUD + timers, is idempotent', async () => {
    calls.length = 0;
    doc.dispatch('keydown', defaultDown());
    await settle();
    assert.equal(hotkey.status().recording, true);
    const track = mic.tracks[mic.tracks.length - 1];
    assert.equal(track.stopped, false);
    const recordingContext = activeRecordingContext();
    assert.ok(recordingContext);

    hotkey.dispose();
    assert.equal(track.stopped, true, 'dispose must stop the microphone track');
    assert.equal(recordingContext.closed, true, 'dispose must close the recording AudioContext');
    assert.equal(hotkey.status().installed, false);
    assert.equal(hotkey.status().recording, false);
    assert.equal(hudRoot(), null, 'dispose must remove the HUD');
    assert.equal(doc.listenerCount('keydown'), 0);
    assert.equal(doc.listenerCount('keyup'), 0);
    assert.equal(win.listenerCount('blur'), 0);
    assert.equal(timers.size, 0, 'dispose must clear every timer');
    assert.equal(audioContexts.every((context) => context.closed), true);
    assert.equal(mic.tracks.every((entry) => entry.stopped), true);

    hotkey.dispose();
    const before = hotkey.status().phase;
    doc.dispatch('keydown', defaultDown());
    await settle();
    assert.equal(hotkey.status().phase, before);
    assert.deepEqual(calls, []);
  });

  await check('reinstall uses localStorage override Alt+KeyM', async () => {
    store.set('dsh.voice-companion.hotkey', 'Alt+KeyM');
    calls.length = 0;
    hotkey.install();
    assert.equal(hotkey.status().installed, true);
    assert.equal(hotkey.status().hotkey, 'Alt+KeyM');

    doc.dispatch('keydown', keyEvent('Space', ' ', { ctrl: true, shift: true }));
    await settle();
    assert.equal(hotkey.status().phase, 'idle', 'default chord must be inert after override');

    doc.dispatch('keydown', keyEvent('KeyM', 'm', { alt: true }));
    await settle();
    assert.equal(hotkey.status().phase, 'recording');
    assert.equal(hotkey.status().hotkey, 'Alt+KeyM');
    advance(100);
    doc.dispatch('keyup', keyEvent('KeyM', 'm', { alt: true }));
    const idle = await waitForPhase(hotkey, 'idle');
    assert.equal(idle.phase, 'idle');
    assert.deepEqual(calls, []);
    hotkey.dispose();
    assert.equal(timers.size, 0);
    assert.equal(hudRoot(), null);
    assert.equal(store.get('dsh.voice-companion.hotkey'), 'Alt+KeyM');
  });

  await check('no timer callback threw and every request went through the fake host', () => {
    assert.deepEqual(timerErrors, []);
    assert.equal(warnings.some((line) => line.includes('TypeError')), false);
  });

  const failed = results.filter((result) => !result.ok);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.log('FAIL harness crashed');
  console.log(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
