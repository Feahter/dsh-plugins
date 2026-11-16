// M7 编辑视角大纲导出：md + csv 同列同序、缺失字段写破折号、无 outline 也不崩。

import test from 'node:test'
import assert from 'node:assert/strict'
import { outlineEditorExport, exports } from '../src/recipes/novel/export.js'

const COLUMNS = [
  '章号', '标题', 'POV', '目标', '冲突', '转折', '钩子类型', '钩子强度',
  '爽点等级', '伏笔(立)', '伏笔(收)', '字数预算', '状态', '审校结论',
]

/** 极简 ctx：与引擎导出时一致（has/read/text/json）。 */
function makeCtx({ artifacts = {}, params = {} } = {}) {
  return {
    params,
    has: (key) => key in artifacts,
    read: (key) => (key in artifacts ? { kind: 'json', content: artifacts[key] } : null),
    json: (key) => (key in artifacts ? artifacts[key] : null),
    text: (key) => (typeof artifacts[key] === 'string' ? artifacts[key] : ''),
  }
}

function mdLines(markdown) {
  return String(markdown).replace(/\n$/, '').split('\n')
}

function mdDataRows(markdown) {
  return mdLines(markdown).filter((line) => /^\| \d+ \|/.test(line))
}

function mdCells(line) {
  assert.ok(line.startsWith('| ') && line.endsWith(' |'), `表格行形状不对：${line}`)
  return line.slice(2, -2).split(' | ')
}

function csvRows(csv) {
  assert.equal(csv[0], '\ufeff', 'CSV 必须带 UTF-8 BOM')
  return csv.slice(1).replace(/\r\n$/, '').split('\r\n')
}

function threeChapterCtx() {
  const artifacts = {
    brief: { title: '长夜将明', blurb: '殡仪馆夜班' },
    outline: {
      chapters: [
        {
          id: 'ch01',
          title: '头七',
          pov: '林默',
          goal: '查明父亲死因',
          conflict: '守夜人阻拦',
          turn: '尸体在冰柜里失踪',
          hookType: '悬念',
          hookStrength: 4,
          payoff: { level: 'small', text: '旧钥匙' },
          threadDue: ['母亲的死因', '殡仪馆账本'],
        },
        {
          id: 'ch02',
          title: '回门',
          goal: '确认钥匙的来历',
        },
        {
          id: 'ch03',
          title: '空棺',
        },
      ],
    },
    'draft/ch01': '## 第1章 头七\n\n雨下得很大。',
    'draft/ch02': '## 第2章 回门\n\n钥匙是冷的。',
    'review/ch02': {
      verdict: 'revise',
      findings: [{ severity: 'block', issue: '时间线与第 1 章冲突' }],
    },
  }
  return makeCtx({ artifacts, params: { wordsPerChapter: 2500 } })
}

test('注册进 exports 映射，供 novel_export 调用', () => {
  assert.equal(exports['outline-editor'].title, '编辑审稿单')
  assert.equal(exports['outline-editor'].run, outlineEditorExport)
})

test('md：书名行 + 统计行 + 表头 + 3 行数据，每行 14 列', async () => {
  const result = await outlineEditorExport(threeChapterCtx())
  assert.equal(result.filename, '长夜将明-编辑审稿单.md')
  assert.equal(result.mime, 'text/markdown; charset=utf-8')

  const lines = mdLines(result.buffer.toString('utf8'))
  assert.equal(lines[0], '# 《长夜将明》编辑审稿单')
  assert.equal(lines[1], '共 3 章 · 已写 2 章 · 已审 1 章')
  assert.equal(lines[2], '')

  const headerIndex = lines.findIndex((line) => line.startsWith('| 章号 |'))
  assert.ok(headerIndex > 0, '应有表头行')
  assert.deepEqual(mdCells(lines[headerIndex]), COLUMNS)

  const rows = mdDataRows(result.buffer.toString('utf8'))
  assert.equal(rows.length, 3, '3 章应有 3 行数据')
  for (const row of rows) assert.equal(mdCells(row).length, 14, `每行必须 14 列：${row}`)
})

