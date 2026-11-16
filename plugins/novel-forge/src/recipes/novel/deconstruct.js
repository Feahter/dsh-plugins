// deconstruct.js — M6「拆书」的本地确定性半段（不调模型、不引入依赖）。
//
// 输入一本现成小说的纯文本，输出可计算的骨架与文风指纹：
//   章节切分 / 章末钩子 / 文风指标 / 场景密度 / 汇总曲线
// 所有函数都是纯函数（文本 → 对象），同一输入两次调用结果深度相等；
// 结果里不放时间戳、随机数、文件路径，方便 lead 之后包成 novel_deconstruct 工具。
//
// 口径约定（全文统一）：
//   - 「字」= 去掉空白后的字符数（String.length 计 code unit，中文在 BMP 内不受影响）；
//     章节 chars / 分母 / 场景密度都用这个口径，章节 chars 之和等于全书 chars。
//   - 句子按句读切：。！？…；，收尾引号并回前一句。
//   - 对话比：分子是引号段内的去空白字符数，分母是全文去空白字符数；
//     引号段正则与 craft.js 的 dialogueRatio 同源（见下方 QUOTE_SPAN_SOURCE）。
//
// 序章处理：第一个标题之前的非空内容单独成章，title 固定为「序」；
// 章标题里的「第X章 / Chapter N」原样保留在 title，index 只是输出顺序（从 1 起）。
//
// 钩子分类口径：只看章末最后一句（按上述句读切），按固定优先级
//   question > reveal > danger > turn > none 命中即停，避免一句里多类词打架。

import { splitParagraphs } from './craft.js'

// craft.js:80 的 QUOTE_SPAN_SOURCE 目前没有 export。本轮契约只允许新建
// 本文件与 test/deconstruct.test.mjs，不能给 craft.js 加 export，因此这里
// 逐字复制该常量的字符串；口径与 craft.js 的 dialogueRatio 保持一致。
// 若之后 craft.js 导出它（或导出复用它的 dialogueRatioText），应改为 import。
const QUOTE_SPAN_SOURCE = '[“"「『]([^”"」』]{1,600})[”"」』]'
const HAN_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]+/g
const SIMILE = /像|仿佛|如同|好似/g
const SENTENCE_END = /[。！？…；]/
const HOOK_END = /[。！？…]/

// ---------------------------------------------------------------- 小工具

function sourceText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n')
}

/** 去空白字符数：本文件所有「字」口径的唯一实现。 */
function charCount(value) {
  return sourceText(value).replace(/\s+/g, '').length
}

function round(value, digits = 3) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

/**
 * 按句读切句，保留句末标点；紧跟在标点后的收尾引号并回前一句。
 * punctuation 默认包含分号（文风统计用），钩子只要 。！？…。
 */
