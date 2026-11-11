# dsh-360 评分口径（合并版 Rubric）

> **一个插件，两面体检。** `skills` surface 判「技能目录的加载路径」，`agents` surface 判「常驻说明书 / 子代理定义 / agent 预设的注入路径」。两面维度权重一致（20 / 25 / 20 / 15 / 10 / 10），总分都落到同一张 18 档等级表，因此跨 surface 的分数可以直接比较。
>
> 铁律：**所有扣分必须落到一条可复核证据**（行号 / 原文 / 统计 / 会话信号）。分数是启发式，不是精确测量；报告必须展示口径与置信度，禁止用分数掩盖证据缺失。
>
> 两套 rubric 的版本谱系：skills 沿用 Rubric 2.0（`lib/skills/analyze.js` 的 `RUBRIC_VERSION = '2.0'`），agents 沿用 Rubric 1.0（`lib/agents/analyze.js` 的 `RUBRIC_VERSION = '1.0'`），合并后只在等级制与输出形状上统一，评分口径不动。

## 0. 分类不是评分（v0.2）

每个对象另有四轴分类（职责 / 类型 / 范围 / 状态；技能多一轴「层级」区分元技能与任务技能，见 [TAXONOMY-SPEC.md](TAXONOMY-SPEC.md)）。分类只用于导航与筛选，**不进入六维、不加分也不减分**；`role.confidence` 与 `role.evidence` 必须随报告展示，「其他」是关键词未命中的诚实兜底，不得为了好看手工改标签。任何新关键词先改 `lib/taxonomy.js` 与词表测试，再谈 UI。

## 1. 统一等级制（S~E × ±，18 档）

`lib/grade.js` 是**唯一实现**，任何地方不得再写死阈值。字母表达整体健康度，`+ / -` 表达字母内的位置；`rank` 越小越好（S+ = 0，E- = 17）。

| 档位 | 下限（≥） | rank | 字母含意 | 典型读法 |
|---|---|---|---|---|
| S+ | 96 | 0 | 卓越 excellent | 几乎没有可扣分的结构性缺陷，且证据链完整 |
| S | 93 | 1 | 卓越 | 披露/注入路径干净，进化闭环成立 |
| S- | 90 | 2 | 卓越 | 六维最多一个小项掉分 |
| A+ | 87 | 3 | 优秀 great | 边界清楚、证据充分，只有细节可打磨 |
| A | 84.5 | 4 | 优秀 | 结构成立，个别维度未满（如经验未沉淀） |
| A- | 82 | 5 | 优秀 | 有明显可一键修的项，但不伤主干 |
| B+ | 79 | 6 | 良好 good | 可用，某一维明显偏弱 |
| B | 75.5 | 7 | 良好 | 主干在，披露或注入路径有硬伤 |
| B- | 72 | 8 | 良好 | 需要一轮整理 |
| C+ | 68 | 9 | 及格 fair | 多个维度掉分，改动成本开始变高 |
| C | 64 | 10 | 及格 | 靠体量或规则堆出来的“看起来全” |
| C- | 60 | 11 | 及格 | 结构基本靠人读补救 |
| D+ | 55 | 12 | 偏弱 weak | 常驻成本或披露结构已经不合算 |
| D | 50 | 13 | 偏弱 | 触发/注入证据缺失且结构差 |
| D- | 45 | 14 | 偏弱 | 只有一个亮点维度 |
| E+ | 37 | 15 | 危险 critical | 大文件直灌、无边界、无验收 |
| E | 28 | 16 | 危险 | 只在目录里占位 |
| E- | 0 | 17 | 危险 | 空壳 / 不可解析 / 只剩占位符 |

**示例（同一把尺子）**：`86.4 → A 优秀（rank 4）`、`84.5 → A`、`82.0 → A-`、`79.0 → B+`、`74.9 → B-`、`59.99 → C-`、`45.0 → D-`、`28.0 → E`。注意 `84.5` 与 `84.49` 分属 A 与 A-——阈值是闭区间下限，不做四舍五入。

