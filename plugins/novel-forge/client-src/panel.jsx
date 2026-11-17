// 墨炉面板实现：只在用户第一次打开侧栏时才由 client.js 动态加载。
// 编辑器、工作台、导出等依赖与样式都留在这里，启动阶段只跑侧栏注册。
import React from 'react'
import { App } from './app.jsx'
import { injectStylesOnce } from './style.js'

injectStylesOnce(document)

export function Panel({ onExit }) {
  return React.createElement(App, { onExit })
}
