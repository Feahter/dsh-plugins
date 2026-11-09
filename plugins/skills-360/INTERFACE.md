# skills-360 内部接口契约（v2，冻结）

本文件是 core / host / ui 三方并行开发的唯一接口事实源。**任何一方不得单方面改形状**；
确需变更，先在团队任务里提出，由 Lead 更新本文件后同步三方。

v2（Rubric 2.0）：`demand` → `load`（按需加载），新增 `evolution`（持续进化）、
`report.evolution`、会话信号 `signals/prompts`、`POST /evolve` 与 `skills360_evolve`。
逐项阈值见 `RUBRIC.md` 与 `EVOLUTION-SPEC.md`。

插件根：`/Users/fuzhuo/Documents/deepseek-harness/default-workspace/skills-360`

## 0. 文件所有权

| 路径 | 所有者 | 说明 |
|---|---|---|
| `lib/frontmatter.js` `lib/metrics.js` `lib/analyze.js` `lib/score.js` `lib/usage.js` `lib/evolution.js` `lib/fixes.js` `lib/report.js` `lib/util.js` `lib/similarity.js` | core | 纯逻辑 + 文件写入（fixes） |
| `test/core.test.mjs` `test/fixtures/**` | core | 单测与夹具 |
| `index.js` `.verify-host.mjs` `test/host.test.mjs` | host | 插件宿主、路由、工具 |
| `client.js` `.verify-client.mjs` | ui | 面板 UI 与渲染测试 |
| `package.json` `cordis.patch.yml` `README.md` `RUBRIC.md` `test/run-all.mjs` | Lead | 打包、文档、总测试入口 |

只写自己范围内的文件；需要别家文件时发消息，不直接改。

## 1. 术语

- **skill**：DSH 当前 catalog 中的一个条目（`ctx.skills.list()` 的返回项），有 `name/description/source/provider/path`。
- **report**：单个 skill 的体检结果。
- **portfolio**：一次全量扫描的汇总。
- **action**：一条可执行的优化动作（改 frontmatter / 拆 reference / 补链接 / 追加经验等）。
- **signal**：窗口内一次技能加载之后出现的纠错、工具报错、重复加载、追问或失败回合；只在本机会话日志里挖。
- **lesson**：一条 `references/lessons.md` 经验，格式 `- [YYYY-MM-DD] 触发：… → 做法：…（证据：session …）`。
- **evolution**：某个技能的进化状态：经验数、最近经验时间、是否接进入口、待闭环信号与草稿。
- **auto**：机械、内容无损、可撤销，允许“一键全部优化”批量应用。
- **draft**：会生成新文字（描述重写、边界章节草稿），默认不进入“全部安全优化”，需用户单条点击。
- **manual**：只能给建议，不自动改。

## 2. 核心数据形状

### 2.1 SkillReport

