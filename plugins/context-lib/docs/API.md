# dsh-context-lib — 模块契约（store / HTTP / UI）

本文件是三个实现方共同的接口契约：`src/store.js` + `src/scan.js`（数据层）、`index.js`（宿主接线）、`client-src/*`（面板）。任何一方改字段名或路径都要先改这里。

## 1. 磁盘布局

根目录 `root`（默认 `~/.dsh/context-lib`，支持 `~` 展开）：

```
root/
  index.json          条目索引（唯一真相），结构 {version:1, updatedAt, entries:{id:entry}}
  index.json.bak      写入前的上一版（原子替换时保留一份）
  sources.json        扫描源 {version:1, sources:[{id,name,path,kind,include,exclude,hidden,depth,lastScanAt,lastResult}]}
  notes/<id>.md       本库新建/编辑的笔记正文（storage="note"）
  blobs/ab/cd/<sha>   导入的文件副本（storage="blob"），按 sha256 前 4 位分两级目录
  scan.lock           扫描互斥锁（内容 {pid, startedAt}），>10 分钟视为陈旧
```

原子写：写 `*.tmp-<rand>` → fsync → rename 覆盖；JSON 用 2 空格缩进。并发写用进程内 promise 队列串行化（`withLock`）。

## 2. 条目 entry（index.json 的值，也是 `get()` / `items` 的返回单元）

```js
{
  id: 'cl_9f3c2a7b1d40',        // 'cl_' + 12 位小写 hex（randomBytes(6)）
  title: '扫到或自拟的标题',
  kind: 'doc'|'script'|'image'|'data'|'session'|'note'|'other',
  ext: 'md',                    // 小写、不带点；无扩展名时 ''
  mime: 'text/markdown',        // 尽力推断，未知 'application/octet-stream'
  collection: 'inbox',          // 归类；新建默认 'inbox'
  tags: ['长文', '设计'],        // 去重、trim、最多 24 个
  sourceId: 'workspace'|null,   // 由哪个 source 扫进来的；手工新建为 null
  storage: 'note'|'linked'|'blob',
  path: '/abs/path' | null,     // linked: 指向用户原文件（只读，不移动不删除）；note/blob 为 null
  blob: 'ab/cd/<sha256>'|null,  // storage=blob 时的相对路径
  size: 12345,
  mtimeMs: 1762000000000,
  sha256: 'hex'|null,           // 内容指纹，用于增量扫描与去重；>8MB 的文件可为 null
  status: 'active'|'trashed',
  createdAt: 'ISO', updatedAt: 'ISO', trashedAt: 'ISO'|null,
  preview: '最多 1200 字符的正文摘录',   // 二进制/无文本时 ''
  lines: 120 | null,                    // 文本行数，未知 null
  links: ['另一篇笔记'],                 // wiki 链接 [[target]] 的目标
  meta: { frontmatter?: object, width?: number, height?: number, language?: string, error?: string },
  notes: ''                             // 用户备注（可编辑，可写检索提示）
}
```

`list()` 的条目是**摘要**：entry 去掉 `preview` 全文，换成 ≤160 字符的 `snippet`（命中位置上下文），并保留 `id,title,kind,ext,collection,tags,sourceId,storage,path,size,status,updatedAt,snippet`（`path` 仅在 linked 条目上非空，note/blob 为 null）。

## 3. 数据层 API（`src/store.js`）

```js
export class LibraryError extends Error {}   // new LibraryError(msg, {code, hint})；code 见下
export function resolveRoot({ rootDir } = {})            // -> 绝对路径，展开 ~，默认 ~/.dsh/context-lib
export function classifyKind(absPath)                    // -> 'doc'|'script'|'image'|'data'|'session'|'note'|'other'
export function mimeFor(ext)                             // -> mime 字符串
export async function createLibrary(root, options = {})  // -> Library；options: {maxPreviewChars=1200, maxTextBytes=2*1024*1024, maxEntries=20000}
```

`Library` 方法（全部 async；所有错误抛 `LibraryError`）：

