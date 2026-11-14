/**
 * Persona and decision parsing for 大肥鱼.
 *
 * The brain only ever returns one JSON object. Everything here is defensive:
 * models sometimes wrap JSON in a fence, prepend a sentence, or drift off
 * protocol, and a phone call should never crash because of that.
 */

export const PERSONA_NAME = '大肥鱼'
export const DEFAULT_MODEL = 'deepseek-flash'
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const MAX_SENTENCE_CHARS = 30
export const DEFAULT_SAY = '嗯，我在。'
export const DEFAULT_TASK_SAY = '好，我去办，办完叫你。'

const SYSTEM_PROMPT = `你是「大肥鱼」，老板的语音管家，你们正在打电话。
说话规则：
- 像熟人打电话，短句、口语、有温度，别端着。
- 每句话不超过 30 个字，一句说完就停，别一口气说一长串。
- 不说「作为 AI」「我是人工智能」这类话，也不解释自己的设定。
- 老板让你做事时，先用一句「好，我去办，办完叫你。」接住，别让他干等。
- 你不知道说什么就简单应一声，别硬聊。

回复格式：只回一个 JSON 对象，不要 Markdown，不要多余解释。
普通聊天：{"say":"你要说的话"}
需要派活：{"say":"你要说的话","task":{"title":"不超过 12 个字的短标题","text":"给执行助手的完整任务描述"}}
派活时 title 用于播报，text 要写清目标、范围与验收标准。`

const FEW_SHOT = [
  {
    user: '今天有点累。',
    assistant: '{"say":"累了就早点歇着，我在这儿。"}',
  },
  {
    user: '帮我把登录页的文案改得口语一点。',
    assistant: '{"say":"好，我去办，办完叫你。","task":{"title":"改登录页文案","text":"把登录页的文案改得更口语、更像人说话，保留原有信息，改完告诉我改了哪些地方。"}}',
  },
]

/**
 * @param {unknown} value
 * @returns {string}
 */
function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max).trim()
}

/**
 * @param {unknown} value
 * @returns {{ title: string, text: string } | null}
 */
function normalizeTask(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? null : { title: truncate(text, 12), text }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const text = asTrimmedString(value.text)
  const title = asTrimmedString(value.title)
  if (text === '' && title === '') return null
  return {
    title: truncate(title || text, 12) || '新任务',
    text: text || title,
  }
}

/**
 * Parse a model reply into `{ say, task }`.
 *
 * Tolerates ```json fences, prose before/after the object, missing fields and
 * entirely invalid JSON (the whole reply then becomes `say`).
 * @param {unknown} rawText
 * @returns {{ say: string, task: { title: string, text: string } | null }}
 */
export function parseDecision(rawText) {
  const raw = asTrimmedString(rawText)
  if (raw === '') return { say: DEFAULT_SAY, task: null }

  /** @type {string[]} */
  const candidates = []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  if (fenced !== null) candidates.push(fenced[1].trim())
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1))
  candidates.push(raw)

  for (const candidate of candidates) {
    let parsed
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const say = asTrimmedString(parsed.say)
    const task = normalizeTask(parsed.task)
    // A JSON object with neither a say nor a task is not a decision; falling
    // through keeps the original text audible instead of going silent.
    if (say === '' && task === null) continue
    return {
      say: say || (task === null ? DEFAULT_SAY : DEFAULT_TASK_SAY),
      task,
    }
  }

  return { say: raw, task: null }
}

