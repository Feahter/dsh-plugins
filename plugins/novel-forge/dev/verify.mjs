// 真宿主替身 + Playwright 冒烟：书架 → 新建 → 工作台 → 运行中。
// 假宿主只覆盖 §5.2 客户端用到的端点；fixture 是 6 章 demo，已写 2 章。
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCREENS = path.join(ROOT, 'test', 'screens')
const NOW = Date.now()
const iso = value => new Date(value).toISOString()

// ------------------------------------------------------------------ fixture
const PREMISE = '一个在殡仪馆值夜班的年轻人，发现死者会在头七那晚回来。回来的父亲只问了他一句：你妈去哪了。'

const brief = {
  title: '头七',
  logline: '头七那晚，父亲回来了，只问了一句：你妈去哪了。',
  theme: '活人欠下的告别，得由活人自己还。',
  promise: '每章揭开一层殡仪馆的旧事，读者跟着守夜人一起数到天亮。',
  ending: '他烧掉值班表，第一次在白天走进殡仪馆。',
  genreTags: ['悬疑', '家庭', '民俗'],
}

const bible = `# 雾港殡仪馆

## 规矩

- 头七那晚，灵堂的灯不能灭；灯灭，人就会走错门。
- 值班表用红笔写名字，写完不能改。
- 冰柜第三格空着，谁也不能用。

## 地方

雾港在江口，冬天潮气重，墙皮一年掉一层。殡仪馆在半山，夜里能听见船笛。`

const characters = {
  cast: [
    { name: '陈默', role: '守夜人', want: '弄清母亲失踪那晚发生了什么', fear: '发现自己也是被留下来的人', secret: '他改过值班表上的一个名字', voice: '话少，句子短，习惯先看人的手', arc: '从替死人守夜，到替活人开口', relations: [{ to: '陈建国', kind: '父子' }, { to: '林姐', kind: '同事' }] },
    { name: '陈建国', role: '父亲·头七归来', want: '问清妻子去哪了', fear: '儿子不肯看他', secret: '死前最后一个电话打给了林姐', voice: '沙哑，总把话尾吞掉', arc: '从执念到放手', relations: [{ to: '陈默', kind: '父子' }] },
    { name: '林姐', role: '遗体化妆师', want: '把这座馆撑到退休', fear: '被人翻出二十年前的旧账', secret: '她替陈默母亲化过妆', voice: '轻，像在哄人', arc: '从守口如瓶到交出钥匙', relations: [{ to: '陈默', kind: '师徒' }] },
    { name: '老周', role: '馆长', want: '让殡仪馆安稳运转', fear: '上头来查账', secret: '第三格冰柜里没有尸体', voice: '慢，爱打官腔', arc: '从和稀泥到认账', relations: [{ to: '林姐', kind: '旧识' }] },
  ],
}

const spine = `# 情感脊柱

陈默想留住的不是父亲，是那句没说完的“你妈去哪了”。

每一次头七，都是一次迟到的对话：活人问，死人答不了；死人问，活人不敢答。`

const outline = {
  totalChapters: 6,
  volumes: [
    {
      title: '卷一 · 头七',
      purpose: '父亲回来，揭开母亲失踪的旧口子。',
      chapters: [
        { id: 'ch01', title: '灯不能灭', goal: '陈默守第一夜，父亲出现在灵堂', conflict: '灯油见底，规矩说不能添', turn: '父亲开口问母亲', hook: '值班表上多出一个名字', pov: '第三人称限知', when: '冬夜', where: '灵堂', cast: ['陈默', '陈建国'] },
        { id: 'ch02', title: '红笔', goal: '陈默去查值班表', conflict: '林姐拦着不让翻旧档', turn: '旧档里母亲的名字被涂掉', hook: '第三格冰柜传来敲击声', pov: '第三人称限知', when: '次日凌晨', where: '档案室', cast: ['陈默', '林姐'] },
        { id: 'ch03', title: '第三格', goal: '打开第三格冰柜', conflict: '老周拿规矩压人', turn: '冰柜是空的，里面只有一件湿透的女式外套', hook: '外套口袋里有一张船票', pov: '第三人称限知', when: '清晨', where: '停尸间', cast: ['陈默', '老周'] },
      ],
    },
    {
      title: '卷二 · 二七',
      purpose: '船票指向江对岸，旧案翻面。',
      chapters: [
        { id: 'ch04', title: '船票', goal: '按船票上的日期去江口', conflict: '渡船停航，雾太大', turn: '船老大认得母亲的照片', hook: '她说那晚船上还有一个人', pov: '第三人称限知', when: '白天', where: '江口渡船', cast: ['陈默'] },
        { id: 'ch05', title: '对岸', goal: '找到船票上的地址', conflict: '地址是一片拆掉的旧厂', turn: '厂里留着母亲的工牌', hook: '工牌背面写着陈建国的名字', pov: '第三人称限知', when: '黄昏', where: '江北旧厂', cast: ['陈默', '林姐'] },
        { id: 'ch06', title: '天亮', goal: '回馆里问清最后一个人', conflict: '父亲的头七要结束了', turn: '老周承认当年改了记录', hook: '陈默第一次在白天点灯', pov: '第三人称限知', when: '头七最后一夜', where: '灵堂', cast: ['陈默', '陈建国', '老周'] },
      ],
    },
  ],
}

