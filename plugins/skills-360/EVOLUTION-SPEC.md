# skills-360 v0.2 冻结构建契约（Rubric 2.0 · 按需加载 · 持续进化）

状态：冻结 2026-11-09。三个实现方（core / host / client）只按本文件与已冻结的
`INTERFACE.md` 实现；任何形状变化先改本文件，不再口头同步。所有路径相对插件根
`/Users/fuzhuo/Documents/deepseek-harness/default-workspace/skills-360`。

## 0. 这次改什么

1. **口径纠正**：原 `demand`「按需价值」维度改为 `load`「按需加载」。它判断的是
   **加载路径是否成立**（目录里能否被选中 → 真实会话里是否被按需加载 → 触发是否唯一
   → 常驻成本是否合理），**不判断技能内容的价值**。“价值”不再是一个维度分数；使用
   次数只作为“按需加载是否发生”的证据，低频不等于低价值。
2. **补齐“按需加载”的判定**：渐进披露新增 `disclosure.index`「按需索引」——references
   存在时必须有一个入口索引（参考资源/References），否则模型不知道按需资源存在。
3. **新增持续进化闭环**：`evolution` 维度 + 会话信号挖掘 + `references/lessons.md`
   经验沉淀 + `skills360_evolve` 工具。技能在持续调用中积累“触发→做法”的经验，
   下一次加载时按需读到，形成闭环。
4. **质量增强**：真实请求语料校验触发词（`promptRecall`），发现“用户实际说法与描述
   用词不匹配”的证据。
5. **口径版本**：`RUBRIC_VERSION = '2.0'`。历史分数不可比，组合对比遇版本变化时清空
   `previous` / `deltaAvg`，报告注明“评分口径升级，历史分不可比”。

## 1. Rubric 2.0（唯一事实源）

| 维度 id | 标签 | 满分 |
|---|---|---|
| `load` | 按需加载 | 20 |
| `disclosure` | 渐进披露 | 25 |
| `actionability` | 可执行性 | 20 |
| `boundary` | 边界与治理 | 15 |
| `hygiene` | 维护卫生 | 10 |
| `evolution` | 持续进化 | 10 |

总分 100；等级 `A>=85 / B>=70 / C>=55 / D<55`；置信度规则不变。
维度内条目按 `applicable` 剔除后等比缩放到维度满分（沿用现有算法）。

### 1.1 `load` 按需加载（20）— 只判加载路径，不判内容价值

条目与阈值**沿用**原 `demand` 的四项，只改 id / 标签 / 文案 / finding：

| id | 标签 | max | 阈值（不变） |
|---|---|---|---|
| `load.trigger` | 触发可选中性 | 12 | 触发句式 3；触发词数 ≥6→4, 3–5→3, 1–2→1；触发句在前 160 字符→2，前 40%→1；描述 40..max→2，max..1.4max→1，其余 0；非空泛开头 +1 |
| `load.evidence` | 按需加载证据 | 8 | 样本不足 N/A；count≥5 且 14 天内→8；count≥2→6；count=1→4（非近 14 天→3）；count=0 且暴露≥45 天→0；count=0 且 <45 天→2 |
| `load.unique` | 路由唯一性 | 6 | overlap <0.25→6；<0.45→4；<0.65→2；其余 0 |
| `load.catalog` | 常驻成本 | 4 | 描述 80..max→4；40..79 或 max..1.4max→2；其余 1；截断且触发句被截掉→0 |

`load.evidence` 的 detail 必须写明：“加载次数是路径证据，不是价值判断；低频不等于低价值”。
finding 文案：
- count=0：title「窗口内 0 次按需加载」；detail 说明“只说明触发路径没有命真实请求，
  不能说明技能没有价值”；suggestion 指向“对照真实请求检查触发词；被邻居抢走则补边界或合并”。
- count 1–4：severity `minor`，title「按需加载次数偏低（N 次）」；detail 同上去价值化。
- `load.unique` fail 时 title「与邻居技能高度重叠」；`load.catalog` 同旧。
- `archive` verdict 的 reason 措辞改为“长期没有按需加载，且与邻居重叠低”。

### 1.2 `disclosure` 渐进披露（25）

新增一项，其余不变（body 8 / refs 8 / layers 5 / dumps 4）：

