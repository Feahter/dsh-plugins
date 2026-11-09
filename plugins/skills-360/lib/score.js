/**
 * Deterministic scoring + findings + safe suggestions for one skill.
 *
 * The rubric is documented in RUBRIC.md; every deduction here must point at a
 * measurable metric or a textual match, and the emitted finding must carry
 * evidence the UI can show. This module is pure: it never reads the disk.
 */
import {
  descriptionOverlap,
  excerpt,
  findReferenceSections,
  hasTriggerPhrase,
  isGenericOpener,
  round1,
  sharedOverlapTerms,
  triggerTerms,
  triggerPhraseIndex,
} from './util.js';

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_TITLE_RE = /overview|quick\s*start|quickstart|getting\s*started|decision|workflow|mode|usage|概览|快速开始|快速上手|决策|工作流|流程|模式|用法/i;
const WORKFLOW_TITLE_RE = /workflow|process|steps?|procedure|工作流|流程|步骤|操作/i;

const DIMENSIONS = [
  { id: 'load', label: '按需加载', max: 20 },
  { id: 'disclosure', label: '渐进披露', max: 25 },
  { id: 'actionability', label: '可执行性', max: 20 },
  { id: 'boundary', label: '边界与治理', max: 15 },
  { id: 'hygiene', label: '维护卫生', max: 10 },
  { id: 'evolution', label: '持续进化', max: 10 },
];

const INDEX_TITLE_RE = /参考|references?|资源|按需|索引|appendix|further\s+reading/i;
const DAY_MS = 86_400_000;

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
  const text = String(body).split('\n')[line - 1];
  return { line, excerpt: excerpt(text, 180) };
}

/**
 * Find the "index" sections (H2/H3 headings that announce on-demand reading)
 * and count how many `references/...` files they actually link to.
 * @param {string} rawBody
 * @returns {{hasIndex:boolean, indexRefs:number, sections:string[]}}
 */
function indexDisclosure(rawBody) {
  const lines = String(rawBody || '').split('\n');
  const sections = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!heading) continue;
    if (current) {
      current.endLine = i;
      sections.push(current);
    }
    current = { title: heading[2].trim(), startLine: i + 1, endLine: lines.length };
  }
  if (current) sections.push(current);
  const indexSections = sections.filter((section) => INDEX_TITLE_RE.test(section.title));
  const refPaths = new Set();
  for (const section of indexSections) {
    for (let i = section.startLine; i < Math.min(section.endLine, lines.length); i += 1) {
      for (const match of lines[i].matchAll(/\]\((references\/[^)\s]+)\)/g)) {
        refPaths.add(match[1]);
      }
    }
  }
  return { hasIndex: indexSections.length > 0, indexRefs: refPaths.size, sections: indexSections.map((section) => section.title) };
}

function addFinding(findings, { id, dimension, severity, title, detail, evidence, suggestion, actionIds = [] }) {
  if (findings.some((finding) => finding.id === id)) return;
  findings.push({ id, dimension, severity, title, detail, evidence, suggestion, actionIds });
}

function escalateSeverity(declared, loss, always) {
  // Severity follows the risk class first and the size of the loss second:
  // a 3-point loss on a 5.2k-token body is not "critical", and a 2-point
  // security finding still is.
  if (always) return declared;
  if (declared === 'critical' && loss < 6) return loss >= 4 ? 'major' : 'minor';
  if (declared === 'major' && loss < 4) return 'minor';
  if (declared === 'minor' && loss >= 6) return 'major';
  return declared;
}

function describeOverlap(overlapMax, overlapName) {
  if (!overlapName) return '未发现相似邻居';
  return `最高相似度 ${overlapMax.toFixed(2)}（与 ${overlapName}）`;
}

/** Build a draft description that front-loads a routing sentence. */
function draftDescription({ description, name, whenToUse, metrics, siblings }) {
  const first = String(description || '').split(/(?<=[。！？.!?])\s*/)[0] || '';
  const base = excerpt(first || description || name, 140).replace(/[。.!?！？]$/, '');
  const terms = [...triggerTerms(`${description} ${metrics.firstH2 || ''}`)];
  for (const sibling of siblings || []) {
    if (terms.length >= 6) break;
    if (!sibling.name) continue;
  }
  const fallback = (whenToUse || '').split(/[。.!?！？\n]/)[0];
  const triggers = terms.slice(0, 5);
  if (triggers.length === 0 && fallback) triggers.push(excerpt(fallback, 40));
  if (triggers.length === 0) triggers.push(name.replace(/-/g, ' '));
  return `${base} Use when: ${triggers.join('; ')}.`.replace(/\s+/g, ' ').trim();
}

/** Trim a description at a sentence boundary, keeping a trigger sentence. */
function trimDescription(description, max) {
  const text = String(description || '');
  if (text.length <= max) return text;
  const sentences = text.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
  const trigger = sentences.find((sentence) => hasTriggerPhrase(sentence)) || '';
  const picked = [];
  let used = 0;
  for (const sentence of [trigger, ...sentences]) {
    if (!sentence) continue;
    if (picked.includes(sentence)) continue;
    if (used + sentence.length > max - 1) continue;
    picked.push(sentence);
    used += sentence.length;
  }
  let result = picked.join('');
  if (!result) {
    const head = text.slice(0, max - 1);
    const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    result = cut > max * 0.5 ? head.slice(0, cut + 1) : head;
  }
  return result.replace(/\s+$/, '').slice(0, max - 1) + '…';
}

/** Move the trigger sentence earlier in the description. */
function frontloadDescription(description) {
  const sentences = String(description || '').split(/(?<=[。！？.!?])\s*/).filter(Boolean);
  const triggerIndex = sentences.findIndex((sentence) => hasTriggerPhrase(sentence));
  if (triggerIndex <= 0) return description;
  const ordered = [sentences[0], sentences[triggerIndex], ...sentences.filter((_, i) => i !== 0 && i !== triggerIndex)];
  return ordered.join('');
}

/**
 * Score one skill.
 * @param {object} metrics - from extractMetrics
 * @param {object} context
 * @returns {{total:number,grade:string,confidence:number,dimensions:object[],findings:object[],suggestions:object[],verdict:object}}
 */
