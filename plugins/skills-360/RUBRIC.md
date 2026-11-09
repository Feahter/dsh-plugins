# Skills 360 评分口径（Rubric 2.0）

> 目标不是“给 skill 打个好看的分数”，而是回答五个问题：
> 1. **按需加载**：catalog 里能不能在该触发的时候被选中？真实会话里它是否被按需加载过？和邻居的触发是否重复？常驻目录成本是否合理？——**判的是加载路径，不是内容价值**。
> 2. **渐进披露**：加载后是不是一次把几万字灌进上下文？细节有没有沉到 references/ 并按需读取？入口有没有索引告诉模型“什么时候读哪个文件”？
> 3. **可执行性**：模型读完能不能照做——步骤、命令、示例、决策分支、反模式。
> 4. **边界与维护**：说没说“什么时候别用”？链接还活着吗？有没有 TODO、密钥、危险命令？
> 5. **持续进化**：真实调用暴露的纠错/报错/重复加载，有没有沉淀成 `references/lessons.md` 并在下一次加载时按需读到？

所有扣分必须能落到一条**可复核的证据**（行号/原文/统计/会话信号）。分数是启发式，不是精确测量；报告必须展示口径与置信度，禁止用分数掩盖证据缺失。

**Rubric 2.0 的变更**（相对 1.0）：

- 原 `demand`「按需价值」维度更名为 `load`「按需加载」，权重 30 → 20。**“价值”不再是一个维度分数**：使用次数只作为“按需加载是否发生”的证据；低频不等于低价值，零加载也不能反推内容无价值。
- 渐进披露新增「按需索引」：references 存在时，入口必须有一个索引章节说明按需资源。
- 新增 `evolution`「持续进化」维度（10 分），并配套会话信号挖掘与经验写入。
- 版本变化导致历史分不可比：报告会把上一次扫描的对比视为无效，不显示 delta。

## 1. 总分与等级

- 六个维度合计 100：按需加载 20、渐进披露 25、可执行性 20、边界与治理 15、维护卫生 10、持续进化 10。
- 每个条目有 `max`；条目分数之和缩放到维度权重（应对 N/A）。
- 等级：`A >= 85`，`B >= 70`，`C >= 55`，`D < 55`。
- 置信度：`coverage=full` 且 usage 可用 → 0.9；缺 usage（样本不足）→ 0.8；`partial` → ≤0.5。
- 分数保留 1 位小数；条目分取整或 0.5 步进，便于解释。

**维度 N/A 的折算**：`evolution` 只在窗口内有按需加载、或已有经验、或已挖到信号时参与评分；否则该维度标 `applicable=false`、不占分，总分 = 其余五维之和 × 100 / 90。

## 2. 按需加载（20）

> 这一维只回答“加载路径是否成立”：目录里选得中 → 真实会话里按需加载过 → 触发不歧义 → 空闲成本合理。它**不判断内容价值**，因此不出现“值不值得保留”的扣分理由；`archive` 结论只描述“长期没有按需加载 + 无重叠”。

### 2.1 触发可选中性（12）

描述是 DSH 唯一的路由面：catalog 只注入 `name + description`（`whenToUse` 不进 catalog）。因此按下面计分：

| 子项 | 分 | 判定 |
|---|---|---|
| 触发句式 | 3 | 描述中出现 `Use when / Use this skill when / Use it when / Triggers?: / 当用户 / 使用...时 / 适用于 / 触发[:：]` 之一 → 3；否则 0 |
| 触发词密度 | 4 | 唯一触发词 ≥6 → 4；3–5 → 3；1–2 → 1；0 → 0。触发词 = 引号词、`/command`、触发句式后的短语、中英动词/名词词表命中（见 §2.6） |
| 前置核心 | 2 | 前 160 字符内出现触发句式，或出现该 skill 的核心动作动词（词表命中或与 name 语义相关）→ 2；前 40% 内 → 1；否则 0 |
| 长度适配 | 2 | 40 ≤ chars ≤ max → 2；max < chars ≤ 1.4×max → 1；chars < 40 → 0；> 1.4×max → 0（max 默认 500） |
| 非空泛开头 | 1 | 不以 `This skill / A skill for / Helps you / 本技能用于` 之类空泛句开头 → 1 |