`gradeFor(total)` → `{ code, letter, tier, label, labelEn, rank, min, max }`；另导出 `gradeCode`、`compareGrades`、`GRADE_CODES`、`GRADE_LETTERS`、`GRADE_SCALE`。

**数据形状**：两个 surface 的 `report.score` 都必须同时给：

```js
score: {
  total: 86.4,
  grade: 'A',        // 18 档 code（如 'A+' / 'B-'），展示用
  letter: 'A',       // 粗粒度字母 S/A/B/C/D/E，筛选用
  tier: '',          // '+' | '' | '-'
  rank: 4,           // 0..17，比较用
  confidence: 0.9,
  delta: null,
  dimensions: [...],
}
```

`Portfolio.totals.grades` 按字母计数 `{ S, A, B, C, D, E }`；`Portfolio.totals.gradeCodes` 可选，按 18 档计数。**verdict 判定仍走数值阈值**（§4），不因 18 档细分而改变。

## 2. skills surface 六维（技能目录）

对象：DSH catalog 里的每个 skill（`SKILL.md` + `references/**`）。

| 维度 | id | 权重 | 回答什么问题 |
|---|---|---|---|
| 按需加载 | `load` | 20 | catalog 里选得中吗？真实会话里被按需加载过吗？和邻居触发重复吗？空闲目录成本合理吗？**判加载路径，不判内容价值** |
| 渐进披露 | `disclosure` | 25 | 是不是一次把几万字灌进上下文？细节有没有沉到 `references/` 并接进入口？入口有没有“按需读哪个文件”的索引？ |
| 可执行性 | `actionability` | 20 | 读完能不能照做：frontmatter、编号步骤、命令、示例、决策分支、反模式 |
| 边界与治理 | `boundary` | 15 | 说没说“什么时候别用”？与兄弟技能的分工？中英触发覆盖？ |
| 维护卫生 | `hygiene` | 10 | TODO/占位、失效链接、危险命令、密钥痕迹、重复标题、异常体积 |
| 持续进化 | `evolution` | 10 | 加载后的纠错/报错/重复加载/追问，有没有沉淀成 `references/lessons.md` 并接回入口 |

### 2.1 按需加载（20）

- **触发可选中性（12）**：触发句式命中 3；唯一触发词密度 ≥6 / 3–5 / 1–2 得 4 / 3 / 1；前置核心（前 160 字符内出现触发句式或核心动词）2；长度适配（40 ≤ chars ≤ max 得 2，≤1.4×max 得 1，过短或过长 0）；非空泛开头 1。`max` 默认 500（config `catalogDescriptionMaxLength`）。
- **按需加载证据（8）**：只统计窗口内 `skill` 工具的加载调用。`exposureDays` 优先取该技能在 catalog 中**首次出现**的时间（`firstSeen`），而非 mtime（同步会重置 mtime）；样本充分性要求 `sessionsScanned ≥ 5` 且（暴露 ≥14 天，或 ≥2 天且 catalog 会话 ≥30）。充分时 ≥5 次且 14 天内 → 8；≥2 次 → 6；1 次 → 3（7 天内 4）；0 次且暴露 ≥45 天 → 0；0 次且 <45 天 → 2 并再降置信度 0.1。不足时该项 N/A，维度内其余条目按比例放大。
- **路由唯一性（6）**：与兄弟技能算 IDF 加权余弦 `cosine`，`m = min(1, sqrt(cosine) × (1 + 0.2 × 名称重合率))`；`m < 0.25` → 6，`0.25–0.45` → 4，`0.45–0.65` → 2，`≥0.65` → 0。同时输出 `overlaps`（≥0.35，最多 5 个）。
- **常驻成本（4）**：`catalogChars = min(descriptionChars, max)`；80–max → 4，40–79 或 `max+1–1.4×max` → 2，过短/过长 → 1，截断且触发句落在截断点之后 → 0。
- **不扣分的质量增强**：加载前的最后一条真实用户消息与描述共享 ≥1 个触发词视为命中；`total ≥ 3 && recall < 0.4` → finding `load.prompt-mismatch`（minor），只作为改描述的输入。

