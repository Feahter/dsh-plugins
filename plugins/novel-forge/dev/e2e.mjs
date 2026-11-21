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
import { STAGES } from '../client-src/strings.js'
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
  // activation：真宿主里由 DSH 注入。端到端只需要面板读到「工具闲置」，给个最小桩，
  // 否则 /novel-forge/tools 落到 404，浏览器控制台会多一条错误。
  const activation = {
    state: () => ({ active: [], latest: null }),
    enable: () => {},
    enableLatest: () => ({ ok: true }),
  }
  const openedDirs = []
  const api = makeHandler({
    engine,
    modelInfo: () => ({ provider: 'fake', model: 'fake' }),
    guard: () => null,
    activation,
    // 真宿主一定有版本自查；不给的话客户端拉 /version 会吃 503，浏览器控制台多一条错误。
    versionChecker: { check: async () => ({ current: '0.0.0', latest: '0.0.0', updateAvailable: false }) },
    // 真机会在访达里弹窗；端到端只记录路径，不真的调起系统文件管理器。
    openDirectory: async (directory) => { openedDirs.push(directory) },
  })
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
    // 抽屉一出现就断言「模型已经被调用」是竞态：startRun 先落项目/run，引擎随后
    // 才异步读产物、拼 prompt、发起第一枪。机器忙时 UI 会先看到运行中。
    // 等第一枪真的挂到闸门上再断言，避免把「还没轮到调模型」误报成失败。
    const firstCallDeadline = Date.now() + 15000
    while (llm.calls.length === 0 && Date.now() < firstCallDeadline) await sleep(20)
    const stillRunning = await engine.getRun(runId)
    ok(
      '假 LLM 首枪挂起（UI 能观察到运行中）',
      llm.calls.length >= 1 && stillRunning?.status === 'running',
      `calls=${llm.calls.join(',') || '—'}`,
    )

    // 4. 放行假 LLM，等待完成
    llm.release()
    released = true

    // 审稿门是默认行为：run 会在大纲、草稿后各停一次，必须点「继续」才往下走。
    // 早先这里直接等 done，门一上线 e2e 就永远停在 paused。
    const waitStatus = async (id, statuses, label, timeout = 90000) => {
      const deadline = Date.now() + timeout
      let current = null
      while (Date.now() < deadline) {
        current = await engine.getRun(id)
        if (current && statuses.includes(current.status)) return current
        await sleep(100)
      }
      assert(`${label}（超时）`, false, `status=${current?.status ?? 'missing'}`)
      return current
    }

    const gateStages = []
    let final = null
    for (let round = 0; round < 6; round += 1) {
      final = await waitStatus(runId, ['paused', 'done', 'failed', 'cancelled'], 'run 到达可观察状态')
      if (final.status !== 'paused') break
      const gated = await engine.getProject(projectId)
      gateStages.push(gated.pendingReview?.stage ?? 'unknown')
      const banner = page.locator('.nf-banner')
      await banner.waitFor({ state: 'visible', timeout: 20000 })
      await banner.getByRole('button', { name: '继续', exact: true }).click()
      // 继续会新建一个 run：后续轮询与事件都得换到这个 run 上。
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        const project = await engine.getProject(projectId)
        if (project.activeRunId && project.activeRunId !== runId) {
          runId = project.activeRunId
          break
        }
        await sleep(50)
      }
    }
    assert('审稿门依次停在大纲、草稿、审校、修订', gateStages.join(',') === 'outline,draft,review,revise', `gates=${gateStages.join(',') || '无'}`)
    assert('引擎 run 最终 done', final?.status === 'done', `status=${final?.status}${final?.error ? ` error=${final.error}` : ''}`)
    const finishedProject = await engine.getProject(projectId)
    const doneStages = Object.values(finishedProject.stages ?? {}).filter(stage => stage.status === 'done').length
    // 阶段数以 strings.js 的 STAGES 为准（曾硬编码 10，多算了一个已合并的阶段）。
    assert('运行覆盖全部阶段', doneStages === STAGES.length, `doneStages=${doneStages}/${STAGES.length}`)

    // 事件跨多个 run：审稿门前后的产物分别在各自的 run 里，汇总后再断言。
    const runSummaries = await engine.listRuns(projectId)
    const events = []
    for (const summary of runSummaries) {
      const { events: chunk } = await engine.getRunEvents(summary.id, 0)
      events.push(...chunk)
    }
    const runEnd = events.find(event => event.type === 'run-end' && event.data?.status === 'done')
    assert('事件流有 run-end(done)', Boolean(runEnd), `run-ends=${events.filter(event => event.type === 'run-end').map(event => event.data?.status).join(',') || '无'}`)
    // revise 会二次写 draft/*（同一 key，版本 +1），所以按「唯一 key」数，而不是事件条数。
    const draftKeys = new Set(
      events
        .filter(event => event.type === 'artifact' && event.data?.key?.startsWith('draft/'))
        .map(event => event.data.key),
    )
    assert('六个章节正文都写入', draftKeys.size === 6, `draftArtifacts=${draftKeys.size}`)

    // 5. UI 完成态。运行中的增量轮询可能在 run-end 落盘前就看到 done 并停表，
    //    所以先确认「已完成」，读完大纲与草稿后再回书架重开取全量事件。
    //    总数是各阶段 item 数之和（revise 会二次写 draft，所以比章节数多一轮）。
    await page.waitForFunction(
      () => (document.querySelector('.nf-drawer')?.innerText ?? '').includes('已完成'),
      null,
      { timeout: 30000 },
    )
    const doneDrawer = await page.locator('.nf-drawer').innerText()
    assert('UI 进度不是 NaN', !doneDrawer.includes('NaN'), doneDrawer.split('\n').find(line => line.includes('/')) ?? '')
    // 审稿门把全书切成多个 run，抽屉显示的是当前这一轮：只要本轮 done === total 就是跑完了。
    const expectedDone = final?.progress?.done
    const expectedTotal = final?.progress?.total
    assert(
      'UI 进度全部完成',
      Number.isFinite(expectedDone) && expectedDone === expectedTotal &&
        new RegExp(`${expectedDone}\\s*/\\s*${expectedTotal}`).test(doneDrawer),
      `${doneDrawer.split('\n').find(line => line.includes('/')) ?? ''}（期望 ${expectedDone}/${expectedTotal}）`,
    )

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
    // 8.5 书稿目录：卡片出现、点「打开目录」真的打到宿主
    const bookCard = page.locator('.nf-book')
    await bookCard.waitFor({ state: 'visible', timeout: 15000 })
    const bookCardText = (await bookCard.innerText()).replace(/\s+/g, ' ')
    ok('工作台显示书稿目录卡片', bookCardText.includes('书稿快照') && bookCardText.includes('/book'), bookCardText.slice(0, 80))
    await bookCard.getByRole('button', { name: '打开目录' }).click()
    await page.waitForFunction(
      () => (document.querySelector('.nf-toast')?.innerText ?? '').includes('文件管理器'),
      null,
      { timeout: 10000 },
    )
    assert('点「打开目录」请求到达宿主', openedDirs.length === 1 && openedDirs[0].endsWith('/book'), openedDirs.join(',') || '未调用')
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
