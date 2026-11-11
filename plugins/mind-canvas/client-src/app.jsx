import React from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
} from '@xyflow/react'
import xyflowCss from '@xyflow/react/dist/style.css'
import { toPng } from 'html-to-image'
import { CSS } from './style.js'
import { format } from './strings.js'
import * as api from './api.js'
import { THEME_PRESETS, normalizeTheme, themeStyle, defaultCustom, swatchList } from './theme.js'
import { EXPORT_FORMATS, renderExport, filenameFor } from './export.js'
import {
  CARD_WIDTH,
  TONES,
  bounds,
  childIds,
  createDoc,
  createNode,
  estimateHeight,
  findDoc,
  layoutDoc,
  nextChildPosition,
  normalizeState,
  roots,
  subtreeIds,
  toneForDoc,
  withNode,
  withPosition,
  withText,
  withTone,
  withTheme,
  withoutSubtree,
  reparent,
  docStats,
} from './model.js'

/** 新节点落在视野外时，把镜头挪到它身上（已经在视野里就不动，避免镜头乱跳）。 */
export function revealNode(stage, x, y, height) {
  const rf = stage?.__rf
  if (!rf || typeof rf.getViewport !== 'function') return
  const viewport = rf.getViewport()
  const width = stage.clientWidth ?? 0
  const tall = stage.clientHeight ?? 0
  if (!width || !tall) return
  const margin = 110
  const left = x * viewport.zoom + viewport.x
  const top = y * viewport.zoom + viewport.y
  const right = left + CARD_WIDTH * viewport.zoom
  const bottom = top + Math.max(48, height) * viewport.zoom
  if (left >= margin && top >= margin && right <= width - margin && bottom <= tall - margin) return
  rf.setCenter(x + CARD_WIDTH / 2, y + Math.max(48, height) / 2, { zoom: viewport.zoom, duration: 240 })
}

const h = React.createElement

/** 卡片的六个色相。CSS 里用 color-mix 叠到卡片上，MiniMap 需要具体颜色值。 */
const TONE_COLORS = {
  a: '#3a5bd9', b: '#0f8f6d', c: '#b1661b', d: '#a03a86', e: '#2f7fa8', f: '#6b5bd0',
}
const EMPTY = { version: 1, docs: [], activeId: '', revision: 0 }

export function injectStylesOnce(doc) {
  if (typeof document === 'undefined') return () => {}
  const tagId = 'dsh-mind-canvas/client.css'
  const previous = doc.querySelector(`style[data-plugin-css="${tagId}"]`)
  if (previous) previous.remove()
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-mind-canvas'
  tag.dataset.pluginCss = tagId
  tag.textContent = `${xyflowCss}\n${CSS}`
  doc.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

// --------------------------------------------------------------------- 图标
const icon = (paths, size = 14) => h('svg', {
  width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true,
}, paths.map((d, index) => h('path', { key: index, d })))

const icons = {
  plus: icon(['M8 3v10', 'M3 8h10']),
  branch: icon(['M5 4v5a3 3 0 0 0 3 3h3', 'M8.5 9.5 11 12l-2.5 2.5', 'M5 4h6']),
  arrange: icon(['M2 4h4', 'M2 8h7', 'M2 12h4', 'M10 4v8', 'M8 10l2 2 2-2']),
  spark: icon(['M8 2v3', 'M8 11v3', 'M2 8h3', 'M11 8h3', 'M4 4l1.6 1.6', 'M10.4 10.4 12 12', 'M12 4l-1.6 1.6', 'M5.6 10.4 4 12']),
  trash: icon(['M3 5h10', 'M6 5V3.5h4V5', 'M4.5 5l.6 8h5.8l.6-8']),
  download: icon(['M8 2v8', 'M4.5 7 8 10.5 11.5 7', 'M3 13h10']),
  undo: icon(['M6 4 3 7l3 3', 'M3 7h6a4 4 0 0 1 0 8H7']),
  redo: icon(['M10 4l3 3-3 3', 'M13 7H7a4 4 0 0 0 0 8h2']),
  fit: icon(['M3 6V3h3', 'M13 6V3h-3', 'M3 10v3h3', 'M13 10v3h-3']),
  bulb: icon(['M6 12h4', 'M6.5 14h3', 'M5 9a3.6 3.6 0 1 1 6 0c-.6.7-1 1.2-1 2H6c0-.8-.4-1.3-1-2Z']),
  close: icon(['M4 4l8 8', 'M12 4l-8 8']),
  check: icon(['M3.5 8.5 6.5 11.5 12.5 4.5']),
  edit: icon(['M3 13h2l7-7-2-2-7 7v2Z']),
  chevron: icon(['M6 4l4 4-4 4'], 12),
  back: icon(['M10 3 5 8l5 5'], 13),
  palette: icon(['M8 13.5a5.5 5.5 0 1 1 0-11c3 0 5 1.7 5 3.6 0 1.4-1 2.1-2 2.1h-1.1a1.4 1.4 0 0 0-1 2.4 1.3 1.3 0 0 1-1 2.9Z', 'M6 6.2h.01', 'M5 8.6h.01', 'M6.6 10.6h.01'], 14),
  image: icon(['M2.5 4.5h11v7h-11z', 'M2.5 9.5l3-3 2.5 2.5 2-2 3.5 3.5', 'M10.5 6.6h.01'], 13),
}

/** 浏览器里把一段文本/Blob 变成下载。 */
function triggerDownload(content, filename, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

// --------------------------------------------------------------------- 卡片
const NodeCard = React.memo(function NodeCard(props) {
  const { data } = props
  const {
    text, tone, layout, selected, isRoot, collapsible, collapsed, hiddenCount, editing,
    onCommit, onStartEdit, onCancelEdit, onToggleCollapse, t,
  } = data
  const textareaRef = React.useRef(null)
  const [draft, setDraft] = React.useState(text)

  React.useEffect(() => {
    if (editing) setDraft(text)
  }, [editing, text])

  React.useEffect(() => {
    if (!editing) return undefined
    const focus = () => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    focus()
    // React Flow 会把焦点拉回节点本身，等它拉完再补一次；
    // 只有当焦点还在画布上（body / 节点内部）时才抢，用户已经点到别处就不抢。
    const stolenByCanvas = () => {
      const active = typeof document === 'undefined' ? null : document.activeElement
      if (!active || active === document.body) return true
      return Boolean(active.closest?.('.react-flow__node'))
    }
    const timers = [90, 240].map(delay => setTimeout(() => {
      if (stolenByCanvas()) focus()
    }, delay))
    return () => timers.forEach(clearTimeout)
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    onCommit(next === text ? null : next)
  }

  const onKeyDown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancelEdit()
    }
    event.stopPropagation()
  }

  const horizontal = layout !== 'tree-down'
  return h('div', {
    className: `mc-node${selected ? ' is-selected' : ''}${isRoot ? ' is-root' : ''}`,
    'data-tone': tone,
    'data-node-id': props.id,
  },
  h(Handle, {
    type: 'target',
    position: horizontal ? Position.Left : Position.Top,
    isConnectable: false,
  }),
  h('div', { className: 'mc-card' },
    editing
      ? h('textarea', {
        ref: textareaRef,
        className: 'mc-card-edit nodrag nopan',
        value: draft,
        placeholder: t('nodePlaceholder'),
        rows: 3,
        onKeyDown,
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
      })
      : h('div', {
        className: `mc-card-text${text ? '' : ' is-empty'}`,
        onDoubleClick: event => {
          event.stopPropagation()
          onStartEdit()
        },
        title: text,
      }, text || t('nodePlaceholder')),

  ),
  h(Handle, {
    type: 'source',
    position: horizontal ? Position.Right : Position.Bottom,
    isConnectable: false,
  }),
  collapsible
    ? h('button', {
      type: 'button',
      className: 'mc-collapse nodrag',
      'data-hidden': collapsed ? 'true' : 'false',
      title: collapsed ? format(t('collapsed'), { n: hiddenCount }) : t('collapse'),
      'aria-label': collapsed ? t('expand') : t('collapse'),
      onClick: event => {
        event.stopPropagation()
        onToggleCollapse()
      },
    }, collapsed ? hiddenCount : '\u2212')
    : null,
  )
})

// --------------------------------------------------------------------- 表单件
function Dialog({ title, children, footer, onClose }) {
  React.useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return h('div', { className: 'mc-scrim', onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'mc-dialog', role: 'dialog', 'aria-label': title },
      h('header', null, h('h3', null, title), h('button', {
        type: 'button', className: 'mc-btn mc-icon', onClick: onClose, 'aria-label': 'close',
      }, icons.close)),
      h('div', { className: 'mc-body' }, children),
      footer ? h('footer', null, footer) : null,
    ))
}

