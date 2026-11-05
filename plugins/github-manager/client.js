window.__ModuleLoader__.load({
  id: 'dsh-github-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'github-manager';
    const PANEL_KEY = 'github-manager';
    const API_PREFIX = '/api/github-manager';

    // ------------------------------------------------------------------ locale

    const zh = {
      panelTitle: 'GitHub 项目管理',
      title: 'GitHub 项目管理',
      subtitle: '浏览仓库、Issue 与 Pull Request',
      refresh: '刷新',
      loading: '正在加载…',
      retry: '重试',
      notConfiguredTitle: '还没有找到可用的 GitHub 凭据',
      notConfiguredBody: '插件会自动复用本机 gh CLI 的登录（gh auth login），或读取 GH_TOKEN / GITHUB_TOKEN 环境变量。点“重试”会重新检测，无需重启。',
      setupStep1: '方式一（推荐）：本机 gh CLI 已登录时直接点“重试”；未登录则运行：',
      setupStep2: '方式二：或在启动 DeepSeek Harness 的环境中导出 GH_TOKEN / GITHUB_TOKEN，然后重启 DeepSeek Harness。',
      setupScopes: '经典 token 需要 repo 权限；fine-grained token 需要 Contents、Issues、Pull requests 的读写权限。',
      account: '当前账号',
      rate: 'API 余额 {remaining}/{limit}',
      repos: '仓库',
      repoCount: '{count} 个仓库',
      searchRepos: '搜索仓库…',
      filterAll: '全部',
      filterPublic: '公开',
      filterPrivate: '私有',
      noRepos: '没有匹配的仓库',
      noReposHint: '调整搜索或筛选条件，或点击刷新。',
      selectRepo: '选择一个仓库',
      selectRepoHint: '从左侧仓库列表中选择一个仓库，查看它的 Issue 和 Pull Request。',
      updated: '更新于 {time}',
      stars: '星标',
      forks: 'Fork',
      openItems: '未关闭',
      defaultBranch: '默认分支',
      openOnGithub: '在 GitHub 打开',
      copyClone: '复制克隆地址',
      copied: '克隆地址已复制',
      copyFailed: '复制失败，请手动复制',
      newIssue: '新建 Issue',
      issueTitle: '标题',
      issueTitlePlaceholder: '简要描述问题',
      issueBody: '内容（Markdown）',
      issueBodyPlaceholder: '补充复现步骤、期望行为等',
      issueLabels: '标签（用逗号分隔）',
      issueLabelsPlaceholder: 'bug, enhancement',
      create: '创建',
      cancel: '取消',
      creating: '创建中…',
      issueCreated: '已创建 Issue {number}',
      issueTitleRequired: '请填写 Issue 标题',
      issues: 'Issues',
      pulls: 'Pull requests',
      stateOpen: '打开',
      stateClosed: '已关闭',
      stateAll: '全部',
      noIssues: '没有匹配的 Issue',
      noPulls: '没有匹配的 Pull Request',
      noItemsHint: '切换状态筛选，或点击刷新。',
      closeIssue: '关闭',
      reopenIssue: '重新打开',
      issueClosed: '已关闭 Issue {number}',
      issueReopened: '已重新打开 Issue {number}',
      comments: '{count} 条评论',
      draft: '草稿',
      merged: '已合并',
      privateBadge: '私有',
      publicBadge: '公开',
      archived: '已归档',
      forkLabel: 'Fork',
      loadFailed: '加载失败：{message}',
      itemsFailed: '加载列表失败：{message}',
      refreshDone: '已刷新',
      emptyDescription: '暂无描述',
      branches: '{head} → {base}',
      moreRepos: '最多显示 100 个仓库。',
      toggleFailed: '操作失败：{message}',
    };

    const en = {
      panelTitle: 'GitHub projects',
      title: 'GitHub projects',
      subtitle: 'Browse repositories, issues, and pull requests',
      refresh: 'Refresh',
      loading: 'Loading…',
      retry: 'Retry',
      notConfiguredTitle: 'No GitHub credential found',
      notConfiguredBody: 'The plugin reuses your local gh CLI login (gh auth login), or reads GH_TOKEN / GITHUB_TOKEN from the Host environment. Click “Retry” to re-check — no restart needed.',
      setupStep1: 'Option 1 (recommended): if gh CLI is logged in, just click “Retry”; otherwise run:',
      setupStep2: 'Option 2: export GH_TOKEN / GITHUB_TOKEN in the environment that starts DeepSeek Harness, then restart it.',
      setupScopes: 'Classic tokens need the repo scope; fine-grained tokens need read/write for Contents, Issues, and Pull requests.',
      account: 'Signed in as',
      rate: 'API quota {remaining}/{limit}',
      repos: 'Repositories',
      repoCount: '{count} repositories',
      searchRepos: 'Search repositories…',
      filterAll: 'All',
      filterPublic: 'Public',
      filterPrivate: 'Private',
      noRepos: 'No matching repositories',
      noReposHint: 'Change the search or filter, or refresh.',
      selectRepo: 'Select a repository',
      selectRepoHint: 'Pick a repository on the left to browse its issues and pull requests.',
      updated: 'Updated {time}',
      stars: 'Stars',
      forks: 'Forks',
      openItems: 'Open items',
      defaultBranch: 'Default branch',
      openOnGithub: 'Open on GitHub',
      copyClone: 'Copy clone URL',
      copied: 'Clone URL copied',
      copyFailed: 'Copy failed — copy it manually',
      newIssue: 'New issue',
      issueTitle: 'Title',
      issueTitlePlaceholder: 'Summarize the problem',
      issueBody: 'Body (Markdown)',
      issueBodyPlaceholder: 'Steps to reproduce, expected behavior…',
      issueLabels: 'Labels (comma separated)',
      issueLabelsPlaceholder: 'bug, enhancement',
      create: 'Create',
      cancel: 'Cancel',
      creating: 'Creating…',
      issueCreated: 'Created issue {number}',
      issueTitleRequired: 'Enter an issue title',
      issues: 'Issues',
      pulls: 'Pull requests',
      stateOpen: 'Open',
      stateClosed: 'Closed',
      stateAll: 'All',
      noIssues: 'No matching issues',
      noPulls: 'No matching pull requests',
      noItemsHint: 'Change the state filter, or refresh.',
      closeIssue: 'Close',
      reopenIssue: 'Reopen',
      issueClosed: 'Closed issue {number}',
      issueReopened: 'Reopened issue {number}',
      comments: '{count} comments',
      draft: 'Draft',
      merged: 'Merged',
      privateBadge: 'Private',
      publicBadge: 'Public',
      archived: 'Archived',
      forkLabel: 'Fork',
      loadFailed: 'Failed to load: {message}',
      itemsFailed: 'Failed to load the list: {message}',
      refreshDone: 'Refreshed',
      emptyDescription: 'No description',
      branches: '{head} → {base}',
      moreRepos: 'Showing at most 100 repositories.',
      toggleFailed: 'Action failed: {message}',
    };

    let runtime = null;

    function interpolate(template, vars) {
      if (!vars) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        vars[name] === undefined ? match : String(vars[name]));
    }

    function currentDict() {
      const active = snapshot().active;
      return String(active || 'en').startsWith('zh') ? zh : en;
    }

    function fallbackTranslate(key, vars) {
      // Resolve the dictionary per call: the sidebar re-reads its label thunk
      // during a locale publish, possibly before any subscriber cache updates.
      const dict = currentDict();
      const text = dict[key] === undefined ? (en[key] === undefined ? key : en[key]) : dict[key];
      return interpolate(text, vars);
    }

    function snapshot() {
      if (!runtime || !runtime.locale) return { active: 'en', revision: 0 };
      try {
        const value = typeof runtime.locale.getSnapshot === 'function'
          ? runtime.locale.getSnapshot()
          : runtime.locale.getLocale();
        return value || { active: 'en', revision: 0 };
      } catch (_error) {
        return { active: 'en', revision: 0 };
      }
    }

    function subscribeLocale(listener) {
      if (!runtime || !runtime.locale || typeof runtime.locale.subscribe !== 'function') return () => {};
      return runtime.locale.subscribe(listener);
    }

    function useTranslate() {
      React.useSyncExternalStore(subscribeLocale, () => snapshot().revision, () => 0);
      return runtime ? runtime.t : fallbackTranslate;
    }

    function useLocaleId() {
      React.useSyncExternalStore(subscribeLocale, () => snapshot().active, () => 'en');
      const active = snapshot().active;
      return typeof active === 'string' && active ? active : 'en';
    }

    function formatRelative(iso, localeId) {
      if (!iso) return '';
      const time = new Date(iso).getTime();
      if (!Number.isFinite(time)) return '';
      const diff = time - Date.now();
      const abs = Math.abs(diff);
      const units = [
        ['year', 31536000000],
        ['month', 2592000000],
        ['day', 86400000],
        ['hour', 3600000],
        ['minute', 60000],
      ];
      try {
        const relative = new Intl.RelativeTimeFormat(localeId || 'en', { numeric: 'auto' });
        for (const [unit, size] of units) {
          if (abs >= size) return relative.format(Math.round(diff / size), unit);
        }
        return relative.format(Math.round(diff / 1000), 'second');
      } catch (_error) {
        return new Date(iso).toLocaleDateString();
      }
    }

    // --------------------------------------------------------------------- api

    async function api(path, options) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(API_PREFIX + path, {
          method: (options && options.method) || 'GET',
          headers: options && options.body ? { 'content-type': 'application/json' } : undefined,
          body: options && options.body ? JSON.stringify(options.body) : undefined,
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message = body && body.error && body.error.message
            ? body.error.message
            : 'HTTP ' + response.status;
          throw new Error(message);
        }
        if (!body) throw new Error('Empty response from the GitHub manager route.');
        if (body.ok === false) {
          throw new Error((body.error && body.error.message) || 'Request failed.');
        }
        return body.data;
      } catch (error) {
        if (error && error.name === 'AbortError') throw new Error('Request timed out.');
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
    }

    function parseLabels(value) {
      return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20);
    }

    function openExternal(url) {
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    // ------------------------------------------------------------------- icons

    function icon(children, size) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size || 16,
        height: size || 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, children);
    }

    const RefreshIcon = (props) => icon([
      h('path', { key: 'a', d: 'M20 11a8 8 0 1 0-2.3 6.4' }),
      h('path', { key: 'b', d: 'M20 4v7h-7' }),
    ], props && props.size);

    const SearchIcon = (props) => icon([
      h('circle', { key: 'a', cx: 11, cy: 11, r: 6.5 }),
      h('path', { key: 'b', d: 'm16 16 4 4' }),
    ], props && props.size);

    const StarIcon = (props) => icon([
      h('path', { key: 'a', d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z' }),
    ], props && props.size);

    const BranchIcon = (props) => icon([
      h('circle', { key: 'a', cx: 6.5, cy: 5.5, r: 2.1 }),
      h('circle', { key: 'b', cx: 6.5, cy: 18.5, r: 2.1 }),
      h('circle', { key: 'c', cx: 17.5, cy: 8, r: 2.1 }),
      h('path', { key: 'd', d: 'M6.5 7.6v8.9' }),
      h('path', { key: 'e', d: 'M17.5 10.1v2.2a3 3 0 0 1-3 3H8.7' }),
    ], props && props.size);

    const IssueIcon = (props) => icon([
      h('circle', { key: 'a', cx: 12, cy: 12, r: 8.5 }),
      h('circle', { key: 'b', cx: 12, cy: 12, r: 2, fill: 'currentColor', stroke: 'none' }),
    ], props && props.size);

    const PullIcon = (props) => icon([
      h('circle', { key: 'a', cx: 6.5, cy: 5.5, r: 2.1 }),
      h('circle', { key: 'b', cx: 6.5, cy: 18.5, r: 2.1 }),
      h('circle', { key: 'c', cx: 17.5, cy: 18.5, r: 2.1 }),
      h('path', { key: 'd', d: 'M6.5 7.6v8.9' }),
      h('path', { key: 'e', d: 'M17.5 16.4V9.2a2.6 2.6 0 0 0-2.6-2.6h-4.4' }),
      h('path', { key: 'f', d: 'm12.6 4.5-2.2 2.1 2.2 2.1' }),
    ], props && props.size);

    const LockIcon = (props) => icon([
      h('rect', { key: 'a', x: 5, y: 10.5, width: 14, height: 9.5, rx: 2 }),
      h('path', { key: 'b', d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5' }),
    ], props && props.size);

    const ExternalIcon = (props) => icon([
      h('path', { key: 'a', d: 'M14 4h6v6' }),
      h('path', { key: 'b', d: 'M20 4 11 13' }),
      h('path', { key: 'c', d: 'M19 14v5a1.8 1.8 0 0 1-1.8 1.8H5.2A1.8 1.8 0 0 1 3.4 19V7a1.8 1.8 0 0 1 1.8-1.8H10' }),
    ], props && props.size);

    const CopyIcon = (props) => icon([
      h('rect', { key: 'a', x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }),
      h('path', { key: 'b', d: 'M6 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v1' }),
    ], props && props.size);

    const PlusIcon = (props) => icon([
      h('path', { key: 'a', d: 'M12 5v14' }),
      h('path', { key: 'b', d: 'M5 12h14' }),
    ], props && props.size);

    const CheckIcon = (props) => icon([
      h('path', { key: 'a', d: 'm5 12.5 4.5 4.5L19 7.5' }),
    ], props && props.size);

    const KeyIcon = (props) => icon([
      h('circle', { key: 'a', cx: 8, cy: 8, r: 3.7 }),
      h('path', { key: 'b', d: 'm10.7 10.7 8.3 8.3' }),
      h('path', { key: 'c', d: 'm15.5 15.5 2.5-2.5' }),
    ], props && props.size);

    function Spinner() {
      return h('span', { className: 'ghm-spinner', 'aria-hidden': true });
    }

    // -------------------------------------------------------------- components

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 20;
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('circle', { key: 'a', cx: 6.5, cy: 5.5, r: 2.1 }),
        h('circle', { key: 'b', cx: 6.5, cy: 18.5, r: 2.1 }),
        h('circle', { key: 'c', cx: 17.5, cy: 8, r: 2.1 }),
        h('path', { key: 'd', d: 'M6.5 7.6v8.9' }),
        h('path', { key: 'e', d: 'M17.5 10.1v2.2a3 3 0 0 1-3 3H8.7' }),
      );
    }

    function Notice(props) {
      const notice = props.notice;
      if (!notice) return null;
      return h('div', {
        className: 'ghm-notice',
        'data-kind': notice.kind,
        role: notice.kind === 'error' ? 'alert' : 'status',
      }, notice.text);
    }

    function SetupCard(props) {
      const t = props.t;
      return h('div', { className: 'ghm-setup' },
        h('div', { className: 'ghm-setupIcon' }, h(KeyIcon, { size: 26 })),
        h('h2', { className: 'ghm-setupTitle' }, t('notConfiguredTitle')),
        h('p', { className: 'ghm-setupText' }, t('notConfiguredBody')),
        h('ol', { className: 'ghm-setupList' },
          h('li', null,
            t('setupStep1'),
            h('code', { className: 'ghm-code' }, 'gh auth login')),
          h('li', null,
            t('setupStep2'),
            h('code', { className: 'ghm-code' }, 'export GH_TOKEN=<your-token>'))),
        h('p', { className: 'ghm-setupHint' }, t('setupScopes')),
        h('button', {
          type: 'button',
          className: 'ghm-btn ghm-btnPrimary',
          onClick: props.onRetry,
          disabled: props.busy,
        }, props.busy ? t('loading') : t('retry')));
    }

    function RepoRow(props) {
      const repo = props.repo;
      const t = props.t;
      const localeId = props.localeId;
      return h('button', {
        type: 'button',
        className: 'ghm-repo',
        'data-selected': repo.fullName === props.selected ? 'true' : 'false',
        onClick: () => props.onSelect(repo.fullName),
        title: repo.fullName,
      },
        h('div', { className: 'ghm-repoTop' },
          h('span', { className: 'ghm-repoName' }, repo.name || repo.fullName),
          repo.private ? h('span', { className: 'ghm-repoFlag' }, h(LockIcon, { size: 12 })) : null,
          repo.archived ? h('span', { className: 'ghm-chip ghm-chipMuted' }, t('archived')) : null),
        h('div', { className: 'ghm-repoOwner' }, repo.owner),
        repo.description
          ? h('div', { className: 'ghm-repoDesc' }, repo.description)
          : null,
        h('div', { className: 'ghm-repoMeta' },
          repo.language ? h('span', { className: 'ghm-metaItem' }, repo.language) : null,
          h('span', { className: 'ghm-metaItem' }, h(StarIcon, { size: 12 }), String(repo.stars ?? 0)),
          h('span', { className: 'ghm-metaItem ghm-metaMuted' }, formatRelative(repo.updatedAt, localeId))));
    }

    function IssueRow(props) {
      const issue = props.issue;
      const t = props.t;
      const localeId = props.localeId;
      const pending = props.pending === issue.number;
      return h('div', { className: 'ghm-row', 'data-state': issue.state },
        h('span', { className: 'ghm-rowIcon', 'data-state': issue.state }, h(IssueIcon, { size: 16 })),
        h('div', { className: 'ghm-rowMain' },
          h('div', { className: 'ghm-rowTitleLine' },
            h('a', {
              className: 'ghm-rowTitle',
              href: issue.htmlUrl || undefined,
              target: '_blank',
              rel: 'noopener noreferrer',
              onClick: (event) => { event.preventDefault(); openExternal(issue.htmlUrl); },
            }, issue.title),
            h('span', { className: 'ghm-rowNumber' }, '#' + issue.number)),
          h('div', { className: 'ghm-rowMeta' },
            h('span', null, issue.author || ''),
            h('span', null, formatRelative(issue.updatedAt, localeId)),
            issue.comments ? h('span', null, t('comments', { count: issue.comments })) : null,
            issue.labels && issue.labels.length
              ? h('span', { className: 'ghm-tags' }, issue.labels.slice(0, 4).map((label) =>
                h('span', { className: 'ghm-tag', key: label.name },
                  label.color ? h('span', { className: 'ghm-tagDot', style: { background: '#' + label.color } }) : null,
                  label.name)))
              : null)),
        h('div', { className: 'ghm-rowActions' },
          h('button', {
            type: 'button',
            className: 'ghm-btn ghm-btnGhost',
            onClick: () => props.onToggle(issue),
            disabled: pending,
            title: issue.state === 'open' ? t('closeIssue') : t('reopenIssue'),
          }, issue.state === 'open' ? t('closeIssue') : t('reopenIssue'))));
    }

    function PullRow(props) {
      const pull = props.pull;
      const t = props.t;
      const localeId = props.localeId;
      return h('div', { className: 'ghm-row', 'data-state': pull.state },
        h('span', { className: 'ghm-rowIcon', 'data-merged': pull.merged ? 'true' : 'false' }, h(PullIcon, { size: 16 })),
        h('div', { className: 'ghm-rowMain' },
          h('div', { className: 'ghm-rowTitleLine' },
            h('a', {
              className: 'ghm-rowTitle',
              href: pull.htmlUrl || undefined,
              target: '_blank',
              rel: 'noopener noreferrer',
              onClick: (event) => { event.preventDefault(); openExternal(pull.htmlUrl); },
            }, pull.title),
            h('span', { className: 'ghm-rowNumber' }, '#' + pull.number),
            pull.draft ? h('span', { className: 'ghm-chip' }, t('draft')) : null,
            pull.merged ? h('span', { className: 'ghm-chip ghm-chipMerged' }, t('merged')) : null),
          h('div', { className: 'ghm-rowMeta' },
            h('span', { className: 'ghm-branch' }, t('branches', { head: pull.head || '?', base: pull.base || '?' })),
            h('span', null, pull.author || ''),
            h('span', null, formatRelative(pull.updatedAt, localeId)),
            pull.comments ? h('span', null, t('comments', { count: pull.comments })) : null)),
        h('div', { className: 'ghm-rowActions' },
          h('button', {
            type: 'button',
            className: 'ghm-btn ghm-btnGhost',
            title: t('openOnGithub'),
            'aria-label': t('openOnGithub'),
            onClick: () => openExternal(pull.htmlUrl),
          }, h(ExternalIcon, { size: 14 }))));
    }

    function EmptyState(props) {
      return h('div', { className: 'ghm-empty' },
        h('div', { className: 'ghm-emptyIcon' }, props.icon),
        h('div', { className: 'ghm-emptyTitle' }, props.title),
        props.hint ? h('div', { className: 'ghm-emptyHint' }, props.hint) : null);
    }

    function GithubPage() {
      const t = useTranslate();
      const localeId = useLocaleId();

      const [status, setStatus] = React.useState(null);
      const [repos, setRepos] = React.useState([]);
      const [loading, setLoading] = React.useState(true);
      const [loadError, setLoadError] = React.useState('');
      const [refreshKey, setRefreshKey] = React.useState(0);
      const [selected, setSelected] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [visibility, setVisibility] = React.useState('all');
      const [tab, setTab] = React.useState('issues');
      const [stateFilter, setStateFilter] = React.useState('open');
      const [items, setItems] = React.useState([]);
      const [itemsLoading, setItemsLoading] = React.useState(false);
      const [itemsError, setItemsError] = React.useState('');
      const [itemsVersion, setItemsVersion] = React.useState(0);
      const [notice, setNotice] = React.useState(null);
      const [editor, setEditor] = React.useState(null);
      const [pendingIssue, setPendingIssue] = React.useState(null);
      const submittingRef = React.useRef(false);

      const refresh = React.useCallback(() => setRefreshKey((value) => value + 1), []);

      React.useEffect(() => {
        let alive = true;
        setLoading(true);
        setLoadError('');
        (async () => {
          try {
            const nextStatus = await api('/status');
            if (!alive) return;
            setStatus(nextStatus);
            if (nextStatus && nextStatus.configured) {
              const list = await api('/repos');
              if (!alive) return;
              const nextRepos = (list && list.items) || [];
              setRepos(nextRepos);
              setSelected((previous) => {
                if (previous && nextRepos.some((repo) => repo.fullName === previous)) return previous;
                return nextRepos.length ? nextRepos[0].fullName : '';
              });
            } else {
              setRepos([]);
            }
          } catch (error) {
            if (alive) setLoadError((error && error.message) || String(error));
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => { alive = false; };
      }, [refreshKey]);

      const selectedRepo = React.useMemo(
        () => repos.find((repo) => repo.fullName === selected) || null,
        [repos, selected],
      );

      React.useEffect(() => {
        if (!selectedRepo) {
          setItems([]);
          setItemsError('');
          return undefined;
        }
        let alive = true;
        setItemsLoading(true);
        setItemsError('');
        const resource = tab === 'issues' ? '/issues' : '/pulls';
        const path = resource
          + '?full_name=' + encodeURIComponent(selectedRepo.fullName)
          + '&state=' + encodeURIComponent(stateFilter);
        api(path).then(
          (data) => { if (alive) setItems((data && data.items) || []); },
          (error) => { if (alive) setItemsError((error && error.message) || String(error)); },
        ).finally(() => { if (alive) setItemsLoading(false); });
        return () => { alive = false; };
      }, [selectedRepo, tab, stateFilter, refreshKey, itemsVersion]);

      React.useEffect(() => {
        if (!notice) return undefined;
        const timer = window.setTimeout(() => setNotice(null), 5000);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const visibleRepos = React.useMemo(() => {
        const needle = query.trim().toLowerCase();
        return repos.filter((repo) => {
          if (visibility === 'private' && !repo.private) return false;
          if (visibility === 'public' && repo.private) return false;
          if (!needle) return true;
          const haystack = [repo.fullName, repo.description, repo.language].join(' ').toLowerCase();
          return haystack.includes(needle);
        });
      }, [repos, query, visibility]);

      function selectRepo(fullName) {
        setSelected(fullName);
        setEditor(null);
      }

      function selectTab(nextTab) {
        setTab(nextTab);
        setEditor(null);
      }

      async function toggleIssue(issue) {
        if (!selectedRepo) return;
        const nextState = issue.state === 'open' ? 'closed' : 'open';
        setPendingIssue(issue.number);
        try {
          await api('/issue-state', {
            method: 'POST',
            body: { full_name: selectedRepo.fullName, number: issue.number, state: nextState },
          });
          setNotice({
            kind: 'success',
            text: nextState === 'closed'
              ? t('issueClosed', { number: '#' + issue.number })
              : t('issueReopened', { number: '#' + issue.number }),
          });
          setItemsVersion((value) => value + 1);
        } catch (error) {
          setNotice({
            kind: 'error',
            text: t('toggleFailed', { message: (error && error.message) || String(error) }),
          });
        } finally {
          setPendingIssue(null);
        }
      }

      async function copyCloneUrl() {
        if (!selectedRepo || !selectedRepo.cloneUrl) return;
        try {
          await navigator.clipboard.writeText(selectedRepo.cloneUrl);
          setNotice({ kind: 'success', text: t('copied') });
        } catch (_error) {
          setNotice({ kind: 'error', text: t('copyFailed') });
        }
      }

      function openEditor() {
        setEditor({ title: '', body: '', labels: '', busy: false });
      }

      async function submitIssue(event) {
        event.preventDefault();
        // A synchronous guard, because two clicks can land before the busy
        // state re-renders and would otherwise create the issue twice.
        if (!selectedRepo || !editor || submittingRef.current) return;
        const title = (editor.title || '').trim();
        if (!title) {
          setNotice({ kind: 'error', text: t('issueTitleRequired') });
          return;
        }
        submittingRef.current = true;
        setEditor({ ...editor, busy: true });
        try {
          const created = await api('/issue', {
            method: 'POST',
            body: {
              full_name: selectedRepo.fullName,
              title,
              body: editor.body || '',
              labels: parseLabels(editor.labels),
            },
          });
          setEditor(null);
          setTab('issues');
          setStateFilter('open');
          setItemsVersion((value) => value + 1);
          setNotice({ kind: 'success', text: t('issueCreated', { number: '#' + (created && created.number) }) });
        } catch (error) {
          setEditor((previous) => (previous ? { ...previous, busy: false } : previous));
          setNotice({ kind: 'error', text: t('toggleFailed', { message: (error && error.message) || String(error) }) });
        } finally {
          submittingRef.current = false;
        }
      }

      const configured = Boolean(status && status.configured);

      const header = h('div', { className: 'ghm-header' },
        h('div', { className: 'ghm-heading' },
          h('h1', { className: 'ghm-title' }, t('title')),
          h('p', { className: 'ghm-subtitle' }, t('subtitle'))),
        h('div', { className: 'ghm-headerRight' },
          configured
            ? h('div', { className: 'ghm-account', title: status.login || '' },
              status.avatarUrl
                ? h('img', {
                  className: 'ghm-avatar',
                  src: status.avatarUrl,
                  alt: '',
                  loading: 'lazy',
                  onError: (event) => { event.currentTarget.style.visibility = 'hidden'; },
                })
                : h('span', { className: 'ghm-avatar ghm-avatarFallback' }, (status.login || '?').slice(0, 1).toUpperCase()),
              h('div', { className: 'ghm-accountInfo' },
                h('span', { className: 'ghm-login' }, status.name || status.login || ''),
                status.rateLimit
                  ? h('span', { className: 'ghm-rate' }, t('rate', { remaining: status.rateLimit.remaining, limit: status.rateLimit.limit }))
                  : h('span', { className: 'ghm-rate' }, status.login || '')))
            : null,
          h('button', {
            type: 'button',
            className: 'ghm-btn ghm-btnGhost ghm-refresh',
            onClick: refresh,
            disabled: loading,
            title: t('refresh'),
            'aria-label': t('refresh'),
          }, loading ? h(Spinner) : h(RefreshIcon, { size: 15 }), h('span', null, t('refresh')))));

      let body;
      if (loading && !status) {
        body = h('div', { className: 'ghm-center' }, h(Spinner), h('span', null, t('loading')));
      } else if (loadError) {
        body = h('div', { className: 'ghm-center' },
          h('div', { className: 'ghm-errorText' }, t('loadFailed', { message: loadError })),
          h('button', { type: 'button', className: 'ghm-btn ghm-btnPrimary', onClick: refresh }, t('retry')));
      } else if (!configured) {
        body = h(SetupCard, { t, onRetry: refresh, busy: loading });
      } else {
        const listPane = h('aside', { className: 'ghm-col ghm-sidebar', 'aria-label': t('repos') },
          h('div', { className: 'ghm-sidebarHead' },
            h('div', { className: 'ghm-searchWrap' },
              h(SearchIcon, { size: 14 }),
              h('input', {
                type: 'search',
                className: 'ghm-input ghm-search',
                value: query,
                placeholder: t('searchRepos'),
                'aria-label': t('searchRepos'),
                onChange: (event) => setQuery(event.target.value),
              })),
            h('div', { className: 'ghm-filters', role: 'group' },
              [['all', t('filterAll')], ['public', t('filterPublic')], ['private', t('filterPrivate')]].map(([value, label]) =>
                h('button', {
                  key: value,
                  type: 'button',
                  className: 'ghm-filter',
                  'data-active': visibility === value ? 'true' : 'false',
                  onClick: () => setVisibility(value),
                }, label))),
            h('div', { className: 'ghm-sidebarMeta' }, t('repoCount', { count: visibleRepos.length }))),
          h('div', { className: 'ghm-repoList' },
            visibleRepos.length === 0
              ? h(EmptyState, { icon: h(BranchIcon, { size: 22 }), title: t('noRepos'), hint: t('noReposHint') })
              : visibleRepos.map((repo) => h(RepoRow, {
                key: repo.fullName,
                repo,
                t,
                localeId,
                selected,
                onSelect: selectRepo,
              }))),
          h('div', { className: 'ghm-sidebarFoot' }, t('moreRepos')));

        let detail;
        if (!selectedRepo) {
          detail = h('section', { className: 'ghm-col ghm-detail' },
            h(EmptyState, { icon: h(BranchIcon, { size: 26 }), title: t('selectRepo'), hint: t('selectRepoHint') }));
        } else {
          const tabs = h('div', { className: 'ghm-tabs', role: 'tablist' },
            h('button', {
              type: 'button',
              role: 'tab',
              className: 'ghm-tab',
              'data-active': tab === 'issues' ? 'true' : 'false',
              'aria-selected': tab === 'issues' ? 'true' : 'false',
              onClick: () => selectTab('issues'),
            }, t('issues')),
            h('button', {
              type: 'button',
              role: 'tab',
              className: 'ghm-tab',
              'data-active': tab === 'pulls' ? 'true' : 'false',
              'aria-selected': tab === 'pulls' ? 'true' : 'false',
              onClick: () => selectTab('pulls'),
            }, t('pulls')),
            h('div', { className: 'ghm-stateFilter', role: 'group' },
              [['open', t('stateOpen')], ['closed', t('stateClosed')], ['all', t('stateAll')]].map(([value, label]) =>
                h('button', {
                  key: value,
                  type: 'button',
                  className: 'ghm-stateChip',
                  'data-active': stateFilter === value ? 'true' : 'false',
                  onClick: () => setStateFilter(value),
                }, label))));

          let listContent;
          if (itemsLoading) {
            listContent = h('div', { className: 'ghm-center ghm-centerInline' }, h(Spinner), h('span', null, t('loading')));
          } else if (itemsError) {
            listContent = h('div', { className: 'ghm-center ghm-centerInline' },
              h('div', { className: 'ghm-errorText' }, t('itemsFailed', { message: itemsError })),
              h('button', {
                type: 'button',
                className: 'ghm-btn ghm-btnGhost',
                onClick: () => setItemsVersion((value) => value + 1),
              }, t('retry')));
          } else if (items.length === 0) {
            listContent = h(EmptyState, {
              icon: tab === 'issues' ? h(IssueIcon, { size: 24 }) : h(PullIcon, { size: 24 }),
              title: tab === 'issues' ? t('noIssues') : t('noPulls'),
              hint: t('noItemsHint'),
            });
          } else {
            listContent = tab === 'issues'
              ? items.map((issue) => h(IssueRow, {
                key: issue.number,
                issue,
                t,
                localeId,
                pending: pendingIssue,
                onToggle: toggleIssue,
              }))
              : items.map((pull) => h(PullRow, { key: pull.number, pull, t, localeId }));
          }

          detail = h('section', { className: 'ghm-col ghm-detail' },
            h('div', { className: 'ghm-detailHead' },
              h('div', { className: 'ghm-detailTitleLine' },
                h('h2', { className: 'ghm-repoTitle' }, selectedRepo.fullName),
                selectedRepo.private
                  ? h('span', { className: 'ghm-chip' }, t('privateBadge'))
                  : h('span', { className: 'ghm-chip ghm-chipMuted' }, t('publicBadge')),
                selectedRepo.fork ? h('span', { className: 'ghm-chip ghm-chipMuted' }, t('forkLabel')) : null,
                selectedRepo.archived ? h('span', { className: 'ghm-chip ghm-chipMuted' }, t('archived')) : null),
              h('p', { className: 'ghm-repoDescLine' }, selectedRepo.description || t('emptyDescription')),
              h('div', { className: 'ghm-detailMeta' },
                h('span', { className: 'ghm-metaItem' }, h(StarIcon, { size: 13 }), String(selectedRepo.stars ?? 0)),
                h('span', { className: 'ghm-metaItem' }, String(selectedRepo.forks ?? 0) + ' ' + t('forks')),
                h('span', { className: 'ghm-metaItem' }, String(selectedRepo.openItems ?? 0) + ' ' + t('openItems')),
                selectedRepo.language ? h('span', { className: 'ghm-metaItem' }, selectedRepo.language) : null,
                selectedRepo.defaultBranch
                  ? h('span', { className: 'ghm-metaItem ghm-metaMuted' }, t('defaultBranch') + ': ' + selectedRepo.defaultBranch)
                  : null,
                h('span', { className: 'ghm-metaItem ghm-metaMuted' }, formatRelative(selectedRepo.updatedAt, localeId))),
              h('div', { className: 'ghm-detailActions' },
                h('button', {
                  type: 'button',
                  className: 'ghm-btn ghm-btnPrimary',
                  onClick: openEditor,
                }, h(PlusIcon, { size: 14 }), t('newIssue')),
                h('button', {
                  type: 'button',
                  className: 'ghm-btn',
                  onClick: () => openExternal(selectedRepo.htmlUrl),
                }, h(ExternalIcon, { size: 14 }), t('openOnGithub')),
                h('button', {
                  type: 'button',
                  className: 'ghm-btn',
                  onClick: copyCloneUrl,
                }, h(CopyIcon, { size: 14 }), t('copyClone')))),
            editor
              ? h('form', { className: 'ghm-editor', onSubmit: submitIssue },
                h('div', { className: 'ghm-editorTitle' }, t('newIssue')),
                h('label', { className: 'ghm-field' },
                  h('span', { className: 'ghm-fieldLabel' }, t('issueTitle')),
                  h('input', {
                    type: 'text',
                    className: 'ghm-input',
                    value: editor.title,
                    placeholder: t('issueTitlePlaceholder'),
                    autoFocus: true,
                    onChange: (event) => setEditor({ ...editor, title: event.target.value }),
                    onKeyDown: (event) => { if (event.key === 'Escape') setEditor(null); },
                  })),
                h('label', { className: 'ghm-field' },
                  h('span', { className: 'ghm-fieldLabel' }, t('issueBody')),
                  h('textarea', {
                    className: 'ghm-input ghm-textarea',
                    rows: 4,
                    value: editor.body,
                    placeholder: t('issueBodyPlaceholder'),
                    onChange: (event) => setEditor({ ...editor, body: event.target.value }),
                    onKeyDown: (event) => { if (event.key === 'Escape') setEditor(null); },
                  })),
                h('label', { className: 'ghm-field' },
                  h('span', { className: 'ghm-fieldLabel' }, t('issueLabels')),
                  h('input', {
                    type: 'text',
                    className: 'ghm-input',
                    value: editor.labels,
                    placeholder: t('issueLabelsPlaceholder'),
                    onChange: (event) => setEditor({ ...editor, labels: event.target.value }),
                    onKeyDown: (event) => { if (event.key === 'Escape') setEditor(null); },
                  })),
                h('div', { className: 'ghm-editorActions' },
                  h('button', {
                    type: 'button',
                    className: 'ghm-btn ghm-btnGhost',
                    onClick: () => setEditor(null),
                    disabled: editor.busy,
                  }, t('cancel')),
                  h('button', {
                    type: 'submit',
                    className: 'ghm-btn ghm-btnPrimary',
                    disabled: editor.busy,
                  }, editor.busy ? t('creating') : t('create'))))
              : null,
            h(Notice, { notice }),
            tabs,
            h('div', { className: 'ghm-list' }, listContent));
        }

        body = h('div', { className: 'ghm-body' }, listPane, detail);
      }

      return h('div', { className: 'ghm-page' }, header, body);
    }

    // ------------------------------------------------------------------ styles

    const CSS = [
      '.ghm-page{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;height:100%;min-height:0;padding:22px 24px 24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.ghm-page *{box-sizing:border-box}',
      '.ghm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.ghm-heading{min-width:0}',
      '.ghm-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.ghm-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-headerRight{display:flex;align-items:center;gap:10px;flex:none}',
      '.ghm-account{display:flex;align-items:center;gap:8px;min-width:0;padding:4px 10px 4px 4px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1)}',
      '.ghm-avatar{width:24px;height:24px;border-radius:50%;object-fit:cover;flex:none;background:var(--dsw-alias-bg-layer-2)}',
      '.ghm-avatarFallback{display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.ghm-accountInfo{display:flex;flex-direction:column;min-width:0;line-height:1.2}',
      '.ghm-login{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ghm-rate{font-size:10.5px;color:var(--dsw-alias-label-secondary);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ghm-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(220px,290px) minmax(0,1fr);gap:14px}',
      '.ghm-col{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.ghm-sidebar{overflow:hidden}',
      '.ghm-sidebarHead{display:flex;flex-direction:column;gap:8px;padding:12px 12px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.ghm-searchWrap{position:relative;display:flex;align-items:center;gap:6px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.ghm-searchWrap:focus-within{border-color:var(--dsw-alias-border-l2)}',
      '.ghm-input{width:100%;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:6px 8px;outline:none}',
      '.ghm-input:focus{border-color:var(--dsw-alias-border-l2)}',
      '.ghm-search{border:0;background:transparent;padding:6px 2px}',
      '.ghm-search:focus{border:0}',
      '.ghm-filters{display:flex;gap:4px}',
      '.ghm-filter{flex:1;border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:20px;border-radius:6px;cursor:pointer;padding:0 6px}',
      '.ghm-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.ghm-filter[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.ghm-sidebarMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-repoList{flex:1;min-height:0;overflow:auto;padding:6px}',
      '.ghm-repo{display:block;width:100%;text-align:left;border:0.5px solid transparent;border-radius:9px;background:transparent;color:inherit;font:inherit;padding:8px 9px;cursor:pointer;margin-bottom:2px}',
      '.ghm-repo:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.ghm-repo[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.ghm-repoTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.ghm-repoName{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.ghm-repoFlag{display:inline-flex;color:var(--dsw-alias-label-secondary);flex:none}',
      '.ghm-repoOwner{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ghm-repoDesc{margin-top:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.ghm-repoMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-metaItem{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}',
      '.ghm-metaMuted{color:var(--dsw-alias-label-secondary);opacity:.85}',
      '.ghm-sidebarFoot{flex:none;padding:8px 12px;border-top:0.5px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-detail{overflow-y:auto;overflow-x:hidden}',
      '.ghm-detailHead{display:flex;flex-direction:column;gap:6px;padding:14px 16px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.ghm-detailTitleLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.ghm-repoTitle{margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere}',
      '.ghm-chip{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10.5px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.ghm-chipMuted{opacity:.85}',
      '.ghm-chipMerged{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.ghm-repoDescLine{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.ghm-detailMeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-detailActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}',
      '.ghm-btn{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:22px;padding:0 10px;cursor:pointer;white-space:nowrap}',
      '.ghm-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.ghm-btn:disabled{opacity:.55;cursor:default}',
      '.ghm-btnPrimary{border-color:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.ghm-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary))}',
      '.ghm-btnGhost{border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 8px}',
      '.ghm-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.ghm-refresh{flex:none}',
      '.ghm-tabs{display:flex;align-items:center;gap:4px;padding:8px 16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.ghm-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:4px 8px 8px;border-bottom:2px solid transparent;cursor:pointer}',
      '.ghm-tab[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.ghm-stateFilter{display:flex;gap:4px;margin-left:auto;padding-bottom:6px}',
      '.ghm-stateChip{border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:20px;padding:0 8px;border-radius:999px;cursor:pointer}',
      '.ghm-stateChip:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.ghm-stateChip[data-active="true"]{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.ghm-list{padding:6px 10px 12px;display:flex;flex-direction:column;gap:2px}',
      '.ghm-row{display:flex;align-items:flex-start;gap:9px;padding:9px 6px;border-radius:8px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
      '.ghm-row:last-child{border-bottom:0}',
      '.ghm-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.ghm-rowIcon{display:inline-flex;flex:none;margin-top:2px;color:var(--dsw-alias-state-success-primary)}',
      '.ghm-rowIcon[data-state="closed"]{color:var(--dsw-alias-label-secondary)}',
      '.ghm-rowIcon[data-merged="true"]{color:var(--dsw-alias-brand-primary)}',
      '.ghm-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.ghm-rowTitleLine{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}',
      '.ghm-rowTitle{color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:600;text-decoration:none;overflow-wrap:anywhere;cursor:pointer}',
      '.ghm-rowTitle:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}',
      '.ghm-rowNumber{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.ghm-rowMeta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-tags{display:inline-flex;gap:4px;flex-wrap:wrap}',
      '.ghm-tag{display:inline-flex;align-items:center;gap:4px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;line-height:15px}',
      '.ghm-tagDot{width:6px;height:6px;border-radius:50%;flex:none}',
      '.ghm-rowActions{flex:none;display:flex;align-items:center;gap:4px;margin-left:4px}',
      '.ghm-branch{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10px;background:var(--dsw-alias-bg-base);border:0.5px solid var(--dsw-alias-border-l1);border-radius:5px;padding:0 5px;line-height:16px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ghm-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);min-height:180px;text-align:center;padding:24px}',
      '.ghm-centerInline{min-height:140px}',
      '.ghm-errorText{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;max-width:520px}',
      '.ghm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:32px 20px;text-align:center;color:var(--dsw-alias-label-secondary);min-height:160px}',
      '.ghm-emptyIcon{opacity:.7;display:inline-flex}',
      '.ghm-emptyTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.ghm-emptyHint{font-size:11.5px;max-width:360px}',
      '.ghm-setup{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:22px 24px;overflow:auto;max-width:760px}',
      '.ghm-setupIcon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.ghm-setupTitle{margin:0;font-size:15px;font-weight:600}',
      '.ghm-setupText,.ghm-setupHint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.ghm-setupList{margin:0;padding-left:18px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:6px}',
      '.ghm-setupList li{line-height:1.7}',
      '.ghm-code{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:5px;border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:11px;color:var(--dsw-alias-label-primary)}',
      '.ghm-notice{padding:7px 10px;margin:8px 16px 0;border-radius:7px;font-size:11.5px;border:0.5px solid var(--dsw-alias-border-l1)}',
      '.ghm-notice[data-kind="success"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.ghm-notice[data-kind="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.ghm-editor{display:flex;flex-direction:column;gap:8px;margin:10px 16px 0;padding:12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.ghm-editorTitle{font-size:12.5px;font-weight:600}',
      '.ghm-field{display:flex;flex-direction:column;gap:3px}',
      '.ghm-fieldLabel{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.ghm-textarea{resize:vertical;min-height:72px;font-family:inherit}',
      '.ghm-editorActions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}',
      '.ghm-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:ghm-spin .8s linear infinite;display:inline-block;flex:none}',
      '@keyframes ghm-spin{to{transform:rotate(360deg)}}',
      '@media (max-width: 760px){.ghm-body{grid-template-columns:minmax(0,1fr)}.ghm-sidebar{max-height:260px}}',
    ].join('\n');

    function insertStyles() {
      const tagId = 'dsh-github-manager/style';
      if (typeof document === 'undefined') return () => {};
      // Replace any stale tag from a previous instance so this run owns the
      // exact tag it removes on unload.
      const previous = document.querySelector('style[data-plugin-css="' + tagId + '"]');
      if (previous && typeof previous.remove === 'function') previous.remove();
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-github-manager';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    // -------------------------------------------------------------------- mount

    function apply(ctx) {
      runtime = {
        locale: ctx.locale,
        t: (key, vars) => fallbackTranslate(key, vars),
      };
      ctx.effect(() => ctx.locale.register(NS, { zh, en }));
      ctx.effect(() => insertStyles());
      ctx.effect(() => () => { runtime = null; });
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_KEY,
        order: 30,
        label: () => (runtime ? runtime.t('panelTitle') : 'GitHub'),
      }, PanelIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, GithubPage));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
