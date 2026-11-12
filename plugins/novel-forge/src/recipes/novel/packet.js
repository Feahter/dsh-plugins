// packet.js — 单章材料包：把已取出的材料按固定优先级装进 contextBudget。
// 契约：docs/architecture-v2.md §5.2。
// 本模块不读盘、不调模型、不 import canon：canonText 由调用方格式化后传入。
import { assemble } from '../../forge/budget.js'

const DEFAULT_BUDGET = 12000
const DEFAULT_WORDS = 3000
const DEFAULT_POV = '第三人称限知'
const DEFAULT_BANNED = ['……', '突然', '不由得']

const BEAT_FIELDS = [
  ['goal', '目标'],
  ['conflict', '冲突'],
  ['turn', '转折'],
  ['hook', '钩子'],
  ['rhythm', '节奏'],
  ['pacing', '节奏'],
]

const SCENE_FIELDS = [
  ['goal', '目标'],
  ['conflict', '冲突'],
  ['turn', '转折'],
  ['hook', '钩子'],
  ['when', '时间'],
  ['where', '地点'],
]

/** 分片固定表（顺序即拼装顺序）。 */
export const SLICE_SPEC = [
  { name: 'brief', title: '写作要求', cap: 900, priority: 0, required: true },
  { name: 'beats', title: '本章细纲', cap: 2500, priority: 1, required: false },
  { name: 'previous', title: '上一章结尾', cap: 800, priority: 2, required: false },
  { name: 'recent', title: '最近三章', cap: 1200, priority: 2, required: false },
  { name: 'digest', title: '本卷前情', cap: 1000, priority: 3, required: false },
  { name: 'canon', title: '正典', cap: 3200, priority: 3, required: false },
  { name: 'cast', title: '本章出场人物', cap: 1500, priority: 4, required: false },
  { name: 'next', title: '下一章目标', cap: 300, priority: 5, required: false },
  { name: 'style', title: '文风', cap: 1200, priority: 6, required: false },
]

const REVISION_SPEC = { name: 'revision', title: '需修正', cap: 1500, priority: 0, required: true }

function textOf(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clipValue(value, max = 600) {
  const text = textOf(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function render(slice) {
  return slice.title ? `## ${slice.title}\n${slice.text}` : slice.text
}

function normalizeBeats(beats) {
  if (beats === undefined || beats === null) return ''
  if (typeof beats === 'string') return beats.trim()
  if (Array.isArray(beats)) return renderScenes(beats)
  if (typeof beats !== 'object') return textOf(beats)

  const lines = []
  const seen = new Set()
  for (const [key, label] of BEAT_FIELDS) {
    if (seen.has(label)) continue
    const value = beats[key]
    if (value === undefined || value === null || value === '') continue
    seen.add(label)
    lines.push(`${label}：${textOf(value)}`)
  }
  if (Array.isArray(beats.beats) && beats.beats.length > 0) {
    lines.push(`节拍：\n${renderScenes(beats.beats)}`)
  }
  if (Array.isArray(beats.scenes) && beats.scenes.length > 0) {
    lines.push(`场景：\n${renderScenes(beats.scenes)}`)
  }
  // 未知字段 JSON 化后截断，保证材料不丢但也不撑爆分片。
  const known = new Set(['goal', 'conflict', 'turn', 'hook', 'rhythm', 'pacing', 'beats', 'scenes'])
  for (const [key, value] of Object.entries(beats)) {
    if (known.has(key)) continue
    if (value === undefined || value === null) continue
    lines.push(`${key}：${clipValue(value, 400)}`)
  }
  return lines.join('\n')
}

function renderScenes(scenes) {
  return scenes
    .map((scene, index) => {
      if (typeof scene === 'string') return `- 场景 ${index + 1}：${scene}`
      if (!scene || typeof scene !== 'object') return `- 场景 ${index + 1}：${textOf(scene)}`
      const parts = []
      for (const [key, label] of SCENE_FIELDS) {
        if (scene[key] === undefined || scene[key] === null || scene[key] === '') continue
        parts.push(`${label}：${clipValue(scene[key], 200)}`)
      }
      const body = parts.length > 0 ? parts.join('；') : clipValue(scene, 400)
      return `- 场景 ${index + 1}：${body}`
    })
    .join('\n')
}

function formatFindings(findings) {
  if (findings === undefined || findings === null) return ''
  if (typeof findings === 'string') return findings.trim()
  if (Array.isArray(findings)) {
    return findings
      .map((item, index) => {
        if (typeof item === 'string') return `${index + 1}. ${item}`
        return `${index + 1}. ${clipValue(item, 400)}`
      })
      .join('\n')
  }
  if (typeof findings === 'object') {
    const lines = []
    for (const [key, value] of Object.entries(findings)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) lines.push(`${key}：\n${value.map((v) => `- ${clipValue(v, 300)}`).join('\n')}`)
      else lines.push(`${key}：${clipValue(value, 500)}`)
    }
    return lines.join('\n')
  }
  return textOf(findings)
}

/**
 * 本章硬性写作要求。
 * @param {{params?:object, chapter?:object}} input
 * @returns {{words:number, pov:string, banned:string[]}}
 */
export function chapterRequirements({ params, chapter } = {}) {
  const p = params && typeof params === 'object' ? params : {}
  const c = chapter && typeof chapter === 'object' ? chapter : {}
  const rawWords = Number(c.words ?? p.wordsPerChapter)
  const words = Number.isFinite(rawWords) && rawWords > 0 ? Math.round(rawWords) : DEFAULT_WORDS
  const pov = textOf(c.pov ?? p.pov).trim() || DEFAULT_POV
  return { words, pov, banned: [...DEFAULT_BANNED] }
}

function renderBrief({ params, chapter, volume, mode }) {
  const c = chapter && typeof chapter === 'object' ? chapter : {}
  const req = chapterRequirements({ params, chapter })
  const lines = []
  const id = textOf(c.id).trim()
  const title = textOf(c.title).trim()
  lines.push(id ? `章号：${id}` : '章号：（待定）')
  lines.push(`标题：${title || '（未命名）'}`)
  const volumeTitle = textOf(volume?.title).trim()
  if (volumeTitle) lines.push(`所属卷：${volumeTitle}`)
  lines.push(`本章目标：${textOf(c.goal).trim() || '（未给出，按细纲推进）'}`)
  if (c.conflict) lines.push(`核心冲突：${textOf(c.conflict)}`)
  if (c.turn) lines.push(`关键转折：${textOf(c.turn)}`)
  lines.push(`视角：${req.pov}`)
  lines.push(`字数要求：${req.words} 字左右（不得少于 ${Math.round(req.words * 0.8)} 字）`)
  lines.push(`禁语：${req.banned.join('、')}（正文中不得出现）`)
  lines.push('输出格式：先写正文；正文结束后输出 <<<SUMMARY>>> 与本章摘要；摘要结束后输出 <<<CANON>>> 与正典补丁 JSON。')
  if (mode === 'revise') lines.push('本次为修订：优先落实【需修正】中的问题，保留原文骨架，不要整章重写。')
  lines.push('不要写下一章的内容，也不要提前解决下一章的悬念。')
  return lines.join('\n')
}

function renderPrevious(previous, previousSummary) {
  const p = previous && typeof previous === 'object' ? previous : {}
  const summary = textOf(previousSummary).trim()
  const hook = textOf(p.hook).trim()
  if (!summary && !hook && !p.id && !p.title) return ''
  const head = [textOf(p.id).trim(), textOf(p.title).trim()].filter(Boolean).join(' · ')
  const lines = []
  if (head) lines.push(head)
  if (summary) lines.push(summary)
  if (hook) lines.push(`钩子：${hook}`)
  return lines.join('\n')
}

function renderRecent(recentSummaries) {
  if (!Array.isArray(recentSummaries)) return ''
  const items = recentSummaries.slice(-3)
  if (items.length === 0) return ''
  return items
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const id = textOf(item.id ?? item.chapter).trim()
        const body = textOf(item.text ?? item.summary ?? item.text).trim()
        return `- ${id || `前第 ${items.length - index} 章`}：${body}`
      }
      return `- ${textOf(item)}`
    })
    .join('\n')
}

