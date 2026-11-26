# Changelog

本文件记录墨炉的可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号沿用 `package.json`。

## [0.8.0] - 2026-11-26

- 审校通过时保留正文。自动修订最多两轮，单轮改动不足 5% 时提前停止。词频读数最高报 warn，纯词频问题不再单独触发修订。审校增加中文体检、局部落差、场景五维和具体利害抽查，并可用 `scripts/style-baseline.mjs` 比较历史章节的风格读数。

### Added

- 人物档案分为核心、阶段和登记三层。正典按已登记的别名合并身份，卷纲保存阶段人物简卡，章节共用按出场人选取的速查。核验过的出场进入正典，间隔至少 6 章会提示用旧标签再识别，`characters.md` 随正典分层更新。

### Fixed

- **重跑不再「只执行 19 章」（2026-11-24 真实事故）。** 20 章正文齐全，随便重跑一次只剩 19 章的完成度：界面重跑固定带 `force:true, window:10`，候选章是全书 50 章，窗口永远落在 ch001–ch010；第 11 章返回 `defer` 后又被引擎打回 `pending`，于是「本来就完成的章」被降级。现在：
  - `defer` / 取消不再把上一轮已完成的条目改成 `pending`，保留原状态。
  - 工作台重跑改为「重做已有产物」：按当前阶段已有产物取条目，窗口按条目数取（上限 200），不再固定 10 章。
  - 覆盖率日志补上「正文已落盘 N 章」，避免把「19/50 个阶段条目」误读成「只写了 19 章」。
- **重跑正文后旧审校仍显示「已完成」。** 审校产物引用的还是旧稿，问题清单对不上新正文。`recipe.reconcile` 现在在正文由 `draft` 阶段重写、且晚于审校产物时，把对应 `review` 条目收回 `pending`（`revise` 回写不触发，避免来回打转）。真实项目验证：20 章项目只收回被重写的 ch001–ch010，ch011–ch020 保持完成。
- **单章审校的问题数被三类误报灌水（2026-11-24 真实事故：253 条 block/warn 中 148 条来自误报）。**
  - `dead-character`：旧规则用 `/死|亡/` 匹配状态文本，「锁死后该区域不可分辨」把活人判死。改为显式死亡词表（死亡/身亡/阵亡/遇害…），存活词优先；宁可漏报，不再误判。
  - `name-drift`：2–4 字高频 n-gram 把「九点/复核/档案/推车」当人名，20 章刷出 160 条。改为「常见姓氏（或老/小/阿）+ 动作/言说上下文 + 非名词尾字」三重条件，真实数据误报 160 → 6，保留「周野推门」这类真新人名。
  - `canon-conflict`：把「状态/持有」的自由文本快照当互斥枚举，且每章重报历史冲突（第 20 章 13 条）。长于 18 字或带标点的取值不再视为互斥值；单章审校只报本章新事实引发的冲突（`chapterOnly`），账本视图行为不变。
- 回归测试：`defer` 保留 done、窗口重跑只覆盖已有产物、审校失效回收、锁死≠死亡、日常名词≠人名、长文本≠正典冲突、`chapterOnly` 不复述旧冲突。

## [0.7.1] - 2026-11-23

### Fixed

- **没写的章不再被算成「已审校 / 已修订」（2026-11-23 真实事故）。** 只写了 10 章正文，阶段轨却显示「审校 50/300、修订 47/300」：`review` / `revise` 遇到还没有正文的章会返回空产物（`{artifacts:{}, note:'还没有正文，跳过审校'}`），引擎把「没抛错」一律记成 `done`，于是「还没轮到」被伪装成「已完成」，续跑时这些章还会被 `#isComplete` 永久跳过。现在：
  - 引擎支持 `stage.run` 返回 `{skipped:true}`：条目记 `skipped`（UI 显示「已跳过」），不计入运行进度，阶段收尾降为 `partial`，下次运行仍会重试。
  - novel recipe 的三条「现在做不了」路径（审校缺正文、修订缺审校、修订缺正文）改标 `skipped`；「没有 block/warn 所以不修订」这类真正跑过判断的路径仍然是 `done`。
  - 引擎读项目时调用 recipe 的 `reconcile`：把历史项目里「记了 done 却从没为该章产出过东西」的条目回收为 `pending`（review 认 `review/<id>`；revise 认 `review/<id>` 且有 `draft/<id>`），不用手动删项目自救。
