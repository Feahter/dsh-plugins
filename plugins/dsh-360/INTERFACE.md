# dsh-360 接口契约（v1，冻结）

合并 `skills-360` + `agents-360` 为一个插件：**一个包、一套宿主、一个面板、两个体检面（surface）**，
并统一 **S~E × ±（18 档）** 等级制。本文件是 core / host / ui / packaging 四方并行开发的唯一事实源。

插件根：`/Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/dsh-360`
来源（只读，供移植）：
- `~/Documents/deepseek-harness/default-workspace/skills-360/`
- `~/Documents/deepseek-harness/default-workspace/agents-360/`

## 0. 文件所有权

| 路径 | 所有者 | 说明 |
|---|---|---|
| `lib/grade.js` | Lead（已写好，勿改阈值） | 18 档等级唯一真源 |
| `lib/skills/**`、`lib/agents/**`、`lib/usage.js`、`lib/util.js`、`lib/similarity.js`、`lib/frontmatter.js`、`test/{grade,skills,agents}.test.mjs` | core | 两套评分内核 + 共享工具 + 单测 |
| `lib/host-skills.js`、`lib/host-agents.js`、`index.js`、`test/verify-host.mjs` | host | 两个 surface 的宿主实现与统一入口 |
| `client.js`、`test/verify-client.mjs` | ui | 单面板 + 双 tab |
| `package.json`、`cordis.patch.yml`、`README.md`、`RUBRIC.md`、`INTERFACE.md`、`icon.svg`、`test/run-all.mjs`、`scripts/**` | packaging | 打包、文档、仓库登记 |

只写自己范围内的文件。

## 1. 统一等级制（S~E × ±，18 档）

`lib/grade.js` 是唯一实现，**任何地方不得再写死阈值**：

```
S+ ≥96   S ≥93   S- ≥90
A+ ≥87   A ≥84.5 A- ≥82
B+ ≥79   B ≥75.5 B- ≥72
C+ ≥68   C ≥64   C- ≥60
D+ ≥55   D ≥50   D- ≥45
E+ ≥37   E ≥28   E- ≥0
```

`gradeFor(total)` → `{ code:'A+', letter:'A', tier:'+', label:'A+ 优秀', labelEn, rank:0..17, min, max }`。
`rank` 越小越好（S+=0）。`compareGrades(a,b)`、`GRADE_CODES`、`GRADE_LETTERS` 也要导出。

**数据形状**：两个 surface 的 `report.score` 必须同时给：

```js
score: {
  total: 86.4,
  grade: 'A',        // code，18 档（如 'A+' / 'B-'）
  letter: 'A',       // 粗粒度字母（S/A/B/C/D/E），用于筛选与汇总
  tier: '',          // '+' | '' | '-'
  rank: 4,           // 0..17
  confidence: 0.9,
  delta: null,
  dimensions: [...]
}
```

`Portfolio.totals.grades` 改为按字母计数 `{ S:0, A:0, B:0, C:0, D:0, E:0 }`；
`Portfolio.totals.gradeCodes` 可选，按 18 档计数。`verdict` 判定仍用数值阈值，不变。

## 2. 目录结构

```
dsh-360/
  index.js client.js package.json cordis.patch.yml icon.svg
  lib/
    grade.js util.js similarity.js frontmatter.js usage.js
    skills/{analyze,metrics,score,fixes,evolution,report}.js
    agents/{collect,analyze,metrics,score,fixes,evolution,report,conflicts}.js
    host-skills.js host-agents.js
  test/{run-all.mjs, grade.test.mjs, skills.test.mjs, agents.test.mjs, verify-host.mjs, verify-client.mjs}
  scripts/
```

- `lib/skills/**`、`lib/agents/**` 由 core 从两个源插件移植；**只改 import 路径与 grade 接线，不改评分口径**。
- 两个 surface 沿用各自原有的数据形状（SkillReport / AgentSubjectReport、Portfolio），字段名不变；
  唯一变化是 §1 的 grade 三字段（`grade` 变 18 档 code，新增 `letter`/`tier`/`rank`）。

## 3. 共享模块

```js
// lib/usage.js —— 一次扫盘，产出两套 surface 都能用的 digest（并集）
export async function collectUsage({ sessionsDir, windowDays = 30, now = Date.now() })
// -> { sessionsScanned, spanDays, available, skipped,
//      sessions: [{ id, cwd, preset, model, startedAt, injected: [absPath],
//                   delegatedLabels: [], skillLoads: [skillName],
//                   toolErrors, corrections, asks, turnFailed }],
//      bySkill: { [name]: { count, lastUsedAt } },
//      signalsBySkill: { [name]: {...} },  promptsBySkill: { [name]: [...] },
//      signalsByPath: { [absPath]: {...} }, byPreset: { [preset]: {...} } }
import { gradeFor, gradeCode, compareGrades, GRADE_CODES, GRADE_LETTERS } from './grade.js';
```