| 方法 | 行为 |
| --- | --- |
| `init()` | 建目录、读/修 index.json（缺字段补齐）、sources.json 不存在时写入默认源；幂等 |
| `stats()` | `{root, counts:{active,trashed,notes,byKind:{...}}, collections:[{name,count}], tags:[{name,count}], sources:[{id,name,path,count,lastScanAt}], bytes, updatedAt}` |
| `list(query)` | `{total, limit, offset, items, facets:{kinds:[{kind,count}], collections:[{name,count}], tags:[{name,count}]}}`；query `{q,kind,collection,tag,source,status='active',sort='relevance'|'updated'|'title'|'size',limit=50,offset=0}`；limit 夹到 1..200 |
| `get(id)` | entry 或 null；id 不存在时 null（不抛） |
| `readText(id,{startLine,endLine,maxChars=20000})` | `{id,title,text,truncated,totalLines,bytes}`；二进制条目 `text=''` 且 `binary:true` |
| `create({title,content='',kind='note',collection='inbox',tags=[],notes=''})` | 写 `notes/<id>.md`，返回 entry |
| `update(id, patch)` | patch `{title,tags,collection,notes,content}` 中出现的字段才改；`content` 仅 note 可改；返回 entry |
| `remove(id)` | `status='trashed'`，`trashedAt` 置 now；返回 entry |
| `restore(id)` | 回到 active；返回 entry |
| `purge(id)` | 删 notes/blob 文件 + 索引项（linked 只删索引，**绝不删**用户原文件）；返回 `{id}` |
| `listTrash({limit=50,offset=0})` | `{total, items}`（摘要，status='trashed'） |
| `scan({sourceId, force=false, onProgress})` | 单源增量扫描，见 §4；返回 `{sourceId,added,updated,removed,unchanged,skipped,errors:[{path,message}],durationMs}` |
| `sources()` | `[{id,name,path,kind,include,exclude,hidden,depth,lastScanAt,count}]` |
| `addSource({name,path,kind='mixed',include=[],exclude=[],hidden=false,depth=6})` | id 由 name slug 化（冲突加 `-2`）；路径必须存在且是目录，否则 `invalid-source` |
| `removeSource(id)` | 删除源与它的条目（linked 条目一并移除索引）；返回 `{id}` |
| `pack(collection,{limit=20,maxChars=12000})` | 把集合内条目按 updatedAt 倒序拼成 markdown 摘录（`## title\n<preview>`），超 maxChars 截断并标注；返回 `{collection,total,text}` |

### 错误码

`invalid-argument`(400) · `item-not-found` (404) · `source-not-found`(404) · `library-busy`(409) · `invalid-source`(400) · `library-error`(500)。
`hint` 可选，会透传给面板和工具返回值。

### 默认源（仅当 sources.json 不存在时写入）

```js
[
  { id: 'workspace', name: '工作区', path: '~/Documents/deepseek-harness/default-workspace', depth: 4 },
  { id: 'docs',      name: '文档',   path: '~/Documents', depth: 3 },     // 排除 node_modules 等
  { id: 'dsh',       name: 'DSH',    path: '~/.dsh', depth: 3 },           // sessions/skills/notes
]
```
用户可以在面板里增删源；`path` 不存在时该源在 `sources()` 里带 `missing:true`，扫描直接返回 `errors` 而不是抛。

## 4. 扫描规则（`src/scan.js`）

