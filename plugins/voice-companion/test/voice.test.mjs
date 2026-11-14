import test from 'node:test'
import assert from 'node:assert/strict'

import {
  VOICE_CATALOG,
  VOICE_IDS,
  CHARACTER_VOICES,
  detectEmotion,
  normalizeVoiceMap,
  resolveVoiceMode,
  selectVoice,
  selectVoices,
  voiceCatalog,
} from '../host/voice.js'
import {
  DEFAULT_PROFILE,
  SPEED_MAX,
  SPEED_MIN,
  VOICE_KEY,
  clampSpeed,
  normalizeProfile,
  readVoiceProfile,
  writeVoiceProfile,
} from '../src/client/voice-profile.js'

test('catalog and character mapping match the design', () => {
  assert.deepEqual(VOICE_CATALOG, [
    { id: 'stella', label: '明亮', tone: 'bright' },
    { id: 'tide', label: '温柔', tone: 'warm' },
  ])
  assert.deepEqual(VOICE_IDS, ['stella', 'tide'])
  assert.deepEqual(CHARACTER_VOICES, {
    whale: { base: 'tide', bright: 'stella', soft: 'tide' },
    chibi: { base: 'stella', bright: 'stella', soft: 'tide' },
  })
})

test('detectEmotion: punctuation and bright words are bright', () => {
  assert.equal(detectEmotion('好耶！'), 'bright')
  assert.equal(detectEmotion('Great!'), 'bright')
  assert.equal(detectEmotion('哈哈，今天真不错'), 'bright')
  assert.equal(detectEmotion('太棒了'), 'bright')
  assert.equal(detectEmotion('好耶'), 'bright')
  assert.equal(detectEmotion('你好厉害'), 'bright')
})

test('detectEmotion: soft words are soft', () => {
  assert.equal(detectEmotion('抱歉，我迟到了'), 'soft')
  assert.equal(detectEmotion('对不起'), 'soft')
  assert.equal(detectEmotion('不好意思啊'), 'soft')
  assert.equal(detectEmotion('辛苦你了'), 'soft')
  assert.equal(detectEmotion('慢慢来'), 'soft')
  assert.equal(detectEmotion('别急'), 'soft')
  assert.equal(detectEmotion('我有点难过'), 'soft')
})

test('detectEmotion: neutral and empty text are calm', () => {
  assert.equal(detectEmotion('好的'), 'calm')
  assert.equal(detectEmotion('任务已经完成了。'), 'calm')
  assert.equal(detectEmotion(''), 'calm')
  assert.equal(detectEmotion(undefined), 'calm')
  assert.equal(detectEmotion(null), 'calm')
})

test('detectEmotion: when bright and soft both appear, the first signal wins', () => {
  assert.equal(detectEmotion('哈哈，抱歉'), 'bright') // 哈哈 at 0, 抱歉 at 3
  assert.equal(detectEmotion('抱歉，哈哈'), 'soft') // 抱歉 at 0, 哈哈 at 3
  assert.equal(detectEmotion('抱歉！'), 'soft') // 抱歉 at 0, ！ at 2
  assert.equal(detectEmotion('！抱歉'), 'bright') // ！ at 0, 抱歉 at 1
})

test('resolveVoiceMode forces valid modes and falls back to auto', () => {
  assert.equal(resolveVoiceMode('auto'), 'auto')
  assert.equal(resolveVoiceMode('bright'), 'bright')
  assert.equal(resolveVoiceMode('calm'), 'calm')
  assert.equal(resolveVoiceMode('B RIGHT'), 'auto')
  assert.equal(resolveVoiceMode('loud'), 'auto')
  assert.equal(resolveVoiceMode(undefined), 'auto')
  assert.equal(resolveVoiceMode(null), 'auto')
  assert.equal(resolveVoiceMode(1), 'auto')
})

test('selectVoice: auto follows emotion', () => {
  assert.equal(selectVoice({ character: 'whale', text: '好耶！' }), 'stella')
  assert.equal(selectVoice({ character: 'whale', text: '抱歉' }), 'tide')
  assert.equal(selectVoice({ character: 'whale', text: '好的' }), 'tide')
  assert.equal(selectVoice({ character: 'chibi', text: '好耶！' }), 'stella')
  assert.equal(selectVoice({ character: 'chibi', text: '抱歉' }), 'tide')
  assert.equal(selectVoice({ character: 'chibi', text: '好的' }), 'stella')
})

test('selectVoice: explicit modes override emotion', () => {
  assert.equal(selectVoice({ character: 'whale', text: '抱歉', mode: 'bright' }), 'stella')
  assert.equal(selectVoice({ character: 'whale', text: '好耶！', mode: 'calm' }), 'tide')
  assert.equal(selectVoice({ character: 'chibi', text: '抱歉', mode: 'bright' }), 'stella')
  assert.equal(selectVoice({ character: 'chibi', text: '好耶！', mode: 'calm' }), 'stella')
})

