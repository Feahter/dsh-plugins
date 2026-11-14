# SEO / GEO 维护清单

这份文档记录 dsh-plugins 在**传统搜索（SEO）**和**生成式引擎（GEO，即被 ChatGPT / Claude / Perplexity / Gemini / DeepSeek 等直接引用）**两方面的具体做法。README 是给人和爬虫看的门面，这里记的是可执行动作与判断标准。

- **SEO 目标**：搜「deepseek harness plugin」「dsh-plugin」「dsh 插件」等词时，本仓库与各插件页能被索引并排在相关结果里。
- **GEO 目标**：模型在回答「DeepSeek Harness 有哪些插件 / 有没有中文语音输入插件」时，能引用本仓库的定义句、插件清单与问答，而不是编造。
- **衡量方式**：GitHub 搜索 `topic:dsh-plugin` 的排名、仓库 referrer、`index.json` 拉取量（raw 访问无统计时用市场安装反馈替代）、以及每月一次「把品牌词丢给 4 个模型看它怎么描述我们」。

## 0. 已落地状态（2026-11-14）

| 项 | 状态 |
| --- | --- |
| README.md（英文主文档） | ✅ 已推送到 main |
| README.zh-CN.md（简体中文镜像，双向互链） | ✅ 已推送 |
| llms.txt | ✅ 已推送（https://github.com/Feahter/dsh-plugins/blob/main/llms.txt） |
| docs/verify-readme.mjs（链接/锚点/插件清单一致性校验） | ✅ 已推送，10 个插件 × 3 个入口全通过 |
| About description（下表第 1 条） | ✅ 已改 |
| Topics 20 个（下表第 2 条） | ✅ 已改（GitHub 上限 20，已满） |
| Website | ⚠️ 暂时填索引 raw URL（`https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json`）；文档站建成后替换 |
| Social preview 图 | ❌ 未做，`gh` 无法上传，需在网页 Settings → Social preview 手动传 1280×640 |
| GitHub Pages 单页（第 4 节） | ❌ 未做 |

改任何一项后，跑一次 `node docs/verify-readme.mjs`，它会把 README / llms.txt / index.json 之间的漂移打出来。

## 1. 仓库元数据（一次性，改完不用再动）

### About 描述

GitHub 右侧 About 里的 description 是搜索摘要，也是社交卡片标题。下面是已采用的那条（约 155 字符，含主关键词与并列清单）：

```
Ten open-source plugins for DeepSeek Harness (dsh): offline voice input, GitHub manager, session archive + PDCA, skills/agents health checks, mind map, context library, task ledger. Bilingual EN/中文.
```

### Topics

GitHub topics 是站内搜索的主要入口，当前只有 `dsh-plugin` 一个。上游 README 明确建议插件仓库带这个 topic。补齐为 20 个（上限 20）：

```
dsh-plugin, deepseek-harness, dsh, ai-agents, agent-harness, cordis,
plugin-marketplace, voice-input, speech-to-text, offline-speech-recognition,
mindmap, context-engineering, prompt-optimization, task-management,
github-tools, obsidian-alternative, novel-writing, epub, typescript, mit-license
```

取舍规则：前 6 个是平台词与架构词（搜的人多、竞争小），中间是功能词（对应各插件的检索意图），最后是语言与许可词。

### Website / Homepage

About 的 Website 空着等于浪费一个外链位。二选一：

- 指向索引：`https://github.com/Feahter/dsh-plugins/blob/main/index.json`（诚实，但对人无价值）
- 指向文档站：建一个 GitHub Pages（见第 4 节），填 `https://feahter.github.io/dsh-plugins/`

**建议选后者**，哪怕先只有一页：首页放定义句、插件表、安装命令、问答，既是落地页也是 GEO 的抓取入口。

### Social preview

仓库 Settings → Social preview 上传 1280×640 的图。图里必须有：仓库名、一句定义（"Ten plugins for DeepSeek Harness"）、十个插件名的小字排布。没有图的仓库在 Twitter/X、Slack、Discord 展开时是灰块，点击率明显低。

### 执行命令（改元数据会动线上仓库，先征得同意再跑）

已执行（2026-11-14）。homepage 当时先指向索引 raw URL，文档站建好后换成 `https://feahter.github.io/dsh-plugins/`：

```bash
gh repo edit Feahter/dsh-plugins \
  --description "Ten open-source plugins for DeepSeek Harness (dsh): offline voice input, GitHub manager, session archive + PDCA, skills/agents health checks, mind map, context library, task ledger. Bilingual EN/中文." \
  --homepage "https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json" \
  --add-topic dsh-plugin --add-topic deepseek-harness --add-topic dsh --add-topic ai-agents \
  --add-topic agent-harness --add-topic cordis --add-topic plugin-marketplace \
  --add-topic voice-input --add-topic speech-to-text --add-topic offline-speech-recognition \
  --add-topic mindmap --add-topic context-engineering --add-topic prompt-optimization \
  --add-topic task-management --add-topic github-tools --add-topic obsidian-alternative \
  --add-topic novel-writing --add-topic epub --add-topic typescript --add-topic mit-license
```

