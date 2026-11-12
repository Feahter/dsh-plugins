// test/craft-pronoun.test.mjs — 确定性检查器的「代词一致性」规则。
import test from 'node:test'
import assert from 'node:assert/strict'

import { checkDraft } from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 1000 }

function genderFindings(input) {
  return checkDraft(input).findings.filter((finding) => finding.kind === '性别')
}

test('代词：女性主角、段内只有她、却用「他」→ 规则 1', () => {
  const findings = genderFindings({
    text: '林晚推开门，他看见屋里空无一人。',
    params: PARAMS,
    cast: [{ name: '林晚', role: '主角', gender: '女' }],
  })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].severity, 'warn')
  assert.equal(findings[0].where, '第1段')
  assert.match(findings[0].issue, /「林晚」是女/)
  assert.match(findings[0].issue, /「他」/)
  assert.match(findings[0].fix, /「他」改成「她」/)
})

test('代词：段内还有另一个男性配角姓名 → 不命中规则 1', () => {
  const findings = genderFindings({
    text: '林晚推开门，沈砚站在门口，他浑身湿透。',
    params: PARAMS,
    cast: [
      { name: '林晚', role: '主角', gender: '女' },
      { name: '沈砚', role: '配角', gender: '男' },
    ],
  })
  assert.deepEqual(findings, [])
})

test('代词：男性主角写对 → 不命中', () => {
  const findings = genderFindings({
    text: '沈砚推开门，他看见屋里空无一人。',
    params: PARAMS,
    cast: [{ name: '沈砚', role: '主角', gender: '男' }],
  })
  assert.deepEqual(findings, [])
})

test('代词：主角名 4 次、全是「他」、无「她」→ 规则 2', () => {
  const text = [
    '林晚推开门，沈砚站在窗边，他说：“你来了。”',
    '林晚没有回头，沈砚也没有动，他听见雨声。',
    '沈砚递来毛巾，林晚接过去，他忽然笑了。',
    '林晚问沈砚，他到底在等谁。',
  ].join('\n\n')
  const cast = [
    { name: '林晚', role: '主角', gender: '女' },
    { name: '沈砚', role: '配角', gender: '男' },
  ]
  const findings = genderFindings({ text, params: PARAMS, cast })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].where, '全文')
  assert.match(findings[0].issue, /整章没有出现「她」/)
  assert.match(findings[0].issue, /主角「林晚」/)

  // 修正成「她」后不再命中。
  assert.deepEqual(genderFindings({ text: text.replaceAll('他', '她'), params: PARAMS, cast }), [])
})

test('代词：不传 cast 时 findings 与带 cast 的差异只在性别条目', () => {
  const text = [
    '林晚推开门，他看见屋里空无一人。',
    '沈砚站在窗边，他听见雨声。',
    '林晚没有回头，他忽然笑了。',
  ].join('\n\n')
  const cast = [
    { name: '林晚', role: '主角', gender: '女' },
    { name: '沈砚', role: '配角', gender: '男' },
  ]
  const withCast = checkDraft({ text, params: PARAMS, cast })
  const withoutCast = checkDraft({ text, params: PARAMS })
  assert.ok(withCast.findings.some((finding) => finding.kind === '性别'))
  assert.ok(!withoutCast.findings.some((finding) => finding.kind === '性别'))
  quietCompare(withCast.findings, withoutCast.findings)

  function quietCompare(a, b) {
    const strip = (findings) => findings.filter((finding) => finding.kind !== '性别')
    assert.deepEqual(strip(a), strip(b))
  }
})

test('代词：规则 1 同类最多 3 条，且命中后不再报规则 2', () => {
  const text = [
    '林晚推开门，他看见雨。',
    '林晚坐下，他听见风。',
    '林晚抬头，他看见灯。',
    '林晚沉默，他听见钟。',
  ].join('\n\n')
  const findings = genderFindings({
    text,
    params: PARAMS,
    cast: [{ name: '林晚', role: '主角', gender: '女' }],
  })
  assert.equal(findings.length, 3)
  assert.ok(findings.every((finding) => finding.where !== '全文'))
})

test('代词：gender 为空或角色不是主角时跳过', () => {
  const text = '林晚推开门，他看见屋里空无一人。'
  assert.deepEqual(
    genderFindings({
      text,
      params: PARAMS,
      cast: [{ name: '林晚', role: '主角', gender: '' }],
    }),
    [],
  )
  assert.deepEqual(
    genderFindings({
      text,
      params: PARAMS,
      cast: [{ name: '林晚', role: '配角', gender: '女' }],
    }),
    [],
  )
})

test('代词精度：段内同时出现主角的正确代词 → 不判（作者在用两个代词指不同的人）', () => {
  const findings = genderFindings({
    text: '他回到工作台，把那本书翻过来。沈砚看着他的后背。她低头，把信封抽出来。',
    params: PARAMS,
    cast: [{ name: '沈砚', role: '主角', gender: '女' }],
  })
  assert.deepEqual(findings, [])
})

test('代词精度：相反代词在段内但不指向主角（人名不在同句）→ 不判', () => {
  const findings = genderFindings({
    text: '他手机响了，铃声是旧的座机声。他看了一眼屏幕，往门外走。沈砚只听见“月底”“再宽两天”。',
    params: PARAMS,
    cast: [{ name: '沈砚', role: '主角', gender: '女' }],
  })
  assert.deepEqual(findings, [])
})

test('代词精度：跨句主语漂移（「沈砚……。他……」）仍然判', () => {
  const findings = genderFindings({
    text: '沈砚把信封推过去。他数了三遍。沈砚没再问。他端起杯子喝了一口。',
    params: PARAMS,
    cast: [{ name: '沈砚', role: '主角', gender: '女' }],
  })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].kind, '性别')
})
