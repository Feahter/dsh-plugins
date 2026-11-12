# 接入 `voiceInput`：把语音输入接到任意输入控件

本插件除了给对话输入框提供麦克风，还把整套能力暴露成一个 cordis 服务 **`voiceInput`**。
任何"有文本输入框"的插件（编辑器、搜索框、表单、命令面板、第三方面板）都可以 attach 上去，
复用同一套采集、VAD 断句、本地排版、翻译与插入策略——不需要自己写麦克风、自己接 speech Remote。

```js
const api = ctx.get('voiceInput')          // 或 ctx.inject(['voiceInput'], s => s.voiceInput)
if (!api) return                        // 插件没装/没启用，静默降级
```

服务未提供时 `ctx.get('voiceInput')` 返回 `undefined`，不要因此抛错——语音永远是增强项。

## 1. Surface 契约

一个 surface = 一块可写入的文本区域。attach 时提供三个函数：

| 字段 | 必填 | 语义 |
| --- | --- | --- |
| `id` | 是 | surface 唯一键，同一 id 重复 attach 会覆盖旧的 |
| `label` | 否 | 面板/日志里的可读名，默认取 id |
| `captureInsertion()` | 否 | 开始录音的一瞬间调用一次，返回一个"插入位置"令牌（光标、选区、草稿版本），原样回传给 `insertText` |
| `insertText(text, target)` | 否 | 把最终文本写进控件。**返回 `true` 表示写入成功**；返回 `false` 表示草稿已经变了（用户手动编辑、提交、切换文档），插件会把文本留在 `store.pending` 里等你处理 |
| `replaceText(text, target)` | 否 | 可选：整段替换（翻译模式重写上一段时用），不提供时退化为 `insertText` |
| `onState(state)` | 否 | 每次状态变化回调一次，参数是完整状态快照（见第 3 节） |

约定：

- `captureInsertion` 只在 `start()` 成功后调用一次；录音期间不再调用，避免位置漂移。
- `insertText` 可能被调用多次（每断一句一次）。**必须幂等追加**，不要每次重写整段。
- 拿不到令牌（`null`）时也要能插入——插件会传 `null`，你的实现应当回退到"当前光标"。
- 返回 `false` 之后不要自己重试；调用 `handle.insertPending()` 或读 `store.pending` 自行决定。
- 纯函数式的 `insertText` 实现里不要抛异常；抛了会被当作失败处理。

## 2. 句柄

```js
const handle = api.attach({ id: 'my-editor', captureInsertion, insertText, onState })
handle.id          // 'my-editor'
handle.store       // 只读状态存储：get() / subscribe(fn)
handle.start()     // → { ok: boolean, message?: string }
handle.stop()      // 提交尾巴（如有）后停麦
handle.toggle()    // 按当前状态起停
handle.insertPending()  // 把 pending 文本再插一次
handle.detach()    // 解绑并释放该 surface 的引擎（会先 stop）
```

`start()` 的返回值是契约的一部分：`{ok:false, message}` 表示没打开麦克风
（没有权限、模型没就绪、浏览器不支持），`message` 已经是用户可读文案，直接 toast 即可。

## 3. 状态

```js
{
  phase: 'idle' | 'starting' | 'listening' | 'error',
  error: string,        // phase==='error' 时的可读原因
  partial: string,      // 当前这一句的实时识别（只读展示，不要插入）
  pending: string,      // 插入失败、等你处理的文本
  lastInserted: string, // 最近一次成功插入的文本
  level: number,        // 0..1 当前音量（画波形用）
  seconds: number,      // 本次录音秒数
  segmentActive: boolean,
  translated: boolean,  // 本次结果是否经过翻译
  busyText: string,     // '正在准备模型…' 之类的进度文案
  warning: string,      // 非致命告警（如翻译降级为原文）
  waiting: boolean,     // 连句校正攒住了一句，正等下一句
}
```

连句校正（`contextMode: 'pair'`，默认）下 `waiting` 会为 `true` 一小段时间（`flushMs`，默认 1400）：这是在等相邻的下一句一起排版，不是卡住。别在这段时间里重复触发 `start()`。

`phase` 只会按 `idle → starting → listening → idle` 走，任何失败落 `error` 并带 `error`。
`starting` 阶段可能包含模型下载/加载，几十秒属正常，不要当成卡死。

## 4. 最小示例

