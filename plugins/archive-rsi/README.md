# dsh-archive-rsi

归档会话管理 + PDCA 数据炼金：把 DeepSeek Harness 的历史会话变成可度量、可回滚的上下文改进。

一个 DSH bundle 插件，两件事：

1. **归档（CRUD）** — Harness 自己有归档开关（`archiveSession`，落在 `~/.dsh/storages/workspace.json` 的 `archivedSessionIds`，被归档的会话会被运行时拦截、拒绝继续跑）。但它只有「开/关」：没有标签、备注、检索、指标、跨会话视图。本插件**只读镜像**这个权威状态（`harnessArchived` / `harnessPinned`），在它之上补一层自己的策展数据，**绝不另建一套归档状态、不修改原始会话文件**。
2. **炼金（PDCA + RSI）** — 对归档语料跑 Plan → Do → Check → Act，产出「上下文补丁」（prompt 规则 / AGENTS.md 规则 / 技能候选），采纳后在后续会话上重新度量，形成闭环。这是工具层的递归自我改进（RSI）：度量 → 改上下文 → 再度量。

纯本地计算，不调用任何 LLM；所有数字都来自会话事件日志，不做推测。

---

## 为什么不是又一个上下文面板

已有的 `dsh-context` 是把 prompt 前缀/后缀抄进系统提示，`dsh-skill-hub` 是管理技能目录。它们都不回答一个问题：**这次改动之后，协作质量真的变好了吗？**

本插件的差别只有三点：

- **有证据**：每条提案都带 `sessionId + seq`，能回到原始事件。
- **可回滚**：采纳前写备份，`rsi_adopt --revert` 精确还原。
- **可证伪**：采纳时间点把语料切成前后两段，用同一套指标对比，`improved / regressed / inconclusive` 三态，样本不足就直说 `inconclusive`。

---

## 安装

```bash
# 1) 目录已在工作区：<workspace>/archive-rsi
# 2) 装进 profile（以 desktop 为例）
cd ~/.dsh/profiles/desktop
pnpm add link:/Users/fuzhuo/Documents/deepseek-harness/default-workspace/archive-rsi
```

然后在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里加一行
`"dsh-archive-rsi"`，在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加：

```yaml
- insert:
    - id: archive-rsi
      name: 'dsh-archive-rsi'
```

重启 Harness（或让 Loader 重新加载该行）后，侧边栏出现「归档炼金」入口，模型侧出现
`archive_*` / `rsi_*` 工具。

卸载：删掉上面两处 + `pnpm remove dsh-archive-rsi`。插件数据在
`~/.dsh/archive-rsi/`，直接删掉即可，不影响任何会话文件。

---

## 工具面

### 归档 CRUD

