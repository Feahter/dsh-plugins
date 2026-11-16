# 墨炉能力强化需求（2026-11 · 由产品描述反向推导）

> 来源：用户给出的 5 段竞品能力描述（2026-11-16）。本文把这些描述先聚类成 5 个能力域，再逐条对到墨炉现有代码的**证据行号**，最后落成带验收命令的需求清单与三轮施工计划。
>
> 原则：**能在正文上确定性判定的，进代码闸门；只能判"写得好不好"的，进提示词；两者都不占的（云端、拆书交互），先立需求与决策点，不硬做。**
>
> 基线：`novel-forge` v0.3.0，2026-11-16 实测 `npm test` = 477 passed / 0 failed（改动前绿）。

---

## 0. 一页结论

| # | 用户描述里的能力 | 墨炉现状 | 本轮要补的差 |
|---|---|---|---|
| 1 | 词汇丰富、对话有张力、画面感强、AI 味少、润色强、长篇伏笔回收强 | 画面感/反 AI 腔/AI 标记已有硬闸门；**词汇多样性、对话张力零指标**；润色只覆盖故事核/文风/书名；伏笔有账本与 stale/兑现章专名检查 | C1、C2：两组新指标 + finding；C5：选段润色通道 |
| 2 | 黄金三章、平台节奏、爽点模板、全篇创作、一键续写、云端存稿、拆书、编辑视角大纲、上手快 | 黄金三章/爽点在**提示词**里写得很细，契约检查器 `checkOpeningContract` 也写好了但**从未接线**（`outline.js:294`，仅测试引用）；钩子强度连续低、中点漂移、首末不翻转、B 线不合流**已在全书体检里**（`consistency.js:677/621/753/928`）；全篇创作有 `novel_run`/`novel_plan`；**一键续写、云端存稿、拆书、编辑视角导出一个都没有** | M1b：接线上黄金三章契约（零新判定代码，性价比最高）；M1：爽点兑现节奏闸门；M4–M7 立需求，R2 做 |
| 3 | 设定闭环、漏洞排查、剧情推演、性价比 | 漏洞排查最厚（单章 30 类 + 全书 17 类）；**设定闭环（设定闲置）无检查**；剧情推演无 | L1 设定闲置检查；L3 剧情推演（R3） |
| 4 | 故事圣经、一致性、生成与扩写成熟 | canon + 人物档案 + 时间线 + invariants + 冲突标记，是全项目最扎实的部分；**正文扩写工具缺失**（只有卷纲展开） | B3 扩写（R2） |
| 5 | 精准召回伏笔与设定、大纲/角色/世界观管理深度 | `queryCanon` 已有打分召回（到期未收线索 +8，`canon.js:552`）；但**线索段排在事实之后，预算紧时会被挤掉**；客户端正典只读、无编辑 | A1 到期线索前置/预留预算 + 测试 |

**一句话**：墨炉的"判得准"已经很强，"写得像人"缺词汇/对话两组尺子，"商业节奏"缺爽点兑现这一道闸门，而"云端/拆书/推演"是产品层缺口，不是代码补丁。

---

## 1. 聚类：5 段描述 → 5 个能力域

| 能力域 | 描述里的原话 | 判定性质 |
|---|---|---|
| **D1 文本质感**（prose） | 词汇丰富、对话有张力、画面感强、AI 味少、润色、伏笔回收 | 一半可确定性判定（词汇/对话/画面/标记），一半靠提示词 |
| **D2 商业节奏**（market） | 黄金三章、平台节奏、爽点模板、全篇创作、一键续写、云端存稿、拆书、编辑视角大纲、上手快 | 结构数据可判定；功能缺口是产品层 |
| **D3 逻辑闭环**（logic） | 复杂设定闭环、漏洞排查、剧情推演、性价比、中文理解 | 规则可判定；推演是生成式功能 |
| **D4 故事圣经**（bible） | 故事圣经、一致性、生成与扩写 | 已有主体的强化，不是新造 |
| **D5 召回与管理**（access） | 精准召回伏笔与设定、大纲/角色/世界观管理深度 | 检索排序与展示层 |

跨域重复项归并：**"伏笔回收"** 同时属于 D1（写得动人）与 D5（召得准），拆成 C6（兑现质量）与 A1（召回时机）；**"AI 味"** 归 D1，但阈值与清单维护依赖 D4 的正典事实，不重复立需求。

---

## 2. 现状核对（证据表）

