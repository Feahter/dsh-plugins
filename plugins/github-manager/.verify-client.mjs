/**
 * Render smoke test for the Client half.
 *
 * Loads client.js through a fake module loader with a minimal React hook shim,
 * applies the plugin to a mock Client context, then renders the panel with
 * hand-picked hook state for each UI state (loading, setup, repo + issues,
 * pull requests, editor, load error, notice). It cannot check pixels, but it
 * proves every render branch completes without a runtime error and shows the
 * expected text.
 */
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ DOM stub

globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
};

const styleTags = [];

// --------------------------------------------------------------- React shim

const NO_SEED = Symbol('no-seed');
let seeds = [];
let hookIndex = 0;

function element(type, props, ...children) {
  const merged = { ...(props || {}) };
  if (children.length === 1) merged.children = children[0];
  else if (children.length > 1) merged.children = children;
  return { type, props: merged };
}

const ReactShim = {
  createElement: element,
  useState(initial) {
    const seed = hookIndex < seeds.length ? seeds[hookIndex] : NO_SEED;
    hookIndex += 1;
    return [seed === NO_SEED ? initial : seed, () => {}];
  },
  useEffect() {},
  useMemo(factory) {
    return factory();
  },
  useCallback(callback) {
    return callback;
  },
  useRef(value) {
    return { current: value };
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
};

// ------------------------------------------------------------- loader + ctx

let plugin = null;
const registrations = new Map();

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      assert.equal(definition.id, 'dsh-github-manager');
      plugin = definition.factory((name) => {
        assert.equal(name, 'react');
        return ReactShim;
      });
    },
  },
};

const localeSnapshot = { active: 'en', revision: 1, locales: [{ id: 'en', label: 'English' }] };
const locale = {
  register() { return () => {}; },
  bind() { return (key) => key; },
  subscribe() { return () => {}; },
  getSnapshot() { return localeSnapshot; },
  getLocale() { return localeSnapshot; },
};
const slots = {
  inject(_name, callback) { callback(); return () => {}; },
  register(options, component) {
    const key = options.name === 'main' ? 'main:' + options.key : options.name + ':' + options.id;
    registrations.set(key, { options, component });
    return () => {};
  },
};
const ctx = {
  slots,
  locale,
  effect(callback) {
    const disposer = callback();
    return typeof disposer === 'function' ? disposer : () => {};
  },
};

await import(new URL('./client.js', import.meta.url).href);
assert.ok(plugin, 'client module loaded');
plugin.apply(ctx);

const panel = registrations.get('main:github-manager');
assert.ok(panel, 'main panel registered under key github-manager');
const sidebar = registrations.get('sidebar.panellist:github-manager');
assert.ok(sidebar, 'sidebar panellist icon registered');
assert.equal(sidebar.options.order, 30);

// ------------------------------------------------------- element serializer

function collectText(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object') {
    if (typeof node.type === 'function') {
      const rendered = node.type(node.props || {});
      return collectText(rendered, out);
    }
    collectText(node.props ? node.props.children : null, out);
  }
  return out;
}

function render(seedValues) {
  seeds = seedValues || [];
  hookIndex = 0;
  const tree = panel.component();
  return collectText(tree).join(' ');
}

const repo = {
  fullName: 'octocat/Hello-World',
  name: 'Hello-World',
  owner: 'octocat',
  description: 'My first repository on GitHub!',
  private: false,
  fork: false,
  archived: false,
  language: 'JavaScript',
  stars: 42,
  forks: 7,
  openItems: 3,
  defaultBranch: 'main',
  topics: ['demo'],
  updatedAt: new Date(Date.now() - 86400000).toISOString(),
  htmlUrl: 'https://github.com/octocat/Hello-World',
  cloneUrl: 'https://github.com/octocat/Hello-World.git',
};
const issue = {
  number: 12,
  title: 'Something is broken',
  state: 'open',
  author: 'alice',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  comments: 2,
  updatedAt: new Date(Date.now() - 3600000).toISOString(),
  htmlUrl: 'https://github.com/octocat/Hello-World/issues/12',
};
const pull = {
  number: 34,
  title: 'Add a feature',
  state: 'open',
  draft: true,
  merged: false,
  author: 'bob',
  labels: [],
  head: 'feature',
  base: 'main',
  comments: 0,
  updatedAt: new Date(Date.now() - 7200000).toISOString(),
  htmlUrl: 'https://github.com/octocat/Hello-World/pull/34',
};
const status = {
  configured: true,
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: '',
  htmlUrl: 'https://github.com/octocat',
  publicRepos: 8,
  privateRepos: 2,
  rateLimit: { remaining: 9, limit: 10 },
};

// Hook state order: status, repos, loading, loadError, refreshKey, selected,
// query, visibility, tab, stateFilter, items, itemsLoading, itemsError,
// itemsVersion, branches, branchesLoading, branchesError, branchView, notice,
// editor, pendingIssue.
const baseConfigured = (overrides = {}) => [
  status,
  [repo],
  false,
  '',
  0,
  repo.fullName,
  '',
  'all',
  'issues',
  'open',
  [issue],
  false,
  '',
  0,
  null,
  false,
  '',
  null,
  null,
  null,
  null,
];

