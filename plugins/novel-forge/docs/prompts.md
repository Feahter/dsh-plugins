# 「墨炉」中文提示词设计（v2 · agent-first）

实现文件：`src/recipes/novel/prompts/zh.js`
契约来源：`docs/architecture-v2.md` §12（提示词契约，硬性）、§3（阶段表）、§5.2（packet 分片）、§2（卷章分层）、§4.4（canon patch 形状）。

本文只描述提示词层：每个 builder 吃什么、吐什么、为什么这样写。引擎调度、校验器、重试策略不在本文范围内。

---

## 1. 目标与非目标

**目标**

- 让长篇小说读起来像人写的：具体感官、潜台词、因果、信息差、节奏呼吸。
- 十二个 builder 各守各的工艺重点，共享同一套「工艺宪法」，避免越写越像大纲或说明文。
- 让模型只做它擅长的事：**填内容**。卷数、卷序、每卷章数、章号、章节 id 全部由脚本给，模型不许决定结构。
- `draft` 的材料全部来自脚本产出的 packet：提示词层不再拼材料、不再做预算裁剪，写作与上下文组装彻底分家。
- 输出格式硬约束：JSON 可被引擎直接解析，markdown 可直接落盘。
- 所有输入都在预算内；缺素材时降级而不是抛错（假 ctx、空 ctx 都必须能出 prompt）。

**非目标**

- 不在这里做事实校验、字数统计、AI 腔计数——那些是 `src/recipes/novel/consistency.js`、`canon.js` 与 `src/forge/**` 的确定性门槛。
- 不在这里调模型、读文件、写文件、改 `ctx`。
- 不为了「文学性」牺牲可解析性；格式优先于自由发挥。

---

## 2. 调用契约

```js
export function createPrompts() {
  return {
    premise, bible, characters, spine, volumeChapters, beats,
    draft, summary, canonPatch, review, revise, blurb,
  }
}
export default createPrompts
```

每个函数都是 `(ctx) => ({ system, user, maxTokens, temperature })`，四个键必须齐全、都是有效值。

- `ctx` 是引擎的 stage ctx，可用：`params`、`project`、`item`、`items`、`index`、`total`、`has(key)`、`read(key)`、`text(key, maxChars?)`、`json(key)`、`list(path)`、`fit(text, maxChars)`、`log()`。
- v2 新增的 ctx 字段（由脚本填，不是模型产物）：

| 字段 | 形状 | 谁给 |
|---|---|---|
| `ctx.volumePlan` | `[{index, title, targetChapters}]` | `plan.js`，卷数固定、按 `effectivePerVolume` 算 |
| `ctx.volume` | `{index, title, targetChapters, goal?, arc?}` | `outline.js` 的卷骨架 |
| `ctx.packet` | `{text, report, sections}` | `packet.js` 的 `buildPacket()` |
| `ctx.previousDigest` | string | 前几卷的压缩前情 |
| `ctx.existingTitles` | string[] | 已有章名（防重名） |
| `ctx.canonText` | string | `canon.js` 的 `formatCanon()` |
| `ctx.castBrief` | string | 人物速查（引擎预渲染，可为空） |
| `ctx.summary` / `ctx.beats` / `ctx.draft` | string \| object | 已产出的上游产物 |

- 读产物优先走 reader（`has/text/json/list`）；reader 读不到时，再退到直接挂在 ctx 上的同名字段（`ctx.brief`、`ctx.bible`、`ctx.characters`、`ctx.outline`）。`draft/ch03` 这类带 `/` 的路径键不走这条兜底。这样 architecture-v2 §12 里 spine/volumeChapters/beats 的 `ctx.brief/bible/characters` 不论引擎给不给 reader 都成立。
- 本文件是纯函数：无 import、无 IO、无网络、无模型调用、不修改 `ctx`。
- `system` ≤2500 字符，且**只放工艺约束**（禁语、视角、输出格式、纪律）。任何一本书的具体材料都不许进 `system`——换了书，`system` 应该基本不变。
- 所有 `ctx` 读取都做了容错：`has` 抛错、`text` 返回空、`json` 抛错、`list` 返回空数组，都走「素材缺失」分支，不中断流水线。

### 2.1 附加导出

| 导出 | 用途 |
|---|---|
| `SUMMARY_MARKER = '<<<SUMMARY>>>'` | `chapter.js` 的 `splitInline()` 按它拆内联摘要；`draft`/`revise` 的 system 里出现 |
| `CANON_MARKER = '<<<CANON>>>'` | `splitInline()` 按它拆内联正典补丁 |
| `sexOf(gender)` | 把 `'male'/'男'/'m'` 等写法归一成 `'男'` 或 `'女'`，识别不了返回 `''`；供 `review` 的代词对照与引擎共用 |

**删除的导出**：`outline`（builder）。v2 的卷/章骨架由 `outline.js` 用脚本建，`outline` 不再是一次模型调用；`index.js` 若还按名字取 `prompts.outline`，会拿到 `undefined`。**新增**：`volumeChapters`、`canonPatch`、`CANON_MARKER`。

### 2.2 每个 builder 的 ctx 依赖（契约表）

