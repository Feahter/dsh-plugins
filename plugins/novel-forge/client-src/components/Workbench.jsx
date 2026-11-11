// 工作台：左阶段轨 / 中产物 / 右运行抽屉，外加审稿门与章节页。
import React from 'react'
import {
  getProject, getArtifact, getRun, startRun, cancelRun, continueReview, exportProject,
} from '../api.js'
import { STAGES, STAGE_BY_ID, STATUS_LABEL, STAGE_ARTIFACT } from '../strings.js'
import {
  Badge, Button, Dot, Empty, Icon, ProgressBar, Spinner, formatNumber, formatWords,
} from './bits.jsx'
import { StageRail, overallProgress } from './StageRail.jsx'
import { ArtifactView } from './ArtifactView.jsx'
import { RunDrawer } from './RunDrawer.jsx'
import { ChapterView } from './ChapterView.jsx'

const EVENT_LIMIT = 400

/** 合并增量事件：按 seq 去重，旧事件不丢。 */
function mergeEvents(prev, incoming) {
  if (!incoming?.length) return prev
  const seen = new Set(prev.map(event => event.seq))
  const next = prev.slice()
  for (const event of incoming) if (!seen.has(event.seq)) next.push(event)
  next.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  return next.slice(-EVENT_LIMIT)
}

/** 续跑起点：审稿门优先，否则第一个没完成的阶段。 */
export function resumeStage(project) {
  const gate = project?.pendingReview?.nextStages?.[0]
  if (gate) return gate
  const pending = STAGES.find(stage => (project?.stages?.[stage.id]?.status ?? 'idle') !== 'done')
  return pending?.id ?? 'premise'
}

function chapterMeta(outline) {
  const list = []
  const volumes = Array.isArray(outline?.volumes) && outline.volumes.length
    ? outline.volumes
    : [{ title: '全书', chapters: Array.isArray(outline?.chapters) ? outline.chapters : [] }]
  for (const volume of volumes) {
    for (const chapter of volume?.chapters ?? []) {
      list.push({ ...chapter, volume: volume?.title })
    }
  }
  return list
}

