// 右运行抽屉：当前 item、进度、事件流、取消。
import React from 'react'
import { Badge, Button, Dot, Icon, ProgressBar, formatClock } from './bits.jsx'
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
      return { text: data.message ?? '', tone: '' }
    default:
      return { text: data.message || event?.type || '事件', tone: '' }
  }
}

export function RunDrawer({ run, events, onCancel, cancelling, error }) {
  const listRef = React.useRef(null)
  const status = run?.status ?? 'idle'
  const total = run?.progress?.total ?? 0
  const done = run?.progress?.done ?? 0
  const running = status === 'running'
  const current = run?.current

  React.useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [events.length])

  return React.createElement('aside', { className: 'nf-drawer', 'aria-label': '运行' },
    React.createElement('div', { className: 'nf-drawer-head' },
      React.createElement('b', null, '运行'),
      React.createElement('span', { className: 'nf-grow' }),
      React.createElement(Dot, { status: running ? 'running' : status === 'error' ? 'error' : status === 'done' ? 'done' : 'idle' }),
      React.createElement('span', { className: 'nf-muted', style: { fontSize: 10 } }, RUN_STATUS_LABEL[status] ?? status),
    ),

    React.createElement('div', { className: 'nf-drawer-body' },
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
          React.createElement('span', null, run?.seq ? `事件 ${run.seq}` : ''),
        ),
      ),

      React.createElement('div', { style: { fontSize: 10, letterSpacing: '.18em', color: 'var(--nf-ink-3)', marginTop: 4 } }, '事件流'),

      events.length
        ? React.createElement('ul', { className: 'nf-events', ref: listRef },
          events.map(event => {
            const described = describeEvent(event)
            return React.createElement('li', { key: event.seq ?? `${event.ts}-${Math.random()}`, className: `nf-event ${described.tone}` },
              React.createElement('time', null, formatClock(event.ts)),
              React.createElement('span', null, described.text),
            )
          }),
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
