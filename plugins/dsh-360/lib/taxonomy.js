/**
 * dsh-360 taxonomy — the single source of truth for the four classification
 * axes (role / kind / scope / state) shared by both surfaces.
 *
 * Why this module exists: the only labels the plugin had were `source` and the
 * agent `kind` (`instruction` / `agent` / `preset`). Neither answers the
 * questions users actually ask ("which of these 62 skills are review skills?",
 * "how many orchestration agents are there?") and the UI had no stable Chinese
 * label to render, so it guessed from path strings. Every label the UI shows
 * now comes from here.
 *
 * Contract: TAXONOMY-SPEC.md §2 is binding. Classification is heuristic, not
 * semantic: it is a deterministic keyword score over name + description, and
 * callers must expose `confidence` and `evidence` instead of claiming
 * precision. The module is pure (no I/O, no clock, no randomness), so the same
 * input always produces byte-identical output (TAXONOMY-SPEC §3).
 *
 * @module taxonomy
 */
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

export const TAXONOMY_VERSION = 2;

/**
 * role — 职责. Order is significant: it is the tie-break order used by
 * classifyRole (TAXONOMY-SPEC §2.1, e.g. `review` before `build` so that
 * `code-review` is not classified as coding). `other` has no keywords and is
 * only reachable as the fallback.
 */
export const ROLES = [
  {
    id: 'orchestrate',
    label: '编排调度',
    description: '路由、拆活、多 agent 协作、计划、交接',
    keywords: [
      'orchestrate', 'router', 'routing', 'workflow', 'plan', 'pipeline', 'handoff',
      'intake', 'dispatch', '编排', '调度', '路由', '流程', '计划', '分派',
    ],
  },
  {
    id: 'review',
    label: '审查验证',
    description: '代码/文档/结果审查、对抗、测试、质检',
    keywords: [
      'review', 'reviewer', 'reviewers', 'audit', 'auditor', 'critic', 'critique',
      'verify', 'verifier', 'test', 'quality', 'adversarial', 'grill', 'proof',
      '审查', '评审', '审计', '验证', '测试', '挑错', '对抗', '质检',
    ],
  },
  {
    id: 'research',
    label: '研究分析',
    description: '调研、探索、论文、数据分析',
    keywords: [
      'research', 'researcher', 'researchers', 'analyze', 'analyst', 'analysis', 'explore',
      'scout', 'investigate', 'paper', 'study', 'data', '研究', '分析', '调查', '论文', '数据', '探索',
    ],
  },
  {
    id: 'write',
    label: '写作表达',
    description: '写稿、润色、文案、发布、报告',
    keywords: [
      'write', 'writer', 'draft', 'doc', 'documentation', 'copy', 'voice', 'humanize',
      'publish', 'report', 'summarize', '写作', '撰写', '文档', '文案', '语气', '发布', '报告', '摘要',
    ],
  },
  {
    id: 'design',
    label: '设计呈现',
    description: '视觉、幻灯片、页面、卡片、图表',
    keywords: [
      'design', 'designs', 'designed', 'designing', 'slide', 'slides', 'ppt', 'presentation',
      'page', 'card', 'visual', 'visualization', 'visualisation', 'visualize', 'figure', 'figures',
      'chart', 'charts', 'diagram', 'layout', 'ui', 'ux',
      '设计', '幻灯片', '排版', '页面', '卡片', '可视化', '图表',
    ],
  },
  {
    id: 'build',
    label: '编码实现',
    description: '写码、重构、修 bug、前后端、部署',
    keywords: [
      'code', 'coding', 'implement', 'refactor', 'fix', 'tdd', 'frontend', 'backend',
      'react', 'typescript', 'deploy', 'install', 'migrate', 'performance', 'optimize',
      'optimizer', 'optimization', 'profiling', 'benchmark',
      '实现', '编码', '重构', '修复', '开发', '部署', '性能', '优化',
    ],
  },
  {
    id: 'knowledge',
    label: '知识管理',
    description: '记忆、归档、笔记、经验沉淀、索引',
    keywords: [
      'knowledge', 'memory', 'archive', 'note', 'notes', 'lesson', 'learn', 'index', 'wiki',
      '知识', '记忆', '归档', '笔记', '经验', '索引',
    ],
  },
  {
    id: 'ops',
    label: '运维治理',
    description: '安全、密钥、发布、git、清理、监控',
    keywords: [
      'ops', 'operation', 'security', 'secret', 'release', 'commit', 'git', 'branch',
      'cleanup', 'clean', 'monitor', 'health', '运维', '安全', '发布', '提交', '分支', '清理', '监控', '治理',
    ],
  },
  {
    id: 'utility',
    label: '通用工具',
    description: '格式转换、解析、计算、渲染、导出',
    keywords: [
      'format', 'formats', 'formatted', 'formatting', 'parse', 'convert', 'calculate', 'extract',
      'render', 'export', 'tool', 'utility', 'find', 'office', 'document', 'documents', 'docx',
      'pptx', 'xlsx', 'spreadsheet', 'spreadsheets', 'workbook', 'workbooks', 'word', 'excel',
      'powerpoint', 'pdf', 'recalculate', 'recalc', 'formula', 'formulas',
      '格式', '解析', '转换', '计算', '提取', '渲染', '导出', '工具', '查找',
    ],
  },
  {
    id: 'other',
    label: '其他',
    description: '兜底：名称与描述都没有命中任何职责关键词',
    keywords: [],
  },
];

