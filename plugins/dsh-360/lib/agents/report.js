/**
 * Markdown health report for humans and for `dsh360_report`. Ordering is
 * intentional: portfolio cost first, then the worst subjects, then actionable
 * wins, then per-subject evidence.
 */
import { formatDate, round1 } from '../util.js';
import { basename } from 'node:path';
import { GRADE_CODES } from '../grade.js';

const SEVERITY_LABEL = { critical: '严重', major: '主要', minor: '次要', info: '提示' };
const KIND_LABEL = { auto: '可一键', draft: '需确认', manual: '仅建议' };
const SUBJECT_KIND_LABEL = { instruction: '说明书', agent: '子代理', preset: '预设' };

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [head, sep, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function topFinding(report) {
  return (report.findings || []).find((finding) => finding.severity !== 'info') || (report.findings || [])[0];
}

function quickWinIndex(portfolio) {
  const map = new Map();
  for (const win of portfolio.quickWins || []) {
    const list = map.get(win.id) || [];
    list.push(win);
    map.set(win.id, list);
  }
  return map;
}

/**
 * @param {object} portfolio
 * @param {{detail?:boolean}} options
 */
export function renderMarkdown(portfolio, { detail = true } = {}) {
  const lines = [];
  const totals = portfolio.totals || {};
  const residentPct = (totals.residentTokens / 200000 * 100).toFixed(1);
  lines.push('# Agents 360 · 说明书/子代理体检报告');
  lines.push('');
  lines.push(`- 生成时间：${new Date(portfolio.generatedAt).toLocaleString('zh-CN')}`);
  lines.push(`- 扫描窗口：近 ${portfolio.windowDays} 天会话 · ${portfolio.sessionsScanned} 个会话文件 · 使用证据${portfolio.usageAvailable ? '可用' : '不可用'}`);
  lines.push(`- 评分口径：Rubric ${portfolio.rubricVersion}（六维：注入命中 / 分层与精简 / 可执行性 / 边界与治理 / 维护卫生 / 持续进化）`);
  lines.push(`- 扫描根：${(portfolio.roots || []).map((root) => `\`${root}\``).join(' ') || '—'}`);
  lines.push(`- subject 数：${totals.subjects} · 平均分：${totals.avgScore}`);
  if (portfolio.previous) {
    lines.push(`- 相比上次扫描（${formatDate(portfolio.previous.generatedAt)}）：${portfolio.deltaAvg >= 0 ? '+' : ''}${portfolio.deltaAvg} 分`);
  }
  lines.push('');

  lines.push('## 组合概览');
  lines.push('');
  lines.push(table(
    ['指标', '数值', '说明'],
    [
      ['subject 总数', totals.subjects, `说明书 ${totals.instructions} · 子代理 ${totals.agents} · 预设 ${totals.presets}`],
      ['平均分', totals.avgScore, '六维加权后 100 分制'],
      ['等级分布', `S ${totals.grades.S} · A ${totals.grades.A} · B ${totals.grades.B} · C ${totals.grades.C} · D ${totals.grades.D} · E ${totals.grades.E}`, '字母粗粒度；18 档见 RUBRIC §1'],
      ['常驻成本', `≈ ${totals.residentTokens} tokens（占 200k 上下文 ${residentPct}%）`, '所有说明书每次会话固定注入的估算'],
      ['零注入（窗口内）', totals.zeroInject, '有足够覆盖却 0 注入证据的说明书'],
      ['跨文件冲突', totals.conflicts, '重复/矛盾规则（词面启发式）'],
      ['失效引用', totals.staleRefs, '指向不存在路径/链接'],
      ['疑似密钥/危险命令', totals.secrets, '安全风险项'],
    ],
  ));
  lines.push('');
  if (totals.gradeCodes && Object.keys(totals.gradeCodes).length > 0) {
    lines.push('18 档分布：' + GRADE_CODES.map((code) => `${code} ${totals.gradeCodes[code] || 0}`).join(' · '));
    lines.push('');
  }
  if (Object.keys(totals.byScope || {}).length > 0) {
    lines.push('作用域分布：' + Object.entries(totals.byScope).map(([scope, count]) => `${scope} ${count}`).join(' · '));
    lines.push('');
  }

  lines.push('## 优先级总表（分数从低到高）');
  lines.push('');
  const rows = (portfolio.subjects || []).map((report, index) => {
    const finding = topFinding(report);
    const usageLabel = report.kind === 'instruction'
      ? `${report.injection.sessionsInjected}/${report.injection.sessionsSeen} 注入`
      : report.kind === 'agent'
        ? `${report.usage.subagentRuns} 委派`
        : `${report.usage.presetSessions} 选中`;
    return [
      String(index + 1),
      `\`${report.name}\``,
      SUBJECT_KIND_LABEL[report.kind] || report.kind,
      `${report.score.total}`,
      report.score.grade,
      report.verdict.label,
      usageLabel,
      finding ? `${SEVERITY_LABEL[finding.severity] || finding.severity}：${finding.title}` : '—',
    ];
  });
  lines.push(table(['#', 'subject', '类型', '分数', '等级', '结论', '使用', '首要问题'], rows));
  lines.push('');

  const issues = portfolio.issues || {};
  const issueLines = [];
  if (issues.zeroInject?.length) issueLines.push(`- **零注入说明书**：${issues.zeroInject.map((item) => `\`${item.name}\``).join('、')}`);
  if (issues.staleRefs?.length) issueLines.push(`- **失效引用**：${issues.staleRefs.map((item) => `\`${item.id}\` → ${item.ref}`).join('；')}`);
  if (issues.secrets?.length) issueLines.push(`- **危险命令/密钥**：${issues.secrets.map((item) => `\`${item.name}\``).join('、')}`);
  if (portfolio.conflicts?.length) {
    issueLines.push(`- **跨文件冲突**：${portfolio.conflicts.map((pair) => `\`${pair.a}\` ↔ \`${pair.b}\`（${pair.kind} ${pair.ratio.toFixed(2)}）`).join('；')}`);
  }
  if (issueLines.length > 0) {
    lines.push('## 组合级问题');
    lines.push('');
    lines.push(...issueLines);
    lines.push('');
  }

  if (Array.isArray(portfolio.conflicts) && portfolio.conflicts.length > 0) {
    lines.push('## 冲突清单');
    lines.push('');
    lines.push(table(
      ['subject A', 'subject B', '类型', 'ratio', '规则 A', '规则 B'],
      portfolio.conflicts.map((conflict) => [
        `\`${conflict.a}\``, `\`${conflict.b}\``, conflict.kind, conflict.ratio.toFixed(2),
        `${conflict.ruleA} (:${conflict.lineA})`, `${conflict.ruleB} (:${conflict.lineB})`,
      ]),
    ));
    lines.push('');
  }

  if (Array.isArray(portfolio.evolution) && portfolio.evolution.length > 0) {
    lines.push('## 待进化清单');
    lines.push('');
    lines.push(table(
      ['subject', '待闭环信号', '最近信号', '经验', '接进入口'],
      portfolio.evolution.map((entry) => [
        `\`${entry.name}\``, entry.pendingScore,
        entry.lastSignalAt ? formatDate(entry.lastSignalAt) : '—',
        entry.lessons, entry.linked ? '已接' : '未接',
      ]),
    ));
    lines.push('');
    lines.push('> 用 `dsh360_evolve` 写一条“触发→做法”经验；这些信号不会自动消失。');
    lines.push('');
  }

  if (portfolio.quickWins?.length) {
    lines.push('## 优先修复清单（可一键）');
    lines.push('');
    lines.push(table(
      ['subject', '动作', '预计提分', '动作 id'],
      portfolio.quickWins.map((win) => [`\`${win.name}\``, win.title, `+${win.gain}`, `\`${win.actionId}\``]),
    ));
    lines.push('');
    lines.push('> 面板里点“一键优化”即可应用，写盘前自动备份；`dsh360_optimize` 工具可批量执行。');
    lines.push('');
  }

  if (detail && (portfolio.subjects || []).length > 0) {
    lines.push('## 逐 subject 详情');
    lines.push('');
    const wins = quickWinIndex(portfolio);
    portfolio.subjects.forEach((report, index) => {
      lines.push(`### ${index + 1}. \`${report.name}\` — ${report.score.total} 分（${report.score.grade}）· ${report.verdict.label}`);
      lines.push('');
      lines.push(`- 类型：${SUBJECT_KIND_LABEL[report.kind] || report.kind} · 作用域：${report.scope} · 覆盖：${report.coverage} · 置信度 ${pct(report.score.confidence)}${report.score.delta != null ? ` · 较上次 ${report.score.delta >= 0 ? '+' : ''}${report.score.delta}` : ''}`);
      if (report.path) lines.push(`- 路径：\`${report.path}\``);
      lines.push(`- 结论：${report.verdict.reason}`);
      lines.push('');
      lines.push(table(
        ['维度', '得分', '说明'],
        report.score.dimensions.map((dim) => [
          dim.label,
          dim.applicable === false ? '不评分' : `${dim.score} / ${dim.max}`,
          dim.summary,
        ]),
      ));
      lines.push('');
      const evolution = report.evolution && typeof report.evolution === 'object' ? report.evolution : null;
      if (evolution) {
        const lessons = evolution.lessons || {};
        const signals = evolution.signals || {};
        const pending = evolution.pending || {};
        lines.push('持续进化：'
          + `经验 ${lessons.count || 0} 条${lessons.latestAt ? `（最近 ${formatDate(lessons.latestAt)}）` : ''}`
          + `${lessons.linked ? ' · 已接进入口' : ' · 未接进入口'}`);
        lines.push('信号计数：'
          + `纠错 ${signals.corrections || 0} · 报错 ${signals.postLoadErrors || 0} · 追问 ${signals.asks || 0} · 失败 ${signals.turnFailures || 0}`);
        if (pending.hasUnclosed) {
          const draft = pending.draft || {};
          lines.push(`待闭环：${draft.trigger || '（待补触发）'} → （待补做法）${draft.evidence ? ` · ${draft.evidence}` : ''}`);
        }
        lines.push('');
      }
      const usageLine = report.kind === 'instruction'
        ? `注入 ${report.injection.sessionsInjected}/${report.injection.sessionsSeen} 会话`
        : report.kind === 'agent'
          ? `委派 ${report.usage.subagentRuns} 次`
          : `选中 ${report.usage.presetSessions} 会话`;
      lines.push('关键指标：'
        + `正文 ${report.metrics.lines} 行 / ≈${report.metrics.estTokens} tokens；`
        + `${usageLine}；`
        + `祈使句 ${report.metrics.imperativeCount}；`
        + `失效引用 ${report.metrics.staleRefs.length}；`
        + `最高重叠 ${(report.overlapMax ?? report.metrics?.overlapMax ?? 0).toFixed(2)}。`);
      lines.push('');
      const findings = (report.findings || []).filter((finding) => finding.severity !== 'info');
      if (findings.length === 0) {
        lines.push('未发现需要扣分的结构性问题。');
      } else {
        lines.push('**发现**');
        lines.push('');
        for (const finding of findings) {
          const where = finding.evidence
            ? [finding.evidence.file || (finding.evidence.line ? basename(report.path || '') : ''), finding.evidence.line ? `:${finding.evidence.line}` : ''].join('')
            : '';
          const evidence = finding.evidence
            ? `  \n  证据：${where ? `\`${where}\`` : ''}${finding.evidence.excerpt ? ` — ${finding.evidence.excerpt}` : ''}`
            : '';
          lines.push(`- [${SEVERITY_LABEL[finding.severity] || finding.severity}] **${finding.title}** — ${finding.detail}${evidence}`);
          lines.push(`  - 建议：${finding.suggestion}`);
        }
      }
      lines.push('');
      const suggestions = report.suggestions || [];
      if (suggestions.length > 0) {
        lines.push('**可执行优化**');
        lines.push('');
        for (const suggestion of suggestions) {
          lines.push(`- [${KIND_LABEL[suggestion.kind] || suggestion.kind}] ${suggestion.title}（\`${suggestion.id}\`）`);
          lines.push(`  - 为什么：${suggestion.why}`);
          lines.push(`  - 风险：${suggestion.risk}`);
          if (suggestion.preview?.after) lines.push(`  - 预览：${suggestion.preview.after}`);
        }
        lines.push('');
      }
      const subjectWins = wins.get(report.id);
      if (subjectWins?.length) {
        lines.push(`一键优化：${subjectWins.map((win) => `\`${win.actionId}\``).join('、')}`);
        lines.push('');
      }
      if (report.overlaps?.length) {
        lines.push(`重叠：${report.overlaps.map((overlap) => `\`${overlap.name}\` ${overlap.score.toFixed(2)}`).join(' · ')}`);
        lines.push('');
      }
    });
  }

  lines.push('## 口径与局限');
  lines.push('');
  lines.push('- 分数是启发式体检，不是内容正确性证明；每条扣分都应能在报告里找到证据。');
  lines.push('- 注入证据来自会话日志的 `Instructions from:` 文本，harness 版本变化可能换格式；缺失时按“无证据”处理并降置信度。');
  lines.push('- 子代理定义的使用次数来自 `subagent/catalog` 的 label 匹配，label 由父 agent 自由撰写，存在漏配。');
  lines.push('- 跨文件冲突是词面启发式，近义不同词的矛盾会漏报。');
  lines.push('- `partial` 覆盖（没读到正文）时置信度 ≤0.5。');
  lines.push('- 自动优化只做结构搬运与块插入，不判断规则内容是否正确；所有写入均有备份，可在面板撤销。');
  lines.push('');
  lines.push(`> 由 dsh-360 · Agents 面生成 · ${round1(portfolio.totals?.avgScore || 0)} 平均分 · 扫描 ${portfolio.totals?.subjects || 0} 个 subject`);
  lines.push('');
  return lines.join('\n');
}
