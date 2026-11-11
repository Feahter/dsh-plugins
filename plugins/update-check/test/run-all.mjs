/**
 * dsh-update-check — verification suite (no test framework, no network).
 *
 * Covers the three things a broken release would show up as:
 *   1. version math / feed parsing (pure);
 *   2. the authenticated Host route, driven through a real HTTP server against a
 *      local feed (success, up-to-date, unreachable feed, cache and refresh);
 *   3. the client bundle: loader registration, slot wiring and the rendered panel,
 *      including the one click that hands off to `window.dshDesktop.updates.open()`.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as hostModule from '../index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const APP = '/Applications/DeepSeek Harness.app/Contents/Resources/app-update.yml'

const results = []
async function check(name, body) {
  try {
    await body()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error })
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

// ------------------------------------------------------------ 1. version math

await check('compareVersions follows semver precedence', () => {
  const { compareVersions } = hostModule
  const cases = [
    ['0.2.1-rc.4', '0.2.1-rc.4', 0],
    ['0.2.1-rc.5', '0.2.1-rc.4', 1],
    ['0.2.1-rc.10', '0.2.1-rc.9', 1],
    ['0.2.1', '0.2.1-rc.4', 1],
    ['0.2.1-alpha', '0.2.1-beta', -1],
    ['0.3.0', '0.2.9', 1],
    ['1.0.0', '0.9.9', 1],
    ['v2.0.0', '2.0.0', 0],
    ['1.0.0-rc.99999999999999999999', '1.0.0-rc.99999999999999999998', 1],
  ]
  for (const [left, right, expected] of cases) {
    assert.equal(Math.sign(compareVersions(left, right)), expected, `${left} vs ${right}`)
  }
  assert.throws(() => compareVersions('nope', '1.0.0'), TypeError)
})

// ------------------------------------------------------------- 2. feed parsing

await check('app-update.yml parses and resolves the electron-updater manifest URL', async () => {
  const text = await readFile(APP, 'utf8')
  const feed = hostModule.parseAppUpdateYml(text)
  assert.equal(feed.provider, 'generic')
  assert.equal(feed.channel, 'nightly')
  assert.equal(feed.url, 'https://download.deepseek.com/dsh-desk/feeds/mac-x64/')
  assert.equal(
    hostModule.manifestUrl(feed, 'darwin'),
    'https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly/latest-mac.yml',
  )
  assert.equal(hostModule.manifestUrl({ ...feed, channel: 'latest' }, 'darwin'), 'https://download.deepseek.com/dsh-desk/feeds/mac-x64/latest-mac.yml')
})

await check('parseManifest reads yml and json manifests and resolves download URLs', () => {
  const yml = [
    'version: 0.2.2-rc.1',
    'files:',
    '  - url: Harness-0.2.2-rc.1-mac.zip',
    '    sha512: abc',
    '    size: 123',
    "releaseDate: '2026-11-01T00:00:00.000Z'",
  ].join('\n')
  const parsed = hostModule.parseManifest(yml, 'https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly/latest-mac.yml')
  assert.equal(parsed.version, '0.2.2-rc.1')
  assert.equal(parsed.downloadUrl, 'https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly/Harness-0.2.2-rc.1-mac.zip')

  const json = hostModule.parseManifest('{"version":"1.2.3","url":"https://example.test/a.dmg"}', 'https://example.test/feed.json')
  assert.equal(json.version, '1.2.3')
  assert.equal(json.downloadUrl, 'https://example.test/a.dmg')

  assert.equal(hostModule.parseManifest('not a manifest', 'https://example.test/latest-mac.yml'), null)
  assert.equal(hostModule.parseManifest('{"version":"1.2.3","url":"javascript:alert(1)"}', 'https://example.test/feed.json').downloadUrl, null)
  assert.equal(hostModule.parseManifest('{"version":"1.2.3","url":"data:text/html,x"}', 'https://example.test/feed.json').downloadUrl, null)
})

await check('readInstalledVersion reports the app bundle version (plist and asar fallback)', async () => {
  const executable = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
  const version = await hostModule.readInstalledVersion({ execPath: executable })
  assert.equal(typeof version, 'string')
  assert.notEqual(hostModule.parseVersion(version), null, `not a version: ${version}`)
  const plist = await readFile('/Applications/DeepSeek Harness.app/Contents/Info.plist', 'utf8')
  assert.equal(version, hostModule.parsePlistVersion(plist))

  // Production path: the Desktop main process injects the version into the Host env.
  assert.equal(await hostModule.readInstalledVersion({ env: { DSH_CLIENT_VERSION: '9.9.9' } }), '9.9.9')
  assert.equal(await hostModule.readInstalledVersion({ env: { DSH_CLIENT_VERSION: 'not-a-version' }, execPath: executable }), version)

  // Fallback path: no plist in the bundle layout, so the packaged Host manifest is parsed.
  const fallback = await hostModule.readInstalledVersion({
    execPath: '/nonexistent/Contents/MacOS/DeepSeek Harness',
    resources: '/Applications/DeepSeek Harness.app/Contents/Resources',
  })
  assert.equal(fallback, version)
})

// ------------------------------------------------- 3. authenticated Host route

await check('readInstalledVersion refuses a non-version plist value', async () => {
  const fixture = join(tmpdir(), `dsh-update-check-${process.pid}`)
  await mkdir(join(fixture, 'Fake.app', 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(fixture, 'Fake.app', 'Contents', 'Info.plist'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '<key>CFBundleShortVersionString</key>',
    '<string>1.0 (build 42)</string>',
    '</dict></plist>',
  ].join('\n'))
  const version = await hostModule.readInstalledVersion({
    execPath: join(fixture, 'Fake.app', 'Contents', 'MacOS', 'Fake'),
    resources: join(fixture, 'Resources'),
    env: {},
  })
  assert.equal(version, null, 'an unparseable plist version must fall through, not be returned')
})

await check('host: configured feed keeps its path and rejects unusable urls', async () => {
  const seen = []
  const good = hostModule.createHost({ feedUrl: 'http://127.0.0.1:9/feeds' }, {
    readInstalledVersion: async () => '0.2.1-rc.4',
    fetchText: async (url) => { seen.push(url); return 'version: 0.2.1-rc.4\nfiles:\n  - url: a.zip\n' },
  })
  const okStatus = await good.status()
  assert.equal(seen[0], 'http://127.0.0.1:9/feeds/latest-mac.yml')
  assert.equal(okStatus.error, null)

  const bad = hostModule.createHost({ feedUrl: 'not a url' }, { readInstalledVersion: async () => '0.2.1-rc.4' })
  const badStatus = await bad.status()
  assert.equal(badStatus.ok, false)
  assert.equal(badStatus.error.kind, 'feed-unconfigured')
  assert.equal(badStatus.currentVersion, '0.2.1-rc.4')

  // The same failure through the real route is a 200 with a structured error, never a 500.
  const handler = hostModule.createRouteHandler({ get: () => ({ requestRejection: () => undefined }) }, bad)
  const server = createServer((req, res) => { handler(req, res).catch(() => res.destroy()) })
  const port = await listen(server)
  try {
    const response = await fetch(`http://127.0.0.1:${port}${hostModule.__internals.ROUTE_PREFIX}/status`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).error.kind, 'feed-unconfigured')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

await check('host: a slower stale probe cannot undo an explicit refresh', async () => {
  let calls = 0
  const host = hostModule.createHost({ feedUrl: 'http://127.0.0.1:9/feeds/', cacheSeconds: 3600 }, {
    readInstalledVersion: async () => '0.2.1-rc.4',
    fetchText: async () => {
      calls += 1
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return 'version: 0.2.0\nfiles:\n  - url: a.zip\n'
      }
      return 'version: 0.3.0\nfiles:\n  - url: b.zip\n'
    },
  })
  const slow = host.status()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const fresh = await host.status({ refresh: true })
  assert.equal(fresh.latest.version, '0.3.0')
  await slow
  const cached = await host.status()
  assert.equal(cached.latest.version, '0.3.0', 'the stale probe overwrote the refreshed cache')
})

await check('route: 503 without connection, 401 on rejection, 404 off-path', async () => {
  let connection
  const host = hostModule.createHost({ feedUrl: 'http://127.0.0.1:1/feeds/' }, { readInstalledVersion: async () => '0.2.1-rc.4' })
  const handler = hostModule.createRouteHandler({ get: () => connection }, host)
  const server = createServer((req, res) => { handler(req, res).catch(() => res.destroy()) })
  const port = await listen(server)
  try {
    const base = `http://127.0.0.1:${port}${hostModule.__internals.ROUTE_PREFIX}`
    assert.equal((await fetch(`${base}/status`)).status, 503)
    connection = { requestRejection: () => 401 }
    assert.equal((await fetch(`${base}/status`)).status, 401)
    connection = { requestRejection: () => undefined }
    assert.equal((await fetch(`${base}/nope`)).status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

await check('route: reports available / up-to-date / unreachable against a local feed', async () => {
  let feedVersion = '0.2.2-rc.1'
  let feedStatus = 200
  const feedServer = createServer((_req, res) => {
    if (feedStatus !== 200) {
      res.writeHead(feedStatus, { 'content-type': 'text/plain' })
      res.end('nope')
      return
    }
    res.writeHead(200, { 'content-type': 'text/yaml' })
    res.end([
      `version: ${feedVersion}`,
      'files:',
      '  - url: Harness-mac.zip',
      '    sha512: x',
      '    size: 1',
    ].join('\n'))
  })
  const feedPort = await listen(feedServer)
  const host = hostModule.createHost(
    { feedUrl: `http://127.0.0.1:${feedPort}/feeds/`, cacheSeconds: 3600 },
    { readInstalledVersion: async () => '0.2.1-rc.4' },
  )
  const handler = hostModule.createRouteHandler({ get: () => ({ requestRejection: () => undefined }) }, host)
  const server = createServer((req, res) => { handler(req, res).catch(() => res.destroy()) })
  const port = await listen(server)
  const base = `http://127.0.0.1:${port}${hostModule.__internals.ROUTE_PREFIX}`
  try {
    const first = await (await fetch(`${base}/status`)).json()
    assert.equal(first.ok, true)
    assert.equal(first.currentVersion, '0.2.1-rc.4')
    assert.equal(first.latest.version, '0.2.2-rc.1')
    assert.equal(first.updateAvailable, true)
    assert.equal(first.feed.source, 'config')
    assert.equal(first.feed.manifestUrl, `http://127.0.0.1:${feedPort}/feeds/latest-mac.yml`)
    assert.equal(first.latest.downloadUrl, `http://127.0.0.1:${feedPort}/feeds/Harness-mac.zip`)

    // Cached: a new feed version is not visible until refresh, and POST /check forces it.
    feedVersion = '0.3.0'
    const cached = await (await fetch(`${base}/status`)).json()
    assert.equal(cached.latest.version, '0.2.2-rc.1')
    const refreshed = await (await fetch(`${base}/status?refresh=1`)).json()
    assert.equal(refreshed.latest.version, '0.3.0')
    feedVersion = '0.4.0'
    const posted = await (await fetch(`${base}/check`, { method: 'POST' })).json()
    assert.equal(posted.latest.version, '0.4.0')

    // Same version as installed → no update.
    feedVersion = '0.2.1-rc.4'
    const current = await (await fetch(`${base}/status?refresh=1`)).json()
    assert.equal(current.updateAvailable, false)
    assert.equal(current.error, null)

    // Unreachable feed → structured failure, never a 500.
    feedStatus = 404
    const failed = await fetch(`${base}/status?refresh=1`)
    assert.equal(failed.status, 200)
    const failure = await failed.json()
    assert.equal(failure.ok, false)
    assert.equal(failure.error.kind, 'feed-unreachable')
    assert.equal(failure.currentVersion, '0.2.1-rc.4')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => feedServer.close(resolve))
  }
})

// ---------------------------------------------------------------- 4. web half

function createReactShim() {
  const cells = []
  const effects = []
  let index = 0
  let render = () => {}
  const api = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      const slot = index++
      if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial
      return [cells[slot], (next) => {
        cells[slot] = typeof next === 'function' ? next(cells[slot]) : next
        render()
      }]
    },
    useEffect(effect) {
      const slot = index++
      if (typeof effects[slot] !== 'function') effects[slot] = effect
    },
  }
  return { api, reset: () => { index = 0 }, setRender: (fn) => { render = fn }, effects }
}

function collectText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object') collectText(node.props?.children, out)
  return out
}

function findBy(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findBy(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findBy(node.props?.children, predicate, out)
  return out
}

async function loadClient({ nativeBridge, payload, fetchUrls }) {
  const source = await readFile(join(ROOT, 'client.js'), 'utf8')
  const registrations = []
  const loadCalls = []
  const shim = createReactShim()
  const window = {
    __ModuleLoader__: { load: (registration) => loadCalls.push(registration) },
    dshDesktop: nativeBridge,
    open: (url) => { fetchUrls.opened.push(url) },
  }
  const sandbox = {
    window,
    document: { createElement: () => ({ dataset: {} }), head: { appendChild() {} } },
    fetch: async (url) => {
      fetchUrls.urls.push(url)
      return { ok: true, status: 200, json: async () => payload }
    },
    console,
    URL,
    setTimeout,
    clearTimeout,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(loadCalls.length, 1, 'client.js must register exactly one module')
  const registration = loadCalls[0]
  assert.equal(registration.id, 'dsh-update-check')

  const module = registration.factory((specifier) => {
    if (specifier === 'react') return shim.api
    throw new Error(`unexpected require: ${specifier}`)
  })
  const dictionaries = {}
  const ctx = {
    effect: (fn) => fn(),
    locale: {
      register: (_ns, dicts) => { Object.assign(dictionaries, dicts) },
      bind: () => (key, vars) => {
        const raw = dictionaries.zh?.[key] ?? key
        return vars === undefined ? raw : raw.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ''))
      },
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  }
  module.apply(ctx)

  return {
    module,
    registrations,
    shim,
    window,
    fetchUrls,
    t: ctx.locale.bind(),
    page: registrations.find((entry) => entry.options.name === 'main').component,
  }
}

function mountPage(loaded, props) {
  const { shim, page } = loaded
  let tree
  const render = () => {
    shim.reset()
    tree = page(props)
    return tree
  }
  shim.setRender(render)
  render()
  const runEffects = () => {
    for (const effect of shim.effects) if (typeof effect === 'function') effect()
  }
  return { render, runEffects, tree: () => tree }
}

const AVAILABLE = {
  ok: true,
  checkedAt: '2026-11-10T09:00:00.000Z',
  currentVersion: '0.2.1-rc.4',
  feed: {
    baseUrl: 'https://download.deepseek.com/dsh-desk/feeds/mac-x64/',
    channel: 'nightly',
    source: 'app-update.yml',
    manifestUrl: 'https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly/latest-mac.yml',
  },
  latest: { version: '0.2.2-rc.1', downloadUrl: 'https://download.deepseek.com/x.zip', releaseDate: null, notes: null },
  updateAvailable: true,
  error: null,
}

const UP_TO_DATE = { ...AVAILABLE, updateAvailable: false, latest: { ...AVAILABLE.latest, version: '0.2.1-rc.4' } }

function nativeBridge(calls) {
  return {
    updates: {
      status: async () => ({ phase: 'idle' }),
      open: async () => { calls.open += 1 },
      subscribe: () => () => {},
    },
  }
}

await check('client: registers the sidebar entry and the main panel into the real slots', async () => {
  const loaded = await loadClient({ nativeBridge: nativeBridge({ open: 0 }), payload: UP_TO_DATE, fetchUrls: { urls: [], opened: [] } })
  assert.deepEqual([...loaded.module.inject], ['slots', 'locale'])
  assert.equal(loaded.registrations.length, 2)
  const panel = loaded.registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = loaded.registrations.find((entry) => entry.options.name === 'main')
  assert.equal(panel.options.id, 'dsh-update-check')
  assert.equal(panel.options.order, 60)
  assert.equal(typeof panel.options.label, 'function')
  assert.equal(panel.options.label(), '版本更新')
  assert.equal(main.options.key, 'dsh-update-check')
  // The renderer injects the `t` prop only for entries that declare `locale`.
  assert.equal(main.options.locale, 'dsh-update-check')
  assert.equal(typeof main.component, 'function')
})

await check('client: state mapping and action resolution', async () => {
  const loaded = await loadClient({ nativeBridge: nativeBridge({ open: 0 }), payload: UP_TO_DATE, fetchUrls: { urls: [], opened: [] } })
  const { describeStatus, resolveAction } = loaded.module.__test
  const ready = (value) => ({ kind: 'ready', value })

  assert.equal(describeStatus({ kind: 'loading' }, null).title, 'loading')
  assert.equal(describeStatus(ready(AVAILABLE), null).title, 'available')
  assert.equal(describeStatus(ready(UP_TO_DATE), null).title, 'upToDate')
  assert.equal(describeStatus({ kind: 'error', message: 'boom' }, null).detail, 'boom')
  assert.equal(describeStatus(ready({ ...AVAILABLE, ok: false, error: { kind: 'feed-timeout', message: 'slow' } }), null).title, 'feedUnreachable')

  const updater = nativeBridge({ open: 0 })
  assert.equal(resolveAction(ready(AVAILABLE), updater).kind, 'native')
  assert.equal(resolveAction(ready(AVAILABLE), null).kind, 'download')
  assert.equal(resolveAction(ready({ ...AVAILABLE, feed: { ...AVAILABLE.feed, source: 'config' } }), updater).kind, 'download')
  assert.equal(resolveAction(ready(UP_TO_DATE), updater).kind, 'none')
})

await check('client: available version renders and one click hands off to the native updater', async () => {
  const calls = { open: 0 }
  const fetchUrls = { urls: [], opened: [] }
  const loaded = await loadClient({ nativeBridge: nativeBridge(calls), payload: AVAILABLE, fetchUrls })
  const view = mountPage(loaded, { t: loaded.t })
  view.runEffects()
  await new Promise((resolve) => setTimeout(resolve, 0))
  view.render()

  const text = collectText(view.tree()).join(' | ')
  assert.match(text, /版本更新/)
  assert.match(text, /当前版本/)
  assert.match(text, /v0\.2\.1-rc\.4/)
  assert.match(text, /最新版本/)
  assert.match(text, /发现新版本 v0\.2\.2-rc\.1/)
  assert.ok(fetchUrls.urls.some((url) => url === '/api/dsh-update-check/status'), 'panel must read the host route')

  const primary = findBy(view.tree(), (node) => node.props?.['data-kind'] === 'primary')
  assert.equal(primary.length, 1, 'exactly one primary action')
  assert.equal(collectText(primary[0]).join(''), '立即更新')
  assert.equal(primary[0].props.disabled, false)
  primary[0].props.onClick()
  primary[0].props.onClick()
  assert.equal(calls.open, 1, 'one click must call window.dshDesktop.updates.open(), a double click must not repeat it')
})

await check('client: refresh button asks the host for a fresh check', async () => {
  const fetchUrls = { urls: [], opened: [] }
  const loaded = await loadClient({ nativeBridge: nativeBridge({ open: 0 }), payload: UP_TO_DATE, fetchUrls })
  const view = mountPage(loaded, { t: loaded.t })
  view.runEffects()
  await new Promise((resolve) => setTimeout(resolve, 0))
  view.render()
  const refresh = findBy(view.tree(), (node) => node.type === 'button' && node.props?.['data-kind'] !== 'primary')
  assert.equal(refresh.length, 1)
  refresh[0].props.onClick()
  assert.ok(fetchUrls.urls.includes('/api/dsh-update-check/status?refresh=1'))
})

await check('client: every native phase and every failure payload renders without throwing', async () => {
  const phases = ['idle', 'available', 'downloading', 'verifying', 'ready', 'installing', 'error']
  for (const phase of phases) {
    const bridge = {
      updates: {
        status: async () => ({
          phase,
          percent: phase === 'downloading' ? 42 : undefined,
          version: phase === 'available' || phase === 'ready' ? '0.2.2-rc.1' : undefined,
        }),
        open: async () => {},
        subscribe: () => () => {},
      },
    }
    const loaded = await loadClient({ nativeBridge: bridge, payload: AVAILABLE, fetchUrls: { urls: [], opened: [] } })
    const view = mountPage(loaded, { t: loaded.t })
    view.runEffects()
    await new Promise((resolve) => setTimeout(resolve, 0))
    view.render()
    const rendered = collectText(view.tree()).join(' | ')
    assert.ok(rendered.length > 0, `phase ${phase} rendered nothing`)
    if (phase === 'error') {
      assert.doesNotMatch(rendered, /已是最新版本|You are on the latest/, 'a failed updater must not claim the build is current')
      assert.match(rendered, /更新器失败/, 'a failed updater must say so')
    }
    if (phase === 'available') {
      assert.match(rendered, /发现新版本 v0\.2\.2-rc\.1/, 'the native target version must be shown')
    }
    const primary = findBy(view.tree(), (node) => node.props?.['data-kind'] === 'primary')
    for (const button of primary) {
      assert.equal(button.props.disabled, phase === 'downloading' || phase === 'installing', `phase ${phase} button state`)
    }
  }

  const failures = [
    { kind: 'feed-unreachable', message: 'feed responded 404' },
    { kind: 'feed-timeout', message: 'no answer' },
    { kind: 'manifest-invalid', message: 'no version' },
    { kind: 'version-unknown', message: 'unknown build' },
    { kind: 'feed-unconfigured', message: 'no url' },
  ]
  for (const error of failures) {
    const payload = { ...AVAILABLE, ok: false, latest: null, updateAvailable: false, error }
    const loaded = await loadClient({ nativeBridge: nativeBridge({ open: 0 }), payload, fetchUrls: { urls: [], opened: [] } })
    const view = mountPage(loaded, { t: loaded.t })
    view.runEffects()
    await new Promise((resolve) => setTimeout(resolve, 0))
    view.render()
    const text = collectText(view.tree()).join(' | ')
    assert.match(text, /检查更新失败|更新源/, `${error.kind} produced no failure copy`)
    assert.equal(findBy(view.tree(), (node) => node.props?.['data-kind'] === 'primary').length, 0, `${error.kind} must not offer a primary action`)
  }
})

await check('client: a bridge without subscribe degrades to the download path instead of throwing', async () => {
  const partial = { updates: { status: async () => ({ phase: 'idle' }), open: async () => {} } }
  const fetchUrls = { urls: [], opened: [] }
  const loaded = await loadClient({ nativeBridge: partial, payload: AVAILABLE, fetchUrls })
  const view = mountPage(loaded, { t: loaded.t })
  assert.doesNotThrow(() => view.runEffects())
  await new Promise((resolve) => setTimeout(resolve, 0))
  view.render()
  const primary = findBy(view.tree(), (node) => node.props?.['data-kind'] === 'primary')
  assert.equal(collectText(primary[0]).join(''), '下载安装包')
})

await check('client: outside the Desktop app it says so and offers a download instead', async () => {
  const fetchUrls = { urls: [], opened: [] }
  const loaded = await loadClient({ nativeBridge: undefined, payload: AVAILABLE, fetchUrls })
  const view = mountPage(loaded, { t: loaded.t })
  view.runEffects()
  await new Promise((resolve) => setTimeout(resolve, 0))
  view.render()
  const text = collectText(view.tree()).join(' | ')
  assert.match(text, /不在桌面应用内/)
  const primary = findBy(view.tree(), (node) => node.props?.['data-kind'] === 'primary')
  assert.equal(collectText(primary[0]).join(''), '下载安装包')
  primary[0].props.onClick()
  assert.deepEqual(fetchUrls.opened, ['https://download.deepseek.com/x.zip'])
})

// ---------------------------------------------------------------------- report

const failed = results.filter((entry) => !entry.ok)
for (const entry of results) {
  const mark = entry.ok ? 'PASS' : 'FAIL'
  console.log(`${mark} ${entry.name}`)
  if (!entry.ok) console.log(`     ${entry.error?.stack ?? entry.error}`)
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
