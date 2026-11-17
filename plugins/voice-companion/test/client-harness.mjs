// Headless harness for the built client bundle: fake DOM, fake microphone, fake audio graph.
// Drives a full turn — speech frames → VAD → transcribe → /turn → /speak → playback —
// so the browser half is verified without a human pressing anything.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let current = '';

function group(name) {
  current = name;
  console.log('\n# ' + name);
}

function check(label, condition, detail) {
  if (condition) {
    console.log('ok   ' + label);
  } else {
    failures += 1;
    console.log('FAIL ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  }
}

// ------------------------------------------------------------------ fake DOM
function createElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    dataset: {},
    classList: {
      _set: new Set(),
      add(...names) { names.forEach((n) => this._set.add(n)); },
      remove(...names) { names.forEach((n) => this._set.delete(n)); },
      toggle(name, force) {
        if (force === undefined) {
          this._set.has(name) ? this._set.delete(name) : this._set.add(name);
        } else if (force) this._set.add(name);
        else this._set.delete(name);
        return this._set.has(name);
      },
      contains(name) { return this._set.has(name); },
    },
    _text: '',
    _html: '',
    get textContent() { return this._text; },
    set textContent(value) { this._text = String(value); },
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = String(value); },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() { this.parentNode && this.parentNode.removeChild(this); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) {
      this._listeners = this._listeners || {};
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const list = (this._listeners && this._listeners[type]) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event) {
      for (const handler of ((this._listeners && this._listeners[type]) || []).slice()) handler(event || {});
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 320, height: 260, top: 0, left: 0 }; },
    setPointerCapture() {},
    focus() {},
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
  };
  return node;
}

const body = createElement('body');

// ------------------------------------------------------------------ fake mic
const SAMPLE_RATE = 16000;
const FRAME = 320;
let processorNode = null;
const tracks = [{ stopped: false, addEventListener() {}, stop() { this.stopped = true; } }];
let getUserMediaCalls = 0;

function makeAudioContext() {
  return {
    sampleRate: SAMPLE_RATE,
    state: 'running',
    destination: createElement('destination'),
    resume: async () => {},
    close: async () => {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => {
      processorNode = { onaudioprocess: null, connect() {}, disconnect() {} };
      return processorNode;
    },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createAnalyser: () => ({
      fftSize: 512,
      connect() {},
      disconnect() {},
      getFloatTimeDomainData(target) { target.fill(0.4); },
    }),
    createBufferSource: () => {
      const src = {
        buffer: null,
        connect() {},
        disconnect() {},
        start() {
          setTimeout(() => src.onended && src.onended(), 5);
        },
        stop() { src.stopped = true; },
      };
      return src;
    },
    decodeAudioData: async () => ({ duration: 0.5, numberOfChannels: 1, sampleRate: SAMPLE_RATE }),
  };
}

// -------------------------------------------------------------- fake network
const calls = [];
let turnPlan = { say: ['收到。', '我去清一下日志。'], task: null, kind: 'chat', reply: '收到。我去清一下日志。' };
let eventPlan = { events: [], cursor: 0 };
let eventDelayMs = 0;
let turnDelayMs = 0;
let speakCounter = 0;

async function fakeFetch(url, init = {}) {
  const bodyText = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method || 'GET', body: bodyText });
  const respond = (payload) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  });
  if (String(url).includes('/speak')) {
    speakCounter += 1;
    return respond({
      ok: true,
      audioBase64: Buffer.from('RIFFxxxxWAVEfmt ').toString('base64'),
      mimeType: 'audio/wav',
      durationMs: 900,
      voiceId: 'stella',
      cached: speakCounter > 3,
    });
  }
  if (String(url).includes('/turn')) {
    if (turnDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, turnDelayMs));
    return respond({ ok: true, ...turnPlan });
  }
  if (String(url).includes('/events')) {
    if (eventDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, eventDelayMs));
    return respond({ ok: true, ...eventPlan });
  }
  if (String(url).includes('/transcribe')) {
    return respond({ ok: true, text: '帮我把日志清一下' });
  }
  return respond({ ok: false, code: 'not-found', message: 'unknown route ' + url });
}

