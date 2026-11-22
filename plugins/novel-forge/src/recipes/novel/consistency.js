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

// 「活着」语义优先于「死」：死里逃生、九死一生这类值里含「死」但结论是人还活着。
// 顺序不能反：先放行、再判未卜、最后才判死，否则会被 /死|亡/ 误杀。
const ALIVE_STATE = /复活|存活|活着|生还|未死|没死|还活着|活下来|^活$|死里逃生|九死一生|死而复生|险死还生|劫后余生|诈死|假死/
const DEATH_STATE = /死|亡|遇害|殒命|丧命|毙命|遇刺|被杀/

function deathState(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (ALIVE_STATE.test(text)) return 'alive'
  if (/生死未卜|生死不明/.test(text)) return null
  if (DEATH_STATE.test(text)) return 'death'
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
    const text = String(thread.text ?? thread.title ?? thread.id ?? '').trim() || thread.id || opened
    // dueIn 是「预计第几章回收」的绝对章号（plan.js:37 / canon.js:227），直接和当前章号比；
    // 只有章节 id 不是 chNNNN 形状时才退化成相对章数。
    const due = Math.floor(Number(thread.dueIn))
    const hasDue = Number.isFinite(due) && due >= 1
    if (hasDue) {
      const overdue = currentNum != null ? currentNum > due : distance != null && distance > due
      if (!overdue) continue
      const reached = currentNum != null ? `第 ${currentNum} 章` : `自 ${opened} 起 ${distance ?? '?'} 章后`
      findings.push({
        severity: 'warn',
        kind: 'thread-stale',
        where: opened,
        issue: `线索「${text}」计划第 ${due} 章回收，已到${reached}（自 ${opened} 起已 ${distance} 章）`,
        fix: '在本章或近期安排回收；如果计划已变，更新 thread.dueIn，或标 closed 并写 closedIn / payoff',
      })
      continue
    }
    if (distance == null || distance < 40) continue
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

const TURN_CHANGE_MARKS = ['从', '到', '变', '再也', '改', '失去', '得到']
const MIDPOINT_MIN = 0.42
const MIDPOINT_MAX = 0.58

/** turn 必须能复述成「从 X 到 Y」；老项目 turn 是自由文本，只 note 不 block。 */
function turnFindings(list) {
  const findings = []
  for (const item of list) {
    const turn = String(item?.turn ?? '').trim()
    if (!turn) continue
    const restatable =
      turn.length >= 8 && TURN_CHANGE_MARKS.some((mark) => turn.includes(mark))
    if (restatable) continue
    const where = whereOf(item)
    findings.push({
      severity: 'note',
      kind: 'turn-flat',
      where,
      issue: `「${where}」的 turn 读不出「从 X 到 Y」：「${turn}」`,
      fix: '把 turn 写成可复述的状态变更（从…到…、再也…、失去…）；只是提示，不阻塞',
    })
  }
  return findings
}

/** 全书中点：0<v<1 视为占全书比例，>=1 视为章号；缺省/非法完全静默。 */
function midpointOf(outline, total) {
  const raw = Number(outline?.midpointChapter)
  if (!Number.isFinite(raw) || raw <= 0 || !(total > 0)) return null
  if (raw < 1) return { ratio: raw, chapter: Math.max(1, Math.round(raw * total)) }
  const chapter = Math.floor(raw)
  return { ratio: chapter / total, chapter }
}

function midpointFindings(outline, list) {
  const rawTotal = Number(outline?.totalChapters)
  const total = Number.isFinite(rawTotal) && rawTotal > 0 ? Math.floor(rawTotal) : list.length
  const midpoint = midpointOf(outline, total)
  if (!midpoint) return []
  if (midpoint.ratio >= MIDPOINT_MIN && midpoint.ratio <= MIDPOINT_MAX) return []
  const percent = Math.round(midpoint.ratio * 1000) / 10
  return [
    {
      severity: 'note',
      kind: 'midpoint-drift',
      where: '全书',
      issue: `全书 ${total} 章，中点落在第 ${midpoint.chapter} 章（${percent}%），不在 42%–58% 区间`,
      fix: `把中点章挪到第 ${Math.ceil(total * MIDPOINT_MIN)}–${Math.floor(total * MIDPOINT_MAX)} 章之间；若是双中点结构，在脊柱里显式声明`,
    },
  ]
}

function hookStrengthValue(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 0
}

/** 钩子强度只认卷纲 v2 章表里的 hookStrength（plan.chapterFields 产物）；全缺就跳过。 */
function hookFindings(list) {
  const strengths = list.map((item) => hookStrengthValue(item?.hookStrength))
  if (!strengths.some((n) => n > 0)) return []
  const findings = []

  let runStart = -1
  let runLength = 0
  const flush = (endIndex) => {
    if (runLength < 3) return
    const from = whereOf(list[runStart])
    const to = whereOf(list[endIndex])
    const values = strengths.slice(runStart, endIndex + 1).join('/')
    findings.push({
      severity: 'warn',
      kind: 'hook-streak',
      where: from,
      issue: `「${from}」到「${to}」连续 ${runLength} 章钩子强度 ≤2（${values}）`,
      fix: '把其中至少一章的章末钩换成本章冲突的直接后果或新危机，强度提到 3 分以上',
    })
  }
  for (let i = 0; i < strengths.length; i += 1) {
    const n = strengths[i]
    if (n > 0 && n <= 2) {
      if (runLength === 0) runStart = i
      runLength += 1
    } else {
      flush(i - 1)
      runLength = 0
      runStart = -1
    }
  }
  flush(strengths.length - 1)

  const five = strengths.filter((n) => n === 5).length
  const share = strengths.length > 0 ? five / strengths.length : 0
  if (share > 0.2) {
    findings.push({
      severity: 'note',
      kind: 'hook-share',
      where: '全书',
      issue: `全书 ${strengths.length} 章里 ${five} 章钩子强度为 5（${(share * 100).toFixed(1)}%），超过 20%`,
      fix: '把部分 5 分钩降到 3–4 分，把 5 分留给卷末/大转折；不要章章高潮',
    })
  }
  return findings
}

// ---- 全书结构：爽点兑现节奏（payoff，只读 payoff.level；字段缺失即跳过） ----

const PAYOFF_LEVELS = ['none', 'small', 'medium', 'large']
const PAYOFF_REAL_LEVELS = new Set(['small', 'medium', 'large'])

/** 只认卷纲章表里的 payoff.level（plan 章表产物）；缺失或非法返回空串。 */
function payoffLevelOf(chapter) {
  const payoff = chapter?.payoff
  if (!payoff || typeof payoff !== 'object' || Array.isArray(payoff)) return ''
  const level = String(payoff.level ?? '').trim().toLowerCase()
  return PAYOFF_LEVELS.includes(level) ? level : ''
}

function chapterLabelOf(chapter) {
  const title = String(chapter?.title ?? '').trim()
  return title || whereOf(chapter)
}

/** 连续 >5 章没有 small|medium|large 兑现 → 每个断档区间一条 warn；全缺 level 时静默。 */
function payoffGapFindings(list) {
  if (!list.some((item) => payoffLevelOf(item))) return []
  const levels = list.map((item) => payoffLevelOf(item))
  const findings = []
  let runStart = -1
  let runLength = 0
  const flush = (endIndex) => {
    if (runLength <= 5) return
    const start = list[runStart]
    const end = list[endIndex]
    const where = whereOf(start)
    findings.push({
      severity: 'warn',
      kind: 'payoff-gap',
      where,
      issue: `从「${chapterLabelOf(start)}」到「${chapterLabelOf(end)}」连续 ${runLength} 章没有兑现任何承诺（爽点断档）`,
      fix: `在这 ${runLength} 章里插入一次 small 级兑现（payoff.level=small），或把其中一章的 turn 改成「选择 + 代价」（被迫二选一，并付出可感知的损失）`,
    })
  }
  for (let i = 0; i < levels.length; i += 1) {
    if (!PAYOFF_REAL_LEVELS.has(levels[i])) {
      if (runLength === 0) runStart = i
      runLength += 1
    } else {
      flush(i - 1)
      runLength = 0
      runStart = -1
    }
  }
  flush(levels.length - 1)
  return findings
}

/** 卷表成员：优先 outline.volumes[].chapterIds，没有时退回章表里的 volume 字段。 */
function payoffVolumeGroups(list, outline) {
  const byId = new Map()
  for (const item of list) {
    const id = String(item?.id ?? '')
    if (id) byId.set(id, item)
  }
  const groups = []
  for (const volume of asList(outline?.volumes)) {
    const members = asList(volume?.chapterIds)
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
    if (members.length) groups.push({ volume, members })
  }
  if (groups.length) return groups
  const fallback = new Map()
  for (const item of list) {
    const volume = String(item?.volume ?? '').trim()
    if (!volume) continue
    if (!fallback.has(volume)) fallback.set(volume, [])
    fallback.get(volume).push(item)
  }
  for (const [id, members] of fallback) groups.push({ volume: { id }, members })
  return groups
}

/** 卷排完了才判：planned=true 且成员数达到 targetChapters（无目标章数时只看 planned）。 */
function volumeIsComplete(volume, members) {
  if (volume?.planned !== true) return false
  const target = Math.floor(Number(volume?.targetChapters))
  return !(Number.isFinite(target) && target > 0) || members.length >= target
}

/** 单卷 large >3 → 过密；==0 且每章都有 level → 整卷没有大爽点；未排完的卷跳过。 */
function payoffVolumeFindings(list, outline) {
  const findings = []
  for (const { volume, members } of payoffVolumeGroups(list, outline)) {
    if (!volumeIsComplete(volume, members)) continue
    const levels = members.map((item) => payoffLevelOf(item))
    const large = levels.filter((level) => level === 'large').length
    const where = String(volume?.id ?? volume?.title ?? '本卷')
    const label =
      volume?.id && volume?.title
        ? `${volume.id}「${volume.title}」`
        : String(volume?.title ?? volume?.id ?? '本卷')
    if (large > 3) {
      findings.push({
        severity: 'note',
        kind: 'payoff-volume',
        where,
        issue: `「${label}」${members.length} 章里有 ${large} 章 payoff.level=large，大爽点过密（上限 3 章）`,
        fix: `把其中 ${large - 3} 章的 large 降到 medium，把 large 留给卷末主高潮或大转折`,
      })
      continue
    }
    if (large === 0 && levels.length > 0 && levels.every(Boolean)) {
      findings.push({
        severity: 'note',
        kind: 'payoff-volume',
        where,
        issue: `「${label}」整卷 ${members.length} 章都没有 large 级兑现（整卷没有大爽点）`,
        fix: '在本卷高潮章安排一次 large 级兑现（payoff.level=large），让卷末有能记住的大回报',
      })
    }
  }
  return findings
}

/** 黄金三章递进：1 小/中、2 小/中、3 中，且前 3 章出现 large 即报；缺字段整条跳过。 */
function payoffOpeningFindings(list) {
  if (list.length < 3) return []
  const first = list.slice(0, 3)
  const numbers = first.map((item) => chapterNumber(item?.id))
  if (numbers.every((n) => n != null) && !(numbers[0] === 1 && numbers[1] === 2 && numbers[2] === 3)) {
    return []
  }
  const levels = first.map((item) => payoffLevelOf(item))
  if (!levels.every(Boolean)) return []
  const problems = []
  if (levels[0] === 'none') problems.push(`第 1 章 payoff.level=none，应为 small 或 medium`)
  if (levels[1] === 'none') problems.push(`第 2 章 payoff.level=none，应为 small 或 medium`)
  if (levels[2] !== 'medium' && levels[2] !== 'large') {
    problems.push(`第 3 章 payoff.level=${levels[2]}，应为 medium 或 large`)
  }
  const largeAt = []
  for (let i = 0; i < 3; i += 1) if (levels[i] === 'large') largeAt.push(i + 1)
  if (largeAt.length) {
    problems.push(`第 ${largeAt.join('、')} 章出现 large 级兑现，前三章不应提前给大爽点`)
  }
  if (!problems.length) return []
  return [
    {
      severity: 'note',
      kind: 'payoff-opening',
      where: whereOf(first[0]),
      issue: `第 1–3 章的爽点兑现不递进：${problems.join('；')}`,
      fix: '改成第 1 章 small、第 2 章 small 或 medium、第 3 章 medium 的递进；大爽点留到第 4 章之后再给',
    },
  ]
}

function payoffFindings(list, outline) {
  return [
    ...payoffGapFindings(list),
    ...payoffVolumeFindings(list, outline),
    ...payoffOpeningFindings(list),
  ]
}

// ---- 全书结构：首末呼应 / 兑现章专名 / B 线合流（全部 note） -------------

const BOOKEND_GAIN_MARKS = [
  '得到', '获得', '赢得', '赢下', '夺回', '拿回', '收回', '找回', '救下', '救回',
  '成功', '达成', '守住', '护住', '保住', '掌握', '拿下', '占有', '重逢', '团聚',
  '复得', '胜出', '赢了',
]
const BOOKEND_LOSS_MARKS = [
  '失去', '失掉', '丢掉', '丢失', '弄丢', '错过', '放弃', '失败', '落败', '输掉',
  '输了', '被夺', '被抢', '被毁', '毁掉', '毁灭', '破碎', '崩塌', '死去', '死亡',
  '丧命', '离开', '告别', '背叛', '被抓', '被捕', '入狱', '破产', '落空', '成空',
  '牺牲', '没了', '消失',
]

/** turn 的价值方向只认单一信号；同时出现「得到/失去」或都判不出 → 返回空串（跳过）。 */
function bookendDirection(turn) {
  const text = String(turn ?? '')
  if (!text.trim()) return ''
  const gain = BOOKEND_GAIN_MARKS.some((mark) => text.includes(mark))
  const loss = BOOKEND_LOSS_MARKS.some((mark) => text.includes(mark))
  if (gain === loss) return ''
  return gain ? '得到' : '失去'
}

function normalizedWhere(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

/** 首末同地、turn 价值同向 → 回环没有翻转。where 缺失或方向判不出就整条跳过。 */
function bookendFindings(list) {
  if (!Array.isArray(list) || list.length < 2) return []
  const first = list[0]
  const last = list[list.length - 1]
  const firstWhere = normalizedWhere(first?.where)
  const lastWhere = normalizedWhere(last?.where)
  if (!firstWhere || !lastWhere || firstWhere !== lastWhere) return []
  const firstDirection = bookendDirection(first?.turn)
  const lastDirection = bookendDirection(last?.turn)
  if (!firstDirection || firstDirection !== lastDirection) return []
  const where = whereOf(last)
  return [
    {
      severity: 'note',
      kind: 'bookend-flat',
      where,
      issue: `首章与末章都发生在「${firstWhere}」，turn 的价值方向同为「${firstDirection}」；首尾同地同向，回环没有完成翻转`,
      fix: '让末章 turn 反向（得到→失去或相反），或把末章换到与首章不同的 where；开放结局可显式豁免',
    },
  ]
}

// P1-8 只认「常见姓氏 + 1–2 字」，且整章至少出现 2 次；宁可漏报不可误报。
const PAYOFF_SURNAMES = new Set(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯沈'.split(''),
)

function isChapterLikeId(value) {
  return /^(?:ch|chapter|第)?\s*\d+\s*(?:章)?$/i.test(String(value ?? '').trim())
}

/** closedIn 可能是 ch0041 / 41 / 第41章；卷 id（v01）不算章号，避免误配。 */
function sameChapterId(left, right) {
  const a = String(left ?? '').trim().toLowerCase()
  const b = String(right ?? '').trim().toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  if (!isChapterLikeId(a) || !isChapterLikeId(b)) return false
  const an = chapterNumber(a)
  const bn = chapterNumber(b)
  return an != null && an === bn
}

function payoffThreadsOf(index, chapterId) {
  const hits = []
  for (const thread of index.threads) {
    if (!thread || typeof thread !== 'object') continue
    if (sameChapterId(thread.closedIn, chapterId)) hits.push(thread)
  }
  return hits
}

/** 只抽「姓氏字开头 + 1–2 字」的 2–3 字 gram；白名单词先整体遮盖。 */
function payoffNameCounts(body) {
  const counts = new Map()
  const runs = body.replace(COMMON_MASK, '\n').match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? []
  for (const run of runs) {
    for (let start = 0; start < run.length; start += 1) {
      if (!PAYOFF_SURNAMES.has(run[start])) continue
      const maxSize = Math.min(3, run.length - start)
      for (let size = 2; size <= maxSize; size += 1) {
        const gram = run.slice(start, start + size)
        if (NAME_EDGE_STOP.has(gram[gram.length - 1])) continue
        counts.set(gram, (counts.get(gram) ?? 0) + 1)
      }
    }
  }
  return counts
}

function isKnownName(gram, index, castNames) {
  if (index.known.has(gram) || index.knownWords.has(gram) || index.blockedFragments.has(gram)) {
    return true
  }
  if (COMMON_WORDS.has(gram)) return true
  // 3 字候选的前 2 字已是登记名时，按「已知名 + 后缀」处理，宁可漏报。
  if (gram.length >= 3 && index.known.has(gram.slice(0, 2))) return true
  for (const name of index.entityNames) {
    if (name.length >= 2 && (name.includes(gram) || gram.includes(name))) return true
  }
  for (const name of castNames) {
    if (name.length >= 2 && (name.includes(gram) || gram.includes(name))) return true
  }
  return false
}

/** 兑现章（thread.closedIn === 本章）正文里的未登记专名。无 facts / 无线索闭合 → 静默。 */
function payoffNameDriftFindings(index, list) {
  if (!index.facts.length || !list.length) return []
  const findings = []
  for (const item of list) {
    const body = chapterText(item)
    if (!body.trim()) continue
    const threads = payoffThreadsOf(index, item?.id)
    if (!threads.length) continue
    const where = whereOf(item)
    const castNames = chapterCastNames({ chapter: item })
    const counts = payoffNameCounts(body)
    // 若某个 3 字 gram 比它的 2 字前缀出现得不少于，就只报更长的那个。
    const longerMax = new Map()
    for (const [gram, count] of counts) {
      if (gram.length !== 3) continue
      const prefix = gram.slice(0, 2)
      longerMax.set(prefix, Math.max(longerMax.get(prefix) ?? 0, count))
    }
    const candidates = []
    for (const [gram, count] of counts) {
      if (count < 2) continue
      if (gram.length === 2 && (longerMax.get(gram) ?? 0) >= count) continue
      if (isKnownName(gram, index, castNames)) continue
      candidates.push([gram, count])
    }
    candidates.sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    const payoff = threads
      .map((thread) => String(thread.text ?? thread.id ?? '').trim())
      .filter(Boolean)
      .join('、')
    for (const [gram, count] of candidates.slice(0, 5)) {
      findings.push({
        severity: 'note',
        kind: 'name-drift',
        where,
        issue: `「${where}」是线索「${payoff || '未命名线索'}」的兑现章，正文出现「${gram}」${count} 次，但 canon.facts 没有登记这个名字`,
        fix: `若「${gram}」是新人物，先在 canon.entities / facts 登记并补 aliases；若是笔误，统一成已有名字`,
      })
    }
  }
  return findings
}

// P1-C5 兑现质量：引号段口径与 craft.js:80 的 QUOTE_SPAN_SOURCE 逐字一致。
// craft.js 没有导出这个常量，consistency.js 也不想再造第二套口径，所以这里只镜像字符串；
// 改引号口径时必须两处一起改（dialogueRatio / dialogueTagStats / dialogueTurnStats 同源）。
const DIALOGUE_SPAN_SOURCE = '[“"「『]([^”"」』]{1,600})[”"」』]'

// 线索 text → 可检索关键词：先按标点/空白切中文段，再切掉虚词与「线索/伏笔」这类元词。
// 只保留 2–10 字片段；宁漏勿误报，派生不出关键词就整条跳过。
const THREAD_KEYWORD_SPLIT = /一个|这个|线索|伏笔|将在|之后|之前|暗线|埋线|埋下|回收|兑现|[的了是]/g
const THREAD_KEYWORD_MAX = 10
const THREAD_KEYWORD_LIMIT = 8

function threadKeywords(text) {
  const runs = String(text ?? '')
    .replace(/[^\u3400-\u4dbf\u4e00-\u9fff]+/g, '\n')
    .split('\n')
  const seen = new Set()
  const keywords = []
  for (const run of runs) {
    for (const piece of run.split(THREAD_KEYWORD_SPLIT)) {
      if (piece.length < 2 || piece.length > THREAD_KEYWORD_MAX) continue
      if (COMMON_WORDS.has(piece) || seen.has(piece)) continue
      seen.add(piece)
      keywords.push(piece)
    }
  }
  keywords.sort((a, b) => b.length - a.length || compareText(a, b))
  return keywords.slice(0, THREAD_KEYWORD_LIMIT)
}

/** 引号段 [start, end)（含引号本身），口径同 craft.js 的 QUOTE_SPAN_SOURCE。 */
function dialogueSpans(body) {
  const pattern = new RegExp(DIALOGUE_SPAN_SOURCE, 'g')
  const spans = []
  let matched
  while ((matched = pattern.exec(body)) !== null) {
    spans.push([matched.index, matched.index + matched[0].length])
  }
  return spans
}

/** 关键词出现次数，以及其中完整落在引号段内的次数（= 对话里的次数）。 */
function keywordStats(body, keyword, spans) {
  let total = 0
  let inDialogue = 0
  let spanIndex = 0
  let position = body.indexOf(keyword)
  while (position !== -1) {
    total += 1
    while (spanIndex < spans.length && spans[spanIndex][1] <= position) spanIndex += 1
    const span = spans[spanIndex]
    if (span && position >= span[0] && position + keyword.length <= span[1]) inDialogue += 1
    position = body.indexOf(keyword, position + keyword.length)
  }
  return { total, inDialogue, narration: total - inDialogue }
}

/**
 * C5 兑现质量：兑现章里线索关键词出现 ≥2 次，且至少 1 次不在对话里。
 * 只判 thread.closedIn === 本章 的兑现章；无正文、无线索、无可用关键词都静默。
 * 同章若已报 name-drift，则不再叠加 payoff-thin（同一兑现章只提醒一次）。
 */
function payoffThinFindings(index, list, nameDriftFindings = []) {
  if (!list.length) return []
  const closed = index.threads.some(
    (thread) => thread && typeof thread === 'object' && thread.closedIn != null && thread.closedIn !== '',
  )
  if (!closed) return []
  const nameDriftWhere = new Set(nameDriftFindings.map((finding) => finding.where))
  const findings = []
  const spanCache = new Map()
  const countCache = new Map()
  for (const item of list) {
    const body = chapterText(item)
    if (!body.trim()) continue
    const threads = payoffThreadsOf(index, item?.id)
    if (!threads.length) continue
    const where = whereOf(item)
    if (nameDriftWhere.has(where)) continue
    const chapterKey = String(item?.id ?? where)
    let spans = spanCache.get(chapterKey)
    if (!spans) {
      spans = dialogueSpans(body)
      spanCache.set(chapterKey, spans)
    }
    for (const thread of threads) {
      if (!thread || typeof thread !== 'object') continue
      const keywords = threadKeywords(thread.text)
      if (!keywords.length) continue
      const threadLabel = String(thread.text ?? thread.id ?? '').trim() || '未命名线索'
      let best = null
      let landed = false
      for (const keyword of keywords) {
        const cacheKey = `${chapterKey}\u0000${keyword}`
        let stats = countCache.get(cacheKey)
        if (!stats) {
          stats = keywordStats(body, keyword, spans)
          countCache.set(cacheKey, stats)
        }
        if (
          !best ||
          stats.total > best.stats.total ||
          (stats.total === best.stats.total && stats.narration > best.stats.narration) ||
          (stats.total === best.stats.total &&
            stats.narration === best.stats.narration &&
            keyword.length > best.keyword.length)
        ) {
          best = { keyword, stats }
        }
        if (stats.total >= 2 && stats.narration >= 1) {
          landed = true
          break
        }
      }
      if (landed || !best) continue
      const { keyword, stats } = best
      const issue =
        stats.total === 0
          ? `「${where}」是线索「${threadLabel}」的兑现章，但正文里没有出现「${keyword}」：兑现没有落地`
          : stats.total === 1
            ? `「${where}」是线索「${threadLabel}」的兑现章，但正文里「${keyword}」只出现 1 次${stats.inDialogue ? '，且这一次在对话里' : ''}：兑现没有落地`
            : `「${where}」是线索「${threadLabel}」的兑现章，但正文里「${keyword}」出现 ${stats.total} 次，都在对话里：叙述没有落地`
      findings.push({
        severity: 'note',
        kind: 'payoff-thin',
        where,
        issue,
        fix: `把「${keyword}」写进兑现章的叙述（动作、环境或后果），至少 1 次落在引号外；若兑现已不依赖这个词，改线索 text，或把 thread 标成 closed 但不填 closedIn`,
      })
    }
  }
  return findings
}

const B_LINE_MARKERS = [
  { label: 'B 线', re: /B\s*线/i },
  { label: '副线', re: /副线/ },
  { label: '第二条线', re: /第二条线/ },
  { label: '暗线', re: /暗线/ },
]

/** 卷纲 opens 标了 B 线，但 58% 章号之后没有一章的 turn/hook 写到这条线。 */
function bLineFindings(outline, list) {
  const texts = []
  for (const volume of asList(outline?.volumes)) {
    for (const open of asList(volume?.opens)) {
      const text = typeof open === 'string' ? open : open?.text
      if (typeof text === 'string' && text.trim()) texts.push(text.trim())
    }
  }
  const labels = B_LINE_MARKERS.filter((marker) =>
    texts.some((text) => marker.re.test(text)),
  )
  if (!labels.length || !list.length) return []
  const rawTotal = Number(outline?.totalChapters)
  const total = Number.isFinite(rawTotal) && rawTotal > 0 ? Math.floor(rawTotal) : list.length
  if (!(total > 0)) return []
  const threshold = total * 0.58
  const after = list.filter((item, position) => {
    const num = chapterNumber(item?.id) ?? position + 1
    return num > threshold
  })
  const merged = after.some((item) => {
    const body = `${item?.turn ?? ''} ${item?.hook ?? ''}`
    return labels.some((marker) => marker.re.test(body))
  })
  if (merged) return []
  const from = Math.floor(threshold) + 1
  const reach = list.reduce(
    (max, item, position) => Math.max(max, chapterNumber(item?.id) ?? position + 1),
    0,
  )
  return [
    {
      severity: 'note',
      kind: 'bline-unmerged',
      where: '全书',
      issue: `卷纲 opens 里标了「${labels.map((marker) => marker.label).join('、')}」，但第 ${from} 章（58%）之后没有任何一章在 turn/hook 里写到这条线${reach < from ? `（目前只规划到第 ${reach} 章）` : ''}`,
      fix: '在中点后安排 A/B 线人物同场，并让合流事件落在 turn 或章末 hook 里；单线故事请删掉 B 线标记',
    },
  ]
}

export function audit({ chapters = null, canon = null, outline = null, params = {} } = {}) {
  const index = createCanonIndex(canon)
  const list = normalizeChapters(chapters, outline)
  const nameDrift = payoffNameDriftFindings(index, list)
  const findings = [
    ...threadStaleFindings(index.threads, list),
    ...canonConflictFindings(index.facts),
    ...turnFindings(list),
    ...midpointFindings(outline, list),
    ...hookFindings(list),
    ...payoffFindings(list, outline),
    ...bookendFindings(list),
    ...nameDrift,
    ...payoffThinFindings(index, list, nameDrift),
    ...bLineFindings(outline, list),
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

export function normalizeQuoteText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

export function validateFindingQuotes(text, findings, { downgrade = false } = {}) {
  const list = Array.isArray(findings) ? findings : []
  const body = normalizeQuoteText(text)
  return list.map((finding) => {
    const quote = normalizeQuoteText(finding.quote)
    const length = [...quote].length
    const quoted = length >= 8 && length <= 120 && body.includes(quote)
    if (quoted || downgrade !== true) return { ...finding, quoted }

    const severity = finding.severity === 'block' ? 'warn' : finding.severity === 'warn' ? 'note' : finding.severity
    return { ...finding, quoted, severity, issue: `（引文未命中正文）${finding.issue}` }
  })
}

export function countUnquotedFindings(findings) {
  const list = Array.isArray(findings) ? findings : []
  return list.filter((finding) => finding.quoted === false).length
}

export const defaultConsistency = { checkChapter, audit }
export default defaultConsistency
