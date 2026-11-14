import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDictionary,
  polish,
  mergeSentences,
  collapseRepeats,
  resolveSelfCorrections,
  seamNeedsSpace,
} from '../src/client/polish.js';

test('empty input stays empty', () => {
  assert.equal(polish(''), '');
  assert.equal(polish('   '), '');
  assert.equal(polish(null), '');
  assert.equal(polish(undefined), '');
});

test('removes Chinese filler words without eating real words', () => {
  assert.equal(polish('嗯，那个，我们今天开会。'), '我们今天开会。');
  assert.equal(polish('呃那个项目我们明天聊'), '那个项目我们明天聊。');
  assert.equal(polish('就是说我下午到'), '我下午到。');
  assert.equal(polish('嗯我们走吧'), '我们走吧。');
});

test('removes English filler words', () => {
  assert.equal(polish('um, so we ship it uh today'), 'So we ship it today.');
});

test('collapses stutters but keeps reduplication', () => {
  assert.equal(polish('我们我们明天明天开会'), '我们明天开会。');
  assert.equal(collapseRepeats('这个这个方案'), '这个方案');
  assert.equal(collapseRepeats('我天天跑步'), '我天天跑步');
  assert.equal(collapseRepeats('the the plan'), 'the plan');
});

test('takes the corrected value for self-corrections', () => {
  assert.equal(polish('会议定在周三，不对，是周四'), '会议定在周四。');
  assert.equal(polish('不对，我是说明天下午'), '明天下午。');
  assert.equal(polish('我用蓝色，不是，用红色'), '我用红色。');
  assert.equal(
    resolveSelfCorrections('我们十点开始，说错了，十点半开始'),
    '十点半开始',
  );
});

test('a bare 不对 that continues the thought is not a correction', () => {
  assert.equal(polish('这个方案不对，我们再想想'), '这个方案不对，我们再想想。');
});

test('expands a small set of spoken punctuation', () => {
  assert.equal(polish('我们明天开会逗号然后去吃饭句号'), '我们明天开会，然后去吃饭。');
  assert.equal(polish('真的吗问号'), '真的吗？');
});

test('applies the dictionary, last rule wins', () => {
  const entries = parseDictionary([
    '# 项目词典',
    'Mac=macOS',
    '',
    '没有等号的行',
    '=空原词',
    'AI=人工智能',
  ].join('\n'));
  assert.deepEqual(entries, [
    { from: 'Mac', to: 'macOS' },
    { from: 'AI', to: '人工智能' },
  ]);
  assert.equal(polish('我们用Mac和AI', { dictionary: 'Mac=macOS' }), '我们用 macOS 和 AI。');
  assert.equal(polish('我把mac 和 mac 都装了', { dictionary: entries }), '我把 macOS 和 macOS 都装了。');
});

test('spaces only Chinese↔English, never digits or punctuation', () => {
  assert.equal(polish('我用Mac写代码'), '我用 Mac 写代码。');
  assert.equal(polish('预算是1,000元'), '预算是1,000元。');
  assert.equal(polish('第3章讲API'), '第3章讲 API。');
  assert.equal(polish('我们，Hello'), '我们，Hello。');
});

test('English text is capitalized, not given Chinese punctuation', () => {
  assert.equal(polish('hello world'), 'Hello world.');
  assert.equal(polish('we ship it. then we rest'), 'We ship it. Then we rest.');
});

test('mergeSentences dedupes a repeated seam', () => {
  assert.equal(
    mergeSentences('我们明天上午开会', '上午开会讨论方案'),
    '我们明天上午开会讨论方案',
  );
  assert.equal(mergeSentences('我们用 Mac', 'Mac 很好用'), '我们用 Mac 很好用');
});

test('mergeSentences carries a cross-sentence correction', () => {
  assert.equal(mergeSentences('会议定在周三', '不对，是周四'), '会议定在周四');
  assert.equal(mergeSentences('我用蓝色', '不是，用红色'), '我用红色');
});

test('mergeSentences adds a space only where typography wants one', () => {
  assert.equal(mergeSentences('我用Mac', '写代码'), '我用Mac 写代码');
  assert.equal(mergeSentences('你好，', '世界'), '你好，世界');
  assert.equal(mergeSentences('', '单独一句'), '单独一句');
  assert.equal(mergeSentences('只有一句', ''), '只有一句');
});

test('seamNeedsSpace agrees with the merge rules', () => {
  assert.equal(seamNeedsSpace('你好', '世界'), false);
  assert.equal(seamNeedsSpace('Mac', '写代码'), true);
  assert.equal(seamNeedsSpace('你好，', '世界'), false);
  assert.equal(seamNeedsSpace('hello', 'world'), true);
});
