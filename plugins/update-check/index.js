/**
 * dsh-update-check — Host half.
 *
 * Answers two questions for the Web GUI:
 *   1. which DSH Desktop release is installed right now (`currentVersion`);
 *   2. what the electron-updater feed advertises (`latest.version`, download URL).
 *
 * The feed is the same one the Desktop main process uses (`Resources/app-update.yml`),
 * so a "new version" reported here is the release its native updater would install.
 * The GUI's one-click button then hands off to that native updater
 * (`window.dshDesktop.updates.open()`), which owns download, verification and restart.
 *
 * The route is same-origin only and re-applies Connection's admission check.
 */
import { open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const name = 'dsh-update-check'
export const inject = ['webServer']

const ROUTE_PREFIX = '/api/dsh-update-check'
const FEED_FILE = 'app-update.yml'
const DEFAULT_CACHE_SECONDS = 60
const MAX_CACHE_SECONDS = 86_400
const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = 'dsh-update-check'

// ---------------------------------------------------------------- version math

/** Parse `1.2.3`, `1.2.3-rc.4`, `v1.2.3+build` into comparable parts. */
export function parseVersion(input) {
  if (typeof input !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    if (left.length !== right.length) return left.length < right.length ? -1 : 1
    return left === right ? 0 : left < right ? -1 : 1
  }
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left === right ? 0 : left < right ? -1 : 1
}

/** Semantic-version precedence: negative when `left < right`, 0 when equal. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) throw new TypeError(`compareVersions: not a version: ${a === null ? left : right}`)
  for (let index = 0; index < 3; index += 1) {
    const delta = a.core[index] - b.core[index]
    if (delta !== 0) return Math.sign(delta)
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const leftPart = a.pre[index]
    const rightPart = b.pre[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const delta = compareIdentifier(leftPart, rightPart)
    if (delta !== 0) return delta
  }
  return 0
}

// ------------------------------------------------------------- app version read

/** macOS `.app` bundle root for an executable inside `Contents/MacOS`. */
export function appBundleRoot(execPath) {
  return dirname(dirname(dirname(execPath)))
}

/** `CFBundleShortVersionString` out of a plist document. */
export function parsePlistVersion(text) {
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text)
  return match === null ? null : match[1].trim()
}

/**
 * Read one entry out of an asar archive without Electron's patched fs.
 * Used only as a fallback when the bundle plist is unavailable.
 */
export async function readAsarEntry(asarPath, entryPath) {
  const handle = await open(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    await handle.read(head, 0, 16, 0)
    const headerLength = head.readUInt32LE(12)
    const header = Buffer.alloc(headerLength)
    await handle.read(header, 0, headerLength, 16)
    const dataBase = 16 + Math.ceil(headerLength / 4) * 4
    const index = JSON.parse(header.toString('utf8'))
    let node = index
    for (const part of entryPath.split('/').filter(Boolean)) {
      node = node?.files?.[part]
      if (node === undefined) return null
    }
    if (node.offset === undefined || node.size === undefined) return null
    const size = Number(node.size)
    const body = Buffer.alloc(size)
    await handle.read(body, 0, size, dataBase + Number(node.offset))
    return body.toString('utf8')
  } finally {
    await handle.close()
  }
}

/**
 * Version of the running Desktop app, or null when it cannot be established.
 *
 * The Desktop main process injects `DSH_CLIENT_VERSION` into the Host child
 * (`lib/main.js`, `desktopClientVersion()`), so in production this is a plain
 * environment read. The bundle plist and the packaged manifest are fallbacks for
 * a Host started some other way.
 */
