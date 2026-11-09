/**
 * Safe, reversible fixes for one skill.
 *
 * `planFixes` is pure: it turns server-generated suggestions into file
 * writes. `applyPlan` backs up every touched file first, writes atomically,
 * and can be undone byte-for-byte. Nothing here invents content beyond the
 * explicitly labelled draft actions in RUBRIC.md.
 */
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { replaceBody, replaceField } from './frontmatter.js';
import { findReferenceSections, replaceSection, slugify, timestampId } from './util.js';
import { composeLessonEntry, LESSONS_PATH } from './evolution.js';

class FixError extends Error {
  constructor(message, code = 'invalid-argument') {
    super(message);
    this.name = 'FixError';
    this.code = code;
  }
}

/** Only SKILL.md and references/*.md may be written. */
export function assertSafeRelPath(path) {
  if (typeof path !== 'string' || path.length === 0) throw new FixError('write path is empty', 'unsafe-path');
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '')) {
    throw new FixError(`unsafe write path: ${path}`, 'unsafe-path');
  }
  if (path !== 'SKILL.md' && !/^references\/[A-Za-z0-9._-]+\.md$/.test(path)) {
    throw new FixError(`write path outside the allowed set: ${path}`, 'unsafe-path');
  }
  return path;
}

/** Resolve a relative write path and prove it stays inside `root`. */
export function resolveInside(root, relPath) {
  assertSafeRelPath(relPath);
  const base = resolve(root);
  const target = resolve(base, relPath);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new FixError(`write escapes the skill directory: ${relPath}`, 'unsafe-path');
  }
  return target;
}

/**
 * Re-check the real path of a write target (or its nearest existing parent).
 * A symlinked SKILL.md/references dir, or a skillDir symlink repointed between
 * apply and undo, must not smuggle a write outside the original root.
 */
async function assertRealInside(rootReal, target) {
  let cursor = target;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await realpath(cursor);
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        throw new FixError(`write resolves outside the skill directory: ${target}`, 'unsafe-path');
      }
      return;
    } catch (error) {
      if (error instanceof FixError) throw error;
      if (!error || error.code !== 'ENOENT') {
        throw new FixError(`cannot resolve write target: ${target}`, 'unsafe-path');
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw new FixError(`cannot resolve write target: ${target}`, 'unsafe-path');
      cursor = parent;
    }
  }
  throw new FixError(`cannot resolve write target: ${target}`, 'unsafe-path');
}

function bodyFromRaw(raw) {
  const normalized = String(raw);
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(normalized);
  if (!match) throw new FixError('cannot locate frontmatter block', 'invalid-frontmatter');
  return normalized.slice(match[0].length);
}

function withBody(raw, body) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(String(raw));
  if (!match) throw new FixError('cannot locate frontmatter block', 'invalid-frontmatter');
  return match[0] + String(body);
}

function orderedUnique(paths) {
  return [...new Set(paths)];
}

const LESSONS_HEADER = '# Lessons（实战经验）\n\n> 由 skills-360 从真实调用信号沉淀，按需读取；最新在上。\n\n';
const LESSON_LINK = `- [lessons.md](${LESSONS_PATH}) — 实战经验（按需读取）`;
const LESSON_ITEM_LINE_RE = /^\s*-\s*\[?\d{4}-\d{1,2}-\d{1,2}\]?/;
const LESSON_HEADING_RE = /^##\s*(?:参考资源|References|参考)\s*$/m;

