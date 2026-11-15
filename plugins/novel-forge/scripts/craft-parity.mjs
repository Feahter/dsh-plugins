#!/usr/bin/env node
// craft-parity.mjs — 同一份中文故事稿，同时跑墨炉的确定性体检与 story-craft 的
// story_check.py，逐项对照。两边口径不一致时退出码 1。
//
// 用法：node scripts/craft-parity.mjs <稿件.md> [--verbose]
// 依赖：python3 + ~/.dsh/skills/story-craft/scripts/story_check.py（只读调用）
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkDraft } from '../src/recipes/novel/craft.js'

const CHECKER = join(homedir(), '.dsh/skills/story-craft/scripts/story_check.py')

/** 与 story_check.py 的 strip_markdown 保持同一口径，保证两边量的是同一段文字。 */
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\|.*?\|/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^>\s?/gm, '')
}

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/craft-parity.mjs <稿件.md> [--verbose]')
  process.exit(2)
}
const verbose = process.argv.includes('--verbose')

const raw = readFileSync(file, 'utf8')
const text = stripMarkdown(raw)

let py
try {
  py = JSON.parse(
    execFileSync('python3', [CHECKER, file, '--json'], { encoding: 'utf8', maxBuffer: 8 << 20 }),
  )
} catch (err) {
  console.error(`调用 story_check.py 失败：${err?.message ?? err}`)
  process.exit(2)
}

const mine = checkDraft({ text, params: {}, beats: null, cast: [] }).stats ?? {}

// [展示名, python 字段, craft 字段, 容差, 单位, python 换算, craft 换算]
// python 的占比已经是百分数；craft 的 dialogueRatio 是 0–1 小数，shortSentenceRatio 是百分数。
const rows = [
  ['汉字数', 'chars', 'cjk', 0, '', 1, 1],
  ['段落数', 'paragraphs', 'paragraphs', 0, '', 1, 1],
  ['句子数', 'sentences', 'sentences', 0, '', 1, 1],
  ['平均句长', 'avg_sentence_len', 'avgSentenceLen', 0.15, '字', 1, 1],
  ['最长句', 'max_sentence_len', 'maxSentenceLen', 0, '字', 1, 1],
  ['短句占比', 'short_sentence_ratio', 'shortSentenceRatio', 0.6, '%', 1, 1],
  ['对话占比', 'dialogue_ratio', 'dialogueRatio', 0.6, '%', 1, 100],
  ['感官密度', 'sensory_per_1k', 'sensoryPer1k', 0.35, '/千字', 1, 1],
  ['情绪密度', 'abstract_emotion_per_1k', 'abstractEmotionPer1k', 0.35, '/千字', 1, 1],
  ['副词密度', 'adverb_per_1k', 'adverbPer1k', 0.35, '/千字', 1, 1],
  ['AI 标记', 'ai_marker_count', 'aiMarkerCount', 0, '处', 1, 1],
]

const scale = (value, factor) =>
  Number.isFinite(value) ? Math.round(value * factor * 100) / 100 : undefined

let failures = 0
const lines = []
lines.push(`稿件：${file}`)
lines.push('指标'.padEnd(10) + 'story_check'.padStart(12) + 'craft.js'.padStart(12) + '  Δ'.padStart(8) + '  容差')
for (const [label, pyKey, jsKey, tol, unit, pyFactor, jsFactor] of rows) {
  const a = scale(py.metrics?.[pyKey], pyFactor)
  const b = scale(mine[jsKey], jsFactor)
  const diff = Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) : NaN
  const ok = Number.isFinite(diff) && diff <= tol
  if (!ok) failures += 1
  const fmt = (v) => (Number.isFinite(v) ? String(v) : '—')
  lines.push(
    label.padEnd(10) + (fmt(a) + unit).padStart(12) + (fmt(b) + unit).padStart(12) +
      (' ' + (Number.isFinite(diff) ? diff.toFixed(2) : '—')).padStart(8) +
      `  ≤${tol}${unit} ${ok ? '✓' : '✗'}`,
  )
}
console.log(lines.join('\n'))
if (verbose) {
  console.log('\nstory_check verdicts：')
  console.log(JSON.stringify(py.verdicts ?? [], null, 2))
  console.log('\ncraft findings：')
  console.log(JSON.stringify(checkDraft({ text, params: {}, beats: null, cast: [] }).findings ?? [], null, 2))
}
if (failures) {
  console.error(`\n${failures} 项超出容差`)
  process.exit(1)
}
console.log('\n全部指标在容差内')
