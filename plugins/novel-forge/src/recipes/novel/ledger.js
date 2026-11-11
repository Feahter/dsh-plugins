// ledger.js — 连续性账本：初始化、合并 patch、压缩成 prompt 文本、人物速查。
// 契约：docs/architecture.md §4.2 / §4.4（ledger JSON 形状）。
// 原则：模型给的 id 不可信（由本模块发号）；文本去重；总数封顶，避免账本无限膨胀。

const LIMITS = {
  facts: 80,
  threads: 60,
  timeline: 120,
  characters: 40,
}

const TRUNCATED = '…（已截断）'

const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

function clip(text, maxChars) {
  const value = String(text ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0) return value
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - TRUNCATED.length))}${TRUNCATED}`
}

function nextId(prefix, items) {
  let max = 0
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  for (const item of items ?? []) {
    const matched = String(item?.id ?? '').match(pattern)
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function pushUnique(list, value) {
  const text = norm(value)
  if (!text) return false
  if (list.some((item) => norm(item) === text)) return false
  list.push(text)
  return true
}

/**
 * 初始化账本。outline 的章级 hook 开成「未回收线索」，goal 进时间线。
 * @returns {{facts:Array, threads:Array, characters:object, timeline:Array, canonRules:string[]}}
 */
export function createLedger({ brief = {}, outline = {}, params = {} } = {}) {
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  const firstChapter = chapters[0]?.id ?? 'ch01'
  const ledger = {
    facts: [],
    threads: [],
    characters: {},
    timeline: [],
    canonRules: [],
  }

  const factTexts = []
  if (params.title) factTexts.push(`书名《${norm(params.title)}》`)
  if (brief.title && !params.title) factTexts.push(`书名《${norm(brief.title)}》`)
  if (brief.logline) factTexts.push(`故事核：${norm(brief.logline)}`)
  if (brief.theme) factTexts.push(`主题：${norm(brief.theme)}`)
  if (brief.promise) factTexts.push(`类型承诺：${norm(brief.promise)}`)
  if (brief.ending) factTexts.push(`结局方向：${norm(brief.ending)}`)
  for (const text of factTexts) {
    ledger.facts.push({
      id: nextId('f', ledger.facts),
      text,
      chapter: firstChapter,
      status: 'canon',
    })
  }

  for (const chapter of chapters) {
    const hook = norm(chapter.hook)
    if (hook) {
      ledger.threads.push({
        id: nextId('t', ledger.threads),
        text: `${chapter.id} 钩子：${hook}`,
        opened: chapter.id || firstChapter,
        status: 'open',
        closedIn: null,
      })
    }
    const event = norm(chapter.goal || chapter.title)
    if (event) {
      ledger.timeline.push({
        chapter: chapter.id || firstChapter,
        when: norm(chapter.when),
        event,
      })
    }
  }

  const rules = []
  if (params.pov) rules.push(`视角：${norm(params.pov)}`)
  if (params.language) rules.push(`语言：${norm(params.language)}`)
  if (params.genre) rules.push(`类型：${norm(params.genre)}`)
  if (params.seed) rules.push(`母题：${norm(params.seed)}`)
  ledger.canonRules = rules

  return ledger
}

/** 空账本（review 阶段碰到缺失 ledger 时兜底）。 */
export function emptyLedger() {
  return { facts: [], threads: [], characters: {}, timeline: [], canonRules: [] }
}

function mergeFacts(ledger, patchFacts, chapterId) {
  for (const raw of patchFacts ?? []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const text = norm(entry.text)
    if (!text) continue
    const existing = ledger.facts.find((fact) => norm(fact.text) === text)
    if (existing) {
      if (entry.status) existing.status = norm(entry.status)
      if (entry.chapter) existing.chapter = norm(entry.chapter)
      continue
    }
    ledger.facts.push({
      id: nextId('f', ledger.facts),
      text,
      chapter: norm(entry.chapter) || chapterId,
      status: norm(entry.status) || 'open',
    })
  }
}

function mergeThreads(ledger, patchThreads, chapterId) {
  for (const raw of patchThreads ?? []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const text = norm(entry.text)
    const wantsClosed = norm(entry.status) === 'closed' || Boolean(entry.closedIn)
    let target = null
    const byId = norm(entry.id)
    if (byId) target = ledger.threads.find((thread) => thread.id === byId) ?? null
    if (!target && text) {
      target =
        ledger.threads.find((thread) => norm(thread.text) === text) ??
        (wantsClosed
          ? ledger.threads.find(
              (thread) => thread.status === 'open' && (text.includes(norm(thread.text)) || norm(thread.text).includes(text)),
            )
          : null) ??
        null
    }
    if (target) {
      if (wantsClosed) {
        target.status = 'closed'
        target.closedIn = norm(entry.closedIn) || chapterId
      } else if (text && norm(target.text) !== text && text.length > norm(target.text).length) {
        target.text = text
      }
      continue
    }
    if (!text) continue
    ledger.threads.push({
      id: nextId('t', ledger.threads),
      text,
      opened: norm(entry.opened) || chapterId,
      status: wantsClosed ? 'closed' : norm(entry.status) || 'open',
      closedIn: wantsClosed ? norm(entry.closedIn) || chapterId : null,
    })
  }
}

function mergeCharacters(ledger, patchCharacters) {
  if (!patchCharacters || typeof patchCharacters !== 'object' || Array.isArray(patchCharacters)) return
  for (const [rawName, rawState] of Object.entries(patchCharacters)) {
    const name = norm(rawName)
    if (!name || !rawState || typeof rawState !== 'object') continue
    const current = ledger.characters[name] ?? { location: '', state: '', knows: [] }
    const next = {
      location: rawState.location != null ? norm(rawState.location) : current.location,
      state: rawState.state != null ? norm(rawState.state) : current.state,
      knows: [...new Set([...(current.knows ?? []), ...(rawState.knows ?? []).map(norm).filter(Boolean)])],
    }
    ledger.characters[name] = next
  }
}

function mergeTimeline(ledger, patchTimeline, chapterId) {
  for (const raw of patchTimeline ?? []) {
    const entry = typeof raw === 'string' ? { event: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const event = norm(entry.event)
    if (!event) continue
    const chapter = norm(entry.chapter) || chapterId
    const duplicate = ledger.timeline.some(
      (item) => norm(item.chapter) === chapter && norm(item.event) === event,
    )
    if (duplicate) continue
    ledger.timeline.push({ chapter, when: norm(entry.when), event })
  }
}

function applyLimits(ledger) {
  if (ledger.facts.length > LIMITS.facts) {
    const open = ledger.facts.filter((fact) => norm(fact.status) !== 'closed')
    const closed = ledger.facts.filter((fact) => norm(fact.status) === 'closed')
    const keepClosed = Math.max(0, LIMITS.facts - open.length)
    ledger.facts = [...open.slice(-(LIMITS.facts - keepClosed)), ...closed.slice(-keepClosed)].slice(-LIMITS.facts)
  }
  if (ledger.threads.length > LIMITS.threads) {
    const open = ledger.threads.filter((thread) => thread.status !== 'closed')
    const closed = ledger.threads.filter((thread) => thread.status === 'closed')
    const keepClosed = Math.max(0, LIMITS.threads - open.length)
    ledger.threads = [...open.slice(-(LIMITS.threads - keepClosed)), ...closed.slice(-keepClosed)].slice(
      -LIMITS.threads,
    )
  }
  if (ledger.timeline.length > LIMITS.timeline) {
    ledger.timeline = ledger.timeline.slice(-LIMITS.timeline)
  }
  const names = Object.keys(ledger.characters ?? {})
  if (names.length > LIMITS.characters) {
    ledger.characters = Object.fromEntries(names.slice(-LIMITS.characters).map((name) => [name, ledger.characters[name]]))
  }
}

/**
 * 把 review 的 ledgerPatch 合并进账本。不修改入参，返回新账本。
 * @param {object} ledger
 * @param {object} patch {facts?, threads?, characters?, timeline?, canonRules?}
 * @param {string} chapterId
 */
export function mergeLedger(ledger, patch = {}, chapterId = '') {
  const base = ledger && typeof ledger === 'object' ? clone(ledger) : emptyLedger()
  base.facts ??= []
  base.threads ??= []
  base.timeline ??= []
  base.canonRules ??= []
  base.characters ??= {}
  if (!patch || typeof patch !== 'object') return base

  mergeFacts(base, patch.facts, chapterId)
  mergeThreads(base, patch.threads, chapterId)
  mergeCharacters(base, patch.characters)
  mergeTimeline(base, patch.timeline, chapterId)
  for (const rule of patch.canonRules ?? []) pushUnique(base.canonRules, rule)

  applyLimits(base)
  return base
}

/**
 * 账本压缩成 prompt 文本。按重要度拼：正典 → 未回收线索 → 事实 → 人物 → 时间线；
 * 超预算时从后往前丢（人物速查、时间线先被砍）。
 */
export function slimLedger(ledger, { maxChars = 3000 } = {}) {
  const safe = ledger && typeof ledger === 'object' ? ledger : {}
  const lines = []

  const rules = (safe.canonRules ?? []).map(norm).filter(Boolean)
  if (rules.length) {
    lines.push('【正典】')
    for (const rule of rules) lines.push(`- ${rule}`)
  }

  const threads = Array.isArray(safe.threads) ? safe.threads : []
  const openThreads = threads.filter((thread) => thread && thread.status !== 'closed')
  if (openThreads.length) {
    lines.push('【未回收线索】')
    for (const thread of openThreads) {
      lines.push(`- ${thread.id ?? ''} [${thread.opened ?? '?'}] ${norm(thread.text)}`.replace(/\s+/g, ' '))
    }
  }

  const facts = Array.isArray(safe.facts) ? safe.facts : []
  const activeFacts = facts.filter((fact) => fact && norm(fact.status) !== 'closed')
  if (activeFacts.length) {
    lines.push('【已确立事实】')
    for (const fact of activeFacts) {
      lines.push(`- [${fact.chapter ?? '?'}] ${norm(fact.text)}`)
    }
  }

  const characters = safe.characters && typeof safe.characters === 'object' ? safe.characters : {}
  const names = Object.keys(characters)
  if (names.length) {
    lines.push('【人物状态】')
    for (const name of names) {
      const state = characters[name] ?? {}
      const knows = Array.isArray(state.knows) ? state.knows.map(norm).filter(Boolean) : []
      const parts = [
        state.location ? `在${norm(state.location)}` : '',
        state.state ? norm(state.state) : '',
        knows.length ? `知道：${knows.join('、')}` : '',
      ].filter(Boolean)
      lines.push(`- ${name}：${parts.join('；') || '（未记录）'}`)
    }
  }

  const timeline = Array.isArray(safe.timeline) ? safe.timeline : []
  if (timeline.length) {
    lines.push('【时间线】')
    for (const entry of timeline.slice(-12)) {
      const when = norm(entry.when)
      lines.push(`- ${entry.chapter ?? '?'}｜${when || '—'}｜${norm(entry.event)}`)
    }
  }

  const budget = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 3000
  let out = ''
  let truncated = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const next = out ? `${out}\n${line}` : line
    if (next.length > budget) {
      truncated = true
      break
    }
    out = next
  }
  if (!out) return clip(lines[0] ?? '', budget)
  if (truncated) {
    const room = budget - TRUNCATED.length - 1
    if (room > 0) out = `${out.slice(0, room)}${TRUNCATED}`
  }
  return out
}

/**
 * 人物速查。characters 可以是 characters 产物的 cast 数组，也可以是 ledger.characters 映射。
 * @param {Array|object} characters
 * @param {string[]} names 只取这些名字（空则全取，最多 8 个）
 * @param {number} maxChars
 */
export function characterBrief(characters, names = [], maxChars = 1500) {
  let list = []
  if (Array.isArray(characters)) {
    list = characters.filter((item) => item && typeof item === 'object')
  } else if (characters && typeof characters === 'object') {
    list = Object.entries(characters).map(([name, state]) => ({ name, ...(state ?? {}) }))
  }

  const wanted = Array.isArray(names) ? names.map(norm).filter(Boolean) : []
  const wantedSet = new Set(wanted)
  let picked = wanted.length ? list.filter((item) => wantedSet.has(norm(item.name))) : list
  if (!picked.length) picked = list
  picked = picked.slice(0, 8)

  const lines = []
  for (const person of picked) {
    const name = norm(person.name)
    if (!name) continue
    if (person.role != null || person.want != null || person.arc != null) {
      const parts = [
        person.role ? norm(person.role) : '',
        person.want ? `想要：${norm(person.want)}` : '',
        person.fear ? `怕：${norm(person.fear)}` : '',
        person.secret ? `秘密：${norm(person.secret)}` : '',
        person.voice ? `说话：${norm(person.voice)}` : '',
      ].filter(Boolean)
      lines.push(`- ${name}（${parts.join('；') || '—'}）`)
    } else {
      const knows = Array.isArray(person.knows) ? person.knows.map(norm).filter(Boolean) : []
      const parts = [
        person.location ? `在${norm(person.location)}` : '',
        person.state ? norm(person.state) : '',
        knows.length ? `知道：${knows.join('、')}` : '',
      ].filter(Boolean)
      lines.push(`- ${name}：${parts.join('；') || '（未记录）'}`)
    }
  }
  return clip(lines.join('\n'), maxChars)
}

export { LIMITS }