- 递归深度 ≤ `depth`（默认 6）；不跟随符号链接；单次最多 4000 个文件、索引上限 `maxEntries`，超出后 `skipped += 1` 并记一条 error。
- 跳过目录名：`node_modules .git .svn .hg dist build out coverage .next .nuxt .cache .venv venv __pycache__ .pnpm-store .Trash Library Applications target vendor .idea .vscode`；跳过文件：`*.log *.tmp *.lock *.pyc` 与点文件（源配置 `hidden:true` 时例外）。
- 扩展名白名单：doc: `md markdown txt rst org tex pdf doc docx odt rtf epub`；script: `js mjs cjs ts tsx jsx py sh bash zsh rb go rs java kt c h cpp hpp cs php lua pl r sql swift`；image: `png jpg jpeg gif webp svg heic bmp tiff ico avif`；data: `json jsonl yaml yml toml ini csv tsv xlsx xls parquet db sqlite`。其他扩展名跳过（`skipped`）。
- 文件 > 8MB：只记元数据（`preview=''`, `sha256=null`）。
- 文本文件（mime 以 text/ 开头或 .md/.json/.yaml…）：读前 `maxTextBytes`，`preview` 取前 `maxPreviewChars` 字符，`lines` 计行数。
- 标题：YAML frontmatter `title:` → 首个 `# 标题` → 文件名去扩展名（`-`/`_` 替换为空格）。
- 标签：frontmatter `tags:`（数组或逗号分隔）。
- `links`：正文里所有 `[[target]]` 的 target。
- 增量：同 `path` 且 `size`+`mtimeMs` 未变 → `unchanged` 且保留原 id；变了且 sha256 变 → 更新并 `updated`；源内已不存在的 path → 从索引移除（`removed`，不进回收站）。
- 扫描互斥：`scan.lock` 存在且 <10 分钟 → 抛 `library-busy`；结束（含异常）必须删除锁。
- 不修改用户原文件，不做引用计数删除。

## 5. 检索（`list({q})`）

- 大小写不敏感；q 按空白切 token，**全部 token** 命中才算（AND）。
- 单 token 命中字段计分：title +6、tags +4、collection +2、path +2、preview +1；`snippet` 取 preview 中第一个命中 token 前后各 80 字符（去换行 → 空格）。
- `sort=relevance` 按分数降序，同分按 updatedAt 降序；`q` 为空时 relevance 等价于 updated。
- 中文不分词：整段 q 也做一次子串匹配（title/tags/preview），命中 +3，避免「查一个中文词零结果」。

## 6. HTTP API（`index.js`，前缀 `/api/context-lib`）

统一返回 `{ok:true,data}` 或 `{ok:false,error:{message,code,hint?}}`。每个请求先过 `ctx.get('connection').requestRejection({headers})`，无 connection 服务返回 503，被拒返回其状态码；`HEAD` 等同 `GET` 但无 body。请求 body 上限 1MB。

| 方法与路径 | 入参 | data |
| --- | --- | --- |
| `GET /state` | — | `{stats, sources, kinds, collections, trashCount, root}` |
| `GET /items` | 查询串 `q,kind,collection,tag,source,status,sort,limit,offset` | `{total, items, facets}` |
| `GET /items/:id` | — | `{item, content?}`：文本条目附带 `content`（≤20000 字符） |
| `GET /items/:id/content` | `maxChars,startLine,endLine` | `{id,title,text,truncated,totalLines,binary}` |
| `GET /items/:id/raw` | — | 文件字节流；note 返回 text/markdown；linked 读原文件；blob 读副本 |
| `GET /items/:id/preview` | `maxChars` | `{kind:'text'|'thumb'|'image'|'none', text?, chars?, truncated?, note?}`；docx/rtf/odt 走 `textutil`，html 剥标签，pdf/xlsx/ppt 出缩略图 |
| `GET /items/:id/thumb` | — | PNG 缩略图（`qlmanage`，按 文件+大小+mtime 缓存到 `<root>/cache/thumbs`）；失败 `415 preview-unavailable` |
| `GET /trash` | `limit,offset` | `{total,items}` |
| `POST /items` | `{title,content,collection,tags,kind}` | `{item}` |
| `PATCH /items/:id` | `{title,tags,collection,notes,content}` | `{item}` |
| `DELETE /items/:id` | — | `{item}`（进回收站） |
| `POST /items/:id/restore` | — | `{item}` |
| `POST /items/:id/reveal` | — | `{revealed:true,path}`：macOS 用 `open -R` 在访达选中原文件；note/blob 404、原文件丢失 404、非 darwin 501 |
| `DELETE /items/:id/purge` | — | `{id}` |
| `POST /scan` | `{sourceId?,force?}` | `{results:[scanResult]}`，未给 sourceId 则扫全部源（串行） |
| `GET /sources` | — | `{sources}` |
| `POST /sources` | `{name,path,depth?}` | `{source}` |
| `DELETE /sources/:id` | — | `{id}` |
| `GET /pack` | `collection,limit,maxChars` | `{text,total}` |
| `POST /import` | `{path,collection?,tags?}` | `{item}`（把任意本机文件登记进来；文本复制进 blobs） |
| `GET /assist/status` | — | `{ready,model,reason}`：无 `llm` 服务或无默认模型时 `ready:false`，`reason` 是给面板直接显示的原因 |
| `POST /assist` | `{mode:'summary',id}` / `{mode:'organize',ids:1..30}` / `{mode:'ask',question:1..2000}` | `{mode,model,text,actions}`：summary 的 actions 为 `null` 或 `{title?,tags?,collection?}`；organize 为 `{items:[{id,collection,tags,reason}]}`（只含输入里存在的 id）；ask 为 `{filters:{q?,kind?,collection?,tag?}}`（非法值被丢弃） |

