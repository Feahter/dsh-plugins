/**
 * 混合检索小基准：复制真实索引到临时目录（不写 ~/.dsh/context-lib），
 * 打 10 条真实感查询，原样打印 keyword vs hybrid 的 top5 与耗时。
 *
 * 用法：node test/bench-search.mjs
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createLibrary } from '../src/store.js'

const QUERIES = [
  '热更新',
  '知识管理',
  'context_lib_search',
  'github token',
  'session 会话',
  'markdown 预览',
  '扫描 source',
  '回收站',
  'safeStorage',
  'pnpm install',
]

const realRoot = path.join(os.homedir(), '.dsh', 'context-lib')
const realIndex = path.join(realRoot, 'index.json')
const realSources = path.join(realRoot, 'sources.json')

async function readOrNull(file) {
  try {
    return await fs.readFile(file)
  } catch {
    return null
  }
}

function short(text, width = 46) {
  const value = String(text ?? '').replace(/\s+/g, ' ')
  return value.length > width ? `${value.slice(0, width - 1)}…` : value
}

function ms(value) {
  return `${value.toFixed(1)}ms`
}

const indexBytes = await readOrNull(realIndex)
if (!indexBytes) {
  console.log(`跳过：读不到真实索引 ${realIndex}`)
  process.exit(0)
}
const sourcesBytes = await readOrNull(realSources)
// 真实索引当前有 333 条 entry.id 与 map key 不一致（store 加载时会丢弃）。基准只修
// 临时副本的 id，让 3862 条全部参与；用户真实 index.json 一个字节都不动。
const indexJson = JSON.parse(indexBytes.toString('utf8'))
let repairedIds = 0
for (const [id, entry] of Object.entries(indexJson.entries)) {
  if (entry.id !== id) {
    entry.id = id
    repairedIds += 1
  }
}

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'ctxlib-bench-'))
try {
  await fs.writeFile(path.join(sandbox, 'index.json'), JSON.stringify(indexJson))
  if (sourcesBytes) await fs.writeFile(path.join(sandbox, 'sources.json'), sourcesBytes)
  const lib = await createLibrary(sandbox)
  await lib.init()
  const stats = await lib.stats()
  console.log(`# 语料：${stats.counts.active} 条 active（复制自 ${realIndex}，临时目录 ${sandbox}）`)
  if (repairedIds) console.log(`# 临时副本修正了 ${repairedIds} 条 key/id 不一致的条目（仅为让全部条目参与基准）`)
  console.log('')

  // 第一次 hybrid 查询是冷启动：检索串/分词缓存都还没建。
  const coldStart = performance.now()
  await lib.list({ q: QUERIES[0], limit: 20 })
  const coldMs = performance.now() - coldStart
  console.log(`# 冷启动（第一条 hybrid 查询，含建缓存）：${ms(coldMs)}`)
  console.log('')

  for (const query of QUERIES) {
    const keywordStart = performance.now()
    const keyword = await lib.list({ q: query, mode: 'keyword', limit: 5 })
    const keywordMs = performance.now() - keywordStart

    // 先跑一次热身，再计时同一条 hybrid 查询。
    await lib.list({ q: query, limit: 20 })
    const hybridStart = performance.now()
    const hybrid = await lib.list({ q: query, limit: 20 })
    const hybridMs = performance.now() - hybridStart
    const hybridTop = await lib.list({ q: query, limit: 5 })

    console.log(`## ${query}`)
    console.log(`keyword  total=${keyword.total}  ${ms(keywordMs)}`)
    keyword.items.forEach((item, position) => {
      console.log(`  ${position + 1}. [${item.id}] ${short(item.title)}`)
    })
    console.log(`hybrid   total=${hybrid.total}  ${ms(hybridMs)}  (limit=20，含 top20 行号)`)
    hybridTop.items.forEach((item, position) => {
      console.log(`  ${position + 1}. score=${item.score.toFixed(3)} line=${item.line} [${item.id}] ${short(item.title)}`)
    })
    console.log('')
  }
} finally {
  await fs.rm(sandbox, { recursive: true, force: true })
}