| builder | 必须读 | 可选读 |
|---|---|---|
| `premise` | `params.premise` | `genre`、`audience`、`pov`、`tone`、`styleGuide`、`seed`、`chapters`、`wordsPerChapter`、`project.title` |
| `bible` | `params.premise` 或 `brief` | `seed`、`styleGuide`、`params.genre` |
| `characters` | `brief` | `bible`、`params.protagonistGender` |
| `spine` | `params`、`brief`、`bible`、`characters`、`volumePlan` | `seed`、`styleGuide` |
| `volumeChapters` | `params`、`volume`、`spine` | `bible`、`characters`、`previousDigest`、`existingTitles` |
| `beats` | `params`、`chapter` | `volume`、`previousSummary`、`canonText`、`castBrief` |
| `draft` | `params`、`chapter`、`packet.text` | 无——`packet.text` 缺失时才用最小兜底包 |
| `summary` | `chapter`、`draft`、`beats` | `params` |
| `canonPatch` | `chapter`、`summary`、`beats` | `canonText`、`params` |
| `review` | `chapter`、`beats`、`draft` | `canonText`、`previousSummary`、`nextGoal`、`params` |
| `revise` | `chapter`、`packet.text`、`findings` | `draft`（原文）、`params` |
| `blurb` | `brief`、`spine`、`chapters`（章名列表） | `characters`、`params` |

---

## 3. 结构：宪法 + 附录 + 材料 + 契约

`system` 由两块拼成：

1. `CRAFT`：共享工艺宪法。12 条硬约束 + 5 条操作纪律，实测 1221 字符。所有阶段都带。
2. `ADDENDA[stage]`：该阶段的工艺重点、纪律、输出时的自我约束（**不放输出格式**，格式在 user 里）。

两个例外：
- `draft` 的 system 额外带 `inlineProtocolBlock()`（内联摘要 + 内联正典协议）与两行动态规格（字数、视角）。
- `revise` 的 system 额外带 `inlineSummaryBlock()`（修订后只更新摘要，正典由 `canonPatch` 维护）。

`user` 由四块拼成：

1. 项目头：书名、类型、读者、视角、章数 × 字数、文风关键词。
2. 带标签的素材段：`【故事核心】【世界设定】【人物档案】【卷表】【卷卡与前后卷】【本章任务】【正典】【本章正文】`等。
3. 本阶段的写作指令 / 数量硬约束。
4. 输出格式契约：JSON 阶段给「字段表 + 一个最小合法示例」；markdown 阶段给结构骨架。

**唯一的例外是 `draft`**：它的 `user` 严格等于 `ctx.packet.text` 原文，一个字都不加（`packet.js` 已经按 §5.2 的 priority 分片、渲染好 brief/beats/canon/cast/previous/next/style）。提示词层再拼材料，等于绕开 packet 的预算与 report，`novel_context` 与 `draft` 就会看到两份不同的上下文。`revise` 同源：`packet.text` + 【需修正】findings + 原文，三段按剩余预算分配。

截断策略：

- 普通段落用 `ctx.fit`，超长截尾并加「…（已截断）」。
- 正文类长文（review/revise/summary 的 draft）用 `fitEnds`：保留头尾，避免把结尾钩子砍掉（尾部最多 30%，且 ≤2500 字）。
- 多段素材用 `fitSections`：按各段**实际长度**（不超过 cap）等比例缩，收缩后总和严格 ≤ room，返回数组与输入等长同序（缺失段返回 `''`）。这样 `jsonContract` 这类固定块永远完整，不会被 `hardCap` 从尾部砍掉。
- 所有阶段最后都过一遍 `hardCap`，保证 `user` 不超过该阶段上限。

system 实测长度：最短 1464（summary），最长 2458（draft），均在 2500 以内；其余 1512–1777。

---

## 4. 阶段总表

| 函数 | 产物 | 格式 | 主要输入 | maxTokens | temperature | user 上限 |
|---|---|---|---|---|---|---|
| `premise` | `brief` | JSON | premise、genre、audience、tone、styleGuide、seed | 1400 | 0.9 | 6000 |
| `bible` | `bible` | markdown | brief、premise、styleGuide | 3000 | 0.7 | 9000 |
| `characters` | `characters` | JSON | brief、bible、protagonistGender | 3200 | 0.85 | 10000 |
| `spine` | `spine` | JSON | params、brief、bible、characters、**volumePlan** | 6000 | 0.7 | 10000 |
| `volumeChapters` | `outline.chapters`（一卷） | JSON | volume(含 targetChapters)、spine、bible、characters、previousDigest、existingTitles | 6000 | 0.6 | 9000 |
| `beats` | `beats/*` | JSON | chapter、volume、previousSummary、canonText、castBrief | 2200 | 0.75 | 10000 |
| `draft` | `draft/*`（内联摘要 + 正典） | markdown | **仅 `packet.text`** | `min(16000, round(words×2.2))` | 0.9 | 归 packet |
| `summary` | `summary/*` | markdown | chapter、draft、beats | 900 | 0.2 | 10000 |
| `canonPatch` | `canon` patch | JSON | chapter、summary、beats、canonText | 1200 | 0.2 | **1600** |
| `review` | `review/*` | JSON | chapter、beats、draft、canonText、previousSummary、nextGoal | 4000 | 0.1 | 15000 |
| `revise` | `draft/*` + `summary/*` | markdown | packet.text + findings + 原文 | `min(16000, round(words×2.2))` | 0.5 | 归 packet |
| `blurb` | `blurb` | markdown | brief、spine、chapters、characters | 1400 | 0.85 | 9000 |

说明：

- `draft`/`revise` 的 3000 字默认值 → 6600 tokens；8000 字上限 → 16000（`words×2.2` 封顶 16000，与 §4.3 一致）。
- `canonPatch` 是「小调用兜底」：`draft` 的内联正典块缺失或被引擎退回时才调，所以 budget 极小（user 1600），temperature 0.2 只求稳。
- `spine` 从 markdown 改 JSON、从 3200 提到 6000：40 卷 × 6 字段一次写完，3200 会在中途截断。
- `review` 的 4000：推理模型会把预算烧在 reasoning 上，2600 时经常返回空正文（`LLM_EMPTY`），见 architecture-v2 §6.4 #13。
- `beats` 从 2800 降到 2200：v2 里 beats 通常由 `volumeChapters` 一次性排好（章卡），单独 calls 只在需要更细的场景拆分时用。