function splitSentences(text, punctuation = SENTENCE_END) {
  const raw = sourceText(text).split(
    new RegExp(`(?<=[${punctuation.source.replace(/^\[|\]$/g, '')}])`),
  )
  const out = []
  for (const piece of raw) {
    const closing = piece.match(/^[”"』」]+/)
    if (closing && out.length) {
      out[out.length - 1] += closing[0]
      const rest = piece.slice(closing[0].length).trim()
      if (rest) out.push(rest)
    } else if (piece.trim()) {
      out.push(piece.trim())
    }
  }
  return out
}

// ---------------------------------------------------------------- 章节切分

const HEADING_RULES = [
  // markdown 标题：^#{1,3} （title 去掉井号）
  (line) => {
    const matched = line.match(/^#{1,3}\s+(.+?)\s*$/)
    return matched ? matched[1].trim() : null
  },
  // 第X章 / 第X回 / 第X节，X 可为中文数字、阿拉伯数字或全角数字。
  // 允许「第一章起风」这种标题紧贴正文；用「行长 ≤ 40 且无句末标点」挡掉
  // 「第一章里，他……」这类正文句子。
  (line) => {
    if (!/^第[0-9０-９零一二三四五六七八九十百千万两]+[章回节]/.test(line)) return null
    if (line.length > 40 || /[。！？]/.test(line)) return null
    return line.trim()
  },
  // Chapter N
  (line) => {
    const matched = line.match(/^chapter\s+\d+\b.*$/i)
    return matched ? line.trim() : null
  },
  // 数字编号：1. / 1、 （排除 1.5 这类小数）
  (line) => {
    const matched = line.match(/^\d+[.、](?!\d).*$/)
    return matched ? line.trim() : null
  },
]

function headingOf(line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  for (const rule of HEADING_RULES) {
    const title = rule(trimmed)
    if (title) return title
  }
  return null
}

/**
 * 切章：只按整行标题正则切，不按长度猜。
 * 没有任何标题时整篇作为 1 章，title「正文」；空文本返回 []。
 * 第一个标题前的非空内容单独成「序」（见文件头口径）。
 */
export function splitChapters(text) {
  const normalized = sourceText(text)
  if (!normalized.trim()) return []

  const lines = normalized.split('\n')
  const chapters = []
  let preface = []
  let current = null

  for (const line of lines) {
    const title = headingOf(line)
    if (!title) {
      if (current) current.lines.push(line)
      else preface.push(line)
      continue
    }
    if (current) {
      chapters.push(current)
    } else if (preface.some((item) => item.trim())) {
      chapters.push({ title: '序', lines: preface })
    }
    current = { title, lines: [] }
  }

  if (current) chapters.push(current)

  if (!chapters.length) {
    const whole = normalized.trim()
    return [{ index: 1, title: '正文', chars: charCount(whole), text: whole }]
  }

  return chapters.map((chapter, position) => {
    const body = chapter.lines.join('\n').trim()
    return {
      index: position + 1,
      title: chapter.title,
      chars: charCount(body),
      text: body,
    }
  })
}

// ---------------------------------------------------------------- 章末钩子

function classifyHook(lastSentence) {
  if (!lastSentence) return 'none'
  const tail = lastSentence.trim()
  // question：句末问号、句末语气词「吗/呢」，或句中出现「难道」
  if (/[？?][”"』」]?$/.test(tail) || /(?:吗|呢)[”"』」]?$/.test(tail) || tail.includes('难道')) {
    return 'question'
  }
  if (/原来|竟是|居然|才明白/.test(tail)) return 'reveal'
  if (/死|血|逃|追|断|冷/.test(tail)) return 'danger'
  if (/却|但|可是/.test(tail)) return 'turn'
  return 'none'
}

/**
 * 章末钩子：取章末最后 1–2 句（不足两句就一句），并按固定优先级分类。
 * paragraphs 可以是段落数组，也可以直接传整章文本（会先按空行拆段）。
 * 返回 { text, sentences, kind }；text 是这 1–2 句的拼接，便于展示。
 */
export function chapterHooks(paragraphs) {
  const blocks = Array.isArray(paragraphs) ? paragraphs : splitParagraphs(paragraphs)
  const source = blocks.join('\n')
  const sentences = splitSentences(source, HOOK_END)
  const tail = sentences.slice(-2)
  const text = tail.join('')
  // 末句判不出类型时回看倒数第二句，再看这两句里有没有问号：中文对话常写成
  // 「「你确定？」老周问。」——问句在前、叙述句收尾，句读还会把引号切开，
  // 只看末句会漏掉这一类钩子。末句有信号时仍以末句为准。
  let kind = classifyHook(tail[tail.length - 1] ?? '')
  if (kind === 'none') kind = classifyHook(tail[tail.length - 2] ?? '')
  // 句读切分会把「「你确定？」老周问。」切成两半，问号可能落在比 tail 更早的一段里，
  // 所以这一层看章末 120 字原文，而不是只看 tail。
  if (kind === 'none' && /[？?]/.test(source.slice(-120))) kind = 'question'
  return {
    text,
    sentences: tail,
    kind,
  }
}

// ---------------------------------------------------------------- 文风指纹

function dialogueRatioOf(text) {
  const total = charCount(text)
  if (!total) return 0
  const pattern = new RegExp(QUOTE_SPAN_SOURCE, 'g')
  // sourceText() 每次调用都对全文做一次 replace：放在循环条件里就是「匹配次数 × 全文长度」，
  // 8MB 输入会撞上工具 60s 超时。全文只规整一次（与 craft.js 的同名函数同口径）。
  const source = sourceText(text)
  let inside = 0
  let matched
  while ((matched = pattern.exec(source)) !== null) {
    inside += charCount(matched[1])
  }
  return round(inside / total, 3)
}

function topBigramsOf(text) {
  const counts = new Map()
  for (const run of sourceText(text).match(HAN_RUN) ?? []) {
    for (let index = 0; index + 1 < run.length; index += 1) {
      const gram = run.slice(index, index + 2)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    // 先按次数降序；同次数按字面升序，保证同一输入的结果稳定。
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 20)
}

/**
 * 文风指纹（全部确定性）：
 *   avgSentenceLen  平均句长（去空白字符数，两位小数）
 *   dialogueRatio   引号段内字符 / 去空白总字符（三位小数）
 *   questionRatio   含问号的句子 / 总句数（三位小数）
 *   similePer1k     每千字「像/仿佛/如同/好似」出现次数（两位小数）
 *   topBigrams      相邻汉字二字组，按次数降序取前 20，[[gram, count], ...]
 */
export function analyzeStyle(text) {
  const source = sourceText(text)
  const sentences = splitSentences(source)
  const total = charCount(source)
  const sentenceChars = sentences.reduce((sum, sentence) => sum + charCount(sentence), 0)
  const questionSentences = sentences.filter((sentence) => /[？?]/.test(sentence)).length
  const similes = (source.match(SIMILE) ?? []).length

  return {
    avgSentenceLen: sentences.length ? round(sentenceChars / sentences.length, 2) : 0,
    dialogueRatio: dialogueRatioOf(source),
    questionRatio: sentences.length ? round(questionSentences / sentences.length, 3) : 0,
    similePer1k: total ? round((similes / total) * 1000, 2) : 0,
    topBigrams: topBigramsOf(source),
  }
}

// ---------------------------------------------------------------- 场景密度

function sceneCountOf(text) {
  return splitParagraphs(text).length
}

/**
 * 场景密度：段落按空行成块，一个块算一场戏。
 * scenesPer1k = 总场景数 /（总字数/1000），两位小数。
 * byChapter 按传入 chapters 的顺序给出每章 sceneCount。
 */
export function sceneDensity(chapters) {
  const list = Array.isArray(chapters) ? chapters : []
  const byChapter = list.map((chapter) => ({
    index: chapter.index,
    sceneCount: sceneCountOf(chapter.text),
  }))
  const sceneCount = byChapter.reduce((sum, item) => sum + item.sceneCount, 0)
  const chars = list.reduce(
    (sum, chapter) => sum + (Number.isFinite(chapter.chars) ? chapter.chars : charCount(chapter.text)),
    0,
  )
  return {
    scenesPer1k: chars ? round((sceneCount / chars) * 1000, 2) : 0,
    sceneCount,
    byChapter,
  }
}

// ---------------------------------------------------------------- 汇总

/**
 * 拆书汇总。text 为空或只有空白时不抛错：
 *   chapters: []、meta.chars: 0，其余指标给零值/空数组。
 * openingHookKinds 取每章第一段的第一句，endingHookKinds 取 chapterHooks 的 kind，
 * 两者分类口径相同。
 */
export function deconstruct({ text = '', title = '' } = {}) {
  const source = sourceText(text)
  const split = splitChapters(source)
  const density = sceneDensity(split)

  const chapters = split.map((chapter, position) => {
    const paragraphs = splitParagraphs(chapter.text)
    return {
      index: chapter.index,
      title: chapter.title,
      chars: chapter.chars,
      dialogueRatio: dialogueRatioOf(chapter.text),
      sceneCount: density.byChapter[position].sceneCount,
      hooks: chapterHooks(paragraphs),
    }
  })

  const chapterChars = chapters.map((chapter) => chapter.chars)
  const openingHookKinds = split.map((chapter) => {
    const firstParagraph = splitParagraphs(chapter.text)[0] ?? ''
    return classifyHook(splitSentences(firstParagraph, HOOK_END)[0] ?? '')
  })

  return {
    meta: {
      title: String(title ?? ''),
      // 正文字数合计（不含章节标题行），与 chapters[].chars / curve.chapterChars 同口径。
      chars: chapters.reduce((sum, chapter) => sum + chapter.chars, 0),
      chapters: chapters.length,
    },
    chapters,
    style: analyzeStyle(source),
    density,
    curve: {
      chapterChars,
      longest: chapterChars.length ? Math.max(...chapterChars) : 0,
      shortest: chapterChars.length ? Math.min(...chapterChars) : 0,
      openingHookKinds,
      endingHookKinds: chapters.map((chapter) => chapter.hooks.kind),
    },
  }
}

export default deconstruct
