# 验证事故与规则来源台账

本文件回答“每条可靠性规则为什么存在”。所有锚点用显式 HTML id，避免中文标题 slug 差异；`docs/reliability.json` 的 `incident` 字段必须指向这里真实存在的 id。

**字段约定**

- 日期：记录首次写入的日期（YYYY-MM-DD）。
- owner：初始 `feZ`；代码责任人由后续实施者在此补填。
- type：`existing-incident`（仓内真实事故/修复记录）、`static-finding`（静态发现，尚未实跑复现）、`historical-risk`（历史风险，仅有防护代码/注释）、`design-risk`（设计上必须防的风险，不是已发生事故）、`flaky-removal`（删除 flaky 测试的台账）。
- 症状/风险、diff 触发信号、check、source 路径与行号、可选 PR、evidence runId、coverageGap 每节必填。
- **PR 字段没有就写「无，尚未核实 PR」，禁止编造编号。**
- **evidence runId 当前一律写 `none`**（本回合未执行验证程序，没有真实 runId）。
- 原始失败证据不删除；删除 flaky 测试不等于删除它的证据。

## 索引

| 锚点 | 规则 | type | requiredLevel |
| --- | --- | --- | --- |
| `nf-map` | R01 | existing-incident | full |
| `nf-panel` | R02 | existing-incident | heavy |
| `nf-outline` | R03 | existing-incident | full |
| `nf-response` | R04 | existing-incident | full |
| `verify-syntax` | R05 | static-finding | full |
| `index-sha` | R06 | historical-risk | full |
| `host-contract-risk` | R02 兜底 | design-risk | heavy |

---

<a id="nf-map"></a>
## nf-map：recipes 对 Map 调 .map

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：existing-incident
- **症状/风险**：novel-forge 的 `GET /recipes` 同时支持 `engine.listRecipes()` 和 `engine.recipes` 为 Map 两种形态。历史上把 Map 当数组调 `.map`，接口直接抛错，宿主里“新建作品”的配方列表不可用。假 harness 用普通数组喂数据时抓不到，只有真实宿主挂载检查暴露。
- **diff 触发信号**：`plugins/novel-forge/src/host/**` 下的改动行含 `recipes`、`listRecipes` 或 `Map`。
- **check**：`node --test plugins/novel-forge/test/host.test.mjs`，并人工确认 `GET /recipes 兼容 engine.recipes 是 Map` 这条断言仍存在（现有位置 `plugins/novel-forge/test/host.test.mjs:85-88`，构造 `new Map([['novel', ...]])` 后 `delete engine.listRecipes`）。
- **source**：
  - `plugins/novel-forge/dev/mount-check.mjs:3`：「这条检查抓到过假 harness 抓不到的两个 bug：侧栏 id 与 main key 不一致、recipes 对 Map 调 .map。」
  - `plugins/novel-forge/test/host.test.mjs:85`：Map 形态回归用例。
  - `plugins/novel-forge/test/host.test.mjs:41`：`listRecipes` 的另一种形态。
- **PR**：无，尚未核实 PR。
- **evidence runId**：`none`。
- **coverageGap**：host.test.mjs 只覆盖 HTTP 层的两种 recipes 形态，不覆盖真实宿主里配方列表的渲染与点击；真实挂载仍属 P2 的 `mount-check` 范围。

---

<a id="nf-panel"></a>
## nf-panel：侧栏 id 与 main key 不一致

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：existing-incident
- **症状/风险**：面板注册用的 key 与宿主 main key 不一致时，注册调用不报错，但侧栏点不开面板；stub ctx 与 Node 语法检查都发现不了。P0 已实现的能力里没有真实 DSH 挂载，所以命中此规则时必须如实标“缺 GUI 证据 / BLOCKED”，不能签 done。
- **diff 触发信号**：`plugins/novel-forge/client-src/**` 或 `plugins/novel-forge/client.js` 的改动行含 `register`、`selectPanel` 或 `novel-forge`。
- **check**：`node scripts/verify.mjs heavy`（P0 预期退出 2、status=BLOCKED、reason=HEAVY_NOT_IMPLEMENTED）；审阅侧重点为侧栏 id 与 main key、面板注册 key、`inject`/`dispose`。
- **source**：
  - `plugins/novel-forge/dev/mount-check.mjs:3`：同一条注释里的第二个 bug。
  - `plugins/novel-forge/dev/mount-check.mjs:1-2`：该检查的定位（临时 DSH_HOME、起真实 `dsh web`、Playwright 开侧栏）。
- **PR**：无，尚未核实 PR。
- **evidence runId**：`none`。
- **coverageGap**：P0 没有 heavy 实现，此规则只能产出“需要挂载验证”的结论；`selectPanel` 与宿主 id 约定没有自动化断言。兜底范围（跨插件）见 `#host-contract-risk`。

