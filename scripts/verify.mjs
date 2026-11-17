#!/usr/bin/env node
// DSH 插件仓验证入口：一条命令跑分档检查、落证据、验证据、管提交门禁。
// 设计依据：research/dsh-verify-design.md（quickref → 本仓落地）。
// 只依赖 node: 内置模块与仓库既有 git/npm；不安装依赖、不联网、不启动 GUI。
//
//   node scripts/verify.mjs fast [--json] [--session <id>] [--no-self-test]
//   node scripts/verify.mjs full [--json] [--staged] [--session <id>]
//   node scripts/verify.mjs heavy [--plan] [--json]
//   node scripts/verify.mjs policy --check [--json]
//   node scripts/verify.mjs evidence --latest --assert-current --require fast|full|heavy [--json]
//   node scripts/verify.mjs gate status|check|install|configure --mode off|observe|enforce
//   node scripts/verify.mjs review --run <runId> --file <round.json>
//   node scripts/verify.mjs session start --task <id> | session resume --id <id> --human-note "..."
//
// 退出码：0=PASS，1=FAIL（含超时），2=BLOCKED（缺依赖/缺历史/heavy 未实现/三轮停止），
//        64=参数错误，130=SIGINT。

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, writeFileSync, lstatSync, readlinkSync,
} from "node:fs";
import { homedir, platform, arch, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(HERE, "..");
const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, USAGE: 64 };
const FAST_BUDGET_MS = Number(process.env.DSH_VERIFY_FAST_BUDGET_MS || 170_000);   // 设计预算 170s
const FULL_BUDGET_MS = Number(process.env.DSH_VERIFY_FULL_BUDGET_MS || 900_000);   // 设计预算 900s
const NOISE = new Set([".git", "node_modules", "dist", ".verify"]);

// ───────────────────────── 基础工具 ─────────────────────────

const argv = process.argv.slice(2);
const opts = { json: false, staged: false, plan: false, repo: null, session: null, noSelfTest: false, mode: null, require: null, run: null, file: null, task: null, id: null, humanNote: null };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") opts.json = true;
  else if (a === "--staged") opts.staged = true;
  else if (a === "--plan") opts.plan = true;
  else if (a === "--no-self-test") opts.noSelfTest = true;
  else if (a === "--check") { /* policy --check 的动词，忽略 */ }
  else if (a === "--latest") { /* evidence 的动词 */ }
  else if (a === "--assert-current") { /* evidence 的动词 */ }
  else if (a === "--repo") opts.repo = argv[++i];
  else if (a === "--session") opts.session = argv[++i];
  else if (a === "--mode") opts.mode = argv[++i];
  else if (a === "--require") opts.require = argv[++i];
  else if (a === "--run") opts.run = argv[++i];
  else if (a === "--file") opts.file = argv[++i];
  else if (a === "--task") opts.task = argv[++i];
  else if (a === "--id") opts.id = argv[++i];
  else if (a === "--human-note") opts.humanNote = argv[++i];
  else if (a === "--last") { /* stats: 占位 */ }
  else if (a.startsWith("--")) { failUsage(`未知参数 ${a}`); }
  else positional.push(a);
}
const REPO = resolve(opts.repo || DEFAULT_REPO);
process.env.DSH_VERIFY_SELFTEST ||= "";

function failUsage(msg) {
  console.error(`用法错误：${msg}`);
  process.exit(EXIT.USAGE);
}
const nowIso = () => new Date().toISOString();
const TRACE = !!process.env.DSH_VERIFY_TRACE;
const trace = (msg) => { if (TRACE) console.error(`[trace ${new Date().toISOString().slice(11, 23)}] ${msg}`); };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sha256File = (p) => sha256(readFileSync(p));
const rel = (p) => relative(REPO, p).split(sep).join("/");