- 附回归测试 `test/stage-skip-reconcile.test.mjs`：skipped 不占进度/阶段 partial/下次重试、reconcile 幂等、读项目落盘校正。

## [0.7.0] - 2026-11-22

- 审校产物为模型 finding 增加 `quote` 和 `quoted`，默认不降级。

- 每本书生成可在编辑器阅读的 `book/` Markdown 快照，以本地 Git 记录阶段和逐章变化。工作台给出书稿目录卡片：可直接「打开目录」（唤起访达 / 资源管理器）或复制路径；目录尚未生成时按钮置灰并给出回填命令。已有项目可用回填脚本补建快照。

### Fixed

- **输出截断不再整炉失败（2026-11-22 真实事故）。** 推理模型把 `max_tokens` 同时算「思考 + 正文」，4500 字的章还没开写就撞上限：草稿 ch001 连续两枪 0 字（8800 / 16000），旧逻辑只会「加倍预算」，加倍也还是 0 字。现在：① 空正文截断先**关思考**重试一次（宿主不支持会自动降级，不会报错）；② 正文阶段（draft / revise / continue）默认 `reasoningEffort=off`，把预算全部留给正文；③ JSON/细纲截断的补枪也关思考；④ 错误信息区分「思考吃光预算」与「章太长」，并带上 `reasoningChars`，不再给一句没法执行的「调小每章目标字数」。
- 修掉一个收尾竞态：run 已经收敛成 `done`（`getRun` 已可见）但 `live` 还没摘掉的那一瞬间，手动写产物会吃到假的 `RUN_ACTIVE`。`#busy` 现在按 run 的实际状态判断，只有 running/paused 才算占着项目。
- 端到端脚本补上审稿门放行（大纲 / 草稿 / 审校 / 修订四道门）与版本自查桩，真宿主冒烟不再把「暂停等确认」误判成失败。
- 卷纲每批最多生成 12 章，截断时保留完整章节并从缺失章号继续。普通 JSON 阶段遇到截断时补救一次。

## [0.6.0] - 2026-11-20

### Added

墨炉新增可选的市场坐标，为商业定位提供起点月票榜参考。

- 收录 2015–2026 年每年 TOP10 的风向和作品热度主因，2026 年为进度版。
- `novel_create` 新增 `marketMode` 和 `marketYear`，支持按年参考或按标签匹配，默认关闭。
- 面板「新建长篇」新增「市场坐标」，可选「按年份」或「按标签」，也可指定榜单年份，默认关闭。
- 商业定位提示词加入不超过 700 字的市场坐标，提醒只借机制，并注明月票口径。

## [0.4.0] - 2026-11-16

### Added

