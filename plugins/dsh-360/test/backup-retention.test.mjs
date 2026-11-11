import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { listBackups, pruneBackups } from '../lib/skills/fixes.js';

async function seed(root, count) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = `20261111-0000${String(index).padStart(2, '0')}-test`;
    const dir = join(root, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      id,
      createdAt: 1000 + index,
      skill: `s${index}`,
      skillDir: join(root, `skill-${index}`),
      actions: [],
      files: [],
    }), 'utf8');
    ids.push(id);
  }
  return ids;
}

test('a batch larger than the retention window stays undoable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-prune-'));
  try {
    const root = join(dir, 'backups');
    const ids = await seed(root, 31);
    const pruned = await pruneBackups(root, 20, ids);
    assert.deepEqual(pruned, [], 'nothing from the current batch is pruned');
    assert.equal((await listBackups(root)).length, 31, 'all 31 batch backups survive');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unprotected older backups are pruned down to the retention window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-prune2-'));
  try {
    const root = join(dir, 'backups');
    await seed(root, 25);
    const pruned = await pruneBackups(root, 20, []);
    assert.equal(pruned.length, 5);
    assert.equal((await listBackups(root)).length, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('protected ids are kept even when they are older than the window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh360-prune3-'));
  try {
    const root = join(dir, 'backups');
    const ids = await seed(root, 25);
    const oldest = ids[0];
    const pruned = await pruneBackups(root, 20, [oldest]);
    assert.ok(!pruned.includes(oldest), 'the protected older backup is not pruned');
    assert.equal((await listBackups(root)).length, 20, 'retention still caps the unprotected set');
    assert.ok((await listBackups(root)).some((backup) => backup.id === oldest));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
