/**
 * 墨炉 · 中文提示词（novel recipe）v0.2
 *
 * 契约：docs/architecture-v2.md §12（提示词契约）/ §3（阶段表）/ §5.2（packet 分片）/ §2（卷章分层）。
 * 每个 builder 接收引擎的 stage ctx，返回 { system, user, maxTokens, temperature }。
 * 纪律：system 只放工艺约束（≤2500 字符），材料一律在 user；
 *       draft 的 user 就是 ctx.packet.text，本文件不再二次拼材料；
 *       卷数、卷序、章数、章号一律由脚本决定，提示词只让模型填内容。
 * 本文件是纯函数：不读盘、不发网络、不调模型、不改 ctx。
 */

import { marketBrief } from '../market.js'

const FENCE = '```'

/* ------------------------------------------------------------------ *
 * 1. 常量
 * ------------------------------------------------------------------ */

/**
 * 类型承诺：不是"类型标签"，而是"读者持续会得到什么"。
 * premise / bible / volumeChapters 会引用，用来防止写成四不像。
 */
const GENRE_PROMISE = {
  悬疑: '每 2–3 章必须给一个新谜面或新嫌疑；答案要在前文埋过线索。恐怖来自"知道得太多/太少"，不是血浆和尖叫。',
  奇幻: '规则要有限制与代价；力量每升一级，必须换来更大的麻烦。不要用设定解释代替冲突。',
  科幻: '把一个核心设定推到极致，写清社会与个人的代价；术语不能代替人物的选择。',
  言情: '阻力来自两个人的性格与处境，不是误会；每次靠近都要付代价，每次退开都要有理由。',
  都市: '写具体的职业、钱、房子、关系网；冲突落在可验证的现实利益上，不要悬浮的霸道总裁。',
  历史: '时代限制要真实：交通、通信、礼法、钱、时间怎么过。人物在限制里找缝隙，而不是开天眼。',
  恐怖: '恐惧来自不可控与日常的变形；少解释，多留下无法归因的细节。怪物露面越少越可怕。',
  武侠: '江湖规矩与私人情义的冲突；招式写结果与代价，不写特效。高手也会疼、会老、会欠人情。',
  通用: '先确定一个读者能一句话说清的承诺（跟着谁、怕什么、最后得到什么），再谈风格。',
}

/**
 * 输入预算（字符）。
 * - volumeChapters / canonPatch 为 v0.2 新增。
 * - draft / revise 的条目不参与拼装：单章材料预算归 packet（architecture-v2 §5.2），
 *   键保留只为不打断仍在读 BUDGET.draft.* 的旧代码；改这些数字不会影响出稿。
 * - 其余阶段沿用 v0.1 的口径，按 §12 的 maxTokens 微调。
 */
const BUDGET = {
  pitch: { premise: 1200, style: 400, user: 4000 },
  premise: { seed: 2000, style: 600, user: 6000 },
  bible: { brief: 1800, seed: 600, style: 600, user: 9000 },
  characters: { brief: 1800, bible: 3500, user: 10000 },
  spine: { brief: 1500, bible: 2200, characters: 2600, volumePlan: 1600, user: 10000 },
  opener: { pitch: 1200, brief: 1200, spine: 1200, chapters: 1200, style: 400, user: 5000 },
  volumeChapters: { spine: 2000, bible: 1200, characters: 1200, digest: 1200, titles: 1000, threads: 600, user: 9000 },
  beats: { chapter: 1800, volume: 400, prev: 800, canon: 2400, cast: 1400, user: 10000 },
  // 预算归 packet，不再使用（architecture-v2 §5.2）。
  draft: { beats: 2500, prev: 800, ledger: 3000, next: 400, cast: 1500, style: 1500, user: 11800 },
  summary: { draft: 8500, beats: 1000, user: 10000 },
  canonPatch: { summary: 1200, beats: 800, canon: 1400, user: 1600 },
  review: { draft: 7600, beats: 1200, canon: 2200, cast: 800, prev: 400, next: 300, user: 15000 },
  // 预算归 packet，不再使用；原文与 findings 的额度在 revisePrompt 内部按剩余预算分配。
  revise: { draft: 11000, review: 2400, beats: 900, ledger: 1400, user: 17000 },
  blurb: { brief: 1500, spine: 2400, titles: 1800, characters: 1400, user: 9000 },
}

const TEMPERATURE = {
  pitch: 0.85,
  premise: 0.9,
  bible: 0.7,
  characters: 0.85,
  spine: 0.7,
  opener: 0.8,
  volumeChapters: 0.6,
  beats: 0.75,
  draft: 0.9,
  summary: 0.2,
  canonPatch: 0.2,
  review: 0.1,
  revise: 0.5,
  blurb: 0.85,
}

/** 正文末尾的内联块，engine 的 splitInline 按这两个标记拆。 */
export const SUMMARY_MARKER = '<<<SUMMARY>>>'
export const CANON_MARKER = '<<<CANON>>>'

/**
 * draft 的内联输出协议。摘要 + 正典补丁跟着正文一次写完，
 * 省掉每章 1–2 次额外小调用；模型不听话时调用方会退回独立 summary/canonPatch 调用。
 */
function inlineProtocolBlock() {
  return [
    '【内联输出协议】正文写完后另起一行，严格按下面两块输出；两块都可以整块省略，引擎会自己补：',
    SUMMARY_MARKER,
    '（200–400 字：发生了什么、谁变了、留下什么钩子，供下一章使用）',
    CANON_MARKER,
    '[{"s":"人物/地点","p":"状态|位置|持有|关系|身份","o":"值","tags":["character:某人"]}]',
    '摘要按「发生／知情／钩子／时空」四行写，每行一句；保留专有名词，不用"他／她"代替。',
    `${CANON_MARKER} 之后只写 JSON 数组：只记本章新出现或改变、下一章会用到的事实，≤8 条；没有变化写 []。`,
    '两块之外不要再写任何东西，不要解释，不要重复正文。',
  ].join('\n')
}

/** revise 只更新摘要（正典由 canonPatch 独立维护）。 */
function inlineSummaryBlock() {
  return [
    `【内联摘要】修订稿写完后另起一行只写 ${SUMMARY_MARKER}，紧接四行，不要标题、不要代码块：`,
    '发生：……',
    '知情：……',
    '钩子：……',
    '时空：……',
  ].join('\n')
}

/**
 * 工艺宪法：所有阶段共享的 12 条硬约束 + 5 条操作纪律。
 * 只讲"怎么写才算人写的"，不讲任何阶段的输出格式。
 * 全部 system 共用它，所以总长必须压在 1300 字上下，给各阶段附录留余量。
 */
const CRAFT = `【工艺宪法】
你写的不是"内容"，是一个具体的人在具体时刻做的选择。

一、视角。只写视角人物此刻能感知、能想到、能知道的东西。他看不见的场面不写；别人的内心只能靠表情、动作、语气、说漏的话判断。禁止"与此同时，在城市的另一端"。

二、场景。一个场景＝谁此刻想要什么＋什么挡着＋局面怎么变＋他带着什么离开。四样缺一，场景就不该存在。转折必须改变力量、信息或关系，不能只是"气氛更紧"。

三、具体。不写"他很难过"，写他做了什么、身体哪里不对、眼前哪个物件变了。情绪用感官证据和动作后果承载；细节要和利益有关；一段至多一个比喻，且来自这个人的生活经验。

四、对话。人很少直说想要的。每句台词表面谈 A，底下争 B：试探、遮掩、施压、求和、报复。规矩要在有人违反、有人利用、有人付代价时显形。沉默、打断、答非所问都是台词。

五、信息。每章都要改变"谁知道什么"。读者、视角人物、对手的信息差要有设计。不要解释读者能自己推出来的东西。

六、因果。每个结果都要能追到某个人在前文做过的选择。巧合只能制造麻烦，不能解决麻烦。人物做蠢事必须有理由：恐惧、贪婪、爱、面子。

七、节奏。句子长短交替，一段只推进一个意思。该慢的地方（情绪转折、关键决定）舍得多给细节，该快的一句带过。不要每段都用金句收尾。

八、连续性。事实、时间、伤病、物品、钱、知情范围、关系，以前文和正典为准。冲突时服从正典；必须改，就写成剧情（他记错了，或有人撒谎）。

九、反 AI 腔。抽象名词、成对形容词、三连排比、"不是 A 而是 B"，都是模型味。能删就删，能换成动作就换。不总结主题，不替读者感动，不在章末发议论。

十、章节。开头要有当下的压力，结尾留下具体的、未解决的问题：一个动作、一句话、一个物件、一个决定，而不是"他陷入沉思"。

十一、欲望。每个出场人物都有当下想要的东西，哪怕只是"想快点离开这个房间"。没有欲望的人不许出场；两个好人也会因为想要的不同互相伤害。

十二、主题。主题是可被反驳的命题（"活着比真相重要"），不是"关于爱与救赎"。不要让人物说出来，让各人的下场投票；结局要给回答，但保留代价。

五条操作纪律：
一、叙述距离。镜头贴着视角人物的身体：他先看见什么、误判什么，读者才看见什么。背景从人物正在做的决定里露出来，不要为了解释把镜头拉远。
二、物件与动作。情绪不要命名，交给可操作的东西：他反复擦一个已经干净的杯子。物件要在场景里被使用、移动、损坏；再次出现时，含义必须变。
三、标点与呼吸。少用分号和成串逗号把三个意思塞进一句；一段只做一件事。长句之后给一个短句，让读者落地。
四、写完自检。谁想要什么？谁在阻止？结束时局面和开头有什么不同？三问答不上就删掉重写，不要用形容词补救。
五、词的选择。用这个人物会用的词，不用"令人窒息""难以言喻"这类现成感受；动词优先于形容词；写完把最漂亮的句子删掉一句，通常不会变差。`

