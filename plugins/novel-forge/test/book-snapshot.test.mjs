import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ForgeEngine } from '../src/forge/engine.js'
import { bookDirectory, updateBookRepository } from '../src/forge/bookrepo.js'
import { renderBook } from '../src/recipes/novel/bookmirror.js'
import { handle } from '../src/host/routes.js'

const md = (content) => ({ kind: 'md', content })
const json = (content) => ({ kind: 'json', content })
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
const rows = [
  { id: 'ch01', index: 1, title: '归零', goal: '找到旧钥匙', conflict: '门锁了', hook: '敲门声' },
  { id: 'ch02', index: 2, title: '夜话' },
]
const outline = { totalChapters: 3, volumes: [
  { id: 'v2', index: 2, title: '终卷', targetChapters: 1, chapterIds: [] },
  { id: 'v1', index: 1, title: '开卷', targetChapters: 2, chapterIds: ['ch01', 'ch02'] },
], chapters: [...rows].reverse() }
const artifacts = new Map([
  ['brief', json({ title: '长夜', logline: '听亡者说话' })],
  ['pitch', json({ channel: '男频', sellingPoint: '殡仪馆夜班' })],
  ['bible', md('# 停尸间\n\n设定原文。\n\n')],
  ['characters', json({ cast: [{ name: '小林', role: '主角', gender: '女', want: '离开', need: '查明真相', wound: '失亲', lie: '不能信任他人', relations: [{ to: '小吴', kind: '旧友' }] }] })],
  ['outline', json(outline)],
  ['draft/ch02', md('第二章 夜话\n\n灯灭了。')],
  ['draft/ch01', md('# 第一章 归零\n\n门开了。\n<<<SUMMARY>>>\n不会出现在正文。')],
  ['canon', json({ version: 2, facts: [{ s: '小林', p: '获得', o: '钥匙' }], threads: [{ id: 't1', text: '钥匙来源', status: 'open' }, { id: 't2', text: '已经回收', status: 'closed' }], timeline: [{ chapter: 'ch01', when: '凌晨', event: '打开门' }] })],
])

async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'novel-book-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

const commits = (book) => git(book, 'log', '--format=%s').split('\n')

test('R1 只初始化 book/，重复写入无提交，排除运行态与 .DS_Store', async (t) => {
  const project = await temp(t)
  await writeFile(join(project, 'project.json'), '{}')
  await mkdir(join(project, 'runs'))
  await mkdir(join(project, 'artifacts'))
  const directory = join(project, 'book')
  const run = () => updateBookRepository({ directory, render: () => renderBook({ title: '长夜' }, new Map()) })
  assert.equal((await run()).committed, true)
  await access(join(directory, '.git'))
  await writeFile(join(directory, '.DS_Store'), 'local metadata')
  assert.equal((await run()).committed, false)
  assert.equal(git(directory, 'rev-parse', '--show-toplevel'), await realpath(directory))
  assert.equal(git(directory, 'status', '--porcelain'), '')
  assert.deepEqual(git(directory, 'ls-files').split('\n'), ['.gitignore', 'README.md'])
  assert.equal(commits(directory).length, 1)
})