test('selectVoice: unknown or missing character falls back to whale', () => {
  assert.equal(selectVoice({ character: 'dragon', text: '好的' }), 'tide')
  assert.equal(selectVoice({ character: 'dragon', text: '好耶！' }), 'stella')
  assert.equal(selectVoice({ text: '好的' }), 'tide')
  assert.equal(selectVoice({ character: null, text: '好耶！' }), 'stella')
})

test('selectVoice: available restricts the result to enabled ids', () => {
  const cases = [
    { character: 'whale', text: '好的', mode: 'calm' },
    { character: 'whale', text: '好耶！', mode: 'bright' },
    { character: 'chibi', text: '抱歉', mode: 'auto' },
    { character: 'chibi', text: '好的', mode: 'auto' },
  ]
  for (const input of cases) {
    const onlyStella = selectVoice({ ...input, available: ['stella'] })
    assert.equal(onlyStella, 'stella', JSON.stringify(input))
    assert.notEqual(onlyStella, 'tide')

    const onlyTide = selectVoice({ ...input, available: ['tide'] })
    assert.equal(onlyTide, 'tide', JSON.stringify(input))
  }
})

test('selectVoice: empty or invalid available is ignored', () => {
  assert.equal(selectVoice({ character: 'whale', text: '好的', available: [] }), 'tide')
  assert.equal(selectVoice({ character: 'whale', text: '好的', available: 'stella' }), 'tide')
  assert.equal(selectVoice({ character: 'whale', text: '好的', available: null }), 'tide')
})

test('selectVoice: only unknown available ids still returns one of them', () => {
  assert.equal(selectVoice({ character: 'whale', text: '好的', available: ['nova'] }), 'nova')
})

test('selectVoices: empty or non-array sentences yield an empty array', () => {
  assert.deepEqual(selectVoices({ character: 'whale', sentences: [] }), [])
  assert.deepEqual(selectVoices({ character: 'whale', sentences: undefined }), [])
  assert.deepEqual(selectVoices({}), [])
  assert.deepEqual(selectVoices({ character: 'whale', sentences: '你好' }), [])
})

test('selectVoices: output length matches and the first sentence is always base', () => {
  const sentences = ['好耶！', '太棒了真的', '抱歉让你等']
  assert.deepEqual(selectVoices({ character: 'whale', sentences }), ['tide', 'stella', 'tide'])
  assert.deepEqual(selectVoices({ character: 'chibi', sentences }), ['stella', 'stella', 'tide'])

  // A bright first sentence does not get promoted: openings stay stable.
  assert.equal(selectVoices({ character: 'whale', sentences: ['太棒了！', '好的'] })[0], 'tide')
  // Forced mode still leaves the first sentence on base.
  assert.equal(selectVoices({ character: 'whale', sentences: ['抱歉', '好的'], mode: 'bright' })[0], 'tide')
})

test('selectVoices: available restricts every returned id', () => {
  const sentences = ['好耶！', '好的', '抱歉']
  const result = selectVoices({ character: 'whale', sentences, available: ['stella'] })
  assert.equal(result.length, sentences.length)
  for (const id of result) assert.equal(id, 'stella')
})

test('voiceCatalog returns a detached copy', () => {
  const first = voiceCatalog()
  assert.deepEqual(first, VOICE_CATALOG)
  first[0].label = 'mutated'
  first.push({ id: 'ghost', label: 'x', tone: 'warm' })

  assert.equal(VOICE_CATALOG[0].label, '明亮')
  assert.equal(VOICE_CATALOG.length, 2)
  assert.deepEqual(voiceCatalog(), [
    { id: 'stella', label: '明亮', tone: 'bright' },
    { id: 'tide', label: '温柔', tone: 'warm' },
  ])
  assert.notEqual(voiceCatalog(), voiceCatalog())
})

test('normalizeVoiceMap keeps only known slots with available ids', () => {
  assert.deepEqual(normalizeVoiceMap({ base: 'stella', bright: 'tide', soft: '' }), {
    base: 'stella',
    bright: 'tide',
  })
  assert.deepEqual(normalizeVoiceMap({ base: 'stella', soft: '  tide  ' }, ['stella', 'tide']), {
    base: 'stella',
    soft: 'tide',
  })
  assert.deepEqual(normalizeVoiceMap({ base: 'stella', bright: 'tide' }, ['tide']), { bright: 'tide' })
  assert.deepEqual(normalizeVoiceMap({ base: 'nova' }, ['stella', 'tide']), {})
  assert.deepEqual(normalizeVoiceMap({ loud: 'stella', base: 7 }, ['stella']), {})
  assert.deepEqual(normalizeVoiceMap(null), {})
  assert.deepEqual(normalizeVoiceMap(['tide']), {})
  assert.deepEqual(normalizeVoiceMap('stella'), {})
})

