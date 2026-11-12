/**
 * Recipe 校验、stage 列表解析、参数 schema 校验。
 * 只认识 recipe / stage / artifact 这一层抽象。
 */

import { ForgeError } from './errors.js'
import { safeKey } from './text.js'

const KINDS = new Set(['md', 'json'])
const STAGE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/

function fail(message, detail) {
  throw new ForgeError('BAD_RECIPE', message, detail)
}

/** 静态 key 或尾部通配 key（`<prefix>/*`）。 */
export function isArtifactPattern(key) {
  if (typeof key !== 'string' || key.length === 0) return false
  if (key.includes('*')) {
    if (!key.endsWith('/*')) return false
    const prefix = key.slice(0, -2)
    if (prefix.includes('*')) return false
    try {
      safeKey(prefix)
    } catch {
      return false
    }
    return true
  }
  try {
    safeKey(key)
    return true
  } catch {
    return false
  }
}

/**
 * 校验 recipe 形状，非法时抛 BAD_RECIPE。返回 recipe 本身便于链式使用。
 * @param {any} recipe
 */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) fail('recipe 必须是对象')
  if (typeof recipe.id !== 'string' || !STAGE_ID.test(recipe.id)) {
    fail(`recipe.id 非法：${String(recipe.id)}`)
  }
  if (!Array.isArray(recipe.stages) || recipe.stages.length === 0) {
    fail(`recipe ${recipe.id} 的 stages 必须是非空数组`)
  }
  if (recipe.paramsSchema !== undefined) validateSchemaShape(recipe.paramsSchema, `recipe ${recipe.id}.paramsSchema`)
  if (recipe.paramsDefaults !== undefined && (typeof recipe.paramsDefaults !== 'object' || recipe.paramsDefaults === null)) {
    fail(`recipe ${recipe.id}.paramsDefaults 必须是对象`)
  }

  if (recipe.artifacts !== undefined) {
    if (typeof recipe.artifacts !== 'object' || recipe.artifacts === null || Array.isArray(recipe.artifacts)) {
      fail(`recipe ${recipe.id}.artifacts 必须是对象`)
    }
    for (const [key, decl] of Object.entries(recipe.artifacts)) {
      if (!isArtifactPattern(key)) fail(`recipe ${recipe.id} 声明了非法 artifact key：${key}`)
      if (!decl || typeof decl !== 'object') fail(`artifact ${key} 的声明必须是对象`)
      if (!KINDS.has(decl.kind)) fail(`artifact ${key} 的 kind 必须是 md 或 json`, { kind: decl.kind })
    }
  }

  const seen = new Set()
  for (const stage of recipe.stages) {
    if (!stage || typeof stage !== 'object') fail(`recipe ${recipe.id} 的 stage 必须是对象`)
    if (typeof stage.id !== 'string' || !STAGE_ID.test(stage.id)) {
      fail(`stage.id 非法：${String(stage.id)}`)
    }
    if (seen.has(stage.id)) fail(`stage id 重复：${stage.id}`)
    seen.add(stage.id)

    if (typeof stage.run !== 'function') fail(`stage ${stage.id} 缺少 run 函数`)
    if (stage.title !== undefined && typeof stage.title !== 'string') fail(`stage ${stage.id}.title 必须是字符串`)
    if (stage.review !== undefined && typeof stage.review !== 'boolean' && typeof stage.review !== 'function') {
      fail(`stage ${stage.id}.review 必须是布尔值或 (project) => boolean`)
    }
    if (stage.each !== undefined) {
      if (typeof stage.each !== 'string' || stage.each.trim() === '') {
        fail(`stage ${stage.id}.each 必须是非空点路径字符串`)
      }
      if (stage.each.includes('*')) fail(`stage ${stage.id}.each 不能包含通配符`)
    }
    if (stage.alwaysRun !== undefined && typeof stage.alwaysRun !== 'boolean') {
      fail(`stage ${stage.id}.alwaysRun 必须是布尔值`)
    }
    if (stage.skip !== undefined && typeof stage.skip !== 'function') {
      fail(`stage ${stage.id}.skip 必须是函数`)
    }
    // 产物「存在但其实是占位/空壳」时，允许 recipe 声明它不算完成，下次重跑时重新生成。
    if (stage.isStale !== undefined && typeof stage.isStale !== 'function') {
      fail(`stage ${stage.id}.isStale 必须是函数`)
    }
    if (stage.onItemError !== undefined) {
      if (!stage.each) fail(`stage ${stage.id} 声明了 onItemError 但没有 each`)
      if (stage.onItemError !== 'continue' && stage.onItemError !== 'stop') {
        fail(`stage ${stage.id}.onItemError 只能是 continue / stop`)
      }
    }

    if (stage.produces === undefined) {
      stage.produces = []
    }
    if (!Array.isArray(stage.produces)) fail(`stage ${stage.id}.produces 必须是数组`)
    for (const key of stage.produces) {
      if (!isArtifactPattern(key)) fail(`stage ${stage.id} 声明了非法产物 key：${key}`)
      if (key.includes('*') && !stage.each) {
        fail(`stage ${stage.id} 没有 each，产物 key 不能是通配：${key}`)
      }
    }
  }

  if (recipe.exports !== undefined) {
    if (typeof recipe.exports !== 'object' || recipe.exports === null) fail(`recipe ${recipe.id}.exports 必须是对象`)
    for (const [name, exp] of Object.entries(recipe.exports)) {
      if (!exp || typeof exp !== 'object' || typeof exp.run !== 'function') {
        fail(`export ${name} 必须包含 run 函数`)
      }
    }
  }
  if (recipe.estimate !== undefined && typeof recipe.estimate !== 'function') {
    fail(`recipe ${recipe.id}.estimate 必须是函数`)
  }
  return recipe
}

