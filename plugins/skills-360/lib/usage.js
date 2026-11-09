/**
 * Skill usage evidence from the local session log.
 *
 * DSH persists sessions as `session*.jsonl.zstd` (zstd frames) under
 * `<DSH_HOME>/sessions/<workspace>/<session-id>/`. We only need one signal:
 * how many times the model actually loaded each skill through the `skill`
 * tool. Everything else (tokens, turns) is out of scope.
 *
 * Failure is contained: a corrupt or unreadable file is skipped, never fatal.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const DAY_MS = 86_400_000;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const MAX_DECOMPRESSED = 64 * 1024 * 1024;

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CORRECTION_RE = /不对|错了|不是这个|不是这样|我是说|我说的是|应该是|重新做|重来|别这样|搞错|纠正|actually|that's not|not what I|wrong|instead/i;
const MAX_SAMPLES = 6;
const MAX_PROMPTS = 8;
const PROMPT_MAX = 400;
// A post-load signal only counts while the load is plausibly still driving the
// work. Without a bound, a tool error hours later in the same session (an
// unrelated task) would be blamed on the skill.
const SIGNAL_WINDOW_MS = 120 * 60 * 1000;
const MAX_TRACKED_CALLS = 80;

function oneLine(text, max) {
  const cleaned = String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/** Best-effort extraction of a user message's plain text. */
function userMessageText(entry) {
  const data = entry?.data || {};
  if (typeof data.message === 'string') return data.message;
  if (typeof data.text === 'string') return data.text;
  if (Array.isArray(data.content)) {
    return data.content
      .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
      .join('\n');
  }
  return '';
}

/** Best-effort extraction of an error result's plain text. */
function errorResultText(entry) {
  const message = entry?.data?.message || {};
  if (message.isError !== true) return null;
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  if (Array.isArray(message.content)) {
    return message.content
      .map((block) => (typeof block === 'string' ? block : (block && typeof block.text === 'string' ? block.text : '')))
      .join('\n');
  }
  return '';
}

function withinLoadWindow(loadAt, time) {
  if (time == null || loadAt == null) return true;
  return time >= loadAt && time - loadAt <= SIGNAL_WINDOW_MS;
}