// ------------------------------------------------------------- module loading
let moduleId = null;
let factory = null;
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      moduleId = spec.id;
      factory = spec.factory;
    },
  },
  AudioContext: makeAudioContext,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 8),
  cancelAnimationFrame: (id) => clearTimeout(id),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 2,
};
globalThis.document = {
  body,
  documentElement: body,
  head: createElement('head'),
  createElement,
  createElementNS: (_ns, tag) => createElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  readyState: 'complete',
  hidden: false,
};
const fakeNavigator = {
  userAgent: 'node-harness',
  mediaDevices: {
    getUserMedia: (options) => getUserMediaImpl(options),
  },
};
let getUserMediaImpl = async () => {
  getUserMediaCalls += 1;
  return { getAudioTracks: () => tracks, getTracks: () => tracks };
};
Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true, writable: true });
const navigator = fakeNavigator;
globalThis.fetch = fakeFetch;

const bundle = await readFile(join(root, 'client.js'), 'utf8');
new Function('window', 'document', 'navigator', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', bundle)(
  globalThis.window,
  globalThis.document,
  globalThis.navigator,
  fakeFetch,
  globalThis.window.requestAnimationFrame,
  globalThis.window.cancelAnimationFrame,
);

group('module shape');
check('module id is dsh-voice-companion', moduleId === 'dsh-voice-companion', moduleId);
const plugin = factory(() => { throw new Error('unexpected require'); });
check('exports apply + __test', !!(plugin.apply && plugin.__test));
check(
  'client half injects no host service',
  plugin.inject === undefined || !plugin.inject.includes('webServer'),
  JSON.stringify(plugin.inject),
);

// ------------------------------------------------------------------ fake ctx
const disposes = [];
let settingsScope = null;
const ctx = {
  inject(deps, callback) {
    settingsScope = callback({
      remote: {
        speech: {
          transcribe: async (request) => ({ ok: true, value: { text: '帮我把日志清一下' } }),
          prepare: async () => ({ ok: true }),
        },
      },
    });
    return () => {};
  },
  effect(fn) {
    const dispose = fn();
    disposes.push(dispose);
    return () => {};
  },
  logger: { info() {}, warn() {} },
  get() { return null; },
  on() { return () => {}; },
};

group('apply');
const disposer = plugin.apply(ctx);
check('disposer is a function', typeof disposer === 'function');
check('root mounted into document.body', body.children.some((node) => node.id === 'dsh-voice-companion-root'));
check('debug handle exposed', typeof window.__dshVoiceCompanion === 'object');
check('status idle before call', window.__dshVoiceCompanion.status().active === false);

group('call start');
await window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 60));
check('microphone requested once', getUserMediaCalls === 1, getUserMediaCalls);
check('status active', window.__dshVoiceCompanion.status().active === true);
check('/speak called for greeting', calls.some((c) => c.url.endsWith('/speak') && c.body.text === '喂，我在。'));
check('fillers prefetched', calls.filter((c) => c.url.endsWith('/speak')).length >= 3, calls.length);

group('full turn: speech frames → VAD → ASR → /turn → /speak');
const before = calls.length;
function feedSpeech(ms, amplitude) {
  const frames = Math.round(ms / 20);
  for (let i = 0; i < frames; i += 1) {
    const buffer = new Float32Array(FRAME);
    for (let j = 0; j < buffer.length; j += 1) {
      buffer[j] = amplitude * Math.sin((i * FRAME + j) * 0.06);
    }
    processorNode.onaudioprocess({ inputBuffer: { getChannelData: () => buffer } });
  }
}
check('script processor wired', typeof processorNode.onaudioprocess === 'function');
feedSpeech(900, 0.3);   // speech
feedSpeech(900, 0.001); // silence → endpoint
await new Promise((r) => setTimeout(r, 400));
check('/turn issued after endpoint', calls.some((c) => c.url.endsWith('/turn')), calls.slice(before).map((c) => c.url));
const turnCall = calls.find((c) => c.url.endsWith('/turn'));
check('/turn carries the recognised text', !!turnCall && /日志/.test(turnCall.body.utterance), turnCall && turnCall.body);
const replySpeaks = calls.filter((c) => c.url.endsWith('/speak') && /收到|清一下/.test(c.body.text));
check('reply sentences synthesised', replySpeaks.length === 2, replySpeaks.map((c) => c.body.text).concat(calls.map((c) => c.url + ':' + (c.body && c.body.text))));

