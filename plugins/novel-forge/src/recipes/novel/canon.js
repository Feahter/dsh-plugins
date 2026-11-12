// canon.js — 连续性正典（canon v2）：建库、增量合并、确定性检索、格式化与自检。
// 契约：docs/architecture-v2.md §4（§4.1 形状 / §4.2 导出 / §4.3 迁移 / §4.4 patch）。
// 原则：
//   1. 账本只增不减 —— 数量多不是丢弃的理由，淘汰只发生在喂给模型的切片里。
//   2. 全部纯函数、零 IO、不调模型；同输入同输出，便于测试与 agent 断点续跑。
//   3. 模型给的 id 不可信，但 patch 里的线索 id 是唯一能指向既有线索的句柄，按 §4.4 采用。

export const CANON_VERSION = 2

const TRUNCATED_TEXT = '…（已截断）'
const DEFAULT_LIMIT = 48
// rules / invariants 不参与打分，只有独立上限（§4.2 规则 4）。
const RULES_LIMIT = 40
const RECENT_WINDOW = 20

// 死亡判定只认这三类谓词（§4.2 / §4.4）。
const DEATH_PREDICATES = new Set(['状态', '生死', '结局'])
const DEATH_WORDS = /[死亡殁]/

const clone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

const cmpStr = (a, b) => {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** 章节 id 里的数字序号；解析不出来按「最久远」处理（-1）。 */
function chapterNumber(id) {
  const matched = String(id ?? '').match(/\d+/)
  return matched ? Number(matched[0]) : -1
}

/** 两章之间的绝对距离；任一章无法解析时视为不相关。 */
function chapterDistance(from, to) {
  const a = chapterNumber(from)
  const b = chapterNumber(to)
  if (a < 0 || b < 0) return Infinity
  return Math.abs(a - b)
}

function isRecent(chapter, atChapter, window = RECENT_WINDOW) {
  const distance = chapterDistance(chapter, atChapter)
  return Number.isFinite(distance) && distance <= window
}

function isAtOrBefore(chapter, atChapter) {
  if (!atChapter) return true
  const a = chapterNumber(chapter)
  const b = chapterNumber(atChapter)
  if (a < 0 || b < 0) return true
  return a <= b
}

function uniqueStrings(values) {
  const out = []
  const seen = new Set()
  for (const value of values ?? []) {
    const text = norm(value)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function nextId(prefix, items, width = 4) {
  let max = 0
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  for (const item of items ?? []) {
    const matched = String(item?.id ?? '').match(pattern)
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}

function blankEntity(kind = 'character') {
  return {
    kind,
    gender: '',
    role: '',
    aliases: [],
    firstSeen: '',
    lastSeen: '',
    location: '',
    state: '',
    knows: [],
    relations: [],
  }
}

// ---------------------------------------------------------------- 建库

/** 空正典。 */
export function emptyCanon() {
  return {
    version: CANON_VERSION,
    rules: [],
    facts: [],
    notes: [],
    threads: [],
    entities: {},
    timeline: [],
    invariants: [],
  }
}

function characterEntries(characters) {
  if (!characters) return []
  if (Array.isArray(characters)) {
    return characters.filter((item) => item && typeof item === 'object' && norm(item.name))
  }
  if (Array.isArray(characters.cast)) return characterEntries(characters.cast)
  if (typeof characters === 'object') {
    return Object.entries(characters).map(([name, state]) => ({
      name,
      ...(state && typeof state === 'object' ? state : {}),
    }))
  }
  return []
}

function entityFromCharacter(person) {
  const entity = blankEntity('character')
  entity.gender = norm(person.gender)
  entity.role = norm(person.role)
  entity.aliases = uniqueStrings(person.aliases)
  entity.firstSeen = norm(person.firstSeen)
  entity.lastSeen = norm(person.lastSeen)
  entity.location = norm(person.location)
  entity.state = norm(person.state)
  entity.knows = uniqueStrings(person.knows)
  entity.relations = normalizeRelations(person.relations)
  return entity
}

function normalizeRelations(relations) {
  const out = []
  for (const raw of Array.isArray(relations) ? relations : []) {
    if (!raw || typeof raw !== 'object') continue
    const to = norm(raw.to)
    if (!to) continue
    const kind = norm(raw.kind)
    if (out.some((item) => item.to === to && item.kind === kind)) continue
    out.push({ to, kind })
  }
  return out
}

/**
 * 从 brief / 人物档案 / 参数 / 卷纲建初始正典。
 * 自由文本（故事核、主题等）不是三元组，按 §4.1 归入 notes；人物档案成为实体种子。
 */
export function createCanon({ brief = {}, characters = null, params = {}, spine = {} } = {}) {
  const canon = emptyCanon()

  const rules = []
  if (params.pov) rules.push(`视角：${norm(params.pov)}`)
  if (params.language) rules.push(`语言：${norm(params.language)}`)
  if (params.genre) rules.push(`类型：${norm(params.genre)}`)
  if (params.seed) rules.push(`母题：${norm(params.seed)}`)
  canon.rules = uniqueStrings(rules)

  const noteTexts = []
  const title = norm(params.title) || norm(brief.title)
  if (title) noteTexts.push(`书名《${title}》`)
  if (brief.logline) noteTexts.push(`故事核：${norm(brief.logline)}`)
  if (brief.theme) noteTexts.push(`主题：${norm(brief.theme)}`)
  if (brief.promise) noteTexts.push(`类型承诺：${norm(brief.promise)}`)
  if (brief.ending) noteTexts.push(`结局方向：${norm(brief.ending)}`)

  let noteSeq = 0
  for (const text of uniqueStrings(noteTexts)) {
    noteSeq += 1
    canon.notes.push({
      id: `n${String(noteSeq).padStart(4, '0')}`,
      text,
      chapter: '',
      status: 'canon',
      tags: ['brief'],
    })
  }

  for (const person of characterEntries(characters)) {
    const name = norm(person.name)
    if (!name || canon.entities[name]) continue
    canon.entities[name] = entityFromCharacter(person)
  }

  // 卷纲里的开线/收线先落成线索，卷目标落时间线；后续章节里的具体线索再增量合并。
  const volumes = Array.isArray(spine?.volumes) ? spine.volumes : []
  for (const volume of volumes) {
    if (!volume || typeof volume !== 'object') continue
    const volumeId = norm(volume.id)
    const openings = Array.isArray(volume.opens) ? volume.opens : volume.opens ? [volume.opens] : []
    for (const raw of openings) {
      const text = norm(raw)
      if (!text) continue
      canon.threads.push({
        id: nextId('t', canon.threads, 2),
        text,
        opened: volumeId,
        status: 'open',
        closedIn: null,
        payoff: '',
      })
    }
    const event = norm(volume.goal) || norm(volume.title)
    if (event) {
      canon.timeline.push({ chapter: volumeId, when: '', event })
    }
  }

  return canon
}

// ---------------------------------------------------------------- 合并

function factKey(fact) {
  return `${norm(fact.s)}|${norm(fact.p)}|${norm(fact.o)}`
}

function factGroupKey(fact) {
  return `${norm(fact.s)}|${norm(fact.p)}`
}

/** 同 s|p 不同 o 的两条正典事实都保留，并派生 conflict 标记（不覆盖任何一条）。 */
function markConflicts(facts) {
  const groups = new Map()
  for (const fact of facts) {
    if (norm(fact.status) !== 'canon') continue
    const key = factGroupKey(fact)
    if (!groups.has(key)) groups.set(key, new Map())
    groups.get(key).set(norm(fact.o), true)
  }
  for (const fact of facts) {
    const key = factGroupKey(fact)
    const conflict =
      norm(fact.status) === 'canon' && (groups.get(key)?.size ?? 0) > 1
    if (conflict) fact.conflict = true
    else delete fact.conflict
  }
}

function mergeFacts(canon, entries, chapter) {
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const s = norm(entry.s)
    const p = norm(entry.p)
    const o = norm(entry.o)
    if (!s || !p || !o) {
      // 非三元组不能进 facts（§4.1：未知/自由文本归 notes），但绝不丢。
      const text = norm(entry.text)
      if (text) mergeNotes(canon, [{ text, status: entry.status, tags: entry.tags }], chapter)
      continue
    }
    const key = `${s}|${p}|${o}`
    const existing = canon.facts.find((fact) => factKey(fact) === key)
    if (existing) {
      if (entry.status) existing.status = norm(entry.status)
      if (Array.isArray(entry.tags)) existing.tags = uniqueStrings([...(existing.tags ?? []), ...entry.tags])
      continue
    }
    canon.facts.push({
      id: nextId('f', canon.facts, 4),
      s,
      p,
      o,
      chapter: norm(entry.chapter) || norm(chapter),
      status: norm(entry.status) || 'canon',
      tags: uniqueStrings(Array.isArray(entry.tags) ? entry.tags : []),
    })
  }
}

function mergeNotes(canon, entries, chapter) {
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const text = norm(entry.text)
    if (!text) continue
    const existing = canon.notes.find((note) => norm(note.text) === text)
    if (existing) {
      if (entry.status) existing.status = norm(entry.status)
      if (Array.isArray(entry.tags)) existing.tags = uniqueStrings([...(existing.tags ?? []), ...entry.tags])
      continue
    }
    canon.notes.push({
      id: nextId('n', canon.notes, 4),
      text,
      chapter: norm(entry.chapter) || norm(chapter),
      status: norm(entry.status) || 'open',
      tags: uniqueStrings(Array.isArray(entry.tags) ? entry.tags : []),
    })
  }
}

function mergeThreads(canon, entries, chapter) {
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const text = norm(entry.text)
    const byId = norm(entry.id)
    const wantsClosed = norm(entry.status) === 'closed' || Boolean(entry.closedIn)

    let target = byId ? canon.threads.find((thread) => thread.id === byId) ?? null : null
    if (!target && text) {
      target = canon.threads.find((thread) => norm(thread.text) === text) ?? null
    }
    // 闭合只凭文本、没给 id 时，允许命中唯一一条同义的开线索（§4.1 去重键）。
    if (!target && wantsClosed && text) {
      target =
        canon.threads.find(
          (thread) =>
            thread.status !== 'closed' &&
            (norm(thread.text).includes(text) || text.includes(norm(thread.text))),
        ) ?? null
    }

    if (target) {
      if (wantsClosed) {
        target.status = 'closed'
        target.closedIn = norm(entry.closedIn) || norm(chapter) || target.closedIn || ''
      }
      if (entry.payoff != null) target.payoff = norm(entry.payoff)
      continue
    }

    if (!text) continue
    const id = byId && !canon.threads.some((thread) => thread.id === byId)
      ? byId
      : nextId('t', canon.threads, 2)
    canon.threads.push({
      id,
      text,
      opened: norm(entry.opened) || norm(chapter),
      status: wantsClosed ? 'closed' : 'open',
      closedIn: wantsClosed ? norm(entry.closedIn) || norm(chapter) : null,
      payoff: norm(entry.payoff),
    })
  }
}

function mergeEntities(canon, entities) {
  if (!entities || typeof entities !== 'object' || Array.isArray(entities)) return
  for (const [rawName, rawState] of Object.entries(entities)) {
    const name = norm(rawName)
    if (!name || !rawState || typeof rawState !== 'object' || Array.isArray(rawState)) continue
    const current = canon.entities[name] ?? blankEntity(norm(rawState.kind) || 'character')
    const next = { ...blankEntity(current.kind || 'character'), ...current }
    if (rawState.kind != null) next.kind = norm(rawState.kind) || next.kind
    for (const field of ['gender', 'role', 'firstSeen', 'lastSeen', 'location', 'state']) {
      if (rawState[field] != null) next[field] = norm(rawState[field])
    }
    if (rawState.aliases != null) next.aliases = uniqueStrings([...(next.aliases ?? []), ...(Array.isArray(rawState.aliases) ? rawState.aliases : [])])
    if (rawState.knows != null) next.knows = uniqueStrings([...(next.knows ?? []), ...(Array.isArray(rawState.knows) ? rawState.knows : [])])
    if (rawState.relations != null) {
      next.relations = normalizeRelations([...(next.relations ?? []), ...(Array.isArray(rawState.relations) ? rawState.relations : [])])
    }
    if (norm(rawState.lastSeen)) next.lastSeen = norm(rawState.lastSeen)
    else if (norm(rawState.chapter)) next.lastSeen = norm(rawState.chapter)
    canon.entities[name] = next
  }
}

function mergeTimeline(canon, entries, chapter) {
  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = typeof raw === 'string' ? { event: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const event = norm(entry.event)
    if (!event) continue
    const chapterId = norm(entry.chapter) || norm(chapter)
    const existing = canon.timeline.find(
      (item) => norm(item.chapter) === chapterId && norm(item.event) === event,
    )
    if (existing) {
      if (entry.when != null) existing.when = norm(entry.when)
      continue
    }
    canon.timeline.push({ chapter: chapterId, when: norm(entry.when), event })
  }
}

function mergeRules(target, values) {
  for (const text of uniqueStrings(Array.isArray(values) ? values : [])) {
    if (!target.some((item) => norm(item) === text)) target.push(text)
  }
}

/**
 * 把 canon patch 合并进正典（纯函数，返回新对象，不修改入参）。
 * 去重：facts = s|p|o；notes = 文本；threads = id 或文本。
 * 同 s|p 不同 o 不会被覆盖，两条都留，由 canonProblems 报 canon-conflict。
 */
export function mergeCanon(canon, patch = {}, { chapter = '' } = {}) {
  const base = canon && typeof canon === 'object' ? clone(canon) : emptyCanon()
  base.version = CANON_VERSION
  base.rules ??= []
  base.facts ??= []
  base.notes ??= []
  base.threads ??= []
  base.entities ??= {}
  base.timeline ??= []
  base.invariants ??= []

  if (!patch || typeof patch !== 'object') return base
  // §4.4：空 patch 视为无变更，连派生的 conflict 标记也不重算。
  if (!Object.keys(patch).length) return base

  mergeFacts(base, patch.facts, chapter)
  mergeNotes(base, patch.notes, chapter)
  mergeThreads(base, patch.threads, chapter)
  mergeEntities(base, patch.entities)
  // v1 ledgerPatch 的人物字段叫 characters（§4.3 兼容）。
  mergeEntities(base, patch.characters)
  mergeTimeline(base, patch.timeline, chapter)
  mergeRules(base.rules, patch.rules)
  // review 的旧 ledgerPatch 仍有 canonRules 字段（§4.3 兼容）。
  mergeRules(base.rules, patch.canonRules)
  mergeRules(base.invariants, patch.invariants)

  markConflicts(base.facts)
  return base
}

// ---------------------------------------------------------------- 检索

function normalizeTerms(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === 'object' ? norm(item.name) : norm(item)))
      .filter(Boolean)
  }
  const text = norm(value)
  return text ? [text] : []
}

