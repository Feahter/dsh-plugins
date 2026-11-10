#!/usr/bin/env node
/**
 * Boot the real dsh-360 host against THIS machine (real DSH_HOME, real
 * profiles, real session logs) with a mock Cordis context, then run one scan
 * through the public tool surface. Read-only: no writes, no route server.
 *
 *   node scripts/probe-host.mjs [--json] [--surface skills|agents|both]
 *
 * Needs index.js (host layer). Until it lands this probe exits with a clear
 * message instead of a stack trace.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'index.js');
if (!existsSync(entry)) {
  console.error(`probe-host: host layer missing at ${entry} (owned by the host team)`);
  process.exit(2);
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const surfaceIdx = args.indexOf('--surface');
const surface = surfaceIdx >= 0 ? args[surfaceIdx + 1] : 'both';

const captured = { tools: new Map(), routes: new Map() };
const ctx = {
  get: () => ({ requestRejection: () => undefined }),
  logger: { info: () => {}, warn: (msg) => console.error('[warn]', msg) },
  effect(fn) {
    const disposer = fn();
    return () => disposer?.();
  },
  tools: {
    register(definition) {
      captured.tools.set(definition.name, definition);
      return () => captured.tools.delete(definition.name);
    },
  },
  webServer: {
    register(entryDef) {
      captured.routes.set(entryDef.path, entryDef);
      return () => captured.routes.delete(entryDef.path);
    },
  },
};

const mod = await import(entry);
const config = { windowDays: 30, roots: [], maxDepth: 6, evolution: true, backupsKeep: 20, catalogDescriptionMaxLength: 500 };
const disposer = mod.apply(ctx, config);

const scan = captured.tools.get('dsh360_scan');
if (!scan) throw new Error('dsh360_scan was not registered');
const result = await scan.execute({ surface, detail: 'full', refresh: true });
const payload = result?.data ?? result;

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`tools    ${[...captured.tools.keys()].join(', ')}`);
  console.log(`routes   ${[...captured.routes.keys()].join(', ')}`);
  for (const [name, p] of Object.entries(payload?.surfaces || {})) {
    const totals = p.totals || {};
    console.log(`\n== ${name} ==`);
    console.log(`subjects   ${totals.subjects ?? totals.skills ?? '?'}   avg ${totals.avgScore ?? '?'}   grades ${JSON.stringify(totals.grades)}`);
    for (const s of (p.subjects || []).slice(0, 6)) {
      const label = s.name ?? s.id ?? '?';
      console.log(`  ${String(s.score?.total).padStart(5)} ${String(s.score?.grade).padEnd(2)} ${label.padEnd(28)} ${s.findings?.[0]?.title ?? '-'}`);
    }
  }
}
disposer?.();
