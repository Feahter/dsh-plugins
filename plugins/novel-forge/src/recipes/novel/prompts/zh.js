/**
 * 墨炉 · 中文提示词（novel recipe）
 *
 * 契约：docs/architecture.md §4.3（输入预算）/ §4.4（输出格式）/ §4.5（质量门槛）。
 * 每个 builder 接收 engine 的 stage ctx，返回 { system, user, maxTokens, temperature? }。
 * 本文件是纯函数：不读盘、不发网络、不调模型、不改 ctx。
 */

const FENCE = '```'

/* ------------------------------------------------------------------ *
 * 1. 常量
 * ------------------------------------------------------------------ */

/**
 * 类型承诺：不是"类型标签"，而是"读者持续会得到什么"。
 * premise / bible / outline 会引用，用来防止写成四不像。
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
 * 输入预算（字符）。draft 对应 architecture.md §4.3；
 * 其余阶段按同一逻辑给了同级上限，避免长上下文把关键材料挤到中段。
 */
const BUDGET = {
  premise: { seed: 2000, style: 600, user: 6000 },
  bible: { brief: 1800, seed: 600, style: 600, user: 9000 },
  characters: { brief: 1800, bible: 3500, user: 10000 },
  spine: { brief: 1500, bible: 2500, characters: 3000, user: 11000 },
  outline: { brief: 1200, bible: 1800, characters: 2400, spine: 2600, user: 11800 },
  beats: { chapter: 1800, neighbours: 900, prev: 800, ledger: 2200, cast: 1400, style: 700, user: 10500 },
  draft: { beats: 2500, prev: 800, ledger: 3000, next: 400, cast: 1500, style: 1500, user: 11800 },
  summary: { draft: 8500, beats: 1000, prev: 600, user: 11500 },
  review: { draft: 8000, beats: 1200, ledger: 2000, cast: 800, prev: 400, next: 300, user: 15000 },
  revise: { draft: 11000, review: 2400, beats: 900, ledger: 1400, user: 17000 },
  blurb: { brief: 1500, spine: 2800, outline: 2000, characters: 1400, user: 9000 },
}

const TEMPERATURE = {
  premise: 0.9,
  bible: 0.7,
  characters: 0.85,
  spine: 0.7,
  outline: 0.6,
  beats: 0.75,
  draft: 0.9,
  summary: 0.2,
  review: 0.1,
  revise: 0.5,
  blurb: 0.85,
}

/**
 * 工艺宪法：所有阶段共享的 12 条硬约束。
 * 只讲"怎么写才算人写的"，不讲任何阶段的输出格式。
 */
// 草稿/修订和摘要合并成一次调用：省掉每章一次额外的 summary 往返（12 章省 12 次调用 / 约 4.7 万字符输入）。
// 模型没按格式给就用调用方回退到独立 summary 调用，正确性不依赖模型听话。
export const SUMMARY_MARKER = '<<<SUMMARY>>>'

function inlineSummaryBlock() {
  return [
    '【摘要（这一次输出里一起给）】',
    `正文写完后，另起一行只写 ${SUMMARY_MARKER}，紧接着输出本章摘要四行，不要标题、不要代码块、不要再写别的：`,
    '发生：这一章实际发生了什么（按场景顺序，2–4 句）',
    '知情：谁知道了什么（秘密、把柄、误解的变化）',
    '钩子：结尾留下的具体悬念',
    '时空：时间与地点推进到哪里',
    '摘要直接给下一章写作使用，只写事实，不要评价文笔。',
  ].join('\n')
}

const CRAFT = `【工艺宪法】
你写的不是"内容"，是一个具体的人在具体时刻做的选择。以下十二条是硬约束。

一、视角。只写视角人物此刻能感知、能想到、能知道的东西。他看不见的场面不写，别人的内心只能靠表情、动作、语气、说漏的话让读者判断。禁止"与此同时，在城市的另一端"；禁止替配角交代心理。

二、场景。一个场景＝谁此刻想要什么＋什么挡着＋局面怎么变＋他带着什么离开。四样缺一，场景就不该存在。转折必须改变力量、信息或关系，不能只是"气氛更紧"。

三、具体。不写"他很难过"，写他做了什么、身体哪里不对、眼前哪个物件变了。情绪用感官证据和动作后果承载。细节要和利益有关；一段至多一个比喻，且来自这个人的生活经验。

四、对话。人很少直说想要的。每句台词表面谈 A，底下争 B：试探、遮掩、施压、求和、报复。禁止"你也知道，我们的规矩是……"式讲解；规矩要在有人违反、有人利用、有人付代价时显形。沉默、打断、答非所问都是台词。

五、信息。每章都要改变"谁知道什么"。读者、视角人物、对手三方的信息差要有设计，不能三方同时知道一切。不要解释读者能自己推出来的东西。

六、因果。每个结果都要能追到某个人在前文做过的选择。巧合只能制造麻烦，不能解决麻烦。人物做蠢事必须有他的理由：恐惧、贪婪、爱、面子。

七、节奏。句子长短交替，一段只推进一个意思。该慢的地方（情绪转折、关键决定）舍得多给细节；该快的地方一句带过。不要每段都是三句话，不要每段都用金句收尾。

八、连续性。事实、时间、伤病、物品、钱、知情范围、关系，以前文和账本为准。冲突时服从账本；必须改，就写成剧情（他记错了，或有人撒谎），不要当没发生。

九、反 AI 腔。抽象名词、成对形容词、三连排比、"不是 A 而是 B"的警句，都是模型味。能删就删，能换成动作就换成动作。不总结主题，不替读者感动，不在章末发议论。

十、章节。开头要有当下的压力，结尾要留下具体的、未解决的问题：一个动作、一句话、一个物件、一个决定，而不是"他陷入沉思"。

十一、欲望。每个出场人物都要有当下想要的东西，哪怕只是"想快点离开这个房间"。没有欲望的人不许出场；两个好人也可以因为想要的不同而互相伤害。

十二、主题。主题是可以被反驳的命题，比如"活着比真相重要"，不是"关于爱与救赎"。不要让人物说出来；让不同人物用各自的下场投票。结局要给回答，但保留代价。

写每一段时，再守住五条操作纪律。

一，叙述距离。镜头贴着视角人物的身体：他先看见什么、听见什么、误判什么，读者才看见什么。需要交代背景时，让背景从人物正在做的决定里露出来；不要为了解释把镜头拉远，也不要替读者补他没看见的画面。

二，物件与动作。情绪不要命名，交给可操作的东西：他反复擦一个已经干净的杯子；她把钥匙攥进掌心，齿痕留在皮肤上。物件要在场景里被使用、移动、损坏，不能只是摆设；同一物件再次出现时，含义必须发生变化。

三，标点与呼吸。少用分号、破折号和成串的逗号把三个意思塞进一句；一个段落只做一件事。对话允许打断、答非所问、沉默，但每一次停顿都要改变力量关系。长句之后给一个短句，让读者落地。

四，写完自检。回看这一段：谁想要什么？谁在阻止？结束时局面和开头有什么不同？三问答不上，就删掉重写，不要靠形容词和抒情补救。如果一段删掉后情节不受影响、人物也不变，它就不该留在正文里。

五，词的选择。用这个人物会用的词，不用"令人窒息""难以言喻"这类现成感受。动词优先于形容词；一个准确的动作，胜过三个比喻。写完后把最漂亮的句子删掉一句，通常不会变差。`