function tagsHit(tags, terms) {
  if (!Array.isArray(tags) || !terms.length) return false
  return tags.some((tag) => {
    const value = norm(tag)
    return terms.some((term) => value === term || value.includes(term))
  })
}

function textHit(text, terms) {
  if (!terms.length) return false
  return terms.some((term) => text.includes(term))
}

/**
 * 按本章需要检索正典切片（确定性排序；同分按 id 升序）。
 * 打分只用调用方给的本章信息，不读盘、不缓存跨调用状态。
 */
export function queryCanon(canon, { cast, keywords, location, atChapter, limit } = {}) {
  const safe = canon && typeof canon === 'object' ? canon : emptyCanon()
  const castTerms = normalizeTerms(cast)
  const keywordTerms = normalizeTerms(keywords)
  const locationText = norm(location)
  const max = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : DEFAULT_LIMIT
  // 只把「已经写到」的条目放进切片：第 5 章不该看见第 200 章才确立的事实/才开的线索。
  // 边界写不清章号的条目（undefined / 自由文本）一律保留，宁可多给也不误删。
  const at = chapterNumber(atChapter)
  const beyond = (chapter) => {
    const n = chapterNumber(chapter)
    return at >= 0 && n >= 0 && n > at
  }

  const facts = []
  for (const fact of Array.isArray(safe.facts) ? safe.facts : []) {
    if (!fact || typeof fact !== 'object') continue
    if (beyond(fact.chapter)) continue
    const subject = norm(fact.s)
    const haystack = `${subject} ${norm(fact.p)} ${norm(fact.o)}`
    const relational =
      tagsHit(fact.tags, castTerms) ||
      tagsHit(fact.tags, keywordTerms) ||
      castTerms.includes(subject) ||
      textHit(haystack, keywordTerms)
    let score = relational ? 8 : 0
    if (isRecent(fact.chapter, atChapter)) score += 4
    facts.push({ score, id: norm(fact.id), fact })
  }
  facts.sort((a, b) => b.score - a.score || cmpStr(a.id, b.id))

  const notes = []
  for (const note of Array.isArray(safe.notes) ? safe.notes : []) {
    if (!note || typeof note !== 'object') continue
    if (beyond(note.chapter)) continue
    const text = norm(note.text)
    const hit = tagsHit(note.tags, castTerms) || tagsHit(note.tags, keywordTerms) || textHit(text, keywordTerms)
    let score = hit ? 8 : 0
    if (isRecent(note.chapter, atChapter)) score += 4
    notes.push({ score, id: norm(note.id), note })
  }
  notes.sort((a, b) => b.score - a.score || cmpStr(a.id, b.id))

  const threads = []
  for (const thread of Array.isArray(safe.threads) ? safe.threads : []) {
    if (!thread || typeof thread !== 'object') continue
    if (beyond(thread.opened)) continue
    const open = norm(thread.status) !== 'closed'
    // 未回收线索基础分 +5；opened 离当前章越远加分越多，避免长期伏笔被淹没（§4.2 规则 3）。
    // 只对「当前章之前已开启」的线索计年龄：还没写到的远期线索一律按新线索处理，
    // 否则第 1 章会把全书最后一卷才开的伏笔当成压了 50 章的老线索顶到最前面。
    const age = chapterNumber(thread.opened) >= 0 && chapterNumber(thread.opened) <= chapterNumber(atChapter)
      ? chapterDistance(thread.opened, atChapter)
      : 0
    const ageBonus = open && Number.isFinite(age) ? Math.min(Math.max(0, age), 50) : 0
    threads.push({ score: (open ? 5 : 0) + ageBonus, id: norm(thread.id), thread })
  }
  threads.sort((a, b) => b.score - a.score || cmpStr(a.id, b.id))

  const entities = []
  for (const [name, entity] of Object.entries(safe.entities ?? {})) {
    if (!entity || typeof entity !== 'object') continue
    const aliases = Array.isArray(entity.aliases) ? entity.aliases.map(norm) : []
    const castHit = castTerms.some((term) => term === name || aliases.includes(term))
    const placeHit =
      Boolean(locationText) &&
      (norm(entity.location) === locationText || norm(entity.state).includes(locationText))
    const stateHit = textHit(`${norm(entity.state)} ${norm(entity.location)}`, castTerms)
    let score = castHit || placeHit || stateHit ? 10 : 0
    if (isRecent(entity.lastSeen, atChapter)) score += 6
    entities.push({ score, name, entity })
  }
  entities.sort((a, b) => b.score - a.score || cmpStr(a.name, b.name))

  const timeline = []
  const allTimeline = Array.isArray(safe.timeline) ? safe.timeline : []
  allTimeline.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return
    if (beyond(entry.chapter)) return
    let score = 0
    if (isRecent(entry.chapter, atChapter)) score += 4
    timeline.push({ score, index, entry })
  })
  timeline.sort(
    (a, b) =>
      b.score - a.score ||
      chapterNumber(b.entry.chapter) - chapterNumber(a.entry.chapter) ||
      a.index - b.index,
  )

  const rules = uniqueStrings(safe.rules).slice(0, RULES_LIMIT)
  const invariants = uniqueStrings(safe.invariants).slice(0, RULES_LIMIT)
  const pick = (list) => list.slice(0, max).map((item) => clone(item.fact ?? item.note ?? item.thread ?? item.entry))
  const pickedFacts = pick(facts)
  const pickedNotes = pick(notes)
  const pickedThreads = pick(threads)
  const pickedEntities = entities.slice(0, max).map((item) => ({ name: item.name, ...clone(item.entity) }))
  const pickedTimeline = pick(timeline)

  const truncated =
    (safe.facts?.length ?? 0) > pickedFacts.length ||
    (safe.notes?.length ?? 0) > pickedNotes.length ||
    (safe.threads?.length ?? 0) > pickedThreads.length ||
    Object.keys(safe.entities ?? {}).length > pickedEntities.length ||
    allTimeline.length > pickedTimeline.length ||
    uniqueStrings(safe.rules).length > rules.length ||
    uniqueStrings(safe.invariants).length > invariants.length

  return {
    rules,
    invariants,
    facts: pickedFacts,
    notes: pickedNotes,
    threads: pickedThreads,
    entities: pickedEntities,
    timeline: pickedTimeline,
    truncated,
  }
}

