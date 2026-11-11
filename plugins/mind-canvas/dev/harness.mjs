// 本地验证用的「假宿主」：模拟 __ModuleLoader__、seed 模块表和 Cordis 上下文，
// 让真实的 client.js 在浏览器里按插件的方式跑起来。仅供开发验证，不随包发布。
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom/client'

window.React = React
window.jsxRuntime = jsxRuntime

const MODULES = {
  'react': React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': ReactDOM,
}

const registry = window.__ModuleLoader__?.pending ?? []
const registration = registry.find(item => item && item.id === 'dsh-mind-canvas')
if (!registration) {
  document.body.innerHTML = '<pre style="color:#c00">没有找到 dsh-mind-canvas 的注册（client.js 没加载？）</pre>'
  throw new Error('registration missing')
}

const require = id => {
  if (id in MODULES) return MODULES[id]
  throw new Error(`harness: 没有 seed 模块 "${id}"`)
}

const plugin = registration.factory(require)
window.__plugin = plugin

// ------------------------------------------------------------------ 假 ctx
const effects = []
const registered = []
const dicts = {}

const locale = {
  register(namespace, dictionaries) {
    dicts[namespace] = dictionaries
    return () => { delete dicts[namespace] }
  },
  bind(namespace) {
    return (key, vars) => {
      const table = dicts[namespace] ?? {}
      const active = table.zh ?? {}
      const template = active[key] ?? table.en?.[key] ?? key
      if (!vars) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
    }
  },
  getLocale() { return { active: 'zh' } },
}

const slots = {
  inject(name, callback) {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  register(options, Component) {
    registered.push({ ...options, Component })
    return () => {
      const index = registered.findIndex(item => item.id === options.id && item.name === options.name)
      if (index >= 0) registered.splice(index, 1)
    }
  },
}

// 布局服务：只需要 selectPanel，用来验证「返回对话」
const layoutCalls = []
const layout = {
  selectPanel(panelId) {
    layoutCalls.push(panelId)
    window.__selectedPanel = panelId
  },
}

const services = { locale, slots, layout }

const ctx = {
  effect(factory) {
    const dispose = factory()
    effects.push(dispose)
    return dispose
  },
  inject() {},
  get(name) { return services[name] },
  locale,
  slots,
  layout,
}

plugin.apply(ctx)

const page = registered.find(item => item.name === 'main')
if (!page) {
  document.body.innerHTML = '<pre style="color:#c00">插件没有注册 main 页面</pre>'
  throw new Error('main slot missing')
}

window.__slots = registered
const root = document.getElementById('root')
ReactDOM.createRoot(root).render(React.createElement(page.Component))
window.__ready = true