const ledger = {
  facts: [
    { id: 'f1', text: '父亲陈建国于三年前去世，死因登记为溺水。', chapter: 'ch01', status: 'canon' },
    { id: 'f2', text: '母亲赵岚在父亲去世后一个月失踪。', chapter: 'ch01', status: 'canon' },
    { id: 'f3', text: '殡仪馆冰柜第三格长期空置，馆里有不成文规矩。', chapter: 'ch03', status: 'canon' },
    { id: 'f4', text: '值班表用红笔写名字，写完不能改。', chapter: 'ch02', status: 'canon' },
  ],
  threads: [
    { id: 't1', text: '母亲失踪那晚的去向', opened: 'ch01', status: 'open' },
    { id: 't2', text: '值班表上多出的名字', opened: 'ch01', status: 'open' },
    { id: 't3', text: '第三格冰柜里的湿外套', opened: 'ch03', status: 'open' },
  ],
  characters: {
    陈默: { location: '殡仪馆', state: '连着两夜没睡', knows: ['父亲回来了', '母亲名字被涂掉'] },
    林姐: { location: '化妆间', state: '回避陈默', knows: ['旧档的位置', '外套是谁的'] },
  },
  timeline: [
    { chapter: 'ch01', when: '头七夜 23:40', event: '父亲出现在灵堂' },
    { chapter: 'ch02', when: '次日 02:10', event: '旧档里的名字被涂掉' },
    { chapter: 'ch03', when: '清晨 05:30', event: '第三格冰柜被打开' },
  ],
  canonRules: ['头七夜灵堂灯不能灭', '红笔写的名字不能改', '第三格冰柜不装人'],
}

const beats = {
  ch01: {
    chapterId: 'ch01',
    title: '灯不能灭',
    scenes: [
      { no: 1, where: '灵堂', when: '夜里十一点', cast: ['陈默'], goal: '熬过头七第一夜', obstacle: '灯油只剩半壶', turn: '灯芯突然爆了一下', exit: '他听见身后的椅子响', sensory: '蜡油味、潮气、远处船笛' },
      { no: 2, where: '灵堂', when: '十一点四十', cast: ['陈默', '陈建国'], goal: '确认是不是错觉', obstacle: '父亲坐在阴影里，像一直没走', turn: '父亲问他：你妈去哪了', exit: '陈默没答，灯又暗了一寸', sensory: '父亲袖口的江水味' },
      { no: 3, where: '值班室', when: '凌晨', cast: ['陈默'], goal: '把名字从值班表上划掉', obstacle: '红笔写下的名字擦不掉', turn: '表上多了一个他从没写过的名字', exit: '他决定去查旧档', sensory: '红墨水在指腹上晕开' },
    ],
  },
  ch02: {
    chapterId: 'ch02',
    title: '红笔',
    scenes: [
      { no: 1, where: '档案室', when: '凌晨两点', cast: ['陈默', '林姐'], goal: '翻出母亲失踪那晚的记录', obstacle: '林姐挡在门口', turn: '林姐说：你爸最后那个电话是打给我的', exit: '她让开半步', sensory: '铁柜的凉、旧纸的霉' },
      { no: 2, where: '档案室', when: '两点半', cast: ['陈默', '林姐'], goal: '找到原始值班表', obstacle: '母亲的名字被涂成一块黑', turn: '涂改液下面透出另一个名字', exit: '楼下传来敲击声', sensory: '涂改液的刺鼻味' },
    ],
  },
}

