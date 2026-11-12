// consistency.js — 正典一致性检查（确定性、零 IO、不调模型）。
// 契约：docs/architecture-v2.md §8。findings 形状与 craft.js 保持一致。
// 原则：宁可漏报，不可误报；只做机器能判的事，canon 作为普通对象入参（不 import canon.js）。

const SEVERITY_RANK = { block: 0, warn: 1, note: 2 }

// 常见虚词/名词白名单：这些 2–4 字串即使高频出现，也不是「未登记人名」。
const COMMON_WORDS = new Set([
  '什么', '时候', '已经', '现在', '一个', '他们', '我们', '你们', '自己', '心里',
  '声音', '地方', '东西', '眼睛', '手里', '身上', '脸上', '眼前', '身后', '面前',
  '周围', '四周', '空气', '房间', '门口', '窗外', '外面', '里面', '上面', '下面',
  '前面', '后面', '旁边', '中间', '远处', '近处', '天上', '地上', '夜色', '月光',
  '灯光', '太阳', '时间', '片刻', '一会', '一会儿', '突然', '忽然', '终于', '果然',
  '依然', '仍然', '还是', '就是', '只是', '但是', '可是', '因为', '所以', '如果',
  '虽然', '然后', '接着', '于是', '而且', '并且', '或者', '不是', '没有', '不能',
  '不会', '不要', '知道', '觉得', '感觉', '看着', '看见', '听到', '听见', '说道',
  '问道', '回答', '低声', '轻声', '大声', '沉默', '点头', '摇头', '抬头', '低头',
  '回头', '转身', '起身', '坐下', '站起', '走出', '走进', '回来', '出来', '起来',
  '过去', '过来', '下来', '上去', '一下', '一直', '一起', '一样', '一点', '一些',
  '这个', '那个', '这些', '那些', '这样', '那样', '怎么', '为什么', '哪里', '这里',
  '那里', '事情', '模样', '目光', '眼神', '神色', '脸色', '语气', '身体', '手指',
  '嘴角', '眼泪', '笑容', '背影', '脚步', '呼吸', '心跳', '黑暗', '阴影', '屋里',
  '院内', '心中', '脑海', '记忆', '未来', '最后', '半个', '一半', '许多', '很多',
  '所有', '每个', '别的', '其他', '其中', '之后', '之前', '以后', '以前', '当时',
  '此时', '此刻', '立刻', '马上', '慢慢', '渐渐', '缓缓', '轻轻', '微微', '紧紧',
  '悄悄', '默默', '独自', '双手', '左手', '右手', '电话', '手机', '东西', '地方',
])

// 这些字落在词首/词尾时，几乎不可能是 2–4 字人名（用来压 name-drift 误报）。
const NAME_EDGE_STOP = new Set(
  '的了着过是在和与也就都又很没不这那他她它我你们个来去说道问看想笑走站坐起'.split(''),
)

const CJK_NAME = /^[\u3400-\u4dbf\u4e00-\u9fff]{2,4}$/

// 统计 name-drift 之前先把白名单词整体遮盖掉：否则「什么时候」会在词与词的接缝处切出
// 「么时」这类假人名。正则只用于 String.replace，用完即重置，不是可变状态。
const COMMON_WORDS_BY_LENGTH = [...COMMON_WORDS].sort((a, b) => b.length - a.length)
const COMMON_MASK = new RegExp(COMMON_WORDS_BY_LENGTH.map(escapeRegExp).join('|'), 'g')

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const CN_DIGITS = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 }

function asList(value) {
  return Array.isArray(value) ? value : []
}

function nameOf(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    if (typeof value.name === 'string') return value.name.trim()
    if (typeof value.id === 'string') return value.id.trim()
  }
  return ''
}

function addName(names, value) {
  const name = nameOf(value)
  if (name && !names.includes(name)) names.push(name)
}

/** 收集 cast；支持字符串、名字数组、人物对象数组、以顿号/逗号分隔的字符串。 */
function collectCastNames(sources) {
  const names = []
  for (const source of sources) {
    if (!source) continue
    if (Array.isArray(source)) {
      source.forEach((value) => addName(names, value))
      continue
    }
    if (typeof source === 'string') {
      source.split(/[、,，/／;；\s]+/).forEach((value) => addName(names, value))
    }
  }
  return names
}

