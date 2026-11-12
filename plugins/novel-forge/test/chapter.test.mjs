// chapter.test.mjs — 单章工作单元（§6）：审阅 / 卷纲 / 材料包 / 提交 / 检查。
// 运行：node --test test/chapter.test.mjs
// 全部用内存 fake read/llm，不联网、不碰磁盘。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  inspectChapter,
  ensureVolume,
  prepareChapter,
  commitChapter,
  checkChapter,
  splitInline,
} from '../src/recipes/novel/chapter.js'
import { buildOutlineSkeleton, mergeVolumeChapters } from '../src/recipes/novel/plan.js'
import { emptyCanon, mergeCanon, canonStats } from '../src/recipes/novel/canon.js'

const PARAMS = {
  wordsPerChapter: 220,
  pov: '第三人称限知',
  contextBudget: 6000,
  language: 'zh',
}

/** 15 段、约 200 字、对话占比约 9.5%，在 craft 的干净区间内。 */
function cleanProse() {
  return [
    '雨停的时候，巷口的灯刚亮。',
    '「你来晚了。」陈婆把门推开一条缝。',
    '他侧身挤进去，闻到很重的香灰味。',
    '堂屋正中摆着一张旧桌。',
    '桌上压着一本没有封皮的账册。',
    '「别碰。」陈婆的声音从背后追上来。',
    '他停住手，指尖离纸页只差一寸。',
    '纸页边缘有烧过的痕迹。',
    '窗外有人拖着铁链走过。',
    '陈婆忽然压低嗓子说：「今晚别住西厢。」',
    '「为什么？」他问。',
    '西厢的门在风里轻轻响了一声。',
    '「我记住了。」他说。',
    '灯芯爆了一下，屋里暗了半寸。',
    '账册自己翻到了最后一页。',
  ].join('\n\n')
}

function rowsFor(count, prefix = '章') {
  return Array.from({ length: count }, (_, i) => ({
    title: `${prefix}${i + 1}`,
    goal: `目标${i + 1}`,
    conflict: `阻碍${i + 1}`,
    turn: `转折${i + 1}`,
    hook: `钩子${i + 1}`,
    pov: '第三人称限知',
    when: `第${i + 1}天`,
    where: '殡仪馆',
    cast: [],
  }))
}

/** 所有卷都已展开的 v2 大纲。 */
function plannedOutline({ chapters = 6, per = 6 } = {}) {
  const base = buildOutlineSkeleton({ chapters, chaptersPerVolume: per, language: 'zh' })
  const volumeIds = (base.volumes ?? []).map((volume) => volume.id)
  let outline = base
  for (const id of volumeIds) {
    const volume = outline.volumes.find((item) => item.id === id)
    outline = mergeVolumeChapters(outline, id, rowsFor(Number(volume?.targetChapters) || per))
  }
  return outline
}

function memoryRead(entries = {}) {
  return (key) => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null)
}

function fakeLlm(handler) {
  const calls = []
  return {
    calls,
    async generate(spec) {
      calls.push(spec)
      return handler(spec, calls.length - 1)
    },
  }
}

/** 带足够多事实的 canon，用来验证 packet 的预算裁剪。 */
function fatCanon(facts = 60) {
  return mergeCanon(
    emptyCanon(),
    {
      facts: Array.from({ length: facts }, (_, i) => ({
        s: `人物${i}`,
        p: '位置',
        o: `地点${i}的详细描述`,
        chapter: 'ch01',
      })),
    },
    { chapter: 'ch01' },
  )
}

const fakePrompts = {
  volumeChapters: (ctx) => ({
    system: 'fake-volume',
    user: `VOLUME_PROMPT count=${ctx.volume.targetChapters}`,
    maxTokens: 2000,
    temperature: 0.6,
  }),
  beats: (ctx) => ({
    system: 'fake-beats',
    user: `BEATS_PROMPT ${ctx.chapter.id}`,
    maxTokens: 1800,
    temperature: 0.8,
  }),
}

