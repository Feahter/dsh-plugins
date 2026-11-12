// test/plan.test.mjs — v0.2 长篇脚本层：骨架、卷合并、v1 迁移、下一步动作。
// 只测纯函数，不调模型、不碰磁盘。
import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import {
  VOLUME_LIMIT,
  effectivePerVolume,
  volumeCount,
  volumeId,
  buildOutlineSkeleton,
  volumeById,
  volumeOfChapter,
  mergeVolumeChapters,
  isV2,
  migrateOutline,
  nextActions,
} from '../src/recipes/novel/plan.js'
import { normalizeOutline } from '../src/recipes/novel/outline.js'

function chapterList(count, prefix = '章') {
  return Array.from({ length: count }, (_, i) => ({
    title: `${prefix}${i + 1}`,
    goal: `目标${i + 1}`,
    conflict: '',
    turn: '',
    hook: '',
    pov: '第三人称',
    when: '',
    where: '',
    cast: [],
  }))
}

function v1Chapter(i) {
  return {
    id: `ch${String(i + 1).padStart(2, '0')}`,
    title: `旧章${i + 1}`,
    goal: `旧目标${i + 1}`,
    conflict: '冲突',
    turn: '转折',
    hook: '钩子',
    pov: '第三人称',
    when: `第${i + 1}天`,
    where: '城里',
    cast: ['林砚'],
  }
}

test('volumeId 从 1 开始补零', () => {
  assert.equal(volumeId(1), 'v01')
  assert.equal(volumeId(9), 'v09')
  assert.equal(volumeId(12), 'v12')
  assert.equal(volumeId(100), 'v100')
})

test('effectivePerVolume(3000,30) 抬到 75，卷数 40', () => {
  assert.equal(effectivePerVolume(3000, 30), 75)
  assert.equal(volumeCount(3000, 30), 40)
})

test('effectivePerVolume 先 clamp 10–60 再保证卷数 ≤40', () => {
  assert.equal(effectivePerVolume(100, 5), 10) // clamp 到 10，不超 40 卷
  assert.equal(effectivePerVolume(100, 100), 60) // clamp 到 60
  assert.equal(effectivePerVolume(400, 10), 10) // 正好 40 卷，不抬
  assert.equal(effectivePerVolume(401, 10), 11) // 40.1 卷 → 抬到 11
  assert.equal(volumeCount(401, 10), 37)
})

test('3000 章骨架：卷数 ≤ 40、章数守恒、无章节、全部未计划', () => {
  const outline = buildOutlineSkeleton({ chapters: 3000, chaptersPerVolume: 30, language: 'zh' })
  assert.equal(outline.version, 2)
  assert.equal(outline.totalChapters, 3000)
  assert.equal(outline.language, 'zh')
  assert.ok(outline.volumes.length <= VOLUME_LIMIT, `卷数 ${outline.volumes.length}`)
  assert.equal(outline.volumes.length, 40)
  assert.equal(
    outline.volumes.reduce((sum, volume) => sum + volume.targetChapters, 0),
    3000,
  )
  // 3000 / 40 = 75：每卷 75 章（spec 的「每卷 ≤40 章」与 40 卷内写完 3000 章不可兼得）
  for (const volume of outline.volumes) {
    assert.equal(volume.targetChapters, 75)
    assert.equal(volume.planned, false)
    assert.deepEqual(volume.chapterIds, [])
    assert.match(volume.id, /^v\d{2,}$/)
  }
  assert.deepEqual(outline.chapters, [])
})

test('3000 章 buildOutlineSkeleton < 10ms', () => {
  for (let i = 0; i < 3; i += 1) buildOutlineSkeleton({ chapters: 3000, chaptersPerVolume: 30 })
  const start = performance.now()
  const outline = buildOutlineSkeleton({ chapters: 3000, chaptersPerVolume: 30 })
  const ms = performance.now() - start
  assert.equal(outline.volumes.length, 40)
  assert.ok(ms < 10, `骨架耗时 ${ms.toFixed(3)}ms，应 <10ms`)
})

