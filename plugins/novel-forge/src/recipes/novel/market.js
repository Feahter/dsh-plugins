import { MARKET_SOURCE, MARKET_YEARS } from './market-data.js'

const TITLE = '市场坐标（起点月票年榜 2015–2026，票=付费读者投票）'

export function listMarketYears() {
  return Object.values(MARKET_YEARS)
    .sort((a, b) => a.year - b.year)
    .map(({ year, progress, keywords, novels }) => ({
      year,
      progress,
      keywords: [...keywords],
      count: novels.length,
    }))
}

export function getMarketYear(year) {
  if (typeof year !== 'string' && typeof year !== 'number') return null
  const key = String(year).trim()
  return Object.hasOwn(MARKET_YEARS, key) ? MARKET_YEARS[key] : null
}

export function hotTags(year, limit = 8) {
  const entry = getMarketYear(year)
  if (!entry) return []
  const counts = new Map()
  for (const novel of entry.novels) {
    for (const tag of novel.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, limit))
}

function rankNovels(novels, tags, limit) {
  const end = Math.max(0, limit)
  if (!tags?.length) return novels.slice(0, end)
  const wanted = new Set(tags)
  return novels
    .map(novel => ({ novel, overlap: novel.tags.filter(tag => wanted.has(tag)).length }))
    .sort((a, b) => b.overlap - a.overlap || a.novel.rank - b.novel.rank)
    .slice(0, end)
    .map(({ novel }) => novel)
}

export function matchNovels(year, tags, limit = 3) {
  const entry = getMarketYear(year)
  return entry ? rankNovels(entry.novels, tags, limit) : []
}

function fitLines(lines, maxChars) {
  const budget = Math.floor(maxChars)
  if (!(budget > 0)) return ''
  let result = ''
  for (const line of lines) {
    const next = result ? `\n${line}` : line
    const remaining = budget - result.length
    if (next.length <= remaining) {
      result += next
      continue
    }
    // 空间只够换行和列表标记时，把省略号留在上一行。
    const prefix = !result || remaining > 3
      ? result + next.slice(0, remaining - 1)
      : result.slice(0, budget - 1)
    return `${prefix.trimEnd()}…`
  }
  return result
}

export function marketBrief({ year, tags, channel } = {}, { maxChars = 700 } = {}) {
  const entry = getMarketYear(year)
  if (!entry && !tags?.length) return ''

  const novels = entry
    ? matchNovels(entry.year, tags)
    : rankNovels(Object.values(MARKET_YEARS).flatMap(year => year.novels), tags, 3)
  const examples = novels.map(({ title, author, why }) => `《${title}》（${author}）：${why}`).join('；')
  const lines = [TITLE]
  if (entry) lines.push(`- 年份风向（${entry.year}）：${entry.keywords.join('、')} → 「${entry.head}」`)
  lines.push(`- 头部作品（借机制，不借桥段）：${examples}`)
  if (channel === '男频' || channel === '女频') {
    lines.push(`- 频道提示：当前定位为${channel}，样本以起点男频主榜为主。`)
  }
  lines.push(`- 口径边界：${MARKET_SOURCE.caveat}`)
  return fitLines(lines, maxChars)
}
