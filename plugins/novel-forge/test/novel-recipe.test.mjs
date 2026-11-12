// test/novel-recipe.test.mjs — 小说 recipe 单测：不调真模型。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createNovelRecipe,
  novelRecipe,
  paramsDefaults,
  paramsSchema,
  extractJson,
  looksCutJson,
  salvageScenes,
  isPlaceholderText,
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
import { createPrompts } from '../src/recipes/novel/prompts/zh.js'
import {
  createFakeCtx,
  createScriptedPrompts,
  jsonOut,
  textOut,
  sampleBrief,
  sampleCharacters,
  sampleLedger,
  sampleVolumeOutline,
  sampleOutlineV2,
  sampleVolumeChapters,
  sampleSpine,
  sampleBeats,
  sampleProse,
  SAMPLE_PARAMS,
  PROMISE_IDS,
} from './fixtures/novel-fixtures.mjs'

// §3 v0.2 阶段表 9 段：beats 不再是独立 stage（并入 draft），outline 只做骨架/卷纲。
const STAGE_IDS = [
  'premise',
  'bible',
  'characters',
  'spine',
  'outline',
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

test('recipe 形状符合 §3.1，9 个 stage 顺序符合 §4.2', () => {
  assert.equal(novelRecipe.id, 'novel')
  assert.equal(novelRecipe.version, 2)
  assert.equal(novelRecipe.title, '长篇小说')
  assert.deepEqual(novelRecipe.stages.map((stage) => stage.id), STAGE_IDS)
  assert.deepEqual(
    novelRecipe.stages.map((stage) => stage.each ?? null),
    [null, null, null, null, null, 'outline.chapters', 'outline.chapters', 'outline.chapters', null],
  )
  assert.equal(typeof stageOf(novelRecipe, 'outline').review, 'function')
  assert.equal(typeof stageOf(novelRecipe, 'draft').review, 'function')
  assert.equal(stageOf(novelRecipe, 'draft').onItemError, 'stop')
  // v0.2：细纲不再是独立 stage，并入 draft——同一次 run 里先补 beats 再写正文。
  assert.deepEqual(stageOf(novelRecipe, 'draft').produces, ['draft/*', 'summary/*', 'beats/*', 'canon', 'outline'])
  assert.deepEqual(novelRecipe.exports && Object.keys(novelRecipe.exports), ['markdown', 'epub'])
  assert.equal(typeof novelRecipe.estimate, 'function')
})

test('artifacts 声明覆盖所有 stage 产物', () => {
  const keys = Object.keys(novelRecipe.artifacts)
  for (const expected of ['brief', 'bible', 'characters', 'spine', 'outline', 'canon', 'blurb', 'beats/*', 'draft/*', 'summary/*', 'review/*']) {
    assert.ok(keys.includes(expected), `缺少 artifact ${expected}`)
  }
  // v1 的 ledger 只作为迁移来源读，v0.2 不再声明/产出。
  assert.ok(!keys.includes('ledger'), 'v0.2 不应再声明 ledger 产物')
  assert.equal(novelRecipe.artifacts['draft/*'].kind, 'md')
  assert.equal(novelRecipe.artifacts['review/*'].kind, 'json')
  assert.equal(novelRecipe.artifacts.canon.kind, 'json')
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

test('estimate：调用数按 v2 成本模型（每章 3.5 次 + 每卷卷纲），参数被夹紧', () => {
  const withReview = novelRecipe.estimate({ ...paramsDefaults, chapters: 6, wordsPerChapter: 1200, autoReview: true })
  assert.equal(withReview.chapters, 6)
  // 6 个单次阶段 + 6 章 × 3.5（细纲 1、草稿 1、摘要/正典补丁 0.5、审校+修订 1）+ 1 卷卷纲
  assert.equal(withReview.calls, 28)
  assert.equal(withReview.volumePlans, 1)
  assert.ok(withReview.estTokensIn > 0)
  assert.ok(withReview.estTokensOut > 0)
  assert.match(withReview.note, /6 章 × 1200 字/)
  assert.match(withReview.note, /第 N 章的写作材料和第 1 章一样大/)

  const withoutReview = novelRecipe.estimate({ ...paramsDefaults, chapters: 6, autoReview: false })
  assert.equal(withoutReview.calls, 22) // 不开审校：每章只剩细纲 + 草稿 + 摘要/正典补丁
  assert.match(withoutReview.note, /不含审校/)

  // v2 按 packet 上限估固定每章成本（不是 v1 的逐章累加）：12 章 × 3000 字
  const measured = novelRecipe.estimate({ chapters: 12, wordsPerChapter: 3000, autoReview: true })
  assert.equal(measured.calls, 49)
  assert.equal(measured.estTokensIn, 210987)
  assert.equal(measured.estTokensOut, 75249)

  // 章数上限 3000、单章字数下限 800；超过 40 卷会被压回 40 卷。
  const clamped = novelRecipe.estimate({ chapters: 99999, wordsPerChapter: 1 })
  assert.equal(clamped.chapters, 3000)
  assert.equal(clamped.volumePlans, 40)
  assert.match(clamped.note, /3000 章 × 800 字/)
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

test('normalizeOutline：章节缺 when/where/conflict/turn/hook/pov/cast 仍能解析', () => {
  const outline = normalizeOutline({
    volumes: [{ title: '卷一', purpose: 'p', chapters: [{ title: '起', goal: 'g', cast: null }] }],
  })
  const chapter = outline.chapters[0]
  assert.equal(outline.totalChapters, 1)
  assert.equal(chapter.title, '起')
  assert.equal(chapter.goal, 'g')
  assert.equal(chapter.conflict, '')
  assert.equal(chapter.turn, '')
  assert.equal(chapter.hook, '')
  assert.equal(chapter.pov, '')
  assert.equal(chapter.when, '')
  assert.equal(chapter.where, '')
  assert.deepEqual(chapter.cast, [])
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

test('extractJson 能救回推理前缀、注释与尾逗号，并区分「被截断」', () => {
  // 推理模型常在 JSON 前写一段带大括号的思考：不能从第一个 { 开始截
  assert.deepEqual(extractJson('我先想想 {真假难辨}，然后：\n{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('{"a":1,}'), { a: 1 })
  assert.deepEqual(extractJson('{\n  // 这是注释\n  "a": [1,2,],\n}'), { a: [1, 2] })
  // 正文里带逗号加花括号的字符串不能被改坏
  assert.deepEqual(extractJson('{"say":"他说,}"}'), { say: '他说,}' })

  assert.equal(looksCutJson('{"a":[1,2]'), true)
  assert.equal(looksCutJson('{"a":[1,2]}\n'), false)
  assert.equal(looksCutJson('{"a":"未闭合的引号'), true)
  assert.equal(looksCutJson('完全不是 JSON'), false)
})

test('salvageScenes 只收写完的场，重排编号，救不出时返回空数组', () => {
  const scenes = sampleBeats('ch07').scenes
  const raw = `{"title":"x","scenes":[${JSON.stringify(scenes[0])},{"no":2,"where":"殡`
  const salvaged = salvageScenes(raw)
  assert.equal(salvaged.length, 1)
  assert.equal(salvaged[0].no, 1)
  assert.equal(salvageScenes('抱歉，写不了').length, 0)
  assert.equal(salvageScenes('{"title":"x","scenes":[]}').length, 0)
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

test('premise：缺软字段降级成空串，缺 logline / 非 JSON 才失败', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  // 软字段缺失不该让整段已付费的调用作废（模型少写 theme/promise 很常见）
  const missing = createFakeCtx({ outputs: [jsonOut({ logline: '只有一句话' })] })
  const soft = await stageOf(recipe, 'premise').run(missing)
  assert.equal(soft.artifacts.brief.content.logline, '只有一句话')
  assert.equal(soft.artifacts.brief.content.theme, '')
  assert.equal(soft.artifacts.brief.content.title, '未命名')

  // logline 是这一阶段的唯一硬产出，空着就等于没写
  const noLogline = createFakeCtx({ outputs: [jsonOut({ title: '无名' })] })
  await assertRejectsCode(stageOf(recipe, 'premise').run(noLogline))

  const notJson = createFakeCtx({ outputs: [textOut('这不是 JSON')] })
  const error = await assertRejectsCode(stageOf(recipe, 'premise').run(notJson))
  assert.ok('raw' in error.detail)
})

test('bible / characters / spine：文本补标题，JSON 过 schema 并按卷计划对齐', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })

  const bibleCtx = createFakeCtx({ outputs: [textOut('殡仪馆有头七回魂的规矩。')] })
  const bible = await stageOf(recipe, 'bible').run(bibleCtx)
  assert.ok(bible.artifacts.bible.content.startsWith('# 世界设定'))

  const charactersCtx = createFakeCtx({ outputs: [jsonOut(sampleCharacters())] })
  const characters = await stageOf(recipe, 'characters').run(charactersCtx)
  assert.equal(characters.artifacts.characters.content.cast.length, 2)

  // §12：spine 是 JSON，卷数由脚本的卷计划决定（6 章 / 每卷 30 → 1 卷），模型只能填内容。
  const spineCtx = createFakeCtx({ outputs: [jsonOut(sampleSpine(3))] })
  const spine = await stageOf(recipe, 'spine').run(spineCtx)
  const data = spine.artifacts.spine.content
  assert.equal(data.version, 2)
  assert.equal(data.volumes.length, 1, '模型多给的卷必须按卷计划裁掉')
  assert.equal(data.volumes[0].id, 'v01')
  assert.equal(data.volumes[0].targetChapters, 6)
  assert.match(spine.note, /模型多给 2 卷，已按卷计划裁掉/)
})

test('spine stage：JSON 写到一半被截断时抬预算重试一次，而不是整段失败', async () => {
  const prompts = createScriptedPrompts({ spine: { maxTokens: 2800 } })
  const recipe = createNovelRecipe({ prompts })
  const full = JSON.stringify(sampleSpine(1))
  // 截断点落在 JSON 中间：括号/引号没配平，普通解析必然失败
  const cut = full.slice(0, Math.floor(full.length * 0.55))
  const ctx = createFakeCtx({ outputs: [textOut(cut), jsonOut(sampleSpine(1))] })
  const out = await stageOf(recipe, 'spine').run(ctx)

  assert.equal(ctx.calls.length, 2, '截断应当重试一次')
  assert.match(ctx.calls[1].user, /上一次输出没能解析成 JSON/)
  assert.ok(ctx.calls[1].maxTokens > ctx.calls[0].maxTokens, '重试应当抬预算')
  assert.equal(ctx.calls[1].json, true)
  assert.equal(out.artifacts.spine.content.volumes.length, 1)
})

test('spine stage：纯粹不是 JSON（没有截断迹象）不重试，省一次调用', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({ outputs: [textOut('抱歉，这段我不方便写。')] })
  const error = await assertRejectsCode(stageOf(recipe, 'spine').run(ctx), 'LLM_PARSE')
  assert.equal(ctx.calls.length, 1)
  assert.match(error.message, /结尾是「/)
  assert.match(error.message, /不是合法 JSON/)
})

test('outline stage：脚本搭骨架 + 一次卷纲展开，正典 v2 从 spine/brief 种下', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: {
      brief: { kind: 'json', content: sampleBrief() },
      characters: { kind: 'json', content: sampleCharacters() },
      spine: { kind: 'json', content: sampleSpine(1) },
    },
    outputs: [jsonOut(sampleVolumeChapters(6))],
  })
  const out = await stageOf(recipe, 'outline').run(ctx)
  const outline = out.artifacts.outline.content
  assert.equal(outline.version, 2)
  assert.equal(outline.totalChapters, 6)
  assert.deepEqual(outline.chapters.map((chapter) => chapter.id), ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06'])
  assert.equal(outline.volumes.length, 1)
  assert.equal(outline.volumes[0].planned, true)
  assert.equal(outline.volumes[0].targetChapters, 6)
  assert.equal(outline.chapters[0].volume, 'v01')
  // 章 id 由脚本发号：模型给的 `model-0` 之类不能进 outline。
  assert.ok(outline.chapters.every((chapter) => !String(chapter.id).startsWith('model-')))
  assert.equal(ctx.calls.length, 1, '短篇一次展开全部卷：只调一次卷纲')

  const canon = out.artifacts.canon.content
  assert.equal(canon.version, 2)
  assert.ok(canon.entities['沈砚'], '人物档案要进正典实体')
  assert.ok(canon.threads.some((thread) => thread.text === '三号柜里的手机'), 'spine.opens 要开成线索')
  assert.match(out.note, /大纲骨架 6\/6 章、1 卷（本轮展开 1 卷、1 次模型调用；正典来自 new）/)
})

test('outline stage：已有 v2 outline 时不重写，只补 canon', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = sampleOutlineV2({ chapters: 6 })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: {
      outline: { kind: 'json', content: outline },
      brief: { kind: 'json', content: sampleBrief() },
      characters: { kind: 'json', content: sampleCharacters() },
      spine: { kind: 'json', content: sampleSpine(1) },
    },
    outputs: [],
  })
  const out = await stageOf(recipe, 'outline').run(ctx)
  assert.ok(!('outline' in out.artifacts), '已展开的卷不该被重写')
  assert.equal(ctx.calls.length, 0)
  assert.match(out.note, /本轮展开 0 卷、0 次模型调用/)
  assert.equal(out.artifacts.canon.content.version, 2)
})

test('draft stage：缺细纲时先补细纲，章 id 用 item，场景顺序由 packet 决定', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = sampleOutlineV2({ chapters: 6 })
  const items = outline.chapters
  const rawBeats = sampleBeats('模型乱写的 id')
  rawBeats.scenes = rawBeats.scenes.map((scene, index) => ({ ...scene, no: 90 + index }))
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items,
    item: items[0],
    index: 0,
    artifacts: {
      outline: { kind: 'json', content: outline },
      brief: { kind: 'json', content: sampleBrief() },
      characters: { kind: 'json', content: sampleCharacters() },
    },
    outputs: [
      jsonOut(rawBeats),
      textOut(sampleProse({ canon: { facts: [{ s: '沈砚', p: '状态', o: '听见父亲的名字' }] } })),
    ],
  })
  const out = await stageOf(recipe, 'draft').run(ctx)
  const beats = out.artifacts['beats/ch01'].content
  assert.equal(beats.chapterId, 'ch01', '章节 id 以 outline 为准，不采信模型')
  assert.equal(beats.title, '起：雨夜')
  // 模型给的 no 是 90/91；packet 按数组顺序重新编号，正文材料不会错位。
  const draftPrompt = prompts.calls.find((call) => call.id === 'draft')
  assert.match(draftPrompt.ctx.packet.text, /场景 1：/)
  assert.match(draftPrompt.ctx.packet.text, /场景 2：/)
  assert.ok(draftPrompt.ctx.packet.text.indexOf('完成交接班') < draftPrompt.ctx.packet.text.indexOf('确认声音来源'))
  assert.ok(draftPrompt.ctx.packet.text.includes('停尸间'))
  assert.equal(ctx.calls.length, 2, '一次细纲 + 一次正文')
})

