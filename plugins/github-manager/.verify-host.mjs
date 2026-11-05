/**
 * Standalone verification for the Host half: imports the plugin with a mock
 * Cordis context and a stubbed global fetch, then drives the real WebRoute
 * handler (Node request/response objects) for every panel route, plus every
 * agent tool, against canned GitHub responses.
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const captured = { tools: new Map(), route: null, effects: 0, rejection: undefined, connection: true };
const fakeConnection = {
  requestRejection() {
    return captured.rejection;
  },
};
const ctx = {
  get(name) {
    return name === 'connection' && captured.connection ? fakeConnection : undefined;
  },
  tools: {
    register(definition) {
      assert.equal(captured.tools.has(definition.name), false, 'duplicate tool ' + definition.name);
      captured.tools.set(definition.name, definition);
      return () => captured.tools.delete(definition.name);
    },
  },
  webServer: {
    register(route) {
      captured.route = route;
      return () => {};
    },
  },
  effect(callback) {
    captured.effects += 1;
    const disposer = callback();
    return typeof disposer === 'function' ? disposer : () => {};
  },
};

process.env.GH_TOKEN = 'test-token';
delete process.env.GITHUB_TOKEN;

const repo = {
  full_name: 'octocat/Hello-World',
  name: 'Hello-World',
  owner: { login: 'octocat' },
  description: 'My first repository on GitHub!',
  private: false,
  fork: false,
  archived: false,
  disabled: false,
  language: 'JavaScript',
  stargazers_count: 42,
  forks_count: 7,
  open_issues_count: 3,
  default_branch: 'main',
  topics: ['demo'],
  updated_at: '2026-11-04T10:00:00Z',
  pushed_at: '2026-11-04T09:00:00Z',
  created_at: '2020-01-01T00:00:00Z',
  html_url: 'https://github.com/octocat/Hello-World',
  clone_url: 'https://github.com/octocat/Hello-World.git',
  ssh_url: 'git@github.com:octocat/Hello-World.git',
};

const issue = {
  number: 12,
  title: 'Something is broken',
  state: 'open',
  state_reason: null,
  user: { login: 'alice' },
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [{ login: 'octocat' }],
  comments: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  closed_at: null,
  html_url: 'https://github.com/octocat/Hello-World/issues/12',
  body: 'Steps to reproduce…',
};

const pull = {
  number: 34,
  title: 'Add a feature',
  state: 'open',
  draft: false,
  merged_at: null,
  user: { login: 'bob' },
  labels: [{ name: 'enhancement', color: 'a2eeef' }],
  head: { ref: 'feature' },
  base: { ref: 'main' },
  comments: 1,
  review_comments: 2,
  created_at: '2026-10-03T00:00:00Z',
  updated_at: '2026-10-04T00:00:00Z',
  html_url: 'https://github.com/octocat/Hello-World/pull/34',
  body: 'This adds a feature.',
};

const calls = [];
const issuePages = [];
function json(status, data, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...(extraHeaders || {}) },
  });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = (init && init.method) || 'GET';
  calls.push({ path: url.pathname, search: url.search, method, body: init && init.body ? JSON.parse(init.body) : undefined });
  if (url.pathname === '/user') {
    return json(200, {
      login: 'octocat',
      name: 'The Octocat',
      avatar_url: 'https://avatars.example/octocat.png',
      html_url: 'https://github.com/octocat',
      public_repos: 8,
      total_private_repos: 2,
    }, { 'x-oauth-scopes': 'repo' });
  }
  if (url.pathname === '/rate_limit') {
    return json(200, { resources: { core: { remaining: 4999, limit: 5000, reset: 1800000000 } } });
  }
  if (url.pathname === '/user/repos') return json(200, [repo]);
  if (url.pathname === '/repos/octocat/Hello-World') return json(200, repo);
  if (url.pathname === '/repos/octocat/Hello-World/issues' && method === 'GET') {
    const page = Number(url.searchParams.get('page') || '1');
    issuePages.push(page);
    // Page 1 is dominated by pull requests to exercise the paging loop.
    if (page === 1) {
      return json(200, Array.from({ length: 100 }, (_, index) => ({
        ...issue,
        number: 1000 + index,
        title: 'PR ' + index,
        pull_request: { url: 'x' },
      })));
    }
    return json(200, [issue, { ...issue, number: 13, title: 'Another issue' }]);
  }
  if (url.pathname === '/repos/octocat/Hello-World/issues' && method === 'POST') {
    return json(201, { number: 56, title: 'New issue', state: 'open', html_url: 'https://github.com/octocat/Hello-World/issues/56', pull_request: undefined });
  }
  if (url.pathname === '/repos/octocat/Hello-World/issues/12' && method === 'PATCH') {
    return json(200, { ...issue, state: 'closed', html_url: 'https://github.com/octocat/Hello-World/issues/12' });
  }
  if (url.pathname === '/repos/octocat/Hello-World/issues/12/comments' && method === 'POST') {
    return json(201, { id: 777, html_url: 'https://github.com/octocat/Hello-World/issues/12#issuecomment-777', created_at: '2026-11-05T00:00:00Z' });
  }
  if (url.pathname === '/repos/octocat/Hello-World/pulls') return json(200, [pull]);
  if (url.pathname === '/repos/private/repo/issues' && method === 'POST') {
    return json(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  }
  if (url.pathname === '/repos/private/repo') {
    return json(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  }
  return json(404, { message: 'Not Found' });
};

const plugin = await import(new URL('./index.js', import.meta.url).href + '?verify=' + Date.now());
plugin.apply(ctx);

// Registration
assert.equal(captured.tools.size, 8, 'all github_* tools registered');
assert.deepEqual([...captured.tools.keys()].sort(), [
  'github_comment_issue', 'github_create_issue', 'github_get_repo', 'github_list_issues',
  'github_list_pulls', 'github_list_repos', 'github_status', 'github_update_issue',
]);
assert.ok(captured.route, 'web route registered');
assert.equal(captured.route.kind, 'prefix');
assert.equal(captured.route.path, '/api/github-manager');
assert.equal(typeof captured.route.handler, 'function', 'registered as a raw WebRoute handler (POST-capable)');
assert.equal(captured.route.resource, undefined);

// ---------------------------------------------------------------------- tools

const status = await captured.tools.get('github_status').execute({});
assert.equal(status.configured, true);
assert.equal(status.login, 'octocat');
assert.equal(status.scopes, 'repo');
assert.equal(status.rateLimit.remaining, 4999);

const repos = await captured.tools.get('github_list_repos').execute({ limit: 5, visibility: 'public' });
assert.equal(repos.count, 1);
assert.equal(repos.items[0].fullName, 'octocat/Hello-World');
assert.equal(repos.items[0].openItems, 3);
const repoCall = calls.find((call) => call.path === '/user/repos');
assert.match(repoCall.search, /affiliation=owner%2Ccollaborator%2Corganization_member/);
assert.match(repoCall.search, /per_page=5/);

const one = await captured.tools.get('github_get_repo').execute({ repo: 'octocat/Hello-World' });
assert.equal(one.defaultBranch, 'main');
assert.equal(one.stars, 42);

const issues = await captured.tools.get('github_list_issues').execute({ repo: 'octocat/Hello-World', state: 'open', limit: 10 });
assert.equal(issues.count, 2, 'pull requests are filtered out and a second page is fetched');
assert.deepEqual(issuePages, [1, 2], 'paging stops once enough real issues are collected');
assert.equal(issues.items[0].number, 12);
assert.equal(issues.items[0].labels[0].name, 'bug');

const created = await captured.tools.get('github_create_issue').execute({ repo: 'octocat/Hello-World', title: 'New issue', labels: ['bug'] });
assert.equal(created.number, 56);
const createCall = calls.find((call) => call.path === '/repos/octocat/Hello-World/issues' && call.method === 'POST');
assert.deepEqual(createCall.body, { title: 'New issue', labels: ['bug'] });

const updated = await captured.tools.get('github_update_issue').execute({ repo: 'octocat/Hello-World', number: 12, state: 'closed' });
assert.equal(updated.state, 'closed');
const updateCall = calls.find((call) => call.method === 'PATCH');
assert.deepEqual(updateCall.body, { state: 'closed' });

const comment = await captured.tools.get('github_comment_issue').execute({ repo: 'octocat/Hello-World', number: 12, body: 'Thanks!' });
assert.equal(comment.id, 777);

const pulls = await captured.tools.get('github_list_pulls').execute({ repo: 'octocat/Hello-World' });
assert.equal(pulls.items[0].number, 34);
assert.equal(pulls.items[0].base, 'main');

// Argument validation must surface as readable errors.
await assert.rejects(
  () => captured.tools.get('github_list_issues').execute({ repo: 'not-a-repo' }),
  (error) => /owner\/name/.test(error.message),
);
await assert.rejects(
  () => captured.tools.get('github_get_repo').execute({ repo: 'private/repo' }),
  (error) => /401/.test(error.message) && /Bad credentials/.test(error.message),
);
await assert.rejects(
  () => captured.tools.get('github_update_issue').execute({ repo: 'octocat/Hello-World', number: 12, state: null }),
  (error) => /"state" must be exactly/.test(error.message),
);

// ------------------------------------------------------- real WebRoute requests

function fakeRequest(method, path, body, headers) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = path;
  request.headers = headers || { host: '127.0.0.1:60304' };
  return request;
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    finished: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk);
      this.finished = true;
    },
  };
}

async function request(method, path, body, headers) {
  const req = fakeRequest(method, path, body, headers);
  const res = fakeResponse();
  await captured.route.handler(req, res);
  let payload = null;
  try {
    payload = res.body ? JSON.parse(res.body) : null;
  } catch {
    payload = res.body;
  }
  return { status: res.statusCode, headers: res.headers, body: payload };
}

let response = await request('GET', '/api/github-manager/status');
assert.equal(response.status, 200);
assert.equal(response.body.ok, true);
assert.equal(response.body.data.login, 'octocat');

response = await request('GET', '/api/github-manager/repos?limit=5');
assert.equal(response.body.data.count, 1);

response = await request('GET', '/api/github-manager/issues?full_name=octocat/Hello-World&state=open');
assert.equal(response.body.data.items.length, 2);

response = await request('GET', '/api/github-manager/pulls?full_name=octocat/Hello-World');
assert.equal(response.body.data.items[0].draft, false);

// Writes: these are the requests the old resource-based route could not carry.
response = await request('POST', '/api/github-manager/issue', { full_name: 'octocat/Hello-World', title: 'From the panel', body: 'Body', labels: ['bug'] });
assert.equal(response.status, 200);
assert.equal(response.body.ok, true);
assert.equal(response.body.data.number, 56);

response = await request('POST', '/api/github-manager/issue-state', { full_name: 'octocat/Hello-World', number: 12, state: 'closed' });
assert.equal(response.status, 200);
assert.equal(response.body.data.state, 'closed');

response = await request('POST', '/api/github-manager/comment', { full_name: 'octocat/Hello-World', number: 12, body: 'hi' });
assert.equal(response.status, 200);
assert.equal(response.body.data.id, 777);

// HTTP semantics
response = await request('HEAD', '/api/github-manager/status');
assert.equal(response.status, 200);
assert.equal(response.body, null, 'HEAD carries no body');

response = await request('PUT', '/api/github-manager/status', {});
assert.equal(response.status, 405);
assert.equal(response.headers.allow, 'GET, HEAD, POST');

response = await request('GET', '/api/github-manager/issues?full_name=nope');
assert.equal(response.status, 400);
assert.equal(response.body.ok, false);
assert.match(response.body.error.message, /owner\/name/);

response = await request('GET', '/api/github-manager/nope');
assert.equal(response.status, 404);

// GitHub API errors keep their HTTP status.
response = await request('POST', '/api/github-manager/issue', { full_name: 'private/repo', title: 'nope' });
assert.equal(response.status, 401);
assert.match(response.body.error.message, /Bad credentials/);

// The route applies Connection's admission: a rejected request never reaches GitHub.
captured.rejection = 401;
response = await request('GET', '/api/github-manager/status');
assert.equal(response.status, 401);
assert.equal(response.body.error.code, 'unauthorized');
captured.rejection = undefined;
response = await request('GET', '/api/github-manager/status');
assert.equal(response.status, 200);

// Without the connection service the route fails closed instead of serving data.
captured.connection = false;
response = await request('GET', '/api/github-manager/status');
assert.equal(response.status, 503);
assert.equal(response.body.error.code, 'unavailable');
captured.connection = true;

// A cross-origin Origin is rejected before any GitHub call.
captured.rejection = 403;
response = await request('GET', '/api/github-manager/status', undefined, { host: '127.0.0.1:60304', origin: 'http://evil.example' });
assert.equal(response.status, 403);
captured.rejection = undefined;

// gh CLI fallback: a fake `gh auth token` must be picked up without a restart.
const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join: joinPath } = await import('node:path');
const ghDir = await mkdtemp(joinPath(tmpdir(), 'ghm-gh-'));
try {
  const ghBin = joinPath(ghDir, 'gh');
  await writeFile(ghBin, '#!/bin/sh\necho gho_fake_token\n');
  await chmod(ghBin, 0o755);
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.GITHUB_MANAGER_GH_BIN = ghBin;
  response = await request('GET', '/api/github-manager/status');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.configured, true);
  assert.equal(response.body.data.tokenSource, 'gh-cli');
  assert.equal(response.body.data.login, 'octocat');
} finally {
  delete process.env.GITHUB_MANAGER_GH_BIN;
  await rm(ghDir, { recursive: true, force: true });
}
process.env.GITHUB_MANAGER_DISABLE_GH = '1';
response = await request('GET', '/api/github-manager/status');
assert.equal(response.body.data.configured, false);
delete process.env.GITHUB_MANAGER_DISABLE_GH;

// A missing token is reported as a configuration problem, not a crash.
delete process.env.GH_TOKEN;
delete process.env.GITHUB_TOKEN;
const missing = await captured.tools.get('github_status').execute({});
assert.equal(missing.configured, false);
await assert.rejects(
  () => captured.tools.get('github_list_repos').execute({}),
  (error) => /gh auth login/.test(error.message) && /GH_TOKEN/.test(error.message),
);
response = await request('POST', '/api/github-manager/issue', { full_name: 'octocat/Hello-World', title: 'x' });
assert.equal(response.status, 502, 'unconfigured token maps to a bad-gateway response');

console.log('host verification passed:', captured.tools.size, 'tools,', calls.length, 'stubbed GitHub calls,', issuePages.length, 'issue pages');
