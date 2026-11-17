# 验证操作册（dsh-plugins）

给执行者的可复制操作手册。所有命令从 **dsh-plugins 仓根**运行；用 `${REPO}` 指代仓根绝对路径。

**前置事实，先读**：

- 本仓**没有根 `package.json`**，也没有根 npm script。不要找 `npm test` 或任何 `npm run` 形式的验证入口。
- 验证入口只有一个：`node scripts/verify.mjs`。
- 所有命令只依赖 Node 内置模块与仓库原有 git 工具；不联网、不装依赖、不启动 GUI。
- 证据写在 `<git rev-parse --git-path dsh-verify>/`（通常是 `.git/dsh-verify/`），不提交。

---

## 1. 三档命令与输出

| 档位 | 命令 | 实际内容 | 预算 |
| --- | --- | --- | --- |
| fast | `node scripts/verify.mjs fast` | `git diff --check`（含 staged）、改动文件的语法门（单子进程批量解析 + 失败复核）、manifest、docs 一致性、router 测试、规则/事故/skill 结构检查、正式测试集未被删除 | 硬 deadline 170s（`DSH_VERIFY_FAST_BUDGET_MS` 可覆盖）；本机实测 46s |
| full | `node scripts/verify.mjs full` | fast 全部项 + 验证基础设施自测（`scripts/verify.test.mjs`）+ 默认分支冻结的 11 个插件 test + 客户端 harness | 总预算 1800s（`DSH_VERIFY_FULL_BUDGET_MS` 可覆盖）；单插件 180s（novel-forge 360s） |
| heavy | `node scripts/verify.mjs heavy` | 真宿主/离线浏览器流程；**P0 未实现**，预期退出 2、`status=BLOCKED`、`reason=HEAVY_NOT_IMPLEMENTED` | P2 总预算 1200s |

常用参数：

```bash
node scripts/verify.mjs fast --json
node scripts/verify.mjs full --json
node scripts/verify.mjs full --staged --session <sessionId>
node scripts/verify.mjs heavy --plan
```

- `--json`：stdout 只输出一个最终 JSON 对象，进度走 stderr。
- `--staged`：为提交场景校验暂存内容；要求无 unstaged tracked 改动、无未忽略 untracked 文件，并在报告里记录 `git write-tree`（不满足时写进 `limitations`）。
- `--session <id>`：续用已有 session 的连续失败计数；缺省自动读/建。
- `--plan` 只打印计划，不产生“通过”凭据。
- `--repo <path>`：在其他工作树/临时仓跑同一实现（自测与排查用）。
- `--no-self-test`：跳过 full 里的自测步骤（只在确知基础设施未改时用，报告仍记 NOT_RUN=false）。

**实测与偏差（P0 落地时校准，和设计文档不一致处以此为准）**：

1. **自测从 fast 移到 full。** 本机 node 进程冷启动实测 0.1–15s 抖动（内存压力/换页），8 个负例要几十次 spawn，放进 fast 会把 170s 预算变成不稳定门。fast 仍有 `policy --check` 与 `test-integrity`；`node --test scripts/verify.test.mjs` 作为 full 的独立步骤，也可单跑。
2. **语法门按改动文件跑，且批量解析。** 设计原写“逐文件独立 spawn”；实测 251 个文件逐个 spawn 要 28–60s，改为只查 `mergeBase..worktree` 的改动文件（含 untracked），在一个子进程里用 `vm.SourceTextModule` 批量解析，解析失败的文件再用真实 `node --check` 复核，避免把 CJS 误判成语法错。无基线时退化为全量并在摘要里标注。
3. **subjectHash 用 git blob/diff 而非逐文件读取。** 389 个文件逐个 `readFileSync` 在本机实测 4 分 20 秒（换页），改为 `git ls-files -s` + `git diff HEAD --binary` + 仅 untracked 读内容。它仍是内容绑定，但不等同于逐字节快照。
4. **full 的插件命令取自默认分支 blob**；默认分支缺该文件时用候选并在 `steps[].meta.frozenFrom=candidate` 标出。
5. **full 预算从设计 900s 提到 1800s。** 本机实测：一跑 615s（自测 314s），另一跑 1455s（自测 305s + novel-forge 330s，同样是 novel-forge 套件在内存压力下从 5s 抖到 330s）。单步超时 180/360s 不变，总预算按最坏观测再留余量。
6. **heavy 的 `--staged` 尚未实现**：P0 的 heavy 一律 BLOCKED，`--plan` 只列前提，不加提交场景参数。
7. **门禁刷新用重跑 `gate install`**；没有 `--refresh`/`uninstall` 子命令，卸装是人工移走 hook（先 `gate status` 确认是本工具的）。

