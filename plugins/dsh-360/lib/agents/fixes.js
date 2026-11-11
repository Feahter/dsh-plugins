/**
 * Safe, reversible fixes for one agent subject (instruction / agent).
 *
 * `planFixes` is pure: it turns suggestions into file writes. `applyPlan` backs
 * up every touched file first, writes atomically, and can be undone byte-for-
 * byte. Write targets are strictly the subject's own file, `agent-notes/**`,
 * and `.agents-360/lessons.md` — never outside the subject directory.
 */
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { replaceField } from '../frontmatter.js';
import { findReferenceSections, replaceSection, slugify, timestampId } from '../util.js';
import { composeLessonEntry, LESSONS_BLOCK, LESSONS_REL, parseLessons, upsertLessonsBlock } from './evolution.js';

export class FixError extends Error {
  constructor(message, code = 'invalid-argument') {
    super(message);
    this.name = 'FixError';
    this.code = code;
  }
}

/**
 * Only the subject's own file, `agent-notes/**` and `.agents-360/lessons.md`
 * may be written. Reject `..`, absolute paths and backslashes.
 * @param {string} path relative write path
 * @param {string} subjectFile the subject's own basename (e.g. AGENTS.md)
 */
export function assertSafeRelPath(path, subjectFile = 'AGENTS.md') {
  if (typeof path !== 'string' || path.length === 0) throw new FixError('write path is empty', 'unsafe-path');
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '')) {
    throw new FixError(`unsafe write path: ${path}`, 'unsafe-path');
  }
  const ok = path === subjectFile
    || path.startsWith('agent-notes/')
    || path === LESSONS_REL;
  if (!ok) throw new FixError(`write path outside the allowed set: ${path}`, 'unsafe-path');
  return path;
}

/** Resolve a relative write path and prove it stays inside `root`. */
export function resolveInside(root, relPath, subjectFile = 'AGENTS.md') {
  assertSafeRelPath(relPath, subjectFile);
  const base = resolve(root);
  const target = resolve(base, relPath);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new FixError(`write escapes the subject directory: ${relPath}`, 'unsafe-path');
  }
  return target;
}

async function assertRealInside(rootReal, target) {
  let cursor = target;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await realpath(cursor);
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        throw new FixError(`write resolves outside the subject directory: ${target}`, 'unsafe-path');
      }
      return;
    } catch (error) {
      if (error instanceof FixError) throw error;
      if (!error || error.code !== 'ENOENT') throw new FixError(`cannot resolve write target: ${target}`, 'unsafe-path');
      const parent = dirname(cursor);
      if (parent === cursor) throw new FixError(`cannot resolve write target: ${target}`, 'unsafe-path');
      cursor = parent;
    }
  }
  throw new FixError(`cannot resolve write target: ${target}`, 'unsafe-path');
}

function splitFrontmatterBlock(raw) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(String(raw));
  if (!match) return { head: '', body: String(raw) };
  return { head: match[0], body: String(raw).slice(match[0].length) };
}

function withBody(raw, body) {
  const { head } = splitFrontmatterBlock(raw);
  return head + String(body);
}

function orderedUnique(paths) {
  return [...new Set(paths)];
}