---

<a id="nf-outline"></a>
## nf-outline：v2 大纲界面一章不显示

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：existing-incident
- **症状/风险**：novel-forge 0.4.0 的 v2 大纲把章放在顶层扁平 `chapters`，卷上只有 `chapterIds`；工作台、章节页、大纲页都只读 `volume.chapters`，于是新项目显示“卷一 0 章”。修复引入 `client-src/outline.js` 的 `volumeRows`/`chapterMeta` 作为统一口径，并兼容 v1 与“只有扁平 chapters”的历史数据。
- **diff 触发信号**：`plugins/novel-forge/client-src/**` 的改动行含 `chapters`、`chapterIds`、`volumeRows` 或 `chapterMeta`。
- **check**：`node --test plugins/novel-forge/test/outline-client.test.mjs`；评审 v1/v2 读形态与“扁平 chapters”兼容。
- **source**：
  - `plugins/novel-forge/CHANGELOG.md:41`：`### Fixed` 下的 v2 大纲修复条目（提到 `client-src/outline.js` 与 v1 兼容）。
  - `plugins/novel-forge/CHANGELOG.md:37`：`### Fixed` 小节标题。
  - `plugins/novel-forge/test/outline-client.test.mjs:1-6`：文件头说明 v1/v2 双形态，导入 `volumeRows`/`chapterMeta`。
- **PR**：无，尚未核实 PR。
- **evidence runId**：`none`。
- **coverageGap**：测试只覆盖归类纯函数，不覆盖三处页面是否都改用同一口径；页面渲染层没有自动化。

---

<a id="nf-response"></a>
## nf-response：非 JSON 2xx 被静默吞成空态

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：existing-incident
- **症状/风险**：`client-src/api.js` 曾把“HTTP 2xx 但响应体不是 JSON”当成“没有内容”，静默返回空态：书架/章节看起来为空，或漏出 `Cannot read properties of null` 这类英文 TypeError。修复改为抛带 `BAD_RESPONSE` 的中文错误；空响应体（204/无内容）仍返回 `null`。
- **diff 触发信号**：`plugins/novel-forge/client-src/api.js` 任意行变化（`addedOrRemovedPattern` 为空，匹配全部改动行）。
- **check**：`node --test plugins/novel-forge/test/client-audit.test.mjs`；评审侧确认非 JSON 2xx 不静默空态、错误信息为中文且可诊断。
- **source**：
  - `plugins/novel-forge/CHANGELOG.md:39`：修复条目，说明五类路径（非 2xx / 网络断 / 非 JSON 2xx / 空体 / abort）由 `test/client-audit.test.mjs` 9 条覆盖。
  - `plugins/novel-forge/test/client-audit.test.mjs:1-3`：文件头写明“锁住用户看到什么”的五类错误路径，只用假 fetch。
- **PR**：无，尚未核实 PR。
- **evidence runId**：`none`。
- **coverageGap**：只测请求层，不测各页面是否正确展示错误；不覆盖真实宿主注入的 fetch 差异。

---

<a id="verify-syntax"></a>
## verify-syntax：多文件 `node --check` 只检查第一个文件

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：static-finding
- **症状/风险**：`scripts/test-all.sh` 的“无测试插件的语法门”把 `find` 出来的多个文件一次性传给 `node --check`。`node --check` 只把它之后的第一个路径当待检脚本，其余成为参数，因此列表里后续文件的语法错误会被漏报，形成“语法门全绿但仓里有坏文件”的假绿。**本回合为静态阅读发现，尚未实跑复现**（没有写盘/执行脚本），实施负例成功检出后在此补 runId。
- **diff 触发信号**：`scripts/test-all.sh` 或 `scripts/verify*.mjs` 任意行变化。
- **check**：`node --test scripts/verify.test.mjs`（逐文件独立 `node --check`、临时仓第二个坏文件必须被发现、门禁行为与预算）；静态引用行 `scripts/test-all.sh:56`。
- **source**：
  - `scripts/test-all.sh:56`：`run "$name(syntax)" node --check $files`（未加引号的多文件展开）。
  - `scripts/test-all.sh:53`：`files=$(find "$p" -maxdepth 2 -name '*.js' ...)` 生成多文件列表。
  - `scripts/test-all.sh:47`：该语法门的标题行。
- **PR**：无，尚未核实 PR。
- **evidence runId**：`none`（尚未实跑复现）。
- **coverageGap**：`node --check` 只验证 JS 语法，不覆盖 JSX/CSS/打包兼容；本仓当前 11 个插件都有 `test`，该分支目前不会触发，属于潜在缺陷而非当前红项。