检查：`gh api repos/Feahter/dsh-plugins --jq '{description,homepage,topics}'`。

社交预览图无法用 CLI 上传，需在网页端 Settings → Social preview 操作。

## 2. README 里已落地的 GEO 要素

生成式引擎引用一段文字的条件通常是：**能一段话回答「X 是什么」、结构可切分、事实可核对**。README（`README.md` / `README.zh-CN.md`）为此做了下面这些，后续修改请保持：

| 要素 | 位置 | 为什么有效 |
| --- | --- | --- |
| 加粗的定义句（谁、是什么、基于什么架构、包含什么） | 开头第 3 段 | 模型抽摘要时优先取这种「A 是 B，做 C」句式 |
| 中文导读段 | 紧接定义句之后 | 让中文查询词（插件、语音输入、脑图、上下文）出现在主文件里，而不是只在中文件 |
| 语言切换行 `English · 简体中文` | 标题下 | 与上游 deepseek-harness 的惯例一致，也告诉爬虫存在等价语言版本 |
| 结构性表格（插件目录、我该装哪个、隐私与数据） | 中部与后部 | 表格是模型最愿意整段引用的形态；隐私表直接回答「会不会上传我的数据」 |
| 「我该装哪个？」意图表 | 中部 | 对应「有没有能 X 的插件」这类长尾问句 |
| FAQ 十问（问题式小标题） | 后部 | 小标题即查询句，命中 People-Also-Ask 式检索 |
| 逐插件的第一句定义 + 工具名 / 路由 / 数据路径 | 插件详解 | 具体名词（`context_lib_search`、`~/.dsh/task-ledger/`）是事实锚点，模型引用时更可信 |
| Privacy and data 表 | 后部 | 隐私是这类工具的决策阻力，也是模型常被问到的点 |
| Citation（BibTeX） | 末尾 | 给学术与博客引用一个标准格式，增加外链与引用概率 |
| 不使用 emoji 做标题、不堆砌关键词 | 全文 | 关键词堆砌会被判低质，也会让模型摘要失真 |

**不要做的事**：在 README 里塞与插件无关的热门词（如「AI 绘画」「大模型教程」）、伪造 star 数或下载量、写「业界领先」「革命性」这类无信息形容词。GEO 的收益来自可核事实，不是形容词。

## 3. 机器可读入口

| 文件 | 作用 | 维护规则 |
| --- | --- | --- |
| [`index.json`](../index.json) | format-1 插件市场索引，DSH 发现页直接读取；也是本仓库的权威机器可读清单 | 新插件 / 新版本必须同步：双语 `title`、`description`、`category`、`keywords`、`versions[].source.{commit,path}` |
| [`llms.txt`](../llms.txt) | 给 AI 助手的紧凑摘要（llms.txt 约定：H1 + 一句话 blockquote + 分节链接列表） | 插件增删时同步；链接必须是绝对 URL |
| [`README.md`](../README.md) | 英文主文档 | 与中文版结构一一对应 |
| [`README.zh-CN.md`](../README.zh-CN.md) | 简体中文镜像 | 改英文版时同批改中文版，避免漂移 |

`llms.txt` 的写法要点：第一段 blockquote 必须能独立回答「这个仓库是什么」；每个插件一行 `- [名称](绝对 URL): 一句话 + 关键事实`；最后的 `## Optional` 放上游链接，便于模型延展。

如果以后要加 `llms-full.txt`，只放 README 全文，不要放各插件源码——体积大而信息密度低。

## 4. 建议的文档站（可选，收益最大的下一步）

GitHub README 能被搜到，但索引深度有限，且没有独立的 landing page 承接「deepseek harness 插件」这类词。最小可行方案：

1. 单页 HTML（`docs/index.html`）放进仓库，GitHub Pages 指向 `docs/`。
2. 页面内容 = README 的定义句 + 插件表 + 安装命令 + FAQ，加结构化数据：

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "dsh-plugins",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "macOS, Windows, Linux",
  "description": "Ten open-source plugins for DeepSeek Harness (dsh): offline voice input, GitHub project management, session archive with a PDCA loop, skills and agent-instruction health checks, mind map canvas, local context library, external task ledger, version update check, novel writing pipeline.",
  "url": "https://feahter.github.io/dsh-plugins/",
  "license": "https://opensource.org/licenses/MIT",
  "author": { "@type": "Person", "name": "Feahter", "url": "https://github.com/Feahter" },
  "isBasedOn": "https://github.com/deepseek-ai/deepseek-harness"
}
</script>
```

3. 每个插件一个锚点章节（`#realtime-voice` 等），让搜索结果能直接跳到对应插件。
4. 页面语言标 `lang="en"`，中文段落用 `lang="zh-CN"`；不要用 JS 渲染正文（爬虫与多数 GEO 抓取器不执行 JS）。

