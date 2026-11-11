# 墨炉 · Novel Forge — 架构与接口契约 v0.1

> 本文件是宿主、引擎、recipe、客户端四方的施工图。任何一方偏离这里，集成就失败。
> 目标：**底层是通用创作流水线引擎（零小说知识），小说只是第一份 recipe**。
> 第二个 recipe（比如短篇、剧本、播客脚本）应当只写 `src/recipes/<name>/` 就能接入，不改引擎。

---

## 0. 定位

- 产品名：**墨炉**（Novel Forge）。包名 `dsh-novel-forge`，路由前缀 `/novel-forge`，工具前缀 `novel_`。
- 一句话：给一个想法，墨炉把它炼成一部长篇小说——设定、人物、大纲、细纲、草稿、连续性审校、修订、导出，全流程可见、可暂停、可改、可续跑。
- 气质：安静的工坊，不是聊天框。用户看到的是「这本书现在到哪一步了、这一章写得怎么样」，不是一屏一屏的对话。
- 不做什么：不做通用聊天、不做多人协作、不做云同步。所有数据落在本机 `$DSH_HOME/novel-forge/`。

---

## 1. 目录结构

```
plugins/novel-forge/
  index.js                 宿主入口（薄，只做装配）
  client.js                构建产物（esbuild 生成，不提交？——提交，桌面端直接加载）
  build.mjs                esbuild 构建客户端
  cordis.patch.yml
  package.json
  src/
    forge/                 ★ 通用创作引擎（不认识"小说"两个字）
      engine.js            ForgeEngine：跑 run、管状态、发事件、暂停/取消
      store.js             磁盘存储：projects/artifacts/runs，原子写
      llm.js               LLM 网关：resolve model、流式累积、重试、JSON 提取、用量
      events.js            事件类型常量 + 广播器
      recipe.js            recipe 校验、stage 解析、拓扑检查
      errors.js            ForgeError（code/message/detail）
      ids.js               id 生成（p_/r_/ch01）
      text.js              文本工具：truncate、字数、JSON 提取、markdown 分段
    host/                  ★ 宿主半片
      routes.js            REST 路由（纯函数，注入 engine/store 便于测试）
      tools.js             novel_* 工具定义
      json.js              req/res 小工具（读 body、写 json、错误码）
    recipes/
      novel/              ★ 小说 recipe
        index.js          recipe 定义（params/artifacts/stages/estimate/export）
        prompts/
          zh.js           中文提示词（所有 stage）
          en.js           英文提示词（可选，先只做 zh）
        craft.js          小说工艺：字数统计、AI 腔检测、POV/时态启发式检查
        ledger.js         连续性账本：合并 patch、查询某章前的状态、序列化给 prompt
        outline.js        outline JSON 规范化、章节 id 分配（ch01…）、章节查询
        export.js         Markdown / EPUB 组装（marked + epub-gen-memory）
  client-src/
    index.jsx             面板注册 + 页面挂载
    app.jsx               顶层：列表 / 新建 / 项目工作台
    api.js                fetch 封装
    strings.js            zh/en 文案
    style.js              样式注入（一套 CSS 字符串）
    components/
      ProjectList.jsx
      CreateWizard.jsx
      Workbench.jsx       项目主视图：阶段轨 + 内容区 + 运行抽屉
      StageRail.jsx
      ArtifactView.jsx    markdown 渲染 / JSON 结构化展示
      RunDrawer.jsx       事件流、进度、取消
      ChapterView.jsx     单章：细纲/草稿/审校/摘要
      ExportMenu.jsx
      bits.jsx            按钮、徽章、空态、Toast 等
  test/
    engine.test.mjs
    store.test.mjs
    novel-recipe.test.mjs
    host.test.mjs
    fixtures/             假 LLM 剧本、样例 outline
  dev/
    harness.mjs           node 侧：假 __ModuleLoader__ + 假 ctx，加载 client.js
    verify.mjs            起假宿主 + Playwright 截图
    seed.mjs              造一个 demo 项目（假 LLM 或真模型）
  docs/
    architecture.md       本文件
    prompts.md            提示词设计说明（军师写）
```

**规则**：`src/forge/**` 不得 import `src/recipes/**`，也不得出现「chapter」「novel」「章节」这类词（测试里会 grep 断言）。引擎只认 `stage / item / artifact / recipe`。

---

## 2. 数据模型（磁盘）

根目录：`<dshHome>/novel-forge/`，`dshHome = process.env.DSH_HOME || ~/.dsh`。

```
novel-forge/
  projects/
    p_20261111_ab12/
      project.json
      artifacts/
        brief.json
        bible.md
        characters.json
        outline.json
        beats/ch01.json ... ch24.json
        draft/ch01.md ... ch24.md
        summary/ch01.md ...
        review/ch01.json ...
        ledger.json
        manuscript.md
      artifacts/.versions/        旧版本，key 里的 / 换成 __，保留最近 3 份
      runs/
        r_20261111_cd34.json      运行记录（含事件，最多 500 条）
        r_20261111_cd34.log       人类可读日志（append）
      exports/
        <slug>.md
        <slug>.epub
```

### 2.1 project.json

