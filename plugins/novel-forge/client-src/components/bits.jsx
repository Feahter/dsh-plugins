// 小零件：按钮、徽章、进度条、Markdown、Toast、空态，以及几个纯函数工具。
// 所有组件只吃 props，不碰全局状态，方便在 Workbench 各处复用。
import React from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export const cx = (...parts) => parts.filter(Boolean).join(' ')

// ---------------------------------------------------------------- 格式化
const numberFormat = new Intl.NumberFormat('zh-CN')

/** 5400 → 5,400 */
export const formatNumber = value => numberFormat.format(Number(value) || 0)

/** 字数：超过一万给「1.2 万字」，否则原样加千分位。 */
export function formatWords(value) {
  const words = Number(value) || 0
  if (words >= 10000) return `${(words / 10000).toFixed(1).replace(/\.0$/, '')} 万字`
  return `${formatNumber(words)} 字`
}

/** token 量级：只给概数，别装作很精确。 */
export function formatTokens(value) {
  const tokens = Number(value) || 0
  if (tokens >= 10000) return `≈ ${(tokens / 10000).toFixed(1).replace(/\.0$/, '')} 万`
  if (tokens >= 1000) return `≈ ${(tokens / 1000).toFixed(1).replace(/\.0$/, '')} 千`
  return `≈ ${formatNumber(tokens)}`
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 / 具体日期。 */
export function formatRelative(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 0) return '刚刚'
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(then).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

/** 事件流的时间戳：只给时分秒，安静一点。 */
export function formatClock(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ---------------------------------------------------------------- Markdown
marked.setOptions({ gfm: true, breaks: true })

/** 宿主里渲染模型产出的 markdown：先 marked，再 DOMPurify 洗一遍。 */
export function Markdown({ text, className }) {
  const html = React.useMemo(() => {
    if (!text) return ''
    try {
      return DOMPurify.sanitize(marked.parse(String(text)))
    } catch (error) {
      console.error('[novel-forge] markdown 渲染失败：', error)
      return ''
    }
  }, [text])

  if (!text) return React.createElement('p', { className: 'nf-muted' }, '（还没有内容）')
  return React.createElement('div', {
    className: cx('nf-prose', className),
    dangerouslySetInnerHTML: { __html: html },
  })
}

// ---------------------------------------------------------------- 基础件
export function Button({ variant = 'default', size = 'md', busy = false, className, children, ...rest }) {
  return React.createElement('button', {
    type: 'button',
    ...rest,
    className: cx('nf-btn', variant !== 'default' && `nf-btn-${variant}`, size === 'sm' && 'nf-btn-sm', className),
    disabled: rest.disabled || busy,
  }, busy ? React.createElement(Spinner, { size: 12 }) : null, children)
}

export function Spinner({ size = 14 }) {
  return React.createElement('span', {
    className: 'nf-spinner',
    style: { width: size, height: size },
    'aria-hidden': true,
  })
}

export function Badge({ tone = 'default', children, title }) {
  return React.createElement('span', { className: cx('nf-badge', `nf-badge-${tone}`), title }, children)
}

export function Dot({ status }) {
  return React.createElement('span', { className: cx('nf-dot', `is-${status || 'idle'}`), 'aria-hidden': true })
}

/** 细进度条；value/total 都为 0 时只画一条空轨。 */
export function ProgressBar({ value = 0, total = 0, tone = 'ink' }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0
  return React.createElement('span', {
    className: cx('nf-progress', `nf-progress-${tone}`),
    role: 'progressbar',
    'aria-valuenow': value,
    'aria-valuemin': 0,
    'aria-valuemax': total || 0,
  }, React.createElement('i', { style: { width: `${percent}%` } }))
}

export function Field({ label, hint, children, className }) {
  return React.createElement('label', { className: cx('nf-field', className) },
    React.createElement('span', { className: 'nf-label' }, label, hint ? React.createElement('em', null, hint) : null),
    children,
  )
}

export function Switch({ checked, onChange, label, hint }) {
  return React.createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': Boolean(checked),
    className: cx('nf-switch-row', checked && 'is-on'),
    onClick: () => onChange(!checked),
  },
  React.createElement('span', { className: 'nf-switch' }, React.createElement('i', null)),
  React.createElement('span', { className: 'nf-switch-text' },
    React.createElement('b', null, label),
    hint ? React.createElement('small', null, hint) : null,
  ))
}

export function Empty({ title, body, children }) {
  return React.createElement('div', { className: 'nf-empty' },
    React.createElement('div', { className: 'nf-empty-mark', 'aria-hidden': true }, '墨'),
    React.createElement('h2', null, title),
    body ? React.createElement('p', null, body) : null,
    children,
  )
}

export function ToastHost({ toast, onDismiss }) {
  React.useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(onDismiss, toast.kind === 'error' ? 6000 : 3200)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  if (!toast) return null
  return React.createElement('div', { className: cx('nf-toast', `nf-toast-${toast.kind || 'info'}`), role: 'status' },
    React.createElement('span', { className: 'nf-toast-text' }, toast.message),
    React.createElement('button', { type: 'button', className: 'nf-toast-close', onClick: onDismiss, 'aria-label': '关闭' }, '×'),
  )
}

// ---------------------------------------------------------------- 图标
const svg = (props, ...children) => React.createElement('svg', {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true, ...props,
}, ...children)

export const Icon = {
  back: props => svg(props, React.createElement('path', { d: 'M9.8 3.5 5.2 8l4.6 4.5' })),
  plus: props => svg(props, React.createElement('path', { d: 'M8 3v10M3 8h10' })),
  play: props => svg(props, React.createElement('path', { d: 'M5 3.4v9.2L12.4 8 5 3.4Z' })),
  refresh: props => svg(props, React.createElement('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5h-2.4' })),
  download: props => svg(props, React.createElement('path', { d: 'M8 2.5v7.2M5 7l3 3 3-3M3 13h10' })),
  trash: props => svg(props, React.createElement('path', { d: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.2h5.8l.6-8.2' })),
  close: props => svg(props, React.createElement('path', { d: 'M4 4l8 8M12 4l-8 8' })),
  check: props => svg(props, React.createElement('path', { d: 'M3.5 8.4 6.6 11.5 12.5 4.8' })),
  chevron: props => svg(props, React.createElement('path', { d: 'M6 3.5 10.5 8 6 12.5' })),
  book: props => svg(props, React.createElement('path', { d: 'M3 3.2h4.2A2.8 2.8 0 0 1 10 6v6a2.2 2.2 0 0 0-2.2-2.2H3V3.2Zm10 0H8.8A2.8 2.8 0 0 0 6 6v6a2.2 2.2 0 0 1 2.2-2.2H13V3.2Z' })),
  pen: props => svg(props, React.createElement('path', { d: 'M3 13h10M4.4 10.2 11.6 3a1.3 1.3 0 0 1 1.8 0l.4.4a1.3 1.3 0 0 1 0 1.8l-7.2 7.2-2.6.6.4-2.8Z' })),
  stop: props => svg(props, React.createElement('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.5 })),
}