export function scoreSkill(metrics, context) {
  const {
    name = '',
    dirName = '',
    description = '',
    coverage = 'full',
    usage = {},
    overlapMax = 0,
    overlapName = '',
    overlaps = [],
    siblings = [],
    options = {},
    rawBody = '',
    exposureDays = 0,
    evolution = {},
  } = context;
  const max = Number(options.catalogDescriptionMaxLength) > 0 ? options.catalogDescriptionMaxLength : 500;
  const now = Number(options.now) || Date.now();
  const items = {
    load: [],
    disclosure: [],
    actionability: [],
    boundary: [],
    hygiene: [],
    evolution: [],
  };
  const findings = [];
  const suggestions = [];

  // ------------------------------------------------------------ load: trigger
  const terms = triggerTerms(description);
  const phrase = hasTriggerPhrase(description);
  const phraseAt = triggerPhraseIndex(description);
  let triggerScore = 0;
  triggerScore += phrase ? 3 : 0;
  triggerScore += terms.size >= 6 ? 4 : terms.size >= 3 ? 3 : terms.size >= 1 ? 1 : 0;
  triggerScore += phraseAt >= 0 && phraseAt < 160 ? 2 : phraseAt >= 0 && phraseAt < description.length * 0.4 ? 1 : 0;
  triggerScore += description.length >= 40 && description.length <= max ? 2
    : description.length > max && description.length <= max * 1.4 ? 1 : 0;
  triggerScore += isGenericOpener(description) ? 0 : 1;
  items.load.push(item(
    'load.trigger',
    '触发可选中性',
    triggerScore,
    12,
    `${phrase ? '有触发句式' : '缺触发句式'}；识别到 ${terms.size} 个触发词；描述 ${description.length} 字符（目录上限 ${max}）。`,
    { evidence: { line: 1, excerpt: excerpt(description, 180) } },
  ));

  // ----------------------------------------------------------- load: evidence
  const usageSufficient = usage && usage.sufficient === true;
  let usageScore = 0;
  if (usageSufficient) {
    const count = Number(usage.count) || 0;
    const last = Number(usage.lastUsedAt) || 0;
    const recent = last > 0 && now - last <= 14 * 86400000;
    if (count >= 5 && recent) usageScore = 8;
    else if (count >= 2) usageScore = 6;
    else if (count === 1) usageScore = recent ? 4 : 3;
    else usageScore = exposureDays >= 45 ? 0 : 2;
  }
  items.load.push(item(
    'load.evidence',
    '按需加载证据',
    usageScore,
    8,
    usageSufficient
      ? `近 ${usage.windowDays ?? '?'} 天被加载 ${usage.count ?? 0} 次；最近 ${usage.lastUsedAt ? new Date(usage.lastUsedAt).toISOString().slice(0, 10) : '未使用'}；已存在 ${exposureDays} 天。加载次数是路径证据，不是价值判断；低频不等于低价值。`
      : '会话样本不足，本项不扣分（置信度已下调）。',
    { applicable: usageSufficient, evidence: usageSufficient ? { excerpt: `${usage.count ?? 0} loads / ${usage.windowDays ?? '?'}d` } : undefined },
  ));

  // ------------------------------------------------------------ load: unique
  const uniqueScore = overlapMax < 0.25 ? 6 : overlapMax < 0.45 ? 4 : overlapMax < 0.65 ? 2 : 0;
  items.load.push(item(
    'load.unique',
    '路由唯一性',
    uniqueScore,
    6,
    describeOverlap(overlapMax, overlapName),
    { evidence: overlapName ? { excerpt: `overlap ${overlapMax.toFixed(2)} with ${overlapName}` } : undefined },
  ));

  // ----------------------------------------------------------- load: catalog
  let catalogScore;
  if (description.length >= 80 && description.length <= max) catalogScore = 4;
  else if ((description.length >= 40 && description.length < 80) || (description.length > max && description.length <= max * 1.4)) catalogScore = 2;
  else catalogScore = 1;
  if (metrics.catalogTruncated && phrase) {
    const head = description.slice(0, max);
    if (!hasTriggerPhrase(head)) catalogScore = 0;
  }
  items.load.push(item(
    'load.catalog',
    '常驻成本',
    catalogScore,
    4,
    `目录实际注入 ${metrics.catalogChars} 字符${metrics.catalogTruncated ? `（原描述 ${description.length} 字符，已截断）` : ''}。`,
    { evidence: { line: 1, excerpt: excerpt(description.slice(Math.max(0, max - 80)), 120) } },
  ));

  // --------------------------------------------------------- disclosure: body
  const tokens = metrics.estTokens;
  let bodyScore = tokens <= 1800 ? 8 : tokens <= 3500 ? 7 : tokens <= 6000 ? 5 : tokens <= 9000 ? 3 : tokens <= 14000 ? 1 : 0;
  if (metrics.bodyLines > 800) bodyScore = Math.min(bodyScore, 5);
  if (metrics.bodyLines > 1500) bodyScore = Math.min(bodyScore, 2);
  items.disclosure.push(item(
    'disclosure.body',
    '入口精简',
    bodyScore,
    8,
    `SKILL.md ${metrics.bodyLines} 行 / ${metrics.bodyChars} 字符，约 ${tokens} tokens；加载即整篇进入上下文。`,
    { evidence: bodyEvidence(rawBody, /^#\s+/, '') },
  ));

  // --------------------------------------------------------- disclosure: refs
  let refScore;
  if (tokens <= 1800) refScore = 8;
  else if (metrics.referenceCount >= 2 && metrics.referencedFiles >= 1) refScore = 8;
  else if (metrics.referenceCount >= 1 && metrics.referencedFiles >= 1) refScore = 6;
  else if (metrics.referenceCount >= 1) refScore = 2;
  else refScore = 0;
  if (metrics.orphanReferences > 0) refScore -= 1;
  if (metrics.brokenLinks.length > 0) refScore -= 1;
  items.disclosure.push(item(
    'disclosure.refs',
    '细节外置',
    Math.max(0, refScore),
    8,
    `references/ 有 ${metrics.referenceCount} 个文件，正文链接到 ${metrics.referencedFiles} 个${metrics.orphanReferences ? `，${metrics.orphanReferences} 个未链接` : ''}。`,
    { evidence: metrics.references[0] ? { excerpt: metrics.references[0].path } : undefined },
  ));

  // ------------------------------------------------------- disclosure: layers
  let layerScore = metrics.h2 >= 3 ? 2 : metrics.h2 >= 1 ? 1 : 0;
  if (metrics.firstH2 && ENTRY_TITLE_RE.test(metrics.firstH2)) layerScore += 1;
  const firstSection = metrics.sections && metrics.sections[0];
  if (firstSection && firstSection.startLine <= 40 && ENTRY_TITLE_RE.test(firstSection.title)) layerScore += 1;
  const hasWorkflowSection = (metrics.sections || []).some((section) => WORKFLOW_TITLE_RE.test(section.title));
  if (metrics.numberedSteps > 0 || hasWorkflowSection) layerScore += 1;
  items.disclosure.push(item(
    'disclosure.layers',
    '分层入口',
    Math.min(5, layerScore),
    5,
    `H2 ${metrics.h2} 个；首个章节「${metrics.firstH2 || '无'}」；编号步骤 ${metrics.numberedSteps} 条。`,
  ));

  // -------------------------------------------------------- disclosure: dumps
  let dumpScore = 0;
  if (metrics.codeBlocks === 0) dumpScore = 4;
  else {
    dumpScore += metrics.maxCodeBlockLines <= 60 ? 2 : metrics.maxCodeBlockLines <= 120 ? 1 : 0;
    dumpScore += metrics.codeRatio <= 0.35 ? 2 : metrics.codeRatio <= 0.55 ? 1 : 0;
  }
  items.disclosure.push(item(
    'disclosure.dumps',
    '无内联堆积',
    dumpScore,
    4,
    `代码块 ${metrics.codeBlocks} 个（最长 ${metrics.maxCodeBlockLines} 行），占正文 ${Math.round(metrics.codeRatio * 100)}%。`,
  ));

  // -------------------------------------------------------- disclosure: index
  const refCountForIndex = metrics.referenceCount;
  const indexInfo = indexDisclosure(rawBody);
  let indexScore = 0;
  // Only judge the index once the facts are linked at all: references that are
  // never linked are already handled by `disclosure.refs`, and double-charging
  // them here would make one defect count twice.
  const indexApplicable = refCountForIndex > 0 && metrics.referencedFiles > 0;
  if (indexApplicable) {
    if (indexInfo.indexRefs >= 1) indexScore = (refCountForIndex >= 2 && indexInfo.indexRefs >= 2) ? 5 : 4;
    else indexScore = 2;
  }
  items.disclosure.push(item(
    'disclosure.index',
    '按需索引',
    indexScore,
    5,
    indexApplicable
      ? `索引章节 ${indexInfo.sections.length} 个，索引到 ${indexInfo.indexRefs} 个 references 文件。`
      : (refCountForIndex > 0
        ? 'references 尚未接进入口，本项不评分（由“细节外置”处理）。'
        : '无 references/ 目录，本项不评分。'),
    { applicable: indexApplicable, evidence: indexInfo.sections[0] ? { excerpt: indexInfo.sections[0] } : undefined },
  ));

  // --------------------------------------------------- actionability: fields
  let fieldScore = 0;
  fieldScore += coverage === 'full' ? 1 : 0;
  fieldScore += String(description || '').trim() ? 1 : 0;
  fieldScore += KEBAB_RE.test(name) ? 1 : 0;
  fieldScore += dirName ? (name === dirName ? 2 : 1) : 1;
  if (coverage !== 'full') fieldScore = Math.min(fieldScore, 3);
  items.actionability.push(item(
    'action.frontmatter',
    'Frontmatter 完整',
    fieldScore,
    5,
    `name=${name || '缺失'}；目录${dirName ? `名=${dirName}` : '不可读'}；描述${description ? '存在' : '缺失'}。`,
  ));

  // ---------------------------------------------------- actionability: steps
  const steps = metrics.numberedSteps;
  const stepScore = steps >= 5 ? 6 : steps >= 3 ? 5 : steps >= 1 ? 3 : metrics.commands >= 3 ? 3 : metrics.commands >= 1 ? 1 : 0;
  items.actionability.push(item(
    'action.steps',
    '操作步骤',
    stepScore,
    6,
    `编号步骤 ${steps} 条；命令/终端代码块 ${metrics.commands} 个。`,
  ));

  // ------------------------------------------------- actionability: examples
  const exampleScore = metrics.hasExamples
    ? (metrics.codeBlocks > 0 || /示例|例子|input|output/i.test(rawBody) ? 4 : 2)
    : metrics.codeBlocks > 0 ? 3 : 0;
  items.actionability.push(item(
    'action.examples',
    '示例',
    exampleScore,
    4,
    metrics.hasExamples ? '有示例/输入输出段。' : metrics.codeBlocks > 0 ? '有代码块，但没有示例标识。' : '未发现示例。',
  ));

  // ------------------------------------------------ actionability: decisions
  let decisionScore = metrics.decisionCount >= 2 ? 3 : metrics.decisionCount === 1 ? 2 : 0;
  if (metrics.hasAntiPatterns) decisionScore += 2;
  items.actionability.push(item(
    'action.decisions',
    '决策与反模式',
    Math.min(5, decisionScore),
    5,
    `决策语言 ${metrics.decisionCount} 处；${metrics.hasAntiPatterns ? '有反模式/禁止项' : '无反模式提示'}。`,
  ));

  // ----------------------------------------------------- boundary: when-not
  const descriptionBoundary = Boolean(metrics.hasWhenNotToUseDescription);
  const boundaryScore = metrics.hasWhenNotToUseSection ? 6
    : (metrics.hasWhenNotToUse || descriptionBoundary) ? 3 : 0;
  items.boundary.push(item(
    'boundary.when-not',
    '何时不用',
    boundaryScore,
    6,
    metrics.hasWhenNotToUseSection ? '有独立的“不适用/何时不用”小节。'
      : descriptionBoundary && !metrics.hasWhenNotToUse ? '描述里写了“不适用”，正文没有独立小节。'
        : metrics.hasWhenNotToUse ? '只在行内提到不适用，未独立成节。' : '未说明何时不该用。',
    { evidence: bodyEvidence(rawBody, /不适用|when not to use|not for/i) },
  ));

  // --------------------------------------------------- boundary: disambiguation
  let disambig = overlapMax < 0.35 ? 3 : overlapMax < 0.55 ? 2 : 0;
  const siblingMention = (siblings || []).some((sibling) => {
    if (!sibling.name || sibling.name === name) return false;
    return rawBody.toLowerCase().includes(sibling.name.toLowerCase())
      || String(description).toLowerCase().includes(sibling.name.toLowerCase());
  });
  if (siblingMention || /(?:^|\s)vs\.?\s|区别|instead|不要用/i.test(rawBody)) disambig += 2;
  items.boundary.push(item(
    'boundary.disambiguation',
    '兄弟区分',
    Math.min(5, disambig),
    5,
    `${describeOverlap(overlapMax, overlapName)}${siblingMention ? '；点名了邻居技能' : '；未点名邻居' }。`,
  ));

  // ------------------------------------------------------- boundary: language
  const hasCjk = /[\u3400-\u9fff]/.test(description);
  const hasLatin = /[A-Za-z]/.test(description);
  items.boundary.push(item(
    'boundary.language',
    '中英触发覆盖',
    hasCjk && hasLatin ? 4 : hasCjk || hasLatin ? 2 : 0,
    4,
    hasCjk && hasLatin ? '描述同时含中文与英文触发词。' : hasCjk ? '描述只有中文触发词。' : hasLatin ? '描述只有英文触发词。' : '描述无有效文字。',
  ));

  // ---------------------------------------------------- hygiene: placeholders
  items.hygiene.push(item(
    'hygiene.placeholders',
    '占位与未完成',
    metrics.todos > 0 ? 0 : 3,
    3,
    metrics.todos > 0 ? `发现 ${metrics.todos} 处 TODO/TBD/待补充。` : '未发现未完成标记。',
    { evidence: metrics.todos > 0 ? bodyEvidence(rawBody, /TODO|TBD|FIXME|待补充/i) : undefined },
  ));

  // --------------------------------------------------------- hygiene: links
  let linkScore = 3;
  if (metrics.brokenLinks.length > 0) linkScore = 1;
  else if (metrics.referenceCount > 0 && metrics.referencedFiles === 0) linkScore = 2;
  items.hygiene.push(item(
    'hygiene.links',
    '链接与资源',
    linkScore,
    3,
    metrics.brokenLinks.length > 0 ? `${metrics.brokenLinks.length} 个本地链接失效。`
      : metrics.referenceCount === 0 ? '无 references/ 目录（按 N/A 计满分）。'
        : `本地链接可解析；references 链接 ${metrics.referencedFiles}/${metrics.referenceCount}。`,
    { evidence: metrics.brokenLinks[0] ? { line: metrics.brokenLinks[0].line, excerpt: metrics.brokenLinks[0].href } : undefined },
  ));

  // ------------------------------------------------------ hygiene: security
  items.hygiene.push(item(
    'hygiene.security',
    '安全',
    metrics.dangerous > 0 || metrics.secrets > 0 ? 0 : 2,
    2,
    metrics.dangerous > 0 || metrics.secrets > 0
      ? `发现 ${metrics.dangerous} 处危险命令、${metrics.secrets} 处疑似密钥。`
      : '未发现危险命令或密钥痕迹。',
    { evidence: metrics.dangerous > 0 ? bodyEvidence(rawBody, /curl|wget|rm\s+-rf|chmod\s+777/i) : undefined },
  ));

  // -------------------------------------------------------- hygiene: volume
  const volumeOk = metrics.duplicateHeadings === 0 && metrics.bodyChars <= 200_000;
  items.hygiene.push(item(
    'hygiene.volume',
    '体积与重复',
    volumeOk ? 2 : 0,
    2,
    metrics.duplicateHeadings > 0 ? `有 ${metrics.duplicateHeadings} 个重复 H2 标题。`
      : metrics.bodyChars > 200_000 ? '正文超过 200KB。' : '标题无重复，体积可接受。',
  ));

  // ----------------------------------------------------- evolution: state
  const ev = evolution && typeof evolution === 'object' ? evolution : {};
  const evApplicable = ev.applicable === true;
  const evLessons = ev.lessons && typeof ev.lessons === 'object' ? ev.lessons : {};
  const evSignals = ev.signals && typeof ev.signals === 'object' ? ev.signals : {};
  const evPending = ev.pending && typeof ev.pending === 'object' ? ev.pending : {};
  const evPrompt = ev.promptRecall && typeof ev.promptRecall === 'object' ? ev.promptRecall : {};
  const evLessonsCount = Number(evLessons.count) || 0;
  const evLatestAt = evLessons.latestAt != null ? Number(evLessons.latestAt) || null : null;
  const evLinked = evLessons.linked === true;
  const evLastSignalAt = evSignals.lastSignalAt != null ? Number(evSignals.lastSignalAt) || null : null;
  const evPendingScore = Number(evPending.score) || 0;
  const evHasUnclosed = evPending.hasUnclosed === true;

  // ---------------------------------------------------- evolution: lessons
  let lessonsScore = 0;
  if (evLessonsCount >= 3 && evLinked) lessonsScore = 5;
  else if (evLessonsCount >= 1 && evLinked) lessonsScore = 4;
  else if (evLessonsCount >= 1) lessonsScore = 2;
  items.evolution.push(item(
    'evolution.lessons',
    '经验沉淀',
    lessonsScore,
    5,
    evLessonsCount === 0
      ? 'references/lessons.md 还没有经验条目。'
      : `沉淀 ${evLessonsCount} 条经验${evLinked ? '，已接进入口' : '，未接进入口'}。`,
  ));

  // -------------------------------------------------- evolution: freshness
  const freshnessApplicable = evLatestAt != null;
  let freshnessScore = 0;
  if (freshnessApplicable) {
    const age = now - evLatestAt;
    freshnessScore = age <= 90 * DAY_MS ? 3 : age <= 180 * DAY_MS ? 2 : age <= 365 * DAY_MS ? 1 : 0;
  }
  items.evolution.push(item(
    'evolution.freshness',
    '经验新鲜度',
    freshnessScore,
    3,
    freshnessApplicable
      ? `最近一条经验 ${new Date(evLatestAt).toISOString().slice(0, 10)}。`
      : '无经验，本项不评分。',
    { applicable: freshnessApplicable },
  ));

  // ---------------------------------------------------- evolution: closure
  const closureApplicable = evLessonsCount > 0 || evPendingScore > 0;
  let closureScore = 0;
  if (closureApplicable) {
    if (evLessonsCount > 0) {
      // `pending.hasUnclosed` already compares at the same day granularity as
      // parseLessons; reuse it so the item can never say "covered" while the
      // portfolio still lists the skill as unclosed.
      closureScore = evHasUnclosed ? 1 : 2;
    } else {
      closureScore = 0;
    }
  }
  items.evolution.push(item(
    'evolution.closure',
    '信号闭环',
    closureScore,
    2,
    closureApplicable
      ? (evLessonsCount > 0
        ? (closureScore === 2 ? '最新经验已覆盖最近信号。' : '存在未闭环信号（晚于最新经验），尚未沉淀。')
        : '有信号但无经验，尚未闭环。')
      : '无信号且无经验，本项不评分。',
    { applicable: closureApplicable },
  ));

  // --------------------------------------------------------------- dimensions
  const disclosureCap = metrics.estTokens > 20000 ? 8
    : metrics.estTokens > 12000 ? 12
      : metrics.estTokens > 6000 ? 16
        : dimMax('disclosure');
  const dimensions = DIMENSIONS.map((dim) => {
    if (dim.id === 'evolution' && !evApplicable) {
      return {
        id: 'evolution',
        label: dim.label,
        score: 0,
        max: dim.max,
        applicable: false,
        summary: '窗口内没有按需加载样本，本维度不评分；其余五维按 90 分折算为 100。',
        items: items.evolution.map((entry) => ({ ...entry, applicable: false })),
      };
    }
    const list = items[dim.id];
    const applicableEntries = list.filter((entry) => entry.applicable);
    const earned = applicableEntries.reduce((sum, entry) => sum + entry.score, 0);
    const possible = applicableEntries.reduce((sum, entry) => sum + entry.max, 0);
    let scaled = possible > 0 ? (earned / possible) * dim.max : 0;
    // A single 60KB SKILL.md cannot be "good progressive disclosure" no matter
    // how tidy the other sub-items look. This cap is documented in RUBRIC.md.
    if (dim.id === 'disclosure') scaled = Math.min(scaled, disclosureCap);
    return {
      id: dim.id,
      label: dim.label,
      score: round1(scaled),
      max: dim.max,
      applicable: true,
      summary: summarizeDimension(dim.id, scaled, dim.max, metrics, usage, ev),
      items: list,
    };
  });
  const fiveDimTotal = dimensions
    .filter((dim) => dim.id !== 'evolution')
    .reduce((sum, dim) => sum + dim.score, 0);
  const total = evApplicable
    ? round1(dimensions.reduce((sum, dim) => sum + dim.score, 0))
    : round1(fiveDimTotal * 100 / 90);
  const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';
  let confidence = coverage === 'full' ? 0.9 : 0.5;
  if (!usageSufficient) confidence -= 0.1;
  if (usageSufficient && (usage.count ?? 0) === 0 && exposureDays < 45) confidence -= 0.1;
  if (metrics.bodyChars === 0) confidence = Math.min(confidence, 0.4);
  confidence = Math.max(0.2, Math.min(1, round1(confidence)));

  // -------------------------------------------------------------- suggestions
  const existingIds = new Set(suggestions.map((suggestion) => suggestion.id));
  const addSuggestion = (suggestion) => {
    if (existingIds.has(suggestion.id)) return suggestion;
    existingIds.add(suggestion.id);
    suggestions.push(suggestion);
    return suggestion;
  };

  if (metrics.referenceCount > 0 && metrics.referencedFiles === 0) {
    addSuggestion({
      id: 'fix.link-references',
      kind: 'auto',
      title: `把 ${metrics.referenceCount} 个 references 文件接进入口`,
      why: '正文没提 references/，模型不知道这些按需资源存在，渐进披露失效。',
      risk: '低：只追加一个参考资源清单，不改原内容。',
      action: { type: 'link-references', params: { refs: metrics.references.map((ref) => ref.path) } },
      preview: { before: excerpt(rawBody.slice(-200), 160), after: '追加「参考资源」清单，链接到 references/。' },
    });
  }

  if (tokens > 3500) {
    const candidates = findReferenceSections(rawBody);
    if (candidates.length > 0) {
      const moved = candidates.reduce((sum, section) => sum + section.lines, 0);
      addSuggestion({
        id: 'fix.extract-sections',
        kind: 'auto',
        title: `把 ${candidates.length} 个参考型章节拆到 references/`,
        why: `预计从入口移出 ${moved} 行，正文降到约 ${Math.max(0, tokens - Math.round(moved * 25))} tokens；原内容逐字保留。`,
        risk: '低：整节搬移并在原位留指针，可撤销；移动后请人工确认入口仍完整。',
        action: { type: 'extract-sections', params: { titles: candidates.map((section) => section.title) } },
        preview: {
          before: candidates.map((section) => section.title).join(' / '),
          after: candidates.map((section) => `references/${section.title}`).join(' / '),
        },
      });
    }
  }

  if (description.length > max * 1.4) {
    const after = trimDescription(description, max);
    addSuggestion({
      id: 'fix.trim-description',
      kind: 'draft',
      title: `把描述压缩到 ${max} 字符内`,
      why: `当前 ${description.length} 字符，目录只保留前 ${max} 字符；截断可能吃掉触发句。`,
      risk: '中：会删掉部分描述文字（保留触发句与首句），可撤销。',
      action: { type: 'trim-description', params: { max, text: after } },
      preview: { before: excerpt(description, 200), after: excerpt(after, 200) },
    });
  }

  if (phraseAt > description.length * 0.6) {
    const after = frontloadDescription(description);
    if (after !== description) {
      addSuggestion({
        id: 'fix.frontload-triggers',
        kind: 'auto',
        title: '把触发句前移到描述开头',
        why: `触发句位于描述 ${Math.round((phraseAt / Math.max(1, description.length)) * 100)}% 处，目录截断或快速扫描时容易漏看。`,
        risk: '低：只调整句子顺序，不删字。',
        action: { type: 'frontload-triggers', params: { text: after } },
        preview: { before: excerpt(description, 200), after: excerpt(after, 200) },
      });
    }
  }

  if (!phrase) {
    const after = draftDescription({ description, name, whenToUse: context.whenToUse, metrics, siblings });
    if (after && after !== description) {
      addSuggestion({
        id: 'fix.rewrite-description',
        kind: 'draft',
        title: '补一句明确的触发描述',
        why: '目录只注入 description；没有 “Use when / 当用户…” 这类路由句，模型很难主动选中它。',
        risk: '中：生成的是草稿，应用前请读一遍；可撤销。',
        action: { type: 'rewrite-description', params: { text: after } },
        preview: { before: excerpt(description, 200), after: excerpt(after, 200) },
      });
    }
  }

  if (!metrics.hasWhenNotToUse) {
    const zh = context.language !== 'en';
    const section = zh
      ? '## 何时不用\n\n- 请补充：不适用本技能的任务/输入。\n- 请补充：应该改用哪个技能或流程。'
      : '## When not to use\n\n- Fill in: tasks or inputs this skill does not fit.\n- Fill in: which skill or workflow to use instead.';
    addSuggestion({
      id: 'fix.add-boundary',
      kind: 'draft',
      title: '补一个“何时不用”小节',
      why: '没有负向边界，模型容易在不适用的任务上误加载，浪费上下文并给出错误流程。',
      risk: '中：只追加骨架，需要你补两条具体内容；可撤销。',
      action: { type: 'add-boundary', params: { text: section } },
      preview: { before: '（无）', after: excerpt(section, 160) },
    });
  }

  if (evHasUnclosed) {
    const draft = evPending.draft && typeof evPending.draft === 'object' ? evPending.draft : {};
    addSuggestion({
      id: 'fix.add-lesson',
      kind: 'draft',
      title: '沉淀一条“触发→做法”经验',
      why: `窗口内出现 ${evPendingScore} 个加载后信号（纠错/报错/重复加载/失败），还没有对应经验。`,
      risk: '中：会向 references/lessons.md 追加一条经验并接进入口；可撤销。',
      action: { type: 'add-lesson', params: { lesson: { trigger: String(draft.trigger || ''), rule: '', evidence: String(draft.evidence || '') } } },
      preview: { before: '（未沉淀）', after: `${draft.trigger || '（待补触发）'} → （待补做法）` },
    });
  }

  // ----------------------------------------------------------------- findings
  const findingSpec = {
    'load.trigger': {
      severity: 'major',
      title: '描述触发面不足',
      detail: 'catalog 只注入 description；触发句/触发词不足时，该触发的时候模型不会选中它。',
      suggestion: '把 “Use when / 当用户…” 放到前 160 字符，并列出 3–6 个具体触发词。',
      actions: ['fix.rewrite-description', 'fix.frontload-triggers'],
    },
    'load.evidence': {
      severity: 'major',
      title: '窗口内 0 次按需加载',
      detail: '按 `skill` 工具统计为 0 次；用户 `/name` 直呼或宿主不经工具注入不会计入。',
      suggestion: '对照真实请求检查触发词；被邻居抢走则补边界或合并。',
      actions: [],
    },
    'load.unique': {
      severity: 'major',
      title: '与邻居技能高度重叠',
      detail: '描述相似会让路由在多个 skill 之间摇摆，两个都不稳。',
      suggestion: '在描述里写清与邻居的分工，或合并成一个入口 + 两个模式。',
      actions: [],
    },
    'load.catalog': {
      severity: 'minor',
      title: '目录成本偏高或被截断',
      detail: '每次会话都要固定注入这段描述；过长或过短都不利于路由。',
      suggestion: '压到 80–500 字符，并把最重要的触发词放在前 160 字符。',
      actions: ['fix.trim-description', 'fix.frontload-triggers'],
    },
    'disclosure.body': {
      severity: 'critical',
      title: 'SKILL.md 过大，渐进披露不足',
      detail: 'skill 工具一次加载整篇正文；入口越厚，单次触发越贵，也越容易挤掉任务上下文。',
      suggestion: '把参考型章节拆到 references/，正文只留入口、决策表和执行步骤。',
      actions: ['fix.extract-sections'],
    },
    'disclosure.refs': {
      severity: 'major',
      title: '细节没有外置或没接进入口',
      detail: 'references/ 存在但正文不链接，模型不会知道可以去读；完全没有 references 则所有细节都被迫常驻入口。',
      suggestion: '在正文末尾加“参考资源”清单，按需链接 references/ 文件。',
      actions: ['fix.link-references', 'fix.extract-sections'],
    },
    'disclosure.layers': {
      severity: 'minor',
      title: '缺少分层入口',
      detail: '没有概览/快速开始/决策分支，模型必须读完全文才能知道从哪下手。',
      suggestion: '在正文开头加 5–10 行概览 + 决策表，细节放后续章节或 references/。',
      actions: [],
    },
    'disclosure.dumps': {
      severity: 'minor',
      title: '正文里内联了大段代码/清单',
      detail: '长代码块会把入口撑大，且大多数场景只需要其中一个片段。',
      suggestion: '把完整代码/长清单移到 references/ 或 assets/，正文只留最小可运行片段。',
      actions: ['fix.extract-sections'],
    },
    'disclosure.index': {
      severity: 'major',
      title: 'references 没有入口索引',
      detail: 'references/ 存在但正文没有一个索引章节写清「什么时候读哪个文件」，模型不知道按需资源的存在。',
      suggestion: '在参考资源章节里逐个写清什么时候该读哪个文件。',
      actions: ['fix.link-references'],
    },
    'action.frontmatter': {
      severity: 'minor',
      title: 'frontmatter 不完整',
      detail: 'name/description/目录名不一致会让 catalog 展示与调用名对不上。',
      suggestion: '保持 name 为 kebab-case 且与目录名一致，description 非空。',
      actions: [],
    },
    'action.steps': {
      severity: 'major',
      title: '缺少可执行步骤',
      detail: '没有编号步骤或命令，模型只能自由发挥，输出稳定性差。',
      suggestion: '补 3–7 步编号流程，关键步骤给出命令或检查点。',
      actions: [],
    },
    'action.examples': {
      severity: 'minor',
      title: '缺少示例',
      detail: '示例是低成本高收益的锚点，能显著降低格式漂移。',
      suggestion: '补一个最小输入→输出示例，或一个典型调用片段。',
      actions: [],
    },
    'action.decisions': {
      severity: 'minor',
      title: '缺少决策分支与反模式',
      detail: '没有 if/otherwise 与“不要这样做”，模型在边界情况容易走偏。',
      suggestion: '补 2–3 条决策分支和 2–3 条常见错误。',
      actions: [],
    },
    'boundary.when-not': {
      severity: 'major',
      title: '未说明何时不用',
      detail: '没有负向边界，误触发会浪费一次完整加载并可能执行错误流程。',
      suggestion: '加一个“何时不用 / When not to use”小节，写清不适用任务与替代 skill。',
      actions: ['fix.add-boundary'],
    },
    'boundary.disambiguation': {
      severity: 'major',
      title: '与兄弟技能边界不清',
      detail: '描述或正文没有点名分工，路由只能靠猜。',
      suggestion: '在描述里写 “与 X 的区别：…”，或直接合并重叠部分。',
      actions: [],
    },
    'boundary.language': {
      severity: 'minor',
      title: '触发词只覆盖单一语言',
      detail: '用户的表述可能中英混用；只覆盖一种语言会漏触发。',
      suggestion: '在描述里补 2–3 个另一语言的同义触发词。',
      actions: [],
    },
    'hygiene.placeholders': {
      severity: 'major',
      title: '存在未完成占位',
      detail: 'TODO/TBD/待补充 会让模型把占位当指令执行。',
      suggestion: '补完或删除占位；未完成的内容移到草稿区。',
      actions: [],
    },
    'hygiene.links': {
      severity: 'major',
      title: '资源链接失效或未接上',
      detail: '坏链会让模型读到空内容；references 存在却不链接则等于没有。',
      suggestion: '修正本地链接；补参考资源清单。',
      actions: ['fix.link-references'],
    },
    'hygiene.security': {
      severity: 'critical',
      alwaysCritical: true,
      title: '发现危险命令或密钥痕迹',
      detail: 'skill 正文会被模型直接执行/引用，危险命令与密钥是高危项。',
      suggestion: '移除密钥，危险命令改成带确认的显式步骤。',
      actions: [],
    },
    'hygiene.volume': {
      severity: 'minor',
      title: '标题重复或文件异常大',
      detail: '重复章节通常意味着内容堆叠，维护成本与歧义都会上升。',
      suggestion: '合并重复章节，拆分超长文件。',
      actions: ['fix.extract-sections'],
    },
  };

  for (const dimension of dimensions) {
    for (const entry of dimension.items) {
      const loss = entry.applicable ? entry.max - entry.score : 0;
      if (loss < 2) continue;
      const spec = findingSpec[entry.id];
      if (!spec) continue;
      const actionIds = (spec.actions || []).filter((id) => existingIds.has(id));
      let title = spec.title;
      let detailPrefix = spec.detail;
      let severity = escalateSeverity(spec.severity, loss, spec.alwaysCritical);
      if (entry.id === 'boundary.when-not' && entry.score > 0) {
        title = '“何时不用”只写在行内，未独立成节';
        detailPrefix = '正文提到了不适用场景，但没有独立小节，模型在快速扫描时容易漏掉负向边界。';
      }
      if (entry.id === 'load.evidence') {
        const loadCount = Number(usage.count) || 0;
        title = loadCount === 0 ? '窗口内 0 次按需加载' : `按需加载次数偏低（${loadCount} 次）`;
        detailPrefix = loadCount === 0
          ? '只说明触发路径没有命中真实请求，不能说明技能没有价值。'
          : '加载次数是路径证据，不是价值判断；低频不等于低价值。';
        severity = loadCount === 0 ? 'major' : 'minor';
      }
      addFinding(findings, {
        id: entry.id,
        dimension: dimension.id,
        severity,
        title,
        detail: `${detailPrefix}（${entry.score}/${entry.max} 分）`,
        evidence: entry.evidence || { excerpt: entry.detail },
        suggestion: spec.suggestion,
        actionIds,
      });
    }
  }

  // Informational findings that do not by themselves deduct points.
  if (metrics.catalogTruncated && phrase) {
    addFinding(findings, {
      id: 'info.catalog-truncated',
      dimension: 'load',
      severity: 'info',
      title: '目录描述被截断',
      detail: `描述 ${description.length} 字符，超过当前口径 ${max} 字符；后半段触发词不会出现在 catalog。`,
      evidence: { line: 1, excerpt: excerpt(description.slice(Math.max(0, max - 40)), 120) },
      suggestion: '把触发句和最强触发词移到前 160 字符。',
      actionIds: existingIds.has('fix.frontload-triggers') ? ['fix.frontload-triggers'] : [],
    });
  }
  if (usageSufficient && (usage.count ?? 0) === 0 && exposureDays < 45) {
    addFinding(findings, {
      id: 'info.new-skill',
      dimension: 'load',
      severity: 'info',
      title: '新技能，样本还不足',
      detail: `已存在 ${exposureDays} 天，窗口内 0 次按需加载；暂不据此判死。`,
      evidence: { excerpt: `exposure ${exposureDays}d` },
      suggestion: '再观察一个使用窗口，或主动在相关任务里点名试用。',
      actionIds: [],
    });
  }

  // Evolution findings (SPEC §1.3): emitted explicitly so their severities
  // and titles stay precise instead of being derived from item-loss.
  if (evApplicable && evLessonsCount === 0) {
    addFinding(findings, {
      id: 'evolution.lessons',
      dimension: 'evolution',
      severity: 'minor',
      title: '有真实调用，但没有沉淀任何经验',
      detail: '窗口内有按需加载，但 references/lessons.md 还没有任何经验条目。（0/5 分）',
      evidence: { excerpt: 'lessons 0' },
      suggestion: '用 skills360_evolve 写一条“触发→做法”，或直接在面板沉淀经验。',
      actionIds: ['fix.add-lesson'],
    });
  }
  if (evLessonsCount > 0 && !evLinked) {
    addFinding(findings, {
      id: 'evolution.unlinked',
      dimension: 'evolution',
      severity: 'major',
      title: '经验文件没有接进入口',
      detail: `有 ${evLessonsCount} 条经验但正文没有链接 references/lessons.md，模型按需加载时读不到。`,
      evidence: { excerpt: 'references/lessons.md' },
      suggestion: '在参考资源章节里链接 references/lessons.md。',
      actionIds: ['fix.link-references'],
    });
  }
  if (evHasUnclosed) {
    const pendingSample = evPending.draft && typeof evPending.draft === 'object' ? evPending.draft : {};
    addFinding(findings, {
      id: 'evolution.pending',
      dimension: 'evolution',
      severity: evPendingScore >= 4 ? 'major' : 'minor',
      title: `${evPendingScore} 个调用后信号尚未沉淀`,
      detail: `最近证据：${pendingSample.evidence || '无'}${evSignals.lastSignalAt ? `（${new Date(evSignals.lastSignalAt).toISOString().slice(0, 10)}）` : ''}；摘要：${pendingSample.trigger || '（无）'}`,
      evidence: pendingSample.trigger ? { excerpt: pendingSample.trigger } : undefined,
      suggestion: '用 skills360_evolve 写一条“触发→做法”，或直接在面板沉淀经验。',
      actionIds: ['fix.add-lesson'],
    });
  }
  const evPromptTotal = Number(evPrompt.total) || 0;
  if (evPromptTotal >= 3 && evPrompt.recall != null && evPrompt.recall < 0.4) {
    const firstUnmatched = (evPrompt.samples && evPrompt.samples[0]) || null;
    addFinding(findings, {
      id: 'load.prompt-mismatch',
      dimension: 'load',
      severity: 'minor',
      title: '用户实际说法与描述触发词不匹配',
      detail: `${evPromptTotal} 条真实请求中只有 ${evPrompt.matched ?? 0} 条命中描述触发词（召回 ${Math.round((evPrompt.recall ?? 0) * 100)}%）。`,
      evidence: firstUnmatched ? { excerpt: firstUnmatched.excerpt } : undefined,
      suggestion: '对照真实请求的说法，把用户实际用词补进描述触发词。',
      actionIds: [],
    });
  }

  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  // ------------------------------------------------------------------ verdict
  const count = usageSufficient ? Number(usage.count) || 0 : 0;
  const archive = total < 55 && usageSufficient && count === 0 && exposureDays >= 60 && overlapMax < 0.5;
  const watch = total < 70 || (usageSufficient && count === 0 && exposureDays >= 30);
  const verdict = archive
    ? { code: 'archive', label: '归档候选', reason: `总分 ${total}，长期没有按需加载，且与邻居重叠低（${overlapMax.toFixed(2)}）。` }
    : watch
      ? { code: 'watch', label: '观察', reason: `总分 ${total}${usageSufficient ? `，窗口内 ${count} 次按需加载` : '，使用样本不足'}${overlapMax >= 0.35 ? `，与 ${overlapName} 重叠 ${overlapMax.toFixed(2)}` : ''}。` }
      : { code: 'keep', label: '保留', reason: `总分 ${total}，触发面与披露结构基本成立。` };

  return {
    total,
    grade,
    confidence,
    dimensions,
    findings,
    suggestions,
    verdict,
    overlaps: overlaps.slice(0, 5).map((overlap) => ({
      name: overlap.name,
      score: overlap.score,
      sharedTriggers: overlap.sharedTriggers || sharedOverlapTerms(description, overlap.description || ''),
    })),
  };
}

function dimMax(id) {
  return DIMENSIONS.find((dim) => dim.id === id)?.max ?? 0;
}

function summarizeDimension(id, score, max, metrics, usage, evolution) {
  const ratio = max > 0 ? score / max : 0;
  if (id === 'load') {
    if (ratio >= 0.8) return '触发清晰，按需加载路径成立';
    if (metrics.catalogTruncated) return '描述被截断，触发词有丢失风险';
    if (!usage.sufficient) return '使用样本不足，未据此扣分';
    if ((usage.count ?? 0) === 0) return '触发面尚可，但窗口内 0 次按需加载';
    return '触发面或唯一性有缺口';
  }
  if (id === 'evolution') {
    const ev = evolution && typeof evolution === 'object' ? evolution : {};
    const pending = ev.pending && typeof ev.pending === 'object' ? ev.pending : {};
    const lessons = ev.lessons && typeof ev.lessons === 'object' ? ev.lessons : {};
    if (ev.applicable !== true) return '窗口内没有按需加载样本，本维度不评分';
    if (pending.hasUnclosed) return '有真实调用信号尚未沉淀为经验';
    if (!(lessons.count > 0)) return '有加载但未沉淀经验';
    return '经验沉淀与信号闭环基本成立';
  }
  if (id === 'disclosure') {
    if (ratio >= 0.8) return '入口精简，细节有外置';
    if (metrics.estTokens > 6000) return '入口过重，细节没有充分下沉';
    return '分层或 references 还有改进空间';
  }
  if (id === 'actionability') {
    if (ratio >= 0.8) return '步骤、示例、决策分支基本齐全';
    if (metrics.numberedSteps === 0) return '缺少可照做的步骤';
    return '示例或反模式偏少';
  }
  if (id === 'boundary') {
    if (ratio >= 0.8) return '负向边界与兄弟分工清楚';
    if (!metrics.hasWhenNotToUse && !metrics.hasWhenNotToUseDescription) return '没有“何时不用”';
    return '与邻居的边界需要再点明';
  }
  if (ratio >= 0.8) return '无明显维护问题';
  if (metrics.todos > 0) return '存在未完成占位';
  if (metrics.brokenLinks.length > 0) return '存在失效链接';
  return '有待清理项';
}

function severityRank(severity) {
  return { critical: 0, major: 1, minor: 2, info: 3 }[severity] ?? 4;
}

export { DIMENSIONS, severityRank };
