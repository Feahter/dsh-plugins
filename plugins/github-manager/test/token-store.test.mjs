/**
 * Local credential vault (node:test, no network, no real credential files).
 *
 * Electron safeStorage is stubbed. Every case points the store at a fresh temp
 * directory, and the assertions check the bytes that would land on disk — not
 * just the in-memory API.
 */
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const { __testing } = await import('../index.js');
const {
  tokenStorePath,
  saveStoredToken,
  resolveToken,
  initializeTokenStore,
  resetTokenStore,
  resetTokenCache,
  setSafeStorageAdapter,
  encryptionAvailable,
  readStatus,
  github,
} = __testing;

const TOKEN = 'ghp_token_store_fixture_that_must_never_leak';
const MASK = 0x5a;

const savedEnv = {
  GH_TOKEN: process.env.GH_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_MANAGER_DISABLE_GH: process.env.GITHUB_MANAGER_DISABLE_GH,
  GITHUB_MANAGER_TOKEN_FILE: process.env.GITHUB_MANAGER_TOKEN_FILE,
  GITHUB_MANAGER_GH_HOSTS_FILE: process.env.GITHUB_MANAGER_GH_HOSTS_FILE,
};
const originalFetch = globalThis.fetch;

let dir = '';

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ghm-token-'));
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.GITHUB_MANAGER_DISABLE_GH = '1';
  process.env.GITHUB_MANAGER_TOKEN_FILE = join(dir, 'credentials.json');
  process.env.GITHUB_MANAGER_GH_HOSTS_FILE = join(dir, 'missing-hosts.yml');
  setSafeStorageAdapter(null);
  resetTokenStore();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  setSafeStorageAdapter(null);
  resetTokenStore();
  restoreEnv();
  await rm(dir, { recursive: true, force: true });
});

// A reversible stand-in for the OS keychain. The stored bytes are scrambled,
// so "does the file contain the token?" is a meaningful assertion.
function xorEncrypt(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= MASK;
  return bytes;
}

function safeStorageStub({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString(value) {
      if (!available) throw new Error('encryption unavailable');
      return xorEncrypt(value);
    },
    decryptString(buffer) {
      if (!available) throw new Error('encryption unavailable');
      const bytes = Buffer.from(buffer);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= MASK;
      return bytes.toString('utf8');
    },
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('safeStorage available: the file holds ciphertext only and reads back', async () => {
  setSafeStorageAdapter(safeStorageStub());
  assert.equal(encryptionAvailable(), true);

  const saved = await saveStoredToken(TOKEN);
  assert.equal(saved.storage, 'safeStorage');
  assert.equal(saved.persisted, true);
  assert.equal(saved.degraded, false);

  const file = tokenStorePath();
  const raw = await readFile(file, 'utf8');
  assert.equal(raw.includes(TOKEN), false, 'plaintext token must never reach disk');
  const record = JSON.parse(raw);
  assert.equal(record.storage, 'safeStorage');
  assert.equal(typeof record.ciphertext, 'string');
  assert.equal(record.ciphertext.includes(TOKEN), false);
  assert.equal(
    Buffer.from(record.ciphertext, 'base64').toString('utf8').includes(TOKEN),
    false,
    'the decoded blob must not be the plaintext token',
  );
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600, 'credential file is owner-only');
  }

  resetTokenStore();
  const resolved = await resolveToken(true);
  assert.equal(resolved.value, TOKEN);
  assert.equal(resolved.source, 'local-store');
  assert.equal(resolved.storage, 'safeStorage');
  assert.equal(resolved.warning, '');
});

