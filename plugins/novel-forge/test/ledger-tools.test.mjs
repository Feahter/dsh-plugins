// 本轮修复的回归测试：角色淘汰策略、novel_write 字节数、章节 id 宽度与缺失报错。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeLedger, LIMITS } from '../src/recipes/novel/ledger.js'
import { createTools } from '../src/host/tools.js'

const chapterId = (number) => `ch${String(number).padStart(2, '0')}`

test('ledger：配角超限按最久未出现淘汰，主角永不被淘汰', () => {
  let ledger = { facts: [], threads: [], characters: {}, timeline: [], canonRules: [] }
  for (let i = 1; i <= 45; i += 1) {
    ledger = mergeLedger(
      ledger,
      { characters: { [`配角${i}`]: { location: `地点${i}`, state: '在场' } } },
      chapterId(i),
    )
  }
  // 前 5 个配角在 40 上限处已被淘汰。
  assert.equal(Object.keys(ledger.characters).length, LIMITS.characters)
  assert.equal(ledger.characters['配角1'], undefined)

  ledger = mergeLedger(
    ledger,
    { characters: { 主角: { role: '主角', location: '殡仪馆', state: '夜班' } } },
    'ch01',
  )

  assert.ok(ledger.characters['主角'], '第 1 章出场的主角必须还在账本里')
  assert.equal(ledger.characters['主角'].lastSeen, 'ch01')
  assert.equal(ledger.characters['主角'].role, '主角')
  assert.equal(Object.keys(ledger.characters).length, LIMITS.characters)
  assert.equal(ledger.characters['配角6'], undefined, '最久的配角被淘汰')
  assert.ok(ledger.characters['配角45'], '最近的配角保留')
})

test('ledger：主角重复出现会刷新 lastSeen 并保住位置', () => {
  let ledger = { facts: [], threads: [], characters: {}, timeline: [], canonRules: [] }
  ledger = mergeLedger(ledger, { characters: { 主角: { role: '主角', state: '活' } } }, 'ch01')
  for (let i = 2; i <= 45; i += 1) {
    ledger = mergeLedger(ledger, { characters: { [`配角${i}`]: { state: '在场' } } }, chapterId(i))
  }
  assert.equal(ledger.characters['主角'].lastSeen, 'ch01')
  assert.equal(Object.keys(ledger.characters).length, LIMITS.characters)
  assert.ok(ledger.characters['主角'])
  assert.equal(ledger.characters['配角2'], undefined)

  ledger = mergeLedger(ledger, { characters: { 主角: { state: '重伤' } } }, 'ch30')
  assert.equal(ledger.characters['主角'].lastSeen, 'ch30')
  assert.equal(ledger.characters['主角'].state, '重伤')
  assert.equal(ledger.characters['主角'].role, '主角', '没重传 role 也不能丢')
})

test('ledger：全是主角时只保上限内最近出现的', () => {
  let ledger = { facts: [], threads: [], characters: {}, timeline: [], canonRules: [] }
  for (let i = 1; i <= LIMITS.characters + 5; i += 1) {
    ledger = mergeLedger(ledger, { characters: { [`主角${i}`]: { role: '主角' } } }, chapterId(i))
  }
  const names = Object.keys(ledger.characters)
  assert.equal(names.length, LIMITS.characters)
  assert.equal(ledger.characters['主角1'], undefined)
  assert.ok(ledger.characters[`主角${LIMITS.characters + 5}`])
})

function makeProject(artifacts = {}) {
  return { id: 'p_test', title: '长夜将明', artifacts, params: { chapters: 120 }, stats: {} }
}

function makeEngine(project, { writeArtifact } = {}) {
  const contents = { 'draft/ch005': '第五章正文' }
  return {
    resolveProject: async () => project,
    getArtifact: async (_id, key) => (key in contents ? { key, kind: 'md', content: contents[key] } : null),
    writeArtifact: writeArtifact ?? (async (_id, key, value) => ({
      key,
      kind: value.kind,
      content: value.content,
      meta: { version: 4, bytes: 42 },
    })),
  }
}

test('novel_read：章 id 宽度跟随项目里实际的 draft/chNNN', async () => {
  const project = makeProject({ outline: { kind: 'json' }, 'draft/ch005': { kind: 'md', version: 1 } })
  const read = createTools(makeEngine(project)).find(item => item.name === 'novel_read')
  const value = await read.execute({ chapter: '5' })
  assert.equal(value.chapter, 'ch005')
  assert.equal(value.draft, '第五章正文')
})

test('novel_read：映射后没有该章产物时报 CHAPTER_NOT_FOUND，不静默返回 null', async () => {
  const project = makeProject({ outline: { kind: 'json' }, 'draft/ch005': { kind: 'md', version: 1 } })
  const read = createTools(makeEngine(project)).find(item => item.name === 'novel_read')
  await assert.rejects(
    () => read.execute({ chapter: '1' }),
    error => {
      assert.equal(error.code, 'CHAPTER_NOT_FOUND')
      assert.equal(error.status, 404)
      assert.equal(error.detail.chapter, 'ch001')
      assert.match(error.message, /ch005/)
      return true
    },
  )
})

test('novel_read：没有 draft key 时退回两位补零', async () => {
  const project = makeProject({ outline: { kind: 'json' } })
  const read = createTools(makeEngine(project)).find(item => item.name === 'novel_read')
  await assert.rejects(
    () => read.execute({ chapter: '3' }),
    error => {
      assert.equal(error.code, 'CHAPTER_NOT_FOUND')
      assert.equal(error.detail.chapter, 'ch03')
      assert.equal(error.detail.width, 2)
      return true
    },
  )
})

test('novel_write：bytes 取自 meta.bytes', async () => {
  const write = createTools(makeEngine(makeProject())).find(item => item.name === 'novel_write')
  const saved = await write.execute({ key: 'draft/ch01', content: '新正文' })
  assert.equal(saved.ok, true)
  assert.equal(saved.bytes, 42)
  assert.equal(saved.version, 4)
})

test('novel_write：meta 缺 bytes 时为 null', async () => {
  const engine = makeEngine(makeProject(), {
    writeArtifact: async (_id, key, value) => ({ key, kind: value.kind, content: value.content, meta: { version: 1 } }),
  })
  const write = createTools(engine).find(item => item.name === 'novel_write')
  const saved = await write.execute({ key: 'draft/ch01', content: '新正文' })
  assert.equal(saved.bytes, null)
})
