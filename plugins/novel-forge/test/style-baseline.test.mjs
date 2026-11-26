import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { styleVector } from '../src/recipes/novel/craft.js'

const script = fileURLToPath(new URL('../scripts/style-baseline.mjs', import.meta.url))
const run = (...args) => promisify(execFile)(process.execPath, [script, ...args])
const keys = ['nominalPer1k', 'aiMarkerPer1k', 'avgSentenceLen', 'sentenceCv', 'sentenceDiff', 'emptyVerbPer1k', 'hedgePer1k', 'concretePer1k', 'dePer100', 'beiPer100', 'cjk']

test('styleVector：字段齐全、有限，空文本全 0', () => {
  const vector = styleVector('空气仿佛凝固。或许有人在进行研究；“等 5 年。”')
  assert.deepEqual(Object.keys(vector).sort(), [...keys].sort())
  assert.ok(Object.values(vector).every(Number.isFinite))
  assert.ok(vector.aiMarkerPer1k > 0 && vector.emptyVerbPer1k > 0 && vector.hedgePer1k > 0)
  assert.ok(vector.concretePer1k > 0 && vector.sentenceDiff > 0)
  assert.deepEqual(styleVector(' \n'), Object.fromEntries(keys.map((key) => [key, 0])))
  const lengths = styleVector('甲；乙丙丁。')
  assert.equal(lengths.avgSentenceLen, 2)
  assert.equal(lengths.sentenceCv, 0.5)
  assert.equal(lengths.sentenceDiff, 1)
})

test('CLI：按篇生成 baseline，逐篇输出 z 并跳过 sd=0 的指标', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'novel-style-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const nested = join(dir, 'nested')
  const first = join(dir, 'first.md')
  const second = join(nested, 'second.md')
  const baseline = join(dir, 'baseline.json')
  await mkdir(nested)
  await writeFile(first, '天亮。')
  await writeFile(second, '火车开走。')
  await writeFile(join(dir, 'ignored.txt'), '这行不应进入样本。')
  await run(dir, first, '--out', baseline)
  const data = JSON.parse(await readFile(baseline, 'utf8'))
  assert.equal(data.files, 2)
  assert.ok(Number.isFinite(Date.parse(data.generatedAt)))
  assert.deepEqual(data.metrics.cjk, { mean: 3, sd: 1 })
  assert.deepEqual(data.metrics.hedgePer1k, { mean: 0, sd: 0 })
  const { stdout } = await run(first, second, '--baseline', baseline)
  assert.match(stdout, /z 只用于查偏移，不作质量判决；同体裁同长度带内比较/)
  assert.match(stdout, /cjk z=-1\.000/)
  assert.match(stdout, /cjk z=1\.000/)
  assert.doesNotMatch(stdout, /hedgePer1k z=/)
  await assert.rejects(run(join(dir, 'missing.md'), '--out', baseline), { code: 2 })
  await assert.rejects(run(first, '--baseline', join(dir, 'missing.json')), { code: 2 })
})

test('CLI：缺参数时退出 2', async () => {
  await assert.rejects(run(), { code: 2 })
})
