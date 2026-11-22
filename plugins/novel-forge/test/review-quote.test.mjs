import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { ForgeEngine, validateParams } from '../src/forge/index.js'
import { createNovelRecipe, paramsSchema } from '../src/recipes/novel/index.js'
import { createFakeLlm } from './fixtures/mock-recipe.mjs'
import { createFakeCtx, jsonOut } from './fixtures/novel-fixtures.mjs'

import {
  normalizeQuoteText,
  validateFindingQuotes,
  countUnquotedFindings,
} from '../src/recipes/novel/consistency.js'

const exactQuote = '她把钥匙放回积灰的抽屉。'
const finding = { severity: 'block', kind: 'logic', where: '第 2 段', issue: '动机不明', fix: '补一句' }

test('项目参数接受 quoteDowngrade 的两个布尔值和省略值，仍拒绝未知字段', () => {
  const premise = '她在雨夜找到一把钥匙。'
  assert.doesNotThrow(() => validateParams(paramsSchema, { premise, quoteDowngrade: true }))
  assert.doesNotThrow(() => validateParams(paramsSchema, { premise, quoteDowngrade: false }))
  assert.doesNotThrow(() => validateParams(paramsSchema, { premise }))
  assert.throws(() => validateParams(paramsSchema, { premise, foo: true }), { code: 'BAD_PARAMS' })
})

test('引文规范化只折叠空白并去掉首尾空白', () => {
  assert.equal(normalizeQuoteText(' \t她把钥匙\n\n放回抽屉……　'), '她把钥匙 放回抽屉……')
  assert.equal(normalizeQuoteText(undefined), '')
})

test('逐字与空白折叠命中，判定结果保留原始引文', () => {
  const withSpaces = '  她把钥匙 \t\n放回积灰的抽屉。  '
  const findings = [{ ...finding, quote: exactQuote }, { ...finding, quote: withSpaces }]
  const text = `${exactQuote}\n\n她把钥匙\n  放回积灰的抽屉。`
  assert.deepEqual(validateFindingQuotes(text, findings), findings.map((item) => ({ ...item, quoted: true })))
})

test('正文和引文都含空行时，跨段引文命中', () => {
  const text = '门在她身后关上。\n\n她把钥匙放回积灰的抽屉。外面还在下雨。'
  const quote = '她身后关上。\n\n她把钥匙放回积灰的抽屉。'
  const [result] = validateFindingQuotes(text, [{ ...finding, quote }])
  assert.equal(result.quoted, true)
})

test('引文插入正文没有的空格时未命中', () => {
  const quote = '她把钥匙 放回积灰的抽屉。'
  const [result] = validateFindingQuotes(exactQuote, [{ ...finding, quote }])
  assert.equal(result.quoted, false)
})

test('省略号、标点不同、缺失或空引文、超出长度范围均未命中', () => {
  const tooLong = '字'.repeat(121)
  const findings = [
    { ...finding, quote: '她把钥匙……积灰的抽屉。' },
    { ...finding, quote: '她把钥匙放回积灰的抽屉！' },
    { ...finding },
    { ...finding, quote: '' },
    { ...finding, quote: '钥匙' },
    { ...finding, quote: tooLong },
  ]
  const text = `${exactQuote}${tooLong}`
  assert.deepEqual(validateFindingQuotes(text, findings), findings.map((item) => ({ ...item, quoted: false })))
})

test('引文长度上下限均包含，按码点而非 UTF-16 计数', () => {
  const quotes = [7, 8, 120, 121].map((length) => '𠮷'.repeat(length))
  const findings = quotes.map((quote) => ({ ...finding, quote }))
  assert.deepEqual(validateFindingQuotes(quotes[3], findings).map((item) => item.quoted), [false, true, true, false])
})

test('显式降级只调整未命中项的 severity 与 issue，且不会修改入参', () => {
  const findings = Object.freeze([
    ...['block', 'warn', 'note'].map((severity) => Object.freeze({ ...finding, severity, quote: '这段话从未出现在正文中' })),
    Object.freeze({ ...finding, quote: exactQuote }),
  ])
  const before = findings.map((item) => ({ ...item }))
  const output = validateFindingQuotes(exactQuote, findings, { downgrade: true })
  assert.notEqual(output, findings)
  assert.deepEqual(findings, before)
  assert.deepEqual(output, [
    ...['warn', 'note', 'note'].map((severity, i) => ({
      ...findings[i], severity, issue: `（引文未命中正文）${finding.issue}`, quoted: false,
    })),
    { ...findings[3], quoted: true },
  ])
})

