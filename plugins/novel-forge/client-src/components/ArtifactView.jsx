// 产物渲染：markdown 走 marked + DOMPurify；JSON 按 recipe 约定结构化。
// 结构化只做「读」，不改内容——改稿在章节视图里。
import React from 'react'
import { Icon, Markdown, formatNumber } from './bits.jsx'
import { SEVERITY_LABEL } from '../strings.js'

const asArray = value => (Array.isArray(value) ? value : [])

function FieldCard({ data, fields }) {
  return React.createElement('dl', { className: 'nf-flat-list' },
    fields.filter(field => data?.[field.key] !== undefined && data?.[field.key] !== null && data?.[field.key] !== '').map(field => {
      const value = data[field.key]
      return React.createElement('div', { className: 'nf-flat-row', key: field.key },
        React.createElement('span', { className: 'nf-flat-key' }, field.label),
        React.createElement('span', {
          className: `nf-flat-val${field.serif ? ' serif' : ''}`,
          style: field.serif ? { fontSize: 16, lineHeight: 1.9 } : undefined,
        },
        Array.isArray(value)
          ? React.createElement('span', { className: 'nf-keyline' }, value.map((item, index) =>
            React.createElement('span', { key: `${field.key}-${index}`, className: 'nf-badge' }, String(item))))
          : String(value)),
      )
    }),
  )
}

// ------------------------------------------------------------------ 故事核心 / 封面文案
// 字段名严格按 §4.4，但不同模型偶尔写同义词，这里只做展示层兜底。
const BRIEF_FIELDS = [
  { key: 'title', label: '书名', serif: true },
  { key: 'logline', label: '一句话', serif: true },
  { key: 'theme', label: '主题' },
  { key: 'promise', label: '类型承诺' },
  { key: 'ending', label: '结局方向' },
  { key: 'premise', label: '故事核', serif: true },
]

const BLURB_FIELDS = [
  { key: 'title', label: '书名', serif: true },
  { key: 'tagline', label: '一句话卖点', serif: true },
  { key: 'hook', label: '钩子', serif: true },
  { key: 'blurb', label: '简介', serif: true },
  { key: 'description', label: '简介', serif: true },
  { key: 'tags', label: '标签' },
  { key: 'genreTags', label: '标签' },
]

export function BriefView({ data }) {
  const tags = asArray(data?.genreTags ?? data?.tags)
  return React.createElement('div', null,
    data?.logline ? React.createElement('blockquote', { className: 'nf-quote' },
      data.logline,
      React.createElement('small', null, 'LOGLINE'),
    ) : null,
    React.createElement(FieldCard, {
      data,
      fields: (data?.blurb || data?.description ? BLURB_FIELDS : BRIEF_FIELDS),
    }),
    tags.length ? React.createElement('div', { className: 'nf-keyline' },
      tags.map((tag, index) => React.createElement('span', { key: index, className: 'nf-badge nf-badge-accent' }, String(tag)))) : null,
  )
}

// ------------------------------------------------------------------ 大纲
export function OutlineView({ data, onOpenChapter }) {
  const volumes = asArray(data?.volumes).length
    ? asArray(data.volumes)
    : [{ title: '全书', purpose: '', chapters: asArray(data?.chapters) }]

  const chapterRow = (chapter, index, volumeIndex) => {
    const chapterId = chapter?.id || `ch${String(index + 1).padStart(2, '0')}`
    return React.createElement('button', {
      key: chapterId,
      type: 'button',
      className: 'nf-chapter-row',
      onClick: () => onOpenChapter(chapterId, 'beats'),
      'data-chapter': chapterId,
    },
    React.createElement('span', { className: 'nf-chapter-id' }, chapterId),
    React.createElement('span', { className: 'nf-chapter-title' },
      chapter?.title || `第 ${index + 1} 章`,
      React.createElement('small', null, [chapter?.goal, chapter?.hook].filter(Boolean).join(' · ') || '（还没有目标与钩子）'),
    ),
    React.createElement('span', { className: 'nf-chapter-go' }, '细纲', React.createElement(Icon.chevron, { width: 12, height: 12 })),
    )
  }

  let offset = 0
  return React.createElement('div', null,
    volumes.map((volume, volumeIndex) => {
      const chapters = asArray(volume?.chapters)
      const rows = chapters.map((chapter, index) => chapterRow(chapter, offset + index, volumeIndex))
      offset += chapters.length
      return React.createElement('section', { className: 'nf-volume', key: volumeIndex },
        React.createElement('div', { className: 'nf-volume-head' },
          React.createElement('b', null, volume?.title || `第 ${volumeIndex + 1} 卷`),
          React.createElement('span', null, `${chapters.length} 章${volume?.purpose ? ` · ${volume.purpose}` : ''}`),
        ),
        rows,
      )
    }),
    React.createElement('p', { className: 'nf-muted', style: { marginTop: 18, fontSize: 11 } },
      `共 ${asArray(data?.volumes).length ? volumes.reduce((sum, volume) => sum + asArray(volume?.chapters).length, 0) : asArray(data?.chapters).length} 章。点任意一章进去看细纲、草稿与审校。`),
  )
}