| id | 标签 | max | 判定 |
|---|---|---|---|
| `disclosure.index` | 按需索引 | 5 | `referenceCount === 0` 或 `referencedFiles === 0` → N/A（未接进入口由 `disclosure.refs` 处理，避免重复扣分）；否则：索引章节（H2/H3 标题匹配 `/参考|references?|资源|按需|索引|appendix|further reading/i`）里出现的 references 路径数 `indexRefs`：`refs>=2 && indexRefs>=2` → 5；`indexRefs>=1` → 4；无索引章节但已内联链接 → 2 |

实现位置：`lib/score.js`，用 `rawBody` 行区间与 `metrics.sections` 判定，不改
`metrics.js` 的形状。finding：`disclosure.index` 丢失≥2 分 → title「references 没有入口索引」，
severity major，suggestion 说明“在参考资源章节里逐个写清什么时候该读哪个文件”。
硬上限（>6000→16 / >12000→12 / >20000→8）不变。

### 1.3 `evolution` 持续进化（10）

条目：

| id | 标签 | max | 判定 |
|---|---|---|---|
| `evolution.lessons` | 经验沉淀 | 5 | lessons≥3 且已链接→5；≥1 且已链接→4；≥1 未链接→2；0→0 |
| `evolution.freshness` | 经验新鲜度 | 3 | 最近一条 90 天内→3；180 天内→2；365 天内→1；更旧→0；无经验→N/A |
| `evolution.closure` | 信号闭环 | 2 | 有经验且 `latestLessonAt >= lastSignalAt` →2；有经验但早于最近信号→1；无经验且有待闭环信号→0；无信号且无经验→N/A |

维度适用性：`applicable = loads > 0 || lessons.count > 0 || pendingScore > 0`。
- `applicable === false`：维度 `score:0, applicable:false`，summary「窗口内没有按需加载
  样本，本维度不评分；其余五维按 90 分折算为 100」；总分 = `round1(sum(五维) * 100 / 90)`。
- `applicable === true`：正常按 10 分计。

finding：
- 有加载但 0 经验 → `evolution.lessons` 丢失≥2 → title「有真实调用，但没有沉淀任何经验」，
  severity `minor`（loss < 4 时降为 info 由通用规则处理即可），suggestion 指向 `fix.add-lesson`。
- 有待闭环信号（pendingScore>0 且（无经验或经验早于最近信号））→ 额外 finding
  `evolution.pending`（info 或 major：pendingScore>=4 → major，否则 minor）：
  title「N 个调用后信号尚未沉淀」，detail 引用最近一条证据（时间 + sessionId + 摘要），
  suggestion「用 skills360_evolve 写一条“触发→做法”，或直接在面板沉淀经验」，actionIds `['fix.add-lesson']`。
- 经验未链接（lessons>0 && !linked）→ finding `evolution.unlinked` major：
  title「经验文件没有接进入口」，suggestion 链接 `references/lessons.md`。
- `promptRecall`：见 §2.3，`total>=3 && recall<0.4` → finding `load.prompt-mismatch`
  （dimension `load`，severity minor，evidence 第一条未命中 prompt 的摘要）。

### 1.4 组合指标

- `portfolio.totals.evolution = { skillsWithLessons, lessonsTotal, pendingSkills, signalsTotal }`
- `portfolio.evolution = [{ name, pendingScore, lastSignalAt, lessons, linked, draft }]`（pending 降序，最多 10）
- `portfolio.issues.pendingEvolution = [name]`
- `zeroUse` 保留 key，文案改为“零按需加载”。

## 2. 会话信号（`lib/usage.js`）

`collectUsage` 返回值新增两个对象（原字段不动）：

```js
signals: {
  [name]: {
    loads: 0, sessions: 0, reloads: 0, postLoadErrors: 0,
    corrections: 0, asks: 0, turnFailures: 0,
    lastLoadAt: 0 | null, lastSignalAt: 0 | null,
    samples: [{ kind: 'correction'|'error'|'reload'|'ask'|'turn-failure',
                at, sessionId, excerpt }]   // 最多 6 条，最新在前
  }
},
prompts: {
  [name]: [{ at, sessionId, text }]          // 最多 8 条，最新在前，text ≤ 400 字符
}
```

解析规则（只用本地会话日志，失败不抛）：