test('draft stage：细纲不是 JSON 时直接失败，不重试也不写半章', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = sampleOutlineV2({ chapters: 6 })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: outline.chapters,
    item: outline.chapters[0],
    index: 0,
    artifacts: { outline: { kind: 'json', content: outline } },
    outputs: [textOut('抱歉，这一段我不方便写。')],
  })
  // v0.2 把细纲并进 draft 工作单元：这里没有 callJson 的截断重试/抢救，
  // 写不出来就整章失败，宁可让 run 停下，也不写一份没细纲的正文。
  const error = await assertRejectsCode(stageOf(recipe, 'draft').run(ctx), 'LLM_PARSE')
  assert.match(error.message, /第 ch01 章细纲：模型没有返回 JSON 对象/)
  assert.equal(ctx.calls.length, 1, '非 JSON 不重试，省一次调用')
  assert.equal(ctx.has('draft/ch01'), false, '失败的章不能落半份稿')
  assert.equal(ctx.has('summary/ch01'), false)
})

test('draft stage：细纲 JSON 被截断时同样整章失败（不再抢救半份细纲）', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = sampleOutlineV2({ chapters: 6 })
  const full = JSON.stringify(sampleBeats('ch01'))
  const cut = full.slice(0, Math.floor(full.length * 0.55))
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: outline.chapters,
    item: outline.chapters[0],
    index: 0,
    artifacts: { outline: { kind: 'json', content: outline } },
    outputs: [textOut(cut)],
  })
  const error = await assertRejectsCode(stageOf(recipe, 'draft').run(ctx), 'LLM_PARSE')
  assert.match(error.message, /细纲/)
  assert.equal(ctx.calls.length, 1, 'v0.2 的细纲生成没有截断重试')
  assert.equal(ctx.has('draft/ch01'), false)
})

