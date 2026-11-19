// 文案与小说 recipe 的展示常量。
// 结构化字段名来自 docs/architecture.md §4.2 / §4.4，客户端不自行发明。

export const STAGES = [
  { id: 'premise', title: '故事核心', en: 'Premise', note: '一句话炼成 logline、主题与结局方向' },
  { id: 'bible', title: '世界设定', en: 'World', note: '只写这本书会用到的规则、地点与禁忌' },
  { id: 'characters', title: '人物档案', en: 'Cast', note: '欲望、恐惧、秘密、说话方式与弧光' },
  { id: 'spine', title: '情感脊柱', en: 'Spine', note: '主线、结局与分卷弧光（JSON）' },
  { id: 'outline', title: '卷章大纲', en: 'Outline', note: '脚本建骨架、按卷惰性展开', review: true },
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
  // 正典不是独立 stage，但产物面板要按 key 取它。
  canon: 'canon',
}

export const GENRES = ['悬疑', '奇幻', '科幻', '都市', '历史', '言情', '恐怖', '武侠', '通用']
export const POVS = ['第三人称限知', '第三人称全知', '第一人称']

// 网文长篇定位：频道决定读者契约，更新节奏决定卷末钩子与存稿建议。
export const CHANNELS = ['男频', '女频', '通用']
export const CADENCES = ['日更', '周更', '不定期']

// 市场坐标：把「今年榜单在写什么」变成开书时可选的输入。
export const MARKET_MODES = [
  { value: 'off', label: '关闭' },
  { value: 'year', label: '按年份' },
  { value: 'tags', label: '按标签' },
]
export const MARKET_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

export const LONGFORM_FIELDS = {
  channel: '频道',
  market: '市场坐标',
  tags: '标签',
  sellingPoint: '一句话卖点',
  chaptersPerVolume: '每卷章数',
  updateCadence: '更新节奏',
  goldenFinger: '金手指',
  comps: '对标作品',
  more: '更多设定',
}

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
  toolsOn: '对话工具：开',
  toolsOff: '对话工具：关',
  toolsHint: '开启后助手才能调用墨炉的小说工具；关闭时不占任何 token。只对最近一次对话生效，重启后重置。',
  toolsOpened: '已为最近一次对话开启：回到对话发一句话，助手就能调用墨炉工具。',
  toolsClosed: '已关闭最近一次对话的墨炉工具。',
  toolsNeedSession: '还没有可接手的对话：先在对话里发一句话，再回来开启。',
  updateLabel: '新版本',
  updateTip: '新版本 {version} 已发布，点击前往插件页更新',
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
  toolsOn: 'Conversation tools: on',
  toolsOff: 'Conversation tools: off',
  toolsHint: 'Turn this on so the assistant can call Novel Forge tools; when off, they cost no tokens. Applies to the most recent conversation only; resets on restart.',
  toolsOpened: 'Enabled for the most recent conversation. Send it a message and the assistant can call Novel Forge tools.',
  toolsClosed: 'Novel Forge tools turned off for the most recent conversation.',
  toolsNeedSession: 'No conversation to attach to yet: send a message in a chat first, then come back.',
  updateLabel: 'Update',
  updateTip: 'Update {version} is available — click to update on the plugin page',
}