/** 同步 git 调用：成功返回 stdout.trim()，失败返回 null（调用方决定 BLOCKED/FAIL）。 */
function git(args, { allowFail = false } = {}) {
  const r = spawnSyncGit(args);
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(" ")} 失败：${(r.stderr || "").trim()}`);
  }
  return (r.stdout || "").trim();
}

function spawnSyncGit(args) {
  return spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function gitPath(name) {
  const p = git(["rev-parse", "--git-path", name]);
  return resolve(REPO, p);
}

const STATE_DIR = (() => {
  try { return gitPath("dsh-verify"); } catch { return resolve(REPO, ".git", "dsh-verify"); }
})();
const RUNS_DIR = join(STATE_DIR, "runs");
const SESSIONS_DIR = join(STATE_DIR, "sessions");
const CONFIG_PATH = join(STATE_DIR, "config.json");
const GATE_EVENTS = join(STATE_DIR, "gate-events.jsonl");

function ensureDir(p) { mkdirSync(p, { recursive: true, mode: 0o700 }); return p; }
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function writeJsonAtomic(p, obj) {
  ensureDir(dirname(p));
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  renameSync(tmp, p);
}
function appendJsonl(p, obj) {
  ensureDir(dirname(p));
  writeFileSync(p, JSON.stringify(obj) + "\n", { mode: 0o600, flag: "a" });
}

// ───────────────────────── 仓与基线 ─────────────────────────

function resolveBaseRef() {
  const candidates = [
    "refs/remotes/origin/main", "refs/heads/main",
    "refs/remotes/origin/master", "refs/heads/master",
  ];
  for (const ref of candidates) {
    if (git(["rev-parse", "--verify", "--quiet", ref], { allowFail: true })) return ref;
  }
  return null;
}

function baseInfo() {
  const ref = resolveBaseRef();
  if (!ref) return { ref: null, sha: null, mergeBase: null };
  const sha = git(["rev-parse", ref]);
  const mergeBase = git(["merge-base", ref, "HEAD"], { allowFail: true }) || sha;
  return { ref, sha, mergeBase };
}

function headSha() {
  return git(["rev-parse", "HEAD"], { allowFail: true }) || null;
}

/** 遍历候选内容（tracked + 未忽略 untracked），返回 [{path, abs, mode}]，已排除 .git/node_modules/gitdir。 */
function candidateFiles() {
  const out = new Set();
  const ls = (args) => git(args, { allowFail: true }) || "";
  for (const p of ls(["ls-files", "-z", "--cached"]).split("\0").filter(Boolean)) out.add(p);
  for (const p of ls(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean)) out.add(p);
  const stateRel = rel(STATE_DIR);
  const list = [];
  for (const path of [...out].sort()) {
    if (path.startsWith(".git/") || path === ".git") continue;
    const parts = path.split("/");
    if (parts.some((x) => x === "node_modules" || x === "dist" || x === ".verify")) continue;
    if (stateRel && !stateRel.startsWith("..") && (path === stateRel || path.startsWith(stateRel + "/"))) continue;
    const abs = join(REPO, path);
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) {
      list.push({ path, abs, mode: 0o120000, link: readlinkSafe(abs) });
      continue;
    }
    if (!st.isFile()) continue;
    list.push({ path, abs, mode: (st.mode & 0o111) ? 0o755 : 0o644 });
  }
  return list;
}

function readlinkSafe(p) {
  try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : null; } catch { return null; }
}

/** subjectHash：内容绑定。用 git 自己的 blob/sha 与完整 diff 计算，避免逐文件读工作树
 *  （本机 I/O 抖动时 389 次 readFileSync 实测 4 分钟）。tracked 部分由 `git ls-files -s`
 *  的 mode+sha 与 `git diff HEAD --binary` 覆盖；untracked 才读内容。 */
function subjectHash() {
  const h = createHash("sha256");
  const idx = git(["ls-files", "-s", "-z", "--cached"], { allowFail: true }) || "";
  h.update(`index:${Buffer.byteLength(idx)}:`);
  h.update(idx);
  const diff = git(["diff", "HEAD", "--binary", "--no-color"], { allowFail: true }) || "";
  h.update(`diff:${Buffer.byteLength(diff)}:`);
  h.update(diff);
  const others = (git(["ls-files", "-z", "--others", "--exclude-standard"], { allowFail: true }) || "").split("\0").filter(Boolean);
  const stateRel = rel(STATE_DIR);
  for (const p of others.sort()) {
    if (p.startsWith(".git/")) continue;
    if (stateRel && !stateRel.startsWith("..") && (p === stateRel || p.startsWith(stateRel + "/"))) continue;
    const abs = join(REPO, p);
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) { h.update(`link:${p}:${readlinkSafe(abs) || ""}`); continue; }
    if (!st.isFile()) continue;
    let body;
    try { body = readFileSync(abs); } catch { continue; }
    h.update(`new:${p}:${st.mode & 0o111 ? 0o755 : 0o644}:${body.length}:`);
    h.update(body);
  }
  return h.digest("hex");
}

/** 基线 blob 内容（不存在返回 null）。 */
function baseBlob(path) {
  const base = baseInfo();
  if (!base.sha) return null;
  const r = spawnSyncGit(["show", `${base.sha}:${path}`]);
  if (r.status !== 0) return null;
  return r.stdout;
}
function baseHasBlob(path) {
  const base = baseInfo();
  if (!base.sha) return false;
  return spawnSyncGit(["cat-file", "-e", `${base.sha}:${path}`]).status === 0;
}

// ───────────────────────── 执行器 ─────────────────────────

/** 启动一个检查：detached 进程组，超时 SIGTERM→2s→SIGKILL 整组。 */
function runStep(step, logDir, budgetLeftMs) {
  const timeoutMs = Math.min(step.timeoutMs || 120_000, Math.max(1_000, budgetLeftMs));
  return new Promise((resolveStep) => {
    const started = Date.now();
    const outPath = join(logDir, `${step.id}.stdout.log`);
    const errPath = join(logDir, `${step.id}.stderr.log`);
    ensureDir(logDir);
    const outFd = openSync(outPath, "w", 0o600);
    const errFd = openSync(errPath, "w", 0o600);
    let child;
    try {
      child = spawn(step.argv[0], step.argv.slice(1), {
        cwd: step.cwd || REPO, detached: true, env: { ...process.env, DSH_VERIFY_RUN: "1" },
        stdio: [step.stdin != null ? "pipe" : "ignore", outFd, errFd],
      });
      if (step.stdin != null) { child.stdin.on("error", () => {}); child.stdin.end(step.stdin); }
    } catch (e) {
      return resolveStep({ ...step, status: "FAIL", exitCode: null, signal: null, durationMs: Date.now() - started, reason: `SPAWN_ERROR: ${e.message}`, stdout: rel(outPath), stderr: rel(errPath) });
    }
    let timedOut = false;
    let sigkilled = false;
    const term = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGTERM");
      setTimeout(() => { sigkilled = true; killGroup(child, "SIGKILL"); }, 2000);
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(term);
      resolveStep({ ...step, status: "FAIL", exitCode: null, signal: null, durationMs: Date.now() - started, reason: `SPAWN_ERROR: ${e.message}`, stdout: rel(outPath), stderr: rel(errPath) });
    });
    // 用 exit 而不是 close：node --test 的孙进程可能短暂持有 fd，close 会一直不触发。
    child.on("exit", (code, signal) => {
      clearTimeout(term);
      setTimeout(() => { killGroup(child, "SIGTERM"); try { closeSync(outFd); closeSync(errFd); } catch { /* 已关 */ } }, 200); // 清掉残留孙进程，不重跑
      const durationMs = Date.now() - started;
      const status = timedOut ? "TIMEOUT" : code === 0 ? "PASS" : "FAIL";
      resolveStep({
        ...step, status, exitCode: code, signal, durationMs,
        reason: timedOut ? `TIMEOUT after ${timeoutMs}ms${sigkilled ? " (SIGKILL)" : ""}` : null,
        stdout: rel(outPath), stderr: rel(errPath),
      });
    });
  });
}
function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* 已退出 */ } }
}

function tailSummary(path, maxChars = 4096) {
  try {
    const raw = readFileSync(path, "utf8");
    return raw.slice(-maxChars).trim();
  } catch { return ""; }
}
function hashOf(path) {
  try { return sha256(readFileSync(path)); } catch { return null; }
}

// ───────────────────────── 计划 ─────────────────────────

const PLUGIN_ORDER = [
  "archive-rsi", "context-lib", "dsh-360", "github-manager", "mind-canvas",
  "novel-forge", "realtime-voice", "task-ledger", "update-check",
  "voice-companion", "voice-control",
];

/** 冻结的插件 test 命令：优先读默认分支 package.json，读不到才用候选（并在报告里标记）。 */
function frozenTestCommand(plugin) {
  const path = `plugins/${plugin}/package.json`;
  const raw = baseBlob(path);
  const parse = (buf) => { try { return JSON.parse(buf.toString("utf8")); } catch { return null; } };
  const basePkg = raw ? parse(raw) : null;
  if (basePkg?.scripts?.test) return { cmd: basePkg.scripts.test, source: "base", path };
  // 默认分支还没定义该插件的 test（插件比默认分支新）：退回候选命令，但在报告里显式标出，
  // 不允许“没有 test 就静默跳过”——那会让 full 假绿。
  const candPkg = parse(readFileSync(join(REPO, path)));
  if (candPkg?.scripts?.test) return { cmd: candPkg.scripts.test, source: raw ? "candidate-fallback" : "candidate", path };
  return { cmd: null, source: raw ? "base-no-test" : "missing", path };
}

function fastSteps() {
  const steps = [
    { id: "diff-check", argv: ["bash", "-c", "git diff --check && git diff --cached --check"], timeoutMs: 30_000 },
    { id: "manifest", argv: [process.execPath, "scripts/check-manifest.mjs"], timeoutMs: 180_000 },
    { id: "docs", argv: [process.execPath, "docs/verify-readme.mjs"], timeoutMs: 180_000 },
    { id: "router", argv: process.env.DSH_VERIFY_SELFTEST
        ? [process.execPath, "--check", "plugins/voice-control/test/router.test.mjs"]
        : [process.execPath, "--test", "plugins/voice-control/test/router.test.mjs"], timeoutMs: 180_000 },
    { id: "syntax", builtin: true, timeoutMs: 60_000 },
    { id: "policy", builtin: true, timeoutMs: 1_000 },
    { id: "test-integrity", builtin: true, timeoutMs: 1_000 },
  ];
  return steps;
}

function fullSteps() {
  const steps = [...fastSteps()];
  // 自测放 full：本机 node 进程冷启动实测 0.1–15s 抖动，8 个负例要几十次 spawn，
  // 放进 170s 的 fast 预算会把 fast 变成不稳定门（见 docs/verification.md「实测与偏差」）。
  if (!opts.noSelfTest && !process.env.DSH_VERIFY_SELFTEST) {
    steps.push({ id: "selftest", argv: [process.execPath, "--test", "scripts/verify.test.mjs"], timeoutMs: 600_000 });
  }
  for (const plugin of PLUGIN_ORDER) {
    const { cmd, source } = frozenTestCommand(plugin);
    if (!cmd) {
      steps.push({ id: `plugin-${plugin}`, argv: ["bash", "-c", "echo '没有 test 命令（默认分支与候选都未定义）' >&2; exit 2"], cwd: join(REPO, "plugins", plugin), timeoutMs: 10_000, meta: { frozenFrom: source, blocked: true } });
      continue;
    }
    steps.push({
      id: `plugin-${plugin}`,
      argv: ["bash", "-c", cmd],
      cwd: join(REPO, "plugins", plugin),
      timeoutMs: plugin === "novel-forge" ? 360_000 : 180_000,
      meta: { frozenFrom: source, equivalentCommand: `npm --prefix plugins/${plugin} test --silent` },
    });
  }
  const supplements = [
    { id: "client-archive-rsi", argv: [process.execPath, ".verify-client.mjs"], cwd: join(REPO, "plugins", "archive-rsi"), checkPath: ".verify-client.mjs" },
    { id: "client-voice-companion", argv: ["bash", "-c", "node test/client-harness.mjs && node test/avatar-harness.mjs && node test/hotkey-harness.mjs"], cwd: join(REPO, "plugins", "voice-companion"), checkPath: "test/client-harness.mjs" },
    { id: "client-voice-control", argv: [process.execPath, "test/client-harness.mjs"], cwd: join(REPO, "plugins", "voice-control"), checkPath: "test/client-harness.mjs" },
  ];
  for (const s of supplements) {
    if (existsSync(join(s.cwd, s.checkPath))) steps.push({ ...s, timeoutMs: 180_000, meta: { supplemental: true } });
  }
  return steps;
}

function planFor(level) {
  const all = level === "fast" ? fastSteps() : level === "full" ? fullSteps() : [];
  return [{ level, steps: all, budgetMs: level === "full" ? FULL_BUDGET_MS : FAST_BUDGET_MS }];
}

function heavyPlan() {
  return {
    level: "heavy",
    status: "BLOCKED",
    reason: "HEAVY_NOT_IMPLEMENTED",
    planned: [
      { id: "browser-fixture", requires: ["playwright", "本地 chromium headless shell", "esbuild 打包 client"], source: "plugins/novel-forge/dev/verify.mjs + dev/e2e.mjs", p2: true },
      { id: "dsh-mount", requires: ["独立 DSH 实例", "临时 DSH_HOME", "不复制用户 profile"], source: "plugins/novel-forge/dev/mount-check.mjs", p2: true },
    ],
    note: "P0 只登记计划；缺浏览器/宿主能力时一律 BLOCKED，不在运行中安装任何依赖。",
  };
}

// ───────────────────────── 运行与证据 ─────────────────────────

let INTERRUPTED = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { INTERRUPTED = true; });
}

function sessionPath(id) { return join(SESSIONS_DIR, `${id}.json`); }
function loadOrCreateSession() {
  ensureDir(SESSIONS_DIR);
  if (opts.session) {
    const s = readJson(sessionPath(opts.session));
    if (!s) failUsage(`session 不存在：${opts.session}`);
    return s;
  }
  const latest = join(SESSIONS_DIR, "latest-id");
  if (existsSync(latest)) {
    const id = readFileSync(latest, "utf8").trim();
    const s = readJson(sessionPath(id));
    if (s) return s;
  }
  return createSession(null);
}
function createSession(taskId) {
  ensureDir(SESSIONS_DIR);
  const s = { id: randomUUID(), taskId: taskId || null, createdAt: nowIso(), failureRound: 0, status: "open", runs: [], blocks: 0, exceptionUsed: false };
  writeJsonAtomic(sessionPath(s.id), s);
  writeFileSync(join(SESSIONS_DIR, "latest-id"), s.id, { mode: 0o600 });
  return s;
}
function saveSession(s) { writeJsonAtomic(sessionPath(s.id), s); }

function newRunDir() {
  ensureDir(RUNS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(RUNS_DIR, `${stamp}-${randomUUID().slice(0, 8)}`);
  ensureDir(dir);
  return dir;
}

async function execute(level) {
  trace("execute 开始");
  const session = loadOrCreateSession();
  if (session.status === "escalated") {
    const last = session.runs.slice(-3).map((r) => `${r.runId}(${r.status})`).join(", ");
    console.log(`BLOCKED：本 session 已连续 3 轮失败（${last}）。需要人确认后执行：`);
    console.log(`  node scripts/verify.mjs session resume --id ${session.id} --human-note "继续原因"`);
    process.exit(EXIT.BLOCKED);
  }
  trace("session 就绪");
  const base = baseInfo();
  trace("base 解析完成");
  const subject = subjectHash();
  trace("subjectHash 完成");
  const policy = policyHash();
  trace("policyHash 完成");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const dir = join(RUNS_DIR, runId);
  ensureDir(join(dir, "logs"));
  const report = {
    schemaVersion: 1, runId, sessionId: session.id, level, status: "RUNNING", complete: false,
    startedAt: nowIso(), endedAt: null, durationMs: 0,
    git: {
      headSha: headSha(), indexTree: opts.staged ? (git(["write-tree"], { allowFail: true }) || null) : null,
      subjectHash: subject, subjectKind: opts.staged ? "staged" : "working",
      dirty: (git(["status", "--porcelain"], { allowFail: true }) || "") !== "",
      baseRef: base.ref, baseSha: base.sha, mergeBaseSha: base.mergeBase,
    },
    runtime: { node: process.version, platform: platform(), arch: arch() },
    policy: { sha256: policy.hash, trusted: policy.trusted },
    requiredLevels: level === "fast" ? ["fast"] : level === "full" ? ["fast", "full"] : ["fast", "full", "heavy"],
    triggeredRules: triggeredRules(base),
    steps: [], failureRound: session.failureRound, limitations: [],
  };
  if (level === "fast") report.limitations.push("未验证真实 DSH UI（heavy 未实现）");
  const fallbackPlugins = PLUGIN_ORDER.filter((p) => frozenTestCommand(p).source === "candidate-fallback" || frozenTestCommand(p).source === "candidate");
  if (fallbackPlugins.length) report.limitations.push(`插件 test 命令取自候选（默认分支未定义）：${fallbackPlugins.join(", ")}`);
  if (opts.staged) {
    const unstaged = git(["diff", "--name-only"], { allowFail: true }) || "";
    const untracked = git(["ls-files", "--others", "--exclude-standard"], { allowFail: true }) || "";
    if (unstaged.trim() || untracked.trim()) report.limitations.push("staged 证据要求工作树与暂存区一致且无未跟踪文件；当前不满足");
  }
  writeJsonAtomic(join(dir, "report.json"), report);

  const plan = planFor(level)[0];
  const startedAt = Date.now();
  const deadline = startedAt + plan.budgetMs;

  trace(`计划 ${plan.steps.length} 步，预算 ${plan.budgetMs}ms`);
  for (const step of plan.steps) {
    trace(`开始步骤 ${step.id}`);
    if (INTERRUPTED) { report.steps.push({ id: step.id, status: "INTERRUPTED" }); report.complete = false; break; }
    const left = deadline - Date.now();
    if (left < 1_000) {
      report.steps.push({ id: step.id, status: "NOT_RUN", reason: "BUDGET_EXHAUSTED" });
      continue;
    }
    if (step.id === "syntax") { report.steps.push(await runSyntaxStep(dir, left)); continue; }
    if (step.id === "policy") { report.steps.push(runPolicyAsStep()); continue; }
    if (step.id === "test-integrity") { report.steps.push(runTestIntegrity()); continue; }
    const r = await runStep(step, join(dir, "logs"), left);
    trace(`步骤 ${step.id} → ${r.status} ${r.durationMs}ms`);
    report.steps.push(finishStep(r, dir));
    writeJsonAtomic(join(dir, "report.json"), report);
  }

  const stale = subjectHash() !== subject;
  report.endedAt = nowIso();
  report.durationMs = Date.now() - startedAt;
  report.complete = !stale && report.steps.every((s) => s.status !== "NOT_RUN");
  if (stale) report.limitations.push("STALE_DURING_RUN：运行期间受测内容发生变化，本报告不可作为通过凭据");

  const failed = report.steps.filter((s) => ["FAIL", "TIMEOUT", "INTERRUPTED"].includes(s.status));
  const blocked = report.steps.filter((s) => s.status === "BLOCKED");
  report.status = failed.length ? "FAIL" : blocked.length ? "BLOCKED" : report.complete ? "PASS" : "BLOCKED";
  if (stale) report.status = "FAIL";
  if (INTERRUPTED) report.status = "INTERRUPTED";
  writeJsonAtomic(join(dir, "report.json"), report);
  writeSummary(dir, report);

  session.runs.push({ runId, level, status: report.status, at: report.endedAt, durationMs: report.durationMs });
  if (report.status === "PASS") session.failureRound = 0;
  else if (report.status === "FAIL") session.failureRound = Math.min(3, session.failureRound + 1);
  if (session.failureRound >= 3) session.status = "escalated";
  saveSession(session);

  printReport(report, dir);
  process.exit(report.status === "PASS" ? EXIT.PASS : report.status === "BLOCKED" ? EXIT.BLOCKED : EXIT.FAIL);
}

function finishStep(r, dir) {
  return {
    id: r.id, command: r.argv, cwd: rel(r.cwd || REPO), durationMs: r.durationMs,
    exitCode: r.exitCode ?? null, signal: r.signal ?? null, status: r.status,
    summary: r.reason || tailSummary(join(REPO, r.stdout || "x")),
    stdout: r.stdout ? rel(join(REPO, r.stdout)) : null,
    stderr: r.stderr ? rel(join(REPO, r.stderr)) : null,
    outputSha256: { stdout: r.stdout ? hashOf(join(REPO, r.stdout)) : null, stderr: r.stderr ? hashOf(join(REPO, r.stderr)) : null },
    meta: r.meta || null,
  };
}

// 单个子进程内解析所有改动文件的语法（这台机器上每次 spawn 冷启动可达 10s+，
// 20 个改动文件逐个 spawn 会把 fast 预算吃光）。ESM 解析失败时再用 node --check 复核，
// 避免把 CJS 的 with/top-level return 误判成语法错。
const SYNTAX_CHILD = String.raw`
const vm = require("vm");
const fs = require("fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const files = JSON.parse(input);
  const bad = [];
  for (const f of files) {
    const code = fs.readFileSync(f, "utf8");
    let err = null;
    try { new vm.SourceTextModule(code, { identifier: f }); }
    catch (e) { err = e; }
    if (err) bad.push({ file: f, reason: String(err.message || err).split("\n")[0] });
  }
  process.stdout.write(JSON.stringify(bad));
});
`;

async function runSyntaxStep(dir, budget) {
  const started = Date.now();
  const base = baseInfo();
  const changed = new Set();
  if (base.mergeBase) {
    for (const p of (git(["diff", "--name-only", "--diff-filter=ACMR", base.mergeBase], { allowFail: true }) || "").split("\n").filter(Boolean)) changed.add(p);
  }
  for (const p of (git(["ls-files", "--others", "--exclude-standard"], { allowFail: true }) || "").split("\n").filter(Boolean)) changed.add(p);
  const all = candidateFiles();
  const files = (base.mergeBase ? all.filter((f) => changed.has(f.path)) : all).filter((f) => /\.(m|c)?js$/.test(f.path) && f.link == null);
  const log = join(dir, "logs", "syntax.log");
  ensureDir(dirname(log));
  const failures = [];
  const logLines = [];
  if (files.length) {
    const batch = await runStep({
      id: "syntax-batch",
      argv: [process.execPath, "--no-warnings", "--experimental-vm-modules", "-e", SYNTAX_CHILD],
      stdin: JSON.stringify(files.map((f) => f.abs)),
      timeoutMs: Math.min(60_000, Math.max(2_000, budget)),
    }, join(dir, "logs"), budget);
    if (batch.status === "PASS") {
      let bad = [];
      try { bad = JSON.parse(readFileSync(join(dir, "logs", "syntax-batch.stdout.log"), "utf8") || "[]"); } catch { bad = []; }
      const badSet = new Set(bad.map((b) => b.file));
      for (const b of bad) failures.push(`${rel(b.file)}: ${b.reason}`);
      for (const f of files) logLines.push(`${badSet.has(f.abs) ? "FAIL" : "PASS"} ${f.path}`);
    } else {
      // 批量子进程异常：退回逐文件 node --check，保证门本身不假绿
      for (const f of files) {
        if (Date.now() - started > budget) { failures.push("BUDGET_EXHAUSTED"); break; }
        const r = await runStep({ id: `syntax-${sha256(f.path).slice(0, 8)}`, argv: [process.execPath, "--check", f.abs], timeoutMs: 20_000 }, join(dir, "logs"), budget - (Date.now() - started));
        if (r.status !== "PASS") failures.push(`${f.path}: ${r.status}`);
        logLines.push(`${r.status} ${f.path}`);
      }
      logLines.push(`(批次检查异常，已退回逐文件：${batch.status} ${batch.reason || ""})`);
    }
  }
  writeFileSync(log, (logLines.join("\n") || "(无改动 JS 文件)") + "\n", { mode: 0o600 });
  return {
    id: "syntax", command: ["(batch) node --experimental-vm-modules 解析 + 失败复核"], cwd: ".", durationMs: Date.now() - started,
    exitCode: failures.length ? 1 : 0, signal: null, status: failures.length ? "FAIL" : "PASS",
    summary: failures.length ? `${failures.length}/${files.length} 个文件失败：${failures.slice(0, 5).join("; ")}`
      : `${files.length} 个改动文件通过${base.mergeBase ? "（仅改动 vs 基线）" : "（无基线，全量）"}`,
    stdout: rel(log), stderr: null, outputSha256: { stdout: sha256File(log), stderr: null },
    meta: { files: files.length, scope: base.mergeBase ? "changed-vs-base" : "all" },
  };
}

function runPolicyAsStep() {
  const { fails, notes } = checkPolicy();
  return {
    id: "policy", command: ["(builtin) policy --check"], cwd: ".", durationMs: 1,
    exitCode: fails.length ? 1 : 0, signal: null, status: fails.length ? "FAIL" : "PASS",
    summary: fails.length ? fails.join(" | ") : `规则与文档就绪（${notes.length} 条备注）`,
    stdout: null, stderr: null, outputSha256: { stdout: null, stderr: null }, meta: { notes: notes.slice(0, 10) },
  };
}

/** 受测改动不得删除/替换默认分支上的正式测试文件（P0 的「检查不可被改弱」检查）。 */
function runTestIntegrity() {
  const base = baseInfo();
  if (!base.sha) {
    return { id: "test-integrity", status: "BLOCKED", summary: "缺少默认分支 ref，无法比对正式测试集", durationMs: 1, command: ["(builtin) test-integrity"] };
  }
  const list = spawnSyncGit(["diff", "--name-status", base.mergeBase, "--", "plugins", "scripts", "tests"]);
  const rows = (list.stdout || "").trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
  const removed = rows.filter(([s]) => s === "D").map(([, p]) => p);
  const changedTests = rows.filter(([s, p]) => p && s.startsWith("M") && /(^plugins\/[^/]+\/test\/|\/tests?\/|\.test\.mjs$|\.verify-(host|client)\.mjs$)/.test(p)).map(([, p]) => p);
  const fails = [];
  if (removed.length) fails.push(`删除正式测试/脚本：${removed.slice(0, 5).join(", ")}`);
  return {
    id: "test-integrity", command: ["(builtin) test-integrity"], cwd: ".", durationMs: 1,
    exitCode: fails.length ? 1 : 0, status: fails.length ? "FAIL" : "PASS",
    summary: fails.length ? fails.join(" | ") : `正式测试集未被删除（改动 ${changedTests.length} 项，作为补充证据展示）`,
    stdout: null, stderr: null, outputSha256: { stdout: null, stderr: null }, meta: { changedTests: changedTests.slice(0, 20) },
  };
}

function writeSummary(dir, report) {
  const lines = [
    `# verify ${report.level} · ${report.status}`,
    "",
    `- runId: \`${report.runId}\``,
    `- 开始/结束: ${report.startedAt} → ${report.endedAt}（${report.durationMs}ms）`,
    `- git: HEAD \`${report.git.headSha}\` · base \`${report.git.baseSha || "无"}\` (${report.git.baseRef || "-"})`,
    `- subjectHash: \`${report.git.subjectHash}\``,
    `- policy: \`${report.policy.sha256}\` trusted=${report.policy.trusted}`,
    `- complete: ${report.complete} · 失败轮次: ${report.failureRound}`,
    "",
    "| 步骤 | 状态 | 耗时 | 摘要 |",
    "|---|---|---|---|",
    ...report.steps.map((s) => `| ${s.id} | ${s.status} | ${s.durationMs ?? "-"}ms | ${(s.summary || "").replace(/\|/g, "\\|").slice(0, 80)} |`),
    "",
    ...(report.limitations.length ? ["## 局限", ...report.limitations.map((l) => `- ${l}`), ""] : []),
  ];
  writeFileSync(join(dir, "summary.md"), lines.join("\n"), { mode: 0o600 });
}

