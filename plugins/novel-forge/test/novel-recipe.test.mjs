// test/novel-recipe.test.mjs — 小说 recipe 单测：不调真模型。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createNovelRecipe,
  novelRecipe,
  paramsDefaults,
  paramsSchema,
  extractJson,
} from '../src/recipes/novel/index.js'
import {
  normalizeOutline,
  chaptersOf,
  chapterById,
  chapterId,
} from '../src/recipes/novel/outline.js'
import {
  createLedger,
  mergeLedger,
  slimLedger,
  characterBrief,
  emptyLedger,
} from '../src/recipes/novel/ledger.js'
import { AI_CLICHES, checkDraft, dialogueRatio } from '../src/recipes/novel/craft.js'
import {
  buildManuscript,
  manuscriptMarkdown,
  markdownExport,
  epubExport,
  slugify,
  dateStamp,
  exportFilename,
  stripChapterHeading,
} from '../src/recipes/novel/export.js'
import { validateRecipe } from '../src/forge/recipe.js'
import {
  createFakeCtx,
  createScriptedPrompts,
  jsonOut,
  textOut,
  sampleBrief,
  sampleCharacters,
  sampleLedger,
  sampleVolumeOutline,
  sampleBeats,
  SAMPLE_PARAMS,
  PROMISE_IDS,
} from './fixtures/novel-fixtures.mjs'

const STAGE_IDS = [
  'premise',
  'bible',
  'characters',
  'spine',
  'outline',
  'beats',
  'draft',
  'review',
  'revise',
  'blurb',
]

function stageOf(recipe, id) {
  const stage = recipe.stages.find((item) => item.id === id)
  assert.ok(stage, `stage ${id} 不存在`)
  return stage
}

function assertForgeError(fn, code = 'LLM_PARSE') {
  let caught = null
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert.ok(caught, '应当抛错')
  assert.equal(caught.code, code)
  return caught
}

async function assertRejectsCode(promise, code = 'LLM_PARSE') {
  let caught = null
  try {
    await promise
  } catch (error) {
    caught = error
  }
  assert.ok(caught, '应当抛错')
  assert.equal(caught.code, code)
  return caught
}

// ------------------------------------------------------------------ recipe 形状

test('recipe 形状符合 §3.1，10 个 stage 顺序符合 §4.2', () => {
  assert.equal(novelRecipe.id, 'novel')
  assert.equal(novelRecipe.version, 1)
  assert.equal(novelRecipe.title, '长篇小说')
  assert.deepEqual(novelRecipe.stages.map((stage) => stage.id), STAGE_IDS)
  assert.deepEqual(
    novelRecipe.stages.map((stage) => stage.each ?? null),
    [null, null, null, null, null, 'outline.chapters', 'outline.chapters', 'outline.chapters', 'outline.chapters', null],
  )
  assert.equal(typeof stageOf(novelRecipe, 'outline').review, 'function')
  assert.equal(typeof stageOf(novelRecipe, 'draft').review, 'function')
  assert.equal(stageOf(novelRecipe, 'draft').onItemError, 'stop')
  assert.deepEqual(stageOf(novelRecipe, 'draft').produces, ['draft/*', 'summary/*'])
  assert.deepEqual(novelRecipe.exports && Object.keys(novelRecipe.exports), ['markdown', 'epub'])
  assert.equal(typeof novelRecipe.estimate, 'function')
})

test('artifacts 声明覆盖所有 stage 产物', () => {
  const keys = Object.keys(novelRecipe.artifacts)
  for (const expected of ['brief', 'bible', 'characters', 'spine', 'outline', 'ledger', 'blurb', 'beats/*', 'draft/*', 'summary/*', 'review/*']) {
    assert.ok(keys.includes(expected), `缺少 artifact ${expected}`)
  }
  assert.equal(novelRecipe.artifacts['draft/*'].kind, 'md')
  assert.equal(novelRecipe.artifacts['review/*'].kind, 'json')
  for (const stage of novelRecipe.stages) {
    for (const key of stage.produces) {
      assert.ok(novelRecipe.artifacts[key], `stage ${stage.id} 的产物 ${key} 未声明`)
    }
  }
})

test('paramsSchema / paramsDefaults 符合 §4.1', () => {
  assert.deepEqual(paramsSchema.required, ['premise'])
  assert.equal(paramsSchema.additionalProperties, false)
  const premise = paramsSchema.properties.premise
  assert.equal(premise.minLength, 8)
  assert.equal(premise.maxLength, 2000)
  assert.equal(paramsDefaults.genre, '悬疑')
  assert.equal(paramsDefaults.chapters, 24)
  assert.equal(paramsDefaults.wordsPerChapter, 3000)
  assert.equal(paramsDefaults.pov, '第三人称限知')
  assert.equal(paramsDefaults.autoReview, true)
  assert.equal(paramsDefaults.reviewGate, false)
  assert.deepEqual(paramsSchema.properties.genre.enum, ['悬疑', '奇幻', '科幻', '都市', '历史', '言情', '恐怖', '武侠', '通用'])
})

