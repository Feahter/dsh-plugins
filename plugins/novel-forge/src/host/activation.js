// novel_* 工具的按会话开关：默认不注册进模型提示，只记一份内存白名单。
//
// 条件注册的 when 每次模型步都会调 observe(agent)，所以这里只做内存读写：
// 不碰文件、不发起网络请求。进程重启 = 全部回到闲置状态。

export function createActivation() {
  const active = new Set()
  let latest = null

  function normalize(sessionId) {
    return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null
  }

  function observe(agent) {
    const id = normalize(agent?.id)
    if (id) latest = id
  }

  function enable(sessionId) {
    const id = normalize(sessionId)
    if (!id) return { ok: false, code: 'NO_SESSION' }
    active.add(id)
    return { ok: true, sessionId: id }
  }

  /** 不给 id 就是清空全部：面板上的「全部关掉」。 */
  function disable(sessionId) {
    const id = normalize(sessionId)
    if (!id) {
      active.clear()
      return { ok: true, cleared: true }
    }
    active.delete(id)
    return { ok: true, sessionId: id }
  }

  function isActive(agent) {
    const id = normalize(agent?.id)
    return id ? active.has(id) : false
  }

  function enableLatest() {
    if (!latest) return { ok: false, code: 'NO_SESSION' }
    active.add(latest)
    return { ok: true, sessionId: latest }
  }

  function state() {
    return { active: [...active], latest }
  }

  return { observe, enable, disable, isActive, enableLatest, state }
}
