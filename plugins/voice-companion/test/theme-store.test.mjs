// Theme library behaviour, exercised against a fake localStorage.
//
// The module only ever reads `window.localStorage`, so every test installs a
// throwaway `globalThis.window` and the module needs no bundler or DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_THEME, TOKEN_SCHEMA } from '../src/client/theme.js';
import {
  THEME_LIBRARY_KEY,
  THEME_SNAPSHOT_KEY,
  __storeTest as __test,
  deleteTheme,
  exportTheme,
  getActiveId,
  importTheme,
  listThemes,
  renameTheme,
  resolveTheme,
  saveTheme,
  setActiveId,
} from '../src/client/theme-store.js';

const TOKEN_KEYS = Object.keys(TOKEN_SCHEMA);

function makeStorage(options = {}) {
  const data = new Map(Object.entries(options.seed || {}));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (options.full) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}

/** Install a fresh window + storage and return the raw storage handle. */
function useStorage(seed = {}, options = {}) {
  const store = makeStorage({ seed, ...options });
  globalThis.window = { localStorage: store };
  return store;
}

function useNoStorage() {
  globalThis.window = {};
}

function useNoWindow() {
  delete globalThis.window;
}

function readJson(store, key) {
  const text = store.getItem(key);
  return text ? JSON.parse(text) : null;
}

test.afterEach(() => {
  delete globalThis.window;
});

test('empty storage falls back to the builtin default', () => {
  useStorage();
  assert.deepEqual(listThemes(), [{ id: 'default', name: DEFAULT_THEME.name, builtin: true }]);
  assert.equal(getActiveId(), 'default');
  const theme = resolveTheme();
  assert.equal(theme.name, DEFAULT_THEME.name);
  assert.deepEqual(theme.css, {});
  assert.equal(Object.keys(theme.tokens).length, TOKEN_KEYS.length);
  for (const key of TOKEN_KEYS) assert.equal(theme.tokens[key], DEFAULT_THEME.tokens[key]);
});

test('corrupt JSON is quarantined instead of throwing', () => {
  const store = useStorage({ [THEME_LIBRARY_KEY]: '{ this is not json' });
  assert.deepEqual(listThemes(), [{ id: 'default', name: DEFAULT_THEME.name, builtin: true }]);
  assert.equal(getActiveId(), 'default');
  assert.equal(store.getItem(__test.corruptKey), '{ this is not json');
  assert.equal(store.getItem(THEME_LIBRARY_KEY), null);

  const wrong = useStorage({ [THEME_LIBRARY_KEY]: JSON.stringify({ v: 1, active: 'x', items: 'nope' }) });
  assert.equal(listThemes().length, 1);
  assert.equal(wrong.getItem(THEME_LIBRARY_KEY), null);
});

test('saveTheme appends, activates and resolves a complete theme', () => {
  const store = useStorage();
  const saved = saveTheme({ name: '红黑', tokens: { 'accent.base': '#ff2244' }, css: { panel: 'background:#100010' } });
  assert.equal(saved.ok, true);
  assert.match(saved.id, /^t_[a-z0-9]+$/);
  assert.equal(saved.name, '红黑');

  assert.deepEqual(listThemes().map((theme) => theme.name), [DEFAULT_THEME.name, '红黑']);
  assert.equal(getActiveId(), saved.id);

  const resolved = resolveTheme(saved.id);
  assert.equal(resolved.name, '红黑');
  assert.equal(resolved.tokens['accent.base'], '#ff2244');
  assert.equal(resolved.css.panel, 'background:#100010');
  assert.equal(Object.keys(resolved.tokens).length, TOKEN_KEYS.length);
  for (const key of TOKEN_KEYS) assert.ok(key in resolved.tokens, `missing token ${key}`);

  const library = readJson(store, THEME_LIBRARY_KEY);
  assert.equal(library.v, 1);
  assert.equal(library.active, saved.id);
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].name, '红黑');
});

test('setActiveId switches the pointer and refreshes the boot snapshot', () => {
  const store = useStorage();
  const first = saveTheme({ name: '红黑', tokens: { 'accent.base': '#ff2244' } });
  const second = saveTheme({ name: '霓虹', tokens: { 'accent.base': '#22ff88' } });
  assert.equal(getActiveId(), second.id);

  const theme = setActiveId(first.id);
  assert.equal(getActiveId(), first.id);
  assert.equal(theme.name, '红黑');
  assert.deepEqual(theme.tokens['accent.base'], '#ff2244');
  assert.equal(readJson(store, THEME_SNAPSHOT_KEY).name, '红黑');
  assert.equal(readJson(store, THEME_SNAPSHOT_KEY).v, 1);

  // Unknown ids fall back to the builtin default instead of corrupting the pointer.
  const fallback = setActiveId('t_missing');
  assert.equal(getActiveId(), 'default');
  assert.equal(fallback.name, DEFAULT_THEME.name);
  assert.equal(readJson(store, THEME_SNAPSHOT_KEY).name, DEFAULT_THEME.name);
});

test('deleting the active theme falls back to the builtin default', () => {
  const store = useStorage();
  const saved = saveTheme({ name: '红黑' });
  const result = deleteTheme(saved.id);
  assert.equal(result.ok, true);
  assert.equal(result.fellBack, true);
  assert.equal(result.active, 'default');
  assert.equal(result.theme.name, DEFAULT_THEME.name);
  assert.equal(getActiveId(), 'default');
  assert.deepEqual(listThemes().map((theme) => theme.id), ['default']);
  assert.equal(readJson(store, THEME_LIBRARY_KEY).items.length, 0);
});

