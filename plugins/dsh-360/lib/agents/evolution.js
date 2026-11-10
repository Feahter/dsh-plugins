/**
 * Continuous-evolution core for agents-360: parse/emit the `.agents-360/lessons.md`
 * experience ledger, insert the managed lessons block into a subject body, and
 * assemble the per-subject evolution state that scoring, reporting and the
 * `dsh360_evolve` tool all read.
 *
 * Everything here is pure and deterministic: no filesystem, no network, and
 * nothing throws on malformed input.
 */

/** Canonical location of the experience ledger next to a subject. */
export const LESSONS_REL = '.agents-360/lessons.md';

/** Managed block markers embedded in the subject body. */
export const LESSONS_BLOCK = {
  start: '<!-- agents-360:lessons:start -->',
  end: '<!-- agents-360:lessons:end -->',
};

const DAY_MS = 86_400_000;
const MAX_LESSON_ENTRIES = 10;
const MAX_SIGNAL_SAMPLES = 6;

const LESSON_ITEM_RE = /^\s*-\s*\[?(\d{4})-(\d{1,2})-(\d{1,2})\]?\s*(.*)$/;

function oneLine(text, max) {
  const cleaned = String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function lessonField(text, max) {
  return oneLine(text, max).replace(/(触发|做法|证据)\s*[:：]/g, '$1 ');
}

function isoDate(value) {
  const date = value instanceof Date
    ? value
    : (typeof value === 'string' ? new Date(value) : new Date(Number(value)));
  if (Number.isNaN(date.getTime())) return '1970-01-01';
  return date.toISOString().slice(0, 10);
}

function fieldValue(text, label) {
  const start = new RegExp(`${label}\\s*[:：]`).exec(text);
  if (!start) return '';
  const rest = text.slice(start.index + start[0].length);
  const next = /(?:触发|做法|证据)\s*[:：]/.exec(rest);
  const raw = next ? rest.slice(0, next.index) : rest;
  return raw.replace(/[→\s（(）)]*$/u, '').trim();
}

/**
 * Parse a lessons ledger (or block body) into dated entries.
 * @param {string} raw
 * @returns {{count:number, latestAt:number|null, entries:{at:number,trigger:string,rule:string,evidence:string,line:number}[]}}
 */
export function parseLessons(raw) {
  const entries = [];
  const lines = String(raw ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = LESSON_ITEM_RE.exec(lines[i]);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const at = Date.UTC(year, month - 1, day);
    const checked = new Date(at);
    if (Number.isNaN(at) || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) continue;
    const body = match[4] || '';
    entries.push({
      at,
      trigger: fieldValue(body, '触发'),
      rule: fieldValue(body, '做法'),
      evidence: fieldValue(body, '证据'),
      line: i + 1,
    });
  }
  let latestAt = null;
  for (const entry of entries) {
    if (latestAt === null || entry.at > latestAt) latestAt = entry.at;
  }
  return { count: entries.length, latestAt, entries };
}

/**
 * Render one lesson as the canonical single-line entry.
 * @param {{at:number|Date|string, trigger:string, rule:string, evidence?:string}} input
 */
export function composeLessonEntry({ at, trigger, rule, evidence }) {
  const t = lessonField(trigger, 120);
  const r = lessonField(rule, 300);
  const e = lessonField(evidence, 120);
  let line = `- [${isoDate(at)}] 触发：${t} → 做法：${r}`;
  if (e) line += `（证据：${e}）`;
  return line;
}

/**
 * Insert or update the managed lessons block in a subject body. Idempotent:
 * re-running with the same entries replaces the block instead of duplicating it.
 * @param {string} raw subject body
 * @param {(string|{at:number,trigger:string,rule:string,evidence?:string})[]} entries
 * @returns {string}
 */
export function upsertLessonsBlock(raw, entries) {
  const { start, end } = LESSONS_BLOCK;
  const body = String(raw ?? '');
  const entryLines = (Array.isArray(entries) ? entries : [])
    .map((entry) => (typeof entry === 'string' ? entry : composeLessonEntry(entry)))
    .filter(Boolean);
  const block = [start, ...entryLines, end].join('\n');
  const startIdx = body.indexOf(start);
  if (startIdx >= 0) {
    const endIdx = body.indexOf(end, startIdx + start.length);
    if (endIdx >= 0) {
      return `${body.slice(0, startIdx)}${block}${body.slice(endIdx + end.length)}`;
    }
  }
  return `${body.replace(/\s+$/, '')}\n\n${block}\n`;
}

/**
 * Assemble the evolution state for one subject.
 * @param {object} input
 * @param {object} [input.signals] per-path signal record from collectUsage
 * @param {object} [input.usage] { sessions, lastUsedAt }
 * @param {object} [input.lessons] result of parseLessons
 * @param {boolean} [input.linked] whether the body has the managed lessons block
 * @param {number} [input.now]
 */
export function buildEvolution({
  signals = {},
  usage = {},
  lessons = {},
  linked = false,
  now = Date.now(),
}) {
  const sig = signals && typeof signals === 'object' ? signals : {};
  const usageSessions = Number(usage?.sessions) || 0;
  const sessions = Number(sig.sessions) || 0;
  const reloads = Number(sig.reloads) || 0;
  const postLoadErrors = Number(sig.postLoadErrors) || 0;
  const corrections = Number(sig.corrections) || 0;
  const asks = Number(sig.asks) || 0;
  const turnFailures = Number(sig.turnFailures) || 0;
  const lastSignalAt = sig.lastSignalAt != null ? Number(sig.lastSignalAt) || null : null;
  const samples = (Array.isArray(sig.samples) ? sig.samples : []).slice(0, MAX_SIGNAL_SAMPLES);

  const entries = (Array.isArray(lessons.entries) ? lessons.entries : []).slice(0, MAX_LESSON_ENTRIES);
  const lessonsCount = Number(lessons.count) || entries.length;
  const latestAt = lessons.latestAt != null ? Number(lessons.latestAt) || null : null;

  const pendingScore = corrections * 3 + postLoadErrors * 2 + reloads * 2 + turnFailures * 2 + asks;
  const latestLessonDayEnd = latestAt != null ? latestAt + DAY_MS - 1 : null;
  const hasUnclosed = pendingScore > 0
    && (latestLessonDayEnd == null || lastSignalAt == null || lastSignalAt > latestLessonDayEnd);

  const latestSignal = samples.find((sample) => sample.kind === 'correction')
    || samples.find((sample) => sample.kind === 'error')
    || samples[0]
    || null;
  const draft = {
    trigger: latestSignal ? String(latestSignal.excerpt || '') : '',
    rule: '',
    evidence: latestSignal && latestSignal.sessionId ? `session ${latestSignal.sessionId}` : '',
  };

  const applicable = usageSessions > 0 || lessonsCount > 0 || pendingScore > 0;

  const proposals = hasUnclosed
    ? [{
        id: 'evolution.add-lesson',
        title: '沉淀一条“触发→做法”经验',
        why: latestLessonDayEnd == null
          ? `窗口内出现 ${pendingScore} 个生效后信号（纠错/报错/失败/追问），还没有对应经验。`
          : `窗口内出现 ${pendingScore} 个生效后信号，最新信号晚于最近一条经验。`,
        evidence: latestSignal
          ? { sessionId: latestSignal.sessionId, at: latestSignal.at, excerpt: latestSignal.excerpt }
          : null,
        draft,
      }]
    : [];

  return {
    applicable,
    lessons: { count: lessonsCount, latestAt, linked: !!linked, entries },
    signals: {
      sessions,
      reloads,
      postLoadErrors,
      corrections,
      asks,
      turnFailures,
      lastSignalAt,
      samples,
    },
    pending: { score: pendingScore, hasUnclosed, lastSignalAt, draft },
    proposals,
  };
}
