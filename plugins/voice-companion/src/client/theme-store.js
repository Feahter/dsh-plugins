import { DEFAULT_THEME, sanitizeTheme } from './theme.js';
// 主题库：库键是唯一真相，快照键只服务冷启动（0.3 起就是对象形状）。
// 所有读写都过 themeGuard()：localStorage 缺失 / JSON 坏 / 类型不对只回落默认，不抛。
const LIB = 'dsh.voice-companion.themes', SNAP = 'dsh.voice-companion.theme.active';
const CORRUPT = 'dsh.voice-companion.themes.corrupt', DEFAULT_ID = 'default';
const LIMIT = 50, NAME_MAX = 16, LIB_BYTES = 204800, IMPORT_BYTES = 8192;
const NEW_NAME = '自定义主题', ID_RE = /^t_[a-z0-9]{1,32}$/;

function themeStorage() {
  try { return typeof window === 'undefined' || !window ? null : window.localStorage || null; } catch (_error) { return null; }
}
function themeGuard(run, fallback) {
  try { return run(); } catch (_error) { return fallback; }
}
function themeEmpty() { return { v: 1, active: DEFAULT_ID, items: [] }; }
function themeClean(input) { return sanitizeTheme(input).theme; }
function themeItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  const theme = themeClean({ name: raw.name, tokens: raw.tokens, css: raw.css });
  return { id: raw.id, name: theme.name, tokens: theme.tokens, css: theme.css, createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0 };
}
function themeRead() {
  const storage = themeStorage();
  if (!storage) return themeEmpty();
  const raw = themeGuard(() => storage.getItem(LIB), '') || '';
  if (!raw) return themeEmpty();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_error) { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
    // 整库读不懂：原文留档再清键，下次写入从空库开始。
    themeGuard(() => { storage.setItem(CORRUPT, String(raw).slice(0, 32768)); storage.removeItem(LIB); }, null);
    return themeEmpty();
  }
  const items = [], seen = new Set();
  for (const entry of parsed.items) {
    const item = themeItem(entry);
    if (!item || seen.has(item.id) || items.length >= LIMIT) continue;
    seen.add(item.id); items.push(item);
  }
  const active = typeof parsed.active === 'string' && (parsed.active === DEFAULT_ID || seen.has(parsed.active)) ? parsed.active : DEFAULT_ID;
  return { v: 1, active, items };
}
function themeFor(library, id) {
  for (const item of library.items) if (item.id === id) return themeClean({ v: 1, name: item.name, tokens: item.tokens, css: item.css });
  return themeClean(DEFAULT_THEME);
}
function themeSnapshot(theme) {
  const storage = themeStorage();
  if (!storage) return;
  themeGuard(() => storage.setItem(SNAP, JSON.stringify({ v: 1, name: theme.name, tokens: theme.tokens, css: theme.css })), null);
}
// 落盘；超预算或 QuotaExceeded 时按 createdAt 淘汰最旧的非 active 主题重试。
function themePersist(library) {
  const storage = themeStorage();
  if (!storage) return null;
  let work = { v: 1, active: library.active, items: library.items.slice() };
  for (let attempt = 0; attempt <= LIMIT; attempt += 1) {
    const text = JSON.stringify(work);
    if (text.length <= LIB_BYTES && themeGuard(() => { storage.setItem(LIB, text); return true; }, false)) return work;
    const victims = work.items.filter((item) => item.id !== work.active).sort((a, b) => a.createdAt - b.createdAt);
    if (!victims.length) return null;
    work = { v: 1, active: work.active, items: work.items.filter((item) => item.id !== victims[0].id) };
  }
  return null;
}
function themeUniqueName(library, name, skipId) {
  const base = (String(name == null ? '' : name).trim() || NEW_NAME).slice(0, NAME_MAX);
  const taken = new Set([DEFAULT_THEME.name]);
  for (const item of library.items) if (item.id !== skipId) taken.add(item.name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = (base + ' (' + n + ')').slice(0, NAME_MAX);
    if (!taken.has(candidate)) return candidate;
  }
  return (base + ' (' + Date.now().toString(36) + ')').slice(0, NAME_MAX);
}
function themeNextId(library) {
  let id = '';
  do { id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); } while (library.items.some((item) => item.id === id));
  return id;
}

