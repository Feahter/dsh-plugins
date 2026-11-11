/**
 * 引擎内部 id 生成。格式：<prefix>_<yyyyMMdd>_<4 位 base36>。
 * clock / random 可注入，便于测试。
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

const pad2 = (n) => String(n).padStart(2, '0')

/** yyyyMMdd，按本地时区。 */
export function dateStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) throw new TypeError('dateStamp 需要合法日期')
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

export function randomSuffix(length = 4, random = Math.random) {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length]
  }
  return out
}

/**
 * @param {string} prefix
 * @param {{clock?: () => Date, random?: () => number, suffixLength?: number}} [opts]
 */
export function newId(prefix, opts = {}) {
  const { clock = () => new Date(), random = Math.random, suffixLength = 4 } = opts
  const date = clock()
  return `${prefix}_${dateStamp(date)}_${randomSuffix(suffixLength, random)}`
}

export function newProjectId(opts = {}) {
  return newId('p', opts)
}

export function newRunId(opts = {}) {
  return newId('r', opts)
}
