# 11 个自定义 DSH 插件：外部依据与需求清单

- 调研日期：2026-11-16
- 宿主：DSH 0.2.1-rc.4（Electron 桌面端 + Web GUI）
- 目标仓库：`/Users/fuzhuo/Documents/deepseek-harness/dsh-plugins`（11 个插件，git 源 + 自建 index.json）
- 方法：只读。读了仓库现有的 package.json / index.json / 少量 README，以及官方仓库 `deepseek-ai/deepseek-harness` 的 develop / guide / subsystems 文档、`https://cdn.dsh.so/market/index.json`、Electron 官方安全文档、若干产品文档。共 20 次抓取/检索。
- 证据等级：`[源]` 官方文档或官方索引原文；`[文]` 第三方页面/搜索结果；`[推]` 由前两者推理；`[?]` 未找到公开依据。

---

## 1. 一页结论

### 规范符合度概览

| 维度 | 结论 |
|---|---|
| bundle 形态（`dsh.bundle.patch` + `cordis.patch.yml`） | **11/11 符合** `[源]` |
| client 半注册（`dsh.client` + `exports["./client"]`） | **11/11 符合** `[源]` |
| index.json 顶层结构（`format/title/plugins`） | **符合**，且比官方最小样例更全（有 icon/homepage/keywords/labels）`[源]` |
| `engines.dsh` 与包内声明一致 | **9/11 不一致**：`realtime-voice`、`voice-control` 的 package.json **没有** `engines`，但 index.json 替它们声明了 `>=0.2.1-rc.4` `[源]`+本地核对 |
| `engines.dsh` 是否带上界 | **11/11 不符合惯例**：全部写成开放区间 `>=0.2.1-rc.4`，官方与市场主流写法是带上界（`<0.3.0-0`）`[源]` |
| 包元数据完整度（keywords/license/repository/peerDependencies） | `realtime-voice`、`voice-control` 缺 keywords/license/repository；11/11 未声明 `@deepseek-ai/dsh*` peerDependencies（因不直接 import，判**不适用**）`[源]` |
| 生命周期与清理（`inject` / `ctx.effect` disposer） | 文档级要求已满足（插件以 `inject` 声明依赖）；**未见**统一的自检脚本，无法机器验证 `[推]` |
| 废弃/取代标注 | **官方 index 格式没有 deprecated 字段**，惯例是 npm deprecate + 收紧 `engines.dsh` 上界 + 下架版本 `[源]` |

### 最该补的 5 件事

1. **兼容性声明收紧并双向对齐**：11 个包补 `engines.dsh` 上界 `<0.3.0-0`；`realtime-voice` / `voice-control` 补 package.json `engines`，让 index 与包一致。
2. **语音三件套的输入通道做完整**：系统级热键在插件侧没有入口（本地 README 已自陈），需要显式降级策略 + 麦克风权限/TCC 处理 + 快捷键冲突检测。
3. **mind-canvas 支持 JSON Canvas 开放格式导入导出**：这是白板类工具的事实互操作标准，成本低、收益明确。
4. **context-lib / archive-rsi 从「关键词」升级到「混合检索」**：市场里同类插件（dsh-knowledge、deja-vu、dsh-mnemon）都以此为核心卖点。
5. **boot 成本治理**：11 个客户端全部 `immediately: true`，重客户端（mind-canvas、novel-forge）在首屏就预取，属于可量化的启动开销。

---

## 2. 规范清单

依据文档（均为官方仓库 master）：
- [插件与生命周期 framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/index.md)
- [打包与安装 basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)
- [Client Modules（dsh.client 扫描与 bundle 路由）](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md)

