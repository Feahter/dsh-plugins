// Measure Markdown chapters against their own historical style. Node.js built-ins only.
// node scripts/style-baseline.mjs <file-or-directory...> --out baseline.json
// node scripts/style-baseline.mjs <file-or-directory...> --baseline baseline.json
// Directories are scanned recursively for .md files. Errors exit with code 2.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { styleVector } from '../src/recipes/novel/craft.js'

async function markdownFiles(input, files) {
  const path = resolve(input)
  const info = await stat(path)
  if (info.isFile() && extname(path) === '.md') {
    files.add(path)
  } else if (info.isDirectory()) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await markdownFiles(child, files)
      if (entry.isFile() && extname(child) === '.md') files.add(child)
    }
  } else {
    throw new Error(`需要 Markdown 文件或目录：${input}`)
  }
}

function distribution(vectors, key) {
  const mean = vectors.reduce((sum, vector) => sum + vector[key], 0) / vectors.length
  const sd = Math.sqrt(vectors.reduce((sum, vector) => sum + (vector[key] - mean) ** 2, 0) / vectors.length)
  return { mean, sd }
}

async function main() {
  const { positionals, values: { out, baseline } } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, baseline: { type: 'string' } },
  })
  if (!positionals.length || Boolean(out) === Boolean(baseline)) {
    throw new Error('用法：node scripts/style-baseline.mjs <文件或目录...> (--out | --baseline) baseline.json')
  }
  const inputs = new Set()
  for (const path of positionals) await markdownFiles(path, inputs)
  const paths = [...inputs].sort()
  if (!paths.length) throw new Error('未找到 .md 文件')
  const vectors = []
  for (const path of paths) vectors.push(styleVector(await readFile(path, 'utf8')))
  const keys = Object.keys(vectors[0])

  if (out) {
    if (inputs.has(resolve(out))) throw new Error('输出文件与 Markdown 输入重合')
    const metrics = Object.fromEntries(keys.map((key) => [key, distribution(vectors, key)]))
    const data = { generatedAt: new Date().toISOString(), files: paths.length, metrics }
    await writeFile(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    return
  }

  const data = JSON.parse(await readFile(baseline, 'utf8'))
  for (const key of keys) {
    const metric = data?.metrics?.[key]
    if (!Number.isFinite(metric?.mean) || !Number.isFinite(metric?.sd) || metric.sd < 0) {
      throw new Error(`baseline 缺少有效指标：${key}`)
    }
  }
  console.log('z 只用于查偏移，不作质量判决；同体裁同长度带内比较')
  for (const [i, path] of paths.entries()) {
    console.log(path)
    for (const key of keys) {
      const { mean, sd } = data.metrics[key]
      if (sd > 0) console.log(`  ${key} z=${((vectors[i][key] - mean) / sd).toFixed(3)}`)
    }
  }
}

try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}
