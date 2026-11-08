/**
 * dsh-archive-rsi / alchemy — the PDCA core over archived session facts.
 *
 * This module turns `SessionFacts` (see DESIGN §3, produced by `archive.js`)
 * into measurable cohort metrics, findings with evidence, context proposals,
 * and finally writes an adopted proposal to disk. It never calls an LLM and
 * never invents evidence: every number is a deterministic function of facts.
 *
 * Design rules:
 * - Pure at the center: `cohortMetrics`, `deriveFindings`, `planRun`,
 *   `executeDo`, `executeCheck`, `proposalsFor`, `evaluateAdoptions` do no I/O
 *   and read no clock unless the caller injects `now`. That makes a run
 *   reproducible from the same facts.
 * - Defensive at the edges: facts may come from an older plugin version, so
 *   every counter/array is defaulted instead of trusted. No division ever
 *   yields `NaN` or `Infinity`.
 * - Evidence or nothing: a finding without a real `{sessionId, seq}` pair is
 *   dropped rather than reported without a pointer.
 * - Writes are atomic (tmp + rename) and confined to three roots: the store's
 *   `lessons.md`, the configured agents file, and `<skillsRoot>/<slug>/SKILL.md`.
 *
 * Only Node built-ins are used (fs/promises, path, os, crypto).
 */

import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

// --------------------------------------------------------------------------
// Constants (DESIGN §5, §5.1, §5.3, §6.1)
// --------------------------------------------------------------------------

/** Default plan targets, created by `rsi_plan` when the caller gives none. */
export const DEFAULT_TARGETS = [
  { metric: 'toolErrorRate', op: '<=', value: 0.05 },
  { metric: 'correctionRate', op: '<=', value: 0.15 },
  { metric: 'verificationGapRate', op: '<=', value: 0.3 },
  { metric: 'peakContextRatioP90', op: '<=', value: 0.6 },
  { metric: 'catalogBytes', op: '<=', value: 48000 },
];

const OPS = ['<=', '>=', '<', '>'];
const COHORT_STATUSES = ['archived', 'pinned', 'trash', 'all'];
const ADOPTABLE_KINDS = ['prompt-section', 'agents-md-rule', 'skill-candidate'];
const KIND_RISK = {
  'prompt-section': 'low',
  'agents-md-rule': 'medium',
  'skill-candidate': 'medium',
  advisory: 'low',
};
const LESSONS_TARGET = 'archive-rsi/lessons';
const MAX_EVIDENCE = 5;
const MAX_MERGED_TOOLS = 40;
const MAX_UNUSED_TOOLS = 20;
const EPSILON_RATIO = 0.02;
const EPSILON_FLOOR = 0.001;
const DEFAULT_COHORT = { days: 30, workspace: null, tag: null, status: 'all', limit: 40 };
const DEFAULT_MIN_SESSIONS = 3;

/** Lifecycle statuses a PDCA run may carry; `summarizeRun` derives one when absent. */
export const RUN_STATUSES = ['planned', 'running', 'checked', 'closed', 'failed'];
/** A running run is "stalled" once its heartbeat is older than this. */
export const RUN_STALE_MS = 10 * 60 * 1000;

// DESIGN §5.1: a human message counts as a correction when it matches either
// the Latin or the CJK form; the per-session contribution is capped at 3.
const CORRECTION_PATTERN =
  /(?:^|\s)(?:no[,.!]?\s|nope\b|wrong\b|incorrect\b|that's not|not what I|revert|undo that|try again|still (?:broken|failing|wrong)|didn'?t work)/i;
const CORRECTION_PATTERN_CJK = /(?:不对|不是这样|错了|搞错|重来|重新来|还是不行|没有用|别这么做|我说的不是|你又)/;
// DESIGN §5.3 R2.
const INVALID_ARG_PATTERN = /invalid|schema|parse|validation|unexpected|EINVALID|ENOENT.*arg/i;

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'just', 'what', 'when', 'then', 'than',
  'there', 'their', 'about', 'into', 'your', 'the', 'and', 'for', 'not', 'but',
  'all', 'any', 'can', 'should', 'would', 'could', 'because', 'again', 'still',
  'already', 'really', 'actually', 'only', 'also', 'make', 'made', 'does', 'did',
  'will', 'use', 'used', 'using', 'now', 'new', 'one', 'two', 'get', 'got',
  'say', 'said', 'see', 'saw', 'our', 'out', 'off', 'over', 'under', 'more',
  'most', 'some', 'such', 'very', 'much', 'many', 'need', 'needs', 'want',
  'like', 'look', 'looks', 'work', 'works', 'working', 'been', 'being', 'has',
  'had', 'its', 'was', 'were', 'are', 'is', 'it', 'you',
]);

