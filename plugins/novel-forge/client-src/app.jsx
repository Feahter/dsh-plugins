// 应用壳：书架 / 新建 / 工作台三态，顶栏统一。
import React from 'react'
import { Shelf } from './components/Shelf.jsx'
import { CreateWizard } from './components/CreateWizard.jsx'
import { Workbench } from './components/Workbench.jsx'
import { Icon, ToastHost } from './components/bits.jsx'
import { getToolState, getVersion, setToolState } from './api.js'
import { zh } from './strings.js'

function Seal() {
  return React.createElement('span', {
    'aria-hidden': true,
    style: {
      width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center',
      border: '1px solid var(--nf-cinnabar)', color: 'var(--nf-cinnabar)',
      fontFamily: 'var(--nf-serif)', fontSize: 16, lineHeight: 1,
      background: 'var(--nf-cinnabar-soft)', borderRadius: 2,
    },
  }, '墨')
}

// 有新版本时在顶栏右端显示「新版本 ↑ vX.Y.Z」，点击打开插件页；无更新或失败时不渲染。
function VersionBadge() {
  const [version, setVersion] = React.useState(null)
  React.useEffect(() => {
    let alive = true
    getVersion().then(data => { if (alive) setVersion(data) }).catch(() => {})
    return () => { alive = false }
  }, [])
  if (!version || version.updateAvailable !== true || typeof version.latest !== 'string') return null
  const href = typeof version.homepage === 'string' ? version.homepage : 'https://github.com/Feahter/dsh-plugins'
  const tip = String(zh.updateTip || '').replace('{version}', `v${version.latest}`)
  return React.createElement('a', {
    className: 'nf-version',
    href,
    target: '_blank',
    rel: 'noreferrer',
    title: tip,
    'aria-label': tip,
  },
  React.createElement('span', { className: 'nf-version-label' }, zh.updateLabel),
  React.createElement('span', { className: 'nf-version-number' }, `↑ v${version.latest}`))
}