- `sessionId = basename(dirname(file))`。
- `tool/call` 且 `data.name === 'skill'`：`arguments` JSON 解析出 kebab-case name 后计数；
  同一会话第二次加载同一 name → `reloads++`；记录“加载请求前的最后一条真实用户消息”
  为 prompt（若存在）。
- `tool/result` 且 `data.message.isError === true`：记到本会话**最近一次加载**的技能
  `postLoadErrors++`，样本取错误内容首 160 字符，并用 `toolCallId`/`callId` 反查失败工具名，
  前缀成 `[工具名] 摘要`。
- **信号时间窗**：纠错、报错、追问、失败回合只在该技能加载后 120 分钟内计入（加载时间缺失时
  不设限）；超过窗口的会话后续事件视为无关任务，避免把几小时后的错误算到技能头上。重复加载
  不受窗口限制。
- `user/message` 且 `data.source?.kind === 'user'`（老会话缺 `source` 时兼容）才算真实用户消息；
  `time-context` / `runtime-context` / `agent-instructions` / `skill-catalog` 等注入上下文一律不算。
  更新“最后一条真实用户消息”；若本会话已加载过技能且文本匹配纠错正则、长度 ≤ 600、且不含
  `system-reminder`，记到最近加载的技能 `corrections++`。正则：
  `/不对|错了|不是这个|不是这样|我是说|我说的是|应该是|重新做|重来|别这样|搞错|纠正|actually|that's not|not what I|wrong|instead/i`
- `tool/call` 且 `data.name === 'ask_user_question'`：最近加载技能 `asks++`。
- `turn/end` 且 `data.reason.kind !== 'completed'`：最近加载技能 `turnFailures++`。
- `sessions` 为该技能被加载过的会话数；`lastSignalAt` 取所有信号样本时间的最大值。
- 样本 excerpt：去换行、截 160 字符。

隐私：只在本机读、只在报告里出现 ≤160 字符摘要与不透明 sessionId；不发网络。
配置 `evolution: false` 时 host 不挖信号（返回空对象），维度 N/A。

## 3. 经验文件（`references/lessons.md`）

### 3.1 格式（`lib/evolution.js` 负责解析/生成）

```md
# Lessons（实战经验）

> 由 skills-360 从真实调用信号沉淀，按需读取；最新在上。

- [2026-11-09] 触发：用户说“不要改测试” → 做法：先跑现有测试再改实现（证据：session abc123）
```

`parseLessons(raw)` → `{ count, latestAt, entries: [{ at, trigger, rule, evidence, line }] }`：
只认 `^\s*-\s*\[?YYYY-MM-DD\]?` 开头的列表项；`at = Date.UTC(y,m-1,d)`；解析
`触发：…`、`做法：…`、`证据：…`（缺失留空）。`count===0` 时 `latestAt=null`。

`composeLessonEntry({ at, trigger, rule, evidence })` → 上述单行；触发 ≤120、做法 ≤300、
证据 ≤120 字符，去换行。

### 3.2 写入（`lib/fixes.js` 新动作 `add-lesson`）

- `planFixes` 入参扩展：`{ report, raw, files, actionIds, lesson?, lessonsRaw? }`。
- `action.type === 'add-lesson'`：
  - 内容取 `lesson` 参数，缺省取 `suggestion.action.params.lesson`；
  - `trigger`、`rule` 必须非空（rule 为空/占位 → skip，reason「经验缺少做法，先补一条可执行规则」）；
  - 目标文件 `references/lessons.md`：不存在则写头 + 首条；存在则在第一条列表项前插入；
  - 同时确保正文链接：正文已含 `](references/lessons.md)` 则不动；否则若有
    `## 参考资源` / `## References` / `## 参考` 标题，在其后追加
    `- [lessons.md](references/lessons.md) — 实战经验（按需读取）`；没有则在文末追加该章节；
  - `actionIds` 含 `fix.add-lesson` 但 `report.suggestions` 里没有该 id 时，若显式
    `lesson` 存在，仍按 `fix.add-lesson` 合成处理（工具直写路径），否则 skip。
- 返回的 writes 只含 `SKILL.md` 与 `references/lessons.md`；备份/撤销沿用 `applyPlan`。
- `applyPlan` / `undoBackup` 不需要改形状。

### 3.3 建议 `fix.add-lesson`