test('selectVoices: a custom voiceMap overrides one slot and keeps the rest', () => {
  // whale bright is stella by default; the profile moves it to tide.
  assert.deepEqual(
    selectVoices({ character: 'whale', sentences: ['好耶！', '太棒了'], voiceMap: { bright: 'tide' } }),
    ['tide', 'tide'],
  )
  // chibi soft is tide by default; the profile moves it to stella.
  assert.deepEqual(
    selectVoices({ character: 'chibi', sentences: ['好的', '抱歉'], voiceMap: { soft: 'stella' } }),
    ['stella', 'stella'],
  )
})

test('selectVoices: the first sentence follows the base slot even when customised', () => {
  const sentences = ['好耶！', '好的']
  assert.deepEqual(selectVoices({ character: 'whale', sentences }), ['tide', 'tide'])
  assert.deepEqual(selectVoices({ character: 'whale', sentences, voiceMap: { base: 'stella' } }), [
    'stella',
    'stella',
  ])
  // A custom bright slot never promotes the opening line.
  assert.deepEqual(selectVoices({ character: 'whale', sentences: ['好耶！'], voiceMap: { bright: 'tide' } }), [
    'tide',
  ])
})

test('selectVoices: missing slots and unknown voices fall back to the character mapping', () => {
  assert.deepEqual(
    selectVoices({ character: 'chibi', sentences: ['好的', '抱歉'], voiceMap: { base: 'tide' } }),
    ['tide', 'tide'],
  )
  assert.deepEqual(
    selectVoices({ character: 'whale', sentences: ['好的', '好耶！'], voiceMap: { bright: 'nova' } }),
    ['tide', 'stella'],
  )
})

test('selectVoices: available still narrows a custom mapping', () => {
  assert.deepEqual(
    selectVoices({
      character: 'whale',
      sentences: ['好的', '好耶！'],
      voiceMap: { bright: 'stella' },
      available: ['tide'],
    }),
    ['tide', 'tide'],
  )
})

test('selectVoice honours voiceMap on a single sentence', () => {
  assert.equal(selectVoice({ character: 'whale', text: '好耶！' }), 'stella')
  assert.equal(selectVoice({ character: 'whale', text: '好耶！', voiceMap: { bright: 'tide' } }), 'tide')
  assert.equal(selectVoice({ character: 'whale', text: '好的', voiceMap: { base: 'stella' } }), 'stella')
  assert.equal(selectVoice({ character: 'whale', text: '好耶！', voiceMap: { bright: 'nova' } }), 'stella')
})

test('voice profile: clamps speed to the shared window', () => {
  assert.equal(SPEED_MIN, 0.75)
  assert.equal(SPEED_MAX, 1.35)
  assert.equal(clampSpeed(1), 1)
  assert.equal(clampSpeed(0.1), 0.75)
  assert.equal(clampSpeed(9), 1.35)
  assert.equal(clampSpeed(1.234), 1.23)
  assert.equal(clampSpeed('1.2'), 1)
  assert.equal(clampSpeed(Number.NaN), 1)
  assert.equal(clampSpeed(undefined), 1)
})

test('voice profile: drops unknown slots and voices, keeps the known ones', () => {
  assert.deepEqual(DEFAULT_PROFILE, { map: {}, speed: 1 })
  assert.deepEqual(normalizeProfile(undefined), { map: {}, speed: 1 })
  assert.deepEqual(
    normalizeProfile({
      map: { base: 'stella', bright: 'nova', soft: '', loud: 'tide', extra: 7 },
      speed: 9,
    }),
    { map: { base: 'stella' }, speed: 1.35 },
  )
  assert.deepEqual(normalizeProfile({ map: { soft: '  tide  ' }, speed: 0.2 }), {
    map: { soft: 'tide' },
    speed: 0.75,
  })
})

test('voice profile: round-trips through localStorage and survives bad data', () => {
  const cells = new Map()
  global.window = {
    localStorage: {
      getItem: (key) => (cells.has(key) ? cells.get(key) : null),
      setItem: (key, value) => cells.set(key, String(value)),
    },
  }
  try {
    assert.deepEqual(readVoiceProfile(), { map: {}, speed: 1 })

    const written = writeVoiceProfile({ map: { base: 'stella', bright: 'nova' }, speed: 9 })
    assert.deepEqual(written, { map: { base: 'stella' }, speed: 1.35 })
    assert.deepEqual(JSON.parse(cells.get(VOICE_KEY)), written)
    assert.deepEqual(readVoiceProfile(), written)

    cells.set(VOICE_KEY, 'not json')
    assert.deepEqual(readVoiceProfile(), { map: {}, speed: 1 })

    delete global.window
    assert.deepEqual(readVoiceProfile(), { map: {}, speed: 1 })
  } finally {
    delete global.window
  }
})
