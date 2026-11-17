// 客户端行为回归（源码级）：这两处都曾造成用户输入/数据静默丢失，
// 但渲染路径需要 React Flow + 浏览器，交给 dev/verify.mjs 做真实点击验证；
// 这里锁住「表单提交必须读输入框」「首屏必须恢复本地快照」两个实现点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client-src/app.jsx', import.meta.url), 'utf8')
const entry = await readFile(new URL('../client-src/index.jsx', import.meta.url), 'utf8')
const panel = await readFile(new URL('../client-src/panel.jsx', import.meta.url), 'utf8')

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

// 启动成本回归：首屏入口只注册侧栏/主面板，重画布实现必须留在动态 chunk 里，
// 由首次打开面板时 require.async 加载。若有人把画布 import 回入口，这条会挂。
test('首屏入口不静态引入画布本体，面板走 require.async 懒加载', () => {
  assert.doesNotMatch(entry, /from '\.\/app\.jsx'/, '入口不应再静态 import 画布实现')
  assert.match(entry, /__DSH_REQUIRE__\.async\('\.\/client\.panel\.js'\)/, '入口应通过 require.async 加载面板 chunk')
  assert.match(entry, /ctx\.slots\.register\(\{[\s\S]*?name: 'sidebar\.panellist'/, '侧栏入口仍要在首屏注册')
  assert.match(entry, /name: 'main',[\s\S]*?key: PANEL_KEY/, '主面板 key 仍要首屏注册')
})

test('面板 chunk 导出 Panel，并带画布样式与语音桥', () => {
  assert.match(panel, /export function Panel/, 'chunk 要导出 Panel')
  assert.match(panel, /injectStylesOnce\(document\)/, '样式应在面板打开时才注入')
  assert.match(panel, /export function startVoice/, '语音桥应随面板加载')
})