```json
{
  "schemaVersion": 1,
  "id": "p_20261111_ab12",
  "title": "长夜将明",
  "recipe": "novel",
  "recipeVersion": 1,
  "createdAt": "2026-11-11T10:00:00.000Z",
  "updatedAt": "2026-11-11T10:20:00.000Z",
  "params": {
    "premise": "一个在殡仪馆值夜班的年轻人，发现死者会在头七那晚回来……",
    "genre": "悬疑",
    "audience": "成年读者",
    "language": "zh",
    "chapters": 24,
    "wordsPerChapter": 3000,
    "pov": "第三人称限知",
    "tone": "冷、克制、带一点潮湿的温情",
    "styleGuide": "",
    "autoReview": true,
    "reviewGate": false,
    "seed": "可选：一句话母题/灵感种子"
  },
  "artifacts": {
    "outline": { "kind": "json", "version": 2, "updatedAt": "...", "bytes": 8123, "by": { "stage": "outline", "runId": "r_…", "model": "deepseek-v4" } },
    "draft/ch01": { "kind": "md", "version": 1, "...": "..." }
  },
  "stages": {
    "premise":   { "status": "done", "updatedAt": "..." },
    "bible":     { "status": "done" },
    "characters":{ "status": "done" },
    "spine":     { "status": "done" },
    "outline":   { "status": "done" },
    "beats":     { "status": "partial", "items": { "ch01": "done", "ch02": "error" } },
    "draft":     { "status": "idle",    "items": {} },
    "review":    { "status": "idle",    "items": {} },
    "revise":    { "status": "idle",    "items": {} },
    "blurb":     { "status": "idle" }
  },
  "stats": { "calls": 12, "estTokensIn": 48210, "estTokensOut": 18320, "words": 6100, "chapters": 24, "drafted": 2, "revised": 0 },
  "activeRunId": "r_…" ,
  "pendingReview": { "stage": "outline", "at": "…", "nextStages": ["beats","draft"] },
  "lastError": null
}
```

- `stages[stage].status`：`idle | running | done | partial | error | paused`
- 每个 `each` stage 额外有 `items: { <itemId>: 'pending'|'running'|'done'|'error' }`。
- `artifacts[key].by` 记录最后一次写入者，UI 显示「由哪一步生成」。
- `pendingReview` 只在不自动继续时出现；跑下一段时清空。

### 2.2 run.json

```json
{
  "schemaVersion": 1,
  "id": "r_20261111_cd34",
  "projectId": "p_…",
  "status": "running|done|error|cancelled|paused",
  "startedAt": "…",
  "endedAt": null,
  "options": { "stages": ["draft"], "items": null, "autoApprove": false },
  "current": { "stage": "draft", "item": "ch02", "label": "第 2 章 · 草稿" },
  "progress": { "done": 1, "total": 24 },
  "seq": 137,
  "events": [
    { "seq": 1, "ts": "…", "type": "run-start", "data": { "stages": ["draft"] } },
    { "seq": 2, "ts": "…", "type": "stage-start", "data": { "stage": "draft", "total": 24 } },
    { "seq": 3, "ts": "…", "type": "item-start", "data": { "stage": "draft", "item": "ch01", "index": 0, "total": 24 } },
    { "seq": 4, "ts": "…", "type": "llm", "data": { "stage": "draft", "item": "ch01", "phase": "prose", "chars": 2980 } },
    { "seq": 5, "ts": "…", "type": "artifact", "data": { "key": "draft/ch01", "kind": "md", "bytes": 9001 } },
    { "seq": 6, "ts": "…", "type": "log", "data": { "message": "第 1 章草稿完成，2864 字" } },
    { "seq": 7, "ts": "…", "type": "item-done", "data": { "stage": "draft", "item": "ch01" } }
  ],
  "error": null,
  "stats": { "calls": 3, "estTokensIn": 9000, "estTokensOut": 4000 }
}
```

事件类型（`src/forge/events.js` 导出常量，宿主与客户端共用字符串）：

| type | 何时 | data |
|---|---|---|
| `run-start` | 开跑 | `{stages, items, autoApprove}` |
| `run-end` | 正常结束 | `{status}` |
| `run-error` | 异常结束 | `{message, code}` |
| `run-paused` | 审稿门暂停 | `{stage}` |
| `stage-start` | 进入 stage | `{stage, total}` |
| `stage-end` | 离开 stage | `{stage, status}` |
| `item-start` | 开始一个 item | `{stage, item, index, total}` |
| `item-done` | item 完成 | `{stage, item}` |
| `item-error` | item 失败但继续 | `{stage, item, message}` |
| `artifact` | 写入产物 | `{key, kind, bytes}` |
| `llm` | 一次模型调用结束 | `{stage, item, phase, chars, model}` |
| `log` | 人类可读进展 | `{message, level}` |
| `progress` | 进度更新 | `{done, total}` |

事件同时写 `run.json.events`（上限 500，超出丢弃最旧并在 `dropped` 计数）和 `run.log`（所有 `log` 行）。

### 2.3 artifact 内容

`read(key)` 返回 `{ key, kind, content, meta }`；`kind` 由 recipe 的 `artifacts` 声明决定，动态 key（`draft/ch01`）由 stage 返回值里的 `kind` 决定。

- md：纯 markdown 字符串。
- json：任意 JSON（对象/数组）。

---

## 3. 通用引擎契约（src/forge/engine.js）

### 3.1 Recipe 形状