test('骨架从 spine 取卷字段，缺失时兜底', () => {
  const outline = buildOutlineSkeleton({
    chapters: 30,
    chaptersPerVolume: 10,
    spine: {
      volumes: [
        { title: '入殓', goal: '主角入行', arc: '从抗拒到接受', cast: ['林砚'], opens: ['香灰'], closes: [] },
        { title: '夜巡', goal: '发现秘密' },
      ],
    },
    language: 'zh',
  })
  assert.equal(outline.volumes.length, 3)
  assert.equal(outline.volumes[0].title, '入殓')
  assert.equal(outline.volumes[0].goal, '主角入行')
  assert.equal(outline.volumes[0].arc, '从抗拒到接受')
  assert.deepEqual(outline.volumes[0].cast, ['林砚'])
  assert.deepEqual(outline.volumes[0].opens, ['香灰'])
  assert.equal(outline.volumes[1].title, '夜巡')
  assert.equal(outline.volumes[2].title, '第 3 卷')
  assert.equal(outline.volumes[2].goal, '')
})

test('骨架按卷均分，最后一卷拿余数', () => {
  const outline = buildOutlineSkeleton({ chapters: 101, chaptersPerVolume: 30 })
  assert.equal(outline.volumes.length, 4)
  assert.deepEqual(
    outline.volumes.map((volume) => volume.targetChapters),
    [25, 25, 25, 26],
  )
})

test('mergeVolumeChapters：宽度 4、第 2 卷首章 = ch0031', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 1200, chaptersPerVolume: 30 })
  assert.equal(skeleton.volumes.length, 40)
  const first = mergeVolumeChapters(skeleton, 'v01', chapterList(30))
  assert.equal(first.chapters.length, 30)
  assert.equal(first.chapters[0].id, 'ch0001')
  assert.equal(first.chapters[29].id, 'ch0030')
  assert.equal(first.chapters[0].index, 1)
  assert.equal(first.chapters[0].volume, 'v01')
  assert.equal(first.volumes[0].planned, true)
  assert.equal(first.volumes[0].targetChapters, 30)
  assert.equal(first.volumes[0].chapterIds.length, 30)

  const second = mergeVolumeChapters(first, 'v02', chapterList(30, '二卷章'))
  assert.equal(second.chapters.length, 60)
  assert.equal(second.chapters[30].id, 'ch0031')
  assert.equal(second.chapters[30].volume, 'v02')
  assert.deepEqual(second.volumes[1].chapterIds.slice(0, 2), ['ch0031', 'ch0032'])
  assert.equal(second.volumes[1].planned, true)
})

test('mergeVolumeChapters 丢弃模型给的 id，重复调用幂等且不重复', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  const dirty = chapterList(30).map((chapter) => ({ ...chapter, id: 'ch9999' }))
  const once = mergeVolumeChapters(skeleton, 'v01', dirty)
  const twice = mergeVolumeChapters(once, 'v01', dirty)
  const again = mergeVolumeChapters(skeleton, 'v01', dirty)
  assert.equal(once.chapters.length, 30)
  assert.equal(twice.chapters.length, 30)
  assert.deepEqual(twice, once)
  assert.deepEqual(again, once)
  assert.ok(once.chapters.every((chapter) => chapter.id !== 'ch9999'))
})

test('mergeVolumeChapters 重排后续卷号：重规划第 1 卷后第 2 卷从 ch0021 起', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 1200, chaptersPerVolume: 30 })
  const v1 = mergeVolumeChapters(skeleton, 'v01', chapterList(30))
  const v2 = mergeVolumeChapters(v1, 'v02', chapterList(30, '二卷'))
  assert.equal(v2.chapters[30].id, 'ch0031')
  const replanned = mergeVolumeChapters(v2, 'v01', chapterList(20))
  assert.equal(replanned.chapters.length, 50)
  assert.equal(replanned.chapters[19].id, 'ch0020')
  assert.equal(replanned.chapters[20].id, 'ch0021')
  assert.equal(replanned.chapters[20].volume, 'v02')
  assert.equal(replanned.volumes[1].chapterIds[0], 'ch0021')
  assert.equal(replanned.volumes[0].targetChapters, 20)
})