| 工具 | 作用 |
|---|---|
| `archive_sync` | 扫描会话目录，导入/刷新归档（幂等：内容没变就跳过；损坏文件记入 `failed` 不中断） |
| `archive_list` | 按全文/标签/状态/工作区/**Harness 归档标记**筛选，返回每条的标题、时间、工作区、`harnessArchived` 与头部指标 |
| `archive_get` | 单条详情：元数据 + 事实（轮次、每工具调用/错误、上下文压力、编辑-验证缺口、重复调用），可选渲染后的 Markdown 记录 |
| `archive_update` | 改标题 / 标签 / 备注 / 状态（`archived` / `pinned` / `trash`） |
| `archive_delete` | 移出归档（进回收站）或 `purge` 连派生文件一起删；**原始会话文件永远不动** |
| `archive_autotag` | 按规则重算自动标签（单条或全库），`dryRun` 只算不写 |

### PDCA / RSI

| 工具 | 阶段 | 作用 |
|---|---|---|
| `rsi_plan` | Plan | 固定语料 cohort（默认就是 Harness 里被归档的会话；一个都没有时退回最近窗口并在 `cohort.source` 里写明）与目标指标（默认：工具错误率 ≤5%、纠正率 ≤15%、验证缺口率 ≤30%、P90 上下文占用 ≤60%、工具目录 ≤48KB） |
| `rsi_run` | Do + Check | 先增量 sync，再算指标，与目标比、与上次 run 比，落盘 |
| `rsi_act` | Act | 把 findings 变成提案（prompt 教训 / AGENTS.md 规则 / 技能候选 / 只读建议） |
| `rsi_adopt` | 采纳 | 应用或回滚一条提案（备份 + journal + 撤销） |
| `rsi_status` | 闭环 | 语料概况、最近 run、待办提案，并对已采纳提案做「采纳前 vs 采纳后」重估 |

---

## 「持续」是怎么做到的

插件不能给自己排定时器（Harness 的 schedule 服务是会话提醒，插件不该占用一个会话），所以
连续性锚在**进程生命周期**上：每次 Harness 启动 → 增量 sync → 如果上一次 run 已经超过
`autoRunEveryDays`（默认 7 天）→ 后台跑一轮 Plan/Do/Check，并按 `autoPropose` 生成提案。
采纳永远要人或 agent 显式调用 `rsi_adopt`（唯一例外是 `autoAdopt` 开启时的单条 prompt 教训，
它只写在插件自己的 `lessons.md` 里，碰不到任何用户文件）。

于是每次启动都在既有语料上重新度量一次，指标序列与 `journal.jsonl` 一起构成可回溯的 RSI 轨迹。

## 自动标签

每次 sync（以及 `archive_autotag`）都会从 `SessionFacts` 派生一组 `auto:*` 标签。**不调用模型**：
一条标签要么是日志里的事实，要么不写。规则见 [DESIGN §10](./DESIGN.md)：

| 前缀 | 触发条件 | 例 |
|---|---|---|
| `auto:err.<code>` | 某个错误码累计 ≥3 次（取众数） | `auto:err.fs_stale_version` |
| `auto:gap.verify` | 有编辑、但最后一次编辑后没有任何检查命令 | — |
| `auto:fail.turn` | 回合以 error / max-tokens / aborted / interrupted 结束 | — |
| `auto:repeat` | 同工具同参数被重复调用 | — |
| `auto:correction` | 用户纠正过（与 §5.1 同一套正则） | — |
| `auto:origin.*` / `auto:preset.*` | 是谁跑的、跑在哪个预设下 | `auto:origin.subagent`、`auto:preset.router` |
| `auto:ctx.pressure` / `auto:ctx.heavy` | 上下文峰值 ≥60% / 30–60% | — |
| `auto:cost.high` | token 用量 ≥ 同批中位数 3 倍且 ≥20 万 | — |
| `auto:scale.long` | ≥100 步 | — |
| `auto:tool.<name>` | 调用次数最多的 2 个工具（各 ≥5 次） | `auto:tool.bash` |
| `auto:lang.zh` / `auto:lang.en` | 人类消息里中日韩字符 ≥30% / 拉丁字母 ≥70% | — |

生命周期是「手动优先、自动可重算」：重算时只删除**上次由插件自己写的**那批（记录在
`entry.autoTags`），手动标签永远保留；`autoTag: false` 会关掉 sync 时的派生，已有标签不动。
标签仍是 `[a-z0-9._:-]`、单条 ≤32 字符、每条会话合计 ≤24 个，采集按「问题类 → 身份类 →
规模类 → 工具类 → 语言类」的优先级截断。

## 度量口径（都可复算）

单会话事实（`SessionFacts`）只做计数，不做判断：

- `toolErrors`：`tool/result.message.isError === true`
- `edits` / `checks`：写类工具调用（含真正落盘的 shell 重定向；`2>/dev/null` 这类不算）、
  验证类命令（test/build/lint/`--check` …），以及 `afterLastEditChecks` —— **最后一次编辑之后是否还有验证动作**
- `repeated`：同工具 + 同参数哈希在一次会话内重复 ≥2 次
- `peakContextRatio`：`max(usage.inputTokens) / request/context.contextWindow`
- `catalog`：最后一次 `request/header` 里模型实际看到的工具目录（字节数、工具数）
- `humanTexts`：只取 `user/message.source.kind === 'user'`，Harness 注入的运行时快照、
  技能目录、指令文件都不算人类输入

语料级（`CohortMetrics`）在此基础上给出比率与分位数，10 条规则（R1–R10）负责把它变成
带证据的 finding：工具错误热点、参数校验失败、重复调用、编辑后无验证、用户纠正率、
上下文压力、工具目录膨胀、轮次失败率、单会话错误风暴、成本离群。

---

## 配置

```yaml
- id: archive-rsi
  name: 'dsh-archive-rsi'
  config:
    rootDir: ''            # '' → <DSH_HOME>/archive-rsi
    sessionsDir: ''        # '' → <DSH_HOME>/sessions
    days: 30               # 默认 cohort 窗口
    limit: 40              # 默认 cohort 会话数
    protocolSection: true  # 注入协议段
    lessonsSection: true   # 注入已采纳教训
    syncOnBoot: true       # 启动后后台增量 sync
    maxTranscriptBytes: 262144
    agentsFile: ''         # '' → ~/.agents/AGENTS.md
    skillsRoot: ''         # '' → ~/.agents/skills
    autoAdopt: false       # 即便开启也只自动采纳一条 prompt 教训
    autoRunEveryDays: 7    # 上次 run 超过 N 天就在启动后后台跑一轮 PDCA（0 = 关闭）
    autoPropose: true      # 自动 run 也生成提案（但不采纳）
    autoTag: true          # 每次 sync 派生自动标签
    autoTagLimit: 8        # 每条会话最多几个自动标签（手动标签另算）
    editTools: ['write', 'edit']
    checkTools: ['bash', 'pwsh', 'bash_persistent']
```

未知字段会被忽略并写入 journal，不会让插件加载失败。

---

## 安全边界

- **只读原始会话**：`~/.dsh/sessions` 只被读取。
- **只读 Harness 归档状态**：`workspace.json` 只读镜像，插件不写它——另写一份只会和运行时真正执行的拦截逻辑打架。切换归档请在 Harness 会话列表里操作。
- **默认不自动改写**：`autoAdopt` 默认 `false`；即便开启也只允许 `prompt-section`，每
  次 run 最多一条。
- **可回滚**：采纳前写 `<file>.bak-<ts>`，`adoption.beforeSha/afterSha` 落盘，回滚要求
  文件 hash 仍与 `afterSha` 一致（别人改过就拒绝，而不是覆盖）。
- **路径白名单**：只允许写 `~/.agents/AGENTS.md`、`<root>/lessons.md`、
  `~/.agents/skills/<slug>/SKILL.md`。
- **目标漂移检测**：采纳时重算目标文件 hash，与提案创建时不一致 → `target-changed` 拒绝。
- **Web 面板**：所有 `/api/archive-rsi/*` 复用 Harness 的 Connection 校验，connection
  服务缺失时 503 失败关闭。

### 已知的加载语义（决定闭环能多快合上）

| 采纳类型 | 模型何时看到 |
|---|---|
| `prompt-section`（lessons.md） | 下一轮 —— section 文本每次装配都重新求值 |
| `skill-candidate` | 下一轮 —— 技能目录有文件监听 |
| `agents-md-rule` | 下次会话恢复或首次读写触碰；**不是下一轮**（AGENTS.md 没有 watcher） |

所以 AGENTS.md 类提案的 `evaluation` 在攒够采纳后的新会话之前一直是 `inconclusive`。
这是刻意如实呈现，而不是等一个好看的数字。

---

## 目录

```
archive-rsi/
  index.js        # 插件装配：工具、路由、prompt 段
  archive.js      # zstd 多帧解码、SessionFacts、归档存储（原子写）
  alchemy.js      # CohortMetrics、R1–R10、PDCA、提案与采纳/回滚
  protocol.js     # prompt 文案
  client.js       # 侧边栏入口 + 面板（归档 / 炼金 / 提案）
  locale/{zh,en}.json
  .verify-host.mjs / .verify-client.mjs
```

数据目录：

```
~/.dsh/archive-rsi/
  archive.json              # 归档索引
  sessions/<id>.json|.md    # 派生事实与渲染记录（可重建）
  runs/run-<id>.json        # PDCA run
  proposals/prop-<id>.json|.md
  baselines.json            # 指标序列
  lessons.md                # 已采纳的 prompt 教训
  journal.jsonl             # 只追加的决策日志
```

---

## 验证

```bash
node --check archive-rsi/*.js
node archive-rsi/.verify-host.mjs    # 58 项：配置、多帧解码、事实、存储、指标、R1–R10、PDCA、采纳/回滚、工具、路由、真实语料
node archive-rsi/.verify-client.mjs  # 6 项：模块注册、插槽、locale、渲染
```

**已验证的版本对**（2026-11-08，独立验证方与 Lead 各跑一遍，结果一致）：

| 对象 | sha256 前 16 位 | 大小 |
|---|---|---|
| `DESIGN.md`（契约） | `fc64a75f7bf2d5d7` | 36,9xx B |
| `index.js` | `f27ada583bdec2cd` | 48,973 B |
| `archive.js` | `21d587461c864174` | 66,275 B |
| `alchemy.js` | `fbb7714f6af0a57c` | 71,493 B |
| `client.js` | `a7a38a374add883f` | 154,418 B |
| `.verify-host.mjs` | `47db22e4f09503c7` | 2,056 行 |

验证方与实现方是不同 agent：`verify-*.mjs` 由独立验证方**只读 DESIGN.md** 写就（不读实现来反推断言），
它自己跑出 60/60 + 7/7；之后 DESIGN 只做过契约歧义澄清（median 取偶数长度左中位、`adoption.beforeSha`
可选、`refresh:true` 的计数语义），**没有代码改动**，澄清后 Lead 复跑仍 60/60 + 7/7。

2026-11-08 的验证状态：

- `verify-host` 58 pass / 0 fail / 0 skip（含在真实 42 个会话上的端到端：sync → run → act → overview）。
- `verify-client` 6 pass / 0 fail。
- **真实 Loader 启动验证**：建一个 headless profile，把本插件按 bundle 方式挂进去（`cordis.patch.yml` insert + `node_modules` 软链 + `rootDir` 指向临时目录），执行 `dsh --profile <name>`。Harness 正常启动到「需要任务」这一步，且插件副作用已出现——`archive.json` 里有 44 条会话、`sessions/*.md` 派生记录、`journal.jsonl`。这证明模块解析、`apply()`、`store.init()`、启动增量 sync 在真实 Cordis 加载器里都跑通了，不只是桩环境。
- **未验证**：headless CLI 里跑一次真实模型回合。本机远端 provider 走 account 路由，headless 需要重新登录（`ACCOUNT_SIGN_IN_REQUIRED`），所以「模型真的调用 `archive_list` 拿到数据」这一步没有在 CLI 侧复现；桩上下文 + 真实数据覆盖了工具的执行路径，模型侧的调用等价性靠工具 schema 与 `output.render` 的形状保证。

`archive.js` 里的 zstd 多帧扫描器移植自
`@deepseek-ai/dsh-session-persistence-jsonl`（该包未导出它），因为 Node 的
`zstdDecompressSync` 只解第一帧，而会话文件是逐次追帧拼接的。

## 已知限制

- 只支持已观察到的 v4 事件类型；未知事件类型被忽略，不会让统计崩。
- 消息反馈（`dsh-message-feedback` 的正/负标签）尚未接入指标，是下一步最值得信任的
  真值来源。
- Cohort 全量解码的最坏情况是每个会话几 MB、耗时 1–3 秒；结果按 (mtime, size, digest)
  缓存，未变更的会话不会重复解码。