test('md：逐章字段与状态/审校结论口径正确', async () => {
  const rows = mdDataRows((await outlineEditorExport(threeChapterCtx())).buffer.toString('utf8')).map(mdCells)

  assert.deepEqual(rows[0], [
    '1', '头七', '林默', '查明父亲死因', '守夜人阻拦', '尸体在冰柜里失踪',
    '悬念', '4', 'small', '母亲的死因、殡仪馆账本', '旧钥匙', '2500', '已写', '—',
  ])
  assert.equal(rows[1][0], '2')
  assert.equal(rows[1][1], '回门')
  assert.equal(rows[1][12], '已审')
  assert.match(rows[1][13], /^需修订（block 1 \/ warn 0 \/ note 0）：时间线与第 1 章冲突$/)
  assert.equal(rows[2][12], '未写')
  assert.equal(rows[2][13], '—')
})

test('csv：BOM、表头 + 3 行、每行 14 列，与 md 同列同序', async () => {
  const result = await outlineEditorExport(threeChapterCtx())
  const extra = result.extras?.[0]
  assert.equal(extra.filename, '长夜将明-编辑审稿单.csv')

  const csv = extra.buffer.toString('utf8')
  const rows = csvRows(csv)
  assert.equal(rows.length, 4, '表头 + 3 章')
  assert.deepEqual(rows[0].split(','), COLUMNS)
  for (const row of rows) assert.equal(row.split(',').length, 14, `每行必须 14 列：${row}`)

  const mdRows = mdDataRows(result.buffer.toString('utf8')).map(mdCells)
  assert.deepEqual(rows.slice(1).map((row) => row.split(',')), mdRows, 'md 与 csv 同列同序')
})

test('csv：逗号/双引号/换行按 RFC4180 转义', async () => {
  const ctx = makeCtx({
    artifacts: {
      outline: {
        chapters: [{ id: 'ch01', title: '他说,"别回头"', goal: '第一行\n第二行' }],
      },
    },
  })
  const csv = (await outlineEditorExport(ctx)).extras[0].buffer.toString('utf8')
  assert.ok(csv.includes('"他说,""别回头"""'), '逗号与双引号要加引号并翻倍')
  assert.ok(csv.includes('"第一行\n第二行"'), '换行字段要被引号包住')
})

test('缺失字段渲染 —，不崩', async () => {
  const ctx = makeCtx({
    artifacts: { outline: { chapters: [{ id: 'ch01' }, {}] } },
  })
  const result = await outlineEditorExport(ctx)
  const rows = mdDataRows(result.buffer.toString('utf8')).map(mdCells)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], ['1', ...Array(10).fill('—'), '3000', '未写', '—'])
  assert.equal(rows[1][0], '2')
  assert.equal(rows[1][12], '未写')
})

test('没有 outline 工件时返回表头与 0 行，不抛错', async () => {
  const result = await outlineEditorExport(makeCtx())
  assert.equal(result.filename, '未命名-编辑审稿单.md')
  assert.equal(result.mime, 'text/markdown; charset=utf-8')

  const lines = mdLines(result.buffer.toString('utf8'))
  assert.equal(lines[0], '# 《未命名》编辑审稿单')
  assert.equal(lines[1], '共 0 章 · 已写 0 章 · 已审 0 章')
  assert.ok(lines.some((line) => line.startsWith('| 章号 |')))
  assert.equal(mdDataRows(result.buffer.toString('utf8')).length, 0)

  const csv = result.extras[0].buffer.toString('utf8')
  const rows = csvRows(csv)
  assert.equal(rows.length, 1, '只有表头')
  assert.deepEqual(rows[0].split(','), COLUMNS)
})

test('wordsPerChapter 缺省时字数预算为 3000', async () => {
  const ctx = makeCtx({ artifacts: { outline: { chapters: [{ id: 'ch01', title: '头七' }] } } })
  const rows = mdDataRows((await outlineEditorExport(ctx)).buffer.toString('utf8')).map(mdCells)
  assert.equal(rows[0][11], '3000')
})
