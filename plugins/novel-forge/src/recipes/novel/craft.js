// craft.js — 小说工艺的确定性检查（不调模型）。
// 契约：docs/architecture.md §4.5。review 阶段把这里的 findings 与 LLM findings 合并。
// 只做「机器能判」的事：字数、段落、对话比、AI 腔、重复短语、视角越界、人物缺席。

export const AI_CLICHES = [
  '仿佛',
  '似乎',
  '不禁',
  '缓缓',
  '微微',
  '一丝',
  '嘴角勾起',
  '眼中闪过',
  '空气仿佛凝固',
  '心中五味杂陈',
  '不由得',
  '莫名的',
  '难以言喻',
]

// 与 story-craft/scripts/story_check.py 的词表逐条对齐（只读参考，不要随意增删）。
export const SENSORY_WORDS = [
  // 触 / 温 / 体感
  '冷', '热', '烫', '凉', '冰', '湿', '干', '硬', '软', '粗糙', '滑', '黏',
  '疼', '痛', '麻', '抖', '颤', '汗', '痒', '沉', '轻', '重', '紧', '松',
  // 视
  '亮', '暗', '闪', '晃', '模糊', '反光', '影子', '阴影', '颜色', '红', '灰', '黑', '白',
  // 听
  '响', '哑', '嗡', '砰', '嘶', '吱', '咯吱', '铃', '喘', '脚步', '呼吸', '安静',
  // 嗅 / 味
  '香', '臭', '腥', '霉', '呛', '涩', '腻', '甜', '苦', '咸', '辣', '酸',
]

// 08-C3 的五桶是上面 SENSORY_WORDS 的无重叠切分：只用于配比判断。
// 所有词都取自原表，不新增也不删除，所以 sensoryPer1k 与 parity 一个数都不会变。
export const SENSORY_BUCKETS = {
  visual: ['亮', '暗', '闪', '晃', '模糊', '反光', '影子', '阴影', '颜色', '红', '灰', '黑', '白'],
  audio: ['响', '哑', '嗡', '砰', '嘶', '吱', '咯吱', '铃', '喘', '脚步', '呼吸', '安静'],
  touch: ['冷', '热', '烫', '凉', '冰', '湿', '干', '硬', '软', '粗糙', '滑', '黏'],
  smellTaste: ['香', '臭', '腥', '霉', '呛', '涩', '腻', '甜', '苦', '咸', '辣', '酸'],
  body: ['疼', '痛', '麻', '抖', '颤', '汗', '痒', '沉', '轻', '重', '紧', '松'],
}

export const ABSTRACT_EMOTION_WORDS = [
  '紧张', '害怕', '恐惧', '开心', '高兴', '快乐', '难过', '悲伤', '伤心',
  '愤怒', '生气', '焦虑', '尴尬', '兴奋', '痛苦', '幸福', '感动', '震撼',
  '绝望', '孤独', '委屈', '羞愧', '内疚', '失落', '压抑', '崩溃', '释然',
  '温暖', '满足', '骄傲', '嫉妒', '迷茫', '空虚', '不安', '烦躁', '沮丧',
  '愉悦', '欣慰', '心酸', '无助', '疲惫', '惶恐', '惊愕', '怅然',
]

export const ADVERBS = ['很', '非常', '十分', '特别', '极其', '格外', '异常', '无比', '相当', '颇为']

// 06-R3 的 9 个万能副词。与上面 10 个程度副词是两套尺子，不要合并、不要互改。
export const UNIVERSAL_ADVERBS = ['缓缓', '微微', '轻轻', '淡淡', '静静', '默默', '悄悄', '悠悠', '徐徐']

/**
 * AI 腔模式表，与 story_check.py 的 AI_PATTERNS 一一对应。
 * 正则必须带全局标记；统计时每次重新克隆（或重置 lastIndex），不要复用带状态的实例。
 * 注意「仿佛 / 似乎」同时也在 AI_CLICHES 里，aiMarkerCount 统计时按命中区间合并去重。
 */
export const AI_PATTERNS = [
  { re: /不是[^，。！？\n]{2,24}[，,]?\s*而是/g, label: '「不是…而是」排比' },
  { re: /不仅仅?是[^，。！？\n]{2,24}[，,]?\s*更是/g, label: '「不仅仅…更是」抬高' },
  { re: /仿佛/g, label: '「仿佛」' },
  { re: /似乎/g, label: '「似乎」' },
  { re: /某种[^，。！？\n]{0,8}(?:感觉|情绪|滋味)/g, label: '「某种…感觉」模糊化' },
  { re: /一种[^，。！？\n]{0,10}(?:感觉|情绪|滋味)/g, label: '「一种…感觉」模糊化' },
  { re: /不禁(?:让|令人|使人)/g, label: '「不禁让人」' },
  { re: /(?:不可或缺|淋漓尽致|跃然纸上|值得(?:我们)?(?:深思|铭记))/g, label: '陈词滥调' },
  { re: /在这个[^，。！？\n]{0,10}的时代/g, label: '「在这个…的时代」' },
  { re: /有人[^。\n]{2,24}，有人/g, label: '「有人…有人」三段对称' },
]

const PUNCTUATION = /[\s，。！？；：、“”‘’"'（）()《》〈〉…—·,.!?;:]/
const TRUNCATED = '…（已截断）'

// 引号段口径：dialogueRatio / dialogueTagStats / dialogueTurnStats 共用同一份来源，
// 改口径时只改这里。
const QUOTE_SPAN_SOURCE = '[“"「『]([^”"」』]{1,600})[”"」』]'
const HAN_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/g
const HAN_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]+/g
// 只用于 topBigrams 的可读性，不影响 bigramTtr。
const BIGRAM_STOP = new Set([
  '的了', '一个', '什么', '就是', '没有', '自己', '我们', '他们', '这个', '那个',
  '不是', '时候', '知道', '这样', '起来', '已经', '可以', '现在', '因为', '然后',
])
const QUESTION_TURN = /[？?]|吗|呢|什么|为什么|怎么|哪|谁|多少|多久|多远|几[个点岁天年次月]|是不是|有没有|能不能|要不要|会不会|可不可以|难道/
// 实测：1.1k 字成稿约 0.79–0.81，2.3k 字约 0.70，4.5k 字约 0.68。
// TTR 随篇幅自然下降，取 0.6 只抓「整章重复同一批词」的重度样本，避免误报正常长章。
const BIGRAM_TTR_FLOOR = 0.6

const DEFAULTS = {
  wordsPerChapter: 3000,
  pov: '第三人称限知',
}

const SEVERITY_RANK = { block: 0, warn: 1, note: 2 }

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 3
}

const WORD_FREQUENCY_KINDS = new Set(['ai-cliche', 'ai-density', 'ai-pattern', 'emotion', 'sensory'])

