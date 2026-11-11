window.__ModuleLoader__.load({
  id: 'dsh-task-ledger',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'task-ledger';
    const PANEL_KEY = 'task-ledger';
    const API_PREFIX = '/api/task-ledger';
    // The sidebar icon sits beside the other panel entries of the profile.
    const PANEL_ORDER = 30;

    // ------------------------------------------------------------------ locale

    const zh = {
      panelTitle: '任务账本',
      title: '任务账本',
      subtitle: '任务章程、状态、决策与证据的长期记录',
      refresh: '刷新',
      loading: '正在加载…',
      retry: '重试',
      requestTimeout: '请求超时',
      emptyResponse: '任务账本接口返回了空响应',
      httpError: '请求失败（HTTP {status}）',
      listAria: '任务列表',
      searchPlaceholder: '搜索任务…',
      searchAria: '搜索任务',
      filterAll: '全部',
      filterOpen: '进行中',
      filterBlocked: '阻塞',
      filterDone: '完成',
      tasksTotal: '{count} 个任务',
      activeTask: '当前任务',
      activeBadge: '当前任务',
      pinActive: '设为当前任务',
      unpinActive: '取消当前任务',
      pinned: '已设为当前任务',
      unpinned: '已取消当前任务',
      rootLabel: '账本目录',
      noTasksTitle: '还没有任务',
      noTasksHint: '在对话里让 agent 创建第一个任务，或检查账本目录。',
      noMatchTitle: '没有匹配的任务',
      noMatchHint: '调整搜索或筛选条件，或点击刷新。',
      selectTaskTitle: '选择一个任务',
      selectTaskHint: '从左侧选择任务，查看它的章程、进展、主张与证据。',
      loadFailed: '加载失败：{message}',
      detailFailed: '加载任务详情失败：{message}',
      actionFailed: '操作失败：{message}',
      copyTaskId: '复制任务 ID',
      copied: '任务 ID 已复制',
      copyFailed: '复制失败，请手动复制',
      untitledTask: '（未命名任务）',
      phase: '阶段',
      updatedAt: '更新于 {time}',
      createdAt: '创建于 {time}',
      createdLabel: '创建时间',
      charter: '任务章程',
      goal: '目标',
      researchQuestions: '研究问题',
      acceptance: '验收标准',
      evidenceBar: '证据门槛',
      budget: '预算',
      owner: '负责人',
      progress: '进展',
      nextActions: '下一步',
      openQuestions: '待决问题',
      blockedReason: '阻塞原因',
      blockedReasonMissing: '未记录阻塞原因',
      status: '状态',
      claims: '主张',
      claimCount: '{count} 条主张',
      evidenceCount: '{count} 份证据',
      decisions: '决策',
      runs: '运行记录',
      evidence: '证据',
      claimVerified: '已验证',
      claimRefuted: '已反驳',
      claimUnverified: '未验证',
      confidence: '置信度 {value}',
      sourceRef: '来源',
      evidenceHash: 'SHA-256',
      runStarted: '开始',
      runEnded: '结束',
      runNext: '后续动作',
      lastRun: '最近运行',
      markDone: '标记完成',
      markBlocked: '标记阻塞',
      reopen: '重新打开',
      markedDone: '已标记为完成',
      markedBlocked: '已标记为阻塞',
      reopened: '已重新打开',
      readonlyHint: '只读视图：任务内容由 agent 在对话中写入账本。',
      statusOpen: '进行中',
      statusBlocked: '阻塞',
      statusDone: '完成',
      rationale: '理由',
      rejected: '已否决',
      rejectedReason: '否决：{text}',
      evidenceGrade: '证据等级',
      approvedBy: '批准人',
      evidenceFetched: '抓取于',
      unset: '—',
      noClaims: '暂无主张',
      noDecisions: '暂无决策',
      noRuns: '暂无运行记录',
      noEvidence: '暂无证据',
      noNextActions: '暂无下一步动作',
      noOpenQuestions: '暂无待决问题',
    };

    const en = {
      panelTitle: 'Task ledger',
      title: 'Task ledger',
      subtitle: 'The long-lived record of task charters, state, decisions, and evidence',
      refresh: 'Refresh',
      loading: 'Loading…',
      retry: 'Retry',
      requestTimeout: 'Request timed out',
      emptyResponse: 'The task ledger route returned an empty response',
      httpError: 'Request failed (HTTP {status})',
      listAria: 'Task list',
      searchPlaceholder: 'Search tasks…',
      searchAria: 'Search tasks',
      filterAll: 'All',
      filterOpen: 'Open',
      filterBlocked: 'Blocked',
      filterDone: 'Done',
      tasksTotal: '{count} tasks',
      activeTask: 'Active task',
      activeBadge: 'Active',
      pinActive: 'Pin as active task',
      unpinActive: 'Unpin active task',
      pinned: 'Pinned as the active task',
      unpinned: 'Active task cleared',
      rootLabel: 'Ledger root',
      noTasksTitle: 'No tasks yet',
      noTasksHint: 'Ask the agent to create the first task, or check the ledger root.',
      noMatchTitle: 'No matching tasks',
      noMatchHint: 'Change the search or filter, or refresh.',
      selectTaskTitle: 'Select a task',
      selectTaskHint: 'Pick a task on the left to inspect its charter, progress, claims, and evidence.',
      loadFailed: 'Failed to load: {message}',
      detailFailed: 'Failed to load the task: {message}',
      actionFailed: 'Action failed: {message}',
      copyTaskId: 'Copy task ID',
      copied: 'Task ID copied',
      copyFailed: 'Copy failed — copy it manually',
      untitledTask: '(untitled task)',
      phase: 'Phase',
      updatedAt: 'Updated {time}',
      createdAt: 'Created {time}',
      createdLabel: 'Created',
      charter: 'Charter',
      goal: 'Goal',
      researchQuestions: 'Research questions',
      acceptance: 'Acceptance',
      evidenceBar: 'Evidence bar',
      budget: 'Budget',
      owner: 'Owner',
      progress: 'Progress',
      nextActions: 'Next actions',
      openQuestions: 'Open questions',
      blockedReason: 'Blocked reason',
      blockedReasonMissing: 'No blocked reason recorded',
      status: 'Status',
      claims: 'Claims',
      claimCount: '{count} claims',
      evidenceCount: '{count} evidence items',
      decisions: 'Decisions',
      runs: 'Runs',
      evidence: 'Evidence',
      claimVerified: 'Verified',
      claimRefuted: 'Refuted',
      claimUnverified: 'Unverified',
      confidence: 'Confidence {value}',
      sourceRef: 'Source',
      evidenceHash: 'SHA-256',
      runStarted: 'Started',
      runEnded: 'Ended',
      runNext: 'Follow-ups',
      lastRun: 'Last run',
      markDone: 'Mark done',
      markBlocked: 'Mark blocked',
      reopen: 'Reopen',
      markedDone: 'Marked as done',
      markedBlocked: 'Marked as blocked',
      reopened: 'Reopened',
      readonlyHint: 'Read-only view: the agent writes the ledger from the conversation.',
      statusOpen: 'Open',
      statusBlocked: 'Blocked',
      statusDone: 'Done',
      rationale: 'Rationale',
      rejected: 'Rejected',
      rejectedReason: 'Rejected: {text}',
      evidenceGrade: 'Evidence grade',
      approvedBy: 'Approved by',
      evidenceFetched: 'Fetched',
      unset: '—',
      noClaims: 'No claims yet',
      noDecisions: 'No decisions yet',
      noRuns: 'No runs yet',
      noEvidence: 'No evidence yet',
      noNextActions: 'No next actions',
      noOpenQuestions: 'No open questions',
    };

    let runtime = null;

    function interpolate(template, vars) {
      if (!vars) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        vars[name] === undefined ? match : String(vars[name]));
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

    function tr(key, vars) {
      if (runtime && typeof runtime.t === 'function') return runtime.t(key, vars);
      return fallbackTranslate(key, vars);
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

    // --------------------------------------------------------------- formatting

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

    function formatAbsolute(iso, localeId) {
      if (!iso) return '';
      const date = new Date(iso);
      const time = date.getTime();
      if (!Number.isFinite(time)) return '';
      try {
        return date.toLocaleString(localeId || 'en');
      } catch (_error) {
        return date.toISOString();
      }
    }

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function asCount(value, fallback) {
      const number = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(number)) return number;
      return typeof fallback === 'number' ? fallback : 0;
    }

    // Ledger values are free-form (goal, budget, confidence, evidence grade may be
    // strings, numbers, lists, or nested objects). Never hand a raw object to React.
    function displayValue(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (Array.isArray(value)) {
        return value.map((item) => displayValue(item)).filter((item) => item !== '').join(' · ');
      }
      if (typeof value === 'object') {
        return Object.keys(value)
          .map((key) => {
            const inner = displayValue(value[key]);
            return inner === '' ? '' : key + ': ' + inner;
          })
          .filter((item) => item !== '')
          .join(' · ');
      }
      return String(value);
    }

    function shortHash(value) {
      const text = displayValue(value);
      if (!text) return '';
      return text.length > 16 ? text.slice(0, 12) + '…' : text;
    }

    function shortPath(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return '';
      const parts = text.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 2) return text;
      return '…/' + parts.slice(-2).join('/');
    }

    function statusLabel(status, t) {
      if (status === 'done') return t('statusDone');
      if (status === 'blocked') return t('statusBlocked');
      return t('statusOpen');
    }

    function claimLabel(claimStatus, t) {
      if (claimStatus === 'verified') return t('claimVerified');
      if (claimStatus === 'refuted') return t('claimRefuted');
      return t('claimUnverified');
    }

    function claimStatusOf(value) {
      return value === 'verified' || value === 'refuted' ? value : 'unverified';
    }

    // -------------------------------------------------------------------- api

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
            : tr('httpError', { status: response.status });
          throw new Error(message);
        }
        if (!body) throw new Error(tr('emptyResponse'));
        if (body.ok === false) {
          throw new Error((body.error && body.error.message) || tr('emptyResponse'));
        }
        return body.data;
      } catch (error) {
        if (error && error.name === 'AbortError') throw new Error(tr('requestTimeout'));
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
    }

    function openExternal(url) {
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    // ------------------------------------------------------------------ icons

    function icon(children, size) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size || 16,
        height: size || 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
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

    const PinIcon = (props) => icon([
      h('path', { key: 'a', d: 'M9.5 3.5h5l-1.1 5 2.6 2.6v1.4H8v-1.4l2.6-2.6z' }),
      h('path', { key: 'b', d: 'M12 12.5v8' }),
    ], props && props.size);

    const CheckIcon = (props) => icon([
      h('path', { key: 'a', d: 'm5 12.5 4.5 4.5L19 7.5' }),
    ], props && props.size);

    const CheckCircleIcon = (props) => icon([
      h('circle', { key: 'a', cx: 12, cy: 12, r: 8.5 }),
      h('path', { key: 'b', d: 'm8.3 12.2 2.6 2.6 4.9-5.2' }),
    ], props && props.size);

    const BlockIcon = (props) => icon([
      h('circle', { key: 'a', cx: 12, cy: 12, r: 8.5 }),
      h('path', { key: 'b', d: 'm6.5 6.5 11 11' }),
    ], props && props.size);

    const CopyIcon = (props) => icon([
      h('rect', { key: 'a', x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }),
      h('path', { key: 'b', d: 'M6 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v1' }),
    ], props && props.size);

    const AlertIcon = (props) => icon([
      h('path', { key: 'a', d: 'M12 4 21 20H3z' }),
      h('path', { key: 'b', d: 'M12 10v4.5' }),
      h('path', { key: 'c', d: 'M12 17.2v.2' }),
    ], props && props.size);

    const LedgerIcon = (props) => icon([
      h('rect', { key: 'a', x: 4, y: 3, width: 14, height: 18, rx: 2 }),
      h('path', { key: 'b', d: 'M8 7.5h8' }),
      h('path', { key: 'c', d: 'M8 11.5h8' }),
      h('path', { key: 'd', d: 'M8 15.5h5' }),
    ], props && props.size);

    const BeakerIcon = (props) => icon([
      h('path', { key: 'a', d: 'M9.5 3.5h5' }),
      h('path', { key: 'b', d: 'M10.6 3.5v4.9L6.4 18.6a1.6 1.6 0 0 0 1.5 2.3h8.2a1.6 1.6 0 0 0 1.5-2.3l-4.2-10.2V3.5' }),
      h('path', { key: 'c', d: 'M8.2 14.5h7.6' }),
    ], props && props.size);

    const PlayIcon = (props) => icon([
      h('path', { key: 'a', d: 'M8.5 5.6 19 12 8.5 18.4z' }),
    ], props && props.size);

    const FileIcon = (props) => icon([
      h('path', { key: 'a', d: 'M7 3.5h7l4 4V20.5H7z' }),
      h('path', { key: 'b', d: 'M14 3.5v4h4' }),
    ], props && props.size);

    function Spinner() {
      return h('span', { className: 'dsh-task-ledger-spinner', 'aria-hidden': true });
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 20;
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('rect', { key: 'a', x: 3, y: 3, width: 12, height: 18, rx: 2 }),
        h('path', { key: 'b', d: 'M5.6 7.6 6.9 8.9l2-2.1' }),
        h('path', { key: 'c', d: 'M10.6 7.7h2.3' }),
        h('path', { key: 'd', d: 'M5.6 12 6.9 13.3l2-2.1' }),
        h('path', { key: 'e', d: 'M10.6 12.1h2.3' }),
        h('circle', { key: 'f', cx: 6.4, cy: 16.4, r: 1 }),
        h('path', { key: 'g', d: 'M10.6 16.5h2.3' }),
        h('path', { key: 'h', d: 'M15.4 17.5h4' }),
        h('path', { key: 'i', d: 'm17.9 15.9 1.6 1.6-1.6 1.6' }),
      );
    }

    // -------------------------------------------------------------- normalize

    function normalizeSummary(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        task_id: typeof source.task_id === 'string' ? source.task_id : '',
        title: typeof source.title === 'string' ? source.title : '',
        status: typeof source.status === 'string' && source.status ? source.status : 'open',
        phase: typeof source.phase === 'string' ? source.phase : '',
        updated_at: typeof source.updated_at === 'string' ? source.updated_at : '',
        created_at: typeof source.created_at === 'string' ? source.created_at : '',
        next_actions: asArray(source.next_actions),
        blocked_reason: typeof source.blocked_reason === 'string' && source.blocked_reason
          ? source.blocked_reason
          : null,
        open_questions: asArray(source.open_questions),
        claim_count: asCount(source.claim_count, 0),
        evidence_count: asCount(source.evidence_count, 0),
        tags: asArray(source.tags),
        last_run_id: typeof source.last_run_id === 'string' && source.last_run_id
          ? source.last_run_id
          : null,
      };
    }

    function normalizeCounts(raw, tasks) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const derived = { open: 0, blocked: 0, done: 0, total: tasks.length };
      for (const task of tasks) {
        if (task.status === 'done') derived.done += 1;
        else if (task.status === 'blocked') derived.blocked += 1;
        else derived.open += 1;
      }
      return {
        open: asCount(source.open, derived.open),
        blocked: asCount(source.blocked, derived.blocked),
        done: asCount(source.done, derived.done),
        total: asCount(source.total, derived.total),
      };
    }

    function normalizeClaim(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        id: displayValue(source.id),
        claim: source.claim,
        status: claimStatusOf(source.status),
        confidence: source.confidence,
        source_ref: source.source_ref,
        evidence_hash: source.evidence_hash,
        at: typeof source.at === 'string' ? source.at : '',
      };
    }

    function normalizeDecision(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        id: displayValue(source.id),
        decision: source.decision,
        rationale: source.rationale,
        rejected: source.rejected,
        evidence_grade: source.evidence_grade,
        approved_by: source.approved_by,
        at: typeof source.at === 'string' ? source.at : '',
      };
    }

    function normalizeRun(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        run_id: displayValue(source.run_id),
        started_at: typeof source.started_at === 'string' ? source.started_at : '',
        ended_at: typeof source.ended_at === 'string' ? source.ended_at : '',
        summary: source.summary,
        next_actions: asArray(source.next_actions),
      };
    }

    function normalizeEvidence(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        title: displayValue(source.title),
        name: displayValue(source.name),
        url: typeof source.url === 'string' ? source.url : '',
        sha256: displayValue(source.sha256),
        fetched_at: typeof source.fetched_at === 'string' ? source.fetched_at : '',
        mime: typeof source.mime === 'string' ? source.mime : '',
      };
    }

    function normalizeDetail(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const charter = source.charter && typeof source.charter === 'object' ? source.charter : {};
      const state = source.state && typeof source.state === 'object' ? source.state : {};
      return {
        summary: normalizeSummary(source.summary),
        charter: {
          goal: charter.goal,
          research_questions: asArray(charter.research_questions),
          acceptance: asArray(charter.acceptance),
          evidence_bar: charter.evidence_bar,
          budget: charter.budget,
          owner: charter.owner,
          created_at: typeof charter.created_at === 'string' ? charter.created_at : '',
        },
        state: {
          phase: typeof state.phase === 'string' ? state.phase : '',
          status: typeof state.status === 'string' ? state.status : '',
          open_questions: asArray(state.open_questions),
          next_actions: asArray(state.next_actions),
          blocked_reason: typeof state.blocked_reason === 'string' && state.blocked_reason
            ? state.blocked_reason
            : null,
          last_run_id: typeof state.last_run_id === 'string' && state.last_run_id
            ? state.last_run_id
            : null,
        },
        claims: asArray(source.claims).map(normalizeClaim),
        decisions: asArray(source.decisions).map(normalizeDecision),
        runs: asArray(source.runs).map(normalizeRun),
        evidence: asArray(source.evidence).map(normalizeEvidence),
      };
    }

    // ------------------------------------------------------------- components

    function Notice(props) {
      const notice = props.notice;
      if (!notice) return null;
      return h('div', {
        className: 'dsh-task-ledger-notice',
        'data-kind': notice.kind,
        role: notice.kind === 'error' ? 'alert' : 'status',
      }, notice.text);
    }

    function EmptyState(props) {
      return h('div', { className: 'dsh-task-ledger-empty' },
        props.icon ? h('div', { className: 'dsh-task-ledger-emptyIcon' }, props.icon) : null,
        h('div', { className: 'dsh-task-ledger-emptyTitle' }, props.title),
        props.hint ? h('div', { className: 'dsh-task-ledger-emptyHint' }, props.hint) : null);
    }

    function StatusChip(props) {
      return h('span', {
        className: 'dsh-task-ledger-chip',
        'data-status': props.status,
      }, statusLabel(props.status, props.t));
    }

    function Card(props) {
      return h('section', { className: 'dsh-task-ledger-card' },
        h('div', { className: 'dsh-task-ledger-cardHead' },
          props.icon ? h('span', { className: 'dsh-task-ledger-cardIcon' }, props.icon) : null,
          h('h3', { className: 'dsh-task-ledger-cardTitle' }, props.title),
          typeof props.count === 'number'
            ? h('span', { className: 'dsh-task-ledger-cardCount' }, String(props.count))
            : null),
        h('div', { className: 'dsh-task-ledger-cardBody' }, props.children));
    }

    function Field(props) {
      return h('div', { className: 'dsh-task-ledger-field' },
        h('span', { className: 'dsh-task-ledger-fieldLabel' }, props.label),
        props.children);
    }

    function BulletList(props) {
      if (!props.items.length) return h('div', { className: 'dsh-task-ledger-emptyInline' }, props.empty);
      return h('ul', { className: 'dsh-task-ledger-list' }, props.items.map((item, index) =>
        h('li', { key: 'item-' + String(index), className: 'dsh-task-ledger-listItem' },
          displayValue(item))));
    }

    // Read-only checkboxes: the panel shows the ledger, it never edits intentions.
    function ActionList(props) {
      if (!props.items.length) return h('div', { className: 'dsh-task-ledger-emptyInline' }, props.empty);
      return h('ul', { className: 'dsh-task-ledger-list dsh-task-ledger-checkList' },
        props.items.map((item, index) => {
          const text = displayValue(item);
          return h('li', { key: 'action-' + String(index), className: 'dsh-task-ledger-listItem' },
            h('input', {
              type: 'checkbox',
              className: 'dsh-task-ledger-check',
              checked: false,
              readOnly: true,
              tabIndex: -1,
              'aria-label': text,
            }),
            h('span', null, text));
        }));
    }

    function TaskRow(props) {
      const task = props.task;
      const t = props.t;
      const localeId = props.localeId;
      const isActive = props.activeTaskId === task.task_id;
      const updated = formatRelative(task.updated_at, localeId);
      return h('button', {
        type: 'button',
        className: 'dsh-task-ledger-task',
        'data-selected': task.task_id === props.selectedId ? 'true' : 'false',
        'data-status': task.status,
        onClick: () => props.onSelect(task.task_id),
        title: task.title || task.task_id,
      },
        h('div', { className: 'dsh-task-ledger-taskTop' },
          h('span', {
            className: 'dsh-task-ledger-statusDot',
            'data-status': task.status,
            'aria-hidden': true,
          }),
          h('span', { className: 'dsh-task-ledger-taskTitle' }, task.title || t('untitledTask')),
          isActive
            ? h('span', {
              className: 'dsh-task-ledger-taskPin',
              title: t('activeBadge'),
              'aria-label': t('activeBadge'),
            }, h(PinIcon, { size: 12 }))
            : null),
        h('div', { className: 'dsh-task-ledger-taskSub' },
          h('span', { className: 'dsh-task-ledger-taskId' }, task.task_id),
          task.phase
            ? h('span', { className: 'dsh-task-ledger-taskPhase' }, task.phase)
            : null),
        task.status === 'blocked' && task.blocked_reason
          ? h('div', { className: 'dsh-task-ledger-taskBlocked' }, task.blocked_reason)
          : null,
        task.next_actions.length
          ? h('div', { className: 'dsh-task-ledger-taskNext' },
            '→ ' + displayValue(task.next_actions[0]))
          : null,
        h('div', { className: 'dsh-task-ledger-taskMeta' },
          h(StatusChip, { status: task.status, t }),
          updated
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(task.updated_at, localeId),
            }, t('updatedAt', { time: updated }))
            : null,
          h('span', { className: 'dsh-task-ledger-metItem' }, t('claimCount', { count: task.claim_count })),
          h('span', { className: 'dsh-task-ledger-metItem' }, t('evidenceCount', { count: task.evidence_count })),
          task.tags.length
            ? h('span', { className: 'dsh-task-ledger-taskTags' }, task.tags.slice(0, 3).map((tag) =>
              h('span', { key: String(tag), className: 'dsh-task-ledger-tag' }, displayValue(tag))))
            : null));
    }

    function ClaimItem(props) {
      const claim = props.claim;
      const t = props.t;
      const localeId = props.localeId;
      const confidence = displayValue(claim.confidence);
      const sourceRef = displayValue(claim.source_ref);
      const hash = shortHash(claim.evidence_hash);
      return h('div', { className: 'dsh-task-ledger-claim', 'data-claim': claim.status },
        h('div', { className: 'dsh-task-ledger-claimHead' },
          h('span', { className: 'dsh-task-ledger-badge', 'data-claim': claim.status },
            claimLabel(claim.status, t)),
          claim.id
            ? h('span', { className: 'dsh-task-ledger-mono dsh-task-ledger-claimId' }, claim.id)
            : null,
          claim.at
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(claim.at, localeId),
            }, formatRelative(claim.at, localeId))
            : null),
        h('p', { className: 'dsh-task-ledger-claimText' }, displayValue(claim.claim) || t('unset')),
        h('div', { className: 'dsh-task-ledger-claimMeta' },
          confidence
            ? h('span', { className: 'dsh-task-ledger-metItem' }, t('confidence', { value: confidence }))
            : null,
          sourceRef
            ? h('span', { className: 'dsh-task-ledger-metItem' }, t('sourceRef') + ' ' + sourceRef)
            : null,
          hash
            ? h('span', {
              className: 'dsh-task-ledger-metItem dsh-task-ledger-mono',
              title: displayValue(claim.evidence_hash),
            }, t('evidenceHash') + ' ' + hash)
            : null));
    }

    function DecisionItem(props) {
      const decision = props.decision;
      const t = props.t;
      const localeId = props.localeId;
      const grade = displayValue(decision.evidence_grade);
      const approvedBy = displayValue(decision.approved_by);
      const rejected = decision.rejected;
      const rejectedText = rejected === true ? '' : displayValue(rejected);
      return h('div', { className: 'dsh-task-ledger-decision' },
        h('div', { className: 'dsh-task-ledger-claimHead' },
          rejected === true
            ? h('span', { className: 'dsh-task-ledger-badge', 'data-claim': 'refuted' }, t('rejected'))
            : null,
          decision.id
            ? h('span', { className: 'dsh-task-ledger-mono dsh-task-ledger-claimId' }, decision.id)
            : null,
          decision.at
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(decision.at, localeId),
            }, formatRelative(decision.at, localeId))
            : null),
        h('p', { className: 'dsh-task-ledger-claimText' }, displayValue(decision.decision) || t('unset')),
        displayValue(decision.rationale)
          ? h('div', { className: 'dsh-task-ledger-decisionRationale' },
            t('rationale') + ' ' + displayValue(decision.rationale))
          : null,
        rejectedText
          ? h('div', { className: 'dsh-task-ledger-decisionRationale' },
            t('rejectedReason', { text: rejectedText }))
          : null,
        (grade || approvedBy)
          ? h('div', { className: 'dsh-task-ledger-claimMeta' },
            grade
              ? h('span', { className: 'dsh-task-ledger-metItem' }, t('evidenceGrade') + ' ' + grade)
              : null,
            approvedBy
              ? h('span', { className: 'dsh-task-ledger-metItem' }, t('approvedBy') + ' ' + approvedBy)
              : null)
          : null);
    }

    function RunItem(props) {
      const run = props.run;
      const t = props.t;
      const localeId = props.localeId;
      const started = formatRelative(run.started_at, localeId);
      const ended = formatRelative(run.ended_at, localeId);
      return h('div', { className: 'dsh-task-ledger-run' },
        h('div', { className: 'dsh-task-ledger-runHead' },
          h('span', { className: 'dsh-task-ledger-mono' }, run.run_id || t('unset')),
          started
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(run.started_at, localeId),
            }, t('runStarted') + ' ' + started)
            : null,
          ended
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(run.ended_at, localeId),
            }, t('runEnded') + ' ' + ended)
            : null),
        displayValue(run.summary)
          ? h('p', { className: 'dsh-task-ledger-prose' }, displayValue(run.summary))
          : null,
        run.next_actions.length
          ? h(Field, { label: t('runNext') }, h(BulletList, { items: run.next_actions, empty: '' }))
          : null);
    }

    function EvidenceItem(props) {
      const item = props.evidence;
      const t = props.t;
      const localeId = props.localeId;
      const hash = shortHash(item.sha256);
      const fetched = formatRelative(item.fetched_at, localeId);
      return h('div', { className: 'dsh-task-ledger-evidence' },
        h('div', { className: 'dsh-task-ledger-evidenceHead' },
          h('span', { className: 'dsh-task-ledger-evidenceName' },
            item.title || item.name || item.url || t('unset')),
          item.mime
            ? h('span', { className: 'dsh-task-ledger-chip' }, item.mime)
            : null),
        item.url
          ? h('a', {
            className: 'dsh-task-ledger-link',
            href: item.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: (event) => { event.preventDefault(); openExternal(item.url); },
          }, item.url)
          : null,
        h('div', { className: 'dsh-task-ledger-claimMeta' },
          hash
            ? h('span', {
              className: 'dsh-task-ledger-metItem dsh-task-ledger-mono',
              title: item.sha256,
            }, t('evidenceHash') + ' ' + hash)
            : null,
          fetched
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(item.fetched_at, localeId),
            }, t('evidenceFetched') + ' ' + fetched)
            : null));
    }

    function DetailHeader(props) {
      const summary = props.summary;
      const t = props.t;
      const localeId = props.localeId;
      const status = summary.status;
      const updated = formatRelative(summary.updated_at, localeId);
      const created = formatRelative(summary.created_at, localeId);
      const busy = Boolean(props.busy);
      return h('div', { className: 'dsh-task-ledger-detailHead' },
        h('div', { className: 'dsh-task-ledger-detailTitleLine' },
          h('h2', { className: 'dsh-task-ledger-taskHeading' }, summary.title || t('untitledTask')),
          h(StatusChip, { status, t }),
          props.isActive
            ? h('span', { className: 'dsh-task-ledger-chip dsh-task-ledger-chipActive' },
              h(PinIcon, { size: 11 }), t('activeBadge'))
            : null,
          summary.tags.slice(0, 4).map((tag) =>
            h('span', { key: String(tag), className: 'dsh-task-ledger-tag' }, displayValue(tag)))),
        h('div', { className: 'dsh-task-ledger-detailMeta' },
          h('span', { className: 'dsh-task-ledger-metItem dsh-task-ledger-mono' }, summary.task_id),
          summary.phase
            ? h('span', { className: 'dsh-task-ledger-metItem' }, t('phase') + ': ' + summary.phase)
            : null,
          updated
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(summary.updated_at, localeId),
            }, t('updatedAt', { time: updated }))
            : null,
          created
            ? h('span', {
              className: 'dsh-task-ledger-metItem',
              title: formatAbsolute(summary.created_at, localeId),
            }, t('createdAt', { time: created }))
            : null,
          h('span', { className: 'dsh-task-ledger-metItem' }, t('claimCount', { count: props.claimCount })),
          h('span', { className: 'dsh-task-ledger-metItem' }, t('evidenceCount', { count: props.evidenceCount }))),
        h('p', { className: 'dsh-task-ledger-readonly' }, t('readonlyHint')),
        h('div', { className: 'dsh-task-ledger-detailActions' },
          h('button', {
            type: 'button',
            className: 'dsh-task-ledger-btn dsh-task-ledger-btnPrimary',
            disabled: busy,
            onClick: () => props.onStatus(status === 'done' ? 'open' : 'done'),
          }, status === 'done' ? h(CheckCircleIcon, { size: 14 }) : h(CheckIcon, { size: 14 }),
          status === 'done' ? t('reopen') : t('markDone')),
          h('button', {
            type: 'button',
            className: 'dsh-task-ledger-btn',
            disabled: busy,
            onClick: () => props.onStatus('blocked'),
          }, h(BlockIcon, { size: 14 }), t('markBlocked')),
          h('button', {
            type: 'button',
            className: 'dsh-task-ledger-btn',
            disabled: busy,
            onClick: () => props.onToggleActive(summary.task_id),
          }, h(PinIcon, { size: 14 }), props.isActive ? t('unpinActive') : t('pinActive')),
          h('button', {
            type: 'button',
            className: 'dsh-task-ledger-btn dsh-task-ledger-btnGhost',
            onClick: () => props.onCopy(summary.task_id),
          }, h(CopyIcon, { size: 14 }), t('copyTaskId'))));
    }

    function CharterCard(props) {
      const charter = props.charter;
      const t = props.t;
      const localeId = props.localeId;
      const goal = displayValue(charter.goal);
      const evidenceBar = displayValue(charter.evidence_bar);
      const budget = displayValue(charter.budget);
      const owner = displayValue(charter.owner);
      const created = formatRelative(charter.created_at, localeId);
      return h(Card, { title: t('charter'), icon: h(LedgerIcon, { size: 14 }) },
        goal ? h(Field, { label: t('goal') }, h('p', { className: 'dsh-task-ledger-prose' }, goal)) : null,
        h(Field, { label: t('researchQuestions') },
          h(BulletList, { items: charter.research_questions, empty: t('unset') })),
        h(Field, { label: t('acceptance') },
          h(BulletList, { items: charter.acceptance, empty: t('unset') })),
        evidenceBar
          ? h(Field, { label: t('evidenceBar') }, h('p', { className: 'dsh-task-ledger-prose' }, evidenceBar))
          : null,
        h('div', { className: 'dsh-task-ledger-inlineFields' },
          budget ? h(Field, { label: t('budget') }, h('span', { className: 'dsh-task-ledger-muted' }, budget)) : null,
          owner ? h(Field, { label: t('owner') }, h('span', { className: 'dsh-task-ledger-muted' }, owner)) : null,
          created
            ? h(Field, { label: t('createdLabel') },
              h('span', { className: 'dsh-task-ledger-muted' }, created))
            : null));
    }

    function ProgressCard(props) {
      const t = props.t;
      const state = props.state;
      const summary = props.summary;
      const phase = state.phase || summary.phase;
      const lastRun = state.last_run_id || summary.last_run_id;
      const blockedReason = state.blocked_reason || summary.blocked_reason;
      return h(Card, { title: t('progress'), icon: h(CheckCircleIcon, { size: 14 }) },
        h('div', { className: 'dsh-task-ledger-progressGrid' },
          h(Field, { label: t('status') }, h(StatusChip, { status: summary.status, t })),
          phase
            ? h(Field, { label: t('phase') },
              h('span', { className: 'dsh-task-ledger-muted' }, phase))
            : null,
          lastRun
            ? h(Field, { label: t('lastRun') },
              h('span', { className: 'dsh-task-ledger-mono' }, lastRun))
            : null),
        h(Field, { label: t('nextActions') },
          h(ActionList, { items: props.nextActions, empty: t('noNextActions') })),
        h(Field, { label: t('openQuestions') },
          h(BulletList, { items: props.openQuestions, empty: t('noOpenQuestions') })),
        blockedReason
          ? h(Field, { label: t('blockedReason') },
            h('div', { className: 'dsh-task-ledger-callout' }, blockedReason))
          : (summary.status === 'blocked'
            ? h(Field, { label: t('blockedReason') },
              h('div', { className: 'dsh-task-ledger-emptyInline' }, t('blockedReasonMissing')))
            : null));
    }

    function ClaimsCard(props) {
      const t = props.t;
      const localeId = props.localeId;
      return h(Card, {
        title: t('claims'),
        icon: h(BeakerIcon, { size: 14 }),
        count: props.claims.length,
      },
        props.claims.length
          ? props.claims.map((claim, index) =>
            h(ClaimItem, { key: 'claim-' + String(index), claim, t, localeId }))
          : h('div', { className: 'dsh-task-ledger-emptyInline' }, t('noClaims')));
    }

    function DecisionsCard(props) {
      const t = props.t;
      const localeId = props.localeId;
      return h(Card, {
        title: t('decisions'),
        icon: h(CheckCircleIcon, { size: 14 }),
        count: props.decisions.length,
      },
        props.decisions.length
          ? props.decisions.map((decision, index) =>
            h(DecisionItem, { key: 'decision-' + String(index), decision, t, localeId }))
          : h('div', { className: 'dsh-task-ledger-emptyInline' }, t('noDecisions')));
    }

    function RunsCard(props) {
      const t = props.t;
      const localeId = props.localeId;
      return h(Card, { title: t('runs'), icon: h(PlayIcon, { size: 14 }), count: props.runs.length },
        props.runs.length
          ? props.runs.map((run, index) =>
            h(RunItem, { key: 'run-' + String(index), run, t, localeId }))
          : h('div', { className: 'dsh-task-ledger-emptyInline' }, t('noRuns')));
    }

    function EvidenceCard(props) {
      const t = props.t;
      const localeId = props.localeId;
      return h(Card, { title: t('evidence'), icon: h(FileIcon, { size: 14 }), count: props.evidence.length },
        props.evidence.length
          ? props.evidence.map((item, index) =>
            h(EvidenceItem, { key: 'evidence-' + String(index), evidence: item, t, localeId }))
          : h('div', { className: 'dsh-task-ledger-emptyInline' }, t('noEvidence')));
    }

    function TaskDetailPane(props) {
      const detail = props.detail;
      const t = props.t;
      const localeId = props.localeId;
      const summary = detail.summary;
      const state = detail.state;
      const nextActions = state.next_actions.length ? state.next_actions : summary.next_actions;
      const openQuestions = state.open_questions.length ? state.open_questions : summary.open_questions;
      const claimCount = detail.claims.length || summary.claim_count;
      const evidenceCount = detail.evidence.length || summary.evidence_count;
      return h('section', {
        className: 'dsh-task-ledger-col dsh-task-ledger-detail',
        'aria-label': summary.title || summary.task_id,
      },
        h(DetailHeader, {
          summary,
          t,
          localeId,
          busy: props.busy,
          isActive: props.isActive,
          claimCount,
          evidenceCount,
          onStatus: props.onStatus,
          onToggleActive: props.onToggleActive,
          onCopy: props.onCopy,
        }),
        h('div', { className: 'dsh-task-ledger-sections' },
          h(CharterCard, { charter: detail.charter, t, localeId }),
          h(ProgressCard, { summary, state, nextActions, openQuestions, t }),
          h(ClaimsCard, { claims: detail.claims, t, localeId }),
          h(DecisionsCard, { decisions: detail.decisions, t, localeId }),
          h(RunsCard, { runs: detail.runs, t, localeId }),
          h(EvidenceCard, { evidence: detail.evidence, t, localeId })));
    }

    // ------------------------------------------------------------------- page

    function TaskLedgerPage() {
      const t = useTranslate();
      const localeId = useLocaleId();

      const [tasks, setTasks] = React.useState([]);
      const [counts, setCounts] = React.useState({ open: 0, blocked: 0, done: 0, total: 0 });
      const [activeTaskId, setActiveTaskId] = React.useState(null);
      const [root, setRoot] = React.useState('');
      const [loading, setLoading] = React.useState(true);
      const [loadError, setLoadError] = React.useState('');
      const [refreshKey, setRefreshKey] = React.useState(0);
      const [filter, setFilter] = React.useState('all');
      const [query, setQuery] = React.useState('');
      const [selectedId, setSelectedId] = React.useState('');
      const [detail, setDetail] = React.useState(null);
      const [detailError, setDetailError] = React.useState('');
      const [detailVersion, setDetailVersion] = React.useState(0);
      const [notice, setNotice] = React.useState(null);
      const [busy, setBusy] = React.useState('');

      const refresh = React.useCallback(() => setRefreshKey((value) => value + 1), []);
      // Synchronous in-flight guard: two clicks can land before the busy state
      // re-renders and would otherwise fire the same mutation twice.
      const pendingRef = React.useRef('');

      React.useEffect(() => {
        let alive = true;
        setLoading(true);
        setLoadError('');
        (async () => {
          try {
            const data = await api('/index?status=all');
            if (!alive) return;
            const list = Array.isArray(data && data.tasks)
              ? data.tasks.map(normalizeSummary)
              : [];
            setTasks(list);
            setCounts(normalizeCounts(data && data.counts, list));
            setActiveTaskId(data && typeof data.activeTaskId === 'string' ? data.activeTaskId : null);
            setRoot(data && typeof data.root === 'string' ? data.root : '');
            setSelectedId((previous) => {
              if (previous && list.some((task) => task.task_id === previous)) return previous;
              return list.length ? list[0].task_id : '';
            });
          } catch (error) {
            if (alive) setLoadError((error && error.message) || String(error));
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => { alive = false; };
      }, [refreshKey]);

      React.useEffect(() => {
        if (!selectedId) {
          setDetail(null);
          setDetailError('');
          return undefined;
        }
        let alive = true;
        setDetailError('');
        api('/task?task_id=' + encodeURIComponent(selectedId)).then(
          (data) => {
            if (!alive) return;
            setDetail(normalizeDetail(data && data.task));
          },
          (error) => {
            if (!alive) return;
            setDetailError((error && error.message) || String(error));
            setDetail(null);
          },
        );
        return () => { alive = false; };
      }, [selectedId, detailVersion, refreshKey]);

      React.useEffect(() => {
        if (!notice) return undefined;
        const timer = window.setTimeout(() => setNotice(null), 5000);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const visibleTasks = React.useMemo(() => {
        const needle = query.trim().toLowerCase();
        return tasks.filter((task) => {
          if (filter !== 'all' && task.status !== filter) return false;
          if (!needle) return true;
          const haystack = [
            task.task_id,
            task.title,
            task.phase,
            task.tags.join(' '),
            task.next_actions.map((item) => displayValue(item)).join(' '),
          ].join(' ').toLowerCase();
          return haystack.includes(needle);
        });
      }, [tasks, filter, query]);

      const activeSummary = React.useMemo(
        () => tasks.find((task) => task.task_id === activeTaskId) || null,
        [tasks, activeTaskId],
      );

      function selectTask(taskId) {
        if (!taskId) return;
        if (taskId !== selectedId) setDetail(null);
        setSelectedId(taskId);
      }

      async function changeStatus(taskId, status) {
        if (!taskId || pendingRef.current) return;
        pendingRef.current = 'status';
        setBusy('status');
        try {
          const data = await api('/status', {
            method: 'POST',
            body: { task_id: taskId, status },
          });
          const next = normalizeSummary(data && data.task);
          if (next.task_id) {
            setTasks((previous) => previous.map((item) =>
              (item.task_id === next.task_id ? next : item)));
            setDetail((previous) => (previous && previous.summary.task_id === next.task_id
              ? { ...previous, summary: next }
              : previous));
          }
          setNotice({
            kind: 'success',
            text: status === 'done'
              ? t('markedDone')
              : (status === 'blocked' ? t('markedBlocked') : t('reopened')),
          });
          setDetailVersion((value) => value + 1);
          setRefreshKey((value) => value + 1);
        } catch (error) {
          setNotice({
            kind: 'error',
            text: t('actionFailed', { message: (error && error.message) || String(error) }),
          });
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function toggleActive(taskId) {
        if (!taskId || pendingRef.current) return;
        const nextId = activeTaskId === taskId ? null : taskId;
        pendingRef.current = 'active';
        setBusy('active');
        try {
          const data = await api('/active', {
            method: 'POST',
            body: { task_id: nextId },
          });
          const nextActive = data && typeof data.activeTaskId === 'string' ? data.activeTaskId : null;
          setActiveTaskId(nextActive);
          setNotice({ kind: 'success', text: nextActive ? t('pinned') : t('unpinned') });
        } catch (error) {
          setNotice({
            kind: 'error',
            text: t('actionFailed', { message: (error && error.message) || String(error) }),
          });
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function copyTaskId(taskId) {
        if (!taskId) return;
        try {
          await navigator.clipboard.writeText(taskId);
          setNotice({ kind: 'success', text: t('copied') });
        } catch (_error) {
          setNotice({ kind: 'error', text: t('copyFailed') });
        }
      }

      const filterOptions = [
        ['all', t('filterAll'), counts.total],
        ['open', t('filterOpen'), counts.open],
        ['blocked', t('filterBlocked'), counts.blocked],
        ['done', t('filterDone'), counts.done],
      ];

      const header = h('div', { className: 'dsh-task-ledger-header' },
        h('div', { className: 'dsh-task-ledger-heading' },
          h('h1', { className: 'dsh-task-ledger-title' }, t('title')),
          h('p', { className: 'dsh-task-ledger-subtitle' }, t('subtitle'))),
        h('div', { className: 'dsh-task-ledger-headerRight' },
          activeSummary
            ? h('button', {
              type: 'button',
              className: 'dsh-task-ledger-activeChip',
              onClick: () => selectTask(activeSummary.task_id),
              title: t('activeTask') + ': ' + (activeSummary.title || activeSummary.task_id),
            },
              h(PinIcon, { size: 12 }),
              h('span', { className: 'dsh-task-ledger-activeChipText' },
                activeSummary.title || activeSummary.task_id))
            : null,
          h('button', {
            type: 'button',
            className: 'dsh-task-ledger-btn dsh-task-ledger-btnGhost',
            onClick: refresh,
            disabled: loading,
            title: t('refresh'),
            'aria-label': t('refresh'),
          }, loading ? h(Spinner) : h(RefreshIcon, { size: 15 }), h('span', null, t('refresh')))));

      const listPane = h('aside', {
        className: 'dsh-task-ledger-col dsh-task-ledger-sidebar',
        'aria-label': t('listAria'),
      },
        h('div', { className: 'dsh-task-ledger-sidebarHead' },
          h('div', { className: 'dsh-task-ledger-searchWrap' },
            h(SearchIcon, { size: 14 }),
            h('input', {
              type: 'search',
              className: 'dsh-task-ledger-input dsh-task-ledger-search',
              value: query,
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchAria'),
              onChange: (event) => setQuery(event.target.value),
            })),
          h('div', { className: 'dsh-task-ledger-filters', role: 'group' },
            filterOptions.map(([value, label, count]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'dsh-task-ledger-filter',
                'data-active': filter === value ? 'true' : 'false',
                onClick: () => setFilter(value),
              },
                h('span', null, label),
                h('span', { className: 'dsh-task-ledger-filterCount' }, String(count))))),
          h('div', { className: 'dsh-task-ledger-sidebarMeta' },
            t('tasksTotal', { count: visibleTasks.length }))),
        h('div', { className: 'dsh-task-ledger-taskList' },
          visibleTasks.length === 0
            ? h(EmptyState, {
              icon: tasks.length === 0 ? h(LedgerIcon, { size: 22 }) : h(SearchIcon, { size: 22 }),
              title: tasks.length === 0 ? t('noTasksTitle') : t('noMatchTitle'),
              hint: tasks.length === 0 ? t('noTasksHint') : t('noMatchHint'),
            })
            : visibleTasks.map((task) => h(TaskRow, {
              key: task.task_id,
              task,
              t,
              localeId,
              selectedId,
              activeTaskId,
              onSelect: selectTask,
            }))),
        root
          ? h('div', { className: 'dsh-task-ledger-sidebarFoot' },
            h('span', null, t('rootLabel') + ':'),
            h('span', { className: 'dsh-task-ledger-root', title: root }, shortPath(root)))
          : null);

      const detailTaskId = detail && detail.summary ? detail.summary.task_id : '';
      const detailReady = Boolean(detail) && detailTaskId === selectedId;

      let detailPane;
      if (!selectedId) {
        detailPane = h('section', { className: 'dsh-task-ledger-col dsh-task-ledger-detail' },
          h(EmptyState, {
            icon: h(LedgerIcon, { size: 26 }),
            title: t('selectTaskTitle'),
            hint: t('selectTaskHint'),
          }));
      } else if (detailError && !detailReady) {
        detailPane = h('section', { className: 'dsh-task-ledger-col dsh-task-ledger-detail' },
          h('div', { className: 'dsh-task-ledger-center' },
            h('span', { className: 'dsh-task-ledger-emptyIcon' }, h(AlertIcon, { size: 24 })),
            h('div', { className: 'dsh-task-ledger-errorText' },
              t('detailFailed', { message: detailError })),
            h('button', {
              type: 'button',
              className: 'dsh-task-ledger-btn dsh-task-ledger-btnPrimary',
              onClick: () => setDetailVersion((value) => value + 1),
            }, t('retry'))));
      } else if (!detailReady) {
        detailPane = h('section', { className: 'dsh-task-ledger-col dsh-task-ledger-detail' },
          h('div', { className: 'dsh-task-ledger-center' }, h(Spinner), h('span', null, t('loading'))));
      } else {
        detailPane = h(TaskDetailPane, {
          detail,
          t,
          localeId,
          busy,
          isActive: activeTaskId === detail.summary.task_id,
          onStatus: (status) => changeStatus(detail.summary.task_id, status),
          onToggleActive: toggleActive,
          onCopy: copyTaskId,
        });
      }

      let body;
      if (loading && tasks.length === 0) {
        body = h('div', { className: 'dsh-task-ledger-center' },
          h(Spinner), h('span', null, t('loading')));
      } else if (loadError) {
        body = h('div', { className: 'dsh-task-ledger-center' },
          h('span', { className: 'dsh-task-ledger-emptyIcon' }, h(AlertIcon, { size: 24 })),
          h('div', { className: 'dsh-task-ledger-errorText' },
            t('loadFailed', { message: loadError })),
          h('button', {
            type: 'button',
            className: 'dsh-task-ledger-btn dsh-task-ledger-btnPrimary',
            onClick: refresh,
          }, t('retry')));
      } else {
        body = h('div', { className: 'dsh-task-ledger-body' }, listPane, detailPane);
      }

      return h('div', { className: 'dsh-task-ledger-page' },
        header,
        h(Notice, { notice }),
        body);
    }

    // ----------------------------------------------------------------- styles

    const CSS = [
      '.dsh-task-ledger-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;padding:22px 24px 24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.dsh-task-ledger-page *{box-sizing:border-box}',
      '.dsh-task-ledger-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.dsh-task-ledger-heading{min-width:0}',
      '.dsh-task-ledger-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.dsh-task-ledger-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-headerRight{display:flex;align-items:center;gap:8px;flex:none;min-width:0}',
      '.dsh-task-ledger-activeChip{display:inline-flex;align-items:center;gap:6px;max-width:280px;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:24px;padding:0 10px;cursor:pointer}',
      '.dsh-task-ledger-activeChip:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-task-ledger-activeChipText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-task-ledger-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(240px,304px) minmax(0,1fr);gap:14px}',
      '.dsh-task-ledger-col{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dsh-task-ledger-sidebar{overflow:hidden}',
      '.dsh-task-ledger-sidebarHead{display:flex;flex-direction:column;gap:8px;padding:12px 12px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.dsh-task-ledger-searchWrap{position:relative;display:flex;align-items:center;gap:6px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-searchWrap:focus-within{border-color:var(--dsw-alias-border-l2)}',
      '.dsh-task-ledger-input{width:100%;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:6px 8px;outline:none}',
      '.dsh-task-ledger-input:focus{border-color:var(--dsw-alias-border-l2)}',
      '.dsh-task-ledger-search{border:0;background:transparent;padding:6px 2px}',
      '.dsh-task-ledger-search:focus{border:0}',
      '.dsh-task-ledger-filters{display:flex;gap:4px;flex-wrap:wrap}',
      '.dsh-task-ledger-filter{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:20px;border-radius:6px;cursor:pointer;padding:0 6px;white-space:nowrap}',
      '.dsh-task-ledger-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-task-ledger-filter[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dsh-task-ledger-filterCount{font-size:10px;opacity:.8;font-variant-numeric:tabular-nums}',
      '.dsh-task-ledger-sidebarMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-taskList{flex:1;min-height:0;overflow:auto;padding:6px}',
      '.dsh-task-ledger-task{display:block;width:100%;text-align:left;border:0.5px solid transparent;border-radius:9px;background:transparent;color:inherit;font:inherit;padding:8px 9px;cursor:pointer;margin-bottom:2px}',
      '.dsh-task-ledger-task:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-task-ledger-task[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dsh-task-ledger-taskTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-task-ledger-statusDot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-statusDot[data-status="open"]{background:var(--dsw-alias-brand-primary)}',
      '.dsh-task-ledger-statusDot[data-status="blocked"]{background:var(--dsw-alias-state-error-primary)}',
      '.dsh-task-ledger-statusDot[data-status="done"]{background:var(--dsw-alias-state-success-primary)}',
      '.dsh-task-ledger-taskTitle{flex:1;min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-task-ledger-taskPin{display:inline-flex;flex:none;color:var(--dsw-alias-brand-primary)}',
      '.dsh-task-ledger-taskSub{display:flex;align-items:center;gap:8px;margin-top:2px;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-taskId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsh-task-ledger-taskPhase{flex:none;max-width:110px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-task-ledger-taskBlocked{margin-top:4px;font-size:11px;color:var(--dsw-alias-state-error-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dsh-task-ledger-taskNext{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-task-ledger-taskMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-metItem{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}',
      '.dsh-task-ledger-taskTags{display:inline-flex;gap:4px;flex-wrap:wrap}',
      '.dsh-task-ledger-tag{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-task-ledger-sidebarFoot{flex:none;display:flex;align-items:center;gap:6px;min-width:0;padding:8px 12px;border-top:0.5px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-root{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsh-task-ledger-detail{overflow-y:auto;overflow-x:hidden}',
      '.dsh-task-ledger-detailHead{display:flex;flex-direction:column;gap:6px;padding:14px 16px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.dsh-task-ledger-detailTitleLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.dsh-task-ledger-taskHeading{margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere}',
      '.dsh-task-ledger-chip{display:inline-flex;align-items:center;gap:4px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10.5px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-task-ledger-chip[data-status="open"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-task-ledger-chip[data-status="blocked"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-task-ledger-chip[data-status="done"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-task-ledger-chipActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-task-ledger-detailMeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}',
      '.dsh-task-ledger-readonly{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-detailActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}',
      '.dsh-task-ledger-btn{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:22px;padding:0 10px;cursor:pointer;white-space:nowrap}',
      '.dsh-task-ledger-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-task-ledger-btn:disabled{opacity:.55;cursor:default}',
      '.dsh-task-ledger-btnPrimary{border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}',
      '.dsh-task-ledger-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}',
      '.dsh-task-ledger-btnGhost{border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 8px}',
      '.dsh-task-ledger-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-task-ledger-notice{flex:none;padding:7px 10px;border-radius:7px;font-size:11.5px;border:0.5px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}',
      '.dsh-task-ledger-notice[data-kind="success"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.dsh-task-ledger-notice[data-kind="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dsh-task-ledger-sections{display:flex;flex-direction:column;gap:10px;padding:10px 16px 16px}',
      '.dsh-task-ledger-card{flex:none;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);overflow:hidden}',
      '.dsh-task-ledger-cardHead{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-task-ledger-cardIcon{display:inline-flex;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-cardTitle{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsh-task-ledger-cardCount{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dsh-task-ledger-cardBody{display:flex;flex-direction:column;gap:10px;padding:10px 12px 12px}',
      '.dsh-task-ledger-field{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dsh-task-ledger-fieldLabel{font-size:10.5px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-prose{margin:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dsh-task-ledger-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dsh-task-ledger-inlineFields{display:flex;flex-wrap:wrap;gap:12px 22px}',
      '.dsh-task-ledger-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dsh-task-ledger-listItem{line-height:1.55}',
      '.dsh-task-ledger-checkList{list-style:none;padding-left:0}',
      '.dsh-task-ledger-checkList .dsh-task-ledger-listItem{display:flex;align-items:flex-start;gap:7px}',
      '.dsh-task-ledger-check{flex:none;width:13px;height:13px;margin:3px 0 0;accent-color:var(--dsw-alias-brand-primary)}',
      '.dsh-task-ledger-progressGrid{display:flex;flex-wrap:wrap;gap:12px 22px}',
      '.dsh-task-ledger-callout{padding:8px 10px;border-radius:8px;border:0.5px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dsh-task-ledger-claim,.dsh-task-ledger-decision,.dsh-task-ledger-run,.dsh-task-ledger-evidence{display:flex;flex-direction:column;gap:4px;min-width:0;border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:9px}',
      '.dsh-task-ledger-claim:first-child,.dsh-task-ledger-decision:first-child,.dsh-task-ledger-run:first-child,.dsh-task-ledger-evidence:first-child{border-top:0;padding-top:0}',
      '.dsh-task-ledger-claimHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.dsh-task-ledger-badge{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-task-ledger-badge[data-claim="verified"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-task-ledger-badge[data-claim="refuted"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-task-ledger-claimId{color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-claimText{margin:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dsh-task-ledger-claimMeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-decisionRationale{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dsh-task-ledger-runHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dsh-task-ledger-evidenceHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-task-ledger-evidenceName{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
      '.dsh-task-ledger-link{font-size:11px;color:var(--dsw-alias-brand-primary);overflow-wrap:anywhere;text-decoration:none}',
      '.dsh-task-ledger-link:hover{text-decoration:underline}',
      '.dsh-task-ledger-emptyInline{padding:2px 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:180px;padding:24px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-errorText{max-width:520px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dsh-task-ledger-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:160px;padding:32px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.dsh-task-ledger-emptyIcon{display:inline-flex;opacity:.7}',
      '.dsh-task-ledger-emptyTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsh-task-ledger-emptyHint{max-width:360px;font-size:11.5px}',
      '.dsh-task-ledger-spinner{display:inline-block;flex:none;width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:dsh-task-ledger-spin .8s linear infinite}',
      '@keyframes dsh-task-ledger-spin{to{transform:rotate(360deg)}}',
      '.dsh-task-ledger-page button:focus-visible,.dsh-task-ledger-page input:focus-visible,.dsh-task-ledger-page a:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '@media (max-width:820px){.dsh-task-ledger-body{grid-template-columns:minmax(0,1fr)}.dsh-task-ledger-sidebar{max-height:280px}}',
    ].join('\n');

    function insertStyles() {
      const tagId = 'dsh-task-ledger/style';
      if (typeof document === 'undefined') return () => {};
      // Replace any stale tag from a previous instance so this run owns the
      // exact tag it removes on unload.
      const previous = document.querySelector('style[data-plugin-css="' + tagId + '"]');
      if (previous && typeof previous.remove === 'function') previous.remove();
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-task-ledger';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    // ------------------------------------------------------------------ mount

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
        order: PANEL_ORDER,
        // The sidebar calls this thunk on every locale publish; it always resolves
        // through the registered dictionary, with the panel id as the last resort
        // after disposal.
        label: () => (runtime ? runtime.t('panelTitle') : PANEL_KEY),
      }, PanelIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, TaskLedgerPage));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
