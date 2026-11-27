# 侧边栏入口设置（顺序 + 显隐）

给 DSH 左侧入口列表加一行 **入口设置**：点开可以调整每个入口的上下顺序、勾选/取消在列表中显示。配置存在浏览器 `localStorage`（key `dsh.sidebar.entryPrefs.v1`），刷新页面、重启应用都保留。

## 它做了什么

DSH 的左侧列表由 `@deepseek-ai/dsh-client-ui-sidebar` 渲染，入口顺序来自各插件注册的 `order`，显示/隐藏来自一个只存在内存的 pin 集合。官方没有持久化入口，这个插件替换掉核心侧边栏，并在上面做了四处改动：

1. pin 集合改为从 `localStorage` 读取、每次变更写回；
2. 新增一份持久化的入口顺序快照，列表与「更多」菜单都按这份顺序排序，未列出的新入口按注册顺序排在后面；
3. 列表末尾、`更多` 下方新增一行 `入口设置`（齿轮图标），折叠成 rail 时只显示图标；
4. 新增设置对话框：每行 = 原图标 + 名称 + 上移/下移 + 显示勾选框；底部 `恢复默认` 清空顺序并重新显示全部。`插件` 是进入插件页的兜底入口，勾选框固定勾上、不可隐藏。

隐藏的入口不会消失，仍然在 `更多` 菜单里可以点开——这样不会出现「找不到回来」的死路。

## 安装

市场里搜 **侧边栏入口设置** / **Sidebar entries** 即可安装；命令行等价于：

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/sidebar-entries"
```

**装完要重启应用**（退出再打开）：客户端 bundle 在 host 启动时读入并缓存，重新加载窗口不会重读。重启后侧边栏应在 `更多` 下方出现 `入口设置`。

插件通过自己的 `cordis.patch.yml` 接线，装好即生效，不需要手改 profile：

- 禁用核心行 `ui-sidebar`；
- 插入 `sidebar-entries` 行，指向本包的 client 半片。

卸载插件后这两条补丁随 bundle 一起消失，侧边栏自动回到官方实现。

## 使用

- 点 `入口设置` 行打开对话框；
- `上移` / `下移` 调整顺序，列表与「更多」菜单立即跟着变；
- 取消勾选即从列表隐藏，`插件` 行不可取消；
- `恢复默认` 清空顺序、重新显示全部。

## 数据与恢复

只写一个 localStorage key：`dsh.sidebar.entryPrefs.v1`，内容形如 `{"order":["..."],"unpinned":["..."]}`。删掉这个 key 或按 `恢复默认` 即可回到初始状态。插件不写任何宿主文件，也不改 profile 配置。

## 兼容性与升级

- **它替换核心侧边栏**，不是旁挂扩展：`client.js` 是 `@deepseek-ai/dsh-client-ui-sidebar` 0.2.1-rc.4 的补丁版。DSH 升级后，新版侧边栏自己的改动不会出现在这里；如果新版改了侧边栏结构，需要重新取原始 bundle、跑 `tools/patch-client.mjs` 再发版。
- 不要与其他「替换侧边栏」的补丁同时启用（例如旧的手工 `install.sh` override）：两个实现都会注册同一个 `sidebar` slot，客户端会拒绝第二个。
- 只影响 Web 客户端半片，宿主侧没有任何行为。

## 重新生成 client.js

```bash
# 1. 从目标版本的 app.asar 取出原始 bundle，存为 tools/pristine-client.js
# 2. 重新打补丁（断言锚点唯一，可重放）
node tools/patch-client.mjs tools/pristine-client.js client.js
```

`tools/patch-client.mjs` 里每个锚点都断言只命中一次，失败会直接报错，不会产出半补丁文件。

## 验证

```bash
# 在独立 profile 里装好插件并起一个 web 实例（端口 0 由系统分配）
node test/e2e.mjs "http://127.0.0.1:<PORT>/?token=..." /tmp/sidebar-entries-e2e
```

e2e 会检查：`入口设置` 行存在、对话框列出全部入口、取消勾选后入口从列表消失、上移改变顺序、刷新后两者都保留、`恢复默认` 复原且清空 localStorage、控制台无异常。

## 文件

```
index.js               宿主半片（无行为，只为让插件出现在 Loader 里）
client.js              打过补丁的侧边栏 client bundle（本插件的 client 半片）
cordis.patch.yml       禁用核心行 + 插入本插件的行
icon.svg               市场图标
tools/pristine-client.js   0.2.1-rc.4 原始 bundle（重新生成用，不进包）
tools/patch-client.mjs     补丁脚本（断言锚点唯一，可重放）
test/e2e.mjs           puppeteer 交互验收
```