/** 只取细纲/本章自带的 cast（用于 cast-missing，避免把全书人物名册当成出场要求）。 */
function outlineCastNames({ chapter, beats }) {
  const sources = [chapter?.cast]
  if (Array.isArray(beats?.cast)) sources.push(beats.cast)
  else if (typeof beats?.cast === 'string') sources.push(beats.cast)
  for (const scene of asList(beats?.scenes)) {
    if (Array.isArray(scene?.cast)) sources.push(scene.cast)
    else if (typeof scene?.cast === 'string') sources.push(scene.cast)
  }
  return collectCastNames(sources)
}

function chapterCastNames({ chapter, beats, cast }) {
  const names = outlineCastNames({ chapter, beats })
  for (const name of collectCastNames([cast])) {
    if (!names.includes(name)) names.push(name)
  }
  return names
}

function chapterText(item) {
  const value = item?.text ?? item?.content ?? item?.draft ?? ''
  return typeof value === 'string' ? value : ''
}

function whereOf(chapter) {
  const value = chapter?.id ?? chapter?.chapter
  return value == null || value === '' ? '本章' : String(value)
}

function compareText(a, b) {
  const left = String(a ?? '')
  const right = String(b ?? '')
  return left < right ? -1 : left > right ? 1 : 0
}

function sortFindings(findings) {
  return findings.slice().sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
      compareText(a.kind, b.kind) ||
      compareText(a.where, b.where) ||
      compareText(a.issue, b.issue),
  )
}

function dedupeFindings(findings) {
  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.severity}\u0000${finding.kind}\u0000${finding.where}\u0000${finding.issue}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function countOf(text, needle) {
  if (!needle) return 0
  let count = 0
  let position = text.indexOf(needle)
  while (position !== -1) {
    count += 1
    position = text.indexOf(needle, position + needle.length)
  }
  return count
}

/** 从章节 id 里取序数（ch0041 → 41）；取不到返回 null。 */
function chapterNumber(value) {
  const matched = String(value ?? '').match(/(\d+)/)
  return matched ? Number(matched[1]) : null
}

function chineseNumber(text) {
  if (/^\d+$/.test(text)) return Number(text)
  let total = 0
  let number = 0
  for (const char of text) {
    if (char in CN_DIGITS) {
      number = CN_DIGITS[char]
      continue
    }
    if (char in CN_UNITS) {
      const unit = CN_UNITS[char]
      if (number === 0) number = 1
      total += number * unit
      number = 0
      continue
    }
    return null
  }
  return total + number
}

/**
 * 把「第 3 天」「第三天」「第 12 日」解析成序数。
 * 「头七当晚」这类解析不了的返回 null —— 规则要求直接跳过。
 */
function parseWhen(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const matched = text.match(/第\s*([0-9]+|[〇零一二三四五六七八九十百千两]+)\s*(?:天|日|夜|晚|章|年|月|回|次|更)?/)
  if (!matched) return null
  const number = chineseNumber(matched[1])
  return Number.isFinite(number) ? number : null
}

function deathState(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/复活|存活|活着|生还|未死|没死|还活着|活下来|^活$/.test(text)) return 'alive'
  if (/假死|生死未卜|生死不明/.test(text)) return null
  if (/死|亡/.test(text)) return 'death'
  return null
}

function canonicalName(alias, value) {
  const name = nameOf(value)
  if (!name) return ''
  return alias.get(name) ?? name
}

