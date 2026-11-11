// 纯逻辑层（树操作 + 布局 + 归一化）的测试，不需要 DOM。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CARD_WIDTH,
  bounds,
  childIds,
  createDoc,
  createNode,
  createState,
  docStats,
  estimateHeight,
  layoutDoc,
  nextChildPosition,
  normalizeState,
  reparent,
  roots,
  subtreeIds,
  toOutline,
  withNode,
  withPosition,
  withText,
  withoutSubtree,
} from '../client-src/model.js'

function build() {
  let doc = createDoc({ title: '选题' })
  const root = createNode({ text: 'AI 工具怎么讲', x: 0, y: 0 })
  doc = withNode(doc, root)
  const a = createNode({ text: '具体选题', parentId: root.id, x: 240, y: -60 })
  const b = createNode({ text: '反常识角度', parentId: root.id, x: 240, y: 60 })
  doc = withNode(withNode(doc, a), b)
  const a1 = createNode({ text: '实测对比', parentId: a.id, x: 480, y: -60 })
  doc = withNode(doc, a1)
  return { doc, root, a, b, a1 }
}

test('子树枚举包含自己且不漏层级', () => {
  const { doc, root, a, a1 } = build()
  const ids = subtreeIds(doc, root.id)
  assert.equal(ids.length, 4)
  assert.ok(ids.includes(root.id) && ids.includes(a.id) && ids.includes(a1.id))
  assert.deepEqual(subtreeIds(doc, a.id).sort(), [a.id, a1.id].sort())
  assert.equal(subtreeIds(doc, a1.id).length, 1)
})

test('删一棵子树只删这棵', () => {
  const { doc, root, a, b, a1 } = build()
  const next = withoutSubtree(doc, a.id)
  assert.equal(next.nodes.length, 2)
  assert.ok(next.nodes.some(node => node.id === b.id))
  assert.ok(!next.nodes.some(node => node.id === a1.id))
  assert.ok(next.nodes.some(node => node.id === root.id))
})

test('没有父节点的节点算根，父节点被删的孤儿升格为根', () => {
  const { doc } = build()
  assert.equal(roots(doc).length, 1)
  const raw = {
    version: 1,
    activeId: 'd1',
    docs: [{
      id: 'd1',
      title: 'x',
      nodes: [
        { id: 'n1', text: 'a', parentId: 'gone', x: 0, y: 0 },
        { id: 'n2', text: 'b', parentId: 'n1', x: 1, y: 1 },
      ],
    }],
  }
  const state = normalizeState(raw)
  assert.equal(state.docs[0].nodes[0].parentId, null)
  assert.equal(roots(state.docs[0]).length, 1)
})

test('断环：A→B→A 会被打断，不会让遍历死循环', () => {
  const raw = {
    version: 1,
    activeId: 'd1',
    docs: [{
      id: 'd1',
      title: 'cycle',
      nodes: [
        { id: 'a', text: 'A', parentId: 'b', x: 0, y: 0 },
        { id: 'b', text: 'B', parentId: 'a', x: 0, y: 0 },
      ],
    }],
  }
  const doc = normalizeState(raw).docs[0]
  assert.equal(roots(doc).length, 1)
  assert.equal(childIds(doc, 'a').length + childIds(doc, 'b').length, 1)
})

test('reparent 不允许挂到自己的后代上', () => {
  const { doc, root, a, a1 } = build()
  assert.equal(reparent(doc, root.id, a1.id), doc)
  assert.equal(reparent(doc, root.id, root.id), doc)
  const moved = reparent(doc, a1.id, root.id)
  assert.equal(moved.nodes.find(node => node.id === a1.id).parentId, root.id)
})

