# 墨炉优化设计规划（源自 AI_NovelGenerator 机制研究）

> 2026-11-21。研究对象：`YILING0013/AI_NovelGenerator` @ `3f1ce0f`（2026-11-05）。机制考古全文见 `docs/research-ai-novel-generator.md`（658 行，逐条带行号）。
>
> 本文件只解决一件事：**从对方拿哪些机制、按什么顺序、落到墨炉哪个文件、怎么验收、哪些明确不拿**。
> 它接在 `docs/requirements-2026-11.md` 的 R1–R3 之后，不替换那份的需求编号，而是把尚未排期的部分（存稿、召回、设定闭环、推演、视图）重新按"机制来源"组织成可施工的期。

**引用约定**

- `[ANG] path:行` = AI_NovelGenerator 的代码位置（提交 `3f1ce0f`，行号见研究报告）。
- `墨炉 path:行` = 本仓库位置（HEAD `23adfc3`，v0.6.0 + Unreleased）。
- `[推断]` = 未在代码中直接读到、由结构推断。

---

## 0. 一页结论

### 0.1 对方真正值得学的是什么

**不是"怎么让模型写好"，是"怎么让模型说的每句话都能被核对"。**

三条根基机制：

1. **两段式生成**：先让 agent 用只读工具整理资料（≤8 轮 / ≤24 次工具调用），再由服务端**按声明的读取重读一遍**，正文只吃真实明细（`[ANG] write_chapter_by_ai.json:95-96,614,1104`）。
2. **引文子串校验**：模型说"原文如此"必须逐字命中，否则 422（`[ANG] chapter_check_service.py:105-120`）。机器只证明"这句话存在"，明确不证明"这个判断成立"（`[ANG] review_evidence.py:183` 写死 `semantic_check: "not_performed"`）。
3. **读取依据快照 + 确认前重放**：生成到保存之间任何来源变化 → 409，错误文案统一是"保留草稿，重新生成"（`[ANG] writing_generation.py:206-221`）。

三者共同前提是同一件事：**每一次读取都留下可比较、可重放的依据**。

### 0.2 墨炉已经比对方强的地方（不要动）

| 维度 | 墨炉 | AI_NovelGenerator |
| --- | --- | --- |
| 检索 | 确定性打分召回（`canon.js:490` `queryCanon`）+ 到期线索独立分片 | 字面 `re.escape` 全扫，目录 >10000 条直接 422（`[ANG] writing_context.py:43-48`）；**零向量检索** |
| 上下文成本 | 单章硬预算 12000 字符，分片 cap + 优先级裁切 + 可核报告（`packet.js:35`） | 上下文上限 **200000 字符**，前情只有上一章尾 6000 字（`[ANG] writing_context.py:823,844`） |
| 确定性检查 | 单章 10 类 + craft 23 项读数 + 全书 8 类（`consistency.js:1212` `audit`） | 5 类章后检查，全要模型自报 + 人工确认 |
| 长期记忆 | 分层摘要（上一章/近三章/本卷前情）+ 正典三元组 | **没有记忆层**，`context_memory_repository.py` 是 0 字节空文件 |

结论：墨炉的"判得准、记得住、算得省"已经成立。差的是**"模型读了什么"这件事没有账**，以及**证据会随正文编辑而失效却没人知道**。

### 0.3 分期地图

| 期 | 主题 | 解决的真问题 | 工作量 | 依赖 |
| --- | --- | --- | --- | --- |
| **期一** | 写入可核 | 模型凭空断言、重复提交、用旧材料写新章 | 中（约 4 项，全部纯函数 + 单测） | 无 |
| **期二** | 证据寿命与召回 | 线索证据随改稿失效、设定闲置、语义召回无零依赖解、拆书只有确定性半段 | 中（4 项，含一个新索引模块与拆书模型半段） | 期一 T1.3 的引文规范化工具 |
| **期三** | 存稿与产品层 | 存稿可回溯可迁移、正典可管理、推演只出候选 | 大（4 项，含客户端） | 期一 T1.2 的版本语义 |
| **期四** | backlog | 定向章后检查、二次取证、arc 层 | 不排期 | — |

---

## 1. 研究方法与证据口径

- 对方仓库 `git clone --depth 1` 到本地，`find`/`grep` 定位后按行读静态代码，**未运行、未装依赖、未联网**。理由：它硬依赖 MongoDB 副本集 + 前端构建（`[ANG] compose.mongodb.yaml:5-10`），跑起来对结论没有增量。
- 墨炉侧：读 `docs/architecture-v2.md`（462 行）、`docs/requirements-2026-11.md`（227 行）、`CHANGELOG.md`，并用 `grep` 核对接口签名（见每条"落点"）。
- **本轮已重跑 `npm test`**：641 tests / 641 pass / 0 fail，`duration_ms: 454023`（v0.6.0 + Unreleased，HEAD `23adfc3`）。这台机器进程启动受系统策略服务拖累（`syspolicyd` 高 CPU），整体耗时 7.5 分钟，但结论成立。**未跑**：`node dev/verify.mjs`（需要真宿主面板）与 `node dev/e2e.mjs`（需要假宿主长跑）。

---

## 2. 对照矩阵（15 条机制 → 判断）

判断分三类：**抄**（机制成立且墨炉缺）、**改造**（思路成立，形态要换）、**不抄**（有证据说明不适用）。