test('人物档案：每个角色都带性别，主角代词在全链路可查', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: {
      brief: { kind: 'json', content: sampleBrief() },
      bible: { kind: 'md', content: '# 世界设定' },
    },
    outputs: [jsonOut(sampleCharacters())],
  })
  const out = await stageOf(recipe, 'characters').run(ctx)
  assert.equal(out.artifacts.characters.content.cast[0].gender, '男', 'gender 不能被 schema 剥掉')
  assert.equal(out.artifacts.characters.content.cast[1].gender, '女')

  const prompt = prompts.calls.find((call) => call.id === 'characters')
  assert.ok(prompt, 'characters prompt 被调用过')
  const charsPrompt = createPrompts().characters(createFakeCtx({ params: { ...SAMPLE_PARAMS } }))
  assert.match(charsPrompt.user, /性别与代词/)
  assert.match(charsPrompt.user, /cast\[\]\.gender/)
  assert.match(charsPrompt.user, /"gender": "女"/, '示例里必须示范性别写法')
  assert.match(charsPrompt.user, /用户没有指定主角性别/, 'auto 时交给模型定')
})

test('主角性别参数：女/男 变成硬约束，auto 不约束', () => {
  const prompts = createPrompts()
  const female = prompts.characters(
    createFakeCtx({ params: { ...SAMPLE_PARAMS, protagonistGender: '女' } })
  )
  assert.match(female.user, /用户已指定主角性别为「女」/)
  assert.match(female.user, /代词固定用「她」/)
  const male = prompts.characters(
    createFakeCtx({ params: { ...SAMPLE_PARAMS, protagonistGender: '男' } })
  )
  assert.match(male.user, /代词固定用「他」/)
})

