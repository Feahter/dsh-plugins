# Task ledger · 以任务为中心的 DSH 插件

把状态所有权从 session 搬到外置任务账本：**session 是任务的一次 run，账本才是引擎**。

关掉所有会话、隔一天、换一个模型或换一个 agent，只要给 `task_id`，就能从断点继续——目标、决策、证据、下一步都在账本里，不在聊天记录里。

```text
~/.dsh/task-ledger/
├── INDEX.md                 # 生成的路由索引 + 四问页
├── audit.jsonl              # 插件级写审计（含失败，fail-open 也留痕）
├── active.json              # 钉住的当前任务（会话启动时注入的就是它）
├── runs.jsonl               # run_id → task_id 绑定
└── tasks/<task-id>/
    ├── task.json            # 章程：goal / 研究问题 / 验收 / 证据门槛 / 预算（不可变）
    ├── state.json           # 现值：phase / status / next_actions / open_questions / lease / version
    ├── claims.jsonl         # append-only 主张：verified | refuted | unverified
    ├── decisions.jsonl      # append-only 决策：理由 / 被否决方案 / 证据分级
    ├── evidence/            # 内容寻址快照 + index.jsonl（url / sha256 / fetched_at）
    ├── runs/<run-id>.md     # 交接报告：做了什么 / 发现 / 失败 / 下一步 / 未决
    └── artifacts/           # 大纲、草稿、成稿
```

## 安装

### 从插件市场索引安装（推荐）

本仓库自带市场索引。DSH Web UI 打开 **Plugins → Discover**，添加索引地址：

```text
https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json
```

搜索 **Task ledger · 任务账本**，安装即可。

### 手动安装（钉住某个版本）

