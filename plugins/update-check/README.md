# dsh-update-check

DSH Desktop 的「版本更新」面板：告诉你在跑的是哪个版本、更新源上最新是哪个版本，发现新版本时给出**一次点击**的升级入口。

```
侧边栏「版本更新」
├─ 当前版本   v0.2.1-rc.4          ← 读安装包本体（Info.plist / 打包 manifest），不是猜的
├─ 最新版本   v0.2.2-rc.1          ← 读 electron-updater 更新源（与桌面端同一个 app-update.yml）
├─ 更新源     …/nightly/latest-mac.yml
└─ [立即更新]  [重新检查]
```

## 它做什么

1. **Host 半**（`index.js`）注册 `GET|POST /api/dsh-update-check/{status,check}`，同源 + `connection.requestRejection` 鉴权，返回：
   - `currentVersion`：安装包真实版本。Host 进程里桌面端已注入 `DSH_CLIENT_VERSION`，优先直接读它；没有则读 `Contents/Info.plist` 的 `CFBundleShortVersionString`，再退回解析 `app.asar` 内的 `dsh/desktop-runtime.json`；
   - `feed`：从 `Resources/app-update.yml` 解析出的更新源、channel 与最终 manifest URL（与 electron-updater 的路径规则一致：`<url>/<channel>/latest-mac.yml`）；
   - `latest` / `updateAvailable` / `error`：版本比较按 semver 优先级（含 `-rc.N` 预发布），失败给出结构化原因（`feed-unreachable` / `feed-timeout` / `manifest-invalid` / `version-unknown` / `feed-unconfigured`），**不会** 500。
2. **Web 半**（`client.js`）在侧边栏挂一个面板，并把「立即更新」接到桌面端自带的更新器：

```js
window.dshDesktop.updates.open()   // → dsh-desktop:updates-open → openUpdatePrompt()
                                   // → checkForUpdates → downloadUpdate → quitAndInstall
```

所以**下载、校验、清理任务、确认重启都由应用自己完成**，本插件不写任何应用文件、不假装能升级。

## 它不做什么

- 不在页面里替换 `.app`。应用是签名包，页面侧替换会破坏签名。
- 不把「上游 npm 包有新版本」当成「桌面端能一键安装」。本插件只认桌面端自己的更新源。
- 浏览器里打开 `http://127.0.0.1:<port>` 时没有 preload 桥，面板会明确说明「不在桌面应用内」，按钮降级为下载安装包。

## 安装

### 从插件市场索引安装（推荐）

本仓库自带市场索引。DSH Web UI 打开 **Plugins → Discover**，添加索引地址：

```text
https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json
```

搜索 **Version update check · 版本更新检查**，安装即可。

### 手动安装（钉住某个版本）

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/update-check"
```

### 本地目录开发安装

DSH 插件管理器按「本地目录」安装（`plugin_manager install_bundle`，绝对路径）：安装后 plugin manager 会走 `hmr.reconcileProfile` 热应用；若提示需要重启，再重启 Desktop。

> `dsh plugin --profile desktop add …` **不行**——`dsh` CLI 明确拒绝托管 `desktop` profile（"managed exclusively by the Electron application"）。

改完 profile 需要重启 Desktop（Host 在启动时按 profile 装载 bundle）。卸载/回滚：删掉依赖与 profile 里的插入，`pnpm install`，重启。

> 一个坏掉的 client bundle 会让整个页面卡在 “Failed to load plugins”，所以安装前先跑 `node test/run-all.mjs`。

## 配置

`cordis.patch.yml` 的 `config`（可选）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `feedUrl` | `app-update.yml` 里的 `url` | 覆盖更新源。传 `.json` 时按 `{ "version": "...", "url": "..." }` 解析，传 YAML 时按 `latest-mac.yml` 解析 |
| `channel` | `app-update.yml` 里的 `channel` | 例如 `nightly` / `latest`；manifest 路径随 channel 变化 |
| `cacheSeconds` | `60` | 检查结果缓存；`?refresh=1` 与 `POST /check` 绕过 |

> `feedUrl` 一旦不是应用自己的更新源，面板会把主按钮降级成「下载安装包」——因为只有桌面端自己的源才能交给应用内更新器安装。

## 验证

```bash
node test/run-all.mjs
```

16 项检查，无框架、无外网依赖：semver 比较、`app-update.yml` 解析与 manifest URL 推导、YAML/JSON manifest 解析、真实安装版本读取（含 asar 回退）、真实 HTTP server 上的鉴权/成功/已最新/feed 404/缓存/强制刷新、以及 client 半的 loader 注册、slot 绑定、状态映射、渲染出来的文案与「点一下就调用 `updates.open()`」。另有 5 组回归用例守着一次对抗审查挖出来的坑：原生 `error` 阶段不能谎报「已是最新」、原生 `available` 要带出版本号、慢探针不能覆盖强制刷新的缓存、非法 `feedUrl` 只能变成结构化错误（不能 500 / reject）、非 semver 的 plist 版本要落到下一条来源、`javascript:`/`data:` 下载链接必须丢弃、双击只交接一次。

## 这个安装里的实际情况（2026-11-10）

- 当前安装：`0.2.1-rc.4`（`Info.plist` 与 `dsh/desktop-runtime.json` 一致）。
- 应用自己的更新源 `https://download.deepseek.com/dsh-desk/feeds/mac-x64/nightly/latest-mac.yml` 今天返回 **404**（`latest-mac.yml`、`latest-mac.yml` 的父级、`mac-arm64` 变体都试过），所以面板会显示「更新源不可达」，桌面端菜单里的「检查更新…」也同样会失败。
- 上游 `@deepseek-ai/dsh` 在 npm 上的 `latest` 是 **0.2.2-rc.1**，比安装的 `0.2.1-rc.4` 新；但那是 npm 包的分发版本，不等于桌面端更新源上有可安装的构建。