/** 每个阶段在宪法之上追加的工艺重点（输出格式契约在 user 里）。 */
const ADDENDA = {
  pitch: `【本阶段：商业定位】
你只做定位，不写梗概：这份 JSON 决定这本书卖给谁、凭什么被点开，不负责讲完故事。
- 读者先于故事：targetReader 写具体的人（年龄／处境／此刻的阅读需求），不写"所有喜欢玄幻的人"。
- 卖点＝冲突＋承诺：sellingPoint 必须写出"他必须付出什么"与"读者能持续得到什么"；禁止"热血""逆袭""爽""神作"这类空形容词。
- 对标只借机制：comps 写清借它的什么机制，不抄设定、不抄人物、不抄世界观；宁缺毋滥。
- 金手指四要素缺一不可：获得方式、规则边界、代价、成长轴；任缺一项就重写。firstShowChapter 必须在 1–3 章内第一次展示，且第一次展示就要露出代价。
- 开篇第一句是钩子：opening.firstLine 必须制造一个未回答的问题；chapterOneQuestion 是读者读完第 1 章还想知道的那一件事，不是本章剧情概括。
- 与 premise 分工：这里只给定位与骨架，不写主角经历、不写结局；promise 一旦定下，premise 只能同义复述，不得另起一套。`,

  premise: `【本阶段：故事核心】
你要把一句话的种子炼成能撑住一部长篇的承诺。标准不是"好听"，是"能不能连续生产冲突"。
- 读者诊断（先填再定故事）：readers 写「谁·此刻关心什么·已知什么·想得到什么·读完做什么」，≤120 字；用户没给受众，按最可能的默认值填，并标「（假设）」。
- 三种读法：同一素材写 3–4 个一句话读法；划掉第一个想到的公共记忆版，再划掉一个站不住的，留下只用原素材就能成立的那个。alternates 记 2–3 条划掉的（第一条是公共记忆版），每条 ≤30 字，前缀「划掉：」。
- logline：主角＋处境＋行动＋代价，≤60 字，有具体对手或倒计时。写完过故事核三检：可反对（有人盼他失败）／有代价（钱、位置、一个人、一个身份）／有然后（听的人会问然后呢）。三检不过就改核，不要用文笔救。
- 主题：写成可被反驳的命题（"人能不能靠遗忘活下去"），不要写成"关于爱与救赎"。
- promise：读者会持续得到的体验（谜题／压迫／温情／升级）；写明核心物件到结尾怎么变；若已有 pitch，必须与 pitch.promise 同义，不得另起一套。
- 定位先于故事：pitch 已定下频道／标签／卖点／金手指，genreTags 必须覆盖它的 tags；不要另写一本更"文学"的书。
- 核心物件：故事里最重要的物件到结尾必须改变状态或含义；只出现不承重，就换掉。
- ending：只写落点和代价，不写过程；必须回答主题，并让主角失去不可逆的东西。
- 书名：先在草稿里拟 5 个候选（意象／冲突／人称／时间／反讽各一），按"有画面、不剧透、能记住"挑一个写进 title，不要在 JSON 里新增候选字段。`,

  bible: (hardTitle, elements) => `【本阶段：世界设定】
你不是在写百科，是在造一套会影响人物选择的设定。每条设定都要回答：让谁得利、让谁受害、逼人物做什么选择。写不进冲突的设定，一律不写。
- 只写这本书会反复用到的：三条${hardTitle}、三到六个地点、时代日常（钱／交通／通信／权力／时间怎么过）、禁忌与代价、反复出现的意象与物件。
- 七段顺序固定，不得调换：一句话世界→核心设定与约束→${hardTitle}→地点→时代与日常→禁忌与代价→意象与物件。「核心设定与约束」必须紧跟「一句话世界」，因为材料包只取前 600 字。
- 核心设定与约束四要素缺一不可：${elements}。缺一项就重写。
- 设定必须有边界和代价；越强的设定，限制越具体。
- 地点要有感官锚点（气味／声音／光线／温度）和"谁的地盘"；同一地点在不同章节要能变味。
- 每条${hardTitle}后面用一句话写"它会逼出什么冲突"。
- 禁止"这是一个充满魔法的大陆"式空话；禁止罗列历史年表；禁止解释读者在正文里能自己看到的东西。`,

  characters: `【本阶段：人物】
人物是「在压力下会怎么做」的模型。C4 核心写全重卡，C3 阶段只写本卷行动所需的简卡。
- want 与 fear 互相拉扯，主角想要的至少有一方反对；secret 必须中段爆炸；arc 由事件逼出来，不是顿悟。
- voice 写两句：第一句说话方式（句长／用词／口头禅／沉默时做什么），第二句行为底线（他会……；绝不会……）。
- C4 核心另填 need／wound／lie／exit：need 与 want 相反，lie 由 wound 长出，exit 是退场方式。
- 关系要不对称：A 以为是朋友，B 只在利用 A；relations 写"谁对谁"，不写"互为好友"。
- 配角也要有自己想要的东西；没有欲望的人不许出场。
- 开局只写 C4 核心 3–4 人和首卷 C3 阶段 3 人。其余人物由卷纲与章节登记。避免同章出场者名字音形相近。
- 主角必须给 power（起点能力／资源）、growth（成长轴）、cost（代价）；反派必须给 pressure（怎么施压）。四样都要能落进事件，不许写成标签。`,

  spine: `【本阶段：故事脊柱】
脊柱是"因为 A，所以 B，终于 C"的因果链，不是大纲。每一环都必须是主角的一次选择带来的后果，不是"后来发生了……"。
- mainline 写 6–10 环：因为【前因】，他选择【行动】，所以【后果】；下一环从前一环的后果开始。
- 卷数、卷序、每卷目标章数已经由脚本定死在【卷表】里。你只填内容：第 i 个 volumes 对象只能是第 i 卷，不许增、删、合并、跳过、调序，也不许把两卷的内容塞进一卷。
- 每卷三件事必须咬合：goal 是本卷主角要拿到／守住的具体东西；arc 是本卷结束时他相信的东西怎么错、他变成什么样；opens／closes 是这一卷开的线与收的线。上一卷 opens 的线，本卷至少要接住一条。
- 每卷给 payoffs 2–3 条：atChapter 必须是本卷章号区间内的绝对章号（见【卷表】的「第 a–b 章」），level 只能 medium／large，text ≤40 字；每卷至少 1 条 large。
- cliffhanger ≤40 字，停在具体动作／话／物件上；unitArcs 0–3 条，每条 ≤30 字，是本卷能独立成立的单元剧目标。
- opens 的每条可以是 string（≤16 字），也可以是 {text, dueIn}：dueIn 是绝对章号，长线伏笔才填，不填按本卷末章回收。
- 相邻两卷要有不可逆的升级：后一卷的麻烦不能和前一卷同一量级，也不能换个地方重演。
- 结局只写落点和代价，不写过程；必须回答主题，并让主角失去一样再也拿不回来的东西。
- 禁止"经过一系列冒险，他成长了"；禁止用巧合解决主线；禁止把卷写成同质的三段循环。`,

  opener: `【本阶段：黄金三章】
三章是三次"承诺—兑现—更大的问题"，不是三次铺垫。每章都要独立成立，又要让读者非翻下一章不可。
- 第 1 章 300 字内必须出现异常、危机、欲望之一；世界观解释≤150 字，只能从人物的动作与误判里漏出来。
- 每章只投放 1 条必记信息：infoDrop.readerLearns 是读者新知道的，characterLoses 是主角因此失去的（信息／安全／关系）。
- 爽点等级递进：第 1 章 small，第 2 章 small 或 medium，第 3 章 medium；large 留给卷末，不许提前烧掉。
- 三章章末钩子类型（endHook）不重复（悬念／危机／反转／期待／情感／信息差）；第 3 章末要指向第一幕的大问题。
- payoff.chapterDue 必须落在 1–3 章内；承诺了却不兑现，比不承诺更伤读者。
- strategy 写这三章的总打法（先给什么、藏什么、什么时候翻），≤120 字；不要写成章节摘要。`,

  volumeChapters: `【本阶段：卷纲展开】
你在给"这一卷"排章表，不是写小说。每章只回答四件事：谁想要什么（goal）、什么挡着（conflict）、局面怎么变（turn）、留下什么钩子（hook）。
- 条数必须精确等于本批请求的章数，只写指定章号区间，不许合并、跳过或扩展到区间之外。
- turn 必须改变至少一项：力量对比、信息占有、关系温度、时间压力。"气氛更紧"不算 turn。
- hook 必须具体：一个动作、一句话、一个物件、一场即将发生的约会／死亡／揭穿。不要"他陷入沉思""暴风雨即将来临"。
- 每章至少推进一条主线或一条人物弧；删掉所有"过渡章""铺垫章"。
- 章与章用因果咬合：上一章的 hook 是下一章的开场压力；本卷最后一章必须落在本卷的弧光转折上。
- cast 只从人物档案里选 1–4 人；需要路人就用无名配角，不要临时发明重要角色。
- 章级字段一次给全：hookType 六类之一、hookStrength 1–5、payoff {level, text}、infoDrop ≤40 字、track（unit／main／both）、unitArc ≤30 字、threadDue ≤3 条。
- 节奏：每 3–5 章至少 1 个 small｜medium 爽点；hookStrength 不得连续 3 章 ≤2；本卷最后一章 hookStrength 必须是 5。
- threadDue 只能原样引用【待回收线索】清单里的文本（每条 ≤16 字）；清单里没有的不要写，脚本匹配不到只会 warn，等于这条线丢了。
- 不要写正文，不要复述前面章节已经写过的内容（前情只用来接续），钩子必须留悬念，不要在本章解决。`,

  beats: `【本阶段：章节细纲】
把一章拆成 5–9 个可拍的场景。每个场景是一个小型的"目标—阻碍—转折—出口"，上一场的出口就是下一场的入口。
- scenes 每场五项：goal（这场谁想要什么）／obstacle（什么挡着）／turn（局面怎么变）／detail（写正文时必须落地的一个具体动作、道具或感官锚点）／cast（1–4 个已有人物）。
- turn 要让局面变好或变坏，不能原地打转；detail 是能拍出来的具体物或动作，不写情绪概括；本场只新增一个信息或一个人物，新名字一次给全。
- 场数按信息量与情绪重量分配，不要平均切：重场戏 2–3 场，过场 1 场带过。
- beats 是给后文检索用的一句话节拍：5–8 条，按发生顺序，每条以动词开头，写"谁做了什么、局面变成什么"。
- hook 是本章最后落在的那个悬念，必须能被下一章直接接手。
- hookType 六类之一（悬念／危机／反转／期待／情感／信息差）；hookStrength 1–5，大爽点留卷末。
- 每场标 payoff（small／medium／none）与 info（≤30 字，只新增一条必记信息）；开篇三章必须兑现 opener 的 payoff 与 infoDrop。
- 不要在细纲里写对白全文，只写"这场戏要争什么"。`,

  draft: `【本章写作契约】
- 你是本书作者，直写正文。首行「## 第N章 标题」，段间空一行。
- 禁写前言、总结、解释、小标题、列表和作者按。
- 人物、设定、前情和正典取自【材料包】，不新增具名人物或规则。
- 本章至少一次让【类型锚】的核心设定以代价／后果显形，别只写物件、手续和编号。
- 细纲是骨架，可为更强偏离，但必须兑现本章转折与结尾钩子。
- 语感：动词承担画面，少用形容词和比喻；不用现成的感受词。
- 换词：同一实词或二字组本段出现第二次就换说法；换不出就换个观察角度，别用「缓缓／一点点」凑节奏。
- 对话要有暗流：每轮都在争一样东西（立场、信息或面子）；两人都同意的句子删掉，用动作接。
- 段落中位 20–80 字，长短交错；不许连续三段同长。
- 预期三段式：每 500–800 字一次局部落差，建立模式→打破→两句内给可理解的锚点；只破不锚＝事故，别每段都惊喜。
- 场景五维：谁、何时、何地、为何、结果至少落地三维，转场显式标时空。
- 一个场景只引入一个新设定或人物；新名字一次给全，不要挤在一段。
- 落点三选一：章末停在动作或画面，或回到意义已变的开头物件或话。末 3 行落在钩子上，禁写总结、感悟、点名言志或反问升华。
- 每 800 字至少一次进展：信息、能力、关系至少变一样；原地打转的段落删掉。
- 爽点靠选择＋代价：关键选择要能指出谁失去什么、谁因此受损；禁用旁白宣布胜负。

【反 AI 腔：命中左边，就换成右边】
仿佛／似乎／宛如 → 具体观察或身体反应（后颈汗毛立起来）
突然／忽然／猛地 → 删副词让动作自己发生；真正的突然靠结果
缓缓／微微／轻轻 → 给速度、幅度或声音（抬头，脖颈响了一声）
一丝／一抹／几分 → 换成看得见的东西（嘴角动了一下，很快压回去）
眼中闪过／嘴角勾起 → 一个动作或一句台词
空气仿佛凝固 → 在场者的具体反应（没人接话，挂钟走了三格）
心中五味杂陈 → 一个自相矛盾的动作（想笑，喉咙里出来的却是咳嗽）
莫名的／难以言喻的 → 来源不明但具体的细节（他把钥匙数了三遍）
三连排比／抽象名词堆叠 → 只留最具体的一项`,

  summary: `【本阶段：章节摘要】
摘要不是缩写，是写给"下一章的自己"的交接单。只保留四类信息：
- 发生了什么：按因果写，不按时间流水；只写正文里确实发生的事。
- 谁知道了什么：知情范围的变化，谁从谁那里得知，谁还被蒙着。
- 留下什么钩子：写成下一章可以直接接手的动作或信息，不要写"留下了悬念"。
- 时间地点：下一章要接的时空。
总长 200–400 字，四行，每行一个标签。保留专有名词（人名／地名／物件名），不要用"他／她"代替。不写评价、不写推测、不剧透后文、不补正文没有的设定。`,

  canonPatch: `【本阶段：正典补丁】
你不写正文，只做登记。目标是让下一章不踩上一章的坑。
- 只记本章新出现或改变的、下一章会用到的事实。前文已登记过、本章没变的，一条都不要写；≤8 条，宁少勿多。
- facts 是结构化三元组：s 写主体名（人物／地点／物件，用本书已有的名字），p 只能是 状态｜位置｜持有｜关系｜身份，o 写值（≤20 字）；tags 至少一个，写成 character:某人 或 place:某地。
- notes 放没法三元组化的规则、习惯、约定，一条 ≤40 字。
- threads 只记本章新开的线或本章收掉的线：status 只有 open｜closed，收掉时给 closedIn。
- entities 只记本章状态有变化的人物：state／location／knows，knows 写他本章新知道的事。
- timeline 只记本章推进的时空：when ≤20 字，event ≤40 字。
- 以正文实际写到的为准，不要推测、不要补设定、不要把摘要原句抄一遍。`,

  review: `【本阶段：连续性审校】
你是这本书的责任编辑，不是夸奖者。只报可验证的问题，每条必须能指到具体段落或原句；指认不了的"感觉"不要写。同时参考【正典】：正典是这本书的既成事实，正文与它冲突就是硬错。
- quote 必须从【本章正文】逐字复制 8–120 字，不改标点、不加省略号、不拼接两处；找不到可引原句就不写这条意见。
先读【机器读数】再核对：越界只是线索，不凭读数重复报项或升为 block。中文体检读数只作 note。
中文体检逐项抽句：抽象名词作主语、弱动词＋抽象名词、被动滥用、的的不休、长定语前置、连接词冗余、伪术语。每项报问题都须引原句。
按顺序过三闸，前闸不过不写后闸：
1. 认知负荷：读者此刻能否回答「谁想要什么、卡在哪」；1500 字内主要人名是否超过 5 个。
2. 预期：标出建立模式与打破的位置，打破后两句内应有可理解的锚点。
   五维抽查：任取 500 字，标出谁／何时／何地／为何／结果中缺了哪些，缺 ≥3 维记 warn。
   利害抽查：指出本章最强的一次「谁失去什么」与主峰位置（约 70–85%），指不出记 warn；高唤醒点 >2 只作 note。
3. 自我嵌入：用上述利害判断读者能否代入处境，只用于审校。
再按连续性对账：
1. 事实：与正典／前文矛盾的人名、物件、伤势、钱、地点、天气、规则。
2. 时间线：本章内部的时间推进、与上一章的时间衔接、路程与耗时是否可能。
3. 知情：每个出场人物此刻知道什么、从哪知道的；有没有人用了自己还没得到的信息。
4. 视角：有没有写出视角人物看不见、不可能知道的场面或他人内心。
5. AI 腔：抽象情绪、成对形容词、三连排比、"不是 A 而是 B"、章末议论、解释主题。
6. 节奏：连续多段无对话／无动作、单段过长、场景原地打转、该慢的地方一笔带过。
7. 对话：台词是否只在交换信息、是否人人说一样的话、有没有潜台词。
逐项核对【本章对读者的承诺】是否在正文兑现。未兑现或只在章纲层兑现时，以「节奏」记 warn，issue 注明「章卡承诺未兑现」及具体承诺；正文给出充分的延后理由时可记 note。引用正文中最相关的段落，章末钩子核对正文结尾。
severity 标准：block＝读者会出戏／前后矛盾／关键信息错；warn＝明显削弱体验；note＝可改可不改。
fix 必须写成"改成什么"：替换成哪个动作／删掉哪句／补哪个物；写"加强描写"不算 fix。
verdict：有 block，或 warn ≥3 且涉及词频之外的问题 → revise；否则 pass。不要输出 ledgerPatch，正典由本章自己的 canon patch 维护。`,

  revise: `【本阶段：修订】
你是外科医生，不是重写者。只动【需修正】点名的位置；没被点名的段落尽量原样保留，包括你认为可以更好的地方。
修改顺序：结构 → 场景 → 句子 → 字词。上一层的病没解决，不要动下一层的字；点名处跨层时，先修高层。
- 禁止：重写全章、改主线／结局、增删场景、改人物关系、改叙事视角、换文风。
- 允许：替换句子、补一个感官细节、删一句解释、按 finding 调换段落、补一句过渡。
- 每条 finding 都要落地；无法执行的直接跳过，不要把修改说明写进正文。
- 材料包用来核对事实与正典：与原文冲突时以正典为准，并把改动落成正文里的动作或台词。
- 字数与原文相差不超过 10%；仍然以「## 第N章 标题」开头，段落之间空行。
- 输出完整正文，不要只给修改片段，不要解释改了什么。`,

  blurb: `【本阶段：封面文案】
文案只做一件事：让目标读者在 10 秒内知道"这本书会给我什么体验"，并且想知道结局。
- 书名：2–8 字，有画面或有反差，不剧透结局，不用"XX 之城""XX 纪元"这种模板。
- 一句话卖点：主角＋处境＋反常的选择＋代价，≤40 字；不要形容词堆砌。
- 简介：300 字左右，2–3 段。第一段给具体处境与异常，第二段给压力升级与代价，第三段停在抉择前。不剧透结局，不写"最终他能否……"这种空问句。
- 标签：4–6 个，类型＋核心意象＋情绪，不要"热血""爽文"这种空标签。
- 禁止"这是一个关于……的故事""在命运的十字路口""他将揭开惊天的秘密"。`,
}

/* ------------------------------------------------------------------ *
 * 2. ctx 工具（全部容错：缺 key / 抛错 / 假 ctx 都必须能出 prompt）
 * ------------------------------------------------------------------ */

function paramsOf(ctx) {
  const p = ctx && ctx.params
  return p && typeof p === 'object' ? p : {}
}

