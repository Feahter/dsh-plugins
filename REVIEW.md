# REVIEW.md：单审阅者、多轮、绑定内容的审阅规则

本文件是 dsh-plugins 的默认审阅规则，**只从默认分支读取**（见 §7）。它定义“一次审阅怎样才能算数”，不是通用 SOLID 清单：只写本仓真实踩过的坑和宿主契约风险。

## 1. 审阅者模型

- 一个任务固定一个 `reviewerId`，首轮声明后不得更换。
- 允许同一审阅者继续多轮（修完再审），**不堆多个模型票数**；多数票不是证据。
- 旧轮保留但不得批准新内容：修一次就要重新捕获 subject 再录一轮。
- 跨轮用 `findingId` 追踪 `resolved` / `open`，并引用过去的漏检与事故记录（`docs/verification-incidents.md`）。
- `reviewerId` 是声明标识，不是密码学身份认证；它只说明“这一轮是谁签的”。

## 2. 绑定内容：审批只对一份内容有效

一轮审阅绑定以下五项，任一变化即失效，必须重审：

| 绑定项 | 含义 |
| --- | --- |
| `subject.head` | 审阅时的 HEAD sha（parent commit） |
| `subject.subjectHash` | 候选内容哈希（tracked + 未忽略的 untracked，含路径、mode、内容，符号链接记 target） |
| `subject.indexTree` | 提交模式下的 `git write-tree`；working 模式为 `null` |
| `baseSha` | 默认分支基线 sha（merge-base 与冻结规则来源） |
| `policyHash` | 本次实际使用的 REVIEW.md + reliability.json + 事故文档 + 验证程序的哈希 |

- 改一个字节、改 index、换 base、换规则，旧轮全部失效。
- `indexTree=null` 的 working 凭据**不能**用于 pre-commit；提交场景必须先 `full --staged` 再录审阅。
- HEAD 相同但代码改过也算内容变了（靠 `subjectHash` 判定，不靠 commit 号）。

## 3. 输出：round.json 必填字段

| 字段 | 要求 |
| --- | --- |
| `reviewerId` | 固定标识，全任务一致 |
| `round` | 从 1 递增，不得跳号 |
| `previousRoundHash` | 上一轮 round.json 的 sha256；第 1 轮为 `null` |
| `subject.head` | 40 位 sha |
| `subject.subjectHash` | 与 verify 报告一致 |
| `subject.indexTree` | 提交模式必填 40 位 sha；working 模式 `null` |
| `baseSha` | 与 verify 报告一致 |
| `policyHash` | 与 verify 报告一致 |
| `findings[]` | 可为空数组，不可省略 |
| `verdict` | `pass` 或 `request_changes` |
| `stamp` | 无发现时必须为字符串 `"none"` |
| `checks` | 实际执行过的检查与结果 |
| `evidenceRunIds` | 本轮引用的 verify runId 列表 |

`checks` / `evidenceRunIds` 是溯源信息：没有 runId 的结论只能算人工判断，不能冒充实跑证据。

## 4. findings 三标签

每条 finding 必须给：文件与行号、触发机制、复现步骤或证据、`findingId`。

| 标签 | 含义 | 对 verdict 的影响 |
| --- | --- | --- |
| **Important** | 会导致错误行为、数据损坏、权限越界、宿主契约破坏，或验证程序被改弱 | 未解决则 `verdict=request_changes`，录入器退出 1 |
| **Nit** | 风格、命名、可读性、非阻断的小问题 | 不阻断，可 pass |
| **Pre-existing** | 候选之前就存在，不归责当前作者 | 不阻断；必须注明来源（引入 commit / 事故锚点），不得混进 Important 里免责 |

- 同一个问题跨轮只能有一个 `findingId`，状态从 `open` 改为 `resolved` 时附修复差异。
- 不许把 Important 降级成 Nit 来放行；不许把新引入的问题写成 Pre-existing。
- 无法判断是否产品 bug 时标 Important 并升级给人，不用“看起来像历史问题”糊过去。

## 5. stamp 语义

- **无发现也必须 stamp**：`findings=[]`、`verdict="pass"`、`stamp="none"`。
- `stamp="none"` 的意思是**没有发现**，不是“没有审阅”。
- **缺 stamp（字段缺失、空串、null）一律视为未审**：gate 不得放行，`review` 录入器拒绝该文件。
- stamp 不是签名，不能证明审阅质量；它只堵住“没审却声称绿”的路径。防伪依靠 §2 的绑定项与轮次哈希。
- 有 Important 时 `stamp` 不能是 `"none"`；要么写具体标记，要么 `verdict=request_changes` 不通过。