| 能力 | 状态 | 证据 |
|---|---|---|
| 单章体检 | ✅ 10 类 finding（+ craft 读数 22 项） | `src/recipes/novel/craft.js`，stats 全集 640–682 |
| 全书体检 | ✅ 8 类全书规则 + 6 类逐章规则 | `src/recipes/novel/consistency.js:916-937` `audit()` |
| 钩子强度连续低 | ✅ warn | `consistency.js:677` `hook-streak`（连续≥3 章 ≤2） |
| 5 分钩占比 | ✅ note | `consistency.js:701` `hook-share`（>20%） |
| 中点漂移 | ✅ note | `consistency.js:640` `midpoint-drift`（42%–58%） |
| 场景无价值翻转 | ✅ note | `turn-flat` |
| 首末不翻转 | ✅ note | `consistency.js:753` `bookend-flat` |
| B 线不合流 | ✅ note | `consistency.js:928` `bline-unmerged` |
| 兑现章新专名未入正典 | ✅ note | `consistency.js:826` `payoffNameDriftFindings` |
| 线索逾期未回收 | ✅ warn/note | `consistency.js:521` `threadStaleFindings`（dueIn/closedIn） |
| 正典三元组冲突 | ✅ warn | `canon-conflict`（同 s\|p 不同 o） |
| 设定约束被违反 | ✅ warn | `invariant-hit` |
| 反 AI 腔 | ✅ 13 类标记 + 17 条清单 | craft stats `aiMarkerPer1k`；`docs/prompts.md` §8 |
| 画面感（感官） | ✅ 五感分桶 + 密度阈值 | craft stats `sensoryBuckets` |
| **词汇多样性** | ❌ 零 | grep `词汇/diversity/ttr/unique` 无命中 |
| **对话张力** | ❌ 只有比例与标签密度 | stats `dialogueRatio/dialogueTag*`，无张力类 finding |
| **爽点兑现节奏** | ❌ 无 | 提示词写了 `payoffEveryChapters:[3,5]`（`zh.js` opener），代码无检查 |
| **选段/章节润色** | ✅ R2 已落地（无 UI） | `src/host/assist.js` 新增 `polish-passage`：只改选段、长度 ±15%、不动专名与事实；`ASSIST_TASKS` 现 5 个任务 |
| **正文扩写** | ✅ R2 已落地（无 UI） | `src/host/assist.js` 新增 `expand-scene`（800–1200 字成稿，风格按 tone）；验收 `checkExpansion()` 查字数区间与专名保持 |
| **一键续写** | ✅ R2 已落地 | 章节页「续写本章」按钮 + `novel_continue` 工具 + `POST /projects/:id/chapters/:chapterId/continue`；复用 `continuation.js` 断点续写，不是续跑下一章 |
| **云端存稿** | ❌ | grep `cloud/sync/backup` 无命中；本地 `versionsKept: 3`（`src/forge/store.js:17`） |
| **拆书** | ⚠️ 本地确定性半段（R2） | `src/recipes/novel/deconstruct.js` + `novel_deconstruct` 工具：章节切分/章长/对话比/场景密度/章末钩子/句长/高频二字组；整本送模型待决策 |
| **编辑视角大纲导出** | ✅ R2 已落地 | `novel_export` format 增 `outline-editor`：14 列审稿单，同时落 md 与 csv（带 BOM） |
| **黄金三章契约** | ⚠️ 代码写了、测试写了、**从未接线** | `src/recipes/novel/outline.js:294` `checkOpeningContract()`；全仓唯一调用点是 `test/plan.test.mjs:418` |
| **到期线索进材料包** | ✅ 部分（会被预算挤压） | `src/recipes/novel/canon.js:552` `dueBonus = 8`：到期未收的线索必进切片；但 `formatCanon` 把【未回收线索】排在事实/注记之后（`canon.js:725`），3200 字紧时仍可能截断 |
| **召回打分** | ✅ 关键词/章距打分（无语义层） | `canon.js:490` `queryCanon`：cast/关键词/地点/章龄/到期加分，默认 limit 48 |
| **设定闭环（设定闲置）** | ❌ | 只有 `invariant-hit`（违反），无"登记后从未使用" |
| **剧情推演** | ❌ | 无 |
| 导出 | ✅ md / epub | 同上 |

---

## 3. 需求清单

优先级：**P0** 本轮做；**P1** 下一轮做；**P2** 立需求待决策/待做。

### D1 文本质感

#### C1 · 词汇丰富度闸门（P0）
- **需求**：给单章正文一个确定性词汇指标，并在提示词里给出可执行的"换词"指令。
- **口径（不引入分词依赖）**：
  - `bigramTtr` = 不重复二字组数 / 二字组总数（全章）；
  - `charVariety` = 不重复汉字数 / 总汉字数；
  - `topBigrams` = 频次最高的 5 个二字组及其次数（排除人物名与功能词表）。
