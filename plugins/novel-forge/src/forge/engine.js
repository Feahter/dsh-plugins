/**
 * 通用创作流水线引擎。只认识 stage / item / artifact / recipe。
 *
 * 活跃 run 保存在内存（live 对象），每个事件同步落盘 run.json；
 * startRun 立即返回，不等待整条流水线。
 */

import { readFileSync, existsSync } from 'node:fs'
import { Store } from './store.js'
import { ForgeError, asForgeError } from './errors.js'
import { EVENT } from './events.js'
import {
  applyDefaults,
  artifactKeysFor,
  declaredArtifact,
  initialStageState,
  normalizeStageList,
  validateParams,
  validateRecipe,
} from './recipe.js'
import { estimateTokens, fit, safeKey } from './text.js'
import { newProjectId, newRunId } from './ids.js'

const EVENT_LIMIT = 500
const ITEM_ID = /^[A-Za-z0-9_.-]+$/
const TERMINAL = new Set(['done', 'error', 'cancelled', 'interrupted'])

function clone(value) {
  return structuredClone(value)
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function isAbort(err) {
  return (err instanceof ForgeError && err.code === 'LLM_ABORTED') || (err && err.name === 'AbortError')
}

function normalizeStageResult(result) {
  if (result === undefined || result === null) return { artifacts: {}, note: null, meta: null }
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new ForgeError('BAD_RECIPE', 'stage.run 必须返回对象')
  }
  const artifacts = result.artifacts ?? {}
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new ForgeError('BAD_RECIPE', 'stage.run 的 artifacts 必须是对象')
  }
  for (const [key, spec] of Object.entries(artifacts)) {
    safeKey(key)
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new ForgeError('BAD_RECIPE', `产物 ${key} 的返回值必须是 {kind, content}`, { key })
    }
    if (spec.kind !== 'md' && spec.kind !== 'json') {
      throw new ForgeError('BAD_RECIPE', `产物 ${key} 的 kind 必须是 md 或 json`, { key, kind: spec.kind })
    }
    if (spec.content === undefined) {
      throw new ForgeError('BAD_RECIPE', `产物 ${key} 缺少 content`, { key })
    }
  }
  return {
    artifacts,
    note: typeof result.note === 'string' && result.note ? result.note : null,
    meta: result.meta ?? null,
  }
}

export class ForgeEngine {
  /**
   * @param {{
   *   root: string,
   *   recipes?: any[],
   *   llm?: any,
   *   logger?: any,
   *   clock?: () => Date,
   *   store?: Store,
   * }} config
   */
  constructor(config = {}) {
    const { root, recipes = [], llm = null, logger = null, clock = () => new Date(), store } = config
    if (typeof root !== 'string' || root.length === 0) throw new TypeError('ForgeEngine 需要 root 路径')
    this.root = root
    this.llm = llm
    this.logger = logger
    this.clock = typeof clock === 'function' ? clock : () => new Date()
    this.store = store instanceof Store ? store : new Store(root)
    /** @type {Map<string, any>} */
    this.recipes = new Map()
    for (const recipe of recipes) {
      validateRecipe(recipe)
      this.recipes.set(recipe.id, recipe)
    }
    /** 活跃 run：projectId → live 对象 */
    this.live = new Map()
  }