function oneLine(value, max) {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/** Build the new `references/lessons.md` text with a fresh entry on top. */
function buildLessonsContent(lessonsRaw, entry) {
  const existing = String(lessonsRaw ?? '');
  if (!existing.trim()) return `${LESSONS_HEADER}${entry}\n`;
  const lines = existing.split('\n');
  const index = lines.findIndex((line) => LESSON_ITEM_LINE_RE.test(line));
  if (index < 0) return `${existing.replace(/\s+$/, '')}\n\n${entry}\n`;
  lines.splice(index, 0, entry);
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

/** Add the lessons.md link to the SKILL.md body, returning the new body. */
function ensureLessonsLink(body) {
  if (body.includes(`](${LESSONS_PATH})`)) return body;
  const match = LESSON_HEADING_RE.exec(body);
  if (match) {
    const cut = match.index + match[0].length;
    const before = body.slice(0, cut);
    const after = body.slice(cut);
    const sep = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    return `${before}${sep}${LESSON_LINK}${after}`;
  }
  return `${body.replace(/\s+$/, '')}\n\n## 参考资源\n\n${LESSON_LINK}`;
}

/**
 * Turn suggestions into writes. Actions run in the order given; later actions
 * see earlier rewrites.
 * @param {{report:object, raw:string, files?:{path:string,chars:number}[], actionIds:string[], lesson?:object, lessonsRaw?:string, now?:number}} input
 * @returns {{actions:object[], skipped:object[], writes:{path:string,content:string}[]}}
 */
export function planFixes({ report, raw, files = [], actionIds, lesson, lessonsRaw, now = Date.now() }) {
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
    // `fix.add-lesson` may be driven by an explicit lesson (tool direct-write
    // path) even when the report's suggestions no longer contain that id.
    const synthesized = id === 'fix.add-lesson' && lesson && !suggestion
      ? { id, kind: 'draft', title: '沉淀一条“触发→做法”经验', action: { type: 'add-lesson', params: { lesson } } }
      : suggestion;
    if (!synthesized) {
      skipped.push({ id, reason: '该建议已过期或不属于当前 skill' });
      continue;
    }
    if (synthesized.kind === 'manual') {
      skipped.push({ id, reason: 'manual 建议不自动改写' });
      continue;
    }
    const type = synthesized.action?.type;
    const params = synthesized.action?.params || {};
    try {
      if (type === 'link-references') {
        const refs = (params.refs || report.metrics?.references?.map((ref) => ref.path) || []).filter(Boolean);
        if (refs.length === 0) {
          skipped.push({ id, reason: '没有可链接的 references 文件' });
          continue;
        }
        const body = bodyFromRaw(current);
        const list = refs
          .map((ref) => `- [${ref.replace(/^references\//, '')}](${ref})`)
          .join('\n');
        const missing = refs.filter((ref) => !body.includes(`](${ref})`));
        if (missing.length === 0) {
          skipped.push({ id, reason: '正文已经链接了全部 references' });
          continue;
        }
        const heading = language === 'zh' ? '## 参考资源' : '## References';
        const nextBody = body.includes(heading)
          ? body.replace(heading, `${heading}\n\n${missing.map((ref) => `- [${ref.replace(/^references\//, '')}](${ref})`).join('\n')}`)
          : `${body.replace(/\s+$/, '')}\n\n${heading}\n\n${list}`;
        current = withBody(current, nextBody.endsWith('\n') ? nextBody : `${nextBody}\n`);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      if (type === 'extract-sections') {
        const titles = Array.isArray(params.titles) ? params.titles : [];
        const movement = [];
        let body = bodyFromRaw(current);
        for (const title of titles) {
          // Recompute after every move: earlier extraction shifted every
          // later section's start/end line.
          const section = findReferenceSections(body).find((candidate) => candidate.title === title);
          if (!section) continue;
          let refName = `${slugify(title)}.md`;
          let suffix = 2;
          while ((files || []).some((file) => file.path === `references/${refName}`)
            || [...writes.keys()].includes(`references/${refName}`)) {
            refName = `${slugify(title)}-${suffix}.md`;
            suffix += 1;
          }
          const refPath = `references/${refName}`;
          const pointer = language === 'zh'
            ? `## ${title}\n\n详见 [${refPath}](${refPath})（${section.lines} 行，按需读取）。`
            : `## ${title}\n\nSee [${refPath}](${refPath}) (${section.lines} lines, read on demand).`;
          // The reference file lives one level deeper: relative links in the
          // moved section must be rebased (`assets/x` -> `../assets/x`).
          const content = section.text
            .replace(/^##\s+/, '# ')
            .replace(/\]\((?!https?:|#|\/|\.\.\/)([^)\s]+)\)/g, '](../$1)')
            .replace(/\s+$/, '') + '\n';
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

      if (type === 'trim-description' || type === 'frontload-triggers' || type === 'rewrite-description') {
        const text = String(params.text || '').trim();
        if (!text) {
          skipped.push({ id, reason: '动作没有生成新描述' });
          continue;
        }
        if (text.length > (Number(params.max) || 2000)) {
          skipped.push({ id, reason: '新描述超长，拒绝写入' });
          continue;
        }
        current = replaceField(current, 'description', text);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      if (type === 'add-boundary') {
        const text = String(params.text || '').trim();
        if (!text) {
          skipped.push({ id, reason: '边界草稿为空' });
          continue;
        }
        const body = bodyFromRaw(current);
        current = withBody(current, `${body.replace(/\s+$/, '')}\n\n${text}\n`);
        actions.push({ id, type, title: synthesized.title });
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
          skipped.push({ id, reason: '经验缺少做法，先补一条可执行规则' });
          continue;
        }
        const entry = composeLessonEntry({ at: lessonParam.at ?? now, trigger, rule, evidence });
        const lessonsContent = buildLessonsContent(lessonsRaw, entry);
        writes.set(LESSONS_PATH, lessonsContent);
        const body = bodyFromRaw(current);
        const nextBody = ensureLessonsLink(body);
        if (nextBody !== body) current = withBody(current, nextBody.endsWith('\n') ? nextBody : `${nextBody}\n`);
        actions.push({ id, type, title: synthesized.title });
        continue;
      }

      skipped.push({ id, reason: `未知动作类型：${type || 'missing'}` });
    } catch (error) {
      skipped.push({ id, reason: error.message });
    }
  }

  if (actions.length > 0) writes.set('SKILL.md', current);
  return {
    actions,
    skipped,
    writes: [...writes.entries()].map(([path, content]) => ({ path, content })),
  };
}

/**
 * Write a plan with a full backup.
 * @param {{plan:object, skillDir:string, backupRoot:string, now?:number, report?:object}} input
 */
export async function applyPlan({ plan, skillDir, backupRoot, now = Date.now(), report }) {
  if (!plan || !Array.isArray(plan.writes) || plan.writes.length === 0) {
    throw new FixError('没有可写入的改动', 'no-actions');
  }
  for (const write of plan.writes) assertSafeRelPath(write.path);
  const rootReal = await realpath(skillDir);
  const backupId = timestampId(new Date(now));
  const backupDir = join(backupRoot, backupId);
  const filesDir = join(backupDir, 'files');
  await mkdir(filesDir, { recursive: true });

  const manifest = {
    id: backupId,
    createdAt: now,
    skill: report?.name || '',
    skillDir,
    skillRootReal: rootReal,
    actions: plan.actions.map((action) => action.id),
    files: [],
  };
  const prepared = [];
  for (const write of plan.writes) {
    const target = resolveInside(skillDir, write.path);
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
  // Write the manifest BEFORE touching any target: a crash mid-write leaves
  // every changed file covered by the backup and restorable.
  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const changed = [];
  let diff = '';
  for (const item of prepared) {
    await mkdir(dirname(item.target), { recursive: true });
    const temp = `${item.target}.skills360-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(temp, item.content, 'utf8');
    await rename(temp, item.target);
    changed.push({ path: item.path, beforeChars: item.existed ? item.before.length : 0, afterChars: item.content.length });
    if (item.path === 'SKILL.md') diff = diffText(item.before, item.content);
  }

  if (changed.length === 0) {
    await rm(backupDir, { recursive: true, force: true });
    throw new FixError('所有改动与原文件相同，未写入', 'no-actions');
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
 * Restore the newest backup, or one explicit backup id.
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
  const rootReal = manifest.skillRootReal || await realpath(manifest.skillDir);
  const restored = [];
  const removed = [];
  const preUndo = [];
  const preUndoDir = join(backupRoot, id, 'pre-undo');
  for (const file of manifest.files || []) {
    const target = resolveInside(manifest.skillDir, file.path);
    await assertRealInside(rootReal, target);
    // Preserve whatever exists right now (including edits made after apply)
    // so an undo is never a silent data loss.
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
      // snapshot files are already on disk; manifest drift is non-fatal
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
        id: manifest.id,
        createdAt: manifest.createdAt,
        skill: manifest.skill,
        skillDir: manifest.skillDir,
        actions: manifest.actions,
        files: (manifest.files || []).map((file) => file.path),
      });
    } catch {
      // ignore half-written backups
    }
  }
  backups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.id.localeCompare(a.id));
  return backups;
}

/** Delete all but the newest `keep` backups. */
export async function pruneBackups(backupRoot, keep = 20) {
  const backups = await listBackups(backupRoot);
  const doomed = backups.slice(Math.max(0, keep));
  for (const backup of doomed) {
    await rm(join(backupRoot, backup.id), { recursive: true, force: true });
  }
  return doomed.map((backup) => backup.id);
}

/**
 * Compact line diff: shared prefix/suffix plus the changed middle. Adequate
 * for a UI preview without an O(n*m) LCS on 100KB skill files.
 */
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

export { FixError };