| # | 要求 | 依据 | 我们现状 |
|---|---|---|---|
| R1 | 可分发的单位是 **bundle**：`package.json` 的 `dsh.bundle.patch` 指向补丁文件，补丁是 YAML 数组，行内 `name` 引用包名而非相对路径 | publish.md「The bundle manifest」 | **符合**：11/11 有 `dsh.bundle.patch: ./cordis.patch.yml` |
| R2 | 用 `engines.dsh` 的 SemVer 范围声明支持的宿主版本；安装与 profile 启动会拒绝不满足范围的包 | publish.md「Declare the DSH releases…」 | **部分不符合**：9 个包有，2 个没有；且 11 个都无上界 |
| R3 | index 里的 `engines.dsh` 应与包自身 `engines.dsh` 一致（安装时会再查一次） | plugin-market.md「`engines.dsh` should match the package's own」 | **不符合**：`realtime-voice`、`voice-control` 索引声明了包内不存在的兼容字段 |
| R4 | 需要与宿主共享实例的 `@deepseek-ai/dsh*` 包，同时放进 `peerDependencies` 与 `devDependencies` | publish.md「Declare dsh packages whose instances the plugin must share…」 | **不适用**：11 个包 `dependencies` 为 0，未 import dsh 包，靠服务名注入 |
| R5 | 插件可以是 `inject` + `apply(ctx)` 的对象；缺依赖时 fiber 停在 PENDING，依赖消失自动卸载并在依赖回归后重载 | framework/index.md「Fiber state machine」「Dependency-driven loading」 | **符合（文档级）**：各插件以 `inject` 声明服务；未见 `pending` 态的自测覆盖 |
| R6 | 每个注册都要有 disposer（`ctx.on` / `ctx.tools.register` / `ctx.effect` 自动回收）；**多个异步 disposer 并发执行，不保证串行完成**，有顺序要求的清理必须收进单个 `ctx.effect` | framework/index.md「Automatic cleanup」 | **待验证**：未找到统一断言；跨资源清理（DB 句柄 + 定时器 + 子进程）需逐个审 `[推]` |
| R7 | 客户端半：包声明 `dsh.client`（`platform: 'web'`，可选 `inject`/`immediately`），并在 `exports["./client"]` 导出构建产物 | client-modules.md「The scan」 | **符合**：11/11 有 `dsh.client` 与 `exports["./client"]` |
| R8 | `immediately` 是「stage-one 预取」标记，标记的脚本在 module-face boot 期就要注册工厂；`inject` 决定工厂到达顺序 | client-modules.md「The wire」 | **符合但偏激进**：11/11 `immediately: true`（见风险 K3） |
| R9 | 客户端 bundle 由 Host 按 `/plugins/??pkg/client.js&rev=...` 组合与缓存；源码/构建叠加层不得改变包身份；同名包多源并存会让组合失败 | client-modules.md「The bundle route」「The scan」 | **符合**：单源 git 安装；构建产物已提交 |
| R10 | `cordis.patch.yml` 的加载顺序：各 bundle 补丁（profile 声明序）→ profile 自身补丁 → `$DSH_HOME/cordis.patch.yml` → `--patch`；后层按 `id` 整行覆盖，**config 不是深合并** | publish.md「The loading order」 | **符合**：我们的补丁只 `insert` 自己的行；未覆盖宿主行，故不受整行覆盖影响 |
| R11 | 补丁文件可以是文件数组，按序作为一个层应用 | publish.md「`patch` also accepts an ordered list of files」 | **不适用**（单文件） |
| R12 | git 安装拿的是源码不是产物；TypeScript 包必须自带 `prepare` 脚本，且 pnpm≥10 需用户 `allowBuilds` 放行 | publish.md「Installing from GitHub: the build-script catch」 | **符合**：我们发布的是已构建 JS，`files` 内含产物，无需 build 放行 |
| R13 | 索引/市场格式见 §3；索引被当作第三方内容，DSH 只校验格式不校验声明真伪 | plugin-market.md「Indexes are third-party content」 | **符合**（认知项，需在 README 声明） |

---

## 3. 市场索引规范与 deprecated 标注惯例

### 3.1 官方 index 格式要点 `[源]`

来源：[docs/user/guide/plugin-market.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)

- 顶层：`format`（必须为 `1`）、`title`（必填，LocalizedText）、`description`（可选）、`metadata.categories/labels/sortKeys`、`plugins`（必填，数组顺序即默认展示顺序）。
- LocalizedText = 字符串或 `{en, zh, ...}`，**对象必须含 `en`**。
- 插件级：`name`（必填，npm 包名，索引内唯一）、`title`、`description`、`icon`、`author`、`homepage`、`repository{url,directory?}`、`metadata.category`（单个）、`metadata.labels`、`metadata.sortKeys`、`versions`（必填，≥1）。
- 版本级：`version`（精确 SemVer）、`publishTimestamp`（Unix 秒）、`source`（`{type:"npm", registry?}` 或 `{type:"git", url, commit:40hex, path?}`）、`engines.dsh`。
- icon：inline `data:` URL（≤32 KiB，SVG/PNG/JPEG/WebP）或 URL；**相对 icon 相对 index URL 解析**，绝对跨源必须 https。
- 索引本身：UTF-8、默认 ≤128 MiB、2xx、无重定向。
- 「推荐版本」= 与运行宿主兼容的最高正式版；无正式版时取最高预发布版。
- 未识别字段在**每一层都被忽略**（前向兼容），但已知字段与 `source.type` 的取值必须合法。

