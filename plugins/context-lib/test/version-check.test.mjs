// version-check.js 的纯逻辑与缓存测试：不联网，fetch 全部由假实现提供。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseSemver,
  compareSemver,
  isNewer,
  pickIndexEntry,
  createVersionChecker,
} from '../version-check.js'

const INDEX = {
  format: 1,
  plugins: [
    {
      name: 'dsh-context-lib',
      homepage: 'https://github.com/Feahter/dsh-plugins/tree/main/plugins/context-lib',
      versions: [{ version: '0.2.0' }, { version: '0.2.3' }, { version: '0.2.2-rc.1' }],
    },
    { name: 'dsh-other', versions: [{ version: '9.9.9' }] },
  ],
}

function indexFetch(index = INDEX, fail = false) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (fail) throw new Error('offline')
    return { ok: true, json: async () => index }
  }
  return { fetchImpl, calls }
}

test('parseSemver 接受 v 前缀、预发布与构建元数据', () => {
  assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3, rank: 4, serial: 0 })
  assert.deepEqual(parseSemver('v0.2.2-rc.4'), { major: 0, minor: 2, patch: 2, rank: 3, serial: 4 })
  assert.equal(parseSemver('1.2'), null)
  assert.equal(parseSemver(''), null)
  assert.equal(parseSemver(null), null)
})

test('compareSemver：主次补丁、预发布优先级、稳定版最高', () => {
  assert.ok(compareSemver('0.2.3', '0.2.2') > 0)
  assert.ok(compareSemver('0.3.0', '0.2.9') > 0)
  assert.equal(compareSemver('0.2.2', '0.2.2'), 0)
  assert.ok(compareSemver('0.2.2-rc.1', '0.2.2-alpha.9') > 0)
  assert.ok(compareSemver('0.2.2-rc.2', '0.2.2-rc.1') > 0)
  assert.ok(compareSemver('0.2.2', '0.2.2-rc.9') > 0)
  assert.equal(compareSemver('x', '1.0.0'), null)
})

test('isNewer：无法解析一律 false，本地领先不报更新', () => {
  assert.equal(isNewer('0.2.3', '0.2.2'), true)
  assert.equal(isNewer('0.2.2', '0.2.3'), false)
  assert.equal(isNewer('0.2.2', '0.2.2'), false)
  assert.equal(isNewer('garbage', '0.2.2'), false)
})

test('pickIndexEntry 取最高版本而不是数组首项', () => {
  const entry = pickIndexEntry(INDEX, 'dsh-context-lib')
  assert.equal(entry.latest, '0.2.3')
  assert.match(entry.homepage, /plugins\/context-lib$/)
  assert.equal(pickIndexEntry(INDEX, 'dsh-missing'), null)
})

test('checker 比较已装版本与索引版本', async () => {
  const { fetchImpl } = indexFetch()
  const checker = createVersionChecker({ pluginName: 'dsh-context-lib', fetchImpl, now: () => 1000 })
  const result = await checker.check()
  assert.equal(result.plugin, 'dsh-context-lib')
  assert.equal(result.current, '0.2.2')
  assert.equal(result.latest, '0.2.3')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.failed, false)
  assert.equal(result.checkedAt, 1000)
})

test('checker 索引落后于本地版本时不报更新', async () => {
  const index = {
    plugins: [{ name: 'dsh-context-lib', homepage: 'x', versions: [{ version: '0.1.0' }] }],
  }
  const checker = createVersionChecker({ pluginName: 'dsh-context-lib', fetchImpl: indexFetch(index).fetchImpl })
  const result = await checker.check()
  assert.equal(result.updateAvailable, false)
})

test('checker 网络失败标记 failed 且不抛错，缓存期内不再重试', async () => {
  const { fetchImpl, calls } = indexFetch(INDEX, true)
  let clock = 500
  const checker = createVersionChecker({ pluginName: 'dsh-context-lib', fetchImpl, now: () => clock })
  const first = await checker.check()
  assert.equal(first.failed, true)
  assert.equal(first.latest, null)
  assert.equal(first.updateAvailable, null)
  assert.equal(first.current, '0.2.2')
  clock += 60_000
  await checker.check()
  assert.equal(calls.length, 2, '两个 index 源各试一次，缓存期内不再请求')
  clock += 3_600_000
  await checker.check({ refresh: true })
  assert.equal(calls.length, 4)
})

test('checker 在索引里找不到插件时 failed 为 false、latest 为 null', async () => {
  const checker = createVersionChecker({ pluginName: 'dsh-not-there', fetchImpl: indexFetch().fetchImpl })
  const result = await checker.check()
  assert.equal(result.latest, null)
  assert.equal(result.updateAvailable, null)
  assert.equal(result.failed, false)
})