/** Deterministic and review verdicts use the same rule while retaining all findings. */
export function draftVerdict(findings) {
  if (findings.some(({ severity }) => severity === 'block')) return 'revise'
  const warnings = findings.filter(({ severity }) => severity === 'warn')
  return warnings.length >= 3 && warnings.some(({ kind }) => !WORD_FREQUENCY_KINDS.has(kind)) ? 'revise' : 'pass'
}

function visible(text) {
  return String(text ?? '').replace(/\s+/g, '')
}

export function countCjk(text) {
  const matched = String(text ?? '').match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)
  return matched ? matched.length : 0
}

/** 字符二元组集合的 Jaccard 距离，用于估算修订幅度。 */
export function editRate(before, after) {
  if (before === after) return 0
  const bigrams = (text) => {
    const chars = Array.from(text)
    const pairs = new Set()
    for (let i = 1; i < chars.length; i += 1) pairs.add(chars[i - 1] + chars[i])
    return pairs
  }
  const a = bigrams(before)
  const b = bigrams(after)
  let intersection = 0
  for (const pair of a) if (b.has(pair)) intersection += 1
  const union = a.size + b.size - intersection
  return union ? 1 - intersection / union : 1
}

/**
 * 对话字数占正文汉字数的比例（0–1，三位小数）。口径与 story_check.py 的
 * dialogue_ratio 一致：分子是引号内的汉字数，分母是全文汉字数，都排除标点。
 */
export function dialogueRatio(text) {
  const total = countCjk(text)
  if (!total) return 0
  const pattern = new RegExp(QUOTE_SPAN_SOURCE, 'g')
  let chars = 0
  let matched
  while ((matched = pattern.exec(String(text ?? ''))) !== null) {
    chars += countCjk(matched[1])
  }
  return Math.round((chars / total) * 1000) / 1000
}

export function splitParagraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function round1(value) {
  return Math.round(value * 10) / 10
}

/**
 * 切句，规则与 story_check.py 的 split_sentences 完全一致：只在句末标点
 * （。！？!?…）后切，把紧跟的收尾引号并回前一句，丢掉不含汉字的空段。
 * 句长按汉字数计（对应 python 的 cjk_count）。不按分号/换行切——否则与
 * python 的读数对不上，parity 会持续报警。
 */
function statSentences(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n')
  const raw = normalized.split(/(?<=[。！？!?…])/)
  const out = []
  for (const piece of raw) {
    const value = piece.trim()
    if (!value) continue
    if (out.length && /^[」”’"']+$/.test(value)) {
      out[out.length - 1] += value
      continue
    }
    out.push(value)
  }
  return out.filter((sentence) => countCjk(sentence) > 0)
}

/** 句子读数：count / 平均句长 / 最长句 / 短句占比（≤12 字，百分数 0–100）。 */
export function sentenceStats(text) {
  return summarizeSentenceLengths(statSentences(text).map(countCjk))
}

function summarizeSentenceLengths(lens) {
  if (!lens.length) return { count: 0, avgLen: 0, maxLen: 0, shortRatio: 0 }
  const total = lens.reduce((sum, value) => sum + value, 0)
  return {
    count: lens.length,
    avgLen: round1(total / lens.length),
    maxLen: Math.max(...lens),
    shortRatio: round1((100 * lens.filter((value) => value <= 12).length) / lens.length),
  }
}

// 表面词形代理，长后缀优先，避免「维度」重复计作「度」。
function zhProseStats(body, cjk) {
  const per = (hits, scale) => cjk ? (scale * hits) / cjk : 0
  return {
    dePer100: per(countOf(body, '的'), 100),
    beiPer100: per(countOf(body, '被'), 100),
    nominalPer1k: per((body.match(/主义|层面|维度|机制|[性化度感]/g) ?? []).length, 1000),
  }
}

/** 每满 200 个汉字，检查块内是否有 ≤8 字的短句落点。 */
function shortSentenceRhythm(lengths, cjk) {
  const windows = new Set()
  let end = 0
  let short = 0
  for (const length of lengths) {
    end += length
    if (length <= 8) {
      short += 1
      windows.add(Math.floor((end - 1) / 200))
    }
  }
  let missingWindow = 0
  for (let i = 0; i < Math.floor(cjk / 200); i += 1) {
    if (!windows.has(i)) {
      missingWindow = i + 1
      break
    }
  }
  return { per200: cjk ? round1((200 * short) / cjk) : 0, missingWindow }
}

/** 每千汉字命中次数（保留 1 位小数）；空正文返回 0，不除零。 */
export function densityPer1k(text, words) {
  const body = String(text ?? '')
  const cjk = countCjk(body)
  if (!cjk) return 0
  const list = Array.isArray(words) ? words : []
  let hits = 0
  for (const word of list) hits += countOf(body, String(word ?? ''))
  return round1((1000 * hits) / cjk)
}

/**
 * 名单中在正文出现 ≥2 次的不同人名数，再折算到 1500 字 / 1000 字。
 * 空正文 per1500 / per1k 都为 0。
 * per1k 是 03-R5 的口径（≤1.5/千字）；per1500 保留给旧的 >5 note，不要互相替代。
 */
export function distinctNameDensity(text, names) {
  const body = String(text ?? '')
  const cjk = countCjk(body)
  const seen = new Set()
  let distinct = 0
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw ?? '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (countOf(body, name) >= 2) distinct += 1
  }
  return {
    names: distinct,
    per1500: cjk ? round1((1500 * distinct) / cjk) : 0,
    per1k: cjk ? round1((1000 * distinct) / cjk) : 0,
  }
}

