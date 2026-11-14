# dsh-context-lib · 上下文资源库

把设备上的文档、脚本、图片、数据、会话登记成一个可检索、可管理的**本机资源库**，同时供给两种消费者：

- **agent**：9 个 `context_lib_*` 工具 + 每轮注入的资源库简报，先查库再联网；
- **人**：侧栏「资源库」面板，像文件管理器一样浏览、检索、编辑、回收站。

它不搬动你的文件：扫描来源只建索引（linked），原文件留在原地；只有你手写的笔记才会落进库目录。删除 linked 条目只移除索引，绝不删原文件。

## 能力

| 能力 | 说明 |
| --- | --- |
| 自动整合 | 扫描来源目录（默认 workspace / ~/Documents / ~/.dsh），按扩展名归类 doc / script / image / data，解析 frontmatter 标题标签、`[[wiki]]` 链接 |
| 检索 | AND 关键词 + 字段加权（标题 > 标签 > 归类 > 路径 > 摘要），中文整词支持，类型 / 归类 / 标签 / 来源过滤 |
| 文件管理 | 浏览、详情、行范围读正文、改标题标签归类、软删 / 恢复 / 彻底删除、原始字节与缩略图预览 |
| 格式预览 | docx/rtf/odt 用 `textutil` 转文本，html 剥标签，pdf/xlsx/ppt/key/pages 用 `qlmanage` 出 PNG 缩略图（缓存到 `<root>/cache/thumbs`） |
| 展示形式 | 列表 / 卡片 / 表格 / 图库四视图，工具栏下拉切换（选择记在 `localStorage` 的 `clib:view`）；表格可按标题 / 大小 / 时间点表头排序，图库只铺图片；Markdown 笔记与 `ext=md` 条目在详情里可切「渲染 / 源码」，渲染器是自带的 94 行轻量实现（只用 React 文本节点，不用 `innerHTML`、不引依赖）；预览可一键全屏（Esc / 点遮罩 / 右上按钮退出，内容在卡片内滚动） |
| 智能助手 | 右侧抽屉三页：**总结**（选中条目 → 摘要 + 建议标题 / 归类 / 标签，逐项应用）、**整理**（当前筛选前 15 条 → 归类与标签建议表，逐行或全部应用，失败行保留错误）、**提问**（自然语言 → 回答 + 可直接套用的检索过滤条件）。走宿主 `llm` + agent 默认模型，不另配密钥；未就绪时显示原因并禁用提交 |
| 找原文件 | 详情里一键**复制路径**，或**在访达中显示**（macOS `open -R` 直接选中原文件；不经 shell，路径含空格引号也安全） |
| agent 上下文 | 工具读写 + 运行时简报（条目数、归类、最近更新），集合打包 `context_lib_pack` 一次加载一个主题 |
| 会话 / 记忆 | `kind=session` 与 `collection` 可把会话摘要、记忆片段按主题归档，供后续对话复用 |

## 多实例

库以 `index.json` 为准，进程内带缓存；每个操作前会比对文件 `size:mtime`，发现被别的进程（另一个 dsh 实例、直接跑 `src/store.js` 的脚本）改过就重新加载，不会用旧快照把外部写入覆盖掉。

## 安装

```bash
# 1. 作为 link 依赖装进 profile
dsh plugin --profile desktop add link:$HOME/Documents/deepseek-harness/dsh-plugins/plugins/context-lib

# 2. 确认 profile 的 package.json 里 dsh.profile.bundles 含 "dsh-context-lib"
# 3. 重启 GUI（或 dsh web）加载新插件
```

卸载：`dsh plugin --profile desktop remove dsh-context-lib`，并从 `dsh.profile.bundles` 去掉一行。

## 配置

`cordis.patch.yml` 里可覆盖，全部有默认值：

```yaml
- id: context-lib
  name: 'dsh-context-lib'
  config:
    rootDir: ~/.dsh/context-lib     # 索引与笔记的落盘位置
    briefing: context                # context=每轮注入简报；off=关闭
    protocolSection: true            # 是否注入工具用法段
    autoScan: false                  # 加载时后台增量扫一遍全部来源（默认关，避免启动即遍历大目录）
    maxEntries: 20000
    maxPreviewChars: 1200
```

## 工具

| 工具 | 用途 |
| --- | --- |
| `context_lib_search` | 检索条目，返回 id / 类型 / 归类 / 标签 / 摘要 |
| `context_lib_read` | 读正文（可给 `startLine`/`endLine`）；docx/rtf/odt/html 自动转纯文本；pdf/xlsx 返回缩略图地址与本机路径；图片返回路径供 `read_image` |
| `context_lib_put` | 新建 markdown 笔记 |
| `context_lib_update` | 改标题 / 标签 / 归类 / 备注；笔记可改正文 |
| `context_lib_delete` | 软删（默认）或 `purge=true` 彻底删除 |
| `context_lib_scan` | 增量扫描来源目录 |
| `context_lib_stats` | 条目数、类型分布、归类、来源概况 |
| `context_lib_sources` | 列出 / 添加 / 移除扫描来源 |
| `context_lib_pack` | 把一个归类拼成一段可直接读的上下文 |

## 落盘布局

```
~/.dsh/context-lib/
  index.json        条目索引（原子写，保留 .bak）
  sources.json      来源目录
  notes/<id>.md     手写笔记正文
  blobs/ab/cd/<sha> 需要复制的二进制（当前 scan 不复制，保留给导入）
  scan.lock         扫描互斥
```

## HTTP API

前缀 `/api/context-lib`，同一套鉴权（`connection.requestRejection`），失败关闭。统一包络 `{ok:true,data}` / `{ok:false,error:{message,code,hint?}}`。完整契约见 [docs/API.md](docs/API.md)。

## 开发与验收

```bash
node build.mjs                    # 构建 client.js（esbuild，57 KB）
node --test test/store.test.mjs   # 数据层：索引/检索/扫描锁/回收站（12 项）
node test/client-smoke.mjs        # 浏览器半片：在 Node 里加载 client.js，校验槽位注册
node .verify-host.mjs             # 宿主半片：9 工具 + HTTP 路由 + 简报（stub ctx，32 项）
npm test                          # 上面三项一起跑
```

## 边界

- 只索引白名单扩展名，跳过 `node_modules` / `.git` / `dist` 等；单文件 > 8MB 只记元数据，不抽正文。
- 不修改、不移动被扫描的原文件；purge 只清索引与库内副本。
- 二进制条目不进上下文，只给路径，交给 `read_image` 或系统工具。
