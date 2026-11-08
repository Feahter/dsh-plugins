/**
 * Archive store for `dsh-archive-rsi`: the read model of DSH's own session logs.
 *
 * DSH already writes every session to
 * `<dshHome>/sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd`, a
 * concatenation of independently decodable zstd frames (one per append). The
 * harness itself has no archive concept — no tags, no notes, no cross-session
 * view. This module adds that layer without ever touching the session files:
 * the only session-root operation is a read.
 *
 * Three things live here, in dependency order:
 * - Frame/decoding primitives (`scanZstdFrames`, `decodeSessionFile`), because
 *   `zstdDecompressSync` decodes exactly one frame and the container must be
 *   walked first.
 * - Pure projections over the decoded event log (`computeFacts`,
 *   `deriveTitle`, `renderTranscript`). No I/O, no clock: every number is
 *   derived from bytes that already exist on disk, so a re-run is identical.
 * - `ArchiveStore`, the durable index plus derived-file cache. Every write is
 *   a temp file renamed into place, so a reader never sees a half-written
 *   `archive.json`, and `sync()` is idempotent: a file whose bytes and mtime
 *   match the index is skipped, not re-decoded.
 *
 * Everything suspicious degrades instead of throwing: a missing `data`, a
 * `content` that is not an array, `arguments` that is not a string, a JSON
 * line that does not parse. One malformed session must never take down a
 * whole sync.
 *
 * Zero dependencies: `node:fs`, `node:path`, `node:crypto`, `node:zlib`,
 * `node:os` only. Contract: DESIGN.md §1-§4, §7.1, §8.
 */

import { readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

export const DEFAULT_EDIT_TOOLS = ['write', 'edit'];
export const DEFAULT_CHECK_TOOLS = ['bash', 'pwsh', 'bash_persistent'];

const INDEX_VERSION = 1;
const DEFAULT_MAX_TRANSCRIPT_BYTES = 262144;
const MAX_TRANSCRIPT_TITLE_CHARS = 80;
const MAX_HUMAN_TEXTS = 40;
const MAX_HUMAN_TEXT_CHARS = 400;
const MAX_ERROR_SAMPLES = 20;
const MAX_REPEATED = 10;
const MAX_TAGS = 24;
const MAX_TAG_CHARS = 32;
const MAX_NOTE_CHARS = 10_000;
const MAX_TITLE_CHARS = 200;
const MAX_CALL_PREVIEW = 200;
const TRANSCRIPT_CALL_PREVIEW = 120;
const TRANSCRIPT_BLOCK_CHARS = 4000;
const MARKER_RESERVE = 128;
const SESSION_FILE_RE = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/;

// ------------------------------------------------ contract patterns (§3, §5.1)

/** Tools whose `command` string can write a file (a shell edit is still an edit). */
const SHELL_TOOLS = new Set(['bash', 'pwsh', 'bash_persistent']);

/**
 * Does this shell command write a file?
 *
 * The naive `\b>\s*\S+` test that this replaced matched `2>/dev/null`, which
 * classified read-only sessions as "edited" and inflated `verificationGapRate`
 * (and therefore rule R4) on the real corpus. So: neutralise file-descriptor and
 * /dev/null redirections first, then require a real file target.
 */
function shellEdit(command) {
  if (typeof command !== 'string' || !command) return false;
  const cleaned = command
    .replace(/\d?>>?\s*\/dev\/null/g, ' ')
    .replace(/\d?>>?\s*&\d/g, ' ')
    .replace(/\d\s*>&\s*\d/g, ' ');
  if (/\btee\b|\bpatch\s+-p\d|git\s+apply|\bsed\s+-i|\bperl\s+-i/.test(cleaned)) return true;
  // `>` not preceded by an fd digit (`2>`) and not an fd duplication (`>&2`).
  return /(?<![0-9])>>?(?!&)\s*[^\s>|&]/.test(cleaned);
}

/** §3.1 verbatim: broad on purpose — "did anything re-run after the edit". */
const CHECK_PATTERN =
  /\b(?:test|tests|vitest|jest|pytest|mocha|ava|node|tsc|eslint|ruff|mypy|gofmt|go\s+test|cargo\s+(?:test|check)|make|cmake|ninja|pnpm|npm|yarn|bun|deno|swift|gradle|mvn|shellcheck|prettier|--check)\b/i;

/**
 * §5.1 CORRECTION_PATTERN. Lives in `alchemy.js` per the module split, but the
 * index entry already carries `metrics.corrections` (§2.1), so the match runs
 * here too. Per-session contribution is capped at 3.
 */
const CORRECTION_PATTERN =
  /(?:^|\s)(?:no[,.!]?\s|nope\b|wrong\b|incorrect\b|that's not|not what I|revert|undo that|try again|still (?:broken|failing|wrong)|didn'?t work)/i;
const CORRECTION_PATTERN_CJK =
  /(?:不对|不是这样|错了|搞错|重来|重新来|还是不行|没有用|别这么做|我说的不是|你又)/;
const CORRECTION_CAP_PER_SESSION = 3;

const ZSTD_MAGIC = 4247762216; // 0xFD2FB528, little-endian on disk
const ZSTD_BLOCK_HASH = 3; // reserved block type

// ------------------------------------------------------------------ helpers

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function finiteOr(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function expandHome(input) {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return path.join(homedir(), input.slice(2));
  return input;
}

/** `$DSH_HOME` when set, else `~/.dsh`. */
function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(expandHome(fromEnv.trim()));
  return path.join(homedir(), '.dsh');
}

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function jsonBytes(value) {
  if (value === undefined) return 0;
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? Buffer.byteLength(text) : 0;
  } catch {
    return 0;
  }
}

function collapseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function firstLine(text) {
  const lines = String(text).split('\n');
  for (const line of lines) if (line.trim()) return line;
  return '';
}

