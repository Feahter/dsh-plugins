# dsh-360

> **一个插件，两面体检。** 「技能」tab 判 Harness 技能目录的**加载路径**：catalog 里能不能被按需选中、加载后是不是一次灌进几万字、读完能不能照做、有没有说清什么时候别用、真实调用里的教训有没有沉淀。「Agents」tab 判**常驻说明书 / 子代理定义 / agent 预设**的**注入路径**：规则真的进了上下文吗、是不是把所有东西塞进常驻前缀、跨文件有没有互相打架。
> 两面共用一套六维权重、一套 **S~E × ± 18 档**等级表、一个侧栏面板、一份备份与报告目录。**所有写入都有备份、可撤销**；信号只在本机读取，不出机器。

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

## 安装

用 plugin_manager 装 bundle（自动写 profile 依赖与 `dsh.profile.bundles`）：

```
plugin_manager install_bundle target = link:/Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/dsh-360
```

手工等价：把 `dsh-360` 以 `link:` 加进 profile 的 `package.json` dependencies，把 [cordis.patch.yml](cordis.patch.yml) 里的那一行 `insert` 追加到 profile 的 `cordis.patch.yml`，再刷新 Web 页面。

> 不要和 `skills-360` / `agents-360` 同时启用：同一批文件会被两套宿主重复扫描与写入（写入各自备份，但面板会重复列同一对象）。

## 面板

侧栏点 **「360 体检」**（order 41），主区是单面板 + 顶部双 tab：

- **技能 tab**：技能数、平均分、S/A/B/C/D/E 分布、catalog 固定成本、全量加载成本、零按需加载 / 描述截断 / 失效链接 / 重叠对 / 待进化清单；列表按分数、等级、结论、来源、严重问题筛选。
- **Agents tab**：subject 数（instruction / agent / preset 分列）、常驻 token 与占 200k 上下文的比例、零注入清单、跨文件冲突、quick wins。
- 右侧详情：六维得分 + 指标 + 发现（带行号/原文/会话证据）+ 可执行建议（`可一键` / `需确认` / `仅建议`）+ 重叠/冲突对象。
- 等级展示用 18 档 code，筛选用字母（S/A/B/C/D/E）；颜色 S 金、A 绿、B 蓝、C 琥珀、D 橙、E 红。
- 加载中 / 错误 / 空 / **部分失败**（一个 surface 挂了另一个仍可用）都有明确状态。

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

`<DSH_HOME>/dsh-360/`：`backups/<surface>/`、`reports/`、`state.json`。原始会话文件永不修改。

## 已知局限

- 分数是启发式，不能替代人读；`partial` 覆盖或会话样本不足时置信度下调（skills 下限 0.2，agents 下限 0.3）。
- 使用统计只覆盖 `skill` 工具调用与 `subagent/catalog` label 匹配；`/name` 直接唤起不计入，label 由父 agent 自由撰写，存在漏配。
- 注入证据依赖会话日志 `Instructions from:` 的文本格式，harness 版本变化可能换格式；缺失按“无证据”处理并降置信度。
- 进化信号是正则 + `isError` 的启发式匹配，会误报/漏报；写入经验前请读证据。经验只追加，不改写正文知识。
- 重叠/冲突检测基于词面（skills 用 IDF 加权余弦 + 名称加成，agents 用 description 相似度），近义但用词完全不同的重复对象会漏报。
- 极薄的路由型技能/说明书会因缺少步骤、示例被压低分；报告会标注正文行数，请结合类型看。
- 其他工具方言（Codex `.toml`、opencode `.jsonc`）v1 不纳入评分。
- 两套 rubric 的历史分数不可比；升级后的首次扫描不显示与历史分数的 delta。

## 开发与验证

```bash
cd /Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/dsh-360
node test/run-all.mjs     # 语法 + grade/skills/agents 单测 + host 验证 + client 验证
node scripts/probe.mjs            # 真实数据探针（agents core，无需 DSH 运行时）
node scripts/probe-host.mjs       # 用 mock Cordis context 起真实 host 跑一次 scan（只读）
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
