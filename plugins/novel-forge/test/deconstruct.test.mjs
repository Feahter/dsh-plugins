// test/deconstruct.test.mjs — M6 拆书本地确定性半段。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeStyle,
  chapterHooks,
  deconstruct,
  sceneDensity,
  splitChapters,
} from '../src/recipes/novel/deconstruct.js'

const THREE_CHAPTERS = [
  '第一章 起风',
  '他推开门。',
  '',
  '第二章 入夜',
  '灯灭了。',
  '',
  '第三章 归途',
  '他回来了。',
].join('\n')

test('① 中文标题 3 章：标题、字数对', () => {
  const chapters = splitChapters(THREE_CHAPTERS)
  assert.equal(chapters.length, 3)
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ['第一章 起风', '第二章 入夜', '第三章 归途'],
  )
  assert.deepEqual(
    chapters.map((chapter) => chapter.chars),
    [5, 4, 5],
  )
  assert.deepEqual(
    chapters.map((chapter) => chapter.text),
    ['他推开门。', '灯灭了。', '他回来了。'],
  )
})

test('② 无标题长文：整篇 1 章，title 正文', () => {
  const body = Array.from({ length: 8 }, () => '他走进屋子，看了看窗外。').join('\n')
  const chapters = splitChapters(body)
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].title, '正文')
  assert.equal(chapters[0].text, body)
  assert.equal(chapters[0].chars, body.replace(/\s+/g, '').length)
})

test('③ 空文本 / 全空白：0 章、chars 0、不抛错', () => {
  for (const text of ['', '   ', '\n\n\t \r\n']) {
    const result = deconstruct({ text, title: '空白' })
    assert.deepEqual(result.chapters, [])
    assert.equal(result.meta.chars, 0)
    assert.equal(result.meta.chapters, 0)
    assert.equal(result.style.dialogueRatio, 0)
    assert.deepEqual(result.style.topBigrams, [])
    assert.deepEqual(result.curve.chapterChars, [])
    assert.equal(result.curve.longest, 0)
    assert.equal(result.curve.shortest, 0)
  }
})

test('④ 对话比用已知引号文本算出预期值（±0.01）', () => {
  // 去空白共 14 字（含标点），引号内 4 字 → 4/14 = 0.2857…
  const style = analyzeStyle('他推开门。“你来了。”她说。')
  assert.ok(Math.abs(style.dialogueRatio - 0.286) <= 0.01, `实际 ${style.dialogueRatio}`)
})

test('⑤ 章末钩子分类：question / reveal / none 各中一次', () => {
  const question = chapterHooks(['他停下脚步。', '你听见了吗？'])
  const reveal = chapterHooks(['门开了。', '原来是他。'])
  const none = chapterHooks(['他走了。'])

  assert.equal(question.kind, 'question')
  assert.equal(reveal.kind, 'reveal')
  assert.equal(none.kind, 'none')
  // 章末取最后 1–2 句
  assert.deepEqual(question.sentences, ['他停下脚步。', '你听见了吗？'])
  assert.deepEqual(none.sentences, ['他走了。'])
  // 末句是叙述收尾（「老周问。」），问句在倒数第二句：回看一句仍算 question
  const carried = chapterHooks(['「你确定要查下去？」老周问。', '他没答。'])
  assert.equal(carried.kind, 'question')
})

test('⑥ topBigrams 不含标点、按 count 降序', () => {
  const { topBigrams } = analyzeStyle('风声。风声。风停。')
  assert.deepEqual(topBigrams[0], ['风声', 2])
  assert.deepEqual(topBigrams[1], ['风停', 1])
  for (const [gram] of topBigrams) {
    assert.equal(/[\s，。！？；：、“”「」]/.test(gram), false, `二字组含标点：${gram}`)
    assert.equal(gram.length, 2)
  }
  for (let index = 1; index < topBigrams.length; index += 1) {
    assert.ok(topBigrams[index - 1][1] >= topBigrams[index][1], 'count 不是降序')
  }
})

test('⑦ 同一输入两次调用结果深度相等', () => {
  const input = { text: `${THREE_CHAPTERS}\n\n“快走。”他说。`, title: '稳定性' }
  assert.deepEqual(deconstruct(input), deconstruct(input))
})

test('⑧ 混合标题格式：markdown / Chapter N / 数字编号', () => {
  const text = ['# 开端', '甲。', '', 'Chapter 2', '乙。', '', '3. 尾声', '丙。'].join('\n')
  const chapters = splitChapters(text)
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ['开端', 'Chapter 2', '3. 尾声'],
  )
})

test('⑨ 标题前的非空内容单独成「序」', () => {
  const text = ['前言内容。', '', '第一章 起风', '他推开门。'].join('\n')
  const chapters = splitChapters(text)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, '序')
  assert.equal(chapters[0].chars, 5)
  assert.equal(chapters[1].index, 2)
  assert.equal(chapters[1].title, '第一章 起风')
})

test('⑩ 场景密度：空行分块、scenesPer1k 与每章 sceneCount', () => {
  const chapters = [
    { index: 1, title: '一', chars: 6, text: '一。\n\n二。\n\n三。' },
    { index: 2, title: '二', chars: 2, text: '四。' },
  ]
  const density = sceneDensity(chapters)
  assert.equal(density.sceneCount, 4)
  assert.deepEqual(density.byChapter, [
    { index: 1, sceneCount: 3 },
    { index: 2, sceneCount: 1 },
  ])
  assert.equal(density.scenesPer1k, 500)
})
