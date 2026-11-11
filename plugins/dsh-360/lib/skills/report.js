/**
 * Markdown health report for humans and for `dsh360_report`.
 * The ordering is intentional: portfolio cost first, then the worst skills,
 * then actionable wins, then per-skill evidence.
 */
import { formatDate, round1 } from '../util.js';
import { GRADE_CODES } from '../grade.js';

const SEVERITY_LABEL = { critical: '严重', major: '主要', minor: '次要', info: '提示' };
const KIND_LABEL = { auto: '可一键', draft: '需确认', manual: '仅建议' };

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

function evolutionTotalLabel(totals) {
  const ev = totals.evolution || {};
  const parts = [];
  if (ev.skillsWithLessons) parts.push(`${ev.skillsWithLessons} 个技能沉淀 ${ev.lessonsTotal} 条经验`);
  if (ev.pendingSkills) parts.push(`${ev.pendingSkills} 个待进化`);
  if (ev.signalsTotal) parts.push(`${ev.signalsTotal} 个加载后信号`);
  return parts.join(' · ') || '暂无经验沉淀，也无待闭环信号';
}

function quickWinIndex(portfolio) {
  const map = new Map();
  for (const win of portfolio.quickWins || []) {
    const list = map.get(win.name) || [];
    list.push(win);
    map.set(win.name, list);
  }
  return map;
}

/**
 * One compact Chinese classification line: 职责 · 层级 · 形态 · 范围 · 状态.
 * Labels always come from `report.classification` (taxonomy.js), never from
 * the path or the UI.
 */
function classificationLine(report) {
  const classification = report.classification;
  if (!classification || !classification.role) return null;
  const parts = [
    classification.role.label,
    classification.layer?.label,
    classification.kind?.label,
    classification.scope?.label,
  ].filter(Boolean);
  const states = (classification.state || []).map((state) => state.label).filter(Boolean);
  if (states.length > 0) parts.push(states.join('、'));
  return `分类：${parts.join(' · ')}`;
}

/**
 * Short 分类分布 section: role table with counts (from totals.byRole) plus a
 * compact kind/scope line. Labels come from portfolio.taxonomy, so a surface
 * with a different kind label (形态 vs 类型) renders correctly.
 */
function classificationSection(portfolio) {
  const taxonomy = portfolio.taxonomy;
  const totals = portfolio.totals || {};
  const axes = taxonomy && Array.isArray(taxonomy.axes) ? taxonomy.axes : [];
  const roleAxis = axes.find((axis) => axis.id === 'role');
  const byRole = totals.byRole || {};
  const rows = [];
  if (roleAxis) {
    for (const value of roleAxis.values) {
      const count = byRole[value.id] || 0;
      if (count > 0) rows.push([value.label, count, value.description || '—']);
    }
  }
  if (rows.length === 0) return [];
  rows.sort((a, b) => b[1] - a[1]);

  const lines = ['## 分类分布', ''];
  lines.push(table(['职责', '数量', '说明'], rows));
  lines.push('');
  const countMaps = {
    layer: totals.byLayer || {},
    kind: totals.byKind || {},
    scope: totals.byScope || {},
  };
  for (const axis of axes) {
    const counts = countMaps[axis.id];
    if (!counts) continue;
    const parts = axis.values
      .filter((value) => (counts[value.id] || 0) > 0)
      .map((value) => `${value.label} ${counts[value.id]}`);
    if (parts.length > 0) lines.push(`${axis.label}：${parts.join(' · ')}`);
  }
  lines.push('');
  return lines;
}

/**
 * @param {object} portfolio
 * @param {{detail?:boolean}} options
 */