### 2.2 渐进披露（25）

- **入口精简（8）**：`estTokens` ≤1800 / ≤3500 / ≤6000 / ≤9000 / ≤14000 / >14000 → 8 / 7 / 5 / 3 / 1 / 0；`bodyLines > 800` 最高 5，`> 1500` 最高 2。
- **细节外置（8）**：正文 ≤1800 tokens 直接 8；超出时 `referenceCount ≥ 2` 且 `referencedFiles ≥ 1` → 8，`≥1` 且被引用 → 6，有 references 但没被入口引用 → 2，无 references → 0；`orphanReferences > 0` 再 −1，`brokenLinks` 非空再 −1。
- **按需索引（5）**：references 存在但入口没接 → N/A（避免与 §2.2 细节外置重复扣分）；有索引章节（标题含 参考/references/资源/按需/索引/appendix/further reading）且 `indexRefs ≥ 2` → 5，`indexRefs ≥ 1` → 4，只在正文内联链接 → 2。
- **分层入口（5）**：H2 ≥1 → +1、≥3 → +2；前 40 行出现快速开始/概览/决策小节或 TOC → +1；有编号步骤或工作流小节 → +1；首个 H2 是入口型 → +1。
- **维度硬上限**：`estTokens > 6000` → 最高 16；`> 12000` → 12；`> 20000` → 8。60KB 的入口不能靠“有标题”洗白。
- **无内联堆积（4）**：`maxCodeBlockLines ≤ 60` → 2 / 61–120 → 1 / >120 → 0；`codeRatio ≤ 0.35` → 2 / ≤0.55 → 1 / >0.55 → 0。

### 2.3 可执行性（20）

frontmatter 完整 5（可解析 1、`description` 非空 1、kebab-case 1、与目录名一致 2 / 不一致但合法 1；`partial` 时最多 3）；操作步骤 6（编号步骤 ≥5 / 3–4 / 1–2 → 6 / 5 / 3，无步骤按命令块数 3/1/0）；示例 4（示例标识 + 代码/引号块 4，只有代码块 3，只有标题 2）；决策与反模式 5（决策语言 ≥2 次 → 3，1 次 → 2；反模式命中 +2）。

### 2.4 边界与治理（15）

何时不用 6（独立小节 6，只在行内出现 3，无 0）；兄弟区分 5（`overlapMax < 0.35` → 3，0.35–0.55 → 2，>0.55 → 0；点名兄弟或写清 vs/区别 +2）；中英触发覆盖 4（CJK + 拉丁 4，仅一种 2）。

### 2.5 维护卫生（10）

占位与未完成 3（代码块外 `TODO:`/`TBD:`/`FIXME`/`XXX`/`待补充`/`待完善` → 0；“占位符/占位示例”是术语，不算）；链接与资源 3；安全 2（`curl … | sh`、`rm -rf /`、`chmod 777`、私钥块、`sk-`/`ghp_`/`AKIA` 长 token、`eval` 拼接用户输入任一 → 0）；体积与重复 2（重复 H2 >0 或 `bodyChars > 200_000` → 0）。

### 2.6 持续进化（10）

经验存放在 `<skill>/references/lessons.md`，条目格式 `- [日期] 触发：… → 做法：…（证据：session xxx）`；`linked` = `SKILL.md` 是否链接到该文件。

- **沉淀（5）**：`lessons ≥ 3 && linked` → 5；`≥1 && linked` → 4；有经验但未链接 → 2（写了下次读不到）；0 → 0。
- **新鲜度（3）**：最近一条 ≤90 天 → 3；≤180 → 2；≤365 → 1；更旧 → 0。
- **信号闭环（2）**：信号 = 加载后 120 分钟内的纠错、工具报错（带失败工具名）、重复加载、追问、失败回合；超过窗口不归因。有经验且最近信号不晚于最新经验（按天）→ 2；信号更新 → 1；有信号无经验 → 0；都没有 → N/A。
- **适用性与折算**：`applicable = loads > 0 || lessons > 0 || pendingScore > 0`；false 时该维度不评分，其余五维按 90 分折算到 100。`pendingScore = corrections×3 + postLoadErrors×2 + reloads×2 + turnFailures×2 + asks`，**≥4 记 major，否则 minor**。

