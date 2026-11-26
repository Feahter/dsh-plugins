import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { KIND, MaterialsLibrary } from '../src/forge/materials.js'
import { Store } from '../src/forge/store.js'
import { createTools } from '../src/host/tools.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { buildPacket, MATERIALS_SPEC, materialsTextOf } from '../src/recipes/novel/packet.js'
import { TRUNCATE_MARK } from '../src/forge/text.js'
import { createFakeCtx, SAMPLE_PARAMS, sampleBeats, sampleOutlineV2 } from './fixtures/novel-fixtures.mjs'

const entry = { id: '钩子-1', kind: 'trope', title: '章末钩子', tags: ['悬念'], text: '留一个可兑现的谜面。' }
const stamp = '2026-01-01T00:00:00.000Z'

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'forge-materials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('素材库跨书落盘，检索摘要、按更新时间排序并更新版本', async t => {
  const root = await tempRoot(t)
  const store = new Store(root)
  let now = new Date(stamp)
  const library = new MaterialsLibrary(store, () => now)
  const stored = await library.add(entry)
  assert.deepEqual(stored, { ...entry, source: 'user', version: 1, uses: 0, createdAt: stamp, updatedAt: stamp })
  const file = join(root, 'materials', 'trope', `${entry.id}.json`)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), stored)
  assert.deepEqual(await readdir(join(root, 'materials', 'trope')), [`${entry.id}.json`])
  const engine = new ForgeEngine({ root: join(root, 'unused'), store })
  assert.deepEqual(await engine.materials.get(entry.id), stored)
  now = new Date('2026-01-02')
  await library.add({ ...entry, id: 'another', kind: 'world', tags: [], source: 'community' })
  const summary = { id: entry.id, kind: entry.kind, title: entry.title, tags: entry.tags,
    source: 'user', version: 1, uses: 0, preview: entry.text }
  assert.deepEqual((await library.list()).map(item => item.id), ['another', entry.id])
  for (const filter of [{ kind: 'trope' }, { tag: '悬念' }, { source: 'user' }, { query: '谜面', source: 'user' }]) {
    assert.deepEqual(await library.list(filter), [summary])
  }
  assert.deepEqual(await library.list({ query: '不匹配' }), [])
  now = new Date('2026-01-03')
  const updated = await library.update(entry.id, { title: '新钩子', kind: 'world', source: 'system', id: 'new', uses: 9 })
  assert.deepEqual(updated, { ...stored, title: '新钩子', version: 2, updatedAt: now.toISOString() })
  assert.deepEqual((await library.list()).map(item => item.id), [entry.id, 'another'])
  await Promise.all([library.bumpUses([entry.id]), library.bumpUses([entry.id, entry.id])])
  assert.deepEqual(await library.get(entry.id), { ...updated, uses: 2 })
  await library.remove(entry.id)
  await assert.rejects(() => library.get(entry.id), { code: 'NOT_FOUND' })
  await assert.rejects(() => readFile(file), { code: 'ENOENT' })
})

test('非法条目不落盘，跨 kind 的重复 id 被拒绝', async t => {
  const root = await tempRoot(t)
  const library = new MaterialsLibrary(new Store(root))
  for (const patch of [
    { id: '' }, { id: '../外部' }, { id: '空 格' }, { id: '字'.repeat(41) },
    { kind: 'unknown' }, { kind: 'constructor' },
    { title: '' }, { title: '字'.repeat(61) }, { text: '' }, { text: '字'.repeat(4001) },
    { tags: '标签' }, { tags: Array(13).fill('字') }, { tags: [''] }, { tags: ['字'.repeat(21)] },
    { source: 'other' },
  ]) await assert.rejects(() => library.add({ ...entry, ...patch }), { code: 'BAD_PARAMS' })
  assert.deepEqual(await readdir(root), [])
  const added = await library.add(entry)
  await assert.rejects(() => library.add({ ...entry, kind: 'world' }), { code: 'BAD_PARAMS' })
  await assert.rejects(() => library.update(entry.id, { text: '' }), { code: 'BAD_PARAMS' })
  await assert.rejects(() => library.bumpUses([entry.id, 'missing']), { code: 'NOT_FOUND' })
  assert.deepEqual(await library.get(entry.id), added)
  assert.deepEqual(await readdir(join(root, 'materials')), ['trope'])
})

