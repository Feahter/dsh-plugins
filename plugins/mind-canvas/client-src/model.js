// 脑图的纯数据层：树操作、整理布局、导出。不依赖 React 与 DOM，可在 Node 里直接测。
import { hierarchy, tree as d3tree } from 'd3-hierarchy'

export const SCHEMA_VERSION = 1
export const CARD_WIDTH = 208
export const COL_GAP = 92
export const ROW_GAP = 22
/** 一棵树最多画多少层，超过就不再整理（防止失控） */
export const MAX_LAYOUT_DEPTH = 40

const TONES = ['a', 'b', 'c', 'd', 'e', 'f']

export function makeId(prefix = 'n') {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

export function nowIso() {
  return new Date().toISOString()
}

/** 卡片高度的粗估：按每行 13 个汉字折行，最多 4 行。 */
export function estimateHeight(text) {
  const clean = String(text ?? '').trim()
  if (!clean) return 44
  const width = 26 // 每行大约 26 个半角字符，中文约 13 个
  let lines = 0
  for (const paragraph of clean.split(/\n/)) {
    lines += Math.max(1, Math.ceil(paragraph.length / width))
  }
  return 40 + Math.min(3, Math.max(0, lines - 1)) * 20
}

export function createNode({ text = '', parentId = null, x = 0, y = 0, tone = 'a', source = null } = {}) {
  return {
    id: makeId(),
    text: String(text ?? ''),
    parentId: parentId ?? null,
    x,
    y,
    tone,
    source,
    createdAt: nowIso(),
  }
}

export function createDoc({ title = '新脑图', theme = { preset: 'auto' } } = {}) {
  return {
    id: makeId('d'),
    title,
    nodes: [],
    layout: 'tree-right',
    theme,
    view: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
}

export function createState() {
  const doc = createDoc({ title: '我的第一张脑图' })
  return { version: SCHEMA_VERSION, docs: [doc], activeId: doc.id, revision: 0 }
}

export function isNode(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.id === 'string'
}

/** 读进来的 state 做一次防御性归一，任何字段坏了都不该让整页白屏。 */
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.docs) || raw.docs.length === 0) {
    return createState()
  }
  const docs = raw.docs
    .filter(doc => doc && typeof doc === 'object' && typeof doc.id === 'string')
    .map(doc => {
      const nodes = Array.isArray(doc.nodes) ? doc.nodes.filter(isNode).map(node => ({
        id: String(node.id),
        text: typeof node.text === 'string' ? node.text : '',
        parentId: typeof node.parentId === 'string' ? node.parentId : null,
        x: Number.isFinite(node.x) ? node.x : 0,
        y: Number.isFinite(node.y) ? node.y : 0,
        tone: TONES.includes(node.tone) ? node.tone : 'a',
        source: node.source && typeof node.source === 'object' ? node.source : null,
        createdAt: typeof node.createdAt === 'string' ? node.createdAt : nowIso(),
      })) : []
      const ids = new Set(nodes.map(node => node.id))
      // 孤儿节点（父节点被删掉了）升格成根，否则它会从画布上消失
      for (const node of nodes) {
        if (node.parentId && !ids.has(node.parentId)) node.parentId = null
      }
      // 断环：顺着 parentId 往上走，走回自己就断开
      for (const node of nodes) {
        const seen = new Set([node.id])
        let cursor = node.parentId
        while (cursor) {
          if (seen.has(cursor)) {
            node.parentId = null
            break
          }
          seen.add(cursor)
          cursor = nodes.find(candidate => candidate.id === cursor)?.parentId ?? null
        }
      }
      return {
        id: String(doc.id),
        title: typeof doc.title === 'string' && doc.title.trim() ? doc.title : '未命名脑图',
        nodes,
        layout: doc.layout === 'tree-down' ? 'tree-down' : 'tree-right',
        // 主题只做形状兜底，具体校验交给 theme.js 的 normalizeTheme
        theme: doc.theme && typeof doc.theme === 'object' ? doc.theme : { preset: 'auto' },
        view: doc.view && Number.isFinite(doc.view.zoom) ? doc.view : null,
        createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : nowIso(),
        updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : nowIso(),
      }
    })
  if (docs.length === 0) return createState()
  const activeId = docs.some(doc => doc.id === raw.activeId) ? raw.activeId : docs[0].id
  return {
    version: SCHEMA_VERSION,
    docs,
    activeId,
    revision: Number.isFinite(raw.revision) ? raw.revision : 0,
  }
}

export function findDoc(state, docId) {
  return state.docs.find(doc => doc.id === docId) ?? null
}

export function childIds(doc, id) {
  return doc.nodes.filter(node => node.parentId === id).map(node => node.id)
}

/** 从某个节点往下整棵子树的 id（含自己），深度优先。 */
export function subtreeIds(doc, id) {
  const out = []
  const stack = [id]
  const guard = new Set()
  while (stack.length) {
    const current = stack.pop()
    if (guard.has(current)) continue
    guard.add(current)
    out.push(current)
    for (const child of childIds(doc, current)) stack.push(child)
  }
  return out
}

export function roots(doc) {
  return doc.nodes.filter(node => !node.parentId)
}

export function isDescendant(doc, candidateId, ancestorId) {
  let cursor = candidateId
  const guard = new Set()
  while (cursor) {
    if (guard.has(cursor)) return false
    guard.add(cursor)
    if (cursor === ancestorId) return true
    cursor = doc.nodes.find(node => node.id === cursor)?.parentId ?? null
  }
  return false
}