`score.js` 在 `evolution.pending.hasUnclosed` 时生成：

```js
{
  id: 'fix.add-lesson', kind: 'draft',
  title: '沉淀一条“触发→做法”经验',
  why: '窗口内出现 N 个加载后信号（纠错/报错/重复加载），还没有对应经验。',
  risk: '中：会向 references/lessons.md 追加一条经验并接进入口；可撤销。',
  action: { type: 'add-lesson', params: { lesson: { trigger: draft.trigger, rule: '', evidence: draft.evidence } } },
  preview: { before: '（未沉淀）', after: draft.trigger + ' → ' + '（待补做法）' }
}
```

面板对 `fix.add-lesson` 特殊处理：不直接 apply，而是打开经验编辑器（预填 trigger /
evidence），补 rule 后 POST `/evolve`。

## 4. 进化状态与提案（`lib/evolution.js`）

```js
buildEvolution({ signals, loads, lessons, linked, prompts, description, now })
// -> {
//   applicable, loads,
//   lessons: { count, latestAt, linked, entries },      // entries 最多 5
//   signals: { loads, sessions, reloads, postLoadErrors, corrections, asks, turnFailures,
//              lastSignalAt, samples },                 // samples 最多 6
//   pending: { score, hasUnclosed, lastSignalAt, draft },// draft = {trigger, rule, evidence}
//   promptRecall: { total, matched, recall, samples },   // samples 未命中的摘要，最多 3
//   proposals: [{ id:'evolution.add-lesson', title, why, evidence, draft }]
// }
```

- `pendingScore = corrections*3 + postLoadErrors*2 + reloads*2 + turnFailures*2 + asks`。
- `hasUnclosed = pendingScore > 0 && (无经验 || 最近信号晚于最新经验日期当天结束)`。经验是日期粒度（`[YYYY-MM-DD]`），
  因此同一天写入的经验视为已覆盖当天早些时候的信号；只有更晚日期的信号才算未闭环。`evolution.closure` 同样按天比较。
- `draft.trigger` = 最新一条 correction/error sample 的 excerpt；`draft.rule = ''`；
  `draft.evidence = 'session ' + sessionId`。
- `promptRecall`：`total = prompts.length`；命中 = prompt 文本与描述共享 ≥1 个
  `triggerTerms` token；`recall = matched/total`（total=0 → null）。

`analyzeSkill` 接收 `input.evolution = { signals, lessonsRaw, linked? }`，内部：
`lessons = parseLessons(lessonsRaw)`；`linked = body.includes('lessons.md')`；
`buildEvolution(...)`；把结果放到 `report.evolution`，并传给 `scoreSkill` 的
`context.evolution`。`report.usage` 形状不变。

## 5. Host（`index.js`）

### 5.1 扫描

- `safeCollectUsage` 透传 `signals` / `prompts`。
- `analyzeOne` 读 `references/lessons.md` 原文（不存在→null），随 `evolution: { signals, lessonsRaw }`
  传给 `analyzeSkill`。
- `scan` 的 portfolio meta 透传 `usage.signals?` 不需要；组合指标由 `buildPortfolio` 从各 report 汇总。
- `saveState` / `readState` 增加 `rubricVersion`；`buildPortfolio` 的 `meta.previous`
  若 `rubricVersion !== RUBRIC_VERSION` → 视为 `null`（不清旧状态，只是不比较）。

### 5.2 新路由 `POST /api/skills-360/evolve`

请求：`{ name: string, lesson: { trigger: string, rule: string, evidence?: string }, dryRun?: boolean }`
- `name` 必须 kebab-case；`lesson.trigger` 1..200、`lesson.rule` 1..500、`evidence` 0..200；
  去换行；`rule` 空白 → 400 `invalid-argument`。
- `dryRun=true` → 返回 `{ dryRun:true, plan: {writes}, actions }`（不写盘）。
- `dryRun=false`（默认）→ 走 `applyPlan`，返回
  `{ dryRun:false, backupId, changed, diff, beforeTotal, afterTotal, lesson, report }`。
- 错误码沿用现有：`not-found` / `invalid-argument` / `unsafe-path` / `no-actions` / `internal`。
- 写入串行化（`serial`）+ 备份（`backupRoot`）+ 失效缓存（`invalidate()`）。

Host 方法：`evolve({ name, lesson, dryRun, cwd })`。

