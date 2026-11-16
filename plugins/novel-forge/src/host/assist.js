// 写作助手：把一句想法/一组文风词/一个故事核交给宿主模型做轻量改写。
// 只依赖 engine.llm.generate，不 import 任何宿主模块；HTTP 形状由 routes.js 负责。

import { ForgeError } from '../forge/errors.js'

export const ASSIST_TASKS = Object.freeze([
  'polish-premise',
  'polish-tone',
  'title',
  'polish-passage',
  'expand-scene',
])

export const ASSIST_SESSION_ID = 'dsh-forge-assist'

export const MAX_INPUT_CHARS = 4000

// 共同纪律：所有任务共用的硬约束，控制在 200 字以内。
export const ASSIST_DISCIPLINE =
  '写作纪律：只改表达，不改事实；不新增人名、事件、设定；' +
  '禁用「仿佛、似乎、不禁、缓缓、微微、一丝、嘴角勾起、眼中闪过、难以言喻」；' +
  '不用「不是…而是…」「不仅仅是…更是…」；' +
  '不解释情绪，只写能拍出来的动作和物；只输出正文，不要前言，不要用引号包裹。'

const TASK_LINES = Object.freeze({
  'polish-premise':
    '任务：把用户的一两句话故事核改得更具体、更有冲突，保留原意与人物关系；' +
    '长度不超过原文的 1.8 倍；只输出改写后的故事核，不超过 300 字。',
  'polish-tone':
    '任务：把用户给的文风词整理成一行可直接用作写作指令的短语，保持简短，' +
    '不超过 60 字；只输出这一行。',
  title:
    '任务：按故事核起 3 个书名，每个 2 到 8 字，风格克制，不用冒号和书名号；' +
    '只输出三行，每行一个，不要编号。',
  'polish-passage':
    '【任务：润色选段】你是外科医生，不是重写者：只改用户选中的这一段，选中段之外的正文一个字都不碰。\n' +
    '三条硬约束：① 不新增或改动人名、地名、专名，门派名、功法名、组织名、物件名一律照抄原文；' +
    '② 不改变既有事实与情节，人物关系、时间地点、伤势、钱物、因果、对话信息量以原文为准；' +
    '③ 严格控制在目标字数内：成稿与原文相差不超过 ±15%，超了先删自己加的修饰，不删原文信息。' +
    '允许替换句子、补一个感官细节、删一句解释、调整语序；禁止改视角、改文风、增删情节、写修改说明。' +
    '只输出润色后的这一段正文，不要前言，不要用引号包裹。',
  'expand-scene':
    '【任务：扩写场景】你是外科医生，不是重写者：把用户给的场景或一句细纲扩写成 800–1200 字成稿，骨架与结局走向沿用输入，不另起炉灶。\n' +
    '三条硬约束：① 不新增或改动人名、地名、专名，门派名、功法名、组织名、物件名一律沿用输入里的写法；' +
    '② 不改变既有事实与情节，人物关系、时间地点、伤势、钱物、因果以输入为准，没写的细节可补但不能与已知设定冲突；' +
    '③ 严格控制在目标字数内：按用户给的目标字数写，落在 800–1200 字之间，不靠解释、总结、排比凑字。' +
    '写法：一个场景要有目标、阻碍、转折、收束，用可拍出来的动作、对白与物推进，不解释情绪，不在结尾议论主题。' +
    '文风按 tone；只输出成稿正文，不要标题、不要分点、不要说明。',
})

const TASK_MAX_TOKENS = Object.freeze({
  'polish-premise': 900,
  'polish-tone': 900,
  title: 200,
  // 输入上限 4000 字，输出与原文同量级；4000 与仓库默认输出上限 4096 同量级。
  'polish-passage': 4000,
  // 目标成稿 800–1200 字，留一倍余量给推理与对白。
  'expand-scene': 3000,
})

const TASK_LABELS = Object.freeze({
  'polish-premise': '故事核',
  'polish-tone': '文风词',
  title: '故事核',
  'polish-passage': '选中段',
  'expand-scene': '场景或细纲',
})

function systemFor(task) {
  return `${ASSIST_DISCIPLINE}\n${TASK_LINES[task]}`
}

function userFor(task, { text, genre, tone }) {
  const lines = [`${TASK_LABELS[task]}：`, String(text)]
  // 只有 polish 类带体裁/文风；title 只看故事核。
  if (task !== 'title') {
    if (typeof genre === 'string' && genre.trim()) lines.push(`体裁：${genre.trim()}`)
    if (typeof tone === 'string' && tone.trim()) lines.push(`文风：${tone.trim()}`)
  }
  return lines.join('\n')
}