group('conversation memory');
const turnCallsBeforeSecond = calls.filter((c) => c.url.endsWith('/turn')).length;
feedSpeech(900, 0.3);
feedSpeech(900, 0.001);
await new Promise((r) => setTimeout(r, 700));
const turnCalls = calls.filter((c) => c.url.endsWith('/turn'));
check('a second utterance opens a second turn', turnCalls.length === turnCallsBeforeSecond + 1, turnCalls.length);
const history = turnCalls.length > 0 ? turnCalls[turnCalls.length - 1].body.history : undefined;
check(
  'history uses the protocol `content` field (not `text`)',
  Array.isArray(history) && history.length === 2 && history.every((entry) => typeof entry.content === 'string' && entry.content !== ''),
  history,
);
check(
  'history carries the previous exchange',
  Array.isArray(history) && history[0]?.role === 'user' && /日志/.test(history[0]?.content || '') && history[1]?.role === 'assistant',
  history,
);

group('proactive event');
eventPlan = {
  events: [{ id: 7, type: 'task-done', text: '老板，日志清完了。', summary: 'ok' }],
  cursor: 7,
};
await new Promise((r) => setTimeout(r, 1800));
check('event spoken on poll', calls.some((c) => c.url.endsWith('/speak') && c.body.text === '老板，日志清完了。'));

group('event polling is single-flight');
eventPlan = {
  events: [{ id: 9, type: 'task-done', text: '老板，第二个任务完了。', summary: 'ok' }],
  cursor: 9,
};
eventDelayMs = 400;
const pollCallsBefore = calls.filter((c) => c.url.includes('/events')).length;
const doublePoll = [plugin.__test.pollEvents(), plugin.__test.pollEvents()];
await Promise.all(doublePoll);
const pollCalls = calls.filter((c) => c.url.includes('/events')).length - pollCallsBefore;
check('concurrent polls collapse into one request', pollCalls === 1, pollCalls);
const secondEventSpeaks = calls.filter(
  (c) => c.url.endsWith('/speak') && c.body.text === '老板，第二个任务完了。',
).length;
check('the event is announced exactly once', secondEventSpeaks === 1, secondEventSpeaks);
eventDelayMs = 0;
eventPlan = { events: [], cursor: 9 };

// ------------------------------------------------------- helpers for tree walks
function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}
function findAll(node, predicate) {
  const found = [];
  walk(node, (entry) => {
    if (predicate(entry)) found.push(entry);
  });
  return found;
}
const hasClass = (n, name) => typeof n.attributes?.class === 'string' && n.attributes.class.split(/\s+/).includes(name);
const stub = { getAttribute: () => null, dispatch() {}, textContent: '' };
const avatarRoot = () => findAll(body, (n) => n.attributes && 'data-vc-avatar' in n.attributes)[0] || stub;
const chips = () => findAll(body, (n) => hasClass(n, 'vc-chip'));
const chipAt = (index) => chips()[index] || stub;
const modeButton = () => findAll(body, (n) => hasClass(n, 'vc-mode'))[0] || stub;
const labelNode = () => findAll(body, (n) => hasClass(n, 'vc-label'))[0] || stub;

group('character picker (看板娘切换)');
const builtinChips = () => chips().filter((c) => ['whale', 'chibi'].includes(c.getAttribute('data-character')));
check('two builtin character chips rendered', builtinChips().length === 2, chips().map((c) => c.getAttribute('data-character')));
check('custom-face add chip is present', chips().some((c) => hasClass(c, 'vc-add')));
// v0.4 contract change: the stage boots on the 3D core, which is a renderer
// rather than a picker entry, so no builtin chip is pressed until the user picks.
check('stage starts on the core', avatarRoot().getAttribute('data-character') === 'core');
check('no builtin chip is pressed while the core renders', builtinChips().every((c) => c.getAttribute('aria-pressed') !== 'true'));
chipAt(1).dispatch('click');
check('clicking the chibi chip swaps the stage', avatarRoot().getAttribute('data-character') === 'chibi');
check('chips stay mutually exclusive', chipAt(1).getAttribute('aria-pressed') === 'true' && chipAt(0).getAttribute('aria-pressed') === 'false');
check('label follows the cast', /小肥鱼/.test(labelNode().textContent), labelNode().textContent);
const beforeSwitch = calls.length;
await window.__dshVoiceCompanion.say('我在呢。');
await new Promise((r) => setTimeout(r, 80));
const switched = calls.slice(beforeSwitch).filter((c) => c.url.endsWith('/speak'));
check('/speak carries the new character', switched.length > 0 && switched[switched.length - 1].body.character === 'chibi', switched.map((c) => c.body));

