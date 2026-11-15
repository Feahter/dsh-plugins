// 写作助手：把一句想法/一组文风词/一个故事核交给宿主模型做轻量改写。
// 只依赖 engine.llm.generate，不 import 任何宿主模块；HTTP 形状由 routes.js 负责。

import { ForgeError } from '../forge/errors.js'

export const ASSIST_TASKS = Object.freeze(['polish-premise', 'polish-tone', 'title'])

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
})

const TASK_MAX_TOKENS = Object.freeze({
  'polish-premise': 900,
  'polish-tone': 900,
  title: 200,
})

const TASK_LABELS = Object.freeze({
  'polish-premise': '故事核',
  'polish-tone': '文风词',
  title: '故事核',
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

const BUILDERS = Object.freeze({
  'polish-premise': buildPremisePrompt,
  'polish-tone': buildTonePrompt,
  title: buildTitlePrompt,
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
 * @param {{engine: any, task: string, text: string, genre?: string, tone?: string}} input
 * @returns {Promise<string>} 已 trim、无代码围栏的纯文本
 */
export async function runAssist({ engine, task, text, genre, tone } = {}) {
  const problem = validateAssistInput({ task, text })
  if (problem) throw invalidParams(problem)

  const llm = engine?.llm
  if (!llm || typeof llm.generate !== 'function') {
    const error = new ForgeError('LLM_UNAVAILABLE', '模型服务未就绪，请先在设置里选择模型')
    error.status = 503
    throw error
  }

  const prompt = BUILDERS[task]({ text, genre, tone })
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