---

## 5. 输入预算表（字符）

### 5.1 结构类阶段

| 阶段 | 各段预算 | user 上限 |
|---|---|---:|
| `spine` | brief 1500 / bible 2200 / characters 2600 / volumePlan 1600 | 10000 |
| `volumeChapters` | spine 2000 / bible 1200 / characters 1200 / digest 1200 / titles 1000 | 9000 |
| `canonPatch` | summary 1200 / beats 800 / canon 1400（固定块约 520） | **1600** |

`spine` 的卷表由 `volumePlanOf(ctx)` 生成：优先读 `ctx.volumePlan`，退 `ctx.json('volumePlan')`，再退 `ctx.list('volumePlan')`；全缺时按 `plan.js` 的 `effectivePerVolume` / `volumeCount` 同口径兜底，保证「卷数由脚本定」这条在任何调用路径下都成立。

`canonPatch` 的 1600 是硬顶：固定块（本章卡 + 登记规则 + 输出格式示例）约 520 字，剩下约 1000 字按 summary/beats/canon 实际长度等比分配。示例本身占 200+ 字，这就是它不能走 `jsonContract` 长模板的原因。

### 5.2 其余阶段

| 阶段 | 各段预算（字符） | user 上限 |
|---|---|---:|
| premise | seed 2000 / style 600 | 6000 |
| bible | brief 1800 / seed 600 / style 600 | 9000 |
| characters | brief 1800 / bible 3500 | 10000 |
| beats | 章节卡 1800 / 卷 400 / prev 800 / canon 2400 / cast 1400 | 10000 |
| summary | draft 8500 / beats 1000 | 10000 |
| review | draft 7600 / beats 1200 / canon 2200 / cast 800 / prev 400 / next 300 | 15000 |
| blurb | brief 1500 / spine 2400 / titles 1800 / characters 1400 | 9000 |

`draft`/`revise` 的 `BUDGET` 条目只剩历史键（`beats/prev/ledger/next/cast/style/user`），**预算归 packet，不再使用**。保留键是为了别的代码（旧测试、诊断脚本）按名取字段时不崩。packet 自己的分片上限见 architecture-v2 §5.2 的 `SLICE_SPEC`（contextBudget 默认 12000）。

### 5.3 压力实测

假 ctx：3000 章 / 40 卷 × 75 章、canon 2 万字、packet 6 万字、上一章摘要 2000 字、findings 12 条。

```text
premise         system 1550  user  1545  tok 1400
bible           system 1512  user  2823  tok 3000
characters      system 1579  user  6704  tok 3200
spine           system 1679  user  6612  tok 6000
volumeChapters  system 1653  user  6113  tok 6000
beats           system 1625  user  6831  tok 2200
draft           system 2458  user 60000  tok 16000   ← 等于 packet.text，长度由 packet 管
summary         system 1464  user  8756  tok  900
canonPatch      system 1668  user  1573  tok 1200
review          system 1777  user 13728  tok 4000
revise          system 1524  user 14822  tok 16000
blurb           system 1516  user  4872  tok 1400
```

spine 卷表 40 行、volumeChapters 出现「本卷共 75 章，请一次给全 75 章」「必须恰好 75 条」，均在预算内且输出格式块完整。

---

## 6. 共享工艺宪法

`CRAFT` 是所有阶段复用的 1221 字符块，包含 12 条硬约束：

1. **视角**：只写视角人物此刻能感知、能想到、能知道的东西；别人的内心只能靠外在信号让读者判断。
2. **场景**：谁想要什么 + 什么挡着 + 局面怎么变 + 带着什么离开；转折必须改变力量、信息或关系。
3. **具体**：不命名情绪，写动作、身体反应、物件变化；细节和利益有关。
4. **对话**：表面谈 A，底下争 B；规矩在违反、利用、付代价时显形。
5. **信息**：每章改变「谁知道什么」；读者、视角人物、对手的信息差要设计。
6. **因果**：结果能追到前文的选择；巧合只能制造麻烦，不能解决麻烦。
7. **节奏**：长短句交替，一段一个意思；该慢舍得多给细节，该快一句带过。
8. **连续性**：事实、时间、伤病、物品、钱、知情范围、关系以前文和正典为准；冲突时服从正典。
9. **反 AI 腔**：删抽象名词、成对形容词、三连排比、警句；不总结主题，不替读者感动。
10. **章节**：开头有当下压力，结尾留具体的、未解决的问题。
11. **欲望**：每个出场人物都有当下想要的东西；没有欲望的人不许出场。
12. **主题**：主题是可被反驳的命题，让人物用各自的下场投票，不让人物说出来。

另加 5 条操作纪律：叙述距离、物件与动作、标点与呼吸、写完自检、词的选择。

**为什么共享**：这 12 条是跨阶段的「品味基线」。如果每阶段各写一套，模型会在阶段切换时丢掉约束；共享块 + 阶段附录的结构，让每个 system 都完整，同时只追加该阶段真正需要的东西。

---

## 7. 分阶段设计

### 7.1 premise：一句话 → 可生产冲突的承诺

- 输出 `brief` 六字段：`title`、`logline`、`theme`、`promise`、`ending`、`genreTags`。
- logline 必须含：主角 + 处境 + 行动 + 代价，≤60 字，有具体对手或倒计时。
- theme 写成可被反驳的命题，不写「关于爱与救赎」。
- ending 只写落点和代价，不写过程；必须回答主题，并让主角失去不可逆的东西。
- **书名取舍**：契约只有 `title` 一个字段，不能加 `titleCandidates`。因此要求模型在草稿里按「意象／冲突／人称／时间／反讽」各拟一个，共 5 个，比选后只把胜者写进 `title`。
- 项目头里带上规模（`chapters` × `wordsPerChapter` → 万字），让模型知道这不是一个短篇，主线要能撑住 N 次推进。