const drafts = {
  ch01: `灵堂的灯是下午点上的，到夜里十一点，灯油只剩半壶。

陈默坐在门口的小马扎上，背靠着门框。风从山下的江面爬上来，带着一股湿腥味，把白布吹得轻轻鼓起，又落下去。他不敢看那口棺材，也不敢看表。

殡仪馆的规矩，头七那晚灯不能灭。灯灭，人就会走错门。

他起身去添油，手刚碰到灯罩，灯芯“啪”地爆了一下。火苗矮下去，又慢慢立起来。他听见身后有椅子挪动的声音。

“默。”

那声音很哑，像被水泡过。

陈默没有回头。他盯着灯芯，喉咙里像塞了一团棉。

“你妈去哪了？”

灵堂里静得能听见蜡油滴在铁盘上的声音。他慢慢转过身。父亲坐在最后一排的阴影里，穿着下葬那天的那件灰夹克，袖口是湿的，往地上滴水。

“爸。”他说。

父亲没有应，只是又问了一遍：“你妈去哪了？”

陈默张了张嘴。他想说，妈在你走后一个月就不见了。他想说，我找了三年。他想说，你凭什么现在才问。

最后他说：“我不知道。”

父亲低下头，看着自己湿透的鞋。灯又暗了一寸。

那一夜剩下的时间，陈默一直坐在灯前，没敢合眼。天快亮的时候，他回值班室，想把值班表收起来。红笔写的名字在纸上排成一列，最后一个是他自己的。

他伸手去划，红墨水已经干透，擦不掉。再低头时，表上多了一个名字。

赵岚。

是他母亲的笔迹。`
  ,
  ch02: `档案室在地下室，铁柜子一排排站着，像停尸间的另一种排列。

陈默用值班钥匙开了门。灯管闪了两下才亮，照见地上薄薄一层灰。他按年份找过去，手指在铁皮上留下一道道印子。

“你找什么？”

林姐站在门口，没开灯，手里端着一杯热水。

“三年前的值班表。”陈默说，“我妈失踪那晚的。”

“没有。”她说得太快，“那年的档案受潮，处理掉了。”

陈默看着她。林姐把杯子换到另一只手上，热水晃了一下。

“林姐。”他说，“我爸最后一个电话，是打给谁的？”

她没有立刻回答。地下室里只有灯管细小的电流声。过了很久，她侧过身，让开半步。

“最里面那排。”她说，“别开顶灯，跳闸。”

原始值班表夹在一本发霉的登记册里。母亲的名字被涂改液盖住，涂得很厚，像一块疤。陈默用指甲刮了刮，涂改液下面透出另一个名字。

陈建国。

他盯着那三个字，听见楼上传来一声闷响。

咚。

咚。

是从停尸间传来的。第三格冰柜的位置。`,
}

const reviews = {
  ch01: {
    verdict: 'revise',
    findings: [
      { severity: 'block', kind: '时间线', where: 'ch01 · 灵堂', issue: '前文写父亲三年前溺水身亡，本章却写“下葬那天的那件灰夹克”，读者会误以为刚下葬。', fix: '补一句“三年前下葬时穿的那件”，或改成骨灰盒旁的遗物。' },
      { severity: 'warn', kind: '节奏', where: 'ch01 · 开头', issue: '前 600 字都是环境描写，父亲出场偏晚。', fix: '把“椅子响”提前到第三段，先给异样，再补环境。' },
      { severity: 'warn', kind: '对话', where: 'ch01 · 中段', issue: '对话比例偏低，陈默的回避可以再多一层。', fix: '加一句父亲追问“你妈没跟你说？”，让陈默的沉默有内容。' },
      { severity: 'note', kind: '意象', where: 'ch01 · 结尾', issue: '“红墨水”与“血”的联想可以更克制。', fix: '保留一次即可，不必再点“像血”。' },
    ],
  },
  ch02: {
    verdict: 'pass',
    findings: [
      { severity: 'note', kind: '道具', where: 'ch02 · 档案室', issue: '涂改液刮开露出名字，物理上略勉强。', fix: '可改成对着灯照出压痕，更可信。' },
    ],
  },
}

const summaries = {
  ch01: '陈默头七守夜，父亲陈建国出现，只问母亲赵岚的下落。天亮前，值班表上多出母亲的名字。',
  ch02: '陈默查旧档，林姐透露父亲死前最后一个电话打给她。原始值班表上母亲的名字被涂改，下面透出陈建国的名字。停尸间第三格传来敲击声。',
}

// ------------------------------------------------------------------ 内存宿主
let counter = 0
const timers = new Set()

