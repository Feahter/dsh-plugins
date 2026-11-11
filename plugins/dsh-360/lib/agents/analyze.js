/**
 * Assemble one SubjectReport / the whole Portfolio from already-read raw files
 * and usage data. The host owns discovery and I/O; this module owns the
 * analysis pipeline and portfolio-level judgments.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { parseSkillMarkdown } from '../frontmatter.js';
import { extractMetrics } from './metrics.js';
import { scoreSubject } from './score.js';
import { detectConflicts } from './conflicts.js';
import { estimateTokens, round1, overlapTokens, slugify } from '../util.js';
import { createSimilarityModel } from '../similarity.js';
import { buildEvolution, parseLessons, LESSONS_BLOCK } from './evolution.js';
import { subjectId, scopeForInstruction } from './collect.js';
import { normalizeInjectionPath } from '../usage.js';
import { classifyAgent, classificationTags, taxonomyCatalog } from '../taxonomy.js';

export const RUBRIC_VERSION = '1.0';
const DAY_MS = 86_400_000;

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
  const key = corpusKey(entries);
  if (!similarityCache || similarityCache.key !== key) {
    similarityCache = { key, model: createSimilarityModel(entries) };
  }
  return similarityCache.model;
}

function deriveScope(subject) {
  if (subject.scope) return subject.scope;
  if (subject.kind === 'preset') return 'profile';
  if (subject.kind === 'agent') return 'skill';
  return scopeForInstruction(subject.path || '');
}

function firstH1(body) {
  const line = String(body || '').split('\n').find((entry) => /^#\s+/.test(entry)) || '';
  const match = /^#\s+(.+?)\s*#*\s*$/.exec(line) || /^#\s+(.+?)\s*$/.exec(line);
  return match ? match[1].trim() : null;
}

const BUILTIN_LEXICON = [
  'you are an ai agent', 'deepseek harness', 'use the read tool', 'delegate',
  'subagent', 'verify', 'check the exit code', 'send your result', 'workflow',
  'read the file before editing', 'working directory',
];

function builtinOverlap(body) {
  const tokens = overlapTokens(body);
  const builtin = new Set(BUILTIN_LEXICON.flatMap((phrase) => [...overlapTokens(phrase)]));
  if (builtin.size === 0) return 0;
  let shared = 0;
  for (const token of tokens) if (builtin.has(token)) shared += 1;
  return round1(Math.min(1, shared / builtin.size));
}

function similarityText(subject) {
  if (subject.kind === 'agent' || subject.kind === 'preset') return String(subject.description || '');
  return String(subject.body || '').slice(0, 4000);
}

function labelMatches(label, name, description) {
  const text = String(label || '').toLowerCase();
  const nameLower = String(name || '').toLowerCase();
  if (nameLower && text.includes(nameLower)) return true;
  const nameWords = nameLower.split(/[-_.\s]+/).filter((word) => word.length >= 3);
  if (nameWords.some((word) => text.includes(word))) return true;
  const descTokens = new Set(String(description || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []);
  const labelTokens = new Set(text.match(/[a-z][a-z0-9_-]{2,}/g) || []);
  let shared = 0;
  for (const token of labelTokens) if (descTokens.has(token)) shared += 1;
  return shared >= 2;
}

function aggregateSignals(sessions) {
  const record = {
    sessions: 0, reloads: 0, postLoadErrors: 0, corrections: 0, asks: 0, turnFailures: 0,
    lastSignalAt: null, samples: [],
  };
  for (const session of sessions || []) {
    record.sessions += 1;
    record.corrections += Number(session.corrections) || 0;
    record.postLoadErrors += Number(session.toolErrors) || 0;
    record.asks += Number(session.asks) || 0;
    if (session.turnFailed) record.turnFailures += 1;
    if (session.startedAt && (record.lastSignalAt === null || session.startedAt > record.lastSignalAt)) {
      record.lastSignalAt = session.startedAt;
    }
    if (session.corrections > 0) record.samples.unshift({ kind: 'correction', at: session.startedAt, sessionId: session.id, excerpt: '用户纠错' });
    if (session.toolErrors > 0) record.samples.unshift({ kind: 'error', at: session.startedAt, sessionId: session.id, excerpt: `工具报错 ${session.toolErrors} 次` });
    if (session.asks > 0) record.samples.unshift({ kind: 'ask', at: session.startedAt, sessionId: session.id, excerpt: `追问 ${session.asks} 次` });
    if (session.turnFailed) record.samples.unshift({ kind: 'turn-failure', at: session.startedAt, sessionId: session.id, excerpt: '回合未完成' });
  }
  record.samples = record.samples.slice(0, 6);
  return record;
}

function underPath(cwd, dir) {
  if (!cwd || !dir) return false;
  const a = String(cwd).replace(/[/\\]+$/, '');
  const b = String(dir).replace(/[/\\]+$/, '');
  return a === b || a.startsWith(b + '/') || a.startsWith(b + '\\');
}

/**
 * Attribute the raw usage digest to one subject.
 * @param {object} subject discoverSubjects entry
 * @param {object} digest collectUsage output
 * @param {{now?:number, windowDays?:number, defaultRoots?:string[]}} options
 * @returns {{usage:object, injection:object, signals:object}}
 */