test('R2 从 fixture 渲染可读 Markdown，章节目录、骨架与 MD5 稳定', async (t) => {
  const directory = join(await temp(t), 'book')
  const project = { title: '长夜', params: { genre: '悬疑', chapters: 3 } }
  const render = () => renderBook(project, artifacts)
  const files = [...render().files.keys()].sort()
  assert.deepEqual(files, ['README.md', 'bible.md', 'canon.md', 'chapters/0001-归零.md', 'chapters/0002-夜话.md', 'characters.md', 'outline.md'])
  const md5 = async () => {
    const bytes = await Promise.all(files.map((path) => readFile(join(directory, path))))
    return createHash('md5').update(Buffer.concat(bytes)).digest('hex')
  }
  assert.equal((await updateBookRepository({ directory, render })).committed, true)
  const before = await md5()
  assert.equal((await updateBookRepository({ directory, render })).committed, false)
  assert.equal(await md5(), before)
  const read = (path) => readFile(join(directory, path), 'utf8')
  const readme = await read('README.md')
  assert.equal(readme.match(/^\| \d+ \|/gm).length, 3)
  assert.match(readme, /殡仪馆夜班[\s\S]*悬疑[\s\S]*男频[\s\S]*2\/3 章/)
  assert.match(await read('outline.md'), /开卷[\s\S]*归零 \| 找到旧钥匙 \| 门锁了 \| 敲门声[\s\S]*终卷[\s\S]*第 3 章/)
  assert.equal(await read('bible.md'), artifacts.get('bible').content)
  assert.match(await read('characters.md'), /主角[\s\S]*女[\s\S]*离开[\s\S]*查明真相[\s\S]*失亲[\s\S]*信任[\s\S]*小吴：旧友/)
  const canon = await read('canon.md')
  assert.match(canon, /已确立事实[\s\S]*钥匙[\s\S]*未回收线索[\s\S]*钥匙来源[\s\S]*时间线[\s\S]*打开门/)
  assert.doesNotMatch(canon, /已经回收/)
  assert.equal(await read('chapters/0001-归零.md'), '# 第一章 归零\n\n门开了。\n')
  assert.equal(await read('chapters/0002-夜话.md'), '# 第二章 夜话\n\n灯灭了。\n')
  const spine = json({ mainline: '寻钥匙', volumes: [{ title: '骨架卷', goal: '进门' }] })
  assert.match(renderBook(project, new Map([['spine', spine]])).files.get('outline.md'), /骨架卷[\s\S]*\| 3 \| 第 3 章 \| 进门/)
})

async function engineFixture(t) {
  const root = await temp(t)
  const recipe = { id: 'novel', stages: [
    { id: 'premise', produces: ['brief', 'pitch'], run: () => ({ artifacts: { brief: artifacts.get('brief'), pitch: artifacts.get('pitch') } }) },
    { id: 'outline', produces: ['outline'], run: () => ({ artifacts: { outline: json({ chapters: rows }) } }) },
    { id: 'draft', each: 'outline.chapters', produces: ['draft/*', 'summary/*'], onItemError: 'continue', run: ({ item }) => {
      if (item.id === 'ch02') throw new Error('本章生成失败')
      return { artifacts: { [`draft/${item.id}`]: artifacts.get(`draft/${item.id}`), [`summary/${item.id}`]: md('摘要') } }
    } },
    { id: 'review', each: 'outline.chapters', produces: ['review/*'], run: ({ item }) => ({ artifacts: { [`review/${item.id}`]: json({ verdict: 'revise' }) } }) },
    { id: 'revise', each: 'outline.chapters', produces: ['draft/*'], run: ({ item }) => ({ artifacts: { [`draft/${item.id}`]: md('# 第一章 归零\n\n门又开了。') } }) },
  ] }
  const engine = new ForgeEngine({ root, recipes: [recipe] })
  const project = await engine.createProject({ recipeId: 'novel', title: '长夜' })
  const directory = bookDirectory(engine.store, project.id)
  const run = async (stage, options) => {
    const { id } = await engine.startRun(project.id, { from: stage, to: stage, ...options })
    for (let attempt = 0; attempt < 1500; attempt++) {
      const current = await engine.getRun(id)
      // endedAt 与 status 不是同一次落盘；只等 endedAt 会读到「已结束但仍 running」的中间态。
      if (current.endedAt && current.status !== 'running') return current
      await delay(10)
    }
    assert.fail(`run 未结束：${stage}`)
  }
  return { engine, project, directory, run }
}