### 7.2 bible：只写会咬人的设定

- 不是百科：每条设定都要回答「让谁得利、让谁受害、逼人物做什么选择」。
- 只写会反复用到的：3 条硬规则、3–6 个地点、时代日常、禁忌与代价、反复出现的意象与物件。
- 规则必须有边界和代价；地点要有感官锚点和「谁的地盘」。
- 每条规则后写一句「它会逼出什么冲突」。
- 禁止「这是一个充满魔法的大陆」式空话、历史年表、正文里能自己看到的东西。

### 7.3 characters：压力下的预测模型

- 每人八字段：`name`、`role`、`gender`、`want`、`fear`、`secret`、`voice`、`arc`、`relations`。
- `gender` 只能是「男」或「女」，必填：它决定后文用「他」还是「她」。名字不暗示性别时（沈砚、周岩）更要写清。
- 新建时可以用 `protagonistGender`（`auto`/`男`/`女`）把主角性别定死，prompt 里会变成硬约束。
- `want` 与 `fear` 必须互相拉扯；`secret` 要能在中段爆炸；`arc` 由事件逼出来，不是顿悟。
- `voice` 承载两句：第一句说话方式，第二句行为底线（「他会……；绝不会……」）。
- 关系不对称：A 以为是朋友，B 只在利用 A。
- 人数 5–7；示例只列 1 人，正文明确提醒「示例是形状示范」。

### 7.4 spine：卷数固定，只填内容（JSON）

输入：`params`、`brief`、`bible`、`characters`、`volumePlan`。user 里给一张**脚本已定**的卷表，逐行写「第 N 卷｜目标章数 X｜工作标题」，并明写：

> 卷数、卷序、每卷目标章数不是你的决定；必须恰好 N 条，第 i 项只对应【卷表】第 i 卷。

输出：

```json
{"mainline":"…","ending":"…","volumes":[{"title":"…","goal":"…","arc":"…","cast":["…"],"opens":["…"],"closes":["…"]}]}
```

- `volumes` 条数必须等于 `volumePlan.length`，逐卷对应；不许增、删、合并、调序。
- 每卷字段 ≤60 字；卷数 >20 时压到 40 字；`cast` 只写名字，`opens`/`closes` 每条 ≤16 字。
- `mainline` 是 6–10 环因果链（因为……所以……），`ending` 只写落点与代价。
- 明写「40 卷量级时整份 JSON 必须一次写完」——这是 `maxTokens: 6000` 与字段长度上限的共同目的：长 JSON 被截断是这一阶段最主要的失败模式。
- 不输出 `index`/`targetChapters`/`chapters`：序号与章数由脚本加。

### 7.5 volumeChapters：一次只展开一卷（JSON）

输入：`params`、`volume`、`spine`、`bible`、`characters`、`previousDigest`、`existingTitles`。

- 章号从脚本给的 `volume.index` × `volume.targetChapters` 推算：`start = (index-1)*target + 1`，`end = index*target`，user 明写「第 1 条＝第 41 章，最后一条＝第 80 章」。
- 提示语必须包含「本卷共 N 章，请一次给全 N 章」「chapters 必须恰好 N 条」；`targetChapters >= 40` 时自动收紧字段上限（goal/conflict ≤24、turn ≤30、hook ≤24），因为 75 章 × 9 字段的 JSON 很容易在末尾被截断。
- 输出：`{"chapters":[{"title","goal","conflict","turn","hook","pov","when","where","cast":[]}]}`。
- 逐章纪律：`turn` 必须改变力量／信息／关系／时间压力；`hook` 必须具体（动作／话／物件）；不要写正文、不要复述前面章节、钩子必须留悬念（本章不许把自己的问题解决掉）；删掉所有「过渡章」「铺垫章」。
- 不输出 `id`/`index`/`volume`：章号由脚本发，模型给的 id 一律丢弃。
- `existingTitles` 用来防重名：「不要重名，也不要只换一个字」。

### 7.6 beats：5–9 个可拍的场景

- 输出：`{"scenes":[{"goal","obstacle","turn","detail","cast":[]}],"hook":"…","beats":["…"]}`。
- 每场五项：goal／obstacle／turn／detail／cast；`detail` 是写正文时必须落地的一个具体动作、道具或感官锚点（不是「气氛描写」）。
- `beats` 是给后文检索用的一句话节拍：5–8 条，按发生顺序，每条以动词开头。
- `hook` 是本章最后落在的那个悬念，必须能被下一章直接接手。
- 场景之间因果相连：上一场的出口是下一场的入口。
- 场数按信息量与情绪重量分配，不重平均切；示例只列 1 场，正文明确「必须 5–9 项」。

### 7.7 draft：作者，不是助手（packet 即全部材料）

- **`user` 严格等于 `ctx.packet.text`**，提示词层不再拼任何材料。`packet.text` 缺失（异常路径）时退化成 `fallbackPacket()`：只给章号、标题、目标、视角、字数、输出格式的最小写作要求，宁可裸写也不炸。
- system 放三样东西：
  1. 正文规格：字数 = `params.wordsPerChapter`（可接受 0.9–1.15 倍）、视角 = `params.pov`、第一行 `## 第N章 标题`、段落空行、不要前言/总结/列表/作者按、结尾停在钩子指向的具体动作。
  2. 连续性纪律：只用【材料包】里给出的人物、设定、前情与正典；包里没有的设定不许自造；新细节只能是场景级的小物件、小动作，不许新增有名有姓的人物、规则，或改动已发生的事实。
  3. 内联输出协议（见下），加 17 条反 AI 腔清单（见 §8）。
- `maxTokens: min(16000, round(words×2.2))`，temperature 0.9。