export function matchUsage(subject, digest, { now = Date.now(), windowDays = 30 } = {}) {
  const sessions = Array.isArray(digest?.sessions) ? digest.sessions : [];
  const byPreset = digest?.byPreset || {};
  const signalsByPath = digest?.signalsByPath || {};
  const kind = subject.kind;
  const scope = deriveScope(subject);
  const absPath = subject.path ? normalizeInjectionPath(subject.path) : '';
  const mtime = subject.mtime != null ? Number(subject.mtime) : null;
  const exposureDays = mtime ? Math.max(0, Math.min(365, Math.floor((now - mtime) / DAY_MS))) : 0;

  let usage = {
    sessions: 0, lastUsedAt: null, windowDays, exposureDays,
    sufficient: (digest?.available ?? false), perWeek: 0, presetSessions: 0, subagentRuns: 0,
  };
  const injection = {
    mode: kind === 'instruction' ? (scope === 'global' ? 'always' : scope === 'project' ? 'workspace' : 'on-demand')
      : kind === 'agent' ? 'on-demand' : 'config',
    sessionsSeen: 0, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 0, duplicatedWith: [],
  };
  let signals = { sessions: 0, reloads: 0, postLoadErrors: 0, corrections: 0, asks: 0, turnFailures: 0, lastSignalAt: null, samples: [] };

  if (kind === 'instruction') {
    const injectedSessions = sessions.filter((session) => (session.injected || []).includes(absPath));
    if (scope === 'global') {
      injection.sessionsSeen = sessions.length;
    } else if (scope === 'project') {
      injection.sessionsSeen = sessions.filter((session) => underPath(session.cwd, subject.dir) || (session.injected || []).includes(absPath)).length;
    } else {
      injection.sessionsSeen = injectedSessions.length;
    }
    injection.sessionsInjected = injectedSessions.length;
    for (const session of injectedSessions) {
      if (session.startedAt && (injection.lastInjectedAt === null || session.startedAt > injection.lastInjectedAt)) {
        injection.lastInjectedAt = session.startedAt;
      }
    }
    usage.sessions = injection.sessionsInjected;
    usage.lastUsedAt = injection.lastInjectedAt;
    usage.sufficient = injection.sessionsSeen >= 5;
    signals = signalsByPath[absPath] || signals;
  } else if (kind === 'agent') {
    const matched = sessions.filter((session) => (session.delegatedLabels || []).some((label) => labelMatches(label, subject.name, subject.description)));
    let runs = 0;
    for (const session of matched) {
      const count = (session.delegatedLabels || []).filter((label) => labelMatches(label, subject.name, subject.description)).length;
      runs += count;
      if (session.startedAt && (usage.lastUsedAt === null || session.startedAt > usage.lastUsedAt)) usage.lastUsedAt = session.startedAt;
    }
    usage.sessions = matched.length;
    usage.subagentRuns = runs;
    usage.sufficient = digest?.available ?? false;
    signals = aggregateSignals(matched);
    injection.sessionsSeen = matched.length;
    injection.sessionsInjected = 0;
  } else {
    const presetRecord = byPreset[subject.name];
    usage.presetSessions = Number(presetRecord?.sessions) || 0;
    usage.sessions = usage.presetSessions;
    usage.lastUsedAt = presetRecord?.lastUsedAt != null ? Number(presetRecord.lastUsedAt) || null : null;
    usage.sufficient = digest?.available ?? false;
    const presetSessions = sessions.filter((session) => session.preset === subject.name);
    signals = aggregateSignals(presetSessions);
    injection.sessionsSeen = usage.presetSessions;
    injection.sessionsInjected = usage.presetSessions;
    injection.lastInjectedAt = usage.lastUsedAt;
  }

  if (exposureDays > 0) {
    usage.perWeek = Math.round((usage.sessions / Math.max(1, exposureDays / 7)) * 100) / 100;
  }
  return { usage, injection, signals };
}