### 2.2 按需加载证据（8）

只统计窗口内 `skill` 工具的加载调用（不是 catalog 展示）。`exposureDays = min(now - mtime, 365)`。

- `usage.sufficient = sessionsScanned >= 5 && usageAvailable && (exposureDays >= 14 || exposureDays >= 2 && (catalogSessions >= 30 || sessionsScanned >= 30))`。
  - `exposureDays` 优先用该技能在会话 catalog 中**首次出现**的时间（`firstSeen`），而不是文件 mtime（同步会重置 mtime）。
  - `catalogSessions` 是它实际出现在 catalog 里的会话数；今天刚加入的技能不会被昨天的零调用判死。
- 不足时该条 N/A，维度内其余条目按比例放大（同时在 detail 中写明“样本不足，未据此扣分”）。
- 足够时：
  - `count >= 5` 且 `lastUsedAt` 在 14 天内 → 8
  - `count >= 2` → 6
  - `count == 1` → 3（若 7 天内 → 4）
  - `count == 0` 且 `exposureDays >= 45` → 0（finding 只说“窗口内没有发生按需加载”，并提示核对真实说法/邻居抢触发，不推断价值）
  - `count == 0` 且 `exposureDays < 45` → 2（usage 充分但暴露不足 45 天时置信度再降 0.1）
- 1–4 次的 finding 严重度降为 `minor`，detail 明确“低频不等于低价值”。

### 2.3 路由唯一性（6）

对每个兄弟 skill 计算描述相似度：

```
cosine = IDF 加权余弦(overlapTokens(a), overlapTokens(b))
bonus  = 0.2 * 名称 token 重合率
m      = min(1, sqrt(cosine) * (1 + bonus))
```

IDF 来自本次扫描的整个 catalog：通用词（research、skill、使用）权重低，稀有词（拷问、pptx、PRISMA）权重高。直接 Jaccard 在真实中文长描述上会把所有对压到 0（实测 378 对全部 <0.25），所以这里做了 IDF + 名称加成；`sqrt` 用于把有意义的 0.05–0.24 区间拉开。取最大值 `m`：

- `m < 0.25` → 6
- `0.25 ≤ m < 0.45` → 4
- `0.45 ≤ m < 0.65` → 2
- `m ≥ 0.65` → 0

同时输出 `overlaps`（score ≥ 0.35 的邻居，最多 5 个）。

### 2.4 常驻成本（4）

`catalogChars = min(descriptionChars, max)`。

- 80–max → 4
- 40–79 或 max+1–1.4×max → 2
- <40 或 >1.4×max → 1
- 发生截断且触发句位于截断点之后 → 0

### 2.5 真实请求触发词校验（质量增强，不单独计分）

会话里每次 `skill` 加载前的最后一条真实用户消息（`source.kind === 'user'`，排除 time-context / runtime-context 等注入内容），与描述共享 ≥1 个触发词视为“命中”。

- `promptRecall = matched / total`（只算有 prompt 的加载）。
- `total >= 3 && recall < 0.4` → finding `load.prompt-mismatch`（minor）：说明用户实际说法与描述用词不匹配，附一条未命中 prompt 的摘要。这条不扣分，作为改描述的输入。

### 2.6 触发词表（可扩展）

英文：`use when, use this, trigger, when the user, when you, for tasks, workflow, review, debug, design, write, create, analyze, test, refactor, deploy, migrate, audit, optimize, generate, compare, plan, research, document, diagram, slide, paper, code, api, ui, data, security, performance, commit, release, install, configure, troubleshoot`
中文：`当用户, 使用时, 适用于, 触发, 用于, 帮我, 写, 做, 生成, 分析, 审查, 评审, 排查, 修复, 优化, 设计, 规划, 调研, 测试, 部署, 迁移, 重构, 审计, 对比, 总结, 文档, 论文, 引用, 图表, 幻灯片, 代码, 接口, 数据, 安全, 性能, 提交, 发布, 安装, 配置, 排错`

只统计描述（不含正文）中出现的**不同**词/短语。引号内短语与 `/xxx` 命令各算 1 个。

## 3. 渐进披露（25）

