// Offline harness for client.js: no browser, no network, no real clock.
//
//   node test/client-harness.mjs
//
// Loads the plugin through a fake `window.__ModuleLoader__`, drives the hotkey with
// synthetic KeyboardEvents, and asserts the /plan -> /dispatch / /speak sequence.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'client.js');

// ------------------------------------------------------------------ DOM fakes

function makeElement(tagName) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    children: [],
    textContent: '',
    attributes: {},
    removed: false,
    listeners: {},
    addEventListener(type, handler) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      const list = this.listeners[type] || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {
      this.removed = true;
      const siblings = documentStub.body.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
    },
  };
  return element;
}

const listeners = { document: {}, window: {} };

function listenOn(bucket) {
  return {
    addEventListener(type, handler) {
      if (!bucket[type]) bucket[type] = [];
      bucket[type].push(handler);
    },
    removeEventListener(type, handler) {
      const list = bucket[type] || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
  };
}

const documentStub = Object.assign(listenOn(listeners.document), {
  createElement: (tagName) => makeElement(tagName),
  body: {
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  },
});

const windowStub = Object.assign(listenOn(listeners.window), {
  location: { origin: 'http://127.0.0.1:63672' },
});

// ------------------------------------------------------------- browser fakes

class FakeRecorder {
  constructor(stream) {
    this.stream = stream;
    this.mimeType = 'audio/webm';
    this.state = 'inactive';
    this.onstop = null;
    this.ondataavailable = null;
  }

  start() {
    this.state = 'recording';
    if (typeof this.ondataavailable === 'function') this.ondataavailable({ data: new Blob([new Uint8Array(8)]) });
  }

  stop() {
    this.state = 'inactive';
    if (typeof this.onstop === 'function') this.onstop();
  }
}

class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      getFloatTimeDomainData(buffer) {
        buffer.fill(0.02);
      },
    };
  }

  createMediaStreamSource() {
    return { connect() {} };
  }

  async decodeAudioData() {
    return {
      duration: 0.6,
      sampleRate: 48000,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(28800),
    };
  }

  async close() {}
}

class FakeOfflineAudioContext {
  constructor(channels, frames, sampleRate) {
    this.channels = channels;
    this.frames = frames;
    this.sampleRate = sampleRate;
    this.destination = {};
  }

  createBufferSource() {
    return { buffer: null, connect() {}, start() {} };
  }

  async startRendering() {
    const data = new Float32Array(this.frames);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.sin(index / 40) * 0.25;
    return { getChannelData: () => data };
  }
}

function installNavigator(fake) {
  try {
    Object.defineProperty(globalThis, 'navigator', { value: fake, configurable: true, writable: true });
    return 'defineProperty';
  } catch (_defineError) {
    try {
      globalThis.navigator.mediaDevices = fake.mediaDevices;
      return 'mediaDevices';
    } catch (_assignError) {
      return 'none';
    }
  }
}

const navigatorMode = installNavigator({
  mediaDevices: {
    async getUserMedia() {
      return { getTracks: () => [{ stop() {} }] };
    },
  },
});
globalThis.MediaRecorder = FakeRecorder;
globalThis.AudioContext = FakeAudioContext;
globalThis.OfflineAudioContext = FakeOfflineAudioContext;
// `Audio` stays undefined: playback resolves immediately, /speak is still called.

// ------------------------------------------------------------------- clock

let now = 1000;
let timerSeq = 0;
const timers = new Map();

const clock = {
  now: () => now,
  setTimeout: (fn, ms) => {
    timerSeq += 1;
    timers.set(timerSeq, { fn, at: now + (Number(ms) || 0) });
    return timerSeq;
  },
  clearTimeout: (id) => {
    timers.delete(id);
  },
  setInterval: (fn, ms) => {
    timerSeq += 1;
    timers.set(timerSeq, { fn, at: now + (Number(ms) || 0), every: Number(ms) || 1 });
    return timerSeq;
  },
  clearInterval: (id) => {
    timers.delete(id);
  },
};

// --------------------------------------------------------------------- fetch

const calls = [];
let transcript = '你好世界';
const planResponses = [];

