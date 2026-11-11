// 宿主半片的树操作与大纲导出。
// 客户端有自己的一份（client-src/model.js，含 d3 布局），宿主这边不引第三方依赖：
// 只做「读成大纲」「往下加节点」这类不需要 tidy layout 的事，排整齐留给界面上的「整理成树」。

const CARD_WIDTH = 208
const COL_GAP = 92

export function childIds(doc, id) {
  return doc.nodes.filter(node => node.parentId === id).map(node => node.id)
}

export function roots(doc) {
  return doc.nodes.filter(node => !node.parentId)
}

export function depthOf(doc, id) {
  const index = new Map(doc.nodes.map(node => [node.id, node]))
  let depth = 1
  let cursor = index.get(id)?.parentId ?? null
  const guard = new Set()
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor)
    depth += 1
    cursor = index.get(cursor)?.parentId ?? null
  }
  return depth
}

export function summarize(doc) {
  const maxDepth = doc.nodes.reduce((max, node) => Math.max(max, depthOf(doc, node.id)), 0)
  return { nodes: doc.nodes.length, roots: roots(doc).length, depth: maxDepth }
}

/** 按标题里包含的文字找节点，找不到返回 null（调用方据此决定落到根上）。 */
export function findNode(doc, hint) {
  const needle = String(hint ?? '').trim().toLowerCase()
  if (!needle) return null
  const exact = doc.nodes.find(node => node.text.trim().toLowerCase() === needle)
  if (exact) return exact
  return doc.nodes.find(node => node.text.toLowerCase().includes(needle)) ?? null
}

/** 和客户端 toOutline 保持同一份格式：一级用 ##，往下用缩进列表。 */
export function outline(doc) {
  const lines = [`# ${doc.title}`, '']
  const byParent = new Map()
  for (const node of doc.nodes) {
    const key = node.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(node)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  }
  const walk = (parentId, depth, guard) => {
    for (const node of byParent.get(parentId) ?? []) {
      if (guard.has(node.id)) continue
      guard.add(node.id)
      const text = node.text.trim() || '（空）'
      lines.push(depth === 1 ? `## ${text}` : `${'  '.repeat(depth - 1)}- ${text}`)
      walk(node.id, depth + 1, guard)
    }
  }
  walk(null, 1, new Set())
  return lines.join('\n') + '\n'
}

function makeId() {
  return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 在某个节点下面追加子节点；parentId 为 null 时作为新的根节点。
 * 位置只做「不重叠地往下排」，真正的树形整理由前端的 d3 布局负责。
 */
export function addChildren(doc, { parentId, texts }) {
  const clean = (Array.isArray(texts) ? texts : [])
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 12)
  if (clean.length === 0) return { doc, added: [] }

  const parent = parentId ? doc.nodes.find(node => node.id === parentId) : null
  const siblings = childIds(doc, parent?.id ?? null)
  const lastSibling = siblings.length ? doc.nodes.find(node => node.id === siblings[siblings.length - 1]) : null

  const baseX = parent ? parent.x + CARD_WIDTH + COL_GAP : 0
  const baseY = lastSibling
    ? lastSibling.y + 76
    : parent
      ? parent.y
      : (doc.nodes.reduce((max, node) => Math.max(max, node.y), -80) + 120)

  const added = clean.map((text, index) => ({
    id: makeId(),
    text,
    parentId: parent?.id ?? null,
    x: baseX,
    y: baseY + index * 76,
    tone: parent?.tone ?? 'a',
    source: { kind: 'agent' },
    createdAt: new Date().toISOString(),
  }))

  const next = {
    ...doc,
    nodes: [...doc.nodes, ...added],
    updatedAt: new Date().toISOString(),
  }
  return { doc: next, added: added.map(node => node.text) }
}