/** Skills kind — 形态, derived structurally from the report, never from semantics. */
export const SKILL_KINDS = [
  { id: 'layered', label: '分层参考', description: '有 references/**：入口短，细节按需加载' },
  { id: 'scripted', label: '带脚本', description: '有 scripts/**：带可执行脚本' },
  { id: 'routing', label: '路由入口', description: '正文 < 80 行且链接到 ≥2 个其它技能' },
  { id: 'prose', label: '单文件', description: '单文件正文，无 references/scripts' },
];

/** Skills layer — 层级. Meta-skills operate on the agent's own capability
 * (skill catalog, prompts, context, sessions), not on the user's business task. */
export const SKILL_LAYERS = [
  { id: 'meta', label: '元技能', description: '作用于 agent 自身：发现/创建/评估/优化技能、提示词或上下文' },
  { id: 'task', label: '任务技能', description: '直接完成用户的业务任务' },
];

/** Agents kind — 类型, taken from the subject kind. */
export const AGENT_KINDS = [
  { id: 'instruction', label: '常驻说明书', description: 'AGENTS.md / CLAUDE.md / instructions.md 等常驻文件' },
  { id: 'agent', label: '子代理定义', description: 'agents/*.md 子代理定义' },
  { id: 'preset', label: '运行预设', description: 'profile 里的 agent preset 配置' },
];

/** scope — 范围. */
export const SCOPES = [
  { id: 'bundled', label: '内置', description: '随宿主或插件内置发布' },
  { id: 'global', label: '全局', description: '用户级目录（~/.agents、~/.claude、~/.deepseek）' },
  { id: 'project', label: '项目', description: '当前工作目录下的文件' },
  { id: 'skill', label: '技能内', description: '挂在某个技能目录下的子代理定义' },
  { id: 'profile', label: '配置', description: 'profile 配置而非磁盘文件' },
  { id: 'custom', label: '自定义', description: '其它来源（第三方目录等）' },
];

/** state — 状态. Multi-valued badges; one usage state is always present. */
export const STATES = [
  { id: 'active', label: '在用', description: '窗口内有使用/注入证据' },
  { id: 'idle', label: '闲置', description: '证据充分但窗口内 0 次使用' },
  { id: 'unobserved', label: '未观测', description: '使用证据不足，无法判断' },
  { id: 'pending', label: '待沉淀', description: '有加载后信号尚未沉淀成经验' },
  { id: 'overlap', label: '有重叠', description: '与同类最高相似度 ≥ 0.6' },
  { id: 'critical', label: '有严重问题', description: '存在 severity=critical 的发现' },
  { id: 'stale-ref', label: '失效引用', description: '指向不存在的路径或链接（agents）' },
  { id: 'conflict', label: '跨文件冲突', description: '命中跨文件重复/矛盾规则（agents）' },
];