/** 每个阶段在宪法之上追加的工艺重点。 */
const ADDENDA = {
  premise: `【本阶段：故事核心】
你要把一句话的种子炼成能撑住一部长篇的承诺。标准不是"好听"，是"能不能连续生产冲突"。
- logline：主角（谁）＋处境（被什么困住）＋行动（他决定做什么）＋代价（失去什么）。≤60 字，必须有具体对手或倒计时。
- 主题：写成可被反驳的命题（"人能不能靠遗忘活下去"），不要写成"关于爱与救赎"。
- promise：读者翻开后会持续得到的体验（谜题／压迫／温情／升级），说人话。
- ending：只写落点和代价，不写过程；必须回答主题，并让主角失去不可逆的东西。
- 书名：先在草稿里拟 5 个候选（意象／冲突／人称／时间／反讽各一），按"有画面、不剧透、能记住"挑一个写进 title，不要在 JSON 里新增候选字段。`,

  bible: `【本阶段：世界设定】
你不是在写百科，是在造一套"会咬人"的规则。每条设定都要回答：让谁得利、让谁受害、逼人物做什么选择。写不进冲突的设定，一律不写。
- 只写这本书会反复用到的：三条硬规则、三到六个地点、时代日常（钱／交通／通信／权力／时间怎么过）、禁忌与代价、反复出现的意象与物件。
- 规则必须有边界和代价；越强的设定，限制越具体。
- 地点要有感官锚点（气味／声音／光线／温度）和"谁的地盘"；同一地点在不同章节要能变味。
- 每条规则后面用一句话写"它会逼出什么冲突"。
- 禁止"这是一个充满魔法的大陆"式空话；禁止罗列历史年表；禁止解释读者在正文里能自己看到的东西。`,

  characters: `【本阶段：人物】
人物不是标签，是"在压力下会怎么做"的预测模型。每个人必须有：当下想要的（want）、不敢面对的（fear）、不能让人知道的（secret）、说话方式（voice）、会变的弧光（arc）。
- want 与 fear 必须互相拉扯；secret 必须能在中段爆炸；arc 必须由事件逼出来，不是顿悟。
- voice 写两句：第一句说话方式（句长／用词／口头禅／沉默时做什么），第二句行为底线（他会……；绝不会……）。这两句是后文写对白的锚。
- 关系要不对称：A 以为是朋友，B 只在利用 A。每条 relations 写"谁对谁"，不要写"互为好友"。
- 配角也要有自己想要的东西；没有欲望的人不许出场。
- 人数控制在主角 1、对手 1、关键配角 3–5，不要建一个连名字都记不住的名单。`,

  spine: `【本阶段：情感脊柱】
脊柱不是大纲，是"因为 A，所以 B，终于 C"的因果链。每一环都必须是主角的一次选择带来的后果，不是"后来发生了……"。
- 主线写 10–15 环：因为【前因】，他选择【行动】，所以【后果】；下一环从前一环的后果开始。
- 三幕（或起承转合）各写：主角相信什么 → 什么打破它 → 他付出什么代价 → 他变成什么样。
- 每卷一条情绪曲线：读者的情绪从__到__；主角的处境从__到__；本卷不可逆的一件事。
- 结局落点：最后一个画面、最后一句话、主题的回答；必须让主角失去一样再也拿不回来的东西。
- 禁止"经过一系列冒险，他成长了"这种总结；禁止用巧合解决主线。`,

  outline: `【本阶段：卷章大纲】
大纲是承诺清单，不是剧情简介。每章只回答四件事：谁想要什么（goal）、什么挡着（conflict）、局面怎么变（turn）、留下什么钩子（hook）。
- turn 必须改变至少一项：力量对比、信息占有、关系温度、时间压力。只写"气氛更紧张"不算 turn。
- hook 必须具体：一个动作、一句话、一个物件、一场即将发生的约会／死亡／揭穿。不要写"他陷入沉思""暴风雨即将来临"。
- 每章至少推进一条主线或一条人物弧；删掉所有"过渡章""铺垫章"。
- 卷要有 purpose：这一卷结束时，主角相信的东西必须错一次。
- cast 只能从人物档案里选 1–4 人，不要临时发明重要角色。
- 章节数必须精确等于用户要求；id 从 ch01 连续编号，不要跳号。`,

  beats: `【本阶段：章节细纲】
把一章拆成 5–9 个可拍的场景。每个场景是一个小型的"目标—阻碍—转折—出口"，场景之间必须因果相连：上一场的出口就是下一场的入口。
- 每场写清 where／when／cast／goal／obstacle／turn／exit／sensory。sensory 不是"气氛描写"，是一个具体的感官锚点（声音／气味／温度／触感／光线），写正文时要用。
- turn 要让局面变好或变坏，不能原地打转；exit 是人物带着什么离开：一个决定、一个伤口、一个错误、一条信息。
- 场数按信息量与情绪重量分配，不要平均切；重场戏给 2–3 场，过场 1 场带过。
- 最后一场的 exit 必须落在本章 hook 上；第一场的 goal 必须承接上一章的 exit。
- 不要在细纲里写对白全文，只写"这场戏要争什么"。`,

  draft: `【本章写作契约】
你是这本书的作者，不是助手。读者要的是这一章，不是关于这一章的说明。
- 直接写正文。第一行必须是「## 第N章 标题」这种格式：两个井号、空格、第N章、空格、标题。段落之间空一行。
- 不要前言、不要总结、不要解释、不要小标题、不要列表、不要作者按、不要"以下是本章"。
- 只写视角人物能感知的内容。细纲是骨架，允许为了更强而偏离，但必须兑现本章的转折与结尾钩子。
- 结尾停在钩子指向的具体动作、话语或物件上，不要写"他陷入了沉思"。
- 目标字数按用户给的范围，宁少勿注水；一段只推进一个意思。

【反 AI 腔禁止清单（命中左边，就换成右边）】
1. 仿佛／似乎／像是 → 写具体观察或身体反应（仿佛有人看他 → 后颈汗毛立起来）
2. 不禁／不由得 → 删掉，直接写动作（不由得后退一步 → 后退一步，鞋跟撞上门槛）
3. 缓缓／微微／轻轻 → 给速度、幅度或声音（缓缓抬头 → 抬头，脖颈响了一声）
4. 一丝／一抹／几分 → 换成看得见的东西（一丝笑意 → 嘴角动了一下，很快压回去）
5. 眼中闪过／嘴角勾起 → 换成一个动作或一句台词（眼中闪过慌乱 → 茶杯放回桌上，放得太重）
6. 空气仿佛凝固 → 写在场者的具体反应（没人接话，挂钟走了三格）
7. 心中五味杂陈 → 写一个自相矛盾的动作（想笑，喉咙里出来的却是一声咳嗽）
8. 莫名的／难以言喻的 → 给一个来源不明但具体的细节（莫名不安 → 他把钥匙数了三遍）
9. 他知道／她明白＋解释 → 把认知变成决定或动作（他知道不能再等 → 他按灭烟，拿起外套）
10. 不是 A，而是 B → 直接写 B（不是愤怒，是恐惧 → 他的手抖得扣不上扣子）
11. 三连排比／抽象名词堆叠 → 只留最具体的一项（孤独、绝望、无助 → 他把电视开着，声音调到最小）
12. 与此同时／在城市的另一端 → 删掉全知切换，回到视角人物眼前
13. 他感到／她意识到＋抽象名词 → 写感官证据（她感到危险 → 声控灯一层层亮上来，没人说话）
14. 形容词堆叠 → 让一个动词承担（冰冷而锋利的目光 → 他看她那一眼，像在估价）
15. 章末总结／抒情 → 落回具体动作或物件（这一夜注定无眠 → 天快亮时，烟灰缸满了）
16. 对话讲设定 → 让规矩在冲突里显形（你也知道规矩…… → 他把刀放上桌：要么破例，要么收尸）`,

  summary: `【本阶段：章节摘要】
摘要不是缩写，是写给"下一章的自己"的交接单。只保留四类信息：
- 发生了什么：按因果写，不按时间流水；只写正文里确实发生的事。
- 谁知道了什么：知情范围的变化，谁从谁那里得知，谁还被蒙着。
- 留下什么钩子：写成下一章可以直接接手的动作或信息，不要写"留下了悬念"。
- 时间地点：下一章要接的时空。
总长不超过 300 字，四行，每行一个标签。保留专有名词（人名／地名／物件名），不要用"他／她"代替。不写评价、不写推测、不剧透后文、不补正文没有的设定。`,

  review: `【本阶段：连续性审校】
你是这本书的责任编辑，不是夸奖者。只报可验证的问题，每条必须能指到具体段落或原句；指认不了的"感觉"不要写。
按顺序对账：
1. 事实：与账本／前文矛盾的人名、物件、伤势、钱、地点、天气、规则。
2. 时间线：本章内部的时间推进、与上一章的时间衔接、路程与耗时是否可能。
3. 知情：每个出场人物此刻知道什么、从哪知道的；有没有人用了自己还没得到的信息。
4. 视角：有没有写出视角人物看不见、不可能知道的场面或他人内心。
5. AI 腔：抽象情绪、成对形容词、三连排比、"不是 A 而是 B"、章末议论、解释主题。
6. 节奏：连续多段无对话／无动作、单段过长、场景原地打转、该慢的地方一笔带过。
7. 对话：台词是否只在交换信息、是否人人说一样的话、有没有潜台词；删掉也不影响理解的台词要标出来。
severity 标准：block＝读者会出戏／前后矛盾／关键信息错；warn＝明显削弱体验；note＝可改可不改。
fix 要写成"怎么改"，不是"改得更好"：给出替换动作、删哪句、补哪个感官细节。
ledgerPatch 只写本章新增或改变的事实／线索／人物状态／时间线，必须能在正文找到依据；没有就给空数组／空对象。
verdict：有 block，或 warn ≥3 → revise；否则 pass。`,

  revise: `【本阶段：修订】
你是外科医生，不是重写者。只动 findings 指出的地方；没被点名的段落尽量原样保留，包括你认为可以更好的地方。
- 禁止：重写全章、改主线／结局、增删场景、改人物关系、改叙事视角、换文风。
- 允许：替换句子、补一个感官细节、删一句解释、按 finding 要求调换段落、补一句过渡。
- 每条 finding 都要落地；无法执行的直接跳过，不要把修改说明写进正文。
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

function readText(ctx, key, max) {
  let s = ''
  try {
    if (ctx && typeof ctx.text === 'function') s = ctx.text(key, max) || ''
  } catch {
    s = ''
  }
  s = str(s)
  return max ? fit(ctx, s, max) : s
}

/**
 * 本章正文：同一 stage.run 内刚产出的 draft 还没进引擎的产物缓存，
 * ctx.text('draft/chNN') 读不到；调用方（index.js）会把正文挂在 ctx.draftText / ctx.draft 上，优先用它们。
 */
function draftTextOf(ctx, chId) {
  return str(ctx && ctx.draftText) || str(ctx && ctx.draft) || readText(ctx, `draft/${chId}`)
}

function readJson(ctx, key, fallback) {
  try {
    if (ctx && typeof ctx.has === 'function' && !ctx.has(key)) return fallback
    if (!ctx || typeof ctx.json !== 'function') return fallback
    const value = ctx.json(key)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
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

function genrePromise(genre) {
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
  const parts = [
    `《${bookTitle(ctx)}》`,
    str(p.genre) || '通用',
    `${str(p.audience) || '成年'}读者`,
    str(p.pov) || '第三人称限知',
    `${num(p.chapters, 24)} 章 × ${num(p.wordsPerChapter, 3000)} 字`,
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

function chapterNo(ctx) {
  const ch = currentChapter(ctx)
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
  const lines = [`第 ${n} 章${ch.title ? `《${ch.title}》` : ''}`]
  if (ch.goal) lines.push(`目标：${ch.goal}`)
  if (ch.conflict) lines.push(`冲突：${ch.conflict}`)
  if (ch.turn) lines.push(`转折：${ch.turn}`)
  if (ch.hook) lines.push(`钩子：${ch.hook}`)
  const meta = []
  if (ch.pov) meta.push(`视角：${ch.pov}`)
  if (ch.when) meta.push(`时间：${ch.when}`)
  if (ch.where) meta.push(`地点：${ch.where}`)
  if (meta.length) lines.push(meta.join('｜'))
  if (Array.isArray(ch.cast) && ch.cast.length) lines.push(`出场：${ch.cast.map(str).filter(Boolean).join('、')}`)
  return lines.join('\n')
}

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
        if (Array.isArray(c.knows) && c.knows.length) {
          bits.push(`知道：${c.knows.map(str).filter(Boolean).join('、')}`)
        }
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

function beatsText(ctx, id, max) {
  const data = readJson(ctx, `beats/${id}`, null)
  if (!data || typeof data !== 'object') return readText(ctx, `beats/${id}`, max)
  const scenes = Array.isArray(data.scenes) ? data.scenes : []
  if (!scenes.length) return readText(ctx, `beats/${id}`, max)
  const lines = [`本章共 ${scenes.length} 场。`]
  scenes.forEach((s, i) => {
    if (!s || typeof s !== 'object') return
    const head = [str(s.where), str(s.when), Array.isArray(s.cast) ? s.cast.map(str).filter(Boolean).join('、') : '']
      .filter(Boolean)
      .join('｜')
    lines.push(`${s.no || i + 1}. ${head}`)
    if (s.goal) lines.push(`   目标：${s.goal}`)
    if (s.obstacle) lines.push(`   阻碍：${s.obstacle}`)
    if (s.turn) lines.push(`   转折：${s.turn}`)
    if (s.exit) lines.push(`   出口：${s.exit}`)
    if (s.sensory) lines.push(`   感官：${s.sensory}`)
  })
  return fit(ctx, lines.join('\n'), max)
}

function reviewText(ctx, id, max) {
  const data = readJson(ctx, `review/${id}`, null)
  if (!data || typeof data !== 'object') return readText(ctx, `review/${id}`, max)
  const findings = Array.isArray(data.findings) ? data.findings : []
  if (!findings.length) return '审校未发现问题（findings 为空）。'
  const lines = [`verdict：${str(data.verdict) || '?'}，共 ${findings.length} 条：`]
  findings.forEach((f, i) => {
    if (!f || typeof f !== 'object') return
    lines.push(
      `${i + 1}. [${str(f.severity) || 'warn'}] ${str(f.kind)}｜${str(f.where) || '位置未给'}｜问题：${str(f.issue)}｜改法：${str(f.fix)}`
    )
  })
  return fit(ctx, lines.join('\n'), max)
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

function outlineTitles(ctx, max) {
  const data = readJson(ctx, 'outline', null)
  const volumes = data && Array.isArray(data.volumes) ? data.volumes : []
  if (!volumes.length) return ''
  const lines = volumes.map((v) => {
    const chapters = Array.isArray(v.chapters) ? v.chapters : []
    const titles = chapters
      .map((c) => `${str(c.id)} ${str(c.title)}`.trim())
      .filter(Boolean)
      .join('；')
    return `卷《${str(v.title)}》：${titles}`
  })
  return fit(ctx, lines.join('\n'), max)
}

function jsonContract(fields, sample) {
  return [
    '【输出格式】',
    `只输出一个 ${FENCE}json 代码块，代码块之外不要有任何字符：不要解释、不要前言、不要标题、不要第二个代码块。`,
    '字段名、层级、类型严格如下，不增不减；数组为空写 []，对象为空写 {}；不要注释，不要尾逗号，字符串用双引号。',
    fields,
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
 * 3. 十一个阶段
 * ------------------------------------------------------------------ */

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
    section('类型承诺', genrePromise(p.genre)),
    section(
      '硬约束',
      [
        `- 类型：${str(p.genre) || '通用'}；目标读者：${str(p.audience) || '成年'}；叙事视角：${str(p.pov) || '第三人称限知'}。`,
        `- 规模：${chapters} 章 × ${words} 字，约 ${((chapters * words) / 10000).toFixed(1)} 万字。这个体量要求主线能撑住 ${chapters} 次推进，不能是一句话就能讲完的短篇。`,
        '- 结局方向必须回答主题，并让主角付出不可逆的代价。',
        '- 五个书名候选只在草稿里比较，最终只输出一个；不要新增 JSON 字段。',
      ].join('\n')
    ),
    section('文风与尺度', styleText(ctx, BUDGET.premise.style), '（未指定：用克制、具体、少形容词的叙述。）'),
    jsonContract(
      [
        '- title：string，2–8 字，不带书名号，不剧透结局',
        '- logline：string，≤60 字，主角＋处境＋行动＋代价',
        '- theme：string，一句可被反驳的命题',
        '- promise：string，≤80 字，读者会持续得到的体验',
        '- ending：string，≤80 字，只写落点与代价，不写过程',
        '- genreTags：string[]，3–5 个，不含"小说"二字',
      ],
      {
        title: '长夜将明',
        logline: '殡仪馆夜班员为查母亲死因替无名尸守七夜，代价是开始看见死者。',
        theme: '人能不能靠遗忘活下去。',
        promise: '每晚一个死者带来一条线索，活人比死人更难审。',
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
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.bible.brief), '（缺失：先按故事种子判断这本书需要哪三条硬规则。）'),
    seed ? section('灵感与母题', seed) : '',
    section('类型承诺', genrePromise(p.genre)),
    section('写作边界', '只写会反复用到的设定；每条规则都要有代价和冲突出口；不写百科条目、不写年表、不解释正文能自己展示的东西。'),
    section('文风与尺度', styleText(ctx, BUDGET.bible.style), '（未指定：冷、具体、少形容词。）'),
    mdContract(`# 世界设定

## 一句话世界（≤40 字）
## 硬规则（3 条；每条：规则／边界／代价／会逼出什么冲突）
## 地点（3–6 个；每个：感官锚点／谁的地盘／暗藏的危险）
## 时代与日常（钱、交通、通信、权力、时间怎么过）
## 禁忌与代价（违反会发生什么；谁知道这条禁忌）
## 意象与物件（3–5 个，会在后文反复出现并变化）`),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.bible}`,
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
      '主角 1、对手 1、关键配角 3–5。每个配角都要有自己想要的东西；没有欲望的人不许出场。关系写成"谁对谁"，不要写"互为好友"。输出 cast 必须 5–7 人；示例只列 1 人，是形状示范。'
    ),
    section(
      '性别与代词（必须先定，后文不得再改）',
      [
        '- 每个角色都要写 gender：只能是「男」或「女」；不许留空，不许写「未知」。',
        '- 同一个人的代词全书只有一个：男用「他」，女用「她」。正文、摘要、账本里都按这个来。',
        '- 名字不能暗示性别时（如「沈砚」「周岩」），更要在 gender 里写清，否则后文一定会混用。',
        protagonistRule(p),
      ]
        .filter(Boolean)
        .join('\n')
    ),
    jsonContract(
      [
        '- cast：array，5–7 人',
        '- cast[].name：string，2–4 字，全书唯一',
        '- cast[].role：string，如"主角""对手""关键配角"',
        "- cast[].gender：string，'男' 或 '女'；必填，决定后文用「他」还是「她」", 
        '- cast[].want：string，≤40 字，当下最想要的东西',
        '- cast[].fear：string，≤40 字，不敢面对的东西',
        '- cast[].secret：string，≤50 字，不能让人知道、且中段会爆炸的事',
        '- cast[].voice：string，两句话——第一句说话方式（句长／用词／口头禅／沉默时做什么），第二句行为底线（他会……；绝不会……）',
        '- cast[].arc：string，≤50 字，从……到……，必须由事件逼出来',
        '- cast[].relations：array，每项 {to, kind}；to 是已有人物名，kind 写不对称的关系',
      ],
      {
        cast: [
          {
            name: '沈砚',
            role: '主角',
            gender: '女',
            want: '查清母亲真正的死因',
            fear: '自己也会在头七看见不该看见的东西',
            secret: '十岁那年见过一次死者回来，但一直说自己忘了',
            voice: '话少，句子短，紧张时重复对方最后一个词。她会为陌生人破例，绝不会在活人面前提母亲。',
            arc: '从靠规矩躲事，到主动破坏规矩换真相',
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
    maxTokens: 3200,
    temperature: TEMPERATURE.characters,
  }
}

function spinePrompt(ctx) {
  const p = paramsOf(ctx)
  const chapters = num(p.chapters, 24)
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.spine.brief), '（缺失：先按故事种子确定主角、对手与结局方向。）'),
    section('世界设定', readText(ctx, 'bible', BUDGET.spine.bible), '（缺失：只用故事核心与人物档案推进因果，不要补设定。）'),
    section('人物档案', castDump(ctx, BUDGET.spine.characters), '（缺失：先假定主角有一个当下欲望和一个不敢面对的秘密。）'),
    section(
      '规模约束',
      `共 ${chapters} 章。因果链要能分到 3–5 卷、每卷 2–3 个不可逆转折；不要写只有三幕、撑不到 ${chapters} 章的单线。`
    ),
    mdContract(`# 情感脊柱

## 一句话主线（因为……所以……终于……）
## 因果链（10–15 环，编号；每环：因为【前因】／他选择【行动】／所以【后果】）
## 三幕或起承转合（每幕：主角相信什么 → 什么打破它 → 付出什么代价 → 变成什么样）
## 卷情绪曲线（每卷：读者情绪从__到__／主角处境从__到__／本卷不可逆的一件事）
## 结局落点（最后一个画面／最后一句话／主题的回答）
## 代价清单（他失去什么，且再也拿不回来）`),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.spine}`,
    user: hardCap(ctx, user, BUDGET.spine.user),
    maxTokens: 3200,
    temperature: TEMPERATURE.spine,
  }
}

function outlinePrompt(ctx) {
  const p = paramsOf(ctx)
  const chapters = num(p.chapters, 24)
  const volumes = Math.min(5, Math.max(3, Math.round(chapters / 6)))
  const perVolume = Math.max(1, Math.round(chapters / volumes))
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.outline.brief), '（缺失：从故事种子反推 logline 与结局方向，不要偏离类型。）'),
    section('世界设定', readText(ctx, 'bible', BUDGET.outline.bible), '（缺失：只用故事核心与人物档案，不要新增世界规则。）'),
    section('人物档案', castDump(ctx, BUDGET.outline.characters), '（缺失：cast 只能写主角／对手和 1–2 个关键配角。）'),
    section('情感脊柱', readText(ctx, 'spine', BUDGET.outline.spine), '（缺失：按三幕推进，每卷至少一个不可逆转折。）'),
    section(
      '卷章分配',
      [
        `- 总章数必须精确等于 ${chapters}，分成 ${volumes} 卷，每卷约 ${perVolume} 章（允许 ±1，但总数不能变）。`,
        '- 每章四件套齐全：goal／conflict／turn／hook。缺一项就算不合格。',
        '- cast 只能从上面的人物档案里选 1–4 人；需要新角色时，用"无名配角"式写法，不要给重要新角色起名。',
        `- 示例只列 1 卷 1 章，是形状示范；你的输出必须 3–5 卷、共 ${chapters} 章。`,
        '- id 从 ch01 连续编号到最后；totalChapters 必须等于实际章节数。',
      ].join('\n')
    ),
    jsonContract(
      [
        '- volumes：array，3–5 项',
        '- volumes[].title：string，卷名，≤12 字',
        '- volumes[].purpose：string，≤40 字，本卷结束时主角哪条信念会碎',
        '- volumes[].chapters：array，章数按上面的分配',
        '- chapters[].id：string，ch01 起连续',
        '- chapters[].title：string，≤12 字',
        '- chapters[].goal：string，≤40 字，本章谁想要什么',
        '- chapters[].conflict：string，≤40 字，什么挡着',
        '- chapters[].turn：string，≤50 字，必须改变力量／信息／关系／时间压力',
        '- chapters[].hook：string，≤40 字，具体动作／话／物件／即将发生的事',
        '- chapters[].pov：string，与项目视角一致',
        '- chapters[].when：string，≤20 字',
        '- chapters[].where：string，≤20 字',
        '- chapters[].cast：string[]，1–4 个已有人物名',
        `- totalChapters：number，必须等于 ${chapters}`,
      ],
      {
        volumes: [
          {
            title: '第一卷 守夜',
            purpose: '沈砚相信规矩能保命，第一次违规让他失去退路',
            chapters: [
              {
                id: 'ch01',
                title: '头七',
                goal: '熬过第一夜，不打开三号柜',
                conflict: '三号柜每隔十分钟响一次',
                turn: '他发现母亲的名字出现在死者登记簿上',
                hook: '登记簿最后一页是他的字迹',
                pov: '第三人称限知',
                when: '头七夜',
                where: '殡仪馆',
                cast: ['沈砚'],
              },
            ],
          },
        ],
        totalChapters: 1,
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  const maxTokens = Math.min(12000, Math.max(2200, 1200 + chapters * 150))
  return {
    system: `${CRAFT}\n\n${ADDENDA.outline}`,
    user: hardCap(ctx, user, BUDGET.outline.user),
    maxTokens,
    temperature: TEMPERATURE.outline,
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

function beatsPrompt(ctx) {
  const ch = currentChapter(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const prevId = itemIdAt(ctx, -1)
  const nextId = itemIdAt(ctx, 1)
  const p = paramsOf(ctx)
  const user = [
    projectHeader(ctx),
    section('本章任务', chapterCard(ch, n), '（缺失：按项目规模与上一章钩子自行确定本章目标与转折。）'),
    section('数量硬约束', 'scenes 必须 5–9 场；示例只列 1 场，是形状示范，不要照着只写 1 场。', ''),
    section(
      '前后章',
      [
        prevId ? `上一章（${prevId}）：${prevGoal(ctx)}` : '这是第一章，没有上一章；第一场要直接把人按进麻烦里。',
        nextId ? `下一章（${nextId}）：${nextGoal(ctx)}` : '这是最后一章，结尾要收束主线，但仍要落在具体动作上。',
      ].join('\n'),
      ''
    ),
    section(
      '上一章摘要',
      readText(ctx, `summary/${prevId}`, BUDGET.beats.prev),
      prevId ? '（摘要缺失：不要凭空引用前情，只用本章任务与账本。）' : '（第一章，无前情。）'
    ),
    section('连续性账本', ledgerText(ctx, BUDGET.beats.ledger), '（账本为空：本章可以建立新事实，一旦写下后文必须遵守。）'),
    section('人物速查', castBrief(ctx, chapterCastNames(ctx, ch), BUDGET.beats.cast), '（档案缺失：只用本章 cast 里的名字。）'),
    section('文风', styleText(ctx, BUDGET.beats.style), '（未指定：克制、具体、少形容词。）'),
    jsonContract(
      [
        '- chapterId：string，等于本章 id',
        '- title：string，等于本章标题',
        '- scenes：array，5–9 项',
        '- scenes[].no：number，从 1 连续',
        '- scenes[].where：string，≤20 字，具体到房间／门口／车上',
        '- scenes[].when：string，≤20 字，本章内部的时间',
        '- scenes[].cast：string[]，1–4 个已有人物名',
        '- scenes[].goal：string，≤40 字，这场戏谁想要什么',
        '- scenes[].obstacle：string，≤40 字，什么挡着',
        '- scenes[].turn：string，≤50 字，局面怎么变',
        '- scenes[].exit：string，≤40 字，人物带着什么离开',
        '- scenes[].sensory：string，≤30 字，一个具体感官锚点（声音／气味／温度／触感／光线）',
      ],
      {
        chapterId: 'ch01',
        title: '头七',
        scenes: [
          {
            no: 1,
            where: '殡仪馆值班室',
            when: '夜里十一点',
            cast: ['沈砚'],
            goal: '熬过第一夜，不打开三号柜',
            obstacle: '三号柜从十点起每隔十分钟响一次',
            turn: '他发现响的不是柜子，是登记簿里的手机',
            exit: '他接起电话，对面叫出他母亲的名字',
            sensory: '冰柜低鸣、消毒水、冻僵的指尖',
          },
        ],
      }
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    system: `${CRAFT}\n\n${ADDENDA.beats}`,
    user: hardCap(ctx, user, BUDGET.beats.user),
    maxTokens: 3400,
    temperature: TEMPERATURE.beats,
  }
}

function draftPrompt(ctx) {
  const p = paramsOf(ctx)
  const ch = currentChapter(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const prevId = itemIdAt(ctx, -1)
  const words = num(p.wordsPerChapter, 3000)
  const low = Math.round(words * 0.9)
  const high = Math.round(words * 1.15)
  const title = str(ch.title)
  const compose = (castMax, ledgerMax) =>
    [
      projectHeader(ctx),
      section(
        '本章细纲',
        beatsText(ctx, chId, BUDGET.draft.beats),
        '（细纲缺失：按本章目标与上一章钩子自行安排 5–7 场，每场仍须有目标—阻碍—转折—出口。）'
      ),
      section(
        '上一章摘要',
        readText(ctx, `summary/${prevId}`, BUDGET.draft.prev),
        prevId ? '（摘要缺失：不要凭空引用前情，只使用本章细纲与账本里的信息。）' : '（这是第一章，无上一章。）'
      ),
      section('连续性账本', ledgerText(ctx, ledgerMax), '（账本为空：本章可以建立新事实；一旦写下，后文必须遵守。）'),
      section('下一章要发生', nextChapterLine(ctx), '（无下一章。）'),
      section(
        '人物速查',
        castBrief(ctx, chapterCastNames(ctx, ch), castMax),
        '（档案缺失：只使用本章细纲 cast 里的名字，不要新增有名有姓的角色。）'
      ),
      section(
        '代词对照',
        pronounLine(ctx),
        '（人物档案没写性别：沿用前文已经用过的代词，本章内不要换成另一个代词。）'
      ),
      section('文风样本', styleText(ctx, BUDGET.draft.style), '（无额外样本：按工艺宪法与项目文风写。）'),
      [
        '【写作指令】',
        `1. 直接开始写正文。第一行必须是「## 第${n}章${title ? ` ${title}` : ' 标题'}」这种格式。`,
        `2. 目标 ${words} 字（正文中文字符），可接受 ${low}–${high}。宁少勿注水。`,
        '3. 按【本章细纲】的场景顺序写；可以让场景更狠、更具体，但不要绕开本章的转折与钩子。若你有更强的写法，允许偏离，但必须同时满足：本章目标达成或失败得更彻底，转折真正改变局面，结尾落在钩子指向的具体动作、话语或物件上。',
        '4. 段落之间空一行。不要写"以下是"、不要总结、不要解释、不要小标题、不要列表、不要作者按。',
        '5. 最后一句停在钩子上：一个动作、一句话、一个物件的变化，不写"他陷入了沉思"。',
        '6. 代词：按【代词对照】指代每个人；同一个人全章只用他或她中的一个，不要一段用这个、一段用那个。',
      ].join('\n'),
      inlineSummaryBlock(),
    ]
      .filter(Boolean)
      .join('\n\n')

  // §4.3 的截断优先级：先砍人物速查，再砍账本，最后才 hardCap。
  let castMax = BUDGET.draft.cast
  let ledgerMax = BUDGET.draft.ledger
  let user = compose(castMax, ledgerMax)
  let over = user.length - BUDGET.draft.user
  if (over > 0) {
    castMax = Math.max(0, castMax - over)
    user = compose(castMax, ledgerMax)
    over = user.length - BUDGET.draft.user
  }
  if (over > 0) {
    ledgerMax = Math.max(0, ledgerMax - over)
    user = compose(castMax, ledgerMax)
  }
  const inline = user.includes(SUMMARY_MARKER)
  const maxTokens = Math.min(16000, Math.max(1600, Math.round(words * 2.2) + (inline ? 400 : 0)))
  return {
    system: `${CRAFT}\n\n${ADDENDA.draft}`,
    user: hardCap(ctx, user, BUDGET.draft.user),
    maxTokens,
    temperature: TEMPERATURE.draft,
  }
}

