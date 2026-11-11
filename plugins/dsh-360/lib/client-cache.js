/**
 * Client-facing snapshot + optimization-effect persistence for dsh-360.
 *
 * The sidebar panel paints from a small snapshot of the last scan instead of
 * waiting for a cold scan: `/scan?quick=1` serves `toSnapshot(portfolio)` with
 * `stale: true`, then the panel swaps in the fresh portfolio in the background.
 *
 * Snapshots are allow-listed and deliberately exclude per-item bodies, metrics,
 * findings and suggestions (the detail route serves those). That keeps a
 * snapshot at a few hundred KB even with ~100 subjects.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PORTFOLIO_KEYS = [
  'generatedAt', 'windowDays', 'sessionsScanned', 'usageAvailable', 'rubricVersion',
  'totals', 'deltaAvg', 'taxonomy', 'trend', 'lastApply',
  'overlaps', 'quickWins', 'conflicts', 'issues', 'roots',
];

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source && source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function trimScore(score) {
  if (!score || typeof score !== 'object') return score ?? null;
  return pick(score, ['total', 'grade', 'letter', 'tier', 'rank', 'confidence', 'delta']);
}

function trimUsage(usage) {
  if (!usage || typeof usage !== 'object') return usage ?? null;
  return pick(usage, [
    'count', 'sessions', 'lastUsedAt', 'sufficient', 'perWeek', 'windowDays', 'exposureDays',
    'firstSeen', 'catalogSessions', 'sessionsInjected', 'sessionsSeen', 'subagentRuns',
    'presetSessions', 'byPreset', 'available',
  ]);
}

function trimEvolution(evolution) {
  if (!evolution || typeof evolution !== 'object') return evolution ?? null;
  const out = pick(evolution, ['applicable', 'linked', 'sessions']);
  if (evolution.lessons && typeof evolution.lessons === 'object') out.lessons = evolution.lessons;
  if (evolution.pending && typeof evolution.pending === 'object') {
    out.pending = pick(evolution.pending, ['score', 'hasUnclosed', 'lastSignalAt', 'draft']);
  }
  return out;
}

function trimClassification(classification) {
  if (!classification || typeof classification !== 'object') return classification ?? null;
  return pick(classification, ['role', 'layer', 'kind', 'scope', 'state', 'summary', 'tags', 'confidence']);
}

const SEVERITY_ORDER = ['critical', 'major', 'minor', 'info'];

function topSeverityOf(report) {
  const findings = Array.isArray(report && report.findings) ? report.findings : [];
  let best = null;
  let bestRank = SEVERITY_ORDER.length;
  for (const finding of findings) {
    const rank = SEVERITY_ORDER.indexOf(finding && finding.severity);
    if (rank >= 0 && rank < bestRank) {
      best = finding.severity;
      bestRank = rank;
    }
  }
  return best;
}

function trimItem(report) {
  const out = pick(
    report,
    ['id', 'name', 'kind', 'scope', 'source', 'owner', 'coverage', 'title', 'description', 'path', 'mtime', 'rawError'],
  );
  out.score = trimScore(report.score);
  out.verdict = report.verdict;
  if (report.usage !== undefined) out.usage = trimUsage(report.usage);
  if (report.evolution !== undefined) out.evolution = trimEvolution(report.evolution);
  if (report.classification !== undefined) out.classification = trimClassification(report.classification);
  if (report.injection !== undefined) out.injection = pick(report.injection, ['sessionsSeen', 'sessionsInjected']);
  const topSeverity = topSeverityOf(report);
  if (topSeverity) out.topSeverity = topSeverity;
  return out;
}

/**
 * Allow-list a full portfolio down to what the list view renders.
 * @param {object} portfolio
 * @returns {object}
 */
export function toSnapshot(portfolio) {
  if (!portfolio || typeof portfolio !== 'object') return null;
  const out = pick(portfolio, PORTFOLIO_KEYS);
  if (Array.isArray(portfolio.skills)) out.skills = portfolio.skills.map(trimItem);
  if (Array.isArray(portfolio.subjects)) out.subjects = portfolio.subjects.map(trimItem);
  if (Array.isArray(portfolio.overlaps)) out.overlaps = portfolio.overlaps.slice(0, 60);
  if (Array.isArray(portfolio.quickWins)) out.quickWins = portfolio.quickWins.slice(0, 20);
  if (Array.isArray(portfolio.conflicts)) out.conflicts = portfolio.conflicts.slice(0, 60);
  return out;
}

