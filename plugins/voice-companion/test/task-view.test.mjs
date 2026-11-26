// Task view: the node chain built from a dispatched Session's events, plus the
// board's list/detail surface the canvas polls.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TASK_PERMISSION_PRESET,
  buildTaskNodes,
  createTaskBoard,
  lastAssistantText,
  shortSession,
  summarizeToolArguments,
} from '../host/tasks.js'

function assistant(...parts) {
  return {
    type: 'assistant/message',
    data: { message: { content: parts.map((text) => ({ type: 'text', text })) } },
  }
}

function call(callId, name, args) {
  return { type: 'tool/call', data: { callId, name, arguments: JSON.stringify(args) } }
}

function result(callId, text = 'ok', isError = false) {
  return {
    type: 'tool/result',
    data: { callId, message: { isError, content: [{ type: 'text', text }] } },
  }
}

const BASE_TASK = {
  taskId: 'vc-task-1',
  sessionId: 'session-abcdef-123',
  title: '补 README',
  text: '给 voice-control 的 README 补一段隐私说明',
  utterance: '帮我给 voice-control 的 README 补一段隐私说明',
}

test('summarizeToolArguments picks the field a human reads', () => {
  assert.equal(summarizeToolArguments('bash', '{"command":"npm test"}'), 'npm test')
  assert.equal(summarizeToolArguments('read', '{"file_path":"/tmp/a.md"}'), '/tmp/a.md')
  assert.equal(
    summarizeToolArguments('todo_write', '{"todos":[{"content":"读代码","status":"completed"},{"content":"改测试","status":"in_progress"}]}'),
    '✓ 读代码\n▶ 改测试',
  )
  assert.equal(summarizeToolArguments('bash', 'not json'), 'not json')
})

test('lastAssistantText skips messages without text and returns the newest', () => {
  const events = [
    assistant('第一句'),
    { type: 'tool/call', data: {} },
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'x' }] } } },
    assistant('最后一句'),
  ]
  assert.equal(lastAssistantText(events), '最后一句')
  assert.equal(lastAssistantText([]), undefined)
})

test('running task nodes: heard → dispatch → tool(active) → live step', () => {
  const nodes = buildTaskNodes({
    task: BASE_TASK,
    running: true,
    events: [assistant('我去看看'), call('c1', 'bash', { command: 'ls' }), call('c2', 'todo_write', { todos: [{ content: '补 README', status: 'in_progress' }] })],
  })
  assert.deepEqual(
    nodes.map((node) => [node.kind, node.title, node.status]),
    [
      ['heard', '听到', 'done'],
      ['dispatch', '派活', 'done'],
      ['message', '回复', 'done'],
      ['tool', '运行命令', 'active'],
      ['tool', '更新计划', 'active'],
    ],
  )
  assert.equal(nodes[3].content, 'ls')
  assert.match(nodes[1].detail, /完全访问/)
  assert.equal(nodes[0].content, BASE_TASK.utterance)
  assert.equal(nodes.some((node) => node.kind === 'result'), false)
})

test('a running task with nothing in flight gets one 下一步 live node', () => {
  const nodes = buildTaskNodes({ task: BASE_TASK, running: true, events: [assistant('正在想')] })
  assert.equal(nodes.at(-1).kind, 'live')
  assert.equal(nodes.at(-1).status, 'active')
  assert.equal(nodes.filter((node) => node.status === 'active').length, 1)
})

test('settled task: tool results close their nodes and 交付 carries the summary', () => {
  const nodes = buildTaskNodes({
    task: { ...BASE_TASK, summary: 'README 补完了' },
    running: false,
    events: [call('c1', 'read', { file_path: 'README.md' }), result('c1', 'done'), assistant('README 补完了')],
  })
  assert.deepEqual(
    nodes.map((node) => [node.kind, node.status]),
    [
      ['heard', 'done'],
      ['dispatch', 'done'],
      ['tool', 'done'],
      ['message', 'done'],
      ['result', 'done'],
    ],
  )
  assert.equal(nodes[2].detail.includes('done'), true)
  assert.equal(nodes.at(-1).content, 'README 补完了')
})

test('failed task ends on 没做成 with the error, open calls marked error', () => {
  const nodes = buildTaskNodes({
    task: BASE_TASK,
    running: false,
    failure: '会话崩了',
    events: [call('c1', 'bash', { command: 'make' }), result('c1', 'boom', true)],
  })
  const tool = nodes.find((node) => node.kind === 'tool')
  assert.equal(tool.status, 'error')
  assert.match(tool.detail, /失败：boom/)
  assert.equal(nodes.at(-1).title, '没做成')
  assert.equal(nodes.at(-1).status, 'error')
  assert.equal(nodes.at(-1).content, '会话崩了')
})

