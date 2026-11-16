/**
 * Markdown section scanning — `findSections` must not treat a `## ` line inside
 * a fenced code block as a heading. The extract-sections fix moves whole line
 * ranges, so a false section here means moving code into a reference file with
 * the wrong boundaries.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSections, findReferenceSections, replaceSection } from '../lib/util.js';

test('四反引号围栏里的 ## 行不是标题，围栏后的真标题仍被识别', () => {
  const body = [
    '## Real',
    '',
    '````md',
    'Show a fence:',
    '```js',
    '## Fake heading inside fence',
    '```',
    '````',
    '',
    '## After real',
    '',
  ].join('\n');
  const { sections } = findSections(body);
  assert.deepEqual(sections.map((section) => section.title), ['Real', 'After real']);
});

test('同长或更长的同字符围栏才关闭代码块，info string 只允许出现在开围栏', () => {
  const body = [
    '## One',
    '~~~',
    '```',
    '## Not a heading',
    '~~~',
    '## Two',
  ].join('\n');
  assert.deepEqual(findSections(body).sections.map((section) => section.title), ['One', 'Two']);
});

test('围栏外的普通分段与行号保持原语义', () => {
  const body = ['# Title', '', 'intro', '## A', 'line 1', 'line 2', '## B', 'tail'].join('\n');
  const { sections, hasH1 } = findSections(body);
  assert.equal(hasH1, true);
  assert.deepEqual(sections.map((section) => [section.title, section.startLine, section.endLine]), [
    ['A', 3, 6],
    ['B', 6, 8],
  ]);
  const replaced = replaceSection(body, sections[0], '## A\npointer');
  assert.equal(replaced, ['# Title', '', 'intro', '## A', 'pointer', '## B', 'tail'].join('\n'));
});

test('findReferenceSections 不会把围栏里的伪标题当候选', () => {
  const body = [
    '## Skill',
    '',
    '````',
    ...Array.from({ length: 70 }, (_, i) => `code line ${i}`),
    '## 参考资源 inside fence',
    '````',
    '',
  ].join('\n');
  // The real `参考资源` heading is inside the fence: no candidate may be produced.
  assert.deepEqual(findReferenceSections(body), []);
});
