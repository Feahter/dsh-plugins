// 真宿主端到端：真 HTTP server + 真 ForgeEngine + 真 novelRecipe + 假 LLM + 真 client.js。
// 用 Playwright 走一遍「新建长篇 → 开始炼 → 运行中 → 完成 → 大纲 → 草稿」，
// 断言浏览器里能看到的东西，而不是直接读引擎。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import * as esbuild from 'esbuild'

import { ForgeEngine } from '../src/forge/index.js'
import { novelRecipe } from '../src/recipes/novel/index.js'
import { makeHandler, ROUTE_PREFIX } from '../src/host/routes.js'
import { createFakeLlm } from './e2e-fixtures.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SCREEN = path.join(ROOT, 'test/screens/e2e-workbench.png')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const failures = []
let checks = 0

function ok(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`)
    return true
  }
  failures.push(label)
  console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
  return false
}

function assert(label, condition, detail) {
  if (!ok(label, condition, detail)) throw new Error(`断言失败：${label}${detail ? ` (${detail})` : ''}`)
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  fs.createReadStream(filePath).pipe(res)
}

async function bundleHarness() {
  const result = await esbuild.build({
    entryPoints: [path.join(HERE, 'harness.mjs')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

async function findChromium() {
  try {
    const candidate = chromium.executablePath()
    if (candidate && fs.existsSync(candidate)) return candidate
  } catch {}
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  if (fs.existsSync(cache)) {
    for (const entry of fs.readdirSync(cache)) {
      if (!entry.startsWith('chromium')) continue
      const candidate = path.join(cache, entry, 'chrome-headless-shell-mac-x64/chrome-headless-shell')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return undefined
}

async function main() {
  fs.mkdirSync(path.dirname(SCREEN), { recursive: true })

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-forge-e2e-'))
  const llm = createFakeLlm({ delayMs: 4 })
  const engine = new ForgeEngine({ root, recipes: [novelRecipe], llm })
  const api = makeHandler({ engine, modelInfo: () => ({ provider: 'fake', model: 'fake' }), guard: () => null })
  const harnessJs = await bundleHarness()

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const pathname = decodeURIComponent(url.pathname)
      if (pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }
      if (pathname === ROUTE_PREFIX || pathname.startsWith(`${ROUTE_PREFIX}/`)) {
        await api(req, res)
        return
      }
      if (pathname === '/dev/harness.bundle.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        res.end(harnessJs)
        return
      }
      const filePath = path.resolve(ROOT, `.${pathname}`)
      if (!filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      serveFile(res, filePath)
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String(error?.stack ?? error))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  console.log(`真宿主服务已启动：${base}（DSH 根 ${root}）`)

  const browser = await chromium.launch({ executablePath: await findChromium() })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const consoleErrors = []
  const pageErrors = []
  const apiErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('response', async response => {
    if (!response.url().includes('/novel-forge/') || response.ok()) return
    const body = await response.text().catch(() => '')
    apiErrors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname} ${body}`)
  })

  let runId = null
  let projectId = null
  let released = false

  try {
    // 1. 页面与注册
    await page.goto(`${base}/dev/page.html`, { waitUntil: 'load' })
    await page.waitForFunction('window.__ready === true', null, { timeout: 20000 })

    const slots = await page.evaluate(() => window.__slots ?? [])
    const slotKeys = slots.map(slot => `${slot.name}:${slot.key}`)
    assert('侧栏/主面板注册成功', slotKeys.includes('main:novel-forge'), slotKeys.join(', '))
    assert('插件渲染出书架', await page.getByText('书架', { exact: true }).first().isVisible())

    // 2. 新建长篇
    await page.getByRole('button', { name: '新建长篇' }).click()
    await page.locator('textarea.nf-textarea-premise').waitFor({ state: 'visible', timeout: 10000 })
    await page.locator('textarea.nf-textarea-premise').fill(
      '殡仪馆夜班的新人发现，停尸柜里的亡者会在凌晨三点开口说话，而其中一个死者是他失踪多年的父亲。',
    )
    await page.locator('.nf-create-grid input.nf-input').first().fill('长夜将明')
    await page.locator('input[aria-label="章数"]').fill('6')
    await page.locator('input[aria-label="每章字数"]').fill('800')
    await page.getByRole('button', { name: '开始炼' }).click()

    // 3. 进入工作台，run 处于 running
    await page.locator('.nf-drawer').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForFunction(
      () => (document.querySelector('.nf-drawer')?.innerText ?? '').includes('运行中'),
      null,
      { timeout: 15000 },
    )

    const projects = await engine.listProjects()
    assert('UI 新建后引擎里有一个项目', projects.length === 1, `projects=${projects.length}`)
    projectId = projects[0]?.id
    runId = projects[0]?.activeRunId
    assert('项目带 activeRunId', Boolean(runId), String(runId))

    const running = await engine.getRun(runId)
    assert('引擎 run 状态为 running', running?.status === 'running', `status=${running?.status}`)
    const { events: runningEvents } = await engine.getRunEvents(runId, 0)
    assert(
      '事件流已有 run-start',
      runningEvents.some(event => event.type === 'run-start'),
      `events=${runningEvents.length}`,
    )
    ok('假 LLM 首枪挂起（UI 能观察到运行中）', llm.calls.length >= 1 && running?.status === 'running', `calls=${llm.calls.join(',') || '—'}`)

    // 4. 放行假 LLM，等待完成
    llm.release()
    released = true
    let final = null
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      final = await engine.getRun(runId)
      if (final && final.status !== 'running') break
      await sleep(100)
    }
    assert('引擎 run 最终 done', final?.status === 'done', `status=${final?.status}${final?.error ? ` error=${final.error}` : ''}`)
    const finishedProject = await engine.getProject(projectId)
    const doneStages = Object.values(finishedProject.stages ?? {}).filter(stage => stage.status === 'done').length
    assert('运行覆盖全部阶段', doneStages === 10, `doneStages=${doneStages}`)

    const { events } = await engine.getRunEvents(runId, 0)
    const runEnd = events.find(event => event.type === 'run-end')
    assert('事件流有 run-end(done)', runEnd?.data?.status === 'done', `run-end=${runEnd?.data?.status ?? 'missing'}`)
    assert(
      '六个章节正文都写入',
      events.filter(event => event.type === 'artifact' && event.data?.key?.startsWith('draft/')).length === 6,
      `draftArtifacts=${events.filter(event => event.type === 'artifact' && event.data?.key?.startsWith('draft/')).length}`,
    )

    // 5. UI 完成态。运行中的增量轮询可能在 run-end 落盘前就看到 done 并停表，
    //    所以先确认「已完成 / 24 / 24」，读完大纲与草稿后再回书架重开取全量事件。
    await page.waitForFunction(
      () => (document.querySelector('.nf-drawer')?.innerText ?? '').includes('已完成'),
      null,
      { timeout: 30000 },
    )
    const doneDrawer = await page.locator('.nf-drawer').innerText()
    assert('UI 进度不是 NaN', !doneDrawer.includes('NaN'), doneDrawer.split('\n').find(line => line.includes('/')) ?? '')
    assert('UI 显示 24/24 进度', /24\s*\/\s*24/.test(doneDrawer), doneDrawer.split('\n').find(line => line.includes('/')) ?? '')

    // 6. 卷章大纲：真数据经 API 进入 UI
    const outlineRail = page.locator('.nf-rail-item', { hasText: '卷章大纲' })
    await outlineRail.waitFor({ state: 'visible', timeout: 10000 })
    await outlineRail.click()
    await page.locator('.nf-chapter-row').first().waitFor({ state: 'visible', timeout: 20000 })
    const chapterCount = await page.locator('.nf-chapter-row').count()
    assert('UI 章节列表非空', chapterCount >= 6, `chapters=${chapterCount}`)
    const chapterTitle = (await page.locator('.nf-chapter-row').first().innerText()).replace(/\s+/g, ' ').trim()
    ok('章节行有标题与目标', chapterTitle.length > 0, chapterTitle)

    // 7. 打开第一章，读草稿
    await page.locator('.nf-chapter-row').first().click()
    await page.getByRole('tab', { name: '草稿' }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('tab', { name: '草稿' }).click()
    await page.locator('.nf-editor-bar').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForFunction(
      () => (document.querySelector('.nf-prose')?.innerText ?? '').includes('灵堂'),
      null,
      { timeout: 20000 },
    )
    const prose = await page.locator('.nf-prose').first().innerText()
    assert('草稿可读', prose.includes('灵堂') && prose.includes('名册'), `chars=${prose.length}`)
    assert('草稿包含章节标题前缀', prose.includes('第1章') || prose.includes('第 1 章'), prose.slice(0, 40).replace(/\n/g, ' '))

    // 8. 截图 + 控制台
    await page.screenshot({ path: SCREEN, fullPage: false })
    ok('截图已写入', fs.existsSync(SCREEN) && fs.statSync(SCREEN).size > 10000, path.relative(ROOT, SCREEN))

    // 9. 回书架重开：首屏 after=0 取全量事件，补上轮询可能漏掉的 run-end。
    await page.locator('.nf-main-top button', { hasText: '书架' }).click()
    const card = page.locator('.nf-card', { hasText: '长夜将明' })
    await card.waitFor({ state: 'visible', timeout: 10000 })
    await card.getByRole('button', { name: '打开' }).click()
    await page.locator('.nf-drawer').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForFunction(
      () => (document.querySelector('.nf-drawer')?.innerText ?? '').includes('收炉 · 全部完成'),
      null,
      { timeout: 20000 },
    )
    const drawerText = await page.locator('.nf-drawer').innerText()
    const overviewText = (await page.locator('.nf-main').innerText()).replace(/\s+/g, ' ')
    assert('总览已写章节为 6/6', /6\s*\/\s*6\s*章/.test(overviewText), overviewText.slice(0, 160))
    assert('总览正文字数非 0', !/正文\s*0\s*字/.test(overviewText), overviewText.slice(0, 160))
    assert('UI 事件流显示 run-end/完成', drawerText.includes('收炉 · 全部完成'))
    assert('重开后 UI 进度没有 NaN', !drawerText.includes('NaN'), drawerText.split('\n').find(line => line.includes('/')) ?? '')
    assert('引擎进度也不是 NaN', Number.isFinite(final?.progress?.done) && Number.isFinite(final?.progress?.total), `${final?.progress?.done}/${final?.progress?.total}`)

    assert('console error 为 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    assert('pageerror 为 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

    console.log(`\nrun ${runId} status=${final?.status} progress=${final?.progress?.done}/${final?.progress?.total} events=${events.length}`)
  } catch (error) {
    if (failures.length === 0) failures.push('未捕获异常')
    console.error(`\n端到端失败：${error?.stack ?? error}`)
    if (apiErrors.length) console.error(`API 错误：\n${apiErrors.join('\n')}`)
    if (consoleErrors.length) console.error(`console errors:\n${consoleErrors.join('\n')}`)
    if (pageErrors.length) console.error(`page errors:\n${pageErrors.join('\n')}`)
    try {
      await page.screenshot({ path: SCREEN, fullPage: false })
      console.error(`失败截图：${path.relative(ROOT, SCREEN)}`)
    } catch {}
  } finally {
    if (!released) llm.release()
    await browser.close().catch(() => {})
    server.close()
    await once(server, 'close').catch(() => {})
  }

  const passed = failures.length === 0
  console.log(`\n${passed ? '全部通过' : '失败'}：${checks - failures.length}/${checks} 条断言 ✓`)
  if (!passed) {
    console.log(`失败项：${failures.join('；')}`)
    process.exitCode = 1
  }
}

await main()
