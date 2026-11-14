/**
 * Host half of the GitHub project manager bundle.
 *
 * One GitHub REST client serves two surfaces:
 * - Agent tools (`github_*`) for querying and managing repositories, issues, and pull requests.
 * - A same-origin JSON route (`/api/github-manager/*`) for the Web panel.
 *
 * The credential is resolved Host-side and never reaches the browser:
 * 1. `GH_TOKEN` / `GITHUB_TOKEN` in the Host process environment.
 * 2. The `gh` CLI login (`gh auth token`), including keyring-backed accounts.
 * 3. `~/.config/gh/hosts.yml` when it stores an `oauth_token`.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API_ROOT = 'https://api.github.com';
const ROUTE_PREFIX = '/api/github-manager';
const USER_AGENT = 'dsh-github-manager/1.0';
const MAX_BODY_BYTES = 256 * 1024;
const TOKEN_TTL_MS = 60_000;
const TOKEN_FAILURE_TTL_MS = 15_000;
const ENRICH_LIMIT = 8;
const MAX_TEXT_CHARS = 200000;
const MAX_FILE_BYTES = 512 * 1024;

class GithubError extends Error {
  constructor(message, { code = 'github-error', status = 0 } = {}) {
    super(message);
    this.name = 'GithubError';
    this.code = code;
    this.status = status;
  }
}

// --------------------------------------------------------------- credentials

let tokenCache = { value: '', source: '', at: 0 };
let tokenPending = null;

function envToken() {
  const raw = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  return raw.trim();
}

function ghFallbackDisabled() {
  const flag = process.env.GITHUB_MANAGER_DISABLE_GH;
  return flag === '1' || flag === 'true';
}

function runGhToken(binary) {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 8000, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error || typeof stdout !== 'string') {
          resolve('');
          return;
        }
        const token = stdout.trim();
        resolve(/^[\x21-\x7e]+$/.test(token) ? token : '');
      },
    );
  });
}

function ghBinaries() {
  if (process.platform !== 'win32') {
    return ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', 'gh'];
  }
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GitHub CLI', 'gh.exe'),
    localAppData ? join(localAppData, 'Programs', 'GitHub CLI', 'gh.exe') : '',
    localAppData ? join(localAppData, 'GitHubCLI', 'bin', 'gh.exe') : '',
    'gh.exe',
    'gh',
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function ghHostsCandidates() {
  const override = process.env.GITHUB_MANAGER_GH_HOSTS_FILE;
  if (override) return [override];
  const home = process.env.HOME || homedir();
  const candidates = [];
  if (process.env.GH_CONFIG_DIR) candidates.push(join(process.env.GH_CONFIG_DIR, 'hosts.yml'));
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    candidates.push(join(appData, 'GitHub CLI', 'hosts.yml'));
  }
  candidates.push(join(home, '.config', 'gh', 'hosts.yml'));
  return [...new Set(candidates)];
}

function pickHostsToken(text) {
  if (typeof text !== 'string' || text === '') return '';
  // hosts.yml is a top-level mapping keyed by hostname. Split into host blocks
  // so a token stored for another host can never be picked up for github.com.
  const blocks = text.split(/\n(?=\S)/);
  const githubBlock = blocks.find((block) => block.startsWith('github.com:'));
  const target = githubBlock || text;
  const match = target.match(/oauth_token:\s*([^\s#]+)/);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

async function readGhHostsToken() {
  for (const candidate of ghHostsCandidates()) {
    try {
      const text = await readFile(candidate, 'utf8');
      return pickHostsToken(text);
    } catch {
      // Not there: try the next candidate.
    }
  }
  return '';
}

async function collectToken() {
  if (ghFallbackDisabled()) return { value: '', source: '' };
  const override = process.env.GITHUB_MANAGER_GH_BIN;
  const binaries = override ? [override] : ghBinaries();
  for (const binary of binaries) {
    const token = await runGhToken(binary);
    if (token) return { value: token, source: 'gh-cli' };
  }
  const fileToken = await readGhHostsToken();
  if (fileToken) return { value: fileToken, source: 'gh-hosts' };
  return { value: '', source: '' };
}

/**
 * Resolve a token from the environment or the local `gh` login. Positive
 * results are cached for a minute, misses for a shorter window so clicking
 * "重试" after `gh auth login` picks the new login up without a restart.
 */
async function resolveToken(force = false) {
  const fromEnv = envToken();
  if (fromEnv) {
    tokenCache = { value: fromEnv, source: 'env', at: Date.now() };
    return tokenCache;
  }
  const now = Date.now();
  const ttl = tokenCache.value ? TOKEN_TTL_MS : TOKEN_FAILURE_TTL_MS;
  if (!force && tokenCache.at && now - tokenCache.at < ttl) return tokenCache;
  if (!force && tokenPending) return tokenPending;
  tokenPending = collectToken()
    .then((found) => {
      tokenCache = { value: found.value, source: found.source, at: Date.now() };
      return tokenCache;
    })
    .catch(() => {
      tokenCache = { value: '', source: '', at: Date.now() };
      return tokenCache;
    })
    .finally(() => {
      tokenPending = null;
    });
  return tokenPending;
}

