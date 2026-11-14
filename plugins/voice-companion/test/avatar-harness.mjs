// Offline harness for the avatar component: no browser, no network, no clock.
//
//   node test/avatar-harness.mjs
//
// The fake document is intentionally tiny: createElement/createElementNS,
// attributes, a child list, textContent and click listeners. That is the whole
// surface avatar.js is allowed to touch.

import assert from 'node:assert/strict';
import { CUSTOM_CHARACTER_ID, renderCharacter, resolveCharacter } from '../src/client/characters.js';

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

check('custom character art is an img without a mouth; builtins keep theirs', () => {
  const custom = renderCharacter(doc, CUSTOM_CHARACTER_ID, { name: '阿猫', src: 'data:image/png;base64,AA' });
  // The fake DOM keeps the tag as written; a browser reports HTML elements in caps.
  assert.equal(String(custom.svg.tagName).toUpperCase(), 'IMG');
  assert.equal(custom.svg.getAttribute('class'), 'vc-fish-img');
  assert.equal(custom.mouth, null);
  assert.equal(custom.mouthPath, null);
  assert.equal(custom.name, '阿猫');
  assert.equal(custom.labels.idle, '待命中');

  const rejected = renderCharacter(doc, CUSTOM_CHARACTER_ID, { name: 'x', src: 'javascript:alert(1)' });
  assert.equal(rejected.id, 'whale', 'a non-data URL must fall back to the builtin');

  const whale = renderCharacter(doc, 'whale');
  assert.equal(String(whale.svg.tagName).toUpperCase(), 'SVG');
  assert.ok(whale.mouth, 'the builtin whale must keep its mouth');
  assert.equal(typeof whale.mouthPath, 'function');
});

check('a persisted custom face mounts, animates and switches back', () => {
  doc.defaultView.localStorage.setItem('dsh.voice-companion.face', JSON.stringify({ name: '阿猫', src: 'data:image/png;base64,AA' }));
  doc.defaultView.localStorage.setItem('dsh.voice-companion.character', 'custom');
  const mount3 = doc.createElement('div');
  doc.body.appendChild(mount3);
  const seen = [];
  const third = createAvatar({ mount: mount3, character: 'custom', onAction: (name, value) => seen.push([name, value]) });
  const root3 = third.root;

  assert.equal(root3.getAttribute('data-character'), 'custom');
  assert.equal(third.getCharacter(), 'custom');
  assert.equal(third.character, 'custom');
  const img = findByClass(root3, 'vc-fish-img');
  assert.ok(img, 'custom face must render an img');
  assert.equal(img.getAttribute('src'), 'data:image/png;base64,AA');

  const chips = [];
  walk(root3, (node) => {
    if (node.getAttribute && node.getAttribute('data-character')) chips.push(node);
  });
  assert.ok(chips.some((chip) => chip.getAttribute('data-character') === 'custom'), 'custom chip missing');
  assert.ok(findByClass(root3, 'vc-add'), 'add chip missing');

  // No mouth to drive, but every state and level must still be a safe no-op.
  for (const state of ['listening', 'thinking', 'speaking', 'error', 'idle']) third.setState(state);
  third.setLevel(0.9);
  assert.equal(root3.getAttribute('data-state'), 'idle');

  third.setCharacter('whale');
  assert.equal(root3.getAttribute('data-character'), 'whale');
  assert.equal(findByClass(root3, 'vc-fish-img'), null, 'builtin art must replace the img');
  assert.ok(findById(root3, 'mouth'), 'builtin mouth must come back');

  // A non-image is rejected before FileReader is touched.
  const input = findByClass(root3, 'vc-file');
  assert.ok(input, 'hidden file input missing');
  input.files = [{ type: 'application/pdf', name: 'x.pdf' }];
  input.listeners.get('change').forEach((fn) => fn({ type: 'change', target: input }));
  assert.equal(findByClass(root3, 'vc-bubble').textContent, '请选择图片文件');
  assert.ok(seen.some(([name, value]) => name === 'face' && value.action === 'error'));

  // No FileReader (privacy mode / stub): a friendly message, never a throw.
  const savedReader = globalThis.FileReader;
  globalThis.FileReader = undefined;
  try {
    input.files = [{ type: 'image/png', name: 'x.png' }];
    input.listeners.get('change').forEach((fn) => fn({ type: 'change', target: input }));
  } finally {
    globalThis.FileReader = savedReader;
  }
  assert.equal(findByClass(root3, 'vc-bubble').textContent, '当前环境不支持读取图片');
  assert.equal(root3.getAttribute('data-character'), 'whale', 'a failed upload must not swap the stage');

  third.dispose();
  assert.equal(findByClass(root3, 'vc-file'), null, 'dispose must drop the file input');
  assert.equal(mount3.children.length, 0);
});