function printReport(report, dir) {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`\nverify ${report.level} · ${report.status}${report.complete ? "" : "（不完整）"} · ${report.durationMs}ms`);
  console.log(`git HEAD ${report.git.headSha?.slice(0, 8)} · base ${report.git.baseSha ? report.git.baseSha.slice(0, 8) : "无"} · subject ${report.git.subjectHash.slice(0, 12)}`);
  for (const s of report.steps) {
    const d = s.durationMs != null ? `${s.durationMs}ms` : "";
    console.log(`  ${s.status.padEnd(9)} ${s.id.padEnd(26)} ${d.padStart(8)}  ${(s.summary || "").split("\n")[0].slice(0, 90)}`);
  }
  console.log(`\n证据: ${dir}/report.json`);
  if (report.status !== "PASS") console.log(`下一轮: 读 ${dir}/logs/*.log，修因不修果；三轮失败后需人 session resume。`);
}

// ───────────────────────── 策略：规则文件校验 ─────────────────────────

const POLICY_FILES = [
  "REVIEW.md", "docs/reliability.json", "docs/verification-incidents.md",
  "docs/verification.md", ".agents/skills/verify/SKILL.md",
  "scripts/verify.mjs", "scripts/test-all.sh",
];

function policyHash() {
  const items = POLICY_FILES.map((p) => {
    const abs = join(REPO, p);
    const blob = existsSync(abs) ? readFileSync(abs) : null;
    return { path: p, sha256: blob ? sha256(blob) : null };
  });
  const hash = sha256(Buffer.from(JSON.stringify(items)));
  const trusted = items.every((it) => it.sha256 && baseHasBlob(it.path) && sha256(baseBlob(it.path)) === it.sha256);
  return { hash, trusted, items };
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { out += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

function checkPolicy() {
  const fails = [];
  const notes = [];
  const need = (cond, msg) => { if (!cond) fails.push(msg); };

  // REVIEW.md
  const review = existsSync(join(REPO, "REVIEW.md")) ? readFileSync(join(REPO, "REVIEW.md"), "utf8") : "";
  need(review.length > 200, "REVIEW.md 缺失或过短");
  for (const k of ["Important", "Nit", "Pre-existing", "stamp", "默认分支"]) need(review.includes(k), `REVIEW.md 缺少必需内容：${k}`);

  // reliability.json
  let rules = [];
  const relPath = join(REPO, "docs/reliability.json");
  const relRaw = existsSync(relPath) ? readFileSync(relPath, "utf8") : "";
  let relJson = null;
  try { relJson = JSON.parse(relRaw); } catch { fails.push("docs/reliability.json 不是合法 JSON"); }
  if (relJson) {
    need(relJson.schemaVersion === 1, "reliability.json schemaVersion 必须为 1");
    rules = Array.isArray(relJson.rules) ? relJson.rules : [];
    need(rules.length > 0, "reliability.json 没有任何规则");
    const ids = new Set();
    const incidents = existsSync(join(REPO, "docs/verification-incidents.md")) ? readFileSync(join(REPO, "docs/verification-incidents.md"), "utf8") : "";
    for (const r of rules) {
      need(r.id && !ids.has(r.id), `规则 id 重复或缺失：${r.id}`);
      ids.add(r.id);
      need(["active", "draft"].includes(r.status), `${r.id}: status 必须是 active|draft`);
      need(["fast", "full", "heavy"].includes(r.requiredLevel), `${r.id}: requiredLevel 非法`);
      need(Array.isArray(r.check) && r.check.length > 0, `${r.id}: check 必须是非空 argv 数组`);
      const paths = Array.isArray(r.paths) ? r.paths : [r.paths];
      need(paths.length > 0 && paths.every((p) => typeof p === "string" && p), `${r.id}: paths 必填`);
      for (const p of paths) { try { globToRegExp(p); } catch { fails.push(`${r.id}: paths glob 非法（${p}）`); } }
      if (r.fallback) {
        const fb = Array.isArray(r.fallback.paths) ? r.fallback.paths : [r.fallback.paths];
        for (const p of fb) { try { globToRegExp(p); } catch { fails.push(`${r.id}: fallback glob 非法（${p}）`); } }
      }
      if (r.addedOrRemovedPattern) { try { new RegExp(r.addedOrRemovedPattern); } catch { fails.push(`${r.id}: pattern 正则非法`); } }
      const anchor = String(r.incident || "").split("#")[1];
      need(anchor, `${r.id}: incident 必须带 #anchor`);
      if (anchor) need(incidents.includes(`id="${anchor}"`) || incidents.includes(`id='${anchor}'`), `${r.id}: incidents 文档缺少锚点 ${anchor}`);
      if (r.status === "active") notes.push(`规则 ${r.id} active（${r.requiredLevel}）`);
    }
  }

  // verification.md
  const doc = existsSync(join(REPO, "docs/verification.md")) ? readFileSync(join(REPO, "docs/verification.md"), "utf8") : "";
  need(doc.length > 500, "docs/verification.md 缺失或过短");
  for (const k of ["fast", "full", "heavy", "证据", "门禁", "三轮", "bootstrap"]) need(doc.includes(k), `docs/verification.md 缺少必需内容：${k}`);
  need(!/npm run verify/.test(doc), "docs/verification.md 不得写 npm run verify（本仓无根 package.json）");

  // SKILL.md
  const skillPath = join(REPO, ".agents/skills/verify/SKILL.md");
  const skill = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
  need(/^---[\s\S]*?name:\s*verify/m.test(skill), "SKILL.md frontmatter 缺少 name: verify");
  for (const k of ["verify.mjs fast", "verify.mjs full", "gate check"]) need(skill.includes(k), `SKILL.md 未提到命令：${k}`);

  return { fails, notes };
}

function triggeredRules(base) {
  if (!base.mergeBase) return [];
  const diff = spawnSyncGit(["diff", "-U0", base.mergeBase, "--"]);
  const rows = (diff.stdout || "").split("\n");
  const currentFile = new Map(); // path -> changed lines joined
  let path = null;
  for (const line of rows) {
    if (line.startsWith("+++ b/")) { path = line.slice(6); if (!currentFile.has(path)) currentFile.set(path, []); continue; }
    if (!path) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) currentFile.get(path).push(line.slice(1));
  }
  let json = null;
  try { json = JSON.parse(readFileSync(join(REPO, "docs/reliability.json"), "utf8")); } catch { return []; }
  const hit = [];
  for (const r of json.rules || []) {
    if (r.status !== "active") continue;
    const globs = [...(Array.isArray(r.paths) ? r.paths : [r.paths])];
    if (r.fallback) globs.push(...(Array.isArray(r.fallback.paths) ? r.fallback.paths : [r.fallback.paths]));
    let regs = [];
    for (const g of globs) { try { regs.push(globToRegExp(g)); } catch { /* 跳过非法 glob */ } }
    let pattern = null;
    if (r.addedOrRemovedPattern) { try { pattern = new RegExp(r.addedOrRemovedPattern); } catch { continue; } }
    for (const [p, lines] of currentFile) {
      if (!regs.some((re) => re.test(p))) continue;
      if (!pattern || lines.some((l) => pattern.test(l))) { hit.push(r.id); break; }
    }
  }
  return [...new Set(hit)];
}

// ───────────────────────── 证据读取与校验 ─────────────────────────

function listRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .map((name) => ({ name, dir: join(RUNS_DIR, name), report: readJson(join(RUNS_DIR, name, "report.json")) }))
    .filter((x) => x.report)
    .sort((a, b) => String(a.report.startedAt).localeCompare(String(b.report.startedAt)));
}

