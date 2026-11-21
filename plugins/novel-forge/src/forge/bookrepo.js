// Local Git snapshots. Only this module writes the book worktree or invokes Git.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const fixedPaths = ['.gitignore', 'README.md', 'bible.md', 'characters.md', 'outline.md', 'canon.md']
const chapterPath = /^chapters\/\d{4,}-[^/\\\x00-\x1f]+\.md$/u
const managed = (path) => fixedPaths.includes(path) || chapterPath.test(path)
const split = (output) => output.split('\0').filter(Boolean)
const queues = new Map()

export function bookDirectory(store, projectId) {
  return resolve(store.projectDir(projectId), 'book')
}

async function stat(path) {
  return lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
}

async function ensureDirectory(path) {
  const info = await stat(path)
  if (!info) await mkdir(path)
  else if (!info.isDirectory()) throw new Error(`不是普通目录：${path}`)
}

function gitRunner(dir, executable) {
  // 可注入函数（测试用）：省掉一层 shell 包装，失败注入也不再依赖本机可执行位与 PATH。
  if (typeof executable === 'function') {
    return async (...args) => executable([
      '--git-dir=.git', '--work-tree=.', '-c', 'core.hooksPath=.git/novel-forge-no-hooks',
      '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', ...args,
    ], { cwd: dir })
  }
  // Inherited Git variables (including GIT_DIR and GIT_INDEX_FILE) must not redirect the snapshot.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  env.GIT_TERMINAL_PROMPT = '0'
  return async (...args) => {
    const { stdout } = await exec(executable, [
      '--git-dir=.git', '--work-tree=.', '-c', 'core.hooksPath=.git/novel-forge-no-hooks',
      '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', ...args,
    ], { cwd: dir, env, timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    return stdout
  }
}

async function readRegular(path) {
  const info = await stat(path)
  if (!info) return null
  if (!info.isFile()) throw new Error(`不是普通文件：${path}`)
  return readFile(path)
}

// Keep the last intended file versions in .git so a failed add/commit can be retried,
// while an editor's changes to those very same files still stop automatic commits.
function versions(bytes) {
  if (bytes === null) return { sha1: null, sha256: null }
  const header = `blob ${bytes.length}\0`
  return Object.fromEntries(['sha1', 'sha256'].map((algorithm) => [
    algorithm, createHash(algorithm).update(header).update(bytes).digest('hex'),
  ]))
}

async function inspect(git, dir, pending) {
  const status = split(await git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'))
  const index = new Map(split(await git('ls-files', '--stage', '-z')).map((entry) => {
    const tab = entry.indexOf('\t')
    return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')]
  }))
  const dirty = (path) => new Error(`书稿工作树有外部改动：${path}`)
  for (const path of index.keys()) if (!managed(path)) throw dirty(path)
  for (const entry of status) {
    const path = entry.slice(3)
    const known = pending[path]
    if (!managed(path) || !known || entry.slice(0, 2).includes('U')) throw dirty(path)
    const current = versions(await readRegular(join(dir, path)))
    if (!known.some((version) => version.sha1 === current.sha1)) throw dirty(path)
    if (entry[0] !== ' ' && entry[0] !== '?') {
      const [mode, hash, stage] = index.get(path) ?? []
      if ((hash && (mode !== '100644' || stage !== '0')) ||
          !known.some((version) => (version[hash?.length === 64 ? 'sha256' : 'sha1']) === (hash ?? null))) {
        throw dirty(path)
      }
    }
  }
  return { status, index }
}

async function snapshot(dir, render, executable) {
  const { files, message } = await render()
  const desired = new Map([['.gitignore', '.DS_Store\n'], ...files])
  for (const path of desired.keys()) if (!managed(path)) throw new Error(`非法书稿路径：${path}`)
  await ensureDirectory(dir)
  const gitDir = join(dir, '.git')
  const info = await stat(gitDir)
  if (info && !info.isDirectory()) throw new Error('.git 必须是书稿目录下的普通目录')
  const git = gitRunner(dir, executable)
  if (!info) await git('init', '--template=')
  if (await stat(join(gitDir, 'index.lock'))) throw new Error('书稿仓库存在 index.lock')
  const chaptersDir = join(dir, 'chapters')
  const chapters = await stat(chaptersDir)
  if (chapters && !chapters.isDirectory()) throw new Error('chapters 必须是普通目录')

  const journal = join(gitDir, 'novel-forge-pending.json')
  const scratch = join(gitDir, 'novel-forge-write.tmp')
  const raw = await readRegular(journal)
  const previous = raw ? JSON.parse(raw) : {}
  const { status, index } = await inspect(git, dir, previous)
  const pending = {}
  for (const entry of status) pending[entry.slice(3)] = previous[entry.slice(3)]
  const changes = new Map()
  for (const path of new Set([...desired.keys(), ...index.keys(), ...Object.keys(pending)])) {
    const current = await readRegular(join(dir, path))
    const next = desired.has(path) ? Buffer.from(desired.get(path)) : null
    if (current === next || (current && next && current.equals(next))) continue
    changes.set(path, next)
    pending[path] = [...new Map([
      ...(pending[path] ?? []), versions(current), versions(next),
    ].map((version) => [version.sha1, version])).values()]
  }
  if (changes.size) {
    // Record intended bytes first. A partial filesystem failure leaves recoverable work.
    await writeFile(scratch, JSON.stringify(pending), { flag: 'w' })
    await rename(scratch, journal)
    if ([...desired.keys()].some((path) => path.startsWith('chapters/'))) await ensureDirectory(chaptersDir)
    for (const [path, bytes] of changes) {
      const target = join(dir, path)
      if (bytes === null) await rm(target, { force: true })
      else {
        await writeFile(scratch, bytes, { mode: 0o644 })
        await rename(scratch, target)
      }
    }
  }
  const after = await inspect(git, dir, pending)
  if (after.status.length) {
    const paths = after.status.map((entry) => `:(literal)${entry.slice(3)}`)
    await git('add', '-A', '--', ...paths)
    await inspect(git, dir, pending)
    await git('-c', 'user.name=墨炉', '-c', 'user.email=novel-forge@localhost',
      '-c', 'commit.gpgSign=false', 'commit', '-m', message)
  }
  if (raw || changes.size) await rm(journal, { force: true })
  return { path: dir, committed: after.status.length > 0 }
}

/** Serialize the whole snapshot per book and downgrade all snapshot errors to one warning. */
export async function updateBookRepository({ directory, render, warn = console.warn, git = 'git' }) {
  const dir = resolve(directory)
  const run = (queues.get(dir) ?? Promise.resolve()).then(async () => {
    try {
      return await snapshot(dir, render, git)
    } catch (error) {
      const detail = String(error.stderr?.trim() || error.message).slice(0, 1000)
      try { await warn(`书稿快照未提交：${detail}`) } catch { /* logging must not interrupt writing */ }
      return { path: dir, committed: false, error: detail }
    }
  })
  queues.set(dir, run)
  try {
    return await run
  } finally {
    if (queues.get(dir) === run) queues.delete(dir)
  }
}