核心事实：`skill` 工具一次加载整篇 `SKILL.md`；`references/**` 只有模型主动去读才进上下文。所以入口文件应当是指针与决策，不是全书。

### 3.1 入口精简（8）

按 `estTokens(body)`：

| tokens | 分 |
|---|---|
| ≤ 1800 | 8 |
| ≤ 3500 | 7 |
| ≤ 6000 | 5 |
| ≤ 9000 | 3 |
| ≤ 14000 | 1 |
| > 14000 | 0 |

若 `bodyLines > 800`，最高 5 分；`> 1500` 最高 2 分。

### 3.2 细节外置（8）

- 正文 ≤1800 tokens：8（小 skill 不必强制 references）。
- 正文 >1800 tokens：
  - `referenceCount >= 2` 且 `referencedFiles >= 1` → 8
  - `referenceCount >= 1` 且 `referencedFiles >= 1` → 6
  - `referenceCount >= 1` 但 `referencedFiles == 0` → 2
  - `referenceCount == 0` → 0
- `orphanReferences > 0` 再 −1（最低 0）。
- 若 `brokenLinks.length > 0` 再 −1。

### 3.3 按需索引（5）

references 存在时，入口必须告诉模型“按需读什么”：

- `referenceCount == 0` 或 `referencedFiles == 0` → N/A（没有按需资源，或资源根本没接进入口——后者已由 §3.2 扣分，避免同一缺陷重复计分）。
- 索引章节标题匹配 `/参考|references?|资源|按需|索引|appendix|further reading/i`，统计其中出现的 references 路径数 `indexRefs`：
  - `referenceCount >= 2 && indexRefs >= 2` → 5
  - `indexRefs >= 1` → 4
  - 没有索引章节，但正文内联链接了 references → 2

finding `disclosure.index`：缺失 ≥2 分 → major，标题「references 没有入口索引」，建议在“参考资源”章节逐个写清什么时候读哪个文件。

### 3.4 分层入口（5）

- 有 ≥1 个 H2 标题 → +1；≥3 个 → +2（合计最多 2）
- 前 40 行出现 `Quick start / Overview / 快速开始 / 概览 / 决策 / 模式` 小节或 TOC → +1
- 存在编号步骤或“工作流/流程/步骤/Workflow”小节 → +1
- 首个 H2 是入口型（overview/quick/decision/workflow/模式/快速）→ +1

上限 5，下限 0。

### 3.5 维度硬上限（防止小项洗白大文件）

- `estTokens > 6000` → 本维度最高 16 分
- `> 12000` → 最高 12 分
- `> 20000` → 最高 8 分

一个 60KB 的入口不可能因为“有标题、代码块不超长”就成为良好渐进披露。上限单独生效，原因在
`disclosure.body` 的 finding 里说明。

### 3.6 无内联堆积（4）

- `maxCodeBlockLines ≤ 60` → 2；61–120 → 1；>120 → 0
- `codeRatio ≤ 0.35` → 2；≤ 0.55 → 1；> 0.55 → 0
- 无代码块 → 两项都满分（4）

## 4. 可执行性（20）

### 4.1 Frontmatter 完整（5）

- frontmatter 可解析 → 1
- `description` 非空 → 1
- `name` 符合 kebab-case → 1
- `name` 与目录名一致 → 2；不一致但合法 → 1
- `partial` coverage 时该项最多 3 分

### 4.2 操作步骤（6）

- 编号步骤 ≥5 → 6；3–4 → 5；1–2 → 3
- 无编号步骤：命令/代码块 ≥3 → 3；1–2 → 1；0 → 0

### 4.3 示例（4）

- 出现 `Example / 示例 / 例子 / Input / Output` 且配代码块/引号块 → 4
- 有代码块但无示例标识 → 3
- 只有示例标题、无内容 → 2
- 无 → 0

### 4.4 决策与反模式（5）

- 决策语言（`if / when / choose / otherwise / 如果 / 当...时 / 否则 / 选择 / 分支`）出现 ≥2 → 3；1 → 2；0 → 0
- 反模式（`anti-pattern / pitfall / avoid / don't / 不要 / 禁止 / 避免 / 常见错误`）出现 → +2
- 上限 5

## 5. 边界与治理（15）

### 5.1 何时不用（6）

