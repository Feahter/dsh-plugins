// plan.js — 长篇 v0.2 的「脚本建骨架 + 卷纲惰性展开」纯函数层。
//
// 契约：docs/architecture-v2.md §2 / §3 / §7。
// 所有导出都是确定性的、零 IO、不调模型、不 import canon/packet：
//   - 卷数/每卷章数/章节 id 由脚本发号（模型给的 id 一律丢弃）
//   - 卷纲只在要写这一卷时合并进来，重复合并幂等
//   - nextActions 只读 outline + 参数 + 已写/已审集合，给出下一步动作
import { chapterId } from './outline.js'

// 全书最多 40 卷：卷列表要能被 spine 的一次模型调用写完。
// （注意：不是「单卷最多 40 章」；3000 章时每卷 75 章、共 40 卷。）
export const VOLUME_LIMIT = 40

function toCount(value, fallback = 0) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function text(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function textList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value) {
    const name = text(entry)
    if (name) out.push(name)
  }
  return [...new Set(out)]
}

function castNames(value) {
  if (!Array.isArray(value)) return []
  const names = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const name = entry.trim()
      if (name) names.push(name)
    } else if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
      const name = entry.name.trim()
      if (name) names.push(name)
    }
  }
  return [...new Set(names)]
}

function chapterTotal(outline, fallback = 0) {
  return toCount(outline?.totalChapters, fallback)
}

/**
 * 实际每卷章数：先把入参 clamp 到 10–60；如果这样会超过 40 卷，
 * 抬到 ceil(chapters / 40)，保证卷数 ≤ 40。
 * @param {number} chapters
 * @param {number} [chaptersPerVolume=30]
 * @returns {number}
 */
export function effectivePerVolume(chapters, chaptersPerVolume = 30) {
  const total = Math.max(0, Math.floor(Number(chapters) || 0))
  let per = Math.floor(Number(chaptersPerVolume))
  if (!Number.isFinite(per)) per = 30
  per = Math.min(60, Math.max(10, per))
  if (total > 0 && total / per > VOLUME_LIMIT) {
    per = Math.max(1, Math.ceil(total / VOLUME_LIMIT))
  }
  return per
}

/** 卷数 = ceil(chapters / effectivePerVolume)。 */
export function volumeCount(chapters, chaptersPerVolume = 30) {
  const total = Math.max(0, Math.floor(Number(chapters) || 0))
  if (total <= 0) return 0
  return Math.ceil(total / effectivePerVolume(total, chaptersPerVolume))
}

/** 1 → 'v01'；>99 时自然变宽（v100），不截断。 */
export function volumeId(index) {
  const n = Math.max(1, Math.floor(Number(index) || 1))
  return `v${String(n).padStart(2, '0')}`
}

/**
 * 纯脚本建骨架：0 次模型调用。
 * 章数按卷均分（前 n-1 卷 floor，最后一卷拿余数），章表为空、planned:false。
 * @param {{chapters:number, chaptersPerVolume?:number, spine?:object, language?:string}} input
 * @returns {object} outline v2
 */
export function buildOutlineSkeleton({ chapters, chaptersPerVolume = 30, spine, language = 'zh' } = {}) {
  const total = Math.max(0, Math.floor(Number(chapters) || 0))
  const count = volumeCount(total, chaptersPerVolume)
  const spineVolumes = Array.isArray(spine?.volumes) ? spine.volumes : []
  const base = count > 0 ? Math.floor(total / count) : 0

  const volumes = []
  for (let i = 0; i < count; i += 1) {
    const source = spineVolumes[i] && typeof spineVolumes[i] === 'object' ? spineVolumes[i] : {}
    const target = i === count - 1 ? total - base * (count - 1) : base
    volumes.push({
      id: volumeId(i + 1),
      index: i + 1,
      title: text(source.title) || `第 ${i + 1} 卷`,
      goal: text(source.goal ?? source.purpose),
      arc: text(source.arc),
      cast: castNames(source.cast),
      opens: textList(source.opens),
      closes: textList(source.closes),
      targetChapters: target,
      planned: false,
      chapterIds: [],
    })
  }

  return {
    version: 2,
    totalChapters: total,
    language: text(language) || 'zh',
    volumes,
    chapters: [],
  }
}