function latestRun(level) {
  const runs = listRuns().filter((r) => !level || r.report.level === level);
  return runs.length ? runs[runs.length - 1] : null;
}

function evidenceStatus(level, assertCurrent) {
  const run = level === "heavy" ? latestRun("heavy") : level === "full" ? (latestRun("full") || latestRun("heavy")) : latestRun("fast");
  if (!run) return { ok: false, exit: EXIT.BLOCKED, reason: `没有 ${level} 证据` };
  const r = run.report;
  const reasons = [];
  if (r.status !== "PASS") reasons.push(`状态 ${r.status}`);
  if (!r.complete) reasons.push("报告不完整");
  if (r.status === "RUNNING") reasons.push("中断残留（INTERRUPTED）");
  const base = baseInfo();
  if (assertCurrent) {
    if (r.git.subjectHash !== subjectHash()) reasons.push("内容已变化（subjectHash 不匹配）");
    if ((r.git.baseSha || null) !== (base.sha || null)) reasons.push("基线已变化（baseSha 不匹配）");
    if (r.policy?.sha256 !== policyHash().hash) reasons.push("规则已变化（policyHash 不匹配）");
    for (const s of r.steps) {
      for (const [stream, file] of [["stdout", s.stdout], ["stderr", s.stderr]]) {
        if (!file) continue;
        const expect = s.outputSha256?.[stream];
        if (expect && hashOf(join(REPO, file)) !== expect) reasons.push(`日志被篡改：${file}`);
      }
    }
  }
  return { ok: reasons.length === 0, exit: reasons.length ? EXIT.FAIL : EXIT.PASS, reasons, run };
}

