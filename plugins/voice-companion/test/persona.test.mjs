import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_SENTENCE_CHARS,
  buildMessages,
  createBrain,
  parseDecision,
  splitSentences,
} from '../host/persona.js'

test('parseDecision reads bare JSON', () => {
  const decision = parseDecision('{"say":"好呀。"}')
  assert.deepEqual(decision, { say: '好呀。', task: null })
})

test('parseDecision unwraps a json code fence', () => {
  const decision = parseDecision('```json\n{"say":"好呀。"}\n```')
  assert.equal(decision.say, '好呀。')
  assert.equal(decision.task, null)
})

test('parseDecision ignores prose around the object and keeps the task', () => {
  const raw =
    '我想了下，这样回：{"say":"好，我去办。","task":{"title":"查资料","text":"查一下 Node 26 的新特性"}} 就这样。'
  const decision = parseDecision(raw)
  assert.equal(decision.say, '好，我去办。')
  assert.deepEqual(decision.task, { title: '查资料', text: '查一下 Node 26 的新特性' })
})

test('parseDecision falls back to the whole reply when it is not JSON', () => {
  const raw = '今天天气不错，随便聊聊。'
  assert.deepEqual(parseDecision(raw), { say: raw, task: null })
})

test('parseDecision fills a missing say for a task-only payload', () => {
  const decision = parseDecision('{"task":{"text":"把登录页文案改口语一点"}}')
  assert.equal(decision.say, '好，我去办，办完叫你。')
  assert.equal(decision.task.title, '把登录页文案改口语一点')
  assert.equal(decision.task.text, '把登录页文案改口语一点')
})

test('splitSentences handles Chinese sentence punctuation', () => {
  assert.deepEqual(splitSentences('好呀。今天天气不错！你呢？'), ['好呀。', '今天天气不错！', '你呢？'])
  assert.deepEqual(splitSentences('   '), [])
})

test('splitSentences handles English punctuation', () => {
  assert.deepEqual(splitSentences('Hello there. How are you? Fine!'), ['Hello there.', 'How are you?', 'Fine!'])
})

test('splitSentences keeps every chunk within the limit', () => {
  const long = '这是一句非常非常长的话，'.repeat(8)
  const chunks = splitSentences(long)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) {
    assert.ok(chunk.length <= MAX_SENTENCE_CHARS, `chunk too long: ${chunk.length} ${chunk}`)
    assert.notEqual(chunk, '')
  }
})

test('buildMessages pins the persona and ends with the utterance', () => {
  const messages = buildMessages({
    utterance: '帮我看看这个',
    history: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '在呢。' },
      { role: 'tool', content: 'ignored' },
    ],
    sessionTitles: ['登录页改版', ''],
  })
  assert.equal(messages[0].role, 'system')
  assert.match(messages[0].content, /大肥鱼/)
  assert.match(messages[0].content, /30 个字/)
  assert.ok(messages.some((message) => message.content.includes('登录页改版')))
  assert.deepEqual(messages.at(-1), { role: 'user', content: '帮我看看这个' })
  assert.ok(messages.every((message) => ['system', 'user', 'assistant'].includes(message.role)))
})

test('createBrain posts the agreed completion parameters and parses the reply', async () => {
  let captured
  const brain = createBrain({
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"say":"好呀。"}' } }] }),
        text: async () => '',
      }
    },
  })

  const decision = await brain.decide({ utterance: '你好' })
  assert.deepEqual(decision, { say: '好呀。', task: null })
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(captured.init.headers.authorization, 'Bearer test-key')
  assert.equal(captured.body.model, 'deepseek-flash')
  assert.equal(captured.body.stream, false)
  assert.equal(captured.body.temperature, 0.6)
  assert.equal(captured.body.max_tokens, 300)
})