test('deleting an inactive theme leaves the active one alone', () => {
  useStorage();
  const first = saveTheme({ name: '一' });
  const second = saveTheme({ name: '二' });
  const result = deleteTheme(first.id);
  assert.equal(result.ok, true);
  assert.equal(result.fellBack, false);
  assert.equal(result.active, second.id);
  assert.equal(getActiveId(), second.id);
});

test('the builtin default cannot be renamed or deleted', () => {
  const store = useStorage();
  const renamed = renameTheme('default', '别的名字');
  assert.equal(renamed.ok, false);
  assert.match(renamed.error, /内置/);
  const removed = deleteTheme('default');
  assert.equal(removed.ok, false);
  assert.match(removed.error, /内置/);
  assert.equal(store.getItem(THEME_LIBRARY_KEY), null);
});

test('renameTheme renames in place, rejects blanks and dedupes', () => {
  useStorage();
  const saved = saveTheme({ name: '红黑' });
  const renamed = renameTheme(saved.id, '赛博');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.name, '赛博');
  assert.deepEqual(listThemes().map((theme) => theme.name), [DEFAULT_THEME.name, '赛博']);

  const blank = renameTheme(saved.id, '   ');
  assert.equal(blank.ok, false);
  assert.match(blank.error, /名字/);

  const other = saveTheme({ name: '赛博' });
  assert.equal(other.name, '赛博 (2)');
  const renamedDefault = renameTheme(other.id, '赛博');
  assert.equal(renamedDefault.name, '赛博 (2)');
});

test('importTheme accepts an export and assigns a fresh id', () => {
  useStorage();
  const saved = saveTheme({ name: '红黑', tokens: { 'accent.base': '#ff2244' }, css: { panel: 'background:#100010' } });
  const text = exportTheme(saved.id);
  assert.equal(typeof text, 'string');
  assert.equal(JSON.parse(text).name, '红黑');
  assert.equal(JSON.parse(text).tokens['accent.base'], '#ff2244');

  const imported = importTheme(text);
  assert.equal(imported.ok, true);
  assert.notEqual(imported.id, saved.id);
  assert.equal(imported.name, '红黑 (2)');
  assert.equal(resolveTheme(imported.id).tokens['accent.base'], '#ff2244');
  assert.equal(getActiveId(), imported.id);
});

test('importTheme rejects garbage without touching the library', () => {
  useStorage();
  const saved = saveTheme({ name: '红黑' });
  const before = listThemes().length;

  for (const [payload, pattern] of [
    ['', /空的/],
    ['{ not json', /不是有效/],
    [JSON.stringify({ v: 2, name: 'x', tokens: {} }), /版本/],
    [JSON.stringify({ v: 1 }), /不是有效/],
    ['x'.repeat(9 * 1024), /太大/],
  ]) {
    const result = importTheme(payload);
    assert.equal(result.ok, false, `expected rejection for ${payload.slice(0, 24)}`);
    assert.match(result.error, pattern);
  }
  assert.equal(listThemes().length, before);
  assert.equal(getActiveId(), saved.id);
});

test('the library refuses the 51st theme', () => {
  useStorage();
  for (let i = 0; i < __test.limit; i += 1) {
    const result = saveTheme({ name: `主题${i}` });
    assert.equal(result.ok, true, `save ${i} failed: ${result.error}`);
  }
  assert.equal(listThemes().length, __test.limit + 1);
  const overflow = saveTheme({ name: '多余' });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error, '主题太多了');
  assert.equal(listThemes().length, __test.limit + 1);
});

test('corrupt items are dropped but their neighbours survive', () => {
  useStorage({
    [THEME_LIBRARY_KEY]: JSON.stringify({
      v: 1,
      active: 't_keep',
      items: [
        { id: 'not-a-theme-id', name: '坏的', tokens: {} },
        { id: 't_keep', name: '好', tokens: { 'accent.base': '#22ff88' }, css: {}, createdAt: 7 },
        { id: 't_keep', name: '重复', tokens: {} },
        null,
      ],
    }),
  });
  assert.deepEqual(listThemes().map((theme) => theme.id), ['default', 't_keep']);
  assert.equal(listThemes()[1].name, '好');
  assert.equal(getActiveId(), 't_keep');
  assert.equal(resolveTheme('t_keep').tokens['accent.base'], '#22ff88');
});

test('an active pointer at a missing theme resolves to the default', () => {
  useStorage({ [THEME_LIBRARY_KEY]: JSON.stringify({ v: 1, active: 't_gone', items: [] }) });
  assert.equal(getActiveId(), 'default');
  assert.equal(resolveTheme().name, DEFAULT_THEME.name);
  assert.equal(resolveTheme('t_gone').name, DEFAULT_THEME.name);
});

test('storage failures never escape as exceptions', () => {
  useStorage({}, { full: true });
  const saved = saveTheme({ name: '红黑' });
  assert.equal(saved.ok, false);
  assert.equal(typeof saved.error, 'string');
  assert.equal(getActiveId(), 'default');
  assert.equal(listThemes().length, 1);

  useNoStorage();
  const noStore = saveTheme({ name: '红黑' });
  assert.equal(noStore.ok, false);
  assert.match(noStore.error, /不能保存/);
  assert.equal(getActiveId(), 'default');

  useNoWindow();
  assert.equal(getActiveId(), 'default');
  assert.equal(resolveTheme().name, DEFAULT_THEME.name);
  // Without any storage the builtin default is still exportable as a template.
  assert.equal(JSON.parse(exportTheme()).name, DEFAULT_THEME.name);
});

test('exportTheme rejects unknown ids', () => {
  useStorage();
  assert.equal(exportTheme('t_missing'), '');
  const text = exportTheme();
  assert.equal(JSON.parse(text).name, DEFAULT_THEME.name);
});
