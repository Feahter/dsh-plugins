#!/usr/bin/env node
/**
 * Real-data probe for the `agents` surface: run the dsh-360 agents core against
 * THIS machine's real instruction files / subagent definitions / agent presets
 * and session logs (no DSH runtime needed). Read-only: no writes.
 *
 *   node scripts/probe.mjs [--roots a,b] [--window 30] [--json]
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const json = args.includes('--json');
const rootsIdx = args.indexOf('--roots');
const winIdx = args.indexOf('--window');
const windowDays = winIdx >= 0 ? Number(args[winIdx + 1]) : 30;
const HOME = homedir();
const roots = rootsIdx >= 0
  ? args[rootsIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : [process.cwd(), join(HOME, '.agents'), join(HOME, '.deepseek'), join(HOME, '.claude'), join(HOME, '.codex')];

const { discoverSubjects } = await import('../lib/agents/collect.js');
const { collectUsage } = await import('../lib/usage.js');
const { analyzeSubject, matchUsage, buildPortfolio } = await import('../lib/agents/analyze.js');

const startedAt = Date.now();
const subjects = await discoverSubjects({ roots, maxDepth: 6, now: startedAt });
const digest = await collectUsage({
  sessionsDir: join(process.env.DSH_HOME || join(HOME, '.dsh'), 'sessions'),
  windowDays,
  now: startedAt,
});

const reports = [];
for (const subject of subjects) {
  const raw = subject.path ? await readFile(subject.path, 'utf8').catch(() => null) : null;
  const matched = matchUsage(subject, digest, { now: startedAt, windowDays, defaultRoots: roots });
  reports.push(analyzeSubject({
    subject,
    raw,
    usage: matched.usage,
    injection: matched.injection,
    siblings: subjects.filter((s) => s.kind === subject.kind && s.path !== subject.path),
    options: { now: startedAt, windowDays, defaultRoots: roots },
  }));
}

const portfolio = buildPortfolio(reports, {
  generatedAt: startedAt,
  windowDays,
  sessionsScanned: digest.sessionsScanned,
  usageAvailable: digest.available,
  roots,
  options: { now: startedAt, windowDays, defaultRoots: roots },
});

if (json) {
  console.log(JSON.stringify(portfolio, null, 2));
} else {
  const { totals } = portfolio;
  console.log(`subjects      ${totals.subjects}  (instruction ${totals.instructions}, agent ${totals.agents}, preset ${totals.presets})`);
  console.log(`avg score     ${totals.avgScore}  grades ${JSON.stringify(totals.grades)}`);
  console.log(`resident      ${totals.residentTokens} tokens  (~${((totals.residentTokens / 200000) * 100).toFixed(1)}% of a 200k window)`);
  console.log(`zero inject   ${totals.zeroInject}   conflicts ${totals.conflicts}   staleRefs ${totals.staleRefs}   secrets ${totals.secrets}`);
  console.log(`sessions      ${portfolio.sessionsScanned} scanned, usage ${portfolio.usageAvailable ? 'available' : 'UNAVAILABLE'}`);
  console.log('\nworst 8:');
  for (const s of portfolio.subjects.slice(0, 8)) {
    const top = s.findings[0];
    console.log(`  ${String(s.score.total).padStart(5)} ${s.score.grade.padEnd(2)} ${s.kind.padEnd(11)} ${s.name.padEnd(28)} ${top ? top.title : '-'}`);
  }
  console.log('\nconflicts:', portfolio.conflicts.length, 'overlaps:', portfolio.overlaps.length, 'quickWins:', portfolio.quickWins.length);
  for (const c of portfolio.conflicts.slice(0, 5)) console.log(`  ${c.kind} ${c.a} ↔ ${c.b} (${c.ratio})`);
}
