---
name: verify
description: "dsh-plugins 的验证与验收流程：写完后自验、声称 done、准备提交时使用。触发词：验证、verify、验收、声称 done、准备提交、check done、跑一下门禁。不用于替代真实宿主 UI 验收（那需要 heavy，P0 只有 BLOCKED）。"
---

# verify：同一套验证流程

## 何时触发

用户说「验证 / verify / 验收」，或你要声称 done、准备提交、说「测试通过了」。**不要只说通过**：给 subjectHash、档位、runId、报告路径、未通过项。

## 仓路径发现（别猜 cwd）

- 验证器 `scripts/verify.mjs` 自己用 `import.meta.url` 定位仓根，不拿调用者 cwd 猜；缺省在仓根执行。
- 本仓**没有根 `package.json`**，不存在根 npm script。一律用绝对路径调用：
  `node /Users/fuzhuo/Documents/deepseek-harness/dsh-plugins/scripts/verify.mjs <子命令>`
- 从别的目录工作时，显式给仓路径或用上面绝对路径，别 `cd` 到猜出来的位置。

## 固定流程（按序，不跳步）

1. 建/续 session（跨 shell 复用同一 id）：
   ```bash
   node scripts/verify.mjs session start --task <task-id>
   node scripts/verify.mjs session resume --id <sessionId> --human-note "继续原因"
   ```
2. 确认裁判可信：`node scripts/verify.mjs policy --check`
   （打印默认分支 ref/sha、规则哈希、触发项。`trusted=false` 只能 bootstrap/observe。）
3. 快速档：`node scripts/verify.mjs fast`
4. 完整档：`node scripts/verify.mjs full`
   （提交场景在作者已暂存、工作树与暂存区一致后用 `full --staged`；不要擅自 `git add`。）
5. 命中 UI/宿主契约（client.js、client-src、侧栏/面板注册、inject/dispose、cordis.patch.yml）则跑：
   `node scripts/verify.mjs heavy`
   P0 预期退出 2、`status=BLOCKED`、`reason=HEAVY_NOT_IMPLEMENTED`——**如实报告 BLOCKED，不签 done**。
6. 单审阅者按冻结 `REVIEW.md` 审一轮，写 `round.json`（无发现也必须 `findings=[]`、`stamp="none"`），再录入：
   `node scripts/verify.mjs review --run <runId> --file <round.json>`
7. 断言证据对应当前内容：
   `node scripts/verify.mjs evidence --latest --assert-current --require full`
8. 看门禁判定：`node scripts/verify.mjs gate check`
   （observe 恒 0；enforce 有阻挡退出 1。gate 的 0 不等于 verify 成功。）

## 失败时回报什么

- 步骤 id、档位、runId 与报告路径（`runs/<UTC>-<uuid>/report.json`）。
- 原始日志路径：`runs/<runId>/logs/<stepId>.stdout.log|stderr.log`，摘首个错误上下文。
- 失败轮数（`failureRound`）、退出码（1=FAIL，2=BLOCKED）、仍失败的断言。
- 下一步：定位/修复/升级给人；缺依赖或 BLOCKED 只诊断一次，不反复重试。
- 第三轮失败即 `ESCALATED`，后续运行会退出 2；只有人能 `session resume --id ... --human-note "..."` 继续。

## 禁止绕过

- 不改 `docs/reliability.json`、不删必选步骤、不放宽断言、不改 `scripts/verify*.mjs` 让门变绿。
- 不换 taskId、不删 `sessions/<id>.json`、不重启进程冲掉失败计数。
- 不把 bootstrap（`trusted=false`）或 observe 的 0 说成“已 enforce 通过”。
- 不把 fast/full 说成真实 DSH UI 已验证；hook 可被 `--no-verify` 绕过，不是安全边界。