test('long runs fold the middle into one gap node', () => {
  const events = []
  for (let index = 0; index < 60; index += 1) {
    events.push(call(`c${index}`, 'read', { file_path: `file-${index}.md` }), result(`c${index}`))
  }
  const nodes = buildTaskNodes({ task: BASE_TASK, running: false, events })
  assert.equal(nodes.length, 36)
  const gap = nodes.filter((node) => node.kind === 'gap')
  assert.equal(gap.length, 1)
  assert.match(gap[0].content, /省略/)
  assert.equal(nodes.at(-1).kind, 'result')
})

test('shortSession keeps ids readable', () => {
  assert.equal(shortSession(''), '新会话')
  assert.equal(shortSession('abc'), 'abc')
  assert.equal(shortSession('session-abcdef-123'), 'sessio…123')
})

// ------------------------------------------------------------------- board

function createHarness({ events = [] } = {}) {
  const listeners = new Map()
  const prompts = []
  const controller = {
    create: async () => ({ sessionId: 's1' }),
    prompt: async (request) => {
      prompts.push(request)
      return { accepted: true }
    },
    events: async () => ({ records: events.map((event) => ({ event })) }),
  }
  const services = {
    sessionController: controller,
    permissionPresets: {
      names: [TASK_PERMISSION_PRESET],
      current: () => TASK_PERMISSION_PRESET,
      set: async () => {},
      resolve: () => ({ sandbox: TASK_PERMISSION_PRESET }),
    },
    sessions: { get: () => ({ id: 's1' }) },
    agents: { get: () => undefined },
    llm: { resolveModelInfo: async () => ({ reasoning: { efforts: ['high'] } }) },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => services[name],
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
      return () => listeners.get(event)?.delete(listener)
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
  const board = createTaskBoard({ ctx, now: () => 1_000 })
  return { board, ctx, prompts }
}

test('board list is newest-first and detail serves a live chain while running', async () => {
  const { board } = createHarness({
    events: [call('c1', 'bash', { command: 'ls' })],
  })
  board.watch()
  const first = await board.dispatch({ text: '第一件', title: '一', utterance: '帮我看一下目录' })
  const second = await board.dispatch({ text: '第二件', title: '二' })

  const list = board.list()
  assert.deepEqual(list.map((task) => task.taskId), [second.taskId, first.taskId])
  assert.equal(list[0].status, 'running')
  assert.equal(list[1].utterance, '帮我看一下目录')

  const detail = await board.detail({ taskId: first.taskId, live: true })
  assert.equal(detail.task.taskId, first.taskId)
  assert.equal(detail.nodes[0].content, '帮我看一下目录')
  assert.equal(detail.nodes.at(-1).kind, 'tool')
  assert.equal(detail.nodes.at(-1).status, 'active')
})

test('status idle freezes the snapshot and detail then skips the session read', async () => {
  const events = [assistant('做完了'), call('c1', 'bash', { command: 'ls' }), result('c1')]
  const { board, ctx } = createHarness({ events })
  board.watch()
  const dispatched = await board.dispatch({ text: '干活', title: '干活' })

  ctx.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  assert.equal(board.list()[0].status, 'running')

  let reads = 0
  const original = ctx.get('sessionController').events
  ctx.get('sessionController').events = async (...args) => {
    reads += 1
    return original(...args)
  }
  ctx.emit('agent/status', { agent: { id: 's1' }, status: 'idle' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(reads, 1)
  assert.equal(board.list()[0].status, 'done')
  assert.equal(board.list()[0].summary, '做完了')

  const detail = await board.detail({ taskId: dispatched.taskId })
  assert.equal(reads, 1, 'settled detail must serve the frozen snapshot')
  assert.equal(detail.nodes.at(-1).title, '交付')
  assert.equal(detail.nodes.at(-1).content, '做完了')

  const events2 = board.poll(0).events
  assert.equal(events2.length, 1)
  assert.equal(events2[0].type, 'task-done')
})

test('agent/error freezes a failed task with the error text', async () => {
  const { board, ctx } = createHarness()
  board.watch()
  const dispatched = await board.dispatch({ text: '干活', title: '干活' })
  ctx.emit('agent/error', { agent: { id: 's1' }, error: new Error('模型挂了') })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const detail = await board.detail({ taskId: dispatched.taskId })
  assert.equal(detail.task.status, 'failed')
  assert.equal(detail.nodes.at(-1).title, '没做成')
  assert.equal(detail.nodes.at(-1).content, '模型挂了')
})

test('a failed prompt still leaves a failed card instead of a stuck running one', async () => {
  const { board, ctx } = createHarness()
  ctx.get('sessionController').prompt = async () => ({ accepted: false })
  await assert.rejects(() => board.dispatch({ text: '干活' }))
  const list = board.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].status, 'failed')
  assert.match(list[0].summary, /没有被会话接收/)
})

test('unknown taskId is a 404', async () => {
  const { board } = createHarness()
  await assert.rejects(() => board.detail({ taskId: 'nope' }), (error) => error.status === 404)
})