// ───────────────────────── 审阅 ─────────────────────────

function reviewRun(runId, file) {
  const dir = join(RUNS_DIR, runId);
  const report = readJson(join(dir, "report.json"));
  if (!report) failUsage(`run 不存在：${runId}`);
  let round;
  try { round = JSON.parse(readFileSync(resolve(file), "utf8")); } catch (e) { console.error(`round.json 读取失败：${e.message}`); process.exit(EXIT.USAGE); }
  const fails = [];
  for (const k of ["reviewerId", "round", "subject", "baseSha", "policyHash", "findings", "verdict", "stamp"]) {
    if (round[k] === undefined) fails.push(`round.json 缺少字段：${k}`);
  }
  if (fails.length) { console.error(fails.join("\n")); process.exit(EXIT.USAGE); }
  if (round.subject?.subjectHash !== report.git.subjectHash) fails.push("round.subject.subjectHash 与证据不一致（审的不是这份内容）");
  if ((round.baseSha || null) !== (report.git.baseSha || null)) fails.push("round.baseSha 与证据不一致");
  if (round.policyHash !== report.policy?.sha256) fails.push("round.policyHash 与证据不一致（规则已变）");
  if (round.verdict === "pass" && !round.stamp) fails.push("verdict=pass 但缺 stamp（无发现必须 stamp=none）");
  const prev = readdirSync(dir).includes("review") ? readdirSync(join(dir, "review")).sort() : [];
  if (prev.length) {
    const last = readJson(join(dir, "review", prev[prev.length - 1]));
    if (last?.reviewerId && last.reviewerId !== round.reviewerId) fails.push(`审阅者必须同一人：上一轮 ${last.reviewerId}`);
    if (last && round.round !== last.round + 1) fails.push(`轮次不连续：上一轮 ${last.round}，本轮 ${round.round}`);
    if (last && round.previousRoundHash !== sha256(JSON.stringify(last))) fails.push("previousRoundHash 与上一轮不符");
    if (last && last.verdict === "pass" && JSON.stringify(last.subject) !== JSON.stringify(round.subject)) fails.push("内容已变但延续 pass 审批");
  }
  const importantOpen = (round.findings || []).filter((f) => f.tag === "Important" && f.status !== "resolved");
  if (importantOpen.length) fails.push(`Important 未解决：${importantOpen.map((f) => f.id).join(", ")}`);
  if (fails.length) { console.error(fails.join("\n")); process.exit(EXIT.FAIL); }
  ensureDir(join(dir, "review"));
  writeJsonAtomic(join(dir, "review", `round-${round.round}.json`), round);
  console.log(`已录入 round-${round.round}.json（verdict=${round.verdict}, stamp=${round.stamp}）`);
  process.exit(EXIT.PASS);
}

