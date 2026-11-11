// 真宿主挂载检查：在临时 DSH_HOME 里建一个 web profile、link 本插件、
// 起真实的 `dsh web`，用 Playwright 打开侧栏，确认注册/面板/REST 都通。
// 这条检查抓到过假 harness 抓不到的两个 bug：侧栏 id 与 main key 不一致、recipes 对 Map 调 .map。
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const PLUGIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const HOME = os.homedir()

const findPnpm = async () => {
  const base = path.join(HOME, '.dsh', 'dsh-runtimes')
  const dirs = await fs.readdir(base).catch(() => [])
  for (const dir of dirs) {
    const candidate = path.join(base, dir, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
    try { await fs.access(candidate); return candidate } catch {}
  }
  throw new Error('找不到 pnpm.mjs')
}

const findChromium = async () => {
  const cache = path.join(HOME, 'Library', 'Caches', 'ms-playwright')
  const dirs = await fs.readdir(cache).catch(() => [])
  for (const dir of dirs.filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const candidate = path.join(cache, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell')
    try { await fs.access(candidate); return candidate } catch {}
  }
  return undefined
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-mount-'))
const profile = path.join(root, 'profiles', 'web')
let child
let browser

try {
  await fs.cp(path.join(HOME, '.dsh', 'profiles', 'web'), profile, { recursive: true })
  const pkgPath = path.join(profile, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  pkg.dependencies = { ...(pkg.dependencies || {}), 'dsh-novel-forge': `link:${PLUGIN}` }
  pkg.dsh.profile.bundles = [...pkg.dsh.profile.bundles, 'dsh-novel-forge']
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))

  const pnpm = await findPnpm()
  await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [pnpm, 'install', '--prefer-offline'], { cwd: profile, stdio: 'inherit' })
    proc.on('exit', code => (code === 0 ? resolve() : reject(new Error(`pnpm install exit ${code}`))))
  })

  const env = { ...process.env, DSH_HOME: root }
  child = spawn('dsh', ['--profile', 'web', '--port', '0', '--no-open'], { env, detached: true })
  let log = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dsh web 启动超时：${log.slice(-500)}`)), 90_000)
    const onData = chunk => {
      log += chunk.toString()
      const hit = log.match(/dsh web: (http:\/\/\S+)/)
      if (hit) { clearTimeout(timer); resolve(hit[1]) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`dsh web 提前退出 ${code}：${log.slice(-500)}`)) })
  })

  browser = await chromium.launch({ executablePath: await findChromium() })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(`PAGEERROR ${error.message}`))

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(2500)
  // 默认 web profile 是英文，新手说明的按钮可能是 Continue。
  const cont = page.locator('button, [role="button"]').filter({ hasText: /^(继续|Continue)$/ }).first()
  if (await cont.count()) await cont.click().catch(() => {})
  await page.waitForTimeout(800)
  // 预览说明的遮罩在 headless 下有时不随弹层一起消失，会拦住侧栏点击。
  await page.evaluate(() => document.querySelectorAll('[class*="_mask_"]').forEach(el => el.remove()))

  const nav = page.locator('span[class*="panelTitle"]', { hasText: '墨炉' }).first()
  if (!(await nav.count())) throw new Error('侧栏没有出现「墨炉」')
  const navButton = page.locator('button', { hasText: /^墨炉/ }).first()
  if (await navButton.count()) await navButton.dispatchEvent('click')
  else await nav.dispatchEvent('click')
  await page.waitForTimeout(3000)

  // 新 profile 没有凭据，会弹「Get started」登录层；Esc 关掉再截图。
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)
  const body = await page.locator('body').innerText()
  if (!body.includes('书架')) {
    await page.screenshot({ path: path.join(PLUGIN, 'test', 'screens', 'mount-check-fail.png') })
    throw new Error(`面板没有渲染书架；body=${body.replace(/\n+/g, ' | ').slice(0, 500)}`)
  }
  const recipes = await page.evaluate(async () => {
    const response = await fetch('/novel-forge/recipes')
    return { status: response.status, body: await response.text() }
  })
  if (recipes.status !== 200) throw new Error(`GET /recipes ${recipes.status}: ${recipes.body.slice(0, 200)}`)

  await page.screenshot({ path: path.join(PLUGIN, 'test', 'screens', 'mount-check.png') })
  if (errors.length) throw new Error(`console/page error: ${errors.slice(0, 3).join(' | ')}`)
  console.log('✓ 真宿主：侧栏「墨炉」出现，面板渲染书架，/novel-forge/recipes 200，console error 0')
} finally {
  await browser?.close().catch(() => {})
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch {} }
  }
  await fs.rm(root, { recursive: true, force: true })
}
