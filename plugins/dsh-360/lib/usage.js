/**
 * One shared session-log scan for both dsh-360 surfaces (skills + agents).
 *
 * DSH persists sessions as `session*.jsonl.zstd` (concatenated zstd frames,
 * magic `28 B5 2F FD`) under `<DSH_HOME>/sessions/<workspace>/<session-id>/`,
 * plus plain `*.jsonl`. A single pass extracts the union digest:
 *
 *   skills surface:
 *   - skill loads:       `tool/call` with `data.name === 'skill'` → `arguments.name`
 *   - per-skill signals: corrections / post-load errors / reloads / asks / turn
 *                        failures attributed to the most recently loaded skill,
 *                        within a 120-minute load window
 *   - load prompts:      the real user message that preceded each skill load
 *   - catalog exposure:  `user/message` with `source.kind === 'skill-catalog'`
 *
 *   agents surface:
 *   - injection:  `Instructions from: <path>` inside system/user message text
 *   - preset:     `agent-preset/selected` + the first-frame `agentPreset`
 *   - delegation: `subagent/catalog` `data.label`
 *   - model:      `request/header` `data.header.config.model`
 *
 * Failure is contained: a corrupt or unreadable file is skipped, never fatal.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

const DAY_MS = 86_400_000;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const MAX_DECOMPRESSED = 64 * 1024 * 1024;
const MAX_SAMPLES = 6;
const MAX_PROMPTS = 8;
const PROMPT_MAX = 400;
// A post-load signal only counts while the load is plausibly still driving the
// work. Without a bound, a tool error hours later in the same session (an
// unrelated task) would be blamed on the skill.
const SIGNAL_WINDOW_MS = 120 * 60 * 1000;
const MAX_TRACKED_CALLS = 80;

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CORRECTION_RE = /不对|错了|不是这个|不是这样|我是说|我说的是|应该是|重新做|重来|别这样|搞错|纠正|actually|that's not|not what I|wrong|instead/i;
const INJECTION_RE = /Instructions from:\s*([^\s\n]+)/g;

const HOME = homedir();

/** Expand `~/…` to an absolute path; leave absolute paths untouched. */
export function normalizeInjectionPath(value) {
  let path = String(value || '').trim();
  if (!path) return '';
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) {
    path = join(HOME, path.slice(2));
  }
  return path;
}

function oneLine(text, max) {
  const cleaned = String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/** Concatenate every text block inside a message-shaped entry. */
function messageText(entry) {
  const data = entry?.data || {};
  let container = data.message ?? data;
  const parts = [];
  const push = (block) => {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block.text === 'string') parts.push(block.text);
  };
  if (Array.isArray(container?.content)) {
    for (const block of container.content) push(block);
  } else if (typeof container?.content === 'string') {
    parts.push(container.content);
  } else if (typeof data.text === 'string') {
    parts.push(data.text);
  } else if (typeof data.message === 'string') {
    parts.push(data.message);
  }
  return parts.join('\n');
}

function userMessageText(entry) {
  const data = entry?.data || {};
  if (typeof data.message === 'string') return data.message;
  if (typeof data.text === 'string') return data.text;
  if (Array.isArray(data.content)) {
    return data.content.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join('\n');
  }
  return '';
}

function errorResultText(entry) {
  const message = entry?.data?.message || {};
  if (message.isError !== true) return null;
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  if (Array.isArray(message.content)) {
    return message.content.map((block) => (typeof block === 'string' ? block : (block && typeof block.text === 'string' ? block.text : ''))).join('\n');
  }
  return '';
}

/** Per-skill signal record (skills surface): carries load counts + timestamps. */
function newSkillSignalRecord() {
  return {
    loads: 0,
    sessions: 0,
    reloads: 0,
    postLoadErrors: 0,
    corrections: 0,
    asks: 0,
    turnFailures: 0,
    lastLoadAt: null,
    lastSignalAt: null,
    samples: [],
  };
}

/** Per-injection-path signal record (agents surface). */
function newPathSignalRecord() {
  return {
    sessions: 0, reloads: 0, postLoadErrors: 0, corrections: 0, asks: 0, turnFailures: 0,
    lastSignalAt: null, samples: [],
  };
}

function pushSample(record, kind, at, sessionId, excerptText) {
  record.samples.unshift({ kind, at: at || null, sessionId: sessionId || '', excerpt: oneLine(excerptText, 160) });
  if (record.samples.length > MAX_SAMPLES) record.samples.length = MAX_SAMPLES;
  if (at && (record.lastSignalAt === null || at > record.lastSignalAt)) record.lastSignalAt = at;
}