```js
export const novelRecipe = {
  id: 'novel',
  version: 1,
  title: '长篇小说',

  // 新建项目时的参数 schema（JSON Schema，draft-07 子集即可）+ 默认值
  paramsSchema: { type: 'object', properties: { ... }, required: ['premise'] },
  paramsDefaults: { genre: '悬疑', chapters: 24, wordsPerChapter: 3000, autoReview: true, ... },

  // 声明本 recipe 会产出的 artifact（静态 key）；per-item key 用 '<stage>/<item>' 约定，声明成 'beats/*' 之类
  artifacts: {
    brief:      { kind: 'json', title: '故事核心' },
    bible:      { kind: 'md',   title: '世界观设定' },
    characters: { kind: 'json', title: '人物档案' },
    spine:      { kind: 'md',   title: '情感脊柱' },
    outline:    { kind: 'json', title: '卷章大纲' },
    ledger:     { kind: 'json', title: '连续性账本' },
    'beats/*':  { kind: 'json', title: '章节细纲' },
    'draft/*':  { kind: 'md',   title: '章节草稿' },
    'summary/*':{ kind: 'md',   title: '章节摘要' },
    'review/*': { kind: 'json', title: '章节审校' },
    manuscript: { kind: 'md',   title: '全书合稿' }
  },

  stages: [
    {
      id: 'premise',
      title: '故事核心',
      produces: ['brief'],           // 静态 key；
      review: false,
      run: async (ctx) => { ... }    // 返回 { artifacts: { brief: {kind:'json', content:{...}} }, note? }
    },
    {
      id: 'beats',
      title: '章节细纲',
      each: 'outline.chapters',      // 字符串点路径 → 数组（每项必须有 id）
      produces: ['beats/*'],
      run: async (ctx) => { ... }    // ctx.item 是 outline.chapters[i]
    }
  ],

  // UI 预估（不调模型）
  estimate: (params) => ({ chapters, calls, estTokensIn, estTokensOut, note }),

  // 导出（宿主调用；返回 { filename, mime, buffer }）
  exports: {
    markdown: { title: 'Markdown', run: async (ctx) => ({ filename, mime, buffer }) },
    epub:     { title: 'EPUB',     run: async (ctx) => ({ filename, mime, buffer }) }
  }
}
```

**stage.run 返回值**（严格）：

```js
{
  artifacts: {
    '<key>': { kind: 'md'|'json', content: <string|object> }
  },
  note?: string,          // 写进 run 日志
  meta?: object           // 合并进 artifact meta
}
```
没有 artifacts 也允许（纯检查 stage）。

### 3.2 ForgeEngine API

```js
new ForgeEngine({ root, recipes: [novelRecipe], llm, logger?, clock? })
```

- `llm`：`{ generate(opts), info() }`（见 §3.4）。测试注入假实现。
- `root`：`<dshHome>/novel-forge`。

方法：

| 方法 | 说明 |
|---|---|
| `listProjects()` | 读所有 project.json，返回摘要数组（按 updatedAt 降序） |
| `createProject({ recipeId='novel', title?, params })` | 校验 params，写盘，返回 project |
| `getProject(idOrPrefix)` | 支持 id 或 id 前缀；找不到抛 `NOT_FOUND` |
| `updateProject(id, patch)` | 只允许 `title/params`（params 变更要过 schema）；正在跑时拒绝 |
| `deleteProject(id)` | 有 active run 时拒绝；移入 `trash/` 不真删 |
| `getArtifact(id, key)` | `{key, kind, content, meta}` 或 null |
| `writeArtifact(id, key, {kind, content}, by?)` | 手改/续跑用；版本 +1，旧版进 `.versions` |
| `startRun(id, options)` | 返回 run（不等待）；已有 active run 抛 `RUN_ACTIVE` |
| `getRun(runId)` | run 快照（含 events） |
| `getRunEvents(runId, afterSeq)` | `{events, seq}` 增量 |
| `cancelRun(runId)` | abort；status→cancelled |
| `listRuns(projectId)` | 运行历史摘要 |
| `estimate(id, params?)` | recipe.estimate + 现有进度 |
| `exportProject(id, format)` | 调 recipe.exports[format].run(ctx)，写 exports/，返回 `{filename, path, mime, bytes}` |
| `resolveProject(query)` | id / 前缀 / 标题子串 / `'active'`（最近更新） |

**startRun options**：

```js
{
  stages?: string[],     // 显式 stage 列表（按 recipe 顺序执行）
  from?: string,         // 从某 stage 开始；与 stages 二选一
  to?: string,           // 到某 stage 为止（含）
  items?: string[],      // 只跑这些 item（each stage 生效）
  force?: boolean,       // true 则已完成也重跑；默认 false（跳过已完成）
  autoApprove?: boolean, // true 则忽略 review gate
  dryRun?: boolean       // 只校验 + 事件，不调模型（用于测试/预估）
}
```

行为规则：