- **判定**：`bigramTtr` 低于**实测基线**才 note，不做 warn（宁漏勿误报）；`topBigrams` 只入 review 材料，不单独报 finding。
- **验收**：新增测试用两段人写样本（`test/fixtures/craft/`）锁定方向（好的样本 ttr 更高）；`npm test` 绿；`docs/prompts.md` §6.1 补口径。

#### C2 · 对话张力闸门（P0）
- **需求**：把"对话有张力"落成 4 个可测量：对话轮次、单轮均长、问句占比、对话内动作穿插率。
- **口径**：以引号段为轮次；`turnCount`、`avgTurnLen`、`questionRatio`、`actionBetweenRatio`（相邻两轮对话之间是否有非对话叙事句）。
- **判定**：`turnCount ≥ 8` 且 `actionBetweenRatio < 0.25` → note「对话成片，缺动作与反应」；`questionRatio < 0.15` 且 `turnCount ≥ 8` → note「没人问问题，信息是喂的」。两条都只 note。
- **验收**：两段对照样本测试；stats 字段进 `docs/architecture-v2.md` §6.1 表。

#### C3 · 润色通道扩展到选段（P1）
- **需求**：用户在章节里选中一段 → 只改这一段，输出保持长度 ±15%，不改事实与专名。
- **实现**：`src/host/assist.js` 增 `polish-passage`；prompt 复用 revise 的"外科医生"段 + 三条硬约束（不改专名/不改事实/不超字数）；client 在 ChapterView 加选区按钮。
- **验收**：单测（假 ctx 断言三条约束出现在 system）；UI 手测记录。

#### C4 · 反 AI 腔清单维护（P1，低成本高收益）
- **需求**：清单从 17 条扩到 20 条，补"抽象名词作主语""'仿佛/似乎'叠用""情绪副词修饰动作"三类；同步 `docs/prompts.md` §8（两处同步是既有约定）。
- **验收**：`docs/prompts.md` 与 `zh.js` 条目数一致的单测（现有测试模式可扩展）。

#### C5 · 伏笔兑现质量（P1）
- **需求**：兑现章除了"专名入账"，再查"兑现是否落地"：线索 `text` 关键词在兑现章正文出现 ≥2 次，且至少一次不在对话里。
- **判定**：不满足 → note `payoff-thin`；线索无 `keywords` 字段则整条跳过（宁漏）。
- **验收**：构造"只提一句"的样本命中，正常样本不命中。

### D2 商业节奏

#### M1 · 爽点兑现节奏闸门（P0）
- **需求**：把提示词里的 `payoffEveryChapters:[3,5]`、`bigPayoffPerVolume:[2,3]`、前三章递进（ch1 small / ch2 small|medium / ch3 medium）变成代码检查。
- **口径**：只读卷纲 `chapters[].payoff.level`（`none|small|medium|large`）与 `payoff.chapterDue`；字段缺失的章跳过，不猜。
- **判定**：连续 >5 章无 `small|medium|large` → warn `payoff-gap`；单卷 `large` 数量 >3 或 ==0（全卷已排完时才判）→ note `payoff-volume`；第 1–3 章 level 非"递进"→ note `payoff-opening`。
- **验收**：`test/consistency-*.test.mjs` 三组样本；与 `hook-streak` 同风格的 finding 结构。

#### M4 · 一键续写（P1）
- **需求**：非 agent 用户点一次，写完"下一章"（生成草稿 → 自动审 → 落盘），失败可回退到 `.versions`。
- **实现**：`novel_run` 已有 window/stages；新增 `novel_continue`（无参：取 `novel_next` 的 write 目标 → `stages:['draft','review']`）；client 工作台主按钮复用。
- **验收**：路由单测（目标章从 next 推导、缺章报 400）；不动提示词。

#### M5 · 云端存稿（P2，需用户决策）
- **需求**：存稿不丢、可回溯、可跨机。
- **现状**：本地 `.versions` 每 key 保留 3 份（`store.js:17`），无云。
- **决策点**：① 只做本地增强（版本面板 + 一键打包 zip）→ 零外部依赖；② 接用户自己的 iCloud/Dropbox 目录 → 目录同步，不做账号；③ 做墨炉自有云 → 需要账号/合规/运维，**不建议插件层做**。
- **建议**：先 ①，稳定后再评估 ②。

