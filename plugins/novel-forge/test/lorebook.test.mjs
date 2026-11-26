import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { createTools } from '../src/host/tools.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { buildPacket, loreHaystack, loreTextOf } from '../src/recipes/novel/packet.js'
import { TRUNCATE_MARK } from '../src/forge/text.js'
import { createFakeCtx, SAMPLE_PARAMS, sampleBeats, sampleOutlineV2 } from './fixtures/novel-fixtures.mjs'

const section = '## 世界书'
const entry = { id: '血月', title: '血月之夜', text: '仪式必须在午夜举行。', keywords: ['血月'] }

test('世界书以录入顺序匹配常驻、ASCII 关键词和正则，忽略无效正则', () => {
  const haystack = loreHaystack({ title: 'Silver Gate', goal: '追查血月祭' }, { scene: '红月祭仪' })
  const entries = [
    { title: '别名', text: '甲', keywords: ['sILVER gATE'] },
    { title: '正则', text: '乙', regex: '红月.*祭仪' },
    { title: '缺席', text: '丙', keywords: ['蓝月'] },
    { title: '坏正则', text: '丁', regex: '[' },
    { title: '常驻', text: '戊', constant: true, keywords: ['蓝月'], regex: '[' },
    { title: '目标', text: '己', keywords: ['血月'] },
  ]
  assert.equal(loreTextOf(entries, haystack), '【别名】甲\n\n【正则】乙\n\n【常驻】戊\n\n【目标】己')
})

test('1500 字预算保留完整世界书，输出位于到期线索之后、正典之前', () => {
  const input = {
    params: { contextBudget: 1500 }, chapter: { title: '血月' },
    dueThreads: '钩子：寻找蜡印。', canonText: '铜印来自雾港。'.repeat(200),
    loreText: '【血月之夜】仪式必须在午夜举行。',
  }
  const packet = buildPacket(input)
  assert.equal(packet.sections.lore, `${section}\n${input.loreText}`)
  assert.ok(packet.text.indexOf('## 到期待收线索') < packet.text.indexOf(section))
  assert.ok(packet.text.indexOf(section) < packet.text.indexOf('## 正典'))
  const crowded = buildPacket({ ...input, chapter: { goal: '血月'.repeat(500) },
    loreText: '祷词'.repeat(400), beats: { goal: '查账'.repeat(1500) } })
  assert.equal(crowded.sections.lore.length, 600)
  assert.ok(crowded.sections.lore.endsWith(TRUNCATE_MARK))
  assert.equal(crowded.text.length, 1500)
  assert.equal(crowded.report.used, crowded.text.length)
  assert.equal(crowded.report.slices.find(row => row.name === 'lore').truncated, false)
})