group('dictation mode (对话 / 听写)');
check('mode button starts in 对话', modeButton().textContent === '对话', modeButton().textContent);
check('avatar reports call mode', window.__dshVoiceCompanion.mode() === 'call');
modeButton().dispatch('click');
check('button flips to 听写', modeButton().textContent === '听写', modeButton().textContent);
check('avatar reports dictation mode', window.__dshVoiceCompanion.mode() === 'dictation');
const turnsBefore = calls.filter((c) => c.url.endsWith('/turn')).length;
feedSpeech(900, 0.3);
feedSpeech(900, 0.001);
await new Promise((r) => setTimeout(r, 400));
check(
  'dictation does not open a chat turn',
  calls.filter((c) => c.url.endsWith('/turn')).length === turnsBefore,
  calls.filter((c) => c.url.endsWith('/turn')).length,
);
const dictationBubble = findAll(body, (n) => hasClass(n, 'vc-bubble'))[0] || stub;
check(
  'a failed dictation insert keeps its error visible',
  /输入框不可用/.test(dictationBubble.textContent),
  dictationBubble.textContent,
);
modeButton().dispatch('click');
check('clicking again returns to 对话', modeButton().textContent === '对话');

group('voice settings drawer (built bundle)');
const byClass = (name) => findAll(body, (n) => hasClass(n, name))[0] || stub;
const gear = byClass('vc-gear');
const sheet = byClass('vc-sheet');
check('gear button exists', gear !== stub);
check('drawer starts closed', sheet.getAttribute('data-open') === '0', sheet.getAttribute('data-open'));
gear.dispatch('click');
check('gear opens the drawer', sheet.getAttribute('data-open') === '1', sheet.getAttribute('data-open'));
const slotSelects = ['base', 'bright', 'soft'].map((slot) =>
  findAll(body, (n) => hasClass(n, 'vc-slot') && n.getAttribute('data-slot') === slot)[0] || stub,
);
check('three voice slots rendered', slotSelects.every((node) => node !== stub), slotSelects.length);
const optionsFor = (node) => (node.children || []).map((child) => child.getAttribute('value'));
check('slot options come from the voice catalog', optionsFor(slotSelects[0]).includes('tide') && optionsFor(slotSelects[0]).includes('stella'), optionsFor(slotSelects[0]));
const speedInput = byClass('vc-speed');
speedInput.value = '1.2';
speedInput.dispatch('input');
check('speed label follows the slider', /×1\.20/.test(byClass('vc-speed-value').textContent), byClass('vc-speed-value').textContent);
slotSelects[0].value = 'tide';
slotSelects[1].value = 'tide';
byClass('vc-save').dispatch('click');
const savedProfile = window.__dshVoiceCompanion.voice();
check('save reports the profile back to the orchestrator', savedProfile.speed === 1.2, savedProfile);
check('save keeps the chosen bright slot', savedProfile.map.bright === 'tide', savedProfile.map);
const previewsBefore = calls.length;
byClass('vc-preview').dispatch('click');
await new Promise((r) => setTimeout(r, 60));
const previewCall = calls.slice(previewsBefore).filter((c) => c.url.endsWith('/speak')).pop();
check('preview asks for audio with the chosen voice', previewCall !== undefined && previewCall.body.voiceId === 'tide', previewCall && previewCall.body);
byClass('vc-reset').dispatch('click');
check('reset restores defaults', window.__dshVoiceCompanion.voice().speed === 1 && Object.keys(window.__dshVoiceCompanion.voice().map).length === 0, window.__dshVoiceCompanion.voice());
gear.dispatch('click');
check('gear closes the drawer again', sheet.getAttribute('data-open') === '0', sheet.getAttribute('data-open'));

group('hangup during an in-flight turn');
turnDelayMs = 300;
const callsBeforeHangup = calls.length;
feedSpeech(900, 0.3);
feedSpeech(900, 0.001);
await new Promise((r) => setTimeout(r, 220));
window.__dshVoiceCompanion.stop();
await new Promise((r) => setTimeout(r, 500));
const staleReplySpeaks = calls
  .slice(callsBeforeHangup)
  .filter((c) => c.url.endsWith('/speak') && /收到|清一下/.test(c.body.text || ''));