| # | 机制 | 对方位置 | 墨炉现状 | 判断 | 去处 |
| --- | --- | --- | --- | --- | --- |
| 1 | 两段式生成（整理 → 落笔） | `write_chapter_by_ai.json:95-96,614,1104` | packet 由脚本确定性拼装，无模型取证轮 | 改造 | 期四 |
| 2 | 引文子串校验（quote/start） | `chapter_check_service.py:105-120` | findings 只有 `where`，无 `quote` | **抄** | T1.3 |
| 3 | 读取依据快照 + 确认前重放 | `writing_generation.py:206-221` | `commitChapter` 无 basis 参数（`chapter.js:1127`） | **抄** | T1.1 |
| 4 | 位置解析事实表（禁"最新值"） | `character_fact_service.py:34-116` | canon facts 带 `chapter`，`queryCanon` 已按 `atChapter` 切 | 改造 | T1.4 |
| 5 | 幂等回执（key+request hash） | `writing_generation.py:179-192` | `writeArtifact` 每次 version+1（`store.js:280-311`） | **抄** | T1.2 |
| 6 | 候选/正式分离 + 候选指纹 | `contracts.py:93-110` | `novel_context`→agent→`novel_commit` 已是候选/正式 | 改造（缺指纹） | T1.1 |
| 7 | 版本链 + 基线快照 | `chapter_service.py:321-331` | `.versions` 每 key 留 3 份（`store.js:17`），**无回滚入口** | 改造 | T3.2 |
| 8 | 失效标记而非级联重写 | `foreshadowing_service.py:107-116` | 线索无 `evidence`/`keywords` 字段（grep 无命中） | **抄** | T2.1 |
| 9 | 伏笔四态机 + 证据坐标 | `foreshadowing_contract.py:11-37` | threads 有 `opened/closedIn/payoff/dueIn`，无证据 | 改造 | T2.1 |
| 10 | 派生索引可重建 | `resources.py:220-261` | 无索引层；`craft.js` 已算二字组 | 改造 | T2.3 |
| 11 | 归档即校验（zip + FORMAT_VERSION） | `book_archive.py:33-49` | 导出 md/epub + `book/` git 快照，无自校验包 | **抄** | T3.1 |
| 12 | 就绪门禁由事实推导 | `initialization_readiness_service.py:26-39` | `novel_next` 已给 actions（`tools.js:470`） | 已具备 | — |
| 13 | 字段级错误协议 | `writing_generation.py:88-98` | `ForgeError` 有 code，无 field_errors | 改造 | 期四 |
| 14 | 流程图即数据（prompt 内联） | `defaults.py:15-32` | 12 个 builder 在 `prompts/zh.js`，硬编码 | **不抄** | §4 |
| 15 | MongoDB + 事务 + 启动器 | `db/transaction.py`、`desktop_launcher/app.py` | 盘上文件 + 纯函数 | **不抄** | §4 |

---

## 3. 期一：写入可核（P0）

**目标**：让"这一章是基于什么材料写出来的"可核对；让重复提交不产生垃圾版本；让审稿的每条断言都能指回正文。

### T1.1 packet 指纹 + commit 依据校验

**来源**：机制 #3、#6。

**现状**：`prepareChapter` 返回 `packet:{text,report}`（`chapter.js:1002`），`commitChapter({read,params,outline,chapterId,text,summary,canonPatch})`（`chapter.js:1127`）**完全不接收材料包信息**。agent 先取材料、再写半小时、再提交——这中间卷纲/正典/上一章可能已被别的 run 改过，没有任何检查。

**设计**

1. `buildPacket` 返回值增 `basis`：
   ```js
   basis: {
     packetHash: sha256(text),                  // 材料包文本的哈希
     sources: { beats: 'v3', canon: 'v41', previous: 'v2', outline: 'v7' },  // 各产物 version
     atChapter: 'ch012'
   }
   ```
   哈希只算 `text`，因为 `text` 已经包含全部渲染后的材料；`sources` 供人排查"哪一片变了"。
2. `commitChapter` 增可选 `basis` 与 `expectedVersion`：
   - `basis.packetHash` 与当前重算的材料包哈希不一致 → `ForgeError('COMMIT_STALE')`，`detail:{changed:[...sources 差异]}`；
   - 默认**不抛**，落一条 finding `stale-basis`（note）+ 返回 `stale:true`；`params.strictBasis === true` 时抛 409。
   理由：agent 长写的现实路径不能一提交就报错；但"你写的是旧材料"必须留痕。strict 留给引擎的批量路径与后续 UI 开关。
3. 接线点：`tools.js` 的 `novel_commit`（`tools.js:634`）从 `novel_context` 的结果带 `basis` 回来（agent 可用，但不强制）；`index.js` 的 draft stage 内部持有 basis，不必经过模型。

**落点**：`packet.js`（`buildPacket` 返回值）、`chapter.js`（`commitChapter` 签名与 finding）、`tools.js:634`、`index.js` draft/commit 路径、`docs/architecture-v2.md` §5.2/§6。

**验收**