// ───────────────────────── 门禁 ─────────────────────────

function gateConfig() {
  return readJson(CONFIG_PATH) || { mode: "observe", sessionId: null, installedAt: null, trustedSha: null };
}

function gateCheck() {
  const cfg = gateConfig();
  const session = loadOrCreateSession();
  const reasons = [];
  let evidence = null;
  if (cfg.mode === "off") {
    console.log("gate: off（不查验证据；这不代表验证通过）");
    process.exit(EXIT.PASS);
  }
  const full = evidenceStatus("full", true);
  evidence = full.run;
  if (!full.ok) reasons.push(`full 证据不可用：${(full.reasons || [full.reason]).join("；")}`);
  if (full.ok) {
    const dir = full.run.dir;
    const rd = existsSync(join(dir, "review")) ? readdirSync(join(dir, "review")).sort() : [];
    const last = rd.length ? readJson(join(dir, "review", rd[rd.length - 1])) : null;
    if (!last) reasons.push("没有审阅轮次证据");
    else {
      if (last.verdict !== "pass") reasons.push(`审阅未通过（${last.verdict}）`);
      if (!last.stamp) reasons.push("审阅缺 stamp");
      if (last.subject?.subjectHash !== subjectHash()) reasons.push("审阅绑定的内容已变化");
    }
  }
  if (triggeredRules(baseInfo()).some((id) => (readJson(join(REPO, "docs/reliability.json"))?.rules || []).find((r) => r.id === id)?.requiredLevel === "heavy")) {
    const h = evidenceStatus("heavy", true);
    if (!h.ok) reasons.push(`命中 heavy 规则但无 heavy 证据：${(h.reasons || [h.reason]).join("；")}`);
  }
  const wouldBlock = reasons.length > 0;
  const event = {
    at: nowIso(), mode: cfg.mode, wouldBlock, reasons, sessionId: session.id,
    subjectHash: subjectHash(), runId: evidence?.report?.runId || null, exception: null,
  };
  if (cfg.mode === "observe") {
    try { appendJsonl(GATE_EVENTS, event); } catch (e) { console.error(`警告：门禁事件写不进去（${e.message}），observe 不拦提交`); }
    console.log(wouldBlock ? `gate observe: wouldBlock=true — ${reasons.join("；")}` : "gate observe: wouldBlock=false（有完整当前证据）");
    process.exit(EXIT.PASS);
  }
  // enforce
  if (wouldBlock) {
    if (session.blocks >= 2 && !session.exceptionUsed) {
      session.exceptionUsed = true;
      event.exception = "anti-stuck";
      saveSession(session);
      try { appendJsonl(GATE_EVENTS, event); } catch { /* 已 stderr 提示 */ }
      console.error("例外提交，验证未通过：" + reasons.join("；"));
      process.exit(EXIT.PASS);
    }
    session.blocks += 1;
    saveSession(session);
    try { appendJsonl(GATE_EVENTS, event); } catch { /* 同上 */ }
    console.error("提交被拦：" + reasons.join("；"));
    process.exit(EXIT.FAIL);
  }
  try { appendJsonl(GATE_EVENTS, event); } catch { /* 同上 */ }
  console.log("gate enforce: 证据完整，放行");
  process.exit(EXIT.PASS);
}