/** 建一份只读索引，audit 只建一次，逐章复用。 */
function createCanonIndex(canon) {
  const source = canon && typeof canon === 'object' ? canon : {}
  const facts = asList(source.facts).filter((fact) => fact && typeof fact === 'object')
  const rawEntities = source.entities
  const entities =
    rawEntities && typeof rawEntities === 'object' && !Array.isArray(rawEntities) ? rawEntities : {}

  // 别名 → 正名；同时记录正名下的所有写法。
  const alias = new Map()
  for (const [name, entity] of Object.entries(entities)) {
    alias.set(name, name)
    for (const item of asList(entity?.aliases)) {
      const value = nameOf(item)
      if (value) alias.set(value, name)
    }
  }
  const variants = new Map()
  for (const [value, name] of alias) {
    if (!variants.has(name)) variants.set(name, [])
    variants.get(name).push(value)
  }

  // 已知实体名 + 事实主体名：name-drift 只做精确排除，不做包含判断（避免 5000 条事实拖慢）。
  const known = new Set(alias.keys())
  for (const fact of facts) {
    const subject = nameOf(fact.s)
    if (subject) known.add(subject)
  }
  // 包含判断只扫实体/别名，量级小。
  const entityNames = [...alias.keys()]

  // 把白名单词与实体名拆成 2–4 字片段：name-drift 的「已知词包含关系」变成 O(1) 查表，
  // 否则 300 章 × 数千候选 × 数百白名单会拖慢 audit。
  const blockedFragments = new Set()
  const addFragments = (word) => {
    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start + size <= word.length; start += 1) {
        blockedFragments.add(word.slice(start, start + size))
      }
    }
  }
  for (const word of COMMON_WORDS) addFragments(word)
  for (const word of entityNames) addFragments(word)

  // 反向包含（gram 里含有一个已知词，如「什么时候」含「时候」）只查 2–4 字词的子串，
  // 不扫全表；词长超过 4 的不可能被 2–4 字 gram 包含。
  const knownWords = new Set()
  for (const word of COMMON_WORDS) if (word.length >= 2 && word.length <= 4) knownWords.add(word)
  for (const word of entityNames) if (word.length >= 2 && word.length <= 4) knownWords.add(word)

  // 逐个主体看「死亡 / 活着」事件，最后一条决定生死。
  const events = new Map()
  facts.forEach((fact, index) => {
    if ((fact.status ?? 'canon') !== 'canon') return
    const predicate = String(fact.p ?? '')
    if (predicate !== '状态' && predicate !== '生死') return
    const value = String(fact.o ?? '')
    if (!value) return
    const kind = deathState(value)
    if (!kind) return
    const subject = canonicalName(alias, fact.s)
    if (!subject) return
    if (!events.has(subject)) events.set(subject, [])
    events.get(subject).push({ kind, num: chapterNumber(fact.chapter), index, value })
  })

  const dead = new Map()
  for (const [name, list] of events) {
    const ordered = list.slice().sort((a, b) => {
      if (a.num != null && b.num != null && a.num !== b.num) return a.num - b.num
      return a.index - b.index
    })
    const last = ordered[ordered.length - 1]
    if (last?.kind === 'death') dead.set(name, { name, variants: variants.get(name) ?? [name] })
  }
  // 人物档案里的 state 也作为死亡来源（没有事实事件时）。
  for (const [name, entity] of Object.entries(entities)) {
    const subject = canonicalName(alias, name)
    if (!subject || dead.has(subject) || events.has(subject)) continue
    if (deathState(entity?.state) === 'death') {
      dead.set(subject, { name: subject, variants: variants.get(subject) ?? [subject] })
    }
  }

  const retracted = facts.filter((fact) => fact.status === 'retracted')

  return {
    facts,
    entities,
    invariants: asList(source.invariants),
    threads: asList(source.threads),
    alias,
    known,
    entityNames,
    blockedFragments,
    knownWords,
    dead,
    retracted,
  }
}

function deadFindings(index, body, castNames, where) {
  const findings = []
  for (const entry of index.dead.values()) {
    const variants = entry.variants?.length ? entry.variants : [entry.name]
    const inCast = castNames.some(
      (name) => variants.includes(name) || canonicalName(index.alias, name) === entry.name,
    )
    let count = 0
    for (const variant of variants) count = Math.max(count, countOf(body, variant))
    if (!inCast && count < 2) continue
    const detail =
      inCast && count >= 2
        ? `出现在本章 cast，正文出现 ${count} 次`
        : inCast
          ? '出现在本章 cast'
          : `正文出现 ${count} 次`
    findings.push({
      severity: 'block',
      kind: 'dead-character',
      where,
      issue: `「${entry.name}」在正典里已死亡，却${detail}`,
      fix: '确认这是回忆、尸体还是同名者；否则删掉其行动与对白。若要复活，先在正典登记更晚的「状态：活着」事实',
    })
  }
  return findings
}

function timelineFindings(chapter, previousChapter, where) {
  const current = parseWhen(chapter?.when)
  const previous = parseWhen(previousChapter?.when)
  if (current == null || previous == null || current >= previous) return []
  return [
    {
      severity: 'warn',
      kind: 'timeline-regress',
      where,
      issue: `本章时间「${chapter.when}」早于上一章「${previousChapter.when}」`,
      fix: '按故事时间调整本章 when；若是回忆，把这一章挪到该时间点之后并标明「回忆」',
    },
  ]
}

function castMissingFindings(body, castNames, where) {
  const findings = []
  for (const name of castNames) {
    if (!CJK_NAME.test(name)) continue
    if (body.includes(name)) continue
    findings.push({
      severity: 'warn',
      kind: 'cast-missing',
      where,
      issue: `细纲/本章 cast 指定的「${name}」在正文里一次都没有出现`,
      fix: `补一场「${name}」的戏；如果这一章不需要他，把「${name}」从细纲 cast 里移除`,
    })
  }
  return findings
}

