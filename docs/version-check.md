# 插件版本自查（version check）

每个 dsh-plugins 插件自带一个「有新版本」提示：面板顶部出现 `↑ v0.3.4` 徽标，点击打开该插件的 GitHub 页。
**只提示，不自动安装**——安装仍走插件市场 / `plugin install`，与 `dsh-context` 的做法一致。

## 数据从哪来

| 项 | 来源 |
| --- | --- |
| 已装版本 | 插件自己的 `package.json` 的 `version` |
| 最新版本 | 本仓 [`index.json`](../index.json) 里该插件 `versions[].version` 的最高值 |
| index 地址 | `https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json`，失败回退 jsDelivr |
| 跳转 | index 条目里的 `homepage`（`.../tree/main/plugins/<name>`） |

索引结果缓存 1 小时；网络失败保留上一次结果并标记 `failed`，接口不抛 500。
本地开发版本领先于索引时（`current > latest`）**不显示**徽标，避免“永远有新版本”的误报。

## 共用实现

规范文件：[`scripts/version-check.mjs`](../scripts/version-check.mjs)。它被复制到每个插件的 `version-check.js`：

```bash
node scripts/sync-version-check.mjs          # 同步
node scripts/sync-version-check.mjs --check  # 校验（不一致退出 1）
```

**不要单独改 `plugins/<name>/version-check.js`**，改规范文件后重新同步。

导出：

- `createVersionChecker({ pluginName, packageUrl?, indexUrls?, fetchImpl?, ttlMs?, now? })`
  - `check({ refresh? })` → `{ plugin, current, latest, updateAvailable, homepage, failed, checkedAt }`
  - `clearCache()` / `currentVersion()`
- `createVersionRoute({ checker, getConnection })` — `webServer.register` 的 handler
- `parseSemver` / `compareSemver` / `isNewer` / `pickIndexEntry` — 纯函数，便于测试

## 宿主接入（3 步）

```js
import { createVersionChecker, createVersionRoute } from './version-check.js'

const versionChecker = createVersionChecker({ pluginName: 'dsh-context-lib' }) // 与 index.json 的 name 一致

ctx.inject(['webServer'], (webCtx) => {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: '/api/context-lib/version',
    handler: createVersionRoute({ checker: versionChecker, getConnection: () => webCtx.get('connection') }),
  }))
})
```

已有 `prefix` 路由的插件，也可以把 `/version` 加进自己的 dispatcher（见 `plugins/context-lib/index.js` 的 `/version` 分支），
返回 `{ ok: true, data }` 即可。客户端一律 `GET /api/<prefix>/version`。

## 客户端接入

1. 在 API helper 里加 `version()` → `GET /version`。
2. 面板顶栏右端渲染徽标，只在 `updateAvailable === true` 且 `latest` 是字符串时出现：

```jsx
h('a', {
  className: 'clib-version', href: data.homepage, target: '_blank', rel: 'noreferrer',
  title: format(t('updateTip'), { version: `v${data.latest}` }),
},
h('span', { className: 'clib-version-label' }, t('updateLabel')),
h('span', { className: 'clib-version-number' }, `↑ v${data.latest}`))
```

3. 文案（zh / en）：

```
updateLabel: 新版本 / Update
updateTip:   新版本 {version} 已发布，点击前往插件页更新
             / Update {version} is available — click to update on the plugin page
```

4. 没有顶部栏的插件，放到自己的 header / 设置区 / 会话工具条里；原则是“插件自己的 UI 里能看到”，
   不要往别人的面板塞。

## 验收

```bash
node scripts/sync-version-check.mjs --check
bash scripts/test-all.sh --fast
```

单个插件：

```bash
cd plugins/<name> && npm test
node -e "import('./version-check.js').then(async m => console.log(await m.createVersionChecker({pluginName:'<index 里的 name>'}).check()))"
```