function newSignalRecord() {
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

function pushSample(record, kind, at, sessionId, excerptText) {
  record.samples.unshift({ kind, at: at || null, sessionId: sessionId || '', excerpt: oneLine(excerptText, 160) });
  if (record.samples.length > MAX_SAMPLES) record.samples.length = MAX_SAMPLES;
  if (at && (record.lastSignalAt === null || at > record.lastSignalAt)) record.lastSignalAt = at;
}

/**
 * Decompress a buffer that may contain several concatenated zstd frames.
 * Node's zstd API decodes one frame; DSH appends frames during long sessions.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decompressZstd(buffer) {
  // Node decodes only the FIRST frame of a concatenated stream without
  // throwing, so a multi-frame session silently loses everything after the
  // first chunk. Count frames first and always walk them when there is more
  // than one.
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
      // A magic-number coincidence inside a frame: extend the slice to the
      // next candidate boundary and retry.
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
 * @param {{sessionsDir:string, windowDays?:number, now?:number}} options
 * @returns {Promise<{byName:Record<string,{count:number,lastUsedAt:number|null}>, sessionsScanned:number, filesConsidered:number, skipped:number, available:boolean}>}
 */
export async function collectUsage({ sessionsDir, windowDays = 30, now = Date.now() }) {
  const byName = Object.create(null);
  const catalog = Object.create(null);
  const signals = Object.create(null);
  const prompts = Object.create(null);
  if (!sessionsDir) {
    return {
      byName, catalog, signals, prompts,
      sessionsScanned: 0, filesConsidered: 0, skipped: 0, available: false,
    };
  }
  const cutoff = now - Math.max(1, windowDays) * DAY_MS;
  const files = await listSessionFiles(sessionsDir);
  let sessionsScanned = 0;
  let filesConsidered = 0;
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
    filesConsidered += 1;
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
    let counted = false;
    const catalogNames = new Set();

    // Per-session evolution state (SPEC §2). `sessionId` is the session
    // directory name; `lastLoaded` is the most recently loaded skill so
    // post-load signals can be attributed without a callId round-trip.
    const sessionId = basename(dirname(file));
    const loadedThisSession = new Set();
    const sessionLoadAt = new Map();
    const callNames = new Map();
    let lastLoaded = null;
    let lastUserMessage = null;

    for (const line of text.split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry) continue;
      const type = entry.type;
      const time = Number(entry.time) || null;

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
        // Only a real user turn can be a load trigger or a correction. The
        // harness also persists injected context as `user/message` entries
        // (time-context, runtime-context, agent-instructions); treating those
        // as user prompts polluted promptRecall with boilerplate. Sessions
        // written before `source.kind` existed have no kind — keep them.
        if (sourceKind && sourceKind !== 'user') continue;
        // Real user message (not the injected catalog/context).
        lastUserMessage = { time, text: userMessageText(entry) };
        if (lastLoaded) {
          const message = lastUserMessage.text;
          const sig = signals[lastLoaded];
          if (sig && message.length <= 600 && !message.includes('system-reminder')
            && CORRECTION_RE.test(message) && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
            sig.corrections += 1;
            pushSample(sig, 'correction', time, sessionId, message);
          }
        }
        continue;
      }

      if (type === 'tool/call') {
        const callId = entry.data?.callId;
        const callName = entry.data?.name;
        if (typeof callId === 'string' && typeof callName === 'string') {
          callNames.set(callId, callName);
          if (callNames.size > MAX_TRACKED_CALLS) callNames.delete(callNames.keys().next().value);
        }
      }

      if (type === 'tool/call' && entry.data?.name === 'skill') {
        let args;
        try {
          args = JSON.parse(entry.data.arguments || '{}');
        } catch {
          continue;
        }
        const skillName = typeof args?.name === 'string' ? args.name : '';
        if (!KEBAB_RE.test(skillName)) continue;
        const record = byName[skillName] || (byName[skillName] = { count: 0, lastUsedAt: null });
        record.count += 1;
        if (time && (record.lastUsedAt === null || time > record.lastUsedAt)) record.lastUsedAt = time;
        const sig = signals[skillName] || (signals[skillName] = newSignalRecord());
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
        // Record the real user message that preceded this load as a prompt.
        if (lastUserMessage) {
          const list = prompts[skillName] || (prompts[skillName] = []);
          list.push({ at: lastUserMessage.time, sessionId, text: oneLine(lastUserMessage.text, PROMPT_MAX) });
        }
        lastLoaded = skillName;
        counted = true;
        continue;
      }

      if (type === 'tool/result') {
        const errorText = errorResultText(entry);
        const sig = lastLoaded ? signals[lastLoaded] : null;
        if (errorText !== null && sig && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
          const resultMessage = entry.data?.message || {};
          const callId = resultMessage.toolCallId || resultMessage.source?.callId;
          const toolName = callId ? callNames.get(callId) : null;
          sig.postLoadErrors += 1;
          pushSample(sig, 'error', time, sessionId, toolName ? `[${toolName}] ${errorText}` : errorText);
        }
        continue;
      }

      if (type === 'tool/call' && entry.data?.name === 'ask_user_question' && lastLoaded) {
        const sig = signals[lastLoaded];
        if (sig && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
          sig.asks += 1;
          pushSample(sig, 'ask', time, sessionId, entry.data.arguments || '');
        }
        continue;
      }

      if (type === 'turn/end' && entry.data?.reason?.kind !== 'completed' && lastLoaded) {
        const sig = signals[lastLoaded];
        if (sig && withinLoadWindow(sessionLoadAt.get(lastLoaded), time)) {
          sig.turnFailures += 1;
          pushSample(sig, 'turn-failure', time, sessionId, entry.data?.reason?.kind || '');
        }
      }
    }

    for (const name of catalogNames) {
      if (catalog[name]) catalog[name].sessions += 1;
    }
    if (counted || text.length > 0) sessionsScanned += 1;
  }

  // Newest-first, de-duplicated, capped prompt lists.
  for (const name of Object.keys(prompts)) {
    const list = prompts[name];
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
    prompts[name] = out;
  }

  return {
    byName,
    catalog,
    signals,
    prompts,
    sessionsScanned,
    filesConsidered,
    skipped,
    available: sessionsScanned > 0,
    spanDays: earliest > 0 ? Math.max(0, Math.round((latest - earliest) / DAY_MS)) : 0,
  };
}