#### M6 · 拆书（P1）
- **需求**：导入一部已有作品（或前 N 章）→ 产出可用的结构卡：故事核、主要人物、卷/章骨架、伏笔清单、每章钩子类型。**不写正文、不改用户原文**。
- **实现**：新工具 `novel_deconstruct`（输入文件路径或粘贴文本 → 分块调用 → 落 `deconstruct.json`，再由用户选择"以此开新书"导入 canon）。需新增 1 个 prompt builder（受 2500 上限约束，单独 system）。
- **验收**：用 3 章样本跑通，产出字段齐全；`npm test` 加假 ctx 断言。

#### M7 · 编辑视角大纲导出（P1）
- **需求**：导出"编辑要看的那张表"：章号/标题/POV/目标/冲突/转折/钩子类型+强度/爽点等级/伏笔（立/收）/字数预算/状态/审校结论。
- **实现**：`novel_export` format 增 `outline-editor`（纯 CSV/Markdown 表格，不调模型）。
- **验收**：单测断言表头与行数 = 章数。

### D2 补一项

#### M1b · 接线黄金三章契约（P0，零新判定逻辑）
- **需求**：`checkOpeningContract()` 已经写好并有 4 个测试（`test/plan.test.mjs:417-455`），但生产代码从不调用。把它接进 `novel_audit`（`src/host/tools.js:725`）与草稿前的门禁，让"第 1 章没信息增量 / 第 2 章没兑现 / 第 3 章钩子同型"能被用户看见。
- **实现**：`novel_audit` 结果里追加 `opening` 段（缺 opener 工件时静默空）；`novel_next` 在写第 1–3 章时把未通过的 issue 作为前置提示。**不新增判定逻辑，只接线**。
- **验收（已满足）**：`test/tools-v2.test.mjs` 4 条（audit 报 opening-contract 且仍为 5 键、无 opener 时静默、novel_next 的 `opening.ok=false` 并前置提醒、无工件时不多嘴）。

### D3 逻辑闭环

#### L1 · 设定闲置检查（P0/P1）
- **需求**：正典里登记过的设定/道具/机构，若连续 20 章未被任何正文提及 → note `setting-orphan`，提示"要么用起来，要么删掉"。
- **口径**：canon `entities`/`facts` 的 s/o 专名在章节正文中的出现位置；只查 ≥4 字的专名（避免通用词）。**只 note**。
- **验收**：构造 25 章样本命中；短篇不误报。

#### L2 · 漏洞排查（已强，只补一项）
- **需求**：同一事件在两章被写成不同时间/地点 → 现有 `timeline-regress` 只查倒序，补"同一事件异地"检测。
- **验收**：样本测试。

#### L3 · 剧情推演（P2）
- **需求**：给定当前正典 + 一个目标（"主角必须在第 30 章前拿到钥匙"），输出 2–3 条可走路径，每条带代价与后续风险，不落盘。
- **实现**：assist task `plot-simulate`，只读 canon + 最近 3 章摘要；输出结构化 JSON 供用户挑一条写进脊柱。
- **验收**：假 ctx 断言输出 schema；不写库。

### D4 故事圣经

#### B1 · 一致性（已强）
- 已有 canon 三元组、人物 knows/relations/lastSeen、时间线、invariants、冲突标记。**不立新需求**，只在 C5/L1 里复用。

#### B2 · 圣经视图（P1）
- **需求**：client 里能按人物/地点/线索/时间线四个视图浏览正典，并直接看到"这条设定被哪几章用过"。
- **验收**：手测截图 + 不改数据。

#### B3 · 正文扩写（P1）
- **需求**：选中一章的某个场景（或一句细纲）→ 扩写成 800–1200 字成稿，事实与专名不变，风格按 `tone`。
- **实现**：assist task `expand-scene`；与 C3 共用"三条硬约束"。
- **验收**：长度区间与专名保持的单测。

### D5 召回与管理

