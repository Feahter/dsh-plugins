// test/consistency-payoff-quality.test.mjs — C5 伏笔兑现质量（payoff-thin）。
// 判定：兑现章里线索关键词出现 ≥2 次，且至少 1 次不在引号对话里。
import test from 'node:test'
import assert from 'node:assert/strict'

import { audit } from '../src/recipes/novel/consistency.js'

const FINDING_KEYS = ['severity', 'kind', 'where', 'issue', 'fix']

function makeCanon(thread, overrides = {}) {
  return {
    version: 2,
    rules: [],
    notes: [],
    timeline: [],
    invariants: [],
    facts: [],
    threads: [thread],
    entities: {},
    ...overrides,
  }
}

function paidOffThread(text) {
  return { id: 't1', text, opened: 'ch0001', status: 'closed', closedIn: 'ch0005' }
}

function auditBody(body, thread) {
  return audit({
    chapters: [{ id: 'ch0005', text: body }],
    canon: makeCanon(thread),
  })
}

function ofKind(findings, kind) {
  return findings.filter((finding) => finding.kind === kind)
}

// ① 正常兑现：3 次里 1 次在对话、2 次在叙述 → 不报。
test('payoff-thin：兑现章关键词出现 3 次（1 次对话 + 2 次叙述）→ 不报', () => {
  const findings = auditBody(
    '他摸出青玉扳指。「青玉扳指？」她问。他又看了一眼青玉扳指。',
    paidOffThread('青玉扳指'),
  )
  assert.deepEqual(ofKind(findings, 'payoff-thin'), [])
})

// ② 只提一句 → note。
test('payoff-thin：兑现章关键词只出现 1 次 → note，issue 指出次数', () => {
  const findings = auditBody('他摸出青玉扳指。', paidOffThread('青玉扳指'))
  const hits = ofKind(findings, 'payoff-thin')
  assert.equal(hits.length, 1)
  const finding = hits[0]
  assert.deepEqual(Object.keys(finding), FINDING_KEYS)
  assert.equal(finding.severity, 'note')
  assert.equal(finding.kind, 'payoff-thin')
  assert.equal(finding.where, 'ch0005')
  assert.match(finding.issue, /「青玉扳指」只出现 1 次/)
  assert.match(finding.fix, /引号外/)
})

// ③ 出现 2 次但都在对话里 → note。
test('payoff-thin：关键词出现 2 次且都在对话里 → note', () => {
  const findings = auditBody(
    '「青玉扳指。」她说。「青玉扳指？」他问。',
    paidOffThread('青玉扳指'),
  )
  const hits = ofKind(findings, 'payoff-thin')
  assert.equal(hits.length, 1)
  assert.deepEqual(Object.keys(hits[0]), FINDING_KEYS)
  assert.match(hits[0].issue, /出现 2 次，都在对话里/)
})

// ④ 线索 text 全是虚词/元词，派生不出关键词 → 整条跳过。
test('payoff-thin：线索 text 派生不出可检索关键词 → 整条跳过', () => {
  const findings = auditBody('「青玉扳指。」她说。', paidOffThread('这个线索的了'))
  assert.deepEqual(ofKind(findings, 'payoff-thin'), [])
})

// ⑤ 与 name-drift 同章命中：选择「name-drift 优先，payoff-thin 不再叠加」。
// 沈砚在对话里出现 2 次：name-drift 命中（未登记专名），同时满足 payoff-thin 的
// 「2 次但都在对话里」。同一兑现章只保留 name-drift 一条，避免重复提醒。
test('payoff-thin：同章已有 name-drift → 不重复出 payoff-thin', () => {
  const canon = makeCanon(paidOffThread('沈砚'), {
    facts: [{ s: '林砚', p: '身份', o: '捕快', chapter: 'ch0001', status: 'canon' }],
  })
  const findings = audit({
    chapters: [{ id: 'ch0005', text: '「沈砚。」他说。「沈砚。」她又说。' }],
    canon,
  })
  const nameDrift = ofKind(findings, 'name-drift')
  assert.equal(nameDrift.length, 1)
  assert.equal(nameDrift[0].severity, 'note')
  assert.match(nameDrift[0].issue, /沈砚/)
  assert.deepEqual(ofKind(findings, 'payoff-thin'), [])
})

// 不在兑现章 / 缺正文 → 不判。
test('payoff-thin：非兑现章与缺正文都跳过', () => {
  const open = { id: 't1', text: '青玉扳指', opened: 'ch0001', status: 'open' }
  assert.deepEqual(ofKind(auditBody('青玉扳指。', open), 'payoff-thin'), [])

  const noBody = audit({
    chapters: [{ id: 'ch0005' }],
    canon: makeCanon(paidOffThread('青玉扳指')),
  })
  assert.deepEqual(ofKind(noBody, 'payoff-thin'), [])
})