// ---------------------------------------------------------------- 格式化

function clip(text, maxChars) {
  const value = String(text ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0) return value
  if (value.length <= maxChars) return value
  const room = maxChars - TRUNCATED_TEXT.length
  if (room <= 0) return `${value.slice(0, Math.max(0, maxChars))}`
  return `${value.slice(0, room)}${TRUNCATED_TEXT}`
}

// 分节预算：先保底再按权重分，最后把没用掉的额度补给还没放完的节。
// 保底只做两件事：硬规则/不可违背各留一小块；有未回收线索时留出「标题 + 至少 2 条正文」。
// 这样第 500 章事实再多，线索区块也不会被事实挤掉（§4 承诺 open threads 进 packet）。
const SECTION_WEIGHTS = {
  rules: 0.2,
  invariants: 0.2,
  facts: 6,
  notes: 1,
  threads: 2,
  entities: 1.2,
  timeline: 0.8,
}
// 没放完的额度按此顺序补给；事实优先保持「占大头」，线索紧随其后。
const SECTION_REFILL_ORDER = ['facts', 'threads', 'notes', 'entities', 'timeline', 'rules', 'invariants']
// 小于这个额度时不再保证 2 条线索正文，只按比例分。
const THREAD_GUARANTEE_CHARS = 1200
const THREAD_GUARANTEE_LINES = 2
// 硬规则/不可违背的保底占比上限：规则通常很短，这里只防止它们被事实挤没。
const RULES_FLOOR_RATIO = 0.12