- `novel_export` 新增 `format: 'outline-editor'`：导出编辑视角审稿单，同时落 `《书名》-编辑审稿单.md` 与 `.csv`（UTF-8 BOM、RFC4180 转义）。14 列固定顺序：章号/标题/POV/目标/冲突/转折/钩子类型/钩子强度/爽点等级/伏笔(立)/伏笔(收)/字数预算/状态/审校结论；纯本地拼表，不调模型。`src/forge/engine.js` 的 `exportProject` 因此支持导出器返回 `extras`（一次导出多文件）并逐个落盘。
- 章节页新增「续写本章」：接着这一章已有正文的断点往下写，而不是续跑下一章。引擎侧是 `engine.continueChapter`（走 `.versions` 滚动）、模型侧复用 `continuation.js` 的断点指令与重叠去重（最多续 2 段），目标字数是 `wordsPerChapter` 减已有字数；已有字数达标时不调模型、直接返回 `skipped`。同时新增 `novel_continue` 工具与 `POST /projects/:id/chapters/:chapterId/continue`。修掉一个真 bug：`asForgeError` 会丢掉 `LLM_TRUNCATED` 的 `detail.text`，导致续写拿不到已写出的半截正文。
- 写作助手新增两个任务：`polish-passage`（选段润色，只改这一段，长度 ±15%，不动专名与事实）与 `expand-scene`（一句细纲/一个场景扩成 800–1200 字，风格按 tone）。两者共用三条硬约束，并新增确定性验收 `checkExpansion(text, {minChars, maxChars, names})`（字数区间 + 专名保持，能识别「沈砚」被写成「沈砚之」这类改名）。
- 全书体检新增伏笔兑现质量 `payoff-thin`（note）：兑现章里线索关键词出现 < 2 次、或 2 次全在引号对话里，提示「兑现没落在正文上」。线索 text 派生不出可检索关键词时整条跳过（宁漏勿误报）；同章已报 `name-drift` 时不叠加。
- 新增 `novel_deconstruct` 工具与 `src/recipes/novel/deconstruct.js`：把一本现成小说的纯文本拆成章节骨架与文风指纹——章节切分（第X章 / Chapter N / markdown 标题 / 纯数字）、章长曲线、对话比、场景密度、章末钩子类型（question/reveal/danger/turn/none，末句判不出时回看一句并看章末 120 字有无问号）、平均句长、高频二字组。全本地确定性解析；给 `project` 时把完整结果落成 `deconstruct` 产物。
- 单章体检新增词汇与对话三项：`vocab-flat`（正文≥800 字且二字组多样性 < 0.6，抓重度重复）、`dialogue-flat`（对话≥8 轮但轮间夹叙事 < 25%）、`dialogue-no-question`（对话≥8 轮但问句 < 15%）；`stats` 相应新增 `bigramTtr`、`charVariety`、`topBigrams`、`turnCount`、`avgTurnLen`、`questionRatio`、`actionBetweenRatio`。
- 全书体检新增爽点兑现三项：`payoff-gap`（连续 6 章以上没有小/中/大兑现，warn）、`payoff-volume`（已排完的卷 large 超过 3 章，或整卷没有 large）、`payoff-opening`（前三章爽点不递进或提前给 large）。
- `novel_audit` 与 `novel_next` 接上 `checkOpeningContract`：黄金三章契约（infoDrop / promiseBeat / 前三章钩子不重复 / 第 3 章指向第一幕大问题）从「只有单测引用」变成体检与下一步提醒的一部分；没有 opener 工件时静默跳过。
- 材料包新增独立分片「到期待收线索」（cap 600，priority 2，排在正典之前）：`dueIn ≤ 本章号` 且未关闭的线索一定进包，不再被 3200 字正典预算裁掉；`draft` 兜底与 `revise` 两条引擎路径同样生效。
- 新增需求规格 `docs/requirements-2026-11.md`：把「文本质感 / 商业节奏 / 逻辑闭环 / 故事圣经 / 召回管理」五域拆成 22 条需求与三轮施工计划。
- 单章体检新增场景密度（`scene`）、开篇三句（`opening`）、感官五桶（`sensory-vision`）、人名密度（`name-density`）与章末落点（`ending-summary`、`ending-mode`）六类 note。
- 单章体检新增 AI 标记密度（`ai-density`）、引号配对与混用（`quote-mix`、`quote-unclosed`、`quote-punct`）、万能副词（`adverb-universal`）四类提示；低对话区间（8%–15%）也单独 note。
- 全书体检新增 `turn-flat`、`midpoint-drift`、`hook-streak`、`hook-share`、`bookend-flat`、`bline-unmerged` 六类结构检查，以及兑现章未登记专名的 `name-drift` 路径。
- 提示词新增 `pitch` 与 `opener` 两个 builder，分别负责商业定位与前三章单排；两者都可不跑，流水线不阻塞。
- 人物卡新增 `need`、`wound`、`lie`、`exit` 四个可选字段（各不超过 30 字），只要求主角与对手填写。
- 细纲每场新增 `function`（不超过 20 字），并明确每场只新增一个信息或一个人物、同场有台词的具名角色不超过 4 个。
- 卷纲新增可选 `midpointChapter`，可用比例（0–1）或章号表示；缺省时中点检查整条跳过。
- README 新增「体检与结构校验清单」，逐条列出单章 30 类、全书 17 类 finding 的级别、触发条件与来源文档。

