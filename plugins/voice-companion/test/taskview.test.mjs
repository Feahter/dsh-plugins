// Offline tests for the task view: pure geometry plus the real component driven
// by a fake document and a fake /tasks endpoint. No browser, no Host.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  __testTaskView,
  createTaskView,
  tvAgo,
  tvEdgePath,
  tvKindText,
  tvLayout,
  tvPreview,
  tvStatusText,
} from '../src/client/taskview.js'

// --------------------------------------------------------------- fake DOM

class FakeElement {
  constructor(doc, tag, ns) {
    this.ownerDocument = doc
    this.tagName = String(tag)
    this.namespaceURI = ns || null
    this.children = []
    this.parentNode = null
    this.attributes = Object.create(null)
    this.style = Object.create(null)
    this.textContent = ''
    this.listeners = new Map()
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }
  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }
  get firstChild() {
    return this.children.length === 0 ? null : this.children[0]
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || []
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  }
  fire(type, event) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event || {})
  }
  get clientWidth() {
    return 0
  }
  get clientHeight() {
    return 0
  }
}

function createDoc() {
  const doc = {
    elements: [],
    createElement(tag) {
      const node = new FakeElement(doc, tag)
      doc.elements.push(node)
      return node
    },
    createElementNS(ns, tag) {
      const node = new FakeElement(doc, tag, ns)
      doc.elements.push(node)
      return node
    },
    addEventListener() {},
    removeEventListener() {},
  }
  doc.head = doc.createElement('head')
  doc.body = doc.createElement('body')
  return doc
}

function all(root, predicate, found = []) {
  if (predicate(root)) found.push(root)
  for (const child of root.children) all(child, predicate, found)
  return found
}

const byClass = (root, name) => all(root, (node) => (node.getAttribute('class') || '').split(/\s+/).includes(name))
const byData = (root, key, value) =>
  all(root, (node) => (value === undefined ? node.getAttribute(key) !== null : node.getAttribute(key) === value))

function text(node) {
  return [node.textContent, ...node.children.map(text)].join('')
}

// ------------------------------------------------------------ pure helpers

test('layout snakes through rows and wraps the short way', () => {
  const layout = tvLayout(7, { perRow: 4 })
  assert.equal(layout.columns, 4)
  assert.equal(layout.rows, 2)
  assert.deepEqual(
    layout.nodes.map((node) => [node.row, node.x]),
    [
      [0, 0],
      [0, 258],
      [0, 516],
      [0, 774],
      [1, 774],
      [1, 516],
      [1, 258],
    ],
  )
  // Row 1 runs right→left: the wrap edge drops straight down.
  const wrap = tvEdgePath(layout.nodes[3], layout.nodes[4])
  assert.match(wrap, /^M 882 108 C 882 138, 882 134, 882 164$/)
  const along = tvEdgePath(layout.nodes[0], layout.nodes[1])
  assert.match(along, /^M 216 54 C 242 54, 232 54, 258 54$/)
  assert.equal(tvEdgePath(null, layout.nodes[0]), '')
})

test('layout clamps to one row when the count is tiny', () => {
  const layout = tvLayout(1, { perRow: 4 })
  assert.equal(layout.rows, 1)
  assert.equal(layout.columns, 1)
  assert.equal(layout.nodes.length, 1)
  assert.equal(tvLayout(0).height, 0)
})

test('labels, previews and relative time stay human', () => {
  assert.equal(tvStatusText('running'), '进行中')
  assert.equal(tvStatusText('nope'), '未知')
  assert.equal(tvKindText('tool'), '工具')
  assert.equal(tvPreview('a\n\nb   c', 20), 'a b c')
  assert.equal(tvPreview('x'.repeat(30), 5), 'xxxxx…')
  const now = 1_700_000_000_000
  assert.equal(tvAgo(now - 5_000, now), '刚刚')
  assert.equal(tvAgo(now - 3 * 60_000, now), '3 分钟前')
  assert.match(tvAgo(now - 5 * 3_600_000, now), /^\d\d:\d\d$/)
  assert.equal(tvAgo(0, now), '')
  assert.equal(__testTaskView.TV_STATUS.failed, '没做成')
})