内联协议（正文之后，一次写完，省掉每章 1–2 次额外小调用）：

```text
<<<SUMMARY>>
（200–400 字：发生了什么、谁变了、留下什么钩子，供下一章使用）
<<<CANON>>
[{"s":"人物/地点","p":"状态|位置|持有|关系|身份","o":"值","tags":["character:某人"]}]
```

摘要按「发生／知情／钩子／时空」四行写，保留专有名词，不用「他／她」代替；正典块只记本章新出现或改变、下一章会用到的事实，≤8 条，没有变化写 `[]`；两块之外不写任何东西。两块都可整块省略——引擎会自己补（退回独立的 `summary` / `canonPatch` 调用）。

### 7.8 summary：给下一章自己的交接单

- 输入改成 `chapter`、`draft`、`beats`（不再读上一章摘要：v2 的前情在 packet/canon 里）。
- ≤300–400 字，四行四标签：`发生：`、`知情：`、`钩子：`、`时空：`。
- 发生按因果写，不按时间流水；只写正文确实发生的事。
- 知情写「谁从谁那里知道了什么，谁还被蒙着」。
- 钩子写成下一章能直接接手的动作或信息，不写「留下了悬念」。
- 保留专有名词；不评价、不推测、不剧透、不补正文没有的设定。
- 正文用 `fitEnds` 读入（8500 上限），保住结尾的钩子。

### 7.9 canonPatch：登记员，不是作者（小调用兜底）

- 只在 `draft` 的内联正典块缺失／不合法时调用；也可以被 agent 单独调用来补账。
- 输入：`chapter`、`summary`、`beats`、`canonText`。
- 输出 patch JSON：

```json
{"facts":[{"s":"沈砚","p":"状态","o":"左手受伤","tags":["character:沈砚"]}],
 "notes":[{"text":"换班在凌晨三点","tags":["place:殡仪馆"]}],
 "threads":[{"text":"袖口的香灰","status":"open","closedIn":null}],
 "entities":{"沈砚":{"state":"左手受伤","location":"值班室","knows":["三号柜有手机"]}},
 "timeline":[{"when":"头七夜","event":"第一次开柜"}]}
```

- 硬规则：只记本章新出现或改变的、下一章会用到的事实；前文已登记且本章没变的，一条都不要写；**≤8 条**；没变化就返回 `{}`（不要输出空数组套壳）。
- `p` 只能是 `状态｜位置｜持有｜关系｜身份`；`tags` 至少一个，写 `character:某人` / `place:某地`；以正文实际写到的为准，不推测、不补设定。
- `maxTokens: 1200`、temperature 0.2、user ≤1600：这是全表最紧的预算，所以它的输出格式示例是压缩版单行 JSON，不走 `jsonContract` 的长模板。

### 7.10 review：责任编辑，不是夸奖者

- 输出严格 JSON：`{"findings":[{"severity","kind","where","issue","fix"}],"verdict"}`。
- user 里增加【正典】（`ctx.canonText`，2200 上限），并把「正典是既成事实，正文与它冲突就是硬错」写进附录：v2 的连续性以 canon 为准，不再有单独的 ledger。
- 七项对账：事实／时间线／知情／视角／AI 腔／节奏／对话。
- 每条 finding 必须有 `where`（第几段或引用原句，≤30 字）和 `fix`（怎么改：替换动作、删哪句、补哪个感官细节）。
- `severity`：`block`＝读者会出戏／前后矛盾／关键信息错；`warn`＝明显削弱体验；`note`＝可改可不改。
- `verdict`：有 `block` 或 `warn ≥ 3` → `revise`，否则 `pass`。
- 明确「不要输出 ledgerPatch」：正典由本章自己的 canon patch 维护，review 只读不写。

### 7.11 revise：外科医生，不是重写者

- user 三段，按剩余预算分配：`ctx.packet.text`（材料包，用于核对事实与正典，5200 上限）→【需修正】findings 摘要（2400 上限）→【原文】（`fitEnds`，9000 上限）。超预算时先让原文额度，再让材料包；正文缺失时输出「正文缺失，无法修订」而不是编。
- 只动 findings 指出的地方；没被点名的段落尽量原样保留。
- 禁止：重写全章、改主线／结局、增删场景、改人物关系、改叙事视角、换文风。
- 允许：替换句子、补一个感官细节、删一句解释、按 finding 调换段落、补一句过渡。
- 每条 finding 都要落地；无法执行的跳过，不把修改说明写进正文。
- 字数与原文相差不超过 10%；仍以 `## 第N章 标题` 开头，段落空行；输出完整正文。
- 修订后只补内联摘要（`<<<SUMMARY>>>` + 四行），不再重写正典块——那由 `canonPatch` 负责。

### 7.12 blurb：封面文案

- 书名定稿：从 premise 的 `title` 继承；需要时可以给一个更准的，但只输出一个。
- 一句话卖点：谁 + 想要什么 + 被什么挡住 + 最大的代价，不剧透结局。
- 300 字简介：只写第一幕的压力和选择，停在抉择前；不写结局、不写反转、不写「最终他明白了……」。
- 标签 4–6 个：类型 + 核心设定 + 情绪，不堆热词。
- 不写「本书讲述了」式说明文；用封面文案的语感。

---

## 8. 反 AI 腔清单（17 条）

这张表同时存在于 `draft` 的 system 和本文档，改一处必须同步另一处。

