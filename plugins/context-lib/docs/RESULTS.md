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
cd ~/Documents/deepseek-harness/default-workspace/context-lib
npm test
node build.mjs
```

真实库状态：在 agent 里跑 `context_lib_stats`；扫描：`context_lib_scan`（可带 `sourceId`、`force`）。