const createProject = (id, params, title) => ({
  schemaVersion: 1,
  id,
  title: title || params.title || '未命名长篇',
  recipe: 'novel',
  recipeVersion: '1.0.0',
  createdAt: iso(NOW - 86400000 * 3),
  updatedAt: iso(NOW - 120000),
  params,
  artifacts: {},
  stages: {},
  stats: { calls: 0, estTokensIn: 0, estTokensOut: 0, words: 0, chapters: params.chapters, drafted: 0, revised: 0 },
  activeRunId: null,
  pendingReview: null,
  lastError: null,
  store: {},
})

const demo = createProject('demo', {
  premise: PREMISE,
  title: '雾港旧案',
  genre: '悬疑',
  audience: '成年',
  language: 'zh',
  chapters: 6,
  wordsPerChapter: 3000,
  pov: '第三人称限知',
  tone: '冷、克制、潮湿的温情',
  styleGuide: '不要“仿佛/似乎/缓缓”，少用形容词；对话要短；每段不超过四行。',
  autoReview: true,
  reviewGate: false,
}, '雾港旧案')

const putContent = (project, key, kind, content) => {
  project.store[key] = { kind, content, version: 1, updatedAt: iso(NOW - 300000) }
  project.artifacts[key] = {
    kind,
    version: 1,
    updatedAt: iso(NOW - 300000),
    bytes: Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content)),
    by: { stage: key.split('/')[0], runId: 'demo-run-1', model: 'deepseek-chat' },
  }
}

putContent(demo, 'brief', 'json', brief)
putContent(demo, 'bible', 'md', bible)
putContent(demo, 'characters', 'json', characters)
putContent(demo, 'spine', 'md', spine)
putContent(demo, 'outline', 'json', outline)
putContent(demo, 'ledger', 'json', ledger)
for (const [id, content] of Object.entries(beats)) putContent(demo, `beats/${id}`, 'json', content)
for (const [id, content] of Object.entries(drafts)) putContent(demo, `draft/${id}`, 'md', content)
for (const [id, content] of Object.entries(reviews)) putContent(demo, `review/${id}`, 'json', content)
for (const [id, content] of Object.entries(summaries)) putContent(demo, `summary/${id}`, 'md', content)

const chapterIds = ['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06']
const stageOf = (status, items) => ({ status, updatedAt: iso(NOW - 240000), ...(items ? { items } : {}) })

demo.stages = {
  premise: stageOf('done'),
  bible: stageOf('done'),
  characters: stageOf('done'),
  spine: stageOf('done'),
  outline: stageOf('done'),
  beats: stageOf('done', Object.fromEntries(chapterIds.map(id => [id, 'done']))),
  draft: stageOf('partial', Object.fromEntries(chapterIds.map(id => [id, id === 'ch01' || id === 'ch02' ? 'done' : 'pending']))),
  review: stageOf('partial', Object.fromEntries(chapterIds.map(id => [id, id === 'ch01' || id === 'ch02' ? 'done' : 'pending']))),
  revise: stageOf('idle', Object.fromEntries(chapterIds.map(id => [id, 'pending']))),
  blurb: stageOf('idle'),
}
demo.stats = { calls: 38, estTokensIn: 84500, estTokensOut: 61200, words: 5980, chapters: 6, drafted: 2, revised: 0 }
demo.pendingReview = { stage: 'draft', at: iso(NOW - 180000), nextStages: ['revise'] }

const demoRun = {
  id: 'demo-run-1',
  projectId: 'demo',
  status: 'done',
  startedAt: iso(NOW - 900000),
  endedAt: iso(NOW - 200000),
  options: { stages: ['premise', 'bible', 'characters', 'spine', 'outline', 'beats', 'draft'], from: 'premise', autoApprove: true },
  current: { stage: 'draft', item: 'ch02', label: '草稿 · 第 2 章' },
  progress: { done: 2, total: 6 },
  seq: 10,
  events: [
    { seq: 1, ts: iso(NOW - 900000), type: 'run-start', data: { stages: ['premise', 'bible', 'characters', 'spine', 'outline', 'beats', 'draft'], items: 6, autoApprove: true } },
    { seq: 2, ts: iso(NOW - 880000), type: 'stage-start', data: { stage: 'premise', total: 1 } },
    { seq: 3, ts: iso(NOW - 870000), type: 'llm', data: { stage: 'premise', item: null, phase: 'brief', chars: 860, model: 'deepseek-chat' } },
    { seq: 4, ts: iso(NOW - 860000), type: 'artifact', data: { key: 'brief', kind: 'json', bytes: 920 } },
    { seq: 5, ts: iso(NOW - 700000), type: 'stage-end', data: { stage: 'outline', status: 'done' } },
    { seq: 6, ts: iso(NOW - 600000), type: 'item-start', data: { stage: 'draft', item: 'ch01', index: 0, total: 6 } },
    { seq: 7, ts: iso(NOW - 560000), type: 'llm', data: { stage: 'draft', item: 'ch01', phase: 'draft', chars: 3120, model: 'deepseek-chat' } },
    { seq: 8, ts: iso(NOW - 540000), type: 'artifact', data: { key: 'draft/ch01', kind: 'md', bytes: 5210 } },
    { seq: 9, ts: iso(NOW - 320000), type: 'item-done', data: { stage: 'draft', item: 'ch02' } },
    { seq: 10, ts: iso(NOW - 300000), type: 'run-end', data: { status: 'done' } },
  ],
  error: null,
  stats: { calls: 38 },
}