`lib/taxonomy.js`（四轴分类，v0.2）与 `lib/client-cache.js`（快照/效果，v0.2）是新增共享模块；`lib/util.js` / `similarity.js` / `frontmatter.js` 直接复用 skills-360 版本（agents 需要的
`parseSkillMarkdown`、`overlapTokens`、`jaccard` 已覆盖）；如需补 helpers 只允许新增导出。

## 4. Surface 宿主契约（host 实现）

```js
// lib/host-skills.js / lib/host-agents.js
export function createSkillsSurface({ ctx, config, paths }) // -> SkillsSurface
export function createAgentsSurface({ ctx, config, paths }) // -> AgentsSurface

// Surface: {
//   id: 'skills' | 'agents',
//   routePrefix: '/api/dsh-360/skills' | '/api/dsh-360/agents',
//   routes: [{ kind:'prefix', path, handler }],
//   scan({ windowDays, refresh, cwd, kind }),      // -> Portfolio
//   detail({ name } | { id }),                      // -> report + raw
//   apply(...), applyAll(...), undo(...), backups(), exportReport(...), evolve(...),
//   invalidate()
// }
```

`paths`（host 统一构造）：`{ home, dataDir, backupDir: <data>/backups/<surface>, reportDir: <data>/reports, statePath: <data>/state.json }`。

`index.js`：

- `export const inject = ['skills', 'tools', 'webServer']`；`apply(ctx, config = {})`。
- 配置：`{ windowDays=30, catalogDescriptionMaxLength=500, backupsKeep=20, evolution=true, roots=[], maxDepth=6 }`（手写校验，无 schema）。
- 注册全部路由（两个 prefix）；`GET /api/dsh-360/health` 返回 `{ surfaces: ['skills','agents'], version }`。
- 注册 4 个统一工具（§5）。
- DSH_HOME = `process.env.DSH_HOME || ~/.dsh`；数据根 `<DSH_HOME>/dsh-360/`。

## 5. 工具契约

| 工具 | 参数 | 说明 |
|---|---|---|
| `dsh360_scan` | `{ surface?: 'skills'\|'agents'\|'both'=both, windowDays?, refresh?, cwd?, detail?: 'summary'\|'full', kind? }` | 返回 `{ surfaces: { skills?: Payload, agents?: Payload } }`，每个 Payload 为该 surface 的 totals + subjects（summary 精简：role/kind/scope/state + summary，不含 tags/明细）+ quickWins；conflicts/overlaps 的**计数**在 totals，明细只在 detail="full" 与报告中 |
| `dsh360_report` | `{ surface=both, names?, ids?, detail?, save? }` | 中文 Markdown；两 surface 分节；save=true 落 `<data>/reports/dsh-360-<stamp>.md` |
| `dsh360_optimize` | `{ surface: 'skills'\|'agents', names?, ids?, actionIds?, safeOnly=true, dryRun=true }` | dryRun 默认 true；写盘前备份 |
| `dsh360_evolve` | `{ surface, names?, ids?, name?, id?, lesson?: {trigger,rule,evidence?}, dryRun=true }` | dryRun 返回待闭环提案（≤10/面） |

工具描述必须写清「何时用」，并说明 `surface` 语义（skills=技能目录；agents=说明书/子代理定义/预设）。

## 6. Client 契约

- 侧栏 `sidebar.panellist`：id `dsh-360`，order 41，label「360 体检」；主区 `main` key `dsh-360`。
- 单面板，顶部双 tab：`技能` / `Agents`，各自保留原面板能力（列表/筛选/详情/优化/撤销/导出/进化编辑器），
  API 前缀改为 `/api/dsh-360/skills/*` 与 `/api/dsh-360/agents/*`。
- 等级展示用 `score.grade`（18 档 code）；筛选按 `score.letter`（S/A/B/C/D/E）；颜色：S 金、A 绿、B 蓝、C 琥珀、D 橙、E 红。
- CSS 保留两套前缀（`s360-`/`a360-`）但合并在一个 `<style data-plugin="dsh-360">`；locale NS `dsh-360`。
- 加载中 / 错误 / 空 / 部分失败（一个 surface 挂了另一个仍可用）都要有状态。

## 7. 仓库登记（packaging）

