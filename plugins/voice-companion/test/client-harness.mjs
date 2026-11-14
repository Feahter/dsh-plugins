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
    return respond({ ok: true, ...turnPlan });
  }
  if (String(url).includes('/events')) {
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
    getUserMedia: async () => {
      getUserMediaCalls += 1;
      return { getAudioTracks: () => tracks, getTracks: () => tracks };
    },
  },
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

group('proactive event');
eventPlan = {
  events: [{ id: 7, type: 'task-done', text: '老板，日志清完了。', summary: 'ok' }],
  cursor: 7,
};
await new Promise((r) => setTimeout(r, 1800));
check('event spoken on poll', calls.some((c) => c.url.endsWith('/speak') && c.body.text === '老板，日志清完了。'));

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
check('two character chips rendered', chips().length === 2, chips().map((c) => c.getAttribute('data-character')));
check('whale chip pressed at start', chipAt(0).getAttribute('aria-pressed') === 'true');
check('stage starts on the whale', avatarRoot().getAttribute('data-character') === 'whale');
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
modeButton().dispatch('click');
check('clicking again returns to 对话', modeButton().textContent === '对话');

group('teardown');
window.__dshVoiceCompanion.stop();
await new Promise((r) => setTimeout(r, 60));
check('microphone tracks stopped', tracks.every((track) => track.stopped));
check('status inactive after stop', window.__dshVoiceCompanion.status().active === false);
disposer();
check('root removed on dispose', !body.children.some((node) => node.id === 'dsh-voice-companion-root'));
check('debug handle deleted', window.__dshVoiceCompanion === undefined);

console.log('\n' + (failures ? 'FAILED ' + failures + ' check(s)' : 'PASS'));
process.exit(failures ? 1 : 0);
