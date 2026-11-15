// 一次性复现：在「顶栏 56px + 主容器」的宿主布局里，看 .nf-root 是否溢出视口、
// 新建页的表单能不能滚到底、提交按钮在不在可点区域。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { chromium } from 'playwright'

const chromiumPath = async () => {
  try { const { access } = await import('node:fs/promises'); await access(chromium.executablePath()); return undefined } catch {}
  const cache = path.join(os.homedir(), 'Library/Caches', 'ms-playwright')
  const dirs = fs.readdirSync(cache).filter(n => n.startsWith('chromium_headless_shell-')).sort().reverse()
  for (const dir of dirs) {
    const candidate = path.join(cache, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell')
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

const ROOT = '/Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/novel-forge'
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const file = path.join(ROOT, decodeURIComponent(url.pathname))
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nope'); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ executablePath: await chromiumPath() })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', error => errors.push(String(error)))
await page.goto(`${base}/dev/${process.env.NF_PAGE || 'page-host.html'}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__ready === true)

const report = async label => page.evaluate(label => {
  const root = document.querySelector('.nf-root')
  const scroller = document.querySelector('.nf-scroll')
  const rect = root.getBoundingClientRect()
  return {
    label,
    viewport: { w: innerWidth, h: innerHeight },
    rootRect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) },
    rootStyleHeight: root.style.height || '(auto)',
    scroller: scroller ? {
      clientH: scroller.clientHeight,
      scrollH: scroller.scrollHeight,
      canScroll: scroller.scrollHeight > scroller.clientHeight + 1,
      overflowY: getComputedStyle(scroller).overflowY,
    } : null,
  }
}, label)

console.log(JSON.stringify(await report('书架'), null, 2))

// 进「新建长篇」
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')]
  const target = buttons.find(b => /新建/.test(b.textContent || ''))
  target?.click()
})
await page.waitForTimeout(400)

const text = await page.locator('.nf-create').innerText()
console.log('CREATE TEXT >>>', text.slice(0, 400))
console.log('BUTTONS >>>', await page.locator('.nf-create button').allInnerTexts())
const before = await report('新建页')
console.log(JSON.stringify(before, null, 2))

// 滚到最底，看提交按钮是否进入可点区域
const submitInfo = await page.evaluate(() => {
  const scroller = document.querySelector('.nf-scroll')
  scroller.scrollTop = scroller.scrollHeight
  const buttons = [...document.querySelectorAll('button')]
  const submit = buttons.find(b => /开炉|开始炼|创建/.test(b.textContent || ''))
  if (!submit) return { found: false }
  const r = submit.getBoundingClientRect()
  return {
    found: true,
    text: (submit.textContent || '').trim(),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    inViewport: r.top >= 0 && r.bottom <= innerHeight,
    scrolledTo: Math.round(scroller.scrollTop),
  }
})
console.log(JSON.stringify({ submitAfterScroll: submitInfo, errors }, null, 2))

await browser.close()
server.close()