const beatsPayload = {
  scenes: [
    { goal: '进殡仪馆', obstacle: '陈婆拦门', turn: '账本空白', detail: '香灰落在纸页上' },
  ],
  hook: '最后一页写着一个名字',
  cast: [],
}

// ---------------------------------------------------------------- splitInline

test('splitInline：正常拆出正文、摘要与对象补丁', () => {
  const text = `${cleanProse()}\n\n<<<SUMMARY>>>\n他进了殡仪馆，陈婆警告他别住西厢。\n<<<CANON>>>\n{"facts":[{"s":"林砚","p":"位置","o":"殡仪馆"}]}`
  const split = splitInline(text)
  assert.equal(split.body, cleanProse())
  assert.equal(split.summary, '他进了殡仪馆，陈婆警告他别住西厢。')
  assert.equal(split.canonPatch.facts[0].s, '林砚')
  assert.equal(split.hadSummary, true)
  assert.equal(split.hadCanon, true)
  assert.equal(split.parseError, null)
})

test('splitInline：缺 SUMMARY 时正文和 CANON 都保留', () => {
  const split = splitInline(`${cleanProse()}\n<<<CANON>>>\n{"facts":[]}`)
  assert.equal(split.body, cleanProse())
  assert.equal(split.summary, null)
  assert.equal(split.hadSummary, false)
  assert.equal(split.hadCanon, true)
  assert.deepEqual(split.canonPatch, { facts: [] })
})

test('splitInline：缺 CANON 只取摘要', () => {
  const split = splitInline(`正文第一段。\n\n<<<SUMMARY>>>\n他知道了账本是空的。`)
  assert.equal(split.body, '正文第一段。')
  assert.equal(split.summary, '他知道了账本是空的。')
  assert.equal(split.hadCanon, false)
  assert.equal(split.canonPatch, null)
  assert.equal(split.parseError, null)
})

test('splitInline：CANON 坏 JSON 不抛错、不丢正文', () => {
  const body = cleanProse()
  const split = splitInline(`${body}\n<<<SUMMARY>>>\n摘要写在这里。\n<<<CANON>>>\n{这不是 JSON`)
  assert.equal(split.body, body)
  assert.equal(split.summary, '摘要写在这里。')
  assert.equal(split.canonPatch, null)
  assert.match(split.parseError, /JSON/)
})

test('splitInline：CANON 是数组时按 facts 处理', () => {
  const split = splitInline(`正文。\n<<<CANON>>>\n[{"s":"陈婆","p":"知道","o":"账本在殡仪馆"}]`)
  assert.deepEqual(split.canonPatch, { facts: [{ s: '陈婆', p: '知道', o: '账本在殡仪馆' }] })
})

test('splitInline：正文行内出现字面 <<<SUMMARY>>> 不算分隔符', () => {
  const body = '他盯着纸页，慢慢写下那三个符号：<<<SUMMARY>>> 在句中。\n\n然后他把笔放下了。'
  const split = splitInline(`${body}\n\n<<<SUMMARY>>>\n他认出了纸页上的三个符号。`)
  assert.equal(split.body, body)
  assert.equal(split.summary, '他认出了纸页上的三个符号。')
  assert.equal(split.hadSummary, true)
  assert.equal(split.hadCanon, false)
  assert.equal(split.parseError, null)
})

test('splitInline：没有尾块时原样返回正文', () => {
  const split = splitInline(cleanProse())
  assert.equal(split.body, cleanProse())
  assert.equal(split.summary, null)
  assert.equal(split.canonPatch, null)
  assert.equal(split.hadSummary, false)
  assert.equal(split.hadCanon, false)
})

// ---------------------------------------------------------------- inspectChapter

test('inspectChapter：卷纲未规划 → missing 含 volume-plan', () => {
  const outline = structuredClone(plannedOutline())
  outline.volumes[0].planned = false
  const info = inspectChapter({
    outline,
    chapterId: 'ch01',
    read: memoryRead({ canon: emptyCanon(), 'draft/ch01': cleanProse(), 'beats/ch01': beatsPayload }),
  })
  assert.equal(info.found, true)
  assert.equal(info.ready, false)
  assert.deepEqual(info.missing, ['volume-plan'])
})