const ROLE_BY_ID = new Map(ROLES.map((role) => [role.id, role]));
const SKILL_KIND_BY_ID = new Map(SKILL_KINDS.map((kind) => [kind.id, kind]));
const LAYER_BY_ID = new Map(SKILL_LAYERS.map((layer) => [layer.id, layer]));
const AGENT_KIND_BY_ID = new Map(AGENT_KINDS.map((kind) => [kind.id, kind]));
const SCOPE_BY_ID = new Map(SCOPES.map((scope) => [scope.id, scope]));
const STATE_BY_ID = new Map(STATES.map((state) => [state.id, state]));

const SUMMARY_MAX = 60;
const MAX_EVIDENCE = 5;

/**
 * Axis labels per surface. One axis id (`kind`) is reused for both surfaces;
 * only its label and value set differ, so the UI can render a union of
 * "分类" chips without special-casing the surface.
 */
const AXIS_LABELS = {
  skills: { role: '职责', layer: '层级', kind: '形态', scope: '范围', state: '状态' },
  agents: { role: '职责', kind: '类型', scope: '范围', state: '状态' },
};

const GLOBAL_DIR_NAMES = ['.agents', '.claude', '.deepseek'];
const ENGLISH_WORD_RE = new Map();

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * English keyword matcher.
 *
 * TAXONOMY-SPEC §2.1 says "英文按词边界". We treat any character outside
 * [A-Za-z0-9] as a boundary, so both `code-review` and `code_review` hit
 * `review` while `coder` / `codex` / `slides` (vs `slide`) do not. Using the
 * regex `\b` would not, because `_` counts as a word character there and the
 * real subject names are snake_case.
 */
