import test from 'node:test'
import assert from 'node:assert/strict'

import { createTools } from '../src/host/tools.js'
import { paramsDefaults } from '../src/recipes/novel/index.js'
import { MARKET_SOURCE, MARKET_YEARS } from '../src/recipes/novel/market-data.js'
import { getMarketYear, hotTags, listMarketYears, marketBrief, matchNovels } from '../src/recipes/novel/market.js'
import { createPrompts } from '../src/recipes/novel/prompts/zh.js'
import { createFakeCtx, SAMPLE_PARAMS } from './fixtures/novel-fixtures.mjs'

const TITLE = '市场坐标（起点月票年榜 2015–2026，票=付费读者投票）'

test('市场数据：12 年各有 10 部作品，书名、作者、热度主因和标签齐全', () => {
  assert.equal(Object.keys(MARKET_YEARS).length, 12)
  for (const entry of Object.values(MARKET_YEARS)) {
    assert.equal(entry.novels.length, 10)
    for (const { title, author, why, tags } of entry.novels) {
      assert.ok(title.trim() && author.trim() && why.trim())
      assert.ok(tags.length >= 2)
    }
  }
})

test('listMarketYears：12 年升序，2026 为进行中年份', () => {
  const years = listMarketYears()
  assert.equal(years.length, 12)
  assert.deepEqual(years.map(({ year }) => year), Array.from({ length: 12 }, (_, i) => 2015 + i))
  assert.deepEqual(years.at(-1), {
    year: 2026,
    progress: true,
    keywords: MARKET_YEARS[2026].keywords,
    count: 10,
  })
})

test('getMarketYear：接受数字和字符串，无效年份返回 null', () => {
  assert.equal(getMarketYear('2025'), getMarketYear(2025))
  assert.equal(getMarketYear(2025), MARKET_YEARS[2025])
  assert.equal(getMarketYear(1999), null)
  assert.equal(getMarketYear('constructor'), null)
})

test('hotTags：次数降序，同次数保持首次出现顺序', () => {
  const tags = hotTags(2025)
  assert.ok(tags.length > 0 && tags.length <= 8)
  assert.ok(tags.every(({ count }, i) => i === 0 || tags[i - 1].count >= count))
  assert.deepEqual(hotTags(2025, 3), [
    { tag: '都市', count: 2 },
    { tag: '重生', count: 2 },
    { tag: '玄幻', count: 2 },
  ])
  assert.deepEqual(hotTags(1999), [])
})

test('matchNovels：按标签重合数排序，同分按榜位排序', () => {
  assert.equal(matchNovels(2025, ['民俗灵异'])[0].title, '捞尸人')
  assert.equal(matchNovels(2025, ['民俗'])[0].title, '捞尸人')
  assert.equal(matchNovels(2026, ['民俗灵异'])[0].title, '捞尸人')
  assert.deepEqual(matchNovels(2025, ['仙侠', '群像', '长线']).map(({ rank }) => rank), [7, 5, 4])
  assert.deepEqual(matchNovels(2025, [], 2), MARKET_YEARS[2025].novels.slice(0, 2))
  assert.deepEqual(matchNovels(1999, ['仙侠']), [])
})

test('marketBrief：没有有效年份或标签时返回空串', () => {
  assert.equal(marketBrief(), '')
  assert.equal(marketBrief({ year: 1999 }), '')
})

test('marketBrief：逐行呈现 2025 年风向、前三部作品和原文口径', () => {
  const expected = [
    TITLE,
    '- 年份风向（2025）：522 万票、赛博修仙、苟道、免费女频崛起、年代文独苗 → 「一个历史级断层，加一个新造词：赛博修仙」',
    '- 头部作品（借机制，不借桥段）：《捞尸人》（纯洁滴小龙）：522万票断层第一，提前五个月锁年榜；《苟在初圣魔门当人材》（鹤守月满池）：248万票，十万均订刷新阅文纪录；《没钱修什么仙？》（熊狼狗）：赛博修仙+贷款设定，长居月票前三',
    `- 口径边界：${MARKET_SOURCE.caveat}`,
  ]
  assert.deepEqual(marketBrief({ year: 2025 }).split('\n'), expected)
})

