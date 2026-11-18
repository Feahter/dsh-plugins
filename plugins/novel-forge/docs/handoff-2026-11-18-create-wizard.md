# 交接单：墨炉「新建长篇」流程修复（2026-11-18）

> 上一轮做的事：对 `novel-forge` 的「新建长篇」流程做了一轮犀利点评，产出 8 个主要问题 + 3 个次要问题。
> 本轮要做的事：把这些点评逐条修掉，重建面板 bundle，验证，提交。
> **本单不重复推演结论，只给「改哪里、怎么改、怎么验」**——所有行号均于 2026-11-18 复核过。

---

## 0. 先看这三条（会直接害你走错路的旧信息）

1. **没有任何修复落地。** 截至 2026-11-18，仓库 `~/Documents/deepseek-harness/dsh-plugins` 工作区干净，HEAD = `e8562a4`（verify.test 那条）。`client-src` 里搜不到 `window:`，`CreateWizard.jsx:15` 仍是 `chapters: 24`。**不要假设有半成品，从零改。**

2. **已安装插件是符号链接，不需要「同步」这一步。**
   `/Users/fuzhuo/.dsh/profiles/desktop/node_modules/dsh-novel-forge` → `../../../../Documents/deepseek-harness/dsh-plugins/plugins/novel-forge`。
   旧交接单里写的「rebuild 后同步到已安装插件」是多余的；构建产物直接落在被链接的源目录，刷新面板即生效。

3. **构建命令是 `node build.mjs`（不是 `npm run build`），且它会同时重写 `client.js` 与 `client.panel.js`，两个文件都被 git 跟踪。**
   旧交接单「不要跑 npm run build，会覆盖另一条工作流的 client.js 改动」这条警告在**当前**状态下已不成立——那条工作流的改动已经提交进 HEAD，工作区是干净的，`client-src/` 是唯一真源，重建只会让产物回到与源码一致。
   但仍要守住这条规矩：**构建后立刻 `git diff --stat` 确认只有预期的两个产物变化**；如果 `client.js` 出现源码里没有的差异，说明有人手改过产物，停下来问。

---

## 1. 待修清单（按优先级）

改动集中在 4 个文件：
- `client-src/components/CreateWizard.jsx`（主战场）
- `client-src/components/Shelf.jsx`
- `client-src/components/Workbench.jsx`
- `client-src/ideas.js`（只需小改）

**不需要改 `client-src/api.js`**：`api.js:92-93` 的 `startRun(projectId, options = {})` 把整个 options 原样当 body 发出去，调用方多传 `window` 就自动生效。

### P0 · 一次误点烧掉一整本书的钱

#### 1. 面板开炉不传 `window`，一轮就能把整本 1000 章跑完

- 现状：`CreateWizard.jsx:252-255` 传 `{ from: 'premise', autoApprove }`，`Shelf.jsx:48-51` 传 `{ from, autoApprove }`，`Workbench.jsx:468` 的 `begin()` 透传 options —— 三处都没有 `window`。
- 引擎侧：`src/forge/engine.js:463` `window: Number.isInteger(options.window) && options.window > 0 ? options.window : null`，非正整数一律归一成 `null` = **不限章数**。
- 对比：agent 工具 `novel_run` 的 `window` 默认 10（`src/host/tools.js:1079`、`:1097` 的 `args.window ?? 10`）。所以同一个引擎，面板一路裸奔、工具一路有闸。
- 修：三处都传 `window: 10`（或做成可见的「本轮最多 N 章」控件，默认 10，上限 200）。按钮/提示文案同步说明「本轮最多 10 章，跑完再点开炉」。
- 验收：`grep -rn "window:" client-src/` 命中 3 处；面板里开一本 100 章的书，run 结束后 `chapters` 产物只有 ≤10 章有正文。

#### 2. `startRun` 失败会留下「影子项目」，再点一次开炉就多一本

- 现状：`CreateWizard.jsx:226-262` 先 `createProject` 再 `startRun`；`startRun` 抛错时走 `catch`（`:258-262`）只 `setError` + `notify`，**既没导航也没关闭向导**。项目已经建好了。用户以为失败，再点一次「开炉」→ 又建一本同名书。
- 修：`catch` 里区分两段——`createProject` 失败才拦人；`startRun` 失败则 `notify` 后照常调 `onCreated(project.id)`（把用户带进书里，run 错误显示在工作台），或者二次点击时走「继续开炉」分支复用已有 `project.id`。
- 验收：断网/故意让 run 接口 500，点开炉 → 书架上只有 1 本新书，且能进去看到 run 的错误信息。

