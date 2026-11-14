// Dictation text polish: pure functions, zero dependencies, no DOM.
//
// Ported (and simplified from `{ text, notes }` to plain strings) out of
// dsh-plugins/plugins/realtime-voice/client.js — the functions `stripFillers`,
// `collapseRepeats`, `resolveSelfCorrections`, `applySpokenCommands`,
// `fixPunctuation`, `applyDictionary`, `mergeSegments`, `seamNeedsSpace`.
// The audio/VAD/ASR stack stays in audio.js; this file only rewrites text.
//
// Every export is side-effect free: same input → same output, no globals read.

const CJK_RANGE = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';
const CJK_CHAR = new RegExp('[' + CJK_RANGE + ']');
const CJK_RUN = new RegExp('[' + CJK_RANGE + ']', 'g');
const LATIN = /[A-Za-z0-9]/;
const TERMINAL = '。！？!?…';
const SOFT = '，,、；;：:';
const CJK_PUNCT = '，。！？、；：…“”‘’（）《》〈〉【】—～·';

// -------------------------------------------------------------- dictionary
/**
 * Parse the user dictionary text, one `from=to` pair per line.
 * Lines starting with `#`, empty lines and lines without `=` are ignored.
 * Returns an **array** of `{ from, to }` (ordered, duplicates kept) — the same
 * shape the realtime-voice settings store uses, so callers can JSON-encode it.
 */
export function parseDictionary(text) {
  const rows = String(text == null ? '' : text).split('\n');
  const out = [];
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const from = line.slice(0, at).trim();
    const to = line.slice(at + 1).trim();
    if (from) out.push({ from, to });
  }
  return out;
}

// ------------------------------------------------------------------ options
const DEFAULT_OPTIONS = {
  spokenCommands: true,
  filler: true,
  repeats: true,
  corrections: true,
  punctuation: true,
  spacing: true,
  dictionary: [],
};

function resolveOptions(options) {
  const out = { ...DEFAULT_OPTIONS, ...(options || {}) };
  if (typeof out.dictionary === 'string') out.dictionary = parseDictionary(out.dictionary);
  if (!Array.isArray(out.dictionary)) out.dictionary = [];
  out.dictionary = out.dictionary.filter((entry) => entry && typeof entry.from === 'string' && entry.from);
  return out;
}

// ------------------------------------------------------------- filler words
// A filler only counts when it stands alone between pauses: "那个项目" keeps
// its demonstrative, "那个，项目" loses the hesitation.
const FILLER_ZH = /(?:^|[，。！？、,.!?\s])(?:嗯+|呃+|额+|啊+|哦+|唉+|诶+|那个+|就是说)(?=[，。！？、,.!?\s]|$)/g;
const FILLER_EN = /\b(?:um+|uh+|er+|ah+|hmm+|you know|i mean)\b[,，]?\s*/gi;
// Sentence-initial hesitations arrive without any punctuation after them
// ("嗯我们走吧"), so they need their own rule.
const FILLER_LEAD = /^(?:(?:嗯+|呃+|额+|啊+|哦+|唉+|诶+)[，,、\s]*|(?:就是说|也就是说)[，,、\s]*)/;

export function stripFillers(text) {
  let out = String(text == null ? '' : text);
  out = out.replace(FILLER_ZH, (match) => (/^[，。！？、,.!?\s]/.test(match) ? match[0] : ''));
  out = out.replace(FILLER_EN, '');
  out = out.replace(FILLER_LEAD, '');
  out = out.replace(/([，,])\s*\1+/g, '$1');
  out = out.replace(/^[，,、\s]+/, '');
  return out;
}

// ---------------------------------------------------------------- stutters
// `([\u4e00-\u9fff]{1,3})\1+` in the source also ate legitimate reduplication
// ("我天天跑步" → "我天跑步"), so single characters are limited to the pronouns
// that people actually stutter on, and multi-character stutters start at two.
const STUTTER_CHAR = /(我|你|他|她|它|咱|这|那)\1+/g;

export function collapseRepeats(text) {
  let out = String(text == null ? '' : text);
  out = out.replace(STUTTER_CHAR, '$1');
  out = out.replace(/([\u4e00-\u9fff]{2,3})\1+/g, '$1');
  out = out.replace(/\b([A-Za-z]+)(?:\s+\1\b)+/gi, '$1');
  return out;
}

// ------------------------------------------------------- self-corrections
const CORRECTION_ZH = /(?:不对|说错了|我重说)\s*(?:[，,、]\s*)?(?:我是说|就是说|应该是|而是)?\s*/g;
const CORRECTION_ZH_WEAK = /不是[，,、]\s*(?:我是说|就是说|应该是)?\s*/g;
const CORRECTION_EN = /\b(?:no wait|i mean|sorry,?\s+i meant|rather)\b[,，]?\s*/gi;
const CORRECTION_LEAD_ZH = /(?:我是说|就是说|应该是|而是)/;
const REPLACE_LEAD = /^(?:是|改成|改为|换成|换为|用|要|选|取)[，,、\s]*/;