const state = {
  projects: new Map([['demo', demo]]),
  runs: new Map([['demo', [demoRun]]]),
}

const summaryOf = project => ({
  id: project.id,
  title: project.title,
  recipe: project.recipe,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  params: project.params,
  stats: project.stats,
  stages: project.stages,
  pendingReview: project.pendingReview,
  activeRunId: project.activeRunId,
})

const publicRun = (run, after = 0) => ({
  ...run,
  events: run.events.filter(event => event.seq > after),
})

function startRun(project, options) {
  project.pendingReview = null
  const from = options.from || 'premise'
  const id = `run-${++counter}`
  const run = {
    id,
    projectId: project.id,
    status: 'running',
    startedAt: iso(Date.now()),
    endedAt: null,
    options,
    current: { stage: from, item: null, label: '准备开炉' },
    progress: { done: 0, total: 3 },
    seq: 0,
    events: [],
    error: null,
    stats: {},
  }
  project.activeRunId = id
  project.updatedAt = iso(Date.now())
  if (project.stages[from]) project.stages[from].status = 'running'
  if (!state.runs.has(project.id)) state.runs.set(project.id, [])
  state.runs.get(project.id).push(run)

  const push = (type, data) => {
    run.seq += 1
    run.events.push({ seq: run.seq, ts: iso(Date.now()), type, data })
  }

  const script = [
    ['run-start', { stages: options.stages ?? [from], items: 3, autoApprove: options.autoApprove !== false }],
    ['stage-start', { stage: from, total: 3 }],
    ['item-start', { stage: from, item: 'ch03', index: 0, total: 3 }],
    ['llm', { stage: from, item: 'ch03', phase: 'draft', chars: 2680, model: 'deepseek-chat' }],
    ['artifact', { key: 'draft/ch03', kind: 'md', bytes: 5420 }],
    ['item-done', { stage: from, item: 'ch03' }],
    ['progress', { done: 1, total: 3 }],
    ['item-start', { stage: from, item: 'ch04', index: 1, total: 3 }],
    ['llm', { stage: from, item: 'ch04', phase: 'draft', chars: 2410, model: 'deepseek-chat' }],
    ['log', { message: '连续性检查通过：ch04 与 ch03 的钩子已衔接', level: 'info' }],
    ['artifact', { key: 'draft/ch04', kind: 'md', bytes: 4980 }],
    ['item-done', { stage: from, item: 'ch04' }],
    ['progress', { done: 2, total: 3 }],
    ['item-start', { stage: from, item: 'ch05', index: 2, total: 3 }],
    ['llm', { stage: from, item: 'ch05', phase: 'draft', chars: 2540, model: 'deepseek-chat' }],
    ['item-done', { stage: from, item: 'ch05' }],
    ['progress', { done: 3, total: 3 }],
    ['stage-end', { stage: from, status: 'done' }],
    ['run-end', { status: 'done' }],
  ]

  let step = 0
  const timer = setInterval(() => {
    const entry = script[step]
    step += 1
    if (!entry) return
    const [type, data] = entry
    push(type, data)
    if (type === 'item-start') {
      run.current = { stage: from, item: data.item, label: `第 ${Number(data.item.slice(2))} 章` }
      if (project.stages[from]?.items) project.stages[from].items[data.item] = 'running'
    }
    if (type === 'progress') run.progress = data
    if (type === 'stage-end') {
      if (project.stages[from]) project.stages[from].status = 'done'
      project.updatedAt = iso(Date.now())
    }
    if (type === 'run-end') {
      run.status = 'done'
      run.endedAt = iso(Date.now())
      project.activeRunId = null
      clearInterval(timer)
      timers.delete(timer)
    }
  }, 520)
  timers.add(timer)
  return run
}

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const sendJSON = (res, status, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const sendError = (res, status, message, code = 'error') => sendJSON(res, status, { error: { code, message } })

const readBody = req => new Promise((resolve, reject) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    if (!raw) return resolve({})
    try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
  })
  req.on('error', reject)
})