// 1. Loading.
let text = render();
assert.match(text, /GitHub projects/);
assert.match(text, /Loading/);

// 2. Setup card (no token).
text = render([{ configured: false }, [], false]);
assert.match(text, /No GitHub credential found/);
assert.match(text, /gh auth login/);
assert.match(text, /GH_TOKEN/);
assert.match(text, /Retry/);

// 3. Configured: repository list + issue list.
text = render(baseConfigured());
assert.match(text, /octocat\/Hello-World/);
assert.match(text, /Something is broken/);
assert.match(text, /Something is broken/);
assert.match(text, /bug/);
assert.match(text, /Close/);
assert.match(text, /New issue/);
assert.match(text, /The Octocat/);

// 4. Pull requests tab.
text = render([
  status, [repo], false, '', 0, repo.fullName, '', 'all', 'pulls', 'open',
  [pull], false, '', 0, null, false, '', null, null, null, null,
]);
assert.match(text, /Add a feature/);
assert.match(text, /feature → main/);
assert.match(text, /Draft/);

// 5. Issue editor open.
text = render([
  status, [repo], false, '', 0, repo.fullName, '', 'all', 'issues', 'open',
  [issue], false, '', 0, null, false, '', null, null, { title: '', body: '', labels: '', busy: false }, null,
]);
assert.match(text, /New issue/);
assert.match(text, /Body \(Markdown\)/);
assert.match(text, /Create/);

// 6. Load error.
text = render([null, [], false, 'network down']);
assert.match(text, /Failed to load: network down/);
assert.match(text, /Retry/);

// 7. Success notice.
text = render([
  status, [repo], false, '', 0, repo.fullName, '', 'all', 'issues', 'open',
  [issue], false, '', 0, null, false, '', null, { kind: 'success', text: 'Created issue #56' }, null, null,
]);
assert.match(text, /Created issue #56/);

// 8. Empty repository state.
text = render([status, [], false, '', 0, '', '', 'all', 'issues', 'open', [], false, '', 0, null, false, '', null, null, null, null]);
assert.match(text, /Select a repository/);

// Branch fixtures: one default (protected) branch and one ahead/behind branch.
const branchMain = {
  name: 'main',
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  protected: true,
  isDefault: true,
  updatedAt: new Date(Date.now() - 3600000).toISOString(),
  author: 'alice',
  message: 'Initial commit',
  aheadBy: 0,
  behindBy: 0,
  enrichFailed: false,
  htmlUrl: 'https://github.com/octocat/Hello-World/tree/main',
};
const branchFeature = Object.assign({}, branchMain, {
  name: 'feature',
  sha: 'b'.repeat(40),
  shortSha: 'bbbbbbb',
  protected: false,
  isDefault: false,
  message: 'Add a feature',
  aheadBy: 2,
  behindBy: 1,
  htmlUrl: 'https://github.com/octocat/Hello-World/tree/feature',
});
const branches = {
  fullName: 'octocat/Hello-World',
  defaultBranch: 'main',
  count: 2,
  enrichedCount: 2,
  total: 2,
  items: [branchMain, branchFeature],
};

// 9. Branch tab lists branches with protected/default chips and ahead/behind.
text = render([
  status, [repo], false, '', 0, repo.fullName, '', 'all', 'branches', 'open',
  [], false, '', 0, branches, false, '', null, null, null, null,
]);
assert.match(text, /Branches/);
assert.match(text, /feature/);
assert.match(text, /Default/);
assert.match(text, /Protected/);
assert.match(text, /↑2/);
assert.match(text, /↓1/);
assert.doesNotMatch(text, /Open Closed All/);

// 10. Branch view shows commits and the file tree for the selected branch.
text = render([
  status, [repo], false, '', 0, repo.fullName, '', 'all', 'branches', 'open',
  [], false, '', 0, branches, false, '', {
    branch: 'feature',
    loading: false,
    error: '',
    path: '',
    commits: [{ sha: 'c'.repeat(40), shortSha: 'ccccccc', message: 'Add a feature', author: 'bob', date: new Date(Date.now() - 7200000).toISOString(), htmlUrl: 'https://github.com/octocat/Hello-World/commit/ccccccc' }],
    tree: [
      { name: 'src', path: 'src', type: 'dir', size: 0, sha: 'd' },
      { name: 'README.md', path: 'README.md', type: 'file', size: 2048, sha: 'e' },
    ],
    file: null,
  }, null, null, null,
]);
assert.match(text, /Viewing feature/);
assert.match(text, /Read-only/);
assert.match(text, /Recent commits/);
assert.match(text, /Add a feature/);
assert.match(text, /README\.md/);
assert.match(text, /2\.0 KB/);
assert.match(text, /Back to default branch/);

// Sidebar icon renders for both sizes and active states.
for (const props of [{ size: 20, active: false }, { size: 20, active: true }]) {
  hookIndex = 0;
  seeds = [];
  const icon = sidebar.component(props);
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.width, 20);
  assert.equal(icon.props.height, 20);
}

console.log('client render smoke test passed: 10 render states + sidebar icon');
