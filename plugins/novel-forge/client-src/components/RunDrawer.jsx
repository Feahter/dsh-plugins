// 右运行抽屉：当前 item、进度、事件流、取消。
import React from 'react'
import { Badge, Button, Dot, Icon, ProgressBar, formatClock, formatTokens } from './bits.jsx'
import { RUN_STATUS_LABEL, STAGE_BY_ID } from '../strings.js'

const stageTitle = stageId => STAGE_BY_ID[stageId]?.title ?? stageId ?? ''

const chapterLabel = item => {
  const match = /^ch(\d+)$/.exec(String(item || ''))
  if (!match) return item || ''
  return `第 ${Number(match[1])} 章`
}

/** 把一条事件翻译成人话；未知类型原样显示，不吞信息。 */
export function describeEvent(event) {
  const data = event?.data ?? {}
  switch (event?.type) {
    case 'run-start':
      return { text: `开炉 · ${(data.stages ?? []).length} 个阶段${data.autoApprove ? '' : ' · 审稿门已开'}`, tone: 'is-strong' }
    case 'run-end':
      return { text: `收炉 · ${data.status === 'done' ? '全部完成' : data.status ?? ''}`, tone: 'is-strong' }
    case 'run-error':
      return { text: `中断：${data.message ?? '未知错误'}`, tone: 'is-accent' }
    case 'run-paused':
      return { text: `停在「${stageTitle(data.stage)}」，等你确认`, tone: 'is-accent' }
    case 'stage-start':
      return { text: `进入「${stageTitle(data.stage)}」${data.total ? ` · ${data.total} 项` : ''}`, tone: 'is-strong' }
    case 'stage-end':
      return { text: `「${stageTitle(data.stage)}」${data.status === 'skipped' ? '已跳过' : '完成'}`, tone: '' }
    case 'item-start':
      return { text: `开始 ${chapterLabel(data.item)}${data.index != null && data.total ? `（${data.index + 1}/${data.total}）` : ''}`, tone: '' }
    case 'item-done':
      return { text: `${chapterLabel(data.item)} 完成`, tone: '' }
    case 'item-error':
      return { text: `${chapterLabel(data.item)} 失败：${data.message ?? ''}`, tone: 'is-accent' }
    case 'artifact':
      return { text: `写入 ${data.key}${data.bytes ? ` · ${data.bytes} 字节` : ''}`, tone: '' }
    case 'llm':
      return { text: `模型返回 ${data.chars ?? '?'} 字${data.phase ? ` · ${data.phase}` : ''}`, tone: '' }
    case 'progress':
      return { text: `进度 ${data.done ?? 0}/${data.total ?? 0}`, tone: '' }
    case 'log':
      // 发动机的 warn 级日志（缺性别、产物丢失自愈等）用琥珀色，别混在信息流里。
      return { text: data.message ?? '', tone: data.level === 'warn' ? 'is-warn' : '' }
    default:
      return { text: data.message || event?.type || '事件', tone: '' }
  }
}

/**
 * 单条事件。memo + 按 event 记忆描述结果：轮询追加新事件时，
 * 旧行拿到同一个 event 引用就不再重算、也不再重建 DOM。
 * 注意不要吃 index：事件被 EVENT_LIMIT 截断后 index 会整体位移，
 * 那样 memo 会全部失效。key 的兜底在父层算。
 */
const EventRow = React.memo(function EventRow({ event }) {
  const described = React.useMemo(() => describeEvent(event), [event])
  return React.createElement('li', { className: `nf-event ${described.tone}` },
    React.createElement('time', null, formatClock(event.ts)),
    React.createElement('span', null, described.text),
  )
})

/** 距底 24px 内算「在底部」，跟随新事件。 */
const AT_BOTTOM_SLACK = 24

const isAtBottom = node => node.scrollHeight - node.scrollTop - node.clientHeight < AT_BOTTOM_SLACK