/** 按卷 id 找卷；找不到返回 null。 */
export function volumeById(outline, id) {
  if (!outline || !id) return null
  return (outline.volumes ?? []).find((volume) => volume?.id === id) ?? null
}

/** 章节所属卷；找不到返回 null。 */
export function volumeOfChapter(outline, chapterIdValue) {
  if (!outline || !chapterIdValue) return null
  const chapter = (outline.chapters ?? []).find((item) => item?.id === chapterIdValue)
  if (!chapter) return null
  if (chapter.volume) {
    const byField = volumeById(outline, chapter.volume)
    if (byField) return byField
  }
  return (outline.volumes ?? []).find((volume) => (volume?.chapterIds ?? []).includes(chapterIdValue)) ?? null
}

function normalizeVolumeChapters(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    out.push({
      title: text(entry.title),
      goal: text(entry.goal),
      conflict: text(entry.conflict),
      turn: text(entry.turn),
      hook: text(entry.hook),
      pov: text(entry.pov),
      when: text(entry.when),
      where: text(entry.where),
      cast: castNames(entry.cast),
    })
  }
  return out
}

function existingChaptersOf(outline, volume) {
  const byId = new Map((outline.chapters ?? []).filter(Boolean).map((chapter) => [chapter.id, chapter]))
  const ids = Array.isArray(volume.chapterIds) ? volume.chapterIds : []
  const fromIds = ids.map((id) => byId.get(id)).filter(Boolean)
  if (fromIds.length > 0) return fromIds
  return (outline.chapters ?? []).filter((chapter) => chapter?.volume === volume.id)
}

/**
 * 合并某卷的章表：先剔除该卷旧章节，再从该卷起点续号，保持全局按 index 升序。
 * 模型给的 id 一律丢弃。纯函数，重复调用幂等。
 * @param {object} outline v2 outline
 * @param {string} volumeIdValue 目标卷 id（v01…）
 * @param {Array<object>} chapters 该卷章表
 * @returns {object} 新 outline
 */
export function mergeVolumeChapters(outline, volumeIdValue, chapters) {
  if (!isV2(outline)) return outline
  const volumes = Array.isArray(outline.volumes) ? outline.volumes : []
  const targetIndex = volumes.findIndex((volume) => volume?.id === volumeIdValue)
  if (targetIndex < 0) return outline

  const incoming = normalizeVolumeChapters(chapters)
  const perVolume = volumes.map((volume, index) => {
    if (index === targetIndex) return incoming
    return existingChaptersOf(outline, volume).map((chapter) => ({
      title: text(chapter.title),
      goal: text(chapter.goal),
      conflict: text(chapter.conflict),
      turn: text(chapter.turn),
      hook: text(chapter.hook),
      pov: text(chapter.pov),
      when: text(chapter.when),
      where: text(chapter.where),
      cast: castNames(chapter.cast),
    }))
  })

  const total = chapterTotal(
    outline,
    perVolume.reduce((sum, list) => sum + list.length, 0),
  )
  // 卷首章号与 volumePromptContext 的 startChapter 对齐：前面的卷若还没物化，
  // 按 targetChapters 占位；已物化则用实际章数。这样卷可以乱序展开，先展开
  // v09 仍发 ch241…，不会把后面的章节挤到开头。
  const starts = []
  let cursor = 0
  for (let index = 0; index < volumes.length; index += 1) {
    starts.push(cursor)
    const materialized = perVolume[index].length
    cursor += materialized > 0
      ? materialized
      : Math.max(0, Math.floor(Number(volumes[index]?.targetChapters) || 0))
  }
  const nextChapters = []
  const nextVolumes = volumes.map((volume, index) => {
    const list = perVolume[index]
    const start = starts[index]
    const merged = list.map((chapter, offset) => {
      const globalIndex = start + offset
      return {
        id: chapterId(globalIndex, total),
        index: globalIndex + 1,
        volume: volume.id,
        title: chapter.title || `第 ${globalIndex + 1} 章`,
        goal: chapter.goal,
        conflict: chapter.conflict,
        turn: chapter.turn,
        hook: chapter.hook,
        pov: chapter.pov,
        when: chapter.when,
        where: chapter.where,
        cast: chapter.cast,
      }
    })
    nextChapters.push(...merged)
    return {
      ...volume,
      targetChapters: index === targetIndex ? merged.length : volume.targetChapters,
      planned: merged.length > 0,
      chapterIds: merged.map((chapter) => chapter.id),
    }
  })

  return {
    ...outline,
    version: 2,
    totalChapters: total,
    volumes: nextVolumes,
    chapters: nextChapters,
  }
}

