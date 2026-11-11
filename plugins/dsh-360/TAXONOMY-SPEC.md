# dsh-360 v0.2 — 分类标签系统 + 接口契约（实施用）

> 一句话：**执行面 agent-first**（稳定 id、结构化、输出紧凑、可复算）；**界面面 human-first**（中文标签、分组筛选、一句话结论、效果可感知）。

## 1. 为什么要分类

现状只有 `source`（技能来源）与 `kind`（instruction/agent/preset），回答不了用户真正会问的问题：
「这 62 个技能里，哪些是审查类？」「这 86 个 agent 里，编排类和执行类各多少？」
列表只能按分数/等级/来源筛，标签含义藏在路径字符串里（`agent-custom:claude-code-skills`）。

v0.2 起，每个对象带一个**四轴分类**：`role / kind / scope / state`。轴和值都由 `lib/taxonomy.js` 单一导出，UI、报告、工具输出共用。

## 2. 轴定义

### 2.1 role — 职责（两 surface 共用，启发式）

| id | 中文 | 说明 | 典型词（name/description） |
|---|---|---|---|
| `orchestrate` | 编排调度 | 路由、拆活、多 agent 协作、计划、交接 | orchestrate, router, routing, workflow, plan, pipeline, handoff, intake, dispatch, 编排, 调度, 路由, 流程, 计划, 分派 |
| `review` | 审查验证 | 代码/文档/结果审查、对抗、测试、质检 | review, audit, critic, critique, verify, verifier, test, quality, adversarial, grill, proof, 审查, 评审, 审计, 验证, 测试, 挑错, 对抗, 质检 |
| `research` | 研究分析 | 调研、探索、论文、数据分析 | research, analyze, analyst, analysis, explore, scout, investigate, paper, study, data, 研究, 分析, 调查, 论文, 数据, 探索 |
| `write` | 写作表达 | 写稿、润色、文案、发布、报告 | write, writer, draft, doc, documentation, copy, voice, humanize, publish, report, summarize, 写作, 撰写, 文档, 文案, 语气, 发布, 报告, 摘要 |
| `design` | 设计呈现 | 视觉、幻灯片、页面、卡片、图表 | design, slide, ppt, presentation, page, card, visual, diagram, layout, ui, ux, 设计, 幻灯片, 排版, 页面, 卡片, 可视化, 图表 |
| `build` | 编码实现 | 写码、重构、修 bug、前后端、部署 | code, coding, implement, refactor, fix, tdd, frontend, backend, react, typescript, deploy, install, migrate, 实现, 编码, 重构, 修复, 开发, 部署 |
| `knowledge` | 知识管理 | 记忆、归档、笔记、经验沉淀、索引 | knowledge, memory, archive, note, notes, lesson, learn, index, wiki, 知识, 记忆, 归档, 笔记, 经验, 索引 |
| `ops` | 运维治理 | 安全、密钥、发布、git、清理、监控 | ops, operation, security, secret, release, commit, git, branch, cleanup, clean, monitor, health, 运维, 安全, 发布, 提交, 分支, 清理, 监控, 治理 |
| `utility` | 通用工具 | 格式转换、解析、计算、渲染、导出 | format, parse, convert, calculate, extract, render, export, tool, utility, 格式, 解析, 转换, 计算, 提取, 渲染, 导出, 工具 |
| `other` | 其他 | 兜底 | — |

打分规则（确定性、可解释）：
- name 命中 ×3，description 命中 ×1；每个词只计一次；大小写不敏感；中文按子串、英文按词边界。
- 取最高分；并列时按上表顺序（review 优先于 build，避免 `code-review` 被判成编码）。
- 命中 0 次 → `other`，`confidence: 0.3`；否则 `confidence = min(0.95, 0.55 + 0.1 * 命中种类数)`。
- `evidence` 记录实际命中的词（≤5），工具与详情可见，UI 用 tooltip。

### 2.2 layer — 层级（仅 skills）

回答「这是不是元技能」：它作用于 agent 自身的能力/配置（技能库、提示词、上下文、会话效率），还是直接完成用户业务任务。

