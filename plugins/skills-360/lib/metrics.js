/**
 * Pure metric extraction for one SKILL.md body plus its skill directory file
 * index. No filesystem access: the host passes `files` (relative paths), which
 * keeps scoring deterministic and easy to fixture.
 */
import { estimateTokens, findSections, cjkRatio, prefersChinese } from './util.js';

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'cmd', 'bat', 'powershell', 'ps1', 'fish']);
const EXAMPLE_TITLE_RE = /(^|\n)#{1,6}\s*(examples?|examples?\s+and|input|output|示例|例子|输入|输出)/i;
const EXAMPLE_INLINE_RE = /\bfor example\b|\be\.g\.\b|例如|比如/i;
const WHEN_NOT_HEADING_RE = /when\s*(not|to\s+avoid)|not\s+for|do\s+not\s+use|don'?t\s+use|不适用|何时不用|什么时候不用|不要使用|不用于/i;
const WHEN_NOT_INLINE_RE = /不适用|not\s+for|do\s+not\s+use|don'?t\s+use/i;
const ANTI_PATTERN_RE = /anti[- ]?patterns?|pitfalls?|common\s+mistakes?|反模式|常见错误|不要|禁止|避免/i;
const DECISION_RE = /\bif\b|\bwhen\b|\botherwise\b|\bchoose\b|\bdecide\b|如果|否则|选择|分支/g;
const TODO_RE = /\b(TODO|TBD|FIXME|XXX)\b\s*[:：]|待补充|待完善|待填写|尚未完成/gi;
const SECRET_RES = [
  /sk-[A-Za-z0-9_-]{16,}/g,
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
  /:\(\)\s*\{\s*:\|:&\s*\};:/g, // fork bomb
];

