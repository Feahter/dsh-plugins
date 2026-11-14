// Fake-DOM harness for src/client/dictation.js.
// No jsdom, no browser, no timers: a fake ctx.slots records registrations and a
// fake React only needs `useEffect`. Renders the registered slot component by
// calling it directly, the way React would on the input slot's first render.

import assert from 'node:assert/strict';

import { createDictation } from '../src/client/dictation.js';

function makeSlots({ failActivity = false } = {}) {
  const registrations = [];
  return {
    registrations,
    register(options, Component) {
      registrations.push({ options, Component });
      if (failActivity && options.name === 'conversation.input.activity') {
        throw new Error('slot not supported');
      }
      return { dispose() { Component.disposed = true; } };
    },
  };
}

const FakeReact = {
  useEffect(fn) { FakeReact.effects.push(fn); },
  effects: [],
};

const fakeRequire = (name) => {
  if (name === 'react') return FakeReact;
  throw new Error('unexpected module ' + name);
};

function makeActions(overrides = {}) {
  const calls = { insertText: [], captureInsertion: 0 };
  const actions = {
    insertText(text, target) {
      calls.insertText.push([text, target]);
      return true;
    },
    captureInsertion() {
      calls.captureInsertion += 1;
      return 'insertion-token';
    },
    replaceText() { return true; },
    ...overrides,
  };
  return { actions, calls };
}

function makeDictation(hooks = {}) {
  const events = { status: [], subtitle: [], inserted: [], errors: [] };
  const d = createDictation({
    onStatus: (s) => events.status.push(s),
    onSubtitle: (t) => events.subtitle.push(t),
    onInserted: (t) => events.inserted.push(t),
    onError: (m) => events.errors.push(m),
    ...hooks,
  });
  return { d, events };
}

// 1. install registers the priority:-1 activity slot and captures actions on render.
{
  const slots = makeSlots();
  const ctx = { slots };
  const { d, events } = makeDictation();

  assert.equal(d.ready, false);
  assert.equal(d.install(ctx, fakeRequire), true);
  assert.equal(slots.registrations.length, 1);
  assert.equal(slots.registrations[0].options.name, 'conversation.input.activity');
  assert.equal(slots.registrations[0].options.priority, -1);
  assert.equal(d.ready, false, 'ready waits for the first render');

  const { actions } = makeActions();
  assert.equal(slots.registrations[0].Component({ inputActions: actions }), null);
  assert.equal(d.ready, true);

  // Unlike the real React path, the harness never flushes effects; if one was
  // queued it must be safe to run later and idempotent.
  for (const fn of FakeReact.effects.splice(0)) fn();
  assert.equal(d.ready, true);
  assert.equal(events.errors.length, 0);
}

// 2. insert success: polished text reaches insertText and onInserted.
{
  const slots = makeSlots();
  const { d, events } = makeDictation();
  d.install({ slots }, fakeRequire);
  const { actions, calls } = makeActions();
  slots.registrations[0].Component({ actions }); // `props.actions` also works

  assert.equal(d.insert('我们我们明天开会'), true);
  assert.deepEqual(calls.insertText[0], ['我们明天开会。', 'insertion-token']);
  assert.equal(calls.captureInsertion, 1);
  assert.deepEqual(events.inserted, ['我们明天开会。']);
  assert.equal(d.pending, '');
  assert.equal(events.errors.length, 0);
}

// 3. insert failure: text stays in pending, onError explains, nothing inserted.
{
  const slots = makeSlots();
  const { d, events } = makeDictation();
  d.install({ slots }, fakeRequire);
  const { actions } = makeActions({ insertText: () => false });
  slots.registrations[0].Component({ inputActions: actions });

  assert.equal(d.insert('我们明天开会。'), false);
  assert.equal(d.pending, '我们明天开会。');
  assert.deepEqual(events.errors, ['输入框不可用，文字已保留']);
  assert.equal(d.insert('   '), false);
  assert.equal(d.pending, '我们明天开会。', 'empty input does not clear the backlog');

  d.reset();
  assert.equal(d.pending, '');
}

// 4. no actions at all: pending path, no throw.
{
  const { d, events } = makeDictation();
  assert.equal(d.insert('没有输入框的一段话'), false);
  assert.equal(d.pending, '没有输入框的一段话。');
  assert.deepEqual(events.errors, ['输入框不可用，文字已保留']);
  assert.equal(d.insert('第二段'), false);
  assert.equal(d.pending, '第二段。', 'latest dictation replaces the stale pending');
}

// 5. require('react') failing: ready=false, onError, never throws.
{
  const slots = makeSlots();
  const { d, events } = makeDictation();
  const brokenRequire = () => { throw new Error('react unavailable'); };
  assert.equal(d.install({ slots }, brokenRequire), false);
  assert.equal(d.ready, false);
  assert.deepEqual(events.errors, ['输入框不可用']);
  assert.equal(slots.registrations.length, 0);
  assert.equal(d.insert('还是可以留在 pending'), false);
  assert.equal(d.pending, '还是可以留在 pending。');
}

// 6. activity slot rejected → fallback to conversation.input.right.
{
  const slots = makeSlots({ failActivity: true });
  const { d, events } = makeDictation();
  assert.equal(d.install({ slots }, fakeRequire), true);
  assert.equal(slots.registrations.length, 2);
  assert.equal(slots.registrations[1].options.name, 'conversation.input.right');
  slots.registrations[1].Component({ inputActions: makeActions().actions });
  assert.equal(d.ready, true);
  assert.equal(events.errors.length, 0);
}

// 7. dispose releases the slot once and blocks later inserts.
{
  let released = 0;
  const slots = {
    register() { return { dispose() { released += 1; } }; },
  };
  const { d } = makeDictation();
  d.install({ slots }, fakeRequire);
  slots.Component = null;
  assert.equal(d.dispose(), true);
  assert.equal(d.dispose(), false);
  assert.equal(released, 1);
  assert.equal(d.ready, false);
  assert.equal(d.insert('释放之后不再插入'), false);
  assert.equal(d.pending, '');
}

console.log('dictation-harness: all assertions passed');