export function renderMarkdown(portfolio, { detail = true } = {}) {
  const lines = [];
  const totals = portfolio.totals || {};
  lines.push('# Skills 360 · 技能体检报告');
  lines.push('');
  lines.push(`- 生成时间：${new Date(portfolio.generatedAt).toLocaleString('zh-CN')}`);
  lines.push(`- 扫描窗口：近 ${portfolio.windowDays} 天会话 · ${portfolio.sessionsScanned} 个会话文件`);
  lines.push(`- 评分口径：Rubric ${portfolio.rubricVersion}（六维：按需加载 / 渐进披露 / 可执行性 / 边界 / 卫生 / 持续进化）· 目录描述上限 ${portfolio.catalogDescriptionMaxLength} 字符`);
  lines.push(`- 技能数：${totals.skills} · 平均分：${totals.avgScore}`);
  if ((portfolio.skills || []).length !== totals.skills) {
    lines.push(`- 本报告仅包含 ${(portfolio.skills || []).length} 个技能（catalog 共 ${totals.skills} 个）；组合指标仍为全 catalog 口径。`);
  }
  if (portfolio.previous) {
    lines.push(`- 相比上次扫描（${formatDate(portfolio.previous.generatedAt)}）：${portfolio.deltaAvg >= 0 ? '+' : ''}${portfolio.deltaAvg} 分`);
  } else if (portfolio.rubricVersion === '2.0') {
    lines.push('- 评分口径升级说明：Rubric 2.0 起为六维评分，历史 v1.x 分数不可比，本期不与历史比较。');
  }
  lines.push('');

  lines.push('## 组合概览');
  lines.push('');
  lines.push(table(
    ['指标', '数值', '说明'],
    [
      ['技能总数', totals.skills, '当前 catalog 中模型可见的 skill'],
      ['平均分', totals.avgScore, '六维加权后 100 分制'],
      ['等级分布', `S ${totals.grades.S} · A ${totals.grades.A} · B ${totals.grades.B} · C ${totals.grades.C} · D ${totals.grades.D} · E ${totals.grades.E}`, '字母粗粒度；18 档见 RUBRIC §1'],
      ['catalog 固定成本', `≈ ${totals.catalogTokens} tokens`, '每次会话固定注入的 name + description'],
      ['全量加载成本', `≈ ${totals.fullLoadTokens} tokens`, '若把所有 SKILL.md 全加载一次'],
      ['零按需加载（窗口内）', totals.zeroUse, '有足够样本但 skill 工具 0 次按需加载（不含 /name 直呼）'],
      ['references 文件', totals.referenceFiles, '已外置的按需细节'],
      ['持续进化', evolutionTotalLabel(totals), '沉淀经验与待闭环信号的组合口径'],
    ],
  ));
  lines.push('');
  if (totals.gradeCodes && Object.keys(totals.gradeCodes).length > 0) {
    lines.push('18 档分布：' + GRADE_CODES.map((code) => `${code} ${totals.gradeCodes[code] || 0}`).join(' · '));
    lines.push('');
  }
  if (Object.keys(totals.bySource || {}).length > 0) {
    lines.push('来源分布：' + Object.entries(totals.bySource).map(([source, count]) => `${source} ${count}`).join(' · '));
    lines.push('');
  }

  lines.push(...classificationSection(portfolio));

  lines.push('## 优先级总表（分数从低到高）');
  lines.push('');
  const rows = (portfolio.skills || []).map((report, index) => {
    const finding = topFinding(report);
    const usage = report.usage?.sufficient ? `${report.usage.count} 次` : '样本不足';
    return [
      String(index + 1),
      `\`${report.name}\``,
      `${report.score.total}`,
      report.score.grade,
      report.verdict.label,
      usage,
      finding ? `${SEVERITY_LABEL[finding.severity] || finding.severity}：${finding.title}` : '—',
    ];
  });
  lines.push(table(['#', '技能', '分数', '等级', '结论', '按需加载', '首要问题'], rows));
  lines.push('');

  const issues = portfolio.issues || {};
  const issueLines = [];
  if (issues.zeroUse?.length) issueLines.push(`- **零按需加载**（有足够样本）：${issues.zeroUse.map((name) => `\`${name}\``).join('、')}`);
  if (issues.truncated?.length) issueLines.push(`- **描述超目录上限**：${issues.truncated.map((name) => `\`${name}\``).join('、')}`);
  if (issues.brokenLinks?.length) issueLines.push(`- **失效链接**：${issues.brokenLinks.map((item) => `\`${item.name}\` → ${item.href}`).join('；')}`);
  if (issues.dangerous?.length) issueLines.push(`- **危险命令/密钥**：${issues.dangerous.map((item) => `\`${item.name}\``).join('、')}`);
  if (issues.pendingEvolution?.length) issueLines.push(`- **待进化**（有信号未沉淀）：${issues.pendingEvolution.map((name) => `\`${name}\``).join('、')}`);
  if (portfolio.overlaps?.length) {
    issueLines.push(`- **重叠对（≥0.4）**：${portfolio.overlaps.map((pair) => `\`${pair.a}\` ↔ \`${pair.b}\` (${pair.score.toFixed(2)})`).join('；')}`);
  }
  if (issueLines.length > 0) {
    lines.push('## 组合级问题');
    lines.push('');
    lines.push(...issueLines);
    lines.push('');
  }

  if (Array.isArray(portfolio.evolution) && portfolio.evolution.length > 0) {
    lines.push('## 待进化清单');
    lines.push('');
    lines.push(table(
      ['技能', '待闭环信号', '最近信号', '经验', '接进入口'],
      portfolio.evolution.map((entry) => [
        `\`${entry.name}\``,
        entry.pendingScore,
        entry.lastSignalAt ? formatDate(entry.lastSignalAt) : '—',
        entry.lessons,
        entry.linked ? '已接' : '未接',
      ]),
    ));
    lines.push('');
    lines.push('> 用 `dsh360_evolve` 写一条“触发→做法”，或直接在面板沉淀经验；这些信号不会自动消失。');
    lines.push('');
  }

  if (portfolio.quickWins?.length) {
    lines.push('## 优先修复清单（可一键）');
    lines.push('');
    lines.push(table(
      ['技能', '动作', '预计提分', '动作 id'],
      portfolio.quickWins.map((win) => [`\`${win.name}\``, win.title, `+${win.gain}`, `\`${win.actionId}\``]),
    ));
    lines.push('');
    lines.push('> 面板里点“一键优化”即可应用，写盘前自动备份；`dsh360_optimize` 工具可批量执行。');
    lines.push('');
  }

  if (detail && (portfolio.skills || []).length > 0) {
    lines.push('## 逐技能详情');
    lines.push('');
    const wins = quickWinIndex(portfolio);
    portfolio.skills.forEach((report, index) => {
      lines.push(`### ${index + 1}. \`${report.name}\` — ${report.score.total} 分（${report.score.grade}）· ${report.verdict.label}`);
      lines.push('');
      lines.push(`- 来源：${report.source} · 置信度 ${pct(report.score.confidence)}${report.score.delta != null ? ` · 较上次 ${report.score.delta >= 0 ? '+' : ''}${report.score.delta}` : ''}`);
      const taxonomyLine = classificationLine(report);
      if (taxonomyLine) lines.push(`- ${taxonomyLine}`);
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
          + `加载 ${signals.loads || 0} · 纠错 ${signals.corrections || 0} · 报错 ${signals.postLoadErrors || 0} · 重复加载 ${signals.reloads || 0} · 失败 ${signals.turnFailures || 0}`);
        if (pending.hasUnclosed) {
          const proposals = Array.isArray(evolution.proposals) ? evolution.proposals : [];
          const drafts = proposals.map((proposal) => {
            const draft = proposal.draft || {};
            return `「${draft.trigger || '（待补触发）'}」→（待补做法）${draft.evidence ? ` · ${draft.evidence}` : ''}`;
          }).join('；');
          lines.push(`待闭环：${drafts || '有信号尚未沉淀为经验'}`);
        }
        lines.push('');
      }
      lines.push('关键指标：'
        + `正文 ${report.metrics.bodyLines} 行 / ≈${report.metrics.estTokens} tokens；`
        + `描述 ${report.metrics.descriptionChars} 字符；`
        + `references ${report.metrics.referenceCount} 个（链接 ${report.metrics.referencedFiles}）；`
        + `窗口按需加载 ${report.usage.sufficient ? report.usage.count : '样本不足'}；`
        + `最高重叠 ${report.metrics.overlapMax.toFixed(2)}${report.metrics.overlapName ? `（${report.metrics.overlapName}）` : ''}。`);
      lines.push('');
      const findings = (report.findings || []).filter((finding) => finding.severity !== 'info');
      if (findings.length === 0) {
        lines.push('未发现需要扣分的结构性问题。');
      } else {
        lines.push('**发现**');
        lines.push('');
        for (const finding of findings) {
          const where = finding.evidence
            ? [finding.evidence.file || (finding.evidence.line ? 'SKILL.md' : ''), finding.evidence.line ? `:${finding.evidence.line}` : ''].join('')
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
      const skillWins = wins.get(report.name);
      if (skillWins?.length) {
        lines.push(`一键优化：${skillWins.map((win) => `\`${win.actionId}\``).join('、')}`);
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
  lines.push('- 分类（职责/层级/形态/范围/状态）由名称与描述的关键词加权命中 + 结构推导，置信度与命中词只出现在 JSON 里；它用于分面筛选，不是精确语义判定。');
  lines.push('- 评分口径自 Rubric 2.0 起改为六维（按需加载 / 渐进披露 / 可执行性 / 边界 / 卫生 / 持续进化），与 v1.x 的五维分数不可直接比较；组合对比遇版本变化自动清空历史对比。');
  lines.push('- 使用统计只覆盖 `skill` 工具的加载调用；用户通过 `/name` 直接唤起、或宿主不经工具注入的路径未计入。');
  lines.push('- “持续进化”维在窗口内没有按需加载样本时不评分，其余五维按 90 分折算为 100。');
  lines.push('- 目录描述上限按本插件配置（默认 500 字符）计算；不同 profile / agent preset 可能不同。');
  lines.push('- 重叠检测基于 IDF 加权词面 + 名称相似度，近义但用词完全不同的重复技能仍可能漏报。');
  lines.push('- 自动优化只做结构搬运与描述重排，不改写正文知识；所有写入均有备份，可在面板撤销。');
  lines.push('');
  lines.push(`> 由 dsh-360 · 技能面生成 · ${round1(portfolio.totals?.avgScore || 0)} 平均分 · 扫描 ${portfolio.totals?.skills || 0} 个技能`);
  lines.push('');
  return lines.join('\n');
}
