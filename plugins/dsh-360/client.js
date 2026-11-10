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
      statCatalogTokens: '每次会话固定成本',
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
      statResidentTokens: '常驻注入成本',
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
      statCatalogTokens: 'Catalog cost / session',
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
      statResidentTokens: 'Resident injection cost',
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
      return h('div', { className: p + 'stat' },
        h('div', { className: p + 'statValue' }, props.value),
        h('div', { className: p + 'statLabel' }, props.label));
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

    // ============================================================== skills (s360-)

    function skillsSevKey(severity) {
      return { critical: 'Critical', major: 'Major', minor: 'Minor', info: 'Info' }[severity] || 'Info';
    }

    function skillsTopSeverity(skill) {
      const findings = (skill && skill.findings) || [];
      if (findings.some((f) => f.severity === 'critical')) return 'critical';
      if (findings.some((f) => f.severity === 'major')) return 'major';
      if (findings.some((f) => f.severity === 'minor')) return 'minor';
      if (findings.some((f) => f.severity === 'info')) return 'info';
      return null;
    }

    function skillsHasMajorPlus(skill) {
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
      return h('button', {
        type: 'button',
        className: 's360-row',
        'data-selected': skill.name === props.selected ? 'true' : 'false',
        onClick: () => props.onSelect(skill.name),
        title: skill.name,
      },
        h('span', { className: gradeBadgeClass('s360-', skill.score) }, skill.score.grade),
        h('div', { className: 's360-rowMain' },
          h('div', { className: 's360-rowTitleLine' },
            h('span', { className: 's360-rowName' }, skill.name),
            h('span', { className: 's360-rowScore' }, fmt1(skill.score.total))),
          h('div', { className: 's360-rowDesc' }, clip(skill.description || '', 84)),
          h('div', { className: 's360-rowMeta' },
            skill.source ? h(Chip, { prefix: 's360-', title: skill.source }, skill.source) : null,
            verdictLabel ? h(Chip, { prefix: 's360-', tone: skill.verdict.code }, t(verdictLabel)) : null,
            skillsEvolutionPending(skill)
              ? h(Chip, { prefix: 's360-', tone: 'evolve', title: t('evolutionTitle') }, t('evolvePendingBadge'))
              : null,
            h('span', { className: 's360-metaText' }, t('skillsUsageLine', { count: usage.count ?? 0, perWeek: perWeek == null ? '—' : perWeek })),
            sev ? h(Chip, { prefix: 's360-', tone: 'sev-' + sev }, t('sev' + skillsSevKey(sev))) : null)));
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
            h('span', { className: 's360-dimLabel' },
              dim.label,
              notScored ? h(Chip, { prefix: 's360-', tone: 'na' }, t('skillsNotScored')) : null),
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
          t('evolutionTitle'),
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
          h('div', { className: 's360-detailTitleLine' },
            h('h2', { className: 's360-detailName' }, detail.name),
            h('span', { className: gradeBadgeClass('s360-', score) }, score.grade),
            verdictLabel ? h(Chip, { prefix: 's360-', tone: verdict.code }, t(verdictLabel)) : null),
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
      const findings = (subject && subject.findings) || [];
      if (findings.some((f) => f.severity === 'critical')) return 'critical';
      if (findings.some((f) => f.severity === 'major')) return 'major';
      if (findings.some((f) => f.severity === 'minor')) return 'minor';
      if (findings.some((f) => f.severity === 'info')) return 'info';
      return null;
    }

    function agentsHasMajorPlus(subject) {
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
      const kindKey = AGENTS_KIND_KEY[subject.kind] || null;
      const scopeKey = AGENTS_SCOPE_KEY[subject.scope] || null;
      const verdictCode = agentsVerdictCodeOf(subject);
      const verdictKey = agentsVerdictKeyOf(verdictCode);
      const inj = (subject && subject.injection) || {};
      const injected = numberOr(inj.sessionsInjected, 0);
      const pending = agentsEvolutionPending(subject);
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
            kindKey ? h(Chip, { prefix: 'a360-', tone: 'kind-' + subject.kind }, t(kindKey)) : null,
            h('span', { className: 'a360-rowScore' }, fmt1(agentsTotalOf(subject)))),
          h('div', { className: 'a360-rowDesc' }, clip(subject.title || subject.description || subject.path || '', 84)),
          h('div', { className: 'a360-rowMeta' },
            scopeKey ? h(Chip, { prefix: 'a360-', tone: 'scope' }, t(scopeKey)) : null,
            h(Chip, { prefix: 'a360-', tone: injected > 0 ? 'inj-ok' : 'inj-missing' }, injectionText(subject, t)),
            pending ? h(Chip, { prefix: 'a360-', tone: 'evolve', title: t('evolutionTitle') }, t('evolvePendingBadge')) : null,
            verdictKey ? h(Chip, { prefix: 'a360-', tone: verdictCode }, t(verdictKey)) : null,
            sev ? h(Chip, { prefix: 'a360-', tone: 'sev-' + sev }, t(agentsSevKey(sev))) : null)));
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
            h('span', { className: 'a360-dimLabel' },
              label,
              notScored ? h(Chip, { prefix: 'a360-', tone: 'na' }, t('agentsNotScored')) : null),
            h('span', { className: 'a360-dimScore' },
              notScored ? '—' : fmt1(dim.score) + ' / ' + fmt1(dim.max))),
          h('div', { className: 'a360-bar' },
            h('div', { className: 'a360-barFill', style: { width: pct + '%' } })),
          dim.summary ? h('div', { className: 'a360-dimSummaryText' }, dim.summary) : null),
        items.length
          ? h('ul', { className: 'a360-dimItems' },
            items.map((item) => h('li', { className: 'a360-dimItem', key: item.id },
              h('div', { className: 'a360-dimItemTop' },
                h('span', { className: 'a360-dimItemLabel' }, item.label),
                h('span', { className: 'a360-dimItemScore' },
                  notScored || item.applicable === false
                    ? '—'
                    : fmt1(item.score) + ' / ' + fmt1(item.max))),
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
          t('evolutionTitle'),
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
          h('div', { className: 'a360-detailTitleLine' },
            h('h2', { className: 'a360-detailName' }, detail.name),
            kindKey ? h(Chip, { prefix: 'a360-', tone: 'kind-' + detail.kind }, t(kindKey)) : null,
            scopeKey ? h(Chip, { prefix: 'a360-', tone: 'scope' }, t(scopeKey)) : null,
            h('span', { className: gradeBadgeClass('a360-', score) }, score.grade || '—'),
            verdictKey ? h(Chip, { prefix: 'a360-', tone: verdict.code }, t(verdictKey)) : null),
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
          h('div', { className: 'a360-detailActions' },
            h('button', {
              type: 'button',
              className: 'a360-btn a360-btnPrimary',
              disabled: props.busy,
              onClick: () => props.onApplyAll(detail.id),
            }, t('applyAllSubject'))),
          detail.path ? h('div', { className: 'a360-path' }, labeled(t, 'pathLabel', detail.path)) : null,
          detail.owner ? h('div', { className: 'a360-coverage' }, labeled(t, 'ownerLabel', detail.owner)) : null,
          detail.coverage
            ? h('div', { className: 'a360-coverage' },
              labeled(t, 'coverageLabel',
                detail.coverage === 'full' ? t('coverageFull') : t('coveragePartial')))
            : null),

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
      // 1..18 skills surface (18 states)
      // 19..38 agents surface (20 states)
      const [tab, setTab] = React.useState('skills');

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
      const [skillsGradeFilter, setSkillsGradeFilter] = React.useState('all');
      const [skillsVerdictFilter, setSkillsVerdictFilter] = React.useState('all');
      const [skillsSourceFilter, setSkillsSourceFilter] = React.useState('all');
      const [skillsOnlyProblems, setSkillsOnlyProblems] = React.useState(false);
      const [skillsNotice, setSkillsNotice] = React.useState(null);
      const [skillsBusy, setSkillsBusy] = React.useState(false);
      const [skillsLastBackupIds, setSkillsLastBackupIds] = React.useState([]);
      const [skillsEvolveEditor, setSkillsEvolveEditor] = React.useState(null);

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
      const [agentsKindFilter, setAgentsKindFilter] = React.useState('all');
      const [agentsGradeFilter, setAgentsGradeFilter] = React.useState('all');
      const [agentsVerdictFilter, setAgentsVerdictFilter] = React.useState('all');
      const [agentsScopeFilter, setAgentsScopeFilter] = React.useState('all');
      const [agentsOnlyProblems, setAgentsOnlyProblems] = React.useState(false);
      const [agentsOnlyEvolution, setAgentsOnlyEvolution] = React.useState(false);
      const [agentsNotice, setAgentsNotice] = React.useState(null);
      const [agentsBusy, setAgentsBusy] = React.useState(false);
      const [agentsLastBackupIds, setAgentsLastBackupIds] = React.useState([]);
      const [agentsEvolveEditor, setAgentsEvolveEditor] = React.useState(null);

      const skillsForceRefresh = React.useRef(false);
      const agentsForceRefresh = React.useRef(false);
      const skillsUndoIds = Array.isArray(skillsLastBackupIds)
        ? skillsLastBackupIds
        : (skillsLastBackupIds ? [skillsLastBackupIds] : []);
      const agentsUndoIds = Array.isArray(agentsLastBackupIds)
        ? agentsLastBackupIds
        : (agentsLastBackupIds ? [agentsLastBackupIds] : []);

      // ---- skills scan effect
      React.useEffect(() => {
        let alive = true;
        setSkillsLoading(true);
        setSkillsLoadError('');
        const suffix = skillsForceRefresh.current ? '?refresh=1' : '';
        skillsForceRefresh.current = false;
        (async () => {
          try {
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
      }, [skillsRefreshKey]);

      // ---- skills detail effect
      React.useEffect(() => {
        if (!skillsSelected) {
          setSkillsDetail(null);
          setSkillsDetailError('');
          return undefined;
        }
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
      }, [skillsSelected, skillsDetailVersion]);

      // ---- agents scan effect
      React.useEffect(() => {
        let alive = true;
        setAgentsLoading(true);
        setAgentsLoadError('');
        const suffix = agentsForceRefresh.current ? '?refresh=1' : '';
        agentsForceRefresh.current = false;
        (async () => {
          try {
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
      }, [agentsRefreshKey]);

      // ---- agents detail effect
      React.useEffect(() => {
        if (!agentsSelected) {
          setAgentsDetail(null);
          setAgentsDetailError('');
          return undefined;
        }
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
      }, [agentsSelected, agentsDetailVersion]);

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
      const skillsVisible = React.useMemo(() => {
        const skills = (skillsPortfolio && skillsPortfolio.skills) || [];
        const needle = skillsQuery.trim().toLowerCase();
        return skills.filter((s) => {
          if (skillsGradeFilter !== 'all' && gradeLetterOf(s.score) !== skillsGradeFilter) return false;
          if (skillsVerdictFilter !== 'all' && s.verdict.code !== skillsVerdictFilter) return false;
          if (skillsSourceFilter !== 'all' && s.source !== skillsSourceFilter) return false;
          if (skillsOnlyProblems && !skillsHasMajorPlus(s)) return false;
          if (needle) {
            const hay = [s.name, s.description].join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          return true;
        });
      }, [skillsPortfolio, skillsQuery, skillsGradeFilter, skillsVerdictFilter, skillsSourceFilter, skillsOnlyProblems]);

      const skillsSources = React.useMemo(() => {
        const skills = (skillsPortfolio && skillsPortfolio.skills) || [];
        const seen = new Set();
        skills.forEach((s) => { if (s.source) seen.add(s.source); });
        return Array.from(seen).sort();
      }, [skillsPortfolio]);

      // ---- agents memos
      const agentsSubjects = React.useMemo(
        () => (agentsPortfolio && Array.isArray(agentsPortfolio.subjects) ? agentsPortfolio.subjects : []),
        [agentsPortfolio],
      );

      const agentsVisible = React.useMemo(() => {
        const needle = agentsQuery.trim().toLowerCase();
        return agentsSubjects.filter((s) => {
          if (agentsKindFilter !== 'all' && s.kind !== agentsKindFilter) return false;
          if (agentsGradeFilter !== 'all' && gradeLetterOf(s.score) !== agentsGradeFilter) return false;
          if (agentsVerdictFilter !== 'all' && agentsVerdictCodeOf(s) !== agentsVerdictFilter) return false;
          if (agentsScopeFilter !== 'all' && s.scope !== agentsScopeFilter) return false;
          if (agentsOnlyProblems && !agentsHasMajorPlus(s)) return false;
          if (agentsOnlyEvolution && !agentsEvolutionPending(s)) return false;
          if (needle) {
            const hay = [s.id, s.name, s.path, s.title, s.description]
              .filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          return true;
        });
      }, [agentsSubjects, agentsQuery, agentsKindFilter, agentsGradeFilter, agentsVerdictFilter, agentsScopeFilter, agentsOnlyProblems, agentsOnlyEvolution]);

      const agentsScopes = React.useMemo(() => {
        const seen = new Set();
        agentsSubjects.forEach((s) => { if (s.scope) seen.add(s.scope); });
        return Array.from(seen).sort();
      }, [agentsSubjects]);

      const agentsKinds = React.useMemo(() => {
        const seen = new Set();
        agentsSubjects.forEach((s) => { if (s.kind) seen.add(s.kind); });
        return ['instruction', 'agent', 'preset'].filter((kind) => seen.has(kind));
      }, [agentsSubjects]);

      // ---- skills handlers
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
          setSkillsLastBackupIds(backupId ? [backupId] : []);
          setSkillsNotice({
            kind: 'success',
            text: t('applyDone', {
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
          setSkillsLastBackupIds(backupId ? [backupId] : []);
          setSkillsNotice({
            kind: 'success',
            text: appliedCount
              ? t('applyAllDone', { count: appliedCount, backupId: backupId || '—' })
              : t('applyAllNone'),
          });
          await skillsRefreshAfterWrite();
        } catch (error) {
          setSkillsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setSkillsBusy(false);
        }
      }

      async function skillsUndoLast() {
        const confirmed = window.confirm(t('skillsConfirmUndo'));
        if (!confirmed) return;
        setSkillsBusy(true);
        try {
          const res = await api(SKILLS_API, '/undo', {
            method: 'POST',
            body: skillsUndoIds.length > 0 ? { backupIds: skillsUndoIds } : {},
          });
          const doneIds = res && Array.isArray(res.backups) ? res.backups.map((item) => item.backupId) : [];
          const backupId = doneIds.length > 0
            ? (doneIds.length === 1 ? doneIds[0] : t('undoMany', { count: doneIds.length }))
            : (skillsUndoIds[0] || '—');
          setSkillsNotice({ kind: 'success', text: t('undoDone', { backupId }) });
          setSkillsLastBackupIds([]);
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
          setAgentsLastBackupIds(backupId ? [backupId] : []);
          setAgentsNotice({
            kind: 'success',
            text: t('applyDone', {
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
          setAgentsLastBackupIds(backupId ? [backupId] : []);
          setAgentsNotice({
            kind: 'success',
            text: appliedCount
              ? t('applyAllDone', { count: appliedCount, backupId: backupId || '—' })
              : t('applyAllNone'),
          });
          await agentsRefreshAfterWrite();
        } catch (error) {
          setAgentsNotice({ kind: 'error', text: t('opFailed', { message: errMessage(error) }) });
        } finally {
          setAgentsBusy(false);
        }
      }

      async function agentsUndoLast() {
        const confirmed = window.confirm(t('agentsConfirmUndo'));
        if (!confirmed) return;
        setAgentsBusy(true);
        try {
          const res = await api(AGENTS_API, '/undo', {
            method: 'POST',
            body: agentsUndoIds.length > 0 ? { backupId: agentsUndoIds[0] } : {},
          });
          const doneIds = Array.isArray(res && res.backups)
            ? res.backups.map((item) => item.backupId)
            : [];
          const backupId = (res && res.backupId)
            || (doneIds.length > 0
              ? (doneIds.length === 1 ? doneIds[0] : t('undoMany', { count: doneIds.length }))
              : (agentsUndoIds[0] || '—'));
          setAgentsNotice({ kind: 'success', text: t('undoDone', { backupId }) });
          setAgentsLastBackupIds([]);
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

      const GRADE_LETTER_OPTIONS = [['all', t('filterAll')], ['S', 'S'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']];
      const gradeDistribution = (grades) => ['S', 'A', 'B', 'C', 'D', 'E'].map((g) => g + ' ' + (grades[g] ?? 0)).join(' · ');

      function renderSkillsTab() {
        const toolbar = h('div', { className: 's360-header' },
          h('p', { className: 's360-subtitle' }, t('skillsSubtitle')),
          h('div', { className: 's360-headerActions' },
            h('button', {
              type: 'button',
              className: 's360-btn s360-btnGhost',
              onClick: skillsRefresh,
              disabled: skillsLoading || skillsBusy,
              title: t('refresh'),
              'aria-label': t('refresh'),
            }, skillsLoading ? h(Spinner, { prefix: 's360-' }) : h(RefreshIcon, { size: 14 }), h('span', null, t('refresh'))),
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
          body = h('div', { className: 's360-center' }, h(Spinner, { prefix: 's360-' }), h('span', null, t('loading')));
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
          const grades = totals.grades || {};
          const gradesText = gradeDistribution(grades);

          const statsBar = h('div', { className: 's360-stats', role: 'group', 'aria-label': t('tabSkills') },
            h(StatCard, { prefix: 's360-', label: t('statSkills'), value: String(totals.skills ?? 0) }),
            h(StatCard, { prefix: 's360-', label: t('statAvg'), value: fmt1(totals.avgScore) }),
            h(StatCard, { prefix: 's360-', label: t('statGrades'), value: gradesText }),
            h(StatCard, { prefix: 's360-', label: t('statCatalogTokens'), value: formatTokens(totals.catalogTokens) + ' ' + t('tokensUnit') }),
            h(StatCard, { prefix: 's360-', label: t('statFullTokens'), value: formatTokens(totals.fullLoadTokens) + ' ' + t('tokensUnit') }),
            h(StatCard, { prefix: 's360-', label: t('statZeroUse'), value: String(totals.zeroUse ?? 0) }));

          const filterChips = (options, current, onChange) => options.map((opt) => h('button', {
            key: opt[0],
            type: 'button',
            className: 's360-filter',
            'data-active': current === opt[0] ? 'true' : 'false',
            onClick: () => onChange(opt[0]),
          }, opt[1]));

          const verdictOptions = [['all', t('filterAll')], ['keep', t('verdictKeep')], ['watch', t('verdictWatch')], ['merge', t('verdictMerge')], ['archive', t('verdictArchive')]];
          const sourceOptions = [['all', t('filterAll')]].concat(skillsSources.map((s) => [s, s]));

          const listPane = h('aside', { className: 's360-listPane', 'aria-label': t('tabSkills') },
            h('div', { className: 's360-listHead' },
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
              h('div', { className: 's360-filters', role: 'group', 'aria-label': t('filterGrade') },
                h('span', { className: 's360-filterLabel' }, t('filterGrade')),
                h('div', { className: 's360-filterRow' }, filterChips(GRADE_LETTER_OPTIONS, skillsGradeFilter, setSkillsGradeFilter))),
              h('div', { className: 's360-filters', role: 'group', 'aria-label': t('filterVerdict') },
                h('span', { className: 's360-filterLabel' }, t('filterVerdict')),
                h('div', { className: 's360-filterRow' }, filterChips(verdictOptions, skillsVerdictFilter, setSkillsVerdictFilter))),
              h('div', { className: 's360-filters', role: 'group', 'aria-label': t('filterSource') },
                h('span', { className: 's360-filterLabel' }, t('filterSource')),
                h('div', { className: 's360-filterRow' }, filterChips(sourceOptions, skillsSourceFilter, setSkillsSourceFilter))),
              h('label', { className: 's360-problemsToggle' },
                h('input', {
                  type: 'checkbox',
                  checked: skillsOnlyProblems,
                  onChange: (event) => setSkillsOnlyProblems(event.target.checked),
                }),
                h('span', null, t('skillsOnlyProblems'))),
              h('div', { className: 's360-listMeta' }, t('skillsCount', { count: skillsVisible.length }))),
            h('div', { className: 's360-list' },
              skillsVisible.length === 0
                ? h(EmptyState, { prefix: 's360-', icon: h(SearchIcon, { size: 22 }), title: t('skillsNoMatch'), hint: t('skillsNoMatchHint') })
                : skillsVisible.map((skill) => h(SkillRow, {
                  key: skill.name,
                  skill,
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
                t,
                busy: skillsBusy,
                onApply: skillsApplyOrEvolve,
                onApplyAll: skillsApplyAll,
                onJump: skillsJumpTo,
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
            skillsLoadError ? h('div', { className: 's360-banner', 'data-kind': 'error' }, t('loadFailed', { message: skillsLoadError })) : null,
            statsBar,
            h('div', { className: 's360-body' }, listPane, detailPane));
        }

        return h('div', { className: 'd360-tabBody' }, toolbar, body, h(Notice, { prefix: 's360-', notice: skillsNotice }));
      }

      function renderAgentsTab() {
        const toolbar = h('div', { className: 'a360-header' },
          h('p', { className: 'a360-subtitle' }, t('agentsSubtitle')),
          h('div', { className: 'a360-headerActions' },
            h('span', { className: 'a360-backup', 'data-backup': agentsUndoIds.length ? 'set' : 'none' },
              labeled(t, 'backupLabel', agentsUndoIds.length ? agentsUndoIds.join(', ') : t('backupNone'))),
            h('button', {
              type: 'button',
              className: 'a360-btn a360-btnGhost',
              onClick: agentsRefresh,
              disabled: agentsLoading || agentsBusy,
              title: t('refresh'),
              'aria-label': t('refresh'),
            }, agentsLoading ? h(Spinner, { prefix: 'a360-' }) : h(RefreshIcon, { size: 14 }), h('span', null, t('refresh'))),
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
          body = h('div', { className: 'a360-center' }, h(Spinner, { prefix: 'a360-' }), h('span', null, t('loading')));
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
          const grades = totals.grades || {};
          const gradesText = gradeDistribution(grades);

          const statsBar = h('div', { className: 'a360-stats', role: 'group', 'aria-label': t('tabAgents') },
            h(StatCard, { prefix: 'a360-', label: t('statSubjects'), value: String(totals.subjects ?? 0) }),
            h(StatCard, { prefix: 'a360-', label: t('statAvg'), value: fmt1(totals.avgScore) }),
            h(StatCard, { prefix: 'a360-', label: t('statGrades'), value: gradesText }),
            h(StatCard, { prefix: 'a360-', label: t('statResidentTokens'), value: formatTokens(totals.residentTokens) + ' ' + t('tokensUnit') }),
            h(StatCard, { prefix: 'a360-', label: t('statZeroInject'), value: String(totals.zeroInject ?? 0) }),
            h(StatCard, { prefix: 'a360-', label: t('statConflicts'), value: String(totals.conflicts ?? 0) }));

          const filterChips = (options, current, onChange) => options.map((opt) => h('button', {
            key: opt[0],
            type: 'button',
            className: 'a360-filter',
            'data-active': current === opt[0] ? 'true' : 'false',
            onClick: () => onChange(opt[0]),
          }, opt[1]));

          const kindOptions = [['all', t('filterAll')]].concat(agentsKinds.map((kind) => [kind, t(AGENTS_KIND_KEY[kind] || kind)]));
          const verdictOptions = [['all', t('filterAll')], ['keep', t('verdictKeep')], ['watch', t('verdictWatch')],
            ['trim', t('verdictTrim')], ['merge', t('verdictMerge')], ['archive', t('verdictArchive')]];
          const scopeOptions = [['all', t('filterAll')]].concat(agentsScopes.map((scope) => [scope, t(AGENTS_SCOPE_KEY[scope] || scope)]));

          const listPane = h('aside', { className: 'a360-listPane', 'aria-label': t('tabAgents') },
            h('div', { className: 'a360-listHead' },
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
              h('div', { className: 'a360-filters', role: 'group', 'aria-label': t('filterKind') },
                h('span', { className: 'a360-filterLabel' }, t('filterKind')),
                h('div', { className: 'a360-filterRow' }, filterChips(kindOptions, agentsKindFilter, setAgentsKindFilter))),
              h('div', { className: 'a360-filters', role: 'group', 'aria-label': t('filterGrade') },
                h('span', { className: 'a360-filterLabel' }, t('filterGrade')),
                h('div', { className: 'a360-filterRow' }, filterChips(GRADE_LETTER_OPTIONS, agentsGradeFilter, setAgentsGradeFilter))),
              h('div', { className: 'a360-filters', role: 'group', 'aria-label': t('filterVerdict') },
                h('span', { className: 'a360-filterLabel' }, t('filterVerdict')),
                h('div', { className: 'a360-filterRow' }, filterChips(verdictOptions, agentsVerdictFilter, setAgentsVerdictFilter))),
              h('div', { className: 'a360-filters', role: 'group', 'aria-label': t('filterScope') },
                h('span', { className: 'a360-filterLabel' }, t('filterScope')),
                h('div', { className: 'a360-filterRow' }, filterChips(scopeOptions, agentsScopeFilter, setAgentsScopeFilter))),
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
                h('span', null, t('onlyEvolution'))),
              h('div', { className: 'a360-listMeta' }, t('agentsCount', { count: agentsVisible.length }))),
            h('div', { className: 'a360-list' },
              agentsVisible.length === 0
                ? h(EmptyState, { prefix: 'a360-', icon: h(SearchIcon, { size: 22 }), title: t('agentsNoMatch'), hint: t('agentsNoMatchHint') })
                : agentsVisible.map((subject) => h(SubjectRow, {
                  key: subject.id,
                  subject,
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
                t,
                busy: agentsBusy,
                onApply: agentsApplyOrEvolve,
                onApplyAll: agentsApplyAll,
                onJump: agentsJumpTo,
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
            agentsLoadError
              ? h('div', { className: 'a360-banner', 'data-kind': 'error' },
                t('loadFailed', { message: agentsLoadError }))
              : null,
            statsBar,
            h('div', { className: 'a360-body' }, listPane, detailPane));
        }

        return h('div', { className: 'd360-tabBody' }, toolbar, body, h(Notice, { prefix: 'a360-', notice: agentsNotice }));
      }

      const skillsCount = skillsPortfolio && Array.isArray(skillsPortfolio.skills) ? skillsPortfolio.skills.length : 0;
      const agentsCount = agentsPortfolio && Array.isArray(agentsPortfolio.subjects) ? agentsPortfolio.subjects.length : 0;

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
          onClick: () => setTab('skills'),
        }, t('tabSkills'), h('span', { className: 'd360-tabBadge' }, String(skillsCount))),
        h('button', {
          type: 'button',
          role: 'tab',
          className: 'd360-tab' + (tab === 'agents' ? ' d360-tabActive' : ''),
          'data-tab': 'agents',
          'data-active': tab === 'agents' ? 'true' : 'false',
          'aria-selected': tab === 'agents' ? 'true' : 'false',
          onClick: () => setTab('agents'),
        }, t('tabAgents'), h('span', { className: 'd360-tabBadge' }, String(agentsCount))));

      const activeTab = tab === 'skills' ? renderSkillsTab() : renderAgentsTab();

      return h('div', { className: 'd360-page' }, header, tabbar, activeTab);
    }

    // ------------------------------------------------------------------ styles

    const CSS = [
      // top-level shell (shared d360-)
      '.d360-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;padding:20px 22px 22px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.d360-page *{box-sizing:border-box}',
      '.d360-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.d360-heading{min-width:0}',
      '.d360-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}',
      '.d360-subtitle{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.d360-tabbar{display:flex;gap:6px;flex:none;border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
      '.d360-tab{display:inline-flex;align-items:center;gap:7px;border:0.5px solid transparent;border-bottom:none;border-radius:9px 9px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:30px;padding:0 14px;cursor:pointer;margin-bottom:-0.5px}',
      '.d360-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.d360-tabActive{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.d360-tabBadge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:600;padding:0 6px}',
      '.d360-tabActive .d360-tabBadge{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.d360-tabBody{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:hidden}',
      '@keyframes d360-spin{to{transform:rotate(360deg)}}',

      // skills surface (s360-)
      '.s360-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.s360-subtitle{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
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
      '.s360-gradeS{color:#b8860b;border-color:#b8860b}',
      '.s360-gradeA{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-gradeB{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.s360-gradeC{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.s360-gradeD{color:#e8590c;border-color:#e8590c}',
      '.s360-gradeE{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
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
      '.s360-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:d360-spin .8s linear infinite;display:inline-block;flex:none}',
      '.s360-toast{position:fixed;right:18px;bottom:18px;max-width:420px;padding:9px 12px;border-radius:9px;font-size:12px;border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-toast-bg, var(--dsw-alias-bg-overlay));color:var(--dsw-alias-toast-label, var(--dsw-alias-label-primary));box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:60}',
      '.s360-toast[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.s360-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary)}',

      // agents surface (a360-)
      '.a360-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex:none}',
      '.a360-subtitle{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.a360-headerActions{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;justify-content:flex-end}',
      '.a360-backup{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.a360-btn{display:inline-flex;align-items:center;gap:6px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:22px;padding:0 10px;cursor:pointer;white-space:nowrap}',
      '.a360-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.a360-btn:disabled{opacity:.5;cursor:default}',
      '.a360-btnPrimary{border-color:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.a360-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary))}',
      '.a360-btnGhost{border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 8px}',
      '.a360-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.a360-btnSm{line-height:18px;font-size:11px;padding:0 8px}',
      '.a360-content{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}',
      '.a360-banner{padding:7px 10px;border-radius:7px;font-size:11.5px;border:0.5px solid var(--dsw-alias-border-l1)}',
      '.a360-banner[data-kind="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.a360-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;flex:none}',
      '.a360-stat{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:9px 12px;min-width:0}',
      '.a360-statValue{font-size:16px;font-weight:600;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.a360-statLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.a360-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(250px,330px) minmax(0,1fr);gap:12px}',
      '.a360-listPane{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.a360-listHead{display:flex;flex-direction:column;gap:7px;padding:11px 12px 9px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.a360-searchWrap{position:relative;display:flex;align-items:center;gap:6px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary)}',
      '.a360-searchWrap:focus-within{border-color:var(--dsw-alias-border-l2)}',
      '.a360-input{width:100%;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:6px 8px;outline:none}',
      '.a360-search{border:0;background:transparent;padding:6px 2px}',
      '.a360-filters{display:flex;flex-direction:column;gap:3px}',
      '.a360-filterLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-filterRow{display:flex;gap:4px;flex-wrap:wrap}',
      '.a360-filter{border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:20px;border-radius:6px;cursor:pointer;padding:0 7px}',
      '.a360-filter:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.a360-filter[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.a360-problemsToggle{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}',
      '.a360-listMeta{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-list{flex:1;min-height:0;overflow:auto;padding:6px}',
      '.a360-row{display:flex;align-items:flex-start;gap:9px;width:100%;text-align:left;border:0.5px solid transparent;border-radius:9px;background:transparent;color:inherit;font:inherit;padding:8px 9px;cursor:pointer;margin-bottom:2px}',
      '.a360-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.a360-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.a360-row[data-pending="true"]{box-shadow:inset 3px 0 0 var(--dsw-alias-state-business-primary)}',
      '.a360-rowMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.a360-rowTitleLine{display:flex;align-items:baseline;gap:7px;min-width:0}',
      '.a360-rowName{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.a360-rowScore{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none;margin-left:auto;font-variant-numeric:tabular-nums}',
      '.a360-rowDesc{margin-top:1px;font-size:11px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.a360-rowMeta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px}',
      '.a360-metaText{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-grade{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:6px;font-size:12px;font-weight:700;border:1px solid var(--dsw-alias-border-l1);flex:none}',
      '.a360-gradeS{color:#b8860b;border-color:#b8860b}',
      '.a360-gradeA{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.a360-gradeB{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.a360-gradeC{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.a360-gradeD{color:#e8590c;border-color:#e8590c}',
      '.a360-gradeE{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.a360-chip{display:inline-flex;align-items:center;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.a360-chip-kind-instruction{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.a360-chip-kind-agent{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.a360-chip-kind-preset{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.a360-chip-scope{color:var(--dsw-alias-label-secondary);border-style:dashed}',
      '.a360-chip-inj-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.a360-chip-inj-missing{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.a360-chip-keep{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.a360-chip-watch{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.a360-chip-trim{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);border-style:dashed}',
      '.a360-chip-merge{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.a360-chip-archive{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.a360-chip-sev-critical{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.a360-chip-sev-major{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.a360-chip-sev-minor{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.a360-chip-sev-info{color:var(--dsw-alias-label-secondary)}',
      '.a360-chip-auto{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.a360-chip-draft{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.a360-chip-manual{color:var(--dsw-alias-label-secondary)}',
      '.a360-chip-na{color:var(--dsw-alias-label-secondary);border-style:dashed}',
      '.a360-chip-evolve{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}',
      '.a360-detail{min-height:0;min-width:0;display:flex;flex-direction:column;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow-y:auto;overflow-x:hidden}',
      '.a360-detailBody{display:flex;flex-direction:column;gap:0}',
      '.a360-detailHead{display:flex;flex-direction:column;gap:7px;padding:14px 16px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.a360-detailTitleLine{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.a360-detailName{margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere}',
      '.a360-detailDesc{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-detailScoreRow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}',
      '.a360-bigScore{display:flex;align-items:baseline;gap:6px}',
      '.a360-bigScoreNum{font-size:26px;font-weight:700;letter-spacing:-.02em}',
      '.a360-bigScoreLabel{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.a360-scoreMeta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.a360-scoreMetaItem[data-delta="up"]{color:var(--dsw-alias-state-success-primary)}',
      '.a360-scoreMetaItem[data-delta="down"]{color:var(--dsw-alias-state-error-primary)}',
      '.a360-verdictReason{margin:0;font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-detailActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.a360-path{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-coverage{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.a360-section{padding:12px 16px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
      '.a360-sectionTitle{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 9px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.a360-dim{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);margin-bottom:7px}',
      '.a360-dim:last-child{margin-bottom:0}',
      '.a360-dimSummary{list-style:none;cursor:pointer;padding:9px 11px;display:flex;flex-direction:column;gap:5px}',
      '.a360-dimSummary::-webkit-details-marker{display:none}',
      '.a360-dimTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
      '.a360-dimLabel{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:600}',
      '.a360-dim[data-applicable="false"] .a360-barFill{background:var(--dsw-alias-border-l2)}',
      '.a360-dimScore{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.a360-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.a360-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
      '.a360-dimSummaryText{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.a360-dimItems{list-style:none;margin:0;padding:0 11px 9px;display:flex;flex-direction:column;gap:6px}',
      '.a360-dimItem{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:6px}',
      '.a360-dimItemTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
      '.a360-dimItemLabel{font-size:11.5px;font-weight:600}',
      '.a360-dimItemScore{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.a360-dimItemDetail{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-injection{display:flex;flex-direction:column;gap:7px}',
      '.a360-injDup{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}',
      '.a360-injDupList{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.a360-evolution{display:flex;flex-direction:column;gap:7px}',
      '.a360-subLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}',
      '.a360-evSignals{display:flex;flex-wrap:wrap;gap:5px}',
      '.a360-evSignal{display:inline-flex;align-items:center;gap:5px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-base);padding:1px 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-evSignalValue{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.a360-evEmpty{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.a360-evProposals{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.a360-evProposal{display:flex;flex-direction:column;gap:4px;border:0.5px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px}',
      '.a360-evTrigger{font-size:11.5px;font-weight:600;overflow-wrap:anywhere}',
      '.a360-evEvidence{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-evSamples{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}',
      '.a360-evSample{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-evSampleKind{flex:none;color:var(--dsw-alias-state-warn-primary)}',
      '.a360-evSampleText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.a360-evSampleMeta{flex:none;font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)}',
      '.a360-editor{display:flex;flex-direction:column;gap:7px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:10px 11px}',
      '.a360-editorTitle{font-size:12px;font-weight:600}',
      '.a360-field{display:flex;flex-direction:column;gap:3px}',
      '.a360-fieldLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-textarea{width:100%;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.45;padding:6px 8px;outline:none;resize:vertical;min-height:52px}',
      '.a360-textarea:focus{border-color:var(--dsw-alias-border-l2)}',
      '.a360-editorActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.a360-editorHint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}',
      '.a360-metric{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);padding:7px 9px;min-width:0}',
      '.a360-metricLabel{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.a360-metricValue{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.a360-findings{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.a360-finding{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:9px 11px;display:flex;flex-direction:column;gap:5px}',
      '.a360-finding[data-sev="critical"]{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.a360-finding[data-sev="major"]{border-left:3px solid var(--dsw-alias-state-warn-primary)}',
      '.a360-finding[data-sev="minor"]{border-left:3px solid var(--dsw-alias-state-business-primary)}',
      '.a360-finding[data-sev="info"]{border-left:3px solid var(--dsw-alias-state-idle-primary)}',
      '.a360-findingHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.a360-sev{display:inline-flex;align-items:center;border-radius:5px;padding:0 6px;font-size:10px;line-height:16px;font-weight:600}',
      '.a360-sev-critical{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.a360-sev-major{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.a360-sev-minor{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground, #fff)}',
      '.a360-sev-info{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.a360-findingTitle{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
      '.a360-findingDetail{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-findingEvidence{display:flex;flex-direction:column;gap:3px}',
      '.a360-code{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;background:var(--dsw-alias-bg-layer-2);border:0.5px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;color:var(--dsw-alias-label-primary);align-self:flex-start}',
      '.a360-evExcerpt{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l2);padding-left:7px;overflow-wrap:anywhere}',
      '.a360-findingSug{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-findingActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.a360-suggestions{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.a360-sug{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:9px 11px;display:flex;flex-direction:column;gap:5px}',
      '.a360-sug[data-kind="manual"]{border-style:dashed}',
      '.a360-sugHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.a360-sugTitle{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
      '.a360-sugText{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-draftNote{font-size:10.5px;color:var(--dsw-alias-state-warn-primary);border:0.5px solid var(--dsw-alias-state-warn-primary);border-radius:6px;padding:4px 7px;align-self:flex-start}',
      '.a360-manualNote{font-size:10.5px;color:var(--dsw-alias-label-secondary);border:0.5px dashed var(--dsw-alias-border-l1);border-radius:6px;padding:4px 7px;align-self:flex-start}',
      '.a360-sugActions{display:flex;gap:6px;flex-wrap:wrap}',
      '.a360-preview{display:flex;flex-direction:column;gap:3px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:7px;padding:6px 8px;background:var(--dsw-alias-bg-layer-1)}',
      '.a360-previewTitle{font-size:10px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}',
      '.a360-previewRow{display:flex;flex-direction:column;gap:1px}',
      '.a360-previewTag{font-size:10px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.a360-previewTagAfter{color:var(--dsw-alias-state-success-primary)}',
      '.a360-previewText{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.a360-conflicts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}',
      '.a360-conflict{border:0.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);padding:8px 10px;display:flex;flex-direction:column;gap:4px}',
      '.a360-conflict[data-kind="contradiction"]{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.a360-conflict[data-kind="duplicate"]{border-left:3px solid var(--dsw-alias-state-warn-primary)}',
      '.a360-conflictHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.a360-conflictOther{font-size:11.5px;font-weight:600}',
      '.a360-conflictRatio{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.a360-conflictRule{margin:0}',
      '.a360-rule{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.a360-conflictLine{font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.a360-overlaps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}',
      '.a360-overlap{margin:0}',
      '.a360-overlapBtn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;padding:7px 10px;cursor:pointer}',
      '.a360-overlapBtn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.a360-overlapName{font-size:12px;font-weight:600;color:var(--dsw-alias-brand-primary)}',
      '.a360-overlapScore{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.a360-overlapTriggers{font-size:10.5px;color:var(--dsw-alias-label-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.a360-source{border-top:0.5px solid var(--dsw-alias-border-l1)}',
      '.a360-sourceSummary{list-style:none;cursor:pointer;padding:12px 16px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.a360-sourceSummary::-webkit-details-marker{display:none}',
      '.a360-sourcePre{margin:0;padding:0 16px 14px;font-family:var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}',
      '.a360-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);min-height:200px;text-align:center;padding:24px}',
      '.a360-errorText{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;max-width:520px}',
      '.a360-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:28px 18px;text-align:center;color:var(--dsw-alias-label-secondary);min-height:140px}',
      '.a360-emptyIcon{opacity:.7;display:inline-flex}',
      '.a360-emptyTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.a360-emptyHint{font-size:11.5px;max-width:420px;overflow-wrap:anywhere}',
      '.a360-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.a360-spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);animation:d360-spin .8s linear infinite;display:inline-block;flex:none}',
      '.a360-toast{position:fixed;right:18px;bottom:18px;max-width:420px;padding:9px 12px;border-radius:9px;font-size:12px;border:0.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-toast-bg, var(--dsw-alias-bg-overlay));color:var(--dsw-alias-toast-label, var(--dsw-alias-label-primary));box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:60}',
      '.a360-toast[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.a360-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary)}',

      '@media (max-width: 880px){.s360-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.s360-body{grid-template-columns:minmax(0,1fr)}.s360-listPane{max-height:300px}.a360-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.a360-body{grid-template-columns:minmax(0,1fr)}.a360-listPane{max-height:300px}}',
      '@media (max-width: 620px){.s360-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.s360-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.s360-header{flex-direction:column}.a360-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.a360-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.a360-header{flex-direction:column}}',
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