test('marketBrief：80 字预算保留标题并以省略号结束', () => {
  const brief = marketBrief({ year: 2025 }, { maxChars: 80 })
  assert.ok(brief.length <= 80)
  assert.ok(brief.startsWith(`${TITLE}\n- 年份风向（2025）：`))
  assert.ok(brief.endsWith('…'))
})

test('marketBrief：2025 年完整段落不超过 700 字', () => {
  const brief = marketBrief({ year: 2025 }, { maxChars: 700 })
  assert.ok(brief.length <= 700)
  assert.ok(brief.endsWith(MARKET_SOURCE.caveat))
})

test('pitch：显式开启 year 才注入独立的市场坐标段落', () => {
  const { pitch } = createPrompts()
  const off = pitch(createFakeCtx({ params: { ...SAMPLE_PARAMS, marketMode: 'off', marketYear: 2025 } }))
  const on = pitch(createFakeCtx({ params: { ...SAMPLE_PARAMS, marketMode: 'year', marketYear: 2025 } }))
  assert.ok(!off.user.includes('市场坐标'))
  assert.equal(on.system, off.system)
  assert.ok(on.user.includes(`\n\n${TITLE}\n- 年份风向（2025）：`))
  assert.ok(on.user.includes('赛博修仙'))
})

test('pitch：不填 marketMode 和显式 off 的 system / user 逐字一致', () => {
  const { pitch } = createPrompts()
  const params = { ...SAMPLE_PARAMS, marketYear: 2025 }
  const defaults = pitch(createFakeCtx({ params }))
  const off = pitch(createFakeCtx({ params: { ...params, marketMode: 'off' } }))
  assert.equal(defaults.system, off.system)
  assert.equal(defaults.user, off.user)
})

test('marketBrief：只有标签时跨年份匹配并省略年份风向', () => {
  const brief = marketBrief({ tags: ['民俗灵异'] })
  const [title, works, caveat] = brief.split('\n')
  assert.equal(brief.split('\n').length, 3)
  assert.equal(title, TITLE)
  assert.ok(works.startsWith('- 头部作品（借机制，不借桥段）：《捞尸人》（纯洁滴小龙）：1–3 月与 8 月月冠'))
  assert.equal(caveat, `- 口径边界：${MARKET_SOURCE.caveat}`)
  assert.equal(marketBrief({ year: 1999, tags: ['民俗灵异'] }), brief)
})

test('marketBrief：男频和女频只改变提示，作品不按频道筛选', () => {
  const baseline = marketBrief({ year: 2025 })
  for (const channel of ['男频', '女频']) {
    const lines = marketBrief({ year: 2025, channel }).split('\n')
    const hint = lines.find(line => line.startsWith('- 频道提示：'))
    assert.ok(hint?.includes(`当前定位为${channel}`))
    assert.equal(lines.filter(line => line !== hint).join('\n'), baseline)
  }
})

test('pitch：tags 模式按新建标签匹配，0 表示不指定年份', () => {
  const { pitch } = createPrompts()
  const params = { ...SAMPLE_PARAMS, marketMode: 'tags', marketYear: 0, tags: '民俗灵异，完结仍上榜' }
  const { user } = pitch(createFakeCtx({ params }))
  assert.ok(user.includes(`\n\n${marketBrief({ tags: ['民俗灵异', '完结仍上榜'] })}\n\n`))
  assert.ok(!user.includes('年份风向'))
})

test('novel_create：工具参数包含市场坐标字段，配方默认关闭', () => {
  const { parameters } = createTools({}).find(({ name }) => name === 'novel_create')
  assert.equal(parameters.properties.marketMode.type, 'string')
  assert.deepEqual(parameters.properties.marketMode.enum, ['off', 'year', 'tags'])
  assert.equal(parameters.properties.marketYear.type, 'integer')
  assert.equal(parameters.properties.marketYear.minimum, 0)
  assert.equal(parameters.properties.marketYear.maximum, 2026)
  assert.ok(!parameters.required.includes('marketMode'))
  assert.ok(!parameters.required.includes('marketYear'))
  assert.equal(paramsDefaults.marketMode, 'off')
  assert.equal(paramsDefaults.marketYear, 0)
})