/** Text blocks only: reasoning never reaches a title or a transcript. */
function messageText(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (isObject(block) && block.type === 'text' && typeof block.text === 'string' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

function firstTextBlock(content) {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (isObject(block) && block.type === 'text' && typeof block.text === 'string' && block.text) {
      return block.text;
    }
  }
  return '';
}

function isHumanMessage(data) {
  return isObject(data) && isObject(data.source) && data.source.kind === 'user';
}

function argString(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

/**
 * `argKey` (§3.1): first 12 hex chars of sha256 over the arguments string with
 * whitespace runs collapsed. Non-string arguments are stringified first.
 */
function argumentKey(value) {
  const text = argString(value).replace(/\s+/g, ' ').trim();
  return sha256(text).slice(0, 12);
}

/** Parse tool-call arguments; unparsable JSON degrades to `null`, never throws. */
function parseArguments(value) {
  if (isObject(value)) return value;
  const text = argString(value);
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The `command` a shell-ish call runs, or the raw arguments as a last resort. */
function commandOf(data) {
  const args = parseArguments(data && data.arguments);
  if (args) return stringOr(args.command ?? args.cmd ?? args.script, '');
  return argString(data && data.arguments);
}

function stepKeyOf(data) {
  const turn = finiteOr(data && data.turn, -1);
  const step = finiteOr(data && data.step, -1);
  return `${turn}:${step}`;
}

function correctionMatches(text) {
  const value = String(text || '');
  return CORRECTION_PATTERN.test(value) || CORRECTION_PATTERN_CJK.test(value);
}

function shortSessionId(id) {
  const text = String(id || '').replace(/^session-/, '');
  return text.slice(0, 8);
}

function isoFromMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString();
}

function nowIsoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeFileName(id, kind) {
  const raw = String(id || '').trim();
  const base = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120);
  if (!base) throw new Error(`invalid ${kind} id: ${JSON.stringify(id)}`);
  const prefix = `${kind}-`;
  return base.startsWith(prefix) ? base : `${prefix}${base}`;
}

// ------------------------------------------------------------- frame scanner

/**
 * Locate complete zstd frames without decompressing their blocks.
 *
 * Ported from `scanZstdFrames` in `@deepseek-ai/dsh-session-persistence-jsonl`
 * (its `lib/types/zstd.js`); that package does not export the function, which
 * is why this copy exists. A frame is magic LE `0xFD2FB528`, a descriptor byte,
 * optional window/dictionary/content-size header bytes, then 3-byte
 * little-endian block headers (`lastBlock = header & 1`,
 * `blockType = (header >>> 1) & 3`, payload = blockSize except type 1 = RLE =
 * 1 byte), then 4 checksum bytes when descriptor bit `0x04` is set.
 *
 * Invalid complete structure (bad magic, reserved header bit, reserved block
 * type) throws; EOF inside the final frame returns its start as `tornStart` so
 * a log being appended to is repairable instead of fatal.
 *
 * @param {Buffer} buffer raw bytes of one session log file
 * @param {number} [maxFrames] optional complete-frame limit
 * @returns {{ frames: Array<{start:number,end:number}>, tornStart?: number }}
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const frames = [];
  let offset = 0;
  while (offset < source.length) {
    const start = offset;
    if (source.length - offset < 4) return { frames, tornStart: start };
    if (source.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === source.length) return { frames, tornStart: start };
    const descriptor = source.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (source.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (source.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = source.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === ZSTD_BLOCK_HASH) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (source.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (source.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length === maxFrames) return { frames };
  }
  return { frames };
}

// --------------------------------------------------------------- decoding

function parseLogRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isObject(parsed)) rows.push(parsed);
    } catch {
      // A torn tail or a corrupt row is dropped; earlier rows already survived.
    }
  }
  return rows;
}

function splitHeader(rows) {
  const index = rows.findIndex((row) => row.type === 'session');
  if (index === -1) {
    const error = new Error('corrupt session log: no session header row');
    error.code = 'no-session-header';
    throw error;
  }
  const header = rows[index];
  const events = rows.slice(0, index).concat(rows.slice(index + 1));
  return { header, events };
}

/**
 * Decode a raw session payload (zstd-framed or plain JSONL) into header and
 * events. Frames are decoded one at a time; a frame that fails at the tail is
 * treated as torn (its start is reported and earlier frames are kept), while a
 * failure in the middle is real corruption and throws.
 */
function decodeBytes(bytes, file = '') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const label = file ? path.basename(file) : 'session log';
  const framed = buffer.length >= 4 && buffer.readUInt32LE(0) === ZSTD_MAGIC;
  let frames = [];
  let tornStart;
  let text = '';
  if (framed) {
    const scan = scanZstdFrames(buffer);
    tornStart = scan.tornStart;
    const decoded = [];
    for (let index = 0; index < scan.frames.length; index += 1) {
      const frame = scan.frames[index];
      try {
        decoded.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
        frames.push(frame);
      } catch (error) {
        const isTail = index === scan.frames.length - 1;
        if (!isTail) {
          throw new Error(
            `corrupt Zstandard session log ${label}: frame at byte ${frame.start} failed to decode`,
            { cause: error },
          );
        }
        // Tail may be a partially flushed frame: keep everything before it.
        if (tornStart === undefined) tornStart = frame.start;
        break;
      }
    }
    text = Buffer.concat(decoded).toString('utf8');
  } else {
    text = buffer.toString('utf8');
  }
  const rows = parseLogRows(text);
  const { header, events } = splitHeader(rows);
  const decoded = { header, events, frames };
  if (tornStart !== undefined) decoded.tornStart = tornStart;
  return decoded;
}

/**
 * Read and decode one session log file.
 *
 * @param {string} file absolute path to `session.v4.jsonl.zstd` or a plain
 *   `session.v4.jsonl`
 * @returns {{ header: object, events: object[], frames: Array<{start:number,end:number}>,
 *   tornStart?: number }}
 */
export function decodeSessionFile(file) {
  return decodeBytes(readFileSync(file), file);
}

// ------------------------------------------------------------------- titles

/**
 * Session title: the last `session/title` event wins, then the first real
 * human message (first text block, first line, collapsed, <= 80 chars), then
 * `Untitled (<short id>)`. Harness-injected user messages never title a
 * session — only `source.kind === 'user'` is human input.
 *
 * @param {{ header?: object, events?: object[] }} input
 * @returns {string}
 */
export function deriveTitle({ header, events } = {}) {
  const head = isObject(header) ? header : {};
  const list = Array.isArray(events) ? events : [];
  let titled = '';
  for (const event of list) {
    if (!isObject(event) || event.type !== 'session/title') continue;
    const title = isObject(event.data) ? event.data.title : undefined;
    if (typeof title === 'string' && title.trim()) titled = collapseWhitespace(title);
  }
  if (titled) return titled.slice(0, MAX_TRANSCRIPT_TITLE_CHARS);
  for (const event of list) {
    if (!isObject(event) || event.type !== 'user/message') continue;
    if (!isHumanMessage(event.data)) continue;
    const block = firstTextBlock(event.data.content);
    if (!block) continue;
    const line = collapseWhitespace(firstLine(block));
    if (line) return line.slice(0, MAX_TRANSCRIPT_TITLE_CHARS);
  }
  return `Untitled (${shortSessionId(head.id) || 'unnamed'})`;
}

// -------------------------------------------------------------------- facts

function emptyToolRow(name) {
  return {
    name,
    calls: 0,
    errors: 0,
    errorCodes: {},
    resultBytes: 0,
    inputBytes: 0,
    firstSeq: 0,
    lastSeq: 0,
  };
}

function bumpCode(row, code) {
  const key = code || 'unknown';
  row.errorCodes[key] = (row.errorCodes[key] || 0) + 1;
}

function resultIsError(data) {
  const message = isObject(data) && isObject(data.message) ? data.message : {};
  if (message.isError === true) return true;
  if (message.isError === false) return false;
  return isObject(data) && isObject(data.error);
}

/**
 * Compute the `SessionFacts` contract (DESIGN §3) for one decoded session.
 *
 * Pure: no I/O, no clock, no randomness. Percentiles and medians belong to
 * `alchemy.js`; this only emits raw per-session values. Every suspicious shape
 * (missing `data`, `content` not an array, `arguments` not a string, invalid
 * JSON) degrades to a zero or empty value instead of throwing.
 *
 * @param {{ header?: object, events?: object[], file?: string, slug?: string,
 *   editTools?: string[], checkTools?: string[] }} input `editTools` and
 *   `checkTools` default to the §3.1 lists; the store passes its configured
 *   ones so `config.editTools` reaches the numbers.
 * @returns {object} SessionFacts
 */
