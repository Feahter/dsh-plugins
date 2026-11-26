import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyCanon, entityOf, mergeCanon } from '../src/recipes/novel/canon.js'

test('a registered alias writes back to the original canon entity', () => {
  const before = mergeCanon(emptyCanon(), { entities: { 陆岑: { aliases: ['陆药师'] } } })
  const canon = mergeCanon(before, { entities: { 陆药师: { state: '受伤', lastSeen: 'ch007' } } })
  assert.deepEqual(Object.keys(canon.entities), ['陆岑'])
  const { name, entity } = entityOf(canon, '陆药师')
  assert.equal(name, '陆岑')
  assert.equal(entity.displayName, '陆岑')
  assert.equal(entity.state, '受伤')
  assert.equal(entity.lastSeen, 'ch007')
  assert.deepEqual(entity.aliases, ['陆药师', '陆岑'])
})

test('shared aliases and matching display names do not join existing entities', () => {
  const canon = { entities: {
    甲: { displayName: '陆岑', aliases: ['陆药师'] },
    乙: { displayName: '陆岑', aliases: ['陆药师'] },
  } }
  assert.equal(entityOf(canon, '陆药师'), null)
  assert.equal(entityOf(canon, '陆岑'), null)
  const next = mergeCanon(canon, { entities: { 乙: { state: '受伤' } } })
  assert.equal(next.entities.甲.state, undefined)
  assert.equal(next.entities.乙.state, '受伤')
})
