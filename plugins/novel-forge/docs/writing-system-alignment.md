# 墨炉 ×《Agent 写作体系 v1.0》对齐

对照来源为 `/Users/fuzhuo/md/08-外部资料/writing-system-20261126.md`。下表的证据等级沿用原文的口径，标注的是来源结论的证据，墨炉本轮的测试验证的是实现行为。原文未单独标级的规则记为 [工程经验]。路径相对于 `plugins/novel-forge/`。

| 来源与规则 | 墨炉落地位置 | 状态 | 证据等级与取舍 |
| --- | --- | --- | --- |
| §0 判断一 · 知识的诅咒与体裁不变性 | `src/recipes/novel/prompts/zh.js:161` | 部分 | [强] 有读者诊断及小说类型承诺，未测跨体裁风格差异。 |
| §0 判断二 · 给锚、建模型、控落差 | `src/recipes/novel/prompts/zh.js:238` | 已落地 | [中] 正文用具体锚点、场景五维和局部落差。 |
| §0 判断三 · 句法清晰、概念可陌生 | `src/recipes/novel/prompts/zh.js:116` | 部分 | [强] 有句长节奏与具体动作指导，未逐句查解码负荷。 |
| §0 判断四 · 对称、均质、抽象、伪具体 | `src/recipes/novel/craft.js:869`、`src/recipes/novel/consistency.js:500` | 部分 | [工程经验] 工艺检查和正典核对覆盖部分信号。虚构世界的精确设定以书内正典为准。 |
| §0 判断五 · 自动评估的上限 | `src/recipes/novel/index.js:1759`、`scripts/style-baseline.mjs:1` | 部分 | [强] 有章节审校与历史偏移读数。洞察、声音、余味仍要人读，人评一致率未测。 |
| 公理 1 · 工作记忆带宽 | `src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/prompts/zh.js:284` | 部分 | [强] 限制一场引入的设定或人物，抽查读者目标与人名，指代距离和人名之外的解码检查延后。 |
| 公理 2 · 句法降摩擦 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/craft.js:196` | 部分 | [强] 有节奏、被动和套话读数，未测从句深度或实际回读。 |
| 公理 3 · 情境模型五维 | `src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/prompts/zh.js:284` | 已落地 | [强] 每场三维、转场显式标时空，审校抽 500 字辨认缺维。 |
| 公理 4 · 预期落差、两句内回收 | `src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/prompts/zh.js:284` | 已落地 | [中] 小说按需求采用 500–800 字一次，由提示词指导。 |
| 公理 5 · 具体利害 | `src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/prompts/zh.js:284` | 已落地 | [强] 关键选择点名谁失去什么，审校定位主峰，高唤醒点超过两处只作 note。 |
| 公理 6 · 还原读者不知道什么 | `src/recipes/novel/prompts/zh.js:161`、`src/recipes/novel/prompts/zh.js:284` | 部分 | [强] 写前记录读者已有知识，事后抽查认知负荷。真实读者复述测试未做。 |
| §2.1 · 读者卡 | `src/recipes/novel/prompts/zh.js:161` | 部分 | [工程经验] 有 `readers`，没有单独要求填写阅读退出条件。 |
| §2.2 · 体裁三轨的文学型 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/prompts/zh.js:238` | 已落地 | [工程经验] 场景转折、白描、章末留白进正文契约。 |
| §2.2–2.3 · BLUF、CARS 与信息型／说服型结构 | 无 | 不适用 | [中] 墨炉产出小说，技术导语里的结论预告、说服文的三步开头和总结句会挤占小说开场与留白。 |
| §2.3 · 小说开场先立悬念 | `src/recipes/novel/prompts/zh.js:205` | 已落地 | [工程经验] 黄金三章承诺、兑现和抛出更大问题。 |
| §3.1 · 开头、主峰、结尾 | `src/recipes/novel/prompts/zh.js:205`、`src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/prompts/zh.js:284` | 已落地 | [强] 用异常开场，抽查约 70–85% 处的主峰，末尾留动作或问题。 |
| §3.2 · 叙事价值翻转与 scene/sequel | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/prompts/zh.js:227` | 部分 | [中] 有场景目标、局面变化及对白潜台词，没有另计 scene/sequel 配比。 |
| §3.3 · 说理的证据、反例和限定 | 无 | 不适用 | [中] 论证单元与修辞配额服务说服型文章，小说用场景选择与后果传递意义。 |
| §4.1 · 旧→新、行动者作主语 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/craft.js:839` | 部分 | [中] 提倡动作动词，有空动词代理，未检查旧→新句间链条。 |
| §4.2 · 具体性 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/craft.js:839` | 部分 | [强] 有动作物象和 M10 代理。代理漏掉无数字、无引号的具体名物。 |
| §4.3 · 隐喻边界 | `src/recipes/novel/prompts/zh.js:116` | 部分 | [强] 有少用比喻及来自人物经验的要求，未登记核心隐喻的映射边界。 |
| §4.4 · 中文语感、白描和节奏 | `src/recipes/novel/craft.js:205`、`src/recipes/novel/prompts/zh.js:284`、`src/recipes/novel/prompts/zh.js:2015` | 已落地 | [工程经验] 七病征逐项抽句，四项诊断只给 note。短样本保留读数。 |
| §4.5 · 留白 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/prompts/zh.js:238` | 已落地 | [工程经验] 不代读者解释情绪与主题，末尾给动作或物件。 |
| §4.5 · 留白禁区 | 无 | 不适用 | [工程经验] 合同、手册、新闻导语等要求面向执行的显式答案，墨炉只写小说。 |
| §4.6 · 删除元话语、废话与伪具体 | `src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/consistency.js:500` | 部分 | [工程经验] 禁作者按和总结，核对书内事实。未实现同义替换测试和外部事实检索。 |
| §5 · 分层修订与停止条件 | `src/recipes/novel/prompts/zh.js:307`、`src/recipes/novel/index.js:1875`、`src/recipes/novel/craft.js:123` | 部分 | [中] 分层改、通过即停、最多两轮、字符二元组改动率小于 5% 时停止。没有接入连续 rubric 分差。 |
| §6.1 · H1/H2、M1/M2/M4/M7/M10 与历史比较 | `src/recipes/novel/craft.js:839`、`scripts/style-baseline.mjs:1` | 已落地 | H1/H2 [强]，M2/M4/M7/M10 [工程经验]。原文给 M1 标「弱」，此处仅作为 [工程经验] 的节奏读数。 |
| §6.1 · H3 跨体裁不变性 | 无 | 未做 | [强] 需要跨体裁语料与采样，超出本轮小说 baseline 的成本范围。 |
| §6.2 · 十五条失败模式 | `src/recipes/novel/craft.js:869`、`src/recipes/novel/prompts/zh.js:284` | 部分 | [工程经验] 有可见的节奏、抽象词、套话、总结腔与正典冲突核对，其余模式未逐项量化。 |
| §6.3 · 机器与人工各自负责的维度 | `src/recipes/novel/chapter.js:628`、`scripts/style-baseline.mjs:1` | 部分 | [强] 脚本做确定性检查、风格向量供人工回读。 |
| §6.3 · 独立模型盲评 | 无 | 未做 | [强] 需要另配评委模型与人工标注，还需控制长度和顺序并校准评委。 |
| §7.1 · 人机创作分工 | `src/recipes/novel/index.js:1875` | 部分 | [工程经验] 审校停止后留给作者润色，系统不验证生活经历的来源或原创性。 |
| §7.2 · 正文多稿与结构多样性 | `src/recipes/novel/prompts/zh.js:161` | 未做 | [?] 备选到故事核为止。正文多稿明显提高单章成本，n=8–16 在该写作场景缺实测。 |
| §7.3 · 提示词与规划 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/packet.js:279` | 部分 | [中] 有分阶段规划、示例和材料包，未对提示词写法单独做实验。 |
| §7.4 · 何时由人写与终审 | 无 | 不适用 | [工程经验] 第一手见证、医疗法律决策、署名承诺和专家文稿不属于小说生成契约。 |
| §8 · 冲突裁决 | `src/recipes/novel/prompts/zh.js:238`、`src/recipes/novel/prompts/zh.js:284` | 部分 | [工程经验] 小说保留留白，落差给锚，利害由事件承担。跨轨规则未接入。 |
| §9 · 速查卡 | `src/recipes/novel/prompts/zh.js:116`、`src/recipes/novel/prompts/zh.js:151` | 部分 | [工程经验] 工艺宪法和阶段补充承载适用规则。原速查卡包含跨轨条款。 |
| §10 · 180 对 A/B 与上线门槛 | 无 | 未做 | [工程经验] 独立盲评、配对生成、双评和统计分析需要额外模型与人工成本。baseline 读数可供后续实验使用。 |

## baseline 用法

```sh
node scripts/style-baseline.mjs chapters-history/ --out baseline.json
node scripts/style-baseline.mjs chapters-current/ --baseline baseline.json
```

脚本用 Node.js 内置模块读取文件或递归扫描目录中的 `.md`。每篇权重相同，baseline 记录样本数、生成时间、均值与总体标准差。比较时逐篇打印 z，标准差为零的项跳过。按同体裁、同长度带选样，用偏移定位值得回读的段落。M10 以数字串（可带年份或百分号后缀）和引号片段作代理，仍需人工校准。可用 `node --test test/style-baseline.test.mjs` 离线验证。

## 附录 · 本轮改动与测试

| 项 | 行为 | 测试文件 |
| --- | --- | --- |
| R1 | 审校通过保留正文，第三次审校起停手，接受不足 5% 的修订并持久化停止标记。 | `test/novel-recipe.test.mjs` |
| R2 | 情绪密度只到 warn，合并同类 AI 腔告警，纯词频 warn 保留并排除单独触发修订。 | `test/craft-metrics.test.mjs`、`test/novel-recipe.test.mjs` |
| R3 | 的／被、≤8 字短句、名词化密度与七病征。短句读数按全章折算，提示按每满 200 个汉字的区间检查句尾落点。 | `test/craft-zh-prose.test.mjs`、`test/prompts-craft.test.mjs` |
| R4 | 500–800 字落差、两句内回收、五维与利害抽查。 | `test/prompts-craft.test.mjs` |
| R5 | 纯函数风格向量与零依赖 Markdown baseline CLI。 | `test/style-baseline.test.mjs` |
