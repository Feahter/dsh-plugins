# 实时语音输入（realtime-voice）

连续听写插件：点一次麦克风开始，说话时实时显示识别文字，停顿约 0.6–0.7 秒自动断句并把整句写入对话输入框；再点一次（或点输入框里的方块按钮）结束。

- 识别完全在本机 CPU 上运行（SenseVoiceSmall ONNX int8），不上传音频、不消耗对话 token。
- 复用 DSH 自带的「语音输入」Bundle：语音服务、本地模型与 `speech` Remote 都由它提供。**请勿禁用该 Bundle**，否则本插件会因为拿不到语音服务而提示“模型尚未就绪”。
- 参数来自同机实测（见仓库 `sim/RESULTS.md`）：VAD 阈值自适应校准、语音起点 120 ms、断句静音 600 ms、预录 300 ms、实时重识别节奏 700 ms（长句自动降到 1200 ms）、部分转写窗口 12 s、单段上限 15 s。
- 只有“断句后的最终文本”会写入输入框；实时部分文字只显示在输入框上方的面板里（SenseVoice 每次重解码会重新标点，直接插入会导致反复改写）。
- 若插入时草稿被改动（例如你手动编辑或提交了消息），文本会保留在面板中并提供“插入”按钮。

## 安装

已通过 plugin_manager 安装并启用（本地目录链接）：`@local/realtime-voice`。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：无服务，只为 Bundle 占一个 Loader 条目 |
| `client.js` | 全部行为：麦克风采集、VAD、WAV 编码、Remote 调用、槽位 UI |
| `cordis.patch.yml` | 插入 `realtime-voice` 行 |
| `locale/*.json` | 插件管理页的标题与描述 |
| `icon.svg` | 插件图标 |

## 槽位

- 麦克风按钮：`conversation.input.right`（输入框工具行、发送按钮之前），id `realtime-voice`
- 实时文字面板：`conversation.input.dock`（输入框上方整行），id `realtime-voice-live`