/** 是否 v2 卷章大纲。 */
export function isV2(outline) {
  return Boolean(outline) && typeof outline === 'object' && Number(outline.version) === 2
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function v1Chapter(chapter) {
  return {
    // v1 章 id 是草稿的落盘键：迁移必须原样保留，不能按 params.chapters 重算宽度。
    id: text(chapter?.id),
    title: text(chapter?.title),
    goal: text(chapter?.goal),
    conflict: text(chapter?.conflict),
    turn: text(chapter?.turn),
    hook: text(chapter?.hook),
    pov: text(chapter?.pov),
    when: text(chapter?.when),
    where: text(chapter?.where),
    cast: castNames(chapter?.cast),
  }
}

/**
 * v1 outline → v2（幂等）。v1 已有的章 id 原样保留（草稿按 id 落盘）；
 * 只有原本没有 id 的章才发号。卷归属优先沿用 `volumes[].chapters`，
 * 没有归属时按 effectivePerVolume 均分。
 * @param {object} outline
 * @param {{params?:object}} [options]
 * @returns {object} outline v2
 */
export function migrateOutline(outline, { params = {} } = {}) {
  if (isV2(outline)) return outline
  const source = outline && typeof outline === 'object' ? outline : {}
  const v1Volumes = Array.isArray(source.volumes) ? source.volumes : []

  let rawChapters = Array.isArray(source.chapters) ? source.chapters.slice() : null
  if (!rawChapters) {
    rawChapters = []
    for (const volume of v1Volumes) {
      if (Array.isArray(volume?.chapters)) rawChapters.push(...volume.chapters)
    }
  }

  const counts = v1Volumes.map((volume) => (Array.isArray(volume?.chapters) ? volume.chapters.length : 0))
  const assigned = counts.reduce((sum, n) => sum + n, 0)
  const hasOwnership = rawChapters.length > 0 && assigned === rawChapters.length

  const per = effectivePerVolume(rawChapters.length, params?.chaptersPerVolume ?? 30)
  const groups = []
  if (hasOwnership) {
    let offset = 0
    for (let i = 0; i < v1Volumes.length; i += 1) {
      groups.push({ meta: v1Volumes[i], chapters: rawChapters.slice(offset, offset + counts[i]) })
      offset += counts[i]
    }
  } else if (rawChapters.length > 0) {
    const chunks = chunk(rawChapters, per)
    for (let i = 0; i < chunks.length; i += 1) {
      groups.push({ meta: v1Volumes[i] ?? {}, chapters: chunks[i] })
    }
  } else {
    for (let i = 0; i < v1Volumes.length; i += 1) {
      groups.push({ meta: v1Volumes[i], chapters: [] })
    }
  }

  const plannedTotal = toCount(params?.chapters)
  const total = plannedTotal > 0 ? Math.max(plannedTotal, rawChapters.length) : rawChapters.length
  // v1 outline 里已有 id 的章原样沿用（草稿按 id 落盘）；只有 v2 才展开出来的新章
  // 需要发新号，这时才用 total 决定宽度。整份 v1 outline 都没有 id 时按实际章数
  // 生成（max(2, 位数)），避免 params 与实际章数不一致时把 ch01… 写成 ch001…。
  const hasAnyId = rawChapters.some((chapter) => text(chapter?.id))
  const fallbackTotal = hasAnyId ? total : rawChapters.length

  const chapters = []
  const volumes = groups.map((group, index) => {
    const normalized = group.chapters.map(v1Chapter)
    const start = chapters.length
    const merged = normalized.map((chapter, offset) => {
      const globalIndex = start + offset
      return {
        ...chapter,
        id: chapter.id || chapterId(globalIndex, fallbackTotal),
        index: globalIndex + 1,
        volume: volumeId(index + 1),
        title: chapter.title || `第 ${globalIndex + 1} 章`,
      }
    })
    chapters.push(...merged)
    return {
      id: volumeId(index + 1),
      index: index + 1,
      title: text(group.meta?.title) || `第 ${index + 1} 卷`,
      goal: text(group.meta?.goal ?? group.meta?.purpose),
      arc: text(group.meta?.arc),
      cast: castNames(group.meta?.cast),
      opens: textList(group.meta?.opens),
      closes: textList(group.meta?.closes),
      targetChapters: merged.length,
      planned: merged.length > 0,
      chapterIds: merged.map((chapter) => chapter.id),
    }
  })

  return {
    version: 2,
    totalChapters: total,
    language: text(source.language) || text(params?.language) || 'zh',
    volumes,
    chapters,
  }
}

function idSet(input) {
  const out = new Set()
  if (input instanceof Set) {
    for (const entry of input) {
      const id = typeof entry === 'string' ? entry : entry?.id ?? entry?.chapter
      if (id) out.add(String(id))
    }
    return out
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      const id = typeof entry === 'string' ? entry : entry?.id ?? entry?.chapter
      if (id) out.add(String(id))
    }
    return out
  }
  if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (value) out.add(key)
    }
  }
  return out
}

