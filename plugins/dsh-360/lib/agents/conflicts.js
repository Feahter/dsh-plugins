/**
 * Cross-file conflict detection (word-level heuristic). Compares imperative
 * "rule" lines between every pair of subjects, but the per-subject work is
 * done once:
 *
 *   - duplicate:     the same normalized sentence appears in ≥2 files → ratio 1
 *   - contradiction: same object stated positively vs negatively (「必须 X」vs
 *                    「不要 X」) → ratio = token overlap of the de-polarized object
 *
 * Results are **grouped by rule**, not by file pair: a boilerplate line copied
 * into 30 agent files yields ONE conflict entry with `count: 30` and the full
 * `subjects` list, instead of C(30,2) pairwise rows.
 *
 * Implementation notes (performance only, no semantic change):
 *   - rule lines, de-polarized text and object token sets are computed once per
 *     report, not once per pair (the old O(n²) pass re-tokenized every body for
 *     every pair);
 *   - duplicates use an inverted index keyed by the normalized line text, so a
 *     group is emitted directly from its owners;
 *   - contradictions use an inverted token index plus the necessary
 *     Jaccard ≥ 0.4 size bound, so only line pairs that can reach the
 *     threshold are scored. `a`/`b`/`ruleA`/`ruleB` keep the first pair the old
 *     pair-major loop would have emitted.
 *
 * This is deliberately shallow (see RUBRIC §11): synonymous-but-differently
 * worded contradictions will be missed.
 */
import { normalizeText, overlapTokens } from '../util.js';

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
 * Pre-computed contradiction candidate for one rule line. Returns null for
 * lines that could never take part in a contradiction (too short, no
 * polarity), matching the old per-pair guard.
 */
function contradictionRecord(entry) {
  const object = stripPolarity(entry.text);
  if (!object || object.length < 4) return null;
  const polar = NEGATIVE_RE.test(entry.text) ? 'neg' : POSITIVE_RE.test(entry.text) ? 'pos' : null;
  if (!polar) return null;
  return { line: entry.line, text: entry.text, object, polar, tokens: overlapTokens(object) };
}

/** True when `left` is the pair the old pair-major loop would reach first. */
function pairEarlier(left, right) {
  if (left.i !== right.i) return left.i < right.i;
  if (left.j !== right.j) return left.j < right.j;
  if (left.lineA !== right.lineA) return left.lineA < right.lineA;
  return left.lineB < right.lineB;
}

/** Deterministic final order (the pair-major loop's order is not preserved). */
function compareEntries(left, right) {
  if (left.a !== right.a) return left.a < right.a ? -1 : 1;
  if (left.b !== right.b) return left.b < right.b ? -1 : 1;
  if (left.ruleA !== right.ruleA) return left.ruleA < right.ruleA ? -1 : 1;
  if (left.ruleB !== right.ruleB) return left.ruleB < right.ruleB ? -1 : 1;
  if (left.lineA !== right.lineA) return left.lineA - right.lineA;
  if (left.lineB !== right.lineB) return left.lineB - right.lineB;
  return left.ratio - right.ratio;
}

/**
 * @param {object[]} reports each report must carry `id` and `body`
 * @returns {{a:string,b:string,ruleA:string,ruleB:string,kind:'duplicate'|'contradiction',
 *            ratio:number,lineA:number,lineB:number,count:number,subjects:string[]}[]}
 */