/**
 * Self-correction: keep the final intent.
 * "会议定在周三，不对，是周四" → "会议定在周四"; "不对，我是说明天" → "明天".
 * A bare "不对/不是" that merely continues the sentence ("这个方案不对，我们再想想")
 * is not a correction and leaves the text untouched.
 */
export function resolveSelfCorrections(text) {
  const source = String(text == null ? '' : text);
  if (!source) return source;

  let chosen = null;
  for (const pattern of [CORRECTION_ZH, CORRECTION_ZH_WEAK, CORRECTION_EN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[0].length === 0) { pattern.lastIndex += 1; continue; }
      const end = match.index + match[0].length;
      const head = source.slice(0, match.index).replace(/[，,、\s]+$/, '');
      const after = source.slice(end).trim();
      const explicit = CORRECTION_LEAD_ZH.test(match[0]) || /(?:说错了|我重说|no wait|i mean|i meant)/i.test(match[0]);
      const eligible = !head || explicit || REPLACE_LEAD.test(after);
      if (eligible && (!chosen || match.index >= chosen.index)) {
        chosen = { index: match.index, end, head, after };
      }
    }
  }
  if (!chosen || !chosen.after) return source;

  const replacesValue = REPLACE_LEAD.test(chosen.after);
  const tail = chosen.after.replace(REPLACE_LEAD, '').trim();
  if (!tail) return source;
  if (!chosen.head) return tail;
  // "…说完了。不对，我是说…" keeps the finished sentence, then appends the fix.
  if (!replacesValue) return /[。！？.!?…]$/.test(chosen.head) ? chosen.head + tail : tail;

  // The correction retires the value it replaces. Prefer the last clause
  // boundary; with no boundary ("会议定在周三") swap the final two characters,
  // which is how numerals and nouns get corrected in speech.
  const head = chosen.head;
  const cut = Math.max(head.lastIndexOf('，'), head.lastIndexOf(','), head.lastIndexOf('、'),
    head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf(';'), head.lastIndexOf(' '));
  if (cut > 0) return head.slice(0, cut) + tail;
  if (tail.length <= 8) return head.slice(0, Math.max(0, head.length - 2)) + tail;
  return tail;
}

// ------------------------------------------------------- spoken punctuation
// Deliberately tiny: only punctuation that has no other common meaning is
// rewritten. "列表" / "另起一段" / English "period" are left alone on purpose —
// rewriting them damaged ordinary prose far more often than it helped.
const SPELLED_PUNCT = [
  [/换行/g, '\n'],
  [/逗号/g, '，'],
  [/句号/g, '。'],
  [/问号/g, '？'],
  [/感叹号/g, '！'],
  [/冒号/g, '：'],
  [/分号/g, '；'],
  [/顿号/g, '、'],
];

export function applySpokenCommands(text) {
  let out = String(text == null ? '' : text);
  for (const [pattern, replacement] of SPELLED_PUNCT) out = out.replace(pattern, replacement);
  // A comma/period spoken at a seam arrives as "…， ，下一句" — squeeze the gaps.
  out = out.replace(/[ \t]*([，。！？、；：])[ \t]*/g, '$1');
  out = out.replace(/[ \t]*\n[ \t]*/g, '\n');
  return out;
}

// --------------------------------------------------------------- punctuation
function isCjkText(text) {
  const sample = String(text || '');
  if (!sample) return false;
  const cjk = (sample.match(CJK_RUN) || []).length;
  return cjk > 0 && cjk / Math.max(1, sample.replace(/\s/g, '').length) >= 0.2;
}

export function fixPunctuation(text) {
  let out = String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
  if (!out) return out;

  const cjk = isCjkText(out);
  out = out.replace(/([，。！？、：；,])[，。！？、：；,]+/g, '$1');

  if (cjk) {
    // Digit-adjacent latin punctuation is data, not prose: keep 1,000 and 10:30.
    out = out.replace(/(?<!\d),(?!\d)/g, '，')
      .replace(/(?<!\d);(?!\d)/g, '；')
      .replace(/(?<!\d):(?!\d)/g, '：')
      .replace(/\?/g, '？')
      .replace(/!/g, '！');
    out = out.replace(/([。！？])\s+/g, '$1');
    out = out.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
    out = out.replace(/ *\n */g, '\n');
    if (!/[。！？…\n]$/.test(out)) out += '。';
  } else {
    out = out.replace(/([.!?])\s+/g, '$1 ');
    if (!/[.!?…]$/.test(out)) out += '.';
    out = out.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix, letter) => prefix + letter.toUpperCase());
    out = out.replace(/\bi\b/g, 'I');
  }
  return out;
}

// ---------------------------------------------------------------- dictionary
export function applyDictionary(text, entries) {
  let out = String(text == null ? '' : text);
  for (const entry of entries || []) {
    if (!entry || !entry.from) continue;
    const escaped = String(entry.from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), entry.to == null ? '' : entry.to);
  }
  return out;
}

// ----------------------------------------------------------- CJK/Latin space
/** Put one space between a Chinese character and an English letter. */
export function addCjkLatinSpacing(text) {
  return String(text == null ? '' : text)
    .replace(/([\u3400-\u4dbf\u4e00-\u9fff])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])([\u3400-\u4dbf\u4e00-\u9fff])/g, '$1 $2')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// -------------------------------------------------------------------- polish
