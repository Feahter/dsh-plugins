// 假宿主：只实现 client 用到的 slot / locale / layout，把面板真的挂进 DOM。
// 由 dev/verify.mjs 用 esbuild 打成 harness.bundle.js，再在 page.html 里加载。
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'

const MODULES = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': ReactDOM,
  'react-dom/client': { createRoot },
}

const requireModule = id => {
  if (!MODULES[id]) throw new Error(`harness 没有 seed 模块：${id}`)
  return MODULES[id]
}

const registrations = []
const localeRegistrations = []
const disposers = []
const selection = []

const locale = {
  lang: 'zh',
  register(namespace, dicts) {
    localeRegistrations.push({ namespace, dicts })
  },
  getLocale() {
    return 'zh'
  },
  t(key) {
    const dict = localeRegistrations.at(-1)?.dicts?.zh ?? {}
    return dict[key] ?? key
  },
}

const slots = {
  inject(name, factory) {
    return factory()
  },
  register(registration, component) {
    registrations.push({ ...registration, component })
    return () => {
      const index = registrations.findIndex(item => item.id === registration.id && item.key === registration.key)
      if (index >= 0) registrations.splice(index, 1)
    }
  },
}

const layout = {
  selectPanel(panel) {
    selection.push(panel)
    window.__selectedPanel = panel
  },
}

const ctx = {
  locale,
  slots,
  layout,
  get(name) {
    return { locale, slots, layout }[name]
  },
  effect(factory) {
    const dispose = factory()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
}

const registration = window.__ModuleLoader__.pending.find(item => item.id === 'dsh-novel-forge')
if (!registration) throw new Error('client.js 没有注册 dsh-novel-forge')

const plugin = registration.factory(requireModule)
if (typeof plugin?.apply !== 'function') throw new Error('client.js 没有导出 apply(ctx)')
plugin.apply(ctx)

const main = registrations.find(item => item.name === 'main' && item.key === 'novel-forge')
if (!main) throw new Error('main slot 没有注册 novel-forge: ' + JSON.stringify(registrations.map(item => ({ name: item.name, key: item.key, id: item.id }))))

const root = createRoot(document.getElementById('root'))
root.render(React.createElement(main.component))

window.__ready = true
window.__slots = registrations.map(item => ({
  name: item.name,
  id: item.id,
  key: item.key,
  order: item.order,
  label: typeof item.label === 'function' ? item.label() : item.label,
}))
window.__locale = localeRegistrations.map(item => ({ namespace: item.namespace, langs: Object.keys(item.dicts) }))
window.__selectedPanel = null
window.__dispose = () => disposers.splice(0).forEach(dispose => dispose())
