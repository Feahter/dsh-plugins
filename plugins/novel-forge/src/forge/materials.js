import { readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ForgeError } from './errors.js'

export const KIND = Object.freeze({
  world: '世界观模板',
  power: '力量体系',
  character: '人物卡模板',
  trope: '桥段与爽点',
  outline: '章纲模板',
  style: '文风与去AI味',
  consistency: '一致性规则',
  market: '市场拆解',
  prompt: '提示词与技能',
})

const SOURCES = ['system', 'user', 'community']
const LOCK = 'materials-library'
const SEEDS = [
  {
    id: 'world-rule', kind: 'world', title: '规则的适用边界', tags: ['规则', '例外'],
    text: '填写【规则】【受约束者】【执行者】【违背后果】。选一个人物本来能用旧办法解决的难题，让规则迫使他改变选择。再写一个规则不适用的例外，交代谁知道这个例外、为什么没有人轻易利用它。检查例外是否会让前面的代价失效。',
  },
  {
    id: 'world-resource', kind: 'world', title: '稀缺资源如何流动', tags: ['资源', '利益'],
    text: '选定【稀缺之物】，列出谁生产、谁分配、谁得不到，以及每一步由什么条件卡住。安排一次断供，让两个人为同一份资源提出相互冲突的用途。最后标出缺口由谁承担，后续哪些选择会因这次分配变得更难。',
  },
  {
    id: 'power-cost', kind: 'power', title: '来源、代价与上限', tags: ['能力', '代价'],
    text: '用【来源】【启动条件】【可见效果】【即时成本】【长期代价】【上限】写清一项能力。先让人物在小事上使用一次，给读者看见成本。再设计一次使用时机有冲突的场景，让人物在解决眼前问题和保留下次机会之间做选择。',
  },
  {
    id: 'power-counter', kind: 'power', title: '对手怎样反制', tags: ['能力', '反制'],
    text: '列出能力发挥所需的两个条件，给对手其中一条可通过观察获得的线索。让对手改变环境或时机，逼使用者付出额外代价。检查反制所用的信息是否已在此前出现，以及使用者应对之后还有什么弱点可被利用。',
  },
  {
    id: 'character-choice', kind: 'character', title: '用两难写人物卡', tags: ['动机', '选择'],
    text: '填写【现在想得到什么】【最不愿失去什么】【平时相信什么】。设计一道只能保住其中一项的选择题，记录人物当众怎么说、独处时实际怎么做。两处表现若有落差，给出一个能在前文埋下的具体理由和一个会在后文发生的后果。',
  },
  {
    id: 'tide-hook', kind: 'trope', title: '章末钩子：信息差悬置', tags: ['悬念', '追更'],
    text: '先选【钩子类型】，再填【本章已回答的问题】【读者新看到的证据】【人物尚不知道的事】【下次可兑现的答案】。章末留一个能用一句话问清的悬念，并确认它会改变人物下一步的选择。下一章给出反应或进展，兑现前一章的承诺。',
  },
  {
    id: 'trope-payoff', kind: 'trope', title: '回收可见的投入', tags: ['回收', '爽点'],
    text: '先写下人物为目标已经付出的具体投入，再找一场能检验这份投入的冲突。兑现时写出两个可见变化，例如旁观者调整立场、原本难以取得的机会终于开放。最后留一个仍需承担的后果，让胜利改变下一阶段的处境。',
  },
  {
    id: 'outline-turn', kind: 'outline', title: '目标到转折的章纲', tags: ['场景', '节拍'],
    text: '按【起始处境】【本章目标】【实际阻力】【主动选择】【选择结果】写一行章纲。每场戏结束时标注哪项信息、关系或资源变了。把前一场变化写成后一场的起因，找出删掉以后也不影响后文的场景，合并或重新安排它。',
  },
  {
    id: 'style-detail', kind: 'style', title: '用动作替换情绪概括', tags: ['描写', '改稿'],
    text: '挑一段直接解释情绪的文字，圈出读者已经能从上下文知道的部分。把剩余内容改成一个人物此刻会做的动作，选用他所在场景的物件作为落点。读一遍对话和动作之间的停顿，确认读者仍能从行为推回他的顾虑。',
  },
  {
    id: 'consistency-knowledge', kind: 'consistency', title: '人物知情时间核对', tags: ['正典', '视角'],
    text: '写下本章每位人物用于判断的关键信息，逐项注明他在哪一章、从谁或什么证据得知。若找不到来源，补一个能看见的获知过程，或改写他的判断和行动。对猜测与确知分别记账，后续证据出现时再更新知情状态。',
  },
]

export function validMaterialId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_\-\p{Unified_Ideograph}]{1,40}$/u.test(id)
}

function checkId(id) {
  if (!validMaterialId(id)) throw new ForgeError('BAD_PARAMS', '素材 id 必须为 1–40 个字母、数字、下划线、连字符或汉字')
}

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= max
}

