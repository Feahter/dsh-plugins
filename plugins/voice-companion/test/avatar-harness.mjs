// Offline harness for the avatar component: no browser, no network, no clock.
//
//   node test/avatar-harness.mjs
//
// The fake document is intentionally tiny: createElement/createElementNS,
// attributes, a child list, textContent and click listeners. That is the whole
// surface avatar.js is allowed to touch.

import assert from 'node:assert/strict';

// ------------------------------------------------------------------ DOM fakes

class FakeElement {
  constructor(doc, tagName, namespaceURI) {
    this.ownerDocument = doc;
    this.tagName = String(tagName);
    this.namespaceURI = namespaceURI || null;
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = Object.create(null);
    this.textContent = '';
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    const set = this.listeners.get(type);
    if (set) set.delete(handler);
  }

  click() {
    const set = this.listeners.get('click');
    if (!set) return;
    for (const handler of Array.from(set)) handler({ type: 'click', target: this });
  }

  // Placement maths only needs a box; derive it from the inline style the panel
  // sets while dragging, and report 0x0 before anything has been placed.
  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left);
    const top = Number.parseFloat(this.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      return { left, top, width: 320, height: 260, right: left + 320, bottom: top + 260 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get size() { return map.size; },
  };
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.listeners = new Map();
    this.defaultView = { innerWidth: 1280, innerHeight: 800, localStorage: makeStorage(), listeners: new Map() };
    this.defaultView.addEventListener = function (type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    };
    this.defaultView.removeEventListener = function (type, handler) {
      const set = this.listeners.get(type);
      if (set) set.delete(handler);
    };
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    const set = this.listeners.get(type);
    if (set) set.delete(handler);
  }

  // Doc-level pointer traffic, the way the panel subscribes while dragging.
  dispatch(type, event) {
    const set = this.listeners.get(type);
    if (!set) return 0;
    const payload = Object.assign({ type, target: null }, event || {});
    for (const handler of Array.from(set)) handler(payload);
    return set.size;
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createElementNS(namespaceURI, tagName) {
    return new FakeElement(this, tagName, namespaceURI);
  }
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function findByClass(root, className) {
  let found = null;
  walk(root, (node) => {
    if (found) return;
    const value = node.getAttribute ? node.getAttribute('class') : null;
    if (value && value.split(/\s+/).includes(className)) found = node;
  });
  return found;
}

function findById(root, id) {
  let found = null;
  walk(root, (node) => {
    if (found) return;
    const value = node.getAttribute ? node.getAttribute('id') : null;
    if (value === id) found = node;
  });
  return found;
}

function countNodes(node) {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}

// ---------------------------------------------------------------------- test

const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('ok   ' + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log('FAIL ' + name);
    console.log('     ' + (error && error.message ? error.message : String(error)));
  }
}

const doc = new FakeDocument();
globalThis.document = doc;

const { createAvatar, __test } = await import('../src/client/avatar.js');

assert.equal(typeof createAvatar, 'function', 'createAvatar must be exported');

const actions = [];
const mount = doc.createElement('div');
doc.body.appendChild(mount);
const avatar = createAvatar({ mount, onAction: (name) => actions.push(name) });
const root = avatar.root;

check('createAvatar mounts one root panel under mount', () => {
  assert.equal(mount.children.length, 1);
  assert.equal(root.getAttribute('data-state'), 'idle');
  assert.equal(root.getAttribute('data-vc-avatar'), '');
  assert.ok(findByClass(root, 'vc-panel'), 'panel missing');
  assert.ok(findByClass(root, 'vc-bubble'), 'bubble missing');
  assert.ok(findByClass(root, 'vc-partial'), 'partial line missing');
  assert.ok(findById(root, 'mouth'), 'mouth path missing');
});

check('setState writes data-state for all five states', () => {
  for (const state of ['listening', 'thinking', 'speaking', 'error', 'idle']) {
    avatar.setState(state);
    assert.equal(root.getAttribute('data-state'), state);
  }
});

check('setSubtitle writes text with the assistant role by default', () => {
  avatar.setSubtitle('你好呀，我是大肥鱼。');
  const bubble = findByClass(root, 'vc-bubble');
  assert.equal(bubble.textContent, '你好呀，我是大肥鱼。');
  assert.equal(bubble.getAttribute('data-role'), 'assistant');
});

check('setSubtitle marks user role and keeps exactly-60 chars intact', () => {
  const bubble = findByClass(root, 'vc-bubble');
  const sixty = '字'.repeat(60);
  avatar.setSubtitle(sixty, { role: 'user' });
  assert.equal(bubble.getAttribute('data-role'), 'user');
  assert.equal(bubble.textContent, sixty);
  assert.equal(bubble.textContent.length, 60);
});

check('setSubtitle truncates >60 chars and appends an ellipsis', () => {
  const bubble = findByClass(root, 'vc-bubble');
  const long = '一'.repeat(70);
  avatar.setSubtitle(long, { role: 'user' });
  assert.equal(bubble.textContent.length, 61);
  assert.ok(bubble.textContent.endsWith('…'));
  assert.equal(bubble.textContent, long.slice(0, 60) + '…');
});

check('setPartial writes the live transcription line and toggles visibility', () => {
  const partial = findByClass(root, 'vc-partial');
  avatar.setPartial('嗯…我在听你说');
  assert.equal(partial.textContent, '嗯…我在听你说');
  assert.equal(partial.getAttribute('data-visible'), '1');
  avatar.setPartial('');
  assert.equal(partial.getAttribute('data-visible'), null);
});