test('validateRecipe 接受 recipe，并返回同一对象', () => {
  const result = validateRecipe(novelRecipe)
  assert.equal(result, novelRecipe)
  assert.doesNotThrow(() => validateRecipe(createNovelRecipe({ prompts: createScriptedPrompts() })))
})

test('estimate：调用数与章数/审校开关一致，参数被夹紧', () => {
  const withReview = novelRecipe.estimate({ ...paramsDefaults, chapters: 6, wordsPerChapter: 1200, autoReview: true })
  assert.equal(withReview.chapters, 6)
  assert.equal(withReview.calls, 42) // 6 + 6 * (1 + 2 + 3)
  assert.ok(withReview.estTokensIn > 0)
  assert.ok(withReview.estTokensOut > 0)
  assert.match(withReview.note, /6 章 × 1200 字/)

  const withoutReview = novelRecipe.estimate({ ...paramsDefaults, chapters: 6, autoReview: false })
  assert.equal(withoutReview.calls, 24) // 6 + 6 * (1 + 2)
  assert.match(withoutReview.note, /不含审校/)

  const clamped = novelRecipe.estimate({ chapters: 999, wordsPerChapter: 1 })
  assert.equal(clamped.chapters, 120)
  assert.match(clamped.note, /120 章 × 800 字/)
})

// ------------------------------------------------------------------ outline

test('normalizeOutline：模型乱给 id → 重排 ch01…，卷章扁平且总数一致', () => {
  const outline = normalizeOutline(sampleVolumeOutline(), { chapters: 3, language: 'zh' })
  assert.deepEqual(outline.chapters.map((chapter) => chapter.id), ['ch01', 'ch02', 'ch03'])
  assert.equal(outline.totalChapters, 3)
  assert.equal(outline.volumes.length, 2)
  assert.equal(outline.volumes[0].chapters.length, 2)
  assert.equal(outline.volumes[1].chapters[0].id, 'ch03')
  assert.equal(outline.chapters[0].title, '起：雨夜')
  assert.equal(outline.chapters[0].cast[0], '沈砚')
  assert.equal(outline.chapters[2].where, '灵堂')
  assert.equal(outline.language, 'zh')
})

test('normalizeOutline：模型多给章节按 params.chapters 裁掉并标记 trimmed', () => {
  const outline = normalizeOutline(sampleVolumeOutline(), { chapters: 2 })
  assert.equal(outline.totalChapters, 2)
  assert.equal(outline.trimmed, 1)
  assert.deepEqual(outline.chapters.map((chapter) => chapter.id), ['ch01', 'ch02'])
  assert.equal(outline.volumes.length, 1)
  assert.equal(outline.volumes[0].chapters.length, 2)
  assert.equal(outline.chapters[0].title, '起：雨夜')
})

test('normalizeOutline：模型少给章节不补，也不带 trimmed', () => {
  const outline = normalizeOutline(sampleVolumeOutline(), { chapters: 10 })
  assert.equal(outline.totalChapters, 3)
  assert.equal('trimmed' in outline, false)
  assert.deepEqual(outline.chapters.map((chapter) => chapter.id), ['ch01', 'ch02', 'ch03'])
})

test('normalizeOutline：支持扁平 chapters，并按总数决定 id 宽度', () => {
  const flat = normalizeOutline(
    {
      chapters: [
        { title: '一', goal: 'g', conflict: 'c', turn: 't', hook: 'h', pov: 'p', when: 'w', where: 'x', cast: [] },
        { title: '二', goal: 'g', conflict: 'c', turn: 't', hook: 'h', pov: 'p', when: 'w', where: 'x', cast: [] },
      ],
    },
    { chapters: 100 },
  )
  assert.deepEqual(flat.chapters.map((chapter) => chapter.id), ['ch01', 'ch02'])
  assert.equal(chapterId(0, 100), 'ch001')
  assert.equal(chapterId(119, 120), 'ch120')
  assert.equal(chapterId(9, 10), 'ch10')
  assert.equal(flat.volumes.length, 1)
})

test('normalizeOutline：字段缺失抛 LLM_PARSE 并带 raw', () => {
  const error = assertForgeError(() => normalizeOutline({ volumes: [{ title: '卷', purpose: 'p', chapters: [{ title: '' }] }] }))
  assert.equal(error.code, 'LLM_PARSE')
  assert.ok('raw' in error.detail)
  assertForgeError(() => normalizeOutline({}))
})

test('chaptersOf / chapterById 兼容多种 project 形状', () => {
  const outline = normalizeOutline(sampleVolumeOutline())
  assert.equal(chaptersOf(outline).length, 3)
  assert.equal(chaptersOf({ artifacts: { outline: { content: outline } } }).length, 3)
  assert.equal(chaptersOf({ outline: { chapters: outline.chapters } }).length, 3)
  assert.deepEqual(chaptersOf(null), [])
  assert.equal(chapterById({ artifacts: { outline: { content: outline } } }, 'ch02').title, '承：旧照片')
  assert.equal(chapterById({ artifacts: { outline: { content: outline } } }, 'ch99'), null)
})