#### A1 · 到期线索不被预算挤掉（P0）
- **需求**：`dueIn ≤ 目标章` 且未 closed 的线索，进正典切片时必须在**最前面**；3200 字预算紧时，宁可少放两条普通事实，也不能少放到期线索。
- **现状（已核实）**：`queryCanon` 给到期未收线索 `dueBonus = 8`（`canon.js:552`），所以它一定被选入切片；问题在渲染顺序——`formatCanon` 先输出硬规则/不可违背/事实/注记，再输出【未回收线索】（`canon.js:706-745`），预算按顺序裁切时线索段最先被砍。
- **实现（已落地，与本行原方案不同）**：没有改 `formatCanon` 的段序，而是做成**独立分片**——`packet.js` 新增并列常量 `DUE_THREADS_SPEC`（title「到期待收线索」/ cap 600 / priority 2），由 `chapter.js` 的 `dueThreadsText(canon, chapter)` 从结构化 `canon.threads` 筛出「dueIn ≤ 本章号且未收」的线（一行一条，末尾固定提示行「以上线索已到期，本章必须回应或显式延后」），非空时插在正典之前。理由：canonText 在进入 packet 前已被渲染成整块字符串，反解析不可靠；独立分片有独立 cap，预算再怎么裁都挤不掉，且不动既有的 3200 字正典切片契约。
- **验收（已满足）**：`test/packet-due-threads.test.mjs` 5 条（分片 cap、顺序在 `## 正典` 之前、1500 预算下仍在、无到期不产生空片、只收未关闭且已到期的线）；`test/integration.test.mjs` 新增一条走引擎草稿路径的用例，断言 `ctx.packet.text` 含「到期待收线索」且排在 `## 正典` 之前。
- **已知残留**：canonText 的线索段仍会再列一遍到期线索（约 200 字冗余，在 600 预算是可接受代价，暂不去重）；引擎侧 `assemblePacket` 兜底与 revise 两条路径已接线（`index.js:1198/1510/1701`），`novel_context` 的 prepareChapter 路径由 `chapter.js:965` 覆盖。

#### A2 · 召回精度（P2）
- **需求**：当前是按人物名/关键词/章距打分。语义召回（embedding）需外部依赖与索引成本 —— **列为决策点，不在插件内硬做**。

#### A3 · 管理深度（P1）
- 与 B2 合并：视图即管理入口。

---

## 4. 分轮施工计划

### R1（本轮，分支 `novel-forge/capability-2026-11`）
- C1 词汇丰富度（craft.js + 测试 + 文档口径）
- C2 对话张力（craft.js + 测试 + 文档口径）
- M1 爽点兑现节奏（consistency.js + 测试）
- M1b 接线黄金三章契约（tools.js/outline.js 调用点 + 测试）
- A1 到期线索前置（落地为 packet 独立分片，`packet.js:62/284` + `chapter.js:668/965` + `index.js:1198/1510/1701`；见上文「实现」）
- 提示词侧：`ADDENDA.draft` 增"换词 / 对话暗流"两条（+50 字，draft 2401 → ≤2500）；`craftStatsText` 增 6 个读数（进 user，不占 system 预算）
- 文档：`docs/prompts.md` §6.1/§12.3、`docs/architecture-v2.md` §6.1/§8、README 体检表

**R1 验收（2026-11-16 已完成）**：`npm test` 520 tests 全绿（0 fail）；`node dev/verify.mjs` 通过。新增用例：`craft-vocab`(6) / `craft-dialogue-tension`(7) / `consistency-payoff`(20) / `packet-due-threads`(5) / `tools-v2` 黄金三章 4 条 / `integration` 引擎草稿路径 1 条。
- 阈值实测依据（不是经验值）：二字组多样性在两篇 1.1k 成稿上 0.8077 / 0.7864，2.3k 字约 0.70，4.5k 字约 0.68；合成重度重复 963 字为 0.0582 → 取 0.60 只抓重度重复，正常长章不误报。对话两条闸门按契约 8 轮 / 0.25 / 0.15，两篇成稿 0.676、0.929 与 0.229、0.207 均不触发。
- **口径决定（W2 提出）**：前三章出现 `large` 一律按「提前给大爽点」报 note，与提示词「large 留卷末」一致；findings 只提醒、不阻断。若日后要放开「第 3 章 large」，改 `consistency.js` 的 `payoffOpeningFindings` 里 `largeAt` 循环起点一行即可。
- 顺带修掉的测试脆弱点：`test/consistency.test.mjs` 的 300 章性能用例改为取三次最快值（并发负载下偶发 113/171ms 假红）。

### R2
M4 一键续写 → M6 拆书 → M7 编辑视角导出 → M5 存稿（先本地增强）→ C3/B3 润色与扩写 → B2 视图

### R3
L1 设定闲置 → L2 事件异地 → L3 剧情推演 → A2 召回（若决策要做）

### 需用户决策（R2 前）
1. 云端存稿走"本地增强 + 用户自有网盘目录"还是"自有云"？（建议前者）
2. 拆书是否允许把整本导入文本送模型（成本与版权）？
3. 语义召回是否接受引入外部 embedding 依赖？

---

## 5. 非目标

- 不做写作模型的微调/自研模型（"中文理解扎实"是模型能力，插件只做提示词与闸门）。
- 不做社交/发布/多平台分发。
- 不改现有 30+17 类检查的 kind 名与 severity 语义（用户已建立认知，改名即破坏）。
- 不在提示词里做确定性检查（既有约定，`docs/prompts.md` §13.9）。
