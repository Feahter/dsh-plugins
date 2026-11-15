import assert from 'node:assert/strict'
import test from 'node:test'

import { patchWavHeader, readApiKeyFromConfig, wavDurationMs } from '../host/tts.js'

/** Build a canonical 44-byte RIFF header with the size fields left at zero, then `payload` bytes. */
function streamingWav(payload) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24_000, 24)
  header.writeUInt32LE(48_000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  return Buffer.concat([header, payload])
}

test('patchWavHeader fills the two size fields a streaming response leaves at zero', () => {
  const raw = streamingWav(Buffer.alloc(48_000))
  assert.equal(raw.readUInt32LE(4), 0)
  assert.equal(raw.readUInt32LE(40), 0)
  const fixed = patchWavHeader(raw)
  assert.equal(fixed.readUInt32LE(4), fixed.length - 8)
  assert.equal(fixed.readUInt32LE(40), 48_000)
  assert.equal(fixed.length, raw.length)
})

test('patchWavHeader leaves a non-WAV buffer untouched', () => {
  const notWav = Buffer.from('not a wav file at all, definitely not one', 'utf8')
  assert.deepEqual(patchWavHeader(notWav), notWav)
})

test('patchWavHeader leaves a non-canonical chunk layout untouched', () => {
  const odd = streamingWav(Buffer.alloc(16))
  odd.write('LIST', 36, 'ascii')
  assert.equal(patchWavHeader(odd), odd)
})

test('wavDurationMs measures the body at 24 kHz 16-bit mono', () => {
  const twoSeconds = streamingWav(Buffer.alloc(48_000 * 2))
  assert.equal(wavDurationMs(twoSeconds), 2000)
})

test('readApiKeyFromConfig prefers the provider-scoped key', () => {
  const text = [
    '# comment',
    'provider = "deepseek"',
    'api_key = "top-level-key"',
    '',
    '[providers.deepseek]',
    'api_key = "scoped-key"',
  ].join('\n')
  assert.equal(readApiKeyFromConfig(text), 'scoped-key')
})

test('readApiKeyFromConfig falls back to the top-level key', () => {
  assert.equal(readApiKeyFromConfig('api_key = "only-top"\nprovider = "deepseek"\n'), 'only-top')
})

test('readApiKeyFromConfig ignores an empty value and unrelated sections', () => {
  const text = ['api_key = ""', '', '[providers.other]', 'api_key = "other-key"'].join('\n')
  assert.equal(readApiKeyFromConfig(text), undefined)
})