function validate({ id, kind, title, text, tags, source }) {
  checkId(id)
  if (typeof kind !== 'string' || !Object.hasOwn(KIND, kind)) throw new ForgeError('BAD_PARAMS', '无效的素材 kind')
  if (!validText(title, 60)) throw new ForgeError('BAD_PARAMS', '素材标题须为 1–60 字')
  if (!validText(text, 4000)) throw new ForgeError('BAD_PARAMS', '素材正文须为 1–4000 字')
  if (!Array.isArray(tags) || tags.length > 12 || !Array.from(tags).every(tag => validText(tag, 20))) {
    throw new ForgeError('BAD_PARAMS', '素材标签最多 12 个，每个 1–20 字')
  }
  if (!SOURCES.includes(source)) throw new ForgeError('BAD_PARAMS', '无效的素材 source')
}

async function readEntry(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error instanceof SyntaxError) throw new ForgeError('ARTIFACT_CORRUPT', '素材文件不是合法 JSON', { file })
    throw error
  }
}

function notFound(id) {
  return new ForgeError('NOT_FOUND', `素材不存在：${id}`, { id })
}

export class MaterialsLibrary {
  constructor(store, clock = () => new Date()) {
    this.store = store
    this.root = join(store.root, 'materials')
    this.clock = clock
  }

  #path(kind, id) {
    return join(this.root, kind, `${id}.json`)
  }

  async #find(id) {
    for (const kind of Object.keys(KIND)) {
      const entry = await readEntry(this.#path(kind, id))
      if (entry) return entry
    }
    return null
  }

  #write(entry) {
    return this.store.atomicWrite(this.#path(entry.kind, entry.id), JSON.stringify(entry, null, 2))
  }

  async list({ kind, tag, source, query } = {}) {
    if (kind !== undefined && (typeof kind !== 'string' || !Object.hasOwn(KIND, kind))) {
      throw new ForgeError('BAD_PARAMS', '无效的素材 kind')
    }
    if (source !== undefined && !SOURCES.includes(source)) throw new ForgeError('BAD_PARAMS', '无效的素材 source')
    if (tag !== undefined && !validText(tag, 20)) throw new ForgeError('BAD_PARAMS', '无效的素材标签')
    if (query !== undefined && typeof query !== 'string') throw new ForgeError('BAD_PARAMS', 'query 必须是字符串')
    const needle = query?.trim().toLowerCase()
    const entries = []
    for (const category of kind ? [kind] : Object.keys(KIND)) {
      const files = await readdir(join(this.root, category), { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue
        const entry = await readEntry(join(this.root, category, file.name))
        if (!entry || (tag && !entry.tags.includes(tag)) || (source && entry.source !== source)) continue
        if (needle && ![entry.id, entry.title, entry.text, ...entry.tags].some(value => value.toLowerCase().includes(needle))) continue
        entries.push(entry)
      }
    }
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .map(({ id, kind, title, tags, source, version, uses, text }) => ({
        id, kind, title, tags, source, version, uses, preview: Array.from(text).slice(0, 80).join(''),
      }))
  }

  async get(id) {
    checkId(id)
    const entry = await this.#find(id)
    if (entry?.id !== id) throw notFound(id)
    return entry
  }

  async #insert(entry) {
    const now = this.clock().toISOString()
    const stored = { ...entry, version: 1, uses: 0, createdAt: now, updatedAt: now }
    await this.#write(stored)
    return stored
  }

  async add(input) {
    const { id, kind, title, tags = [], text, source = 'user' } = input ?? {}
    const entry = { id, kind, title, tags, text, source }
    validate(entry)
    return this.store.withLock(LOCK, async () => {
      if (await this.#find(id)) throw new ForgeError('BAD_PARAMS', `素材 id 已存在：${id}`, { id })
      return this.#insert(entry)
    })
  }

  async update(id, patch) {
    checkId(id)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ForgeError('BAD_PARAMS', '素材更新须为对象')
    const fields = Object.fromEntries(['title', 'tags', 'text'].filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]))
    return this.store.withLock(LOCK, async () => {
      const entry = await this.get(id)
      const updated = { ...entry, ...fields, version: entry.version + 1, updatedAt: this.clock().toISOString() }
      validate(updated)
      await this.#write(updated)
      return updated
    })
  }

  async remove(id) {
    return this.store.withLock(LOCK, async () => {
      const entry = await this.get(id)
      await unlink(this.#path(entry.kind, id))
    })
  }

  async seed() {
    return this.store.withLock(LOCK, async () => {
      let added = 0
      for (const entry of SEEDS) {
        if (await this.#find(entry.id)) continue
        await this.#insert({ ...entry, source: 'system' })
        added += 1
      }
      return { added, skipped: SEEDS.length - added }
    })
  }

  async bumpUses(ids, beforeBump) {
    if (!Array.isArray(ids) || !Array.from(ids).every(validMaterialId)) throw new ForgeError('BAD_PARAMS', 'ids 必须是素材 id 数组')
    return this.store.withLock(LOCK, async () => {
      const entries = await Promise.all([...new Set(ids)].map(id => this.get(id)))
      // 写项目快照期间固定库条目，且项目写入失败时不计次数。
      if (beforeBump) await beforeBump(entries)
      for (const entry of entries) await this.#write({ ...entry, uses: entry.uses + 1 })
    })
  }
}