test('extractJson 能从围栏与前后废话里取出 JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('好的，结果如下：\n{"a":[1,2]}\n以上。'), { a: [1, 2] })
  assert.equal(extractJson('完全不是 JSON'), undefined)
})

// ------------------------------------------------------------------ ledger

test('createLedger：brief 进事实、hook 开线索、goal 进时间线、视角进正典', () => {
  const outline = normalizeOutline(sampleVolumeOutline())
  const ledger = createLedger({ brief: sampleBrief(), outline, params: SAMPLE_PARAMS })
  assert.equal(ledger.facts.length, 5)
  assert.ok(ledger.facts.some((fact) => fact.text.includes('长夜将明')))
  assert.equal(ledger.threads.length, 3)
  assert.ok(ledger.threads.every((thread) => thread.status === 'open'))
  assert.equal(ledger.threads[0].text, 'ch01 钩子：门外站着的是谁')
  assert.equal(ledger.timeline.length, 3)
  assert.equal(ledger.timeline[1].when, '次日')
  assert.ok(ledger.canonRules.includes('视角：第三人称限知'))
  assert.ok(ledger.canonRules.includes('类型：悬疑'))
})

test('mergeLedger：事实去重、线索开闭、人物覆盖+并集、时间线去重，不改入参', () => {
  const base = createLedger({
    brief: sampleBrief(),
    outline: normalizeOutline(sampleVolumeOutline()),
    params: SAMPLE_PARAMS,
  })
  const snapshot = JSON.stringify(base)
  const merged = mergeLedger(
    base,
    {
      facts: [
        { text: '故事核：殡仪馆夜班青年追查头七回魂的真相。' }, // 重复
        { text: '凶器是一把裁纸刀' },
      ],
      threads: [{ text: '门外站着的是谁', status: 'closed' }],
      characters: { 沈砚: { location: '停尸间', knows: ['父亲已死'] } },
      timeline: [{ chapter: 'ch01', when: '雨夜', event: '沈砚值夜班，第一次遇到回魂' }], // 同章同事件重复
    },
    'ch02',
  )
  assert.equal(JSON.stringify(base), snapshot, 'mergeLedger 不应修改入参')
  assert.ok(merged.facts.some((fact) => fact.text === '凶器是一把裁纸刀'))
  assert.equal(merged.facts.length, 6)
  const thread = merged.threads.find((item) => item.text.includes('门外站着的是谁'))
  assert.equal(thread.status, 'closed')
  assert.equal(thread.closedIn, 'ch02')
  assert.equal(merged.characters['沈砚'].location, '停尸间')
  assert.deepEqual(merged.characters['沈砚'].knows, ['父亲已死'])
  assert.equal(merged.timeline.length, 3) // 重复项未追加
})

test('mergeLedger：人物状态局部更新不丢旧字段，knows 并集', () => {
  const base = sampleLedger()
  const merged = mergeLedger(base, { characters: { 沈砚: { state: '惊醒', knows: ['父亲已死'] } } }, 'ch03')
  assert.equal(merged.characters['沈砚'].location, '殡仪馆')
  assert.equal(merged.characters['沈砚'].state, '惊醒')
  assert.deepEqual(merged.characters['沈砚'].knows, ['头七回魂存在', '父亲已死'])
})

test('mergeLedger：数量上限生效（facts ≤ 80）', () => {
  const base = emptyLedger()
  const patch = { facts: Array.from({ length: 120 }, (_, i) => ({ text: `事实 ${i}` })) }
  const merged = mergeLedger(base, patch, 'ch01')
  assert.equal(merged.facts.length, 80)
})

test('slimLedger：按预算输出分节 prompt，超预算截断', () => {
  const ledger = sampleLedger()
  const full = slimLedger(ledger, { maxChars: 3000 })
  assert.ok(full.includes('【正典】'))
  assert.ok(full.includes('【未回收线索】'))
  assert.ok(full.includes('【已确立事实】'))
  assert.ok(full.includes('【人物状态】'))
  assert.ok(full.includes('【时间线】'))
  assert.ok(full.includes('门外站着的是谁'))

  const tiny = slimLedger(ledger, { maxChars: 80 })
  assert.ok(tiny.length <= 80, `slimLedger 超预算：${tiny.length}`)
  assert.ok(tiny.includes('…（已截断）'))
  assert.equal(slimLedger(null, { maxChars: 100 }), '')
})

test('characterBrief：按点名过滤，支持 cast 与 ledger 映射', () => {
  const fromCast = characterBrief(sampleCharacters().cast, ['沈砚'], 1500)
  assert.ok(fromCast.includes('沈砚'))
  assert.ok(!fromCast.includes('阿绫'))
  const fromLedger = characterBrief(sampleLedger().characters, [], 1500)
  assert.ok(fromLedger.includes('殡仪馆'))
  assert.ok(characterBrief(sampleCharacters().cast, ['不存在'], 1500).includes('沈砚'))
})

