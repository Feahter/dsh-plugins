window.__ModuleLoader__.load({
  id: 'dsh-360',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-360';
    const PANEL_KEY = 'dsh-360';
    const SKILLS_API = '/api/dsh-360/skills';
    const AGENTS_API = '/api/dsh-360/agents';

    // ------------------------------------------------------------------ locale
    // One dictionary for both surfaces. Shared-meaning keys are shared; keys that
    // differ between the two panels are prefixed `skills*` / `agents*`.

    const zh = {
      // top level
      panelTitle: '360 体检',
      title: '360 体检',
      subtitle: '技能与 Agent 配置的六维体检 · 统一 S~E × ±（18 档）等级',
      tabSkills: '技能',
      tabAgents: 'Agents',
      // shared
      refresh: '刷新',
      retry: '重试',
      loading: '正在加载…',
      loadFailed: '加载失败：{message}',
      opFailed: '操作失败：{message}',
      detailLoadFailed: '详情加载失败：{message}',
      export: '导出报告',
      applyAll: '全部安全优化',
      undo: '撤销上次',
      apply: '应用',
      tokensUnit: 'tokens',
      filterGrade: '等级',
      filterVerdict: '结论',
      filterAll: '全部',
      filters: '筛选',
      clearFilters: '清空筛选',
      closeFilters: '收起筛选',
      verdictKeep: '保留',
      verdictWatch: '观察',
      verdictMerge: '合并',
      verdictArchive: '归档',
      scoreLabel: '总分',
      gradeLabel: '等级',
      confidenceLabel: '置信度',
      deltaLabel: '较上次',
      verdictLabel: '结论',
      dimensionsTitle: '六维评分',
      metricsTitle: '关键指标',
      findingsTitle: '问题',
      suggestionsTitle: '建议',
      sourceTitle: '源码',
      viewSource: '查看源码（前 200 行）',
      pathLabel: '路径',
      coverageLabel: '覆盖度',
      coverageFull: '完整',
      coveragePartial: '部分',
      yes: '是',
      no: '否',
      sevCritical: '严重',
      sevMajor: '主要',
      sevMinor: '次要',
      sevInfo: '提示',
      kindAuto: '一键优化',
      kindDraft: '生成草稿',
      evidenceLabel: '证据',
      suggestionLabel: '建议',
      whyLabel: '原因',
      riskLabel: '风险',
      previewLabel: '预览',
      beforeLabel: '之前',
      afterLabel: '之后',
      noFindings: '没有问题，很好。',
      noSuggestions: '没有建议。',
      jumpTo: '跳转',
      applyDone: '已应用，备份 {backupId}，分数 {before} → {after}',
      applyAllDone: '已应用 {count} 项安全优化，备份 {backupId}',
      applyAllNone: '没有可应用的安全优化',
      undoDone: '已撤销备份 {backupId}',
      exportDone: '报告已导出到 {path}',
      labelSep: '：',
      undoMany: '{count} 个备份',
      evolutionTitle: '持续进化',
      evolutionSectionTitle: '持续进化 · 经验与提案',
      evolveEntry: '经验入口',
      evolvePendingBadge: '待进化',
      evolveLessons: '经验数',
      evolveLatest: '最近一条',
      evolveNever: '尚未沉淀',
      evolveLinkedYes: '已接进入口',
      evolveLinkedNo: '未接进入口',
      evolveLastSignal: '最近信号',
      signalCorrections: '纠错',
      signalErrors: '报错',
      signalAsks: '追问',
      evolvePendingTitle: '待闭环提案',
      evolveNoTrigger: '（未记录触发摘要）',
      evolveTrigger: '触发',
      evolveEvidence: '证据',
      evolveRuleHint: '必填：一句话写清下次遇到这个触发该怎么做。',
      evolveCancel: '取消',
      statAvg: '平均分',
      statGrades: 'S~E 分布',
      // classification + human-first summary (taxonomy supplies value labels)
      axisRole: '职责',
      axisLayer: '层级',
      axisKind: '类型',
      axisScope: '范围',
      axisGrade: '等级',
      moreFilters: '更多筛选',
      classificationTitle: '分类',
      classificationRole: '职责',
      classificationLayer: '层级',
      classificationKind: '类型',
      classificationScope: '范围',
      classificationState: '状态',
      classificationConfidence: '置信度 {value}',
      classificationEvidence: '依据：{value}',
      classificationFilterRole: '按职责筛选',
      classificationEmpty: '这次扫描还没有分类信息；宿主升级后会自动出现职责、类型与范围。',
      dataTime: '数据时间 {time}',
      summarySkills: '{count} 个技能，{need} 个待处理；最该先看 {top}',
      summaryAgents: '{count} 个对象，{need} 个待处理；最该先看 {top}',
      summaryOkSkills: '{count} 个技能，全部状态良好',
      summaryOkAgents: '{count} 个对象，全部状态良好',
      trendLine: '较上次平均分 {delta}，{changed} 项变化',
      trendDeltaOnly: '较上次平均分 {delta}',
      trendChangedOnly: '较上次 {changed} 项变化',
      staleBanner: '更新于 {time}，正在刷新',
      staleFailed: '更新于 {time}，刷新失败：{message}',
      effectNow: '本次优化',
      effectLast: '上次优化',
      effectLine: '{title}：{items} 项，分数 {before} → {after}（{delta}），省 {tokens} tokens',
      effectTokensUp: '{title}：{items} 项，分数 {before} → {after}（{delta}），常驻 token +{tokens}',
      effectLineNoTokens: '{title}：{items} 项，分数 {before} → {after}（{delta}）',
      effectUps: '升级 {count} 项',
      effectVerdicts: '结论变化 {count} 项',
      effectToastItem: '{name} {before} → {after}',
      applyToastItems: '已应用，备份 {backupId}；{items}',
      applyAllToastItems: '已应用 {count} 项安全优化，备份 {backupId}；{items}',
      // skills surface (skills* prefix on conflicts)
      skillsSubtitle: '按需加载 / 渐进披露 / 可执行性 / 边界 / 卫生 / 持续进化 六维评分',
      skillsSearchPlaceholder: '搜索名称 / 描述…',
      skillsOnlyProblems: '只看有 major+ 问题',
      skillsCount: '{count} 个技能',
      skillsNoMatch: '没有匹配的技能',
      skillsNoMatchHint: '调整搜索或筛选条件，或点击刷新。',
      skillsNoSelection: '选择一个技能',
      skillsNoSelectionHint: '从左侧列表选择一个技能，查看它的六维体检详情。',
      skillsEmptyTitle: '还没有技能',
      skillsEmptyHint: '请先在「设置 → 技能」添加技能，然后回来刷新。',
      skillsConfirmApplyAll: '确认对全部技能应用所有安全优化（auto 动作）？此操作会写盘并生成备份，可撤销。',
      skillsConfirmUndo: '确认撤销上次的修改？撤销会用备份覆盖 apply 之后对该技能文件的改动。',
      skillsUsageLine: '加载 {count} 次 · 每周 {perWeek}',
      skillsOverlapsTitle: '重叠技能',
      skillsNoOverlaps: '没有重叠技能。',
      skillsNotScored: '本维度不评分',
      skillsEvolutionNotScored: '窗口内没有按需加载样本，本维度不评分；其余五维按 90 分折算为 100。',
      skillsEvolveSignals: '调用后信号',
      skillsSignalReloads: '重复加载',
      skillsSignalFailures: '失败',
      skillsEvolveNoPending: '没有待闭环的信号，经验已跟上最近调用。',
      skillsEvolveEmptyLessons: '还没有沉淀任何经验；下次加载读不到这条路径的经验。',
      skillsEvolveEmptySignals: '窗口内没有调用后信号。',
      skillsEvolveButton: '沉淀经验',
      skillsEvolveEditorTitle: '沉淀经验',
      skillsEvolveRule: '做法',
      skillsEvolveRuleRequired: '做法不能为空：先写一条可执行的规则。',
      skillsEvolveWrite: '写入经验',
      skillsEvolveNote: '补一条“触发→做法”，写入 references/lessons.md 并接进入口。',
      skillsEvolveDone: '经验已写入，备份 {backupId}，分数 {before} → {after}',
      skillsConfirmEvolve: '确认把这条经验写入 {name} 的 references/lessons.md？会写盘并生成备份，可撤销。',
      skillsKindManual: '手动处理',
      skillsDraftNote: '将生成新文字（改写内容），默认不进入「全部安全优化」。',
      // skills-only keys
      applyAllSkill: '本技能全部安全优化',
      confirmApplyAllSkill: '确认对该技能应用所有安全优化（auto 动作）？此操作会写盘并生成备份，可撤销。',
      statSkills: '技能数',
      statCatalogTokens: '实测目录成本',
      statFullTokens: '全量加载成本',
      statZeroUse: '零按需加载',
      filterSource: '来源',
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
      signalLoads: '加载',
      // agents surface (agents* prefix on conflicts)
      agentsSubtitle: '注入命中 / 分层与精简 / 可执行性 / 边界与治理 / 维护卫生 / 持续进化 六维评分',
      agentsSearchPlaceholder: '搜索名称 / 路径…',
      agentsOnlyProblems: '只看 major+ 问题',
      agentsCount: '{count} 个对象',
      agentsNoMatch: '没有匹配的对象',
      agentsNoMatchHint: '调整搜索或筛选条件，或点击刷新。',
      agentsNoSelection: '选择一个对象',
      agentsNoSelectionHint: '从左侧列表选择一个说明书 / 子代理 / 预设，查看它的六维体检详情。',
      agentsEmptyTitle: '还没有扫描到对象',
      agentsEmptyHint: '没有找到说明书 / 子代理 / 预设。请检查 cordis 配置里的 roots（扫描根）是否覆盖了 AGENTS.md、CLAUDE.md、instructions.md 或 agents/*.md。',
      agentsConfirmApplyAll: '确认对全部对象应用所有安全优化（auto 动作）？会写盘并生成备份，可撤销。',
      agentsConfirmUndo: '确认撤销上次的修改？撤销会用备份覆盖 apply 之后对该文件的改动。',
      agentsUsageLine: '使用 {count} 次 · 每周 {perWeek}',
      agentsOverlapsTitle: '重叠对象',
      agentsNoOverlaps: '没有重叠对象。',
      agentsNotScored: '不评分',
      agentsEvolutionNotScored: '窗口内没有使用样本，本维度不评分；其余五维按 90 分折算为 100。',
      agentsEvolveSignals: '生效后信号',
      agentsSignalReloads: '重复注入',
      agentsSignalFailures: '失败回合',
      agentsEvolveNoPending: '没有待闭环的信号，经验已跟上最近信号。',
      agentsEvolveEmptyLessons: '还没有沉淀任何规则；下次注入读不到这条路径的经验。',
      agentsEvolveEmptySignals: '窗口内没有生效后信号。',
      agentsEvolveButton: '沉淀规则',
      agentsEvolveEditorTitle: '沉淀规则',
      agentsEvolveRule: '规则',
      agentsEvolveRuleRequired: '规则不能为空：先写一条可执行的规则。',
      agentsEvolveWrite: '写入规则',
      agentsEvolveNote: '补一条「触发→规则」，写入 .agents-360/lessons.md 并接进注入路径。',
      agentsEvolveDone: '规则已写入，备份 {backupId}，分数 {before} → {after}',
      agentsConfirmEvolve: '确认把这条规则写入 {name}？会写盘并生成备份，可撤销。',
      agentsKindManual: '只读建议',
      agentsDraftNote: '将生成新文字，默认不进入「全部安全优化」。',
      // agents-only keys
      applyAllSubject: '本对象全部安全优化',
      confirmApplyAllSubject: '确认对该对象应用所有安全优化（auto 动作）？会写盘并生成备份，可撤销。',
      backupLabel: '上次备份',
      backupNone: '—',
      statSubjects: '对象数',
      statResidentTokens: '实测常驻成本',
      statZeroInject: '有暴露零注入',
      statConflicts: '跨文件冲突',
      filterKind: '类型',
      filterScope: '作用域',
      onlyEvolution: '只看待进化',
      kindInstruction: '说明书',
      kindAgent: '子代理',
      kindPreset: '预设',
      kindLabel: '类型',
      scopeGlobal: '全局',
      scopeProject: '项目',
      scopeProfile: '预设档',
      scopeSkill: '技能',
      scopeLabel: '作用域',
      verdictTrim: '精简',
      injectionTitle: '注入证据',
      conflictsTitle: '跨文件冲突',
      ownerLabel: '归属技能',
      usageTitle: '使用情况',
      injMode: '注入方式',
      injSessionsInjected: '注入会话 / 覆盖会话',
      injTokens: '每次注入',
      injLast: '最近注入',
      injDup: '重复说明',
      injNever: '未观测到注入',
      injShort: '注入 {injected}/{seen}',
      injMissing: '无注入证据',
      modeAlways: '常驻',
      modeWorkspace: '按工作区',
      modeOnDemand: '按需',
      modeConfig: '配置生效',
      dimInject: '注入命中',
      dimLayer: '分层与精简',
      dimActionable: '可执行性',
      dimGovernance: '边界与治理',
      dimHygiene: '维护卫生',
      dimEvolution: '持续进化',
      mEstTokens: '估算 tokens',
      mChars: '字符数',
      mLines: '正文行数',
      mHeadings: '标题数',
      mH2: 'H2 数',
      mImperatives: '祈使规则',
      mBullets: '要点',
      mSteps: '编号步骤',
      mCommands: '命令',
      mCodeBlocks: '代码块',
      mCodeRatio: '代码占比',
      mSections: '章节',
      mLocalLinks: '本地链接',
      mStaleRefs: '失效引用',
      mDupSentences: '重复句',
      mBuiltinOverlap: '与内置提示重复',
      mTodos: '待办占位',
      mSecrets: '疑似密钥',
      mDangerous: '危险命令',
      mBakFiles: '备份污染',
      mFrontmatter: 'frontmatter',
      fmOk: '正常',
      fmMissing: '缺失',
      usageSessions: '使用会话',
      usagePerWeek: '每周使用',
      usageExposure: '暴露天数',
      usagePresetSessions: '预设会话',
      usageSubagentRuns: '委派次数',
      manualNote: '只读建议：需人工判断后手动修改，面板不会写盘。',
      noConflicts: '没有跨文件冲突。',
      conflictDuplicate: '重复',
      conflictContradiction: '矛盾',
      ruleSelf: '本文规则',
      ruleOther: '对方规则',
      conflictOther: '冲突对象',
      conflictLines: '位置：{other} ↔ 本文第 {self} 行',
      emptyRoots: '扫描根：{roots}',
      emptyNoRoots: '未配置 roots（默认 cwd、~/.agents、~/.deepseek）',
      signalSessions: '会话',
    };

    const en = {
      panelTitle: '360 Checkup',
      title: '360 Checkup',
      subtitle: 'Six-dimension checkup for skills and agent configs · unified S~E × ± (18 grades)',
      tabSkills: 'Skills',
      tabAgents: 'Agents',
      refresh: 'Refresh',
      retry: 'Retry',
      loading: 'Loading…',
      loadFailed: 'Failed to load: {message}',
      opFailed: 'Action failed: {message}',
      detailLoadFailed: 'Failed to load detail: {message}',
      export: 'Export report',
      applyAll: 'Apply all safe',
      undo: 'Undo last',
      apply: 'Apply',
      tokensUnit: 'tokens',
      filterGrade: 'Grade',
      filterVerdict: 'Verdict',
      filterAll: 'All',
      filters: 'Filters',
      clearFilters: 'Clear filters',
      closeFilters: 'Hide filters',
      verdictKeep: 'Keep',
      verdictWatch: 'Watch',
      verdictMerge: 'Merge',
      verdictArchive: 'Archive',
      scoreLabel: 'Score',
      gradeLabel: 'Grade',
      confidenceLabel: 'Confidence',
      deltaLabel: 'Δ vs last',
      verdictLabel: 'Verdict',
      dimensionsTitle: 'Six dimensions',
      metricsTitle: 'Metrics',
      findingsTitle: 'Findings',
      suggestionsTitle: 'Suggestions',
      sourceTitle: 'Source',
      viewSource: 'View source (first 200 lines)',
      pathLabel: 'Path',
      coverageLabel: 'Coverage',
      coverageFull: 'Full',
      coveragePartial: 'Partial',
      yes: 'Yes',
      no: 'No',
      sevCritical: 'Critical',
      sevMajor: 'Major',
      sevMinor: 'Minor',
      sevInfo: 'Info',
      kindAuto: 'Optimize',
      kindDraft: 'Generate draft',
      evidenceLabel: 'Evidence',
      suggestionLabel: 'Suggestion',
      whyLabel: 'Why',
      riskLabel: 'Risk',
      previewLabel: 'Preview',
      beforeLabel: 'Before',
      afterLabel: 'After',
      noFindings: 'No findings. Good.',
      noSuggestions: 'No suggestions.',
      jumpTo: 'Open',
      applyDone: 'Applied, backup {backupId}, score {before} → {after}',
      applyAllDone: 'Applied {count} safe fixes, backup {backupId}',
      applyAllNone: 'No safe fixes to apply',
      undoDone: 'Undid backup {backupId}',
      exportDone: 'Report exported to {path}',
      labelSep: ': ',
      undoMany: '{count} backups',
      evolutionTitle: 'Continuous evolution',
      evolutionSectionTitle: 'Continuous evolution · lessons & proposals',
      evolveEntry: 'Lesson entry',
      evolvePendingBadge: 'Needs lesson',
      evolveLessons: 'Lessons',
      evolveLatest: 'Latest',
      evolveNever: 'None yet',
      evolveLinkedYes: 'Linked',
      evolveLinkedNo: 'Not linked',
      evolveLastSignal: 'Last signal',
      signalCorrections: 'Corrections',
      signalErrors: 'Errors',
      signalAsks: 'Asks',
      evolvePendingTitle: 'Open proposals',
      evolveNoTrigger: '(no trigger summary recorded)',
      evolveTrigger: 'Trigger',
      evolveEvidence: 'Evidence',
      evolveRuleHint: 'Required: one sentence on what to do when this trigger appears.',
      evolveCancel: 'Cancel',
      statAvg: 'Avg score',
      statGrades: 'S~E',
      axisRole: 'Role',
      axisLayer: 'Layer',
      axisKind: 'Kind',
      axisScope: 'Scope',
      axisGrade: 'Grade',
      moreFilters: 'More filters',
      classificationTitle: 'Classification',
      classificationRole: 'Role',
      classificationLayer: 'Layer',
      classificationKind: 'Kind',
      classificationScope: 'Scope',
      classificationState: 'State',
      classificationConfidence: 'Confidence {value}',
      classificationEvidence: 'Evidence: {value}',
      classificationFilterRole: 'Filter by role',
      classificationEmpty: 'This scan has no classification yet; role, kind, and scope appear once the host supplies them.',
      dataTime: 'Data time {time}',
      summarySkills: '{count} skills, {need} need attention; start with {top}',
      summaryAgents: '{count} subjects, {need} need attention; start with {top}',
      summaryOkSkills: '{count} skills, everything looks healthy',
      summaryOkAgents: '{count} subjects, everything looks healthy',
      trendLine: 'Since last scan: average {delta}, {changed} changed',
      trendDeltaOnly: 'Since last scan: average {delta}',
      trendChangedOnly: '{changed} changed since last scan',
      staleBanner: 'Updated {time}, refreshing',
      staleFailed: 'Updated {time}, refresh failed: {message}',
      effectNow: 'This optimization',
      effectLast: 'Last optimization',
      effectLine: '{title}: {items} items, score {before} → {after} ({delta}), saved {tokens} tokens',
      effectTokensUp: '{title}: {items} items, score {before} → {after} ({delta}), resident tokens +{tokens}',
      effectLineNoTokens: '{title}: {items} items, score {before} → {after} ({delta})',
      effectUps: 'Grade up: {count}',
      effectVerdicts: 'Verdict changed: {count}',
      effectToastItem: '{name} {before} → {after}',
      applyToastItems: 'Applied, backup {backupId}; {items}',
      applyAllToastItems: 'Applied {count} safe fixes, backup {backupId}; {items}',
      skillsSubtitle: 'Score skills across on-demand loading, progressive disclosure, actionability, boundary, hygiene, and continuous evolution',
      skillsSearchPlaceholder: 'Search name / description…',
      skillsOnlyProblems: 'Only major+ issues',
      skillsCount: '{count} skills',
      skillsNoMatch: 'No matching skills',
      skillsNoMatchHint: 'Change the search or filters, or refresh.',
      skillsNoSelection: 'Select a skill',
      skillsNoSelectionHint: 'Pick a skill on the left to see its six-dimension report.',
      skillsEmptyTitle: 'No skills yet',
      skillsEmptyHint: 'Add skills in Settings → Skills, then come back and refresh.',
      skillsConfirmApplyAll: 'Apply all safe (auto) fixes to every skill? This writes to disk with a backup; it can be undone.',
      skillsConfirmUndo: 'Undo the last change? This restores the backup and overwrites edits made to the skill after the fix.',
      skillsUsageLine: '{count} loads · {perWeek}/wk',
      skillsOverlapsTitle: 'Overlaps',
      skillsNoOverlaps: 'No overlapping skills.',
      skillsNotScored: 'Not scored this window',
      skillsEvolutionNotScored: 'No on-demand loads this window, so this dimension is not scored; the other five are rescaled to 100.',
      skillsEvolveSignals: 'Post-load signals',
      skillsSignalReloads: 'Reloads',
      skillsSignalFailures: 'Failures',
      skillsEvolveNoPending: 'Nothing pending; lessons cover the latest signals.',
      skillsEvolveEmptyLessons: 'No lessons yet; the next load has nothing from past runs to read.',
      skillsEvolveEmptySignals: 'No post-load signals this window.',
      skillsEvolveButton: 'Add lesson',
      skillsEvolveEditorTitle: 'Add lesson',
      skillsEvolveRule: 'Rule',
      skillsEvolveRuleRequired: 'Rule is required — write one actionable sentence first.',
      skillsEvolveWrite: 'Write lesson',
      skillsEvolveNote: 'Add a trigger → rule pair, written to references/lessons.md and linked into the body.',
      skillsEvolveDone: 'Lesson written, backup {backupId}, score {before} → {after}',
      skillsConfirmEvolve: 'Write this lesson into {name}\'s references/lessons.md? This writes to disk with a backup and can be undone.',
      skillsKindManual: 'Manual',
      skillsDraftNote: 'Generates new text (rewrites content); excluded from "Apply all safe".',
      applyAllSkill: 'Apply all safe (this skill)',
      confirmApplyAllSkill: 'Apply all safe (auto) fixes to this skill? This writes to disk with a backup; it can be undone.',
      statSkills: 'Skills',
      statCatalogTokens: 'Measured catalog cost',
      statFullTokens: 'Full-load cost',
      statZeroUse: 'Zero on-demand loads',
      filterSource: 'Source',
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
      signalLoads: 'Loads',
      agentsSubtitle: 'Score agent configs across injection hit, layering, actionability, boundary, hygiene, and continuous evolution',
      agentsSearchPlaceholder: 'Search name / path…',
      agentsOnlyProblems: 'Only major+ issues',
      agentsCount: '{count} subjects',
      agentsNoMatch: 'No matching subjects',
      agentsNoMatchHint: 'Change the search or filters, or refresh.',
      agentsNoSelection: 'Select a subject',
      agentsNoSelectionHint: 'Pick an instruction, subagent definition, or preset on the left to see its six-dimension report.',
      agentsEmptyTitle: 'No subjects scanned yet',
      agentsEmptyHint: 'No instruction, subagent definition, or preset was found. Check the cordis roots so they cover AGENTS.md, CLAUDE.md, instructions.md, or agents/*.md.',
      agentsConfirmApplyAll: 'Apply all safe (auto) fixes to every subject? This writes to disk with a backup; it can be undone.',
      agentsConfirmUndo: 'Undo the last change? This restores the backup and overwrites edits made after the fix.',
      agentsUsageLine: '{count} uses · {perWeek}/wk',
      agentsOverlapsTitle: 'Overlaps',
      agentsNoOverlaps: 'No overlapping subjects.',
      agentsNotScored: 'Not scored',
      agentsEvolutionNotScored: 'No usage samples this window, so this dimension is not scored; the other five are rescaled to 100.',
      agentsEvolveSignals: 'Post-injection signals',
      agentsSignalReloads: 'Reloads',
      agentsSignalFailures: 'Failed turns',
      agentsEvolveNoPending: 'Nothing pending; lessons cover the latest signals.',
      agentsEvolveEmptyLessons: 'No lessons yet; the next injection has nothing from past runs to read.',
      agentsEvolveEmptySignals: 'No post-injection signals this window.',
      agentsEvolveButton: 'Add lesson',
      agentsEvolveEditorTitle: 'Add lesson',
      agentsEvolveRule: 'Rule',
      agentsEvolveRuleRequired: 'Rule is required — write one actionable sentence first.',
      agentsEvolveWrite: 'Write lesson',
      agentsEvolveNote: 'Add a trigger → rule pair, written to .agents-360/lessons.md and linked into the injection path.',
      agentsEvolveDone: 'Lesson written, backup {backupId}, score {before} → {after}',
      agentsConfirmEvolve: 'Write this lesson into {name}? This writes to disk with a backup and can be undone.',
      agentsKindManual: 'Read only',
      agentsDraftNote: 'Generates new text (rewrites content); excluded from "Apply all safe".',
      applyAllSubject: 'Apply all safe (this subject)',
      confirmApplyAllSubject: 'Apply all safe (auto) fixes to this subject? This writes to disk with a backup; it can be undone.',
      backupLabel: 'Last backup',
      backupNone: '—',
      statSubjects: 'Subjects',
      statResidentTokens: 'Measured resident cost',
      statZeroInject: 'Exposed but never injected',
      statConflicts: 'Cross-file conflicts',
      filterKind: 'Kind',
      filterScope: 'Scope',
      onlyEvolution: 'Only needs lesson',
      kindInstruction: 'Instruction',
      kindAgent: 'Subagent',
      kindPreset: 'Preset',
      kindLabel: 'Kind',
      scopeGlobal: 'Global',
      scopeProject: 'Project',
      scopeProfile: 'Profile',
      scopeSkill: 'Skill',
      scopeLabel: 'Scope',
      verdictTrim: 'Trim',
      injectionTitle: 'Injection evidence',
      conflictsTitle: 'Cross-file conflicts',
      ownerLabel: 'Skill owner',
      usageTitle: 'Usage',
      injMode: 'Mode',
      injSessionsInjected: 'Injected / seen sessions',
      injTokens: 'Per injection',
      injLast: 'Last injected',
      injDup: 'Duplicated with',
      injNever: 'No injection observed',
      injShort: 'injected {injected}/{seen}',
      injMissing: 'no injection evidence',
      modeAlways: 'Always',
      modeWorkspace: 'Workspace',
      modeOnDemand: 'On demand',
      modeConfig: 'Config',
      dimInject: 'Injection hit',
      dimLayer: 'Layer & trim',
      dimActionable: 'Actionability',
      dimGovernance: 'Boundary & governance',
      dimHygiene: 'Hygiene',
      dimEvolution: 'Evolution',
      mEstTokens: 'Est. tokens',
      mChars: 'Chars',
      mLines: 'Body lines',
      mHeadings: 'Headings',
      mH2: 'H2 count',
      mImperatives: 'Imperative rules',
      mBullets: 'Bullets',
      mSteps: 'Numbered steps',
      mCommands: 'Commands',
      mCodeBlocks: 'Code blocks',
      mCodeRatio: 'Code ratio',
      mSections: 'Sections',
      mLocalLinks: 'Local links',
      mStaleRefs: 'Stale refs',
      mDupSentences: 'Duplicate sentences',
      mBuiltinOverlap: 'Builtin overlap',
      mTodos: 'TODOs',
      mSecrets: 'Secrets',
      mDangerous: 'Dangerous commands',
      mBakFiles: 'Backup files',
      mFrontmatter: 'Frontmatter',
      fmOk: 'OK',
      fmMissing: 'Missing',
      usageSessions: 'Sessions used',
      usagePerWeek: 'Per week',
      usageExposure: 'Exposure days',
      usagePresetSessions: 'Preset sessions',
      usageSubagentRuns: 'Delegations',
      manualNote: 'Read-only advice: apply by hand, the panel never writes for this one.',
      noConflicts: 'No cross-file conflicts.',
      conflictDuplicate: 'Duplicate',
      conflictContradiction: 'Contradiction',
      ruleSelf: 'This file',
      ruleOther: 'Other file',
      conflictOther: 'Conflicts with',
      conflictLines: 'at {other} ↔ this file line {self}',
      emptyRoots: 'Scan roots: {roots}',
      emptyNoRoots: 'No roots configured (defaults: cwd, ~/.agents, ~/.deepseek)',
      signalSessions: 'Sessions',
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

    // --------------------------------------------------------------------- api

    async function api(prefix, path, options) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(prefix + path, {
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
        if (!body) throw new Error('Empty response from the dsh-360 route.');
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

    function fmtPoints(value) {
      if (value == null || !Number.isFinite(Number(value))) return '—';
      const n = Number(value);
      return Number.isInteger(n) ? String(n) : fmt1(n);
    }

    function formatTokens(value) {
      if (value == null || !Number.isFinite(Number(value))) return '—';
      const n = Number(value);
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(Math.round(n));
    }

    function formatPercent(value) {
      if (value == null || !Number.isFinite(Number(value))) return '—';
      return Math.round(Number(value) * 100) + '%';
    }

    function countOf(value) {
      if (value == null) return '—';
      if (Array.isArray(value)) return String(value.length);
      if (!Number.isFinite(Number(value))) return '—';
      return String(Number(value));
    }

    function numberOr(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    // Grade display: badge shows score.grade (18-bucket code), colour is keyed
    // by score.letter (S/A/B/C/D/E). Fall back to the first char of the code.
    function gradeLetterOf(score) {
      if (score && typeof score.letter === 'string' && score.letter) return score.letter;
      const code = score && score.grade;
      if (typeof code === 'string' && code.length) return code[0];
      return '';
    }

    function gradeBadgeClass(prefix, score) {
      const letter = gradeLetterOf(score);
      return prefix + 'grade ' + prefix + 'grade' + (letter || '');
    }

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

    function formatDateTime(value) {
      if (value == null || value === '') return '—';
      const date = new Date(Number(value));
      if (!Number.isFinite(date.getTime())) return '—';
      const pad = (n) => (n < 10 ? '0' + n : String(n));
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function formatInt(value) {
      if (value == null || !Number.isFinite(Number(value))) return '—';
      return String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function signed1(value) {
      if (value == null || !Number.isFinite(Number(value))) return '—';
      const n = Number(value);
      return (n > 0 ? '+' : '') + fmt1(n);
    }

    // ---------------------------------------------------------- classification
    // Value labels are taxonomy-first. The client never keeps its own role list:
    // `portfolio.taxonomy` wins, then the per-item classification label, then the
    // raw id (which is also the only path an old host without taxonomy can take).

    function classificationOf(item) {
      const value = item && item.classification;
      return value && typeof value === 'object' ? value : null;
    }

    function axisEntryOf(item, axis) {
      const classification = classificationOf(item);
      if (!classification) return null;
      const entry = classification[axis];
      if (!entry) return null;
      if (typeof entry === 'string') return { id: entry, label: '' };
      return typeof entry === 'object' ? entry : null;
    }

    function axisIdOf(item, axis) {
      const entry = axisEntryOf(item, axis);
      if (entry && typeof entry.id === 'string' && entry.id) return entry.id;
      // Older hosts expose kind/scope directly on the subject; keep that readable.
      if (axis === 'kind' && item && typeof item.kind === 'string') return item.kind;
      if (axis === 'scope' && item && typeof item.scope === 'string') return item.scope;
      return '';
    }

    function taxonomyIndex(taxonomy) {
      const axes = {};
      const order = [];
      const list = taxonomy && Array.isArray(taxonomy.axes) ? taxonomy.axes : [];
      for (const axis of list) {
        if (!axis || typeof axis.id !== 'string' || !axis.id) continue;
        const values = {};
        const valueOrder = [];
        const entries = Array.isArray(axis.values) ? axis.values : [];
        for (const value of entries) {
          if (!value || typeof value.id !== 'string' || !value.id) continue;
          values[value.id] = value;
          valueOrder.push(value.id);
        }
        axes[axis.id] = { id: axis.id, label: axis.label || axis.id, values, valueOrder };
        order.push(axis.id);
      }
      return { axes, order };
    }

    function taxonomyLabelOf(tax, axis, id) {
      const bucket = tax && tax.axes ? tax.axes[axis] : null;
      const value = bucket && id ? bucket.values[id] : null;
      return value && typeof value.label === 'string' && value.label ? value.label : '';
    }

    function axisLabelOf(tax, item, axis, t, fallbackKeys) {
      const id = axisIdOf(item, axis);
      if (!id) return '';
      const fromTaxonomy = taxonomyLabelOf(tax, axis, id);
      if (fromTaxonomy) return fromTaxonomy;
      const entry = axisEntryOf(item, axis);
      if (entry && typeof entry.label === 'string' && entry.label) return entry.label;
      const key = fallbackKeys && fallbackKeys[id];
      if (key) return t(key);
      return id;
    }

    function classificationSummaryOf(item) {
      const classification = classificationOf(item);
      const summary = classification && classification.summary;
      return typeof summary === 'string' && summary.trim() ? summary.trim() : '';
    }

    function classificationLabelMapOf(items, axis) {
      const map = {};
      for (const item of items || []) {
        const id = axisIdOf(item, axis);
        const entry = axisEntryOf(item, axis);
        if (id && entry && typeof entry.label === 'string' && entry.label && !map[id]) {
          map[id] = entry.label;
        }
      }
      return map;
    }

    function stateEntriesOf(item, tax, pendingFallbackLabel) {
      const classification = classificationOf(item);
      const raw = classification && classification.state;
      const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const entries = [];
      for (const value of list) {
        if (!value) continue;
        const id = typeof value === 'string' ? value : value.id;
        if (!id) continue;
        const label = taxonomyLabelOf(tax, 'state', id)
          || (typeof value === 'object' && typeof value.label === 'string' && value.label)
          || id;
        entries.push({ id, label });
      }
      if (entries.length === 0 && pendingFallbackLabel) {
        entries.push({ id: 'pending', label: pendingFallbackLabel });
      }
      return entries;
    }

    function axisCountsOf(items, axis, totalsMap) {
      if (totalsMap && typeof totalsMap === 'object' && Object.keys(totalsMap).length > 0) {
        return totalsMap;
      }
      const counts = {};
      for (const item of items || []) {
        const id = axisIdOf(item, axis);
        if (!id) continue;
        counts[id] = (counts[id] || 0) + 1;
      }
      return counts;
    }

    function axisOptionsOf(tax, axis, counts, fallbackKeys, t, classLabels) {
      const options = [];
      const seen = new Set();
      const bucket = tax && tax.axes ? tax.axes[axis] : null;
      const order = bucket ? bucket.valueOrder : [];
      for (const id of order) {
        if (!(counts[id] > 0)) continue;
        seen.add(id);
        const value = bucket.values[id];
        options.push({
          id,
          label: value.label || (classLabels && classLabels[id]) || id,
          description: value.description || '',
          count: counts[id],
        });
      }
      for (const id of Object.keys(counts)) {
        if (seen.has(id) || !(counts[id] > 0)) continue;
        const key = fallbackKeys && fallbackKeys[id];
        options.push({
          id,
          label: (classLabels && classLabels[id]) || (key ? t(key) : id),
          description: '',
          count: counts[id],
        });
      }
      return options;
    }

    function gradeCountsOf(items) {
      const counts = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
      for (const item of items || []) {
        const letter = gradeLetterOf(item && item.score);
        if (counts[letter] !== undefined) counts[letter] += 1;
      }
      return counts;
    }

    // "Needs action" is the only aggregation the summary line performs; it is
    // deliberately wider than one verdict so a broken C-grade item still shows up.
    const ACTION_VERDICTS = { watch: true, merge: true, archive: true };

    function itemNeedsAction(item) {
      const code = item && item.verdict && item.verdict.code;
      if (code && ACTION_VERDICTS[code]) return true;
      const letter = gradeLetterOf(item && item.score);
      return letter === 'C' || letter === 'D' || letter === 'E';
    }

    function topFixOf(items) {
      const needs = (items || []).filter(itemNeedsAction);
      if (!needs.length) return null;
      return needs.reduce((best, item) => {
        const score = numberOr(item && item.score && item.score.total, 101);
        const bestScore = numberOr(best && best.score && best.score.total, 101);
        return score < bestScore ? item : best;
      }, needs[0]);
    }

    function displayNameOf(item, fallback) {
      if (item && typeof item.name === 'string' && item.name) return item.name;
      if (item && typeof item.id === 'string' && item.id) return item.id;
      return fallback || '—';
    }

    function trendLineOf(portfolio, t) {
      const trend = portfolio && portfolio.trend;
      if (!trend || typeof trend !== 'object') return '';
      const avg = trend.avgDelta;
      const changed = trend.itemsChanged;
      const hasAvg = avg != null && Number.isFinite(Number(avg));
      const hasChanged = changed != null && Number.isFinite(Number(changed));
      if (hasAvg && hasChanged) {
        return t('trendLine', { delta: signed1(avg), changed: Math.round(Number(changed)) });
      }
      if (hasAvg) return t('trendDeltaOnly', { delta: signed1(avg) });
      if (hasChanged) return t('trendChangedOnly', { changed: Math.round(Number(changed)) });
      return '';
    }

    // --------------------------------------------------------------- effect card

    function effectTargetsOf(effect) {
      return Array.isArray(effect && effect.targets) ? effect.targets : [];
    }

    function effectBackupIdsOf(effect) {
      return Array.isArray(effect && effect.backupIds)
        ? effect.backupIds.filter((id) => typeof id === 'string' && id)
        : [];
    }

    function effectToastOf(effect, resolveName, t) {
      const targets = effectTargetsOf(effect);
      if (!targets.length) return '';
      return targets.slice(0, 3).map((target) => t('effectToastItem', {
        name: resolveName(target && target.key),
        before: fmt1(target && target.before),
        after: fmt1(target && target.after),
      })).join('；');
    }

    const SEV_RANK = { critical: 0, major: 1, minor: 2, info: 3 };

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

    const FilterIcon = (props) => icon([
      h('path', { key: 'a', d: 'M3 5h18l-7 8v6l-4 2v-8z' }),
    ], props && props.size);

    const ChartIcon = (props) => icon([
      h('path', { key: 'a', d: 'M4 20V10' }),
      h('path', { key: 'b', d: 'M10 20V4' }),
      h('path', { key: 'c', d: 'M16 20v-7' }),
      h('path', { key: 'd', d: 'M22 20H2' }),
    ], props && props.size);

    function Spinner(props) {
      return h('span', { className: (props && props.prefix ? props.prefix : 's360-') + 'spinner', 'aria-hidden': true });
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

    function Chip(props) {
      const p = props.prefix;
      return h('span', {
        className: p + 'chip ' + (props.tone ? p + 'chip-' + props.tone : ''),
        title: props.title,
      }, props.children);
    }

    function StatCard(props) {
      const p = props.prefix;
      return h('div', {
        className: p + 'stat',
        'data-kind': props.kind || 'number',
        role: props.kind === 'grades' ? 'group' : undefined,
        'aria-label': props.ariaLabel,
      },
        h('div', { className: p + 'statLabel' }, props.label),
        h('div', { className: p + 'statValue' },
          props.value,
          props.unit ? h('span', { className: p + 'statUnit' }, props.unit) : null));
    }

    function EmptyState(props) {
      const p = props.prefix;
      return h('div', { className: p + 'empty' },
        props.icon ? h('div', { className: p + 'emptyIcon' }, props.icon) : null,
        h('div', { className: p + 'emptyTitle' }, props.title),
        props.hint ? h('div', { className: p + 'emptyHint' }, props.hint) : null,
        props.extra ? h('div', { className: p + 'emptyHint' }, props.extra) : null);
    }

    function Notice(props) {
      const notice = props.notice;
      if (!notice) return null;
      const p = props.prefix;
      return h('div', {
        className: p + 'toast',
        'data-kind': notice.kind,
        role: notice.kind === 'error' ? 'alert' : 'status',
      }, notice.text);
    }

    // ------------------------------------------------- human-first shared pieces

    function DeltaText(props) {
      const raw = props.delta;
      if (raw == null || !Number.isFinite(Number(raw))) return null;
      const value = Number(raw);
      const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
      const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
      return h('span', {
        className: 'd360-delta' + (props.className ? ' ' + props.className : ''),
        'data-delta': dir,
        title: props.title,
      }, arrow + ' ' + signed1(value));
    }

    function StateBadgeList(props) {
      const entries = props.entries || [];
      if (!entries.length) return null;
      return h('span', { className: 'd360-states' },
        entries.slice(0, props.limit || 4).map((entry) => h('span', {
          className: 'd360-state',
          key: entry.id,
          'data-state': entry.id,
        },
          h('span', { className: 'd360-stateDot', 'aria-hidden': true }),
          h('span', { className: 'd360-stateLabel' }, entry.label))));
    }

    function ClassificationPills(props) {
      const tax = props.taxonomy;
      const item = props.item;
      const t = props.t;
      const fallback = props.fallbackKeys || {};
      const pills = ['role', 'layer', 'kind', 'scope']
        .filter((axis) => axis !== 'layer' || axisIdOf(item, 'layer') === 'meta')
        .map((axis) => {
          const label = axisLabelOf(tax, item, axis, t, fallback[axis]);
          return label ? { axis, label } : null;
        })
        .filter(Boolean);
      if (!pills.length) return null;
      const limit = props.limit == null ? pills.length : Math.max(1, props.limit);
      return h('span', { className: 'd360-pills' },
        pills.slice(0, limit).map((pill) => h('span', {
          className: 'd360-pill',
          key: pill.axis,
          'data-axis': pill.axis,
        }, pill.label)));
    }

    function AxisFilter(props) {
      const values = Array.isArray(props.values) ? props.values : [];
      if (!values.length) return null;
      return h('div', {
        className: 'd360-axis',
        role: 'group',
        'aria-label': props.title,
        'data-axis': props.axis,
      },
        h('span', { className: 'd360-axisLabel' }, props.title),
        h('div', { className: 'd360-axisChips' },
          h('button', {
            type: 'button',
            className: 'd360-chipBtn',
            'data-axis': props.axis,
            'data-value': 'all',
            'aria-pressed': props.current === 'all' ? 'true' : 'false',
            onClick: () => props.onSelect('all'),
          }, h('span', { className: 'd360-chipLabel' }, props.t('filterAll'))),
          values.map((value) => h('button', {
            type: 'button',
            className: 'd360-chipBtn',
            key: value.id,
            'data-axis': props.axis,
            'data-value': value.id,
            'aria-pressed': props.current === value.id ? 'true' : 'false',
            title: value.description || undefined,
            onClick: () => props.onSelect(value.id),
          },
            h('span', { className: 'd360-chipLabel' }, value.label),
            value.count == null ? null : h('span', { className: 'd360-chipCount' }, String(value.count))))));
    }

    function SummaryLine(props) {
      const items = props.items || [];
      if (!items.length) return null;
      const needs = items.filter(itemNeedsAction);
      const top = topFixOf(items);
      const line = needs.length && top
        ? props.t(props.kind === 'skills' ? 'summarySkills' : 'summaryAgents', {
          count: items.length,
          need: needs.length,
          top: displayNameOf(top),
        })
        : props.t(props.kind === 'skills' ? 'summaryOkSkills' : 'summaryOkAgents', {
          count: items.length,
        });
      const meta = [
        props.t('dataTime', {
          time: formatDateTime(props.portfolio && (props.portfolio.generatedAt || props.portfolio.cachedAt)),
        }),
      ];
      const trend = trendLineOf(props.portfolio, props.t);
      if (trend) meta.push(trend);
      return h('div', { className: 'd360-summary' },
        h('p', { className: 'd360-summaryLine' }, line),
        h('p', { className: 'd360-summaryMeta' }, meta.join(' · ')));
    }

    function StaleBanner(props) {
      const portfolio = props.portfolio;
      if (!portfolio || !portfolio.stale) return null;
      const time = formatDateTime(portfolio.cachedAt || portfolio.generatedAt);
      const text = props.error
        ? props.t('staleFailed', { time, message: props.error })
        : props.t('staleBanner', { time });
      return h('div', {
        className: 'd360-staleBanner',
        role: 'status',
        'aria-live': 'polite',
      }, text);
    }

    function EffectCard(props) {
      const effect = props.effect;
      if (!effect || typeof effect !== 'object') return null;
      const targets = effectTargetsOf(effect);
      const items = numberOr(effect.items, targets.length);
      const tokens = Number(effect.tokensSaved);
      const hasTokens = effect.tokensSaved != null && Number.isFinite(tokens);
      const title = props.isLast ? props.t('effectLast') : props.t('effectNow');
      const tokensSaved = hasTokens && tokens > 0;
      const tokensAdded = hasTokens && tokens < 0;
      const line = (tokensSaved || tokensAdded)
        ? props.t(tokensSaved ? 'effectLine' : 'effectTokensUp', {
          title,
          items,
          before: fmt1(effect.scoreBefore),
          after: fmt1(effect.scoreAfter),
          delta: effect.delta == null ? '—' : signed1(effect.delta),
          tokens: formatInt(Math.abs(tokens)),
        })
        : props.t('effectLineNoTokens', {
          title,
          items,
          before: fmt1(effect.scoreBefore),
          after: fmt1(effect.scoreAfter),
          delta: effect.delta == null ? '—' : signed1(effect.delta),
        });
      const extras = [];
      if (numberOr(effect.gradeUps, 0) > 0) {
        extras.push(props.t('effectUps', { count: Math.round(numberOr(effect.gradeUps, 0)) }));
      }
      if (numberOr(effect.verdictChanges, 0) > 0) {
        extras.push(props.t('effectVerdicts', { count: Math.round(numberOr(effect.verdictChanges, 0)) }));
      }
      return h('div', {
        className: 'd360-effect',
        'data-source': props.isLast ? 'last' : 'now',
        role: 'status',
      },
        h('div', { className: 'd360-effectBody' },
          h('div', { className: 'd360-effectLine' }, line),
          extras.length ? h('div', { className: 'd360-effectMeta' }, extras.join(' · ')) : null),
        props.onUndo
          ? h('button', {
            type: 'button',
            className: 'd360-effectUndo',
            disabled: props.busy,
            onClick: props.onUndo,
          }, h(UndoIcon, { size: 13 }), h('span', null, props.t('undo')))
          : null);
    }

    function LoadingSkeleton(props) {
      const cards = [0, 1, 2, 3, 4, 5];
      const rows = [0, 1, 2, 3];
      return h('div', {
        className: 'd360-skeleton',
        'data-surface': props.surface,
        role: 'status',
        'aria-live': 'polite',
      },
        h('div', { className: 'd360-skelStats' },
          cards.map((index) => h('div', { className: 'd360-skelCard', key: index }))),
        h('div', { className: 'd360-skelBody' },
          h('div', { className: 'd360-skelPane' },
            rows.map((index) => h('div', {
              className: 'd360-skelBar',
              key: index,
              style: { width: index % 2 === 0 ? '88%' : '64%' },
            }))),
          h('div', { className: 'd360-skelPane d360-skelPaneWide' },
            h('div', { className: 'd360-skelBar', style: { width: '42%' } }),
            h('div', { className: 'd360-skelBar', style: { width: '92%' } }),
            h('div', { className: 'd360-skelBar', style: { width: '74%' } }))),
        h('div', { className: 'd360-loadingText' }, props.label));
    }

    function ClassificationCard(props) {
      const item = props.item;
      const t = props.t;
      const tax = props.taxonomy;
      const fallback = props.fallbackKeys || {};
      const classification = classificationOf(item);
      const roleLabel = axisLabelOf(tax, item, 'role', t);
      const layerLabel = axisLabelOf(tax, item, 'layer', t);
      const kindLabel = axisLabelOf(tax, item, 'kind', t, fallback.kind);
      const scopeLabel = axisLabelOf(tax, item, 'scope', t, fallback.scope);
      const states = stateEntriesOf(item, tax, props.pendingFallbackLabel || null);
      const roleEntry = axisEntryOf(item, 'role');
      const evidence = roleEntry && Array.isArray(roleEntry.evidence)
        ? roleEntry.evidence.filter((entry) => typeof entry === 'string' && entry)
        : [];
      const confidenceRaw = roleEntry && roleEntry.confidence != null
        ? roleEntry.confidence
        : (classification && classification.confidence);
      const confidence = confidenceRaw != null && Number.isFinite(Number(confidenceRaw))
        ? Number(confidenceRaw)
        : null;
      const roleId = axisIdOf(item, 'role');
      const summary = classificationSummaryOf(item);

      if (!classification && !roleLabel && !kindLabel && !scopeLabel) {
        return h('div', { className: 'd360-classEmpty' }, t('classificationEmpty'));
      }

      const valueNode = (label) => h('span', { className: 'd360-classValue' }, label || '—');
      const rows = [
        ['role', t('classificationRole'), valueNode(roleLabel)],
        ...(layerLabel ? [['layer', t('classificationLayer'), valueNode(layerLabel)]] : []),
        ['kind', t('classificationKind'), valueNode(kindLabel)],
        ['scope', t('classificationScope'), valueNode(scopeLabel)],
        ['state', t('classificationState'), states.length
          ? h('span', { className: 'd360-classStates' },
            states.map((entry) => h('span', {
              className: 'd360-state',
              key: entry.id,
              'data-state': entry.id,
            },
              h('span', { className: 'd360-stateDot', 'aria-hidden': true }),
              h('span', { className: 'd360-stateLabel' }, entry.label))))
          : h('span', { className: 'd360-classValue' }, '—')],
      ];

      return h('div', { className: 'd360-classCard' },
        h('div', { className: 'd360-classGrid' },
          rows.map((row) => h('div', {
            className: 'd360-classItem',
            key: row[0],
            'data-axis': row[0],
          },
            h('span', { className: 'd360-classLabel' }, row[1]),
            row[0] === 'role'
              ? h('span', {
                className: 'd360-classValue',
                title: evidence.length ? t('classificationEvidence', { value: evidence.join('、') }) : undefined,
              }, roleLabel || '—')
              : row[2],
            row[0] === 'role' && confidence != null
              ? h('span', { className: 'd360-classMeta' },
                t('classificationConfidence', { value: Math.round(confidence * 100) + '%' }))
              : null,
            row[0] === 'role' && roleId && props.onFilterRole
              ? h('button', {
                type: 'button',
                className: 'd360-linkBtn',
                onClick: () => props.onFilterRole(roleId),
              }, t('classificationFilterRole'))
              : null))),
        summary ? h('p', { className: 'd360-classSummary' }, summary) : null);
    }

    // ============================================================== skills (s360-)

    function skillsSevKey(severity) {
      return { critical: 'Critical', major: 'Major', minor: 'Minor', info: 'Info' }[severity] || 'Info';
    }

    function skillsTopSeverity(skill) {
      // `view=list` snapshots carry topSeverity; details carry findings.
      if (skill && skill.topSeverity) return skill.topSeverity;
      const findings = (skill && skill.findings) || [];
      if (findings.some((f) => f.severity === 'critical')) return 'critical';
      if (findings.some((f) => f.severity === 'major')) return 'major';
      if (findings.some((f) => f.severity === 'minor')) return 'minor';
      if (findings.some((f) => f.severity === 'info')) return 'info';
      return null;
    }

    function skillsHasMajorPlus(skill) {
      const top = skill && skill.topSeverity;
      if (top === 'critical' || top === 'major') return true;
      if (top) return false;
      return ((skill && skill.findings) || []).some(
        (f) => f.severity === 'critical' || f.severity === 'major',
      );
    }

    function skillsVerdictLabelOf(code) {
      return { keep: 'verdictKeep', watch: 'verdictWatch', merge: 'verdictMerge', archive: 'verdictArchive' }[code] || null;
    }

    function skillsNormalizeEvolution(input) {
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

    function skillsEvolutionPending(skill) {
      const ev = skill && skill.evolution;
      if (!ev) return false;
      const pendingRaw = ev.pending && typeof ev.pending === 'object' ? ev.pending : null;
      if (pendingRaw && typeof pendingRaw.hasUnclosed === 'boolean') return pendingRaw.hasUnclosed;
      if (typeof ev.hasUnclosed === 'boolean') return ev.hasUnclosed;
      return Number(ev.pendingScore) > 0;
    }

    function skillsIsLessonSuggestion(suggestion) {
      if (!suggestion) return false;
      if (suggestion.id === 'fix.add-lesson') return true;
      return !!(suggestion.action && suggestion.action.type === 'add-lesson');
    }

    function skillsLessonOf(suggestion) {
      const params = suggestion && suggestion.action && suggestion.action.params;
      return (params && params.lesson) || {};
    }

    function skillsSuggestionActionKey(suggestion) {
      if (skillsIsLessonSuggestion(suggestion)) return 'skillsEvolveButton';
      return suggestion.kind === 'auto' ? 'kindAuto' : 'kindDraft';
    }

    function skillsSignalKindKey(kind) {
      return {
        correction: 'signalCorrections',
        error: 'signalErrors',
        reload: 'skillsSignalReloads',
        ask: 'signalAsks',
        'turn-failure': 'skillsSignalFailures',
      }[kind] || 'signalLoads';
    }

    function PreviewBlock(props) {
      const preview = props.preview;
      const t = props.t;
      const p = props.prefix;
      if (!preview || (preview.before == null && preview.after == null)) return null;
      return h('div', { className: p + 'preview' },
        h('div', { className: p + 'previewTitle' }, t('previewLabel')),
        preview.before != null
          ? h('div', { className: p + 'previewRow' },
            h('span', { className: p + 'previewTag' }, t('beforeLabel')),
            h('code', { className: p + 'previewText' }, clip(preview.before, 240)))
          : null,
        preview.after != null
          ? h('div', { className: p + 'previewRow' },
            h('span', { className: p + 'previewTag ' + p + 'previewTagAfter' }, t('afterLabel')),
            h('code', { className: p + 'previewText' }, clip(preview.after, 240)))
          : null);
    }

    function SkillRow(props) {
      const skill = props.skill;
      const t = props.t;
      const sev = skillsTopSeverity(skill);
      const usage = skill.usage || {};
      const perWeek = usage.perWeek != null ? fmt1(usage.perWeek) : null;
      const verdictLabel = skillsVerdictLabelOf(skill.verdict && skill.verdict.code);
      const summary = classificationSummaryOf(skill) || clip(skill.description || '', 84);
      const states = stateEntriesOf(skill, props.taxonomy, skillsEvolutionPending(skill) ? t('evolvePendingBadge') : null);
      return h('button', {
        type: 'button',
        className: 's360-row',
        'data-selected': skill.name === props.selected ? 'true' : 'false',
        onClick: () => props.onSelect(skill.name),
        title: skill.path || skill.name,
      },
        h('span', { className: gradeBadgeClass('s360-', skill.score) }, skill.score.grade),
        h('div', { className: 's360-rowMain' },
          h('div', { className: 's360-rowTitleLine' },
            h('span', { className: 's360-rowName' }, skill.name),
            h('span', { className: 's360-rowScore' }, fmt1(skill.score.total)),
            h(DeltaText, { delta: skill.score.delta, className: 'd360-rowDelta' })),
          summary ? h('div', { className: 's360-rowDesc', title: summary }, clip(summary, 84)) : null,
          h('div', { className: 's360-rowMeta' },
            h(ClassificationPills, { item: skill, taxonomy: props.taxonomy, t, limit: 2 }),
            verdictLabel ? h(Chip, { prefix: 's360-', tone: skill.verdict.code }, t(verdictLabel)) : null),
          h('div', { className: 's360-rowFoot' },
            h(StateBadgeList, { entries: states, limit: 3 }),
            skillsEvolutionPending(skill)
              ? h('span', { className: 's360-flag' }, t('evolvePendingBadge'))
              : null,
            sev
              ? h('span', { className: 's360-sevText', 'data-sev': sev },
                h('span', { className: 'd360-sevGlyph', 'aria-hidden': true }, '▲'),
                t('sev' + skillsSevKey(sev)))
              : null,
            h('span', { className: 's360-metaText' }, t('skillsUsageLine', { count: usage.count ?? 0, perWeek: perWeek == null ? '—' : perWeek })))));
    }

    function SkillsDimensionBlock(props) {
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
            h('span', { className: 's360-dimLabel' }, dim.label),
            notScored ? h(Chip, { prefix: 's360-', tone: 'na' }, t('skillsNotScored')) : null),
          h('div', { className: 's360-dimBarRow' },
            h('div', {
              className: 's360-bar',
              role: 'img',
              'aria-label': notScored ? t('skillsNotScored') : fmtPoints(dim.score) + ' / ' + fmtPoints(dim.max),
            },
              h('div', { className: 's360-barFill', style: { width: pct + '%' } })),
            h('span', { className: 's360-dimScore' },
              notScored ? '—' : fmtPoints(dim.score) + ' / ' + fmtPoints(dim.max))),
          dim.summary ? h('div', { className: 's360-dimSummaryText' }, dim.summary) : null),
        items.length
          ? h('ul', { className: 's360-dimItems' },
            items.map((item) => h('li', { className: 's360-dimItem', key: item.id },
              h('div', { className: 's360-dimItemTop' },
                h('span', { className: 's360-dimItemLabel' }, item.label),
                h('span', { className: 's360-dimItemScore' },
                  notScored || item.applicable === false
                    ? '—'
                    : fmtPoints(item.score) + ' / ' + fmtPoints(item.max))),
              item.detail ? h('div', { className: 's360-dimItemDetail' }, item.detail) : null)))
          : null);
    }

    function SkillsMetricsGrid(props) {
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

    function SkillsFindingsList(props) {
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
              h('span', { className: 's360-sev s360-sev-' + f.severity }, t('sev' + skillsSevKey(f.severity))),
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
                }, t(skillsSuggestionActionKey(s)))))
              : null);
        }));
    }

    function SkillsSuggestionsList(props) {
      const suggestions = props.suggestions || [];
      const t = props.t;
      if (suggestions.length === 0) {
        return h('div', { className: 's360-muted' }, t('noSuggestions'));
      }
      return h('ul', { className: 's360-suggestions' },
        suggestions.map((s) => {
          const lesson = skillsIsLessonSuggestion(s);
          const draft = skillsLessonOf(s);
          const kindChip = lesson
            ? h(Chip, { prefix: 's360-', tone: 'evolve' }, t('evolutionTitle'))
            : s.kind === 'auto'
              ? h(Chip, { prefix: 's360-', tone: 'auto' }, t('kindAuto'))
              : s.kind === 'draft'
                ? h(Chip, { prefix: 's360-', tone: 'draft' }, t('kindDraft'))
                : h(Chip, { prefix: 's360-', tone: 'manual' }, t('skillsKindManual'));
          const body = [
            s.why ? h('div', { className: 's360-sugText', key: 'why' }, labeled(t, 'whyLabel', s.why)) : null,
            s.risk ? h('div', { className: 's360-sugText', key: 'risk' }, labeled(t, 'riskLabel', s.risk)) : null,
            lesson && draft.trigger
              ? h('div', { className: 's360-sugText', key: 'trigger' },
                labeled(t, 'evolveTrigger', clip(draft.trigger, 160)))
              : null,
            h(PreviewBlock, { preview: s.preview, t, prefix: 's360-', key: 'preview' }),
          ];
          if (s.kind === 'manual') {
            return h('li', { className: 's360-sug', key: s.id, 'data-kind': 'manual' },
              h('div', { className: 's360-sugHead' }, kindChip, h('span', { className: 's360-sugTitle' }, s.title)),
              body);
          }
          return h('li', { className: 's360-sug', key: s.id, 'data-kind': s.kind },
            h('div', { className: 's360-sugHead' }, kindChip, h('span', { className: 's360-sugTitle' }, s.title)),
            lesson
              ? h('div', { className: 's360-draftNote' }, t('skillsEvolveNote'))
              : (s.kind === 'draft' ? h('div', { className: 's360-draftNote' }, t('skillsDraftNote')) : null),
            body,
            h('div', { className: 's360-sugActions' },
              h('button', {
                type: 'button',
                className: 's360-btn s360-btnPrimary',
                disabled: props.busy,
                onClick: () => props.onApply(s),
              }, t(skillsSuggestionActionKey(s)))));
        }));
    }

    function SkillsOverlapsList(props) {
      const overlaps = props.overlaps || [];
      const t = props.t;
      if (overlaps.length === 0) {
        return h('div', { className: 's360-muted' }, t('skillsNoOverlaps'));
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

    function SkillsEvolveEditor(props) {
      const editor = props.editor;
      const t = props.t;
      if (!editor) return null;
      const rule = String(editor.rule || '');
      return h('div', { className: 's360-editor', 'data-open': 'true' },
        h('div', { className: 's360-editorTitle' }, t('skillsEvolveEditorTitle')),
        h('label', { className: 's360-field' },
          h('span', { className: 's360-fieldLabel' }, t('evolveTrigger')),
          h('input', {
            className: 's360-input',
            type: 'text',
            value: String(editor.trigger || ''),
            onChange: (event) => props.onChange('trigger', event.target.value),
          })),
        h('label', { className: 's360-field' },
          h('span', { className: 's360-fieldLabel' }, t('skillsEvolveRule')),
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
          }, t('skillsEvolveWrite')),
          h('button', {
            type: 'button',
            className: 's360-btn',
            disabled: props.busy,
            onClick: props.onCancel,
          }, t('evolveCancel'))));
    }

    function SkillsEvolutionSection(props) {
      const ev = skillsNormalizeEvolution(props.evolution);
      const t = props.t;
      const lessons = ev.lessons;
      const signals = ev.signals;
      const pending = ev.pending;
      const counters = [
        ['signalLoads', signals.loads],
        ['signalCorrections', signals.corrections],
        ['signalErrors', signals.postLoadErrors],
        ['skillsSignalReloads', signals.reloads],
        ['skillsSignalFailures', signals.turnFailures],
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
          t('evolutionSectionTitle'),
          pending.hasUnclosed ? h(Chip, { prefix: 's360-', tone: 'evolve' }, t('evolvePendingBadge')) : null,
          ev.applicable ? null : h(Chip, { prefix: 's360-', tone: 'na' }, t('skillsNotScored'))),
        ev.applicable ? null : h('div', { className: 's360-muted' }, t('skillsEvolutionNotScored')),
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
        lessons.count === 0 ? h('div', { className: 's360-evEmpty' }, t('skillsEvolveEmptyLessons')) : null,
        h('div', { className: 's360-subLabel' }, t('skillsEvolveSignals')),
        h('div', { className: 's360-evSignals' },
          counters.map((entry) => h('span', { className: 's360-evSignal', key: entry[0] },
            h('span', { className: 's360-evSignalLabel' }, t(entry[0])),
            h('span', { className: 's360-evSignalValue' }, String(entry[1]))))),
        signalTotal === 0 ? h('div', { className: 's360-evEmpty' }, t('skillsEvolveEmptySignals')) : null,
        signals.samples.length
          ? h('ul', { className: 's360-evSamples' },
            signals.samples.slice(0, 4).map((sample, index) => h('li', {
              className: 's360-evSample',
              key: (sample.sessionId || 'sample') + ':' + index,
            },
              h('span', { className: 's360-evSampleKind' }, t(skillsSignalKindKey(sample.kind))),
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
                }, t('skillsEvolveButton')));
            }))
          : h('div', { className: 's360-evEmpty' }, t('skillsEvolveNoPending')),
        props.editor ? h(SkillsEvolveEditor, {
          editor: props.editor,
          t,
          busy: props.busy,
          onChange: props.onChange,
          onSubmit: props.onSubmit,
          onCancel: props.onCancel,
        }) : null);
    }

    function SkillsDetailView(props) {
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
      const verdictLabel = skillsVerdictLabelOf(verdict.code);
      const delta = score.delta;

      return h('div', { className: 's360-detailBody' },
        h('div', { className: 's360-detailHead' },
          h('div', { className: 's360-detailTop' },
            h('div', { className: 's360-detailTitleLine' },
              h('h2', { className: 's360-detailName' }, detail.name),
              h('span', { className: gradeBadgeClass('s360-', score) }, score.grade),
              verdictLabel ? h(Chip, { prefix: 's360-', tone: verdict.code }, t(verdictLabel)) : null),
            h('div', { className: 's360-detailActions' },
              h('button', {
                type: 'button',
                className: 's360-btn s360-btnPrimary',
                disabled: props.busy,
                onClick: () => props.onApplyAll(detail.name),
              }, t('applyAllSkill')))),
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
          detail.path ? h('div', { className: 's360-path' }, labeled(t, 'pathLabel', detail.path)) : null,
          detail.coverage ? h('div', { className: 's360-coverage' },
            labeled(t, 'coverageLabel', detail.coverage === 'full' ? t('coverageFull') : t('coveragePartial'))) : null),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('classificationTitle')),
          h(ClassificationCard, {
            item: detail,
            taxonomy: props.taxonomy,
            t,
            onFilterRole: props.onFilterRole,
            pendingFallbackLabel: skillsEvolutionPending(detail) ? t('evolvePendingBadge') : null,
          })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('dimensionsTitle')),
          dimensions.map((dim) => h(SkillsDimensionBlock, { dim, t, key: dim.id }))),

        h(SkillsEvolutionSection, {
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
          h(SkillsMetricsGrid, { metrics: detail.metrics, usage: detail.usage, t })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('findingsTitle')),
          h(SkillsFindingsList, { findings, suggestions, t, busy: props.busy, onApply: props.onApply })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('suggestionsTitle')),
          h(SkillsSuggestionsList, { suggestions, t, busy: props.busy, onApply: props.onApply })),

        h('section', { className: 's360-section' },
          h('h3', { className: 's360-sectionTitle' }, t('skillsOverlapsTitle')),
          h(SkillsOverlapsList, { overlaps, t, onJump: props.onJump })),

        h('details', { className: 's360-source' },
          h('summary', { className: 's360-sourceSummary' }, t('viewSource')),
          h('pre', { className: 's360-sourcePre' }, rawLines || '')));
    }

    // ============================================================== agents (a360-)

    const AGENTS_SEV_KEY = { critical: 'sevCritical', major: 'sevMajor', minor: 'sevMinor', info: 'sevInfo' };
    const AGENTS_KIND_KEY = { instruction: 'kindInstruction', agent: 'kindAgent', preset: 'kindPreset' };
    const AGENTS_SCOPE_KEY = { global: 'scopeGlobal', project: 'scopeProject', profile: 'scopeProfile', skill: 'scopeSkill' };
    const AGENTS_VERDICT_KEY = {
      keep: 'verdictKeep',
      watch: 'verdictWatch',
      trim: 'verdictTrim',
      merge: 'verdictMerge',
      archive: 'verdictArchive',
    };
    const AGENTS_MODE_KEY = {
      always: 'modeAlways',
      workspace: 'modeWorkspace',
      'on-demand': 'modeOnDemand',
      config: 'modeConfig',
    };
    const AGENTS_DIM_KEY = {
      inject: 'dimInject',
      layer: 'dimLayer',
      actionable: 'dimActionable',
      governance: 'dimGovernance',
      hygiene: 'dimHygiene',
      evolution: 'dimEvolution',
    };
    const AGENTS_DIM_ORDER = ['inject', 'layer', 'actionable', 'governance', 'hygiene', 'evolution'];

    function agentsSevKey(severity) {
      return AGENTS_SEV_KEY[severity] || 'sevInfo';
    }

    function agentsVerdictKeyOf(code) {
      return AGENTS_VERDICT_KEY[code] || null;
    }

    function agentsTopSeverity(subject) {
      if (subject && subject.topSeverity) return subject.topSeverity;
      const findings = (subject && subject.findings) || [];
      if (findings.some((f) => f.severity === 'critical')) return 'critical';
      if (findings.some((f) => f.severity === 'major')) return 'major';
      if (findings.some((f) => f.severity === 'minor')) return 'minor';
      if (findings.some((f) => f.severity === 'info')) return 'info';
      return null;
    }

    function agentsHasMajorPlus(subject) {
      const top = subject && subject.topSeverity;
      if (top === 'critical' || top === 'major') return true;
      if (top) return false;
      return ((subject && subject.findings) || []).some(
        (f) => f.severity === 'critical' || f.severity === 'major',
      );
    }

    function agentsGradeCodeOf(subject) {
      return (subject && subject.score && subject.score.grade) || '';
    }

    function agentsTotalOf(subject) {
      return subject && subject.score ? subject.score.total : null;
    }

    function agentsVerdictCodeOf(subject) {
      return (subject && subject.verdict && subject.verdict.code) || '';
    }

    function agentsNormalizeEvolution(input) {
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
        sessions: numberOr(signalsRaw.sessions, 0),
        reloads: numberOr(signalsRaw.reloads, 0),
        postLoadErrors: numberOr(signalsRaw.postLoadErrors, 0),
        corrections: numberOr(signalsRaw.corrections, 0),
        asks: numberOr(signalsRaw.asks, 0),
        turnFailures: numberOr(signalsRaw.turnFailures, 0),
        lastSignalAt: signalsRaw.lastSignalAt != null
          ? signalsRaw.lastSignalAt
          : (raw.lastSignalAt != null ? raw.lastSignalAt : null),
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
          : (signals.lastSignalAt != null ? signals.lastSignalAt : null),
        draft: (pendingRaw && pendingRaw.draft) || raw.draft || null,
      };
      return {
        applicable: raw.applicable !== false,
        lessons,
        signals,
        pending,
        proposals: Array.isArray(raw.proposals) ? raw.proposals : [],
      };
    }

    function agentsEvolutionPending(subject) {
      const ev = subject && subject.evolution;
      if (!ev) return false;
      const pendingRaw = ev.pending && typeof ev.pending === 'object' ? ev.pending : null;
      if (pendingRaw && typeof pendingRaw.hasUnclosed === 'boolean') return pendingRaw.hasUnclosed;
      if (typeof ev.hasUnclosed === 'boolean') return ev.hasUnclosed;
      return Number(ev.pendingScore) > 0;
    }

    function agentsIsLessonSuggestion(suggestion) {
      if (!suggestion) return false;
      if (suggestion.id === 'fix.add-lesson') return true;
      return !!(suggestion.action && suggestion.action.type === 'add-lesson');
    }

    function agentsLessonOf(suggestion) {
      const params = suggestion && suggestion.action && suggestion.action.params;
      return (params && params.lesson) || {};
    }

    function agentsSuggestionActionKey(suggestion) {
      if (agentsIsLessonSuggestion(suggestion)) return 'agentsEvolveButton';
      return suggestion.kind === 'auto' ? 'kindAuto' : 'kindDraft';
    }

    function agentsEvidenceText(evidence) {
      if (evidence == null) return '—';
      if (typeof evidence === 'string') return evidence;
      const parts = [];
      if (evidence.sessionId) parts.push('session ' + evidence.sessionId);
      if (evidence.excerpt) parts.push(evidence.excerpt);
      return parts.length ? parts.join(' · ') : '—';
    }

    function agentsConflictsFor(portfolio, subjectId) {
      const all = (portfolio && portfolio.conflicts) || [];
      if (!subjectId) return [];
      const names = {};
      ((portfolio && portfolio.subjects) || []).forEach((item) => { names[item.id] = item.name; });
      const rows = [];
      all.forEach((conflict) => {
        if (!conflict) return;
        let otherId = null;
        let selfRule = null;
        let otherRule = null;
        let selfLine = null;
        let otherLine = null;
        if (conflict.a === subjectId) {
          otherId = conflict.b;
          selfRule = conflict.ruleA;
          otherRule = conflict.ruleB;
          selfLine = conflict.lineA;
          otherLine = conflict.lineB;
        } else if (conflict.b === subjectId) {
          otherId = conflict.a;
          selfRule = conflict.ruleB;
          otherRule = conflict.ruleA;
          selfLine = conflict.lineB;
          otherLine = conflict.lineA;
        } else {
          return;
        }
        rows.push({
          kind: conflict.kind,
          ratio: conflict.ratio,
          selfRule,
          otherRule,
          selfLine,
          otherLine,
          otherId,
          otherName: names[otherId] || otherId || '—',
        });
      });
      return rows;
    }

    function agentsSignalKindKey(kind) {
      return {
        correction: 'signalCorrections',
        error: 'signalErrors',
        reload: 'agentsSignalReloads',
        ask: 'signalAsks',
        'turn-failure': 'agentsSignalFailures',
      }[kind] || 'signalSessions';
    }

    function injectionText(subject, t) {
      const inj = (subject && subject.injection) || {};
      const seen = numberOr(inj.sessionsSeen, 0);
      const injected = numberOr(inj.sessionsInjected, 0);
      if (seen === 0 && injected === 0) return t('injMissing');
      return t('injShort', { injected, seen });
    }

    function SubjectRow(props) {
      const subject = props.subject;
      const t = props.t;
      const sev = agentsTopSeverity(subject);
      const verdictCode = agentsVerdictCodeOf(subject);
      const verdictKey = agentsVerdictKeyOf(verdictCode);
      const inj = (subject && subject.injection) || {};
      const injected = numberOr(inj.sessionsInjected, 0);
      const pending = agentsEvolutionPending(subject);
      const summary = classificationSummaryOf(subject)
        || clip(subject.title || subject.description || subject.path || '', 84);
      const states = stateEntriesOf(subject, props.taxonomy, pending ? t('evolvePendingBadge') : null);
      return h('button', {
        type: 'button',
        className: 'a360-row',
        'data-selected': subject.id === props.selected ? 'true' : 'false',
        'data-kind': subject.kind,
        'data-pending': pending ? 'true' : 'false',
        onClick: () => props.onSelect(subject.id),
        title: subject.path || subject.name,
      },
        h('span', { className: gradeBadgeClass('a360-', subject.score) }, agentsGradeCodeOf(subject) || '—'),
        h('div', { className: 'a360-rowMain' },
          h('div', { className: 'a360-rowTitleLine' },
            h('span', { className: 'a360-rowName' }, subject.name),
            h('span', { className: 'a360-rowScore' }, fmt1(agentsTotalOf(subject))),
            h(DeltaText, { delta: subject.score && subject.score.delta, className: 'd360-rowDelta' })),
          summary ? h('div', { className: 'a360-rowDesc', title: summary }, clip(summary, 84)) : null,
          h('div', { className: 'a360-rowMeta' },
            h(ClassificationPills, {
              item: subject,
              taxonomy: props.taxonomy,
              t,
              limit: 2,
              fallbackKeys: { kind: AGENTS_KIND_KEY, scope: AGENTS_SCOPE_KEY },
            }),
            verdictKey ? h(Chip, { prefix: 'a360-', tone: verdictCode }, t(verdictKey)) : null),
          h('div', { className: 'a360-rowFoot' },
            h(StateBadgeList, { entries: states, limit: 3 }),
            h('span', { className: 'a360-injText', 'data-ok': injected > 0 ? 'true' : 'false' },
              h('span', { className: 'd360-sevGlyph', 'aria-hidden': true }, injected > 0 ? '✓' : '○'),
              injectionText(subject, t)),
            pending ? h('span', { className: 'a360-flag' }, t('evolvePendingBadge')) : null,
            sev
              ? h('span', { className: 'a360-sevText', 'data-sev': sev },
                h('span', { className: 'd360-sevGlyph', 'aria-hidden': true }, '▲'),
                t(agentsSevKey(sev)))
              : null)));
    }

    function AgentsDimensionBlock(props) {
      const dim = props.dim;
      const t = props.t;
      const max = dim.max || 1;
      const notScored = dim.applicable === false;
      const pct = notScored ? 0 : Math.max(0, Math.min(100, Math.round(((dim.score || 0) / max) * 100)));
      const items = dim.items || [];
      const dimKey = AGENTS_DIM_KEY[dim.id];
      const label = dim.label || (dimKey ? t(dimKey) : dim.id);
      return h('details', {
        className: 'a360-dim',
        'data-dim': dim.id,
        'data-applicable': notScored ? 'false' : 'true',
      },
        h('summary', { className: 'a360-dimSummary' },
          h('div', { className: 'a360-dimTop' },
            h('span', { className: 'a360-dimLabel' }, label),
            notScored ? h(Chip, { prefix: 'a360-', tone: 'na' }, t('agentsNotScored')) : null),
          h('div', { className: 'a360-dimBarRow' },
            h('div', {
              className: 'a360-bar',
              role: 'img',
              'aria-label': notScored ? t('agentsNotScored') : fmtPoints(dim.score) + ' / ' + fmtPoints(dim.max),
            },
              h('div', { className: 'a360-barFill', style: { width: pct + '%' } })),
            h('span', { className: 'a360-dimScore' },
              notScored ? '—' : fmtPoints(dim.score) + ' / ' + fmtPoints(dim.max))),
          dim.summary ? h('div', { className: 'a360-dimSummaryText' }, dim.summary) : null),
        items.length
          ? h('ul', { className: 'a360-dimItems' },
            items.map((item) => h('li', { className: 'a360-dimItem', key: item.id },
              h('div', { className: 'a360-dimItemTop' },
                h('span', { className: 'a360-dimItemLabel' }, item.label),
                h('span', { className: 'a360-dimItemScore' },
                  notScored || item.applicable === false
                    ? '—'
                    : fmtPoints(item.score) + ' / ' + fmtPoints(item.max))),
              item.detail ? h('div', { className: 'a360-dimItemDetail' }, item.detail) : null)))
          : null);
    }

    function InjectionCard(props) {
      const inj = props.injection || {};
      const t = props.t;
      const modeKey = AGENTS_MODE_KEY[inj.mode] || null;
      const duplicated = Array.isArray(inj.duplicatedWith) ? inj.duplicatedWith : [];
      const rows = [
        ['injMode', modeKey ? t(modeKey) : (inj.mode || '—')],
        ['injSessionsInjected', numberOr(inj.sessionsInjected, 0) + ' / ' + numberOr(inj.sessionsSeen, 0)],
        ['injTokens', inj.tokensPerInjection == null
          ? '—'
          : formatTokens(inj.tokensPerInjection) + ' ' + t('tokensUnit')],
        ['injLast', inj.lastInjectedAt == null ? t('injNever') : formatDay(inj.lastInjectedAt)],
      ];
      return h('div', { className: 'a360-injection' },
        h('div', { className: 'a360-metrics' },
          rows.map((row) => h('div', { className: 'a360-metric', key: row[0] },
            h('div', { className: 'a360-metricLabel' }, t(row[0])),
            h('div', { className: 'a360-metricValue', 'data-field': row[0] }, row[1])))),
        h('div', { className: 'a360-injDup' },
          h('span', { className: 'a360-metricLabel' }, t('injDup')),
          duplicated.length
            ? h('span', { className: 'a360-injDupList' }, duplicated.map((dup) => h(Chip, {
              prefix: 'a360-',
              key: dup.id || dup.name,
              tone: 'sev-major',
              title: dup.id || dup.name,
            }, (dup.name || dup.id || '—') + ' ' + formatPercent(dup.ratio))))
            : h('span', { className: 'a360-injDupList a360-muted' }, '—')));
    }

    function AgentsMetricsGrid(props) {
      const m = props.metrics || {};
      const usage = props.usage || {};
      const t = props.t;
      const frontmatter = m.frontmatter;
      const rows = [
        [t('mEstTokens'), formatTokens(m.estTokens)],
        [t('mChars'), countOf(m.chars)],
        [t('mLines'), countOf(m.lines)],
        [t('mHeadings'), countOf(m.headings)],
        [t('mH2'), countOf(m.h2)],
        [t('mImperatives'), countOf(m.imperativeCount)],
        [t('mBullets'), countOf(m.bullets)],
        [t('mSteps'), countOf(m.numberedSteps)],
        [t('mCommands'), countOf(m.commands)],
        [t('mCodeBlocks'), countOf(m.codeBlocks)],
        [t('mCodeRatio'), formatPercent(m.codeRatio)],
        [t('mSections'), countOf(m.sections)],
        [t('mLocalLinks'), countOf(m.localLinks)],
        [t('mStaleRefs'), countOf(m.staleRefs)],
        [t('mDupSentences'), countOf(m.dupSentences)],
        [t('mBuiltinOverlap'), formatPercent(m.builtinOverlap)],
        [t('mTodos'), countOf(m.todos)],
        [t('mSecrets'), countOf(m.secrets)],
        [t('mDangerous'), countOf(m.dangerous)],
        [t('mBakFiles'), countOf(m.bakFiles)],
        [t('mFrontmatter'), frontmatter ? (frontmatter.ok ? t('fmOk') : t('fmMissing')) : '—'],
        [t('usageSessions'), countOf(usage.sessions)],
        [t('usagePerWeek'), usage.perWeek == null ? '—' : fmt1(usage.perWeek)],
        [t('usageExposure'), countOf(usage.exposureDays)],
        [t('usagePresetSessions'), countOf(usage.presetSessions)],
        [t('usageSubagentRuns'), countOf(usage.subagentRuns)],
      ];
      return h('div', { className: 'a360-metrics' },
        rows.map((row) => h('div', { className: 'a360-metric', key: row[0] },
          h('div', { className: 'a360-metricLabel' }, row[0]),
          h('div', { className: 'a360-metricValue' }, row[1]))));
    }

    function AgentsFindingsList(props) {
      const findings = props.findings || [];
      const t = props.t;
      const byId = {};
      (props.suggestions || []).forEach((s) => { byId[s.id] = s; });
      if (findings.length === 0) {
        return h('div', { className: 'a360-muted' }, t('noFindings'));
      }
      const sorted = findings.slice().sort(
        (a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9),
      );
      return h('ul', { className: 'a360-findings' },
        sorted.map((f) => {
          const linked = (f.actionIds || [])
            .map((id) => byId[id])
            .filter(Boolean)
            .filter((s) => s.kind === 'auto' || s.kind === 'draft');
          return h('li', { className: 'a360-finding', key: f.id || f.title, 'data-sev': f.severity },
            h('div', { className: 'a360-findingHead' },
              h('span', { className: 'a360-sev a360-sev-' + f.severity }, t(agentsSevKey(f.severity))),
              h('span', { className: 'a360-findingTitle' }, f.title)),
            f.detail ? h('div', { className: 'a360-findingDetail' }, f.detail) : null,
            f.evidence
              ? h('div', { className: 'a360-findingEvidence' },
                h('code', { className: 'a360-code' },
                  (f.evidence.file || '') + (f.evidence.line != null ? ':' + f.evidence.line : '')),
                f.evidence.excerpt
                  ? h('div', { className: 'a360-evExcerpt' }, clip(f.evidence.excerpt, 300))
                  : null)
              : null,
            f.suggestion ? h('div', { className: 'a360-findingSug' }, labeled(t, 'suggestionLabel', f.suggestion)) : null,
            linked.length
              ? h('div', { className: 'a360-findingActions' },
                linked.map((s) => h('button', {
                  key: s.id,
                  type: 'button',
                  className: 'a360-btn a360-btnPrimary a360-btnSm',
                  disabled: props.busy,
                  onClick: () => props.onApply(s),
                }, t(agentsSuggestionActionKey(s)))))
              : null);
        }));
    }

    function AgentsSuggestionsList(props) {
      const suggestions = props.suggestions || [];
      const t = props.t;
      if (suggestions.length === 0) {
        return h('div', { className: 'a360-muted' }, t('noSuggestions'));
      }
      return h('ul', { className: 'a360-suggestions' },
        suggestions.map((s) => {
          const lesson = agentsIsLessonSuggestion(s);
          const draft = agentsLessonOf(s);
          const kindChip = lesson
            ? h(Chip, { prefix: 'a360-', tone: 'evolve' }, t('evolutionTitle'))
            : s.kind === 'auto'
              ? h(Chip, { prefix: 'a360-', tone: 'auto' }, t('kindAuto'))
              : s.kind === 'draft'
                ? h(Chip, { prefix: 'a360-', tone: 'draft' }, t('kindDraft'))
                : h(Chip, { prefix: 'a360-', tone: 'manual' }, t('agentsKindManual'));
          const body = [
            s.why ? h('div', { className: 'a360-sugText', key: 'why' }, labeled(t, 'whyLabel', s.why)) : null,
            s.risk ? h('div', { className: 'a360-sugText', key: 'risk' }, labeled(t, 'riskLabel', s.risk)) : null,
            lesson && draft.trigger
              ? h('div', { className: 'a360-sugText', key: 'trigger' },
                labeled(t, 'evolveTrigger', clip(draft.trigger, 160)))
              : null,
            h(PreviewBlock, { preview: s.preview, t, prefix: 'a360-', key: 'preview' }),
          ];
          if (s.kind === 'manual' && !lesson) {
            return h('li', { className: 'a360-sug', key: s.id, 'data-kind': 'manual' },
              h('div', { className: 'a360-sugHead' }, kindChip, h('span', { className: 'a360-sugTitle' }, s.title)),
              h('div', { className: 'a360-manualNote' }, t('manualNote')),
              body);
          }
          return h('li', { className: 'a360-sug', key: s.id, 'data-kind': lesson ? 'draft' : s.kind },
            h('div', { className: 'a360-sugHead' }, kindChip, h('span', { className: 'a360-sugTitle' }, s.title)),
            lesson
              ? h('div', { className: 'a360-draftNote' }, t('agentsEvolveNote'))
              : (s.kind === 'draft' ? h('div', { className: 'a360-draftNote' }, t('agentsDraftNote')) : null),
            body,
            h('div', { className: 'a360-sugActions' },
              h('button', {
                type: 'button',
                className: 'a360-btn a360-btnPrimary',
                disabled: props.busy,
                onClick: () => props.onApply(s),
              }, t(agentsSuggestionActionKey(s)))));
        }));
    }

    function ConflictsList(props) {
      const rows = props.conflicts || [];
      const t = props.t;
      if (rows.length === 0) {
        return h('div', { className: 'a360-muted' }, t('noConflicts'));
      }
      return h('ul', { className: 'a360-conflicts' },
        rows.map((row, index) => h('li', {
          className: 'a360-conflict',
          key: (row.otherId || 'conflict') + ':' + index,
          'data-kind': row.kind,
        },
          h('div', { className: 'a360-conflictHead' },
            h(Chip, { prefix: 'a360-', tone: row.kind === 'contradiction' ? 'sev-critical' : 'sev-major' },
              row.kind === 'contradiction' ? t('conflictContradiction') : t('conflictDuplicate')),
            h('span', { className: 'a360-conflictOther' },
              labeled(t, 'conflictOther', row.otherName)),
            row.ratio == null ? null : h('span', { className: 'a360-conflictRatio' }, formatPercent(row.ratio))),
          h('div', { className: 'a360-conflictRule' },
            h('code', { className: 'a360-rule' }, labeled(t, 'ruleSelf', clip(row.selfRule || '—', 160)))),
          h('div', { className: 'a360-conflictRule' },
            h('code', { className: 'a360-rule' }, labeled(t, 'ruleOther', clip(row.otherRule || '—', 160)))),
          (row.selfLine != null || row.otherLine != null)
            ? h('div', { className: 'a360-conflictLine' },
              t('conflictLines', {
                other: (row.otherName || '—') + (row.otherLine != null ? ':' + row.otherLine : ''),
                self: row.selfLine != null ? String(row.selfLine) : '—',
              }))
            : null)));
    }

    function AgentsOverlapsList(props) {
      const overlaps = props.overlaps || [];
      const t = props.t;
      if (overlaps.length === 0) {
        return h('div', { className: 'a360-muted' }, t('agentsNoOverlaps'));
      }
      return h('ul', { className: 'a360-overlaps' },
        overlaps.map((o) => h('li', { className: 'a360-overlap', key: o.id || o.name },
          h('button', {
            type: 'button',
            className: 'a360-overlapBtn',
            onClick: () => props.onJump(o.id || o.name),
          },
            h('span', { className: 'a360-overlapName' }, o.name || o.id),
            h('span', { className: 'a360-overlapScore' }, formatPercent(o.score)),
            o.sharedTriggers && o.sharedTriggers.length
              ? h('span', { className: 'a360-overlapTriggers' }, o.sharedTriggers.join(', '))
              : null))));
    }

    function AgentsEvolveEditor(props) {
      const editor = props.editor;
      const t = props.t;
      if (!editor) return null;
      const rule = String(editor.rule || '');
      return h('div', { className: 'a360-editor', 'data-open': 'true' },
        h('div', { className: 'a360-editorTitle' }, t('agentsEvolveEditorTitle')),
        h('label', { className: 'a360-field' },
          h('span', { className: 'a360-fieldLabel' }, t('evolveTrigger')),
          h('input', {
            className: 'a360-input',
            type: 'text',
            name: 'trigger',
            value: String(editor.trigger || ''),
            onChange: (event) => props.onChange('trigger', event.target.value),
          })),
        h('label', { className: 'a360-field' },
          h('span', { className: 'a360-fieldLabel' }, t('agentsEvolveRule')),
          h('textarea', {
            className: 'a360-textarea',
            name: 'rule',
            rows: 3,
            value: rule,
            placeholder: t('evolveRuleHint'),
            onChange: (event) => props.onChange('rule', event.target.value),
          })),
        h('label', { className: 'a360-field' },
          h('span', { className: 'a360-fieldLabel' }, t('evolveEvidence')),
          h('input', {
            className: 'a360-input',
            type: 'text',
            name: 'evidence',
            value: String(editor.evidence || ''),
            onChange: (event) => props.onChange('evidence', event.target.value),
          })),
        h('div', { className: 'a360-editorHint' }, t('evolveRuleHint')),
        h('div', { className: 'a360-editorActions' },
          h('button', {
            type: 'button',
            className: 'a360-btn a360-btnPrimary',
            disabled: props.busy || !rule.trim(),
            onClick: props.onSubmit,
          }, t('agentsEvolveWrite')),
          h('button', {
            type: 'button',
            className: 'a360-btn',
            disabled: props.busy,
            onClick: props.onCancel,
          }, t('evolveCancel'))));
    }

    function AgentsEvolutionSection(props) {
      const ev = agentsNormalizeEvolution(props.evolution);
      const t = props.t;
      const lessons = ev.lessons;
      const signals = ev.signals;
      const pending = ev.pending;
      const counters = [
        ['signalSessions', signals.sessions],
        ['signalCorrections', signals.corrections],
        ['signalErrors', signals.postLoadErrors],
        ['agentsSignalReloads', signals.reloads],
        ['agentsSignalFailures', signals.turnFailures],
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
        className: 'a360-section a360-evolution',
        'data-applicable': ev.applicable ? 'true' : 'false',
      },
        h('h3', { className: 'a360-sectionTitle' },
          t('evolutionSectionTitle'),
          ev.applicable ? null : h(Chip, { prefix: 'a360-', tone: 'na' }, t('agentsNotScored')),
          pending.hasUnclosed ? h(Chip, { prefix: 'a360-', tone: 'evolve' }, t('evolvePendingBadge')) : null),
        ev.applicable ? null : h('div', { className: 'a360-muted' }, t('agentsEvolutionNotScored')),
        h('div', { className: 'a360-metrics' },
          h('div', { className: 'a360-metric' },
            h('div', { className: 'a360-metricLabel' }, t('evolveLessons')),
            h('div', { className: 'a360-metricValue' }, String(lessons.count))),
          h('div', { className: 'a360-metric' },
            h('div', { className: 'a360-metricLabel' }, t('evolveLatest')),
            h('div', { className: 'a360-metricValue' },
              lessons.latestAt == null ? t('evolveNever') : formatDay(lessons.latestAt))),
          h('div', { className: 'a360-metric' },
            h('div', { className: 'a360-metricLabel' }, t('evolveEntry')),
            h('div', { className: 'a360-metricValue' },
              lessons.linked ? t('evolveLinkedYes') : t('evolveLinkedNo'))),
          h('div', { className: 'a360-metric' },
            h('div', { className: 'a360-metricLabel' }, t('evolveLastSignal')),
            h('div', { className: 'a360-metricValue' },
              pending.lastSignalAt == null ? '—' : formatDay(pending.lastSignalAt)))),
        lessons.count === 0 ? h('div', { className: 'a360-evEmpty' }, t('agentsEvolveEmptyLessons')) : null,
        h('div', { className: 'a360-subLabel' }, t('agentsEvolveSignals')),
        h('div', { className: 'a360-evSignals' },
          counters.map((entry) => h('span', { className: 'a360-evSignal', key: entry[0] },
            h('span', { className: 'a360-evSignalLabel' }, t(entry[0])),
            h('span', { className: 'a360-evSignalValue' }, String(entry[1]))))),
        signalTotal === 0 ? h('div', { className: 'a360-evEmpty' }, t('agentsEvolveEmptySignals')) : null,
        signals.samples.length
          ? h('ul', { className: 'a360-evSamples' },
            signals.samples.slice(0, 4).map((sample, index) => h('li', {
              className: 'a360-evSample',
              key: (sample.sessionId || 'sample') + ':' + index,
            },
              h('span', { className: 'a360-evSampleKind' }, t(agentsSignalKindKey(sample.kind))),
              h('span', { className: 'a360-evSampleText' }, clip(sample.excerpt || '', 160)),
              h('span', { className: 'a360-evSampleMeta' },
                (sample.sessionId || '—') + ' · ' + formatDay(sample.at)))))
          : null,
        h('div', { className: 'a360-subLabel' }, t('evolvePendingTitle')),
        proposals.length
          ? h('ul', { className: 'a360-evProposals' },
            proposals.map((proposal, index) => {
              const draft = (proposal && proposal.draft) || {};
              return h('li', {
                className: 'a360-evProposal',
                key: (proposal && proposal.id ? proposal.id : 'proposal') + ':' + index,
              },
                h('div', { className: 'a360-evTrigger' },
                  draft.trigger ? clip(draft.trigger, 160) : t('evolveNoTrigger')),
                proposal && proposal.title ? h('div', { className: 'a360-sugText' }, proposal.title) : null,
                proposal && proposal.why ? h('div', { className: 'a360-sugText' }, proposal.why) : null,
                h('div', { className: 'a360-evEvidence' },
                  labeled(t, 'evolveEvidence',
                    draft.evidence || agentsEvidenceText(proposal && proposal.evidence))
                  + (pending.lastSignalAt != null ? ' · ' + formatDay(pending.lastSignalAt) : '')),
                h('button', {
                  type: 'button',
                  className: 'a360-btn a360-btnPrimary a360-btnSm',
                  disabled: props.busy,
                  onClick: () => props.onEdit(draft),
                }, t('agentsEvolveButton')));
            }))
          : h('div', { className: 'a360-evEmpty' }, t('agentsEvolveNoPending')),
        props.editor ? h(AgentsEvolveEditor, {
          editor: props.editor,
          t,
          busy: props.busy,
          onChange: props.onChange,
          onSubmit: props.onSubmit,
          onCancel: props.onCancel,
        }) : null);
    }

    function AgentsDetailView(props) {
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
      const verdictKey = agentsVerdictKeyOf(verdict.code);
      const kindKey = AGENTS_KIND_KEY[detail.kind] || null;
      const scopeKey = AGENTS_SCOPE_KEY[detail.scope] || null;
      const delta = score.delta;

      return h('div', { className: 'a360-detailBody' },
        h('div', { className: 'a360-detailHead' },
          h('div', { className: 'a360-detailTop' },
            h('div', { className: 'a360-detailTitleLine' },
              h('h2', { className: 'a360-detailName' }, detail.name),
              kindKey ? h(Chip, { prefix: 'a360-', tone: 'kind-' + detail.kind }, t(kindKey)) : null,
              scopeKey ? h(Chip, { prefix: 'a360-', tone: 'scope' }, t(scopeKey)) : null,
              h('span', { className: gradeBadgeClass('a360-', score) }, score.grade || '—'),
              verdictKey ? h(Chip, { prefix: 'a360-', tone: verdict.code }, t(verdictKey)) : null),
            h('div', { className: 'a360-detailActions' },
              h('button', {
                type: 'button',
                className: 'a360-btn a360-btnPrimary',
                disabled: props.busy,
                onClick: () => props.onApplyAll(detail.id),
              }, t('applyAllSubject')))),
          detail.title ? h('p', { className: 'a360-detailDesc' }, detail.title) : null,
          detail.description ? h('p', { className: 'a360-detailDesc' }, detail.description) : null,
          h('div', { className: 'a360-detailScoreRow' },
            h('div', { className: 'a360-bigScore' },
              h('span', { className: 'a360-bigScoreNum' }, fmt1(score.total)),
              h('span', { className: 'a360-bigScoreLabel' }, t('scoreLabel'))),
            h('div', { className: 'a360-scoreMeta' },
              h('span', { className: 'a360-scoreMetaItem' }, labeled(t, 'confidenceLabel', fmt1(score.confidence))),
              delta != null
                ? h('span', {
                  className: 'a360-scoreMetaItem',
                  'data-delta': delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
                }, labeled(t, 'deltaLabel', (delta > 0 ? '+' : '') + fmt1(delta)))
                : null)),
          verdict.reason
            ? h('div', { className: 'a360-verdictReason' }, labeled(t, 'verdictLabel', verdict.reason))
            : null,
          detail.path ? h('div', { className: 'a360-path' }, labeled(t, 'pathLabel', detail.path)) : null,
          detail.owner ? h('div', { className: 'a360-coverage' }, labeled(t, 'ownerLabel', detail.owner)) : null,
          detail.coverage
            ? h('div', { className: 'a360-coverage' },
              labeled(t, 'coverageLabel',
                detail.coverage === 'full' ? t('coverageFull') : t('coveragePartial')))
            : null),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('classificationTitle')),
          h(ClassificationCard, {
            item: detail,
            taxonomy: props.taxonomy,
            t,
            onFilterRole: props.onFilterRole,
            pendingFallbackLabel: agentsEvolutionPending(detail) ? t('evolvePendingBadge') : null,
            fallbackKeys: { kind: AGENTS_KIND_KEY, scope: AGENTS_SCOPE_KEY },
          })),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('dimensionsTitle')),
          dimensions.slice().sort((a, b) => {
            const ia = AGENTS_DIM_ORDER.indexOf(a.id);
            const ib = AGENTS_DIM_ORDER.indexOf(b.id);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          }).map((dim) => h(AgentsDimensionBlock, { dim, t, key: dim.id }))),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('injectionTitle')),
          h(InjectionCard, { injection: detail.injection, t })),

        h(AgentsEvolutionSection, {
          evolution: detail.evolution,
          t,
          busy: props.busy,
          editor: props.evolveEditor,
          onEdit: props.onEvolveEdit,
          onChange: props.onEvolveChange,
          onSubmit: props.onEvolveSubmit,
          onCancel: props.onEvolveCancel,
        }),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('metricsTitle')),
          h(AgentsMetricsGrid, { metrics: detail.metrics, usage: detail.usage, t })),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('findingsTitle')),
          h(AgentsFindingsList, { findings, suggestions, t, busy: props.busy, onApply: props.onApply })),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('suggestionsTitle')),
          h(AgentsSuggestionsList, { suggestions, t, busy: props.busy, onApply: props.onApply })),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('conflictsTitle')),
          h(ConflictsList, { conflicts: props.conflicts, t })),

        h('section', { className: 'a360-section' },
          h('h3', { className: 'a360-sectionTitle' }, t('agentsOverlapsTitle')),
          h(AgentsOverlapsList, { overlaps, t, onJump: props.onJump })),

        h('details', { className: 'a360-source' },
          h('summary', { className: 'a360-sourceSummary' }, t('viewSource')),
          h('pre', { className: 'a360-sourcePre' }, rawLines || '')));
    }

    // -------------------------------------------------------------------- page

    function Dsh360Page() {
      const t = useTranslate();

      // useState order — MUST stay in sync with test/verify-client.mjs seeds:
      // 0 tab
      // 1..23 skills surface (23 states)
      // 24..46 agents surface (23 states)
      // Requested flags start from the active tab, so a direct mount on the agents
      // tab never causes a skills scan (and vice versa). Switching tabs flips them.
      const [tab, setTab] = React.useState('skills');

      const [skillsRequested, setSkillsRequested] = React.useState(tab === 'skills');
      const [skillsLoading, setSkillsLoading] = React.useState(true);
      const [skillsPortfolio, setSkillsPortfolio] = React.useState(null);
      const [skillsLoadError, setSkillsLoadError] = React.useState('');
      const [skillsRefreshKey, setSkillsRefreshKey] = React.useState(0);
      const [skillsSelected, setSkillsSelected] = React.useState('');
      const [skillsDetail, setSkillsDetail] = React.useState(null);
      const [skillsDetailLoading, setSkillsDetailLoading] = React.useState(false);
      const [skillsDetailError, setSkillsDetailError] = React.useState('');
      const [skillsDetailVersion, setSkillsDetailVersion] = React.useState(0);
      const [skillsQuery, setSkillsQuery] = React.useState('');
      const [skillsFiltersOpen, setSkillsFiltersOpen] = React.useState(false);
      const [skillsRoleFilter, setSkillsRoleFilter] = React.useState('all');
      const [skillsLayerFilter, setSkillsLayerFilter] = React.useState('all');
      const [skillsKindFilter, setSkillsKindFilter] = React.useState('all');
      const [skillsScopeFilter, setSkillsScopeFilter] = React.useState('all');
      const [skillsGradeFilter, setSkillsGradeFilter] = React.useState('all');
      const [skillsVerdictFilter, setSkillsVerdictFilter] = React.useState('all');
      const [skillsSourceFilter, setSkillsSourceFilter] = React.useState('all');
      const [skillsOnlyProblems, setSkillsOnlyProblems] = React.useState(false);
      const [skillsNotice, setSkillsNotice] = React.useState(null);
      const [skillsBusy, setSkillsBusy] = React.useState(false);
      const [skillsLastBackupIds, setSkillsLastBackupIds] = React.useState([]);
      const [skillsEvolveEditor, setSkillsEvolveEditor] = React.useState(null);
      const [skillsEffect, setSkillsEffect] = React.useState(null);

      const [agentsRequested, setAgentsRequested] = React.useState(tab === 'agents');
      const [agentsLoading, setAgentsLoading] = React.useState(true);
      const [agentsPortfolio, setAgentsPortfolio] = React.useState(null);
      const [agentsLoadError, setAgentsLoadError] = React.useState('');
      const [agentsRefreshKey, setAgentsRefreshKey] = React.useState(0);
      const [agentsSelected, setAgentsSelected] = React.useState('');
      const [agentsDetail, setAgentsDetail] = React.useState(null);
      const [agentsDetailLoading, setAgentsDetailLoading] = React.useState(false);
      const [agentsDetailError, setAgentsDetailError] = React.useState('');
      const [agentsDetailVersion, setAgentsDetailVersion] = React.useState(0);
      const [agentsQuery, setAgentsQuery] = React.useState('');
      const [agentsFiltersOpen, setAgentsFiltersOpen] = React.useState(false);
      const [agentsRoleFilter, setAgentsRoleFilter] = React.useState('all');
      const [agentsKindFilter, setAgentsKindFilter] = React.useState('all');
      const [agentsScopeFilter, setAgentsScopeFilter] = React.useState('all');
      const [agentsGradeFilter, setAgentsGradeFilter] = React.useState('all');
      const [agentsVerdictFilter, setAgentsVerdictFilter] = React.useState('all');
      const [agentsOnlyProblems, setAgentsOnlyProblems] = React.useState(false);
      const [agentsOnlyEvolution, setAgentsOnlyEvolution] = React.useState(false);
      const [agentsNotice, setAgentsNotice] = React.useState(null);
      const [agentsBusy, setAgentsBusy] = React.useState(false);
      const [agentsLastBackupIds, setAgentsLastBackupIds] = React.useState([]);
      const [agentsEvolveEditor, setAgentsEvolveEditor] = React.useState(null);
      const [agentsEffect, setAgentsEffect] = React.useState(null);

      const skillsForceRefresh = React.useRef(false);
      const agentsForceRefresh = React.useRef(false);
      const skillsUndoIds = Array.isArray(skillsLastBackupIds)
        ? skillsLastBackupIds
        : (skillsLastBackupIds ? [skillsLastBackupIds] : []);
      const agentsUndoIds = Array.isArray(agentsLastBackupIds)
        ? agentsLastBackupIds
        : (agentsLastBackupIds ? [agentsLastBackupIds] : []);

      // ---- skills scan effect (lazy surface + stale-while-revalidate)
      React.useEffect(() => {
        if (!skillsRequested) return undefined;
        // Already painted: only a forced refresh (button / post-write) may re-scan.
        if (skillsPortfolio && !skillsForceRefresh.current) return undefined;
        let alive = true;
        const forced = skillsForceRefresh.current;
        skillsForceRefresh.current = false;
        setSkillsLoading(true);
        setSkillsLoadError('');
        (async () => {
          let quick = null;
          if (!forced) {
            try {
              const snapshot = await api(SKILLS_API, '/scan?quick=1');
              if (snapshot && Array.isArray(snapshot.skills)) {
                quick = snapshot.stale === false
                  ? snapshot
                  : { ...snapshot, stale: true, cachedAt: snapshot.cachedAt || Date.now() };
              }
            } catch (_error) {
              quick = null; // no snapshot yet (404) or a snapshot read failure: normal scan
            }
            if (!alive) return;
            if (quick) {
              setSkillsPortfolio(quick);
              setSkillsSelected((previous) => {
                const skills = quick.skills || [];
                if (previous && skills.some((s) => s.name === previous)) return previous;
                return skills.length ? skills[0].name : '';
              });
              setSkillsLoading(false);
            }
          }
          try {
            const suffix = forced ? '?refresh=1&view=list' : '?view=list';
            const data = await api(SKILLS_API, '/scan' + suffix);
            if (!alive) return;
            setSkillsPortfolio(data);
            setSkillsSelected((previous) => {
              const skills = (data && data.skills) || [];
              if (previous && skills.some((s) => s.name === previous)) return previous;
              return skills.length ? skills[0].name : '';
            });
          } catch (error) {
            if (alive) setSkillsLoadError(errMessage(error));
          } finally {
            if (alive) setSkillsLoading(false);
          }
        })();
        return () => { alive = false; };
      }, [skillsRefreshKey, skillsRequested]);

      // ---- skills detail effect (only after the surface was requested)
      React.useEffect(() => {
        if (!skillsSelected) {
          setSkillsDetail(null);
          setSkillsDetailError('');
          return undefined;
        }
        if (!skillsRequested) return undefined;
        let alive = true;
        setSkillsDetailLoading(true);
        setSkillsDetailError('');
        api(SKILLS_API, '/skill?name=' + encodeURIComponent(skillsSelected)).then(
          (data) => {
            if (!alive) return;
            setSkillsDetail(data);
            if (data && data.lastBackup && data.lastBackup.id) {
              setSkillsLastBackupIds((previous) => {
                const list = Array.isArray(previous) ? previous : (previous ? [previous] : []);
                return list.length > 0 ? list : [data.lastBackup.id];
              });
            }
          },
          (error) => { if (alive) setSkillsDetailError(errMessage(error)); },
        ).finally(() => { if (alive) setSkillsDetailLoading(false); });
        return () => { alive = false; };
      }, [skillsSelected, skillsDetailVersion, skillsRequested]);

      // ---- agents scan effect (lazy surface + stale-while-revalidate)
      React.useEffect(() => {
        if (!agentsRequested) return undefined;
        if (agentsPortfolio && !agentsForceRefresh.current) return undefined;
        let alive = true;
        const forced = agentsForceRefresh.current;
        agentsForceRefresh.current = false;
        setAgentsLoading(true);
        setAgentsLoadError('');
        (async () => {
          let quick = null;
          if (!forced) {
            try {
              const snapshot = await api(AGENTS_API, '/scan?quick=1');
              if (snapshot && Array.isArray(snapshot.subjects)) {
                quick = snapshot.stale === false
                  ? snapshot
                  : { ...snapshot, stale: true, cachedAt: snapshot.cachedAt || Date.now() };
              }
            } catch (_error) {
              quick = null;
            }
            if (!alive) return;
            if (quick) {
              setAgentsPortfolio(quick);
              setAgentsSelected((previous) => {
                const subjects = quick.subjects || [];
                if (previous && subjects.some((s) => s.id === previous)) return previous;
                return subjects.length ? subjects[0].id : '';
              });
              setAgentsLoading(false);
            }
          }
          try {
            const suffix = forced ? '?refresh=1&view=list' : '?view=list';
            const data = await api(AGENTS_API, '/scan' + suffix);
            if (!alive) return;
            setAgentsPortfolio(data);
            setAgentsSelected((previous) => {
              const subjects = (data && data.subjects) || [];
              if (previous && subjects.some((s) => s.id === previous)) return previous;
              return subjects.length ? subjects[0].id : '';
            });
          } catch (error) {
            if (alive) setAgentsLoadError(errMessage(error));
          } finally {
            if (alive) setAgentsLoading(false);
          }
        })();
        return () => { alive = false; };
      }, [agentsRefreshKey, agentsRequested]);

      // ---- agents detail effect (only after the surface was requested)
      React.useEffect(() => {
        if (!agentsSelected) {
          setAgentsDetail(null);
          setAgentsDetailError('');
          return undefined;
        }
        if (!agentsRequested) return undefined;
        let alive = true;
        setAgentsDetailLoading(true);
        setAgentsDetailError('');
        api(AGENTS_API, '/subject?id=' + encodeURIComponent(agentsSelected)).then(
          (data) => {
            if (!alive) return;
            setAgentsDetail(data);
            const known = (data && data.backup && data.backup.id)
              || (data && data.lastBackup && data.lastBackup.id);
            if (known) {
              setAgentsLastBackupIds((previous) => {
                const list = Array.isArray(previous) ? previous : (previous ? [previous] : []);
                return list.length > 0 ? list : [known];
              });
            }
          },
          (error) => { if (alive) setAgentsDetailError(errMessage(error)); },
        ).finally(() => { if (alive) setAgentsDetailLoading(false); });
        return () => { alive = false; };
      }, [agentsSelected, agentsDetailVersion, agentsRequested]);

      // ---- toast auto-dismiss (one per surface)
      React.useEffect(() => {
        if (!skillsNotice) return undefined;
        const timer = window.setTimeout(() => setSkillsNotice(null), 6500);
        return () => window.clearTimeout(timer);
      }, [skillsNotice]);

      React.useEffect(() => {
        if (!agentsNotice) return undefined;
        const timer = window.setTimeout(() => setAgentsNotice(null), 6500);
        return () => window.clearTimeout(timer);
      }, [agentsNotice]);

      // ---- skills memos
      const skillsItems = React.useMemo(
        () => (skillsPortfolio && Array.isArray(skillsPortfolio.skills) ? skillsPortfolio.skills : []),
        [skillsPortfolio],
      );

      const skillsTax = React.useMemo(
        () => taxonomyIndex(skillsPortfolio && skillsPortfolio.taxonomy),
        [skillsPortfolio],
      );

      const skillsCounts = React.useMemo(() => {
        const totals = (skillsPortfolio && skillsPortfolio.totals) || {};
        return {
          role: axisCountsOf(skillsItems, 'role', totals.byRole),
          layer: axisCountsOf(skillsItems, 'layer', totals.byLayer),
          kind: axisCountsOf(skillsItems, 'kind', totals.byKind),
          scope: axisCountsOf(skillsItems, 'scope', totals.byScope),
          grade: (totals.grades && typeof totals.grades === 'object')
            ? totals.grades
            : gradeCountsOf(skillsItems),
        };
      }, [skillsItems, skillsPortfolio]);

      const skillsClassLabels = React.useMemo(() => ({
        role: classificationLabelMapOf(skillsItems, 'role'),
        layer: classificationLabelMapOf(skillsItems, 'layer'),
        kind: classificationLabelMapOf(skillsItems, 'kind'),
        scope: classificationLabelMapOf(skillsItems, 'scope'),
      }), [skillsItems]);

      const skillsRoleOptions = React.useMemo(
        () => axisOptionsOf(skillsTax, 'role', skillsCounts.role, null, t, skillsClassLabels.role),
        [skillsTax, skillsCounts.role, skillsClassLabels.role, t],
      );
      const skillsLayerOptions = React.useMemo(
        () => axisOptionsOf(skillsTax, 'layer', skillsCounts.layer, null, t, skillsClassLabels.layer),
        [skillsTax, skillsCounts.layer, skillsClassLabels.layer, t],
      );
      const skillsKindOptions = React.useMemo(
        () => axisOptionsOf(skillsTax, 'kind', skillsCounts.kind, null, t, skillsClassLabels.kind),
        [skillsTax, skillsCounts.kind, skillsClassLabels.kind, t],
      );
      const skillsScopeOptions = React.useMemo(
        () => axisOptionsOf(skillsTax, 'scope', skillsCounts.scope, null, t, skillsClassLabels.scope),
        [skillsTax, skillsCounts.scope, skillsClassLabels.scope, t],
      );

      const skillsVisible = React.useMemo(() => {
        const needle = skillsQuery.trim().toLowerCase();
        return skillsItems.filter((s) => {
          if (skillsRoleFilter !== 'all' && axisIdOf(s, 'role') !== skillsRoleFilter) return false;
          if (skillsLayerFilter !== 'all' && axisIdOf(s, 'layer') !== skillsLayerFilter) return false;
          if (skillsKindFilter !== 'all' && axisIdOf(s, 'kind') !== skillsKindFilter) return false;
          if (skillsScopeFilter !== 'all' && axisIdOf(s, 'scope') !== skillsScopeFilter) return false;
          if (skillsGradeFilter !== 'all' && gradeLetterOf(s.score) !== skillsGradeFilter) return false;
          if (skillsVerdictFilter !== 'all' && (s.verdict && s.verdict.code) !== skillsVerdictFilter) return false;
          if (skillsSourceFilter !== 'all' && s.source !== skillsSourceFilter) return false;
          if (skillsOnlyProblems && !skillsHasMajorPlus(s)) return false;
          if (needle) {
            const hay = [s.name, s.description, classificationSummaryOf(s)].join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          return true;
        });
      }, [skillsItems, skillsQuery, skillsRoleFilter, skillsLayerFilter, skillsKindFilter, skillsScopeFilter,
        skillsGradeFilter, skillsVerdictFilter, skillsSourceFilter, skillsOnlyProblems]);

      const skillsSources = React.useMemo(() => {
        const seen = new Set();
        skillsItems.forEach((s) => { if (s.source) seen.add(s.source); });
        return Array.from(seen).sort();
      }, [skillsItems]);

      // ---- agents memos
      const agentsSubjects = React.useMemo(
        () => (agentsPortfolio && Array.isArray(agentsPortfolio.subjects) ? agentsPortfolio.subjects : []),
        [agentsPortfolio],
      );

      const agentsTax = React.useMemo(
        () => taxonomyIndex(agentsPortfolio && agentsPortfolio.taxonomy),
        [agentsPortfolio],
      );

      const agentsCounts = React.useMemo(() => {
        const totals = (agentsPortfolio && agentsPortfolio.totals) || {};
        return {
          role: axisCountsOf(agentsSubjects, 'role', totals.byRole),
          kind: axisCountsOf(agentsSubjects, 'kind', totals.byKind),
          scope: axisCountsOf(agentsSubjects, 'scope', totals.byScope),
          grade: (totals.grades && typeof totals.grades === 'object')
            ? totals.grades
            : gradeCountsOf(agentsSubjects),
        };
      }, [agentsSubjects, agentsPortfolio]);

      const agentsClassLabels = React.useMemo(() => ({
        role: classificationLabelMapOf(agentsSubjects, 'role'),
        kind: classificationLabelMapOf(agentsSubjects, 'kind'),
        scope: classificationLabelMapOf(agentsSubjects, 'scope'),
      }), [agentsSubjects]);

      const agentsRoleOptions = React.useMemo(
        () => axisOptionsOf(agentsTax, 'role', agentsCounts.role, null, t, agentsClassLabels.role),
        [agentsTax, agentsCounts.role, agentsClassLabels.role, t],
      );
      const agentsKindOptions = React.useMemo(
        () => axisOptionsOf(agentsTax, 'kind', agentsCounts.kind, AGENTS_KIND_KEY, t, agentsClassLabels.kind),
        [agentsTax, agentsCounts.kind, agentsClassLabels.kind, t],
      );
      const agentsScopeOptions = React.useMemo(
        () => axisOptionsOf(agentsTax, 'scope', agentsCounts.scope, AGENTS_SCOPE_KEY, t, agentsClassLabels.scope),
        [agentsTax, agentsCounts.scope, agentsClassLabels.scope, t],
      );

      const agentsVisible = React.useMemo(() => {
        const needle = agentsQuery.trim().toLowerCase();
        return agentsSubjects.filter((s) => {
          if (agentsRoleFilter !== 'all' && axisIdOf(s, 'role') !== agentsRoleFilter) return false;
          if (agentsKindFilter !== 'all' && axisIdOf(s, 'kind') !== agentsKindFilter) return false;
          if (agentsScopeFilter !== 'all' && axisIdOf(s, 'scope') !== agentsScopeFilter) return false;
          if (agentsGradeFilter !== 'all' && gradeLetterOf(s.score) !== agentsGradeFilter) return false;
          if (agentsVerdictFilter !== 'all' && agentsVerdictCodeOf(s) !== agentsVerdictFilter) return false;
          if (agentsOnlyProblems && !agentsHasMajorPlus(s)) return false;
          if (agentsOnlyEvolution && !agentsEvolutionPending(s)) return false;
          if (needle) {
            const hay = [s.id, s.name, s.path, s.title, s.description, classificationSummaryOf(s)]
              .filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          return true;
        });
      }, [agentsSubjects, agentsQuery, agentsRoleFilter, agentsKindFilter, agentsScopeFilter,
        agentsGradeFilter, agentsVerdictFilter, agentsOnlyProblems, agentsOnlyEvolution]);

      // ---- skills handlers
      function skillsNameOf(key) {
        const found = skillsItems.find((item) => item.name === key || item.id === key);
        return found ? displayNameOf(found, key) : String(key == null ? '—' : key);
      }

      function skillsFilterByRole(roleId) {
        if (!roleId) return;
        setSkillsRoleFilter(roleId);
        setSkillsFiltersOpen(true);
      }

      function skillsClearFilters() {
        setSkillsRoleFilter('all');
        setSkillsLayerFilter('all');
        setSkillsKindFilter('all');
        setSkillsScopeFilter('all');
        setSkillsGradeFilter('all');
        setSkillsVerdictFilter('all');
        setSkillsSourceFilter('all');
        setSkillsOnlyProblems(false);
      }

      const skillsRefresh = React.useCallback(() => {
        skillsForceRefresh.current = true;
        setSkillsRefreshKey((value) => value + 1);
      }, []);

      async function skillsRefreshAfterWrite() {
        skillsForceRefresh.current = true;
        setSkillsRefreshKey((value) => value + 1);
        setSkillsDetailVersion((value) => value + 1);
      }

      async function skillsApplySuggestion(suggestion) {
        if (!skillsSelected || !suggestion) return;
        setSkillsBusy(true);
        try {
          const before = skillsDetail && skillsDetail.score ? skillsDetail.score.total : null;
          const res = await api(SKILLS_API, '/apply', {
            method: 'POST',
            body: { name: skillsSelected, actionIds: [suggestion.id] },
          });
          const backupId = res && res.backupId;
          const after = res && res.report && res.report.score ? res.report.score.total : null;
          const effect = res && res.effect && typeof res.effect === 'object' ? res.effect : null;
          if (effect) setSkillsEffect(effect);
          setSkillsLastBackupIds(backupId ? [backupId] : []);
          const itemsText = effect ? effectToastOf(effect, skillsNameOf, t) : '';
          setSkillsNotice({
            kind: 'success',
            text: itemsText
              ? t('applyToastItems', { backupId: backupId || '—', items: itemsText })
              : t('applyDone', {
                backupId: backupId || '—',
                before: fmt1(before),
                after: fmt1(after),
              }),
          });
          await skillsRefreshAfterWrite();
        } catch (error) {
          setSkillsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setSkillsBusy(false);
        }
      }

      function skillsOpenEvolveEditor(lesson) {
        const draft = lesson || {};
        setSkillsEvolveEditor({
          trigger: String(draft.trigger == null ? '' : draft.trigger),
          rule: String(draft.rule == null ? '' : draft.rule),
          evidence: String(draft.evidence == null ? '' : draft.evidence),
        });
      }

      function skillsCloseEvolveEditor() {
        setSkillsEvolveEditor(null);
      }

      function skillsChangeEvolveField(field, value) {
        setSkillsEvolveEditor((previous) => (previous ? { ...previous, [field]: value } : previous));
      }

      async function skillsSubmitEvolve() {
        if (!skillsSelected || !skillsEvolveEditor) return;
        const lesson = {
          trigger: String(skillsEvolveEditor.trigger || '').trim(),
          rule: String(skillsEvolveEditor.rule || '').trim(),
          evidence: String(skillsEvolveEditor.evidence || '').trim(),
        };
        if (!lesson.rule) {
          setSkillsNotice({ kind: 'error', text: t('skillsEvolveRuleRequired') });
          return;
        }
        const confirmed = window.confirm(t('skillsConfirmEvolve', { name: skillsSelected }));
        if (!confirmed) return;
        setSkillsBusy(true);
        try {
          const before = skillsDetail && skillsDetail.score ? skillsDetail.score.total : null;
          const res = await api(SKILLS_API, '/evolve', {
            method: 'POST',
            body: { name: skillsSelected, lesson },
          });
          const backupId = res && res.backupId;
          const after = res && res.afterTotal != null
            ? res.afterTotal
            : (res && res.report && res.report.score ? res.report.score.total : null);
          const from = res && res.beforeTotal != null ? res.beforeTotal : before;
          setSkillsLastBackupIds(backupId ? [backupId] : []);
          setSkillsEvolveEditor(null);
          setSkillsNotice({
            kind: 'success',
            text: t('skillsEvolveDone', {
              backupId: backupId || '—',
              before: fmt1(from),
              after: fmt1(after),
            }),
          });
          await skillsRefreshAfterWrite();
        } catch (error) {
          setSkillsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setSkillsBusy(false);
        }
      }

      function skillsApplyOrEvolve(suggestion) {
        if (!suggestion) return;
        if (skillsIsLessonSuggestion(suggestion)) {
          skillsOpenEvolveEditor(skillsLessonOf(suggestion));
          return;
        }
        skillsApplySuggestion(suggestion);
      }

      async function skillsApplyAll(name) {
        const confirmed = window.confirm(name ? t('confirmApplyAllSkill') : t('skillsConfirmApplyAll'));
        if (!confirmed) return;
        setSkillsBusy(true);
        try {
          const body = name ? { name, safeOnly: true } : { safeOnly: true };
          const res = await api(SKILLS_API, '/apply-all', { method: 'POST', body });
          const backupId = res && res.backupId;
          const appliedCount = res && res.applied ? res.applied.length : 0;
          const effect = res && res.effect && typeof res.effect === 'object' ? res.effect : null;
          if (effect) setSkillsEffect(effect);
          const backupIds = Array.isArray(res && res.backupIds) && res.backupIds.length
            ? res.backupIds
            : (backupId ? [backupId] : []);
          setSkillsLastBackupIds(backupIds);
          const itemsText = effect ? effectToastOf(effect, skillsNameOf, t) : '';
          setSkillsNotice({
            kind: 'success',
            text: itemsText
              ? t('applyAllToastItems', {
                count: appliedCount || numberOr(effect && effect.items, 0),
                backupId: backupId || '—',
                items: itemsText,
              })
              : (appliedCount
                ? t('applyAllDone', { count: appliedCount, backupId: backupId || '—' })
                : t('applyAllNone')),
          });
          await skillsRefreshAfterWrite();
        } catch (error) {
          setSkillsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setSkillsBusy(false);
        }
      }

      async function skillsUndoLast(idsOverride) {
        const confirmed = window.confirm(t('skillsConfirmUndo'));
        if (!confirmed) return;
        const ids = Array.isArray(idsOverride) && idsOverride.length > 0 ? idsOverride : skillsUndoIds;
        setSkillsBusy(true);
        try {
          const res = await api(SKILLS_API, '/undo', {
            method: 'POST',
            body: ids.length > 0 ? { backupIds: ids } : {},
          });
          const doneIds = res && Array.isArray(res.backups) ? res.backups.map((item) => item.backupId) : [];
          const backupId = doneIds.length > 0
            ? (doneIds.length === 1 ? doneIds[0] : t('undoMany', { count: doneIds.length }))
            : (ids[0] || '—');
          setSkillsNotice({ kind: 'success', text: t('undoDone', { backupId }) });
          setSkillsLastBackupIds([]);
          setSkillsEffect(null);
          setSkillsPortfolio((previous) => (previous ? { ...previous, lastApply: null } : previous));
          await skillsRefreshAfterWrite();
        } catch (error) {
          setSkillsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setSkillsBusy(false);
        }
      }

      async function skillsExportReport() {
        setSkillsBusy(true);
        try {
          const res = await api(SKILLS_API, '/export', { method: 'POST', body: {} });
          setSkillsNotice({ kind: 'success', text: t('exportDone', { path: (res && res.path) || '—' }) });
        } catch (error) {
          setSkillsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setSkillsBusy(false);
        }
      }

      function skillsJumpTo(name) {
        setSkillsSelected(name);
      }

      function skillsRetryDetail() {
        setSkillsDetailVersion((value) => value + 1);
      }

      // ---- agents handlers
      function agentsNameOf(key) {
        const found = agentsSubjects.find((item) => item.id === key || item.name === key);
        return found ? displayNameOf(found, key) : String(key == null ? '—' : key);
      }

      function agentsFilterByRole(roleId) {
        if (!roleId) return;
        setAgentsRoleFilter(roleId);
        setAgentsFiltersOpen(true);
      }

      function agentsClearFilters() {
        setAgentsRoleFilter('all');
        setAgentsKindFilter('all');
        setAgentsScopeFilter('all');
        setAgentsGradeFilter('all');
        setAgentsVerdictFilter('all');
        setAgentsOnlyProblems(false);
        setAgentsOnlyEvolution(false);
      }

      const agentsRefresh = React.useCallback(() => {
        agentsForceRefresh.current = true;
        setAgentsRefreshKey((value) => value + 1);
      }, []);

      async function agentsRefreshAfterWrite() {
        agentsForceRefresh.current = true;
        setAgentsRefreshKey((value) => value + 1);
        setAgentsDetailVersion((value) => value + 1);
      }

      async function agentsApplySuggestion(suggestion) {
        if (!agentsSelected || !suggestion) return;
        setAgentsBusy(true);
        try {
          const before = agentsDetail && agentsDetail.score ? agentsDetail.score.total : null;
          const res = await api(AGENTS_API, '/apply', {
            method: 'POST',
            body: { id: agentsSelected, actionIds: [suggestion.id] },
          });
          const backupId = res && res.backupId;
          const after = res && res.report && res.report.score ? res.report.score.total : null;
          const effect = res && res.effect && typeof res.effect === 'object' ? res.effect : null;
          if (effect) setAgentsEffect(effect);
          setAgentsLastBackupIds(backupId ? [backupId] : []);
          const itemsText = effect ? effectToastOf(effect, agentsNameOf, t) : '';
          setAgentsNotice({
            kind: 'success',
            text: itemsText
              ? t('applyToastItems', { backupId: backupId || '—', items: itemsText })
              : t('applyDone', {
                backupId: backupId || '—',
                before: fmt1(before),
                after: fmt1(after),
              }),
          });
          await agentsRefreshAfterWrite();
        } catch (error) {
          setAgentsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setAgentsBusy(false);
        }
      }

      function agentsOpenEvolveEditor(lesson) {
        const draft = lesson || {};
        setAgentsEvolveEditor({
          trigger: String(draft.trigger == null ? '' : draft.trigger),
          rule: String(draft.rule == null ? '' : draft.rule),
          evidence: String(draft.evidence == null ? '' : draft.evidence),
        });
      }

      function agentsCloseEvolveEditor() {
        setAgentsEvolveEditor(null);
      }

      function agentsChangeEvolveField(field, value) {
        setAgentsEvolveEditor((previous) => (previous ? { ...previous, [field]: value } : previous));
      }

      async function agentsSubmitEvolve() {
        if (!agentsSelected || !agentsEvolveEditor) return;
        const lesson = {
          trigger: String(agentsEvolveEditor.trigger || '').trim(),
          rule: String(agentsEvolveEditor.rule || '').trim(),
          evidence: String(agentsEvolveEditor.evidence || '').trim(),
        };
        if (!lesson.rule) {
          setAgentsNotice({ kind: 'error', text: t('agentsEvolveRuleRequired') });
          return;
        }
        const confirmed = window.confirm(t('agentsConfirmEvolve', { name: agentsSelected }));
        if (!confirmed) return;
        setAgentsBusy(true);
        try {
          const before = agentsDetail && agentsDetail.score ? agentsDetail.score.total : null;
          const res = await api(AGENTS_API, '/evolve', {
            method: 'POST',
            body: { id: agentsSelected, lesson },
          });
          const backupId = res && res.backupId;
          const after = res && res.afterTotal != null
            ? res.afterTotal
            : (res && res.report && res.report.score ? res.report.score.total : null);
          const from = res && res.beforeTotal != null ? res.beforeTotal : before;
          setAgentsLastBackupIds(backupId ? [backupId] : []);
          setAgentsEvolveEditor(null);
          setAgentsNotice({
            kind: 'success',
            text: t('agentsEvolveDone', {
              backupId: backupId || '—',
              before: fmt1(from),
              after: fmt1(after),
            }),
          });
          await agentsRefreshAfterWrite();
        } catch (error) {
          setAgentsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setAgentsBusy(false);
        }
      }

      function agentsApplyOrEvolve(suggestion) {
        if (!suggestion) return;
        if (agentsIsLessonSuggestion(suggestion)) {
          agentsOpenEvolveEditor(agentsLessonOf(suggestion));
          return;
        }
        agentsApplySuggestion(suggestion);
      }

      async function agentsApplyAll(id) {
        const confirmed = window.confirm(id ? t('confirmApplyAllSubject') : t('agentsConfirmApplyAll'));
        if (!confirmed) return;
        setAgentsBusy(true);
        try {
          const body = id ? { id, safeOnly: true } : { safeOnly: true };
          const res = await api(AGENTS_API, '/apply-all', { method: 'POST', body });
          const backupId = res && res.backupId;
          const appliedCount = res && res.applied ? res.applied.length : 0;
          const effect = res && res.effect && typeof res.effect === 'object' ? res.effect : null;
          if (effect) setAgentsEffect(effect);
          const backupIds = Array.isArray(res && res.backupIds) && res.backupIds.length
            ? res.backupIds
            : (backupId ? [backupId] : []);
          setAgentsLastBackupIds(backupIds);
          const itemsText = effect ? effectToastOf(effect, agentsNameOf, t) : '';
          setAgentsNotice({
            kind: 'success',
            text: itemsText
              ? t('applyAllToastItems', {
                count: appliedCount || numberOr(effect && effect.items, 0),
                backupId: backupId || '—',
                items: itemsText,
              })
              : (appliedCount
                ? t('applyAllDone', { count: appliedCount, backupId: backupId || '—' })
                : t('applyAllNone')),
          });
          await agentsRefreshAfterWrite();
        } catch (error) {
          setAgentsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setAgentsBusy(false);
        }
      }

      async function agentsUndoLast(idsOverride) {
        const confirmed = window.confirm(t('agentsConfirmUndo'));
        if (!confirmed) return;
        const ids = Array.isArray(idsOverride) && idsOverride.length > 0 ? idsOverride : agentsUndoIds;
        setAgentsBusy(true);
        try {
          const res = await api(AGENTS_API, '/undo', {
            method: 'POST',
            body: ids.length > 1
              ? { backupIds: ids }
              : (ids.length === 1 ? { backupId: ids[0] } : {}),
          });
          const doneIds = Array.isArray(res && res.backups)
            ? res.backups.map((item) => item.backupId)
            : [];
          const backupId = (res && res.backupId)
            || (doneIds.length > 0
              ? (doneIds.length === 1 ? doneIds[0] : t('undoMany', { count: doneIds.length }))
              : (ids[0] || '—'));
          setAgentsNotice({ kind: 'success', text: t('undoDone', { backupId }) });
          setAgentsLastBackupIds([]);
          setAgentsEffect(null);
          setAgentsPortfolio((previous) => (previous ? { ...previous, lastApply: null } : previous));
          await agentsRefreshAfterWrite();
        } catch (error) {
          setAgentsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setAgentsBusy(false);
        }
      }

      async function agentsExportReport() {
        setAgentsBusy(true);
        try {
          const res = await api(AGENTS_API, '/export', { method: 'POST', body: {} });
          setAgentsNotice({ kind: 'success', text: t('exportDone', { path: (res && res.path) || '—' }) });
        } catch (error) {
          setAgentsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setAgentsBusy(false);
        }
      }

      function agentsJumpTo(id) {
        setAgentsSelected(id);
      }

      function agentsRetryDetail() {
        setAgentsDetailVersion((value) => value + 1);
      }

      // ---- render helpers

      const gradeDistribution = (grades) => ['S', 'A', 'B', 'C', 'D', 'E'].map((g) => g + ' ' + (grades[g] ?? 0)).join(' · ');
      const gradeTokens = (grades) => h('span', { className: 'd360-gradeTokens' },
        ['S', 'A', 'B', 'C', 'D', 'E'].map((g) => h('span', {
          className: 'd360-gradeTok',
          key: g,
          'data-grade': g,
        },
          h('span', { className: 'd360-gradeTokLetter' }, g),
          h('span', { className: 'd360-gradeTokCount' }, String(grades[g] ?? 0)))));
      const gradeOptionsFor = (counts) => ['S', 'A', 'B', 'C', 'D', 'E'].map((letter) => ({
        id: letter,
        label: letter,
        count: counts[letter] || 0,
      }));
      const verdictOptionsFor = (includeTrim) => {
        const options = [
          { id: 'keep', label: t('verdictKeep') },
          { id: 'watch', label: t('verdictWatch') },
          { id: 'merge', label: t('verdictMerge') },
          { id: 'archive', label: t('verdictArchive') },
        ];
        if (includeTrim) options.splice(3, 0, { id: 'trim', label: t('verdictTrim') });
        return options;
      };
      const sourceOptionsFor = (sources) => sources.map((source) => ({ id: source, label: source }));

      function renderSkillsTab() {
        const stale = !!(skillsPortfolio && skillsPortfolio.stale);
        const backgroundRefresh = skillsLoading && !!skillsPortfolio;
        const toolbar = h('div', { className: 's360-header' },
          h('p', { className: 's360-subtitle' }, t('skillsSubtitle')),
          h('div', { className: 's360-headerActions' },
            h('button', {
              type: 'button',
              className: 's360-btn s360-btnGhost',
              onClick: skillsRefresh,
              // A failed background refresh keeps the stale data but must still
              // allow an explicit retry; only an in-flight one blocks the button.
              disabled: skillsLoading || skillsBusy || (stale && !skillsLoadError),
              title: t('refresh'),
              'aria-label': t('refresh'),
            }, backgroundRefresh ? h(Spinner, { prefix: 's360-' }) : h(RefreshIcon, { size: 14 }), h('span', null, t('refresh'))),
            h('button', {
              type: 'button',
              className: 's360-btn',
              onClick: skillsExportReport,
              disabled: skillsBusy || !skillsPortfolio,
            }, h(ExportIcon, { size: 14 }), h('span', null, t('export'))),
            h('button', {
              type: 'button',
              className: 's360-btn',
              onClick: () => skillsApplyAll(null),
              disabled: skillsBusy || !skillsPortfolio,
            }, t('applyAll')),
            h('button', {
              type: 'button',
              className: 's360-btn',
              onClick: skillsUndoLast,
              disabled: skillsBusy || skillsUndoIds.length === 0,
            }, h(UndoIcon, { size: 14 }), h('span', null, t('undo')))));

        const skillsEmpty = skillsPortfolio && Array.isArray(skillsPortfolio.skills) && skillsPortfolio.skills.length === 0;

        let body;
        if (skillsLoading && !skillsPortfolio) {
          body = h(LoadingSkeleton, { surface: 'skills', label: t('loading') });
        } else if (skillsLoadError && !skillsPortfolio) {
          body = h('div', { className: 's360-center' },
            h('div', { className: 's360-errorText' }, t('loadFailed', { message: skillsLoadError })),
            h('button', { type: 'button', className: 's360-btn s360-btnPrimary', onClick: skillsRefresh }, t('retry')));
        } else if (skillsEmpty) {
          body = h('div', { className: 's360-center' },
            h(EmptyState, {
              prefix: 's360-',
              icon: h(ChartIcon, { size: 26 }),
              title: t('skillsEmptyTitle'),
              hint: t('skillsEmptyHint'),
            }),
            h('button', { type: 'button', className: 's360-btn s360-btnPrimary', onClick: skillsRefresh }, t('refresh')));
        } else {
          const totals = (skillsPortfolio && skillsPortfolio.totals) || {};
          const effectNow = skillsEffect;
          const effectLast = !effectNow && skillsPortfolio ? skillsPortfolio.lastApply : null;

          const statsBar = h('div', { className: 's360-stats', role: 'group', 'aria-label': t('tabSkills') },
            h(StatCard, { prefix: 's360-', label: t('statSkills'), value: String(totals.skills ?? skillsItems.length) }),
            h(StatCard, { prefix: 's360-', label: t('statAvg'), value: fmt1(totals.avgScore) }),
            h(StatCard, {
              prefix: 's360-', label: t('statGrades'), kind: 'grades',
              value: gradeTokens(skillsCounts.grade), ariaLabel: gradeDistribution(skillsCounts.grade),
            }),
            h(StatCard, { prefix: 's360-', label: t('statCatalogTokens'), value: formatTokens(totals.catalogTokens), unit: t('tokensUnit') }),
            h(StatCard, { prefix: 's360-', label: t('statFullTokens'), value: formatTokens(totals.fullLoadTokens), unit: t('tokensUnit') }),
            h(StatCard, { prefix: 's360-', label: t('statZeroUse'), value: String(totals.zeroUse ?? 0) }));

          const skillsActiveFilters = [
            skillsRoleFilter, skillsLayerFilter, skillsKindFilter, skillsScopeFilter,
            skillsGradeFilter, skillsVerdictFilter, skillsSourceFilter,
          ].filter((value) => value !== 'all').length + (skillsOnlyProblems ? 1 : 0);
          const listPane = h('aside', { className: 's360-listPane', 'aria-label': t('tabSkills') },
            h('div', { className: 's360-listHead' },
              h('div', { className: 'd360-filterBar' },
                h('div', { className: 's360-searchWrap' },
                  h(SearchIcon, { size: 14 }),
                  h('input', {
                    type: 'search',
                    className: 's360-input s360-search',
                    value: skillsQuery,
                    placeholder: t('skillsSearchPlaceholder'),
                    'aria-label': t('skillsSearchPlaceholder'),
                    onChange: (event) => setSkillsQuery(event.target.value),
                  })),
                h('button', {
                  type: 'button',
                  className: 'd360-filterBtn',
                  'data-open': skillsFiltersOpen ? 'true' : 'false',
                  'aria-expanded': skillsFiltersOpen ? 'true' : 'false',
                  'aria-controls': 's360-filter-panel',
                  title: t('filters'),
                  onClick: () => setSkillsFiltersOpen((value) => !value),
                },
                  h(FilterIcon, { size: 14 }),
                  h('span', { className: 'd360-filterBtnLabel' }, t('filters')),
                  skillsActiveFilters > 0
                    ? h('span', { className: 'd360-filterCount', 'aria-label': String(skillsActiveFilters) }, String(skillsActiveFilters))
                    : null),
                skillsActiveFilters > 0
                  ? h('button', { type: 'button', className: 'd360-clearFilters', onClick: skillsClearFilters }, t('clearFilters'))
                  : null),
              h('div', {
                className: 'd360-filterPanel',
                id: 's360-filter-panel',
                hidden: !skillsFiltersOpen,
                role: 'group',
                'aria-label': t('filters'),
              },
                h('div', { className: 'd360-filterPanelHead' },
                  h('span', { className: 'd360-filterPanelTitle' }, t('filters')),
                  h('button', {
                    type: 'button',
                    className: 'd360-filterClose',
                    onClick: () => setSkillsFiltersOpen(false),
                  }, t('closeFilters'))),
                h(AxisFilter, {
                  axis: 'role', title: t('axisRole'), values: skillsRoleOptions,
                  current: skillsRoleFilter, onSelect: setSkillsRoleFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'layer', title: t('axisLayer'), values: skillsLayerOptions,
                  current: skillsLayerFilter, onSelect: setSkillsLayerFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'kind', title: t('axisKind'), values: skillsKindOptions,
                  current: skillsKindFilter, onSelect: setSkillsKindFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'scope', title: t('axisScope'), values: skillsScopeOptions,
                  current: skillsScopeFilter, onSelect: setSkillsScopeFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'grade', title: t('axisGrade'), values: gradeOptionsFor(skillsCounts.grade),
                  current: skillsGradeFilter, onSelect: setSkillsGradeFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'verdict', title: t('filterVerdict'), values: verdictOptionsFor(false),
                  current: skillsVerdictFilter, onSelect: setSkillsVerdictFilter, t,
                }),
                sourceOptionsFor(skillsSources).length
                  ? h(AxisFilter, {
                    axis: 'source', title: t('filterSource'), values: sourceOptionsFor(skillsSources),
                    current: skillsSourceFilter, onSelect: setSkillsSourceFilter, t,
                  })
                  : null,
                h('label', { className: 's360-problemsToggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: skillsOnlyProblems,
                    onChange: (event) => setSkillsOnlyProblems(event.target.checked),
                  }),
                  h('span', null, t('skillsOnlyProblems')))),
              h('div', { className: 's360-listMeta' }, t('skillsCount', { count: skillsVisible.length }))),
            h('div', { className: 's360-list' },
              skillsVisible.length === 0
                ? h(EmptyState, { prefix: 's360-', icon: h(SearchIcon, { size: 22 }), title: t('skillsNoMatch'), hint: t('skillsNoMatchHint') })
                : skillsVisible.map((skill) => h(SkillRow, {
                  key: skill.name,
                  skill,
                  taxonomy: skillsTax,
                  t,
                  selected: skillsSelected,
                  onSelect: skillsJumpTo,
                }))));

          const currentDetail = skillsDetail && skillsDetail.name === skillsSelected ? skillsDetail : null;
          let detailPane;
          if (!skillsSelected) {
            detailPane = h('section', { className: 's360-detail' },
              h(EmptyState, { prefix: 's360-', icon: h(ChartIcon, { size: 26 }), title: t('skillsNoSelection'), hint: t('skillsNoSelectionHint') }));
          } else if (skillsDetailLoading && !currentDetail) {
            detailPane = h('section', { className: 's360-detail' },
              h('div', { className: 's360-center' }, h(Spinner, { prefix: 's360-' }), h('span', null, t('loading'))));
          } else if (skillsDetailError && !currentDetail) {
            detailPane = h('section', { className: 's360-detail' },
              h('div', { className: 's360-center' },
                h('div', { className: 's360-errorText' }, t('detailLoadFailed', { message: skillsDetailError })),
                h('button', { type: 'button', className: 's360-btn s360-btnPrimary', onClick: skillsRetryDetail }, t('retry'))));
          } else if (currentDetail) {
            detailPane = h('section', { className: 's360-detail' },
              h(SkillsDetailView, {
                detail: currentDetail,
                taxonomy: skillsTax,
                t,
                busy: skillsBusy,
                onApply: skillsApplyOrEvolve,
                onApplyAll: skillsApplyAll,
                onJump: skillsJumpTo,
                onFilterRole: skillsFilterByRole,
                evolveEditor: skillsEvolveEditor,
                onEvolveEdit: skillsOpenEvolveEditor,
                onEvolveChange: skillsChangeEvolveField,
                onEvolveSubmit: skillsSubmitEvolve,
                onEvolveCancel: skillsCloseEvolveEditor,
              }));
          } else {
            detailPane = h('section', { className: 's360-detail' },
              h('div', { className: 's360-center' }, h(Spinner, { prefix: 's360-' }), h('span', null, t('loading'))));
          }

          body = h('div', { className: 's360-content' },
            h(StaleBanner, { portfolio: skillsPortfolio, t, error: skillsLoadError }),
            effectNow
              ? h(EffectCard, {
                effect: effectNow, t, busy: skillsBusy,
                onUndo: effectBackupIdsOf(effectNow).length
                  ? () => skillsUndoLast(effectBackupIdsOf(effectNow))
                  : undefined,
              })
              : (effectLast ? h(EffectCard, {
                effect: effectLast, isLast: true, t, busy: skillsBusy,
                onUndo: effectBackupIdsOf(effectLast).length
                  ? () => skillsUndoLast(effectBackupIdsOf(effectLast))
                  : undefined,
              }) : null),
            skillsLoadError && !stale
              ? h('div', { className: 's360-banner', 'data-kind': 'error' }, t('loadFailed', { message: skillsLoadError }))
              : null,
            h(SummaryLine, { kind: 'skills', items: skillsItems, portfolio: skillsPortfolio, t }),
            statsBar,
            h('div', { className: 's360-body' }, listPane, detailPane));
        }

        return h('div', { className: 'd360-tabBody' }, toolbar, body, h(Notice, { prefix: 's360-', notice: skillsNotice }));
      }

      function renderAgentsTab() {
        const stale = !!(agentsPortfolio && agentsPortfolio.stale);
        const backgroundRefresh = agentsLoading && !!agentsPortfolio;
        const toolbar = h('div', { className: 'a360-header' },
          h('p', { className: 'a360-subtitle' }, t('agentsSubtitle')),
          h('div', { className: 'a360-headerActions' },
            h('span', { className: 'a360-backup', 'data-backup': agentsUndoIds.length ? 'set' : 'none' },
              labeled(t, 'backupLabel', agentsUndoIds.length ? agentsUndoIds.join(', ') : t('backupNone'))),
            h('button', {
              type: 'button',
              className: 'a360-btn a360-btnGhost',
              onClick: agentsRefresh,
              disabled: agentsLoading || agentsBusy || (stale && !agentsLoadError),
              title: t('refresh'),
              'aria-label': t('refresh'),
            }, backgroundRefresh ? h(Spinner, { prefix: 'a360-' }) : h(RefreshIcon, { size: 14 }), h('span', null, t('refresh'))),
            h('button', {
              type: 'button',
              className: 'a360-btn',
              onClick: agentsExportReport,
              disabled: agentsBusy || !agentsPortfolio,
            }, h(ExportIcon, { size: 14 }), h('span', null, t('export'))),
            h('button', {
              type: 'button',
              className: 'a360-btn',
              onClick: () => agentsApplyAll(null),
              disabled: agentsBusy || !agentsPortfolio,
            }, t('applyAll')),
            h('button', {
              type: 'button',
              className: 'a360-btn',
              onClick: agentsUndoLast,
              disabled: agentsBusy || agentsUndoIds.length === 0,
            }, h(UndoIcon, { size: 14 }), h('span', null, t('undo')))));

        const agentsEmpty = agentsPortfolio && Array.isArray(agentsPortfolio.subjects) && agentsPortfolio.subjects.length === 0;
        const roots = (agentsPortfolio && Array.isArray(agentsPortfolio.roots)) ? agentsPortfolio.roots : [];

        let body;
        if (agentsLoading && !agentsPortfolio) {
          body = h(LoadingSkeleton, { surface: 'agents', label: t('loading') });
        } else if (agentsLoadError && !agentsPortfolio) {
          body = h('div', { className: 'a360-center' },
            h('div', { className: 'a360-errorText' }, t('loadFailed', { message: agentsLoadError })),
            h('button', { type: 'button', className: 'a360-btn a360-btnPrimary', onClick: agentsRefresh }, t('retry')));
        } else if (agentsEmpty) {
          body = h('div', { className: 'a360-center' },
            h(EmptyState, {
              prefix: 'a360-',
              icon: h(ChartIcon, { size: 26 }),
              title: t('agentsEmptyTitle'),
              hint: t('agentsEmptyHint'),
              extra: roots.length ? t('emptyRoots', { roots: roots.join(', ') }) : t('emptyNoRoots'),
            }),
            h('button', { type: 'button', className: 'a360-btn a360-btnPrimary', onClick: agentsRefresh }, t('refresh')));
        } else {
          const totals = (agentsPortfolio && agentsPortfolio.totals) || {};
          const effectNow = agentsEffect;
          const effectLast = !effectNow && agentsPortfolio ? agentsPortfolio.lastApply : null;

          const statsBar = h('div', { className: 'a360-stats', role: 'group', 'aria-label': t('tabAgents') },
            h(StatCard, { prefix: 'a360-', label: t('statSubjects'), value: String(totals.subjects ?? agentsSubjects.length) }),
            h(StatCard, { prefix: 'a360-', label: t('statAvg'), value: fmt1(totals.avgScore) }),
            h(StatCard, {
              prefix: 'a360-', label: t('statGrades'), kind: 'grades',
              value: gradeTokens(agentsCounts.grade), ariaLabel: gradeDistribution(agentsCounts.grade),
            }),
            h(StatCard, { prefix: 'a360-', label: t('statResidentTokens'), value: formatTokens(totals.residentTokens), unit: t('tokensUnit') }),
            h(StatCard, { prefix: 'a360-', label: t('statZeroInject'), value: String(totals.zeroInject ?? 0) }),
            h(StatCard, { prefix: 'a360-', label: t('statConflicts'), value: String(totals.conflicts ?? 0) }));

          const agentsActiveFilters = [
            agentsRoleFilter, agentsKindFilter, agentsScopeFilter,
            agentsGradeFilter, agentsVerdictFilter,
          ].filter((value) => value !== 'all').length + (agentsOnlyProblems ? 1 : 0) + (agentsOnlyEvolution ? 1 : 0);
          const listPane = h('aside', { className: 'a360-listPane', 'aria-label': t('tabAgents') },
            h('div', { className: 'a360-listHead' },
              h('div', { className: 'd360-filterBar' },
                h('div', { className: 'a360-searchWrap' },
                  h(SearchIcon, { size: 14 }),
                  h('input', {
                    type: 'search',
                    className: 'a360-input a360-search',
                    value: agentsQuery,
                    placeholder: t('agentsSearchPlaceholder'),
                    'aria-label': t('agentsSearchPlaceholder'),
                    onChange: (event) => setAgentsQuery(event.target.value),
                  })),
                h('button', {
                  type: 'button',
                  className: 'd360-filterBtn',
                  'data-open': agentsFiltersOpen ? 'true' : 'false',
                  'aria-expanded': agentsFiltersOpen ? 'true' : 'false',
                  'aria-controls': 'a360-filter-panel',
                  title: t('filters'),
                  onClick: () => setAgentsFiltersOpen((value) => !value),
                },
                  h(FilterIcon, { size: 14 }),
                  h('span', { className: 'd360-filterBtnLabel' }, t('filters')),
                  agentsActiveFilters > 0
                    ? h('span', { className: 'd360-filterCount', 'aria-label': String(agentsActiveFilters) }, String(agentsActiveFilters))
                    : null),
                agentsActiveFilters > 0
                  ? h('button', { type: 'button', className: 'd360-clearFilters', onClick: agentsClearFilters }, t('clearFilters'))
                  : null),
              h('div', {
                className: 'd360-filterPanel',
                id: 'a360-filter-panel',
                hidden: !agentsFiltersOpen,
                role: 'group',
                'aria-label': t('filters'),
              },
                h('div', { className: 'd360-filterPanelHead' },
                  h('span', { className: 'd360-filterPanelTitle' }, t('filters')),
                  h('button', {
                    type: 'button',
                    className: 'd360-filterClose',
                    onClick: () => setAgentsFiltersOpen(false),
                  }, t('closeFilters'))),
                h(AxisFilter, {
                  axis: 'role', title: t('axisRole'), values: agentsRoleOptions,
                  current: agentsRoleFilter, onSelect: setAgentsRoleFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'kind', title: t('axisKind'), values: agentsKindOptions,
                  current: agentsKindFilter, onSelect: setAgentsKindFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'scope', title: t('axisScope'), values: agentsScopeOptions,
                  current: agentsScopeFilter, onSelect: setAgentsScopeFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'grade', title: t('axisGrade'), values: gradeOptionsFor(agentsCounts.grade),
                  current: agentsGradeFilter, onSelect: setAgentsGradeFilter, t,
                }),
                h(AxisFilter, {
                  axis: 'verdict', title: t('filterVerdict'), values: verdictOptionsFor(true),
                  current: agentsVerdictFilter, onSelect: setAgentsVerdictFilter, t,
                }),
                h('label', { className: 'a360-problemsToggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: agentsOnlyProblems,
                    onChange: (event) => setAgentsOnlyProblems(event.target.checked),
                  }),
                  h('span', null, t('agentsOnlyProblems'))),
                h('label', { className: 'a360-problemsToggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: agentsOnlyEvolution,
                    onChange: (event) => setAgentsOnlyEvolution(event.target.checked),
                  }),
                  h('span', null, t('onlyEvolution')))),
              h('div', { className: 'a360-listMeta' }, t('agentsCount', { count: agentsVisible.length }))),
            h('div', { className: 'a360-list' },
              agentsVisible.length === 0
                ? h(EmptyState, { prefix: 'a360-', icon: h(SearchIcon, { size: 22 }), title: t('agentsNoMatch'), hint: t('agentsNoMatchHint') })
                : agentsVisible.map((subject) => h(SubjectRow, {
                  key: subject.id,
                  subject,
                  taxonomy: agentsTax,
                  t,
                  selected: agentsSelected,
                  onSelect: agentsJumpTo,
                }))));

          const currentDetail = agentsDetail && agentsDetail.id === agentsSelected ? agentsDetail : null;
          let detailPane;
          if (!agentsSelected) {
            detailPane = h('section', { className: 'a360-detail' },
              h(EmptyState, { prefix: 'a360-', icon: h(ChartIcon, { size: 26 }), title: t('agentsNoSelection'), hint: t('agentsNoSelectionHint') }));
          } else if (agentsDetailLoading && !currentDetail) {
            detailPane = h('section', { className: 'a360-detail' },
              h('div', { className: 'a360-center' }, h(Spinner, { prefix: 'a360-' }), h('span', null, t('loading'))));
          } else if (agentsDetailError && !currentDetail) {
            detailPane = h('section', { className: 'a360-detail' },
              h('div', { className: 'a360-center' },
                h('div', { className: 'a360-errorText' }, t('detailLoadFailed', { message: agentsDetailError })),
                h('button', { type: 'button', className: 'a360-btn a360-btnPrimary', onClick: agentsRetryDetail }, t('retry'))));
          } else if (currentDetail) {
            detailPane = h('section', { className: 'a360-detail' },
              h(AgentsDetailView, {
                detail: currentDetail,
                conflicts: agentsConflictsFor(agentsPortfolio, currentDetail.id),
                taxonomy: agentsTax,
                t,
                busy: agentsBusy,
                onApply: agentsApplyOrEvolve,
                onApplyAll: agentsApplyAll,
                onJump: agentsJumpTo,
                onFilterRole: agentsFilterByRole,
                evolveEditor: agentsEvolveEditor,
                onEvolveEdit: agentsOpenEvolveEditor,
                onEvolveChange: agentsChangeEvolveField,
                onEvolveSubmit: agentsSubmitEvolve,
                onEvolveCancel: agentsCloseEvolveEditor,
              }));
          } else {
            detailPane = h('section', { className: 'a360-detail' },
              h('div', { className: 'a360-center' }, h(Spinner, { prefix: 'a360-' }), h('span', null, t('loading'))));
          }

          body = h('div', { className: 'a360-content' },
            h(StaleBanner, { portfolio: agentsPortfolio, t, error: agentsLoadError }),
            effectNow
              ? h(EffectCard, {
                effect: effectNow, t, busy: agentsBusy,
                onUndo: effectBackupIdsOf(effectNow).length
                  ? () => agentsUndoLast(effectBackupIdsOf(effectNow))
                  : undefined,
              })
              : (effectLast ? h(EffectCard, {
                effect: effectLast, isLast: true, t, busy: agentsBusy,
                onUndo: effectBackupIdsOf(effectLast).length
                  ? () => agentsUndoLast(effectBackupIdsOf(effectLast))
                  : undefined,
              }) : null),
            agentsLoadError && !stale
              ? h('div', { className: 'a360-banner', 'data-kind': 'error' }, t('loadFailed', { message: agentsLoadError }))
              : null,
            h(SummaryLine, { kind: 'agents', items: agentsSubjects, portfolio: agentsPortfolio, t }),
            statsBar,
            h('div', { className: 'a360-body' }, listPane, detailPane));
        }

        return h('div', { className: 'd360-tabBody' }, toolbar, body, h(Notice, { prefix: 'a360-', notice: agentsNotice }));
      }

      const skillsCount = skillsItems.length;
      const agentsCount = agentsSubjects.length;

      const header = h('div', { className: 'd360-header' },
        h('div', { className: 'd360-heading' },
          h('h1', { className: 'd360-title' }, t('title')),
          h('p', { className: 'd360-subtitle' }, t('subtitle'))));

      const tabbar = h('div', { className: 'd360-tabbar', role: 'tablist' },
        h('button', {
          type: 'button',
          role: 'tab',
          className: 'd360-tab' + (tab === 'skills' ? ' d360-tabActive' : ''),
          'data-tab': 'skills',
          'data-active': tab === 'skills' ? 'true' : 'false',
          'aria-selected': tab === 'skills' ? 'true' : 'false',
          onClick: () => {
            setTab('skills');
            setSkillsRequested(true);
          },
        }, t('tabSkills'), h('span', { className: 'd360-tabBadge' }, skillsPortfolio ? String(skillsCount) : '—')),
        h('button', {
          type: 'button',
          role: 'tab',
          className: 'd360-tab' + (tab === 'agents' ? ' d360-tabActive' : ''),
          'data-tab': 'agents',
          'data-active': tab === 'agents' ? 'true' : 'false',
          'aria-selected': tab === 'agents' ? 'true' : 'false',
          onClick: () => {
            setTab('agents');
            setAgentsRequested(true);
          },
        }, t('tabAgents'), h('span', { className: 'd360-tabBadge' }, agentsPortfolio ? String(agentsCount) : '—')));

      const activeTab = tab === 'skills' ? renderSkillsTab() : renderAgentsTab();

      return h('div', { className: 'd360-page' }, header, tabbar, activeTab);
    }

    // ------------------------------------------------------------------ styles

    const CSS = [
      '/* ---- dsh-360 panel: type scale 11/12/13, 4px spacing grid, 32/36px targets ---- */',
      '.d360-page{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;height:100%;min-height:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}',
      '.d360-page *,.d360-page *::before,.d360-page *::after{box-sizing:border-box}',
      '.d360-page :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-label-primary);outline-offset:2px}',
      '.d360-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}',
      '.d360-heading{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.d360-title{margin:0;font-size:20px;line-height:1.3;font-weight:650;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.d360-subtitle{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.d360-tabbar{display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.d360-tab{position:relative;display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border:0;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s ease,color .15s ease}',
      '.d360-tab:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.d360-tabActive{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.d360-tabActive::after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary)}',
      '.d360-tabBadge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.d360-tabActive .d360-tabBadge{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.d360-tabBody{display:flex;flex-direction:column;gap:16px;flex:1;min-height:0}',
      '.s360-content,.a360-content{display:flex;flex-direction:column;gap:16px;flex:1;min-height:0}',
      '.d360-staleBanner,.s360-banner,.a360-banner{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.d360-effect{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.d360-effectBody{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}',
      '.d360-effectLine{font-size:13px;line-height:1.5;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.d360-effectMeta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.d360-effectUndo{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer}',
      '.d360-effectUndo:hover{background:var(--dsw-alias-button-floating-hover)}',
      '.d360-summary{display:flex;flex-direction:column;gap:4px}',
      '.d360-summaryLine{margin:0;font-size:13px;line-height:1.55;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.d360-summaryMeta{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-header,.a360-header{display:flex;align-items:center;justify-content:space-between;gap:16px}',
      '.s360-subtitle,.a360-subtitle{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-headerActions,.a360-headerActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:none}',
      '.s360-btn,.a360-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease}',
      '.s360-btn:hover,.a360-btn:hover{background:var(--dsw-alias-button-floating-hover)}',
      '.s360-btn:active,.a360-btn:active{background:var(--dsw-alias-button-ghost-active-fill)}',
      '.s360-btn[disabled],.a360-btn[disabled]{opacity:.45;cursor:not-allowed}',
      '.s360-btnPrimary,.a360-btnPrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}',
      '.s360-btnPrimary:hover,.a360-btnPrimary:hover{background:var(--dsw-alias-button-primary-hover)}',
      '.s360-btnGhost,.a360-btnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.s360-btnGhost:hover,.a360-btnGhost:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.s360-btnSm,.a360-btnSm{min-height:32px;padding:0 12px;font-size:12px}',
      '.s360-stats,.a360-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '.s360-stat,.a360-stat{display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0;min-height:64px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.s360-statLabel,.a360-statLabel{font-size:11px;line-height:1.4;font-weight:500;color:var(--dsw-alias-label-secondary)}',
      '.s360-statValue,.a360-statValue{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 4px;min-width:0;font-size:20px;line-height:1.25;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.s360-statUnit,.a360-statUnit{font-size:12px;font-weight:500;letter-spacing:0;color:var(--dsw-alias-label-secondary)}',
      '.d360-gradeTokens{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;font-size:13px;line-height:1.2;font-weight:500;letter-spacing:0}',
      '.d360-gradeTok{display:inline-flex;align-items:baseline;gap:3px;white-space:nowrap}',
      '.d360-gradeTokLetter{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.d360-gradeTokCount{font-size:18px;font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '@media (max-width:1260px){.d360-gradeTokens{gap:4px 8px}.d360-gradeTokCount{font-size:16px}}',
      '.s360-body,.a360-body{display:grid;grid-template-columns:minmax(300px,360px) minmax(0,1fr);gap:16px;flex:1;min-height:0}',
      '.s360-listPane,.a360-listPane{display:flex;flex-direction:column;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.s360-detail,.a360-detail{min-height:0;overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.s360-listHead,.a360-listHead{display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.d360-filterBar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}',
      '.s360-searchWrap,.a360-searchWrap{display:flex;align-items:center;gap:6px;flex:1;min-width:150px;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.s360-searchWrap:focus-within,.a360-searchWrap:focus-within{border-color:var(--dsw-alias-label-tertiary);box-shadow:0 0 0 2px var(--dsw-alias-border-l2)}',
      '.s360-input.s360-search,.a360-input.a360-search{flex:1;min-width:0;height:32px;padding:0;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.s360-search::placeholder,.a360-search::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.d360-filterBtn{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer}',
      '.d360-filterBtn:hover{background:var(--dsw-alias-button-floating-hover)}',
      '.d360-filterBtn[aria-expanded="true"]{background:var(--dsw-alias-button-ghost-active-fill);border-color:var(--dsw-alias-border-l3)}',
      '.d360-filterBtnLabel{font-size:12px}',
      '.d360-filterCount{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.d360-filterPanel{display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.d360-filterPanel[hidden]{display:none}',
      '.d360-filterPanelHead{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.d360-filterPanelTitle{margin:0;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.d360-filterClose{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.d360-filterClose:hover{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.d360-axis{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.d360-axisLabel{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.d360-axisChips{display:flex;flex-wrap:wrap;gap:6px}',
      '.d360-chipBtn{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
      '.d360-chipBtn:hover{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary)}',
      '.d360-chipBtn[aria-pressed="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.d360-chipCount{font-size:11px;font-variant-numeric:tabular-nums;opacity:.8}',
      '.d360-clearFilters{display:inline-flex;align-items:center;min-height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
      '.d360-clearFilters:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay)}',
      '.s360-problemsToggle,.a360-problemsToggle{display:inline-flex;align-items:center;gap:8px;min-height:32px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.s360-problemsToggle input,.a360-problemsToggle input{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary)}',
      '.s360-listMeta,.a360-listMeta{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-list,.a360-list{display:flex;flex-direction:column;gap:4px;min-height:0;overflow-y:auto;padding:8px}',
      '.s360-row,.a360-row{display:flex;flex:none;align-items:flex-start;gap:12px;width:100%;min-height:56px;padding:12px;border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease}',
      '.s360-row:hover,.a360-row:hover{background:var(--dsw-alias-bg-overlay)}',
      '.s360-row[data-selected="true"],.a360-row[data-selected="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      '.s360-grade,.a360-grade{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 4px;border:1px solid var(--dsw-alias-border-l2);border-left-width:3px;border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}',
      '.s360-detailTitleLine .s360-grade,.a360-detailTitleLine .a360-grade{min-width:26px;height:26px;font-size:11px}',
      '.s360-gradeS{border-left-color:#b8860b}',
      '.s360-gradeA{border-left-color:var(--dsw-alias-state-success-primary)}',
      '.s360-gradeB{border-left-color:var(--dsw-alias-state-business-primary)}',
      '.s360-gradeC{border-left-color:var(--dsw-alias-state-warn-primary)}',
      '.s360-gradeD{border-left-color:#e8590c}',
      '.s360-gradeE{border-left-color:var(--dsw-alias-state-error-primary)}',
      '.a360-gradeS{border-left-color:#b8860b}',
      '.a360-gradeA{border-left-color:var(--dsw-alias-state-success-primary)}',
      '.a360-gradeB{border-left-color:var(--dsw-alias-state-business-primary)}',
      '.a360-gradeC{border-left-color:var(--dsw-alias-state-warn-primary)}',
      '.a360-gradeD{border-left-color:#e8590c}',
      '.a360-gradeE{border-left-color:var(--dsw-alias-state-error-primary)}',
      '.s360-rowMain,.a360-rowMain{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}',
      '.s360-rowTitleLine,.a360-rowTitleLine{display:flex;align-items:baseline;gap:8px;min-width:0}',
      '.s360-rowName,.a360-rowName{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-rowScore,.a360-rowScore{flex:none;font-size:13px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.d360-delta{font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.s360-rowDesc,.a360-rowDesc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.s360-rowMeta,.a360-rowMeta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;margin-top:2px}',
      '.d360-pills{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}',
      '.d360-chipLabel{font-size:12px}',
      '.d360-rowDelta{letter-spacing:0}',
      '.s360-overlapName,.a360-overlapName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.d360-pill{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;white-space:nowrap}',
      '.s360-chip,.a360-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:1;white-space:nowrap}',
      '.s360-chip-keep,.a360-chip-keep{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.s360-chip-watch,.a360-chip-watch{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.s360-chip-merge,.a360-chip-merge{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.s360-chip-archive,.a360-chip-archive{border-style:dashed;color:var(--dsw-alias-label-secondary)}',
      '.s360-chip-trim,.a360-chip-trim{border-style:dashed;color:var(--dsw-alias-label-secondary)}',
      '.s360-chip-evolve,.a360-chip-evolve{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.s360-chip-na,.a360-chip-na{border-style:dashed;color:var(--dsw-alias-label-tertiary)}',
      '.s360-rowFoot,.a360-rowFoot{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px;min-width:0;margin-top:2px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-rowFoot>*,.a360-rowFoot>*{display:inline-flex;align-items:center;gap:4px;min-width:0}',
      '.s360-rowFoot>*+*::before,.a360-rowFoot>*+*::before{content:"·";margin-right:2px;color:var(--dsw-alias-label-tertiary)}',
      '.s360-metaText,.a360-metaText{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.s360-flag,.a360-flag{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.s360-flag::before,.a360-flag::before{content:"";width:6px;height:6px;border-radius:2px;background:var(--dsw-alias-label-primary)}',
      '.d360-states{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 10px}',
      '.d360-state{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.d360-stateDot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}',
      '.d360-stateLabel{overflow-wrap:anywhere}',
      '.s360-sevText,.a360-sevText{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.s360-sevText[data-sev="critical"] .d360-sevGlyph,.a360-sevText[data-sev="critical"] .d360-sevGlyph{color:var(--dsw-alias-state-error-primary)}',
      '.s360-sevText[data-sev="major"] .d360-sevGlyph,.a360-sevText[data-sev="major"] .d360-sevGlyph{color:var(--dsw-alias-state-warn-label)}',
      '.s360-sevText[data-sev="minor"] .d360-sevGlyph,.a360-sevText[data-sev="minor"] .d360-sevGlyph{color:var(--dsw-alias-state-business-primary)}',
      '.s360-sevText[data-sev="info"] .d360-sevGlyph,.a360-sevText[data-sev="info"] .d360-sevGlyph{color:var(--dsw-alias-label-tertiary)}',
      '.d360-sevGlyph{flex:none;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary)}',
      '.a360-injText{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.a360-injText[data-ok="true"] .d360-sevGlyph{color:var(--dsw-alias-state-success-primary)}',
      '.a360-injText[data-ok="false"] .d360-sevGlyph{color:var(--dsw-alias-label-tertiary)}',
      '.s360-detailBody,.a360-detailBody{display:flex;flex-direction:column}',
      '.s360-detailHead,.a360-detailHead{display:flex;flex-direction:column;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.s360-detailTop,.a360-detailTop{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}',
      '.s360-detailTop>.s360-detailTitleLine,.a360-detailTop>.a360-detailTitleLine{flex:1 1 220px;min-width:0}',
      '.s360-detailTitleLine,.a360-detailTitleLine{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}',
      '.s360-detailName,.a360-detailName{margin:0;font-size:20px;line-height:1.3;font-weight:650;letter-spacing:-.01em;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.s360-detailDesc,.a360-detailDesc{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.s360-detailScoreRow,.a360-detailScoreRow{display:flex;align-items:flex-end;flex-wrap:wrap;gap:8px 16px}',
      '.s360-bigScore,.a360-bigScore{display:flex;align-items:baseline;gap:8px}',
      '.s360-bigScoreNum,.a360-bigScoreNum{font-size:32px;line-height:1;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.s360-bigScoreLabel,.a360-bigScoreLabel{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.s360-scoreMeta,.a360-scoreMeta{display:flex;flex-wrap:wrap;gap:4px 16px;padding-bottom:3px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-scoreMetaItem,.a360-scoreMetaItem{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}',
      '.s360-verdictReason,.a360-verdictReason{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary)}',
      '.s360-detailActions,.a360-detailActions{display:flex;flex:none;flex-wrap:wrap;gap:8px;margin:0 0 0 auto}',
      '.s360-path,.a360-path{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-coverage,.a360-coverage{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-section,.a360-section{display:flex;flex-direction:column;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.s360-section:last-child,.a360-section:last-child{border-bottom:0}',
      '.s360-sectionTitle,.a360-sectionTitle{margin:0;font-size:13px;line-height:1.4;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary)}',
      '.s360-subLabel,.a360-subLabel{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.d360-classCard{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.d360-classGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '.d360-classItem{display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}',
      '.d360-classItem[data-axis="state"]{grid-column:1 / -1;flex-direction:row;align-items:center;flex-wrap:wrap;gap:4px 12px}',
      '.d360-classLabel{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.d360-classValue{font-size:13px;line-height:1.4;font-weight:500;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.d360-classMeta{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.d360-classStates{display:flex;flex-wrap:wrap;gap:4px 10px}',
      '.d360-classSummary{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.d360-classEmpty{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.d360-linkBtn{display:inline-flex;align-items:center;align-self:flex-start;min-height:32px;margin-left:-10px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
      '.d360-linkBtn:hover{background:var(--dsw-alias-bg-overlay)}',
      '.s360-dim,.a360-dim{display:block;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.s360-dimSummary,.a360-dimSummary{display:flex;flex-direction:column;gap:8px;padding:12px 16px;list-style:none;cursor:pointer}',
      '.s360-dimSummary::-webkit-details-marker,.a360-dimSummary::-webkit-details-marker{display:none}',
      '.s360-dimSummary:hover,.a360-dimSummary:hover{background:var(--dsw-alias-bg-overlay);border-radius:10px}',
      '.s360-dimTop,.a360-dimTop{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.s360-dimLabel,.a360-dimLabel{font-size:13px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-dimBarRow,.a360-dimBarRow{display:flex;align-items:center;gap:12px}',
      '.s360-bar,.a360-bar{flex:1;min-width:80px;height:8px;border-radius:999px;background:var(--dsw-alias-bg-overlay);overflow:hidden}',
      '.s360-barFill,.a360-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .2s ease}',
      '.s360-dim[data-applicable="false"] .s360-barFill,.a360-dim[data-applicable="false"] .a360-barFill{background:var(--dsw-alias-border-l3)}',
      '.s360-dimScore,.a360-dimScore{flex:none;min-width:68px;text-align:right;font-size:12px;line-height:1.4;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.s360-dimSummaryText,.a360-dimSummaryText{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-dimItems,.a360-dimItems{display:flex;flex-direction:column;gap:12px;margin:0;padding:12px 16px 16px;border-top:1px dashed var(--dsw-alias-border-l2);list-style:none}',
      '.s360-dimItem,.a360-dimItem{display:flex;flex-direction:column;gap:4px}',
      '.s360-dimItemTop,.a360-dimItemTop{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
      '.s360-dimItemLabel,.a360-dimItemLabel{font-size:12px;line-height:1.5;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-dimItemScore,.a360-dimItemScore{font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.s360-dimItemDetail,.a360-dimItemDetail{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-metrics,.a360-metrics{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}',
      '.s360-metric,.a360-metric{display:flex;flex-direction:column;gap:2px;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}',
      '.s360-metricLabel,.a360-metricLabel{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.s360-metricValue,.a360-metricValue{font-size:13px;line-height:1.4;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.s360-findings,.s360-suggestions,.s360-overlaps,.a360-findings,.a360-suggestions,.a360-overlaps,.a360-conflicts{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
      '.s360-finding,.s360-sug,.a360-finding,.a360-sug{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.s360-finding[data-sev="critical"],.a360-finding[data-sev="critical"]{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.s360-finding[data-sev="major"],.a360-finding[data-sev="major"]{border-left:3px solid var(--dsw-alias-state-warn-label)}',
      '.s360-finding[data-sev="minor"],.a360-finding[data-sev="minor"]{border-left:3px solid var(--dsw-alias-state-business-primary)}',
      '.s360-finding[data-sev="info"],.a360-finding[data-sev="info"]{border-left:3px solid var(--dsw-alias-border-l3)}',
      '.s360-findingHead,.a360-findingHead{display:flex;align-items:center;flex-wrap:wrap;gap:8px}',
      '.s360-findingTitle,.a360-findingTitle{font-size:13px;line-height:1.5;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-findingEvidence,.a360-findingEvidence{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-findingSug,.a360-findingSug{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-findingActions,.a360-findingActions{display:flex;flex-wrap:wrap;gap:8px}',
      '.s360-findingDetail,.a360-findingDetail{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-code,.a360-code{display:inline-block;max-width:100%;padding:2px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.s360-sev,.a360-sev{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border:1px solid color-mix(in srgb, var(--sev, var(--dsw-alias-label-secondary)) 34%, transparent);border-radius:5px;background:color-mix(in srgb, var(--sev, var(--dsw-alias-label-secondary)) 14%, transparent);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600;line-height:1;white-space:nowrap}',
      '.s360-sev::before,.a360-sev::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--sev, var(--dsw-alias-label-secondary))}',
      '.s360-sev-critical,.a360-sev-critical{--sev:var(--dsw-alias-state-error-primary)}',
      '.s360-sev-major,.a360-sev-major{--sev:var(--dsw-alias-state-warn-label)}',
      '.s360-sev-minor,.a360-sev-minor{--sev:var(--dsw-alias-state-business-primary)}',
      '.s360-sev-info,.a360-sev-info{--sev:var(--dsw-alias-label-tertiary)}',
      '.s360-sugHead,.a360-sugHead{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}',
      '.s360-sugTitle,.a360-sugTitle{font-size:13px;line-height:1.5;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-sugText,.a360-sugText{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.s360-sugActions,.a360-sugActions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}',
      '.s360-draftNote,.a360-draftNote,.a360-manualNote{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-preview,.a360-preview{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}',
      '.s360-previewTitle,.a360-previewTitle{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.s360-previewRow,.a360-previewRow{display:flex;align-items:baseline;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-previewTag,.a360-previewTag{flex:none;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.s360-previewTagAfter,.a360-previewTagAfter{flex:none;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-previewText,.a360-previewText{font-size:12px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.s360-editor,.a360-editor{display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.s360-editorTitle,.a360-editorTitle{margin:0;font-size:13px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-editorHint,.a360-editorHint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-field,.a360-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.s360-fieldLabel,.a360-fieldLabel{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}',
      '.s360-input,.a360-input{width:100%;min-height:34px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5}',
      '.s360-input:focus-visible,.a360-input:focus-visible,.s360-textarea:focus-visible,.a360-textarea:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-label-primary);outline-offset:1px}',
      '.s360-textarea,.a360-textarea{width:100%;min-height:80px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;resize:vertical}',
      '.s360-editorActions,.a360-editorActions{display:flex;flex-wrap:wrap;gap:8px}',
      '.s360-evSignals,.a360-evSignals{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:0;padding:0;list-style:none}',
      '.s360-evSignal,.a360-evSignal{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}',
      '.s360-evSignalLabel,.a360-evSignalLabel{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.s360-evSignalValue,.a360-evSignalValue{font-size:13px;line-height:1.4;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.s360-evSamples,.a360-evSamples{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}',
      '.s360-evSample,.a360-evSample{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-left:2px solid var(--dsw-alias-border-l3);border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-base)}',
      '.s360-evSampleKind,.a360-evSampleKind{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}',
      '.s360-evSampleMeta,.a360-evSampleMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.s360-evSampleText,.a360-evSampleText{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.s360-evExcerpt,.a360-evExcerpt{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-evTrigger,.a360-evTrigger{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-evEvidence,.a360-evEvidence{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-evProposals,.a360-evProposals{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
      '.s360-evProposal,.a360-evProposal{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}',
      '.s360-evProposal>.s360-btn,.a360-evProposal>.a360-btn{align-self:flex-start}',
      '.s360-evEmpty,.a360-evEmpty{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-overlap,.a360-overlap{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}',
      '.s360-overlapBtn,.a360-overlapBtn{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;min-height:32px;margin-left:-8px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer}',
      '.s360-overlapBtn:hover,.a360-overlapBtn:hover{background:var(--dsw-alias-bg-overlay)}',
      '.s360-overlapScore,.a360-overlapScore{font-size:12px;line-height:1.4;font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.s360-overlapTriggers,.a360-overlapTriggers{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.s360-source,.a360-source{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}',
      '.s360-sourceSummary,.a360-sourceSummary{min-height:32px;padding:8px 12px;font-size:12px;line-height:1.5;font-weight:500;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.s360-sourcePre,.a360-sourcePre{margin:0;padding:0 12px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.a360-conflict{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}',
      '.a360-conflictHead{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}',
      '.a360-conflictLine,.a360-conflictRule,.a360-conflictOther{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-conflictRatio{font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.a360-injection{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}',
      '.a360-injDup{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.a360-injDupList{margin:0;padding-left:18px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.a360-backup{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-rule{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.s360-center,.a360-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;flex:1;padding:48px 24px;text-align:center}',
      '.s360-errorText,.a360-errorText{max-width:520px;font-size:13px;line-height:1.6;color:var(--dsw-alias-state-error-primary)}',
      '.s360-empty,.a360-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 16px;text-align:center}',
      '.s360-emptyIcon,.a360-emptyIcon{display:flex;color:var(--dsw-alias-label-tertiary)}',
      '.s360-emptyTitle,.a360-emptyTitle{font-size:13px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.s360-emptyHint,.a360-emptyHint{max-width:360px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.s360-muted,.a360-muted{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.s360-spinner,.a360-spinner{display:inline-block;flex:none;width:16px;height:16px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);border-radius:50%;animation:d360-spin .8s linear infinite}',
      '@keyframes d360-spin{to{transform:rotate(360deg)}}',
      '.s360-toast,.a360-toast{position:fixed;right:20px;bottom:20px;z-index:60;max-width:min(420px,calc(100vw - 40px));padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);font-size:12px;line-height:1.5;box-shadow:0 8px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent)}',
      '.s360-toast[data-kind="success"],.a360-toast[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-toast[data-kind="error"],.a360-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary)}',
      '.d360-skeleton{display:flex;flex-direction:column;gap:16px}',
      '.d360-skelStats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '.d360-skelCard{height:64px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);animation:d360-pulse 1.4s ease-in-out infinite}',
      '.d360-skelBody{display:grid;grid-template-columns:minmax(300px,360px) minmax(0,1fr);gap:16px}',
      '.d360-skelPane,.d360-skelPaneWide,.d360-shimmer{min-height:320px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1) 0%,var(--dsw-alias-bg-overlay) 50%,var(--dsw-alias-bg-layer-1) 100%);background-size:200% 100%;animation:d360-shimmer 1.6s linear infinite}',
      '.d360-skelBar{height:8px;border-radius:999px;background:var(--dsw-alias-bg-overlay);animation:d360-pulse 1.4s ease-in-out infinite}',
      '.d360-loadingText{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '@keyframes d360-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
      '@keyframes d360-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}',
      '@media (prefers-reduced-motion: reduce){.s360-spinner,.a360-spinner,.d360-skelCard,.d360-skelBar,.d360-skelPane,.d360-skelPaneWide,.d360-shimmer{animation:none}.d360-skelCard,.d360-skelBar,.d360-skelPane,.d360-skelPaneWide,.d360-shimmer{opacity:.7}.s360-barFill,.a360-barFill{transition:none}}',
      '@media (max-width: 980px){.s360-body,.a360-body,.d360-skelBody{grid-template-columns:minmax(0,1fr)}.s360-listPane,.a360-listPane{max-height:280px}.s360-stats,.a360-stats,.d360-skelStats{grid-template-columns:repeat(3,minmax(0,1fr))}}',
      '@media (max-width: 720px){.d360-page{padding:16px}.s360-stats,.a360-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.s360-header,.a360-header{flex-direction:column;align-items:stretch}.s360-headerActions,.a360-headerActions{justify-content:flex-start}.d360-classGrid{grid-template-columns:minmax(0,1fr)}}',
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
        order: 41,
        label: () => (runtime ? runtime.t('panelTitle') : '360 Checkup'),
      }, PanelIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
      }, Dsh360Page));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
