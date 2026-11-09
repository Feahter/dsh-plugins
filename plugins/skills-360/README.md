# Skills 360

> 给本机所有 Agent Skill 做一次 **360° 体检**：catalog 里能不能被按需选中、加载后是不是一次灌进几万字（渐进披露）、读完能不能照做（可执行性）、有没有说清什么时候别用（边界）、链接和占位还活着吗（维护卫生），以及真实调用里的教训有没有沉淀成下一次能按需读到的经验（持续进化）。
> 体检报告可读、扣分有证据、建议能一键应用，**所有写入都有备份，可撤销**。


## 它解决什么问题

DSH 的技能目录只把 `name + description` 注入每次会话；技能正文只有在模型调用 `skill` 工具时才整篇加载。于是两个成本同时存在：

1. **固定成本**：每个启用技能的描述都常驻 catalog。描述太长、触发词太弱、和邻居重复，都会让路由变差。
2. **触发成本**：一旦加载，`SKILL.md` 整篇进入上下文。60KB 的入口不是“资料全”，是“每次触发都贵”。

Skills 360 把这两件事变成可量化、可执行的检查：

| 维度 | 权重 | 它看什么 |
|---|---|---|
| 按需加载 | 20 | 描述触发句式/触发词密度/前 160 字符、真实会话里是否被按需加载、与邻居的触发重叠、目录常驻成本。**判加载路径，不判内容价值** |
| 渐进披露 | 25 | 入口 tokens/行数、references 是否外置并接进入口、**是否有按需索引**、分层结构、内联代码堆积；超大入口有硬上限 |
| 可执行性 | 20 | frontmatter、编号步骤/命令、示例、决策分支与反模式 |
| 边界与治理 | 15 | “何时不用”、与兄弟技能的分工、中英触发覆盖 |
| 维护卫生 | 10 | TODO/占位、失效链接、危险命令/密钥痕迹、重复标题与异常体积 |
| 持续进化 | 10 | 加载后的纠错/报错/重复加载/追问是否沉淀成 `references/lessons.md`，并接回入口；经验的新鲜度与信号闭环 |

完整阈值与公式见 [RUBRIC.md](RUBRIC.md)。报告里每条扣分都带证据（行号/原文/统计/会话信号），并给出置信度；样本不足时不会硬扣“零加载”。

### 为什么把“按需价值”改成“按需加载”

旧口径把“使用次数、唯一性、目录成本”打包成一个叫“按需价值”的分数，容易被读成“用得少=没价值”。v0.2 起这一维只回答**加载路径是否成立**：

- catalog 里选得中（触发面）→ 真实会话里确实被按需加载过（证据）→ 触发不歧义（唯一性）→ 空闲成本合理（目录成本）。
- 零加载只会得出“窗口内没有发生按需加载”，并提示核对真实说法或邻居抢触发；**不推断内容价值**。
- “价值”不再是一个维度分数，而是由使用证据、组合成本与人的判断共同决定。

## 面板

安装后在左侧栏点 **Skills 360**（图标：仪表盘）。顶部是组合体检：

- 技能数、平均分、A/B/C/D 分布
- **catalog 固定成本**（每次会话固定注入的 token 估算）
- **全量加载成本**（若把所有 `SKILL.md` 全加载一次）
- 零按需加载、描述截断、失效链接、重叠对、危险模式、待进化清单

左侧列表可按分数、等级、结论、来源、严重问题筛选；右侧详情给出六维得分、指标、发现、可执行建议和重叠对象。

## 持续进化（v0.2 新增）

这不是“再给个分数”，而是把**真实调用变成下一次加载的经验**：

1. **挖信号**：扫描本机会话日志，只看技能加载后 120 分钟内发生的事——用户纠错（“不对/应该是/我是说”）、工具 `isError`（带失败工具名）、同一会话重复加载、加载后追问、失败回合；更晚的会话事件不归因，避免把无关任务的错误算到技能头上。另取加载前的最后一条真实用户请求，校验描述触发词是否覆盖用户的说法（`promptRecall`）。
2. **出提案**：`skills360_evolve`（或面板）给出待闭环技能清单，附证据（时间 + sessionId + ≤160 字摘要）和一条经验草稿：`触发：<证据> → 做法：<待你补>`。
3. **写经验**：确认后写入 `<skill>/references/lessons.md`，并自动把该文件接进 `SKILL.md` 的“参考资源”。下次加载技能时，模型能看到入口链接并按需读取。
4. **再评分**：`evolution` 维度检查经验数、新鲜度、是否接入口、是否晚于最近信号；持续进化的技能得分上来，长期不沉淀的停在低位。

原则：**证据由插件给，经验文字由你/模型写**。插件不会自动编造“做法”，也不会静默改正文；写入前备份，可撤销。

## 一键优化与撤销

- 每条建议标注 `可一键` / `需确认` / `仅建议`：
  - **auto**：机械、内容无损，例如把 `references/` 接进入口、把参考型长章节逐字搬到 `references/`、描述句序前移/超长截断。
  - **draft**：会生成新文字（补触发句、补“何时不用”骨架、沉淀经验），需单条点击。
  - **manual**：坏链、TODO、重叠合并、危险命令只能给建议，不自动改。
- “全部安全优化”只应用 auto 动作；执行前确认。
- 每次写盘前把原文件复制到 `<DSH_HOME>/skills-360/backups/<backupId>/`；撤销前还会把当前状态快照到同一目录的 `pre-undo/`，因此“撤销”本身不会静默吞掉你 apply 之后的编辑。面板显示 backupId，并提供“撤销上次”。
- 应用后自动重新评分，报告 `before → after`；若分数没升，如实显示（例如拆章节可能降低“示例”分）。

