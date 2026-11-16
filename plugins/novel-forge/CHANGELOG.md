# Changelog

本文件记录墨炉的可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号沿用 `package.json`。

## [Unreleased]

### Added

- 单章体检新增场景密度（`scene`）、开篇三句（`opening`）、感官五桶（`sensory-vision`）、人名密度（`name-density`）与章末落点（`ending-summary`、`ending-mode`）六类 note。
- 单章体检新增 AI 标记密度（`ai-density`）、引号配对与混用（`quote-mix`、`quote-unclosed`、`quote-punct`）、万能副词（`adverb-universal`）四类提示；低对话区间（8%–15%）也单独 note。
- 全书体检新增 `turn-flat`、`midpoint-drift`、`hook-streak`、`hook-share`、`bookend-flat`、`bline-unmerged` 六类结构检查，以及兑现章未登记专名的 `name-drift` 路径。
- 提示词新增 `pitch` 与 `opener` 两个 builder，分别负责商业定位与前三章单排；两者都可不跑，流水线不阻塞。
- 人物卡新增 `need`、`wound`、`lie`、`exit` 四个可选字段（各不超过 30 字），只要求主角与对手填写。
- 细纲每场新增 `function`（不超过 20 字），并明确每场只新增一个信息或一个人物、同场有台词的具名角色不超过 4 个。
- 卷纲新增可选 `midpointChapter`，可用比例（0–1）或章号表示；缺省时中点检查整条跳过。
- README 新增「体检与结构校验清单」，逐条列出单章 27 类、全书 14 类 finding 的级别、触发条件与来源文档。

### Changed

- 正文规格改为段落中位 20–80 字、长短交错，不许连续三段同长；章末必须停在动作或画面，最后 3 行落在钩子上，不写总结或感悟。
- AI 标记改为按区间合并去重后计数，长框架里的词不再重复计数；同时保留合并后的命中数（`aiMarkerCount`）与密度（`aiMarkerPer1k`）两个读数。
- 线索回收优先读 `thread.dueIn` 的绝对章号：当前章超过计划章报 warn；没有 `dueIn` 时仍按 40 章未回收报 note。
- 场景统计在没有空行分场时按转场信号软切，不再把整章算成一场。
- 提示词构建器从 12 个增加到 14 个，system 最长仍是 draft（3000 字章实测 2401 字符），全部在 2500 以内。
- `docs/prompts.md` 的阶段表、分阶段设计、自检与维护约定同步到 14 个 builder。

### Fixed

- 长章输出撞到模型输出上限时不再整章失败：把已经写出的半截正文当作上文，自动续写最多 3 段再拼接（去重断点句），草稿与修订两条路径都生效；网关的 `LLM_TRUNCATED` 现在会带回半截稿（`detail.text`），并且正文阶段不再把整篇重生成一遍去换更大预算。
- 修复 `thread.dueIn` 被当成「相对章数」比较、导致计划回收章永远不触发的问题；现在按绝对章号判定。
- 修复引号检查用跨段贪婪正则、同段两段对话互相吃掉的问题；改为逐行栈配对。
- 修复 AI 腔词与句式重叠时同一处被计两次的问题。
- 修复文档与实现不一致：README 与 `docs/prompts.md` 里的构建器数量、system 长度、一致性规则清单均已按当前代码更新。