/** 新节点落在父节点右侧、父节点已有子节点的下方，先给个合理位置，整理后会被覆盖。 */
export function nextChildPosition(doc, parentId) {
  const siblings = childIds(doc, parentId)
  if (siblings.length === 0) {
    const parent = doc.nodes.find(node => node.id === parentId)
    return { x: (parent?.x ?? 0) + CARD_WIDTH + COL_GAP, y: parent?.y ?? 0 }
  }
  const lastId = siblings[siblings.length - 1]
  const last = doc.nodes.find(node => node.id === lastId)
  return { x: last?.x ?? 0, y: (last?.y ?? 0) + 96 }
}

export function toneForDoc(doc) {
  const count = doc.nodes.length
  return TONES[count % TONES.length]
}

/** 只做纯数据的增删改，返回新的 doc（不可变），方便撤销栈直接存快照。 */
export function withNode(doc, node) {
  return { ...doc, nodes: [...doc.nodes, node], updatedAt: nowIso() }
}

export function withText(doc, id, text) {
  return {
    ...doc,
    nodes: doc.nodes.map(node => (node.id === id ? { ...node, text } : node)),
    updatedAt: nowIso(),
  }
}

export function withPosition(doc, id, x, y) {
  return {
    ...doc,
    nodes: doc.nodes.map(node => (node.id === id ? { ...node, x, y } : node)),
    updatedAt: nowIso(),
  }
}

export function withTheme(doc, theme) {
  return { ...doc, theme, updatedAt: nowIso() }
}

export function withLayout(doc, layout) {
  return { ...doc, layout, updatedAt: nowIso() }
}

export function withTone(doc, id, tone) {
  return {
    ...doc,
    nodes: doc.nodes.map(node => (node.id === id ? { ...node, tone } : node)),
    updatedAt: nowIso(),
  }
}

export function withoutSubtree(doc, id) {
  const drop = new Set(subtreeIds(doc, id))
  return { ...doc, nodes: doc.nodes.filter(node => !drop.has(node.id)), updatedAt: nowIso() }
}

/** 把一个节点和它的整棵子树挂到新父节点下（拖拽改父级时用）。 */
export function reparent(doc, id, parentId) {
  if (id === parentId) return doc
  if (parentId && isDescendant(doc, parentId, id)) return doc
  return {
    ...doc,
    nodes: doc.nodes.map(node => (node.id === id ? { ...node, parentId: parentId ?? null } : node)),
    updatedAt: nowIso(),
  }
}

/**
 * 整理成规矩的树。使用 d3-hierarchy 的 tidy tree 算法（Reingold–Tilford 变体），
 * 每层横排、父节点居中对齐子节点的中点，不会重叠。
 * @param {object} doc - 脑图文档。
 * @param {"tree-right"|"tree-down"} direction - 向右长还是向下长。
 */
export function layoutDoc(doc, direction = doc.layout ?? 'tree-right') {
  if (doc.nodes.length === 0) return { ...doc, layout: direction, updatedAt: nowIso() }
  const byId = new Map(doc.nodes.map(node => [node.id, node]))
  const virtual = { id: '__root__', children: [] }
  const built = new Map()
  for (const node of doc.nodes) {
    built.set(node.id, { id: node.id, children: [] })
  }
  for (const node of doc.nodes) {
    const row = built.get(node.id)
    if (node.parentId && byId.has(node.parentId)) built.get(node.parentId).children.push(row)
    else virtual.children.push(row)
  }

  const maxHeight = Math.max(44, ...doc.nodes.map(node => estimateHeight(node.text)))
  const breadth = Math.min(320, maxHeight + ROW_GAP + 14)
  const depthStep = CARD_WIDTH + COL_GAP

  const root = hierarchy(virtual, row => row.children)
  const tidy = d3tree().nodeSize([breadth, depthStep])
  tidy(root)

  const positions = new Map()
  for (const item of root.descendants()) {
    if (item.data.id === '__root__') continue
    const depth = Math.min(MAX_LAYOUT_DEPTH, item.depth - 1)
    const across = item.x
    const along = depth * depthStep
    positions.set(item.data.id, direction === 'tree-down'
      ? { x: across, y: along }
      : { x: along, y: across })
  }

  // 整体平移到以 (0,0) 为中心，避免离画布原点太远
  let minX = Infinity
  let minY = Infinity
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
  }
  const shiftX = Number.isFinite(minX) ? -minX : 0
  const shiftY = Number.isFinite(minY) ? -minY : 0

  return {
    ...doc,
    layout: direction,
    nodes: doc.nodes.map(node => {
      const pos = positions.get(node.id)
      if (!pos) return node
      return { ...node, x: pos.x + shiftX, y: pos.y + shiftY }
    }),
    updatedAt: nowIso(),
  }
}

/** 画布上所有节点（含隐藏的折叠节点）的总包围盒，用于 fitView 与整理时保持视野居中。 */
export function bounds(doc) {
  if (doc.nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of doc.nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + CARD_WIDTH)
    maxY = Math.max(maxY, node.y + estimateHeight(node.text))
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Markdown 大纲只有一份实现，就在 export.js（界面导出、宿主工具、测试共用同一份）。
 * 这里保留旧名字，避免调用点散落两套格式。
 */
export { toMarkdown as toOutline } from './export.js'

export function docStats(doc) {
  return {
    nodes: doc.nodes.length,
    roots: roots(doc).length,
    depth: doc.nodes.reduce((max, node) => {
      let depth = 0
      let cursor = node.parentId
      const guard = new Set()
      while (cursor && !guard.has(cursor)) {
        guard.add(cursor)
        depth += 1
        cursor = doc.nodes.find(candidate => candidate.id === cursor)?.parentId ?? null
      }
      return Math.max(max, depth + 1)
    }, 0),
  }
}

export { TONES }
