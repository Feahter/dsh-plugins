import React from 'react'

// --------------------------------------------------------------------- 语音
// 接入 DSH 的 `voiceInput` 服务（由 realtime-voice 插件提供）：识别、排版、
// 翻译都在那边，画布只负责「这串文字该落到哪个输入框的哪个位置」。
// 服务不存在时整个组件静默消失，画布行为与没有这个文件时完全一致。

let api = null
const listeners = new Set()

/**
 * 在 apply() 里调（可以多调几次）：从宿主容器里取 voiceInput 服务。
 * 插件加载顺序不保证 realtime-voice 先就位，所以拿不到时静默返回 null，
 * 由调用方按需重试；一旦拿到就通知正在等它的按钮重新渲染。
 */
export function bindVoiceApi(ctx) {
  let next = null
  try {
    next = ctx?.get?.('voiceInput') || null
  } catch (error) {
    next = null
    console.warn('[mind-canvas] voiceInput 不可用：', error)
  }
  if (next && next !== api) {
    api = next
    for (const listener of listeners) {
      try { listener(api) } catch (error) { console.warn('[mind-canvas] 语音就绪通知失败：', error) }
    }
  }
  return api
}

export function getVoiceApi() {
  return api
}

/** 组件里用：voiceInput 晚到时会自己补上，不用父组件重渲染。 */
export function useVoiceApi() {
  const [current, setCurrent] = React.useState(api)
  React.useEffect(() => {
    if (current) return undefined
    listeners.add(setCurrent)
    const timer = setInterval(() => { if (api) setCurrent(api) }, 1000)
    return () => {
      listeners.delete(setCurrent)
      clearInterval(timer)
    }
  }, [current])
  return current
}

/** 把 text 插到 value 的 span 位置；span 缺失就追加到末尾。 */
export function spliceAt(value, span, text) {
  const current = String(value ?? '')
  const from = span && Number.isFinite(span.from) ? Math.max(0, Math.min(span.from, current.length)) : current.length
  const to = span && Number.isFinite(span.to) ? Math.max(from, Math.min(span.to, current.length)) : from
  return current.slice(0, from) + text + current.slice(to)
}

function MicIcon({ size = 14 }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  },
  React.createElement('rect', { x: 5.6, y: 1.8, width: 4.8, height: 8.2, rx: 2.4 }),
  React.createElement('path', { d: 'M3.4 7.6a4.6 4.6 0 0 0 9.2 0' }),
  React.createElement('path', { d: 'M8 12.4v1.8' }),
  )
}

/**
 * 一个绑在输入框上的语音按钮。
 * - id：surface 唯一名（同一输入框复用同一个 id，重新 attach 会覆盖旧的）
 * - getField()：返回当前 DOM 元素，用来取光标位置
 * - insert(text, span)：把文字写回输入框，成功返回 true
 * - onState：可选，外部想同步状态时用
 */
export function VoiceButton(props) {
  const { id, getField, insert, onState, t, className = '' } = props
  const voiceApi = useVoiceApi()
  const [state, setState] = React.useState({ phase: 'idle', waiting: false })
  const handleRef = React.useRef(null)
  const fieldRef = React.useRef(getField)
  const insertRef = React.useRef(insert)
  fieldRef.current = getField
  insertRef.current = insert

  React.useEffect(() => {
    if (!voiceApi) return undefined
    const handle = voiceApi.attach({
      id,
      label: id,
      captureInsertion: () => {
        const element = fieldRef.current && fieldRef.current()
        if (!element) return { from: String(element?.value ?? '').length, to: String(element?.value ?? '').length }
        const from = typeof element.selectionStart === 'number' ? element.selectionStart : element.value.length
        const to = typeof element.selectionEnd === 'number' ? element.selectionEnd : from
        return { from, to }
      },
      insertText: (text, span) => {
        try {
          return insertRef.current(text, span) !== false
        } catch (error) {
          console.error('[mind-canvas] 语音插入失败：', error)
          return false
        }
      },
      onState: (next) => {
        setState(next)
        if (typeof onState === 'function') onState(next)
      },
    })
    handleRef.current = handle
    return () => {
      handleRef.current = null
      try { handle.detach() } catch (error) { console.warn('[mind-canvas] 语音解绑失败：', error) }
    }
    // onState 不参与依赖：调用方通常传内联函数，重挂会丢掉正在录的音。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, voiceApi])

  if (!voiceApi) return null

  const phase = state?.phase || 'idle'
  const listening = phase === 'listening'
  const waiting = Boolean(state?.waiting)
  const error = phase === 'error'
  const title = error && state?.error
    ? String(state.error)
    : listening
      ? t('voiceStop')
      : t('voiceStart')

  return React.createElement('button', {
    type: 'button',
    className: `mc-voice${listening ? ' is-live' : ''}${waiting ? ' is-waiting' : ''}${error ? ' is-error' : ''}${className ? ` ${className}` : ''}`,
    title,
    'aria-label': title,
    'aria-pressed': listening,
    onClick: (event) => {
      event.preventDefault()
      event.stopPropagation()
      const handle = handleRef.current
      if (!handle) return
      handle.toggle()
    },
    onMouseDown: (event) => event.stopPropagation(),
    onPointerDown: (event) => event.stopPropagation(),
    onKeyDown: (event) => event.stopPropagation(),
  },
  React.createElement(MicIcon, null),
  waiting ? React.createElement('span', { className: 'mc-voice-dots' }, '\u2026') : null,
  )
}