1. **顺序**：严格按 recipe.stages 顺序。`stages` 里出现未知 id → `BAD_STAGE`。
2. **跳过已完成**：默认（`force !== true`）跳过已有产物的阶段/item，并 `log('跳过 X（已完成）')`；`force:true` 时全部重跑。each stage 对每个 item 单独判断（该 item 的产物存在即跳过）。判断依据：静态 stage 看 `stage.produces` 的 key 是否都在，each stage 看 `produces` 里 `*` 替换成 itemId 后是否存在。
3. **并发**：同一项目同时只允许一个 run（`RUN_ACTIVE`）；不同项目天然隔离。item 之间串行（小说需要前文摘要）。
4. **取消**：`AbortSignal` 贯穿 LLM；每个 item 前后检查 `signal.aborted`；取消后当前 item 标 `pending`（不是 error），run status `cancelled`。
5. **错误**：非 each stage 抛错 → run 失败，project.stages[id].status='error'，写 lastError。each stage 单 item 抛错 → 默认继续下一个（`onItemError:'continue'`），除非 stage 声明 `onItemError:'stop'`（draft 用 stop：文风断了没必要往下写）。
6. **审稿门**：stage 完成且 `stage.review && !autoApprove` → run status `paused`，project.pendingReview 记下 `nextStages`（本次 run 中尚未执行的 stage id 列表）；UI 给「继续」按钮调 `startRun({stages: nextStages})`。继续时清空 pendingReview。
6b. **条件跳过**：stage 可声明 `skip(project) => boolean|string`（返回字符串即跳过原因）。engine 在进入该 stage 前调用；跳过时 `stage-end` 事件的 status 为 `'skipped'`，不写产物。novel recipe 用它实现「`autoReview=false` 时跳过 review/revise」「review 判定 pass 时跳过 revise」。
7. **崩溃恢复**：引擎启动时（`recover()`）扫 runs/，把 status='running' 但进程已死的 run 标 `interrupted`，project.stages 里 running → partial/error。宿主 apply 时调用一次。
8. **dryRun**：不调用 llm，不写产物，只发 stage/item 事件并校验每个 stage 的 `each` 路径能解析、`produces` 合法。用于单测和「先看看要跑多少」。

### 3.3 Stage ctx（recipe 侧唯一接口）

```js
ctx = {
  project,            // 只读快照（含 params/stages/stats）
  params,             // project.params 快捷方式
  run,                // { id, options }
  item, index, total, // each stage 才有；静态 stage 为 undefined
  items,              // each 的全量数组（只读），方便看下一章
  signal,

  // 读
  has(key), read(key), text(key, maxChars?), json(key), list(path),
  // text: md 原样 / json 序列化；缺失返回 ''（不是 null，方便拼接）
  // json: 缺失抛 ARTIFACT_MISSING（recipe 应先用 has 判断）
  // list('outline.chapters'): 先 json('outline') 再按点路径取值

  // 写（只在返回值里写，ctx 不直接落盘——保证 item 失败不产生半成品）
  // 返回 { artifacts: {...} }

  // 工具
  fit(text, maxChars),      // 截断到 maxChars，末尾加 '…（已截断）'
  log(message, data?),      // 发 log 事件 + run.log
  progress(done, total),    // 发 progress 事件

  // LLM
  llm: {
    generate({ system, user, maxTokens=4096, temperature, json=false, phase, label })
      // 返回 { text, json?, model, chars }
  }
}
```

**约定**：`ctx.text(key)` 在缺失时返回 `''`；recipe 用 `ctx.has(key)` 判断是否已有前文。`ctx.json(key)` 缺失时抛 `ARTIFACT_MISSING`，错误信息带 key。

### 3.4 LLM 网关（src/forge/llm.js）

```js
createLlmGateway({ service, resolveModel, onEvent, signal })
// service = ctx.get('llm')；resolveModel = () => ({provider, model})
```