test('人物档案缺性别时留一条 warn，不阻断', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const cast = sampleCharacters()
  delete cast.cast[0].gender
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: { brief: { kind: 'json', content: sampleBrief() } },
    outputs: [jsonOut(cast)],
  })
  const out = await stageOf(recipe, 'characters').run(ctx)
  assert.ok(out.artifacts.characters, '没写性别也要落盘')
  assert.ok(
    ctx.warns.some((message) => /缺少性别/.test(message) && message.includes('沈砚')),
    `应以 warn 级别记录缺性别，实际：${JSON.stringify(ctx.warns)}`
  )
})

test('人物档案：模型写「主人公」时归一化成「主角」，主角保护与代词检查才认得出', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const cast = sampleCharacters()
  cast.cast[0].role = '主人公'
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: { brief: { kind: 'json', content: sampleBrief() } },
    outputs: [jsonOut(cast)],
  })
  const out = await stageOf(recipe, 'characters').run(ctx)
  assert.equal(out.artifacts.characters.content.cast[0].role, '主角')
})

test('人物档案：模型没标主角时把第一位当主角，并说明原因', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const cast = sampleCharacters()
  for (const member of cast.cast) member.role = '配角'
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    artifacts: { brief: { kind: 'json', content: sampleBrief() } },
    outputs: [jsonOut(cast)],
  })
  const out = await stageOf(recipe, 'characters').run(ctx)
  assert.equal(out.artifacts.characters.content.cast[0].role, '主角')
  assert.match(String(out.note ?? ''), /没标主角/)
})