test('safeStorage unavailable: no plaintext file, token stays in memory', async () => {
  setSafeStorageAdapter(safeStorageStub({ available: false }));
  assert.equal(encryptionAvailable(), false);

  const saved = await saveStoredToken(TOKEN);
  assert.equal(saved.storage, 'memory-degraded');
  assert.equal(saved.persisted, false);
  assert.equal(saved.degraded, true);
  assert.equal(saved.warning, 'encryption-unavailable');
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);

  await assert.rejects(access(tokenStorePath()), /ENOENT/, 'nothing may be written without encryption');

  const resolved = await resolveToken(true);
  assert.equal(resolved.value, TOKEN);
  assert.equal(resolved.source, 'memory');
  assert.equal(resolved.storage, 'memory-degraded');
  assert.equal(resolved.warning, 'encryption-unavailable');
});

test('legacy plaintext file is migrated in place to ciphertext', async () => {
  const file = tokenStorePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ token: TOKEN }), 'utf8');

  setSafeStorageAdapter(safeStorageStub());
  resetTokenStore();
  const state = await initializeTokenStore();
  assert.equal(state.value, TOKEN);
  assert.equal(state.storage, 'safeStorage');
  assert.equal(state.migrated, true);
  assert.equal(state.warning, '');

  const raw = await readFile(file, 'utf8');
  assert.equal(raw.includes(TOKEN), false, 'migration must replace the plaintext');
  assert.equal(JSON.parse(raw).storage, 'safeStorage');

  resetTokenStore();
  const resolved = await resolveToken(true);
  assert.equal(resolved.value, TOKEN);
  assert.equal(resolved.source, 'local-store');
});

test('migration failure keeps the original file and the token', async () => {
  const file = tokenStorePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ token: TOKEN }), 'utf8');

  setSafeStorageAdapter({
    isEncryptionAvailable: () => true,
    encryptString() {
      throw new Error('keychain is locked');
    },
    decryptString() {
      throw new Error('keychain is locked');
    },
  });
  resetTokenStore();
  const state = await initializeTokenStore();
  assert.equal(state.value, TOKEN, 'the credential must not be lost');
  assert.equal(state.storage, 'plaintext-degraded');
  assert.equal(state.warning, 'migration-failed');
  assert.equal(state.migrated, false);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).token, TOKEN, 'original file untouched');
});

test('legacy plaintext without safeStorage is degraded but not modified', async () => {
  const file = tokenStorePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ token: TOKEN }), 'utf8');

  setSafeStorageAdapter(safeStorageStub({ available: false }));
  resetTokenStore();
  const state = await initializeTokenStore();
  assert.equal(state.value, TOKEN);
  assert.equal(state.storage, 'plaintext-degraded');
  assert.equal(state.warning, 'encryption-unavailable');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).token, TOKEN);
});

test('status and errors never serialize the token', async () => {
  process.env.GH_TOKEN = TOKEN;
  resetTokenCache();
  globalThis.fetch = async (input) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname === '/user') {
      return json({ login: 'octocat', name: 'The Octocat', public_repos: 1 });
    }
    if (pathname === '/rate_limit') {
      return json({ resources: { core: { remaining: 1, limit: 2, reset: 1800000000 } } });
    }
    return json({ message: 'Not Found' }, 404);
  };

  const status = await readStatus(true);
  assert.equal(status.configured, true);
  assert.equal(status.tokenSource, 'env');
  assert.equal(status.tokenStorage, 'environment');
  assert.equal(JSON.stringify(status).includes(TOKEN), false);

  globalThis.fetch = async () => json({ message: 'Bad credentials' }, 401);
  await assert.rejects(
    github('/user'),
    (error) => {
      assert.equal(error.code, 'auth');
      assert.equal(JSON.stringify(error).includes(TOKEN), false);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    },
  );

  delete process.env.GH_TOKEN;
  setSafeStorageAdapter(safeStorageStub());
  resetTokenCache();
  const saved = await saveStoredToken(TOKEN);
  assert.equal(JSON.stringify(saved).includes(TOKEN), false, 'save response must not echo the token');
  resetTokenStore();
  const resolved = await resolveToken(true);
  assert.equal(resolved.value, TOKEN);
  assert.equal(JSON.stringify({ source: resolved.source, storage: resolved.storage }).includes(TOKEN), false);
});
