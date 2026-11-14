# dsh-context-lib · 交付结果（before / after）

本文件记录 `dsh-context-lib` 插件交付时**实测**的数据。所有数字都能用文末命令复现；未验证项单独列出，不混进结论。

## 1. 改变了什么

| | 交付前 | 交付后 |
| --- | --- | --- |
| 本机文档/脚本/图片 | 散落在 `~/Documents`、`~/.dsh`、工作区，没有统一索引 | 1695 条登记进 `~/.dsh/context-lib/index.json` |
| agent 找本地资料 | 只能 `grep` / `glob` / `read` 逐个目录翻 | 9 个 `context_lib_*` 工具：检索、读正文、写入笔记、改标签、扫描、统计、来源、打包 |
| 上下文注入 | 无 | 每轮系统提示注入 `## Context library（本机资源库）`（order 132，实时统计 + 最近 4 条），TUI 与 Web 一致 |
| 人管理资料 | 只能开 Finder | Web 面板：来源/归类/标签树 + 检索列表 + 详情编辑 + 回收站 |
| 会话/记忆/wiki | 各自为政 | note 条目（`storage:'note'`）、`pack(collection)` 打包、`[[wiki]]` 链接解析，供 session / 记忆 / wiki 共用一套索引 |

## 2. 实测数字（2026-11-13，本机）

- **索引规模**：1695 条 · 46.9 MB。文档 547 / 数据 820 / 脚本 121 / 图片 206 / 笔记 1。
- **扫描吞吐**：`src_workspace` 333 个文件 0.4 s；`src_dsh` 1361 个文件 1.5 s；增量重扫 333 个文件全部命中 `unchanged`（0 新增）。
- **检索**：`q='资源库'` → 7 条命中，带中文 snippet；`q='sdk note'` → 24 条。
- **写入回读**：`context_lib_put` 建笔记 `cl_be21460c7a7e`（collection `verify`），`context_lib_read` 原样读回。
- **注入**：Web GUI 会话的系统提示实测出现该段落，且内容随库变化（1694 → 1695 条即时反映）。
- **构建**：`client.js` 58,754 B，`window.__ModuleLoader__.load({id:"dsh-context-lib"})` 包装，react 走 external。

## 3. 自动化验收（全部通过）

```
node --test test/store.test.mjs   →  tests 12 / pass 12 / fail 0
node test/client-smoke.mjs        →  client smoke passed: 2 slots, 1 dictionary/locale registrations, 60363 bytes
node .verify-host.mjs             →  33 passed, 0 failed
```

`npm test` 串联以上三项。`test/store.test.mjs` 覆盖索引/检索计分/分页/扫描增量/锁/回收站/来源/打包/错误码；`.verify-host.mjs` 用 stub ctx 覆盖 9 个工具、17 条 HTTP 路由（含 `POST /items/:id/reveal` 的三条拒绝分支）、鉴权 fail-closed、404/405、简报与未知配置键；`client-smoke.mjs` 在 Node 里以假 `__ModuleLoader__` 加载打包产物，断言两个槽位与 zh 字典注册。

## 4. 未验证 / 已知边界

- **没有真实浏览器的点击级 E2E**：GUI 需要 cookie 认证，headless 截图被登录页拦住；临时实例的页面因 SSE 长连接不进入 idle，截图超时。面板的「能渲染、能点」目前只有打包产物 + 槽位注册 + 静态路由核对三重证据，没有截图。
- PDF / docx 等非图片二进制：详情区只能显示元数据与本机路径，不抽正文。
- `locale/*.json` 未参与打包（字典在 `client-src/strings.js` 里内联）。
- 自动增量扫描默认关闭（`autoScan:false`）：打开后每次加载会扫真实家目录，首次加载明显变慢；需要时在 `cordis.patch.yml` 里开。
- 「在访达中显示」的成功路径没有在自动化里真跑（`open -R` 会在你屏幕上弹访达窗口，不适合放进测试）；测的是三条拒绝分支：笔记无路径 404、条目不存在 404、原文件被移走 404（`.verify-host.mjs` 会把临时文件改名再改回）。

## 5. 复现命令

```bash
cd ~/Documents/deepseek-harness/dsh-plugins/plugins/context-lib
npm test
node build.mjs
```

真实库状态：在 agent 里跑 `context_lib_stats`；扫描：`context_lib_scan`（可带 `sourceId`、`force`）。

## 6. 0.2.0：更多展示形式 + 智能助手

### 6.1 增量

| 项 | 0.1.0 | 0.2.0 |
| --- | --- | --- |
| 列表视图 | 单一列表（`PAGE=50` 分页） | 列表 / 卡片 / 表格 / 图库，四视图共享选中态、加载态、空态与「加载更多」，选择存 `localStorage.clib:view` |
| 详情预览 | 纯文本 `pre` + 行号 | 同上；`kind=note` 或 `ext=md` 追加「渲染 / 源码」切换，渲染器 `client-src/markdown.js`（94 行，0 处 `innerHTML`） |
| 智能助手 | 无 | 右侧抽屉三页（总结 / 整理 / 提问），后端 `src/assist.js`（367 行），两条路由 `GET /assist/status`、`POST /assist` |
| 后端文件 | `index.js` 1111 行 | +12 行（路由接线 + 两个错误码映射），新逻辑全在 `src/assist.js` |
| 前端 | app.jsx 941 / style.js 367 / strings.js 263 行 | app.jsx 1141 / assist.jsx 387 / markdown.js 94 / style.js 556 / strings.js 381 行（zh + en 各 168 键） |
| 打包产物 | `client.js` 58,754 B | `client.js` 95,573 B |
| 自动化 | 12 + smoke + 33 | 13 + smoke + 44 |

