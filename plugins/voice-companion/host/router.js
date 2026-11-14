/**
 * Routing rules for voice control: decide which Session an utterance belongs to.
 *
 * Pure functions only — no I/O, no framework. The Host half feeds them the
 * Session list and this module returns a decision the Client renders and acts on.
 *
 * Design constraint (the whole point of this file): a wrong route is worse than
 * no route. Every rule that is not certain returns `action: 'ask'` with the
 * candidates it was choosing between, so the Client can read them back aloud and
 * accept an ordinal answer.
 */

/** @typedef {'new' | 'resume' | 'ask'} RouteAction */

/**
 * @typedef {object} SessionRow
 * @property {string} sessionId
 * @property {string} [title]
 * @property {number} [updatedAt]
 * @property {boolean} [blank]
 * @property {boolean} [running]
 * @property {string} [cwd]
 */

/**
 * @typedef {object} RoutePlan
 * @property {RouteAction} action
 * @property {string | null} sessionId  Target for `resume`; null for `new` and `ask`.
 * @property {{ sessionId: string, title: string, score: number }[]} candidates
 * @property {number} confidence  0..1. Below `ASK_BELOW` the action is `ask`.
 * @property {string} reason  Short human-readable why, shown in the HUD and logged.
 * @property {string} text  What to send as the prompt.
 */

/** Below this confidence we never guess. */
export const ASK_BELOW = 0.6

/** How many recent Sessions count as "the last one" / "that thing from before". */
export const RECENT_LIMIT = 3

/** Sessions untouched for longer than this are not "recent" anymore. */
const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

const NEW_PATTERNS = [
  /^(新开|新建|开个新|开一个新|开一个新的|另起|换个新)/,
  /^新会话/,
  /^(new|start a new|fresh)\b/i,
  /(新开一个|开个新的)(会话|对话|session)/,
]

const RESUME_LAST_PATTERNS = [
  /^(继续|接着|继续做|接着做|回到|回去|上次|刚才|上一个|那个|还是)/,
  /^(continue|resume|back to|the last)\b/i,
]

/** CJK runs and latin words; punctuation and fillers are dropped. */
const FILLER_TOKENS = new Set([
  '继续', '接着', '那个', '这个', '一下', '帮我', '给我', '把', '给', '在', '去', '就', '然后',
  '会话', '对话', '任务', '里面', '里头', '的', '了', '吧', '啊', '呀', '呢', '和', '跟',
  'the', 'a', 'an', 'to', 'please', 'and', 'that', 'this',
])

/**
 * Normalize one utterance for matching: full-width punctuation to spaces,
 * lower-case latin, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
export function normalizeUtterance(text) {
  return String(text ?? '')
    .replace(/[\u3000-\u303f\uff00-\uffef]/g, ' ')
    .replace(/[，。！？；：、,.!?;:"'`~()\[\]{}<>]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull the searchable tokens out of an utterance.
 *
 * Latin words are whole words; CJK has no spaces, so each run contributes its
 * bigrams (and the run itself when short). Unigrams are skipped — a single
 * character matches almost every Chinese Session title.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const normalized = normalizeUtterance(text)
  /** @type {string[]} */
  const tokens = []
  for (const chunk of normalized.split(' ')) {
    if (chunk === '') continue
    if (/^[a-z0-9][a-z0-9._-]*$/.test(chunk)) {
      if (chunk.length >= 2 && !FILLER_TOKENS.has(chunk)) tokens.push(chunk)
      continue
    }
    const runs = chunk.match(/[\u4e00-\u9fff]+/g) ?? []
    for (const run of runs) {
      if (run.length === 1) {
        if (!FILLER_TOKENS.has(run)) tokens.push(run)
        continue
      }
      for (let i = 0; i < run.length - 1; i += 1) {
        const bigram = run.slice(i, i + 2)
        if (!FILLER_TOKENS.has(bigram)) tokens.push(bigram)
      }
    }
  }
  return [...new Set(tokens)]
}

/**
 * Strip the leading "continue / go back" wording so only the topic remains.
 *
 * "回到语音控制那个会话" → "语音控制那个会话"; "继续" → "". The router uses
 * this to tell a bare "继续" (route to the most recent Session) from a
 * "回到 <topic>" that names a Session the titles do not carry.
 * @param {string} text
 * @returns {string}
 */
export function resumeTopic(text) {
  let rest = normalizeUtterance(text)
  // Peel every leading resume word, so "接着刚才那个" reduces to nothing
  // while "回到语音控制那个会话" keeps its topic after "回到".
  for (let guard = 0; guard < 8; guard += 1) {
    const next = rest.replace(/^(继续做|接着做|continue with|back to|resume|continue|继续|接着|回到|回去|上次|刚才|上一个|那个|这个|还是|the last|the)\s*/, '')
    if (next === rest) break
    rest = next
  }
  return rest.trim()
}

/**
 * Score one Session title against the utterance tokens.
 *
 * Score is the share of the utterance's signal that the title covers, damped by
 * how much of the title is unexplained: a title that matches everything wins, a
 * long title that happens to contain one bigram does not.
 * @param {string} title
 * @param {string[]} tokens
 * @returns {number} 0..1
 */