// ------------------------------------------------------------------ craft

test('craft：AI_CLICHES 为契约里的 13 个词', () => {
  assert.equal(AI_CLICHES.length, 13)
  for (const word of ['仿佛', '似乎', '不禁', '嘴角勾起', '空气仿佛凝固', '难以言喻']) {
    assert.ok(AI_CLICHES.includes(word))
  }
})

test('craft：stats 精确（cjk/段落/对话比/场景数）', () => {
  const text = '“你来了。”她说。\n\n他点头，走进屋里。'
  const { findings, stats } = checkDraft({ text, params: { wordsPerChapter: 100 }, beats: null })
  assert.equal(stats.cjk, 12)
  assert.equal(stats.paragraphs, 2)
  assert.equal(stats.dialogueRatio, 0.222)
  assert.equal(stats.sceneCount, 1)
  assert.equal(dialogueRatio(text), 0.222)
  assert.ok(findings.every((finding) => finding.severity !== 'block'))
})

test('craft：空正文直接 block，stats 归零', () => {
  const { findings, stats } = checkDraft({ text: '   ', params: {} })
  assert.equal(findings[0].severity, 'block')
  assert.equal(findings[0].kind, 'empty')
  assert.equal(stats.cjk, 0)
  assert.equal(stats.paragraphs, 0)
})

test('craft：字数偏离区间 / 段落过少 / 对话不足 / 单段过长', () => {
  const short = checkDraft({ text: '他走进去。\n\n屋里没人。', params: { wordsPerChapter: 3000 } })
  const kinds = short.findings.map((finding) => finding.kind)
  assert.ok(kinds.includes('length'))
  assert.ok(kinds.includes('paragraph'))
  assert.ok(kinds.includes('dialogue'))

  const longParagraph = '沈'.repeat(240)
  const long = checkDraft({ text: `${longParagraph}\n\n他停下。`, params: { wordsPerChapter: 3000 } })
  const note = long.findings.find((finding) => finding.kind === 'paragraph' && finding.severity === 'note')
  assert.ok(note)
  assert.match(note.issue, /240 字/)
})

test('craft：AI 腔命中 ≥3 次报 warn', () => {
  const text = '他仿佛听见了什么。\n\n她似乎也听见了，不禁回头。\n\n空气仿佛凝固了一瞬。'
  const { findings } = checkDraft({ text, params: { wordsPerChapter: 1000 } })
  const cliche = findings.find((finding) => finding.kind === 'ai-cliche')
  assert.ok(cliche)
  assert.equal(cliche.severity, 'warn')
  assert.match(cliche.issue, /仿佛×2/)
})

test('craft：连续三段同一四字短语报 note', () => {
  const text = '他抬头看天。\n\n她也抬头看天。\n\n两人都抬头看天。'
  const { findings } = checkDraft({ text, params: { wordsPerChapter: 1000 } })
  const repeat = findings.find((finding) => finding.kind === 'repeat')
  assert.ok(repeat)
  assert.match(repeat.where, /第1–3段/)
})

test('craft：第三人称限知下的全知句报 note；全知视角不报', () => {
  const text = '与此同时，在城市的另一端，有人推开了门。'
  const limited = checkDraft({ text, params: { pov: '第三人称限知', wordsPerChapter: 1000 } })
  assert.ok(limited.findings.some((finding) => finding.kind === 'pov'))
  const omniscient = checkDraft({ text, params: { pov: '第三人称全知', wordsPerChapter: 1000 } })
  assert.ok(!omniscient.findings.some((finding) => finding.kind === 'pov'))
})

test('craft：细纲人物未出场报 warn，bounds/severity 形状正确', () => {
  const { findings } = checkDraft({
    text: '沈砚走在雨里。',
    params: { wordsPerChapter: 1000 },
    beats: { scenes: [{ cast: ['沈砚', '阿绫'] }] },
  })
  const cast = findings.find((finding) => finding.kind === 'cast')
  assert.ok(cast)
  assert.match(cast.issue, /阿绫/)
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['fix', 'issue', 'kind', 'severity', 'where'])
    assert.ok(['block', 'warn', 'note'].includes(finding.severity))
  }
})

test('craft：上一章钩子未接住报 note（仅当前 4 字不在正文时）', () => {
  const missed = checkDraft({
    text: '他走进屋子。',
    params: { wordsPerChapter: 1000 },
    previousHook: '门外站着的是谁',
  })
  assert.ok(missed.findings.some((finding) => finding.kind === 'hook'))
  const answered = checkDraft({
    text: '门外站着的是谁？他问。',
    params: { wordsPerChapter: 1000 },
    previousHook: '门外站着的是谁',
  })
  assert.ok(!answered.findings.some((finding) => finding.kind === 'hook'))
})

// ------------------------------------------------------------------ export