function isCommonWord(gram, castNames, index) {
  if (index.blockedFragments.has(gram) || index.knownWords.has(gram)) return true
  if (NAME_EDGE_STOP.has(gram[0]) || NAME_EDGE_STOP.has(gram[gram.length - 1])) return true
  // gram 自身含有已知词（如「什么时候」含「时候」）也算白名单。
  for (let size = 2; size < gram.length; size += 1) {
    for (let start = 0; start + size <= gram.length; start += 1) {
      if (index.knownWords.has(gram.slice(start, start + size))) return true
    }
  }
  for (const word of castNames) {
    if (word.length >= 2 && (word.includes(gram) || gram.includes(word))) return true
  }
  return false
}

function nameDriftFindings(body, index, castNames, where) {
  const counts = new Map()
  // 先用白名单词把正文切开（替换成换行），词内与词缝里都不会再生成候选。
  const runs =
    body.replace(COMMON_MASK, '\n').match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? []
  for (const run of runs) {
    // 逐字先算一次「是否虚词」，避免在内层 3 万次循环里反复查 Set。
    const stopEdge = new Uint8Array(run.length)
    for (let i = 0; i < run.length; i += 1) stopEdge[i] = NAME_EDGE_STOP.has(run[i]) ? 1 : 0
    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start + size <= run.length; start += 1) {
        // 首尾是虚词、或整段落在白名单/实体名里的片段，永远不会被报，计数阶段直接跳过。
        if (stopEdge[start] || stopEdge[start + size - 1]) continue
        const gram = run.slice(start, start + size)
        if (index.blockedFragments.has(gram)) continue
        counts.set(gram, (counts.get(gram) ?? 0) + 1)
      }
    }
  }
  const candidates = []
  for (const [gram, count] of counts) {
    if (count < 3 || index.known.has(gram) || castNames.includes(gram)) continue
    if (isCommonWord(gram, castNames, index)) continue
    candidates.push([gram, count])
  }
  candidates.sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
  return candidates.slice(0, 8).map(([gram, count]) => ({
    severity: 'note',
    kind: 'name-drift',
    where,
    issue: `正文出现「${gram}」${count} 次，但正典里没有这个人物/实体，也不在本章 cast 里`,
    fix: `若「${gram}」是新人物，先在 canon.entities 登记并补 aliases；若是笔误，统一成已有名字`,
  }))
}

function invariantFindings(body, invariants, where) {
  const findings = []
  const seen = new Set()
  for (const raw of invariants) {
    const text = String(raw ?? '').trim()
    if (!text || text.length < 3 || seen.has(text)) continue
    const parts = [text, ...text.split(/[、，,；;。.\n]+/).map((part) => part.trim())]
    const hit = parts.find((part) => part.length >= 3 && body.includes(part))
    if (!hit) continue
    seen.add(text)
    findings.push({
      severity: 'warn',
      kind: 'invariant-hit',
      where,
      issue: `正文出现正典硬约束中的词句「${hit}」`,
      fix: `核对这段是否与设定「${text}」冲突；若约束已失效，先从 canon.invariants 移除`,
    })
  }
  return findings
}

function factContradictFindings(body, retracted, where) {
  const findings = []
  for (const fact of retracted) {
    const subject = String(fact.s ?? '').trim()
    const value = String(fact.o ?? '').trim()
    if (!subject || value.length < 4) continue
    if (!body.includes(subject) || !body.includes(value)) continue
    findings.push({
      severity: 'note',
      kind: 'fact-contradict',
      where,
      issue: `正文同时出现「${subject}」和已撤回的旧事实「${value}」`,
      fix: `把「${value}」改成当前正典值；若这段写的是旧事，明确标注时间，避免读者当成现状`,
    })
  }
  return findings
}

/** 单章规则集合；audit 逐章复用它，保证两条路口径一致。 */
function chapterFindings(index, { text, chapter, previousChapter, beats, cast }) {
  const body = String(text ?? '')
  if (!body.trim()) return []
  const where = whereOf(chapter)
  const outlineCast = outlineCastNames({ chapter, beats })
  const allCast = chapterCastNames({ chapter, beats, cast })
  return sortFindings([
    ...deadFindings(index, body, allCast, where),
    ...timelineFindings(chapter, previousChapter, where),
    ...castMissingFindings(body, outlineCast, where),
    ...nameDriftFindings(body, index, allCast, where),
    ...invariantFindings(body, index.invariants, where),
    ...factContradictFindings(body, index.retracted, where),
  ])
}

