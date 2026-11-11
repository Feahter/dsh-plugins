// 书架容器：拉项目、续跑、删除；ProjectList 只负责画。
import React from 'react'
import { listProjects, deleteProject, startRun } from '../api.js'
import { STAGES } from '../strings.js'
import { ProjectList } from './ProjectList.jsx'

function startStage(project) {
  const gate = project?.pendingReview?.nextStages?.[0]
  if (gate) return gate
  const pending = STAGES.find(stage => (project?.stages?.[stage.id]?.status ?? 'idle') !== 'done')
  return pending?.id ?? 'premise'
}

export function Shelf({ onOpen, onNew, notify }) {
  const [projects, setProjects] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [busyId, setBusyId] = React.useState(null)

  const load = React.useCallback(async () => {
    setError('')
    const payload = await listProjects()
    // api 层已经取过 projects 字段；两种形状都接住。
    setProjects(Array.isArray(payload) ? payload : payload?.projects ?? [])
  }, [])

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    load()
      .catch(cause => { if (alive) setError(cause.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [load])

  const retry = () => {
    setLoading(true)
    load().catch(cause => setError(cause.message)).finally(() => setLoading(false))
  }

  const onContinue = async project => {
    if (project.activeRunId) {
      onOpen(project.id)
      return
    }
    setBusyId(project.id)
    try {
      await startRun(project.id, {
        from: startStage(project.raw ?? project),
        autoApprove: !project.raw?.params?.reviewGate,
      })
      notify(`《${project.title}》已开炉`, 'ok')
    } catch (cause) {
      notify(cause.message, 'error')
    } finally {
      setBusyId(null)
    }
    onOpen(project.id)
  }

  const onDelete = async project => {
    try {
      await deleteProject(project.id)
      setProjects(list => list.filter(item => item.id !== project.id))
      notify(`《${project.title}》已删除`, 'ok')
    } catch (cause) {
      notify(cause.message, 'error')
      throw cause
    }
  }

  return React.createElement(ProjectList, {
    projects,
    loading,
    error,
    busyId,
    onCreate: onNew,
    onOpen: project => onOpen(project.id),
    onContinue,
    onDelete,
    onRetry: retry,
  })
}
