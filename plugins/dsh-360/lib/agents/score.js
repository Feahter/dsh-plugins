/**
 * Deterministic scoring + findings + safe suggestions for one agent subject
 * (instruction / agent / preset). The rubric is RUBRIC.md §1–§9: six dimensions
 * (inject 20 / layer 25 / actionable 20 / governance 15 / hygiene 10 /
 * evolution 10), each dimension = round(Σitems / Σmax × weight × 10) / 10.
 *
 * Every deduction points at a measurable metric or textual match, and each
 * finding carries evidence the UI can show. Pure: never reads the disk.
 */
import {
  descriptionOverlap,
  excerpt,
  findReferenceSections,
  hasTriggerPhrase,
  round1,
  triggerTerms,
} from '../util.js';
import { gradeFor } from '../grade.js';

const DAY_MS = 86_400_000;
const KEBAB_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ENTRY_TITLE_RE = /overview|quick\s*start|quickstart|getting\s*started|decision|workflow|mode|usage|概览|快速开始|快速上手|决策|工作流|流程|模式|用法|边界/i;
const WORKFLOW_TITLE_RE = /workflow|process|steps?|procedure|工作流|流程|步骤|操作/i;
const SCOPE_DECL_RE = /仅在|适用于|全局|所有项目|本仓库|workspace\s*内|适用范围|scope/i;
const BOUNDARY_TITLE_RE = /不适用|when\s+not\s+to\s+use|边界|不要用它来做|禁止用于|not\s+for|do\s+not\s+use/i;
const BOUNDARY_INLINE_RE = /不适用|when\s+not\s+to\s+use|边界|禁止用于|not\s+for|do\s+not\s+use|不要用它来做/i;
const VERIFY_RE = /验证|检查|跑一遍|验收|verify|check/i;
const ANTI_PATTERN_RE = /不要|禁止|避免|anti[- ]?patterns?|pitfalls?|常见错误|别(?:做|用|改|碰|动|写|读|删|运行|执行)/i;
const DECISION_RE = /如果|否则|选择|分支|\bif\b|\bwhen\b|\botherwise\b|\bchoose\b/g;

const DIMENSIONS = [
  { id: 'inject', label: '注入命中', max: 20 },
  { id: 'layer', label: '分层与精简', max: 25 },
  { id: 'actionable', label: '可执行性', max: 20 },
  { id: 'governance', label: '边界与治理', max: 15 },
  { id: 'hygiene', label: '维护卫生', max: 10 },
  { id: 'evolution', label: '持续进化', max: 10 },
];

function item(id, label, score, max, detail, extra = {}) {
  return {
    id,
    label,
    score: round1(Math.max(0, Math.min(max, score))),
    max,
    applicable: extra.applicable !== false,
    detail,
    evidence: extra.evidence,
  };
}

function findLine(body, regex) {
  const lines = String(body || '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (regex.test(lines[i])) return i + 1;
  }
  return undefined;
}

function bodyEvidence(body, regex) {
  const line = findLine(body, regex);
  if (line === undefined) return undefined;
  return { line, excerpt: excerpt(String(body).split('\n')[line - 1], 180) };
}

function addFinding(findings, finding) {
  if (findings.some((entry) => entry.id === finding.id)) return;
  findings.push({ actionIds: [], ...finding });
}

function countMatches(text, regex) {
  const matches = String(text || '').match(regex);
  return matches ? matches.length : 0;
}

function severityRank(severity) {
  return { critical: 0, major: 1, minor: 2, info: 3 }[severity] ?? 4;
}

function escalateSeverity(declared, loss, alwaysCritical = false) {
  if (alwaysCritical) return 'critical';
  if (declared === 'critical' && loss < 6) return loss >= 4 ? 'major' : 'minor';
  if (declared === 'major' && loss < 4) return 'minor';
  if (declared === 'minor' && loss >= 6) return 'major';
  return declared;
}

function injectEvidenceMissing(kind, injection, usage, exposureDays) {
  if (kind === 'instruction') return (injection.sessionsInjected || 0) === 0 && exposureDays >= 30;
  if (kind === 'agent') return (usage.subagentRuns || 0) === 0 && exposureDays >= 45;
  return (usage.presetSessions || 0) === 0 && exposureDays >= 30;
}

/**
 * Score one subject.
 * @param {object} metrics from extractMetrics
 * @param {object} context
 * @returns {{total:number,grade:string,confidence:number,dimensions:object[],findings:object[],suggestions:object[],verdict:object}}
 */