// One serialized writer per path: two scans in the same process must never
// race on the same snapshot file (unique temp names + a queue + a generatedAt
// guard). Different processes are still last-writer-wins, but a rename is
// atomic, so readers never see half a file.
const writeQueues = new Map();
let tempCounter = 0;

function withPathLock(path, task) {
  const previous = writeQueues.get(path) || Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => undefined, () => undefined);
  writeQueues.set(path, settled);
  settled.then(() => {
    if (writeQueues.get(path) === settled) writeQueues.delete(path);
  });
  return run;
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  tempCounter += 1;
  const temporary = `${path}.${process.pid}.${Date.now()}.${tempCounter}.tmp`;
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  await rename(temporary, path);
}

/**
 * Persist the list snapshot after a scan. Failure never breaks the scan.
 * Only default-scope scans should call this (the panel reads one file per
 * surface); `eligible=false` skips parameterized scans so a tool call with a
 * different cwd/window cannot repaint the panel.
 */
export async function writeSnapshot(snapshotPath, portfolio, logWarn, { eligible = true } = {}) {
  if (!eligible) return;
  try {
    const snapshot = toSnapshot(portfolio);
    if (!snapshot) return;
    await withPathLock(snapshotPath, async () => {
      const existing = await readSnapshot(snapshotPath);
      if (existing && Number(existing.generatedAt) > Number(snapshot.generatedAt)) return;
      await atomicWriteJson(snapshotPath, snapshot);
    });
  } catch (error) {
    if (logWarn) logWarn(`dsh-360: cannot persist client snapshot: ${(error && error.message) || String(error)}`);
  }
}

/**
 * Read the last snapshot. Returns null when absent; otherwise the snapshot plus
 * `stale: true` and `cachedAt` so the client can label it.
 */
