// test/longform-create.test.mjs — v0.3 网文长篇新建：参数面、材料包、卷纲字段、canon 排期。
// 不调真模型；所有断言都能在 CI 里确定复现。
import test from 'node:test'
import assert from 'node:assert/strict'

import { createNovelRecipe, paramsSchema, novelRecipe } from '../src/recipes/novel/index.js'
import { createScriptedPrompts, createFakeCtx, sampleOpener, sampleSpine, sampleBrief, sampleOutlineV2, SAMPLE_PARAMS as PARAMS } from './fixtures/novel-fixtures.mjs'
import { buildPacket } from '../src/recipes/novel/packet.js'
import { buildOutlineSkeleton, mergeVolumeChapters } from '../src/recipes/novel/plan.js'
import { createCanon, queryCanon, formatCanon, mergeCanon, emptyCanon } from '../src/recipes/novel/canon.js'
import { SAMPLE_PARAMS } from './fixtures/novel-fixtures.mjs'

const recipe = createNovelRecipe({ prompts: {} })

test('A1 estimate：300 章 10 卷 = 1067 次调用（固定 7 + 每章 3.5 + 每卷 1）', () => {
  const est = recipe.estimate({ chapters: 300, chaptersPerVolume: 30, autoReview: true })
  assert.equal(est.calls, 1067)
  const noReview = recipe.estimate({ chapters: 300, chaptersPerVolume: 30, autoReview: false })
  assert.equal(noReview.calls, Math.ceil(7 + 300 * 2.5 + 10))
})

test('A2 产物表含 pitch / opener，kind 都是 json', () => {
  for (const key of ['pitch', 'opener']) {
    assert.ok(recipe.artifacts[key], `缺失产物 ${key}`)
    assert.equal(recipe.artifacts[key].kind, 'json')
    assert.ok(recipe.artifacts[key].title)
  }
})

test('A3 参数面：8 个网文参数可校验，未知字段仍被拒', () => {
  const ok = paramsSchema.properties
  for (const key of ['channel', 'platform', 'tags', 'sellingPoint', 'comps', 'updateCadence', 'goldenFinger', 'chaptersPerVolume']) {
    assert.ok(ok[key], `参数 schema 缺少 ${key}`)
  }
  // additionalProperties:false：拼错的字段必须报错，否则静默丢弃是最难查的 bug。
  const schema = { ...paramsSchema, required: ['premise'] }
  const bad = { premise: '一个在殡仪馆值夜班的年轻人。', chanel: '男频' }
  const check = validate(schema, bad)
  assert.equal(check.valid, false)
  const good = { ...SAMPLE_PARAMS }
  assert.equal(validate(schema, good).valid, true)
})

// 极简 JSON Schema 校验：只覆盖本测试用到的 type/enum/required/additionalProperties/maxLength/minimum。
function validate(schema, value) {
  const errors = []
  const walk = (node, data, path) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'object') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        errors.push(`${path} 不是对象`)
        return
      }
      for (const key of node.required ?? []) if (data[key] === undefined) errors.push(`${path}.${key} 必填`)
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (data[key] !== undefined) walk(child, data[key], `${path}.${key}`)
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(data)) {
          if (!(key in (node.properties ?? {}))) errors.push(`${path}.${key} 未知字段`)
        }
      }
      return
    }
    if (node.type === 'integer' && !Number.isInteger(data)) errors.push(`${path} 不是整数`)
    if (node.type === 'string' && typeof data !== 'string') errors.push(`${path} 不是字符串`)
    if (node.enum && !node.enum.includes(data)) errors.push(`${path} 不在枚举内`)
    if (node.maxLength && String(data).length > node.maxLength) errors.push(`${path} 超长`)
    if (node.minimum !== undefined && Number(data) < node.minimum) errors.push(`${path} 过小`)
  }
  walk(schema, value, '$')
  return { valid: errors.length === 0, errors }
}