test('R3 成功阶段和整章各提交一次，跳过 dry-run、无变化与失败章；R5 返回书目录', async (t) => {
  const { engine, project, directory, run } = await engineFixture(t)
  assert.equal((await run('premise', { dryRun: true })).status, 'done')
  await assert.rejects(access(directory), { code: 'ENOENT' })
  assert.equal((await run('premise')).status, 'done')
  assert.deepEqual(commits(directory), ['立项：长夜'])
  assert.equal((await run('premise', { force: true })).status, 'done')
  assert.equal(commits(directory).length, 1)
  assert.equal((await run('outline')).status, 'done')
  assert.equal((await run('draft')).status, 'done')
  assert.equal((await engine.getProject(project.id)).stages.draft.items.ch02, 'error')
  assert.equal((await engine.getArtifact(project.id, 'summary/ch01')).content, '摘要')
  assert.equal((await run('review', { items: ['ch01'] })).status, 'done')
  assert.equal((await run('revise', { items: ['ch01'], force: true })).status, 'done')
  assert.deepEqual(commits(directory), ['第 1 章 归零：修订（4 字）', '第 1 章 归零：审校（3 字）', '第 1 章 归零：初稿（3 字）', '章纲：1 卷 2 章', '立项：长夜'])
  const response = await handle({ engine }, { method: 'GET', path: `/projects/${project.id}` })
  assert.equal(response.body.bookPath, directory)
})

test('R4 找不到 Git 时 run 仍 done 且仅一条 warn，下个阶段补提', async (t) => {
  const { engine, project, directory, run } = await engineFixture(t)
  const path = process.env.PATH
  try {
    process.env.PATH = join(directory, 'nonexistent')
    const result = await run('premise')
    assert.equal(result.status, 'done')
    const warns = result.events.filter((event) => event.type === 'log' && event.data.level === 'warn')
    assert.equal(warns.length, 1)
    assert.match(warns[0].data.message, /书稿快照未提交.*ENOENT/)
  } finally {
    process.env.PATH = path
  }
  assert.equal((await engine.getArtifact(project.id, 'pitch')).content.sellingPoint, '殡仪馆夜班')
  assert.equal((await run('outline')).status, 'done')
  assert.deepEqual(commits(directory), ['章纲：1 卷 2 章'])
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /殡仪馆夜班/)
})

test('R4 commit 失败后保留待提文件，跳过锁与外部改动，解锁后补提', async (t) => {
  const root = await temp(t)
  const directory = join(root, 'book')
  // 注入式假 git：只让 commit 失败，其余命令照跑真 git。
  // 不用 shell 包装脚本来造失败——启动子 shell 在慢机器上会把 15s 超时打成假失败。
  let failCommit = true
  const flakyGit = async (args) => {
    if (failCommit && args.includes('commit')) {
      const error = new Error('intentional-commit-failure')
      error.stderr = 'intentional-commit-failure'
      throw error
    }
    return execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
  }
  const warnMessages = []
  const run = (title, extra) => updateBookRepository({
    directory, render: () => renderBook({ title }, artifacts), warn: (message) => warnMessages.push(message), ...extra,
  })
  assert.equal((await run('长夜', { git: flakyGit })).committed, false)
  const readme = join(directory, 'README.md')
  const original = await readFile(readme, 'utf8')
  await writeFile(join(directory, '.git', 'index.lock'), '')
  assert.equal((await run('长夜')).committed, false)
  await rm(join(directory, '.git', 'index.lock'))
  await writeFile(readme, `${original}\n外部编辑\n`)
  assert.equal((await run('长夜')).committed, false)
  assert.match(await readFile(readme, 'utf8'), /外部编辑/)
  await writeFile(readme, original)
  failCommit = false
  assert.equal((await run('长夜')).committed, true, '解锁后把待提批次补交上')
  assert.deepEqual(commits(directory), ['回填书稿：长夜'])
  assert.equal(git(directory, 'status', '--porcelain'), '')
  assert.deepEqual(warnMessages.map((message) => message.split('：').at(-1)), ['intentional-commit-failure', '书稿仓库存在 index.lock', 'README.md'])
})
