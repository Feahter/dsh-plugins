/**
 * Run every verification surface of skills-360:
 *  - syntax checks on the two runtime halves
 *  - core unit tests
 *  - host route/tool verification (mock Cordis context + temp skills)
 *  - client render smoke test (fake module loader + React shim)
 *
 * No dependencies; safe to run on any machine with Node >= 22.15.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const steps = [
  ['syntax index.js', ['--check', join(root, 'index.js')]],
  ['syntax client.js', ['--check', join(root, 'client.js')]],
  ['core tests', ['--test', join(here, 'core.test.mjs')]],
  ['host verify', [join(root, '.verify-host.mjs')]],
  ['client verify', [join(root, '.verify-client.mjs')]],
];

let failed = 0;
for (const [label, args] of steps) {
  const file = args[0] === '--check' || args[0] === '--test' ? args[1] : args[0];
  if (file && !existsSync(file)) {
    console.error(`\n✗ ${label}: missing ${file}`);
    failed += 1;
    continue;
  }
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root });
  if (result.status !== 0) {
    failed += 1;
    console.error(`✗ ${label} failed (exit ${result.status})`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} verification step(s) failed`);
  process.exit(1);
}
console.log('\n✓ all skills-360 verification steps passed');
