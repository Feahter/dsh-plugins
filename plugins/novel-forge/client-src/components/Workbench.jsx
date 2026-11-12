// 工作台：左阶段轨 / 中产物 / 右运行抽屉，外加审稿门与章节页。
import React from 'react'
import {
  getProject, getArtifact, getRun, startRun, cancelRun, continueReview, exportProject,
} from '../api.js'
import { STAGES, STAGE_BY_ID, STATUS_LABEL, STAGE_ARTIFACT } from '../strings.js'
import {
  Badge, Button, Dot, Empty, Icon, ProgressBar, Spinner, formatNumber, formatTokens, formatWords,
} from './bits.jsx'
import { StageRail, overallProgress } from './StageRail.jsx'
import { ArtifactView } from './ArtifactView.jsx'
import { RunDrawer } from './RunDrawer.jsx'
import { ChapterView } from './ChapterView.jsx'

const EVENT_LIMIT = 400
// 后端对单项目只允许一个活运行，第二个 startRun 必撞 409 RUN_ACTIVE。
const RUNNING_HINT = '正在运行，先取消或等它跑完'

/** 合并增量事件：按 seq 去重，旧事件不丢；没有新事件时返回原数组（引用不变）。 */
function mergeEvents(prev, incoming) {
  if (!incoming?.length) return prev
  const seen = new Set(prev.map(event => event.seq))
  const next = prev.slice()
  let added = 0
  for (const event of incoming) {
    if (event.seq != null && seen.has(event.seq)) continue
    if (event.seq != null) seen.add(event.seq)
    next.push(event)
    added += 1
  }
  if (!added) return prev
  next.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  return next.length > EVENT_LIMIT ? next.slice(-EVENT_LIMIT) : next
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

// 成本可见性：调用次数旁边直接给出估算 token 与重试次数，省得用户去翻 run.json。
function costLine(stats) {
  const tokensIn = Number(stats?.estTokensIn) || 0
  const tokensOut = Number(stats?.estTokensOut) || 0
  const retried = Number(stats?.retried) || 0
  if (!tokensIn && !tokensOut) return ''
  const parts = [`${formatTokens(tokensIn)} 进`, `${formatTokens(tokensOut)} 出`]
  if (retried) parts.push(`重试 ${retried}`)
  return parts.join(' · ')
}

// ------------------------------------------------------------------ 总览
function Overview({ project, brief, outline, onContinue, onOpenChapter, busy, running }) {
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
      React.createElement(Button, {
        variant: 'accent', onClick: onContinue, busy, disabled: running,
        title: running ? RUNNING_HINT : undefined,
      }, Icon.play, '继续炼'),
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
        React.createElement('small', { className: 'nf-stat-sub' }, costLine(project?.stats)),
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
      // 细纲已并入 draft 工作单元，不再是独立 stage；这里只按审校/写作选 tab。
      const tab = stage.id === 'review' ? 'review' : 'draft'
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

// ------------------------------------------------------------------ 正典（不是 stage，独立入口）
// 产物 key 沿用 STAGE_ARTIFACT.canon，取数仍走 Workbench 的 artifactKey effect。
function CanonPane({ available, legacy, artifact, loading, error, onRetry }) {
  const head = React.createElement('div', { className: 'nf-main-head' },
    React.createElement('div', null,
      React.createElement('h2', { className: 'nf-main-title' }, '正典 · 连续性'),
      React.createElement('div', { className: 'nf-main-sub' },
        React.createElement('span', null, '事实、未回收线索与人物状态，跨章一致性的底稿'),
      ),
    ),
  )

  let body
  if (legacy && !available) {
    body = React.createElement(Empty, { title: 'v1 项目没有 canon（用账本）' },
      '这本书仍是 v1 账本形状。跑一次「继续炼」会按 v2 正典重建；旧账本不会被删除。')
  } else if (loading) {
    body = React.createElement('div', { className: 'nf-loading' }, React.createElement(Spinner), '取正典中…')
  } else if (error) {
    body = React.createElement('div', { className: 'nf-error' },
      error,
      React.createElement('div', { style: { marginTop: 10 } },
        React.createElement(Button, { size: 'sm', variant: 'quiet', onClick: onRetry }, '重试')))
  } else if (!artifact) {
    body = React.createElement(Empty, { title: '正典还没建' },
      '大纲落纸后，正典会随写作自动累积；也可以点「继续炼」让它补种。')
  } else {
    body = React.createElement(ArtifactView, { artifact })
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
  const running = run?.status === 'running'
  const [events, setEvents] = React.useState([])
  const [runError, setRunError] = React.useState('')
  const [starting, setStarting] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  // 取消后服务端还在给当前 item 收尾，轮询要延续到 run 真正落终态。
  const [settling, setSettling] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [gateBusy, setGateBusy] = React.useState(false)
  const [gateHidden, setGateHidden] = React.useState(false)
  const gateAt = project?.pendingReview?.at ?? null
  // 点过「稍后」只对当次审稿门有效；来了新的审稿门要再提醒一次。
  React.useEffect(() => { setGateHidden(false) }, [gateAt])

  const [chapter, setChapter] = React.useState(null) // {id, tab}
  const seqRef = React.useRef(0)
  // run 落终态会重建轮询 effect；收尾全量拉取不能跟着 effect 的 alive 一起作废，
  // 用组件级标记判断，否则最后一次 run-end 事件会被误丢。
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const flushChapterRef = React.useRef(null)

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

  // 轮询：运行中每 1200ms 增量拉；取消后继续拉到收尾完成，然后刷新项目。
  React.useEffect(() => {
    const active = run?.status === 'running' || settling
    if (!active) return undefined
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
          setRunError('')
          if (next.events?.length) {
            seqRef.current = Math.max(seqRef.current, ...next.events.map(event => event.seq ?? 0))
            setEvents(previous => mergeEvents(previous, next.events))
          }
          if (next.status !== 'running') {
            setSettling(false)
            // 收尾补一次全量拉取：run-end 常在最后一次增量之后才落盘，
            // 只靠增量轮询会漏掉它，抽屉停在「已完成」。
            getRun(projectId, 0)
              .then(payload => {
                if (!mountedRef.current || !payload?.run) return
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
  }, [projectId, run?.id, run?.status, settling, loadProject])

  // 阶段产物
  const artifactKey = selected === 'overview' ? null : STAGE_ARTIFACT[selected] ?? null
  React.useEffect(() => {
    if (!artifactKey) { setArtifact(null); setArtifactError(''); return undefined }
    if (!artifacts[artifactKey]) {
      // 项目里没有这个产物：就是空态，不发请求也不报红。
      setArtifact(null)
      setArtifactError('')
      setArtifactLoading(false)
      return undefined
    }
    let alive = true
    setArtifactLoading(true)
    setArtifactError('')
    getArtifact(projectId, artifactKey)
      .then(payload => { if (alive) setArtifact(payload ?? null) })
      .catch(error => {
        if (!alive) return
        setArtifact(null)
        // 产物还没生成（ARTIFACT_MISSING）是正常空态，不是错误；
        // 否则跑完一轮后点任意未到的阶段都会看到红条。
        if (error?.code === 'ARTIFACT_MISSING' || /没有这个产物/.test(error?.message ?? '')) setArtifactError('')
        else setArtifactError(error.message)
      })
      .finally(() => { if (alive) setArtifactLoading(false) })
    return () => { alive = false }
  }, [projectId, artifactKey, artifactVersion, artifacts])

  // 章节页把 flush 注册到这里；任何会卸载它的导航都先落草稿。
  const registerFlush = React.useCallback(fn => {
    flushChapterRef.current = fn
    return () => { if (flushChapterRef.current === fn) flushChapterRef.current = null }
  }, [])

  const flushChapter = React.useCallback(async () => {
    const fn = flushChapterRef.current
    if (!fn) return
    try {
      if (await fn()) notify('离开前已自动保存草稿', 'ok')
    } catch (error) {
      notify('草稿自动保存失败：' + error.message, 'error')
    }
  }, [notify])

  const leaveChapter = async fn => {
    await flushChapter()
    fn()
  }

  const openChapter = (id, tab = 'beats') =>
    leaveChapter(() => setChapter({ id, tab }))


  const refreshRun = next => {
    if (!next) return
    seqRef.current = next.events?.length ? Math.max(...next.events.map(event => event.seq ?? 0)) : 0
    setRun(next)
    setEvents(next.events ?? [])
  }

  const begin = async (options, message) => {
    await flushChapter()
    setStarting(true)
    setRunError('')
    setSettling(false)
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
    // 正典不是 stage，没有可重跑的阶段。
    if (selected === 'overview' || selected === 'canon') return
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
      setSettling(true)
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
      const file = payload ?? {}
      notify(file.filename ? `已导出 ${file.filename}（保存在 ${file.path}）` : '已导出', 'ok')
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
  const stageTitle = selected === 'overview'
    ? '总览'
    : selected === 'canon'
      ? '正典 · 连续性'
      : STAGE_BY_ID[selected]?.title ?? selected
  const hasCanon = Boolean(artifacts.canon)
  const hasLedger = Boolean(artifacts.ledger)

  const body = chapter
    ? React.createElement(ChapterView, {
      projectId,
      project,
      chapterId: chapter.id,
      initialTab: chapter.tab,
      outline,
      notify,
      registerFlush,
      onBack: () => leaveChapter(() => setChapter(null)),
    })
    : selected === 'overview'
      ? React.createElement(Overview, { project, brief, outline, onContinue, onOpenChapter: openChapter, busy: starting, running })
      : selected === 'canon'
        ? React.createElement(CanonPane, {
          available: hasCanon, legacy: hasLedger, artifact, loading: artifactLoading, error: artifactError,
          onRetry: () => setArtifactVersion(value => value + 1),
        })
        : React.createElement(StagePane, {
          project, outline, selected, artifact, loading: artifactLoading, error: artifactError,
          onOpenChapter: openChapter,
          onRetry: () => setArtifactVersion(value => value + 1),
        })

  return React.createElement('div', { className: 'nf-workbench' },
    React.createElement(StageRail, {
      project,
      selected: chapter ? STAGE_ARTIFACT[selected] ? selected : 'overview' : selected,
      hasCanon,
      hasLedger,
      onCanon: async () => {
        await leaveChapter(() => { setChapter(null); setSelected('canon') })
      },
      onSelect: async stage => {
        await leaveChapter(() => { setChapter(null); setSelected(stage) })
      },
      onOverview: async () => {
        await leaveChapter(() => { setChapter(null); setSelected('overview') })
      },
    }),

    React.createElement('main', { className: 'nf-main' },
      React.createElement('div', { className: 'nf-main-inner' },
        React.createElement('div', { className: 'nf-main-top' },
          React.createElement('button', {
            type: 'button',
            className: 'nf-btn nf-btn-quiet nf-btn-sm',
            onClick: async () => { await leaveChapter(onBack) },
          }, Icon.back, '书架'),
          React.createElement('span', { className: 'nf-muted', style: { fontSize: 11 } }, '/'),
          React.createElement('span', { style: { fontSize: 12, color: 'var(--nf-ink-2)' } }, chapter ? `第 ${chapter.id.replace(/^ch0?/, '')} 章` : stageTitle),
          React.createElement('span', { className: 'nf-grow' }),
          // 窄窗口没有右侧抽屉，用紧凑条兜住进度与取消入口。
          (run?.status === 'running' || settling) ? React.createElement('div', { className: 'nf-runbar' },
            React.createElement(Dot, { status: settling ? 'idle' : 'running' }),
            React.createElement('span', { className: 'nf-runbar-label' },
              settling ? '收尾中…' : (run?.current?.label || '运行中…')),
            React.createElement('span', { className: 'nf-muted', style: { fontSize: 10.5 } },
              `${run?.progress?.done ?? 0} / ${run?.progress?.total || '—'}`),
            React.createElement(Button, {
              size: 'sm', variant: 'danger', onClick: onCancel,
              disabled: !(run?.status === 'running'), busy: cancelling,
            }, '取消'),
          ) : null,
          React.createElement(Button, {
            size: 'sm', variant: 'primary', onClick: onContinue, busy: starting, disabled: running,
            title: running ? RUNNING_HINT : undefined,
          }, Icon.play, '继续炼'),
          React.createElement(Button, {
            size: 'sm', variant: 'quiet', onClick: onRerun, disabled: running || selected === 'overview' || selected === 'canon' || !!chapter,
            title: running ? RUNNING_HINT : undefined,
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