/** 与 craft.js / index.js 一致的字数口径：去掉所有空白后按字符计。 */
function charCount(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

/** 扩写目标字数收敛到需求区间 800–1200，缺省 800。 */
function expansionTarget(targetChars) {
  const value = Number(targetChars)
  if (!Number.isFinite(value)) return 800
  return Math.min(1200, Math.max(800, Math.round(value)))
}

function passageUser({ text, intent, genre, tone }) {
  const chars = charCount(text)
  const low = Math.max(1, Math.floor(chars * 0.85))
  const high = Math.ceil(chars * 1.15)
  const lines = [`${TASK_LABELS['polish-passage']}：`, String(text)]
  if (typeof genre === 'string' && genre.trim()) lines.push(`体裁：${genre.trim()}`)
  if (typeof tone === 'string' && tone.trim()) lines.push(`文风：${tone.trim()}`)
  if (typeof intent === 'string' && intent.trim()) lines.push(`润色意图：${intent.trim()}`)
  lines.push(`目标字数：原文 ${chars} 字，成稿 ${low}–${high} 字（±15%）`)
  return lines.join('\n')
}

function expandUser({ text, targetChars, genre, tone }) {
  const target = expansionTarget(targetChars)
  const lines = [`${TASK_LABELS['expand-scene']}：`, String(text)]
  if (typeof genre === 'string' && genre.trim()) lines.push(`体裁：${genre.trim()}`)
  if (typeof tone === 'string' && tone.trim()) lines.push(`文风：${tone.trim()}`)
  lines.push(`目标字数：${target} 字（正文落在 800–1200 字之间）`)
  return lines.join('\n')
}

export function buildPremisePrompt(input = {}) {
  return {
    system: systemFor('polish-premise'),
    user: userFor('polish-premise', input),
    maxTokens: TASK_MAX_TOKENS['polish-premise'],
  }
}

export function buildTonePrompt(input = {}) {
  return {
    system: systemFor('polish-tone'),
    user: userFor('polish-tone', input),
    maxTokens: TASK_MAX_TOKENS['polish-tone'],
  }
}

export function buildTitlePrompt(input = {}) {
  return {
    system: systemFor('title'),
    user: userFor('title', input),
    maxTokens: TASK_MAX_TOKENS.title,
  }
}

export function buildPassagePrompt(input = {}) {
  return {
    system: systemFor('polish-passage'),
    user: passageUser(input),
    maxTokens: TASK_MAX_TOKENS['polish-passage'],
  }
}

export function buildExpandPrompt(input = {}) {
  return {
    system: systemFor('expand-scene'),
    user: expandUser(input),
    maxTokens: TASK_MAX_TOKENS['expand-scene'],
  }
}

const BUILDERS = Object.freeze({
  'polish-premise': buildPremisePrompt,
  'polish-tone': buildTonePrompt,
  title: buildTitlePrompt,
  'polish-passage': buildPassagePrompt,
  'expand-scene': buildExpandPrompt,
})

/**
 * 校验接口参数，返回人读的错误文案；合法时返回 null。
 * 路由层据此抛 httpError，runAssist 直接调用时也能复用。
 */
export function validateAssistInput({ task, text } = {}) {
  if (!ASSIST_TASKS.includes(task)) return '不支持的写作任务'
  if (typeof text !== 'string' || text.trim() === '') return 'text 不能为空'
  if (text.length > MAX_INPUT_CHARS) return `text 太长（上限 ${MAX_INPUT_CHARS} 字）`
  return null
}

function invalidParams(message) {
  const error = new Error(message)
  error.status = 400
  error.code = 'invalid_params'
  return error
}

/** 去掉模型偶尔包上的 Markdown 代码围栏，只留正文。 */
function unwrapFence(raw) {
  const text = String(raw ?? '').trim()
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  return match ? match[1].trim() : text
}

/**
 * 执行一次写作辅助。
 * @param {{engine: any, task: string, text: string, genre?: string, tone?: string,
 *   intent?: string, targetChars?: number}} input
 * @returns {Promise<string>} 已 trim、无代码围栏的纯文本
 */
export async function runAssist({ engine, task, text, genre, tone, intent, targetChars } = {}) {
  const problem = validateAssistInput({ task, text })
  if (problem) throw invalidParams(problem)

  const llm = engine?.llm
  if (!llm || typeof llm.generate !== 'function') {
    const error = new ForgeError('LLM_UNAVAILABLE', '模型服务未就绪，请先在设置里选择模型')
    error.status = 503
    throw error
  }

  const prompt = BUILDERS[task]({ text, genre, tone, intent, targetChars })
  const result = await llm.generate({
    system: prompt.system,
    user: prompt.user,
    maxTokens: prompt.maxTokens,
    sessionId: ASSIST_SESSION_ID,
  })

  const cleaned = unwrapFence(result?.text)
  if (!cleaned) throw new ForgeError('LLM_EMPTY', '模型没有返回可用内容')
  return cleaned
}

// 常见的人名延长字：用来识别「沈砚」被写成「沈砚之」这类改名。
// 只收窄口径的姓名后缀，宁可漏报也不把「沈砚说」误判成改名。
const NAME_EXTENSION_CHARS = new Set(['之', '氏', '子', '儿', '君', '郎'])

/** 名字在 text 中是否作为独立专名出现（避免「沈砚」命中「沈砚之」）。 */
function hasName(text, name) {
  let from = 0
  while (from <= text.length) {
    const at = text.indexOf(name, from)
    if (at === -1) return false
    const next = text.slice(at + name.length, at + name.length + 1)
    if (!NAME_EXTENSION_CHARS.has(next)) return true
    from = at + 1
  }
  return false
}

/**
 * 扩写成稿的确定性验收：字数区间 + 专名保持。不调模型。
 * @param {string} text 成稿正文
 * @param {{minChars?: number, maxChars?: number, names?: string[]}} [options]
 *   names 由调用方从原文抽取；原文有、成稿没有的专名进 missingNames。
 * @returns {{ok: boolean, chars: number, outside: string[], missingNames: string[]}}
 *   outside 取值 'below-min' / 'above-max'；chars 按去空白字符数计（与 craft.js 一致）。
 */
export function checkExpansion(text, { minChars = 800, maxChars = 1200, names = [] } = {}) {
  const body = String(text ?? '')
  const chars = body.replace(/\s+/g, '').length
  const outside = []
  if (chars < minChars) outside.push('below-min')
  if (chars > maxChars) outside.push('above-max')
  const wanted = [...new Set(
    (Array.isArray(names) ? names : [])
      .map(name => String(name ?? '').trim())
      .filter(Boolean),
  )]
  const missingNames = wanted.filter(name => !hasName(body, name))
  return { ok: outside.length === 0 && missingNames.length === 0, chars, outside, missingNames }
}
