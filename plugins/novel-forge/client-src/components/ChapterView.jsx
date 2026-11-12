// 章节页：细纲 / 草稿 / 审校 / 摘要，草稿可直接改并回写。
import React from 'react'
import { getArtifact, putArtifact } from '../api.js'
import {
  Button, Empty, Icon, Markdown, Spinner,
} from './bits.jsx'
import { ReviewView } from './ArtifactView.jsx'

const TABS = [
  { id: 'beats', label: '细纲' },
  { id: 'draft', label: '草稿' },
  { id: 'review', label: '审校' },
  { id: 'summary', label: '摘要' },
]

const KEY_OF = { beats: 'beats', draft: 'draft', review: 'review', summary: 'summary' }
const KIND_OF = { beats: 'json', draft: 'md', review: 'json', summary: 'md' }

function countChars(text) {
  return (text ?? '').replace(/\s/g, '').length
}

function BeatsView({ data }) {
  const scenes = Array.isArray(data?.scenes) ? data.scenes : []
  if (!scenes.length) return React.createElement(Empty, { title: '这一章还没有细纲' }, '继续炼到「章节细纲」阶段，会按章生成场景卡。')
  return React.createElement('div', { className: 'nf-cast', style: { gridTemplateColumns: '1fr' } },
    scenes.map((scene, index) => React.createElement('article', { className: 'nf-person', key: scene?.no ?? index },
      React.createElement('div', { className: 'nf-person-head' },
        React.createElement('b', null, `场景 ${scene?.no ?? index + 1}`),
        React.createElement('span', null, [scene?.where, scene?.when].filter(Boolean).join(' · ')),
      ),
      Array.isArray(scene?.cast) && scene.cast.length
        ? React.createElement('div', { className: 'nf-keyline', style: { marginBottom: 10 } },
          scene.cast.map((name, castIndex) => React.createElement('span', { className: 'nf-badge nf-badge-muted', key: castIndex }, String(name))))
        : null,
      React.createElement('dl', null,
        scene?.goal ? React.createElement(React.Fragment, null, React.createElement('dt', null, '目标'), React.createElement('dd', null, scene.goal)) : null,
        scene?.obstacle ? React.createElement(React.Fragment, null, React.createElement('dt', null, '阻碍'), React.createElement('dd', null, scene.obstacle)) : null,
        scene?.turn ? React.createElement(React.Fragment, null, React.createElement('dt', null, '转折'), React.createElement('dd', null, scene.turn)) : null,
        scene?.exit ? React.createElement(React.Fragment, null, React.createElement('dt', null, '出点'), React.createElement('dd', null, scene.exit)) : null,
        scene?.sensory ? React.createElement(React.Fragment, null, React.createElement('dt', null, '感官'), React.createElement('dd', null, scene.sensory)) : null,
      ),
    )),
  )
}