/**
 * 纯判定下一步动作（最多 5 条），不调模型。
 * @param {{outline:object, params?:object, written?:Set|Array|object, reviewed?:Set|Array|object}} input
 * @returns {Array<{action:string, chapter?:string, volume?:string, why:string, estimate:{calls:number}}>}
 */
export function nextActions({ outline, params = {}, written, reviewed } = {}) {
  const volumes = Array.isArray(outline?.volumes) ? outline.volumes : []
  const chapters = Array.isArray(outline?.chapters) ? outline.chapters : []
  const writtenSet = idSet(written)
  const reviewedSet = idSet(reviewed)
  const actions = []

  const allWritten = chapters.length > 0 && chapters.every((chapter) => writtenSet.has(chapter.id))
  const allReviewed = chapters.length > 0 && chapters.every((chapter) => reviewedSet.has(chapter.id))
  const firstUnplanned = volumes.find(
    (volume) => !volume?.planned && !(Array.isArray(volume?.chapterIds) && volume.chapterIds.length > 0),
  )
  const plannedEmpty = chapters.length === 0

  // 1. 该展开下一卷了吗：还没有任何章表，或已计划的章全写完并审完了。
  //    审校没做完就展开下一卷会把「已写未审」的章永远留在队列后面。
  if (firstUnplanned && (plannedEmpty || (allWritten && allReviewed))) {
    actions.push({
      action: 'plan-volume',
      volume: firstUnplanned.id,
      why: plannedEmpty
        ? `全书还没有章表，先展开第 ${firstUnplanned.index ?? 1} 卷（${firstUnplanned.id}）才能开写。`
        : `已计划的章节都写完并审过了，展开下一卷（${firstUnplanned.id}）继续。`,
      estimate: { calls: 1 },
    })
  }

  // 2. 下一章还没写。
  const nextWrite = chapters.find((chapter) => !writtenSet.has(chapter.id))
  if (nextWrite) {
    actions.push({
      action: 'write',
      chapter: nextWrite.id,
      why: `${nextWrite.id} 还没有草稿，先写这一章。`,
      estimate: { calls: 1 },
    })
  }

  // 3. 已写但还没审校。
  const nextCheck = chapters.find((chapter) => writtenSet.has(chapter.id) && !reviewedSet.has(chapter.id))
  if (nextCheck) {
    actions.push({
      action: 'check',
      chapter: nextCheck.id,
      why: `${nextCheck.id} 已写但还没审校。`,
      estimate: { calls: 1 },
    })
  }

  const audited = params?.audited === true || outline?.audited === true || Boolean(outline?.auditedAt)
  const openVolumes = volumes.some((volume) => !volume?.planned)

  if (!openVolumes && allWritten && allReviewed) {
    if (audited) {
      actions.push({
        action: 'done',
        why: '全书已写完、审过并做过全书体检，没有下一步动作。',
        estimate: { calls: 0 },
      })
    } else {
      actions.push({
        action: 'audit',
        why: '全部章节已写完并审过，做一次全书一致性体检。',
        estimate: { calls: 0 },
      })
    }
  }

  return actions.slice(0, 5)
}

export default {
  VOLUME_LIMIT,
  effectivePerVolume,
  volumeCount,
  volumeId,
  buildOutlineSkeleton,
  volumeById,
  volumeOfChapter,
  mergeVolumeChapters,
  isV2,
  migrateOutline,
  nextActions,
}