- `test/packet-basis.test.mjs`：同输入两次 `buildPacket` 的 `packetHash` 相等；改任意一片 cap 或内容 → 哈希变。
- `test/chapter.test.mjs` 增 4 条：basis 缺失→兼容通过；hash 一致→无 finding；hash 不一致→`stale-basis(note)` + `stale:true`；strict 下→`COMMIT_STALE`。
- 集成：`test/integration.test.mjs` 走 `novel_context` → 手改 `canon.json` → `novel_commit` 断言 finding 出现且正文仍落盘。

**风险**：`packetHash` 依赖渲染确定性。`assemble()` 已是纯函数（`budget.js` 契约），但 `formatCanon` 的裁切是"按字符数"，同输入同输出，成立。

---

### T1.2 commit 幂等回执 + 版本冲突

**来源**：机制 #5、#7。

**现状**：`writeArtifact` 无条件 `version + 1` 并把旧文件归档（`store.js:280-311`）；同一段正文提交两次 → 两份版本，第二份内容相同；两个 agent 同时提交 → 后者静默覆盖前者。

**设计**

1. `commitChapter` 增 `expectedVersion`（`read('draft/<id>')` 的当前 version）。不一致 → 409 `VERSION_CONFLICT`，`detail:{current, expected}`。
2. 同内容去重：写入前算 `sha256(text)`，与当前 draft 正文哈希相同 → 返回 `{ok:true, deduped:true, version: current}`，**不写盘、不归档版本**。
3. 回执（轻量版，不做独立集合）：`artifacts/.receipts/<seq>.jsonl` 追加 `{key, op:'commit', requestHash, version, at}`，只在 `params.keepReceipts` 为真时写。理由：墨炉是单机单用户，回执的价值主要在"重试不重复扣费/重复落盘"，而 #2 的去重已经覆盖 95%。

**落点**：`store.js`（`writeArtifact` 增 `expectedVersion`/`dedupeByHash` 选项）、`chapter.js:1127`、`tools.js` commit 路径、`engine.js` 批量 commit 传 expected。

**验收**

- `test/store.test.mjs` 增 3 条：`expectedVersion` 不符→抛；同哈希→不新增版本目录；不同哈希→版本 +1。
- `test/tools-v2.test.mjs` 增 2 条：连提两次同文→第二次 `deduped:true` 且 `.versions` 数量不变；`expectedVersion` 过期→409 `VERSION_CONFLICT`。
- e2e：`novel_commit` 重复调用后 `novel_status` 的字数不变。

**风险**：引擎的 revise 会改写正文，哈希必然不同——去重只对"逐字节相同"生效，不会误吞修订。

---

### T1.3 LLM 审稿 finding 必须带逐字引文

**来源**：机制 #2，这是本规划**性价比最高的一条**。

**现状**：review stage 产出 `{severity,kind,where,issue,fix}`（`consistency.js` 的 finding 形状，`where` 是章号或「全书」），**没有任何字段指回正文原句**。模型可以说"第 12 段人物动机不连贯"，人无法核对，代码也无法证伪。

**设计**

1. `prompts/zh.js` 的 review builder：findings 每条增必填 `quote`，规则写死在 system：
   - 必须从正文**逐字复制**，8–120 字，不带省略号、不改标点、不拼接；
   - `where: 'chID#第N段'` 由模型给，服务端不信任，只用于展示。
2. 引擎侧新增纯函数 `validateFindingQuotes(text, findings)`（放 `consistency.js` 或新 `review-quote.js`）：
   - 规范化：全角/半角标点不动，仅做 `trim` 与连续空白折叠；**不做同义替换**。
   - 命中 → `quoted:true`，保留原 severity。
   - 未命中 → 保留 finding，标 `quoted:false` + `severity` 降一级（block→warn，warn→note），issue 前缀「（引文未命中正文）」。
   - `quote` 缺失 → 同"未命中"处理。
3. `craft.checkDraft` 的 stats 增 `unquotedFindings`（数字），供体检表看"审稿可信度"。
4. **不改**既有 kind 名与 severity 语义（`docs/requirements-2026-11.md` §5 非目标），只加字段。

**落点**：`prompts/zh.js`（review builder + 长度预算重测）、`consistency.js`（新导出）、`index.js` review stage 合并处、`chapter.js` 的 `checkChapter` 不涉及（确定性检查不需要引文）、`docs/prompts.md` §12 同步。

**验收**

- `test/review-quote.test.mjs` 6 条：逐字命中 / 命中但多空格 / 用了省略号→不命中 / 引文跨段 / 缺字段 / block 无引文→降为 warn。
- `test/prompts.test.mjs` 增：review system 含「逐字」与「8–120 字」两条，且 system ≤2500 字（现有断言模式）。
- 假 LLM 端到端：mock 返回一条带假引文的 finding → `review.json` 里 `quoted:false` 且 severity 降级。

**风险**：模型可能为了过校验而"抄一句无关的话"。这不解决语义正确性——对方也明说机器只证明字符串存在（`[ANG] review_evidence.py:183`）。所以**保留 finding 本身**，只降低其权重，绝不静默丢弃。

---

### T1.4 unknown / blockers 语义注入

**来源**：机制 #4。

**现状**：canon 事实有 `status: canon|open|retracted`（`architecture-v2.md` §4.1），`formatCanon` 输出【硬规则】【不可违背】【事实】【注记】【未回收线索】。**没有"这里我不知道"的表达**。模型遇到空白会用常识补齐，这是长篇跑偏的主要来源之一。

**设计**

