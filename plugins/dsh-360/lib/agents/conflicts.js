/**
 * Cross-file conflict detection (word-level heuristic). Compares imperative
 * "rule" lines between every pair of subjects:
 *
 *   - duplicate:     the same normalized sentence appears in ≥2 files → ratio 1
 *   - contradiction: same object stated positively vs negatively (「必须 X」vs
 *                    「不要 X」) → ratio = token overlap of the de-polarized object
 *
 * Results are **grouped by rule**, not by file pair: a boilerplate line copied
 * into 30 agent files yields ONE conflict entry with `count: 30` and the full
 * `subjects` list, instead of C(30,2) pairwise rows.
 *
 * This is deliberately shallow (see RUBRIC §11): synonymous-but-differently
 * worded contradictions will be missed.
 */
import { jaccard, normalizeText, overlapTokens } from '../util.js';

const RULE_LINE_RE = /(必须|不要|禁止|只用|always|never|must|should|avoid|don'?t|先[^，。]{0,12}再)/i;
const NEGATIVE_RE = /(不要|禁止|别|严禁|不得|不该|never|avoid|don'?t|must\s+not|should\s+not|do\s+not)/i;
const POSITIVE_RE = /(必须|一定|只用|always|must|should|先[^，。]{0,12}再)/i;

/** Normalized imperative lines worth comparing. */
function ruleLines(body) {
  if (!body) return [];
  return String(body).split('\n')
    .map((line, index) => ({ text: normalizeText(line), line: index + 1 }))
    .filter((entry) => entry.text.length >= 6 && entry.text.length <= 240
      && !/^#/.test(entry.text) && RULE_LINE_RE.test(entry.text));
}

/** Strip polarity markers so two opposite rules collapse onto the same object. */
function stripPolarity(text) {
  return text
    .replace(/(必须|一定要|一定|只用|不要|禁止|千万别|别|严禁|不得|不该)/g, ' ')
    .replace(/\b(always|never|must\s+not|must|should\s+not|should|avoid|don'?t|do\s+not)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object[]} reports each report must carry `id` and `body`
 * @returns {{a:string,b:string,ruleA:string,ruleB:string,kind:'duplicate'|'contradiction',
 *            ratio:number,lineA:number,lineB:number,count:number,subjects:string[]}[]}
 */
export function detectConflicts(reports) {
  const list = (reports || []).filter((report) => report && typeof report.body === 'string' && report.id);
  const duplicates = new Map();
  const contradictions = new Map();

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const linesA = ruleLines(a.body);
      const linesB = ruleLines(b.body);
      if (!linesA.length || !linesB.length) continue;

      // ---- duplicate: exact normalized-sentence match across files
      const aByText = new Map(linesA.map((entry) => [entry.text.toLowerCase(), entry]));
      for (const entryB of linesB) {
        const entryA = aByText.get(entryB.text.toLowerCase());
        if (!entryA) continue;
        const key = entryA.text.toLowerCase();
        const existing = duplicates.get(key);
        if (existing) {
          existing.count += 1;
          existing.subjects.add(a.id);
          existing.subjects.add(b.id);
          continue;
        }
        duplicates.set(key, {
          a: a.id, b: b.id, ruleA: entryA.text, ruleB: entryB.text,
          kind: 'duplicate', ratio: 1, lineA: entryA.line, lineB: entryB.line,
          count: 1, subjects: new Set([a.id, b.id]),
        });
      }

      // ---- contradiction: opposite polarity on overlapping objects
      for (const entryA of linesA) {
        const objectA = stripPolarity(entryA.text);
        const polarA = NEGATIVE_RE.test(entryA.text) ? 'neg' : POSITIVE_RE.test(entryA.text) ? 'pos' : null;
        if (!objectA || objectA.length < 4 || !polarA) continue;
        for (const entryB of linesB) {
          const objectB = stripPolarity(entryB.text);
          const polarB = NEGATIVE_RE.test(entryB.text) ? 'neg' : POSITIVE_RE.test(entryB.text) ? 'pos' : null;
          if (!objectB || objectB.length < 4 || !polarB) continue;
          if (polarA === polarB) continue;
          const ratio = jaccard(overlapTokens(objectA), overlapTokens(objectB));
          if (ratio < 0.4) continue;
          const key = [objectA, objectB].sort().join('\u0000');
          const existing = contradictions.get(key);
          if (existing) {
            existing.count += 1;
            existing.subjects.add(a.id);
            existing.subjects.add(b.id);
            continue;
          }
          contradictions.set(key, {
            a: a.id, b: b.id, ruleA: entryA.text, ruleB: entryB.text,
            kind: 'contradiction', ratio: Math.round(ratio * 1000) / 1000,
            lineA: entryA.line, lineB: entryB.line,
            count: 1, subjects: new Set([a.id, b.id]),
          });
        }
      }
    }
  }

  const materialize = (entry) => {
    const subjects = [...entry.subjects].sort();
    return { ...entry, subjects, count: subjects.length };
  };
  return [...duplicates.values()].map(materialize).concat([...contradictions.values()].map(materialize));
}