function exportFixtureCtx() {
  const outline = normalizeOutline(sampleVolumeOutline())
  const drafts = {
    'draft/ch01': '## 第1章 起：雨夜\n\n沈砚推开门。\n\n“你来了。”她说。',
    'draft/ch02': '## 第2章 承：旧照片\n\n照片里多了一个人。',
    'draft/ch03': '## 第3章 转：头七\n\n父亲真的回来了。',
  }
  return createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: {
      outline: { kind: 'json', content: outline },
      brief: { kind: 'json', content: sampleBrief() },
      blurb: {
        kind: 'json',
        content: {
          title: '长夜将明',
          tagline: '头七那晚，死者开口了',
          blurb: '头七那晚，死者开口叫出了他父亲的名字。',
          tags: ['悬疑', '灵异'],
        },
      },
      ...drafts,
    },
  })
}

test('export：markdown 结构（书名/简介/目录/章节顺序/尾页字数）', async () => {
  const ctx = exportFixtureCtx()
  const manuscript = buildManuscript(ctx)
  assert.equal(manuscript.title, '长夜将明')
  assert.equal(manuscript.chapters.length, 3)
  assert.equal(manuscript.chapters[1].no, 2)
  assert.ok(manuscript.words > 0)

  const text = manuscriptMarkdown(manuscript)
  assert.ok(text.startsWith('# 长夜将明\n'))
  assert.ok(text.includes('> 头七那晚，死者开口叫出了他父亲的名字。'))
  assert.ok(text.includes('## 目录'))
  assert.ok(text.includes('- 第1章 起：雨夜'))
  assert.ok(text.includes('- 第2章 承：旧照片'))
  assert.ok(text.includes('- 第3章 转：头七'))
  assert.ok(text.indexOf('## 第1章 起：雨夜') < text.indexOf('## 第2章 承：旧照片'))
  assert.ok(text.indexOf('## 第2章 承：旧照片') < text.indexOf('## 第3章 转：头七'))
  assert.ok(text.indexOf('## 目录') < text.indexOf('## 第1章'))
  assert.match(text, /共 3 章 ｜ 约 \d+ 字/)
  assert.equal((text.match(/## 第1章/g) ?? []).length, 1, '正文章节标题不应重复')

  const result = await markdownExport(ctx)
  assert.match(result.filename, /^长夜将明-\d{8}\.md$/)
  assert.equal(result.mime, 'text/markdown; charset=utf-8')
  assert.ok(Buffer.isBuffer(result.buffer))
  assert.ok(result.buffer.toString('utf8').includes('## 第3章 转：头七'))
})

test('export：slug/日期/文件名 & 章节标题剥离', () => {
  assert.equal(slugify('长夜/将明'), '长夜-将明')
  assert.equal(slugify('a/b:c*?', '兜底'), 'a-b-c')
  assert.equal(slugify('///', '兜底'), '兜底')
  assert.equal(dateStamp(new Date(2026, 0, 5)), '20260105')
  assert.equal(exportFilename('长夜将明', 'md', new Date(2026, 0, 5)), '长夜将明-20260105.md')
  assert.equal(stripChapterHeading('## 第1章 起\n\n正文'), '正文')
  assert.equal(stripChapterHeading('正文'), '正文')
})

test('export：epub 返回 zip buffer，文件名正确', async () => {
  const ctx = exportFixtureCtx()
  const result = await epubExport(ctx)
  assert.match(result.filename, /^长夜将明-\d{8}\.epub$/)
  assert.equal(result.mime, 'application/epub+zip')
  assert.ok(Buffer.isBuffer(result.buffer))
  assert.ok(result.buffer.length > 100)
  assert.equal(result.buffer.subarray(0, 2).toString('latin1'), 'PK')
})

// ------------------------------------------------------------------ stage run

test('premise：JSON 校验后写 brief；params.title 覆盖模型书名', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, title: '用户书名' },
    outputs: [jsonOut(sampleBrief())],
  })
  const out = await stageOf(recipe, 'premise').run(ctx)
  assert.equal(out.artifacts.brief.kind, 'json')
  assert.equal(out.artifacts.brief.content.title, '用户书名')
  assert.equal(out.artifacts.brief.content.logline, sampleBrief().logline)
  assert.equal(ctx.calls[0].json, true)
  assert.equal(ctx.calls[0].phase, 'premise')
})

test('premise：JSON 缺字段 / 非 JSON 抛 LLM_PARSE 带 raw', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const missing = createFakeCtx({ outputs: [jsonOut({ logline: '只有一句话' })] })
  const error = await assertRejectsCode(stageOf(recipe, 'premise').run(missing))
  assert.ok('raw' in error.detail)

  const notJson = createFakeCtx({ outputs: [textOut('这不是 JSON')] })
  await assertRejectsCode(stageOf(recipe, 'premise').run(notJson))
})

