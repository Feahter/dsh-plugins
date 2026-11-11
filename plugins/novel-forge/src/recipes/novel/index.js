// novel recipe — 小说 recipe 定义。
// 契约：docs/architecture.md §3.1（recipe 形状）、§4.1（params）、§4.2（stages）、§4.4（JSON 形状）。
// 本文件只做编排：拼 prompt 输入 → 调 ctx.llm.generate → 校验/规范化 → 返回 artifacts。
import { z } from 'zod'
import { createPrompts } from './prompts/zh.js'
import { defaultCraft, severityRank } from './craft.js'
import { normalizeOutline, chaptersOf } from './outline.js'
import { createLedger, mergeLedger, slimLedger, characterBrief, emptyLedger } from './ledger.js'
import { markdownExport, epubExport } from './export.js'

// forge/errors.js 由引擎负责；并行施工/单测先行时用兼容兜底（形状一致，engine 只看 code）。
async function loadForgeError() {
  try {
    const mod = await import('../../forge/errors.js')
    if (typeof mod?.ForgeError === 'function') return mod.ForgeError
    if (typeof mod?.default === 'function') return mod.default
  } catch {
    // 引擎尚未落盘
  }
  return class ForgeError extends Error {
    constructor(code, message, detail) {
      super(message)
      this.name = 'ForgeError'
      this.code = code
      this.detail = detail
    }
  }
}

const ForgeError = await loadForgeError()

// ---------------------------------------------------------------- params

const GENRES = ['悬疑', '奇幻', '科幻', '都市', '历史', '言情', '恐怖', '武侠', '通用']
const AUDIENCES = ['成年', '青少年', '泛读者']
const POVS = ['第一人称', '第三人称限知', '第三人称全知']

export const paramsDefaults = {
  title: '',
  genre: '悬疑',
  audience: '成年',
  language: 'zh',
  chapters: 24,
  wordsPerChapter: 3000,
  pov: '第三人称限知',
  tone: '',
  styleGuide: '',
  autoReview: true,
  reviewGate: false,
  seed: '',
}

const paramsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['premise'],
  properties: {
    premise: { type: 'string', minLength: 8, maxLength: 2000, description: '一句话故事核' },
    title: { type: 'string', maxLength: 80, description: '书名，空则由 premise 起名' },
    genre: { type: 'string', enum: GENRES },
    audience: { type: 'string', enum: AUDIENCES },
    language: { type: 'string', enum: ['zh', 'en'] },
    chapters: { type: 'integer', minimum: 6, maximum: 120 },
    wordsPerChapter: { type: 'integer', minimum: 800, maximum: 8000 },
    pov: { type: 'string', enum: POVS },
    tone: { type: 'string', maxLength: 200 },
    styleGuide: { type: 'string', maxLength: 4000 },
    autoReview: { type: 'boolean' },
    reviewGate: { type: 'boolean' },
    seed: { type: 'string', maxLength: 500 },
  },
}

// ---------------------------------------------------------------- 输出 schema（§4.4）

const briefSchema = z.object({
  title: z.string(),
  logline: z.string().min(1),
  theme: z.string(),
  promise: z.string(),
  ending: z.string(),
  genreTags: z.array(z.string()).default([]),
})

const relationSchema = z.object({ to: z.string(), kind: z.string() })

const castSchema = z.object({
  name: z.string().min(1),
  role: z.string(),
  want: z.string(),
  fear: z.string(),
  secret: z.string(),
  voice: z.string(),
  arc: z.string(),
  relations: z.array(relationSchema).default([]),
})

const charactersSchema = z.object({ cast: z.array(castSchema).min(1) })

const sceneSchema = z.object({
  no: z.union([z.number(), z.string()]),
  where: z.string(),
  when: z.string(),
  cast: z.array(z.string()).default([]),
  goal: z.string(),
  obstacle: z.string(),
  turn: z.string(),
  exit: z.string(),
  sensory: z.string(),
})

const beatsSchema = z.object({
  chapterId: z.string().optional(),
  title: z.string(),
  scenes: z.array(sceneSchema).min(1),
})

const findingSchema = z.object({
  severity: z.enum(['block', 'warn', 'note']),
  kind: z.string(),
  where: z.string(),
  issue: z.string().min(1),
  fix: z.string(),
})

const factPatchSchema = z.union([
  z.string(),
  z.object({ text: z.string().min(1), chapter: z.string().optional(), status: z.string().optional() }),
])

const threadPatchSchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    text: z.string().min(1),
    status: z.string().optional(),
    opened: z.string().optional(),
    closedIn: z.string().optional(),
  }),
])

const timelinePatchSchema = z.union([
  z.string(),
  z.object({ chapter: z.string().optional(), when: z.string().optional(), event: z.string().min(1) }),
])

const ledgerPatchSchema = z.object({
  facts: z.array(factPatchSchema).optional(),
  threads: z.array(threadPatchSchema).optional(),
  characters: z
    .record(
      z.string(),
      z.object({
        location: z.string().optional(),
        state: z.string().optional(),
        knows: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  timeline: z.array(timelinePatchSchema).optional(),
  canonRules: z.array(z.string()).optional(),
})

const reviewSchema = z.object({
  findings: z.array(findingSchema),
  ledgerPatch: ledgerPatchSchema,
  verdict: z.enum(['pass', 'revise']),
})

const blurbSchema = z.object({
  title: z.string().min(1),
  tagline: z.string(),
  blurb: z.string(),
  tags: z.array(z.string()),
})

// ---------------------------------------------------------------- helpers

function clip(value, max = 2000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function parseError(stage, message, raw) {
  return new ForgeError('LLM_PARSE', `${stage}：${message}`, { raw: clip(raw) })
}

function formatZod(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : []
  return issues
    .map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('；')
}

/** 抽取 JSON：先整体解析，再剥围栏，再取第一个 {/[ 到最后一个 }/]。 */
export function extractJson(text) {
  const source = String(text ?? '').trim()
  if (!source) return undefined
  try {
    return JSON.parse(source)
  } catch {
    /* next */
  }
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      /* next */
    }
  }
  const start = source.search(/[{[]/)
  const end = Math.max(source.lastIndexOf('}'), source.lastIndexOf(']'))
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(source.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }
  return undefined
}

function has(ctx, key) {
  try {
    return typeof ctx.has === 'function' ? Boolean(ctx.has(key)) : false
  } catch {
    return false
  }
}

function jsonOr(ctx, key, fallback = null) {
  if (!has(ctx, key)) return fallback
  try {
    return ctx.json(key) ?? fallback
  } catch {
    return fallback
  }
}

function textOf(ctx, key) {
  try {
    return typeof ctx.text === 'function' ? String(ctx.text(key) ?? '') : ''
  } catch {
    return ''
  }
}

function fit(ctx, text, maxChars) {
  if (typeof ctx.fit === 'function') return ctx.fit(text, maxChars)
  const value = String(text ?? '')
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 6))}…（已截断）`
}

function withPromptContext(ctx, extra) {
  if (!ctx || typeof ctx !== 'object') return { ...extra }
  return Object.assign(Object.create(ctx), extra)
}

function promptSpec(ctx, promptFn, stage) {
  const spec = typeof promptFn === 'function' ? promptFn(ctx) : null
  if (!spec || typeof spec.user !== 'string' || typeof spec.system !== 'string') {
    throw new ForgeError('BAD_RECIPE', `prompts.${stage} 必须返回 { system, user }`, { stage })
  }
  const maxTokens = Number(spec.maxTokens)
  return {
    system: spec.system,
    user: spec.user,
    maxTokens: Number.isFinite(maxTokens) ? Math.min(32000, Math.max(256, Math.round(maxTokens))) : 4096,
    temperature: Number.isFinite(Number(spec.temperature)) ? Number(spec.temperature) : undefined,
  }
}

async function callJson(ctx, stage, promptFn, schema, { phase } = {}) {
  const spec = promptSpec(ctx, promptFn, stage)
  const result = await ctx.llm.generate({
    system: spec.system,
    user: spec.user,
    maxTokens: spec.maxTokens,
    temperature: spec.temperature,
    json: true,
    phase: phase ?? stage,
    label: stage,
  })
  let data = result?.json
  if (data == null) data = extractJson(result?.text)
  if (data === undefined) {
    throw parseError(stage, '模型返回的不是合法 JSON', result?.text)
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw parseError(stage, `JSON 字段不合契约（${formatZod(parsed.error)}）`, data)
  }
  return parsed.data
}

async function callText(ctx, stage, promptFn, { phase, maxTokens, temperature } = {}) {
  const spec = promptSpec(ctx, promptFn, stage)
  const result = await ctx.llm.generate({
    system: spec.system,
    user: spec.user,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : spec.maxTokens,
    temperature: Number.isFinite(temperature) ? temperature : spec.temperature,
    json: false,
    phase: phase ?? stage,
    label: stage,
  })
  return String(result?.text ?? '').trim()
}

function parseBlurbMarkdown(text) {
  const source = stripFence(text)
  const pick = (re) => (source.match(re) || [])[1]?.trim() ?? ''
  const title = pick(/^#\s*《([^》]+)》/m) || pick(/^#\s*(.+)$/m)
  const tagline = pick(/一句话卖点[：:]\s*(.+)/)
  const blurb = pick(/##\s*简介\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const tagsLine = pick(/##\s*标签\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const tags = tagsLine
    .split(/[\/、,，|]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  return {
    title,
    tagline,
    blurb: blurb || (title || tagline ? '' : source),
    tags,
  }
}

function stripFence(text) {
  const source = String(text ?? '').trim()
  const fenced = source.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i)
  return (fenced ? fenced[1] : source).trim()
}

function ensureHeading(markdown, heading) {
  const text = stripFence(markdown)
  if (!text) throw new ForgeError('LLM_PARSE', `${heading} 内容为空`)
  if (/^#\s/.test(text)) return text
  return `${heading}\n\n${text}`
}

const CHINESE_NUMERALS = '[0-9０-９一二三四五六七八九十百千零两]'

function normalizeProse(raw, { no, title }) {
  let text = stripFence(raw)
  text = text.replace(/^(?:以下是|这是)[^\n]*\n+/, '').trim()
  if (!text) throw new ForgeError('LLM_PARSE', `第 ${no} 章正文为空`, { raw: clip(raw) })
  text = text.replace(/^\s*#{1,4}\s*第\s*[^\n]*章[^\n]*\n+/, '').trim()
  const normalizedTitle = String(title ?? '').trim()
  const heading = `## 第${no}章${normalizedTitle ? ` ${normalizedTitle}` : ''}`
  return `${heading}\n\n${text}`
}

function normalizeSummary(raw) {
  const text = stripFence(raw).replace(/^摘要[:：]\s*/, '').trim()
  if (!text) throw new ForgeError('LLM_PARSE', '章节摘要为空')
  return text
}

function chapterNumber(ctx) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0
  return index + 1
}

