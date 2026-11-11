// 导出层测试：纯函数，不需要 DOM。OPML / FreeMind 用文件内的栈式解析器验格式。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPORT_FORMATS,
  escapeXml,
  filenameFor,
  renderExport,
  toFreeMind,
  toJson,
  toMarkdown,
  toOpml,
} from '../client-src/export.js'

function n(id, text, parentId = null, createdAt = '2024-01-01T00:00:00.000Z') {
  return { id, text, parentId, x: 0, y: 0, tone: 'a', source: null, createdAt }
}

function docOf(title, nodes) {
  return { id: 'doc-test', title, layout: 'tree-right', nodes }
}

function occurrences(text, needle) {
  return text.split(needle).length - 1
}

/**
 * 极简 XML 校验器：栈式匹配标签、拒绝未闭合 / 错配标签、
 * 要求属性必须带引号，返回根元素个数。
 */
function parseXml(xml) {
  const stack = []
  let rootCount = 0
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) break
    i = lt
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i)
      assert.ok(end > i, 'XML 声明没有结束')
      i = end + 2
      continue
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i)
      assert.ok(end > i, '注释没有结束')
      i = end + 3
      continue
    }
    if (xml.startsWith('</', i)) {
      const end = xml.indexOf('>', i)
      assert.ok(end > i, '闭合标签没有结束')
      const name = xml.slice(i + 2, end).trim()
      assert.ok(stack.length > 0, `多余的闭合标签 </${name}>`)
      const open = stack.pop()
      assert.equal(name, open, `标签错配：</${name}> 对应 <${open}>`)
      i = end + 1
      continue
    }

    // 找当前开标签的 >，跳过引号里的内容
    let j = i + 1
    let quote = null
    for (; j < xml.length; j += 1) {
      const ch = xml[j]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '>') break
    }
    assert.ok(j < xml.length, '开标签没有结束')

    const raw = xml.slice(i + 1, j)
    const selfClosing = raw.endsWith('/')
    const body = (selfClosing ? raw.slice(0, -1) : raw).trim()
    assert.ok(body.length > 0, '出现了空标签')

    const head = /^([A-Za-z_][\w:.-]*)([\s\S]*)$/.exec(body)
    assert.ok(head, `标签名不合法：<${body}>`)
    const name = head[1]
    const attrText = head[2]

    // 属性：必须 name="value" / name='value'，值必须带引号
    let p = 0
    while (p < attrText.length) {
      const ws = /^\s+/.exec(attrText.slice(p))
      assert.ok(ws, `<${name}> 的属性之间缺少空格`)
      p += ws[0].length
      if (p >= attrText.length) break
      const attr = /^[A-Za-z_][\w:.-]*/.exec(attrText.slice(p))
      assert.ok(attr, `<${name}> 里有不合法的属性名`)
      p += attr[0].length
      assert.equal(attrText[p], '=', `<${name}> 的属性 ${attr[0]} 缺少 =`)
      p += 1
      const q = attrText[p]
      assert.ok(q === '"' || q === "'", `<${name}> 的属性 ${attr[0]} 没有加引号`)
      const close = attrText.indexOf(q, p + 1)
      assert.ok(close > p, `<${name}> 的属性 ${attr[0]} 引号没有闭合`)
      p = close + 1
    }

    if (stack.length === 0) rootCount += 1
    if (!selfClosing) stack.push(name)
    i = j + 1
  }

  assert.equal(stack.length, 0, `还有未闭合的标签：${stack.join(',')}`)
  return rootCount
}

test('Markdown 三层树：根是 ##，子级 -，孙级缩进', () => {
  const doc = docOf('项目', [
    n('a', '根', null, '2024-01-01T00:00:00.000Z'),
    n('b', '子', 'a', '2024-01-02T00:00:00.000Z'),
    n('c', '孙', 'b', '2024-01-03T00:00:00.000Z'),
  ])
  assert.equal(toMarkdown(doc), '# 项目\n\n## 根\n  - 子\n    - 孙\n')
})

test('Markdown 同级按 createdAt 升序，同时间保持输入顺序', () => {
  const doc = docOf('顺序', [
    n('r', 'R', null, '2024-01-01T00:00:00.000Z'),
    n('late', '后', 'r', '2024-01-03T00:00:00.000Z'),
    n('early', '先', 'r', '2024-01-02T00:00:00.000Z'),
    n('tie', '同', 'r', '2024-01-02T00:00:00.000Z'),
  ])
  assert.deepEqual(toMarkdown(doc).split('\n').slice(3), ['  - 先', '  - 同', '  - 后', ''])
})

