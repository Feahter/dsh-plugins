// test/fixtures/novel-fixtures.mjs — 假 ctx / 假 prompts / 固定产物。不调真模型。

export const PROMISE_IDS = [
  'premise',
  'bible',
  'characters',
  'spine',
  'outline',
  'beats',
  'draft',
  'summary',
  'review',
  'revise',
  'blurb',
]

export const SAMPLE_PARAMS = {
  premise: '一个在殡仪馆值夜班的年轻人，发现死者会在头七那晚回来。',
  title: '',
  genre: '悬疑',
  audience: '成年',
  language: 'zh',
  chapters: 6,
  wordsPerChapter: 1200,
  pov: '第三人称限知',
  tone: '冷、克制',
  styleGuide: '不要形容词堆叠。',
  autoReview: true,
  reviewGate: false,
  seed: '头七',
}

export function normalizeArtifact(key, value) {
  if (value && typeof value === 'object' && typeof value.kind === 'string' && 'content' in value) {
    return { kind: value.kind, content: value.content }
  }
  if (typeof value === 'string') return { kind: 'md', content: value }
  return { kind: 'json', content: value }
}

/** 假 stage ctx：实现 §3.3 的读工具 + 脚本化 llm.generate。 */
export function createFakeCtx({
  artifacts = {},
  params = { ...SAMPLE_PARAMS },
  item,
  items = [],
  index = 0,
  outputs = [],
  run = { id: 'r_test', options: {} },
  project = {},
} = {}) {
  const store = new Map()
  for (const [key, value] of Object.entries(artifacts)) store.set(key, normalizeArtifact(key, value))

  const calls = []
  const logs = []
  const warns = []
  let cursor = 0

  const ctx = {
    project: { id: 'p_test', title: '测试项目', params, stages: {}, stats: {}, ...project },
    params,
    run,
    item,
    index,
    total: items.length || undefined,
    items,
    signal: undefined,
    calls,
    logs,
    _store: store,
    _set(key, value, kind) {
      store.set(key, normalizeArtifact(key, kind ? { kind, content: value } : value))
    },
    has(key) {
      return store.has(key)
    },
    read(key) {
      const hit = store.get(key)
      if (!hit) return null
      return { key, kind: hit.kind, content: structuredClone(hit.content), meta: {} }
    },
    text(key, maxChars) {
      const hit = store.get(key)
      if (!hit) return ''
      const text = typeof hit.content === 'string' ? hit.content : JSON.stringify(hit.content, null, 2)
      if (!maxChars || text.length <= maxChars) return text
      return `${text.slice(0, Math.max(0, maxChars - 6))}…（已截断）`
    },
    json(key) {
      const hit = store.get(key)
      if (!hit) {
        const error = new Error(`missing artifact: ${key}`)
        error.code = 'ARTIFACT_MISSING'
        throw error
      }
      if (hit.kind === 'json' && typeof hit.content !== 'string') return structuredClone(hit.content)
      return typeof hit.content === 'string' ? JSON.parse(hit.content) : structuredClone(hit.content)
    },
    list(path) {
      const [head, ...rest] = String(path).split('.')
      let value = ctx.json(head)
      for (const segment of rest) value = value?.[segment]
      return value
    },
    fit(text, maxChars) {
      const value = String(text ?? '')
      if (!Number.isFinite(maxChars) || maxChars <= 0) return value
      if (value.length <= maxChars) return value
      return `${value.slice(0, Math.max(0, maxChars - 6))}…（已截断）`
    },
    log(message) {
      logs.push(message)
    },
    warn(message) {
      logs.push(message)
      warns.push(message)
    },
    progress() {},
    llm: {
      async generate(options) {
        calls.push(options)
        if (cursor >= outputs.length) {
          throw new Error(`unscripted llm call #${cursor + 1} (phase=${options.phase})`)
        }
        const next = outputs[cursor]
        cursor += 1
        return typeof next === 'function' ? await next(options) : next
      },
    },
  }

  ctx.warns = warns
  ctx.remainingOutputs = () => outputs.length - cursor
  return ctx
}

/** 假 prompts：按 stage id 返回固定 system/user，可覆写。 */
export function createScriptedPrompts(script = {}) {
  const calls = []
  const prompts = {}
  for (const id of PROMISE_IDS) {
    prompts[id] = (ctx) => {
      const entry = script[id]
      const spec = typeof entry === 'function' ? entry(ctx) : entry
      calls.push({ id, ctx, spec })
      return {
        system: `system:${id}`,
        user: `user:${id}`,
        maxTokens: id === 'draft' ? 2048 : 4096,
        ...(spec ?? {}),
      }
    }
  }
  prompts.calls = calls
  return prompts
}

