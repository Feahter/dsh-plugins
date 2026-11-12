# 实时语音输入（realtime-voice）v0.3

一个麦克风，一套语音输入：连续听写 + 说完自动排版 + 口述翻译 + 设置面板，
并把能力暴露成 `voiceInput` 服务，供任何需要输入的插件接入。

- **只留一个麦克风**：注册在 `conversation.input.activity`、`priority: -1`，直接顶掉内置语音输入的同槽按钮，不再是并排两个。
- **说完自动排版**（本地、离线、无 token）：去「嗯/呃/那个」、合并结巴重复、采纳自我更正（取「不对，我是说…」之后的最终意图）、口述标点、词典替换、中英文标点与大小写归一。
- **口述翻译**：`mode: 'translate'` 时把中文说成英文（或任意目标语言）再插入；翻译不可用时自动退回原文并给告警。
- **三个设置入口**：设置面板的「实时语音设置」页、插件管理页的配置卡片、麦克风右键 / 浮动条齿轮。
- **可被复用**：`ctx.get('voiceInput')` 拿到 `attach/start/stop/toggle/settings`，别的输入控件接入不用再写音频栈（见 [docs/INTEGRATION.md](docs/INTEGRATION.md)）。

识别仍在本机 CPU（SenseVoiceSmall ONNX int8），音频不出本机；复用 DSH 自带「语音输入」Bundle 提供的 `speech` Remote。**只有翻译模式**会把那一句的文字发出去（见下文「翻译怎么工作」）。

## 连句校正（v0.3）

识别准确率不高时，单句排版会放大错误：断句位置偏、专有名词被切成两半、说错了当场只改一半。v0.3 默认把**相邻两句**当成一个排版单元：

- 第一句断句后不立刻插入，先攒住（浮动条显示「等下一句一起校正…」）；
- 第二句到达后合并，再一次性排版、翻译、插入；
- 1.4 s 内没有下一句（或停麦）就释放，行为回到逐句；
- 合并时做四件事：缝上去重（「我说这个问题」+「这个问题已经解决了」→ 一句）、接住跨句更正（「会议定在周三」+「不对，是周四」→「会议定在周四」）、中英缝上按需补空格、标点不叠加。

设置里可关闭（回到 v0.2 的逐句即插），也可以把等待时长调成 0.8 s（更快）或 2.2 s（更适合边想边说）。

## 翻译怎么工作

1. 识别与排版都在本机完成，得到一句干净的中文。
2. 只有 `mode: 'translate'` 才请求 Host：`POST /plugins/realtime-voice/refine`，body `{text, mode:'translate', targetLanguage, sourceLanguage?}`。
3. Host 侧优先用已安装的 `translator` 服务（`ctx.get('translator')`，可切 bing/google）；本机没装时退回 Google 匿名端点 `translate.googleapis.com/translate_a/single`——零依赖、无需 key，装不装插件都能用。
4. 失败时按设置处理：默认插入原文并提示；打开「翻译失败时阻断插入」则不插入、只报错。

隐私：在线翻译是唯一的出网点。设置 → 翻译里有「在线翻译」开关，关掉后不请求 Host，句子按原语言插入；`health` 里的 `providers` 会告诉你当前走的是 `translator` 还是 `google-direct`。

## 交互

| 动作 | 结果 |
| --- | --- |
| 点麦克风 | 开始连续听写（起提示音） |
| 说话，停顿 ~0.6 s | 断句；连句校正开启时先攒住，等下一句（默认 1.4 s）一起排版后插入 |
| 说满 15 s | 自动断句提交，继续听，不清空上下文 |
| 再点麦克风 / 点浮动条方块 | 停麦，提交尾句（停止提示音） |
| 右键麦克风 / 点浮动条齿轮 | 打开设置面板 |
| 插入时草稿已改 | 文本留在浮动条的「插入」按钮里，不丢 |

实时识别文字只显示在浮动条上，不进输入框——SenseVoice 每次重解码会重排标点，直接插入会反复改写。

## 设置