export function computeFacts({
  header,
  events,
  file = '',
  slug = '',
  editTools = DEFAULT_EDIT_TOOLS,
  checkTools = DEFAULT_CHECK_TOOLS,
} = {}) {
  const head = isObject(header) ? header : {};
  const rows = (Array.isArray(events) ? events : []).filter(
    (event) => isObject(event) && event.type !== 'session',
  );

  const sessionId = stringOr(head.id, '');
  const createdAt = finiteOr(head.createdAt, 0);
  let lastTime = createdAt;
  for (const event of rows) {
    const time = finiteOr(event.time, 0);
    if (time > lastTime) lastTime = time;
  }

  const counters = {
    events: rows.length,
    turns: 0,
    steps: 0,
    userMessages: 0,
    humanMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
    llmRetries: 0,
    subagentDescriptors: 0,
    teamTasks: 0,
    approvals: 0,
    commands: 0,
    interrupts: 0,
    compactions: 0,
  };

  const turnSet = new Set();
  const stepSet = new Set();
  const turnStarts = new Map();
  const turnEnds = new Map();
  const stepStarts = new Map();
  const stepEnds = new Map();
  const turnEndsByKind = {};
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
  let peakInputTokens = 0;
  let contextWindow = 0;
  let interrupted = false;

  const tools = new Map();
  const callsById = new Map();
  const repeated = new Map();
  const humanTexts = [];
  const editSeqs = [];
  const editByTool = {};
  const checkSeqs = [];
  const errorSamples = [];

  const toolRow = (name) => {
    const key = name || 'unknown';
    let row = tools.get(key);
    if (!row) {
      row = emptyToolRow(key);
      tools.set(key, row);
    }
    return row;
  };

  // Pass 1: calls. Rows, edit/check predicates, repetition keys.
  for (const event of rows) {
    const data = isObject(event.data) ? event.data : {};
    const seq = finiteOr(event.seq, 0);
    // A turn/step is identified wherever it is carried, not only on its own
    // boundary event: a log cut mid-turn still reports the turns it reached.
    if (typeof data.turn === 'number' && Number.isFinite(data.turn)) {
      turnSet.add(data.turn);
      if (typeof data.step === 'number' && Number.isFinite(data.step)) stepSet.add(stepKeyOf(data));
    }
    switch (event.type) {
      case 'turn/start': {
        const turn = finiteOr(data.turn, -1);
        if (turn >= 0) {
          turnSet.add(turn);
          if (!turnStarts.has(turn)) turnStarts.set(turn, finiteOr(event.time, 0));
        }
        break;
      }
      case 'turn/end': {
        const turn = finiteOr(data.turn, -1);
        if (turn >= 0) {
          turnSet.add(turn);
          turnEnds.set(turn, finiteOr(event.time, 0));
        }
        const kind = isObject(data.reason) ? stringOr(data.reason.kind, 'unknown') : 'unknown';
        turnEndsByKind[kind] = (turnEndsByKind[kind] || 0) + 1;
        if (kind === 'interrupted') {
          counters.interrupts += 1;
          interrupted = true;
        }
        break;
      }
      case 'step/start': {
        const key = stepKeyOf(data);
        stepSet.add(key);
        if (!stepStarts.has(key)) stepStarts.set(key, finiteOr(event.time, 0));
        break;
      }
      case 'step/end': {
        stepSet.add(stepKeyOf(data));
        stepEnds.set(stepKeyOf(data), finiteOr(event.time, 0));
        break;
      }
      case 'user/message': {
        counters.userMessages += 1;
        if (isHumanMessage(data)) {
          counters.humanMessages += 1;
          const text = messageText(data.content);
          if (text) {
            humanTexts.push({
              seq,
              chars: text.length,
              text: text.slice(0, MAX_HUMAN_TEXT_CHARS),
            });
          }
        }
        break;
      }
      case 'assistant/message': {
        counters.assistantMessages += 1;
        if (isObject(data.usage)) {
          for (const key of Object.keys(usage)) {
            const value = data.usage[key];
            if (typeof value === 'number' && Number.isFinite(value)) usage[key] += value;
          }
          const input = finiteOr(data.usage.inputTokens, 0);
          if (input > peakInputTokens) peakInputTokens = input;
        }
        if (data.interrupted === true) {
          counters.interrupts += 1;
          interrupted = true;
        }
        break;
      }
      case 'tool/call': {
        counters.toolCalls += 1;
        const name = stringOr(data.name, 'unknown');
        const row = toolRow(name);
        row.calls += 1;
        row.inputBytes += Buffer.byteLength(argString(data.arguments));
        row.firstSeq = row.firstSeq === 0 || (seq > 0 && seq < row.firstSeq) ? seq : row.firstSeq;
        row.lastSeq = seq > row.lastSeq ? seq : row.lastSeq;
        const callId = stringOr(data.callId, '');
        if (callId) {
          callsById.set(callId, {
            name,
            seq,
            preview: argString(data.arguments).slice(0, MAX_CALL_PREVIEW),
          });
        }
        if (name) {
          const key = `${name}\u0000${argumentKey(data.arguments)}`;
          const bucket = repeated.get(key);
          if (bucket) {
            bucket.times += 1;
            bucket.seqs.push(seq);
          } else {
            repeated.set(key, { name, argKey: key.split('\u0000')[1], times: 1, seqs: [seq] });
          }
        }
        const command = commandOf(data);
        if (Array.isArray(editTools) && editTools.includes(name)) {
          editSeqs.push(seq);
          editByTool[name] = (editByTool[name] || 0) + 1;
        } else if (SHELL_TOOLS.has(name) && shellEdit(command)) {
          editSeqs.push(seq);
          editByTool[name] = (editByTool[name] || 0) + 1;
        }
        if (Array.isArray(checkTools) && checkTools.includes(name) && CHECK_PATTERN.test(command)) {
          checkSeqs.push(seq);
        }
        break;
      }
      case 'tool/result': {
        counters.toolResults += 1;
        const message = isObject(data.message) ? data.message : {};
        const callId = stringOr(message.toolCallId, '');
        const call = callsById.get(callId);
        const contentBytes = jsonBytes(message.content);
        const failed = resultIsError(data);
        if (call) {
          const row = toolRow(call.name);
          row.resultBytes += contentBytes;
          if (failed) {
            row.errors += 1;
            const error = isObject(data.error) ? data.error : {};
            bumpCode(row, stringOr(error.code, stringOr(error.name, '')));
          }
        }
        if (failed) {
          counters.toolErrors += 1;
          const error = isObject(data.error) ? data.error : {};
          if (errorSamples.length < MAX_ERROR_SAMPLES) {
            errorSamples.push({
              seq,
              tool: call ? call.name : '',
              code: stringOr(error.code, stringOr(error.name, '')),
              reason: stringOr(error.reason, ''),
              callPreview: call ? call.preview : '',
            });
          }
        }
        break;
      }
      case 'request/context': {
        const window = finiteOr(data.contextWindow, 0);
        if (window > 0) contextWindow = window;
        break;
      }
      case 'llm/retry':
        counters.llmRetries += 1;
        break;
      case 'subagent/descriptor':
        counters.subagentDescriptors += 1;
        break;
      case 'team/task':
        counters.teamTasks += 1;
        break;
      case 'approval/asked':
        counters.approvals += 1;
        break;
      case 'command/run':
        counters.commands += 1;
        break;
      default:
        break;
    }
    if (typeof event.type === 'string' && /compact/i.test(event.type)) counters.compactions += 1;
  }

  counters.turns = turnSet.size || turnStarts.size;
  counters.steps = stepSet.size;

  // Pass 2: the last request/header and the last skill catalog.
  let catalog = { bytes: 0, toolCount: 0, tools: [] };
  let skillCatalog = { bytes: 0, entries: 0 };
  for (const event of rows) {
    if (event.type === 'request/header') {
      const toolsArray = isObject(event.data) && isObject(event.data.header) && Array.isArray(event.data.header.tools)
        ? event.data.header.tools
        : null;
      if (toolsArray) {
        catalog = {
          bytes: jsonBytes(toolsArray),
          toolCount: toolsArray.length,
          tools: toolsArray.map((tool) => {
            const name = isObject(tool) ? stringOr(tool.name, '') : '';
            const shape = isObject(tool)
              ? { name: tool.name, description: tool.description, parameters: tool.parameters }
              : null;
            return { name, bytes: jsonBytes(shape) };
          }),
        };
      }
    }
    if (event.type === 'user/message' && isObject(event.data) && isObject(event.data.source)) {
      if (event.data.source.kind === 'skill-catalog') {
        const entries = Array.isArray(event.data.source.entries) ? event.data.source.entries : [];
        skillCatalog = { bytes: jsonBytes(entries), entries: entries.length };
      }
    }
  }

  // Repetition: same name + the same argument key more than once.
  const repeatedRows = [];
  for (const bucket of repeated.values()) {
    if (bucket.times < 2) continue;
    repeatedRows.push({
      name: bucket.name,
      argKey: bucket.argKey,
      times: bucket.times,
      seqs: bucket.seqs.slice(),
    });
  }
  repeatedRows.sort((a, b) => (b.times - a.times) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Durations, from paired turn/step boundaries, falling back to the log span.
  let totalMs = 0;
  let maxTurnMs = 0;
  let pairedTurns = 0;
  for (const [turn, start] of turnStarts) {
    const end = turnEnds.get(turn);
    if (end === undefined) continue;
    const delta = end - start;
    if (delta < 0) continue;
    totalMs += delta;
    if (delta > maxTurnMs) maxTurnMs = delta;
    pairedTurns += 1;
  }
  if (pairedTurns === 0) totalMs = Math.max(0, lastTime - createdAt);
  let maxStepMs = 0;
  for (const [key, start] of stepStarts) {
    const end = stepEnds.get(key);
    if (end === undefined) continue;
    const delta = end - start;
    if (delta > maxStepMs) maxStepMs = delta;
  }

  const maxEditSeq = editSeqs.length ? Math.max(...editSeqs) : 0;
  const afterLastEditChecks = editSeqs.length
    ? checkSeqs.filter((seq) => seq > maxEditSeq).length
    : 0;

  const toolRows = [...tools.values()].sort(
    (a, b) => (b.calls - a.calls) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  return {
    sessionId,
    createdAt,
    endedAt: lastTime || createdAt,
    cwd: stringOr(head.cwd, ''),
    slug: stringOr(slug, ''),
    origin: stringOr(head.origin, ''),
    agentPreset: typeof head.agentPreset === 'string' ? head.agentPreset : null,
    parentSession: typeof head.parentSession === 'string' ? head.parentSession : null,
    delegationDepth: finiteOr(head.delegationDepth, 0),
    title: deriveTitle({ header: head, events: rows }),
    formatVersion: finiteOr(head.version, 0),
    counters,
    tools: toolRows,
    catalog,
    skillCatalog,
    repeated: repeatedRows.slice(0, MAX_REPEATED),
    humanTexts: humanTexts.slice(0, MAX_HUMAN_TEXTS),
    edits: {
      count: editSeqs.length,
      seqs: editSeqs.slice(),
      byTool: editByTool,
    },
    checks: {
      count: checkSeqs.length,
      seqs: checkSeqs.slice(),
      lastSeq: checkSeqs.length ? Math.max(...checkSeqs) : 0,
    },
    afterLastEditChecks,
    usage,
    contextWindow,
    peakInputTokens,
    peakContextRatio: contextWindow > 0 ? peakInputTokens / contextWindow : 0,
    turnEnds: turnEndsByKind,
    durations: { totalMs, maxTurnMs, maxStepMs },
    errorSamples,
    interrupted,
  };
}

// --------------------------------------------------------------- transcript

function transcriptHeader(facts) {
  const f = isObject(facts) ? facts : {};
  const counters = isObject(f.counters) ? f.counters : {};
  const usage = isObject(f.usage) ? f.usage : {};
  const ratio = finiteOr(f.peakContextRatio, 0);
  const lines = [
    `# ${stringOr(f.title, '') || stringOr(f.sessionId, '') || 'Session'}`,
    '',
    '| field | value |',
    '|---|---|',
    `| id | \`${stringOr(f.sessionId, '')}\` |`,
    `| preset | ${stringOr(f.agentPreset, '') || '—'} |`,
    `| origin | ${stringOr(f.origin, '') || '—'} |`,
    `| created | ${isoFromMs(finiteOr(f.createdAt, 0))} |`,
    `| turns | ${finiteOr(counters.turns, 0)} |`,
    `| tokens | ${finiteOr(usage.totalTokens, 0)} |`,
    `| peak context | ${ratio > 0 ? `${(ratio * 100).toFixed(1)}%` : '—'} |`,
    '',
    '## Timeline',
  ];
  return lines.join('\n');
}

function quoteBlock(text) {
  const capped = String(text).slice(0, TRANSCRIPT_BLOCK_CHARS);
  return `${capped.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
}

function toolLine(data, resultsByCall) {
  const name = stringOr(data.name, 'unknown');
  const args = argString(data.arguments);
  const preview = collapseWhitespace(args).slice(0, TRANSCRIPT_CALL_PREVIEW);
  const callId = stringOr(data.callId, '');
  const result = callId ? resultsByCall.get(callId) : undefined;
  const status = result
    ? result.isError
      ? `error(${result.code || 'error'})`
      : 'ok'
    : 'pending';
  const bytes = result ? result.bytes : 0;
  return `- \`${name}\` ${preview} → ${status} ${bytes}B\n`;
}

/**
 * Render the deterministic, capped Markdown transcript (DESIGN §4).
 *
 * Pure. Reasoning blocks and `request/header` events are never included. The
 * body is emitted in step-sized chunks and cut at a step boundary; when a cut
 * happens the last line is `… [truncated: N events omitted]`.
 *
 * @param {object} facts SessionFacts
 * @param {object[]} events decoded events (header excluded)
 * @param {{ maxBytes?: number }} [options]
 * @returns {string}
 */
export function renderTranscript(facts, events, { maxBytes = DEFAULT_MAX_TRANSCRIPT_BYTES } = {}) {
  const f = isObject(facts) ? facts : {};
  const rows = Array.isArray(events) ? events : [];
  const requested = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.floor(maxBytes)
    : DEFAULT_MAX_TRANSCRIPT_BYTES;
  // The header table is always kept; a caller passing an absurd cap gets 512B
  // rather than a file with no identity in it.
  const limit = Math.max(requested, 512);

  const resultsByCall = new Map();
  for (const event of rows) {
    if (!isObject(event) || event.type !== 'tool/result') continue;
    const data = isObject(event.data) ? event.data : {};
    const message = isObject(data.message) ? data.message : {};
    const callId = stringOr(message.toolCallId, '');
    if (!callId) continue;
    const error = isObject(data.error) ? data.error : {};
    resultsByCall.set(callId, {
      isError: resultIsError(data),
      code: stringOr(error.code, stringOr(error.name, '')),
      bytes: jsonBytes(message.content),
    });
  }

  const chunks = [];
  let turn = null;
  let buffer = '';
  let upto = 0;
  const pendingHumans = [];
  const flush = () => {
    if (buffer) {
      chunks.push({ text: buffer, upto });
      buffer = '';
    }
  };

  for (let index = 0; index < rows.length; index += 1) {
    const event = rows[index];
    if (!isObject(event)) continue;
    const data = isObject(event.data) ? event.data : {};
    const eventTurn = typeof data.turn === 'number' && Number.isFinite(data.turn) ? data.turn : null;
    if (event.type === 'turn/start') {
      flush();
      turn = eventTurn === null ? (turn === null ? 1 : turn + 1) : eventTurn;
      buffer += `\n### Turn ${turn}\n\n`;
      for (const text of pendingHumans.splice(0)) buffer += quoteBlock(text);
      upto = index;
      continue;
    }
    if (event.type === 'step/start') {
      flush();
      if (eventTurn !== null) turn = eventTurn;
      upto = index;
      continue;
    }
    if (event.type === 'user/message') {
      if (!isHumanMessage(data)) continue;
      const text = messageText(data.content);
      if (!text) continue;
      if (turn === null) {
        pendingHumans.push(text);
        upto = index;
        continue;
      }
      buffer += quoteBlock(text);
      upto = index;
      continue;
    }
    if (event.type === 'assistant/message') {
      if (eventTurn !== null) turn = eventTurn;
      const message = isObject(data.message) ? data.message : {};
      const text = messageText(message.content);
      if (!text) continue;
      buffer += `${text.slice(0, TRANSCRIPT_BLOCK_CHARS)}\n\n`;
      upto = index;
      continue;
    }
    if (event.type === 'tool/call') {
      if (eventTurn !== null) turn = eventTurn;
      buffer += toolLine(data, resultsByCall);
      upto = index;
      continue;
    }
  }
  flush();

  let out = `${transcriptHeader(f)}\n`;
  const included = [];
  let used = Buffer.byteLength(out);
  let covered = -1;
  for (const chunk of chunks) {
    const size = Buffer.byteLength(chunk.text);
    if (used + size + MARKER_RESERVE > limit) break;
    included.push(chunk);
    used += size;
    covered = chunk.upto;
  }
  const truncated = included.length < chunks.length;
  if (!truncated) {
    for (const chunk of included) out += chunk.text;
    return out;
  }
  // Cut at the last step boundary that still fits, then say how much is gone.
  let omitted = rows.length - covered - 1;
  for (;;) {
    const marker = `\n… [truncated: ${omitted} events omitted]\n`;
    if (used + Buffer.byteLength(marker) <= limit || included.length === 0) {
      for (const chunk of included) out += chunk.text;
      return `${out}${marker}`;
    }
    const dropped = included.pop();
    used -= Buffer.byteLength(dropped.text);
    covered = included.length ? included[included.length - 1].upto : -1;
    omitted = rows.length - covered - 1;
  }
}

// ------------------------------------------------------------------- store

function emptyIndex() {
  return { version: INDEX_VERSION, updatedAt: Date.now(), entries: {} };
}

function normalizeStatus(value, fallback = 'archived') {
  return value === 'archived' || value === 'pinned' || value === 'trash' ? value : fallback;
}

/** Tags: lowercase, trimmed, deduped, `[a-z0-9._:-]`, <= 32 chars, <= 24. */
/**
 * Owner-supplied tags: normalize case, then REJECT anything that is not a tag.
 *
 * Silent sanitization is the trap here: `"Not A Tag!"` becoming `"not-a-tag"` is
 * a data change the caller did not ask for, and a search for the tag it typed
 * finds nothing. Case and surrounding whitespace are safe to normalize; any other
 * deviation is a caller bug, so it is reported as `invalid-tag`.
 *
 * @param {string[]|string} value
 * @returns {string[]}
 */
function strictTags(value) {
  const raw = typeof value === 'string' ? [value] : value;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw Object.assign(new Error('invalid tags: every tag must be a string'), { code: 'invalid-tag' });
    }
    const tag = item.trim().toLowerCase();
    if (!tag) throw Object.assign(new Error('invalid tags: a tag must not be empty'), { code: 'invalid-tag' });
    if (tag.length > MAX_TAG_CHARS) {
      throw Object.assign(new Error(`invalid tag ${JSON.stringify(item)}: longer than ${MAX_TAG_CHARS} characters`), { code: 'invalid-tag' });
    }
    if (!/^[a-z0-9._:-]+$/.test(tag)) {
      throw Object.assign(
        new Error(`invalid tag ${JSON.stringify(item)}: allowed characters are a-z 0-9 . _ : -`),
        { code: 'invalid-tag' },
      );
    }
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  if (out.length > MAX_TAGS) {
    throw Object.assign(new Error(`invalid tags: at most ${MAX_TAGS} tags per session`), { code: 'invalid-tag' });
  }
  return out;
}

/** Lossy normalization for machine-generated tag lists (search needles, index repair). */
function normalizeTags(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = item
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._:-]+/g, '-')
      .replace(/^[-._:]+|[-._:]+$/g, '')
      .slice(0, MAX_TAG_CHARS);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

