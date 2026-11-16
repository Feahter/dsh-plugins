// 纯导出层：把脑图文档转成 Markdown / OPML / FreeMind / JSON / JSON Canvas。
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

// ------------------------------------------------------------- JSON Canvas 1.0
// 规范：https://jsoncanvas.org/spec/1.0/
// 导出与导入都走上面 buildForest 的同一套遍历：孤儿、自引用、环在两边的
// 处理不会分叉，导出去的内容再导回来也不会变成另一棵树。

export const JSON_CANVAS_VERSION = '1.0'
/** JSON Canvas 的节点必须有整数宽高；插件里所有卡片同宽。 */
export const CANVAS_NODE_WIDTH = 208

const TONES = ['a', 'b', 'c', 'd', 'e', 'f']
/** 六种色调的固化色值（与界面的 MiniMap 同源）。写进 canvas 的 color 用 hex，换工具也不丢色相。 */
const TONE_HEX = {
  a: '#3a5bd9',
  b: '#0f8f6d',
  c: '#b1661b',
  d: '#a03a86',
  e: '#2f7fa8',
  f: '#6b5bd0',
}
const HEX_TONE = new Map(Object.entries(TONE_HEX).map(([tone, hex]) => [hex, tone]))

/** 圆整到整数；坏坐标回退 0，绝不让 NaN 写进 canvas。 */
function integer(value, fallback = 0) {
  return Number.isFinite(value) ? Math.round(value) : fallback
}

/**
 * 卡片高度的唯一估算：界面布局（client-src/model.js 直接复用这里）与
 * JSON Canvas 导出用同一份，导出的高度才和画布上看到的一致。
 */
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

function toneOf(value) {
  return TONES.includes(value) ? value : 'a'
}

/** 任意 #RRGGBB 找最接近的六色之一；预设色 "1".."6" 按顺序落到 a..f。 */
function toneForColor(color) {
  if (typeof color !== 'string' || !color.trim()) return null
  const raw = color.trim().toLowerCase()
  if (HEX_TONE.has(raw)) return HEX_TONE.get(raw)
  if (/^[1-6]$/.test(raw)) return TONES[Number(raw) - 1]
  const match = /^#([0-9a-f]{6})$/.exec(raw)
  if (!match) return null
  const target = [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16))
  let best = null
  let bestDistance = Infinity
  for (const tone of TONES) {
    const hex = TONE_HEX[tone].slice(1)
    const rgb = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
    const distance = rgb.reduce((sum, channel, index) => sum + (channel - target[index]) ** 2, 0)
    if (distance < bestDistance) {
      bestDistance = distance
      best = tone
    }
  }
  return best
}

/**
 * 把脑图导出成 JSON Canvas 1.0 的对象。
 * - 已有坐标直接取整；节点缺坐标时按树层级生成稳定位置（同层往下排），
 *   不把一堆节点全叠在原点；
 * - 节点顺序取 buildForest 的前序遍历（父子按 createdAt 稳定排序），
 *   所以同一份 doc 每次导出的字节完全一致，引用是确定的。
 */
export function toJsonCanvasData(doc) {
  const nodes = []
  const edges = []
  const rowByDepth = new Map()
  const walk = (item, parentId, depth) => {
    const source = item.node
    const id = String(source.id)
    const text = String(source.text ?? '')
    let x
    let y
    if (Number.isFinite(source.x) && Number.isFinite(source.y)) {
      x = Math.round(source.x)
      y = Math.round(source.y)
    } else {
      // 缺坐标时按层级稳定落位：第 depth 层横排、同层依次往下。
      const row = rowByDepth.get(depth) ?? 0
      rowByDepth.set(depth, row + 1)
      x = depth * (CANVAS_NODE_WIDTH + 92)
      y = row * 76
    }
    nodes.push({
      id,
      type: 'text',
      text,
      x,
      y,
      width: CANVAS_NODE_WIDTH,
      height: integer(estimateHeight(text), 44),
      color: TONE_HEX[toneOf(source.tone)],
    })
    if (parentId) {
      edges.push({ id: `e${edges.length + 1}`, fromNode: parentId, toNode: id })
    }
    for (const child of item.children) walk(child, id, depth + 1)
  }
  for (const root of buildForest(doc)) walk(root, null, 0)
  return { nodes, edges }
}

/** pretty=false 输出紧凑单行；两种模式的字段顺序都固定。 */
export function toJsonCanvas(doc, { pretty = true } = {}) {
  return JSON.stringify(toJsonCanvasData(doc), null, pretty ? 2 : 0)
}

function readCanvasInput(input) {
  if (typeof input !== 'string') {
    if (input && typeof input === 'object' && !Array.isArray(input)) return input
    throw new Error('JSON Canvas 必须是一个对象或 JSON 字符串')
  }
  try {
    return JSON.parse(input)
  } catch (error) {
    throw new Error(`不是合法 JSON：${error.message}`)
  }
}

/**
 * 宽容导入 JSON Canvas 1.0：
 * - 只收 text 节点；file / link / group / 未知 type 跳过并计数；
 * - edge 的 fromNode→toNode 还原成 parentId；孤边、自引用、第二条父边、会成环的边跳过；
 * - 单条脏数据只记 warning，不抛错。只有顶层不是对象、或整串不是合法 JSON 才抛。
 * @param {string|object} input - JSON 文本或已解析对象。
 * @param {{now?: string, maxWarnings?: number}} [options]
 * @returns {{nodes: object[], imported: number, skipped: number,
 *   skippedNodes: number, skippedEdges: number, edges: number, warnings: string[]}}
 */