1. `canon.js` 新增导出 `unknownsOf(canon, { atChapter, maxChars })`：
   - `entities[*].state` 为空但该角色在 `cast` 里 → 「X 的当前状态未记录」；
   - `threads` 中 `opened` 早于 `atChapter` 且 `payoff` 为空 → 已在 dueThreads 分片，不重复；
   - `status:'open'` 的 facts（未裁决）→ 列出 `s|p`。
   - 只取前 6 条，总长 ≤300 字。
2. 渲染在 packet 的 `canon` 分片**末尾**（不新增分片，避免破现有严格快照测试），标题 `【未知与待复核】`。
3. draft system 增一句（≤60 字）：「未列出的信息视为未知；不要用常识补全，可留白或写人物的不确定。」
   **注意**：draft system 现为 2401/2500（R1 记录），加 60 字后需重测，超了就从「禁语」段挪。

**落点**：`canon.js`、`packet.js` 的 canon 渲染路径、`prompts/zh.js` draft、`test/packet.test.mjs` 快照。

**验收**

- `test/canon-unknowns.test.mjs` 4 条：空 state 的角色入列；`open` fact 入列；无任何未知→返回空串且 packet 不留空标题；`atChapter` 之后的事实不入列。
- `test/packet.test.mjs`：快照更新，断言新分片存在时总长仍 ≤budget。
- `test/prompts.test.mjs`：draft system ≤2500。

---

## 4. 期二：证据寿命与召回（P1）

### T2.1 线索证据坐标 + 改稿失效检测

**来源**：机制 #8、#9。

**现状**：`threads: {id,text,opened,status,closedIn,payoff,dueIn,payoffLevel}`。**没有 evidence**：闭合时只记章号，不记"正文哪句话兑现的"。用户改稿把兑现句删了，系统仍认为已回收。现有 `payoffNameDriftFindings`（`consistency.js:987`）只查兑现章的**新专名**是否入正典，不查兑现句是否还在。

**设计**

1. threads 增可选 `evidence: { chapter, quote(≤200), hash(sha256(quote 归一化)) }`，在 `canonPatch` 闭合时由调用方填（模型给 quote，服务端校验子串；不命中就不写 evidence，只记章号）。
2. `consistency.audit` 增规则 `thread-evidence-stale`（note）：对每条有 `evidence` 的 closed 线索，读 `draft/<chapter>` 正文，找不到 `quote` 子串 → 报「t03 的兑现句已不在正文里（第 42 章）」。
3. 只 note，不改状态；是否重开由人或 LLM 裁决。

**落点**：`canon.js`（thread schema + mergeCanon）、`consistency.js`（audit）、`chapter.js` 的 canonPatch 合并、`docs/architecture-v2.md` §4.1。

**验收**：`test/consistency-thread-evidence.test.mjs` 4 条（证据在→不报；证据被删→报；无 evidence 的旧线索→跳过；同一 quote 出现在两章→不误报）。**兼容**：旧 canon 无 evidence 字段，全量跳过，不改 schemaVersion。

---

### T2.2 设定闲置检查（原 L1）

**来源**：机制 #4 的反向使用——对方用"实体引用白名单"防越界，墨炉用 `entities.lastSeen` 查闲置。**已有的字段就够，不新增数据结构**。

**设计**：`consistency.audit` 增 `setting-orphan`（note）：遍历 `canon.entities`，名字 ≥4 字、`kind in {place,item,org}`、`lastSeen` 距今 ≥20 章且全书已写 ≥25 章 → 报「殡仪馆登记后 31 章未出现：要么用起来，要么删掉」。只 note。

**落点**：`consistency.js` audit（与 `thread-stale` 相邻，`consistency.js:521` 一带）。

**验收**：25 章样本命中；24 章不报；通用词（<4 字）不报；`kind:'character'` 不报（角色消失另有 `cast-missing`）。

---

### T2.3 二字组倒排索引：语义召回的零依赖解（原 A2）

**来源**：机制 #10（派生索引可重建）。**对方自己也没有向量检索**（`requirements.txt` 无 numpy/faiss，grep 全仓无 embedding），说明"字面 + 结构化"能撑到相当规模；但它用全表扫描（`[ANG] resources.py:306-342`），墨炉不能学这个。

**判断**：不引入 embedding 依赖（外部模型、索引成本、离线不可用），改为**用已有的二字组基础设施建可重建倒排索引**。`craft.js` 已经在算 `bigramTtr`/`topBigrams`，抽词逻辑现成。

**设计**

1. 新模块 `src/recipes/novel/lexicon.js`（纯函数）：
   - `bigrams(text)`：连续汉字串取二字组，排除人名与功能词表（复用 `craft.js` 的表）；
   - `buildIndex(chapters)` → `{ version:1, fingerprint, docs:{ ch001:{len, grams:[...top 200]} } }`；
   - `query(index, {keywords, exclude:[章号], limit:12})` → 按 idf 加权的候选章列表。
2. 落盘 `index/bigram.json`，`fingerprint = sha256(所有 draft 的 id+version 排序拼接)`；`novel_audit`/`novel_context` 发现 fingerprint 不符就重建（增量或全量，300 章预算 <2s）。
3. **只作旁证，不进 packet**：`novel_context` 返回 `recall:{chapters:[{id, score, samples:[...]}]}`，供 agent 决定要不要 `novel_read` 那一章。这样不占 12000 预算、不破坏"包大小不随章号增长"的契约。