check('a reply that resolves after hangup is not spoken', staleReplySpeaks.length === 0, staleReplySpeaks.map((c) => c.body.text));
check('the engine stays idle after the late reply', window.__dshVoiceCompanion.status().phase === 'idle', window.__dshVoiceCompanion.status());
turnDelayMs = 0;

group('microphone race: stop during the permission prompt');
window.__dshVoiceCompanion.stop();
await new Promise((r) => setTimeout(r, 80));
const racedTracks = [{ stopped: false, addEventListener() {}, stop() { this.stopped = true; } }];
let releaseMedia = null;
getUserMediaImpl = () => new Promise((resolve) => {
  releaseMedia = () => resolve({ getAudioTracks: () => racedTracks, getTracks: () => racedTracks });
});
const cancelledStart = window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 30));
window.__dshVoiceCompanion.stop();
releaseMedia();
await cancelledStart;
await new Promise((r) => setTimeout(r, 80));
check('a start cancelled during the permission prompt drops the stream', racedTracks[0].stopped === true);
check('the cancelled start leaves the call inactive', window.__dshVoiceCompanion.status().active === false);
check('the cancelled start leaves the engine idle', window.__dshVoiceCompanion.status().phase === 'idle');

group('microphone consent: explain before the prompt');
window.__dshVoiceCompanion.stop();
await new Promise((r) => setTimeout(r, 80));
const noticeNode = (rootNode) => {
  const scope = rootNode || body;
  return findAll(scope, (n) => hasClass(n, 'vc-notice'))[0] || stub;
};
const currentRoot = () => findAll(body, (n) => n.attributes && 'data-vc-avatar' in n.attributes).at(-1) || stub;
let releasePrompt = null;
getUserMediaImpl = () => new Promise((resolve) => { releasePrompt = resolve; });
const introStart = window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 30));
check('the first-call notice explains why the mic is needed', noticeNode().textContent.includes('首次使用') && noticeNode().textContent.includes('First use'), noticeNode().textContent);
check('the notice promises on-device recognition', noticeNode().textContent.includes('本机') && noticeNode().textContent.includes('this device'));
releasePrompt({ getAudioTracks: () => tracks, getTracks: () => tracks });
await introStart;
await new Promise((r) => setTimeout(r, 80));
check('a granted start clears the consent notice', noticeNode().textContent === '', noticeNode().textContent);
window.__dshVoiceCompanion.stop();
await new Promise((r) => setTimeout(r, 80));

group('microphone permission: denied, missing, busy');
const deniedBefore = getUserMediaCalls;
getUserMediaImpl = async () => {
  getUserMediaCalls += 1;
  throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
};
await window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 60));
check('a denied start does not activate the call', window.__dshVoiceCompanion.status().active === false);
check('NotAllowedError shows the macOS settings path', noticeNode().textContent.includes('系统设置') && noticeNode().textContent.includes('Privacy & Security'), noticeNode().textContent);
check('a denied start leaves the panel mounted', body.children.some((node) => node.id === 'dsh-voice-companion-root'));
check('a denied start keeps other panel actions usable', typeof window.__dshVoiceCompanion.character === 'function');
check('the mic state is denied, not cached as granted', window.__dshVoiceCompanion.permission().state === 'denied', window.__dshVoiceCompanion.permission());

getUserMediaImpl = async () => {
  getUserMediaCalls += 1;
  return { getAudioTracks: () => tracks, getTracks: () => tracks };
};
await window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 120));
check('the next click retries getUserMedia after a denial', getUserMediaCalls === deniedBefore + 2, getUserMediaCalls - deniedBefore);
check('permission recovery starts the call without a reload', window.__dshVoiceCompanion.status().active === true, window.__dshVoiceCompanion.status());
check('permission recovery clears the notice', noticeNode().textContent === '');
window.__dshVoiceCompanion.stop();
await new Promise((r) => setTimeout(r, 80));

getUserMediaImpl = async () => {
  getUserMediaCalls += 1;
  throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
};
await window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 60));
check('NotFoundError has its own copy', noticeNode().textContent.includes('没有检测到麦克风') && noticeNode().textContent.includes('No microphone found'), noticeNode().textContent);
check('NotFoundError is not reported as a permission denial', !noticeNode().textContent.includes('系统设置'));