test('inspectChapter：缺细纲 → missing 含 beats', () => {
  const info = inspectChapter({
    outline: plannedOutline(),
    chapterId: 'ch01',
    read: memoryRead({ canon: emptyCanon(), 'draft/ch01': cleanProse() }),
  })
  assert.deepEqual(info.missing, ['beats'])
})

test('inspectChapter：缺正文（含占位符）→ missing 含 draft', () => {
  const read = memoryRead({
    canon: emptyCanon(),
    'beats/ch01': beatsPayload,
    'draft/ch01': '正文缺失',
  })
  const info = inspectChapter({ outline: plannedOutline(), chapterId: 'ch01', read })
  assert.deepEqual(info.missing, ['draft'])
})

test('inspectChapter：缺 canon 且无旧 ledger → missing 含 canon', () => {
  const info = inspectChapter({
    outline: plannedOutline(),
    chapterId: 'ch01',
    read: memoryRead({ 'beats/ch01': beatsPayload, 'draft/ch01': cleanProse() }),
  })
  assert.deepEqual(info.missing, ['canon'])
})

test('inspectChapter：材料齐 → ready，且能定位卷', () => {
  const info = inspectChapter({
    outline: plannedOutline(),
    chapterId: 'ch02',
    read: memoryRead({ canon: emptyCanon(), 'beats/ch02': beatsPayload, 'draft/ch02': cleanProse() }),
  })
  assert.equal(info.ready, true)
  assert.deepEqual(info.missing, [])
  assert.equal(info.volume.id, 'v01')
  assert.equal(info.chapter.id, 'ch02')
})

test('inspectChapter：章不存在 → found:false 且不报缺件', () => {
  const info = inspectChapter({ outline: plannedOutline(), chapterId: 'ch99', read: memoryRead({}) })
  assert.equal(info.found, false)
  assert.equal(info.chapter, null)
  assert.deepEqual(info.missing, [])
})

// ---------------------------------------------------------------- ensureVolume

test('ensureVolume：展开第一条 planned:false 的卷，1 次模型调用', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm(() => ({ text: JSON.stringify({ chapters: rowsFor(6) }) }))
  const result = await ensureVolume({
    outline,
    params: PARAMS,
    read: memoryRead({}),
    llm,
    language: 'zh',
  }, { prompts: fakePrompts })

  assert.equal(result.calls, 1)
  assert.equal(result.created, true)
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].json, true)
  assert.match(llm.calls[0].user, /VOLUME_PROMPT count=6/)
  assert.equal(result.outline.chapters.length, 6)
  assert.equal(result.outline.volumes[0].planned, true)
  assert.equal(result.outline.volumes[0].targetChapters, 6)
  assert.deepEqual(result.outline.chapters.map((chapter) => chapter.id), ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'])
  assert.equal(result.outline.chapters[0].title, '章1')
})

test('ensureVolume：同卷第二次调用不再请求模型（幂等）', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm(() => ({ text: JSON.stringify({ chapters: rowsFor(6) }) }))
  const first = await ensureVolume({ outline, params: PARAMS, read: memoryRead({}), llm }, { prompts: fakePrompts })
  const second = await ensureVolume({ outline: first.outline, params: PARAMS, read: memoryRead({}), llm }, { prompts: fakePrompts })

  assert.equal(second.created, false)
  assert.equal(second.calls, 0)
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(second.outline, first.outline)
})

test('ensureVolume：所有卷都已规划 → 0 次调用', async () => {
  const outline = plannedOutline()
  const llm = fakeLlm(() => ({ text: '{}' }))
  const result = await ensureVolume({ outline, params: PARAMS, read: memoryRead({}), llm })
  assert.equal(result.calls, 0)
  assert.equal(result.created, false)
  assert.equal(llm.calls.length, 0)
})

