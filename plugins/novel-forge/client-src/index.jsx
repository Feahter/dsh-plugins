// 插件入口：注册侧栏条目与主面板，样式与文案都从这里挂上去。
import React from 'react'
import zhPack from '../locale/zh.json'
import enPack from '../locale/en.json'
import { App } from './app.jsx'
import { injectStylesOnce } from './style.js'
import { zh, en } from './strings.js'

const NS = 'novel-forge'
const PANEL_KEY = 'novel-forge'
// 侧栏 id 必须与 main 的 key 完全一致：宿主点击侧栏时按 id 去选 main panel。
const PANEL_ID = PANEL_KEY

export const inject = ['slots', 'locale']

/** 侧栏图标：与包根 icon.svg 同一组笔迹。 */
function PenIcon(props) {
  return React.createElement('svg', {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  },
  React.createElement('path', { d: 'M3 14h10' }),
  React.createElement('path', { d: 'M4.2 10.6 11.9 2.9a1.35 1.35 0 0 1 1.9 0l.3.3a1.35 1.35 0 0 1 0 1.9L6.4 12.8l-3 .8.8-3Z' }),
  React.createElement('path', { d: 'M10.6 4.2l1.9 1.9' }),
  React.createElement('path', { d: 'M3 2.5c.9.6 1.4 1.4 1.4 2.4' }),
  )
}

export function apply(ctx) {

  // 面板名以包内 locale 文件为准，文案表只做兜底。
  const zhDict = { ...zh, panelTitle: zhPack?.meta?.title || zh.panelTitle }
  const enDict = { ...en, panelTitle: enPack?.meta?.title || en.panelTitle }

  try {
    ctx.locale.register(NS, { zh: zhDict, en: enDict })
  } catch (error) {
    console.warn('[novel-forge] 注册文案失败：', error)
  }

  ctx.effect(() => injectStylesOnce(document))

  const exitPanel = () => {
    try {
      ctx.get('layout')?.selectPanel?.(null)
    } catch (error) {
      console.warn('[novel-forge] 返回对话失败：', error)
    }
  }

  const Page = () => React.createElement(App, { onExit: exitPanel })

  ctx.effect(() => {
    const disposers = []
    try {
      disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 55,
        label: () => zhDict.panelTitle,
      }, PenIcon)))
    } catch (error) {
      console.warn('[novel-forge] 注册侧栏失败：', error)
    }
    try {
      disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, Page)))
    } catch (error) {
      console.warn('[novel-forge] 注册主面板失败：', error)
    }
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose()
      }
    }
  })
}