function previousChapter(ctx) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0
  return ctx.items?.[index - 1] ?? null
}

function nextChapter(ctx) {
  const index = Number.isInteger(ctx.index) ? ctx.index : 0
  return ctx.items?.[index + 1] ?? null
}

function collectCastNames(beats, outlineChapter) {
  const names = []
  const push = (name) => {
    const value = String(name ?? '').trim()
    if (value && !names.includes(value)) names.push(value)
  }
  for (const name of outlineChapter?.cast ?? []) push(name)
  for (const scene of beats?.scenes ?? []) {
    for (const name of scene?.cast ?? []) push(name)
  }
  return names
}

/** 按 §4.3 预算拼装写章材料；每一块都过 ctx.fit。 */
function buildDraftMaterials(ctx) {
  const item = ctx.item ?? {}
  const beats = jsonOr(ctx, `beats/${item.id}`, null)
  const previous = previousChapter(ctx)
  const next = nextChapter(ctx)

  const materials = {
    beats: fit(ctx, textOf(ctx, `beats/${item.id}`), 2500),
    previousSummary: previous ? fit(ctx, textOf(ctx, `summary/${previous.id}`), 800) : '',
    ledger: fit(ctx, slimLedger(jsonOr(ctx, 'ledger', emptyLedger()), { maxChars: 3000 }), 3000),
    nextGoal: next ? fit(ctx, `目标：${next.goal ?? ''}\n转折：${next.turn ?? ''}`, 400) : '',
    characters: fit(
      ctx,
      characterBrief(
        jsonOr(ctx, 'characters', {})?.cast ?? [],
        collectCastNames(beats, item),
        1500,
      ),
      1500,
    ),
    styleGuide: fit(ctx, ctx.params?.styleGuide ?? '', 1500),
    previousHook: previous?.hook ?? '',
  }
  return materials
}

function draftMaxTokens(params = {}) {
  const words = Number(params.wordsPerChapter) || paramsDefaults.wordsPerChapter
  return Math.min(16000, Math.max(1200, Math.round(words * 2.2)))
}

function clampInt(value, fallback, min, max) {
  const number = Number(value)
  const base = Number.isFinite(number) ? Math.round(number) : fallback
  return Math.min(max, Math.max(min, base))
}

function hasPatch(patch) {
  if (!patch || typeof patch !== 'object') return false
  return ['facts', 'threads', 'characters', 'timeline', 'canonRules'].some((key) => {
    const value = patch[key]
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object') return Object.keys(value).length > 0
    return false
  })
}