function englishHit(text, keyword) {
  if (!text) return false;
  let regex = ENGLISH_WORD_RE.get(keyword);
  if (!regex) {
    regex = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(keyword)}(?![A-Za-z0-9])`, 'i');
    ENGLISH_WORD_RE.set(keyword, regex);
  }
  return regex.test(text);
}

function isCjkKeyword(keyword) {
  return /[\u3400-\u9fff]/.test(keyword);
}

function keywordHit(text, keyword) {
  if (!text) return false;
  return isCjkKeyword(keyword) ? text.includes(keyword) : englishHit(text, keyword);
}

function labelOf(map, id) {
  const value = map.get(id);
  return value ? { id: value.id, label: value.label } : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Classify the role (职责) of a skill or agent from its name and description.
 *
 * Scoring (TAXONOMY-SPEC §2.1), deterministic:
 * - a keyword in `name` scores 3, in `description` scores 1; each keyword is
 *   counted at most once per field, and repeated occurrences never compound;
 * - case-insensitive for English, substring for Chinese, word boundary for
 *   English (see englishHit);
 * - highest score wins; ties keep the ROLES table order;
 * - zero hits → `other` with confidence 0.3;
 * - otherwise `confidence = min(0.95, 0.55 + 0.1 * 命中种类数)` (distinct
 *   keywords across both fields), rounded to 2 decimals;
 * - `evidence` lists the winning role's actual hits (≤5).
 *
 * `body` is accepted for API symmetry (callers already have the full body
 * loaded) but deliberately not scored: §2.1 weights name and description
 * only, and scoring a long body would let incidental mentions outvote the
 * trigger surface that actually decides when the skill loads.
 *
 * @param {{name?:string, description?:string, body?:string}} input
 * @returns {{id:string, label:string, confidence:number, evidence:string[]}}
 */
export function classifyRole(input) {
  const safe = isPlainObject(input) ? input : {};
  const name = safe.name;
  const description = safe.description;
  const body = safe.body;
  void body;
  const nameText = stringValue(name);
  const descriptionText = stringValue(description);

  let winner = null;
  let winnerScore = 0;
  let winnerHits = [];
  for (const role of ROLES) {
    if (role.keywords.length === 0) continue;
    let score = 0;
    const hits = [];
    for (const keyword of role.keywords) {
      const inName = keywordHit(nameText, keyword);
      const inDescription = keywordHit(descriptionText, keyword);
      if (inName) score += 3;
      if (inDescription) score += 1;
      if (inName || inDescription) hits.push(keyword);
    }
    if (score > winnerScore) {
      winner = role;
      winnerScore = score;
      winnerHits = hits;
    }
  }

  if (!winner) {
    return { id: 'other', label: ROLE_BY_ID.get('other').label, confidence: 0.3, evidence: [] };
  }
  return {
    id: winner.id,
    label: winner.label,
    confidence: round2(Math.min(0.95, 0.55 + 0.1 * winnerHits.length)),
    evidence: winnerHits.slice(0, MAX_EVIDENCE),
  };
}

function skillKind(report, hints, bodyText) {
  const metrics = isPlainObject(report.metrics) ? report.metrics : {};
  const references = firstCount(
    hints.referenceCount,
    metrics.referenceCount,
    countFiles(report.files, 'references/'),
  );
  if (references > 0) return labelOf(SKILL_KIND_BY_ID, 'layered');

  const scripts = firstCount(
    hints.scriptCount,
    metrics.scriptCount,
    report.scriptCount,
    countFiles(report.files, 'scripts/'),
  );
  if (scripts > 0) return labelOf(SKILL_KIND_BY_ID, 'scripted');

  const bodyLines = firstCount(
    hints.bodyLines,
    metrics.bodyLines,
    report.bodyLines,
    bodyText ? bodyText.split(/\r?\n/).length : 0,
  );
  const linked = linkedSkillNames(report, hints, bodyText);
  if (bodyLines < 80 && linked.length >= 2) return labelOf(SKILL_KIND_BY_ID, 'routing');

  return labelOf(SKILL_KIND_BY_ID, 'prose');
}

function agentKind(report) {
  const fromReport = labelOf(AGENT_KIND_BY_ID, report.kind);
  if (fromReport) return fromReport;
  if (report.source === 'profile-config' || report.scope === 'profile') return labelOf(AGENT_KIND_BY_ID, 'preset');
  if (report.scope === 'skill') return labelOf(AGENT_KIND_BY_ID, 'agent');
  return labelOf(AGENT_KIND_BY_ID, 'instruction');
}

function firstCount(...values) {
  for (const value of values) {
    const count = Number(value);
    if (Number.isFinite(count) && count > 0) return count;
  }
  return 0;
}

function countFiles(files, prefix) {
  if (!Array.isArray(files)) return 0;
  const seen = new Set();
  for (const file of files) {
    const raw = typeof file === 'string' ? file : isPlainObject(file) ? file.path : '';
    if (typeof raw !== 'string' || raw === '') continue;
    const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized.startsWith(prefix)) continue;
    seen.add(normalized);
  }
  return seen.size;
}

function nameMentioned(text, name) {
  if (!text || !name) return false;
  const regex = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'i');
  return regex.test(text);
}

/**
 * Which other skill names this skill links to. Used only for the structural
 * `routing` kind (§2.2): a short entry that points at ≥2 sibling skills.
 */
function linkedSkillNames(report, hints, bodyText) {
  const own = stringValue(report.name).toLowerCase();
  if (Array.isArray(hints.linkedSkillNames)) {
    const unique = new Set();
    for (const name of hints.linkedSkillNames) {
      if (typeof name !== 'string' || name === '') continue;
      if (name.toLowerCase() === own) continue;
      unique.add(name);
    }
    return [...unique];
  }
  const candidates = [
    ...(Array.isArray(hints.siblingNames) ? hints.siblingNames : []),
    ...(Array.isArray(report.siblingNames) ? report.siblingNames : []),
  ];
  const text = `${stringValue(report.description)}\n${bodyText}`;
  const found = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    if (candidate.toLowerCase() === own) continue;
    if (nameMentioned(text, candidate)) found.add(candidate);
  }
  return [...found];
}

function globalDirs(home) {
  return GLOBAL_DIR_NAMES.map((name) => resolve(stringValue(home) || homedir(), name));
}

function under(target, base) {
  if (!target || !base) return false;
  const child = resolve(target);
  const parent = resolve(base);
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

/**
 * Map a report to one scope id (§2.3).
 *
 * Precedence notes:
 * - `bundled` and explicit source attribution win over filesystem paths;
 * - for agents the host's own scope attribution (`skill` / `profile` /
 *   `project` / `global`) wins next, so `classification.scope` can never
 *   disagree with the raw `scope` field hosts and the UI already filter on;
 *   this also keeps `totals.byScope` stable across the taxonomy rollout;
 * - without a host scope (skills), a path under the current working directory
 *   wins over the vague home-directory check, so project files are not called
 *   global;
 * - the remaining scope ids still work as a fallback when only a path/source
 *   is available.
 */
function classifyScope(report, hints, surface) {
  const source = stringValue(report.source);
  const scope = stringValue(report.scope || hints.scope);
  const path = stringValue(report.path || hints.path);
  const cwd = stringValue(hints.cwd) || process.cwd();
  const explicitScope = scope === 'skill' || scope === 'profile' || scope === 'project' || scope === 'global'
    ? scope
    : '';

  if (source === 'bundled') return labelOf(SCOPE_BY_ID, 'bundled');
  if (source === 'agent-agents' || source === 'agent-claude') return labelOf(SCOPE_BY_ID, 'global');
  if (surface === 'agents' && explicitScope) return labelOf(SCOPE_BY_ID, explicitScope);
  if (path && under(path, cwd)) return labelOf(SCOPE_BY_ID, 'project');
  if (path && globalDirs(hints.home).some((dir) => under(path, dir))) return labelOf(SCOPE_BY_ID, 'global');
  if (source === 'profile-config') return labelOf(SCOPE_BY_ID, 'profile');
  if (explicitScope) return labelOf(SCOPE_BY_ID, explicitScope);
  return labelOf(SCOPE_BY_ID, 'custom');
}

function stateValue(id) {
  return { id, label: STATE_BY_ID.get(id).label };
}

function maxOverlap(report) {
  let max = 0;
  for (const overlap of Array.isArray(report.overlaps) ? report.overlaps : []) {
    const score = Number(overlap && overlap.score);
    if (Number.isFinite(score)) max = Math.max(max, score);
  }
  const metric = Number(isPlainObject(report.metrics) ? report.metrics.overlapMax : NaN);
  if (Number.isFinite(metric)) max = Math.max(max, metric);
  return max;
}

/**
 * Derive the multi-valued state badges (§2.4). Exactly one usage state
 * (`active` / `idle` / `unobserved`) is always produced; badges follow the
 * catalog order so serialization is stable.
 */
function deriveState(report, { surface, conflicts = [] } = {}) {
  const usage = isPlainObject(report.usage) ? report.usage : {};
  const count = surface === 'skills' ? Number(usage.count) || 0 : Number(usage.sessions) || 0;
  const ids = [];
  if (count > 0) ids.push('active');
  else if (usage.sufficient === true) ids.push('idle');
  else ids.push('unobserved');

  const evolution = isPlainObject(report.evolution) ? report.evolution : {};
  const pending = isPlainObject(evolution.pending) ? evolution.pending : {};
  if (pending.hasUnclosed === true) ids.push('pending');

  if (maxOverlap(report) >= 0.6) ids.push('overlap');

  const findings = Array.isArray(report.findings) ? report.findings.filter(isPlainObject) : [];
  if (findings.some((finding) => finding.severity === 'critical')) ids.push('critical');

  if (surface === 'agents') {
    const metrics = isPlainObject(report.metrics) ? report.metrics : {};
    if (Array.isArray(metrics.staleRefs) && metrics.staleRefs.length > 0) ids.push('stale-ref');
    const conflictHit = (Array.isArray(conflicts) && conflicts.length > 0)
      || (Array.isArray(report.conflicts) && report.conflicts.length > 0)
      || findings.some((finding) => finding.id === 'gov.conflicts' || finding.id === 'hyg.conflicts');
    if (conflictHit) ids.push('conflict');
  }

  return ids.map(stateValue);
}

function firstH1(text) {
  const line = stringValue(text).split('\n').find((entry) => /^#\s+/.test(entry)) || '';
  const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
  return match ? match[1].trim() : '';
}

function stripMarkdown(text) {
  return stringValue(text)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text) {
  const value = stripMarkdown(text);
  if (!value) return '';
  // Chinese punctuation ends a sentence without requiring a following space;
  // an ASCII period needs a space/end so version numbers and file names do
  // not get cut in half.
  const match = /^(.+?)(?:[。！？!?]|\.(?=\s|$))/.exec(value);
  return (match ? match[1] : value).trim();
}

function truncate(value, max = SUMMARY_MAX) {
  const text = stringValue(value).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * One human sentence for a report: first sentence of the description (markdown
 * stripped, ≤60 chars), else the H1 title, else `role.label：name`.
 * @param {object} report
 * @returns {string}
 */
export function summarize(report = {}) {
  const safe = isPlainObject(report) ? report : {};
  const description = safe.description;
  const sentence = firstSentence(description);
  if (sentence) return truncate(sentence);

  const title = firstSentence(safe.title) || firstH1(safe.body);
  if (title) return truncate(title);

  const roleLabel = isPlainObject(safe.classification) && isPlainObject(safe.classification.role)
    ? stringValue(safe.classification.role.label)
    : '';
  const name = stringValue(safe.name) || stringValue(safe.id);
  return truncate(roleLabel ? `${roleLabel}：${name}` : name);
}

/**
 * Stable machine-readable tags derived from an existing classification:
 * `role:<id>`, `kind:<id>`, `scope:<id>`, then one `state:<id>` per state.
 * Same source as the labels — the UI must not re-derive ids on its own.
 * @param {object} classification
 * @returns {string[]}
 */
export function classificationTags(classification) {
  if (!isPlainObject(classification)) return [];
  const tags = [];
  const push = (axis, value) => {
    if (isPlainObject(value) && typeof value.id === 'string' && value.id !== '') tags.push(`${axis}:${value.id}`);
  };
  push('role', classification.role);
  push('layer', classification.layer);
  push('kind', classification.kind);
  push('scope', classification.scope);
  for (const state of Array.isArray(classification.state) ? classification.state : []) push('state', state);
  return [...new Set(tags)];
}

function finish(role, kind, scope, state, report, bodyText, layer = null) {
  const classification = {
    role,
    ...(layer ? { layer } : {}),
    kind,
    scope,
    state,
    summary: summarize({ ...report, body: bodyText, classification: { role } }),
  };
  classification.tags = classificationTags(classification);
  return classification;
}

// High-precision meta-skill hints. A meta-skill operates on the agent's own
// capability (skill catalog, prompts, context, session efficiency); a task
// skill occasionally mentions "skill"/"agent" in boilerplate, so the
// description rule requires a target+verb pair in the same sentence.
const META_NAME_HINTS = [
  'find-skills', 'prompt-optimizer', 'context-optimizer', 'loss-analysis',
  'skill-creator', 'skill-reviewer', 'skill-manager', 'meta-skill',
];
const META_DESC_PATTERNS = [
  /(?:find|discover|install|create|optimi[sz]e(?!r)|audit|evaluate|review|rewrite)[^。.!?\n]{0,20}(?:skills?|prompts?|context window|sub-?agents?)(?![a-z-])/i,
  /(?:skills?|prompts?|context window|sub-?agents?)(?![a-z-])[^。.!?\n]{0,20}(?:find|discover|install|create|optimi[sz]e(?!r)|audit|evaluate|review|rewrite)/i,
  /(?:发现|查找|安装|创建|生成|优化|审计|评估|评测|审查|改写|治理)[^。！？\n]{0,20}(?:技能|提示词|上下文|子代理)/,
  /(?:技能|提示词|上下文|子代理)[^。！？\n]{0,20}(?:发现|查找|安装|创建|生成|优化|审计|评估|评测|审查|改写|治理)/,
  /(?:会话|session)[^。！？\n]{0,20}(?:效率|审计|复盘)/i,
];

/**
 * Classify a skill as 元技能 (meta) or 任务技能 (task). Deliberately
 * high-precision: a generic "analyze" skill is not meta; it must carry an
 * explicit meta name or a target+governance-verb pair about the agent's own
 * capability.
 * @param {{name?:string, description?:string}} input
 * @returns {{id:string,label:string,confidence:number,evidence:string[]}}
 */
export function classifyLayer(input) {
  const safe = isPlainObject(input) ? input : {};
  const name = stringValue(safe.name).toLowerCase();
  const description = stringValue(safe.description);
  const nameHit = META_NAME_HINTS.find((hint) => name === hint || name.includes(hint));
  if (nameHit) {
    return { id: 'meta', label: LAYER_BY_ID.get('meta').label, confidence: 0.9, evidence: [nameHit] };
  }
  for (const pattern of META_DESC_PATTERNS) {
    const match = pattern.exec(description);
    if (match) {
      return { id: 'meta', label: LAYER_BY_ID.get('meta').label, confidence: 0.7, evidence: [match[0]] };
    }
  }
  return { id: 'task', label: LAYER_BY_ID.get('task').label, confidence: 0.7, evidence: [] };
}

/**
 * Classify one skill report (TAXONOMY-SPEC §3 shape).
 *
 * Kind is structural, so it needs counts the skill report may not retain:
 * pass `hints` with `bodyText` / `bodyLines` / `referenceCount` / `scriptCount`
 * / `siblingNames` (or `linkedSkillNames`) when the caller still has them.
 * Without hints it falls back to `report.metrics`, `report.files`,
 * `report.body` — still deterministic, just less precise for `routing`.
 *
 * @param {object} report
 * @param {{bodyText?:string, bodyLines?:number, referenceCount?:number, scriptCount?:number,
 *   siblingNames?:string[], linkedSkillNames?:string[], cwd?:string, home?:string}} [hints]
 */
export function classifySkill(report = {}, hints = {}) {
  const safeReport = isPlainObject(report) ? report : {};
  const safeHints = isPlainObject(hints) ? hints : {};
  const bodyText = stringValue(safeReport.body) || stringValue(safeHints.bodyText);
  const role = classifyRole({
    name: safeReport.name,
    description: safeReport.description,
    body: bodyText,
  });
  const kind = skillKind(safeReport, safeHints, bodyText);
  const scope = classifyScope(safeReport, safeHints, 'skills');
  const state = deriveState(safeReport, { surface: 'skills' });
  const layer = classifyLayer({ name: safeReport.name, description: safeReport.description });
  return finish(role, kind, scope, state, safeReport, bodyText, layer);
}

/**
 * Classify one agent subject report (TAXONOMY-SPEC §3 shape).
 * Kind comes from the subject kind; state adds `stale-ref` / `conflict` when
 * the report's metrics or findings say so.
 *
 * @param {object} report
 * @param {{bodyText?:string, conflicts?:object[], cwd?:string, home?:string}} [hints]
 */
export function classifyAgent(report = {}, hints = {}) {
  const safeReport = isPlainObject(report) ? report : {};
  const safeHints = isPlainObject(hints) ? hints : {};
  const bodyText = stringValue(safeReport.body) || stringValue(safeHints.bodyText);
  const role = classifyRole({
    name: safeReport.name,
    description: safeReport.description,
    body: bodyText,
  });
  const kind = agentKind(safeReport);
  const scope = classifyScope(safeReport, safeHints, 'agents');
  const state = deriveState(safeReport, { surface: 'agents', conflicts: safeHints.conflicts });
  // A resident instruction file (AGENTS.md / CLAUDE.md / instructions.md) is a
  // governance artifact by nature, even when its title/description carry no
  // role keyword. Say so explicitly instead of showing 其他 in the panel.
  const effectiveRole = role.id === 'other' && kind.id === 'instruction'
    ? { id: 'ops', label: '运维治理', confidence: 0.4, evidence: ['instruction-file'] }
    : role;
  return finish(effectiveRole, kind, scope, state, safeReport, bodyText);
}

/**
 * Machine-readable self-description of the taxonomy, so tools and the UI never
 * hard-code labels (TAXONOMY-SPEC §3). `surface` selects the kind axis: one
 * axis id (`kind`) with a surface-specific label and value set.
 *
 * @param {'skills'|'agents'} [surface]
 * @returns {{version:number, axes:{id:string,label:string,values:{id:string,label:string,description?:string}[]}[]}}
 */
export function taxonomyCatalog(surface = 'skills') {
  const key = surface === 'agents' ? 'agents' : 'skills';
  const labels = AXIS_LABELS[key];
  const kinds = key === 'agents' ? AGENT_KINDS : SKILL_KINDS;
  const axis = (id, label, values) => ({
    id,
    label,
    values: values.map((value) => ({
      id: value.id,
      label: value.label,
      description: value.description,
    })),
  });
  return {
    version: TAXONOMY_VERSION,
    axes: [
      axis('role', labels.role, ROLES),
      ...(key === 'skills' ? [axis('layer', labels.layer, SKILL_LAYERS)] : []),
      axis('kind', labels.kind, kinds),
      axis('scope', labels.scope, SCOPES),
      axis('state', labels.state, STATES),
    ],
  };
}
