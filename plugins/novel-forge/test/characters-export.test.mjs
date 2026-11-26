import test from 'node:test'
import assert from 'node:assert/strict'
import { renderBook } from '../src/recipes/novel/bookmirror.js'
import { createCanon, mergeCanon } from '../src/recipes/novel/canon.js'

test('characters.md exports three tiers and includes later canon characters', () => {
  const characters = { cast: [
    { name: '陆岑', role: '主角', aliases: ['陆师兄'], want: '开药铺' },
    { name: '薛云', role: '剑客', tier: 'major', pressure: '师命难违' },
  ] }
  const canon = mergeCanon(createCanon({ characters }), { entities: {
    陆岑: { aliases: ['陆药师'], firstSeen: 'ch001', role: '药师' },
    新伙计: { kind: 'character', role: '店员', firstSeen: 'ch007' },
    药铺: { kind: 'location', firstSeen: 'ch001' },
  } })
  const files = renderBook({}, new Map([['characters', { content: characters }], ['canon', { content: canon }]])).files
  const output = files.get('characters.md')
  assert.match(output, /^## 核心人物\s+### 陆岑[\s\S]*定位：主角[\s\S]*陆师兄、陆药师[\s\S]*首次出场：ch001/m)
  assert.match(output, /^## 阶段人物\s+- 薛云｜剑客｜压力：师命难违/m)
  assert.match(output, /^## 登记人物[\s\S]*\| 新伙计 \| 店员 \| ch007 \|/m)
  assert.doesNotMatch(output, /^\| 药铺 /m)
})
