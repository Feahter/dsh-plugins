# 语音管家（voice-companion）v0.2

DSH 的「一个插件装完所有语音面」：**面板通话**、**输入框听写**、**全局热键指令**、**看板娘**、**多音色**都在这里，不再需要另外两个插件。

原来拆成三个包，现在合了：

| 原来的包 | 现在 |
| --- | --- |
| `dsh-voice-companion`（面板通话） | 本插件主体 |
| `dsh-realtime-voice`（输入框听写） | `src/client/dictation.js` + `polish.js`，走面板上的「听写」模式 |
| `dsh-voice-control`（热键单句） | `src/client/hotkey.js`，Ctrl+Shift+Space 按住说话 |

## 三张嘴，一张脸

| 入口 | 怎么用 | 说什么 |
| --- | --- | --- |
| 面板「开始通话」 | 点一次，之后连续对话 | 聊天、派活、后台干完主动回来找你 |
| 面板「听写」模式 | 点一次，说一段，松口即落字 | 口述转文字，填词、去口水话后写进输入框 |
| `Ctrl+Shift+Space` | 全局按住说一句，松手执行 | 一句话路由：派活 / 回答 / 补写 |

三种入口共用同一个看板娘面板、同一套人格和同一套音色选择。

## 看板娘

两个形象，面板右上角两个圆点切换，选择写进 `localStorage`，下次打开还是它：

| id | 名字 | 形象 | 默认音色 |
| --- | --- | --- | --- |
| `whale` | 大肥鱼 | 官方 Logo 的萌化胖鲸鱼（`#4D6BFE` 蓝身、白腹、大眼、喷水孔） | `tide`（男声） |
| `chibi` | 小肥鱼 | 二次元看板娘：蓝发、耳机、水手服、大眼睛 | `stella`（女声） |

- 形象是**代码画的原创 SVG**（`src/client/characters.js`），不依赖任何外部贴图，没有版权问题，也不发网络请求。
- 五个状态都做了动画：`idle` 呼吸/眨眼/偶尔冒泡、`listening` 光晕与外圈波纹、`thinking` 眼睛上翻+三点、`speaking` 嘴随音量开合、`error` 灰化耷拉。
- 面板能拖：按住头顶那条（光标变抓手）拖到任意位置，松手记住；`localStorage['dsh.voice-companion.pos']` 存 `{left,top}`，`dsh.voice-companion.collapsed` 存收起状态。位置会夹在视口内，至少留一截可抓。
- 面板能收：右上「−」把整块折成一颗圆角胶囊（只剩状态点和名字），点胶囊或「＋」展开；收起时不影响通话和热键。
- 自查页：`assets/avatar-demo.html`（直接 `open` 就行，`?character=chibi` 换形象）。截图：`assets/screenshot-whale.png`、`assets/screenshot-chibi.png`。

## 音色

不是固定一个声音，按「谁说、说什么、说到第几句」自适应：

| 规则 | 效果 |
| --- | --- |
| 看板娘默认音色 | whale → `tide`（温柔），chibi → `stella`（明亮） |
| 情绪 | 句子里的歉疚词（抱歉/辛苦/别急…）早于兴奋词（！/哈哈/太棒…）→ 换 `.soft`，反之 `.bright`。whale 的 bright 借 `stella`，chibi 的 soft 借 `tide` |
| 轮次位置 | 一轮回答的第一句固定用 base，开场稳；第 2 句起逐句按情绪换 |
| 显式指定 | 请求里带 `voiceId` 就以它为准（`/speak`、`/turn` 都吃） |

`GET /api/voice-companion/characters` 返回可选形象和音色目录，面板与宿主读的是同一份表（`host/voice.js` 的 `CHARACTER_VOICES`）。

## 用法

1. 点右下角面板的「开始通话」，浏览器请求麦克风权限。
2. 直接说话，例如「帮我把 voice-control 的 README 补一段隐私说明」。
3. 它先「嗯，我看一下」，然后把活派给后台 Session：「好，我去办，办完叫你」。
4. 后台干完主动开口：「老板，README 补完了，加了隐私边界那一段」。
5. 想打断就继续说，检测到人声立刻停播。
6. 再点「结束」挂断。

调试入口：`__dshVoiceCompanion.status()` / `.say('测试一下')` / `.start()` / `.stop()` / `.character('chibi')` / `.mode('dictation')`。

## 架构