export function detectConflicts(reports) {
  const list = (reports || []).filter((report) => report && typeof report.body === 'string' && report.id);
  if (list.length < 2) return [];

  const duplicateGroups = new Map();
  const recordsByReport = [];
  const postings = new Map();

  for (let index = 0; index < list.length; index += 1) {
    const lines = ruleLines(list[index].body);

    // ---- duplicate: one owner per report; the left side uses the last
    // occurrence of the normalized line, the right side the first (matching
    // the old Map-per-pair construction).
    if (lines.length > 0) {
      const seen = new Map();
      for (const entry of lines) {
        const key = entry.text.toLowerCase();
        const owner = seen.get(key);
        if (owner) {
          owner.lastLine = entry.line;
          owner.lastText = entry.text;
        } else {
          seen.set(key, {
            index, firstLine: entry.line, lastLine: entry.line,
            firstText: entry.text, lastText: entry.text,
          });
        }
      }
      for (const [key, owner] of seen) {
        let group = duplicateGroups.get(key);
        if (!group) {
          group = { owners: [] };
          duplicateGroups.set(key, group);
        }
        group.owners.push(owner);
      }
    }

    // ---- contradiction candidates: strip + tokenize each rule line once
    const valid = [];
    for (const entry of lines) {
      const record = contradictionRecord(entry);
      if (!record) continue;
      record.report = index;
      valid.push(record);
      for (const token of record.tokens) {
        const bucket = postings.get(token);
        if (bucket) bucket.push(record);
        else postings.set(token, [record]);
      }
    }
    recordsByReport.push(valid);
  }

  // ------------------------------------------------------------------ duplicates
  const duplicates = [];
  for (const group of duplicateGroups.values()) {
    if (group.owners.length < 2) continue;
    const first = group.owners[0];
    const second = group.owners[1];
    const subjects = [...new Set(group.owners.map((owner) => list[owner.index].id))].sort();
    duplicates.push({
      a: list[first.index].id,
      b: list[second.index].id,
      ruleA: first.lastText,
      ruleB: second.firstText,
      kind: 'duplicate',
      ratio: 1,
      lineA: first.lastLine,
      lineB: second.firstLine,
      count: subjects.length,
      subjects,
    });
  }

  // --------------------------------------------------------------- contradictions
  const contradictionGroups = new Map();
  for (let i = 0; i < list.length; i += 1) {
    for (const recordA of recordsByReport[i]) {
      const hits = new Map();
      for (const token of recordA.tokens) {
        const bucket = postings.get(token);
        if (!bucket) continue;
        for (const recordB of bucket) {
          if (recordB.report <= i) continue;
          if (recordB.polar === recordA.polar) continue;
          hits.set(recordB, (hits.get(recordB) || 0) + 1);
        }
      }
      if (hits.size === 0) continue;
      const sizeA = recordA.tokens.size;
      for (const [recordB, shared] of hits) {
        const sizeB = recordB.tokens.size;
        // Necessary condition for Jaccard >= 0.4: |A∩B| >= 2|A∪B|/5 and
        // |A∩B| <= min(|A|,|B|) ⇒ 7·min(|A|,|B|) >= 2(|A|+|B|).
        if (7 * Math.min(sizeA, sizeB) < 2 * (sizeA + sizeB)) continue;
        const ratio = shared / (sizeA + sizeB - shared);
        if (ratio < 0.4) continue;

        const key = [recordA.object, recordB.object].sort().join('\u0000');
        const pair = {
          i, j: recordB.report, lineA: recordA.line, lineB: recordB.line,
          textA: recordA.text, textB: recordB.text, ratio,
        };
        let group = contradictionGroups.get(key);
        if (!group) {
          group = { best: pair, subjects: new Set() };
          contradictionGroups.set(key, group);
        } else if (pairEarlier(pair, group.best)) {
          group.best = pair;
        }
        group.subjects.add(list[i].id);
        group.subjects.add(list[recordB.report].id);
      }
    }
  }

  const contradictions = [];
  for (const group of contradictionGroups.values()) {
    const { best } = group;
    const subjects = [...group.subjects].sort();
    contradictions.push({
      a: list[best.i].id,
      b: list[best.j].id,
      ruleA: best.textA,
      ruleB: best.textB,
      kind: 'contradiction',
      ratio: Math.round(best.ratio * 1000) / 1000,
      lineA: best.lineA,
      lineB: best.lineB,
      count: subjects.length,
      subjects,
    });
  }

  duplicates.sort(compareEntries);
  contradictions.sort(compareEntries);
  return duplicates.concat(contradictions);
}