- `generate(opts)` 步骤：
  1. `const {provider, model} = await resolveModel()`；不可用抛 `LLM_UNAVAILABLE`（消息告诉用户去设置里选模型）。
  2. `const call = await service.prepareCall({provider, model, maxTokens}, signal)`
  3. `call.stream({...call.config, system, messages:[{role:'user', content:[{type:'text',text:user}], source:{kind:'dsh-novel-forge'}}], sessionId, signal})`
  4. 累积 `text-delta`；`finish` 且 `reason.kind==='error'` 抛 `LLM_ERROR`，`'aborted'` 抛 `LLM_ABORTED`。
  5. 空文本 → 重试一次（`LLM_EMPTY`）；仍空抛错。
  6. `json:true` → `extractJson(text)`（先试整体解析，再剥 ```json 围栏，再找第一个 `{`/`[` 到最后一个 `}`/`]`）；失败抛 `LLM_PARSE`，带 `raw`（截断 2000 字）。
  7. 记录 `{chars, model}` 并回调 onEvent({type:'llm', ...})。
- 重试：网络/5xx/空响应重试 2 次，退避 1s/3s；`LLM_PARSE` 不重试（让 recipe 决定）。
- 用量：`chars` 估算 token（中文约 1.6 字/token，英文 4 字符/token；统一 `ceil(chars/1.6)` 足够粗）。真实 usage 若 chunk 里有，优先用。
- `sessionId`：每个 run 一个 `dsh-novel-forge-${runId}`，同一 run 的调用共享会话（provider 侧可缓存 system 前缀）。

### 3.5 Store（src/forge/store.js）

- `constructor(root)`；所有写操作走内部 promise 队列（同 project 串行）。
- `atomicWrite(file, data)`：tmp + rename。
- `writeArtifact(projectId, key, {kind, content}, by)`：
  - 读 project.json → 若存在旧版本，把旧文件复制到 `.versions/<safeKey>.<n>.<ext>`，只留 3 份；
  - 写新文件；更新 project.artifacts[key] = {kind, version, updatedAt, bytes, by}；
  - 更新 stages/items 状态由 engine 负责（store 不管语义）。
- `readArtifact`：md 读字符串；json 读并 parse（坏 JSON 抛 `ARTIFACT_CORRUPT`）。
- 所有路径做 `safeKey(key)`：拒绝 `..`、绝对路径、反斜杠；key 只允许 `[a-zA-Z0-9_\-/.]`，`/` 换目录。
- 单文件上限：artifact 8MB，project.json 4MB，run.json 8MB；超了抛 `TOO_LARGE`。
- `trashProject`：`mv projects/<id> trash/<id>-<ts>`。

### 3.6 ForgeError

```js
new ForgeError(code, message, detail?)
// code: NOT_FOUND | BAD_PARAMS | BAD_STAGE | RUN_ACTIVE | ARTIFACT_MISSING |
//       ARTIFACT_CORRUPT | TOO_LARGE | LLM_UNAVAILABLE | LLM_ERROR | LLM_ABORTED |
//       LLM_PARSE | LLM_EMPTY | BAD_RECIPE | EXPORT_FAILED | CONFLICT
```
宿主把 code 映射 HTTP：NOT_FOUND→404，BAD_*→400，RUN_ACTIVE/CONFLICT→409，LLM_*→502，TOO_LARGE→413，其他→500。

---

## 4. 小说 recipe 契约（src/recipes/novel/）

### 4.1 参数（paramsSchema）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `premise` | string 必填 8–2000 字 | — | 一句话故事核 |
| `title` | string | '' | 空则由 premise stage 起名 |
| `genre` | enum：悬疑/奇幻/科幻/都市/历史/言情/恐怖/武侠/通用 | 悬疑 | |
| `audience` | enum：成年/青少年/泛读者 | 成年 | |
| `language` | enum：zh/en | zh | 先只实现 zh 提示词 |
| `chapters` | int 6–120 | 24 | |
| `wordsPerChapter` | int 800–8000 | 3000 | |
| `pov` | enum：第一人称/第三人称限知/第三人称全知 | 第三人称限知 | |
| `tone` | string ≤200 | '' | 文风关键词 |
| `styleGuide` | string ≤4000 | '' | 用户给的写作规矩（禁用语、样本段落） |
| `autoReview` | bool | true | draft 后是否自动跑 review+revise |
| `reviewGate` | bool | false | 是否在 outline/draft 后暂停等确认 |
| `seed` | string ≤500 | '' | 母题/意象/灵感种子 |

### 4.2 阶段表

| # | id | title | each | produces | review | 说明 |
|---|---|---|---|---|---|---|
| 1 | `premise` | 故事核心 | — | brief | — | 一句话→logline、主题、类型承诺、结局方向、书名候选 |
| 2 | `bible` | 世界设定 | — | bible | — | 世界规则、地点、时代、氛围、禁忌；只写"会用到"的 |
| 3 | `characters` | 人物档案 | — | characters | — | 主角/对手/关键配角：欲望、恐惧、秘密、说话方式、弧光 |
| 4 | `spine` | 情感脊柱 | — | spine | — | 主线因果链、三幕/起承转合、每卷情绪曲线、结局落点 |
| 5 | `outline` | 卷章大纲 | — | outline, ledger | ✅ | 章节数组：id(ch01)、title、goal、conflict、turn、hook、pov、when/where；同时初始化 ledger |
| 6 | `beats` | 章节细纲 | outline.chapters | beats/* | — | 每章 5–9 个场景 beat：地点、人物、目标、阻碍、转折、出口 |
| 7 | `draft` | 章节草稿 | outline.chapters | draft/*, summary/* | ✅ | 写正文 + 生成摘要（两次调用）；喂：本章细纲、上一章摘要、账本、下一章目标、文风约束 |
| 8 | `review` | 连续性审校 | outline.chapters | review/* | — | LLM 审校（事实/时间线/人物/视角/文风/逻辑）+ 确定性检查；输出 findings + ledgerPatch |
| 9 | `revise` | 修订 | outline.chapters | draft/*, summary/* | — | 只改 findings 指出的问题，保持文风；重写草稿+摘要 |
| 10 | `blurb` | 封面文案 | — | blurb | — | 书名定稿、一句话卖点、300 字简介、标签 |

**draft 为什么自己生成 summary**：第 n 章的写作需要第 n-1 章的摘要；若 summary 是独立 stage，就要等全部草稿写完才有摘要，链就断了。所以 summary 在 draft 的 item 里一并产出。同理，review 的 ledgerPatch 在 review item 里即时合并进 ledger，revise 用得上。

**autoReview 语义**：通过 `stage.skip` 实现——`params.autoReview=false` 时 review/revise 两个 stage 的 `skip()` 返回 `'未开启自动审校'`，同一 run 里自然跳过；手动跑时用户显式 `stages:['review','revise']`（此时引擎仍会调用 skip——所以 recipe 的 skip 只看 params，不看是否手动；手动想强制审校就把 params.autoReview 改 true 或再点一次「审校」按钮传 `force:true`？不行，force 不绕过 skip。**规则**：`skip` 只在 `force !== true` 时生效；手动「审校」按钮传 `force:true` 即可强制。

**reviewGate 语义**：`outline` 与 `draft` 两个 stage 的 `review:true`；`reviewGate=false` 时 engine 收到的 autoApprove 恒为 true（即不停）。UI 新建时给「每步停下让我看」开关。

### 4.3 关键 prompt 的输入预算（军师必须遵守）

上下文有限，每章写作前拼装的材料按此上限（字符）：

| 材料 | 上限 | 来源 |
|---|---|---|
| system（工艺约束 + 文风） | 2500 | 固定 + styleGuide |
| 本章细纲 beats | 2500 | `beats/<id>` |
| 上一章摘要 | 800 | `summary/<id-1>` |
| 前情账本（压缩） | 3000 | ledger.craftSlim() |
| 下一章目标（防止写飞） | 400 | `outline.chapters[i+1]` 的 goal/turn |
| 人物速查（本章出场者） | 1500 | characters |
| 用户风格样本 | 1500 | styleGuide |
| **合计 user 侧** | **≤ 12000 字符** | |

超出用 `ctx.fit()` 截断，优先砍人物速查、再砍账本细节。draft 的 maxTokens 建议 `wordsPerChapter * 2.2`（中文字符≈token 的 1.5–2 倍），上限 16000。

### 4.4 输出格式（硬约束）

- `brief` JSON：`{title, logline, theme, promise, ending, genreTags[]}`
- `characters` JSON：`{cast:[{name, role, want, fear, secret, voice, arc, relations:[{to, kind}]}]}`
- `outline` JSON：`{volumes:[{title, purpose, chapters:[{id, title, goal, conflict, turn, hook, pov, when, where, cast[]}]}], totalChapters}` — id 由 recipe 规范化重排（ch01…），模型给的 id 不可信。
- `beats` JSON：`{chapterId, title, scenes:[{no, where, when, cast[], goal, obstacle, turn, exit, sensory}]}`
- `draft`：纯 markdown 正文，章节标题 `## 第N章 标题`，段落之间空行；**不要**任何解释、不要 markdown 列表、不要「以下是」。
- `summary` md：≤300 字，含「发生了什么 / 谁知道了什么 / 留下什么钩子 / 时间地点」。
- `review` JSON：`{findings:[{severity:'block'|'warn'|'note', kind, where, issue, fix}], ledgerPatch:{facts?, threads?, characters?, timeline?}, verdict:'pass'|'revise'}`
- `ledger` JSON：`{facts:[{id,text,chapter,status}], threads:[{id,text,opened,status,closedIn}], characters:{name:{location,state,knows[]}}, timeline:[{chapter,when,event}], canonRules[]}`
- 所有 JSON 输出用 ```json 围栏（engine 会剥），字段名严格一致，不许多余字段；数组为空也要给 `[]`。

### 4.5 质量门槛（craft.js 的确定性检查，review 阶段自动跑）

- 字数：`draft` 正文中文字符数 / wordsPerChapter ∈ [0.75, 1.35]，否则 finding(warn)。
- 段落：单段 > 220 字 → finding(note)（网文节奏）；全文段落数 < 15 → warn。
- 对话比例：引号内字符 / 总字符 < 0.08 → warn（"叙述过多"）。
- AI 腔黑名单（命中 3 次以上 → warn）："仿佛" "似乎" "不禁" "缓缓" "微微" "一丝" "嘴角勾起" "眼中闪过" "空气仿佛凝固" "心中五味杂陈" "不由得" "莫名的" "难以言喻"。
- 重复 phrase：连续 3 段出现同一 4 字以上短语 → note。
- POV 检查：第三人称限知下出现「他不知道」以外的全知句（"与此同时，在城市的另一端"）→ note。
- 每章必须含 `beats` 里指定的 cast（缺人 → warn）、必须回应上一章 hook（LLM 检查）。

### 4.6 导出

- `markdown`：`# 书名\n\n> 简介\n\n## 第1章 …\n正文…`，含目录、章节分隔、字数统计页尾（可选）。
- `epub`：`epub-gen-memory`，`{title, author:'墨炉', lang:'zh'}` + chapters `[{title, content: marked.parse(md)}]`，封面可选（暂不做图）。
- 文件名：`<slug(title)>-<yyyyMMdd>.md|.epub`，slug 保留中文、去掉路径非法字符。