我们的 index.json 对照：字段齐全（甚至用了可选的 icon/homepage/metadata.keywords），LocalizedText 均带 en，11 条 `source.type` 全是 `git` + commit + path，**格式合规**。缺的只有 `engines` 上界与两条包的 engines 缺失。

### 3.2 官方市场里高质量样本的实际写法 `[源]`

样本来自 `https://cdn.dsh.so/market/index.json`（134 条），字段统计：`description` 134 条 / `versions` 132 / `author` 133 / `repository` 133 / `title` 121 / **`icon` 0 条** / **无任何 deprecated、replacedBy、hidden、unlisted、disabled 字段**。

| 样本 | 分类 | keywords 数 | 值得抄的做法 |
|---|---|---|---|
| `@xmanrui/dsh-im` | connect | 6 | 中英双写、一句话讲清「接入哪些 IM」；keywords 用生态词（cordis、ai-agents、feishu-bot） |
| `dsh-omi-voice` | creator | 5 | 明写 **BYOK**（自带密钥），把「数据不出本机」写进描述 |
| `dsh-knowledge` | knowledge | 2 | 功能三连：chunking / local embeddings / hybrid search——能力名词直接进描述 |
| `dsh-mnemon` | knowledge | 5 | 用「local supervised memory」定义品类，keywords 里嵌合作生态名 |
| `@vshulcz/deja-vu` | knowledge | 6 | 反着写卖点：「No LLM, no embeddings — one local Go bin」 |
| `dsh-mcp-panel` | knowledge | 6 | **兼容性声明**：`engines.dsh` 用多段并集覆盖多个宿主代际；描述里点名「通过 /mcp 和设置页」给入口 |
| `ds-harness-remote` | web | 0 | `engines.dsh` 写成 `>=0.2.0-rc.1 <0.3.0-0 \|\| >=0.2.1-0 <0.2.2-0 \|\| ...`，明确「不保证 0.3」 |
| `dsh-taskboard` / `dsh-talk-map` | connect / knowledge | 2-3 | 与我们的 task-ledger / mind-canvas 同品类，描述都强调「人机协作 / 可拖动分叉」 |

结论：**市场里没有「废弃/被取代」的结构化字段**。实际存在的三种做法：

1. **npm deprecate**：官方生成器「只收既非 deprecated 也非 private、且声明 `dsh.bundle` 的版本」——即**废弃在 npm 元数据层表达，索引里直接不列该版本** `[源]`。
2. **收紧 `engines.dsh`**：不再兼容的旧版本靠区间收口，而不是打标 `[源]`（dsh-mcp-panel、ds-harness-remote 的实际写法）。
3. **被内置取代**：卡片状态会出现 **「Provided by DSH」**，即该能力已由宿主自带 `[源]`。

> 对我们的直接含义：如果某个插件被新包取代，正确做法是 **新包名 + 在旧条目描述首句写 "Superseded by X" + 把旧条目 `versions` 收窄/移除 + npm deprecate 旧包**，而不是发明一个 `deprecated: true` 字段（会被忽略）。

---

## 4. 能力差距表

「我们是否有」基于本仓库代码/README 的实际检索结果（`grep` 全仓，命中位置已注明）。