function summaryPrompt(ctx) {
  const ch = currentChapter(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const prevId = itemIdAt(ctx, -1)
  // 修订后的第二次摘要：正文只按「原摘要 + 审校意见 + 修订稿首尾」给，
  // 不再把整章 8500 字重新投喂一遍（12 章能省约 7 万字输入）。
  const updated = Boolean(ctx.reviseSummary)
  const prose = updated ? fitEnds(ctx, draftTextOf(ctx, chId), 2400) : draftTextOf(ctx, chId)
  const user = [
    projectHeader(ctx),
    section('本章任务', chapterCard(ch, n), '（缺失：以正文实际发生为准。）'),
    section(
      '本章正文',
      updated ? prose : fitEnds(ctx, prose, BUDGET.summary.draft),
      '（正文缺失：请在输出里写"正文缺失，无法摘要"，不要编造。）'
    ),
    updated ? section('修订前的摘要', readText(ctx, `summary/${chId}`, 1000), '（无旧摘要。）') : '',
    updated
      ? section(
          '本次修订了什么',
          (ctx.findings ?? []).map((f) => `- [${f.severity}] ${f.issue}`).join('\n'),
          '',
        )
      : '',
    section('本章细纲', beatsText(ctx, chId, BUDGET.summary.beats), ''),
    section('上一章摘要', readText(ctx, `summary/${prevId}`, BUDGET.summary.prev), prevId ? '（无）' : '（第一章。）'),
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

function reviewPrompt(ctx) {
  const ch = currentChapter(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const prevId = itemIdAt(ctx, -1)
  const user = [
    projectHeader(ctx),
    section('审校对象', `第 ${n} 章${ch.title ? `《${ch.title}》` : ''}（${chId}）`, ''),
    section(
      '本章正文',
      fitEnds(ctx, readText(ctx, `draft/${chId}`), BUDGET.review.draft),
      '（正文缺失：输出 verdict=revise，findings 里写明"正文缺失"，不要编造问题。）'
    ),
    section('本章细纲', beatsText(ctx, chId, BUDGET.review.beats), '（缺失：只能按正文与账本对账。）'),
    section('连续性账本', ledgerText(ctx, BUDGET.review.ledger), '（账本为空：只检查本章内部一致性。）'),
    section('人物速查', castBrief(ctx, chapterCastNames(ctx, ch), BUDGET.review.cast), '（档案缺失：只按正文里的人物表现对账。）'),
    section('代词对照', pronounLine(ctx), '（档案没写性别：只按正文内部是否自洽判断。）'),
    section('上一章摘要', readText(ctx, `summary/${prevId}`, BUDGET.review.prev), prevId ? '（无）' : '（第一章。）'),
    section('下一章要发生', nextChapterLine(ctx), '（无。）'),
    jsonContract(
      [
        '- findings：array；没有问题也要给 []',
        "- findings[].severity：'block' | 'warn' | 'note'",
        '- findings[].kind：string，如 事实／时间线／知情／视角／性别／AI腔／节奏／对话；代词与人物性别对不上就记「性别」',
        '- findings[].where：string，第几段或引用原句（≤30 字），必须能定位',
        '- findings[].issue：string，≤60 字，说清哪里错、为什么错',
        '- findings[].fix：string，≤60 字，怎么改：删哪句／换成什么动作／补什么细节',
        '- ledgerPatch：object，可含 facts／threads／characters／timeline；只写本章新增或改变的内容',
        "- verdict：'pass' | 'revise'；有 block 或 warn ≥3 时为 revise",
      ],
      {
        findings: [
          {
            severity: 'warn',
            kind: '知情',
            where: '第 7 段「你怎么知道钥匙在花盆下面」',
            issue: '周迟第 3 章才拿到钥匙，此处却说漏藏钥匙的位置，视角人物也没有起疑。',
            fix: '把台词改成试探性问法，或补一句沈砚注意到他说漏嘴。',
          },
        ],
        ledgerPatch: {
          facts: [],
          threads: [
            { id: 't_key', text: '备用钥匙藏在花盆下，只有沈砚知道', opened: 'ch03', status: 'open', closedIn: null },
          ],
          characters: {
            沈砚: { location: '殡仪馆值班室', state: '左手划伤，未处理', knows: ['无名尸与母亲死因有关'] },
          },
          timeline: [{ chapter: 'ch05', when: '第三天凌晨', event: '沈砚第一次独自开柜' }],
        },
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

function revisePrompt(ctx) {
  const p = paramsOf(ctx)
  const ch = currentChapter(ctx)
  const n = chapterNo(ctx)
  const chId = str(ch.id) || 'ch01'
  const words = num(p.wordsPerChapter, 3000)
  const review = reviewText(ctx, chId, BUDGET.revise.review)
  const reviewBody = review || '无审校意见：只做逐句的最小润色（错别字、重复、标点、明显病句），不要改情节、结构、段落顺序。'
  const user = [
    projectHeader(ctx),
    section('修订对象', `第 ${n} 章${ch.title ? `《${ch.title}》` : ''}（${chId}）`, ''),
    section(
      '待修订正文',
      fitEnds(ctx, draftTextOf(ctx, chId), BUDGET.revise.draft),
      '（正文缺失：直接输出"正文缺失，无法修订"，不要编造正文。）'
    ),
    section('审校意见', reviewBody, ''),
    section('本章细纲', beatsText(ctx, chId, BUDGET.revise.beats), '（缺失：以保留原文意图为准。）'),
    section('连续性账本', ledgerText(ctx, BUDGET.revise.ledger), '（账本为空：只按审校意见修改。）'),
    section(
      '代词对照',
      pronounLine(ctx),
      '（档案没写性别：沿用原文的代词，如发现原文互相矛盾，按人物身份统一。）'
    ),
    [
      '【修订指令】',
      `1. 只改审校意见点名的位置；没被点名的段落尽量保持原样。`,
      `2. 输出完整正文，第一行仍是「## 第${n}章${ch.title ? ` ${ch.title}` : ' 标题'}」，段落之间空行。`,
      `3. 总字数与原文相差不超过 10%（原文约 ${words} 字）。`,
      '4. 不要解释改了什么，不要输出修改说明或对照表。',
      '5. 代词：同一个人全章只用「他」或「她」中的一个；原文前后不一致时，按【代词对照】统一。',
    ].join('\n'),
    inlineSummaryBlock(),
  ]
    .filter(Boolean)
    .join('\n\n')
  const inline = user.includes(SUMMARY_MARKER)
  const maxTokens = Math.min(16000, Math.max(1600, Math.round(words * 2.2) + (inline ? 400 : 0)))
  return {
    system: `${CRAFT}\n\n${ADDENDA.revise}`,
    user: hardCap(ctx, user, BUDGET.revise.user),
    maxTokens,
    temperature: TEMPERATURE.revise,
  }
}

function blurbPrompt(ctx) {
  const p = paramsOf(ctx)
  const user = [
    projectHeader(ctx),
    section('故事核心', prettyArtifact(ctx, 'brief', BUDGET.blurb.brief), '（缺失：从情感脊柱反推 logline 与结局方向。）'),
    section('情感脊柱', readText(ctx, 'spine', BUDGET.blurb.spine), '（缺失：只按人物与故事核心写，不要编造情节。）'),
    section('卷章标题', outlineTitles(ctx, BUDGET.blurb.outline), '（缺失：不写具体章节，只写处境与压力。）'),
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
    premise: premisePrompt,
    bible: biblePrompt,
    characters: charactersPrompt,
    spine: spinePrompt,
    outline: outlinePrompt,
    beats: beatsPrompt,
    draft: draftPrompt,
    summary: summaryPrompt,
    review: reviewPrompt,
    revise: revisePrompt,
    blurb: blurbPrompt,
  }
}

export default createPrompts