test('空文字显示为（空）', () => {
  const doc = docOf('空文字', [n('a', '', null), n('b', '   ', 'a')])
  assert.match(toMarkdown(doc), /^## （空）$/m)
  assert.match(toMarkdown(doc), /^  - （空）$/m)
})

test('escapeXml 先转 &，五个实体都对', () => {
  assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;')
  assert.equal(escapeXml('A & B <c>'), 'A &amp; B &lt;c&gt;')
  assert.equal(escapeXml(null), '')
})

test('XML 转义在 OPML 与 FreeMind 里都生效，且原文不再裸露', () => {
  const text = `A & B <c> "d" 'e'`
  const doc = docOf('转义', [n('a', text)])
  const opml = toOpml(doc)
  const mm = toFreeMind(doc)
  const escaped = 'A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;'
  assert.ok(opml.includes(escaped), 'OPML 属性应完整转义')
  assert.ok(mm.includes(escaped), 'FreeMind 属性应完整转义')
  assert.ok(!opml.includes(text), 'OPML 不应出现未转义的原文')
  assert.ok(!mm.includes(text), 'FreeMind 不应出现未转义的原文')
  assert.equal(parseXml(opml), 1)
  assert.equal(parseXml(mm), 1)
})

test('OPML 与 FreeMind 的 4 节点树都能通过栈式 XML 校验（单根、闭合、属性带引号）', () => {
  const doc = docOf('格式', [
    n('a', '顶层', null, '2024-01-01T00:00:00.000Z'),
    n('b', '小二', 'a', '2024-01-02T00:00:00.000Z'),
    n('c', '小三', 'a', '2024-01-03T00:00:00.000Z'),
    n('d', '孙', 'b', '2024-01-04T00:00:00.000Z'),
  ])
  assert.equal(parseXml(toOpml(doc)), 1, 'OPML 应只有一个根元素')
  assert.equal(parseXml(toFreeMind(doc)), 1, 'FreeMind 应只有一个根元素')
})

test('OPML 2.0 结构：版本号与每个节点一个 outline', () => {
  const doc = docOf('格式', [
    n('a', '顶层', null, '2024-01-01T00:00:00.000Z'),
    n('b', '小二', 'a', '2024-01-02T00:00:00.000Z'),
    n('c', '小三', 'a', '2024-01-03T00:00:00.000Z'),
    n('d', '孙', 'b', '2024-01-04T00:00:00.000Z'),
  ])
  const opml = toOpml(doc)
  assert.match(opml, /<opml version="2\.0">/)
  assert.equal((opml.match(/<outline\b/g) ?? []).length, doc.nodes.length)
  assert.match(opml, /<head>[\s\S]*<title>格式<\/title>[\s\S]*<\/head>/)
  assert.match(opml, /<body>[\s\S]*<\/body>/)
})

test('FreeMind：版本号、UTF-8 声明，每个节点一个 TEXT=', () => {
  const doc = docOf('格式', [
    n('a', '顶层', null, '2024-01-01T00:00:00.000Z'),
    n('b', '小二', 'a', '2024-01-02T00:00:00.000Z'),
    n('c', '小三', 'a', '2024-01-03T00:00:00.000Z'),
    n('d', '孙', 'b', '2024-01-04T00:00:00.000Z'),
  ])
  const mm = toFreeMind(doc)
  assert.ok(mm.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">'))
  assert.equal((mm.match(/\bTEXT=/g) ?? []).length, doc.nodes.length)
})

test('JSON 往返后与 doc 深度相等', () => {
  const doc = docOf('原始', [
    n('a', '带 "引号" & <符号>', null, '2024-01-01T00:00:00.000Z'),
    n('b', '子', 'a', '2024-01-02T00:00:00.000Z'),
  ])
  assert.deepEqual(JSON.parse(toJson(doc)), doc)
  assert.equal(toJson(doc), JSON.stringify(doc, null, 2))
})

test('空文档四种格式都合法', () => {
  const doc = docOf('空图', [])
  assert.equal(toMarkdown(doc), '# 空图\n\n')
  const opml = toOpml(doc)
  assert.equal(parseXml(opml), 1)
  assert.equal((opml.match(/<outline\b/g) ?? []).length, 0)
  assert.match(opml, /<body>[\s\S]*<\/body>/)
  const mm = toFreeMind(doc)
  assert.equal(parseXml(mm), 1)
  assert.equal(occurrences(mm, 'TEXT='), 0)
  assert.deepEqual(JSON.parse(toJson(doc)).nodes, [])
  for (const format of EXPORT_FORMATS) {
    const output = renderExport(doc, format.id)
    assert.equal(typeof output, 'string')
    assert.ok(output.length > 0, `${format.id} 空文档输出不应为空`)
  }
})

test('filenameFor 清洗危险字符、限长 60、空标题回退 mind-map', () => {
  assert.equal(filenameFor(docOf('a/b:c*?"<>|', []), '.md'), 'abc.md')
  assert.equal(filenameFor(docOf('x'.repeat(120), []), '.json'), `${'x'.repeat(60)}.json`)
  assert.equal(filenameFor(docOf('   ', []), '.opml'), 'mind-map.opml')
  assert.equal(filenameFor(docOf('头脑\n  风暴', []), '.md'), '头脑 风暴.md')
  assert.equal(filenameFor(docOf('a\u0001b', []), '.mm'), 'ab.mm')
  assert.equal(filenameFor({}, '.json'), 'mind-map.json')
})

test('renderExport 未知格式抛错，已知格式正确分发', () => {
  const doc = docOf('分发', [n('a', '根')])
  assert.equal(renderExport(doc, 'markdown'), toMarkdown(doc))
  assert.equal(renderExport(doc, 'opml'), toOpml(doc))
  assert.equal(renderExport(doc, 'freemind'), toFreeMind(doc))
  assert.equal(renderExport(doc, 'json'), toJson(doc))
  assert.throws(() => renderExport(doc, 'pdf'), /unknown export format: pdf/)
  assert.throws(() => renderExport(doc, undefined), /unknown export format: undefined/)
})

test('多个根都出现在顶层，并按 createdAt 排序', () => {
  const doc = docOf('多根', [
    n('r2', '第二棵', null, '2024-01-02T00:00:00.000Z'),
    n('r1', '第一棵', null, '2024-01-01T00:00:00.000Z'),
  ])
  const headings = toMarkdown(doc).split('\n').filter(line => line.startsWith('## '))
  assert.deepEqual(headings, ['## 第一棵', '## 第二棵'])

  const opml = toOpml(doc)
  assert.equal((opml.match(/<outline\b/g) ?? []).length, 2)
  const topLevel = opml.split('\n').filter(line => /^ {4}<outline\b/.test(line))
  assert.equal(topLevel.length, 2)
  assert.ok(topLevel.some(line => line.includes('text="第一棵"')))
  assert.ok(topLevel.some(line => line.includes('text="第二棵"')))
})

test('父节点缺失的孤儿升格为根；环与自引用不会死循环', () => {
  const orphanDoc = docOf('孤儿', [
    n('root', '正常根', null, '2024-01-01T00:00:00.000Z'),
    n('orphan', '孤儿', 'gone', '2024-01-02T00:00:00.000Z'),
    n('kid', '孤儿的孩子', 'orphan', '2024-01-03T00:00:00.000Z'),
  ])
  const orphanMd = toMarkdown(orphanDoc)
  assert.equal(orphanMd.split('\n').filter(line => line.startsWith('## ')).length, 2)
  assert.match(orphanMd, /^## 孤儿$/m)
  assert.match(orphanMd, /^  - 孤儿的孩子$/m)

  const cycleDoc = docOf('环', [
    n('a', 'A', 'b', '2024-01-01T00:00:00.000Z'),
    n('b', 'B', 'a', '2024-01-02T00:00:00.000Z'),
    n('self', '自己', 'self', '2024-01-03T00:00:00.000Z'),
  ])
  const cycleMd = toMarkdown(cycleDoc)
  assert.equal(cycleMd.split('\n').filter(line => line.startsWith('## ')).length, 2)
  assert.match(cycleMd, /^## A$/m)
  assert.match(cycleMd, /^  - B$/m)
  assert.match(cycleMd, /^## 自己$/m)
  assert.equal(occurrences(cycleMd, '## A'), 1)
  assert.equal(occurrences(cycleMd, '## 自己'), 1)

  const opml = toOpml(cycleDoc)
  assert.equal(parseXml(opml), 1)
  assert.equal((opml.match(/<outline\b/g) ?? []).length, 3)
  const mm = toFreeMind(cycleDoc)
  assert.equal(parseXml(mm), 1)
  assert.equal((mm.match(/\bTEXT=/g) ?? []).length, 3)
})

test('EXPORT_FORMATS 恰好四种且顺序、扩展名、MIME 与标签正确', () => {
  assert.equal(EXPORT_FORMATS.length, 4)
  assert.deepEqual(EXPORT_FORMATS.map(format => format.id), ['markdown', 'opml', 'freemind', 'json'])
  assert.deepEqual(EXPORT_FORMATS.map(format => format.ext), ['.md', '.opml', '.mm', '.json'])
  assert.deepEqual(EXPORT_FORMATS.map(format => format.mime), [
    'text/markdown;charset=utf-8',
    'text/x-opml;charset=utf-8',
    'application/x-freemind;charset=utf-8',
    'application/json;charset=utf-8',
  ])
  assert.deepEqual(EXPORT_FORMATS[0].label, { zh: 'Markdown 大纲', en: 'Markdown outline' })
  assert.deepEqual(EXPORT_FORMATS[1].label, {
    zh: 'OPML（XMind / MindNode 可导入）',
    en: 'OPML (imports into XMind / MindNode)',
  })
})