/**
 * Analyze one subject into a full SubjectReport (INTERFACE §2.1).
 * @param {object} input { subject, raw?, body?, files?, usage?, injection?, siblings?, options?, previousTotal?, evolution?, digest? }
 */
export function analyzeSubject(input) {
  const subject = input.subject || {};
  const options = input.options || {};
  const now = Number(options.now) || Date.now();
  const kind = subject.kind || 'instruction';
  const path = subject.path || input.path || '';
  const dir = subject.dir || (path ? dirname(path) : null);
  const scope = deriveScope(subject);
  const files = Array.isArray(input.files) ? input.files : [];
  const siblings = Array.isArray(input.siblings) ? input.siblings : [];
  const id = subject.id || subjectId(kind, path, subject.name);

  // ---- body / frontmatter
  let raw = input.raw ? String(input.raw) : '';
  let body = input.body ? String(input.body) : '';
  let description = String(subject.description || '');
  let frontmatter = null;
  let coverage = 'partial';

  if (raw) {
    if (kind === 'agent') {
      try {
        const parsed = parseSkillMarkdown(raw);
        frontmatter = { ok: true, name: parsed.data.name, description: parsed.data.description };
        description = String(parsed.data.description ?? description);
        body = body || parsed.body;
      } catch {
        frontmatter = null;
      }
    }
    body = body || raw;
  }
  if (body) coverage = 'full';

  // ---- usage / injection
  let usage;
  let injection;
  let signals;
  if (input.usage && input.injection) {
    usage = input.usage;
    injection = input.injection;
    signals = input.signals || (input.evolution && input.evolution.signals) || null;
  } else if (input.digest) {
    const matched = matchUsage(subject, input.digest, { now, windowDays: options.windowDays });
    usage = matched.usage;
    injection = matched.injection;
    signals = matched.signals;
  } else {
    usage = input.usage || { sessions: 0, lastUsedAt: null, windowDays: options.windowDays || 30, exposureDays: 0, sufficient: false, perWeek: 0, presetSessions: 0, subagentRuns: 0 };
    injection = input.injection || { mode: 'on-demand', sessionsSeen: 0, sessionsInjected: 0, lastInjectedAt: null, tokensPerInjection: 0, duplicatedWith: [] };
    signals = (input.evolution && input.evolution.signals) || null;
  }
  injection.tokensPerInjection = kind === 'instruction' ? estimateTokens(body) : 0;

  // ---- metrics
  const resolveHref = dir
    ? (href) => {
      const clean = String(href || '').split('#')[0].split('?')[0].trim();
      if (!clean) return true;
      if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return true;
      const target = clean.startsWith('~/')
        ? resolve(homedir(), clean.slice(2))
        : isAbsolute(clean) ? clean : resolve(dir, clean);
      return existsSync(target);
    }
    : null;
  const metrics = input.metrics || extractMetrics({ body, kind, files, description, frontmatter, resolveHref });
  metrics.builtinOverlap = builtinOverlap(body);

  // ---- overlaps
  const siblingEntries = siblings.filter((sibling) => sibling && sibling.id !== id).map((sibling) => ({
    name: sibling.id, description: similarityText(sibling),
  }));
  const model = similarityFor(id, similarityText({ kind, description, body }), siblingEntries);
  let overlapMax = 0;
  let overlapName = '';
  const overlaps = [];
  for (const sibling of siblings) {
    if (!sibling || !sibling.id || sibling.id === id) continue;
    const score = model.similarity(id, sibling.id);
    if (score > overlapMax) { overlapMax = score; overlapName = sibling.id; }
    if (score >= 0.35) {
      overlaps.push({ id: sibling.id, name: sibling.id, score, sharedTriggers: model.shared(id, sibling.id) });
    }
  }
  overlaps.sort((a, b) => b.score - a.score);

  // ---- evolution
  const evolutionInput = input.evolution && typeof input.evolution === 'object' ? input.evolution : {};
  const lessons = evolutionInput.lessons
    ? evolutionInput.lessons
    : parseLessons(evolutionInput.lessonsRaw || '');
  const linked = evolutionInput.linked === true || body.includes(LESSONS_BLOCK.start);
  const evolution = buildEvolution({
    signals: signals || evolutionInput.signals || {},
    usage: { sessions: usage.sessions },
    lessons,
    linked,
    now,
  });

  // ---- score
  const scored = scoreSubject(metrics, {
    kind, name: subject.name || basename(path || ''), id, description, scope, coverage,
    usage, injection, conflicts: input.conflicts || [], overlaps, siblings, overlapMax, overlapName,
    evolution, options: { ...options, now }, rawBody: body, files,
    config: subject.config, usageAvailable: (input.digest?.available ?? options.usageAvailable ?? false),
    mtimeMissing: subject.mtime == null, previousTotal: input.previousTotal ?? null,
  });

  const report = {
    id,
    kind,
    name: subject.name || basename(path || ''),
    title: firstH1(body),
    scope,
    source: subject.source || (kind === 'preset' ? 'profile-config' : 'filesystem'),
    path: path || null,
    dir,
    owner: subject.owner || null,
    mtime: subject.mtime != null ? Number(subject.mtime) : null,
    coverage,
    description: description || null,
    metrics,
    injection,
    usage,
    evolution,
    score: {
      total: scored.total,
      grade: scored.grade,
      letter: scored.letter,
      tier: scored.tier,
      rank: scored.rank,
      confidence: scored.confidence,
      delta: scored.delta,
      dimensions: scored.dimensions,
    },
    verdict: scored.verdict,
    findings: scored.findings,
    suggestions: scored.suggestions,
    overlaps: scored.overlaps || overlaps.slice(0, 5).map((overlap) => ({
      id: overlap.id, name: overlap.name, score: overlap.score, sharedTriggers: overlap.sharedTriggers,
    })),
    body,
  };
  // Classification (TAXONOMY-SPEC §3) is computed last: `kind` mirrors the
  // subject kind, `scope` derives from the host attribution plus path, and
  // `state` needs usage / evolution / findings. `input.conflicts` is the
  // portfolio's conflict pass when the caller already ran it.
  report.classification = classifyAgent(report, {
    bodyText: body,
    conflicts: Array.isArray(input.conflicts) ? input.conflicts : [],
    cwd: options.cwd,
    home: options.home,
  });
  if (raw && kind === 'agent' && !frontmatter) report.rawError = 'frontmatter 解析失败，仅按正文分析';
  return report;
}