test('人物档案：项目里定死的性别优先于模型，改回并写进 note', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const cast = sampleCharacters()
  cast.cast[0].gender = '男'
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS, protagonistGender: '女' },
    artifacts: { brief: { kind: 'json', content: sampleBrief() } },
    outputs: [jsonOut(cast)],
  })
  const out = await stageOf(recipe, 'characters').run(ctx)
  assert.equal(out.artifacts.characters.content.cast[0].gender, '女')
  assert.match(String(out.note ?? ''), /主角性别按你的选择定为「女」/)
})

test('代词对照：草稿拿到结构化人物速查，审校/修订 prompt 带每个人物的代词', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = normalizeOutline(sampleVolumeOutline())
  const items = outline.chapters
  const base = {
    outline: { kind: 'json', content: outline },
    brief: { kind: 'json', content: sampleBrief() },
    characters: { kind: 'json', content: sampleCharacters() },
    ledger: { kind: 'json', content: sampleLedger() },
    'beats/ch01': { kind: 'json', content: sampleBeats() },
    'draft/ch01': { kind: 'md', content: '## 第1章 起：雨夜\n\n旧正文。' },
  }
  const draftCtx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items,
    item: items[0],
    index: 0,
    artifacts: base,
    outputs: [textOut(sampleProse())],
  })
  await stageOf(recipe, 'draft').run(draftCtx)
  const draftPrompt = prompts.calls.find((call) => call.id === 'draft')
  assert.ok(draftPrompt, 'draft prompt 被调用')
  // v0.2：draft 的 user 就是 packet；人物速查按「名字 · 性别 · 角色」给，不再单列代词表。
  assert.match(draftPrompt.ctx.packet.text, /沈砚 · 男 · 主角/)
  assert.match(draftPrompt.ctx.packet.text, /阿绫 · 女 · 关键配角/)

  const reviewPrompt = createPrompts().review(
    createFakeCtx({
      params: { ...SAMPLE_PARAMS },
      items,
      item: items[0],
      index: 0,
      artifacts: base,
    })
  )
  assert.match(reviewPrompt.user, /代词对照/)
  assert.match(reviewPrompt.user, /沈砚＝「他」（男，主角）/)
  assert.match(reviewPrompt.user, /阿绫＝「她」（女，关键配角）/)
  assert.match(reviewPrompt.user, /性别/, '审校契约要允许「性别」这个 kind')

  const revisePrompt = createPrompts().revise(
    createFakeCtx({
      params: { ...SAMPLE_PARAMS },
      items,
      item: items[0],
      index: 0,
      artifacts: base,
    })
  )
  assert.match(revisePrompt.user, /代词对照/)
  assert.match(revisePrompt.user, /按【代词对照】统一/)
})

test('draft stage：正文、摘要、正典补丁同一枪返回时只调一次文本模型', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = sampleOutlineV2({ chapters: 6 })
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
      textOut(
        sampleProse({
          body: '以下是正文：\n\n## 第9章 旧标题\n\n雨下得很大。\n\n“你来了。”她说。',
          canon: { facts: [{ s: '沈砚', p: '状态', o: '听见父亲的名字' }] },
        }),
      ),
    ],
  })
  const out = await stageOf(recipe, 'draft').run(ctx)
  const draft = out.artifacts['draft/ch01'].content
  assert.ok(draft.startsWith('## 第1章 起：雨夜'))
  assert.ok(!draft.includes('第9章'))
  assert.ok(!draft.includes('<<<SUMMARY>>>'))
  assert.ok(!draft.includes('<<<CANON>>>'))
  assert.ok(draft.includes('雨下得很大。'))
  assert.ok(out.artifacts['summary/ch01'].content.startsWith('发生：沈砚在雨夜见到回魂'))
  // 正文/摘要/正典补丁一次拿全（细纲已在产物里）：只剩 1 次文本调用。
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].json, false)
  assert.equal(ctx.calls[0].phase, 'prose')
  assert.equal(ctx.calls[0].maxTokens, Math.round(1200 * 2.2) + 400)
  const canon = out.artifacts.canon.content
  assert.ok(canon.facts.some((fact) => fact.o === '听见父亲的名字'), '内联 CANON 要并进正典 v2')
  // packet 里带着本章细纲（v2 的喂料入口，不再是 v1 的 ctx.materials）
  const draftPrompt = prompts.calls.find((call) => call.id === 'draft')
  assert.ok(draftPrompt.ctx.packet.text.includes('停尸间'))
  assert.match(draftPrompt.ctx.packet.text, /场景 1：/)
})

test('draft stage：模型没按格式给摘要时回退独立摘要调用', async () => {
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
      textOut(
        sampleProse({
          body: '以下是正文：\n\n## 第9章 旧标题\n\n雨下得很大。\n\n“你来了。”她说。',
          summary: null,
          canon: { notes: [{ text: '换班在凌晨三点' }] },
        }),
      ),
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
  assert.equal(ctx.calls[1].phase, 'summary')
  const summaryPrompt = prompts.calls.find((call) => call.id === 'summary')
  assert.equal(summaryPrompt.ctx.draft, draft, 'v2 的摘要上下文键是 ctx.draft')
  assert.ok(summaryPrompt.ctx.beats, '摘要调用也能拿到本章细纲')
})