function renderStyle(params, styleSample) {
  const p = params && typeof params === 'object' ? params : {}
  const lines = []
  const guide = textOf(p.styleGuide).trim()
  const tone = textOf(p.tone).trim()
  if (guide) lines.push(`风格要求：${guide}`)
  else if (tone) lines.push(`文风：${tone}`)
  const sample = textOf(styleSample).trim()
  if (sample) lines.push(`风格样本：\n${sample}`)
  return lines.join('\n')
}

/**
 * 拼装单章材料包。
 * @param {object} [input]
 * @returns {{text:string, report:object, sections:Record<string,string>}}
 */
export function buildPacket(input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const params = source.params && typeof source.params === 'object' ? source.params : {}
  const chapter = source.chapter && typeof source.chapter === 'object' ? source.chapter : {}
  const volume = source.volume && typeof source.volume === 'object' ? source.volume : null
  const mode = source.mode === 'revise' ? 'revise' : 'draft'
  const budgetRaw = Number(params.contextBudget)
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : DEFAULT_BUDGET

  const slices = []
  const push = (spec, text) => {
    if (!text) return
    slices.push({ name: spec.name, title: spec.title, text, cap: spec.cap, priority: spec.priority, required: spec.required })
  }

  push(SLICE_SPEC[0], renderBrief({ params, chapter, volume, mode }))
  if (mode === 'revise') {
    const findings = formatFindings(source.revisionFindings)
    if (findings) push(REVISION_SPEC, findings)
  }
  push(SLICE_SPEC[1], normalizeBeats(source.beats))
  push(SLICE_SPEC[2], renderPrevious(source.previous, source.previousSummary))
  push(SLICE_SPEC[3], renderRecent(source.recentSummaries))
  if (source.volumeDigest) push(SLICE_SPEC[4], textOf(source.volumeDigest))
  if (source.canonText) push(SLICE_SPEC[5], textOf(source.canonText))
  if (source.castBrief) push(SLICE_SPEC[6], textOf(source.castBrief))
  if (source.nextChapterGoal) push(SLICE_SPEC[7], textOf(source.nextChapterGoal))
  push(SLICE_SPEC[8], renderStyle(params, source.styleSample))

  const { text, report } = assemble({ slices, budget })

  // sections 只保留真正进入正文的片段，值与正文中的块逐字一致（含标题行）。
  const sections = {}
  for (const slice of slices) {
    const row = report.slices.find((item) => item.name === slice.name)
    if (!row || row.allocated <= 0) continue
    sections[slice.name] = render(slice).slice(0, row.allocated)
  }

  return { text, report, sections }
}
