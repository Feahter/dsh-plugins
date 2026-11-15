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

export const ABSTRACT_EMOTION_WORDS = [
  '紧张', '害怕', '恐惧', '开心', '高兴', '快乐', '难过', '悲伤', '伤心',
  '愤怒', '生气', '焦虑', '尴尬', '兴奋', '痛苦', '幸福', '感动', '震撼',
  '绝望', '孤独', '委屈', '羞愧', '内疚', '失落', '压抑', '崩溃', '释然',
  '温暖', '满足', '骄傲', '嫉妒', '迷茫', '空虚', '不安', '烦躁', '沮丧',
  '愉悦', '欣慰', '心酸', '无助', '疲惫', '惶恐', '惊愕', '怅然',
]

export const ADVERBS = ['很', '非常', '十分', '特别', '极其', '格外', '异常', '无比', '相当', '颇为']

/**
 * AI 腔模式表，与 story_check.py 的 AI_PATTERNS 一一对应。
 * 正则必须带全局标记；统计时每次重新克隆（或重置 lastIndex），不要复用带状态的实例。
 * 注意「仿佛 / 似乎」同时也在 AI_CLICHES 里，aiMarkerCount 统计时会按起始位置去重。
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

const DEFAULTS = {
  wordsPerChapter: 3000,
  pov: '第三人称限知',
}

const SEVERITY_RANK = { block: 0, warn: 1, note: 2 }

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 3
}

function visible(text) {
  return String(text ?? '').replace(/\s+/g, '')
}

export function countCjk(text) {
  const matched = String(text ?? '').match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)
  return matched ? matched.length : 0
}

/**
 * 对话字数占正文汉字数的比例（0–1，三位小数）。口径与 story_check.py 的
 * dialogue_ratio 一致：分子是引号内的汉字数，分母是全文汉字数，都排除标点。
 */
export function dialogueRatio(text) {
  const total = countCjk(text)
  if (!total) return 0
  const pattern = /[“"「『]([^”"」』]{1,600})[”"」』]/g
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
  const sentences = statSentences(text)
  const lens = sentences.map((sentence) => countCjk(sentence))
  if (!lens.length) return { count: 0, avgLen: 0, maxLen: 0, shortRatio: 0 }
  const total = lens.reduce((sum, value) => sum + value, 0)
  return {
    count: lens.length,
    avgLen: round1(total / lens.length),
    maxLen: Math.max(...lens),
    shortRatio: round1((100 * lens.filter((value) => value <= 12).length) / lens.length),
  }
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
 * 名单中在正文出现 ≥2 次的不同人名数，再折算到 1500 字。
 * 空正文 per1500 为 0。
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
  return { names: distinct, per1500: cjk ? round1((1500 * distinct) / cjk) : 0 }
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

function countScenes(text, beats) {
  if (Array.isArray(beats?.scenes) && beats.scenes.length) return beats.scenes.length
  const separators = String(text ?? '').match(/(?:^|\n)\s*(?:\*\s*\*\s*\*|※{2,}|◇{2,}|—\s*—\s*—)\s*(?:\n|$)/g)
  return (separators?.length ?? 0) + 1
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
  const sentences = sentenceStats(body)
  const castNameList = castNames(cast)
  const nameDensity = distinctNameDensity(body, castNameList)
  const stats = {
    cjk,
    dialogueRatio: ratio,
    paragraphs: paragraphs.length,
    sceneCount: countScenes(body, beats),
    sentences: sentences.count,
    avgSentenceLen: sentences.avgLen,
    maxSentenceLen: sentences.maxLen,
    shortSentenceRatio: sentences.shortRatio,
    sensoryPer1k: densityPer1k(body, SENSORY_WORDS),
    abstractEmotionPer1k: densityPer1k(body, ABSTRACT_EMOTION_WORDS),
    adverbPer1k: densityPer1k(body, ADVERBS),
    aiMarkerCount: 0,
    nameDensity: nameDensity.per1500,
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
  if (ratioToTarget < 0.75 || ratioToTarget > 1.35) {
    const direction = ratioToTarget < 0.75 ? '偏短' : '偏长'
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

  // 4. AI 腔黑名单 + AI 模式。计数 = 词表命中 + 模式命中，按起始位置去重，
  // 同一处（例如 AI_CLICHES 的「仿佛」与 AI_PATTERNS 的「仿佛」）只算一次。
  const hits = []
  const covered = new Set()
  let clicheHits = 0
  for (const phrase of AI_CLICHES) {
    let count = 0
    let position = body.indexOf(phrase)
    while (position !== -1) {
      covered.add(position)
      count += 1
      position = body.indexOf(phrase, position + phrase.length)
    }
    if (count) {
      hits.push({ phrase, count })
      clicheHits += count
    }
  }
  const patternCounts = []
  for (const pattern of AI_PATTERNS) {
    let count = 0
    for (const match of scanPattern(body, pattern)) {
      if (covered.has(match.index)) continue
      count += 1
    }
    if (count) patternCounts.push({ label: pattern.label, count })
  }
  const aiMarkerCount = clicheHits + patternCounts.reduce((sum, item) => sum + item.count, 0)
  stats.aiMarkerCount = aiMarkerCount

  if (aiMarkerCount >= 3) {
    hits.sort((a, b) => b.count - a.count)
    patternCounts.sort((a, b) => b.count - a.count)
    const detail = [
      ...hits.map((hit) => `${hit.phrase}×${hit.count}`),
      ...patternCounts.map((item) => `${item.label}×${item.count}`),
    ]
      .slice(0, 6)
      .join('、')
    add('warn', 'ai-cliche', '全文', `AI 腔高频词共 ${aiMarkerCount} 次：${detail}`, '逐个换成具体动作或感官细节，删掉程度副词')
  }

  // 4b. 「不是…而是…」排比单独提示：这是最容易看出来的模板句式。
  const notButCount = scanPattern(body, AI_PATTERNS[0]).length
  if (notButCount) {
    add(
      'warn',
      'ai-pattern',
      '全章',
      `出现「不是…而是…」排比 ${notButCount} 次，先否定再抬高的句式像模板`,
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

  if (stats.abstractEmotionPer1k > 12) {
    add(
      'block',
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

  if (castNameList.length && cjk >= 800 && nameDensity.per1500 > 5) {
    add(
      'note',
      'name-density',
      '全章',
      `活跃人名 ${nameDensity.names} 个，折算 ${nameDensity.per1500} 人/1500 字，超过 5 人，读者要一直记名字`,
      '合并功能重复的配角，或让次要人物只用身份称呼（如「值班员」）',
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
