#!/usr/bin/env node
// 插件清单体检：11 个插件的 package.json 必填字段、engines 上界、发布产物、以及
// index.json 与「被引用的那个 commit」里 package.json 的一致性。
//
// 依据：deepseek-ai/deepseek-harness docs/user/develop/basic/publish.md 与
// docs/user/guide/plugin-market.md（engines.dsh 必须与包自身声明一致；索引只描述已发布事实）。
//
//   node scripts/check-manifest.mjs        # 有 FAIL 时退出码 1
//   node scripts/check-manifest.mjs --json # 机器可读
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const notes = [];
const fail = (m) => fails.push(`FAIL ${m}`);
const info = (m) => notes.push(`info ${m}`);
const ok = (m) => notes.push(`ok   ${m}`);

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const shallow = git(["rev-parse", "--is-shallow-repository"]);
const hasHistory = shallow === "false";

const semverRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const pluginsDir = join(root, "plugins");
const dirs = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(pluginsDir, d.name, "package.json")))
  .map((d) => d.name)
  .sort();

const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const latestVersionOf = (entry) =>
  (entry.versions ?? []).slice().sort((a, b) => (b.publishTimestamp ?? 0) - (a.publishTimestamp ?? 0))[0];
const byName = new Map((index.plugins ?? []).map((p) => [p.name, p]));

// --- 1. 每个包的清单字段 -----------------------------------------------------
const manifests = new Map();
for (const dir of dirs) {
  const rel = `plugins/${dir}/package.json`;
  const pkg = JSON.parse(readFileSync(join(root, rel), "utf8"));
  manifests.set(pkg.name, { dir, rel, pkg });
  const at = (field) => `${rel}: ${field}`;

  if (!pkg.name) fail(at("缺 name"));
  if (!pkg.version || !semverRe.test(pkg.version)) fail(at(`version 不是精确 SemVer（${pkg.version}）`));
  if (pkg.license !== "MIT") fail(at(`license 应为 MIT（当前 ${pkg.license ?? "缺失"}）`));
  if (!pkg.description || typeof pkg.description !== "string") fail(at("缺 description"));
  if (!pkg.repository?.url) fail(at("缺 repository.url（市场卡片与溯源用）"));
  if (!Array.isArray(pkg.keywords) || pkg.keywords.length < 3)
    fail(at(`keywords 只有 ${pkg.keywords?.length ?? 0} 个（要求 ≥3）`));
  if (pkg.private) info(at("private: true（只能走 git/index 安装，不能走 npm registry；本仓库是 git 源，OK）"));

  // engines.dsh：必须存在、且带区间上界（否则宿主 0.3 仍会被判定兼容）
  const dshRange = pkg.engines?.dsh;
  if (!dshRange) fail(at("缺 engines.dsh"));
  else if (!/[<>]/.test(dshRange)) fail(at(`engines.dsh 没有区间上界（${dshRange}）`));
  else if (!/<0\.3\.0/.test(dshRange)) info(at(`engines.dsh 上界不是 0.3（${dshRange}），确认是有意的`));

  // bundle 与 client 半
  const patch = pkg.dsh?.bundle?.patch ?? pkg.dsh?.bundle;
  if (typeof patch !== "string" || !existsSync(join(root, `plugins/${dir}`, patch)))
    fail(at("dsh.bundle.patch 缺失或指向不存在的文件"));
  if (pkg.dsh?.client) {
    const exp = pkg.exports?.["./client"];
    const target = typeof exp === "string" ? exp : exp?.import ?? exp?.default;
    if (!target) fail(at('声明了 dsh.client 但 exports["./client"] 缺失'));
    else if (!existsSync(join(root, `plugins/${dir}`, target)))
      fail(at(`exports["./client"] 指向不存在的文件（${target}）`));
  }

  // files 里必须真的带上运行所需产物
  if (Array.isArray(pkg.files)) {
    const f = new Set(pkg.files);
    for (const need of ["index.js", "cordis.patch.yml"]) if (!f.has(need)) fail(at(`files 未包含 ${need}`));
    if (pkg.dsh?.client && !f.has("client.js")) fail(at("files 未包含 client.js"));
  }
}

// --- 2. index.json 与包对得上 -------------------------------------------------
if (index.format !== 1) fail(`index.json: format 应为 1（当前 ${index.format}）`);
for (const [name, { rel, pkg }] of manifests) {
  if (!byName.has(name)) {
    fail(`index.json: 缺少插件 ${name}（${rel} 存在但没有索引条目）`);
    continue;
  }
  const entry = byName.get(name);
  const titleEn = typeof entry.title === "string" ? entry.title : entry.title?.en;
  if (!titleEn) fail(`index.json: ${name} 缺英文 title`);
  if (!entry.versions?.length) fail(`index.json: ${name} 没有任何 version`);

  for (const v of entry.versions ?? []) {
    const path = (v.source?.path ?? "").replace(/^\.?\//, "");
    if (!v.engines?.dsh) fail(`index.json: ${name} ${v.version} 缺 engines.dsh`);
    if (!/^[0-9a-f]{40}$/.test(v.source?.commit ?? "")) fail(`index.json: ${name} ${v.version} commit 不是 40 位 sha`);
    if (!path) continue;
    if (!hasHistory) continue; // 浅克隆/无 git：跳过以 commit 为准的一致性校验
    const raw = git(["show", `${v.source.commit}:${path}/package.json`]);
    if (raw === null) {
      fail(`index.json: ${name} ${v.version} 的 commit 里没有 ${path}/package.json`);
      continue;
    }
    const at = JSON.parse(raw);
    if (at.version !== v.version) fail(`index.json: ${name} ${v.version} 与 commit 里的版本 ${at.version} 不一致`);
    // 历史版本改不动：只有「最新已发布版本」必须与包内声明一致，旧版本给 info
    const isLatest = v === latestVersionOf(entry);
    if (at.engines?.dsh !== v.engines.dsh) {
      const msg = `index.json: ${name} ${v.version} engines.dsh (${v.engines.dsh}) ≠ 包内声明 (${at.engines?.dsh})`;
      if (isLatest) fail(msg); else info(`${msg}（历史版本，不阻断）`);
    }
  }

  // 工作区版本领先于已发布版本 → 提醒还没发版
  const latest = latestVersionOf(entry);
  if (latest && latest.version !== pkg.version) info(`index.json: ${name} 已发布 ${latest.version}，工作区是 ${pkg.version}（未发版）`);
}

// index 里有、仓库里没有的条目
for (const [name, entry] of byName) {
  if (!manifests.has(name)) {
    const path = (entry.versions?.[0]?.source?.path ?? "").replace(/^\.?\//, "");
    if (path && !existsSync(join(root, path, "package.json"))) fail(`index.json: ${name} 的 source.path ${path} 在仓库里不存在`);
  }
}

// --- 3. 报告 -----------------------------------------------------------------
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: fails.length === 0, fails, notes, plugins: dirs.length, indexPlugins: byName.size }, null, 2));
} else {
  for (const n of notes) console.log(n);
  if (fails.length) {
    console.error(`\n${fails.length} 项失败:`);
    for (const f of fails) console.error(f);
    process.exit(1);
  }
  console.log(`\n清单体检通过：${dirs.length} 个包 / ${byName.size} 条索引`);
}
if (fails.length) process.exit(1);
