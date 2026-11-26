// Task view: the voice-dispatched work drawn as a node canvas.
//
// The panel only has room for the avatar; this is the full-screen board behind
// the "任务" button. It polls `/api/voice-companion/tasks`, lays the node chain
// out left-to-right with a snake wrap, connects the nodes, and keeps the active
// one in focus so "where is my job now" is answerable at a glance.
//
// Pure layout helpers are exported for the offline harness; the component
// itself only needs `doc.createElement`, `setAttribute` and `appendChild`.

const TV_STATUS = { running: '进行中', done: '已完成', failed: '没做成' }
const TV_KIND = {
  heard: '输入',
  dispatch: '派发',
  tool: '工具',
  message: '回复',
  live: '进行中',
  result: '交付',
  gap: '省略',
}

const TV_LIST_MS = 5000
const TV_DETAIL_MS = 1600
const TV_NODE_W = 216
const TV_NODE_H = 108
const TV_GAP_X = 42
const TV_GAP_Y = 56
const TV_MIN_SCALE = 0.45
const TV_MAX_SCALE = 1.5

/** @param {unknown} status */
export function tvStatusText(status) {
  return TV_STATUS[status] || '未知'
}

/** @param {unknown} kind */
export function tvKindText(kind) {
  return TV_KIND[kind] || '节点'
}

/**
 * Left-to-right layout with a snake wrap: row 0 runs left→right, row 1
 * right→left, so the connector between rows is a short vertical hop instead of
 * a long jump across the canvas.
 *
 * @param {number} count
 * @param {{ perRow?: number, nodeW?: number, nodeH?: number, gapX?: number, gapY?: number }} [options]
 */
export function tvLayout(count, options = {}) {
  const perRow = Math.max(1, Number(options.perRow) || 4)
  const nodeW = Number(options.nodeW) || TV_NODE_W
  const nodeH = Number(options.nodeH) || TV_NODE_H
  const gapX = options.gapX === undefined ? TV_GAP_X : Number(options.gapX)
  const gapY = options.gapY === undefined ? TV_GAP_Y : Number(options.gapY)
  const total = Math.max(0, Number(count) || 0)
  const columns = Math.max(1, Math.min(perRow, total || 1))
  const rows = total === 0 ? 0 : Math.ceil(total / columns)
  const nodes = []
  for (let index = 0; index < total; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const placed = row % 2 === 1 ? columns - 1 - column : column
    nodes.push({ x: placed * (nodeW + gapX), y: row * (nodeH + gapY), row, column })
  }
  return {
    nodes,
    width: columns * nodeW + (columns - 1) * gapX,
    height: rows === 0 ? 0 : rows * nodeH + (rows - 1) * gapY,
    nodeW,
    nodeH,
    columns,
    rows,
  }
}

/**
 * One cubic connector between two placed nodes. Same row: horizontal; a row
 * wrap: vertical from the bottom edge to the next top edge.
 *
 * @param {{ x: number, y: number, row: number }} from
 * @param {{ x: number, y: number, row: number }} to
 * @param {number} [nodeW]
 * @param {number} [nodeH]
 */
export function tvEdgePath(from, to, nodeW = TV_NODE_W, nodeH = TV_NODE_H) {
  if (!from || !to) return ''
  if (from.row === to.row) {
    const direction = to.x > from.x ? 1 : -1
    const x1 = direction > 0 ? from.x + nodeW : from.x
    const x2 = direction > 0 ? to.x : to.x + nodeW
    const y1 = from.y + nodeH / 2
    const y2 = to.y + nodeH / 2
    return `M ${x1} ${y1} C ${x1 + direction * 26} ${y1}, ${x2 - direction * 26} ${y2}, ${x2} ${y2}`
  }
  const x1 = from.x + nodeW / 2
  const y1 = from.y + nodeH
  const x2 = to.x + nodeW / 2
  const y2 = to.y
  return `M ${x1} ${y1} C ${x1} ${y1 + 30}, ${x2} ${y2 - 30}, ${x2} ${y2}`
}

/**
 * Compact relative time for the rail: 刚刚 / 3 分钟前 / 14:05.
 * @param {number} at
 * @param {number} [now]
 */