/** 一节完整文本的长度（含标题与换行）；空行列表记 0。 */
function sectionCost(title, lines) {
  if (!lines.length) return 0
  let cost = title.length + 1
  for (let i = 0; i < lines.length; i += 1) cost += lines[i].length + (i ? 1 : 0)
  return cost
}

/** 在 budget 内尽量多地取行（整行取，不切半行）；放不下第一行就整节省略。 */
function takeSection(title, lines, budget) {
  if (!lines.length || budget <= title.length + 1) return []
  const out = []
  let used = title.length + 1
  for (const line of lines) {
    const cost = line.length + (out.length ? 1 : 0)
    if (used + cost > budget) break
    out.push(line)
    used += cost
  }
  return out
}

/** 线索保底额度：标题 + 前 2 条正文；小额度下退化为按比例。 */
function threadFloor(title, lines, limit) {
  const head = takeSection(title, lines.slice(0, THREAD_GUARANTEE_LINES), limit)
  if (!head.length) return 0
  const cost = sectionCost(title, head)
  if (limit >= THREAD_GUARANTEE_CHARS) return cost
  return Math.min(cost, Math.floor(limit * 0.35))
}

function factLine(fact) {
  const chapter = norm(fact.chapter) || '—'
  return `- [${chapter}] ${norm(fact.s)}｜${norm(fact.p)}｜${norm(fact.o)}`
}

