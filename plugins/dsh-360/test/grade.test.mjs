import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gradeFor, gradeCode, compareGrades, GRADE_CODES, GRADE_LETTERS,
} from '../lib/grade.js';

test('grade boundaries map to the exact 18 codes', () => {
  const cases = [
    [96, 'S+'], [93, 'S'], [90, 'S-'],
    [87, 'A+'], [84.5, 'A'], [82, 'A-'],
    [79, 'B+'], [75.5, 'B'], [72, 'B-'],
    [68, 'C+'], [64, 'C'], [60, 'C-'],
    [55, 'D+'], [50, 'D'], [45, 'D-'],
    [37, 'E+'], [28, 'E'], [0, 'E-'],
  ];
  for (const [total, code] of cases) {
    assert.equal(gradeFor(total).code, code, `${total} should map to ${code}`);
  }
});

test('gradeFor exposes letter, tier, rank and labels', () => {
  const g = gradeFor(88);
  assert.equal(g.code, 'A+');
  assert.equal(g.letter, 'A');
  assert.equal(g.tier, '+');
  assert.equal(g.rank, 3);
  assert.match(g.label, /A\+/);
  assert.equal(typeof g.labelEn, 'string');
  assert.equal(gradeFor(84.5).letter, 'A');
  assert.equal(gradeFor(84.5).tier, '');
});

test('rank is monotonic: a higher total never maps to a worse (larger) rank', () => {
  let prev = gradeFor(0).rank;
  for (let total = 0.5; total <= 100; total += 0.5) {
    const rank = gradeFor(total).rank;
    assert.ok(rank <= prev, `rank should not increase at total=${total}`);
    prev = rank;
  }
});

test('out-of-range totals clamp to the extreme buckets', () => {
  assert.equal(gradeFor(-5).code, 'E-');
  assert.equal(gradeFor(120).code, 'S+');
  assert.equal(gradeFor(Number.NaN).code, 'E-');
});

test('gradeCode returns the same bucket code', () => {
  assert.equal(gradeCode(86), gradeFor(86).code);
  assert.equal(gradeCode(84.5), 'A');
  assert.equal(gradeCode(0), 'E-');
});

test('compareGrades orders better grades first', () => {
  assert.ok(compareGrades('S+', 'A') < 0);
  assert.ok(compareGrades('A', 'E-') < 0);
  assert.ok(compareGrades('E-', 'S+') > 0);
  assert.equal(compareGrades('B', 'B'), 0);
  assert.ok(compareGrades('C-', 'C+') > 0, 'C- is worse than C+');
  assert.ok(compareGrades('B+', 'A-') > 0, 'B+ is worse than A-');
});

test('GRADE_CODES and GRADE_LETTERS are ordered and complete', () => {
  assert.equal(GRADE_CODES.length, 18);
  assert.equal(GRADE_LETTERS.length, 6);
  assert.deepEqual(GRADE_LETTERS, ['S', 'A', 'B', 'C', 'D', 'E']);
  assert.equal(GRADE_CODES[0], 'S+');
  assert.equal(GRADE_CODES[17], 'E-');
});
