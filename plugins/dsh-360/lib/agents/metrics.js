/**
 * Pure metric extraction for one subject body (instruction / agent / preset).
 * No filesystem access: `files` is the subject directory's file index (relative
 * paths + chars), passed by the host, so link resolution stays deterministic.
 *
 * Output shape is INTERFACE.md §2.1 `metrics`:
 *   chars, estTokens, lines, headings, h2, bullets, numberedSteps, commands,
 *   imperativeCount, codeBlocks, codeLines, maxCodeBlockLines, codeRatio,
 *   sections[], localLinks[], staleRefs[], dupSentences[], builtinOverlap,
 *   todos, secrets, dangerous, bakFiles, frontmatter.
 */
import { estimateTokens } from '../util.js';

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'cmd', 'bat', 'powershell', 'ps1', 'fish']);
const IMPERATIVE_RE = /(必须|不要|禁止|只用|先[^，。\n]{0,20}再|always|never|must|should|avoid|don'?t\s+use)/i;
const TODO_RE = /\b(TODO|TBD|FIXME|XXX)\b\s*[:：]|待补充|待完善|待填写|尚未完成/gi;
const SECRET_RES = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /BEGIN [A-Z ]*PRIVATE KEY/g,
];
const DANGEROUS_RES = [
  /curl[^\n|]*\|\s*(?:ba|z)?sh\b/g,
  /wget[^\n|]*\|\s*(?:ba|z)?sh\b/g,
  /rm\s+-rf\s+\/(?:\s|$)/g,
  /chmod\s+777/g,
  /:\(\)\s*\{\s*:\|:&\s*\};:/g,
];
const COMMAND_LINE_RE = /(^|\s)(npm\s+(test|run|install)|node\s+(test|--test)|pnpm\s+(test|run)|curl\s|git\s+(clone|commit|push|pull|diff)|python3?\s)/i;
const NUMBERED_STEP_RE = /^\s*\d{1,2}[.)]\s+\S/;
const BULLET_RE = /^\s*[-*+]\s+\S/;
const SECTION_KIND_RES = [
  [/workflow|process|procedure|steps?|工作流|流程|步骤|操作/i, 'workflow'],
  [/reference|api|example|examples|troubleshoot|checklist|template|glossary|faq|参考|附录|示例|清单|排错|模板|详细|字段|参数|规范/i, 'ref'],
  [/index|索引|目录|导航|资源|table\s+of\s+contents|overview|概览/i, 'index'],
  [/rule|constraint|boundary|governance|policy|规则|约束|边界|治理|禁止|必须|不适用|职责/i, 'rule'],
];

function stripFences(lines) {
  const outside = [];
  const blocks = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(lines[i]);
    if (!fence && open) {
      fence = { marker: open[1][0], lang: (open[2] || '').toLowerCase(), lines: 0 };
      continue;
    }
    if (fence) {
      if (new RegExp(`^\\s*${fence.marker === '`' ? '```+' : '~~~+'}\\s*$`).test(lines[i])) {
        blocks.push(fence);
        fence = null;
      } else {
        fence.lines += 1;
      }
      continue;
    }
    outside.push({ line: lines[i], index: i });
  }
  if (fence) blocks.push(fence);
  return { outside, blocks };
}

