// 书架：项目卡片、进度、继续/打开/删除，以及空态。
import React from 'react'
import { Badge, Button, Empty, Icon, ProgressBar, formatRelative, formatWords } from './bits.jsx'

/** 项目摘要可能来自 engine 的 summary，也可能是完整 project.json，这里都兜住。 */
export function normalizeProject(raw) {
  const params = raw?.params ?? {}
  const stats = raw?.stats ?? {}
  const draft = raw?.stages?.draft
  let drafted = Number(stats.drafted)
  if (!Number.isFinite(drafted)) {
    drafted = draft?.items ? Object.values(draft.items).filter(status => status === 'done').length : 0
  }
  const chapters = Number(stats.chapters) || Number(params.chapters) || 0
  return {
    id: raw?.id ?? '',
    title: raw?.title || params.title || '未命名',
    genre: params.genre || '通用',
    premise: params.premise || '',
    chapters,
    drafted,
    words: Number(stats.words) || 0,
    updatedAt: raw?.updatedAt,
    activeRunId: raw?.activeRunId ?? null,
    pendingReview: raw?.pendingReview ?? null,
    raw,
  }
}

function Card({ project, onOpen, onContinue, onDelete, confirming, onConfirm, onCancelConfirm, deleting }) {
  const done = project.drafted >= project.chapters && project.chapters > 0
  const started = project.drafted > 0 || Boolean(project.activeRunId)

  return React.createElement('article', { className: 'nf-card', 'data-project': project.id },
    React.createElement('div', { className: 'nf-card-top' },
      React.createElement(Badge, { tone: 'accent' }, project.genre),
      project.activeRunId ? React.createElement(Badge, { tone: 'muted' }, '运行中') : null,
      project.pendingReview ? React.createElement(Badge, { tone: 'warn' }, '待确认') : null,
      React.createElement('time', { dateTime: project.updatedAt }, formatRelative(project.updatedAt)),
    ),
    React.createElement('h3', { className: 'nf-card-title' }, project.title),
    React.createElement('p', { className: 'nf-premise' }, project.premise || '（还没有故事核心）'),

    React.createElement('div', { className: 'nf-card-progress' },
      React.createElement('div', { className: 'nf-card-nums' },
        React.createElement('span', null, `已写 ${project.drafted}/${project.chapters || '—'} 章`),
        React.createElement('span', null, formatWords(project.words)),
      ),
      React.createElement(ProgressBar, { value: project.drafted, total: project.chapters || 0 }),
    ),

    confirming
      ? React.createElement('div', { className: 'nf-card-actions' },
        React.createElement('span', { className: 'nf-muted' }, '删除后放进回收站，确定？'),
        React.createElement('span', { className: 'nf-grow' }),
        React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: onCancelConfirm, disabled: deleting }, '取消'),
        React.createElement(Button, { size: 'sm', variant: 'danger', onClick: onConfirm, busy: deleting }, '删除'),
      )
      : React.createElement('div', { className: 'nf-card-actions' },
        React.createElement(Button, { size: 'sm', variant: 'primary', onClick: onOpen }, done ? '打开' : started ? '继续' : '打开'),
        started && !done && !project.activeRunId
          ? React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: onContinue }, '续跑')
          : null,
        React.createElement('span', { className: 'nf-grow' }),
        React.createElement(Button, {
          size: 'sm', variant: 'quiet', onClick: onDelete, title: '删除这本书',
          'aria-label': `删除《${project.title}》`,
        }, React.createElement(Icon.trash, { width: 14, height: 14 }), '删除'),
      ),
  )
}

export function ProjectList({ projects, loading, error, onCreate, onOpen, onContinue, onDelete, onRetry }) {
  const [confirmId, setConfirmId] = React.useState(null)
  const [deleting, setDeleting] = React.useState(false)

  const deleteNow = async project => {
    setDeleting(true)
    try {
      await onDelete(project)
      setConfirmId(null)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return React.createElement('div', { className: 'nf-loading' },
      React.createElement('span', { className: 'nf-spinner' }), '正在翻开书架…')
  }

  return React.createElement('div', { className: 'nf-scroll' },
    React.createElement('div', { className: 'nf-shelf' },
      React.createElement('div', { className: 'nf-shelf-head' },
        React.createElement('div', null,
          React.createElement('h1', null, '书架'),
          React.createElement('p', null, '每一本都停在你上次离开的地方。'),
        ),
        React.createElement('div', { className: 'nf-grow' }),
        React.createElement(Button, { variant: 'primary', onClick: onCreate },
          React.createElement(Icon.plus, { width: 14, height: 14 }), '新建长篇'),
      ),
      React.createElement('div', { className: 'nf-hairline' }),

      error ? React.createElement('div', { className: 'nf-error' },
        `书架没打开：${error.message || error}`,
        React.createElement('div', { style: { marginTop: 8 } },
          React.createElement(Button, { size: 'sm', onClick: onRetry }, '重试')),
      ) : null,

      projects.length === 0 && !error
        ? React.createElement(Empty, {
          title: '还没有书。',
          body: '给我一句话，就能开炉。设定、人物、大纲、细纲、正文、审校，墨炉一章一章地炼。',
        },
        React.createElement('div', { className: 'nf-sample' },
          React.createElement('b', null, '一句示例'),
          '一个在殡仪馆值夜班的年轻人，发现死者会在头七那晚回来，而其中一个死者是他失踪多年的父亲。',
        ),
        React.createElement(Button, { variant: 'primary', onClick: onCreate }, '用一句话开始'),
        )
        : React.createElement('div', { className: 'nf-grid' },
          projects.map(raw => {
            const project = normalizeProject(raw)
            return React.createElement(Card, {
              key: project.id,
              project,
              onOpen: () => onOpen(project),
              onContinue: () => onContinue(project),
              onDelete: () => setConfirmId(project.id),
              onConfirm: () => deleteNow(project),
              onCancelConfirm: () => setConfirmId(null),
              confirming: confirmId === project.id,
              deleting,
            })
          }),
        ),
    ),
  )
}
