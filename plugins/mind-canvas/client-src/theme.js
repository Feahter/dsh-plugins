// 主题：把「跟随宿主」与 5 套自带配色统一成 --mc-* 覆盖值。
// 纯模块：不 import 任何东西、不碰 DOM、不依赖 React；Node 里能直接跑，也能被 esbuild 打进浏览器端。
//
// 约定：canvas 的 CSS 读 `var(--mc-bg, var(--dsw-alias-…))`。`auto` 返回空覆盖，
// 于是明暗两种宿主主题都原样继承 DSH 的设计 token；其余 preset / custom 才落具体颜色。

/** 颜色的槽位；数组顺序就是设置面板里色板的顺序。 */
export const CSS_VAR_KEYS = [
  'bg',
  'card',
  'line',
  'text',
  'textDim',
  'accent',
  'edge',
  'toneA',
  'toneB',
  'toneC',
  'toneD',
  'toneE',
  'toneF',
]

const DEFAULT_CUSTOM = Object.freeze({
  bg: '#f7f8fa',
  card: '#ffffff',
  line: '#dfe3ea',
  text: '#1b1d22',
  textDim: '#5b626d',
  accent: '#3a5bd9',
  edge: '#c7ccd8',
  toneA: '#3a5bd9',
  toneB: '#0f8f6d',
  toneC: '#b1661b',
  toneD: '#a03a86',
  toneE: '#2f7fa8',
  toneF: '#6b5bd0',
})

/** 每个色板槽位在 UI 里的名字。 */
const SWATCH_LABELS = Object.freeze({
  bg: { zh: '背景', en: 'Background' },
  card: { zh: '卡片', en: 'Card' },
  line: { zh: '分隔线', en: 'Divider' },
  text: { zh: '文字', en: 'Text' },
  textDim: { zh: '次要文字', en: 'Muted text' },
  accent: { zh: '强调色', en: 'Accent' },
  edge: { zh: '连线', en: 'Connector' },
  toneA: { zh: '色调 A', en: 'Tone A' },
  toneB: { zh: '色调 B', en: 'Tone B' },
  toneC: { zh: '色调 C', en: 'Tone C' },
  toneD: { zh: '色调 D', en: 'Tone D' },
  toneE: { zh: '色调 E', en: 'Tone E' },
  toneF: { zh: '色调 F', en: 'Tone F' },
})

function preset(id, zh, en, vars) {
  return Object.freeze({
    id,
    label: Object.freeze({ zh, en }),
    vars: Object.freeze(vars),
  })
}

/**
 * 预置主题。第一条必须是 auto 且 vars 为空对象——空覆盖 = 完全交给宿主。
 * 每条都覆盖 13 个槽位；正文与背景的对比度在测试里按 WCAG 公式复核。
 */
export const THEME_PRESETS = Object.freeze([
  preset('auto', '跟随宿主', 'Follow app', {}),
  preset('paper', '纸墨', 'Paper', {
    bg: '#f6f3ea',
    card: '#fffdf6',
    line: '#ddd6c6',
    text: '#23211b',
    textDim: '#6b6555',
    accent: '#9a4a22',
    edge: '#c5bdab',
    toneA: '#a8552c',
    toneB: '#2e7a5e',
    toneC: '#966b16',
    toneD: '#9a3f73',
    toneE: '#2f6f96',
    toneF: '#6552b5',
  }),
  preset('midnight', '深夜', 'Midnight', {
    bg: '#101319',
    card: '#191e27',
    line: '#2a313d',
    text: '#e6eaf2',
    textDim: '#98a2b3',
    accent: '#6f8cff',
    edge: '#39424f',
    toneA: '#7d9bff',
    toneB: '#4fd1a5',
    toneC: '#e2a75c',
    toneD: '#e07ac0',
    toneE: '#56b6d8',
    toneF: '#a99bff',
  }),
  preset('forest', '森林', 'Forest', {
    bg: '#0e1a13',
    card: '#14241b',
    line: '#26382c',
    text: '#e3efe4',
    textDim: '#94a897',
    accent: '#5fbf86',
    edge: '#35493b',
    toneA: '#5fbf86',
    toneB: '#4fc3b0',
    toneC: '#d3b25f',
    toneD: '#d98ab8',
    toneE: '#6fbfd8',
    toneF: '#a8b5ff',
  }),
  preset('sunset', '落日', 'Sunset', {
    bg: '#fdf2e3',
    card: '#fffaf2',
    line: '#ecdbca',
    text: '#2e2018',
    textDim: '#7a6455',
    accent: '#c2521f',
    edge: '#ddc7b2',
    toneA: '#c2521f',
    toneB: '#2f7d63',
    toneC: '#a3781a',
    toneD: '#a63f74',
    toneE: '#2f7a9e',
    toneF: '#7357b8',
  }),
  preset('indigo', '靛蓝', 'Indigo', {
    bg: '#12142b',
    card: '#1a1d3a',
    line: '#2c3054',
    text: '#e7e9f8',
    textDim: '#9ba0c4',
    accent: '#8593ff',
    edge: '#3b4069',
    toneA: '#8b9bff',
    toneB: '#4fd6b0',
    toneC: '#e5b86a',
    toneD: '#e58ac9',
    toneE: '#63c0e0',
    toneF: '#b0a4ff',
  }),
])