function stripFences(lines) {
  const outside = [];
  const blocks = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(lines[i]);
    if (!fence && open) {
      fence = { marker: open[1][0], lang: (open[2] || '').toLowerCase(), startLine: i + 1, lines: 0 };
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
  if (!value) return '';
  if (/^<.*>$/.test(value)) value = value.slice(1, -1);
  value = value.split('#')[0].split('?')[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep raw
  }
  return value.replace(/^\.\//, '').replace(/^\/+/, '');
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Extract every deterministic metric used by the rubric.
 * @param {{ body: string, files?: {path:string, chars?:number}[], description?: string, catalogDescriptionMaxLength?: number }} input
 */
export function extractMetrics({ body, files = [], description = '', catalogDescriptionMaxLength = 500 }) {
  const text = String(body || '');
  const lines = text.split(/\r?\n/);
  const { outside, blocks } = stripFences(lines);
  const outsideText = outside.map((entry) => entry.line).join('\n');

  const headings = [];
  for (const entry of outside) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(entry.line);
    if (match) headings.push({ level: match[1].length, text: match[2].trim(), line: entry.index + 1 });
  }
  const h2Headings = headings.filter((heading) => heading.level === 2);
  const h2Names = h2Headings.map((heading) => heading.text.toLowerCase());
  const duplicateHeadings = h2Names.length - new Set(h2Names).size;

  const codeLines = blocks.reduce((sum, block) => sum + block.lines, 0);
  const maxCodeBlockLines = blocks.reduce((max, block) => Math.max(max, block.lines), 0);
  const codeBlocks = blocks.length;
  const codeRatio = lines.length > 0 ? codeLines / lines.length : 0;

  const referenceIndex = new Set(
    (files || [])
      .map((file) => file.path)
      .filter((path) => path.startsWith('references/') && !path.split('/').some((part) => part.startsWith('.'))),
  );
  const referenceList = [...referenceIndex].sort().map((path) => ({
    path,
    name: path.slice('references/'.length),
    chars: (files || []).find((file) => file.path === path)?.chars ?? 0,
  }));

  const links = [];
  const localHrefs = new Set();
  for (const entry of outside) {
    for (const match of entry.line.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[2];
      const isUrl = /^(https?:|mailto:|tel:|data:)/i.test(href);
      const isAnchor = href.startsWith('#');
      const normalized = normalizeHref(href);
      // A relative link that climbs out of the skill directory (`../office/...`)
      // cannot be verified from this skill's file index. Treat it as unknown,
      // not broken: sibling bundles legitimately share a parent directory.
      const outsideDir = normalized.startsWith('../') || /^[A-Za-z]:[\\/]/.test(href);
      const exists = isUrl || isAnchor || outsideDir
        ? null
        : normalized === 'SKILL.md'
          || normalized === ''
          || (files || []).some((file) => file.path === normalized);
      if (!isUrl && !isAnchor && normalized && !outsideDir) localHrefs.add(normalized);
      links.push({
        text: match[1],
        href,
        line: entry.index + 1,
        kind: isUrl ? 'url' : isAnchor ? 'anchor' : 'local',
        exists,
      });
    }
  }
  const brokenLinks = links
    .filter((link) => link.kind === 'local' && link.exists === false)
    .map(({ href, text, line }) => ({ href, text, line }));

  const referencedFiles = referenceList.filter((ref) => localHrefs.has(ref.path)).length;
  const orphanReferences = Math.max(0, referenceList.length - referencedFiles);

  const numberedSteps = outside.filter((entry) => /^\s*\d{1,2}[.)]\s+\S/.test(entry.line)).length
    + headings.filter((heading) => /^(?:第\s*\d+\s*步|step\s*\d+)/i.test(heading.text)).length;
  const commandLangs = blocks.filter((block) => SHELL_LANGS.has(block.lang)).length;
  const dollarLines = outside.filter((entry) => /^\s*\$\s+\S/.test(entry.line)).length;
  const commands = commandLangs + dollarLines;

  const hasExamples = EXAMPLE_TITLE_RE.test(outsideText)
    || (blocks.length > 0 && EXAMPLE_INLINE_RE.test(outsideText));
  const hasWhenNotToUseSection = h2Headings.some((heading) => WHEN_NOT_HEADING_RE.test(heading.text));
  const hasWhenNotToUse = hasWhenNotToUseSection || WHEN_NOT_INLINE_RE.test(outsideText);
  const hasWhenNotToUseDescription = WHEN_NOT_INLINE_RE.test(String(description || ''));
  const hasAntiPatterns = h2Headings.some((heading) => ANTI_PATTERN_RE.test(heading.text))
    || (ANTI_PATTERN_RE.test(outsideText) && h2Headings.length > 0);
  const decisionCount = countMatches(outsideText, DECISION_RE);
  const hasDecisionLanguage = decisionCount > 0;

  const todos = countMatches(outsideText, TODO_RE);
  let secrets = 0;
  for (const re of SECRET_RES) secrets += countMatches(text, re);
  let dangerous = 0;
  for (const re of DANGEROUS_RES) dangerous += countMatches(text, re);

  const { sections } = findSections(text);
  const firstH2 = sections.length > 0 ? sections[0].title : '';

  const descriptionChars = String(description || '').length;
  const catalogChars = Math.min(descriptionChars, catalogDescriptionMaxLength);

  return {
    descriptionChars,
    catalogChars,
    catalogTruncated: descriptionChars > catalogDescriptionMaxLength,
    bodyLines: lines.length,
    bodyChars: text.length,
    estTokens: estimateTokens(text),
    headings: headings.length,
    h2: h2Headings.length,
    hasH1: headings.some((heading) => heading.level === 1),
    firstH2,
    sections: sections.map(({ title, startLine, endLine, lines: sectionLines }) => ({ title, startLine, endLine, lines: sectionLines })),
    codeBlocks,
    codeLines,
    maxCodeBlockLines,
    codeRatio: Math.round(codeRatio * 1000) / 1000,
    references: referenceList,
    referenceCount: referenceList.length,
    referencedFiles,
    orphanReferences,
    brokenLinks,
    links: links.slice(0, 200),
    numberedSteps,
    commands,
    hasExamples,
    hasWhenNotToUse,
    hasWhenNotToUseSection,
    hasWhenNotToUseDescription,
    hasAntiPatterns,
    hasDecisionLanguage,
    decisionCount,
    todos,
    secrets,
    dangerous,
    duplicateHeadings,
    totalRefChars: referenceList.reduce((sum, ref) => sum + ref.chars, 0),
    language: prefersChinese(text) ? 'zh' : 'en',
    cjkRatio: Math.round(cjkRatio(text) * 100) / 100,
  };
}