getUserMediaImpl = async () => {
  getUserMediaCalls += 1;
  throw Object.assign(new Error('busy'), { name: 'NotReadableError' });
};
await window.__dshVoiceCompanion.start();
await new Promise((r) => setTimeout(r, 60));
check('NotReadableError has its own copy', noticeNode().textContent.includes('被其他应用占用') && noticeNode().textContent.includes('Microphone is busy'), noticeNode().textContent);

group('hotkey binding: candidate fallback is visible in the panel');
const originalDocumentAdd = document.addEventListener;
const originalDocumentRemove = document.removeEventListener;
let bindAttempts = 0;
document.addEventListener = function patchedAdd(type, handler) {
  // The avatar registers its own Escape handler first; the hotkey bind is the
  // second keydown listener and is the one we make fail.
  if (type === 'keydown') {
    bindAttempts += 1;
    if (bindAttempts === 2) throw new Error('taken by another app');
  }
  return originalDocumentAdd.call(this, type, handler);
};
const disposerFallback = plugin.apply(ctx);
await new Promise((r) => setTimeout(r, 60));
const fallbackRoot = currentRoot();
check('a throwing bind switches to the next candidate', window.__dshVoiceCompanion.hotkey().binding.mode === 'fallback', window.__dshVoiceCompanion.hotkey().binding);
check('the fallback candidate is shown', window.__dshVoiceCompanion.hotkey().binding.spec.startsWith('AltLeft+'), window.__dshVoiceCompanion.hotkey().binding.spec);
check('the fallback notice is bilingual', noticeNode(fallbackRoot).textContent.includes('已切换到') && noticeNode(fallbackRoot).textContent.includes('instead'), noticeNode(fallbackRoot).textContent);
check('the in-app hold button appears with the fallback', findAll(fallbackRoot, (n) => hasClass(n, 'vc-hold-row'))[0].getAttribute('data-visible') === '1');
disposerFallback();
await new Promise((r) => setTimeout(r, 40));
check('the fallback panel disposes cleanly', !body.children.includes(fallbackRoot));

let keydownCalls = 0;
document.addEventListener = function alwaysThrows(type, handler) {
  if (type === 'keydown') {
    keydownCalls += 1;
    if (keydownCalls >= 2) throw new Error('no keyboard access');
  }
  return originalDocumentAdd.call(this, type, handler);
};
const disposerButton = plugin.apply(ctx);
await new Promise((r) => setTimeout(r, 60));
const buttonRoot = currentRoot();
check('all candidates failing leaves hotkey mode button', window.__dshVoiceCompanion.hotkey().binding.mode === 'button', window.__dshVoiceCompanion.hotkey().binding);
check('the button-mode notice points at the panel control', noticeNode(buttonRoot).textContent.includes('按住说话') && noticeNode(buttonRoot).textContent.includes('Hold to talk'), noticeNode(buttonRoot).textContent);
check('the panel still mounts in button mode', body.children.some((node) => node.id === 'dsh-voice-companion-root'));
disposerButton();
await new Promise((r) => setTimeout(r, 40));
document.addEventListener = originalDocumentAdd;
document.removeEventListener = originalDocumentRemove;
const disposer2 = plugin.apply(ctx);
await new Promise((r) => setTimeout(r, 40));
check('a healthy re-apply restores the primary hotkey', window.__dshVoiceCompanion.hotkey().binding.mode === 'hotkey', window.__dshVoiceCompanion.hotkey().binding);
disposer2();
await new Promise((r) => setTimeout(r, 40));

group('teardown');
if (window.__dshVoiceCompanion) {
  window.__dshVoiceCompanion.stop();
  await new Promise((r) => setTimeout(r, 60));
  check('microphone tracks stopped', tracks.every((track) => track.stopped));
  check('status inactive after stop', window.__dshVoiceCompanion.status().active === false);
}
disposer();
check('root removed on dispose', !body.children.some((node) => node.id === 'dsh-voice-companion-root'));
check('debug handle deleted', window.__dshVoiceCompanion === undefined);

console.log('\n' + (failures ? 'FAILED ' + failures + ' check(s)' : 'PASS'));
process.exit(failures ? 1 : 0);