**落点**：新 `lexicon.js`、`tools.js` 的 `novel_context` 返回值、`store.js` 索引读写（走 `writeArtifact` 但标记 `derived:true`，不参与版本归档）、`test/lexicon.test.mjs`。

**验收**

- 单测：300 章合成文本索引重建 <2000ms；同输入两次 `fingerprint` 相同；删索引后能重建且 query 结果一致。
- 构造样本：第 5 章独有的设定词在第 250 章 `novel_context` 的 `recall` 里命中。
- 回归：`packet.text` 长度与 `report` 不变（索引不参与拼包）。

**风险**：二字组噪声大（"他说""这样"）。用 idf 加权 + 停用表压住；`limit:12` 让候选只作提示。**如果实测命中质量差，就退回"只索引专名与设定词"这一更保守版本**——不引入新依赖，退路成本是零。

---

### T2.4 拆书的模型半段（决策已放开，2026-11-22）

**来源**：机制 #6（候选不落库）+ 用户的拆书需求（`docs/requirements-2026-11.md` §M6）。

**现状**：`deconstruct.js`（333 行）只做确定性半段——章节切分、章长、对话比、场景密度、章末钩子、句长、高频二字组。没有"这本书的故事核是什么、人物怎么立、伏笔怎么埋"的结构卡。

**设计**

1. 新 task 常量 `DECONSTRUCT_TASK = 'deconstruct-structure'`，走 `llm.ask`（按批多次），输出固定 schema：
   ```json
   { "premise": "≤200字", "hooks": [{"type":"","where":"第N章","quote":"≤120字"}],
     "characters": [{"name":"","role":"","arc":"≤80字","evidence":"≤120字"}],
     "threads": [{"text":"≤80字","opened":"第N章","payoff":"第N章或空"}],
     "rhythm": {"opening":"","midpoint":"","climax":"","ending":""} }
   ```
2. **证据强制**：`quote`/`evidence` 必须逐字命中原文（复用 T1.3 的规范化器）；未命中 → **该条丢弃**并计数 `dropped`，不降级保留——拆书是"从原文提取"，没有原文支撑就是编的。
3. **分批**：超出 `contextBudget` 时按卷切，每批独立产出后由确定性代码合并（同名角色合并、threads 去重）；单批失败 → 记 `failedBatches`，不整单失败。
4. **不落业务盘**：结果写 `deconstruct/<bookId>.json`（`derived:true`），不写 canon、不改项目；用户看过再手工"采纳到设定"，避免把别人的正典污染自己的书。

**落点**：`deconstruct.js`（模型半段 + 合并）、`prompts/zh.js`（新 builder）、`host/tools.js` 的 `novel_deconstruct`（增 `mode:'structure'`）、`test/deconstruct-structure.test.mjs`。

**验收**

- schema：缺字段/超长/引文未命中 → 条目丢弃，`dropped` 计数正确。
- 分批：3 批中第 2 批假 LLM 抛错 → 返回其余两批 + `failedBatches:[2]`，不抛。
- 隔离：跑完断言 `canon.json` 与 `outline.json` 字节未变。
- 成本闸门：单批输入 ≤`contextBudget`，总调用 ≤ `ceil(章数/50)+1`，超了拒绝并提示。

**风险**：整本送模型成本不可控 → 批数与单批预算双闸门；版权由用户承担（决策 2 已确认）。

---

## 5. 期三：存稿与产品层（P2）

### T3.1 整书可自校验归档（回答「云端存稿」决策点 1）

**来源**：机制 #11。

**现状**：`novel_export` 有 md/epub；`book/` 有 git 快照（CHANGELOG Unreleased）；`.versions` 每 key 3 份。**没有"整本书一个文件，且能验证没坏"**。原需求 M5 卡在"要不要上云"，这条把它降级成零外部依赖的问题。

**设计**

1. `novel_export format:'archive'` → `《书名》-archive.zip`：
   ```
   manifest.json      {format:'molu-archive', formatVersion:1, novelId, title,
                       createdAt, generator:'novel-forge@0.7.0',
                       files:[{path, sha256, bytes}], counts:{chapters, facts, threads}}
   outline.json / canon.json / params.json
   draft/<chapterId>.md / summary/<chapterId>.md / review/<chapterId>.json
   book/**.md          （已有快照，存在则打）
   ```
2. 新工具 `novel_import_archive {path}`：逐文件 sha256 比对，任一不符 → 拒绝并列出文件；`formatVersion` 不认识 → 拒绝并给出版本区间。**导入前不写任何盘**。
3. 格式演进：`formatVersion` 只增不减，读侧对 v1 保持兼容（manifest 缺字段按默认值）。

**落点**：`export.js`（新 exporter）、`host/tools.js`（导入工具，加进 15 个工具表）、`docs/architecture-v2.md` 工具表、README。

**验收**：导出→删项目目录→导入→逐章与 canon 的 sha256 一致；改 zip 里一个字节→导入报错并指出文件；两个不同版本的程序读同一包，旧版拒绝而非静默丢字段。

---

### T3.2 版本面板 + 回滚

**来源**：机制 #7。

**现状**：`.versions` 已经存了 3 份/ key（`store.js:17`），**但没有任何入口能看到或回到旧版本**——存了等于没存。