async function fetchStub(url, init) {
  const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: (init && init.method) || 'GET', body, headers: (init && init.headers) || {} });
  const respond = (payload, status = 200) => ({
    ok: status < 400,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  });
  const target = String(url);
  if (target.endsWith('/plan')) {
    const next = planResponses.shift();
    if (!next) throw new Error('harness: unexpected POST /plan');
    return respond(next);
  }
  if (target.endsWith('/dispatch')) {
    return respond({ ok: true, sessionId: (body && body.sessionId) || 's-new', accepted: true });
  }
  if (target.endsWith('/speak')) {
    return respond({ ok: true, audioBase64: 'UklGRg==', mimeType: 'audio/wav', durationMs: 120, voiceId: 'stella', cached: false });
  }
  throw new Error('harness: unexpected url ' + target);
}

const speechCalls = [];
const speech = {
  async transcribe(request, signal) {
    speechCalls.push({ request, hasSignal: !!signal });
    return { ok: true, value: { text: transcript } };
  },
};

// --------------------------------------------------------------------- load

let loaded = null;
let moduleId = null;
let factoryCalls = 0;

globalThis.window = Object.assign(windowStub, {
  __ModuleLoader__: {
    load({ id, factory }) {
      moduleId = id;
      factoryCalls += 1;
      loaded = factory((name) => {
        if (name === 'react') return { createElement: () => ({}) };
        throw new Error('harness: unexpected require(' + name + ')');
      });
    },
  },
});
globalThis.document = documentStub;
globalThis.fetch = fetchStub;

const source = fs.readFileSync(clientPath, 'utf8');
vm.runInThisContext(source, { filename: clientPath });

// ------------------------------------------------------------------ helpers

function pressEvent(overrides) {
  const event = Object.assign(
    {
      key: ' ',
      code: 'Space',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      repeat: false,
      defaultPrevented: false,
      prevented: false,
      target: { tagName: 'BODY' },
      preventDefault() {
        this.prevented = true;
        this.defaultPrevented = true;
      },
    },
    overrides || {},
  );
  return event;
}

function fire(bucket, type, event) {
  const list = listeners[bucket][type] || [];
  assert.ok(list.length > 0, 'expected a ' + type + ' listener on ' + bucket);
  for (const handler of list) handler(event);
  return event;
}

function resetCalls() {
  calls.length = 0;
  speechCalls.length = 0;
}

function byPath(suffix) {
  return calls.filter((call) => call.url.endsWith(suffix));
}

const results = [];
function pass(name, detail) {
  results.push(name);
  console.log('ok ' + results.length + ' - ' + name + (detail ? ' :: ' + detail : ''));
}

// -------------------------------------------------------------------- tests