// ------------------------------------------------------------------ 总览
function Overview({ project, brief, outline, onContinue, onOpenChapter, busy }) {
  const params = project?.params ?? {}
  const chapters = chapterMeta(outline)
  const total = params.chapters ?? chapters.length ?? 0
  const drafted = project?.stats?.drafted ?? 0
  const words = project?.stats?.words ?? 0
  const progress = overallProgress(project)

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'nf-main-head' },
      React.createElement('div', null,
        React.createElement('h2', { className: 'nf-main-title' }, project?.title || brief?.title || '未命名'),
        React.createElement('div', { className: 'nf-main-sub' },
          React.createElement('span', { className: 'nf-badge' }, params.genre || '通用'),
          React.createElement('span', null, `${params.pov || '第三人称限知'} · ${params.wordsPerChapter || 3000} 字/章`),
          project?.pendingReview ? React.createElement('span', { className: 'nf-badge nf-badge-accent' }, '待确认') : null,
        ),
      ),
      React.createElement(Button, { variant: 'accent', onClick: onContinue, busy }, Icon.play, '继续炼'),
    ),

    brief?.logline ? React.createElement('blockquote', { className: 'nf-quote' },
      brief.logline, React.createElement('small', null, 'LOGLINE')) : null,

    React.createElement('div', { className: 'nf-stats' },
      React.createElement('div', { className: 'nf-stat' },
        React.createElement('span', null, '全书进度'),
        React.createElement('b', null, `${progress.percent}%`),
        React.createElement(ProgressBar, { value: progress.percent, total: 100 }),
      ),
      React.createElement('div', { className: 'nf-stat' },
        React.createElement('span', null, '已写章节'),
        React.createElement('b', null, `${drafted}`, React.createElement('small', null, ` / ${total} 章`)),
      ),
      React.createElement('div', { className: 'nf-stat' },
        React.createElement('span', null, '正文'),
        React.createElement('b', null, formatWords(words)),
      ),
      React.createElement('div', { className: 'nf-stat' },
        React.createElement('span', null, '模型调用'),
        React.createElement('b', null, formatNumber(project?.stats?.calls ?? 0), React.createElement('small', null, ' 次')),
      ),
    ),

    (brief?.theme || brief?.promise || brief?.ending) ? React.createElement('section', { className: 'nf-section' },
      React.createElement('div', { className: 'nf-section-title' }, '故事核心'),
      React.createElement('dl', { className: 'nf-flat-list' },
        brief.theme ? React.createElement('div', { className: 'nf-flat-row', key: 'theme' },
          React.createElement('span', { className: 'nf-flat-key' }, '主题'),
          React.createElement('span', { className: 'nf-flat-val' }, brief.theme)) : null,
        brief.promise ? React.createElement('div', { className: 'nf-flat-row', key: 'promise' },
          React.createElement('span', { className: 'nf-flat-key' }, '类型承诺'),
          React.createElement('span', { className: 'nf-flat-val' }, brief.promise)) : null,
        brief.ending ? React.createElement('div', { className: 'nf-flat-row', key: 'ending' },
          React.createElement('span', { className: 'nf-flat-key' }, '结局方向'),
          React.createElement('span', { className: 'nf-flat-val' }, brief.ending)) : null,
      ),
    ) : null,

    React.createElement('section', { className: 'nf-section' },
      React.createElement('div', { className: 'nf-section-title' },
        '章节',
        React.createElement('span', { className: 'nf-muted', style: { letterSpacing: 0, fontSize: 11 } },
          chapters.length ? `共 ${chapters.length} 章` : '大纲出来后在这里列章'),
      ),
      chapters.length
        ? React.createElement('div', { className: 'nf-chapter-list' },
          chapters.map((chapter, index) => {
            const id = chapter.id || `ch${String(index + 1).padStart(2, '0')}`
            const draft = project?.stages?.draft?.items?.[id]
            return React.createElement('button', {
              type: 'button', className: 'nf-chapter-row', key: id, onClick: () => onOpenChapter(id, 'beats'),
            },
              React.createElement('span', { className: 'nf-chapter-id' }, id),
              React.createElement('span', { className: 'nf-chapter-title' }, chapter.title || `第 ${index + 1} 章`),
              React.createElement('span', { className: `nf-badge ${draft === 'done' ? 'nf-badge-ok' : 'nf-badge-muted'}` },
                draft === 'done' ? '已写' : (STATUS_LABEL[draft] ?? '未写')),
            )
          }))
        : React.createElement('p', { className: 'nf-muted' }, '还没有大纲。点「继续炼」，先炼故事核与大纲。'),
    ),
  )
}

// ------------------------------------------------------------------ 单阶段
function ChapterStageList({ project, outline, stage, onOpen }) {
  const chapters = chapterMeta(outline)
  if (!chapters.length) {
    return React.createElement(Empty, { title: '还没有章节' }, '大纲完成后，这一阶段会按章逐个推进。')
  }
  const items = project?.stages?.[stage.id]?.items ?? {}
  return React.createElement('div', { className: 'nf-chapter-list' },
    chapters.map((chapter, index) => {
      const id = chapter.id || `ch${String(index + 1).padStart(2, '0')}`
      const status = items[id] ?? 'pending'
      const tab = stage.id === 'review' ? 'review' : stage.id === 'beats' ? 'beats' : 'draft'
      return React.createElement('button', {
        key: id, type: 'button', className: 'nf-chapter-row', onClick: () => onOpen(id, tab),
      },
      React.createElement('span', { className: 'nf-chapter-id' }, id),
      React.createElement('span', { className: 'nf-chapter-title' },
        chapter.title || `第 ${index + 1} 章`,
        React.createElement('small', null, [chapter.goal, chapter.hook].filter(Boolean).join(' · ')),
      ),
      React.createElement('span', { className: 'nf-chapter-tail' },
        React.createElement('span', { className: 'nf-badge nf-badge-muted' }, STATUS_LABEL[status] ?? status),
        React.createElement(Icon.chevron, { width: 12, height: 12 }),
      ),
      )
    }),
  )
}