function withinLoadWindow(loadAt, time) {
  if (time == null || loadAt == null) return true;
  return time >= loadAt && time - loadAt <= SIGNAL_WINDOW_MS;
}

/**
 * Decompress a buffer that may contain several concatenated zstd frames.
 * Node's zstd API decodes one frame, so walk the magic markers explicitly.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decompressZstd(buffer) {
  const offsets = [];
  let cursor = 0;
  while (true) {
    const at = buffer.indexOf(ZSTD_MAGIC, cursor);
    if (at < 0) break;
    offsets.push(at);
    cursor = at + 4;
  }
  if (offsets.length === 0) throw new Error('not a zstd frame');
  if (offsets.length === 1) return zstdDecompressSync(buffer).toString('utf8');
  let output = '';
  let start = offsets[0];
  for (let i = 1; i <= offsets.length; i += 1) {
    const end = i < offsets.length ? offsets[i] : buffer.length;
    if (end <= start) continue;
    try {
      output += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8');
      start = end;
      if (output.length > MAX_DECOMPRESSED) break;
    } catch {
      // magic-number coincidence inside a frame: extend and retry on the next boundary
    }
  }
  if (start < buffer.length) {
    try {
      output += zstdDecompressSync(buffer.subarray(start)).toString('utf8');
    } catch {
      // contain the loss
    }
  }
  if (!output) throw new Error('unable to decompress zstd frames');
  return output;
}

async function listSessionFiles(root, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSessionFiles(path, depth + 1));
    } else if (entry.isFile() && /\.jsonl(?:\.zstd)?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Scan the session log once and return the union digest shared by both surfaces.
 * @param {{sessionsDir:string, windowDays?:number, now?:number}} options
 * @returns {Promise<{
 *   sessionsScanned:number, spanDays:number, available:boolean, skipped:number,
 *   sessions: object[], bySkill: object, signalsBySkill: object, promptsBySkill: object,
 *   signalsByPath: object, byPreset: object, catalog: object
 * }>}
 */