test('ensureVolume：没有 prompts.volumeChapters 时走内置兜底 prompt', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm(() => ({ text: JSON.stringify({ chapters: rowsFor(6) }) }))
  const result = await ensureVolume({
    outline,
    params: PARAMS,
    read: memoryRead({ spine: '第一卷：入殓。第二卷：出殡。' }),
    llm,
    language: 'zh',
  }, { prompts: { volumeChapters: undefined } })
  assert.equal(result.calls, 1)
  assert.equal(llm.calls.length, 1)
  assert.match(llm.calls[0].user, /第 1 卷/)
  assert.match(llm.calls[0].user, /要求：chapters 恰好 6 条/)
  assert.ok(llm.calls[0].user.length <= 9000)
  assert.equal(result.outline.chapters.length, 6)
})

test('ensureVolume：默认 createPrompts 的 volumeChapters（L6）可直接用', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm(() => ({ text: '```json\n' + JSON.stringify({ chapters: rowsFor(6) }) + '\n```' }))
  const result = await ensureVolume({
    outline,
    params: PARAMS,
    read: memoryRead({ spine: { volumes: [{ index: 1, title: '入殓', goal: '查清死因' }] }, bible: '规矩：夜里不点灯。' }),
    llm,
    language: 'zh',
  })
  assert.equal(result.calls, 1)
  assert.match(llm.calls[0].user, /chapters 必须恰好 6 条/)
  assert.equal(result.outline.chapters.length, 6)
  assert.equal(result.outline.chapters[0].id, 'ch01')
})

test('ensureVolume：engine 把 json 字段给成字符串也能解析', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm(() => ({ text: '', json: '```json\n' + JSON.stringify({ chapters: rowsFor(6) }) + '\n```' }))
  const result = await ensureVolume({ outline, params: PARAMS, read: memoryRead({}), llm }, { prompts: fakePrompts })
  assert.equal(result.calls, 1)
  assert.equal(result.outline.chapters.length, 6)
})

test('ensureVolume：第二卷提示词带 startChapter=7，合并后章号连续', async () => {
  const outline = buildOutlineSkeleton({ chapters: 12, chaptersPerVolume: 6, language: 'zh' })
  const seen = []
  const prompts = {
    volumeChapters(ctx) {
      seen.push(ctx)
      return { system: 'x', user: `VOL ${ctx.volume.index} start ${ctx.volume.startChapter}`, maxTokens: 100, temperature: 0 }
    },
  }
  const llm = fakeLlm(() => ({ text: JSON.stringify({ chapters: rowsFor(6) }) }))
  let current = outline
  for (let i = 0; i < 2; i += 1) {
    const result = await ensureVolume({ outline: current, params: PARAMS, read: memoryRead({}), llm }, { prompts })
    current = result.outline
  }
  assert.equal(seen.length, 2)
  assert.equal(seen[0].volume.startChapter, 1)
  assert.equal(seen[1].volume.startChapter, 7)
  assert.equal(seen[1].volume.index, 2)
  assert.equal(current.chapters.length, 12)
  assert.equal(current.chapters[11].id, 'ch12')
  assert.deepEqual(current.volumes[1].chapterIds.map((id) => id), ['ch07', 'ch08', 'ch09', 'ch10', 'ch11', 'ch12'])
})

test('ensureVolume：模型返回空章表 → 抛 LLM_PARSE，不污染大纲', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm(() => ({ text: '{"chapters":[]}' }))
  await assert.rejects(
    ensureVolume({ outline, params: PARAMS, read: memoryRead({}), llm }, { prompts: fakePrompts }),
    (error) => error.code === 'LLM_PARSE',
  )
  assert.equal(outline.chapters.length, 0)
})

// ---------------------------------------------------------------- prepareChapter