### 2.7 skills 的可执行建议

| actionId | kind | 语义 |
|---|---|---|
| `fix.link-references` | auto | references 存在但正文未链接 → 追加“参考资源”清单 |
| `fix.extract-sections` | auto | 正文 >3500 tokens 且参考型 H2 ≥60 行 → 逐字搬到 `references/`，原位留 2–4 行指针 |
| `fix.frontload-triggers` | auto | 触发句在描述 60% 之后 → 前移到第一句之后（不删字） |
| `fix.rewrite-description` | draft | 缺触发句式 → 生成 `<摘要>. Use when: <触发词 3–6 个>` 草稿 |
| `fix.trim-description` | draft | 描述 >1.4×max → 在句界截到 ≤max 并保留触发句 |
| `fix.add-boundary` | draft | 缺“何时不用” → 追加带“请补充”空条目的骨架 |
| `fix.add-lesson` | draft | 有待闭环信号 → 经验草稿；直接 apply 会因“做法为空”被拒，须走 `dsh360_evolve` |
| 坏链 / TODO / 重叠合并 / 危险命令 | manual | 不给自动修，只给建议 |

**auto** = 机械、内容无损、可撤销；**draft** = 会生成或删除文字，需单条点击；**manual** = 无法安全自动修。

## 3. agents surface 六维（说明书 / 子代理 / 预设）

对象：`instruction`（`~/.agents/AGENTS.md`、`$DSH_HOME/AGENTS.md`、项目逐级 `AGENTS.md`/`CLAUDE.md`）、`agent`（`*/agents/*.md` 等子代理定义）、`preset`（`ctx.agentPresets` 或 profile patch 里的 preset 行）。子代理分层无独立 prompt 文件时从 `router-mode/cordis.patch.yml` 合成，`coverage: partial` 且置信度下调。

| 维度 | id | 权重 | 回答什么问题 |
|---|---|---|---|
| 注入命中 | `inject` | 20 | 真的进了模型上下文吗？常驻成本多大？作用域覆盖哪些会话？ |
| 分层与精简 | `layer` | 25 | 是不是把一切都塞进常驻上下文？细节外置并指路了吗？ |
| 可执行性 | `actionable` | 20 | 规则能照做吗：祈使句、验收命令、反模式、决策分支 |
| 边界与治理 | `governance` | 15 | 作用域写清了吗？职责边界？跨文件冲突？ |
| 维护卫生 | `hygiene` | 10 | 占位符、失效引用、密钥、`.bak` 污染 |
| 持续进化 | `evolution` | 10 | 反复纠正的事有没有沉淀成受管规则块写回注入路径 |

### 3.1 注入命中（20）

- **注入/使用证据（8）**：`instruction` 看 `sessionsInjected`（≥1 且 `sessionsSeen ≥ 5` → 8；≥1 → 6；0 且暴露 ≥14 天 → 2；样本 <5 → N/A）；`agent` 看 `subagentRuns`（≥3 → 8；1–2 → 5；0 且暴露 ≥45 天 → 0；<45 天 → 3）；`preset` 看 `presetSessions`（≥10 → 8；1–9 → 6；0 且 ≥30 天 → 1；<30 天 → 4）。`exposureDays = min(now − mtime, 365)`，mtime 缺失时用首次扫到时间并降置信度 0.1。
- **常驻成本（6）**：instruction `tokensPerInjection ≤ 800 / ≤1500 / ≤2500 / >2500` → 6/4/2/0；agent `description` 字符 ≤300 / ≤500 / ≤900 / >900 或缺失 → 6/4/2/0；preset 有显式档位配置（`reasoningEffort`/`maxTokens`）→ 6，只有模型名 → 4，无模型配置 → 2。
- **唯一性与作用域（6）**：instruction 作用域明确且与兄弟重复率 <0.4 → 6，<0.7 → 3，≥0.7 → 0；agent `name` 唯一合法 3 分 + `description` 含触发句式 3 分。