### P1 · 两个入口行为不一致、预估说谎、文案画饼

#### 3. 面板与 `novel_create` 工具的字段不对称

- 面板能填但工具没有：`audience`、`protagonistGender`（`CreateWizard.jsx:236`、`:242` 会写进 params）。
- 工具能填但面板没有：`platform`、`contextBudget`（`src/host/tools.js:407-445` 的 schema 里有，`CreateWizard.jsx` 完全没有这两个 `Field`）。
- 后果：同一本书，从对话开和从面板开，落盘的 params 不一样；`estimate` 又依赖 `contextBudget`（见第 4 条），从面板看预估等于用了服务端默认值而用户不知情。
- 修：两边补齐同一组字段。推荐以 `recipe` 的 `paramsSchema`（`src/recipes/novel/index.js:96-130`）为唯一真源：`novel_create` 加 `audience`/`protagonistGender`/`reviewGate`，面板加 `platform`/`contextBudget`（`contextBudget` 放「高级」折叠区，默认 12000）。
- 验收：两侧 schema 的字段集合 diff 为空；从任一入口开书，`GET /novel-forge/projects/:id` 返回的 `params` 键集合一致。

#### 4. 预估的兜底公式已经和服务端脱钩，最多偏 +60% / −37.5%

**先纠正一个容易误判的点**：面板**已经**接了服务端预估——`CreateWizard.jsx:146-164` 防抖 300ms 调 `api.estimateNew(...)`，`:165-173` 优先采用服务端结果。所以正常联网时预览是准的，别把它当成「本地公式一路算到底」。

真问题在**兜底那条路**，以及围着它的两处假话：

- 兜底公式：`CreateWizard.jsx:63-83` 用**硬编码常量** `5483 + 6324 + 6331 + 4581 ...`，完全不认识 `contextBudget`；服务端慢或失败时（`:158` 的 `.catch(() => {})` 把错误吞掉，界面无提示）预览静默退化成这个公式。
- 服务端：`src/recipes/novel/index.js:2003-2046` 早改成按 `contextBudget` 算：`budget + budget*0.5 + 正文…`，另外每卷还有 `1500 in / 900 out`。
- 另外 `estimateNew` 的入参（`:150-156`）没带 `contextBudget`，表单里也没有这个字段（见第 3 条），所以面板永远按服务端默认 12000 估——用户不知道自己少了一个能让结果差 60% 的旋钮。
- 实测（24 章 × 3000 字，`contextBudget` 默认 12000）：

  | 场景 | 服务端 | 客户端 | 偏差 |
  |---|---|---|---|
  | contextBudget=4000 | 375,213 | 600,498 | **+60.0%** |
  | contextBudget=12000（默认） | 555,213 | 600,498 | +8.2% |
  | contextBudget=30000 | 960,213 | 600,498 | **−37.5%** |
  | 关审校（12000） | 314,268 | 278,373 | −11.4% |

  章数不改变偏差量级（100 章 +8.5%，600 章 +8.6%），因为错在**每章成本**，不是固定段。
- 两处假话：`CreateWizard.jsx:72-73` 的注释写「与 recipe.estimate 同步」，`:499` 的界面文案写「公式与 recipe 一致」——都不成立，改代码时顺手改掉。
- 修（二选一，推荐 A）：
  - **A**：删掉本地公式，只保留服务端预估；请求中显示「估算中…」，失败时给「量级」而不是精确数字（别再让用户看到一个不联网时算错的数）。
  - **B**：保留兜底，但照抄服务端 `estimate()` 的算式（含 `contextBudget`、含每卷 1500/900），并在 `dev/` 加一条对拍：同入参两侧 `tokens` 差 < 1%。
- 验收：24 章 / 3000 字 / budget 4000·12000·30000 三档，兜底值与服务端偏差均 < 1%（或兜底已被移除）；两处文案与实现一致。

#### 5. 「其余的，墨炉在写的过程中替你问清楚」是空头承诺

- 现状：`CreateWizard.jsx:282`。引擎没有任何「向用户追问」的交互环节；`stage.review` 是闸门（停下来等人点继续），不是问答。
- 修：改成实话——例如「其余参数先用默认值，开炉后随时可以在工作台里改」。若确实想保留「边写边问」，那是新功能，不在本轮范围（见第 7 节非目标）。
- 验收：全仓 `grep -rn "替你问清楚"` 为空。