test('volumeById / volumeOfChapter 能查卷', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 60, chaptersPerVolume: 30 })
  const merged = mergeVolumeChapters(skeleton, 'v01', chapterList(30))
  assert.equal(volumeById(merged, 'v01').id, 'v01')
  assert.equal(volumeById(merged, 'v99'), null)
  assert.equal(volumeOfChapter(merged, 'ch10').id, 'v01')
  assert.equal(volumeOfChapter(merged, 'ch9999'), null)
})

test('migrateOutline：v1 24 章按原顺序重发号、卷归属与 planned:true', () => {
  const old = []
  for (let i = 0; i < 24; i += 1) old.push(v1Chapter(i))
  const v1 = {
    volumes: [
      { title: '上卷', purpose: '入行', chapters: old.slice(0, 5) },
      { title: '中卷', purpose: '深陷', chapters: old.slice(5, 12) },
      { title: '下卷', purpose: '收束', chapters: old.slice(12, 24) },
    ],
    chapters: old,
    totalChapters: 24,
    language: 'zh',
  }
  const v2 = migrateOutline(v1, { params: { chapters: 24, chaptersPerVolume: 30 } })
  assert.equal(isV2(v2), true)
  assert.equal(v2.totalChapters, 24)
  assert.equal(v2.chapters.length, 24)
  assert.deepEqual(
    v2.chapters.map((chapter) => chapter.id),
    Array.from({ length: 24 }, (_, i) => `ch${String(i + 1).padStart(2, '0')}`),
  )
  assert.deepEqual(
    v2.chapters.map((chapter) => chapter.title),
    old.map((chapter) => chapter.title),
  )
  assert.deepEqual(
    v2.volumes.map((volume) => volume.title),
    ['上卷', '中卷', '下卷'],
  )
  assert.deepEqual(
    v2.volumes.map((volume) => volume.goal),
    ['入行', '深陷', '收束'],
  )
  assert.deepEqual(
    v2.volumes.map((volume) => volume.chapterIds.length),
    [5, 7, 12],
  )
  assert.ok(v2.volumes.every((volume) => volume.planned === true))
  assert.equal(v2.volumes[1].chapterIds[0], 'ch06')
})

test('migrateOutline：v1 无卷归属时按 effectivePerVolume 均分', () => {
  const old = Array.from({ length: 24 }, (_, i) => v1Chapter(i))
  const v1 = {
    volumes: [{ title: '空的', purpose: '', chapters: [] }],
    chapters: old,
    totalChapters: 24,
  }
  const v2 = migrateOutline(v1, { params: { chapters: 24, chaptersPerVolume: 10 } })
  assert.deepEqual(
    v2.volumes.map((volume) => volume.targetChapters),
    [10, 10, 4],
  )
  assert.equal(v2.volumes[0].title, '空的')
  assert.equal(v2.volumes[1].title, '第 2 卷')
  assert.deepEqual(
    v2.chapters.map((chapter) => chapter.id),
    Array.from({ length: 24 }, (_, i) => `ch${String(i + 1).padStart(2, '0')}`),
  )
})

test('migrateOutline：v1 99 章 + params.chapters=120 时保留 ch01…ch99', () => {
  const old = Array.from({ length: 99 }, (_, i) => v1Chapter(i))
  const v1 = {
    volumes: [
      { title: '第一卷', purpose: 'p1', chapters: old.slice(0, 50) },
      { title: '第二卷', purpose: 'p2', chapters: old.slice(50) },
    ],
    chapters: old,
    totalChapters: 99,
  }
  const v2 = migrateOutline(v1, { params: { chapters: 120, chaptersPerVolume: 60 } })
  assert.equal(v2.totalChapters, 120)
  assert.equal(v2.chapters.length, 99)
  assert.equal(v2.chapters[0].id, 'ch01')
  assert.equal(v2.chapters[98].id, 'ch99')
  assert.deepEqual(
    v2.chapters.map((chapter) => chapter.id),
    old.map((chapter) => chapter.id),
  )
  assert.deepEqual(v2.volumes.map((volume) => volume.chapterIds.length), [50, 49])
})