async function api(req, res, url) {
  const pathname = url.pathname.replace(/^\/novel-forge/, '')
  const parts = pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && pathname === '/recipes') {
    return sendJSON(res, 200, { recipes: [{ id: 'novel', name: '小说流水线', version: '1.0.0' }] })
  }
  if (req.method === 'GET' && pathname === '/model') {
    return sendJSON(res, 200, { available: true, provider: 'fake', model: 'deepseek-chat' })
  }

  if (req.method === 'POST' && pathname === '/estimate') {
    const body = await readBody(req)
    const chapters = Number(body.params?.chapters) || 24
    const words = Number(body.params?.wordsPerChapter) || 3000
    const auto = body.params?.autoReview !== false
    const calls = 6 + chapters * (auto ? 6 : 3)
    return sendJSON(res, 200, {
      estimate: {
        chapters,
        calls,
        estTokensIn: Math.round(chapters * words * 2.2),
        estTokensOut: Math.round(chapters * words * 0.8),
        note: `约 ${calls} 次模型调用；${chapters} 章 × ${words} 字`,
      },
    })
  }

  if (parts[0] !== 'projects') return sendError(res, 404, '没有这个接口', 'not_found')

  if (parts.length === 1 && req.method === 'GET') {
    return sendJSON(res, 200, { projects: [...state.projects.values()].map(summaryOf) })
  }

  if (parts.length === 1 && req.method === 'POST') {
    const body = await readBody(req)
    const params = body.params ?? {}
    if (!params.premise || String(params.premise).trim().length < 8) return sendError(res, 400, 'premise 至少 8 个字', 'invalid_params')
    const id = `p${state.projects.size + 1}`
    const project = createProject(id, {
      ...params,
      chapters: Number(params.chapters) || 24,
      wordsPerChapter: Number(params.wordsPerChapter) || 3000,
    }, body.title)
    project.params.title = params.title || ''
    state.projects.set(id, project)
    state.runs.set(id, [])
    return sendJSON(res, 201, { project: summaryOf(project) })
  }

  const project = state.projects.get(parts[1])
  if (!project) return sendError(res, 404, '项目不存在', 'not_found')

  if (parts.length === 2 && req.method === 'GET') {
    return sendJSON(res, 200, {
      project: summaryOf(project),
      artifacts: project.artifacts,
      runs: state.runs.get(project.id) ?? [],
    })
  }

  if (parts.length === 2 && req.method === 'PATCH') {
    const body = await readBody(req)
    if (body.title != null) project.title = body.title
    if (body.params) project.params = { ...project.params, ...body.params }
    project.updatedAt = iso(Date.now())
    return sendJSON(res, 200, { project: summaryOf(project) })
  }

  if (parts.length === 2 && req.method === 'DELETE') {
    state.projects.delete(project.id)
    state.runs.delete(project.id)
    return sendJSON(res, 200, { ok: true })
  }

  if (parts[2] === 'artifact' && parts.length === 3) {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key')
      const stored = project.store[key]
      if (!stored) return sendError(res, 404, '还没有这个产物', 'artifact_not_found')
      return sendJSON(res, 200, { artifact: { key, ...stored } })
    }
    if (req.method === 'PUT') {
      const body = await readBody(req)
      if (!body.key) return sendError(res, 400, '缺少 key', 'invalid_params')
      putContent(project, body.key, body.kind || 'md', body.content)
      project.updatedAt = iso(Date.now())
      return sendJSON(res, 200, { artifact: { key: body.key, ...project.store[body.key] } })
    }
  }

  if (parts[2] === 'run' && parts.length === 3) {
    if (req.method === 'GET') {
      const runs = state.runs.get(project.id) ?? []
      const run = runs.at(-1)
      if (!run) return sendJSON(res, 200, { run: null })
      const after = Number(url.searchParams.get('after')) || 0
      return sendJSON(res, 200, { run: publicRun(run, after) })
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const run = startRun(project, body)
      return sendJSON(res, 202, { run: publicRun(run, 0) })
    }
  }

  if (parts[2] === 'run' && parts[3] === 'cancel' && req.method === 'POST') {
    const runs = state.runs.get(project.id) ?? []
    const run = runs.at(-1)
    if (!run) return sendError(res, 404, '没有运行中的任务', 'no_run')
    if (run.status === 'running') {
      run.status = 'cancelled'
      run.endedAt = iso(Date.now())
      run.seq += 1
      run.events.push({ seq: run.seq, ts: iso(Date.now()), type: 'run-end', data: { status: 'cancelled' } })
      project.activeRunId = null
    }
    return sendJSON(res, 200, { run: publicRun(run, 0) })
  }

  if (parts[2] === 'runs' && req.method === 'GET') {
    return sendJSON(res, 200, { runs: state.runs.get(project.id) ?? [] })
  }

  if (parts[2] === 'estimate' && req.method === 'GET') {
    const chapters = Number(project.params.chapters) || 24
    const words = Number(project.params.wordsPerChapter) || 3000
    return sendJSON(res, 200, { estimate: { chapters, calls: chapters * 4 + 8, tokens: Math.round(chapters * words * 3.2), minutes: (chapters * 4 + 8) * 2 } })
  }

  if (parts[2] === 'export' && req.method === 'POST') {
    const body = await readBody(req)
    const ext = body.format === 'epub' ? 'epub' : 'md'
    return sendJSON(res, 200, {
      export: {
        filename: `${project.title}-20261112.${ext}`,
        path: `/tmp/novel-forge/exports/${project.title}-20261112.${ext}`,
        mime: ext === 'epub' ? 'application/epub+zip' : 'text/markdown',
        bytes: 12480,
      },
    })
  }

  if (parts[2] === 'review' && parts[3] === 'continue' && req.method === 'POST') {
    const body = await readBody(req)
    const from = project.pendingReview?.nextStages?.[0] ?? 'revise'
    const run = startRun(project, { stages: [from], from, autoApprove: body.autoApprove !== false })
    return sendJSON(res, 202, { run: publicRun(run, 0) })
  }

  return sendError(res, 404, '没有这个接口', 'not_found')
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? '/dev/page.html' : pathname
  const target = path.resolve(ROOT, `.${relative}`)
  if (!target.startsWith(ROOT)) return sendError(res, 403, '越界', 'forbidden')
  try {
    const data = await fs.readFile(target)
    res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}