// --------------------------------------------------------------- component

function fixture() {
  const doc = createDoc()
  const calls = []
  const tasks = [
    { taskId: 't1', title: '旧活', text: '第一件', status: 'done', dispatchedAt: 1_000, summary: '完事' },
    { taskId: 't2', title: '新活', text: '第二件', status: 'running', dispatchedAt: 2_000, summary: '' },
  ]
  const details = {
    t1: {
      task: tasks[0],
      nodes: [
        { id: 'a', kind: 'heard', title: '听到', content: '帮我干活', status: 'done' },
        { id: 'b', kind: 'dispatch', title: '派活', content: '第一件', status: 'done' },
        { id: 'c', kind: 'result', title: '交付', content: '完事', status: 'done' },
      ],
    },
    t2: {
      task: tasks[1],
      nodes: [
        { id: 'x', kind: 'heard', title: '听到', content: '帮我看目录', status: 'done' },
        { id: 'y', kind: 'dispatch', title: '派活', content: '第二件', status: 'done' },
        { id: 'z', kind: 'tool', title: '运行命令', content: 'ls', status: 'active', detail: 'bash' },
        { id: 'w', kind: 'message', title: '回复', content: '看完了', status: 'done' },
      ],
    },
  }
  const requestJson = async (path) => {
    calls.push(path)
    if (path.startsWith('/tasks?taskId=')) {
      const id = decodeURIComponent(path.split('taskId=')[1].split('&')[0])
      if (!details[id]) throw new Error('missing ' + id)
      return details[id]
    }
    return { ok: true, tasks, tracked: 1 }
  }
  const view = createTaskView({ doc, mount: doc.body, requestJson })
  return { doc, view, calls, tasks, details }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

test('open loads the list, prefers the running task, and highlights its active node', async (t) => {
  const { doc, view, calls } = fixture()
  t.after(() => view.dispose())
  assert.equal(view.open(), true)
  assert.equal(doc.body.children.length, 1)
  const root = doc.body.children[0]
  assert.equal(root.getAttribute('data-open'), '1')
  await settle()

  assert.equal(calls[0], '/tasks')
  assert.match(calls[1], /^\/tasks\?taskId=t2&live=1$/)
  assert.equal(view.data.selectedTaskId, 't2')

  const rail = byClass(root, 'vc-tv-task')
  assert.equal(rail.length, 2)
  assert.equal(rail[1].getAttribute('data-active'), '1')

  const nodes = byClass(root, 'vc-tv-node')
  assert.equal(nodes.length, 4)
  assert.equal(nodes[2].getAttribute('data-status'), 'active')
  assert.equal(nodes[2].getAttribute('data-selected'), '1', 'the active node is preselected')
  assert.ok(text(nodes[0]).includes('帮我看目录'))
  assert.equal(byClass(root, 'vc-tv-edge').length, 0, 'edges are svg paths, not divs')
  const paths = all(root, (node) => node.getAttribute('class') === 'vc-tv-edge-path')
  assert.equal(paths.length, 3, 'one connector per gap')
  assert.match(text(root), /任务视图/)

  // Detail pane opens on the preselected node.
  const pane = byClass(root, 'vc-tv-detail')[0]
  assert.equal(pane.getAttribute('data-open'), '1')
  assert.ok(text(pane).includes('运行命令'))
  assert.equal(view.isOpen(), true)
  view.dispose()
})

test('clicking a node moves the detail pane; clicking a task switches the chain', async (t) => {
  const { doc, view, calls } = fixture()
  t.after(() => view.dispose())
  view.open()
  await settle()
  const root = doc.body.children[0]

  const nodes = byClass(root, 'vc-tv-node')
  nodes[0].fire('click')
  assert.equal(view.data.selectedNodeId, 'x')
  const pane = byClass(root, 'vc-tv-detail')[0]
  assert.ok(text(pane).includes('听到'))
  assert.ok(text(pane).includes('帮我看目录'))

  const rail = byClass(root, 'vc-tv-task')
  rail[0].fire('click')
  await settle()
  assert.equal(view.data.selectedTaskId, 't1')
  assert.match(calls.at(-1), /taskId=t1/)
  assert.equal(byClass(root, 'vc-tv-node').length, 3)
  assert.ok(text(byClass(root, 'vc-tv-detail')[0]).includes('交付'))
  view.dispose()
})

test('a long chain turns into a pan/zoom canvas with a live transform', async (t) => {
  const { doc, view } = fixture()
  t.after(() => view.dispose())
  const nodes = []
  for (let index = 0; index < 9; index += 1) {
    nodes.push({ id: 'n' + index, kind: 'tool', title: '步骤' + index, content: 'x' + index, status: index === 7 ? 'active' : 'done' })
  }
  view.ingest({ task: { taskId: 't9', title: '长活', text: '长', status: 'running' }, nodes })
  const root = doc.body.children[0]
  assert.equal(byClass(root, 'vc-tv-node').length, 9)
  assert.equal(all(root, (node) => node.getAttribute('class') === 'vc-tv-edge-path').length, 8)
  assert.equal(all(root, (node) => node.tagName === 'marker').length, 1, 'edges carry an arrow head')
  const world = byClass(root, 'vc-tv-world')[0]
  assert.match(world.style.transform, /^translate\([-\d.]+px, [-\d.]+px\) scale\([\d.]+\)$/)

  // Snake wrap: node 4 sits to the right of node 5.
  const rects = byClass(root, 'vc-tv-node').map((node) => node.style.left)
  assert.ok(parseFloat(rects[3]) > parseFloat(rects[4]), 'row 1 must run right→left')

  // Panning takes the wheel off auto-follow and moves the world.
  const viewport = byClass(root, 'vc-tv-viewport')[0]
  viewport.fire('pointerdown', { clientX: 10, clientY: 10, button: 0 })
  // pointermove lives on doc, which is a no-op stub here; zoom is on the viewport.
  viewport.fire('wheel', { deltaY: 100, preventDefault() {} })
  assert.match(byClass(root, 'vc-tv-world')[0].style.transform, /scale\(0\.\d+\)/)
  view.dispose()
})

test('empty board tells the user where tasks come from', async (t) => {
  const doc = createDoc()
  const view = createTaskView({
    doc,
    mount: doc.body,
    requestJson: async () => ({ ok: true, tasks: [], tracked: 0 }),
  })
  t.after(() => view.dispose())
  view.open()
  await settle()
  const root = doc.body.children[0]
  assert.equal(byClass(root, 'vc-tv-task').length, 0)
  const empty = byClass(root, 'vc-tv-empty')[0]
  assert.equal(empty.getAttribute('data-visible'), '1')
  assert.ok(text(empty).includes('还没有用语音派出去的活'))
  view.dispose()
})

test('close hides the panel, refresh pulls fresh state, dispose removes the root', async (t) => {
  const { doc, view, calls } = fixture()
  t.after(() => view.dispose())
  view.open()
  await settle()
  const root = doc.body.children[0]
  const before = calls.length
  view.refresh()
  await settle()
  assert.ok(calls.length > before, 'refresh must re-fetch')
  assert.equal(view.close(), true)
  assert.equal(root.getAttribute('data-open'), '0')
  assert.equal(view.isOpen(), false)
  view.dispose()
  assert.equal(doc.body.children.length, 0)
})

test('ingest marks nothing active if the chain is finished', async (t) => {
  const { doc, view } = fixture()
  t.after(() => view.dispose())
  view.ingest({
    task: { taskId: 't1', title: '旧活', status: 'done' },
    nodes: [
      { id: 'a', kind: 'heard', title: '听到', content: 'a', status: 'done' },
      { id: 'b', kind: 'result', title: '交付', content: '完事', status: 'done' },
    ],
  })
  const root = doc.body.children[0]
  assert.equal(byClass(root, 'vc-tv-node').filter((node) => node.getAttribute('data-status') === 'active').length, 0)
  assert.equal(view.data.selectedNodeId, 'b', 'finished chains select the delivery node')
  view.dispose()
})
