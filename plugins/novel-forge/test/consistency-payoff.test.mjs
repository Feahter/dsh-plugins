// test/consistency-payoff.test.mjs — 爽点兑现节奏三条全书规则（正例 + 不误报）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { audit } from '../src/recipes/novel/consistency.js'

/** levels 数组 → 章表；undefined 表示没有 payoff 字段，null 表示 payoff 为 null。 */
function makeBook(levels) {
  return levels.map((level, index) => {
    const chapter = {
      id: `ch${String(index + 1).padStart(4, '0')}`,
      title: `第${index + 1}章`,
    }
    if (level !== undefined) chapter.payoff = level === null ? null : { level }
    return chapter
  })
}

function volumeBook(levels, options = {}) {
  const id = options.id ?? 'v01'
  const chapters = makeBook(levels).map((chapter) => ({ ...chapter, volume: id }))
  const outline = {
    volumes: [
      {
        id,
        title: options.title ?? '第一卷',
        targetChapters: options.targetChapters ?? levels.length,
        planned: options.planned ?? true,
        chapterIds: chapters.map((chapter) => chapter.id),
      },
    ],
  }
  return { chapters, outline }
}

function ofKind(findings, kind) {
  return findings.filter((finding) => finding.kind === kind)
}

// ---- payoff-gap ----------------------------------------------------------

test('payoff-gap：连续 6 章 none → 一条 warn，where 取断档起点，issue 带起止与章数', () => {
  const findings = audit({
    chapters: makeBook(['none', 'none', 'none', 'none', 'none', 'none', 'small']),
  })
  const hits = ofKind(findings, 'payoff-gap')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'warn')
  assert.equal(hits[0].where, 'ch0001')
  assert.match(hits[0].issue, /从「第1章」到「第6章」连续 6 章没有兑现任何承诺（爽点断档）/)
  assert.match(hits[0].fix, /small 级兑现/)
  assert.match(hits[0].fix, /选择 \+ 代价/)
})

test('payoff-gap：恰好连续 5 章 none → 不报', () => {
  const findings = audit({
    chapters: makeBook(['none', 'none', 'none', 'none', 'none', 'small']),
  })
  assert.equal(ofKind(findings, 'payoff-gap').length, 0)
})

test('payoff-gap：level 缺失与 none 混在连续断档里 → 一起计入', () => {
  const findings = audit({
    chapters: makeBook(['none', 'none', undefined, 'none', 'none', 'none', 'small']),
  })
  const hits = ofKind(findings, 'payoff-gap')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /连续 6 章/)
})

test('payoff-gap：全表没有 payoff 字段 → 整条跳过', () => {
  const findings = audit({ chapters: makeBook(Array.from({ length: 10 }, () => undefined)) })
  assert.equal(ofKind(findings, 'payoff-gap').length, 0)
})

test('payoff-gap：断档被一次 real payoff 隔开 → 只报各区间，不合并', () => {
  const findings = audit({
    chapters: makeBook(['none', 'none', 'none', 'none', 'none', 'none', 'small', 'none', 'none', 'none', 'none', 'none', 'none', 'medium']),
  })
  const hits = ofKind(findings, 'payoff-gap')
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map((hit) => hit.where).sort(), ['ch0001', 'ch0008'])
})

// ---- payoff-volume -------------------------------------------------------

test('payoff-volume：已排完的卷里 4 章 large → 一条「大爽点过密」note', () => {
  const { chapters, outline } = volumeBook([
    'large', 'large', 'large', 'large', 'none', 'none', 'none', 'none', 'none', 'none',
  ])
  const hits = ofKind(audit({ chapters, outline }), 'payoff-volume')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].severity, 'note')
  assert.equal(hits[0].where, 'v01')
  assert.match(hits[0].issue, /4 章 payoff\.level=large/)
  assert.match(hits[0].issue, /大爽点过密（上限 3 章）/)
  assert.match(hits[0].fix, /1 章的 large 降到 medium/)
})

test('payoff-volume：整卷 0 章 large 且每章都有 level → 一条「整卷没有大爽点」note', () => {
  const { chapters, outline } = volumeBook(Array.from({ length: 10 }, () => 'small'))
  const hits = ofKind(audit({ chapters, outline }), 'payoff-volume')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /整卷 10 章都没有 large 级兑现（整卷没有大爽点）/)
})