**输出**：通常模式逐项打印 `stepId`、状态、耗时，最后一行给 `runId`、报告路径与总状态。JSON 模式取 `.runId`、`.status`、`.complete`。

**退出码**：

| 码 | 含义 |
| --- | --- |
| 0 | 请求成功且所需检查全部 PASS |
| 1 | FAIL（断言/语法/超时也算） |
| 2 | BLOCKED（缺依赖、历史不完整、heavy 能力缺失、三轮停止） |
| 64 | CLI 参数错误 |
| 130 | SIGINT |

同时有 FAIL 与 BLOCKED 时整体按 1 退出，`complete=false`。不定义“跳过但成功”。

---

## 2. bootstrap（trusted=false）

默认分支还没有验证基建时（首次落地的独立变更），runner 可以以 `trusted=false` 的 bootstrap 模式跑 fast/full 并留证：

```bash
node scripts/verify.mjs policy --check
node scripts/verify.mjs fast
node scripts/verify.mjs full
```

- bootstrap 报告 `policy.trusted=false`，**不能供 enforce 使用**，也不能当作“默认分支规则已验证”。
- 验收这次基础设施变更用的是：`bash -n scripts/test-all.sh`、`node --test scripts/verify.test.mjs`、`node scripts/verify.mjs policy --check`，再由人审。
- 合入默认分支后重跑 `policy --check`，确认 `trusted=true`，再考虑 `gate install`。
- 禁止把功能代码混进引导变更，然后用“临时信任当前分支”放行。

---

## 3. 可信默认分支与镜像

- 基线只从**已存在的本地 ref** 解析：`refs/remotes/origin/main`，缺失时退 `refs/heads/main`。两者都没有 → BLOCKED，**不改用候选 HEAD**。
- 不 fetch、不联网。一次运行内 pin 一个 `defaultSha`；`baseSha` 写进报告。
- 正式检查集合（REVIEW、reliability、事故记录、`scripts/verify*.mjs`、冻结的插件 test/dev/.verify-*、fixtures/helper、manifest/docs 检查）全部从该 sha 的离线镜像读取：`git clone --local --shared --no-checkout` 到 `os.tmpdir()`，再用 `git ls-tree` / `git show` 覆盖。
- 候选新增测试可执行并展示（supplemental），但不进入正式必选集，也不能替换或删除旧测试。
- 镜像不 checkout、index 为空，**绝不能用镜像的 `git diff` 判断候选差异**；差异用 base→候选原始内容计算。
- 镜像不是安全沙箱：Node 测试仍有当前用户权限；它只解决“合作式 agent 自改裁判”。

---

## 4. 证据 schema 与字段

路径：`<git rev-parse --git-path dsh-verify>/runs/<UTC>-<uuid>/`

```
report.json          # 运行开始时即写 status=RUNNING，每步原子替换
summary.md           # 结束后的人读摘要
logs/<stepId>.stdout.log
logs/<stepId>.stderr.log
policy/              # 本次实际用的 REVIEW、清单、规则哈希
review/round-N.json  # 单审阅者多轮，旧轮保留
```

同级还有 `config.json`（`mode` 默认 `observe`）、`gate-events.jsonl`、`sessions/<id>.json`。

