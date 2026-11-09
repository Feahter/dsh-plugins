window.__ModuleLoader__.load({
  id: 'skills-360',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'skills-360';
    const PANEL_KEY = 'skills-360';
    const API_PREFIX = '/api/skills-360';

    // ------------------------------------------------------------------ locale

    const zh = {
      panelTitle: '技能体检 360',
      title: '技能体检 360',
      subtitle: '按需加载 / 渐进披露 / 可执行性 / 边界 / 卫生 / 持续进化 六维评分',
      refresh: '刷新',
      retry: '重试',
      loading: '正在加载…',
      loadFailed: '加载失败：{message}',
      opFailed: '操作失败：{message}',
      detailLoadFailed: '详情加载失败：{message}',
      export: '导出报告',
      applyAll: '全部安全优化',
      applyAllSkill: '本技能全部安全优化',
      undo: '撤销上次',
      apply: '应用',
      // stats
      statSkills: '技能数',
      statAvg: '平均分',
      statGrades: 'A/B/C/D 分布',
      statCatalogTokens: '每次会话固定成本',
      statFullTokens: '全量加载成本',
      statZeroUse: '零按需加载',
      tokensUnit: 'tokens',
      // list
      searchPlaceholder: '搜索名称 / 描述…',
      filterGrade: '等级',
      filterVerdict: '结论',
      filterSource: '来源',
      filterAll: '全部',
      onlyProblems: '只看有 major+ 问题',
      count: '{count} 个技能',
      noMatch: '没有匹配的技能',
      noMatchHint: '调整搜索或筛选条件，或点击刷新。',
      // verdict codes (filters + chips fallback)
      verdictKeep: '保留',
      verdictWatch: '观察',
      verdictMerge: '合并',
      verdictArchive: '归档',
      // detail
      noSelection: '选择一个技能',
      noSelectionHint: '从左侧列表选择一个技能，查看它的六维体检详情。',
      scoreLabel: '总分',
      gradeLabel: '等级',
      confidenceLabel: '置信度',
      deltaLabel: '较上次',
      verdictLabel: '结论',
      dimensionsTitle: '六维评分',
      metricsTitle: '关键指标',
      findingsTitle: '问题',
      suggestionsTitle: '建议',
      overlapsTitle: '重叠技能',
      sourceTitle: '源码',
      viewSource: '查看源码（前 200 行）',
      pathLabel: '路径',
      coverageLabel: '覆盖度',
      coverageFull: '完整',
      coveragePartial: '部分',
      // metrics
      estTokens: '估算 tokens',
      bodyLines: '正文行数',
      descriptionChars: '描述字符',
      catalogTruncated: '目录截断',
      referenceCount: '引用文件',
      referencedFiles: '已链接引用',
      orphanReferences: '孤儿引用',
      usageCount: '按需加载次数',
      perWeek: '每周',
      overlapMax: '最大重叠',
      yes: '是',
      no: '否',
      // severity
      sevCritical: '严重',
      sevMajor: '主要',
      sevMinor: '次要',
      sevInfo: '提示',
      // suggestion kinds
      kindAuto: '一键优化',
      kindDraft: '生成草稿',
      kindManual: '手动处理',
      draftNote: '将生成新文字（改写内容），默认不进入「全部安全优化」。',
      // findings / suggestions
      evidenceLabel: '证据',
      suggestionLabel: '建议',
      whyLabel: '原因',
      riskLabel: '风险',
      previewLabel: '预览',
      beforeLabel: '之前',
      afterLabel: '之后',
      noFindings: '没有问题，很好。',
      noSuggestions: '没有建议。',
      noOverlaps: '没有重叠技能。',
      jumpTo: '跳转',
      // states
      emptyTitle: '还没有技能',
      emptyHint: '请先在「设置 → 技能」添加技能，然后回来刷新。',
      // toast / confirm
      applyDone: '已应用，备份 {backupId}，分数 {before} → {after}',
      applyAllDone: '已应用 {count} 项安全优化，备份 {backupId}',
      applyAllNone: '没有可应用的安全优化',
      undoDone: '已撤销备份 {backupId}',
      exportDone: '报告已导出到 {path}',
      confirmApplyAll: '确认对全部技能应用所有安全优化（auto 动作）？此操作会写盘并生成备份，可撤销。',
      confirmApplyAllSkill: '确认对该技能应用所有安全优化（auto 动作）？此操作会写盘并生成备份，可撤销。',
      confirmUndo: '确认撤销上次的修改？撤销会用备份覆盖 apply 之后对该技能文件的改动。',
      usageLine: '加载 {count} 次 · 每周 {perWeek}',
      // evolution
      evolutionTitle: '持续进化',
      evolutionNotScored: '窗口内没有按需加载样本，本维度不评分；其余五维按 90 分折算为 100。',
      notScored: '本维度不评分',
      evolveEntry: '经验入口',
      evolvePendingBadge: '待进化',
      evolveLessons: '经验数',
      evolveLatest: '最近一条',
      evolveNever: '尚未沉淀',
      evolveLinkedYes: '已接进入口',
      evolveLinkedNo: '未接进入口',
      evolveSignals: '调用后信号',
      evolveLastSignal: '最近信号',
      signalLoads: '加载',
      signalCorrections: '纠错',
      signalErrors: '报错',
      signalReloads: '重复加载',
      signalFailures: '失败',
      signalAsks: '追问',
      evolvePendingTitle: '待闭环提案',
      evolveNoPending: '没有待闭环的信号，经验已跟上最近调用。',
      evolveEmptyLessons: '还没有沉淀任何经验；下次加载读不到这条路径的经验。',
      evolveEmptySignals: '窗口内没有调用后信号。',
      evolveNoTrigger: '（未记录触发摘要）',
      evolveButton: '沉淀经验',
      evolveEditorTitle: '沉淀经验',
      evolveTrigger: '触发',
      evolveRule: '做法',
      evolveEvidence: '证据',
      evolveRuleHint: '必填：一句话写清下次遇到这个触发该怎么做。',
      evolveRuleRequired: '做法不能为空：先写一条可执行的规则。',
      evolveWrite: '写入经验',
      evolveCancel: '取消',
      evolveNote: '补一条“触发→做法”，写入 references/lessons.md 并接进入口。',
      evolveDone: '经验已写入，备份 {backupId}，分数 {before} → {after}',
      confirmEvolve: '确认把这条经验写入 {name} 的 references/lessons.md？会写盘并生成备份，可撤销。',
      labelSep: '：',
      undoMany: '{count} 个备份',
    };

    const en = {
      panelTitle: 'Skills 360',
      title: 'Skills 360',
      subtitle: 'Score skills across on-demand loading, progressive disclosure, actionability, boundary, hygiene, and continuous evolution',
      refresh: 'Refresh',
      retry: 'Retry',
      loading: 'Loading…',
      loadFailed: 'Failed to load: {message}',
      opFailed: 'Action failed: {message}',
      detailLoadFailed: 'Failed to load detail: {message}',
      export: 'Export report',
      applyAll: 'Apply all safe',
      applyAllSkill: 'Apply all safe (this skill)',
      undo: 'Undo last',
      apply: 'Apply',
      statSkills: 'Skills',
      statAvg: 'Avg score',
      statGrades: 'A/B/C/D',
      statCatalogTokens: 'Catalog cost / session',
      statFullTokens: 'Full-load cost',
      statZeroUse: 'Zero on-demand loads',
      tokensUnit: 'tokens',
      searchPlaceholder: 'Search name / description…',
      filterGrade: 'Grade',
      filterVerdict: 'Verdict',
      filterSource: 'Source',
      filterAll: 'All',
      onlyProblems: 'Only major+ issues',
      count: '{count} skills',
      noMatch: 'No matching skills',
      noMatchHint: 'Change the search or filters, or refresh.',
      verdictKeep: 'Keep',
      verdictWatch: 'Watch',
      verdictMerge: 'Merge',
      verdictArchive: 'Archive',
      noSelection: 'Select a skill',
      noSelectionHint: 'Pick a skill on the left to see its six-dimension report.',
      scoreLabel: 'Score',
      gradeLabel: 'Grade',
      confidenceLabel: 'Confidence',
      deltaLabel: 'Δ vs last',
      verdictLabel: 'Verdict',
      dimensionsTitle: 'Six dimensions',
      metricsTitle: 'Metrics',
      findingsTitle: 'Findings',
      suggestionsTitle: 'Suggestions',
      overlapsTitle: 'Overlaps',
      sourceTitle: 'Source',
      viewSource: 'View source (first 200 lines)',
      pathLabel: 'Path',
      coverageLabel: 'Coverage',
      coverageFull: 'Full',
      coveragePartial: 'Partial',
      estTokens: 'Est. tokens',
      bodyLines: 'Body lines',
      descriptionChars: 'Desc chars',
      catalogTruncated: 'Catalog truncated',
      referenceCount: 'References',
      referencedFiles: 'Linked refs',
      orphanReferences: 'Orphan refs',
      usageCount: 'Loads',
      perWeek: 'Per week',
      overlapMax: 'Max overlap',
      yes: 'Yes',
      no: 'No',
      sevCritical: 'Critical',
      sevMajor: 'Major',
      sevMinor: 'Minor',
      sevInfo: 'Info',
      kindAuto: 'Optimize',
      kindDraft: 'Generate draft',
      kindManual: 'Manual',
      draftNote: 'Generates new text (rewrites content); excluded from "Apply all safe".',
      evidenceLabel: 'Evidence',
      suggestionLabel: 'Suggestion',
      whyLabel: 'Why',
      riskLabel: 'Risk',
      previewLabel: 'Preview',
      beforeLabel: 'Before',
      afterLabel: 'After',
      noFindings: 'No findings. Good.',
      noSuggestions: 'No suggestions.',
      noOverlaps: 'No overlapping skills.',
      jumpTo: 'Open',
      emptyTitle: 'No skills yet',
      emptyHint: 'Add skills in Settings → Skills, then come back and refresh.',
      applyDone: 'Applied, backup {backupId}, score {before} → {after}',
      applyAllDone: 'Applied {count} safe fixes, backup {backupId}',
      applyAllNone: 'No safe fixes to apply',
      undoDone: 'Undid backup {backupId}',
      exportDone: 'Report exported to {path}',
      confirmApplyAll: 'Apply all safe (auto) fixes to every skill? This writes to disk with a backup; it can be undone.',
      confirmApplyAllSkill: 'Apply all safe (auto) fixes to this skill? This writes to disk with a backup; it can be undone.',
      confirmUndo: 'Undo the last change? This restores the backup and overwrites edits made to the skill after the fix.',
      usageLine: '{count} loads · {perWeek}/wk',
      // evolution
      evolutionTitle: 'Continuous evolution',
      evolutionNotScored: 'No on-demand loads this window, so this dimension is not scored; the other five are rescaled to 100.',
      notScored: 'Not scored this window',
      evolveEntry: 'Lesson entry',
      evolvePendingBadge: 'Needs lesson',
      evolveLessons: 'Lessons',
      evolveLatest: 'Latest',
      evolveNever: 'None yet',
      evolveLinkedYes: 'Linked',
      evolveLinkedNo: 'Not linked',
      evolveSignals: 'Post-load signals',
      evolveLastSignal: 'Last signal',
      signalLoads: 'Loads',
      signalCorrections: 'Corrections',
      signalErrors: 'Errors',
      signalReloads: 'Reloads',
      signalFailures: 'Failures',
      signalAsks: 'Asks',
      evolvePendingTitle: 'Open proposals',
      evolveNoPending: 'Nothing pending; lessons cover the latest signals.',
      evolveEmptyLessons: 'No lessons yet; the next load has nothing from past runs to read.',
      evolveEmptySignals: 'No post-load signals this window.',
      evolveNoTrigger: '(no trigger summary recorded)',
      evolveButton: 'Add lesson',
      evolveEditorTitle: 'Add lesson',
      evolveTrigger: 'Trigger',
      evolveRule: 'Rule',
      evolveEvidence: 'Evidence',
      evolveRuleHint: 'Required: one sentence on what to do when this trigger appears.',
      evolveRuleRequired: 'Rule is required — write one actionable sentence first.',
      evolveWrite: 'Write lesson',
      evolveCancel: 'Cancel',
      evolveNote: 'Add a trigger → rule pair, written to references/lessons.md and linked into the body.',
      evolveDone: 'Lesson written, backup {backupId}, score {before} → {after}',
      confirmEvolve: 'Write this lesson into {name}\'s references/lessons.md? This writes to disk with a backup and can be undone.',
      labelSep: ': ',
      undoMany: '{count} backups',
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
        if (!body) throw new Error('Empty response from the skills-360 route.');
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

    function errMessage(error) {
      return (error && error.message) || String(error);
    }

    function clip(text, n) {
      const s = String(text == null ? '' : text);
      return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function fmt1(value) {
      if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
      return Number(value).toFixed(1);
    }

    function formatTokens(value) {
      if (value == null || !Number.isFinite(Number(value))) return '—';
      const n = Number(value);
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(Math.round(n));
    }

    const SEV_RANK = { critical: 0, major: 1, minor: 2, info: 3 };

    function sevKey(severity) {
      return { critical: 'Critical', major: 'Major', minor: 'Minor', info: 'Info' }[severity] || 'Info';
    }

    function topSeverity(skill) {
      const findings = skill.findings || [];
      if (findings.some((f) => f.severity === 'critical')) return 'critical';
      if (findings.some((f) => f.severity === 'major')) return 'major';
      if (findings.some((f) => f.severity === 'minor')) return 'minor';
      if (findings.some((f) => f.severity === 'info')) return 'info';
      return null;
    }

    function hasMajorPlus(skill) {
      return (skill.findings || []).some(
        (f) => f.severity === 'critical' || f.severity === 'major',
      );
    }

    function verdictLabelOf(code) {
      return { keep: 'verdictKeep', watch: 'verdictWatch', merge: 'verdictMerge', archive: 'verdictArchive' }[code] || null;
    }

    // Locale-aware "label: value" (the separator is a locale key, not a literal).
    function labeled(t, key, value) {
      return t(key) + t('labelSep') + value;
    }

    function formatDay(value) {
      if (value == null || value === '') return '—';
      const date = new Date(Number(value));
      if (!Number.isFinite(date.getTime())) return '—';
      const pad = (n) => (n < 10 ? '0' + n : String(n));
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }

    function numberOr(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    // Accept both the full report.evolution shape (SPEC §4) and the flattened
    // scan summary (SPEC §5.4), so the list badge and the detail block agree.
    function normalizeEvolution(input) {
      const raw = input && typeof input === 'object' ? input : {};
      const lessonsRaw = raw.lessons;
      const lessonsObj = lessonsRaw && typeof lessonsRaw === 'object' ? lessonsRaw : {};
      const lessons = {
        count: numberOr(lessonsObj.count != null
          ? lessonsObj.count
          : (typeof lessonsRaw === 'number' ? lessonsRaw : 0), 0),
        latestAt: lessonsObj.latestAt != null
          ? lessonsObj.latestAt
          : (raw.lastLessonAt != null ? raw.lastLessonAt : null),
        linked: lessonsObj.linked != null ? !!lessonsObj.linked : !!raw.linked,
        entries: Array.isArray(lessonsObj.entries) ? lessonsObj.entries : [],
      };
      const signalsRaw = raw.signals && typeof raw.signals === 'object' ? raw.signals : {};
      const signals = {
        loads: numberOr(signalsRaw.loads != null ? signalsRaw.loads : raw.loads, 0),
        sessions: numberOr(signalsRaw.sessions, 0),
        reloads: numberOr(signalsRaw.reloads, 0),
        postLoadErrors: numberOr(signalsRaw.postLoadErrors, 0),
        corrections: numberOr(signalsRaw.corrections, 0),
        asks: numberOr(signalsRaw.asks, 0),
        turnFailures: numberOr(signalsRaw.turnFailures, 0),
        lastSignalAt: signalsRaw.lastSignalAt != null ? signalsRaw.lastSignalAt : null,
        samples: Array.isArray(signalsRaw.samples) ? signalsRaw.samples : [],
      };
      const pendingRaw = raw.pending && typeof raw.pending === 'object' ? raw.pending : null;
      const pending = {
        score: numberOr(pendingRaw ? pendingRaw.score : raw.pendingScore, 0),
        hasUnclosed: pendingRaw && typeof pendingRaw.hasUnclosed === 'boolean'
          ? pendingRaw.hasUnclosed
          : !!raw.hasUnclosed,
        lastSignalAt: pendingRaw && pendingRaw.lastSignalAt != null
          ? pendingRaw.lastSignalAt
          : (raw.lastSignalAt != null ? raw.lastSignalAt : signals.lastSignalAt),
        draft: (pendingRaw && pendingRaw.draft) || raw.draft || null,
      };
      return {
        applicable: raw.applicable !== false,
        loads: signals.loads,
        lessons,
        signals,
        pending,
        proposals: Array.isArray(raw.proposals) ? raw.proposals : [],
      };
    }

    function evolutionPending(skill) {
      const ev = skill && skill.evolution;
      if (!ev) return false;
      const pendingRaw = ev.pending && typeof ev.pending === 'object' ? ev.pending : null;
      if (pendingRaw && typeof pendingRaw.hasUnclosed === 'boolean') return pendingRaw.hasUnclosed;
      if (typeof ev.hasUnclosed === 'boolean') return ev.hasUnclosed;
      return Number(ev.pendingScore) > 0;
    }

    function isLessonSuggestion(suggestion) {
      if (!suggestion) return false;
      if (suggestion.id === 'fix.add-lesson') return true;
      return !!(suggestion.action && suggestion.action.type === 'add-lesson');
    }

    function lessonOf(suggestion) {
      const params = suggestion && suggestion.action && suggestion.action.params;
      return (params && params.lesson) || {};
    }

    function suggestionActionKey(suggestion) {
      if (isLessonSuggestion(suggestion)) return 'evolveButton';
      return suggestion.kind === 'auto' ? 'kindAuto' : 'kindDraft';
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

    const UndoIcon = (props) => icon([
      h('path', { key: 'a', d: 'M9 14 4 9l5-5' }),
      h('path', { key: 'b', d: 'M4 9h9a7 7 0 0 1 0 14h-3' }),
    ], props && props.size);

    const ExportIcon = (props) => icon([
      h('path', { key: 'a', d: 'M12 3v12' }),
      h('path', { key: 'b', d: 'm7 10 5 5 5-5' }),
      h('path', { key: 'c', d: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' }),
    ], props && props.size);

    const ChartIcon = (props) => icon([
      h('path', { key: 'a', d: 'M4 20V10' }),
      h('path', { key: 'b', d: 'M10 20V4' }),
      h('path', { key: 'c', d: 'M16 20v-7' }),
      h('path', { key: 'd', d: 'M22 20H2' }),
    ], props && props.size);

    function Spinner() {
      return h('span', { className: 's360-spinner', 'aria-hidden': true });
    }

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
        h('circle', { key: 'a', cx: 12, cy: 13, r: 8.5 }),
        h('path', { key: 'b', d: 'M12 13l4-6.5' }),
        h('circle', { key: 'c', cx: 12, cy: 13, r: 1.4, fill: 'currentColor', stroke: 'none' }));
    }

    // -------------------------------------------------------------- components

    function StatCard(props) {
      return h('div', { className: 's360-stat' },
        h('div', { className: 's360-statValue' }, props.value),
        h('div', { className: 's360-statLabel' }, props.label));
    }

    function Chip(props) {
      return h('span', { className: 's360-chip ' + (props.tone ? 's360-chip-' + props.tone : ''), title: props.title },
        props.children);
    }

    function SkillRow(props) {
      const skill = props.skill;
      const t = props.t;
      const sev = topSeverity(skill);
      const usage = skill.usage || {};
      const perWeek = usage.perWeek != null ? fmt1(usage.perWeek) : null;
      const verdictLabel = verdictLabelOf(skill.verdict && skill.verdict.code);
      return h('button', {
        type: 'button',
        className: 's360-row',
        'data-selected': skill.name === props.selected ? 'true' : 'false',
        onClick: () => props.onSelect(skill.name),
        title: skill.name,
      },
        h('span', { className: 's360-grade s360-grade' + skill.score.grade }, skill.score.grade),
        h('div', { className: 's360-rowMain' },
          h('div', { className: 's360-rowTitleLine' },
            h('span', { className: 's360-rowName' }, skill.name),
            h('span', { className: 's360-rowScore' }, fmt1(skill.score.total))),
          h('div', { className: 's360-rowDesc' }, clip(skill.description || '', 84)),
          h('div', { className: 's360-rowMeta' },
            skill.source ? h(Chip, { title: skill.source }, skill.source) : null,
            verdictLabel ? h(Chip, { tone: skill.verdict.code }, t(verdictLabel)) : null,
            evolutionPending(skill)
              ? h(Chip, { tone: 'evolve', title: t('evolutionTitle') }, t('evolvePendingBadge'))
              : null,
            h('span', { className: 's360-metaText' }, t('usageLine', { count: usage.count ?? 0, perWeek: perWeek == null ? '—' : perWeek })),
            sev ? h(Chip, { tone: 'sev-' + sev }, t('sev' + sevKey(sev))) : null)));
    }

    function DimensionBlock(props) {
      const dim = props.dim;
      const t = props.t;
      const max = dim.max || 1;
      const notScored = dim.applicable === false;
      const pct = notScored ? 0 : Math.max(0, Math.min(100, Math.round(((dim.score || 0) / max) * 100)));
      const items = dim.items || [];
      return h('details', {
        className: 's360-dim',
        'data-applicable': notScored ? 'false' : 'true',
      },
        h('summary', { className: 's360-dimSummary' },
          h('div', { className: 's360-dimTop' },
            h('span', { className: 's360-dimLabel' },
              dim.label,
              notScored ? h(Chip, { tone: 'na' }, t('notScored')) : null),
            h('span', { className: 's360-dimScore' },
              notScored ? '—' : fmt1(dim.score) + ' / ' + fmt1(dim.max))),
          h('div', { className: 's360-bar' },
            h('div', { className: 's360-barFill', style: { width: pct + '%' } })),
          dim.summary ? h('div', { className: 's360-dimSummaryText' }, dim.summary) : null),
        items.length
          ? h('ul', { className: 's360-dimItems' },
            items.map((item) => h('li', { className: 's360-dimItem', key: item.id },
              h('div', { className: 's360-dimItemTop' },
                h('span', { className: 's360-dimItemLabel' }, item.label),
                h('span', { className: 's360-dimItemScore' },
                  notScored || item.applicable === false
                    ? '—'
                    : fmt1(item.score) + ' / ' + fmt1(item.max))),
              item.detail ? h('div', { className: 's360-dimItemDetail' }, item.detail) : null)))
          : null);
    }

    function MetricsGrid(props) {
      const m = props.metrics || {};
      const usage = props.usage || {};
      const t = props.t;
      const rows = [
        [t('estTokens'), formatTokens(m.estTokens)],
        [t('bodyLines'), m.bodyLines == null ? '—' : String(m.bodyLines)],
        [t('descriptionChars'), m.descriptionChars == null ? '—' : String(m.descriptionChars)],
        [t('catalogTruncated'), m.catalogTruncated ? t('yes') : t('no')],
        [t('referenceCount'), m.referenceCount == null ? '—' : String(m.referenceCount) + ' / ' + String(m.referencedFiles == null ? 0 : m.referencedFiles) + ' ' + t('referencedFiles')],
        [t('orphanReferences'), m.orphanReferences == null ? '—' : String(m.orphanReferences)],
        [t('usageCount'), usage.count == null ? '—' : String(usage.count)],
        [t('perWeek'), usage.perWeek == null ? '—' : fmt1(usage.perWeek)],
        [t('overlapMax'), m.overlapMax == null ? '—' : (Math.round(m.overlapMax * 100) + '%')],
      ];
      return h('div', { className: 's360-metrics' },
        rows.map((row) => h('div', { className: 's360-metric', key: row[0] },
          h('div', { className: 's360-metricLabel' }, row[0]),
          h('div', { className: 's360-metricValue' }, row[1]))));
    }

    function PreviewBlock(props) {
      const preview = props.preview;
      const t = props.t;
      if (!preview || (preview.before == null && preview.after == null)) return null;
      return h('div', { className: 's360-preview' },
        h('div', { className: 's360-previewTitle' }, t('previewLabel')),
        preview.before != null
          ? h('div', { className: 's360-previewRow' },
            h('span', { className: 's360-previewTag' }, t('beforeLabel')),
            h('code', { className: 's360-previewText' }, clip(preview.before, 240)))
          : null,
        preview.after != null
          ? h('div', { className: 's360-previewRow' },
            h('span', { className: 's360-previewTag s360-previewTagAfter' }, t('afterLabel')),
            h('code', { className: 's360-previewText' }, clip(preview.after, 240)))
          : null);
    }

    function FindingsList(props) {
      const findings = props.findings || [];
      const t = props.t;
      const byId = {};
      (props.suggestions || []).forEach((s) => { byId[s.id] = s; });
      if (findings.length === 0) {
        return h('div', { className: 's360-muted' }, t('noFindings'));
      }
      const sorted = findings.slice().sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
      return h('ul', { className: 's360-findings' },
        sorted.map((f) => {
          const linked = (f.actionIds || [])
            .map((id) => byId[id])
            .filter(Boolean)
            .filter((s) => s.kind === 'auto' || s.kind === 'draft');
          return h('li', { className: 's360-finding', key: f.id || f.title, 'data-sev': f.severity },
            h('div', { className: 's360-findingHead' },
              h('span', { className: 's360-sev s360-sev-' + f.severity }, t('sev' + sevKey(f.severity))),
              h('span', { className: 's360-findingTitle' }, f.title)),
            f.detail ? h('div', { className: 's360-findingDetail' }, f.detail) : null,
            f.evidence
              ? h('div', { className: 's360-findingEvidence' },
                h('code', { className: 's360-code' }, (f.evidence.file || '') + (f.evidence.line != null ? ':' + f.evidence.line : '')),
                f.evidence.excerpt ? h('div', { className: 's360-evExcerpt' }, clip(f.evidence.excerpt, 300)) : null)
              : null,
            f.suggestion ? h('div', { className: 's360-findingSug' }, labeled(t, 'suggestionLabel', f.suggestion)) : null,
            linked.length
              ? h('div', { className: 's360-findingActions' },
                linked.map((s) => h('button', {
                  key: s.id,
                  type: 'button',
                  className: 's360-btn s360-btnPrimary s360-btnSm',
                  disabled: props.busy,
                  onClick: () => props.onApply(s),
                }, t(suggestionActionKey(s)))))
              : null);
        }));
    }

    function SuggestionsList(props) {
      const suggestions = props.suggestions || [];
      const t = props.t;
      if (suggestions.length === 0) {
        return h('div', { className: 's360-muted' }, t('noSuggestions'));
      }
      return h('ul', { className: 's360-suggestions' },
        suggestions.map((s) => {
          const lesson = isLessonSuggestion(s);
          const draft = lessonOf(s);
          const kindChip = lesson
            ? h(Chip, { tone: 'evolve' }, t('evolutionTitle'))
            : s.kind === 'auto'
              ? h(Chip, { tone: 'auto' }, t('kindAuto'))
              : s.kind === 'draft'
                ? h(Chip, { tone: 'draft' }, t('kindDraft'))
                : h(Chip, { tone: 'manual' }, t('kindManual'));
          const body = [
            s.why ? h('div', { className: 's360-sugText', key: 'why' }, labeled(t, 'whyLabel', s.why)) : null,
            s.risk ? h('div', { className: 's360-sugText', key: 'risk' }, labeled(t, 'riskLabel', s.risk)) : null,
            lesson && draft.trigger
              ? h('div', { className: 's360-sugText', key: 'trigger' },
                labeled(t, 'evolveTrigger', clip(draft.trigger, 160)))
              : null,
            h(PreviewBlock, { preview: s.preview, t, key: 'preview' }),
          ];
          if (s.kind === 'manual') {
            return h('li', { className: 's360-sug', key: s.id, 'data-kind': 'manual' },
              h('div', { className: 's360-sugHead' }, kindChip, h('span', { className: 's360-sugTitle' }, s.title)),
              body);
          }
          return h('li', { className: 's360-sug', key: s.id, 'data-kind': s.kind },
            h('div', { className: 's360-sugHead' }, kindChip, h('span', { className: 's360-sugTitle' }, s.title)),
            lesson
              ? h('div', { className: 's360-draftNote' }, t('evolveNote'))
              : (s.kind === 'draft' ? h('div', { className: 's360-draftNote' }, t('draftNote')) : null),
            body,
            h('div', { className: 's360-sugActions' },
              h('button', {
                type: 'button',
                className: 's360-btn s360-btnPrimary',
                disabled: props.busy,
                onClick: () => props.onApply(s),
              }, t(suggestionActionKey(s)))));
        }));
    }

    function OverlapsList(props) {
      const overlaps = props.overlaps || [];
      const t = props.t;
      if (overlaps.length === 0) {
        return h('div', { className: 's360-muted' }, t('noOverlaps'));
      }
      return h('ul', { className: 's360-overlaps' },
        overlaps.map((o) => h('li', { className: 's360-overlap', key: o.name },
          h('button', {
            type: 'button',
            className: 's360-overlapBtn',
            onClick: () => props.onJump(o.name),
          },
            h('span', { className: 's360-overlapName' }, o.name),
            h('span', { className: 's360-overlapScore' }, Math.round((o.score || 0) * 100) + '%'),
            o.sharedTriggers && o.sharedTriggers.length
              ? h('span', { className: 's360-overlapTriggers' }, o.sharedTriggers.join(', '))
              : null))));
    }

    function signalKindKey(kind) {
      return {
        correction: 'signalCorrections',
        error: 'signalErrors',
        reload: 'signalReloads',
        ask: 'signalAsks',
        'turn-failure': 'signalFailures',
      }[kind] || 'signalLoads';
    }

    function EvolveEditor(props) {
      const editor = props.editor;
      const t = props.t;
      if (!editor) return null;
      const rule = String(editor.rule || '');
      return h('div', { className: 's360-editor', 'data-open': 'true' },
        h('div', { className: 's360-editorTitle' }, t('evolveEditorTitle')),
        h('label', { className: 's360-field' },
          h('span', { className: 's360-fieldLabel' }, t('evolveTrigger')),
          h('input', {
            className: 's360-input',
            type: 'text',
            value: String(editor.trigger || ''),
            onChange: (event) => props.onChange('trigger', event.target.value),
          })),
        h('label', { className: 's360-field' },
          h('span', { className: 's360-fieldLabel' }, t('evolveRule')),
          h('textarea', {
            className: 's360-textarea',
            rows: 3,
            value: rule,
            placeholder: t('evolveRuleHint'),
            onChange: (event) => props.onChange('rule', event.target.value),
          })),
        h('label', { className: 's360-field' },
          h('span', { className: 's360-fieldLabel' }, t('evolveEvidence')),
          h('input', {
            className: 's360-input',
            type: 'text',
            value: String(editor.evidence || ''),
            onChange: (event) => props.onChange('evidence', event.target.value),
          })),
        h('div', { className: 's360-editorHint' }, t('evolveRuleHint')),
        h('div', { className: 's360-editorActions' },
          h('button', {
            type: 'button',
            className: 's360-btn s360-btnPrimary',
            disabled: props.busy || !rule.trim(),
            onClick: props.onSubmit,
          }, t('evolveWrite')),
          h('button', {
            type: 'button',
            className: 's360-btn',
            disabled: props.busy,
            onClick: props.onCancel,
          }, t('evolveCancel'))));
    }

    function EvolutionSection(props) {
      const ev = normalizeEvolution(props.evolution);
      const t = props.t;
      const lessons = ev.lessons;
      const signals = ev.signals;
      const pending = ev.pending;
      const counters = [
        ['signalLoads', signals.loads],
        ['signalCorrections', signals.corrections],
        ['signalErrors', signals.postLoadErrors],
        ['signalReloads', signals.reloads],
        ['signalFailures', signals.turnFailures],
        ['signalAsks', signals.asks],
      ];
      const signalTotal = signals.reloads + signals.postLoadErrors + signals.corrections
        + signals.asks + signals.turnFailures;
      const proposals = ev.proposals.length
        ? ev.proposals
        : (pending.hasUnclosed || pending.draft
          ? [{ id: 'evolution.add-lesson', draft: pending.draft }]
          : []);

      return h('section', {
        className: 's360-section s360-evolution',
        'data-applicable': ev.applicable ? 'true' : 'false',
      },
        h('h3', { className: 's360-sectionTitle' },
          t('evolutionTitle'),
          ev.applicable ? null : h(Chip, { tone: 'na' }, t('notScored'))),
        ev.applicable ? null : h('div', { className: 's360-muted' }, t('evolutionNotScored')),
        h('div', { className: 's360-metrics' },
          h('div', { className: 's360-metric' },
            h('div', { className: 's360-metricLabel' }, t('evolveLessons')),
            h('div', { className: 's360-metricValue' }, String(lessons.count))),
          h('div', { className: 's360-metric' },
            h('div', { className: 's360-metricLabel' }, t('evolveLatest')),
            h('div', { className: 's360-metricValue' },
              lessons.latestAt == null ? t('evolveNever') : formatDay(lessons.latestAt))),
          h('div', { className: 's360-metric' },
            h('div', { className: 's360-metricLabel' }, t('evolveEntry')),
            h('div', { className: 's360-metricValue' },
              lessons.linked ? t('evolveLinkedYes') : t('evolveLinkedNo'))),
          h('div', { className: 's360-metric' },
            h('div', { className: 's360-metricLabel' }, t('evolveLastSignal')),
            h('div', { className: 's360-metricValue' },
              pending.lastSignalAt == null ? '—' : formatDay(pending.lastSignalAt)))),
        lessons.count === 0 ? h('div', { className: 's360-evEmpty' }, t('evolveEmptyLessons')) : null,
        h('div', { className: 's360-subLabel' }, t('evolveSignals')),
        h('div', { className: 's360-evSignals' },
          counters.map((entry) => h('span', { className: 's360-evSignal', key: entry[0] },
            h('span', { className: 's360-evSignalLabel' }, t(entry[0])),
            h('span', { className: 's360-evSignalValue' }, String(entry[1]))))),
        signalTotal === 0 ? h('div', { className: 's360-evEmpty' }, t('evolveEmptySignals')) : null,
        signals.samples.length
          ? h('ul', { className: 's360-evSamples' },
            signals.samples.slice(0, 4).map((sample, index) => h('li', {
              className: 's360-evSample',
              key: (sample.sessionId || 'sample') + ':' + index,
            },
              h('span', { className: 's360-evSampleKind' }, t(signalKindKey(sample.kind))),
              h('span', { className: 's360-evSampleText' }, clip(sample.excerpt || '', 160)),
              h('span', { className: 's360-evSampleMeta' },
                (sample.sessionId || '—') + ' · ' + formatDay(sample.at)))))
          : null,
        h('div', { className: 's360-subLabel' }, t('evolvePendingTitle')),
        proposals.length
          ? h('ul', { className: 's360-evProposals' },
            proposals.map((proposal, index) => {
              const draft = (proposal && proposal.draft) || {};
              return h('li', {
                className: 's360-evProposal',
                key: (proposal && proposal.id ? proposal.id : 'proposal') + ':' + index,
              },
                h('div', { className: 's360-evTrigger' },
                  draft.trigger ? clip(draft.trigger, 160) : t('evolveNoTrigger')),
                proposal && proposal.why ? h('div', { className: 's360-sugText' }, proposal.why) : null,
                h('div', { className: 's360-evEvidence' },
                  labeled(t, 'evolveEvidence', draft.evidence || '—')
                  + (pending.lastSignalAt != null ? ' · ' + formatDay(pending.lastSignalAt) : '')),
                h('button', {
                  type: 'button',
                  className: 's360-btn s360-btnPrimary s360-btnSm',
                  disabled: props.busy,
                  onClick: () => props.onEdit(draft),
                }, t('evolveButton')));
            }))
          : h('div', { className: 's360-evEmpty' }, t('evolveNoPending')),
        props.editor ? h(EvolveEditor, {
          editor: props.editor,
          t,
          busy: props.busy,
          onChange: props.onChange,
          onSubmit: props.onSubmit,
          onCancel: props.onCancel,
        }) : null);
    }

    function DetailView(props) {
      const detail = props.detail;
      const t = props.t;
      const score = detail.score || {};
      const verdict = detail.verdict || {};
      const dimensions = score.dimensions || [];
      const findings = detail.findings || [];
      const suggestions = detail.suggestions || [];
      const overlaps = detail.overlaps || [];
      const raw = detail.raw;
      const rawLines = raw ? String(raw).split('\n').slice(0, 200).join('\n') : '';
      const verdictLabel = verdictLabelOf(verdict.code);
      const delta = score.delta;

      return h('div', { className: 's360-detailBody' },
        h('div', { className: 's360-detailHead' },
          h('div', { className: 's360-detailTitleLine' },
            h('h2', { className: 's360-detailName' }, detail.name),
            h('span', { className: 's360-grade s360-grade' + score.grade }, score.grade),
            verdictLabel ? h(Chip, { tone: verdict.code }, t(verdictLabel)) : null),
          detail.description ? h('p', { className: 's360-detailDesc' }, detail.description) : null,
          h('div', { className: 's360-detailScoreRow' },
            h('div', { className: 's360-bigScore' },
              h('span', { className: 's360-bigScoreNum' }, fmt1(score.total)),
              h('span', { className: 's360-bigScoreLabel' }, t('scoreLabel'))),
            h('div', { className: 's360-scoreMeta' },
              h('span', { className: 's360-scoreMetaItem' }, labeled(t, 'confidenceLabel', fmt1(score.confidence))),
              delta != null
                ? h('span', { className: 's360-scoreMetaItem', 'data-delta': delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' },
                  labeled(t, 'deltaLabel', (delta > 0 ? '+' : '') + fmt1(delta)))
                : null)),
          verdict.reason ? h('div', { className: 's360-verdictReason' }, labeled(t, 'verdictLabel', verdict.reason)) : null,
          h('div', { className: 's360-detailActions' },
            h('button', {
              type: 'button',
              className: 's360-btn s360-btnPrimary',
              disabled: props.busy,
              onClick: () => props.onApplyAll(detail.name),
            }, t('applyAllSkill'))),
          detail.path ? h('div', { className: 's360-path' }, labeled(t, 'pathLabel', detail.path)) : null,
          detail.coverage ? h('div', { className: 's360-coverage' },
            labeled(t, 'coverageLabel', detail.coverage === 'full' ? t('coverageFull') : t('coveragePartial'))) : null),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('dimensionsTitle')),
          dimensions.map((dim) => h(DimensionBlock, { dim, t, key: dim.id }))),

        h(EvolutionSection, {
          evolution: detail.evolution,
          t,
          busy: props.busy,
          editor: props.evolveEditor,
          onEdit: props.onEvolveEdit,
          onChange: props.onEvolveChange,
          onSubmit: props.onEvolveSubmit,
          onCancel: props.onEvolveCancel,
        }),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('metricsTitle')),
          h(MetricsGrid, { metrics: detail.metrics, usage: detail.usage, t })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('findingsTitle')),
          h(FindingsList, { findings, suggestions, t, busy: props.busy, onApply: props.onApply })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('suggestionsTitle')),
          h(SuggestionsList, { suggestions, t, busy: props.busy, onApply: props.onApply })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('overlapsTitle')),
          h(OverlapsList, { overlaps, t, onJump: props.onJump })),

        h('details', { className: 's360-source' },
          h('summary', { className: 's360-sourceSummary' }, t('viewSource')),
          h('pre', { className: 's360-sourcePre' }, rawLines || '')));
    }

    function EmptyState(props) {
      return h('div', { className: 's360-empty' },
        props.icon ? h('div', { className: 's360-emptyIcon' }, props.icon) : null,
        h('div', { className: 's360-emptyTitle' }, props.title),
        props.hint ? h('div', { className: 's360-emptyHint' }, props.hint) : null);
    }

    function Notice(props) {
      const notice = props.notice;
      if (!notice) return null;
      return h('div', {
        className: 's360-toast',
        'data-kind': notice.kind,
        role: notice.kind === 'error' ? 'alert' : 'status',
      }, notice.text);
    }

    // -------------------------------------------------------------------- page

    function Skills360Page() {
      const t = useTranslate();

      // useState order — MUST stay in sync with .verify-client.mjs seed arrays:
      // 0 loading, 1 portfolio, 2 loadError, 3 refreshKey, 4 selected, 5 detail,
      // 6 detailLoading, 7 detailError, 8 detailVersion, 9 query, 10 gradeFilter,
      // 11 verdictFilter, 12 sourceFilter, 13 onlyProblems, 14 notice, 15 busy,
      // 16 lastBackupIds (array; a string seed is normalized for tests),
      // 17 evolveEditor (null = closed; {trigger, rule, evidence} = open).
      const [loading, setLoading] = React.useState(true);
      const [portfolio, setPortfolio] = React.useState(null);
      const [loadError, setLoadError] = React.useState('');
      const [refreshKey, setRefreshKey] = React.useState(0);
      const [selected, setSelected] = React.useState('');
      const [detail, setDetail] = React.useState(null);
      const [detailLoading, setDetailLoading] = React.useState(false);
      const [detailError, setDetailError] = React.useState('');
      const [detailVersion, setDetailVersion] = React.useState(0);
      const [query, setQuery] = React.useState('');
      const [gradeFilter, setGradeFilter] = React.useState('all');
      const [verdictFilter, setVerdictFilter] = React.useState('all');
      const [sourceFilter, setSourceFilter] = React.useState('all');
      const [onlyProblems, setOnlyProblems] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [lastBackupIds, setLastBackupIds] = React.useState([]);
      const [evolveEditor, setEvolveEditor] = React.useState(null);
      const undoIds = Array.isArray(lastBackupIds) ? lastBackupIds : (lastBackupIds ? [lastBackupIds] : []);

      const forceRefresh = React.useRef(false);

      const refresh = React.useCallback(() => {
        forceRefresh.current = true;
        setRefreshKey((value) => value + 1);
      }, []);

      // Scan effect (initial GET /scan; refresh button uses refresh=1).
      React.useEffect(() => {
        let alive = true;
        setLoading(true);
        setLoadError('');
        const suffix = forceRefresh.current ? '?refresh=1' : '';
        forceRefresh.current = false;
        (async () => {
          try {
            const data = await api('/scan' + suffix);
            if (!alive) return;
            setPortfolio(data);
            setSelected((previous) => {
              const skills = (data && data.skills) || [];
              if (previous && skills.some((s) => s.name === previous)) return previous;
              return skills.length ? skills[0].name : '';
            });
          } catch (error) {
            if (alive) setLoadError(errMessage(error));
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => { alive = false; };
      }, [refreshKey]);

      // Detail effect (GET /skill?name=).
      React.useEffect(() => {
        if (!selected) {
          setDetail(null);
          setDetailError('');
          return undefined;
        }
        let alive = true;
        setDetailLoading(true);
        setDetailError('');
        api('/skill?name=' + encodeURIComponent(selected)).then(
          (data) => {
            if (!alive) return;
            setDetail(data);
            // Survive a page refresh: the selected skill's newest backup is
            // the undo target, even when this session did not create it.
            if (data && data.lastBackup && data.lastBackup.id) {
              setLastBackupIds((previous) => {
                const list = Array.isArray(previous) ? previous : (previous ? [previous] : []);
                return list.length > 0 ? list : [data.lastBackup.id];
              });
            }
          },
          (error) => { if (alive) setDetailError(errMessage(error)); },
        ).finally(() => { if (alive) setDetailLoading(false); });
        return () => { alive = false; };
      }, [selected, detailVersion]);

      // Toast auto-dismiss.
      React.useEffect(() => {
        if (!notice) return undefined;
        const timer = window.setTimeout(() => setNotice(null), 6500);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const visibleSkills = React.useMemo(() => {
        const skills = (portfolio && portfolio.skills) || [];
        const needle = query.trim().toLowerCase();
        return skills.filter((s) => {
          if (gradeFilter !== 'all' && s.score.grade !== gradeFilter) return false;
          if (verdictFilter !== 'all' && s.verdict.code !== verdictFilter) return false;
          if (sourceFilter !== 'all' && s.source !== sourceFilter) return false;
          if (onlyProblems && !hasMajorPlus(s)) return false;
          if (needle) {
            const hay = [s.name, s.description].join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          return true;
        });
      }, [portfolio, query, gradeFilter, verdictFilter, sourceFilter, onlyProblems]);

      const sources = React.useMemo(() => {
        const skills = (portfolio && portfolio.skills) || [];
        const seen = new Set();
        skills.forEach((s) => { if (s.source) seen.add(s.source); });
        return Array.from(seen).sort();
      }, [portfolio]);

      async function refreshAfterWrite() {
        forceRefresh.current = true;
        setRefreshKey((value) => value + 1);
        setDetailVersion((value) => value + 1);
      }

      async function applySuggestion(suggestion) {
        if (!selected || !suggestion) return;
        setBusy(true);
        try {
          const before = detail && detail.score ? detail.score.total : null;
          const res = await api('/apply', {
            method: 'POST',
            body: { name: selected, actionIds: [suggestion.id] },
          });
          const backupId = res && res.backupId;
          const after = res && res.report && res.report.score ? res.report.score.total : null;
          setLastBackupIds(backupId ? [backupId] : []);
          setNotice({
            kind: 'success',
            text: t('applyDone', {
              backupId: backupId || '—',
              before: fmt1(before),
              after: fmt1(after),
            }),
          });
          await refreshAfterWrite();
        } catch (error) {
          setNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setBusy(false);
        }
      }

      function openEvolveEditor(lesson) {
        const draft = lesson || {};
        setEvolveEditor({
          trigger: String(draft.trigger == null ? '' : draft.trigger),
          rule: String(draft.rule == null ? '' : draft.rule),
          evidence: String(draft.evidence == null ? '' : draft.evidence),
        });
      }

      function closeEvolveEditor() {
        setEvolveEditor(null);
      }

      function changeEvolveField(field, value) {
        setEvolveEditor((previous) => (previous ? { ...previous, [field]: value } : previous));
      }

      async function submitEvolve() {
        if (!selected || !evolveEditor) return;
        const lesson = {
          trigger: String(evolveEditor.trigger || '').trim(),
          rule: String(evolveEditor.rule || '').trim(),
          evidence: String(evolveEditor.evidence || '').trim(),
        };
        if (!lesson.rule) {
          setNotice({ kind: 'error', text: t('evolveRuleRequired') });
          return;
        }
        const confirmed = window.confirm(t('confirmEvolve', { name: selected }));
        if (!confirmed) return;
        setBusy(true);
        try {
          const before = detail && detail.score ? detail.score.total : null;
          const res = await api('/evolve', {
            method: 'POST',
            body: { name: selected, lesson },
          });
          const backupId = res && res.backupId;
          const after = res && res.afterTotal != null
            ? res.afterTotal
            : (res && res.report && res.report.score ? res.report.score.total : null);
          const from = res && res.beforeTotal != null ? res.beforeTotal : before;
          setLastBackupIds(backupId ? [backupId] : []);
          setEvolveEditor(null);
          setNotice({
            kind: 'success',
            text: t('evolveDone', {
              backupId: backupId || '—',
              before: fmt1(from),
              after: fmt1(after),
            }),
          });
          await refreshAfterWrite();
        } catch (error) {
          setNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setBusy(false);
        }
      }

      function applyOrEvolve(suggestion) {
        if (!suggestion) return;
        if (isLessonSuggestion(suggestion)) {
          openEvolveEditor(lessonOf(suggestion));
          return;
        }
        applySuggestion(suggestion);
      }

      async function applyAll(name) {
        const confirmed = window.confirm(name ? t('confirmApplyAllSkill') : t('confirmApplyAll'));
        if (!confirmed) return;
        setBusy(true);
        try {
          const body = name ? { name, safeOnly: true } : { safeOnly: true };
          const res = await api('/apply-all', { method: 'POST', body });
          const backupId = res && res.backupId;
          const appliedCount = res && res.applied ? res.applied.length : 0;
          setLastBackupIds(backupId ? [backupId] : []);
          setNotice({
            kind: 'success',
            text: appliedCount
              ? t('applyAllDone', { count: appliedCount, backupId: backupId || '—' })
              : t('applyAllNone'),
          });
          await refreshAfterWrite();
        } catch (error) {
          setNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setBusy(false);
        }
      }

      async function undoLast() {
        const confirmed = window.confirm(t('confirmUndo'));
        if (!confirmed) return;
        setBusy(true);
        try {
          const res = await api('/undo', {
            method: 'POST',
            body: undoIds.length > 0 ? { backupIds: undoIds } : {},
          });
          const doneIds = res && Array.isArray(res.backups) ? res.backups.map((item) => item.backupId) : [];
          const backupId = doneIds.length > 0
            ? (doneIds.length === 1 ? doneIds[0] : t('undoMany', { count: doneIds.length }))
            : (undoIds[0] || '—');
          setNotice({ kind: 'success', text: t('undoDone', { backupId }) });
          setLastBackupIds([]);
          await refreshAfterWrite();
        } catch (error) {
          setNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setBusy(false);
        }
      }

      async function exportReport() {
        setBusy(true);
        try {
          const res = await api('/export', { method: 'POST', body: {} });
          setNotice({ kind: 'success', text: t('exportDone', { path: (res && res.path) || '—' }) });
        } catch (error) {
          setNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setBusy(false);
        }
      }

      function jumpToSkill(name) {
        setSelected(name);
      }

      function retryDetail() {
        setDetailVersion((value) => value + 1);
      }

      const empty = portfolio && Array.isArray(portfolio.skills) && portfolio.skills.length === 0;

      const header = h('div', { className: 's360-header' },
        h('div', { className: 's360-heading' },
          h('h1', { className: 's360-title' }, t('title')),
          h('p', { className: 's360-subtitle' }, t('subtitle'))),
        h('div', { className: 's360-headerActions' },
          h('button', {
            type: 'button',
            className: 's360-btn s360-btnGhost',
            onClick: refresh,
            disabled: loading || busy,
            title: t('refresh'),
            'aria-label': t('refresh'),
          }, loading ? h(Spinner) : h(RefreshIcon, { size: 14 }), h('span', null, t('refresh'))),
          h('button', {
            type: 'button',
            className: 's360-btn',
            onClick: exportReport,
            disabled: busy || !portfolio,
          }, h(ExportIcon, { size: 14 }), h('span', null, t('export'))),
          h('button', {
            type: 'button',
            className: 's360-btn',
            onClick: () => applyAll(null),
            disabled: busy || !portfolio,
          }, t('applyAll')),
          h('button', {
            type: 'button',
            className: 's360-btn',
            onClick: undoLast,
            disabled: busy || undoIds.length === 0,
          }, h(UndoIcon, { size: 14 }), h('span', null, t('undo')))));

      let body;
      if (loading && !portfolio) {
        body = h('div', { className: 's360-center' }, h(Spinner), h('span', null, t('loading')));
      } else if (loadError && !portfolio) {
        body = h('div', { className: 's360-center' },
          h('div', { className: 's360-errorText' }, t('loadFailed', { message: loadError })),
          h('button', { type: 'button', className: 's360-btn s360-btnPrimary', onClick: refresh }, t('retry')));
      } else if (empty) {
        body = h('div', { className: 's360-center' },
          h(EmptyState, {
            icon: h(ChartIcon, { size: 26 }),
            title: t('emptyTitle'),
            hint: t('emptyHint'),
          }),
          h('button', { type: 'button', className: 's360-btn s360-btnPrimary', onClick: refresh }, t('refresh')));
      } else {
        const totals = portfolio.totals || {};
        const grades = totals.grades || {};
        const gradesText = ['A', 'B', 'C', 'D'].map((g) => g + ' ' + (grades[g] ?? 0)).join(' · ');

        const statsBar = h('div', { className: 's360-stats', role: 'group', 'aria-label': t('title') },
          h(StatCard, { label: t('statSkills'), value: String(totals.skills ?? 0) }),
          h(StatCard, { label: t('statAvg'), value: fmt1(totals.avgScore) }),
          h(StatCard, { label: t('statGrades'), value: gradesText }),
          h(StatCard, { label: t('statCatalogTokens'), value: formatTokens(totals.catalogTokens) + ' ' + t('tokensUnit') }),
          h(StatCard, { label: t('statFullTokens'), value: formatTokens(totals.fullLoadTokens) + ' ' + t('tokensUnit') }),
          h(StatCard, { label: t('statZeroUse'), value: String(totals.zeroUse ?? 0) }));

        const filterChips = (options, current, onChange) => options.map((opt) => h('button', {
          key: opt[0],
          type: 'button',
          className: 's360-filter',
          'data-active': current === opt[0] ? 'true' : 'false',
          onClick: () => onChange(opt[0]),
        }, opt[1]));

        const gradeOptions = [['all', t('filterAll')], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']];
        const verdictOptions = [['all', t('filterAll')], ['keep', t('verdictKeep')], ['watch', t('verdictWatch')], ['merge', t('verdictMerge')], ['archive', t('verdictArchive')]];
        const sourceOptions = [['all', t('filterAll')]].concat(sources.map((s) => [s, s]));

        const listPane = h('aside', { className: 's360-listPane', 'aria-label': t('title') },
          h('div', { className: 's360-listHead' },
            h('div', { className: 's360-searchWrap' },
              h(SearchIcon, { size: 14 }),
              h('input', {
                type: 'search',
                className: 's360-input s360-search',
                value: query,
                placeholder: t('searchPlaceholder'),
                'aria-label': t('searchPlaceholder'),
                onChange: (event) => setQuery(event.target.value),
              })),
            h('div', { className: 's360-filters', role: 'group', 'aria-label': t('filterGrade') },
              h('span', { className: 's360-filterLabel' }, t('filterGrade')),
              h('div', { className: 's360-filterRow' }, filterChips(gradeOptions, gradeFilter, setGradeFilter))),
            h('div', { className: 's360-filters', role: 'group', 'aria-label': t('filterVerdict') },
              h('span', { className: 's360-filterLabel' }, t('filterVerdict')),
              h('div', { className: 's360-filterRow' }, filterChips(verdictOptions, verdictFilter, setVerdictFilter))),
            h('div', { className: 's360-filters', role: 'group', 'aria-label': t('filterSource') },
              h('span', { className: 's360-filterLabel' }, t('filterSource')),
              h('div', { className: 's360-filterRow' }, filterChips(sourceOptions, sourceFilter, setSourceFilter))),
            h('label', { className: 's360-problemsToggle' },
              h('input', {
                type: 'checkbox',
                checked: onlyProblems,
                onChange: (event) => setOnlyProblems(event.target.checked),
              }),
              h('span', null, t('onlyProblems'))),
            h('div', { className: 's360-listMeta' }, t('count', { count: visibleSkills.length }))),
          h('div', { className: 's360-list' },
            visibleSkills.length === 0
              ? h(EmptyState, { icon: h(SearchIcon, { size: 22 }), title: t('noMatch'), hint: t('noMatchHint') })
              : visibleSkills.map((skill) => h(SkillRow, {
                key: skill.name,
                skill,
                t,
                selected,
                onSelect: jumpToSkill,
              }))));

        // Detail pane.
        const currentDetail = detail && detail.name === selected ? detail : null;
        let detailPane;
        if (!selected) {
          detailPane = h('section', { className: 's360-detail' },
            h(EmptyState, { icon: h(ChartIcon, { size: 26 }), title: t('noSelection'), hint: t('noSelectionHint') }));
        } else if (detailLoading && !currentDetail) {
          detailPane = h('section', { className: 's360-detail' },
            h('div', { className: 's360-center' }, h(Spinner), h('span', null, t('loading'))));
        } else if (detailError && !currentDetail) {
          detailPane = h('section', { className: 's360-detail' },
            h('div', { className: 's360-center' },
              h('div', { className: 's360-errorText' }, t('detailLoadFailed', { message: detailError })),
              h('button', { type: 'button', className: 's360-btn s360-btnPrimary', onClick: retryDetail }, t('retry'))));
        } else if (currentDetail) {
          detailPane = h('section', { className: 's360-detail' },
            h(DetailView, {
              detail: currentDetail,
              t,
              busy,
              onApply: applyOrEvolve,
              onApplyAll: applyAll,
              onJump: jumpToSkill,
              evolveEditor,
              onEvolveEdit: openEvolveEditor,
              onEvolveChange: changeEvolveField,
              onEvolveSubmit: submitEvolve,
              onEvolveCancel: closeEvolveEditor,
            }));
        } else {
          detailPane = h('section', { className: 's360-detail' },
            h('div', { className: 's360-center' }, h(Spinner), h('span', null, t('loading'))));
        }

        body = h('div', { className: 's360-content' },
          loadError ? h('div', { className: 's360-banner', 'data-kind': 'error' }, t('loadFailed', { message: loadError })) : null,
          statsBar,
          h('div', { className: 's360-body' }, listPane, detailPane));
      }

      return h('div', { className: 's360-page' }, header, body, h(Notice, { notice }));
    }

    // ------------------------------------------------------------------ styles

    const CSS = [
      '.s360-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;padding:20px 22px 22px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.s360-page *{box-sizing:border-box}',
      '.s360-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.s360-heading{min-width:0}',
      '.s360-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.s360-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.s360-headerActions{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}',
      '.s360-btn{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:22px;padding:0 10px;cursor:pointer;white-space:nowrap}',
      '.s360-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.s360-btn:disabled{opacity:.5;cursor:default}',
      '.s360-btnPrimary{border-color:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.s360-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary))}',
      '.s360-btnGhost{border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 8px}',
      '.s360-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.s360-btnSm{line-height:18px;font-size:11px;padding:0 8px}',
      '.s360-content{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}',
      '.s360-banner{padding:7px 10px;border-radius:7px;font-size:11.5px;border:0.5px solid var(--dsw-alias-border-l1)}',
      '.s360-banner[data-kind="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.s360-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;flex:none}',
      '.s360-stat{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:9px 12px;min-width:0}',
      '.s360-statValue{font-size:16px;font-weight:600;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-statLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.s360-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:12px}',
      '.s360-listPane{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.s360-listHead{display:flex;flex-direction:column;gap:7px;padding:11px 12px 9px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.s360-searchWrap{position:relative;display:flex;align-items:center;gap:6px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.s360-searchWrap:focus-within{border-color:var(--dsw-alias-border-l2)}',
      '.s360-input{width:100%;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:6px 8px;outline:none}',
      '.s360-search{border:0;background:transparent;padding:6px 2px}',
      '.s360-filters{display:flex;flex-direction:column;gap:3px}',
      '.s360-filterLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-filterRow{display:flex;gap:4px;flex-wrap:wrap}',
      '.s360-filter{border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:20px;border-radius:6px;cursor:pointer;padding:0 7px}',
      '.s360-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.s360-filter[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.s360-problemsToggle{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}',
      '.s360-listMeta{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-list{flex:1;min-height:0;overflow:auto;padding:6px}',
      '.s360-row{display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;border:0.5px solid transparent;border-radius:9px;background:transparent;color:inherit;font:inherit;padding:8px 9px;cursor:pointer;margin-bottom:2px}',
      '.s360-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.s360-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.s360-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.s360-rowTitleLine{display:flex;align-items:baseline;gap:7px;min-width:0}',
      '.s360-rowName{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.s360-rowScore{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.s360-rowDesc{margin-top:1px;font-size:11px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.s360-rowMeta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px}',
      '.s360-metaText{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-grade{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:6px;font-size:12px;font-weight:700;border:1px solid;flex:none}',
      '.s360-gradeA{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-gradeB{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.s360-gradeC{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.s360-gradeD{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.s360-chip{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.s360-chip-keep{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-chip-watch{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.s360-chip-merge{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.s360-chip-archive{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.s360-chip-sev-critical{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.s360-chip-sev-major{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.s360-chip-sev-minor{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.s360-chip-sev-info{color:var(--dsw-alias-label-secondary)}',
      '.s360-chip-auto{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-chip-draft{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.s360-chip-manual{color:var(--dsw-alias-label-secondary)}',
      '.s360-chip-na{color:var(--dsw-alias-label-secondary);border-style:dashed}',
      '.s360-chip-evolve{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.s360-detail{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow-y:auto;overflow-x:hidden}',
      '.s360-detailBody{display:flex;flex-direction:column;gap:0}',
      '.s360-detailHead{display:flex;flex-direction:column;gap:7px;padding:14px 16px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.s360-detailTitleLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.s360-detailName{margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere}',
      '.s360-detailDesc{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-detailScoreRow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}',
      '.s360-bigScore{display:flex;align-items:baseline;gap:6px}',
      '.s360-bigScoreNum{font-size:26px;font-weight:700;letter-spacing:-.02em}',
      '.s360-bigScoreLabel{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.s360-scoreMeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.s360-scoreMetaItem[data-delta="up"]{color:var(--dsw-alias-state-success-primary)}',
      '.s360-scoreMetaItem[data-delta="down"]{color:var(--dsw-alias-state-error-primary)}',
      '.s360-verdictReason{margin:0;font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-detailActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.s360-path{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-coverage{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.s360-section{padding:12px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
      '.s360-sectionTitle{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 9px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-dim{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);margin-bottom:7px}',
      '.s360-dim:last-child{margin-bottom:0}',
      '.s360-dimSummary{list-style:none;cursor:pointer;padding:9px 11px;display:flex;flex-direction:column;gap:5px}',
      '.s360-dimSummary::-webkit-details-marker{display:none}',
      '.s360-dimTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
      '.s360-dimLabel{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:600}',
      '.s360-dim[data-applicable="false"] .s360-barFill{background:var(--dsw-alias-border-l2)}',
      '.s360-dimScore{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.s360-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.s360-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
      '.s360-dimSummaryText{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.s360-dimItems{list-style:none;margin:0;padding:0 11px 9px;display:flex;flex-direction:column;gap:6px}',
      '.s360-dimItem{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:6px}',
      '.s360-dimItemTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
      '.s360-dimItemLabel{font-size:11.5px;font-weight:600}',
      '.s360-dimItemScore{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.s360-dimItemDetail{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-evolution{display:flex;flex-direction:column;gap:7px}',
      '.s360-subLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}',
      '.s360-evSignals{display:flex;flex-wrap:wrap;gap:5px}',
      '.s360-evSignal{display:inline-flex;align-items:center;gap:5px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-base);padding:1px 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-evSignalValue{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.s360-evEmpty{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.s360-evProposals{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.s360-evProposal{display:flex;flex-direction:column;gap:4px;border:0.5px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px}',
      '.s360-evTrigger{font-size:11.5px;font-weight:600;overflow-wrap:anywhere}',
      '.s360-evEvidence{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-evSamples{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}',
      '.s360-evSample{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-evSampleKind{flex:none;color:var(--dsw-alias-state-warn-primary)}',
      '.s360-evSampleText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-evSampleMeta{flex:none;font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)}',
      '.s360-editor{display:flex;flex-direction:column;gap:7px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:10px 11px}',
      '.s360-editorTitle{font-size:12px;font-weight:600}',
      '.s360-field{display:flex;flex-direction:column;gap:3px}',
      '.s360-fieldLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-textarea{width:100%;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.45;padding:6px 8px;outline:none;resize:vertical;min-height:52px}',
      '.s360-textarea:focus{border-color:var(--dsw-alias-border-l2)}',
      '.s360-editorActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.s360-editorHint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}',
      '.s360-metric{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);padding:7px 9px;min-width:0}',
      '.s360-metricLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-metricValue{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-findings{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.s360-finding{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:9px 11px;display:flex;flex-direction:column;gap:5px}',
      '.s360-finding[data-sev="critical"]{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.s360-finding[data-sev="major"]{border-left:3px solid var(--dsw-alias-state-warn-primary)}',
      '.s360-finding[data-sev="minor"]{border-left:3px solid var(--dsw-alias-state-business-primary)}',
      '.s360-finding[data-sev="info"]{border-left:3px solid var(--dsw-alias-state-idle-primary)}',
      '.s360-findingHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.s360-sev{display:inline-flex;align-items:center;border-radius:5px;padding:0 6px;font-size:10px;line-height:16px;font-weight:600}',
      '.s360-sev-critical{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.s360-sev-major{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.s360-sev-minor{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.s360-sev-info{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.s360-findingTitle{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
      '.s360-findingDetail{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-findingEvidence{display:flex;flex-direction:column;gap:3px}',
      '.s360-code{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;color:var(--dsw-alias-label-primary);align-self:flex-start}',
      '.s360-evExcerpt{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:7px;overflow-wrap:anywhere}',
      '.s360-findingSug{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-findingActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.s360-suggestions{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.s360-sug{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:9px 11px;display:flex;flex-direction:column;gap:5px}',
      '.s360-sugHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.s360-sugTitle{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
      '.s360-sugText{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-draftNote{font-size:10.5px;color:var(--dsw-alias-state-warn-primary);border:0.5px solid var(--dsw-alias-state-warn-primary);border-radius:6px;padding:4px 7px;align-self:flex-start}',
      '.s360-sugActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.s360-preview{display:flex;flex-direction:column;gap:3px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;padding:6px 8px;background:var(--dsw-alias-bg-layer-1)}',
      '.s360-previewTitle{font-size:10px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}',
      '.s360-previewRow{display:flex;flex-direction:column;gap:1px}',
      '.s360-previewTag{font-size:10px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.s360-previewTagAfter{color:var(--dsw-alias-state-success-primary)}',
      '.s360-previewText{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.s360-overlaps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}',
      '.s360-overlap{margin:0}',
      '.s360-overlapBtn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;padding:7px 10px;cursor:pointer}',
      '.s360-overlapBtn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.s360-overlapName{font-size:12px;font-weight:600;color:var(--dsw-alias-brand-primary)}',
      '.s360-overlapScore{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.s360-overlapTriggers{font-size:10.5px;color:var(--dsw-alias-label-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-source{border-top:0.5px solid var(--dsw-alias-border-l1)}',
      '.s360-sourceSummary{list-style:none;cursor:pointer;padding:12px 16px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.s360-sourceSummary::-webkit-details-marker{display:none}',
      '.s360-sourcePre{margin:0;padding:0 16px 14px;font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}',
      '.s360-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);min-height:200px;text-align:center;padding:24px}',
      '.s360-errorText{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;max-width:520px}',
      '.s360-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:28px 18px;text-align:center;color:var(--dsw-alias-label-secondary);min-height:140px}',
      '.s360-emptyIcon{opacity:.7;display:inline-flex}',
      '.s360-emptyTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-emptyHint{font-size:11.5px;max-width:360px}',
      '.s360-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.s360-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:s360-spin .8s linear infinite;display:inline-block;flex:none}',
      '@keyframes s360-spin{to{transform:rotate(360deg)}}',
      '.s360-toast{position:fixed;right:18px;bottom:18px;max-width:420px;padding:9px 12px;border-radius:9px;font-size:12px;border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-toast-bg, var(--dsw-alias-bg-overlay));color:var(--dsw-alias-toast-label, var(--dsw-alias-label-primary));box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:60}',
      '.s360-toast[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary)}',
      '@media (max-width: 880px){.s360-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.s360-body{grid-template-columns:minmax(0,1fr)}.s360-listPane{max-height:300px}}',
      '@media (max-width: 620px){.s360-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.s360-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.s360-header{flex-direction:column}}',
    ].join('\n');

    function insertStyles() {
      const tagId = NS + '/style';
      if (typeof document === 'undefined') return () => {};
      const previous = document.querySelector('style[data-plugin-css="' + tagId + '"]');
      if (previous && typeof previous.remove === 'function') previous.remove();
      const tag = document.createElement('style');
      tag.dataset.plugin = NS;
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
        order: 40,
        label: () => (runtime ? runtime.t('panelTitle') : 'Skills 360'),
      }, PanelIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, Skills360Page));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
