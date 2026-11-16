// 客户端大纲视图的归类：v1（章挂在卷下）与 v2（顶层扁平 chapters + volume.chapterIds）都要出章。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chapterMeta, volumeRows } from '../client-src/outline.js'

const chapter = (id, title) => ({ id, title, goal: `${title}目标` })

test('v1：章挂在 volume.chapters 下，按卷顺序摊平', () => {
  const outline = {
    volumes: [
      { title: '卷一', chapters: [chapter('ch01', '一'), chapter('ch02', '二')] },
      { title: '卷二', chapters: [chapter('ch03', '三')] },
    ],
  }
  assert.deepEqual(chapterMeta(outline).map(item => item.id), ['ch01', 'ch02', 'ch03'])
  assert.equal(chapterMeta(outline)[0].volume, '卷一')
  assert.equal(chapterMeta(outline)[2].volume, '卷二')
})

test('v2：顶层扁平 chapters + volume.chapterIds 也归到对应卷', () => {
  const outline = {
    chapters: [chapter('ch01', '一'), chapter('ch02', '二'), chapter('ch03', '三')],
    volumes: [
      { id: 'v01', title: '卷一', planned: true, chapterIds: ['ch01', 'ch02'] },
      { id: 'v02', title: '卷二', planned: true, chapterIds: ['ch03'] },
    ],
  }
  const rows = volumeRows(outline)
  assert.deepEqual(rows.map(row => row.chapters.map(item => item.id)), [['ch01', 'ch02'], ['ch03']])
  assert.deepEqual(chapterMeta(outline).map(item => item.volume), ['卷一', '卷一', '卷二'])
})

test('v2 未展开的卷给空数组，不会造出假章', () => {
  const outline = { chapters: [chapter('ch01', '一')], volumes: [{ id: 'v01', title: '卷一', chapterIds: ['ch01'] }, { id: 'v02', title: '卷二' }] }
  const rows = volumeRows(outline)
  assert.equal(rows.length, 2)
  assert.equal(rows[1].chapters.length, 0)
  assert.equal(chapterMeta(outline).length, 1)
})

test('只有扁平 chapters 没有 volumes 时按全书一卷展示', () => {
  const outline = { chapters: [chapter('ch01', '一')] }
  assert.equal(chapterMeta(outline).length, 1)
  assert.equal(volumeRows(outline)[0].volume.title, '全书')
})

test('空大纲不抛错', () => {
  assert.deepEqual(chapterMeta(null), [])
  assert.deepEqual(chapterMeta({}), [])
})
