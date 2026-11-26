import test from 'node:test'
import assert from 'node:assert/strict'
import { commitChapter, prepareChapter } from '../src/recipes/novel/chapter.js'
import { createCanon, entityOf } from '../src/recipes/novel/canon.js'
import { buildOutlineSkeleton, mergeVolumeChapters } from '../src/recipes/novel/plan.js'

test('verified appearances drive return hints at six chapters and ignore current or later entries', async () => {
  const params = { chapters: 8, chaptersPerVolume: 8 }
  const outline = mergeVolumeChapters(buildOutlineSkeleton(params), 'v01', Array.from({ length: 8 }, (_, i) => ({
    title: `第${i + 1}章`, goal: '探访', conflict: '门关着', turn: '开门', hook: '敲门', cast: ['陆药师', '没有出场'],
  })))
  const characters = { cast: [{ name: '陆岑', aliases: ['陆药师'], recognitionTag: '旧药箱' }] }
  const beats = { cast: ['新伙计'], scenes: [{ goal: '开门' }] }
  let canon = createCanon({ characters })
  const read = (key) => key === 'canon' ? canon : key === 'characters' ? characters : key.startsWith('beats/') ? beats : null
  const id = (number) => outline.chapters[number - 1].id
  const commit = (number) => commitChapter({
    read, params, outline, chapterId: id(number), text: '陆岑提着旧药箱。新伙计把门拉开，身后是路人甲。',
    canonPatch: { entities: { 没有出场: { lastSeen: id(number) } } },
  }).canon
  canon = commit(1)
  assert.deepEqual(entityOf(canon, '陆药师').entity.appearances, [id(1)])
  assert.deepEqual(canon.entities.新伙计.appearances, [id(1)])
  assert.equal(canon.entities.没有出场.lastSeen, '')
  assert.equal(canon.entities.路人甲, undefined)
  const prepare = (number) => prepareChapter({ read, params, outline, chapterId: id(number) })
  const sixth = await prepare(6)
  assert.doesNotMatch(sixth.packet.text, /再登场提示/)
  assert.match(sixth.packet.text, /- 新伙计\n/)
  canon = commit(8)
  canon = commit(7)
  canon = commit(7)
  const land = entityOf(canon, '陆药师').entity
  assert.deepEqual(land.appearances, [id(1), id(8), id(7)])
  assert.equal(land.firstSeen, id(1))
  assert.equal(land.lastSeen, id(8))
  const seventh = await prepare(7)
  assert.match(seventh.packet.text, /再登场提示：陆药师 已 6 章未出场.*旧药箱/)
})