function entityLine(name, entity) {
  const head = [norm(entity.role), norm(entity.gender)].filter(Boolean).join('｜')
  const parts = []
  if (norm(entity.location)) parts.push(`在${norm(entity.location)}`)
  if (norm(entity.state)) parts.push(norm(entity.state))
  const knows = Array.isArray(entity.knows) ? entity.knows.map(norm).filter(Boolean) : []
  if (knows.length) parts.push(`知道：${knows.join('、')}`)
  const detail = parts.join('；') || '（未记录）'
  return `- ${name}${head ? `（${head}）` : ''}：${detail}`
}

/**
 * 切片 → prompt 文本（带【】小标题）。
 * 分节预算：有未回收线索且额度够（≥1200）时，先保底「标题 + 2 条正文」，
 * 再把剩余额度按权重分给各节、最后回填；事实仍占大头，但不再能挤掉线索。
 * 全部装得下时与旧实现逐字节一致；真的裁掉了才在末尾标「…（已截断）」。
 * 空切片返回空串（调用方据此省略整个分片）。
 */
export function formatCanon(slice, { maxChars = 3200 } = {}) {
  if (!slice || typeof slice !== 'object') return ''

  const sections = []
  const push = (key, title, lines) => {
    if (lines.length) sections.push({ key, title, lines })
  }

  push('rules', '【硬规则】', uniqueStrings(slice.rules).map((rule) => `- ${rule}`))
  push('invariants', '【不可违背】', uniqueStrings(slice.invariants).map((rule) => `- ${rule}`))

  const facts = Array.isArray(slice.facts) ? slice.facts : []
  push(
    'facts',
    '【已确立事实】',
    facts.filter((fact) => fact && typeof fact === 'object').map(factLine),
  )

  const notes = Array.isArray(slice.notes) ? slice.notes : []
  push(
    'notes',
    '【连续性注记】',
    notes
      .filter((note) => note && typeof note === 'object')
      .map((note) => `- [${norm(note.chapter) || '—'}] ${norm(note.text)}`),
  )

  const threads = (Array.isArray(slice.threads) ? slice.threads : []).filter(
    (thread) => thread && norm(thread.status) !== 'closed',
  )
  push(
    'threads',
    '【未回收线索】',
    threads.map((thread) => {
      const opened = norm(thread.opened) || '—'
      const payoff = norm(thread.payoff)
      const closedIn = norm(thread.closedIn)
      // 章号必带；payoff / 回收章有就带上，方便 agent 判断这条线值不值得接。
      const tail = payoff
        ? `（payoff：${payoff}${closedIn ? ` @${closedIn}` : ''}）`
        : closedIn
          ? `（回收于：${closedIn}）`
          : ''
      return `- ${norm(thread.id)} [${opened}] ${norm(thread.text)}${tail}`
    }),
  )

  const entities = Array.isArray(slice.entities) ? slice.entities : []
  push(
    'entities',
    '【人物状态】',
    entities
      .filter((entity) => entity && norm(entity.name))
      .map((entity) => entityLine(norm(entity.name), entity)),
  )

  const timeline = Array.isArray(slice.timeline) ? slice.timeline : []
  push(
    'timeline',
    '【时间线】',
    timeline
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => `- ${norm(entry.chapter) || '—'}｜${norm(entry.when) || '—'}｜${norm(entry.event)}`),
  )

  if (!sections.length) return ''

  const render = (section, lines) => `${section.title}\n${lines.join('\n')}`

  // maxChars 非正/非有限：沿用旧行为，不裁剪。
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return sections.map((section) => render(section, section.lines)).join('\n')
  }

  const limit = Math.floor(maxChars)
  const full = sections.reduce(
    (sum, section) => sum + sectionCost(section.title, section.lines),
    0,
  )
  // 全部装得下：与旧实现逐字节一致，且不出现截断标记。
  if (full <= limit) return sections.map((section) => render(section, section.lines)).join('\n')

  const totalWeight =
    sections.reduce((sum, section) => sum + (SECTION_WEIGHTS[section.key] ?? 1), 0) || 1

  // 第一轮：保底（线索 2 条 / 规则小块），剩余额度按权重分。
  const alloc = new Map()
  let reserved = 0
  for (const section of sections) {
    let floor = 0
    if (section.key === 'threads') {
      floor = threadFloor(section.title, section.lines, limit)
    } else if (section.key === 'rules' || section.key === 'invariants') {
      floor = Math.min(
        sectionCost(section.title, section.lines),
        Math.floor(limit * RULES_FLOOR_RATIO),
      )
    }
    alloc.set(section.key, floor)
    reserved += floor
  }
  const pool = Math.max(0, limit - reserved)
  for (const section of sections) {
    const weight = SECTION_WEIGHTS[section.key] ?? 1
    alloc.set(
      section.key,
      alloc.get(section.key) + Math.floor((pool * weight) / totalWeight),
    )
  }

  const chosen = new Map()
  let used = 0
  for (const section of sections) {
    const lines = takeSection(section.title, section.lines, alloc.get(section.key))
    chosen.set(section.key, lines)
    used += sectionCost(section.title, lines)
  }

  // 第二轮：把没用掉的额度回填给还没放完的节；循环到没有进展为止。
  let leftover = limit - used
  let progressed = true
  while (leftover > 0 && progressed) {
    progressed = false
    for (const key of SECTION_REFILL_ORDER) {
      const section = sections.find((item) => item.key === key)
      if (!section) continue
      const current = chosen.get(key)
      if (current.length >= section.lines.length) continue
      const currentCost = sectionCost(section.title, current)
      const next = takeSection(section.title, section.lines, currentCost + leftover)
      if (next.length <= current.length) continue
      const nextCost = sectionCost(section.title, next)
      chosen.set(key, next)
      leftover -= nextCost - currentCost
      used += nextCost - currentCost
      progressed = true
    }
  }

  const parts = []
  let dropped = false
  for (const section of sections) {
    const lines = chosen.get(section.key)
    if (lines.length < section.lines.length) dropped = true
    if (lines.length) parts.push(render(section, lines))
  }
  // 额度小到连「标题 + 一行」都放不下：退回旧的整串截断，至少让首行露出来。
  if (!parts.length) {
    return clip(sections.map((section) => render(section, section.lines)).join('\n'), limit)
  }
  const body = parts.join('\n')
  if (!dropped) return clip(body, limit)
  return clip(`${body}\n${TRUNCATED_TEXT}`, limit)
}