export function jsonOut(value) {
  return {
    text: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
    json: value,
    model: 'fake-model',
    chars: JSON.stringify(value).length,
  }
}

export function textOut(text) {
  return { text, model: 'fake-model', chars: String(text).length }
}

export function sampleBrief(overrides = {}) {
  return {
    title: '长夜将明',
    logline: '殡仪馆夜班青年追查头七回魂的真相。',
    theme: '与死者未说完的话和解',
    promise: '冷峻的悬疑，最终落到人间的温情',
    ending: '他送走最后一个亡魂，也放过了自己',
    genreTags: ['悬疑', '灵异', '成长'],
    ...overrides,
  }
}

export function sampleCharacters() {
  return {
    cast: [
      {
        name: '沈砚',
        role: '主角',
        gender: '男',
        want: '弄清楚父亲死亡的真相',
        fear: '自己也会被遗忘',
        secret: '他能听见死者说话',
        voice: '短句，少用形容词',
        arc: '从逃避到承担',
        relations: [{ to: '阿绫', kind: '同事' }],
      },
      {
        name: '阿绫',
        role: '关键配角',
        gender: '女',
        want: '离开这座小城',
        fear: '被困在原地',
        secret: '她见过头七的回魂',
        voice: '语速快，爱反问',
        arc: '从旁观到介入',
        relations: [{ to: '沈砚', kind: '同事' }],
      },
    ],
  }
}

export function sampleVolumeOutline() {
  return {
    volumes: [
      {
        title: '第一卷 头七',
        purpose: '建立规则与恐惧',
        chapters: [
          {
            id: 'not-a-real-id',
            title: '起：雨夜',
            goal: '沈砚值夜班，第一次遇到回魂',
            conflict: '他想逃，但尸体开口了',
            turn: '死者叫出了他父亲的名字',
            hook: '门外站着的是谁',
            pov: '第三人称限知',
            when: '雨夜',
            where: '殡仪馆',
            cast: ['沈砚'],
          },
          {
            id: 'ch99',
            title: '承：旧照片',
            goal: '沈砚开始查父亲旧案',
            conflict: '阿绫阻止他',
            turn: '照片里多了一个人',
            hook: '照片背面写着他的生日',
            pov: '第三人称限知',
            when: '次日',
            where: '档案室',
            cast: ['沈砚', '阿绫'],
          },
        ],
      },
      {
        title: '第二卷 回声',
        purpose: '把恐惧推向代价',
        chapters: [
          {
            id: 'weird',
            title: '转：头七',
            goal: '真相逼近',
            conflict: '他必须选择是否让死者留下',
            turn: '父亲真的回来了',
            hook: '他该说什么',
            pov: '第三人称限知',
            when: '第七夜',
            where: '灵堂',
            cast: ['沈砚', '阿绫'],
          },
        ],
      },
    ],
    totalChapters: 99,
  }
}

export function sampleLedger() {
  return {
    facts: [
      { id: 'f01', text: '书名《长夜将明》', chapter: 'ch01', status: 'canon' },
      { id: 'f02', text: '故事核：殡仪馆夜班青年追查头七回魂的真相。', chapter: 'ch01', status: 'canon' },
      { id: 'f03', text: '凶器是一把裁纸刀', chapter: 'ch02', status: 'open' },
    ],
    threads: [
      { id: 't01', text: 'ch01 钩子：门外站着的是谁', opened: 'ch01', status: 'open', closedIn: null },
      { id: 't02', text: 'ch02 钩子：照片背面写着他的生日', opened: 'ch02', status: 'open', closedIn: null },
    ],
    characters: {
      沈砚: { location: '殡仪馆', state: '疲惫但清醒', knows: ['头七回魂存在'] },
    },
    timeline: [
      { chapter: 'ch01', when: '雨夜', event: '沈砚值夜班' },
      { chapter: 'ch02', when: '次日', event: '沈砚查档案' },
    ],
    canonRules: ['视角：第三人称限知', '语言：zh'],
  }
}

export function sampleBeats(chapterId = 'ch01') {
  return {
    chapterId,
    title: '起：雨夜',
    scenes: [
      {
        no: 1,
        where: '殡仪馆走廊',
        when: '雨夜',
        cast: ['沈砚', '阿绫'],
        goal: '完成交接班',
        obstacle: '停电',
        turn: '停尸间传来敲击声',
        exit: '沈砚推开门',
        sensory: '消毒水与雨水',
      },
      {
        no: 2,
        where: '停尸间',
        when: '雨夜',
        cast: ['沈砚'],
        goal: '确认声音来源',
        obstacle: '尸体坐起',
        turn: '死者叫出父亲的名字',
        exit: '沈砚后退撞到门',
        sensory: '金属台的凉',
      },
    ],
  }
}
