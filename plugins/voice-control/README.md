# dsh-voice-control

> **已被取代（2026-11-16）**：本包的能力已并入 [`dsh-voice-companion`](../voice-companion/README.md) ≥0.4.0
> （按住说话热键与按会话路由 → `src/client/hotkey.js`）。
> 本包不再接新功能；新装用户请直接装 `dsh-voice-companion`。已装用户可继续用，能力不变。
> 取代惯例见 [`docs/DEPRECATION.md`](../../docs/DEPRECATION.md)。

热键只在 DSH 窗口有焦点时生效；绑定失败时会尝试「加修饰键」的候选键，并把结果写在 HUD 上。都不行时右下角始终有「按住说话 / Hold to talk」按钮，功能不丢。麦克风被拒、没设备、被占用各有独立文案（macOS 拒绝时给出「系统设置 → 隐私与安全性 → 麦克风」路径）；权限不会被缓存，处理后重新按键即可。宿主桌面壳仍需收紧权限请求。

按住一个键说话，话被送到「该去的那个 Session」，回复用语音播回来。

插件分两半：Host 半片持有 API key、做语音合成、调度 `ctx.sessionController`；浏览器半片负责录音、HUD、播报。两半之间走同源 HTTP 路由，和 realtime-voice 用的是同一套约定。

## 用法

| 操作 | 结果 |
| --- | --- |
| 按住 `Ctrl+Shift+Space` 说话 | 松手后本地识别 → 路由 → 投递，HUD 显示去了哪个 Session |
| 命中不了任何 Session | 播报候选（「你是指1，X；2，Y，还是说"新开"？」），下一次按键就是你的回答 |
| 说「开个新会话…」 | 新建 Session 并把这句话作为第一句 |
| 话里带标题关键词 | 优先按标题匹配；匹配不到就看是不是「继续/回到」的接续语气 |

热键可用 `localStorage['dsh.voice-control.hotkey']` 改成别的组合（`KeyboardEvent.code` 组合，如 `Alt+KeyM`）。

## 路由怎么定的

规则在 `host/router.js`，纯函数、17 个单测覆盖。判定顺序：

1. 显式新开 → `new`
2. 两个候选分差 < 0.12 且都 ≥ 0.34 → `ask`（不猜）
3. 强标题匹配（≥ 0.5）→ `resume`
4. 弱匹配（≥ 0.34）→ `ask`
5. **定位式**接续（`回到 X` / `上次 X` / `那个 X`）且 X 没命中任何标题 → `ask`，不拿最近的顶替
6. 普通接续（`继续` / `接着` / `继续，加个功能`）→ 最近且唯一的那个
7. 无信号 → 留在当前 Session；没有当前 Session 就用最近的

**错路由比不路由更糟**，所以 `confidence < 0.6` 一律不猜，改成播报候选让用户说序号。已归档的 Session、以及「空白且没在跑」的 Session 不参与路由。

## HTTP 路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/voice-control/health` | 本机识别 provider、TTS 声音、Session 数 |
| POST | `/api/voice-control/plan` | `{utterance, currentSessionId?, pending?}` → `{plan, confirmation}` |
| POST | `/api/voice-control/dispatch` | `{action:'prompt'\|'new'\|'cancel', sessionId?, text}` |
| POST | `/api/voice-control/speak` | `{text, voiceId?}` → base64 WAV + 时长 |
| POST | `/api/voice-control/transcribe` | `{audioBase64, providerId?}` → 本机识别文本（浏览器拿不到 `remote.speech` 时的回退） |

一律同源校验（Origin 存在且 host 不同则 403），body 上限 4 MB。错误码：`400 invalid`（参数）、`404 not-found`（Session 不存在）、`415 unsupported-audio`（不是 16 kHz 单声道 16-bit PCM WAV）、`502`（上游识别/合成失败）、`503`（本机服务没挂）。

路由必须挂在 `/api/<slug>` 前缀下：`/plugins/*` 是 bundle 资产命名空间，页面 fetch 打不到。

## 隐私边界