function resetTokenCache() {
  tokenCache = { value: '', source: '', at: 0 };
}

async function requireToken(options = {}) {
  const token = await resolveToken(Boolean(options.force));
  if (!token.value) {
    throw new GithubError(
      'No GitHub credential available. Log in with `gh auth login`, or set GH_TOKEN / GITHUB_TOKEN in the environment and restart DeepSeek Harness.',
      { code: 'not-configured' },
    );
  }
  return token.value;
}

async function github(pathname, options = {}) {
  const method = options.method || 'GET';
  let body;
  const baseHeaders = {
    accept: 'application/vnd.github+json',
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  };
  if (options.body !== undefined) {
    baseHeaders['content-type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(options.body);
  }
  const send = async (token) => {
    let response;
    try {
      response = await fetch(API_ROOT + pathname, {
        method,
        headers: { ...baseHeaders, authorization: 'Bearer ' + token },
        body,
        signal: options.signal,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new GithubError(
        'Cannot reach api.github.com: ' + ((error && error.message) || String(error)),
        { code: 'network' },
      );
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 400) };
      }
    }
    return { response, data };
  };

  let attempt = await send(await requireToken({ force: options.forceToken }));
  // A stale cached gh token (for example after switching accounts) gets one
  // fresh resolution before the call fails.
  if (attempt.response.status === 401 && !options.retried) {
    resetTokenCache();
    attempt = await send(await requireToken({ force: true }));
  }
  const { response, data } = attempt;
  if (!response.ok) {
    const detail = data && data.message ? data.message : `HTTP ${response.status}`;
    const docs = data && data.documentation_url ? ` (${data.documentation_url})` : '';
    const code = response.status === 401 || response.status === 403 ? 'auth' : 'github-error';
    throw new GithubError(`GitHub ${response.status}: ${detail}${docs}`, { code, status: response.status });
  }
  return { data, headers: response.headers };
}

// ------------------------------------------------------------------ arguments

function requireString(args, key, maxLength = 4096) {
  const value = args && args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GithubError(`Missing required argument "${key}".`, { code: 'invalid-argument', status: 400 });
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new GithubError(`Argument "${key}" is too long (max ${maxLength} characters).`, { code: 'invalid-argument', status: 400 });
  }
  return trimmed;
}

function optionalString(args, key, maxLength = 65536) {
  const value = args && args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new GithubError(`Argument "${key}" must be a string.`, { code: 'invalid-argument', status: 400 });
  }
  if (value.length > maxLength) {
    throw new GithubError(`Argument "${key}" is too long (max ${maxLength} characters).`, { code: 'invalid-argument', status: 400 });
  }
  return value;
}

function optionalStringArray(args, key, maxItems = 50) {
  const value = args && args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new GithubError(`Argument "${key}" must be an array of strings.`, { code: 'invalid-argument', status: 400 });
  }
  const items = value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (items.length > maxItems) {
    throw new GithubError(`Argument "${key}" accepts at most ${maxItems} entries.`, { code: 'invalid-argument', status: 400 });
  }
  return items;
}

function optionalEnum(args, key, allowed, fallback) {
  const value = args && args[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) {
    throw new GithubError(`Argument "${key}" must be one of: ${allowed.join(', ')}.`, { code: 'invalid-argument', status: 400 });
  }
  return value;
}

function optionalLimit(args, fallback, max = 100) {
  const value = args && args.limit;
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new GithubError('Argument "limit" must be a positive integer.', { code: 'invalid-argument', status: 400 });
  }
  return Math.min(Math.floor(parsed), max);
}

function requireRepo(args) {
  const repo = requireString(args, 'repo', 200);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GithubError('Argument "repo" must be in "owner/name" form.', { code: 'invalid-argument', status: 400 });
  }
  return repo;
}

function requireIssueNumber(args) {
  const raw = args && (args.number ?? args.issue ?? args.issue_number);
  const number = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(number) || number < 1) {
    throw new GithubError('Argument "number" must be a positive issue number.', { code: 'invalid-argument', status: 400 });
  }
  return number;
}

// ------------------------------------------------------------------- shaping

function trimLabel(label) {
  if (typeof label === 'string') return { name: label, color: '' };
  return { name: label && label.name ? String(label.name) : '', color: label && label.color ? String(label.color) : '' };
}

function trimUser(user) {
  return user && user.login ? user.login : '';
}

