# voice-companion 协议 v0.2

一个「打电话式」语音管家，外加听写与热键两条单句通道：连续听、边说边识别、拟人回话、能把活派给后台 Session、干完主动汇报。

## 角色

| 半边 | 职责 |
| --- | --- |
| Host（`index.js` + `host/*`） | 持有 API key、人格 LLM 调用、句子级 TTS、音色选择、任务派发、监听 `agent/status` 生成完成事件 |
| Client（`client.js` 由 `src/client/*` 打包） | 麦克风、能量 VAD、增量识别、断句、播报与打断、听写落字、全局热键、看板娘与字幕 |

两半只通过下面 9 条同源 HTTP 路由说话，全部挂在 `/api/voice-companion` 下（`/plugins/*` 打不到）。

## 路由

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok, version, character, characters[], tts:{voices,apiKeyConfigured,catalog}, asr:{providers}, tasks:{tracked,defaults:{permission,reasoningEffort}}, commands:{sessions}}` |
| GET | `/characters` | — | `{ok, defaultCharacter, characters:[{id,name,tagline,voice,labels}], voices:[{id,label}], speed:{min,max}}` |
| POST | `/turn` | `{utterance, sessionId?, history?, character?, mode?, voiceId?, voiceMap?}` | `{ok, reply, say:[句子], voices:[voiceId], task:{taskId,sessionId,title,text}\|null, kind:'chat'\|'task'\|'cancel'}` |
| POST | `/speak` | `{text, character?, mode?, index?, total?, voiceId?, voiceMap?}` | `{ok, audioBase64, mimeType, durationMs, voiceId, cached}` |
| POST | `/plan` | `{utterance, currentSessionId?, pending?}` | `{ok, plan:{action:'ask'\|'new'\|'resume', sessionId?, candidates?, confidence, reason, text}, confirmation}` |
| POST | `/send` | `{action:'prompt'\|'new'\|'cancel', sessionId?, text?}` | `{ok, action:'prompt'\|'new'\|'cancel', sessionId?, text?}`，动作非法 400，Session 不存在 404 |
| POST | `/dispatch` | `{text, sessionId?, character?}` | `{ok, taskId, sessionId}`（目标会话先被设成完全权限 + high 推理，见下） |
| GET | `/events?since=<cursor>` | — | `{ok, events:[{id,type,text,voiceId}], cursor}` |
| POST | `/transcribe` | `{audioBase64, providerId?}` | `{ok, text, providerId}` |

错误统一 `{ok:false, code, message}`，HTTP 状态：400 参数、404 不存在、415 音频格式、502 上游、503 本机服务缺失。

`/turn` 的 `say` 是**按句切好**的数组，`voices` 与它等长：客户端逐句 `/speak`（带对应 `voiceId`）并流水播放，第 1 句在说的时候第 2 句已经在合成。

## 音色选择（宿主侧，`host/voice.js`）

目录只有两个音色：`stella`（明亮 / bright）、`tide`（温柔 / warm）。

`selectVoice({character, text, index, total, mode, available})` 的判定顺序：

1. `mode === 'bright'` → `CHARACTER_VOICES[character].bright`；`mode === 'calm'` → `.base`；其余（`auto`/未知）走情绪。
2. 情绪（`detectEmotion(text)`）：`抱歉/对不起/不好意思/辛苦/慢慢/别急/难过` 早于 `！/哈哈/太棒/好耶/厉害` 出现 → `soft`；反之 `bright`；都没有 → `calm`。`soft` → `.soft`，`bright` → `.bright`，`calm` → `.base`。
3. `available` 非空时，结果被收窄到其中（顺序：想要的那个 → `base` → `tide`）。

`selectVoices({character, sentences, mode, available})` 是整轮的入口：**第一句固定用 `base`**（开场稳），第 2 句起逐句按上面的规则。

`CHARACTER_VOICES`：`whale` base `tide` / bright `stella` / soft `tide`；`chibi` base `stella` / bright `stella` / soft `tide`。`voiceCatalog()` 输出给 `/health` 与 `/characters`。

请求里显式给的 `voiceId`（`/speak`、`/turn`）在宿主入口就被采信，不再走上面的选择。

### 用户自定义音色（`voiceMap`）

面板的「声音设置」抽屉让用户自己指定三个槽：`base`（默认/平静）、`bright`（开心）、`soft`（温柔）。客户端把这份表存 localStorage（`dsh.voice-companion.voice`），每次 `/turn`、`/speak` 都带上 `voiceMap`：

```json
{ "voiceMap": { "base": "tide", "bright": "stella" }, "voiceId": null }
```

- 宿主用 `normalizeVoiceMap(map, VOICES)` 过滤：只留 `base|bright|soft`、只留 `stella|tide`，未知值丢弃；过滤后为空就完全回落 `CHARACTER_VOICES`。
- 有值就以用户为准；**缺失的槽**回落到该角色在该情绪下的默认音色（不是回落到 base）。
- `selectVoices` 的「第一句固定 base」规则不变：第一句取 `voiceMap.base`（没配就取角色 base）。
- 显式 `voiceId` 仍然最高优先：给了它就整段同一个音色，`voiceMap` 不再参与。

### 语速（客户端侧）

上游 TTS 没有语速参数（只有 `text / voice_id / format / filter_markdown`），所以语速由浏览器在播放时做：`AudioBufferSourceNode.playbackRate = clamp(rate, 0.5, 2)`，滑块范围 0.75–1.35（`/characters` 的 `speed` 字段给的就是这个区间）。变速同时会改音高（不是变调不变速），这是该方案的已知取舍。`/speak` 本身不接收 rate，rate 只存在于客户端播放队列的每条 entry 上。

## 三种客户端入口

| 入口 | 端点序列 |
| --- | --- |
| 面板通话 | 连续识别 → `/turn` → 逐句 `/speak`；轮询 `/events?since=` 收后台完成播报 |
| 面板听写 | 整段录音 → `/transcribe` → 本机润色（`polish.js`：去口水话、填词、标点）→ 写进输入框；**不走 LLM、不走网络** |
| 全局热键 | 按住录音 → `/transcribe` → `/plan` → 按 `plan.action` 分流：`ask` 先说 `confirmation` 等用户补充；`new` → `/send {action:'new', text}`；`resume`/其他 → `/send {action:'prompt', sessionId, text}`。`plan.candidates` 在下一轮 `/plan` 里以 `pending` 回传，30 s 过期 |

`/plan` 的 `action` 只有 `ask`（要用户确认或选择）、`new`（开新 Session）、`resume`（投进已有 Session）；`/send` 只接受 `prompt`/`new`/`cancel`，客户端把 `resume` 翻成 `prompt` —— 两边的词表是刻意分开的（路由决策 vs 投递动作）。

## 派活的默认会话设置

`/dispatch`（以及 `/turn` 判定为派活）在把 prompt 写进目标会话之前，先给这个会话铺好两个默认值，让语音派活不用再手动点权限：

| 设置 | 值 | 怎么设 |
| --- | --- | --- |
| 权限 | 完全访问（`danger-full-access`，沙箱 `danger-full-access` + 审批 `never`） | `permissionPresets.set(session, 'danger-full-access')`；该 preset 不在表里时按 `resolve(name).sandbox === 'danger-full-access'` 找替代，已是目标就跳过 |
| 推理 | `high` | `agent.model.select({provider, model, reasoningEffort: 'high'})`；模型不支持时按 `high → max → medium → low → off` 取第一个可用的，一个都读不到也仍尝试 `high`（失败只记日志） |

时序上有个坑：`sessionController.create()` 只建 Session 不建 Agent，所以派活那一刻新会话还没有 Agent 可改。板子同时订阅 `agent/created`（宿主 `serial` 派发，在 Agent 开跑前触发），对该板子跟踪中的会话补一次同样的设置。老会话在 dispatch 时直接设。

两项设置各自 try/catch，任何一个服务缺失（例如测试里的假 ctx）都静默跳过，不影响派活本身。`/health` 的 `tasks.defaults` 暴露这两个默认值，方便排查。

## 完成事件

- `/dispatch`（以及 `/turn` 里判定为派活时）把活投给目标 Session，记下 `{taskId, sessionId, title, dispatchedAt}`。
- Host 订阅 `ctx.on('agent/status', ({agent, status}) => ...)`：状态从 `running` 转成非 running 且这个 sessionId 在表里 → 取该 Session 最后一条 assistant 文本 → 生成一条 `task-done` 事件入队（带一句口语化摘要与 `voiceId`）。
- 客户端每 1.5 s 拉 `/events?since=cursor`；有新事件就打断当前播报，说「老板，X 做完了」。

## 客户端状态机

`idle → listening → thinking → speaking → idle`：
- `listening` 时达到断句条件（静音 ≥ 650 ms 且累计 ≥ 400 ms 语音）→ `thinking`
- `speaking` 时麦克风电平连续 200 ms 超过阈值 → 立刻停播、清队列 → `listening`（打断）
- 会话断开 / 出错 → `error`，3 s 后回 `idle`

听写与热键独立于这条状态机：听写只发 `idle ↔ listening`，热键自带 HUD（`.vc-hotkey-*`），不动主面板。

## 人格

- 名字「大肥鱼」，说话短（每句 ≤ 30 字）、口语、有温度，不说「作为 AI」。
- 聊天走 `deepseek-flash`，system prompt 里带工具协议：需要干活的请求回 `{"say":"...","task":{"title":"...","text":"..."}}`，否则只回 `{"say":"..."}`。
- 派活时对用户说的是一句「好，我去办，办完叫你」，不要让用户等。

## 面板行为

| 交互 | 触发 | 落点 |
|---|---|---|
| 拖动 | `.vc-head` 上 `pointerdown`/`mousedown`（chip、按钮除外） | 写 `style.left/top`，`right/bottom` 置 `auto`；松手存 `localStorage['dsh.voice-companion.pos'] = {"left":N,"top":N}` |
| 收起 | `.vc-min`（`−`/`＋`） | 根节点 `data-collapsed="1"`，只剩胶囊；存 `localStorage['dsh.voice-companion.collapsed'] = "1"` |
| 展开 | 点胶囊本体（未移动的 tap）或 `＋` | 去掉 `data-collapsed`，恢复整块面板 |

坐标在 `place()` 里按视口夹紧（水平至少留 120px、垂直至少留 40px 在屏内），窗口 `resize` 时重新夹一次。

## 形象

形象是**代码里的原创 SVG**（`src/client/characters.js`），不是外部贴图：`CHARACTERS` 里每个条目带 `build(doc)`，`renderCharacter(doc, id)` 返回 `{svg, mouth, mouthPath}`，`avatar.js` 只负责挂载、切状态、切形象。

- 两个形象：`whale`（大肥鱼，官方 Logo 萌化，viewBox `0 0 240 200`）、`chibi`（小肥鱼，二次元看板娘，viewBox `46 20 148 180` 的头肩取景）。
- 五个状态：`idle` 呼吸/眨眼、`listening` 光晕与外圈波纹、`thinking` 眼睛上翻 + 三点、`speaking` 嘴随音量开合、`error` 耷拉。
- 嘴形由 `mouthPathFor(id, level)` 生成，`level` 是 0..1 的音量包络；`avatar.setLevel()` 只在 `speaking` 时改写路径。
- 自助形象：`custom` 这个 id 不对应 SVG，而是用户上传的一张 `<img>`（`localStorage['dsh.voice-companion.face'] = {name, src}`，`src` 必须是 `data:image/` 开头，最长边 512 px，原始文件上限 800 KB）。`renderCharacter(doc, 'custom', face)` 返回 `{svg: <img class=vc-fish-img>, mouth: null, mouthPath: null}`，所以 `speaking` 时没有嘴形；`face` 缺失或非法时 `resolveCharacter` 回落到 `CHARACTERS[0]`。
- 设置抽屉（`.vc-sheet`，齿轮 `.vc-gear` 开关，Esc/遮罩关闭）：三个音色槽 `select.vc-slot[data-slot]`、语速 `input.vc-speed`、试听/保存/恢复默认、形象改名 `input.vc-name` 与「移除自定义形象」。抽屉只发 `onAction('voice', {profile})` 与 `onAction('preview', {voiceId})`，落盘由 `voice-profile.js` 完成。
- 自查页 `assets/avatar-demo.html`，`?character=chibi` 换形象。
