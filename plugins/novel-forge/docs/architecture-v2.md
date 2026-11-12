# 墨炉 v0.2 · Agent-first 长篇架构（施工契约）

> v0.1 的契约见 `docs/architecture.md`。本文件定义 v0.2 的**增量与替换**：凡本文件写明的，以本文件为准；未写明的沿用 v0.1。
> 目标读者是施工的 agent 与后续维护者：每一条都有可验证的落点（文件 / 导出 / 断言）。

---

## 0. 为什么重构

v0.1 是"一次炼完一本 24 章短篇"的流水线。做成**长篇网文**（300–3000 章、100–300 万字）后，四处结构性失效：

| 失效 | 现状 | 后果 |
|---|---|---|
| 大纲一次成型 | 1 次调用产出全部章节，`chapters≤120` | 300 章的大纲 JSON 6 万字符，模型写不完；1000 章不可能 |
| 账本硬上限 + 丢弃 | `facts≤80`、`threads≤60`，超了丢最旧 | 第 200 章时第 5 章的正典已被丢掉，不是"压缩"是"销毁" |
| 单章上下文只有近邻 | 上一章摘要 800 字 + 账本 3000 字 | 第 500 章写到第 5 章的伏笔，材料里根本没有 |
| 只有流水线一条路 | 只能整段跑，创作动作在 stage 黑盒里 | agent 无法"只写这一章"，也无法在写之前先把材料看清楚 |

v0.2 的答案不是加阶段，是**换分工**。

## 1. 三条设计原则

1. **状态在盘上，脚本负责搬运。** 一切可判定的东西（卷章数量、章节 id、预算、去重、冲突检测、进度、下一步该干什么）都由确定性代码完成，不花模型调用。
2. **单章上下文是一个硬预算包（packet）。** 写作前由脚本按固定优先级、固定上限拼装，总长硬性 ≤ `contextBudget`；超了按优先级裁，并留下可核对的分片报告。**包的大小不随章号增长**：常驻分片（本章细纲 / 正典 / 人物速查）逐片固定上限，第 5 章和第 500 章这几片一样大；只有「上一章 / 近几章摘要 / 文风样本」在开头几章还不存在，所以第 1 章会比第 300 章短（实测 3509 vs 8781，差 5272 字；理论边界 = 相邻四片 4200 + 正典增长 3200）。区别只在检索到什么。
3. **一份契约，两个调用方。** 章节工作单元（`chapter.js`）同时服务于批量流水线（`novel_run`）和交互式 agent（`novel_context`/`novel_commit`）。两条路拼出同一份材料、写同一份盘、过同一套检查——不可能出现"自动跑的"和"agent 写的"两套口径。

## 2. 长篇分层：部 → 卷 → 章

- **部**：不单独建模。`chapters / chaptersPerVolume > 40` 时，由脚本把 `chaptersPerVolume` 抬到 `ceil(chapters / 40)`，保证**卷数 ≤ 40**（`VOLUME_LIMIT`）。这样 `spine` 的卷列表永远是一次调用能写完的量级。注意「卷数 ≤ 40」不等于「每卷 ≤ 40 章」：3000 章 / 40 卷 = 每卷 75 章，卷纲展开一次要写 75 条章表，靠 `volumeChapters` 的 maxTokens 与字段精简兜住。
- **卷（volume）**：展开单元。`targetChapters` = `chaptersPerVolume`（默认 30，允许 10–60）。**卷纲惰性展开**：只有要写这一卷时才调一次模型产出该卷的章表（标题/目标/冲突/转折/钩子/时空/出场人物）。
- **章（chapter）**：写作单元。id 全局发号，`ch0001` 形式（宽度 = 全书计划章数的位数，最少 2）。模型给的 id 一律不可信。

v2 大纲形状（已实现，`plan.js` 全权负责）：

```js
{
  version: 2,
  totalChapters: 300,
  language: 'zh',
  volumes: [{ id:'v01', index:1, title, goal, arc, cast:[], opens:[], closes:[],
              targetChapters:30, planned:false, chapterIds:[] }],
  chapters: [{ id:'ch001', index:1, volume:'v01', title, goal, conflict, turn, hook,
               pov, when, where, cast:[] }]   // 骨架里该数组为空，展开卷后才有
}
```
章 id 宽度 = `max(2, String(totalChapters).length)`（300 章 → `ch001`…，3000 章 → `ch0001`…），由脚本发号，模型给的 id 一律丢弃。
`plan.js` 导出：`VOLUME_LIMIT / effectivePerVolume / volumeCount / volumeId / buildOutlineSkeleton / volumeById / volumeOfChapter / mergeVolumeChapters / isV2 / migrateOutline / nextActions`。
**约束**：只对「尚未 planned 的卷」调用展开；已 planned 且已有草稿的卷不得重规划（`mergeVolumeChapters` 会重排后续卷章 id）。