function trimRepo(repo) {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner ? repo.owner.login : '',
    description: repo.description || '',
    private: Boolean(repo.private),
    fork: Boolean(repo.fork),
    archived: Boolean(repo.archived),
    disabled: Boolean(repo.disabled),
    language: repo.language || '',
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    // GitHub counts open issues and open pull requests together here.
    openItems: repo.open_issues_count ?? 0,
    defaultBranch: repo.default_branch || '',
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 12) : [],
    updatedAt: repo.updated_at || '',
    pushedAt: repo.pushed_at || '',
    createdAt: repo.created_at || '',
    htmlUrl: repo.html_url || '',
    cloneUrl: repo.clone_url || '',
    sshUrl: repo.ssh_url || '',
  };
}

function trimIssue(issue) {
  const labels = Array.isArray(issue.labels) ? issue.labels.map(trimLabel) : [];
  return {
    number: issue.number,
    title: issue.title || '',
    state: issue.state || 'open',
    stateReason: issue.state_reason || '',
    author: trimUser(issue.user),
    labels,
    assignees: Array.isArray(issue.assignees) ? issue.assignees.map(trimUser).filter(Boolean) : [],
    comments: issue.comments ?? 0,
    createdAt: issue.created_at || '',
    updatedAt: issue.updated_at || '',
    closedAt: issue.closed_at || '',
    htmlUrl: issue.html_url || '',
    isPullRequest: Boolean(issue.pull_request),
    bodyPreview: (issue.body || '').slice(0, 600),
  };
}

function trimPull(pull) {
  const labels = Array.isArray(pull.labels) ? pull.labels.map(trimLabel) : [];
  return {
    number: pull.number,
    title: pull.title || '',
    state: pull.state || 'open',
    draft: Boolean(pull.draft),
    merged: Boolean(pull.merged_at),
    author: trimUser(pull.user),
    labels,
    head: pull.head ? pull.head.ref : '',
    base: pull.base ? pull.base.ref : '',
    comments: (pull.comments ?? 0) + (pull.review_comments ?? 0),
    createdAt: pull.created_at || '',
    updatedAt: pull.updated_at || '',
    mergedAt: pull.merged_at || '',
    htmlUrl: pull.html_url || '',
    bodyPreview: (pull.body || '').slice(0, 600),
  };
}

function trimWriteResult(item) {
  return {
    number: item.number,
    title: item.title || '',
    state: item.state || '',
    htmlUrl: item.html_url || '',
    isPullRequest: Boolean(item.pull_request),
  };
}

// --------------------------------------------------------------------- reads

async function readStatus(force = false) {
  const token = await resolveToken(force);
  if (!token.value) {
    return {
      configured: false,
      tokenSource: '',
      hint: 'Log in with `gh auth login`, or set GH_TOKEN / GITHUB_TOKEN in the environment and restart DeepSeek Harness.',
    };
  }
  const { data: user, headers } = await github('/user');
  let rateLimit = null;
  try {
    const { data: rate } = await github('/rate_limit');
    const core = rate && rate.resources ? rate.resources.core : null;
    if (core) {
      rateLimit = { remaining: core.remaining, limit: core.limit, resetAt: new Date(core.reset * 1000).toISOString() };
    }
  } catch {
    rateLimit = null;
  }
  return {
    configured: true,
    tokenSource: token.source,
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url || '',
    htmlUrl: user.html_url || '',
    publicRepos: user.public_repos ?? 0,
    privateRepos: user.total_private_repos ?? user.owned_private_repos ?? 0,
    scopes: headers.get('x-oauth-scopes') || '',
    rateLimit,
  };
}

async function readRepos(searchParams) {
  const affiliation = searchParams.get('affiliation') || 'all';
  const visibility = searchParams.get('visibility') || 'all';
  const sort = searchParams.get('sort') || 'updated';
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 100);
  const params = new URLSearchParams({
    per_page: String(limit),
    sort,
    direction: 'desc',
    visibility: ['all', 'public', 'private'].includes(visibility) ? visibility : 'all',
  });
  params.set(
    'affiliation',
    affiliation === 'all' || !affiliation
      ? 'owner,collaborator,organization_member'
      : affiliation,
  );
  const { data } = await github('/user/repos?' + params.toString());
  const items = Array.isArray(data) ? data.map(trimRepo) : [];
  return { count: items.length, items };
}

function requireFullName(searchParams) {
  const fullName = searchParams.get('full_name') || '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new GithubError('Query parameter "full_name" must be "owner/name".', { code: 'invalid-argument', status: 400 });
  }
  return fullName;
}

async function readIssues(searchParams) {
  const fullName = requireFullName(searchParams);
  const state = ['open', 'closed', 'all'].includes(searchParams.get('state')) ? searchParams.get('state') : 'open';
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const items = [];
  // The issues endpoint mixes pull requests into the page, so keep paging until
  // `limit` real issues are collected (bounded, to respect the rate limit).
  for (let page = 1; page <= 5 && items.length < limit; page += 1) {
    const params = new URLSearchParams({
      state,
      per_page: '100',
      page: String(page),
      sort: 'updated',
      direction: 'desc',
    });
    const { data } = await github(`/repos/${fullName}/issues?` + params.toString());
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      if (item.pull_request) continue;
      if (items.length >= limit) break;
      items.push(trimIssue(item));
    }
    if (data.length < 100) break;
  }
  return { count: items.length, items, truncated: items.length >= limit };
}

