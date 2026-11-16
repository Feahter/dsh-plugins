// 脑图状态落盘：$DSH_HOME/mind-canvas/state.json。
// 桌面端和 Web 端读同一份；写入用 tmp + rename 原子替换，坏文件不会把好文件写没。
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 单份状态的上限，防止一次坏请求把磁盘写满。 */
export const MAX_STATE_BYTES = 8 * 1024 * 1024

export function dshHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), '.dsh')
}

/** 只做形状检查：形状不对就整份拒绝，避免把坏数据写进唯一一份文件。 */
export function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'state 必须是一个对象'
  if (!Array.isArray(value.docs)) return 'state.docs 必须是数组'
  if (value.docs.length === 0) return 'state.docs 不能为空'
  if (typeof value.activeId !== 'string') return 'state.activeId 必须是字符串'
  for (const doc of value.docs) {
    if (!doc || typeof doc !== 'object') return 'doc 必须是对象'
    if (typeof doc.id !== 'string' || !doc.id) return 'doc.id 必须是非空字符串'
    if (!Array.isArray(doc.nodes)) return 'doc.nodes 必须是数组'
    for (const node of doc.nodes) {
      if (!node || typeof node !== 'object') return 'node 必须是对象'
      if (typeof node.id !== 'string' || !node.id) return 'node.id 必须是非空字符串'
      if (typeof node.text !== 'string') return 'node.text 必须是字符串'
      if (node.parentId !== null && typeof node.parentId !== 'string') return 'node.parentId 必须是字符串或 null'
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return 'node.x / node.y 必须是数字'
    }
  }
  return null
}

export class Store {
  constructor(root = join(dshHome(), 'mind-canvas')) {
    this.root = root
    this.file = join(root, 'state.json')
    this.queue = Promise.resolve()
    this.lastGood = null
  }

  async ensureDir() {
    await mkdir(this.root, { recursive: true })
  }

  /** 读当前状态；文件不存在返回 null，解析失败也返回 null（不让坏文件挡住界面）。 */
  async read() {
    await this.ensureDir()
    let text
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    try {
      const parsed = JSON.parse(text)
      this.lastGood = parsed
      return parsed
    } catch {
      return this.lastGood
    }
  }

  async info() {
    try {
      const stats = await stat(this.file)
      return { bytes: stats.size, mtimeMs: stats.mtimeMs }
    } catch (error) {
      if (error.code === 'ENOENT') return { bytes: 0, mtimeMs: 0 }
      throw error
    }
  }

  /**
   * 整份写入。串行化，避免同一进程里两个请求互相覆盖。
   * @param {object} state - 已经通过 validateState 的状态。
   */
  write(state) {
    return this.#enqueue(() => this.#writeNow(state))
  }

  /**
   * 串行化「读最新状态 → 修改 → 写回」，用于 mind_canvas_add 这类读改写。
   * 只把写入排进队列不够：两个 add 都先读到同一份旧状态，后写的会把先写的更新吞掉。
   * mutator 返回 undefined/null 表示没有变化，不写盘。
   * @param {(current: object|null) => (object|undefined|null|Promise<object|undefined|null>)} mutator
   */
  update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('update 需要 mutator 函数')
    return this.#enqueue(async () => {
      const current = await this.read()
      const next = await mutator(current)
      if (next === undefined || next === null) return { state: current, written: false }
      const problem = validateState(next)
      if (problem) {
        const error = new Error(`拒绝写入：${problem}`)
        error.code = 'invalid-state'
        error.status = 400
        throw error
      }
      const result = await this.#writeNow(next)
      return { state: next, written: true, ...result }
    })
  }

  #enqueue(run) {
    const next = this.queue.then(run, run)
    this.queue = next.then(() => {}, () => {})
    return next
  }

  async #writeNow(state) {
    const payload = JSON.stringify(state, null, 1)
    const bytes = Buffer.byteLength(payload)
    if (bytes > MAX_STATE_BYTES) {
      const error = new Error(`状态太大（${(bytes / 1024 / 1024).toFixed(1)}MB），拒绝保存`)
      error.status = 413
      throw error
    }
    await this.ensureDir()
    const tmp = join(this.root, `.state-${randomUUID()}.tmp`)
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, this.file)
    this.lastGood = state
    return { bytes, savedAt: new Date().toISOString() }
  }
}