function castNames(cast) {
  const names = []
  for (const person of Array.isArray(cast) ? cast : []) {
    const name = String(person?.name ?? '').trim()
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/** 用一个全新的全局正则扫一遍，避免复用 pattern.re 时 lastIndex 串味。 */
function scanPattern(text, pattern) {
  const flags = pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`
  const re = new RegExp(pattern.re.source, flags)
  const matches = []
  let matched
  while ((matched = re.exec(text)) !== null) {
    matches.push({ index: matched.index, text: matched[0] })
    if (matched[0].length === 0) re.lastIndex += 1
  }
  return matches
}

function clip(text, maxChars) {
  const value = String(text ?? '')
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - TRUNCATED.length))}${TRUNCATED}`
}

// 08-C1：普通中文小说用空行分段、不写 ***/※※，所以 fallback 还要认段首的时间/地点转移。
const SCENE_CUES = /^(?:第二天|次日|半小时后|与此同时|夜里|清晨|傍晚|回到|来到|走进)/

function countScenes(text, beats) {
  if (Array.isArray(beats?.scenes) && beats.scenes.length) return beats.scenes.length
  const body = String(text ?? '')
  const separators = body.match(/(?:^|\n)\s*(?:\*\s*\*\s*\*|※{2,}|◇{2,}|—\s*—\s*—)\s*(?:\n|$)/g)
  const soft = splitParagraphs(body).filter((paragraph) => SCENE_CUES.test(paragraph)).length
  return Math.max((separators?.length ?? 0) + 1, soft + 1)
}

function collectCast(beats) {
  const names = []
  const push = (name) => {
    const value = String(name ?? '').trim()
    if (value && !names.includes(value)) names.push(value)
  }
  if (Array.isArray(beats?.cast)) beats.cast.forEach(push)
  for (const scene of beats?.scenes ?? []) {
    const cast = scene?.cast
    if (Array.isArray(cast)) cast.forEach(push)
    else if (typeof cast === 'string') cast.split(/[、,，/]/).forEach(push)
  }
  return names
}

function repeatedPhrase(paragraphs, min = 4) {
  for (let i = 0; i + 2 < paragraphs.length; i += 1) {
    const first = visible(paragraphs[i])
    const second = visible(paragraphs[i + 1])
    const third = visible(paragraphs[i + 2])
    if (first.length < min || second.length < min || third.length < min) continue
    for (let start = 0; start + min <= first.length; start += 1) {
      const gram = first.slice(start, start + min)
      if (PUNCTUATION.test(gram)) continue
      if (second.includes(gram) && third.includes(gram)) {
        return { phrase: gram, from: i + 1, to: i + 3 }
      }
    }
  }
  return null
}

const OMNISCIENT_PATTERNS = [
  { re: /与此同时/g, label: '与此同时' },
  { re: /(?:在|而)(?:城市|世界|房间|大楼|街)的(?:另|那)一端/g, label: '在……的另一端' },
  { re: /殊不知/g, label: '殊不知' },
  { re: /他不知道的是/g, label: '他不知道的是' },
  { re: /没有人知道/g, label: '没有人知道' },
  { re: /镜头(?:转向|拉远|一转)/g, label: '镜头切换' },
]

function pronounFor(gender) {
  if (gender === '男') return '他'
  if (gender === '女') return '她'
  return ''
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

/** 按句末标点切句；只用于代词规则，不参与段落统计。 */
function splitSentences(paragraph) {
  return String(paragraph)
    .split(/[。！？!?；;…]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function genderFindings(body, paragraphs, cast) {
  const people = Array.isArray(cast) ? cast : []
  const names = []
  const declared = []
  for (const person of people) {
    const name = String(person?.name ?? '').trim()
    if (!name) continue
    if (!names.includes(name)) names.push(name)
    const pronoun = pronounFor(person?.gender)
    if (person?.role !== '主角' || !pronoun) continue
    if (!declared.some((item) => item.name === name)) declared.push({ name, gender: person.gender, pronoun })
  }
  if (!declared.length) return []

  const findings = []
  // 规则 1：逐段，段内只有主角一个人物却用了相反代词。
  // 精度上做了两道收窄（真实稿子里「他」经常指段内没点名的人，放宽会全是误报）：
  //   a) 段内已经出现主角的正确代词 → 作者在用两个代词指不同的人，不判；
  //   b) 只在「同句里主角名之后出现相反代词」或「相反代词做下一句主语」时判。
  for (let index = 0; index < paragraphs.length && findings.length < 3; index += 1) {
    const paragraph = paragraphs[index]
    for (const person of declared) {
      if (findings.length >= 3) break
      if (!paragraph.includes(person.name)) continue
      if (paragraph.includes(person.pronoun)) continue
      const wrong = person.pronoun === '他' ? '她' : '他'
      if (!paragraph.includes(wrong)) continue
      const others = names.filter((name) => name !== person.name)
      if (others.some((name) => paragraph.includes(name))) continue
      const sentences = splitSentences(paragraph)
      let drifted = false
      for (let i = 0; i < sentences.length; i += 1) {
        const sentence = sentences[i]
        const at = sentence.indexOf(person.name)
        if (at >= 0 && sentence.indexOf(wrong, at + person.name.length) >= 0) {
          drifted = true
          break
        }
        if (i > 0 && sentences[i - 1].includes(person.name) && sentence.startsWith(wrong)) {
          drifted = true
          break
        }
      }
      if (!drifted) continue
      findings.push({
        severity: 'warn',
        kind: '性别',
        where: `第${index + 1}段`,
        issue: `「${person.name}」是${person.gender}，本段用「${wrong}」指代，段内只有 ${person.name} 一个人物，代词前后不一致`,
        fix: `把本段指代 ${person.name} 的「${wrong}」改成「${person.pronoun}」；若这句写的是别人，补上对方姓名`,
      })
    }
  }

  // 规则 2：整章，主角名多次出现却一次正确代词都没有。规则 1 命中时不重复报。
  if (!findings.length) {
    for (const person of declared) {
      const nameCount = countOf(body, person.name)
      const wrong = person.pronoun === '他' ? '她' : '他'
      if (nameCount < 3) continue
      if (countOf(body, person.pronoun) !== 0) continue
      if (countOf(body, wrong) < 3) continue
      findings.push({
        severity: 'warn',
        kind: '性别',
        where: '全文',
        issue: `整章没有出现「${person.pronoun}」，主角「${person.name}」很可能被写成了另一种性别`,
        fix: `按人物档案把主角的代词统一成「${person.pronoun}」，并检查动作描写是否也写反`,
      })
      break
    }
  }

  return findings
}

// 08-V4：引号格式。按行扫描、栈配对，不用跨段贪婪正则——否则一段里两个对话会互相吃掉。
const QUOTE_OPEN = { '“': '”', '「': '」' }

function quoteFormatFindings(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n')
  const styles = new Set()
  const unclosed = []
  const missing = []
  lines.forEach((line, index) => {
    const stack = []
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at]
      if (QUOTE_OPEN[char]) {
        styles.add(char)
        stack.push({ char, at })
        continue
      }
      if (char !== '”' && char !== '」') continue
      const open = stack.pop()
      if (!open) continue
      const inner = line.slice(open.at + 1, at).trim()
      const before = line.slice(0, open.at).trimEnd()
      const dialogue = before === '' || /[：:，,。！？!?…—]$/.test(before)
      if (dialogue && /[\u4e00-\u9fff]$/.test(inner)) missing.push(index + 1)
    }
    if (stack.length) unclosed.push(index + 1)
  })

  const findings = []
  const where = (list) => `第${[...new Set(list)].slice(0, 3).join('、')}行`
  if (styles.size > 1) {
    findings.push({
      severity: 'note',
      kind: 'quote-mix',
      where: '全章',
      issue: `全角引号混用：${[...styles].join('、')}`,
      fix: '选定一套（横排用“”，竖排或港台用「」），全文统一；嵌套用外双内单',
    })
  }
  if (unclosed.length) {
    findings.push({
      severity: 'note',
      kind: 'quote-unclosed',
      where: where(unclosed),
      issue: `${where(unclosed)}有开引号没有对应的闭引号`,
      fix: '补上闭引号；若引语跨段，按段拆成各自成对的引号',
    })
  }
  if (missing.length) {
    findings.push({
      severity: 'note',
      kind: 'quote-punct',
      where: where(missing),
      issue: `${where(missing)}的对话引号内缺句末标点`,
      fix: '在引号内补上。！？…，或把引语降为句子成分、把标点移到引号外',
    })
  }
  return findings
}

// 08-C2：开篇三句。有环境、却没有冲突/动作/对话时才 note，不拦稿。
const OPENING_ENV = /阳光|月光|天空|云|风|雨|雪|空气|街道|房间|窗外|夜色/
const ACTION_WORDS = /走|跑|推|抓|冲|喊|摔|夺|拽|撞/
const CRISIS_WORDS = /刀|血|死|火|追|逃|警/
const DIALOGUE_OPEN = /[“"「『]/

function openingFindings(body) {
  const opening = statSentences(body).slice(0, 3).join('')
  if (!opening || DIALOGUE_OPEN.test(opening)) return []
  if (ACTION_WORDS.test(opening) || CRISIS_WORDS.test(opening)) return []
  if (!OPENING_ENV.test(opening)) return []
  return [{
    severity: 'note',
    kind: 'opening',
    where: '开头',
    issue: '前 3 句在铺环境，没有冲突或动作',
    fix: '把天气和街景压成一句，第一句就让人物开口、动手或撞上麻烦',
  }]
}

/** 五桶命中数 + 视觉占比（0–1，三位小数）；total 与 sensoryPer1k 的分子同口径。 */
function sensoryBucketCounts(body) {
  const counts = { total: 0 }
  for (const [name, words] of Object.entries(SENSORY_BUCKETS)) {
    counts[name] = words.reduce((sum, word) => sum + countOf(body, word), 0)
    counts.total += counts[name]
  }
  counts.visualRatio = counts.total ? Math.round((counts.visual / counts.total) * 1000) / 1000 : 0
  return counts
}

function sensoryBucketFindings(cjk, buckets) {
  const per1k = cjk ? (1000 * buckets.total) / cjk : 0
  if (per1k < 6 || buckets.visualRatio <= 0.6) return []
  return [{
    severity: 'note',
    kind: 'sensory-vision',
    where: '全章',
    issue: `感官词 ${round1(per1k)}/千字，视觉桶占 ${Math.round(buckets.visualRatio * 100)}%（${buckets.visual}/${buckets.total}），其余四个通道几乎空着`,
    fix: '把一半视觉描写换成温度、材质、气味或身体反应，让读者在场',
  }]
}

// 08-C4 / 06-R6：落点只能是动作或画面；内省收尾让下一章没有拉力。
const ENDING_SUMMARY = /终于|原来|明白|这一切|从此|就这样|说到底|归根结底|算是/
const ENDING_REFLECT = /明白|终于|原来|意识到|知道|懂得|才懂/
const ENDING_SOFT = /(?:了|吧|呢)。[」”]?$/

function endingFindings(body) {
  const summary = body.slice(-80)
  if (ENDING_SUMMARY.test(summary)) {
    return [{
      severity: 'note',
      kind: 'ending-summary',
      where: '结尾',
      issue: `末 80 字出现总结词（${summary.match(ENDING_SUMMARY)[0]}），章末在替读者下结论`,
      fix: '删掉总结，换成人物最后一个动作或停住的画面，让读者自己收',
    }]
  }
  const last = statSentences(body.slice(-120)).pop() ?? ''
  if (!last) return []
  const reflective = ENDING_REFLECT.test(last) || (ENDING_SOFT.test(last) && !ACTION_WORDS.test(last))
  if (!reflective) return []
  return [{
    severity: 'note',
    kind: 'ending-mode',
    where: '结尾',
    issue: `末句以议论收尾：「${clip(last, 30)}」，不是动作或画面`,
    fix: '把「明白/知道/原来」改成人物做完的动作，或停在一个状态变了的物件上',
  }]
}

// 05-R7 / 08-V3：对话标签。只数引语外、同一行、贴着引号的「说/道/问/答/喊」；
// 引语内的字不算，动作节拍不算。「道/问/答」先排除 知道、街道、问题、答案 这类词。
const TAG_VERBS = /[说道问答喊]/g
const TAG_TAIL = /[道着了]/
const TAG_PREV_BLOCK = {
  说: /[听虽就再小假解]/,
  道: /[知街味难管报轨通频公地霸赤王称一]/,
  问: /[学疑]/,
  答: /[解]/,
}
const TAG_NEXT_BLOCK = {
  说: /[明服法不]/,
  道: /[歉路理德具士教观谢白]/,
  问: /[题号候世责卷]/,
  答: /[案卷题]/,
}
const TAG_CLAUSE_BREAK = /[，。！？；：、…—\n]/

function isSpeechTag(text, index, verb) {
  const prev = text[index - 1] ?? ''
  const next = text[index + 1] ?? ''
  if (TAG_PREV_BLOCK[verb]?.test(prev)) return false
  if (TAG_NEXT_BLOCK[verb]?.test(next)) return false
  return true
}

/**
 * 对话标签读数（05-R7）：
 * - 分子只数引语外、同一行、贴着引号的「说/道/问/答/喊」；「说道」「问着」只算一个。
 * - dialogueCjk 与 dialogueRatio 的分子同口径（引号内汉字）。
 * - 密度阈值用正文的「每 100 字对话 ≤2」；per100Sentences 只做展示，不参与判定
 *   （合同里的「标签数/100 句」与 05-R7 的每百字口径不同，按正文阈值执行）。
 * - 副词标签：说/道 前 8 字、同一小句内命中 ADVERBS，记一次；一次出现即超限（08-V3）。
 */
function dialogueTagStats(body) {
  const text = String(body ?? '')
  const sentences = statSentences(text)
  const spanPattern = new RegExp(QUOTE_SPAN_SOURCE, 'g')
  const tags = []
  const seen = new Set()
  let dialogueCjk = 0
  let matched
  while ((matched = spanPattern.exec(text)) !== null) {
    const start = matched.index
    const end = spanPattern.lastIndex
    dialogueCjk += countCjk(matched[1])
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const lineBreak = text.indexOf('\n', end)
    const lineEnd = lineBreak === -1 ? text.length : lineBreak
    const windows = [
      [Math.max(lineStart, start - 12), start],
      [end, Math.min(lineEnd, end + 16)],
    ]
    for (const [from, to] of windows) {
      const window = text.slice(from, to)
      const verbPattern = new RegExp(TAG_VERBS.source, 'g')
      let hit
      while ((hit = verbPattern.exec(window)) !== null) {
        const index = from + hit.index
        const verb = hit[0]
        if (seen.has(index)) continue
        if (!isSpeechTag(text, index, verb)) continue
        seen.add(index)
        const next = text[index + 1] ?? ''
        const clause = text
          .slice(Math.max(0, index - 8), index)
          .split(TAG_CLAUSE_BREAK)
          .pop() ?? ''
        const adverb = (verb === '说' || verb === '道') ? ADVERBS.find((word) => clause.includes(word)) : ''
        tags.push({ verb, adverb })
        // 「说道」「说着」「问了」：尾巴属于同一个标签，别把「道/着/了」再算一个。
        if (TAG_TAIL.test(next)) verbPattern.lastIndex = hit.index + 2
      }
    }
  }
  const adverbTags = tags.filter((tag) => tag.adverb)
  return {
    count: tags.length,
    dialogueCjk,
    dialogueSentences: sentences.filter((sentence) => DIALOGUE_OPEN.test(sentence)).length,
    per100Chars: dialogueCjk ? round1((100 * tags.length) / dialogueCjk) : 0,
    per100Sentences: sentences.length ? round1((100 * tags.length) / sentences.length) : 0,
    adverbCount: adverbTags.length,
    adverbRatio: tags.length ? Math.round((adverbTags.length / tags.length) * 1000) / 1000 : 0,
    adverbWords: [...new Set(adverbTags.map((tag) => tag.adverb))],
    verbs: [...new Set(tags.map((tag) => tag.verb))],
  }
}

/**
 * 05-R7 / 08-V3：标签过密的对话 → warn。
 * 05-R7 的「>2 个/100 字对话」按平均行宽标定，中文短句对话一行只有 7–9 字，
 * 一话一标就会轻易过线（仓库 baseline fixture 是 13.8/100 字，属正常写法），
 * 所以判据按对话行算：一行一个标签是常态，**超过 1.5 个/行**才算「每句都贴标签」。
 * 副词标签仍是「一次即 0」的绝对规则。
 */
function tagFindings(body, metrics = dialogueTagStats(body)) {
  const lines = metrics.dialogueSentences
  const perLine = lines ? metrics.count / lines : 0
  const densityExceeded = metrics.count >= 3 && perLine > 1.5
  const adverbExceeded = metrics.adverbCount > 0
  if (!densityExceeded && !adverbExceeded) return []
  const parts = [
    `对话标签 ${metrics.count} 个 / ${lines} 行对话（${Math.round(perLine * 100) / 100} 个/行，${metrics.per100Chars}/100 字）`,
  ]
  if (densityExceeded) {
    const examples = metrics.verbs.slice(0, 3).map((verb) => `「${verb}」`).join('、')
    parts.push(`一行里贴了不止一个标签${examples ? `，标签用词：${examples}` : ''}`)
  }
  if (adverbExceeded) {
    const words = metrics.adverbWords.slice(0, 3).map((word) => `「${word}」`).join('、')
    parts.push(`副词标签 ${metrics.adverbCount} 个（占 ${Math.round(metrics.adverbRatio * 100)}%，如 ${words}）`)
  }
  return [{
    severity: 'warn',
    kind: 'dialogue-tag',
    where: '全章',
    issue: parts.join('；'),
    fix: '把一半「说/道」换成动作节拍（放下杯子、抬头、停住），删掉说/道前的程度副词，让台词自己带情绪',
  }]
}

/**
 * 词汇丰富度（capability-2026-11）：二字组多样性、汉字多样性、高频二字组 top5。
 * 二字组只在连续汉字串内取：标点、空白、换行都断开，不跨词边界造组。
 * bigramTtr 是纯比值；topBigrams 只做可读性过滤（cast 人名 + 20 组功能词），
 * 不影响 bigramTtr 的分子分母。
 */
function vocabStats(body, names = []) {
  const text = String(body ?? '')
  const counts = new Map()
  let total = 0
  for (const run of text.match(HAN_RUN) ?? []) {
    for (let index = 0; index + 1 < run.length; index += 1) {
      const gram = run.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
      total += 1
    }
  }
  const nameGrams = new Set()
  for (const raw of names) {
    const name = String(raw ?? '').trim()
    for (let index = 0; index + 1 < name.length; index += 1) {
      nameGrams.add(name.slice(index, index + 2))
    }
  }
  const topBigrams = [...counts.entries()]
    .filter(([gram]) => !BIGRAM_STOP.has(gram) && !nameGrams.has(gram))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 5)
    .map(([gram, count]) => ({ gram, count }))
  const chars = text.match(HAN_CHAR) ?? []
  return {
    bigramTtr: total ? Math.round((counts.size / total) * 10000) / 10000 : 0,
    charVariety: chars.length ? Math.round((new Set(chars).size / chars.length) * 10000) / 10000 : 0,
    topBigrams,
  }
}

/**
 * 对话张力（capability-2026-11）：以引号段为一轮。
 * 引号口径复用 QUOTE_SPAN_SOURCE，与 dialogueRatio / dialogueTagStats 同源。
 * actionBetweenRatio 的分母是相邻轮次对数（turnCount-1）：轮间文本只要有汉字
 * 就算夹了叙事——包括「他说」这类标签句，宁可少报也不漏报。
 */
function dialogueTurnStats(body) {
  const text = String(body ?? '')
  const pattern = new RegExp(QUOTE_SPAN_SOURCE, 'g')
  const turns = []
  let matched
  while ((matched = pattern.exec(text)) !== null) {
    turns.push({ text: matched[1], start: matched.index, end: pattern.lastIndex })
  }
  const turnCount = turns.length
  const turnLens = turns.map((turn) => countCjk(turn.text))
  const avgTurnLen = turnCount
    ? round1(turnLens.reduce((sum, value) => sum + value, 0) / turnCount)
    : 0
  const questionTurns = turns.filter((turn) => QUESTION_TURN.test(turn.text)).length
  const questionRatio = turnCount
    ? Math.round((questionTurns / turnCount) * 1000) / 1000
    : 0
  let withAction = 0
  for (let index = 0; index + 1 < turnCount; index += 1) {
    if (countCjk(text.slice(turns[index].end, turns[index + 1].start)) > 0) withAction += 1
  }
  const gaps = turnCount - 1
  return {
    turnCount,
    avgTurnLen,
    questionRatio,
    actionBetweenRatio: gaps > 0 ? Math.round((withAction / gaps) * 1000) / 1000 : 0,
  }
}

function vocabFindings(metrics) {
  if (metrics.cjk < 800 || metrics.bigramTtr >= BIGRAM_TTR_FLOOR) return []
  const examples = metrics.topBigrams.slice(0, 3).map((item) => `「${item.gram}」`).join('、')
  return [{
    severity: 'note',
    kind: 'vocab-flat',
    where: '全章',
    issue: `二字组多样性 ${metrics.bigramTtr}，低于 ${BIGRAM_TTR_FLOOR}：整章在重复同一批词${examples ? `（高频组：${examples}）` : ''}`,
    fix: '把重复的二字组换掉一半：同义动词/名词轮换，合并复述同一动作的句子，删掉纯过渡的重复短句',
  }]
}

function dialogueTensionFindings(metrics) {
  if (metrics.cjk < 800 || metrics.turnCount < 8) return []
  const findings = []
  if (metrics.actionBetweenRatio < 0.25) {
    findings.push({
      severity: 'note',
      kind: 'dialogue-flat',
      where: '全章',
      issue: `对话 ${metrics.turnCount} 轮，轮间夹叙事的比例 ${metrics.actionBetweenRatio}，低于 0.25：整段是纯台词接力，动作和环境没进场`,
      fix: '在每两三轮之间插一个动作节拍或环境反应（放下杯子、看门口、停半拍），让说话的人有身体',
    })
  }
  if (metrics.questionRatio < 0.15) {
    findings.push({
      severity: 'note',
      kind: 'dialogue-no-question',
      where: '全章',
      issue: `对话 ${metrics.turnCount} 轮，含疑问的轮次只占 ${metrics.questionRatio}，低于 0.15：人物只在陈述，没有互相追问`,
      fix: '把两三轮陈述改成追问或反问（「你为什么现在才说？」），让对话有信息差和压迫感',
    })
  }
  return findings
}

// 按区间去重：长框架里的词只算一次（如「空气仿佛凝固」里的「仿佛」）。
function aiMarkers(body) {
  const markers = []
  for (const phrase of AI_CLICHES) {
    let position = body.indexOf(phrase)
    while (position !== -1) {
      markers.push({ label: phrase, start: position, end: position + phrase.length })
      position = body.indexOf(phrase, position + phrase.length)
    }
  }
  for (const pattern of AI_PATTERNS) {
    for (const match of scanPattern(body, pattern)) {
      markers.push({ label: pattern.label, start: match.index, end: match.index + match.text.length })
    }
  }
  markers.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged = []
  for (const marker of markers) {
    if (merged.length && marker.start < merged[merged.length - 1].end) continue
    merged.push(marker)
  }
  return merged
}

/** 同体裁同长度带内的只读风格向量（写作体系 §6.1）。 */
export function styleVector(text) {
  const body = String(text ?? '')
  const cjk = countCjk(body)
  const per1k = (hits) => cjk ? (1000 * hits) / cjk : 0
  // §6.1 将分号算作句界，与 checkDraft 的 story-craft 口径不同。
  const lengths = body.split(/[。！？；]/).map(countCjk).filter(Boolean)
  const avgSentenceLen = lengths.length ? cjk / lengths.length : 0
  const variance = lengths.length
    ? lengths.reduce((sum, length) => sum + (length - avgSentenceLen) ** 2, 0) / lengths.length
    : 0
  const diffs = lengths.slice(1).reduce((sum, length, i) => sum + Math.abs(length - lengths[i]), 0)
  const numberCount = (body.match(/[0-9０-９]+(?:[.．][0-9０-９]+)?(?:[%％]|年)?/g) ?? []).length
  const quoteCount = [...body.matchAll(new RegExp(QUOTE_SPAN_SOURCE, 'g'))].length
  return {
    ...zhProseStats(body, cjk),
    aiMarkerPer1k: per1k(aiMarkers(body).length),
    avgSentenceLen,
    sentenceCv: avgSentenceLen ? Math.sqrt(variance) / avgSentenceLen : 0,
    sentenceDiff: lengths.length > 1 ? diffs / (lengths.length - 1) / avgSentenceLen : 0,
    emptyVerbPer1k: per1k((body.match(/进行|实现|推动|构建|打造|赋能|助力/g) ?? []).length),
    hedgePer1k: per1k((body.match(/或许|可能|在一定程度上|往往|通常/g) ?? []).length),
    concretePer1k: per1k(numberCount + quoteCount),
    cjk,
  }
}

/**
 * 确定性检查。返回 findings（形状同 §4.4）与 stats。
 * @param {{text?: string, params?: object, beats?: object|null, previousHook?: string, cast?: Array<{name?: string, role?: string, gender?: string}>}} input
 */
export function checkDraft({ text = '', params = {}, beats = null, previousHook = '', cast = [] } = {}) {
  const body = String(text ?? '')
  const wordsPerChapter = Number(params.wordsPerChapter) || DEFAULTS.wordsPerChapter
  const pov = params.pov || DEFAULTS.pov

  const paragraphs = splitParagraphs(body)
  const cjk = countCjk(body)
  const ratio = dialogueRatio(body)
  const sentenceLengths = statSentences(body).map(countCjk)
  const sentences = summarizeSentenceLengths(sentenceLengths)
  const zhProse = zhProseStats(body, cjk)
  const shortRhythm = shortSentenceRhythm(sentenceLengths, cjk)
  const castNameList = castNames(cast)
  const nameDensity = distinctNameDensity(body, castNameList)
  const sceneCount = countScenes(body, beats)
  const sensoryBuckets = sensoryBucketCounts(body)
  const tagMetrics = dialogueTagStats(body)
  const vocab = vocabStats(body, castNameList)
  const turns = dialogueTurnStats(body)
  const stats = {
    cjk,
    dialogueRatio: ratio,
    paragraphs: paragraphs.length,
    sceneCount,
    scenePer1k: cjk ? round1((1000 * sceneCount) / cjk) : 0,
    sentences: sentences.count,
    avgSentenceLen: sentences.avgLen,
    maxSentenceLen: sentences.maxLen,
    shortSentenceRatio: sentences.shortRatio,
    short8Per200: shortRhythm.per200,
    dePer100: round1(zhProse.dePer100),
    beiPer100: round1(zhProse.beiPer100),
    nominalPer1k: round1(zhProse.nominalPer1k),
    sensoryPer1k: densityPer1k(body, SENSORY_WORDS),
    sensoryBuckets,
    abstractEmotionPer1k: densityPer1k(body, ABSTRACT_EMOTION_WORDS),
    adverbPer1k: densityPer1k(body, ADVERBS),
    universalAdverbPer1k: densityPer1k(body, UNIVERSAL_ADVERBS),
    aiMarkerCount: 0,
    aiMarkerPer1k: 0,
    nameDensity: nameDensity.per1500,
    namePer1k: nameDensity.per1k,
    dialogueTags: tagMetrics.count,
    dialogueTagPer100Chars: tagMetrics.per100Chars,
    dialogueTagPer100Sentences: tagMetrics.per100Sentences,
    dialogueSentences: tagMetrics.dialogueSentences,
    adverbTagCount: tagMetrics.adverbCount,
    adverbTagRatio: tagMetrics.adverbRatio,
    bigramTtr: vocab.bigramTtr,
    charVariety: vocab.charVariety,
    topBigrams: vocab.topBigrams,
    turnCount: turns.turnCount,
    avgTurnLen: turns.avgTurnLen,
    questionRatio: turns.questionRatio,
    actionBetweenRatio: turns.actionBetweenRatio,
  }

  const findings = []
  const add = (severity, kind, where, issue, fix) => {
    findings.push({ severity, kind, where, issue, fix })
  }

  if (!body.trim()) {
    add('block', 'empty', '全文', '正文为空', '重新生成本章')
    return { findings, stats }
  }

  // 1. 字数
  const ratioToTarget = cjk / wordsPerChapter
  if (ratioToTarget < 0.9 || ratioToTarget > 1.15) {
    const direction = ratioToTarget < 0.9 ? '偏短' : '偏长'
    add(
      'warn',
      'length',
      '全文',
      `正文 ${cjk} 字，目标 ${wordsPerChapter} 字（${(ratioToTarget * 100).toFixed(0)}%），${direction}`,
      direction === '偏短' ? '补足场景细节与人物反应，或合并过快的转折' : '删减重复铺陈，收紧对话与动作描写',
    )
  }

  // 2. 段落
  if (paragraphs.length < 15) {
    add('warn', 'paragraph', '全文', `全文只有 ${paragraphs.length} 段，节奏偏密`, '按动作/对话/心理切开，多分自然段')
  }
  paragraphs.forEach((paragraph, index) => {
    const length = visible(paragraph).length
    if (length > 220) {
      add('note', 'paragraph', `第${index + 1}段`, `单段 ${length} 字，超过 220 字`, '拆成两到三段，留出呼吸')
    }
  })

  // 2b. 场景密度（08-C1）：低于 0.4 像一场戏到底，高于 1.2 切得太碎。
  if (stats.scenePer1k < 0.4) {
    add('note', 'scene', '全章', `场景密度 ${stats.scenePer1k}/千字，低于 0.4/千字，全章像一场戏`, '用空行切开时间/地点转移，或在段首写「第二天」「半小时后」这类转场信号')
  } else if (stats.scenePer1k > 1.2) {
    add('note', 'scene', '全章', `场景密度 ${stats.scenePer1k}/千字，超过 1.2/千字，场景切得太碎`, '把同一时间地点的连续动作并成一场，删掉重复的转场')
  }

  // 3. 对话比例
  if (ratio < 0.08) {
    add(
      'warn',
      'dialogue',
      '全文',
      `对话占比 ${(ratio * 100).toFixed(1)}%，低于 8%，叙述过多`,
      '把关键信息改由人物对话/争执带出，减少转述',
    )
  }
  if (ratio > 0.45) {
    add('note', 'dialogue', '全章', `对话占比 ${(ratio * 100).toFixed(1)}%，超过 45%，动作与场景被对话挤掉`, '把一部分问答改成动作、停顿或环境反应，让对话之间有身体')
  }

  // 4. AI 腔黑名单 + AI 模式。
  const markers = aiMarkers(body)
  const markerCounts = new Map()
  for (const { label } of markers) markerCounts.set(label, (markerCounts.get(label) ?? 0) + 1)
  const aiMarkerCount = markers.length
  stats.aiMarkerCount = aiMarkerCount
  stats.aiMarkerPer1k = cjk ? round1((1000 * aiMarkerCount) / cjk) : 0

  const aiClicheWarn = aiMarkerCount >= 3
  const countedAiMarker = aiClicheWarn ? '（已计入上条 AI 腔统计）' : ''
  if (aiClicheWarn) {
    const detail = [...markerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => `${label}×${count}`)
      .join('、')
    add('warn', 'ai-cliche', '全文', `AI 腔高频词共 ${aiMarkerCount} 次：${detail}`, '逐个换成具体动作或感官细节，删掉程度副词')
  }

  if (stats.aiMarkerPer1k >= 3) {
    add(aiClicheWarn ? 'note' : 'warn', 'ai-density', '全章', `AI 腔标记密度 ${stats.aiMarkerPer1k}/千字，达到 3/千字，跨章比较偏高${countedAiMarker}`, '先删模板句式和套话，再逐句换成具体动作或感官细节')
  }

  // 4b. 「不是…而是…」排比单独提示：这是最容易看出来的模板句式。
  const notButCount = scanPattern(body, AI_PATTERNS[0]).length
  if (notButCount) {
    add(
      aiClicheWarn ? 'note' : 'warn',
      'ai-pattern',
      '全章',
      `出现「不是…而是…」排比 ${notButCount} 次，先否定再抬高的句式像模板${countedAiMarker}`,
      '删掉「不是…」的半句，直接陈述后半句，让信息自己落地',
    )
  }

  // 5. 连续三段重复短语
  const repeated = repeatedPhrase(paragraphs)
  if (repeated) {
    add(
      'note',
      'repeat',
      `第${repeated.from}–${repeated.to}段`,
      `连续三段都出现「${repeated.phrase}」`,
      '换同义表达或删掉一处，避免句式循环',
    )
  }

  // 6. POV 越界（第三人称限知）
  if (pov === '第三人称限知') {
    const labels = []
    for (const pattern of OMNISCIENT_PATTERNS) {
      const matched = body.match(pattern.re)
      if (matched?.length) labels.push(`${pattern.label}×${matched.length}`)
    }
    if (labels.length) {
      add('note', 'pov', '全文', `第三人称限知下出现全知视角信号：${labels.join('、')}`, '改成当前视角人物能看到/听到/推断出的内容')
    }
  }

  // 7. 细纲指定人物缺席
  const beatCast = collectCast(beats)
  const missing = beatCast.filter((name) => !body.includes(name))
  if (missing.length) {
    add(
      'warn',
      'cast',
      '人物',
      `细纲指定人物未出场：${missing.slice(0, 5).join('、')}`,
      '补一场该人物的戏，或确认细纲是否该移除他',
    )
  }

  // 8. 上一章钩子（LLM 检查项，这里只做在场提示，避免误报）
  const hook = String(previousHook ?? '').trim()
  if (hook && !body.includes(hook.slice(0, 4))) {
    add('note', 'hook', '开头', '未见对上一章钩子的直接回应', '开篇一两段先接住上一章留下的问题')
  }

  // 9. 代词一致性（人物档案声明了性别时）
  for (const finding of genderFindings(body, paragraphs, cast)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  // 9b. 引号格式（08-V4）
  for (const finding of quoteFormatFindings(body)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  // 9c. 开篇三句（08-C2）：只在铺环境、没有冲突/动作时 note。
  for (const finding of openingFindings(body)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  // 10. 与 story-craft 对齐的量化指标（阈值来自 story_check.py 的 GATE）。
  // 说明：感官 / 人名密度只在 ≥800 字的正文上判，短片段的比例没有统计意义。
  if (stats.avgSentenceLen > 28) {
    add(
      'warn',
      'sentence-length',
      '全章',
      `平均句长 ${stats.avgSentenceLen} 字，超过 28 字，长句连读会拖慢节奏`,
      '按动作或转折拆成两三句，一句只放一个信息点',
    )
  }

  if (stats.sensoryPer1k < 2 && cjk >= 800) {
    add(
      'warn',
      'sensory',
      '全章',
      `感官词密度 ${stats.sensoryPer1k}/千字，低于 2/千字，画面立不起来`,
      '在关键动作处补一处可感细节：温度、声音、气味或身体反应',
    )
  }

  // 08-C3：总量够、但八成来自视觉桶 → 缺非视觉通道，只 note。
  for (const finding of sensoryBucketFindings(cjk, sensoryBuckets)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  if (stats.abstractEmotionPer1k > 12) {
    add(
      'warn',
      'emotion',
      '全章',
      `抽象情绪词密度 ${stats.abstractEmotionPer1k}/千字，超过 12/千字，情绪在替读者感受`,
      '删掉情绪形容词，只写人物此刻在做什么、身体有什么反应',
    )
  } else if (stats.abstractEmotionPer1k > 6) {
    add(
      'warn',
      'emotion',
      '全章',
      `抽象情绪词密度 ${stats.abstractEmotionPer1k}/千字，超过 6/千字，情绪偏多`,
      '把一半情绪词换成动作、对白或生理反应',
    )
  } else if (stats.abstractEmotionPer1k > 3) {
    add('note', 'emotion', '全章', `抽象情绪词密度 ${stats.abstractEmotionPer1k}/千字，超过 3/千字，情绪可以先落到动作上`, '挑一半情绪词，改成人物此刻的动作、对白或身体反应')
  }

  if (stats.adverbPer1k > 12) {
    add(
      'note',
      'adverb',
      '全章',
      `副词密度 ${stats.adverbPer1k}/千字，超过 12/千字，「很/非常」在替你用力`,
      '删掉程度副词，换成更有力度的动词或具体程度',
    )
  }

  if (stats.universalAdverbPer1k >= 3) {
    add('note', 'adverb-universal', '全章', `万能副词密度 ${stats.universalAdverbPer1k}/千字，达到 3/千字（缓缓/微微/轻轻…），动作在靠副词撑`, '删掉副词，让动词本身带上速度和力度；慢是信息时才保留')
  }

  if (castNameList.length && cjk >= 800 && nameDensity.per1500 > 5) {
    add(
      'note',
      'name-density',
      '全章',
      `活跃人名 ${nameDensity.names} 个，折算 ${nameDensity.per1500} 人/1500 字，超过 5 人，读者要一直记名字`,
      '合并功能重复的配角，或让次要人物只用身份称呼（如「值班员」）',
    )
  }

  // 03-R5：千字具名密度 >1.5 即 note。旧的 >5/1500 note 覆盖更高区间；
  // 旧条一旦命中就不再重复报，保证同一 kind 每章最多一条（旧条阈值/文案不动）。
  if (castNameList.length && cjk >= 800 && stats.namePer1k > 1.5 && !(nameDensity.per1500 > 5)) {
    add(
      'note',
      'name-density',
      '全章',
      `活跃具名 ${nameDensity.names} 人 / ${cjk} 字，千字具名密度 ${stats.namePer1k}，超过 1.5/千字，读者要同时记的名字偏多`,
      '合并功能重复的配角，或让次要人物只用身份称呼（如「值班员」「护士」）；同场只保留一个新具名',
    )
  }

  if (ratio >= 0.08 && ratio < 0.15) {
    add(
      'note',
      'dialogue',
      '全章',
      `对话占比 ${(ratio * 100).toFixed(1)}%，在 8%–15% 之间，低于 15%–45% 的参考区间`,
      '把一段转述改成两人对话，或让对话承担更多冲突与信息',
    )
  }

  // 中文体检只作提示，短片段保留读数、跳过判读。
  if (cjk >= 500) {
    if (zhProse.dePer100 > 5) {
      add('note', 'zh-de-density', '全章', `「的」密度 ${stats.dePer100}/百字，超过 5/百字`, '找出密集的「的」字链，拆开多层修饰')
    }
    if (zhProse.beiPer100 > 1) {
      add('note', 'zh-bei-density', '全章', `「被」密度 ${stats.beiPer100}/百字，超过 1/百字`, '中文被动自带遭受义，逐句核对是否需要保留「被」')
    }
    if (shortRhythm.missingWindow) {
      add('note', 'zh-short-rhythm', `第 ${shortRhythm.missingWindow} 个 200 字区间`, '此处没有 ≤8 字的短句，节奏偏平', '试用短句收住一个动作或段落')
    }
    if (zhProse.nominalPer1k > 25) {
      add('note', 'zh-nominal-density', '全章', `名词化密度 ${stats.nominalPer1k}/千字，超过 25/千字`, '逐处追问是哪个具体事例，用动作或物象落地')
    }
  }

  // 10b. 章末落点（08-C4 / 06-R6）：总结词优先，命中即不再报议论落点。
  for (const finding of endingFindings(body)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  // 10c. 对话标签（05-R7 / 08-V3）：密度 >2/100 字对话，或出现副词标签 → warn。
  for (const finding of tagFindings(body, tagMetrics)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  // 10d. 词汇丰富度 / 对话张力（capability-2026-11）：只判 ≥800 字章节，
  // 短章二字组样本太少、TTR 虚高，一律跳过（宁漏勿误报）。
  for (const finding of vocabFindings(stats)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }
  for (const finding of dialogueTensionFindings(stats)) {
    add(finding.severity, finding.kind, finding.where, finding.issue, finding.fix)
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  return { findings, stats }
}

export const defaultCraft = {
  checkDraft,
  AI_CLICHES,
  SENSORY_WORDS,
  ABSTRACT_EMOTION_WORDS,
  ADVERBS,
  AI_PATTERNS,
  sentenceStats,
  densityPer1k,
  distinctNameDensity,
  countCjk,
  dialogueRatio,
  splitParagraphs,
  severityRank,
}
export default defaultCraft

export { clip as clipText }