  #now() {
    return this.clock().toISOString()
  }

  #aborted(live) {
    return live.cancelRequested || live.controller.signal.aborted
  }

  #recipe(recipeId) {
    const recipe = this.recipes.get(recipeId)
    if (!recipe) throw new ForgeError('BAD_RECIPE', `未注册的 recipe：${String(recipeId)}`, { recipeId })
    return recipe
  }

  #label(stage, itemId) {
    const title = stage.title || stage.id
    return itemId ? `${title} · ${itemId}` : title
  }

  /** 事件：内存 seq + 落盘 run.json（log 事件同时 append run.log）。 */
  async #emit(live, type, data = {}) {
    const run = live.run
    run.seq += 1
    const event = { seq: run.seq, ts: this.#now(), type, data }
    run.events.push(event)
    if (run.events.length > EVENT_LIMIT) {
      const dropped = run.events.length - EVENT_LIMIT
      run.events.splice(0, dropped)
      run.dropped = (run.dropped || 0) + dropped
    }
    await this.store.writeRun(live.projectId, run)
    if (type === EVENT.LOG) {
      await this.store.appendRunLog(live.projectId, run.id, `[${event.ts}] ${data.message}`)
    }
    return event
  }

  async #log(live, message, level = 'info', extra = {}) {
    return this.#emit(live, EVENT.LOG, { message, level, ...extra })
  }

  // ------------------------------------------------------------------ 查询

  summarize(project) {
    return {
      id: project.id,
      title: project.title || '',
      recipe: project.recipe,
      recipeVersion: project.recipeVersion,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      params: project.params || {},
      stages: project.stages || {},
      stats: project.stats || {},
      artifactCount: Object.keys(project.artifacts || {}).length,
      activeRunId: project.activeRunId ?? null,
      pendingReview: project.pendingReview ?? null,
      lastError: project.lastError ?? null,
    }
  }

  async listProjects() {
    const projects = await this.store.listProjects()
    return projects.map((project) => this.summarize(project))
  }

  /**
   * 支持完整 id 或前缀，找不到抛 NOT_FOUND。
   * @param {string} idOrPrefix
   */
  async getProject(idOrPrefix) {
    const query = String(idOrPrefix ?? '').trim()
    if (!query) throw new ForgeError('NOT_FOUND', '没有指定项目')
    try {
      return await this.store.readProject(query)
    } catch (err) {
      if (!(err instanceof ForgeError) || err.code !== 'NOT_FOUND') throw err
    }
    const all = await this.store.listProjects()
    const matched = all.filter((project) => project.id.startsWith(query))
    if (matched.length === 0) {
      throw new ForgeError('NOT_FOUND', `项目不存在：${query}`, { query })
    }
    return matched[0]
  }

  /**
   * id / 前缀 / 标题子串 / 'active'（最近更新）。
   * @param {string} query
   */
  async resolveProject(query) {
    const q = String(query ?? '').trim()
    if (!q || q === 'active') {
      const all = await this.store.listProjects()
      if (all.length === 0) throw new ForgeError('NOT_FOUND', '还没有任何项目')
      return all[0]
    }
    try {
      return await this.getProject(q)
    } catch (err) {
      if (!(err instanceof ForgeError) || err.code !== 'NOT_FOUND') throw err
    }
    const all = await this.store.listProjects()
    const lower = q.toLowerCase()
    const matched = all
      .filter((project) => String(project.title || '').toLowerCase().includes(lower))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    if (matched.length === 0) throw new ForgeError('NOT_FOUND', `找不到项目：${q}`, { query: q })
    return matched[0]
  }

  async getArtifact(idOrPrefix, key) {
    const project = await this.getProject(idOrPrefix)
    return this.store.readArtifact(project.id, safeKey(key))
  }

  async getRun(runId) {
    const rid = String(runId ?? '')
    for (const live of this.live.values()) {
      if (live.run.id === rid) return clone(live.run)
    }
    return this.store.readRun(rid)
  }

  async getRunEvents(runId, afterSeq = 0) {
    const run = await this.getRun(runId)
    const after = Number(afterSeq) || 0
    const events = (run.events || []).filter((event) => Number(event.seq) > after)
    return { events, seq: Number(run.seq) || 0 }
  }

  async listRuns(projectId) {
    const project = await this.getProject(projectId)
    const runs = await this.store.listRuns(project.id)
    return runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      options: run.options,
      current: run.current,
      progress: run.progress,
      error: run.error ?? null,
      stats: run.stats,
    }))
  }

  // ------------------------------------------------------------------ 项目

  /**
   * @param {{recipeId?: string, title?: string, params?: object}} input
   */
  async createProject(input = {}) {
    const recipeId = input.recipeId || this.recipes.keys().next().value
    if (!recipeId) throw new ForgeError('BAD_RECIPE', '引擎没有注册任何 recipe')
    const recipe = this.#recipe(recipeId)
    const params = applyDefaults(recipe, input.params || {})
    validateParams(recipe.paramsSchema, params)
    const now = this.#now()
    const title = String(input.title ?? params.title ?? '').trim()
    const project = {
      schemaVersion: 1,
      id: newProjectId({ clock: this.clock }),
      title,
      recipe: recipe.id,
      recipeVersion: recipe.version || 1,
      createdAt: now,
      updatedAt: now,
      params,
      artifacts: {},
      stages: initialStageState(recipe),
      stats: { calls: 0, estTokensIn: 0, estTokensOut: 0 },
      activeRunId: null,
      pendingReview: null,
      lastError: null,
    }
    await this.store.createProject(project)
    return project
  }

  /**
   * 只允许改 title / params；正在跑时拒绝。
   * @param {string} idOrPrefix
   * @param {{title?: string, params?: object}} patch
   */
  async updateProject(idOrPrefix, patch = {}) {
    const project = await this.getProject(idOrPrefix)
    if (this.live.has(project.id)) {
      throw new ForgeError('RUN_ACTIVE', '项目正在运行，不能修改', { projectId: project.id })
    }
    const unknown = Object.keys(patch).filter((key) => key !== 'title' && key !== 'params')
    if (unknown.length) throw new ForgeError('BAD_PARAMS', `不支持的字段：${unknown.join(', ')}`, { fields: unknown })
    const recipe = this.#recipe(project.recipe)
    if (patch.title !== undefined) {
      if (typeof patch.title !== 'string') throw new ForgeError('BAD_PARAMS', 'title 必须是字符串')
      project.title = patch.title.trim()
    }
    if (patch.params !== undefined) {
      if (!patch.params || typeof patch.params !== 'object' || Array.isArray(patch.params)) {
        throw new ForgeError('BAD_PARAMS', 'params 必须是对象')
      }
      const merged = { ...project.params, ...patch.params }
      validateParams(recipe.paramsSchema, merged)
      project.params = merged
    }
    project.updatedAt = this.#now()
    await this.store.saveProject(project)
    return project
  }

  async deleteProject(idOrPrefix) {
    const project = await this.getProject(idOrPrefix)
    if (this.live.has(project.id)) {
      throw new ForgeError('RUN_ACTIVE', '项目正在运行，不能删除', { projectId: project.id })
    }
    return this.store.trashProject(project.id)
  }

  /**
   * 手改/续跑写产物；版本 +1，旧版进 .versions。
   * @param {string} idOrPrefix
   * @param {string} key
   * @param {{kind?: string, content: unknown}} spec
   * @param {object} [by]
   */
  async writeArtifact(idOrPrefix, key, spec, by = {}) {
    const project = await this.getProject(idOrPrefix)
    if (this.live.has(project.id)) {
      throw new ForgeError('RUN_ACTIVE', '项目正在运行，不能手动写入产物', { projectId: project.id })
    }
    const k = safeKey(key)
    if (!spec || typeof spec !== 'object') throw new ForgeError('BAD_PARAMS', '产物必须是对象')
    const recipe = this.#recipe(project.recipe)
    const declared = declaredArtifact(recipe, k)
    const kind = spec.kind || declared?.kind
    if (!kind) throw new ForgeError('BAD_PARAMS', `产物 ${k} 没有声明类型，必须显式给 kind`, { key: k })
    if (declared && declared.kind !== kind) {
      throw new ForgeError('BAD_PARAMS', `产物 ${k} 的类型应为 ${declared.kind}`, { key: k, kind })
    }
    const written = await this.store.writeArtifact(
      project.id,
      k,
      { kind, content: spec.content },
      by && Object.keys(by).length ? by : null,
    )
    return { key: k, kind, content: written.content, meta: written.meta }
  }

  // ------------------------------------------------------------------- 运行

  /**
   * 启动 run，立即返回 run 快照（不等待流水线）。
   * @param {string} idOrPrefix
   * @param {object} options
   */
  async startRun(idOrPrefix, options = {}) {
    const project = await this.getProject(idOrPrefix)
    const recipe = this.#recipe(project.recipe)
    const selected = normalizeStageList(recipe, options || {})
    if (this.live.has(project.id)) {
      const active = this.live.get(project.id)
      if (active.run.status === 'running') {
        throw new ForgeError('RUN_ACTIVE', `项目已有运行中的任务：${active.run.id}`, {
          projectId: project.id,
          runId: active.run.id,
        })
      }
      // 收尾中的旧 run 不再占用项目
      this.live.delete(project.id)
    }
    if (options.items !== undefined && options.items !== null && !Array.isArray(options.items)) {
      throw new ForgeError('BAD_PARAMS', 'items 必须是数组')
    }
    if (Array.isArray(options.items) && options.items.some((item) => typeof item !== 'string')) {
      throw new ForgeError('BAD_PARAMS', 'items 只能包含字符串 id')
    }

    const now = this.#now()
    const run = {
      schemaVersion: 1,
      id: newRunId({ clock: this.clock }),
      projectId: project.id,
      status: 'running',
      startedAt: now,
      endedAt: null,
      options: {
        stages: selected.map((stage) => stage.id),
        items: Array.isArray(options.items) ? [...options.items] : null,
        autoApprove: options.autoApprove === true,
        force: options.force === true,
        dryRun: options.dryRun === true,
        from: options.from ?? null,
        to: options.to ?? null,
      },
      current: { stage: null, item: null, label: null },
      progress: { done: 0, total: 0 },
      seq: 0,
      dropped: 0,
      events: [],
      error: null,
      stats: { calls: 0, estTokensIn: 0, estTokensOut: 0 },
    }

    project.pendingReview = null
    project.lastError = null
    project.activeRunId = run.id
    project.updatedAt = now

    const live = {
      projectId: project.id,
      project,
      run,
      controller: new AbortController(),
      cancelRequested: false,
      lastModel: null,
      promise: null,
    }
    this.live.set(project.id, live)

    try {
      await this.store.saveProject(project)
      await this.store.writeRun(project.id, run)
    } catch (err) {
      this.live.delete(project.id)
      throw asForgeError(err)
    }

    live.promise = this.#execute(live, recipe, selected)
      .catch((err) => this.#fatal(live, err))
      .finally(() => {
        if (this.live.get(project.id) === live) this.live.delete(project.id)
      })
    return clone(run)
  }

  async #fatal(live, err) {
    if (TERMINAL.has(live.run.status) || live.run.status === 'paused') return
    try {
      await this.#fail(live, err)
    } catch {
      // 最后兜底：内存状态至少标成 error
      live.run.status = 'error'
      live.run.error = asForgeError(err).toJSON()
      live.project.activeRunId = null
    }
  }

  async #execute(live, recipe, stages) {
    const { run } = live
    try {
      live.cache = await this.#loadArtifactCache(live.project)
      await this.#emit(live, EVENT.RUN_START, {
        stages: run.options.stages,
        items: run.options.items,
        autoApprove: run.options.autoApprove,
      })
      let outcome = 'done'
      for (let i = 0; i < stages.length; i += 1) {
        if (this.#aborted(live)) {
          outcome = 'cancelled'
          break
        }
        const stage = stages[i]
        const remaining = stages.slice(i + 1).map((item) => item.id)
        const result = await this.#runStage(live, stage, remaining)
        if (result === 'cancelled') {
          outcome = 'cancelled'
          break
        }
        if (result === 'paused') {
          outcome = 'paused'
          break
        }
      }
      await this.#finish(live, outcome)
    } catch (err) {
      if (this.#aborted(live) || isAbort(err)) await this.#finish(live, 'cancelled')
      else await this.#fail(live, err)
    }
  }

  async #finish(live, status) {
    const { run, project } = live
    run.endedAt = this.#now()
    run.current = { stage: null, item: null, label: null }
    project.activeRunId = null
    project.updatedAt = run.endedAt
    // 先落项目再改内存状态：getRun 若在 saveProject 完成前看到 done，
    // 调用方随后读 project 会读到 activeRunId 还在的旧状态（测试/UI 竞态）。
    await this.store.saveProject(project)
    run.status = status
    if (status === 'cancelled') {
      await this.#emit(live, EVENT.RUN_END, { status: 'cancelled' })
    } else if (status === 'done') {
      await this.#emit(live, EVENT.RUN_END, { status: 'done' })
    } else {
      // paused 没有额外事件，但内存里的 status 必须落盘
      await this.store.writeRun(project.id, run)
    }
  }

  async #fail(live, err) {
    const { run, project } = live
    const fe = asForgeError(err)
    const current = run.current || {}
    const stageState = current.stage ? project.stages?.[current.stage] : null
    if (stageState) {
      stageState.status = 'error'
      if (current.item && stageState.items) stageState.items[current.item] = 'error'
    }
    run.status = 'error'
    run.error = { code: fe.code, message: fe.message }
    if (fe.detail !== undefined) run.error.detail = fe.detail
    run.endedAt = this.#now()
    project.lastError = {
      stage: current.stage ?? null,
      item: current.item ?? null,
      code: fe.code,
      message: fe.message,
      at: run.endedAt,
    }
    project.activeRunId = null
    project.updatedAt = run.endedAt
    run.current = { stage: null, item: null, label: null }
    await this.store.saveProject(project).catch(() => {})
    await this.#emit(live, EVENT.RUN_ERROR, { message: fe.message, code: fe.code }).catch(() => {})
  }

  async #runStage(live, stage, remainingIds) {
    const { project, run } = live
    const state = project.stages[stage.id] || (project.stages[stage.id] = stage.each ? { status: 'idle', items: {} } : { status: 'idle' })
    if (stage.each && !state.items) state.items = {}

    // 条件跳过（force 时不调用 skip）
    if (run.options.force !== true && typeof stage.skip === 'function') {
      const reason = await stage.skip(deepFreeze(clone(project)))
      if (reason) {
        state.status = 'skipped'
        project.updatedAt = this.#now()
        await this.store.saveProject(project)
        await this.#emit(live, EVENT.STAGE_START, { stage: stage.id, total: 0 })
        await this.#emit(live, EVENT.STAGE_END, { stage: stage.id, status: 'skipped' })
        await this.#log(live, `跳过 ${stage.title || stage.id}（${typeof reason === 'string' ? reason : '条件跳过'}）`)
        return 'done'
      }
    }

    let units
    /** @type {any[]|undefined} */
    let allItems
    if (stage.each) {
      const list = await this.#resolveItemList(live, stage)
      allItems = list
      let entries = list.map((data, index) => ({
        id: data.id,
        data,
        index,
        total: list.length,
      }))
      if (Array.isArray(run.options.items)) {
        const known = new Set(entries.map((entry) => entry.id))
        const unknown = run.options.items.filter((id) => !known.has(id))
        if (unknown.length) {
          throw new ForgeError('BAD_PARAMS', `未知 item：${unknown.join(', ')}`, { stage: stage.id, items: unknown })
        }
        const wanted = new Set(run.options.items)
        entries = entries.filter((entry) => wanted.has(entry.id))
      }
      units = entries
    } else {
      units = [{ id: undefined, data: undefined, index: undefined, total: undefined }]
    }

    const work = []
    for (const unit of units) {
      if (this.#aborted(live)) return 'cancelled'
      if (run.options.force !== true && (await this.#isComplete(live, stage, unit.id))) {
        if (unit.id) state.items[unit.id] = 'done'
        await this.#log(live, `跳过 ${stage.title || stage.id}${unit.id ? `/${unit.id}` : ''}（已完成）`)
        continue
      }
      work.push(unit)
    }

    if (work.length === 0) {
      state.status = 'done'
      project.updatedAt = this.#now()
      await this.store.saveProject(project)
      await this.#emit(live, EVENT.STAGE_START, { stage: stage.id, total: 0 })
      await this.#emit(live, EVENT.STAGE_END, { stage: stage.id, status: 'done' })
      return 'done'
    }

    state.status = 'running'
    project.updatedAt = this.#now()
    await this.store.saveProject(project)
    await this.#emit(live, EVENT.STAGE_START, { stage: stage.id, total: work.length })
    run.progress.total += work.length
    await this.#emit(live, EVENT.PROGRESS, { done: run.progress.done, total: run.progress.total })

    let hadError = false
    for (const unit of work) {
      if (this.#aborted(live)) {
        if (unit.id) state.items[unit.id] = 'pending'
        run.current = { stage: stage.id, item: unit.id ?? null, label: this.#label(stage, unit.id) }
        await this.store.saveProject(project)
        return 'cancelled'
      }
      if (unit.id) state.items[unit.id] = 'running'
      run.current = { stage: stage.id, item: unit.id ?? null, label: this.#label(stage, unit.id) }
      project.updatedAt = this.#now()
      await this.store.saveProject(project)
      if (unit.id) {
        await this.#emit(live, EVENT.ITEM_START, {
          stage: stage.id,
          item: unit.id,
          index: unit.index,
          total: unit.total,
        })
      }

      try {
        const ctx = this.#makeCtx(live, stage, unit, allItems)
        const raw = run.options.dryRun ? { artifacts: {} } : await stage.run(ctx)
        if (this.#aborted(live)) {
          if (unit.id) state.items[unit.id] = 'pending'
          await this.store.saveProject(project)
          return 'cancelled'
        }
        const normalized = normalizeStageResult(raw)
        for (const [key, spec] of Object.entries(normalized.artifacts)) {
          const written = await this.store.writeArtifact(
            project.id,
            key,
            { kind: spec.kind, content: spec.content },
            { stage: stage.id, runId: run.id, item: unit.id ?? null, model: live.lastModel ?? null, ...(normalized.meta || {}) },
          )
          project.artifacts = project.artifacts || {}
          project.artifacts[key] = written.meta
          await this.#cacheArtifact(live, written, spec.content)
          await this.#emit(live, EVENT.ARTIFACT, { key, kind: spec.kind, bytes: written.meta.bytes })
        }
        if (unit.id) state.items[unit.id] = 'done'
        project.updatedAt = this.#now()
        await this.store.saveProject(project)
        if (normalized.note) await this.#log(live, normalized.note)
        if (unit.id) await this.#emit(live, EVENT.ITEM_DONE, { stage: stage.id, item: unit.id })
        run.progress.done += 1
        await this.#emit(live, EVENT.PROGRESS, { done: run.progress.done, total: run.progress.total })
      } catch (err) {
        if (this.#aborted(live) || isAbort(err)) {
          if (unit.id) state.items[unit.id] = 'pending'
          await this.store.saveProject(project)
          return 'cancelled'
        }
        const fe = asForgeError(err)
        hadError = true
        if (unit.id) state.items[unit.id] = 'error'
        project.lastError = {
          stage: stage.id,
          item: unit.id ?? null,
          code: fe.code,
          message: fe.message,
          at: this.#now(),
        }
        if (!stage.each || stage.onItemError === 'stop') {
          state.status = 'error'
          project.updatedAt = this.#now()
          await this.store.saveProject(project)
          if (unit.id) {
            await this.#emit(live, EVENT.ITEM_ERROR, {
              stage: stage.id,
              item: unit.id,
              message: fe.message,
              code: fe.code,
            })
          }
          throw fe
        }
        if (unit.id) {
          await this.#emit(live, EVENT.ITEM_ERROR, {
            stage: stage.id,
            item: unit.id,
            message: fe.message,
            code: fe.code,
          })
          await this.#log(live, `${stage.title || stage.id}/${unit.id} 失败：${fe.message}`, 'warn')
        }
        project.updatedAt = this.#now()
        await this.store.saveProject(project)
      }
    }

    state.status = hadError ? 'partial' : 'done'
    project.updatedAt = this.#now()
    await this.store.saveProject(project)
    await this.#emit(live, EVENT.STAGE_END, { stage: stage.id, status: state.status })

    const wantsReview = typeof stage.review === 'function' ? await stage.review(deepFreeze(clone(project))) : stage.review === true
    if (wantsReview && run.options.autoApprove !== true && run.options.dryRun !== true) {
      project.pendingReview = { stage: stage.id, at: this.#now(), nextStages: remainingIds }
      await this.store.saveProject(project)
      await this.#emit(live, EVENT.RUN_PAUSED, { stage: stage.id })
      return 'paused'
    }
    return 'done'
  }

  async #resolveItemList(live, stage) {
    const path = String(stage.each)
    const dot = path.indexOf('.')
    const rootKey = dot < 0 ? path : path.slice(0, dot)
    const rest = dot < 0 ? '' : path.slice(dot + 1)
    const artifact = await this.store.readArtifact(live.projectId, rootKey)
    if (!artifact) {
      throw new ForgeError('ARTIFACT_MISSING', `无法解析 ${path}：缺少产物 ${rootKey}`, {
        stage: stage.id,
        key: rootKey,
      })
    }
    const list = rest ? getDot(artifact.content, rest) : artifact.content
    if (!Array.isArray(list)) {
      throw new ForgeError('BAD_RECIPE', `each 路径 ${path} 未指向数组`, { stage: stage.id, path })
    }
    const seen = new Set()
    return list.map((data, index) => {
      if (!data || typeof data !== 'object' || typeof data.id !== 'string' || !ITEM_ID.test(data.id)) {
        throw new ForgeError('BAD_RECIPE', `each 列表第 ${index} 项缺少合法 id`, { stage: stage.id, index })
      }
      if (seen.has(data.id)) {
        throw new ForgeError('BAD_RECIPE', `each 列表 id 重复：${data.id}`, { stage: stage.id, item: data.id })
      }
      seen.add(data.id)
      return data
    })
  }

  async #isComplete(live, stage, itemId) {
    const keys = artifactKeysFor(stage, itemId)
    if (keys.length === 0) return false
    for (const key of keys) {
      if (!live.project.artifacts?.[key]) return false
      if (!(await this.store.hasArtifact(live.projectId, key))) return false
    }
    return true
  }

  // -------------------------------------------------------------------- ctx

  /**
   * 同步读 API：运行期把产物读进内存缓存，stage/prompt 可以直接读，
   * 不必在 2000 行提示词里到处 await。写入时同步更新缓存。
   */
  #readApi(cache) {
    const read = (key) => cache.get(safeKey(key)) ?? null
    return {
      has(key) {
        return Boolean(read(key))
      },
      read(key) {
        return read(key)
      },
      text(key, maxChars) {
        const artifact = read(key)
        if (!artifact) return ''
        const text = artifact.kind === 'json' ? JSON.stringify(artifact.content, null, 2) : String(artifact.content)
        return maxChars ? fit(text, maxChars) : text
      },
      json(key) {
        const k = safeKey(key)
        const artifact = read(k)
        if (!artifact) throw new ForgeError('ARTIFACT_MISSING', `产物不存在：${k}`, { key: k })
        if (artifact.kind === 'json') return artifact.content
        try {
          return JSON.parse(String(artifact.content))
        } catch (err) {
          throw new ForgeError('ARTIFACT_CORRUPT', `产物 ${k} 不是合法 JSON`, {
            key: k,
            reason: err instanceof Error ? err.message : String(err),
          })
        }
      },
      list(path) {
        const p = String(path)
        const dot = p.indexOf('.')
        const rootKey = dot < 0 ? p : p.slice(0, dot)
        const rest = dot < 0 ? '' : p.slice(dot + 1)
        const data = this.json(rootKey)
        return rest ? getDot(data, rest) : data
      },
    }
  }

  async #loadArtifactCache(project) {
    const cache = new Map()
    for (const key of Object.keys(project.artifacts || {})) {
      const artifact = await this.store.readArtifact(project.id, key)
      if (artifact) cache.set(key, artifact)
    }
    return cache
  }

  async #cacheArtifact(live, written, content) {
    live.cache.set(written.key, {
      key: written.key,
      kind: written.kind,
      content: written.kind === 'json' ? structuredClone(content) : String(content),
      meta: written.meta,
    })
  }

  #makeCtx(live, stage, unit, allItems) {
    const { project, run } = live
    const api = this.#readApi(live.cache)
    const snapshot = deepFreeze(clone(project))
    const items = allItems ? deepFreeze(clone(allItems)) : undefined
    return {
      project: snapshot,
      params: deepFreeze(clone(project.params || {})),
      run: deepFreeze({ id: run.id, options: clone(run.options) }),
      item: unit.data,
      index: unit.index,
      total: unit.total,
      items,
      signal: live.controller.signal,
      has: api.has,
      read: api.read,
      text: api.text,
      json: api.json,
      list: api.list,
      fit: (text, maxChars) => fit(text, maxChars),
      log: (message, data) => this.#log(live, String(message), 'info', data && typeof data === 'object' ? { data } : {}),
      progress: (done, total) => this.#ctxProgress(live, done, total),
      llm: {
        generate: (opts) => this.#ctxGenerate(live, stage, unit, opts),
      },
    }
  }

  async #ctxProgress(live, done, total) {
    const d = Math.max(0, Number(done) || 0)
    const t = Math.max(0, Number(total) || 0)
    live.run.progress = { done: d, total: t }
    await this.#emit(live, EVENT.PROGRESS, { done: d, total: t })
  }

  async #ctxGenerate(live, stage, unit, opts = {}) {
    if (!this.llm || typeof this.llm.generate !== 'function') {
      throw new ForgeError('LLM_UNAVAILABLE', '模型服务未就绪，请先在设置里选择模型')
    }
    if (this.#aborted(live)) throw new ForgeError('LLM_ABORTED', '模型调用已取消')
    const system = typeof opts.system === 'string' ? opts.system : ''
    const user = typeof opts.user === 'string' ? opts.user : ''
    let result
    try {
      result = await this.llm.generate({
        ...opts,
        system,
        user,
        maxTokens: opts.maxTokens ?? 4096,
        signal: live.controller.signal,
        sessionId: opts.sessionId || `dsh-forge-${live.run.id}`,
      })
    } catch (err) {
      if (isAbort(err) || this.#aborted(live)) throw new ForgeError('LLM_ABORTED', '模型调用已取消')
      throw asForgeError(err, 'LLM_ERROR')
    }
    if (this.#aborted(live)) throw new ForgeError('LLM_ABORTED', '模型调用已取消')
    const text = typeof result?.text === 'string' ? result.text : ''
    const chars = typeof result?.chars === 'number' ? result.chars : text.length
    const tokensIn = result?.usage?.inputTokens ?? estimateTokens(system.length + user.length)
    const tokensOut = result?.usage?.outputTokens ?? estimateTokens(chars)
    const run = live.run
    run.stats.calls += 1
    run.stats.estTokensIn += tokensIn
    run.stats.estTokensOut += tokensOut
    live.project.stats = live.project.stats || { calls: 0, estTokensIn: 0, estTokensOut: 0 }
    live.project.stats.calls = (live.project.stats.calls || 0) + 1
    live.project.stats.estTokensIn = (live.project.stats.estTokensIn || 0) + tokensIn
    live.project.stats.estTokensOut = (live.project.stats.estTokensOut || 0) + tokensOut
    const model = result?.model ?? null
    if (model) live.lastModel = model
    await this.#emit(live, EVENT.LLM, {
      stage: stage.id,
      item: unit.id ?? null,
      phase: opts.phase ?? null,
      label: opts.label ?? null,
      chars,
      model,
    })
    return result
  }

  // ------------------------------------------------------------------ 取消

  async cancelRun(runId) {
    const rid = String(runId ?? '')
    for (const live of this.live.values()) {
      if (live.run.id !== rid) continue
      live.cancelRequested = true
      live.controller.abort()
      // 内存里的 run.status 先不动：等 #finish 一次性写入 run-end + 终态，
      // 避免测试/客户端读到「已 cancelled 但没有 run-end」的中间态。
      return { ...clone(live.run), status: 'cancelled' }
    }
    const run = await this.store.readRun(rid)
    if (run.status === 'running') {
      run.status = 'cancelled'
      run.endedAt = this.#now()
      await this.store.writeRun(run.projectId, run)
      try {
        const project = await this.store.readProject(run.projectId)
        if (project.activeRunId === run.id) {
          project.activeRunId = null
          project.updatedAt = run.endedAt
          await this.store.saveProject(project)
        }
      } catch {
        // 项目已不在时忽略
      }
    }
    return run
  }

  // ------------------------------------------------------------------ 预估

  async estimate(idOrPrefix, params) {
    const project = await this.getProject(idOrPrefix)
    const recipe = this.#recipe(project.recipe)
    let value = {}
    if (typeof recipe.estimate === 'function') {
      value = (await recipe.estimate(params ? { ...project.params, ...params } : project.params)) || {}
    }
    const stages = Object.values(project.stages || {})
    return {
      ...value,
      progress: {
        stagesDone: stages.filter((stage) => stage.status === 'done').length,
        stagesTotal: stages.length,
        artifacts: Object.keys(project.artifacts || {}).length,
        calls: project.stats?.calls || 0,
        estTokensIn: project.stats?.estTokensIn || 0,
        estTokensOut: project.stats?.estTokensOut || 0,
      },
    }
  }

  // ------------------------------------------------------------------ 导出

  async exportProject(idOrPrefix, format) {
    const project = await this.getProject(idOrPrefix)
    const recipe = this.#recipe(project.recipe)
    const key = format === 'md' ? 'markdown' : format
    const exporter = recipe.exports?.[key]
    if (!exporter || typeof exporter.run !== 'function') {
      throw new ForgeError('EXPORT_FAILED', `不支持的导出格式：${String(format)}`, { format })
    }
    const api = this.#readApi(await this.#loadArtifactCache(project))
    const ctx = {
      project: deepFreeze(clone(project)),
      params: deepFreeze(clone(project.params || {})),
      ...api,
      fit: (text, maxChars) => fit(text, maxChars),
      log: async () => {},
      progress: async () => {},
      llm: {
        generate: async () => {
          throw new ForgeError('LLM_UNAVAILABLE', '导出阶段不调用模型')
        },
      },
    }
    let result
    try {
      result = await exporter.run(ctx)
    } catch (err) {
      if (err instanceof ForgeError) throw err
      throw new ForgeError('EXPORT_FAILED', err instanceof Error ? err.message : String(err), undefined)
    }
    if (!result || typeof result !== 'object' || !result.filename) {
      throw new ForgeError('EXPORT_FAILED', 'recipe 导出结果缺少 filename')
    }
    const buffer = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer ?? '')
    const written = await this.store.writeExport(project.id, result.filename, buffer)
    return {
      filename: written.filename,
      path: written.path,
      mime: result.mime || 'application/octet-stream',
      bytes: written.bytes,
    }
  }

  // ------------------------------------------------------------------ 恢复

  /**
   * 启动时调用：把残留 running 的 run 标 interrupted，并修正 project 状态。
   * @returns {Promise<Array<{projectId: string, runId: string}>>}
   */
  async recover() {
    const projects = await this.store.listProjects()
    const fixed = []
    for (const project of projects) {
      if (this.live.has(project.id)) continue
      const runs = await this.store.listRuns(project.id)
      let interrupted = false
      for (const run of runs) {
        if (run.status !== 'running') continue
        run.status = 'interrupted'
        run.endedAt = this.#now()
        run.error = { code: 'INTERRUPTED', message: '引擎重启，运行被中断' }
        await this.store.writeRun(project.id, run)
        fixed.push({ projectId: project.id, runId: run.id })
        interrupted = true
      }

      let changed = false
      for (const [stageId, state] of Object.entries(project.stages || {})) {
        if (!state || typeof state !== 'object') continue
        if (state.status === 'running') {
          const hasItems = state.items && Object.keys(state.items).length > 0
          state.status = hasItems ? 'partial' : 'error'
          changed = true
        }
        if (state.items && typeof state.items === 'object') {
          for (const [itemId, status] of Object.entries(state.items)) {
            if (status === 'running') {
              state.items[itemId] = 'pending'
              changed = true
            }
          }
        }
      }
      if (project.activeRunId) {
        project.activeRunId = null
        changed = true
      }
      if (interrupted && !project.lastError) {
        project.lastError = { code: 'INTERRUPTED', message: '引擎重启，上次运行被中断', at: this.#now() }
        changed = true
      }
      if (changed) {
        project.updatedAt = this.#now()
        await this.store.saveProject(project)
      }
    }
    return fixed
  }
}

function getDot(obj, path) {
  let cur = obj
  for (const part of String(path).split('.').filter((p) => p !== '')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}
