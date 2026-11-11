// 复刻宿主模块装载器的最小子集：只收注册，不执行。
window.__ModuleLoader__ = {
  pending: [],
  load(registration) { this.pending.push(registration) },
  create() { throw new Error('harness: create() 未实现') },
}