check('setLevel rewrites the mouth path only while speaking', () => {
  const mouth = findById(root, 'mouth');
  avatar.setState('idle');
  const idlePath = mouth.getAttribute('d');
  avatar.setLevel(1);
  assert.equal(mouth.getAttribute('d'), idlePath, 'idle must ignore setLevel');

  avatar.setState('speaking');
  const closed = mouth.getAttribute('d');
  avatar.setLevel(0.9);
  const open = mouth.getAttribute('d');
  assert.notEqual(open, closed, 'speaking must open the mouth');
  assert.equal(open, __test.mouthPathFor(0.9), 'level 0.9 must use the interpolated mouth path');

  avatar.setLevel(0.15);
  assert.notEqual(mouth.getAttribute('d'), open, 'level must change the mouth shape');

  avatar.setLevel(Number.NaN);
  assert.equal(mouth.getAttribute('d'), closed, 'invalid level collapses the mouth');

  avatar.setState('idle');
  assert.equal(mouth.getAttribute('d'), closed, 'leaving speaking closes the mouth');
});

check('buttons call onAction with start / end', () => {
  findByClass(root, 'vc-start').click();
  findByClass(root, 'vc-end').click();
  assert.deepEqual(actions, ['start', 'end']);
});

check('dragging the head moves the panel and remembers the spot', () => {
  const head = findByClass(root, 'vc-head');
  const before = root.style.left;
  head.listeners.get('pointerdown').forEach((fn) => fn({ type: 'pointerdown', target: head, clientX: 100, clientY: 100, preventDefault() {} }));
  doc.dispatch('pointermove', { clientX: 160, clientY: 140 });
  doc.dispatch('pointerup', {});

  // Default corner is 1280-18-320 = 942, 800-18-260 = 522; +60/+40 from the drag.
  assert.equal(root.style.left, '1002px', 'left after drag, was ' + before);
  assert.equal(root.style.top, '562px', 'top after drag');
  assert.equal(root.style.right, 'auto', 'right must be released once absolute');
  assert.equal(root.getAttribute('data-dragging'), null, 'dragging flag must clear');
  const saved = JSON.parse(doc.defaultView.localStorage.getItem('dsh.voice-companion.pos'));
  assert.deepEqual(saved, { left: 1002, top: 562 });
  assert.equal(doc.listeners.get('pointermove').size, 0, 'doc listeners must unbind on drop');
});

check('pressing a chip does not start a drag', () => {
  const left = root.style.left;
  const chip = findByClass(root, 'vc-chip');
  findByClass(root, 'vc-head').listeners.get('pointerdown').forEach((fn) => fn({ type: 'pointerdown', target: chip, clientX: 10, clientY: 10, preventDefault() {} }));
  doc.dispatch('pointermove', { clientX: 300, clientY: 300 });
  doc.dispatch('pointerup', {});
  assert.equal(root.style.left, left, 'chip press must not move the panel');
});

check('the fold button collapses to a pill and a tap opens it again', () => {
  const min = findByClass(root, 'vc-min');
  min.click();
  assert.equal(root.getAttribute('data-collapsed'), '1');
  assert.equal(min.textContent, '\uff0b');
  assert.equal(min.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.defaultView.localStorage.getItem('dsh.voice-companion.collapsed'), '1');

  const head = findByClass(root, 'vc-head');
  head.listeners.get('pointerdown').forEach((fn) => fn({ type: 'pointerdown', target: head, clientX: 40, clientY: 40, preventDefault() {} }));
  doc.dispatch('pointerup', {});
  assert.equal(root.getAttribute('data-collapsed'), null, 'a tap on the pill must expand');
  assert.equal(min.getAttribute('aria-expanded'), 'true');
});

check('a second panel restores the saved spot and the folded flag', () => {
  doc.defaultView.localStorage.setItem('dsh.voice-companion.pos', JSON.stringify({ left: 240, top: 180 }));
  doc.defaultView.localStorage.setItem('dsh.voice-companion.collapsed', '1');
  const mount2 = doc.createElement('div');
  doc.body.appendChild(mount2);
  const second = createAvatar({ mount: mount2 });
  assert.equal(second.root.style.left, '240px');
  assert.equal(second.root.style.top, '180px');
  assert.equal(second.collapsed, true);
  assert.equal(second.toggleCollapsed(), false, 'toggle must unfold');
  assert.deepEqual(second.position, { left: 240, top: 180 });
  second.dispose();
  assert.equal(mount2.children.length, 0);
});

check('idle schedules a blink timer and dispose drains every timer', () => {
  avatar.setState('idle');
  assert.ok(__test.pendingTimers() >= 1, 'idle must schedule the blink timer');
  assert.equal(countNodes(root) > 20, true, 'fish nodes must exist');

  avatar.dispose();
  assert.equal(__test.pendingTimers(), 0, 'dispose must clear timers');
  assert.equal(mount.children.length, 0, 'dispose must remove the root node');
  assert.equal(root.parentNode, null);
});

check('dispose is idempotent and later calls are no-ops', () => {
  avatar.dispose();
  avatar.setState('speaking');
  avatar.setLevel(1);
  avatar.setSubtitle('x');
  assert.equal(mount.children.length, 0);
  assert.equal(__test.pendingTimers(), 0);
});

const failed = results.filter((result) => !result.ok);
console.log('');
console.log(results.length - failed.length + '/' + results.length + ' checks passed');
if (failed.length > 0) {
  for (const result of failed) {
    console.error('\n' + result.name + ':\n' + (result.error && result.error.stack));
  }
  process.exitCode = 1;
}