```js
{
  name: 'academic-paper',
  source: 'user-agents',            // ctx.skills 的 source
  provider: 'filesystem',
  path: '/abs/path/SKILL.md',
  dir: '/abs/path',
  description: '...',               // 来自 frontmatter（回退 registry）
  whenToUse: '...' | null,
  coverage: 'full' | 'partial',     // full=读到 raw+目录；partial=只有 registry 元数据
  mtime: 1794000000000,             // SKILL.md mtime ms，可为 null

  metrics: {
    descriptionChars: 1247,
    catalogChars: 500,              // min(descriptionChars, catalogDescriptionMaxLength)
    catalogTruncated: true,
    bodyLines: 662,
    bodyChars: 65335,
    estTokens: 17000,
    headings: 24, h2: 8,
    codeBlocks: 3, codeLines: 40, maxCodeBlockLines: 24, codeRatio: 0.03,
    references: [{ path: 'references/a.md', name: 'a.md', chars: 1234 }],
    referenceCount: 6,
    referencedFiles: 2,             // SKILL.md 中实际链接到的本地 reference 数
    orphanReferences: 4,
    brokenLinks: [{ href: 'references/x.md', text: 'x', line: 88 }],
    numberedSteps: 7,
    commands: 12,
    hasExamples: true,
    hasWhenNotToUse: true,
    hasAntiPatterns: true,
    hasDecisionLanguage: true,
    todos: 0,
    secrets: 0,
    dangerous: 0,
    duplicateHeadings: 0,
    totalRefChars: 20000,
    overlapMax: 0.31,
    overlapName: 'deep-research'
  },

  usage: {
    count: 4,                       // windowDays 内 skill 工具调用次数
    lastUsedAt: 1794000000000,      // ms，null 表示窗口内未用
    windowDays: 30,
    exposureDays: 120,              // min(now - mtime, 365)
    sufficient: true,               // 有足够会话样本（日历 14 天，或 ≥30 个会话且 ≥2 天）
    firstSeen: 1794000000000,       // catalog 中首次出现时间（可 null）
    catalogSessions: 42,            // 出现在 catalog 中的会话数
    perWeek: 0.47
  },

  evolution: {
    applicable: true,               // false 时该维度不评分，其余五维按 90 折算
    loads: 4,
    lessons: { count: 2, latestAt: 1794000000000, linked: true, entries: [] },
    signals: {
      sessions: 3, reloads: 0, postLoadErrors: 1, corrections: 2, asks: 0, turnFailures: 0,
      lastSignalAt: 1794000000000, samples: [
        { kind: 'correction', at: 1794000000000, sessionId: 'abc123', excerpt: '不对，先跑测试再改' }
      ]
    },
    pending: { score: 7, hasUnclosed: true, lastSignalAt: 1794000000000,
               draft: { trigger: '不对，先跑测试再改', rule: '', evidence: 'session abc123' } },
    promptRecall: { total: 4, matched: 3, recall: 0.75, samples: [] },
    proposals: [
      { id: 'evolution.add-lesson', title: '沉淀一条经验', why: '…',
        evidence: { sessionId: 'abc123', at: 1794000000000, excerpt: '不对，先跑测试再改' },
        draft: { trigger: '不对，先跑测试再改', rule: '', evidence: 'session abc123' } }
    ]
  },

  score: {
    total: 82,                      // 0..100，一位小数
    grade: 'B',                     // A>=85, B>=70, C>=55, D<55
    confidence: 0.9,                // 0..1
    delta: null,                    // 与上次扫描总分差，可 null
    dimensions: [
      {
        id: 'load',                 // load|disclosure|actionability|boundary|hygiene|evolution
        label: '按需加载',
        score: 16.5, max: 20,
        summary: '触发面可选中，窗口内未发生按需加载',
        items: [
          { id: 'load.trigger', label: '触发可选中性', score: 9, max: 12,
            detail: '描述含 Triggers，触发词 8 个；超过目录上限 500 字符会被截断' }
        ]
      },
      {
        id: 'evolution', label: '持续进化', score: 6, max: 10, applicable: true,
        summary: '有真实调用，经验已沉淀但早于最近信号',
        items: []
      }
    ]
  },

  verdict: {
    code: 'watch',                  // keep|watch|merge|archive
    label: '观察',
    reason: '分数 82 尚可，但 30 天内 0 次调用，且与 deep-research 有 0.31 重叠'
  },

  findings: [
    {
      id: 'disclosure.body-too-large',
      dimension: 'disclosure',
      severity: 'major',            // critical|major|minor|info
      title: 'SKILL.md 过大，渐进披露不足',
      detail: '正文 65335 字符（约 17000 tokens），远超单次加载预算；模型一旦加载会整篇进上下文。',
      evidence: { file: 'SKILL.md', line: 1, excerpt: '...前 160 字...' },
      suggestion: '把 3 个参考型章节拆到 references/，正文只留入口与决策表。',
      actionIds: ['fix.extract-sections']
    }
  ],

  suggestions: [
    {
      id: 'fix.extract-sections',   // 与 action ids 对应
      kind: 'auto',                 // auto|draft|manual
      title: '把 3 个参考型章节拆到 references/',
      why: '正文预计减少 12000 tokens，保留入口可读性；原文件会备份，可撤销。',
      risk: '低：原内容逐字搬移，不删改。',
      action: { type: 'extract-sections', params: { sections: ['...'] } },
      preview: { before: '...', after: '...' } // 可省略；有则 UI 展示
    }
  ],

  overlaps: [
    { name: 'deep-research', score: 0.31, sharedTriggers: ['research', 'literature'] }
  ]
}
```

