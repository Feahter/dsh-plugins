/**
 * Pull-request detail aggregation (node:test, no network).
 *
 * Covers: the four-subrequest happy path, per-section degradation when a
 * subrequest returns 403 (rate limit vs permission), the 100-file bound, and
 * the single-file patch route that keeps patch text out of the aggregate.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const { __testing } = await import('../index.js');
const { github, readPullDetail, readPullFile } = __testing;

const TOKEN = 'ghp_pr_detail_fixture_token_must_not_leak';
const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;
const originalGhToken = process.env.GH_TOKEN;

beforeEach(() => {
  process.env.GITHUB_TOKEN = TOKEN;
  delete process.env.GH_TOKEN;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
  if (originalGhToken === undefined) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = originalGhToken;
});

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function params(extra = {}) {
  return new URLSearchParams({
    full_name: 'octocat/Hello-World',
    number: '34',
    ...extra,
  });
}

const pull = {
  number: 34,
  title: 'Add a feature',
  state: 'open',
  draft: false,
  merged_at: null,
  user: { login: 'bob' },
  labels: [{ name: 'enhancement', color: 'a2eeef' }],
  head: { ref: 'feature', sha: 'head-sha' },
  base: { ref: 'main', sha: 'base-sha' },
  comments: 2,
  review_comments: 1,
  commits: 3,
  additions: 12,
  deletions: 3,
  changed_files: 2,
  mergeable: true,
  mergeable_state: 'clean',
  created_at: '2026-10-03T00:00:00Z',
  updated_at: '2026-10-04T00:00:00Z',
  html_url: 'https://github.com/octocat/Hello-World/pull/34',
  body: 'This adds a feature.',
};

const files = [
  { filename: 'src/a.js', status: 'modified', additions: 10, deletions: 2, changes: 12, patch: '@@ -1 +1 @@\n-old\n+new' },
  { filename: 'logo.png', status: 'added', additions: 0, deletions: 0, changes: 0 },
];
const reviews = [
  { id: 1, user: { login: 'alice' }, state: 'APPROVED', submitted_at: '2026-10-05T00:00:00Z', body: 'LGTM' },
  { id: 2, user: { login: 'carol' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-06T00:00:00Z', body: 'Please split this' },
];
const comments = [
  { id: 11, user: { login: 'bob' }, body: 'Opened for review.', created_at: '2026-10-04T01:00:00Z' },
  { id: 12, user: { login: 'dave' }, body: 'One nit inline.', created_at: '2026-10-05T02:00:00Z' },
];

function stubHappyPath(seen = []) {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34') return json(pull);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/files') return json(files);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/reviews') return json(reviews);
    if (url.pathname === '/repos/octocat/Hello-World/issues/34/comments') return json(comments);
    return json({ message: 'Not Found' }, 404);
  };
}

test('pull detail: aggregates pull, files, reviews and conversation', async () => {
  const seen = [];
  stubHappyPath(seen);
  const detail = await readPullDetail(params());

  assert.equal(detail.repo, 'octocat/Hello-World');
  assert.equal(detail.number, 34);
  assert.equal(detail.partial, false);
  assert.equal(detail.truncated, false);
  assert.deepEqual(detail.missing, []);
  assert.deepEqual(detail.include, ['files', 'reviews', 'conversation']);

  assert.equal(detail.pull.title, 'Add a feature');
  assert.equal(detail.pull.author, 'bob');
  assert.equal(detail.pull.draft, false);
  assert.equal(detail.pull.additions, 12);
  assert.equal(detail.pull.deletions, 3);
  assert.equal(detail.pull.changedFiles, 2);
  assert.equal(detail.pull.mergeableState, 'clean');
  assert.equal(detail.pull.bodyPreview, 'This adds a feature.');

  assert.equal(detail.files.count, 2);
  assert.equal(detail.files.items[0].path, 'src/a.js');
  assert.equal(detail.files.items[0].additions, 10);
  assert.equal(detail.files.items[0].deletions, 2);
  assert.equal(detail.files.items[0].patchAvailable, true);
  assert.equal(detail.files.items[1].patchAvailable, false);
  assert.equal('patch' in detail.files.items[0], false, 'aggregate must not inline patch text');

  assert.equal(detail.reviews.count, 2);
  assert.equal(detail.reviews.items[0].state, 'APPROVED');
  assert.equal(detail.reviews.items[0].author, 'alice');
  assert.equal(detail.reviews.summary.approved, 1);
  assert.equal(detail.reviews.summary.changesRequested, 1);
  assert.equal(detail.reviews.latestState, 'CHANGES_REQUESTED');

  assert.equal(detail.conversation.total, 2);
  assert.equal(detail.conversation.count, 2);
  assert.equal(detail.conversation.items[1].author, 'dave');
  assert.equal(detail.conversation.truncated, false);

  assert.equal(JSON.stringify(detail).includes(TOKEN), false, 'detail must not serialize the credential');

  assert.equal(seen.length, 4, 'one call per subresource');
  assert.ok(seen.some((entry) => entry.startsWith('/repos/octocat/Hello-World/pulls/34/files?per_page=100')));
});

test('pull detail: include narrows the subrequests', async () => {
  const seen = [];
  stubHappyPath(seen);
  const detail = await readPullDetail(params({ include: 'reviews' }));
  assert.deepEqual(detail.include, ['reviews']);
  assert.equal(detail.files, null);
  assert.equal(detail.conversation, null);
  assert.equal(detail.reviews.count, 2);
  assert.equal(seen.length, 2, 'pull + reviews only');
});

test('pull detail: a 403 rate limit on files is recorded, not thrown', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34') return json(pull);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/files') {
      return json({ message: 'API rate limit exceeded for 203.0.113.1.' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1800000000',
      });
    }
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/reviews') return json(reviews);
    if (url.pathname === '/repos/octocat/Hello-World/issues/34/comments') return json(comments);
    return json({ message: 'Not Found' }, 404);
  };

  const detail = await readPullDetail(params());
  assert.equal(detail.partial, true);
  assert.equal(detail.truncated, true);
  assert.equal(detail.pull.title, 'Add a feature', 'the pull record still resolves');
  assert.equal(detail.files.failed, true);
  assert.equal(detail.files.items.length, 0);
  assert.equal(detail.missing.length, 1);
  assert.equal(detail.missing[0].section, 'files');
  assert.equal(detail.missing[0].code, 'rate-limit');
  assert.equal(detail.missing[0].status, 403);
  assert.match(detail.missing[0].message, /rate limit/i);
  assert.equal(detail.reviews.count, 2, 'the other sections still load');
  assert.equal(detail.conversation.count, 2);
});

test('pull detail: a 403 without quota headers means missing permission', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34') return json(pull);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/files') return json(files);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/reviews') {
      return json({ message: 'Resource not accessible by integration' }, 403);
    }
    if (url.pathname === '/repos/octocat/Hello-World/issues/34/comments') return json(comments);
    return json({ message: 'Not Found' }, 404);
  };

  const detail = await readPullDetail(params());
  assert.equal(detail.missing.length, 1);
  assert.equal(detail.missing[0].section, 'reviews');
  assert.equal(detail.missing[0].code, 'forbidden');
  assert.equal(detail.reviews.failed, true);
  assert.equal(detail.files.count, 2);
});

test('pull detail: files are bounded at 100 and marked truncated', async () => {
  const generated = Array.from({ length: 100 }, (_, index) => ({
    filename: `src/f${index}.js`,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@',
  }));
  const filePages = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34') {
      return json({ ...pull, changed_files: 250, comments: 0 });
    }
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/files') {
      filePages.push(url.searchParams.get('page'));
      return json(generated);
    }
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/reviews') return json([]);
    if (url.pathname === '/repos/octocat/Hello-World/issues/34/comments') return json([]);
    return json({ message: 'Not Found' }, 404);
  };

  const detail = await readPullDetail(params());
  assert.equal(detail.files.items.length, 100);
  assert.equal(detail.files.count, 100);
  assert.equal(detail.files.truncated, true);
  assert.equal(detail.truncated, true);
  assert.deepEqual(filePages, ['1'], 'the 100-file cap stops before page 2');
  assert.equal(detail.pull.changedFiles, 250);
});

test('github(): 403 rate limiting and 403 permission errors get distinct codes', async () => {
  globalThis.fetch = async () => json({ message: 'API rate limit exceeded' }, 403, {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': '1800000000',
  });
  await assert.rejects(
    github('/user'),
    (error) => {
      assert.equal(error.code, 'rate-limit');
      assert.equal(error.status, 403);
      assert.match(error.message, /Limit resets at/);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    },
  );

  globalThis.fetch = async () => json({ message: 'Resource not accessible by personal access token' }, 403);
  await assert.rejects(
    github('/user'),
    (error) => {
      assert.equal(error.code, 'forbidden');
      assert.equal(error.status, 403);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    },
  );

  globalThis.fetch = async () => json({ message: 'You have exceeded a secondary rate limit' }, 403, {
    'retry-after': '60',
  });
  await assert.rejects(github('/user'), (error) => error.code === 'rate-limit' && /Retry after 60s/.test(error.message));
});

test('pull-file: reads exactly one patch; aggregate never carries patch text', async () => {
  stubHappyPath();
  const detail = await readPullDetail(params({ include: 'files' }));
  assert.ok(!JSON.stringify(detail).includes('+new'));

  stubHappyPath();
  const file = await readPullFile(params({ path: 'src/a.js' }));
  assert.equal(file.path, 'src/a.js');
  assert.equal(file.patchAvailable, true);
  assert.match(file.patch, /\+new/);
  assert.equal(file.truncated, false);

  stubHappyPath();
  const missing = await readPullFile(params({ path: 'not/changed.js' }));
  assert.equal(missing.patchAvailable, false);
  assert.equal(missing.reason, 'file-not-found');
});

test('pull detail: a long conversation reads its last page for the latest comments', async () => {
  const lastPage = Array.from({ length: 50 }, (_, index) => ({
    id: 100 + index,
    user: { login: 'user' + index },
    body: 'comment ' + (100 + index),
    created_at: '2026-10-04T01:00:00Z',
  }));
  const pages = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34') {
      return json({ ...pull, comments: 150, changed_files: 0 });
    }
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/files') return json([]);
    if (url.pathname === '/repos/octocat/Hello-World/pulls/34/reviews') return json([]);
    if (url.pathname === '/repos/octocat/Hello-World/issues/34/comments') {
      const page = url.searchParams.get('page');
      pages.push(page);
      if (page === '1') {
        return json(
          Array.from({ length: 100 }, (_, index) => ({ id: index, user: { login: 'early' }, body: 'early', created_at: '2026-01-01T00:00:00Z' })),
          200,
          { link: '<https://api.github.com/repos/octocat/Hello-World/issues/34/comments?per_page=100&page=2>; rel="last"' },
        );
      }
      return json(lastPage);
    }
    return json({ message: 'Not Found' }, 404);
  };

  const detail = await readPullDetail(params());
  assert.deepEqual(pages, ['1', '2'], 'the first page discovers the last page');
  assert.equal(detail.conversation.total, 150);
  assert.equal(detail.conversation.count, 10);
  assert.equal(detail.conversation.truncated, true);
  assert.equal(detail.conversation.items[9].id, 149, 'the preview is the tail of the last page');
});

test('pull detail: invalid number and include are rejected', async () => {
  await assert.rejects(readPullDetail(params({ number: 'abc' })), (error) => error.code === 'invalid-argument');
  await assert.rejects(readPullDetail(params({ include: 'files,patches' })), (error) => error.code === 'invalid-argument');
  await assert.rejects(readPullFile(params({ path: '' })), (error) => error.code === 'invalid-argument');
});