export async function collectUsage({ sessionsDir, windowDays = 30, now = Date.now() }) {
  const empty = {
    sessionsScanned: 0, spanDays: 0, available: false, skipped: 0,
    sessions: [],
    bySkill: Object.create(null),
    signalsBySkill: Object.create(null),
    promptsBySkill: Object.create(null),
    signalsByPath: Object.create(null),
    byPreset: Object.create(null),
    catalog: Object.create(null),
  };
  if (!sessionsDir) return empty;

  const cutoff = now - Math.max(1, windowDays) * DAY_MS;
  const files = await listSessionFiles(sessionsDir);
  const sessions = [];
  const bySkill = Object.create(null);
  const signalsBySkill = Object.create(null);
  const promptsBySkill = Object.create(null);
  const signalsByPath = Object.create(null);
  const byPreset = Object.create(null);
  const catalog = Object.create(null);
  let sessionsScanned = 0;
  let skipped = 0;
  let earliest = 0;
  let latest = 0;

  for (const file of files) {
    let info;
    try {
      info = await stat(file);
    } catch {
      skipped += 1;
      continue;
    }
    if (!info.isFile() || info.mtimeMs < cutoff) continue;
    if (earliest === 0 || info.mtimeMs < earliest) earliest = info.mtimeMs;
    if (info.mtimeMs > latest) latest = info.mtimeMs;
    let text;
    try {
      const buffer = await readFile(file);
      text = file.endsWith('.zstd') ? decompressZstd(buffer) : buffer.toString('utf8');
    } catch {
      skipped += 1;
      continue;
    }

    // ---- per-session state (both surfaces)
    const sessionId = basename(dirname(file));
    let cwd = '';
    let preset = '';
    let model = '';
    let startedAt = 0;
    const injectedSet = new Set();
    const delegatedLabels = [];
    const skillLoads = [];
    let toolErrors = 0;
    let corrections = 0;
    let asks = 0;
    let turnFailed = false;
    let sawRecord = false;

    // ---- per-session skills state (load-window attribution)
    const loadedThisSession = new Set();
    const sessionLoadAt = new Map();
    const callNames = new Map();
    const catalogNames = new Set();
    let lastLoaded = null;
    let lastUserMessage = null;

    for (const line of text.split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      sawRecord = true;
      const type = entry.type;
      // agents uses `|| 0` for startedAt; skills uses `|| null` so an absent
      // timestamp means "no load window bound" instead of "epoch 0".
      const time = Number(entry.time) || null;
      if (startedAt === 0 && time > 0) startedAt = time;

      // ------------------------------------------------------- session meta
      if (type === 'session') {
        cwd = typeof entry.cwd === 'string' ? entry.cwd : cwd;
        if (typeof entry.agentPreset === 'string' && entry.agentPreset) preset = entry.agentPreset;
        if (!startedAt && entry.createdAt) startedAt = Number(entry.createdAt) || startedAt;
        continue;
      }

      if (type === 'agent-preset/selected') {
        const value = entry.data?.agentPreset;
        if (typeof value === 'string' && value) preset = value;
        continue;
      }

      if (type === 'request/header') {
        const m = entry.data?.header?.config?.model;
        if (typeof m === 'string' && m) model = m;
        continue;
      }

      if (type === 'subagent/catalog') {
        const label = entry.data?.label;
        if (typeof label === 'string' && label) delegatedLabels.push(label);
        continue;
      }

      // ------------------------------------------------------------ messages
      if (type === 'system/message' || type === 'user/message' || type === 'developer/message') {
        const textBody = messageText(entry);
        if (textBody.includes('Instructions from:')) {
          INJECTION_RE.lastIndex = 0;
          let match;
          while ((match = INJECTION_RE.exec(textBody)) !== null) {
            const normalized = normalizeInjectionPath(match[1]);
            if (normalized) injectedSet.add(normalized);
          }
        }
        if (type === 'user/message') {
          const sourceKind = entry.data?.source?.kind;
          if (sourceKind === 'skill-catalog') {
            const entries = Array.isArray(entry.data.source.entries) ? entry.data.source.entries : [];
            for (const item of entries) {
              const name = item && typeof item.name === 'string' ? item.name : '';
              if (!name) continue;
              catalogNames.add(name);
              const record = catalog[name] || (catalog[name] = { firstSeen: null, lastSeen: null, sessions: 0 });
              if (time && (record.firstSeen === null || time < record.firstSeen)) record.firstSeen = time;
              if (time && (record.lastSeen === null || time > record.lastSeen)) record.lastSeen = time;
            }
            continue;
          }
          // Injected context (time-context, runtime-context, …) is not a real
          // turn and never becomes a prompt or a correction.
          if (sourceKind && sourceKind !== 'user') continue;
          const textMsg = userMessageText(entry);
          // agents: session-level correction count
          if (textMsg.length <= 600 && !textMsg.includes('system-reminder') && CORRECTION_RE.test(textMsg)) {
            corrections += 1;
          }
          // skills: remember the real user message for prompt recall + per-skill corrections
          lastUserMessage = { time, text: textMsg };
          if (lastLoaded) {
            const sig = signalsBySkill[lastLoaded];
            if (sig && textMsg.length <= 600 && !textMsg.includes('system-reminder')
              && CORRECTION_RE.test(textMsg) && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
              sig.corrections += 1;
              pushSample(sig, 'correction', time, sessionId, textMsg);
            }
          }
        }
        continue;
      }

      // ---------------------------------------------------------- tool calls
      if (type === 'tool/call') {
        const callId = entry.data?.callId;
        const callName = entry.data?.name;
        if (typeof callId === 'string' && typeof callName === 'string') {
          callNames.set(callId, callName);
          if (callNames.size > MAX_TRACKED_CALLS) callNames.delete(callNames.keys().next().value);
        }
        if (callName === 'skill') {
          let args;
          try {
            args = JSON.parse(entry.data.arguments || '{}');
          } catch {
            continue;
          }
          const skillName = typeof args?.name === 'string' ? args.name : '';
          if (KEBAB_RE.test(skillName)) {
            const record = bySkill[skillName] || (bySkill[skillName] = { count: 0, lastUsedAt: null });
            record.count += 1;
            if (time && (record.lastUsedAt === null || time > record.lastUsedAt)) record.lastUsedAt = time;
            const sig = signalsBySkill[skillName] || (signalsBySkill[skillName] = newSkillSignalRecord());
            sig.loads += 1;
            if (time) sessionLoadAt.set(skillName, time);
            if (time && (sig.lastLoadAt === null || time > sig.lastLoadAt)) sig.lastLoadAt = time;
            if (!loadedThisSession.has(skillName)) {
              loadedThisSession.add(skillName);
              sig.sessions += 1;
            } else {
              sig.reloads += 1;
              pushSample(sig, 'reload', time, sessionId, lastUserMessage?.text || `重复加载 ${skillName}`);
            }
            if (lastUserMessage) {
              const list = promptsBySkill[skillName] || (promptsBySkill[skillName] = []);
              list.push({ at: lastUserMessage.time, sessionId, text: oneLine(lastUserMessage.text, PROMPT_MAX) });
            }
            lastLoaded = skillName;
            skillLoads.push(skillName);
          }
          continue;
        }
        if (callName === 'ask_user_question') {
          asks += 1;
          const sig = lastLoaded ? signalsBySkill[lastLoaded] : null;
          if (sig && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
            sig.asks += 1;
            pushSample(sig, 'ask', time, sessionId, entry.data.arguments || '');
          }
        }
        continue;
      }

      // -------------------------------------------------------- tool results
      if (type === 'tool/result') {
        const errorText = errorResultText(entry);
        if (errorText !== null) {
          toolErrors += 1;
          const sig = lastLoaded ? signalsBySkill[lastLoaded] : null;
          if (sig && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
            const resultMessage = entry.data?.message || {};
            const callId = resultMessage.toolCallId || resultMessage.source?.callId;
            const toolName = callId ? callNames.get(callId) : null;
            sig.postLoadErrors += 1;
            pushSample(sig, 'error', time, sessionId, toolName ? `[${toolName}] ${errorText}` : errorText);
          }
        }
        continue;
      }

      // ------------------------------------------------------------ turn end
      if (type === 'turn/end' && entry.data?.reason?.kind !== 'completed') {
        turnFailed = true;
        const sig = lastLoaded ? signalsBySkill[lastLoaded] : null;
        if (sig && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
          sig.turnFailures += 1;
          pushSample(sig, 'turn-failure', time, sessionId, entry.data?.reason?.kind || '');
        }
      }
    }

    if (!sawRecord && text.length === 0) continue;
    sessionsScanned += 1;
    if (startedAt === 0) startedAt = info.mtimeMs;
    const injected = [...injectedSet];
    sessions.push({
      id: sessionId,
      cwd,
      preset,
      model,
      startedAt,
      injected,
      delegatedLabels,
      skillLoads,
      toolErrors,
      corrections,
      asks,
      turnFailed,
    });

    if (preset) {
      const record = byPreset[preset] || (byPreset[preset] = { sessions: 0, lastUsedAt: null });
      record.sessions += 1;
      if (startedAt && (record.lastUsedAt === null || startedAt > record.lastUsedAt)) record.lastUsedAt = startedAt;
    }

    for (const path of injected) {
      const sig = signalsByPath[path] || (signalsByPath[path] = newPathSignalRecord());
      sig.sessions += 1;
      sig.corrections += corrections;
      sig.postLoadErrors += toolErrors;
      sig.asks += asks;
      if (turnFailed) sig.turnFailures += 1;
      if (corrections > 0) pushSample(sig, 'correction', startedAt, sessionId, '用户纠错');
      if (toolErrors > 0) pushSample(sig, 'error', startedAt, sessionId, `工具报错 ${toolErrors} 次`);
      if (asks > 0) pushSample(sig, 'ask', startedAt, sessionId, `追问 ${asks} 次`);
      if (turnFailed) pushSample(sig, 'turn-failure', startedAt, sessionId, '回合未完成');
    }

    for (const name of catalogNames) {
      if (catalog[name]) catalog[name].sessions += 1;
    }
  }

  // Newest-first, de-duplicated, capped prompt lists.
  for (const name of Object.keys(promptsBySkill)) {
    const list = promptsBySkill[name];
    const seen = new Set();
    const out = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const prompt = list[i];
      const key = `${prompt.sessionId}\u0000${prompt.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(prompt);
      if (out.length >= MAX_PROMPTS) break;
    }
    promptsBySkill[name] = out;
  }

  return {
    sessionsScanned,
    spanDays: earliest > 0 ? Math.max(0, Math.round((latest - earliest) / DAY_MS)) : 0,
    available: sessionsScanned > 0,
    skipped,
    sessions,
    bySkill,
    signalsBySkill,
    promptsBySkill,
    signalsByPath,
    byPreset,
    catalog,
  };
}