### 3.2 分层与精简（25）

- **入口体量（10）**：`estTokens` ≤1200 / ≤2500 / ≤4000 / ≤8000 / >8000 → 10/8/5/2/0；`lines > 600` 最高 5，`> 1200` 最高 2（CJK 1 字≈1 token，其余 4 字符/token）。
- **细节外置（8）**：≤2500 tokens 直接 8；超出时存在 `agent-notes/**` 或被引用的外部文档 → 8；只有参考型章节未外置 → 4；无外置结构 → 0；`localLinks` 有失效再 −1。
- **分层入口（7）**：H2 ≥3 → +3（1–2 → +1）；前 30 行出现概览/快速开始/决策/边界/工作流 → +2；有编号步骤或工作流小节 → +2。

### 3.3 可执行性（20）

祈使规则密度 6（命中的行数 ≥8 / 4–7 / 1–3 / 0 → 6/4/2/0；全为描述性陈述记 `actionable.descriptive` minor）；验收命令 6（有命令块且出现“验证/检查/验收/verify/check” → 6，有命令无验收语义 → 3）；反模式 4；决策分支 4（≥2 次 4，1 次 2）。

### 3.4 边界与治理（15）

作用域声明 5（正文写明适用范围 5，靠路径隐含 3，无线索 1）；职责边界 5（独立“不适用/边界/禁止用于”小节 5，仅行内 3，无 0——agent 类必扣）；跨文件冲突 5（无冲突 5；1 条 duplicate（ratio ≥0.6）→ 3，≥2 条 → 1；有 contradiction → 0）。

### 3.5 维护卫生（10）

占位与未完成 3；引用可解析 3（`staleRefs == 0` → 3，1–2 → 1，>2 → 0）；安全 2；备份污染 2（同目录 `.bak`/`.bak-*`/`.old` 0 个 → 2，1–3 → 1，>3 → 0）。

### 3.6 持续进化（10）

经验写入**受管块**（`<!-- agents-360:lessons:start --> … <!-- agents-360:lessons:end -->`，`lib/agents/evolution.js` 的 `LESSONS_BLOCK`），账本 `.agents-360/lessons.md`；`linked` = 说明书正文有受管块并链到账本（或经验内联在块内）。块外内容永不改动，块内按日期去重、幂等更新——因为说明书是**常驻**的，写回才真的会被下一次读到。

- 沉淀 5（`≥3 && linked` → 5；`≥1 && linked` → 4；`≥1 && !linked` → 2；0 → 0）；新鲜度 3（90/180/365 天）；闭环 2（信号日 ≤ 最新经验日 → 2；更新 → 1；无经验且有 `pending.hasUnclosed` → 0；都没有 → N/A）。
- `applicable = usage.sessions > 0 || lessons > 0 || pending.score > 0`；false 时其余五维按 90 折算。`pendingScore` 口径同 §2.6。

### 3.7 agents 的可执行建议

| actionId | kind | 语义 |
|---|---|---|
| `fix.extract-sections` | auto | 参考型 H2 ≥60 行 → 搬到 `agent-notes/<slug>.md`，原位留 2–4 行指针并补索引 |
| `fix.link-notes` | auto | `agent-notes/**` 存在但正文未链接 → 追加“按需参考”清单 |
| `fix.embed-lessons` | auto | 经验账本存在但正文无受管块 → 插入受管块并链到账本 |
| `fix.add-verification` | draft | 追加“做完必须跑什么检查”骨架 |
| `fix.add-boundary` | draft | 追加“不适用/边界”骨架 |
| `fix.rewrite-description` | draft | agent 的 description 缺触发句式 → 生成 `… Use when: <触发词>` 草稿 |
| `fix.dedupe-rules` | draft | 跨文件重复规则（ratio ≥0.6）→ 生成合并稿（保留较新文件，另一处改指针） |
| `fix.add-lesson` | draft | 有待闭环信号 → 经验草稿；apply 会被拒（rule 为空），须走 `dsh360_evolve` |
| `fix.resolve-stale` | manual | 失效路径引用，只给建议 |
| `fix.secret` | manual | 疑似密钥，只提示轮换 |

