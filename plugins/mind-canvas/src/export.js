// 纯导出层：把脑图文档转成 Markdown / OPML / FreeMind / JSON。
// 不 import 任何模块、不依赖 React 与 DOM，Node 与 esbuild 打包都能直接用。

const EMPTY_TEXT = '（空）'

/** XML 转义：& 必须最先替换，否则会把后面生成的实体再次转义。 */
export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** ISO 字符串比较；缺失的 createdAt 当作最早期。排序稳定，同时间保持原顺序。 */
function compareCreatedAt(a, b) {
  const left = String(a?.createdAt ?? '')
  const right = String(b?.createdAt ?? '')
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * 把扁平节点列表整理成森林。非破坏性：不修改 doc。
 * - 父节点不存在的孤儿、自引用的节点都当根；
 * - 环里不可达的节点也会被补成根，seen 集合保证每个节点最多出现一次。
 */
function buildForest(doc) {
  const source = Array.isArray(doc?.nodes) ? doc.nodes : []
  const nodes = source.filter(node => node && typeof node === 'object' && typeof node.id === 'string')
  const byId = new Map()
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node)
  }

  const childrenOf = new Map()
  for (const node of nodes) {
    const parentId = node.parentId
    if (typeof parentId !== 'string' || parentId === node.id || !byId.has(parentId)) continue
    const bucket = childrenOf.get(parentId)
    if (bucket) bucket.push(node)
    else childrenOf.set(parentId, [node])
  }
  for (const bucket of childrenOf.values()) bucket.sort(compareCreatedAt)

  const seen = new Set()
  const forest = []
  const walk = node => {
    if (seen.has(node.id)) return null
    seen.add(node.id)
    const children = []
    for (const child of childrenOf.get(node.id) ?? []) {
      const built = walk(child)
      if (built) children.push(built)
    }
    return { node, children }
  }

  // 先挂所有合法的根（无父节点 / 父节点不存在 / 自引用）
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    const parentId = node.parentId
    const hasParent = typeof parentId === 'string' && parentId !== node.id && byId.has(parentId)
    if (hasParent) continue
    const built = walk(node)
    if (built) forest.push(built)
  }

  // 剩下的是环里的节点：依次升格为根，seen 保证不会重复或死循环
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    const built = walk(node)
    if (built) forest.push(built)
  }

  forest.sort((a, b) => compareCreatedAt(a.node, b.node))
  return forest
}

function displayText(node) {
  return String(node?.text ?? '').trim() || EMPTY_TEXT
}

/** Markdown 大纲：标题一级，根节点二级标题，后代用缩进列表。 */
export function toMarkdown(doc) {
  const lines = [`# ${doc?.title ?? ''}`, '']
  const walk = (item, depth) => {
    const text = displayText(item.node)
    if (depth === 0) lines.push(`## ${text}`)
    else lines.push(`${'  '.repeat(depth)}- ${text}`)
    for (const child of item.children) walk(child, depth + 1)
  }
  for (const root of buildForest(doc)) walk(root, 0)
  return lines.join('\n') + '\n'
}

function outlineXml(item, depth) {
  const pad = '  '.repeat(depth)
  const text = escapeXml(item.node?.text ?? '')
  if (item.children.length === 0) return `${pad}<outline text="${text}"/>`
  const children = item.children.map(child => outlineXml(child, depth + 1)).join('\n')
  return `${pad}<outline text="${text}">\n${children}\n${pad}</outline>`
}

/** OPML 2.0：head 里放标题，body 里放嵌套 outline。 */
export function toOpml(doc) {
  const title = escapeXml(doc?.title ?? '')
  const body = buildForest(doc).map(item => outlineXml(item, 2))
  const lines = [
    '<opml version="2.0">',
    '  <head>',
    `    <title>${title}</title>`,
    '  </head>',
    '  <body>',
    ...body,
    '  </body>',
    '</opml>',
  ]
  return lines.join('\n') + '\n'
}

function freeMindNode(item, depth) {
  const pad = '  '.repeat(depth)
  const text = escapeXml(item.node?.text ?? '')
  if (item.children.length === 0) return `${pad}<node TEXT="${text}"/>`
  const children = item.children.map(child => freeMindNode(child, depth + 1)).join('\n')
  return `${pad}<node TEXT="${text}">\n${children}\n${pad}</node>`
}

/** FreeMind / XMind 的 .mm 格式，首行是 UTF-8 声明。 */
export function toFreeMind(doc) {
  const nodes = buildForest(doc).map(item => freeMindNode(item, 1))
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<map version="1.0.1">',
    ...nodes,
    '</map>',
  ]
  return lines.join('\n') + '\n'
}

/** 原始数据直接序列化，字段一个不丢，方便备份与再导入。 */
export function toJson(doc) {
  return JSON.stringify(doc, null, 2)
}

export const EXPORT_FORMATS = [
  { id: 'markdown', ext: '.md', mime: 'text/markdown;charset=utf-8', label: { zh: 'Markdown 大纲', en: 'Markdown outline' } },
  { id: 'opml', ext: '.opml', mime: 'text/x-opml;charset=utf-8', label: { zh: 'OPML（XMind / MindNode 可导入）', en: 'OPML (imports into XMind / MindNode)' } },
  { id: 'freemind', ext: '.mm', mime: 'application/x-freemind;charset=utf-8', label: { zh: 'FreeMind / XMind', en: 'FreeMind / XMind' } },
  { id: 'json', ext: '.json', mime: 'application/json;charset=utf-8', label: { zh: 'JSON（原始数据）', en: 'JSON (raw)' } },
]

/** 按格式 id 分发；未知格式直接抛错，让调用方自己提示。 */
export function renderExport(doc, formatId) {
  switch (formatId) {
    case 'markdown':
      return toMarkdown(doc)
    case 'opml':
      return toOpml(doc)
    case 'freemind':
      return toFreeMind(doc)
    case 'json':
      return toJson(doc)
    default:
      throw new Error(`unknown export format: ${formatId}`)
  }
}

/** 生成安全文件名：去掉文件系统与 URL 里危险的字符，限长 60，空标题回退。 */
export function filenameFor(doc, ext) {
  const cleaned = String(doc?.title ?? '')
    .replace(/[/\\:*?"<>|\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const base = Array.from(cleaned).slice(0, 60).join('').trim() || 'mind-map'
  return base + String(ext ?? '')
}