function normalizeHref(href) {
  let value = String(href || '').trim();
  if (/^<.*>$/.test(value)) value = value.slice(1, -1);
  value = value.split('#')[0].split('?')[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep raw
  }
  return value.replace(/^\.\//, '').replace(/^\/+/, '');
}

function sectionKind(title) {
  for (const [re, kind] of SECTION_KIND_RES) if (re.test(title)) return kind;
  return 'meta';
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/** Normalize a sentence for duplicate detection (lower, collapse space, strip trailing punct). */
function normSentence(text) {
  const cleaned = String(text || '')
    .replace(/[`*_>#|\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[。.!！？?；;，,：:]+$/g, '');
  return cleaned;
}

/**
 * @param {{body:string, kind?:string, files?:{path:string,chars?:number}[], description?:string, frontmatter?:object|null}} input
 */
export function extractMetrics({ body, kind = 'instruction', files = [], description = '', frontmatter = null, resolveHref = null }) {
  const text = String(body || '');
  const lines = text.split(/\r?\n/);
  const { outside, blocks } = stripFences(lines);
  const outsideText = outside.map((entry) => entry.line).join('\n');
  const filePaths = new Set((files || []).map((file) => String(file.path || '')));

  const headings = [];
  for (const entry of outside) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(entry.line);
    if (match) headings.push({ level: match[1].length, text: match[2].trim(), line: entry.index + 1 });
  }
  const h2Headings = headings.filter((heading) => heading.level === 2);

  // ------------------------------------------------------------------ sections
  const sections = [];
  let current = null;
  for (const entry of outside) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(entry.line);
    const level = match ? match[1].length : 0;
    if (match && level <= 2) {
      if (current) {
        current.lines = entry.index - current.line + 1;
        current.text = lines.slice(current.line - 1, entry.index).join('\n');
        sections.push(current);
      }
      current = { title: match[2].trim(), line: entry.index + 1, lines: 0, text: '' };
    }
  }
  if (current) {
    current.lines = lines.length - current.line + 1;
    current.text = lines.slice(current.line - 1).join('\n');
    sections.push(current);
  }
  const sectionOut = sections.map((section) => ({
    title: section.title,
    line: section.line,
    lines: section.lines,
    estTokens: estimateTokens(section.text),
    kind: sectionKind(section.title),
  }));

  // ------------------------------------------------------------------ links
  const localLinks = [];
  const staleRefs = [];
  const seenHrefs = new Set();
  for (const entry of outside) {
    for (const match of entry.line.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[2];
      const isUrl = /^(https?:|mailto:|tel:|data:)/i.test(href);
      const isAnchor = href.startsWith('#');
      if (isUrl || isAnchor) continue;
      const normalized = normalizeHref(href);
      if (!normalized) continue;
      const key = `${normalized}\u0000${entry.index + 1}`;
      if (seenHrefs.has(key)) continue;
      seenHrefs.add(key);
      // Resolution order: an injected resolver (host/analyze, knows the subject
      // dir and the real filesystem) > the relative file index > "unknown".
      const resolves = typeof resolveHref === 'function'
        ? Boolean(resolveHref(href))
        : filePaths.has(normalized);
      localLinks.push({ href: normalized, line: entry.index + 1, resolves });
      if (resolves === false) staleRefs.push({ ref: normalized, kind: 'link', line: entry.index + 1 });
    }
    // Inline path references (`~/…`, absolute) that read as file pointers.
    for (const refMatch of entry.line.matchAll(/(?:^|[^\w/])(~\/[A-Za-z0-9_.\-/]+\.(?:md|txt|ya?ml|json)|\/(?:Users|home|etc|usr)\/[A-Za-z0-9_.\-/]+)/g)) {
      const ref = refMatch[1];
      const key = `pathref\u0000${ref}\u0000${entry.index + 1}`;
      if (seenHrefs.has(key)) continue;
      seenHrefs.add(key);
      // Without a resolver we cannot prove absence: only report paths the
      // resolver actually rejected (avoids flagging every absolute path).
      if (typeof resolveHref === 'function' && resolveHref(ref) === false) {
        staleRefs.push({ ref, kind: 'path', line: entry.index + 1 });
      }
    }
  }

  // ------------------------------------------------------------- duplicate sentences
  const sentenceCounts = new Map();
  for (const entry of outside) {
    const raw = entry.line.trim();
    if (!raw || /^\s*(#|```|~~~|[-*+]\s)/.test(raw)) continue;
    const sentence = normSentence(raw);
    if (sentence.length < 8) continue;
    if (!sentenceCounts.has(sentence)) sentenceCounts.set(sentence, []);
    sentenceCounts.get(sentence).push(entry.index + 1);
  }
  const dupSentences = [];
  for (const [textVal, lineList] of sentenceCounts) {
    if (lineList.length >= 2) dupSentences.push({ text: textVal, lines: lineList.slice(0, 4) });
  }

  // ------------------------------------------------------------------ code / commands
  const codeLines = blocks.reduce((sum, block) => sum + block.lines, 0);
  const maxCodeBlockLines = blocks.reduce((max, block) => Math.max(max, block.lines), 0);
  const codeBlocks = blocks.length;
  const codeRatio = lines.length > 0 ? codeLines / lines.length : 0;
  const commandLangs = blocks.filter((block) => SHELL_LANGS.has(block.lang)).length;
  const dollarLines = outside.filter((entry) => /^\s*\$\s+\S/.test(entry.line)).length;
  const commandLines = outside.filter((entry) => COMMAND_LINE_RE.test(entry.line)).length;
  const commands = commandLangs + dollarLines + commandLines;

  const numberedSteps = outside.filter((entry) => NUMBERED_STEP_RE.test(entry.line)).length
    + headings.filter((heading) => /^(?:第\s*\d+\s*步|step\s*\d+)/i.test(heading.text)).length;
  const bullets = outside.filter((entry) => BULLET_RE.test(entry.line)).length;
  const imperativeCount = outside.filter((entry) => IMPERATIVE_RE.test(entry.line)).length;
  const todos = countMatches(outsideText, TODO_RE);
  let secrets = 0;
  for (const re of SECRET_RES) secrets += countMatches(text, re);
  let dangerous = 0;
  for (const re of DANGEROUS_RES) dangerous += countMatches(text, re);
  const bakFiles = (files || []).filter((file) => /\.(bak|bak-[^/]*|old)$/i.test(file.path)).length;

  return {
    chars: text.length,
    estTokens: estimateTokens(text),
    lines: lines.length,
    headings: headings.length,
    h2: h2Headings.length,
    bullets,
    numberedSteps,
    commands,
    imperativeCount,
    codeBlocks,
    codeLines,
    maxCodeBlockLines,
    codeRatio: Math.round(codeRatio * 1000) / 1000,
    sections: sectionOut,
    localLinks,
    staleRefs,
    dupSentences,
    builtinOverlap: 0,
    todos,
    secrets,
    dangerous,
    bakFiles,
    frontmatter: frontmatter && typeof frontmatter === 'object' ? frontmatter : null,
  };
}
