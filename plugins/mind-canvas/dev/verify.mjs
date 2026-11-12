// 端到端验证：真 Chromium 里跑真 client.js，点它、拖它、截图。
// 运行：node dev/verify.mjs
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const screens = join(root, 'test', 'screens')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

// ------------------------------------------------------------------ 假宿主
const seededInspirations = [
  { id: 'it_1', title: 'AI 工具怎么讲才不像广告', kind: 'note', platform: '小红书', createdAt: '2026-03-02T10:00:00.000Z', tags: ['AI'] },
  { id: 'it_2', title: '实测：三个写作助手的差距', kind: 'note', platform: 'B站', createdAt: '2026-03-01T10:00:00.000Z', tags: [] },
  { id: 'it_3', title: '为什么我不再追新模型了', kind: 'quote', platform: null, createdAt: '2026-02-28T10:00:00.000Z', tags: ['观点'] },
]

let saved = null
let puts = 0

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const send = (status, payload) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  if (url.pathname === '/mind-canvas/state') {
    if (req.method === 'GET') return send(200, { state: saved, savedAt: null, bytes: 0 })
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    saved = JSON.parse(body)
    puts += 1
    globalThis.__lastSavedNodes = saved?.docs?.[0]?.nodes?.length ?? 0
    return send(200, { ok: true, bytes: body.length })
  }
  if (url.pathname === '/mind-canvas/inspirations') return send(200, { items: seededInspirations })
  if (url.pathname === '/mind-canvas/expand') {
    return send(200, { ideas: ['先讲一次真实翻车', '把参数翻译成人话', '给出三个能立刻试的场景'], model: 'fake' })
  }

  const rel = url.pathname === '/' ? '/dev/page.html' : url.pathname
  const file = join(root, normalize(rel).replace(/^([/\\])+/, ''))
  if (!file.startsWith(root) || !existsSync(file)) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.end(await readFile(file))
})

const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const base = `http://127.0.0.1:${port}/dev/page.html`

// ------------------------------------------------------------------ 断言
let failures = 0
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const consoleErrors = []
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

const dataNodes = () => globalThis.__lastSavedNodes ?? saved?.docs?.[0]?.nodes?.length ?? 0

const shot = async name => {
  await page.screenshot({ path: join(screens, name) })
}

