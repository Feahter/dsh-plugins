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

const mark = name => { try { performance.mark(name) } catch {} }
const measure = (name, start, end) => { try { performance.measure(name, start, end) } catch {} }

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

// 复刻宿主 require.async：按需加载 package-local chunk（文件名规则 client.<name>.js）。
const chunkCache = new Map()
require.async = async spec => {
  const fileName = spec.replace(/^\.\//, '')
  if (chunkCache.has(fileName)) return chunkCache.get(fileName)
  let registration = window.__ModuleLoader__.pending.find(item => item.chunk === fileName)
  if (!registration) {
    performance.mark('mc:chunk-start')
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = new URL(`../${fileName}`, location.href).href
      script.onload = resolve
      script.onerror = () => reject(new Error(`harness: chunk 加载失败 ${fileName}`))
      document.head.append(script)
    })
    performance.mark('mc:chunk-end')
    performance.measure('mc:chunk-load', 'mc:chunk-start', 'mc:chunk-end')
    registration = window.__ModuleLoader__.pending.find(item => item.chunk === fileName)
  }
  if (!registration) throw new Error(`harness: chunk ${fileName} 没有注册`)
  const exports = registration.factory(require)
  chunkCache.set(fileName, exports)
  return exports
}

mark('mc:factory-start')
const plugin = registration.factory(require)
mark('mc:factory-end')
measure('mc:materialize', 'mc:factory-start', 'mc:factory-end')
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

// 语音输入服务（realtime-voice 提供）：记录 attach/toggle，并允许测试直接驱动插入，
// 这样「文字落到哪个输入框的哪个位置」这段逻辑不用真开麦克风也能验。
const voiceLog = []
const voiceSurfaces = {}
const voiceInput = {
  version: '0.3.0-harness',
  attach(surface) {
    voiceLog.push({ type: 'attach', id: surface.id })
    voiceSurfaces[surface.id] = surface
    return {
      id: surface.id,
      start() { voiceLog.push({ type: 'start', id: surface.id }) },
      stop() { voiceLog.push({ type: 'stop', id: surface.id }) },
      toggle() {
        voiceLog.push({ type: 'toggle', id: surface.id })
        window.__voiceToggle = (window.__voiceToggle || 0) + 1
      },
      detach() {
        voiceLog.push({ type: 'detach', id: surface.id })
        delete voiceSurfaces[surface.id]
      },
    }
  },
}

window.__voice = {
  log: voiceLog,
  surface(id) { return voiceSurfaces[id] },
  insert(id, text, span) {
    const surface = voiceSurfaces[id]
    return surface ? surface.insertText(text, span) : false
  },
  capture(id) {
    const surface = voiceSurfaces[id]
    return surface ? surface.captureInsertion() : null
  },
}

const services = { locale, slots, layout, voiceInput }

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

mark('mc:apply-start')
plugin.apply(ctx)
mark('mc:apply-end')
measure('mc:apply', 'mc:apply-start', 'mc:apply-end')

const page = registered.find(item => item.name === 'main')
if (!page) {
  document.body.innerHTML = '<pre style="color:#c00">插件没有注册 main 页面</pre>'
  throw new Error('main slot missing')
}

window.__slots = registered
const root = document.getElementById('root')
mark('mc:panel-mount')
const mount = () => ReactDOM.createRoot(root).render(React.createElement(page.Component))
// ?manual=1：只跑到「插件注册完」就停，用来验证启动阶段不下载面板 chunk。
if (new URLSearchParams(location.search).has('manual')) {
  window.__mountPanel = mount
} else {
  mount()
}
mark('mc:panel-render-called')
window.__ready = true
