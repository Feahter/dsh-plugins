// 阶段轨：按 STAGES 渲染的流水线（状态点 + 进度），末尾单独挂「正典」入口。
import React from 'react'
import { Dot } from './bits.jsx'
import { STAGES, STATUS_LABEL } from '../strings.js'

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

/** 每个阶段的计数：静态段 1 步，each 段按章数算。 */
export function stageCounts(project, stage) {
  const entry = project?.stages?.[stage.id]
  const items = entry?.items ?? {}
  const done = Object.values(items).filter(status => status === 'done').length
  const total = stage.each
    ? Math.max(Object.keys(items).length, Number(project?.params?.chapters) || 0)
    : (entry ? 1 : 0)
  if (!stage.each) {
    const isDone = entry?.status === 'done'
    return { done: isDone ? 1 : 0, total: 1 }
  }
  return { done, total }
}

/** 从阶段表算整本书的完成度（0–1），总览和顶部共用。 */
export function overallProgress(project) {
  let done = 0
  let total = 0
  for (const stage of STAGES) {
    const counts = stageCounts(project, stage)
    done += counts.done
    total += counts.total
  }
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 }
}

export function StageRail({ project, selected, onSelect, onOverview, hasCanon = false, hasLedger = false, onCanon }) {
  // 段数直接跟 STAGES 走，避免文案和阶段表再次漂移。
  const countLabel = CN_NUM[STAGES.length] ?? String(STAGES.length)
  return React.createElement('nav', { className: 'nf-rail', 'aria-label': '创作阶段' },
    React.createElement('button', {
      type: 'button',
      className: `nf-rail-overview${selected === 'overview' ? ' is-active' : ''}`,
      onClick: onOverview,
    }, '总览'),
    React.createElement('div', { className: 'nf-rail-head' },
      React.createElement('b', null, '流水线'),
      React.createElement('span', null, `${countLabel}步 · 一章一章`),
    ),
    STAGES.map((stage, index) => {
      const entry = project?.stages?.[stage.id]
      const status = entry?.status ?? 'idle'
      const counts = stageCounts(project, stage)
      const active = selected === stage.id
      return React.createElement('button', {
        key: stage.id,
        type: 'button',
        className: `nf-rail-item${active ? ' is-active' : ''}`,
        onClick: () => onSelect(stage.id),
        'aria-current': active ? 'step' : undefined,
        title: `${stage.title} · ${STATUS_LABEL[status] ?? status}`,
      },
      React.createElement(Dot, { status }),
      React.createElement('span', { className: 'nf-rail-title' },
        React.createElement('span', null, `${String(index + 1).padStart(2, '0')} ${stage.title}`),
        React.createElement('small', null, STATUS_LABEL[status] ?? status),
      ),
      stage.each
        ? React.createElement('span', { className: 'nf-rail-count' }, `${counts.done}/${counts.total || '—'}`)
        : status === 'done'
          ? React.createElement('span', { className: 'nf-rail-count' }, '✓')
          : null,
      )
    }),
    // 正典不是 stage（STAGES 永远是 9 段），只是连续性底稿的独立入口。
    React.createElement('div', { className: 'nf-rail-sep', role: 'presentation' }),
    React.createElement('button', {
      type: 'button',
      className: `nf-rail-item nf-rail-canon${selected === 'canon' ? ' is-active' : ''}`,
      onClick: onCanon,
      'aria-current': selected === 'canon' ? 'page' : undefined,
      title: hasCanon ? '正典 · 连续性' : hasLedger ? 'v1 项目没有 canon（用账本）' : '正典还没建',
    },
    React.createElement(Dot, { status: hasCanon ? 'done' : 'idle' }),
    React.createElement('span', { className: 'nf-rail-title' },
      React.createElement('span', null, '正典 · 连续性'),
      React.createElement('small', null, hasCanon ? '事实 · 线索 · 人物' : hasLedger ? 'v1 用账本' : '尚未建立'),
    ),
    hasCanon ? React.createElement('span', { className: 'nf-rail-count' }, 'v2') : null,
    ),
  )
}
