#!/usr/bin/env node
// 把 scripts/version-check.mjs（规范实现）同步到每个插件的 version-check.js。
//
//   node scripts/sync-version-check.mjs          # 写入/覆盖
//   node scripts/sync-version-check.mjs --check  # 只校验，不一致退出 1（CI 用）

import { readFile, writeFile } from 'node:fs/promises'

const PLUGINS = [
  'archive-rsi',
  'context-lib',
  'dsh-360',
  'github-manager',
  'mind-canvas',
  'novel-forge',
  'realtime-voice',
  'task-ledger',
  'update-check',
  'voice-companion',
  'voice-control',
]

const checkOnly = process.argv.includes('--check')
const sourceUrl = new URL('./version-check.mjs', import.meta.url)
const source = await readFile(sourceUrl, 'utf8')
const drift = []

for (const name of PLUGINS) {
  const target = new URL(`../plugins/${name}/version-check.js`, import.meta.url)
  if (checkOnly) {
    let current = null
    try {
      current = await readFile(target, 'utf8')
    } catch {
      drift.push(`${name}: missing`)
      continue
    }
    if (current !== source) drift.push(`${name}: out of date`)
    continue
  }
  await writeFile(target, source)
  console.log(`synced plugins/${name}/version-check.js`)
}

if (checkOnly) {
  if (drift.length > 0) {
    console.error(`version-check drift:\n  ${drift.join('\n  ')}\nRun: node scripts/sync-version-check.mjs`)
    process.exit(1)
  }
  console.log(`version-check copies are in sync (${PLUGINS.length} plugins)`)
}
