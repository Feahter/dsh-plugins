// 验证基础设施的自测：全部在临时 git 仓里跑真实 scripts/verify.mjs 子进程，不碰本仓。
//   node --test scripts/verify.test.mjs
// 覆盖设计 §10 的负例：语法门、证据篡改/陈旧、门禁三档与反卡死、三轮失败停止、规则不可用。
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY = join(REAL, "scripts", "verify.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** 造一个最小可验证仓：规则文件齐、两个 stub 检查、一个插件测试。 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-verify-test-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  const put = (p, body) => { const abs = join(root, p); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); };
  put("scripts/verify.mjs", readFileSync(VERIFY));
  put("scripts/check-manifest.mjs", "console.log('manifest ok');\n");
  put("docs/verify-readme.mjs", "console.log('docs ok');\n");
  put("plugins/voice-control/test/router.test.mjs", "import test from 'node:test';\ntest('x', () => {});\n");
  put("plugins/demo/test/slow.test.mjs", "import test from 'node:test';\ntest('y', () => {});\n");
  put("docs/reliability.json", JSON.stringify({
    schemaVersion: 1,
    rules: [{ id: "R01", owner: "t", paths: "plugins/**/*.js", why: "w", check: ["node", "x"], requiredLevel: "full", incident: "docs/verification-incidents.md#a1", status: "active" }],
  }));
  put("docs/verification-incidents.md", "# inc\n<a id=\"a1\"></a>\n- x\n");
  put("docs/verification.md", "# v\nfast full heavy 证据 门禁 三轮 bootstrap\n" + "x".repeat(600));
  put("REVIEW.md", "# r\nImportant Nit Pre-existing stamp 默认分支\n" + "x".repeat(300));
  put(".agents/skills/verify/SKILL.md", "---\nname: verify\ndescription: d\n---\nnode scripts/verify.mjs fast\nnode scripts/verify.mjs full\ngate check\n");
  put("scripts/test-all.sh", "#!/usr/bin/env bash\nexec node scripts/verify.mjs full\n");
  put("README.md", "# demo\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function verify(root, args, env = {}) {
  const r = spawnSync(process.execPath, [join(root, "scripts", "verify.mjs"), ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, DSH_VERIFY_SELFTEST: "1", ...env },
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
const jsonOf = (out) => { try { return JSON.parse(out.slice(out.indexOf("{"))); } catch { return null; } };

test("fast 在干净临时仓通过，并落报告", () => {
  const root = fixture();
  const r = verify(root, ["fast", "--json"]);
  assert.equal(r.code, 0, r.out);
  const rep = jsonOf(r.out);
  assert.equal(rep.status, "PASS");
  assert.equal(rep.complete, true);
  assert.ok(rep.durationMs < 60_000);
  for (const id of ["manifest", "docs", "router", "syntax", "policy", "test-integrity"]) {
    assert.ok(rep.steps.some((s) => s.id === id), `缺少步骤 ${id}`);
  }
  assert.ok(existsSync(join(root, ".git/dsh-verify/runs", rep.runId, "summary.md")));
});

test("语法坏文件被 syntax 门抓住", () => {
  const root = fixture();
  writeFileSync(join(root, "plugins/demo/broken.mjs"), "export const = ;\n");
  const r = verify(root, ["fast", "--json"]);
  assert.equal(r.code, 1, r.out);
  const rep = jsonOf(r.out);
  assert.equal(rep.status, "FAIL");
  assert.equal(rep.steps.find((s) => s.id === "syntax").status, "FAIL");
});

test("证据篡改与内容变化都判 current 不成立", () => {
  const root = fixture();
  assert.equal(verify(root, ["fast", "--json"]).code, 0);
  assert.equal(verify(root, ["evidence", "--latest", "--assert-current", "--require", "fast"]).code, 0);
  // 内容变了
  writeFileSync(join(root, "README.md"), "# demo changed\n");
  assert.equal(verify(root, ["evidence", "--latest", "--assert-current", "--require", "fast"]).code, 1);
  // 内容变回去，再篡改日志
  writeFileSync(join(root, "README.md"), "# demo\n");
  const rep = jsonOf(verify(root, ["fast", "--json"]).out);
  const log = join(root, rep.steps.find((s) => s.stdout) .stdout);
  writeFileSync(log, "tampered\n");
  const r = verify(root, ["evidence", "--latest", "--assert-current", "--require", "fast"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /日志被篡改/);
});

test("门禁三档：off/observe 不拦，enforce 无证据拦，第三次例外放行", () => {
  const root = fixture();
  assert.equal(verify(root, ["gate", "configure", "--mode", "off"]).code, 0);
  assert.equal(verify(root, ["gate", "check"]).code, 0);

  assert.equal(verify(root, ["gate", "configure", "--mode", "observe"]).code, 0);
  const obs = verify(root, ["gate", "check"]);
  assert.equal(obs.code, 0, obs.out);
  assert.match(obs.out, /wouldBlock=true/);
  const events = readFileSync(join(root, ".git/dsh-verify/gate-events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).wouldBlock, true);

  assert.equal(verify(root, ["gate", "configure", "--mode", "enforce"]).code, 0);
  assert.equal(verify(root, ["gate", "check"]).code, 1);
  assert.equal(verify(root, ["gate", "check"]).code, 1);
  // 反卡死：同一 session 第二次被挡后，第三次允许带例外通过
  const third = verify(root, ["gate", "check"]);
  assert.equal(third.code, 0, third.out);
  assert.match(third.out, /例外提交/);
});

test("连续三轮失败后 blocked，session resume 后恢复", () => {
  const root = fixture();
  writeFileSync(join(root, "plugins/demo/broken.mjs"), "export const = ;\n");
  for (let i = 0; i < 3; i++) assert.equal(verify(root, ["fast", "--json"]).code, 1, `第 ${i + 1} 轮应 FAIL`);
  const blocked = verify(root, ["fast", "--json"]);
  assert.equal(blocked.code, 2, blocked.out);
  assert.match(blocked.out, /session resume/);
  const sid = readFileSync(join(root, ".git/dsh-verify/sessions/latest-id"), "utf8").trim();
  assert.equal(verify(root, ["session", "resume", "--id", sid, "--human-note", "已修语法"]).code, 0);
  assert.equal(verify(root, ["fast"]).code, 1, "文件仍坏，恢复后应先 FAIL 而不是 PASS");
});

test("policy 抓住缺锚点与非法 JSON", () => {
  const root = fixture();
  writeFileSync(join(root, "docs/verification-incidents.md"), "# inc\n- 没有锚点\n");
  const r = verify(root, ["policy", "--check", "--json"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /缺少锚点/);
  writeFileSync(join(root, "docs/reliability.json"), "{not json");
  assert.equal(verify(root, ["policy", "--check"]).code, 1);
});

test("heavy 在 P0 明确 BLOCKED，--plan 只输出计划", () => {
  const root = fixture();
  const plan = verify(root, ["heavy", "--plan", "--json"]);
  assert.equal(plan.code, 0, plan.out);
  assert.ok(plan.out.includes("HEAVY_NOT_IMPLEMENTED") || plan.out.includes("planned"), plan.out);
  const run = verify(root, ["heavy", "--json"]);
  assert.equal(run.code, 2, run.out);
  assert.match(run.out, /HEAVY_NOT_IMPLEMENTED/);
});

test("review 轮次链与内容绑定", () => {
  const root = fixture();
  const rep = jsonOf(verify(root, ["fast", "--json"]).out);
  const round = {
    reviewerId: "reviewer-a", round: 1, previousRoundHash: null,
    subject: { head: rep.git.headSha, subjectHash: rep.git.subjectHash, indexTree: rep.git.indexTree },
    baseSha: rep.git.baseSha, policyHash: rep.policy.sha256,
    findings: [], verdict: "pass", stamp: "none",
  };
  const file = join(root, "round-1.json");
  writeFileSync(file, JSON.stringify(round));
  const ok = verify(root, ["review", "--run", rep.runId, "--file", file]);
  assert.equal(ok.code, 0, ok.out);
  // 同一份内容再开第 3 轮（跳号）应被拒
  writeFileSync(file, JSON.stringify({ ...round, round: 3, previousRoundHash: "x" }));
  assert.equal(verify(root, ["review", "--run", rep.runId, "--file", file]).code, 1);
  // 内容变化后仍拿旧 round 冒充通过应被拒
  writeFileSync(join(root, "README.md"), "# changed\n");
  writeFileSync(file, JSON.stringify(round));
  assert.equal(verify(root, ["review", "--run", rep.runId, "--file", file]).code, 1);
});