---

## 5. 宿主半片（src/host/）

### 5.1 index.js 装配

```js
export const name = 'dsh-novel-forge'
export const inject = ['webServer', 'connection']
export default {
  apply(ctx) {
    const root = join(dshHome(), 'novel-forge')
    const llm = createLlmGateway({ service: () => ctx.get('llm'), resolveModel: () => ctx.get('agentDefaultModel')?.currentSelection?.() })
    const engine = new ForgeEngine({ root, recipes: [novelRecipe], llm })
    engine.recover().catch(...)
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/novel-forge', handler: makeHandler({ engine }) }), 'novel-forge:routes')
    const tools = ctx.get('tools')
    if (tools?.register) ctx.effect(() => { const offs = registerNovelTools(tools, engine); return () => offs.forEach(f => f?.()) })
  }
}
```

> `llm` 网关的 `service` 用 getter 惰性取（apply 时 llm 服务可能还没就绪）；每次 generate 时再 `ctx.get('llm')`。

### 5.2 REST

所有响应 `application/json; charset=utf-8`；错误 `{error:{code,message,detail?}}`。鉴权：每个请求先 `const reject = ctx.get('connection')?.requestRejection?.({headers:req.headers}); if (reject) return send(res, 403, {error:{code:'FORBIDDEN',...}})`——注意 `requestRejection` 返回非空即拒绝；无该函数时（测试）放行。实际实现放 `routes.js` 的 `makeHandler({engine, guard})`，guard 可注入。

| 方法 | 路径 | body | 返回 |
|---|---|---|---|
| GET | `/projects` | — | `{projects:[summary]}` |
| POST | `/projects` | `{title?, params, recipeId?}` | `{project}` 201 |
| GET | `/projects/:id` | — | `{project, artifacts: summaryMap, runs: [...]}` |
| PATCH | `/projects/:id` | `{title?, params?}` | `{project}` |
| DELETE | `/projects/:id` | — | `{ok:true}` |
| GET | `/projects/:id/artifact?key=` | — | `{artifact}` |
| PUT | `/projects/:id/artifact` | `{key, kind, content}` | `{artifact}` |
| GET | `/projects/:id/run` | `?after=` | 当前/最近 run + 增量事件；无 run → `{run:null}` |
| POST | `/projects/:id/run` | options | `{run}` 202 |
| POST | `/projects/:id/run/cancel` | — | `{run}` |
| GET | `/projects/:id/runs` | — | `{runs:[...]}` |
| GET | `/projects/:id/estimate` | — | `{estimate}` |
| POST | `/projects/:id/export` | `{format}` | `{export:{filename,path,mime,bytes}}` |
| GET | `/recipes` | — | `{recipes:[{id,title,paramsSchema,paramsDefaults,stages:[{id,title,each,review}],artifacts}]}` |
| GET | `/model` | — | `{available, provider, model, message?}` |
| POST | `/projects/:id/review/continue` | `{autoApprove?}` | 等价于 startRun({from: pendingReview.nextStages[0]}) |

