# 墨炉 · Novel Forge

给 DeepSeek Harness 的小说创作插件：**一句话故事核 → 设定 → 人物 → 脊柱 → 大纲 → 细纲 → 草稿 → 连续性审校 → 修订 → 导出**，能一路写到 3000 章。

底层是一个**通用创作流水线引擎**（`src/forge/`，不认识"小说"两个字），小说只是第一份配方（`src/recipes/novel/`）。第二个配方——短篇、剧本、播客脚本——只写 `src/recipes/<name>/` 就能接进来。

## 装

插件在 `dsh-plugins` 仓库的 `plugins/novel-forge/`。在 `~/.dsh/profiles/desktop/package.json` 里用 link 安装：

```json
{
  "dependencies": { "dsh-novel-forge": "link:/Users/you/Documents/deepseek-harness/dsh-plugins/plugins/novel-forge" },
  "dsh": { "profile": { "bundles": ["dsh-novel-forge"] } }
}
```

然后重载 DSH（或重启桌面端）。侧栏出现「墨炉」。

> 开发期改客户端代码后跑 `node build.mjs` 重新打包 `client.js`；宿主代码改动要重启桌面端才会生效（unmanaged bundle 不做热替换）。

![书架](docs/screens/shelf.png)

![工作台](docs/screens/workbench.png)

![真实宿主里的墨炉](docs/screens/live-host.png)

## 两种用法：流水线，或 agent 一章一章写

**同一份契约、同一条盘上状态。** 章节工作单元（`src/recipes/novel/chapter.js`）同时服务两条路：批量流水线内部调它，对话里的 agent 也调它。所以"自动跑的"和"agent 手写的"拼的是同一份材料、过的是同一套检查。

### 面板：整炉炼

1. 「新建长篇」——一句话故事核 + 章数（6–3000）/ 每卷章数 / 每章字数 / 视角 / 文风 / 单章上下文预算，右侧实时预估调用量。
2. 「开始炼」——从故事核跑到大纲；开了「每步停下」会在草稿、审校、修订后暂停等你确认。
3. 工作台——左阶段轨（九步）看进度，中间看产物（脊柱/大纲/章节/正典），右抽屉看实时事件；单章可切细纲/草稿/审校/摘要，草稿能直接改。
4. 导出——Markdown 或 EPUB，落在项目目录。

### 对话里：agent 优先

长篇不要指望一次 `novel_run` 跑完。给 agent 的循环是：

```
novel_next   → 脚本告诉你下一步（展开哪卷 / 写哪章 / 审哪章 / 该全书体检了），0 次模型调用
novel_context→ 拿到这一章的完整材料包（≤ contextBudget 字符，硬预算，附分片账）
（agent 自己写正文，可以在自己的上下文里反复打磨）
novel_commit → 落盘正文 + 摘要 + 合并正典 + 跑确定性检查，返回 verdict 与 findings
novel_audit  → 全书确定性体检（死亡人物说话、时间倒流、线索烂尾、正典冲突…）
```

| 工具 | 作用 |
|---|---|
| `novel_create` | 用一句话开书（`chapters`/`chaptersPerVolume`/`contextBudget`/…） |
| `novel_next` | 下一步该干什么（纯脚本判定，不调模型） |
| `novel_context` | 取某一章的材料包（缺省 = 下一章要写的） |
| `novel_commit` | 提交一章正文：摘要 + 正典合并 + 确定性检查 |
| `novel_audit` | 全书体检；干净时记下 `outline.auditedAt`，脏时不记 |
| `novel_plan` | 展开某一卷的章表（幂等，已展开就空跑） |
| `novel_run` | 批量推进（`window` 默认 10 章，`from/to/stages/items/force/dryRun`） |
| `novel_status` | 阶段进度、卷/章计划、正典规模、当前运行、待确认 |
| `novel_read` / `novel_write` | 读 / 手改任意产物（设定、大纲、某章细纲草稿审校） |
| `novel_list` / `novel_cancel` / `novel_export` | 列表 / 取消（已完成章节保留）/ 导出 |

## 长篇怎么撑住

