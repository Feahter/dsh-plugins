/**
 * Shared pure helpers for skills-360: token estimation, trigger lexicons,
 * description similarity, section splitting and small text utilities.
 */

/** Count Code Points for CJK-ish scripts. */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

/**
 * Rough token estimate. CJK ideographs/kana/hangul are ~1 token each; the
 * remaining text averages ~4 characters per token. Deliberately simple and
 * stable — the report labels it an estimate.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const rest = Math.max(0, text.length - cjk);
  return Math.ceil(cjk + rest / 4);
}

/** Count CJK code points. */
export function cjkCount(text) {
  return (text && text.match(CJK_RE) || []).length;
}

/** Fraction of characters that are CJK. */
export function cjkRatio(text) {
  if (!text) return 0;
  return cjkCount(text) / text.length;
}

/** True when the text should use Chinese UI copy. */
export function prefersChinese(text) {
  return cjkRatio(text) >= 0.15;
}

// Bounded memo tables for the pure text helpers below. The conflict detector,
// the similarity model and the scorers all re-visit the same descriptions and
// body slices; caching by input string removes the repeated regex work while
// keeping the returned values byte-identical.
const MEMO_MAX_ENTRIES = 500;
const normalizeCache = new Map();
const overlapTokenCache = new Map();

function memoPut(cache, key, value) {
  if (cache.size >= MEMO_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

/** Lower-case, collapse whitespace, strip a UTF-8 BOM. */
export function normalizeText(text) {
  const key = String(text || '');
  const cached = normalizeCache.get(key);
  if (cached !== undefined) return cached;
  return memoPut(normalizeCache, key, key.replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim());
}

/** Deterministic, filesystem-safe slug. CJK titles fall back to a short hash. */
export function slugify(text, fallback = 'section') {
  const ascii = String(text || '')
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (ascii.length >= 2) return ascii;
  let hash = 2166136261;
  for (const ch of String(text || '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${fallback}-${(hash >>> 0).toString(36).slice(0, 6)}`;
}

/** Jaccard similarity of two Sets/arrays of strings. */
export function jaccard(a, b) {
  const left = a instanceof Set ? a : new Set(a || []);
  const right = b instanceof Set ? b : new Set(b || []);
  if (left.size === 0 && right.size === 0) return 0;
  let inter = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) inter += 1;
  return inter / (left.size + right.size - inter);
}

const LATIN_STOP = new Set([
  'the', 'and', 'for', 'with', 'when', 'use', 'uses', 'used', 'using', 'this', 'that', 'these', 'those',
  'you', 'your', 'are', 'can', 'will', 'from', 'into', 'skill', 'skills', 'task', 'tasks', 'also',
  'user', 'users', 'should', 'must', 'may', 'not', 'but', 'has', 'have', 'its', 'any', 'all', 'via',
  'one', 'two', 'more', 'than', 'then', 'there', 'here', 'what', 'which', 'who', 'how', 'why',
]);

const TRIGGER_LEXICON = [
  // English routing language
  'use when', 'use this skill', 'use this when', 'use it when', 'when the user', 'when you',
  'triggers on', 'trigger when', 'trigger', 'for tasks', 'workflow', 'review', 'debug', 'design',
  'write', 'create', 'analyze', 'analyse', 'test', 'refactor', 'deploy', 'migrate', 'audit',
  'optimize', 'optimise', 'generate', 'compare', 'plan', 'research', 'document', 'diagram',
  'slide', 'paper', 'code', 'api', 'ui', 'data', 'security', 'performance', 'commit', 'release',
  'install', 'configure', 'troubleshoot', 'parse', 'revise', 'revision', 'citation', 'format',
  'inspect', 'convert', 'edit', 'validate', 'summarize', 'translate', 'extract', 'visualize',
  'orchestrate', 'coordinate', 'rewrite', 'proofread', 'transcribe', 'render', 'calculate',
  'load to choose', 'load when', 'used when', 'call this skill', 'invoke this skill', '触发场景', '时使用',
  // Chinese routing language
  '当用户', '使用时', '适用于', '触发', '用于', '帮我', '写', '做', '生成', '分析', '审查', '评审',
  '排查', '修复', '优化', '设计', '规划', '调研', '测试', '部署', '迁移', '重构', '审计', '对比',
  '总结', '文档', '论文', '引用', '图表', '幻灯片', '代码', '接口', '数据', '安全', '性能', '提交',
  '发布', '安装', '配置', '排错',
];

const TRIGGER_PHRASE_RE = /(use\s+(?:this\s+skill\s+|it\s+)?when\b|use\s+when\b|use\s+this\s+skill\b|when\s+the\s+user\b|when\s+you\b|triggers?\s*(?:on|when)\b|triggers?\s*[:：]|load\s+(?:it\s+)?to\s+(?:choose|pick|route|dispatch)\b|load\s+when\b|used\s+when\b|call\s+(?:this\s+|the\s+)?skill\b|invoke\s+(?:this\s+|the\s+)?skill\b|触发(?:场景)?\s*[:：]|时使用|当用户|使用(?:本技能|该技能)?时|适用于|触发\s*[:：]|用于|调用(?:本|该)?技能)/i;

/** Index of the first routing-trigger phrase, or -1. Bare "trigger" as a
 * noun must NOT count; only "trigger:" / "triggers when/on" do. */
export function triggerPhraseIndex(text) {
  const match = TRIGGER_PHRASE_RE.exec(String(text || ''));
  return match ? match.index : -1;
}

const GENERIC_OPENERS = [
  /^this\s+skill\b/i, /^a\s+skill\s+for\b/i, /^helps?\s+you\b/i, /^an?\s+agent\s+skill\b/i,
  /^本技能(?:\s*用于|\s*是)/, /^该技能(?:\s*用于|\s*是)/, /^一个用于/, /^此技能/,
];

/** Whether the description contains a routing trigger phrase. */
export function hasTriggerPhrase(description) {
  return triggerPhraseIndex(description) >= 0;
}

/** Openers that spend catalog space without helping routing. */
export function isGenericOpener(description) {
  return GENERIC_OPENERS.some((re) => re.test((description || '').trim()));
}

/**
 * Distinct trigger terms found in a description. Quoted phrases and
 * `/command` tokens count as one term each; lexicon hits are de-duplicated.
 * @param {string} description
 * @returns {Set<string>}
 */
export function triggerTerms(description) {
  const text = normalizeText(description).toLowerCase();
  const found = new Set();
  if (!text) return found;
  for (const match of text.matchAll(/["“”'']([^"“”'']{2,40})["“”'']/g)) found.add(match[1].trim());
  for (const match of text.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9-]{1,40})/g)) found.add('/' + match[1]);
  for (const term of TRIGGER_LEXICON) {
    if (term.includes(' ')) {
      if (text.includes(term)) found.add(term);
    } else if (/[\u4e00-\u9fff]/.test(term)) {
      if (text.includes(term)) found.add(term);
    } else {
      const re = new RegExp(`(?:^|[^a-z0-9_-])${term}(?:[^a-z0-9_-]|$)`, 'i');
      if (re.test(text)) found.add(term);
    }
  }
  return found;
}

/**
 * Similarity-oriented token set: quoted phrases, Latin words (≥3 chars, no
 * stopwords), CJK bigrams. Used for overlap detection rather than scoring
 * trigger density. The returned Set is cached, so callers must treat it as
 * read-only.
 * @param {string} text
 * @returns {Set<string>}
 */
export function overlapTokens(text) {
  const key = String(text || '');
  const cached = overlapTokenCache.get(key);
  if (cached !== undefined) return cached;
  const normalized = normalizeText(key).toLowerCase();
  const tokens = new Set();
  if (normalized) {
    for (const match of normalized.matchAll(/["“”'']([^"“”'']{2,40})["“”'']/g)) tokens.add('q:' + match[1].trim());
    for (const match of normalized.matchAll(/[a-z][a-z0-9_-]{2,}/g)) {
      if (!LATIN_STOP.has(match[0])) tokens.add(match[0]);
    }
    const cjkRuns = normalized.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) || [];
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length - 1; i += 1) tokens.add('c:' + run.slice(i, i + 2));
    }
  }
  return memoPut(overlapTokenCache, key, tokens);
}

/** Character trigram set, punctuation and whitespace removed. */
export function trigrams(text) {
  const cleaned = normalizeText(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const grams = new Set();
  if (cleaned.length < 3) {
    if (cleaned) grams.add(cleaned);
    return grams;
  }
  const step = cleaned.length > 900 ? Math.ceil(cleaned.length / 900) : 1;
  for (let i = 0; i + 3 <= cleaned.length; i += step) grams.add(cleaned.slice(i, i + 3));
  return grams;
}

/**
 * Description overlap: 60% routing-token Jaccard + 40% character-trigram
 * Jaccard. Returns 0..1.
 * @param {string} a
 * @param {string} b
 */
export function descriptionOverlap(a, b) {
  const tokenScore = jaccard(overlapTokens(a), overlapTokens(b));
  const trigramScore = jaccard(trigrams(a), trigrams(b));
  return Math.round((0.6 * tokenScore + 0.4 * trigramScore) * 1000) / 1000;
}

/** Shared tokens for the UI's "why these overlap" hint (up to 6). */
export function sharedOverlapTerms(a, b) {
  const left = overlapTokens(a);
  const right = overlapTokens(b);
  const shared = [];
  for (const token of left) {
    if (right.has(token)) shared.push(token.replace(/^[qc]:/, ''));
    if (shared.length >= 6) break;
  }
  return shared;
}

/**
 * Split a Markdown body into H2 sections, ignoring headings inside fenced
 * code. Each section keeps its heading line and runs until the next heading
 * of level ≤ 2 (or EOF).
 * @param {string} body
 * @returns {{title:string,startLine:number,endLine:number,lines:number,text:string}[]}
 */
export function findSections(body) {
  const lines = String(body || '').split('\n');
  const sections = [];
  let fence = false;
  let current = null;
  let h1 = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const level = heading[1].length;
    if (level === 1) h1 += 1;
    if (level <= 2) {
      if (current) {
        current.endLine = i; // exclusive (next heading line index)
        current.lines = current.endLine - current.startLine;
        current.text = lines.slice(current.startLine, current.endLine).join('\n').replace(/\s+$/, '');
        if (current.lines > 0) sections.push(current);
      }
      current = level === 2
        ? { title: heading[2].trim(), startLine: i, endLine: lines.length, lines: 0, text: '' }
        : null;
    }
  }
  if (current) {
    current.endLine = lines.length;
    current.lines = current.endLine - current.startLine;
    current.text = lines.slice(current.startLine, current.endLine).join('\n').replace(/\s+$/, '');
    if (current.lines > 0) sections.push(current);
  }
  return { sections, hasH1: h1 > 0 };
}

const REFERENCE_TITLE_RE = /reference|appendix|api|example|examples|troubleshoot|checklist|template|glossary|faq|参考|附录|示例|例子|清单|排错|模板|详细|规范|字段|参数/i;

/**
 * Candidate H2 sections that can be moved into references/. Reference-like
 * headings only, at least 60 lines, largest first, max 3.
 * @param {string} body
 * @returns {{title:string,startLine:number,endLine:number,lines:number,text:string}[]}
 */
export function findReferenceSections(body) {
  const { sections } = findSections(body);
  return sections
    .filter((section) => section.lines >= 60 && REFERENCE_TITLE_RE.test(section.title))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 3);
}

/** Replace a section (by start line index and line count) inside a body. */
export function replaceSection(body, section, replacement) {
  const lines = String(body).split('\n');
  const next = [
    ...lines.slice(0, section.startLine),
    ...replacement.split('\n'),
    ...lines.slice(section.endLine),
  ];
  return next.join('\n');
}

/** Stable, readable backup id: 20261109-201500-a1b2. */
export function timestampId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Round to one decimal place. */
export function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Clamp an integer into [min, max]. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Deduplicate an array, preserving order. */
export function unique(array) {
  return [...new Set(array)];
}

/** First sentence (or first 160 chars) for evidence excerpts. */
export function excerpt(text, max = 160) {
  const normalized = normalizeText(text);
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1) + '…';
}

/** Format an epoch ms as YYYY-MM-DD (local). */
export function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