**设计**：宿主路由 `GET /novel-forge/versions?key=draft/ch001` 列出 `.versions` 索引；`POST /novel-forge/restore {key, version}` 把旧文件写回（走 `writeArtifact`，因此产生新版本，可再回滚）；客户端章节页右栏加"历史"抽屉。

**落点**：`host/routes.js`、`store.js`（`listVersions`/`restoreVersion`）、`client-src/components/ChapterView.jsx`。

**验收**：路由单测（列表顺序、恢复后内容相等、新版本号 +1、恢复不存在的版本→404）；`node dev/verify.mjs` 面板可点到。

---

### T3.3 圣经视图（原 B2）

**来源**：机制 #14 的反面——对方有 11 个 workspace + 关系图（`[ANG] novel.ts:494-505`），但那是 6.2 万行前端的代价。墨炉只补**一个只读视图**。

**设计**：客户端加 `CanonView`，四 tab：人物 / 地点 / 线索 / 时间线。每项显示 `state/knows/relations/lastSeen` 与「被哪几章提及」（宿主侧用 `lexicon.query` 算，缓存 60s）。**纯只读**，不提供编辑（编辑仍走 canonPatch 与 `novel_commit`，避免出现第二条写入通道）。

**落点**：`client-src/components/CanonView.jsx`、`host/routes.js`（`GET /novel-forge/canon`）、`Workbench.jsx` 入口。

**验收**：手测截图；断言视图请求不产生任何 `writeArtifact` 调用。

---

### T3.4 剧情推演（原 L3）

**来源**：机制 #6 的思路——候选不落库。

**设计**：`assist` 增 task `plot-simulate`：输入 = canon 切片（`queryCanon`，≤3200 字）+ 最近 3 章摘要 + 一句目标；输出 JSON `{paths:[{path, cost, risk, chaptersNeeded}]}`（2–3 条）。system 硬约束：不写正文、不新增专名、不宣称任何结果已发生。**只返回，不落盘**；用户挑一条后自己去改卷纲。

**落点**：`host/assist.js`（第 6 个 task，`ASSIST_TASKS` 表）、`client-src/components/ChapterView.jsx` 或工作台抽屉。

**验收**：假 ctx 断言 schema 与三条硬约束出现在 system；断言 store 无写入；`maxTokens` ≤1200。

---

## 6. 明确不抄（附理由）

| 对方做法 | 为什么不抄 |
| --- | --- |
| MongoDB 副本集 + 多文档事务（`[ANG] compose.mongodb.yaml:5-10`） | 墨炉是单机单用户、文件即数据、纯函数即逻辑。引入 DB = 部署门槛 + 迁移成本换 0 用户收益；对方的副本集是为了"多文档一致性"，墨炉的 canon 是单文件原子写。 |
| 可编辑流程图 + 25 张内置流程 + 63 个 md 提示词 | 对方为此付出 9.2 万行后端 + 6.2 万行前端，回报是"用户能改连线"。墨炉 12 个 builder 已覆盖创作全链；流程可编辑性对单人写作是伪需求，维护成本真实。 |
| 向量/嵌入检索 | 对方也没有（这是它自己的弱点列表第 2 条）；墨炉的确定性打分召回已优于字面全扫。T2.3 用二字组索引取中间态。 |
| 卷→弧→场景→章 四层 | 网文是卷→章；对方的 arc 层是出版/短篇向，且改数据模型要迁移全部 v2 项目（`plan.js` 的 id 发号会动）。墨炉的 `beats.scenes` 已承载场景级信息。 |
| 200000 字符上下文 + 6000 字尾段 | 这是"没有记忆层"的补偿（`context_memory_repository.py` 是空文件）。墨炉的 12000 硬预算 + 分层摘要更省且可核。 |
| 章后 5 类定向检查（心理/物品/关系/规则）拆成独立任务 | 墨炉的 review 一次调用已覆盖；拆成 5 次 = 5 倍成本。等 T1.3 的引文校验跑稳后，再把"物品归属/关系状态"两条做成确定性规则（进期四）。 |
| PySide6 启动器 / 无鉴权 / 零测试 | 反面教材。对方的 9.2 万行 Python 没有一行自动化测试（`find -name 'test_*.py'` = 0）。 |
| 字段级 `field_errors` 错误协议 | AI 工具调用的错误对 agent 是"读一句话再决定"，不是前端高亮。放期四，等有批量导入需求再说。 |

---

## 7. 验收与风险总表

| 项 | 验收方式 | 判定 |
| --- | --- | --- |
| 期一 | `npm test` 全绿 + 新增 4 个测试文件 | 每期结束跑一次全量；新增用例数与本文各 T 的清单一致 |
| 期二 | 索引性能与一致性测试 + 3 类 finding 的正反样本 | 每类 finding 必须有"不误报"用例 |
| 期三 | 归档往返 + 路由单测 + `node dev/verify.mjs` | 面板可点，且不改业务数据（只读断言） |
| 全局 | 不改 30+17 类检查的 kind 名与 severity 语义；不改引擎语义（除 T1.2 的 store 选项） | `grep` 断言 + code review |

**主要风险**

