/**
 * Shared 18-bucket grade scale for dsh-360 (both surfaces: skills + agents).
 *
 * Six letters S/A/B/C/D/E, each split into `+ / plain / -`, so 18 buckets in
 * one comparable scale. The letter expresses overall health; the tier says
 * where inside the letter the subject sits. Both rubrics feed the same
 * `total` (0..100) into `gradeFor`, which is the ONLY place thresholds live.
 *
 *   S+ ≥96   S ≥93   S- ≥90
 *   A+ ≥87   A ≥84.5 A- ≥82
 *   B+ ≥79   B ≥75.5 B- ≥72
 *   C+ ≥68   C ≥64   C- ≥60
 *   D+ ≥55   D ≥50   D- ≥45
 *   E+ ≥37   E ≥28   E- ≥0
 */

/** Ordered best → worst. Index is the comparable rank (lower is better). */
export const GRADE_SCALE = Object.freeze([
  { code: 'S+', letter: 'S', tier: '+', min: 96, max: 100 },
  { code: 'S', letter: 'S', tier: '', min: 93, max: 95.99 },
  { code: 'S-', letter: 'S', tier: '-', min: 90, max: 92.99 },
  { code: 'A+', letter: 'A', tier: '+', min: 87, max: 89.99 },
  { code: 'A', letter: 'A', tier: '', min: 84.5, max: 86.99 },
  { code: 'A-', letter: 'A', tier: '-', min: 82, max: 84.49 },
  { code: 'B+', letter: 'B', tier: '+', min: 79, max: 81.99 },
  { code: 'B', letter: 'B', tier: '', min: 75.5, max: 78.99 },
  { code: 'B-', letter: 'B', tier: '-', min: 72, max: 75.49 },
  { code: 'C+', letter: 'C', tier: '+', min: 68, max: 71.99 },
  { code: 'C', letter: 'C', tier: '', min: 64, max: 67.99 },
  { code: 'C-', letter: 'C', tier: '-', min: 60, max: 63.99 },
  { code: 'D+', letter: 'D', tier: '+', min: 55, max: 59.99 },
  { code: 'D', letter: 'D', tier: '', min: 50, max: 54.99 },
  { code: 'D-', letter: 'D', tier: '-', min: 45, max: 49.99 },
  { code: 'E+', letter: 'E', tier: '+', min: 37, max: 44.99 },
  { code: 'E', letter: 'E', tier: '', min: 28, max: 36.99 },
  { code: 'E-', letter: 'E', tier: '-', min: 0, max: 27.99 },
]);

/** Human labels (zh default; en available for the client dictionary). */
export const GRADE_LABELS = Object.freeze({
  S: { zh: '卓越', en: 'excellent' },
  A: { zh: '优秀', en: 'great' },
  B: { zh: '良好', en: 'good' },
  C: { zh: '及格', en: 'fair' },
  D: { zh: '偏弱', en: 'weak' },
  E: { zh: '危险', en: 'critical' },
});

const RANK = new Map(GRADE_SCALE.map((entry, index) => [entry.code, index]));

/**
 * @param {number} total 0..100
 * @returns {{code:string, letter:string, tier:string, label:string, rank:number, min:number, max:number}}
 */
export function gradeFor(total) {
  const value = Number.isFinite(total) ? Math.max(0, Math.min(100, total)) : 0;
  const entry = GRADE_SCALE.find((band) => value >= band.min) || GRADE_SCALE[GRADE_SCALE.length - 1];
  return {
    code: entry.code,
    letter: entry.letter,
    tier: entry.tier,
    label: `${entry.code} ${GRADE_LABELS[entry.letter].zh}`,
    labelEn: `${entry.code} ${GRADE_LABELS[entry.letter].en}`,
    rank: RANK.get(entry.code),
    min: entry.min,
    max: entry.max,
  };
}

/** Convenience for report/UI code that only needs the bucket code. */
export function gradeCode(total) {
  return gradeFor(total).code;
}

/** Compare two buckets: negative when `a` is better, positive when worse. */
export function compareGrades(a, b) {
  const ra = RANK.has(a) ? RANK.get(a) : GRADE_SCALE.length;
  const rb = RANK.has(b) ? RANK.get(b) : GRADE_SCALE.length;
  return ra - rb;
}

/** All codes best → worst (for filters / legends). */
export const GRADE_CODES = Object.freeze(GRADE_SCALE.map((entry) => entry.code));

/** Letter groups (for coarse filters). */
export const GRADE_LETTERS = Object.freeze(['S', 'A', 'B', 'C', 'D', 'E']);
