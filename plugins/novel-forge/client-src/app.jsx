// 应用壳：书架 / 新建 / 工作台三态，顶栏统一。
import React from 'react'
import { Shelf } from './components/Shelf.jsx'
import { CreateWizard } from './components/CreateWizard.jsx'
import { Workbench } from './components/Workbench.jsx'
import { Icon, ToastHost } from './components/bits.jsx'

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

export function App({ onExit }) {
  const [view, setView] = React.useState({ name: 'list' })
  const [toast, setToast] = React.useState(null)

  const notify = React.useCallback((message, kind = 'ok') => {
    setToast({ id: Date.now(), message, kind })
  }, [])

  const dismiss = React.useCallback(() => setToast(null), [])

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

  return React.createElement('div', { className: 'nf-root' },
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
        React.createElement('button', { type: 'button', className: 'nf-icon-btn', onClick: onExit },
          Icon.back, '返回对话'),
      ),
    ),
    body,
    React.createElement(ToastHost, { toast, onDismiss: dismiss }),
  )
}
