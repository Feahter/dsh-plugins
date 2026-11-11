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

export function dialogueRatio(text) {
  const total = visible(text).length
  if (!total) return 0
  const pattern = /[“"「『]([^”"」』]{1,600})[”"」』]/g
  let chars = 0
  let matched
  while ((matched = pattern.exec(String(text ?? ''))) !== null) {
    chars += visible(matched[1]).length
  }
  return Math.round((chars / total) * 1000) / 1000
}

export function splitParagraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
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

/**
 * 确定性检查。返回 findings（形状同 §4.4）与 stats。
 * @param {{text?: string, params?: object, beats?: object|null, previousHook?: string}} input
 */
export function checkDraft({ text = '', params = {}, beats = null, previousHook = '' } = {}) {
  const body = String(text ?? '')
  const wordsPerChapter = Number(params.wordsPerChapter) || DEFAULTS.wordsPerChapter
  const pov = params.pov || DEFAULTS.pov

  const paragraphs = splitParagraphs(body)
  const cjk = countCjk(body)
  const ratio = dialogueRatio(body)
  const stats = {
    cjk,
    dialogueRatio: ratio,
    paragraphs: paragraphs.length,
    sceneCount: countScenes(body, beats),
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

  // 4. AI 腔黑名单
  const hits = []
  let totalHits = 0
  for (const phrase of AI_CLICHES) {
    let count = 0
    let position = body.indexOf(phrase)
    while (position !== -1) {
      count += 1
      position = body.indexOf(phrase, position + phrase.length)
    }
    if (count) {
      hits.push({ phrase, count })
      totalHits += count
    }
  }
  if (totalHits >= 3) {
    hits.sort((a, b) => b.count - a.count)
    const detail = hits
      .slice(0, 6)
      .map((hit) => `${hit.phrase}×${hit.count}`)
      .join('、')
    add('warn', 'ai-cliche', '全文', `AI 腔高频词共 ${totalHits} 次：${detail}`, '逐个换成具体动作或感官细节，删掉程度副词')
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
  const cast = collectCast(beats)
  const missing = cast.filter((name) => !body.includes(name))
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

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  return { findings, stats }
}

export const defaultCraft = { checkDraft, AI_CLICHES, countCjk, dialogueRatio, splitParagraphs, severityRank }
export default defaultCraft

export { clip as clipText }
