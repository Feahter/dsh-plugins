# GitHub 项目管理 · GitHub project manager

一个常驻的 DeepSeek Harness 插件：在 Web 侧边栏提供 GitHub 项目管理面板，同时注册一组
`github_*` 工具，让我在对话里也能查询和管理仓库、Issue 与 Pull Request。

本插件与 [Realtime voice input](../realtime-voice) 是同一个仓库
[`Feahter/dsh-plugins`](https://github.com/Feahter/dsh-plugins) 中同级的两个插件，
并收录在同一份插件市场索引中。

## 安装

在 Harness Web UI 的 **插件 → 发现** 中添加索引：

```
https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json
```

然后搜索 **GitHub project manager** 安装。索引会钉住包含本插件的精确 commit。

手动安装（`<commit>` 取自 `index.json` 中该版本的 `source.commit`，或直接用 `main`）：

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/github-manager"
```

## 凭据

Host 进程按以下顺序解析凭据，token 从不进入浏览器：

1. **环境变量 `GH_TOKEN` / `GITHUB_TOKEN`**（优先 `GH_TOKEN`，显式设置时优先级最高）：适用于没有 gh CLI 的环境，
   但改完环境变量需要重启 DeepSeek Harness。
2. **面板里加密保存的 token**：在未配置时直接把 token 粘贴到面板的“保存 token”表单。
   在能访问 Electron `safeStorage` 的 Host 进程中，token 加密后写入
   `<DSH_HOME>/github-manager/credentials.json`（base64 密文，权限 0600）。
   读取时通过 `safeStorage.decryptString` 还原；没有系统安全存储时只保存在进程内存里，重启后失效，
   面板会显示降级提示，**不会**退回到明文落盘。
3. **`gh` CLI 登录（推荐，零配置）**：前两者不存在时，插件执行 `gh auth token --hostname github.com`，
   复用本机已有的 `gh auth login`（包括 macOS keyring 中的账号）。登录后无需重启，
   在面板里点“重试”即可；切换账号后下一次请求会自动重新解析。
4. **`~/.config/gh/hosts.yml`**：gh CLI 不可用时直接读该文件里 `github.com` 的 `oauth_token`；
   其他 host（例如 GitHub Enterprise）的 token 不会被用到 api.github.com。

```bash
export GH_TOKEN=<your-token>  # 方式一：环境变量（需重启，优先级最高）
gh auth login                 # 方式二：复用已有 GitHub 登录
```

Windows 上插件会依次探测 `gh.exe`（PATH、`%ProgramFiles%\GitHub CLI`、`%LOCALAPPDATA%\GitHub CLI`），
并在 gh 不可用时直接读 `%APPDATA%\GitHub CLI\hosts.yml`，因此 PowerShell / winget 安装的
gh 登录同样零配置可用。

- 经典 token：勾选 `repo` 权限（私有仓库 / Issue 读写）。
- Fine-grained token：给目标仓库 Contents、Issues、Pull requests 的读写权限。

可用 `GITHUB_MANAGER_DISABLE_GH=1` 关闭 gh CLI 回退（只用环境变量），
`GITHUB_MANAGER_GH_BIN=/path/to/gh` 指定 gh 可执行文件（测试或非标准安装）。
旧的明文凭据文件会在第一次读取时就地迁移为密文（原子替换）；迁移失败时保留原文件并继续使用 token，
面板会显示告警。凭据缺失或失效时，面板会显示配置指引；Host 工具会返回可读的错误信息。
任何日志、错误信息和工具返回都不会携带 token 原文。

## 面板

侧边栏的 GitHub 图标打开“GitHub 项目管理”：

- 左侧：仓库列表，支持搜索、公开/私有筛选，显示语言、星标、更新时间。
- 右侧：仓库概要（星标、Fork、未关闭条目数、默认分支）、Issue / Pull Request / 分支切换、
  打开/关闭状态筛选。
- 分支页签：列出全部分支（名称、最近提交、作者、时间），标出默认分支与受保护分支，
  并显示相对默认分支的领先 / 落后提交数；点分支后按该分支查看最近提交与文件树，
  可以逐级进入目录、预览文本文件（二进制或超过 512 KB 的文件只给提示）。
  这里只切换面板视图，不改动本地工作树；Issue 与 Pull Request 始终是全仓库口径。
- Pull Request 详情：点列表项进入，显示标题、作者、状态、草稿/合并状态、增删行数与文件数，
  变更文件列表（最多 100 个，超出标出截断）、每个 review 的状态与作者、以及最近 10 条评论摘要。
  整份 diff 不会内联，点单个文件才按需拉取该文件的 patch（超过 200 KB 会截断标注）。
  某个子接口失败时详情仍然可用，缺失的区块会在面板里明确标出。
- 操作：新建 Issue、关闭/重新打开 Issue、在 GitHub 打开、复制克隆地址、刷新。

## 工具

| 工具 | 作用 |
| --- | --- |
| `github_status` | 检查 token、账号与 API 速率余额 |
| `github_list_repos` | 列出可访问仓库 |
| `github_get_repo` | 读取单个仓库元数据 |
| `github_list_issues` | 列出 Issue（不含 PR） |
| `github_create_issue` | 新建 Issue |
| `github_update_issue` | 关闭/重开或修改 Issue |
| `github_comment_issue` | 给 Issue / PR 添加评论 |
| `github_list_pulls` | 列出 Pull Request |
| `github_get_pull` | 读取单个 PR 详情：文件（最多 100）、review 状态、对话摘要；子接口失败会标注 `missing` |
| `github_list_branches` | 列出分支，并附默认分支、保护状态与领先/落后提交数 |
| `github_list_commits` | 按分支（或任意 ref）列出最近提交 |
| `github_list_tree` | 列出分支上某个目录的文件树 |
| `github_get_file` | 读取分支上某个文件的文本内容 |

## 实现

- `index.js`（Host）：GitHub REST 客户端、`github_*` 工具注册、面板数据路由
  `/api/github-manager/*`（先经过 `ctx.connection.requestRejection`，与 Web 页面共用同一套
  Host/Origin 与浏览器 cookie 鉴权）。
- `client.js`（Client）：`sidebar.panellist` 图标 + `main` 面板；样式只使用
  `--dsw-alias-*` 主题 token；文案通过 `ctx.locale` 注册（zh / en）。
- `cordis.patch.yml`：插入插件行 `github-manager`。

## 开发验证

不需要真实 token，也不会污染 profile：

```bash
node .verify-host.mjs    # 用 stub fetch 跑通 12 个工具 + 全部面板路由 + 鉴权拒绝
node .verify-client.mjs  # 用 React hook shim 跑通 10 种面板渲染状态
```

卸载：在插件管理里移除本 bundle，或在 profile 的 `cordis.patch.yml` 中禁用该行。
