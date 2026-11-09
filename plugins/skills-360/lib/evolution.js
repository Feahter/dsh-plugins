/**
 * Continuous-evolution core: parse/emit the `references/lessons.md` experience
 * log and assemble the per-skill evolution state that scoring, reporting and
 * the `skills360_evolve` tool all read.
 *
 * Everything here is pure and deterministic: no filesystem, no network, and
 * nothing throws on malformed input. `buildEvolution` degrades to a fully
 * "not applicable" state when no signals and no lessons exist.
 */
import { excerpt, triggerTerms } from './util.js';

/** Canonical location of the experience log inside a skill directory. */
export const LESSONS_PATH = 'references/lessons.md';

const DAY_MS = 86_400_000;
const MAX_LESSON_ENTRIES = 5;
const MAX_SIGNAL_SAMPLES = 6;
const MAX_PROMPT_SAMPLES = 3;

/** A lesson list item must start with `- ` and a (bracket-optional) date. */
const LESSON_ITEM_RE = /^\s*-\s*\[?(\d{4})-(\d{1,2})-(\d{1,2})\]?\s*(.*)$/;

function oneLine(text, max) {
  const cleaned = String(text ?? '')
    // Control characters (including NUL) would survive into a Markdown file
    // and confuse every reader/parser downstream.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/** Keep lesson text from forging the `触发/做法/证据` field delimiters. */
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

/**
 * Extract one `触发/做法/证据` field from a lesson body. Fields are
 * delimited by the next field label; trailing separators are stripped.
 * @param {string} text
 * @param {string} label
 * @returns {string}
 */
function fieldValue(text, label) {
  const start = new RegExp(`${label}\\s*[:：]`).exec(text);
  if (!start) return '';
  const rest = text.slice(start.index + start[0].length);
  const next = /(?:触发|做法|证据)\s*[:：]/.exec(rest);
  const raw = next ? rest.slice(0, next.index) : rest;
  return raw.replace(/[→\s（(）)]*$/u, '').trim();
}

/**
 * Parse the `references/lessons.md` text into dated entries.
 *
 * Only lines that start with `- [YYYY-MM-DD]` (or `- YYYY-MM-DD`) count as
 * lessons; the header and blockquote are ignored. `at` is UTC-midnight ms so
 * a parsed line round-trips through `composeLessonEntry` exactly.
 *
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
    // Date.UTC rolls 2026-99-99 forward into a real date. Reject impossible
    // dates instead of counting them as fresh lessons.
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
 * @returns {string}
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
 * Assemble the evolution state for one skill from raw usage signals, the
 * parsed lesson log and real-request prompts.
 *
 * @param {object} input
 * @param {object} [input.signals] per-skill signal record from collectUsage
 * @param {number} [input.loads] number of on-demand loads (usage.count)
 * @param {object} [input.lessons] result of parseLessons
 * @param {boolean} [input.linked] whether SKILL.md links references/lessons.md
 * @param {{at:number,sessionId:string,text:string}[]} [input.prompts]
 * @param {string} [input.description] skill description for prompt recall
 * @param {number} [input.now]
 * @returns {object} SPEC §4 shape
 */
export function buildEvolution({
  signals = {},
  loads,
  lessons = {},
  linked = false,
  prompts = [],
  description = '',
  now = Date.now(),
}) {
  const sig = signals && typeof signals === 'object' ? signals : {};
  const loadsCount = Number(loads ?? sig.loads) || 0;
  const sessions = Number(sig.sessions) || 0;
  const reloads = Number(sig.reloads) || 0;
  const postLoadErrors = Number(sig.postLoadErrors) || 0;
  const corrections = Number(sig.corrections) || 0;
  const asks = Number(sig.asks) || 0;
  const turnFailures = Number(sig.turnFailures) || 0;
  const lastLoadAt = sig.lastLoadAt != null ? Number(sig.lastLoadAt) || null : null;
  const lastSignalAt = sig.lastSignalAt != null ? Number(sig.lastSignalAt) || null : null;
  const samples = (Array.isArray(sig.samples) ? sig.samples : []).slice(0, MAX_SIGNAL_SAMPLES);

  const entries = (Array.isArray(lessons.entries) ? lessons.entries : []).slice(0, MAX_LESSON_ENTRIES);
  const lessonsCount = Number(lessons.count) || entries.length;
  const latestAt = lessons.latestAt != null ? Number(lessons.latestAt) || null : null;

  const pendingScore = corrections * 3 + postLoadErrors * 2 + reloads * 2 + turnFailures * 2 + asks;
  // Lessons are date-granular ("[YYYY-MM-DD]"), signals are milliseconds. A
  // lesson written today must cover today's signals, or the loop would keep
  // showing "unclosed" for the rest of the day after the user writes it.
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

  const applicable = loadsCount > 0 || lessonsCount > 0 || pendingScore > 0;

  const descTerms = [...triggerTerms(String(description))];
  const promptList = Array.isArray(prompts) ? prompts : [];
  let matched = 0;
  const unmatched = [];
  for (const prompt of promptList) {
    const text = String(prompt?.text || '').toLowerCase();
    const hit = descTerms.some((term) => term && text.includes(term));
    if (hit) {
      matched += 1;
    } else if (unmatched.length < MAX_PROMPT_SAMPLES) {
      unmatched.push({
        at: prompt?.at != null ? Number(prompt.at) || null : null,
        sessionId: prompt?.sessionId ?? '',
        excerpt: excerpt(prompt?.text, 160),
      });
    }
  }
  const total = promptList.length;
  const recall = total > 0 ? matched / total : null;

  const proposals = hasUnclosed
    ? [{
        id: 'evolution.add-lesson',
        title: '沉淀一条“触发→做法”经验',
        why: latestLessonDayEnd == null
          ? `窗口内出现 ${pendingScore} 个加载后信号（纠错/报错/重复加载/失败/追问），还没有对应经验。`
          : `窗口内出现 ${pendingScore} 个加载后信号，最新信号晚于最近一条经验。`,
        evidence: latestSignal
          ? { sessionId: latestSignal.sessionId, at: latestSignal.at, excerpt: latestSignal.excerpt }
          : null,
        draft,
      }]
    : [];

  return {
    applicable,
    loads: loadsCount,
    lessons: { count: lessonsCount, latestAt, linked: !!linked, entries },
    signals: {
      loads: loadsCount,
      sessions,
      reloads,
      postLoadErrors,
      corrections,
      asks,
      turnFailures,
      lastLoadAt,
      lastSignalAt,
      samples,
    },
    pending: { score: pendingScore, hasUnclosed, lastSignalAt, draft },
    promptRecall: { total, matched, recall, samples: unmatched },
    proposals,
  };
}