function StagePane({ project, outline, selected, onOpenChapter, artifact, loading, error, onRetry }) {
  const stage = STAGE_BY_ID[selected]
  const status = project?.stages?.[selected]?.status ?? 'idle'

  const head = React.createElement('div', { className: 'nf-main-head' },
    React.createElement('div', null,
      React.createElement('h2', { className: 'nf-main-title' },
        stage ? `${STAGES.findIndex(item => item.id === selected) + 1}. ${stage.title}` : selected),
      React.createElement('div', { className: 'nf-main-sub' },
        React.createElement(Dot, { status }),
        React.createElement('span', null, STATUS_LABEL[status] ?? status),
        stage?.note ? React.createElement('span', null, stage.note) : null,
      ),
    ),
  )

  let body
  if (stage?.each) {
    body = React.createElement(ChapterStageList, { project, outline, stage, onOpen: onOpenChapter })
  } else if (loading) {
    body = React.createElement('div', { className: 'nf-loading' }, React.createElement(Spinner), '取产物中…')
  } else if (error) {
    body = React.createElement('div', { className: 'nf-error' },
      error,
      React.createElement('div', { style: { marginTop: 10 } },
        React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: onRetry }, '重试')))
  } else if (!artifact) {
    body = React.createElement(Empty, { title: '这一阶段还没产出' },
      '点「继续炼」或「重跑本步」，让炉子把它炼出来。')
  } else {
    body = React.createElement(ArtifactView, { artifact, onOpenChapter })
  }

  return React.createElement(React.Fragment, null, head, body)
}