test('migrateOutline 对 v2 幂等（原样返回）', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  assert.equal(migrateOutline(skeleton, { params: {} }), skeleton)
  const merged = mergeVolumeChapters(skeleton, 'v01', chapterList(30))
  assert.equal(migrateOutline(merged, { params: { chapters: 300 } }), merged)
})

test('nextActions 空项目：先展开第 1 卷', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  const actions = nextActions({ outline: skeleton, params: {}, written: [], reviewed: [] })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].action, 'plan-volume')
  assert.equal(actions[0].volume, 'v01')
  assert.equal(actions[0].estimate.calls, 1)
  assert.match(actions[0].why, /第 1 卷/)
})

test('nextActions 写了一部分：继续写下一位未写章', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  const outline = mergeVolumeChapters(skeleton, 'v01', chapterList(30))
  const actions = nextActions({ outline, params: {}, written: ['ch001'], reviewed: ['ch001'] })
  assert.equal(actions[0].action, 'write')
  assert.equal(actions[0].chapter, 'ch002')
})

test('nextActions 已写未审：给 check', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  const outline = mergeVolumeChapters(skeleton, 'v01', chapterList(3))
  const written = ['ch001', 'ch002', 'ch003']
  const actions = nextActions({ outline, params: {}, written, reviewed: ['ch001'] })
  assert.equal(actions[0].action, 'check')
  assert.equal(actions[0].chapter, 'ch002')
})

test('nextActions 全部写完并审完：audit；标记已体检后 done', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 30, chaptersPerVolume: 30 })
  const outline = mergeVolumeChapters(skeleton, 'v01', chapterList(3))
  const written = ['ch01', 'ch02', 'ch03']
  const actions = nextActions({ outline, params: {}, written, reviewed: written })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].action, 'audit')
  assert.equal(actions[0].estimate.calls, 0)

  const done = nextActions({ outline, params: { audited: true }, written, reviewed: written })
  assert.equal(done.length, 1)
  assert.equal(done[0].action, 'done')
})

test('nextActions 当前卷写完但还有未计划卷：plan-volume 下一卷', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 60, chaptersPerVolume: 30 })
  const outline = mergeVolumeChapters(skeleton, 'v01', chapterList(30))
  const written = outline.chapters.map((chapter) => chapter.id)
  const actions = nextActions({ outline, params: {}, written, reviewed: written })
  assert.equal(actions[0].action, 'plan-volume')
  assert.equal(actions[0].volume, 'v02')
})

test('nextActions 纯判定：不改输入，最多 5 条', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  const outline = mergeVolumeChapters(skeleton, 'v01', chapterList(3))
  const before = JSON.stringify(outline)
  const actions = nextActions({ outline, params: {}, written: [], reviewed: [] })
  assert.equal(JSON.stringify(outline), before)
  assert.ok(actions.length <= 5)
})

test('normalizeOutline 的 v1 短篇行为不变（裁到 params.chapters）', () => {
  const raw = { volumes: [{ title: '上', purpose: '', chapters: chapterList(24) }] }
  const outline = normalizeOutline(raw, { chapters: 10, language: 'zh' })
  assert.equal(outline.chapters.length, 10)
  assert.equal(outline.totalChapters, 10)
  assert.equal(outline.chapters[0].id, 'ch01')
  assert.equal(outline.chapters[9].id, 'ch10')
  assert.equal(outline.trimmed, 14)
})

test('normalizeOutline 对 v2 骨架原样返回（不破坏卷状态）', () => {
  const skeleton = buildOutlineSkeleton({ chapters: 300, chaptersPerVolume: 30 })
  assert.equal(normalizeOutline(skeleton), skeleton)
})
