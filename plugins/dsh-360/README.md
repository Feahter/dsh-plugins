# dsh-360

> v0.2.0：四轴分类标签、快照秒开、优化效果可见、扫描提速约 3×。

> **一个插件，两面体检。** 「技能」tab 判 Harness 技能目录的**加载路径**：catalog 里能不能被按需选中、加载后是不是一次灌进几万字、读完能不能照做、有没有说清什么时候别用、真实调用里的教训有没有沉淀。「Agents」tab 判**常驻说明书 / 子代理定义 / agent 预设**的**注入路径**：规则真的进了上下文吗、是不是把所有东西塞进常驻前缀、跨文件有没有互相打架。
> 两面共用一套六维权重、一套 **S~E × ± 18 档**等级表、一个侧栏面板、一份备份与报告目录。**每次写入都有备份、可撤销**；保留最近 `backupsKeep`（默认 20）份，且当前「上次优化」引用的备份不会被保留策略淘汰。信号只在本机读取，不出机器。

## 为什么合并成一个插件

`skills-360` 与 `agents-360` 本来是两份同构实现：同样的六维（20 / 25 / 20 / 15 / 10 / 10）、同样的备份撤销、同样的面板交互，只是一个扫技能目录、一个扫 agent 配置层。分成两个包带来三个实际成本：

1. **同一批证据扫两遍**：两个 surface 都读本机会话日志（`Instructions from:`、`skill` 加载、`subagent/catalog`、`agent-preset/selected`），日志是**多帧 zstd**，扫一次比扫两次便宜。
2. **两套等级不可比**：skills 原来用 A/B/C/D，agents 也用 A/B/C/D，但你没法说「这个技能 86 分」和「这份 AGENTS.md 84 分」谁更该先修。合并后统一 18 档，字母表健康度、`+/-` 表字母内位置，跨 surface 直接可比。
3. **两个侧栏入口**：两份面板抢同一个侧栏，用户要在两个地方找同一件“体检”的事。

所以 dsh-360 = 一个包 + 一套宿主 + 一个面板 + 两个 tab（`技能` / `Agents`）。评分口径仍是各自的原版 rubric（skills 2.0 / agents 1.0），只统一等级制与输出形状，见 [RUBRIC.md](RUBRIC.md)。

## 两个 surface

| surface | 体检对象 | 六维 |
|---|---|---|
| `skills` | catalog 里的每个 skill（`SKILL.md` + `references/**`） | 按需加载 20 / 渐进披露 25 / 可执行性 20 / 边界与治理 15 / 维护卫生 10 / 持续进化 10 |
| `agents` | `instruction`（AGENTS.md / CLAUDE.md）、`agent`（子代理定义）、`preset`（预设/profile 运行配置） | 注入命中 20 / 分层与精简 25 / 可执行性 20 / 边界与治理 15 / 维护卫生 10 / 持续进化 10 |

`agents` 的默认扫描根：`cwd`、`~/.agents`、`~/.deepseek`，core 再补扫 `~/.claude` 与 `~/.dsh/agents`（config `roots` 非空时只扫给定根，`maxDepth` 默认 6）。

## 分类标签系统（v0.2）

每个技能/对象带**四轴分类**，由 [`lib/taxonomy.js`](lib/taxonomy.js) 单一实现，UI、Markdown 报告、agent 工具输出共用同一套 id 与中文标签：

| 轴 | 取值 | 回答的问题 |
|---|---|---|
| 职责 `role` | 编排调度 / 审查验证 / 研究分析 / 写作表达 / 设计呈现 / 编码实现 / 知识管理 / 运维治理 / 通用工具 / 其他 | 这堆技能/代理里，哪类是审查、哪类是编排？ |
| 层级 `layer`（仅技能） | 元技能 / 任务技能 | 它是在管理/优化 agent 自身（技能、提示词、上下文），还是在做业务任务？ |
| 类型 `kind` | 技能：分层参考 / 带脚本 / 路由入口 / 单文件（按结构）；对象：常驻说明书 / 子代理定义 / 运行预设 | 它是什么形态、加载成本大概怎样？ |
| 范围 `scope` | 内置 / 全局 / 项目 / 技能内 / 配置 / 自定义 | 改它影响谁？ |
| 状态 `state` | 在用 / 闲置 / 未观测 / 待沉淀 / 有重叠 / 有严重问题 / 失效引用 / 跨文件冲突 | 现在要不要动它？ |