function oneLine(value, max) {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

const LESSON_HEADING_RE = /^##\s*(?:按需参考|参考资源|References|参考)\s*$/m;
const LESSON_ITEM_LINE_RE = /^\s*-\s*\[?\d{4}-\d{1,2}-\d{1,2}\]?/;

function buildLessonsContent(lessonsRaw, entry) {
  const existing = String(lessonsRaw ?? '');
  if (!existing.trim()) return `# Lessons（实战经验）\n\n> 由 dsh-360 从真实信号沉淀，最新在上。\n\n${entry}\n`;
  const lines = existing.split('\n');
  const index = lines.findIndex((line) => LESSON_ITEM_LINE_RE.test(line));
  if (index < 0) return `${existing.replace(/\s+$/, '')}\n\n${entry}\n`;
  lines.splice(index, 0, entry);
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

function ensureNotesList(body, notes, language) {
  const heading = language === 'en' ? '## References (on demand)' : '## 按需参考';
  const list = notes.map((note) => `- [${basename(note)}](${note})`).join('\n');
  if (body.includes(heading)) {
    return body.replace(heading, `${heading}\n\n${list}`);
  }
  return `${body.replace(/\s+$/, '')}\n\n${heading}\n\n${list}\n`;
}

/**
 * Turn suggestions into writes.
 * @param {{report:object, raw:string, files?:{path:string,chars?:number}[], actionIds:string[], lesson?:object, lessonsRaw?:string, now?:number}} input
 * @returns {{actions:object[], skipped:{id:string,reason:string}[], writes:{path:string,content:string}[]}}
 */
export function planFixes({ report, raw, files = [], actionIds, lesson, lessonsRaw, now = Date.now() }) {
  if (report?.kind === 'preset' || !report?.path) {
    return { actions: [], skipped: [{ id: 'preset', reason: 'preset 不落盘，无可写文件' }], writes: [] };
  }
  const subjectFile = basename(report.path);
  const suggestions = Array.isArray(report?.suggestions) ? report.suggestions : [];
  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const ids = Array.isArray(actionIds) && actionIds.length > 0
    ? actionIds
    : suggestions.filter((suggestion) => suggestion.kind === 'auto').map((suggestion) => suggestion.id);
  const language = report?.metrics?.language === 'en' ? 'en' : 'zh';
  let current = String(raw);
  const actions = [];
  const skipped = [];
  const writes = new Map();

  for (const id of orderedUnique(ids)) {
    const suggestion = byId.get(id);
    const synthesized = id === 'fix.add-lesson' && lesson && !suggestion
      ? { id, kind: 'draft', title: '沉淀一条“触发→做法”经验', action: { type: 'add-lesson', params: { lesson } } }
      : suggestion;
    if (!synthesized) {
      skipped.push({ id, reason: '该建议已过期或不属于当前 subject' });
      continue;
    }
    if (synthesized.kind === 'manual') {
      skipped.push({ id, reason: 'manual 建议不自动改写' });
      continue;
    }
    const type = synthesized.action?.type;
    const params = synthesized.action?.params || {};
    try {
      if (type === 'extract-sections') {
        const titles = Array.isArray(params.titles) ? params.titles : [];
        const movement = [];
        let body = splitFrontmatterBlock(current).body;
        for (const title of titles) {
          const section = findReferenceSections(body).find((candidate) => candidate.title === title);
          if (!section) continue;
          let refName = `${slugify(title)}.md`;
          let suffix = 2;
          while ((files || []).some((file) => file.path === `agent-notes/${refName}`)
            || [...writes.keys()].includes(`agent-notes/${refName}`)) {
            refName = `${slugify(title)}-${suffix}.md`;
            suffix += 1;
          }
          const refPath = `agent-notes/${refName}`;
          const pointer = language === 'zh'
            ? `## ${title}\n\n详见 [${refPath}](${refPath})（${section.lines} 行，按需读取）。`
            : `## ${title}\n\nSee [${refPath}](${refPath}) (${section.lines} lines, read on demand).`;
          const content = section.text.replace(/^##\s+/, '# ').replace(/\s+$/, '') + '\n';
          body = replaceSection(body, section, pointer);
          writes.set(refPath, content);
          movement.push({ title, refPath, lines: section.lines });
        }
        if (movement.length === 0) {
          skipped.push({ id, reason: '没有匹配到可拆分的参考型章节' });
          continue;
        }
        current = withBody(current, body);
        actions.push({ id, type, title: synthesized.title, moved: movement });
        continue;
      }

      if (type === 'link-notes') {
        const notes = (params.notes || (files || []).filter((file) => String(file.path || '').startsWith('agent-notes/')).map((file) => file.path)).filter(Boolean);
        if (notes.length === 0) {
          skipped.push({ id, reason: '没有可链接的 agent-notes 文件' });
          continue;
        }
        const body = splitFrontmatterBlock(current).body;
        const missing = notes.filter((note) => !body.includes(`](${note})`));
        if (missing.length === 0) {
          skipped.push({ id, reason: '正文已经链接了全部 agent-notes' });
          continue;
        }
        const nextBody = ensureNotesList(body, missing, language);
        current = withBody(current, nextBody.endsWith('\n') ? nextBody : `${nextBody}\n`);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      if (type === 'embed-lessons') {
        const entries = Array.isArray(params.entries) ? params.entries : parseLessons(lessonsRaw || '').entries;
        if (entries.length === 0) {
          skipped.push({ id, reason: '经验账本为空' });
          continue;
        }
        const body = splitFrontmatterBlock(current).body;
        const nextBody = upsertLessonsBlock(body, entries);
        if (nextBody === body) {
          skipped.push({ id, reason: '正文已有受管经验块' });
          continue;
        }
        current = withBody(current, nextBody);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      if (type === 'rewrite-description') {
        const text = String(params.text || '').trim();
        if (!text) {
          skipped.push({ id, reason: '动作没有生成新描述' });
          continue;
        }
        current = replaceField(current, 'description', text);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      if (type === 'add-verification' || type === 'add-boundary') {
        const text = String(params.text || '').trim();
        if (!text) {
          skipped.push({ id, reason: '骨架草稿为空' });
          continue;
        }
        const body = splitFrontmatterBlock(current).body;
        current = withBody(current, `${body.replace(/\s+$/, '')}\n\n${text}\n`);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      if (type === 'dedupe-rules') {
        const otherId = String(params.otherId || '');
        const rule = String(params.rule || '').slice(0, 120);
        const note = `\n\n> 本条规则与 ${otherId} 重复，请保留一处并在此留指针（agents-360 合并稿）。\n`;
        const body = splitFrontmatterBlock(current).body;
        if (body.includes('本条规则与')) {
          skipped.push({ id, reason: '已存在合并指针' });
          continue;
        }
        current = withBody(current, `${body.replace(/\s+$/, '')}${note}`);
        actions.push({ id, type, title: synthesized.title, rule });
        continue;
      }

      if (type === 'add-lesson') {
        const lessonParam = (lesson && typeof lesson === 'object' ? lesson : params.lesson) || {};
        const trigger = oneLine(lessonParam.trigger, 120);
        const rule = oneLine(lessonParam.rule, 300);
        const evidence = oneLine(lessonParam.evidence, 120);
        if (!trigger) {
          skipped.push({ id, reason: '经验缺少触发描述' });
          continue;
        }
        if (!rule || /^(待补|TODO|TBD|待填写|请补充)/i.test(rule)) {
          skipped.push({ id, reason: '经验缺少做法（rule 为空），请走 dsh360_evolve 补全后再应用' });
          continue;
        }
        const entry = composeLessonEntry({ at: lessonParam.at ?? now, trigger, rule, evidence });
        writes.set(LESSONS_REL, buildLessonsContent(lessonsRaw, entry));
        const body = splitFrontmatterBlock(current).body;
        const parsed = parseLessons(`${writes.get(LESSONS_REL) || ''}`);
        const nextBody = upsertLessonsBlock(body, parsed.entries);
        if (nextBody !== body) current = withBody(current, nextBody.endsWith('\n') ? nextBody : `${nextBody}\n`);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      skipped.push({ id, reason: `未知动作类型：${type || 'missing'}` });
    } catch (error) {
      skipped.push({ id, reason: error.message });
    }
  }

  if (actions.length > 0) writes.set(subjectFile, current);
  return {
    actions,
    skipped,
    writes: [...writes.entries()].map(([path, content]) => ({ path, content })),
  };
}

/**
 * @param {{plan:object, subjectDir:string, backupRoot:string, now?:number, report?:object}} input
 */
export async function applyPlan({ plan, subjectDir, backupRoot, now = Date.now(), report }) {
  if (!plan || !Array.isArray(plan.writes) || plan.writes.length === 0) {
    throw new FixError('没有可写入的改动', 'no-actions');
  }
  const subjectFile = report?.path ? basename(report.path) : 'AGENTS.md';
  for (const write of plan.writes) assertSafeRelPath(write.path, subjectFile);
  const rootReal = await realpath(subjectDir);
  const backupId = timestampId(new Date(now));
  const backupDir = join(backupRoot, backupId);
  const filesDir = join(backupDir, 'files');
  await mkdir(filesDir, { recursive: true });

  const manifest = {
    id: backupId,
    createdAt: now,
    subject: report?.id || report?.name || '',
    subjectDir,
    subjectFile,
    subjectRootReal: rootReal,
    actions: plan.actions.map((action) => action.id),
    files: [],
  };
  const prepared = [];
  for (const write of plan.writes) {
    const target = resolveInside(subjectDir, write.path, subjectFile);
    await assertRealInside(rootReal, target);
    let before = '';
    let existed = true;
    try {
      before = await readFile(target, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      existed = false;
    }
    if (existed && before === write.content) continue;
    const backupRel = `files/${write.path}`;
    if (existed) {
      await mkdir(dirname(join(backupDir, backupRel)), { recursive: true });
      await copyFile(target, join(backupDir, backupRel));
    }
    manifest.files.push({ path: write.path, existed, backupRel: existed ? backupRel : null });
    prepared.push({ ...write, target, before, existed });
  }

  if (prepared.length === 0) {
    await rm(backupDir, { recursive: true, force: true });
    throw new FixError('所有改动与原文件相同，未写入', 'no-actions');
  }
  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const changed = [];
  let diff = '';
  for (const item of prepared) {
    await mkdir(dirname(item.target), { recursive: true });
    const temp = `${item.target}.agents360-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(temp, item.content, 'utf8');
    await rename(temp, item.target);
    changed.push({ path: item.path, beforeChars: item.existed ? item.before.length : 0, afterChars: item.content.length });
    if (item.path === subjectFile) diff = diffText(item.before, item.content);
  }
  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { backupId, backupDir, changed, diff, manifest };
}

async function readManifest(backupRoot, id) {
  const path = join(backupRoot, id, 'manifest.json');
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new FixError(`备份不存在：${id}`, 'not-found');
  }
  return JSON.parse(text);
}

/**
 * @param {{backupRoot:string, backupId?:string}} input
 */
export async function undoBackup({ backupRoot, backupId }) {
  let id = backupId;
  if (!id) {
    const backups = await listBackups(backupRoot);
    if (backups.length === 0) throw new FixError('没有可撤销的备份', 'not-found');
    id = backups[0].id;
  }
  const manifest = await readManifest(backupRoot, id);
  const rootReal = manifest.subjectRootReal || await realpath(manifest.subjectDir);
  const subjectFile = manifest.subjectFile || basename(manifest.subjectDir);
  const restored = [];
  const removed = [];
  const preUndo = [];
  const preUndoDir = join(backupRoot, id, 'pre-undo');
  for (const file of manifest.files || []) {
    const target = resolveInside(manifest.subjectDir, file.path, subjectFile);
    await assertRealInside(rootReal, target);
    try {
      const current = await readFile(target);
      const rel = `pre-undo/${file.path}`;
      await mkdir(dirname(join(backupRoot, id, rel)), { recursive: true });
      await writeFile(join(backupRoot, id, rel), current);
      preUndo.push({ path: file.path, backupRel: rel });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (file.existed) {
      const backupPath = join(backupRoot, id, file.backupRel);
      const content = await readFile(backupPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      restored.push(file.path);
    } else {
      try {
        await unlink(target);
        removed.push(file.path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  if (preUndo.length > 0) {
    manifest.preUndo = preUndo;
    try {
      await writeFile(join(backupRoot, id, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    } catch {
      // snapshot files already on disk
    }
  }
  return { backupId: id, restored, removed, preUndo, preUndoDir: preUndo.length > 0 ? preUndoDir : null };
}

/** List backups, newest first. */
export async function listBackups(backupRoot) {
  let entries;
  try {
    entries = await readdir(backupRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = await readManifest(backupRoot, entry.name);
      backups.push({
        id: manifest.id, createdAt: manifest.createdAt, subject: manifest.subject,
        subjectDir: manifest.subjectDir, actions: manifest.actions,
        files: (manifest.files || []).map((file) => file.path),
      });
    } catch {
      // ignore half-written backups
    }
  }
  backups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.id.localeCompare(a.id));
  return backups;
}

/**
 * Delete all but the newest `keep` backups, never touching `protectedIds`
 * (the backups created by the current batch must stay undoable even when the
 * batch is larger than the retention window).
 */
export async function pruneBackups(backupRoot, keep = 20, protectedIds = []) {
  const backups = await listBackups(backupRoot);
  const protectedSet = new Set(Array.isArray(protectedIds) ? protectedIds : []);
  const keepCount = Math.max(0, Number(keep) || 0);
  const rest = backups.filter((backup) => !protectedSet.has(backup.id));
  const doomed = rest.slice(Math.max(0, keepCount - (backups.length - rest.length)));
  for (const backup of doomed) {
    await rm(join(backupRoot, backup.id), { recursive: true, force: true });
  }
  return doomed.map((backup) => backup.id);
}

/** Compact line diff (shared prefix/suffix + changed middle). */
export function diffText(before, after, contextLines = 3) {
  if (before === after) return '';
  const a = String(before).split('\n');
  const b = String(after).split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  const from = Math.max(0, prefix - contextLines);
  const toA = Math.min(a.length, a.length - suffix + contextLines);
  const toB = Math.min(b.length, b.length - suffix + contextLines);
  const lines = [`@@ -${from + 1},${toA - from} +${from + 1},${toB - from} @@`];
  for (let i = from; i < prefix; i += 1) lines.push(' ' + a[i]);
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  const cap = 240;
  removed.slice(0, cap).forEach((line) => lines.push('-' + line));
  if (removed.length > cap) lines.push(`-… (${removed.length - cap} more removed lines)`);
  added.slice(0, cap).forEach((line) => lines.push('+' + line));
  if (added.length > cap) lines.push(`+… (${added.length - cap} more added lines)`);
  for (let i = a.length - suffix; i < toA; i += 1) lines.push(' ' + a[i]);
  return lines.join('\n');
}
