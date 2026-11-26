import test from 'node:test'
import assert from 'node:assert/strict'
import { checkDraft } from '../src/recipes/novel/craft.js'

const inspect = (text) => checkDraft({ text })
const chineseFindings = (result) => result.findings.filter(({ kind }) => kind.startsWith('zh-'))

test('中文体检：的字链与被动只报 note', () => {
  const result = inspect('他看见她的旧屋的门的把手被雪埋进墙缝。'.repeat(40))
  assert.ok(result.stats.dePer100 > 5)
  assert.ok(result.stats.beiPer100 > 1)
  assert.deepEqual(chineseFindings(result).map(({ kind, severity }) => [kind, severity]), [
    ['zh-de-density', 'note'], ['zh-bei-density', 'note'], ['zh-short-rhythm', 'note'],
  ])
})

test('中文体检：全短句各区间都有短句落点', () => {
  const result = inspect('雨停了。'.repeat(200))
  assert.equal(result.stats.short8Per200, 66.7)
  assert.ok(!chineseFindings(result).some(({ kind }) => kind === 'zh-short-rhythm'))
})

test('中文体检：不足 500 字保留读数，豁免全部四条提示', () => {
  const result = inspect('她的适应性被新机制的多维度的僵化限制。'.repeat(10))
  assert.ok(result.stats.cjk < 500)
  assert.ok(result.stats.nominalPer1k > 25)
  assert.deepEqual(chineseFindings(result), [])
})

test('中文体检：名词化密集只报 note', () => {
  const result = inspect('维度机制。'.repeat(125))
  assert.equal(result.stats.cjk, 500)
  assert.equal(result.stats.nominalPer1k, 500)
  assert.deepEqual(chineseFindings(result).map(({ kind, severity }) => [kind, severity]), [
    ['zh-nominal-density', 'note'],
  ])
})