- 职责是**确定性的关键词打分**（name ×3、description ×1，并列按 review→…→utility 顺序），带 `confidence` 与 `evidence`；命中不到就是「其他」，不编造。
- 机器侧拿到稳定 `tags`（`role:review`、`kind:layered`、`scope:global`、`state:idle`）；人类侧只看到中文 label 与计数。
- 完整规则、词表与局限见 [TAXONOMY-SPEC.md](TAXONOMY-SPEC.md)；分类是导航，不参与评分。


## 安装

用 plugin_manager 装 bundle（自动写 profile 依赖与 `dsh.profile.bundles`）：

```
plugin_manager install_bundle target = link:/Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/dsh-360
```

手工等价：把 `dsh-360` 以 `link:` 加进 profile 的 `package.json` dependencies，把 [cordis.patch.yml](cordis.patch.yml) 里的那一行 `insert` 追加到 profile 的 `cordis.patch.yml`，再刷新 Web 页面。

> 不要和 `skills-360` / `agents-360` 同时启用：同一批文件会被两套宿主重复扫描与写入（写入各自备份，但面板会重复列同一对象）。

## 面板（human-first，v0.2）

侧栏点 **「360 体检」**（order 41），主区是单面板 + 顶部双 tab。界面只做三件事：**一眼看懂、两下筛到、看到变化**。

