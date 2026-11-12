/**
 * 通用预算拼装器。纯函数、无 I/O、无全局状态、无业务词汇。
 *
 * 输入一组待拼片段（piece），在字符预算内按「必需 → 优先级」分配：
 * 必需片段先按自身 cap 截断并锁定；其余按 priority 升序贪心分配；
 * 仍超预算则从优先级最低的片段开始清零；最后兜底截断末尾。
 *
 * cap 与 report.slices[].chars 都按「渲染后片段」计：若存在 title，
 * `## title\n` 标题行也占字符。这样报告里的 chars 之和加分隔符恰好
 * 等于返回文本长度，调用方可直接核对。
 */

const DEFAULT_PRIORITY = 5

function normalizeBudget(value) {
  const n = Number(value)
  if (value === undefined || value === null || Number.isNaN(n)) return Infinity
  if (!Number.isFinite(n)) return Infinity
  return Math.max(0, Math.floor(n))
}

function normalizeCap(value) {
  if (value === undefined || value === null) return Infinity
  const n = Number(value)
  if (Number.isNaN(n) || !Number.isFinite(n)) return Infinity
  return Math.max(0, Math.floor(n))
}

function normalizePriority(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : DEFAULT_PRIORITY
}

function renderBlock(piece) {
  const body = piece.text === undefined || piece.text === null ? '' : String(piece.text)
  const title = piece.title === undefined || piece.title === null ? '' : String(piece.title)
  return title ? `## ${title}\n${body}` : body
}

function joinAll(entries, separator) {
  const blocks = []
  for (const entry of entries) {
    if (entry.allocated > 0) blocks.push(entry.block.slice(0, entry.allocated))
  }
  return blocks.join(separator)
}

/**
 * 拼装片段。
 * @param {{
 *   slices: Array<{name:string,title?:string,text?:string,cap?:number,priority?:number,required?:boolean}>,
 *   budget?: number,
 *   separator?: string
 * }} options
 * @returns {{text:string, report:{budget:number,used:number,hardTruncated:boolean,
 *   slices:Array<{name:string,chars:number,cap:number,allocated:number,truncated:boolean,dropped:boolean}>}}}
 */
export function assemble({ slices, budget, separator = '\n\n' } = {}) {
  const total = normalizeBudget(budget)
  const sep = typeof separator === 'string' ? separator : ''
  const list = Array.isArray(slices) ? slices : []

  const entries = list.map((piece, index) => {
    const source = piece && typeof piece === 'object' ? piece : {}
    const cap = normalizeCap(source.cap)
    const block = renderBlock(source)
    return {
      index,
      name: source.name === undefined || source.name === null ? `slice-${index}` : String(source.name),
      cap,
      priority: normalizePriority(source.priority),
      required: Boolean(source.required),
      block,
      allocated: 0,
      truncated: false,
      dropped: false,
    }
  })

  // 1. 必需片段：按 cap 截断后锁定，不参与后续压缩。
  for (const entry of entries) {
    if (!entry.required) continue
    entry.allocated = Math.min(entry.block.length, entry.cap)
    entry.truncated = entry.allocated < entry.block.length
    if (entry.allocated <= 0) entry.dropped = true
  }

  // 用当前已锁定片段占用的长度（含分隔符）计算剩余预算。
  const usedNow = () => {
    let chars = 0
    let kept = 0
    for (const entry of entries) {
      if (entry.allocated > 0) {
        chars += entry.allocated
        kept += 1
      }
    }
    return { chars, kept, withSeparators: chars + (kept > 0 ? sep.length * (kept - 1) : 0) }
  }

  // 2. 其余片段按 priority 升序（同 priority 保持输入顺序）分配。
  const rest = entries
    .filter((entry) => !entry.required)
    .sort((a, b) => (a.priority - b.priority) || (a.index - b.index))
  for (const entry of rest) {
    const state = usedNow()
    const sepCost = state.kept > 0 ? sep.length : 0
    const room = Math.max(0, total - state.withSeparators - sepCost)
    const allocated = Math.min(entry.block.length, entry.cap, room)
    if (allocated <= 0) {
      entry.dropped = true
      continue
    }
    entry.allocated = allocated
    entry.truncated = allocated < entry.block.length
  }

  let hardTruncated = false

  // 3. 仍超预算：从 priority 最大（最低）的片段开始清零。
  if (usedNow().withSeparators > total) {
    const droppable = entries
      .filter((entry) => !entry.required && entry.allocated > 0)
      .sort((a, b) => (b.priority - a.priority) || (b.index - a.index))
    for (const entry of droppable) {
      if (usedNow().withSeparators <= total) break
      entry.allocated = 0
      entry.truncated = false
      entry.dropped = true
    }
  }

  // 4. 兜底：理论上只有必需片段本身就超预算时才会走到这里。
  let text = joinAll(entries, sep)
  let guard = entries.length + 1
  while (text.length > total && guard > 0) {
    guard -= 1
    const state = usedNow()
    if (state.kept === 0) break
    let last = null
    for (const entry of entries) {
      if (entry.allocated > 0) last = entry
    }
    if (!last) break
    hardTruncated = true
    const excess = state.withSeparators - total
    if (last.allocated <= excess) {
      last.allocated = 0
      if (!last.required) last.dropped = true
      last.truncated = true
    } else {
      last.allocated -= excess
      last.truncated = true
    }
    text = joinAll(entries, sep)
  }
  text = joinAll(entries, sep)

  return {
    text,
    report: {
      budget: total,
      used: text.length,
      hardTruncated,
      slices: entries.map((entry) => ({
        name: entry.name,
        chars: entry.allocated,
        cap: entry.cap,
        allocated: entry.allocated,
        truncated: entry.truncated,
        dropped: entry.dropped,
      })),
    },
  }
}