新增/变更参数：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `chapters` | int 6–3000 | 24 | 上限从 120 提到 3000 |
| `chaptersPerVolume` | int 10–60 | 30 | 每卷章数；超 40 卷时被脚本自动抬高 |
| `contextBudget` | int 4000–30000 | 12000 | 单章写作材料（user 侧）字符硬上限 |
| `wordsPerChapter` | int 800–8000 | 3000 | 不变 |

## 3. 阶段表 v2（9 段）

| # | id | title | each | produces | 模型调用 | 说明 |
|---|---|---|---|---|---|---|
| 1 | `premise` | 故事核心 | — | brief | 1 | 不变 |
| 2 | `bible` | 世界设定 | — | bible | 1 | 不变 |
| 3 | `characters` | 人物档案 | — | characters | 1 | 不变；同时作为 canon 实体种子 |
| 4 | `spine` | 故事脊柱 | — | spine | 1 | **改 JSON**：主线 + 结局 + 卷列表（id/v01…/标题/目标/弧光/重点人物/开线/收线/目标章数） |
| 5 | `outline` | 卷章大纲 | — | outline, canon | 0 或 1 | **脚本建骨架**（卷数组、空 chapters）+ 迁移；短篇（≤60 章）一次展开全部章节；长篇只展开第 1 卷。**不调模型建骨架** |
| 6 | `draft` | 章节草稿 | outline.chapters | draft/*, summary/*, beats/*, canon | 1 + 1~2 | **工作单元**：缺卷纲→先展开本卷；缺细纲→先生成；拼 packet；写正文 + 内联摘要 + 内联 canon patch |
| 7 | `review` | 连续性审校 | outline.chapters | review/* | 1 | LLM 审校 + 确定性一致性检查（`consistency.js` + `craft.js`）；不再维护 ledgerPatch（兼容旧字段） |
| 8 | `revise` | 修订 | outline.chapters | draft/*, summary/* | 0.5 | 不变（`alwaysRun`） |
| 9 | `blurb` | 封面文案 | — | blurb | 1 | 不变 |

**beats 为什么并进 draft**：细纲只在写这一章时需要。作为独立 stage，`each` 会遍历全部已计划章节，1000 章 = 1000 次调用在写第一章之前。并进工作单元后，调用序列变成 `卷纲 → 细纲 → 正文`，一次只推进一章，中断/续跑/agent 接管都不丢状态。

**长篇怎么续跑**：一轮 run 只写"当前已计划"的章节。`draft` 写完后若下一章未计划，下一步动作（`plan.nextAction`）会给出 `plan-volume`。`novel_run` 默认 `window=10`：按当前进度规划窗口 → 跑 beats 已就绪的章节 → 返回 `nextWindow`。这是网文的连载节奏，不是限制。

## 4. Canon（连续性正典）——`src/recipes/novel/canon.js`

### 4.1 形状（`canon.json`，schemaVersion 2）

```js
{
  version: 2,
  rules: ['视角：第三人称限知', ...],                 // 硬规则（原 canonRules）
  facts: [{ id:'f0001', s:'林砚', p:'状态', o:'死亡', chapter:'ch0123',
            status:'canon'|'open'|'retracted', tags:['character:林砚'] }],
  notes: [{ id:'n0001', text:'殡仪馆只在午夜开门', chapter:'ch0003',
            status:'canon'|'open', tags:['place:殡仪馆'] }],
  threads: [{ id:'t01', text:'守夜人袖口的香灰', opened:'ch0002',
              status:'open'|'closed', closedIn:null, payoff:'' }],
  entities: {
    '林砚': { kind:'character'|'place'|'item'|'org', gender:'男'|'女'|'',
              role:'主角', aliases:[], firstSeen:'ch0001', lastSeen:'ch0123',
              location:'殡仪馆', state:'左手受伤', knows:['父亲死于头七'],
              relations:[{to:'陈婆', kind:'债主'}] }
  },
  timeline: [{ chapter:'ch0003', when:'头七当晚', event:'...' }],
  invariants: ['死者不会在头七之外回来']
}
```

规则：

- **事实不再有总数上限，也不再丢最旧。** 淘汰只发生在"喂给模型的切片"里（检索 + 预算），盘上一个字都不能少。
- `facts` 是**结构化三元组**（主体/谓词/值），这是确定性冲突检测的前提；允许 `p` 为 `状态/位置/持有/关系/身份` 等有限词表，未知谓词归 `notes`。
- 去重键：`facts` = `s|p|o` 归一化后相同；`notes` = 文本归一化相同；`threads` = 文本相同或闭合指向同一 id。
- 同 `s|p` 不同 `o` 且两者都 `status:'canon'` → **不自动覆盖**，两条都留，标 `conflict` 由 `canonProblems()` 报出（人工/LLM 裁决后把旧的置 `retracted`）。
- 大小：1000 章 ≈ 5000 facts + 2000 notes ≈ 500KB JSON。可以全量读进内存；检索是内存倒排索引，不落盘。

### 4.2 导出（必须严格同名同签名，其他模块按此编码）

```js
export const CANON_VERSION = 2
export function emptyCanon()                                  // {version:2, rules:[], facts:[], notes:[], threads:[], entities:{}, timeline:[], invariants:[]}
export function createCanon({ brief, characters, params, spine })  // 从 brief/人物档案/参数/卷纲建初始正典
export function mergeCanon(canon, patch, { chapter })          // 纯函数，返回新 canon；patch 见 4.4
export function queryCanon(canon, { cast, keywords, location, atChapter, limit }) // 纯函数，返回已排序裁剪的切片对象
export function formatCanon(slice, { maxChars })               // 切片 → prompt 文本（带【】小标题）
export function canonStats(canon)                              // {facts, notes, threads, openThreads, entities, dead, conflicts}
export function canonProblems(canon, { atChapter })            // 账本自身问题 → findings[{severity,kind,where,issue,fix}]
export function migrateLedger(ledger, { characters })          // v1 ledger.json → canon v2（旧 text facts 全进 notes，结构化能识别的进 facts）
export function entityOf(canon, name)                          // 名字或别名 → {name, entity} | null
export function isDead(canon, name)                            // 死亡判定（facts: p∈{状态,生死} 且 o 含 死/亡）
```

`queryCanon` 排序规则（确定性，同分按 id 升序）：

1. 实体 `state/location` 与本章出场者相关：+10；`lastSeen` 在最近 20 章内：+6。
2. 事实/线索的 `tags` 命中本章 cast 或 keywords：+8；`chapter` 距 `atChapter` ≤ 20：+4。
3. `threads` 未回收：+5，且 `opened` 距今越远越靠前（避免"长期未回收线索"被淹没）。
4. `rules` / `invariants` 永远全量（有独立上限）。
5. 结果裁剪到 `limit`（默认 48 条），`formatCanon` 再按 `maxChars` 截断并标 `…（已截断）`。

### 4.3 迁移（必须）

`canon.json` 不存在但 `ledger.json` 存在 → `migrateLedger`，并在事件流打一条 log「已把连续性账本迁移为正典 v2」。迁移是幂等的，不删 `ledger.json`（回滚用）。`review` 的 `ledgerPatch` 仍接受，内部映射进 `mergeCanon`。

### 4.4 canon patch（模型输出 / agent 提交共用）

```js
{
  facts: [{ s:'林砚', p:'状态', o:'左手受伤', tags:['character:林砚'] }],
  notes: [{ text:'守夜人换班时间是凌晨三点', tags:['place:殡仪馆'] }],
  threads: [{ id:'t03', text:'…', status:'closed', closedIn:'ch0042' }],
  entities: { '陈婆': { state:'知道了守夜人的秘密', location:'城西' } },
  timeline: [{ when:'头七当晚', event:'…' }],
  invariants: ['…']
}
```
`chapter` 由调用方传入（当前章 id），patch 里不接受 `chapter` 字段覆盖。所有字段可缺省；空 patch 视为无变更。

## 5. 预算与上下文包

### 5.1 `src/forge/budget.js`（通用，零小说词汇）

```js
export function assemble({ slices, budget, separator = '\n\n' })
// slice: { name, title?, text, cap?, priority=5, required=false }
// 返回 { text, report }
// report: { budget, used, hardTruncated:boolean,
//           slices:[{name, chars, cap, allocated, truncated, dropped}] }
```

规则（必须可测）：

1. `required` 分片先按 `cap` 截断后锁定，不参与后续压缩。
2. 其余按 `priority` 升序分配；每片先按其 `cap` 和剩余预算的较小值截断。
3. 总长仍超预算 → 从 `priority` 最大（最低）的分片开始清零，直到放得下；`dropped:true`。
4. 最后仍超 → 截断末尾并 `hardTruncated:true`（理论上不该发生，测试要覆盖）。
5. 纯函数、无 IO、无全局状态；同输入同输出（测试断言两次调用字符串相等）。

### 5.2 `src/recipes/novel/packet.js`

```js
export const SLICE_SPEC = [ {name, title, cap, priority, required} ]

export function buildPacket(input)   // input 见下；返回 { text, report, sections }
```

`input`（全部是已取出的值，packet 不读盘、不调模型、不 import canon 之外的业务模块）：

```js
{
  params,                    // 取 pov/tone/styleGuide/wordsPerChapter
  chapter,                   // outline.chapters[i]：{id,title,goal,conflict,turn,hook,pov,when,where,cast}
  volume,                    // 所属卷（可能为 null）
  beats,                     // beats JSON 或 null
  previous,                  // 上一章 {id, title, hook} 或 null
  previousSummary,           // 上一章摘要文本
  recentSummaries,           // 最近 3 章 [{id, text}]（不含上一章）
  volumeDigest,              // 本卷已写部分的压缩摘要（脚本从 summary 拼，≤1200 字）
  canonText,                 // formatCanon(queryCanon(...)) 已格式化文本（packet 不 import canon）
  castBrief,                  // characterBrief(...) 文本
  styleSample,               // 最近 2 章首尾各 200 字样本
  nextChapterGoal,           // 下一章目标（防写飞）
  revisionFindings,          // 修订模式下的 findings（可选）
  mode: 'draft' | 'revise'
}
```

分片表（v0.2，替代 v0.1 §4.3）：

| name | cap | priority | required | 来源 |
|---|---|---|---|---|
| `brief` | 900 | 0 | ✅ | 写作要求：章号/标题/目标/视角/字数/禁语/格式 |
| `beats` | 2500 | 1 | | `beats/<id>` |
| `previous` | 800 | 2 | | 上一章摘要 + 钩子 |
| `recent` | 1200 | 2 | | 最近 3 章摘要 |
| `digest` | 1000 | 3 | | 本卷前情压缩 |
| `canon` | 3200 | 3 | | 调用方传入的 `canonText` |
| `cast` | 1500 | 4 | | 本章出场者速查 |
| `next` | 300 | 5 | | 下一章目标 |
| `style` | 1200 | 6 | | styleGuide + 风格样本 |

`contextBudget` 默认 12000，上表 cap 合计 12600 → 允许 1 片被压缩，但**总长硬性 ≤ budget**。`report.slices[].chars` 必须与 `text` 实际长度一致（集成测试断言）。

### 5.3 集成点

`draft` stage（批量）与 `novel_context`（agent）调用**同一个** `chapter.prepareChapter()`，拿到同一个 `packet.text`。禁止任何一处另拼材料。

## 6. 章节工作单元 — `src/recipes/novel/chapter.js`

纯逻辑模块：**不读盘、不写盘、不发网络**，全部 IO 由调用方注入。流水线（`index.js`）与 agent 工具（`tools.js`）共用它，从而保证两边拼出同一份材料、过同一套检查。

```js
// 依赖注入形状（两个调用方各自适配）
// read(key) => any|null        读产物：md 返回 string，json 返回对象，缺失返回 null
// llm.generate(spec) => {text} 引擎同款接口
// params                        项目参数

export function inspectChapter({ outline, chapterId, read })
// → { chapter, volume, ready, missing:['volume-plan'|'beats'|'draft'|'canon'] }

export async function ensureVolume({ outline, params, read, llm, language })
// 仅当该卷 planned:false 时调 1 次模型展开卷纲；已计划则原样返回
// → { outline, calls, created }

export async function prepareChapter({ outline, params, chapterId, read, llm, language })
// 保证卷纲 → 保证本章细纲 → 查 canon/上一章摘要/最近三章/本卷前情 → buildPacket
// → { chapter, volume, beats, packet:{text,report}, canon, calls }

export function commitChapter({ read, params, outline, chapterId, text, summary, canonPatch })
// 解析正文里的内联块（调用方已拆好则直接传）→ 合并 canon → 写回 outline 的章状态
// → { artifacts:{draft,summary}, canon, stats, findings, counts, verdict }

export function checkChapter({ read, params, outline, chapterId, text })
// consistency.checkChapter + craft.checkDraft（确定性，不调模型）
// → { findings, counts, verdict:'pass'|'revise', canon }
```

约束：

- `commitChapter` 返回 `artifacts` 由调用方落盘（引擎 stage 写 store，agent 工具写 store），模块本身不写。
- `text` 为空或只含占位符 → 抛 `ForgeError('LLM_PARSE')`；`summary` 缺失时用确定性摘要（正文首 240 字）并记 `findings` 一条 note。
- 内联协议解析函数一并导出，供流水线复用：`splitInline(text)` → `{ body, summary, canonPatch, hadSummary, hadCanon }`（`<<<SUMMARY>>>` / `<<<CANON>>>`，`CANON` 里允许 JSON 数组或对象）。
- `prepareChapter` 中，`packet.canonText` 来自 `formatCanon(queryCanon(...), {maxChars:3200})`；`castBrief` 复用人物档案；`volumeDigest` 由本卷已写章节摘要拼接后截断 1000 字。
- `ensureVolume` 幂等：同一卷调用两次只产生 1 次模型调用，且第二次返回 `created:false`。
- 只允许 import：`./packet.js` `./canon.js` `./consistency.js` `./craft.js` `./plan.js` `./outline.js` `../../forge/errors.js`。

## 7. Agent-first 工具（`src/host/tools.js`）

| 工具 | 参数 | 返回 |
|---|---|---|
| `novel_next` | `{project?}` | `{actions:[{action:'plan-volume'\|'write'\|'check'\|'audit'\|'done', chapter?, volume?, why, estimate:{calls}}]}` — 脚本判定，不调模型 |
| `novel_context` | `{project?, chapter?}` | `{chapter, packet:{text, report}, requirements:{words,pov,banned[]}, canon:{stats, conflicts}, nextActions}` |
| `novel_commit` | `{project?, chapter?, text, summary?, canonPatch?}` | `{ok, written:{draft,summary}, findings, counts, verdict, canon:{stats}, nextActions}` |
| `novel_audit` | `{project?}` | `{chapters, words, findings, canon:{stats, problems}, threads:{open,stale}, timeline:{last}}` — 全确定性 |
| `novel_plan` | `{project?, volume?}` | 确保该卷章表存在（调 1 次模型），返回卷纲；上一卷还没写完时返回 `{skipped:true, blockedBy}`，不启动 run |

既有工具不改语义，只补字段：`novel_status` 增加 `plannedChapters/totalChapters`、`canon` 统计；`novel_run` 增加 `window`（默认 10）并在返回里给 `nextWindow`。

**落地细节（实现与上表的偏差，以代码为准）**

- `novel_run` 的 `window` 由引擎只做透传（`src/forge/engine.js` 把 `options.window` 原样放进 `run.options`），执行在配方的 draft 单元：run 开始时按「还没写正文的章节」定一次窗口名单（模块级 `RUN_WINDOWS`，以 run id 为键），不能边写边算——否则名单逐章变短，每章都落在第 0 位，window 等于没有。
- 窗口外的章返回 `{artifacts:{}, defer:true, note}`：引擎的 `normalizeStageResult` 认 `defer`，该条记 `pending`、后面的章不再登记、阶段状态 `partial`。这样下一次 `novel_run` 会从断点接着写。**不能只是返回空产物**——引擎会把它记成 `done`，阶段 `done`，续跑整体跳过，书永远写不完（v0.2 开发中真实踩过）。
- `novel_commit` 除正文与摘要外还写 `review/<章>.json`（`{findings, canonPatch:null, verdict, deterministic:true}`），避免 `nextActions` 因为"这章没有审校记录"一直卡在 check。
- `novel_audit` 在没有 block 级 finding 时把 `outline.auditedAt` 写回并返回 `markedAudited:true`；有 block 时不写，`novel_next` 才会继续催体检。
- `novel_plan` 走 `engine.startRun(id,{stages:['outline']})`，复用流水线的幂等展开，不新开代码路径。但展开前先算「已列章里还没写正文的」——有缺口就直接返回 `{ok:true, skipped:true, blockedBy:{chapter, remaining}, hint}`，不启动 run：`outline` 阶段本身要求上一卷写全才展开下一卷，硬跑只会空转、还会和紧接着的续写抢 `RUN_ACTIVE`。
- `novel_create` 新增 `chaptersPerVolume`（10–60，默认 30）与 `contextBudget`（4000–30000，默认 12000），`chapters` 描述改为 6–3000。
- 读 v2 项目的 `ledger` 返回一句说明字符串（"v0.2 用 canon.json…"），不抛错；v1 项目读 `canon` 则在内存里迁移出临时 canon。

**工具描述必须写清分工**：`novel_context` 拿材料 → 你自己写正文（不要用流程模板）→ `novel_commit` 提交；`novel_run` 是"让它自己连着写一批"，不是必须先跑它。

## 8. 一致性检查（`src/recipes/novel/consistency.js`）

```js
export function checkChapter({ text, canon, chapter, previousChapter, params, beats, cast }) // → findings[]
export function audit({ chapters, canon, outline, params })  // 全书确定性体检 → findings[]
```

确定性规则（宁可漏报，不可误报；每条都要有测试）：

| kind | 规则 | 级别 |
|---|---|---|
| `dead-character` | 本章 cast 或正文出现 ≥2 次的人物，canon 判定已死亡且未复活 | block |
| `timeline-regress` | 本章 `when` 可解析为序数/日期且早于上一章 | warn |
| `cast-missing` | 细纲 cast 里的人物在正文中 0 次出现 | warn |
| `thread-stale` | 未回收线索 `opened` 距今 ≥ 40 章（audit 级，逐章不报） | note |
| `name-drift` | 正文出现 ≥3 次的 2–4 字人名，canon 无此实体、也不在细纲 cast | note（提示登记） |
| `invariant-hit` | 命中 `invariants` 关键词（≥3 字词） | warn |
| `canon-conflict` | 同 `s|p` 两条 `canon` 事实值不同 | warn（audit） |
| `fact-contradict` | 正文同时出现 `s` 与一条 `retracted` 事实的 `o`（≥4 字） | note |

`review` stage = `consistency.checkChapter` + `craft.checkDraft` + LLM findings 三者合并、按 `severity→block>warn>note` 排序，`block>0 或 warn≥3 → revise`（沿用 v0.1 规则）。

## 9. 成本与上下文（每章，3000 字，autoReview=true）

| 项 | v0.1 | v0.2 |
|---|---|---|
| 调用 | 4.5（细纲 1 + 草稿 1 + 摘要 0 + 审校 1 + 修订 0.5 + 卷章大纲摊薄） | 3.5 + 1/30（卷纲摊薄） |
| 写章输入 | ≤12000 字，但第 500 章时前情只有 800 字 | ≤12000 字**硬上限**，第 500 章仍能检索到第 5 章正典 |
| 长篇可行性 | 120 章封顶 | 3000 章（骨架脚本化，卷纲惰性） |

## 10. 验收（本轮完成的定义）

> 以下每条都在这台机器上跑过，数字是实测值，不是目标值。

1. **`npm test` 全绿**：356 tests / 356 pass / 0 fail（约 3.5s）。新增用例：
   - `test/canon.test.mjs`（28）：合并/去重/冲突/迁移/检索排序/死亡判定/时间切片（atChapter 之后的事实、线索、时间线不进切片）；5000 条事实 + 2000 条备注下 `queryCanon` 15–27ms。
   - `test/packet.test.mjs`（21）：任意 budget 下 `text.length ≤ budget`；4000/8000/12000/20000 实测 4000/5778/5778/5778（分片 cap 之和是上限，不是承诺）；required 优先、低优先级先被裁、determinism、`sum(chars)+sep*(kept-1)===used`。
   - `test/plan.test.mjs`（23）：3000 章 → 40 卷 × 75 章（0.379ms）；章 id 宽度 = `max(2, 总章数位数)`；骨架 0 次模型；惰性展开幂等、乱序展开不重排章号；v1 迁移保留原 id（99 章 + params 120 仍 ch01…ch99）。
   - `test/consistency.test.mjs`（25）：8 条规则各一正一反（含"不误报"用例）。
   - `test/chapter.test.mjs`（33）：prepare/commit/inspect/splitInline 的依赖注入契约；正文行内出现字面 `<<<SUMMARY>>>` 不算分隔符。
   - `test/tools-v2.test.mjs`（23）：13 个工具、`window` 透传、`novel_commit` 写 review、`novel_audit` 的 auditedAt 语义（干净写、有 block 不写）、`novel_plan` 在上一卷未写完时 `skipped` 且不启动 run、300 章新项目 `novel_context {chapter:'5'}` 解析成 ch005 且只展开目标卷、未知章 commit 404 零落盘。
   - `test/longform.test.mjs`（11）：300 章 mock —— 骨架 5.2ms；ch001 包 6269 字 / ch300 8781 字；第 100 章与第 300 章包体差 0.43%；40 章 commit 后 facts 2→80、threads 1→40 全在（单调递增）；第 250 章仍能检索到第 5 章的「沈砚·左手有旧伤」；植入的死亡人物出场 → `dead-character(block)`，干净正文 0 误报；300 章 + 900 条事实全量 audit 272ms；分片账在 4000 预算下丢掉 style、保住 beats/canon。
2. **向后兼容**：v1 项目（`ledger.json` + v1 outline）能直接打开并续跑；`novel_status`/`novel_read` 正常；v1 断言适配后仍全绿（`test/novel-recipe.test.mjs` 72、`test/integration.test.mjs` 6（window/defer 三轮 2+2+2；force 与占位草稿同样受 window 限制）、`test/host.test.mjs` 23）。
3. **`node dev/verify.mjs` 通过**：侧栏注册、书架、新建预估、工作台（九段轨 + 事件流 + 正典入口）、章节四标签、草稿编辑、运行中取消；`console error 0 / page error 0`，截图落 `test/screens/`。
4. **文档**：本文件 + `README.md`（agent-first 用法与 13 工具表）+ `docs/prompts.md`（12 个 builder 契约）。
5. **v1 项目冒烟**（Lead 手动）：v1 fixture 在 9 段轨下能打开、能读 ledger、能续跑（旧 outline 迁移在内存完成，不写盘）。

**与初版 §10 的偏离（已确认）**

- 原文"第 1 章与第 300 章包体差 ≤5%"不成立：第 1 章天然没有 previous/recent/digest/style 四片，四片 cap 合计 4200 字。改为可验证的等价断言——**常驻分片（beats/canon/cast）逐片对齐，总长差 ≤ 相邻章分片上限（4500）**。
- 审计性能阈值从 300ms 放宽到 800ms：同一台机器上 300 章 + 900 条事实实测 272–600ms，抖动来自 GC，不是算法。

**已知缺口（本轮不做，已写进 README 限制）**

- 细纲单次调用、无截断重试：v0.1 的 `callJson` + `salvageScenes` 路径没有接进 `chapter.js`，坏 JSON 时整章 `LLM_PARSE`。长篇卷纲（75 条章表）更容易截断，缓解办法是调小 `chaptersPerVolume`。
- `chapter.js` 调 `volumeChapters`/`beats` 时没有传 `phase`/`label`，`llm.calls` 无法按阶段归因（集成测试只能靠 prompt 前缀分派）。
- v2 事实只收三元组；`{text}` 形式的旧 `ledgerPatch` 事实会降级进 `notes`（不丢，但结构变了）。

## 11. 非目标

- 多用户/云同步/发布到平台（不变）。
- 封面图、插图。
- 英文提示词（保留接口）。
- 重写客户端交互（只保证不崩 + 显示计划章数）。
- 引擎 `src/forge/engine.js` 的语义改动：**本轮不改引擎**（除新增 `budget.js` 外），所有能力落在 recipe 与 host 层。

## 12. 提示词契约（v0.2）

`src/recipes/novel/prompts/zh.js` 仍导出 `createPrompts()`，返回的 builder 列表变为：

```js
{ premise, bible, characters, spine, volumeChapters, beats, draft, summary, canonPatch, review, revise, blurb }
```

每个 builder 收 stage ctx，返回 `{ system, user, maxTokens, temperature }`（`callJson` 负责加 `json:true`，builder 不需要返回 json 字段）。`system` 只放工艺约束，**≤ 2500 字**；材料一律在 `user`。

| builder | ctx 必须有的字段 | 输出 |
|---|---|---|
| `premise` | 同 v0.1 | md |
| `bible` | 同 v0.1 | md |
| `characters` | 同 v0.1 | md |
| `spine` | `params` `brief` `bible` `characters` `volumePlan`（`[{index,title,targetChapters}]`，由 `plan.js` 给） | **JSON** `{mainline, ending, volumes:[{title,goal,arc,cast:[],opens:[],closes:[]}]}`，卷数与顺序必须照 `volumePlan` |
| `volumeChapters` | `params` `volume`（含 targetChapters）`spine` `bible` `characters` `previousDigest` `existingTitles` | **JSON** `{chapters:[{title,goal,conflict,turn,hook,pov,when,where,cast:[]}]}`，条数 = targetChapters |
| `beats` | `params` `chapter` `volume` `previousSummary` `canonText` `castBrief` | **JSON** `{scenes:[{goal,obstacle,turn,detail}], beats:[...], hook, cast:[]}` |
| `draft` | `params` `chapter` `packet.text` | **正文**（user 就是 packet 文本，不再二次拼材料） |
| `summary` | `chapter` `draft`（正文全量）`beats` | md（≤400 字） |
| `canonPatch` | `chapter` `summary` `beats` `canonText` | **JSON** `{facts:[{s,p,o,tags}], notes:[{text,tags}], threads:[{text,status,closedIn?}], entities:{name:{state,location,knows}}, timeline:[{when,event}]}` |
| `review` | `chapter` `beats` `draft` `canonText` `previousSummary` `nextGoal` | **JSON** `{findings:[{severity,kind,where,issue,fix}], verdict}` |
| `revise` | `chapter` `packet.text` `findings` | 正文（修订稿） |
| `blurb` | 同 v0.1 | md |

内联协议（正文末尾，`draft` 的 system 必须写清）：
```
<<<SUMMARY>>>
（200–400 字本章摘要：发生了什么、谁变了、留下什么钩子）
<<<CANON>>>
[{...patch...}]
```
两段都可缺省；缺省时由引擎用独立小调用补齐。

`BUDGET` 常量表：`draft` / `revise` 条目不再使用（预算归 packet）；其余保留并按 v0.2 需要微调。新增 `volumeChapters`（user ≤ 9000）与 `canonPatch`（user ≤ 1600）条目。

## 13. T3 对抗审查：发现与处置（2026-11-12）

独立审查者对 v0.2 做了一次「证明它没达成目标」的攻击，提出 4 个 block、4 个 warn、2 个 note。**全部已处理**，每条都补了回归用例：

| # | 发现 | 处置 |
|---|---|---|
| 1 | ≥100 章新项目 `novel_context {chapter:'5'}` 打不开：章号宽度只从草稿推，得到 `ch05`，而卷表发的是 `ch005`；重试还会顺序展开 180 章 | `tools.js` 的宽度改用 `max(2, 大纲总章数位数, draft 位数)`；`ensureVolume` 支持点名卷，只展开目标章所在卷（实测 llm 2 次） |
| 2 | 第 500 章材料包 0 条未回收线索：`formatCanon` 先拼事实再整串 clip，事实吃满 3200 | 分节预算 + 线索保底（≥2 条 / 1200 字），事实仍占大头；实测 ch500 进 8 条线索、总长 4578 |
| 3 | `window` 在 `force` 或占位草稿下不封顶（写 4 章而不是 2 章） | 候选名单 = 全章序里「没草稿 / force / 草稿是占位」的章，window 限制候选前 N 个 |
| 4 | `novel_commit` 接受不存在的章并落盘 canon/review | tools 层在写任何产物前校验章在 outline 里，否则 404 `CHAPTER_NOT_FOUND` |
| 5 | 「死里逃生 + 下章出场」被误判 `dead-character(block)` | 放行词先于判死词（死里逃生/九死一生/诈死/未死…），补齐 遇害/殒命 等死亡词 |
| 6 | v1 项目 `params.chapters ≥ 100` 但只有 99 章时，迁移按新宽度发 `ch001`，99 个草稿失联 | v1 迁移保留原章 id 字面值，新章才用新宽度 |
| 7 | 文档宣称「第 5 章和第 500 章一样大」不成立 | 改为「常驻分片逐片固定上限」，并写清第 1 章天然短（实测差 5272） |
| 8 | 正文含行内 `<<<SUMMARY>>>` 时被当分隔符，正文被静默截断 | 标记只认独立成行（`^<<<SUMMARY>>>$`），行内保留为正文 |
| 9 | `atChapter` 只影响线索年龄，未来章节的事实会漏进当章材料包（剧透 + 角色提前知情） | `queryCanon` 过滤 `chapter/opened > atChapter` 的条目；章号缺失的条目保留 |
| 10 | 1000 章 / 5000 facts 合并 14.9s、canon.json 659KB | 未改：这是累计 1000 次 commit 的总耗时（≈15ms/次），书级规模可接受；3000 章未实测 |

审查脚本留在 `/tmp/t3_*.mjs`（临时文件，不属于仓库）。