/** 本机 Playwright 版本与缓存浏览器可能对不上，优先用缓存里最新的 headless shell。 */
async function findChromium() {
  try {
    await fs.access(chromium.executablePath())
    return undefined
  } catch {
    const cache = path.join(os.homedir(), 'Library/Caches', 'ms-playwright')
    const dirs = await fs.readdir(cache).catch(() => [])
    for (const dir of dirs.filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const candidate = path.join(cache, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell')
      try {
        await fs.access(candidate)
        return candidate
      } catch {}
    }
    return undefined
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  try {
    if (url.pathname.startsWith('/novel-forge')) return await api(req, res, url)
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end() }
    return await serveStatic(res, url.pathname)
  } catch (error) {
    console.error('[fake-host]', error)
    return sendError(res, 500, error.message, 'internal')
  }
})

// ------------------------------------------------------------------ Playwright
const failures = []
const consoleErrors = []
const pageErrors = []

const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  await fs.mkdir(SCREENS, { recursive: true })

  // 浏览器不能直接 import 'react'，先把 harness 打成一个 bundle。
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'dev', 'harness.mjs')],
    outfile: path.join(ROOT, 'dev', 'harness.bundle.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  console.log(`假宿主：${base}/dev/page.html`)

  const browser = await chromium.launch({ executablePath: await findChromium() })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => pageErrors.push(error.message))

  try {
    await page.goto(`${base}/dev/page.html`, { waitUntil: 'load' })
    await page.waitForFunction('window.__ready === true', null, { timeout: 10000 })
    await page.waitForSelector('text=雾港旧案', { timeout: 10000 })

    const slots = await page.evaluate(() => window.__slots)
    check('侧栏注册 novel-forge.panel / order 55 / 墨炉',
      slots.some(item => item.id === 'novel-forge.panel' && item.order === 55 && item.label === '墨炉'),
      JSON.stringify(slots))
    check('主面板注册 key=novel-forge', slots.some(item => item.key === 'novel-forge'))

    // 1) 书架
    await page.screenshot({ path: path.join(SCREENS, 'list.png') })
    const shelfText = await page.locator('.nf-shelf').innerText()
    check('书架显示示例项目与进度', shelfText.includes('雾港旧案') && shelfText.includes('已写 2/6 章'), shelfText.slice(0, 120))
    check('书架有新建入口与空态说明位', shelfText.includes('新建长篇'))
    console.log('  · 截图 test/screens/list.png')

    // 2) 新建
    await page.getByRole('button', { name: '新建长篇' }).click()
    await page.waitForSelector('text=新建长篇')
    await page.locator('.nf-textarea-premise').fill('一个在旧书店整理遗物的女孩，发现每本书的空白页上都会浮出下一个借书人的死期。')
    await page.locator('.nf-input').first().fill('纸页之下')
    const createText = await page.locator('.nf-create').innerText()
    check('新建页有实时预估', createText.includes('模型调用') && createText.includes('token') || createText.includes('TOKEN'), createText.slice(0, 120))
    await page.screenshot({ path: path.join(SCREENS, 'create.png') })
    console.log('  · 截图 test/screens/create.png')

    // 3) 开始炼 → 工作台（新项目）
    await page.getByRole('button', { name: '开始炼' }).click()
    await page.waitForSelector('.nf-workbench', { timeout: 15000 })
    await page.waitForSelector('text=总览', { timeout: 10000 })
    check('新建后进入工作台', await page.locator('.nf-workbench').count() === 1)

    // 回到书架，打开有内容的 demo
    await page.locator('.nf-main-top').getByRole('button', { name: '书架' }).click()
    await page.waitForSelector('text=雾港旧案')
    const card = page.locator('.nf-card', { hasText: '雾港旧案' }).first()
    await card.getByRole('button', { name: '继续', exact: true }).click()
    await page.waitForSelector('.nf-workbench', { timeout: 10000 })
    await page.waitForSelector('text=草稿已就绪，继续？', { timeout: 10000 })

    await page.screenshot({ path: path.join(SCREENS, 'workbench.png') })
    const benchText = await page.locator('.nf-workbench').innerText()
    check('工作台显示审稿门 banner', benchText.includes('草稿已就绪，继续？'))
    check('工作台显示阶段轨与总览', benchText.includes('流水线') && benchText.includes('全书进度'))
    check('工作台显示运行事件流', benchText.includes('事件流'))
    check('工作台显示已写字数', benchText.includes('5980 字') || benchText.includes('5,980 字'), benchText.slice(0, 200))
    console.log('  · 截图 test/screens/workbench.png')

    // 3.5) 章节页：细纲/草稿/审校/摘要
    await page.locator('.nf-rail-item', { hasText: '章节草稿' }).click()
    await page.waitForSelector('.nf-main .nf-chapter-row', { timeout: 10000 })
    await page.locator('.nf-main .nf-chapter-row').first().click()
    await page.waitForSelector('.nf-tabs', { timeout: 10000 })
    const chapterText = await page.locator('.nf-main').innerText()
    check('章节页有四个标签', ['细纲', '草稿', '审校', '摘要'].every(item => chapterText.includes(item)), chapterText.slice(0, 120))
    await page.getByRole('tab', { name: '草稿', exact: true }).click()
    await page.waitForSelector('.nf-editor-bar', { timeout: 5000 })
    check('草稿可进入编辑', await page.getByRole('button', { name: '编辑' }).isVisible())

    // 4) 继续炼 → 运行中
    await page.locator('.nf-main-top').getByRole('button', { name: '继续炼' }).click()
    await page.locator('.nf-drawer').getByText('运行中', { exact: true }).first().waitFor({ timeout: 10000 })
    await page.waitForTimeout(2400)
    await page.screenshot({ path: path.join(SCREENS, 'running.png') })
    const runningText = await page.locator('.nf-drawer').innerText()
    check('运行中显示事件与取消按钮', runningText.includes('取消运行') && runningText.includes('事件流'))
    check('运行中有进度数字', /\d+\s*\/\s*\d+/.test(runningText), runningText.slice(0, 160))
    check('取消按钮可点', await page.getByRole('button', { name: '取消运行' }).isEnabled())
    console.log('  · 截图 test/screens/running.png')

    // 返回对话
    await page.getByRole('button', { name: '返回对话' }).click()
    const selected = await page.evaluate(() => window.__selectedPanel)
    check('返回对话调用 selectPanel(null)', selected === null, String(selected))
  } catch (error) {
    failures.push(`流程异常：${error.message}`)
    console.error(error)
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
    for (const timer of timers) clearInterval(timer)
  }

  console.log(`\nconsole error：${consoleErrors.length} 条`)
  for (const message of consoleErrors) console.log(`  ! ${message}`)
  console.log(`page error：${pageErrors.length} 条`)
  for (const message of pageErrors) console.log(`  ! ${message}`)

  if (consoleErrors.length || pageErrors.length) failures.push('存在 console/page error')

  if (failures.length) {
    console.error(`\n失败 ${failures.length} 项：`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
  } else {
    console.log('\n全部通过')
  }
}

main()