export function ChapterView({ projectId, project, chapterId, initialTab = 'beats', outline, notify, onBack, registerFlush }) {
  const [tab, setTab] = React.useState(initialTab)
  const [loaded, setLoaded] = React.useState({})
  const [loading, setLoading] = React.useState(true)
  const [draft, setDraft] = React.useState('')
  const [original, setOriginal] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const meta = React.useMemo(() => {
    const volumes = Array.isArray(outline?.volumes) && outline.volumes.length
      ? outline.volumes
      : [{ chapters: Array.isArray(outline?.chapters) ? outline.chapters : [] }]
    for (const volume of volumes) {
      for (const chapter of volume?.chapters ?? []) {
        if (chapter?.id === chapterId) return chapter
      }
    }
    return null
  }, [outline, chapterId])

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    const requests = TABS.map(item => {
      const key = `${KEY_OF[item.id]}/${chapterId}`
      return getArtifact(projectId, key)
        .then(payload => [item.id, payload?.content ?? null])
        .catch(() => [item.id, null])
    })
    Promise.all(requests).then(entries => {
      if (!alive) return
      const next = Object.fromEntries(entries)
      setLoaded(next)
      const text = typeof next.draft === 'string' ? next.draft : ''
      setDraft(text)
      setOriginal(text)
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [projectId, chapterId])

  React.useEffect(() => { setTab(initialTab) }, [initialTab, chapterId])

  const dirty = draft !== original

  // 离开章节页前由工作台调用：把最新草稿写回，避免未保存内容静默丢失。
  // 用 ref 保存最新编辑态，注册一次即可，不用因每次输入重注册。
  const flushStateRef = React.useRef(null)
  flushStateRef.current = { draft, original, chapterId }

  React.useEffect(() => {
    if (!registerFlush) return undefined
    const flush = async () => {
      const state = flushStateRef.current
      if (!state || state.draft === state.original) return false
      await putArtifact(projectId, { key: `draft/${state.chapterId}`, kind: 'md', content: state.draft })
      setOriginal(state.draft)
      setLoaded(previous => ({ ...previous, draft: state.draft }))
      return true
    }
    return registerFlush(flush)
  }, [registerFlush, projectId])

  const save = async () => {
    setSaving(true)
    try {
      await putArtifact(projectId, { key: `draft/${chapterId}`, kind: 'md', content: draft })
      setOriginal(draft)
      setLoaded(previous => ({ ...previous, draft }))
      setEditing(false)
      notify('草稿已保存', 'ok')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const tabBody = () => {
    if (loading) return React.createElement('div', { className: 'nf-loading' }, React.createElement(Spinner), '取这一章…')
    if (tab === 'beats') {
      return loaded.beats
        ? React.createElement(BeatsView, { data: loaded.beats })
        : React.createElement(Empty, { title: '还没有细纲' }, '继续炼到「章节细纲」，会按章生成场景卡。')
    }
    if (tab === 'review') {
      return loaded.review
        ? React.createElement(ReviewView, { data: loaded.review })
        : React.createElement(Empty, { title: '还没有审校结果' }, '草稿写完后，连续性审校会逐章给意见。')
    }
    if (tab === 'summary') {
      return loaded.summary
        ? React.createElement('div', { className: 'nf-prose' }, React.createElement(Markdown, { text: loaded.summary }))
        : React.createElement(Empty, { title: '还没有摘要' }, '写完草稿会同步生成摘要，供后面几章接着写。')
    }
    // 草稿
    if (!loaded.draft && !draft) {
      return React.createElement(Empty, { title: '这一章还没写' }, '继续炼到「章节草稿」阶段，会一章一章写出来。')
    }
    return React.createElement('div', null,
      React.createElement('div', { className: 'nf-editor-bar' },
        React.createElement('span', { className: 'nf-muted', style: { fontSize: 11 } },
          `${countChars(draft)} 字${dirty ? ' · 有未保存修改' : ''}`),
        React.createElement('span', { className: 'nf-grow' }),
        editing
          ? React.createElement(React.Fragment, null,
            React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => { setDraft(original); setEditing(false) } }, '放弃'),
            React.createElement(Button, { size: 'sm', variant: 'primary', onClick: save, busy: saving, disabled: !dirty }, '保存'),
          )
          : React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => setEditing(true) }, Icon.pen, '编辑'),
      ),
      editing
        ? React.createElement('textarea', {
          className: 'nf-editor',
          value: draft,
          spellCheck: false,
          onChange: event => setDraft(event.target.value),
        })
        : React.createElement('div', { className: 'nf-prose is-reading' }, React.createElement(Markdown, { text: draft })),
    )
  }

  return React.createElement('div', { className: 'nf-chapter' },
    React.createElement('div', { className: 'nf-chapter-head' },
      React.createElement('button', { type: 'button', className: 'nf-btn nf-btn-quiet nf-btn-sm', onClick: onBack },
        Icon.back, '工作台'),
      React.createElement('span', { className: 'nf-muted', style: { fontSize: 11 } }, chapterId),
      React.createElement('h2', null, meta?.title || `第 ${chapterId.replace(/^ch0?/, '')} 章`),
      React.createElement('div', { className: 'nf-main-sub' },
        meta?.where ? React.createElement('span', null, meta.where) : null,
        meta?.when ? React.createElement('span', null, meta.when) : null,
        meta?.pov ? React.createElement('span', null, meta.pov) : null,
        Array.isArray(meta?.cast) && meta.cast.length
          ? React.createElement('span', null, `出场：${meta.cast.join('、')}`)
          : null,
      ),
    ),

    React.createElement('div', { className: 'nf-tabs', role: 'tablist' },
      TABS.map(item => React.createElement('button', {
        key: item.id,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === item.id,
        className: `nf-tab${tab === item.id ? ' is-active' : ''}`,
        onClick: () => setTab(item.id),
      }, item.label)),
    ),

    tabBody(),
  )
}
