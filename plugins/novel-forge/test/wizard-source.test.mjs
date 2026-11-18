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

test('预估只用服务端结果，参数包含上下文预算且失败明确提示', () => {
  assert.doesNotMatch(wizard, /estimateFor|localEstimate|form\.autoReview|5483|6324/)
  assert.match(wizard, /api\.estimateNew\(estimateParams\)/)
  assert.match(wizard, /contextBudget: Number\(form\.contextBudget\)/)
  assert.match(wizard, /autoReview: true/)
  assert.match(wizard, /估算中…/)
  assert.match(wizard, /估算暂不可用/)
  assert.match(wizard, /serverEstimate\?\.params === estimateParams/)
})

test('strings.js 里有频道 / 节奏 / 七个字段文案', () => {
  for (const label of ['男频', '女频', '通用', '日更', '周更', '不定期', '更多设定']) {
    assert.ok(strings.includes(label), `strings.js 缺少文案 ${label}`)
  }
  for (const label of ['频道', '标签', '一句话卖点', '每卷章数', '更新节奏', '金手指', '对标作品']) {
    assert.ok(strings.includes(label), `strings.js 缺少字段标签 ${label}`)
  }
})
