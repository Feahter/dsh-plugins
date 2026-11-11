// 端到端假 LLM：按 recipe 的 phase 返回合法 JSON / 正文。
// 复制自 test/integration.test.mjs 的精简版，额外提供「第一枪挂起」闸门，
// 让 Playwright 有机会在流水线还在跑时观察 UI 的运行中状态。

export const PREMISE = '殡仪馆夜班的新人发现，停尸柜里的亡者会在凌晨三点开口说话'

export const PROSE = [
  '雨落在灵堂的玻璃上，像有人用指甲一下一下地敲。沈砚把名册翻开，手指停在第三行。',
  '「你确定要查下去？」老周把搪瓷杯搁下，杯底和桌面碰出一声闷响。',
  '沈砚没答。他听见三号柜里有呼吸声，很轻，像隔着一层棉布。',
  '走廊尽头的灯闪了两下。老周的脸色在忽明忽暗里变得很难看。',
  '「三点之前必须走。」老周说，「这地方夜里不干净。」',
  '沈砚抬头看钟。两点五十七分。名册上的墨迹还没干透，散着一点腥气。',
  '三号柜的门自己弹开一条缝。白汽从缝里漫出来，贴着地面爬。',
  '他蹲下去，看见里面的人睁着眼。那张脸他认得，是昨天刚送来的老人。',
  '「你来了。」老人说。声音沙哑，像砂纸磨过木头。',
  '沈砚后退半步，后腰撞上推车。金属托盘上的器械哗啦响成一片。',
  '老周在门外喊他名字。他没回头，只盯着那双眼睛。',
  '「名册上第三行，」老人慢慢说，「写错了。」',
].join('\n\n')

const outlineChapters = Array.from({ length: 7 }, (_, index) => ({
  title: `第${index + 1}夜`,
  goal: `查清第 ${index + 1} 位亡者的遗愿`,
  conflict: '老周阻拦，名册被人改过',
  turn: '亡者说出一个活人的名字',
  hook: `名册第 ${index + 2} 行出现新的墨迹`,
  pov: '沈砚',
  when: '凌晨三点',
  where: '殡仪馆灵堂',
  cast: ['沈砚', '老周'],
}))

function payload(phase) {
  if (phase === 'premise') {
    return {
      title: '长夜将明',
      logline: PREMISE,
      theme: '记忆与告别',
      promise: '每章替一位亡者了结遗愿',
      ending: '沈砚烧掉名册，离开殡仪馆',
      genreTags: ['悬疑', '民俗'],
    }
  }
  if (phase === 'outline') {
    return { volumes: [{ title: '卷一 夜班', purpose: '入职与第一桩怪事', chapters: outlineChapters }] }
  }
  if (phase === 'beats') {
    return {
      title: '夜班',
      scenes: [
        { no: 1, where: '灵堂', when: '凌晨', cast: ['沈砚', '老周'], goal: '熟悉流程', obstacle: '老周支开他', turn: '听见柜中呼吸', exit: '名册第三行', sensory: '雨声与消毒水' },
        { no: 2, where: '三号柜', when: '三点', cast: ['沈砚', '亡者'], goal: '确认声音', obstacle: '恐惧', turn: '亡者开口', exit: '名册写错', sensory: '白汽与铁锈味' },
      ],
    }
  }
  if (phase === 'review') {
    return {
      findings: [{ severity: 'note', kind: 'pacing', where: '中段', issue: '节奏略慢', fix: '压缩一句' }],
      ledgerPatch: {
        facts: [{ text: '名册第三行被人改过', chapter: 'ch01' }],
        threads: [{ text: '谁改了名册', status: 'open' }],
        characters: { 沈砚: { location: '灵堂', state: '警觉', knows: ['亡者会说话'] } },
        timeline: [{ chapter: 'ch01', when: '凌晨三点', event: '老人开口' }],
      },
      verdict: 'pass',
    }
  }
  if (phase === 'characters') {
    return {
      cast: [
        { name: '沈砚', role: '主角', want: '查清名册真相', fear: '自己也在名册上', secret: '他能听见亡者说话', voice: '克制、短句', arc: '从旁观到承担' },
        { name: '老周', role: '守夜人', want: '平安退休', fear: '旧事败露', secret: '名册是他改的', voice: '油滑、爱打岔', arc: '从阻拦到坦白' },
      ],
    }
  }
  if (phase === 'blurb') {
    return { title: '长夜将明', tagline: '有些名字，死了才被写对', blurb: '殡仪馆夜班新人……', tags: ['悬疑', '灵异'] }
  }
  if (phase === 'prose' || phase === 'revise') return PROSE
  if (phase === 'summary') return '沈砚第一夜值班，听见三号柜里的亡者开口，亡者说名册第三行写错了。'
  return '设定文本。'
}

export function createFakeLlm({ delayMs = 5 } = {}) {
  const calls = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  let first = true

  return {
    calls,
    /** 放行第一枪；之后所有调用按 delayMs 推进。 */
    release: () => release(),
    async generate(opts) {
      const phase = opts.phase ?? opts.label
      calls.push(phase)
      if (first) {
        first = false
        await gate
      }
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      const data = payload(phase)
      const text = typeof data === 'string' ? data : JSON.stringify(data)
      return { text, chars: text.length, model: 'fake' }
    },
    async info() {
      return { available: true, provider: 'fake', model: 'fake' }
    },
  }
}
