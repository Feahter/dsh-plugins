# 墨炉 · Novel Forge

给 DeepSeek Harness 的小说全流程创作插件：**一句话故事核 → 设定 → 人物 → 大纲 → 细纲 → 草稿 → 连续性审校 → 修订 → 导出**。

底层是一个**通用创作流水线引擎**（`src/forge/`，不认识"小说"两个字），小说只是第一份配方（`src/recipes/novel/`）。第二个配方——短篇、剧本、播客脚本——只写 `src/recipes/<name>/` 就能接进来。

## 装

插件在 `dsh-plugins` 仓库的 `plugins/novel-forge/`。在 `~/.dsh/profiles/desktop/package.json` 里用 link 安装：

```json
{
  "dependencies": { "dsh-novel-forge": "link:/Users/you/Documents/deepseek-harness/dsh-plugins/plugins/novel-forge" },
  "dsh": { "profile": { "bundles": ["dsh-novel-forge"] } }
}
```

然后重载 DSH（或重启桌面端）。侧栏出现「墨炉」。

> 开发期改客户端代码后跑 `node build.mjs` 重新打包 `client.js`；宿主代码改动要重启桌面端才会生效（unmanaged bundle 不做热替换）。

![书架](docs/screens/shelf.png)

![工作台](docs/screens/workbench.png)

## 用

面板：

1. 「新建长篇」——一句话故事核 + 章数/每章字数/视角/文风，右侧实时预估调用量。
2. 「开始炼」——从故事核一路跑到大纲；开了「每步停下」会在大纲和草稿后暂停等你确认。
3. 工作台——左阶段轨看进度，中间看产物（大纲/人物/章节），右抽屉看实时事件；单章可切细纲/草稿/审校/摘要，草稿能直接改。
4. 导出——Markdown 或 EPUB，落在项目目录。

对话里（助手调用）：

| 工具 | 作用 |
|---|---|
| `novel_create` | 用一句话开书 |
| `novel_run` | 启动流水线（可 from/to/stages/items/force/dryRun） |
| `novel_status` | 看阶段进度、当前运行、待确认 |
| `novel_read` | 读设定/大纲/某一章的细纲草稿审校 |
| `novel_write` | 手改某个产物 |
| `novel_list` / `novel_cancel` / `novel_export` | 列表 / 取消 / 导出 |

## 数据

全部在本机，`$DSH_HOME/novel-forge/`（默认 `~/.dsh/novel-forge/`）：

```
projects/<id>/project.json        项目状态（参数、阶段、统计）
projects/<id>/artifacts/          所有产物（md/json），旧版本在 .versions/
projects/<id>/runs/<runId>.json   运行记录与事件
projects/<id>/exports/            导出文件
```

Markdown 就是纯文本，JSON 就是普通 JSON，随时可以直接看、直接改、直接进 git。

## 设计要点

- **一章一章写**：草稿阶段是串行的，每章写完立刻生成摘要，下一章带着上一章摘要 + 连续性账本 + 本章细纲写。慢就是快。
- **连续性账本**：审校阶段把事实、线索、人物状态、时间线合并进 `ledger`，后续章节和修订都读它。
- **确定性检查**：字数、段落、对话比、AI 腔黑名单、POV 越界在代码里查，不靠模型自觉。
- **可暂停、可改、可续跑**：所有阶段产物都在磁盘上；改完再跑会跳过已完成的部分，`force` 才重跑。
- **通用引擎**：stage 只有 `id/title/each/produces/review/run`，引擎只管顺序、事件、存储、取消、暂停。配方负责一切创作语义。

## 开发

```bash
npm install
node build.mjs          # 打包客户端 client.js
npm test                # 引擎/存储/recipe/宿主单测
node dev/verify.mjs     # Playwright + 假宿主，跑 UI 交互，截图到 test/screens/
node dev/e2e.mjs        # 真 HTTP 宿主 + 真引擎 + 真 client.js 的端到端（假 LLM）
node dev/mount-check.mjs # 临时 DSH_HOME 起真 dsh web，验证侧栏挂载与 /recipes
```

## 已知限制

- 只实现中文提示词（`prompts/en.js` 留了接口）。
- EPUB 不含封面图。
- 一章一章串行写，24 章 × 3000 字大约要跑一阵；中途可取消，已完成章节保留。
- 长上下文有上限：喂给模型的账本/人物速查会按预算截断（见 `docs/architecture.md` §4.3）。
- 推理模型偶发把 token 全花在思考上，返回空正文；网关会自动加倍预算重试（最多 3 次），仍空则记 `LLM_EMPTY`。
- 0.1.0 的 review/blurb 修复需要重启宿主进程后才会生效（插件是 ESM 模块，运行中不热替换）。