const PRESET_BY_ID = new Map(THEME_PRESETS.map(item => [item.id, item]))
const KNOWN_PRESETS = new Set([...PRESET_BY_ID.keys(), 'custom'])

/** 默认的自定义配色；每次返回新对象，调用方改了也不影响下一次。 */
export function defaultCustom() {
  return { ...DEFAULT_CUSTOM }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number))
}

// ---------------------------------------------------------------- 颜色校验
// 解析得动 = 合法。只认 #rgb / #rrggbb / #rrggbbaa、rgb[a]()、hsl[a]()；
// 锚定的正则保证 `red; background:url(x)` 这类注入串一律不通过。
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
const SEP = '(?:\\s*,\\s*|\\s+)'
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_RE = new RegExp(
  '^rgba?\\(\\s*(' + NUMBER + ')(%?)' + SEP + '(' + NUMBER + ')(%?)' + SEP + '(' + NUMBER + ')(%?)' +
    '(?:\\s*[,/]\\s*(' + NUMBER + ')(%?))?\\s*\\)$',
  'i',
)
const HSL_RE = new RegExp(
  '^hsla?\\(\\s*(' + NUMBER + '(?:deg|grad|rad|turn)?)' + SEP + '(' + NUMBER + ')%' + SEP +
    '(' + NUMBER + ')%(?:\\s*[,/]\\s*(' + NUMBER + ')(%?))?\\s*\\)$',
  'i',
)

function parseHex(hex) {
  let digits = hex.slice(1)
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map(char => char + char)
      .join('')
  }
  const pair = index => Number.parseInt(digits.slice(index, index + 2), 16)
  return { r: pair(0), g: pair(2), b: pair(4) }
}

function parseRgbChannel(text, unit) {
  const value = Number(text)
  return clamp(unit === '%' ? value * 2.55 : value, 0, 255)
}

function parseHue(text) {
  const match = /(deg|grad|rad|turn)$/i.exec(text)
  const unit = match ? match[1].toLowerCase() : ''
  const base = unit ? text.slice(0, -unit.length) : text
  const value = Number(base)
  let degrees = value
  if (unit === 'grad') degrees = value * 0.9
  else if (unit === 'rad') degrees = (value * 180) / Math.PI
  else if (unit === 'turn') degrees = value * 360
  return ((degrees % 360) + 360) % 360
}

function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  let rgb
  if (sector < 1) rgb = [chroma, x, 0]
  else if (sector < 2) rgb = [x, chroma, 0]
  else if (sector < 3) rgb = [0, chroma, x]
  else if (sector < 4) rgb = [0, x, chroma]
  else if (sector < 5) rgb = [x, 0, chroma]
  else rgb = [chroma, 0, x]
  const offset = lightness - chroma / 2
  const channel = value => Math.round(clamp((value + offset) * 255, 0, 255))
  return { r: channel(rgb[0]), g: channel(rgb[1]), b: channel(rgb[2]) }
}