- 正文有独立“不适用/When not to use/Do not use”小节 → 6
- 只在描述或行内出现 `不适用 / not for / do not use`（未独立成节）→ 3；报告会区分“没有”与“只写在行内”。
- 无 → 0

### 5.2 兄弟区分（5）

- `overlapMax < 0.35` → 3；0.35–0.55 → 2；>0.55 → 0
- 描述/正文点名兄弟 skill，或出现 `vs / 与...区别 / 区别 / instead / 不要用` → +2
- 上限 5

### 5.3 中英触发覆盖（4）

- 描述同时含 CJK 与拉丁字母 → 4
- 仅一种 → 2
- 都没有（纯符号）→ 0

## 6. 维护卫生（10）

### 6.1 占位与未完成（3）

代码块外出现 `TODO:` / `TBD:` / `FIXME` / `XXX` / `待补充` / `待完善` / `尚未完成` → 0；否则 3。

注意：`占位符`、`占位示例` 是技术术语，不算未完成标记（实测误判过 playbook）。

### 6.2 链接与资源（3）

- 无本地链接 → 3（N/A）
- 本地链接全部可解析（存在） → 3
- 存在失效链接 → 1
- references 目录里的文件在 SKILL.md 中完全未提 → 2

### 6.3 安全（2）

出现以下任一 → 0，否则 2：
- `curl ... | sh` / `wget ... | bash`
- `rm -rf /`（或明显根目录删除）
- `chmod 777`
- 私钥块 `BEGIN ... PRIVATE KEY`
- 形似真实密钥的长 token（`sk-`、`ghp_`、`AKIA` + ≥16 字符）
- `eval` 拼接用户输入（启发式）

### 6.4 体积与重复（2）

- 重复 H2 标题 >0 → 0
- `bodyChars > 200_000` → 0
- 否则 2

## 7. 持续进化（10）

> 技能不是写完就定型：真实调用会暴露“该先做 X 却做了 Y”“触发被邻居抢走”“加载后又报错”这类可复用经验。持续进化维度衡量这些经验有没有被沉淀、并接回按需加载路径。

经验存放在 `references/lessons.md`，格式：

```md
- [2026-11-09] 触发：用户说“不要改测试” → 做法：先跑现有测试再改实现（证据：session abc123）
```

`linked` = SKILL.md 正文是否链接到 `references/lessons.md`。

### 7.1 经验沉淀（5）

- `lessons >= 3` 且 `linked` → 5
- `lessons >= 1` 且 `linked` → 4
- `lessons >= 1` 但未链接 → 2（经验写了但下次加载读不到）
- `lessons == 0` → 0

### 7.2 经验新鲜度（3）

- 最近一条在 90 天内 → 3
- 180 天内 → 2
- 365 天内 → 1
- 更旧 → 0

### 7.3 信号闭环（2）

信号 = 窗口内该技能加载后 120 分钟内的纠错、工具报错、追问、失败回合，以及同一会话里的重复加载。
超过时间窗的后续事件不归因（避免把几小时后无关任务的错误算到技能头上）；工具报错的证据带失败工具名。

- 有经验且最近信号不晚于最新经验日期（按天粒度）→ 2
- 有经验但最近信号晚于最新经验日期 → 1
- 无经验且有待闭环信号 → 0
- 无信号且无经验 → N/A

### 7.4 适用性与折算

`applicable = loads > 0 || lessons > 0 || pendingScore > 0`。

- 为 false：该维度不评分，其余五维按 90 分折算为 100。
- 为 true：正常计 10 分。

finding：
- 有加载但 0 经验 → 「有真实调用，但没有沉淀任何经验」（minor，建议 `fix.add-lesson`）。
- 有待闭环信号（`corrections*3 + postLoadErrors*2 + reloads*2 + turnFailures*2 + asks`，且经验早于最近信号）→ `evolution.pending`（pendingScore≥4 为 major，否则 minor），附一条证据摘要。
- 经验未链接 → `evolution.unlinked`（major，建议把 lessons.md 接进入口）。

## 8. 结论（verdict）

按顺序判定：

