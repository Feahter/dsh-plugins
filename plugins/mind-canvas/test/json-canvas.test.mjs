// JSON Canvas 1.0 导出/导入：结构合法、往返稳定、脏数据宽容、字节确定性。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPORT_FORMATS,
  JSON_CANVAS_VERSION,
  importJsonCanvas,
  renderExport,
  toJsonCanvas,
  toJsonCanvasData,
} from '../client-src/export.js'

function n(id, text, parentId = null, x = 0, y = 0, tone = 'a', createdAt = '2024-01-01T00:00:00.000Z') {
  return { id, text, parentId, x, y, tone, source: null, createdAt }
}

function docOf(nodes, title = '选题') {
  return { id: 'doc-json-canvas', title, layout: 'tree-right', nodes }
}

const SAMPLE = docOf([
  n('n1', 'AI 工具怎么讲', null, 0, 0, 'a', '2024-01-01T00:00:00.000Z'),
  n('n2', '实测对比', 'n1', 300.4, -20.6, 'b', '2024-01-02T00:00:00.000Z'),
  n('n3', '三款工具横评', 'n2', 600, 10, 'c', '2024-01-03T00:00:00.000Z'),
  n('n4', '反常识角度', 'n1', 300, 120, 'd', '2024-01-04T00:00:00.000Z'),
])