test('bible / characters / spine：文本补标题，JSON 过 schema', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })

  const bibleCtx = createFakeCtx({ outputs: [textOut('殡仪馆有头七回魂的规矩。')] })
  const bible = await stageOf(recipe, 'bible').run(bibleCtx)
  assert.ok(bible.artifacts.bible.content.startsWith('# 世界设定'))

  const charactersCtx = createFakeCtx({ outputs: [jsonOut(sampleCharacters())] })
  const characters = await stageOf(recipe, 'characters').run(charactersCtx)
  assert.equal(characters.artifacts.characters.content.cast.length, 2)

  const spineCtx = createFakeCtx({ outputs: [textOut('他从逃避到承担。')] })
  const spine = await stageOf(recipe, 'spine').run(spineCtx)
  assert.ok(spine.artifacts.spine.content.startsWith('# 情感脊柱'))
})

test('outline stage：规范化 outline 并初始化 ledger，模型 id 不被采信', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: { brief: { kind: 'json', content: sampleBrief() } },
    outputs: [jsonOut(sampleVolumeOutline())],
  })
  const out = await stageOf(recipe, 'outline').run(ctx)
  assert.deepEqual(
    out.artifacts.outline.content.chapters.map((chapter) => chapter.id),
    ['ch01', 'ch02', 'ch03'],
  )
  assert.equal(out.artifacts.outline.content.volumes[0].chapters[0].id, 'ch01')
  assert.equal(out.artifacts.ledger.content.threads.length, 3)
  assert.equal(out.artifacts.ledger.content.facts.length, 5)
  assert.equal(ctx.calls[0].phase, 'outline')
})

test('beats stage：章节 id 用 item，场景 no 重排', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const item = { id: 'ch07', title: '第七章', goal: 'g', turn: 't', cast: ['沈砚'] }
  const rawBeats = sampleBeats('模型乱写的 id')
  rawBeats.scenes = rawBeats.scenes.map((scene, index) => ({ ...scene, no: 90 + index }))
  const ctx = createFakeCtx({ item, outputs: [jsonOut(rawBeats)] })
  const out = await stageOf(recipe, 'beats').run(ctx)
  const beats = out.artifacts['beats/ch07'].content
  assert.equal(beats.chapterId, 'ch07')
  assert.deepEqual(beats.scenes.map((scene) => scene.no), [1, 2])
  assert.equal(beats.title, '起：雨夜')
})

test('draft stage：两次调用（正文+摘要），标题重建，maxTokens 按字数', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = normalizeOutline(sampleVolumeOutline())
  const items = outline.chapters
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items,
    item: items[0],
    index: 0,
    artifacts: {
      outline: { kind: 'json', content: outline },
      brief: { kind: 'json', content: sampleBrief() },
      characters: { kind: 'json', content: sampleCharacters() },
      ledger: { kind: 'json', content: sampleLedger() },
      'beats/ch01': { kind: 'json', content: sampleBeats() },
    },
    outputs: [
      textOut('以下是正文：\n\n## 第9章 旧标题\n\n雨下得很大。\n\n“你来了。”她说。'),
      textOut('摘要：沈砚在雨夜见到回魂，听见父亲的名字。'),
    ],
  })
  const out = await stageOf(recipe, 'draft').run(ctx)
  const draft = out.artifacts['draft/ch01'].content
  assert.ok(draft.startsWith('## 第1章 起：雨夜'))
  assert.ok(!draft.includes('第9章'))
  assert.ok(draft.includes('雨下得很大。'))
  assert.equal(out.artifacts['summary/ch01'].content, '沈砚在雨夜见到回魂，听见父亲的名字。')
  assert.equal(ctx.calls.length, 2)
  assert.equal(ctx.calls[0].json, false)
  assert.equal(ctx.calls[1].phase, 'summary')
  assert.equal(ctx.calls[0].maxTokens, Math.round(1200 * 2.2))
  assert.equal(ctx.calls[1].maxTokens, 800)

  const draftPrompt = prompts.calls.find((call) => call.id === 'draft')
  assert.ok(draftPrompt.ctx.materials.beats.includes('停尸间'))
  assert.ok(draftPrompt.ctx.materials.characters.includes('沈砚'))
  const summaryPrompt = prompts.calls.find((call) => call.id === 'summary')
  assert.equal(summaryPrompt.ctx.draft, draft)
})

test('draft stage：上一章 summary 与下一章目标进入喂料', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = normalizeOutline(sampleVolumeOutline())
  const items = outline.chapters
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items,
    item: items[1],
    index: 1,
    artifacts: {
      outline: { kind: 'json', content: outline },
      characters: { kind: 'json', content: sampleCharacters() },
      ledger: { kind: 'json', content: sampleLedger() },
      'beats/ch02': { kind: 'json', content: sampleBeats('ch02') },
      'summary/ch01': { kind: 'md', content: '上一章：沈砚听见父亲的名字。' },
    },
    outputs: [textOut('第二章正文，雨停了。'), textOut('第二章摘要。')],
  })
  const out = await stageOf(recipe, 'draft').run(ctx)
  assert.ok(out.artifacts['draft/ch02'].content.startsWith('## 第2章 承：旧照片'))
  const draftPrompt = prompts.calls.find((call) => call.id === 'draft')
  assert.match(draftPrompt.ctx.materials.previousSummary, /上一章/)
  assert.match(draftPrompt.ctx.materials.nextGoal, /目标：真相逼近/)
  assert.equal(draftPrompt.ctx.materials.previousHook, '门外站着的是谁')
})

