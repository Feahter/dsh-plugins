// 生成 README 用的示意图（不是测试）：种一棵像样的树，按脚本摆好再截图。
// 用法：node dev/shots.mjs  → 输出 PNG 到 /tmp/mc-shots/（再转 webp 进 docs/）
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const outDir = '/tmp/mc-shots'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

const at = (minutes) => new Date(Date.UTC(2026, 2, 1, 9, minutes)).toISOString()
const node = (id, text, parentId, minute, tone) => ({
  id, text, parentId, x: 0, y: 0, tone, createdAt: at(minute),
})

const curated = {
  version: 1,
  revision: 1,
  activeId: 'd_demo',
  docs: [{
    id: 'd_demo',
    title: 'AI 工具怎么讲才不像广告',
    layout: 'tree-right',
    theme: { preset: 'auto' },
    view: null,
    createdAt: at(0),
    updatedAt: at(30),
    nodes: [
      node('n_root', 'AI 工具怎么讲才不像广告', null, 0, 'a'),
      node('n_1', '先讲一次真实翻车', 'n_root', 1, 'a'),
      node('n_2', '把参数翻译成人话', 'n_root', 2, 'a'),
      node('n_3', '给三个能立刻试的场景', 'n_root', 3, 'a'),
      node('n_4', '同一任务对比三家', 'n_root', 4, 'a'),
      node('n_1a', '翻车点：把演示当实测', 'n_1', 5, 'a'),
      node('n_2a', '一句话说清它解决什么', 'n_2', 6, 'a'),
      node('n_2b', '三个参数换成三个结果', 'n_2', 7, 'a'),
    ],
  }],
}

let saved = curated
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (status, payload) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(payload))
  }
  if (url.pathname === '/mind-canvas/state') {
    if (req.method === 'GET') return send(200, { state: saved })
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    saved = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return send(200, { ok: true })
  }
  if (url.pathname === '/mind-canvas/inspirations') return send(200, { items: [] })
  const rel = url.pathname === '/' ? '/dev/page.html' : url.pathname
  const file = join(root, normalize(rel).replace(/^\/+/, ''))
  if (!existsSync(file)) { res.statusCode = 404; res.end('x'); return }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.end(await readFile(file))
})

await mkdir(outDir, { recursive: true })
const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 })
await page.goto(`http://127.0.0.1:${port}/dev/page.html`)
await page.waitForSelector('.react-flow__node', { timeout: 8000 })
await page.waitForTimeout(600)
console.log('nodes:', await page.locator('.react-flow__node').count())
console.log('viewport before:', await page.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform))
await page.getByRole('button', { name: /向右长/ }).click()
await page.waitForTimeout(900)
console.log('viewport after:', await page.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform))
console.log('positions:', await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].slice(0, 3).map(n => n.style.transform)))
await page.mouse.move(20, 400)

await page.screenshot({ path: join(outDir, '01-overview.png') })

// 选中一个节点 + 打开色板
await page.locator('.react-flow__node').nth(2).click()
await page.getByRole('button', { name: '换颜色' }).click()
await page.waitForSelector('.mc-swatches')
await page.waitForTimeout(200)
await page.screenshot({ path: join(outDir, '02-colors.png') })
await page.keyboard.press('Escape')

// 导出菜单
await page.getByRole('button', { name: '导出' }).click()
await page.waitForSelector('.mc-menu [data-format]')
await page.waitForTimeout(200)
await page.screenshot({ path: join(outDir, '03-export.png') })
await page.keyboard.press('Escape')

// 主题菜单 + 切到深夜
await page.getByRole('button', { name: '主题' }).click()
await page.waitForSelector('.mc-menu [data-preset]')
await page.waitForTimeout(200)
await page.screenshot({ path: join(outDir, '04-themes.png') })
await page.locator('.mc-menu [data-preset="midnight"]').click()
await page.waitForTimeout(600)
await page.mouse.move(20, 400)
await page.screenshot({ path: join(outDir, '05-midnight.png') })

// 森林，用于对比图
await page.getByRole('button', { name: '主题' }).click()
await page.locator('.mc-menu [data-preset="forest"]').click()
await page.waitForTimeout(600)
await page.mouse.move(20, 400)
await page.screenshot({ path: join(outDir, '06-forest.png') })

await browser.close()
server.close()
console.log('shots →', outDir)