test('A4 packet：world 片含「力量与规则」，pitch 片进材料，总长仍 ≤ budget', () => {
  const packet = buildPacket({
    params: { ...SAMPLE_PARAMS, contextBudget: 4000 },
    chapter: { id: 'ch0001', index: 1, title: '头七', goal: '他要在冷柜里找出少掉的那具', words: 3000 },
    beats: { goal: '守夜', conflict: '多了一具尸体', turn: '尸体坐起来', hook: '它叫出他的名字' },
    worldBrief: '## 力量与规则\n死者头七能回来，但只能回答三个问题，每次回答都要用活人的记忆交换。',
    pitchText: '频道：男频\n卖点：给死人守夜的人，靠头七的规矩活命。\n金手指：听得见死者最后一句话',
  })
  assert.match(packet.text, /## 世界规则/)
  assert.ok(packet.sections.world.includes('## 力量与规则'))
  assert.ok(packet.sections.pitch.includes('头七的规矩'))
  assert.ok(packet.text.length <= 4000)
})

test('A5 packet 回归：不给 world/pitch 时仍是原来的九片，不凭空多出空块', () => {
  const packet = buildPacket({
    params: SAMPLE_PARAMS,
    chapter: { id: 'ch0001', index: 1, title: '头七', goal: '守夜', words: 1200 },
    beats: { goal: '守夜', conflict: '多一具尸体', turn: '它睁眼', hook: '它叫他' },
  })
  // 只装真实有内容的片；没有 world/pitch 时不应凭空多出空块。
  assert.equal(packet.sections.world, undefined)
  assert.equal(packet.sections.pitch, undefined)
  assert.deepEqual(Object.keys(packet.sections).sort(), ['beats', 'brief', 'style'])
  assert.ok(packet.text.length <= 12000, '默认 contextBudget 下包体不得越界')
})

test('A6 卷纲：骨架带 payoffs/cliffhanger/unitArcs，章级新字段在合并后不丢', () => {
  const spine = {
    volumes: [
      {
        title: '第一卷',
        goal: '他学会规矩',
        opens: [{ text: '母亲的死因', dueIn: 12 }, '殡仪馆的旧账'],
        payoffs: [{ atChapter: 10, level: 'large', text: '他第一次用规矩换回一条命' }],
        cliffhanger: '冷柜里多出一具他不认识的尸体',
        unitArcs: ['守夜人身份', '母亲遗物'],
      },
    ],
  }
  const outline = buildOutlineSkeleton({ chapters: 30, chaptersPerVolume: 30, spine })
  const volume = outline.volumes[0]
  assert.deepEqual(volume.payoffs, [{ atChapter: 10, level: 'large', text: '他第一次用规矩换回一条命' }])
  assert.equal(volume.cliffhanger, '冷柜里多出一具他不认识的尸体')
  assert.deepEqual(volume.unitArcs, ['守夜人身份', '母亲遗物'])

  const merged = mergeVolumeChapters(outline, 'v01', [
    {
      title: '头七',
      goal: '守夜',
      conflict: '多一具尸体',
      turn: '它睁眼',
      hook: '它叫他',
      hookType: '危机',
      hookStrength: 5,
      payoff: { level: 'small', text: '他用一句行话镇住了它' },
      infoDrop: { readerLearns: '头七的规矩能约束死者', characterLoses: '他不记得母亲的脸' },
      track: 'both',
      unitArc: '守夜人身份',
      threadDue: ['母亲的死因'],
    },
  ])
  const chapter = merged.chapters[0]
  assert.equal(chapter.hookType, '危机')
  assert.equal(chapter.hookStrength, 5)
  assert.deepEqual(chapter.payoff, { level: 'small', text: '他用一句行话镇住了它' })
  assert.deepEqual(chapter.infoDrop, {
    readerLearns: '头七的规矩能约束死者',
    characterLoses: '他不记得母亲的脸',
  })
  assert.equal(chapter.track, 'both')
  assert.deepEqual(chapter.threadDue, ['母亲的死因'])
})

test('A7 canon：opens 的 dueIn 落库，缺省用开线卷末章；到期线索进材料并渲染 due 标记', () => {
  const spine = {
    volumes: [
      { id: 'v01', title: '一', targetChapters: 10, opens: [{ text: '母亲的死因', dueIn: 4 }, '旧账'] },
      { id: 'v02', title: '二', targetChapters: 10, opens: ['雨夜的电话'] },
    ],
  }
  const canon = createCanon({ params: { pov: '第三人称限知' }, spine })
  const mother = canon.threads.find((thread) => thread.text === '母亲的死因')
  assert.equal(mother.dueIn, 4)
  assert.equal(mother.payoffLevel, 'small')
  const ledger = canon.threads.find((thread) => thread.text === '旧账')
  assert.equal(ledger.dueIn, 10, '缺省 dueIn 应等于开线卷末章')
  const phone = canon.threads.find((thread) => thread.text === '雨夜的电话')
  assert.equal(phone.dueIn, 20)

  const slice = queryCanon(canon, { atChapter: 4, limit: 20 })
  assert.ok(slice.threads.some((thread) => thread.text === '母亲的死因'))
  const rendered = formatCanon(slice, { maxChars: 4000 })
  assert.match(rendered, /due:ch0004/)
})

test('A8 canon 合并：新线索带 dueIn 时落库，闭合不受影响', () => {
  const base = createCanon({ params: {}, spine: { volumes: [{ id: 'v01', targetChapters: 10, opens: ['旧账'] }] } })
  const merged = mergeCanon(base, { threads: [{ text: '旧账', status: 'closed', closedIn: 'ch0007', payoff: '父亲替他还了' }] }, 'ch0007')
  const thread = merged.threads.find((item) => item.text === '旧账')
  assert.equal(thread.status, 'closed')
  assert.equal(thread.closedIn, 'ch0007')
  assert.equal(thread.dueIn, 10)
})

test('A9 默认参数：新字段有安全默认值，老项目不带这些字段也能跑', () => {
  const defaults = novelRecipe.paramsDefaults
  assert.equal(defaults.channel, '通用')
  assert.equal(defaults.platform, '未定')
  assert.equal(defaults.updateCadence, '日更')
  assert.equal(defaults.goldenFinger, '')
  assert.equal(defaults.chaptersPerVolume, 30)
  assert.equal(emptyCanon().threads.length, 0)
})

test('A10 opener 幂等：已有 opener 时再跑 outline 不再调用模型，也不覆盖已写好的章卡', async () => {
  const prompts = createScriptedPrompts()
  const recipe = createNovelRecipe({ prompts })
  const ctx = createFakeCtx({
    params: { ...PARAMS },
    artifacts: {
      brief: { kind: 'json', content: sampleBrief() },
      spine: { kind: 'json', content: sampleSpine(1) },
      outline: { kind: 'json', content: sampleOutlineV2({ chapters: 6 }) },
      opener: { kind: 'json', content: sampleOpener() },
    },
    outputs: [],
  })
  const outlineStage = recipe.stages.find((stage) => stage.id === 'outline')
  const out = await outlineStage.run(ctx)
  assert.equal(ctx.calls.length, 0, '已有 opener 不该再花一次调用，也不该重开黄金三章')
  assert.equal(out.artifacts.opener.content.chapters.length, 3)
})