// --------------------------------------------------------------------------
// Primitives (defensive parsing)
// --------------------------------------------------------------------------

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value) {
  return isPlainObject(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function divide(numerator, denominator, fallback = 0) {
  const top = toNumber(numerator);
  const bottom = toNumber(denominator);
  if (bottom === 0) return fallback;
  const result = top / bottom;
  return Number.isFinite(result) ? result : fallback;
}

function sumBy(list, pick) {
  let total = 0;
  for (const item of asArray(list)) total += toNumber(pick(item));
  return total;
}

function byName(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function clampInt(value, fallback, min, max) {
  const number = toNumber(value, NaN);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function formatPercent(rate) {
  const value = toNumber(rate) * 100;
  return `${value.toFixed(1)}%`;
}

function formatCount(value) {
  return String(Math.round(toNumber(value)));
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

/**
 * Resolve the injected clock. `now` may arrive on the options object or on the
 * primary argument (so both call styles work); the wall clock is only read when
 * the caller injected nothing.
 */
function resolveNow(...sources) {
  for (const source of sources) {
    const candidate = asObject(source).now;
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const ms = toTimestamp(candidate);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

function stamp(ms) {
  const iso = new Date(toNumber(ms)).toISOString();
  return iso.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorWithCode(code, message, hint = '') {
  const error = new Error(message);
  error.name = 'AlchemyError';
  error.code = code;
  if (hint) error.hint = hint;
  return error;
}

function expandHome(input) {
  const value = String(input || '');
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isInsidePath(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// --------------------------------------------------------------------------
// Percentiles (DESIGN §5.1, nearest-rank)
// --------------------------------------------------------------------------

/**
 * Nearest-rank percentile: sort ascending, rank = ceil(p * n) clamped to
 * [1, n], return the element at rank - 1. Empty input (or no finite numbers)
 * returns 0 — never NaN.
 *
 * @param {number[]} xs
 * @param {number} [p] in (0, 1]
 * @returns {number}
 */
export function percentile(xs, p = 0.5) {
  const values = [];
  for (const value of asArray(xs)) {
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) values.push(number);
  }
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  let quantile = toNumber(p, 0.5);
  if (quantile > 1) quantile = 1;
  const rank = Math.min(Math.max(Math.ceil(quantile * values.length) || 1, 1), values.length);
  return values[rank - 1];
}

/**
 * Median = nearest-rank 50th percentile.
 *
 * @param {number[]} xs
 * @returns {number}
 */
export function median(xs) {
  return percentile(xs, 0.5);
}

// --------------------------------------------------------------------------
// Per-session normalization (SessionFacts may come from an older version)
// --------------------------------------------------------------------------

/**
 * Correction matches of a session: human text entries matching the correction
 * pattern. Only text and seq are kept; `seq` is the anchor used as evidence.
 */
function correctionMatches(facts) {
  const matches = [];
  for (const entry of asArray(facts.humanTexts)) {
    const text = typeof entry?.text === 'string' ? entry.text : '';
    if (!text) continue;
    if (CORRECTION_PATTERN.test(text) || CORRECTION_PATTERN_CJK.test(text)) {
      matches.push({ seq: toNumber(entry?.seq), text });
    }
  }
  return matches;
}

function correctionCount(facts) {
  return Math.min(correctionMatches(facts).length, 3);
}

function seqList(value) {
  const seqs = [];
  for (const item of asArray(value)) {
    const seq = toNumber(item);
    if (seq > 0) seqs.push(seq);
  }
  return seqs;
}

/**
 * Flattened, defaulted view of the counters a metric needs. Every field is a
 * finite number, so downstream arithmetic cannot produce NaN.
 */
function sessionNumbers(facts) {
  const counters = asObject(facts.counters);
  const usage = asObject(facts.usage);
  const catalog = asObject(facts.catalog);
  const durations = asObject(facts.durations);
  const turnEnds = asObject(facts.turnEnds);
  const edits = asObject(facts.edits);
  const checks = asObject(facts.checks);

  const callsByName = new Map();
  for (const row of asArray(facts.tools)) {
    const name = nonEmptyString(row?.name);
    if (!name) continue;
    callsByName.set(name, toNumber(callsByName.get(name)) + toNumber(row?.calls));
  }

  const catalogTools = asArray(catalog.tools).filter((tool) => nonEmptyString(tool?.name));
  const catalogToolCount = toNumber(catalog.toolCount, catalogTools.length);
  let unusedCatalogTools = 0;
  for (const tool of catalogTools) {
    if (toNumber(callsByName.get(nonEmptyString(tool.name))) === 0) unusedCatalogTools += 1;
  }

  const inputTokens = toNumber(usage.inputTokens);
  const outputTokens = toNumber(usage.outputTokens);
  const declaredTotal = toNumber(usage.totalTokens, NaN);
  const totalTokens = Number.isFinite(declaredTotal) ? declaredTotal : inputTokens + outputTokens;

  const contextWindow = toNumber(facts.contextWindow);
  const peakInputTokens = toNumber(facts.peakInputTokens);
  let peakContextRatio = toNumber(facts.peakContextRatio, NaN);
  if (!Number.isFinite(peakContextRatio)) {
    peakContextRatio = contextWindow > 0 ? divide(peakInputTokens, contextWindow) : 0;
  }

  const editSeqs = seqList(edits.seqs);
  const editsCount = toNumber(edits.count, editSeqs.length);
  const afterLastEditChecks = toNumber(facts.afterLastEditChecks);

  return {
    turns: toNumber(counters.turns),
    steps: toNumber(counters.steps),
    toolCalls: toNumber(counters.toolCalls),
    toolResults: toNumber(counters.toolResults),
    toolErrors: toNumber(counters.toolErrors),
    failedTurns:
      toNumber(turnEnds.error) + toNumber(turnEnds['max-tokens']) + toNumber(turnEnds.aborted),
    catalogBytes: toNumber(catalog.bytes),
    catalogToolCount,
    unusedCatalogTools,
    skillCatalogBytes: toNumber(asObject(facts.skillCatalog).bytes),
    inputTokens,
    outputTokens,
    totalTokens,
    peakContextRatio,
    editsCount,
    editSeqs,
    checkSeqs: seqList(checks.seqs),
    afterLastEditChecks,
    hasEdits: editsCount > 0,
    editGap: editsCount > 0 && afterLastEditChecks === 0,
    durationMs: toNumber(durations.totalMs),
    repeatedCount: asArray(facts.repeated).length,
  };
}

// --------------------------------------------------------------------------
// cohortMetrics (DESIGN §5.1, field for field)
// --------------------------------------------------------------------------

/**
 * Aggregate a cohort of `SessionFacts`. Empty cohort → every number 0 and every
 * array empty (no NaN, no Infinity). Facts are tolerated with missing fields.
 *
 * @param {object[]} factsList
 * @returns {object} CohortMetrics
 */
export function cohortMetrics(factsList) {
  const facts = asArray(factsList).filter(isPlainObject);
  const total = facts.length;

  const metrics = {
    sessions: total,
    turns: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
    toolErrorRate: 0,
    correctionRate: 0,
    corrections: 0,
    verificationGapRate: 0,
    peakContextRatioP50: 0,
    peakContextRatioP90: 0,
    catalogBytes: 0,
    catalogToolCount: 0,
    catalogWasteRate: 0,
    skillCatalogBytes: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokensPerTurn: 0,
    turnFailureRate: 0,
    tools: [],
    unusedTools: [],
    repeatedCallSessions: 0,
    avgDurationMs: 0,
    p90DurationMs: 0,
  };
  if (total === 0) return metrics;

  const ratios = [];
  const durations = [];
  const toolMap = new Map();
  const catalogPresence = new Map();
  let wasteSum = 0;
  let editSessions = 0;
  let gapSessions = 0;
  let failedTurns = 0;

  for (const session of facts) {
    const numbers = sessionNumbers(session);
    metrics.turns += numbers.turns;
    metrics.toolCalls += numbers.toolCalls;
    metrics.toolResults += numbers.toolResults;
    metrics.toolErrors += numbers.toolErrors;
    metrics.corrections += correctionCount(session);
    metrics.catalogBytes = Math.max(metrics.catalogBytes, numbers.catalogBytes);
    metrics.catalogToolCount = Math.max(metrics.catalogToolCount, numbers.catalogToolCount);
    metrics.skillCatalogBytes = Math.max(metrics.skillCatalogBytes, numbers.skillCatalogBytes);
    metrics.inputTokens += numbers.inputTokens;
    metrics.outputTokens += numbers.outputTokens;
    metrics.totalTokens += numbers.totalTokens;
    failedTurns += numbers.failedTurns;
    if (numbers.repeatedCount > 0) metrics.repeatedCallSessions += 1;
    if (numbers.hasEdits) {
      editSessions += 1;
      if (numbers.editGap) gapSessions += 1;
    }
    ratios.push(numbers.peakContextRatio);
    if (numbers.durationMs > 0) durations.push(numbers.durationMs);
    if (numbers.catalogToolCount > 0) {
      wasteSum += divide(numbers.unusedCatalogTools, numbers.catalogToolCount);
    }

    for (const row of asArray(session.tools)) {
      const name = nonEmptyString(row?.name);
      if (!name) continue;
      const entry = toolMap.get(name) || { name, calls: 0, errors: 0, errorCodes: {} };
      entry.calls += toNumber(row?.calls);
      entry.errors += toNumber(row?.errors);
      const codes = asObject(row?.errorCodes);
      for (const code of Object.keys(codes)) {
        entry.errorCodes[code] = toNumber(entry.errorCodes[code]) + toNumber(codes[code]);
      }
      toolMap.set(name, entry);
    }

    for (const tool of asArray(asObject(session.catalog).tools)) {
      const name = nonEmptyString(tool?.name);
      if (!name) continue;
      const entry = catalogPresence.get(name) || { sessions: 0, bytes: 0 };
      entry.sessions += 1;
      entry.bytes = Math.max(entry.bytes, toNumber(tool?.bytes));
      catalogPresence.set(name, entry);
    }
  }

  metrics.toolErrorRate = divide(metrics.toolErrors, metrics.toolCalls);
  metrics.correctionRate = divide(metrics.corrections, metrics.turns);
  metrics.verificationGapRate = divide(gapSessions, editSessions);
  metrics.tokensPerTurn = divide(metrics.totalTokens, metrics.turns);
  metrics.turnFailureRate = divide(failedTurns, metrics.turns);
  metrics.peakContextRatioP50 = percentile(ratios, 0.5);
  metrics.peakContextRatioP90 = percentile(ratios, 0.9);
  metrics.catalogWasteRate = divide(wasteSum, total);
  metrics.avgDurationMs = divide(sumBy(durations, (value) => value), durations.length);
  metrics.p90DurationMs = percentile(durations, 0.9);

  metrics.tools = [...toolMap.values()]
    .map((entry) => ({
      name: entry.name,
      calls: entry.calls,
      errors: entry.errors,
      errorRate: divide(entry.errors, entry.calls),
      errorCodes: { ...entry.errorCodes },
    }))
    .sort((a, b) => b.calls - a.calls || byName(a.name, b.name))
    .slice(0, MAX_MERGED_TOOLS);

  const unusedTools = [];
  for (const [name, entry] of catalogPresence) {
    // "in catalog of >= 50% of sessions" and never called in the cohort.
    if (entry.sessions * 2 < total) continue;
    const row = toolMap.get(name);
    if (toNumber(row?.calls) > 0) continue;
    unusedTools.push({ name, bytes: entry.bytes });
  }
  unusedTools.sort((a, b) => b.bytes - a.bytes || byName(a.name, b.name));
  metrics.unusedTools = unusedTools.slice(0, MAX_UNUSED_TOOLS);

  return metrics;
}

// --------------------------------------------------------------------------
// Findings (DESIGN §5.2, §5.3)
// --------------------------------------------------------------------------

/**
 * Keep at most 5 pairs, spreading across distinct sessions first (one pair per
 * session), then filling with the remaining pairs in input order.
 */
function pickEvidence(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of asArray(candidates)) {
    if (!isPlainObject(candidate)) continue;
    const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId : '';
    if (!sessionId) continue;
    const seq = Math.max(0, Math.trunc(toNumber(candidate.seq)));
    const key = `${sessionId}#${seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ sessionId, seq });
  }
  const perSession = new Set();
  const spread = [];
  const rest = [];
  for (const item of unique) {
    if (perSession.has(item.sessionId)) rest.push(item);
    else {
      perSession.add(item.sessionId);
      spread.push(item);
    }
  }
  return spread.concat(rest).slice(0, MAX_EVIDENCE);
}

function sessionAnchors(facts, repeats) {
  const seqs = [];
  const push = (value) => {
    const seq = toNumber(value);
    if (seq > 0 && !seqs.includes(seq)) seqs.push(seq);
  };
  for (const entry of asArray(facts.humanTexts)) push(entry?.seq);
  for (const seq of seqList(asObject(facts.edits).seqs)) push(seq);
  for (const seq of seqList(asObject(facts.checks).seqs)) push(seq);
  for (const sample of asArray(facts.errorSamples)) push(sample?.seq);
  for (const repeat of repeats) for (const seq of repeat.seqs) push(seq);
  // Every session owns a header event that carries no seq; 0 is the
  // session-level anchor used only when the facts expose no event seq at all.
  if (seqs.length === 0) seqs.push(0);
  return seqs;
}

function buildRuleContext(factsList) {
  const context = [];
  for (const facts of asArray(factsList)) {
    if (!isPlainObject(facts)) continue;
    const sessionId = nonEmptyString(facts.sessionId);
    if (!sessionId) continue;
    const repeats = asArray(facts.repeated).map((row) => ({
      name: nonEmptyString(row?.name),
      times: toNumber(row?.times),
      seqs: seqList(row?.seqs),
    }));
    context.push({
      sessionId,
      facts,
      numbers: sessionNumbers(facts),
      corrections: correctionMatches(facts),
      samples: asArray(facts.errorSamples).map((sample) => ({
        seq: toNumber(sample?.seq),
        tool: nonEmptyString(sample?.tool),
        code: nonEmptyString(sample?.code),
        reason: typeof sample?.reason === 'string' ? sample.reason : '',
        callPreview: typeof sample?.callPreview === 'string' ? sample.callPreview : '',
        sessionId,
      })),
      repeats,
      anchors: sessionAnchors(facts, repeats),
      anchorsEvidence: sessionAnchors(facts, repeats).map((seq) => ({ sessionId, seq })),
    });
  }
  return context;
}

function addFinding(findings, counters, rule, fields) {
  const evidence = pickEvidence(fields?.evidence);
  if (evidence.length === 0) return false;
  const order = toNumber(counters[rule]) + 1;
  counters[rule] = order;
  findings.push({
    id: `f-${rule}-${order}`,
    rule,
    severity: fields.severity,
    title: fields.title,
    detail: fields.detail,
    metric: fields.metric,
    evidence,
    tool: fields.tool ? String(fields.tool) : null,
    count: toNumber(fields.count),
    advice: fields.advice,
  });
  return true;
}

function allAnchors(context) {
  const evidence = [];
  for (const session of context) evidence.push(...session.anchorsEvidence);
  return evidence;
}

/** R1 tool-error-hotspot. */
function ruleR1(metrics, context, push) {
  for (const row of asArray(metrics.tools)) {
    const calls = toNumber(row?.calls);
    const errorRate = toNumber(row?.errorRate);
    const name = nonEmptyString(row?.name);
    if (!name || calls < 5 || errorRate < 0.1) continue;
    const errors = toNumber(row?.errors);
    const evidence = [];
    for (const session of context) {
      for (const sample of session.samples) {
        if (sample.tool === name) evidence.push({ sessionId: sample.sessionId, seq: sample.seq });
      }
    }
    if (evidence.length === 0) evidence.push(...allAnchors(context));
    push('R1', {
      severity: errorRate >= 0.25 ? 'high' : 'medium',
      title: `Tool "${name}" fails ${formatPercent(errorRate)} of calls`,
      detail: `${errors} of ${calls} calls to ${name} failed (${formatPercent(errorRate)}). The errors are concentrated on one tool, so the fix belongs in its description or schema.`,
      metric: 'toolErrorRate',
      tool: name,
      count: errors,
      evidence,
      advice: `Rewrite the ${name} tool description so the failing argument shape is named before the call is made.`,
    });
  }
}

/** R2 invalid-arguments. */
function ruleR2(metrics, context, push) {
  for (const row of asArray(metrics.tools)) {
    const name = nonEmptyString(row?.name);
    if (!name) continue;
    const codes = asObject(row?.errorCodes);
    const matched = Object.keys(codes)
      .filter((code) => INVALID_ARG_PATTERN.test(code))
      .map((code) => ({ code, count: toNumber(codes[code]) }))
      .sort((a, b) => b.count - a.count || byName(a.code, b.code));
    const matchedCount = sumBy(matched, (entry) => entry.count);
    if (matchedCount < 3) continue;
    const evidence = [];
    for (const session of context) {
      for (const sample of session.samples) {
        if (sample.tool !== name) continue;
        if (!matched.some((entry) => entry.code === sample.code)) continue;
        evidence.push({ sessionId: sample.sessionId, seq: sample.seq });
      }
    }
    if (evidence.length === 0) evidence.push(...allAnchors(context));
    const top = matched[0];
    push('R2', {
      severity: 'high',
      title: `Invalid arguments to "${name}" (${formatCount(matchedCount)}x)`,
      detail: `${formatCount(matchedCount)} calls to ${name} failed argument validation, most often ${top.code} (${formatCount(top.count)}x). A schema or description defect is the likely cause.`,
      metric: 'toolErrorRate',
      tool: name,
      count: matchedCount,
      evidence,
      advice: `Tighten the ${name} parameter schema and give one literal valid call in its description.`,
    });
  }
}

/** R3 redundant-calls. */
function ruleR3(metrics, context, push) {
  const sessions = toNumber(metrics.sessions);
  const repeatedSessions = toNumber(metrics.repeatedCallSessions);
  if (sessions <= 0) return;
  if (divide(repeatedSessions, sessions) < 0.25 || repeatedSessions < 2) return;
  const worst = [];
  for (const session of context) {
    const rows = [...session.repeats].sort(
      (a, b) => b.times - a.times || byName(a.name, b.name),
    );
    if (rows.length === 0) continue;
    const row = rows[0];
    const seq = row.seqs.length > 0 ? row.seqs[row.seqs.length - 1] : session.anchors[0];
    worst.push({ name: row.name, times: row.times, sessionId: session.sessionId, seq });
  }
  worst.sort((a, b) => b.times - a.times || byName(a.sessionId, b.sessionId));
  push('R3', {
    severity: 'medium',
    title: `Identical calls repeated in ${formatCount(repeatedSessions)} of ${formatCount(sessions)} sessions`,
    detail: `${formatCount(repeatedSessions)} of ${formatCount(sessions)} sessions (${formatPercent(divide(repeatedSessions, sessions))}) re-issued a tool call with identical arguments${worst.length > 0 ? `; the worst repeated \`${worst[0].name}\` ${formatCount(worst[0].times)} times` : ''}.`,
    metric: 'repeatedCallSessions',
    tool: worst.length > 0 ? worst[0].name : null,
    count: repeatedSessions,
    evidence: worst.map((entry) => ({ sessionId: entry.sessionId, seq: entry.seq })),
    advice: 'Before repeating a call, re-read the previous result; identical arguments will not produce a different outcome.',
  });
}

/** R4 verification-gap. */
function ruleR4(metrics, context, push) {
  const rate = toNumber(metrics.verificationGapRate);
  if (rate < 0.3) return;
  const gap = context.filter((session) => session.numbers.editGap);
  const editSessions = context.filter((session) => session.numbers.hasEdits);
  const evidence = [];
  for (const session of gap.length > 0 ? gap : context) {
    const seqs = session.numbers.editSeqs;
    const seq = seqs.length > 0 ? seqs[seqs.length - 1] : session.anchors[0];
    evidence.push({ sessionId: session.sessionId, seq });
  }
  const gapCount = gap.length > 0
    ? gap.length
    : Math.max(1, Math.round(rate * Math.max(editSessions.length, 1)));
  push('R4', {
    severity: rate >= 0.5 ? 'high' : 'medium',
    title: `No verification after the last edit (${formatPercent(rate)})`,
    detail: `${formatCount(gapCount)} of ${formatCount(editSessions.length || gapCount)} sessions with edits ran no check command after the final edit (${formatPercent(rate)}). The change was never re-read by a command.`,
    metric: 'verificationGapRate',
    tool: null,
    count: gapCount,
    evidence,
    advice: 'After the last edit of a turn, run one check command before reporting completion.',
  });
}

function tokenizeText(text) {
  return String(text || '').toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
}

/** Most frequent non-stopword shared by at least half of the corrections. */
function dominantTopic(matching) {
  const counts = new Map();
  for (const entry of matching) {
    const words = new Set(tokenizeText(entry.text).filter((word) => !STOPWORDS.has(word)));
    for (const word of words) {
      const row = counts.get(word) || { count: 0, sessions: new Set() };
      row.count += 1;
      row.sessions.add(entry.sessionId);
      counts.set(word, row);
    }
  }
  let best = null;
  for (const [word, row] of counts) {
    if (row.count < 2) continue;
    if (!best || row.count > best.count || (row.count === best.count && byName(word, best.word) < 0)) {
      best = { word, count: row.count, sessions: row.sessions.size };
    }
  }
  if (!best) return null;
  if (best.count < Math.max(2, Math.ceil(matching.length / 2))) return null;
  return best;
}

function includesWord(text, word) {
  return tokenizeText(text).includes(word);
}

/** R5 correction-rate. */
function ruleR5(metrics, context, push) {
  const rate = toNumber(metrics.correctionRate);
  const corrections = toNumber(metrics.corrections);
  if (rate < 0.15 || corrections < 3) return;
  const matching = [];
  for (const session of context) {
    for (const entry of session.corrections) {
      matching.push({ sessionId: session.sessionId, seq: entry.seq, text: entry.text });
    }
  }
  const topic = dominantTopic(matching);
  const evidence = topic
    ? matching.filter((entry) => includesWord(entry.text, topic.word))
    : matching;
  const turns = toNumber(metrics.turns);
  push('R5', {
    severity: rate >= 0.3 ? 'high' : 'medium',
    title: topic
      ? `Corrections cluster on "${topic.word}" (${formatCount(topic.count)} of ${formatCount(corrections)} corrections)`
      : `Correction rate ${formatPercent(rate)} (${formatCount(corrections)} corrections)`,
    detail: `${formatCount(corrections)} human messages were corrections, one per ${turns > 0 ? (turns / Math.max(corrections, 1)).toFixed(1) : '?'} turns (${formatPercent(rate)}).${topic ? ` ${formatCount(topic.count)} of them mention "${topic.word}".` : ''}`,
    metric: 'correctionRate',
    tool: null,
    count: corrections,
    evidence: evidence.length > 0 ? evidence : matching,
    advice: 'Restate the intended behaviour back to the user before editing, and ask one question when the request is ambiguous.',
  });
}

/** R6 context-pressure. */
function ruleR6(metrics, context, push) {
  const p90 = toNumber(metrics.peakContextRatioP90);
  if (p90 < 0.6) return;
  const hot = context
    .filter((session) => session.numbers.peakContextRatio > 0)
    .sort((a, b) => b.numbers.peakContextRatio - a.numbers.peakContextRatio);
  const over = hot.filter((session) => session.numbers.peakContextRatio >= 0.6);
  const evidence = (hot.length > 0 ? hot : context).map((session) => ({
    sessionId: session.sessionId,
    seq: session.anchors[0],
  }));
  push('R6', {
    severity: 'medium',
    title: `Peak context p90 at ${formatPercent(p90)} of the window`,
    detail: `The 90th percentile of peak input tokens across the cohort is ${formatPercent(p90)} of the context window, and ${formatCount(over.length)} session(s) went over 60%.`,
    metric: 'peakContextRatioP90',
    tool: null,
    count: over.length > 0 ? over.length : Math.max(1, hot.length),
    evidence,
    advice: 'Summarize long tool output before the next step and re-read only changed lines instead of whole files.',
  });
}

/** R7 catalog-bloat. */
function ruleR7(metrics, context, push) {
  const bytes = toNumber(metrics.catalogBytes);
  const unused = asArray(metrics.unusedTools).map((tool) => ({
    name: nonEmptyString(tool?.name),
    bytes: toNumber(tool?.bytes),
  }));
  const unusedBytes = sumBy(unused, (tool) => tool.bytes);
  if (!(bytes >= 48000 || (unused.length >= 5 && unusedBytes >= 12000))) return;
  const sorted = [...context].sort(
    (a, b) => b.numbers.catalogBytes - a.numbers.catalogBytes
      || byName(a.sessionId, b.sessionId),
  );
  const evidence = (sorted.length > 0 ? sorted : context).map((session) => ({
    sessionId: session.sessionId,
    seq: session.anchors[0],
  }));
  push('R7', {
    severity: 'medium',
    title: `Tool catalog is ${formatCount(bytes)} bytes`,
    detail: `The exposed tool catalog reaches ${formatCount(bytes)} bytes and ${formatCount(unused.length)} uncalled tool(s) account for ${formatCount(unusedBytes)} of them. Every request pays for those tokens.`,
    metric: 'catalogBytes',
    tool: null,
    count: bytes,
    evidence,
    advice: 'Prune tools no session calls, or shorten their descriptions to one sentence each.',
  });
}

/** R8 turn-failures. */
function ruleR8(metrics, context, push) {
  const rate = toNumber(metrics.turnFailureRate);
  if (rate < 0.05) return;
  const failing = context.filter((session) => session.numbers.failedTurns > 0);
  const failedTurns = sumBy(failing, (session) => session.numbers.failedTurns)
    || Math.round(rate * toNumber(metrics.turns));
  const evidence = (failing.length > 0 ? failing : context).map((session) => ({
    sessionId: session.sessionId,
    seq: session.anchors[0],
  }));
  push('R8', {
    severity: rate >= 0.15 ? 'high' : 'medium',
    title: `${formatPercent(rate)} of turns end in error, abort, or max-tokens`,
    detail: `${formatCount(failedTurns)} of ${formatCount(toNumber(metrics.turns))} turns ended in error, aborted, or max-tokens (${formatPercent(rate)}). Long mechanical turns are failing rather than producing work.`,
    metric: 'turnFailureRate',
    tool: null,
    count: failedTurns,
    evidence,
    advice: 'Check the model and tier before long mechanical work, and split turns that will exhaust the window.',
  });
}

/** R9 error-storm. */
function ruleR9(metrics, context, push) {
  for (const session of context) {
    const errors = session.numbers.toolErrors;
    const calls = session.numbers.toolCalls;
    if (errors < 8 || calls <= 0 || divide(errors, calls) < 0.4) continue;
    const samples = session.samples.map((sample) => ({
      sessionId: sample.sessionId,
      seq: sample.seq,
    }));
    push('R9', {
      severity: 'high',
      title: `${formatCount(errors)} tool errors in one session (${formatPercent(divide(errors, calls))})`,
      detail: `Session ${session.sessionId} produced ${formatCount(errors)} tool errors in ${formatCount(calls)} calls (${formatPercent(divide(errors, calls))}); the failures are not independent, the session was stuck in an error loop.`,
      metric: 'toolErrors',
      tool: session.samples.length > 0 ? session.samples[0].tool : null,
      count: errors,
      evidence: samples.length > 0 ? samples : session.anchorsEvidence,
      advice: 'Stop after the second failure of the same call and re-read the tool output before retrying.',
    });
  }
  for (const row of asArray(metrics.tools)) {
    const name = nonEmptyString(row?.name);
    const codes = asObject(row?.errorCodes);
    for (const code of Object.keys(codes)) {
      const count = toNumber(codes[code]);
      if (count < 10) continue;
      const evidence = [];
      for (const session of context) {
        for (const sample of session.samples) {
          if (sample.code === code) evidence.push({ sessionId: sample.sessionId, seq: sample.seq });
        }
      }
      if (evidence.length === 0) evidence.push(...allAnchors(context));
      push('R9', {
        severity: 'high',
        title: `One error code repeated ${formatCount(count)}x${name ? ` on "${name}"` : ''}`,
        detail: `${code} was returned ${formatCount(count)} times${name ? ` by ${name}` : ''} across the cohort. A single code at this volume is a systematic defect, not a run of bad luck.`,
        metric: 'toolErrors',
        tool: name || null,
        count,
        evidence,
        advice: `Fix the ${name || 'tool'} path that produces ${code} once, instead of retrying around it.`,
      });
    }
  }
}

/** R10 cost-outlier. */
function ruleR10(metrics, context, push) {
  const totals = context.map((session) => session.numbers.totalTokens);
  const cohortMedian = median(totals);
  for (const session of context) {
    const tokens = session.numbers.totalTokens;
    if (tokens < 200000 || tokens < 3 * cohortMedian) continue;
    const multiple = cohortMedian > 0 ? `${(tokens / cohortMedian).toFixed(1)}x` : 'far above';
    push('R10', {
      severity: 'low',
      title: `Token outlier: ${formatCount(tokens)} tokens in one session`,
      detail: `Session ${session.sessionId} spent ${formatCount(tokens)} tokens, ${multiple} the cohort median (${formatCount(cohortMedian)}), above the 200000-token threshold.`,
      metric: 'totalTokens',
      tool: null,
      count: tokens,
      evidence: session.anchorsEvidence,
      advice: 'Split work that large into turns with a written summary so the next turn starts from the summary.',
    });
  }
}

/**
 * Apply R1–R10 in order over `metrics` plus the per-session facts. Pure: no I/O,
 * no clock. Findings without evidence are dropped.
 *
 * @param {object} metrics CohortMetrics (computed from factsList when omitted)
 * @param {object[]} factsList
 * @param {object} [cohort] cohort descriptor (filtering happens upstream)
 * @returns {object[]} Finding[]
 */
export function deriveFindings(metrics, factsList, cohort = {}) {
  void cohort;
  const facts = asArray(factsList).filter(isPlainObject);
  const source = isPlainObject(metrics) ? metrics : cohortMetrics(facts);
  const working = { ...source };
  if (!Number.isFinite(toNumber(source.sessions, NaN))) working.sessions = facts.length;
  if (toNumber(working.sessions) <= 0) return [];

  const context = buildRuleContext(facts);
  const findings = [];
  const counters = Object.create(null);
  const push = (rule, fields) => addFinding(findings, counters, rule, fields);

  ruleR1(working, context, push);
  ruleR2(working, context, push);
  ruleR3(working, context, push);
  ruleR4(working, context, push);
  ruleR5(working, context, push);
  ruleR6(working, context, push);
  ruleR7(working, context, push);
  ruleR8(working, context, push);
  ruleR9(working, context, push);
  ruleR10(working, context, push);
  return findings;
}

// --------------------------------------------------------------------------
// PDCA run (DESIGN §5)
// --------------------------------------------------------------------------

function normalizeCohort(input) {
  const cohort = asObject(input);
  const days = toNumber(cohort.days, DEFAULT_COHORT.days);
  return {
    days: Math.max(0, Math.trunc(days)),
    workspace: nonEmptyString(cohort.workspace) || null,
    tag: nonEmptyString(cohort.tag) || null,
    status: COHORT_STATUSES.includes(cohort.status) ? cohort.status : DEFAULT_COHORT.status,
    limit: clampInt(cohort.limit, DEFAULT_COHORT.limit, 1, 1000),
    onlyArchived: cohort.onlyArchived !== false,
    source: nonEmptyString(cohort.source) || null,
    harnessArchivedTotal: toNumber(cohort.harnessArchivedTotal),
  };
}

function normalizeTargets(input) {
  const targets = asArray(input)
    .filter(isPlainObject)
    .map((target) => ({
      metric: nonEmptyString(target.metric),
      op: OPS.includes(target.op) ? target.op : '<=',
      value: toNumber(target.value, NaN),
    }))
    .filter((target) => target.metric && Number.isFinite(target.value));
  if (targets.length === 0) return DEFAULT_TARGETS.map((target) => ({ ...target }));
  return targets;
}

function newRunId(now) {
  return `run-${stamp(now)}-${randomUUID().replace(/-/g, '').slice(0, 4)}`;
}

function newProposalId(now, used) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = `prop-${stamp(now)}-${randomUUID().replace(/-/g, '').slice(0, 4)}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  const fallback = `prop-${stamp(now)}-${String(used.size).padStart(4, '0')}`;
  used.add(fallback);
  return fallback;
}

function cloneRun(run) {
  const source = asObject(run);
  return {
    ...source,
    cohort: { ...asObject(source.cohort) },
    plan: {
      ...asObject(source.plan),
      targets: asArray(asObject(source.plan).targets).map((target) => ({ ...target })),
      hypotheses: asArray(asObject(source.plan).hypotheses).map((hypothesis) => ({ ...hypothesis })),
    },
    do: {
      ...asObject(source.do),
      sessionIds: [...asArray(asObject(source.do).sessionIds)],
      coverage: { ...asObject(asObject(source.do).coverage) },
    },
    check: {
      ...asObject(source.check),
      metrics: { ...asObject(asObject(source.check).metrics) },
      perSession: [...asArray(asObject(source.check).perSession)],
      verdicts: [...asArray(asObject(source.check).verdicts)],
      deltas: [...asArray(asObject(source.check).deltas)],
    },
    act: {
      ...asObject(source.act),
      findings: [...asArray(asObject(source.act).findings)],
      proposalIds: [...asArray(asObject(source.act).proposalIds)],
    },
  };
}

/**
 * Reduce a `PdcaRun` to the fields a client needs to answer "is it running,
 * did it finish, how did it do". Pure: never mutates `run`, never reads the
 * clock unless the caller injects `now` via `options`.
 *
 * @param {object} run PdcaRun (possibly from an older plugin version).
 * @param {{now?: number, staleMs?: number}} [options]
 * @returns {object} run summary
 */
export function summarizeRun(run, options = {}) {
  const source = asObject(run);
  const opts = asObject(options);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const staleMs = Number.isFinite(opts.staleMs) ? opts.staleMs : RUN_STALE_MS;
  const createdAt = toNumber(source.createdAt, NaN);
  const updatedAt = toNumber(source.updatedAt, NaN);

  let status = RUN_STATUSES.includes(source.status) ? source.status : '';
  if (!status) {
    switch (source.phase) {
      case 'plan':
        status = 'planned';
        break;
      case 'do':
        status = 'running';
        break;
      case 'check':
      case 'act':
        status = 'checked';
        break;
      case 'closed':
        status = 'closed';
        break;
      default:
        status = 'planned';
    }
  }

  let finishedAt = toNumber(source.finishedAt, NaN);
  if (!Number.isFinite(finishedAt) && (status === 'checked' || status === 'closed' || status === 'failed')) {
    finishedAt = updatedAt;
  }
  const finished = Number.isFinite(finishedAt) ? finishedAt : null;
  // A duration needs a recorded start. Runs written before `startedAt` existed
  // carry createdAt === updatedAt, so measuring from createdAt would print a
  // bogus "8 ms" for a run that took seconds — report no duration instead.
  const startRaw = toNumber(source.startedAt, NaN);
  const startedAt = Number.isFinite(startRaw) ? startRaw : null;
  const durationMs = startedAt !== null && Number.isFinite(finishedAt)
    ? Math.max(0, finishedAt - startedAt)
    : null;

  const anchored = updatedAt || createdAt || 0;
  const stalled = status === 'running' && now - anchored > staleMs;
  const running = status === 'running' && !stalled;

  const verdicts = asArray(asObject(source.check).verdicts);
  const targets = { total: verdicts.length, passed: 0, failed: 0, flat: 0, unknown: 0 };
  for (const item of verdicts) {
    const verdict = item && item.verdict;
    if (verdict === 'pass') targets.passed += 1;
    else if (verdict === 'fail') targets.failed += 1;
    else if (verdict === 'flat') targets.flat += 1;
    else if (verdict === 'unknown') targets.unknown += 1;
  }

  const act = asObject(source.act);

  return {
    id: typeof source.id === 'string' ? source.id : '',
    status,
    phase: source.phase,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    startedAt,
    finishedAt: finished,
    durationMs,
    running,
    stalled,
    targets,
    findings: asArray(act.findings).length,
    proposals: asArray(act.proposalIds).length,
  };
}

/**
 * Create a run in the `plan` phase. Pure except for the id's random suffix;
 * `now` is injectable so the timestamps and hypothesis ids are deterministic.
 *
 * @param {{cohort?: object, targets?: object[], baselineRunId?: string|null, now?: number}} input
 * @param {{now?: number}} [options]
 * @returns {object} PdcaRun
 */
export function planRun(input = {}, options = {}) {
  const now = resolveNow(options, input);
  const source = asObject(input);
  const cohort = normalizeCohort(source.cohort);
  const targets = normalizeTargets(source.targets);
  const baselineRunId = nonEmptyString(source.baselineRunId) || null;
  return {
    id: newRunId(now),
    createdAt: now,
    updatedAt: now,
    phase: 'plan',
    status: 'planned',
    startedAt: now,
    finishedAt: null,
    cohort,
    plan: {
      baselineRunId,
      targets,
      hypotheses: targets.map((target, index) => ({
        id: `h-${index + 1}`,
        statement: `${target.metric} will be ${target.op} ${target.value} after this pass.`,
        metric: target.metric,
        expected: `${target.op} ${target.value}`,
      })),
    },
    do: {
      sessionIds: [],
      analyzedAt: null,
      factsDigest: '',
      coverage: { requested: 0, analyzed: 0, skipped: 0, failures: [] },
    },
    check: { metrics: {}, perSession: [], verdicts: [], deltas: [] },
    act: { findings: [], proposalIds: [] },
  };
}

function factsDigestOf(facts) {
  const declared = typeof facts.factsDigest === 'string' ? facts.factsDigest.trim() : '';
  if (declared) return declared;
  try {
    return sha256(JSON.stringify(facts));
  } catch {
    return sha256(nonEmptyString(facts.sessionId) || 'facts');
  }
}

/**
 * Fill the `do` block: which sessions were actually analyzed, a digest over
 * their facts, and coverage. Pure. Duplicate / id-less facts count as skipped.
 *
 * @param {object} run
 * @param {object[]} factsList
 * @param {{now?: number}} [options]
 * @returns {object} PdcaRun
 */
export function executeDo(run, factsList, options = {}) {
  const now = resolveNow(options, asObject(run));
  const base = isPlainObject(run) ? cloneRun(run) : planRun({}, { now });
  const facts = asArray(factsList).filter(isPlainObject);
  const sessionIds = [];
  const digests = [];
  const seen = new Set();
  let skipped = 0;
  for (const entry of facts) {
    const sessionId = nonEmptyString(entry.sessionId);
    if (!sessionId || seen.has(sessionId)) {
      skipped += 1;
      continue;
    }
    seen.add(sessionId);
    sessionIds.push(sessionId);
    digests.push(factsDigestOf(entry));
  }
  return {
    ...base,
    phase: 'do',
    status: 'running',
    updatedAt: now,
    do: {
      sessionIds,
      analyzedAt: now,
      factsDigest: sha256(digests.join('')),
      coverage: {
        requested: sessionIds.length + skipped,
        analyzed: sessionIds.length,
        skipped,
        failures: [],
      },
    },
  };
}

function metricNumber(metrics, key) {
  const value = asObject(metrics)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

function compareMetric(actual, op, target) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return 'inconclusive';
  switch (op) {
    case '<=':
      return actual <= target ? 'pass' : 'fail';
    case '>=':
      return actual >= target ? 'pass' : 'fail';
    case '<':
      return actual < target ? 'pass' : 'fail';
    case '>':
      return actual > target ? 'pass' : 'fail';
    default:
      return 'inconclusive';
  }
}

function epsilonFor(before) {
  const base = Number.isFinite(before) ? Math.abs(before) : 0;
  return Math.max(base * EPSILON_RATIO, EPSILON_FLOOR);
}

/**
 * Fill the `check` block: CohortMetrics, the per-session headline rows, a
 * verdict per plan target, and deltas against the baseline metrics. Also fills
 * `act.findings` (DESIGN §7.2) and moves the run to the `act` phase, leaving
 * `act.proposalIds` empty for `proposalsFor`. Pure.
 *
 * @param {object} run
 * @param {object[]} factsList
 * @param {object|null} [baselineMetrics] CohortMetrics of the baseline run
 * @param {{now?: number}} [options]
 * @returns {object} PdcaRun
 */
export function executeCheck(run, factsList, baselineMetrics = null, options = {}) {
  const now = resolveNow(options, asObject(run));
  const base = isPlainObject(run) ? cloneRun(run) : planRun({}, { now });
  const facts = asArray(factsList).filter(isPlainObject);
  const metrics = cohortMetrics(facts);
  const targets = asArray(asObject(base.plan).targets).map((target) => ({
    metric: nonEmptyString(target?.metric),
    op: OPS.includes(target?.op) ? target.op : '<=',
    value: toNumber(target?.value),
  }));
  const baseline = isPlainObject(baselineMetrics) ? baselineMetrics : null;

  const verdicts = targets.map((target) => {
    const actual = metricNumber(metrics, target.metric);
    let verdict = 'inconclusive';
    if (toNumber(metrics.sessions) > 0 && Number.isFinite(actual)) {
      verdict = compareMetric(actual, target.op, target.value);
    }
    return {
      metric: target.metric,
      op: target.op,
      target: target.value,
      actual: Number.isFinite(actual) ? actual : null,
      verdict,
    };
  });

  // No baseline at all means "nothing to compare with", so there are no deltas.
  // Reporting `before: 0` would invent a measurement: a reader sees
  // "before 0 -> after 76758, delta 0" and cannot tell that nothing was measured.
  const deltas = baseline
    ? targets.map((target) => {
    const after = metricNumber(metrics, target.metric);
    const before = metricNumber(baseline, target.metric);
    if (!Number.isFinite(after) || !Number.isFinite(before)) {
      return {
        metric: target.metric,
        before: Number.isFinite(before) ? before : null,
        after: Number.isFinite(after) ? after : null,
        delta: null,
        verdict: 'unknown',
      };
    }
    const delta = after - before;
    const epsilon = epsilonFor(before);
    const lowerIsBetter = target.op === '<=' || target.op === '<';
    let verdict = 'flat';
    if (delta < -epsilon) verdict = lowerIsBetter ? 'improved' : 'regressed';
    else if (delta > epsilon) verdict = lowerIsBetter ? 'regressed' : 'improved';
    return { metric: target.metric, before, after, delta, verdict };
    })
    : [];

  const perSession = [];
  for (const entry of facts) {
    const sessionId = nonEmptyString(entry.sessionId);
    if (!sessionId) continue;
    const numbers = sessionNumbers(entry);
    perSession.push({
      sessionId,
      createdAt: toNumber(entry.createdAt),
      turns: numbers.turns,
      toolCalls: numbers.toolCalls,
      toolErrors: numbers.toolErrors,
      corrections: correctionCount(entry),
      totalTokens: numbers.totalTokens,
      durationMs: numbers.durationMs,
    });
  }

  const findings = deriveFindings(metrics, facts, base.cohort);

  return {
    ...base,
    phase: 'act',
    status: 'checked',
    finishedAt: now,
    updatedAt: now,
    check: { metrics, perSession, verdicts, deltas },
    act: { findings, proposalIds: [] },
  };
}

// --------------------------------------------------------------------------
// Proposals (DESIGN §6, §7.2)
// --------------------------------------------------------------------------

function defaultAgentsFile() {
  return path.resolve(path.join(homedir(), '.agents', 'AGENTS.md'));
}

function defaultSkillsRoot() {
  return path.resolve(path.join(homedir(), '.agents', 'skills'));
}

function findingNumber(finding) {
  return toNumber(finding?.count);
}

function findingTopic(finding) {
  const match = /cluster[s]?\s+on\s+"([^"]+)"/i.exec(String(finding?.title || ''));
  return match ? match[1] : '';
}

function draft(kind, target, body, expectedMetric, finding, title) {
  return {
    kind,
    target,
    body: body.replace(/\s+/g, ' ').trim(),
    expectedMetric,
    expectedEffect: 'decrease',
    title: title || finding.title,
    rationale: typeof finding.detail === 'string' ? finding.detail : '',
  };
}

function configuredPath(options, key, fallback) {
  const value = nonEmptyString(asObject(options)[key]);
  return value ? path.resolve(expandHome(value)) : fallback;
}

function proposalDrafts(finding, targets = {}) {
  const agentsFile = targets.agentsFile || defaultAgentsFile();
  const skillsRoot = targets.skillsRoot || defaultSkillsRoot();
  const count = findingNumber(finding);
  const tool = finding.tool ? String(finding.tool) : '';
  const toolName = tool || 'the failing tool';
  switch (finding.rule) {
    case 'R1':
      return [
        draft(
          'advisory',
          '',
          `In the \`${toolName}\` tool description, name the exact argument shape that works and the failure that follows otherwise: ${formatCount(count)} calls to this tool failed. Add one literal example call, and one sentence saying what to check before retrying.`,
          'toolErrorRate',
          finding,
        ),
      ];
    case 'R2':
      return [
        draft(
          'advisory',
          '',
          `Rewrite the \`${toolName}\` parameter schema so the rejected shape cannot be produced: ${formatCount(count)} calls were rejected as invalid or unparsable. List the valid argument names and types, and give the valid call as literal JSON in the description.`,
          'toolErrorRate',
          finding,
        ),
      ];
    case 'R3':
      return [
        draft(
          'prompt-section',
          LESSONS_TARGET,
          `Do not re-issue a tool call with identical arguments: ${formatCount(count)} sessions repeated the same call at least twice. If the previous result already answers the question, read it again instead of calling the tool.`,
          'repeatedCallSessions',
          finding,
        ),
      ];
    case 'R4':
      return [
        draft(
          'prompt-section',
          LESSONS_TARGET,
          `After the last edit of a turn, run one check command before reporting completion: ${formatCount(count)} sessions with edits ended with no command after the final edit. If the check cannot run, say so instead of claiming success.`,
          'verificationGapRate',
          finding,
        ),
      ];
    case 'R5': {
      const topic = findingTopic(finding);
      const drafts = [
        draft(
          'prompt-section',
          LESSONS_TARGET,
          `State the intended change back to the user before editing: ${formatCount(count)} human messages were corrections. If the request is ambiguous, ask one question instead of choosing an interpretation.`,
          'correctionRate',
          finding,
        ),
      ];
      if (topic) {
        const slug = slugifySkill(topic);
        drafts.push(
          draft(
            'skill-candidate',
            path.join(skillsRoot, slug, 'SKILL.md'),
            `When a request mentions "${topic}", restate the target behaviour and the file set before editing, then confirm it in one line. ${formatCount(count)} corrections in the cohort were about "${topic}".`,
            'correctionRate',
            finding,
            `Skill candidate: "${topic}" corrections`,
          ),
        );
      }
      return drafts;
    }
    case 'R6':
      return [
        draft(
          'prompt-section',
          LESSONS_TARGET,
          `Keep the working context below 60% of the window: the p90 peak was at the alert threshold and ${formatCount(count)} sessions went over it. Summarize long tool output before the next step, and re-read only the changed lines instead of whole files.`,
          'peakContextRatioP90',
          finding,
        ),
      ];
    case 'R7':
      return [
        draft(
          'advisory',
          '',
          `Prune the tool catalog before adding more tools: it is ${formatCount(count)} bytes. Drop or shorten the tools that no session in the cohort called, and keep every description to one sentence.`,
          'catalogBytes',
          finding,
        ),
      ];
    case 'R8':
      return [
        draft(
          'agents-md-rule',
          agentsFile,
          `Before starting long mechanical work, check the model and tier and split the work: ${formatCount(count)} turns ended in error, abort, or max-tokens. If a turn is likely to exhaust the context window, start a new turn from a written summary instead of pushing through.`,
          'turnFailureRate',
          finding,
        ),
      ];
    case 'R9':
      return [
        draft(
          'advisory',
          '',
          `Stop after the second failure of the same call and re-read the tool output: one session produced ${formatCount(count)} tool errors${tool ? ` concentrated on \`${tool}\`` : ''}, which means the failures were not independent.`,
          'toolErrorRate',
          finding,
        ),
      ];
    case 'R10':
      return [
        draft(
          'advisory',
          '',
          `Cap token spend per session: one session used ${formatCount(count)} tokens, far above the cohort median. When a task needs that much, split it into turns with a written summary so the next turn starts from the summary.`,
          'totalTokens',
          finding,
        ),
      ];
    default:
      return [];
  }
}

/**
 * Map the run's findings to proposals (DESIGN §7.2). Pure: no I/O, no clock
 * when `now` is injected. Evidence is copied verbatim from the finding, bodies
 * are concrete instructions in English carrying the triggering number, and
 * proposals from the same finding are deduped by (kind, target, expectedMetric).
 *
 * @param {object} run PdcaRun with `act.findings`
 * @param {{now?: number, agentsFile?: string, skillsRoot?: string}} [options]
 *   `agentsFile` / `skillsRoot` only decide the proposal's target path; they
 *   mirror the host config so adoption resolves to the same file.
 * @returns {object[]} Proposal[]
 */
export function proposalsFor(run, options = {}) {
  const source = asObject(run);
  const now = resolveNow(options, source);
  const runId = typeof source.id === 'string' ? source.id : '';
  const targets = {
    agentsFile: configuredPath(options, 'agentsFile', defaultAgentsFile()),
    skillsRoot: configuredPath(options, 'skillsRoot', defaultSkillsRoot()),
  };
  const findings = asArray(asObject(source.act).findings).filter(isPlainObject);
  const used = new Set();
  const proposals = [];
  for (const finding of findings) {
    const seen = new Set();
    for (const entry of proposalDrafts(finding, targets)) {
      const key = `${entry.kind}|${entry.target}|${entry.expectedMetric}`;
      if (seen.has(key)) continue;
      seen.add(key);
      proposals.push({
        id: newProposalId(now, used),
        runId,
        findingIds: [String(finding.id || '')],
        kind: entry.kind,
        target: entry.target,
        title: entry.title,
        rationale: entry.rationale,
        body: entry.body,
        evidence: asArray(finding.evidence).map((item) => ({
          sessionId: String(item?.sessionId || ''),
          seq: toNumber(item?.seq),
        })),
        expectedMetric: entry.expectedMetric,
        expectedEffect: entry.expectedEffect,
        risk: KIND_RISK[entry.kind] || 'medium',
        status: 'proposed',
        createdAt: now,
        adoptedAt: null,
        rejectedAt: null,
        revertedAt: null,
        adoption: null,
        evaluation: null,
      });
    }
  }
  return proposals;
}

// --------------------------------------------------------------------------
// Adoption evaluation (DESIGN §6)
// --------------------------------------------------------------------------

/**
 * Fill `proposal.evaluation` for adopted proposals by splitting facts on
 * `createdAt` against `adoptedAt` and re-measuring the proposal's metric on
 * each side. Pure: no I/O. Requires `minSessions` (default 3) on both sides;
 * otherwise the verdict is `inconclusive`.
 *
 * @param {object[]} proposals
 * @param {object[]} factsList facts covering both sides of the adoption
 * @param {{minSessions?: number, now?: number}} [options]
 * @returns {object[]} Proposal[]
 */
export function evaluateAdoptions(proposals, factsList, options = {}) {
  const now = resolveNow(options);
  const minSessions = clampInt(
    asObject(options).minSessions,
    DEFAULT_MIN_SESSIONS,
    1,
    10000,
  );
  const facts = asArray(factsList).filter(isPlainObject);

  return asArray(proposals).map((proposal) => {
    if (!isPlainObject(proposal)) return proposal;
    if (proposal.status !== 'adopted') return proposal;
    const adoptedAt = toTimestamp(proposal.adoptedAt);
    const metric = nonEmptyString(proposal.expectedMetric);
    if (!Number.isFinite(adoptedAt) || !metric) {
      return { ...proposal, evaluation: proposal.evaluation ?? null };
    }
    const beforeFacts = [];
    const afterFacts = [];
    for (const entry of facts) {
      const createdAt = toTimestamp(entry.createdAt);
      if (!Number.isFinite(createdAt)) continue;
      if (createdAt < adoptedAt) beforeFacts.push(entry);
      else afterFacts.push(entry);
    }
    const beforeMetrics = cohortMetrics(beforeFacts);
    const afterMetrics = cohortMetrics(afterFacts);
    const beforeValue = metricNumber(beforeMetrics, metric);
    const afterValue = metricNumber(afterMetrics, metric);
    const enough = beforeFacts.length >= minSessions && afterFacts.length >= minSessions;

    let verdict = 'inconclusive';
    let delta = 0;
    if (Number.isFinite(beforeValue) && Number.isFinite(afterValue)) {
      delta = afterValue - beforeValue;
      if (enough) {
        const epsilon = epsilonFor(beforeValue);
        const effect = proposal.expectedEffect === 'increase' ? 'increase' : 'decrease';
        if (effect === 'decrease') {
          if (delta < -epsilon) verdict = 'improved';
          else if (delta > epsilon) verdict = 'regressed';
        } else if (delta > epsilon) verdict = 'improved';
        else if (delta < -epsilon) verdict = 'regressed';
      }
    }

    return {
      ...proposal,
      evaluation: {
        before: { sessions: beforeFacts.length, metrics: beforeMetrics },
        after: { sessions: afterFacts.length, metrics: afterMetrics },
        verdict,
        metric,
        delta,
        evaluatedAt: now,
      },
    };
  });
}

// --------------------------------------------------------------------------
// Adoption: writes (DESIGN §6.1)
// --------------------------------------------------------------------------

function resolveStorePaths(options = {}) {
  const source = asObject(options);
  return {
    rootDir: path.resolve(
      expandHome(nonEmptyString(source.rootDir) || path.join(homedir(), '.dsh', 'archive-rsi')),
    ),
    agentsFile: path.resolve(
      expandHome(nonEmptyString(source.agentsFile) || path.join(homedir(), '.agents', 'AGENTS.md')),
    ),
    skillsRoot: path.resolve(
      expandHome(nonEmptyString(source.skillsRoot) || path.join(homedir(), '.agents', 'skills')),
    ),
  };
}

function resolveWriteTarget(proposal, store) {
  const kind = proposal.kind;
  const raw = typeof proposal.target === 'string' ? proposal.target.trim() : '';

  if (kind === 'prompt-section') {
    const lessons = path.resolve(store.rootDir, 'lessons.md');
    if (!raw || raw === LESSONS_TARGET || raw === 'lessons.md' || raw === 'lessons') {
      return { file: lessons, mode: 'append' };
    }
    const resolved = path.resolve(expandHome(raw));
    if (resolved === lessons) return { file: lessons, mode: 'append' };
    const defaultLessons = path.resolve(path.join(homedir(), '.dsh', 'archive-rsi', 'lessons.md'));
    if (resolved === defaultLessons) return { file: lessons, mode: 'append' };
    throw errorWithCode(
      'path-outside-root',
      `prompt-section may only write ${lessons}; refusing ${raw}.`,
      'The lessons file lives inside the archive-rsi store root.',
    );
  }

  if (kind === 'agents-md-rule') {
    const fallback = path.resolve(path.join(homedir(), '.agents', 'AGENTS.md'));
    const resolved = raw ? path.resolve(expandHome(raw)) : store.agentsFile;
    if (resolved === store.agentsFile) return { file: store.agentsFile, mode: 'append' };
    const allowedDirs = [path.dirname(store.agentsFile), path.dirname(fallback)];
    const contained = allowedDirs.some(
      (dir) => resolved === dir || isInsidePath(resolved, dir),
    );
    if (!contained) {
      throw errorWithCode(
        'path-outside-root',
        `agents-md-rule writes stay beside ${store.agentsFile}; refusing ${raw}.`,
        'Only the configured agents file may be appended to.',
      );
    }
    if (path.basename(resolved) !== path.basename(store.agentsFile)) {
      throw errorWithCode(
        'invalid-target',
        `An agents-md-rule must target ${store.agentsFile}; refusing ${raw}.`,
      );
    }
    return { file: store.agentsFile, mode: 'append' };
  }

  // skill-candidate: <skillsRoot>/<slug>/SKILL.md
  const fallbackRoot = path.resolve(path.join(homedir(), '.agents', 'skills'));
  const allowedRoots = [store.skillsRoot, fallbackRoot];
  let slug = '';
  if (raw) {
    const resolved = path.resolve(expandHome(raw));
    if (!allowedRoots.some((root) => isInsidePath(resolved, root))) {
      throw errorWithCode(
        'path-outside-root',
        `skill-candidate writes stay under ${store.skillsRoot}; refusing ${raw}.`,
        'A skill is created as <skillsRoot>/<slug>/SKILL.md.',
      );
    }
    if (path.basename(resolved) !== 'SKILL.md') {
      throw errorWithCode('invalid-target', 'A skill candidate must be written as SKILL.md.');
    }
    slug = path.basename(path.dirname(resolved));
  } else {
    slug = typeof proposal.title === 'string' ? proposal.title : 'skill';
  }
  slug = slugifySkill(slug);
  const file = path.join(store.skillsRoot, slug, 'SKILL.md');
  const expectedDir = path.join(store.skillsRoot, slug);
  if (path.basename(file) !== 'SKILL.md' || path.dirname(file) !== expectedDir) {
    throw errorWithCode('path-outside-root', `Refusing skill path ${file}.`);
  }
  if (!isInsidePath(file, store.skillsRoot)) {
    throw errorWithCode('path-outside-root', `Refusing skill path outside ${store.skillsRoot}.`);
  }
  return { file, mode: 'create' };
}

async function readFileOrNull(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWriteFile(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function startMarker(id) {
  return `<!-- archive-rsi: ${id} -->`;
}

function endMarker(id) {
  return `<!-- /archive-rsi: ${id} -->`;
}

function blockFor(id, body) {
  return `${startMarker(id)}\n${body.trim()}\n${endMarker(id)}`;
}

function appendToFile(existing, block) {
  if (!existing) return `${block}\n`;
  return `${existing}\n${block}\n`;
}

/** Remove exactly the block `appendToFile` added, restoring the prior bytes. */
function stripFromFile(text, id) {
  const start = startMarker(id);
  const end = endMarker(id);
  const from = text.indexOf(start);
  if (from < 0) return { text, found: false };
  const endIndex = text.indexOf(end, from);
  if (endIndex < 0) return { text, found: false };
  let cut = from;
  const after = endIndex + end.length;
  let to = after + (text[after] === '\n' ? 1 : 0);
  // appendToFile always puts one newline between the old content and the block.
  if (cut > 0 && text[cut - 1] === '\n') cut -= 1;
  return { text: text.slice(0, cut) + text.slice(to), found: true };
}

async function backupPathFor(file, now) {
  const base = `${file}.bak-${stamp(now)}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  return `${base}-${randomUUID().slice(0, 4)}`;
}

function requireAdoptable(proposal) {
  if (!isPlainObject(proposal)) {
    throw errorWithCode('invalid-proposal', 'Proposal is not an object.');
  }
  if (proposal.kind === 'advisory') {
    throw errorWithCode(
      'not-adoptable',
      'Advisory proposals are text only; there is no file to adopt them into.',
      'Attach the advisory text to a prompt-section or agents-md-rule proposal instead.',
    );
  }
  if (!ADOPTABLE_KINDS.includes(proposal.kind)) {
    throw errorWithCode('not-adoptable', `Unknown proposal kind ${JSON.stringify(proposal.kind)}.`);
  }
}

/**
 * Adopt a proposal: perform the write described by DESIGN §6.1 and return the
 * updated proposal. Refusals carry a `.code`:
 * `not-adoptable` | `not-proposed` | `path-outside-root` | `invalid-target` |
 * `target-changed` | `target-exists` | `invalid-proposal`.
 *
 * Writes stay inside the configured agents file, `<rootDir>/lessons.md`, or
 * `<skillsRoot>/<slug>/SKILL.md`; every write is atomic (tmp + rename); append
 * modes keep a timestamped backup beside the file.
 *
 * @param {object} proposal
 * @param {{rootDir?: string, agentsFile?: string, skillsRoot?: string, now?: number}} [options]
 * @returns {Promise<object>} adopted Proposal
 */
export async function applyProposal(proposal, options = {}) {
  const now = resolveNow(options);
  requireAdoptable(proposal);
  // `reverted` is adoptable again: the normal workflow is adopt -> evaluate ->
  // revert -> adjust -> adopt. Anything already adopted or rejected is not.
  if (proposal.status !== 'proposed' && proposal.status !== 'reverted') {
    throw errorWithCode(
      'not-proposed',
      `Proposal ${proposal.id || '(no id)'} is ${proposal.status || 'unknown'}; only proposed or reverted proposals can be adopted.`,
    );
  }
  const body = typeof proposal.body === 'string' ? proposal.body.trim() : '';
  if (!body) throw errorWithCode('invalid-proposal', 'Proposal body is empty; nothing to write.');
  const id = nonEmptyString(proposal.id) || `prop-${stamp(now)}-${randomUUID().slice(0, 4)}`;

  const store = resolveStorePaths(options);
  const { file, mode } = resolveWriteTarget(proposal, store);
  const before = await readFileOrNull(file);
  const beforeSha = before ? sha256(before) : null;

  const recordedSha = isPlainObject(proposal.adoption)
    ? nonEmptyString(proposal.adoption.beforeSha)
    : '';
  if (recordedSha) {
    if (!beforeSha) {
      throw errorWithCode(
        'target-changed',
        `${file} was present when the proposal was created and is gone now.`,
        'Re-run the analysis to produce a proposal against the current file.',
      );
    }
    if (recordedSha !== beforeSha) {
      throw errorWithCode(
        'target-changed',
        `${file} changed since the proposal was created (sha256 mismatch).`,
        'Re-run the analysis; the proposal body was written against the old content.',
      );
    }
  }

  const existingText = before ? before.toString('utf8') : '';

  if (proposal.kind === 'skill-candidate') {
    const desired = `${body}\n`;
    const desiredSha = sha256(Buffer.from(desired, 'utf8'));
    if (before) {
      if (sha256(before) !== desiredSha) {
        throw errorWithCode(
          'target-exists',
          `${file} already exists with different content; refusing to overwrite a skill.`,
          'Adopt into a new slug, or remove the existing file first.',
        );
      }
    } else {
      await atomicWriteFile(file, desired);
    }
    return {
      ...proposal,
      status: 'adopted',
      adoptedAt: now,
      revertedAt: null,
      adoption: {
        path: file,
        backupPath: null,
        beforeSha,
        afterSha: desiredSha,
        bytes: Buffer.byteLength(desired, 'utf8'),
        mode,
      },
    };
  }

  // Append modes: prompt-section (in-plugin lessons file) and agents-md-rule.
  const alreadyPresent = existingText.includes(startMarker(id));
  const nextText = alreadyPresent ? existingText : appendToFile(existingText, blockFor(id, body));
  let backupPath = null;
  if (!alreadyPresent) {
    if (proposal.kind === 'agents-md-rule' && before) {
      backupPath = await backupPathFor(file, now);
      await atomicWriteFile(backupPath, before);
    }
    await atomicWriteFile(file, nextText);
  }
  return {
    ...proposal,
    status: 'adopted',
    adoptedAt: now,
    revertedAt: null,
    adoption: {
      path: file,
      backupPath,
      beforeSha,
      afterSha: sha256(Buffer.from(nextText, 'utf8')),
      bytes: Buffer.byteLength(nextText, 'utf8'),
      mode,
    },
  };
}

/**
 * Revert an adopted proposal: remove the appended marker block (or delete a
 * created skill), restore bytes exactly, and mark the proposal `reverted`.
 * Idempotent: a second revert on an already reverted proposal is a no-op.
 * Refusals carry `.code` `not-adoptable` | `not-adopted` | `target-changed` |
 * `path-outside-root`.
 *
 * @param {object} proposal
 * @param {{rootDir?: string, agentsFile?: string, skillsRoot?: string, now?: number}} [options]
 * @returns {Promise<object>} reverted Proposal
 */
export async function revertProposal(proposal, options = {}) {
  const now = resolveNow(options);
  requireAdoptable(proposal);
  if (proposal.status === 'reverted') return { ...proposal };
  if (proposal.status !== 'adopted') {
    throw errorWithCode(
      'not-adopted',
      `Proposal ${proposal.id || '(no id)'} is ${proposal.status || 'unknown'}; only adopted proposals can be reverted.`,
    );
  }
  const id = nonEmptyString(proposal.id);
  if (!id) throw errorWithCode('invalid-proposal', 'Adopted proposal has no id.');

  const store = resolveStorePaths(options);
  const { file: resolvedFile } = resolveWriteTarget(proposal, store);
  const recordedPath = isPlainObject(proposal.adoption)
    ? nonEmptyString(proposal.adoption.path)
    : '';
  let file = resolvedFile;
  if (recordedPath) {
    // The recorded path is authoritative, but it is re-validated against the
    // allowed roots so a tampered proposal cannot redirect the revert.
    const validated = resolveWriteTarget({ ...proposal, target: recordedPath }, store);
    file = validated.file;
  }
  const adoption = asObject(proposal.adoption);
  const before = await readFileOrNull(file);
  const currentText = before ? before.toString('utf8') : '';

  if (proposal.kind === 'skill-candidate') {
    if (before) {
      const currentSha = sha256(before);
      if (adoption.afterSha && currentSha !== adoption.afterSha) {
        throw errorWithCode(
          'target-changed',
          `${file} changed after adoption (sha256 mismatch); refusing to delete it.`,
          'Inspect the file and remove it by hand if it is no longer wanted.',
        );
      }
      await fs.rm(file, { force: true });
      await fs.rmdir(path.dirname(file)).catch(() => {});
    }
    return { ...proposal, status: 'reverted', revertedAt: now };
  }

  if (!before) {
    return { ...proposal, status: 'reverted', revertedAt: now };
  }

  const stripped = stripFromFile(currentText, id);
  if (stripped.found) {
    const restoringNonexistence = proposal.kind === 'prompt-section'
      && stripped.text === ''
      && !nonEmptyString(adoption.beforeSha);
    if (restoringNonexistence) {
      await fs.rm(file, { force: true });
    } else if (stripped.text !== currentText) {
      await atomicWriteFile(file, stripped.text);
    }
  } else if (proposal.kind === 'agents-md-rule') {
    // The block is gone but the file was changed out of band: fall back to the
    // recorded backup only when the file no longer matches the adopted content.
    const backupPath = nonEmptyString(adoption.backupPath);
    if (backupPath && adoption.afterSha && sha256(before) !== adoption.afterSha) {
      const backup = await readFileOrNull(backupPath);
      if (backup) await atomicWriteFile(file, backup);
    }
  }

  return { ...proposal, status: 'reverted', revertedAt: now };
}

// --------------------------------------------------------------------------
// Skill slugs
// --------------------------------------------------------------------------

/**
 * Turn a free-form topic into a safe skill directory name: lowercase, ASCII
 * letters/digits joined by single hyphens, at most 64 chars, never empty.
 *
 * @param {string} name
 * @returns {string}
 */
export function slugifySkill(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');
  return slug || 'skill';
}