/**
 * @param {object[]} reports
 * @param {object} meta { generatedAt?, windowDays?, sessionsScanned?, usageAvailable?, previous?, roots?, options? }
 */
export function buildPortfolio(reports, meta = {}) {
  const generatedAt = Number(meta.generatedAt) || Date.now();
  const options = meta.options || {};
  const list = reports.map((report) => ({ ...report, score: { ...report.score }, verdict: { ...report.verdict } }));
  const taxonomy = taxonomyCatalog('agents');
  // Invariant (TAXONOMY-SPEC §3): every subject carries a classification.
  for (const report of list) {
    if (!report.classification) report.classification = classifyAgent(report);
  }

  const byId = new Map(list.map((report) => [report.id, report]));
  for (const report of list) {
    const best = report.overlaps.find((overlap) => overlap.score >= 0.6);
    if (!best) continue;
    const sibling = byId.get(best.id || best.name);
    if (sibling && sibling.score.total >= report.score.total + 5 && report.verdict.code !== 'archive') {
      report.verdict = {
        code: 'merge', label: '合并候选',
        reason: `与 ${sibling.name} 重叠 ${best.score.toFixed(2)}，且对方总分高 ${round1(sibling.score.total - report.score.total)} 分；建议保留一个入口。`,
      };
    }
  }

  list.sort((a, b) => a.score.total - b.score.total || a.id.localeCompare(b.id));

  const grades = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
  const gradeCodes = {};
  const counts = { instructions: 0, agents: 0, presets: 0 };
  let residentTokens = 0;
  let staleRefsTotal = 0;
  let secretsTotal = 0;
  const zeroInject = [];
  const staleRefs = [];
  const secretsList = [];
  for (const report of list) {
    const letter = report.score.letter || (report.score.grade ? report.score.grade[0] : 'E');
    grades[letter] = (grades[letter] || 0) + 1;
    const code = report.score.grade || 'E-';
    gradeCodes[code] = (gradeCodes[code] || 0) + 1;
    if (report.kind === 'instruction') {
      counts.instructions += 1;
      residentTokens += Number(report.injection.tokensPerInjection) || 0;
      if (report.injection.sessionsSeen >= 5 && report.injection.sessionsInjected === 0) {
        zeroInject.push({ id: report.id, name: report.name });
      }
    } else if (report.kind === 'agent') {
      counts.agents += 1;
    } else {
      counts.presets += 1;
    }
    staleRefsTotal += report.metrics.staleRefs.length;
    for (const ref of report.metrics.staleRefs) staleRefs.push({ id: report.id, ref: ref.ref, line: ref.line });
    secretsTotal += report.metrics.secrets + report.metrics.dangerous;
    if (report.metrics.secrets > 0 || report.metrics.dangerous > 0) {
      secretsList.push({ id: report.id, name: report.name, secrets: report.metrics.secrets, dangerous: report.metrics.dangerous });
    }
  }

  const conflicts = detectConflicts(list).filter((conflict) => conflict.kind === 'contradiction' || conflict.ratio >= 0.6);
  // Portfolio-level conflict badges (§2.4): detectConflicts needs the whole
  // portfolio, so the state cannot be derived in analyzeSubject alone. Clone the
  // classification so the caller's reports are never mutated.
  const conflictState = taxonomy.axes
    .find((axis) => axis.id === 'state')?.values
    .find((value) => value.id === 'conflict');
  if (conflictState) {
    const conflictIds = new Set();
    for (const conflict of conflicts) {
      const ids = Array.isArray(conflict.subjects) ? conflict.subjects : [conflict.a, conflict.b];
      for (const id of ids) if (id) conflictIds.add(id);
    }
    for (const report of list) {
      const classification = report.classification;
      if (!conflictIds.has(report.id) || !classification) continue;
      if ((classification.state || []).some((state) => state.id === conflictState.id)) continue;
      const enriched = {
        ...classification,
        state: [...(classification.state || []), { id: conflictState.id, label: conflictState.label }],
      };
      enriched.tags = classificationTags(enriched);
      report.classification = enriched;
    }
  }

  const pairSeen = new Set();
  const overlapPairs = [];
  for (const report of list) {
    for (const overlap of report.overlaps || []) {
      if (overlap.score < 0.4) continue;
      const key = [report.id, overlap.id || overlap.name].sort().join('\u0000');
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      const left = byId.get(report.id);
      const right = byId.get(overlap.id || overlap.name);
      const merge = left?.verdict.code === 'merge' || right?.verdict.code === 'merge';
      overlapPairs.push({
        a: report.id, b: overlap.id || overlap.name, score: overlap.score,
        sharedTriggers: overlap.sharedTriggers || [], verdict: merge ? 'merge-candidate' : 'review',
      });
    }
  }
  overlapPairs.sort((a, b) => b.score - a.score);

  const quickWins = [];
  for (const report of list) {
    for (const suggestion of report.suggestions || []) {
      if (suggestion.kind !== 'auto') continue;
      const related = (report.findings || []).filter((finding) => (finding.actionIds || []).includes(suggestion.id));
      const gain = related.reduce((max, finding) => Math.max(max, lossForFinding(report, finding)), 0);
      quickWins.push({ id: report.id, name: report.name, actionId: suggestion.id, title: suggestion.title, gain: round1(gain || 2) });
    }
  }
  quickWins.sort((a, b) => b.gain - a.gain || a.name.localeCompare(b.name));

  const previous = meta.previous
    && Number(meta.previous.avgScore) >= 0
    && meta.previous.rubricVersion === RUBRIC_VERSION
    ? { generatedAt: meta.previous.generatedAt || null, avgScore: round1(meta.previous.avgScore) }
    : null;
  const avgScore = list.length > 0 ? round1(list.reduce((sum, report) => sum + report.score.total, 0) / list.length) : 0;

  const evolutionList = list
    .map((report) => {
      const evolution = report.evolution && typeof report.evolution === 'object' ? report.evolution : {};
      const lessons = evolution.lessons || {};
      const pending = evolution.pending || {};
      return {
        id: report.id, name: report.name, pendingScore: Number(pending.score) || 0,
        hasUnclosed: pending.hasUnclosed === true,
        lastSignalAt: pending.lastSignalAt != null ? Number(pending.lastSignalAt) || null : null,
        lessons: Number(lessons.count) || 0, linked: lessons.linked === true,
        draft: pending.draft || null,
      };
    })
    .filter((entry) => entry.hasUnclosed)
    .sort((a, b) => b.pendingScore - a.pendingScore || a.name.localeCompare(b.name))
    .slice(0, 10);

  const deltaAvg = previous ? round1(avgScore - previous.avgScore) : null;

  return {
    generatedAt,
    rubricVersion: RUBRIC_VERSION,
    windowDays: Number(meta.windowDays) || 30,
    sessionsScanned: Number(meta.sessionsScanned) || 0,
    usageAvailable: meta.usageAvailable !== false,
    roots: Array.isArray(meta.roots) ? meta.roots : [],
    taxonomy,
    totals: {
      subjects: list.length,
      instructions: counts.instructions,
      agents: counts.agents,
      presets: counts.presets,
      avgScore,
      grades,
      gradeCodes,
      residentTokens,
      zeroInject: zeroInject.length,
      conflicts: conflicts.length,
      staleRefs: staleRefsTotal,
      secrets: secretsTotal,
      byRole: axisCounts(list, taxonomy, 'role'),
      byKind: axisCounts(list, taxonomy, 'kind'),
      byScope: axisCounts(list, taxonomy, 'scope'),
    },
    previous,
    deltaAvg,
    trend: buildTrend(list, previous, generatedAt, deltaAvg),
    subjects: list,
    conflicts,
    overlaps: overlapPairs,
    quickWins: quickWins.slice(0, 8),
    evolution: evolutionList,
    issues: { zeroInject, staleRefs, secrets: secretsList, conflicts },
  };
}

