// dsh-plugins 插件版本自查（规范实现）。
//
// 所有插件共用同一份实现：scripts/sync-version-check.mjs 把它复制到
// plugins/<name>/version-check.js。改这里之后跑一次同步，不要单独改副本。
//
// 逻辑（对齐 dsh-context 的版本升级提示）：
//   已装版本 = 本插件 package.json 的 version
//   最新版本 = 本仓 index.json 里该插件 versions 的最高版本（GitHub raw，失败回退 jsDelivr）
//   比较     = semver（支持 -rc.N / -beta.N / -alpha.N 预发布；本地版本领先不报更新）
// 结果缓存 1 小时；网络失败保留上一次结果并标记 failed，不向客户端抛 500。

import { readFile } from 'node:fs/promises'

export const DEFAULT_INDEX_URLS = [
  'https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json',
  'https://cdn.jsdelivr.net/gh/Feahter/dsh-plugins@main/index.json',
]
export const DEFAULT_TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8_000
const RANK = { alpha: 1, beta: 2, rc: 3, stable: 4 }

/** 解析 v1.2.3 / 1.2.3-rc.4 / 1.2.3-beta.2 / 1.2.3-alpha.1；无法解析返回 null。 */
export function parseSemver(text) {
  if (typeof text !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?(?:\+[0-9a-z.-]+)?$/i.exec(text.trim())
  if (!match) return null
  const label = match[4] ? match[4].toLowerCase() : 'stable'
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rank: RANK[label],
    serial: match[5] ? Number(match[5]) : 0,
  }
}

/** semver 优先级比较：a>b 返回正数，相等返回 0，a<b 返回负数；无法解析返回 null。 */
export function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (left === null || right === null) return null
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.rank !== right.rank) return left.rank - right.rank
  return left.serial - right.serial
}

/** candidate 是否比 current 新；任一无法解析都返回 false（宁可漏报，不误报）。 */
export function isNewer(candidate, current) {
  const order = compareSemver(candidate, current)
  return order !== null && order > 0
}

/** index.json 里该插件的最新版本与主页；找不到返回 null。 */
export function pickIndexEntry(index, pluginName) {
  if (!index || !Array.isArray(index.plugins)) return null
  const entry = index.plugins.find((item) => item && item.name === pluginName)
  if (!entry) return null
  const versions = Array.isArray(entry.versions) ? entry.versions : []
  let latest = null
  for (const item of versions) {
    const version = item && typeof item.version === 'string' ? item.version : null
    if (version === null) continue
    if (latest === null || isNewer(version, latest)) latest = version
  }
  const homepage = typeof entry.homepage === 'string' ? entry.homepage : null
  return { latest, homepage }
}

async function fetchIndex(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`index fetch ${response.status}`)
  return response.json()
}

/**
 * createVersionChecker({ pluginName, packageUrl?, indexUrls?, fetchImpl?, ttlMs?, now? })
 *   .check({ refresh? }) → { plugin, current, latest, updateAvailable, homepage, failed, checkedAt }
 *   .clearCache() / .currentVersion()
 */
export function createVersionChecker(options = {}) {
  const {
    pluginName,
    packageUrl = new URL('./package.json', import.meta.url),
    indexUrls = DEFAULT_INDEX_URLS,
    fetchImpl = (url, init) => fetch(url, init),
    ttlMs = DEFAULT_TTL_MS,
    now = () => Date.now(),
  } = options
  if (typeof pluginName !== 'string' || pluginName === '') {
    throw new Error('createVersionChecker: pluginName is required')
  }

  let currentPromise = null
  let indexCache = { value: null, entry: null, at: 0, failed: false }
  let inflight = null

  async function currentVersion() {
    if (currentPromise === null) {
      currentPromise = readFile(packageUrl, 'utf8')
        .then((text) => JSON.parse(text))
        .then((pkg) => (typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : null))
        .catch(() => null)
    }
    return currentPromise
  }

  function ensureLatest(refresh) {
    const age = now() - indexCache.at
    if (!refresh && indexCache.at !== 0 && age < ttlMs) return
    if (inflight !== null) return
    inflight = (async () => {
      let reachable = false
      for (const url of indexUrls) {
        try {
          const index = await fetchIndex(url, fetchImpl)
          reachable = true
          const entry = pickIndexEntry(index, pluginName)
          if (entry !== null) {
            indexCache = { value: entry.latest, entry, at: now(), failed: false }
            return
          }
        } catch {
          /* 换下一个源 */
        }
      }
      // 索引取到了但没这个插件 ≠ 网络失败：latest 留空、不标 failed。
      indexCache = reachable
        ? { value: null, entry: null, at: now(), failed: false }
        : { ...indexCache, at: now(), failed: true }
    })().finally(() => {
      inflight = null
    })
  }

  return {
    pluginName,
    currentVersion,
    clearCache() {
      indexCache = { value: null, entry: null, at: 0, failed: false }
      inflight = null
    },
    async check({ refresh = false } = {}) {
      ensureLatest(refresh)
      if (inflight !== null) await inflight.catch(() => {})
      const current = await currentVersion()
      const latest = indexCache.value
      return {
        plugin: pluginName,
        current,
        latest: latest === null ? null : latest,
        updateAvailable: latest !== null && current !== null ? isNewer(latest, current) : null,
        homepage: indexCache.entry?.homepage ?? null,
        failed: indexCache.failed,
        checkedAt: indexCache.at,
      }
    },
  }
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * webServer.register({ kind: 'exact', path, handler }) 用的处理器。
 * getConnection 返回 Harness connection 服务（用于同源鉴权）。
 */
export function createVersionRoute({ checker, getConnection }) {
  return async function versionRoute(req, res) {
    const method = req.method === 'HEAD' ? 'GET' : (req.method || 'GET')
    if (method !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: `Method not allowed: ${method}` } })
      return
    }
    const connection = typeof getConnection === 'function' ? getConnection() : getConnection
    if (connection && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection({ headers: req.headers || {} })
      if (rejection) {
        sendJson(res, rejection, { ok: false, error: { code: 'unauthorized', message: 'Unauthorized' } })
        return
      }
    }
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const refresh = ['1', 'true', 'yes'].includes(url.searchParams.get('refresh') || '')
      const data = await checker.check({ refresh })
      sendJson(res, 200, { ok: true, data })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: { code: 'internal', message: String(error?.message ?? error) } })
    }
  }
}