export function scoreSubject(metrics, context) {
  const {
    kind = 'instruction',
    name = '',
    description = '',
    scope = 'project',
    coverage = 'full',
    usage = {},
    injection = {},
    conflicts = [],
    overlaps = [],
    siblings = [],
    overlapMax = 0,
    overlapName = '',
    evolution = {},
    options = {},
    rawBody = '',
    files = [],
    config = null,
    usageAvailable = false,
    mtimeMissing = false,
    previousTotal = null,
  } = context;
  const now = Number(options.now) || Date.now();
  const items = { inject: [], layer: [], actionable: [], governance: [], hygiene: [], evolution: [] };
  const findings = [];
  const suggestions = [];

  const exposureDays = Number(usage.exposureDays) || 0;
  const sessionsSeen = Number(injection.sessionsSeen) || 0;
  const sessionsInjected = Number(injection.sessionsInjected) || 0;
  const tokensPerInjection = Number(injection.tokensPerInjection) || 0;
  const subagentRuns = Number(usage.subagentRuns) || 0;
  const presetSessions = Number(usage.presetSessions) || 0;
  const descriptionChars = String(description || '').length;

  // ============================================================= inject (20)
  // ---- inject.evidence (8)
  let evidenceScore;
  let evidenceApplicable = true;
  let evidenceDetail;
  if (kind === 'instruction') {
    if (sessionsSeen < 5) {
      evidenceApplicable = false;
      evidenceScore = 0;
      evidenceDetail = `会话样本不足（sessionsSeen=${sessionsSeen} < 5），本项不评分。`;
    } else if (sessionsInjected >= 1) {
      evidenceScore = 8;
      evidenceDetail = `${sessionsSeen} 个会话范围内有 ${sessionsInjected} 次注入证据。`;
    } else if (exposureDays >= 14) {
      evidenceScore = 2;
      evidenceDetail = `覆盖 ${sessionsSeen} 个会话但 0 次注入证据，已存在 ${exposureDays} 天。`;
    } else {
      evidenceApplicable = false;
      evidenceScore = 0;
      evidenceDetail = `新说明书（暴露 ${exposureDays} 天 < 14），暂无注入证据，不评分。`;
    }
  } else if (kind === 'agent') {
    if (subagentRuns >= 3) { evidenceScore = 8; evidenceDetail = `窗口内被委派 ${subagentRuns} 次。`; }
    else if (subagentRuns >= 1) { evidenceScore = 5; evidenceDetail = `窗口内被委派 ${subagentRuns} 次。`; }
    else if (exposureDays >= 45) { evidenceScore = 0; evidenceDetail = `已存在 ${exposureDays} 天但 0 次委派。`; }
    else { evidenceScore = 3; evidenceDetail = `0 次委派，暴露 ${exposureDays} 天（<45，新 agent）。`; }
  } else {
    if (presetSessions >= 10) { evidenceScore = 8; evidenceDetail = `窗口内选中 ${presetSessions} 个会话。`; }
    else if (presetSessions >= 1) { evidenceScore = 6; evidenceDetail = `窗口内选中 ${presetSessions} 个会话。`; }
    else if (exposureDays >= 30) { evidenceScore = 1; evidenceDetail = `已存在 ${exposureDays} 天但 0 次选中。`; }
    else { evidenceScore = 4; evidenceDetail = `0 次选中，暴露 ${exposureDays} 天（<30，新预设）。`; }
  }
  items.inject.push(item('inject.evidence', '注入/使用证据', evidenceScore, 8, evidenceDetail,
    { applicable: evidenceApplicable }));

  // ---- inject.cost (6)
  let costScore;
  let costDetail;
  if (kind === 'instruction') {
    costScore = tokensPerInjection <= 800 ? 6 : tokensPerInjection <= 1500 ? 4 : tokensPerInjection <= 2500 ? 2 : 0;
    costDetail = `每次注入约 ${tokensPerInjection} tokens。`;
  } else if (kind === 'agent') {
    costScore = descriptionChars <= 300 ? 6 : descriptionChars <= 500 ? 4 : descriptionChars <= 900 ? 2 : 0;
    costDetail = descriptionChars > 0
      ? `description ${descriptionChars} 字符。`
      : 'description 缺失。';
  } else {
    const hasModelTier = config && (config.reasoningEffort || config.maxTokens);
    const hasModelName = config && config.model;
    costScore = hasModelTier ? 6 : hasModelName ? 4 : 2;
    costDetail = hasModelTier ? '有显式模型档位配置（reasoningEffort/maxTokens）。'
      : hasModelName ? '只配置了模型名。' : '无模型配置。';
  }
  items.inject.push(item('inject.cost', '常驻成本', costScore, 6, costDetail));

  // ---- inject.unique (6)
  let uniqueScore;
  let uniqueDetail;
  if (kind === 'agent') {
    const nameLegal = KEBAB_RE.test(name);
    const nameUnique = !(siblings || []).some((sibling) => sibling && sibling.name === name && sibling.id !== undefined);
    const descTrigger = hasTriggerPhrase(description);
    uniqueScore = (nameLegal && nameUnique ? 3 : (nameLegal || nameUnique ? 1.5 : 0)) + (descTrigger ? 3 : 0);
    uniqueDetail = `name ${nameLegal ? '合法' : '非法'}${nameUnique ? '且唯一' : '（重复）'}；description ${descTrigger ? '含触发句式' : '缺触发句式'}。`;
  } else {
    uniqueScore = overlapMax < 0.4 ? 6 : overlapMax < 0.7 ? 3 : 0;
    uniqueDetail = overlapName ? `与 ${overlapName} 重复率 ${overlapMax.toFixed(2)}。` : '未发现高重复邻居。';
  }
  items.inject.push(item('inject.unique', '唯一性与作用域', uniqueScore, 6, uniqueDetail));

  // =============================================================== layer (25)
  // ---- layer.body (10)
  const tokens = metrics.estTokens;
  let bodyScore = tokens <= 1200 ? 10 : tokens <= 2500 ? 8 : tokens <= 4000 ? 5 : tokens <= 8000 ? 2 : 0;
  if (metrics.lines > 600) bodyScore = Math.min(bodyScore, 5);
  if (metrics.lines > 1200) bodyScore = Math.min(bodyScore, 2);
  items.layer.push(item('layer.body', '入口体量', bodyScore, 10,
    `${metrics.lines} 行 / ${metrics.chars} 字符，约 ${tokens} tokens。`,
    { evidence: bodyEvidence(rawBody, /^#\s+/) }));

  // ---- layer.refs (8)
  const hasNotes = (files || []).some((file) => String(file.path || '').startsWith('agent-notes/'));
  const linksNotes = (metrics.localLinks || []).some((link) => link.href.startsWith('agent-notes/') && link.resolves);
  const externalResolved = (metrics.localLinks || []).filter((link) => link.resolves && !link.href.startsWith('agent-notes/')).length;
  const hasRefSection = (metrics.sections || []).some((section) => section.kind === 'ref');
  let refScore;
  if (tokens <= 2500) {
    refScore = 8;
  } else if ((hasNotes && linksNotes) || externalResolved > 0) {
    refScore = 8;
  } else if (hasRefSection) {
    refScore = 4;
  } else {
    refScore = 0;
  }
  const brokenLinks = (metrics.localLinks || []).filter((link) => !link.resolves).length;
  if (brokenLinks > 0) refScore -= 1;
  refScore = Math.max(0, refScore);
  items.layer.push(item('layer.refs', '细节外置', refScore, 8,
    `${hasNotes ? '有 agent-notes/' : '无 agent-notes/'}；正文解析到 ${metrics.localLinks.length} 个本地链接（${brokenLinks} 个失效）；参考型章节 ${hasRefSection ? '有' : '无'}。`));

  // ---- layer.entry (7)
  let entryScore = metrics.h2 >= 3 ? 3 : metrics.h2 >= 1 ? 1 : 0;
  const head = String(rawBody).split('\n').slice(0, 30).join('\n');
  if (ENTRY_TITLE_RE.test(head)) entryScore += 2;
  const hasWorkflowSection = (metrics.sections || []).some((section) => WORKFLOW_TITLE_RE.test(section.title));
  if (metrics.numberedSteps > 0 || hasWorkflowSection) entryScore += 2;
  entryScore = Math.min(7, entryScore);
  items.layer.push(item('layer.entry', '分层入口', entryScore, 7,
    `H2 ${metrics.h2} 个；编号步骤 ${metrics.numberedSteps} 条；工作流小节 ${hasWorkflowSection ? '有' : '无'}。`));

  // ========================================================== actionable (20)
  // ---- action.imperative (6)
  const imp = metrics.imperativeCount;
  const imperativeScore = imp >= 8 ? 6 : imp >= 4 ? 4 : imp >= 1 ? 2 : 0;
  items.actionable.push(item('action.imperative', '祈使规则密度', imperativeScore, 6,
    `祈使/约束句 ${imp} 条。`));

  // ---- action.verification (6)
  const hasCommands = metrics.commands > 0 || metrics.codeBlocks > 0;
  const hasVerifyLang = VERIFY_RE.test(rawBody);
  const verifyScore = hasCommands && hasVerifyLang ? 6 : hasCommands ? 3 : 0;
  items.actionable.push(item('action.verification', '验收命令', verifyScore, 6,
    `${hasCommands ? '有' : '无'}可执行命令；${hasVerifyLang ? '有' : '无'}验收语义（验证/检查/验收/verify/check）。`));

  // ---- action.antipattern (4)
  const antiCount = countMatches(rawBody, new RegExp(ANTI_PATTERN_RE.source, 'g'));
  const antiScore = antiCount >= 2 ? 4 : antiCount === 1 ? 2 : 0;
  items.actionable.push(item('action.antipattern', '反模式', antiScore, 4,
    `反模式/禁止提示 ${antiCount} 处。`));

  // ---- action.decision (4)
  const decisionCount = countMatches(rawBody, DECISION_RE);
  const decisionScore = decisionCount >= 2 ? 4 : decisionCount === 1 ? 2 : 0;
  items.actionable.push(item('action.decision', '决策分支', decisionScore, 4,
    `决策语言 ${decisionCount} 处。`));

  // ========================================================== governance (15)
  // ---- gov.scope (5)
  const hasScopeDecl = SCOPE_DECL_RE.test(rawBody);
  const scopeScore = hasScopeDecl ? 5 : (scope === 'global' || scope === 'project' ? 3 : 1);
  items.governance.push(item('gov.scope', '作用域声明', scopeScore, 5,
    hasScopeDecl ? '正文明确写了适用范围。' : `靠路径隐含（scope=${scope}），正文未声明。`));

  // ---- gov.boundary (5)
  const hasBoundarySection = (metrics.sections || []).some((section) => BOUNDARY_TITLE_RE.test(section.title));
  const hasBoundaryInline = BOUNDARY_INLINE_RE.test(rawBody);
  const boundaryScore = hasBoundarySection ? 5 : hasBoundaryInline ? 3 : 0;
  items.governance.push(item('gov.boundary', '职责边界', boundaryScore, 5,
    hasBoundarySection ? '有独立「不适用/边界」小节。' : hasBoundaryInline ? '只在行内提到边界。' : '无任何负向边界。',
    { evidence: bodyEvidence(rawBody, BOUNDARY_INLINE_RE) }));

  // ---- gov.conflicts (5)
  const myConflicts = (conflicts || []).filter((conflict) => conflict.a === name || conflict.b === name
    || conflict.a === context.id || conflict.b === context.id
    || (Array.isArray(conflict.subjects) && conflict.subjects.includes(context.id)));
  const myDupes = myConflicts.filter((conflict) => conflict.kind === 'duplicate' && conflict.ratio >= 0.6).length;
  const myContradictions = myConflicts.filter((conflict) => conflict.kind === 'contradiction').length;
  const conflictScore = myContradictions > 0 ? 0 : myDupes >= 2 ? 1 : myDupes === 1 ? 3 : 5;
  items.governance.push(item('gov.conflicts', '跨文件冲突', conflictScore, 5,
    myContradictions > 0 ? `有 ${myContradictions} 条矛盾规则。`
      : myDupes > 0 ? `有 ${myDupes} 条重复规则。` : '无跨文件冲突。'));

  // ============================================================= hygiene (10)
  items.hygiene.push(item('hyg.placeholders', '占位与未完成', metrics.todos > 0 ? 0 : 3, 3,
    metrics.todos > 0 ? `发现 ${metrics.todos} 处 TODO/TBD/待补充。` : '未发现未完成标记。'));

  const staleCount = metrics.staleRefs.length;
  const refsScore = staleCount === 0 ? 3 : staleCount <= 2 ? 1 : 0;
  items.hygiene.push(item('hyg.refs', '引用可解析', refsScore, 3,
    staleCount === 0 ? '无失效引用。' : `有 ${staleCount} 条失效路径/链接引用。`,
    { evidence: metrics.staleRefs[0] ? { line: metrics.staleRefs[0].line, excerpt: metrics.staleRefs[0].ref } : undefined }));

  items.hygiene.push(item('hyg.security', '安全', metrics.secrets > 0 || metrics.dangerous > 0 ? 0 : 2, 2,
    metrics.secrets > 0 || metrics.dangerous > 0
      ? `发现 ${metrics.dangerous} 处危险命令、${metrics.secrets} 处疑似密钥。` : '未发现危险命令或密钥痕迹。',
    { evidence: metrics.dangerous > 0 ? bodyEvidence(rawBody, /curl|wget|rm\s+-rf|chmod\s+777/i) : undefined }));

  const bakScore = metrics.bakFiles === 0 ? 2 : metrics.bakFiles <= 3 ? 1 : 0;
  items.hygiene.push(item('hyg.backup', '备份污染', bakScore, 2,
    metrics.bakFiles === 0 ? '无 .bak/.old 备份文件。' : `有 ${metrics.bakFiles} 个 .bak/.old 备份文件。`));

  // =========================================================== evolution (10)
  const ev = evolution && typeof evolution === 'object' ? evolution : {};
  const evApplicable = ev.applicable === true;
  const evLessons = ev.lessons && typeof ev.lessons === 'object' ? ev.lessons : {};
  const evPending = ev.pending && typeof ev.pending === 'object' ? ev.pending : {};
  const evSignals = ev.signals && typeof ev.signals === 'object' ? ev.signals : {};
  const lessonsCount = Number(evLessons.count) || 0;
  const latestAt = evLessons.latestAt != null ? Number(evLessons.latestAt) || null : null;
  const evLinked = evLessons.linked === true;
  const pendingScore = Number(evPending.score) || 0;
  const evHasUnclosed = evPending.hasUnclosed === true;

  let lessonsScore = 0;
  if (lessonsCount >= 3 && evLinked) lessonsScore = 5;
  else if (lessonsCount >= 1 && evLinked) lessonsScore = 4;
  else if (lessonsCount >= 1) lessonsScore = 2;
  items.evolution.push(item('evolution.lessons', '经验沉淀', lessonsScore, 5,
    lessonsCount === 0 ? '还没有沉淀经验。'
      : `沉淀 ${lessonsCount} 条经验${evLinked ? '，已接进入口' : '，未接进入口'}。`));

  const freshnessApplicable = latestAt != null;
  let freshnessScore = 0;
  if (freshnessApplicable) {
    const age = now - latestAt;
    freshnessScore = age <= 90 * DAY_MS ? 3 : age <= 180 * DAY_MS ? 2 : age <= 365 * DAY_MS ? 1 : 0;
  }
  items.evolution.push(item('evolution.freshness', '经验新鲜度', freshnessScore, 3,
    freshnessApplicable ? `最近一条经验 ${new Date(latestAt).toISOString().slice(0, 10)}。` : '无经验，本项不评分。',
    { applicable: freshnessApplicable }));

  const closureApplicable = lessonsCount > 0 || pendingScore > 0;
  let closureScore = 0;
  if (closureApplicable) {
    closureScore = lessonsCount > 0 ? (evHasUnclosed ? 1 : 2) : 0;
  }
  items.evolution.push(item('evolution.closure', '信号闭环', closureScore, 2,
    closureApplicable
      ? (lessonsCount > 0
        ? (closureScore === 2 ? '最新经验已覆盖最近信号。' : '存在未闭环信号（晚于最新经验）。')
        : '有信号但无经验，尚未闭环。')
      : '无信号且无经验，本项不评分。',
    { applicable: closureApplicable }));

  // ------------------------------------------------------------- dimensions
  const dimensions = DIMENSIONS.map((dim) => {
    if (dim.id === 'evolution' && !evApplicable) {
      return {
        id: 'evolution', label: dim.label, score: 0, max: dim.max, applicable: false,
        summary: '窗口内无使用样本且无经验/信号，本维度不评分；其余五维按 90 分折算为 100。',
        items: items.evolution.map((entry) => ({ ...entry, applicable: false })),
      };
    }
    const list = items[dim.id];
    const applicableEntries = list.filter((entry) => entry.applicable);
    const earned = applicableEntries.reduce((sum, entry) => sum + entry.score, 0);
    const possible = applicableEntries.reduce((sum, entry) => sum + entry.max, 0);
    const scaled = possible > 0 ? (earned / possible) * dim.max : 0;
    return {
      id: dim.id, label: dim.label, score: round1(scaled), max: dim.max, applicable: true,
      summary: summarizeDimension(dim.id, scaled, dim.max, metrics, context, ev),
      items: list,
    };
  });

  const fiveDimTotal = dimensions.filter((dim) => dim.id !== 'evolution')
    .reduce((sum, dim) => sum + dim.score, 0);
  const total = evApplicable
    ? round1(dimensions.reduce((sum, dim) => sum + dim.score, 0))
    : round1(fiveDimTotal * 100 / 90);
  const g = gradeFor(total);

  let confidence;
  if (coverage !== 'full') confidence = 0.5;
  else if (usageAvailable) confidence = 0.9;
  else confidence = 0.75;
  if (sessionsSeen < 5) confidence -= 0.1;
  if (mtimeMissing) confidence -= 0.1;
  confidence = Math.max(0.3, Math.min(1, round1(confidence)));

  // ------------------------------------------------------------- suggestions
  const existingIds = new Set();
  const addSuggestion = (suggestion) => {
    if (existingIds.has(suggestion.id)) return suggestion;
    existingIds.add(suggestion.id);
    suggestions.push(suggestion);
    return suggestion;
  };

  // auto: extract-sections
  if (tokens > 2500) {
    const candidates = findReferenceSections(rawBody);
    if (candidates.length > 0) {
      const moved = candidates.reduce((sum, section) => sum + section.lines, 0);
      addSuggestion({
        id: 'fix.extract-sections', kind: 'auto',
        title: `把 ${candidates.length} 个参考型章节搬到 agent-notes/`,
        why: `预计从入口移出 ${moved} 行，正文降到约 ${Math.max(0, tokens - Math.round(moved * 25))} tokens；原内容逐字保留。`,
        risk: '低：整节搬移并在原位留指针，可撤销。',
        action: { type: 'extract-sections', params: { titles: candidates.map((section) => section.title) } },
        preview: {
          before: candidates.map((section) => section.title).join(' / '),
          after: candidates.map((section) => `agent-notes/${section.title}.md`).join(' / '),
        },
      });
    }
  }

  // auto: link-notes
  if (hasNotes && !linksNotes) {
    const notes = (files || []).filter((file) => String(file.path || '').startsWith('agent-notes/')).map((file) => file.path);
    addSuggestion({
      id: 'fix.link-notes', kind: 'auto',
      title: `把 ${notes.length} 个 agent-notes 文件接进入口`,
      why: 'agent-notes/ 存在但正文没链接，模型不知道这些按需资源存在。',
      risk: '低：只追加一个按需参考清单，不改原内容。',
      action: { type: 'link-notes', params: { notes } },
      preview: { before: '（无清单）', after: '追加「按需参考」清单，链接到 agent-notes/。' },
    });
  }

  // auto: embed-lessons
  if (lessonsCount > 0 && !evLinked) {
    addSuggestion({
      id: 'fix.embed-lessons', kind: 'auto',
      title: '把经验块接进入口',
      why: `有 ${lessonsCount} 条经验但正文没有受管经验块，模型按需读取时看不到。`,
      risk: '低：插入受管块并链到账本，可撤销。',
      action: { type: 'embed-lessons', params: { entries: evLessons.entries || [] } },
      preview: { before: '（无经验块）', after: '插入受管经验块。' },
    });
  }

  // draft: add-verification
  if (!hasCommands) {
    addSuggestion({
      id: 'fix.add-verification', kind: 'draft',
      title: '补一个「做完必须跑什么检查」骨架',
      why: '没有可执行验收命令，规则能否照做无法验证。',
      risk: '中：追加骨架，需要你补具体命令；可撤销。',
      action: {
        type: 'add-verification',
        params: { text: '## 验收\n\n- 请补充：做完必须跑的具体命令（如 `npm test` / `node --test`）。\n- 请补充：通过/失败的判断标准。' },
      },
      preview: { before: '（无）', after: '追加验收骨架。' },
    });
  }

  // draft: add-boundary
  if (!hasBoundarySection) {
    addSuggestion({
      id: 'fix.add-boundary', kind: 'draft',
      title: '补一个「不适用/边界」小节',
      why: '没有负向边界，子代理/规则容易越界。',
      risk: '中：只追加骨架，需要你补两条具体内容；可撤销。',
      action: {
        type: 'add-boundary',
        params: { text: '## 不适用 / 边界\n\n- 请补充：不适用本规则/子代理的任务或输入。\n- 请补充：应该改用哪个流程或代理。' },
      },
      preview: { before: '（无）', after: '追加边界骨架。' },
    });
  }

  // draft: rewrite-description (agent only)
  if (kind === 'agent' && !hasTriggerPhrase(description)) {
    const terms = [...triggerTerms(description)].slice(0, 5);
    const draftText = `${excerpt(description || name, 140)} Use when: ${terms.length ? terms.join('; ') : name.replace(/[-_]/g, ' ')}.`;
    addSuggestion({
      id: 'fix.rewrite-description', kind: 'draft',
      title: '补一句明确的触发描述',
      why: '目录只注入 description；没有 "Use when / 当用户…" 路由句，父 agent 很难主动选中它。',
      risk: '中：生成草稿，应用前请读一遍；可撤销。',
      action: { type: 'rewrite-description', params: { text: draftText } },
      preview: { before: excerpt(description, 160), after: excerpt(draftText, 160) },
    });
  }

  // draft: dedupe-rules
  const crossDupes = myConflicts.filter((conflict) => conflict.kind === 'duplicate' && conflict.ratio >= 0.6);
  if (crossDupes.length > 0) {
    const first = crossDupes[0];
    addSuggestion({
      id: 'fix.dedupe-rules', kind: 'draft',
      title: '合并跨文件重复规则',
      why: `与 ${first.a === name ? first.b : first.a} 有重复规则（${first.ratio.toFixed(2)}），两处维护容易漂移。`,
      risk: '中：生成合并稿（保留较新文件，另一处改为指针），需你确认。',
      action: { type: 'dedupe-rules', params: { rule: first.ruleA, otherId: first.a === name ? first.b : first.a } },
      preview: { before: first.ruleA, after: '另一处改为指针。' },
    });
  }

  // manual: resolve-stale
  if (staleCount > 0) {
    addSuggestion({
      id: 'fix.resolve-stale', kind: 'manual',
      title: `修复 ${staleCount} 条失效路径引用`,
      why: '失效引用会让模型读到空内容。',
      risk: '需人工判断正确目标路径。',
      action: { type: 'resolve-stale', params: { refs: metrics.staleRefs.slice(0, 10) } },
      preview: { before: metrics.staleRefs[0]?.ref || '', after: '修正目标路径。' },
    });
  }

  // manual: secret
  if (metrics.secrets > 0 || metrics.dangerous > 0) {
    addSuggestion({
      id: 'fix.secret', kind: 'manual',
      title: '处理疑似密钥/危险命令',
      why: '密钥与危险命令是高危项。',
      risk: '需人工轮换密钥并改为带确认的步骤。',
      action: { type: 'secret', params: {} },
      preview: { before: '（检出）', after: '轮换/移除。' },
    });
  }

  // draft: add-lesson (unclosed signals)
  if (evHasUnclosed) {
    const draft = evPending.draft && typeof evPending.draft === 'object' ? evPending.draft : {};
    addSuggestion({
      id: 'fix.add-lesson', kind: 'draft',
      title: '沉淀一条“触发→做法”经验',
      why: `窗口内出现 ${pendingScore} 个生效后信号（纠错/报错/失败），还没有对应经验。`,
      risk: '中：会向 .agents-360/lessons.md 追加经验并接进入口；需先补做法（rule）。',
      action: { type: 'add-lesson', params: { lesson: { trigger: String(draft.trigger || ''), rule: '', evidence: String(draft.evidence || '') } } },
      preview: { before: '（未沉淀）', after: `${draft.trigger || '（待补触发）'} → （待补做法）` },
    });
  }

  // ----------------------------------------------------------------- findings
  const findingSpecs = {
    'inject.evidence': { severity: 'major', title: '缺少注入/使用证据', suggestion: '对照真实会话检查注入路径或委派触发词。', actions: [] },
    'inject.cost': { severity: 'major', title: '常驻成本偏高', suggestion: '精简入口，细节外置到 agent-notes/。', actions: ['fix.extract-sections'] },
    'inject.unique': { severity: 'major', title: '唯一性或作用域不足', suggestion: '补触发句式或与邻居划清分工。', actions: ['fix.rewrite-description'] },
    'layer.body': { severity: 'critical', title: '入口体量过大', suggestion: '把参考型章节拆到 agent-notes/。', actions: ['fix.extract-sections'] },
    'layer.refs': { severity: 'major', title: '细节没有外置或没接进入口', suggestion: '链接 agent-notes/ 或拆参考型章节。', actions: ['fix.link-notes', 'fix.extract-sections'] },
    'layer.entry': { severity: 'minor', title: '缺少分层入口', suggestion: '开头加概览/快速开始/决策分支。', actions: [] },
    'action.imperative': { severity: 'major', title: '祈使规则密度不足', suggestion: '把关键约束写成明确的祈使句。', actions: [] },
    'action.verification': { severity: 'major', title: '缺少验收命令', suggestion: '补「做完必须跑什么检查」。', actions: ['fix.add-verification'] },
    'action.antipattern': { severity: 'minor', title: '反模式提示不足', suggestion: '补 2–3 条「不要/禁止」。', actions: [] },
    'action.decision': { severity: 'minor', title: '决策分支不足', suggestion: '补 if/否则/选择 分支。', actions: [] },
    'gov.scope': { severity: 'major', title: '作用域未显式声明', suggestion: '正文写明适用范围。', actions: [] },
    'gov.boundary': { severity: 'major', title: '未说明职责边界', suggestion: '加「不适用/边界」小节。', actions: ['fix.add-boundary'] },
    'gov.conflicts': { severity: 'critical', alwaysCritical: true, title: '跨文件冲突', suggestion: '合并重复规则或消除矛盾。', actions: ['fix.dedupe-rules'] },
    'hyg.placeholders': { severity: 'major', title: '存在未完成占位', suggestion: '补完或删除占位。', actions: [] },
    'hyg.refs': { severity: 'major', title: '引用失效', suggestion: '修正失效路径。', actions: ['fix.resolve-stale'] },
    'hyg.security': { severity: 'critical', alwaysCritical: true, title: '发现危险命令或密钥痕迹', suggestion: '移除密钥，危险命令改为显式步骤。', actions: ['fix.secret'] },
    'hyg.backup': { severity: 'minor', title: '备份文件污染', suggestion: '清理 .bak/.old 文件。', actions: [] },
    'evolution.lessons': { severity: 'minor', title: '没有沉淀经验', suggestion: '用 dsh360_evolve 写一条经验。', actions: ['fix.add-lesson'] },
    'evolution.freshness': { severity: 'minor', title: '经验偏旧', suggestion: '回看是否仍有适用性。', actions: [] },
    'evolution.closure': { severity: 'minor', title: '信号未闭环', suggestion: '把最新信号沉淀成经验。', actions: ['fix.add-lesson'] },
  };

  for (const dimension of dimensions) {
    if (dimension.applicable === false) continue;
    for (const entry of dimension.items) {
      if (entry.applicable === false) continue;
      const loss = entry.max - entry.score;
      if (loss < 2) continue;
      const spec = findingSpecs[entry.id];
      if (!spec) continue;
      const actionIds = (spec.actions || []).filter((id) => existingIds.has(id));
      const severity = escalateSeverity(spec.severity, loss, spec.alwaysCritical);
      addFinding(findings, {
        id: entry.id, dimension: dimension.id, severity, title: spec.title,
        detail: `${spec.suggestion}（${entry.score}/${entry.max} 分）`,
        evidence: entry.evidence || { excerpt: entry.detail },
        suggestion: spec.suggestion, actionIds,
      });
    }
  }

  // info findings that don't deduct points
  if (kind === 'instruction' && sessionsSeen >= 5 && sessionsInjected === 0 && exposureDays < 14) {
    addFinding(findings, {
      id: 'info.new-instruction', dimension: 'inject', severity: 'info',
      title: '新说明书，注入样本不足', detail: `已存在 ${exposureDays} 天，窗口内 0 次注入；暂不据此判死。`,
      evidence: { excerpt: `exposure ${exposureDays}d` }, suggestion: '再观察一个窗口。', actionIds: [],
    });
  }
  if (kind === 'agent' && subagentRuns === 0 && exposureDays < 45) {
    addFinding(findings, {
      id: 'info.new-agent', dimension: 'inject', severity: 'info',
      title: '新子代理，委派样本不足', detail: `已存在 ${exposureDays} 天，窗口内 0 次委派；暂不据此判死。`,
      evidence: { excerpt: `exposure ${exposureDays}d` }, suggestion: '再观察一个窗口。', actionIds: [],
    });
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  // ------------------------------------------------------------------ verdict
  const layerDim = dimensions.find((dim) => dim.id === 'layer');
  const layerScore = layerDim ? layerDim.score : 0;
  const verdict = computeVerdict({
    total, exposureDays, usage, injection, overlapMax, myContradictions, kind,
    sessionsInjected, subagentRuns, presetSessions, tokensPerInjection, layerScore, overlapName,
  });

  return {
    total,
    grade: g.code,
    letter: g.letter,
    tier: g.tier,
    rank: g.rank,
    confidence,
    delta: previousTotal != null ? round1(total - previousTotal) : null,
    dimensions,
    findings,
    suggestions,
    verdict,
  };
}

function computeVerdict(ctx) {
  const { total, exposureDays, usage, overlapMax, myContradictions, kind, tokensPerInjection, layerScore, overlapName } = ctx;
  const missing = injectEvidenceMissing(kind, { sessionsInjected: ctx.sessionsInjected }, usage, exposureDays);
  const archive = total < 55 && exposureDays >= 60 && (usage.sessions || 0) === 0 && overlapMax < 0.5;
  const trim = total < 70 || layerScore < 12.5 || tokensPerInjection > 2500;
  const watch = missing || myContradictions > 0;
  if (archive) {
    return { code: 'archive', label: '归档候选', reason: `总分 ${total}，长期无使用（exposure ${exposureDays} 天），且与邻居重叠低（${overlapMax.toFixed(2)}）。` };
  }
  if (trim) {
    const why = tokensPerInjection > 2500 ? `每次注入 ${tokensPerInjection} tokens 偏重`
      : layerScore < 12.5 ? `分层维度 ${layerScore}/25 偏低` : `总分 ${total} 偏低`;
    return { code: 'trim', label: '精简', reason: `${why}${overlapName ? `，与 ${overlapName} 重叠 ${overlapMax.toFixed(2)}` : ''}。` };
  }
  if (watch) {
    return { code: 'watch', label: '观察', reason: myContradictions > 0
      ? `存在跨文件矛盾规则；另：${exposureDays} 天无使用证据。`
      : `注入/使用证据缺失（${exposureDays} 天）。` };
  }
  return { code: 'keep', label: '保留', reason: `总分 ${total}，结构基本成立。` };
}

function summarizeDimension(id, score, max, metrics, context, evolution) {
  const ratio = max > 0 ? score / max : 0;
  if (id === 'inject') {
    if (ratio >= 0.8) return '注入/使用证据成立，常驻成本可控';
    if ((context.injection?.sessionsInjected ?? 0) === 0 && (context.usage?.exposureDays ?? 0) >= 14) return '有覆盖但 0 注入证据';
    return '注入命中或唯一性有缺口';
  }
  if (id === 'layer') {
    if (ratio >= 0.8) return '入口精简，细节有外置';
    if (metrics.estTokens > 4000) return '入口过重，细节没有充分下沉';
    return '分层或外置还有改进空间';
  }
  if (id === 'actionable') {
    if (ratio >= 0.8) return '规则、验收、决策分支基本齐全';
    if (metrics.commands === 0) return '缺少可执行验收命令';
    return '祈使规则或反模式偏少';
  }
  if (id === 'governance') {
    if (ratio >= 0.8) return '作用域与职责边界清楚';
    return '作用域声明或边界需要补强';
  }
  if (id === 'evolution') {
    if (evolution.applicable !== true) return '无使用样本，本维度不评分';
    if (evolution.pending?.hasUnclosed) return '有信号尚未沉淀为经验';
    if (!(evolution.lessons?.count > 0)) return '有使用但未沉淀经验';
    return '经验沉淀与信号闭环基本成立';
  }
  if (ratio >= 0.8) return '无明显维护问题';
  if (metrics.todos > 0) return '存在未完成占位';
  if (metrics.staleRefs.length > 0) return '存在失效引用';
  return '有待清理项';
}

export { DIMENSIONS, severityRank, descriptionOverlap };