| 品类 | 参照产品 + 链接 | 用户默认期待 | 我们是否有 | 落地建议（一句话） |
|---|---|---|---|---|
| 语音输入/通话 | [Superwhisper 快捷键文档](https://superwhisper.com/docs/get-started/settings-shortcuts)、[Essential settings](https://superwhisper.com/docs/get-started/essential-settings)、市场同类 `dsh-omi-voice` `[源][文]` | 按住说话/切换两种触发、自定义快捷键与冲突提示、模式（听写/翻译/润色）可切换、语言自动识别、离线可用、会后可回看原文 | **部分**：realtime-voice 有连续听写 + 清理 + 口述翻译；**无系统级热键**（voice-control README 自陈 asar 内 `globalShortcut` 零命中）、无权限引导 | 补「插件内热键 + 失焦提示」的降级路径，并在 README 首屏写明限制 |
| 脑图/白板 | [JSON Canvas 开放格式](https://obsidian.md/blog/json-canvas/)、市场同类 `dsh-talk-map` `[源][文]` | 无限画布缩放/框选、撤销重做、图片与链接节点、**导出/导入开放格式**、键盘操作 | **否**：mind-canvas 全仓无 `jsoncanvas/json-canvas` 命中；无开放格式互操作 | 先做 JSON Canvas 1.0 导入导出（nodes/edges/groups 三件套） |
| 会话归档与检索 | [Claude Code sessions 文档](https://code.claude.com/docs/en/sessions)、市场 `@vshulcz/deja-vu`、`dsh-session-manager` `[源][文]` | 会话列表 + 全文搜索 + 恢复/分叉/重命名 + 删除与归档 + 导出 | **部分**：archive-rsi 有归档与 PDCA，但检索是关键词；无 resume/fork/rename 入口 | 加「跨会话全文检索 + 一键 resume/fork」两个动作 |
| 知识库/上下文资源库 | 市场 `dsh-knowledge`（hybrid search）、`dsh-mnemon`、[Obsidian Dataview](https://github.com/blacksmithgu/obsidian-dataview) `[源][文]` | 分块 + 嵌入 + 混合检索、增量索引、引用来源可点回原文、管理面板 | **部分**：context-lib 有 3862 条索引与面板，**无 embedding/语义检索**（全仓无命中） | 关键词 + 可选 embedding 的混合检索，命中项必须带来源路径 |
| 长篇写作流水线 | [Novelcrafter](https://www.novelcrafter.com/)、[Scrivener 手册（corkboard/outliner/editor 关系）](https://www.literatureandlatte.com/docs/Scrivener_Manual-v2-Mac.pdf) `[文]` | 大纲/章节树、人物与设定库（codex）、场景卡片与拖拽重排、**版本快照**、连续性检查、导出 docx/epub | **部分**：novel-forge 有大纲/章节/recipe；语义召回与拆书仍是决策点（`docs/requirements-2026-11.md:186`），快照与导出未做 | 加章节级快照 + docx 导出，先把「可交付」闭环 |
| 任务账本/目标追踪 | [Beads issues & dependencies](https://beads.gascity.com/core-concepts/issues)、市场 `dsh-taskboard`、[Claude Code sessions](https://code.claude.com/docs/en/sessions) `[源][文]` | 依赖图与「就绪队列」、看板视图、跨会话续接、审计历史、阻塞原因可见 | **部分**：task-ledger 有 charter/claims/evidence/lease/version，**无依赖图与看板** | 在现有 ledger 上派生「ready/blocked」查询，再给看板只读视图 |
| GitHub 客户端面板 | [GitHub Desktop 查看 PR](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/viewing-a-pull-request-in-github-desktop)、市场 `dsh-github-manager` 之外的 `dsh-zotero` 式「本地数据 + 引用」范式 `[源][文]` | PR 列表/详情/diff/review 与评论、issue 过滤、通知未读、多账号、token 安全存储 | **部分**：github-manager 只读到 `pull_request` 标记（`index.js:367/399/487`），**无 diff/review**；token 存储未用 safeStorage | 补 PR 详情 + diff 视图；token 落 `safeStorage` |

---

## 5. 风险与合规清单

| 风险 | 依据 | 命中插件 |
|---|---|---|
| K1 Electron 安全基线：不要把 Node 集成暴露给远程内容；应开 `contextIsolation`、`sandbox`、定义 CSP、用 `setPermissionRequestHandler` 管权限、**校验所有 IPC 的 sender** | [Electron Security 文档（20 条 checklist）](https://www.electronjs.org/docs/latest/tutorial/security) `[源]` | 全部 11 个 client 半；`github-manager`（外链/远程数据）、`update-check`（外网请求）风险最高 |
| K2 全局热键是可抢占资源：`globalShortcut.register` 注册失败即表示已被别的应用占用；且 macOS 上 DSH 失焦后插件侧无入口 | Electron `globalShortcut` API 文档 `[源]`；本地 `voice-control/README.md:99` 明确写「热键只在窗口有焦点时生效，系统级需改原生壳」 `[源]` | `voice-control`、`voice-companion`、`realtime-voice` |
| K3 长任务/boot 成本：`immediately` 的客户端脚本在 boot 阶段就要注册工厂；重客户端全部预取会拖慢首屏 | client-modules.md「The wire / `immediately` marks stage-one prefetch」 `[源]` | 11/11 都是 `immediately: true`；`mind-canvas`、`novel-forge`（client-src + build.mjs，体积最大）最该改 |
| K4 麦克风/摄像头类权限在 macOS 受 TCC 管控，Electron 默认自动批准所有权限请求，需自行收紧 | Electron Security §5「By default, Electron will automatically approve all permission requests…」 `[源]` | `realtime-voice`、`voice-companion`、`voice-control` |
| K5 敏感凭据落盘：token 应走 `safeStorage`（系统钥匙串加密），不要明文写配置文件 | Electron `safeStorage` API 文档 `[源]` | `github-manager`（GitHub token）、`voice-companion`（若存云 TTS key）、`update-check` |
| K6 用户数据目录写坏：插件把 JSON 直接写 `$DSH_HOME` 下，进程中断会留下半截文件；应先写临时文件再 rename 原子替换，并带 schema 版本与迁移 | Electron `app.getPath('userData')` 语义 `[源]` + 原子替换为 POSIX 语义 `[推]`（未找到 DSH 官方强制要求） | `archive-rsi`、`context-lib`、`task-ledger`、`novel-forge`（存稿） |
| K7 剪贴板：渲染进程读剪贴板需要焦点/用户手势，静默写入会被拦；主进程 `clipboard` 模块不受此限 | Electron `clipboard` API 文档 `[源]` | `voice-companion`（粘贴听写结果）、`novel-forge`（导出复制） |
| K8 索引即第三方内容：DSH 只校验格式不校验声明，`http:` 索引可被链路上任何人篡改（含安装源） | plugin-market.md「Indexes are third-party content」「use `https:`」 `[源]` | 我们的自建 index（必须 https 托管，README 提示用户确认来源） |
| K9 git 安装会在安装期执行包代码（`prepare`），等同把该包当作用户授权 | publish.md「Treat that allowance as permission to execute…」 `[源]` | 我们已发产物，**不命中**；但若将来改 TS 源码发布则命中 |
| K10 版本区间过宽导致「装了但跑不起来」：开放上界会让宿主在 0.3 仍宣称兼容 | publish.md R2 + 市场样本多段并集写法 `[源]` | 11/11（见 §2 R2） |

---

## 6. 需求清单（18 条）

优先级口径：P0 = 影响正确性/可安装性/用户第一印象；P1 = 明显能力缺口、有成熟参照；P2 = 打磨与生态。

| # | 插件 | 需求（一句话） | 依据 | 优先级 | 验收方式 |
|---|---|---|---|---|---|
| 1 | 全部 11 个 | `engines.dsh` 收成带上下界的区间（`>=0.2.1-rc.4 <0.3.0-0`），并与 index.json 逐字一致 | §2 R2/R3、K10 | P0 | 脚本断言：`index.json` 每个 version 的 `engines.dsh` === 对应包 `package.json` 的 `engines.dsh`，且含 `<0.3`；CI 里跑一遍 |
| 2 | `realtime-voice`、`voice-control` | 补 `engines`、`keywords`、`license`、`repository`，与其余 9 个对齐 | §2 R2/R3、§3.2 样本 | P0 | `node scripts/check-manifest.mjs` 输出 0 缺失字段；两包 `npm pack --dry-run` 能列出 icon 与 README |
| 3 | `voice-control` / `voice-companion` / `realtime-voice` | 统一「热键不可用」降级路径：注册失败要可见提示、给出应用内替代键、README 首屏写明系统级热键限制 | K2、§4 语音行 | P0 | 手动：先占用目标快捷键再启动插件，UI 出现提示且不静默失败；README 截图/文案评审通过 |
| 4 | 语音三件套 | 首次使用时的麦克风权限引导（拒绝后给出系统设置入口），并收窄 `setPermissionRequestHandler` 只放行麦克风 | K1、K4 | P0 | 拒绝权限后插件仍可用（降级为不可录音并提示），日志无未捕获异常 |
| 5 | `mind-canvas` | 支持 JSON Canvas 1.0 导入/导出（nodes/edges/groups 三件套，含 x/y/width/height/color） | §4 脑图行、JSON Canvas 规范 | P0 | 导出文件通过 JSON Canvas 校验器；用 Obsidian 打开同一文件节点位置与连线一致 |
| 6 | `github-manager` | 补 PR 详情页：diff 摘要、文件列表、conversation、review 状态；token 改存 `safeStorage` | §4 GitHub 行、K5 | P0 | 打开一个真实 PR 能看到文件列表与 review 状态；`grep` 配置目录无明文 token |
| 7 | `context-lib` | 检索从纯关键词升级为「关键词 + 可选 embedding」混合检索，命中项必须带来源路径与行号 | §4 知识库行 | P1 | 同一 query 在开启/关闭 embedding 下各跑 20 条基准，召回率提升且每条都有 source 字段 |
| 8 | `archive-rsi` | 加跨会话全文检索 + 一键 resume/fork/rename | §4 归档行、Claude Code sessions | P1 | 在 100+ 会话归档上搜一句旧话能命中并跳回；resume 后新会话能读到该 run 的 handoff |
| 9 | `novel-forge` | 章节级版本快照（保存/比对/回滚）+ docx 导出 | §4 写作行、Scrivener snapshots | P1 | 改 3 章后能 diff 出差异并回滚到快照；导出 docx 用 Word 打开章节层级正确 |
| 10 | `task-ledger` | 从现有 ledger 派生「ready / blocked」就绪队列与依赖关系，配只读看板 | §4 任务行、Beads 依赖图 | P1 | `task_list` 返回依赖与 ready 标记；看板对同一数据渲染一致 |
| 11 | 全部 client 插件 | `immediately` 分级：首屏必需的保留 true，重客户端（mind-canvas/novel-forge）改懒加载 | K3 | P1 | 冷启动到可交互时间（performance.mark）前后对比，重客户端脚本不进入 bootstrap phase |
| 12 | `archive-rsi` / `context-lib` / `task-ledger` | 落盘统一走「临时文件 + rename」原子写，文件头带 schema 版本与迁移 | K6 | P1 | 写入过程 kill -9 后重启不出现半截 JSON；旧版本数据文件能被自动迁移 |
| 13 | 全部 11 个 | 客户端渲染遵守 CSP，不用 `innerHTML` 拼接用户内容；IPC/服务调用校验来源 | K1 | P1 | 加一条 eslint/静态检查规则；对 markdown 渲染做一次 XSS 手测 |
| 14 | 11 个的 index 条目 | 描述统一「一句能力 + 一句边界」+ 5-8 个生态关键词，中英双写 | §3.2 样本 | P2 | 每条描述 ≤ 200 字且含「不做/限制」句子；keywords ≥5 |
| 15 | 仓库级 | 新增 `docs/DEPRECATION.md`：写清「新包取代旧包」的四步（新包名、npm deprecate、收窄 versions、描述首句 Superseded by） | §3.2 deprecated 惯例 | P2 | 文档合并；下一次插件更名时按该流程走一遍 |
| 16 | 仓库级 | 加 `scripts/check-manifest.mjs`：校验 11 个包的必填字段、engines 一致性、files 含产物、index 字段合法 | §2 R1/R2/R3/R7 | P1 | 脚本可在 CI 与本地一键跑，故意改坏一个字段能报错并指出 JSON path |
| 17 | `dsh-update-check` | 检查更新时展示「当前版本 → 最新版本 + 兼容性结论」，不兼容时给 `engines` 原因 | §3.1 推荐版本规则 | P2 | 构造一个 engines 不兼容的版本，UI 显示「不兼容」而非「可更新」 |
| 18 | `voice-companion` | 提供「会后回看」：按会话保存转写原文与润色结果，可复制/导出 | §4 语音行、Superwhisper 模式 | P2 | 一次 10 分钟听写后能导出带时间戳的文本；数据仅落本机 |

---

## 附：未能查证的部分

- DSH 官方未提供「插件废弃」的结构化字段，也没有公开的插件审核/下架流程文档：`未找到公开依据`。
- 官方仓库没有针对「插件写用户数据目录」的强制规范（只有 Electron 的 `userData` 语义）：K6 的原子写建议为工程推断 `[推]`。
- 未找到 DSH 关于插件导致 boot 变慢的公开 issue 或性能预算文档；K3 依据是 client-modules.md 对 `immediately` 的语义定义 `[源]` + 体积观察 `[推]`。
- 未实际运行任何插件或安装流程（任务约束：只读）。