// --------------------------------------------------------------------- 画布
function Canvas(props) {
  const {
    t, doc, selectedId, editingId, state, dispatch, toast,
    onSelect, onStartEdit, onCancelEdit, onCommitText,
    onDoublePaneClick, onViewportChange, stageRef,
  } = props
  const rf = useReactFlow()
  const measuredRef = React.useRef(new Map())
  const [measureTick, setMeasureTick] = React.useState(0)

  const collapsedSet = React.useMemo(
    () => new Set((doc?.collapsed ?? []).filter(id => doc?.nodes.some(node => node.id === id))),
    [doc],
  )

  const hiddenByCollapse = React.useMemo(() => {
    if (!doc) return new Set()
    const hidden = new Set()
    if (collapsedSet.size === 0) return hidden
    const walk = (id, shielded) => {
      for (const childId of childIds(doc, id)) {
        if (shielded) hidden.add(childId)
        walk(childId, shielded || collapsedSet.has(childId))
      }
    }
    for (const rootNode of roots(doc)) walk(rootNode.id, collapsedSet.has(rootNode.id))
    return hidden
  }, [doc, collapsedSet])

  const visibleCount = doc ? doc.nodes.length - hiddenByCollapse.size : 0

  const nodes = React.useMemo(() => {
    if (!doc) return []
    const horizontal = doc.layout !== 'tree-down'
    return doc.nodes
      .filter(node => !hiddenByCollapse.has(node.id))
      .map(node => {
        const collapsed = collapsedSet.has(node.id)
        const measured = measuredRef.current.get(node.id)
        return {
          id: node.id,
          type: 'mc',
          position: { x: node.x, y: node.y },
          ...(measured ? { measured } : {}),
          className: 'mc-node-wrap',
          draggable: true,
          data: {
            text: node.text,
            tone: node.tone,
            layout: doc.layout,
            selected: node.id === selectedId,
            isRoot: !node.parentId,
            editing: node.id === editingId,
            collapsible: childIds(doc, node.id).length > 0,
            collapsed,
            hiddenCount: collapsed ? subtreeIds(doc, node.id).length - 1 : 0,
            t,
            onCommit: text => onCommitText(node.id, text),
            onStartEdit: () => onStartEdit(node.id),
            onCancelEdit,
            onToggleCollapse: () => dispatch({ type: 'toggleCollapse', id: node.id }),
            horizontal,
          },
        }
      })
  }, [doc, selectedId, editingId, collapsedSet, measureTick, t, onCommitText, onStartEdit, onCancelEdit, dispatch])

  const edges = React.useMemo(() => {
    if (!doc) return []
    return doc.nodes
      .filter(node => node.parentId && !hiddenByCollapse.has(node.id))
      .map(node => ({
        id: `e:${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: node.id === selectedId || node.parentId === selectedId
            ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent)'
            : 'var(--dsw-alias-border-l2)',
          strokeWidth: node.id === selectedId ? 1.8 : 1.3,
        },
      }))
  }, [doc, selectedId, hiddenByCollapse])

  const nodeTypes = React.useMemo(() => ({ mc: NodeCard }), [])

  // 受控模式下必须自己接住 dimensions 变更，否则节点永远没有 measured：
  // MiniMap 画不出方块，fitView 也只能按 0 尺寸算。
  const onNodesChange = React.useCallback(changes => {
    let moved = null
    let measured = false
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        moved = change
      } else if (change.type === 'dimensions' && change.dimensions) {
        const previous = measuredRef.current.get(change.id)
        if (!previous || previous.width !== change.dimensions.width || previous.height !== change.dimensions.height) {
          measuredRef.current.set(change.id, change.dimensions)
          measured = true
        }
      }
    }
    if (measured) setMeasureTick(tick => (tick + 1) % 100000)
    if (moved) dispatch({ type: 'moveNode', id: moved.id, x: moved.position.x, y: moved.position.y })
  }, [dispatch])

  const onNodeDragStart = React.useCallback(() => dispatch({ type: 'snapshot' }), [dispatch])

  return h('div', {
    className: 'mc-stage',
    ref: stageRef,
    onDoubleClick: event => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      // 背景层可能盖在 pane 上，所以反过来排除「不该新建的地方」
      if (target.closest('.react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, .mc-toolbar, .mc-corner, .mc-empty-card, .mc-dialog, button, input, textarea, select, a')) return
      onDoublePaneClick(event)
    },
  },
  h('div', { className: 'mc-grid', 'aria-hidden': true }),
  doc
    ? h(ReactFlow, {
      nodes,
      edges,
      nodeTypes,
      onNodesChange,
      onNodeDragStart,
      onNodeClick: (event, node) => onSelect(node.id),
      onPaneClick: () => onSelect(null),
      onMoveEnd: (event, viewport) => onViewportChange(viewport),
      fitView: true,
      fitViewOptions: { padding: 0.22, maxZoom: 1.1 },
      minZoom: 0.15,
      maxZoom: 2.5,
      nodesDraggable: true,
      nodesConnectable: false,
      elementsSelectable: false,
      zoomOnDoubleClick: false,
      panOnScroll: false,
      onlyRenderVisibleElements: true,
      proOptions: { hideAttribution: false },
      defaultEdgeOptions: { type: 'smoothstep' },
    },
    h(Background, { variant: BackgroundVariant.Dots, gap: 26, size: 1, color: 'var(--dsw-alias-border-l2)' }),
    h(Controls, { showInteractive: false, position: 'bottom-left' }),
    h(MiniMap, {
      position: 'bottom-right',
      pannable: true,
      zoomable: true,
      nodeColor: node => TONE_COLORS[node?.data?.tone] ?? TONE_COLORS.a,
      nodeStrokeWidth: 0,
      maskColor: 'rgba(122,132,154,.16)',
      style: { width: 132, height: 92 },
    }))
    : null,
  )
}

// --------------------------------------------------------------------- 主页面
export function MindCanvasPage(props) {
  const t = props.t
  const onExit = props.onExit
  const lang = props.lang === 'en' ? 'en' : 'zh'
  const [state, setState] = React.useState(EMPTY)
  const [status, setStatus] = React.useState('loading')
  const [loadError, setLoadError] = React.useState(null)
  const [storage, setStorage] = React.useState('host')
  const [selectedId, setSelectedId] = React.useState(null)
  const [editingId, setEditingId] = React.useState(null)
  const [toast, setToast] = React.useState(null)
  const [dialog, setDialog] = React.useState(null)
  const [saveState, setSaveState] = React.useState('idle')
  const [menu, setMenu] = React.useState(null)
  const [imports, setImports] = React.useState(null)

  const historyRef = React.useRef({ past: [], future: [] })
  const docRef = React.useRef(null)
  const stageRef = React.useRef(null)
  const saveTimer = React.useRef(null)
  const savedRevRef = React.useRef(-1)
  const dirtyRef = React.useRef(false)

  const doc = React.useMemo(() => findDoc(state, state.activeId), [state])

  React.useEffect(() => {
    if (!doc) { docRef.current = null; return }
    docRef.current = doc
  }, [doc])

  const notify = React.useCallback((message, kind = 'info') => {
    setToast({ message, kind, key: Date.now() })
  }, [])

  React.useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  // ------------------------------------------------------------- 读取
  const load = React.useCallback(async () => {
    setStatus('loading')
    setLoadError(null)
    try {
      const payload = await api.getState()
      const next = normalizeState(payload?.state ?? payload)
      savedRevRef.current = next.revision
      dirtyRef.current = false
      setState(next)
      setStorage('host')
      setSaveState('idle')
      setStatus('ready')
    } catch (error) {
      // 宿主路由还没注册（插件刚装上没重启）时退回本地，至少能画
      let local = null
      try {
        local = JSON.parse(window.localStorage.getItem('dsh-mind-canvas') ?? 'null')
      } catch { local = null }
      if (local) {
        const next = normalizeState(local)
        savedRevRef.current = next.revision
        dirtyRef.current = false
        setState(next)
        setStorage('local')
        setSaveState('idle')
        setStatus('ready')
        setLoadError(error)
        return
      }
      setLoadError(error)
      setStatus('error')
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  // ------------------------------------------------------------- 保存
  const flush = React.useCallback(async () => {
    if (!dirtyRef.current) return
    const snapshot = { ...stateRef.current }
    dirtyRef.current = false
    setSaveState('saving')
    try {
      if (storageRef.current === 'host') await api.putState(snapshot)
      else window.localStorage.setItem('dsh-mind-canvas', JSON.stringify(snapshot))
      savedRevRef.current = snapshot.revision
      setSaveState('saved')
      setLoadError(null)
    } catch (error) {
      dirtyRef.current = true
      setSaveState('error')
      notify(format(t('saveFailed'), { message: error.message }), 'error')
    }
  }, [notify, t])

  const stateRef = React.useRef(state)
  stateRef.current = state
  const storageRef = React.useRef(storage)
  storageRef.current = storage

  React.useEffect(() => {
    if (status !== 'ready') return
    if (state.revision === savedRevRef.current) return
    dirtyRef.current = true
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { flush() }, 420)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [state, status, flush])

  React.useEffect(() => () => {
    if (dirtyRef.current) {
      const snapshot = stateRef.current
      if (storageRef.current === 'local') {
        try { window.localStorage.setItem('dsh-mind-canvas', JSON.stringify(snapshot)) } catch { /* 忽略 */ }
      } else if (navigator.sendBeacon) {
        try {
          navigator.sendBeacon('/mind-canvas/state', new Blob([JSON.stringify(snapshot)], { type: 'application/json' }))
        } catch { /* 忽略 */ }
      }
    }
  }, [])

  // ------------------------------------------------------------- 撤销栈
  const snapshot = React.useCallback(() => {
    const current = docRef.current
    if (!current) return
    const past = historyRef.current.past
    past.push(structuredClone(current))
    if (past.length > 60) past.shift()
    historyRef.current.future = []
  }, [])

  const bump = React.useCallback((nextDoc, options = {}) => {
    setState(previous => {
      const docs = previous.docs.map(item => (item.id === nextDoc.id ? nextDoc : item))
      return { ...previous, docs, activeId: nextDoc.id, revision: previous.revision + 1 }
    })
    if (options.select !== undefined) setSelectedId(options.select)
  }, [])

  const dispatch = React.useCallback(action => {
    const current = docRef.current
    if (!current) return
    switch (action.type) {
      case 'snapshot':
        snapshot()
        return
      case 'moveNode': {
        const target = current.nodes.find(node => node.id === action.id)
        if (!target) return
        if (Math.abs(target.x - action.x) < 0.01 && Math.abs(target.y - action.y) < 0.01) return
        bump(withPosition(current, action.id, action.x, action.y))
        return
      }
      case 'toggleCollapse': {
        snapshot()
        const collapsed = new Set(current.collapsed ?? [])
        if (collapsed.has(action.id)) collapsed.delete(action.id)
        else collapsed.add(action.id)
        bump({ ...current, collapsed: [...collapsed] })
        return
      }
      default:
        return
    }
  }, [bump, snapshot])

  // ------------------------------------------------------------- 动作
  const addNode = React.useCallback((parentId, text = '', position = null) => {
    const current = docRef.current
    if (!current) return
    snapshot()
    let x = position?.x
    let y = position?.y
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (parentId) {
        const spot = nextChildPosition(current, parentId)
        x = spot.x
        y = spot.y
      } else {
        const box = bounds(current)
        x = 0
        y = box ? box.y + box.height + 70 : 0
        if (current.nodes.length === 0) { x = 0; y = 0 }
      }
    }
    const node = createNode({
      text,
      parentId: parentId ?? null,
      x,
      y,
      tone: parentId
        ? (current.nodes.find(item => item.id === parentId)?.tone ?? 'a')
        : toneForDoc(current),
    })
    const next = withNode(current, node)
    const wasEmpty = current.nodes.length === 0
    bump(next, { select: node.id })
    setEditingId(node.id)
    if (wasEmpty) {
      // 第一颗节点：把视野挪过去，否则它贴在世界原点角落里
      setTimeout(() => stageRef.current?.__rf?.fitView?.({ padding: 0.45, duration: 320, maxZoom: 1.1 }), 60)
    } else {
      // 新节点长到视野外就把镜头跟过去，否则一片空白不知道它去哪了
      setTimeout(() => revealNode(stageRef.current, x, y, estimateHeight(text)), 50)
    }
    return node.id
  }, [bump, snapshot])

  const commitText = React.useCallback((id, text) => {
    setEditingId(null)
    if (text === null) return
    const current = docRef.current
    if (!current) return
    const target = current.nodes.find(node => node.id === id)
    if (!target) return
    if (!text) {
      snapshot()
      const next = withoutSubtree(current, id)
      bump(next, { select: null })
      return
    }
    if (text === target.text) return
    snapshot()
    bump(withText(current, id, text))
  }, [bump, snapshot])

  const deleteSelected = React.useCallback(() => {
    const current = docRef.current
    if (!current || !selectedId) return
    const target = current.nodes.find(node => node.id === selectedId)
    if (!target) return
    snapshot()
    bump(withoutSubtree(current, selectedId), { select: target.parentId ?? null })
    notify(t('deleteNode'))
  }, [bump, notify, selectedId, snapshot, t])

  const arrange = React.useCallback((direction) => {
    const current = docRef.current
    if (!current || current.nodes.length === 0) return
    snapshot()
    bump(layoutDoc(current, direction ?? current.layout ?? 'tree-right'))
    setTimeout(() => {
      const instance = stageRef.current?.__rf
      instance?.fitView?.({ padding: 0.22, duration: 320 })
    }, 40)
  }, [bump, snapshot])

  const setTone = React.useCallback(tone => {
    const current = docRef.current
    if (!current || !selectedId) return
    const target = current.nodes.find(node => node.id === selectedId)
    if (!target || target.tone === tone) {
      setMenu(null)
      return
    }
    snapshot()
    bump(withTone(current, selectedId, tone))
    setMenu(null)
  }, [bump, selectedId, snapshot])

  const applyTheme = React.useCallback(theme => {
    const current = docRef.current
    if (!current) return
    snapshot()
    bump(withTheme(current, normalizeTheme(theme)))
    setMenu(null)
  }, [bump, snapshot])

  const undo = React.useCallback(() => {
    const past = historyRef.current.past
    if (past.length === 0) { notify(t('nothingToUndo')); return }
    const current = docRef.current
    const previous = past.pop()
    historyRef.current.future.push(structuredClone(current))
    bump(previous, { select: null })
  }, [bump, notify, t])

  const redo = React.useCallback(() => {
    const future = historyRef.current.future
    if (future.length === 0) { notify(t('nothingToUndo')); return }
    const next = future.pop()
    historyRef.current.past.push(structuredClone(docRef.current))
    bump(next, { select: null })
  }, [bump, notify, t])

  const newDoc = React.useCallback(() => {
    const fresh = createDoc({ title: t('newDocTitle') })
    setState(previous => ({ ...previous, docs: [...previous.docs, fresh], activeId: fresh.id, revision: previous.revision + 1 }))
    setSelectedId(null)
    setEditingId(null)
    historyRef.current = { past: [], future: [] }
  }, [t])

  const deleteDoc = React.useCallback(() => {
    setDialog(null)
    setState(previous => {
      if (previous.docs.length <= 1) return previous
      const docs = previous.docs.filter(item => item.id !== previous.activeId)
      return { ...previous, docs, activeId: docs[0].id, revision: previous.revision + 1 }
    })
    setSelectedId(null)
    historyRef.current = { past: [], future: [] }
  }, [])

  const renameDoc = React.useCallback(() => {
    const current = docRef.current
    if (!current) return
    const title = window.prompt(t('rename'), current.title)
    if (title === null) return
    const clean = title.trim()
    if (!clean || clean === current.title) return
    setState(previous => ({
      ...previous,
      docs: previous.docs.map(item => (item.id === current.id ? { ...item, title: clean } : item)),
      revision: previous.revision + 1,
    }))
  }, [t])

  const runExport = React.useCallback(async formatId => {
    const current = docRef.current
    if (!current) return
    setMenu(null)
    try {
      if (formatId === 'png') {
        const stage = stageRef.current
        const target = stage?.querySelector('.react-flow') ?? stage
        if (!target) throw new Error('画布还没准备好')
        const dataUrl = await toPng(target, {
          backgroundColor: getComputedStyle(stage).getPropertyValue('background-color') || '#ffffff',
          pixelRatio: 2,
          cacheBust: true,
          filter: node => !(node instanceof Element) || !node.classList?.contains('react-flow__attribution'),
        })
        const blob = await (await fetch(dataUrl)).blob()
        const name = filenameFor(current, '.png')
        triggerDownload(blob, name, 'image/png')
        notify(format(t('exportDone'), { name }))
        return
      }
      const spec = EXPORT_FORMATS.find(item => item.id === formatId)
      if (!spec) throw new Error(`unknown format ${formatId}`)
      const body = renderExport(current, formatId)
      const name = filenameFor(current, spec.ext)
      triggerDownload(body, name, spec.mime)
      notify(format(t('exportDone'), { name }))
    } catch (error) {
      notify(format(t('exportFailed'), { message: error.message }), 'error')
    }
  }, [notify, t])

  // ------------------------------------------------------------- 导入灵感
  const openImport = React.useCallback(async () => {
    setDialog({ kind: 'import' })
    setImports(null)
    try {
      const payload = await api.listInspirations()
      setImports(Array.isArray(payload?.items) ? payload.items : [])
    } catch (error) {
      setImports([])
      if (error.status !== 404 && error.status !== 501) notify(error.message, 'error')
    }
  }, [notify])

  const doImport = React.useCallback(items => {
    const current = docRef.current
    if (!current) return
    if (!items.length) return
    snapshot()
    let next = current
    const box = bounds(current)
    let y = box ? box.y + box.height + 80 : 0
    if (current.nodes.length === 0) y = 0
    for (const item of items) {
      const node = createNode({
        text: item.title,
        parentId: null,
        x: 0,
        y,
        tone: toneForDoc(next),
        source: { kind: 'media-desk', id: item.id, url: item.url ?? null },
      })
      next = withNode(next, node)
      y += estimateHeight(item.title) + 40
    }
    bump(next, { select: null })
    setDialog(null)
    setTimeout(() => arrange(), 60)
  }, [arrange, bump, snapshot])

  // ------------------------------------------------------------- AI 发散
  const runExpand = React.useCallback(async ({ count, angle }) => {
    const current = docRef.current
    const target = current?.nodes.find(node => node.id === selectedId)
    if (!current || !target) return
    setDialog({ kind: 'ai', running: true, count, angle })
    try {
      const payload = await api.expandNode({
        text: target.text,
        count,
        angle,
        siblings: childIds(current, target.id).map(id => current.nodes.find(node => node.id === id)?.text ?? ''),
        lang: (props.lang ?? 'zh'),
      })
      const ideas = Array.isArray(payload?.ideas) ? payload.ideas.filter(item => typeof item === 'string' && item.trim()) : []
      if (ideas.length === 0) throw new Error(t('aiNoModel'))
      snapshot()
      let next = current
      for (const idea of ideas) {
        const spot = nextChildPosition(next, target.id)
        next = withNode(next, createNode({
          text: idea.trim(),
          parentId: target.id,
          x: spot.x,
          y: spot.y,
          tone: target.tone,
          source: { kind: 'ai' },
        }))
      }
      bump(next, { select: null })
      setDialog(null)
      setTimeout(() => arrange(), 60)
      notify(format(t('aiDone'), { n: ideas.length }))
    } catch (error) {
      setDialog({ kind: 'ai', error: error.message, count, angle })
    }
  }, [arrange, bump, notify, props.lang, selectedId, snapshot, t])

  // ------------------------------------------------------------- 键盘
  React.useEffect(() => {
    const onKeyDown = event => {
      const tag = event.target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        if (typing) return
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (typing || dialog) return
      if (event.key === 'Tab' && !event.altKey) {
        event.preventDefault()
        addNode(selectedId ?? roots(docRef.current ?? { nodes: [] })[0]?.id ?? null, '', null)
        return
      }
      if (event.key === 'Enter') {
        if (!selectedId) return
        event.preventDefault()
        if (meta) { setDialog({ kind: 'ai', count: 4 }); return }
        setEditingId(selectedId)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (!selectedId) return
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === 'Escape') {
        if (menu) { setMenu(null); return }
        setEditingId(null)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addNode, deleteSelected, dialog, menu, redo, selectedId, undo])

  // ------------------------------------------------------------- 视图
  const onDoublePaneClick = React.useCallback(event => {
    const stage = stageRef.current
    if (!stage) return
    const instance = stage.__rf
    if (!instance?.screenToFlowPosition) { addNode(null, '', null); return }
    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNode(null, '', position)
  }, [addNode])

  // 视口平移/缩放是高频事件，必须用函数式更新：拿 docRef 里的快照会覆盖掉同一帧里刚加进来的节点。
  const onViewportChange = React.useCallback(viewport => {
    setState(previous => {
      const current = findDoc(previous, previous.activeId)
      if (!current) return previous
      const view = current.view
      if (view && Math.abs(view.zoom - viewport.zoom) < 0.001
        && Math.abs(view.x - viewport.x) < 0.5 && Math.abs(view.y - viewport.y) < 0.5) return previous
      return {
        ...previous,
        docs: previous.docs.map(item => (item.id === current.id
          ? { ...item, view: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } }
          : item)),
        revision: previous.revision + 1,
      }
    })
  }, [])

  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    // React Flow 实例挂在容器上时拿它做双击新建与 fitView
    const timer = setTimeout(() => {
      const instance = stage.querySelector?.('[data-testid="rf__wrapper"]')
      void instance
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const stats = React.useMemo(() => (doc ? docStats(doc) : { nodes: 0, roots: 0, depth: 0 }), [doc])
  const selectedNode = doc?.nodes.find(node => node.id === selectedId) ?? null

  const theme = normalizeTheme(doc?.theme)
  const themeVars = themeStyle(theme)
  // 点阵颜色跟着主题走：优先读宿主当前 token，读不到再按明暗猜一个
  const gridColor = React.useMemo(() => {
    if (typeof document === 'undefined') return 'rgba(0,0,0,.10)'
    const probe = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-border-l2').trim()
    if (probe) return probe
    return document.body?.dataset?.dsDarkTheme !== undefined ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.10)'
  }, [theme.preset])

  if (status === 'loading') {
    return h('div', { className: 'mc-root' }, h('div', { className: 'mc-center' }, t('loading')))
  }
  if (status === 'error') {
    return h('div', { className: 'mc-root' },
      h('div', { className: 'mc-center' },
        h('div', null,
          h('p', null, format(t('loadFailed'), { message: loadError?.message ?? '' })),
          h('button', { type: 'button', className: 'mc-btn is-primary', onClick: load }, t('retry')),
        )))
  }

  const isEmpty = !doc || doc.nodes.length === 0

  return h('div', { className: 'mc-root', style: themeVars, 'data-theme': theme.preset },
    // 顶栏
    h('header', { className: 'mc-bar' },
      h('button', {
        type: 'button',
        className: 'mc-btn mc-back',
        title: t('back'),
        onClick: () => onExit?.(),
      }, icons.back, t('back')),
      h('div', { className: 'mc-brand' },
        h('b', null, t('appTitle')),
        h('small', null, t('appSub')),
      ),
      h('select', {
        className: 'mc-select',
        value: state.activeId,
        'aria-label': t('docs'),
        onChange: event => {
          setState(previous => ({ ...previous, activeId: event.target.value, revision: previous.revision + 1 }))
          setSelectedId(null)
          setEditingId(null)
          historyRef.current = { past: [], future: [] }
        },
      }, state.docs.map(item => h('option', { key: item.id, value: item.id }, item.title))),
      h('button', { type: 'button', className: 'mc-btn mc-icon', title: t('newDoc'), onClick: newDoc }, icons.plus),
      h('button', { type: 'button', className: 'mc-btn mc-icon', title: t('rename'), onClick: renameDoc }, icons.edit),
      h('span', { className: 'mc-grow' }),
      h('div', { className: 'mc-split' },
        h('button', {
          type: 'button', className: 'mc-btn', title: t('arrange'),
          onClick: () => arrange('tree-right'),
        }, icons.arrange, t('arrangeRight')),
        h('button', {
          type: 'button', className: 'mc-btn', title: t('arrangeDown'),
          onClick: () => arrange('tree-down'),
        }, t('arrangeDown')),
      ),
      h('button', { type: 'button', className: 'mc-btn', onClick: openImport }, icons.bulb, t('importInspiration')),

      h('div', { className: 'mc-anchor' },
        h('button', {
          type: 'button',
          className: `mc-btn${menu === 'theme' ? ' is-on' : ''}`,
          'aria-expanded': menu === 'theme',
          onClick: () => setMenu(menu === 'theme' ? null : 'theme'),
        }, icons.palette, t('theme')),
        menu === 'theme'
          ? h('div', { className: 'mc-menu', role: 'menu', 'aria-label': t('theme') },
            h('span', { className: 'mc-menu-title' }, t('themePresets')),
            THEME_PRESETS.map(preset => h('button', {
              key: preset.id,
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': theme.preset === preset.id,
              className: 'mc-menu-item',
              'data-preset': preset.id,
              onClick: () => applyTheme({ ...(theme.preset === 'custom' ? theme : {}), preset: preset.id }),
            },
            h('span', {
              className: 'mc-dot',
              style: { background: preset.vars?.bg ?? 'var(--dsw-alias-bg-base)', border: '1px solid var(--line-strong)' },
            }),
            preset.label[lang === 'en' ? 'en' : 'zh'],
            theme.preset === preset.id ? h('span', { className: 'mc-menu-check' }, icons.check) : null,
            )),
            h('div', { className: 'mc-menu-sep' }),
            h('button', {
              type: 'button',
              className: 'mc-menu-item',
              onClick: () => { setMenu(null); setDialog({ kind: 'theme' }) },
            }, icons.edit, t('themeCustom'), theme.preset === 'custom' ? h('span', { className: 'mc-menu-check' }, icons.check) : null),
          )
          : null,
      ),

      h('div', { className: 'mc-anchor' },
        h('button', {
          type: 'button',
          className: `mc-btn${menu === 'export' ? ' is-on' : ''}`,
          'aria-expanded': menu === 'export',
          onClick: () => setMenu(menu === 'export' ? null : 'export'),
        }, icons.download, t('exportTitle')),
        menu === 'export'
          ? h('div', { className: 'mc-menu', role: 'menu', 'aria-label': t('exportTitle') },
            EXPORT_FORMATS.map(item => h('button', {
              key: item.id,
              type: 'button',
              role: 'menuitem',
              className: 'mc-menu-item',
              'data-format': item.id,
              onClick: () => runExport(item.id),
            }, item.label[lang === 'en' ? 'en' : 'zh'], h('small', null, item.ext))),
            h('div', { className: 'mc-menu-sep' }),
            h('button', {
              type: 'button',
              role: 'menuitem',
              className: 'mc-menu-item',
              'data-format': 'png',
              onClick: () => runExport('png'),
            }, icons.image, t('exportPng'), h('small', null, '.png')),
          )
          : null,
      ),

      h('button', {
        type: 'button', className: 'mc-btn mc-icon', title: t('undo'), onClick: undo,
      }, icons.undo),
      h('button', {
        type: 'button', className: 'mc-btn mc-icon', title: t('redo'), onClick: redo,
      }, icons.redo),
      h('button', {
        type: 'button', className: 'mc-btn mc-icon', title: t('deleteDoc'), onClick: () => setDialog({ kind: 'deleteDoc' }),
      }, icons.trash),
    ),

    // 画布
    h('div', { className: 'mc-stage-wrap', style: { position: 'relative', flex: 1, minHeight: 0 } },
      h(ReactFlowProvider, null,
        h(Canvas, {
          t,
          doc,
          selectedId,
          editingId,
          state,
          dispatch,
          toast,
          onSelect: id => { setSelectedId(id); if (id !== editingId) setEditingId(null); if (menu) setMenu(null) },
          onStartEdit: id => setEditingId(id),
          onCancelEdit: () => setEditingId(null),
          onCommitText: commitText,
          onDoublePaneClick,
          onViewportChange,
          stageRef,
        }),
        h(CanvasBridge, { stageRef, doc }),
      ),

      selectedNode
        ? h(React.Fragment, null,
          h('div', { className: 'mc-toolbar' },
          h('span', { className: 'mc-toolbar-hint' }, `${format(t('nodes'), { n: stats.nodes })} · ${format(t('depth'), { n: stats.depth })}`),
          h('button', {
            type: 'button', className: 'mc-btn', onClick: () => addNode(selectedNode.id, '', null),
          }, icons.plus, t('addChild')),
          h('button', {
            type: 'button', className: 'mc-btn', onClick: () => setDialog({ kind: 'ai', count: 4 }),
          }, icons.spark, t('aiExpand')),
          h('button', {
            type: 'button',
            className: `mc-btn${menu === 'tone' ? ' is-on' : ''}`,
            'aria-expanded': menu === 'tone',
            onClick: () => setMenu(menu === 'tone' ? null : 'tone'),
          }, t('color')),

          h('button', {
            type: 'button', className: 'mc-btn', onClick: () => setEditingId(selectedNode.id),
          }, icons.edit, t('edit')),
          h('button', {
            type: 'button', className: 'mc-btn is-danger', onClick: deleteSelected,
          }, icons.trash, t('deleteNode')),
          ),
          menu === 'tone'
            ? h('div', { className: 'mc-swatches', role: 'radiogroup', 'aria-label': t('colorTitle') },
              TONES.map(tone => h('button', {
                key: tone,
                type: 'button',
                role: 'radio',
                'aria-checked': selectedNode.tone === tone,
                'aria-label': tone.toUpperCase(),
                'data-tone': tone,
                className: 'mc-swatch',
                'data-on': selectedNode.tone === tone,
                style: { background: `var(--tone-${tone})` },
                onClick: () => setTone(tone),
              })))
            : null,
        )
        : null,

      isEmpty
        ? h('div', { className: 'mc-empty' },
          h('div', { className: 'mc-empty-card' },
            h('h2', null, t('emptyTitle')),
            h('form', {
              className: 'mc-empty-row',
              onSubmit: event => { event.preventDefault(); addNode(null, '', null) },
            },
            h('input', {
              className: 'mc-input',
              placeholder: t('emptyPlaceholder'),
              'aria-label': t('emptyTitle'),
              onKeyDown: event => {
                if (event.key !== 'Enter') return
                const value = event.currentTarget.value.trim()
                event.preventDefault()
                if (!value) return
                addNode(null, value, null)
                event.currentTarget.value = ''
              },
            }),
            h('button', { type: 'submit', className: 'mc-btn is-primary' }, icons.plus, t('addChild')),
            ),
            h('div', { className: 'mc-empty-hint' }, t('emptyHint')),
          ))
        : null,

      h('div', { className: 'mc-corner' },
        saveState === 'saving' ? t('unsaved') : saveState === 'saved' ? t('saved') : t('hintKeys'),
      ),

      toast ? h('div', { className: 'mc-toast', 'data-kind': toast.kind, key: toast.key, role: 'status' }, toast.message) : null,

      // 弹层
      dialog?.kind === 'deleteDoc'
        ? h(Dialog, {
          title: t('deleteDoc'),
          onClose: () => setDialog(null),
          footer: h(React.Fragment, null,
            h('button', { type: 'button', className: 'mc-btn', onClick: () => setDialog(null) }, t('cancel')),
            h('button', { type: 'button', className: 'mc-btn is-danger', onClick: deleteDoc }, t('delete')),
          ),
        }, h('p', null, format(t('deleteDocBody'), { title: doc?.title ?? '' })))
        : null,

      dialog?.kind === 'import'
        ? h(ImportDialog, {
          t,
          items: imports,
          onClose: () => setDialog(null),
          onGo: doImport,
        })
        : null,

      dialog?.kind === 'theme'
        ? h(ThemeDialog, {
          t,
          lang,
          theme,
          onClose: () => setDialog(null),
          onApply: next => { applyTheme(next); setDialog(null) },
        })
        : null,

      dialog?.kind === 'ai'
        ? h(AiDialog, {
          t,
          running: Boolean(dialog.running),
          error: dialog.error,
          initialCount: dialog.count ?? 4,
          targetText: doc?.nodes.find(node => node.id === selectedId)?.text ?? '',
          onClose: () => setDialog(null),
          onGo: runExpand,
        })
        : null,
    ),

    loadError && storage === 'local'
      ? h('div', { className: 'mc-corner', style: { left: 12, right: 'auto' } }, '本地模式：没连上插件后端，先存在浏览器里')
      : null,
  )
}

/** 把 React Flow 实例挂到 stageRef 上，双击新建和整理后的 fitView 都要用。 */
function CanvasBridge({ stageRef }) {
  const rf = useReactFlow()
  React.useEffect(() => {
    if (!stageRef.current) return
    stageRef.current.__rf = rf
    return () => {
      if (stageRef.current && stageRef.current.__rf === rf) stageRef.current.__rf = null
    }
  }, [rf, stageRef])
  return null
}

// --------------------------------------------------------------------- 导入弹层
function ImportDialog({ t, items, onClose, onGo }) {
  const [picked, setPicked] = React.useState(() => new Set())
  const list = items ?? []
  const toggle = id => {
    setPicked(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return h(Dialog, {
    title: t('importTitle'),
    onClose,
    footer: h(React.Fragment, null,
      h('button', { type: 'button', className: 'mc-btn', onClick: onClose }, t('cancel')),
      h('button', {
        type: 'button',
        className: 'mc-btn is-primary',
        disabled: picked.size === 0,
        onClick: () => onGo(list.filter(item => picked.has(item.id))),
      }, format(t('importGo'), { n: picked.size })),
    ),
  },
  h('p', null, t('importBody')),
  items === null
    ? h('p', { className: 'mc-empty-hint' }, t('importLoading'))
    : list.length === 0
      ? h('p', { className: 'mc-empty-hint' }, t('importEmpty'))
      : h('div', { className: 'mc-picks' }, list.map(item => h('label', {
        key: item.id,
        className: `mc-pick${picked.has(item.id) ? ' is-on' : ''}`,
      },
      h('input', {
        type: 'checkbox',
        checked: picked.has(item.id),
        onChange: () => toggle(item.id),
      }),
      h('span', null,
        item.title,
        h('small', null, [item.kind, item.platform, item.createdAt?.slice(0, 10)].filter(Boolean).join(' · ')),
      ),
      ))),
  )
}

// --------------------------------------------------------------------- 主题弹层
function ThemeDialog({ t, lang, theme, onClose, onApply }) {
  const seed = React.useCallback(id => {
    const preset = THEME_PRESETS.find(item => item.id === id)
    setColors({ ...defaultCustom(), ...(preset?.vars ?? {}) })
    setPreset(id)
  }, [])

  const initial = React.useMemo(() => {
    if (theme.preset === 'custom') {
      return { preset: 'custom', colors: { ...defaultCustom(), ...(theme.custom ?? {}) } }
    }
    const preset = THEME_PRESETS.find(item => item.id === theme.preset) ?? THEME_PRESETS[0]
    return { preset: preset.id, colors: { ...defaultCustom(), ...(preset.vars ?? {}) } }
    // 只取初始值，后续交互走本地状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [preset, setPreset] = React.useState(initial.preset)
  const [colors, setColors] = React.useState(initial.colors)
  const rows = React.useMemo(() => swatchList({ preset: 'custom', custom: colors }), [colors])

  const setColor = (key, value) => {
    setColors(previous => ({ ...previous, [key]: value }))
    setPreset('custom')
  }

  return h(Dialog, {
    title: t('themeCustomTitle'),
    onClose,
    footer: h(React.Fragment, null,
      h('button', {
        type: 'button',
        className: 'mc-btn',
        onClick: () => seed('paper'),
      }, t('themeReset')),
      h('span', { className: 'mc-grow' }),
      h('button', { type: 'button', className: 'mc-btn', onClick: onClose }, t('cancel')),
      h('button', {
        type: 'button',
        className: 'mc-btn is-primary',
        'data-apply': 'theme',
        onClick: () => {
          if (preset === 'auto') onApply({ preset: 'auto' })
          else onApply({ preset: 'custom', custom: colors })
        },
      }, t('themeApply')),
    ),
  },
  h('p', null, t('themeCustomBody')),
  h('div', { className: 'mc-preset-row' }, THEME_PRESETS.map(item => h('button', {
    key: item.id,
    type: 'button',
    className: `mc-btn${preset === item.id ? ' is-on' : ''}`,
    'data-preset': item.id,
    onClick: () => seed(item.id),
  }, item.label[lang === 'en' ? 'en' : 'zh']))),
  h('div', { className: 'mc-theme-grid' }, rows.map(row => h('label', {
    key: row.key,
    className: 'mc-theme-row',
    'data-color-key': row.key,
  },
  h('span', null, row.label[lang === 'en' ? 'en' : 'zh']),
  h('input', {
    type: 'color',
    value: /^#[0-9a-f]{6}$/i.test(row.value) ? row.value : '#888888',
    onChange: event => setColor(row.key, event.target.value),
  }),
  h('code', null, row.value),
  ))),
  )
}

// --------------------------------------------------------------------- AI 弹层
function AiDialog({ t, running, error, initialCount, targetText, onClose, onGo }) {
  const [count, setCount] = React.useState(initialCount)
  const [angle, setAngle] = React.useState('')
  return h(Dialog, {
    title: t('aiTitle'),
    onClose,
    footer: h(React.Fragment, null,
      h('button', { type: 'button', className: 'mc-btn', onClick: onClose, disabled: running }, t('cancel')),
      h('button', {
        type: 'button',
        className: 'mc-btn is-primary',
        disabled: running,
        onClick: () => onGo({ count, angle: angle.trim() }),
      }, icons.spark, running ? t('aiRunning') : t('aiRun')),
    ),
  },
  h('p', null, format(t('aiBody'), { text: targetText, n: count })),
  h('div', { className: 'mc-label' },
    h('span', null, t('aiCount')),
    h('div', { className: 'mc-count' }, [3, 4, 5, 6].map(value => h('button', {
      key: value,
      type: 'button',
      className: `mc-btn${count === value ? ' is-on' : ''}`,
      onClick: () => setCount(value),
    }, value)))),
  h('label', { className: 'mc-label' },
    h('span', null, t('aiAngle')),
    h('textarea', {
      className: 'mc-textarea',
      rows: 2,
      placeholder: t('aiAnglePlaceholder'),
      value: angle,
      onChange: event => setAngle(event.target.value),
    })),
  error ? h('p', { style: { color: 'var(--danger)' } }, format(t('aiFailed'), { message: error })) : null,
  )
}