- `package.json`：name `dsh-360`、version `0.2.0`、`dsh.bundle.patch`、`dsh.client`（platform web、immediately、三个 client 依赖）、`files` 覆盖 index.js/client.js/lib 等。
- `cordis.patch.yml`：`insert: [{ id: dsh-360, name: 'dsh-360', config: {...} }]`。
- `README.md`：两个 surface 的能力、18 档等级表、安装、工具/路由、写入边界、局限。
- `RUBRIC.md`：合并两套 rubric（skills 六维 / agents 六维）+ §1 等级表 + verdict 规则。
- `index.json`（仓库根）：新增 `dsh-360` 条目（title/description 中英、icon、author/homepage/repository、category `context-engineering`、keywords、labels `experimental`、`versions[0]` 的 git source commit 在提交后回填）。
- 仓库根 `README.md` 插件表新增一行。
- git：分支 `feat/dsh-360`，提交；push 前把 index.json 的 commit 填成真实提交哈希（用户已授权 push）。

## 8. 验收

```bash
cd /Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/dsh-360
node test/run-all.mjs     # grade + skills core + agents core + host verify + client verify
node --check index.js && node --check client.js
```

真实环境（装进 desktop profile 后）：

```bash
# 侧栏「360 体检」；两个 tab 各自出数
# 工具：dsh360_scan / dsh360_report / dsh360_optimize / dsh360_evolve
```

## 9. v0.2 增量（分类标签 / 秒开 / 效果）

v0.2 不破坏 v1 契约，只增字段与路由参数。

### 9.1 分类（`lib/taxonomy.js` 单一来源）

每个 skill report / agent subject 增加：

```js
classification: {
  role:  { id, label, confidence, evidence },   // 10 个职责 id，见 TAXONOMY-SPEC.md
  layer: { id, label, confidence, evidence },   // skills only：meta | task
  kind:  { id, label },                         // skills: layered|scripted|routing|prose；agents: instruction|agent|preset
  scope: { id, label },                         // bundled|global|project|skill|profile|custom
  state: [{ id, label }],                       // active|idle|unobserved|pending|overlap|critical|stale-ref|conflict
  summary: string,                              // ≤60 字人话
  tags: string[]                                // axis:value，稳定 id
}
```

portfolio 增加 `taxonomy: { version, axes[] }`、`totals.byRole/byLayer/byKind/byScope`、`trend: { generatedAt, previousGeneratedAt, avgDelta, itemsChanged }`。
`tags` 与 `classification` 同源；client 不得自行推断标签。

### 9.2 列表视图 `GET /scan?view=list` / 快照 `GET /scan?quick=1`

返回最近一次扫描的**列表快照**（`stale: true`、`cachedAt`），不含 body/findings/suggestions/metrics/dimensions（冲突/重叠最多各 60 条）；详情仍走 `/skill` 或 `/subject`。
没有快照时返回 404 `not-found`。这是面板首屏路径：先画快照，再请求 `?view=list` 的新鲜列表并替换。
`view=list` 与快照同形（allow-list，不含 body/findings/suggestions/metrics），但 `stale` 不置位；详情仍走 `/skill` 或 `/subject`。
不带这两个参数的 `/scan` 保持 v1 的全量 portfolio，供工具与兼容调用方使用。

### 9.3 apply / apply-all / optimize(dryRun=false)

响应增加：

```js
effect: {
  surface, at, items,
  scoreBefore, scoreAfter, delta,
  tokensBefore, tokensAfter, tokensSaved,   // 可为负：抽取引用后常驻 token 略增时如实显示
  gradeUps, verdictChanges,
  targets: [{ key, before, after, delta, gradeBefore, gradeAfter }]
}
```

效应同时落到 `<data>/cache/<surface>-last-apply.json`；下一次 `/scan` 在 portfolio 上带 `lastApply`，撤销后清空。
快照写在 `<data>/cache/<surface>-portfolio.json`，只含列表字段（allow-list，见 `lib/client-cache.js`）。

### 9.4 Client

- 挂载只请求当前 tab 的 surface；另一面在首次切换时请求。
- 每个 surface 先 `?quick=1` 画快照（带「更新于 X / 正在刷新」），随后全量替换；404 时直接全量。
- 分类筛选按轴分组（职责/类型/范围/等级），标签文案取自 `taxonomy`，不得写死。
- 效果卡展示 `effect` 或 `lastApply`：分数 before→after、delta、token 变化（负值显示为「增加」）、可撤销。

### 9.5 性能

`lib/usage.js` 的 `collectUsage` 进程内单飞 + 30s TTL（两 surface 共用一次解析）；冲突检测预计算，见 README「性能」。