### Changed

- 正文规格改为段落中位 20–80 字、长短交错，不许连续三段同长；章末必须停在动作或画面，最后 3 行落在钩子上，不写总结或感悟。
- AI 标记改为按区间合并去重后计数，长框架里的词不再重复计数；同时保留合并后的命中数（`aiMarkerCount`）与密度（`aiMarkerPer1k`）两个读数。
- 线索回收优先读 `thread.dueIn` 的绝对章号：当前章超过计划章报 warn；没有 `dueIn` 时仍按 40 章未回收报 note。
- 场景统计在没有空行分场时按转场信号软切，不再把整章算成一场。
- 提示词构建器从 12 个增加到 14 个，system 最长仍是 draft（3000 字章实测 2498 字符，余量 2），全部在 2500 以内。
- `docs/prompts.md` 的阶段表、分阶段设计、自检与维护约定同步到 14 个 builder。

### Fixed

- 修复客户端请求层把「2xx 但响应体不是 JSON」当成「没有内容」静默吞掉的问题：现在抛带 `BAD_RESPONSE` 的中文错误（`墨炉服务返回的不是 JSON（HTTP 200），请重启宿主后重试`），不再漏成 `Cannot read properties of null` 这类英文 TypeError，也不会把读不到的书架/章节静默显示成空态。空响应体（204 / 无内容）仍按原来的 `null` 处理。`test/client-audit.test.mjs`（9 条）覆盖非 2xx / 网络断 / 非 JSON 2xx / 空体 / abort 五类路径，以及章节页不再把请求失败渲染成空态。

- 修复 v2 大纲在界面上一章都不显示的问题：v2 把章放在顶层扁平 `chapters`、卷上只有 `chapterIds`，而工作台、章节页与大綱页都只读 `volume.chapters`，于是新项目显示「卷一 0 章」。新增 `client-src/outline.js`（`volumeRows`/`chapterMeta`，与服务端 `chaptersOf` 同口径）供三处共用；v1 形状与「只有扁平 chapters」的历史数据照常显示。
- 修复 `dev/e2e.mjs` 长期跑不通（与 R2 无关的历史缺口）：假 LLM 分派靠 `phase`，而 `chapter.js` 的卷纲/细纲两处 `llm.generate` 没传 `phase`，全部落到默认文案 → 先报 spine 解析失败、再报卷纲没有章节数组。现在两处补 `phase: 'volumeChapters'`/`phase: 'beats'`（与 `callJson` 约定一致），fixture 补 `spine` 与 `volumeChapters` 分支；「运行覆盖全部阶段」的断言从硬编码 10 改为 `STAGES.length`；e2e 宿主补 `activation` 桩，`/novel-forge/tools` 不再 404。现在 `npm run e2e` 25/25 条断言全过。
- 截断但一个字都没吐出来时（推理先把整份输出预算烧光）不再等死：网关会按 2× 加倍预算重试到上限，正文阶段随后追加「不要列提纲、直接写第一句」再要一次，而不是把 `LLM_TRUNCATED` 直接抛给阶段。
- 长章输出撞到模型输出上限时不再整章失败：把已经写出的半截正文当作上文，自动续写最多 3 段再拼接（去重断点句），草稿与修订两条路径都生效；网关的 `LLM_TRUNCATED` 现在会带回半截稿（`detail.text`），并且正文阶段不再把整篇重生成一遍去换更大预算。
- 修复 `thread.dueIn` 被当成「相对章数」比较、导致计划回收章永远不触发的问题；现在按绝对章号判定。
- 修复引号检查用跨段贪婪正则、同段两段对话互相吃掉的问题；改为逐行栈配对。
- 修复 AI 腔词与句式重叠时同一处被计两次的问题。
- 修复文档与实现不一致：README 与 `docs/prompts.md` 里的构建器数量、system 长度、一致性规则清单均已按当前代码更新。