test('prepareChapter：缺卷纲 + 缺细纲 → calls=2，packet 不超 contextBudget', async () => {
  const outline = buildOutlineSkeleton({ chapters: 6, chaptersPerVolume: 6, language: 'zh' })
  const llm = fakeLlm((spec) => {
    if (spec.user.includes('VOLUME_PROMPT')) return { text: JSON.stringify({ chapters: rowsFor(6) }) }
    return { text: JSON.stringify(beatsPayload) }
  })
  const params = { ...PARAMS, contextBudget: 1500 }
  const prepared = await prepareChapter({
    outline,
    params,
    chapterId: 'ch01',
    read: memoryRead({ canon: fatCanon() }),
    llm,
    language: 'zh',
  }, { prompts: fakePrompts })

  assert.equal(prepared.calls, 2)
  assert.equal(llm.calls.length, 2)
  assert.match(llm.calls[0].user, /VOLUME_PROMPT/)
  assert.match(llm.calls[1].user, /BEATS_PROMPT ch01/)
  assert.equal(llm.calls[0].json, true)
  assert.equal(llm.calls[1].json, true)
  assert.equal(prepared.beats.scenes.length, 1)
  assert.equal(prepared.volume.id, 'v01')
  assert.ok(prepared.packet.text.length > 0)
  assert.ok(prepared.packet.text.length <= 1500, `packet 超预算：${prepared.packet.text.length}`)
  assert.ok(prepared.packet.report.used <= 1500)
  assert.match(prepared.packet.text, /第 1 章|章1/)
})

test('prepareChapter：材料齐 → calls=0，两次结果一致', async () => {
  const outline = plannedOutline()
  const read = memoryRead({
    canon: emptyCanon(),
    'beats/ch02': beatsPayload,
    'draft/ch01': cleanProse(),
    'summary/ch01': '他在殡仪馆找到一本空账本，陈婆警告他别住西厢。',
  })
  const llm = fakeLlm(() => {
    throw new Error('材料齐时不应调用模型')
  })
  const input = { outline, params: PARAMS, chapterId: 'ch02', read, llm, language: 'zh' }
  const first = await prepareChapter(input)
  const second = await prepareChapter(input)

  assert.equal(first.calls, 0)
  assert.equal(second.calls, 0)
  assert.equal(llm.calls.length, 0)
  assert.equal(first.packet.text, second.packet.text)
  assert.match(first.packet.text, /空账本/)
  assert.match(first.packet.text, /进殡仪馆/)
  assert.equal(first.beats.scenes.length, 1)
})

test('prepareChapter：默认用真实 prompts.beats 也能组装材料包', async () => {
  const outline = plannedOutline()
  const llm = fakeLlm(() => ({ text: JSON.stringify(beatsPayload) }))
  const prepared = await prepareChapter({
    outline,
    params: PARAMS,
    chapterId: 'ch02',
    read: memoryRead({ canon: emptyCanon(), 'draft/ch01': cleanProse(), 'summary/ch01': '前情。' }),
    llm,
    language: 'zh',
  })
  assert.equal(prepared.calls, 1)
  assert.equal(llm.calls.length, 1)
  assert.match(prepared.packet.text, /进殡仪馆/)
})

// ---------------------------------------------------------------- commitChapter