/**
 * One dictation segment → insertable text.
 * @param {string} text raw ASR text.
 * @param {object} [options] flags (`filler`, `repeats`, `corrections`,
 *   `spokenCommands`, `punctuation`, `spacing`) and `dictionary`
 *   (string or `{from,to}[]`).
 * @returns {string} polished text; `''` for empty input.
 */
export function polish(text, options = {}) {
  const settings = resolveOptions(options);
  let value = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  if (!value) return '';
  if (settings.spokenCommands) value = applySpokenCommands(value);
  if (settings.filler) value = stripFillers(value);
  if (settings.repeats) value = collapseRepeats(value);
  if (settings.corrections) value = resolveSelfCorrections(value);
  value = applyDictionary(value, settings.dictionary);
  if (settings.punctuation) value = fixPunctuation(value);
  if (settings.spacing) value = addCjkLatinSpacing(value);
  return value.trim();
}

// -------------------------------------------------------------- merge seams
/**
 * Should the seam between two already-inserted segments take a space?
 * Latin↔Latin and Chinese↔Latin take one; Chinese punctuation never does
 * (a space after "，" is wrong in both languages).
 */
export function seamNeedsSpace(left, right) {
  const a = String(left == null ? '' : left).slice(-1);
  const b = String(right == null ? '' : right).charAt(0);
  if (!a || !b) return false;
  if (/\s/.test(a) || /\s/.test(b)) return false;
  const cjkA = CJK_CHAR.test(a);
  const cjkB = CJK_CHAR.test(b);
  if (CJK_PUNCT.includes(a) || CJK_PUNCT.includes(b)) return false;
  if (cjkA && cjkB) return false;
  if ((cjkA && LATIN.test(b)) || (LATIN.test(a) && cjkB)) return true;
  if (LATIN.test(a) && LATIN.test(b)) return true;
  if (SOFT.includes(a) || TERMINAL.includes(a) || a === '.') return true;
  return /[)\]"'”’]/.test(a) && /[(\["'“‘]/.test(b);
}

const CORRECTION_LEAD = /^(?:不对|不是|不，|不,|呃不|哦不|我是说|我意思是|我的意思是|更正|纠正|应该是|确切地说)[，,、。：:\s]*/;

/**
 * Join the previous inserted sentence with a freshly recognized one.
 * Carries the realtime-voice seam rules: a correction that opens the new
 * segment retires the clause it supersedes, a repeated tail at the seam is
 * kept once, punctuation does not stack, and a space is added only where
 * typography wants one.
 * @returns {string} the merged text (no trailing punctuation is invented).
 */
export function mergeSentences(previous, next, options = {}) {
  const settings = resolveOptions(options);
  const head = String(previous == null ? '' : previous).trim();
  let tail = String(next == null ? '' : next).trim();
  if (!head) return tail;
  if (!tail) return head;

  let corrected = head;

  // 1. Correction opening the new segment: "会议定在周三" + "不对，是周四".
  if (settings.corrections !== false && CORRECTION_LEAD.test(tail)) {
    tail = tail.replace(CORRECTION_LEAD, '').replace(REPLACE_LEAD, '').trim();
    const cut = Math.max(corrected.lastIndexOf('，'), corrected.lastIndexOf(','), corrected.lastIndexOf('、'),
      corrected.lastIndexOf('。'), corrected.lastIndexOf('；'), corrected.lastIndexOf(';'), corrected.lastIndexOf(' '));
    if (cut > 0) corrected = corrected.slice(0, cut);
    // No delimiter to anchor on: a short replacement is a noun/numeral swap.
    else if (tail.length <= 8) corrected = corrected.slice(0, Math.max(0, corrected.length - 2));
  }

  // 2. Overlap at the seam: the recognizer re-emits the previous tail.
  const maxOverlap = Math.min(24, corrected.length, tail.length);
  for (let size = maxOverlap; size >= 3; size -= 1) {
    if (corrected.slice(corrected.length - size) === tail.slice(0, size)) {
      tail = tail.slice(size).replace(/^[\s，,、；;]+/, '');
      break;
    }
  }

  // 3. A segment that begins mid-sentence must not restart it with a capital.
  if (tail && !TERMINAL.includes(corrected[corrected.length - 1]) && corrected[corrected.length - 1] !== '.'
    && /^[A-Z][a-z]/.test(tail) && seamNeedsSpace(corrected, tail)) {
    tail = tail[0].toLowerCase() + tail.slice(1);
  }

  // 4. Do not stack punctuation at the seam ("…，" + "，下一句").
  if (tail && (SOFT.includes(tail[0]) || TERMINAL.includes(tail[0]))
    && (SOFT.includes(corrected[corrected.length - 1]) || TERMINAL.includes(corrected[corrected.length - 1]))) {
    tail = tail.replace(/^[\s，,、；;：:。！？!?…]+/, '');
  }

  if (!tail) return corrected;
  return corrected + (seamNeedsSpace(corrected, tail) ? ' ' : '') + tail;
}