test('draft stage：摘要调用失败时正文仍落盘，用自动摘要兜底', async () => {
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
      textOut(
        sampleProse({
          body: '## 第1章 起：雨夜\n\n雨下得很大。\n\n“你来了。”她说。',
          summary: null,
          canon: { facts: [{ s: '沈砚', p: '状态', o: '听见父亲的名字' }] },
        }),
      ),
      () => {
        const error = new Error('模型返回了空文本')
        error.code = 'LLM_EMPTY'
        throw error
      },
    ],
  })
  const out = await stageOf(recipe, 'draft').run(ctx)
  // 正文那一次已经付过费，不能因为摘要失败整章丢弃
  assert.ok(out.artifacts['draft/ch01'].content.includes('雨下得很大。'))
  assert.match(out.artifacts['summary/ch01'].content, /^自动摘要（摘要调用失败）：/)
  assert.equal(ctx.calls.length, 2)
})

test('draft stage：上一章 summary、上一章钩子与下一章目标进入 packet', async () => {
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
    outputs: [textOut(sampleProse({ body: '第二章正文，雨停了。', summary: null })), textOut('第二章摘要。')],
  })
  const out = await stageOf(recipe, 'draft').run(ctx)
  assert.ok(out.artifacts['draft/ch02'].content.startsWith('## 第2章 承：旧照片'))
  const draftPrompt = prompts.calls.find((call) => call.id === 'draft')
  const packetText = draftPrompt.ctx.packet.text
  assert.match(packetText, /沈砚听见父亲的名字/)
  assert.match(packetText, /钩子：门外站着的是谁/)
  assert.match(packetText, /下一章目标[\s\S]*真相逼近/)
  assert.match(packetText, /本章目标：沈砚开始查父亲旧案|沈砚开始查父亲旧案/)
})

test('draft stage：正文为空抛 LLM_PARSE', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = sampleOutlineV2({ chapters: 6 })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    item: outline.chapters[0],
    items: outline.chapters,
    artifacts: {
      outline: { kind: 'json', content: outline },
      'beats/ch01': { kind: 'json', content: sampleBeats() },
    },
    outputs: [textOut('   ')],
  })
  const error = await assertRejectsCode(stageOf(recipe, 'draft').run(ctx), 'LLM_PARSE')
  assert.match(error.message, /第 1 章正文为空/)
  assert.equal(ctx.calls.length, 1, '空正文不重试')
  assert.equal(ctx.has('draft/ch01'), false)
})

test('summary prompt：正文从 ctx.draft 取，不再退化成「正文缺失」', async () => {
  const real = createPrompts()
  const outline = normalizeOutline(sampleVolumeOutline())
  const items = outline.chapters
  const firstLine = '雨落在灵堂的玻璃上，像有人用指甲一下一下地敲。'
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items,
    item: items[0],
    index: 0,
  })
  // draft/ch01 还没进产物缓存（同一 stage.run 内），正文只能由调用方挂在上下文里。
  const promptCtx = Object.assign(Object.create(ctx), { draft: firstLine })
  const direct = real.summary(promptCtx).user
  assert.ok(direct.includes(firstLine))
  assert.ok(!direct.includes('正文缺失'))

  const seen = []
  const recipe = createNovelRecipe({
    prompts: {
      ...real,
      summary: (summaryCtx) => {
        const spec = real.summary(summaryCtx)
        seen.push(spec)
        return spec
      },
    },
  })
  const runCtx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items,
    item: items[0],
    index: 0,
    artifacts: { 'beats/ch01': { kind: 'json', content: sampleBeats() } },
    outputs: [textOut(firstLine), textOut('第一章摘要。')],
  })
  await stageOf(recipe, 'draft').run(runCtx)
  assert.equal(seen.length, 1)
  assert.ok(seen[0].user.includes(firstLine))
  assert.ok(!seen[0].user.includes('正文缺失'))
})