async function readText(file, fallback = null) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicWriteText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await fs.writeFile(tmp, text, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(file, value) {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function indexEntryMetrics(facts) {
  const counters = isObject(facts.counters) ? facts.counters : {};
  const durations = isObject(facts.durations) ? facts.durations : {};
  const usage = isObject(facts.usage) ? facts.usage : {};
  const toolCalls = finiteOr(counters.toolCalls, 0);
  const toolErrors = finiteOr(counters.toolErrors, 0);
  const humanTexts = Array.isArray(facts.humanTexts) ? facts.humanTexts : [];
  let corrections = 0;
  for (const row of humanTexts) {
    if (corrections >= CORRECTION_CAP_PER_SESSION) break;
    if (correctionMatches(isObject(row) ? row.text : '')) corrections += 1;
  }
  return {
    turns: finiteOr(counters.turns, 0),
    toolCalls,
    toolErrors,
    toolErrorRate: toolCalls > 0 ? toolErrors / toolCalls : 0,
    corrections,
    peakContextRatio: finiteOr(facts.peakContextRatio, 0),
    totalTokens: finiteOr(usage.totalTokens, 0),
    durationMs: finiteOr(durations.totalMs, 0),
    steps: finiteOr(counters.steps, 0),
  };
}

/**
 * The archive's durable layer: `archive.json` plus derived per-session files.
 *
 * Reads only from the configured session roots; the DSH session files are
 * never written, moved or deleted. Every write is a temp file renamed into
 * place, so `archive.json` survives a concurrent read mid-write. Mutations are
 * serialized in-process so two `sync()` calls cannot interleave index writes.
 */
export class ArchiveStore {
  #rootDir;
  #sessionRoots;
  #editTools;
  #checkTools;
  #maxTranscriptBytes;
  #by;
  #index = null;
  #queue = Promise.resolve();

  /**
   * @param {{ rootDir?: string, sessionRoots?: string[]|string, editTools?: string[],
   *   checkTools?: string[], maxTranscriptBytes?: number, by?: string }} [options]
   */
  constructor({
    rootDir = '',
    sessionRoots = null,
    editTools = DEFAULT_EDIT_TOOLS,
    checkTools = DEFAULT_CHECK_TOOLS,
    maxTranscriptBytes = DEFAULT_MAX_TRANSCRIPT_BYTES,
    by = 'archive-rsi',
  } = {}) {
    const explicit = typeof rootDir === 'string' ? rootDir.trim() : '';
    this.#rootDir = explicit ? path.resolve(expandHome(explicit)) : path.join(dshHome(), 'archive-rsi');
    const roots = (Array.isArray(sessionRoots) ? sessionRoots : sessionRoots ? [sessionRoots] : [])
      .filter((root) => typeof root === 'string' && root.trim())
      .map((root) => path.resolve(expandHome(root.trim())));
    this.#sessionRoots = roots.length ? roots : [path.join(dshHome(), 'sessions')];
    this.#editTools = Array.isArray(editTools)
      ? editTools.filter((name) => typeof name === 'string' && name)
      : [...DEFAULT_EDIT_TOOLS];
    this.#checkTools = Array.isArray(checkTools)
      ? checkTools.filter((name) => typeof name === 'string' && name)
      : [...DEFAULT_CHECK_TOOLS];
    this.#maxTranscriptBytes = Number.isFinite(maxTranscriptBytes) && maxTranscriptBytes > 0
      ? Math.floor(maxTranscriptBytes)
      : DEFAULT_MAX_TRANSCRIPT_BYTES;
    this.#by = typeof by === 'string' && by ? by : 'archive-rsi';
  }

  /** Absolute archive root this store owns. */
  get rootDir() {
    return this.#rootDir;
  }

  // ------------------------------------------------------------- plumbing

  #file(...parts) {
    return path.join(this.#rootDir, ...parts);
  }

  #archivePath() {
    return this.#file('archive.json');
  }

  #sessionJsonPath(id) {
    return this.#file('sessions', `${this.#safeId(id)}.json`);
  }

  #sessionMdPath(id) {
    return this.#file('sessions', `${this.#safeId(id)}.md`);
  }

  #safeId(id) {
    const text = String(id ?? '');
    if (!text || text.includes('/') || text.includes('\\') || text === '.' || text === '..') {
      throw new Error(`invalid session id: ${JSON.stringify(id)}`);
    }
    return text;
  }

  #enqueue(fn) {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  #normalizeEntry(entry) {
    const value = isObject(entry) ? entry : {};
    const tags = normalizeTags(Array.isArray(value.tags) ? value.tags : []);
    return {
      id: stringOr(value.id, ''),
      file: stringOr(value.file, ''),
      slug: stringOr(value.slug, ''),
      workspace: stringOr(value.workspace, ''),
      createdAt: finiteOr(value.createdAt, 0),
      updatedAt: finiteOr(value.updatedAt, 0),
      importedAt: finiteOr(value.importedAt, 0),
      bytes: finiteOr(value.bytes, 0),
      frameCount: finiteOr(value.frameCount, 0),
      eventCount: finiteOr(value.eventCount, 0),
      parentSession: typeof value.parentSession === 'string' ? value.parentSession : null,
      origin: stringOr(value.origin, ''),
      agentPreset: typeof value.agentPreset === 'string' ? value.agentPreset : null,
      delegationDepth: finiteOr(value.delegationDepth, 0),
      title: stringOr(value.title, ''),
      tags,
      status: normalizeStatus(value.status),
      note: stringOr(value.note, ''),
      digest: stringOr(value.digest, ''),
      factsDigest: stringOr(value.factsDigest, ''),
      metrics: isObject(value.metrics) ? value.metrics : {},
      ...(value.missing === true ? { missing: true } : {}),
    };
  }

  async #loadIndex() {
    if (this.#index) return this.#index;
    const raw = await readText(this.#archivePath(), null);
    if (raw === null) {
      this.#index = emptyIndex();
      return this.#index;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#index = emptyIndex();
      return this.#index;
    }
    this.#index = this.#adoptIndex(parsed);
    return this.#index;
  }

  #adoptIndex(parsed) {
    const index = emptyIndex();
    if (!isObject(parsed)) return index;
    index.version = finiteOr(parsed.version, INDEX_VERSION);
    index.updatedAt = finiteOr(parsed.updatedAt, Date.now());
    if (isObject(parsed.entries)) {
      for (const [id, entry] of Object.entries(parsed.entries)) {
        if (!isObject(entry)) continue;
        index.entries[id] = this.#normalizeEntry({ id, ...entry });
      }
    }
    return index;
  }

  async #writeIndex() {
    const index = await this.#loadIndex();
    index.version = INDEX_VERSION;
    index.updatedAt = Date.now();
    await atomicWriteJson(this.#archivePath(), index);
  }

  async #ensureDirs() {
    await fs.mkdir(this.#rootDir, { recursive: true });
    await fs.mkdir(this.#file('sessions'), { recursive: true });
    await fs.mkdir(this.#file('runs'), { recursive: true });
    await fs.mkdir(this.#file('proposals'), { recursive: true });
  }

  // ----------------------------------------------------------------- boot

  /**
   * Create the store layout if needed and load the index. A missing or
   * unparsable `archive.json` is rebuilt as an empty index; a corrupt file is
   * renamed to `archive.json.corrupt-<ts>` rather than deleted, so nothing is
   * lost silently.
   *
   * @returns {Promise<{created: boolean}>}
   */
  async init() {
    return this.#enqueue(async () => {
      await this.#ensureDirs();
      const archive = this.#archivePath();
      const raw = await readText(archive, null);
      if (raw === null) {
        this.#index = emptyIndex();
        await this.#writeIndex();
        return { created: true };
      }
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (!isObject(parsed) || !isObject(parsed.entries)) {
        const backup = `${archive}.corrupt-${nowIsoStamp()}`;
        await fs.rename(archive, backup).catch(() => {});
        this.#index = emptyIndex();
        await this.#writeIndex();
        await this.journal('config.invalid', 'archive.json', { recovered: true, backup });
        return { created: true };
      }
      this.#index = this.#adoptIndex(parsed);
      await this.#writeIndex();
      return { created: false };
    });
  }

  /** Read-only snapshot of the archive index. */
  async index() {
    const index = await this.#loadIndex();
    return JSON.parse(JSON.stringify(index));
  }

  // ----------------------------------------------------------------- list

  /**
   * Filter and page the index. `status` defaults to the live set
   * (`archived` + `pinned`); pass `'all'` to include `trash`.
   *
   * @param {{ query?: string, tag?: string, status?: string, workspace?: string,
   *   limit?: number, offset?: number, sort?: string }} [options]
   * @returns {Promise<{ total: number, entries: object[] }>}
   */
  async list({ query, tag, status, workspace, limit = 50, offset = 0, sort = 'recent' } = {}) {
    const index = await this.#loadIndex();
    const needle = typeof query === 'string' && query.trim() ? query.trim().toLowerCase() : '';
    const tagNeedle = typeof tag === 'string' && tag.trim() ? normalizeTags([tag])[0] : '';
    const workspaceNeedle = typeof workspace === 'string' && workspace.trim()
      ? workspace.trim().toLowerCase()
      : '';
    const wantedStatus = typeof status === 'string' && status.trim() ? status.trim() : '';
    const statusFilter = wantedStatus === 'all'
      ? null
      : wantedStatus
        ? [normalizeStatus(wantedStatus, 'all')]
        : ['archived', 'pinned'];
    const filtered = [];
    for (const entry of Object.values(index.entries)) {
      if (statusFilter && !statusFilter.includes(entry.status)) continue;
      if (tagNeedle && !(Array.isArray(entry.tags) && entry.tags.includes(tagNeedle))) continue;
      if (workspaceNeedle && !String(entry.workspace || '').toLowerCase().includes(workspaceNeedle)) continue;
      if (needle) {
        const haystack = [entry.id, entry.title, entry.note, entry.workspace, entry.slug]
          .map((value) => String(value || '').toLowerCase())
          .join('\n');
        if (!haystack.includes(needle)) continue;
      }
      filtered.push(entry);
    }
    const comparators = {
      recent: (a, b) => (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : -1),
      oldest: (a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1),
      updated: (a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt),
      title: (a, b) => (String(a.title).toLowerCase() < String(b.title).toLowerCase() ? -1 : 1),
    };
    // `newest` is the same order as `recent`; both spellings show up in callers.
    filtered.sort(comparators[sort === 'newest' ? 'recent' : sort] || comparators.recent);
    const start = Math.max(0, Math.floor(finiteOr(offset, 0)));
    // No upper clamp: a cohort scan asks for everything in one page.
    const size = Math.max(1, Math.floor(finiteOr(limit, 50)));
    return { total: filtered.length, entries: filtered.slice(start, start + size) };
  }

  /**
   * One archive entry plus its SessionFacts, or `null` when the id is unknown.
   * A missing/corrupt derived facts file yields `facts: null`, not an error.
   */
  async get(id) {
    const index = await this.#loadIndex();
    const entry = index.entries[String(id ?? '')];
    if (!entry) return null;
    let facts = null;
    try {
      const raw = await readText(this.#sessionJsonPath(entry.id), null);
      if (raw) {
        const parsed = JSON.parse(raw);
        facts = isObject(parsed) ? parsed : null;
      }
    } catch {
      facts = null;
    }
    return { entry, facts };
  }

  /** The rendered Markdown transcript, or `null` when it does not exist. */
  async transcript(id) {
    try {
      return await readText(this.#sessionMdPath(id), null);
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- sync

  async #walk(root, dir, depth, found) {
    if (depth > 4) return;
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const children = [];
    const candidates = [];
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!item.name.startsWith('.')) children.push(full);
        continue;
      }
      if (!item.isFile()) continue;
      const match = SESSION_FILE_RE.exec(item.name);
      if (!match) continue;
      candidates.push({
        file: full,
        version: match[1] === undefined ? -1 : Number(match[1]),
        compressed: item.name.endsWith('.zstd') ? 1 : 0,
      });
    }
    if (candidates.length > 0 && depth >= 1) {
      candidates.sort((a, b) => (b.version - a.version) || (b.compressed - a.compressed));
      const chosen = candidates[0];
      const sessionId = path.basename(dir);
      const relative = path.relative(root, dir);
      const slug = relative.split(path.sep).filter(Boolean)[0] || sessionId;
      const previous = found.get(sessionId);
      if (!previous || chosen.version > previous.version) {
        found.set(sessionId, { id: sessionId, file: chosen.file, slug, version: chosen.version });
      }
    }
    for (const child of children) await this.#walk(root, child, depth + 1, found);
  }

  async #discover() {
    const found = new Map();
    for (const root of this.#sessionRoots) await this.#walk(root, root, 0, found);
    return [...found.values()];
  }

  /**
   * Import new sessions and refresh changed ones.
   *
   * Idempotent: the file digest and its mtime must both match the index for a
   * session to be skipped. `refresh: true` re-decodes every discovered file.
   * A session that vanished from disk keeps its entry and gains
   * `missing: true`; a file that fails to decode is reported in `failed` and
   * never aborts the scan.
   *
   * @param {{ refresh?: boolean }} [options]
   * @returns {Promise<{scanned:number, imported:number, refreshed:number,
   *   skipped:number, failed:Array<{file:string,error:string}>}>}
   */
  async sync({ refresh = false } = {}) {
    return this.#enqueue(async () => {
      const result = { scanned: 0, imported: 0, refreshed: 0, skipped: 0, failed: [] };
      const index = await this.#loadIndex();
      const discovered = await this.#discover();
      result.scanned = discovered.length;
      const seen = new Set();
      for (const found of discovered) {
        seen.add(found.id);
        try {
          const bytes = await fs.readFile(found.file);
          const stat = await fs.stat(found.file);
          const digest = sha256(bytes);
          const previous = index.entries[found.id];
          if (
            previous &&
            !refresh &&
            previous.digest === digest &&
            previous.updatedAt === stat.mtimeMs
          ) {
            result.skipped += 1;
            continue;
          }
          const { header, events, frames } = decodeBytes(bytes, found.file);
          const facts = computeFacts({
            header,
            events,
            file: found.file,
            slug: found.slug,
            editTools: this.#editTools,
            checkTools: this.#checkTools,
          });
          const factsText = `${JSON.stringify(facts, null, 2)}\n`;
          const transcript = renderTranscript(facts, events, {
            maxBytes: this.#maxTranscriptBytes,
          });
          await atomicWriteText(this.#sessionJsonPath(found.id), factsText);
          await atomicWriteText(this.#sessionMdPath(found.id), transcript);
          const head = isObject(header) ? header : {};
          const entry = {
            ...(previous ? this.#normalizeEntry(previous) : {}),
            id: found.id,
            file: found.file,
            slug: found.slug,
            workspace: stringOr(head.cwd, ''),
            createdAt: finiteOr(head.createdAt, 0),
            updatedAt: stat.mtimeMs,
            importedAt: previous && previous.importedAt ? previous.importedAt : Date.now(),
            bytes: stat.size,
            frameCount: frames.length,
            eventCount: events.length,
            parentSession: typeof head.parentSession === 'string' ? head.parentSession : null,
            origin: stringOr(head.origin, ''),
            agentPreset: typeof head.agentPreset === 'string' ? head.agentPreset : null,
            delegationDepth: finiteOr(head.delegationDepth, 0),
            title: facts.title,
            tags: previous && Array.isArray(previous.tags) ? normalizeTags(previous.tags) : [],
            status: previous ? normalizeStatus(previous.status) : 'archived',
            note: previous ? stringOr(previous.note, '') : '',
            digest,
            factsDigest: sha256(factsText),
            metrics: indexEntryMetrics(facts),
          };
          index.entries[found.id] = this.#normalizeEntry(entry);
          if (previous) {
            result.refreshed += 1;
            await this.journal('sync.refresh', found.id, { digest, eventCount: events.length });
          } else {
            result.imported += 1;
            await this.journal('sync.import', found.id, { digest, eventCount: events.length });
          }
        } catch (error) {
          result.failed.push({
            file: found.file,
            error: (error && error.message) || String(error),
          });
        }
      }
      let changed = false;
      for (const [id, entry] of Object.entries(index.entries)) {
        if (seen.has(id)) {
          if (entry.missing) {
            delete entry.missing;
            changed = true;
          }
          continue;
        }
        if (!entry.missing) {
          entry.missing = true;
          changed = true;
        }
      }
      if (result.imported || result.refreshed || changed) await this.#writeIndex();
      if (result.skipped) await this.journal('sync.skip', 'sync', { skipped: result.skipped });
      return result;
    });
  }

  // --------------------------------------------------------------- update

  /**
   * Apply owner-editable fields. `pinned` is sugar for the `pinned` status.
   *
   * @param {string} id session id
   * @param {{ title?: string, tags?: string[]|string, status?: string,
   *   note?: string, pinned?: boolean }} [patch]
   * @returns {Promise<object>} the updated entry
   */
  async update(id, patch = {}) {
    return this.#enqueue(async () => {
      const index = await this.#loadIndex();
      const entry = index.entries[this.#safeId(id)];
      if (!entry) {
        const error = new Error(`no archive entry for session ${id}`);
        error.code = 'not-found';
        throw error;
      }
      const fields = isObject(patch) ? patch : {};
      if (fields.title !== undefined) {
        entry.title = stringOr(fields.title, '').trim().slice(0, MAX_TITLE_CHARS);
      }
      if (fields.tags !== undefined) {
        // Strings are normalized (DESIGN §2.1 is a normalization contract), but a
        // wrong SHAPE is a caller bug and must be reported: silently turning
        // `tags: 42` into `[]` looks like a successful write.
        const value = fields.tags;
        const isShaped = typeof value === 'string' || (Array.isArray(value) && value.every((tag) => typeof tag === 'string'));
        if (!isShaped) {
          const error = new Error('invalid tags: expected a string or an array of strings');
          error.code = 'invalid-tag';
          throw error;
        }
        entry.tags = strictTags(value);
      }
      if (fields.note !== undefined) {
        entry.note = stringOr(fields.note, '').slice(0, MAX_NOTE_CHARS);
      }
      if (fields.status !== undefined) {
        if (!['archived', 'pinned', 'trash'].includes(fields.status)) {
          const error = new Error(`invalid status: ${JSON.stringify(fields.status)}`);
          error.code = 'invalid-status';
          throw error;
        }
        entry.status = fields.status;
      }
      if (fields.pinned !== undefined) {
        entry.status = fields.pinned ? 'pinned' : 'archived';
      }
      await this.#writeIndex();
      await this.journal('archive.update', entry.id, { fields: Object.keys(fields) });
      return JSON.parse(JSON.stringify(entry));
    });
  }

  /**
   * Delete without `purge` moves the entry to `trash`; `purge: true` removes
   * the entry and its derived files. The DSH session file is never touched.
   *
   * @param {string} id session id
   * @param {{ purge?: boolean }} [options]
   * @returns {Promise<{removed: boolean, purged: boolean}>}
   */
  async remove(id, { purge = false } = {}) {
    return this.#enqueue(async () => {
      const index = await this.#loadIndex();
      const key = String(id ?? '');
      const entry = index.entries[key];
      // A silent `removed: false` reads as success to a caller; every other
      // entry method rejects an unknown id, so this one must too.
      if (!entry) {
        throw Object.assign(new Error(`no archived session "${key}"`), { code: 'not-found' });
      }
      if (purge) {
        delete index.entries[key];
        await fs.rm(this.#sessionJsonPath(entry.id), { force: true }).catch(() => {});
        await fs.rm(this.#sessionMdPath(entry.id), { force: true }).catch(() => {});
        await this.#writeIndex();
        await this.journal('archive.delete', entry.id, { purge: true });
        return { removed: true, purged: true };
      }
      entry.status = 'trash';
      await this.#writeIndex();
      await this.journal('archive.delete', entry.id, { purge: false });
      return { removed: true, purged: false };
    });
  }

  // ----------------------------------------------------------------- runs

  /**
   * Persist a PdcaRun under `runs/run-<id>.json`.
   * @param {object} run
   * @returns {Promise<object>} the run as written
   */
  async saveRun(run) {
    if (!isObject(run) || !run.id) throw new Error('saveRun requires a run with an id');
    const file = this.#file('runs', `${safeFileName(run.id, 'run')}.json`);
    await atomicWriteJson(file, run);
    return run;
  }

  async getRun(id) {
    try {
      const raw = await readText(this.#file('runs', `${safeFileName(id, 'run')}.json`), null);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async listRuns({ limit = 20 } = {}) {
    return this.#listDerived('runs', { limit, keep: () => true });
  }

  // ------------------------------------------------------------ proposals

  /**
   * Persist a Proposal under `proposals/prop-<id>.json` and render its
   * human-readable `prop-<id>.md` companion.
   * @param {object} proposal
   * @returns {Promise<object>} the proposal as written
   */
  async saveProposal(proposal) {
    if (!isObject(proposal) || !proposal.id) throw new Error('saveProposal requires a proposal with an id');
    const base = safeFileName(proposal.id, 'prop');
    await atomicWriteJson(this.#file('proposals', `${base}.json`), proposal);
    await atomicWriteText(this.#file('proposals', `${base}.md`), renderProposalMarkdown(proposal));
    return proposal;
  }

  async getProposal(id) {
    try {
      const raw = await readText(this.#file('proposals', `${safeFileName(id, 'prop')}.json`), null);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async listProposals({ status, runId, limit = 20 } = {}) {
    const keep = (value) => {
      if (typeof status === 'string' && status && value.status !== status) return false;
      if (typeof runId === 'string' && runId && value.runId !== runId) return false;
      return true;
    };
    return this.#listDerived('proposals', { limit, keep });
  }

  async #listDerived(dirName, { limit, keep } = {}) {
    const dir = this.#file(dirName);
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const rows = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const parsed = JSON.parse(raw);
        if (!isObject(parsed)) continue;
        if (typeof keep === 'function' && !keep(parsed)) continue;
        rows.push(parsed);
      } catch {
        // A half-written or hand-edited artifact is skipped, never fatal.
      }
    }
    rows.sort((a, b) => {
      const left = finiteOr(a.createdAt, 0) || finiteOr(a.updatedAt, 0);
      const right = finiteOr(b.createdAt, 0) || finiteOr(b.updatedAt, 0);
      return (right - left) || (String(a.id) < String(b.id) ? 1 : -1);
    });
    const size = Math.max(1, Math.floor(finiteOr(limit, 20)));
    return rows.slice(0, size);
  }

  // ------------------------------------------------------------ baselines

  /** Record one run's metrics in the compact `baselines.json` series. */
  async saveBaseline(runId, metrics) {
    const key = String(runId ?? '');
    if (!key) throw new Error('saveBaseline requires a runId');
    const file = this.#file('baselines.json');
    let baselines = {};
    const raw = await readText(file, null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isObject(parsed)) baselines = parsed;
      } catch {
        baselines = {};
      }
    }
    baselines[key] = { ts: Date.now(), metrics: isObject(metrics) ? metrics : {} };
    await atomicWriteJson(file, baselines);
    return baselines[key];
  }

  async readBaselines() {
    const raw = await readText(this.#file('baselines.json'), null);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  // -------------------------------------------------------------- journal

  /**
   * Append one decision record to `journal.jsonl`. Append failures are
   * swallowed: logging must never break the mutation it describes.
   *
   * @param {string} action one of the §2 action names
   * @param {string} subject what changed
   * @param {object} [detail]
   * @param {string} [by]
   */
  async journal(action, subject, detail, by) {
    const record = { ts: Date.now(), action: String(action), subject: String(subject) };
    if (detail !== undefined) record.detail = detail;
    record.by = typeof by === 'string' && by ? by : this.#by;
    try {
      await fs.mkdir(this.#rootDir, { recursive: true });
      await fs.appendFile(this.#file('journal.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // Best effort by contract.
    }
    return record;
  }

  // -------------------------------------------------------------- lessons

  async lessonsText() {
    const text = await readText(this.#file('lessons.md'), '');
    return typeof text === 'string' ? text : '';
  }

  async writeLessons(text) {
    const body = typeof text === 'string' ? text : '';
    await atomicWriteText(this.#file('lessons.md'), body);
    return body;
  }
}

// ------------------------------------------------- proposal markdown helper

function renderProposalMarkdown(proposal) {
  const p = isObject(proposal) ? proposal : {};
  const lines = [
    `# ${stringOr(p.title, '') || stringOr(p.id, 'Proposal')}`,
    '',
    `- id: \`${stringOr(p.id, '')}\``,
    `- run: \`${stringOr(p.runId, '')}\``,
    `- kind: ${stringOr(p.kind, '')}`,
    `- status: ${stringOr(p.status, '')}`,
    `- risk: ${stringOr(p.risk, '')}`,
    `- expected: ${stringOr(p.expectedMetric, '—')} ${stringOr(p.expectedEffect, '')}`.trim(),
    '',
    '## Rationale',
    '',
    stringOr(p.rationale, '—'),
    '',
    '## Body',
    '',
    stringOr(p.body, ''),
    '',
  ];
  return lines.join('\n');
}