```js
export function apply(ctx) {
  let field = null              // 你的 <textarea> 或编辑器实例
  let handle = null

  ctx.effect(() => {
    const api = ctx.get('voiceInput')
    if (!api || !field) return () => {}
    handle = api.attach({
      id: 'my-editor',
      label: 'My editor',
      captureInsertion: () => ({ at: field.selectionStart, value: field.value }),
      insertText: (text, target) => {
        if (!target || target.value !== field.value) return false   // 草稿变了
        const at = target.at
        field.value = field.value.slice(0, at) + text + field.value.slice(at)
        field.selectionStart = field.selectionEnd = at + text.length
        return true
      },
      onState: (state) => renderMyIndicator(state),
    })
    return () => { handle && handle.detach(); handle = null }
  })

  // 你自己的按钮
  const onMicClick = () => handle && handle.toggle()
}
```

## 5. 设置共享

设置是插件级、跨 surface 共享的，别自己再造一套：

```js
api.settings.get()                       // 完整设置对象（见 README「设置」）
api.settings.patch({ mode: 'translate' })// 局部更新，落 localStorage
api.settings.subscribe(fn)               // 变更通知
```

用户在某处改了模式，所有 surface 立刻生效——这是"同一个语音输入"而不是"每个插件一套"的关键。

和你相关的几个键：`mode`（`dictate` / `translate`）、`targetLanguage`、`contextMode`（`pair` 连句校正 / `off` 逐句即插）、`flushMs`（等下一句的毫秒数）、`dictionary`（`[{from,to}]`）。

## 6. 全局入口

```js
api.surfaces()                 // ['composer', 'my-editor']
api.state(surfaceId?)          // 读某个 surface 的状态（默认 composer）
api.open(surfaceId?)           // 直接开录（等价于 attach 后的 start，但不需要句柄）
api.close(surfaceId?)
api.toggle(surfaceId?)
api.on(event => ...)           // { type: 'attach' | 'detach', surfaceId }
api.version                    // '0.2.0'
```

`api.open('my-editor')` 适合快捷键/命令面板：面板还没 attach 也能先开录。
这种情况没有插入目标，最终文本会落到该 surface 的 `store.pending`，等你 attach 之后
调用 `handle.insertPending()` 落盘。

## 7. Host 桥（可选）

排版/翻译分两层：

1. **本地确定性流水线**（默认，离线可用）：去口头语、合并结巴重复、采纳自我更正、
   口述标点、词典替换、中文/英文标点与大小写归一。
2. **Host 翻译**（可选）：客户端 `fetch('/plugins/realtime-voice/refine')`，由 Host 半
   优先调 `ctx.translator`（bing/google），没有该服务时退回 Google 匿名端点
   （`provider: 'google-direct'`）。不可用或关闭「在线翻译」时自动退回第 1 层，
   并在状态里给 `warning`。

协议（给别的主机/插件复刻用）：

```
GET  /plugins/realtime-voice/health
→ { ok: true, capabilities: { translate: true, cleanup: false, providers: ['translator','google'] 或 ['google-direct'] } }

POST /plugins/realtime-voice/refine
← { text: string, mode: 'translate' | 'cleanup', targetLanguage?: string, sourceLanguage?: string }
→ { ok: true, text: string, provider: string, ms: number } | { ok: false, code: string, message: string }
```

`translate` 恒为 `true`（Host 半在就一定有兜底路径），`cleanup` 恒为 `false`（本版不接 LLM，
客户端用本地规则）。`providers` 只用来展示当前走哪条路。`code` 枚举：`invalid` / `too-long` /
`unavailable` / `timeout` / `failed` / `forbidden`。

隐私：这是唯一的出网点，且只发**当前这一句**文本；客户端设置关掉「在线翻译」后完全不发请求。
同源栅栏：带 Origin 的请求必须与 Host 一致（file:// 的 `origin: null` 放行）。

## 8. 扩展点

- **加语言**：客户端 `LANGUAGES` 表 + `translate` 的 `targetLanguage`；speech provider 的
  `language` 走 `speech.configure({ providers: { [id]: { language } } })`。
- **加后处理**：`polish()` 里每一步都是 `(text, options) => text` 的纯函数，加一步就多一行；
  顺序即语义（命令 → 口头语 → 重复 → 更正 → 词典 → 标点）。
- **换翻译/润色后端**：只改 Host 半 `refine` 的实现（translator / llm / 自建 HTTP），
  客户端协议不变。
- **新 surface 类型**：不需要改插件，只要实现 `captureInsertion`/`insertText` 两个函数。

## 9. 已知限制

- 依赖内置「语音输入」Bundle 提供 `remote.speech`；禁用该 Bundle 后本插件没有识别能力
  （但 UI、设置、`voiceInput` 服务仍在，会以 `error` 状态提示模型未就绪）。
- 实时 `partial` 只用于展示，不插入：SenseVoice 每次重解码会重排标点，直接插入会反复改写。
- 单段上限 15 s：说满会自动断句提交，长句拆成多段，不影响连续听写。
- 翻译是"整句出译文"，不做逐词对齐；混合语言输入按目标语言整体翻译。