// ------------------------------------------------------------------ 人物
export function CharactersView({ data }) {
  const cast = asArray(data?.cast)
  if (!cast.length) return React.createElement(Markdown, { text: data ? '```json\n' + JSON.stringify(data, null, 2) + '\n```' : '' })
  return React.createElement('div', { className: 'nf-cast' },
    cast.map((person, index) => React.createElement('article', { className: 'nf-person', key: person?.name || index },
      React.createElement('div', { className: 'nf-person-head' },
        React.createElement('b', null, person?.name || '无名'),
        React.createElement('span', null, person?.role || ''),
      ),
      React.createElement('dl', null,
        person?.want ? React.createElement(React.Fragment, null,
          React.createElement('dt', null, '想要'), React.createElement('dd', null, person.want)) : null,
        person?.fear ? React.createElement(React.Fragment, null,
          React.createElement('dt', null, '害怕'), React.createElement('dd', null, person.fear)) : null,
        person?.secret ? React.createElement(React.Fragment, null,
          React.createElement('dt', null, '秘密'), React.createElement('dd', null, person.secret)) : null,
        person?.voice ? React.createElement(React.Fragment, null,
          React.createElement('dt', null, '说话'), React.createElement('dd', null, person.voice)) : null,
        person?.arc ? React.createElement(React.Fragment, null,
          React.createElement('dt', null, '弧光'), React.createElement('dd', null, person.arc)) : null,
      ),
      asArray(person?.relations).length ? React.createElement('div', { className: 'nf-keyline', style: { marginTop: 10 } },
        asArray(person.relations).map((relation, relationIndex) => React.createElement('span', {
          key: relationIndex, className: 'nf-badge nf-badge-muted',
        }, `${relation?.to ?? '?'} · ${relation?.kind ?? '关系'}`))) : null,
    )),
  )
}

// ------------------------------------------------------------------ 审校
export function ReviewView({ data }) {
  const findings = asArray(data?.findings)
  const groups = ['block', 'warn', 'note'].map(severity => ({
    severity,
    items: findings.filter(finding => finding?.severity === severity),
  })).filter(group => group.items.length)

  const verdict = data?.verdict
  return React.createElement('div', null,
    verdict ? React.createElement('div', { className: 'nf-keyline', style: { marginBottom: 18 } },
      React.createElement('span', { className: `nf-badge ${verdict === 'pass' ? 'nf-badge-ok' : 'nf-badge-accent'}` },
        verdict === 'pass' ? '审校通过' : '建议修订'),
      React.createElement('span', { className: 'nf-muted', style: { fontSize: 11 } },
        `共 ${findings.length} 条 · 硬伤 ${findings.filter(item => item?.severity === 'block').length} 条`),
    ) : null,

    findings.length === 0
      ? React.createElement('p', { className: 'nf-muted' }, '这一章没有发现硬伤。')
      : React.createElement('div', { className: 'nf-findings' },
        groups.map(group => React.createElement('section', { className: `nf-finding-group ${group.severity}`, key: group.severity },
          React.createElement('header', null,
            React.createElement('span', null, SEVERITY_LABEL[group.severity] ?? group.severity),
            React.createElement('span', { style: { marginLeft: 'auto' } }, `${group.items.length} 条`),
          ),
          group.items.map((finding, index) => React.createElement('div', { className: 'nf-finding', key: index },
            React.createElement('span', { className: 'issue' },
              finding?.where ? React.createElement('span', { className: 'where' }, finding.where) : null,
              finding?.issue || '（未写明问题）'),
            finding?.fix ? React.createElement('span', { className: 'fix' }, finding.fix) : null,
            finding?.kind ? React.createElement('span', { className: 'nf-finding-kind', style: { display: 'block', marginTop: 4, fontSize: 10, color: 'var(--nf-ink-3)', letterSpacing: '.08em' } }, finding.kind) : null,
          )),
        )),
      ),
  )
}