## 6. 审阅重点（固定 7 条）

只展开命中的可靠性项，不每轮通读长清单；命中由 `docs/reliability.json` 的规则决定。

1. **工具/HTTP 权限与失败关闭**：新增或改动的工具、HTTP 路由是否校验来源与参数；失败时是否**关闭**（拒绝）而不是放行；非 2xx、非 JSON、空体是否被静默吞成空态。
2. **临时目录/真实资料边界**：测试与检查是否只读临时目录或合成语料；是否会读真实 `~/.dsh/sessions`、真实 profile、真实用户数据；是否会把真实资料写进仓或发布物。
3. **宿主注册 key/id、inject/dispose**：侧栏 id 与 main key 是否一致；`selectPanel`/注册 key 是否与宿主约定同名；`inject` 依赖声明是否完整；`dispose` 是否释放监听、定时器、子进程。
4. **持久化与旧数据读取**：写入格式变化是否兼容旧数据（v1/v2 大纲、旧 store）；读不到/坏数据是否显式报错，而不是显示空态或覆盖原文件。
5. **client.js 与 client-src 一致性**：`client.js` 是否为 `client-src` 的构建产物且同步；只改一边会造成“源码对、发布物旧”的假绿。
6. **index commit/版本/engines**：`index.json` 的版本、`source.commit`、`engines` 是否与 `package.json` 及该 commit 内实际版本一致；索引不得指向旧版本 commit。
7. **验证程序与证据是否被改弱**：有没有删断言、放宽检查、跳过必选步骤、改 `scripts/verify*.mjs`/`scripts/test-all.sh`/本文件来让门变绿；证据是否对应当前 subject；是否有“跳过但成功”的语义。

## 7. 规则不可被候选改动替换

- 本文件、`docs/reliability.json`、`docs/verification-incidents.md`、`scripts/verify.mjs`、`scripts/verify.test.mjs`，以及冻结的各插件 test、`dev/`、`.verify-*.mjs`、fixtures/helper，**一律从默认分支快照读取**。
- 默认分支解析顺序：`refs/remotes/origin/main` → `refs/heads/main`；两者都不存在时 `trusted=false`，只能 bootstrap/observe，**禁止改用候选 HEAD 当裁判**。
- 候选改动这些文件时：正式检查仍跑 base 版本；候选版本只作为 supplemental 展示，不能替代旧测试，也不能删掉旧测试的覆盖。
- 要改裁判（新增/删除必选检查、改审阅规则）必须走独立的基础设施变更，先进入默认分支，后续功能变更才使用它；不能在同一候选改动里换掉裁判。
- 候选新增的测试可以运行、可以证伪产品，但不进入正式必选集；也不改变本轮的 `policyHash` 语义。

## 8. 录入与校验

```bash
node scripts/verify.mjs review --run <runId> --file <round.json>
```

- `<runId>` 取 verify 最后一行输出里的 runId；round 文件放在仓外或 gitdir 内，避免新增未跟踪文件导致 staged 凭据失效。
- 录入器必须重算 subject/规则哈希，拒绝过期审批、不同 `reviewerId`、不连续轮次。
- 原始 JSON 复制到 `runs/<runId>/review/round-N.json`，旧轮不覆盖。
- 有 Important 时退出 1 并列出 `findingId`；输入格式错误退出 64。
- 录入器不调用外部模型、不发消息、不自动生成 pass。
- **没有合格 round 文件时，gate 不得自动生成 pass。**

## 9. 无发现时的最小 round.json

```json
{
  "reviewerId": "reviewer-1",
  "round": 1,
  "previousRoundHash": null,
  "subject": {
    "head": "<40位 head sha>",
    "subjectHash": "<verify 报告里的 subjectHash>",
    "indexTree": null
  },
  "baseSha": "<verify 报告里的 baseSha>",
  "policyHash": "<verify 报告里的 policy.sha256>",
  "findings": [],
  "verdict": "pass",
  "stamp": "none",
  "checks": ["fast", "full"],
  "evidenceRunIds": ["<runId>"]
}
```

提交模式把 `indexTree` 换成 `full --staged` 报告里的 40 位树 sha。

## 10. 验收

- `node scripts/verify.mjs policy --check`：本文件存在、可从默认分支读取、必需章节齐全。
- `node --test scripts/verify.test.mjs` 覆盖四类 fixture：候选删除规则仍用 base 版本；工作树或 index 改动后审批失效；新提交后旧 HEAD 审阅失效；`stamp="none"` 合法而缺 stamp 非法。
- 以上任一不满足，说明审阅规则本身没落地，此时不得用“已审”给候选签通过。