`report.json`（`schemaVersion=1`）关键字段：

| 字段 | 说明 |
| --- | --- |
| `runId` / `sessionId` / `level` | `UTC-UUID` / 会话 / `fast|full|heavy` |
| `status` / `complete` | 整体 `PASS|FAIL|BLOCKED|INTERRUPTED`；`complete` 必须为 true 才算完整 |
| `startedAt` / `endedAt` / `durationMs` | 时间与耗时 |
| `git.headSha` / `git.indexTree` / `git.subjectHash` | HEAD、暂存树（working 为 null）、内容哈希 |
| `git.subjectKind` / `git.dirty` | `working|staged`；是否有未提交改动 |
| `git.baseRef` / `git.baseSha` / `git.mergeBaseSha` | 可信基线 |
| `runtime` | `node` / `platform` / `arch` |
| `policy.sha256` / `policy.trusted` | 规则哈希；bootstrap 时 false |
| `requiredLevels` / `triggeredRules` | 本次需要的档位与命中的 R 规则 |
| `steps[]` | 每步 `id`、`command`、`cwd`、`durationMs`、`exitCode`、`signal`、`status`、`summary`、`stdout`/`stderr` 相对路径、`outputSha256` |
| `failureRound` | 连续失败轮数 |
| `limitations[]` | 明确未验证的能力（如“未验证真实 DSH UI”） |

每步 `status` 只能是 `PASS/FAIL/BLOCKED/TIMEOUT/INTERRUPTED/NOT_RUN`；`summary` 是末尾行与首个错误上下文的截取，不是模型改写。日志目录 0700、文件 0600；日志超 20 MiB 终止该步并记 `OUTPUT_LIMIT`，不丢输出记 PASS。

**取证与断言当前性**：

```bash
node scripts/verify.mjs evidence --latest --assert-current --require fast
node scripts/verify.mjs evidence --latest --assert-current --require full
```

校验 schema、必选步骤、输出哈希、`subjectHash`、HEAD/`indexTree`、`baseSha`、policy hash 与 `complete`。内容变了、日志被改、报告失败或中断、规则陈旧，均非 0。`full` 可满足 `fast`；`heavy` 完整 PASS 才可满足下档。

---

## 5. review round.json 最小可用样例

单审阅者、多轮、绑定内容。字段语义见 `REVIEW.md`；无发现时 `findings=[]`、`stamp="none"`、`verdict="pass"`，**缺 stamp 视为未审**。

```json
{
  "reviewerId": "reviewer-1",
  "round": 1,
  "previousRoundHash": null,
  "subject": {
    "head": "<verify 报告 git.headSha>",
    "subjectHash": "<verify 报告 git.subjectHash>",
    "indexTree": null
  },
  "baseSha": "<verify 报告 git.baseSha>",
  "policyHash": "<verify 报告 policy.sha256>",
  "findings": [],
  "verdict": "pass",
  "stamp": "none",
  "checks": ["fast", "full"],
  "evidenceRunIds": ["<runId>"]
}
```

录入：

```bash
node scripts/verify.mjs review --run <runId> --file <round.json>
```

- `<runId>` 取 verify 最后输出的 runId；round 文件放仓外或 gitdir 内，避免新增未跟踪文件让 staged 凭据失效。
- 录入器重算 subject/规则哈希，拒绝过期审批、不同 `reviewerId`、不连续轮次；原始 JSON 复制到 `runs/<runId>/review/round-N.json`。
- 有 Important → 退出 1 并列出 `findingId`；格式错误 → 64。
- 录入器不调用外部模型、不发消息；**没有合格 round 文件时 gate 不会自动生成 pass**。

提交场景先 `full --staged`，再录审阅，再校验，再 `gate check`。

---

## 6. 门禁：安装 / 恢复 / 三档

```bash
node scripts/verify.mjs gate status
node scripts/verify.mjs gate configure --mode off
node scripts/verify.mjs gate configure --mode observe
node scripts/verify.mjs gate configure --mode enforce
node scripts/verify.mjs gate install
node scripts/verify.mjs gate check
```

