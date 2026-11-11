/**
 * dsh-360 — one bundle, one host, two health-check surfaces (skills + agents).
 *
 * This is the unified entry point: it validates configuration, builds the
 * `paths` the two surfaces share, registers both surface route prefixes plus a
 * `/api/dsh-360/health` route, and exposes four agent tools (`dsh360_scan`,
 * `dsh360_report`, `dsh360_optimize`, `dsh360_evolve`) that dispatch to the
 * matching surface. All business logic lives in `lib/host-skills.js` and
 * `lib/host-agents.js`; this file only composes and validates.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { createSkillsSurface } from './lib/host-skills.js';
import { createAgentsSurface } from './lib/host-agents.js';

const VERSION = '0.2.2';
const HEALTH_PREFIX = '/api/dsh-360/health';

class HarnessError extends Error {
  constructor(message, { code = 'internal', status = 500 } = {}) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------------- config

function positiveInteger(value, fallback, max) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = Math.floor(value);
    if (parsed >= 1 && parsed <= max) return parsed;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (parsed >= 1 && parsed <= max) return parsed;
  }
  return fallback;
}

function expandHome(pathname) {
  if (pathname === '~') return homedir();
  if (pathname.startsWith('~/')) return join(homedir(), pathname.slice(2));
  return pathname;
}

function normalizeRoots(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    out.push(resolve(expandHome(item.trim())));
  }
  return out;
}

/**
 * Hand-written config validation (no JSON schema): every key is coerced to a
 * sane value with a default, and out-of-range / wrongly-typed values fall back.
 */
function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    windowDays: positiveInteger(raw.windowDays, 30, 3650),
    catalogDescriptionMaxLength: positiveInteger(raw.catalogDescriptionMaxLength, 500, 4000),
    backupsKeep: positiveInteger(raw.backupsKeep, 20, 1000),
    evolution: raw.evolution === false ? false : true,
    roots: normalizeRoots(raw.roots),
    maxDepth: positiveInteger(raw.maxDepth, 6, 16),
    // Pre-scan in the background so the panel's first open paints the snapshot
    // immediately instead of paying the cold scan. Tests/probes pass
    // warmup:false to stay deterministic; users can opt out with `warmup: false`.
    warmup: raw.warmup !== false,
  };
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured.trim());
  return join(homedir(), '.dsh');
}

// -------------------------------------------------------------------- tools

function lossless(value) {
  return JSON.parse(JSON.stringify(value));
}

function textOutput(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function defineTool(name, description, parameters, execute, render) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: render || ((_args, value) => textOutput(value)),
    },
    execute,
    timeoutMs: 60000,
  };
}