test('世界书按 600 字 cap 截断，末尾容不下条目标题时省略该标题', () => {
  const loreText = loreTextOf([
    { title: '甲', text: '夜'.repeat(567), constant: true },
    { title: '不能截半个标题'.repeat(5), text: '后文', constant: true },
  ], '')
  const packet = buildPacket({ loreText })
  assert.match(packet.sections.lore, /^## 世界书\n【甲】夜/)
  assert.ok(packet.sections.lore.endsWith(TRUNCATE_MARK))
  assert.doesNotMatch(packet.sections.lore, /不能截/)
  assert.ok(packet.sections.lore.length <= 600)
  const long = loreTextOf([{ title: '长条目', text: '月'.repeat(2000), constant: true }], '')
  assert.equal(buildPacket({ loreText: long }).sections.lore.length, 600)
})

test('novel_lorebook 管理项目条目，novel_context 使用最新条目', async t => {
  const root = await mkdtemp(join(tmpdir(), 'forge-lorebook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const engine = new ForgeEngine({ root, recipes: [createNovelRecipe()], llm: {
    generate: () => { assert.fail('准备已有细纲的章节不应调用模型') },
  } })
  const { id } = await engine.createProject({ recipeId: 'novel', title: '世界书', params: SAMPLE_PARAMS })
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  chapter.title = entry.title
  await engine.writeArtifact(id, 'outline', { kind: 'json', content: outline })
  await engine.writeArtifact(id, `beats/${chapter.id}`, { kind: 'json', content: sampleBeats(chapter.id) })
  const tools = createTools(engine)
  const tool = name => tools.find(item => item.name === name)
  const run = args => tool('novel_lorebook').execute({ project: id, ...args })
  const context = async () => JSON.stringify(await tool('novel_context').execute({ project: id, chapter: chapter.id }))
  assert.deepEqual(await run({ action: 'list' }), { ok: true, entries: [] })
  assert.ok(!(await context()).includes(section))
  assert.deepEqual(await run({ action: 'add', ...entry }), { ok: true, entries: 1 })
  assert.equal((await run({ action: 'list' })).entries[0].title, entry.title)
  assert.ok((await context()).includes(entry.text))
  const stored = () => engine.getArtifact(id, 'lorebook')
  const old = await stored()
  assert.equal(old.meta.by.stage, 'manual')
  for (const args of [
    { action: 'add', ...entry },
    { action: 'update', id: entry.id, regex: '[' },
    { action: 'update', id: entry.id, regex: '月'.repeat(201) },
    { action: 'update', id: entry.id, title: '长'.repeat(61) },
    { action: 'update', id: entry.id, text: '' },
    { action: 'update', id: entry.id, text: '长'.repeat(2001) },
    { action: 'update', id: entry.id, keywords: ['长'.repeat(41)] },
    { action: 'update', id: entry.id, keywords: Array(21).fill('夜') },
    { action: 'update', id: entry.id, constant: 'true' },
    { action: 'add', ...entry, id: '长'.repeat(41) },
    { action: 'add', ...entry, id: ' ' },
  ]) await assert.rejects(() => run(args), { code: 'BAD_PARAMS' })
  await assert.rejects(() => tool('novel_write').execute({ project: id, key: 'lorebook', content: JSON.stringify({
    entries: Array.from({ length: 201 }, (_, i) => ({ ...entry, id: String(i) })),
  }) }), { code: 'BAD_PARAMS' })
  assert.deepEqual(await stored(), old)
  const replacement = '仪式改在黎明举行。'
  assert.deepEqual(await run({ action: 'update', id: entry.id, text: replacement }), { ok: true, entries: 1 })
  assert.equal((await run({ action: 'list' })).entries[0].preview, replacement)
  assert.ok((await context()).includes(replacement))
  assert.deepEqual(await run({ action: 'remove', id: entry.id }), { ok: true, entries: 0 })
  await assert.rejects(() => run({ action: 'remove', id: entry.id }), { code: 'NOT_FOUND' })
  assert.deepEqual(await run({ action: 'list' }), { ok: true, entries: [] })
  assert.ok(!(await context()).includes(section))
})

test('修订使用 assemblePacket 注入世界书', async () => {
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  const prose = '沈砚到门前，发现门后腾起一簇火苗。'.repeat(20)
  const finding = { severity: 'block', issue: '补足火苗的来源', fix: '门后有火把' }
  const ctx = createFakeCtx({ item: chapter, artifacts: {
    outline, lorebook: { entries: [{ ...entry, constant: true }] },
    [`beats/${chapter.id}`]: sampleBeats(chapter.id),
    [`draft/${chapter.id}`]: prose,
    [`review/${chapter.id}`]: { verdict: 'revise', findings: [finding] },
  }, outputs: [{ text: `${prose}火把歪在门后。\n<<<SUMMARY>>>\n沈砚发现一把火把。` }] })
  let packet
  const recipe = createNovelRecipe({ prompts: { revise: context => {
    packet = context.packet
    return { system: '测试', user: '修订' }
  } } })
  await recipe.stages.find(stage => stage.id === 'revise').run(ctx)
  assert.match(packet.sections.lore, /【血月之夜】仪式必须在午夜举行。/)
})
