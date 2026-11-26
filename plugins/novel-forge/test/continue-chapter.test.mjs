// M4「一键续写本章」：从已有正文的断点往下接，不重写整章、不续跑下一章。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ForgeEngine } from '../src/forge/engine.js'
import { createNovelRecipe } from '../src/recipes/novel/index.js'
import { statusForError } from '../src/host/json.js'
import { handle } from '../src/host/routes.js'
import { SAMPLE_PARAMS, sampleBeats, sampleOutlineV2 } from './fixtures/novel-fixtures.mjs'

const FILLER = '走廊尽头的灯一闪一闪，他数着步子往里走。'
const TAIL = '他把门推开一条缝，雨水顺着伞骨一滴一滴往下滴。'
const OVERLAP_START = '雨水顺着伞骨一滴一滴往下滴。'

function truncated(partial, detail = {}) {
  const error = new Error('模型输出被截断')
  error.code = 'LLM_TRUNCATED'
  error.detail = { maxTokens: 3520, chars: partial.length, kind: 'length', text: partial, ...detail }
  return error
}

function proseChars(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

/** outputs 只控制续写正文，记忆交给固定的假模型响应。 */
async function setup({ outputs = [], params = {}, draft = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'forge-continue-'))
  const calls = []
  const llm = {
    calls,
    async generate(options) {
      if (options.phase === 'summary') return { text: '有人在门里叫他的名字。' }
      if (options.phase === 'canonPatch') return { text: '{}' }
      calls.push(options)
      const next = outputs[Math.min(calls.length - 1, outputs.length - 1)]
      if (typeof next === 'function') return next(options)
      return { text: next ?? '' }
    },
  }
  const engine = new ForgeEngine({ root, recipes: [createNovelRecipe()], llm })
  const project = await engine.createProject({
    recipeId: 'novel',
    title: '续写试验',
    params: { ...SAMPLE_PARAMS, ...(params ?? {}) },
  })
  const outline = sampleOutlineV2({ chapters: 3 })
  await engine.writeArtifact(project.id, 'outline', { kind: 'json', content: outline })
  const chapterId = outline.chapters[0].id
  await engine.writeArtifact(project.id, `beats/${chapterId}`, { kind: 'json', content: sampleBeats(chapterId) })
  if (typeof draft === 'string') {
    await engine.writeArtifact(project.id, `draft/${chapterId}`, { kind: 'md', content: draft })
  }
  return {
    root,
    engine,
    project,
    calls,
    chapterId,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('续写接在断点后：去重叠、字数增加、draft 落成新版本', async t => {
  const draft = `## 第1章 起：雨夜\n\n${FILLER.repeat(28)}${TAIL}`
  const env = await setup({
    draft,
    outputs: [`${OVERLAP_START}门里有人叫他的名字。`],
  })
  t.after(env.cleanup)

  const result = await env.engine.continueChapter(env.project.id, env.chapterId)

  assert.equal(result.chapterId, env.chapterId)
  assert.ok(result.beforeChars > 500 && result.beforeChars < 700, `已有 ${result.beforeChars} 字`)
  assert.equal(result.beforeChars, proseChars(draft))
  assert.ok(result.afterChars > result.beforeChars, '续写后字数应增加')
  assert.equal(result.truncated, false)
  assert.equal(result.version, 2)
  assert.equal(env.calls.length, 1)

  // 重叠的开头被 trimOverlap 吃掉：末尾那句在全文里只出现一次，新句接在后面。
  assert.equal(result.text.split('雨水顺着伞骨一滴一滴往下滴').length - 1, 1)
  assert.ok(result.text.endsWith(`门里有人叫他的名字。`), result.text.slice(-40))

  const fresh = await env.engine.getProject(env.project.id)
  assert.equal(fresh.artifacts[`draft/${env.chapterId}`].version, 2)
  const written = await env.engine.getArtifact(env.project.id, `draft/${env.chapterId}`)
  assert.ok(written.content.includes('门里有人叫他的名字。'))
})

test('这一章没有正文：抛 CONFLICT，HTTP 409，消息可操作', async t => {
  const env = await setup()
  t.after(env.cleanup)

  await assert.rejects(
    () => env.engine.continueChapter(env.project.id, env.chapterId),
    error => {
      assert.equal(error.code, 'CONFLICT')
      assert.equal(statusForError(error), 409)
      assert.match(error.message, /还没有正文/)
      assert.match(error.message, /draft/)
      return true
    },
  )
  assert.equal(env.calls.length, 0)
})

test('撞一次输出上限（带 detail.text）后能接着续上', async t => {
  const draft = `## 第1章 起：雨夜\n\n${FILLER.repeat(16)}${TAIL}`
  const partial = '门里有人叫他的名字。他'
  const env = await setup({
    draft,
    outputs: [
      () => {
        throw truncated(partial)
      },
      '没有回头，只是把伞收拢。',
    ],
  })
  t.after(env.cleanup)

  const result = await env.engine.continueChapter(env.project.id, env.chapterId)

  assert.equal(env.calls.length, 2)
  assert.match(env.calls[1].user, /【续写指令】/)
  assert.match(env.calls[1].user, /--- 上文结尾 ---/)
  assert.match(env.calls[1].user, /还要写大约 \d+ 字/)
  assert.equal(result.truncated, false)
  assert.ok(result.afterChars > result.beforeChars)
  assert.ok(result.text.includes('门里有人叫他的名字'))
  assert.ok(result.text.includes('没有回头，只是把伞收拢。'))
  // 截断的残句也要接上，不能把 partial 丢掉。
  assert.ok(result.text.includes(partial))
})

test('已有正文达到目标字数：明确返回不续写，也不再调模型', async t => {
  const draft = `## 第1章 起：雨夜\n\n${FILLER.repeat(70)}`
  assert.ok(proseChars(draft) >= 1200)
  const env = await setup({ draft, outputs: ['不该被调用'] })
  t.after(env.cleanup)

  const result = await env.engine.continueChapter(env.project.id, env.chapterId)

  assert.equal(result.skipped, true)
  assert.equal(result.beforeChars, result.afterChars)
  assert.equal(result.truncated, false)
  assert.equal(result.version, null)
  assert.equal(result.text, draft.trim())
  assert.match(result.note, /达到目标/)
  assert.equal(env.calls.length, 0)
  const fresh = await env.engine.getProject(env.project.id)
  assert.equal(fresh.artifacts[`draft/${env.chapterId}`].version, 1)
})

test('续写占住项目：并发续写 / 启动流水线 / 手改产物都被 RUN_ACTIVE 挡住', async t => {
  const draft = `## 第1章 起：雨夜\n\n${FILLER.repeat(28)}${TAIL}`
  let release
  const gate = new Promise(resolve => { release = resolve })
  const env = await setup({
    draft,
    outputs: [async () => {
      await gate
      return { text: '门里有人叫他的名字。' }
    }],
  })
  t.after(env.cleanup)

  const first = env.engine.continueChapter(env.project.id, env.chapterId)
  const deadline = Date.now() + 3000
  while (env.calls.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(env.calls.length, 1, '第一枪应已发出并挂起')

  await assert.rejects(
    () => env.engine.continueChapter(env.project.id, env.chapterId),
    error => error.code === 'RUN_ACTIVE',
  )
  await assert.rejects(
    () => env.engine.startRun(env.project.id, {}),
    error => error.code === 'RUN_ACTIVE',
  )
  await assert.rejects(
    () => env.engine.writeArtifact(env.project.id, `draft/${env.chapterId}`, { kind: 'md', content: '手改' }),
    error => error.code === 'RUN_ACTIVE',
  )

  release()
  const result = await first
  assert.ok(result.afterChars > result.beforeChars)
  assert.equal(env.calls.length, 1, '锁生效后不应该有第二个模型调用')
})

test('POST /projects/:id/chapters/:chapterId/continue 分发到 engine.continueChapter', async () => {
  const response = await handle(
    {
      engine: {
        async getProject(id) {
          assert.equal(id, 'p1')
          return { id: 'p1' }
        },
        async continueChapter(projectId, chapterId) {
          assert.equal(projectId, 'p1')
          assert.equal(chapterId, 'ch 01')
          return { chapterId, beforeChars: 10, afterChars: 20, truncated: false, text: 'x', version: 2 }
        },
      },
      modelInfo: () => ({}),
    },
    { method: 'POST', path: '/projects/p1/chapters/ch%2001/continue', query: {}, body: null },
  )
  assert.equal(response.status, 200)
  assert.equal(response.body.continue.chapterId, 'ch 01')
  assert.equal(response.body.continue.version, 2)
})

test('章节不在大纲里：抛 NOT_FOUND，HTTP 404，不读也不写正文', async t => {
  const env = await setup()
  t.after(env.cleanup)

  await assert.rejects(
    () => env.engine.continueChapter(env.project.id, 'ch99'),
    error => {
      assert.equal(error.code, 'NOT_FOUND')
      assert.equal(statusForError(error), 404)
      assert.match(error.message, /大纲里没有 ch99/)
      return true
    },
  )
  assert.equal(env.calls.length, 0)
  const fresh = await env.engine.getProject(env.project.id)
  assert.equal(fresh.artifacts['draft/ch99'], undefined)
})
