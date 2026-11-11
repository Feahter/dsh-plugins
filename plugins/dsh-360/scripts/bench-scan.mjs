#!/usr/bin/env node
/**
 * Wall-clock evidence for the dsh-360 scan path: boot the real host against
 * this machine (read-only, same as scripts/probe-host.mjs) a few times and
 * print every run plus the median. Each run is a fresh Node process, so the
 * in-process usage cache is cold every time.
 *
 *   node scripts/bench-scan.mjs [--surface agents|skills|both] [--runs 3]
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const surfaceIdx = args.indexOf('--surface');
const surface = surfaceIdx >= 0 ? args[surfaceIdx + 1] : 'agents';
const runsIdx = args.indexOf('--runs');
const runs = Math.max(1, Number.parseInt(runsIdx >= 0 ? args[runsIdx + 1] : '3', 10) || 3);
if (!['agents', 'skills', 'both'].includes(surface)) {
  console.error('bench-scan: --surface must be agents, skills or both');
  process.exit(2);
}

const probe = join(root, 'scripts', 'probe-host.mjs');
const times = [];
for (let i = 0; i < runs; i += 1) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [probe, '--surface', surface], { stdio: 'ignore' });
  const seconds = (performance.now() - started) / 1000;
  if (result.status !== 0) {
    console.error(`bench-scan: run ${i + 1} failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }
  times.push(seconds);
  console.log(`run ${i + 1}  ${seconds.toFixed(2)}s`);
}

const sorted = [...times].sort((a, b) => a - b);
const median = sorted.length % 2 === 1
  ? sorted[(sorted.length - 1) / 2]
  : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
console.log(`\nsurface ${surface} · ${runs} runs · median ${median.toFixed(2)}s · min ${sorted[0].toFixed(2)}s · max ${sorted[sorted.length - 1].toFixed(2)}s`);