// ---------------------------------------------------------------- 自检

/**
 * 账本自身的问题（不是正文问题）：冲突、缺字段、重复 id。
 * 不自动裁决，只把需要人工/LLM 决策的点列出来。
 */
export function canonProblems(canon, { atChapter } = {}) {
  const safe = canon && typeof canon === 'object' ? canon : emptyCanon()
  const findings = []
  const facts = (Array.isArray(safe.facts) ? safe.facts : []).filter(
    (fact) => fact && typeof fact === 'object' && isAtOrBefore(fact.chapter, atChapter),
  )

  const groups = new Map()
  for (const fact of facts) {
    if (norm(fact.status) !== 'canon') continue
    const key = factGroupKey(fact)
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key).add(norm(fact.o))
  }
  for (const [key, values] of groups) {
    if (values.size <= 1) continue
    findings.push({
      severity: 'warn',
      kind: 'canon-conflict',
      where: key,
      issue: `同一主体与谓词存在多个正典取值：${[...values].join(' / ')}`,
      fix: '人工或 LLM 裁决后，把不再采用的旧事实置 status:"retracted"',
    })
  }

  const seenIds = new Set()
  for (const fact of facts) {
    if (!norm(fact.s) || !norm(fact.p) || !norm(fact.o)) {
      findings.push({
        severity: 'note',
        kind: 'invalid-fact',
        where: norm(fact.id) || '?',
        issue: '事实缺主体/谓词/值，无法参与确定性冲突检测',
        fix: '补全三元组；自由文本请移到 notes',
      })
    }
    const id = norm(fact.id)
    if (id && seenIds.has(id)) {
      findings.push({
        severity: 'warn',
        kind: 'duplicate-id',
        where: id,
        issue: '事实 id 重复，读取方无法唯一定位',
        fix: '重新发号（ids 交给脚本，不要沿用模型给的 id）',
      })
    }
    if (id) seenIds.add(id)
  }

  const order = { block: 0, warn: 1, note: 2 }
  findings.sort(
    (a, b) =>
      (order[a.severity] ?? 9) - (order[b.severity] ?? 9) ||
      cmpStr(a.kind, b.kind) ||
      cmpStr(a.where, b.where),
  )
  return findings
}

