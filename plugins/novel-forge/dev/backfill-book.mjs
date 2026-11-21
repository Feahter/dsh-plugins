#!/usr/bin/env node
// Rebuild an existing book from its project artifacts without starting a run.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/forge/store.js'
import { bookDirectory, updateBookRepository } from '../src/forge/bookrepo.js'
import { renderBook } from '../src/recipes/novel/bookmirror.js'

async function main() {
  const [id, ...rest] = process.argv.slice(2)
  if (!id || rest.length) {
    console.error('用法：node dev/backfill-book.mjs <projectId>')
    process.exitCode = 1
    return
  }
  const store = new Store(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'novel-forge'))
  const project = await store.readProject(id)
  if (project.recipe !== 'novel') throw new Error('项目不是小说配方')
  if (project.activeRunId) throw new Error('请在项目停止运行后回填书稿')
  const metas = project.artifacts ?? {}
  const result = await updateBookRepository({
    directory: bookDirectory(store, id),
    async render() {
      const entries = await Promise.all(Object.keys(metas).map(async (key) => [key, await store.readArtifact(id, key, undefined, metas)]))
      return renderBook(project, new Map(entries))
    },
  })
  if (result.error) process.exitCode = 2
  else console.log(`${result.committed ? '已提交' : '书稿无变更'} ${result.path}`)
}

try {
  await main()
} catch (error) {
  console.error(`回填书稿失败：${error.message}`)
  process.exitCode = 2
}