| id | 中文 | 说明 |
|---|---|---|
| `meta` | 元技能 | 发现/创建/评估/优化技能、提示词、上下文或会话效率 |
| `task` | 任务技能 | 直接完成用户的业务任务（默认） |

判定（高精度，宁可漏判也不误判）：
- 名称精确命中 `find-skills`、`prompt-optimizer`、`context-optimizer`、`loss-analysis`、`skill-creator`、`skill-reviewer`、`skill-manager`、`meta-skill` → `meta`（confidence 0.9）。
- 否则描述必须同时命中「对象词」（skill/prompt/context/subagent/技能/提示词/上下文/子代理/会话效率）和「治理动词」（find/install/create/optimize/audit/evaluate/score/review/rewrite/发现/安装/创建/生成/优化/审计/评估/评测/审查/改写）→ `meta`（0.7）。
- 其余 `task`（0.7）。`guizang-page-skill` 这种名字带 `skill` 的任务技能不会被误判；`handoff`、`goal-plan` 这类编排辅助也不计入元技能。

### 2.3 kind — 类型（surface 各自）

**skills**（按结构推导，不看语义）：

| id | 中文 | 条件（优先级从上到下） |
|---|---|---|
| `layered` | 分层参考 | `references/**` 文件数 ≥ 1 |
| `scripted` | 带脚本 | `scripts/**` 文件数 ≥ 1 |
| `routing` | 路由入口 | 正文 < 80 行且描述/正文链接到 ≥2 个其它技能 |
| `prose` | 单文件 | 其余 |

**agents**：

| id | 中文 |
|---|---|
| `instruction` | 常驻说明书 |
| `agent` | 子代理定义 |
| `preset` | 运行预设 |

### 2.4 scope — 范围

| id | 中文 | 来源映射 |
|---|---|---|
| `bundled` | 内置 | source `bundled` |
| `global` | 全局 | source `agent-agents` / `agent-claude` / 路径在 `~/.agents`、`~/.claude`、`~/.deepseek` |
| `project` | 项目 | 路径在 cwd 下 |
| `skill` | 技能内 | agents 的 `scope === 'skill'` |
| `profile` | 配置 | source `profile-config` / scope `profile` |
| `custom` | 自定义 | 其余 `agent-custom:*` |

### 2.5 state — 状态（可多值，badge 用）

| id | 中文 | 条件 |
|---|---|---|
| `active` | 在用 | usage.count > 0（agents: usage.sessions > 0） |
| `idle` | 闲置 | usage 足够证据且 count === 0 |
| `unobserved` | 未观测 | usage 证据不足 |
| `pending` | 待沉淀 | evolution.pending.hasUnclosed |
| `overlap` | 有重叠 | overlaps 最佳分 ≥ 0.6 |
| `critical` | 有严重问题 | findings 含 severity=critical |
| `stale-ref` | 失效引用 | metrics.staleRefs.length > 0（agents） |
| `conflict` | 跨文件冲突 | 命中 conflicts |

## 3. 数据结构（两 surface 一致）

每个 report / subject 增加：

```js
classification: {
  role:  { id: 'review', label: '审查验证', confidence: 0.85, evidence: ['review', '审计'] },
  layer: { id: 'meta', label: '元技能', confidence: 0.9, evidence: ['find-skills'] }, // skills only
  kind:  { id: 'layered', label: '分层参考' },      // agents: instruction/agent/preset
  scope: { id: 'global', label: '全局' },
  state: [{ id: 'active', label: '在用' }],
  summary: '审查代码改动并给出可落地改进建议',       // 一句话人话，≤60 字
  tags: ['role:review', 'layer:meta', 'kind:layered', 'scope:global', 'state:active'] // 机器可读
}
```

portfolio 增加：