#### 6. `reviewGate` 默认关闭且埋在表尾

- 现状：`CreateWizard.jsx:26` `reviewGate: false`，表单里排在最后一屏；recipe 侧默认也是 `false`（`src/recipes/novel/index.js:75`）。对长篇来说，审稿门关掉 = 一路跑到底，质量和成本都不可控。
- 修：面板默认改 `true`，并把开关上移到「章数」附近（开炉前必须看见）；recipe 的 `paramsDefaults.reviewGate` 同步改 `true`，避免「面板关着但工具默认开」的反向不一致。
- 验收：全新打开向导，开关默认在「开」；不改任何东西直接开炉，run 在 review 阶段停下等确认。

#### 7. `autoReview` 是个「幽灵表单字段」

- 现状：`CreateWizard.jsx` 里 `form.autoReview` 被读了 4 处（`:141` 传参、`:142` 依赖、`:155` 传参、`:164` 依赖），但——`DEFAULT`（`:8-27`）**没有 `autoReview` 这个键**，全文件也**没有任何 UI 控件或 `set('autoReview', ...)` 去写它**。所以它永远是 `undefined`，`form.autoReview !== false` 恒为 `true`。
- 同时 `:248` 在建项目时写死 `autoReview: true`。两处各自「永远为真」，但谁也没说清这是设计还是遗留；`estimateFor`（`:63`、`:68`、`:77-78`）还留着 `autoReview ? 3.5 : 2.5` 的两种算法，走不到的那一半是死代码。
- 修：认定「本产品永远开自动审校」——删掉 `form.autoReview` 的 4 处引用（直接写字面量 `true`），`estimateFor` 去掉这个参数与三处三元分支；`:248` 的 `autoReview: true` 保留（它是唯一诚实的那处）。将来真要开关，再一次性把 UI、预估、create 三条路径一起接上。
- 验收：`grep -c "form.autoReview" client-src/components/CreateWizard.jsx` 为 0；`estimateFor` 只剩一条算式。

### P2 · 零碎但扎眼的坑

#### 8. 「随机来一个」把用户填好的参数全冲掉

- 现状：`CreateWizard.jsx:179` `setForm(previous => ({ ...previous, ...randomIdea() }))`，而 `client-src/ideas.js:104-113` 的 `randomIdea()` 返回 `premise/title/genre/tone/chapters/wordsPerChapter` —— 顺手把用户挑好的章数、字数也改了。
- 修：`randomize()` 只取 `premise` 与 `title`（标题留空也行），其余字段原样保留。
- 验收：先把章数改成 600，点「随机来一个」，章数仍是 600。

#### 9. 标签只认半角逗号

- 现状：`CreateWizard.jsx:234` `form.tags.split(',')`。中文输入法下打出来的是全角 `，`，整串变成一个标签。
- 修：`split(/[,，、]/)` 再去空去重。
- 验收：输入「无限流，克苏鲁、群像」→ 落盘 `tags` 为三个标签。

#### 10. AI 润色静默截断到 2000 字

- 现状：`CreateWizard.jsx:204` `set('premise', text.slice(0, 2000))`，超出部分无声消失，用户不知道被砍了。
- 修：截断时 `notify('润色结果超过 2000 字，已截断')`；或干脆拒绝并要求重跑。
- 验收：构造一段 >2000 字的润色结果，界面出现明确提示。

#### 11. 「故事核至少 8 个字」的门槛与提示不一致

- 现状：`CreateWizard.jsx:219` 判 `premise.length < 8`；字段提示写「8–2000 字」（`:289`），与 recipe schema 的 `minLength: 8` 对得上，这条**本身没问题**，但错误文案「一句话也行，但要能看出人和事」对「一句话」往往不足 8 字才是真痛点。
- 修：阈值降到 6，或把文案改成明确的「至少 8 个字」。**这是产品口味问题，建议改成明确文案，别动阈值**。
- 验收：输入 5 个字，报错文案直接说「还差 3 个字」。

#### 12. 24 章被当成「长篇」默认值