- **部 → 卷 → 章，卷纲惰性展开。** 脚本先建骨架（300 章 0 次调用、<1ms），只有真要写这一卷时才花一次调用产出该卷章表；`chaptersPerVolume` 会在卷数超 40 时自动抬高，保证卷表永远写得完。
- **单章材料包是硬预算。** `packet.js` 按固定分片与优先级拼装（本章细纲 2500 / 上一章 800 / 近几章摘要 1200 / 正典 3200 / 人物速查 1500 / 下一章目标 300 / 文风 1200 / 上帝视角摘要 1000 / 故事核 900），总长硬性 ≤ `contextBudget`（默认 12000），超了按优先级裁并给出每片的 `chars/cap/allocated/dropped`。包的大小不随章号增长：细纲 / 正典 / 人物速查这几片逐片固定上限，第 5 章和第 500 章一样大；第 1 章天然没有上一章与文风样本，会短一些。差别只在检索到了什么。
- **正典只增不减。** `canon.json` 存结构化事实三元组（`s/p/o/chapter/status`）+ 线索（含 payoff）+ 人物档案（含 `knows`/`relations`/`lastSeen`）+ 时间线 + 不变量；没有总数上限，同一 `s|p` 出现不同 `o` 标 conflict 而不是悄悄覆盖。检索用倒排索引，只把与本章 `cast`/地点/关键词相关、且**章节不晚于本章**的事实塞进包——第 5 章看不到第 200 章才写的结局，既不剧透，也不会让角色提前知道后事。v1 的 `ledger.json` 幂等迁移，原章 id 保留。
- **一致性靠代码查，不靠模型自觉。** 八条确定性规则各配正反用例：死亡人物出场（block）、时间倒流（warn）、人物未登记（warn）、线索 40 章未回收（audit）、人名漂移（note）、不变量被违反（warn）、正典冲突（audit）、与历史事实矛盾（note）。宁漏勿误报。
- **一份产物一套检查。** 审校阶段 = 模型意见 + 确定性检查合并；`block>0 或 warn≥3` 才进入修订，修订有长度保护（0.8–1.25 倍），不会越改越短或膨胀。

## 数据

全部在本机，`$DSH_HOME/novel-forge/`（默认 `~/.dsh/novel-forge/`）：

```
projects/<id>/project.json        项目状态（参数、阶段、统计）
projects/<id>/artifacts/          所有产物（md/json），旧版本在 .versions/
  spine.json / outline.json       卷章计划（脚本发号，模型给的 id 一律丢弃）
  canon.json                      正典（v2）；v1 项目仍是 ledger.json，读取时自动迁移
  draft/<章>.md                   正文（末尾内联 <<<SUMMARY>>> / <<<CANON>>>）
  beats/<章>.json                 细纲（draft 工作单元按需生成）
projects/<id>/runs/<runId>.json   运行记录与事件
projects/<id>/exports/            导出文件
```

Markdown 就是纯文本，JSON 就是普通 JSON，随时可以直接看、直接改、直接进 git。

## 设计要点

- **状态在盘上，脚本搬运。** 卷章数量、章节 id、预算分配、去重、冲突检测、下一步该干什么，全由确定性代码完成，不花模型调用。
- **一份契约两个调用方。** `chapter.js` 同时给流水线和 agent 用：同样的材料、同样的落盘、同样的检查。
- **一章一章写**：草稿串行，每章写完立刻生成摘要与正典补丁，下一章只带预算内的前情。慢就是快。
- **可暂停、可改、可续跑**：所有产物都在磁盘上；改完再跑会跳过已完成的部分，`force` 才重跑。`window` 控制一轮最多推进几章。
- **通用引擎**：stage 只有 `id/title/each/produces/review/run`，引擎只管顺序、事件、存储、取消、暂停。配方负责一切创作语义；`src/forge/budget.js` 是通用预算分配器（零小说知识）。
- **站在成熟库上**：Markdown 渲染用 `marked`，EPUB 打包用 `epub-gen-memory`，模型 JSON 用 `zod` 校验；没有自造解析器或压缩器。

架构细节：`docs/architecture-v2.md`（v0.2 增量，权威）、`docs/architecture.md`（v0.1 基线）、`docs/prompts.md`（12 个提示词构建器契约）。

## 开发

```bash
npm install
node build.mjs          # 打包客户端 client.js
npm test                # 引擎/存储/recipe/宿主单测（含 300 章长跑）
node dev/verify.mjs     # Playwright + 假宿主，跑 UI 交互，截图到 test/screens/
node dev/e2e.mjs        # 真 HTTP 宿主 + 真引擎 + 真 client.js 的端到端（假 LLM）
node dev/mount-check.mjs # 临时 DSH_HOME 起真 dsh web，验证侧栏挂载与 /recipes
```

## 已知限制

- 只实现中文提示词（`prompts/en.js` 留了接口）。
- EPUB 不含封面图。
- 细纲是单次调用：模型输出坏 JSON 时整章报 `LLM_PARSE` 而不是重试抢救（v0.1 的 `callJson` 截断重试路径没有接进来）。长篇卷纲一次要写 75 条章表，遇到截断请调小 `chaptersPerVolume`（如 20–25）让每卷更短。
- 卷纲只能往前展开：已 `planned` 且已有草稿的卷不要重规划（会重排后续章 id）；上一卷还有章没写完时 `novel_plan` 会直接返回 `skipped` 并告诉你差哪一章，不会启动空跑。
- `novel_run` 每轮默认最多写 10 章（`window` 可调）：写满就停，阶段状态停在 `partial`，下一轮从断点接着写。窗口名单在 run 开始时定死，改 `window` 要新起一轮。
- 模型偶发把 token 全花在思考上、返回空正文；审校拿不到 JSON 时降级为确定性检查，不中断整炉。
- 插件是 ESM 模块，宿主运行中不热替换；更新代码后需要重启 DSH 才生效。