```js
taxonomy: {
  version: 1,
  axes: [{ id, label, values: [{ id, label, description? }] }, ...]  // 供 UI/工具自描述
},
totals: {
  ...,
  byRole: { review: 12, ... },
  byLayer: { meta: 4, task: 58 },
  byKind: { layered: 20, ... },
  byScope: { global: 40, ... }
},
trend: { generatedAt, previousGeneratedAt, avgDelta, itemsChanged }   // 已有 delta 的聚合
```

不变式：
- 每个 item 必须带 `classification`；轴值必须来自 `taxonomy.axes`。
- `tags` 与 `classification` 同源，不允许 UI 侧重新推断。
- 序列化稳定（键顺序固定），同一输入两次扫描结果一致。

## 4. 工具输出（agent-first）

`dsh360_scan detail="summary"` 的每项缩到：`name/id, score, grade, verdict, role, layer(skills), kind, scope, state[], summary, topFinding, delta`（`tags` 只在 full/报告/面板给，可由四个轴 id 推导；summary 只给紧凑标签映射，不给轴描述）。
去掉逐项 `usage`/`evolution` 空对象与重复字段（`total`/`score` 二选一保留 `score`）、以及 34 条冲突/53 条重叠明细——这两类只在 `detail="full"` 与 Markdown 报告里展开，`totals` 仍给计数。
这样 agent 仍能回答「哪些审查类技能零使用」，但不再为明细付常驻 token；真实数据 86 个对象的 summary 约 50KB（pretty JSON），比 full 的 3.7MB 小两个数量级。

`detail="full"` 保持完整报告（含 findings/suggestions/classification/evidence）。

## 5. UI（human-first）

- 顶部：总分 + 一句话结论（「62 个技能，9 个待处理；最该先看 office 系列」）+ 数据时间。
- 筛选区按轴分组：**职责**（中文 chips + 计数）、**类型**、**范围**、**等级**；默认「全部」，选中态明显，可键盘操作（`role="tablist"` 不适用，用 `aria-pressed`）。
- 列表行：名称 + 一句话 summary + 三个标签 pill（职责/类型/范围，中文）+ 等级 + 分数 + 变化；状态用小圆点 + 文本，不只靠颜色。
- 详情：分类卡（四轴 + 命中证据）、效果卡（应用前后分数/tokens/撤销入口）。
- 首屏：先渲染上次快照（`stale` 标记「更新于 X，正在刷新」），后台全量刷新后替换，不阻塞交互。
- 只在切到某 tab 时才拉该 surface；默认 tab 不触发另一面扫描。

## 6. 性能目标

| 指标 | 基线 | 目标 |
|---|---|---|
| `probe-host --surface agents` 冷扫描 | 8.5s | ≤ 3.5s |
| 双 surface 同时首次扫描（共用会话解析） | ~14s+ | ≤ 5s |
| 面板首屏可见（有快照） | 8s+ | ≤ 300ms |
| 第二次扫描（60s 缓存内） | — | ≤ 150ms |

手段：冲突检测预计算 + 倒排、`collectUsage` 单飞+TTL 缓存、分面懒加载、快照先渲染。

## 7. 实施注记（v0.2 落地后）

- 英文关键词按字母数字边界匹配（`_`/`-` 视为分隔），因此 `field_analyst_agent` 能命中 `analyst`。
- 词表在 §2.1 基础上补了名词变形：`reviewer/reviewers`、`researcher/researchers`、`auditor`、`slides`，以及 `find/查找`（utility）。没有这些词时 `code-reviewer` 会因 name 里的 `code` 被判成编码。
- 常驻说明书（`kind=instruction`）若未命中任何职责词，回落为 `ops/运维治理`（confidence 0.4，evidence `instruction-file`），避免在面板里显示「其他」。
- `classifySkill` 的项目范围使用 host 传入的扫描 `cwd`（`options.cwd`），不是进程 cwd。
- agent 工具的 `detail="summary"` 使用紧凑版 taxonomy（`{version, axes:{axis:{id:label}}}`），并只保留注意力字段；完整 `classification`/`tags` 在 `detail="full"`、面板与报告中。
- 分类是导航，不参与评分；关键词改动必须先更新 `test/taxonomy.test.mjs` 的固定样例。
