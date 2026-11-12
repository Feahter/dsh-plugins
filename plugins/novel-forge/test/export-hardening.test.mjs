// 导出加固回归：标题剥离、EPUB 内部不出现原始 HTML（存储型 XSS 面）。

import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { epubExport, stripChapterHeading } from '../src/recipes/novel/export.js'

/** epub-gen-memory 会把非 ASCII 转成数字实体，断言前先还原成人读文本。 */
function decodeEntities(html) {
  return String(html)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function ctxWith(chapterBody, chapterTitle = '头七') {
  const artifacts = {
    brief: { title: '长夜将明', blurb: '殡仪馆夜班' },
    outline: { chapters: [{ id: 'ch01', no: 1, title: chapterTitle }] },
    'draft/ch01': chapterBody,
  }
  return {
    params: { premise: '殡仪馆夜班' },
    has: (key) => key in artifacts,
    text: (key) => (typeof artifacts[key] === 'string' ? artifacts[key] : null),
    json: (key) => (typeof artifacts[key] === 'string' ? null : artifacts[key] ?? null),
    artifactKeys: () => Object.keys(artifacts),
  }
}

test('章节标题无论有没有井号都剥掉（否则导出双标题）', () => {
  assert.equal(stripChapterHeading('## 第1章 头七\n\n雨下得很大。'), '雨下得很大。')
  assert.equal(stripChapterHeading('第一章 头七\n\n雨下得很大。'), '雨下得很大。')
  assert.equal(stripChapterHeading('第 12 章 回门\n\n雪。'), '雪。')
  assert.equal(stripChapterHeading('雨下得很大。'), '雨下得很大。')
})

test('EPUB 正文里的裸 HTML 变成纯文本，不会进 XHTML', async () => {
  const result = await epubExport(ctxWith('雨下得很大。<script>alert(1)</script><img src=x onerror="alert(2)">'))
  const zip = await JSZip.loadAsync(result.buffer)
  const names = Object.keys(zip.files).filter((name) => name.endsWith('.xhtml') || name.endsWith('.html'))
  assert.ok(names.length > 0, 'EPUB 里应有 xhtml')
  const html = (await Promise.all(names.map((name) => zip.files[name].async('string')))).join('\n')
  assert.ok(decodeEntities(html).includes('雨下得很大'), '正文应该进了书里')
  assert.ok(!/<script/i.test(html), '不允许出现 script 标签')
  assert.ok(!/<img[^>]*onerror/i.test(html), '不允许出现带事件属性的标签')
  assert.ok(decodeEntities(html).includes('<script>'), '原样 HTML 应作为文本保留，而不是被执行')
})

test('章节标题里的尖括号同样被转义', async () => {
  const result = await epubExport(ctxWith('正文。', '<b>头七</b>'))
  const zip = await JSZip.loadAsync(result.buffer)
  const names = Object.keys(zip.files).filter((name) => name.endsWith('.xhtml'))
  const html = (await Promise.all(names.map((name) => zip.files[name].async('string')))).join('\n')
  assert.ok(!/<b>头七<\/b>/.test(html), '标题里的标签不应原样输出')
})
