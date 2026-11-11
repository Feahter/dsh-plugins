# 脑图创意画布（dsh-mind-canvas）

DeepSeek Harness 的一个插件：在侧栏开一张**无限画布**，一句话起根，往右（或往下）长成一棵思维树。可以整理成树、从自媒体工作台导入灵感、让 AI 帮你发散下一层，最后导出成 Markdown 大纲。

> 灵感来自 `dsh-media-desk` 的「灵感墙」画布——但那是**一堆散落的卡片**，没有层级；这张是**一棵有父子关系的树**。两者的相机、坐标和持久化思路一脉相承，区别在于这里用 `@xyflow/react` 的节点图 + `d3-hierarchy` 的 tidy tree 布局，把「散落」换成了「结构」。

## 界面

一个侧栏页面「脑图创意画布」，五件东西：

- **顶栏**：**返回对话**、脑图切换、新建、重命名、向右长 / 向下长（整理）、从灵感导入、**主题**（预设 + 自定义）、**导出**（Markdown / OPML / FreeMind / JSON / PNG）、撤销 / 重做、删除。
- **画布**：点空白拖动平移，滚轮/双指缩放，节点可拖拽，父子之间自动连线。
- **浮动工具条**：选中节点后出现——加子节点、AI 发散、**换颜色（6 色自选）**、编辑、删除。
- **卡片**：双击进编辑，六个色相（点哪个是哪个，不再是轮换），可折叠子节点（右侧圆钮显示收起了几个）。
- **空态**：中间一个输入框，回车就是第一颗节点。

## 怎么用

| 操作 | 效果 |
| --- | --- |
| 中间输入框回车 | 建第一颗根节点 |
| 双击空白 | 在那个位置建一颗根节点 |
| `Tab` | 给选中节点加子节点，并直接进入编辑 |
| `Enter` | 编辑选中节点 |
| `⌘/Ctrl + Enter` | 对选中节点 AI 发散 |
| `Backspace` / `Delete` | 删掉选中节点和它的整棵子树 |
| `⌘/Ctrl + Z` / `Shift + ⌘/Ctrl + Z` | 撤销 / 重做 |
| `Esc` | 退出编辑、取消选中 |
| 「向右长 / 向下长」 | 用 tidy tree 重新排布，父节点居中于子节点 |
| 「换颜色」 | 弹出 6 个色板，点哪个用哪个 |
| 「主题」 | 5 套预设 + 自定义（13 个颜色位），`跟随宿主` 时完全继承应用明暗主题 |
| 「导出」 | Markdown 大纲 / OPML / FreeMind `.mm` / JSON / PNG 图片 |
| 「返回对话」 | 回到会话（等价于把中央面板切回 conversation） |

「从灵感导入」会读自媒体工作台（`dsh-media-desk`）里的灵感条目，挑几条落成这张图的根节点。「AI 发散」用宿主当前的默认助手模型，把选中节点展开成 3–6 个往下想的子想法；没有可用模型时明确报错，不会编造内容。

## 数据

存在 `$DSH_HOME/mind-canvas/state.json`，一份 JSON 管所有脑图：

```jsonc
{
  "version": 1,
  "activeId": "d_...",
  "revision": 12,
  "docs": [{
    "id": "d_...", "title": "我的第一张脑图", "layout": "tree-right",
    "theme": { "preset": "auto" },   // 或 { preset:"custom", custom:{ bg:"#…", accent:"#…", … } }
    "nodes": [{
      "id": "n_...", "text": "AI 工具怎么讲才不像广告",
      "parentId": null, "x": 0, "y": 0, "tone": "a",
      "source": { "kind": "media-desk", "id": "it_..." }
    }],
    "view": { "x": 120, "y": 80, "zoom": 0.9 }
  }]
}
```

写入是 tmp + rename 的原子替换，坏文件不会把好文件写坏；读到坏 JSON 会退回上一份能用的快照。宿主连不上时界面自动退到浏览器本地存储，并在左下角标出来，不会白屏。

## 助手工具

装了插件之后，助手多了两个工具：

- `mind_canvas_read` — 把某张脑图读成 Markdown 大纲（含节点数 / 根数 / 层数）。
- `mind_canvas_add` — 在某个节点下面加子节点（`parent` 用文字部分匹配；匹配不到就落到根上）。

于是「把这几个想法整理成一张脑图」可以直接在对话里做完，画布上刷新即见。

## 技术选择

- **`@xyflow/react` 12.12.1**（MIT）：无限画布的平移 / 缩放 / 拖拽 / 连线 / fitView / MiniMap 都是现成的，节点是真 React 组件，卡片内联编辑和中文输入法都可控。
- **`d3-hierarchy` 3.1.2**（MIT）：`tree()` 的 tidy tree 算法负责「整理成树」，父节点居中于子节点、同级不重叠。
- 两者连同 React 以外的依赖一起打进 `client.js`（约 253KB，gzip 后约 68KB），React / ReactDOM 走宿主 seed 模块表，不重复打包。
- **`html-to-image` 1.11.13**（MIT）只用来导出 PNG。
- 宿主半片**零运行时依赖**，只用 Node 内置模块，少一个装不上的包就少一类启动失败。
- 主题不写死在 CSS 里：每个颜色都是 `var(--mc-*, var(--dsw-…))`，`theme.js` 只产出 `--mc-*` 覆盖，`auto` 时一个都不给，于是天然跟随宿主明暗主题。
- Markdown 大纲只有一份实现（`export.js`），界面导出、宿主工具 `mind_canvas_read` 和测试共用它，不会各写各的。

## 安装

```bash
dsh plugin install /path/to/dsh-plugins/plugins/mind-canvas
```

或在 Harness 的 设置 → 插件 里指向这个目录。

桌面端的实际情况（实测）：

- `dsh plugin add` 只跑 pnpm，**不会**把包追加进 `dsh.profile.bundles`，要手动加或走 设置 → 插件。
- 把包写进 bundles 并软链进 `~/.dsh/profiles/desktop/node_modules/` 之后，**宿主半片会被 loader 热加载**——`mind_canvas_*` 工具和 `/mind-canvas` 路由当场就活了，不用重启。
- **浏览器半片要刷新一次页面（或重启 App）才出现**：`/plugins/<包名>/client.js` 的 bundle 路由在 boot 时扫描，新包要等下一次组合。之后改 `client.js` 会被 client-hmr 在 500ms 内热替换，不用再重启。

装好后侧栏会多一个「脑图创意画布」，助手也多出 `mind_canvas_read` / `mind_canvas_add` 两个工具。

## 开发

```bash
npm install
npm run build        # client-src/ → client.js（esbuild，套 __ModuleLoader__ 外壳）
npm test             # 72 个测试：树逻辑、布局、存储、路由、工具、导出格式、主题（node --test）
node dev/verify.mjs  # 真 Chromium 端到端：35 项断言 + 截图到 test/screens/
```

`dev/` 是本地验证用的假宿主（模拟 `__ModuleLoader__`、seed 模块表和 Cordis ctx），不随包发布。

## License

MIT