## 四个 Agent 工具

| 工具 | 用途 |
|---|---|
| `skills360_scan` | 体检并返回精简汇总；`detail="full"` 返回全部 findings/suggestions |
| `skills360_report` | 生成中文 Markdown 报告；`save=true` 落到 `<DSH_HOME>/skills-360/reports/` |
| `skills360_optimize` | 按建议优化；支持 `dryRun`、`safeOnly`、指定 `actionIds` |
| `skills360_evolve` | 挖加载后信号并给出经验提案（默认 dryRun）；`dryRun=false + name + lesson` 写入经验并接进入口 |

示例：

```
用 skills360_scan 看看哪些 skill 在近 30 天零按需加载，且与邻居重叠。
把所有 auto 建议应用到 academic-paper，dryRun 先看会改什么。
skills360_evolve dryRun 一下，看看哪些技能刚被纠正过但还没沉淀经验。
把 “用户说不要改测试” 这条教训写回 xxx 技能。
导出完整体检报告到 ~/.dsh/skills-360/reports。
```

## 安装

本插件以 **Link 依赖 + profile patch insert** 的方式挂载（和本机其它本地插件一致）：

```bash
# 1) 让 desktop profile 能找到包（持久化）
# 在 ~/.dsh/profiles/desktop/package.json 的 dependencies 里加：
#   "skills-360": "link:/Users/fuzhuo/Documents/deepseek-harness/default-workspace/skills-360"
# 2) 让它被 Loader 挂载（~/.dsh/profiles/desktop/cordis.patch.yml 顶层追加）：
#   - insert:
#       - id: skills-360
#         name: 'skills-360'
#         config: { windowDays: 30, catalogDescriptionMaxLength: 500, evolution: true }
# 3) 确保 node_modules 链接存在
ln -sfn /Users/fuzhuo/Documents/deepseek-harness/default-workspace/skills-360 \
  ~/.dsh/profiles/desktop/node_modules/skills-360
# 4) 刷新 Web 页面；侧栏出现 Skills 360 即加载成功
```

卸载：删掉 patch insert 与 `node_modules/skills-360` 链接、从 package.json 移除依赖，刷新页面。

> 客户端是普通 `client.js`（DSH client module 格式），不需要构建步骤；宿主端是 ESM，无第三方依赖。

## 数据与安全

- **扫描**：只读 `ctx.skills` 暴露的当前 catalog、`SKILL.md` 正文，以及同目录最多两层的文件大小。
- **使用证据与进化信号**：只读本机 `<DSH_HOME>/sessions/**` 会话日志；统计 `skill` 工具加载调用，并在加载之后读用户消息文本与工具错误文本，用于识别纠错/报错/重复加载。摘要在本机生成、最长 160 字符，只出现在报告/面板里，**不写入技能、不发往网络**。
- **经验写入**：只在你确认后写 `<skill>/references/lessons.md` 与 `SKILL.md` 的参考资源清单；写入前备份，可撤销。
- 关闭进化信号：在插件 config 设 `evolution: false`（此时持续进化维度不评分，其余功能不变）。
- 路由与面板同源，复用 `connection.requestRejection` 鉴权；缺该服务时 fail closed（503）。
- 自动写入仅允许 `SKILL.md` 与 `references/*.md`，拒绝绝对路径、`..`、符号链接逃逸；Host 在 core 之上再校验一次。
- 备份保留最近 20 份。

## 已知局限

- 分数是启发式，不能替代人读内容；`coverage=partial` 或会话样本不足时置信度会下调。
- 使用统计只覆盖 `skill` 工具调用；`/name` 直接唤起若不经工具不会计入。
- 进化信号基于正则与 `isError` 的启发式匹配，会误报/漏报；写入经验前请读证据。
- 经验文件只追加，不改写正文知识；自动优化只做结构搬运与描述重排。
- 目录描述上限按插件配置（默认 500）计算；不同 profile / agent preset 可能不同。
- 重叠检测基于 IDF 加权词面 + 名称相似度；近义但用词完全不同的重复技能仍可能漏报。
- 极薄的“路由型”技能（10–40 行，只负责把任务转给子技能）会因缺少步骤/示例而被压低分；报告会标注正文行数，请结合类型看。
- 撤销是“恢复备份”，会覆盖 apply 之后你对该技能文件做的手工改动；面板确认框会提示。
- Rubric 2.0 与 1.0 分数不可比；升级后的首次扫描不显示与历史分数的 delta。

## 开发与验证

```bash
cd /Users/fuzhuo/Documents/deepseek-harness/default-workspace/skills-360
node test/run-all.mjs     # 语法 + core 单测 + host 路由/工具验证 + client 渲染验证
```

验证覆盖：frontmatter 解析/改写、指标提取、多帧 zstd 会话统计与进化信号、评分单调性、建议生成、经验写入/撤销逐字节一致、备份/撤销、路径逃逸拒绝、路由鉴权/错误码、client 各状态渲染。

## 目录

```
skills-360/
  index.js            # 宿主：发现/缓存/路由/工具
  client.js           # 侧栏面板（DSH client module）
  lib/frontmatter.js  # SKILL.md frontmatter 解析与改写
  lib/metrics.js      # 纯文本指标
  lib/score.js        # 六维评分/发现/建议
  lib/analyze.js      # 单技能与组合分析
  lib/usage.js        # 会话日志里的加载统计 + 进化信号
  lib/evolution.js    # 经验解析/生成与进化状态
  lib/similarity.js   # IDF 加权余弦 + 名称相似度（路由重叠）
  lib/fixes.js        # 计划→备份→写入→撤销
  lib/report.js       # Markdown 报告
  test/               # 单测与两个 verify harness
```