- 路由解析：`path` 去掉 `/novel-forge` 前缀，按 `/` 分段；`:id` 允许 `p_xxx` 或前缀。
- body 上限 10MB；JSON 解析失败 → 400 `BAD_BODY`。
- 长任务不阻塞 HTTP：startRun 立即返回 run 快照。

### 5.3 novel_* 工具

全部 `execute` 返回 `{ok, ...}` 或抛错；`render` 输出中文多行文本（给对话里看）。参数 schema 用 JSON Schema，描述写清「什么时候用」。

| 工具 | 参数 | 行为 |
|---|---|---|
| `novel_list` | `{}` | 列项目：标题、进度、字数、最近更新 |
| `novel_create` | `{title?, premise, genre?, chapters?, wordsPerChapter?, tone?, pov?, styleGuide?}` | 建项目；返回 id + 预估调用数 |
| `novel_status` | `{project?}` | 阶段表、每章状态、字数、当前 run、审稿门 |
| `novel_read` | `{project?, key?, chapter?}` | key 如 `outline`/`bible`/`draft`；chapter 如 `ch03` 连同读 beats/draft/review/summary |
| `novel_write` | `{project?, key, content}` | 用户手改某产物（kind 沿用声明）；跑中拒绝 |
| `novel_run` | `{project?, from?, stages?, items?, autoApprove?}` | 启动后台 run，立即返回 runId + 预计耗时 |
| `novel_cancel` | `{project?}` | 取消当前 run |
| `novel_export` | `{project?, format:'markdown'|'epub'}` | 导出并返回路径 |

`project` 省略时用 `resolveProject('active')`。工具描述里写清「不要在没建项目时调用 novel_run」这类边界。

### 5.4 客户端面板

- 侧栏 `sidebar.panellist`：id `novel-forge.panel`，order 放在 mind-canvas 之后（用 55 左右），label 由 locale 决定；图标 icon.svg。
- 主区 `main`：key `novel-forge`。
- 进入面板 → `layout.selectPanel('novel-forge')`；返回对话 → `selectPanel(null)`。
- 视图状态机（app.jsx）：
  1. `list`：项目卡片（标题、类型、进度条「已写 3/24 章」、字数、最近更新、「继续」/「打开」/「删除」），顶部「新建长篇」。
  2. `create`：向导（一屏）：premise（大 textarea）、书名（可空）、类型、章数、每章字数、视角、文风、风格样本、审稿门开关；右侧实时预估（调用数、token 量级、预计时长）；「开始炼」→ 创建 + 立即 run（from premise）。
  3. `workbench`：左「阶段轨」（10 段，状态点/进度 n/m），中间内容区（默认总览：书名+logline+主题+进度；点阶段 → 该阶段产物），右侧「运行抽屉」（事件流、当前 item、进度条、取消）。
  4. 章节视图：点 outline 里某一章 → tabs「细纲 / 草稿 / 审校 / 摘要」，可编辑草稿（保存调 PUT artifact）。
- 轮询：run 进行中每 1200ms `GET run?after=seq`；停止后停轮询。用 `useEffect` + 清理。
- 渲染 markdown：`marked` + `DOMPurify.sanitize`（客户端 bundle 内）。
- 空态：没有项目时给一段说明 + 「用一句话开始」示例。
- 风格：宣纸底 `#f7f4ee`、墨色 `#1f1d1a`、朱砂点缀 `#b23a2f`、细边框、衬线标题（`Songti SC, Noto Serif SC, serif`），正文用系统无衬线；暗色跟随 `prefers-color-scheme`。整体安静、留白多，像书桌而不是仪表盘。

---

## 6. 测试与验收

### 6.1 单测（node --test）

- `store.test.mjs`：原子写、版本保留 3 份、坏 JSON、路径穿越拒绝、大小上限。
- `engine.test.mjs`：用 `mock` recipe（2 个 stage，一个 each，一个 review gate）验证——顺序执行、跳过已完成、显式重跑、item 失败继续/停止、取消、暂停/继续、dryRun、RUN_ACTIVE、恢复 interrupted。
- `novel-recipe.test.mjs`：outline 规范化（模型乱给 id → 重排 ch01…）、ledger 合并、craft 检查（黑名单/字数/对话比）、estimate 数值、export markdown 结构。**不调真模型**：用假 ctx 喂固定 artifact。
- `host.test.mjs`：fake req/res 走全部路由（含 404/409/400、鉴权拒绝、body 上限）；工具 execute 返回形状。
- 引擎的"零小说知识"断言：grep `src/forge/**` 不含 `novel|chapter|小说|章节`。

### 6.2 集成

