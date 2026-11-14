import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ASK_BELOW,
  isNewIntent,
  isResumeIntent,
  normalizeUtterance,
  planRoute,
  resolveOrdinal,
  resumeTopic,
  scoreTitle,
  spokenConfirmation,
  tokenize,
} from '../host/router.js'

const NOW = Date.parse('2026-11-14T00:00:00+08:00')
const HOUR = 60 * 60 * 1000

/** @type {import('../host/router.js').SessionRow[]} */
const SESSIONS = [
  { sessionId: 's-voice', title: '语音插件 骨架', updatedAt: NOW - 1 * HOUR, cwd: '/w' },
  { sessionId: 's-plugin', title: '插件优化：TTS 与抓取', updatedAt: NOW - 3 * HOUR, cwd: '/w' },
  { sessionId: 's-old', title: '季度报表', updatedAt: NOW - 200 * HOUR, cwd: '/w' },
  { sessionId: 's-blank', title: '', updatedAt: NOW - 2 * HOUR, cwd: '/w', blank: true },
  { sessionId: 's-archived', title: '语音插件 归档的旧版', updatedAt: NOW - 2 * HOUR, cwd: '/w' },
]

test('normalizeUtterance folds full-width punctuation and case', () => {
  assert.equal(normalizeUtterance('  继续，插件优化！ '), '继续 插件优化')
  assert.equal(normalizeUtterance('Continue  TTS'), 'continue tts')
})

test('tokenize keeps latin words and CJK bigrams, drops fillers', () => {
  const tokens = tokenize('继续插件优化，把 TTS 加上')
  assert.ok(tokens.includes('插件'))
  assert.ok(tokens.includes('tts'))
  assert.ok(!tokens.includes('继续'), 'filler verb must not become a token')
})

test('scoreTitle prefers the title that explains the utterance', () => {
  const tokens = tokenize('插件优化那个')
  const good = scoreTitle('插件优化：TTS 与抓取', tokens)
  const poor = scoreTitle('季度报表', tokens)
  assert.ok(good > 0.5, `expected strong match, got ${good}`)
  assert.equal(poor, 0)
})

test('explicit new-session wording wins over everything', () => {
  assert.equal(isNewIntent('新开一个'), true)
  assert.equal(isNewIntent('开个新的吧'), true)
  assert.equal(isNewIntent('继续插件优化'), false)
  const plan = planRoute({ utterance: '新开一个，写周报', sessions: SESSIONS, now: NOW })
  assert.equal(plan.action, 'new')
  assert.equal(plan.confidence, 1)
})

test('a clear title match routes without asking', () => {
  const plan = planRoute({ utterance: '语音插件那个骨架继续弄', sessions: SESSIONS, archivedIds: ['s-archived'], now: NOW })
  assert.equal(plan.action, 'resume')
  assert.equal(plan.sessionId, 's-voice')
  assert.ok(plan.confidence >= ASK_BELOW)
})

test('archived Sessions are never a target', () => {
  const plan = planRoute({ utterance: '打开语音插件归档的旧版', sessions: SESSIONS, archivedIds: ['s-archived'], now: NOW })
  assert.notEqual(plan.sessionId, 's-archived')
})

test('blank untitled Sessions are not offered', () => {
  const plan = planRoute({ utterance: '继续', sessions: SESSIONS, now: NOW })
  assert.notEqual(plan.sessionId, 's-blank')
  assert.ok(!plan.candidates.some((candidate) => candidate.sessionId === 's-blank'))
})

test('two titles matching equally ask instead of guessing', () => {
  const sessions = [
    { sessionId: 'a', title: '语音插件 A', updatedAt: NOW - HOUR, cwd: '/w' },
    { sessionId: 'b', title: '语音插件 B', updatedAt: NOW - 2 * HOUR, cwd: '/w' },
  ]
  const plan = planRoute({ utterance: '语音插件那个', sessions, now: NOW })
  assert.equal(plan.action, 'ask')
  assert.equal(plan.sessionId, null)
  assert.ok(plan.confidence < ASK_BELOW)
  assert.equal(plan.candidates.length, 2)
})

test('"continue" wording with no topic lands on the most recent Session', () => {
  const plan = planRoute({ utterance: '继续，加个功能', sessions: SESSIONS, now: NOW })
  assert.equal(plan.action, 'resume')
  assert.equal(plan.sessionId, 's-voice')
})