test('payoff-volume：整卷 0 章 large 但有章缺 level → 跳过，不误报', () => {
  const levels = Array.from({ length: 10 }, () => 'small')
  levels[5] = undefined
  const { chapters, outline } = volumeBook(levels)
  assert.equal(ofKind(audit({ chapters, outline }), 'payoff-volume').length, 0)
})

test('payoff-volume：卷未排完（10/20 章）→ 即使 4 章 large 也不报', () => {
  const { chapters, outline } = volumeBook(
    ['large', 'large', 'large', 'large', 'none', 'none', 'none', 'none', 'none', 'none'],
    { targetChapters: 20 },
  )
  assert.equal(ofKind(audit({ chapters, outline }), 'payoff-volume').length, 0)
})

test('payoff-volume：planned=false 的卷 → 不判大爽点密度', () => {
  const { chapters, outline } = volumeBook(
    ['large', 'large', 'large', 'large', 'none', 'none', 'none', 'none', 'none', 'none'],
    { planned: false },
  )
  assert.equal(ofKind(audit({ chapters, outline }), 'payoff-volume').length, 0)
})

test('payoff-volume：没有 outline.volumes 时 → 不猜卷，静默', () => {
  const chapters = makeBook(['large', 'large', 'large', 'large', 'none'])
  assert.equal(ofKind(audit({ chapters }), 'payoff-volume').length, 0)
})

// ---- payoff-opening ------------------------------------------------------

test('payoff-opening：第 1 章 small、第 2 章 medium、第 3 章 medium → 不报', () => {
  assert.equal(ofKind(audit({ chapters: makeBook(['small', 'medium', 'medium']) }), 'payoff-opening').length, 0)
})

test('payoff-opening：前 3 章之外出现 large → 不报', () => {
  assert.equal(
    ofKind(audit({ chapters: makeBook(['small', 'medium', 'medium', 'large']) }), 'payoff-opening').length,
    0,
  )
})

test('payoff-opening：第 1 章 none → 报且指出第 1 章', () => {
  const hits = ofKind(audit({ chapters: makeBook(['none', 'small', 'medium']) }), 'payoff-opening')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].where, 'ch0001')
  assert.match(hits[0].issue, /第 1 章 payoff\.level=none，应为 small 或 medium/)
})

test('payoff-opening：第 2 章 large → 报「前三章不应提前给大爽点」', () => {
  const hits = ofKind(audit({ chapters: makeBook(['small', 'large', 'medium']) }), 'payoff-opening')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /第 2 章出现 large 级兑现/)
})

test('payoff-opening：第 3 章 large → 报（前 3 章出现 large 即命中）', () => {
  const hits = ofKind(audit({ chapters: makeBook(['small', 'medium', 'large']) }), 'payoff-opening')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /第 3 章出现 large 级兑现/)
})

test('payoff-opening：第 3 章 small → 报「应为 medium 或 large」', () => {
  const hits = ofKind(audit({ chapters: makeBook(['small', 'medium', 'small']) }), 'payoff-opening')
  assert.equal(hits.length, 1)
  assert.match(hits[0].issue, /第 3 章 payoff\.level=small，应为 medium 或 large/)
})

test('payoff-opening：三章里缺任何一个 level → 整条跳过', () => {
  assert.equal(
    ofKind(audit({ chapters: makeBook(['small', 'medium', undefined]) }), 'payoff-opening').length,
    0,
  )
  assert.equal(ofKind(audit({ chapters: makeBook(['none', undefined, 'none']) }), 'payoff-opening').length, 0)
})

test('payoff-opening：不足 3 章 → 不报', () => {
  assert.equal(ofKind(audit({ chapters: makeBook(['none', 'none']) }), 'payoff-opening').length, 0)
})

// ---- 三条规则共用的跳过与去重 --------------------------------------------

test('payoff：全表没有 payoff 字段 → 三条规则都跳过', () => {
  const chapters = makeBook(Array.from({ length: 10 }, () => undefined))
  const findings = audit({ chapters })
  assert.equal(ofKind(findings, 'payoff-gap').length, 0)
  assert.equal(ofKind(findings, 'payoff-volume').length, 0)
  assert.equal(ofKind(findings, 'payoff-opening').length, 0)
})