- `dev/verify.mjs`：起本地 http 假宿主（返回固定 project/artifact/run），Playwright 加载 client.js，走「列表→新建→工作台→运行中→完成」四条路径，截图 `test/screens/{list,create,workbench,running}.png`；断言关键文案出现、控制台无 error。
- 真模型冒烟（手动/脚本，不急）：装进 profile，新建 6 章项目，from premise 跑完 outline 停下看质量。

### 6.3 完成定义（本轮）

1. `npm test` 全绿（≥ 30 个断言）。
2. `node dev/verify.mjs` 出 4 张截图，无 console error。
3. 插件能装进 `~/.dsh/profiles/desktop`，重载后侧栏出现「墨炉」，面板能打开。
4. `novel_list` / `novel_create` / `novel_run` 在真宿主里可用（至少 list/create）。
5. README 写清安装、用法、数据位置、已知限制。

---

## 6.4 实现偏差与裁决（v0.1.0 实际代码）

契约是设计稿，下面是落地时明确改过的地方，按「为什么」记录：

1. **`review` 支持函数**：`review: (project) => boolean`。小说 recipe 用它把审稿门绑到 `params.reviewGate`，而 `skip` 绑到 `params.autoReview`；两者独立，互不干扰。布尔形式仍兼容。
2. **`ctx` 读接口是同步的**：`has/read/text/json/list` 直接返回结果（`ARTIFACT_MISSING` 同步抛）。engine 在 run 开始时把产物读进内存缓存，写产物时同步更新；stage/prompt 里不需要 `await`。导出路径单独加载一次缓存。这样 11 个提示词 builder 和 recipe 的 `jsonOr/textOf` 都是纯同步拼接。
3. **`status: 'skipped'`**：`skip()` 命中时项目 stage 写 `skipped`（UI 显示「已跳过」），不是 `idle`；run 的 stage-end 事件同样带 `skipped`。
4. **`run.status: 'interrupted'`**：`recover()` 把进程重启后残留的 `running` run 标为 `interrupted`，不假装成功。
5. **`blurb` 是第 10 个 stage**：契约 §3.1 只列 9 个，实现多一个封面文案 stage（书名/卖点/简介/标签）。`manuscript` 不设 stage，导出时由 `export.js` 动态组装。
6. **大纲硬裁**：`outline` 产物按 `params.chapters` 裁前 N 章（模型多给就砍、少给不补），重排 `ch01…` 并挂回卷；stage note 标 `trimmed`。这样 draft 的 each 列表不会超出用户设定。
7. **导出别名**：`exportProject(id, 'md')` 等价 `'markdown'`；`novel_export` 同时接受两者。EPUB 用 `epub-gen-memory` 真打包。
8. **默认 recipe**：`createProject` 不传 `recipeId` 时取第一个注册的 recipe（当前即 novel），不再硬编码字符串 `'novel'`——引擎层保持零小说知识。
9. **LLM 来源标记**：`source.kind = 'dsh-forge'`、`sessionId = dsh-forge-<runId>`，同样是为了引擎通用化。
10. **`dryRun` 不模拟上游产物**：只校验 stage 声明与参数，不执行上游；对空项目直接 dryRun 会在 each 解析时报 `ARTIFACT_MISSING`。这是有意的——dryRun 的语义是「这次要跑什么」，不是「假装跑完」。
11. **取消的终态一次写入**：`cancelRun` 先置内存标记，`#finish` 一次性写 `run-end` + `cancelled`，避免客户端读到「已取消但事件流没有 run-end」的中间态。
12. **`recipe.stats(project, read)` 钩子**：引擎每跑完一个 stage 调一次，把返回值并入 `project.stats`（钩子抛错静默，不影响主流程）。引擎只懂「统计是一个对象」，小说知识（总章数、已写字数、去空白 CJK 数）留在 recipe。
13. **空文本自动加预算**：`LLM_EMPTY` 时网关把 `maxTokens` 逐次加倍（1000→2000→4000…上限 16000）再重试。真模型冒烟发现推理模型会把预算烧在 reasoning 上，导致空 `text-delta`；这条对任何 recipe 都成立。review 阶段另把预算从 2600 提到 4000。
14. **`blurb` 出口是 Markdown**：提示词写给人的封面文案（`# 《书名》`/一句话卖点/`## 简介`/`## 标签`），recipe 用 `parseBlurbMarkdown` 解析回 `{title,tagline,blurb,tags}` 再按 `blurbSchema` 校验。真模型冒烟最初按 JSON 解析，必然 `LLM_PARSE`；这是提示词与 recipe 的契约错位，不是模型问题。
15. **`GET /projects/:id` 返回 `project.artifacts` 摘要**；`GET /projects/:id/run` 在无 activeRunId 时回退到最近一次 run 的**完整**视图（含 events），否则完成后的首次打开会看到空事件流。
16. **侧栏 id 必须等于 `main` 的 key**：宿主点击侧栏项时按 id 去选 main panel。曾把侧栏 id 写成 `novel-forge.panel`、main key 写成 `novel-forge`，只有真实宿主会报 `main panel "novel-forge.panel" is not registered`（假 harness 不校验）。两处统一用 `novel-forge`。
17. **`GET /recipes` 兼容 `engine.recipes` 是 Map**：引擎把 recipe 存在 `Map<id, recipe>`，此前直接 `.map()` 在真宿主 500；路由层先取 `[...recipes.values()]`。

---

## 7. 非目标（本轮不做）

- 多用户/云同步/账号。
- 封面图生成、插图。
- 除 zh 外的提示词（en 留接口）。
- 除 markdown/epub 外的导出（docx 以后可加）。
- 自动发布到平台。
- 无限并发：一章一章写，慢就是快。
