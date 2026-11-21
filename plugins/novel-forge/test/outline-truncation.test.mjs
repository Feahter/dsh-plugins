import assert from 'node:assert/strict'
import test from 'node:test'
import { ForgeError } from '../src/forge/errors.js'
import { ensureVolume, prepareChapter } from '../src/recipes/novel/chapter.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { buildOutlineSkeleton, mergeVolumeChapters } from '../src/recipes/novel/plan.js'
import { createFakeCtx, createScriptedPrompts, sampleSpine } from './fixtures/novel-fixtures.mjs'

const params = { chapters: 300, chaptersPerVolume: 50, language: 'zh' }

function chapterNumbers(start, end) {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
}

function requestRange(user) {
  const match = user.match(/【本批章号】第 (\d+)–(\d+) 章/)
  assert.ok(match, 'prompt 包含实际请求区间')
  return match.slice(1).map(Number)
}

function rowsFor(start, end) {
  return chapterNumbers(start, end).map((index) => ({ title: `章${index}`, goal: `目标${index}` }))
}

function generateVolume(generate, volume = 'v01') {
  const outline = buildOutlineSkeleton(params)
  return ensureVolume({ outline, params, read: () => null, llm: { generate } }, { volume })
}

function assertFullVolume(result, start, volume) {
  const expected = chapterNumbers(start, start + 49)
  assert.equal(result.created, true)
  assert.equal(result.outline.volumes.find((item) => item.id === volume).planned, true)
  assert.deepEqual(result.outline.chapters.map((row) => row.index), expected)
  assert.deepEqual(result.outline.chapters.map((row) => row.id), expected.map((n) => `ch${String(n).padStart(3, '0')}`))
  assert.deepEqual(result.outline.chapters.map((row) => row.title), expected.map((n) => `章${n}`))
}

test('R1 卷纲按连续区间请求，每批最多 12 章，定点展开 50 章', async () => {
  const requests = []
  const result = await generateVolume(async ({ user }) => {
    requests.push(user)
    return { json: { chapters: rowsFor(...requestRange(user)) } }
  }, 'v02')
  const ranges = requests.map(requestRange)
  assert.ok(ranges.every(([start, end]) => end >= start && end - start + 1 <= 12))
  assert.deepEqual(ranges.flatMap(([start, end]) => chapterNumbers(start, end)), chapterNumbers(51, 100))
  assert.equal(result.calls, requests.length)
  assert.equal(result.outline.volumes[0].planned, false)
  assertFullVolume(result, 51, 'v02')
})

function truncated(text) {
  return new ForgeError('LLM_TRUNCATED', '模型输出被截断', { text, maxTokens: 16000 })
}

const partialRows = JSON.stringify(rowsFor(1, 5).map((row) => ({
  ...row,
  hook: '括号 } ] 和转义 " \\ 仍属于字符串',
  payoff: { level: 'small', text: '嵌套字段' },
}))).slice(0, -1)

for (const [format, partial] of [
  ['围栏对象', `\`\`\`json\n{"chapters":${partialRows},{"title":"半章","payoff":{"title":"嵌套值"}`],
  ['根数组', `${partialRows},{"title":"半章`],
  ['引导语加围栏', `好的，以下是本批章表：\n\`\`\`json\n{"chapters":${partialRows},{"title":"半章","payoff":{"title":"嵌套值"}`],
]) {
  test(`R2 从${format}截断中保留五章，只请求缺失章号`, async () => {
    const requests = []
    const result = await generateVolume(async ({ user }) => {
      requests.push(user)
      if (requests.length === 1) throw truncated(partial)
      return { json: { chapters: rowsFor(...requestRange(user)) } }
    })
    assert.match(requests[1], /从第 6 章继续，不要重复已有章/)
    assert.deepEqual(requests.map(requestRange), [[1, 12], [6, 12], [13, 24], [25, 36], [37, 48], [49, 50]])
    assert.equal(result.calls, requests.length)
    assert.equal(result.outline.chapters[4].payoff.text, '嵌套字段')
    assertFullVolume(result, 1, 'v01')
  })
}

test('R2 空截断继续抛 LLM_TRUNCATED，且只调用一次', async () => {
  let calls = 0
  await assert.rejects(generateVolume(async () => {
    assert.ok(++calls <= Math.ceil(50 / 12) + 2)
    throw truncated('')
  }), { code: 'LLM_TRUNCATED' })
  assert.equal(calls, 1)
})

test('R3 截断保留错误详情并点名实际失败的卷和第三批', async () => {
  const partial = '{"chapters":[{"title":"还没写完'
  let calls = 0
  await assert.rejects(generateVolume(async ({ user }) => {
    if (++calls === 3) throw truncated(partial)
    return { json: { chapters: rowsFor(...requestRange(user)) } }
  }, 'v02'), (error) => {
    assert.ok(error instanceof ForgeError)
    assert.equal(error.code, 'LLM_TRUNCATED')
    assert.match(error.message, /第 v02 卷（51–100 章）第 3 批（75–86 章）/)
    assert.equal(error.detail.text, partial)
    assert.equal(error.detail.maxTokens, 16000)
    return true
  })
  assert.equal(calls, 3)
})

for (const secondCut of [false, true]) {
  test(`R4 spine 截断只补救一次${secondCut ? '，再次截断保留原错' : '，成功时返回数据'}`, async () => {
    const maxTokens = secondCut ? 12000 : 6000
    const prompts = createScriptedPrompts({ spine: { maxTokens } })
    const spine = createNovelRecipe({ prompts }).stages.find((stage) => stage.id === 'spine')
    const ctx = createFakeCtx()
    const partial = '{"volumes":[{"title":"断点'
    const original = truncated(partial)
    const calls = []
    ctx.llm = { async generate(spec) {
      calls.push(spec)
      assert.ok(calls.length <= 2)
      if (calls.length === 1) throw original
      if (secondCut) throw truncated('{"volumes":[')
      return { json: sampleSpine(1) }
    } }
    if (secondCut) {
      await assert.rejects(spine.run(ctx), (error) => error === original && error.code === 'LLM_TRUNCATED')
    } else {
      const result = await spine.run(ctx)
      assert.equal(result.artifacts.spine.content.volumes.length, 1)
    }
    assert.equal(calls.length, 2)
    assert.match(calls[1].user, /上一次输出没能解析成 JSON.*断点/)
    assert.equal(calls[0].maxTokens, maxTokens)
    assert.equal(calls[1].maxTokens, 16000)
  })
}

test('R4 prepareChapter 的 beats 调用也补救一次并累加调用数', async () => {
  const outline = mergeVolumeChapters(buildOutlineSkeleton({ chapters: 3 }), 'v01', rowsFor(1, 3))
  const calls = []
  const result = await prepareChapter({
    outline, chapterId: outline.chapters[0].id, read: () => null,
    llm: { async generate(spec) {
      calls.push(spec)
      if (calls.length === 1) throw truncated('{"scenes":[{')
      return { json: { scenes: [{ goal: '找到线索' }] } }
    } },
  })
  assert.deepEqual(calls.map((spec) => spec.phase), ['beats', 'beats'])
  assert.match(calls[1].user, /上一次输出没能解析成 JSON/)
  assert.equal(result.beats.scenes[0].goal, '找到线索')
  assert.equal(result.calls, 2)
})
