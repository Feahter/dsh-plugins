// 客户端请求层（client-src/api.js）的错误路径回归。
// 目的：锁住「用户看到什么」——非 2xx / 网络断 / 2xx 但响应体不是 JSON / 空体 / abort。
// 只用假 fetch，不渲染、不 build、不碰宿主。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as api from '../client-src/api.js'

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const htmlResponse = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

/** 临时替换 globalThis.fetch，跑完一定还原，避免污染同进程里的其它测试。 */
async function withFetch(handler, run) {
  const saved = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await run()
  } finally {
    globalThis.fetch = saved
  }
}

test('2xx 但响应体不是 JSON：getProject 抛可读错误，不漏成 null', async () => {
  await withFetch(
    async () => htmlResponse('<html><body>spa fallback</body></html>'),
    async () => {
      await assert.rejects(
        () => api.getProject('p1'),
        (error) => {
          // 修之前：返回 null，调用方一行 data.project 就抛英文 TypeError。
          assert.notEqual(error.name, 'TypeError', `不该是引擎侧 TypeError：${error.message}`)
          assert.equal(error.code, 'BAD_RESPONSE')
          assert.equal(error.status, 200)
          assert.match(error.message, /JSON/)
          return true
        },
      )
    },
  )
})

test('2xx 但响应体不是 JSON：getArtifact 也抛 BAD_RESPONSE（章节页曾把它 catch 成空态）', async () => {
  await withFetch(
    async () => htmlResponse('<!doctype html>'),
    async () => {
      await assert.rejects(() => api.getArtifact('p1', 'draft/ch01'), { code: 'BAD_RESPONSE' })
    },
  )
})

test('2xx 但响应体不是 JSON：书架不能静默显示成空书架', async () => {
  await withFetch(
    async () => htmlResponse('not json at all'),
    async () => {
      await assert.rejects(() => api.listProjects(), { code: 'BAD_RESPONSE' })
    },
  )
})

test('空响应体（204 / 无内容）仍然返回 null：删除项目不报错', async () => {
  await withFetch(
    async () => new Response(null, { status: 204 }),
    async () => {
      assert.equal(await api.deleteProject('p1'), null)
    },
  )
})

test('非 2xx + JSON error：message 与 code 取服务端原值', async () => {
  await withFetch(
    async () => jsonResponse({ error: { code: 'RUN_ACTIVE', message: '已有运行在跑', detail: { runId: 'r1' } } }, 409),
    async () => {
      await assert.rejects(() => api.startRun('p1', { from: 'premise' }), (error) => {
        assert.equal(error.code, 'RUN_ACTIVE')
        assert.equal(error.message, '已有运行在跑')
        assert.equal(error.status, 409)
        assert.deepEqual(error.detail, { runId: 'r1' })
        return true
      })
    },
  )
})

test('非 2xx + 非 JSON 响应体：给中文兜底文案，不吐原始 HTML', async () => {
  await withFetch(
    async () => htmlResponse('<html>bad gateway</html>', 502),
    async () => {
      await assert.rejects(() => api.getProject('p1'), (error) => {
        assert.equal(error.code, 'HTTP_502')
        assert.equal(error.message, '请求失败（HTTP 502）')
        return true
      })
    },
  )
})

test('网络层失败：给出「连不上墨炉服务」而不是英文 Failed to fetch', async () => {
  await withFetch(
    async () => { throw new TypeError('Failed to fetch') },
    async () => {
      await assert.rejects(() => api.getProject('p1'), (error) => {
        assert.match(error.message, /^连不上墨炉服务：/)
        return true
      })
    },
  )
})

test('abort 原样抛出，交给调用方自己认（不当成网络失败）', async () => {
  await withFetch(
    async () => {
      const error = new Error('The operation was aborted.')
      error.name = 'AbortError'
      throw error
    },
    async () => {
      await assert.rejects(() => api.getProject('p1'), { name: 'AbortError' })
    },
  )
})

// ------------------------------------------------------------------ 章节页的静默失败
// 章节页把四个标签的产物请求全 `.catch(() => null)`，于是「宿主断了 / 响应不是 JSON」
// 和「这一章还没写」长得一模一样：用户看到的是空态而不是错误，点「继续炼」也没用。
// 组件不能在这里渲染（没有 DOM），所以按 test/wizard-source.test.mjs 的既有做法做源级断言：
// 缺产物（ARTIFACT_MISSING）要留空态，其余错误必须落进 state 并渲染出来。
const readSource = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('章节页取产物失败时不能静默显示成空态', () => {
  const chapterView = readSource('../client-src/components/ChapterView.jsx')
  assert.match(chapterView, /ARTIFACT_MISSING/, '要把「没有这个产物」和请求失败区分开')
  assert.match(chapterView, /setLoadError/, '真实错误要落进 state，不能只在 catch 里 return null')
  assert.match(chapterView, /loadError/, 'tabBody 要把这个错误渲染出来，而不是显示「还没写」')
})