function countSeverities(findings) {
  return findings.reduce(
    (acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
      return acc
    },
    { block: 0, warn: 0, note: 0 },
  )
}

// ---------------------------------------------------------------- recipe

/**
 * @param {{prompts?: object, craft?: {checkDraft: Function}}} deps
 */
export function createNovelRecipe({ prompts = createPrompts(), craft = defaultCraft } = {}) {
  const stages = [
    {
      id: 'premise',
      title: '故事核心',
      produces: ['brief'],
      review: false,
      async run(ctx) {
        const data = await callJson(ctx, 'premise', prompts.premise, briefSchema)
        const title = String(ctx.params?.title ?? '').trim() || String(data.title ?? '').trim() || '未命名'
        const brief = { ...data, title }
        return {
          artifacts: { brief: { kind: 'json', content: brief } },
          note: `故事核心：${brief.logline}`,
        }
      },
    },
    {
      id: 'bible',
      title: '世界设定',
      produces: ['bible'],
      review: false,
      async run(ctx) {
        const text = await callText(ctx, 'bible', prompts.bible, { maxTokens: 4096 })
        return {
          artifacts: { bible: { kind: 'md', content: ensureHeading(text, '# 世界设定') } },
          note: '世界设定完成',
        }
      },
    },
    {
      id: 'characters',
      title: '人物档案',
      produces: ['characters'],
      review: false,
      async run(ctx) {
        const data = await callJson(ctx, 'characters', prompts.characters, charactersSchema)
        return {
          artifacts: { characters: { kind: 'json', content: data } },
          note: `人物档案：${data.cast.length} 人`,
        }
      },
    },
    {
      id: 'spine',
      title: '情感脊柱',
      produces: ['spine'],
      review: false,
      async run(ctx) {
        const text = await callText(ctx, 'spine', prompts.spine, { maxTokens: 4096 })
        return {
          artifacts: { spine: { kind: 'md', content: ensureHeading(text, '# 情感脊柱') } },
          note: '情感脊柱完成',
        }
      },
    },
    {
      id: 'outline',
      title: '卷章大纲',
      produces: ['outline', 'ledger'],
      review: (project) => project?.params?.reviewGate === true,
      async run(ctx) {
        const spec = promptSpec(ctx, prompts.outline, 'outline')
        const result = await ctx.llm.generate({
          system: spec.system,
          user: spec.user,
          maxTokens: spec.maxTokens,
          temperature: spec.temperature,
          json: true,
          phase: 'outline',
          label: 'outline',
        })
        const raw = result?.json ?? extractJson(result?.text)
        if (raw === undefined) throw parseError('outline', '模型返回的不是合法 JSON', result?.text)
        const outline = normalizeOutline(raw, {
          chapters: ctx.params?.chapters,
          language: ctx.params?.language,
        })
        const ledger = createLedger({
          brief: jsonOr(ctx, 'brief', {}),
          outline,
          params: ctx.params ?? {},
        })
        return {
          artifacts: {
            outline: { kind: 'json', content: outline },
            ledger: { kind: 'json', content: ledger },
          },
          note: outline.trimmed
            ? `卷章大纲：${outline.totalChapters} 章（模型多给 ${outline.trimmed} 章，已按计划裁掉）`
            : `卷章大纲：${outline.totalChapters} 章`,
        }
      },
    },
    {
      id: 'beats',
      title: '章节细纲',
      each: 'outline.chapters',
      produces: ['beats/*'],
      review: false,
      async run(ctx) {
        const item = ctx.item ?? {}
        const data = await callJson(ctx, 'beats', prompts.beats, beatsSchema)
        const beats = {
          chapterId: item.id,
          title: String(data.title ?? '').trim() || String(item.title ?? '').trim(),
          scenes: data.scenes.map((scene, index) => ({ ...scene, no: index + 1 })),
        }
        return {
          artifacts: { [`beats/${item.id}`]: { kind: 'json', content: beats } },
          note: `${item.id} 细纲：${beats.scenes.length} 场`,
        }
      },
    },
    {
      id: 'draft',
      title: '章节草稿',
      each: 'outline.chapters',
      produces: ['draft/*', 'summary/*'],
      review: (project) => project?.params?.reviewGate === true,
      onItemError: 'stop',
      async run(ctx) {
        const item = ctx.item ?? {}
        const no = chapterNumber(ctx)
        const materials = buildDraftMaterials(ctx)
        const promptCtx = withPromptContext(ctx, { materials })

        const prose = await callText(promptCtx, 'draft', prompts.draft, {
          phase: 'prose',
          maxTokens: draftMaxTokens(ctx.params),
        })
        const text = normalizeProse(prose, { no, title: item.title })

        const summaryCtx = withPromptContext(ctx, {
          materials,
          draft: text,
          draftText: text,
          chapterTitle: item.title,
          chapterNo: no,
        })
        const summary = normalizeSummary(
          await callText(summaryCtx, 'summary', prompts.summary, { phase: 'summary', maxTokens: 800 }),
        )

        const { stats } = craft.checkDraft({ text, params: ctx.params, beats: null })
        return {
          artifacts: {
            [`draft/${item.id}`]: { kind: 'md', content: text },
            [`summary/${item.id}`]: { kind: 'md', content: summary },
          },
          note: `第 ${no} 章草稿完成，${stats.cjk} 字`,
        }
      },
    },
    {
      id: 'review',
      title: '连续性审校',
      each: 'outline.chapters',
      produces: ['review/*'],
      review: false,
      skip: (project) => (project?.params?.autoReview === false ? '未开启自动审校' : false),
      async run(ctx) {
        const item = ctx.item ?? {}
        const data = await callJson(ctx, 'review', prompts.review, reviewSchema)
        const draftText = textOf(ctx, `draft/${item.id}`)
        const beats = jsonOr(ctx, `beats/${item.id}`, null)
        const deterministic = craft.checkDraft({
          text: draftText,
          params: ctx.params ?? {},
          beats,
          previousHook: previousChapter(ctx)?.hook ?? '',
        })

        const findings = [...data.findings, ...deterministic.findings]
          .map((finding) => ({
            severity: finding.severity,
            kind: finding.kind,
            where: finding.where,
            issue: finding.issue,
            fix: finding.fix,
          }))
          .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        const counts = countSeverities(findings)
        const verdict = counts.block || counts.warn ? 'revise' : 'pass'
        const review = { findings, ledgerPatch: data.ledgerPatch, verdict }

        const artifacts = { [`review/${item.id}`]: { kind: 'json', content: review } }
        if (hasPatch(data.ledgerPatch)) {
          artifacts.ledger = {
            kind: 'json',
            content: mergeLedger(jsonOr(ctx, 'ledger', emptyLedger()), data.ledgerPatch, item.id),
          }
        }
        return {
          artifacts,
          note: `审校 ${item.id}：block ${counts.block} / warn ${counts.warn} / note ${counts.note} → ${verdict}`,
        }
      },
    },
    {
      id: 'revise',
      title: '修订',
      each: 'outline.chapters',
      produces: ['draft/*', 'summary/*'],
      review: false,
      skip: (project) => (project?.params?.autoReview === false ? '未开启自动审校' : false),
      async run(ctx) {
        const item = ctx.item ?? {}
        const review = jsonOr(ctx, `review/${item.id}`, null)
        const actionable = (review?.findings ?? []).filter(
          (finding) => finding.severity === 'block' || finding.severity === 'warn',
        )
        if (!actionable.length) {
          return { artifacts: {}, note: `${item.id} 无 block/warn 问题，跳过修订` }
        }

        const no = chapterNumber(ctx)
        const materials = buildDraftMaterials(ctx)
        const draftText = textOf(ctx, `draft/${item.id}`)
        const promptCtx = withPromptContext(ctx, {
          materials,
          draft: draftText,
          draftText,
          review,
          findings: actionable,
          chapterTitle: item.title,
          chapterNo: no,
        })

        const prose = await callText(promptCtx, 'revise', prompts.revise, {
          phase: 'revise',
          maxTokens: draftMaxTokens(ctx.params),
        })
        const text = normalizeProse(prose, { no, title: item.title })
        const summary = normalizeSummary(
          await callText(
            withPromptContext(promptCtx, { draft: text, draftText: text }),
            'summary',
            prompts.summary,
            { phase: 'summary', maxTokens: 800 },
          ),
        )

        return {
          artifacts: {
            [`draft/${item.id}`]: { kind: 'md', content: text },
            [`summary/${item.id}`]: { kind: 'md', content: summary },
          },
          note: `${item.id} 已修订（${actionable.length} 条问题）`,
        }
      },
    },
    {
      id: 'blurb',
      title: '封面文案',
      produces: ['blurb'],
      review: false,
      async run(ctx) {
        // prompts.blurb 的出口是 Markdown（人读的封面文案），不是 JSON：
        // 在这里解析回结构化字段，写盘仍是 json。
        const raw = await callText(ctx, 'blurb', prompts.blurb, { phase: 'blurb' })
        const parsed = parseBlurbMarkdown(raw)
        const title = String(ctx.params?.title ?? '').trim() || parsed.title
        const content = {
          title,
          tagline: parsed.tagline,
          blurb: parsed.blurb,
          tags: parsed.tags,
        }
        const checked = blurbSchema.safeParse(content)
        if (!checked.success) throw parseError('blurb', `封面文案字段不合契约（${formatZod(checked.error)}）`, raw)
        return {
          artifacts: { blurb: { kind: 'json', content: checked.data } },
          note: `封面文案：《${checked.data.title}》`,
        }
      },
    },
  ]

  return {
    id: 'novel',
    version: 1,
    title: '长篇小说',

    paramsSchema,
    paramsDefaults: { ...paramsDefaults },

    artifacts: {
      brief: { kind: 'json', title: '故事核心' },
      bible: { kind: 'md', title: '世界观设定' },
      characters: { kind: 'json', title: '人物档案' },
      spine: { kind: 'md', title: '情感脊柱' },
      outline: { kind: 'json', title: '卷章大纲' },
      ledger: { kind: 'json', title: '连续性账本' },
      blurb: { kind: 'json', title: '封面文案' },
      'beats/*': { kind: 'json', title: '章节细纲' },
      'draft/*': { kind: 'md', title: '章节草稿' },
      'summary/*': { kind: 'md', title: '章节摘要' },
      'review/*': { kind: 'json', title: '章节审校' },
      manuscript: { kind: 'md', title: '全书合稿' },
    },

    stages,

    /** 领域统计：已写字数/已写章节，供引擎写进 project.stats、UI 展示。 */
    stats(project, read) {
      let total = clampInt(project?.params?.chapters, paramsDefaults.chapters, 6, 120)
      try {
        if (read.has('outline')) {
          const listed = chaptersOf(read.json('outline'))
          if (listed.length) total = listed.length
        }
      } catch {
        // 大纲还没落盘或格式未定：退回 params
      }
      let drafted = 0
      let words = 0
      for (const key of Object.keys(project?.artifacts || {})) {
        if (!key.startsWith('draft/')) continue
        let text = ''
        try {
          text = read.text(key)
        } catch {
          continue
        }
        if (!text) continue
        drafted += 1
        words += text.replace(/\s+/g, '').length
      }
      return { chapters: total, drafted, words }
    },

    estimate(params = {}) {
      const merged = { ...paramsDefaults, ...params }
      const chapters = clampInt(merged.chapters, paramsDefaults.chapters, 6, 120)
      const wordsPerChapter = clampInt(merged.wordsPerChapter, paramsDefaults.wordsPerChapter, 800, 8000)
      const autoReview = merged.autoReview !== false
      const tokens = (chars) => Math.ceil(chars / 1.6) // §3.4：中文约 1.6 字/token

      const calls = 6 + chapters * (1 + 2 + (autoReview ? 3 : 0))
      const fixedIn = tokens(5 * 4000 + 3000)
      const fixedOut = tokens(5 * 1200 + 600)
      const perChapterIn =
        tokens(4000) +
        tokens(14500) +
        tokens(wordsPerChapter + 1000) +
        (autoReview ? tokens(wordsPerChapter + 6000) + tokens(wordsPerChapter + 8000) : 0)
      const perChapterOut =
        tokens(1200) +
        tokens(wordsPerChapter) +
        tokens(450) +
        (autoReview ? tokens(800) + tokens(wordsPerChapter + 450) : 0)
      const estTokensIn = fixedIn + chapters * perChapterIn
      const estTokensOut = fixedOut + chapters * perChapterOut

      return {
        chapters,
        calls,
        estTokensIn,
        estTokensOut,
        note:
          `约 ${calls} 次模型调用；${chapters} 章 × ${wordsPerChapter} 字；` +
          `预计输入约 ${estTokensIn} tokens、输出约 ${estTokensOut} tokens` +
          (autoReview ? '（含自动审校+修订）' : '（不含审校）'),
      }
    },

    exports: {
      markdown: { title: 'Markdown', run: markdownExport },
      epub: { title: 'EPUB', run: epubExport },
    },
  }
}

export const novelRecipe = createNovelRecipe()

export { paramsSchema, chaptersOf }
export default novelRecipe