async function readPulls(searchParams) {
  const fullName = requireFullName(searchParams);
  const state = ['open', 'closed', 'all'].includes(searchParams.get('state')) ? searchParams.get('state') : 'open';
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const params = new URLSearchParams({ state, per_page: String(limit), sort: 'updated', direction: 'desc' });
  const { data } = await github(`/repos/${fullName}/pulls?` + params.toString());
  const items = (Array.isArray(data) ? data : []).map(trimPull);
  return { count: items.length, items, truncated: items.length >= limit };
}

function encodePath(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function readBranches(searchParams) {
  const fullName = requireFullName(searchParams);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 100);
  const enrich = searchParams.get('enrich') || '1';
  // The branches endpoint has no default-branch flag, so the repository record
  // is fetched once and used to mark and float the default branch.
  const { data: repoData } = await github(`/repos/${fullName}`);
  const defaultBranch = repoData && repoData.default_branch ? repoData.default_branch : '';
  const raw = [];
  for (let page = 1; page <= 3 && raw.length < limit; page += 1) {
    const { data } = await github(`/repos/${fullName}/branches?per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length === 0) break;
    for (const branch of data) {
      if (raw.length >= limit) break;
      raw.push(branch);
    }
    if (data.length < 100) break;
  }
  const total = raw.length;
  const all = raw.map((branch) => {
    const sha = branch && branch.commit ? String(branch.commit.sha || '') : '';
    return {
      name: branch && branch.name ? String(branch.name) : '',
      sha,
      shortSha: sha.slice(0, 7),
      protected: Boolean(branch && branch.protected),
      isDefault: Boolean(branch && branch.name === defaultBranch),
      updatedAt: null,
      author: null,
      message: null,
      aheadBy: null,
      behindBy: null,
      enrichFailed: false,
      htmlUrl: branch && branch.name && repoData && repoData.html_url
        ? `${repoData.html_url}/tree/${encodeURIComponent(String(branch.name))}`
        : '',
    };
  });
  const ordered = [];
  const rest = [];
  for (const item of all) {
    if (item.isDefault) ordered.push(item);
    else rest.push(item);
  }
  const items = ordered.concat(rest).slice(0, limit);
  let enrichedCount = 0;
  if (enrich !== '0') {
    // Enrichment costs two extra calls per branch, so only the first few are
    // enriched and failures are recorded per item instead of failing the list.
    const targets = items.slice(0, ENRICH_LIMIT);
    await Promise.all(targets.map(async (item) => {
      if (!item.sha) {
        item.enrichFailed = true;
        return;
      }
      try {
        const { data: commitData } = await github(`/repos/${fullName}/commits/${item.sha}`);
        const commit = (commitData && commitData.commit) || {};
        const author = commit.author || {};
        const message = String(commit.message || '').split('\n')[0].slice(0, 100);
        let aheadBy = null;
        let behindBy = null;
        if (!item.isDefault && defaultBranch) {
          const comparePath = `/repos/${fullName}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(item.name)}`;
          const { data: compare } = await github(comparePath);
          aheadBy = typeof compare.ahead_by === 'number' ? compare.ahead_by : null;
          behindBy = typeof compare.behind_by === 'number' ? compare.behind_by : null;
        }
        item.updatedAt = author.date || null;
        item.author = author.name || null;
        item.message = message || null;
        item.aheadBy = aheadBy;
        item.behindBy = behindBy;
      } catch {
        item.updatedAt = null;
        item.author = null;
        item.message = null;
        item.aheadBy = null;
        item.behindBy = null;
        item.enrichFailed = true;
      }
    }));
    enrichedCount = items.filter((item) => !item.enrichFailed && item.updatedAt !== null).length;
  }
  return { fullName, defaultBranch, count: items.length, items, enrichedCount, total };
}

async function readCommits(searchParams) {
  const fullName = requireFullName(searchParams);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);
  let ref = (searchParams.get('ref') || '').trim();
  if (!ref) {
    const { data: repoData } = await github(`/repos/${fullName}`);
    ref = repoData && repoData.default_branch ? repoData.default_branch : '';
  }
  const params = new URLSearchParams({ sha: ref, per_page: String(limit) });
  const { data } = await github(`/repos/${fullName}/commits?` + params.toString());
  const items = (Array.isArray(data) ? data : []).map((item) => {
    const commit = (item && item.commit) || {};
    const author = commit.author || {};
    return {
      sha: item && item.sha ? String(item.sha) : '',
      shortSha: (item && item.sha ? String(item.sha) : '').slice(0, 7),
      message: String(commit.message || '').split('\n')[0].slice(0, 200),
      author: author.name || (item && item.author && item.author.login) || '',
      date: author.date || '',
      htmlUrl: (item && item.html_url) || '',
    };
  });
  return { fullName, ref, count: items.length, items };
}

async function readTree(searchParams) {
  const fullName = requireFullName(searchParams);
  const ref = (searchParams.get('ref') || '').trim();
  const path = (searchParams.get('path') || '').trim().replace(/^\/+|\/+$/g, '');
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 300);
  const query = ref ? '?ref=' + encodeURIComponent(ref) : '';
  const { data } = await github(`/repos/${fullName}/contents/${path ? encodePath(path) : ''}${query}`);
  const isDirectory = Array.isArray(data);
  const list = isDirectory ? data : [data];
  const items = list.map((item) => ({
    name: (item && item.name) || '',
    path: (item && item.path) || '',
    type: item && item.type === 'dir' ? 'dir' : 'file',
    size: item && typeof item.size === 'number' ? item.size : null,
    sha: (item && item.sha) || '',
  }));
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const truncated = items.length > limit;
  const limited = items.slice(0, limit);
  return { fullName, ref, path, isDirectory, count: limited.length, items: limited, truncated };
}

async function readFileContent(searchParams) {
  const fullName = requireFullName(searchParams);
  const path = (searchParams.get('path') || '').trim();
  if (!path) {
    throw new GithubError('Query parameter "path" is required.', { code: 'invalid-argument', status: 400 });
  }
  const ref = (searchParams.get('ref') || '').trim();
  const query = ref ? '?ref=' + encodeURIComponent(ref) : '';
  const { data } = await github(`/repos/${fullName}/contents/${encodePath(path)}${query}`);
  if (!data || data.type !== 'file') {
    throw new GithubError('Path is not a file.', { code: 'invalid-argument', status: 400 });
  }
  const size = typeof data.size === 'number' ? data.size : 0;
  let encoding = 'utf8';
  let text = null;
  let truncated = false;
  if (size > MAX_FILE_BYTES) {
    encoding = 'too-large';
    truncated = true;
  } else {
    const buffer = Buffer.from(data.content || '', 'base64');
    if (buffer.includes(0)) {
      encoding = 'binary';
    } else {
      text = buffer.toString('utf8');
      if (text.length > MAX_TEXT_CHARS) {
        text = text.slice(0, MAX_TEXT_CHARS);
        truncated = true;
      }
    }
  }
  return {
    fullName,
    ref,
    path,
    name: data.name || '',
    size,
    sha: data.sha || '',
    encoding,
    text,
    truncated,
    htmlUrl: data.html_url || '',
    downloadUrl: data.download_url || '',
  };
}

// -------------------------------------------------------------------- writes

async function createIssue(body) {
  const fullName = validateRepoInput(body.full_name || body.repo);
  const title = requireString(body, 'title', 256);
  const issueBody = optionalString(body, 'body');
  const labels = optionalStringArray(body, 'labels');
  const assignees = optionalStringArray(body, 'assignees');
  const payload = { title };
  if (issueBody !== undefined) payload.body = issueBody;
  if (labels && labels.length) payload.labels = labels;
  if (assignees && assignees.length) payload.assignees = assignees;
  const { data } = await github(`/repos/${fullName}/issues`, { method: 'POST', body: payload });
  return trimWriteResult(data);
}

async function updateIssue(body) {
  const fullName = validateRepoInput(body.full_name || body.repo);
  const number = requireIssueNumber(body);
  const payload = {};
  if (body.state !== undefined) {
    if (body.state !== 'open' && body.state !== 'closed') {
      throw new GithubError('Argument "state" must be exactly "open" or "closed".', { code: 'invalid-argument', status: 400 });
    }
    payload.state = body.state;
  }
  const title = optionalString(body, 'title', 256);
  if (title !== undefined) {
    if (title.trim() === '') {
      throw new GithubError('Argument "title" must not be empty.', { code: 'invalid-argument', status: 400 });
    }
    payload.title = title;
  }
  const issueBody = optionalString(body, 'body');
  if (issueBody !== undefined) payload.body = issueBody;
  const labels = optionalStringArray(body, 'labels');
  if (labels !== undefined) payload.labels = labels;
  const assignees = optionalStringArray(body, 'assignees');
  if (assignees !== undefined) payload.assignees = assignees;
  if (Object.keys(payload).length === 0) {
    throw new GithubError('Nothing to update: pass state, title, body, labels, or assignees.', { code: 'invalid-argument', status: 400 });
  }
  const { data } = await github(`/repos/${fullName}/issues/${number}`, { method: 'PATCH', body: payload });
  return trimWriteResult(data);
}

async function commentIssue(body) {
  const fullName = validateRepoInput(body.full_name || body.repo);
  const number = requireIssueNumber(body);
  const text = requireString(body, 'body', 65536);
  const { data } = await github(`/repos/${fullName}/issues/${number}/comments`, { method: 'POST', body: { body: text } });
  return { id: data.id, htmlUrl: data.html_url || '', createdAt: data.created_at || '' };
}

function validateRepoInput(raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.trim())) {
    throw new GithubError('Argument "repo" must be in "owner/name" form.', { code: 'invalid-argument', status: 400 });
  }
  return raw.trim();
}

// ---------------------------------------------------------------------- tools

function textOutput(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function defineTool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textOutput(value),
    },
    execute,
    timeoutMs: 30000,
  };
}

function repoProperty(description) {
  return { type: 'string', description };
}

const TOOLS = [
  defineTool(
    'github_status',
    'Report whether this Host has a GitHub token configured, the authenticated GitHub account, and the core API rate limit. Call this first when a GitHub operation fails unexpectedly.',
    { type: 'object', properties: {}, additionalProperties: false },
    async () => readStatus(),
  ),
  defineTool(
    'github_list_repos',
    'List GitHub repositories accessible to the authenticated token, most recently updated first. Use it to discover a repository\'s "owner/name" before calling other github_* tools.',
    {
      type: 'object',
      properties: {
        affiliation: {
          type: 'string',
          enum: ['owner', 'collaborator', 'organization_member', 'all'],
          description: 'Which relationship to filter by. "all" (default) includes owned, collaborator, and organization-member repositories.',
        },
        visibility: {
          type: 'string',
          enum: ['all', 'public', 'private'],
          description: 'Repository visibility filter. Defaults to "all".',
        },
        sort: {
          type: 'string',
          enum: ['updated', 'pushed', 'created', 'full_name'],
          description: 'Sort order. Defaults to "updated" (descending).',
        },
        limit: { type: 'integer', description: 'Maximum repositories to return (1-100). Defaults to 50.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const affiliation = optionalEnum(args, 'affiliation', ['owner', 'collaborator', 'organization_member', 'all'], 'all');
      const visibility = optionalEnum(args, 'visibility', ['all', 'public', 'private'], 'all');
      const sort = optionalEnum(args, 'sort', ['updated', 'pushed', 'created', 'full_name'], 'updated');
      const limit = optionalLimit(args, 50);
      const searchParams = new URLSearchParams({ affiliation, visibility, sort, limit: String(limit) });
      return readRepos(searchParams);
    },
  ),
  defineTool(
    'github_get_repo',
    'Read one GitHub repository\'s metadata: description, default branch, language, stars, forks, open item count (issues and pull requests together), topics, and clone URLs.',
    {
      type: 'object',
      properties: { repo: repoProperty('Repository in "owner/name" form, for example "octocat/Hello-World".') },
      required: ['repo'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const { data } = await github(`/repos/${fullName}`);
      let branchCount = null;
      try {
        const brief = await github(`/repos/${fullName}/branches?per_page=1`);
        const link = brief.headers && typeof brief.headers.get === 'function' ? brief.headers.get('link') : null;
        const m = link && /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
        branchCount = m ? Number(m[1]) : (Array.isArray(brief.data) ? brief.data.length : null);
      } catch {
        branchCount = null;
      }
      return { ...trimRepo(data), branchCount };
    },
  ),
  defineTool(
    'github_list_issues',
    'List issues of a GitHub repository (pull requests excluded), most recently updated first. Each item includes number, title, state, labels, assignees, and a short body preview.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state filter. Defaults to "open".' },
        limit: { type: 'integer', description: 'Maximum issues to return (1-100). Defaults to 30.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const state = optionalEnum(args, 'state', ['open', 'closed', 'all'], 'open');
      const limit = optionalLimit(args, 30);
      const searchParams = new URLSearchParams({ full_name: fullName, state, limit: String(limit) });
      return readIssues(searchParams);
    },
  ),
  defineTool(
    'github_create_issue',
    'Create an issue in a GitHub repository. Returns the new issue number and URL. This is a write operation: state the intended title and body before calling it.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        title: { type: 'string', description: 'Issue title.' },
        body: { type: 'string', description: 'Issue body in Markdown.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names to apply.' },
        assignees: { type: 'array', items: { type: 'string' }, description: 'GitHub logins to assign.' },
      },
      required: ['repo', 'title'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      return createIssue({ ...args, full_name: fullName });
    },
  ),
  defineTool(
    'github_update_issue',
    'Update a GitHub issue: close or reopen it, or change its title, body, labels, or assignees. Returns the updated number, state, and URL.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        number: { type: 'integer', description: 'Issue number.' },
        state: { type: 'string', enum: ['open', 'closed'], description: 'Set "closed" to close the issue or "open" to reopen it.' },
        title: { type: 'string', description: 'Replacement title.' },
        body: { type: 'string', description: 'Replacement body in Markdown.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Replacement label list.' },
        assignees: { type: 'array', items: { type: 'string' }, description: 'Replacement assignee list.' },
      },
      required: ['repo', 'number'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      return updateIssue({ ...args, full_name: fullName });
    },
  ),
  defineTool(
    'github_comment_issue',
    'Add a comment to a GitHub issue or pull request. Returns the comment URL.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        number: { type: 'integer', description: 'Issue or pull request number.' },
        body: { type: 'string', description: 'Comment body in Markdown.' },
      },
      required: ['repo', 'number', 'body'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      return commentIssue({ ...args, full_name: fullName });
    },
  ),
  defineTool(
    'github_list_pulls',
    'List pull requests of a GitHub repository, most recently updated first. Each item includes number, title, state, draft/merged flags, source and target branches, author, and labels.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Pull request state filter. Defaults to "open".' },
        limit: { type: 'integer', description: 'Maximum pull requests to return (1-100). Defaults to 30.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const state = optionalEnum(args, 'state', ['open', 'closed', 'all'], 'open');
      const limit = optionalLimit(args, 30);
      const searchParams = new URLSearchParams({ full_name: fullName, state, limit: String(limit) });
      return readPulls(searchParams);
    },
  ),
  defineTool(
    'github_list_branches',
    'List branches of a GitHub repository with the default branch first. Each item carries the head SHA, protected flag, and, for the first few branches, the last commit author/date/message plus ahead/behind counts relative to the default branch.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        limit: { type: 'integer', description: 'Maximum branches to return (1-100). Defaults to 100.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const limit = optionalLimit(args, 100);
      const searchParams = new URLSearchParams({ full_name: fullName, limit: String(limit) });
      return readBranches(searchParams);
    },
  ),
  defineTool(
    'github_list_commits',
    'List commits on a branch or ref of a GitHub repository, newest first. Each item includes the SHA, first line of the message, author, date, and URL. Defaults to the repository default branch.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        ref: { type: 'string', description: 'Branch name, tag, or commit SHA. Defaults to the repository default branch.' },
        limit: { type: 'integer', description: 'Maximum commits to return (1-100). Defaults to 20.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const ref = optionalString(args, 'ref', 256) || '';
      const limit = optionalLimit(args, 20);
      const searchParams = new URLSearchParams({ full_name: fullName, ref, limit: String(limit) });
      return readCommits(searchParams);
    },
  ),
  defineTool(
    'github_list_tree',
    'List the contents of one directory (or describe one file) in a GitHub repository. Directories sort before files. Use this to browse a repository before calling github_get_file.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        path: { type: 'string', description: 'Directory path relative to the repository root. Empty or omitted means the root.' },
        ref: { type: 'string', description: 'Branch name, tag, or commit SHA. Defaults to the repository default branch.' },
        limit: { type: 'integer', description: 'Maximum entries to return (1-300). Defaults to 200.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const path = optionalString(args, 'path', 4096) || '';
      const ref = optionalString(args, 'ref', 256) || '';
      const limit = optionalLimit(args, 200, 300);
      const searchParams = new URLSearchParams({ full_name: fullName, path, ref, limit: String(limit) });
      return readTree(searchParams);
    },
  ),
  defineTool(
    'github_get_file',
    'Read one UTF-8 text file from a GitHub repository. Binary files and files larger than 512 KiB are not decoded; the result reports encoding "binary" or "too-large" instead.',
    {
      type: 'object',
      properties: {
        repo: repoProperty('Repository in "owner/name" form.'),
        path: { type: 'string', description: 'File path relative to the repository root.' },
        ref: { type: 'string', description: 'Branch name, tag, or commit SHA. Defaults to the repository default branch.' },
      },
      required: ['repo', 'path'],
      additionalProperties: false,
    },
    async (args) => {
      const fullName = requireRepo(args);
      const path = requireString(args, 'path', 4096);
      const ref = optionalString(args, 'ref', 256) || '';
      const searchParams = new URLSearchParams({ full_name: fullName, path, ref });
      return readFileContent(searchParams);
    },
  ),
];

// --------------------------------------------------------------------- routes

function okPayload(data) {
  return { status: 200, payload: { ok: true, data } };
}

function parseJsonBody(text) {
  if (!text) return {};
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new GithubError('Request body is too large.', { code: 'invalid-argument', status: 413 });
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new GithubError('Request body must be a JSON object.', { code: 'invalid-argument', status: 400 });
  }
}

function readNodeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new GithubError('Request body is too large.', { code: 'invalid-argument', status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

function resolveConnection(ctx) {
  try {
    return ctx.get('connection');
  } catch {
    return undefined;
  }
}

/**
 * One request, one decision. `method` is the transport method; HEAD is treated
 * as GET so the Web carrier can answer it with headers only.
 */
async function dispatchRoute({ method, pathname, searchParams, headers, bodyText, connection }) {
  // A named Web route owns its own admission: apply the same Host/Origin and
  // browser-cookie checks the index route uses, so this route cannot be called
  // by a stray local process or a cross-origin page. Fail closed when the
  // connection service is missing instead of serving data unauthenticated.
  if (!connection || typeof connection.requestRejection !== 'function') {
    return {
      status: 503,
      payload: {
        ok: false,
        error: { message: 'The GitHub manager route needs the Harness connection service.', code: 'unavailable' },
      },
    };
  }
  const rejection = connection.requestRejection({ headers });
  if (rejection) {
    return { status: rejection, payload: { ok: false, error: { message: 'Unauthorized', code: 'unauthorized' } } };
  }
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(ROUTE_PREFIX + '/')) {
    return { status: 404, payload: { ok: false, error: { message: 'Not found' } } };
  }
  const route = pathname.slice(ROUTE_PREFIX.length) || '/';
  const effectiveMethod = method === 'HEAD' ? 'GET' : method;
  try {
    if (effectiveMethod === 'GET') {
      // Force a fresh credential lookup: this is the panel's "Retry" path, so a
      // `gh auth login` performed after boot is picked up without a restart.
      if (route === '/status') return okPayload(await readStatus(true));
      if (route === '/repos') return okPayload(await readRepos(searchParams));
      if (route === '/issues') return okPayload(await readIssues(searchParams));
      if (route === '/pulls') return okPayload(await readPulls(searchParams));
      if (route === '/branches') return okPayload(await readBranches(searchParams));
      if (route === '/commits') return okPayload(await readCommits(searchParams));
      if (route === '/tree') return okPayload(await readTree(searchParams));
      if (route === '/file') return okPayload(await readFileContent(searchParams));
      return { status: 404, payload: { ok: false, error: { message: 'Unknown route: GET ' + route } } };
    }
    if (effectiveMethod === 'POST') {
      const body = parseJsonBody(bodyText);
      if (route === '/issue') return okPayload(await createIssue(body));
      if (route === '/issue-state') return okPayload(await updateIssue(body));
      if (route === '/comment') return okPayload(await commentIssue(body));
      return { status: 404, payload: { ok: false, error: { message: 'Unknown route: POST ' + route } } };
    }
    return {
      status: 405,
      payload: { ok: false, error: { message: 'Method not allowed' } },
      headers: { allow: 'GET, HEAD, POST' },
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { status: 499, payload: { ok: false, error: { message: 'Request aborted.', code: 'aborted' } } };
    }
    if (error instanceof GithubError) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 502;
      return { status, payload: { ok: false, error: { message: error.message, code: error.code, status: error.status } } };
    }
    return { status: 500, payload: { ok: false, error: { message: (error && error.message) || String(error), code: 'internal' } } };
  }
}

function sendNodeResponse(res, method, status, payload, extraHeaders) {
  const text = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(extraHeaders || {}),
  };
  if (method !== 'HEAD') headers['content-length'] = String(Buffer.byteLength(text, 'utf8'));
  res.writeHead(status, headers);
  if (method === 'HEAD') res.end();
  else res.end(text);
}

/**
 * A raw WebRoute handler, not a WebResourceRoute: the carrier only invokes a
 * resource for GET/HEAD, so a resource can never receive the panel's POSTs.
 */
function createRouteHandler(ctx) {
  return async (req, res) => {
    const method = req.method || 'GET';
    const headers = req.headers || {};
    try {
      let pathname = '/';
      let searchParams = new URLSearchParams();
      try {
        const url = new URL(req.url || '/', 'http://' + (headers.host || '127.0.0.1'));
        pathname = url.pathname;
        searchParams = url.searchParams;
      } catch {
        sendNodeResponse(res, method, 400, { ok: false, error: { message: 'Malformed request URL.' } });
        return;
      }
      let bodyText = '';
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        bodyText = await readNodeBody(req);
      }
      const result = await dispatchRoute({
        method,
        pathname,
        searchParams,
        headers,
        bodyText,
        connection: resolveConnection(ctx),
      });
      sendNodeResponse(res, method, result.status, result.payload, result.headers);
    } catch (error) {
      const status = error instanceof GithubError && Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
      sendNodeResponse(res, method, status, {
        ok: false,
        error: { message: (error && error.message) || String(error), code: (error && error.code) || 'internal' },
      });
    }
  };
}

// -------------------------------------------------------------------- plugin

export const inject = ['tools', 'webServer'];

export function apply(ctx) {
  for (const definition of TOOLS) {
    ctx.effect(() => ctx.tools.register(definition));
  }
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createRouteHandler(ctx),
    }),
  );
}

// Test seam: pure helpers used by .verify-host.mjs. Nothing else should rely
// on these names, so they can change without a plugin-facing migration.
export const __testing = { ghBinaries, ghHostsCandidates, pickHostsToken };
