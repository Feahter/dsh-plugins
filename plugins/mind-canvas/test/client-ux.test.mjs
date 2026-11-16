// 客户端行为回归（源码级）：这两处都曾造成用户输入/数据静默丢失，
// 但渲染路径需要 React Flow + 浏览器，交给 dev/verify.mjs 做真实点击验证；
// 这里锁住「表单提交必须读输入框」「首屏必须恢复本地快照」两个实现点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client-src/app.jsx', import.meta.url), 'utf8')

test('空态表单提交读输入框文字，而不是固定建一颗空节点', () => {
  assert.match(
    source,
    /const submitEmpty = React\.useCallback\(event => \{[\s\S]*?emptyInputRef\.current[\s\S]*?addNode\(null, value, null\)/,
    '提交按钮应把输入框内容交给 addNode',
  )
  assert.match(source, /onSubmit: submitEmpty/, '空态表单应绑定 submitEmpty')
})

test('首屏选状态时优先恢复浏览器里的未同步快照', () => {
  assert.match(
    source,
    /pickInitialState\(payload\?\.state \?\? payload, readLocalSnapshot\(\)\)/,
    'GET /state 成功后要与本地快照一起判定',
  )
  assert.match(source, /if \(picked\.recovered\) notify\(t\('localRecovered'\)/, '恢复后要告知用户并回写宿主')
})
