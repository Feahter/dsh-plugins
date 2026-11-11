// 浏览器侧 loader 桩：收集 client.js 的注册，交给 harness 执行 factory。
window.__ModuleLoader__ = {
  pending: [],
  load(registration) {
    this.pending.push(registration)
  },
  create() {
    throw new Error('harness 不支持 __ModuleLoader__.create')
  },
}