check('an upload is shrunk to 512px, encoded as webp and persisted', () => {
  doc.defaultView.localStorage.removeItem('dsh.voice-companion.face');
  const mount4 = doc.createElement('div');
  doc.body.appendChild(mount4);
  const seen = [];
  const fourth = createAvatar({ mount: mount4, onAction: (name, value) => seen.push([name, value]) });
  const input = findByClass(fourth.root, 'vc-file');
  assert.ok(input, 'hidden file input missing');

  let drawn = null;
  const createElement = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = createElement(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      el.getContext = () => ({ drawImage: (_img, _x, _y, w, h) => { drawn = { w, h }; } });
      el.toDataURL = (type) => 'data:' + type + ';base64,SCALED';
    }
    return el;
  };
  doc.defaultView.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,ORIGINAL'; this.onload(); }
  };
  doc.defaultView.Image = class {
    set src(value) { this._src = value; this.naturalWidth = 1000; this.naturalHeight = 600; this.onload(); }
    get src() { return this._src; }
  };
  try {
    input.files = [{ type: 'image/png', name: 'me.png' }];
    input.listeners.get('change').forEach((fn) => fn({ type: 'change', target: input }));
  } finally {
    doc.createElement = createElement;
    delete doc.defaultView.FileReader;
    delete doc.defaultView.Image;
  }

  assert.deepEqual(drawn, { w: 512, h: 307 }, 'the longest edge must shrink to 512');
  const stored = JSON.parse(doc.defaultView.localStorage.getItem('dsh.voice-companion.face'));
  assert.equal(stored.src, 'data:image/webp;base64,SCALED');
  assert.equal(stored.name, '我的形象');
  assert.equal(fourth.getCharacter(), 'custom');
  assert.equal(findByClass(fourth.root, 'vc-fish-img').getAttribute('src'), 'data:image/webp;base64,SCALED');
  assert.ok(seen.some(([name, value]) => name === 'face' && value.action === 'select'));
  fourth.dispose();
  assert.equal(mount4.children.length, 0);
});

function collectByClass(root, className) {
  const found = [];
  walk(root, (node) => {
    const value = node.getAttribute ? node.getAttribute('class') : null;
    if (value && value.split(/\s+/).includes(className)) found.push(node);
  });
  return found;
}

function fire(node, type, event) {
  const set = node && node.listeners ? node.listeners.get(type) : null;
  if (!set) return 0;
  const payload = Object.assign({ type, target: node }, event || {});
  for (const handler of Array.from(set)) handler(payload);
  return set.size;
}

function sheetOf(node) {
  return findByClass(node, 'vc-sheet');
}

function slotsOf(node) {
  const selects = {};
  for (const select of collectByClass(node, 'vc-slot')) {
    selects[select.getAttribute('data-slot')] = select;
  }
  return selects;
}

check('the settings drawer starts closed and opens from the gear', () => {
  doc.defaultView.localStorage.removeItem('dsh.voice-companion.voice');
  const mount5 = doc.createElement('div');
  doc.body.appendChild(mount5);
  const fifth = createAvatar({ mount: mount5, onAction: () => {} });
  const box = sheetOf(fifth.root);
  assert.ok(box, 'settings sheet missing');
  assert.equal(box.getAttribute('role'), 'dialog');
  assert.equal(box.getAttribute('data-open'), '0');
  assert.equal(box.getAttribute('aria-hidden'), 'true');
  const gear = findByClass(fifth.root, 'vc-gear');
  assert.ok(gear, 'gear button missing');
  assert.equal(gear.getAttribute('aria-expanded'), 'false');

  const selects = slotsOf(fifth.root);
  assert.deepEqual(Object.keys(selects), ['base', 'bright', 'soft']);
  for (const slot of Object.keys(selects)) {
    const options = selects[slot].children.map((option) => option.getAttribute('value'));
    assert.deepEqual(options, ['stella', 'tide'], slot + ' must offer both voices');
  }

  assert.equal(fifth.root.getAttribute('data-state'), 'idle');
  assert.equal(findByClass(fifth.root, 'vc-remove-face').hasAttribute('hidden'), true,
    'no custom face means no remove button');
  gear.click();
  assert.equal(fifth.root.getAttribute('data-state'), 'idle', 'opening the drawer must not touch the call state');
  assert.equal(box.getAttribute('data-open'), '1');
  assert.equal(box.getAttribute('aria-hidden'), 'false');
  assert.equal(gear.getAttribute('aria-expanded'), 'true');

  const speed = findByClass(fifth.root, 'vc-speed');
  assert.equal(speed.getAttribute('min'), '0.75');
  assert.equal(speed.getAttribute('max'), '1.35');
  assert.equal(findByClass(fifth.root, 'vc-speed-value').textContent, '×1.00');

  fifth.dispose();
  assert.equal(mount5.children.length, 0);
});

