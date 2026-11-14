import React from 'react'
import * as api from './api.js'
import { format } from './strings.js'
import { Markdown } from './markdown.js'
const h = React.createElement
const TABS = [
  ['summary', 'assistTabSummary'],
  ['organize', 'assistTabOrganize'],
  ['ask', 'assistTabAsk'],
]
const MAX_ORGANIZE = 15

/** 503/502 这类网关级错误不该把后端原始 message 直接甩给用户。 */
function friendlyError(t, error) {
  const status = error?.status
  const raw = error?.message || String(error || '')
  // 宿主进程里还是旧版插件时，路由兜底会返回英文 `Unknown route: GET /assist/status`。
  // 这不是用户能处理的事情，直接告诉他重启即可。
  if (error?.code === 'not-found' && /Unknown route/i.test(raw)) return t('assistNeedsRestart')
  if (status === 503 || status === 502) return format(t('assistUnavailable'), { status })
  return raw
}
function Spinner({ Icon }) {
  return h('span', { className: 'clib-spin clib-spin-inline' }, h(Icon, { name: 'refresh', size: 12 }))
}
function modelLine(t, status) {
  if (!status) return t('assistStatusLoading')
  if (!status.ready) return status.reason || t('assistNotReady')
  return status.model ? format(t('assistModel'), { model: status.model }) : t('assistModelUnknown')
}
export function AssistDrawer({ t, Icon, open, onClose, item, items, onApplyFilters, onChanged, pushToast, toastError }) {
  const [tab, setTab] = React.useState('summary')
  const [status, setStatus] = React.useState(null)
  const [statusError, setStatusError] = React.useState(null)
  const [statusLoading, setStatusLoading] = React.useState(false)

  const loadStatus = React.useCallback(async () => {
    setStatusLoading(true)
    setStatusError(null)
    try {
      setStatus(await api.getAssistStatus())
    } catch (error) {
      setStatus(null)
      setStatusError(error)
    } finally {
      setStatusLoading(false)
    }
  }, [])
  React.useEffect(() => {
    if (open) loadStatus()
  }, [open, loadStatus])

  const ready = !!status?.ready
  /** 502/503 是模型网关问题，统一换成人话再报；其余错误保留后端原文。 */
  function reportError(error) {
    const message = friendlyError(t, error)
    if (message === (error?.message ?? String(error ?? ''))) toastError(error)
    else toastError(new Error(message))
  }

  /* ---------------------------------------------------------- 总结 */
  const [sum, setSum] = React.useState(null)
  const [sumBusy, setSumBusy] = React.useState(false)
  const [applied, setApplied] = React.useState({})
  React.useEffect(() => {
    setSum(null)
    setApplied({})
  }, [item?.id])
  async function runSummary() {
    if (!item || sumBusy || !ready) return
    setSumBusy(true)
    try {
      setSum(await api.assist({ mode: 'summary', id: item.id }))
    } catch (error) {
      reportError(error)
    } finally {
      setSumBusy(false)
    }
  }
  async function applyChange(change) {
    if (!item || applied[change.key]?.state === 'busy' || applied[change.key]?.state === 'done') return
    setApplied(previous => ({ ...previous, [change.key]: { state: 'busy' } }))
    const patch = change.key === 'tags' ? { tags: change.value } : { [change.key]: change.value }
    try {
      await api.updateItem(item.id, patch)
      setApplied(previous => ({ ...previous, [change.key]: { state: 'done' } }))
      pushToast({ type: 'ok', title: format(t('assistApplied'), { label: change.label }) })
      onChanged()
    } catch (error) {
      setApplied(previous => ({ ...previous, [change.key]: { state: 'error', error: friendlyError(t, error) } }))
      reportError(error)
    }
  }

  /* ---------------------------------------------------------- 整理 */
  const [org, setOrg] = React.useState(null)
  const [orgBusy, setOrgBusy] = React.useState(false)
  const [orgApplyingAll, setOrgApplyingAll] = React.useState(false)
  const [rows, setRows] = React.useState({})
  const candidates = React.useMemo(
    () => (items ?? []).filter(entry => (entry.status ?? 'active') === 'active').slice(0, MAX_ORGANIZE),
    [items],
  )
  const titleById = React.useMemo(() => {
    const map = {}
    for (const entry of items ?? []) map[entry.id] = entry.title || entry.path || entry.id
    return map
  }, [items])
  async function runOrganize() {
    if (orgBusy || !ready) return
    const ids = candidates.map(entry => entry.id)
    if (!ids.length) {
      setOrg({ mode: 'organize', model: status?.model ?? null, text: '', actions: { items: [] } })
      return
    }
    setOrgBusy(true)
    try {
      const data = await api.assist({ mode: 'organize', ids })
      setOrg(data)
      setRows({})
    } catch (error) {
      reportError(error)
    } finally {
      setOrgBusy(false)
    }
  }
  async function applyOrganize(entry) {
    if (!entry?.id || rows[entry.id]?.state === 'busy' || rows[entry.id]?.state === 'done') return false
    setRows(previous => ({ ...previous, [entry.id]: { state: 'busy' } }))
    const patch = {}
    if (typeof entry.collection === 'string' && entry.collection) patch.collection = entry.collection
    if (Array.isArray(entry.tags)) patch.tags = entry.tags
    if (!Object.keys(patch).length) {
      setRows(previous => ({ ...previous, [entry.id]: { state: 'error', error: t('assistNoActions') } }))
      return false
    }
    try {
      await api.updateItem(entry.id, patch)
      setRows(previous => ({ ...previous, [entry.id]: { state: 'done' } }))
      return true
    } catch (error) {
      setRows(previous => ({ ...previous, [entry.id]: { state: 'error', error: friendlyError(t, error) } }))
      return false
    }
  }
  async function applyOne(entry) {
    if (orgApplyingAll) return
    const ok = await applyOrganize(entry)
    if (ok) onChanged()
  }
  async function applyAll() {
    if (orgApplyingAll || !org?.actions?.items?.length) return
    setOrgApplyingAll(true)
    let count = 0
    try {
      for (const entry of org.actions.items) {
        if (rows[entry.id]?.state === 'done') continue
        const ok = await applyOrganize(entry)
        if (ok) count += 1
      }
    } finally {
      setOrgApplyingAll(false)
    }
    if (count) {
      onChanged()
      pushToast({ type: 'ok', title: format(t('assistAppliedCount'), { n: count }) })
    }
  }

  /* ---------------------------------------------------------- 提问 */
  const [question, setQuestion] = React.useState('')
  const [ask, setAsk] = React.useState(null)
  const [askBusy, setAskBusy] = React.useState(false)
  async function runAsk() {
    const text = question.trim()
    if (!text || askBusy || !ready) return
    setAskBusy(true)
    try {
      setAsk(await api.assist({ mode: 'ask', question: text }))
    } catch (error) {
      reportError(error)
    } finally {
      setAskBusy(false)
    }
  }
  const askFilters = ask?.actions?.filters ?? null
  const filterEntries = askFilters
    ? Object.entries(askFilters).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    : []
  function applyFilters() {
    if (!filterEntries.length) return
    onApplyFilters(askFilters)
    pushToast({ type: 'ok', title: t('assistFiltersApplied') })
  }

  if (!open) return null

  const statusNote = statusLoading
    ? t('assistStatusLoading')
    : statusError
      ? friendlyError(t, statusError)
      : modelLine(t, status)
  const retry = statusError
    ? h('button', { type: 'button', className: 'clib-btn', onClick: loadStatus, disabled: statusLoading }, t('assistRetry'))
    : null
  const warn = statusError || (status && !status.ready)
    ? h('div', { className: 'clib-assist-warn' },
      h('span', null, statusError ? friendlyError(t, statusError) : t('assistNeedReady')),
      retry)
    : null

  const tabBar = h('div', { className: 'clib-assist-tabs', role: 'tablist' },
    TABS.map(([key, label]) => h('button', {
      key,
      type: 'button',
      role: 'tab',
      'aria-selected': tab === key,
      className: `clib-assist-tab${tab === key ? ' is-on' : ''}`,
      onClick: () => setTab(key),
    }, t(label))))

  let pane
  if (tab === 'summary') {
    const changes = []
    if (sum?.actions && typeof sum.actions === 'object') {
      if (typeof sum.actions.title === 'string' && sum.actions.title) {
        changes.push({ key: 'title', label: t('fieldTitle'), value: sum.actions.title })
      }
      if (typeof sum.actions.collection === 'string' && sum.actions.collection) {
        changes.push({ key: 'collection', label: t('fieldCollection'), value: sum.actions.collection })
      }
      if (Array.isArray(sum.actions.tags) && sum.actions.tags.length) {
        changes.push({ key: 'tags', label: t('fieldTags'), value: sum.actions.tags, text: sum.actions.tags.join(', ') })
      }
    }
    pane = h('div', { className: 'clib-assist-pane' },
      item
        ? h('div', { className: 'clib-assist-card' },
          h('div', { className: 'clib-assist-card-head' },
            h(Icon, { name: 'note', size: 12 }),
            h('b', null, item.title || t('untitled')),
            h('span', { className: 'clib-assist-meta' }, t(KIND_LABEL_KEY(item.kind)))),
          h('div', { className: 'clib-assist-actions' },
            h('span', { className: 'clib-grow' }),
            h('button', {
              type: 'button',
              className: 'clib-btn is-primary',
              disabled: sumBusy || !ready,
              onClick: runSummary,
            }, sumBusy ? h(Spinner, { Icon }) : h(Icon, { name: 'sparkle', size: 12 }), sumBusy ? t('assistSummarizing') : t('assistSummarize'))))
        : h('div', { className: 'clib-assist-empty' }, t('assistSummaryHint')),
      sum?.text
        ? h('div', { className: 'clib-assist-card' },
          h('div', { className: 'clib-assist-card-head' }, h('b', null, t('assistSummaryResult'))),
          h(Markdown, { text: sum.text, className: 'is-plain' }),
          sum.model ? h('div', { className: 'clib-assist-meta' }, format(t('assistResultMeta'), { model: sum.model })) : null)
        : null,
      sum && !changes.length
        ? h('div', { className: 'clib-assist-empty' }, t('assistNoActions'))
        : null,
      changes.length
        ? h('div', { className: 'clib-assist-card' },
          changes.map(change => {
            const state = applied[change.key]
            return h('div', { key: change.key, className: 'clib-assist-change' },
              h('div', { className: 'clib-assist-change-main' },
                h('span', { className: 'clib-assist-change-label' }, change.label),
                h('span', { className: 'clib-assist-change-value' }, change.text ?? change.value),
                state?.state === 'error' ? h('span', { className: 'clib-assist-error' }, state.error) : null),
              state?.state === 'done'
                ? h('span', { className: 'clib-assist-done' }, h(Icon, { name: 'check', size: 12 }), t('assistAppliedShort'))
                : h('button', {
                  type: 'button',
                  className: 'clib-btn',
                  disabled: state?.state === 'busy' || !item,
                  onClick: () => applyChange(change),
                }, state?.state === 'busy' ? t('assistApplying') : t('assistApply')))
          }))
        : null)
  } else if (tab === 'organize') {
    const suggestions = org?.actions?.items ?? []
    const doneCount = suggestions.filter(entry => rows[entry.id]?.state === 'done').length
    pane = h('div', { className: 'clib-assist-pane' },
      h('div', { className: 'clib-assist-hint' }, t('assistOrganizeHint')),
      h('div', { className: 'clib-assist-actions' },
        h('button', {
          type: 'button', className: 'clib-btn is-primary', disabled: orgBusy || !ready || !candidates.length, onClick: runOrganize,
        }, orgBusy ? h(Spinner, { Icon }) : h(Icon, { name: 'sparkle', size: 12 }), orgBusy ? t('assistOrganizeRunning') : t('assistOrganizeRun')),
        h('span', { className: 'clib-assist-meta' }, format(t('assistOrganizeTargets'), { n: candidates.length }))),
      org && !suggestions.length
        ? h('div', { className: 'clib-assist-empty' }, t('assistOrganizeEmpty'))
        : null,
      suggestions.length
        ? h(React.Fragment, null,
          h('div', { className: 'clib-assist-actions' },
            h('span', { className: 'clib-grow' }),
            h('button', {
              type: 'button', className: 'clib-btn', disabled: orgApplyingAll || doneCount >= suggestions.length, onClick: applyAll,
            }, orgApplyingAll ? h(Spinner, { Icon }) : h(Icon, { name: 'check', size: 12 }), t('assistApplyAll'))),
          h('table', { className: 'clib-assist-table' },
            h('colgroup', null,
              h('col', null), h('col', { style: { width: '58px' } }), h('col', { style: { width: '74px' } }),
              h('col', null), h('col', { style: { width: '46px' } })),
            h('thead', null, h('tr', null,
              h('th', null, t('colTitle')),
              h('th', null, t('assistSuggestedCollection')),
              h('th', null, t('assistSuggestedTags')),
              h('th', null, t('assistReason')),
              h('th', null, ''))),
            h('tbody', null, suggestions.map(entry => {
              const state = rows[entry.id]
              return h(React.Fragment, { key: entry.id },
                h('tr', { className: state?.state === 'done' ? 'is-done' : undefined },
                  h('td', { className: 'clib-assist-td-title' }, titleById[entry.id] || entry.id),
                  h('td', null, entry.collection || '—'),
                  h('td', null, h('span', { className: 'clib-assist-tags' },
                    (entry.tags ?? []).length
                      ? entry.tags.map(tag => h('span', { key: tag, className: 'clib-mini-tag' }, `#${tag}`))
                      : t('assistNoTags'))),
                  h('td', { className: 'clib-assist-td-reason' }, entry.reason || ''),
                  h('td', { className: 'clib-assist-td-action' },
                    state?.state === 'done'
                      ? h('span', { className: 'clib-assist-done' }, h(Icon, { name: 'check', size: 11 }))
                      : state?.state === 'error'
                        ? h('span', { className: 'clib-assist-error' }, t('assistFailed'))
                        : h('button', {
                          type: 'button', className: 'clib-btn', disabled: orgApplyingAll || state?.state === 'busy', onClick: () => applyOne(entry),
                        }, state?.state === 'busy' ? '…' : t('assistApply')))),
                state?.state === 'error'
                  ? h('tr', null, h('td', { className: 'clib-assist-error-row', colSpan: 5 }, state.error || t('assistFailed')))
                  : null)
            }))))
        : null)
  } else {
    pane = h('div', { className: 'clib-assist-pane' },
      h('div', { className: 'clib-assist-hint' }, t('assistAskHint')),
      h('div', { className: 'clib-assist-ask' },
        h('input', {
          className: 'clib-input',
          value: question,
          placeholder: t('assistAskPlaceholder'),
          'aria-label': t('assistAskPlaceholder'),
          onChange: event => setQuestion(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') runAsk() },
        }),
        h('button', {
          type: 'button', className: 'clib-btn is-primary', disabled: askBusy || !ready || !question.trim(), onClick: runAsk,
        }, askBusy ? h(Spinner, { Icon }) : null, askBusy ? t('assistAsking') : t('assistAskRun'))),
      ask?.text
        ? h('div', { className: 'clib-assist-card' },
          h('div', { className: 'clib-assist-card-head' }, h('b', null, t('assistAnswer'))),
          h(Markdown, { text: ask.text, className: 'is-plain' }),
          ask.model ? h('div', { className: 'clib-assist-meta' }, format(t('assistResultMeta'), { model: ask.model })) : null)
        : null,
      ask && !filterEntries.length
        ? h('div', { className: 'clib-assist-empty' }, t('assistNoFilters'))
        : null,
      filterEntries.length
        ? h('div', { className: 'clib-assist-card' },
          h('div', { className: 'clib-assist-tags' },
            filterEntries.map(([key, value]) => h('span', { key, className: 'clib-mini-tag' }, `${key}: ${value}`))),
          h('div', { className: 'clib-assist-actions' },
            h('button', { type: 'button', className: 'clib-btn is-primary', onClick: applyFilters },
              h(Icon, { name: 'search', size: 12 }), t('assistApplyFilter'))))
        : null)
  }

  return h('aside', {
    className: 'clib-assist',
    role: 'complementary',
    'aria-label': t('assistTitle'),
  },
  h('div', { className: 'clib-assist-head' },
    h(Icon, { name: 'sparkle', size: 15 }),
    h('div', { className: 'clib-assist-titles' },
      h('b', null, t('assistTitle')),
      h('small', null, statusNote)),
    h('button', {
      type: 'button', className: 'clib-btn clib-icon', onClick: onClose, title: t('close'), 'aria-label': t('close'),
    }, h(Icon, { name: 'close', size: 12 }))),
  tabBar,
  h('div', { className: 'clib-assist-body' }, warn, pane))
}
/** 只是把 kind 映射成已有的 kindDoc 等 i18n 键，避免 assist.jsx 依赖 app.jsx。 */
function KIND_LABEL_KEY(kind) {
  const map = {
    doc: 'kindDoc', script: 'kindScript', image: 'kindImage',
    data: 'kindData', session: 'kindSession', note: 'kindNote', other: 'kindOther',
  }
  return map[kind] ?? 'kindOther'
}
