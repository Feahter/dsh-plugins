import React from 'react'
import { MindCanvasPage, injectStylesOnce } from './app.jsx'
import { en, zh } from './strings.js'
import { bindVoiceApi } from './voice.jsx'

const NS = 'mind-canvas'
const PANEL_KEY = 'mind-canvas'

let runtime = {
  t: key => key,
  lang: 'zh',
}

/** 由 apply 里绑定：返回对话（activePanelId = null）。 */
let exitPanel = () => {}

function PanelIcon({ size = 16 }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  },
  React.createElement('rect', { x: 1.5, y: 6, width: 4.2, height: 4.2, rx: 1.2 }),
  React.createElement('rect', { x: 10.3, y: 1.5, width: 4.2, height: 4.2, rx: 1.2 }),
  React.createElement('rect', { x: 10.3, y: 10.3, width: 4.2, height: 4.2, rx: 1.2 }),
  React.createElement('path', { d: 'M5.7 8h2.2a1 1 0 0 0 1-1V4.6' }),
  React.createElement('path', { d: 'M5.7 8h2.2a1 1 0 0 1 1 1v2.4' }),
  )
}

function Page() {
  return React.createElement(MindCanvasPage, { t: runtime.t, lang: runtime.lang, onExit: exitPanel })
}

/**
 * 浏览器半片：注册侧栏入口和主页面。
 * 所有注册都放进 ctx.effect / ctx.slots.inject，HMR 重跑 apply 时才能干净地拆掉。
 */
export function apply(ctx) {
  runtime.t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : key => key
  runtime.lang = (() => {
    try {
      return ctx.locale?.getLocale?.()?.active ?? 'zh'
    } catch {
      return 'zh'
    }
  })()

  // 布局服务可能没注入（比如被裁掉的组合里），所以用 ctx.get 探测而不是硬依赖。
  exitPanel = () => {
    try {
      const layout = ctx.get('layout')
      if (typeof layout?.selectPanel === 'function') layout.selectPanel(null)
    } catch (error) {
      console.error('[mind-canvas] 返回对话失败：', error)
    }
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mind-canvas: dictionaries')

  // 语音输入是可选增强：realtime-voice 晚加载也能补上，最多等 30 秒。
  ctx.effect(() => {
    bindVoiceApi(ctx)
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (bindVoiceApi(ctx) || tries > 30) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, 'mind-canvas: voice bridge')
  ctx.effect(() => injectStylesOnce(document), 'mind-canvas: styles')
  ctx.effect(() => () => {
    runtime = { t: key => key, lang: 'zh' }
    exitPanel = () => {}
  }, 'mind-canvas: teardown')

  // 一个插件入口挂掉不该把整个页面带崩（宿主会整页报「Failed to load plugins」），
  // 所以两条注册各自兜底：失败就只是少一个入口，并把原因留在控制台。
  const guard = (label, register) => {
    try {
      register()
    } catch (error) {
      console.error(`[mind-canvas] ${label} 注册失败：`, error)
    }
  }

  guard('侧栏入口', () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_KEY,
    order: 6,
    label: () => runtime.t('panelTitle'),
  }, PanelIcon)))

  guard('主页面', () => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_KEY,
  }, Page)))
}

export const inject = ['slots', 'locale']