function str(value) {
  return value == null ? '' : String(value).trim()
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function fit(ctx, text, max) {
  const s = text == null ? '' : String(text)
  if (!s) return ''
  if (!Number.isFinite(max) || max <= 0) return ''
  if (s.length <= max) return s
  try {
    if (ctx && typeof ctx.fit === 'function') {
      const out = ctx.fit(s, max)
      if (typeof out === 'string' && out.length > 0) return out
    }
  } catch {
    /* 假 ctx 的 fit 也可能抛错，退回本地截断 */
  }
  return s.slice(0, Math.max(0, max - 8)) + '…（已截断）'
}

function hardCap(ctx, text, max) {
  let s = text == null ? '' : String(text)
  if (s.length <= max) return s
  s = fit(ctx, s, max)
  if (s.length > max) s = s.slice(0, Math.max(0, max - 8)) + '…（已截断）'
  return s
}

/** 长文保留头尾：审校/修订要看到结尾的钩子，不能只截前半章。 */
function fitEnds(ctx, text, max) {
  const s = str(text)
  if (!s || s.length <= max) return s
  const tailLen = Math.min(Math.floor(max * 0.3), 2500)
  const headMax = Math.max(0, max - tailLen - 24)
  return `${fit(ctx, s, headMax)}\n…（中段已截断）…\n${s.slice(-tailLen)}`
}

/**
 * 把若干素材段压进给定额度：按各段实际长度（不超过 cap）等比例缩，
 * 收缩后总和严格不超过 room，保证 jsonContract 之类的固定块永远完整（不会被 hardCap 从尾部砍掉）。
 * 返回数组与 items 等长、同序：缺失的段返回 ''，调用方可以按下标解构。
 */
function fitSections(ctx, items, room) {
  const sizes = items.map((item) => (item && str(item.text) ? Math.min(str(item.text).length, item.cap) : 0))
  const total = sizes.reduce((sum, n) => sum + n, 0)
  if (total <= room) return items.map((item, i) => (sizes[i] ? fit(ctx, str(item.text), sizes[i]) : ''))
  const ratio = room / total
  let last = -1
  for (let i = sizes.length - 1; i >= 0; i -= 1) {
    if (sizes[i]) {
      last = i
      break
    }
  }
  let left = room
  return items.map((item, i) => {
    if (!sizes[i]) return ''
    const max = i === last ? left : Math.min(sizes[i], Math.floor(sizes[i] * ratio))
    left -= max
    return fit(ctx, str(item.text), Math.max(0, max))
  })
}

/**
 * ctx 上直接挂着的产物（`ctx.brief` / `ctx.bible` / `ctx.characters`）：architecture-v2 §12 把这些
 * 列为 builder 输入，引擎的 reader 未必有；只在 reader 读不到时兜底，且跳过 `draft/ch03` 这类路径键。
 */
function directArtifact(ctx, key) {
  if (!ctx || typeof key !== 'string' || !key || key.includes('/')) return ''
  const value = ctx[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => str(item))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function readText(ctx, key, max) {
  let s = ''
  try {
    if (ctx && typeof ctx.text === 'function') s = ctx.text(key, max) || ''
  } catch {
    s = ''
  }
  if (!str(s)) s = directArtifact(ctx, key)
  s = str(s)
  return max ? fit(ctx, s, max) : s
}

/**
 * 本章正文：同一 stage.run 内刚产出的 draft 还没进引擎的产物缓存，
 * ctx.text('draft/chNN') 读不到；调用方会把正文挂在 ctx.draftText / ctx.draft 上，优先用它们。
 */
function draftTextOf(ctx, chId) {
  return str(ctx && ctx.draftText) || str(ctx && ctx.draft) || readText(ctx, `draft/${chId}`)
}

function readJson(ctx, key, fallback) {
  let value = null
  try {
    if (!ctx || typeof ctx.has !== 'function' || ctx.has(key)) {
      if (ctx && typeof ctx.json === 'function') value = ctx.json(key)
    }
  } catch {
    value = null
  }
  if (value != null) return value
  const direct = ctx && typeof key === 'string' && !key.includes('/') ? ctx[key] : null
  return direct && typeof direct === 'object' ? direct : fallback
}

function readList(ctx, path) {
  try {
    if (!ctx || typeof ctx.list !== 'function') return []
    const value = ctx.list(path)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function section(label, body, fallback) {
  const text = str(body) || str(fallback)
  return `【${label}】\n${text}`
}

export function genrePromise(genre) {
  return GENRE_PROMISE[str(genre)] || GENRE_PROMISE['通用']
}

function bookTitle(ctx) {
  const p = paramsOf(ctx)
  const direct = str(p.title)
  if (direct) return direct
  const brief = readJson(ctx, 'brief', null)
  return str(brief && brief.title) || '（未定名）'
}

function projectHeader(ctx) {
  const p = paramsOf(ctx)
  const chapters = num(p.chapters, 24)
  const perVolume = num(p.chaptersPerVolume, 30)
  const volumeCount = Math.max(1, Math.ceil(chapters / perVolume))
  const parts = [
    `《${bookTitle(ctx)}》`,
    str(p.genre) || '通用',
    `${str(p.audience) || '成年'}读者`,
    str(p.pov) || '第三人称限知',
    `${chapters} 章 × ${num(p.wordsPerChapter, 3000)} 字（约 ${volumeCount} 卷）`,
  ]
  const lines = [`【项目】${parts.join('｜')}`]
  const tone = str(p.tone)
  if (tone) lines.push(`【文风】${tone}`)
  return lines.join('\n')
}

function styleText(ctx, max) {
  const p = paramsOf(ctx)
  const tone = str(p.tone)
  const guide = str(p.styleGuide)
  const parts = []
  if (tone) parts.push(`文风关键词：${tone}`)
  if (guide) {
    const room = Math.max(200, max - (tone ? tone.length + 12 : 0))
    parts.push(`用户给的风格样本／规矩（照这个语感写，不要照抄内容）：\n${fit(ctx, guide, room)}`)
  }
  return parts.join('\n')
}

function currentChapter(ctx) {
  const item = ctx && ctx.item
  if (item && typeof item === 'object') return item
  const items = Array.isArray(ctx && ctx.items) ? ctx.items : []
  const idx = typeof (ctx && ctx.index) === 'number' ? ctx.index : 0
  return items[idx] || {}
}

/** v0.2 的 stage 直接给 ctx.chapter；老 ctx 只有 item/items，两种都认。 */
function chapterOf(ctx) {
  const direct = ctx && ctx.chapter
  if (direct && typeof direct === 'object') return direct
  return currentChapter(ctx)
}

function chapterNo(ctx) {
  const ch = chapterOf(ctx)
  const matched = str(ch.id).match(/(\d+)/)
  if (matched) return Number(matched[1])
  const idx = typeof (ctx && ctx.index) === 'number' ? ctx.index : -1
  return idx >= 0 ? idx + 1 : 1
}

function itemIdAt(ctx, offset) {
  const ch = currentChapter(ctx)
  const items = Array.isArray(ctx && ctx.items) ? ctx.items : []
  const byId = items.findIndex((x) => x && x.id === ch.id)
  const idx = byId >= 0 ? byId : typeof (ctx && ctx.index) === 'number' ? ctx.index : -1
  if (idx >= 0) {
    const target = items[idx + offset]
    if (target && target.id) return str(target.id)
  }
  const id = str(ch.id) || 'ch01'
  const matched = id.match(/^([A-Za-z_]*)(\d+)(.*)$/)
  if (matched) {
    const next = Number(matched[2]) + offset
    if (next >= 1) return `${matched[1]}${String(next).padStart(matched[2].length, '0')}${matched[3]}`
  }
  const next = chapterNo(ctx) + offset
  return next >= 1 ? `ch${String(next).padStart(2, '0')}` : ''
}

function chapterCard(ch, n) {
  const lines = [`第 ${n} 章${ch.title ? `《${ch.title}》` : ''}${ch.id ? `（${ch.id}）` : ''}`]
  if (ch.goal) lines.push(`目标：${ch.goal}`)
  if (ch.conflict) lines.push(`冲突：${ch.conflict}`)
  if (ch.turn) lines.push(`转折：${ch.turn}`)
  if (ch.hook) lines.push(`钩子：${ch.hook}`)
  // v0.3：卷纲里排好的钩子类型/爽点/信息差，要让写正文的人看得见，否则字段只是账本。
  if (ch.hookType) {
    const strength = Number(ch.hookStrength) || 0
    lines.push(`钩子类型：${ch.hookType}${strength ? `（强度 ${strength}/5）` : ''}`)
  }
  if (ch.payoff && str(ch.payoff.text)) {
    lines.push(`本章爽点：${str(ch.payoff.text)}${ch.payoff.level ? `（${ch.payoff.level}）` : ''}`)
  }
  if (ch.infoDrop && (str(ch.infoDrop.readerLearns) || str(ch.infoDrop.characterLoses))) {
    const drop = []
    if (str(ch.infoDrop.readerLearns)) drop.push(`读者知道：${str(ch.infoDrop.readerLearns)}`)
    if (str(ch.infoDrop.characterLoses)) drop.push(`主角失去：${str(ch.infoDrop.characterLoses)}`)
    lines.push(`信息差：${drop.join('；')}`)
  }
  if (Array.isArray(ch.threadDue) && ch.threadDue.length) {
    lines.push(`本章回收：${ch.threadDue.map(str).filter(Boolean).join('、')}`)
  }
  const meta = []
  if (ch.pov) meta.push(`视角：${ch.pov}`)
  if (ch.when) meta.push(`时间：${ch.when}`)
  if (ch.where) meta.push(`地点：${ch.where}`)
  if (meta.length) lines.push(meta.join('｜'))
  if (Array.isArray(ch.cast) && ch.cast.length) lines.push(`出场：${ch.cast.map(str).filter(Boolean).join('、')}`)
  return lines.join('\n')
}

/* --- 卷：卷表 / 卷卡 / 章号范围 ------------------------------------ */

/**
 * 卷表：优先用脚本给的 ctx.volumePlan；缺失时按 plan.js 的算法补一份（只为占位，卷数仍由脚本决定）。
 */
function volumePlanOf(ctx) {
  const raw = Array.isArray(ctx && ctx.volumePlan)
    ? ctx.volumePlan
    : Array.isArray(readJson(ctx, 'volumePlan', null))
      ? readJson(ctx, 'volumePlan', null)
      : readList(ctx, 'volumePlan')
  const plan = (Array.isArray(raw) ? raw : [])
    .filter((v) => v && typeof v === 'object')
    .map((v, i) => ({
      index: num(v.index, i + 1),
      title: str(v.title) || `第 ${i + 1} 卷`,
      targetChapters: num(v.targetChapters, 0),
    }))
  if (plan.length) return plan

  // 兜底：与 plan.js 的 effectivePerVolume / volumeCount 同口径（不让模型决定卷数）。
  const p = paramsOf(ctx)
  const total = num(p.chapters, 24)
  let per = Math.floor(num(p.chaptersPerVolume, 30))
  per = Math.min(60, Math.max(10, per))
  if (total / per > 40) per = Math.max(1, Math.ceil(total / 40))
  const count = Math.max(1, Math.ceil(total / per))
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    title: `第 ${i + 1} 卷`,
    targetChapters: i === count - 1 ? total - base * (count - 1) : base,
  }))
}

/** 本卷章号范围：章号由脚本按「前面各卷章数之和」发，模型不写 id。 */
function chapterRange(volume, perVolume) {
  const index = Math.max(1, num(volume && volume.index, 1))
  const target = Math.max(1, num(volume && volume.targetChapters, perVolume))
  const start = num(volume && volume.startChapter, 0) || (index - 1) * target + 1
  return { index, target, start, end: start + target - 1 }
}

function currentVolume(ctx) {
  const direct = ctx && ctx.volume
  if (direct && typeof direct === 'object') return direct
  const idx = Math.max(1, num(ctx && ctx.volumeIndex, 1))
  const plan = volumePlanOf(ctx)
  const fromPlan = plan[idx - 1] || {}
  const spine = readJson(ctx, 'spine', null)
  const fromSpine = spine && Array.isArray(spine.volumes) ? spine.volumes[idx - 1] : null
  return {
    ...(fromPlan || {}),
    ...(fromSpine && typeof fromSpine === 'object' ? fromSpine : {}),
    index: num(fromPlan.index, idx),
  }
}

function volumeCard(ctx, volume) {
  const range = chapterRange(volume, num(paramsOf(ctx).chaptersPerVolume, 30))
  const lines = [
    `第 ${range.index} 卷${str(volume.title) ? `《${str(volume.title)}》` : ''}`,
    `本卷共 ${range.target} 章（第 ${range.start}–${range.end} 章）`,
  ]
  if (volume.goal) lines.push(`本卷目标：${str(volume.goal)}`)
  if (volume.arc) lines.push(`本卷弧光：${str(volume.arc)}`)
  if (Array.isArray(volume.cast) && volume.cast.length) {
    lines.push(`重点人物：${volume.cast.map(str).filter(Boolean).join('、')}`)
  }
  if (Array.isArray(volume.opens) && volume.opens.length) {
    lines.push(`本卷开线：${volume.opens.map(str).filter(Boolean).join('；')}`)
  }
  if (Array.isArray(volume.closes) && volume.closes.length) {
    lines.push(`本卷收线：${volume.closes.map(str).filter(Boolean).join('；')}`)
  }
  return lines.join('\n')
}

/** 相邻卷：只取 spine.volumes 里的前后两卷，用来把本卷的入口与出口接上。 */
function neighbourVolumes(ctx, index) {
  const spine = readJson(ctx, 'spine', null)
  const list = spine && Array.isArray(spine.volumes) ? spine.volumes : []
  const prev = index >= 2 ? list[index - 2] : null
  const next = list[index] || null
  return { prev: prev && typeof prev === 'object' ? prev : null, next: next && typeof next === 'object' ? next : null }
}

function volumeLines(volume) {
  if (!volume) return ''
  const bits = [str(volume.title) ? `《${str(volume.title)}》` : '']
  if (volume.goal) bits.push(`目标：${str(volume.goal)}`)
  if (volume.arc) bits.push(`弧光：${str(volume.arc)}`)
  if (Array.isArray(volume.opens) && volume.opens.length) {
    bits.push(`开线：${volume.opens.map(str).filter(Boolean).join('；')}`)
  }
  if (Array.isArray(volume.closes) && volume.closes.length) {
    bits.push(`收线：${volume.closes.map(str).filter(Boolean).join('；')}`)
  }
  return bits.filter(Boolean).join('｜')
}

/* --- 人物 ---------------------------------------------------------- */

function chapterCastNames(ctx, ch) {
  const names = []
  const add = (name) => {
    const value = str(name)
    if (value && !names.includes(value)) names.push(value)
  }
  if (Array.isArray(ch.cast)) ch.cast.forEach(add)
  const beats = readJson(ctx, `beats/${str(ch.id) || 'ch01'}`, null)
  if (beats && Array.isArray(beats.scenes)) {
    beats.scenes.forEach((scene) => {
      if (scene && Array.isArray(scene.cast)) scene.cast.forEach(add)
    })
  }
  return names
}

/** 把各种写法的性别归一成「男／女」，认不出就留空（不猜）。 */
export function sexOf(gender) {
  const value = str(gender).trim().toLowerCase()
  if (!value) return ''
  if (['男', '男性', 'male', 'm', 'boy', 'man'].includes(value)) return '男'
  if (['女', '女性', 'female', 'f', 'girl', 'woman'].includes(value)) return '女'
  return ''
}

function pronounOf(gender) {
  const sex = sexOf(gender)
  return sex === '男' ? '他' : sex === '女' ? '她' : ''
}

/** 「女·「她」」这样的标签；档案没写性别时返回空串。 */
function genderTag(cast) {
  const sex = sexOf(cast && cast.gender)
  return sex ? `${sex}·「${pronounOf(sex)}」` : ''
}

/** 全员代词对照表：正文里指代同一个人只能用一个代词，这张表就是依据。 */
function pronounLine(ctx) {
  const data = readJson(ctx, 'characters', null)
  const cast = data && Array.isArray(data.cast) ? data.cast : []
  const lines = cast
    .filter((c) => c && str(c.name))
    .map((c) => {
      const role = str(c.role) || '配角'
      const sex = sexOf(c.gender)
      return sex
        ? `- ${str(c.name)}＝「${pronounOf(sex)}」（${sex}，${role}）`
        : `- ${str(c.name)}：档案没写性别（${role}）——沿用前文已用的代词，本章不要换`
    })
  return lines.length ? lines.join('\n') : ''
}

function castDump(ctx, max) {
  const data = readJson(ctx, 'characters', null)
  const cast = data && Array.isArray(data.cast) ? data.cast : []
  if (!cast.length) return readText(ctx, 'characters', max)
  const lines = cast.map((c) => {
    const bits = []
    if (c.want) bits.push(`要【${c.want}】`)
    if (c.fear) bits.push(`怕【${c.fear}】`)
    if (c.secret) bits.push(`瞒着【${c.secret}】`)
    if (c.voice) bits.push(`说话【${c.voice}】`)
    if (c.arc) bits.push(`弧光【${c.arc}】`)
    const tag = genderTag(c)
    const role = str(c.role) || '配角'
    const head = tag ? `${tag}，${role}` : role
    return `- ${str(c.name) || '（无名）'}（${head}）：${bits.join('；')}`
  })
  return fit(ctx, lines.join('\n'), max)
}

function castBrief(ctx, names, max) {
  const data = readJson(ctx, 'characters', null)
  const cast = data && Array.isArray(data.cast) ? data.cast : []
  if (!cast.length) {
    return names.length
      ? names.map((n) => `- ${n}（档案缺失，只能按已有设定写，不要新增重要角色）`).join('\n')
      : ''
  }
  const wanted = names.length ? cast.filter((c) => names.includes(str(c.name))) : []
  const pool = wanted.length ? wanted : cast.slice(0, 8)
  const lines = pool.map((c) => {
    const bits = []
    if (c.want) bits.push(`要【${c.want}】`)
    if (c.fear) bits.push(`怕【${c.fear}】`)
    if (c.secret) bits.push(`瞒着【${c.secret}】`)
    if (c.voice) bits.push(`说话【${c.voice}】`)
    const tag = genderTag(c)
    const role = str(c.role) || '配角'
    const head = tag ? `${tag}，${role}` : role
    return `- ${str(c.name) || '（无名）'}（${head}）：${bits.join('；')}`
  })
  return fit(ctx, lines.join('\n'), max)
}

/** 章工作单元已按共用预算渲染。独立调用 prompt 时仍可用原来的档案兜底。 */
function castBriefOf(ctx, names, max) {
  return typeof ctx?.castBrief === 'string' ? ctx.castBrief : castBrief(ctx, names, max)
}

/* --- 正典 / 细纲 / 审校 --------------------------------------------- */

/** 旧账本渲染：只在 ctx 没给 canonText 时兜底，保证老项目也能出 prompt。 */
function ledgerText(ctx, max) {
  const data = readJson(ctx, 'ledger', null)
  if (!data || typeof data !== 'object') return readText(ctx, 'ledger', max)
  const out = []
  if (Array.isArray(data.canonRules) && data.canonRules.length) {
    const rules = data.canonRules.map((r) => str(r && r.text ? r.text : r)).filter(Boolean)
    if (rules.length) out.push(`硬规则：${rules.join('；')}`)
  }
  if (Array.isArray(data.facts) && data.facts.length) {
    out.push('已确立事实：')
    data.facts.slice(0, 40).forEach((f) => {
      if (!f) return
      out.push(`- [${str(f.chapter) || '?'}] ${str(f.text)}${f.status ? `（${str(f.status)}）` : ''}`)
    })
  }
  if (Array.isArray(data.threads) && data.threads.length) {
    const open = data.threads.filter((t) => t && str(t.status) !== 'closed').slice(0, 20)
    if (open.length) {
      out.push('未收线索：')
      open.forEach((t) => out.push(`- ${str(t.text)}（开于 ${str(t.opened) || '?'}）`))
    }
  }
  if (data.characters && typeof data.characters === 'object' && !Array.isArray(data.characters)) {
    const characterLines = []
    Object.keys(data.characters)
      .slice(0, 12)
      .forEach((name) => {
        const c = data.characters[name]
        if (!c || typeof c !== 'object') return
        const bits = []
        if (c.location) bits.push(`在 ${str(c.location)}`)
        if (c.state) bits.push(str(c.state))
        if (Array.isArray(c.knows) && c.knows.length) bits.push(`知道：${c.knows.map(str).filter(Boolean).join('、')}`)
        if (bits.length) characterLines.push(`- ${name}：${bits.join('；')}`)
      })
    if (characterLines.length) out.push('人物状态：', ...characterLines)
  }
  if (Array.isArray(data.timeline) && data.timeline.length) {
    out.push('时间线：')
    data.timeline.slice(-15).forEach((t) => {
      if (!t) return
      out.push(`- ${str(t.chapter)}｜${str(t.when)}｜${str(t.event)}`)
    })
  }
  return fit(ctx, out.join('\n'), max)
}

/** 正典文本：v0.2 由调用方 formatCanon 后放进 ctx.canonText；老 ctx 退回 ledger。 */
function canonTextOf(ctx, max) {
  const direct = str(ctx && ctx.canonText)
  if (direct) return fit(ctx, direct, max)
  return ledgerText(ctx, max)
}

function renderBeats(data) {
  if (!data || typeof data !== 'object') return ''
  const lines = []
  const scenes = Array.isArray(data.scenes) ? data.scenes : []
  if (scenes.length) {
    lines.push(`本章共 ${scenes.length} 场。`)
    scenes.forEach((s, i) => {
      if (!s || typeof s !== 'object') return
      const head = [str(s.where), str(s.when), Array.isArray(s.cast) ? s.cast.map(str).filter(Boolean).join('、') : '']
        .filter(Boolean)
        .join('｜')
      lines.push(`${str(s.no) || i + 1}. ${head}`)
      if (s.goal) lines.push(`   目标：${str(s.goal)}`)
      if (s.conflict) lines.push(`   冲突：${str(s.conflict)}`)
      if (s.obstacle) lines.push(`   阻碍：${str(s.obstacle)}`)
      if (s.turn) lines.push(`   转折：${str(s.turn)}`)
      if (s.detail) lines.push(`   细节：${str(s.detail)}`)
      if (s.exit) lines.push(`   出口：${str(s.exit)}`)
      if (s.sensory) lines.push(`   感官：${str(s.sensory)}`)
      if (s.hook) lines.push(`   钩子：${str(s.hook)}`)
    })
  }
  if (data.goal) lines.push(`本章目标：${str(data.goal)}`)
  if (data.conflict) lines.push(`本章冲突：${str(data.conflict)}`)
  if (data.turn) lines.push(`本章转折：${str(data.turn)}`)
  if (data.hook) lines.push(`本章钩子：${str(data.hook)}`)
  if (Array.isArray(data.beats) && data.beats.length) {
    lines.push(`节拍：${data.beats.map(str).filter(Boolean).join(' → ')}`)
  }
  return lines.join('\n')
}

function beatsText(ctx, id, max) {
  const data = readJson(ctx, `beats/${id}`, null)
  if (!data || typeof data !== 'object') return readText(ctx, `beats/${id}`, max)
  const rendered = renderBeats(data)
  return rendered ? fit(ctx, rendered, max) : readText(ctx, `beats/${id}`, max)
}

/** stage ctx 里可能直接挂 beats（对象或文本），优先用它。 */
function beatsMaterial(ctx, id, max) {
  const direct = ctx && ctx.beats
  if (typeof direct === 'string' && direct.trim()) return fit(ctx, direct.trim(), max)
  if (direct && typeof direct === 'object') return fit(ctx, renderBeats(direct), max)
  return beatsText(ctx, id, max)
}

function findingsText(ctx, id, max) {
  const list = Array.isArray(ctx && ctx.findings) ? ctx.findings : []
  if (list.length) {
    const lines = list.filter(Boolean).map((f, i) => {
      if (typeof f === 'string') return `${i + 1}. ${str(f)}`
      return `${i + 1}. [${str(f.severity) || 'warn'}] ${str(f.kind)}｜${str(f.where) || '位置未给'}｜问题：${str(
        f.issue
      )}｜改法：${str(f.fix)}`
    })
    return fit(ctx, lines.join('\n'), max)
  }
  const data = readJson(ctx, `review/${id}`, null)
  if (data && typeof data === 'object' && Array.isArray(data.findings) && data.findings.length) {
    return fit(ctx, renderFindings(data), max)
  }
  return ''
}

function renderFindings(data) {
  const findings = Array.isArray(data.findings) ? data.findings : []
  const lines = [`verdict：${str(data.verdict) || '?'}，共 ${findings.length} 条：`]
  findings.forEach((f, i) => {
    if (!f || typeof f !== 'object') return
    lines.push(
      `${i + 1}. [${str(f.severity) || 'warn'}] ${str(f.kind)}｜${str(f.where) || '位置未给'}｜问题：${str(
        f.issue
      )}｜改法：${str(f.fix)}`
    )
  })
  return lines.join('\n')
}

function prettyArtifact(ctx, key, max) {
  const data = readJson(ctx, key, null)
  if (data && typeof data === 'object') {
    try {
      return fit(ctx, JSON.stringify(data, null, 2), max)
    } catch {
      /* 循环引用等异常，退回 text */
    }
  }
  return readText(ctx, key, max)
}

/** 卷名／章名摘要：blurb 用，兼容 v2 扁平 chapters 与 v1 的 volumes[].chapters。 */
function titleDigest(ctx, max) {
  const outline = readJson(ctx, 'outline', null)
  const spine = readJson(ctx, 'spine', null)
  const volumes =
    outline && Array.isArray(outline.volumes)
      ? outline.volumes
      : spine && Array.isArray(spine.volumes)
        ? spine.volumes
        : []
  const chapters = outline && Array.isArray(outline.chapters) ? outline.chapters : []
  if (!volumes.length && !chapters.length) return readText(ctx, 'outline', max)
  const lines = volumes.map((v) => {
    const own = chapters.filter((c) => c && (c.volume === v.id || c.volume === str(v.index)))
    const list = own.length ? own : Array.isArray(v.chapters) ? v.chapters : []
    const titles = list.map((c) => str(c.title)).filter(Boolean)
    return `卷《${str(v.title) || '未命名'}》${titles.length ? `：${titles.slice(0, 30).join('；')}` : ''}`
  })
  return fit(ctx, lines.join('\n'), max)
}

function existingTitles(ctx, max) {
  const raw = ctx && ctx.existingTitles
  if (Array.isArray(raw)) {
    const list = raw.map(str).filter(Boolean)
    if (list.length) return fit(ctx, list.join('；'), max)
  }
  const direct = str(raw)
  return direct ? fit(ctx, direct, max) : ''
}

function jsonContract(fields, sample) {
  const fieldLines = Array.isArray(fields) ? fields.join('\n') : str(fields)
  return [
    '【输出格式】',
    `只输出一个 ${FENCE}json 代码块，代码块之外不要有任何字符：不要解释、不要前言、不要标题、不要第二个代码块。`,
    '字段名、层级、类型严格如下，不增不减；数组为空写 []，对象为空写 {}；不要注释，不要尾逗号，字符串用双引号。',
    fieldLines,
    '最小合法示例（只示范形状与字段长度，内容必须换成本书的）：',
    `${FENCE}json`,
    JSON.stringify(sample, null, 2),
    FENCE,
  ].join('\n')
}

function mdContract(structure) {
  return `【输出格式】\n只输出 Markdown 正文，不要代码围栏，不要任何解释或前言。结构严格如下：\n${structure}`
}

/* ------------------------------------------------------------------ *
 * 3. 十二个阶段
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 3.5 商业定位与开篇：pitch 先定"卖给谁、凭什么卖"，opener 再把前三章写成承诺
 * ------------------------------------------------------------------ */

/** pitch.json：可能缺失；缺了就当空对象，所有字段退回新建参数。 */
function pitchOf(ctx) {
  const data = readJson(ctx, 'pitch', null)
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
}

function tagList(value) {
  const raw = Array.isArray(value) ? value : str(value).split(/[、,，\s]+/)
  return raw.map((x) => str(x)).filter(Boolean).slice(0, 6)
}

function compsText(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((item) => {
      if (typeof item === 'string') return `- ${str(item)}`
      if (!item || typeof item !== 'object') return ''
      const title = str(item.title)
      return title ? `- ${title}${item.why ? `：${str(item.why)}` : ''}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function goldenFingerText(value) {
  if (!value) return ''
  if (typeof value === 'string') return str(value)
  return [
    value.name ? `名称：${str(value.name)}` : '',
    value.rule ? `规则：${str(value.rule)}` : '',
    value.cost ? `代价：${str(value.cost)}` : '',
    value.growthAxis ? `成长轴：${str(value.growthAxis)}` : '',
    value.firstShowChapter ? `首次展示：第 ${num(value.firstShowChapter, 0) || '?'} 章` : '',
  ]
    .filter(Boolean)
    .join('；')
}

/** 商业定位块：pitch.json 已定优先，其次新建参数；两处都没有就返回空串。 */
function commercialLines(ctx) {
  const pitch = pitchOf(ctx)
  const p = paramsOf(ctx)
  const mode = str(p.marketMode) || 'off'
  const channel = str(pitch.channel) || str(p.channel)
  const platform = str(pitch.platform) || str(p.platform)
  const tags = tagList(pitch.tags && pitch.tags.length ? pitch.tags : p.tags)
  const sellingPoint = str(pitch.sellingPoint) || str(p.sellingPoint)
  const targetReader = str(pitch.targetReader) || str(p.targetReader)
  const promise = str(pitch.promise) || str(p.promise)
  const hookLine = str(pitch.hookLine) || str(p.hookLine)
  const comps = compsText(pitch.comps && pitch.comps.length ? pitch.comps : p.comps)
  const golden = goldenFingerText(pitch.goldenFinger || p.goldenFinger)
  const cadence = str(pitch.updateCadence) || str(p.updateCadence)
  const opening = pitch.opening && typeof pitch.opening === 'object' ? pitch.opening : {}
  const firstLine = str(opening.firstLine) || str(p.firstLine)
  const question = str(opening.chapterOneQuestion) || str(p.chapterOneQuestion)
  const lines = [
    channel || platform ? `- 频道／平台：${channel || '未定'}｜${platform || '未定'}` : '',
    tags.length ? `- 标签：${tags.join('、')}` : '',
    sellingPoint ? `- 卖点：${sellingPoint}` : '',
    targetReader ? `- 目标读者：${targetReader}` : '',
    promise ? `- 读者承诺：${promise}` : '',
    hookLine ? `- 钩子句：${hookLine}` : '',
    comps ? `- 对标（只借机制，不抄人物与桥段）：\n${comps}` : '',
    golden ? `- 金手指：${golden}` : '',
    cadence ? `- 更新节奏：${cadence}` : '',
    firstLine ? `- 开篇第一句：${firstLine}` : '',
    question ? `- 第 1 章要回答的问题：${question}` : '',
  ].filter(Boolean)

  let brief = ''
  if (mode === 'year') {
    brief = marketBrief({ year: p.marketYear, channel: str(p.channel) }, { maxChars: 700 })
  } else if (mode === 'tags') {
    brief = marketBrief({ year: p.marketYear || undefined, tags: tagList(p.tags), channel: str(p.channel) }, { maxChars: 700 })
  }
  if (brief) lines.push('', brief)
  return lines.join('\n')
}

/**
 * pitch：商业定位。只决定"卖给谁、凭什么卖"，不写故事梗概。
 * 产物 pitch.json 会被 premise／bible／opener 继续引用。
 */
function pitchPrompt(ctx) {
  const p = paramsOf(ctx)
  const seed = str(p.seed)
  const user = [
    projectHeader(ctx),
    section(
      '故事种子',
      fit(ctx, [str(p.premise), seed ? `灵感与母题：${seed}` : ''].filter(Boolean).join('\n'), BUDGET.pitch.premise),
      '（用户没有给故事核：从类型与文风反推一个能连续生产冲突的核心。）'
    ),
    section('类型承诺', genrePromise(p.genre)),
    section(
      '已填的定位（用户已定，不得矛盾）',
      commercialLines(ctx),
      '（用户还没填：你来定，但要能从上一条类型承诺推出来。）'
    ),
    section('文风与尺度', styleText(ctx, BUDGET.pitch.style), '（未指定：克制、具体、少形容词。）'),
    jsonContract(
      [
        '- version：number，固定 1',
        '- channel：string，只能是「男频」「女频」「通用」',
        '- platform：string，≤20 字，如起点／番茄／晋江；不确定写「通用」',
        '- tags：string[]，3–6 个，读者用来搜到这本书的词，不是主题词',
        '- sellingPoint：string，≤60 字，一句话说清"谁在什么处境里，被什么逼着做什么"；不许写热血／逆袭／爽文',
        '- hookLine：string，≤40 字，能放在封面或第一章第一行的钩子句',
        '- targetReader：string，≤80 字，谁·此刻关心什么·愿意为什么付费',
        '- promise：string，≤80 字，读者会持续得到的体验（与 premise.promise 同义）',
        '- comps：array，0–2 项，每项 {title, why}；why≤40 字，只写可借的机制',
        '- goldenFinger：object，{name≤12, rule≤60, cost≤40, growthAxis≤60, firstShowChapter 1–3}；没有金手指就写现实向能力，不允许空对象',
        '- opening：object，{firstLine≤40, chapterOneQuestion≤40}；firstLine 是正文第一句，不是梗概',
        '- degraded：string[]，0–3 条，被降级或没做到的定位点；没有就写 []',
      ],
      {
        version: 1,
        channel: '女频',
        platform: '通用',
        tags: ['悬疑', '民俗', '殡葬', '母女', '头七'],
        sellingPoint: '殡仪馆夜班员替无名尸守七夜，每守一夜就多看见一个死者，也多一条母亲死因的线索。',
        hookLine: '头七那晚，三号柜里的手机响了，来电显示是我妈。',
        targetReader: '二十五到三十五岁、夜里读悬疑的上班族；关心母亲死因能否查清，愿意为每夜一条新线索付费。',
        promise: '每晚一个死者带来一条线索；铜钥匙从开不了门，到打开母亲锁着的抽屉，活人比死人更难审。',
        comps: [{ title: '《殡葬师手记》', why: '借"职业规矩即超自然规则"的机制，不借人物' }],
        goldenFinger: {
          name: '守夜眼',
          rule: '替死者守满七夜，能看见他死前最后十分钟；只看，不能改。',
          cost: '每看一次，自己少记一段活人时的记忆。',
          growthAxis: '从看见画面，到听见死者说话，到能问一个问题。',
          firstShowChapter: 1,
        },
        opening: {
          firstLine: '三号柜里的手机响了第七次，我才敢接。',
          chapterOneQuestion: '母亲死的那晚，三号柜里躺的是谁？',
        },
        degraded: [],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.pitch}`,
    user: hardCap(ctx, user, BUDGET.pitch.user),
    maxTokens: 1600,
    temperature: TEMPERATURE.pitch,
  }
}

function premisePrompt(ctx) {
  const p = paramsOf(ctx)
  const chapters = num(p.chapters, 24)
  const words = num(p.wordsPerChapter, 3000)
  const seed = str(p.seed)
  const user = [
    projectHeader(ctx),
    section(
      '故事种子',
      str(p.premise),
      '（用户没有给故事核：请从类型与文风反推一个能连续生产冲突的核心，但不要偏离类型承诺。）'
    ),
    seed ? section('灵感与母题', seed) : '',
    section(
      '商业定位（已定，不得矛盾）',
      fit(ctx, commercialLines(ctx), 1200),
      '（尚未定：按类型承诺给出可执行的定位，不写空泛口号。）'
    ),
    section('类型承诺', genrePromise(p.genre)),
    section(
      '硬约束',
      [
        `- 类型：${str(p.genre) || '通用'}；目标读者：${str(p.audience) || '成年'}；叙事视角：${str(p.pov) || '第三人称限知'}。`,
        `- 规模：${chapters} 章 × ${words} 字，约 ${((chapters * words) / 10000).toFixed(1)} 万字。这个体量要求主线能撑住 ${chapters} 次推进，不能是一句话就能讲完的短篇。`,
        '- 结局方向必须回答主题，并让主角付出不可逆的代价。',
        '- 五个书名候选只在草稿里比较，最终只输出一个；不要新增契约之外的 JSON 字段。',
      ].join('\n')
    ),
    section('文风与尺度', styleText(ctx, BUDGET.premise.style), '（未指定：用克制、具体、少形容词的叙述。）'),
    jsonContract(
      [
        '- readers：string，≤120 字，谁·此刻关心什么·已知什么·想得到什么·读完做什么；默认值标（假设）',
        '- alternates：string[]，2–3 条被划掉的读法，每条 ≤30 字，以「划掉：」开头',
        '- title：string，2–8 字，不带书名号，不剧透结局',
        '- logline：string，≤60 字，主角＋处境＋行动＋代价；写完过故事核三检（可反对／有代价／有然后）',
        '- theme：string，一句可被反驳的命题',
        '- promise：string，≤80 字，必须与 pitch.promise 同义；写明核心物件到结尾怎么变',
        '- ending：string，≤80 字，只写落点与代价，不写过程',
        '- genreTags：string[]，3–5 个，必须覆盖 pitch.tags 里的每一个标签，不含"小说"二字',
      ],
      {
        readers: '（假设）二十五到三十五岁、夜里读悬疑的上班族：关心母亲死因能否查清，已知殡仪馆夜班规矩，想得到每夜一条新线索，读完想翻回前文找伏笔。',
        alternates: ['划掉：一个殡仪馆工人的救赎故事', '划掉：母子情深的回忆录'],
        title: '长夜将明',
        logline: '殡仪馆夜班员为查母亲死因替无名尸守七夜，代价是开始看见死者。',
        theme: '人能不能靠遗忘活下去。',
        promise: '每晚一个死者带来一条线索；铜钥匙从开不了门，到打开母亲锁着的抽屉，活人比死人更难审。',
        ending: '他查清真相，却必须亲手烧掉唯一能证明母亲清白的东西。',
        genreTags: ['悬疑', '民俗', '亲情'],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.premise}`,
    user: hardCap(ctx, user, BUDGET.premise.user),
    maxTokens: 1400,
    temperature: TEMPERATURE.premise,
  }
}

function biblePrompt(ctx) {
  const p = paramsOf(ctx)
  const seed = str(p.seed)
  const golden = goldenFingerText(pitchOf(ctx).goldenFinger || p.goldenFinger)
  const powerSystem = ['奇幻', '武侠', '玄幻', '仙侠'].includes(str(p.genre))
  const hardTitle = powerSystem ? '硬规则' : '硬约束'
  const elements = powerSystem
    ? '获得方式、规则边界、代价、3–5 级升级阶梯（每级：能做什么／要付什么）'
    : '这个设定能做什么、代价是什么、在什么条件下失效、三条不可违背的硬约束（第三段列明）'
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.bible.brief), `（缺失：先按故事种子判断这本书需要哪三条${hardTitle}。）`),
    seed ? section('灵感与母题', seed) : '',
    section('类型承诺', genrePromise(p.genre)),
    golden ? section('金手指（必须与 pitch 一致）', golden) : '',
    section('写作边界', `只写会反复用到的设定；每条${hardTitle}都要有代价和冲突出口；不写百科条目、不写年表、不解释正文能自己展示的东西。`),
    section('文风与尺度', styleText(ctx, BUDGET.bible.style), '（未指定：冷、具体、少形容词。）'),
    mdContract(`# 世界设定

## 一句话世界（≤40 字）
## 核心设定与约束（第二小标题，不得后移；${elements}）
## ${hardTitle}（3 条；每条：内容／边界／代价／会逼出什么冲突）
## 地点（3–6 个；每个：感官锚点／谁的地盘／暗藏的危险）
## 时代与日常（钱、交通、通信、权力、时间怎么过）
## 禁忌与代价（违反会发生什么；谁知道这条禁忌）
## 意象与物件（3–5 个，会在后文反复出现并变化）`),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.bible(hardTitle, elements)}`,
    user: hardCap(ctx, user, BUDGET.bible.user),
    maxTokens: 3000,
    temperature: TEMPERATURE.bible,
  }
}

/** 用户在新建时定死了主角性别，就在这里变成硬约束；auto 时什么都不说。 */
function protagonistRule(p) {
  const sex = sexOf(p.protagonistGender)
  if (!sex) return '- 用户没有指定主角性别：由你按故事核心定，定了就照此执行。'
  return `- 用户已指定主角性别为「${sex}」：主角必须写成${sex}性，代词固定用「${pronounOf(sex)}」，不得更改。`
}

function charactersPrompt(ctx) {
  const p = paramsOf(ctx)
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.characters.brief), '（缺失：从故事种子反推主角与对手，不要偏离类型。）'),
    section('世界设定', readText(ctx, 'bible', BUDGET.characters.bible), '（缺失：人物可以只依赖故事核心，但不要凭空发明世界规则。）'),
    section('类型承诺', genrePromise(p.genre)),
    section(
      '人物数量',
      'C4 核心 3–4 人（全书核心上限 10），写满四件套。首卷 C3 阶段 3 人，写 want、pressure、relations、recognitionTag。其余人物不在此处生成，由卷纲与章节登记。示例只展示重卡形状。'
    ),
    section(
      '性别与代词（必须先定，后文不得再改）',
      [
        '- 每个角色都要写 gender：只能是「男」或「女」；不许留空，不许写「未知」。',
        '- 同一个人的代词全书只有一个：男用「他」，女用「她」。正文、摘要、正典里都按这个来。',
        '- 名字不能暗示性别时（如「沈砚」「周岩」），更要在 gender 里写清，否则后文一定会混用。',
        protagonistRule(p),
      ]
        .filter(Boolean)
        .join('\n')
    ),
    jsonContract(
      [
        '- cast：array，C4 核心 3–4 人与首卷 C3 阶段 3 人',
        '- cast[].tier：C4 用 core，C3 用 major。以下 fear、secret、voice、arc、need、wound、lie、exit 仅 C4 填写',
        '- cast[].aliases：可选，去重后的别名数组，最多 3 个',
        '- cast[].recognitionTag：不超过 20 字的再识别标签，C3 必填，后续登记的 C2 及以下也须给标签',
        '- cast[].firstVolume：首次登场卷号，数字或 null',
        '- cast[].name：string，2–4 字，全书唯一',
        '- cast[].role：string，如"主角""对手""关键配角"',
        '- cast[].power：string，≤30 字，主角必填；起点能力／资源',
        '- cast[].growth：string，≤40 字，主角必填；成长轴（从能做什么，到能做什么）',
        '- cast[].cost：string，≤30 字，主角必填；每次用能力要付的代价',
        '- cast[].pressure：string，≤30 字，C3 及反派必填；角色受什么压力或如何施压',
        "- cast[].gender：string，'男' 或 '女'；必填，决定后文用「他」还是「她」",
        '- cast[].want：string，≤40 字，当下最想要的东西',
        '- cast[].fear：string，≤40 字，不敢面对的东西',
        '- cast[].secret：string，≤50 字，不能让人知道、且中段会爆炸的事',
        '- cast[].voice：string，两句话——第一句说话方式（句长／用词／口头禅／沉默时做什么），第二句行为底线（他会……；绝不会……）',
        '- cast[].arc：string，≤50 字，从……到……，必须由事件逼出来',
        '- cast[].need：string，≤30 字，C4 必填；他真正需要的（常与 want 相反）',
        '- cast[].wound：string，≤30 字，C4 必填；旧伤',
        '- cast[].lie：string，≤30 字，C4 必填；他相信的错误认知',
        '- cast[].exit：string，≤30 字，C4 必填；退场方式',
        '- cast[].relations：array，每项 {to, kind}；to 是已有人物名，kind 写不对称的关系',
      ],
      {
        cast: [
          {
            name: '沈砚',
            role: '主角',
            tier: 'core',
            gender: '女',
            want: '查清母亲真正的死因',
            fear: '自己也会在头七看见不该看见的东西',
            secret: '十岁那年见过一次死者回来，但一直说自己忘了',
            voice: '话少，句子短，紧张时重复对方最后一个词。她会为陌生人破例，绝不会在活人面前提母亲。',
            arc: '从靠规矩躲事，到主动破坏规矩换真相',
            need: '承认母亲已死，不再替她讨公道',
            wound: '十岁那年没能拉住母亲的手',
            lie: '只要守规矩，死人就不会找上门',
            exit: '烧掉守夜眼，做回普通人',
            power: '熟悉殡仪馆所有规矩，能值夜班',
            growth: '从看得见，到问得出一个问题',
            cost: '每用一次守夜眼，少记一段活人时的记忆',
            relations: [{ to: '周迟', kind: '互相利用的师徒，沈砚欠他一条命' }],
          },
        ],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.characters}`,
    user: hardCap(ctx, user, BUDGET.characters.user),
    maxTokens: 4096,
    temperature: TEMPERATURE.characters,
  }
}

/**
 * spine：脚本给卷表（卷数、卷序、每卷章数都已定死），模型只填主线／结局／每卷内容。
 * 条数必须等于 volumePlan 条数——这是"模型只填内容、不决定结构"的具体落点。
 */
function spinePrompt(ctx) {
  const p = paramsOf(ctx)
  const plan = volumePlanOf(ctx)
  const total = num(p.chapters, plan.reduce((sum, v) => sum + v.targetChapters, 0))
  const planLines = plan.map((v) => {
    const r = chapterRange(v, num(p.chaptersPerVolume, 30))
    return `第 ${v.index} 卷｜第 ${r.start}–${r.end} 章（${v.targetChapters} 章）｜工作标题：${v.title}`
  })
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.spine.brief), '（缺失：先按故事种子确定主角、对手与结局方向。）'),
    section('世界设定', readText(ctx, 'bible', BUDGET.spine.bible), '（缺失：只用故事核心与人物档案推进因果，不要补设定。）'),
    section('人物档案', castDump(ctx, BUDGET.spine.characters), '（缺失：先假定主角有一个当下欲望和一个不敢面对的秘密。）'),
    section(
      '卷表（脚本已定，不得改动）',
      [
        `全书 ${total} 章，分 ${plan.length} 卷。卷数、卷序、每卷目标章数不是你的决定。`,
        ...planLines,
        '工作标题只是占位，你可以换成更好的卷名；但 volumes 的条数、顺序、每卷对应的章数一个字都不能改。',
        '每卷的 payoffs 必须落在该卷「第 a–b 章」区间内，atChapter 用绝对章号。',
      ].join('\n'),
      ''
    ),
    jsonContract(
      [
        `- volumes：array，必须恰好 ${plan.length} 条，第 i 项只对应【卷表】第 i 卷；不许多、不许少、不许合并`,
        '- mainline：string，6–10 环因果链（因为……所以……），≤300 字',
        '- ending：string，≤120 字，最后一个画面＋代价＋主题的回答，不写过程',
        '- volumes[].title：string，2–12 字卷名，不带「第N卷」前缀（序号由脚本加）',
        '- volumes[].goal：string，≤60 字，本卷主角要拿到或守住的具体东西',
        '- volumes[].arc：string，≤60 字，本卷结束时他相信的东西怎么错、他变成什么样',
        '- volumes[].cast：string[]，1–4 个已有人物名',
        '- volumes[].opens：array，1–3 条；每条是 string（≤16 字）或 {text, dueIn}：dueIn 为绝对章号',
        '- volumes[].closes：string[]，0–3 条，每条 ≤16 字，本卷收掉的线',
        '- volumes[].payoffs：array，2–3 条，每项 {atChapter, level, text}；atChapter 必须落在本卷章号区间，level 只能 medium／large，text ≤40 字；每卷至少 1 条 large',
        '- volumes[].cliffhanger：string，≤40 字，本卷最后一章停在的具体动作／话／物件',
        '- volumes[].unitArcs：string[]，0–3 条，每条 ≤30 字，本卷能独立成立的单元剧目标',
        '- 不要输出 index／targetChapters／chapters 字段；卷数与章数由脚本管',
      ],
      {
        mainline:
          '因为母亲死因被写成意外，沈砚选择替无名尸守七夜换线索，所以被殡仪馆的规矩反噬，终于要在烧掉证据和留住母亲之间选一个。',
        ending: '他查清真相，却必须亲手烧掉唯一能证明母亲清白的东西；火光里他第一次没数钥匙。',
        volumes: [
          {
            title: '守夜',
            goal: '熬过七个头七，拿到第一份死亡登记',
            arc: '从靠规矩躲事，到第一次主动违规',
            cast: ['沈砚', '周迟'],
            opens: ['三号柜里的手机'],
            closes: ['母亲的死亡证明'],
            payoffs: [
              { atChapter: 3, level: 'medium', text: '第一次看见死者最后十分钟' },
              { atChapter: 6, level: 'large', text: '拿到母亲死亡登记' },
            ],
            cliffhanger: '三号柜自己弹开一条缝',
            unitArcs: ['替无名尸找到名字'],
          },
          {
            title: '借命',
            goal: '查出替死者守夜的规矩是谁定的',
            arc: '从相信规矩，到发现规矩是一场交易',
            cast: ['沈砚', '陈婆'],
            opens: ['袖口的香灰'],
            closes: ['三号柜'],
            payoffs: [
              { atChapter: 9, level: 'medium', text: '确认规矩是一场交易' },
              { atChapter: 12, level: 'large', text: '用守夜眼换来母亲最后一句话' },
            ],
            cliffhanger: '陈婆把香灰按进他掌心',
            unitArcs: ['查出谁在替死者签字'],
          },
        ],
      }
    ),
    section(
      '规模提示',
      [
        `你这一稿要写 ${plan.length} 卷。40 卷量级时整份 JSON 必须一次写完：`,
        '- 每卷各字段 ≤60 字；卷数超过 20 时压到 40 字以内，宁短勿长。',
        '- payoffs 每卷 2–3 条，atChapter 必须落在本卷区间；cliffhanger／unitArcs 宁短勿长。',
        '- cast 只写名字不写解释；opens／closes 每条 ≤16 字，不许写成句子。',
        '- 不要为了凑字数重复上一卷的说法；相邻卷的 goal 必须不同，arc 必须推进。',
      ].join('\n')
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.spine}`,
    user: hardCap(ctx, user, BUDGET.spine.user),
    maxTokens: 6000,
    temperature: TEMPERATURE.spine,
  }
}

/** 第一卷卷卡：opener 要跟脊柱对齐，但不重复整份脊柱。 */
function spineFirstVolumeText(ctx, max) {
  const spine = readJson(ctx, 'spine', null)
  const volumes = spine && Array.isArray(spine.volumes) ? spine.volumes : []
  const v = volumes[0]
  if (!v) return ''
  const payoffs = Array.isArray(v.payoffs)
    ? v.payoffs.map((x) => str(x && x.text ? x.text : x)).filter(Boolean).join('／')
    : ''
  return fit(
    ctx,
    [
      v.title ? `卷名：${str(v.title)}` : '',
      v.goal ? `目标：${str(v.goal)}` : '',
      v.arc ? `弧光：${str(v.arc)}` : '',
      payoffs ? `本卷爽点：${payoffs}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    max
  )
}

/** outline.json 已排的前三章：重跑时 opener 必须沿用，不许另起一套。 */
function outlineHeadText(ctx, max) {
  const outline = readJson(ctx, 'outline', null)
  const chapters = outline && Array.isArray(outline.chapters) ? outline.chapters : []
  const lines = chapters
    .slice(0, 3)
    .map((c) => {
      const hook = c && c.hook && typeof c.hook === 'object' ? c.hook : {}
      const title = str(c && c.title) || '（未命名）'
      return `第 ${num(c && c.index, 0) || '?'} 章《${title}》｜${str(hook.type)}｜${str(hook.text)}`
    })
    .filter((x) => x.trim().length > 4)
  return fit(ctx, lines.join('\n'), max)
}

/**
 * opener：黄金三章＝三次"承诺—兑现—更大的问题"。
 * 输出 opener.json；chapters 恰好 3 条，重跑必须沿用 outline 已有标题。
 */
function openerPrompt(ctx) {
  const user = [
    projectHeader(ctx),
    section(
      '商业定位（已定）',
      fit(ctx, commercialLines(ctx), BUDGET.opener.pitch),
      '（无 pitch：按类型承诺定读者与卖点。）'
    ),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.opener.brief), '（缺失：按故事种子判断第一章该抛什么。）'),
    section('第一卷脊柱', spineFirstVolumeText(ctx, BUDGET.opener.spine), '（缺失：前三章服务第一卷目标。）'),
    section('已排的前三章（有就沿用）', outlineHeadText(ctx, BUDGET.opener.chapters), '（还没排：你来排。）'),
    section('文风与尺度', styleText(ctx, BUDGET.opener.style), '（未指定：克制、具体、少形容词。）'),
    jsonContract(
      [
        '- version：number，固定 1',
        '- strategy：string，≤120 字，三章各承担什么承诺，一句一章',
        '- chapters：array，恰好 3 条，index 依次为 1／2／3',
        '- chapters[].title：string，≤16 字，有画面，不剧透结局',
        '- chapters[].hook：object，{type, text, strength}；type 只能是悬念／危机／反转／期待／情感／信息差，text≤40 字，strength 1–5',
        '- chapters[].payoff：object，{level, text, chapterDue}；level 只能是 small／medium／large，text≤40 字，chapterDue 1–3',
        '- chapters[].infoDrop：object，{readerLearns, characterLoses}；各 ≤40 字，每章只投一条必记信息',
        '- chapters[].promiseBeat：string，≤30 字，本章兑现了哪一句承诺',
        '- chapters[].endHook：string，六类钩子之一（写类型名，不写具体句子）',
        '- rules：object，固定 {payoffEveryChapters:[3,5], bigPayoffPerVolume:[2,3]}',
        '- degraded：string[]，0–3 条；没有就写 []',
      ],
      {
        version: 1,
        strategy: '第一章用母亲的电话把人拽进来；第二章让他第一次违规看见死者；第三章把"规矩是交易"摊开，留下更大的问题。',
        chapters: [
          {
            index: 1,
            title: '头七',
            hook: { type: '悬念', text: '三号柜里的手机响了，来电显示是母亲', strength: 4 },
            payoff: { level: 'small', text: '他确认声音来自登记簿里的手机', chapterDue: 1 },
            infoDrop: {
              readerLearns: '殡仪馆有"头七不接电话"的规矩',
              characterLoses: '他错过了最后一个能挂断的机会',
            },
            promiseBeat: '死者会带来线索',
            endHook: '悬念',
          },
          {
            index: 2,
            title: '第二夜',
            hook: { type: '危机', text: '三号柜自己打开，里面躺着他母亲', strength: 4 },
            payoff: { level: 'medium', text: '他第一次看见死者最后十分钟', chapterDue: 2 },
            infoDrop: {
              readerLearns: '守夜眼要拿活人的记忆换',
              characterLoses: '他忘了母亲生前最爱做的一道菜',
            },
            promiseBeat: '看见的代价是失去',
            endHook: '危机',
          },
          {
            index: 3,
            title: '交易',
            hook: { type: '反转', text: '定规矩的人就是替他母亲签字的人', strength: 5 },
            payoff: { level: 'medium', text: '他确认规矩是一场交易', chapterDue: 3 },
            infoDrop: {
              readerLearns: '守夜规矩是活人跟死人做的交易',
              characterLoses: '他失去了对周迟的最后一点信任',
            },
            promiseBeat: '规矩可以被查',
            endHook: '反转',
          },
        ],
        rules: { payoffEveryChapters: [3, 5], bigPayoffPerVolume: [2, 3] },
        degraded: [],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.opener}`,
    user: hardCap(ctx, user, BUDGET.opener.user),
    maxTokens: 2000,
    temperature: TEMPERATURE.opener,
  }
}

/** 正典里已开、还没收的线索：volumeChapters 的 threadDue 只能引用这里的原文。 */
function openThreadsText(ctx, max) {
  const canon = readJson(ctx, 'canon', null)
  const threads = canon && Array.isArray(canon.threads) ? canon.threads : []
  const lines = threads
    .filter((t) => {
      const status = str(t && t.status)
      return t && str(t.text) && (!status || status === 'open' || status === '未回收')
    })
    .map((t) => {
      const due = num(t.dueIn, 0)
      const level = str(t.payoffLevel) || str(t.level)
      const tail = due ? `（第 ${due} 章前回收${level ? `，${level}` : ''}）` : ''
      return `- ${str(t.text)}${tail}`
    })
  return fit(ctx, lines.join('\n'), max)
}

/** opener.json 已定的前三章：volumeChapters 重跑时沿用标题与钩子类型。 */
function renderOpenerChapters(ctx, max) {
  const opener = readJson(ctx, 'opener', null)
  const chapters = opener && Array.isArray(opener.chapters) ? opener.chapters : []
  const lines = chapters.slice(0, 3).map((c) => {
    const hook = c && c.hook && typeof c.hook === 'object' ? c.hook : {}
    const payoff = c && c.payoff && typeof c.payoff === 'object' ? c.payoff : {}
    const info = c && c.infoDrop && typeof c.infoDrop === 'object' ? c.infoDrop : {}
    return [
      `第 ${num(c && c.index, 0) || '?'} 章《${str(c && c.title) || '未命名'}》`,
      `章末钩子：${str(hook.type) || '?'}／强度 ${num(hook.strength, 0) || '?'}`,
      `爽点：${str(payoff.level) || '?'}／第 ${num(payoff.chapterDue, 0) || '?'} 章兑现`,
      str(info.readerLearns) ? `读者要知道：${str(info.readerLearns)}` : '',
    ]
      .filter(Boolean)
      .join('｜')
  })
  return fit(ctx, lines.join('\n'), max)
}

/**
 * beats 的前三章开篇约定：优先用 ctx.openerChapter（本批现成的那一章），
 * 没有就读 opener.json 的对应章；只给 payoff 与 infoDrop，不写正文。
 */
function openerChapterOf(ctx, n) {
  const direct = ctx && ctx.openerChapter
  if (direct) {
    if (typeof direct === 'string' && direct.trim()) return fit(ctx, direct, 600)
    if (typeof direct === 'object') {
      const payoff = direct.payoff && typeof direct.payoff === 'object' ? direct.payoff : {}
      const info = direct.infoDrop && typeof direct.infoDrop === 'object' ? direct.infoDrop : {}
      const text = [
        str(direct.title) ? `第 ${n} 章《${str(direct.title)}》` : '',
        str(payoff.text) ? `爽点：${str(payoff.level) || '?'}｜${str(payoff.text)}` : '',
        str(info.readerLearns) ? `读者必须知道：${str(info.readerLearns)}` : '',
        str(info.characterLoses) ? `角色必须失去：${str(info.characterLoses)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      if (text) return fit(ctx, text, 600)
    }
  }

  const opener = readJson(ctx, 'opener', null)
  const chapters = opener && Array.isArray(opener.chapters) ? opener.chapters : []
  const c = chapters.find((x) => num(x && x.index, 0) === n) || chapters[n - 1]
  if (!c) return ''
  const payoff = c.payoff && typeof c.payoff === 'object' ? c.payoff : {}
  const info = c.infoDrop && typeof c.infoDrop === 'object' ? c.infoDrop : {}
  return fit(
    ctx,
    [
      `第 ${n} 章《${str(c.title) || '未命名'}》`,
      str(payoff.text) ? `爽点：${str(payoff.level) || '?'}｜${str(payoff.text)}` : '',
      str(info.readerLearns) ? `读者必须知道：${str(info.readerLearns)}` : '',
      str(info.characterLoses) ? `角色必须失去：${str(info.characterLoses)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    600
  )
}

/**
 * volumeChapters：一次展开一卷中的指定章号区间，模型只填每章内容。
 */
function volumeChaptersPrompt(ctx) {
  const p = paramsOf(ctx)
  const volume = currentVolume(ctx)
  const fullVolume = ctx?.fullVolume ?? volume
  const range = chapterRange(volume, num(p.chaptersPerVolume, 30))
  const { prev, next } = neighbourVolumes(ctx, range.index)
  const digest = str(ctx && ctx.previousDigest)
  const titles = existingTitles(ctx, BUDGET.volumeChapters.titles)
  const openerRank = range.start <= 3 ? renderOpenerChapters(ctx, 600) : ''
  const fixed = [
    '【写作纪律】',
    `1. 本批请给 ${range.target} 章：chapters 必须恰好 ${range.target} 条，第 1 条是第 ${range.start} 章，最后一条是第 ${range.end} 章。`,
    '2. 不要写正文，不要写对白；每章只给目标、冲突、转折、钩子。',
    '3. 不要复述前面章节已经写过的内容；上一章的 hook 只用来接住开场压力。',
    '4. 钩子必须留悬念：本章不许把自己的问题解决掉，解决要留到后面。',
    range.target >= 40
      ? `5. 本卷章数多（${range.target} 章），字段再压短：goal／conflict ≤24 字、turn ≤30 字、hook ≤24 字，保证整份 JSON 一次写完不被截断。`
      : '5. 每章都必须是可写的戏，不要出现"过渡章""铺垫章"。',
    '6. 节奏：每 3–5 章至少一次 small｜medium 爽点；hookStrength 不得连续 3 章 ≤2；本卷最后一章 hookStrength 必须是 5。',
    '7. threadDue 只能原样引用【待回收线索】清单里的文本，每条 ≤16 字；清单为空就写 []，不要自己造线索。',
    '8. track 是 unit／main／both；unitArc 是单元剧目标（≤30 字），纯主线章可以不填。',
    openerRank ? '9. 有【开篇前三章（已定）】时，本批与第 1–3 章重叠的条目必须按章号沿用 title 与 hookType。' : '',
  ]
    .filter(Boolean)
    .join('\n')
  const materials = fitSections(
    ctx,
    [
      {
        text: [
          volumeCard(ctx, fullVolume),
          prev ? `上一卷：${volumeLines(prev)}` : '',
          next ? `下一卷：${volumeLines(next)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        cap: BUDGET.volumeChapters.spine,
      },
      { text: readText(ctx, 'bible', BUDGET.volumeChapters.bible), cap: BUDGET.volumeChapters.bible },
      { text: castDump(ctx, BUDGET.volumeChapters.characters), cap: BUDGET.volumeChapters.characters },
      { text: digest, cap: BUDGET.volumeChapters.digest },
      { text: titles ? `已用过的章名（不要重名，也不要只换一个字）：\n${titles}` : '', cap: BUDGET.volumeChapters.titles },
      { text: openThreadsText(ctx, BUDGET.volumeChapters.threads), cap: BUDGET.volumeChapters.threads },
    ],
    BUDGET.volumeChapters.user - 3300
  )
  const user = [
    projectHeader(ctx),
    section('全书脊柱', prettyArtifact(ctx, 'spine', BUDGET.volumeChapters.spine), '（缺失：按本卷目标与弧光排章。）'),
    section('世界设定', materials[1] || '', '（缺失：不要新增世界规则。）'),
    section('人物档案', materials[2] || '', '（缺失：cast 只用本章卷目标里提到的人。）'),
    section('本卷前情', materials[3] || '', '（本卷还没写：按卷目标开场。）'),
    materials[4] ? section('已有章名', materials[4]) : '',
    section(
      '待回收线索（canon 已开）',
      materials[5] || '',
      '（正典里还没有 open 的线索：threadDue 一律写 []，不要编造线索。）'
    ),
    openerRank ? section('开篇前三章（已定，必须沿用）', openerRank, '') : '',
    section('卷卡与前后卷', materials[0] || '', ''),
    fixed,
    jsonContract(
      [
        `- chapters：array，必须恰好 ${range.target} 条；第 1 条＝第 ${range.start} 章，最后一条＝第 ${range.end} 章`,
        '- newCharacters：可选，本批新登场的本卷 C3 阶段人物，数组 [{name, role, want, pressure}]；没有则 []',
        '- chapters[].title：string，≤16 字，有画面，不剧透结局',
        '- chapters[].goal：string，≤40 字，本章谁想要什么',
        '- chapters[].conflict：string，≤40 字，什么挡着',
        '- chapters[].turn：string，≤50 字，必须改变力量／信息／关系／时间压力',
        '- chapters[].hook：string，≤40 字，具体动作／话／物件／即将发生的事',
        '- chapters[].pov：string，与项目视角一致',
        '- chapters[].when：string，≤20 字',
        '- chapters[].where：string，≤20 字',
        '- chapters[].cast：string[]，1–4 个已有人物或本卷 newCharacters 已登记的名字',
        '- chapters[].hookType：string，六类之一：悬念／危机／反转／期待／情感／信息差',
        '- chapters[].hookStrength：number，1–5',
        '- chapters[].payoff：object，{level: small|medium|large, text≤40}；没有就 level 写 none、text 写空串',
        '- chapters[].infoDrop：string，≤40 字，本章读者新知道的那一条信息',
        '- chapters[].track：string，unit／main／both',
        '- chapters[].unitArc：string，≤30 字，本卷单元剧目标；纯主线章可写空串',
        '- chapters[].threadDue：string[]，0–3 条，只引用【待回收线索】原文（每条 ≤16 字）',
        '- 不要输出 id／index／volume：章号由脚本发',
      ],
      {
        chapters: [
          {
            title: '头七',
            goal: '熬过第一夜，不打开三号柜',
            conflict: '三号柜每隔十分钟响一次',
            turn: '他发现响的不是柜子，是登记簿里的手机',
            hook: '电话那头叫出他母亲的名字',
            pov: '第三人称限知',
            when: '头七夜十一点',
            where: '殡仪馆值班室',
            cast: ['沈砚'],
            hookType: '悬念',
            hookStrength: 4,
            payoff: { level: 'small', text: '确认声音来自登记簿里的手机' },
            infoDrop: '殡仪馆有"头七不接电话"的规矩',
            track: 'both',
            unitArc: '替无名尸找到名字',
            threadDue: ['三号柜里的手机'],
          },
        ],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.volumeChapters}`,
    user: hardCap(ctx, user, BUDGET.volumeChapters.user),
    maxTokens: 6000,
    temperature: TEMPERATURE.volumeChapters,
  }
}

function prevGoal(ctx) {
  const ch = currentChapter(ctx)
  const items = Array.isArray(ctx && ctx.items) ? ctx.items : []
  const byId = items.findIndex((x) => x && x.id === ch.id)
  const idx = byId >= 0 ? byId : typeof (ctx && ctx.index) === 'number' ? ctx.index : -1
  const prev = idx > 0 ? items[idx - 1] : null
  if (!prev) return '（无）'
  return [prev.goal, prev.hook ? `钩子：${prev.hook}` : ''].filter(Boolean).join('；') || '（无）'
}

function nextGoal(ctx) {
  const ch = currentChapter(ctx)
  const items = Array.isArray(ctx && ctx.items) ? ctx.items : []
  const byId = items.findIndex((x) => x && x.id === ch.id)
  const idx = byId >= 0 ? byId : typeof (ctx && ctx.index) === 'number' ? ctx.index : -1
  const next = idx >= 0 ? items[idx + 1] : null
  if (!next) return '（无）'
  return [next.goal, next.turn ? `转折：${next.turn}` : ''].filter(Boolean).join('；') || '（无）'
}

function nextChapterLine(ctx) {
  const ch = currentChapter(ctx)
  const items = Array.isArray(ctx && ctx.items) ? ctx.items : []
  const byId = items.findIndex((x) => x && x.id === ch.id)
  const idx = byId >= 0 ? byId : typeof (ctx && ctx.index) === 'number' ? ctx.index : -1
  const next = idx >= 0 ? items[idx + 1] : null
  if (next) {
    return [
      `下一章（${str(next.id)}）《${str(next.title)}》`,
      next.goal ? `目标：${next.goal}` : '',
      next.turn ? `转折：${next.turn}` : '',
      next.hook ? `钩子：${next.hook}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  // items 为空或尚未生成下一章时，用 id/总章数推断，不要误报"最后一章"。
  const total = num(ctx && ctx.total, 0)
  const n = chapterNo(ctx)
  const nextId = itemIdAt(ctx, 1)
  if (nextId && (!total || n < total)) {
    return `下一章（${nextId}）：目标与转折尚未生成；本章只埋线，不要提前解决。`
  }
  return '这是全书最后一章：收束主线，给一个具体、有代价的落点；不要再开新坑。'
}

/**
 * beats：一章的场景拆解。输出比 v0.1 窄（2200 tokens），
 * detail 取代 exit+sensory，顶部的 beats[] 是给后文检索的一句话节拍。
 */
function beatsPrompt(ctx) {
  const ch = chapterOf(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const volume = currentVolume(ctx)
  const p = paramsOf(ctx)
  const prevId = itemIdAt(ctx, -1)
  const prevSummary = str(ctx && ctx.previousSummary) || readText(ctx, `summary/${prevId}`, BUDGET.beats.prev)
  const openerChapter = n <= 3 ? openerChapterOf(ctx, n) : ''
  const user = [
    projectHeader(ctx),
    section('本章任务', chapterCard(ch, n), '（缺失：按项目规模与上一章钩子自行确定本章目标与转折。）'),
    section('类型承诺', genrePromise(p.genre)),
    openerChapter ? section('开篇约定（本批前三章，必须兑现）', openerChapter, '') : '',
    section(
      '所属卷',
      volumeLines(volume) || '（无卷信息：按本章任务推进，不要提前收束主线。）',
      ''
    ),
    section(
      '上一章摘要',
      prevSummary,
      prevId ? '（摘要缺失：不要凭空引用前情，只用本章任务与正典。）' : '（第一章，无前情。）'
    ),
    section('正典', canonTextOf(ctx, BUDGET.beats.canon), '（正典为空：本章可以建立新事实，一旦写下后文必须遵守。）'),
    section('人物速查', castBriefOf(ctx, chapterCastNames(ctx, ch), BUDGET.beats.cast), '（档案缺失：只用本章任务里出现的名字。）'),
    section(
      '数量硬约束',
      `scenes 必须 5–9 场；beats 必须 5–8 条；示例只列 1 场，是形状示范，不要照着只写 1 场。${openerChapter ? ' 本章必须至少一场兑现 opener 的 payoff，且 info 与 opener 的 infoDrop.readerLearns 是同一条。' : ''}`
    ),
    jsonContract(
      [
        '- scenes：array，5–9 项，按发生顺序',
        '- scenes[].goal：string，≤28 字，这场戏谁想要什么',
        '- scenes[].obstacle：string，≤28 字，什么挡着',
        '- scenes[].turn：string，≤36 字，局面怎么变',
        '- scenes[].detail：string，≤40 字，能拍出来的具体物／动作',
        '- 每场只新增一个信息或一个人物；新名字一次给全，不要叠在同场',
        '- scenes[].cast：string[]，1–4 个已有人物名；同场有台词的具名角色 ≤4',
        '- scenes[].function：string，≤20 字，一句话说明这场在全书里干什么',
        '- scenes[].payoff：string，small／medium／none，本场给出的爽点等级',
        '- scenes[].info：string，≤30 字，本场读者新知道的一条信息',
        '- hook：string，≤40 字，本章最后落在的具体悬念',
        '- hookType：string，六类之一：悬念／危机／反转／期待／情感／信息差',
        '- hookStrength：number，1–5',
        '- beats：string[]，5–8 条，每条 ≤30 字，一句话节拍，按发生顺序，以动词开头',
      ],
      {
        scenes: [
          {
            goal: '熬过第一夜，不打开三号柜',
            obstacle: '三号柜每隔十分钟响一次',
            turn: '他发现响的不是柜子，是登记簿里的手机',
            detail: '冰柜低鸣；他数到第三声时，手指停在登记簿边缘',
            function: '让沈砚第一次相信规矩会杀人',
            cast: ['沈砚'],
            payoff: 'small',
            info: '殡仪馆有"头七不接电话"的规矩',
          },
        ],
        hook: '电话那头叫出他母亲的名字',
        hookType: '悬念',
        hookStrength: 4,
        beats: ['沈砚接班', '三号柜开始响', '她查监控', '发现声音来自登记簿', '接起电话'],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.beats}`,
    user: hardCap(ctx, user, BUDGET.beats.user),
    maxTokens: 2200,
    temperature: TEMPERATURE.beats,
  }
}

/** packet 缺失时的最小兜底：正常路径（chapter.prepareChapter）永远有 packet。 */
function fallbackPacket(ctx) {
  const p = paramsOf(ctx)
  const ch = chapterOf(ctx)
  const n = chapterNo(ctx)
  const lines = [
    '【写作要求】',
    `章号：${str(ch.id) || `ch${String(n).padStart(2, '0')}`}`,
    `标题：${str(ch.title) || '（未命名）'}`,
    `本章目标：${str(ch.goal) || '（未给出，按本章冲突推进）'}`,
    `视角：${str(p.pov) || '第三人称限知'}`,
    `字数要求：${num(p.wordsPerChapter, 3000)} 字左右`,
    '输出格式：先写正文；正文结束后输出 <<<SUMMARY>>> 与本章摘要；摘要结束后输出 <<<CANON>>> 与正典补丁 JSON。',
  ]
  if (ch.conflict) lines.push(`核心冲突：${str(ch.conflict)}`)
  if (ch.turn) lines.push(`关键转折：${str(ch.turn)}`)
  if (ch.hook) lines.push(`结尾钩子：${str(ch.hook)}`)
  return lines.join('\n')
}

/**
 * draft：user 严格等于 ctx.packet.text（architecture-v2 §5.2 / §12）。
 * 本函数不拼任何材料；只有 ctx.packet 缺失时才退化成最小写作要求，避免调用方直接炸掉。
 */
function draftPrompt(ctx) {
  const p = paramsOf(ctx)
  const words = num(p.wordsPerChapter, 3000)
  const pov = str(p.pov) || '第三人称限知'
  const packetText = str(ctx && ctx.packet && ctx.packet.text)
  const system = [
    CRAFT,
    [
      ADDENDA.draft,
      `- 本章 ${words} 字（${Math.round(words * 0.9)}–${Math.round(words * 1.15)} 字），视角 ${pov}；别注水。`,
    ].join('\n'),
    inlineProtocolBlock(),
  ].join('\n\n')
  return {
    system,
    user: packetText || fallbackPacket(ctx),
    maxTokens: Math.min(16000, Math.round(words * 2.2)),
    temperature: TEMPERATURE.draft,
  }
}

function summaryPrompt(ctx) {
  const p = paramsOf(ctx)
  const ch = chapterOf(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const words = num(p.wordsPerChapter, 3000)
  const text = draftTextOf(ctx, chId)
  const user = [
    projectHeader(ctx),
    section('本章任务', chapterCard(ch, n), '（缺失：以正文实际发生为准。）'),
    section('本章正文', fitEnds(ctx, text, BUDGET.summary.draft), `（正文缺失：请在输出里写"正文缺失，无法摘要"，不要编造。约 ${words} 字。）`),
    section('本章细纲', beatsMaterial(ctx, chId, BUDGET.summary.beats), '（细纲缺失：以正文实际发生为准，不要补设定。）'),
    mdContract(`发生：……
知情：……
钩子：……
时空：……`),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.summary}`,
    user: hardCap(ctx, user, BUDGET.summary.user),
    maxTokens: 900,
    temperature: TEMPERATURE.summary,
  }
}

/** canonPatch 的紧凑契约：user 只有 1600 字，不能再用 jsonContract 的长字段表。 */
const CANON_PATCH_CONTRACT = [
  '【输出格式】只输出一个 JSON 对象，不要代码块以外的字：',
  '{"facts":[{"s":"沈砚","p":"状态","o":"左手受伤","tags":["character:沈砚"]}],"notes":[{"text":"换班在凌晨三点","tags":["place:殡仪馆"]}],"threads":[{"text":"袖口的香灰","status":"open","closedIn":null}],"entities":{"沈砚":{"state":"左手受伤","location":"值班室","knows":["三号柜有手机"]}},"timeline":[{"when":"头七夜","event":"第一次开柜"}]}',
  '- 只写有变化的字段；全都没变化就输出 {}，不要输出空数组套壳。facts 的 p 只能是 状态｜位置｜持有｜关系｜身份。',
].join('\n')

/**
 * canonPatch：正文没带内联正典块（或解析失败）时的独立小调用。
 * 只做登记：≤8 条、只记下一章会用到的、没变化返回 {}。
 */
function canonPatchPrompt(ctx) {
  const ch = chapterOf(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const summary = str(ctx && ctx.summary) || readText(ctx, `summary/${chId}`, BUDGET.canonPatch.summary)
  const fixed = [
    section('本章', `第 ${n} 章${str(ch.title) ? `《${str(ch.title)}》` : ''}（${chId}）`, ''),
    [
      '【登记规则】',
      '只记本章新出现或改变的、下一章会用到的事实；前文已登记且本章没变的，一条都不要写。',
      '≤8 条，宁少勿多；没变化就输出 {}。时间、伤势、钱、物品、知情范围以正文实际写到的为准，不要推测。',
    ].join('\n'),
    CANON_PATCH_CONTRACT,
  ]
    .filter(Boolean)
    .join('\n\n')
  const room = Math.max(200, BUDGET.canonPatch.user - fixed.length - 60)
  const [summarySlice, beatsSlice, canonSlice] = fitSections(
    ctx,
    [
      { text: summary, cap: BUDGET.canonPatch.summary },
      { text: beatsMaterial(ctx, chId, BUDGET.canonPatch.beats), cap: BUDGET.canonPatch.beats },
      { text: canonTextOf(ctx, BUDGET.canonPatch.canon), cap: BUDGET.canonPatch.canon },
    ],
    room
  )
  const user = [
    fixed,
    section('本章摘要', summarySlice || '', '（摘要缺失：不要凭空登记，直接输出 {}。）'),
    section('本章细目', beatsSlice || '', '（细目缺失：以摘要为准。）'),
    section('现有正典（用于去重）', canonSlice || '', '（正典为空：本章是第一次登记。）'),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.canonPatch}`,
    user: hardCap(ctx, user, BUDGET.canonPatch.user),
    maxTokens: 1200,
    temperature: TEMPERATURE.canonPatch,
  }
}

/**
 * 机器读数：字段名以 craft.js 的 checkDraft().stats 为准（v0.3）。
 * 缺失字段跳过，0 是有效读数（AI 标记 0 处也要让审校看见）。全空返回 ''，
 * 由调用处渲染「无机器读数」兜底。
 */
function craftStatsText(ctx) {
  const s = ctx && ctx.craftStats && typeof ctx.craftStats === 'object' ? ctx.craftStats : {}
  const num = (key) => {
    const value = Number(s[key])
    return Number.isFinite(value) ? value : null
  }
  const ratio = num('dialogueRatio')
  const pct = (key) => {
    const value = num(key)
    if (value == null) return null
    return Math.round((value <= 1 ? value * 100 : value) * 10) / 10
  }
  const bits = [
    num('cjk') == null ? '' : `全章 ${num('cjk')} 字`,
    num('paragraphs') == null ? '' : `${num('paragraphs')} 段`,
    num('sceneCount') == null ? '' : `${num('sceneCount')} 场`,
    num('avgSentenceLen') == null ? '' : `平均句长 ${num('avgSentenceLen')} 字`,
    num('maxSentenceLen') == null ? '' : `最长句 ${num('maxSentenceLen')} 字`,
    num('shortSentenceRatio') == null ? '' : `短句（≤12 字）占比 ${num('shortSentenceRatio')}%`,
    num('short8Per200') == null ? '' : `短句（≤8 字）${num('short8Per200')} 句/200 字`,
    num('dePer100') == null ? '' : `「的」密度 ${num('dePer100')}/百字`,
    num('beiPer100') == null ? '' : `「被」密度 ${num('beiPer100')}/百字`,
    num('nominalPer1k') == null ? '' : `名词化密度 ${num('nominalPer1k')}/千字`,
    ratio == null ? '' : `对话比 ${Math.round((ratio <= 1 ? ratio * 100 : ratio) * 10) / 10}%`,
    num('sensoryPer1k') == null ? '' : `感官密度 ${num('sensoryPer1k')}/千字`,
    num('bigramTtr') == null ? '' : `二字组多样性 ${num('bigramTtr')}`,
    num('charVariety') == null ? '' : `汉字种类 ${num('charVariety')}`,
    num('turnCount') == null ? '' : `对话 ${num('turnCount')} 轮`,
    num('avgTurnLen') == null ? '' : `单轮均长 ${num('avgTurnLen')} 字`,
    pct('questionRatio') == null ? '' : `问句占比 ${pct('questionRatio')}%`,
    pct('actionBetweenRatio') == null ? '' : `对话间动作 ${pct('actionBetweenRatio')}%`,
    num('abstractEmotionPer1k') == null ? '' : `抽象情绪密度 ${num('abstractEmotionPer1k')}/千字`,
    num('adverbPer1k') == null ? '' : `副词密度 ${num('adverbPer1k')}/千字`,
    num('aiMarkerCount') == null ? '' : `AI 标记 ${num('aiMarkerCount')} 处`,
    num('nameDensity') == null ? '' : `活跃人名 ${num('nameDensity')} 个/1500 字`,
  ].filter(Boolean)
  return bits.length ? bits.join('｜') : ''
}

function reviewPrompt(ctx) {
  const ch = chapterOf(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const prevId = itemIdAt(ctx, -1)
  const draft = str(ctx && ctx.draft) || readText(ctx, `draft/${chId}`)
  const prevSummary = str(ctx && ctx.previousSummary) || readText(ctx, `summary/${prevId}`, BUDGET.review.prev)
  const nextLine = str(ctx && ctx.nextGoal) || nextChapterLine(ctx)
  const promises = [
    ['章目标', ch.goal],
    ['冲突', ch.conflict],
    ['章末钩子类型', ch.hookType],
    ['章末钩子内容', ch.hookText],
    ['章末钩子强度', Number(ch.hookStrength) > 0 ? ch.hookStrength : null],
  ]
    .map(([label, value]) => [label, str(value)])
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}：${value}`)
    .join('\n')
  const user = [
    projectHeader(ctx),
    section('审校对象', `第 ${n} 章${ch.title ? `《${ch.title}》` : ''}（${chId}）`, ''),
    section('本章对读者的承诺', promises, '（章卡未填写承诺，跳过此项核对。）'),
    section('机器读数', craftStatsText(ctx), '（无机器读数：按正文自行判断，不要编造读数。）'),
    section(
      '本章正文',
      fitEnds(ctx, draft, BUDGET.review.draft),
      '（正文缺失：输出 verdict=revise，findings 里写明"正文缺失"，不要编造问题。）'
    ),
    section('本章细纲', beatsMaterial(ctx, chId, BUDGET.review.beats), '（缺失：只能按正文与正典对账。）'),
    section('正典', canonTextOf(ctx, BUDGET.review.canon), '（正典为空：只检查本章内部与前文的一致性。）'),
    section('人物速查', castBriefOf(ctx, chapterCastNames(ctx, ch), BUDGET.review.cast), '（档案缺失：只按正文里的人物表现对账。）'),
    section('代词对照', pronounLine(ctx), '（档案没写性别：只按正文内部是否自洽判断。）'),
    section('上一章摘要', prevSummary, prevId ? '（无）' : '（第一章。）'),
    section('下一章要发生', nextLine, '（无。）'),
    jsonContract(
      [
        '- findings：array；没有问题也要给 []',
        "- findings[].severity：'block' | 'warn' | 'note'",
        '- findings[].kind：string，如 事实／时间线／知情／视角／性别／AI腔／节奏／对话；代词与人物性别对不上就记「性别」',
        '- findings[].where：string，第几段或引用原句（≤30 字），必须能定位',
        '- findings[].quote：string，必填，从【本章正文】逐字复制 8–120 字',
        '- findings[].issue：string，≤60 字，说清哪里错、为什么错',
        '- findings[].fix：string，≤60 字，怎么改：删哪句／换成什么动作／补什么细节',
        "- verdict：'pass' | 'revise'；有 block 或 warn ≥3 且涉及词频之外的问题时为 revise",
        '- 不要输出 ledgerPatch；正典由本章自己的 canon patch 维护',
      ],
      {
        findings: [
          {
            severity: 'warn',
            kind: '知情',
            where: '第 7 段「你怎么知道钥匙在花盆下面」',
            quote: '你怎么知道钥匙在花盆下面？',
            issue: '周迟第 3 章才拿到钥匙，此处却说漏藏钥匙的位置，视角人物也没有起疑。',
            fix: '把台词改成试探性问法，或补一句沈砚注意到他说漏嘴。',
          },
        ],
        verdict: 'revise',
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.review}`,
    user: hardCap(ctx, user, BUDGET.review.user),
    maxTokens: 4000,
    temperature: TEMPERATURE.review,
  }
}

/**
 * revise：user = packet.text（含【需修正】分片）+ 独立 findings + 原文。
 * 剩余额度按「原文优先、材料包其次、findings 最后」分配，保证正文能整章给到模型。
 */
function revisePrompt(ctx) {
  const p = paramsOf(ctx)
  const ch = chapterOf(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const words = num(p.wordsPerChapter, 3000)
  const findings = findingsText(ctx, chId, BUDGET.revise.review)
  const instruction = [
    '【修订指令】',
    `1. 只改【需修正】点名的位置；没被点名的段落尽量保持原样。`,
    `2. 输出完整正文，第一行仍是「## 第${n}章${ch.title ? ` ${ch.title}` : ' 标题'}」，段落之间空行。`,
    `3. 总字数与原文相差不超过 10%（原文约 ${words} 字）；宁少勿注水。`,
    '4. 不要解释改了什么，不要输出修改说明或对照表。',
    '5. 代词：同一个人全章只用「他」或「她」中的一个；原文前后不一致时，按【代词对照】统一。',
    findings ? '' : '6. 没有审校意见：只做逐句的最小润色（错别字、重复、标点、明显病句），不要改情节、结构、段落顺序。',
  ]
    .filter(Boolean)
    .join('\n')

  const compose = (packetMax, findingsMax, draftMax) =>
    [
      section('材料包', fit(ctx, str(ctx && ctx.packet && ctx.packet.text), packetMax), '（材料包缺失：只用下面的原文与修订指令；材料缺失时不要自造设定。）'),
      section('需修正', fit(ctx, findings, findingsMax), '（没有审校意见：只做最小润色。）'),
      section('原文', fitEnds(ctx, draftTextOf(ctx, chId), draftMax), '（正文缺失：直接输出"正文缺失，无法修订"，不要编造正文。）'),
      instruction,
      inlineSummaryBlock(),
    ]
      .filter(Boolean)
      .join('\n\n')

  let packetMax = 5200
  let findingsMax = BUDGET.revise.review
  let draftMax = Math.min(BUDGET.revise.draft, 9000)
  let user = compose(packetMax, findingsMax, draftMax)
  let over = user.length - BUDGET.revise.user
  if (over > 0) {
    draftMax = Math.max(1500, draftMax - over)
    user = compose(packetMax, findingsMax, draftMax)
    over = user.length - BUDGET.revise.user
  }
  if (over > 0) {
    packetMax = Math.max(0, packetMax - over)
    user = compose(packetMax, findingsMax, draftMax)
    over = user.length - BUDGET.revise.user
  }
  if (over > 0) {
    findingsMax = Math.max(600, findingsMax - over)
    user = compose(packetMax, findingsMax, draftMax)
  }

  return {
    system: `${CRAFT}\n\n${ADDENDA.revise}`,
    user: hardCap(ctx, user, BUDGET.revise.user),
    maxTokens: Math.min(16000, Math.round(words * 2.2)),
    temperature: TEMPERATURE.revise,
  }
}

function blurbPrompt(ctx) {
  const p = paramsOf(ctx)
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.blurb.brief), '（缺失：从故事脊柱反推 logline 与结局方向。）'),
    section('故事脊柱', prettyArtifact(ctx, 'spine', BUDGET.blurb.spine), '（缺失：只按人物与故事核心写，不要编造情节。）'),
    section('卷与章名', titleDigest(ctx, BUDGET.blurb.titles), '（缺失：不写具体章节，只写处境与压力。）'),
    section('人物档案', castDump(ctx, BUDGET.blurb.characters), '（缺失：只写主角与对手，不要新增人物。）'),
    section('类型承诺', genrePromise(p.genre)),
    section(
      '文案边界',
      '不剧透结局；不写"这是一个关于……的故事"；不写"最终他能否……"；简介停在抉择前，让读者自己想知道下一步。'
    ),
    mdContract(`# 《书名》
一句话卖点：……（≤40 字）
## 简介
（300 字左右，2–3 段；第一段具体处境与异常，第二段压力升级与代价，第三段停在抉择前；不剧透结局）
## 标签
标签1 / 标签2 / 标签3 / 标签4`),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.blurb}`,
    user: hardCap(ctx, user, BUDGET.blurb.user),
    maxTokens: 1400,
    temperature: TEMPERATURE.blurb,
  }
}

/* ------------------------------------------------------------------ *
 * 4. 出口
 * ------------------------------------------------------------------ */

export function createPrompts() {
  return {
    pitch: pitchPrompt,
    premise: premisePrompt,
    bible: biblePrompt,
    characters: charactersPrompt,
    spine: spinePrompt,
    opener: openerPrompt,
    volumeChapters: volumeChaptersPrompt,
    beats: beatsPrompt,
    draft: draftPrompt,
    summary: summaryPrompt,
    canonPatch: canonPatchPrompt,
    review: reviewPrompt,
    revise: revisePrompt,
    blurb: blurbPrompt,
  }
}

export default createPrompts