`findings[].actionIds` 与 `suggestions[].id` 必须能对上；没有可执行动作时 `actionIds: []`。

### 2.2 Portfolio

```js
{
  generatedAt: 1794000000000,
  rubricVersion: '1.0',
  windowDays: 30,
  sessionsScanned: 68,
  usageAvailable: true,
  catalogDescriptionMaxLength: 500,
  totals: {
    skills: 35,
    avgScore: 76.3,
    grades: { A: 6, B: 15, C: 10, D: 4 },
    catalogTokens: 4200,            // 每次会话固定注入的 name+description 估算
    fullLoadTokens: 210000,         // 若把所有 SKILL.md 全加载的代价
    zeroUse: 12,
    referenceFiles: 180,
    bySource: { 'user-agents': 28, custom: 7 },
    evolution: { skillsWithLessons: 3, lessonsTotal: 7, pendingSkills: 5, signalsTotal: 41 }
  },
  previous: { generatedAt: 1793000000000, avgScore: 74.1 } | null,
  deltaAvg: 2.2 | null,
  skills: [SkillReport, ...],       // 按 total 升序（最差在前）
  overlaps: [
    { a: 'grilling', b: 'auto-grill', score: 0.72, sharedTriggers: ['拷问', 'grill'], verdict: 'merge-candidate' }
  ],
  quickWins: [
    { name: 'academic-paper', actionId: 'fix.extract-sections', title: '...', gain: 18 }
  ],
  evolution: [
    { name: 'x', pendingScore: 7, lastSignalAt: 1794000000000, lessons: 2, linked: true,
      draft: { trigger: '…', rule: '', evidence: 'session abc123' } }
  ],
  issues: {
    zeroUse: ['x', 'y'],
    truncated: ['academic-paper'],
    brokenLinks: [{ name: 'x', href: '...' }],
    dangerous: [{ name: 'x', pattern: 'curl | sh' }]
  }
}
```

## 3. 核心模块导出（core 必须实现）

### 3.1 `lib/frontmatter.js`

```js
export function parseSkillMarkdown(raw) // -> { data: {name,description,whenToUse,...}, body: string, bodyStartLine: number }
// 支持 --- 包裹的 YAML 子集：顶层 key: scalar、单/双引号、| 与 > 块、description 折行。
// 缺 frontmatter / 非法时 throw Error（code: 'invalid-frontmatter'）。
export function replaceField(raw, key, value) // -> newRaw；只替换该顶层键，保留其余字节；不存在则插到 frontmatter 末尾
export function quoteYaml(value) // -> 单行 YAML 双引号字符串
```

### 3.2 `lib/metrics.js`

```js
export function extractMetrics({ body, files }) // -> metrics 对象（见 2.1，overlap 相关字段由 analyze 填）
// files: [{ path, chars }] 相对 skill 目录，含 references/**
// 纯函数，不读盘。
```

### 3.3 `lib/util.js`

```js
export function estimateTokens(text)      // CJK 1 字≈1 token，其余 ≈ 4 字符/token
export function slugify(text)             // ASCII slug；中文回退为拼音无关的稳定短哈希
export function jaccard(aSet, bSet)
export function triggerTokens(text)       // 中英混合触发词组集合（含 CJK bigram）
```

### 3.4 `lib/analyze.js`

```js
export const RUBRIC_VERSION = '2.0';
export function analyzeSkill(input) // -> SkillReport
// input: { summary, raw, body?, files, usage, siblings, options, mtime, previousTotal? }
// summary: { name, description, whenToUse, source, provider, path, dir }
// siblings: [{ name, description }]
// options: { catalogDescriptionMaxLength, now, sessionSpanDays }
// raw 缺失时 coverage='partial'，只用 summary+body 做有限评分，confidence<=0.5。
export function buildPortfolio(reports, meta) // -> Portfolio
// meta: { generatedAt, windowDays, sessionsScanned, usageAvailable, options, previous }
```