check('slots default to the character voice and save reports a normalized profile', () => {
  const store = doc.defaultView.localStorage;
  store.removeItem('dsh.voice-companion.voice');
  globalThis.window = doc.defaultView;
  const mount6 = doc.createElement('div');
  doc.body.appendChild(mount6);
  const calls = [];
  const sixth = createAvatar({ mount: mount6, onAction: (name, value) => calls.push([name, value]) });
  findByClass(sixth.root, 'vc-gear').click();

  const selects = slotsOf(sixth.root);
  assert.equal(selects.base.value, 'tide', 'whale speaks softly by default');
  assert.equal(selects.bright.value, 'stella');
  assert.equal(selects.soft.value, 'tide');

  selects.base.value = 'stella';
  const speed = findByClass(sixth.root, 'vc-speed');
  speed.value = '1.2';
  fire(speed, 'input');
  assert.equal(findByClass(sixth.root, 'vc-speed-value').textContent, '×1.20');

  findByClass(sixth.root, 'vc-save').click();
  const saved = calls.filter(([name]) => name === 'voice').pop();
  assert.ok(saved, 'save must emit a voice action');
  assert.equal(saved[1].profile.map.base, 'stella');
  assert.equal(saved[1].profile.map.bright, 'stella');
  assert.equal(saved[1].profile.map.soft, 'tide');
  assert.equal(saved[1].profile.speed, 1.2);
  const stored = JSON.parse(store.getItem('dsh.voice-companion.voice'));
  assert.equal(stored.map.base, 'stella');
  assert.equal(stored.speed, 1.2);
  assert.equal(findByClass(sixth.root, 'vc-save').textContent, '已保存');

  sixth.dispose();
  assert.equal(mount6.children.length, 0);
});

check('reopening the drawer restores the stored slots and speed', () => {
  globalThis.window = doc.defaultView;
  const mount7 = doc.createElement('div');
  doc.body.appendChild(mount7);
  const seventh = createAvatar({ mount: mount7, onAction: () => {} });
  const gear = findByClass(seventh.root, 'vc-gear');
  gear.click();

  const selects = slotsOf(seventh.root);
  assert.equal(selects.base.value, 'stella');
  assert.equal(selects.soft.value, 'tide');
  const speed = findByClass(seventh.root, 'vc-speed');
  assert.equal(speed.value, '1.2');
  assert.equal(findByClass(seventh.root, 'vc-speed-value').textContent, '×1.20');

  // A builtin character cannot be renamed: the field stays read-only.
  const name = findByClass(seventh.root, 'vc-name');
  assert.equal(name.hasAttribute('readonly'), true);
  assert.equal(name.value, resolveCharacter('whale').name);

  findByClass(seventh.root, 'vc-sheet-close').click();
  assert.equal(sheetOf(seventh.root).getAttribute('data-open'), '0');
  assert.equal(gear.getAttribute('aria-expanded'), 'false');

  gear.click();
  assert.equal(slotsOf(seventh.root).base.value, 'stella');
  assert.equal(findByClass(seventh.root, 'vc-speed').value, '1.2');

  seventh.dispose();
  assert.equal(mount7.children.length, 0);
});

check('preview and reset emit the expected voice payloads', () => {
  globalThis.window = doc.defaultView;
  const store = doc.defaultView.localStorage;
  const mount8 = doc.createElement('div');
  doc.body.appendChild(mount8);
  const calls = [];
  const eighth = createAvatar({ mount: mount8, onAction: (name, value) => calls.push([name, value]) });
  findByClass(eighth.root, 'vc-gear').click();

  const selects = slotsOf(eighth.root);
  selects.base.value = 'tide';
  findByClass(eighth.root, 'vc-preview').click();
  const preview = calls.filter(([name]) => name === 'preview').pop();
  assert.ok(preview, 'preview must emit an action');
  assert.equal(preview[1].voiceId, 'tide', 'preview must read the current slot');

  // Save something non-default first so reset has work to do.
  selects.base.value = 'stella';
  findByClass(eighth.root, 'vc-save').click();
  findByClass(eighth.root, 'vc-reset').click();
  const reset = calls.filter(([name]) => name === 'voice').pop();
  assert.deepEqual(reset[1].profile, { map: {}, speed: 1 });
  assert.deepEqual(JSON.parse(store.getItem('dsh.voice-companion.voice')), { map: {}, speed: 1 });
  assert.equal(slotsOf(eighth.root).base.value, 'tide', 'reset must fall back to the character default');
  assert.equal(findByClass(eighth.root, 'vc-speed').value, '1');
  assert.equal(findByClass(eighth.root, 'vc-speed-value').textContent, '×1.00');

  eighth.dispose();
  assert.equal(mount8.children.length, 0);
});