test('commitChapter：合并 canon 补丁，artifacts 完整', () => {
  const canon = mergeCanon(
    emptyCanon(),
    { facts: [{ s: '林砚', p: '状态', o: '活着', chapter: 'ch01' }] },
    { chapter: 'ch01' },
  )
  const text = `${cleanProse()}\n\n<<<SUMMARY>>>\n他进了殡仪馆，陈婆警告他别住西厢。\n<<<CANON>>>\n[{"s":"林砚","p":"位置","o":"殡仪馆"}]`
  const committed = commitChapter({
    read: memoryRead({ canon }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text,
  })

  assert.equal(committed.artifacts.draft.kind, 'md')
  assert.equal(committed.artifacts.draft.content, cleanProse())
  assert.equal(committed.artifacts.summary.kind, 'md')
  assert.equal(committed.artifacts.summary.content, '他进了殡仪馆，陈婆警告他别住西厢。')
  assert.ok(committed.canon.facts.some((fact) => fact.p === '位置' && fact.o === '殡仪馆'))
  assert.equal(committed.stats.facts, canonStats(committed.canon).facts)
  assert.ok(!committed.findings.some((finding) => finding.kind === 'summary-missing'))
  assert.equal(committed.verdict, 'pass')
})

test('commitChapter：summary 缺失 → 正文前 240 字确定性兜底 + note', () => {
  const committed = commitChapter({
    read: memoryRead({ canon: emptyCanon() }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text: cleanProse(),
  })
  const expected = Array.from(cleanProse()).slice(0, 240).join('')
  assert.equal(committed.artifacts.summary.content, expected)
  assert.ok(committed.artifacts.summary.content.length <= 240)
  const note = committed.findings.find((finding) => finding.kind === 'summary-missing')
  assert.equal(note?.severity, 'note')
})

test('commitChapter：长正文兜底摘要严格取前 240 字，不加省略号', () => {
  const body = Array.from({ length: 60 }, (_, i) => `第${i + 1}段，灯还亮着。`).join('\n\n')
  const committed = commitChapter({
    read: memoryRead({ canon: emptyCanon() }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text: body,
  })
  const chars = Array.from(body)
  assert.equal(chars.length > 240, true)
  assert.equal(committed.artifacts.summary.content, chars.slice(0, 240).join(''))
  assert.equal(committed.artifacts.summary.content.length, 240)
})

test('commitChapter：显式 summary 覆盖内联摘要', () => {
  const committed = commitChapter({
    read: memoryRead({ canon: emptyCanon() }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text: `${cleanProse()}\n<<<SUMMARY>>>\n内联摘要。`,
    summary: '外部摘要。',
  })
  assert.equal(committed.artifacts.summary.content, '外部摘要。')
})

test('commitChapter：空正文/占位符 → 抛 LLM_PARSE', () => {
  const base = { read: memoryRead({ canon: emptyCanon() }), params: PARAMS, outline: plannedOutline(), chapterId: 'ch02' }
  for (const text of ['', '   ', '正文缺失，无法续写']) {
    assert.throws(
      () => commitChapter({ ...base, text }),
      (error) => error.code === 'LLM_PARSE',
    )
  }
})

test('commitChapter：CANON 坏 JSON → 正文照落，canon 不变，留 warn', () => {
  const canon = mergeCanon(emptyCanon(), { facts: [{ s: '林砚', p: '状态', o: '活着' }] }, { chapter: 'ch01' })
  const committed = commitChapter({
    read: memoryRead({ canon }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text: `${cleanProse()}\n<<<SUMMARY>>>\n摘要。\n<<<CANON>>>\n{坏掉的 JSON`,
  })
  assert.equal(committed.artifacts.draft.content, cleanProse())
  assert.equal(committed.canon.facts.length, 1)
  const warning = committed.findings.find((finding) => finding.kind === 'canon-parse-error')
  assert.equal(warning?.severity, 'warn')
})

// ---------------------------------------------------------------- checkChapter

test('checkChapter：植入死亡人物 → block + revise', () => {
  const canon = mergeCanon(
    emptyCanon(),
    { facts: [{ s: '林砚', p: '状态', o: '死亡', chapter: 'ch01' }] },
    { chapter: 'ch01' },
  )
  const outline = plannedOutline()
  outline.chapters[1].cast = ['林砚']
  const checked = checkChapter({
    read: memoryRead({ canon }),
    params: PARAMS,
    outline,
    chapterId: 'ch02',
    text: `林砚推开门。\n\n${cleanProse()}`,
  })

  const dead = checked.findings.find((finding) => finding.kind === 'dead-character')
  assert.equal(dead?.severity, 'block')
  assert.ok(checked.counts.block >= 1)
  assert.equal(checked.verdict, 'revise')
  assert.equal(checked.canon.facts.length, 1)
})

test('checkChapter：干净正文 + 空 canon → pass', () => {
  const checked = checkChapter({
    read: memoryRead({ canon: emptyCanon() }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text: cleanProse(),
  })
  assert.equal(checked.counts.block, 0)
  assert.equal(checked.counts.warn, 0)
  assert.equal(checked.verdict, 'pass')
})

test('checkChapter：3 条 warn 也判 revise', () => {
  const checked = checkChapter({
    read: memoryRead({ canon: emptyCanon() }),
    params: PARAMS,
    outline: plannedOutline(),
    chapterId: 'ch02',
    text: '短。',
  })
  assert.ok(checked.counts.warn >= 3)
  assert.equal(checked.verdict, 'revise')
})