/** 把支持的 CSS 颜色解析成 0–255 的 rgb；不合法返回 null。alpha 不参与亮度计算。 */
function parseColor(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw.length === 0 || raw.length > 120) return null

  if (HEX_RE.test(raw)) return parseHex(raw)

  const rgb = RGB_RE.exec(raw)
  if (rgb) {
    return {
      r: parseRgbChannel(rgb[1], rgb[2]),
      g: parseRgbChannel(rgb[3], rgb[4]),
      b: parseRgbChannel(rgb[5], rgb[6]),
    }
  }

  const hsl = HSL_RE.exec(raw)
  if (hsl) {
    return hslToRgb(
      parseHue(hsl[1]),
      clamp(Number(hsl[2]), 0, 100) / 100,
      clamp(Number(hsl[3]), 0, 100) / 100,
    )
  }

  return null
}

/** WCAG 相对亮度。 */
function relativeLuminance({ r, g, b }) {
  const linear = channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * 唯一颜色闸门：接受 #rgb、#rrggbb、#rrggbbaa、rgb()/rgba()、hsl()/hsla()；
 * 其余（含具名色、url()、残缺值、注入串）一律 false。
 */
export function isValidColor(value) {
  return parseColor(value) !== null
}

// ---------------------------------------------------------------- 归一化
/**
 * undefined / 垃圾对象 / 未知 preset → { preset: 'auto' }；
 * { preset: 'custom', custom } 只保留 CSS_VAR_KEYS 里的合法颜色，缺失或非法回落 defaultCustom()。
 */
export function normalizeTheme(theme) {
  // 允许直接传 preset id（themeStyle('auto') / swatchList('paper') 这种顺手写法）。
  const raw = typeof theme === 'string' ? { preset: theme } : theme
  if (!isPlainObject(raw)) return { preset: 'auto' }

  const requested = typeof raw.preset === 'string' ? raw.preset : ''
  if (!KNOWN_PRESETS.has(requested)) return { preset: 'auto' }
  if (requested !== 'custom') return { preset: requested }

  const source = isPlainObject(raw.custom) ? raw.custom : {}
  const custom = defaultCustom()
  for (const key of CSS_VAR_KEYS) {
    const value = source[key]
    if (isValidColor(value)) custom[key] = value.trim()
  }
  return { preset: 'custom', custom }
}

function varName(key) {
  return '--mc-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())
}

function effectivePalette(normalized) {
  if (normalized.preset === 'custom') {
    return { ...defaultCustom(), ...normalized.custom }
  }
  const selected = PRESET_BY_ID.get(normalized.preset)
  return { ...defaultCustom(), ...(selected ? selected.vars : {}) }
}

// ---------------------------------------------------------------- 对外派生
/**
 * React 直接把它当 style 用：{ '--mc-bg': '#f7f8fa', … }。
 * auto（以及任何未识别主题）返回 {}，让 CSS 里的宿主 token 兜底。
 */
export function themeStyle(theme) {
  const normalized = normalizeTheme(theme)
  if (normalized.preset === 'auto') return {}

  const palette = effectivePalette(normalized)
  const style = {}
  for (const key of CSS_VAR_KEYS) {
    const value = palette[key]
    if (isValidColor(value)) style[varName(key)] = value.trim()
  }
  return style
}

/**
 * 色板编辑器用的 13 行：custom 用自定义值，其余主题用「预设覆盖在默认值上」的当前颜色。
 * auto 于是显示 defaultCustom()（宿主真实颜色拿不到，只作为编辑起点）。
 */
export function swatchList(theme) {
  const normalized = normalizeTheme(theme)
  const palette = effectivePalette(normalized)
  return CSS_VAR_KEYS.map(key => ({
    key,
    label: { ...SWATCH_LABELS[key] },
    value: palette[key],
  }))
}

/**
 * 仅用于给测试 / UI 选一个明暗提示：有效背景的相对亮度 < 0.45 即深色。
 * auto 无法判断（宿主决定），恒为 false。
 */
export function isDarkTheme(theme) {
  const normalized = normalizeTheme(theme)
  if (normalized.preset === 'auto') return false
  const background = parseColor(effectivePalette(normalized).bg)
  return background ? relativeLuminance(background) < 0.45 : false
}
