/**
 * Assemble one SkillReport / the whole Portfolio from already-read raw files
 * and usage data. The host owns discovery and I/O; this module owns the
 * analysis pipeline and portfolio-level judgments.
 */
import { basename, dirname } from 'node:path';
import { parseSkillMarkdown } from '../frontmatter.js';
import { extractMetrics } from './metrics.js';
import { scoreSkill } from './score.js';
import { estimateTokens, round1, timestampId } from '../util.js';
import { createSimilarityModel } from '../similarity.js';
import { buildEvolution, parseLessons } from './evolution.js';

export const RUBRIC_VERSION = '2.0';
const DAY_MS = 86_400_000;

/** Reuse one IDF model across all skills of a scan (same sibling corpus). */
let similarityCache = null;

function corpusKey(entries) {
  let hash = 2166136261;
  for (const entry of entries) {
    const value = `${entry.name}\u0000${entry.description}\u0001`;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${entries.length}:${(hash >>> 0).toString(36)}`;
}

function similarityFor(name, description, siblings) {
  const entries = [];
  const seen = new Set();
  for (const sibling of siblings || []) {
    if (!sibling || typeof sibling.name !== 'string' || seen.has(sibling.name)) continue;
    seen.add(sibling.name);
    entries.push({ name: sibling.name, description: String(sibling.description || '') });
  }
  if (!seen.has(name)) entries.push({ name, description: String(description || '') });
  else {
    const existing = entries.find((entry) => entry.name === name);
    if (existing) existing.description = String(description || '');
  }
  const key = corpusKey(entries);
  if (!similarityCache || similarityCache.key !== key) {
    similarityCache = { key, model: createSimilarityModel(entries) };
  }
  return similarityCache.model;
}

/**
 * @param {object} input
 * @param {{name:string,description:string,whenToUse?:string,source?:string,provider?:string,path?:string,dir?:string}} input.summary
 * @param {string} [input.raw] full SKILL.md text
 * @param {string} [input.body] content fallback when raw is unavailable
 * @param {{path:string,chars:number}[]} [input.files]
 * @param {{count:number,lastUsedAt:number|null,windowDays:number,sufficient:boolean}} [input.usage]
 * @param {{name:string,description:string,total?:number}[]} [input.siblings]
 * @param {{catalogDescriptionMaxLength?:number,now?:number}} [input.options]
 * @param {number|null} [input.mtime]
 * @param {number|null} [input.previousTotal]
 */
export function analyzeSkill(input) {
  const summary = input.summary || {};
  const options = input.options || {};
  const now = Number(options.now) || Date.now();
  const path = summary.path || input.path || '';
  const dir = summary.dir || (path ? dirname(path) : '');
  const dirName = dir ? basename(dir) : '';
  let parsed = null;
  let coverage = 'partial';
  let raw = '';
  const files = Array.isArray(input.files) ? input.files : [];

  if (input.raw) {
    raw = String(input.raw);
    try {
      parsed = parseSkillMarkdown(raw);
      coverage = 'full';
    } catch {
      parsed = null;
    }
  }
  if (!input.raw && input.body) coverage = 'partial';
  const body = parsed?.body ?? input.body ?? '';
  if (!body) coverage = 'partial';
  const description = String(parsed?.data?.description ?? summary.description ?? '');
  const whenToUse = typeof parsed?.data?.whenToUse === 'string'
    ? parsed.data.whenToUse
    : (summary.whenToUse ?? null);
  const name = String(parsed?.data?.name ?? summary.name ?? dirName);

  const metrics = extractMetrics({
    body,
    files,
    description,
    catalogDescriptionMaxLength: options.catalogDescriptionMaxLength || 500,
  });

  // ------------------------------------------------------------- overlap
  const similarity = similarityFor(name, description, input.siblings || []);
  let overlapMax = 0;
  let overlapName = '';
  const overlaps = [];
  for (const sibling of input.siblings || []) {
    if (!sibling || !sibling.name || sibling.name === name) continue;
    const otherDescription = String(sibling.description || '');
    if (!otherDescription) continue;
    const score = similarity.similarity(name, sibling.name);
    if (score > overlapMax) {
      overlapMax = score;
      overlapName = sibling.name;
    }
    if (score >= 0.35) {
      overlaps.push({
        name: sibling.name,
        score,
        description: otherDescription,
        sharedTriggers: similarity.shared(name, sibling.name),
      });
    }
  }
  overlaps.sort((a, b) => b.score - a.score);
  metrics.overlapMax = overlapMax;
  metrics.overlapName = overlapName;

  const mtime = Number(input.mtime) || null;
  const ageDays = mtime ? Math.max(0, Math.min(365, Math.floor((now - mtime) / DAY_MS))) : 0;
  // mtime alone is a bad age proxy: a fresh deploy/copy resets it. If the
  // scanned session window covers at least two weeks, treat the skill as
  // exposed for that window unless it is genuinely older than it.
  const evidenceDays = Number(options.sessionSpanDays) || 0;
  const firstSeen = Number(input.usage?.firstSeen) || 0;
  const seenDays = firstSeen > 0 ? Math.max(0, Math.min(365, Math.floor((now - firstSeen) / DAY_MS))) : 0;
  // firstSeen is the precise catalog exposure signal. A session-file mtime
  // span is only a fallback when the catalog scanner saw no entry for this
  // skill; using both via max() would inflate a just-added skill to 14+ days.
  const exposureDays = firstSeen > 0
    ? seenDays
    : Math.min(365, Math.max(ageDays, evidenceDays >= 14 ? evidenceDays : 0));
  const sessionsScanned = Number(options.sessionsScanned) || 0;
  const catalogSessions = Number(input.usage?.catalogSessions) || 0;
  // A short but dense session history (e.g. 70 sessions in 4 days) is real
  // evidence when the skill actually appeared in those catalogs. This avoids
  // judging a skill added this morning by yesterday's zero calls.
  const enoughEvidence = exposureDays >= 14
    || (exposureDays >= 2 && (catalogSessions >= 30 || sessionsScanned >= 30));
  const usage = {
    count: Number(input.usage?.count) || 0,
    lastUsedAt: Number(input.usage?.lastUsedAt) || null,
    windowDays: Number(input.usage?.windowDays) || Number(options.windowDays) || 30,
    exposureDays,
    sufficient: Boolean(input.usage?.sufficient) && enoughEvidence,
    perWeek: 0,
    sessionSpanDays: evidenceDays,
    sessionsScanned,
    catalogSessions,
  };
  if (exposureDays > 0) {
    usage.perWeek = Math.round((usage.count / Math.max(1, exposureDays / 7)) * 100) / 100;
  }

  // ------------------------------------------------------------- evolution
  const evolutionInput = input.evolution && typeof input.evolution === 'object' ? input.evolution : {};
  const evolutionLessons = parseLessons(evolutionInput.lessonsRaw);
  const evolutionLinked = evolutionInput.linked === true || body.includes('lessons.md');
  const evolution = buildEvolution({
    signals: evolutionInput.signals,
    loads: usage.count,
    lessons: evolutionLessons,
    linked: evolutionLinked,
    prompts: evolutionInput.prompts,
    description,
    now,
  });

  const scored = scoreSkill(metrics, {
    name,
    dirName,
    description,
    whenToUse,
    coverage,
    usage,
    overlapMax,
    overlapName,
    overlaps,
    siblings: input.siblings || [],
    options: { ...options, now },
    rawBody: body,
    exposureDays,
    language: metrics.language,
    previousTotal: input.previousTotal ?? null,
    evolution,
  });

  const report = {
    name,
    source: summary.source || 'unknown',
    provider: summary.provider || 'unknown',
    path,
    dir,
    description,
    whenToUse,
    coverage,
    mtime,
    metrics,
    usage,
    evolution,
    score: {
      total: scored.total,
      grade: scored.grade,
      letter: scored.letter,
      tier: scored.tier,
      rank: scored.rank,
      confidence: scored.confidence,
      delta: input.previousTotal != null ? round1(scored.total - input.previousTotal) : null,
      dimensions: scored.dimensions,
    },
    verdict: scored.verdict,
    findings: scored.findings,
    suggestions: scored.suggestions,
    overlaps: scored.overlaps,
  };
  if (!parsed && raw) report.rawError = 'frontmatter 解析失败，仅按正文与 registry 元数据分析';
  return report;
}

/**
 * @param {object[]} reports
 * @param {{generatedAt?:number,windowDays?:number,sessionsScanned?:number,usageAvailable?:boolean,options?:object,previous?:object|null}} meta
 */
export function buildPortfolio(reports, meta = {}) {
  const generatedAt = Number(meta.generatedAt) || Date.now();
  const options = meta.options || {};
  const list = reports.map((report) => ({
    ...report,
    score: { ...report.score },
    verdict: { ...report.verdict },
  }));

  // Merge candidates need the sibling's total, which only exists here.
  const byName = new Map(list.map((report) => [report.name, report]));
  for (const report of list) {
    const best = report.overlaps.find((overlap) => overlap.score >= 0.6);
    if (!best) continue;
    const sibling = byName.get(best.name);
    if (sibling && sibling.score.total >= report.score.total + 5 && report.verdict.code !== 'archive') {
      report.verdict = {
        code: 'merge',
        label: '合并候选',
        reason: `与 ${best.name} 描述重叠 ${best.score.toFixed(2)}，且对方总分高 ${round1(sibling.score.total - report.score.total)} 分；建议保留一个入口或做成两个模式。`,
      };
    }
  }

  list.sort((a, b) => a.score.total - b.score.total || a.name.localeCompare(b.name));

  const grades = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
  const gradeCodes = {};
  let catalogTokens = 0;
  let fullLoadTokens = 0;
  let referenceFiles = 0;
  const bySource = {};
  const zeroUse = [];
  const truncated = [];
  const brokenLinks = [];
  const dangerous = [];
  const evolutionAgg = { skillsWithLessons: 0, lessonsTotal: 0, pendingSkills: 0, signalsTotal: 0 };
  for (const report of list) {
    const letter = report.score.letter || (report.score.grade ? report.score.grade[0] : 'E');
    grades[letter] = (grades[letter] || 0) + 1;
    const code = report.score.grade || 'E-';
    gradeCodes[code] = (gradeCodes[code] || 0) + 1;
    catalogTokens += estimateTokens(`${report.name} ${report.description.slice(0, options.catalogDescriptionMaxLength || 500)}`);
    fullLoadTokens += report.metrics.estTokens;
    referenceFiles += report.metrics.referenceCount;
    bySource[report.source] = (bySource[report.source] || 0) + 1;
    if (report.usage.sufficient && report.usage.count === 0) zeroUse.push(report.name);
    if (report.metrics.catalogTruncated) truncated.push(report.name);
    for (const link of report.metrics.brokenLinks) brokenLinks.push({ name: report.name, href: link.href, line: link.line });
    if (report.metrics.dangerous > 0 || report.metrics.secrets > 0) {
      dangerous.push({ name: report.name, dangerous: report.metrics.dangerous, secrets: report.metrics.secrets });
    }
    const evolution = report.evolution && typeof report.evolution === 'object' ? report.evolution : {};
    const lessons = evolution.lessons && typeof evolution.lessons === 'object' ? evolution.lessons : {};
    const pending = evolution.pending && typeof evolution.pending === 'object' ? evolution.pending : {};
    const signals = evolution.signals && typeof evolution.signals === 'object' ? evolution.signals : {};
    if (lessons.count > 0) evolutionAgg.skillsWithLessons += 1;
    evolutionAgg.lessonsTotal += Number(lessons.count) || 0;
    if (pending.hasUnclosed) evolutionAgg.pendingSkills += 1;
    evolutionAgg.signalsTotal += Number(signals.corrections) || 0;
    evolutionAgg.signalsTotal += Number(signals.postLoadErrors) || 0;
    evolutionAgg.signalsTotal += Number(signals.reloads) || 0;
    evolutionAgg.signalsTotal += Number(signals.turnFailures) || 0;
    evolutionAgg.signalsTotal += Number(signals.asks) || 0;
  }

  const pairSeen = new Set();
  const overlapPairs = [];
  for (const report of list) {
    for (const overlap of report.overlaps) {
      if (overlap.score < 0.4) continue;
      const key = [report.name, overlap.name].sort().join('\u0000');
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      const left = byName.get(report.name);
      const right = byName.get(overlap.name);
      const merge = left?.verdict.code === 'merge' || right?.verdict.code === 'merge';
      overlapPairs.push({
        a: report.name,
        b: overlap.name,
        score: overlap.score,
        sharedTriggers: overlap.sharedTriggers,
        verdict: merge ? 'merge-candidate' : 'review',
      });
    }
  }
  overlapPairs.sort((a, b) => b.score - a.score);

  const quickWins = [];
  for (const report of list) {
    for (const suggestion of report.suggestions || []) {
      if (suggestion.kind !== 'auto') continue;
      const related = (report.findings || []).filter((finding) => (finding.actionIds || []).includes(suggestion.id));
      // A finding may name several actions; do not double-count its loss for
      // each of them. "Expected gain" is the largest related loss, capped.
      const gain = related.reduce((max, finding) => Math.max(max, lossForFinding(report, finding)), 0);
      quickWins.push({
        name: report.name,
        actionId: suggestion.id,
        title: suggestion.title,
        gain: round1(gain || 2),
      });
    }
  }
  quickWins.sort((a, b) => b.gain - a.gain || a.name.localeCompare(b.name));

  // Historical scores are only comparable within one rubric version. A
  // previous state saved under v1.0 (or with no version) must not be diffed.
  const previous = meta.previous
    && Number(meta.previous.avgScore) >= 0
    && meta.previous.rubricVersion === RUBRIC_VERSION
    ? { generatedAt: meta.previous.generatedAt || null, avgScore: round1(meta.previous.avgScore) }
    : null;
  const avgScore = list.length > 0 ? round1(list.reduce((sum, report) => sum + report.score.total, 0) / list.length) : 0;

  // Continuous-evolution portfolio rollup (SPEC §1.4): pending first, at most 10.
  const evolutionList = list
    .map((report) => {
      const evolution = report.evolution && typeof report.evolution === 'object' ? report.evolution : {};
      const lessons = evolution.lessons && typeof evolution.lessons === 'object' ? evolution.lessons : {};
      const pending = evolution.pending && typeof evolution.pending === 'object' ? evolution.pending : {};
      return {
        name: report.name,
        pendingScore: Number(pending.score) || 0,
        hasUnclosed: pending.hasUnclosed === true,
        lastSignalAt: pending.lastSignalAt != null ? Number(pending.lastSignalAt) || null : null,
        lessons: Number(lessons.count) || 0,
        linked: lessons.linked === true,
        draft: pending.draft && typeof pending.draft === 'object' ? pending.draft : null,
      };
    })
    // `pendingScore` is a weighted signal total that never decays; only an
    // unclosed signal (no lesson, or a lesson older than the latest signal)
    // belongs in the "needs a lesson" list.
    .filter((entry) => entry.hasUnclosed)
    .sort((a, b) => b.pendingScore - a.pendingScore || a.name.localeCompare(b.name))
    .slice(0, 10);
  const pendingEvolution = evolutionList.map((entry) => entry.name);

  return {
    generatedAt,
    rubricVersion: RUBRIC_VERSION,
    scanId: timestampId(new Date(generatedAt)),
    windowDays: Number(meta.windowDays) || 30,
    sessionsScanned: Number(meta.sessionsScanned) || 0,
    usageAvailable: meta.usageAvailable !== false,
    catalogDescriptionMaxLength: Number(options.catalogDescriptionMaxLength) || 500,
    totals: {
      skills: list.length,
      avgScore,
      grades,
      gradeCodes,
      catalogTokens,
      fullLoadTokens,
      zeroUse: zeroUse.length,
      referenceFiles,
      bySource,
      evolution: evolutionAgg,
    },
    previous,
    deltaAvg: previous ? round1(avgScore - previous.avgScore) : null,
    skills: list,
    overlaps: overlapPairs,
    quickWins: quickWins.slice(0, 8),
    evolution: evolutionList,
    issues: { zeroUse, truncated, brokenLinks, dangerous, pendingEvolution },
  };
}

function lossForFinding(report, finding) {
  const dimension = report.score.dimensions.find((dim) => dim.id === finding.dimension);
  const item = dimension?.items.find((entry) => finding.id.startsWith(entry.id) || entry.id === finding.id);
  if (!item) return 2;
  return Math.max(0, item.max - item.score);
}

