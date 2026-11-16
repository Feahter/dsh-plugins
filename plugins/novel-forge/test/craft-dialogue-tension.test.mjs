import test from 'node:test'
import assert from 'node:assert/strict'
import { checkDraft } from '../src/recipes/novel/craft.js'

const PARAMS = { wordsPerChapter: 3000 }
const TURN = '我今天不想回去这件事我已经想了很久'.repeat(5) // 85 个汉字

function hasKind(result, kind) {
  return result.findings.some((finding) => finding.kind === kind)
}

function findingOf(result, kind) {
  return result.findings.find((finding) => finding.kind === kind)
}

function dialogue(count, { questions = 0, narrationEvery = 0 } = {}) {
  const turns = Array.from({ length: count }, (_, index) => {
    const question = index < questions ? '你为什么不走？' : ''
    return `「${question}${TURN}」`
  })
  return turns.join(narrationEvery ? '\n他抬头看了她一眼。\n' : '\n')
}

test('turnCount / avgTurnLen / questionRatio / actionBetweenRatio 按引号段计算', () => {
  const text = '「今天走吗？」\n他点头。\n「明天呢？」\n「不走。」'
  const { stats } = checkDraft({ text, params: PARAMS })
  assert.equal(stats.turnCount, 3)
  assert.equal(stats.avgTurnLen, 3)
  // 前两轮含疑问（吗/呢），第三轮是陈述
  assert.equal(stats.questionRatio, 0.667)
  // 只有第 1、2 轮之间夹了「他点头」，第 2、3 轮之间只有换行
  assert.equal(stats.actionBetweenRatio, 0.5)
  assert.equal(stats.cjk, 12)
})

test('没有对话时四个字段归零', () => {
  const { stats } = checkDraft({ text: '他走进屋子，看了她一眼。', params: PARAMS })
  assert.equal(stats.turnCount, 0)
  assert.equal(stats.avgTurnLen, 0)
  assert.equal(stats.questionRatio, 0)
  assert.equal(stats.actionBetweenRatio, 0)
})

test('dialogue-flat：≥8 轮且轮间叙事 < 0.25 → note，四要素齐全', () => {
  const text = dialogue(10, { questions: 2 })
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.turnCount, 10)
  assert.equal(result.stats.actionBetweenRatio, 0)
  assert.equal(result.stats.questionRatio, 0.2)
  const finding = findingOf(result, 'dialogue-flat')
  assert.ok(finding, '应触发 dialogue-flat')
  assert.equal(finding.severity, 'note')
  assert.equal(finding.where, '全章')
  assert.match(finding.issue, /10 轮/)
  assert.match(finding.issue, /低于 0\.25/)
  assert.ok(finding.fix.length > 0)
  // 疑问占比 0.2 ≥ 0.15，不该顺手报 no-question
  assert.ok(!hasKind(result, 'dialogue-no-question'))
})

test('dialogue-no-question：≥8 轮且疑问占比 < 0.15 → note，四要素齐全', () => {
  const text = dialogue(10, { questions: 1, narrationEvery: 1 })
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.turnCount, 10)
  assert.equal(result.stats.questionRatio, 0.1)
  assert.equal(result.stats.actionBetweenRatio, 1)
  const finding = findingOf(result, 'dialogue-no-question')
  assert.ok(finding, '应触发 dialogue-no-question')
  assert.equal(finding.severity, 'note')
  assert.equal(finding.where, '全章')
  assert.match(finding.issue, /10 轮/)
  assert.match(finding.issue, /低于 0\.15/)
  assert.ok(finding.fix.length > 0)
  assert.ok(!hasKind(result, 'dialogue-flat'))
})

test('actionBetweenRatio 恰好 0.25 不触发 dialogue-flat（严格小于）', () => {
  // 9 轮 8 个轮间空隙，其中 2 个夹叙事 → 0.25；每轮加长保证 ≥800 字，让门槛真正生效
  const longTurn = TURN.repeat(2)
  const turns = Array.from({ length: 9 }, () => `「${longTurn}」`)
  const text = turns
    .map((turn, index) => {
      if (index === 0) return turn
      return (index <= 2 ? '\n他抬头看了她一眼。\n' : '\n') + turn
    })
    .join('')
  const result = checkDraft({ text, params: PARAMS })
  assert.ok(result.stats.cjk >= 800)
  assert.equal(result.stats.turnCount, 9)
  assert.equal(result.stats.actionBetweenRatio, 0.25)
  assert.ok(!hasKind(result, 'dialogue-flat'))
})

test('questionRatio 恰好 0.15 不触发 dialogue-no-question（严格小于）', () => {
  const text = dialogue(20, { questions: 3 })
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.turnCount, 20)
  assert.equal(result.stats.questionRatio, 0.15)
  assert.ok(!hasKind(result, 'dialogue-no-question'))
})

test('正文 < 800 字时两条对话 note 都跳过', () => {
  const text = Array.from({ length: 20 }, () => '「走。」').join('\n')
  const result = checkDraft({ text, params: PARAMS })
  assert.equal(result.stats.turnCount, 20)
  assert.equal(result.stats.cjk, 20)
  assert.equal(result.stats.questionRatio, 0)
  assert.equal(result.stats.actionBetweenRatio, 0)
  assert.ok(!hasKind(result, 'dialogue-flat'))
  assert.ok(!hasKind(result, 'dialogue-no-question'))
})