### 6.2 实测验收（全部通过）

```
npm test                                    → exit 0
node --test test/store.test.mjs             → tests 13 / pass 13 / fail 0
node test/client-smoke.mjs                  → client smoke passed: 2 slots, 1 dictionary/locale registrations, 95509 bytes
node .verify-host.mjs                       → 44 passed, 0 failed
```

`npm test` 串联三项。智能助手新增 11 条路由测试：status 有 / 无 `llm`、summary 成功 / 404、organize 只保留输入里存在的 id、ask 丢弃非法 filter、mode 非法 400、模型输出非 JSON 502、模型流报错 502、有 `llm` 但无默认模型 503、无 `llm` 503。

静态核对（脚本跑在 `/tmp`，不入库）：`t()` 引用的 141 个键在 zh / en 两个字典里都存在，两字典键集合完全一致（各 168）；JSX 引用的 `clib-*` 类名 129 个在 `style.js` 都有定义（6 个疑似缺失的是 `htmlFor`/`id` 属性，不是类名）；打包产物含 `clib-cards` / `clib-gallery` / `clib-table` / `clib-assist` / `assist/status` / `clib:view` / `clib:assist` 七个新标记。

### 6.3 未验证 / 已知边界（0.2.0 新增部分）

- **面板视觉与交互仍无真实浏览器证据**：本机 profile 里没有 react / react-dom / jsdom（`require.resolve` 实测），GUI 又有 cookie 认证，四条视图的实际排版、抽屉的覆盖层、Markdown 渲染后的观感都只经过代码审阅与打包产物核对。要真看，刷新 GUI 打开资源库面板自己点一遍。
- **真实模型未联调**：`POST /assist` 的全部断言都跑在 stub `llm` 上，真 Harness 的 `llm.prepareCall` / `stream` 只按 dsh-media-desk 的已验证写法对齐，没有一次真实生成。
- 90 秒超时只有代码路径（`AbortController` + `finally` 清理），测试里没有真等 90 秒。
- 「整理」的 `applyAll` 在闭包里读旧的 `rows` state，连点两次「全部应用」可能对已完成项重复 PATCH（PATCH 幂等，无数据后果）。
- 抽屉是 `.clib-body` 内的绝对定位覆盖层（浮于详情、随面板滚动），不是视口 `fixed`。

### 6.4 二轮（0.2.0 收尾：下拉视图、全屏预览、助手报错人话）

用户反馈三件事：助手抽屉显示英文 `Unknown route: GET /assist/status`；视图切换要收成下拉；预览要能全屏。

| 项 | 0.2.0 首版 | 二轮 |
| --- | --- | --- |
| 视图切换 | 工具栏四段 `clib-seg-btn` | 原生 `select.clib-select`（`aria-label=viewLabel`），助手按钮保留 |
| 预览 | 仅面板内小窗 | 追加 `.clib-fs` 覆盖层全屏（Esc / 点遮罩 / 右上按钮退出，内容在 `.clib-fs-body` 内滚动，打开聚焦关闭钮、关闭回焦全屏钮） |
| 助手 404 | 英文原文直出 | `assist.jsx` 的 `friendlyError` 识别 `code === 'not-found' && /Unknown route/` → 显示 `assistNeedsRestart`（「助手接口尚未加载，重启 GUI 后可用」） |
| 前端行数 | app.jsx 1141 / style.js 556 / strings.js 381 | app.jsx 1217 / style.js 619 / strings.js 387 / assist.jsx 391 |
| i18n 键 | zh + en 各 168 | zh + en 各 171（`previewFullscreen` / `previewFullscreenExit` / `assistNeedsRestart`） |
| 打包产物 | `client.js` 95,573 B | `client.js` 101,457 B |

验收（二轮重跑）：

```
node build.mjs                 → built dsh-context-lib client.js — 99.1 KB
node test/client-smoke.mjs     → client smoke passed: 2 slots, 1 dictionary/locale registrations, 101385 bytes
npm test                       → exit 0（store 13 / 13，verify-host 44 / 0）
```

静态核对：zh / en 各 171 键零差异、`t()` 引用 144 键全存在、`style.js` 花括号配平 0、`dangerouslySetInnerHTML` 0 处、`app.jsx` 无 JSX。

**报错根因与处置**：`Unknown route` 是宿主进程的兜底 404（`index.js:849`），说明跑着的宿主加载的还是旧版 `index.js`——前端 `client.js` 会随页面刷新更新，后端模块只在进程启动时 import。处置：用 `plugin_manager` 把 `include:context-lib` 停用再启用（`set_plugin` 两次，均返回 `application: applied`），让 profile 重新 import 插件。若启动器仍缓存模块，则需重启 App 才彻底生效。
