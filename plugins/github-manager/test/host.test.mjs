/**
 * dsh-github-manager — Host-side regression tests (node:test, no network, no
 * real token).
 *
 * Covers the two credential/transport defects:
 *   1. hosts.yml token scoping: a token stored for a GitHub Enterprise host must
 *      never be sent to api.github.com;
 *   2. every REST call carries a bounded abort budget, and a timeout surfaces as
 *      a structured `timeout` error instead of hanging the route forever.
 *
 * `fetch` is stubbed per test; nothing leaves the process.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

const { __testing } = await import('../index.js')
const { github, pickHostsToken, requestSignal, setDefaultTimeout } = __testing

const TOKEN = 'ghp_test_token_that_must_never_leak'
const originalFetch = globalThis.fetch
const originalToken = process.env.GITHUB_TOKEN

beforeEach(() => {
  process.env.GITHUB_TOKEN = TOKEN
})
afterEach(() => {
  setDefaultTimeout(undefined) // restore the production 20s default
  globalThis.fetch = originalFetch
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN
  else process.env.GITHUB_TOKEN = originalToken
})

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  }
}

test('hosts.yml: only the github.com oauth_token is used', () => {
  const mixed = [
    'ghe.corp.example:',
    '    user: enterprise-user',
    '    oauth_token: ghe-token-must-not-be-used',
    'github.com:',
    '    user: octocat',
    '    oauth_token: github-token',
    '',
  ].join('\n')
  assert.equal(pickHostsToken(mixed), 'github-token')

  // Regression: with only an enterprise host present the old fallback returned
  // that host's token, which would then be sent to api.github.com.
  const enterpriseOnly = [
    'ghe.corp.example:',
    '    user: enterprise-user',
    '    oauth_token: ghe-token-must-not-be-used',
    '',
  ].join('\n')
  assert.equal(pickHostsToken(enterpriseOnly), '')

  // A leading comment must not hide the github.com block.
  const commented = [
    '# managed by gh auth login',
    'github.com:',
    '    oauth_token: github-token',
    '',
  ].join('\n')
  assert.equal(pickHostsToken(commented), 'github-token')
  assert.equal(pickHostsToken(''), '')
})

test('github(): sends the bearer token and user-agent, never logs the token', async () => {
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init })
    return jsonResponse({ login: 'octocat' })
  }

  const { data } = await github('/user')
  assert.equal(data.login, 'octocat')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.github.com/user')
  assert.equal(seen[0].init.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(seen[0].init.headers['user-agent'], 'dsh-github-manager/1.0')
  assert.ok(seen[0].init.signal instanceof AbortSignal, 'the request must carry an abort signal')

  // Rejecting the token must not echo it into the error the panel renders.
  globalThis.fetch = async () => jsonResponse({ message: 'Bad credentials' }, 401)
  await assert.rejects(
    github('/user'),
    (error) => {
      assert.equal(error.code, 'auth')
      assert.equal(error.status, 401)
      assert.ok(!error.message.includes(TOKEN), 'token leaked into the error message')
      return true
    },
  )
})

test('github(): a 401 clears the cached token and retries once with a fresh lookup', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return calls === 1 ? jsonResponse({ message: 'Bad credentials' }, 401) : jsonResponse({ login: 'octocat' })
  }
  const { data } = await github('/user')
  assert.equal(data.login, 'octocat')
  assert.equal(calls, 2)
})

test('github(): a network failure becomes a structured network error', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  await assert.rejects(
    github('/user'),
    (error) => {
      assert.equal(error.code, 'network')
      assert.match(error.message, /Cannot reach api\.github\.com/)
      assert.ok(!error.message.includes(TOKEN))
      return true
    },
  )
})

test('github(): a stalled request is aborted by the default budget (no timeoutMs passed)', async () => {
  setDefaultTimeout(40)
  globalThis.fetch = (url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })
  const started = Date.now()
  await assert.rejects(
    github('/user'),
    (error) => {
      assert.equal(error.code, 'timeout')
      assert.match(error.message, /did not answer within 40ms/)
      return true
    },
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 30, `aborted too early (${elapsed}ms): a smaller budget leaked in`)
  assert.ok(elapsed < 2000, 'the abort budget was not enforced')
})

test('requestSignal(): keeps the caller signal and adds its own budget', () => {
  const caller = new AbortController()
  const combined = requestSignal(caller.signal, 40)
  assert.ok(combined instanceof AbortSignal)
  assert.equal(combined.aborted, false)
  caller.abort()
  assert.equal(combined.aborted, true)

  const alone = requestSignal(undefined, 60_000)
  assert.ok(alone instanceof AbortSignal)
  assert.equal(alone.aborted, false)
})