test('整理成树：同级不重叠、父节点在子节点左侧、可重复得到同一结果', () => {
  const { doc } = build()
  const once = layoutDoc(doc, 'tree-right')
  const twice = layoutDoc(once, 'tree-right')
  const position = id => once.nodes.find(node => node.id === id)
  assert.deepEqual(
    once.nodes.map(node => [node.id, Math.round(node.x), Math.round(node.y)]),
    twice.nodes.map(node => [node.id, Math.round(node.x), Math.round(node.y)]),
  )
  const byId = new Map(once.nodes.map(node => [node.id, node]))
  for (const node of once.nodes) {
    if (!node.parentId) continue
    const parent = byId.get(node.parentId)
    assert.ok(node.x > parent.x, `${node.text} 应该在父节点右边`)
    const siblings = childIds(once, node.parentId)
    for (const other of siblings) {
      if (other === node.id) continue
      const gap = Math.abs(byId.get(other).y - node.y)
      assert.ok(gap >= 40, `同级节点 ${node.text} 与 ${byId.get(other).text} 的间距太小：${gap}`)
    }
  }
  assert.ok(once.nodes.every(node => node.x >= 0 && node.y >= 0), '整理后整体平移到原点附近')
  void position
})

test('整理成向下长时父子关系沿 y 轴展开', () => {
  const { doc, root, a } = build()
  const down = layoutDoc(doc, 'tree-down')
  const byId = new Map(down.nodes.map(node => [node.id, node]))
  assert.ok(byId.get(a.id).y > byId.get(root.id).y)
  assert.equal(down.layout, 'tree-down')
})

test('空文档整理不炸', () => {
  const doc = createDoc()
  const next = layoutDoc(doc)
  assert.equal(next.nodes.length, 0)
})

test('新子节点的默认位置在父节点右边', () => {
  const { doc, root } = build()
  const spot = nextChildPosition(doc, root.id)
  assert.ok(spot.x > root.x)
  assert.ok(Number.isFinite(spot.y))
})

test('导出大纲：根是二级标题，往下缩进', () => {
  const { doc } = build()
  const text = toOutline(doc)
  assert.match(text, /^# 选题/m)
  assert.match(text, /^## AI 工具怎么讲$/m)
  assert.match(text, /^  - 具体选题$/m)
  assert.match(text, /^    - 实测对比$/m)
})

test('bounds 覆盖所有卡片', () => {
  const { doc } = build()
  const box = bounds(doc)
  assert.ok(box.width >= CARD_WIDTH)
  for (const node of doc.nodes) {
    assert.ok(node.x >= box.x && node.x <= box.x + box.width)
  }
})

test('统计层数', () => {
  const { doc } = build()
  assert.deepEqual(docStats(doc), { nodes: 4, roots: 1, depth: 3 })
})

test('坏输入不会让 normalizeState 抛异常', () => {
  for (const bad of [null, undefined, {}, { docs: [] }, { docs: 'nope' }, 42, 'x']) {
    const state = normalizeState(bad)
    assert.ok(Array.isArray(state.docs) && state.docs.length === 1)
    assert.equal(state.docs[0].nodes.length, 0)
  }
})

test('改文字和挪位置都返回新对象，不改入参', () => {
  const { doc, root } = build()
  const moved = withPosition(doc, root.id, 99, 88)
  const edited = withText(doc, root.id, '新标题')
  assert.equal(doc.nodes.find(node => node.id === root.id).x, 0)
  assert.equal(moved.nodes.find(node => node.id === root.id).x, 99)
  assert.equal(edited.nodes.find(node => node.id === root.id).text, '新标题')
  assert.notEqual(moved, doc)
})

test('estimateHeight 随文字变长而变高，但有上限', () => {
  assert.ok(estimateHeight('短') < estimateHeight('很长'.repeat(60)))
  assert.ok(estimateHeight('很长'.repeat(400)) <= 100)
})

test('createState 自带一张空脑图并指向它', () => {
  const state = createState()
  assert.equal(state.docs.length, 1)
  assert.equal(state.activeId, state.docs[0].id)
  assert.equal(state.docs[0].nodes.length, 0)
})