export function App({ onExit }) {
  const [view, setView] = React.useState({ name: 'list' })
  const [toast, setToast] = React.useState(null)

  const notify = React.useCallback((message, kind = 'ok') => {
    setToast({ id: Date.now(), message, kind })
  }, [])

  const dismiss = React.useCallback(() => setToast(null), [])

  // 对话工具开关：宿主存的是 { active, latest }。开关只反映「最近一次对话」在不在名单里，
  // 不看全局面——否则在 A 对话点开、切到 B，按钮会显示「开」而 B 其实没有工具。
  const [tools, setTools] = React.useState(null)
  const [toolsBusy, setToolsBusy] = React.useState(false)
  const [toolsError, setToolsError] = React.useState('')
  const activeTools = tools && Array.isArray(tools.active) ? tools.active : []
  const latestConversation = tools && typeof tools.latest === 'string' ? tools.latest : ''
  const toolsOn = Boolean(latestConversation && activeTools.includes(latestConversation))

  React.useEffect(() => {
    let alive = true
    getToolState()
      .then(next => { if (alive) setTools(next) })
      .catch(() => {
        // 拉不到初始状态就静默按「关」显示，不打扰用户。
        if (alive) setTools(null)
      })
    return () => { alive = false }
  }, [])

  const toggleTools = React.useCallback(async () => {
    if (toolsBusy) return
    setToolsBusy(true)
    try {
      // 关的时候只关「最近一次对话」，不再清空所有会话；开的时候宿主自己认最近的活跃对话。
      const next = toolsOn
        ? await setToolState({ enabled: false, conversationId: latestConversation })
        : await setToolState({ enabled: true })
      setTools(next)
      setToolsError('')
      notify(toolsOn ? zh.toolsClosed : zh.toolsOpened)
    } catch (error) {
      const message = error?.code === 'NO_SESSION' ? zh.toolsNeedSession : (error?.message || '切换对话工具失败')
      setToolsError(message)
      notify(message, 'error')
    } finally {
      setToolsBusy(false)
    }
  }, [latestConversation, notify, toolsBusy, toolsOn])

  let body
  if (view.name === 'create') {
    body = React.createElement('div', { className: 'nf-scroll' },
      React.createElement(CreateWizard, {
        onCancel: () => setView({ name: 'list' }),
        onCreated: id => setView({ name: 'workbench', projectId: id }),
        notify,
      }),
    )
  } else if (view.name === 'workbench') {
    body = React.createElement(Workbench, {
      projectId: view.projectId,
      onBack: () => setView({ name: 'list' }),
      notify,
    })
  } else {
    body = React.createElement('div', { className: 'nf-scroll' },
      React.createElement(Shelf, {
        onOpen: id => setView({ name: 'workbench', projectId: id }),
        onNew: () => setView({ name: 'create' }),
        notify,
      }),
    )
  }

  // 面板理论上用 `.nf-root{position:absolute;inset:0}` 铺满宿主给的槽位。但宿主布局不一定
  // 给了一个高度正确、且被定位过的祖先：祖先未定位时 inset:0 会落到视口上，祖先比视口矮时
  // 底部会被顶栏/输入框盖住，而面板自己 overflow:hidden，滚也滚不出来。
  // 这里量父容器实际的可见矩形，把面板钉到那个矩形上（fixed + 显式宽高），只在偏差超过
  // 1px 时才写内联样式——布局本来就对的时候一个像素都不动。
  const rootRef = React.useRef(null)
  React.useEffect(() => {
    const element = rootRef.current
    if (!element || typeof window === 'undefined') return
    const fit = () => {
      const parent = element.parentElement
      if (!parent) return
      const box = parent.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return
      const top = Math.max(0, Math.round(box.top))
      const left = Math.round(box.left)
      const width = Math.round(box.width)
      const height = Math.round(Math.min(box.bottom, window.innerHeight) - top)
      if (height < 120) return
      const rect = element.getBoundingClientRect()
      if (
        Math.abs(rect.top - top) <= 1 &&
        Math.abs(rect.left - left) <= 1 &&
        Math.abs(rect.width - width) <= 1 &&
        Math.abs(rect.height - height) <= 1
      ) return
      element.style.position = 'fixed'
      element.style.top = `${top}px`
      element.style.left = `${left}px`
      element.style.width = `${width}px`
      element.style.height = `${height}px`
    }
    fit()
    window.addEventListener('resize', fit)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    const parent = element.parentElement
    if (observer && parent) observer.observe(parent)
    return () => {
      window.removeEventListener('resize', fit)
      observer?.disconnect()
    }
  }, [])

  return React.createElement('div', { className: 'nf-root', ref: rootRef },
    React.createElement('header', { className: 'nf-top' },
      React.createElement(Seal),
      React.createElement('div', { className: 'nf-brand' },
        React.createElement('b', null, '墨炉'),
        React.createElement('small', null, 'NOVEL FORGE · 长篇流水线'),
      ),
      React.createElement('span', { className: 'nf-top-rule' }),
      React.createElement('span', { style: { fontSize: 11, color: 'var(--nf-ink-3)', letterSpacing: '.06em' } },
        '一句话进，长篇出。'),
      React.createElement('span', { className: 'nf-grow' }),
      React.createElement('div', { className: 'nf-top-actions' },
        React.createElement('button', {
          type: 'button',
          className: toolsOn ? 'nf-btn nf-btn-sm nf-btn-accent' : 'nf-btn nf-btn-sm',
          onClick: toggleTools,
          disabled: toolsBusy,
          'aria-pressed': toolsOn,
          title: toolsError || zh.toolsHint,
        }, toolsOn ? zh.toolsOn : zh.toolsOff),
        React.createElement('button', { type: 'button', className: 'nf-icon-btn', onClick: onExit },
          Icon.back, '返回对话'),
      ),
      React.createElement(VersionBadge),
    ),
    body,
    React.createElement(ToastHost, { toast, onDismiss: dismiss }),
  )
}
