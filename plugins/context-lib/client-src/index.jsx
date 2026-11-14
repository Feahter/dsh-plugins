import React from 'react'
import { ContextLibraryPage } from './app.jsx'
import { injectStylesOnce } from './style.js'
import { en, zh } from './strings.js'

const NS = 'context-lib'
const PANEL_KEY = 'context-lib'

let runtime = { t: key => key }
let exitPanel = () => {}

function PanelIcon({ size = 16 }) {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  },
  React.createElement('path', { d: 'M2 3.2h3.7c1.2 0 2.2.7 2.3 1.8v8c-.4-1.1-1.4-1.8-2.6-1.8H2z' }),
  React.createElement('path', { d: 'M8 5c.1-1.1 1.1-1.8 2.3-1.8H14v8h-3.7c-1.2 0-2.2.7-2.6 1.8' }),
  React.createElement('path', { d: 'M3 6.4h2.6M3 8.8h2.6' })
  )
}

function Page() {
  return React.createElement(ContextLibraryPage, { t: runtime.t, onExit: exitPanel })
}

/**
 * 浏览器半片：注册侧栏入口和主页面。
 * 所有注册都放进 ctx.effect / ctx.slots.inject，HMR 重跑 apply 时才能干净地拆掉。
 */
export function apply(ctx) {
  runtime.t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : key => key

  // 布局服务可能没注入；用 ctx.get 探测，缺了就只是退不回去。
  exitPanel = () => {
    try {
      const layout = ctx.get('layout')
      if (typeof layout?.selectPanel === 'function') layout.selectPanel(null)
    } catch (error) {
      console.error('[context-lib] 返回对话失败：', error)
    }
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'context-lib: dictionaries')
  ctx.effect(() => injectStylesOnce(document), 'context-lib: styles')
  ctx.effect(() => () => {
    runtime = { t: key => key }
    exitPanel = () => {}
  }, 'context-lib: teardown')

  // 一个入口挂掉不该带崩整个页面：失败就少一个入口，原因留在控制台。
  const guard = (label, register) => {
    try {
      register()
    } catch (error) {
      console.error(`[context-lib] ${label} 注册失败：`, error)
    }
  }

  guard('侧栏入口', () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_KEY,
    order: 7,
    label: () => runtime.t('panelTitle'),
  }, PanelIcon)))

  guard('主页面', () => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_KEY,
  }, Page)))
}

export const inject = ['slots', 'locale']
