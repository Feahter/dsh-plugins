// 主题模块：纯函数测试，不需要 DOM / React。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CSS_VAR_KEYS,
  THEME_PRESETS,
  defaultCustom,
  isDarkTheme,
  isValidColor,
  normalizeTheme,
  swatchList,
  themeStyle,
} from '../client-src/theme.js'

const STRUCTURAL_KEYS = ['bg', 'card', 'line', 'text', 'textDim', 'accent', 'edge']
const TONE_KEYS = ['toneA', 'toneB', 'toneC', 'toneD', 'toneE', 'toneF']
const COLORED_PRESETS = THEME_PRESETS.filter(item => item.id !== 'auto')

const toVarName = key => '--mc-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())

// ---------------------------------------------------------------- 测试辅助
function hexToRgb(hex) {
  const digits = hex.replace('#', '')
  assert.match(digits, /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, `期望十六进制颜色，得到 ${hex}`)
  const full = digits.length === 3
    ? digits
        .split('')
        .map(char => char + char)
        .join('')
    : digits
  return [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16))
}

function relativeLuminance(color) {
  const [r, g, b] = hexToRgb(color).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

// ---------------------------------------------------------------- 预设
test('auto 是第一个预设，vars 是空对象而不是 undefined', () => {
  assert.equal(THEME_PRESETS[0].id, 'auto')
  assert.deepEqual(THEME_PRESETS[0].vars, {})
  assert.equal(Object.keys(THEME_PRESETS[0].vars).length, 0)
})

test('恰好 6 个预设，id 唯一且顺序稳定，每个都有中英文标签', () => {
  assert.equal(THEME_PRESETS.length, 6)
  const ids = THEME_PRESETS.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(ids, ['auto', 'paper', 'midnight', 'forest', 'sunset', 'indigo'])
  for (const item of THEME_PRESETS) {
    assert.equal(typeof item.label.zh, 'string')
    assert.equal(typeof item.label.en, 'string')
    assert.ok(item.label.zh.length > 0 && item.label.en.length > 0, `${item.id} 标签为空`)
  }
})

test('每个彩色预设覆盖 7 个结构色 + 6 个色调，且只落在允许的 --mc-* 键上', () => {
  const allowed = new Set(CSS_VAR_KEYS.map(toVarName))
  assert.deepEqual(THEME_PRESETS[0].vars, {})
  assert.deepEqual(themeStyle('auto'), {})
  for (const item of COLORED_PRESETS) {
    assert.deepEqual(Object.keys(item.vars).sort(), [...CSS_VAR_KEYS].sort(), `${item.id} 槽位不全`)
    for (const key of [...STRUCTURAL_KEYS, ...TONE_KEYS]) {
      assert.ok(key in item.vars, `${item.id} 缺少 ${key}`)
    }
    const style = themeStyle(item.id)
    assert.equal(Object.keys(style).length, CSS_VAR_KEYS.length, `${item.id} 输出键数不对`)
    for (const name of Object.keys(style)) {
      assert.ok(allowed.has(name), `${item.id} 产生了越界键 ${name}`)
    }
  }
})

test('预设里的每个颜色都通过 isValidColor', () => {
  for (const item of COLORED_PRESETS) {
    for (const [key, value] of Object.entries(item.vars)) {
      assert.equal(isValidColor(value), true, `${item.id}.${key}=${value} 不是合法颜色`)
    }
  }
})

// ---------------------------------------------------------------- themeStyle
test('auto 与 undefined 不产生任何覆盖', () => {
  assert.deepEqual(themeStyle('auto'), {})
  assert.deepEqual(themeStyle({ preset: 'auto' }), {})
  assert.deepEqual(themeStyle(undefined), {})
  assert.deepEqual(themeStyle({ preset: 'nope' }), {})
})

test('camelCase 映射成 --mc-tone-a / --mc-text-dim 这类键名', () => {
  const paper = THEME_PRESETS.find(item => item.id === 'paper')
  const style = themeStyle('paper')
  assert.equal(style['--mc-tone-a'], paper.vars.toneA)
  assert.equal(style['--mc-text-dim'], paper.vars.textDim)
  assert.equal(style['--mc-toneA'], undefined)
  assert.equal(style['--mc-textDim'], undefined)
  assert.equal(style['--mc-tone-f'], paper.vars.toneF)
})

test('5 套彩色预设的正文/背景对比度都 ≥ 4.5（WCAG 相对亮度）', () => {
  for (const item of COLORED_PRESETS) {
    const ratio = contrastRatio(item.vars.text, item.vars.bg)
    assert.ok(ratio >= 4.5, `${item.id} 对比度只有 ${ratio.toFixed(2)}:1`)
  }
})

test('themeStyle 的所有值都是 isValidColor 认可的合法颜色', () => {
  for (const item of THEME_PRESETS) {
    for (const [name, value] of Object.entries(themeStyle(item.id))) {
      assert.equal(isValidColor(value), true, `${item.id} ${name}=${value}`)
    }
  }
  for (const preset of ['auto', 'custom']) {
    for (const [name, value] of Object.entries(themeStyle({ preset }))) {
      assert.equal(isValidColor(value), true, `${preset} ${name}=${value}`)
    }
  }
})

test('custom 夹带额外键（如 --evil）也不会漏进 themeStyle', () => {
  const style = themeStyle({
    preset: 'custom',
    custom: { '--evil': 'x', evil: 'y', bg: '#123456' },
  })
  const allowed = new Set(CSS_VAR_KEYS.map(toVarName))
  assert.deepEqual(Object.keys(style).sort(), [...allowed].sort())
  assert.ok(!Object.keys(style).includes('--evil'))
  assert.equal(style['--mc-bg'], '#123456')
})

test('custom 主题输出全部 13 个键，没给的槽位用 defaultCustom', () => {
  const style = themeStyle({ preset: 'custom', custom: { bg: '#123456' } })
  assert.equal(Object.keys(style).length, 13)
  assert.equal(style['--mc-bg'], '#123456')
  assert.equal(style['--mc-card'], defaultCustom().card)
})

// ---------------------------------------------------------------- 明暗判断
test('isDarkTheme：midnight 深、paper 浅、auto 交给宿主', () => {
  assert.equal(isDarkTheme('midnight'), true)
  assert.equal(isDarkTheme('paper'), false)
  assert.equal(isDarkTheme('auto'), false)
  assert.equal(isDarkTheme(undefined), false)
  for (const item of COLORED_PRESETS) {
    assert.equal(isDarkTheme(item.id), relativeLuminance(item.vars.bg) < 0.45, `${item.id} 明暗判断不符`)
  }
})

// ---------------------------------------------------------------- normalizeTheme
test('normalizeTheme 兜底：undefined / 未知预设 / custom 补默认值 / 字符串 id', () => {
  assert.deepEqual(normalizeTheme(undefined), { preset: 'auto' })
  assert.deepEqual(normalizeTheme(null), { preset: 'auto' })
  assert.deepEqual(normalizeTheme({ preset: 'nope' }), { preset: 'auto' })
  assert.deepEqual(normalizeTheme('garbage'), { preset: 'auto' })
  assert.deepEqual(normalizeTheme({ preset: 'paper' }), { preset: 'paper' })
  assert.deepEqual(normalizeTheme({ preset: 'custom' }), { preset: 'custom', custom: defaultCustom() })
  assert.deepEqual(normalizeTheme('custom'), { preset: 'custom', custom: defaultCustom() })
})

test('custom 里的非法颜色（CSS 注入串）被丢弃并回落到 defaultCustom', () => {
  const normalized = normalizeTheme({
    preset: 'custom',
    custom: {
      bg: 'red; background:url(x)',
      text: 'url(x)',
      accent: '#12',
      line: 'rgb(1,2)',
      card: 'var(--evil)',
    },
  })
  const defaults = defaultCustom()
  assert.equal(normalized.preset, 'custom')
  for (const key of ['bg', 'text', 'accent', 'line', 'card']) {
    assert.equal(normalized.custom[key], defaults[key], `${key} 没有回落默认值`)
  }
  assert.ok(!JSON.stringify(normalized).includes('url('))
})

test('custom 保留合法颜色原值', () => {
  const normalized = normalizeTheme({ preset: 'custom', custom: { text: '#123456', accent: '#AaBbCc' } })
  assert.equal(normalized.custom.text, '#123456')
  assert.equal(normalized.custom.accent, '#AaBbCc')
  assert.equal(themeStyle(normalized)['--mc-text'], '#123456')
})

test('normalizeTheme 不修改调用方传入的对象', () => {
  const input = { preset: 'custom', custom: { bg: '#123456', '--evil': 'x' } }
  const snapshot = JSON.parse(JSON.stringify(input))
  normalizeTheme(input)
  assert.deepEqual(input, snapshot)
})

// ---------------------------------------------------------------- swatchList
test('swatchList(paper) 返回 13 行，取的是 paper 当前颜色而不是默认色', () => {
  const paper = THEME_PRESETS.find(item => item.id === 'paper')
  const swatches = swatchList('paper')
  assert.equal(swatches.length, 13)
  assert.deepEqual(swatches.map(item => item.key), CSS_VAR_KEYS)
  for (const swatch of swatches) {
    assert.equal(swatch.value, paper.vars[swatch.key], `${swatch.key} 取错了颜色`)
    assert.ok(swatch.label.zh && swatch.label.en, `${swatch.key} 缺标签`)
  }
  assert.equal(swatches[0].label.zh, '背景')
  assert.equal(swatches[0].label.en, 'Background')
  assert.notEqual(swatches.find(item => item.key === 'bg').value, defaultCustom().bg)
})

test('swatchList(auto) 用默认自定义色作为编辑起点', () => {
  const defaults = defaultCustom()
  const swatches = swatchList('auto')
  assert.equal(swatches.length, 13)
  for (const swatch of swatches) {
    assert.equal(swatch.value, defaults[swatch.key])
  }
})

// ---------------------------------------------------------------- isValidColor
test('isValidColor 放行 #rgb / #rrggbb / #rrggbbaa / rgb() / hsl()', () => {
  const valid = [
    '#abc',
    '#aabbcc',
    '#AABBCCDD',
    'rgb(1,2,3)',
    'rgba(1, 2, 3, .5)',
    'rgb(1 2 3 / 50%)',
    'hsl(200 50% 40%)',
    'hsla(200, 50%, 40%, 0.5)',
    '  #abc  ',
  ]
  for (const value of valid) assert.equal(isValidColor(value), true, value)
})

test('isValidColor 拒绝具名色、url()、残缺值与注入串', () => {
  const invalid = [
    'red',
    'url(x)',
    '#12',
    'rgb(1,2)',
    '',
    'var(--x)',
    '#ggg',
    'rgb(1,2,3); background:url(x)',
    '#abc;color:red',
    null,
    42,
  ]
  for (const value of invalid) assert.equal(isValidColor(value), false, String(value))
})

// ---------------------------------------------------------------- 导出面 / 纯洁性
test('模块只导出约定的 8 个 API', async () => {
  const module = await import('../client-src/theme.js')
  assert.deepEqual(Object.keys(module).sort(), [
    'CSS_VAR_KEYS',
    'THEME_PRESETS',
    'defaultCustom',
    'isDarkTheme',
    'isValidColor',
    'normalizeTheme',
    'swatchList',
    'themeStyle',
  ])
})

test('defaultCustom 每次都是新对象，主题计算不改写预置数据', () => {
  const first = defaultCustom()
  first.bg = '#000000'
  assert.equal(defaultCustom().bg, '#f7f8fa')

  const before = JSON.stringify(THEME_PRESETS)
  themeStyle('paper')
  swatchList('midnight')
  isDarkTheme('indigo')
  normalizeTheme({ preset: 'custom', custom: { bg: '#111111' } })
  assert.equal(JSON.stringify(THEME_PRESETS), before)
})
