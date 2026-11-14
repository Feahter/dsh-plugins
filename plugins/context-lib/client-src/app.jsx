import React from 'react'
import * as api from './api.js'
import { format } from './strings.js'
import { Markdown } from './markdown.js'
import { AssistDrawer } from './assist.jsx'
const h = React.createElement
const PAGE = 50
const VIEW_MODES = ['list', 'cards', 'table', 'gallery']
const VIEW_LABEL = {
  list: 'viewList',
  cards: 'viewCards',
  table: 'viewTable',
  gallery: 'viewGallery',
}
/** localStorage 在 smoke / 非浏览器环境下不一定可用，读写都兜底。 */
function readPref(key, fallback) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function writePref(key, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, value)
  } catch { /* 隐私模式下忽略 */ }
}
const MAX_PREVIEW = 20000
const MAX_LINES = 400
/** 这些格式自己渲染不了，交给宿主用 textutil / qlmanage 出文本或缩略图。 */
const DOC_PREVIEW_EXTS = /^(doc|docx|rtf|rtfd|odt|pdf|xls|xlsx|ppt|pptx|key|pages|numbers|epub|html|htm|xhtml)$/i
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}
const G = (tag, attrs) => h(tag, attrs)
const GLYPHS = {
  search: [G('circle', { cx: 7, cy: 7, r: 4.3 }), G('path', { d: 'M10.2 10.2 13.4 13.4' })],
  plus: [G('path', { d: 'M8 3v10M3 8h10' })],
  refresh: [G('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6' }), G('path', { d: 'M13 2.8V5.4h-2.6' })],
  scan: [G('path', { d: 'M2.4 8a5.6 5.6 0 0 1 5.6-5.6M13.6 8A5.6 5.6 0 0 1 8 13.6' }), G('circle', { cx: 8, cy: 8, r: 1.5 }), G('path', { d: 'M8 2.4v2M8 11.6v2M2.4 8h2M11.6 8h2' })],
  trash: [G('path', { d: 'M2.8 4.2h10.4M5.8 4.2V2.8h4.4v1.4M4.2 4.2l.7 9h6.2l.7-9M6.7 6.8v4M9.3 6.8v4' })],
  close: [G('path', { d: 'M4 4l8 8M12 4l-8 8' })],
  chevron: [G('path', { d: 'M6 3.6 10.4 8 6 12.4' })],
  expand: [G('path', { d: 'M2.4 6V2.4H6M10 2.4h3.6V6M13.6 10v3.6H10M6 13.6H2.4V10' })],
  collapse: [G('path', { d: 'M6 2.4V6H2.4M10 2.4V6h3.6M13.6 10H10v3.6M6 13.6V10H2.4' })],
  back: [G('path', { d: 'M13 8H3M7 4 3 8l4 4' })],
  book: [G('path', { d: 'M2 3.2h3.7c1.2 0 2.3.7 2.3 1.8v8c-.4-1.1-1.5-1.8-2.7-1.8H2zM8 5c0-1.1 1.1-1.8 2.3-1.8H14v8h-3.7c-1.2 0-2.3.7-2.3 1.8' })],
  doc: [G('path', { d: 'M4 1.8h4.7l3.5 3.5v8.9H4zM8.6 1.8v3.7h3.6' })],
  script: [G('rect', { x: 2.2, y: 2.4, width: 11.6, height: 11.2, rx: 1.6 }), G('path', { d: 'M6.2 6 4.3 8l1.9 2M9.8 6 11.7 8l-1.9 2' })],
  image: [G('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.5 }), G('circle', { cx: 6, cy: 6.5, r: 1 }), G('path', { d: 'M2.8 12 6 9l2.2 2 2.6-2.6 2.6 4.1' })],
  data: [G('ellipse', { cx: 8, cy: 4, rx: 5, ry: 2 }), G('path', { d: 'M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2' })],
  session: [G('path', { d: 'M2.4 3.4h11.2v7.2H7.2L4 13.4v-2.8H2.4zM5 6.2h6M5 8.2h4' })],
  note: [G('path', { d: 'M3 1.8h10v9.4L10.2 14H3zM10.2 14v-2.8H13M5.4 5.2h5M5.4 7.4h3.4' })],
  other: [G('path', { d: 'M4 1.8h4.7l3.5 3.5v8.9H4zM8.6 1.8v3.7h3.6M6 9h4' })],
  folder: [G('path', { d: 'M2 4.2h4l1.4 1.6H14v7.6H2z' })],
  tag: [G('path', { d: 'M2.4 2.4h5.1l6.1 6.1-5.1 5.1-6.1-6.1z' }), G('circle', { cx: 5.6, cy: 5.6, r: 1 })],
  copy: [G('rect', { x: 5.2, y: 5.2, width: 8, height: 8, rx: 1.4 }), G('path', { d: 'M10.8 5.2V4a1.4 1.4 0 0 0-1.4-1.4H4A1.4 1.4 0 0 0 2.6 4v5.4A1.4 1.4 0 0 0 4 10.8h1.2' })],
  save: [G('path', { d: 'M2.8 2.8h8.8l1.6 1.6v8.8H2.8zM5 2.8v3.4h5V2.8M5 13.2V9.4h6v3.8' })],
  restore: [G('path', { d: 'M3 5.6A5.4 5.4 0 1 1 2.8 9M2.6 2.6v3.2h3.2' })],
  check: [G('path', { d: 'M3 8.4 6.4 12 13 4.6' })],
  sparkle: [
    G('path', { d: 'M7 1.8 8.5 6.2 12.9 7.7 8.5 9.2 7 13.6 5.5 9.2 1.1 7.7 5.5 6.2z' }),
    G('path', { d: 'M12.6 10.6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z' }),
  ],
}
function Icon({ name, size = 14 }) {
  const body = GLYPHS[name] ?? GLYPHS.other
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', ...S, 'aria-hidden': true }, body.map((child, index) => React.cloneElement(child, { key: index })))
}
const KINDS = ['doc', 'script', 'image', 'data', 'session', 'note']
const SORTS = ['relevance', 'updated', 'title', 'size']
const KIND_LABEL = {
  doc: 'kindDoc',
  script: 'kindScript',
  image: 'kindImage',
  data: 'kindData',
  session: 'kindSession',
  note: 'kindNote',
  other: 'kindOther',
}
function kindGlyph(kind) {
  return KIND_LABEL[kind] ? kind : 'other'
}
function formatBytes(size) {
  const n = Number(size)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function parseTags(text) {
  const seen = new Set()
  const out = []
  for (const raw of String(text ?? '').split(/[,，\n]/)) {
    const tag = raw.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 24) break
  }
  return out
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到 execCommand
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
/* ------------------------------------------------------------------ 顶栏 */
function Toolbar({
  t, onExit, qInput, onQuery, kind, onKind, sort, onSort, status, trashCount,
  onToggleTrash, onScan, scanning, onNewNote, onRefresh, refreshing,
  view, onView, assistOpen, onToggleAssist,
}) {
  return h('div', { className: 'clib-toolbar' },
    h('button', {
      type: 'button', className: 'clib-btn clib-icon', onClick: onExit,
      title: t('backToChat'), 'aria-label': t('backToChat'),
    }, h(Icon, { name: 'back', size: 14 })),
    h('div', { className: 'clib-brand' },
      h('b', null, t('appTitle')),
      h('small', null, t('appSub'))),
    h('label', { className: 'clib-search' },
      h(Icon, { name: 'search', size: 13 }),
      h('input', {
        type: 'search',
        value: qInput,
        placeholder: t('searchPlaceholder'),
        'aria-label': t('searchPlaceholder'),
        onChange: event => onQuery(event.target.value),
      })),
    h('select', { className: 'clib-select', value: kind, 'aria-label': t('kindAll'), disabled: status === 'trashed', onChange: event => onKind(event.target.value) },
      h('option', { value: '' }, t('kindAll')),
      ...KINDS.map(value => h('option', { key: value, value }, t(KIND_LABEL[value])))),
    h('select', { className: 'clib-select', value: sort, 'aria-label': t('sortLabel'), disabled: status === 'trashed', onChange: event => onSort(event.target.value) },
      ...SORTS.map(value => h('option', { key: value, value }, t(`sort${value[0].toUpperCase()}${value.slice(1)}`)))),
    h('button', { type: 'button', className: 'clib-btn', onClick: onScan, disabled: scanning, title: t('scan') },
      h(Icon, { name: 'scan', size: 13 }), scanning ? t('scanning') : t('scan')),
    h('button', { type: 'button', className: 'clib-btn is-primary', onClick: onNewNote },
      h(Icon, { name: 'plus', size: 13 }), t('newNote')),
    h('button', { type: 'button', className: `clib-btn${status === 'trashed' ? ' is-on' : ''}`, onClick: onToggleTrash, title: t('trashToggle') },
      h(Icon, { name: 'trash', size: 13 }), t('trashToggle'), trashCount > 0 ? ` ${trashCount}` : ''),
    h('select', {
      className: 'clib-select',
      value: view,
      title: t('viewLabel'),
      'aria-label': t('viewLabel'),
      onChange: event => onView(event.target.value),
    }, VIEW_MODES.map(mode => h('option', { key: mode, value: mode }, t(VIEW_LABEL[mode])))),
    h('button', {
      type: 'button', className: `clib-btn${assistOpen ? ' is-on' : ''}`, onClick: onToggleAssist,
      title: t('assistOpen'), 'aria-pressed': !!assistOpen,
    }, h(Icon, { name: 'sparkle', size: 13 }), t('assistOpen')),
    h('button', { type: 'button', className: 'clib-btn clib-icon', onClick: onRefresh, disabled: refreshing, title: t('refresh'), 'aria-label': t('refresh') },
      h('span', { className: refreshing ? 'clib-spin' : undefined }, h(Icon, { name: 'refresh', size: 14 }))))
}
/* ------------------------------------------------------------------ 左栏 */
function Sidebar({ t, sources, collections, tags, filters, disabled, onFilter, onAddSource, onRemoveSource }) {
  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState('')
  const [path, setPath] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  async function submit(event) {
    event.preventDefault()
    if (!name.trim() || !path.trim() || busy) return
    setBusy(true)
    const ok = await onAddSource({ name: name.trim(), path: path.trim() })
    setBusy(false)
    if (ok) { setName(''); setPath(''); setAdding(false) }
  }
  return h('aside', { className: 'clib-side' },
    h('div', { className: 'clib-side-title' },
      h('span', null, t('sources')),
      h('button', { type: 'button', className: 'clib-side-add', onClick: () => setAdding(v => !v) },
        adding ? t('cancel') : `+ ${t('addSource')}`)),
    h('button', {
      type: 'button',
      className: `clib-nav${!filters.source ? ' is-on' : ''}`,
      disabled,
      onClick: () => onFilter({ source: '' }),
    }, h('span', { className: 'clib-dot' }), h('span', { className: 'clib-nav-label' }, t('allSources'))),
    sources.map(source => h('div', { key: source.id, className: 'clib-source-row' },
      h('button', {
        type: 'button',
        className: `clib-nav${filters.source === source.id ? ' is-on' : ''}`,
        disabled,
        title: source.path,
        onClick: () => onFilter({ source: filters.source === source.id ? '' : source.id }),
      },
      h('span', { className: 'clib-dot' }),
      h('span', { className: 'clib-nav-label' }, source.name, source.missing ? h('span', { className: 'clib-missing' }, ` · ${t('sourceMissing')}`) : null),
      h('span', { className: 'clib-count' }, Number.isFinite(source.count) ? source.count : '')),
      h('button', {
        type: 'button',
        className: 'clib-source-remove',
        title: t('removeSource'),
        'aria-label': t('removeSource'),
        onClick: () => onRemoveSource(source),
      }, h(Icon, { name: 'close', size: 11 })))),
    adding ? h('form', { className: 'clib-source-form', onSubmit: submit },
      h('input', { className: 'clib-input', value: name, placeholder: t('sourceName'), 'aria-label': t('sourceName'), onChange: e => setName(e.target.value) }),
      h('input', { className: 'clib-input', value: path, placeholder: t('sourcePath'), 'aria-label': t('sourcePath'), onChange: e => setPath(e.target.value) }),
      h('div', { className: 'clib-source-form-row' },
        h('button', { type: 'button', className: 'clib-btn', onClick: () => setAdding(false) }, t('cancel')),
        h('button', { type: 'submit', className: 'clib-btn is-primary', disabled: busy || !name.trim() || !path.trim() },
          busy ? t('loading') : t('add')))) : null,
    h('div', { className: 'clib-side-title' }, h('span', null, t('collections'))),
    h('button', {
      type: 'button',
      className: `clib-nav${!filters.collection ? ' is-on' : ''}`,
      disabled,
      onClick: () => onFilter({ collection: '' }),
    }, h(Icon, { name: 'folder', size: 12 }), h('span', { className: 'clib-nav-label' }, t('allCollections'))),
    collections.length
      ? collections.map(collection => h('button', {
        key: collection.name,
        type: 'button',
        className: `clib-nav${filters.collection === collection.name ? ' is-on' : ''}`,
        disabled,
        onClick: () => onFilter({ collection: filters.collection === collection.name ? '' : collection.name }),
      },
      h(Icon, { name: 'folder', size: 12 }),
      h('span', { className: 'clib-nav-label' }, collection.name),
      h('span', { className: 'clib-count' }, collection.count)))
      : h('div', { className: 'clib-side-empty' }, '—'),
    h('div', { className: 'clib-side-title' }, h('span', null, t('tags'))),
    tags.length
      ? h('div', { className: 'clib-tagcloud' }, tags.map(tag => h('button', {
        key: tag.name,
        type: 'button',
        className: `clib-tag${filters.tag === tag.name ? ' is-on' : ''}`,
        disabled,
        title: filters.tag === tag.name ? `${t('tags')} · ${tag.name}` : tag.name,
        onClick: () => onFilter({ tag: filters.tag === tag.name ? '' : tag.name }),
      }, h('span', null, `#${tag.name}`), h('em', null, tag.count))))
      : h('div', { className: 'clib-side-empty' }, t('noTags')))
}
/* ------------------------------------------------------------------ 列表 */
function ItemRow({ t, item, active, sourceName, onClick }) {
  const meta = item.path || sourceName || item.collection || ''
  return h('button', {
    type: 'button',
    className: `clib-row${active ? ' is-on' : ''}`,
    onClick,
  },
  h('span', { className: 'clib-row-icon' }, h(Icon, { name: kindGlyph(item.kind), size: 15 })),
  h('span', { className: 'clib-row-body' },
    h('span', { className: 'clib-row-title' },
      h('strong', null, item.title || t('untitled')),
      h('span', { className: 'clib-badge' }, t(KIND_LABEL[item.kind] ?? 'kindOther')),
      item.storage === 'linked' ? h('span', { className: 'clib-badge' }, t('storageLinked')) : null),
    h('span', { className: 'clib-row-meta' },
      meta ? h('span', { className: 'clib-path' }, meta) : null,
      h('span', { className: 'clib-sep' }, '·'),
      h('span', { className: 'clib-num' }, formatBytes(item.size)),
      h('span', { className: 'clib-sep' }, '·'),
      h('span', { className: 'clib-num' }, formatTime(item.updatedAt))),
    item.snippet ? h('span', { className: 'clib-row-snippet' }, item.snippet) : null,
    item.tags?.length
      ? h('span', { className: 'clib-row-tags' }, item.tags.slice(0, 4).map(tag => h('span', { key: tag, className: 'clib-mini-tag' }, `#${tag}`)))
      : null))
}
function kindName(t, kind) {
  return t(KIND_LABEL[kind] ?? 'kindOther')
}
function CardView({ t, items, selectedId, onSelect }) {
  return h('div', { className: 'clib-cards' }, items.map(item => h('button', {
    key: item.id,
    type: 'button',
    className: `clib-card${item.id === selectedId ? ' is-on' : ''}`,
    onClick: () => onSelect(item.id),
  },
  h('div', { className: 'clib-card-thumb' },
    item.kind === 'image'
      ? h('img', { src: api.thumbUrl(item.id), alt: item.title || '', loading: 'lazy' })
      : h('span', { className: 'clib-card-glyph' }, h(Icon, { name: kindGlyph(item.kind), size: 24 }))),
  h('span', { className: 'clib-card-body' },
    h('strong', { className: 'clib-card-title' }, item.title || t('untitled')),
    h('span', { className: 'clib-card-meta' },
      h('span', { className: 'clib-badge' }, kindName(t, item.kind)),
      item.collection ? h('span', { className: 'clib-badge' }, item.collection) : null),
    item.snippet ? h('span', { className: 'clib-card-snippet' }, item.snippet) : null,
    item.tags?.length
      ? h('span', { className: 'clib-card-tags' }, item.tags.slice(0, 3).map(tag => h('span', { key: tag, className: 'clib-mini-tag' }, `#${tag}`)))
      : null,
    h('span', { className: 'clib-card-meta' }, h('span', { className: 'clib-num' }, formatTime(item.updatedAt)))))))
}
function TableView({ t, items, selectedId, onSelect, sort, onSort }) {
  const columns = [
    { key: 'title', label: t('colTitle'), sort: 'title' },
    { key: 'kind', label: t('colKind') },
    { key: 'collection', label: t('colCollection') },
    { key: 'tags', label: t('colTags') },
    { key: 'size', label: t('colSize'), sort: 'size' },
    { key: 'updated', label: t('colUpdated'), sort: 'updated' },
  ]
  return h('div', { className: 'clib-table-wrap' },
    h('table', { className: 'clib-table' },
      h('thead', null, h('tr', null, columns.map(column => h('th', {
        key: column.key,
        className: column.sort ? 'clib-th-sort' : undefined,
        'aria-sort': column.sort && sort === column.sort ? 'ascending' : undefined,
      }, column.sort
        ? h('button', {
          type: 'button',
          className: `clib-th-btn${sort === column.sort ? ' is-on' : ''}`,
          onClick: () => onSort(column.sort),
        }, column.label, sort === column.sort ? h('span', { className: 'clib-sort-mark' }, '↑') : null)
        : column.label)))),
      h('tbody', null, items.map(item => h('tr', {
        key: item.id,
        className: item.id === selectedId ? 'is-on' : undefined,
        tabIndex: 0,
        onClick: () => onSelect(item.id),
        onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.id) } },
      },
      h('td', null, h('span', { className: 'clib-td-title' },
        h(Icon, { name: kindGlyph(item.kind), size: 12 }), item.title || t('untitled'))),
      h('td', null, h('span', { className: 'clib-badge' }, kindName(t, item.kind))),
      h('td', null, item.collection || '—'),
      h('td', null, h('span', { className: 'clib-table-tags' },
        item.tags?.length
          ? item.tags.slice(0, 3).map(tag => h('span', { key: tag, className: 'clib-mini-tag' }, `#${tag}`))
          : '—')),
      h('td', { className: 'clib-num' }, formatBytes(item.size)),
      h('td', { className: 'clib-num' }, formatTime(item.updatedAt)))))))
}
function GalleryView({ t, items, selectedId, onSelect }) {
  const images = items.filter(item => item.kind === 'image')
  if (!images.length) {
    return h(Empty, { icon: 'image', title: t('galleryEmpty'), body: t('galleryEmptyBody') })
  }
  return h('div', { className: 'clib-gallery' }, images.map(item => h('button', {
    key: item.id,
    type: 'button',
    className: `clib-gal${item.id === selectedId ? ' is-on' : ''}`,
    title: item.title || t('untitled'),
    onClick: () => onSelect(item.id),
  },
  h('img', { src: api.thumbUrl(item.id), alt: item.title || '', loading: 'lazy' }),
  h('span', { className: 'clib-gal-cap' }, item.title || t('untitled')))))
}
function Skeleton() {
  return h(React.Fragment, null, Array.from({ length: 6 }, (_, index) => h('div', { key: index, className: 'clib-skel' },
    h('div', { className: 'clib-skel-avatar clib-shimmer' }),
    h('div', { className: 'clib-skel-lines' },
      h('div', { className: 'clib-skel-line clib-shimmer', style: { width: `${58 + (index % 3) * 11}%` } }),
      h('div', { className: 'clib-skel-line clib-shimmer', style: { width: `${34 + (index % 4) * 9}%` } }),
      h('div', { className: 'clib-skel-line clib-shimmer', style: { width: '88%' } })))))
}
function Empty({ icon, title, body, action }) {
  return h('div', { className: 'clib-empty' },
    h('div', { className: 'clib-empty-icon' }, h(Icon, { name: icon, size: 22 })),
    h('b', null, title),
    h('p', null, body),
    action || null)
}
function ItemList(props) {
  const {
    t, items, total, loading, moreLoading, selectedId, onSelect, onLoadMore,
    status, hasFilters, onClearFilters, sourceNames, onNewNote,
    view, sort, onSort,
  } = props
  const mode = VIEW_MODES.includes(view) ? view : 'list'
  let content
  if (loading && !items.length) {
    content = h(Skeleton)
  } else if (!items.length) {
    if (status === 'trashed') {
      content = h(Empty, { icon: 'trash', title: t('emptyTrash'), body: t('emptyTrashBody') })
    } else if (hasFilters) {
      content = h(Empty, {
        icon: 'search',
        title: t('emptyFiltered'),
        body: t('emptyFilteredBody'),
        action: h('button', { type: 'button', className: 'clib-btn', onClick: onClearFilters }, t('clearFilters')),
      })
    } else {
      content = h(Empty, {
        icon: 'book',
        title: t('emptyTitle'),
        body: t('emptyBody'),
        action: h('button', { type: 'button', className: 'clib-btn is-primary', onClick: onNewNote },
          h(Icon, { name: 'plus', size: 13 }), t('newNote')),
      })
    }
  } else if (mode === 'cards') {
    content = h(CardView, { t, items, selectedId, onSelect })
  } else if (mode === 'table') {
    content = h(TableView, { t, items, selectedId, onSelect, sort, onSort })
  } else if (mode === 'gallery') {
    content = h(GalleryView, { t, items, selectedId, onSelect })
  } else {
    content = items.map(item => h(ItemRow, {
      key: item.id,
      t,
      item,
      active: item.id === selectedId,
      sourceName: sourceNames[item.sourceId] ?? '',
      onClick: () => onSelect(item.id),
    }))
  }
  return h('main', { className: 'clib-main' },
    h('div', { className: 'clib-list-head' },
      h('span', null, loading ? t('loading') : format(t('totalCount'), { n: total })),
      h('b', null, status === 'trashed' ? t('trashToggle') : '')),
    h('div', { className: `clib-list clib-list-${mode}` }, content),
    items.length < total
      ? h('div', { className: 'clib-list-foot' },
        h('button', { type: 'button', className: 'clib-btn', disabled: moreLoading, onClick: onLoadMore },
          moreLoading ? t('loadingMore') : t('loadMore')))
      : null)
}
/* ------------------------------------------------------------------ 详情 */
function detailInitial(item, content) {
  return {
    title: item.title ?? '',
    collection: item.collection ?? 'inbox',
    tags: (item.tags ?? []).join(', '),
    notes: item.notes ?? '',
    content: item.storage === 'note' ? (content?.text ?? '') : '',
  }
}
function Detail({ t, id, collections, sourceNames, onClose, onChanged, pushToast, toastError, version = 0 }) {
  const [loading, setLoading] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [item, setItem] = React.useState(null)
  const [content, setContent] = React.useState(null)
  const [base, setBase] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [previewError, setPreviewError] = React.useState(false)
  const [doc, setDoc] = React.useState(null)
  const [docLoading, setDocLoading] = React.useState(false)
  const [mdView, setMdView] = React.useState('render')
  const [fullscreen, setFullscreen] = React.useState(false)
  const closeBtnRef = React.useRef(null)
  const expandBtnRef = React.useRef(null)
  const wasFullscreen = React.useRef(false)
  // 切换条目（含删除后 id 变空）时退出全屏。
  React.useEffect(() => { setFullscreen(false) }, [id])
  React.useEffect(() => {
    if (fullscreen) {
      wasFullscreen.current = true
      const node = closeBtnRef.current
      if (node && typeof node.focus === 'function') node.focus()
      const onKey = event => { if (event.key === 'Escape') setFullscreen(false) }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }
    if (wasFullscreen.current) {
      wasFullscreen.current = false
      const node = expandBtnRef.current
      if (node && typeof node.focus === 'function') node.focus()
    }
    return undefined
  }, [fullscreen])
  React.useEffect(() => {
    if (!id) return undefined
    let alive = true
    setMdView('render')
    setLoading(true)
    setError('')
    setConfirm('')
    setPreviewError(false)
    Promise.all([
      api.getItem(id),
      api.getContent(id, { maxChars: MAX_PREVIEW }).catch(() => null),
    ]).then(([data, contentData]) => {
      if (!alive) return
      const nextItem = data?.item ?? data ?? null
      if (!nextItem) { setError(t('errorPrefix')); setLoading(false); return }
      const nextContent = contentData ?? (data?.content ? { text: data.content, totalLines: nextItem.lines, truncated: false } : null)
      const initial = detailInitial(nextItem, nextContent)
      setItem(nextItem)
      setContent(nextContent)
      setBase(initial)
      setDraft(initial)
      setLoading(false)
      setDoc(null)
      const ext = String(nextItem.ext || '')
      if (DOC_PREVIEW_EXTS.test(ext)) {
        setDocLoading(true)
        api.getPreview(id, { maxChars: MAX_PREVIEW })
          .then(data => { if (alive) setDoc(data) })
          .catch(() => { if (alive) setDoc({ kind: 'none' }) })
          .finally(() => { if (alive) setDocLoading(false) })
      } else {
        setDocLoading(false)
      }
    }).catch(err => {
      if (!alive) return
      setLoading(false)
      setError(err?.message ?? String(err))
      toastError(err)
    })
    return () => { alive = false }
  }, [id, reloadKey, version, t, toastError])
  if (!id) {
    return h('aside', { className: 'clib-detail' },
      h('div', { className: 'clib-placeholder' },
        h('div', { className: 'clib-empty-icon' }, h(Icon, { name: 'book', size: 22 })),
        h('b', null, t('detailEmpty')),
        h('p', null, t('detailEmptyBody'))))
  }
  const disabled = item?.status === 'trashed'
  const dirty = !!draft && !!base && (
    draft.title !== base.title ||
    draft.collection !== base.collection ||
    draft.tags !== base.tags ||
    draft.notes !== base.notes ||
    (item?.storage === 'note' && draft.content !== base.content)
  )
  const isImage = !!item && (item.kind === 'image' || String(item.mime ?? '').startsWith('image/'))
  const text = content?.text ?? item?.preview ?? ''
  const allLines = text ? text.split('\n') : []
  const shownLines = allLines.slice(0, MAX_LINES)
  const clipped = allLines.length > MAX_LINES
  const totalLines = content?.totalLines ?? item?.lines ?? allLines.length
  const truncated = content?.truncated || clipped
  const binary = content?.binary === true
  const mdEligible = !!item && (item.kind === 'note' || item.storage === 'note' || /^md$/i.test(String(item.ext || '')))
  const sourceName = item?.sourceId ? (sourceNames[item.sourceId] ?? item.sourceId) : ''
  const setField = key => event => {
    const value = event.target.value
    setDraft(previous => (previous ? { ...previous, [key]: value } : previous))
  }
  async function save() {
    if (!item || !draft || busy) return
    const patch = {
      title: draft.title.trim() || t('untitled'),
      collection: draft.collection.trim() || 'inbox',
      tags: parseTags(draft.tags),
      notes: draft.notes,
    }
    if (item.storage === 'note' && draft.content !== base.content) patch.content = draft.content
    setBusy('save')
    try {
      await api.updateItem(id, patch)
      pushToast({ type: 'ok', title: t('saved') })
      setReloadKey(value => value + 1)
      onChanged()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy('')
    }
  }
  async function runConfirm() {
    if (!item || !confirm || busy) return
    const purge = confirm === 'purge'
    setBusy(purge ? 'purge' : 'delete')
    try {
      if (purge) {
        await api.purgeItem(id)
        pushToast({ type: 'ok', title: t('purgeDone') })
      } else {
        await api.deleteItem(id)
        pushToast({ type: 'ok', title: t('deleteDone') })
      }
      setConfirm('')
      onChanged()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy('')
    }
  }
  async function restore() {
    if (busy) return
    setBusy('restore')
    try {
      await api.restoreItem(id)
      pushToast({ type: 'ok', title: t('restored') })
      onChanged()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy('')
    }
  }
  async function doCopy(value, label) {
    const ok = await copyText(value)
    if (ok) pushToast({ type: 'ok', title: t('copied') })
    else pushToast({ type: 'error', title: t('errorPrefix'), message: t('copyFailed') })
    return ok && label
  }
  async function reveal() {
    if (!item || busy) return
    setBusy('reveal')
    try {
      await api.revealItem(item.id)
      pushToast({ type: 'ok', title: t('revealed') })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy('')
    }
  }
  const renderPreview = () => {
    if (!item) return null
    if (isImage) {
      return h('div', { className: 'clib-image-wrap' },
        previewError
          ? h('span', { className: 'clib-hint' }, t('previewFailed'))
          : h('img', {
            src: api.rawUrl(item.id),
            alt: item.title || t('imagePreview'),
            loading: 'lazy',
            onError: () => setPreviewError(true),
          }))
    }
    if (DOC_PREVIEW_EXTS.test(String(item.ext || ''))) {
      if (docLoading) return h('div', { className: 'clib-hint' }, t('loading'))
      if (doc?.kind === 'text') {
        return h('div', { className: 'clib-doc-text' },
          h('pre', { className: 'clib-code' }, String(doc.text || '').slice(0, MAX_PREVIEW)),
          doc.note ? h('div', { className: 'clib-hint' }, doc.note) : null)
      }
      if (doc?.kind === 'thumb') {
        return h('div', { className: 'clib-image-wrap' },
          h('img', {
            src: api.thumbUrl(item.id),
            alt: item.title || t('fieldContent'),
            loading: 'lazy',
            onError: () => setPreviewError(true),
          }))
      }
      return h('div', { className: 'clib-hint' }, doc?.note || t('binaryPreview'))
    }
    if (binary) return h('div', { className: 'clib-hint' }, t('binaryPreview'))
    if (!text) return null
    if (mdEligible && mdView === 'render') return h(Markdown, { text, className: 'is-plain' })
    return h('div', { className: 'clib-code-wrap' },
      h('pre', { className: 'clib-code-gutter' }, shownLines.map((_, index) => index + 1).join('\n')),
      h('pre', { className: 'clib-code' }, shownLines.join('\n')))
  }
  const previewBody = renderPreview()
  const modeToggle = () => mdEligible
    ? h('div', { className: 'clib-fs-modes', role: 'group', 'aria-label': t('fieldContent') },
      h('button', {
        type: 'button',
        className: `clib-fs-mode${mdView === 'render' ? ' is-on' : ''}`,
        'aria-pressed': mdView === 'render',
        onClick: () => setMdView('render'),
      }, t('mdRender')),
      h('button', {
        type: 'button',
        className: `clib-fs-mode${mdView === 'source' ? ' is-on' : ''}`,
        'aria-pressed': mdView === 'source',
        onClick: () => setMdView('source'),
      }, t('mdSource')))
    : null
  const head = h('div', { className: 'clib-detail-head' },
    h(Icon, { name: item ? kindGlyph(item.kind) : 'doc', size: 18 }),
    h('div', { className: 'clib-detail-titles' },
      h('h2', null, item?.title || t('loadingDetail')),
      h('div', { className: 'clib-detail-sub' },
        item ? h('span', { className: 'clib-badge' }, t(KIND_LABEL[item.kind] ?? 'kindOther')) : null,
        item?.storage ? h('span', { className: 'clib-badge' }, t(`storage${item.storage[0].toUpperCase()}${item.storage.slice(1)}`)) : null,
        sourceName ? h('span', null, sourceName) : null,
        item ? h('span', null, formatBytes(item.size)) : null,
        item ? h('span', null, formatTime(item.updatedAt)) : null)),
    h('button', { type: 'button', className: 'clib-btn clib-icon', onClick: onClose, title: t('close'), 'aria-label': t('close') },
      h(Icon, { name: 'close', size: 13 })))
  let body
  if (loading) {
    body = h('div', { className: 'clib-placeholder' }, h('b', null, t('loadingDetail')))
  } else if (error) {
    body = h('div', { className: 'clib-placeholder' }, h('b', null, t('errorPrefix')), h('p', null, error))
  } else if (!item || !draft) {
    body = h('div', { className: 'clib-placeholder' }, h('b', null, t('detailEmpty')))
  } else {
    body = h(React.Fragment, null,
      h('div', { className: 'clib-field' },
        h('label', { htmlFor: 'clib-title' }, t('fieldTitle')),
        h('input', { id: 'clib-title', className: 'clib-input', value: draft.title, disabled, onChange: setField('title') })),
      h('div', { className: 'clib-field' },
        h('label', { htmlFor: 'clib-collection' }, t('fieldCollection')),
        h('input', {
          id: 'clib-collection', className: 'clib-input', value: draft.collection, disabled,
          list: 'clib-collection-options', onChange: setField('collection'),
        }),
        h('datalist', { id: 'clib-collection-options' },
          (collections ?? []).map(collection => h('option', { key: collection.name, value: collection.name })))),
      h('div', { className: 'clib-field' },
        h('label', { htmlFor: 'clib-tags' }, t('fieldTags'), h('small', null, t('fieldTagsHint'))),
        h('input', { id: 'clib-tags', className: 'clib-input', value: draft.tags, disabled, onChange: setField('tags') })),
      h('div', { className: 'clib-field' },
        h('label', { htmlFor: 'clib-notes' }, t('fieldNotes')),
        h('textarea', {
          id: 'clib-notes', className: 'clib-textarea', rows: 2, value: draft.notes, disabled,
          placeholder: t('fieldNotesPlaceholder'), onChange: setField('notes'),
        })),
      item.storage === 'note'
        ? h('div', { className: 'clib-field' },
          h('label', { htmlFor: 'clib-content' }, t('fieldContent')),
          h('textarea', {
            id: 'clib-content', className: 'clib-textarea', rows: 6, value: draft.content, disabled,
            spellCheck: false, onChange: setField('content'),
          }))
        : null,
      item.path ? h('div', { className: 'clib-field' },
        h('label', null, t('pathLabel')),
        h('div', { className: 'clib-path-row' },
          h('code', { className: 'clib-path-line', title: item.path }, item.path),
          h('button', {
            type: 'button', className: 'clib-icon-btn', title: t('copyPath'), 'aria-label': t('copyPath'),
            onClick: () => doCopy(item.path, 'path'),
          }, h(Icon, { name: 'copy', size: 12 })),
          h('button', {
            type: 'button', className: 'clib-icon-btn', title: t('revealInFinder'), 'aria-label': t('revealInFinder'),
            disabled: !!busy, onClick: reveal,
          }, h(Icon, { name: 'folder', size: 12 })))) : null,
      disabled ? h('div', { className: 'clib-hint' }, t('trashHint')) : null,
      h('div', { className: 'clib-preview' },
        h('div', { className: 'clib-preview-head' },
          h('span', null, isImage ? t('imagePreview') : t('fieldContent')),
          h('span', { className: 'clib-preview-tools' },
            mdEligible
              ? h('span', { className: 'clib-seg clib-seg-sm' },
                h('button', {
                  type: 'button',
                  className: `clib-seg-btn${mdView === 'render' ? ' is-on' : ''}`,
                  'aria-pressed': mdView === 'render',
                  onClick: () => setMdView('render'),
                }, t('mdRender')),
                h('button', {
                  type: 'button',
                  className: `clib-seg-btn${mdView === 'source' ? ' is-on' : ''}`,
                  'aria-pressed': mdView === 'source',
                  onClick: () => setMdView('source'),
                }, t('mdSource')))
              : null,
            h('span', null, isImage
              ? `${formatBytes(item.size)}`
              : truncated ? `${format(t('linesTotal'), { n: totalLines })} · ${t('truncated')}` : text ? format(t('linesTotal'), { n: totalLines }) : ''),
            h('button', {
              type: 'button',
              className: 'clib-icon-btn clib-fs-open',
              ref: expandBtnRef,
              title: t('previewFullscreen'),
              'aria-label': t('previewFullscreen'),
              'aria-expanded': fullscreen,
              onClick: () => setFullscreen(true),
            }, h(Icon, { name: 'expand', size: 12 })))),
        previewBody),
      confirm ? h('div', { className: 'clib-confirm' },
        h('b', null, confirm === 'purge'
          ? format(t('purgeConfirm'), { title: item.title })
          : format(t('deleteConfirm'), { title: item.title })),
        h('p', null, confirm === 'purge'
          ? t('purgeConfirmBody')
          : `${t('deleteConfirmBody')}${item.storage === 'linked' ? ` ${t('deleteConfirmLinked')}` : ''}`),
        h('div', { className: 'clib-confirm-row' },
          h('button', { type: 'button', className: 'clib-btn', onClick: () => setConfirm(''), disabled: !!busy }, t('cancel')),
          h('button', { type: 'button', className: 'clib-btn is-danger', onClick: runConfirm, disabled: !!busy },
            busy ? t('deleting') : confirm === 'purge' ? t('purge') : t('delete')))) : null)
  }
  const footer = h('div', { className: 'clib-detail-foot' },
    disabled
      ? h(React.Fragment, null,
        h('button', { type: 'button', className: 'clib-btn is-primary', disabled: !!busy, onClick: restore },
          h(Icon, { name: 'restore', size: 13 }), t('restore')),
        h('span', { className: 'clib-grow' }),
        h('button', { type: 'button', className: 'clib-btn is-danger', disabled: !!busy, onClick: () => setConfirm('purge') },
          h(Icon, { name: 'trash', size: 13 }), t('purge')))
      : h(React.Fragment, null,
        h('button', {
          type: 'button', className: 'clib-btn is-primary', disabled: !!busy || !dirty, onClick: save,
        }, h(Icon, { name: 'save', size: 13 }), busy === 'save' ? t('saving') : t('save')),
        h('button', {
          type: 'button', className: 'clib-btn', disabled: !item?.path || !!busy,
          title: item?.path ? item.path : t('noPath'),
          onClick: () => doCopy(item?.path ?? '', 'path'),
        }, h(Icon, { name: 'copy', size: 13 }), t('copyPath')),
        h('button', {
          type: 'button', className: 'clib-btn', disabled: !item?.path || !!busy,
          title: item?.path ? t('revealInFinder') : t('noPath'),
          onClick: reveal,
        }, h(Icon, { name: 'folder', size: 13 }), busy === 'reveal' ? t('revealing') : t('revealInFinder')),
        h('button', {
          type: 'button', className: 'clib-btn', disabled: !text || !!busy,
          onClick: () => doCopy(text, 'content'),
        }, h(Icon, { name: 'copy', size: 12 }), t('copyContent')),
        h('span', { className: 'clib-grow' }),
        h('button', {
          type: 'button', className: 'clib-btn is-danger', disabled: !!busy || !item,
          onClick: () => setConfirm('delete'),
        }, h(Icon, { name: 'trash', size: 13 }), t('delete'))))
  const overlay = fullscreen
    ? h('div', {
      className: 'clib-fs',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('previewFullscreen'),
      onMouseDown: event => { if (event.target === event.currentTarget) setFullscreen(false) },
    },
    h('div', { className: 'clib-fs-card' },
      h('div', { className: 'clib-fs-head' },
        h('span', { className: 'clib-fs-title' }, isImage ? t('imagePreview') : t('fieldContent')),
        h('span', { className: 'clib-fs-tools' },
          modeToggle(),
          h('button', {
            type: 'button',
            className: 'clib-icon-btn clib-fs-close',
            ref: closeBtnRef,
            title: t('previewFullscreenExit'),
            'aria-label': t('previewFullscreenExit'),
            onClick: () => setFullscreen(false),
          }, h(Icon, { name: 'collapse', size: 13 })))),
      h('div', { className: 'clib-fs-body' }, previewBody)))
    : null
  return h(React.Fragment, null,
    h('aside', { className: 'clib-detail is-open' }, head, h('div', { className: 'clib-detail-body' }, body), footer),
    overlay)
}
/* ------------------------------------------------------------------ 弹窗 / toast */
function NewNoteDialog({ t, defaultCollection, busy, onClose, onCreate }) {
  const [title, setTitle] = React.useState('')
  const [content, setContent] = React.useState('')
  React.useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return h('div', {
    className: 'clib-overlay',
    onMouseDown: event => { if (event.target === event.currentTarget) onClose() },
  },
  h('form', {
    className: 'clib-dialog',
    onSubmit: event => { event.preventDefault(); if (!busy) onCreate({ title, content }) },
  },
  h('h3', null, t('newNote')),
  h('input', {
    className: 'clib-input', value: title, placeholder: t('noteTitlePlaceholder'),
    'aria-label': t('noteTitlePlaceholder'), autoFocus: true, onChange: e => setTitle(e.target.value),
  }),
  h('textarea', {
    className: 'clib-textarea', value: content, placeholder: t('noteContentPlaceholder'),
    'aria-label': t('noteContentPlaceholder'), onChange: e => setContent(e.target.value),
  }),
  h('div', { className: 'clib-dialog-actions' },
    h('button', { type: 'button', className: 'clib-btn', onClick: onClose, disabled: busy }, t('cancel')),
    h('button', { type: 'submit', className: 'clib-btn is-primary', disabled: busy },
      busy ? t('creating') : t('create')))))
}
function Toasts({ t, toasts, onDismiss }) {
  return h('div', { className: 'clib-toasts' },
    toasts.map(toast => h('div', { key: toast.id, className: `clib-toast is-${toast.type ?? 'ok'}`, role: 'status' },
      h('div', { className: 'clib-toast-top' },
        h('span', { className: 'clib-toast-title' }, toast.title ?? ''),
        h('button', {
          type: 'button', className: 'clib-toast-close', onClick: () => onDismiss(toast.id),
          title: t('close'), 'aria-label': t('close'),
        }, h(Icon, { name: 'close', size: 11 }))),
      toast.message ? h('div', { className: 'clib-toast-body' }, toast.message) : null,
      toast.lines?.length
        ? h('div', { className: 'clib-toast-body' },
          toast.lines.map((line, index) => h('div', {
            key: index,
            className: `clib-toast-line${line.bad ? ' is-bad' : ''}`,
          }, line.text)))
        : null)))
}
/* ------------------------------------------------------------------ 页面 */
let toastSeq = 0
export function ContextLibraryPage({ t, onExit }) {
  const [state, setState] = React.useState(null)
  const [toasts, setToasts] = React.useState([])
  const [items, setItems] = React.useState([])
  const [total, setTotal] = React.useState(0)
  const [facets, setFacets] = React.useState(null)
  const [listLoading, setListLoading] = React.useState(true)
  const [moreLoading, setMoreLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [scanning, setScanning] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState(null)
  const [newOpen, setNewOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [qInput, setQInput] = React.useState('')
  const [q, setQ] = React.useState('')
  const [kind, setKind] = React.useState('')
  const [sort, setSort] = React.useState('relevance')
  const [status, setStatus] = React.useState('active')
  const [source, setSource] = React.useState('')
  const [collection, setCollection] = React.useState('')
  const [tag, setTag] = React.useState('')
  const [view, setView] = React.useState(() => {
    const stored = readPref('clib:view', 'list')
    return VIEW_MODES.includes(stored) ? stored : 'list'
  })
  const [assistOpen, setAssistOpen] = React.useState(() => readPref('clib:assist', '0') === '1')
  const [detailVersion, setDetailVersion] = React.useState(0)
  const activeView = VIEW_MODES.includes(view) ? view : 'list'
  React.useEffect(() => { writePref('clib:view', activeView) }, [activeView])
  React.useEffect(() => { writePref('clib:assist', assistOpen ? '1' : '0') }, [assistOpen])
  const selectedItem = React.useMemo(
    () => items.find(entry => entry.id === selectedId) ?? null,
    [items, selectedId],
  )
  function applyAssistFilters(filters) {
    if (!filters || typeof filters !== 'object') return
    if (status === 'trashed') setStatus('active')
    if ('q' in filters) {
      const next = filters.q == null ? '' : String(filters.q)
      setQInput(next)
      setQ(next)
    }
    if ('kind' in filters) setKind(filters.kind || '')
    if ('collection' in filters) setCollection(filters.collection || '')
    if ('tag' in filters) setTag(filters.tag || '')
  }
  const listReq = React.useRef(0)
  const itemsRef = React.useRef(items)
  React.useEffect(() => { itemsRef.current = items }, [items])
  const pushToast = React.useCallback(toast => {
    const id = ++toastSeq
    setToasts(list => [...list.slice(-3), { id, ...toast }])
    const ttl = toast.ttl ?? (toast.type === 'error' ? 6500 : 3800)
    if (ttl > 0) setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), ttl)
  }, [])
  const toastError = React.useCallback(error => {
    pushToast({ type: 'error', title: t('errorPrefix'), message: error?.message ?? String(error ?? '') })
  }, [pushToast, t])
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 250)
    return () => clearTimeout(timer)
  }, [qInput])
  const loadState = React.useCallback(async () => {
    try {
      setState(await api.getState())
    } catch (error) {
      toastError(error)
    }
  }, [toastError])
  const loadList = React.useCallback(async append => {
    const seq = ++listReq.current
    if (append) setMoreLoading(true)
    else setListLoading(true)
    const offset = append ? itemsRef.current.length : 0
    try {
      const data = status === 'trashed'
        ? await api.getTrash({ limit: PAGE, offset })
        : await api.getItems({ q, kind, collection, tag, source, sort, status: 'active', limit: PAGE, offset })
      if (seq !== listReq.current) return
      const next = data?.items ?? []
      setItems(previous => (append ? [...previous, ...next] : next))
      setTotal(data?.total ?? 0)
      if (!append && data?.facets) setFacets(data.facets)
    } catch (error) {
      if (seq === listReq.current) toastError(error)
    } finally {
      if (seq === listReq.current) {
        setListLoading(false)
        setMoreLoading(false)
      }
    }
  }, [status, q, kind, collection, tag, source, sort, toastError])
  React.useEffect(() => { setSelectedId(null); loadList(false) }, [loadList])
  React.useEffect(() => { loadState() }, [loadState])
  const sources = React.useMemo(() => {
    const base = state?.sources ?? []
    const counts = new Map((state?.stats?.sources ?? []).map(item => [item.id, item]))
    if (!base.length) return state?.stats?.sources ?? []
    return base.map(item => {
      const counted = counts.get(item.id)
      return { ...item, count: counted?.count ?? item.count ?? 0, lastScanAt: counted?.lastScanAt ?? item.lastScanAt }
    })
  }, [state])
  const sourceNames = React.useMemo(() => {
    const map = {}
    for (const item of sources) map[item.id] = item.name
    return map
  }, [sources])
  const collections = facets?.collections ?? state?.stats?.collections ?? []
  const tags = facets?.tags ?? state?.stats?.tags ?? []
  const trashCount = state?.trashCount ?? 0
  const hasFilters = !!(q || kind || collection || tag || source)
  async function refreshAll() {
    setRefreshing(true)
    try {
      await Promise.all([loadState(), loadList(false)])
    } finally {
      setRefreshing(false)
    }
  }
  /** 助手改的是服务端数据，列表与详情都要重新取一次。 */
  async function refreshAfterAssist() {
    await refreshAll()
    setDetailVersion(value => value + 1)
  }
  async function runScan() {
    if (scanning) return
    setScanning(true)
    try {
      const payload = await api.scanSources({})
      const results = payload?.results ?? payload ?? []
      if (!results?.length) {
        pushToast({ type: 'warn', title: t('scanDone'), message: t('scanNoSources') })
      } else {
        const lines = []
        let bad = false
        for (const result of results) {
          const errors = result.errors?.length ?? 0
          if (errors) bad = true
          lines.push({
            text: format(t('scanResult'), {
              name: sourceNames[result.sourceId] ?? result.sourceId ?? '?',
              added: result.added ?? 0,
              updated: result.updated ?? 0,
              removed: result.removed ?? 0,
              skipped: result.skipped ?? 0,
              errors,
            }),
            bad: errors > 0,
          })
        }
        const errorLines = results
          .flatMap(result => result.errors ?? [])
          .slice(0, 3)
          .map(error => ({ text: format(t('scanErrorLine'), { path: error.path ?? '', message: error.message ?? '' }), bad: true }))
        pushToast({ type: bad ? 'warn' : 'ok', title: t('scanDone'), lines: [...lines, ...errorLines], ttl: 9000 })
      }
      await refreshAll()
    } catch (error) {
      toastError(error)
    } finally {
      setScanning(false)
    }
  }
  async function addSource(payload) {
    try {
      const data = await api.addSource(payload)
      await loadState()
      pushToast({ type: 'ok', title: format(t('sourceAdded'), { name: data?.source?.name ?? payload.name }) })
      return true
    } catch (error) {
      toastError(error)
      return false
    }
  }
  async function removeSource(sourceItem) {
    const ok = window.confirm(format(t('removeSourceConfirm'), { name: sourceItem.name }))
    if (!ok) return
    try {
      await api.removeSource(sourceItem.id)
      if (source === sourceItem.id) setSource('')
      await Promise.all([loadState(), loadList(false)])
      pushToast({ type: 'ok', title: t('sourceRemoved') })
    } catch (error) {
      toastError(error)
    }
  }
  async function createNote(payload) {
    if (creating) return
    setCreating(true)
    try {
      const data = await api.createItem({
        title: payload.title.trim() || t('untitled'),
        content: payload.content,
        kind: 'note',
        collection: collection || 'inbox',
        tags: tag ? [tag] : [],
      })
      const created = data?.item ?? data
      setNewOpen(false)
      pushToast({ type: 'ok', title: t('noteCreated') })
      await refreshAll()
      if (created?.id) setSelectedId(created.id)
    } catch (error) {
      toastError(error)
    } finally {
      setCreating(false)
    }
  }
  function pickFilter(patch) {
    if (status === 'trashed') return
    if ('source' in patch) setSource(patch.source)
    if ('collection' in patch) setCollection(patch.collection)
    if ('tag' in patch) setTag(patch.tag)
  }
  function clearFilters() {
    setQInput('')
    setQ('')
    setKind('')
    setCollection('')
    setTag('')
    setSource('')
  }
  function toggleTrash() {
    setStatus(current => (current === 'trashed' ? 'active' : 'trashed'))
    setSelectedId(null)
  }
  return h('div', { className: 'clib-root' },
    h(Toolbar, {
      t,
      qInput,
      onQuery: setQInput,
      onExit,
      kind,
      onKind: setKind,
      sort,
      onSort: setSort,
      status,
      trashCount,
      onToggleTrash: toggleTrash,
      onScan: runScan,
      scanning,
      onNewNote: () => setNewOpen(true),
      onRefresh: refreshAll,
      refreshing,
      view: activeView,
      onView: setView,
      assistOpen,
      onToggleAssist: () => setAssistOpen(open => !open),
    }),
    h('div', { className: 'clib-body' },
      h(Sidebar, {
        t,
        sources,
        collections,
        tags,
        filters: { source, collection, tag },
        disabled: status === 'trashed',
        onFilter: pickFilter,
        onAddSource: addSource,
        onRemoveSource: removeSource,
      }),
      h(ItemList, {
        t,
        items,
        total,
        loading: listLoading,
        moreLoading,
        selectedId,
        onSelect: setSelectedId,
        onLoadMore: () => loadList(true),
        status,
        hasFilters,
        onClearFilters: clearFilters,
        sourceNames,
        onNewNote: () => setNewOpen(true),
        view: activeView,
        sort,
        onSort: setSort,
      }),
      h(Detail, {
        t,
        id: selectedId,
        collections,
        sourceNames,
        onClose: () => setSelectedId(null),
        onChanged: refreshAll,
        version: detailVersion,
        pushToast,
        toastError,
      }),
      h(AssistDrawer, {
        t,
        Icon,
        open: assistOpen,
        onClose: () => setAssistOpen(false),
        item: selectedItem,
        items,
        onApplyFilters: applyAssistFilters,
        onChanged: refreshAfterAssist,
        pushToast,
        toastError,
      })),
    newOpen ? h(NewNoteDialog, {
      t,
      defaultCollection: collection,
      busy: creating,
      onClose: () => setNewOpen(false),
      onCreate: createNote,
    }) : null,
    h(Toasts, { t, toasts, onDismiss: id => setToasts(list => list.filter(item => item.id !== id)) }))
}
