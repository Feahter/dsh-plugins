/**
 * Offline harness for the realtime-voice client bundle.
 *
 * The plugin ships as a hand-written `window.__ModuleLoader__.load({...})` bundle
 * instead of a tsdown build, so it cannot be imported. This file evaluates the
 * real bundle in a `vm` sandbox with the small surface it touches (module loader,
 * React shims, DOM stubs) and then exercises the shipped code:
 *
 *   1. the pure post-processing pipeline (`__test`),
 *   2. `apply(ctx)` against a recording ctx: slot registrations, provided service,
 *   3. the cross-plugin API (`voiceInput.attach` + a failing capture path).
 *
 * Run: node test/harness.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// Regression net: every speech-service call must go through `runtime.speech`.
// Calling `runtime.catalog()` / `runtime.prepare()` directly throws
// "runtime.catalog is not a function" at the moment the user hits the mic.
const bareSpeechCalls = (source.match(/\bruntime\.(catalog|prepare|transcribe|follow|configure|cancelPreparation)\s*\(/g) || [])
if (bareSpeechCalls.length > 0) {
  console.error(`✗ speech calls missing the .speech receiver: ${bareSpeechCalls.join(', ')}`)
  process.exit(1)
}
console.log('✓ speech service calls all go through runtime.speech')

const failures = []
let checks = 0
function ok(label, condition, detail) {
  checks += 1
  if (!condition) failures.push(detail === undefined ? label : `${label} → ${detail}`)
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ------------------------------------------------------------------- sandbox
function makeDocument() {
  const head = { children: [], appendChild(node) { this.children.push(node) } }
  const doc = {
    head,
    querySelector() { return null },
    createElement(tag) {
      return {
        tagName: tag, dataset: {}, style: {}, textContent: '',
        appendChild() {}, remove() {}, setAttribute() {},
      }
    },
  }
  return doc
}

const storage = new Map()
const localStorageStub = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null },
  setItem(key, value) { storage.set(key, String(value)) },
  removeItem(key) { storage.delete(key) },
}

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) { return { type, props, children } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useRef(value) { return { current: value } },
  useEffect() {},
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
}

let captured = null
const windowStub = {
  AudioContext: null,
  __ModuleLoader__: { load(record) { captured = record } },
  localStorage: localStorageStub,
  addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} } },
  setTimeout, clearTimeout, setInterval, clearInterval,
}

const sandbox = {
  window: windowStub,
  document: makeDocument(),
  localStorage: localStorageStub,
  navigator: {
    language: 'zh-CN',
    mediaDevices: {
      async getUserMedia() { throw Object.assign(new Error('mock: no microphone'), { name: 'NotFoundError' }) },
    },
  },
  fetch: async () => { throw new Error('mock: offline') },
  AbortController,
  setTimeout, clearTimeout, setInterval, clearInterval,
  console,
  URL, TextEncoder, TextDecoder,
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
  AudioContext: class {
    constructor() { this.state = 'running'; this.sampleRate = 16000; this.currentTime = 0; this.destination = {} }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
    createGain() { return { connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {} } } }
    createOscillator() { return { type: 'sine', frequency: { value: 440 }, connect() {}, disconnect() {}, start() {}, stop() {} } }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    close() { return Promise.resolve() }
    resume() { return Promise.resolve() }
  },
  AudioWorkletNode: undefined,
}
sandbox.globalThis = sandbox
sandbox.self = sandbox

const context = vm.createContext(sandbox)
vm.runInContext(source, context, { filename: 'client.js' })

ok('bundle registers with the module loader', captured !== null)
eq('bundle id', captured && captured.id, 'dsh-realtime-voice')

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
}
const plugin = captured.factory(requireStub)
ok('factory returns apply', typeof plugin.apply === 'function')
ok('factory returns inject', Array.isArray(plugin.inject))
ok('inject names slots/locale/remote', ['remote', 'slots', 'locale'].every((n) => plugin.inject.includes(n)))
ok('__test exports the pipeline', plugin.__test && typeof plugin.__test.polish === 'function')

// ------------------------------------------------------------- pure pipeline
const t = plugin.__test

eq('stripFillers drops zh fillers', t.stripFillers('嗯 我觉得 那个 可以').replace(/\s+/g, ''), '我觉得可以')
eq('stripFillers drops en fillers', t.stripFillers('um so, uh, this works').replace(/\s+/g, ' ').trim(), 'so, this works')
eq('collapseRepeats zh', t.collapseRepeats('我我我觉得可可以'), '我觉得可以')
eq('collapseRepeats en', t.collapseRepeats('the the test'), 'the test')
eq('resolveSelfCorrections keeps final intent', t.resolveSelfCorrections('周三 不对 我是说 周四'), '周四')
eq('resolveSelfCorrections keeps prior sentence', t.resolveSelfCorrections('先做A。不对，做B'), '先做A。做B')
eq('applySpokenCommands punctuation', t.applySpokenCommands('先写代码 逗号 再测试'), '先写代码 ， 再测试')
eq('applyDictionary', t.applyDictionary('用 dsh 跑一下', [{ from: 'dsh', to: 'DeepSeek Harness' }]), '用 DeepSeek Harness 跑一下')
eq('isCjkText true', t.isCjkText('你好世界'), true)
eq('isCjkText false', t.isCjkText('hello world'), false)
eq('fixPunctuation cjk', t.fixPunctuation('今天开会 明天评审'), '今天开会明天评审。')
eq('fixPunctuation en', t.fixPunctuation('hello world, this is a test'), 'Hello world, this is a test.')

const polished = t.polish('嗯 我我我觉得 这个方案 不行 不对 我是说 换个方案', { filler: true, repeats: true, corrections: true, punctuation: true })
ok('polish composes stages', polished.text.includes('换个方案'), polished.text)
ok('polish reports notes', polished.notes.includes('filler') && polished.notes.includes('repeats'), JSON.stringify(polished.notes))
eq('polish empty', t.polish('   ', {}).text, '')

eq('normalizeSettings defaults', t.normalizeSettings(null).mode, 'dictate')
eq('normalizeSettings keeps online translation on by default', t.normalizeSettings(null).onlineTranslate, true)
eq('normalizeSettings honours an explicit online-translation opt-out', t.normalizeSettings({ onlineTranslate: false }).onlineTranslate, false)
eq('normalizeSettings keeps translate fallback default', t.normalizeSettings({}).translateFallback, 'source')
eq('parseDictionary round trip', t.formatDictionary(t.parseDictionary('DSH=DeepSeek Harness\n# comment\nb=1')), 'DSH=DeepSeek Harness\nb=1')
eq('reconcilePartial keeps the longer transcript', t.reconcilePartial('hello', 'hello world'), 'hello world')
eq('reconcilePartial keeps the previous on shrink', t.reconcilePartial('hello world', 'hello'), 'hello world')

// ----------------------------------------------------------- context merge
eq('contextMode defaults to pairing adjacent phrases', t.normalizeSettings({}).contextMode, 'pair')
eq('contextMode can be switched off', t.normalizeSettings({ contextMode: 'off' }).contextMode, 'off')
eq('merge keeps CJK seam tight', t.mergeSegments('今天下午三点开会。', '把上周的进度同步一下。').text,
  '今天下午三点开会。把上周的进度同步一下。')
eq('merge spaces two English sentences', t.mergeSegments('We met at three.', 'Then we talked.').text,
  'We met at three. Then we talked.')
eq('merge drops the repeated seam word', t.mergeSegments('我说这个问题', '这个问题已经解决了').text,
  '我说这个问题已经解决了')
eq('merge follows a correction across the pause', t.mergeSegments('会议定在周三', '不对，是周四').text,
  '会议定在周四')
eq('merge does not restack punctuation', t.mergeSegments('先做 A，', '，再做 B').text, '先做 A，再做 B')
eq('merge notes the applied rules', t.mergeSegments('我说这个问题', '这个问题已经解决了').notes.includes('seam-overlap'), true)
eq('merge returns the head when the tail is empty', t.mergeSegments('只说了一半', '').text, '只说了一半')

// ------------------------------------------------------- apply(ctx) contract
const record = { registers: [], provides: [], effects: [], injects: [], injected: [] }
const speechStub = {
  async transcribe() { return { ok: true, value: { text: 'mock', providers: [], selection: null } } },
  async catalog() { return { ok: true, value: { providers: [], selection: null } } },
  async prepare() { return { ok: true, value: null } },
}
const ctx = {
  effect(fn) { record.effects.push(fn); const disposer = fn(); return typeof disposer === 'function' ? disposer : () => {} },
  locale: { register(ns, dicts) { record.locale = [ns, dicts] }, getLocale() { return { active: 'zh-CN' } } },
  slots: {
    inject(name, fn) { record.injects.push(name); try { fn() } catch (error) { record.injects.push(`error:${error.message}`) } },
    register(spec) { record.registers.push(spec); return () => {} },
  },
  inject(deps, fn) { record.injected.push(deps); return fn({ remote: { speech: speechStub } }) },
  provide(name, value) { record.provides.push([name, value]); return () => {} },
}

const dispose = plugin.apply(ctx)
ok('apply returns a disposer', typeof dispose === 'function')
ok('locale registered', Array.isArray(record.locale) && record.locale[0] === 'realtime-voice')
ok('speech scope requested', record.injected.some((deps) => deps.includes('remote.speech')), JSON.stringify(record.injected))

const activity = record.registers.find((spec) => spec.name === 'conversation.input.activity')
ok('microphone takes the activity slot', Boolean(activity), JSON.stringify(record.registers.map((r) => r.name)))
eq('microphone shadows the built-in (priority -1)', activity && activity.priority, -1)
const dock = record.registers.find((spec) => spec.name === 'conversation.input.dock')
ok('voice bar registers in the dock', Boolean(dock))
const configSlot = record.registers.find((spec) => spec.name === 'plugins.bundle.config')
ok('settings card registers on the bundle page', configSlot && configSlot.key === 'dsh-realtime-voice')
const sectionSlot = record.registers.find((spec) => spec.name === 'settings.section')
ok('settings page registers in the settings panel', sectionSlot && sectionSlot.id === 'realtime-voice', JSON.stringify(sectionSlot))
ok('settings page carries a localized label', Boolean(sectionSlot && sectionSlot.label && sectionSlot.label.length > 0), sectionSlot && sectionSlot.label)

const provided = record.provides.find(([name]) => name === 'voiceInput')
ok('voiceInput service provided', Boolean(provided))
const api = provided && provided[1]
ok('api exposes version/surfaces/settings', Boolean(api.version && api.surfaces && api.settings))
eq('api version', api.version, '0.3.0')
eq('settings default mode', api.settings.get().mode, 'dictate')

// ---------------------------------------------------- cross-plugin API contract
const inserted = []
const states = []
const token = api.attach({
  id: 'harness',
  label: 'Harness field',
  captureInsertion() { return { from: 0, to: 0 } },
  insertText(text, span) { inserted.push([text, span]); return true },
  onState(state) { states.push(state.phase) },
})
ok('attach returns a handle', token && token.id === 'harness')
ok('api.surfaces lists the attached surface', api.surfaces().includes('harness'), JSON.stringify(api.surfaces()))
const started = await token.start()
ok('start fails cleanly without a microphone', started && started.ok === false, JSON.stringify(started))
eq('failed start lands in error phase', token.store.get().phase, 'error')
ok('failure carries a message', typeof token.store.get().error === 'string' && token.store.get().error.length > 0)
ok('onState saw starting', states.includes('starting'), JSON.stringify(states))
await token.stop()
await token.detach()
ok('detach removes the surface', !api.surfaces().includes('harness'))

// engine + public api must not throw on double dispose
await dispose()
ok('double stop is harmless', true)

// ------------------------------------------------ adjacent-phrase pairing (e2e)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let lastProcessor = null
const BaseAudioContext = sandbox.AudioContext
sandbox.AudioContext = class extends BaseAudioContext {
  createScriptProcessor(...args) { const processor = super.createScriptProcessor(...args); lastProcessor = processor; return processor }
}
windowStub.AudioContext = sandbox.AudioContext
sandbox.navigator.mediaDevices.getUserMedia = async () => ({
  getAudioTracks: () => [{ addEventListener() {}, stop() {} }],
  getTracks: () => [{ stop() {} }],
})
const transcripts = ['今天下午三点开会', '把上周的进度同步一下']
speechStub.catalog = async () => ({ ok: true, value: { providers: [{ id: 'p', preparation: { phase: 'ready' } }], selection: { providerId: 'p' } } })
speechStub.transcribe = async () => ({ ok: true, value: { text: transcripts.shift() || '' } })

api.settings.patch({ partialPreview: false, contextMode: 'pair', flushMs: 3000 })
const paired = []
const pairToken = api.attach({
  id: 'seam',
  label: 'Seam field',
  captureInsertion() { return { from: 0, to: 0 } },
  insertText(text) { paired.push(text); return true },
  onState() {},
})
const pairStart = await pairToken.start()
ok('engine starts against the fake device', pairStart && pairStart.ok === true, JSON.stringify(pairStart))
ok('microphone processor was wired', lastProcessor !== null)

const feedFrames = (amplitude, count) => {
  for (let i = 0; i < count; i += 1) {
    const frame = new Float32Array(1024)
    if (amplitude > 0) for (let j = 0; j < frame.length; j += 1) frame[j] = (Math.random() * 2 - 1) * amplitude
    lastProcessor.onaudioprocess({ inputBuffer: { getChannelData: () => frame } })
  }
}
// First utterance: no insert yet, the segment is held for its neighbour.
feedFrames(0.25, 40)
await sleep(160)
feedFrames(0, 60)
await sleep(600)
eq('first phrase is held, not inserted', paired.length, 0)
// Second utterance: arrives inside the flush window, so both land as one.
feedFrames(0.25, 40)
await sleep(160)
feedFrames(0, 60)
await sleep(800)
console.log('STATE', JSON.stringify(pairToken.store.get()))
eq('paired phrases insert once', paired.length, 1, JSON.stringify(paired))
ok('paired insert joins both phrases', /会议|开会/.test(paired[0] || '') && /同步/.test(paired[0] || ''), JSON.stringify(paired))
// A lone phrase must still land: the flush timer releases the held segment.
transcripts.push('\u5355\u53e5\u4e5f\u8981\u80fd\u63d2\u5165')
api.settings.patch({ flushMs: 300 })
const beforeFlush = paired.length
feedFrames(0.25, 40)
await sleep(160)
feedFrames(0, 60)
await sleep(900)
eq('a lone phrase flushes after the hold window', paired.length, beforeFlush + 1, JSON.stringify(paired))
ok('flushed phrase carries the text', /\u5355\u53e5/.test(paired[paired.length - 1] || ''), JSON.stringify(paired))

await pairToken.stop()
await pairToken.detach()

// With pairing off the original per-segment latency comes back.
api.settings.patch({ contextMode: 'off', flushMs: 1400 })
transcripts.push('\u9010\u53e5\u63d2\u5165')
const fast = []
const fastToken = api.attach({
  id: 'fast', label: 'Fast field',
  captureInsertion() { return { from: 0, to: 0 } },
  insertText(text) { fast.push(text); return true },
  onState() {},
})
await fastToken.start()
feedFrames(0.25, 40)
await sleep(160)
feedFrames(0, 60)
await sleep(500)
ok('contextMode off inserts without waiting for a neighbour', fast.length === 1 && /\u9010\u53e5/.test(fast[0]), JSON.stringify(fast))
await fastToken.stop()
await fastToken.detach()
api.settings.patch({ contextMode: 'pair' })

// ------------------------------------------------ failure paths (v0.3.1 fixes)
// A failed preview decode is transient: the final decode for the same segment
// retries, so it must not put the engine in `error` (which used to leave the
// microphone running with no way to restart).
api.settings.patch({ contextMode: 'off', partialPreview: true })
{
  transcripts.push('\u9884\u89c8\u5931\u8d25\u540e\u4ecd\u80fd\u63d2\u5165')
  speechStub.transcribe = async () => ({ ok: false, error: { code: 'SPEECH_TIMEOUT', message: 'preview boom' } })
  const probe = []
  const probeToken = api.attach({
    id: 'probe', label: 'Probe field',
    captureInsertion() { return { from: 0, to: 0 } },
    insertText(text) { probe.push(text); return true },
    onState() {},
  })
  const probeStart = await probeToken.start()
  ok('probe engine starts', probeStart && probeStart.ok === true, JSON.stringify(probeStart))
  feedFrames(0.25, 30)
  await sleep(600)
  eq('a failed partial preview keeps the engine listening', probeToken.store.get().phase, 'listening')
  speechStub.transcribe = async () => ({ ok: true, value: { text: transcripts.shift() || '' } })
  feedFrames(0, 40)
  await sleep(700)
  ok('dictation still inserts after a failed preview', probe.length === 1 && /\u9884\u89c8\u5931\u8d25/.test(probe[0] || ''), JSON.stringify(probe))
  await probeToken.stop()
  await probeToken.detach()
}

// A failed final decode is fatal for that capture, but must close the
// microphone and leave a retry path: phase=error, running=false, toggle works.
{
  const errorTracks = []
  sandbox.navigator.mediaDevices.getUserMedia = async () => {
    const track = { stopped: false, addEventListener() {}, stop() { this.stopped = true } }
    errorTracks.push(track)
    return { getAudioTracks: () => [track], getTracks: () => [track] }
  }
  api.settings.patch({ partialPreview: false })
  speechStub.transcribe = async () => ({ ok: false, error: { code: 'SPEECH_UNAVAILABLE', message: 'asr down' } })
  const errToken = api.attach({
    id: 'failing', label: 'Failing field',
    captureInsertion() { return { from: 0, to: 0 } },
    insertText() { return true },
    onState() {},
  })
  await errToken.start()
  feedFrames(0.25, 15)
  feedFrames(0, 20)
  await sleep(800)
  eq('a failed final decode lands in error', errToken.store.get().phase, 'error')
  ok('a failed final decode releases the microphone', errorTracks.length === 1 && errorTracks[0].stopped === true, JSON.stringify(errorTracks))
  speechStub.transcribe = async () => ({ ok: true, value: { text: '\u6062\u590d\u540e\u7ee7\u7eed' } })
  const retry = await errToken.toggle()
  ok('toggle after an error starts a fresh capture', retry && retry.ok === true, JSON.stringify(retry))
  eq('the retry is listening', errToken.store.get().phase, 'listening')
  await errToken.stop()
  await errToken.detach()
  api.settings.patch({ partialPreview: true })
}

// Stopping while the model is still preparing is a cancel, not a failure: the
// idle state stop() set must not be repainted as an error.
{
  speechStub.catalog = async () => ({ ok: true, value: { providers: [{ id: 'p', preparation: { phase: 'preparing' } }], selection: { providerId: 'p' } } })
  speechStub.prepare = async () => ({ ok: true, value: null })
  const slowToken = api.attach({
    id: 'slow', label: 'Slow field',
    captureInsertion() { return { from: 0, to: 0 } },
    insertText() { return true },
    onState() {},
  })
  const starting = slowToken.start()
  await sleep(50)
  await slowToken.stop()
  const outcome = await starting
  ok('stopping during model prep reports cancelled', outcome && outcome.ok === false, JSON.stringify(outcome))
  eq('stopping during model prep leaves idle, not error', slowToken.store.get().phase, 'idle')
  await slowToken.detach()
}

// ------------------------------------------ microphone permission + hotkey fallback
{
  // The previous block deliberately leaves the model provider "preparing";
  // these permission tests need a ready catalog so the retry is fast.
  speechStub.catalog = async () => ({ ok: true, value: { providers: [{ id: 'p', preparation: { phase: 'ready' } }], selection: { providerId: 'p' } } })
  const makeToken = (id) => api.attach({
    id, label: id,
    captureInsertion() { return { from: 0, to: 0 } },
    insertText() { return true },
    onState() {},
  })

  storage.delete('dsh.realtime-voice.mic-intro')
  let noticeAtPrompt = ''
  sandbox.navigator.mediaDevices.getUserMedia = async () => {
    noticeAtPrompt = api.state('denied').notice
    throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
  }
  const deniedToken = makeToken('denied')
  const denied = await deniedToken.start()
  ok('a denied permission returns ok:false without throwing', denied && denied.ok === false && denied.code === 'permission', JSON.stringify(denied))
  eq('a denied permission lands in error', deniedToken.store.get().phase, 'error')
  ok(
    'a denial names the macOS settings path in both languages',
    /系统设置/.test(deniedToken.store.get().error) && /Privacy & Security/.test(deniedToken.store.get().error),
    deniedToken.store.get().error,
  )
  eq('the permission state is denied, not cached', deniedToken.store.get().permission, 'permission')
  ok('settings stay usable after a denial', api.settings.get().enabled === true)
  ok(
    'the one-time consent hint is visible before the browser prompt',
    /首次点麦克风/.test(noticeAtPrompt) && /first click/i.test(noticeAtPrompt),
    noticeAtPrompt,
  )

  let retryCalls = 0
  sandbox.navigator.mediaDevices.getUserMedia = async () => {
    retryCalls += 1
    return { getAudioTracks: () => [{ addEventListener() {}, stop() {} }], getTracks: () => [{ stop() {} }] }
  }
  const retried = await deniedToken.start()
  ok('clicking the mic again retries getUserMedia after a denial', retried && retried.ok === true && retryCalls === 1, JSON.stringify({ retried, retryCalls }))
  eq('the retry records an actual grant', deniedToken.store.get().permission, 'granted')
  await deniedToken.stop()
  await deniedToken.detach()

  sandbox.navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
  }
  const missingToken = makeToken('missing')
  const missing = await missingToken.start()
  ok('a missing device returns ok:false', missing && missing.ok === false, JSON.stringify(missing))
  ok(
    'NotFoundError has its own bilingual copy',
    /没有检测到麦克风/.test(missingToken.store.get().error) && /No microphone found/.test(missingToken.store.get().error),
    missingToken.store.get().error,
  )
  eq('a missing device is tagged missing', missingToken.store.get().permission, 'missing')
  await missingToken.stop()
  await missingToken.detach()

  sandbox.navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('busy'), { name: 'NotReadableError' })
  }
  const busyToken = makeToken('busy')
  await busyToken.start()
  ok(
    'NotReadableError has its own bilingual copy',
    /被其他应用占用/.test(busyToken.store.get().error) && /Microphone busy/.test(busyToken.store.get().error),
    busyToken.store.get().error,
  )
  eq('a busy device is tagged busy', busyToken.store.get().permission, 'busy')
  await busyToken.stop()
  await busyToken.detach()

  // hotkey binding: a host that refuses addEventListener must not be silent.
  const t = plugin.__test
  let attempts = 0
  const flaky = {
    addEventListener(type) {
      if (type === 'keydown') { attempts += 1; if (attempts === 1) throw new Error('taken') }
    },
    removeEventListener() {},
  }
  const fallback = t.bindHotkey(flaky, 'Alt+Shift+KeyD', () => {})
  eq('a throwing hotkey bind switches candidates', fallback.mode, 'fallback')
  ok('the fallback records the candidate that won', fallback.spec.startsWith('ControlLeft+'), fallback.spec)
  ok('the fallback notice says what happened in both languages', /已切换到/.test(fallback.notice) && /instead/.test(fallback.notice), fallback.notice)

  const allFail = t.bindHotkey({ addEventListener() { throw new Error('nope') }, removeEventListener() {} }, 'Alt+Shift+KeyD', () => {})
  eq('no bindable key falls back to the mic button', allFail.mode, 'button')
  ok('the button notice points at the mic in both languages', /点麦克风/.test(allFail.notice) && /click the mic/.test(allFail.notice), allFail.notice)

  const plain = { addEventListener() {}, removeEventListener() {} }
  const reserved = t.bindHotkey(plain, 'ControlLeft+KeyW', () => {})
  eq('a browser-reserved chord is skipped', reserved.tried[0].reason, 'reserved')
  ok('the reserved chord is replaced by a candidate', reserved.mode === 'fallback' && reserved.spec.indexOf('KeyW') >= 0, reserved.spec)
}

// ------------------------------------------------------------------- report
if (failures.length > 0) {
  console.error(`\nFAIL ${failures.length}/${checks}`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log(`PASS ${checks}/${checks} checks`)
