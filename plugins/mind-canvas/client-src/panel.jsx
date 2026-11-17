// 面板实现：只在用户第一次打开脑图画布时由 client.js 动态加载。
// 画布依赖（React Flow、d3-hierarchy）、样式和语音桥都放在这里，
// 首屏只留侧栏图标与语言包，启动阶段不再执行这 280KB。
import React from 'react'
import { MindCanvasPage, injectStylesOnce } from './app.jsx'
import { bindVoiceApi } from './voice.jsx'

injectStylesOnce(document)

export function Panel({ t, lang, onExit }) {
  return React.createElement(MindCanvasPage, { t, lang, onExit })
}

/**
 * 语音输入是可选增强：面板打开时先尝试绑定，服务晚到就每秒重试，最多 30 秒。
 * @returns 停止重试的清理函数。
 */
export function startVoice(ctx) {
  bindVoiceApi(ctx)
  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if (bindVoiceApi(ctx) || tries > 30) clearInterval(timer)
  }, 1000)
  return () => clearInterval(timer)
}
