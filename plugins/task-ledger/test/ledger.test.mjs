/**
 * dsh-task-ledger — store-level regression tests (node:test, no network, no real
 * ledger). Every test gets its own temp root under the OS temp dir; the real
 * `~/.dsh/task-ledger` is never opened.
 *
 * Covers the invariants that protect the ledger data itself: the single-writer
 * lease (including the unbound-session takeover hole), optimistic versioning,
 * the evidence gate, concurrent checkpoints, and concurrent regeneration of the
 * derived INDEX.md.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import * as ledger from '../ledger.js'
import { regenerateIndex } from '../index-md.js'

const roots = []
async function freshRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-task-ledger-test-'))
  roots.push(root)
  return root
}
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function openTask(root, extra = {}) {
  const { charter } = await ledger.createTask(root, {
    title: 'Ledger regression task',
    goal: 'Prove the store keeps one canonical writer and a durable audit trail.',
    ...extra,
  })
  return charter.task_id
}

test('lifecycle: open → resume → checkpoint → close keeps the charter immutable and releases the lease', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root, { tags: ['audit'], acceptance: ['lease released'] })
  const taskDir = join(root, 'tasks', taskId)
  const charterBefore = await readFile(join(taskDir, 'task.json'), 'utf8')

  const resumed = await ledger.resumeTask(root, taskId, { sessionId: 'session-a', label: 'lifecycle' })
  assert.equal(resumed.state.version, 2, 'resume bumps the version')
  assert.equal(resumed.lease.session_id, 'session-a')

  const checkpoint = await ledger.checkpointTask(root, taskId, resumed.run_id, {
    phase: 'evidence',
    next_actions: ['close the loop'],
    note: 'evidence landed',
    claims: [
      { id: 'c1', claim: 'The store writes atomically.', status: 'verified', source_ref: 'ledger.js' },
    ],
  })
  assert.equal(checkpoint.state.phase, 'evidence')
  assert.equal(checkpoint.state.version, 3)
  assert.equal(checkpoint.gate.pass, true)

  const closed = await ledger.closeTask(root, taskId, resumed.run_id, {
    summary: 'The run is complete.',
    findings: ['one canonical writer'],
  })
  assert.equal(closed.state.status, 'done')
  assert.equal(closed.state.phase, 'closed')
  assert.equal(closed.state.lease, null)
  assert.equal(closed.run.gate.pass, true)

  const report = await readFile(join(taskDir, 'runs', `${resumed.run_id}.md`), 'utf8')
  assert.match(report, /The run is complete\./)

  const charterAfter = await readFile(join(taskDir, 'task.json'), 'utf8')
  assert.equal(charterAfter, charterBefore, 'the immutable charter must not change')

  // A closed run can no longer write.
  await assert.rejects(
    ledger.checkpointTask(root, taskId, resumed.run_id, { note: 'late write' }),
    (error) => error.code === 'no-lease',
  )
})

test('lease: a second session is refused, and an unbound session cannot steal a live lease', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)

  // Regression: with sessionId null on both sides, `lease.session_id !== sessionId`
  // used to be false, so a second CLI/agent run silently took the live lease over.
  await ledger.resumeTask(root, taskId, { sessionId: null })
  await assert.rejects(
    ledger.resumeTask(root, taskId, { sessionId: null }),
    (error) => error.code === 'task-leased',
    'an unbound second resume must not take over a live lease',
  )

  const otherRoot = await freshRoot()
  const otherTask = await openTask(otherRoot)
  await ledger.resumeTask(otherRoot, otherTask, { sessionId: 'session-a' })
  await assert.rejects(
    ledger.resumeTask(otherRoot, otherTask, { sessionId: 'session-b' }),
    (error) => error.code === 'task-leased',
  )
  // The same identified session may renew its own lease.
  const renewed = await ledger.resumeTask(otherRoot, otherTask, { sessionId: 'session-a' })
  assert.equal(renewed.lease.session_id, 'session-a')
})

test('lease: a write with the wrong run_id is refused; an expired lease is refused', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)
  const resumed = await ledger.resumeTask(root, taskId, { sessionId: 'session-a' })

  await assert.rejects(
    ledger.checkpointTask(root, taskId, 'run-00000000000000-abcdef', { note: 'wrong run' }),
    (error) => error.code === 'lease-mismatch',
  )

  const statePath = join(root, 'tasks', taskId, 'state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  state.lease.expires_at = new Date(Date.now() - 1000).toISOString()
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')

  await assert.rejects(
    ledger.checkpointTask(root, taskId, resumed.run_id, { note: 'expired' }),
    (error) => error.code === 'lease-expired',
  )
})

test('lease: a failed bind rolls the lease write back instead of stranding it for an hour', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)
  const statePath = join(root, 'tasks', taskId, 'state.json')

  // `active.json` is a directory here, so setActiveTaskId's atomic rename fails
  // *after* the lease has been written. Before the fix the caller got an error
  // while the live lease stayed on disk, and a different session could not
  // resume until the ~3600s TTL expired.
  await mkdir(join(root, 'active.json'))
  await assert.rejects(
    ledger.resumeTask(root, taskId, { sessionId: 'session-a' }),
    (error) => error.code !== 'task-leased',
    'the bind failure must surface as the bind error, not as a stale lease',
  )

  const state = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(state.lease, null, 'a failed bind left a live lease on disk')

  await rm(join(root, 'active.json'), { recursive: true, force: true })
  const resumed = await ledger.resumeTask(root, taskId, { sessionId: 'session-b' })
  assert.equal(resumed.lease.session_id, 'session-b')
})

test('optimistic lock: a stale expected_version is refused before anything is written', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)
  const resumed = await ledger.resumeTask(root, taskId, { sessionId: 'session-a' })
  const claimsBefore = await readFile(join(root, 'tasks', taskId, 'claims.jsonl'), 'utf8').catch(() => '')

  await assert.rejects(
    ledger.checkpointTask(root, taskId, resumed.run_id, {
      expected_version: 1,
      claims: [{ claim: 'must not be appended' }],
    }),
    (error) => error.code === 'version-conflict',
  )
  const claimsAfter = await readFile(join(root, 'tasks', taskId, 'claims.jsonl'), 'utf8').catch(() => '')
  assert.equal(claimsAfter, claimsBefore, 'a refused write must not append claims')
})

test('evidence gate: an unverified claim downgrades close to blocked, force records the override', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)
  const first = await ledger.resumeTask(root, taskId, { sessionId: 'session-a' })
  await ledger.checkpointTask(root, taskId, first.run_id, {
    claims: [{ id: 'pending', claim: 'This claim has no evidence yet.' }],
  })

  const blocked = await ledger.closeTask(root, taskId, first.run_id, { summary: 'Blocked closeout.' })
  assert.equal(blocked.state.status, 'blocked')
  assert.equal(blocked.gate.pass, false)
  assert.match(blocked.state.blocked_reason, /Evidence gate failed/)
  assert.equal(blocked.state.lease, null, 'a blocked close still releases the lease')

  const second = await ledger.resumeTask(root, taskId, { sessionId: 'session-b' })
  const forced = await ledger.closeTask(root, taskId, second.run_id, {
    summary: 'Forced closeout.',
    force: true,
  })
  assert.equal(forced.state.status, 'done')
  const decisions = (await readFile(join(root, 'tasks', taskId, 'decisions.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.ok(decisions.some((item) => /explicit override/.test(item.decision)))
})

test('concurrency: two checkpoints on one run serialize instead of losing a write', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)
  const resumed = await ledger.resumeTask(root, taskId, { sessionId: 'session-a' })
  const versionBefore = resumed.state.version

  const results = await Promise.all([
    ledger.checkpointTask(root, taskId, resumed.run_id, { claims: [{ id: 'a', claim: 'first' }] }),
    ledger.checkpointTask(root, taskId, resumed.run_id, { claims: [{ id: 'b', claim: 'second' }] }),
  ])
  assert.equal(results.length, 2)

  const task = await ledger.readTask(root, taskId)
  assert.equal(task.state.version, versionBefore + 2, 'both writes bumped the version')
  assert.deepEqual(task.claims.map((claim) => claim.id).sort(), ['a', 'b'])
  assert.equal(task.warnings.length, 0, `corrupt JSONL lines: ${task.warnings.join('; ')}`)
})

test('derived index: concurrent regenerations all succeed and leave one complete file', async () => {
  const root = await freshRoot()
  await openTask(root, { title: 'Index race' })

  // Regression: a per-process fixed temp name made concurrent regenerations
  // collide, and every loser's rename failed with ENOENT.
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => regenerateIndex(root)))
  const rejected = results.filter((item) => item.status === 'rejected')
  assert.equal(rejected.length, 0, `concurrent INDEX.md writes failed: ${rejected.map((item) => item.reason?.code).join(', ')}`)

  const index = await readFile(join(root, 'INDEX.md'), 'utf8')
  assert.match(index, /^# Task ledger/)
  assert.match(index, /## Contract/)
})

test('run binding: resolveTaskForRun maps a run_id back to its task', async () => {
  const root = await freshRoot()
  const taskId = await openTask(root)
  const resumed = await ledger.resumeTask(root, taskId, { sessionId: 'session-a' })
  assert.equal(await ledger.resolveTaskForRun(root, resumed.run_id), taskId)
  await assert.rejects(
    ledger.resolveTaskForRun(root, 'run-00000000000000-abcdef'),
    (error) => error.code === 'run-not-found',
  )
})