- **首屏不等待**：先读上次快照（`/scan?quick=1`）立即渲染，带「更新于 X，正在刷新」；后台全量扫描完成后原地替换。启动 1.5s 后后台预热（`warmup: false` 可关闭），首开直接命中快照。
- **按需加载**：挂载只扫当前 tab；切到 Agents 才扫 Agents，另一面不抢 CPU。
- **头部一句话**：「62 个技能，9 个待处理；最该先看 office-export-pdf」+ 数据时间 + 较上次变化。
- **筛选收进图标**：列表顶部只保留搜索框 + 一个「筛选」图标；职责/层级/类型/范围/等级/结论/来源全部收进可展开面板，激活项在图标上显示数量，可一键清空。面板默认收起，把纵向空间留给列表（列表列宽也放宽到 280–370px）。
- **列表行**：名称 + 一句话 summary + 职责/类型/范围三个中文 pill + 18 档等级 + 分数 + 带符号的变化；状态用「圆点 + 文字」，不只靠颜色。
- **详情**：分类卡（四轴 + 命中证据 + 置信度，可一键按职责筛选）、六维得分、指标、发现（行号/原文/会话证据）、建议（`可一键` / `需确认` / `仅建议`）、重叠/冲突对象。
- **优化效果**：应用后顶部出现效果卡「本次优化：3 项，分数 72.3 → 78.9（+6.6），省 1,240 tokens」，可撤销；下次打开仍能看到「上次优化」。token 增加时如实显示 `+N`，不假装省了。
- 加载用骨架屏；空/错误/**部分失败**（一面挂了另一面仍可用）都有明确状态；尊重 `prefers-reduced-motion`。

## 四个 Agent 工具

`surface` 决定检谁：`'skills'` = 技能目录；`'agents'` = 说明书 / 子代理定义 / 预设；`'both'` = 两面都跑（返回 `{ surfaces: { skills?, agents? } }`）。

| 工具 | 参数 | 用途 |
|---|---|---|
| `dsh360_scan` | `surface='both'`, `windowDays?`, `refresh?`, `cwd?`, `detail='summary'｜'full'`, `kind?` | 体检并返回 totals + subjects；`detail="full"` 带全部 findings/suggestions |
| `dsh360_report` | `surface='both'`, `names?`, `ids?`, `detail?`, `save?` | 生成中文 Markdown 报告，两 surface 分节；`save=true` 落 `<data>/reports/dsh-360-<stamp>.md` |
| `dsh360_optimize` | `surface`, `names?`, `ids?`, `actionIds?`, `safeOnly=true`, `dryRun=true` | 按建议优化；`dryRun` 默认 true，写盘前备份 |
| `dsh360_evolve` | `surface`, `names?`, `ids?`, `name?`, `id?`, `lesson?{trigger,rule,evidence}`, `dryRun=true` | 挖信号并给经验提案（默认 dryRun）；`dryRun=false + name + lesson` 写入并接回入口 |

示例：

```
dsh360_scan surface=skills detail=full —— 哪些技能近 30 天零按需加载且与邻居重叠？
dsh360_report surface=both save=true —— 两面合成一份中文报告落盘。
dsh360_optimize surface=agents dryRun=true —— 先看会把哪几节搬到 agent-notes/。
dsh360_evolve surface=skills —— 哪些技能刚被纠正过但还没沉淀经验。
```

## 路由

前缀 `/api/dsh-360/skills/*` 与 `/api/dsh-360/agents/*`，各自：`GET /scan`、`GET /detail`（`?name=` / `?id=`）、`POST /apply`、`POST /apply-all`、`POST /undo`、`GET /backups`、`POST /export`、`POST /evolve`。另有 `GET /api/dsh-360/health` → `{ surfaces: ['skills','agents'], version }`。鉴权与面板同源，复用 `connection.requestRejection`；缺该服务时 fail closed（503）。

## 18 档等级表

`lib/grade.js` 是唯一实现，任何地方不得写死阈值。字母 = 健康度，`+ / -` = 字母内位置，`rank` 越小越好。

| 档位 | 下限（≥） | rank | | 档位 | 下限（≥） | rank | | 档位 | 下限（≥） | rank |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S+ | 96 | 0 | | A+ | 87 | 3 | | B+ | 79 | 6 |
| S | 93 | 1 | | A | 84.5 | 4 | | B | 75.5 | 7 |
| S- | 90 | 2 | | A- | 82 | 5 | | B- | 72 | 8 |

| 档位 | 下限（≥） | rank | | 档位 | 下限（≥） | rank | | 档位 | 下限（≥） | rank |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C+ | 68 | 9 | | D+ | 55 | 12 | | E+ | 37 | 15 |
| C | 64 | 10 | | D | 50 | 13 | | E | 28 | 16 |
| C- | 60 | 11 | | D- | 45 | 14 | | E- | 0 | 17 |

字母含意：S 卓越 / A 优秀 / B 良好 / C 及格 / D 偏弱 / E 危险。示例：`86.4 → A 优秀`、`84.5 → A`、`84.49 → A-`、`74.9 → B-`。阈值是闭区间下限，不做四舍五入。

## 会写什么、不会写什么

- **skills**：只写 `<skill>/SKILL.md` 与 `<skill>/references/*.md`（含 `references/lessons.md`）；拒绝绝对路径、`..`、`\\` 与符号链接逃逸，Host 在 core 之上再校验一次。
- **agents**：只写 subject 自身文件、同目录 `agent-notes/**`、`.agents-360/lessons.md`。
- **只读 surface**：`source: profile-config` 的 subject（预设、无独立 prompt 文件的子代理分层）只读，host 拒绝 apply。
- **备份**：每次写盘前把原文件复制到 `<DSH_HOME>/dsh-360/backups/<surface>/<backupId>/`，保留最近 `backupsKeep`（默认 20）份；撤销前把当前状态快照到同目录 `pre-undo/`，所以“撤销”不会静默吞掉你 apply 之后的编辑。
- **不写**：`node_modules`、app.asar、其他插件目录、会话日志。扫描与信号摘要在本机生成（≤160 字符），只出现在报告/面板里，不写入技能、不发往网络。
- 关闭信号挖掘：config 设 `evolution: false`，此时两个 surface 的 `evolution` 维度都不评分，其余功能不变。

## 数据

`<DSH_HOME>/dsh-360/`：`backups/<surface>/`、`reports/`、`state.json`、`cache/<surface>-portfolio.json`（首屏快照）、`cache/<surface>-last-apply.json`（上次优化效果）。原始会话文件永不修改。

## 秒开与性能（v0.2）

| 指标 | v0.1 | v0.2 | 手段 |
|---|---|---|---|
| 真实数据 agents 冷扫描（86 个对象 / 137 个会话） | 8.5–9.9s | **2.76s（5 次中位数，2.71–2.87）** | 冲突检测预计算 + 倒排候选；文本归一化/分词记忆化；会话日志无关行快路径 |
| 双 surface 的会话解析 | 同一批日志解析两遍 | **只解析一遍** | `collectUsage` 进程内单飞 + 30s TTL；双面未单独计时，单面 agents 基准 2.87s |
| 面板首屏（已有快照） | 8s+ | **~6ms 读快照 + 一次渲染** | `/scan?quick=1` 列表快照（~110–200KB，不带正文/维度/发现/建议） |
| 面板全量刷新载荷 | 3.7MB（含 86 份正文/发现/建议） | **~110–200KB** | 面板改走 `/scan?view=list`；正文/维度/发现/建议按需走详情 |
| 第二次扫描（60s 内） | 重扫 | ≤150ms | 原有 60s portfolio 缓存 + 预热复用同一 promise |

性能探针：`node scripts/bench-scan.mjs --surface agents --runs 5`。冲突检测的语义等价性由 `test/perf.test.mjs` 对拍暴力实现保证；缓存单飞也有独立用例。

## 已知局限

- 分数是启发式，不能替代人读；`partial` 覆盖或会话样本不足时置信度下调（skills 下限 0.2，agents 下限 0.3）。
- 使用统计只覆盖 `skill` 工具调用与 `subagent/catalog` label 匹配；`/name` 直接唤起不计入，label 由父 agent 自由撰写，存在漏配。
- 注入证据依赖会话日志 `Instructions from:` 的文本格式，harness 版本变化可能换格式；缺失按“无证据”处理并降置信度。
- 进化信号是正则 + `isError` 的启发式匹配，会误报/漏报；写入经验前请读证据。经验只追加，不改写正文知识。
- 重叠/冲突检测基于词面（skills 用 IDF 加权余弦 + 名称加成，agents 用 description 相似度），近义但用词完全不同的重复对象会漏报。
- 极薄的路由型技能/说明书会因缺少步骤、示例被压低分；报告会标注正文行数，请结合类型看。
- 其他工具方言（Codex `.toml`、opencode `.jsonc`）v1 不纳入评分。
- 分类是关键词启发式，不是语义理解：`其他` 是诚实的兜底，近义词/名词变形可能漏判（例如无描述的子代理）；UI 会同时给出置信度与命中证据，请结合 `kind/scope` 一起看。
- 两套 rubric 的历史分数不可比；升级后的首次扫描不显示与历史分数的 delta。

## 开发与验证

```bash
cd /Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/dsh-360
node test/run-all.mjs     # 语法 + grade/skills/agents 单测 + host 验证 + client 验证
node scripts/probe.mjs            # 真实数据探针（agents core，无需 DSH 运行时）
node scripts/probe-host.mjs       # 用 mock Cordis context 跑一次 agents scan（不写技能文件，但刷新 state/cache）
```

## 目录

```
dsh-360/
  index.js            # 宿主：两个 surface 的路由/工具/缓存
  client.js           # 单面板 + 双 tab（DSH client module）
  lib/grade.js        # 18 档等级唯一真源
  lib/skills/**       # 技能评分内核（移植自 skills-360）
  lib/agents/**       # agent 配置评分内核（移植自 agents-360）
  lib/usage.js        # 会话日志扫描 → 两 surface 共用的 digest
  lib/host-skills.js  # 技能 surface 宿主
  lib/host-agents.js  # Agents surface 宿主
  test/               # 单测 + run-all + 两个 verify harness
  scripts/            # 本地探针
```