function validateSchemaShape(schema, where) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) fail(`${where} 必须是对象 schema`)
}

/**
 * 合并默认值（浅合并），不修改入参。
 * @param {any} recipe
 * @param {object} [params]
 */
export function applyDefaults(recipe, params = {}) {
  return { ...(recipe.paramsDefaults || {}), ...(params || {}) }
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

function matchesType(value, expected) {
  if (Array.isArray(expected)) return expected.some((t) => matchesType(value, t))
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  return actual === expected
}

/**
 * draft-07 子集校验：type / properties / required / additionalProperties /
 * enum / const / minLength / maxLength / pattern / minimum / maximum / items。
 * @param {object|undefined} schema
 * @param {unknown} value
 * @param {string} [path]
 */
export function validateParams(schema, value, path = 'params') {
  if (!schema) return value
  const bad = (message) => {
    throw new ForgeError('BAD_PARAMS', `${path}: ${message}`, { path })
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    bad(`类型应为 ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}`)
  }
  if (schema.const !== undefined && value !== schema.const) bad(`必须等于 ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    bad(`必须是以下之一：${schema.enum.join(' / ')}`)
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      bad(`至少 ${schema.minLength} 个字符（当前 ${value.length}）`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      bad(`最多 ${schema.maxLength} 个字符（当前 ${value.length}）`)
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      bad(`不符合格式 ${schema.pattern}`)
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) bad(`不能小于 ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) bad(`不能大于 ${schema.maximum}`)
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) bad(`至少 ${schema.minItems} 项`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) bad(`最多 ${schema.maxItems} 项`)
    if (schema.items) value.forEach((item, i) => validateParams(schema.items, item, `${path}[${i}]`))
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {}
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (value[key] === undefined) bad(`缺少必填字段 ${key}`)
    }
    for (const [key, child] of Object.entries(props)) {
      if (value[key] !== undefined) validateParams(child, value[key], `${path}.${key}`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) bad(`不认识的字段 ${key}`)
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(value)) {
        if (!(key in props)) validateParams(schema.additionalProperties, value[key], `${path}.${key}`)
      }
    }
  }

  if (!path.includes('[')) {
    // anyOf / oneOf / allOf 只做最小支持，满足常见 recipe 写法
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) validateParams(sub, value, path)
    }
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some((sub) => passes(sub, value, path))) {
      bad('不匹配 anyOf 中任何一项')
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.filter((sub) => passes(sub, value, path)).length !== 1) {
      bad('必须且只能匹配 oneOf 中一项')
    }
  }

  return value
}

function passes(schema, value, path) {
  try {
    validateParams(schema, value, path)
    return true
  } catch {
    return false
  }
}

/**
 * 解析本次要跑的 stage（按 recipe 声明顺序）。
 * @param {any} recipe
 * @param {{stages?: string[], from?: string, to?: string}} [options]
 * @returns {any[]}
 */
export function normalizeStageList(recipe, options = {}) {
  const all = recipe.stages
  const index = new Map(all.map((stage, i) => [stage.id, i]))
  const opts = options || {}

  if (opts.stages !== undefined && opts.stages !== null) {
    if (!Array.isArray(opts.stages)) throw new ForgeError('BAD_PARAMS', 'stages 必须是数组')
    if (opts.from !== undefined || opts.to !== undefined) {
      throw new ForgeError('BAD_PARAMS', 'stages 与 from/to 只能二选一')
    }
    const wanted = new Set()
    for (const id of opts.stages) {
      if (typeof id !== 'string' || !index.has(id)) {
        throw new ForgeError('BAD_STAGE', `未知 stage：${String(id)}`, { stage: id })
      }
      wanted.add(id)
    }
    return all.filter((stage) => wanted.has(stage.id))
  }

  let from = 0
  let to = all.length - 1
  if (opts.from !== undefined && opts.from !== null) {
    if (!index.has(opts.from)) throw new ForgeError('BAD_STAGE', `未知起始 stage：${opts.from}`, { stage: opts.from })
    from = index.get(opts.from)
  }
  if (opts.to !== undefined && opts.to !== null) {
    if (!index.has(opts.to)) throw new ForgeError('BAD_STAGE', `未知结束 stage：${opts.to}`, { stage: opts.to })
    to = index.get(opts.to)
  }
  if (from > to) throw new ForgeError('BAD_STAGE', `from 在 to 之后：${opts.from} > ${opts.to}`)
  return all.slice(from, to + 1)
}

/** 按 key 找 recipe 里声明的 artifact（精确优先，其次首段通配）。 */
export function declaredArtifact(recipe, key) {
  const artifacts = recipe?.artifacts
  if (!artifacts) return null
  if (artifacts[key]) return artifacts[key]
  const first = String(key).split('/')[0]
  return artifacts[`${first}/*`] || null
}

/** 某个 stage 对某个 item 应该产出的具体 key 列表。 */
export function artifactKeysFor(stage, itemId) {
  const keys = Array.isArray(stage.produces) ? stage.produces : []
  if (itemId === undefined) return keys.filter((key) => !key.includes('*'))
  return keys.map((key) => (key.includes('*') ? key.replace('*', itemId) : key))
}

/** 新项目的 stage 初始状态。 */
export function initialStageState(recipe) {
  const out = {}
  for (const stage of recipe.stages) {
    out[stage.id] = stage.each ? { status: 'idle', items: {} } : { status: 'idle' }
  }
  return out
}
