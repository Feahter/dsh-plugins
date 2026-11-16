/**
 * 长章节的「接着写」。
 *
 * 中文长章（>1200 字）一次输出很容易撞到模型的输出上限：`finish: length`。
 * 以前这种情况直接失败，用户重跑还会在同一条上限上再撞一次——尤其是换了输出上限更低的模型时，
 * 整本书都卡在第 1 章。这里改成：把已经写出来的半截稿当作「上文」，让模型从断点继续，
 * 拼完再交给下游（摘要 / 正典补丁都有缺省补齐路径，所以截断丢掉的行内 JSON 不会丢数据）。
 *
 * 只做纯文本拼接，不认识 JSON：JSON 阶段的截断仍由 callJson 的「抬预算 + 重写」处理。
 */

const TAIL_CHARS = 600
const MIN_OVERLAP = 12
const MAX_OVERLAP = 200

/** 取正文末尾一段作为续写锚点：优先在句读/换行处起头，避免从上句中间开始。 */
export function tailOfProse(text, maxChars = TAIL_CHARS) {
  const value = String(text ?? '').trimEnd()
  if (!value) return ''
  if (value.length <= maxChars) return value
  const slice = value.slice(-maxChars)
  const cut = slice.search(/[。！？…」』”\n]/)
  if (cut >= 0 && cut + 1 < slice.length - 40) return slice.slice(cut + 1).trimStart()
  return slice.trimStart()
}

/** 模型常常忍不住把断点那句重抄一遍：把 acc 的后缀与 next 的前缀重叠部分切掉。 */
export function trimOverlap(acc, next) {
  const a = String(acc ?? '')
  const b = String(next ?? '')
  if (!a || !b) return b
  const max = Math.min(MAX_OVERLAP, a.length, b.length)
  for (let size = max; size >= MIN_OVERLAP; size -= 1) {
    if (a.slice(-size) === b.slice(0, size)) return b.slice(size)
  }
  return b
}

/** 段落之间补一个空行，避免两段黏成一行。 */
export function joinProse(acc, next) {
  const a = String(acc ?? '').trimEnd()
  const b = trimOverlap(a, next).trimStart()
  if (!a) return b
  if (!b) return a
  return `${a}\n\n${b}`
}

export function continuationNote({ tail = '', chars = 0, remaining = 0 } = {}) {
  const lines = [
    `【续写指令】上一段输出写到第 ${chars} 字时撞到了模型的输出上限，正文被截断在这个位置。`,
    '下面是已经写好的最后一段，只用来告诉你从哪里接着写：',
    '--- 上文结尾 ---',
    String(tail),
    '--- 上文结尾 ---',
    '请紧接这段之后继续写本章正文：',
    '- 从断点处直接往下写，不要重写、不要复述上面已经出现的句子，也不要写「接着上段」「续上」这类过渡语；',
    '- 保持同一视角、同一语气，人物称呼和用词跟上文一致；',
    remaining > 0
      ? `- 还要写大约 ${remaining} 字；写到本章该收的地方（章末钩子）就停，不要为凑字数硬续。`
      : '- 写到本章该收的地方（章末钩子）就停，不要为凑字数硬续。',
    '- 只输出正文，不要章节标题、序号、小结或任何解释。',
  ]
  return lines.join('\n')
}

/** 在原 prompt 末尾追加续写指令；system 与人设不动，避免风格漂移。 */
export function continuationSpec(spec, info) {
  return { ...spec, user: `${spec.user}\n\n${continuationNote(info)}` }
}

/**
 * 调一次模型；撞上限就带着半截稿续写，最多续 maxParts 次。
 * @returns {Promise<{text:string, parts:number, truncated:boolean}>} truncated 为真表示最后一次仍被截断（此时 text 是拼起来的半成品）
 */
export async function generateWithContinuation({ generate, spec, maxParts = 3, targetChars = 0, onPart } = {}) {
  if (typeof generate !== 'function') throw new TypeError('generate 必须是函数')
  if (!spec || typeof spec.user !== 'string') throw new TypeError('spec.user 必须是字符串')
  let text = ''
  let parts = 0
  for (let round = 0; round <= maxParts; round += 1) {
    const useSpec =
      round === 0
        ? spec
        : continuationSpec(spec, {
            tail: tailOfProse(text),
            chars: text.length,
            remaining: targetChars > 0 ? Math.max(0, targetChars - text.length) : 0,
          })
    parts = round + 1
    try {
      const result = await generate(useSpec)
      text = joinProse(text, String(result?.text ?? ''))
      return { text: text.trim(), parts, truncated: false }
    } catch (err) {
      if (err?.code !== 'LLM_TRUNCATED') throw err
      const partial = String(err?.detail?.text ?? '')
      // 半截都没有（比如第一枪就空）：续写没有锚点，交回上层报错。
      if (!partial.trim()) throw err
      text = joinProse(text, partial)
      if (round >= maxParts) {
        const failure = err instanceof Error ? err : new Error(String(err))
        failure.detail = { ...(failure.detail ?? {}), partialChars: text.length, partsAttempted: parts }
        failure.partialText = text
        throw failure
      }
      if (typeof onPart === 'function') onPart({ part: parts + 1, chars: text.length })
    }
  }
  throw new Error('unreachable')
}