// ---------------------------------------------------------------- 统计与实体

/** 账本规模与健康度（给 novel_status / novel_audit 用）。 */
export function canonStats(canon) {
  const safe = canon && typeof canon === 'object' ? canon : emptyCanon()
  const facts = Array.isArray(safe.facts) ? safe.facts : []
  const notes = Array.isArray(safe.notes) ? safe.notes : []
  const threads = Array.isArray(safe.threads) ? safe.threads : []
  const names = Object.keys(safe.entities ?? {})
  let dead = 0
  for (const name of names) {
    if (isDead(safe, name)) dead += 1
  }
  const conflicts = canonProblems(safe).filter((finding) => finding.kind === 'canon-conflict').length
  return {
    facts: facts.length,
    notes: notes.length,
    threads: threads.length,
    openThreads: threads.filter((thread) => norm(thread?.status) !== 'closed').length,
    entities: names.length,
    dead,
    conflicts,
  }
}

/** 名字或别名 → { name, entity }；找不到返回 null。 */
export function entityOf(canon, name) {
  const target = norm(name)
  if (!target) return null
  const entities = canon?.entities && typeof canon.entities === 'object' ? canon.entities : {}
  if (entities[target]) return { name: target, entity: entities[target] }
  for (const [entityName, entity] of Object.entries(entities)) {
    const aliases = Array.isArray(entity?.aliases) ? entity.aliases.map(norm) : []
    if (aliases.includes(target)) return { name: entityName, entity }
  }
  return null
}

/**
 * 死亡判定：p ∈ {状态,生死,结局} 且 o 含 死/亡/殁，忽略 retracted。
 * 若之后（chapter 更晚）有同 s 同 p、o 含 活/未死 的事实，视为复活。
 */
export function isDead(canon, name) {
  const found = entityOf(canon, name)
  const canonical = found ? found.name : norm(name)
  const aliases = new Set([norm(name), canonical])
  for (const alias of found?.entity?.aliases ?? []) aliases.add(norm(alias))

  const events = []
  const facts = Array.isArray(canon?.facts) ? canon.facts : []
  facts.forEach((fact, index) => {
    if (!fact || typeof fact !== 'object') return
    if (!aliases.has(norm(fact.s))) return
    if (!DEATH_PREDICATES.has(norm(fact.p))) return
    if (norm(fact.status) === 'retracted') return
    const o = norm(fact.o)
    if (!o) return
    const chapter = chapterNumber(fact.chapter)
    if (o.includes('未死') || o.includes('活')) {
      events.push({ chapter, index, dead: false })
    } else if (DEATH_WORDS.test(o)) {
      events.push({ chapter, index, dead: true })
    }
  })
  events.sort((a, b) => a.chapter - b.chapter || a.index - b.index)
  return events.length ? events[events.length - 1].dead : false
}

