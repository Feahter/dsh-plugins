#!/usr/bin/env node
// 把 ESM/JSX 源码打包成 DSH 客户端半片：
//   window.__ModuleLoader__.load({ id, factory(require) { <CJS bundle>; return module.exports } })
// react / react-dom 留在 external，由宿主的 seed 模块表提供。
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { argv } from 'node:process'

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const dev = argv.includes('--dev')
const outfile = new URL('./client.js', import.meta.url)

const result = await build({
  entryPoints: [new URL('./client-src/index.jsx', import.meta.url).pathname],
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
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  logLevel: 'warning',
})

const code = result.outputFiles[0].text
const banner = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},\n  factory(require) {\n    var module = { exports: {} };\n    var exports = module.exports;\n`
const footer = `\n    return module.exports;\n  },\n});\n`

await writeFile(outfile, banner + code + footer)
const bytes = Buffer.byteLength(banner + code + footer)
console.log(`built ${pkg.name} client.js — ${(bytes / 1024).toFixed(1)} KB${dev ? ' (dev)' : ''}`)