export function scoreTitle(title, tokens) {
  const normalizedTitle = normalizeUtterance(title)
  if (normalizedTitle === '' || tokens.length === 0) return 0
  let matched = 0
  for (const token of tokens) {
    if (token.length >= 2 ? normalizedTitle.includes(token) : normalizedTitle.includes(token)) {
      matched += token.length
    }
  }
  if (matched === 0) return 0
  const coverage = matched / tokens.reduce((sum, token) => sum + token.length, 0)
  const titleLength = Math.max(2, normalizedTitle.replace(/\s+/g, '').length)
  const precision = Math.min(1, matched / titleLength)
  return Number((0.7 * coverage + 0.3 * precision).toFixed(4))
}

/**
 * Does the utterance say "start something new"?
 * @param {string} text
 * @returns {boolean}
 */
export function isNewIntent(text) {
  const normalized = normalizeUtterance(text)
  if (normalized === '') return false
  return NEW_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Does the utterance point back at a previous Session instead of naming one?
 * @param {string} text
 * @returns {boolean}
 */
export function isResumeIntent(text) {
  const normalized = normalizeUtterance(text)
  if (normalized === '') return false
  return RESUME_LAST_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Drop rows a voice router must never target: archived Sessions cannot accept a
 * step, and blank Sessions have nothing to continue.
 * @param {SessionRow} row
 * @param {string[]} archivedIds
 * @returns {boolean}
 */
function isRoutable(row, archivedIds) {
  if (typeof row.sessionId !== 'string' || row.sessionId === '') return false
  if (archivedIds.includes(row.sessionId)) return false
  if (row.blank === true && !row.running) return false
  return true
}

/**
 * Order rows by "most likely the one you meant": running first, then recency,
 * then same working directory as the caller.
 * @param {SessionRow[]} rows
 * @param {{ cwd?: string, now: number }} options
 * @returns {SessionRow[]}
 */
export function rankRecent(rows, { cwd, now }) {
  return [...rows]
    .filter((row) => {
      const updatedAt = row.updatedAt ?? 0
      return now - updatedAt <= RECENT_WINDOW_MS
    })
    .sort((left, right) => {
      const leftRunning = left.running ? 1 : 0
      const rightRunning = right.running ? 1 : 0
      if (leftRunning !== rightRunning) return rightRunning - leftRunning
      const leftLocal = cwd !== undefined && left.cwd === cwd ? 1 : 0
      const rightLocal = cwd !== undefined && right.cwd === cwd ? 1 : 0
      if (leftLocal !== rightLocal) return rightLocal - leftLocal
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    })
}

/**
 * @param {SessionRow[]} rows
 * @param {{ sessionId: string, title?: string }[]} candidates
 * @returns {string}
 */
function titleOf(candidate) {
  return candidate.title && candidate.title.trim() !== '' ? candidate.title.trim() : '(无标题)'
}

/**
 * Decide where one utterance goes.
 *
 * Rule order, cheapest first:
 *  1. explicit "start a new one" → `new`
 *  2. explicit "continue / that one" → most recent routable Session
 *  3. a title that clearly matches the words → that Session
 *  4. nothing matched → stay in the current Session (never worse than the status quo)
 *  5. several titles matched about equally → `ask`
 *
 * @param {object} input
 * @param {string} input.utterance
 * @param {SessionRow[]} [input.sessions]
 * @param {string} [input.currentSessionId]
 * @param {string[]} [input.archivedIds]
 * @param {string} [input.cwd]
 * @param {number} [input.now]
 * @returns {RoutePlan}
 */
export function planRoute({
  utterance,
  sessions = [],
  currentSessionId,
  archivedIds = [],
  cwd,
  now = Date.now(),
}) {
  const text = String(utterance ?? '').trim()
  const routable = sessions.filter((row) => isRoutable(row, archivedIds))
  const recent = rankRecent(routable, { cwd, now })

  /** @type {{ sessionId: string, title: string, score: number }[]} */
  const scored = []
  const tokens = tokenize(text)
  for (const row of routable) {
    const title = row.title?.trim() ?? ''
    if (title === '') continue
    const score = scoreTitle(title, tokens)
    if (score > 0) scored.push({ sessionId: row.sessionId, title, score })
  }
  scored.sort((left, right) => right.score - left.score)
  const candidates = scored.slice(0, 3)

  if (text === '') {
    return { action: 'ask', sessionId: null, candidates, confidence: 0, reason: 'empty utterance', text }
  }

  if (isNewIntent(text)) {
    return { action: 'new', sessionId: null, candidates: [], confidence: 1, reason: 'explicit new-session wording', text }
  }

  // Two titles equally close: asking is cheaper than routing to the wrong one.
  if (candidates.length >= 2 && candidates[0].score - candidates[1].score < 0.12 && candidates[0].score >= 0.34) {
    return {
      action: 'ask',
      sessionId: null,
      candidates,
      confidence: Math.min(0.59, candidates[0].score),
      reason: `two titles match about equally (${candidates[0].score.toFixed(2)} vs ${candidates[1].score.toFixed(2)})`,
      text,
    }
  }

  if (candidates.length >= 1 && candidates[0].score >= 0.5) {
    const confidence = Math.min(0.95, 0.6 + candidates[0].score * 0.35)
    return {
      action: 'resume',
      sessionId: candidates[0].sessionId,
      candidates,
      confidence: Number(confidence.toFixed(2)),
      reason: `title matches "${titleOf(candidates[0])}" (${candidates[0].score.toFixed(2)})`,
      text,
    }
  }

  if (candidates.length >= 1 && candidates[0].score >= 0.34) {
    return {
      action: 'ask',
      sessionId: null,
      candidates,
      confidence: 0.5,
      reason: `weak title match "${titleOf(candidates[0])}" (${candidates[0].score.toFixed(2)})`,
      text,
    }
  }

  if (isResumeIntent(text)) {
    const topic = resumeTopic(text)
    // Only a locative resume ("回到 X" / "上次 X") claims X names a Session.
    // "继续，加个功能" leaves an instruction behind, not a destination, so it
    // keeps the most-recent behaviour.
    const locative = /^(回到|回去|上次|刚才|上一个|那个|还是|back to\b|the last\b)/.test(normalizeUtterance(text))
    if (locative && topic.length >= 2 && recent.length > 0) {
      // The user named something ("回到语音控制那个会话") and no title carried it:
      // guessing the most recent Session would silently talk to the wrong one.
      return {
        action: 'ask',
        sessionId: null,
        candidates: recent.slice(0, RECENT_LIMIT).map((row) => ({ sessionId: row.sessionId, title: row.title?.trim() ?? '', score: 0.3 })),
        confidence: 0.35,
        reason: `topic "${topic}" matched no Session title → asking`,
        text,
      }
    }
    const target = recent[0]
    if (target === undefined) {
      return { action: 'new', sessionId: null, candidates: [], confidence: 0.7, reason: 'no recent session to resume', text }
    }
    return {
      action: 'resume',
      sessionId: target.sessionId,
      candidates: recent.slice(0, RECENT_LIMIT).map((row) => ({ sessionId: row.sessionId, title: row.title?.trim() ?? '', score: 1 })),
      confidence: recent.length === 1 ? 0.9 : 0.7,
      reason: `"continue" wording → most recent of ${recent.length}`,
      text,
    }
  }

  if (currentSessionId !== undefined && currentSessionId !== null && currentSessionId !== '' && routable.some((row) => row.sessionId === currentSessionId)) {
    return {
      action: 'resume',
      sessionId: currentSessionId,
      candidates,
      confidence: 0.8,
      reason: 'no route signal → stayed in the current Session',
      text,
    }
  }

  const fallback = recent[0]
  if (fallback !== undefined) {
    return {
      action: 'resume',
      sessionId: fallback.sessionId,
      candidates: recent.slice(0, RECENT_LIMIT).map((row) => ({ sessionId: row.sessionId, title: row.title?.trim() ?? '', score: 1 })),
      confidence: 0.65,
      reason: 'no signal and no current Session → most recent',
      text,
    }
  }

  return { action: 'new', sessionId: null, candidates: [], confidence: 0.7, reason: 'nothing to resume', text }
}

/**
 * Turn a plan into the sentence a text-to-speech voice should read before the
 * Agent starts working, so the user hears where the utterance went.
 * @param {RoutePlan} plan
 * @returns {string}
 */
export function spokenConfirmation(plan) {
  if (plan.action === 'new') return '好，开个新会话。'
  if (plan.action === 'ask') {
    const options = plan.candidates.map((candidate, index) => `${index + 1}，${candidate.title}`)
    if (options.length === 0) return '要开新会话还是继续之前的？'
    return `你是指${options.join('；')}，还是说“新开”？`
  }
  const title = plan.candidates.find((candidate) => candidate.sessionId === plan.sessionId)?.title
  return title === undefined ? '好，接着做。' : `好，接着「${title}」。`
}

/**
 * Resolve an ordinal reply ("第一个" / "2" / "新开") against the candidates an
 * earlier `ask` announced.
 * @param {string} utterance
 * @param {{ sessionId: string, title: string }[]} candidates
 * @returns {{ action: RouteAction, sessionId: string | null, reason: string } | null} null when unrelated.
 */
export function resolveOrdinal(utterance, candidates) {
  const normalized = normalizeUtterance(utterance)
  if (normalized === '') return null
  if (isNewIntent(utterance)) return { action: 'new', sessionId: null, reason: 'ordinal reply → new session' }
  const ordinals = [
    [/^(第一个|第1个|一|1|第一个吧)$/, 1],
    [/^(第二个|第2个|二|2|第二个吧)$/, 2],
    [/^(第三个|第3个|三|3|第三个吧)$/, 3],
  ]
  for (const [pattern, index] of ordinals) {
    if (pattern.test(normalized)) {
      const target = candidates[index - 1]
      if (target === undefined) return null
      return { action: 'resume', sessionId: target.sessionId, reason: `ordinal ${index}` }
    }
  }
  return null
}