| # | AI 写法 | 改成什么 | 示例 |
|---:|---|---|---|
| 1 | 仿佛／似乎／宛如／像是 | 具体观察或身体反应 | 仿佛有人看他 → 后颈汗毛立起来 |
| 2 | 突然／忽然／猛地 | 删掉副词让动作自己发生 | 突然回头 → 他回头，椅子腿在地板上刮了一下 |
| 3 | 不禁／不由得 | 删掉，直接写动作 | 不由得后退一步 → 后退一步，鞋跟撞上门槛 |
| 4 | 缓缓／微微／轻轻 | 给速度、幅度或声音 | 缓缓抬头 → 抬头，脖颈响了一声 |
| 5 | 一丝／一抹／几分 | 换成看得见的东西 | 一丝笑意 → 嘴角动了一下，很快压回去 |
| 6 | 眼中闪过／嘴角勾起 | 一个动作或一句台词 | 眼中闪过慌乱 → 茶杯放回桌上，放得太重 |
| 7 | 空气仿佛凝固 | 在场者的具体反应 | 没人接话，挂钟走了三格 |
| 8 | 心中五味杂陈 | 一个自相矛盾的动作 | 想笑，喉咙里出来的却是一声咳嗽 |
| 9 | 莫名的／难以言喻的 | 来源不明但具体的细节 | 莫名不安 → 他把钥匙数了三遍 |
| 10 | 他知道／她明白 + 解释 | 把认知变成决定或动作 | 他知道不能再等 → 他按灭烟，拿起外套 |
| 11 | 不是 A，而是 B | 直接写 B | 不是愤怒，是恐惧 → 他的手抖得扣不上扣子 |
| 12 | 三连排比／抽象名词堆叠 | 只留最具体的一项 | 孤独、绝望、无助 → 他把电视开着，声音调到最小 |
| 13 | 与此同时／在城市的另一端 | 删掉全知切换，回到视角人物眼前 | — |
| 14 | 他感到／她意识到 + 抽象名词 | 写感官证据 | 她感到危险 → 声控灯一层层亮上来，没人说话 |
| 15 | 形容词堆叠 | 让一个动词承担 | 冰冷而锋利的目光 → 他看她那一眼，像在估价 |
| 16 | 章末总结／抒情 | 落回具体动作或物件 | 这一夜注定无眠 → 天快亮时，烟灰缸满了 |
| 17 | 对话讲设定 | 让规矩在冲突里显形 | 「你也知道规矩……」 → 他把刀放上桌：要么破例，要么收尸 |

**执行原则**：不是「少用」，是「命中就换」。清单里的词不是风格偏好，是模型腔的指纹；保留一个，读者就会从故事里掉出来一次。

---

## 9. 好段落 vs AI 段落

### 好段落（约 120 字）

> 老周把登记簿翻到最后一页，指腹在墨迹上停住。那三个字是他的笔迹，横折却比他平时多拐了一下。他合上本子，又打开，纸角蹭过指缝，发出很轻的一声。灯没开，他把手电夹在腋下，光柱扫过一排冷藏柜，编号从 03 跳到 05，中间空着一个。走廊尽头的冰柜嗡了一下，像有人在里面翻了个身。

### AI 段落（约 120 字）

> 夜色深沉，空气仿佛凝固了。老周缓缓翻开登记簿，眼中闪过一丝难以言喻的恐惧。他不禁后退一步，心中五味杂陈。与此同时，走廊尽头传来一阵莫名的声响，仿佛在预示着什么。他深吸一口气，努力让自己平静下来，却发现自己根本做不到。他知道，这一切似乎才刚刚开始。他不敢回头，也不敢出声。

### 差在哪

| 维度 | 好段落 | AI 段落 |
|---|---|---|
| 情绪 | 不命名，用「指腹停住」「又打开」承载迟疑 | 直接报「恐惧」「五味杂陈」 |
| 感官 | 纸角蹭指缝、冰柜嗡一声，来源明确 | 「夜色深沉」「空气凝固」是套话，没有来源 |
| 信息 | 笔迹是他的、横折多拐一下——具体异常，读者自己起疑 | 「预示着什么」空泛，没有可验证的信息 |
| 因果 | 他合上又打开，是因为不敢确认；冰柜声是环境，也是压力 | 后退、响动、开始，彼此没有因果 |
| 结尾 | 一个动作 + 一个声音，钩子具体 | 「似乎才刚刚开始」是预告，不是钩子 |
| 词 | 动词承担画面 | 副词、形容词、比喻堆叠 |

---

## 10. 可调参数

### 10.1 代码内常量

| 常量 | 位置 | 作用 | 调整建议 |
|---|---|---|---|
| `BUDGET` | `zh.js` 顶部 | 每阶段各段字符上限 | 模型上下文变小，先降 review/summary 的 draft 段；不要降 `canonPatch` 的固定块，也不要降输出格式示例 |
| `TEMPERATURE` | `zh.js` 顶部 | 各阶段采样温度 | 结构类 0.6–0.75；正文 0.85–0.95；审校/登记 0.1–0.2；改稿 0.4–0.6 |
| `GENRE_PROMISE` | `zh.js` 顶部 | 9 种类型的承诺 | 新增类型时同步 `params` 的 genre 枚举，否则参数校验会先拒绝 |
| `CRAFT` | `zh.js` 顶部 | 共享工艺宪法（约 1000 字） | 只加「可操作」的约束；每加一条检查所有 system 是否仍 ≤2500 |
| `ADDENDA` | `zh.js` 顶部 | 各阶段附录 | 阶段纪律变化时先改 architecture-v2 §3/§12，再改这里；输出格式只放 user |

### 10.2 用户参数