export function checkChapter({
  text = '',
  canon = null,
  chapter = null,
  previousChapter = null,
  params = {},
  beats = null,
  cast = null,
} = {}) {
  const index = createCanonIndex(canon)
  return chapterFindings(index, { text, chapter, previousChapter, beats, cast, params })
}

function normalizeChapters(chapters, outline) {
  const list = []
  const push = (id, value) => {
    if (value == null) {
      list.push({ id: String(id) })
      return
    }
    if (typeof value === 'string') {
      list.push({ id: String(id), text: value })
      return
    }
    if (typeof value === 'object') {
      list.push({ ...value, id: value.id ?? value.chapter ?? String(id) })
    }
  }
  if (!Array.isArray(chapters) && chapters && typeof chapters === 'object') {
    for (const [id, value] of Object.entries(chapters)) push(id, value)
    return list
  }
  const source =
    Array.isArray(chapters) && chapters.length
      ? chapters
      : Array.isArray(outline?.chapters)
        ? outline.chapters
        : []
  source.forEach((item, index) => {
    const fallback = `ch${String(index + 1).padStart(4, '0')}`
    if (typeof item === 'string') list.push({ id: item })
    else if (item && typeof item === 'object') list.push({ ...item, id: item.id ?? item.chapter ?? fallback })
  })
  return list
}

function threadStaleFindings(threads, list) {
  if (!list.length) return []
  const currentId = list[list.length - 1]?.id
  const currentNum = chapterNumber(currentId)
  const findings = []
  for (const thread of threads) {
    if (!thread || typeof thread !== 'object') continue
    if (thread.status === 'closed' || thread.closedIn) continue
    const opened = String(thread.opened ?? '').trim()
    if (!opened) continue
    let distance = null
    const openedNum = chapterNumber(opened)
    if (openedNum != null && currentNum != null) {
      distance = currentNum - openedNum
    } else {
      const at = list.findIndex((item) => item.id === opened)
      if (at >= 0) distance = list.length - 1 - at
    }
    if (distance == null || distance < 40) continue
    const text = String(thread.text ?? thread.title ?? thread.id ?? '').trim() || thread.id || opened
    findings.push({
      severity: 'note',
      kind: 'thread-stale',
      where: opened,
      issue: `线索「${text}」自 ${opened} 起已 ${distance} 章未回收`,
      fix: '在近期章节安排回收；如果已经不需要，把 thread 标成 closed 并写 closedIn / payoff',
    })
  }
  return findings
}

function canonConflictFindings(facts) {
  const groups = new Map()
  facts.forEach((fact, index) => {
    if ((fact.status ?? 'canon') !== 'canon') return
    const subject = String(fact.s ?? '').trim()
    const predicate = String(fact.p ?? '').trim()
    if (!subject || !predicate) return
    const key = `${subject}\u0000${predicate}`
    if (!groups.has(key)) {
      groups.set(key, { subject, predicate, values: new Map(), where: '', whereNum: -1, order: index })
    }
    const group = groups.get(key)
    const value = String(fact.o ?? '').trim()
    if (!group.values.has(value)) group.values.set(value, fact)
    const num = chapterNumber(fact.chapter)
    if (num != null && num >= group.whereNum) {
      group.whereNum = num
      group.where = String(fact.chapter)
    }
    group.order = index
  })
  const findings = []
  for (const group of groups.values()) {
    if (group.values.size < 2) continue
    const values = [...group.values.keys()]
    findings.push({
      severity: 'warn',
      kind: 'canon-conflict',
      where: group.where || '正典',
      issue: `正典自相矛盾：「${group.subject}」的「${group.predicate}」同时登记为「${values.join('」「')}」`,
      fix: '人工/LLM 裁决后保留一条，把不采用的标为 retracted（保留记录，不要直接删除）',
    })
  }
  return findings
}

export function audit({ chapters = null, canon = null, outline = null, params = {} } = {}) {
  const index = createCanonIndex(canon)
  const list = normalizeChapters(chapters, outline)
  const findings = [
    ...threadStaleFindings(index.threads, list),
    ...canonConflictFindings(index.facts),
  ]
  // 有正文的章节继续跑单章规则；只有细纲元数据时只报全书级规则。
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const text = chapterText(item)
    if (!text.trim()) continue
    findings.push(
      ...chapterFindings(index, {
        text,
        chapter: item,
        previousChapter: i > 0 ? list[i - 1] : null,
        beats: item.beats ?? null,
        cast: item.cast ?? null,
        params,
      }),
    )
  }
  return sortFindings(dedupeFindings(findings))
}

export const defaultConsistency = { checkChapter, audit }
export default defaultConsistency