async function main() {
  assert.equal(moduleId, 'dsh-voice-control', 'module id');
  assert.equal(factoryCalls, 1, 'factory invoked once');
  assert.equal(typeof loaded.apply, 'function', 'exports apply');
  assert.equal(typeof loaded.__test, 'function' === 'x' ? 'x' : typeof loaded.__test, 'exports __test');
  assert.ok(loaded.__test && typeof loaded.__test === 'object', '__test is an object');
  for (const key of ['encodeWave', 'toBase64', 'parseHotkey', 'matchesHotkey', 'setClock', 'whenIdle']) {
    assert.equal(typeof loaded.__test[key], 'function', '__test.' + key);
  }
  pass('module shape', 'id=' + moduleId + ' exports apply+__test=' + Object.keys(loaded.__test).length + ' helpers');

  loaded.__test.setClock(clock);

  // --- pure helper spot checks (cheap evidence the WAV header is right) ---
  const hotkey = loaded.__test.parseHotkey('Ctrl+Shift+Space');
  assert.deepEqual([hotkey.ctrl, hotkey.shift, hotkey.alt, hotkey.meta, hotkey.key], [true, true, false, false, 'Space']);
  assert.equal(loaded.__test.matchesHotkey(pressEvent(), hotkey), true, 'Space matches');
  assert.equal(loaded.__test.matchesHotkey(pressEvent({ ctrlKey: false }), hotkey), false, 'ctrl required');
  assert.equal(loaded.__test.matchesHotkey(pressEvent({ key: 'a', code: 'KeyA' }), hotkey), false, 'other key ignored');

  const wav = loaded.__test.encodeWave(new Float32Array([1, -1, 0]));
  assert.equal(wav.length, 44 + 3 * 2, 'wav length');
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  const wavView = new DataView(wav.buffer);
  assert.equal(wavView.getUint32(24, true), 16000, 'sample rate');
  assert.equal(wavView.getUint16(22, true), 1, 'mono');
  assert.equal(wavView.getUint16(34, true), 16, '16 bit');
  assert.equal(wavView.getInt16(44, true), 32767, 'clamp +1');
  assert.equal(wavView.getInt16(46, true), -32768, 'clamp -1');
  const b64 = loaded.__test.toBase64(wav);
  assert.ok(b64.length > 0 && Buffer.from(b64, 'base64').length === wav.length, 'base64 roundtrip length');
  pass('pure helpers', 'wav=' + wav.length + 'B rate=' + wavView.getUint32(24, true) + ' b64=' + b64.length + 'ch');

  // --- apply() with a fake ctx ---
  const effects = [];
  const fakeCtx = {
    get(name) {
      if (name === 'speechToText') return { providers: ['local'] };
      return undefined;
    },
    effect(fn) {
      const dispose = fn();
      effects.push(dispose);
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
    inject(names, callback) {
      assert.deepEqual(names, ['remote.speech'], 'inject names');
      const result = callback({ remote: { speech } });
      return { dispose: typeof result === 'function' ? result : () => {} };
    },
  };
  const dispose = loaded.apply(fakeCtx);
  assert.equal(typeof dispose, 'function', 'apply returns a disposer');
  assert.equal(effects.length, 1, 'one ctx.effect registered');
  pass('apply()', 'navigator=' + navigatorMode + ' effects=' + effects.length + ' disposer=' + typeof dispose);

  // --- 1. resume: press 420 ms, transcript -> plan.resume -> dispatch prompt ---
  resetCalls();
  planResponses.push({
    ok: true,
    plan: { action: 'resume', sessionId: 's1', candidates: [], confidence: 0.93, reason: 'title match', text: '你好世界' },
    confirmation: '好，接着「语音控制插件」。',
  });
  transcript = '你好世界';

  // Focused in a composer must still start: no focus bail-out.
  const down = pressEvent({ target: { tagName: 'TEXTAREA' } });
  fire('document', 'keydown', down);
  assert.equal(down.prevented, true, 'hotkey preventDefault on keydown');
  assert.equal(loaded.__test.status().state, 'listening', 'state listening after keydown');

  // repeat keydown must not restart.
  const repeatEvent = pressEvent({ repeat: true });
  fire('document', 'keydown', repeatEvent);
  assert.equal(repeatEvent.prevented, false, 'repeat ignored');

  now += 420;
  const up = pressEvent();
  fire('document', 'keyup', up);
  assert.equal(up.prevented, true, 'hotkey preventDefault on keyup');
  await loaded.__test.whenIdle();

  const planCalls = byPath('/plan');
  const dispatchCalls = byPath('/dispatch');
  const speakCalls = byPath('/speak');
  assert.equal(planCalls.length, 1, 'exactly one POST /plan');
  assert.equal(planCalls[0].method, 'POST', 'plan is POST');
  assert.ok(typeof planCalls[0].body.utterance === 'string' && planCalls[0].body.utterance.length > 0, 'non-empty utterance');
  assert.equal(planCalls[0].body.utterance, '你好世界', 'plan carries the transcript');
  assert.equal(planCalls[0].body.pending, undefined, 'no pending on a fresh utterance');
  assert.equal(dispatchCalls.length, 1, 'exactly one POST /dispatch');
  assert.equal(dispatchCalls[0].body.action, 'prompt', 'dispatch action=prompt');
  assert.equal(dispatchCalls[0].body.sessionId, 's1', 'dispatch sessionId=s1');
  assert.equal(dispatchCalls[0].body.text, '你好世界', 'dispatch text=utterance');
  assert.equal(speakCalls.length, 1, 'confirmation spoken once');
  assert.equal(speakCalls[0].body.text, '好，接着「语音控制插件」。', 'speak carries the confirmation');
  assert.equal(speechCalls.length, 1, 'one local transcription');
  assert.ok(speechCalls[0].request.audioBase64.length > 100, 'audioBase64 non-trivial');
  assert.equal(loaded.__test.status().state, 'idle', 'back to idle');
  pass(
    'resume route',
    'plan=1 dispatch=1 speak=1 utterance="' + planCalls[0].body.utterance + '" action=' + dispatchCalls[0].body.action + ' sessionId=' + dispatchCalls[0].body.sessionId,
  );

  // --- 2. short press (< 300 ms): no network, HUD hint 按住说话 ---
  resetCalls();
  now += 5000;
  fire('document', 'keydown', pressEvent());
  now += 120;
  fire('document', 'keyup', pressEvent());
  await loaded.__test.whenIdle();
  assert.equal(byPath('/plan').length, 0, 'short press makes no /plan call');
  assert.equal(speechCalls.length, 0, 'short press never transcribes');
  assert.equal(loaded.__test.status().state, 'idle', 'short press returns to idle');
  {
    const hud = documentStub.body.children.find((node) => node.attributes['data-dsh-voice-control'] === 'hud');
    assert.ok(hud, 'HUD node exists');
    const texts = hud.children.map((child) => child.textContent);
    assert.ok(texts.includes('按住说话'), 'HUD hint is 按住说话, got ' + JSON.stringify(texts));
  }
  pass('short press', 'plan=0 speech=0 hud contains 按住说话');

  // --- 3. ask: speaks the confirmation, stays armed, no dispatch ---
  resetCalls();
  planResponses.push({
    ok: true,
    plan: {
      action: 'ask',
      sessionId: null,
      candidates: [
        { sessionId: 'a', title: 'A', score: 0.51 },
        { sessionId: 'b', title: 'B', score: 0.44 },
      ],
      confidence: 0.42,
      reason: 'two close matches',
      text: '你好世界',
    },
    confirmation: '你是指1，A；2，B，还是说“新开”？',
  });
  transcript = '你好世界';
  now += 5000;
  fire('document', 'keydown', pressEvent());
  assert.equal(loaded.__test.status().state, 'listening', 'ask press starts listening');
  now += 600;
  fire('document', 'keyup', pressEvent());
  await loaded.__test.whenIdle();

  assert.equal(byPath('/plan').length, 1, 'ask: one /plan');
  assert.equal(byPath('/dispatch').length, 0, 'ask: no /dispatch');
  assert.equal(byPath('/speak').length, 1, 'ask: confirmation spoken');
  assert.equal(byPath('/speak')[0].body.text, '你是指1，A；2，B，还是说“新开”？', 'ask: speak text');
  assert.equal(loaded.__test.status().pending, 2, 'ask: two candidates remembered');
  {
    const hud = documentStub.body.children.find((node) => node.attributes['data-dsh-voice-control'] === 'hud');
    const texts = hud.children.map((child) => child.textContent).join('|');
    assert.ok(/1，A/.test(texts) && /2，B/.test(texts), 'HUD shows numbered candidates, got ' + texts);
  }
  pass('ask path', 'plan=1 dispatch=0 speak=1 pending=2 hud="1，A；2，B"');

  // --- 4. answering the ask: the next /plan carries pending ---
  resetCalls();
  planResponses.push({
    ok: true,
    plan: { action: 'resume', sessionId: 'a', candidates: [], confidence: 0.88, reason: 'ordinal answer', text: '第一个' },
    confirmation: '好，接着「A」。',
  });
  transcript = '第一个';
  now += 5000;
  fire('document', 'keydown', pressEvent());
  now += 500;
  fire('document', 'keyup', pressEvent());
  await loaded.__test.whenIdle();

  const answeredPlan = byPath('/plan');
  assert.equal(answeredPlan.length, 1, 'answer: one /plan');
  assert.ok(Array.isArray(answeredPlan[0].body.pending), 'answer: plan body has pending');
  assert.equal(answeredPlan[0].body.pending.length, 2, 'answer: pending has 2 candidates');
  assert.equal(answeredPlan[0].body.pending[0].sessionId, 'a', 'answer: pending[0].sessionId');
  assert.equal(answeredPlan[0].body.pending[1].sessionId, 'b', 'answer: pending[1].sessionId');
  assert.equal(answeredPlan[0].body.utterance, '第一个', 'answer: utterance is 第一个');
  assert.equal(byPath('/dispatch')[0].body.sessionId, 'a', 'answer: dispatch resumed candidate a');
  assert.equal(loaded.__test.status().pending, 0, 'pending cleared after a resolved dispatch');
  pass('answer path', 'pending=2->dispatch sessionId=a pending_after=0');

  // --- 5. blur releases the microphone ---
  resetCalls();
  now += 5000;
  fire('document', 'keydown', pressEvent());
  assert.equal(loaded.__test.status().state, 'listening', 'blur case: listening');
  fire('window', 'blur', { type: 'blur' });
  assert.equal(loaded.__test.status().state, 'idle', 'blur returns to idle');
  await loaded.__test.whenIdle();
  assert.equal(byPath('/plan').length, 0, 'blur makes no /plan call');
  pass('blur', 'state=idle plan=0');

  // --- 5b. releasing a modifier before Space still ends the press ---
  resetCalls();
  planResponses.push({
    ok: true,
    plan: { action: 'resume', sessionId: 's1', candidates: [], confidence: 0.9, reason: 'modifier release', text: '你好世界' },
    confirmation: '好，接着「语音控制插件」。',
  });
  transcript = '你好世界';
  const binding = loaded.__test.parseHotkey('Ctrl+Shift+Space');
  assert.equal(
    loaded.__test.modifierReleased(pressEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: false }), binding),
    true,
    'a Shift keyup counts as releasing the chord',
  );
  now += 5000;
  fire('document', 'keydown', pressEvent());
  assert.equal(loaded.__test.status().state, 'listening', 'modifier case: listening');
  now += 420;
  const shiftUp = pressEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: false });
  fire('document', 'keyup', shiftUp);
  assert.equal(shiftUp.prevented, true, 'modifier keyup preventDefault');
  assert.notEqual(loaded.__test.status().state, 'listening', 'modifier keyup ends listening');
  await loaded.__test.whenIdle();
  assert.equal(byPath('/plan').length, 1, 'modifier keyup still transcribes and plans');
  assert.equal(loaded.__test.status().state, 'idle', 'modifier keyup returns to idle');
  pass('modifier release', 'shift-up ends the press and dispatches');

  // --- 5c. hotkey binding falls back instead of failing silently ---
  const noopHandlers = { onKeyDown() {}, onKeyUp() {} };
  const flakyTarget = {
    attempts: 0,
    addEventListener(type) {
      if (type === 'keydown') {
        this.attempts += 1;
        if (this.attempts === 1) throw new Error('taken by another app');
      }
    },
    removeEventListener() {},
  };
  const flaky = loaded.__test.bindHotkey(flakyTarget, 'Ctrl+Shift+Space', noopHandlers);
  assert.equal(flaky.mode, 'fallback', 'the second candidate should win');
  assert.equal(flaky.spec, 'AltLeft+Ctrl+Shift+Space');
  assert.equal(flaky.tried[0].reason, 'error');
  assert.ok(flaky.notice.includes('已切换到') && flaky.notice.includes('instead'), flaky.notice);

  const reserved = loaded.__test.bindHotkey({ addEventListener() {}, removeEventListener() {} }, 'Ctrl+KeyW', noopHandlers);
  assert.equal(reserved.tried[0].reason, 'reserved', 'Ctrl+W must be skipped before binding');
  assert.equal(reserved.mode, 'fallback');

  const broken = loaded.__test.bindHotkey({ addEventListener() { throw new Error('nope'); }, removeEventListener() {} }, 'Ctrl+Shift+Space', noopHandlers);
  assert.equal(broken.mode, 'button');
  assert.equal(broken.ok, false);
  assert.ok(broken.notice.includes('按住说话') && broken.notice.includes('Hold to talk'), broken.notice);
  pass('hotkey fallback', 'candidate=AltLeft+Ctrl+Shift+Space button-notice=ok');

  // --- 5d. the in-app button is always mounted and drives the same press ---
  const fallbackButton = documentStub.body.children.find((node) => node.attributes['data-dsh-voice-control'] === 'fallback');
  assert.ok(fallbackButton, 'fallback button mounted on apply');
  assert.equal(loaded.__test.status().fallback, true);
  assert.equal(loaded.__test.status().binding.mode, 'hotkey');
  resetCalls();
  planResponses.push({
    ok: true,
    plan: { action: 'resume', sessionId: 's1', candidates: [], confidence: 0.9, reason: 'fallback button', text: '你好世界' },
    confirmation: '好，接着「语音控制插件」。',
  });
  transcript = '你好世界';
  now += 5000;
  fallbackButton.listeners.pointerdown[0]({ preventDefault() {} });
  assert.equal(loaded.__test.status().state, 'listening', 'fallback button starts a press');
  now += 420;
  fallbackButton.listeners.pointerup[0]({ preventDefault() {} });
  await loaded.__test.whenIdle();
  assert.equal(byPath('/plan').length, 1, 'fallback button transcribes and plans');
  assert.equal(loaded.__test.status().state, 'idle');
  pass('fallback button', 'pointer hold dispatches');

  // --- 5e. microphone permission copy is specific, not generic ---
  const originalGetUserMedia = globalThis.navigator.mediaDevices.getUserMedia;
  const hudDetail = () => {
    const hud = documentStub.body.children.find((node) => node.attributes['data-dsh-voice-control'] === 'hud');
    return hud && hud.children[2] ? hud.children[2].textContent : '';
  };
  globalThis.navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  };
  resetCalls();
  now += 5000;
  fire('document', 'keydown', pressEvent());
  await new Promise((resolve) => setTimeout(resolve, 10));
  fire('document', 'keyup', pressEvent());
  await loaded.__test.whenIdle();
  assert.equal(loaded.__test.status().state, 'error', 'denied mic lands in error');
  assert.ok(hudDetail().includes('系统设置') && hudDetail().includes('Privacy & Security'), hudDetail());
  pass('permission copy', 'NotAllowedError names macOS settings');

  globalThis.navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
  };
  now += 5000;
  fire('document', 'keydown', pressEvent());
  await new Promise((resolve) => setTimeout(resolve, 10));
  fire('document', 'keyup', pressEvent());
  await loaded.__test.whenIdle();
  assert.ok(hudDetail().includes('没有检测到麦克风') && !hudDetail().includes('系统设置'), hudDetail());
  pass('permission copy', 'NotFoundError is distinct and actionable');
  globalThis.navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  now += 10000;

  // --- 6. __dshVoiceControl debug handle + disposer ---
  assert.equal(typeof globalThis.window.__dshVoiceControl.start, 'function', 'window.__dshVoiceControl.start');
  assert.equal(typeof globalThis.window.__dshVoiceControl.stop, 'function', 'window.__dshVoiceControl.stop');
  assert.equal(typeof globalThis.window.__dshVoiceControl.status, 'function', 'window.__dshVoiceControl.status');
  assert.equal(typeof globalThis.window.__dshVoiceControl.plan, 'function', 'window.__dshVoiceControl.plan');

  resetCalls();
  planResponses.push({
    ok: true,
    plan: { action: 'resume', sessionId: 's1', candidates: [], confidence: 0.9, reason: 'debug', text: '调试' },
    confirmation: '好，接着「调试」。',
  });
  const planPromise = globalThis.window.__dshVoiceControl.plan('调试');
  await planPromise;
  assert.equal(byPath('/plan').length, 1, '__dshVoiceControl.plan posts /plan');
  assert.equal(byPath('/dispatch').length, 1, '__dshVoiceControl.plan dispatches');
  pass('debug handle', 'plan(text) -> /plan + /dispatch');

  const hudBeforeDispose = documentStub.body.children.find((node) => node.attributes['data-dsh-voice-control'] === 'hud');
  assert.ok(hudBeforeDispose, 'HUD present before dispose');
  assert.equal(listeners.document.keydown.length, 1, 'one keydown listener before dispose');
  assert.equal(listeners.document.keyup.length, 1, 'one keyup listener before dispose');
  assert.equal(listeners.window.blur.length, 1, 'one blur listener before dispose');

  dispose();

  assert.equal(listeners.document.keydown.length, 0, 'keydown listener removed');
  assert.equal(listeners.document.keyup.length, 0, 'keyup listener removed');
  assert.equal(listeners.window.blur.length, 0, 'blur listener removed');
  assert.equal(hudBeforeDispose.removed, true, 'HUD node removed from the document');
  assert.equal(documentStub.body.children.includes(hudBeforeDispose), false, 'HUD no longer in body');
  assert.equal(globalThis.window.__dshVoiceControl, undefined, 'debug handle cleared');
  pass('dispose', 'listeners=0,0,0 hudRemoved=true handleCleared=true');

  console.log('\nPASS ' + results.length + ' groups, ' + timers.size + ' fake timers pending, 0 real waits');
}

main().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
