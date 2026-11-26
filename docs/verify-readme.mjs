#!/usr/bin/env node
// Verifies the README pair, llms.txt and index.json stay internally consistent.
// Run from the repository root: node docs/verify-readme.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const notes = [];
const ok = (m) => notes.push(`ok   ${m}`);
const bad = (m) => fails.push(`FAIL ${m}`);
const read = (p) => readFileSync(join(root, p), "utf8");

// --- GitHub heading slug -----------------------------------------------------
function slug(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // links -> label
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")          // keep letters, digits, space, _ -
    .trim()
    .replace(/ /g, "-");
}

function headings(md) {
  const out = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], slug: slug(m[2]) });
  }
  return out;
}

// --- relative link + anchor check -------------------------------------------
function checkLinks(file) {
  const md = read(file);
  const hs = headings(md);
  const slugs = new Set(hs.map((h) => h.slug));
  const seen = new Set();
  const re = /\]\(([^)\s]+)\)/g;
  let m;
  let checked = 0;
  while ((m = re.exec(md))) {
    const raw = m[1];
    if (/^(https?:|mailto:|#)/.test(raw)) {
      if (raw.startsWith("#")) {
        const frag = decodeURIComponent(raw.slice(1));
        checked++;
        if (!slugs.has(frag)) bad(`${file}: 锚点不存在 -> ${raw}`);
      }
      continue;
    }
    const [pathPart, frag] = raw.split("#");
    if (!pathPart) continue;
    checked++;
    if (seen.has(pathPart)) continue;
    seen.add(pathPart);
    const target = resolve(root, pathPart.replace(/^\.\//, ""));
    if (!target.startsWith(root)) { bad(`${file}: 链接越出仓库 -> ${raw}`); continue; }
    if (!existsSync(target)) { bad(`${file}: 目标不存在 -> ${raw}`); continue; }
    if (frag && statSync(target).isFile() && target.endsWith(".md")) {
      const sub = new Set(headings(readFileSync(target, "utf8")).map((h) => h.slug));
      if (!sub.has(frag)) bad(`${file}: 跨文件锚点不存在 -> ${raw}`);
    }
  }
  ok(`${file}: ${checked} 个本地链接全部命中`);
  return { md, hs };
}

const en = checkLinks("README.md");
const zh = checkLinks("README.zh-CN.md");
checkLinks("llms.txt");

// --- external links present -------------------------------------------------
const external = [...en.md.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((x) => x[1]);
ok(`README.md: ${external.length} 个外部链接（可达性由 curl 单独检查）`);

// --- index.json -------------------------------------------------------------
const index = JSON.parse(read("index.json"));
const entries = index.plugins ?? index.packages ?? [];
// 期望值取自 plugins/ 下带 package.json 的目录，新增插件不必再改这个脚本
const pluginDirCount = readdirSync(join(root, "plugins"), { withFileTypes: true }).filter(
  (d) => d.isDirectory() && existsSync(join(root, "plugins", d.name, "package.json")),
).length;
if (!Array.isArray(entries) || entries.length !== pluginDirCount)
  bad(`index.json: 期望 ${pluginDirCount} 个插件（plugins/ 下的目录数），实际 ${Array.isArray(entries) ? entries.length : "非数组"}`);
else ok(`index.json: ${entries.length} 个插件`);

const pluginDirs = entries.map((e) => {
  const p = e.source?.path?.replace(/^\.?\//, "") ??
    (e.versions?.[0]?.source?.path ?? "").replace(/^\.?\//, "");
  return p;
});
const names = [];
for (const e of entries) {
  const t = e.title;
  const titleEn = typeof t === "string" ? t : t?.en;
  if (!titleEn) bad(`index.json: ${e.name} 缺英文 title`);
  if (t && typeof t === "object" && !t.zh) bad(`index.json: ${e.name} 缺中文 title`);
  const d = e.description;
  if (d && typeof d === "object" && (!d.en || !d.zh))
    bad(`index.json: ${e.name} 的 description 不是双语`);
  const versions = e.versions ?? [];
  if (!versions.length) bad(`index.json: ${e.name} 没有任何 version`);
  for (const v of versions) {
    if (v?.engines?.dsh == null) bad(`index.json: ${e.name} ${v?.version} 缺 engines.dsh`);
    if (!/^[0-9a-f]{40}$/.test(v?.source?.commit ?? ""))
      bad(`index.json: ${e.name} ${v?.version} 的 commit 不是 40 位 sha（${v?.source?.commit}）`);
    const p = v?.source?.path?.replace(/^\.?\//, "");
    if (!p) bad(`index.json: ${e.name} ${v?.version} 缺 source.path`);
    else if (!existsSync(join(root, p, "package.json")))
      bad(`index.json: ${e.name} ${v?.version} 的目录 ${p} 没有 package.json`);
  }
  // 最新版本 = publishTimestamp 最大的那条，且必须与 package.json 的版本一致
  const ver = versions.slice().sort((a, b) => (b.publishTimestamp ?? 0) - (a.publishTimestamp ?? 0))[0];
  const path = ver?.source?.path?.replace(/^\.?\//, "");
  if (path) {
    const pkg = JSON.parse(readFileSync(join(root, path, "package.json"), "utf8"));
    if (pkg.version !== ver.version)
      bad(`index.json: ${e.name} 最新版本 ${ver.version} ≠ package.json ${pkg.version}`);
  }
  names.push(path.replace(/^plugins\//, ""));
}

// --- 每个已发版本都能在 git 里落到真实提交，且该提交处 package.json 版本对得上 ---
// 防的是「索引写了 0.4.0、指到的 commit 里还是 0.3.9」这类发版事故。
{
  const git = (args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const shallow = git(["rev-parse", "--is-shallow-repository"]);
  if (shallow === null) {
    notes.push("info 不在 git 仓库里，跳过版本提交校验");
  } else if (shallow === "true") {
    notes.push("info 浅克隆，跳过历史版本提交校验（最新版本仍校验）");
  } else {
    let checked = 0;
    for (const e of entries) {
      for (const v of e.versions ?? []) {
        const c = v?.source?.commit ?? "";
        const p = (v?.source?.path ?? "").replace(/^\.?\//, "");
        if (!/^[0-9a-f]{40}$/.test(c) || !p) continue;
        const type = git(["cat-file", "-t", c]);
        if (type !== "commit") {
          bad(`index.json: ${e.name} ${v.version} 指向的 commit ${c.slice(0, 7)} 不在仓库里`);
          continue;
        }
        const raw = git(["show", `${c}:${p}/package.json`]);
        if (raw === null) {
          bad(`index.json: ${e.name} ${v.version} 指向的 commit 里没有 ${p}/package.json`);
          continue;
        }
        const atCommit = JSON.parse(raw).version;
        if (atCommit !== v.version)
          bad(`index.json: ${e.name} ${v.version} 指向的 commit 里 package.json 是 ${atCommit}`);
        checked++;
      }
    }
    ok(`index.json: ${checked} 个历史版本都能在 git 里对上 package.json`);
  }
}

// --- 十个插件在中英 README 与 llms.txt 里都出现 --------------------------------
const surfaces = {
  "README.md": en.md,
  "README.zh-CN.md": zh.md,
  "llms.txt": read("llms.txt"),
};
for (const [file, text] of Object.entries(surfaces)) {
  for (const n of names) {
    if (!text.includes(`plugins/${n}`)) bad(`${file}: 未提及 plugins/${n}`);
  }
}

// --- 目录表行数 == 插件数（中英两版） ----------------------------------------
for (const [file, md] of [["README.md", en.md], ["README.zh-CN.md", zh.md]]) {
  const rows = md
    .split("\n")
    .filter((l) => /^\|\s*\[.*\]\(\.\/plugins\/[^)]+\)\s*\|/.test(l)).length;
  if (rows < names.length)
    bad(`${file}: 目录/意图表里只出现了 ${rows} 次插件链接，少于 ${names.length}`);
  else ok(`${file}: 插件链接行 ${rows} 条`);
}

// --- 语言互链 ---------------------------------------------------------------
if (!/\[简体中文\]\(README\.zh-CN\.md\)/.test(en.md))
  bad("README.md: 缺少指向 README.zh-CN.md 的中文切换");
if (!/\[English\]\(README\.md\)/.test(zh.md))
  bad("README.zh-CN.md: 缺少指向 README.md 的英文切换");
if (en.hs.length !== zh.hs.length)
  notes.push(`info README.md 有 ${en.hs.length} 个标题，README.zh-CN.md 有 ${zh.hs.length} 个`);

// --- 落地页 docs/index.html（GitHub Pages，SEO/GEO 入口）--------------------
const LANDING = "docs/index.html";
const SITE = "https://feahter.github.io/dsh-plugins/";
if (!existsSync(join(root, LANDING))) {
  bad(`${LANDING}: 缺落地页（GitHub Pages 源）`);
} else {
  const html = read(LANDING);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  // 每个插件一个 <section id="<目录名>">，与 index.json 的插件目录一一对应
  const missing = names.filter((n) => !new RegExp(`<section[^>]+id="${n}"`).test(html));
  if (missing.length) bad(`${LANDING}: 缺插件锚点 ${missing.join(", ")}`);
  else ok(`${LANDING}: ${names.length} 个插件锚点齐全`);

  // 每节的版本号必须等于 index.json 的最新版本（防止落地页挂着旧版本）
  const latestByDir = new Map();
  for (const e of entries) {
    const v = (e.versions ?? []).slice().sort((a, b) => (b.publishTimestamp ?? 0) - (a.publishTimestamp ?? 0))[0];
    const d = (v?.source?.path ?? "").replace(/^\.?\//, "").replace(/^plugins\//, "");
    if (d && v?.version) latestByDir.set(d, v.version);
  }
  const staleVersions = [];
  for (const [dir, version] of latestByDir) {
    const sec = html.split(new RegExp(`<section[^>]+id="${dir}"`))[1]?.split("</section>")[0] ?? "";
    if (!sec.includes(`<code>${version}</code>`)) staleVersions.push(`${dir} ≠ ${version}`);
  }
  if (staleVersions.length) bad(`${LANDING}: 版本号与 index.json 不一致 ${staleVersions.join(", ")}`);
  else ok(`${LANDING}: ${latestByDir.size} 个插件版本号与 index.json 一致`);

  // 页内锚点必须全部能解析
  const broken = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))].filter(
    (a) => !ids.has(a),
  );
  if (broken.length) bad(`${LANDING}: 页内锚点解析不到 ${broken.join(", ")}`);
  else ok(`${LANDING}: 页内锚点全部可解析`);

  // 结构化数据：三段 JSON-LD 必须可解析，且含 SoftwareApplication / ItemList / FAQPage
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  const types = [];
  for (const [i, raw] of lds.entries()) {
    try {
      types.push(JSON.parse(raw)["@type"]);
    } catch {
      bad(`${LANDING}: 第 ${i + 1} 段 JSON-LD 不是合法 JSON`);
    }
  }
  for (const t of ["SoftwareApplication", "ItemList", "FAQPage"]) {
    if (!types.includes(t)) bad(`${LANDING}: 缺 JSON-LD @type ${t}（现有 ${types.join(", ")}）`);
  }
  if (types.includes("ItemList") && types.includes("FAQPage")) ok(`${LANDING}: JSON-LD ${types.join(" + ")}`);

  // ItemList 的条目数必须等于插件数
  if (types.includes("ItemList")) {
    const list = lds.map((x) => JSON.parse(x)).find((x) => x["@type"] === "ItemList");
    const n = list?.itemListElement?.length ?? 0;
    if (n !== names.length) bad(`${LANDING}: ItemList 有 ${n} 条，插件数是 ${names.length}`);
    else ok(`${LANDING}: ItemList ${n} 条`);
  }

  // FAQPage 至少 8 问，且问答与可见 FAQ 段落同数
  if (types.includes("FAQPage")) {
    const faq = lds.map((x) => JSON.parse(x)).find((x) => x["@type"] === "FAQPage");
    const qs = faq?.mainEntity?.length ?? 0;
    const visible = (html.match(/<h3[^>]*>/g) ?? []).length;
    if (qs < 8) bad(`${LANDING}: FAQPage 只有 ${qs} 问（要求 ≥ 8）`);
    else if (visible < qs) bad(`${LANDING}: FAQPage 有 ${qs} 问，页面上只有 ${visible} 个 <h3> 问答标题`);
    else ok(`${LANDING}: FAQPage ${qs} 问`);
  }

  // 规范 URL、description、语言
  if (!html.includes(`<link rel="canonical" href="${SITE}">`)) bad(`${LANDING}: 缺 canonical ${SITE}`);
  else ok(`${LANDING}: canonical 指向 ${SITE}`);
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) ?? [])[1] ?? "";
  if (desc.length < 70 || desc.length > 200)
    bad(`${LANDING}: meta description 长度 ${desc.length}（要求 70–200 字符）`);
  else ok(`${LANDING}: meta description ${desc.length} 字符`);
  if (!/<html[^>]+lang="en"/.test(html)) bad(`${LANDING}: <html> 缺 lang="en"`);

  // 社交卡片：docs/og.png 必须是 1280×630 且被 head 引用
  const ogPath = join(root, "docs/og.png");
  if (!existsSync(ogPath)) bad("docs/og.png: 缺社交预览图（1280×630）");
  else {
    const head = readFileSync(ogPath).subarray(16, 24);
    const w = head.readUInt32BE(0);
    const h = head.readUInt32BE(4);
    if (w !== 1280 || h !== 630) bad(`docs/og.png: 尺寸 ${w}×${h}，要求 1280×630`);
    else if (!html.includes('content="' + SITE + 'og.png"')) bad("docs/index.html: head 没引用 og.png");
    else ok("docs/og.png: 1280×630 且被 og:image 引用");
  }

  // 纯静态：不允许外部 js / css / 字体（爬虫与离线都受影响）
  const extAssets = [
    ...html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g),
    ...html.matchAll(/<link[^>]+rel="(?:stylesheet|preload|prefetch|icon|apple-touch-icon)"[^>]*href="(https?:[^"]+)"/g),
  ].map((m) => m[1]);
  if (extAssets.length) bad(`${LANDING}: 引用了外部资源 ${extAssets.slice(0, 3).join(", ")}`);
  else ok(`${LANDING}: 无外部 js/css 资源`);
}

// --- robots.txt / sitemap.xml ------------------------------------------------
for (const f of ["docs/robots.txt", "docs/sitemap.xml"]) {
  if (!existsSync(join(root, f))) bad(`${f}: 缺文件`);
}
if (existsSync(join(root, "docs/sitemap.xml"))) {
  const sm = read("docs/sitemap.xml");
  if (!sm.includes(`<loc>${SITE}</loc>`)) bad("docs/sitemap.xml: 没列出规范 URL " + SITE);
  else ok("docs/sitemap.xml: 列出规范 URL");
}
if (existsSync(join(root, "docs/robots.txt"))) {
  const rb = read("docs/robots.txt");
  if (!rb.includes(`Sitemap: ${SITE}sitemap.xml`)) bad("docs/robots.txt: 缺 Sitemap 行");
  else ok("docs/robots.txt: 指向 sitemap.xml");
}

// --- CITATION.cff 与 README 互相指认 ----------------------------------------
if (!existsSync(join(root, "CITATION.cff"))) bad("CITATION.cff: 缺文件");
else if (!/CITATION\.cff/.test(en.md) || !/CITATION\.cff/.test(zh.md))
  bad("CITATION.cff: 两份 README 都没有链到它");
else ok("CITATION.cff: 存在且被两份 README 引用");

// --- report -----------------------------------------------------------------
for (const n of notes) console.log(n);
if (fails.length) {
  console.error(`\n${fails.length} 项失败:`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("\n全部通过");
