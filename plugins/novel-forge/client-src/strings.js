// 文案与小说 recipe 的展示常量。
// 结构化字段名来自 docs/architecture.md §4.2 / §4.4，客户端不自行发明。

export const STAGES = [
  { id: 'premise', title: '故事核心', en: 'Premise', note: '一句话炼成 logline、主题与结局方向' },
  { id: 'bible', title: '世界设定', en: 'World', note: '只写这本书会用到的规则、地点与禁忌' },
  { id: 'characters', title: '人物档案', en: 'Cast', note: '欲望、恐惧、秘密、说话方式与弧光' },
  { id: 'spine', title: '情感脊柱', en: 'Spine', note: '主线因果链、每卷情绪曲线、结局落点' },
  { id: 'outline', title: '卷章大纲', en: 'Outline', note: '分卷分章：目标、冲突、转折、钩子', review: true },
  { id: 'beats', title: '章节细纲', en: 'Beats', note: '每章 5–9 个场景 beat', each: true },
  { id: 'draft', title: '章节草稿', en: 'Draft', note: '一章一章写，写完即出摘要', each: true, review: true },
  { id: 'review', title: '连续性审校', en: 'Review', note: '事实、时间线、人物、视角与文风', each: true },
  { id: 'revise', title: '修订', en: 'Revise', note: '只改审校指出的问题，保持文风', each: true },
  { id: 'blurb', title: '封面文案', en: 'Blurb', note: '书名定稿、一句话卖点、三百字简介' },
]

export const STAGE_BY_ID = Object.fromEntries(STAGES.map(stage => [stage.id, stage]))

// 每个阶段「看哪个产物」；each 阶段在 UI 里展开成章节列表。
export const STAGE_ARTIFACT = {
  premise: 'brief',
  bible: 'bible',
  characters: 'characters',
  spine: 'spine',
  outline: 'outline',
  blurb: 'blurb',
}

export const GENRES = ['悬疑', '奇幻', '科幻', '都市', '历史', '言情', '恐怖', '武侠', '通用']
export const POVS = ['第三人称限知', '第三人称全知', '第一人称']

export const STATUS_LABEL = {
  idle: '未开始',
  pending: '等待',
  running: '进行中',
  done: '已完成',
  partial: '部分完成',
  skipped: '已跳过',
  error: '出错',
  paused: '已暂停',
  cancelled: '已取消',
  interrupted: '已中断',
}

export const RUN_STATUS_LABEL = {
  idle: '未开始',
  running: '运行中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
  paused: '等待确认',
  interrupted: '已中断',
}

export const SEVERITY_LABEL = { block: '硬伤', warn: '注意', note: '备注' }

// 面板标题和说明从包内 locale/*.json 的 meta 读；这里只补 UI 内部会复用的短句。
export const zh = {
  panelTitle: '墨炉',
  panelDescription: 'AI 小说全流程创作流水线',
  backToChat: '返回对话',
  backToShelf: '返回书架',
  newBook: '新建长篇',
  shelfTitle: '书架',
  shelfSub: '每一本都停在你上次离开的地方。',
  emptyTitle: '还没有书。',
  emptyBody: '给我一句话，就能开炉。设定、人物、大纲、细纲、正文、审校，墨炉一章一章地炼。',
  emptySample: '试试这句：一个在殡仪馆值夜班的年轻人，发现死者会在头七那晚回来。',
  startWithOneLine: '用一句话开始',
  loading: '正在翻开…',
  retry: '重试',
}

export const en = {
  panelTitle: 'Novel Forge',
  panelDescription: 'A quiet pipeline for writing long fiction',
  backToChat: 'Back to chat',
  backToShelf: 'Shelf',
  newBook: 'New novel',
  shelfTitle: 'Shelf',
  shelfSub: 'Every book waits where you left it.',
  emptyTitle: 'No books yet.',
  emptyBody: 'One sentence is enough to fire the forge.',
  emptySample: 'Try: a night-shift worker at a funeral home learns the dead come back on the seventh day.',
  startWithOneLine: 'Start with one line',
  loading: 'Opening…',
  retry: 'Retry',
}