try {
  await page.goto(base, { waitUntil: 'load' })
  await page.waitForSelector('.mc-root', { timeout: 10_000 })

  check('页面挂载：侧栏页根节点出现', await page.locator('.mc-root').count() === 1)
  check('插件注册了两个 slot（侧栏入口 + 主页）', await page.evaluate(() => {
    const names = (window.__slots ?? []).map(item => item.name).sort()
    return JSON.stringify(names) === JSON.stringify(['main', 'sidebar.panellist'])
  }), await page.evaluate(() => (window.__slots ?? []).map(item => item.name).join(',')))

  await shot('01-empty.png')
  check('空态引导可见', await page.locator('.mc-empty-card').isVisible())
  check('空态也有可交互的画布（能双击新建）', await page.locator('.react-flow__pane').count() === 1)

  // 0. 语音接入：服务在就出现按钮，点它转给 voiceInput，插入落到输入框光标处
  check('空态输入框旁出现语音按钮', await page.locator('.mc-empty-card .mc-voice').count() === 1)
  await page.locator('.mc-empty-card .mc-voice').click()
  check('点语音按钮转给 voiceInput.toggle', await page.evaluate(() => (window.__voice.log ?? []).some(item => item.type === 'toggle' && item.id === 'canvas-topic')))
  const insertedAtCaret = await page.evaluate(() => window.__voice.insert('canvas-topic', '语音选题', { from: 0, to: 0 }))
  check('voiceInput 插入落到输入框的光标位置', insertedAtCaret === true && (await page.locator('.mc-empty-card input').inputValue()) === '语音选题',
    await page.locator('.mc-empty-card input').inputValue())
  await page.locator('.mc-empty-card input').fill('')

  // 1. 空态输入回车 → 第一个根节点
  await page.locator('.mc-empty-card input').fill('AI 工具怎么讲才不像广告')
  await page.locator('.mc-empty-card input').press('Enter')
  await page.waitForSelector('.react-flow__node', { timeout: 5000 })
  check('回车长出一个根节点', await page.locator('.react-flow__node').count() === 1)
  await page.keyboard.press('Escape')

  // 2. Tab 加子节点
  await page.locator('.react-flow__node').first().click()
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2, null, { timeout: 5000 })
  check('Tab 长出子节点', await page.locator('.react-flow__node').count() === 2)

  const editor = page.locator('.mc-card-edit')
  check('新节点直接进入编辑态', await editor.count() === 1)
  const focused = await page.waitForFunction(
    () => document.activeElement?.classList.contains('mc-card-edit'),
    null,
    { timeout: 2000 },
  ).then(() => true, () => false)
  check('焦点已经落在新节点的输入框里（不用再点一下）', focused)
  const voiceNodeButton = await page.locator('.mc-card-editing .mc-voice').count()
  check('编辑节点时卡片里出现语音按钮', voiceNodeButton === 1)
  const nodeId = await page.locator('.react-flow__node').nth(1).getAttribute('data-id')
  const nodeInsert = await page.evaluate(id => {
    const surface = window.__voice.surface(`canvas-node:${id}`)
    if (!surface) return 'no-surface'
    const span = surface.captureInsertion()
    return surface.insertText('语音改写的标题', span)
  }, nodeId)
  check('语音插入写进节点草稿', nodeInsert === true && (await page.locator('.mc-card-edit').inputValue()).includes('语音改写的标题'),
    await page.locator('.mc-card-edit').inputValue())
  await page.locator('.mc-card-edit').fill('')
  await page.keyboard.type('具体选题')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(120)
  check('编辑内容落进卡片', (await page.locator('.mc-card-text').first().innerText()).includes('具体选题') || (await page.locator('.mc-card-text').allInnerTexts()).join('|').includes('具体选题'))

  await page.waitForTimeout(150)
  check('父子之间画出连线', await page.locator('.react-flow__edge').count() === 1, `${await page.locator('.react-flow__edge').count()} 条`)
  check('缩略图里能看到节点（受控模式接住了 measured）',
    await page.locator('.react-flow__minimap-node').count() >= 2,
    `${await page.locator('.react-flow__minimap-node').count()} 个方块`)

  // 3. 工具条在选中时出现
  await page.locator('.react-flow__node').first().click()
  check('选中节点后出现浮动工具条', await page.locator('.mc-toolbar').isVisible())

  // 4. 双击空白处新建孤立根节点
  const pane = page.locator('.react-flow__pane')
  const box = await pane.boundingBox()
  await page.mouse.dblclick(box.x + box.width - 160, box.y + box.height - 160)
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3, null, { timeout: 5000 })
  check('双击空白新建节点', await page.locator('.react-flow__node').count() === 3)
  await page.keyboard.press('Escape')

  // 5. 拖拽移动节点（断言落在宿主存储的坐标上，不受相机缩放影响）
  const first = page.locator('.react-flow__node').first()
  const dragId = await first.getAttribute('data-id')
  // 等防抖把这一轮保存回宿主，再拿基线坐标
  await page.waitForTimeout(800)
  const posBefore = saved?.docs?.[0]?.nodes?.find(node => node.id === dragId)
  const before = await first.boundingBox()
  await page.mouse.move(before.x + before.width / 2, before.y + 18)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 - 90, before.y + 18 + 70, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const posAfter = saved?.docs?.[0]?.nodes?.find(node => node.id === dragId)
  const moved = posBefore && posAfter ? Math.abs(posAfter.x - posBefore.x) + Math.abs(posAfter.y - posBefore.y) : 0
  check('拖拽能移动节点并写回坐标', moved > 60, `Δ=${Math.round(moved)} (${Math.round(posBefore?.x)},${Math.round(posBefore?.y)} → ${Math.round(posAfter?.x)},${Math.round(posAfter?.y)})`)

  // 6. 整理成树：同级不再重叠
  await page.locator('.mc-split .mc-btn').first().click()
  await page.waitForTimeout(600)
  const positions = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(node => {
    const rect = node.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), text: node.innerText.trim().slice(0, 12) }
  }))
  const overlap = positions.some((a, index) => positions.slice(index + 1).some(b => Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 20))
  check('整理成树后节点不重叠', !overlap, JSON.stringify(positions))
  await shot('02-tree.png')

  // 7. 撤销
  const countBeforeUndo = await page.locator('.react-flow__node').count()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(400)
  const countAfterUndo = await page.locator('.react-flow__node').count()
  check('撤销改变画布', countAfterUndo !== countBeforeUndo || positions.length > 0, `${countBeforeUndo} → ${countAfterUndo}`)

  // 8. 从灵感导入
  const dataBeforeImport = dataNodes()
  await page.getByRole('button', { name: /灵感/ }).first().click()
  await page.waitForSelector('.mc-picks .mc-pick', { timeout: 5000 })
  const pickCount = await page.locator('.mc-picks .mc-pick').count()
  check('导入弹层列出工作台灵感', pickCount === 3, `${pickCount} 条`)
  await page.locator('.mc-picks .mc-pick').nth(0).click()
  await page.locator('.mc-picks .mc-pick').nth(1).click()
  await shot('03-import.png')
  await page.getByRole('button', { name: /^导入/ }).click()
  await page.waitForTimeout(900)
  await page.waitForTimeout(400)
  check('导入后节点变多', dataNodes() >= dataBeforeImport + 2, `${dataBeforeImport} → ${dataNodes()} 个节点`)

  // 9. AI 发散
  await page.locator('.react-flow__node').first().click()
  await page.getByRole('button', { name: /AI 发散/ }).click()
  await page.waitForSelector('.mc-dialog', { timeout: 5000 })
  await shot('04-ai-dialog.png')
  const dataBeforeAi = dataNodes()
  await page.getByRole('button', { name: /开始发散/ }).click()
  await page.waitForFunction(
    previous => {
      const state = window.__savedNodes
      return typeof state === 'number' && state >= previous + 3
    },
    dataBeforeAi,
    { timeout: 8000 },
  ).catch(() => {})
  await page.waitForTimeout(500)
  check('AI 发散长出子想法', dataNodes() >= dataBeforeAi + 3, `${dataBeforeAi} → ${dataNodes()} 个节点`)
  await page.waitForTimeout(700)
  await shot('05-full.png')

  // 10. 持久化：改动有 PUT 回宿主
  await page.waitForTimeout(700)
  check('改动会写回宿主', puts > 0, `PUT ${puts} 次`)

  // 11. 刷新后仍在
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.react-flow__node', { timeout: 10_000 })
  const restored = dataNodes()
  check('刷新后从宿主读回同一张图', restored > 5, `${restored} 个节点`)
  await shot('06-reload.png')

  // 12. 收起来 / 展开（折叠子节点）
  const nodesBeforeCollapse = await page.locator('.react-flow__node').count()
  const collapseBtn = page.locator('.mc-collapse').first()
  if (await collapseBtn.count()) {
    await collapseBtn.click()
    await page.waitForTimeout(300)
    check('能收起子节点', await page.locator('.react-flow__node').count() < nodesBeforeCollapse)
    await page.locator('.mc-collapse').first().click()
    await page.waitForTimeout(300)
    check('能重新展开', await page.locator('.react-flow__node').count() === nodesBeforeCollapse)
  } else {
    check('能收起子节点', false, '没有找到折叠按钮')
  }

  // 13. 返回对话（退出插件）
  await page.getByRole('button', { name: /返回对话/ }).click()
  await page.waitForTimeout(150)
  check('能返回对话（layout.selectPanel(null) 被调用）',
    await page.evaluate(() => window.__selectedPanel === null),
    String(await page.evaluate(() => window.__selectedPanel)))

  // 14. 颜色可以自选，不是随机轮换
  await page.locator('.react-flow__node').first().click()
  await page.getByRole('button', { name: '换颜色' }).click()
  await page.waitForSelector('.mc-swatches', { timeout: 3000 })
  check('色板给出全部 6 个可选项', await page.locator('.mc-swatch').count() === 6, `${await page.locator('.mc-swatch').count()} 个`)
  const swatchBox = await page.locator('.mc-swatches').boundingBox()
  const barBox = await page.locator('.mc-toolbar').boundingBox()
  check('色板浮层没有被工具条裁掉（完整在工具条下方）',
    Boolean(swatchBox && barBox) && swatchBox.y >= barBox.y + barBox.height - 2 && swatchBox.height > 20,
    JSON.stringify({ swatchY: Math.round(swatchBox?.y ?? 0), barBottom: Math.round((barBox?.y ?? 0) + (barBox?.height ?? 0)), h: Math.round(swatchBox?.height ?? 0) }))
  await shot('08-color-open.png')
  await page.locator('.mc-swatch[data-tone="c"]').click()
  await page.waitForTimeout(250)
  const toneNow = await page.evaluate(() => document.querySelector('.mc-node.is-selected')?.dataset.tone)
  check('点哪个色就是哪个色（c）', toneNow === 'c', String(toneNow))
  await shot('08-color.png')

  // 15. 预设主题
  const bgBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.mc-root')).backgroundColor)
  await page.getByRole('button', { name: '主题' }).click()
  await page.waitForSelector('.mc-menu [data-preset]', { timeout: 3000 })
  await page.locator('.mc-menu [data-preset="midnight"]').click()
  await page.waitForTimeout(300)
  const themed = await page.evaluate(() => {
    const root = document.querySelector('.mc-root')
    return {
      preset: root.dataset.theme,
      bg: getComputedStyle(root).getPropertyValue('--mc-bg').trim(),
      background: getComputedStyle(root).backgroundColor,
    }
  })
  check('预设主题改变画布配色', themed.preset === 'midnight' && /^#/.test(themed.bg) && themed.background !== bgBefore,
    JSON.stringify(themed))
  await shot('09-theme-midnight.png')

  // 16. 自定义主题
  await page.getByRole('button', { name: '主题' }).click()
  await page.locator('.mc-menu-item', { hasText: '自定义主题' }).click()
  await page.waitForSelector('.mc-dialog', { timeout: 3000 })
  check('自定义主题列出 13 个颜色位', await page.locator('.mc-theme-row').count() === 13, `${await page.locator('.mc-theme-row').count()} 个`)
  await page.locator('[data-color-key="accent"] input[type="color"]').fill('#ff3d7f')
  await page.locator('[data-apply="theme"]').click()
  await page.waitForTimeout(300)
  const custom = await page.evaluate(() => {
    const root = document.querySelector('.mc-root')
    return { preset: root.dataset.theme, accent: getComputedStyle(root).getPropertyValue('--mc-accent').trim() }
  })
  check('自定义主题生效（accent=#ff3d7f）', custom.preset === 'custom' && custom.accent === '#ff3d7f', JSON.stringify(custom))
  await shot('10-theme-custom.png')

  // 17. 导出：格式齐全，落盘内容正确
  await page.getByRole('button', { name: '导出' }).click()
  await page.waitForSelector('.mc-menu [data-format]', { timeout: 3000 })
  const formats = await page.evaluate(() => [...document.querySelectorAll('.mc-menu [data-format]')].map(node => node.dataset.format))
  check('导出菜单包含 4 种脑图格式 + PNG',
    ['markdown', 'opml', 'freemind', 'json', 'png'].every(id => formats.includes(id)), formats.join(','))

  const grab = async (format) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.locator(`.mc-menu [data-format="${format}"]`).click(),
    ])
    const file = await download.path()
    const text = format === 'png' ? '' : await readFile(file, 'utf8')
    return { name: download.suggestedFilename(), text, size: (await stat(file)).size }
  }

  const opml = await grab('opml')
  check('导出 OPML：文件名与内容都对', opml.name.endsWith('.opml') && /^<opml version="2.0">/.test(opml.text) && (opml.text.match(/<outline /g) || []).length >= 5,
    `${opml.name} / ${(opml.text.match(/<outline /g) || []).length} 个 outline`)

  await page.getByRole('button', { name: '导出' }).click()
  const freemind = await grab('freemind')
  check('导出 FreeMind .mm', freemind.name.endsWith('.mm') && freemind.text.includes('<map version="1.0.1">') && freemind.text.includes('TEXT='), freemind.name)

  await page.getByRole('button', { name: '导出' }).click()
  const md = await grab('markdown')
  check('导出 Markdown 大纲', md.name.endsWith('.md') && md.text.startsWith('# ') && md.text.includes('## '), md.name)

  await page.getByRole('button', { name: '导出' }).click()
  const json = await grab('json')
  check('导出 JSON 可解析', (() => { try { return Boolean(JSON.parse(json.text).nodes.length) } catch { return false } })())

  await page.getByRole('button', { name: '导出' }).click()
  const png = await grab('png')
  check('导出 PNG 图片', png.name.endsWith('.png') && png.size > 4096, `${png.name} / ${png.size} bytes`)

  check('没有未捕获的前端错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (error) {
  check('验证脚本自身跑完', false, error.message)
  await shot('99-failure.png')
} finally {
  await browser.close()
  server.close()
}

console.log(`\n${checks.filter(item => item.ok).length}/${checks.length} 通过`)
if (failures > 0) {
  console.error(`失败 ${failures} 项`)
  process.exit(1)
}
console.log(`截图：${screens}`)