## 4. verdict 与置信度

**verdict 按数值阈值判定**（不看等级 code），`reason` 必须引用具体证据：

- skills：`archive`（`total < 55` 且 usage 充分、窗口内 0 次按需加载、暴露 ≥60 天、`overlapMax < 0.5`）→ 否则 `watch`（`total < 70`，或 usage 充分且 0 加载且暴露 ≥30 天）→ 否则 `keep`。`archive` 的措辞是“长期没有按需加载”，**不是“没有价值”**。
- agents：`archive`（`total < 55` 且暴露 ≥60 天且 `usage.sessions == 0` 且重叠 <0.5）→ `trim`（`total < 70`，或 layer 维度 < 12.5，或 `tokensPerInjection > 2500`）→ `watch`（注入证据缺失，或存在 `contradiction`）→ 否则 `keep`。
- 合并版不再单列 `merge` verdict：重叠候选由 `Portfolio.overlaps`（skills ≥0.4、agents ≥0.4，含 name 相似度）与 `quickWins` 呈现，避免和 `archive/trim` 语义打架。

**置信度**（`score.confidence`）：

- skills：`coverage=full` → 0.9，`partial` → 0.5；样本不足 −0.1；充分但 0 加载且暴露 <45 天再 −0.1；正文为空时压到 ≤0.4；下限 0.2。
- agents：`coverage != full` → 0.5；`usageAvailable` → 0.9，否则 0.75；`sessionsSeen < 5` −0.1；mtime 缺失 −0.1；下限 0.3。
- 分数保留 1 位小数，条目分取整或 0.5 步进，便于解释。

**跨 surface 汇总**：面板与报告里的等级一律用 `score.grade`（18 档），筛选与分布用 `score.letter`；颜色 S 金 / A 绿 / B 蓝 / C 琥珀 / D 橙 / E 红。两个 surface 的分数可比，但**权重口径不同**（加载路径 vs 注入路径），不要拿一个 surface 的维度分直接对另一个的维度分。

## 5. 已知局限（合并后仍成立）

- 分数是启发式，不能替代人读；`partial` 覆盖或会话样本不足时置信度下调。
- 使用统计只覆盖 `skill` 工具调用与 `subagent/catalog` label 匹配：`/name` 直接唤起不计入，label 由父 agent 自由撰写，存在漏配。
- 注入证据来自会话日志 `Instructions from:` 文本，harness 版本变化可能换格式；缺失按“无证据”处理并降置信度。
- 进化信号来自正则与 `isError` 的启发式匹配（纠错词、重复加载、追问、失败回合），误报和漏报都可能发生；写入经验前必须读证据。
- 经验文件只追加、不改写正文知识；自动优化只做结构搬运、块插入与描述重排，**不判断内容正确性**。
- 重叠/冲突检测基于词面（skills 用 IDF 加权余弦 + 名称加成，agents 用 description 相似度）：近义但用词完全不同的重复对象会漏报。
- 极薄的“路由型”技能/说明书会因缺少步骤、示例而被压低分，报告会标注正文行数，请结合类型看。
- 描述上限 500 是 DSH 默认，不同 profile / agent preset 可能不同，报告按插件配置口径。
- 撤销是“恢复备份”，会覆盖 apply 之后你手工做的改动；面板确认框会提示。
- 两套 rubric 的历史分数不可比（skills 2.0 之前的 `demand` 维度已更名为 `load`）；升级后的首次扫描不显示与历史分数的 delta。