存 `localStorage` 的 `dsh.realtime-voice.settings.v2`，跨 surface 共享。

| 分组 | 项 |
| --- | --- |
| 输入 | 启用、识别语言、设备、提示音、实时预览、连句校正、等下一句时长（0.8/1.4/2.2 s） |
| 润色 | 总开关、口头语、重复、自我更正、口述标点、词典 |
| 翻译 | 模式（听写/翻译）、目标语言、在线翻译开关、失败退回原文/阻断插入 |
| 词典 | 每行 `原词=替换词`，`#` 开头为注释 |

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：`ctx.inject(['webServer'])` 后注册 `/plugins/realtime-voice/health`、`/refine` |
| `host/refine.js` | 路由实现（无 cordis 依赖）：校验、同源栅栏、读体、超时/abort、`translator` 优先 + Google 直连兜底 |
| `client.js` | 全部客户端行为：设置、纯函数排版流水线、Host 桥、VAD、引擎、`voiceInput` API、槽位 UI |
| `test/harness.mjs` | 客户端离线测试：在 `vm` 里加载真实 bundle，跑 66 项断言（含伪麦克风的连句端到端） |
| `test/host-refine.test.mjs` | Host 路由测试：真起一个 `node:http` 服务，16 例（含兜底成功、上游失败、断开 abort） |
| `docs/INTEGRATION.md` | 别的插件如何接入 `voiceInput` |
| `cordis.patch.yml` · `locale/*.json` · `icon.svg` | Bundle 行、插件页文案、图标 |

## 槽位

| 槽位 | id | 说明 |
| --- | --- | --- |
| `conversation.input.activity` | （无 id） | 麦克风，`priority: -1` 覆盖内置；注册失败自动退回 `conversation.input.right` |
| `conversation.input.dock` | `realtime-voice-live` | 浮动条：状态、计时、音量、模式、齿轮、插入按钮 |
| `settings.section` | `realtime-voice` | 设置面板整页 |
| `plugins.bundle.config` | `dsh-realtime-voice` | 插件管理页的配置卡片 |

## 测试与部署

```bash
npm test                          # 客户端 49 项 + Host 16 例，纯离线，无需浏览器
npm run test:client               # 只跑客户端 vm 断言
npm run test:host                 # 只跑 Host 路由（node --test）

# 部署到正在运行的 profile（无需重启 App）
D=~/.dsh/profiles/desktop/node_modules/dsh-realtime-voice
cp client.js index.js package.json "$D/" && mkdir -p "$D/host" && cp host/refine.js "$D/host/"
```

- **客户端 bundle**（`client.js`）：HMR 每 500 ms 轮询 `client.js`，改完约 1 s 内热替换页面。
- **Host 半**（`index.js` / `host/*` / `package.json`）：HMR 只监听 profile 清单与 patch 的**内容**，改完要让 `~/.dsh/profiles/desktop/cordis.patch.yml` 变一次内容（追加/删一行注释、`touch` 不算）才会重组合。
- 部署后核对：`curl -s http://127.0.0.1:58322/plugins/realtime-voice/health` 应返回 `translate:true`；`/plugins/events` 的 graph 里应能看到 `id: dsh-realtime-voice`。**graph 里没有它 = 客户端 bundle 没加载，麦克风也会消失**，最常见原因是部署目录 `package.json` 的 `name` 与 bundle 行 id 不一致（必须都是 `dsh-realtime-voice`）。

调试：控制台里 `window.__realtimeVoiceDebug` 有 `steps` 与 `error`，`window.__dshVoiceInput` 是同一个 `voiceInput` 服务。

## 已知限制

- 依赖内置「语音输入」Bundle 提供 `speech` Remote；禁用后 UI 与设置仍在，但状态会提示模型未就绪。
- 润色/排版全在本地；翻译需要 Host 半 + 网络，失败按设置退回原文或阻断，不静默丢句。
- 模型驱动的「按应用调语气」尚未接（Host 半的 `cleanup` 恒 `false`），当前润色是确定性规则。
- 单段上限 15 s；长句按断句切成多段连续提交。