function optionalToolInteger(args, key, fallback, max) {
  const value = args && args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HarnessError(`Argument "${key}" must be an integer.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  const parsed = Math.floor(value);
  if (parsed < 1 || parsed > max) {
    throw new HarnessError(`Argument "${key}" must be between 1 and ${max}.`, {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return parsed;
}

function optionalToolCwd(args) {
  const value = args && args.cwd;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new HarnessError('Argument "cwd" must be an absolute workspace path.', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return resolve(value);
}

function stampFor(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function resolveSurfaceNames(value) {
  const surface = value === undefined || value === null ? 'both' : String(value);
  if (surface === 'both') return ['skills', 'agents'];
  if (surface === 'skills' || surface === 'agents') return [surface];
  throw new HarnessError('Argument "surface" must be one of skills, agents, or both.', {
    code: 'invalid-argument',
    status: 400,
  });
}

function requireSingleSurface(value) {
  const surface = value === undefined || value === null ? '' : String(value);
  if (surface !== 'skills' && surface !== 'agents') {
    throw new HarnessError('Argument "surface" is required and must be "skills" or "agents".', {
      code: 'invalid-argument',
      status: 400,
    });
  }
  return surface;
}

function createTools(surfaces, reportDir) {
  const scanTool = defineTool(
    'dsh360_scan',
    'Score the current DeepSeek Harness surface end to end. The "surface" argument selects which side to audit: "skills" (the skill catalog: SKILL.md trigger surface, real usage, overlap, progressive disclosure, actionability, boundary/governance, maintenance hygiene, continuous evolution) or "agents" (resident instruction files AGENTS.md/CLAUDE.md/instructions.md, subagent definitions agents/*.md, and per-profile agent presets). Default "both" scans both. Call it when the user asks to audit, score, inventory, or clean up their skills or 说明书/子代理定义; asks why a skill never triggers or an AGENTS.md never gets injected; complains a description is too long or subjects overlap; or wants to know what to merge/archive. detail="summary" (default) returns a compact per-item list (score, grade, verdict, classification, top finding, delta) with totals; detail="full" returns whole portfolios with metrics, findings and suggestions. Every item carries a four-axis `classification` (role / kind / scope / state) plus a one-line summary; `detail="full"`, the report and the panel also expose stable `tags` ids.',
    {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: ['skills', 'agents', 'both'], description: 'Which surface to scan. Defaults to "both".' },
        windowDays: { type: 'integer', description: 'Usage window in days (1-3650). Defaults to the plugin config (30).' },
        refresh: { type: 'boolean', description: 'Bypass the 60s scan cache and rescan now.' },
        cwd: { type: 'string', description: 'Absolute workspace path: skills scans its .dsh/skills + .agents/skills; agents adds it as a scan root.' },
        detail: { type: 'string', enum: ['summary', 'full'], description: '"summary" (default) for compact scores, "full" for the complete portfolio.' },
        kind: { type: 'string', enum: ['instruction', 'agent', 'preset'], description: 'agents only: filter subjects to one kind.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const surfaceNames = resolveSurfaceNames(args && args.surface);
      const windowDays = optionalToolInteger(args, 'windowDays', 30, 3650);
      const refresh = Boolean(args && (args.refresh === true || args.refresh === 'true'));
      const cwd = optionalToolCwd(args);
      const detail = args && args.detail === 'full' ? 'full' : 'summary';
      const kind = args && args.kind ? args.kind : null;
      const out = {};
      for (const name of surfaceNames) {
        const surface = surfaces[name];
        const portfolio = await surface.scan({ windowDays, refresh, cwd, kind });
        out[name] = detail === 'full' ? lossless(portfolio) : surface.summary(portfolio);
      }
      return { surfaces: out };
    },
  );

  const reportTool = defineTool(
    'dsh360_report',
    'Render the dsh-360 health report as Chinese Markdown, with one section per surface (skills, then agents): per-item scores, dimensions, findings, suggestions, overlaps, resident-token cost and quick wins. Call it when the user wants a readable/shareable audit, a before/after summary, or asks to export the report to a file (save=true writes it under <DSH_HOME>/dsh-360/reports and returns the path). Pass names (skills) and/or ids (agents) to report on a subset; detail=false for the short table form.',
    {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: ['skills', 'agents', 'both'], description: 'Which surface to report. Defaults to "both".' },
        names: { type: 'array', items: { type: 'string' }, description: 'Skill names to include (skills surface).' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Subject ids to include (agents surface).' },
        detail: { type: 'boolean', description: 'Include per-item detail. Defaults to true.' },
        save: { type: 'boolean', description: 'Also write the Markdown to a file. Defaults to false.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const surfaceNames = resolveSurfaceNames(args && args.surface);
      const detail = args && args.detail;
      const parts = [];
      for (const name of surfaceNames) {
        const surface = surfaces[name];
        const result = await surface.report({ names: args && args.names, ids: args && args.ids, detail });
        parts.push(result.markdown);
      }
      const markdown = parts.join('\n\n---\n\n');
      if (args && args.save === true) {
        const path = await saveMergedReport(reportDir, markdown);
        return { markdown, path };
      }
      return { markdown };
    },
    (_args, value) => {
      if (value && typeof value.markdown === 'string') {
        const text = value.path ? `Saved to ${value.path}\n\n${value.markdown}` : value.markdown;
        return textOutput(text);
      }
      return textOutput(value);
    },
  );

  const optimizeTool = defineTool(
    'dsh360_optimize',
    'Plan or apply the safe mechanical fixes a surface suggests. Applied fixes return an `effect` summary (score before/after, delta, token delta, grade-ups, backupIds for undo). "surface" is required: "skills" (link orphan references, extract oversized sections into references/, trim over-long descriptions, front-load trigger sentences) or "agents" (extract oversized reference sections into agent-notes/, link orphan agent-notes, embed the managed lessons block, and — draft only — rewrite over-long subagent descriptions or add a boundary skeleton). Every write goes to a backup that can be undone. Call it when the user says "optimize/fix/clean up my skills" or "optimize/fix/clean up my 说明书/子代理定义", "apply the suggestions", "make the catalog cheaper", or wants to preview the fixes first (dryRun=true). safeOnly=true (default) applies only content-lossless auto actions; draft actions are skipped unless safeOnly=false. Pass names/ids and/or actionIds to narrow the scope. dryRun defaults to true and returns the plan without writing; pass dryRun=false to apply (after the user confirms).',
    {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: ['skills', 'agents'], description: 'Required: which surface to optimize.' },
        names: { type: 'array', items: { type: 'string' }, description: 'Skill names to optimize (skills surface).' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Subject ids to optimize (agents surface).' },
        actionIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these suggestion ids (from dsh360_scan detail="full").' },
        safeOnly: { type: 'boolean', description: 'Only auto (content-lossless) actions. Defaults to true.' },
        dryRun: { type: 'boolean', description: 'Return the plan without writing anything. Defaults to true; pass false to write.' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const surface = requireSingleSurface(args && args.surface);
      return surfaces[surface].optimize({
        names: args && args.names,
        ids: args && args.ids,
        actionIds: args && args.actionIds,
        safeOnly: args && args.safeOnly,
        dryRun: args && args.dryRun,
      });
    },
  );

  const evolveTool = defineTool(
    'dsh360_evolve',
    'Write a hard-won lesson back into a subject so the next load reads it. "surface" is required: "skills" writes into a skill\'s references/lessons.md; "agents" writes into a subject\'s managed lessons block (.agents-360/lessons.md). Call it when the user says a skill or an instruction file / subagent definition just got it wrong, corrected you, or asked you to remember this rule; or when dsh360_scan shows an unclosed evolution signal (corrections, post-load errors, reloads, turn failures) with no matching lesson yet. The signal and evidence are supplied by the plugin from local session logs; you write the lesson text (trigger -> concrete rule). dryRun defaults to true: it lists pending proposals (only hasUnclosed subjects, <=10, highest pendingScore first, optionally filtered by names/ids) without writing. Pass dryRun=false with name/id + lesson to write, which returns backupId/beforeTotal/afterTotal/evolution.',
    {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: ['skills', 'agents'], description: 'Required: which surface to evolve.' },
        names: { type: 'array', items: { type: 'string' }, description: 'Only list proposals for these skill names (skills, dryRun mode).' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Only list proposals for these subject ids (agents, dryRun mode).' },
        name: { type: 'string', description: 'Skill to write a lesson for (skills, required when dryRun=false).' },
        id: { type: 'string', description: 'Subject id to write a lesson for (agents, required when dryRun=false).' },
        lesson: { type: 'object', description: '{ trigger, rule, evidence? } — trigger and rule required; evidence optional.' },
        dryRun: { type: 'boolean', description: 'Default true: list proposals. false writes a lesson.' },
        cwd: { type: 'string', description: 'Absolute workspace path for project-local skills (skills surface).' },
      },
      additionalProperties: false,
    },
    async (args) => {
      const surface = requireSingleSurface(args && args.surface);
      const target = surfaces[surface];
      const dryRun = !args || args.dryRun !== false;
      if (dryRun) {
        return target.evolveProposals({
          names: args && args.names,
          ids: args && args.ids,
          cwd: optionalToolCwd(args),
        });
      }
      return target.evolveWrite({
        name: args && args.name,
        id: args && args.id,
        lesson: args && args.lesson,
        cwd: optionalToolCwd(args),
      });
    },
  );

  return [scanTool, reportTool, optimizeTool, evolveTool];
}

async function saveMergedReport(reportDir, markdown) {
  await mkdir(reportDir, { recursive: true });
  const filename = `dsh-360-${stampFor(new Date())}.md`;
  const target = join(reportDir, filename);
  await writeFile(target, markdown, 'utf8');
  return target;
}

// ------------------------------------------------------------------ health

function resolveConnection(ctx) {
  try {
    return ctx.get('connection');
  } catch {
    return undefined;
  }
}

function sendJson(res, method, status, payload) {
  const text = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (method !== 'HEAD') headers['content-length'] = String(Buffer.byteLength(text, 'utf8'));
  res.writeHead(status, headers);
  if (method === 'HEAD') res.end();
  else res.end(text);
}

function createHealthHandler(ctx) {
  return async (req, res) => {
    const method = req.method || 'GET';
    const headers = req.headers || {};
    try {
      let pathname = '/';
      try {
        pathname = new URL(req.url || '/', 'http://' + (headers.host || '127.0.0.1')).pathname;
      } catch {
        // Malformed URL falls through to the not-found branch below.
      }
      const connection = resolveConnection(ctx);
      if (!connection || typeof connection.requestRejection !== 'function') {
        return sendJson(res, method, 503, {
          ok: false,
          error: { message: 'The dsh-360 health route needs the Harness connection service.', code: 'unavailable' },
        });
      }
      const rejection = connection.requestRejection({ headers });
      if (rejection) {
        return sendJson(res, method, rejection, { ok: false, error: { message: 'Unauthorized', code: 'unauthorized' } });
      }
      if (pathname !== HEALTH_PREFIX) {
        return sendJson(res, method, 404, { ok: false, error: { message: 'Not found', code: 'not-found' } });
      }
      if (method !== 'GET' && method !== 'HEAD') {
        return sendJson(res, method, 405, { ok: false, error: { message: 'Method not allowed', code: 'invalid-argument' } });
      }
      return sendJson(res, method, 200, {
        ok: true,
        data: { version: VERSION, surfaces: ['skills', 'agents'] },
      });
    } catch (error) {
      return sendJson(res, method, 500, {
        ok: false,
        error: { message: (error && error.message) || String(error), code: 'internal' },
      });
    }
  };
}

// ------------------------------------------------------------------ plugin

export const inject = ['skills', 'tools', 'webServer'];

export function apply(ctx, config = {}) {
  const normalized = normalizeConfig(config);
  const dshHome = resolveDshHome();
  const dataDir = join(dshHome, 'dsh-360');
  const base = {
    home: dshHome,
    dataDir,
    backupDir: join(dataDir, 'backups'),
    reportDir: join(dataDir, 'reports'),
    statePath: join(dataDir, 'state.json'),
  };

  // State is split per surface: both halves rewrite the whole file on save, so a
  // shared state.json could lose the other surface's slice when the panel loads
  // both tabs at once.
  const skillsSurface = createSkillsSurface({
    ctx,
    config: normalized,
    paths: {
      ...base,
      backupDir: join(base.backupDir, 'skills'),
      statePath: join(dataDir, 'state.skills.json'),
    },
  });
  const agentsSurface = createAgentsSurface({
    ctx,
    config: normalized,
    paths: {
      ...base,
      backupDir: join(base.backupDir, 'agents'),
      statePath: join(dataDir, 'state.agents.json'),
    },
  });
  const surfaces = { skills: skillsSurface, agents: agentsSurface };

  for (const surface of [skillsSurface, agentsSurface]) {
    for (const route of surface.routes) {
      ctx.effect(() => ctx.webServer.register(route));
    }
  }
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: HEALTH_PREFIX,
      handler: createHealthHandler(ctx),
    }),
  );

  for (const definition of createTools(surfaces, base.reportDir)) {
    ctx.effect(() => ctx.tools.register(definition));
  }

  if (normalized.warmup) {
    const timer = setTimeout(() => {
      (async () => {
        for (const surface of [skillsSurface, agentsSurface]) {
          try {
            await surface.scan({});
          } catch {
            // Warm-up is best-effort: a failed scan must never surface at boot.
          }
        }
      })();
    }, 1500);
    timer.unref?.();
    ctx.effect(() => () => clearTimeout(timer));
  }
}