- `config.json` 的 `mode` 默认 `observe`；改 mode 只本仓生效，不碰 Git 全局配置或 `core.hooksPath`。
- `gate install`：通过 `git rev-parse --git-path hooks/pre-commit` 定位；**已有 hook 或设置了 `core.hooksPath` 时退出 2 并打印现有路径，不覆盖、不串联未知程序**。新 hook 只调用可信快照里的 `gate check`，不在提交时重跑测试。
- `gate status`：打印实际 mode、hook 安装状态、可信快照 sha、最近 wouldBlock。
- 可信快照随默认分支 sha 变化失效：`gate status` 会指出；enforce 下先 BLOCKED，observe 下记 wouldBlock。刷新只能从默认分支重新安装，**没有 `uninstall` 子命令**：恢复原状是人工操作（移走 `gitdir/hooks/pre-commit`），操作前先 `gate status` 确认那确实是本工具的 hook。

| 模式 | 行为 | 退出码 |
| --- | --- | --- |
| `off` | 不查验凭据，`gate status` 仍显示未保护 | 0 |
| `observe` | 与 enforce 同一判定，事件写 `gate-events.jsonl`（wouldBlock/reasons/subject/session/runId/mode） | 永远 0（记录失败时 stderr 明报） |
| `enforce` | 缺完整当前 full、审阅未过或 stamp 缺失、命中 heavy 却无 heavy、规则陈旧均阻挡 | 1；有效证据 0 |

**反卡死例外**：同一 session 被 enforce 阻挡两次后，第三次允许一次 `exception=anti-stuck`（消费后不能再用），并打印“例外提交，验证未通过”。它只放行提交，不签 done、不重置三轮失败、不生成 pass stamp；observe 不累计阻挡次数。`--no-verify` 仍可绕过 hook，所以它**不是安全边界**。

---

## 7. 失败三轮与 flaky

- 一个失败轮次 = 一次实际 verify 出现 FAIL/TIMEOUT；同轮多个失败算一轮。
- 每轮先保存命令、原始输出、失败步骤、subject、假设与修复差异，再改代码。
- 第三轮失败后 session 变 `ESCALATED`；后续 fast/full/heavy 在起子进程前退出 2，输出三个 runId、仍失败断言、已排除与待查原因。
- 只有人给 `human-note` 才能开启下一组诊断：

```bash
node scripts/verify.mjs session start --task <task-id>
node scripts/verify.mjs session resume --id <sessionId> --human-note "已确认根因在 X，继续诊断"
```

- **禁止**：换 taskId、重启进程、删 `sessions/<id>.json`、拆成新任务来冲掉计数。完整所需档位 PASS 才清零。
- 缺依赖/BLOCKED 不反复试：记录一次诊断与前置条件，交人处理。
- flaky 判定：比较**相同 subject、同 Node/平台、同 fixture/种子**下的失败与成功证据，不能只凭“偶尔红”。三轮仍无法定位才删除测试代码（不是加 skip/retry），并填 `docs/verification-incidents.md` 的 flaky 台账；冻结测试的删除要走默认分支独立变更，当前功能任务仍是 BLOCKED。
- 禁止：测试级自动重跑、retry-until-pass、固定 sleep 等偶发成功、抬 timeout 掩盖竞态、吞异常、把失败改 skip、减少必要断言。

---

## 8. 离线依赖不足的诊断