export function RunDrawer({ run, events, onCancel, cancelling, error }) {
  const bodyRef = React.useRef(null)
  // 滚动容器是 .nf-drawer-body；ul 本身不滚，钉底必须作用在它身上。
  const followRef = React.useRef(true)
  const lastLengthRef = React.useRef(0)
  const lastSeqRef = React.useRef(-1)
  const [pending, setPending] = React.useState(0)
  const status = run?.status ?? 'idle'
  const total = run?.progress?.total ?? 0
  const done = run?.progress?.done ?? 0
  const running = status === 'running'
  const current = run?.current

  const onScroll = React.useCallback(() => {
    const node = bodyRef.current
    if (!node) return
    const atBottom = isAtBottom(node)
    followRef.current = atBottom
    if (atBottom) setPending(value => (value ? 0 : value))
  }, [])

  const scrollToLatest = React.useCallback(() => {
    const node = bodyRef.current
    followRef.current = true
    setPending(0)
    if (node) node.scrollTop = node.scrollHeight
  }, [])

  // 依赖 events 引用：mergeEvents 没有新事件时返回原数组，本 effect 不会空跑。
  React.useEffect(() => {
    const node = bodyRef.current
    const length = events.length
    const previousLength = lastLengthRef.current
    lastLengthRef.current = length
    if (!node) return

    // 列表从空变非空（开炉 / 收尾补全量）时重新跟随。
    if (previousLength === 0 && length > 0) {
      followRef.current = true
      setPending(0)
    }

    const previousSeq = lastSeqRef.current
    lastSeqRef.current = length ? (events[length - 1].seq ?? length) : -1

    if (followRef.current) {
      node.scrollTop = node.scrollHeight
      setPending(0)
      return
    }
    if (!length) {
      followRef.current = true
      setPending(0)
      return
    }
    // 事件到 EVENT_LIMIT 后长度不再增长，只能按 seq 数新增。
    const added = previousSeq < 0
      ? length
      : events.reduce((count, event) => ((event.seq ?? 0) > previousSeq ? count + 1 : count), 0)
    if (added > 0) setPending(value => value + added)
  }, [events])

  return React.createElement('aside', { className: 'nf-drawer', 'aria-label': '运行' },
    React.createElement('div', { className: 'nf-drawer-head' },
      React.createElement('b', null, '运行'),
      React.createElement('span', { className: 'nf-grow' }),
      React.createElement(Dot, { status: running ? 'running' : status === 'error' ? 'error' : status === 'done' ? 'done' : 'idle' }),
      React.createElement('span', { className: 'nf-muted', style: { fontSize: 10 } }, RUN_STATUS_LABEL[status] ?? status),
    ),

    React.createElement('div', { className: 'nf-drawer-body', ref: bodyRef, onScroll },
      pending > 0
        ? React.createElement('button', {
          type: 'button', className: 'nf-new-events', onClick: scrollToLatest,
        }, `${pending} 条新事件 ↓`)
        : null,
      error ? React.createElement('div', { className: 'nf-error' }, error) : null,

      React.createElement('div', { className: 'nf-run-card' },
        React.createElement('div', { className: 'nf-run-top' },
          React.createElement(Badge, { tone: running ? 'accent' : 'muted' }, RUN_STATUS_LABEL[status] ?? status),
          React.createElement('span', { className: 'nf-grow' }),
          run?.startedAt ? React.createElement('span', { className: 'nf-muted', style: { fontSize: 9.5 } }, formatClock(run.startedAt)) : null,
        ),
        React.createElement('div', { className: 'nf-run-current' },
          current?.label || (current?.stage ? `${stageTitle(current.stage)}${current.item ? ` · ${chapterLabel(current.item)}` : ''}` : running ? '正在准备…' : '暂无进行中的任务'),
        ),
        React.createElement(ProgressBar, { value: done, total: total || 1, tone: 'accent' }),
        React.createElement('div', { className: 'nf-run-nums' },
          React.createElement('span', null, `${done} / ${total || '—'}`),
          React.createElement('span', null, run?.stats?.calls
            ? `调用 ${run.stats.calls} 次 · ${formatTokens(run.stats.estTokensIn)} 进 / ${formatTokens(run.stats.estTokensOut)} 出${run.stats.retried ? ` · 重试 ${run.stats.retried}` : ''}`
            : ''),
          React.createElement('span', null, run?.seq ? `事件 ${run.seq}` : ''),
        ),
      ),

      React.createElement('div', { style: { fontSize: 10, letterSpacing: '.18em', color: 'var(--nf-ink-3)', marginTop: 4 } }, '事件流'),

      events.length
        ? React.createElement('ul', { className: 'nf-events' },
          events.map((event, index) => React.createElement(EventRow, {
            key: event.seq ?? index,
            event,
          })),
        )
        : React.createElement('p', { className: 'nf-run-empty' }, running ? '等第一条事件…' : '还没有运行记录。点「继续炼」开始。'),
    ),

    React.createElement('div', { className: 'nf-drawer-foot' },
      React.createElement(Button, {
        size: 'sm', variant: 'danger', onClick: onCancel, disabled: !running, busy: cancelling,
      }, React.createElement(Icon.stop, { width: 13, height: 13 }), '取消运行'),
    ),
  )
}