1. `archive`：`total < 55` 且 `usage.sufficient` 且 `usage.count == 0` 且 `exposureDays >= 60` 且 `overlapMax < 0.5`
2. `merge`：存在兄弟 `overlap >= 0.6` 且兄弟总分 ≥ 本 skill + 5
3. `watch`：`total < 70`，或 `usage.sufficient && usage.count == 0 && exposureDays >= 30`
4. `keep`

`reason` 必须引用具体证据（分数、调用次数、重叠对象）。`archive` 的措辞是“长期没有按需加载”，不是“没有价值”。

## 9. Findings 与 Suggestions

- 每个丢失 ≥2 分的条目生成一条 finding。严重度先按风险类别（如安全=critical、入口过大=critical），再按 loss 调整：declared critical 但 loss<6 → major/minor；declared major 但 loss<4 → minor。
- `info` 用于不扣分但值得知道的事实（如描述被截断、零加载但样本不足）。
- 每条 finding 带 `evidence`（行号/原文片段/会话证据）与 `actionIds`（可空）。
- suggestion 的 `kind`：
  - `auto`：机械、内容无损、可撤销。至少包括：
    - `fix.link-references`：references 存在但正文未链接 → 追加“参考资源”清单。
    - `fix.extract-sections`：正文 >3500 tokens 且存在参考型 H2（标题含 reference/api/appendix/example/troubleshoot/checklist/template/参考/附录/示例/清单/排错/模板/详细）且该节 ≥60 行 → 逐字搬到 `references/`，原位留 2–4 行指针。
    - `fix.frontload-triggers`：触发句位于描述 60% 之后 → 把触发句移到第一句之后（不删字）。
  - `draft`：会生成或删除文字，需单条点击：
    - `fix.rewrite-description`：描述缺少触发句式时，生成 “<摘要>. Use when: <触发词 3–6 个>” 草稿。
    - `fix.trim-description`：描述 > 1.4×max → 在句界截到 ≤max 并保留触发句；会删字，因此不算无损。
    - `fix.add-boundary`：缺“何时不用”时追加一个带空条目的骨架（明确标注“请补充”）。
    - `fix.add-lesson`：有待闭环信号时给出经验草稿（trigger/evidence 由证据填，rule 由你补）；直接 apply 会因“做法为空”被拒绝，需用 `skills360_evolve` 或面板编辑器写入。
  - `manual`：无法安全自动修（坏链、TODO、重叠合并、危险命令），只给建议。
- 应用后必须重新分析，并返回分数变化（`beforeTotal → afterTotal`）。
- 不承诺分数一定上升：提取章节可能降低示例分；若下降，报告里如实显示并说明。

## 10. 组合级分析（Portfolio）

- 固定目录成本：所有启用的 `catalogChars` 之和 → token 估算，展示“每次会话固定注入”。
- 全量加载成本：所有 `estTokens` 之和，展示“若全部加载”的量级。
- 重叠对：`overlap ≥ 0.4` 全量列出；标记 merge 候选需要一方 verdict 已被判为 merge（即重叠 ≥0.6 且对方总分高 ≥5）。
- 零按需加载 + 陈旧（>90 天未改）清单、描述截断清单、失效链接/危险模式清单。
- Quick wins：auto 动作按预计提分排序，最多 8 条。
- 持续进化：`skillsWithLessons`、`lessonsTotal`、`pendingSkills`、`signalsTotal`；`portfolio.evolution` 列出待闭环技能（≤10，pendingScore 降序）。

## 11. 已知局限（必须写进报告）

- 分数是启发式，不能替代人读；`partial` 或 usage 不可用时置信度下调。
- 使用统计只覆盖 `skill` 工具调用，不包含用户 `/name` 直接唤起（若宿主不经工具）。
- 会话信号来自本地会话日志的启发式匹配：纠错词、`isError`、重复加载、追问、失败回合；误报和漏报都可能发生，需人确认后再写入经验。
- 经验文件只追加不改写正文知识；自动优化只做结构搬运与描述重排，不判断内容正确性。
- 描述上限 500 是 DSH 默认；不同 profile / agent preset 可能配置不同，报告按插件配置口径。
- 重叠检测基于词面，近义不同词的重复 skill 可能漏报。
- Rubric 2.0 与 1.0 分数不可比；升级后的首次扫描不显示与历史分数的 delta。