### 3.5 `lib/usage.js`

```js
export async function collectUsage({ sessionsDir, windowDays, now })
// -> { byName: { [name]: { count, lastUsedAt } },
//      signals: { [name]: { loads, sessions, reloads, postLoadErrors, corrections, asks,
//                           turnFailures, lastLoadAt, lastSignalAt, samples } },
//      prompts: { [name]: [{ at, sessionId, text }] },
//      sessionsScanned, spanDays, available }
// signals/prompts 的解析规则见 EVOLUTION-SPEC.md §2；失败不抛。
// 读 sessionsDir 下 **/*.jsonl.zstd 与 *.jsonl，按 mtime 过滤窗口；
// 统计 type==='tool/call' && data.name==='skill' 的 arguments.name。
// zstd 解压：优先 node:zlib 的 zstdDecompressSync；多帧时按 magic 28 B5 2F FD 分帧；
// 失败不抛，available=false 或跳过该文件（在返回里记 skipped 数）。
```

### 3.6 `lib/fixes.js`

```js
export function planFixes({ report, raw, files, actionIds })
// -> { actions: [{ id, type, title, writes: [{ path, content }], note }], skipped: [{id, reason}] }
// path 为相对 skill 目录的 POSIX 路径；只允许 SKILL.md 与 references/**。

export async function applyPlan({ plan, skillDir, backupRoot, now })
// 写盘 + 备份。-> { backupId, backupDir, changed: [{ path, beforeChars, afterChars }], diff }
// 备份目录：<backupRoot>/<backupId>/manifest.json + files/<相对路径>（原内容，含不存在标记）。

export async function undoBackup({ backupRoot, backupId }) // 省略 id 用最新
// -> { backupId, restored: [path], removed: [path] }

export async function listBackups(backupRoot) // -> [{ id, createdAt, skill, actions, files }]

export function diffText(before, after, contextLines=3) // unified-ish string，给 UI 展示
```

### 3.7 `lib/report.js`

```js
export function renderMarkdown(portfolio, { detail = true } = {}) // -> string（中文报告）
```

### 3.8 `lib/evolution.js`

```js
export const LESSONS_PATH = 'references/lessons.md';
export function parseLessons(raw)                 // -> { count, latestAt, entries }
export function composeLessonEntry({ at, trigger, rule, evidence }) // -> string
export function buildEvolution({ signals, loads, lessons, linked, prompts, description, now })
// -> { applicable, loads, lessons, signals, pending, promptRecall, proposals }（见 EVOLUTION-SPEC.md §4）
```

### 3.9 `lib/score.js`

内部实现，core 自定；但必须满足 `RUBRIC.md` 的维度、权重、阈值，并导出：

```js
export function scoreSkill(metrics, context) // -> { total, grade, confidence, dimensions, findings, suggestions, verdict }
```

## 4. Host 路由契约（host 实现）

前缀：`/api/skills-360`。所有响应统一：

```js
成功: { ok: true, data: ... }
失败: { ok: false, error: { message, code } }
```

鉴权：与 github-manager 相同，`ctx.get('connection').requestRejection({headers})` 非空即 401；缺 connection 服务 → 503。

| 方法 | 路径 | 入参 | data |
|---|---|---|---|
| GET | `/scan` | query `refresh=1`、`windowDays=30` | Portfolio |
| GET | `/skill` | query `name` | SkillReport + `{ body, raw, lastBackup }` |
| POST | `/apply` | `{ name, actionIds: string[] }` | `{ backupId, changed, diff, report }` |
| POST | `/apply-all` | `{ name?, safeOnly=true }` | `{ backupId, applied: [{name, actions}], skipped, report? }`（name 省略=全部 skill） |
| POST | `/undo` | `{ backupId? }` | `{ backupId, restored, removed }` |
| GET | `/backups` | — | `[{ id, createdAt, skill, actions, files }]` |
| POST | `/export` | `{}` | `{ path, markdown }` |
| POST | `/evolve` | `{ name, lesson: {trigger, rule, evidence?}, dryRun? }` | `dryRun=true` → `{ dryRun, plan }`；写入 → `{ dryRun:false, backupId, changed, diff, beforeTotal, afterTotal, lesson, report }` |