// ------------------------------------------------------------------ 账本
export function LedgerView({ data }) {
  const facts = asArray(data?.facts)
  const threads = asArray(data?.threads)
  const timeline = asArray(data?.timeline)
  const characters = data?.characters && typeof data.characters === 'object' ? Object.entries(data.characters) : []
  const rules = asArray(data?.canonRules)

  const block = (title, list) => React.createElement('section', null,
    React.createElement('h4', null, title),
    React.createElement('ul', null, list),
  )

  return React.createElement('div', { className: 'nf-ledger' },
    facts.length ? block('事实', facts.map((fact, index) => React.createElement('li', { key: fact?.id || index },
      React.createElement('time', null, fact?.chapter || '—'),
      React.createElement('span', null, fact?.text || ''),
      fact?.status ? React.createElement('span', { className: 'nf-badge nf-badge-muted', style: { marginLeft: 'auto' } }, fact.status) : null,
    ))) : null,
    threads.length ? block('线索', threads.map((thread, index) => React.createElement('li', { key: thread?.id || index },
      React.createElement('time', null, thread?.opened || '—'),
      React.createElement('span', null, thread?.text || ''),
      React.createElement('span', { className: 'nf-badge nf-badge-muted', style: { marginLeft: 'auto' } },
        thread?.status === 'closed' ? `收于 ${thread?.closedIn ?? ''}` : (thread?.status || 'open')),
    ))) : null,
    timeline.length ? block('时间线', timeline.map((entry, index) => React.createElement('li', { key: index },
      React.createElement('time', null, entry?.chapter || '—'),
      React.createElement('span', null, [entry?.when, entry?.event].filter(Boolean).join(' · ')),
    ))) : null,
    characters.length ? block('人物状态', characters.map(([name, state]) => React.createElement('li', { key: name },
      React.createElement('span', { style: { flex: '0 0 64px' } }, name),
      React.createElement('span', null, [state?.location, state?.state, asArray(state?.knows).length ? `知道：${asArray(state.knows).join('、')}` : ''].filter(Boolean).join(' · ')),
    ))) : null,
    rules.length ? block('世界规则', rules.map((rule, index) => React.createElement('li', { key: index },
      React.createElement('span', null, typeof rule === 'string' ? rule : JSON.stringify(rule)),
    ))) : null,
    !facts.length && !threads.length && !timeline.length && !characters.length && !rules.length
      ? React.createElement('p', { className: 'nf-muted' }, '账本还是空的——写到大纲时会开始记账。')
      : null,
  )
}

// ------------------------------------------------------------------ 入口
const STRUCTURED = {
  brief: BriefView,
  blurb: BriefView,
  outline: OutlineView,
  characters: CharactersView,
  review: ReviewView,
  ledger: LedgerView,
}

/**
 * 按 artifact 类型选渲染器。
 * kind='md' 一律 markdown；kind='json' 若没有结构化组件则退回格式化 JSON。
 */
export function ArtifactView({ artifact, onOpenChapter }) {
  if (!artifact) return React.createElement('p', { className: 'nf-muted' }, '（还没有内容）')
  const { kind, content } = artifact
  if (kind === 'md' || typeof content === 'string') {
    return React.createElement(Markdown, { text: content })
  }
  const View = STRUCTURED[artifact.viewKey || artifact.key?.split('/')[0]]
  if (View) return React.createElement(View, { data: content, onOpenChapter })
  return React.createElement('pre', {
    style: {
      fontFamily: 'var(--nf-mono)', fontSize: 11, lineHeight: 1.7, whiteSpace: 'pre-wrap',
      background: 'var(--nf-card-2)', border: '1px solid var(--nf-line)', padding: '14px 16px',
    },
  }, JSON.stringify(content, null, 2))
}

// 供 Workbench 复用的数字格式化（避免它再 import 一次 bits）
export { formatNumber }