1. **T1.3 会降低审稿召回**：模型为了避免"引文未命中"可能少报。对冲：降级不丢弃 + `unquotedFindings` 读数长期观察。若 note 量骤降 >50%，回滚 system 里"必须逐字"的措辞为"尽量引用原句"。
2. **T1.1 在 agent 长写时频繁 stale**：所以默认 note 不 409。strict 只给引擎批量路径。
3. **T2.3 索引噪声**：已留"只索引专名与设定词"的保守退路。
4. **T3.1 归档格式演进**：manifest 的 `formatVersion` 只增，读侧对旧版宽容、对未知版拒绝——对方的 `EXPORT_FORMAT_VERSION` 从 2 递增到 10 证明了这条路可行（`[ANG] book_archive.py:35-44`）。
5. **基线已确认，端到端未跑**：`npm test` 641/641 通过；`dev/verify.mjs` 与 `dev/e2e.mjs` 本轮未跑，期一开工时补。

---

## 8. 已确认决策（2026-11-22，用户确认）

动工前不再需要讨论以下四项，新 session 直接按此执行：

| # | 决策 | 结论 | 落地影响 |
| --- | --- | --- | --- |
| 1 | 存稿 | **不评估上云**。走 T3.1 整书自校验包 + T3.2 版本回滚面板；用户自己用网盘同步 zip。 | 期三不做账号/同步/云端 API；M5 关闭 |
| 2 | 拆书整本送模型 | **允许**。`deconstruct.js` 在确定性半段之上增"送模型出结构卡"（故事核/人物/伏笔清单），成本与版权由用户承担。 | 拆书增模型阶段；需做分段与 token 预算，避免整本超限 |
| 3 | 语义召回 | **不引入 embedding**。以 T2.3 二字组倒排索引作为 A2 的最终答案。 | 无新依赖；退路为只索引专名与设定词 |
| 4 | 期一 strict | **只记 note**，不默认 409。`params.strictBasis` 保留为显式开关。 | T1.1 默认 `stale-basis(note)` + `stale:true`，引擎批量路径可自行开 strict |

原始选项与建议（留档）：

1. **存稿**：按 T3.1 + T3.2 走（整书自校验包 + 版本回滚面板），**不再评估上云**。——已确认。上云要账号/合规/运维，且用户已有 iCloud/网盘可自己同步一个 zip。
2. **拆书整本送模型**（R2 遗留）：`deconstruct.js` 目前只做确定性半段（切分/章长/对话比/钩子）。**已确认允许**把整本导入文本送模型，换"故事核/人物/伏笔清单"的结构卡。实现时需：按卷/章分批、单批 ≤`contextBudget`、失败降级为确定性半段（不阻断）。
3. **语义召回**：以 T2.3 二字组索引作为 A2 的最终答案（不引入 embedding）。——已确认。
4. **期一 strict**：默认 note。——已确认。

---

## 9. 附录：证据索引

| 论断 | 证据 |
| --- | --- |
| 对方零向量检索 | `[ANG] requirements.txt` 无 numpy/faiss；grep `embedding|vector|faiss` 仅命中能力名清单 |
| 对方无长期记忆 | `context_memory_repository.py` 0 字节；前情只有 6000 字尾段 `writing_context.py:823` |
| 对方明确"机器只证明引文存在" | `review_evidence.py:183` `semantic_check: "not_performed"` |
| 对方零测试 | `find . -name 'test_*.py'` = 0 |
| 墨炉 commit 无依据参数 | `chapter.js:1127` 签名 |
| 墨炉 findings 无引文字段 | `consistency.js` finding 形状（`where` 到「全书」） |
| 墨炉线程无 evidence | `canon.js` threads 字段（`opened/closedIn/payoff/dueIn/payoffLevel`） |
| 墨炉版本存了无入口 | `store.js:17` `versionsKept:3`；`host/routes.js` 无 versions 路由 |
| 墨炉二字组基础设施已有 | `craft.js` 的 `bigramTtr` / `topBigrams`（`architecture-v2.md` §6.1） |

---

## 10. 新 session 开工提示（交接用）

> **2026-11-22 补**：施工前先读 **§11 评审修订**。§3 里有 5 处与真实代码不符（basis 回传链、哈希验收、逐产物去重、prompt 预算、T1.3 的降级语义），期一的落点与顺序以 §11 为准。

**先读**：本文件 §8（决策已定，不要重议）→ §11（最新修订）→ §3 期一 → 需要背景时再读 `docs/research-ai-novel-generator.md` 对应小节。

**第一件事**：`task_resume` 任务 `2026-11-16-novel-forge-capability`，它带着前 10 轮的 claims/decisions 与未决旧账；不要凭本文件重建历史。

**环境**：
- 仓库 `dsh-plugins/plugins/novel-forge`，HEAD `8f51f07`（2026-11-22 复核；T1.3 的改动在工作区未提交），`npm test` 基线 **641/641 通过**（2026-11-22 实测复跑 314s，本机进程 spawn 慢，属正常；含 T1.3 后为 649/649）。
- 单测：`node --test test/*.test.mjs`；跑单个文件更快：`node --test test/packet.test.mjs`。
- 面板验证：`node dev/verify.mjs`（需要真宿主）；端到端：`node dev/e2e.mjs`。

**期一施工顺序**（建议）：T1.3（引文校验，独立、可先落）→ T1.1（packet 指纹）→ T1.2（幂等/版本）→ T1.4（unknown 注入，需重测 prompt 预算）。每个 T 做完先跑自己的新测试文件，再跑全量。