test('review stage：LLM findings 与 craft 合并、排序、算 verdict、写回 canon', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const artifacts = {
    ledger: { kind: 'json', content: sampleLedger() },
    'draft/ch01': {
      kind: 'md',
      content: '## 第1章 起\n\n他仿佛看见了什么。似乎有人。不禁后退。',
    },
    'beats/ch01': { kind: 'json', content: sampleBeats() },
  }
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起：雨夜', hook: '门外站着的是谁' }],
    item: { id: 'ch01', title: '起：雨夜', hook: '门外站着的是谁' },
    artifacts,
    outputs: [
      jsonOut({
        findings: [
          { severity: 'note', kind: 'style', where: 'ch01', issue: '比喻略多', fix: '删一处' },
          { severity: 'block', kind: 'logic', where: 'ch01', issue: '时间线矛盾', fix: '调整顺序' },
        ],
        canonPatch: {
          facts: [{ s: '沈砚', p: '父亲', o: '停尸间的尸体' }],
          notes: [{ text: '停尸间的尸体是沈砚的父亲' }],
          threads: [{ text: '门外站着的是谁', status: 'closed' }],
          entities: { 沈砚: { location: '停尸间', knows: ['父亲已死'] } },
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
  assert.ok(!('ledger' in out.artifacts), 'v0.2 不再写 ledger')

  const canon = out.artifacts.canon.content
  assert.equal(canon.version, 2)
  assert.ok(canon.facts.some((fact) => fact.o === '停尸间的尸体'), '三元组进 facts')
  assert.ok(canon.notes.some((note) => note.text === '停尸间的尸体是沈砚的父亲'), '自由文本进 notes（§4.1）')
  assert.equal(canon.threads.find((thread) => thread.text.includes('门外站着的是谁')).status, 'closed')
  assert.equal(canon.entities['沈砚'].location, '停尸间')
  assert.ok(canon.entities['沈砚'].knows.includes('头七回魂存在'), '局部更新不能丢旧字段')
  assert.ok(canon.entities['沈砚'].knows.includes('父亲已死'))
  assert.ok(canon.timeline.some((entry) => entry.event === '沈砚听见敲击声'))

  // v1 的 ledgerPatch 字段仍然被消费：旧工程/旧模型输出不该在升级后静默丢补丁。
  const legacy = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起：雨夜' }],
    item: { id: 'ch01', title: '起：雨夜' },
    artifacts,
    outputs: [jsonOut({ findings: [], ledgerPatch: { characters: { 沈砚: { location: '值班室' } } } })],
  })
  const legacyOut = await stageOf(recipe, 'review').run(legacy)
  assert.equal(legacyOut.artifacts.canon.content.entities['沈砚'].location, '值班室')
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

test('review stage：无 canonPatch 时不写 canon，全 note 时 verdict=pass', async () => {
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
        canonPatch: {},
        verdict: 'pass',
      }),
    ],
  })
  const out = await stageOf(recipe, 'review').run(ctx)
  assert.ok(!('canon' in out.artifacts))
  assert.equal(out.artifacts['review/ch01'].content.verdict, 'pass')
})

test('review stage：verdict 规则为 block>0 或 warn≥3（2 warn→pass，3 warn→revise）', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const text = Array.from({ length: 15 }, () => '“走吧。”他说。').join('\n\n')
  const verdictOf = async (warns, verdict) => {
    const ctx = createFakeCtx({
      params: { ...SAMPLE_PARAMS, wordsPerChapter: 60, pov: '第三人称全知' },
      items: [{ id: 'ch01', title: '起' }],
      item: { id: 'ch01', title: '起' },
      artifacts: { 'draft/ch01': { kind: 'md', content: text } },
      outputs: [
        jsonOut({
          findings: Array.from({ length: warns }, (_, index) => ({
            severity: 'warn',
            kind: 'pacing',
            where: `第${index + 1}段`,
            issue: '节奏拖',
            fix: '删一句',
          })),
          ...(verdict ? { verdict } : {}),
        }),
      ],
    })
    const out = await stageOf(recipe, 'review').run(ctx)
    return out.artifacts['review/ch01'].content.verdict
  }
  assert.equal(await verdictOf(2, 'revise'), 'pass') // 模型说 revise 也不算数：2 条 warn 不够
  assert.equal(await verdictOf(3), 'revise') // verdict 缺失 → 按 warn 计数推断
})

test('review stage：缺 canonPatch 不丢 findings；整份不合契约时也抢救 findings', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const finding = { severity: 'warn', kind: '知情', where: '第 2 段', issue: '周迟说了他还不该知道的事', fix: '改成试探性问法' }
  const makeCtx = (output) =>
    createFakeCtx({
      params: { ...SAMPLE_PARAMS, pov: '第三人称全知' },
      items: [{ id: 'ch01', title: '起' }],
      item: { id: 'ch01', title: '起' },
      artifacts: {
        'draft/ch01': { kind: 'md', content: '## 第1章 起\n\n他仿佛看见了什么。似乎有人。不禁后退。' },
      },
      outputs: [jsonOut(output)],
    })

  // 只漏 canonPatch / verdict：不算降级，findings 完整保留，canon 不写。
  const partial = makeCtx({ findings: [finding] })
  const partialOut = await stageOf(recipe, 'review').run(partial)
  const partialReview = partialOut.artifacts['review/ch01'].content
  assert.ok(partialReview.findings.some((item) => item.where === '第 2 段'))
  assert.ok(!partialOut.note.includes('仅保留确定性检查'))
  assert.ok(!('canon' in partialOut.artifacts))

  // verdict 取值非法 → 整份解析失败，降级路径仍要保住已给的 findings。
  const broken = makeCtx({ findings: [finding], verdict: 'maybe' })
  const brokenOut = await stageOf(recipe, 'review').run(broken)
  const brokenReview = brokenOut.artifacts['review/ch01'].content
  assert.ok(brokenReview.findings.some((item) => item.where === '第 2 段'))
  assert.ok(brokenOut.note.includes('仅保留确定性检查'))
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

test('review stage：没有正文时跳过审校，不花一次调用', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const outline = normalizeOutline(sampleVolumeOutline())
  const item = outline.chapters[0]
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: outline.chapters,
    item,
    index: 0,
    artifacts: {
      outline: { kind: 'json', content: outline },
      brief: { kind: 'json', content: sampleBrief() },
      characters: { kind: 'json', content: sampleCharacters() },
      ledger: { kind: 'json', content: sampleLedger() },
    },
    outputs: [],
  })
  const out = await stageOf(recipe, 'review').run(ctx)
  assert.deepEqual(out.artifacts, {})
  assert.match(out.note, /还没有正文/)
  assert.equal(ctx.calls.length, 0, '没有正文就不要调模型')
})