市场索引里每个版本都钉了一个精确 commit，等价的手动安装：

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/task-ledger"
```

### 本地目录开发安装

```text
plugin_manager { action: "install_bundle", target: "<repo>/plugins/task-ledger" }
```

安装后立即可用，无需重启（Host 模块热加载；替换已安装的同一包需要重启）。

卸载（账本数据保留）：

```text
plugin_manager { action: "remove_bundle", target: "dsh-task-ledger" }
```

自检：仓库内 `node .verify-host.mjs` 与 `node .verify-client.mjs`，结果见 [VERIFY.md](./VERIFY.md)。

## 五个工具

| 工具 | 什么时候用 | 关键契约 |
| --- | --- | --- |
| `task_list` | 任何长任务的第一步：先路由，再计划 | 只读；返回 pinned 任务、计数、每个任务的 next action |
| `task_open` | 没有匹配任务，要开一个活得过本轮对话的任务 | 写章程（goal / 问题 / 验收 / 证据门槛） |
| `task_resume` | 续跑；压缩后；换会话；before answering about an existing task | **取租约**，返回本轮 `run_id` + 续跑简报 |
| `task_checkpoint` | 边做边写：证据、主张、决策、next actions | 必须带 `run_id`；`expected_version` 做乐观锁 |
| `task_close` | 每轮必做收尾（失败也要，标 `blocked`） | 写交接报告 → 跑证据门禁 → 释放租约 |

一次典型的 run：

```text
task_list → task_resume(task_id)          # 拿 run_id，注入状态
→ task_checkpoint(run_id, evidence/claims/next_actions)
→ task_close(run_id, summary, findings, failures, next_actions)
```

## 三条硬约束（插件替你执行，不靠模型自觉）

1. **单一写入者**：`task_resume` 取租约，`run_id` 是写权限。第二个会话同时操作同一任务会被拒绝
   （`task-leased`），租约超时后自动可接管。防止双轨漂移。
2. **乐观锁**：`state.version` 每次成功写入 +1；传 `expected_version` 时读到旧版本会失败
   （`version-conflict`），要求重读后重放改动。
3. **证据门禁**：`task_close` 前检查主张——仍为 `unverified`、或 `verified` 却没有 `source_ref`/`evidence_hash`
   的主张会挡住 `done`，自动降级为 `blocked`。真要放行必须 `force: true`，且放行本身写成一条决策。

写文件永远走工具（原子写 + 任务锁）；agent 直接 `fs` 改 `state.json` 会绕过版本、租约与索引。

## 提示注入：静态协议 + 动态快照

- **静态**：`systemPrompt.section`（order = `TOOL_GOAL + 50`）注入固定协议文本，位置与内容稳定，
  不破坏 prefix cache。
- **动态**：`systemPrompt.context` 注入账本快照（pinned 任务、phase、next actions、主张计数、上次 run）。
  该文本只在**变化时**才作为一条 runtime context 追加，不变化零成本；压缩、重启、换会话都重新渲染。
- 会话启动（`agent/created`）会强制刷新一次快照，所以外部改动（另一个 agent、人手修的账本）在模型看到前生效。
- 两段文本都 `interpolate: false`，任务标题里出现 `{{` 也不会被当成 prompt 变量。

## 面板与命令

- 侧边栏「任务账本」：任务列表（状态/阶段/主张/证据/next action）、搜索筛选、详情（章程、主张徽标、
  决策、run 交接）、刷新 / 标记完成 / 标记阻塞 / 钉住为当前任务。
- 面板数据走同源 JSON 路由 `/api/task-ledger/{index,task,status,active}`，与其他 Web 页面共用
  同一套 Host/Origin 与 cookie 鉴权；鉴权服务缺失时 fail-closed 503，不裸奔。
- 斜杠命令 `/task`：`list | show <id> | active <id> | done <id> | block <id> <reason> | clear`。

## 配置

写在 profile 的 `cordis.patch.yml`（用户补丁层，升级不丢）：

```yaml
- id: task-ledger
  name: 'dsh-task-ledger'
  config:
    rootDir: ~/.dsh/task-ledger   # 账本根目录，支持 ~ 与环境变量 DSH_TASK_LEDGER_DIR
    leaseTtlSeconds: 3600         # 租约时长，最小 60s；每次 checkpoint 续期
    protocolSection: true         # 是否注入静态协议
    briefing: context             # context = 动态快照；off = 关
    briefingRefreshMs: 8000       # 快照缓存刷新间隔
    maxListedTasks: 60            # 列表上限
    command: true                 # 是否注册 /task
```

未知配置键不会让插件挂掉，但会写进 `audit.jsonl` 的 `config-warning`。

## 验收：怎么证明它不是「记性好的会话」

| # | 测试 | 判据 |
| --- | --- | --- |
| 1 | 冷启动：删掉全部 session，新会话只给 `task_id` | `task_resume` 返回目标/状态/证据/next actions，且能继续写 |
| 2 | 10-run 连续性：中途触发 compaction | 关键决策在 `decisions.jsonl` 精确可查，而不是摘要里一句话 |
| 3 | 并发写：两个会话同时操作同一任务 | 第二个被 `task-leased` 拒绝，无状态分裂 |
| 4 | 证伪记录：推翻一条已入库主张 | 旧记录仍在，最新状态为 `refuted`，且不影响其余主张 |
| 5 | 证据门禁：留一条未验证主张直接收尾 | `task_close` 降级为 `blocked`，或 `force` 后留下 override 决策 |
| 6 | 主动性：人工在面板/命令改状态 | 下一次请求的 runtime context 反映新状态（无需重启） |

验证分四层，全部可复跑：

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| Host stub 套件（52 项：工具/租约/版本冲突/门禁/冷启动/路由鉴权/命令/配置/路径安全） | `node .verify-host.mjs` | 52/52 PASS，exit 0 |
| 面板契约（7 项：loader、路由一致性、locale、icon、无 Harness 依赖、仅主题 token） | `node .verify-client.mjs` | 7/7 PASS |
| 缺陷回退探测（并发建任务、未知 id 错误码、runs 去重、404 语义等） | `node .verify-host.mjs --defects` | 0 observed / 6 fixed |

细节、逐项断言与残余风险见 [`VERIFY.md`](./VERIFY.md)。

## 相对原始设计的取舍

保留：外置账本为唯一真源、run 降级为一次执行、证据分级、closeout、单写者、必留证伪记录、冷启动验收。

优化/偏离：

- **JSON 而非 YAML**：`task.json` / `state.json` / `*.jsonl` 零依赖、原子可写、坏行可容忍；
  人类阅读走生成的 `INDEX.md` 与 `runs/*.md`。
- **合并写入口**：`task_claim` + `task_next` + `task_index` 收成 `task_list` / `task_checkpoint`，
  工具面更小、模型更不容易用错；`task_next` 的信息由 `next_actions` 直接携带。
- **租约代替「相信模型」**：单写者变成机制（`run_id` + 优先权冲突），而不是协议里的一句要求。
- **动态 context 代替逐轮注入**：原设计担忧 prefix cache，实测 `systemPrompt.context` 只在文本变化时才追加，
  因此把「状态快照」放在这里，静态协议留在 section。
- **不依赖记忆插件**：事实/偏好仍可放 memory，任务状态只走账本；插件只写 `~/.dsh/task-ledger`，
  不碰 session log（不新增 session 事件类型，避免 session 无法回读）。
- **面板是管理面，不是第二个真源**：面板/命令改状态会 bump version、写决策、留审计，但不需要租约
  （人可以叫停一个卡住的 run）。

## 局限

- 证据快照是「你给什么存什么」：插件不联网抓取，url 只做溯源；抓取仍用 web 工具。
- 租约是时间租约，不是心跳：进程被 kill 后最长需等到过期（默认 1h）才能被别的 run 接管。
- 面板未做可视化验证时只能确认代码与路由正确；渲染效果需在 Web UI 里实际打开。
- 账本根目录是全局的（跨工作区）；按工作区隔离需要配置不同 `rootDir`。
- 本地目录 bundle 是「链接安装」：更新 Host 侧代码后需要 remove_bundle + install_bundle（或重启 Harness）才会加载新的模块世代；Client 侧还需要刷新页面。
- 面板按 profile 清单顺序自动出现，如需固定位置可在 profile patch 里调整。

## 变更记录

- **1.0.2** — 文档修正：VERIFY.md 结论与 1.0.1 的修复保持一致；删除不可复现的私有账本路径与内部引用；安装包内补齐自检脚本与 VERIFY.md。
- **1.0.1** — 修掉验证中发现的 6 个缺陷：并发 `task_open` 可能复用 id 覆盖章程（改为 mkdir 原子占位 + `task-exists`）、未知 task_id 泄漏 ENOENT（改为 `task-not-found`）、runs 重复计数（按 `run_id` 折叠）、`task-not-found` 面板返回 500（改为 404）、`/index?status=` 未校验（改为 400）；`task_resume` 输出直接给出 `expected_version` 权威值。
- **1.0.0** — 首版：外置账本、租约单写者、证据门禁、提示注入、面板与 `/task` 命令。