---

<a id="index-sha"></a>
## index-sha：索引指向旧版本 commit

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：historical-risk
- **症状/风险**：`index.json` 里写 `0.4.0`、但 `source.commit` 指向的提交里 `package.json` 还是 `0.3.9`，插件市场会装到旧代码；或 commit 已不在本地仓库，索引不可复现。`docs/verify-readme.mjs` 已有对应防护，但这是防护代码而非已核实的事故工单。
- **diff 触发信号**：`index.json` 或 `plugins/*/package.json` 任意行变化。
- **check**：`node scripts/check-manifest.mjs` 与 `node docs/verify-readme.mjs`；人工再核 `engines` 与最新发布版本。
- **source**：
  - `docs/verify-readme.mjs:132`：「防的是「索引写了 0.4.0、指到的 commit 里还是 0.3.9」这类发版事故。」
  - `docs/verify-readme.mjs:141-145`：浅克隆时跳过历史版本校验（原文 `info 浅克隆，跳过历史版本提交校验（最新版本仍校验）`）。
  - `docs/verify-readme.mjs:150-165`：逐版本 `git cat-file -t` 与 `git show <commit>:<path>/package.json` 比对版本。
  - `docs/verify-readme.mjs:113-114`：`source.commit` 必须是 40 位 sha。
- **PR**：无，尚未核实 PR（注释本身不是 PR 证据）。
- **evidence runId**：`none`。
- **coverageGap**：浅克隆分支仍会跳过历史校验；verify 要求把浅克隆判 BLOCKED，但本仓当前是否有完整历史未在本回合核对。`engines` 没有自动断言。

---

<a id="host-contract-risk"></a>
## host-contract-risk：跨插件宿主契约只能真挂载验证

- **日期**：2026-11-17
- **owner**：feZ（代码责任人待实施者补填）
- **type**：design-risk
- **症状/风险**：任一插件的 `client.js`、`client-src/**`、`cordis.patch.yml` 或 `dsh`/`inject` 注册声明变化，都可能改变宿主侧的注册 key、面板 id、依赖注入或释放时机。这些契约由宿主运行时解释，**Node 语法检查和 stub ctx 都不能证明它成立**。这条规则是设计上必须防的风险，**不谎称已有跨插件事故**。
- **diff 触发信号**：`plugins/*/client.js`、`plugins/*/client-src/**`、`plugins/*/cordis.patch.yml` 任意行变化。
- **check**：`node scripts/verify.mjs heavy`（真挂载）；P0 无此能力，命中即按 BLOCKED 报告，不得以 fast/full 通过替代。
- **source**：
  - `plugins/novel-forge/dev/mount-check.mjs:1-3`：同类契约风险的真实挂载检查与其抓到过的问题（作为该类风险的已有证据，不外推到其他插件）。
  - `REVIEW.md` §6 第 3 条：宿主注册 key/id、inject/dispose 的审阅重点。
- **PR**：无，尚未核实 PR。
- **evidence runId**：`none`。
- **coverageGap**：`plugins/*/package.json` 里的 `dsh` 注册字段变化目前只由 R06（full）覆盖，没有 heavy 兜底；这是已知缺口，补规则须走默认分支的独立基础设施变更。

---

## flaky 删除台账

当前为空：本仓尚未按本流程删除任何测试。删除前必须先在 `docs/verification-incidents.md` 补一行（type=`flaky-removal`），字段缺一不得删。

| 测试路径 | 测试名 | 三轮失败 runId | 相同 subject/环境对照 | 已排查方向 | 无法定位的原因 | 删除 diff | 失去的不变量 | 替代检查 | 人可复核结论 | 日期 | owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| （空） |  |  |  |  |  |  |  |  |  |  |  |

**删除时必须填的字段清单**

1. 测试路径与测试名（精确到 `test('...')` 名称）。
2. 三轮失败 runId（同轮多个失败算一轮；缺依赖/BLOCKED 不算失败轮）。
3. 相同 subject、同 Node/平台、同 fixture/种子下的失败与成功对照证据。
4. 已排查方向（竞态、时序、资源泄漏、真实数据依赖、网络等）。
5. 三轮仍无法定位的具体原因。
6. 删除 diff（对应的 commit/文件行范围）。
7. 失去的不变量（这条测试原本锁什么行为）。
8. 替代检查，或明确写“暂无”。
9. 人可复核的结论（谁在什么证据下同意删）。
10. 日期与 owner。

**规则**：冻结的正式测试要删，必须走默认分支的独立维护变更；当前功能任务仍是 BLOCKED，不能自己删测试后自证通过。无法确认是 flaky 还是产品 bug 时先升级，不得以“无法定位”删除有效红测。原始失败证据与日志不删除。