test('revise stage：正文是「正文缺失」这类占位符时跳过，不覆盖原产物', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch02', title: '承：旧照片' }],
    item: { id: 'ch02', title: '承：旧照片' },
    artifacts: {
      'draft/ch02': { kind: 'md', content: '正文缺失，无法修订' },
      'review/ch02': {
        kind: 'json',
        content: {
          findings: [{ severity: 'block', kind: 'logic', where: 'ch02', issue: '时间线矛盾', fix: '调整顺序' }],
          ledgerPatch: {},
          verdict: 'revise',
        },
      },
      ledger: { kind: 'json', content: sampleLedger() },
    },
    outputs: [],
  })
  const out = await stageOf(recipe, 'revise').run(ctx)
  assert.deepEqual(out.artifacts, {}, '占位稿不能被当成正文再去修订')
  assert.match(out.note, /还没有正文/)
  assert.equal(ctx.calls.length, 0)
})

test('isPlaceholderText 只认占位符，不误伤正常正文', () => {
  assert.equal(isPlaceholderText('正文缺失，无法修订'), true)
  assert.equal(isPlaceholderText('发生：正文缺失，无法摘要'), true)
  assert.equal(isPlaceholderText('（正文缺失：请在输出里写"正文缺失，无法摘要"，不要编造。）'), true)
  assert.equal(isPlaceholderText('# 第1章\n\n他真的读到过「正文缺失」这个说法，' + '雨'.repeat(400)), false)
  assert.equal(isPlaceholderText(''), false)
})

test('revise stage：有 block 时重写 draft + summary，findings 传入 prompt', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起：雨夜' }],
    item: { id: 'ch01', title: '起：雨夜' },
    artifacts: {
      'draft/ch01': { kind: 'md', content: '## 第1章 起：雨夜\n\n旧正文一段。' },
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
    outputs: [textOut('## 第1章 起：雨夜\n\n修订后正文。'), textOut('修订后的摘要。')],
  })
  const out = await stageOf(recipe, 'revise').run(ctx)
  assert.ok(out.artifacts['draft/ch01'].content.includes('修订后正文'))
  assert.equal(out.artifacts['summary/ch01'].content, '修订后的摘要。')
  assert.equal(ctx.calls.length, 2)
  assert.equal(ctx.calls[0].phase, 'revise')
  const revisePrompt = prompts.calls.find((call) => call.id === 'revise')
  assert.equal(revisePrompt.ctx.findings.length, 1)
  assert.ok(revisePrompt.ctx.draftText.includes('旧正文'))
})

test('revise stage：修订稿长度异常时抛 LLM_PARSE，不覆盖原正文', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const oldDraft = `## 第1章 起：雨夜\n\n${'雨落在灵堂的玻璃上。'.repeat(12)}`
  const ctx = createFakeCtx({
    params: { ...SAMPLE_PARAMS },
    items: [{ id: 'ch01', title: '起：雨夜' }],
    item: { id: 'ch01', title: '起：雨夜' },
    artifacts: {
      'draft/ch01': { kind: 'md', content: oldDraft },
      'review/ch01': {
        kind: 'json',
        content: {
          findings: [{ severity: 'block', kind: 'logic', where: 'ch01', issue: '时间线矛盾', fix: '调整顺序' }],
          ledgerPatch: {},
          verdict: 'revise',
        },
      },
    },
    // 模型只回了一段（8 字 vs 113 字）：整章不能被这段碎片替换。
    outputs: [textOut('## 第1章 起：雨夜\n\n雨停了。')],
  })
  const error = await assertRejectsCode(stageOf(recipe, 'revise').run(ctx))
  assert.match(error.message, /修订稿长度异常/)
  assert.match(error.message, /原 \d+ 字 → 新 \d+ 字/)
  assert.match(error.message, /已丢弃未落盘/)
  assert.equal(ctx._store.get('draft/ch01').content, oldDraft)
  assert.equal(ctx.calls.length, 1)
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
  // §12：12 个 builder；v0.2 删掉 outline（骨架由脚本搭），新增 volumeChapters / canonPatch。
  assert.equal(PROMISE_IDS.length, 12)
  assert.deepEqual(Object.keys(createPrompts()).sort(), [...PROMISE_IDS].sort())
  assert.equal('outline' in createPrompts(), false)
  assert.equal(typeof createPrompts().volumeChapters, 'function')
  assert.equal(typeof createPrompts().canonPatch, 'function')
})