function gateStatus() {
  const cfg = gateConfig();
  const hookPath = resolve(REPO, git(["rev-parse", "--git-path", "hooks/pre-commit"], { allowFail: true }) || ".git/hooks/pre-commit");
  const hookInstalled = existsSync(hookPath) && readFileSync(hookPath, "utf8").includes("dsh-verify");
  const base = baseInfo();
  const stale = cfg.trustedSha && cfg.trustedSha !== base.sha;
  const events = existsSync(GATE_EVENTS) ? readFileSync(GATE_EVENTS, "utf8").trim().split("\n").filter(Boolean).slice(-5).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const out = {
    mode: cfg.mode, hookPath: rel(hookPath), hookInstalled, trustedSha: cfg.trustedSha,
    baseSha: base.sha, baseRef: base.ref, trustedStale: !!stale,
    latestWouldBlock: events.length ? events[events.length - 1].wouldBlock : null,
  };
  if (opts.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`mode=${out.mode}${out.mode === "observe" ? "（只记录不拦）" : ""}`);
    console.log(`hook: ${out.hookInstalled ? `已安装 ${out.hookPath}` : "未安装"}${out.trustedStale ? " · 可信快照已过期，需 gate install --refresh" : ""}`);
    console.log(`base: ${out.baseRef || "无"} ${out.baseSha ? out.baseSha.slice(0, 12) : ""}`);
    console.log(`最近一次 wouldBlock: ${out.latestWouldBlock ?? "无记录"}`);
  }
  process.exit(EXIT.PASS);
}