export function tvAgo(at, now = Date.now()) {
  const value = Number(at)
  if (!Number.isFinite(value) || value <= 0) return ''
  const delta = Math.max(0, now - value)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  const date = new Date(value)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** One-line preview of a node's content for the card. */
export function tvPreview(text, max = 120) {
  const flat = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`
}

const TV_STYLE = `
.vc-tv{position:fixed;inset:0;z-index:var(--vc-board-z, 2147483000);display:none;font-family:var(--vc-font, system-ui,-apple-system,"PingFang SC",sans-serif);color:#edf2ff}
.vc-tv[data-open="1"]{display:block}
.vc-tv-scrim{position:absolute;inset:0;background:rgba(3,7,18,.62);backdrop-filter:blur(6px)}
.vc-tv-panel{position:absolute;inset:28px;display:flex;flex-direction:column;border:1px solid var(--vc-board-border-color, rgba(140,170,255,.22));border-radius:18px;overflow:hidden;background:linear-gradient(160deg,var(--vc-board-bg-from, rgba(16,26,54,.97)) 0%,var(--vc-board-bg-to, rgba(6,11,26,.98)) 100%);box-shadow:0 30px 80px rgba(0,0,0,.55)}
.vc-tv-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(140,170,255,.14);flex:none}
.vc-tv-title{font-size:15px;font-weight:650;letter-spacing:.02em}
.vc-tv-sub{font-size:11px;color:var(--vc-text-muted, #9fb0d6)}
.vc-tv-live{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--vc-text-secondary, #cfd9f5);padding:2px 8px;border-radius:999px;border:1px solid rgba(140,170,255,.2);background:rgba(120,150,255,.08)}
.vc-tv-live[data-on="0"]{opacity:.5}
.vc-tv-live i{width:6px;height:6px;border-radius:50%;background:#7fe3a8;box-shadow:0 0 8px #7fe3a8}
.vc-tv-live[data-on="0"] i{background:#8b93a7;box-shadow:none}
.vc-tv-btn{appearance:none;width:26px;height:26px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#eef3ff;font:600 13px/1 system-ui,sans-serif;cursor:pointer;display:grid;place-items:center}
.vc-tv-btn:hover{background:rgba(255,255,255,.16)}
.vc-tv-btn:focus-visible{outline:2px solid var(--vc-btn-focus-ring, #9db4ff);outline-offset:2px}
.vc-tv-main{display:flex;flex:1;min-height:0}
.vc-tv-rail{width:238px;flex:none;border-right:1px solid rgba(140,170,255,.12);overflow:auto;padding:10px}
.vc-tv-rail-empty{padding:18px 10px;font-size:12px;line-height:1.7;color:var(--vc-text-muted, #9fb0d6)}
.vc-tv-task{display:block;width:100%;text-align:left;appearance:none;margin:0 0 8px;padding:9px 10px;border-radius:12px;border:1px solid transparent;background:rgba(120,150,255,.06);color:inherit;cursor:pointer;font-family:inherit}
.vc-tv-task:hover{background:rgba(140,170,255,.14)}
.vc-tv-task[data-active="1"]{border-color:var(--vc-accent-base, #6b85ff);background:rgba(107,133,255,.16)}
.vc-tv-task-title{display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vc-tv-task-meta{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:10.5px;color:var(--vc-text-muted, #9fb0d6)}
.vc-tv-chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;line-height:1.5;border:1px solid rgba(255,255,255,.14);white-space:nowrap;flex:none}
.vc-tv-chip[data-status="running"]{color:#9db4ff;border-color:rgba(157,180,255,.45);background:rgba(107,133,255,.14)}
.vc-tv-chip[data-status="done"]{color:#8ff0c4;border-color:rgba(143,240,196,.4);background:rgba(103,226,166,.10)}
.vc-tv-chip[data-status="failed"]{color:#ffb4b4;border-color:rgba(255,128,128,.4);background:rgba(255,104,104,.12)}
.vc-tv-task-time{margin-left:auto}
.vc-tv-board{position:relative;flex:1;min-width:0;display:flex;flex-direction:column}
.vc-tv-summary{display:flex;align-items:baseline;gap:10px;padding:12px 18px 6px;flex:none;min-height:20px}
.vc-tv-summary-title{font-size:13.5px;font-weight:650}
.vc-tv-summary-text{font-size:11.5px;color:var(--vc-text-muted, #9fb0d6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vc-tv-summary-status{margin-left:auto;flex:none}
.vc-tv-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.vc-tv-viewport[data-dragging="1"]{cursor:grabbing}
.vc-tv-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.vc-tv-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.vc-tv-edges>path{fill:none;stroke:rgba(140,170,255,.32);stroke-width:1.6;stroke-dasharray:5 5}
.vc-tv-node{position:absolute;box-sizing:border-box;padding:10px 12px;border-radius:14px;border:1px solid rgba(140,170,255,.22);background:linear-gradient(160deg,rgba(20,32,64,.96),rgba(10,18,38,.96));color:#edf2ff;text-align:left;font-family:inherit;cursor:pointer;display:flex;flex-direction:column;gap:5px;overflow:hidden;transition:border-color .18s ease,box-shadow .18s ease}
.vc-tv-node:hover{border-color:rgba(157,180,255,.55)}
.vc-tv-node[data-status="active"]{border-color:var(--vc-accent-base, #6b85ff);box-shadow:0 0 0 1px rgba(107,133,255,.5),0 0 26px rgba(107,133,255,.35);animation:vc-tv-pulse 1.8s ease-in-out infinite}
.vc-tv-node[data-status="done"]{border-color:rgba(143,240,196,.28)}
.vc-tv-node[data-status="error"]{border-color:rgba(255,128,128,.55);background:linear-gradient(160deg,rgba(58,18,28,.96),rgba(28,10,18,.96))}
.vc-tv-node[data-status="pending"]{opacity:.55}
.vc-tv-node[data-selected="1"]{outline:2px solid rgba(157,180,255,.9);outline-offset:2px}
.vc-tv-node[data-kind="gap"]{opacity:.5;border-style:dashed}
@keyframes vc-tv-pulse{0%,100%{box-shadow:0 0 0 1px rgba(107,133,255,.35),0 0 14px rgba(107,133,255,.2)}50%{box-shadow:0 0 0 1px rgba(107,133,255,.75),0 0 30px rgba(107,133,255,.5)}}
.vc-tv-node-head{display:flex;align-items:center;gap:6px;flex:none}
.vc-tv-index{width:18px;height:18px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:9.5px;font-weight:700;color:#cfe0ff;background:rgba(120,150,255,.18);border:1px solid rgba(140,170,255,.28)}
.vc-tv-node[data-status="active"] .vc-tv-index{background:var(--vc-accent-base, #6b85ff);color:#08122c;border-color:transparent}
.vc-tv-node[data-status="error"] .vc-tv-index{background:rgba(255,104,104,.3);color:#ffdada;border-color:rgba(255,128,128,.5)}
.vc-tv-kind{font-size:9.5px;color:var(--vc-text-muted, #9fb0d6);letter-spacing:.04em}
.vc-tv-node-title{font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.vc-tv-node-body{font-size:11px;line-height:1.45;color:#dbe4fb;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.vc-tv-node-foot{display:flex;align-items:center;gap:6px;margin-top:auto;font-size:9.5px;color:var(--vc-text-muted, #9fb0d6);min-width:0}
.vc-tv-node-detail{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.vc-tv-detail{flex:none;border-top:1px solid rgba(140,170,255,.14);padding:10px 18px 14px;max-height:132px;overflow:auto;display:none}
.vc-tv-detail[data-open="1"]{display:block}
.vc-tv-detail-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:650;margin-bottom:6px}
.vc-tv-detail-body{font-size:11.5px;line-height:1.6;color:#dbe4fb;white-space:pre-wrap;word-break:break-word}
.vc-tv-empty{position:absolute;inset:0;display:none;place-items:center;text-align:center;padding:24px;font-size:12px;line-height:1.8;color:var(--vc-text-muted, #9fb0d6)}
.vc-tv-empty[data-visible="1"]{display:grid}
.vc-tv-error{font-size:11px;color:#ffb4b4;padding:0 18px 8px;display:none}
.vc-tv-error[data-visible="1"]{display:block}
@media (max-width: 720px){
  .vc-tv-panel{inset:10px}
  .vc-tv-rail{width:170px}
}
`

const styledDocs = new WeakSet()

function ensureTaskViewStyles(doc) {
  if (!doc || styledDocs.has(doc)) return
  styledDocs.add(doc)
  const style = doc.createElement('style')
  style.setAttribute('data-vc-taskview-style', '')
  style.textContent = TV_STYLE
  const host = doc.head || doc.body
  if (host && typeof host.appendChild === 'function') host.appendChild(style)
}

function element(doc, tag, attrs, text) {
  const node = doc.createElement(tag)
  if (attrs) {
    for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]))
  }
  if (text !== undefined) node.textContent = text
  return node
}

/** Viewport size with a headless fallback, so the harness can render too. */
function viewportSize(viewport) {
  const width = Number(viewport && viewport.clientWidth) || 0
  const height = Number(viewport && viewport.clientHeight) || 0
  if (width > 0 && height > 0) return { width, height }
  const rect = typeof viewport?.getBoundingClientRect === 'function' ? viewport.getBoundingClientRect() : null
  return {
    width: Math.max(320, Number(rect?.width) || 960),
    height: Math.max(240, Number(rect?.height) || 520),
  }
}

/**
 * @param {object} options
 * @param {Document} options.doc
 * @param {HTMLElement} [options.mount]
 * @param {(path: string, options?: any, timeoutMs?: number) => Promise<any>} options.requestJson
 * @param {() => void} [options.onClose]
 */
export function createTaskView(options = {}) {
  const doc = options.doc || (typeof document === 'undefined' ? null : document)
  if (!doc || typeof doc.createElement !== 'function') throw new Error('createTaskView: no document')
  const mount = options.mount || doc.body
  if (!mount || typeof mount.appendChild !== 'function') throw new Error('createTaskView: no mount')
  const requestJson = typeof options.requestJson === 'function' ? options.requestJson : null
  if (!requestJson) throw new TypeError('createTaskView: requestJson is required')

  ensureTaskViewStyles(doc)

  const state = {
    open: false,
    tasks: [],
    selectedTaskId: '',
    task: null,
    nodes: [],
    selectedNodeId: '',
    scale: 1,
    tx: 0,
    ty: 0,
    autoFollow: true,
    lastCenterKey: '',
    busy: false,
    listTimer: null,
    detailTimer: null,
    error: '',
    disposed: false,
  }

  // ---- skeleton
  const root = element(doc, 'div', { class: 'vc-tv', 'data-open': '0', role: 'dialog', 'aria-label': '任务视图' })
  const scrim = element(doc, 'div', { class: 'vc-tv-scrim', 'aria-hidden': 'true' })
  const panel = element(doc, 'div', { class: 'vc-tv-panel' })
  const head = element(doc, 'div', { class: 'vc-tv-head' })
  head.appendChild(element(doc, 'span', { class: 'vc-tv-title' }, '任务视图'))
  head.appendChild(element(doc, 'span', { class: 'vc-tv-sub' }, '语音派出去的活 · 画布看节点'))
  const liveBadge = element(doc, 'span', { class: 'vc-tv-live', 'data-on': '0', title: '运行中任务每 1.6 秒刷新' })
  liveBadge.appendChild(element(doc, 'i', { 'aria-hidden': 'true' }))
  liveBadge.appendChild(element(doc, 'span', {}, '实时'))
  head.appendChild(liveBadge)
  const refreshButton = element(doc, 'button', { class: 'vc-tv-btn', type: 'button', 'aria-label': '刷新', title: '刷新' }, '\u21bb')
  const closeButton = element(doc, 'button', { class: 'vc-tv-btn', type: 'button', 'aria-label': '关闭任务视图', title: '关闭' }, '\u00d7')
  head.appendChild(refreshButton)
  head.appendChild(closeButton)

  const main = element(doc, 'div', { class: 'vc-tv-main' })
  const rail = element(doc, 'aside', { class: 'vc-tv-rail', 'aria-label': '任务列表' })
  const board = element(doc, 'section', { class: 'vc-tv-board' })
  const summary = element(doc, 'div', { class: 'vc-tv-summary' })
  const summaryTitle = element(doc, 'span', { class: 'vc-tv-summary-title' })
  const summaryText = element(doc, 'span', { class: 'vc-tv-summary-text' })
  const summaryStatus = element(doc, 'span', { class: 'vc-tv-chip vc-tv-summary-status', 'data-status': 'running' })
  summary.appendChild(summaryTitle)
  summary.appendChild(summaryText)
  summary.appendChild(summaryStatus)
  const errorLine = element(doc, 'div', { class: 'vc-tv-error', 'data-visible': '0', role: 'status' })

  const viewport = element(doc, 'div', { class: 'vc-tv-viewport', 'data-dragging': '0' })
  const world = element(doc, 'div', { class: 'vc-tv-world' })
  const svg = doc.createElementNS
    ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    : doc.createElement('svg')
  svg.setAttribute('class', 'vc-tv-edges')
  svg.setAttribute('aria-hidden', 'true')
  const nodesLayer = element(doc, 'div', { class: 'vc-tv-nodes' })
  world.appendChild(svg)
  world.appendChild(nodesLayer)
  viewport.appendChild(world)
  const empty = element(doc, 'div', { class: 'vc-tv-empty', 'data-visible': '0' })
  empty.appendChild(element(doc, 'div', {}, '还没有用语音派出去的活。'))
  empty.appendChild(element(doc, 'div', {}, '在语音面板里说「帮我做…」，这里会出现节点。'))
  viewport.appendChild(empty)

  const detail = element(doc, 'div', { class: 'vc-tv-detail', 'data-open': '0' })
  const detailHead = element(doc, 'div', { class: 'vc-tv-detail-head' })
  const detailTitle = element(doc, 'span')
  const detailStatus = element(doc, 'span', { class: 'vc-tv-chip' })
  detailHead.appendChild(detailTitle)
  detailHead.appendChild(detailStatus)
  const detailBody = element(doc, 'div', { class: 'vc-tv-detail-body' })
  detail.appendChild(detailHead)
  detail.appendChild(detailBody)

  board.appendChild(summary)
  board.appendChild(errorLine)
  board.appendChild(viewport)
  board.appendChild(detail)
  main.appendChild(rail)
  main.appendChild(board)
  panel.appendChild(head)
  panel.appendChild(main)
  root.appendChild(scrim)
  root.appendChild(panel)
  mount.appendChild(root)

  // ---- helpers
  function showError(message) {
    state.error = message || ''
    errorLine.textContent = state.error
    errorLine.setAttribute('data-visible', state.error ? '1' : '0')
  }

  function sizeOf(index) {
    return tvLayout(state.nodes.length, { perRow: perRow() })
  }

  function perRow() {
    const { width } = viewportSize(viewport)
    const fit = Math.floor((width - 48) / (TV_NODE_W + TV_GAP_X))
    return Math.max(1, Math.min(5, fit || 4))
  }

  function applyTransform() {
    world.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
    world.style.width = `${state.worldWidth || 0}px`
    world.style.height = `${state.worldHeight || 0}px`
  }

  function fit() {
    const { width, height } = viewportSize(viewport)
    const layout = sizeOf(0)
    state.worldWidth = layout.width
    state.worldHeight = layout.height
    const scale = layout.width === 0
      ? 1
      : Math.min(1, (width - 64) / layout.width, (height - 48) / Math.max(1, layout.height))
    state.scale = Math.max(TV_MIN_SCALE, Math.min(1, scale))
    state.tx = Math.max(16, (width - layout.width * state.scale) / 2)
    state.ty = 24
    applyTransform()
  }

  function centerOn(index) {
    const layout = sizeOf(0)
    const placed = layout.nodes[index]
    const { width, height } = viewportSize(viewport)
    if (!placed) return
    state.worldWidth = layout.width
    state.worldHeight = layout.height
    state.tx = width / 2 - (placed.x + TV_NODE_W / 2) * state.scale
    state.ty = height / 2 - (placed.y + TV_NODE_H / 2) * state.scale
    // Never leave the canvas fully off-screen after a teleport.
    state.tx = Math.min(24, Math.max(Math.min(24, width - layout.width * state.scale - 24), state.tx))
    state.ty = Math.min(24, Math.max(Math.min(24, height - layout.height * state.scale - 24), state.ty))
    applyTransform()
  }

  function nodeIndexById(id) {
    return state.nodes.findIndex((node) => node.id === id)
  }

  function renderRail() {
    while (rail.firstChild) rail.removeChild(rail.firstChild)
    if (state.tasks.length === 0) {
      rail.appendChild(element(doc, 'div', { class: 'vc-tv-rail-empty' }, '还没有任务。\n用语音说一句「帮我做…」就会出现在这里。'))
      return
    }
    for (const task of state.tasks) {
      const button = element(doc, 'button', {
        class: 'vc-tv-task',
        type: 'button',
        'data-task': task.taskId,
        'data-active': task.taskId === state.selectedTaskId ? '1' : '0',
      })
      button.appendChild(element(doc, 'span', { class: 'vc-tv-task-title' }, task.title || '任务'))
      const meta = element(doc, 'span', { class: 'vc-tv-task-meta' })
      meta.appendChild(element(doc, 'span', { class: 'vc-tv-chip', 'data-status': task.status }, tvStatusText(task.status)))
      meta.appendChild(element(doc, 'span', { class: 'vc-tv-task-time' }, tvAgo(task.dispatchedAt)))
      button.appendChild(meta)
      if (typeof button.addEventListener === 'function') {
        button.addEventListener('click', () => {
          if (state.selectedTaskId === task.taskId) return
          state.selectedTaskId = task.taskId
          state.selectedNodeId = ''
          state.autoFollow = true
          state.lastCenterKey = ''
          renderRail()
          void loadDetail()
        })
      }
      rail.appendChild(button)
    }
  }

  function renderSummary() {
    const task = state.task
    summaryTitle.textContent = task ? task.title : ''
    summaryText.textContent = task ? task.text : ''
    summaryStatus.setAttribute('data-status', task ? task.status : 'running')
    summaryStatus.textContent = task ? tvStatusText(task.status) : ''
    liveBadge.setAttribute('data-on', task && task.status === 'running' ? '1' : '0')
  }

  function renderDetail() {
    const node = state.nodes.find((candidate) => candidate.id === state.selectedNodeId)
    if (!node) {
      detail.setAttribute('data-open', '0')
      return
    }
    detail.setAttribute('data-open', '1')
    detailTitle.textContent = `${tvKindText(node.kind)} · ${node.title || ''}`
    detailStatus.setAttribute('data-status', node.status)
    detailStatus.textContent = tvStatusText(node.status === 'active' ? 'running' : node.status)
    detailBody.textContent = [node.content, node.detail].filter(Boolean).join('\n')
  }

  function renderCanvas() {
    while (nodesLayer.firstChild) nodesLayer.removeChild(nodesLayer.firstChild)
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    const layout = tvLayout(state.nodes.length, { perRow: perRow() })
    state.worldWidth = layout.width
    state.worldHeight = layout.height
    svg.setAttribute('width', String(layout.width || 1))
    svg.setAttribute('height', String(layout.height || 1))
    // Arrow head: a snake layout runs right→left on odd rows, so the connector
    // must say which way the flow goes instead of relying on reading order.
    const defs = doc.createElementNS
      ? doc.createElementNS('http://www.w3.org/2000/svg', 'defs')
      : doc.createElement('defs')
    const marker = doc.createElementNS
      ? doc.createElementNS('http://www.w3.org/2000/svg', 'marker')
      : doc.createElement('marker')
    marker.setAttribute('id', 'vc-tv-arrow-head')
    marker.setAttribute('viewBox', '0 0 10 10')
    marker.setAttribute('refX', '8')
    marker.setAttribute('refY', '5')
    marker.setAttribute('markerWidth', '6')
    marker.setAttribute('markerHeight', '6')
    marker.setAttribute('orient', 'auto-start-reverse')
    const arrow = doc.createElementNS
      ? doc.createElementNS('http://www.w3.org/2000/svg', 'path')
      : doc.createElement('path')
    arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z')
    arrow.setAttribute('fill', 'rgba(157,180,255,.55)')
    marker.appendChild(arrow)
    defs.appendChild(marker)
    svg.appendChild(defs)
    for (let index = 0; index < state.nodes.length; index += 1) {
      const placed = layout.nodes[index]
      const node = state.nodes[index]
      if (index > 0) {
        const from = layout.nodes[index - 1]
        const path = doc.createElementNS
          ? doc.createElementNS('http://www.w3.org/2000/svg', 'path')
          : doc.createElement('path')
        path.setAttribute('class', 'vc-tv-edge-path')
        // Presentation attribute, not CSS: a url(#id) inside a stylesheet
        // resolves against the page URL and silently fails to find the marker.
        path.setAttribute('marker-end', 'url(#vc-tv-arrow-head)')
        path.setAttribute('d', tvEdgePath(from, placed))
        svg.appendChild(path)
      }
      const card = element(doc, 'button', {
        class: 'vc-tv-node',
        type: 'button',
        'data-node': node.id,
        'data-kind': node.kind,
        'data-status': node.status,
        'data-selected': node.id === state.selectedNodeId ? '1' : '0',
        'aria-label': `${tvKindText(node.kind)} ${node.title || ''}`,
      })
      card.style.left = `${placed.x}px`
      card.style.top = `${placed.y}px`
      card.style.width = `${layout.nodeW}px`
      card.style.height = `${layout.nodeH}px`
      const head = element(doc, 'div', { class: 'vc-tv-node-head' })
      head.appendChild(element(doc, 'span', { class: 'vc-tv-index' }, String(index + 1)))
      head.appendChild(element(doc, 'span', { class: 'vc-tv-kind' }, tvKindText(node.kind)))
      head.appendChild(element(doc, 'span', { class: 'vc-tv-node-title' }, node.title || ''))
      card.appendChild(head)
      card.appendChild(element(doc, 'div', { class: 'vc-tv-node-body' }, tvPreview(node.content, 140)))
      const foot = element(doc, 'div', { class: 'vc-tv-node-foot' })
      foot.appendChild(element(doc, 'span', { class: 'vc-tv-chip', 'data-status': node.status }, tvStatusText(node.status === 'active' ? 'running' : node.status)))
      if (node.detail) foot.appendChild(element(doc, 'span', { class: 'vc-tv-node-detail' }, tvPreview(node.detail, 40)))
      card.appendChild(foot)
      if (typeof card.addEventListener === 'function') {
        card.addEventListener('click', () => {
          state.selectedNodeId = node.id
          renderCanvas()
          renderDetail()
        })
      }
      nodesLayer.appendChild(card)
    }
    const hasNodes = state.nodes.length > 0
    empty.setAttribute('data-visible', hasNodes ? '0' : '1')
    nodesLayer.setAttribute('data-empty', hasNodes ? '0' : '1')
  }

  function renderAll({ preserveView = false } = {}) {
    renderRail()
    renderSummary()
    renderCanvas()
    renderDetail()
    if (!preserveView) fit()
    else applyTransform()
    // Follow the active node when the run moved, unless the user took the wheel.
    const active = state.nodes.find((node) => node.status === 'active')
    const key = `${state.selectedTaskId}:${active ? active.id : ''}`
    if (active && state.autoFollow && key !== state.lastCenterKey) {
      const index = nodeIndexById(active.id)
      if (index >= 0) centerOn(index)
      state.lastCenterKey = key
    }
  }

  function pickDefaultNode() {
    const active = state.nodes.find((node) => node.status === 'active')
    if (active) return active.id
    if (state.nodes.length > 0) return state.nodes[state.nodes.length - 1].id
    return ''
  }

  async function loadList() {
    if (state.disposed) return
    try {
      const body = await requestJson('/tasks', null, 8000)
      if (state.disposed) return
      showError('')
      state.tasks = Array.isArray(body?.tasks) ? body.tasks : []
      if (!state.selectedTaskId || !state.tasks.some((task) => task.taskId === state.selectedTaskId)) {
        const running = state.tasks.find((task) => task.status === 'running')
        state.selectedTaskId = (running || state.tasks[0])?.taskId || ''
        state.selectedNodeId = ''
        state.autoFollow = true
        state.lastCenterKey = ''
        if (state.selectedTaskId) await loadDetail()
        else {
          state.task = null
          state.nodes = []
          renderAll()
        }
        return
      }
      const current = state.tasks.find((task) => task.taskId === state.selectedTaskId)
      if (current && state.task) {
        state.task = { ...state.task, status: current.status, summary: current.summary, settledAt: current.settledAt }
        renderSummary()
      }
      renderRail()
    } catch (error) {
      showError('列表拉取失败：' + ((error && error.message) || '网络错误'))
    }
  }

  async function loadDetail() {
    if (state.disposed || !state.selectedTaskId) return
    try {
      const body = await requestJson(`/tasks?taskId=${encodeURIComponent(state.selectedTaskId)}&live=1`, null, 8000)
      if (state.disposed) return
      showError('')
      state.task = body?.task || null
      state.nodes = Array.isArray(body?.nodes) ? body.nodes : []
      if (!state.selectedNodeId || nodeIndexById(state.selectedNodeId) < 0) {
        state.selectedNodeId = pickDefaultNode()
      }
      renderAll({ preserveView: state.lastCenterKey !== '' })
    } catch (error) {
      showError('任务详情拉取失败：' + ((error && error.message) || '网络错误'))
    }
  }

  function startTimers() {
    stopTimers()
    state.listTimer = setInterval(() => {
      if (!state.open || state.disposed) return
      void loadList()
    }, TV_LIST_MS)
    state.detailTimer = setInterval(() => {
      if (!state.open || state.disposed) return
      if (state.task && state.task.status !== 'running') return
      if (!state.selectedTaskId) return
      void loadDetail()
    }, TV_DETAIL_MS)
  }

  function stopTimers() {
    if (state.listTimer !== null) clearInterval(state.listTimer)
    if (state.detailTimer !== null) clearInterval(state.detailTimer)
    state.listTimer = null
    state.detailTimer = null
  }

  // ---- pan / zoom
  let drag = null
  function onPointerDown(event) {
    if (typeof event?.button === 'number' && event.button !== 0) return
    drag = { x: Number(event?.clientX) || 0, y: Number(event?.clientY) || 0, tx: state.tx, ty: state.ty }
    viewport.setAttribute('data-dragging', '1')
  }
  function onPointerMove(event) {
    if (drag === null) return
    state.autoFollow = false
    state.tx = drag.tx + ((Number(event?.clientX) || 0) - drag.x)
    state.ty = drag.ty + ((Number(event?.clientY) || 0) - drag.y)
    applyTransform()
  }
  function onPointerUp() {
    drag = null
    viewport.setAttribute('data-dragging', '0')
  }
  function onWheel(event) {
    if (typeof event?.preventDefault === 'function') event.preventDefault()
    const delta = Number(event?.deltaY) || 0
    const next = Math.max(TV_MIN_SCALE, Math.min(TV_MAX_SCALE, state.scale * (delta > 0 ? 0.92 : 1.08)))
    if (next === state.scale) return
    state.autoFollow = false
    const { width, height } = viewportSize(viewport)
    const ratio = next / state.scale
    // Zoom around the viewport centre.
    state.tx = width / 2 - (width / 2 - state.tx) * ratio
    state.ty = height / 2 - (height / 2 - state.ty) * ratio
    state.scale = next
    applyTransform()
  }
  function onKeyDown(event) {
    if (event?.key === 'Escape') close()
  }
  function onResize() {
    if (!state.open) return
    fit()
  }

  if (typeof viewport.addEventListener === 'function') {
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener('wheel', onWheel, { passive: false })
  }
  if (typeof doc.addEventListener === 'function') {
    doc.addEventListener('pointermove', onPointerMove)
    doc.addEventListener('pointerup', onPointerUp)
    doc.addEventListener('keydown', onKeyDown)
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', onResize)
  }
  if (typeof refreshButton.addEventListener === 'function') {
    refreshButton.addEventListener('click', () => {
      state.autoFollow = true
      state.lastCenterKey = ''
      void loadList()
      void loadDetail()
    })
  }
  if (typeof closeButton.addEventListener === 'function') closeButton.addEventListener('click', () => close())
  if (typeof scrim.addEventListener === 'function') scrim.addEventListener('click', () => close())

  function open() {
    if (state.disposed) return false
    if (state.open) return true
    state.open = true
    root.setAttribute('data-open', '1')
    state.autoFollow = true
    state.lastCenterKey = ''
    startTimers()
    void loadList()
    return true
  }

  function close() {
    if (!state.open) return false
    state.open = false
    root.setAttribute('data-open', '0')
    stopTimers()
    if (typeof options.onClose === 'function') options.onClose()
    return true
  }

  function toggle() {
    return state.open ? (close(), false) : open()
  }

  function dispose() {
    if (state.disposed) return
    stopTimers()
    state.disposed = true
    if (typeof viewport.removeEventListener === 'function') {
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener('wheel', onWheel)
    }
    if (typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('pointermove', onPointerMove)
      doc.removeEventListener('pointerup', onPointerUp)
      doc.removeEventListener('keydown', onKeyDown)
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', onResize)
    }
    if (root.parentNode && typeof root.parentNode.removeChild === 'function') root.parentNode.removeChild(root)
  }

  return {
    root,
    open,
    close,
    toggle,
    isOpen: () => state.open,
    refresh: () => {
      state.autoFollow = true
      state.lastCenterKey = ''
      void loadList()
      void loadDetail()
    },
    selectTask: (taskId) => {
      if (typeof taskId !== 'string' || taskId === '') return false
      state.selectedTaskId = taskId
      state.selectedNodeId = ''
      state.lastCenterKey = ''
      state.autoFollow = true
      renderRail()
      void loadDetail()
      return true
    },
    /** Test seam: show data without going through the network. */
    ingest: ({ tasks, task, nodes } = {}) => {
      if (Array.isArray(tasks)) state.tasks = tasks
      if (task !== undefined) state.task = task
      if (Array.isArray(nodes)) {
        state.nodes = nodes
        state.selectedNodeId = pickDefaultNode()
      }
      renderAll()
    },
    get data() {
      return {
        tasks: state.tasks,
        task: state.task,
        nodes: state.nodes,
        selectedTaskId: state.selectedTaskId,
        selectedNodeId: state.selectedNodeId,
      }
    },
    dispose,
  }
}

// Offline tests drill the geometry helpers directly.
export const __testTaskView = { TV_NODE_W, TV_NODE_H, TV_KIND, TV_STATUS }