```
浏览器                                           宿主
┌────────────────────────────┐   HTTP 同源    ┌──────────────────────────────┐
│ 面板通话：能量 VAD + 断句    │ ────────────▶ │ /turn   人格 LLM → 句子数组   │
│ 输入框听写：整段转写 + 润色  │ ◀──────────── │ /speak  句子级 TTS + 缓存     │
│ 热键：按住录音 → 松手路由    │               │ /plan   一句话归到哪个动作    │
│ 看板娘 + 字幕 + 音色选择     │               │ /send   投递 / 回答           │
│                            │ ◀──────────── │ /dispatch /events 后台任务    │
└────────────────────────────┘               │ /transcribe /characters       │
                                             └──────────────────────────────┘
```

- 识别在本机完成（DSH 自带 SenseVoiceSmall），音频不出机器。
- 合成走 `api.deepseek.com/v1/tools/tts`，**回复文本会出网**；key 只在宿主内存里读。
- 聊天走 `deepseek-flash`，一句回复通常 3–5 个短句。

## 路由

全部挂在 `/api/voice-companion` 下（`/plugins/*` 是 bundle 资产命名空间，页面打不到）。字段定义见 [`docs/protocol.md`](docs/protocol.md)。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | 服务、版本、当前看板娘、音色目录、ASR provider、在跟的任务数 |
| GET | `/characters` | 可选形象（含默认音色）与音色目录 |
| POST | `/turn` | 一句话进来，回 `{reply, say[], voices[], task, kind}` |
| POST | `/speak` | 一句文本出去，回 base64 WAV（带 `voiceId`） |
| POST | `/plan` | 热键路径：一句话 → `{plan:{action:'ask'\|'new'\|'resume', sessionId?, candidates?}, confirmation}` |
| POST | `/send` | 热键路径：确认后真正执行（`prompt`/`new`/`cancel`，`resume` 由客户端翻成 `prompt`） |
| POST | `/dispatch` | 直接派活（`/turn` 判定为任务时内部也走它） |
| GET | `/events?since=` | 后台任务完成事件，游标语义 |
| POST | `/transcribe` | ASR 回退通路：base64 WAV → 本机 SenseVoice 文本 |

## 验收记录

v0.1 那批（真接口 curl）见 git 历史。v0.2 这批：

| 项 | 证据 |
| --- | --- |
| 单元测试 | `node --test "test/*.test.mjs"` **92/92 通过**（宿主 22、路由 19、指令 11、音色 16、润色 14、其余 harness） |
| 客户端半片 | `test/client-harness.mjs` **33/33**：两个形象 chip、切换后 `data-character`/字幕/`/speak` 带 character、对话↔听写按钮、听写模式不再开 `/turn` |
| 热键 | `test/hotkey-harness.mjs` 15/15（假麦克风/假时钟/假 requestJson） |
| 看板娘 | `test/avatar-harness.mjs` 14/14（含拖动改位+落盘、按 chip 不触发拖动、收起胶囊+点开、第二个实例恢复位置）；真实 Chrome 截图 `assets/screenshot-whale.png` / `screenshot-chibi.png` |
| 打包 | `node scripts/build-client.mjs` → `client.js` 125,875 B，7 个片段拼成一个 ModuleLoader factory |

**没验的**：宿主 9 条路由还没在运行中的 app 上 curl 过（新代码要重载插件/重启 GUI 才进内存）；真浏览器里的麦克风授权、自动播放策略、真实出声只能人耳确认。

## 开发

```bash
node scripts/build-client.mjs     # src/client/*.js → client.js（ModuleLoader 形态）
node --test "test/*.test.mjs"     # 宿主 + 纯函数单测
node test/client-harness.mjs      # 客户端半片（假 DOM）
node test/avatar-harness.mjs      # 看板娘渲染
open assets/avatar-demo.html      # 形象自查页
```

改完代码让运行中的 app 生效：`plugin_manager` 里对 `include:dsh-voice-companion` 先 disable 再 enable，然后刷新页面重挂面板。

## 已知限制

- 断句靠能量阈值，环境噪音大时会提早断句；阈值在 `src/client/audio.js` 里自适应校准。
- 首句出声约 0.9–1.3 s，已用预合成语气词填补前 0.9 s。
- TTS 目录只有两个音色：`stella`（明亮）/ `tide`（温柔），`/health` 和 `/characters` 都能看到；想加音色改 `host/voice.js` 的 `VOICE_CATALOG` 与 `CHARACTER_VOICES`。
- 看板娘是 SVG 程序化绘制，细节不如贴图丰富；加新形象只需在 `characters.js` 里加一个 `build()` 与 `CHARACTERS` 条目。
- 后台任务完成事件依赖 `agent/status`；Session 被别的客户端取消时走 `task-failed` 分支。
