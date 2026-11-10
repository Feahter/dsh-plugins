/**
 * Run every verification surface of dsh-360 (both surfaces of the plugin):
 *  - syntax checks on the two runtime halves (index.js / client.js)
 *  - core unit tests: 18-bucket grading, skills core, agents core
 *  - host route/tool verification (mock Cordis context, temp skills/subjects)
 *  - client render smoke test (fake module loader + React shim)
 *
 * No dependencies; safe to run on any machine with Node >= 22.15.
 * Any failing step makes the whole run exit non-zero.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

/** [label, argv, files that must exist first] */
const steps = [
  ['syntax index.js', ['--check', join(root, 'index.js')], [join(root, 'index.js')]],
  ['syntax client.js', ['--check', join(root, 'client.js')], [join(root, 'client.js')]],
  [
    'core tests (grade + skills + agents)',
    ['--test', join(here, 'grade.test.mjs'), join(here, 'skills.test.mjs'), join(here, 'agents.test.mjs')],
    [join(here, 'grade.test.mjs'), join(here, 'skills.test.mjs'), join(here, 'agents.test.mjs')],
  ],
  ['host verify', [join(here, 'verify-host.mjs')], [join(here, 'verify-host.mjs')]],
  ['client verify', [join(here, 'verify-client.mjs')], [join(here, 'verify-client.mjs')]],
];

let failed = 0;
for (const [label, args, required] of steps) {
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(`\n✗ ${label}: missing ${missing.join(', ')}`);
    failed += 1;
    continue;
  }
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root });
  if (result.error) {
    failed += 1;
    console.error(`✗ ${label} could not start: ${result.error.message}`);
    continue;
  }
  if (result.status !== 0) {
    failed += 1;
    console.error(`✗ ${label} failed (exit ${result.status})`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} verification step(s) failed`);
  process.exit(1);
}
console.log('\n✓ all dsh-360 verification steps passed (skills + agents surfaces)');