test('导出结构合法：节点字段齐全且为整数，边的端点都存在', () => {
  assert.equal(JSON_CANVAS_VERSION, '1.0')
  const data = toJsonCanvasData(SAMPLE)
  assert.equal(data.nodes.length, SAMPLE.nodes.length)
  const ids = new Set()
  for (const node of data.nodes) {
    assert.equal(typeof node.id, 'string')
    assert.ok(node.id.length > 0)
    assert.equal(node.type, 'text')
    assert.equal(typeof node.text, 'string')
    assert.ok(Number.isInteger(node.x), `x 不是整数：${node.x}`)
    assert.ok(Number.isInteger(node.y), `y 不是整数：${node.y}`)
    assert.ok(Number.isInteger(node.width) && node.width > 0, `width 不是正整数：${node.width}`)
    assert.ok(Number.isInteger(node.height) && node.height > 0, `height 不是正整数：${node.height}`)
    assert.match(node.color, /^#[0-9a-f]{6}$/)
    assert.ok(!ids.has(node.id), `节点 id 重复：${node.id}`)
    ids.add(node.id)
  }
  const edgeIds = new Set()
  for (const edge of data.edges) {
    assert.equal(typeof edge.id, 'string')
    assert.ok(!edgeIds.has(edge.id), `边 id 重复：${edge.id}`)
    edgeIds.add(edge.id)
    assert.ok(ids.has(edge.fromNode), `fromNode 不存在：${edge.fromNode}`)
    assert.ok(ids.has(edge.toNode), `toNode 不存在：${edge.toNode}`)
    assert.notEqual(edge.fromNode, edge.toNode)
  }
  assert.equal(data.edges.length, SAMPLE.nodes.length - 1)
  // 每条非根边恰好一个入边
  const incoming = new Map()
  for (const edge of data.edges) incoming.set(edge.toNode, (incoming.get(edge.toNode) ?? 0) + 1)
  assert.equal(incoming.get('n2'), 1)
  assert.equal(incoming.get('n3'), 1)
  assert.equal(incoming.get('n4'), 1)
  assert.equal(incoming.get('n1'), undefined)
})

test('导出→导入→再导出：节点数与文本一致，位置不漂移，字节相同', () => {
  const first = toJsonCanvas(SAMPLE)
  const imported = importJsonCanvas(first)
  assert.equal(imported.imported, SAMPLE.nodes.length)
  assert.equal(imported.edges, SAMPLE.nodes.length - 1)
  assert.equal(imported.skipped, 0)
  assert.deepEqual(imported.nodes.map(node => node.text), SAMPLE.nodes.map(node => node.text))
  assert.deepEqual(imported.nodes.map(node => node.id), SAMPLE.nodes.map(node => node.id))
  const byId = new Map(imported.nodes.map(node => [node.id, node]))
  assert.equal(byId.get('n2').parentId, 'n1')
  assert.equal(byId.get('n1').parentId, null)
  // 导出时坐标取整，导入原样保存；再导出不会再变。
  assert.equal(byId.get('n2').x, 300)
  assert.equal(byId.get('n2').y, -21)
  assert.equal(byId.get('n2').tone, 'b')
  assert.equal(byId.get('n3').tone, 'c')

  const second = toJsonCanvas({ id: 'round-trip', title: '忽略', layout: 'tree-right', nodes: imported.nodes })
  assert.equal(second, first)
  const parsed = JSON.parse(second)
  assert.deepEqual(parsed.nodes.map(node => node.text), ['AI 工具怎么讲', '实测对比', '三款工具横评', '反常识角度'])
})

test('脏文件：file/link/group/未知 type + 孤边 + 自环 + 环，跳过并计数但不抛错', () => {
  const dirty = {
    nodes: [
      { id: 'a', type: 'text', text: '根', x: 0, y: 0, width: 100, height: 50 },
      { id: 'b', type: 'text', text: '子', x: 200, y: 0, width: 100, height: 50, color: '#3a5bd9' },
      { id: 'f', type: 'file', file: 'note.md', x: 0, y: 0, width: 10, height: 10 },
      { id: 'l', type: 'link', url: 'https://example.com', x: 0, y: 0, width: 10, height: 10 },
      { id: 'g', type: 'group', label: '一组', x: 0, y: 0, width: 10, height: 10 },
      { id: 'u', type: 'mindmap', x: 0, y: 0, width: 10, height: 10 },
    ],
    edges: [
      { id: 'e1', fromNode: 'a', toNode: 'b' },
      { id: 'e2', fromNode: 'a', toNode: 'missing' },
      { id: 'e3', fromNode: 'a', toNode: 'f' },
      { id: 'e4', fromNode: 'b', toNode: 'a' },
      { id: 'e5', fromNode: 'b', toNode: 'b' },
      { id: 'e6', fromNode: 'a' },
    ],
  }
  const result = importJsonCanvas(dirty)
  assert.equal(result.imported, 2)
  assert.equal(result.skippedNodes, 4)
  assert.equal(result.skippedEdges, 5)
  assert.equal(result.skipped, 9)
  assert.equal(result.edges, 1)
  assert.ok(result.warnings.length >= 4, result.warnings.join('\n'))
  assert.deepEqual(result.nodes.map(node => node.text), ['根', '子'])
  assert.equal(result.nodes.find(node => node.id === 'b').parentId, 'a')
  assert.equal(result.nodes.find(node => node.id === 'b').tone, 'a')
})

test('同一张图导出两次字节级一致（含紧凑模式）', () => {
  assert.equal(toJsonCanvas(SAMPLE), toJsonCanvas(SAMPLE))
  assert.equal(toJsonCanvas(SAMPLE, { pretty: false }), toJsonCanvas(SAMPLE, { pretty: false }))
  assert.equal(toJsonCanvas(SAMPLE), `${JSON.stringify(toJsonCanvasData(SAMPLE), null, 2)}`)
  assert.notEqual(toJsonCanvas(SAMPLE), toJsonCanvas(SAMPLE, { pretty: false }))
})

test('环与自引用在导出时被 buildForest 收成森林，不会产出环边', () => {
  const cyclic = docOf([
    n('a', 'A', 'b', 0, 0, 'a'),
    n('b', 'B', 'a', 200, 0, 'b'),
    n('self', '自己', 'self', 400, 0, 'c'),
  ])
  const data = toJsonCanvasData(cyclic)
  assert.equal(data.nodes.length, 3)
  const ids = new Set(data.nodes.map(node => node.id))
  for (const edge of data.edges) {
    assert.ok(ids.has(edge.fromNode) && ids.has(edge.toNode))
    assert.notEqual(edge.fromNode, edge.toNode)
  }
  // 森林里三节点最多两条边，且不会出现 a→b 与 b→a 同时存在。
  assert.ok(data.edges.length <= 2)
  const pairs = new Set(data.edges.map(edge => `${edge.fromNode}|${edge.toNode}`))
  for (const pair of pairs) {
    const [from, to] = pair.split('|')
    assert.ok(!pairs.has(`${to}|${from}`), `出现互相指向的边：${pair}`)
  }
  const imported = importJsonCanvas(JSON.stringify(data))
  assert.equal(imported.skipped, 0)
  assert.equal(imported.imported, 3)
})

test('颜色映射：hex 精确/近似落色调，预设 1..6 按顺序映射，未知颜色用默认色', () => {
  const result = importJsonCanvas({
    nodes: [
      { id: 'a', type: 'text', text: '精确', color: '#3a5bd9' },
      { id: 'b', type: 'text', text: '近似', color: '#3b5cd9' },
      { id: 'c', type: 'text', text: '预设', color: '2' },
      { id: 'd', type: 'text', text: '坏色', color: 'rebeccapurple' },
      { id: 'e', type: 'text', text: '无坐标' },
    ],
  })
  assert.deepEqual(result.nodes.map(node => node.tone), ['a', 'a', 'b', 'a', 'a'])
  assert.ok(result.warnings.some(message => message.includes('rebeccapurple')))
})

test('未知字段忽略；缺 nodes/edges 只警告不抛错；非法 JSON 才抛错', () => {
  const withUnknown = importJsonCanvas({
    version: '9.9',
    metadata: { source: 'obsidian' },
    nodes: [{ id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 10, height: 10, unknown: true }],
  })
  assert.equal(withUnknown.imported, 1)
  assert.equal(withUnknown.skipped, 0)

  const empty = importJsonCanvas({ unknown: true })
  assert.equal(empty.imported, 0)
  assert.ok(empty.warnings.length > 0)

  assert.throws(() => importJsonCanvas('{ 坏 json'), /不是合法 JSON/)
  assert.throws(() => importJsonCanvas([]), /对象或 JSON 字符串/)
  assert.throws(() => importJsonCanvas(null), /对象或 JSON 字符串/)
})

test('缺坐标的节点按层级生成稳定位置，而不是全叠在原点', () => {
  const doc = docOf([
    { id: 'r', text: '根', parentId: null, tone: 'a', createdAt: '2024-01-01T00:00:00.000Z' },
    { id: 'a', text: '子 A', parentId: 'r', tone: 'a', createdAt: '2024-01-02T00:00:00.000Z' },
    { id: 'b', text: '子 B', parentId: 'r', tone: 'a', createdAt: '2024-01-03T00:00:00.000Z' },
    { id: 'c', text: '孙', parentId: 'a', tone: 'a', createdAt: '2024-01-04T00:00:00.000Z' },
  ])
  const data = toJsonCanvasData(doc)
  assert.deepEqual(data.nodes.map(node => [node.id, node.x, node.y]), [
    ['r', 0, 0],
    ['a', 300, 0],
    ['c', 600, 0],
    ['b', 300, 76],
  ])
  assert.deepEqual(toJsonCanvasData(doc), data)
})

test('renderExport 分发 jsoncanvas，格式表里的扩展名与文案对上', () => {
  const spec = EXPORT_FORMATS.find(item => item.id === 'jsoncanvas')
  assert.ok(spec)
  assert.equal(spec.ext, '.canvas')
  assert.equal(renderExport(SAMPLE, 'jsoncanvas'), toJsonCanvas(SAMPLE))
})