test('a topic in the utterance outranks the generic "continue" verb', () => {
  // "TTS" is real signal: a Session titled with TTS is a better target than
  // whichever Session merely happens to be the most recent.
  const plan = planRoute({ utterance: '继续，把 TTS 加上', sessions: SESSIONS, now: NOW })
  assert.equal(plan.action, 'resume')
  assert.equal(plan.sessionId, 's-plugin')
  assert.match(plan.reason, /title matches/)
})

test('no signal at all stays in the current Session', () => {
  const plan = planRoute({ utterance: '把日志目录清一下', sessions: SESSIONS, currentSessionId: 's-plugin', now: NOW })
  assert.equal(plan.action, 'resume')
  assert.equal(plan.sessionId, 's-plugin')
  assert.match(plan.reason, /current Session/)
  // Filler-only utterances tokenize to nothing, so they cannot accidentally match a title.
  assert.equal(tokenize('把日志目录清一下').length > 0, true)
})

test('empty utterance asks with zero confidence', () => {
  const plan = planRoute({ utterance: '   ', sessions: SESSIONS, now: NOW })
  assert.equal(plan.action, 'ask')
  assert.equal(plan.confidence, 0)
})

test('no sessions at all opens a new one', () => {
  const plan = planRoute({ utterance: '帮我看看这个仓库', sessions: [], now: NOW })
  assert.equal(plan.action, 'new')
})

test('stale Sessions fall outside the recent window', () => {
  const plan = planRoute({ utterance: '回到上次那个季度报表', sessions: SESSIONS, now: NOW })
  assert.equal(plan.action, 'resume')
  assert.equal(plan.sessionId, 's-old', 'explicit title still routes, even if stale')
})

test('spokenConfirmation names the destination', () => {
  const plan = planRoute({ utterance: '语音插件那个骨架继续弄', sessions: SESSIONS, now: NOW })
  assert.match(spokenConfirmation(plan), /语音插件/)
  assert.equal(spokenConfirmation({ action: 'new', sessionId: null, candidates: [], confidence: 1, reason: '', text: '' }), '好，开个新会话。')
})

test('resolveOrdinal maps 第一个/2/新开 onto the offered candidates', () => {
  const candidates = [{ sessionId: 'a', title: 'A' }, { sessionId: 'b', title: 'B' }]
  assert.deepEqual(resolveOrdinal('第一个', candidates)?.sessionId, 'a')
  assert.deepEqual(resolveOrdinal('2', candidates)?.sessionId, 'b')
  assert.equal(resolveOrdinal('新开一个', candidates)?.action, 'new')
  assert.equal(resolveOrdinal('第三个', candidates), null)
  assert.equal(resolveOrdinal('今天天气不错', candidates), null)
})

test('isResumeIntent only fires on leading resume wording', () => {
  assert.equal(isResumeIntent('继续插件优化'), true)
  assert.equal(isResumeIntent('回到上次那个'), true)
  assert.equal(isResumeIntent('插件继续优化'), false)
})

test('resumeTopic peels every leading resume word', () => {
  assert.equal(resumeTopic('回到语音控制那个会话'), '语音控制那个会话')
  assert.equal(resumeTopic('接着刚才那个'), '')
  assert.equal(resumeTopic('继续'), '')
  assert.equal(resumeTopic('Continue with the TTS work'), 'tts work')
})

test('a named topic no title carries asks instead of guessing the most recent', () => {
  // No title here mentions 语音控制; silently resuming the most recent Session
  // would speak into the wrong conversation.
  const plan = planRoute({ utterance: '回到语音控制那个会话', sessions: SESSIONS, now: NOW })
  assert.equal(plan.action, 'ask')
  assert.equal(plan.sessionId, null)
  assert.ok(plan.candidates.length >= 1)
  assert.match(plan.reason, /matched no Session title/)

  // A bare "继续" still means the most recent Session: no topic, no question.
  const bare = planRoute({ utterance: '继续', sessions: SESSIONS, now: NOW })
  assert.equal(bare.action, 'resume')
  assert.equal(bare.sessionId, 's-voice')

  // "继续，加个功能" is a follow-up instruction, not a destination: the topic
  // after a plain 继续 must not be mistaken for a Session name.
  const followUp = planRoute({ utterance: '继续，加个功能', sessions: SESSIONS, now: NOW })
  assert.equal(followUp.action, 'resume')
  assert.equal(followUp.sessionId, 's-voice')
})