test('仅统计 quoted 严格等于 false 的条目', () => {
  assert.equal(countUnquotedFindings([{ quoted: false }, { quoted: true }, {}, { quoted: 0 }, { quoted: false }]), 2)
  assert.equal(countUnquotedFindings([]), 0)
})

test('引文校验把 undefined findings 当作空数组', () => {
  assert.deepEqual(validateFindingQuotes('正文', undefined), [])
})

test('未命中计数把 undefined findings 当作空数组', () => {
  assert.deepEqual(countUnquotedFindings(undefined), 0)
})

const chapter = { id: 'ch01', title: '雨夜' }
const draft = `## 第1章 雨夜\n\n${exactQuote}他仿佛看见了什么。似乎有人。不禁后退。`
const unmatched = { ...finding, quote: '这段话从未出现在正文中' }
const matched = { ...finding, severity: 'note', issue: '语句略平', quote: exactQuote }

test('假 LLM → review/ch01.json：记录引文校验结果，默认保留 severity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'novel-review-quote-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const llm = createFakeLlm({ responses: { review: { findings: [unmatched, finding, matched] } } })
  const recipe = createNovelRecipe()
  const reviewStage = recipe.stages.find((stage) => stage.id === 'review')
  const runReview = reviewStage.run
  let reviewParams
  reviewStage.run = (ctx) => {
    reviewParams = ctx.params
    return runReview(ctx)
  }
  const engine = new ForgeEngine({ root, recipes: [recipe], llm })
  const project = await engine.createProject({ title: '雨夜', params: { premise: '她在雨夜找到一把钥匙。', reviewGate: false } })
  await engine.writeArtifact(project.id, 'outline', { content: { chapters: [chapter] } })
  await engine.writeArtifact(project.id, 'draft/ch01', { content: draft })
  const run = await engine.startRun(project.id, { stages: ['review'] })
  const deadline = performance.now() + 15_000
  let final = await engine.getRun(run.id)
  while ((final.status === 'running' || !final.endedAt) && performance.now() < deadline) {
    await sleep(10)
    final = await engine.getRun(run.id)
  }
  assert.equal(final.status, 'done', JSON.stringify(final.error ?? final.events.slice(-3)))
  assert.equal(reviewParams.quoteDowngrade, undefined)
  assert.equal(llm.calls.length, 1)
  const review = JSON.parse(await readFile(engine.store.artifactPath(project.id, 'review/ch01', 'json'), 'utf8'))
  assert.deepEqual(review.findings.filter((item) => item.kind === 'logic'), [
    { ...unmatched, quoted: false },
    { ...finding, quote: '', quoted: false },
    { ...matched, quoted: true },
  ])
  const deterministic = review.findings.find((item) => item.kind === 'ai-cliche')
  assert.ok(deterministic)
  assert.ok(!Object.hasOwn(deterministic, 'quote'))
  assert.ok(!Object.hasOwn(deterministic, 'quoted'))
  assert.equal(review.unquotedFindings, 2)
  assert.equal(review.verdict, 'revise')
})

test('抢救审校结果时只校验已有引文的意见，显式开关触发降级', async () => {
  const recipe = createNovelRecipe()
  const reviewStage = recipe.stages.find((stage) => stage.id === 'review')
  const invalid = jsonOut({ findings: [finding, unmatched, matched], verdict: 'maybe' })
  const out = await reviewStage.run(createFakeCtx({
    params: { quoteDowngrade: true },
    item: chapter,
    items: [chapter],
    artifacts: { 'draft/ch01': { kind: 'md', content: draft } },
    outputs: [invalid, invalid],
  }))
  const review = out.artifacts['review/ch01'].content
  assert.deepEqual(review.findings.filter((item) => item.kind === 'logic'), [
    { ...finding, quote: '' },
    { ...unmatched, severity: 'warn', issue: `（引文未命中正文）${finding.issue}`, quoted: false },
    { ...matched, quoted: true },
  ])
  assert.equal(review.unquotedFindings, 1)
  assert.match(out.note, /模型输出降级.*；其中 1 条引文未命中正文$/)
})
