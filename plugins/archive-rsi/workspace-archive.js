/**
 * Read-only mirror of the Harness's own archived/pinned session lists.
 *
 * The Harness already has an archive: `workspaceController.archiveSession`
 * persists session ids into `<dshHome>/storages/workspace.json` under
 * `global.archivedSessionIds`, and an archived session is refused a model step
 * at runtime. That state is authoritative and this plugin must not fork it, so
 * it is mirrored here and never written: a second store would silently disagree
 * with the gate the Harness actually enforces.
 *
 * Reads are cached on (mtimeMs, size) because `archive_list` may be called
 * repeatedly while the file only changes when the user archives a session.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Cache key: `${dshHome}/storages/workspace.json`. */
const cache = new Map();

/**
 * @param dshHome - Harness home (`$DSH_HOME` or `~/.dsh`).
 * @returns `{ archived, pinned, path, at, error }`; sets are empty on failure.
 */
export async function readHarnessArchive(dshHome) {
  const file = path.join(dshHome, 'storages', 'workspace.json');
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    return { archived: new Set(), pinned: new Set(), path: file, at: 0, error: (error && error.code) || 'stat-failed' };
  }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;

  let value;
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const global = parsed && typeof parsed.global === 'object' && parsed.global ? parsed.global : {};
    const list = (input) => new Set(Array.isArray(input) ? input.filter((id) => typeof id === 'string') : []);
    value = {
      archived: list(global.archivedSessionIds),
      pinned: list(global.pinnedSessionIds),
      path: file,
      at: stat.mtimeMs,
      error: null,
    };
  } catch (error) {
    // A corrupt or locked file must degrade to "nothing is archived" rather
    // than break every listing call.
    value = {
      archived: new Set(),
      pinned: new Set(),
      path: file,
      at: stat.mtimeMs,
      error: (error && error.message) || 'read-failed',
    };
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

/**
 * Copy an archive entry with the Harness's own flags attached.
 *
 * @param entry - ArchiveStore entry.
 * @param state - result of {@link readHarnessArchive}.
 */
export function annotate(entry, state) {
  if (!entry) return entry;
  return {
    ...entry,
    harnessArchived: state.archived.has(entry.id),
    harnessPinned: state.pinned.has(entry.id),
  };
}

/**
 * Filter a list of entries by the Harness archive flag.
 *
 * @param entries - annotated or raw entries.
 * @param state - result of {@link readHarnessArchive}.
 * @param mode - `true` keeps archived only, `false` keeps unarchived only, undefined keeps all.
 */
export function filterByHarnessArchive(entries, state, mode) {
  if (mode !== true && mode !== false) return entries;
  return entries.filter((entry) => state.archived.has(entry.id) === mode);
}
