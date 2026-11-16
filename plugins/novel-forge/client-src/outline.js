// 大纲的两种形状：v1 把章挂在 volume.chapters 下；v2 顶层扁平 chapters + volume.chapterIds。
// 服务端 recipes/novel/chapter.js 的 chaptersOf() 已按「扁平优先」兜底，UI 这份保持同一口径，
// 否则新项目（v2）在界面上会显示「0 章」。

function flatChapters(outline) {
  return Array.isArray(outline?.chapters) ? outline.chapters : []
}

/** 按卷归组：每项 { volume, index, chapters }。章按 volume.chapters → volume.chapterIds 顺序取。 */
export function volumeRows(outline) {
  const flat = flatChapters(outline)
  const byId = new Map(flat.map(chapter => [chapter?.id, chapter]).filter(([id]) => Boolean(id)))
  const volumes = Array.isArray(outline?.volumes) && outline.volumes.length
    ? outline.volumes
    : [{ title: '全书', chapters: flat }]
  const rows = volumes.map((volume, index) => {
    const own = Array.isArray(volume?.chapters) && volume.chapters.length
      ? volume.chapters
      : (Array.isArray(volume?.chapterIds) ? volume.chapterIds : []).map(id => byId.get(id)).filter(Boolean)
    return { volume, index, chapters: own }
  })
  // 一卷都没展开、但顶层有章（历史数据）：按全书一卷展示，别把章弄丢。
  if (!rows.some(row => row.chapters.length) && flat.length) {
    return [{ volume: { title: '全书' }, index: 0, chapters: flat }]
  }
  return rows
}

/** 扁平的章列表，每项带上所属卷标题。 */
export function chapterMeta(outline) {
  const list = []
  for (const { volume, chapters } of volumeRows(outline)) {
    for (const chapter of chapters) list.push({ ...chapter, volume: volume?.title })
  }
  return list
}