// ---------------------------------------------------------------- 迁移

/**
 * 识别旧账本里的结构化事实：
 *   - `s|p|o`（三段竖线）
 *   - `X 的 Y 是 Z`
 * 识别不出返回 null（仍会作为 note 保留）。
 */
function parseFactText(text) {
  const value = norm(text)
  if (!value) return null
  const parts = value.split('|')
  if (parts.length === 3 && parts.every((part) => part.trim())) {
    return { s: parts[0].trim(), p: parts[1].trim(), o: parts[2].trim() }
  }
  const matched = value.match(/^(.{1,24}?)的(.{1,16}?)是(.{1,})$/)
  if (matched) {
    return { s: matched[1].trim(), p: matched[2].trim(), o: matched[3].trim() }
  }
  return null
}

function legacyFactStatus(status) {
  const value = norm(status)
  if (value === 'closed' || value === 'retracted') return 'retracted'
  if (value === 'open') return 'open'
  return 'canon'
}

/**
 * v1 ledger.json → canon v2。
 * 旧 text facts 全进 notes（一个字都不少），能识别的结构化三元组另进 facts。
 * 已是 v2 的输入原样返回，保证迁移幂等。
 */
export function migrateLedger(ledger, { characters } = {}) {
  if (!ledger || typeof ledger !== 'object') return emptyCanon()
  if (Number(ledger.version) === CANON_VERSION) return ledger

  const canon = emptyCanon()
  canon.rules = uniqueStrings([...(Array.isArray(ledger.rules) ? ledger.rules : []), ...(Array.isArray(ledger.canonRules) ? ledger.canonRules : [])])
  canon.invariants = uniqueStrings(ledger.invariants)

  for (const raw of Array.isArray(ledger.facts) ? ledger.facts : []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const text = norm(entry.text)
    if (!text) continue
    const chapter = norm(entry.chapter)
    const status = legacyFactStatus(entry.status)
    canon.notes.push({
      id: nextId('n', canon.notes, 4),
      text,
      chapter,
      // 旧事实的开放/撤回状态沿用；note 只有 canon|open 两态，关闭即撤回。
      status: status === 'retracted' ? 'canon' : status,
      tags: uniqueStrings(Array.isArray(entry.tags) ? entry.tags : []),
    })
    const parsed = parseFactText(text)
    if (parsed) {
      canon.facts.push({
        id: nextId('f', canon.facts, 4),
        s: parsed.s,
        p: parsed.p,
        o: parsed.o,
        chapter,
        status,
        tags: uniqueStrings(Array.isArray(entry.tags) ? entry.tags : []),
      })
    }
  }

  for (const raw of Array.isArray(ledger.threads) ? ledger.threads : []) {
    const entry = typeof raw === 'string' ? { text: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const text = norm(entry.text)
    if (!text) continue
    const closed = norm(entry.status) === 'closed' || Boolean(entry.closedIn)
    canon.threads.push({
      id: norm(entry.id) || nextId('t', canon.threads, 2),
      text,
      opened: norm(entry.opened),
      status: closed ? 'closed' : 'open',
      closedIn: closed ? norm(entry.closedIn) : null,
      payoff: norm(entry.payoff),
    })
  }

  for (const raw of Array.isArray(ledger.timeline) ? ledger.timeline : []) {
    const entry = typeof raw === 'string' ? { event: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const event = norm(entry.event)
    if (!event) continue
    canon.timeline.push({ chapter: norm(entry.chapter), when: norm(entry.when), event })
  }

  // 实体种子：characters 产物（cast 数组或映射）优先，旧 ledger.characters 的状态合并进去。
  for (const person of characterEntries(characters)) {
    const name = norm(person.name)
    if (!name) continue
    canon.entities[name] = canon.entities[name] ?? entityFromCharacter(person)
  }
  if (ledger.characters && typeof ledger.characters === 'object' && !Array.isArray(ledger.characters)) {
    for (const [rawName, rawState] of Object.entries(ledger.characters)) {
      const name = norm(rawName)
      if (!name || !rawState || typeof rawState !== 'object') continue
      const current = canon.entities[name] ?? blankEntity('character')
      const next = { ...current }
      for (const field of ['location', 'state', 'role', 'gender', 'firstSeen', 'lastSeen']) {
        if (rawState[field] != null && norm(rawState[field])) next[field] = norm(rawState[field])
      }
      next.knows = uniqueStrings([...(current.knows ?? []), ...(Array.isArray(rawState.knows) ? rawState.knows : [])])
      next.relations = normalizeRelations([...(current.relations ?? []), ...(Array.isArray(rawState.relations) ? rawState.relations : [])])
      canon.entities[name] = next
    }
  }

  markConflicts(canon.facts)
  return canon
}