check('Escape closes the drawer', () => {
  const mount9 = doc.createElement('div');
  doc.body.appendChild(mount9);
  const ninth = createAvatar({ mount: mount9, onAction: () => {} });
  findByClass(ninth.root, 'vc-gear').click();
  assert.equal(sheetOf(ninth.root).getAttribute('data-open'), '1');

  doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(sheetOf(ninth.root).getAttribute('data-open'), '0');
  assert.equal(findByClass(ninth.root, 'vc-gear').getAttribute('aria-expanded'), 'false');

  // Closed drawers ignore further Escape presses without throwing.
  doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(sheetOf(ninth.root).getAttribute('aria-hidden'), 'true');

  // The backdrop is the mouse path out of the drawer.
  findByClass(ninth.root, 'vc-gear').click();
  assert.equal(sheetOf(ninth.root).getAttribute('data-open'), '1');
  fire(findByClass(ninth.root, 'vc-sheet-backdrop'), 'click', { type: 'click' });
  assert.equal(sheetOf(ninth.root).getAttribute('data-open'), '0');
  assert.equal(findByClass(ninth.root, 'vc-gear').getAttribute('aria-expanded'), 'false');

  ninth.dispose();
  assert.equal(mount9.children.length, 0);
});

check('a custom face can be renamed and removed from the drawer', () => {
  const store = doc.defaultView.localStorage;
  store.setItem('dsh.voice-companion.character', CUSTOM_CHARACTER_ID);
  store.setItem('dsh.voice-companion.face', JSON.stringify({
    name: '我的形象',
    src: 'data:image/webp;base64,FACE',
  }));
  globalThis.window = doc.defaultView;
  const mount10 = doc.createElement('div');
  doc.body.appendChild(mount10);
  const calls = [];
  const tenth = createAvatar({ mount: mount10, character: CUSTOM_CHARACTER_ID, onAction: (name, value) => calls.push([name, value]) });
  assert.equal(tenth.getCharacter(), CUSTOM_CHARACTER_ID, 'the persisted face must mount');

  findByClass(tenth.root, 'vc-gear').click();
  const name = findByClass(tenth.root, 'vc-name');
  assert.equal(name.value, '我的形象');
  assert.equal(name.hasAttribute('readonly'), false, 'a custom face name is editable');

  name.value = '小鲸';
  fire(name, 'keydown', { key: 'Enter' });
  const renamed = JSON.parse(store.getItem('dsh.voice-companion.face'));
  assert.equal(renamed.name, '小鲸');
  assert.equal(renamed.src, 'data:image/webp;base64,FACE');
  const chip = collectByClass(tenth.root, 'vc-chip').find((node) => node.getAttribute('aria-label') === '小鲸');
  assert.ok(chip, 'the face chip must follow the new name');
  assert.equal(chip.textContent, '小', 'the chip keeps a one-character monogram');
  assert.equal(tenth.root.getAttribute('aria-label'), '小鲸语音管家');

  // Saving voices must never touch the custom face record.
  findByClass(tenth.root, 'vc-save').click();
  assert.equal(JSON.parse(store.getItem('dsh.voice-companion.face')).name, '小鲸');
  assert.equal(JSON.parse(store.getItem('dsh.voice-companion.face')).src, 'data:image/webp;base64,FACE');
  assert.equal(tenth.getCharacter(), CUSTOM_CHARACTER_ID);

  findByClass(tenth.root, 'vc-remove-face').click();
  assert.equal(tenth.getCharacter(), 'whale', 'removing the face falls back to the first character');
  assert.equal(store.getItem('dsh.voice-companion.face'), null);
  assert.ok(calls.some(([action, value]) => action === 'character' && value === 'whale'));
  assert.equal(findByClass(tenth.root, 'vc-name').hasAttribute('readonly'), true);

  tenth.dispose();
  assert.equal(mount10.children.length, 0);
  assert.equal(__test.pendingTimers(), 0, 'dispose must drain the drawer timers too');
  delete globalThis.window;
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