export async function readSnapshot(snapshotPath) {
  try {
    const [text, info] = await Promise.all([readFile(snapshotPath, 'utf8'), stat(snapshotPath)]);
    const snapshot = JSON.parse(text);
    if (!snapshot || typeof snapshot !== 'object') return null;
    return { ...snapshot, stale: true, cachedAt: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Read the last optimization effect for one surface (or null). */
export async function readLastApply(lastApplyPath) {
  try {
    const parsed = JSON.parse(await readFile(lastApplyPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeLastApply(lastApplyPath, effect, logWarn) {
  try {
    await withPathLock(lastApplyPath, () => atomicWriteJson(lastApplyPath, effect));
  } catch (error) {
    if (logWarn) logWarn(`dsh-360: cannot persist last apply effect: ${(error && error.message) || String(error)}`);
  }
}

/**
 * Undo removes the optimization's provenance: rewrite the last snapshot so a
 * reload cannot resurrect the old "上次优化" card before the next scan.
 */
export async function clearSnapshotLastApply(snapshotPath, logWarn) {
  try {
    await withPathLock(snapshotPath, async () => {
      const snapshot = await readSnapshot(snapshotPath);
      if (!snapshot) return;
      const next = { ...snapshot, lastApply: null };
      delete next.stale;
      delete next.cachedAt;
      await atomicWriteJson(snapshotPath, next);
    });
  } catch (error) {
    if (logWarn) logWarn(`dsh-360: cannot clear snapshot lastApply: ${(error && error.message) || String(error)}`);
  }
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function estimateOf(report) {
  const value = report && report.metrics && Number(report.metrics.estTokens);
  return Number.isFinite(value) ? value : null;
}

function letterRank(report) {
  const rank = report && report.score && Number(report.score.rank);
  return Number.isFinite(rank) ? rank : null;
}

function verdictCode(report) {
  const code = report && report.verdict && report.verdict.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Build one comparable "what changed" effect from before/after report pairs.
 * @param {{surface:string, targets:object[], at?:number}} input
 *   targets: [{ key, before, after }] where before/after are full reports.
 */
export function buildEffect({ surface, targets, backupIds = [], at = Date.now() }) {
  const rows = (targets || []).filter((entry) => entry && entry.before && entry.after);
  if (rows.length === 0) return null;
  const scoresBefore = rows.map((entry) => Number(entry.before.score?.total)).filter(Number.isFinite);
  const scoresAfter = rows.map((entry) => Number(entry.after.score?.total)).filter(Number.isFinite);
  const scoreBefore = scoresBefore.length
    ? round1(scoresBefore.reduce((sum, value) => sum + value, 0) / scoresBefore.length)
    : null;
  const scoreAfter = scoresAfter.length
    ? round1(scoresAfter.reduce((sum, value) => sum + value, 0) / scoresAfter.length)
    : null;
  const tokenValuesBefore = rows.map((entry) => estimateOf(entry.before));
  const tokenValuesAfter = rows.map((entry) => estimateOf(entry.after));
  const tokensBefore = tokenValuesBefore.every((value) => value === null)
    ? null
    : tokenValuesBefore.reduce((sum, value) => sum + (value || 0), 0);
  const tokensAfter = tokenValuesAfter.every((value) => value === null)
    ? null
    : tokenValuesAfter.reduce((sum, value) => sum + (value || 0), 0);
  const gradeUps = rows.filter((entry) => {
    const before = letterRank(entry.before);
    const after = letterRank(entry.after);
    return before !== null && after !== null && after < before;
  }).length;
  const verdictChanges = rows.filter((entry) => verdictCode(entry.before) !== verdictCode(entry.after)).length;
  return {
    surface,
    at,
    items: rows.length,
    scoreBefore,
    scoreAfter,
    delta: scoreBefore !== null && scoreAfter !== null ? round1(scoreAfter - scoreBefore) : null,
    tokensBefore,
    tokensAfter,
    tokensSaved: tokensBefore !== null && tokensAfter !== null ? tokensBefore - tokensAfter : null,
    gradeUps,
    verdictChanges,
    backupIds: [...new Set((backupIds || []).filter((id) => typeof id === 'string' && id))],
    targets: rows.slice(0, 20).map((entry) => ({
      key: entry.key,
      before: entry.before.score?.total ?? null,
      after: entry.after.score?.total ?? null,
      delta: entry.before.score?.total != null && entry.after.score?.total != null
        ? round1(entry.after.score.total - entry.before.score.total)
        : null,
      gradeBefore: entry.before.score?.grade ?? null,
      gradeAfter: entry.after.score?.grade ?? null,
    })),
  };
}

/**
 * Fold per-target effects (one per applied skill/subject) into one run effect.
 * Score fields are item-weighted means; token fields are sums.
 * @param {string} surface
 * @param {object[]} effects
 * @param {number} [at]
 */
export function mergeEffects(surface, effects, at = Date.now()) {
  const list = (effects || []).filter((effect) => effect && effect.items > 0);
  if (list.length === 0) return null;
  const items = list.reduce((sum, effect) => sum + effect.items, 0);
  const weighted = (key) => {
    let total = 0;
    let weight = 0;
    for (const effect of list) {
      if (effect[key] === null || effect[key] === undefined) continue;
      total += effect[key] * effect.items;
      weight += effect.items;
    }
    return weight > 0 ? round1(total / weight) : null;
  };
  const scoreBefore = weighted('scoreBefore');
  const scoreAfter = weighted('scoreAfter');
  const tokensBefore = list.some((effect) => effect.tokensBefore !== null && effect.tokensBefore !== undefined)
    ? list.reduce((sum, effect) => sum + (effect.tokensBefore || 0), 0)
    : null;
  const tokensAfter = list.some((effect) => effect.tokensAfter !== null && effect.tokensAfter !== undefined)
    ? list.reduce((sum, effect) => sum + (effect.tokensAfter || 0), 0)
    : null;
  return {
    surface,
    at,
    items,
    scoreBefore,
    scoreAfter,
    delta: scoreBefore !== null && scoreAfter !== null ? round1(scoreAfter - scoreBefore) : null,
    tokensBefore,
    tokensAfter,
    tokensSaved: tokensBefore !== null && tokensAfter !== null ? tokensBefore - tokensAfter : null,
    gradeUps: list.reduce((sum, effect) => sum + (effect.gradeUps || 0), 0),
    verdictChanges: list.reduce((sum, effect) => sum + (effect.verdictChanges || 0), 0),
    backupIds: [...new Set(list.flatMap((effect) => effect.backupIds || []))],
    targets: list.flatMap((effect) => effect.targets || []).slice(0, 20),
  };
}