test('draft stage：正文为空抛 LLM_PARSE', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    item: { id: 'ch01', title: '起' },
    items: [{ id: 'ch01', title: '起' }],
    outputs: [textOut('   ')],
  })
  await assertRejectsCode(stageOf(recipe, 'draft').run(ctx))
})

test('review stage：LLM findings 与 craft 合并、排序、算 verdict、写回 ledger', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起：雨夜', hook: '门外站着的是谁' }],
    item: { id: 'ch01', title: '起：雨夜', hook: '门外站着的是谁' },
    artifacts: {
      ledger: { kind: 'json', content: sampleLedger() },
      'draft/ch01': {
        kind: 'md',
        content: '## 第1章 起\n\n他仿佛看见了什么。似乎有人。不禁后退。',
      },
      'beats/ch01': { kind: 'json', content: sampleBeats() },
    },
    outputs: [
      jsonOut({
        findings: [
          { severity: 'note', kind: 'style', where: 'ch01', issue: '比喻略多', fix: '删一处' },
          { severity: 'block', kind: 'logic', where: 'ch01', issue: '时间线矛盾', fix: '调整顺序' },
        ],
        ledgerPatch: {
          facts: [{ text: '停尸间的尸体是沈砚的父亲' }],
          threads: [{ text: '门外站着的是谁', status: 'closed' }],
          characters: { 沈砚: { location: '停尸间', knows: ['父亲已死'] } },
          timeline: [{ when: '雨夜', event: '沈砚听见敲击声' }],
        },
        verdict: 'pass',
      }),
    ],
  })
  const out = await stageOf(recipe, 'review').run(ctx)
  const review = out.artifacts['review/ch01'].content
  assert.equal(review.verdict, 'revise')
  assert.equal(review.findings[0].severity, 'block')
  assert.ok(review.findings.some((finding) => finding.kind === 'ai-cliche'))
  assert.ok(review.findings.some((finding) => finding.kind === 'logic'))

  const ledger = out.artifacts.ledger.content
  assert.ok(ledger.facts.some((fact) => fact.text === '停尸间的尸体是沈砚的父亲'))
  assert.equal(ledger.threads.find((thread) => thread.text.includes('门外站着的是谁')).status, 'closed')
  assert.equal(ledger.characters['沈砚'].location, '停尸间')
  assert.ok(ledger.characters['沈砚'].knows.includes('头七回魂存在'))
  assert.ok(ledger.timeline.some((entry) => entry.event === '沈砚听见敲击声'))
})

test('review stage：LLM 空返回时降级为确定性检查，不让整炉失败', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起' }],
    item: { id: 'ch01', title: '起' },
    artifacts: {
      'draft/ch01': {
        kind: 'md',
        content: '## 第1章 起\n\n他仿佛看见了什么。似乎有人。不禁后退。',
      },
    },
    outputs: [
      () => {
        const error = new Error('模型返回了空文本')
        error.code = 'LLM_EMPTY'
        throw error
      },
    ],
  })
  const out = await stageOf(recipe, 'review').run(ctx)
  const review = out.artifacts['review/ch01'].content
  assert.ok(review.findings.some((finding) => finding.kind === 'ai-cliche'))
  assert.equal(review.verdict, 'revise')
  assert.ok(out.note.includes('仅保留确定性检查'))
})

test('blurb stage：缺「## 简介」时退回整段干净文本', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, title: '纸页之下' },
    outputs: [textOut('# 《纸页之下》\n\n一句话卖点：每本书都写着下一个借书人的死期。\n\n旧书店的女孩开始整理遗物。')],
  })
  const out = await stageOf(recipe, 'blurb').run(ctx)
  const blurb = out.artifacts.blurb.content
  assert.equal(blurb.title, '纸页之下')
  assert.ok(blurb.blurb.includes('旧书店的女孩'))
  assert.ok(blurb.blurb.includes('死期'))
})

test('review stage：无 ledgerPatch 时不写 ledger，全 note 时 verdict=pass', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, wordsPerChapter: 60, pov: '第三人称全知' },
    items: [{ id: 'ch01', title: '起' }],
    item: { id: 'ch01', title: '起' },
    artifacts: {
      'draft/ch01': {
        kind: 'md',
        content: Array.from({ length: 15 }, () => '“走吧。”他说。').join('\n\n'),
      },
    },
    outputs: [
      jsonOut({
        findings: [{ severity: 'note', kind: 'style', where: 'ch01', issue: '句子略平', fix: '加动作' }],
        ledgerPatch: {},
        verdict: 'pass',
      }),
    ],
  })
  const out = await stageOf(recipe, 'review').run(ctx)
  assert.ok(!('ledger' in out.artifacts))
  assert.equal(out.artifacts['review/ch01'].content.verdict, 'pass')
})