export function listThemes() {
  return themeGuard(() => {
    const out = [{ id: DEFAULT_ID, name: DEFAULT_THEME.name, builtin: true }];
    for (const item of themeRead().items) out.push({ id: item.id, name: item.name, builtin: false });
    return out;
  }, [{ id: DEFAULT_ID, name: DEFAULT_THEME.name, builtin: true }]);
}
export function getActiveId() {
  return themeGuard(() => themeRead().active, DEFAULT_ID);
}
export function resolveTheme(id) {
  return themeGuard(() => {
    const library = themeRead();
    return themeFor(library, typeof id === 'string' && id ? id : library.active);
  }, themeClean(DEFAULT_THEME));
}
export function setActiveId(id) {
  return themeGuard(() => {
    const library = themeRead();
    const wanted = id === DEFAULT_ID || library.items.some((item) => item.id === id) ? id : DEFAULT_ID;
    const theme = themeFor(library, wanted);
    themePersist({ v: 1, active: wanted, items: library.items });
    themeSnapshot(theme);
    return theme;
  }, themeClean(DEFAULT_THEME));
}
export function saveTheme(input) {
  const source = input && typeof input === 'object' ? input : {};
  if (!themeStorage()) return { ok: false, error: '当前环境不能保存主题' };
  const library = themeRead();
  if (library.items.length >= LIMIT) return { ok: false, error: '主题太多了' };
  const theme = themeClean({ name: source.name, tokens: source.tokens, css: source.css });
  const item = { id: themeNextId(library), name: themeUniqueName(library, theme.name), tokens: theme.tokens, css: theme.css, createdAt: Date.now() };
  // 新主题直接成 active：用户点保存就是想看到它。
  const saved = themePersist({ v: 1, active: item.id, items: library.items.concat([item]) });
  if (!saved) return { ok: false, error: '主题库已满，请导出后删除' };
  const kept = saved.items[saved.items.length - 1] || item;
  themeSnapshot(themeFor(saved, kept.id));
  return { ok: true, id: kept.id, name: kept.name, tokens: kept.tokens, css: kept.css, createdAt: kept.createdAt };
}
export function renameTheme(id, name) {
  const library = themeRead();
  if (!library.items.some((entry) => entry.id === id)) return { ok: false, error: id === DEFAULT_ID ? '内置主题不能改名' : '没有这个主题' };
  if (!String(name == null ? '' : name).trim()) return { ok: false, error: '名字不能为空' };
  const nextName = themeUniqueName(library, name, id);
  const next = { v: 1, active: library.active, items: library.items.map((entry) => (entry.id === id ? Object.assign({}, entry, { name: nextName }) : entry)) };
  if (!themePersist(next)) return { ok: false, error: '主题库已满，请导出后删除' };
  return { ok: true, id, name: nextName, theme: themeFor(next, id) };
}
export function deleteTheme(id) {
  const library = themeRead();
  if (!library.items.some((entry) => entry.id === id)) return { ok: false, error: id === DEFAULT_ID ? '内置主题不能删除' : '没有这个主题' };
  const fellBack = library.active === id, active = fellBack ? DEFAULT_ID : library.active;
  const next = { v: 1, active, items: library.items.filter((entry) => entry.id !== id) };
  if (!themePersist(next)) return { ok: false, error: '主题库已满，请导出后删除' };
  const theme = themeFor(next, active);
  themeSnapshot(theme);
  return { ok: true, active, fellBack, theme };
}
export function exportTheme(id) {
  return themeGuard(() => {
    const library = themeRead();
    const wanted = typeof id === 'string' && id ? id : library.active;
    if (wanted !== DEFAULT_ID && !library.items.some((entry) => entry.id === wanted)) return '';
    const theme = themeFor(library, wanted);
    return JSON.stringify({ v: 1, name: theme.name, tokens: theme.tokens, css: theme.css }, null, 2);
  }, '');
}
export function importTheme(text) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) return { ok: false, error: '主题文件是空的' };
  if (raw.length > IMPORT_BYTES) return { ok: false, error: '主题文件太大' };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_error) { return { ok: false, error: '不是有效的主题文件' }; }
  if (!parsed || typeof parsed !== 'object' || (!parsed.tokens && !parsed.css)) return { ok: false, error: '不是有效的主题文件' };
  if (parsed.v !== undefined && parsed.v !== 1) return { ok: false, error: '这个主题文件版本不认识' };
  // 导入总是分配新 id：同一个文件导入两次会得到两条，不覆盖已有的。
  return saveTheme(parsed);
}
export { LIB as THEME_LIBRARY_KEY, SNAP as THEME_SNAPSHOT_KEY };

// 测试钩子（`__test` 被 avatar.js 占了，打包后同一作用域）。
export const __storeTest = {
  libraryKey: LIB, snapshotKey: SNAP, corruptKey: CORRUPT, limit: LIMIT, nameMax: NAME_MAX,
  clear() {
    const storage = themeStorage();
    if (!storage) return;
    themeGuard(() => { storage.removeItem(LIB); storage.removeItem(SNAP); storage.removeItem(CORRUPT); }, null);
  },
};