| 参数 | 影响 | 注意 |
|---|---|---|
| `premise` | 整个故事的种子 | 8–2000 字；太短会让 premise 阶段空转，太长会挤占风格样本 |
| `genre` | 类型承诺、bible 方向 | 只接受枚举值；「通用」会退化为通用承诺 |
| `audience` | 尺度、解释密度 | 青少年会减少血腥/性，但不等于降低复杂度 |
| `chapters` | 卷数、章数、spine/volumeChapters 的条数 | 6–3000；`chapters/chaptersPerVolume > 40` 时脚本抬 `chaptersPerVolume` 保证卷数 ≤40（`VOLUME_LIMIT`） |
| `chaptersPerVolume` | 每卷章数、volumeChapters 的输出规模 | 10–60；被 `effectivePerVolume` clamp，最后一卷拿余数 |
| `wordsPerChapter` | draft/revise 的 maxTokens 与字数门槛 | 800–8000；maxTokens 按 ×2.2 估算，中文按字符计，封顶 16000 |
| `pov` | 视角纪律 | 写进 draft system 与章节卡；「第三人称限知」禁止进入其他人物内心 |
| `tone` | 文风关键词 | 会先占用 style 预算 |
| `styleGuide` | 风格样本／规矩 | 只取语感，不照抄内容；超长会截断 |
| `contextBudget` | packet 的总字符预算 | 4000–30000，默认 12000；draft 的实际上下文由它决定，不由 BUDGET 决定 |
| `autoReview` / `reviewGate` | 是否自动审校／是否卡门槛 | 由引擎消费，提示词只负责产出 review JSON |

---

## 11. 已知风险与缓解

| 风险 | 触发条件 | 提示词层缓解 | 残余风险 |
|---|---|---|---|
| 长 JSON 被截断 | 40 卷 spine、75 章 volumeChapters | 字段长度上限（≤60 字/≤16 字）+「必须一次写完」+ maxTokens 6000 + 章数 ≥40 时自动收紧字段 | 仍可能尾字段缺失；引擎需要解析失败重试 |
| 模型擅自改卷数/卷序 | 模型觉得「这样分卷更好」 | 卷表由脚本注入，user 明写「卷数、卷序、每卷目标章数不是你的决定」「第 i 项只对应第 i 卷」 | 仍可能少写卷；需要按 `volumes.length === plan.length` 校验 |
| 模型照抄示例数量 | 示例只列 1 人／1 卷／1 场／1 章 | 示例后写「这是形状示范」，并给硬数量（cast 5–7、volumes 恰好 N、chapters 恰好 N、scenes 5–9） | 仍可能只写 1 项；校验器要查数量 |
| draft 绕开 packet | 提示词层想「顺便补点材料」 | draft 的 user 只有 `packet.text`，缺了退化成最小写作包；材料进 system 视为回归 | 若别的道改了 packet 的 renderBrief，prompt 无法兜底 |
| 内联块缺失/格式坏 | 模型写到字数上限就停 | 协议写「两块都可整块省略，引擎会自己补」；调用方退回 `summary`/`canonPatch` 独立调用 | 退回即多 1–2 次调用，长篇成本上升 |
| canon patch 膨胀 | 每章都登记一堆没变的事实 | 「只记新出现或改变」「≤8 条」「没变化返回 `{}`」+ 现有正典用于去重 | 模型仍可能重复登记；`mergeCanon` 的去重键兜底 |
| 长上下文遗忘 | 只给摘要和 canon，不给全文 | packet 的 previous/recent/digest/canon 分片；摘要四段式；canon 是结构化事实 | 语气、伏笔、非事实性细节会漂移；长篇越往后越明显 |
| 摘要误差累积 | 每章摘要 200–400 字，误差逐章传 | 摘要只写「发生/知情/钩子/时空」；canon patch 即时落事实；确定性门槛查字数与 POV | 语义误差无法完全消除；关键事实要在 canon 里二次落账 |
| 审校过严 | 模型把风格选择当错误 | `severity` 三级；`note` 不触发 revise；`verdict` 只在 block 或 warn≥3 时 revise | 仍可能把「不喜欢」写成 warn；需要人工抽检 |
| 审校过松 | 长章、问题隐蔽 | 七项对账清单；要求 `where` 指到段落/原句；`fix` 必须可执行 | 模型可能编造位置；引擎需校验 `where` 是否存在 |
| 第一人称 POV 误判 | 第一人称的「我」知道自己的全部想法 | 宪法按「视角人物能感知/能知道」定义，不按人称一刀切 | 审校模型可能把正常内心独白标成越界 |
| 风格样本被截断 | styleGuide 接近 4000 字 | style 预算 600–1500，先扣 tone；`fit` 截尾并标记 | 截断可能停在句子中间；关键段落应放前面 |
| 字数/Token 换算偏差 | 中文 1 字≈1–1.5 token | maxTokens 按字数×2.2，留余量；draft 上限 16000 | 模型仍可能提前停或写到一半被截；引擎需查字数比 |
| revise 整体重写 | 模型图省事 | 明确「只动 findings」「禁止重写全章/改主线/换文风」「字数差≤10%」 | 仍可能大改；需要 diff 或字数/结构校验 |
| 章节 ID 不一致 | 卷纲里的章号与 item id 不同 | 所有读取用 `str(ch.id)`；缺失时回退 `ch01`；章号只作展示 | 回退可能读错章；引擎应保证 item.id 与 outline 一致 |
| 类型漂移 | 长篇中途写成四不像 | premise/bible/blurb 注入 `GENRE_PROMISE`；review 不专门查类型 | 类型承诺是软约束；需要人工或额外审校项 |
| outline 调用方未同步 | 任何代码还在取 `prompts.outline` | 当前 `index.js` 的 `outline` stage 已改成纯脚本（`plan.buildOutlineSkeleton` + `ensureVolume`），`chapter.js` 优先用 `volumeChapters`；拿不到 builder 时会走内置兜底，但那是旧路径 | 别把 `volumeChapters` 再改回 `outline`；`host/tools.js` 的 stage 名 `outline` 与 builder 无关 |

---

## 12. 自检记录

### 12.1 加载与导出