- **识别不出机器**：音频只给本机 `ctx.speechToText`（SenseVoiceSmall，CPU）。`speechToText` 的注释原话是 "no fallback sends audio elsewhere"。
- **播报会出网**：TTS 是服务端合成，**回复文本会发给 api.deepseek.com**。要完全离线只能换成 macOS `say` 或 piper，见 `research/2026-11-13-voice-control-feasibility.md` 第 8.5 节。
- API key 只从 `~/.deepseek/config.toml` 读，只在 Host 进程内存里，不出现在页面、日志或错误信息里。

## 安装

```bash
# 1) 在 profile 里 link
cd ~/.dsh/profiles/desktop
# package.json 的 dependencies 加：
#   "dsh-voice-control": "link:/Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/plugins/voice-control"
# dsh.profile.bundles 数组加 "dsh-voice-control"

# 2) 符号链接
ln -s ../../../../Documents/deepseek-harness/dsh-plugins/plugins/voice-control \
      ~/.dsh/profiles/desktop/node_modules/dsh-voice-control
```

装完不用重启应用：`plugin_manager` 里 disable→enable 一次 `include:dsh-voice-control` 就会重新挂载，页面跟着 HMR 拿到新 client bundle。

## 验证（真跑过，不是「应该可以」）

```bash
# 1) 宿主半片活着，能看到本机识别 provider 和 Session 数
curl -s http://127.0.0.1:63672/api/voice-control/health
# {"ok":true,"version":"0.1.0","tts":{...},"asr":{"providers":["sensevoice-local"]},"sessions":{"available":true,"count":292}}

# 2) 路由
curl -s -X POST http://127.0.0.1:63672/api/voice-control/plan \
  -H 'content-type: application/json' -d '{"utterance":"回到语音控制那个会话"}'

# 3) 合成 → 再识别，闭环验证 TTS 与 ASR 两头
curl -s -X POST .../speak -d '{"text":"打开语音插件"}' | jq -r .audioBase64 | base64 -d > /tmp/t.wav
curl -s -X POST .../transcribe -d "{\"audioBase64\":\"$(base64 -i /tmp/t.wav)\"}"
# {"ok":true,"text":"打开语音插件，检查一下路由是否正确。","providerId":"sensevoice-local","audioSeconds":3.72,"inferenceSeconds":0.197}
```

`/transcribe` 只收**规范** 16 kHz 单声道 16-bit PCM WAV（44 字节头、`data` 紧跟 `fmt `）；带 `LIST` 块或 24 kHz 的 WAV 会被 provider 拒为 `Invalid speech WAV`。浏览器半片的 `encodeWave` 产出的就是规范格式。

仍需真人在浏览器里按一次热键：`MediaRecorder`/`AudioContext`/`getUserMedia` 只有真机才能验。

## 测试

```bash
npm test     # 43 个用例：路由规则 + HTTP 管线 + TTS 工具 + Host 入口（假 ctx 驱动五条路由）
npm run check
node test/client-harness.mjs   # 浏览器半片的离线 harness
```

## 已知限制

- 热键只在 DSH 窗口有焦点时生效。真正的系统级全局热键（DSH 后台也能按）需要改桌面原生壳，插件侧没有入口——asar 里 `Tray|globalShortcut|setAlwaysOnTop|BrowserWindow` 零命中，桌面壳是原生实现。插件侧能做的是把「没绑上」显示出来，并提供右下角「按住说话」作为替代。
- 服务端 TTS 首音 0.96–1.37 s，所以「听到回复」最快也在 2 s 上下；完全零延迟的打断式对话不成立。
- 单次识别是整段 WAV（≤120 s / 8 MiB 是服务端 ASR 的限制；本机没有这个限制，但也只做整段）。
- 没有唤醒词，没有常驻监听：必须按键说话。

## 属于 dsh-plugins

本插件收录在 [dsh-plugins](https://github.com/Feahter/dsh-plugins)——十一个 DSH 插件与一份自托管的插件市场索引。在 DSH 的 **插件 → 发现** 里添加索引地址即可安装（也可直接看 [插件目录](https://github.com/Feahter/dsh-plugins#plugin-catalog)）：

```
https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json
```
