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

1. **`gh` CLI 登录（推荐，零配置）**：插件执行 `gh auth token --hostname github.com`，
   复用本机已有的 `gh auth login`（包括 macOS keyring 中的账号）。登录后无需重启，
   在面板里点“重试”即可；切换账号后下一次请求会自动重新解析。
2. **环境变量 `GH_TOKEN` / `GITHUB_TOKEN`**（优先 `GH_TOKEN`）：适用于没有 gh CLI 的环境，
   但改完环境变量需要重启 DeepSeek Harness。

```bash
gh auth login                 # 方式一：复用已有 GitHub 登录
export GH_TOKEN=<your-token>  # 方式二：环境变量（需重启）
```

- 经典 token：勾选 `repo` 权限（私有仓库 / Issue 读写）。
- Fine-grained token：给目标仓库 Contents、Issues、Pull requests 的读写权限。

可用 `GITHUB_MANAGER_DISABLE_GH=1` 关闭 gh CLI 回退（只用环境变量），
`GITHUB_MANAGER_GH_BIN=/path/to/gh` 指定 gh 可执行文件（测试或非标准安装）。
凭据缺失或失效时，面板会显示配置指引；Host 工具会返回可读的错误信息。

## 面板

侧边栏的 GitHub 图标打开“GitHub 项目管理”：

- 左侧：仓库列表，支持搜索、公开/私有筛选，显示语言、星标、更新时间。
- 右侧：仓库概要（星标、Fork、未关闭条目数、默认分支）、Issue / Pull Request 切换、
  打开/关闭状态筛选。
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
node .verify-host.mjs    # 用 stub fetch 跑通 8 个工具 + 全部面板路由 + 鉴权拒绝
node .verify-client.mjs  # 用 React hook shim 跑通 8 种面板渲染状态
```

卸载：在插件管理里移除本 bundle，或在 profile 的 `cordis.patch.yml` 中禁用该行。
