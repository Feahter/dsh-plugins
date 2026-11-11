/**
 * 运行事件类型常量与轻量广播器。
 * 宿主、引擎、客户端共用这里的字符串。
 */

export const EVENT = Object.freeze({
  RUN_START: 'run-start',
  RUN_END: 'run-end',
  RUN_ERROR: 'run-error',
  RUN_PAUSED: 'run-paused',
  STAGE_START: 'stage-start',
  STAGE_END: 'stage-end',
  ITEM_START: 'item-start',
  ITEM_DONE: 'item-done',
  ITEM_ERROR: 'item-error',
  ARTIFACT: 'artifact',
  LLM: 'llm',
  LOG: 'log',
  PROGRESS: 'progress',
})

export const EVENT_TYPES = Object.freeze(Object.values(EVENT))

/** 简单订阅器：引擎把事件同步推给宿主，不持久化。 */
export class EventBus {
  constructor() {
    /** @type {Set<(event: {seq: number, ts: string, type: string, data: object}) => void>} */
    this.listeners = new Set()
  }

  /**
   * @param {(event: {seq: number, ts: string, type: string, data: object}) => void} fn
   * @returns {() => void} 取消订阅
   */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('监听器必须是函数')
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(event) {
    for (const fn of [...this.listeners]) {
      try {
        fn(event)
      } catch {
        // 订阅方异常不能影响运行
      }
    }
  }

  clear() {
    this.listeners.clear()
  }
}

export function createEventBus() {
  return new EventBus()
}
