/**
 * 磁盘存储层：projects / artifacts / runs / exports / trash。
 * 所有写操作按项目串行（内部 promise 队列），单文件原子写（tmp + rename）。
 */

import { promises as fsp } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ForgeError } from './errors.js'
import { safeKey } from './text.js'

export const LIMITS = Object.freeze({
  artifact: 8 * 1024 * 1024,
  project: 4 * 1024 * 1024,
  run: 8 * 1024 * 1024,
  runLog: 4 * 1024 * 1024,
  versionsKept: 3,
})

const ID_RE = /^[A-Za-z0-9_-]+$/
const KIND_RE = /^[a-z0-9]+$/

function safeId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 120 || !ID_RE.test(id)) {
    throw new ForgeError('BAD_PARAMS', `非法 id：${String(id)}`, { id })
  }
  return id
}

function flatKey(key) {
  return key.replace(/\//g, '__')
}

function isoNow() {
  return new Date().toISOString()
}

function byteLength(data) {
  return Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data), 'utf8')
}

function parseJson(raw, label, detail) {
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new ForgeError('ARTIFACT_CORRUPT', `${label} 不是合法 JSON`, {
      ...detail,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}

async function exists(path) {
  try {
    await fsp.access(path)
    return true
  } catch {
    return false
  }
}

export class Store {
  constructor(root) {
    if (typeof root !== 'string' || root.length === 0) throw new TypeError('Store 需要 root 路径')
    this.root = root
    this.projectsDir = join(root, 'projects')
    this.trashDir = join(root, 'trash')
    /** @type {Map<string, Promise<unknown>>} */
    this.queues = new Map()
    this.ensured = null
  }

  /** 建根目录；可反复调用。 */
  ensure() {
    if (!this.ensured) {
      this.ensured = (async () => {
        await fsp.mkdir(this.projectsDir, { recursive: true })
        await fsp.mkdir(this.trashDir, { recursive: true })
      })()
      this.ensured.catch(() => {
        this.ensured = null
      })
    }
    return this.ensured
  }

  /**
   * 同一把锁内的任务串行执行；前一个失败不阻塞后一个。
   * @template T
   * @param {string} lockKey
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async withLock(lockKey, fn) {
    const prev = this.queues.get(lockKey) || Promise.resolve()
    const next = prev.catch(() => {}).then(fn)
    this.queues.set(lockKey, next)
    try {
      return await next
    } finally {
      if (this.queues.get(lockKey) === next) this.queues.delete(lockKey)
    }
  }

  projectDir(projectId) {
    return join(this.projectsDir, safeId(projectId))
  }

  projectFile(projectId) {
    return join(this.projectDir(projectId), 'project.json')
  }

  artifactsDir(projectId) {
    return join(this.projectDir(projectId), 'artifacts')
  }

  versionsDir(projectId) {
    return join(this.artifactsDir(projectId), '.versions')
  }

  runsDir(projectId) {
    return join(this.projectDir(projectId), 'runs')
  }

  exportsDir(projectId) {
    return join(this.projectDir(projectId), 'exports')
  }

  /**
   * 产物文件路径。key 的安全校验在此统一完成。
   * @param {string} projectId
   * @param {string} key
   * @param {string} kind
   */
  artifactPath(projectId, key, kind) {
    const k = safeKey(key)
    const ext = this.#ext(kind)
    return join(this.artifactsDir(projectId), `${k}.${ext}`)
  }

  #ext(kind) {
    if (typeof kind !== 'string' || !KIND_RE.test(kind)) {
      throw new ForgeError('BAD_PARAMS', `非法产物类型：${String(kind)}`, { kind })
    }
    return kind
  }

  /**
   * 原子写：同目录 tmp 文件 + rename。超过 limit 抛 TOO_LARGE。
   * @param {string} file
   * @param {string|Buffer} data
   * @param {{limit?: number, label?: string}} [opts]
   * @returns {Promise<number>} 写入字节数
   */
  async atomicWrite(file, data, opts = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
    const limit = typeof opts.limit === 'number' ? opts.limit : Infinity
    if (buf.length > limit) {
      throw new ForgeError('TOO_LARGE', `${opts.label || '文件'}超过上限 ${limit} 字节（当前 ${buf.length}）`, {
        bytes: buf.length,
        limit,
      })
    }
    await fsp.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    try {
      await fsp.writeFile(tmp, buf)
      await fsp.rename(tmp, file)
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
    return buf.length
  }

  // ---------------------------------------------------------------- projects

  async createProject(project) {
    if (!project || typeof project !== 'object') throw new ForgeError('BAD_PARAMS', 'project 必须是对象')
    const id = safeId(project.id)
    return this.withLock(`project:${id}`, async () => {
      await this.ensure()
      const file = this.projectFile(id)
      if (await exists(file)) {
        throw new ForgeError('CONFLICT', `项目已存在：${id}`, { projectId: id })
      }
      await this.#writeProjectFile(project)
      return project
    })
  }

  async saveProject(project) {
    if (!project || typeof project !== 'object') throw new ForgeError('BAD_PARAMS', 'project 必须是对象')
    const id = safeId(project.id)
    return this.withLock(`project:${id}`, async () => {
      await this.#writeProjectFile(project)
      return project
    })
  }

  async #writeProjectFile(project) {
    const file = this.projectFile(project.id)
    const data = JSON.stringify(project, null, 2)
    return this.atomicWrite(file, data, { limit: LIMITS.project, label: 'project.json' })
  }

  /**
   * 读 project.json；缺失抛 NOT_FOUND，坏 JSON 抛 ARTIFACT_CORRUPT。
   * @param {string} projectId
   */
  async readProject(projectId) {
    const id = safeId(projectId)
    const file = this.projectFile(id)
    let raw
    try {
      raw = await fsp.readFile(file, 'utf8')
    } catch (err) {
      if (err && err.code === 'ENOENT') throw new ForgeError('NOT_FOUND', `项目不存在：${id}`, { projectId: id })
      throw err
    }
    return parseJson(raw, `project.json（${id}）`, { projectId: id })
  }

  async listProjectIds() {
    try {
      const entries = await fsp.readdir(this.projectsDir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((n) => ID_RE.test(n))
    } catch (err) {
      if (err && err.code === 'ENOENT') return []
      throw err
    }
  }

  /** 读所有项目（跳过损坏的 project.json），按 updatedAt 降序。 */
  async listProjects() {
    const ids = await this.listProjectIds()
    const out = []
    for (const id of ids) {
      try {
        out.push(await this.readProject(id))
      } catch (err) {
        if (err instanceof ForgeError && err.code === 'NOT_FOUND') continue
        // 单个项目损坏不应让整个列表不可用
      }
    }
    out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    return out
  }

  /** 移入 trash/<id>-<ts>，不真删。 */
  async trashProject(projectId) {
    const id = safeId(projectId)
    return this.withLock(`project:${id}`, async () => {
      await this.ensure()
      const from = this.projectDir(id)
      if (!(await exists(from))) {
        throw new ForgeError('NOT_FOUND', `项目不存在：${id}`, { projectId: id })
      }
      const stamp = isoNow().replace(/[-:TZ.]/g, '').slice(0, 14)
      let to = join(this.trashDir, `${id}-${stamp}`)
      let n = 1
      while (await exists(to)) {
        to = join(this.trashDir, `${id}-${stamp}-${n}`)
        n += 1
      }
      await fsp.rename(from, to)
      return { from, to }
    })
  }

  // --------------------------------------------------------------- artifacts

  /**
   * 写产物：旧文件进 .versions（每个 key 保留最近 3 份），更新 project.json。
   * @param {string} projectId
   * @param {string} key
   * @param {{kind: string, content: unknown}} spec
   * @param {object|null} [by]
   */
  async writeArtifact(projectId, key, spec, by = null) {
    const id = safeId(projectId)
    const k = safeKey(key)
    if (!spec || typeof spec !== 'object') throw new ForgeError('BAD_PARAMS', '产物必须是对象')
    const kind = this.#ext(spec.kind)
    const data =
      typeof spec.content === 'string'
        ? spec.content
        : JSON.stringify(spec.content === undefined ? null : spec.content, null, kind === 'json' ? 2 : 0)
    const bytes = byteLength(data)
    if (bytes > LIMITS.artifact) {
      throw new ForgeError('TOO_LARGE', `产物 ${k} 超过上限 ${LIMITS.artifact} 字节（当前 ${bytes}）`, {
        key: k,
        bytes,
        limit: LIMITS.artifact,
      })
    }

    return this.withLock(`project:${id}`, async () => {
      const project = await this.readProject(id)
      const previous = project.artifacts?.[k]
      const path = this.artifactPath(id, k, kind)

      if (previous && (await exists(path))) {
        const oldVersion = Number(previous.version) || 1
        await this.#archiveVersion(id, k, oldVersion, kind, path)
      }

      await this.atomicWrite(path, data, { limit: LIMITS.artifact, label: `产物 ${k}` })
      const meta = {
        kind,
        version: (Number(previous?.version) || 0) + 1,
        updatedAt: isoNow(),
        bytes,
        by: by || null,
      }
      project.artifacts = project.artifacts || {}
      project.artifacts[k] = meta
      project.updatedAt = meta.updatedAt
      await this.#writeProjectFile(project)
      return { key: k, kind, content: spec.content, meta }
    })
  }

  async #archiveVersion(projectId, key, version, kind, source) {
    const dir = this.versionsDir(projectId)
    await fsp.mkdir(dir, { recursive: true })
    const target = join(dir, `${flatKey(key)}.${version}.${kind}`)
    await fsp.copyFile(source, target)
    await this.#pruneVersions(projectId, key, kind)
  }

  async #pruneVersions(projectId, key, kind) {
    const dir = this.versionsDir(projectId)
    const flat = flatKey(key)
    let names
    try {
      names = await fsp.readdir(dir)
    } catch {
      return
    }
    const re = new RegExp(`^${escapeRegExp(flat)}\\.(\\d+)\\.${escapeRegExp(kind)}$`)
    const mine = []
    for (const name of names) {
      const m = name.match(re)
      if (m) mine.push({ name, version: Number(m[1]) })
    }
    mine.sort((a, b) => b.version - a.version)
    for (const old of mine.slice(LIMITS.versionsKept)) {
      await fsp.rm(join(dir, old.name), { force: true })
    }
  }

  /**
   * 读产物。缺失返回 null；json 坏掉抛 ARTIFACT_CORRUPT。
   * @param {string} projectId
   * @param {string} key
   * @param {string} [kind] 不传则从 project.json 的元数据取
   */
  async readArtifact(projectId, key, kind, knownMeta) {
    const id = safeId(projectId)
    const k = safeKey(key)
    // knownMeta：调用方手上已有 project.artifacts 时直接传，省掉一次 project.json 解析
    // （120 章项目每次运行要读几百个产物，逐个解析 project.json 是 O(n²)）。
    const meta = knownMeta ? knownMeta[k] ?? null : (await this.readProject(id)).artifacts?.[k]
    const finalKind = kind || meta?.kind
    if (!finalKind) {
      if (!meta) return null
      throw new ForgeError('ARTIFACT_CORRUPT', `产物 ${k} 缺少类型信息`, { key: k })
    }
    const path = this.artifactPath(id, k, finalKind)
    let raw
    try {
      raw = await fsp.readFile(path, 'utf8')
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (!meta) return null
        throw new ForgeError('ARTIFACT_CORRUPT', `产物文件缺失：${k}`, { key: k, path })
      }
      throw err
    }
    let content = raw
    if (finalKind === 'json') {
      content = parseJson(raw, `产物 ${k}`, { key: k, path })
    }
    return { key: k, kind: finalKind, content, meta: meta || null }
  }

  async hasArtifact(projectId, key, kind) {
    const id = safeId(projectId)
    const k = safeKey(key)
    const project = await this.readProject(id)
    const meta = project.artifacts?.[k]
    if (!meta) return false
    const finalKind = kind || meta.kind
    if (!finalKind) return false
    try {
      await fsp.access(this.artifactPath(id, k, finalKind))
      return true
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------- runs

  async writeRun(projectId, run) {
    const id = safeId(projectId)
    const runId = safeId(run?.id)
    return this.withLock(`run:${id}:${runId}`, async () => {
      const file = join(this.runsDir(id), `${runId}.json`)
      const data = JSON.stringify(run, null, 2)
      await this.atomicWrite(file, data, { limit: LIMITS.run, label: 'run.json' })
      return run
    })
  }

  async #readRunFile(projectId, runId) {
    const file = join(this.runsDir(projectId), `${safeId(runId)}.json`)
    let raw
    try {
      raw = await fsp.readFile(file, 'utf8')
    } catch (err) {
      if (err && err.code === 'ENOENT') return null
      throw err
    }
    return parseJson(raw, `run.json（${runId}）`, { projectId, runId })
  }

  /**
   * 读 run；不给 projectId 时扫描所有项目。
   * @param {string} runId
   * @param {string} [projectId]
   */
  async readRun(runId, projectId) {
    const rid = safeId(runId)
    if (projectId) {
      const run = await this.#readRunFile(safeId(projectId), rid)
      if (!run) throw new ForgeError('NOT_FOUND', `运行不存在：${rid}`, { runId: rid })
      return run
    }
    for (const id of await this.listProjectIds()) {
      const run = await this.#readRunFile(id, rid).catch(() => null)
      if (run) return run
    }
    throw new ForgeError('NOT_FOUND', `运行不存在：${rid}`, { runId: rid })
  }

  /** 项目运行历史，按开始时间降序。 */
  async listRuns(projectId) {
    const id = safeId(projectId)
    let names
    try {
      names = await fsp.readdir(this.runsDir(id))
    } catch (err) {
      if (err && err.code === 'ENOENT') return []
      throw err
    }
    const out = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        out.push(await this.#readRunFile(id, name.slice(0, -5)))
      } catch {
        // 损坏的运行记录不阻塞历史列表
      }
    }
    out.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    return out
  }

  /**
   * 追加人类可读日志行（run.log）。
   * 超过 RUN_LOG_LIMIT 就轮转成 .log.1 重新开始，避免长跑把日志写成无限大。
   */
  async appendRunLog(projectId, runId, line) {
    const id = safeId(projectId)
    const rid = safeId(runId)
    const dir = this.runsDir(id)
    await fsp.mkdir(dir, { recursive: true })
    const file = join(dir, `${rid}.log`)
    const text = String(line ?? '')
    const payload = text.endsWith('\n') ? text : `${text}\n`
    try {
      const stat = await fsp.stat(file)
      if (stat.size + Buffer.byteLength(payload) > LIMITS.runLog) {
        await fsp.rename(file, `${file}.1`).catch(() => {})
      }
    } catch {
      // 文件还不存在：正常首次追加
    }
    await fsp.appendFile(file, payload, 'utf8')
  }

  // ----------------------------------------------------------------- exports

  /**
   * 写导出文件到 exports/。filename 只取 basename。
   * @returns {Promise<{filename: string, path: string, bytes: number}>}
   */
  async writeExport(projectId, filename, buffer) {
    const id = safeId(projectId)
    const name = basename(String(filename || ''))
    if (!name || name === '.' || name === '..' || name === '/' || name === '\\') {
      throw new ForgeError('BAD_PARAMS', `非法导出文件名：${String(filename)}`)
    }
    const dir = this.exportsDir(id)
    const path = join(dir, name)
    const bytes = await this.atomicWrite(path, Buffer.from(buffer ?? ''), { label: `导出 ${name}` })
    return { filename: name, path, bytes }
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