export async function readInstalledVersion(options = {}) {
  const env = options.env ?? process.env
  const injected = env?.DSH_CLIENT_VERSION
  if (typeof injected === 'string' && parseVersion(injected) !== null) return injected.trim()
  const execPath = options.execPath ?? process.execPath
  const bundle = appBundleRoot(execPath)
  const resources = options.resources ?? join(bundle, 'Contents', 'Resources')
  const plist = join(bundle, 'Contents', 'Info.plist')
  try {
    const version = parsePlistVersion(await readFile(plist, 'utf8'))
    if (version !== null && parseVersion(version) !== null) return version.trim()
  } catch {
    // Not a macOS bundle layout: fall through to the packaged Host manifest.
  }
  for (const entry of ['dsh/desktop-runtime.json', 'dsh/package.json']) {
    try {
      const text = await readAsarEntry(join(resources, 'app.asar'), entry)
      if (text === null) continue
      const parsed = JSON.parse(text)
      const version = entry.endsWith('desktop-runtime.json') ? parsed?.release?.version : parsed?.version
      if (typeof version === 'string' && parseVersion(version) !== null) return version
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

// --------------------------------------------------------------- update feed

/** Minimal `app-update.yml` read: `provider`, `url`, `channel`. */
export function parseAppUpdateYml(text) {
  const pick = (key) => {
    const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(text)
    if (match === null) return null
    return match[1].trim().replace(/^["']|["']$/g, '')
  }
  const url = pick('url')
  if (url === null) return null
  return {
    provider: pick('provider') ?? 'generic',
    url: url.endsWith('/') ? url : `${url}/`,
    channel: pick('channel') ?? 'latest',
  }
}

/** electron-updater's generic feed path for this platform. */
export function manifestFileName(platform = process.platform) {
  if (platform === 'win32') return 'latest.yml'
  if (platform === 'darwin') return 'latest-mac.yml'
  return 'latest-linux.yml'
}

/** Absolute manifest URL for a feed, mirroring electron-updater's channel directory. */
export function manifestUrl(feed, platform = process.platform) {
  const directory = feed.channel === 'latest' ? '' : `${feed.channel}/`
  return new URL(`${directory}${manifestFileName(platform)}`, feed.url).toString()
}

/**
 * Parse a feed manifest. `latest-mac.yml` / an override JSON both describe one
 * release; the download link is resolved against the manifest URL the same way
 * electron-updater resolves it.
 */
export function parseManifest(text, baseUrl) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    let json
    try {
      json = JSON.parse(trimmed)
    } catch {
      return null
    }
    const version = typeof json?.version === 'string' ? json.version.trim() : null
    if (version === null || parseVersion(version) === null) return null
    const link = typeof json.url === 'string' ? json.url : typeof json.downloadUrl === 'string' ? json.downloadUrl : null
    return {
      version,
      downloadUrl: link === null ? null : resolveUrl(link, baseUrl),
      releaseDate: typeof json.releaseDate === 'string' ? json.releaseDate : null,
      notes: typeof json.notes === 'string' ? json.notes : null,
    }
  }
  const versionMatch = /^version:[ \t]*["']?([^"'\r\n]+)["']?[ \t]*$/m.exec(trimmed)
  if (versionMatch === null) return null
  const version = versionMatch[1].trim()
  if (parseVersion(version) === null) return null
  const fileMatch = /^[ \t]*-?[ \t]*url:[ \t]*["']?([^"'\r\n]+)["']?[ \t]*$/m.exec(trimmed)
  const releaseMatch = /^releaseDate:[ \t]*["']?([^"'\r\n]+)["']?[ \t]*$/m.exec(trimmed)
  return {
    version,
    downloadUrl: fileMatch === null ? null : resolveUrl(fileMatch[1].trim(), baseUrl),
    releaseDate: releaseMatch === null ? null : releaseMatch[1].trim(),
    notes: null,
  }
}

function resolveUrl(candidate, baseUrl) {
  try {
    const url = new URL(candidate, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

async function fetchText(url, signal) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal,
    headers: { 'user-agent': USER_AGENT, accept: 'application/yaml, application/json, text/plain, */*' },
  })
  if (!response.ok) throw new Error(`feed responded ${response.status} ${response.statusText}`.trim())
  return await response.text()
}

// ------------------------------------------------------------------- the host

function clampSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CACHE_SECONDS
  return Math.min(MAX_CACHE_SECONDS, Math.max(0, Math.floor(value)))
}

function normalizeConfig(config) {
  const rawFeed = typeof config?.feedUrl === 'string' && config.feedUrl.trim() !== '' ? config.feedUrl.trim() : null
  const feedUrl = rawFeed === null || rawFeed.endsWith('/') ? rawFeed : `${rawFeed}/`
  const channel = typeof config?.channel === 'string' && config.channel.trim() !== '' ? config.channel.trim() : null
  return {
    feedUrl,
    channel,
    cacheSeconds: clampSeconds(config?.cacheSeconds),
    platform: typeof config?.platform === 'string' ? config.platform : process.platform,
  }
}

export function createHost(config = {}, deps = {}) {
  const settings = normalizeConfig(config)
  const readVersion = deps.readInstalledVersion ?? readInstalledVersion
  const readFeedFile = deps.readAppUpdateFile
    ?? (async () => {
      const resources = join(appBundleRoot(process.execPath), 'Contents', 'Resources')
      return await readFile(join(resources, FEED_FILE), 'utf8')
    })
  const getText = deps.fetchText ?? fetchText
  const now = deps.now ?? (() => Date.now())

  let cached = null
  let inflight = null
  let generation = 0
  let installedVersion

  async function resolveFeed() {
    if (settings.feedUrl !== null) {
      return {
        baseUrl: settings.feedUrl,
        channel: settings.channel ?? 'latest',
        source: 'config',
      }
    }
    const text = await readFeedFile()
    const parsed = parseAppUpdateYml(text)
    if (parsed === null) throw Object.assign(new Error(`${FEED_FILE} carries no update url`), { kind: 'feed-unconfigured' })
    return {
      baseUrl: parsed.url,
      channel: settings.channel ?? parsed.channel,
      source: 'app-update.yml',
    }
  }

  async function probe() {
    const version = await readVersion()
    installedVersion = version
    if (version === null) {
      return {
        ok: false,
        checkedAt: new Date(now()).toISOString(),
        currentVersion: null,
        feed: null,
        latest: null,
        updateAvailable: false,
        error: { kind: 'version-unknown', message: 'Cannot determine the installed Desktop version.' },
      }
    }
    let feed
    try {
      feed = await resolveFeed()
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date(now()).toISOString(),
        currentVersion: version,
        feed: null,
        latest: null,
        updateAvailable: false,
        error: { kind: error.kind ?? 'feed-unconfigured', message: error.message },
      }
    }
    let url
    try {
      url = manifestUrl({ url: feed.baseUrl, channel: feed.channel }, settings.platform)
    } catch {
      return {
        ok: false,
        checkedAt: new Date(now()).toISOString(),
        currentVersion: version,
        feed: { ...feed, manifestUrl: null },
        latest: null,
        updateAvailable: false,
        error: { kind: 'feed-unconfigured', message: `Invalid update feed url: ${feed.baseUrl}` },
      }
    }
    try {
      const text = await getText(url, AbortSignal.timeout(FETCH_TIMEOUT_MS))
      const latest = parseManifest(text, url)
      if (latest === null) {
        return {
          ok: false,
          checkedAt: new Date(now()).toISOString(),
          currentVersion: version,
          feed: { ...feed, manifestUrl: url },
          latest: null,
          updateAvailable: false,
          error: { kind: 'manifest-invalid', message: `No usable version in ${url}` },
        }
      }
      return {
        ok: true,
        checkedAt: new Date(now()).toISOString(),
        currentVersion: version,
        feed: { ...feed, manifestUrl: url },
        latest,
        updateAvailable: compareVersions(latest.version, version) > 0,
        error: null,
      }
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      return {
        ok: false,
        checkedAt: new Date(now()).toISOString(),
        currentVersion: version,
        feed: { ...feed, manifestUrl: url },
        latest: null,
        updateAvailable: false,
        error: {
          kind: timedOut ? 'feed-timeout' : 'feed-unreachable',
          message: timedOut ? `No answer from ${url} within ${FETCH_TIMEOUT_MS}ms` : String(error?.message ?? error),
        },
      }
    }
  }

  return {
    config: settings,
    get installedVersion() {
      return installedVersion
    },
    /** Cached status; `refresh` bypasses the cache. Never rejects. */
    async status({ refresh = false } = {}) {
      const ttl = settings.cacheSeconds * 1000
      if (!refresh && cached !== null && now() - cached.at < ttl) return cached.value
      if (inflight !== null && !refresh) return await inflight
      const started = ++generation
      const operation = probe().then((value) => {
        if (started === generation) cached = { at: now(), value }
        return value
      })
      inflight = operation
      const settle = () => { if (inflight === operation) inflight = null }
      operation.then(settle, settle)
      return await operation
    },
    clearCache() {
      cached = null
    },
  }
}

// -------------------------------------------------------------------- routing

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Build the raw `WebRoute` handler. Exported for the standalone verifier, which
 * drives it through a real HTTP server.
 */
export function createRouteHandler(ctx, host) {
  return async function handle(req, res, { bodyText = '' } = {}) {
    const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
    if (!connection || typeof connection.requestRejection !== 'function') {
      send(res, 503, { ok: false, error: { kind: 'unavailable', message: 'The Harness connection service is missing.' } })
      return
    }
    const rejection = connection.requestRejection({ headers: req.headers ?? {} })
    if (rejection) {
      send(res, rejection, { ok: false, error: { kind: 'unauthorized', message: 'Unauthorized' } })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== ROUTE_PREFIX && !url.pathname.startsWith(`${ROUTE_PREFIX}/`)) {
      send(res, 404, { ok: false, error: { kind: 'not-found', message: 'Not found' } })
      return
    }
    const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    const method = req.method === 'HEAD' ? 'GET' : req.method ?? 'GET'
    try {
      if (method === 'GET' && route === '/status') {
        const refresh = ['1', 'true', 'yes'].includes(url.searchParams.get('refresh') ?? '')
        send(res, 200, await host.status({ refresh }))
        return
      }
      if (method === 'POST' && route === '/check') {
        host.clearCache()
        send(res, 200, await host.status({ refresh: true }))
        return
      }
      if (method === 'GET' || method === 'POST') {
        send(res, 404, { ok: false, error: { kind: 'not-found', message: `Unknown route: ${method} ${route}` } })
        return
      }
      send(res, 405, { ok: false, error: { kind: 'method-not-allowed', message: `Method not allowed: ${method}` } })
    } catch (error) {
      send(res, 500, { ok: false, error: { kind: 'internal', message: String(error?.message ?? error) } })
    }
  }
}

export function apply(ctx, config = {}) {
  const host = createHost(config)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: createRouteHandler(ctx, host),
  }))
}

/** Verification seams (pure or dependency-injected). */
export const __internals = Object.freeze({
  ROUTE_PREFIX,
  parseVersion,
  compareVersions,
  parsePlistVersion,
  parseAppUpdateYml,
  manifestUrl,
  manifestFileName,
  parseManifest,
  normalizeConfig,
  createHost,
  createRouteHandler,
  readAsarEntry,
  readInstalledVersion,
})