/**
 * Count one classification axis in catalog order (zero buckets dropped), so
 * key order stays stable regardless of report order.
 * @param {object[]} list
 * @param {object} taxonomy
 * @param {'role'|'kind'|'scope'} axisId
 */
function axisCounts(list, taxonomy, axisId) {
  const axis = (taxonomy.axes || []).find((entry) => entry.id === axisId);
  const counts = {};
  if (!axis) return counts;
  for (const value of axis.values) counts[value.id] = 0;
  for (const report of list) {
    const value = report.classification && report.classification[axisId];
    const id = value && typeof value === 'object' ? value.id : null;
    if (id && counts[id] !== undefined) counts[id] += 1;
  }
  const out = {};
  for (const value of axis.values) if (counts[value.id] > 0) out[value.id] = counts[value.id];
  return out;
}

/**
 * Portfolio trend from per-item `score.delta` plus previous meta (§3).
 *
 * No comparable previous scan (first scan, or a rubric-version reset) means no
 * trend: `null` fields, never a fake "0 changed". Items without a numeric
 * delta (null when no previous total was supplied) are skipped.
 */
function buildTrend(list, previous, generatedAt, deltaAvg) {
  if (!previous) {
    return { generatedAt, previousGeneratedAt: null, avgDelta: null, itemsChanged: null };
  }
  let sum = 0;
  let counted = 0;
  let itemsChanged = 0;
  for (const report of list) {
    const raw = report.score ? report.score.delta : null;
    if (raw == null) continue;
    const delta = Number(raw);
    if (!Number.isFinite(delta)) continue;
    sum += delta;
    counted += 1;
    if (delta !== 0) itemsChanged += 1;
  }
  return {
    generatedAt,
    previousGeneratedAt: previous.generatedAt != null ? previous.generatedAt : null,
    avgDelta: counted > 0 ? round1(sum / counted) : deltaAvg,
    itemsChanged: counted > 0 ? itemsChanged : 0,
  };
}

function lossForFinding(report, finding) {
  const dimension = report.score.dimensions.find((dim) => dim.id === finding.dimension);
  const item = dimension?.items.find((entry) => finding.id.startsWith(entry.id) || entry.id === finding.id);
  if (!item) return 2;
  return Math.max(0, item.max - item.score);
}
