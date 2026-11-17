#!/usr/bin/env node
// 把 ESM/JSX 源码打包成两个 DSH 客户端资源：
//   client.js       —— 首屏注册侧栏/主面板（小），只含图标、语言包和惰性加载器。
//   client.panel.js —— 面板本体（大，编辑器/工作台/导出），首次打开面板时才由
//                      client.js 用 require.async 动态加载。
// react / react-dom 留在 external，由宿主（或 dev/harness）的 seed 模块表提供；
// marked / dompurify 这类纯浏览器库打进面板 chunk。
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { argv } from 'node:process'

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const dev = argv.includes('--dev')
const outfile = new URL('./client.js', import.meta.url)
const chunkFile = 'client.panel.js'
const chunkOutfile = new URL(`./${chunkFile}`, import.meta.url)

const options = {
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  jsx: 'automatic',
  loader: { '.css': 'text' },
  minify: !dev,
  sourcemap: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    // 宿主工厂的参数名就是 require；用它拿 require.async 加载 package-local chunk。
    __DSH_REQUIRE__: '__dshRequire',
  },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  logLevel: 'warning',
}

const entryResult = await build({
  ...options,
  entryPoints: [new URL('./client-src/index.jsx', import.meta.url).pathname],
})
const chunkResult = await build({
  ...options,
  entryPoints: [new URL('./client-src/panel.jsx', import.meta.url).pathname],
})

const wrap = (code, header) => {
  const banner = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},${header}\n  factory(require) {\n    var __dshRequire = require;\n    var module = { exports: {} };\n    var exports = module.exports;\n`
  const footer = `\n    return module.exports;\n  },\n});\n`
  return banner + code + footer
}

const entryCode = wrap(entryResult.outputFiles[0].text, '')
const chunkCode = wrap(chunkResult.outputFiles[0].text, `\n  chunk: ${JSON.stringify(chunkFile)},`)

await writeFile(outfile, entryCode)
await writeFile(chunkOutfile, chunkCode)
const entryBytes = Buffer.byteLength(entryCode)
const chunkBytes = Buffer.byteLength(chunkCode)
console.log(`built ${pkg.name} client.js — ${(entryBytes / 1024).toFixed(1)} KB + lazy ${chunkFile} — ${(chunkBytes / 1024).toFixed(1)} KB${dev ? ' (dev)' : ''}`)