- full 的“可用”只要求 runner 自身能在干净仓离线跑，并对原有测试依赖不足给明确诊断；**不意味着能凭空运行缺包测试**。
- 典型：`novel-forge/test/export-hardening.test.mjs` 直接 `import jszip`。运行时 `ERR_MODULE_NOT_FOUND` 一律分类 `BLOCKED`（退出 2），报告必须写出**导入文件与缺失模块名**；不能安装、不能跳过，也不能报全绿。
- 预检只看入口存在与已知裸模块可否 resolve，不把静态扫描当完整依赖解析器。
- 历史检查：`git rev-parse --is-shallow-repository`、`git cat-file -e <index版本commit>^{commit}`。浅克隆或引用对象缺失 → manifest/docs 完整性判 `BLOCKED`，报告确切 commit，**禁止自动 fetch**。
- 看到 BLOCKED 的正确动作：记录诊断、说明缺什么、交人决定是否在环境里提供已有依赖；不要用“再跑一次”掩盖。

---

## 9. P0/P1/P2 验收

| 阶段 | 验收命令 | 判据 |
| --- | --- | --- |
| P0 | `bash -n scripts/test-all.sh` | 语法通过 |
| P0 | `node --test scripts/verify.test.mjs` | 全部用例 0（Node 内置测试入口，不是 verify 子命令） |
| P0 | `node scripts/verify.mjs policy --check` | 0；打印默认分支 ref/sha、规则哈希、触发项、来源 |
| P0 | `node scripts/verify.mjs fast` | 0、`complete=true`、`durationMs` 在上限内；干净副本无 `node_modules` 也可跑（实测 46s） |
| P0 | `node scripts/verify.mjs full` | 现有依赖齐全时 0；缺依赖时 2/BLOCKED 且列出缺项，**不得宣布 full 已通过** |
| P0 | `node scripts/verify.mjs heavy --plan` | 0，仅打印阶段计划，不导入浏览器包 |
| P0 | `node scripts/verify.mjs heavy` | 2/BLOCKED/`HEAVY_NOT_IMPLEMENTED`（P0 预期，不是失败） |
| P0 | `node scripts/verify.mjs gate status` | 0；显示实际 mode（默认 observe）与 hook 状态，不伪装已 enforce |
| P1 | `node --test tests/verification/properties.test.mjs` 等三个测试 | 三种新检查落地；故意改坏一条不变量必须红 |
| P1 | `node scripts/verify.mjs full` | 纳入新测试后仍按真实依赖表达 PASS/BLOCKED |
| P2 | `node scripts/verify.mjs heavy` + `evidence --latest --assert-current --require heavy` | 真宿主/浏览器流程完整通过；缺浏览器或未授权仍 BLOCKED |
| P2 | `node scripts/verify.mjs gate configure --mode enforce` + `gate check` | enforce 按证据放行/阻挡；此时才谈启用 enforce |

P0 的“交付”与“验证绿”分别报告：runner 可以在未装旧依赖的机器上正确 BLOCKED full，但必须列出未验证项，不能说完整基础门已实跑全绿。

---

## 10. 局限与人工复核

- **不证明真实 GUI 可用**：fast/full 是语法、单测、清单与文档级检查；stub 宿主与内存替身不等于真实 DSH。命中 UI/宿主契约必须 heavy，缺 heavy 证据就是未完成。
- heavy 在 P0 未实现，P2 依赖环境预置的浏览器/驱动与 DSH CLI；缺能力持续 BLOCKED，不在运行中安装。不复用已登录的现有实例来降成本。
- hook 可被 `--no-verify` 绕过；证据与 subjectHash 能发现陈旧/误用，不能抵御同用户恶意进程篡改。P0 标榜的是合作式 agent + 人审，不是供应链防护。
- 默认 ref 可能陈旧；人审要确认 `baseSha` 对应本次认可的基线。干净覆盖只说明没有已记录缺项，不证明所有 helper 都被冻结或所有宿主契约都覆盖。
- 审阅规则与事故台账在 `REVIEW.md`、`docs/reliability.json`、`docs/verification-incidents.md`；`reviewerId` 是声明标识，不是身份认证。
- 人工复核优先看 failed/blocked/exception 与关键流程结果，而不是绿色总数；证据按 subject 对应当前内容，旧 runId 不授权新提交。
- 清理证据是人的动作（已合并且超过 30 天的 run 才删）；事故与失败证据先保留，P0 不自动 rm。