```bash
node -e "import('./src/recipes/novel/prompts/zh.js').then(m=>{const p=m.createPrompts();console.log(Object.keys(p).sort().join(','))})"
```

输出：

```text
beats,bible,blurb,canonPatch,characters,draft,premise,review,revise,spine,summary,volumeChapters
```

### 12.2 假 ctx 断言（`/tmp/zh_prompt_assert.mjs`，不进仓库）

覆盖：

- 12 个 builder 全部返回 `{system,user,maxTokens,temperature}` 四键；`system`/`user` 都是非空字符串；`system` ≤2500；`user` ≤ 预算；`maxTokens` 正整数；`temperature` 在 0–2。
- user 里所有 ```json 示例块都能 `JSON.parse`。
- `spine`：user 含「必须恰好 3 条」「第 i 项只对应【卷表】第 i 卷」「40 卷量级」，卷表行数 = 3。
- `volumeChapters`：user 含「本卷共 40 章，请一次给全 40 章」「必须恰好 40 条」，并含「不要写正文」「钩子必须留悬念」。
- `draft`：`user === ctx.packet.text`；system 含两个 marker、字数、视角、禁语（突然/仿佛/宛如/不由得）、连续性纪律、200–400 字说明。
- `canonPatch`：user ≤1600，含「≤8 条」「{}」「状态｜位置｜持有｜关系｜身份」。
- `review`：含正典与「不要输出 ledgerPatch」，输出契约含 `findings`/`verdict`。
- `revise`：含材料包前缀、【需修正】、原文、`<<<SUMMARY>>>`。
- 空 ctx（`has=false`、`text=''`、`json` 抛错、`list=[]`、`fit` 截断）12 个 builder 全部不抛错。
- 压力 ctx（3000 章 / 40 卷 × 75 章、canon 2 万字、draft 6 万字、200 个已有章名）user 仍 ≤ 预算。
- 直接字段 ctx（无 reader，只给 `ctx.brief/bible/characters`）：spine 能读到故事核心、世界设定、人物档案，不再落「缺失」；characters 也能读到人物。

结果：

```text
汇总：240 项通过，0 项失败
全部断言通过
```

### 12.3 实测长度（正常 ctx）

列：system / user / maxTokens / temperature。

```text
premise        1550    992  1400  0.9
bible          1512    700  3000  0.7
characters     1579   5134  3200  0.85
spine          1679   4364  6000  0.7
volumeChapters 1653   3643  6000  0.6
beats          1625   3567  2200  0.75
draft          2458    250  6600  0.9     ← user = packet.text（假 ctx 里很短）
summary        1464   3070   900  0.2
canonPatch     1668   1595  1200  0.2
review         1777   6062  4000  0.1
revise         1524   3225  6600  0.5
blurb          1516   1587  1400  0.85
```

system 全部 ≤2500；draft 最紧（2458），再加内容前先砍 CRAFT 或反 AI 腔清单以外的句子。

### 12.4 JSON 契约校验

对 `premise`/`characters`/`spine`/`volumeChapters`/`beats`/`review` 的 ` ```json ` 块做 `JSON.parse`，字段与 §12 契约一致：

```text
premise        keys= title,logline,theme,promise,ending,genreTags
characters     keys= cast（name,role,gender,want,fear,secret,voice,arc,relations）
spine          keys= mainline,ending,volumes（title,goal,arc,cast,opens,closes）
volumeChapters keys= chapters（title,goal,conflict,turn,hook,pov,when,where,cast）
beats          keys= scenes（goal,obstacle,turn,detail,cast）,hook,beats
review         keys= findings（severity,kind,where,issue,fix）,verdict
```

`canonPatch` 的示例是单行 JSON（不围栏），单独 `JSON.parse` 通过：`facts/notes/threads/entities/timeline`。

---

## 13. 维护约定

1. **先改契约，再改提示词**：architecture-v2 §12 的字段名/格式是硬契约。要加字段，先改文档与引擎校验器，再改 `jsonContract` 和本文档。
2. **12 个函数名不能变**：`chapter.js` 的 `resolvePrompts()` 与 `index.js` 的 `createNovelRecipe()` 按名字取 builder；改名会让 stage 找不到 builder（`chapter.js` 报 `prompts.beats 不可用`，`index.js` 在 `callJson` 处失败）。`outline` 已删除，替代者是 `volumeChapters`（逐卷排章）。
3. **system ≤2500，且只放工艺**：任何一本书的具体材料（书名、人物、正典原文）进 `system` 都算回归。改 `CRAFT` 后必须重跑 §12.2，确认最短 system 仍 ≥1400、最长（draft）≤2500。
4. **draft 的 user 只能是 packet.text**：不要在 `draftPrompt` 里加 `section()`。需要新素材，去 `packet.js` 的 `SLICE_SPEC` 加切片，让预算与 report 一起更新。
5. **两个 marker 三处同步**：`zh.js` 的导出、`draft`/`revise` 的 system、`chapter.js` 的 `splitInline()`。少一处，内联摘要/正典就会静默丢失。
6. **反 AI 腔清单两处同步**：`zh.js` 的 `ADDENDA.draft`（17 条）和本文档 §8。只改一处会导致「文档说的」和「模型看到的」不一致。
7. **示例只给形状，不给数量**：任何最小示例后面都要跟一句数量硬约束（含 `spine`/`volumeChapters` 的「恰好 N 条」），防止模型照抄 1 项。
8. **数量由脚本给，内容由模型填**：卷数、卷序、每卷章数、章号、章 id 都不许让模型决定。新增阶段时先问「这个阶段会不会让模型碰结构」，会就先改架构。
9. **不要在提示词里做确定性检查**：字数、段落长度、对话比、AI 腔计数属于 `src/forge/**` 与 `consistency.js`；提示词只负责「写得好」，不负责「判得准」。