test('seed 幂等，十条系统素材题材无关且每条在 80–300 字内', async t => {
  const library = new MaterialsLibrary(new Store(await tempRoot(t)))
  assert.ok(Object.isFrozen(KIND))
  assert.deepEqual(Object.keys(KIND), ['world', 'power', 'character', 'trope', 'outline', 'style', 'consistency', 'market', 'prompt'])
  assert.deepEqual(await library.seed(), { added: 10, skipped: 0 })
  const summaries = await library.list({ source: 'system' })
  const entries = await Promise.all(summaries.map(({ id }) => library.get(id)))
  assert.equal(entries.length, 10)
  assert.ok(new Set(entries.map(item => item.kind)).size >= 6)
  const genreWords = ['修仙', '系统流', '都市', '筑基', '金丹', '异能']
  for (const { id, title, tags, text, source } of entries) {
    assert.equal(source, 'system')
    assert.ok(text.length >= 80 && text.length <= 300, `${id} 的长度为 ${text.length}`)
    for (const word of genreWords) assert.ok(![title, ...tags, text].some(value => value.includes(word)), `${id}: ${word}`)
  }
  const [first] = entries
  await library.update(first.id, { title: '调整后的种子标题' })
  assert.deepEqual(await library.seed(), { added: 0, skipped: 10 })
  assert.equal((await library.get(first.id)).title, '调整后的种子标题')
})

test('novel_materials 提供跨书库工具和八种 action 的参数表', async t => {
  const engine = new ForgeEngine({ root: await tempRoot(t) })
  const tool = createTools(engine).find(item => item.name === 'novel_materials')
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'get', 'add', 'update', 'remove', 'seed', 'attach', 'detach'])
  assert.deepEqual(await tool.execute({ action: 'list' }), { ok: true, entries: [] })
  assert.deepEqual(await tool.execute({ action: 'add', ...entry }), { ok: true, id: entry.id })
  assert.deepEqual(await tool.execute({ action: 'get', id: entry.id }), {
    ok: true, entry: await engine.materials.get(entry.id),
  })
  assert.deepEqual(await tool.execute({ action: 'list', kind: 'trope', source: 'user', tag: '悬念', query: '谜面' }), {
    ok: true, entries: [{ id: entry.id, kind: entry.kind, title: entry.title, tags: entry.tags,
      source: 'user', version: 1, uses: 0, preview: entry.text }],
  })
  assert.deepEqual(await tool.execute({ action: 'update', id: entry.id, tags: [] }), { ok: true, id: entry.id, version: 2 })
  for (const args of [
    { action: 'unknown' }, { action: 'get' }, { action: 'list', source: 'other' },
    { action: 'list', kind: 'constructor' }, { action: 'list', query: false },
    { action: 'add', ...entry, id: 'new', source: 'system' },
    { action: 'update', id: entry.id, tags: null }, { action: 'add', ...entry, kind: 'world' },
  ]) await assert.rejects(() => tool.execute(args), { code: 'BAD_PARAMS' })
  assert.deepEqual(await tool.execute({ action: 'remove', id: entry.id }), { ok: true, removed: true })
  for (const action of ['get', 'update', 'remove']) {
    await assert.rejects(() => tool.execute({ action, id: entry.id }), { code: 'NOT_FOUND' })
  }
  assert.deepEqual(await tool.execute({ action: 'seed' }), { ok: true, added: 10, skipped: 0 })
})

