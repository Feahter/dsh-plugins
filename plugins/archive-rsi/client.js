window.__ModuleLoader__.load({
  id: 'dsh-archive-rsi',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'archive-rsi';
    const PANEL_KEY = 'archive-rsi';
    // Sits beside the task ledger (order 30) and the other profile panels.
    const PANEL_ORDER = 42;
    const API_PREFIX = '/api/archive-rsi';
    const LIST_LIMIT = 200;
    const RUN_LIMIT = 50;
    const REQUEST_TIMEOUT_MS = 30000;
    const NOTICE_TTL_MS = 5000;
    const TAG_LIMIT = 24;
    // Mirrors alchemy.js RUN_STALE_MS: a run stuck in `running` this long is shown as interrupted.
    const RUN_STALE_MS = 10 * 60 * 1000;
    const EVIDENCE_CHIP_LIMIT = 6;
    // Transcript paging: the first paint pulls a small slice so a large transcript
    // does not stall the detail pane; "load more" then fetches a big window by
    // offset and appends it. The host clamps maxChars to [1000, 400000].
    const TRANSCRIPT_INITIAL_MAX = 24000;
    const TRANSCRIPT_MORE_MAX = 200000;

    // ------------------------------------------------------------------ locale

    const zh = {
      panelTitle: '归档 · 炼金',
      title: '归档与炼金 RSI',
      subtitle: '历史会话归档、PDCA 度量与上下文补丁提案',
      refresh: '刷新',
      loading: '正在加载…',
      retry: '重试',
      requestTimeout: '请求超时',
      emptyResponse: '归档接口返回了空响应',
      httpError: '请求失败（HTTP {status}）',
      loadFailed: '加载失败：{message}',
      actionFailed: '操作失败：{message}',
      unset: '—',
      untitledSession: '（未命名会话）',

      metricsAria: '归档总览指标',
      metricCorpus: '语料体积',
      metricSessions: '会话数',
      metricToolErrorRate: '工具错误率',
      metricVerificationGap: '验证缺口率',
      metricCatalogBytes: '工具目录字节',
      metricTokens: 'Token 总量',
      metricFromLatestRun: '来自最近一次 PDCA 运行的队列指标',

      alchemyStatus: '炼金状态',
      alchemyStatusAria: '炼金运行状态',
      alchemyRunning: '运行中',
      alchemyIdle: '空闲',
      alchemyStalled: '上次运行中断',
      alchemyNeverRun: '尚未运行',
      lastRunLabel: '最近运行',
      runDurationLabel: '用时',
      runTargetsLabel: '目标达标 {passed}/{total}',
      proposalsPendingLabel: '待处理提案',
      nextAutoRunLabel: '下次自动运行',
      nextAutoRunDue: '已到期',
      runStatusPlanned: '仅计划',
      runStatusRunning: '运行中',
      runStatusChecked: '已检查·待生成提案',
      runStatusClosed: '已完成',
      runStatusStalled: '中断',
      runStatusFailed: '运行失败',
      runStatusUnknown: '未知',
      runStartedLabel: '开始',
      runFinishedLabel: '结束',
      tagAutoHint: '自动生成标签',

      tabArchive: '归档 Archive',
      tabPdca: '炼金 PDCA',
      tabProposals: '提案 Proposals',

      searchPlaceholder: '搜索标题、工作区、标签…',
      searchAria: '搜索会话',
      filterStatus: '状态',
      filterTag: '标签',
      filterAll: '全部',
      statusArchived: '归档',
      statusPinned: '置顶',
      statusTrash: '回收站',
      sessionsTotal: '{count} 个会话',
      noSessionsTitle: '还没有会话',
      noSessionsHint: '点击「同步」从 ~/.dsh/sessions 导入历史会话。',
      noMatchTitle: '没有匹配的会话',
      noMatchHint: '调整搜索或筛选条件，或点击刷新。',

      colTitle: '标题',
      colWorkspace: '工作区',
      colDate: '日期',
      colTurns: '轮次',
      colErrorRate: '错误率',
      colCorrections: '纠正',
      colTokens: 'Token',
      colContext: '上下文',
      sortAsc: '升序',
      sortDesc: '降序',

      sync: '同步',
      syncing: '同步中…',
      syncDone: '同步完成：新增 {imported}，刷新 {refreshed}，跳过 {skipped}，失败 {failed}',
      retag: '重算标签',
      retagging: '重算中…',
      retagDone: '自动标签已重算：{updated} 个会话，{tags} 个标签',

      selectSessionTitle: '选择一个会话',
      selectSessionHint: '在左侧选择会话，查看工具、耗时、上下文与转录。',
      detailFailed: '加载会话详情失败：{message}',
      factsEmpty: '该会话还没有派生统计。',

      factsCounters: '计数',
      factsTools: '工具',
      factsTurnEnds: '轮次结束',
      factsContext: '上下文与目录',
      factsTranscript: '转录摘录',

      counterEvents: '事件',
      counterTurns: '轮次',
      counterSteps: '步骤',
      counterUserMessages: '用户消息',
      counterHumanMessages: '人类消息',
      counterAssistantMessages: '助手消息',
      counterToolCalls: '工具调用',
      counterToolResults: '工具结果',
      counterToolErrors: '工具错误',
      counterLlmRetries: '模型重试',
      counterSubagents: '子代理',
      counterTeamTasks: '团队任务',
      counterApprovals: '审批',
      counterCommands: '命令',
      counterInterrupts: '中断',
      counterCompactions: '压缩',
      counterEdits: '编辑次数',
      counterChecks: '校验次数',
      counterAfterLastEditChecks: '末次编辑后校验',
      counterRepeated: '重复调用组',

      toolName: '工具',
      toolCallsShort: '调用',
      toolErrorsShort: '错误',
      toolRate: '错误率',
      toolResultBytes: '结果字节',
      toolErrorCodes: '错误码',
      toolsEmpty: '没有工具调用',

      turnEndCompleted: '完成',
      turnEndAborted: '中止',
      turnEndBlocked: '阻塞',
      turnEndError: '错误',
      turnEndMaxTokens: '超 Token',
      turnEndInterrupted: '被打断',
      turnEndForked: '分叉',
      turnEndsEmpty: '没有轮次结束记录',

      durationTotal: '总时长',
      durationMaxTurn: '最长轮次',
      durationMaxStep: '最长步骤',
      peakContext: '峰值上下文',
      peakInputTokens: '峰值输入 Token',
      contextWindow: '上下文窗口',
      catalogBytes: '目录字节',
      catalogToolCount: '目录工具数',
      skillCatalog: '技能目录',
      skillCatalogValue: '{bytes} 字节 / {entries} 项',

      transcriptHint: '仅用于阅读，转录不会被改写。',
      transcriptTruncated: '转录已截断',
      transcriptEmpty: '没有可显示的转录。',
      transcriptLoadMore: '加载更多',
      transcriptLoading: '加载中…',
      transcriptProgress: '已显示 {shown} / {total} 字符',
      transcriptAllLoaded: '已全部加载',
      transcriptLoadFailed: '加载更多失败：{message}',

      editTitle: '标题',
      editNote: '备注',
      editTags: '标签',
      editTagsHint: '用逗号分隔，最多 {count} 个',
      editStatus: '状态',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      nothingToSave: '没有需要保存的改动',
      delete: '删除',
      deleteConfirm: '再次点击确认删除',
      deleting: '删除中…',
      deleteDone: '已移入回收站',
      deleteHint: '只移除归档条目，不会修改 DSH 原始会话文件。',

      metaId: '会话 ID',
      metaWorkspace: '工作区',
      metaCreated: '创建于',
      metaUpdated: '更新于',
      metaOrigin: '来源',
      metaPreset: '预设',
      metaParent: '父会话',
      metaBytes: '文件字节',

      runPdca: '运行 PDCA',
      runningPdca: '运行中…',
      runDone: 'PDCA 运行完成',
      runsTitle: '运行记录',
      runsEmpty: '还没有 PDCA 运行',
      runsEmptyHint: '点击「运行 PDCA」分析归档中的会话。',
      runLoadFailed: '加载运行失败：{message}',
      selectRunTitle: '选择一个运行',
      selectRunHint: '在左侧选择运行，查看 Plan / Do / Check / Act 四个阶段。',
      phasePlan: 'Plan 计划',
      phaseDo: 'Do 执行',
      phaseCheck: 'Check 检查',
      phaseAct: 'Act 行动',
      phaseClosed: '已关闭',
      phaseUnknown: '未知阶段',
      phaseLabel: '阶段',

      cohortLabel: '队列',
      cohortDays: '最近 {days} 天',
      cohortAllDays: '全部时间',
      cohortLimit: '上限 {limit}',
      cohortTag: '标签 {tag}',
      cohortStatusLabel: '状态',
      cohortWorkspace: '工作区 {workspace}',
      targetsTitle: '目标',
      targetsEmpty: '没有目标',
      hypothesesTitle: '假设',
      hypothesesEmpty: '没有假设',
      baselineLabel: '基线',
      baselineNone: '无基线',

      doAnalyzed: '已分析 {count} 个会话',
      doCoverage: '覆盖',
      doRequested: '请求',
      doSkipped: '跳过',
      doFailures: '失败',
      doAnalyzedAt: '分析时间',
      doSessions: '会话',

      checkVerdicts: '判定',
      checkDeltas: '与基线对比',
      checkMetrics: '队列指标',
      verdictPass: '通过',
      verdictFail: '未达',
      verdictInconclusive: '无法判定',
      deltaImproved: '改善',
      deltaRegressed: '恶化',
      deltaFlat: '持平',
      deltaUnknown: '未知',
      metricName: '指标',
      targetValue: '目标',
      actualValue: '实际',
      beforeValue: '之前',
      afterValue: '之后',
      deltaValue: '变化',
      metricCorrectionRate: '纠正率',
      metricPeakContextP90: '上下文 P90',
      metricTokensPerTurn: '每轮 Token',
      metricTurnFailureRate: '轮次失败率',

      actFindings: '发现',
      findingsEmpty: '本次运行没有发现问题',
      severityHigh: '高',
      severityMedium: '中',
      severityLow: '低',
      adviceLabel: '建议',
      evidenceLabel: '证据',
      evidenceSeq: '序号 {seq}',
      evidenceOpen: '在归档中打开',
      evidenceEmpty: '没有证据',
      generateProposals: '生成提案',
      generatingProposals: '生成中…',
      regenerateProposals: '重新生成提案',
      proposalsGenerated: '已生成 {count} 条提案',
      proposalsGeneratedNone: '本次运行没有新增提案',
      proposalsReused: '没有新提案，复用已有 {count} 条',
      proposalIdsCount: '{count} 条提案',
      actEmpty: '还没有执行 Act',
      actHint: '点击「生成提案」把发现转成上下文补丁。',

      proposalsTitle: '提案',
      proposalsEmpty: '还没有提案',
      proposalsEmptyHint: '在「炼金 PDCA」标签页运行并生成提案。',
      proposalsForStatusEmpty: '该状态下没有提案',
      proposalsForStatusEmptyHint: '切换状态筛选，或重新生成提案。',
      proposalStatusFilter: '状态',
      proposalStatusProposed: '待处理',
      proposalStatusAdopted: '已采纳',
      proposalStatusRejected: '已拒绝',
      proposalStatusReverted: '已撤销',
      kindPromptSection: '提示词片段',
      kindAgentsMd: 'AGENTS.md 规则',
      kindSkill: '技能候选',
      kindAdvisory: '建议（仅文本）',
      riskLow: '低风险',
      riskMedium: '中风险',
      riskHigh: '高风险',
      expectedMetricLabel: '期望指标',
      effectDecrease: '下降',
      effectIncrease: '上升',
      evidenceCount: '{count} 条证据',
      adopt: '采纳',
      reject: '拒绝',
      revert: '撤销采纳',
      adoptedNotice: '已采纳',
      rejectedNotice: '已拒绝',
      revertedNotice: '已撤销采纳',
      adoptAdvisoryHint: '建议类提案不改动任何文件，无法采纳。',
      adoptStatusHint: '只有待处理的提案可以采纳。',
      revertStatusHint: '只有已采纳的提案可以撤销。',
      rejectStatusHint: '只有待处理的提案可以拒绝。',
      proposalTargetLabel: '写入目标',
      proposalBodyLabel: '正文',
      proposalRationaleLabel: '理由',
      proposalRunLabel: '所属运行',
      proposalEvalLabel: '采纳评估',
      proposalBodyEmpty: '没有正文',
    };

    const en = {
      panelTitle: 'Archive · Alchemy',
      title: 'Archive & Alchemy RSI',
      subtitle: 'Session archive, PDCA measurement, and context-patch proposals',
      refresh: 'Refresh',
      loading: 'Loading…',
      retry: 'Retry',
      requestTimeout: 'Request timed out',
      emptyResponse: 'The archive route returned an empty response',
      httpError: 'Request failed (HTTP {status})',
      loadFailed: 'Failed to load: {message}',
      actionFailed: 'Action failed: {message}',
      unset: '—',
      untitledSession: '(untitled session)',

      metricsAria: 'Archive overview metrics',
      metricCorpus: 'Corpus size',
      metricSessions: 'Sessions',
      metricToolErrorRate: 'Tool error rate',
      metricVerificationGap: 'Verification gap',
      metricCatalogBytes: 'Catalog bytes',
      metricTokens: 'Tokens',
      metricFromLatestRun: 'Cohort metric from the latest PDCA run',

      alchemyStatus: 'Alchemy status',
      alchemyStatusAria: 'Alchemy run status',
      alchemyRunning: 'Running',
      alchemyIdle: 'Idle',
      alchemyStalled: 'Last run stalled',
      alchemyNeverRun: 'Not run yet',
      lastRunLabel: 'Last run',
      runDurationLabel: 'Duration',
      runTargetsLabel: 'Targets met {passed}/{total}',
      proposalsPendingLabel: 'Pending proposals',
      nextAutoRunLabel: 'Next auto run',
      nextAutoRunDue: 'Due now',
      runStatusPlanned: 'Planned only',
      runStatusRunning: 'Running',
      runStatusChecked: 'Checked',
      runStatusClosed: 'Completed',
      runStatusStalled: 'Stalled',
      runStatusFailed: 'Failed',
      runStatusUnknown: 'Unknown',
      runStartedLabel: 'Started',
      runFinishedLabel: 'Finished',
      tagAutoHint: 'Auto-generated tag',

      tabArchive: 'Archive',
      tabPdca: 'Alchemy PDCA',
      tabProposals: 'Proposals',

      searchPlaceholder: 'Search title, workspace, tags…',
      searchAria: 'Search sessions',
      filterStatus: 'Status',
      filterTag: 'Tag',
      filterAll: 'All',
      statusArchived: 'Archived',
      statusPinned: 'Pinned',
      statusTrash: 'Trash',
      sessionsTotal: '{count} sessions',
      noSessionsTitle: 'No sessions yet',
      noSessionsHint: 'Click Sync to import sessions from ~/.dsh/sessions.',
      noMatchTitle: 'No matching sessions',
      noMatchHint: 'Change the search or filter, or refresh.',

      colTitle: 'Title',
      colWorkspace: 'Workspace',
      colDate: 'Date',
      colTurns: 'Turns',
      colErrorRate: 'Error rate',
      colCorrections: 'Corrections',
      colTokens: 'Tokens',
      colContext: 'Context',
      sortAsc: 'ascending',
      sortDesc: 'descending',

      sync: 'Sync',
      syncing: 'Syncing…',
      syncDone: 'Sync finished: {imported} imported, {refreshed} refreshed, {skipped} skipped, {failed} failed',
      retag: 'Re-derive tags',
      retagging: 'Tagging…',
      retagDone: 'Automatic tags re-derived: {updated} sessions, {tags} tags',

      selectSessionTitle: 'Select a session',
      selectSessionHint: 'Pick a session on the left to inspect tools, durations, context, and transcript.',
      detailFailed: 'Failed to load the session: {message}',
      factsEmpty: 'No derived facts for this session yet.',

      factsCounters: 'Counters',
      factsTools: 'Tools',
      factsTurnEnds: 'Turn ends',
      factsContext: 'Context and catalog',
      factsTranscript: 'Transcript excerpt',

      counterEvents: 'Events',
      counterTurns: 'Turns',
      counterSteps: 'Steps',
      counterUserMessages: 'User messages',
      counterHumanMessages: 'Human messages',
      counterAssistantMessages: 'Assistant messages',
      counterToolCalls: 'Tool calls',
      counterToolResults: 'Tool results',
      counterToolErrors: 'Tool errors',
      counterLlmRetries: 'LLM retries',
      counterSubagents: 'Subagents',
      counterTeamTasks: 'Team tasks',
      counterApprovals: 'Approvals',
      counterCommands: 'Commands',
      counterInterrupts: 'Interrupts',
      counterCompactions: 'Compactions',
      counterEdits: 'Edits',
      counterChecks: 'Checks',
      counterAfterLastEditChecks: 'Checks after last edit',
      counterRepeated: 'Repeated call groups',

      toolName: 'Tool',
      toolCallsShort: 'Calls',
      toolErrorsShort: 'Errors',
      toolRate: 'Error rate',
      toolResultBytes: 'Result bytes',
      toolErrorCodes: 'Error codes',
      toolsEmpty: 'No tool calls',

      turnEndCompleted: 'Completed',
      turnEndAborted: 'Aborted',
      turnEndBlocked: 'Blocked',
      turnEndError: 'Error',
      turnEndMaxTokens: 'Max tokens',
      turnEndInterrupted: 'Interrupted',
      turnEndForked: 'Forked',
      turnEndsEmpty: 'No turn end records',

      durationTotal: 'Total',
      durationMaxTurn: 'Longest turn',
      durationMaxStep: 'Longest step',
      peakContext: 'Peak context',
      peakInputTokens: 'Peak input tokens',
      contextWindow: 'Context window',
      catalogBytes: 'Catalog bytes',
      catalogToolCount: 'Catalog tools',
      skillCatalog: 'Skill catalog',
      skillCatalogValue: '{bytes} bytes / {entries} entries',

      transcriptHint: 'Read-only excerpt; the transcript is never rewritten.',
      transcriptTruncated: 'Transcript truncated',
      transcriptEmpty: 'No transcript available.',
      transcriptLoadMore: 'Load more',
      transcriptLoading: 'Loading…',
      transcriptProgress: 'Showing {shown} / {total} characters',
      transcriptAllLoaded: 'All loaded',
      transcriptLoadFailed: 'Failed to load more: {message}',

      editTitle: 'Title',
      editNote: 'Note',
      editTags: 'Tags',
      editTagsHint: 'Comma separated, at most {count}',
      editStatus: 'Status',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      nothingToSave: 'Nothing to save',
      delete: 'Delete',
      deleteConfirm: 'Click again to confirm deletion',
      deleting: 'Deleting…',
      deleteDone: 'Moved to trash',
      deleteHint: 'Removes the archive entry only; the DSH session file is not modified.',

      metaId: 'Session id',
      metaWorkspace: 'Workspace',
      metaCreated: 'Created',
      metaUpdated: 'Updated',
      metaOrigin: 'Origin',
      metaPreset: 'Preset',
      metaParent: 'Parent session',
      metaBytes: 'File bytes',

      runPdca: 'Run PDCA',
      runningPdca: 'Running…',
      runDone: 'PDCA run finished',
      runsTitle: 'Runs',
      runsEmpty: 'No PDCA runs yet',
      runsEmptyHint: 'Click Run PDCA to analyze the archived sessions.',
      runLoadFailed: 'Failed to load the run: {message}',
      selectRunTitle: 'Select a run',
      selectRunHint: 'Pick a run on the left to inspect Plan / Do / Check / Act.',
      phasePlan: 'Plan',
      phaseDo: 'Do',
      phaseCheck: 'Check',
      phaseAct: 'Act',
      phaseClosed: 'Closed',
      phaseUnknown: 'Unknown phase',
      phaseLabel: 'Phase',

      cohortLabel: 'Cohort',
      cohortDays: 'Last {days} days',
      cohortAllDays: 'All time',
      cohortLimit: 'Limit {limit}',
      cohortTag: 'Tag {tag}',
      cohortStatusLabel: 'Status',
      cohortWorkspace: 'Workspace {workspace}',
      targetsTitle: 'Targets',
      targetsEmpty: 'No targets',
      hypothesesTitle: 'Hypotheses',
      hypothesesEmpty: 'No hypotheses',
      baselineLabel: 'Baseline',
      baselineNone: 'No baseline',

      doAnalyzed: '{count} sessions analyzed',
      doCoverage: 'Coverage',
      doRequested: 'Requested',
      doSkipped: 'Skipped',
      doFailures: 'Failures',
      doAnalyzedAt: 'Analyzed at',
      doSessions: 'Sessions',

      checkVerdicts: 'Verdicts',
      checkDeltas: 'Against baseline',
      checkMetrics: 'Cohort metrics',
      verdictPass: 'Pass',
      verdictFail: 'Fail',
      verdictInconclusive: 'Inconclusive',
      deltaImproved: 'Improved',
      deltaRegressed: 'Regressed',
      deltaFlat: 'Flat',
      deltaUnknown: 'Unknown',
      metricName: 'Metric',
      targetValue: 'Target',
      actualValue: 'Actual',
      beforeValue: 'Before',
      afterValue: 'After',
      deltaValue: 'Delta',
      metricCorrectionRate: 'Correction rate',
      metricPeakContextP90: 'Context P90',
      metricTokensPerTurn: 'Tokens per turn',
      metricTurnFailureRate: 'Turn failure rate',

      actFindings: 'Findings',
      findingsEmpty: 'This run found no issues',
      severityHigh: 'High',
      severityMedium: 'Medium',
      severityLow: 'Low',
      adviceLabel: 'Advice',
      evidenceLabel: 'Evidence',
      evidenceSeq: 'seq {seq}',
      evidenceOpen: 'Open in archive',
      evidenceEmpty: 'No evidence',
      generateProposals: 'Generate proposals',
      generatingProposals: 'Generating…',
      regenerateProposals: 'Regenerate proposals',
      proposalsGenerated: '{count} proposals generated',
      proposalsGeneratedNone: 'No new proposals from this run',
      proposalsReused: 'No new proposals; reused {count} existing',
      proposalIdsCount: '{count} proposals',
      actEmpty: 'Act has not run yet',
      actHint: 'Click Generate proposals to turn findings into context patches.',

      proposalsTitle: 'Proposals',
      proposalsEmpty: 'No proposals yet',
      proposalsEmptyHint: 'Run PDCA and generate proposals in the Alchemy tab.',
      proposalsForStatusEmpty: 'No proposals with this status',
      proposalsForStatusEmptyHint: 'Change the status filter, or generate proposals again.',
      proposalStatusFilter: 'Status',
      proposalStatusProposed: 'Proposed',
      proposalStatusAdopted: 'Adopted',
      proposalStatusRejected: 'Rejected',
      proposalStatusReverted: 'Reverted',
      kindPromptSection: 'Prompt section',
      kindAgentsMd: 'AGENTS.md rule',
      kindSkill: 'Skill candidate',
      kindAdvisory: 'Advisory only',
      riskLow: 'Low risk',
      riskMedium: 'Medium risk',
      riskHigh: 'High risk',
      expectedMetricLabel: 'Expected metric',
      effectDecrease: 'decrease',
      effectIncrease: 'increase',
      evidenceCount: '{count} evidence items',
      adopt: 'Adopt',
      reject: 'Reject',
      revert: 'Revert',
      adoptedNotice: 'Adopted',
      rejectedNotice: 'Rejected',
      revertedNotice: 'Reverted',
      adoptAdvisoryHint: 'Advisory proposals touch no file and cannot be adopted.',
      adoptStatusHint: 'Only proposed items can be adopted.',
      revertStatusHint: 'Only adopted items can be reverted.',
      rejectStatusHint: 'Only proposed items can be rejected.',
      proposalTargetLabel: 'Writes to',
      proposalBodyLabel: 'Body',
      proposalRationaleLabel: 'Rationale',
      proposalRunLabel: 'Run',
      proposalEvalLabel: 'Adoption evaluation',
      proposalBodyEmpty: 'No body text',
    };

    let runtime = null;

    function interpolate(template, vars) {
      if (!vars) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        (vars[name] === undefined ? match : String(vars[name])));
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
      // The dictionary is resolved per call: the sidebar re-reads its label
      // thunk during a locale publish, possibly before any subscriber cache moves.
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

    // Only the five hooks the loader stub guarantees: a locale publish forces a
    // re-render, and `tr` re-resolves the dictionary on the next pass.
    function useLocale() {
      const [revision, setRevision] = React.useState(0);
      React.useEffect(() => subscribeLocale(() => setRevision((value) => value + 1)), []);
      const active = snapshot().active;
      return {
        revision,
        t: runtime && typeof runtime.t === 'function' ? runtime.t : fallbackTranslate,
        localeId: typeof active === 'string' && active ? active : 'en',
      };
    }

    // --------------------------------------------------------------- formatting

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function toNumber(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }

    function asCount(value, fallback) {
      const number = toNumber(value);
      if (number !== null) return number;
      return typeof fallback === 'number' ? fallback : 0;
    }

    function toTime(value) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    }

    // Values from the API may be scalars, lists, or nested records. Never hand a
    // raw object to React.
    function textOf(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join(' ');
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch (_error) {
          return '';
        }
      }
      return String(value);
    }

    function pick(source, keys, fallback) {
      const object = source && typeof source === 'object' ? source : {};
      for (const key of keys) {
        const value = object[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
      return fallback;
    }

    function pickArray(source, keys) {
      const object = source && typeof source === 'object' ? source : {};
      for (const key of keys) {
        if (Array.isArray(object[key])) return object[key];
      }
      return [];
    }

    function formatInt(value, localeId) {
      const number = toNumber(value);
      if (number === null) return '—';
      try {
        return new Intl.NumberFormat(localeId || 'en', { maximumFractionDigits: 0 }).format(number);
      } catch (_error) {
        return String(Math.round(number));
      }
    }

    function formatCompact(value, localeId) {
      const number = toNumber(value);
      if (number === null) return '—';
      try {
        return new Intl.NumberFormat(localeId || 'en', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(number);
      } catch (_error) {
        return String(Math.round(number));
      }
    }

    function formatPercent(value, digits) {
      const number = toNumber(value);
      if (number === null) return '—';
      return (number * 100).toFixed(digits === undefined ? 1 : digits) + '%';
    }

    function formatBytes(value) {
      const number = toNumber(value);
      if (number === null) return '—';
      if (number < 1024) return Math.round(number) + ' B';
      const units = ['KiB', 'MiB', 'GiB', 'TiB'];
      let size = number / 1024;
      let index = 0;
      while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
      }
      return (size >= 100 ? size.toFixed(0) : size.toFixed(1)) + ' ' + units[index];
    }

    function formatDuration(value) {
      const number = toNumber(value);
      if (number === null) return '—';
      if (number < 1000) return Math.round(number) + ' ms';
      if (number < 60000) return (number / 1000).toFixed(1) + ' s';
      const minutes = number / 60000;
      if (minutes < 60) return minutes.toFixed(1) + ' min';
      return (minutes / 60).toFixed(1) + ' h';
    }

    function formatDate(value, localeId) {
      const time = toTime(value);
      if (time === null) return '';
      try {
        return new Date(time).toLocaleString(localeId || 'en');
      } catch (_error) {
        return new Date(time).toISOString();
      }
    }

    function formatDateShort(value, localeId) {
      const time = toTime(value);
      if (time === null) return '';
      try {
        return new Date(time).toLocaleString(localeId || 'en', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch (_error) {
        return new Date(time).toISOString().slice(0, 16).replace('T', ' ');
      }
    }

    // Relative time is a nicety, not data: an old engine or an odd locale must
    // fall back to the absolute date instead of throwing inside render.
    function formatRelativeTime(value, localeId) {
      const time = toTime(value);
      if (time === null) return '';
      const deltaMs = time - Date.now();
      const absolute = Math.abs(deltaMs);
      const minute = 60000;
      const hour = 60 * minute;
      const day = 24 * hour;
      let amount;
      let unit;
      if (absolute < hour) {
        amount = Math.round(deltaMs / minute);
        unit = 'minute';
      } else if (absolute < day) {
        amount = Math.round(deltaMs / hour);
        unit = 'hour';
      } else {
        amount = Math.round(deltaMs / day);
        unit = 'day';
      }
      try {
        const formatter = new Intl.RelativeTimeFormat(localeId || 'en', { numeric: 'auto' });
        const formatted = formatter.format(amount, unit);
        if (typeof formatted === 'string' && formatted) return formatted;
      } catch (_error) {
        // fall through to the absolute date
      }
      return formatDate(time, localeId);
    }

    function shortPath(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return '';
      const parts = text.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 2) return text;
      return '…/' + parts.slice(-2).join('/');
    }

    function shortId(value) {
      const text = textOf(value);
      if (!text) return '';
      return text.length > 10 ? text.slice(0, 8) + '…' : text;
    }

    // -------------------------------------------------------------------- api

    // One fetch helper for the whole panel. It never throws: a failed route comes
    // back as {ok:false,message} so the caller can render an inline banner.
    async function api(path, options) {
      const settings = options || {};
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller && typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        : null;
      try {
        const response = await fetch(API_PREFIX + path, {
          method: settings.method || 'GET',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
          credentials: 'same-origin',
          signal: controller ? controller.signal : undefined,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload && payload.error && payload.error.message
            ? String(payload.error.message)
            : tr('httpError', { status: response.status });
          return { ok: false, message };
        }
        if (!payload) return { ok: false, message: tr('emptyResponse') };
        if (payload.ok === false) {
          return {
            ok: false,
            message: (payload.error && payload.error.message) || tr('emptyResponse'),
          };
        }
        return { ok: true, data: payload.data === undefined ? payload : payload.data };
      } catch (error) {
        if (error && error.name === 'AbortError') return { ok: false, message: tr('requestTimeout') };
        return { ok: false, message: (error && error.message) || String(error) };
      } finally {
        if (timer !== null && typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
          window.clearTimeout(timer);
        }
      }
    }

    // Load one transcript window. `offset` is the number of characters already
    // shown; the server returns the next slice so the viewer can append it.
    async function fetchTranscriptChunk(sessionId, offset, maxChars) {
      return api('/sessions/' + encodeURIComponent(sessionId)
        + '?transcript=1&maxChars=' + String(maxChars)
        + '&offset=' + String(offset));
    }

    // ------------------------------------------------------------------- icons

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

    const AlertIcon = (props) => icon([
      h('path', { key: 'a', d: 'M12 4 21 20H3z' }),
      h('path', { key: 'b', d: 'M12 10v4.5' }),
      h('path', { key: 'c', d: 'M12 17.2v.2' }),
    ], props && props.size);

    const ArchiveIcon = (props) => icon([
      h('rect', { key: 'a', x: 3.5, y: 4.5, width: 17, height: 4, rx: 1.2 }),
      h('path', { key: 'b', d: 'M5 8.5v9A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5v-9' }),
      h('path', { key: 'c', d: 'M10 12.5h4' }),
      h('path', { key: 'd', d: 'M12 15.5v3' }),
      h('path', { key: 'e', d: 'm10.4 16.9 1.6-1.6 1.6 1.6' }),
    ], props && props.size);

    const BeakerIcon = (props) => icon([
      h('path', { key: 'a', d: 'M9.5 3.5h5' }),
      h('path', { key: 'b', d: 'M10.6 3.5v4.9L6.4 18.6a1.6 1.6 0 0 0 1.5 2.3h8.2a1.6 1.6 0 0 0 1.5-2.3l-4.2-10.2V3.5' }),
      h('path', { key: 'c', d: 'M8.2 14.5h7.6' }),
    ], props && props.size);

    const ProposalIcon = (props) => icon([
      h('path', { key: 'a', d: 'M7 3.5h7l4 4V20.5H7z' }),
      h('path', { key: 'b', d: 'M14 3.5v4h4' }),
      h('path', { key: 'c', d: 'M9.5 12h6' }),
      h('path', { key: 'd', d: 'M9.5 15.5h4' }),
    ], props && props.size);

    const PlayIcon = (props) => icon([
      h('path', { key: 'a', d: 'M8.5 5.6 19 12 8.5 18.4z' }),
    ], props && props.size);

    const TrashIcon = (props) => icon([
      h('path', { key: 'a', d: 'M4.5 6.5h15' }),
      h('path', { key: 'b', d: 'M9.5 6.5V4.8h5v1.7' }),
      h('path', { key: 'c', d: 'M6.5 6.5 7.4 20h9.2l.9-13.5' }),
      h('path', { key: 'd', d: 'M10.2 10.5v6' }),
      h('path', { key: 'e', d: 'M13.8 10.5v6' }),
    ], props && props.size);

    const CheckIcon = (props) => icon([
      h('path', { key: 'a', d: 'm5 12.5 4.5 4.5L19 7.5' }),
    ], props && props.size);

    const SyncIcon = (props) => icon([
      h('path', { key: 'a', d: 'M4 12a8 8 0 0 1 13.7-5.6L20 8.5' }),
      h('path', { key: 'b', d: 'M20 4v4.5h-4.5' }),
      h('path', { key: 'c', d: 'M20 12a8 8 0 0 1-13.7 5.6L4 15.5' }),
      h('path', { key: 'd', d: 'M4 20v-4.5h4.5' }),
    ], props && props.size);

    function Spinner() {
      return h('span', { className: 'dsh-archive-rsi-spinner', 'aria-hidden': true });
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
        h('rect', { key: 'a', x: 3.5, y: 4.5, width: 17, height: 4, rx: 1.2 }),
        h('path', { key: 'b', d: 'M5 8.5v9A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5v-9' }),
        h('path', { key: 'c', d: 'M10 13.5h4' }),
        h('path', { key: 'd', d: 'M12 16.5v3' }),
        h('path', { key: 'e', d: 'm10.4 17.9 1.6-1.6 1.6 1.6' }),
      );
    }

    // --------------------------------------------------------------- normalize

    function normalizeMetrics(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        turns: toNumber(source.turns),
        steps: toNumber(source.steps),
        toolCalls: toNumber(source.toolCalls),
        toolErrors: toNumber(source.toolErrors),
        toolErrorRate: toNumber(source.toolErrorRate),
        corrections: toNumber(source.corrections),
        peakContextRatio: toNumber(source.peakContextRatio),
        totalTokens: toNumber(source.totalTokens),
        durationMs: toNumber(source.durationMs),
      };
    }

    function normalizeEntry(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        id: textOf(pick(source, ['id', 'sessionId'], '')),
        title: textOf(source.title),
        workspace: textOf(source.workspace),
        slug: textOf(source.slug),
        status: textOf(source.status) || 'archived',
        note: textOf(source.note),
        tags: asArray(source.tags).map((tag) => textOf(tag)).filter(Boolean),
        createdAt: toTime(pick(source, ['createdAt', 'created_at'], null)),
        updatedAt: toTime(pick(source, ['updatedAt', 'updated_at'], null)),
        bytes: toNumber(source.bytes),
        origin: textOf(source.origin),
        agentPreset: textOf(source.agentPreset) || textOf(source.agent_preset),
        parentSession: textOf(source.parentSession) || textOf(source.parent_session),
        eventCount: toNumber(source.eventCount),
        frameCount: toNumber(source.frameCount),
        metrics: normalizeMetrics(source.metrics),
      };
    }

    function asBool(value) {
      return value === true || value === 1 || value === 'true' || value === 'yes';
    }

    // `lastRun` is the single run the alchemy strip talks about. Anything the
    // route omits degrades to null so the strip can simply skip that field.
    function normalizeLastRun(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const targets = raw.targets && typeof raw.targets === 'object' ? raw.targets : {};
      return {
        id: textOf(pick(raw, ['id', 'runId', 'run_id'], '')),
        status: textOf(raw.status),
        phase: textOf(raw.phase),
        createdAt: toTime(pick(raw, ['createdAt', 'created_at'], null)),
        updatedAt: toTime(pick(raw, ['updatedAt', 'updated_at'], null)),
        startedAt: toTime(pick(raw, ['startedAt', 'started_at'], null)),
        finishedAt: toTime(pick(raw, ['finishedAt', 'finished_at'], null)),
        durationMs: toNumber(pick(raw, ['durationMs', 'duration', 'elapsedMs'], null)),
        running: asBool(raw.running),
        stalled: asBool(raw.stalled),
        targets: {
          passed: toNumber(targets.passed),
          total: toNumber(targets.total),
        },
        findings: toNumber(raw.findings),
        proposals: toNumber(raw.proposals),
      };
    }

    function normalizeAutoRun(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        enabled: asBool(source.enabled),
        everyDays: toNumber(pick(source, ['everyDays', 'every_days'], null)),
        dueAt: toTime(pick(source, ['dueAt', 'due_at'], null)),
        due: asBool(source.due),
      };
    }

    function normalizeOverview(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const corpus = source.corpus && typeof source.corpus === 'object' ? source.corpus : {};
      const metrics = source.metrics && typeof source.metrics === 'object' ? source.metrics : {};
      const merged = {};
      for (const bag of [metrics, corpus.metrics, corpus, source]) {
        if (!bag || typeof bag !== 'object') continue;
        for (const key of Object.keys(bag)) {
          if (merged[key] === undefined) merged[key] = bag[key];
        }
      }
      return {
        sessions: toNumber(pick(merged, ['sessions', 'sessionCount', 'count'], null)),
        corpusBytes: toNumber(pick(merged,
          ['bytes', 'sizeBytes', 'corpusBytes', 'totalBytes', 'diskBytes'], null)),
        toolErrorRate: toNumber(pick(merged, ['toolErrorRate', 'tool_error_rate'], null)),
        verificationGapRate: toNumber(pick(merged, ['verificationGapRate'], null)),
        catalogBytes: toNumber(pick(merged, ['catalogBytes'], null)),
        totalTokens: toNumber(pick(merged, ['totalTokens', 'tokens'], null)),
        turns: toNumber(merged.turns),
        toolCalls: toNumber(merged.toolCalls),
        archived: toNumber(merged.archived),
        pinned: toNumber(merged.pinned),
        trash: toNumber(merged.trash),
        harnessArchived: toNumber(merged.harnessArchived),
        tags: asArray(pick(merged, ['tags'], [])).map((tag) => textOf(tag)).filter(Boolean),
        workspaces: asArray(pick(merged, ['workspaces'], [])).map((item) => textOf(item)).filter(Boolean),
        proposals: {
          proposed: toNumber(pick(source.proposals, ['proposed'], null)),
          adopted: toNumber(pick(source.proposals, ['adopted'], null)),
        },
        root: textOf(source.root),
        openProposals: toNumber(pick(source, ['openProposals'], null)),
        lastRun: normalizeLastRun(source.lastRun),
        autoRun: normalizeAutoRun(source.autoRun),
      };
    }

    function normalizeFacts(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const counters = raw.counters && typeof raw.counters === 'object' ? raw.counters : {};
      const catalog = raw.catalog && typeof raw.catalog === 'object' ? raw.catalog : {};
      const skillCatalog = raw.skillCatalog && typeof raw.skillCatalog === 'object' ? raw.skillCatalog : {};
      const usage = raw.usage && typeof raw.usage === 'object' ? raw.usage : {};
      const durations = raw.durations && typeof raw.durations === 'object' ? raw.durations : {};
      const edits = raw.edits && typeof raw.edits === 'object' ? raw.edits : {};
      const checks = raw.checks && typeof raw.checks === 'object' ? raw.checks : {};
      return {
        sessionId: textOf(raw.sessionId),
        createdAt: toTime(raw.createdAt),
        endedAt: toTime(raw.endedAt),
        title: textOf(raw.title),
        counters: {
          events: asCount(counters.events),
          turns: asCount(counters.turns),
          steps: asCount(counters.steps),
          userMessages: asCount(counters.userMessages),
          humanMessages: asCount(counters.humanMessages),
          assistantMessages: asCount(counters.assistantMessages),
          toolCalls: asCount(counters.toolCalls),
          toolResults: asCount(counters.toolResults),
          toolErrors: asCount(counters.toolErrors),
          llmRetries: asCount(counters.llmRetries),
          subagentDescriptors: asCount(counters.subagentDescriptors),
          teamTasks: asCount(counters.teamTasks),
          approvals: asCount(counters.approvals),
          commands: asCount(counters.commands),
          interrupts: asCount(counters.interrupts),
          compactions: asCount(counters.compactions),
        },
        tools: asArray(raw.tools).map((row) => ({
          name: textOf(pick(row, ['name'], '')),
          calls: asCount(row && row.calls),
          errors: asCount(row && row.errors),
          resultBytes: asCount(row && row.resultBytes),
          errorCodes: row && row.errorCodes && typeof row.errorCodes === 'object' ? row.errorCodes : {},
        })),
        catalog: { bytes: asCount(catalog.bytes), toolCount: asCount(catalog.toolCount) },
        skillCatalog: { bytes: asCount(skillCatalog.bytes), entries: asCount(skillCatalog.entries) },
        usage: {
          inputTokens: asCount(usage.inputTokens),
          outputTokens: asCount(usage.outputTokens),
          totalTokens: asCount(usage.totalTokens),
        },
        contextWindow: asCount(raw.contextWindow),
        peakInputTokens: asCount(raw.peakInputTokens),
        peakContextRatio: asCount(raw.peakContextRatio),
        turnEnds: raw.turnEnds && typeof raw.turnEnds === 'object' ? raw.turnEnds : {},
        durations: {
          totalMs: asCount(durations.totalMs),
          maxTurnMs: asCount(durations.maxTurnMs),
          maxStepMs: asCount(durations.maxStepMs),
        },
        edits: { count: asCount(edits.count) },
        checks: { count: asCount(checks.count) },
        afterLastEditChecks: asCount(raw.afterLastEditChecks),
        repeated: asArray(raw.repeated),
        errorSamples: asArray(raw.errorSamples),
        interrupted: Boolean(raw.interrupted),
      };
    }

    function normalizeTarget(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        metric: textOf(source.metric),
        op: textOf(source.op),
        value: toNumber(source.value),
      };
    }

    function normalizeHypothesis(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        id: textOf(source.id),
        statement: textOf(source.statement),
        metric: textOf(source.metric),
        expected: textOf(source.expected),
      };
    }

    function normalizeVerdict(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        metric: textOf(source.metric),
        op: textOf(source.op),
        target: toNumber(source.target),
        actual: toNumber(source.actual),
        verdict: textOf(source.verdict) || 'inconclusive',
      };
    }

    function normalizeDelta(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        metric: textOf(source.metric),
        before: toNumber(source.before),
        after: toNumber(source.after),
        delta: toNumber(source.delta),
        verdict: textOf(source.verdict) || 'unknown',
      };
    }

    function normalizeEvidence(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        sessionId: textOf(pick(source, ['sessionId', 'session_id'], '')),
        seq: toNumber(source.seq),
      };
    }

    function normalizeFinding(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        id: textOf(source.id),
        rule: textOf(source.rule),
        severity: textOf(source.severity) || 'medium',
        title: textOf(source.title),
        detail: textOf(source.detail),
        metric: textOf(source.metric),
        tool: textOf(source.tool),
        count: toNumber(source.count),
        advice: textOf(source.advice),
        evidence: asArray(source.evidence).map(normalizeEvidence),
      };
    }

    // Target pass tally for one run. `/runs` has no `targets` object today, so
    // fall back to the check verdicts (one per target once a run is checked).
    function runTargets(source, check) {
      const raw = source && source.targets && typeof source.targets === 'object' ? source.targets : null;
      if (raw) {
        const total = toNumber(raw.total);
        return { passed: toNumber(raw.passed), total };
      }
      const verdicts = asArray(check && check.verdicts);
      if (verdicts.length === 0) return { passed: null, total: null };
      let passed = 0;
      for (const verdict of verdicts) {
        const value = textOf(verdict && verdict.verdict);
        if (value === 'pass') passed += 1;
      }
      return { passed, total: verdicts.length };
    }

    function normalizeRun(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const cohort = source.cohort && typeof source.cohort === 'object' ? source.cohort : {};
      const plan = source.plan && typeof source.plan === 'object' ? source.plan : {};
      const doPhase = source.do && typeof source.do === 'object' ? source.do : {};
      const coverage = doPhase.coverage && typeof doPhase.coverage === 'object' ? doPhase.coverage : {};
      const check = source.check && typeof source.check === 'object' ? source.check : {};
      const act = source.act && typeof source.act === 'object' ? source.act : {};
      const metrics = check.metrics && typeof check.metrics === 'object' ? check.metrics : {};
      const normalizedMetrics = {};
      for (const key of Object.keys(metrics)) {
        const value = toNumber(metrics[key]);
        normalizedMetrics[key] = value === null ? metrics[key] : value;
      }
      // `/runs` sends the stored run, which carries the timestamps but not the
      // derived duration, so the list can still show 用时 without a new field.
      const createdAt = toTime(source.createdAt);
      const finishedAt = toTime(source.finishedAt);
      const updatedAt = toTime(source.updatedAt);
      // Rows come from `/runs`, which stores the raw run: derive the lifecycle
      // status the same way alchemy.summarizeRun does, and age a `running` marker
      // into `stalled` so the row badge cannot contradict the status strip.
      const rawStatus = textOf(source.status);
      const phase = textOf(source.phase);
      const phaseStatus = rawStatus || (phase === 'closed'
        ? 'closed'
        : phase === 'act' || phase === 'check'
          ? 'checked'
          : phase === 'do'
            ? 'running'
            : 'planned');
      const stale = phaseStatus === 'running' && updatedAt !== null && Date.now() - updatedAt > RUN_STALE_MS;
      const rowStatus = stale ? 'stalled' : phaseStatus;
      const declaredDuration = toNumber(source.durationMs);
      const durationMs = declaredDuration !== null
        ? declaredDuration
        : finishedAt !== null && createdAt !== null
          ? Math.max(0, finishedAt - createdAt)
          : null;
      return {
        id: textOf(pick(source, ['id', 'runId', 'run_id'], '')),
        status: rowStatus,
        createdAt,
        updatedAt,
        startedAt: toTime(source.startedAt),
        finishedAt,
        durationMs,
        phase: textOf(source.phase) || 'plan',
        // A run's own target tally is not on the wire yet: prefer it when the
        // route sends one, otherwise derive it from the check verdicts, which
        // are one per target after a checked run.
        targets: runTargets(source, check),
        cohort: {
          days: toNumber(cohort.days),
          workspace: textOf(cohort.workspace),
          tag: textOf(cohort.tag),
          status: textOf(cohort.status),
          limit: toNumber(cohort.limit),
        },
        plan: {
          baselineRunId: textOf(plan.baselineRunId),
          targets: asArray(plan.targets).map(normalizeTarget),
          hypotheses: asArray(plan.hypotheses).map(normalizeHypothesis),
        },
        do: {
          sessionIds: asArray(doPhase.sessionIds).map((id) => textOf(id)).filter(Boolean),
          analyzedAt: toTime(doPhase.analyzedAt),
          coverage: {
            requested: toNumber(coverage.requested),
            analyzed: toNumber(coverage.analyzed),
            skipped: toNumber(coverage.skipped),
            failures: asArray(coverage.failures),
          },
        },
        check: {
          metrics: normalizedMetrics,
          verdicts: asArray(check.verdicts).map(normalizeVerdict),
          deltas: asArray(check.deltas).map(normalizeDelta),
        },
        act: {
          findings: asArray(act.findings).map(normalizeFinding),
          proposalIds: asArray(act.proposalIds).map((id) => textOf(id)).filter(Boolean),
        },
      };
    }

    function normalizeProposal(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const evaluation = source.evaluation && typeof source.evaluation === 'object'
        ? source.evaluation
        : null;
      return {
        id: textOf(pick(source, ['id', 'proposalId', 'proposal_id'], '')),
        runId: textOf(source.runId),
        findingIds: asArray(source.findingIds).map((id) => textOf(id)).filter(Boolean),
        kind: textOf(source.kind) || 'advisory',
        target: textOf(source.target),
        title: textOf(source.title),
        rationale: textOf(source.rationale),
        body: typeof source.body === 'string' ? source.body : textOf(source.body),
        expectedMetric: textOf(source.expectedMetric),
        expectedEffect: textOf(source.expectedEffect),
        risk: textOf(source.risk) || 'low',
        status: textOf(source.status) || 'proposed',
        createdAt: toTime(source.createdAt),
        adoptedAt: toTime(source.adoptedAt),
        rejectedAt: toTime(source.rejectedAt),
        revertedAt: toTime(source.revertedAt),
        evidence: asArray(source.evidence).map(normalizeEvidence),
        evaluation: evaluation
          ? {
            verdict: textOf(evaluation.verdict),
            metric: textOf(evaluation.metric),
            delta: toNumber(evaluation.delta),
            evaluatedAt: toTime(evaluation.evaluatedAt),
          }
          : null,
      };
    }

    // --------------------------------------------------------------- small bits

    function Banner(props) {
      return h('div', { className: 'dsh-archive-rsi-banner', role: 'alert' },
        h(AlertIcon, { size: 14 }),
        h('span', { className: 'dsh-archive-rsi-bannerText' }, props.text),
        props.onRetry
          ? h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnGhost',
            onClick: props.onRetry,
          }, props.retryLabel)
          : null);
    }

    function Notice(props) {
      if (!props.notice) return null;
      return h('div', {
        className: 'dsh-archive-rsi-notice',
        'data-kind': props.notice.kind,
        role: props.notice.kind === 'error' ? 'alert' : 'status',
      }, props.notice.text);
    }

    function EmptyState(props) {
      return h('div', { className: 'dsh-archive-rsi-empty' },
        props.icon ? h('div', { className: 'dsh-archive-rsi-emptyIcon' }, props.icon) : null,
        h('div', { className: 'dsh-archive-rsi-emptyTitle' }, props.title),
        props.hint ? h('div', { className: 'dsh-archive-rsi-emptyHint' }, props.hint) : null);
    }

    function Center(props) {
      return h('div', { className: 'dsh-archive-rsi-center' },
        props.icon ? h('span', { className: 'dsh-archive-rsi-emptyIcon' }, props.icon) : null,
        props.error
          ? h('div', { className: 'dsh-archive-rsi-errorText' }, props.error)
          : (props.loading ? h(Spinner) : null),
        props.title ? h('span', null, props.title) : null,
        props.onRetry
          ? h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnPrimary',
            onClick: props.onRetry,
          }, props.retryLabel)
          : null);
    }

    function Card(props) {
      return h('section', { className: 'dsh-archive-rsi-card' },
        h('div', { className: 'dsh-archive-rsi-cardHead' },
          props.icon ? h('span', { className: 'dsh-archive-rsi-cardIcon' }, props.icon) : null,
          h('h3', { className: 'dsh-archive-rsi-cardTitle' }, props.title),
          typeof props.count === 'number'
            ? h('span', { className: 'dsh-archive-rsi-cardCount' }, String(props.count))
            : null),
        h('div', { className: 'dsh-archive-rsi-cardBody' }, props.children));
    }

    function Field(props) {
      return h('div', { className: 'dsh-archive-rsi-field' },
        h('span', { className: 'dsh-archive-rsi-fieldLabel' }, props.label),
        props.children);
    }

    function KV(props) {
      return h('div', { className: 'dsh-archive-rsi-kvRow' },
        h('span', { className: 'dsh-archive-rsi-kvLabel' }, props.label),
        h('span', { className: props.mono ? 'dsh-archive-rsi-kvValue dsh-archive-rsi-mono' : 'dsh-archive-rsi-kvValue' }, props.value));
    }

    function BulletList(props) {
      if (!props.items.length) {
        return h('div', { className: 'dsh-archive-rsi-emptyInline' }, props.empty);
      }
      return h('ul', { className: 'dsh-archive-rsi-list' }, props.items.map((item, index) =>
        h('li', { key: 'item-' + String(index), className: 'dsh-archive-rsi-listItem' },
          textOf(item))));
    }

    function statusKey(status) {
      if (status === 'pinned') return 'statusPinned';
      if (status === 'trash') return 'statusTrash';
      return 'statusArchived';
    }

    function StatusChip(props) {
      return h('span', {
        className: 'dsh-archive-rsi-chip',
        'data-status': props.status,
      }, props.t(statusKey(props.status)));
    }

    function statusLabel(status, t) {
      return t(statusKey(status));
    }

    function phaseKey(phase) {
      if (phase === 'plan') return 'phasePlan';
      if (phase === 'do') return 'phaseDo';
      if (phase === 'check') return 'phaseCheck';
      if (phase === 'act') return 'phaseAct';
      if (phase === 'closed') return 'phaseClosed';
      return 'phaseUnknown';
    }

    function runStatusKey(status) {
      if (status === 'planned') return 'runStatusPlanned';
      if (status === 'running') return 'runStatusRunning';
      if (status === 'checked') return 'runStatusChecked';
      if (status === 'closed') return 'runStatusClosed';
      if (status === 'failed') return 'runStatusFailed';
      if (status === 'stalled') return 'runStatusStalled';
      return 'runStatusUnknown';
    }

    function runStatusLabel(status, t) {
      return t(runStatusKey(status));
    }

    function PhaseBadge(props) {
      return h('span', {
        className: 'dsh-archive-rsi-phaseBadge',
        'data-phase': props.phase,
      }, props.t(phaseKey(props.phase)));
    }

    function verdictKey(verdict) {
      if (verdict === 'pass') return 'verdictPass';
      if (verdict === 'fail') return 'verdictFail';
      return 'verdictInconclusive';
    }

    function deltaKey(verdict) {
      if (verdict === 'improved') return 'deltaImproved';
      if (verdict === 'regressed') return 'deltaRegressed';
      if (verdict === 'flat') return 'deltaFlat';
      return 'deltaUnknown';
    }

    function severityKey(severity) {
      if (severity === 'high') return 'severityHigh';
      if (severity === 'low') return 'severityLow';
      return 'severityMedium';
    }

    function kindKey(kind) {
      if (kind === 'prompt-section') return 'kindPromptSection';
      if (kind === 'agents-md-rule') return 'kindAgentsMd';
      if (kind === 'skill-candidate') return 'kindSkill';
      return 'kindAdvisory';
    }

    function riskKey(risk) {
      if (risk === 'high') return 'riskHigh';
      if (risk === 'medium') return 'riskMedium';
      return 'riskLow';
    }

    function proposalStatusKey(status) {
      if (status === 'adopted') return 'proposalStatusAdopted';
      if (status === 'rejected') return 'proposalStatusRejected';
      if (status === 'reverted') return 'proposalStatusReverted';
      return 'proposalStatusProposed';
    }

    function turnEndKey(kind) {
      if (kind === 'completed') return 'turnEndCompleted';
      if (kind === 'aborted') return 'turnEndAborted';
      if (kind === 'blocked') return 'turnEndBlocked';
      if (kind === 'error') return 'turnEndError';
      if (kind === 'max-tokens') return 'turnEndMaxTokens';
      if (kind === 'interrupted') return 'turnEndInterrupted';
      if (kind === 'forked') return 'turnEndForked';
      return '';
    }

    // -------------------------------------------------------------- tag chip

    // Automatic tags keep their `auto:` prefix on the wire and in the editor;
    // only the chip strips it, so the tooltip still shows the stored value and
    // auto/manual tags stay tellable apart.
    const AUTO_TAG_PREFIX = 'auto:';

    function tagDisplay(tag) {
      const text = textOf(tag);
      if (!text || text.indexOf(AUTO_TAG_PREFIX) !== 0) return { text, auto: false };
      const stripped = text.slice(AUTO_TAG_PREFIX.length).trim();
      return { text: stripped || text, auto: true };
    }

    function TagChip(props) {
      const tag = textOf(props.tag);
      const view = tagDisplay(tag);
      return h('span', {
        className: 'dsh-archive-rsi-tag',
        'data-auto': view.auto ? 'true' : 'false',
        title: view.auto ? tag + ' · ' + props.t('tagAutoHint') : tag,
      }, view.text);
    }

    // -------------------------------------------------------------- metrics bar

    // `/overview` carries corpus counts but no rates, so the strip derives the
    // corpus-wide rate and token totals from `/metrics` and falls back to the
    // latest run's cohort metrics for the facts-only gauges.
    function sumSeries(series) {
      let toolCalls = 0;
      let toolErrors = 0;
      let tokens = 0;
      for (const row of series) {
        const metrics = row && row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
        toolCalls += asCount(metrics.toolCalls);
        toolErrors += asCount(metrics.toolErrors);
        tokens += asCount(metrics.totalTokens);
      }
      return { toolCalls, toolErrors, tokens };
    }

    function latestBaselineMetrics(baselines) {
      let best = null;
      for (const row of baselines) {
        if (!row || typeof row !== 'object') continue;
        const ts = asCount(row.ts);
        if (!best || ts > best.ts) {
          best = {
            ts,
            metrics: row.metrics && typeof row.metrics === 'object' ? row.metrics : null,
          };
        }
      }
      return best ? best.metrics : null;
    }

    function buildOverviewMetrics(overview, series, baselines) {
      const sums = sumSeries(series);
      const latest = latestBaselineMetrics(baselines);
      const seriesRate = sums.toolCalls > 0 ? sums.toolErrors / sums.toolCalls : null;
      const seriesTokens = sums.tokens > 0 ? sums.tokens : null;
      const overviewGap = overview ? overview.verificationGapRate : null;
      const overviewCatalog = overview ? overview.catalogBytes : null;
      const latestGap = latest ? toNumber(latest.verificationGapRate) : null;
      const latestCatalog = latest ? toNumber(latest.catalogBytes) : null;
      return {
        corpusBytes: overview ? overview.corpusBytes : null,
        sessions: overview ? overview.sessions : null,
        toolErrorRate: overview && overview.toolErrorRate !== null
          ? overview.toolErrorRate
          : seriesRate,
        totalTokens: overview && overview.totalTokens !== null
          ? overview.totalTokens
          : seriesTokens,
        verificationGapRate: overviewGap !== null ? overviewGap : latestGap,
        catalogBytes: overviewCatalog !== null ? overviewCatalog : latestCatalog,
        gapFromRun: overviewGap === null && latestGap !== null,
        catalogFromRun: overviewCatalog === null && latestCatalog !== null,
      };
    }

    function MetricsStrip(props) {
      const metrics = props.metrics && typeof props.metrics === 'object' ? props.metrics : {};
      const t = props.t;
      const items = [
        { key: 'corpus', label: t('metricCorpus'), value: formatBytes(metrics.corpusBytes) },
        { key: 'sessions', label: t('metricSessions'), value: formatInt(metrics.sessions, props.localeId) },
        { key: 'toolErrorRate', label: t('metricToolErrorRate'), value: formatPercent(metrics.toolErrorRate) },
        {
          key: 'gap',
          label: t('metricVerificationGap'),
          value: formatPercent(metrics.verificationGapRate),
          hint: metrics.gapFromRun ? t('metricFromLatestRun') : '',
        },
        {
          key: 'catalog',
          label: t('metricCatalogBytes'),
          value: formatBytes(metrics.catalogBytes),
          hint: metrics.catalogFromRun ? t('metricFromLatestRun') : '',
        },
        { key: 'tokens', label: t('metricTokens'), value: formatCompact(metrics.totalTokens, props.localeId) },
      ];
      return h('div', { className: 'dsh-archive-rsi-metrics', role: 'group', 'aria-label': t('metricsAria') },
        items.map((item) => h('div', {
          key: item.key,
          className: 'dsh-archive-rsi-metric',
          title: item.hint || item.label,
        },
          h('span', { className: 'dsh-archive-rsi-metricLabel', title: item.label }, item.label),
          h('span', { className: 'dsh-archive-rsi-metricValue' }, item.value))));
    }

    // --------------------------------------------------------------- archive tab

    const SORT_COLUMNS = [
      { key: 'title', labelKey: 'colTitle', numeric: false },
      { key: 'workspace', labelKey: 'colWorkspace', numeric: false },
      { key: 'createdAt', labelKey: 'colDate', numeric: true },
      { key: 'turns', labelKey: 'colTurns', metric: 'turns', numeric: true },
      { key: 'toolErrorRate', labelKey: 'colErrorRate', metric: 'toolErrorRate', numeric: true },
      { key: 'corrections', labelKey: 'colCorrections', metric: 'corrections', numeric: true },
      { key: 'totalTokens', labelKey: 'colTokens', metric: 'totalTokens', numeric: true },
      { key: 'peakContextRatio', labelKey: 'colContext', metric: 'peakContextRatio', numeric: true },
    ];

    // ---------------------------------------------------------- alchemy status

    // One line above the tab content and visible on every tab: the run state the
    // backend reports, what the last run produced, and when an auto run is due.
    function alchemyStateOf(lastRun, busy) {
      if (busy === 'run') return 'running';
      if (lastRun && lastRun.running) return 'running';
      if (lastRun && (lastRun.stalled || lastRun.status === 'failed')) return 'stalled';
      if (!lastRun) return 'never';
      return 'idle';
    }

    function alchemyStateLabel(state, t) {
      if (state === 'running') return t('alchemyRunning');
      if (state === 'stalled') return t('alchemyStalled');
      if (state === 'never') return t('alchemyNeverRun');
      return t('alchemyIdle');
    }

    function AlchemyStatus(props) {
      const t = props.t;
      const lastRun = props.lastRun && typeof props.lastRun === 'object' ? props.lastRun : null;
      const autoRun = props.autoRun && typeof props.autoRun === 'object' ? props.autoRun : {};
      const proposals = props.proposals && typeof props.proposals === 'object' ? props.proposals : {};
      const state = alchemyStateOf(lastRun, props.busy);
      const items = [];
      const push = (key, label, value, hint) => {
        if (!value) return;
        items.push(h('span', {
          key,
          className: 'dsh-archive-rsi-alchemyItem',
          title: hint || label || value,
        },
          label
            ? h('span', { className: 'dsh-archive-rsi-alchemyItemLabel' }, label)
            : null,
          h('span', { className: 'dsh-archive-rsi-alchemyValue' }, value)));
      };
      if (lastRun) {
        const lastAt = lastRun.finishedAt || lastRun.createdAt;
        const absolute = formatDate(lastAt, props.localeId);
        const relative = formatRelativeTime(lastAt, props.localeId);
        push('lastRun', t('lastRunLabel'), relative || absolute, absolute || relative);
        if (lastRun.durationMs !== null) {
          push('duration', t('runDurationLabel'), formatDuration(lastRun.durationMs));
        }
        const targets = lastRun.targets || {};
        if (asCount(targets.total) > 0) {
          const met = t('runTargetsLabel', {
            passed: formatInt(targets.passed, props.localeId),
            total: formatInt(targets.total, props.localeId),
          });
          push('targets', '', met);
        }
      }
      if (proposals.proposed !== null && proposals.proposed !== undefined) {
        push('proposals', t('proposalsPendingLabel'),
          formatInt(proposals.proposed, props.localeId));
      }
      if (autoRun.enabled === true) {
        const next = autoRun.due === true
          ? t('nextAutoRunDue')
          : formatDateShort(autoRun.dueAt, props.localeId);
        push('autoRun', t('nextAutoRunLabel'), next,
          autoRun.dueAt ? formatDate(autoRun.dueAt, props.localeId) : '');
      }
      return h('div', {
        className: 'dsh-archive-rsi-alchemyStatus',
        role: 'group',
        'aria-label': t('alchemyStatusAria'),
        'data-status': state,
      },
        h('span', { className: 'dsh-archive-rsi-alchemyState', title: t('alchemyStatus') },
          h('span', {
            className: 'dsh-archive-rsi-statusDot',
            'data-status': state,
            'aria-hidden': true,
          }),
          h('span', { className: 'dsh-archive-rsi-alchemyItemLabel' }, t('alchemyStatus')),
          h('span', { className: 'dsh-archive-rsi-alchemyValue' }, alchemyStateLabel(state, t))),
        items);
    }

    function findColumn(key) {
      for (const column of SORT_COLUMNS) {
        if (column.key === key) return column;
      }
      return SORT_COLUMNS[0];
    }

    function columnValue(entry, column) {
      if (!entry) return '';
      if (column.metric) {
        const value = entry.metrics ? entry.metrics[column.metric] : null;
        return typeof value === 'number' && Number.isFinite(value) ? value : -1;
      }
      if (column.key === 'title') return entry.title || entry.id || '';
      if (column.key === 'workspace') return entry.workspace || entry.slug || '';
      if (column.key === 'createdAt') return entry.createdAt === null ? 0 : entry.createdAt;
      return '';
    }

    function SessionRow(props) {
      const entry = props.entry;
      const t = props.t;
      const metrics = entry.metrics;
      const warn = typeof metrics.toolErrorRate === 'number' && metrics.toolErrorRate >= 0.1;
      return h('button', {
        type: 'button',
        className: 'dsh-archive-rsi-row',
        'data-selected': entry.id === props.selectedId ? 'true' : 'false',
        onClick: () => props.onSelect(entry.id),
        title: entry.title || entry.id,
      },
        h('span', { className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellTitle' },
          h('span', {
            className: 'dsh-archive-rsi-statusDot',
            'data-status': entry.status,
            'aria-hidden': true,
          }),
          h('span', { className: 'dsh-archive-rsi-cellText' }, entry.title || t('untitledSession'))),
        h('span', { className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellEllipsis', title: entry.workspace || entry.slug },
          entry.workspace || entry.slug || t('unset')),
        h('span', {
          className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellDate',
          title: formatDate(entry.createdAt, props.localeId),
        }, formatDateShort(entry.createdAt, props.localeId) || t('unset')),
        h('span', { className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellNum' }, formatInt(metrics.turns, props.localeId)),
        h('span', {
          className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellNum',
          'data-warn': warn ? 'true' : 'false',
        }, formatPercent(metrics.toolErrorRate)),
        h('span', { className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellNum' }, formatInt(metrics.corrections, props.localeId)),
        h('span', { className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellNum' }, formatCompact(metrics.totalTokens, props.localeId)),
        h('span', { className: 'dsh-archive-rsi-cell dsh-archive-rsi-cellNum' }, formatPercent(metrics.peakContextRatio)));
    }

    function ToolsCard(props) {
      const facts = props.facts;
      const t = props.t;
      const rows = facts.tools;
      return h(Card, { title: t('factsTools'), icon: h(BeakerIcon, { size: 14 }), count: rows.length },
        rows.length === 0
          ? h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('toolsEmpty'))
          : h('div', { className: 'dsh-archive-rsi-tableWrap' },
            h('table', { className: 'dsh-archive-rsi-table' },
              h('thead', null,
                h('tr', null,
                  h('th', { key: 'name' }, t('toolName')),
                  h('th', { key: 'calls', className: 'dsh-archive-rsi-cellNum' }, t('toolCallsShort')),
                  h('th', { key: 'errors', className: 'dsh-archive-rsi-cellNum' }, t('toolErrorsShort')),
                  h('th', { key: 'rate', className: 'dsh-archive-rsi-cellNum' }, t('toolRate')),
                  h('th', { key: 'bytes', className: 'dsh-archive-rsi-cellNum' }, t('toolResultBytes')))),
              h('tbody', null, rows.map((row) =>
                h('tr', { key: 'tool-' + row.name },
                  h('td', null,
                    h('span', { className: 'dsh-archive-rsi-mono' }, row.name),
                    Object.keys(row.errorCodes).length
                      ? h('span', {
                        className: 'dsh-archive-rsi-errorCodes',
                        title: t('toolErrorCodes') + ': ' + Object.keys(row.errorCodes)
                          .map((code) => code + '×' + textOf(row.errorCodes[code])).join(', '),
                      }, Object.keys(row.errorCodes).slice(0, 3)
                        .map((code) => code + '×' + textOf(row.errorCodes[code])).join(' '))
                      : null),
                  h('td', { className: 'dsh-archive-rsi-cellNum' }, formatInt(row.calls, props.localeId)),
                  h('td', { className: 'dsh-archive-rsi-cellNum' }, formatInt(row.errors, props.localeId)),
                  h('td', {
                    className: 'dsh-archive-rsi-cellNum',
                    'data-warn': row.calls > 0 && row.errors / row.calls >= 0.1 ? 'true' : 'false',
                  }, row.calls > 0 ? formatPercent(row.errors / row.calls) : '—'),
                  h('td', { className: 'dsh-archive-rsi-cellNum' }, formatBytes(row.resultBytes))))))));
    }

    function TurnEndsCard(props) {
      const t = props.t;
      const turnEnds = props.facts.turnEnds;
      const kinds = Object.keys(turnEnds);
      return h(Card, { title: t('factsTurnEnds'), icon: h(CheckIcon, { size: 14 }) },
        kinds.length === 0
          ? h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('turnEndsEmpty'))
          : h('div', { className: 'dsh-archive-rsi-chips' }, kinds.map((kind) => {
            const key = turnEndKey(kind);
            return h('span', { key: 'end-' + kind, className: 'dsh-archive-rsi-chip', 'data-kind': kind },
              key ? t(key) : kind,
              h('span', { className: 'dsh-archive-rsi-chipCount' }, textOf(turnEnds[kind])));
          })));
    }

    function CountersCard(props) {
      const t = props.t;
      const facts = props.facts;
      const localeId = props.localeId;
      const pairs = [
        ['counterEvents', facts.counters.events],
        ['counterTurns', facts.counters.turns],
        ['counterSteps', facts.counters.steps],
        ['counterUserMessages', facts.counters.userMessages],
        ['counterHumanMessages', facts.counters.humanMessages],
        ['counterAssistantMessages', facts.counters.assistantMessages],
        ['counterToolCalls', facts.counters.toolCalls],
        ['counterToolResults', facts.counters.toolResults],
        ['counterToolErrors', facts.counters.toolErrors],
        ['counterLlmRetries', facts.counters.llmRetries],
        ['counterSubagents', facts.counters.subagentDescriptors],
        ['counterTeamTasks', facts.counters.teamTasks],
        ['counterApprovals', facts.counters.approvals],
        ['counterCommands', facts.counters.commands],
        ['counterInterrupts', facts.counters.interrupts],
        ['counterCompactions', facts.counters.compactions],
        ['counterEdits', facts.edits.count],
        ['counterChecks', facts.checks.count],
        ['counterAfterLastEditChecks', facts.afterLastEditChecks],
        ['counterRepeated', facts.repeated.length],
      ];
      return h(Card, { title: t('factsCounters'), icon: h(ArchiveIcon, { size: 14 }) },
        h('div', { className: 'dsh-archive-rsi-kvGrid' }, pairs.map(([labelKey, value]) =>
          h(KV, { key: labelKey, label: t(labelKey), value: formatInt(value, localeId) }))));
    }

    function ContextCard(props) {
      const t = props.t;
      const facts = props.facts;
      const localeId = props.localeId;
      return h(Card, { title: t('factsContext'), icon: h(ProposalIcon, { size: 14 }) },
        h('div', { className: 'dsh-archive-rsi-kvGrid' },
          h(KV, { key: 'peak', label: t('peakContext'), value: formatPercent(facts.peakContextRatio) }),
          h(KV, { key: 'peakTokens', label: t('peakInputTokens'), value: formatInt(facts.peakInputTokens, localeId) }),
          h(KV, { key: 'window', label: t('contextWindow'), value: formatInt(facts.contextWindow, localeId) }),
          h(KV, { key: 'catalogBytes', label: t('catalogBytes'), value: formatBytes(facts.catalog.bytes) }),
          h(KV, { key: 'catalogTools', label: t('catalogToolCount'), value: formatInt(facts.catalog.toolCount, localeId) }),
          h(KV, {
            key: 'skill',
            label: t('skillCatalog'),
            value: t('skillCatalogValue', {
              bytes: formatBytes(facts.skillCatalog.bytes),
              entries: formatInt(facts.skillCatalog.entries, localeId),
            }),
          })),
        h('div', { className: 'dsh-archive-rsi-kvGrid' },
          h(KV, { key: 'durTotal', label: t('durationTotal'), value: formatDuration(facts.durations.totalMs) }),
          h(KV, { key: 'durTurn', label: t('durationMaxTurn'), value: formatDuration(facts.durations.maxTurnMs) }),
          h(KV, { key: 'durStep', label: t('durationMaxStep'), value: formatDuration(facts.durations.maxStepMs) })));
    }

    function TranscriptCard(props) {
      const t = props.t;
      const localeId = props.localeId;
      const transcript = typeof props.transcript === 'string' ? props.transcript : '';
      const truncated = Boolean(props.transcriptTruncated);
      const loading = Boolean(props.transcriptLoading);
      const error = props.transcriptError || '';
      const shown = transcript.length;
      const total = toNumber(props.transcriptTotal);
      const progress = t('transcriptProgress', {
        shown: formatInt(shown, localeId),
        total: total === null ? formatInt(shown, localeId) : formatInt(total, localeId),
      });
      if (!transcript) {
        return h(Card, { title: t('factsTranscript'), icon: h(ProposalIcon, { size: 14 }) },
          h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('transcriptEmpty')));
      }
      const children = [
        h('p', { key: 'hint', className: 'dsh-archive-rsi-transcriptHint' }, t('transcriptHint')),
        h('div', { key: 'toolbar', className: 'dsh-archive-rsi-transcriptToolbar' },
          h('span', { className: 'dsh-archive-rsi-transcriptProgress' }, progress),
          truncated
            ? h('button', {
              type: 'button',
              className: 'dsh-archive-rsi-btn',
              disabled: loading,
              onClick: props.onLoadMore,
            }, loading ? h(Spinner) : null,
            loading ? t('transcriptLoading') : (error ? t('retry') : t('transcriptLoadMore')))
            : h('span', { className: 'dsh-archive-rsi-transcriptDone' }, t('transcriptAllLoaded'))),
      ];
      if (error) {
        children.push(h('div', {
          key: 'error',
          className: 'dsh-archive-rsi-transcriptError',
          role: 'alert',
        }, t('transcriptLoadFailed', { message: error })));
      }
      children.push(h('pre', { key: 'body', className: 'dsh-archive-rsi-transcript' }, transcript));
      return h(Card, { title: t('factsTranscript'), icon: h(ProposalIcon, { size: 14 }) }, children);
    }

    function DetailMeta(props) {
      const entry = props.entry;
      const t = props.t;
      const localeId = props.localeId;
      const items = [
        { key: 'id', label: t('metaId'), value: entry.id, mono: true },
        { key: 'workspace', label: t('metaWorkspace'), value: entry.workspace || entry.slug },
        { key: 'created', label: t('metaCreated'), value: formatDate(entry.createdAt, localeId) },
        { key: 'updated', label: t('metaUpdated'), value: formatDate(entry.updatedAt, localeId) },
        { key: 'origin', label: t('metaOrigin'), value: entry.origin },
        { key: 'preset', label: t('metaPreset'), value: entry.agentPreset },
        { key: 'parent', label: t('metaParent'), value: entry.parentSession },
        { key: 'bytes', label: t('metaBytes'), value: entry.bytes === null ? '' : formatBytes(entry.bytes) },
      ];
      return h('div', { className: 'dsh-archive-rsi-detailMeta' },
        items.filter((item) => item.value).map((item) =>
          h('span', { key: item.key, className: 'dsh-archive-rsi-metItem' },
            h('span', { className: 'dsh-archive-rsi-metLabel' }, item.label),
            h('span', { className: item.mono ? 'dsh-archive-rsi-mono' : null }, item.value))));
    }

    function EditForm(props) {
      const t = props.t;
      const draft = props.draft;
      const disabled = Boolean(props.busy);
      const dirty = props.dirty;
      return h('div', { className: 'dsh-archive-rsi-editGrid' },
        h(Field, { label: t('editTitle') },
          h('input', {
            type: 'text',
            className: 'dsh-archive-rsi-input',
            value: draft.title,
            disabled,
            onChange: (event) => props.onChange({ title: event.target.value }),
          })),
        h(Field, { label: t('editStatus') },
          h('select', {
            className: 'dsh-archive-rsi-select',
            value: draft.status,
            disabled,
            onChange: (event) => props.onChange({ status: event.target.value }),
          }, ['archived', 'pinned', 'trash'].map((value) =>
            h('option', { key: value, value }, statusLabel(value, t))))),
        h(Field, { label: t('editTags') },
          h('input', {
            type: 'text',
            className: 'dsh-archive-rsi-input dsh-archive-rsi-mono',
            value: draft.tags,
            disabled,
            placeholder: t('editTagsHint', { count: TAG_LIMIT }),
            onChange: (event) => props.onChange({ tags: event.target.value }),
          })),
        h(Field, { label: t('editNote') },
          h('textarea', {
            className: 'dsh-archive-rsi-textarea',
            value: draft.note,
            disabled,
            rows: 3,
            onChange: (event) => props.onChange({ note: event.target.value }),
          })),
        h('div', { className: 'dsh-archive-rsi-detailActions' },
          h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnPrimary',
            disabled: disabled || !dirty,
            onClick: props.onSave,
          }, props.saving ? h(Spinner) : h(CheckIcon, { size: 14 }),
          props.saving ? t('saving') : t('save')),
          h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnDanger',
            disabled,
            'data-confirm': props.confirmDelete ? 'true' : 'false',
            onClick: props.onDelete,
          }, props.deleting ? h(Spinner) : h(TrashIcon, { size: 14 }),
          props.deleting
            ? t('deleting')
            : (props.confirmDelete ? t('deleteConfirm') : t('delete'))),
          h('span', { className: 'dsh-archive-rsi-hint' }, t('deleteHint'))));
    }

    function SessionDetailPane(props) {
      const t = props.t;
      const detail = props.detail;
      if (!detail) {
        if (props.error) {
          return h('section', { className: 'dsh-archive-rsi-pane dsh-archive-rsi-detail' },
            h(Center, {
              error: props.error,
              onRetry: props.onRetry,
              retryLabel: t('retry'),
            }));
        }
        if (props.loading) {
          return h('section', { className: 'dsh-archive-rsi-pane dsh-archive-rsi-detail' },
            h(Center, { loading: true, title: t('loading') }));
        }
        return h('section', { className: 'dsh-archive-rsi-pane dsh-archive-rsi-detail' },
          h(EmptyState, {
            icon: h(ArchiveIcon, { size: 26 }),
            title: t('selectSessionTitle'),
            hint: t('selectSessionHint'),
          }));
      }
      const entry = detail.entry;
      const facts = detail.facts;
      return h('section', { className: 'dsh-archive-rsi-pane dsh-archive-rsi-detail' },
        h('div', { className: 'dsh-archive-rsi-detailHead' },
          h('div', { className: 'dsh-archive-rsi-detailTitleLine' },
            h('h2', { className: 'dsh-archive-rsi-detailTitle' }, entry.title || t('untitledSession')),
            h(StatusChip, { status: entry.status, t }),
            entry.tags.slice(0, 6).map((tag) =>
              h(TagChip, { key: 'tag-' + tag, tag, t }))),
          h(DetailMeta, { entry, t, localeId: props.localeId }),
          props.draft
            ? h(EditForm, {
              t,
              draft: props.draft,
              busy: props.busy,
              dirty: props.dirty,
              saving: props.saving,
              deleting: props.deleting,
              confirmDelete: props.confirmDelete,
              onChange: props.onDraftChange,
              onSave: props.onSave,
              onDelete: props.onDelete,
            })
            : null),
        h('div', { className: 'dsh-archive-rsi-sections' },
          facts
            ? [
              h(CountersCard, { key: 'counters', facts, t, localeId: props.localeId }),
              h(ToolsCard, { key: 'tools', facts, t, localeId: props.localeId }),
              h(ContextCard, { key: 'context', facts, t, localeId: props.localeId }),
              h(TurnEndsCard, { key: 'turns', facts, t }),
              h(TranscriptCard, {
                key: 'transcript',
                transcript: detail.transcript,
                transcriptOffset: detail.transcriptOffset,
                transcriptTotal: detail.transcriptTotal,
                transcriptTruncated: detail.transcriptTruncated,
                transcriptLoading: props.transcriptLoading,
                transcriptError: props.transcriptError,
                onLoadMore: props.onLoadMore,
                localeId: props.localeId,
                t,
              }),
            ]
            : h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('factsEmpty'))));
    }

    // ----------------------------------------------------------------- pdca tab

    function RunRow(props) {
      const run = props.run;
      const t = props.t;
      const localeId = props.localeId;
      const duration = toNumber(run.durationMs);
      const statusText = runStatusLabel(run.status, t);
      return h('button', {
        type: 'button',
        className: 'dsh-archive-rsi-runRow',
        'data-selected': run.id === props.selectedRunId ? 'true' : 'false',
        onClick: () => props.onSelect(run.id),
        title: run.id,
      },
        h('div', { className: 'dsh-archive-rsi-runTop' },
          h(PhaseBadge, { phase: run.phase, t }),
          h('span', {
            className: 'dsh-archive-rsi-runStatus',
            'data-status': runStatusKey(run.status),
            title: statusText,
          }, statusText),
          h('span', { className: 'dsh-archive-rsi-runId dsh-archive-rsi-mono' }, shortId(run.id) || t('unset'))),
        h('div', { className: 'dsh-archive-rsi-runMeta' },
          h('span', null, formatDateShort(run.createdAt, localeId) || t('unset')),
          duration === null
            ? null
            : h('span', { title: t('runDurationLabel') }, formatDuration(duration)),
          run.do.coverage.analyzed === null
            ? null
            : h('span', null, t('sessionsTotal', { count: formatInt(run.do.coverage.analyzed, localeId) }))));
    }

    function VerdictChip(props) {
      return h('span', {
        className: 'dsh-archive-rsi-chip',
        'data-verdict': props.verdict,
      }, props.t(verdictKey(props.verdict)));
    }

    function DeltaChip(props) {
      return h('span', {
        className: 'dsh-archive-rsi-chip',
        'data-delta': props.verdict,
      }, props.t(deltaKey(props.verdict)));
    }

    function formatMetricValue(metric, value, localeId) {
      const number = toNumber(value);
      if (number === null) return '—';
      if (metric === 'catalogBytes' || metric === 'skillCatalogBytes') return formatBytes(number);
      if (metric === 'totalTokens' || metric === 'inputTokens' || metric === 'outputTokens') {
        return formatCompact(number, localeId);
      }
      if (metric === 'sessions' || metric === 'turns' || metric === 'steps' || metric === 'toolCalls'
        || metric === 'toolResults' || metric === 'toolErrors' || metric === 'corrections'
        || metric === 'catalogToolCount' || metric === 'repeatedCallSessions') {
        return formatInt(number, localeId);
      }
      return formatPercent(number, 3);
    }

    function VerdictsTable(props) {
      const t = props.t;
      const verdicts = props.verdicts;
      const localeId = props.localeId;
      if (!verdicts.length) return h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('unset'));
      return h('div', { className: 'dsh-archive-rsi-tableWrap' },
        h('table', { className: 'dsh-archive-rsi-table' },
          h('thead', null,
            h('tr', null,
              h('th', { key: 'metric' }, t('metricName')),
              h('th', { key: 'target' }, t('targetValue')),
              h('th', { key: 'actual' }, t('actualValue')),
              h('th', { key: 'verdict' }, t('checkVerdicts')))),
          h('tbody', null, verdicts.map((row, index) =>
            h('tr', { key: 'verdict-' + String(index) },
              h('td', { className: 'dsh-archive-rsi-mono' }, row.metric || t('unset')),
              h('td', null, textOf(row.op) + ' ' + formatMetricValue(row.metric, row.target, localeId)),
              h('td', null, formatMetricValue(row.metric, row.actual, localeId)),
              h('td', null, h(VerdictChip, { verdict: row.verdict, t })))))));
    }

    function DeltasTable(props) {
      const t = props.t;
      const deltas = props.deltas;
      const localeId = props.localeId;
      if (!deltas.length) return h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('baselineNone'));
      return h('div', { className: 'dsh-archive-rsi-tableWrap' },
        h('table', { className: 'dsh-archive-rsi-table' },
          h('thead', null,
            h('tr', null,
              h('th', { key: 'metric' }, t('metricName')),
              h('th', { key: 'before' }, t('beforeValue')),
              h('th', { key: 'after' }, t('afterValue')),
              h('th', { key: 'delta' }, t('deltaValue')),
              h('th', { key: 'verdict' }, t('checkDeltas')))),
          h('tbody', null, deltas.map((row, index) =>
            h('tr', { key: 'delta-' + String(index) },
              h('td', { className: 'dsh-archive-rsi-mono' }, row.metric || t('unset')),
              h('td', null, formatMetricValue(row.metric, row.before, localeId)),
              h('td', null, formatMetricValue(row.metric, row.after, localeId)),
              h('td', null, formatMetricValue(row.metric, row.delta, localeId)),
              h('td', null, h(DeltaChip, { verdict: row.verdict, t })))))));
    }

    const COHORT_METRIC_KEYS = [
      'sessions',
      'toolErrorRate',
      'correctionRate',
      'verificationGapRate',
      'peakContextRatioP90',
      'catalogBytes',
      'totalTokens',
      'tokensPerTurn',
      'turnFailureRate',
    ];

    function cohortMetricLabel(metric, t) {
      if (metric === 'sessions') return t('metricSessions');
      if (metric === 'toolErrorRate') return t('metricToolErrorRate');
      if (metric === 'correctionRate') return t('metricCorrectionRate');
      if (metric === 'verificationGapRate') return t('metricVerificationGap');
      if (metric === 'peakContextRatioP90') return t('metricPeakContextP90');
      if (metric === 'catalogBytes') return t('metricCatalogBytes');
      if (metric === 'totalTokens') return t('metricTokens');
      if (metric === 'tokensPerTurn') return t('metricTokensPerTurn');
      if (metric === 'turnFailureRate') return t('metricTurnFailureRate');
      return metric;
    }

    function CohortMetricsList(props) {
      const t = props.t;
      const metrics = props.metrics;
      const rows = COHORT_METRIC_KEYS.filter((key) => metrics[key] !== undefined);
      if (!rows.length) return h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('unset'));
      return h('div', { className: 'dsh-archive-rsi-kvGrid' }, rows.map((key) =>
        h(KV, {
          key,
          label: cohortMetricLabel(key, t),
          value: formatMetricValue(key, metrics[key], props.localeId),
        })));
    }

    function FindingItem(props) {
      const finding = props.finding;
      const t = props.t;
      return h('div', { className: 'dsh-archive-rsi-finding', 'data-severity': finding.severity },
        h('div', { className: 'dsh-archive-rsi-findingHead' },
          h('span', { className: 'dsh-archive-rsi-sevChip', 'data-severity': finding.severity },
            t(severityKey(finding.severity))),
          finding.rule
            ? h('span', { className: 'dsh-archive-rsi-mono dsh-archive-rsi-rule' }, finding.rule)
            : null,
          h('span', { className: 'dsh-archive-rsi-findingTitle' }, finding.title || t('unset'))),
        finding.detail
          ? h('p', { className: 'dsh-archive-rsi-prose' }, finding.detail)
          : null,
        finding.advice
          ? h('div', { className: 'dsh-archive-rsi-advice' },
            h('span', { className: 'dsh-archive-rsi-adviceLabel' }, t('adviceLabel') + ':'),
            h('span', null, finding.advice))
          : null,
        finding.evidence.length
          ? h('div', { className: 'dsh-archive-rsi-evidenceRow' },
            h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('evidenceLabel')),
            finding.evidence.map((item, index) =>
              h('button', {
                key: 'ev-' + String(index),
                type: 'button',
                className: 'dsh-archive-rsi-evidenceLink',
                title: t('evidenceOpen') + ': ' + item.sessionId,
                onClick: () => props.onOpenSession(item.sessionId),
              },
                h('span', { className: 'dsh-archive-rsi-mono' }, shortId(item.sessionId)),
                item.seq === null
                  ? null
                  : h('span', { className: 'dsh-archive-rsi-evidenceSeq' },
                    t('evidenceSeq', { seq: formatInt(item.seq) })))))
          : h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('evidenceEmpty')));
    }

    function Panel(props) {
      return h('section', { className: 'dsh-archive-rsi-panel', 'data-phase': props.phase },
        h('div', { className: 'dsh-archive-rsi-panelHead' },
          h(PhaseBadge, { phase: props.phase, t: props.t }),
          typeof props.count === 'number'
            ? h('span', { className: 'dsh-archive-rsi-cardCount' }, String(props.count))
            : null),
        h('div', { className: 'dsh-archive-rsi-panelBody' }, props.children));
    }

    function PlanPanel(props) {
      const t = props.t;
      const run = props.run;
      const cohort = run.cohort;
      const localeId = props.localeId;
      return h(Panel, { phase: 'plan', t },
        h('div', { className: 'dsh-archive-rsi-cohort' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('cohortLabel')),
          h('span', null, cohort.days
            ? t('cohortDays', { days: formatInt(cohort.days, localeId) })
            : t('cohortAllDays')),
          cohort.limit === null
            ? null
            : h('span', null, t('cohortLimit', { limit: formatInt(cohort.limit, localeId) })),
          cohort.tag
            ? h('span', null, t('cohortTag', { tag: cohort.tag }))
            : null,
          cohort.workspace
            ? h('span', null, t('cohortWorkspace', { workspace: cohort.workspace }))
            : null,
          cohort.status
            ? h('span', null, t('cohortStatusLabel') + ': ' + cohort.status)
            : null),
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('targetsTitle')),
          run.plan.targets.length
            ? h('div', { className: 'dsh-archive-rsi-tableWrap' },
              h('table', { className: 'dsh-archive-rsi-table' },
                h('tbody', null, run.plan.targets.map((target, index) =>
                  h('tr', { key: 'target-' + String(index) },
                    h('td', { className: 'dsh-archive-rsi-mono' }, target.metric || t('unset')),
                    h('td', null, textOf(target.op)),
                    h('td', { className: 'dsh-archive-rsi-cellNum' },
                      formatMetricValue(target.metric, target.value, localeId)))))))
            : h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('targetsEmpty'))),
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('hypothesesTitle')),
          run.plan.hypotheses.length
            ? h(BulletList, {
              items: run.plan.hypotheses.map((item) =>
                [item.id, item.statement, item.metric, item.expected].filter(Boolean).join(' · ')),
              empty: t('hypothesesEmpty'),
            })
            : h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('hypothesesEmpty'))),
        h('div', { className: 'dsh-archive-rsi-kvGrid' },
          h(KV, {
            key: 'baseline',
            label: t('baselineLabel'),
            value: run.plan.baselineRunId || t('baselineNone'),
            mono: Boolean(run.plan.baselineRunId),
          })));
    }

    function DoPanel(props) {
      const t = props.t;
      const run = props.run;
      const localeId = props.localeId;
      const coverage = run.do.coverage;
      return h(Panel, { phase: 'do', t, count: coverage.analyzed === null ? undefined : coverage.analyzed },
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-metricValue' },
            t('doAnalyzed', { count: formatInt(coverage.analyzed, localeId) }))),
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('doCoverage')),
          h('div', { className: 'dsh-archive-rsi-kvGrid' },
            h(KV, { key: 'requested', label: t('doRequested'), value: formatInt(coverage.requested, localeId) }),
            h(KV, { key: 'skipped', label: t('doSkipped'), value: formatInt(coverage.skipped, localeId) }),
            h(KV, { key: 'failures', label: t('doFailures'), value: formatInt(coverage.failures.length, localeId) }),
            h(KV, { key: 'at', label: t('doAnalyzedAt'), value: formatDate(run.do.analyzedAt, localeId) || t('unset') }))),
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' },
            t('doSessions') + ' · ' + String(run.do.sessionIds.length)),
          run.do.sessionIds.length
            ? h('div', { className: 'dsh-archive-rsi-chips' },
              run.do.sessionIds.slice(0, EVIDENCE_CHIP_LIMIT).map((id) =>
                h('button', {
                  key: 'sid-' + id,
                  type: 'button',
                  className: 'dsh-archive-rsi-evidenceLink',
                  title: t('evidenceOpen') + ': ' + id,
                  onClick: () => props.onOpenSession(id),
                }, h('span', { className: 'dsh-archive-rsi-mono' }, shortId(id)))),
              run.do.sessionIds.length > EVIDENCE_CHIP_LIMIT
                ? h('span', { key: 'overflow', className: 'dsh-archive-rsi-emptyInline' },
                  '+' + String(run.do.sessionIds.length - EVIDENCE_CHIP_LIMIT))
                : null)
            : null));
    }

    function CheckPanel(props) {
      const t = props.t;
      const run = props.run;
      const localeId = props.localeId;
      return h(Panel, { phase: 'check', t, count: run.check.verdicts.length },
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('checkVerdicts')),
          h(VerdictsTable, { verdicts: run.check.verdicts, t, localeId })),
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' },
            t('checkDeltas') + (run.plan.baselineRunId ? ' · ' + shortId(run.plan.baselineRunId) : '')),
          h(DeltasTable, { deltas: run.check.deltas, t, localeId })),
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('checkMetrics')),
          h(CohortMetricsList, { metrics: run.check.metrics, t, localeId })));
    }

    function ActPanel(props) {
      const t = props.t;
      const run = props.run;
      const findings = run.act.findings;
      return h(Panel, { phase: 'act', t, count: findings.length },
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('actFindings')),
          findings.length
            ? h('div', { className: 'dsh-archive-rsi-findings' }, findings.map((finding, index) =>
              h(FindingItem, {
                key: finding.id || 'finding-' + String(index),
                finding,
                t,
                onOpenSession: props.onOpenSession,
              })))
            : (run.act.proposalIds.length
              ? h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('findingsEmpty'))
              : h('div', { className: 'dsh-archive-rsi-empty' },
                h('div', { className: 'dsh-archive-rsi-emptyIcon' }, h(BeakerIcon, { size: 20 })),
                h('div', { className: 'dsh-archive-rsi-emptyTitle' }, t('actEmpty')),
                h('div', { className: 'dsh-archive-rsi-emptyHint' }, t('actHint'))))),
        h('div', { className: 'dsh-archive-rsi-panelActions' },
          h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnPrimary',
            disabled: Boolean(props.busy),
            onClick: props.onGenerate,
          }, props.busy ? h(Spinner) : h(PlayIcon, { size: 14 }),
          props.busy ? t('generatingProposals') : t('generateProposals')),
          run.act.proposalIds.length
            ? h('span', { className: 'dsh-archive-rsi-hint' },
              t('proposalIdsCount', { count: formatInt(run.act.proposalIds.length) }))
            : null));
    }

    function RunDetail(props) {
      const t = props.t;
      if (!props.run) {
        if (props.error) {
          return h(Center, { error: props.error, onRetry: props.onRetry, retryLabel: t('retry') });
        }
        if (props.loading) return h(Center, { loading: true, title: t('loading') });
        return h(EmptyState, {
          icon: h(BeakerIcon, { size: 26 }),
          title: t('selectRunTitle'),
          hint: t('selectRunHint'),
        });
      }
      const run = props.run;
      const targets = run.targets || {};
      const statusText = runStatusLabel(run.status, t);
      return h('div', { className: 'dsh-archive-rsi-runDetail' },
        h('div', { className: 'dsh-archive-rsi-runDetailHead' },
          h('span', { className: 'dsh-archive-rsi-mono' }, run.id || t('unset')),
          h('span', { className: 'dsh-archive-rsi-metItem' },
            h('span', { className: 'dsh-archive-rsi-metLabel' }, t('phaseLabel')),
            h(PhaseBadge, { phase: run.phase, t })),
          h('span', {
            className: 'dsh-archive-rsi-runStatus',
            'data-status': runStatusKey(run.status),
            title: statusText,
          }, statusText),
          run.updatedAt
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              formatDate(run.updatedAt, props.localeId))
            : null,
          run.startedAt
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              h('span', { className: 'dsh-archive-rsi-metLabel' }, t('runStartedLabel')),
              formatDate(run.startedAt, props.localeId))
            : null,
          run.finishedAt
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              h('span', { className: 'dsh-archive-rsi-metLabel' }, t('runFinishedLabel')),
              formatDate(run.finishedAt, props.localeId))
            : null,
          toNumber(run.durationMs) !== null
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              h('span', { className: 'dsh-archive-rsi-metLabel' }, t('runDurationLabel')),
              formatDuration(run.durationMs))
            : null,
          asCount(targets.total) > 0
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              t('runTargetsLabel', {
                passed: formatInt(targets.passed, props.localeId),
                total: formatInt(targets.total, props.localeId),
              }))
            : null,
          // The act entry point must be reachable without scrolling through the
          // findings: a run with findings (or proposals) always offers it here.
          (run.act.findings.length > 0 || run.act.proposalIds.length > 0) && props.onGenerate
            ? h('button', {
              type: 'button',
              className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnPrimary dsh-archive-rsi-runActBtn',
              disabled: Boolean(props.busy),
              onClick: () => props.onGenerate(),
            },
            props.busy ? h(Spinner) : h(PlayIcon, { size: 13 }),
            props.busy
              ? t('generatingProposals')
              : run.act.proposalIds.length
                ? t('regenerateProposals')
                : t('generateProposals'))
            : null),
        h('div', { className: 'dsh-archive-rsi-panels' },
          h(PlanPanel, { run, t, localeId: props.localeId }),
          h(DoPanel, { run, t, localeId: props.localeId, onOpenSession: props.onOpenSession }),
          h(CheckPanel, { run, t, localeId: props.localeId }),
          h(ActPanel, {
            run,
            t,
            busy: props.busy,
            onGenerate: props.onGenerate,
            onOpenSession: props.onOpenSession,
          })));
    }

    // ------------------------------------------------------------ proposals tab

    function ProposalCard(props) {
      const item = props.proposal;
      const t = props.t;
      const localeId = props.localeId;
      const busy = Boolean(props.busy);
      const isAdvisory = item.kind === 'advisory';
      const canAdopt = !isAdvisory && item.status === 'proposed';
      const canReject = item.status === 'proposed';
      const canRevert = item.status === 'adopted';
      const effect = item.expectedEffect === 'increase' ? t('effectIncrease')
        : (item.expectedEffect === 'decrease' ? t('effectDecrease') : item.expectedEffect);
      let adoptHint = '';
      if (isAdvisory) adoptHint = t('adoptAdvisoryHint');
      else if (item.status !== 'proposed') adoptHint = t('adoptStatusHint');
      return h('article', { className: 'dsh-archive-rsi-proposal' },
        h('div', { className: 'dsh-archive-rsi-proposalHead' },
          h('h3', { className: 'dsh-archive-rsi-proposalTitle' }, item.title || item.id || t('unset')),
          h('span', { className: 'dsh-archive-rsi-chip', 'data-kind': item.kind }, t(kindKey(item.kind))),
          h('span', { className: 'dsh-archive-rsi-chip', 'data-risk': item.risk }, t(riskKey(item.risk))),
          h('span', { className: 'dsh-archive-rsi-chip', 'data-status': item.status },
            t(proposalStatusKey(item.status)))),
        h('div', { className: 'dsh-archive-rsi-proposalMeta' },
          h('span', { className: 'dsh-archive-rsi-metItem' },
            h('span', { className: 'dsh-archive-rsi-metLabel' }, t('expectedMetricLabel')),
            h('span', { className: 'dsh-archive-rsi-mono' },
              (item.expectedMetric || t('unset')) + (effect ? ' / ' + effect : ''))),
          h('span', { className: 'dsh-archive-rsi-metItem' }, t('evidenceCount', { count: item.evidence.length })),
          item.target
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              h('span', { className: 'dsh-archive-rsi-metLabel' }, t('proposalTargetLabel')),
              h('span', { className: 'dsh-archive-rsi-mono', title: item.target }, shortPath(item.target)))
            : null,
          item.runId
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              h('span', { className: 'dsh-archive-rsi-metLabel' }, t('proposalRunLabel')),
              h('span', { className: 'dsh-archive-rsi-mono' }, shortId(item.runId)))
            : null,
          item.createdAt
            ? h('span', { className: 'dsh-archive-rsi-metItem' },
              formatDate(item.createdAt, localeId))
            : null),
        item.rationale
          ? h('div', { className: 'dsh-archive-rsi-field' },
            h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('proposalRationaleLabel')),
            h('p', { className: 'dsh-archive-rsi-prose' }, item.rationale))
          : null,
        h('div', { className: 'dsh-archive-rsi-field' },
          h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('proposalBodyLabel')),
          item.body
            ? h('pre', { className: 'dsh-archive-rsi-proposalBody' }, item.body)
            : h('div', { className: 'dsh-archive-rsi-emptyInline' }, t('proposalBodyEmpty'))),
        item.evaluation
          ? h('div', { className: 'dsh-archive-rsi-field' },
            h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('proposalEvalLabel')),
            h('div', { className: 'dsh-archive-rsi-chips' },
              h(DeltaChip, { verdict: item.evaluation.verdict, t }),
              h('span', { className: 'dsh-archive-rsi-mono' }, item.evaluation.metric || t('unset')),
              h('span', { className: 'dsh-archive-rsi-mono' },
                formatMetricValue(item.evaluation.metric, item.evaluation.delta, localeId))))
          : null,
        h('div', { className: 'dsh-archive-rsi-proposalActions' },
          h('span', {
            className: 'dsh-archive-rsi-btnWrap',
            title: adoptHint || '',
          }, h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnPrimary',
            disabled: busy || !canAdopt,
            title: adoptHint || t('adopt'),
            onClick: () => props.onAction(item, 'adopt'),
          }, h(CheckIcon, { size: 14 }), t('adopt'))),
          h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn',
            disabled: busy || !canReject,
            title: canReject ? t('reject') : t('rejectStatusHint'),
            onClick: () => props.onAction(item, 'reject'),
          }, t('reject')),
          h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnGhost',
            disabled: busy || !canRevert,
            title: canRevert ? t('revert') : t('revertStatusHint'),
            onClick: () => props.onAction(item, 'revert'),
          }, t('revert'))));
    }

    // -------------------------------------------------------------------- page

    function ArchiveRsiPage() {
      const { t, localeId } = useLocale();

      const [tab, setTab] = React.useState('archive');
      const [notice, setNotice] = React.useState(null);

      const [overview, setOverview] = React.useState(null);
      const [overviewError, setOverviewError] = React.useState('');

      const [sessions, setSessions] = React.useState([]);
      const [sessionsLoading, setSessionsLoading] = React.useState(true);
      const [sessionsError, setSessionsError] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [statusFilter, setStatusFilter] = React.useState('all');
      const [tagFilter, setTagFilter] = React.useState('all');
      const [sort, setSort] = React.useState({ key: 'createdAt', dir: 'desc' });
      const [selectedId, setSelectedId] = React.useState('');
      const [detail, setDetail] = React.useState(null);
      const [detailLoading, setDetailLoading] = React.useState(false);
      const [detailError, setDetailError] = React.useState('');
      const [transcriptLoading, setTranscriptLoading] = React.useState(false);
      const [transcriptError, setTranscriptError] = React.useState('');
      const [detailKey, setDetailKey] = React.useState(0);
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const [reloadKey, setReloadKey] = React.useState(0);

      const [runs, setRuns] = React.useState([]);
      const [runsLoading, setRunsLoading] = React.useState(true);
      const [runsError, setRunsError] = React.useState('');
      const [runsKey, setRunsKey] = React.useState(0);
      const [selectedRunId, setSelectedRunId] = React.useState('');
      const [run, setRun] = React.useState(null);
      const [runLoading, setRunLoading] = React.useState(false);
      const [runError, setRunError] = React.useState('');

      const [proposals, setProposals] = React.useState([]);
      const [proposalsLoading, setProposalsLoading] = React.useState(true);
      const [proposalsError, setProposalsError] = React.useState('');
      const [proposalFilter, setProposalFilter] = React.useState('proposed');
      const [proposalsKey, setProposalsKey] = React.useState(0);

      // Corpus-wide series for the strip (the host clamps /sessions to 200 rows).
      const [series, setSeries] = React.useState([]);
      const [baselines, setBaselines] = React.useState([]);

      // Synchronous in-flight guard: two clicks can land before the busy state
      // re-renders and would otherwise fire the same mutation twice.
      const pendingRef = React.useRef('');

      const refresh = React.useCallback(() => setReloadKey((value) => value + 1), []);

      React.useEffect(() => {
        let alive = true;
        setOverviewError('');
        api('/overview').then((result) => {
          if (!alive) return;
          if (!result.ok) {
            setOverviewError(result.message);
            setOverview(null);
            return;
          }
          setOverview(normalizeOverview(result.data));
        });
        return () => { alive = false; };
      }, [reloadKey]);

      React.useEffect(() => {
        let alive = true;
        setSessionsLoading(true);
        setSessionsError('');
        const params = ['limit=' + String(LIST_LIMIT), 'status=' + encodeURIComponent(statusFilter)];
        if (tagFilter !== 'all') params.push('tag=' + encodeURIComponent(tagFilter));
        api('/sessions?' + params.join('&')).then((result) => {
          if (!alive) return;
          setSessionsLoading(false);
          if (!result.ok) {
            setSessionsError(result.message);
            setSessions([]);
            return;
          }
          const list = pickArray(result.data, ['entries', 'sessions', 'items']).map(normalizeEntry);
          setSessions(list);
          setSelectedId((previous) => {
            if (previous && list.some((entry) => entry.id === previous)) return previous;
            return '';
          });
        });
        return () => { alive = false; };
      }, [reloadKey, statusFilter, tagFilter]);

      React.useEffect(() => {
        if (!selectedId) {
          setDetail(null);
          setDetailError('');
          setDraft(null);
          setDetailLoading(false);
          return undefined;
        }
        let alive = true;
        setDetailLoading(true);
        setDetailError('');
        setTranscriptLoading(false);
        setTranscriptError('');
        api('/sessions/' + encodeURIComponent(selectedId) + '?transcript=1&maxChars=' + String(TRANSCRIPT_INITIAL_MAX)).then((result) => {
          if (!alive) return;
          setDetailLoading(false);
          if (!result.ok) {
            setDetailError(result.message);
            setDetail(null);
            setDraft(null);
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const entry = normalizeEntry(data.entry || data.session || {});
          if (!entry.id) entry.id = selectedId;
          const transcript = typeof data.transcript === 'string' ? data.transcript : '';
          const transcriptOffset = toNumber(data.transcriptOffset);
          const transcriptTotal = toNumber(data.transcriptTotal);
          setDetail({
            entry,
            facts: normalizeFacts(data.facts),
            transcript,
            transcriptOffset: transcriptOffset !== null ? transcriptOffset : 0,
            transcriptTotal: transcriptTotal !== null ? transcriptTotal : transcript.length,
            transcriptTruncated: Boolean(data.transcriptTruncated),
          });
          setDraft({
            title: entry.title,
            note: entry.note,
            tags: entry.tags.join(', '),
            status: entry.status,
          });
          setSessions((previous) => previous.map((item) => (item.id === entry.id ? entry : item)));
        });
        return () => { alive = false; };
      }, [selectedId, reloadKey, detailKey]);

      React.useEffect(() => {
        let alive = true;
        setRunsLoading(true);
        setRunsError('');
        api('/runs?limit=' + String(RUN_LIMIT)).then((result) => {
          if (!alive) return;
          setRunsLoading(false);
          if (!result.ok) {
            setRunsError(result.message);
            setRuns([]);
            return;
          }
          const list = pickArray(result.data, ['runs', 'items', 'entries']).map(normalizeRun);
          setRuns(list);
          setSelectedRunId((previous) => {
            if (previous && list.some((item) => item.id === previous)) return previous;
            return list.length ? list[0].id : '';
          });
        });
        return () => { alive = false; };
      }, [reloadKey, runsKey]);

      React.useEffect(() => {
        if (!selectedRunId) {
          setRun(null);
          setRunError('');
          setRunLoading(false);
          return undefined;
        }
        let alive = true;
        setRunLoading(true);
        setRunError('');
        api('/runs/' + encodeURIComponent(selectedRunId)).then((result) => {
          if (!alive) return;
          setRunLoading(false);
          if (!result.ok) {
            setRunError(result.message);
            setRun(null);
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const next = normalizeRun(data.run || data);
          setRun(next.id ? next : null);
        });
        return () => { alive = false; };
      }, [selectedRunId, runsKey]);

      React.useEffect(() => {
        let alive = true;
        setProposalsLoading(true);
        setProposalsError('');
        const suffix = proposalFilter === 'all'
          ? '?limit=' + String(RUN_LIMIT)
          : '?status=' + encodeURIComponent(proposalFilter) + '&limit=' + String(RUN_LIMIT);
        api('/proposals' + suffix).then((result) => {
          if (!alive) return;
          setProposalsLoading(false);
          if (!result.ok) {
            // A failed refresh must not blank what is already on screen — the
            // freshly generated items in particular. The banner explains it.
            setProposalsError(result.message);
            return;
          }
          let list = pickArray(result.data, ['proposals', 'items', 'entries']).map(normalizeProposal);
          // If the host ignored ?status, the client still honors the filter.
          if (proposalFilter !== 'all') {
            list = list.filter((item) => item.status === proposalFilter);
          }
          setProposals(list);
        });
        return () => { alive = false; };
      }, [proposalFilter, reloadKey, proposalsKey]);

      React.useEffect(() => {
        let alive = true;
        api('/metrics').then((result) => {
          if (!alive) return;
          if (!result.ok) {
            setSeries([]);
            setBaselines([]);
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          setSeries(asArray(data.series));
          setBaselines(asArray(data.baselines));
        });
        return () => { alive = false; };
      }, [reloadKey]);

      React.useEffect(() => {
        if (!notice) return undefined;
        const timer = window.setTimeout(() => setNotice(null), NOTICE_TTL_MS);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const tagOptions = React.useMemo(() => {
        const seen = new Set(overview ? overview.tags : []);
        for (const entry of sessions) {
          for (const tag of entry.tags) seen.add(tag);
        }
        return Array.from(seen).sort();
      }, [overview, sessions]);

      const visibleSessions = React.useMemo(() => {
        const needle = query.trim().toLowerCase();
        const filtered = sessions.filter((entry) => {
          if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
          if (tagFilter !== 'all' && entry.tags.indexOf(tagFilter) === -1) return false;
          if (!needle) return true;
          const haystack = [
            entry.id,
            entry.title,
            entry.workspace,
            entry.slug,
            entry.note,
            entry.tags.join(' '),
          ].join(' ').toLowerCase();
          return haystack.indexOf(needle) !== -1;
        });
        const column = findColumn(sort.key);
        const factor = sort.dir === 'asc' ? 1 : -1;
        filtered.sort((left, right) => {
          const a = columnValue(left, column);
          const b = columnValue(right, column);
          let result;
          if (typeof a === 'string' || typeof b === 'string') {
            result = String(a).localeCompare(String(b), localeId || 'en');
          } else if (a === b) {
            result = 0;
          } else {
            result = a < b ? -1 : 1;
          }
          if (result !== 0) return result * factor;
          return String(left.id).localeCompare(String(right.id));
        });
        return filtered;
      }, [sessions, statusFilter, tagFilter, query, sort, localeId]);

      const draftDirty = React.useMemo(() => {
        if (!detail || !draft) return false;
        const entry = detail.entry;
        const tags = draft.tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
        if (draft.title !== entry.title) return true;
        if (draft.note !== entry.note) return true;
        if (draft.status !== entry.status) return true;
        return tags.join(' ') !== entry.tags.join(' ');
      }, [detail, draft]);

      const metrics = buildOverviewMetrics(overview, series, baselines);

      function selectSession(sessionId) {
        if (!sessionId) return;
        if (sessionId !== selectedId) {
          setDetail(null);
          setDraft(null);
        }
        setConfirmDelete(false);
        setSelectedId(sessionId);
      }

      function openSessionFromEvidence(sessionId) {
        if (!sessionId) return;
        setTab('archive');
        setSelectedId(sessionId);
        setDetail(null);
        setDraft(null);
        setConfirmDelete(false);
      }

      function toggleSort(key) {
        const column = findColumn(key);
        setSort((previous) => {
          if (previous.key === key) {
            return { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' };
          }
          return { key, dir: column.numeric ? 'desc' : 'asc' };
        });
      }

      async function loadTranscriptMore() {
        if (!detail || !detail.entry || !detail.entry.id) return;
        if (transcriptLoading || !detail.transcriptTruncated) return;
        const entryId = detail.entry.id;
        const offset = typeof detail.transcript === 'string' ? detail.transcript.length : 0;
        setTranscriptLoading(true);
        setTranscriptError('');
        try {
          const result = await fetchTranscriptChunk(entryId, offset, TRANSCRIPT_MORE_MAX);
          if (!result.ok) {
            setTranscriptError(result.message);
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const chunk = typeof data.transcript === 'string' ? data.transcript : '';
          const offsetRaw = toNumber(data.transcriptOffset);
          const totalRaw = toNumber(data.transcriptTotal);
          setDetail((previous) => {
            if (!previous) return previous;
            return {
              ...previous,
              transcript: (previous.transcript || '') + chunk,
              transcriptOffset: offsetRaw !== null ? offsetRaw : offset,
              transcriptTotal: totalRaw !== null ? totalRaw : previous.transcriptTotal,
              transcriptTruncated: Boolean(data.transcriptTruncated),
            };
          });
        } finally {
          setTranscriptLoading(false);
        }
      }

      async function syncSessions() {
        if (pendingRef.current) return;
        pendingRef.current = 'sync';
        setBusy('sync');
        try {
          const result = await api('/sync', { method: 'POST', body: { refresh: false } });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          setNotice({
            kind: 'success',
            text: t('syncDone', {
              imported: formatInt(asCount(data.imported)),
              refreshed: formatInt(asCount(data.refreshed)),
              skipped: formatInt(asCount(data.skipped)),
              failed: formatInt(data.failedCount === undefined
                ? (Array.isArray(data.failed) ? data.failed.length : asCount(data.failed))
                : asCount(data.failedCount)),
            }),
          });
          setReloadKey((value) => value + 1);
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function retagSessions() {
        if (pendingRef.current) return;
        pendingRef.current = 'retag';
        setBusy('retag');
        try {
          const result = await api('/autotag', { method: 'POST', body: { dryRun: false } });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          setNotice({
            kind: 'success',
            text: t('retagDone', {
              updated: formatInt(asCount(data.updated)),
              tags: formatInt(asCount(data.tags)),
            }),
          });
          setReloadKey((value) => value + 1);
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function saveSession() {
        if (!detail || !draft || pendingRef.current) return;
        const entry = detail.entry;
        const body = {};
        if (draft.title !== entry.title) body.title = draft.title;
        if (draft.note !== entry.note) body.note = draft.note;
        if (draft.status !== entry.status) body.status = draft.status;
        const tags = draft.tags.split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
          .filter((tag, index, all) => all.indexOf(tag) === index)
          .slice(0, TAG_LIMIT);
        if (tags.join(' ') !== entry.tags.join(' ')) body.tags = tags;
        if (!Object.keys(body).length) {
          setNotice({ kind: 'info', text: t('nothingToSave') });
          return;
        }
        pendingRef.current = 'save';
        setBusy('save');
        try {
          const result = await api('/sessions/' + encodeURIComponent(entry.id), {
            method: 'PATCH',
            body,
          });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const next = data.entry ? normalizeEntry(data.entry) : null;
          if (next && next.id) {
            setDetail((previous) => (previous ? { ...previous, entry: next } : previous));
            setSessions((previous) => previous.map((item) => (item.id === next.id ? next : item)));
            setDraft({
              title: next.title,
              note: next.note,
              tags: next.tags.join(', '),
              status: next.status,
            });
          } else {
            setDetailKey((value) => value + 1);
          }
          setNotice({ kind: 'success', text: t('saved') });
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function removeSession() {
        if (!detail || pendingRef.current) return;
        if (!confirmDelete) {
          setConfirmDelete(true);
          return;
        }
        const entry = detail.entry;
        pendingRef.current = 'delete';
        setBusy('delete');
        try {
          const result = await api('/sessions/' + encodeURIComponent(entry.id) + '?purge=0', {
            method: 'DELETE',
          });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          setSessions((previous) => previous.filter((item) => item.id !== entry.id));
          setSelectedId('');
          setDetail(null);
          setDraft(null);
          setConfirmDelete(false);
          setNotice({ kind: 'success', text: t('deleteDone') });
          setReloadKey((value) => value + 1);
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function startRun() {
        if (pendingRef.current) return;
        pendingRef.current = 'run';
        setBusy('run');
        try {
          const result = await api('/runs', { method: 'POST', body: {} });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const next = normalizeRun(data.run || data);
          setTab('pdca');
          if (next.id) {
            setRun(next);
            setSelectedRunId(next.id);
            setRuns((previous) => [next].concat(previous.filter((item) => item.id !== next.id)));
          }
          setRunsKey((value) => value + 1);
          setReloadKey((value) => value + 1);
          setNotice({ kind: 'success', text: t('runDone') });
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function generateProposals() {
        if (!run || !run.id || pendingRef.current) return;
        pendingRef.current = 'act';
        setBusy('act');
        try {
          const result = await api('/runs/' + encodeURIComponent(run.id) + '/act', {
            method: 'POST',
            body: {},
          });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          if (data.run) {
            const next = normalizeRun(data.run);
            if (next.id) setRun(next);
          }
          const created = pickArray(data, ['proposals']).map(normalizeProposal);
          // `created` counts what this call actually added; `proposals` may also
          // include ones it reused, so the notice must not claim new cards.
          const added = toNumber(data.created);
          // Show what the POST just created without waiting for the list round
          // trip: the tab must not look unchanged while the refetch is in flight.
          if (created.length) {
            setProposals((previous) => {
              const seen = new Set(previous.map((item) => item.id));
              const fresh = created.filter((item) => item.id && !seen.has(item.id)
                && (proposalFilter === 'all' || item.status === proposalFilter));
              return fresh.length ? fresh.concat(previous) : previous;
            });
          }
          setProposalsKey((value) => value + 1);
          setRunsKey((value) => value + 1);
          setReloadKey((value) => value + 1);
          setNotice({
            kind: 'success',
            text: added !== null
              ? (added > 0
                ? t('proposalsGenerated', { count: formatInt(added) })
                : t('proposalsReused', { count: formatInt(toNumber(data.reused)) }))
              : (created.length
                ? t('proposalsGenerated', { count: formatInt(created.length) })
                : t('proposalsGeneratedNone')),
          });
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      async function actOnProposal(proposal, action) {
        if (!proposal || !proposal.id || pendingRef.current) return;
        pendingRef.current = 'proposal';
        setBusy('proposal:' + proposal.id);
        try {
          let suffix;
          let body;
          if (action === 'adopt') {
            suffix = 'adopt';
            body = { revert: false };
          } else if (action === 'revert') {
            suffix = 'adopt';
            body = { revert: true };
          } else {
            suffix = 'reject';
            body = {};
          }
          const result = await api('/proposals/' + encodeURIComponent(proposal.id) + '/' + suffix, {
            method: 'POST',
            body,
          });
          if (!result.ok) {
            setNotice({ kind: 'error', text: t('actionFailed', { message: result.message }) });
            return;
          }
          const data = result.data && typeof result.data === 'object' ? result.data : {};
          const next = data.proposal ? normalizeProposal(data.proposal) : null;
          if (next && next.id) {
            setProposals((previous) => previous.map((item) => (item.id === next.id ? next : item)));
          }
          setProposalsKey((value) => value + 1);
          // Adopting/rejecting changes the overview counters (待处理提案) too.
          setReloadKey((value) => value + 1);
          setNotice({
            kind: 'success',
            text: action === 'adopt' ? t('adoptedNotice')
              : (action === 'revert' ? t('revertedNotice') : t('rejectedNotice')),
          });
        } finally {
          pendingRef.current = '';
          setBusy('');
        }
      }

      const header = h('div', { className: 'dsh-archive-rsi-header' },
        h('div', { className: 'dsh-archive-rsi-heading' },
          h('h1', { className: 'dsh-archive-rsi-title' }, t('title')),
          h('p', { className: 'dsh-archive-rsi-subtitle' }, t('subtitle'))),
        h('div', { className: 'dsh-archive-rsi-headerRight' },
          h('button', {
            type: 'button',
            className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnGhost',
            onClick: refresh,
            disabled: busy === 'sync',
            title: t('refresh'),
            'aria-label': t('refresh'),
          }, sessionsLoading ? h(Spinner) : h(RefreshIcon, { size: 15 }), h('span', null, t('refresh')))));

      const tabs = [
        { key: 'archive', label: t('tabArchive') },
        { key: 'pdca', label: t('tabPdca') },
        { key: 'proposals', label: t('tabProposals') },
      ];

      const tabBar = h('div', { className: 'dsh-archive-rsi-tabs', role: 'tablist' },
        tabs.map((item) => h('button', {
          key: item.key,
          type: 'button',
          role: 'tab',
          className: 'dsh-archive-rsi-tab',
          'data-active': tab === item.key ? 'true' : 'false',
          'aria-selected': tab === item.key ? 'true' : 'false',
          onClick: () => setTab(item.key),
        }, item.label)));

      // ------------------------------------------------------------- archive tab
      let archiveBody;
      if (sessionsLoading && sessions.length === 0) {
        archiveBody = h('div', { className: 'dsh-archive-rsi-pane' },
          h(Center, { loading: true, title: t('loading') }));
      } else if (sessionsError && sessions.length === 0) {
        archiveBody = h('div', { className: 'dsh-archive-rsi-pane' },
          h(Center, {
            error: t('loadFailed', { message: sessionsError }),
            onRetry: refresh,
            retryLabel: t('retry'),
          }));
      } else {
        const narrowing = statusFilter !== 'all' || tagFilter !== 'all' || query.trim() !== '';
        const noMatch = narrowing || sessions.length > 0;
        const listPane = h('section', {
          className: 'dsh-archive-rsi-pane dsh-archive-rsi-listPane',
          'aria-label': t('searchAria'),
        },
          h('div', { className: 'dsh-archive-rsi-listHead' },
            h('div', { className: 'dsh-archive-rsi-searchWrap' },
              h(SearchIcon, { size: 14 }),
              h('input', {
                type: 'search',
                className: 'dsh-archive-rsi-input dsh-archive-rsi-search',
                value: query,
                placeholder: t('searchPlaceholder'),
                'aria-label': t('searchAria'),
                onChange: (event) => setQuery(event.target.value),
              })),
            h('div', { className: 'dsh-archive-rsi-toolbar' },
              h('label', { className: 'dsh-archive-rsi-selectWrap' },
                h('span', { className: 'dsh-archive-rsi-selectLabel' }, t('filterStatus')),
                h('select', {
                  className: 'dsh-archive-rsi-select',
                  value: statusFilter,
                  onChange: (event) => setStatusFilter(event.target.value),
                },
                  h('option', { key: 'all', value: 'all' }, t('filterAll')),
                  ['archived', 'pinned', 'trash'].map((value) =>
                    h('option', { key: value, value }, statusLabel(value, t))))),
              h('label', { className: 'dsh-archive-rsi-selectWrap' },
                h('span', { className: 'dsh-archive-rsi-selectLabel' }, t('filterTag')),
                h('select', {
                  className: 'dsh-archive-rsi-select',
                  value: tagFilter,
                  onChange: (event) => setTagFilter(event.target.value),
                },
                  h('option', { key: 'all', value: 'all' }, t('filterAll')),
                  tagOptions.map((tag) => h('option', { key: tag, value: tag }, tag)))),
              h('button', {
                type: 'button',
                className: 'dsh-archive-rsi-btn',
                onClick: syncSessions,
                disabled: busy === 'sync',
                title: t('sync'),
              }, busy === 'sync' ? h(Spinner) : h(SyncIcon, { size: 14 }),
              busy === 'sync' ? t('syncing') : t('sync')),
              h('button', {
                type: 'button',
                className: 'dsh-archive-rsi-btn',
                onClick: retagSessions,
                disabled: busy === 'retag',
                title: t('retag'),
              }, busy === 'retag' ? h(Spinner) : null,
              busy === 'retag' ? t('retagging') : t('retag'))),
            h('div', { className: 'dsh-archive-rsi-sidebarMeta' },
              t('sessionsTotal', { count: formatInt(visibleSessions.length) })),
            sessionsError
              ? h(Banner, {
                text: t('loadFailed', { message: sessionsError }),
                onRetry: refresh,
                retryLabel: t('retry'),
              })
              : null),
          h('div', { className: 'dsh-archive-rsi-listScroll' },
            h('div', { className: 'dsh-archive-rsi-rowHead' },
              SORT_COLUMNS.map((column) => h('button', {
                key: column.key,
                type: 'button',
                className: 'dsh-archive-rsi-colBtn' + (column.numeric ? ' dsh-archive-rsi-cellNum' : ''),
                'data-active': sort.key === column.key ? 'true' : 'false',
                title: t(column.labelKey) + ' · '
                  + (sort.key === column.key && sort.dir === 'asc' ? t('sortAsc') : t('sortDesc')),
                onClick: () => toggleSort(column.key),
              }, t(column.labelKey),
              sort.key === column.key
                ? h('span', { className: 'dsh-archive-rsi-sortMark' },
                  sort.dir === 'asc' ? '▲' : '▼')
                : null))),
            visibleSessions.length === 0
              ? h(EmptyState, {
                icon: noMatch
                  ? h(SearchIcon, { size: 22 })
                  : h(ArchiveIcon, { size: 22 }),
                title: noMatch ? t('noMatchTitle') : t('noSessionsTitle'),
                hint: noMatch ? t('noMatchHint') : t('noSessionsHint'),
              })
              : visibleSessions.map((entry) => h(SessionRow, {
                key: entry.id,
                entry,
                t,
                localeId,
                selectedId,
                onSelect: selectSession,
              }))));

        const detailPane = h(SessionDetailPane, {
          t,
          localeId,
          detail,
          draft,
          loading: detailLoading,
          error: detailError ? t('detailFailed', { message: detailError }) : '',
          busy: busy === 'save' || busy === 'delete',
          saving: busy === 'save',
          deleting: busy === 'delete',
          confirmDelete,
          dirty: draftDirty,
          transcriptLoading,
          transcriptError,
          onLoadMore: loadTranscriptMore,
          onRetry: () => setDetailKey((value) => value + 1),
          onDraftChange: (patch) => setDraft((previous) => (previous ? { ...previous, ...patch } : previous)),
          onSave: saveSession,
          onDelete: removeSession,
        });

        archiveBody = h('div', { className: 'dsh-archive-rsi-archive' }, listPane, detailPane);
      }

      // ---------------------------------------------------------------- pdca tab
      let pdcaBody;
      if (runsLoading && runs.length === 0) {
        pdcaBody = h('div', { className: 'dsh-archive-rsi-pane' },
          h(Center, { loading: true, title: t('loading') }));
      } else {
        const runList = h('section', {
          className: 'dsh-archive-rsi-pane dsh-archive-rsi-runList',
          'aria-label': t('runsTitle'),
        },
          h('div', { className: 'dsh-archive-rsi-listHead' },
            h('div', { className: 'dsh-archive-rsi-toolbar' },
              h('button', {
                type: 'button',
                className: 'dsh-archive-rsi-btn dsh-archive-rsi-btnPrimary',
                onClick: startRun,
                disabled: busy === 'run',
              }, busy === 'run' ? h(Spinner) : h(PlayIcon, { size: 14 }),
              busy === 'run' ? t('runningPdca') : t('runPdca'))),
            runsError
              ? h(Banner, { text: t('loadFailed', { message: runsError }), onRetry: refresh, retryLabel: t('retry') })
              : h('div', { className: 'dsh-archive-rsi-sidebarMeta' }, t('runsTitle'))),
          h('div', { className: 'dsh-archive-rsi-listScroll' },
            runs.length === 0
              ? h(EmptyState, {
                icon: h(BeakerIcon, { size: 22 }),
                title: t('runsEmpty'),
                hint: t('runsEmptyHint'),
              })
              : runs.map((item) => h(RunRow, {
                key: item.id,
                run: item,
                t,
                localeId,
                selectedRunId,
                onSelect: (runId) => {
                  if (runId) setSelectedRunId(runId);
                },
              }))));

        const runPane = h('section', { className: 'dsh-archive-rsi-pane dsh-archive-rsi-runPane' },
          h(RunDetail, {
            run,
            t,
            localeId,
            loading: runLoading,
            error: runError ? t('runLoadFailed', { message: runError }) : '',
            busy: busy === 'act',
            onRetry: () => setRunsKey((value) => value + 1),
            onGenerate: generateProposals,
            onOpenSession: openSessionFromEvidence,
          }));

        pdcaBody = h('div', { className: 'dsh-archive-rsi-pdca' }, runList, runPane);
      }

      // ----------------------------------------------------------- proposals tab
      let proposalsBody;
      const proposalFilters = ['proposed', 'adopted', 'rejected', 'reverted', 'all'];
      const proposalToolbar = h('div', { className: 'dsh-archive-rsi-proposalToolbar' },
        h('span', { className: 'dsh-archive-rsi-fieldLabel' }, t('proposalsTitle')),
        h('label', { className: 'dsh-archive-rsi-selectWrap' },
          h('span', { className: 'dsh-archive-rsi-selectLabel' }, t('proposalStatusFilter')),
          h('select', {
            className: 'dsh-archive-rsi-select',
            value: proposalFilter,
            onChange: (event) => setProposalFilter(event.target.value),
          }, proposalFilters.map((value) => h('option', { key: value, value },
            value === 'all' ? t('filterAll') : t(proposalStatusKey(value)))))),
        h('span', { className: 'dsh-archive-rsi-sidebarMeta' },
          t('evidenceCount', { count: formatInt(proposals.length) })));

      if (proposalsLoading && proposals.length === 0) {
        proposalsBody = h('div', { className: 'dsh-archive-rsi-pane' },
          h(Center, { loading: true, title: t('loading') }));
      } else if (proposalsError && proposals.length === 0) {
        proposalsBody = h('div', { className: 'dsh-archive-rsi-pane' },
          h(Center, {
            error: t('loadFailed', { message: proposalsError }),
            onRetry: refresh,
            retryLabel: t('retry'),
          }));
      } else {
        proposalsBody = h('section', { className: 'dsh-archive-rsi-pane dsh-archive-rsi-proposals' },
          h('div', { className: 'dsh-archive-rsi-listHead' },
            proposalToolbar,
            proposalsError
              ? h(Banner, {
                text: t('loadFailed', { message: proposalsError }),
                onRetry: refresh,
                retryLabel: t('retry'),
              })
              : null),
          h('div', { className: 'dsh-archive-rsi-proposalList' },
            proposals.length === 0
              ? h(EmptyState, {
                icon: h(ProposalIcon, { size: 22 }),
                title: proposalFilter === 'all' ? t('proposalsEmpty') : t('proposalsForStatusEmpty'),
                hint: proposalFilter === 'all' ? t('proposalsEmptyHint') : t('proposalsForStatusEmptyHint'),
              })
              : proposals.map((item) => h(ProposalCard, {
                key: item.id,
                proposal: item,
                t,
                localeId,
                busy: busy === 'proposal:' + item.id,
                onAction: actOnProposal,
              }))));
      }

      let body;
      if (tab === 'pdca') body = h('div', { className: 'dsh-archive-rsi-body' }, pdcaBody);
      else if (tab === 'proposals') body = h('div', { className: 'dsh-archive-rsi-body' }, proposalsBody);
      else body = h('div', { className: 'dsh-archive-rsi-body' }, archiveBody);

      return h('div', { className: 'dsh-archive-rsi-page' },
        header,
        overviewError
          ? h(Banner, {
            text: t('loadFailed', { message: overviewError }),
            onRetry: refresh,
            retryLabel: t('retry'),
          })
          : null,
        h(AlchemyStatus, {
          lastRun: overview ? overview.lastRun : null,
          autoRun: overview ? overview.autoRun : null,
          proposals: overview ? overview.proposals : null,
          busy,
          t,
          localeId,
        }),
        h(MetricsStrip, { metrics, t, localeId }),
        tabBar,
        h(Notice, { notice }),
        body);
    }

    // ----------------------------------------------------------------- styles

    const CSS = [
      '.dsh-archive-rsi-page{box-sizing:border-box;display:flex;flex-direction:column;gap:11px;height:100%;min-height:0;padding:20px 22px 22px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.dsh-archive-rsi-page *{box-sizing:border-box}',
      '.dsh-archive-rsi-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.dsh-archive-rsi-heading{min-width:0}',
      '.dsh-archive-rsi-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-headerRight{display:flex;align-items:center;gap:8px;flex:none}',
      '.dsh-archive-rsi-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;flex:none}',
      '.dsh-archive-rsi-metric{min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:6px 10px 7px}',
      '.dsh-archive-rsi-metricLabel{display:block;font-size:10px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-archive-rsi-metricValue{display:block;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-archive-rsi-tabs{display:flex;gap:2px;flex:none;border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-archive-rsi-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;padding:6px 12px;border-radius:7px 7px 0 0;cursor:pointer;white-space:nowrap}',
      '.dsh-archive-rsi-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-tab[data-active="true"]{color:var(--dsw-alias-label-primary);font-weight:600;border-bottom-color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-body{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.dsh-archive-rsi-archive{--rsi-cols:minmax(150px,2fr) minmax(96px,1.1fr) 104px 48px 58px 52px 66px 54px;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,1fr);grid-template-rows:minmax(0,1fr);gap:11px}',
      '.dsh-archive-rsi-pdca{flex:1;min-height:0;display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:11px}',
      '.dsh-archive-rsi-pane{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dsh-archive-rsi-listPane,.dsh-archive-rsi-runList{overflow:hidden}',
      '.dsh-archive-rsi-listHead{display:flex;flex-direction:column;gap:7px;padding:10px 11px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.dsh-archive-rsi-searchWrap{position:relative;display:flex;align-items:center;gap:6px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-searchWrap:focus-within{border-color:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-input{width:100%;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:5px 8px;outline:none}',
      '.dsh-archive-rsi-input:focus{border-color:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-search{border:0;background:transparent;padding:6px 2px}',
      '.dsh-archive-rsi-search:focus{border:0}',
      '.dsh-archive-rsi-textarea{width:100%;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;outline:none;resize:vertical}',
      '.dsh-archive-rsi-textarea:focus{border-color:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.dsh-archive-rsi-selectWrap{display:inline-flex;align-items:center;gap:4px;min-width:0}',
      '.dsh-archive-rsi-selectLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-archive-rsi-select{min-width:0;max-width:150px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;padding:3px 4px;outline:none}',
      '.dsh-archive-rsi-select:focus{border-color:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-sidebarMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-listScroll{flex:1;min-height:0;overflow:auto;padding:5px 6px 7px}',
      '.dsh-archive-rsi-rowHead{display:grid;grid-template-columns:var(--rsi-cols);gap:7px;align-items:center;position:sticky;top:0;z-index:1;padding:3px 6px 4px;background:var(--dsw-alias-bg-layer-1);border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-archive-rsi-colBtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;padding:2px 0;cursor:pointer;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;min-width:0}',
      '.dsh-archive-rsi-colBtn:hover{color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-colBtn[data-active="true"]{color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-colBtn.dsh-archive-rsi-cellNum{justify-content:flex-end}',
      '.dsh-archive-rsi-sortMark{font-size:8px;opacity:.8}',
      '.dsh-archive-rsi-row{display:grid;grid-template-columns:var(--rsi-cols);gap:7px;align-items:center;width:100%;text-align:left;border:0.5px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;padding:6px;cursor:pointer;margin-bottom:1px}',
      '.dsh-archive-rsi-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-archive-rsi-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-cell{min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-archive-rsi-cellTitle{display:flex;align-items:center;gap:5px;font-weight:600}',
      '.dsh-archive-rsi-cellText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsh-archive-rsi-cellNum{text-align:right;justify-content:flex-end;font-variant-numeric:tabular-nums;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-cellDate{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-cellEllipsis{color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-cell[data-warn="true"]{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-statusDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-statusDot[data-status="archived"]{background:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-statusDot[data-status="pinned"]{background:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-statusDot[data-status="trash"]{background:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-detail{overflow-y:auto;overflow-x:hidden}',
      '.dsh-archive-rsi-detailHead{display:flex;flex-direction:column;gap:7px;padding:12px 14px 11px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.dsh-archive-rsi-detailTitleLine{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}',
      '.dsh-archive-rsi-detailTitle{margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere}',
      '.dsh-archive-rsi-detailMeta{display:flex;align-items:center;gap:5px 12px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-metItem{display:inline-flex;align-items:baseline;gap:4px;min-width:0}',
      '.dsh-archive-rsi-metLabel{color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase;letter-spacing:.02em}',
      '.dsh-archive-rsi-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;overflow-wrap:anywhere}',
      '.dsh-archive-rsi-chip{display:inline-flex;align-items:center;gap:4px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10.5px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-archive-rsi-chip[data-status="archived"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-chip[data-status="pinned"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-chip[data-status="trash"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-chip[data-status="proposed"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-chip[data-status="adopted"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-chip[data-status="rejected"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-chip[data-verdict="pass"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-chip[data-verdict="fail"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-chip[data-verdict="inconclusive"]{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-chip[data-delta="improved"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-chip[data-delta="regressed"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-chip[data-kind="advisory"]{border-style:dashed}',
      '.dsh-archive-rsi-chip[data-risk="high"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-chip[data-risk="medium"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-chipCount{font-size:9.5px;opacity:.8;font-variant-numeric:tabular-nums}',
      '.dsh-archive-rsi-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.dsh-archive-rsi-tag{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-archive-rsi-editGrid{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:8px;align-items:start;margin-top:2px}',
      '.dsh-archive-rsi-editGrid .dsh-archive-rsi-field:nth-child(3),.dsh-archive-rsi-editGrid .dsh-archive-rsi-field:nth-child(4),.dsh-archive-rsi-editGrid .dsh-archive-rsi-detailActions{grid-column:1 / -1}',
      '.dsh-archive-rsi-detailActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-archive-rsi-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dsh-archive-rsi-btn{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:22px;padding:0 10px;cursor:pointer;white-space:nowrap}',
      '.dsh-archive-rsi-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-archive-rsi-btn:disabled{opacity:.5;cursor:default}',
      '.dsh-archive-rsi-btnPrimary{border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}',
      '.dsh-archive-rsi-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}',
      '.dsh-archive-rsi-btnGhost{border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 8px}',
      '.dsh-archive-rsi-btnWrap{display:inline-flex;min-width:0}',
      '.dsh-archive-rsi-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-btnDanger[data-confirm="true"]{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}',
      '.dsh-archive-rsi-banner{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;border:0.5px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:11.5px;overflow-wrap:anywhere}',
      '.dsh-archive-rsi-bannerText{flex:1;min-width:0}',
      '.dsh-archive-rsi-notice{flex:none;padding:6px 10px;border-radius:7px;font-size:11.5px;border:0.5px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}',
      '.dsh-archive-rsi-notice[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-notice[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-sections{display:flex;flex-direction:column;gap:9px;padding:10px 14px 14px}',
      '.dsh-archive-rsi-card{flex:none;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);overflow:hidden}',
      '.dsh-archive-rsi-cardHead{display:flex;align-items:center;gap:6px;padding:7px 11px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-archive-rsi-cardIcon{display:inline-flex;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-cardTitle{margin:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-cardCount{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dsh-archive-rsi-cardBody{display:flex;flex-direction:column;gap:9px;padding:9px 11px 11px}',
      '.dsh-archive-rsi-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.dsh-archive-rsi-fieldLabel{font-size:10px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-prose{margin:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dsh-archive-rsi-list{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.dsh-archive-rsi-listItem{line-height:1.55}',
      '.dsh-archive-rsi-kvGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(146px,1fr));gap:5px 12px}',
      '.dsh-archive-rsi-kvRow{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;border-bottom:0.5px dotted var(--dsw-alias-border-l1);padding-bottom:2px}',
      '.dsh-archive-rsi-kvLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-archive-rsi-kvValue{font-size:11.5px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-archive-rsi-tableWrap{width:100%;overflow-x:auto}',
      '.dsh-archive-rsi-table{width:100%;border-collapse:collapse;font-size:11px}',
      '.dsh-archive-rsi-table th{text-align:left;font-weight:600;font-size:9.5px;text-transform:uppercase;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);padding:2px 5px 4px 0;border-bottom:0.5px solid var(--dsw-alias-border-l1);white-space:nowrap}',
      '.dsh-archive-rsi-table td{padding:3px 5px 3px 0;border-bottom:0.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);vertical-align:top}',
      '.dsh-archive-rsi-table tr:last-child td{border-bottom:0}',
      '.dsh-archive-rsi-table th.dsh-archive-rsi-cellNum,.dsh-archive-rsi-table td.dsh-archive-rsi-cellNum{text-align:right}',
      '.dsh-archive-rsi-errorCodes{display:block;font-size:9.5px;color:var(--dsw-alias-state-error-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.dsh-archive-rsi-transcriptHint{margin:0;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-transcriptToolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}',
      '.dsh-archive-rsi-transcriptProgress{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dsh-archive-rsi-transcriptDone{font-size:10.5px;color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-transcriptError{font-size:11px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dsh-archive-rsi-transcript{margin:0;height:min(58vh,640px);min-height:240px;overflow:auto;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;cursor:text;color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-emptyInline{padding:1px 0;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:150px;padding:26px 18px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-emptyIcon{display:inline-flex;opacity:.7}',
      '.dsh-archive-rsi-emptyTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-emptyHint{max-width:360px;font-size:11.5px}',
      '.dsh-archive-rsi-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;min-height:170px;padding:22px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-errorText{max-width:520px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dsh-archive-rsi-spinner{display:inline-block;flex:none;width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:dsh-archive-rsi-spin .8s linear infinite}',
      '@keyframes dsh-archive-rsi-spin{to{transform:rotate(360deg)}}',
      '.dsh-archive-rsi-runRow{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;border:0.5px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;padding:7px 8px;cursor:pointer;margin-bottom:1px}',
      '.dsh-archive-rsi-runRow:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-archive-rsi-runRow[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-runTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-archive-rsi-runId{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsh-archive-rsi-runMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-phaseBadge{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-transform:uppercase;letter-spacing:.02em}',
      '.dsh-archive-rsi-phaseBadge[data-phase="plan"]{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-phaseBadge[data-phase="do"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-phaseBadge[data-phase="check"]{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-phaseBadge[data-phase="act"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-runPane{overflow:hidden}',
      '.dsh-archive-rsi-runDetail{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.dsh-archive-rsi-runDetailHead{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 13px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-panels{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:max-content;gap:9px;padding:10px;align-content:start}',
      '.dsh-archive-rsi-panel{min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;overflow:hidden}',
      '.dsh-archive-rsi-panel[data-phase="act"]{grid-column:1/-1}',
      '.dsh-archive-rsi-panelHead{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-archive-rsi-panelBody{display:flex;flex-direction:column;gap:9px;padding:9px 10px 11px;min-width:0}',
      '.dsh-archive-rsi-cohort{display:flex;align-items:center;gap:5px 10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-findings{display:flex;flex-direction:column;gap:9px}',
      '.dsh-archive-rsi-finding{display:flex;flex-direction:column;gap:4px;min-width:0;border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:8px}',
      '.dsh-archive-rsi-finding:first-child{border-top:0;padding-top:0}',
      '.dsh-archive-rsi-findingHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}',
      '.dsh-archive-rsi-findingTitle{font-size:12px;font-weight:600;overflow-wrap:anywhere;min-width:0}',
      '.dsh-archive-rsi-sevChip{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:9.5px;line-height:15px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-sevChip[data-severity="high"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-sevChip[data-severity="medium"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-rule{color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-advice{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dsh-archive-rsi-adviceLabel{font-weight:600;margin-right:4px}',
      '.dsh-archive-rsi-evidenceRow{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.dsh-archive-rsi-evidenceLink{display:inline-flex;align-items:center;gap:5px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font:inherit;padding:1px 6px;cursor:pointer;max-width:100%}',
      '.dsh-archive-rsi-evidenceLink:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-evidenceSeq{font-size:9.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-panelActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:9px}',
      '.dsh-archive-rsi-runActBtn{margin-left:auto;flex:none}',
      '.dsh-archive-rsi-proposals{overflow:hidden}',
      '.dsh-archive-rsi-proposalToolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-archive-rsi-proposalList{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:9px;padding:9px}',
      '.dsh-archive-rsi-proposal{display:flex;flex-direction:column;gap:7px;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);padding:9px 11px 11px}',
      '.dsh-archive-rsi-proposalHead{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
      '.dsh-archive-rsi-proposalTitle{margin:0;font-size:13px;font-weight:600;overflow-wrap:anywhere;min-width:0}',
      '.dsh-archive-rsi-proposalMeta{display:flex;align-items:center;gap:5px 12px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-proposalBody{margin:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;cursor:text;color:var(--dsw-alias-label-primary);max-height:320px;overflow:auto}',
      '.dsh-archive-rsi-proposalActions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.dsh-archive-rsi-alchemyStatus{display:flex;align-items:center;gap:5px 14px;flex-wrap:wrap;flex:none;min-width:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:5px 10px 6px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-alchemyState{display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-alchemyItem{display:inline-flex;align-items:baseline;gap:4px;min-width:0;white-space:nowrap}',
      '.dsh-archive-rsi-alchemyItemLabel{font-size:10px;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-archive-rsi-alchemyValue{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsh-archive-rsi-alchemyStatus .dsh-archive-rsi-statusDot[data-status="running"]{background:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-alchemyStatus .dsh-archive-rsi-statusDot[data-status="idle"]{background:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-alchemyStatus .dsh-archive-rsi-statusDot[data-status="stalled"]{background:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-alchemyStatus .dsh-archive-rsi-statusDot[data-status="never"]{background:var(--dsw-alias-border-l2)}',
      '.dsh-archive-rsi-runStatus{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:9.5px;line-height:15px;white-space:nowrap;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}',
      '.dsh-archive-rsi-runStatus[data-status="planned"]{border-style:dashed}',
      '.dsh-archive-rsi-runStatus[data-status="running"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dsh-archive-rsi-runStatus[data-status="checked"]{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}',
      '.dsh-archive-rsi-runStatus[data-status="closed"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dsh-archive-rsi-runStatus[data-status="stalled"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsh-archive-rsi-runStatus[data-status="unknown"]{border-style:dashed}',
      '.dsh-archive-rsi-tag[data-auto="true"]{border-style:dashed}',
      '.dsh-archive-rsi-page button:focus-visible,.dsh-archive-rsi-page input:focus-visible,.dsh-archive-rsi-page select:focus-visible,.dsh-archive-rsi-page textarea:focus-visible,.dsh-archive-rsi-page a:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '@media (max-width:1080px){.dsh-archive-rsi-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '@media (max-width:980px){.dsh-archive-rsi-archive{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.dsh-archive-rsi-pdca{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.dsh-archive-rsi-panels{grid-template-columns:minmax(0,1fr)}.dsh-archive-rsi-listPane,.dsh-archive-rsi-runList{max-height:300px}}',
      '@media (max-width:720px){.dsh-archive-rsi-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.dsh-archive-rsi-editGrid{grid-template-columns:minmax(0,1fr)}}',
    ].join('\n');

    function insertStyles() {
      const tagId = 'dsh-archive-rsi/style';
      if (typeof document === 'undefined') return () => {};
      // Replace any stale tag from a previous instance so this run owns the exact
      // tag it removes on unload.
      const previous = document.querySelector('style[data-plugin-css="' + tagId + '"]');
      if (previous && typeof previous.remove === 'function') previous.remove();
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-archive-rsi';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    // ------------------------------------------------------------------- mount

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
        // The sidebar calls this thunk on every locale publish; it resolves through
        // the registered dictionary, with the panel id as the last resort.
        label: () => (runtime ? runtime.t('panelTitle') : PANEL_KEY),
      }, PanelIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, ArchiveRsiPage));
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      // Exposed only for `.verify-client.mjs`: render the real transcript viewer
      // and call the chunk loader to assert the offset request without a live
      // backend. The runtime loader ignores this extra field.
      __verify: { TranscriptCard, fetchTranscriptChunk },
    };
  },
});