约束：
- 扫描结果缓存 60s；`refresh=1` 或 apply/undo 后失效。
- `/apply` 的 `actionIds` 必须是该 skill 当前 `suggestions` 的子集；未知 id → 400。
- 写入只允许 `report.dir` 内的 `SKILL.md` 与 `references/**`（plan 层已限制，host 再校验）。
- 并发 apply 串行化（单 Promise 队列）。
- 备份根：`<DSH_HOME>/skills-360/backups`；报告导出：`<DSH_HOME>/skills-360/reports`。
- 错误码：`not-found` `invalid-argument` `unsafe-path` `no-actions` `internal` `unavailable`。

## 5. Agent 工具契约（host 实现）

| 工具名 | 参数 | 返回 |
|---|---|---|
| `skills360_scan` | `{ windowDays?: int, refresh?: bool, cwd?: string, detail?: 'summary'\|'full' }` | 文本+JSON：totals、skills（summary 时只含 name/score/grade/verdict/usage/topFinding）、overlaps、quickWins |
| `skills360_report` | `{ names?: string[], detail?: bool, save?: bool }` | Markdown 文本；save=true 时同时落盘并返回路径 |
| `skills360_optimize` | `{ names?: string[], actionIds?: string[], safeOnly?: bool, dryRun?: bool }`（dryRun 默认 **true**） | 计划/执行结果：每个 skill 的应用动作、备份 id、分数变化；dryRun 不写盘 |
| `skills360_evolve` | `{ names?: string[], name?: string, lesson?: {trigger, rule, evidence?}, dryRun?: bool, cwd?: string }`（dryRun 默认 **true**） | dryRun：待闭环提案（证据 + 草稿，≤10）；写入：backupId、before/after、新的 `report.evolution` |

工具描述必须写清触发场景（这是插件自己的“按需加载”示范）。

## 6. Client UI 契约（ui 实现）

- 侧栏：`sidebar.panellist`，id `skills-360`，order 40，图标现有 SVG 风格。
- 主区：`main`，key `skills-360`。
- 只用 `react`（`React.createElement`）与全局 CSS 变量（`--dsw-alias-*`、`--dsh-font-family-code`），不引第三方依赖。
- 数据：`fetch(API + '/scan')`、`/skill?name=`、POST `/apply` `/apply-all` `/undo` `/export`。
- 必须覆盖：加载中、错误、空目录、列表、详情、应用成功/失败提示、撤销按钮、搜索/筛选（grade/verdict/source/仅看有问题）。
- 中英文案：`ctx.locale.register('skills-360', { zh, en })`；分析文本来自 core（中文），不做二次翻译。
- 详情页展示：总分/等级/置信度、6 维条形（`applicable=false` 显示“不评分”）、关键 metrics、findings（按严重度）、suggestions（auto 有“一键优化”，draft 标注“生成草稿”，manual 只读）、overlaps、路径。
- 详情页必须有「持续进化」区块：经验数/最近日期/是否接进入口、信号计数、待闭环提案与证据；「沉淀经验」编辑器（trigger 预填、rule 必填、evidence 预填）通过 `POST /evolve` 写入；`fix.add-lesson` 建议走同一编辑器，不直接 `/apply`。
- 列表行在 `report.evolution.pending.hasUnclosed` 时显示「待进化」徽标。
- “全部安全优化”只应用 auto 动作；执行前用 `window.confirm` 确认。
- 每次写操作后刷新 scan 与详情；显示 backupId 与“撤销上次”。

## 7. 验收命令

```bash
cd .../skills-360
node test/run-all.mjs          # core + host + client 全部
node --check index.js && node --check client.js
```

真实环境：

```bash
curl -s 'http://127.0.0.1:58792/api/skills-360/scan?refresh=1' | head -c 500
```

面板需刷新页面后出现在侧栏。