- 现状：`CreateWizard.jsx:15` `chapters: 24`，`CHAPTER_PRESETS = [100, 300, 600, 1000]`（`:30`）——预设里根本没有 24，默认值落在预设之外；服务端默认也是 24（`src/recipes/novel/index.js:67`）。24 章 × 3000 字 ≈ 7.2 万字，是短篇体量，与「新建长篇」的招牌不符。
- 修（**需要用户拍板的产品选择，见第 7 节**）：推荐 `chapters: 100`，presets 改 `[24, 100, 300, 600, 1000]` 并给 24 标注「短篇试水」。
- 另外 `chaptersPerVolume`（`:36` 默认 30）在 24 章时只有 1 卷，纯属噪音——可在 `chapters <= 60` 时隐藏该字段。
- 验收：新建向导默认 100 章；选 24 章时每卷章数字段自动隐藏。

---

## 2. 已排除的怀疑（别再查一遍）

- `api.js` 不用改：`startRun` 的 options 原样透传（`api.js:92-93`）。
- `engine.js` 不用改：`window` 的正整数语义是对的（`engine.js:463`）。
- 引擎的窗口候选逻辑（`src/recipes/novel/index.js:941-976`）已经处理了「已写且不 stale 的章不进候选」和 force/window 变化换 key，不用动。
- `reviewGate` 的 stage 判定（`index.js:1377`、`:1495`、`:1618`、`:1685`）四处一致，都是 `project?.params?.reviewGate === true`，改默认值只需改 `paramsDefaults`，四处自动跟随。

## 3. 改动落地后的验证步骤（照抄即可）

```bash
cd ~/Documents/deepseek-harness/dsh-plugins/plugins/novel-forge

# 1) 语法/构建：只应产出 client.js + client.panel.js
node build.mjs
cd ~/Documents/deepseek-harness/dsh-plugins && git diff --stat

# 2) 单测（基线 520 条全绿）
cd plugins/novel-forge && npm test

# 3) 端到端自检
node dev/verify.mjs

# 4) 针对本轮改动的断言
grep -rn "window:" client-src/ | wc -l                             # 期望 3
grep -rn "替你问清楚" client-src/ ; echo "(上一行应为空)"
grep -c "form.autoReview" client-src/components/CreateWizard.jsx  # 期望 0
grep -n "reviewGate: true" client-src/components/CreateWizard.jsx # 应命中 DEFAULT

# 5) 预估对拍（改法 B 才需要）：同入参两侧 tokens 差 < 1%
```

面板生效：已安装插件是符号链接，重新打开面板（或刷新页面）即加载新 `client.panel.js`；无需重装。

## 4. 提交

走 `commit` skill，Conventional Commits。建议拆成两个提交：
- `fix(novel-forge): 面板开炉加 window 闸门，修影子项目与幽灵字段`
- `fix(novel-forge): 客户端预估改用服务端口径，补齐两入口字段，修文案`

发布（如需上架）走 `plugin-release` skill；注意它会动 `dsh-plugins` main，**不要把没验证的改动推上去**。

## 5. 待用户拍板（本轮唯一的产品选择）

**`chapters` 默认值**：24（现状，短篇体量）还是 100（长篇常见开书体量）？
推荐 100 + 保留 24 作「短篇试水」预设。服务端 `paramsDefaults.chapters` 要不要同步改，取决于这个决定。
在没拿到答复前，第 1–11 条都可以先做（它们不依赖这个值）。

## 6. 硬约束（继承 R1，别踩）

- draft system 提示词只剩 2 个字符余量（2498/2500）。**本轮不要碰 prompts。**
- `finding` 必须恰好 5 个键；`stats` 除 `topBigrams` 外全为数字；`SLICE_SPEC` 是严格快照。
- `npm test` 基线 520/520，任何一步变红先停下查，不要顺手「修好」别的测试。

## 7. 非目标（本轮不做）

- 「写作过程中追问用户」的交互功能（第 5 条只改文案）。
- `updateProject` 改参数时下游产物失效（`src/forge/engine.js:363-373` 是浅合并、不失效任何产物）——这是真实缺陷，但属于独立议题，另开单。
- 拆书 / 存稿 / 语义召回（R2/R3 范围，仍等三项决策）。

---

**关键文件**：`client-src/components/CreateWizard.jsx` · `client-src/components/Shelf.jsx` · `client-src/components/Workbench.jsx` · `client-src/ideas.js` · `src/host/tools.js` · `src/recipes/novel/index.js`
**产出人**：lead agent（deepseek-flash），2026-11-18