function gateInstall() {
  const cfg = gateConfig();
  const hookPath = resolve(REPO, git(["rev-parse", "--git-path", "hooks/pre-commit"]));
  const hooksPathCfg = git(["config", "core.hooksPath"], { allowFail: true });
  if (hooksPathCfg) { console.error(`仓库设置了 core.hooksPath=${hooksPathCfg}，不覆盖；请手工接入 ${rel(STATE_DIR)}/trusted/<sha>/verify.mjs gate check`); process.exit(EXIT.BLOCKED); }
  if (existsSync(hookPath)) {
    const body = readFileSync(hookPath, "utf8");
    if (!body.includes("dsh-verify")) { console.error(`已有其他 pre-commit hook：${rel(hookPath)}，不覆盖`); process.exit(EXIT.BLOCKED); }
  }
  const base = baseInfo();
  if (!base.sha) { console.error("缺少默认分支 ref，无法生成可信快照"); process.exit(EXIT.BLOCKED); }
  const trustedDir = join(STATE_DIR, "trusted", base.sha);
  ensureDir(trustedDir);
  copyFileSync(join(HERE, "verify.mjs"), join(trustedDir, "verify.mjs"));
  chmodSync(join(trustedDir, "verify.mjs"), 0o755);
  writeFileSync(hookPath, `#!/bin/sh\n# dsh-verify gate（observe 默认；本文件由 scripts/verify.mjs gate install 生成）\nexec "${process.execPath}" "${join(trustedDir, "verify.mjs")}" gate check --repo "${REPO}"\n`, { mode: 0o755 });
  cfg.installedAt = nowIso(); cfg.trustedSha = base.sha; writeJsonAtomic(CONFIG_PATH, cfg);
  console.log(`已安装 pre-commit hook（mode=${cfg.mode}）：${rel(hookPath)}（可信快照 ${base.sha.slice(0, 12)}）`);
  process.exit(EXIT.PASS);
}

// ───────────────────────── 主入口 ─────────────────────────

async function main() {
  const cmd = positional[0];
  if (!cmd) failUsage("缺少子命令");
  if (!existsSync(REPO) || !git(["rev-parse", "--git-dir"], { allowFail: true })) failUsage(`${REPO} 不是 git 仓库`);

  if (cmd === "fast" || cmd === "full") { await execute(cmd); return; }
  if (cmd === "heavy") {
    if (opts.plan) {
      const plan = heavyPlan();
      if (opts.json) console.log(JSON.stringify(plan, null, 2));
      else console.log(`heavy 计划（P0 未实现）：\n${plan.planned.map((p) => `  - ${p.id} 需要 ${p.requires.join(" + ")}（${p.source}）`).join("\n")}\n${plan.note}`);
      process.exit(EXIT.PASS);
    }
    const out = { level: "heavy", status: "BLOCKED", reason: "HEAVY_NOT_IMPLEMENTED" };
    if (opts.json) console.log(JSON.stringify(out, null, 2)); else console.log("heavy: BLOCKED（P0 未实现；先 `node scripts/verify.mjs heavy --plan` 看前提）");
    process.exit(EXIT.BLOCKED);
  }
  if (cmd === "policy") {
    const { fails, notes } = checkPolicy();
    const base = baseInfo();
    const out = { ok: fails.length === 0, baseRef: base.ref, baseSha: base.sha, policy: policyHash(), fails, notes };
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else { console.log(`policy: ${fails.length ? "FAIL" : "OK"} · base=${base.ref || "无"} ${base.sha?.slice(0, 12) || ""} · trusted=${out.policy.trusted}`); for (const f of fails) console.log(`  FAIL ${f}`); for (const n of notes) console.log(`  ${n}`); }
    process.exit(fails.length ? EXIT.FAIL : EXIT.PASS);
  }
  if (cmd === "evidence") {
    const level = opts.require || "full";
    const res = evidenceStatus(level, true);
    const out = { ok: res.ok, level, reasons: res.reasons || (res.reason ? [res.reason] : []), run: res.run?.report ? { runId: res.run.report.runId, status: res.run.report.status, level: res.run.report.level, subjectHash: res.run.report.git.subjectHash } : null };
    if (opts.json) console.log(JSON.stringify(out, null, 2)); else console.log(res.ok ? `evidence ${level}: OK（${out.run.runId}）` : `evidence ${level}: ${out.reasons.join("；")}`);
    process.exit(res.exit);
  }
  if (cmd === "gate") {
    const sub = positional[1];
    if (sub === "status") return gateStatus();
    if (sub === "check") return gateCheck();
    if (sub === "install") return gateInstall();
    if (sub === "configure") {
      if (!["off", "observe", "enforce"].includes(opts.mode)) failUsage("--mode 必须是 off|observe|enforce");
      const cfg = gateConfig(); const old = cfg.mode; cfg.mode = opts.mode; writeJsonAtomic(CONFIG_PATH, cfg);
      try { appendJsonl(GATE_EVENTS, { at: nowIso(), event: "mode-change", from: old, to: cfg.mode, sessionId: loadOrCreateSession().id }); } catch { /* 记录失败不阻断 */ }
      console.log(`门禁模式：${old} → ${cfg.mode}`); process.exit(EXIT.PASS);
    }
    failUsage(`gate 子命令未知：${sub}`);
  }
  if (cmd === "review") {
    if (!opts.run || !opts.file) failUsage("review 需要 --run <runId> --file <round.json>");
    return reviewRun(opts.run, opts.file);
  }
  if (cmd === "session") {
    const sub = positional[1];
    if (sub === "start") { const s = createSession(opts.task); console.log(`session: ${s.id}（task=${s.taskId || "-"}）`); process.exit(EXIT.PASS); }
    if (sub === "resume") {
      const s = opts.id ? readJson(sessionPath(opts.id)) : loadOrCreateSession();
      if (!s) failUsage(`session 不存在：${opts.id}`);
      if (!opts.humanNote) failUsage("resume 必须带 --human-note（说明为什么继续）");
      s.status = "open"; s.failureRound = 0; s.resumes = [...(s.resumes || []), { at: nowIso(), note: opts.humanNote }];
      saveSession(s); console.log(`session ${s.id} 已恢复，失败轮次清零（原因：${opts.humanNote}）`); process.exit(EXIT.PASS);
    }
    failUsage(`session 子命令未知：${sub}`);
  }
  if (cmd === "heavy") { /* 已处理 */ }
  failUsage(`未知子命令：${cmd}`);
}

main().catch((e) => { console.error(`内部错误：${e.stack || e.message}`); process.exit(EXIT.FAIL); });
