// 源级断言：只读源码字符串，不渲染、不 build。
// 目的：锁住新建向导的网文长篇参数与预估口径，防止「控件在、不提交」这类回归。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

const wizard = read('../client-src/components/CreateWizard.jsx')
const strings = read('../client-src/strings.js')

const NEW_FIELDS = [
  'channel',
  'tags',
  'sellingPoint',
  'goldenFinger',
  'comps',
  'updateCadence',
  'chaptersPerVolume',
]

test('向导源码里出现每个新字段', () => {
  for (const field of NEW_FIELDS) {
    assert.match(wizard, new RegExp(`\\b${field}\\b`), `CreateWizard.jsx 缺少字段 ${field}`)
  }
})

test('提交对象包含七个新字段', () => {
  const start = wizard.indexOf('params: {')
  assert.ok(start > -1, '找不到 params: {')
  const end = wizard.indexOf('startRun', start)
  assert.ok(end > start, '找不到 params 之后的 startRun')
  const params = wizard.slice(start, end)
  for (const field of NEW_FIELDS) {
    assert.match(params, new RegExp(`\\b${field}\\s*:`), `提交的 params 里缺少 ${field}`)
  }
})

test('estimateFor 与 recipe.estimate 同口径', () => {
  const start = wizard.indexOf('export function estimateFor')
  assert.ok(start > -1, '找不到 estimateFor')
  const end = wizard.indexOf('\nfunction duration', start)
  assert.ok(end > start, '找不到 estimateFor 的结束位置')
  const body = wizard.slice(start, end)
  // 固定 7 段 + 每章 3.5 次（关审校 2.5 次）+ 卷纲；数字用正则断言，不写死整行。
  assert.match(body, /\b7\b\s*\+/, '固定调用段 7 缺失')
  assert.match(body, /\b3\.5\b/, '每章 3.5 次缺失')
  assert.match(body, /\b2\.5\b/, '不开审校时每章 2.5 次缺失')
  assert.match(body, /chaptersPerVolume/, '卷数计算没有吃 chaptersPerVolume')
})

test('strings.js 里有频道 / 节奏 / 七个字段文案', () => {
  for (const label of ['男频', '女频', '通用', '日更', '周更', '不定期', '更多设定']) {
    assert.ok(strings.includes(label), `strings.js 缺少文案 ${label}`)
  }
  for (const label of ['频道', '标签', '一句话卖点', '每卷章数', '更新节奏', '金手指', '对标作品']) {
    assert.ok(strings.includes(label), `strings.js 缺少字段标签 ${label}`)
  }
})