export function importJsonCanvas(input, options = {}) {
  const now = typeof options.now === 'string' ? options.now : new Date().toISOString()
  const maxWarnings = Number.isInteger(options.maxWarnings) && options.maxWarnings > 0
    ? options.maxWarnings
    : 40
  const raw = readCanvasInput(input)
  if (Array.isArray(raw) || typeof raw !== 'object' || raw === null) {
    throw new Error('JSON Canvas 顶层必须是一个对象')
  }

  const messages = []
  const warn = message => messages.push(message)
  let skippedNodes = 0
  let skippedEdges = 0

  if (raw.nodes !== undefined && !Array.isArray(raw.nodes)) warn('nodes 不是数组，已忽略')
  if (raw.edges !== undefined && !Array.isArray(raw.edges)) warn('edges 不是数组，已忽略')
  if (raw.nodes === undefined && raw.edges === undefined) warn('文件里既没有 nodes 也没有 edges')

  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  const nodes = []
  const byId = new Map()

  for (let index = 0; index < rawNodes.length; index += 1) {
    const item = rawNodes[index]
    if (!item || typeof item !== 'object') {
      skippedNodes += 1
      warn(`第 ${index + 1} 个节点不是对象，已跳过`)
      continue
    }
    if (item.type !== 'text') {
      skippedNodes += 1
      const label = typeof item.id === 'string' && item.id ? ` "${item.id}"` : ''
      warn(`节点${label} 的类型 "${String(item.type)}" 暂不支持，已跳过`)
      continue
    }
    if (typeof item.id !== 'string' || !item.id) {
      skippedNodes += 1
      warn(`第 ${index + 1} 个 text 节点缺少 id，已跳过`)
      continue
    }
    if (byId.has(item.id)) {
      skippedNodes += 1
      warn(`节点 id "${item.id}" 重复，后一个已跳过`)
      continue
    }
    const color = typeof item.color === 'string' ? item.color : ''
    const tone = toneForColor(color)
    if (color && !tone) warn(`节点 "${item.id}" 的颜色 ${color} 无法映射，改用默认色`)
    const node = {
      id: item.id,
      text: typeof item.text === 'string' ? item.text : '',
      parentId: null,
      x: integer(item.x),
      y: integer(item.y),
      tone: tone ?? 'a',
      source: { kind: 'json-canvas' },
      createdAt: now,
    }
    nodes.push(node)
    byId.set(node.id, node)
  }

  let importedEdges = 0
  for (let index = 0; index < rawEdges.length; index += 1) {
    const edge = rawEdges[index]
    if (!edge || typeof edge !== 'object') {
      skippedEdges += 1
      warn(`第 ${index + 1} 条边不是对象，已跳过`)
      continue
    }
    const from = typeof edge.fromNode === 'string' ? edge.fromNode : ''
    const to = typeof edge.toNode === 'string' ? edge.toNode : ''
    if (!from || !to) {
      skippedEdges += 1
      warn(`第 ${index + 1} 条边缺少 fromNode / toNode，已跳过`)
      continue
    }
    if (!byId.has(from) || !byId.has(to)) {
      skippedEdges += 1
      warn(`边 ${from} → ${to} 的端点不在可导入的 text 节点里，已跳过`)
      continue
    }
    if (from === to) {
      skippedEdges += 1
      warn(`边 ${from} → ${to} 是自引用，已跳过`)
      continue
    }
    const child = byId.get(to)
    if (child.parentId) {
      skippedEdges += 1
      warn(`节点 "${to}" 已有父节点，边 ${from} → ${to} 已跳过`)
      continue
    }
    // 从 from 往上走，如果能走到 to，说明再加这条边会成环。
    let cursor = from
    const guard = new Set()
    let cycle = false
    while (cursor) {
      if (cursor === to) {
        cycle = true
        break
      }
      if (guard.has(cursor)) break
      guard.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
    if (cycle) {
      skippedEdges += 1
      warn(`边 ${from} → ${to} 会形成环，已跳过`)
      continue
    }
    child.parentId = from
    importedEdges += 1
  }

  const warnings = messages.length > maxWarnings
    ? [...messages.slice(0, maxWarnings), `…另有 ${messages.length - maxWarnings} 条警告未列出`]
    : messages

  return {
    nodes,
    imported: nodes.length,
    skipped: skippedNodes + skippedEdges,
    skippedNodes,
    skippedEdges,
    edges: importedEdges,
    warnings,
  }
}

export const EXPORT_FORMATS = [
  { id: 'markdown', ext: '.md', mime: 'text/markdown;charset=utf-8', label: { zh: 'Markdown 大纲', en: 'Markdown outline' } },
  { id: 'opml', ext: '.opml', mime: 'text/x-opml;charset=utf-8', label: { zh: 'OPML（XMind / MindNode 可导入）', en: 'OPML (imports into XMind / MindNode)' } },
  { id: 'freemind', ext: '.mm', mime: 'application/x-freemind;charset=utf-8', label: { zh: 'FreeMind / XMind', en: 'FreeMind / XMind' } },
  { id: 'json', ext: '.json', mime: 'application/json;charset=utf-8', label: { zh: 'JSON（原始数据）', en: 'JSON (raw)' } },
  {
    id: 'jsoncanvas',
    ext: '.canvas',
    mime: 'application/json;charset=utf-8',
    label: { zh: 'JSON Canvas（Obsidian / Heptabase）', en: 'JSON Canvas (Obsidian / Heptabase)' },
    labelKey: 'exportJsonCanvas',
  },
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
    case 'jsoncanvas':
      return toJsonCanvas(doc)
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