### 5.3 工具 `skills360_evolve`

参数：

```js
{
  names?: string[],        // dryRun 时限制目标
  name?: string,           // 写入时必填
  lesson?: { trigger, rule, evidence? },
  dryRun?: boolean,        // 默认 true
  cwd?: string
}
```

- 默认 `dryRun=true`：返回
  `{ dryRun:true, proposals: [{ name, pendingScore, hasUnclosed, lastSignalAt, lessons, linked, draft, evidence }], totals }`，
  仅列 `hasUnclosed` 的技能，按 pendingScore 降序，最多 10 条；`names` 过滤；空则
  `proposals: []` 并附 `note`。
- `dryRun=false`：要求 `name + lesson`；写入后返回
  `{ dryRun:false, name, backupId, beforeTotal, afterTotal, lesson, evolution }`。
- 工具描述必须写清触发场景（“用户说某技能刚用错了/纠正了你”“想把这次教训写回 skill”），
  并说明“信号与证据由插件给，经验文字由你写；dryRun 默认 true”。

### 5.4 `summaryPortfolio` / 工具输出

每个 skill 增加：

```js
evolution: {
  applicable, lessons: count, linked,
  pendingScore, hasUnclosed, lastSignalAt,
  draft
}
```

`totals.evolution` 原样透传。

## 6. Client（`client.js` + `.verify-client.mjs`）

- 文案：副标题改「按需加载 / 渐进披露 / 可执行性 / 边界 / 卫生 / 持续进化 六维评分」；
  六维条形沿用通用渲染；`dim.applicable === false` 时显示「本维度不评分」。
- 详情新增「持续进化」块（在维度之后、指标之前）：
  - 经验数 / 最近一条日期 / 是否已接进入口；
  - 信号计数：加载、纠错、报错、重复加载、失败；
  - 待闭环提案列表：trigger 摘要、证据（sessionId + 时间）、「沉淀经验」按钮；
  - 点击按钮展开编辑器：触发（预填）→ 做法（必填 textarea）→ 证据（预填）→
    「写入经验」调用 `POST /evolve`（`window.confirm` 后）；成功后刷新 scan 与详情并显示 backupId。
  - 无信号/无经验时显示空态提示，不隐藏区块。
- 列表行：`report.evolution.pending.hasUnclosed` 时显示「待进化」小徽标。
- `fix.add-lesson` 建议：按钮文案「沉淀经验」，点击打开上述编辑器（预填 suggestion 参数），
  不直接调用 `/apply`。
- 语言文件 zh/en 同步新增 key；不要硬编码中文在组件里（沿用现有 `t()`）。
- `.verify-client.mjs` 更新：六维 mock、evolution 块渲染、建议按钮、编辑器渲染；
  hook seeds 数量按新组件顺序调整；断言包含「持续进化」「待进化」「写入经验」等文案。

## 7. 测试与验收（每方都要做）

- core：`node --test test/core.test.mjs` 全绿；新增单测覆盖 §2 信号解析、§3
  parse/compose/plan/write/undo、§1.3 维度与 N/A 折算、§1.2 索引项、promptRecall。
- host：`node .verify-host.mjs` 全绿；新增：合成会话（加载→纠错→报错→二次加载→失败）
  → scan 出现 pending；`POST /evolve` dryRun/写入/撤销；工具 `skills360_evolve`
  dryRun 与写入；路径安全拒绝仍生效。
- client：`node .verify-client.mjs` 全绿；六维与进化块渲染。
- 总验：`node test/run-all.mjs`；`node --check index.js && node --check client.js`。
- rubricVersion 断言：`'2.0'`。

## 8. 文件所有权（本轮）

| 路径 | 所有者 |
|---|---|
| `lib/evolution.js`（新）、`lib/usage.js`、`lib/score.js`、`lib/analyze.js`、`lib/fixes.js`、`lib/report.js`、`test/core.test.mjs` | core |
| `index.js`、`.verify-host.mjs` | host |
| `client.js`、`.verify-client.mjs` | client |
| `RUBRIC.md`、`README.md`、`INTERFACE.md`、`package.json`、`cordis.patch.yml`、`test/run-all.mjs`、`EVOLUTION-SPEC.md`、`REPORT.md` | Lead |

不要改别人的文件；需要改时发消息给 Lead。
