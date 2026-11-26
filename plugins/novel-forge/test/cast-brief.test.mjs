import test from 'node:test'
import assert from 'node:assert/strict'
import { castBriefFor, ensureVolume } from '../src/recipes/novel/chapter.js'
import { buildOutlineSkeleton } from '../src/recipes/novel/plan.js'

test('cast brief keeps every requested name, with legacy cards treated as core', () => {
  const characters = { cast: [
    { name: '韩舟', tier: 'major' },
    { name: '陆岑', role: '药师', aliases: ['陆药师'] },
    { name: '薛云', tier: 'major', recognitionTag: '蒙眼剑客' },
  ] }
  const lines = castBriefFor(characters, ['苏英', '薛云', '陆药师', '韩舟']).split('\n')
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^- 陆药师.*别名：陆岑/)
  assert.match(lines[1], /^- 薛云.*蒙眼剑客/)
  assert.match(lines[2], /^- 韩舟/)
  assert.equal(lines[3], '- 苏英（档案缺档：只写动作和功能，不要给他编人生史）')
})

test('minor detail gives way first under the 1500 character budget', () => {
  const cast = [
    ...Array.from({ length: 7 }, (_, i) => ({ name: `核心${i}`, tier: 'core', want: '主'.repeat(200) })),
    ...Array.from({ length: 2 }, (_, i) => ({ name: `阶段${i}`, tier: 'major', want: '阶'.repeat(200) })),
    { name: '小许', tier: 'minor', recognitionTag: '记'.repeat(60) },
  ]
  const names = cast.map(({ name }) => name)
  const full = castBriefFor({ cast }, names, 2000).split('\n')
  const limited = castBriefFor({ cast }, names)
  assert.equal(limited.length, 1500)
  const lines = limited.split('\n')
  assert.deepEqual(lines.slice(0, -1), full.slice(0, -1))
  assert.ok(lines.at(-1).length < full.at(-1).length)
})

test('volume expansion saves optional C3 cards and the chapter brief uses them', async () => {
  const params = { chapters: 1 }
  const outline = buildOutlineSkeleton(params)
  const candidate = { name: '阮素', role: '船工', want: '拿回船契', pressure: '船会被扣' }
  let calls = 0
  const result = await ensureVolume({ outline, params, read: () => null, llm: {
    async generate(spec) {
      calls++
      assert.match(spec.user, /newCharacters/)
      return { json: { chapters: [{ title: '过河', goal: '赎船', cast: ['阮素'] }], newCharacters: [null, candidate, { name: '阮素' }] } }
    },
  } })
  const volume = result.outline.volumes[0]
  assert.equal(calls, 1)
  assert.deepEqual(volume.newCharacters, [candidate])
  assert.equal(castBriefFor({ volume }, ['阮素']), '- 阮素（C3·本卷新增）：想要拿回船契；压着船会被扣')
  assert.match(castBriefFor({ volume, cast: [{ name: '阮素', tier: 'minor', recognitionTag: '棕蓑衣' }] }, ['阮素']), /棕蓑衣/)
})