智能助手的错误码：`400 invalid-argument`（mode 非法 / 缺 question / ids 为空或超 30）、`404 item-not-found`（summary 的 id 不存在）、`502 assist-failed`（模型报错或输出不是 JSON，message 带模型原始文本前 300 字符）、`503 assist-unavailable`（没有 llm 服务或没有默认模型）；模型调用 90 秒超时按 `assist-failed` 返回。

## 7. 面板（`client-src`，侧栏 id `context-lib`）

- 布局：左侧「来源 / 归类 / 标签」树；中间检索框 + 类型筛选 + 视图；右侧详情（标题、标签、归类、备注可编辑；文本预览或图片；复制路径/内容、保存、删除、恢复）。
- 顶部：`扫描` 按钮（显示每源结果 toast）、`新建笔记`、`回收站` 开关、刷新；另有「列表 / 卡片 / 表格 / 图库」下拉选择（原生 `select.clib-select`，`aria-label` 用 `viewLabel`）与助手按钮。
- 展示形式：四视图由 `ItemList` 分派（`list` 沿用 `ItemRow`，`cards` / `table` / `gallery` 各自组件），选中态、加载态、空态、分页「加载更多」在四种视图下一致；表格的标题 / 大小 / 更新时间表头可点排序（复用列表 `sort` 状态）；图库只展示 `kind=image`。当前视图存 `localStorage.clib:view`。
- Markdown：`kind=note` 或 `ext=md` 的条目，详情预览头出「渲染 / 源码」分段控件，默认渲染（`client-src/markdown.js`，仅用 React 文本节点，`dangerouslySetInnerHTML` 用量为 0）。
- 全屏预览：预览头右侧「全屏」按钮把当前预览（文本行号视图 / Markdown 渲染 / 图片，含当时渲染-源码模式）铺进 `.clib-fs` 覆盖层——`position:absolute; inset:0`，锚在 `position:relative` 的 `.clib-body`（面板内覆盖，不用 portal、不挂 `document.body`）。关闭：右上按钮 / `Esc` / 点遮罩；打开焦点落关闭按钮、关闭回焦全屏按钮；切换条目自动退出；内容滚动发生在 `.clib-fs-body` 内。
- 交互细节：搜索 250ms 防抖；列表项点击选中；删除需二次确认；`linked` 条目提示「只移除索引，不动原文件」。
- 智能助手（右侧 360px 抽屉，`localStorage.clib:assist` 记开关）：打开时 `GET /assist/status`，`ready:false` 时显示 `reason` 并禁用三页提交按钮；**总结**对当前选中条目调 `POST /assist {mode:'summary',id}`，把 `actions.title/tags/collection` 逐项 PATCH 回条目并刷新列表与详情；**整理**取当前筛选的前 15 条调 `{mode:'organize',ids}`，表格展示 `items[].reason`，可逐行或全部应用，失败行内保留错误；**提问**调 `{mode:'ask',question}`，回答按 Markdown 渲染，返回的 `filters` 一键写入检索条件（回收站视图中先切回在用）。
- 视觉：`client-src/style.js` 自带 `clib-*` 样式与设计令牌，深浅色跟随 `html[data-theme]`，不引入新依赖。
- 构建：`node build.mjs` 产出 `client.js`（esbuild cjs + `window.__ModuleLoader__.load` 包装，external react）。