**不要做的事**：不改 30+17 类检查的 kind 名与 severity 语义；不引入新依赖（期二索引必须零依赖）；不把索引或拆书结果写进 packet/canon 的业务盘。

**交接时若发现**：本文件引用的行号因代码演进漂移，以代码为准并顺手更新附录 §9。

---

## 11. 评审修订（2026-11-22，pi 独立评论家对账 + T1.3 落地）

本轮用独立 pi 会话把 §3 期一逐条对账到真实代码（HEAD `8f51f07`，基线 `npm test` 641/641 实测复跑通过）。结论：**期一不能照稿开工** —— T1.1 / T1.2 / T1.4 各有硬伤，T1.3 可施工且已落地。**冲突时以本节为准，§3 原文保留作对照。**

### 11.1 对账结果（设计原文 → 实测 → 修订）

| 设计原文 | 实测 | 修订 |
| --- | --- | --- |
| T1.1 `buildPacket` 返回 `{text,report}` | `packet.js:330` 返回 `{text,report,sections}`；`chapter.js:1103` 只透传前两项；`tools.js:594` 的 context 与 `:637` 的 commit 都不带 basis | 只加返回字段等于没改。施工前先接通回传链：context 展示 basis、commit 收 basis 并用**最新**输入重跑同一拼包函数 |
| T1.1「改任意一片 cap 或内容 → 哈希变」 | 哈希只覆盖最终文本：短 beats 的 cap 加一、长 beats 裁剪区外的改动，文本不变 → 哈希相等 | 验收改成「**可见文本**变了哈希才变」；来源变化单独用来源指纹测 |
| T1.1 重放用 `index.js:1645` 的 canon | 该处会用旧 canon 覆盖读取结果 | 重放必须用最新输入，不能用旧材料验证旧材料 |
| T1.2「正文相同 → 整个提交视为重复」 | `store.js:298` 锁内写入即增版，无 CAS 无去重；`tools.js:672` 一次写正文+摘要+正典+审稿四份 | 去重必须**逐产物**比较最终内容；同正文带新摘要/新补丁不能被跳过 |
| T1.3 验收点 `test/prompts.test.mjs` 的 system ≤2500 | 该文件不存在；断言在 `test/prompts-craft.test.mjs:24`（`SYSTEM_LIMIT`），draft system 实测 2498 | 验收改为 `prompts-craft.test.mjs`；review system 实测 2005，加规则后 2068 |
| T1.3「只改 prompt」 | `index.js:287` 的 zod `findingSchema` 与 `:1262` 的 `normalizeFinding` 都会丢掉 `quote` | schema 增**可选** `quote`（必填会把缺引文的意见整条丢弃）；归一化在 model 模式下保留 `quote`/`quoted` |
| T1.3 `craft.checkDraft` stats 增 `unquotedFindings` | `craft.js:758` 只吃 text/params/beats/previousHook/cast，没有 findings 入参 | 计数改放 `review/<id>` 产物（`unquotedFindings`），不动 checkDraft 签名 |
| T1.3 引文未命中 → 无条件降级 | 会把 `test/novel-recipe.test.mjs:1346`（3 条无引文 warn → revise）变成 pass，等于改引擎语义；也给模型留了「不引原句就逃避修订」的口子 | 降级改 `params.quoteDowngrade` 显式开关，**默认关**；默认只写 `quoted:false` 与计数 |
| T1.4 未知事实段追加进 packet | draft system 实测 2498/2500（加 31 字即超）；`canon.js:698` 分节裁切 + `packet.js:280` 再扣标题，满片时未知段会被裁掉 | 先在 draft system 内做**等长替换**腾预算，并把未知段额度预留在 canon 分片内 |

### 11.2 T1.3 已落地（工作区未提交，等用户决定）

- `consistency.js`：`normalizeQuoteText` / `validateFindingQuotes` / `countUnquotedFindings` —— 8–120 **码点**、空白折叠后逐字子串、不修改入参；降级只在显式 `downgrade:true` 时发生。
- `index.js`：`findingSchema.quote` 可选；`normalizeFinding(raw,{model})` 保留 `quote`/`quoted`；review stage 只校验**模型** findings，确定性 findings 维持五字段；产物增 `unquotedFindings`，note 追加未命中条数；`paramsSchema` 增 `quoteDowngrade`（boolean，默认不降级）。
- `prompts/zh.js`：review system 增「逐字复制 8–120 字，不改标点、不加省略号、不拼接两处」；`jsonContract` 增 `findings[].quote` 与示例。
- 测试：新增 `test/review-quote.test.mjs`（13 条，含假 LLM 端到端与抢救路径）；`test/prompts-craft.test.mjs` 加 3 条断言。
- 回归：`npm test` 649/649 通过（641 基线 + 新增 8）。

### 11.3 下一轮顺序（替代 §10 的「期一施工顺序」）

1. **T1.2**（版本冲突 + 逐产物去重）：先把「同正文改摘要」的语义定死，它决定 T1.1 回执怎么写。
2. **T1.1**（basis 回传 + 哈希验收改写）：先接通 context/commit 两侧，再谈重放。
3. **T1.4**（预算重构）：先等长替换腾出 draft system，再谈未知段。

期二 / 期三不变。**不要**把 §3 里 T1.3 的「无条件降级」再照抄一遍 —— 当前实现是显式开关。