// ------------------------------------------------------------------ 导出菜单
function ExportMenu({ onExport, busy }) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef(null)

  React.useEffect(() => {
    if (!open) return undefined
    const onDown = event => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = format => {
    setOpen(false)
    onExport(format)
  }

  return React.createElement('div', { className: 'nf-menu-wrap', ref: wrapRef },
    React.createElement(Button, {
      variant: 'quiet', onClick: () => setOpen(value => !value), busy, 'aria-expanded': open,
    }, Icon.download, '导出'),
    open ? React.createElement('div', { className: 'nf-menu', role: 'menu' },
      React.createElement('button', { type: 'button', role: 'menuitem', onClick: () => pick('markdown') },
        'Markdown', React.createElement('small', null, '.md · 便于继续编辑')),
      React.createElement('button', { type: 'button', role: 'menuitem', onClick: () => pick('epub') },
        'EPUB', React.createElement('small', null, '.epub · 阅读器直读')),
    ) : null,
  )
}

// ------------------------------------------------------------------ 主组件
export function Workbench({ projectId, onBack, notify }) {
  const [project, setProject] = React.useState(null)
  const [artifacts, setArtifacts] = React.useState({})
  const [brief, setBrief] = React.useState(null)
  const [outline, setOutline] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')

  const [selected, setSelected] = React.useState('overview')
  const [artifact, setArtifact] = React.useState(null)
  const [artifactLoading, setArtifactLoading] = React.useState(false)
  const [artifactError, setArtifactError] = React.useState('')
  const [artifactVersion, setArtifactVersion] = React.useState(0)

  const [run, setRun] = React.useState(null)
  const [events, setEvents] = React.useState([])
  const [runError, setRunError] = React.useState('')
  const [starting, setStarting] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [gateBusy, setGateBusy] = React.useState(false)
  const [gateHidden, setGateHidden] = React.useState(false)

  const [chapter, setChapter] = React.useState(null) // {id, tab}
  const seqRef = React.useRef(0)

  const loadProject = React.useCallback(async () => {
    const data = await getProject(projectId)
    setProject(data.project)
    // GET /projects/:id 返回 { project, run, runs }，产物清单在 project.artifacts 里。
    const artifactMap = data.project?.artifacts ?? data.artifacts ?? {}
    setArtifacts(artifactMap)
    const keys = Object.keys(artifactMap)
    const [briefArtifact, outlineArtifact] = await Promise.all([
      keys.includes('brief') ? getArtifact(projectId, 'brief').catch(() => null) : null,
      keys.includes('outline') ? getArtifact(projectId, 'outline').catch(() => null) : null,
    ])
    setBrief(briefArtifact?.content ?? null)
    setOutline(outlineArtifact?.content ?? null)
    return data
  }, [projectId])

  // 首屏：项目 + 当前运行
  React.useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError('')
    loadProject()
      .then(() => {
        if (!alive) return
        return getRun(projectId, 0).then(payload => {
          if (!alive) return
          const current = payload?.run ?? null
          setRun(current)
          setEvents(current?.events ?? [])
          seqRef.current = current?.events?.length ? Math.max(...current.events.map(event => event.seq ?? 0)) : 0
          // 挂载时 run 已经结束（短项目常见）：产物与统计是在 loadProject 之后
          // 才落盘的，必须再刷一次，否则章节列表/字数会停在 0。
          if (current && current.status !== 'running') return loadProject()
        })
      })
      .catch(error => { if (alive) setLoadError(error.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [projectId, loadProject])

  // 轮询：运行中每 1200ms 增量拉；结束即停并刷新项目
  React.useEffect(() => {
    if (run?.status !== 'running') return undefined
    let alive = true
    let inFlight = false
    const timer = setInterval(() => {
      if (inFlight) return
      inFlight = true
      getRun(projectId, seqRef.current)
        .then(payload => {
          if (!alive) return
          const next = payload?.run
          if (!next) return
          setRun(next)
          if (next.events?.length) {
            seqRef.current = Math.max(seqRef.current, ...next.events.map(event => event.seq ?? 0))
            setEvents(previous => mergeEvents(previous, next.events))
          }
          if (next.status !== 'running') {
            // 收尾补一次全量拉取：run-end 常在最后一次增量之后才落盘，
            // 只靠增量轮询会漏掉它，抽屉停在「已完成」。
            getRun(projectId, 0)
              .then(payload => {
                if (!alive || !payload?.run) return
                setRun(payload.run)
                setEvents(payload.run.events ?? [])
                seqRef.current = payload.run.events?.length
                  ? Math.max(...payload.run.events.map(event => event.seq ?? 0))
                  : seqRef.current
              })
              .catch(() => {})
            setArtifactVersion(value => value + 1)
            loadProject().catch(() => {})
            if (next.status === 'error') setRunError(next.error?.message ?? '运行中断')
          }
        })
        .catch(error => { if (alive) setRunError(error.message) })
        .finally(() => { inFlight = false })
    }, 1200)
    return () => { alive = false; clearInterval(timer) }
  }, [projectId, run?.id, run?.status, loadProject])

  // 阶段产物
  const artifactKey = selected === 'overview' ? null : STAGE_ARTIFACT[selected] ?? null
  React.useEffect(() => {
    if (!artifactKey) { setArtifact(null); setArtifactError(''); return undefined }
    if (!artifacts[artifactKey] && !artifactVersion) {
      setArtifact(null)
      setArtifactError('')
      return undefined
    }
    let alive = true
    setArtifactLoading(true)
    setArtifactError('')
    getArtifact(projectId, artifactKey)
      .then(payload => { if (alive) setArtifact(payload ?? null) })
      .catch(error => { if (alive) { setArtifact(null); setArtifactError(error.message) } })
      .finally(() => { if (alive) setArtifactLoading(false) })
    return () => { alive = false }
  }, [projectId, artifactKey, artifactVersion, artifacts])

  const openChapter = (id, tab = 'beats') => setChapter({ id, tab })

  const refreshRun = next => {
    if (!next) return
    seqRef.current = next.events?.length ? Math.max(...next.events.map(event => event.seq ?? 0)) : 0
    setRun(next)
    setEvents(next.events ?? [])
  }

  const begin = async (options, message) => {
    setStarting(true)
    setRunError('')
    try {
      const created = await startRun(projectId, options)
      refreshRun(created)
      setChapter(null)
      notify(message, 'ok')
    } catch (error) {
      setRunError(error.message)
      notify(error.message, 'error')
    } finally {
      setStarting(false)
    }
  }

  const onContinue = () => {
    const from = project?.pendingReview?.nextStages?.[0] ?? resumeStage(project)
    // 引擎明确要求 stages 与 from/to 二选一；只传 from 让它跑到底。
    begin({ from, autoApprove: !project?.params?.reviewGate }, '已开炉，继续炼')
  }

  const onRerun = () => {
    if (selected === 'overview') return
    begin({ from: selected, to: selected, force: true, autoApprove: !project?.params?.reviewGate },
      `重跑「${STAGE_BY_ID[selected]?.title ?? selected}」`)
  }

  const onContinueReview = async () => {
    setGateBusy(true)
    try {
      const created = await continueReview(projectId, { autoApprove: !project?.params?.reviewGate })
      refreshRun(created)
      setGateHidden(true)
      notify('审稿门已放行，继续炼', 'ok')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setGateBusy(false)
    }
  }

  const onCancel = async () => {
    setCancelling(true)
    try {
      const cancelled = await cancelRun(projectId)
      if (cancelled) setRun(cancelled)
      notify('已请求取消，等当前这一步收尾', 'ok')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  const onExport = async format => {
    setExporting(true)
    try {
      const payload = await exportProject(projectId, format)
      const file = payload?.export
      notify(file ? `已导出 ${file.filename}` : '已导出', 'ok')
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return React.createElement('div', { className: 'nf-loading', style: { padding: '120px 0' } },
      React.createElement(Spinner), '开卷中…')
  }

  if (loadError) {
    return React.createElement('div', { style: { maxWidth: 640, margin: '80px auto' } },
      React.createElement('div', { className: 'nf-error' }, loadError),
      React.createElement('div', { style: { marginTop: 14, display: 'flex', gap: 10 } },
        React.createElement(Button, { variant: 'quiet', onClick: onBack }, '返回书架'),
        React.createElement(Button, {
          variant: 'primary', onClick: () => { setLoading(true); loadProject().catch(e => setLoadError(e.message)).finally(() => setLoading(false)) },
        }, '重试'),
      ),
    )
  }

  if (!project) return null

  const gate = project.pendingReview
  const params = project.params ?? {}
  const stageTitle = selected === 'overview' ? '总览' : STAGE_BY_ID[selected]?.title ?? selected

  const body = chapter
    ? React.createElement(ChapterView, {
      projectId,
      project,
      chapterId: chapter.id,
      initialTab: chapter.tab,
      outline,
      notify,
      onBack: () => setChapter(null),
    })
    : selected === 'overview'
      ? React.createElement(Overview, { project, brief, outline, onContinue, onOpenChapter: openChapter, busy: starting })
      : React.createElement(StagePane, {
        project, outline, selected, artifact, loading: artifactLoading, error: artifactError,
        onOpenChapter: openChapter,
        onRetry: () => setArtifactVersion(value => value + 1),
      })

  return React.createElement('div', { className: 'nf-workbench' },
    React.createElement(StageRail, {
      project,
      selected: chapter ? STAGE_ARTIFACT[selected] ? selected : 'overview' : selected,
      onSelect: stage => { setChapter(null); setSelected(stage) },
    }),

    React.createElement('main', { className: 'nf-main' },
      React.createElement('div', { className: 'nf-main-inner' },
        React.createElement('div', { className: 'nf-main-top' },
          React.createElement('button', { type: 'button', className: 'nf-btn nf-btn-quiet nf-btn-sm', onClick: onBack },
            Icon.back, '书架'),
          React.createElement('span', { className: 'nf-muted', style: { fontSize: 11 } }, '/'),
          React.createElement('span', { style: { fontSize: 12, color: 'var(--nf-ink-2)' } }, chapter ? `第 ${chapter.id.replace(/^ch0?/, '')} 章` : stageTitle),
          React.createElement('span', { className: 'nf-grow' }),
          React.createElement(Button, { size: 'sm', variant: 'primary', onClick: onContinue, busy: starting },
            Icon.play, '继续炼'),
          React.createElement(Button, {
            size: 'sm', variant: 'quiet', onClick: onRerun, disabled: selected === 'overview' || !!chapter,
          }, Icon.refresh, '重跑本步'),
          React.createElement(ExportMenu, { onExport, busy: exporting }),
        ),

        gate && !gateHidden && !chapter && run?.status !== 'running'
          ? React.createElement('div', { className: 'nf-banner' },
            React.createElement('div', null,
              React.createElement('b', null,
                gate.stage === 'outline' ? '大纲已就绪，继续？' : '草稿已就绪，继续？'),
              React.createElement('p', null,
                gate.stage === 'outline'
                  ? '大纲与账本已经落纸。确认没问题，再炼细纲与草稿；也可以先去大纲页改两笔。'
                  : '这一批草稿与审校已经完成。确认后继续修订与下一批章节。'),
            ),
            React.createElement('div', { style: { display: 'flex', gap: 8, flexShrink: 0 } },
              React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: () => setGateHidden(true) }, '稍后'),
              React.createElement(Button, { size: 'sm', variant: 'accent', onClick: onContinueReview, busy: gateBusy }, '继续'),
            ),
          )
          : null,

        body,
      ),
    ),

    React.createElement(RunDrawer, {
      run, events, error: runError, cancelling,
      onCancel,
    }),
  )
}