test('skip 契约：autoReview=false 时 review/revise 跳过并给原因', () => {
  const recipe = novelRecipe
  assert.equal(stageOf(recipe, 'review').skip({ params: { autoReview: false } }), '未开启自动审校')
  assert.equal(stageOf(recipe, 'revise').skip({ params: { autoReview: false } }), '未开启自动审校')
  assert.equal(stageOf(recipe, 'review').skip({ params: { autoReview: true } }), false)
  assert.equal(stageOf(recipe, 'revise').skip({ params: { autoReview: true } }), false)
})

test('revise stage：无 block/warn 时跳过，不调模型', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    items: [{ id: 'ch01', title: '起' }],
    item: { id: 'ch01', title: '起' },
    artifacts: {
      'review/ch01': {
        kind: 'json',
        content: {
          findings: [{ severity: 'note', kind: 'style', where: 'ch01', issue: '小问题', fix: '可改可不改' }],
          ledgerPatch: {},
          verdict: 'pass',
        },
      },
    },
  })
  const out = await stageOf(recipe, 'revise').run(ctx)
  assert.deepEqual(out.artifacts, {})
  assert.match(out.note, /跳过修订/)
  assert.equal(ctx.calls.length, 0)
})

test('revise stage：review 缺失时不冒充“无问题”', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    items: [{ id: 'ch01', title: '起' }],
    item: { id: 'ch01', title: '起' },
    artifacts: {},
  })
  const out = await stageOf(recipe, 'revise').run(ctx)
  assert.deepEqual(out.artifacts, {})
  assert.match(out.note, /尚未审校/)
  assert.equal(ctx.calls.length, 0)
})

test('revise stage：有 block 时重写 draft + summary，findings 传入 prompt', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起：雨夜' }],
    item: { id: 'ch01', title: '起：雨夜' },
    artifacts: {
      'draft/ch01': { kind: 'md', content: '## 第1章 起：雨夜\n\n旧正文。' },
      'review/ch01': {
        kind: 'json',
        content: {
          findings: [{ severity: 'block', kind: 'logic', where: 'ch01', issue: '时间线矛盾', fix: '调整顺序' }],
          ledgerPatch: {},
          verdict: 'revise',
        },
      },
      ledger: { kind: 'json', content: sampleLedger() },
    },
    outputs: [textOut('## 第1章 起：雨夜\n\n修订后的正文。'), textOut('修订后的摘要。')],
  })
  const out = await stageOf(recipe, 'revise').run(ctx)
  assert.ok(out.artifacts['draft/ch01'].content.includes('修订后的正文'))
  assert.equal(out.artifacts['summary/ch01'].content, '修订后的摘要。')
  assert.equal(ctx.calls.length, 2)
  assert.equal(ctx.calls[0].phase, 'revise')
  const revisePrompt = prompts.calls.find((call) => call.id === 'revise')
  assert.equal(revisePrompt.ctx.findings.length, 1)
  assert.ok(revisePrompt.ctx.draftText.includes('旧正文'))
})

test('blurb stage：书名/卖点/简介/标签，params.title 覆盖', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const blurbMd = '# 《模型书名》\n\n一句话卖点：一句话卖点\n\n## 简介\n三句话简介。\n\n## 标签\n悬疑 / 灵异'
  const ctx = createFakeCtx({ params: { ...SAMPLE_PARAMS }, outputs: [textOut(blurbMd)] })
  const out = await stageOf(recipe, 'blurb').run(ctx)
  assert.equal(out.artifacts.blurb.content.title, '模型书名')
  assert.equal(out.artifacts.blurb.content.tagline, '一句话卖点')
  assert.ok(out.artifacts.blurb.content.blurb.includes('三句话简介'))
  assert.equal(out.artifacts.blurb.content.tags.length, 2)

  const overridden = createFakeCtx({
    params: { ...SAMPLE_PARAMS, title: '用户书名' },
    outputs: [textOut(blurbMd)],
  })
  const out2 = await stageOf(recipe, 'blurb').run(overridden)
  assert.equal(out2.artifacts.blurb.content.title, '用户书名')
})

test('prompts 契约：每个 stage 都调用对应 prompt 且拿到 ctx', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = normalizeOutline(sampleVolumeOutline())
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [outline.chapters[0]],
    item: outline.chapters[0],
    index: 0,
    artifacts: {
      brief: { kind: 'json', content: sampleBrief() },
      characters: { kind: 'json', content: sampleCharacters() },
      ledger: { kind: 'json', content: sampleLedger() },
      'beats/ch01': { kind: 'json', content: sampleBeats() },
    },
    outputs: [jsonOut({ ...sampleBrief(), title: '长夜将明' })],
  })
  await stageOf(recipe, 'premise').run(ctx)
  assert.equal(prompts.calls[0].id, 'premise')
  assert.equal(prompts.calls[0].ctx.params.chapters, SAMPLE_PARAMS.chapters)
  assert.equal(PROMISE_IDS.length, 11)
})