test('attach 保存快照供 novel_context 使用，detach 按条或清空', async t => {
  const engine = new ForgeEngine({ root: await tempRoot(t), recipes: [createNovelRecipe()], clock: () => new Date(stamp), llm: {
    generate: () => assert.fail('已写入细纲，无需调用模型'),
  } })
  const params = { ...SAMPLE_PARAMS, contextBudget: 12000 }
  const project = await engine.createProject({ recipeId: 'novel', title: '快照书', params })
  const other = await engine.createProject({ recipeId: 'novel', title: '另一册', params })
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  await engine.writeArtifact(project.id, 'outline', { content: outline })
  await engine.writeArtifact(project.id, `beats/${chapter.id}`, { content: sampleBeats(chapter.id) })
  await engine.writeArtifact(project.id, 'lorebook', { content: { entries: [{ title: '背景', text: '已有规则。', constant: true }] } })
  const tools = createTools(engine)
  const execute = (name, args) => tools.find(item => item.name === name).execute(args)
  const run = args => execute('novel_materials', { project: project.id, ...args })
  const context = async () => JSON.stringify(await execute('novel_context', { project: project.id, chapter: chapter.id }))
  const stored = () => engine.getArtifact(project.id, 'materials')
  const second = { ...entry, id: 'rule', kind: 'consistency', title: '知情核对', text: '检查消息从何而来。' }
  await run({ action: 'add', ...entry })
  await run({ action: 'add', ...second })
  assert.equal(await stored(), null)
  assert.doesNotMatch(await context(), /## 素材/)

  for (const args of [
    { action: 'attach', ids: [] }, { action: 'attach', ids: entry.id }, { action: 'attach', ids: ['路径/片段'] },
    { action: 'detach', ids: [] }, { action: 'detach' }, { action: 'detach', all: 'true' },
    { action: 'detach', all: true, ids: [entry.id] },
  ]) await assert.rejects(() => run(args), { code: 'BAD_PARAMS' })
  await assert.rejects(() => run({ action: 'attach', ids: [entry.id, 'missing'] }), { code: 'NOT_FOUND' })
  assert.equal(await stored(), null)
  assert.equal((await engine.materials.get(entry.id)).uses, 0)

  assert.deepEqual(await run({ action: 'attach', ids: [entry.id, second.id, entry.id] }), { ok: true, attached: 2 })
  assert.deepEqual((await stored()).content, { entries: [entry, second], attachedAt: stamp })
  assert.equal((await stored()).meta.by.stage, 'manual')
  assert.equal(await engine.getArtifact(other.id, 'materials'), null)
  assert.equal((await engine.materials.get(entry.id)).uses, 1)
  const prepared = await context()
  assert.match(prepared, /【桥段与爽点·章末钩子】\\n留一个可兑现的谜面。/)
  assert.ok(prepared.indexOf('## 世界书') >= 0 && prepared.indexOf('## 世界书') < prepared.indexOf('## 素材'))

  const text = '更新后的可兑现谜面。'
  await run({ action: 'update', id: entry.id, text })
  assert.equal((await stored()).content.entries[0].text, entry.text)
  assert.match(await context(), /留一个可兑现的谜面/)
  assert.deepEqual(await run({ action: 'attach', ids: [entry.id] }), { ok: true, attached: 2 })
  assert.deepEqual((await stored()).content.entries, [{ ...entry, text }, second])
  assert.equal((await engine.materials.get(entry.id)).uses, 2)
  await run({ action: 'remove', id: entry.id })
  assert.match(await context(), /更新后的可兑现谜面/)
  assert.deepEqual(await run({ action: 'detach', ids: [entry.id] }), { ok: true, attached: 1 })
  assert.deepEqual((await stored()).content.entries, [second])
  assert.deepEqual(await run({ action: 'detach', all: true }), { ok: true, attached: 0 })
  assert.deepEqual((await stored()).content.entries, [])
  assert.equal((await engine.materials.get(second.id)).uses, 1)
  assert.doesNotMatch(await context(), /## 素材/)
})

test('素材分片含标题共 600 字，常规预算完整保留，紧预算可让出', () => {
  const input = { params: { contextBudget: 12000 }, loreText: '世界书条目', worldBrief: '世界设定正文', canonText: '正典条目' }
  const materialsText = materialsTextOf([entry, { kind: 'style', title: '换成动作', text: '用具体动作表达情绪。' }])
  assert.equal(materialsText, '【桥段与爽点·章末钩子】\n留一个可兑现的谜面。\n\n【文风与去AI味·换成动作】\n用具体动作表达情绪。')
  assert.deepEqual(MATERIALS_SPEC, { name: 'materials', title: '素材', cap: 600, priority: 2, required: false })
  const packet = buildPacket({ ...input, materialsText })
  assert.equal(packet.sections.materials, `## 素材\n${materialsText}`)
  assert.deepEqual(packet.text.match(/^## (?:世界书|素材|世界设定|正典)$/gm), ['## 世界书', '## 素材', '## 世界设定', '## 正典'])
  assert.ok(!buildPacket(input).report.slices.some(row => row.name === 'materials'))
  const long = buildPacket({ ...input, materialsText: materialsTextOf([{ ...entry, text: '字'.repeat(1000) }]) })
  assert.equal(long.sections.materials.length, 600)
  assert.ok(long.sections.materials.endsWith(TRUNCATE_MARK))
  assert.equal(long.report.slices.find(row => row.name === 'materials').truncated, false)
  const tight = buildPacket({ ...input, params: { contextBudget: 1500 }, beats: '节拍'.repeat(1500), materialsText })
  assert.equal(tight.report.slices.find(row => row.name === 'materials').dropped, true)
  assert.ok(tight.sections.lore)
  assert.equal(tight.text.length, 1500)
})

test('修订使用 assemblePacket 注入项目素材', async () => {
  const outline = sampleOutlineV2({ chapters: 3 })
  const chapter = outline.chapters[0]
  const prose = '沈砚到门前，发现门后腾起一簇火苗。'.repeat(20)
  const ctx = createFakeCtx({ item: chapter, artifacts: {
    outline, materials: { entries: [entry], attachedAt: stamp },
    [`beats/${chapter.id}`]: sampleBeats(chapter.id),
    [`draft/${chapter.id}`]: prose,
    [`review/${chapter.id}`]: { verdict: 'revise', findings: [{ severity: 'block', issue: '补足火苗的来源', fix: '门后有火把' }] },
  }, outputs: [{ text: `${prose}火把歪在门后。\n<<<SUMMARY>>>\n沈砚发现一把火把。` }] })
  let packet
  const recipe = createNovelRecipe({ prompts: { revise: context => {
    packet = context.packet
    return { system: '测试', user: '修订' }
  } } })
  await recipe.stages.find(stage => stage.id === 'revise').run(ctx)
  assert.equal(packet.sections.materials, `## 素材\n【桥段与爽点·章末钩子】\n${entry.text}`)
})