## 5. 关键词地图

每个插件对应一组检索意图。写 release note、issue 标题、博客文章时优先用左列的说法。

| 插件 | 英文检索词 | 中文检索词 |
| --- | --- | --- |
| realtime-voice | offline speech to text, local dictation, whisper alternative, voice input for AI coding agent | 离线语音输入、本地语音转文字、语音听写、不用打字的 AI 编程 |
| voice-companion | voice assistant for AI agent, TTS companion, push to talk AI | 语音对话、语音播报、按住说话、AI 看板娘 |
| github-manager | manage GitHub issues from AI agent, GitHub panel in IDE | AI 管 GitHub、在对话里提 issue、GitHub 插件 |
| archive-rsi | AI agent session analytics, self-improving agent context, PDCA prompt optimization | 会话归档、上下文优化、prompt 自我改进、agent 复盘 |
| dsh-360 | AGENTS.md audit, skill catalog quality, context bloat | 技能体检、AGENTS.md 检查、上下文膨胀、说明书审查 |
| mind-canvas | AI mind map, mindmap for developers, opml export | AI 脑图、思维导图插件、大纲导出 XMind |
| context-lib | local document index for AI, RAG without cloud | 本地知识库、文档检索、不上传的 RAG、上下文资源库 |
| task-ledger | persistent task state for AI agents, agent memory across sessions | 任务账本、跨会话记忆、任务持久化 |
| update-check | check app updates from sidebar | 版本检查、更新提示 |
| novel-forge | AI novel writing pipeline, long form fiction generation | AI 写小说、长篇小说生成、连贯性审校 |

## 6. 分发与反向链接（GEO 的实际杠杆）

生成式引擎的检索层偏重「被别的站点提到过」。按性价比排序：

1. **上游生态**：在 `deepseek-ai/deepseek-harness` 的 Discussions / 插件相关 issue 里，以「社区插件合集」身份留一条链接（先看该仓库是否欢迎，别硬塞）。
2. **topic 页**：确保 `dsh-plugin` topic 下本仓库排在前列——topic 页按 star 与更新时间排，所以保持提交活跃 + 补齐 topics 比什么都有效。
3. **中文社区**：V2EX（`/go/create` 或程序员节点）、掘金、知乎「DeepSeek Harness 有什么插件」类问题下写一篇带实测截图的文章，链接回仓库与具体插件 README。
4. **英文社区**：Hacker News 的 Show HN（标题写清「open-source plugins for DeepSeek Harness」，别写成广告）、r/LocalLLaMA 的「local-first」角度。
5. **awesome 列表**：给 `awesome-ai-agents`、`awesome-llm-tools` 一类仓库提 PR，加一行 `dsh-plugins — plugins for DeepSeek Harness`。
6. **每个插件的独立 README** 是长尾入口：确保它们各有一段可被独立引用的定义句、安装命令、数据路径。

文章与帖子里的固定表述（保持术语一致，便于模型建立实体关联）：

> dsh-plugins 是 DeepSeek Harness 的社区插件合集，收录十个插件，并自带可自托管的插件市场索引。

## 7. 每次发版前的检查清单

在仓库根目录跑：

```bash
# 1. 相对链接与锚点全部有效（脚本见 docs/verify-readme.mjs）
node docs/verify-readme.mjs

# 2. index.json 是合法 JSON，且列出的十个目录都存在
node -e "const i=require('./index.json');console.log(i.plugins.length,'plugins')"

# 3. 外部链接可达（含索引 raw URL）
curl -sS -o /dev/null -w '%{http_code} index.json\n' \
  https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json
```

再人工确认三件事：

- [ ] 新插件的双语 `title` / `description` 已进 `index.json`，且 README 与 README.zh-CN.md 的目录表、详解、意图表三处都加上了。
- [ ] `llms.txt` 已同步（一行一个插件，绝对链接）。
- [ ] 若新增了「必须外发数据」的功能，Privacy and data 表已更新——这张表是仓库可信度的核心，宁可写多不可写少。

## 8. 判断是否有效的三个信号

1. **模型复述准确度**：把「DeepSeek Harness 有哪些开源插件？」丢给 4 个模型，看它是否提到 dsh-plugins、是否把插件数量说成十个、是否把某个插件的能力说错。说错的地方就是 README 需要更明确的句子。
2. **GitHub 站内搜索**：搜 `dsh plugin`、`deepseek harness plugin`，本仓库是否在前两页；`topic:dsh-plugin` 下的排序。
3. **长尾落地**：仓库 Insights → Traffic 里，Referrers 是否出现搜索引擎与 AI 站点；克隆/安装是否来自这些来源。