/**
 * Split spoken text into sentence-sized chunks for TTS.
 *
 * Splits on Chinese and English terminal punctuation, then breaks any chunk
 * longer than `MAX_SENTENCE_CHARS` at a comma/space near the limit.
 * @param {unknown} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const source = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (source === '') return []

  const pieces = source
    .split(/(?<=[。！？!?；;…])|(?<=[.!?])\s+/u)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')

  /** @type {string[]} */
  const output = []
  for (const piece of pieces) {
    if (piece.length <= MAX_SENTENCE_CHARS) {
      output.push(piece)
      continue
    }
    let rest = piece
    while (rest.length > MAX_SENTENCE_CHARS) {
      let cut = -1
      for (let index = MAX_SENTENCE_CHARS; index > 8; index -= 1) {
        if (/[，,、：:\s]/.test(rest[index] ?? '')) {
          cut = Math.min(index + 1, MAX_SENTENCE_CHARS)
          break
        }
      }
      if (cut <= 0) cut = MAX_SENTENCE_CHARS
      const head = rest.slice(0, cut).trim()
      if (head !== '') output.push(head)
      rest = rest.slice(cut).trim()
    }
    if (rest !== '') output.push(rest)
  }
  return output
}

/**
 * Build the chat-completions message list.
 * @param {object} input
 * @param {unknown} input.utterance
 * @param {unknown} [input.history]
 * @param {unknown} [input.sessionTitles]
 * @returns {Array<{ role: 'system' | 'user' | 'assistant', content: string }>}
 */
export function buildMessages({ utterance, history = [], sessionTitles = [] } = {}) {
  /** @type {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} */
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]

  const titles = Array.isArray(sessionTitles)
    ? sessionTitles
        .map((title) => asTrimmedString(title))
        .filter((title) => title !== '')
        .slice(0, 12)
    : []
  if (titles.length > 0) {
    messages.push({
      role: 'system',
      content: `老板最近的会话：${titles.join('、')}。他提到「那个」时，可能指其中一个。`,
    })
  }

  for (const example of FEW_SHOT) {
    messages.push({ role: 'user', content: example.user })
    messages.push({ role: 'assistant', content: example.assistant })
  }

  if (Array.isArray(history)) {
    for (const entry of history.slice(-8)) {
      if (entry === null || typeof entry !== 'object') continue
      const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : undefined
      const content = asTrimmedString(entry.content)
      if (role === undefined || content === '') continue
      messages.push({ role, content: truncate(content, 500) })
    }
  }

  messages.push({ role: 'user', content: asTrimmedString(utterance) })
  return messages
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
function brainError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string | (() => string | Promise<string | undefined> | undefined)} [options.apiKey]
 * @param {string} [options.model]
 * @param {string} [options.baseUrl]
 */
export function createBrain({
  fetchImpl = globalThis.fetch,
  apiKey,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createBrain needs a fetch implementation')

  async function readKey() {
    const value = typeof apiKey === 'function' ? await apiKey() : apiKey
    return typeof value === 'string' ? value.trim() : ''
  }

  return {
    /**
     * @param {{ utterance?: unknown, history?: unknown, sessionTitles?: unknown }} [input]
     * @returns {Promise<{ say: string, task: { title: string, text: string } | null }>}
     */
    async decide({ utterance, history, sessionTitles } = {}) {
      const text = asTrimmedString(utterance)
      if (text === '') throw brainError(400, 'invalid', 'utterance 不能为空')
      const key = await readKey()
      if (key === '') throw brainError(503, 'service-missing', '没有配置 DeepSeek API key')

      const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`
      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: buildMessages({ utterance: text, history, sessionTitles }),
            stream: false,
            temperature: 0.6,
            max_tokens: 300,
          }),
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw brainError(502, 'upstream', `连不上模型服务：${detail}`)
      }

      if (!response.ok) {
        let detail = ''
        try {
          detail = (await response.text()).slice(0, 200)
        } catch {
          detail = ''
        }
        throw brainError(
          502,
          'upstream',
          `模型服务返回 HTTP ${response.status}${detail === '' ? '' : `：${detail}`}`,
        )
      }

      let payload
      try {
        payload = await response.json()
      } catch {
        throw brainError(502, 'upstream', '模型返回的不是 JSON')
      }

      const content = payload?.choices?.[0]?.message?.content
      const raw =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((part) =>
                  typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '',
                )
                .join('')
            : ''
      if (raw.trim() === '') throw brainError(502, 'upstream', '模型返回了空回复')

      return parseDecision(raw)
    },
  }
}
