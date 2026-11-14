// 轻量 Markdown：按行解析成 React 元素。文本一律作为 React 文本节点输出（由 React 转义，
// 等价于手工 escape），全程不拼 innerHTML；链接只放行 http(s) 与相对路径。
import React from 'react'

const h = React.createElement
const SAFE_LINK = /^(?:https?:\/\/|\/(?!\/)|\.{0,2}\/|#)/i
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g

/** 只接受 http(s) 与相对地址；javascript: / data: 之类返回空串。 */
export function safeHref(raw) {
  const value = String(raw ?? '').trim()
  return SAFE_LINK.test(value) ? value : ''
}

function inline(text, prefix) {
  const out = []
  const pattern = new RegExp(INLINE.source, 'g')
  let last = 0
  let match
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const key = `${prefix}-${out.length}`
    if (match[1]) out.push(h('code', { key }, match[1].slice(1, -1)))
    else if (match[2]) out.push(h('strong', { key }, match[2].slice(2, -2)))
    else {
      const href = safeHref(match[5])
      out.push(href
        ? h('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, match[4])
        : match[0])
    }
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^\s*```\s*([\w+-]*)\s*$/

function isBlockStart(line) {
  return /^\s*$/.test(line) || /^\s*```/.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line)
}

export function Markdown({ text, className }) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (/^\s*$/.test(line)) { index += 1; continue }
    const fence = FENCE.exec(line)
    if (fence) {
      const code = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) { code.push(lines[index]); index += 1 }
      index += 1
      blocks.push(h('pre', { key: `f-${blocks.length}` },
        h('code', fence[1] ? { 'data-lang': fence[1] } : null, code.join('\n'))))
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(h(`h${level}`, { key: `h-${blocks.length}` }, inline(heading[2], `h${blocks.length}`)))
      index += 1
      continue
    }
    const listMatch = BULLET.exec(line) || ORDERED.exec(line)
    if (listMatch) {
      const ordered = ORDERED.test(line)
      const tag = ordered ? 'ol' : 'ul'
      const pattern = ordered ? ORDERED : BULLET
      const list = []
      while (index < lines.length) {
        const entry = pattern.exec(lines[index])
        if (!entry) break
        list.push(h('li', { key: `li-${index}` }, inline(entry[1], `li-${index}`)))
        index += 1
      }
      blocks.push(h(tag, { key: `l-${blocks.length}` }, list))
      continue
    }
    const paragraph = []
    while (index < lines.length && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    if (!paragraph.length) { index += 1; continue }
    blocks.push(h('p', { key: `p-${blocks.length}` }, inline(paragraph.join(' '), `p${blocks.length}`)))
  }
  return h('div', { className: `clib-md${className ? ` ${className}` : ''}` }, blocks)
}
