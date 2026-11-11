# dsh-archive-rsi — internal build contract

Status: frozen 2026-11-08 (verified revision: the one whose §7.3 carries the
"Plugin exports:" paragraph and whose §8 lists `autoRunEveryDays`/`autoPropose`). Every module below is written to this file. If an
implementation needs this file changed, it is a design change — report it, do not
silently diverge.

Plugin id: `archive-rsi` · package name: `dsh-archive-rsi` · locale namespace: `archive-rsi`

---

## 0. What this plugin is

Two subsystems, one store.

1. **Archive** — CRUD over the harness's historical sessions. DSH already writes
   every session to `~/.dsh/sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd`
   (a concatenation of zstd frames, one per append). DSH itself has no archive
   concept: no tags, no notes, no retention, no cross-session view. This plugin
   adds that layer *without touching the original session files*.
**The Harness already has an archive, and it stays authoritative.** Verified 2026-11-08:
`workspaceController.archiveSession/unarchiveSession/pinSession/unpinSession` persist session
ids into `<dshHome>/storages/workspace.json` under `global.archivedSessionIds` /
`global.pinnedSessionIds` (10 archived, 0 pinned on this machine), and an archived session is
gated at runtime — a model step on it is refused and the turn ends `blocked`. There is **no**
delete/trash/hidden-session concept anywhere in the Harness.

Therefore this plugin must not fork that store:

- `workspace-archive.js` mirrors the file **read-only** and never writes it; a second write path
  would silently disagree with the gate the Harness actually enforces.
- `entry.status` (`archived | pinned | trash`) is *this plugin's* retention state over its own
  index: `archived` = imported and kept, `pinned` = pinned in the plugin view, `trash` = dropped
  from the plugin's index (recoverable). It is **not** the Harness flag.
- `entry.harnessArchived` / `entry.harnessPinned` are the Harness's own flags, annotated onto
  every list/get result.
- A PDCA cohort is **the sessions the user archived in the Harness** by default; when nothing is
  archived it falls back to the whole window and records `cohort.source = 'all'` so an empty
  archive can never be misread as a clean corpus.

2. **Alchemy** — a PDCA loop over the archive that turns session telemetry into
   measurable findings and then into *context patches* (tool-description rules,
   prompt rules, AGENTS.md rules, skills) whose effect is measured on the next
   pass. That loop — measure, patch context, re-measure — is the tool-layer RSI.

Everything is deterministic local computation over the event log. No LLM call is
made by this plugin. (The agent calling `rsi_*` may add its own judgment; the
plugin never invents evidence.)

Non-goals: replaying sessions, forking sessions, mutating DSH session files,
auto-adopting patches without an explicit tool call.

---

## 1. Facts about the data (verified 2026-11-08 on 38 real sessions)

- File: `~/.dsh/sessions/<slug>/<sessionId>/session.v4.jsonl.zstd`, a concatenation
  of independently-decodable zstd frames. `zlib.zstdDecompressSync` decodes **one**
  frame, so the container must be scanned first. Frame scanner: port of
  `scanZstdFrames` from `@deepseek-ai/dsh-session-persistence-jsonl` (not exported
  there). A frame starts with magic `0xFD2FB528` (LE) followed by a descriptor
  byte, optional dictionary/content-size bytes, then 3-byte block headers.
- Decoded content is JSONL, one event object per line, sorted by `seq`.
- First event is always `{"type":"session", ...}` with
  `{version:4, id, createdAt(ms), cwd, parentSession?, isSeeded, origin, delegationDepth?, agentPreset?}`.
- Every later event is `{type, seq, time, data}`.
- Event types observed in the local corpus (do not assume anything outside this list):
  `session, agent-preset/selected, subagent/descriptor, sandbox/mode, approval/policy,
   permission/preset, agent/inbox/spliced, turn/start, step/start, system/message,
   user/message, request/header, request/context, session/title,
   session-log-deepseek/delivery-accepted, assistant/message, tool/call, job/registered,
   job/settled, tool/result, step/end, turn/end, developer/message, assistant/attempt,
   llm/retry, llm/retry-started, todo/write, session/title-llm-request, subagent/catalog,
   workspace/changes, session/end-seed, deliverables/presented, command/run, command/done,
   approval/asked, approval/decided, team/task, team/member, web/deepseek-search-llm-request`
- `user/message.data.content` is a ContentBlock[]; `user/message.data.source.kind` is
  `user` for real human turns and one of `agent-instructions | runtime-context |
  skill-catalog | time-context | agent-inbox | ...` for harness injections.
  **Only `source.kind === 'user'` may be treated as human input.**
- `tool/call.data = {turn, step, callId, name, arguments}` — `arguments` is the raw
  JSON string the model produced (unparsed, may be invalid JSON).
- `tool/result.data = {turn, step, message: ToolResultMessage, error?: {name, code, reason?}, meta?}`.
  `message.isError === true` marks a failure; `message.toolCallId` pairs it with the call;
  `message.content` is a ContentBlock[] (the model-facing text).
- `assistant/message.data = {turn, step, message, stream, usage?: {inputTokens, outputTokens,
  cacheReadTokens, cacheWriteTokens, totalTokens}, interrupted?}`.
- `turn/end.data.reason.kind ∈ {completed, aborted, blocked, error, max-tokens, interrupted, forked}`.
- `request/context.data = {provider, model, contextWindow, systemPromptUpdate}`.
- `request/header.data.header.tools` is the full tool catalog exposed for that
  request: `[{name, description, parameters}]`. Last one in a session wins.
- Compaction is **not** a distinct event type in this corpus. Do not invent one:
  detect context pressure numerically (peak input tokens / contextWindow) and also
  count events whose type contains `compact` if any ever appear.
- Sizes: 38 local sessions, 0.25–several MB each compressed. Full decode of the
  whole corpus takes ~1–3 s; results must be cached, keyed by (file bytes, mtimeMs, size).

---

## 2. On-disk store

Root: `config.rootDir` or `$DSH_HOME/archive-rsi` or `~/.dsh/archive-rsi`.
Every write is atomic: write `<file>.tmp-<rand>` then `fs.rename`.

```
<root>/
  archive.json                     # ArchiveIndex  (see 2.1)
  sessions/<sessionId>.json        # SessionFacts (see 3) — derived, rebuildable
  sessions/<sessionId>.md          # rendered human transcript (capped, see 4)
  runs/run-<id>.json               # PdcaRun (see 5)
  proposals/prop-<id>.json         # Proposal (see 6)
  proposals/prop-<id>.md           # human-readable proposal
  baselines.json                   # { [runId]: { ts, metrics } } — compact metric series
  journal.jsonl                    # append-only decision journal (every mutation)
```

`journal.jsonl` rows: `{ts, action, subject, detail?, by}`. Actions:
`sync.import, sync.refresh, sync.skip, archive.update, archive.delete, run.plan,
run.do, run.check, run.act, proposal.create, proposal.adopt, proposal.reject,
proposal.revert, config.invalid`.

### 2.1 ArchiveIndex

```js
{
  version: 1,
  updatedAt: <ms>,
  entries: {
    [sessionId]: {
      id,                      // sessionId
      file,                    // absolute path to session.v4.jsonl.zstd
      slug,                    // workspace slug (parent dir name)
      workspace,               // string from the session header `cwd`, '' if unknown
      createdAt,               // ms, from the session header
      updatedAt,               // ms, file mtime at import time
      importedAt,              // ms
      bytes,                   // compressed size
      frameCount,              // number of zstd frames decoded
      eventCount,
      parentSession,           // string | null
      origin,                  // 'user' | 'subagent' | string
      agentPreset,             // string | null
      delegationDepth,         // number | 0
      title,                   // from session/title event, else first user text (<= 80 chars)
      tags: [],                // string[] — manual ∪ auto, deduped, cap 24
      autoTags: [],            // string[] — the last set this plugin computed (DESIGN §10)
      status,                  // 'archived' | 'pinned' | 'trash'
      note,                    // string
      digest,                  // sha256 of the compressed file bytes
      factsDigest,             // sha256 of the SessionFacts json (cache validation)
      metrics: {               // headline numbers, copied out of SessionFacts (see 3)
        turns, toolCalls, toolErrors, toolErrorRate, corrections, peakContextRatio,
        totalTokens, durationMs, steps
      }
    }
  }
}
```

- `status`: `archived` (default), `pinned`, `trash`. Delete without `purge` moves to
  `trash`; delete with `purge: true` removes the entry and its derived files
  (`sessions/<id>.json|.md`). **The DSH session file is never modified or removed.**
- `tags` are lowercase, trimmed, deduped, `[a-z0-9._:-]` plus Han (U+3400–U+4DBF, U+4E00–U+9FFF,
  U+F900–U+FAFF), max 32 chars, max 24 per entry. Spaces and every other punctuation mark stay banned.
- Tags in the `auto:` namespace are owned by the plugin (§10). Recomputing them removes the
  previous `autoTags` and never touches a manual tag; a manual tag that happens to start with
  `auto:` is still manual once it has been written through `update()`.
  `update()` **rejects** a tag that violates the charset, the length cap or the count with
  `invalid-tag`; it only normalizes case and surrounding whitespace. Silent sanitization
  (`"Not A Tag!"` -> `"not-a-tag"`) is forbidden: the caller would search for the tag it typed.

---

## 3. `SessionFacts` (the archive → alchemy contract)

`archive.js` computes this; `alchemy.js` only reads it. No judgments here — counts and
samples only. Deep-equal fixture shape used by tests:

```js
{
  sessionId, createdAt, endedAt,                // ms; endedAt = last event time
  cwd, slug, origin, agentPreset, parentSession, delegationDepth, title,
  formatVersion,                                // 4
  counters: {
    events, turns, steps, userMessages, humanMessages, assistantMessages,
    toolCalls, toolResults, toolErrors, llmRetries, subagentDescriptors,
    teamTasks, approvals, commands, interrupts, compactions
  },
  tools: [                                      // one row per tool NAME, sorted by calls desc then name
    { name, calls, errors, errorCodes: { [code]: n }, resultBytes, inputBytes,
      firstSeq, lastSeq }
  ],
  catalog: {                                    // tool layer, from the LAST request/header
    bytes,                                      // JSON length of the tools array
    toolCount,
    tools: [ { name, bytes } ]                  // bytes = JSON length of {name,description,parameters}
  },
  skillCatalog: { bytes, entries },             // from the last user message with source.kind === 'skill-catalog'; 0/null if absent
  repeated: [ { name, argKey, times, seqs: [n] } ],  // same name+argKey >1 in one session, times >= 2, top 10 by times then name
  humanTexts: [ { seq, chars, text } ],         // source.kind === 'user' only, text capped at 400 chars, max 40
  edits: { count, seqs: [n], byTool: { name: n } },
  checks: { count, seqs: [n], lastSeq },        // commands matching CHECK_PATTERN
  afterLastEditChecks,                          // number of `checks.seqs` greater than max(edits.seqs); 0 when no edits
  usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens },
  contextWindow,                                // number from request/context, 0 if absent
  peakInputTokens,                              // max assistant usage.inputTokens
  peakContextRatio,                             // peakInputTokens / contextWindow, 0 if no window
  turnEnds: { [kind]: n },
  durations: { totalMs, maxTurnMs, maxStepMs },
  errorSamples: [ { seq, tool, code, reason, callPreview } ],  // <= 20, callPreview = arguments capped 200 chars
  interrupted: bool
}
```

### 3.1 Rules the implementation must follow

- **argKey** = first 12 hex chars of sha256 of the call's `arguments` string with
  whitespace runs collapsed. If `arguments` is not a string, use `String(arguments)`.
- **edits**: tool calls whose `name` is in `config.editTools` (default `['write','edit']`) — plus
  shell calls (`bash`, `pwsh`, `bash_persistent`) whose command writes a file. The shell test
  first neutralises `/dev/null` and file-descriptor redirections (`2>`, `>&2`, `2>&1`), then
  matches `tee`, `patch -pN`, `git apply`, `sed -i`, `perl -i`, or a `>`/`>>` that is not preceded
  by an fd digit and not followed by `&`. Rationale: the naive `\b>\s*\S+` test matched
  `2>/dev/null`, so read-only sessions counted as edited and `verificationGapRate` (and R4) were
  inflated — 0.64 → 0.46 on the local corpus after the fix. Count only the call, not the result.
- **checks**: tool calls whose `name` is in `config.checkTools` (default `['bash','pwsh','bash_persistent']`)
  and whose `command` argument matches `CHECK_PATTERN`:
  `/\b(?:test|tests|vitest|jest|pytest|mocha|ava|node|tsc|eslint|ruff|mypy|gofmt|go\s+test|cargo\s+(?:test|check)|make|cmake|ninja|pnpm|npm|yarn|bun|deno|swift|gradle|mvn|shellcheck|prettier|--check)\b/`
  (case-insensitive, applied to the parsed `command` string). A `node`-anything match
  is broad on purpose: the point is "did anything re-run after the edit".
- **skillCatalog**: find `user/message` events whose `data.source.kind === 'skill-catalog'`;
  take the last; bytes = JSON length of `data.source.entries`; entries = its length.
- **resultBytes / inputBytes**: `Buffer.byteLength(JSON.stringify(content))` respectively
  of the tool result content and the call `arguments`. Missing → 0.
- **durations.totalMs** = sum over turns of (`turn/end.time` − matching `turn/start.time`),
  falling back to last event time − createdAt. `maxTurnMs`, `maxStepMs` similarly per turn/step.
- **compactions** = count of events whose type matches `/compact/i`. `interrupts` = count of
  `interrupted: true` on assistant messages plus turn/end `kind === 'interrupted'`.

---

## 4. Rendered transcript (`sessions/<id>.md`, capped)

Deterministic Markdown, max 1 MiB, truncated at a step boundary with
`… [truncated: N events omitted]`. Sections: header table (id/preset/origin/created/turns/
tokens/peak context), `## Findings` (omitted here — findings are a run artifact), then
`## Timeline` with one block per turn: user text (human only) as a quote, assistant text
(each block capped at 12000 chars — a single long answer must survive intact), and one line
per tool call `- \`<name>\` <callPreview 120c> → ok|error(<code>) <resultBytes>B`.
Never include reasoning blocks. Never include `request/header`.

**Reading a transcript is paged, not all-or-nothing.** The file is the whole conversation;
the panel reads it in slices so a 1 MiB session never has to cross the wire at once.
`GET /sessions/:id?transcript=1&maxChars=&offset=` returns `transcript` (the slice),
`transcriptOffset`, `transcriptTotal` (full length) and `transcriptTruncated` (= *more
content follows this slice*), and the panel's 「加载更多」 appends the next slice until
`transcriptTruncated` is false. A slice must never be silently short: a caller that asks for
N chars gets N chars or the honest end of the text.

`store.transcript(id)` renders **on demand** when `sessions/<id>.md` is missing (old import,
manual deletion, an artifact written by a pre-transcript version), caches the result, and
returns `null` rather than throwing when the source cannot be decoded.

---

## 5. `PdcaRun`

```js
{
  id,                        // 'run-<yyyymmdd-hhmmss>-<4rand>'
  createdAt, updatedAt,
  phase,                     // 'plan' | 'do' | 'check' | 'act' | 'closed'
  status,                    // 'planned' | 'running' | 'checked' | 'closed' | 'failed'
                             //   lifecycle; derived from phase when absent. 'failed' is written only when a
                             //   crashed 'running' marker is retired (see §7.3 POST /runs)
  startedAt, finishedAt,     // ms; startedAt = planRun time, finishedAt = check time (null until checked/closed/failed)
  cohort: {                  // what to analyze
    days,                    // number, default 30; 0 = all
    workspace,               // string | null  (substring match on cwd)
    tag,                     // string | null
    status,                  // 'archived' | 'pinned' | 'trash' | 'all', default 'all'  (plugin retention)
    limit,                   // number, default 40 (newest first)
    onlyArchived,            // boolean, default true -> intersect the Harness archivedSessionIds
    source,                  // filled by the caller: 'harness-archive' | 'all'
    harnessArchivedTotal     // filled by the caller: size of the Harness archive
  },
  plan: {
    baselineRunId,           // string | null
    targets: [ { metric, op, value } ],   // op: '<=' | '>=' | '<' | '>'
    hypotheses: [ { id, statement, metric, expected } ]
  },
  do: {
    sessionIds: [], analyzedAt, factsDigest,   // digest over the concatenated factsDigest values
    coverage: { requested, analyzed, skipped, failures: [] }
  },
  check: {
    metrics: { ... },        // CohortMetrics, see 5.1
    perSession: [ { sessionId, createdAt, value...  } ],  // only ids + the 6 headline numbers
    verdicts: [ { metric, op, target, actual, verdict } ], // 'pass' | 'fail' | 'inconclusive'
    deltas: [ { metric, before, after, delta, verdict } ]  // vs baselineRunId; verdict 'improved'|'regressed'|'flat'|'unknown'.
                                                          // Empty when there is no baseline at all — never `before: 0`,
                                                          // which would fabricate a measurement. A baseline that merely
                                                          // lacks the metric yields `before/delta: null` + 'unknown'.
  },
  act: { findings: [Finding], proposalIds: [] }
}
```

`summarizeRun(run, { now?, staleMs? })` (alchemy.js) reduces a run to
`{ id, status, phase, createdAt, updatedAt, startedAt, finishedAt, durationMs, running, stalled,
targets:{total,passed,failed,flat,unknown}, findings, proposals }`. `running = status==='running' && !stalled`;
`stalled = status==='running' && now-(updatedAt||createdAt) > staleMs` (default 10 min); `finishedAt` falls back
to `updatedAt` when checked/closed/failed and missing; `durationMs = finishedAt-startedAt`, and stays null when the
run carries no `startedAt` (runs written before that field existed report no duration instead of the 0 ms
createdAt→updatedAt gap). `status==='failed'` reports `running:false, stalled:false`.

Default plan targets (created by `rsi_plan` when the caller gives none):

| metric | op | default target |
|---|---|---|
| `toolErrorRate` | `<=` | 0.05 |
| `correctionRate` | `<=` | 0.15 |
| `verificationGapRate` | `<=` | 0.30 |
| `peakContextRatioP90` | `<=` | 0.60 |
| `catalogBytes` | `<=` | 48000 |

### 5.1 `CohortMetrics` (exact definitions — tests assert these)

Given N sessions in the cohort (`N = analyzed`; `N === 0` → all values 0/empty and every
verdict `inconclusive`):

```js
{
  sessions: N,
  turns, toolCalls, toolResults, toolErrors,      // sums
  toolErrorRate,                                  // toolErrors / toolCalls (0 when no calls)
  correctionRate,                                 // sum(corrections per session) / sum(turns)  — corrections = count of humanTexts matching CORRECTION_PATTERN
  corrections,                                    // absolute count
  verificationGapRate,                            // sessions with edits.count > 0 && afterLastEditChecks === 0, divided by sessions with edits.count > 0 (0 when none)
  peakContextRatioP50, peakContextRatioP90,       // percentile over per-session peakContextRatio, nearest-rank
  catalogBytes,                                   // max over sessions of catalog.bytes
  catalogToolCount,                               // max over sessions of catalog.toolCount
  catalogWasteRate,                               // mean over sessions of (catalog tools with calls === 0) / catalogToolCount
  skillCatalogBytes,                              // max over sessions
  totalTokens, inputTokens, outputTokens,          // sums
  tokensPerTurn,                                  // totalTokens / turns
  turnFailureRate,                                // (turnEnds.error + turnEnds['max-tokens'] + turnEnds.aborted) / turns
  tools: [ { name, calls, errors, errorRate, errorCodes } ],  // merged across cohort, calls desc, max 40
  unusedTools: [ { name, bytes } ],               // in catalog of >= 50% of sessions but calls === 0 across cohort — top 20 by bytes
  repeatedCallSessions,                           // sessions with repeated.length > 0
  avgDurationMs, p90DurationMs                    // over sessions with durations.totalMs > 0
}
```

`CORRECTION_PATTERN` (case-insensitive, applied to `humanTexts[].text`):
`/(?:^|\s)(?:no[,.!]?\s|nope\b|wrong\b|incorrect\b|that's not|not what I|revert|undo that|try again|still (?:broken|failing|wrong)|didn'?t work)/i`
or the CJK forms `/(?:不对|不是这样|错了|搞错|重来|重新来|还是不行|没有用|别这么做|我说的不是|你又)/`.
At most 3 matches per session count (so one long complaint does not dominate) — no:
count every matching human message once, cap the per-session contribution at 3.

### 5.2 Findings (`Finding`)

```js
{
  id,                // 'f-<rule>-<n>' unique within the run
  rule,              // R1..R10, see 6.1
  severity,          // 'high' | 'medium' | 'low'
  title,             // short, factual, English or Chinese as authored
  detail,            // 1-3 sentences with the numbers that triggered it
  metric,            // which CohortMetrics key it is about
  evidence: [ { sessionId, seq } ],   // <= 5, must exist in the analyzed cohort
  tool,              // string | null
  count,             // the triggering count
  advice             // one sentence: what to change in the context/tool layer
}
```

### 5.3 Rules R1–R10 (exact predicates, evaluated in order over CohortMetrics + per-session facts)

- **R1 tool-error-hotspot** — any `tools[]` row with `calls >= 5 && errorRate >= 0.10`.
  severity `high` if errorRate >= 0.25 else `medium`. Evidence: up to 5 errorSamples of that tool.
- **R2 invalid-arguments** — merged `errorCodes` matching `/invalid|schema|parse|validation|unexpected|EINVALID|ENOENT.*arg/i`
  with count >= 3. severity `high`. Evidence: errorSamples with those codes. Advice: tool schema/description wording.
- **R3 redundant-calls** — `repeatedCallSessions / sessions >= 0.25 && repeatedCallSessions >= 2`.
  severity `medium`. Evidence: the session+seq of the worst repetition.
- **R4 verification-gap** — `verificationGapRate >= 0.30` with at least one session having edits.
  severity `high` if >= 0.5 else `medium`.
- **R5 correction-rate** — `correctionRate >= 0.15 && corrections >= 3`. severity `high` if >= 0.3.
- **R6 context-pressure** — `peakContextRatioP90 >= 0.60`. severity `medium`.
- **R7 catalog-bloat** — `catalogBytes >= 48000 || (unusedTools.length >= 5 && sum(unusedTools.bytes) >= 12000)`.
  severity `medium`.
- **R8 turn-failures** — `turnFailureRate >= 0.05`. severity `high` if >= 0.15.
- **R9 error-storm** — any single session with `toolErrors >= 8` and `toolErrors/toolCalls >= 0.4`,
  or any `tools[]` row with one `errorCodes` entry count >= 10. severity `high`.
- **R10 cost-outlier** — any session with `totalTokens >= 3 * median(totalTokens over cohort)`
  and `totalTokens >= 200000`. severity `low`.
- Empty cohort: findings `[]`, no crash.

---

## 6. `Proposal`

```js
{
  id,                 // 'prop-<yyyymmdd-hhmmss>-<4rand>'
  runId, findingIds: [],
  kind,               // 'prompt-section' | 'agents-md-rule' | 'skill-candidate' | 'advisory'
  target,             // see 6.1
  title, rationale,   // strings
  body,               // the exact text that gets written (or the advisory text)
  evidence: [ {sessionId, seq} ],
  expectedMetric, expectedEffect,     // metric key + 'decrease' | 'increase'
  fingerprint,        // content identity, see 6.2
  risk,               // 'low' | 'medium' | 'high'
  status,             // 'proposed' | 'adopted' | 'rejected' | 'reverted'
  createdAt, adoptedAt, rejectedAt, revertedAt,
  adoption: {         // null until adopted; `beforeSha` is OPTIONAL on the way in —
                      // applyProposal computes it from the live file and refuses with
                      // `target-changed` only when a recorded value disagrees with it
    path,             // absolute target file
    backupPath,       // absolute backup file (null for prompt-section, which is in-plugin)
    beforeSha, afterSha, bytes, mode   // mode: 'append' | 'replace' | 'create'
  },
  evaluation: {       // filled by a later rsi_check; null until then
    before: { sessions, metrics }, after: { sessions, metrics },
    verdict,          // 'improved' | 'regressed' | 'inconclusive'
    metric, delta, evaluatedAt
  }
}
```

### 6.2 Identity and dedupe

Two proposals are the same proposal when `(kind, target, expectedMetric, title)` agree after every
number in the title is collapsed to `#` — counts move between runs ("fails 22.9% of calls" →
"fails 26.0% of calls") and ids embed a timestamp, so neither identifies content. That string is
stored as `fingerprint` and is derivable from proposals written before the field existed.

`planProposals(run, { existing })` dedupes twice:

- inside one run, the same fingerprint is created once (two findings for the same tool collapse);
- against stored proposals: an open (`proposed`) match is **reused** — the new run references the
  existing id and writes nothing; an `adopted` match is **skipped** (already applied); `rejected` /
  `reverted` matches may be proposed again, because the judgement may change with new evidence.

`actOnRun` (index.js) is idempotent as well: a run whose `act.proposalIds` all resolve returns them
untouched, so clicking act twice cannot pile up a second copy. It returns
`{ run, proposals, created, reused, skipped }`; `POST /runs/:id/act` and `rsi_act` forward those
counts, and the panel reports "reused N" instead of claiming N new proposals.

### 6.1 Kinds, adoptability, and the exact write

**Reload semantics (verified against the installed harness, 2026-11-08)** — this decides how
the loop can close:

| kind | visible to the model when |
|---|---|
| `prompt-section` (lessons.md) | next turn — the section `text` provider is re-evaluated per assembly |
| `skill-candidate` | next turn — the skill filesystem watcher invalidates per load |
| `agents-md-rule` | next session resume or a first-party read/write touch; **not** next turn (no watcher) |

Consequence: `agents-md-rule` proposals can only be evaluated against sessions created after an
adoption that a new session actually picked up, so their `evaluation` stays `inconclusive` until
enough later sessions exist. `prompt-section` proposals are the only kind measurable immediately.

| kind | target | adoptable | write |
|---|---|---|---|
| `prompt-section` | `archive-rsi/lessons` | yes | text stored in `<root>/lessons.md`; the plugin injects it as a prompt section (`config.lessonsSection: true`). No external file touched. |
| `agents-md-rule` | `~/.agents/AGENTS.md` (config `agentsFile`) | yes | append body under an `<!-- archive-rsi: <proposalId> -->` marker; `mode: 'append'`. Backup to `AGENTS.md.bak-<ts>`. |
| `skill-candidate` | `~/.agents/skills/<slug>/SKILL.md` (config `skillsRoot`) | yes | create file (fails if exists and differs); `mode: 'create'`. |
| `advisory` | `''` | **no** | text only; `rsi_adopt` on it returns an error. Used for tool pruning / description recommendations aimed at plugin authors. |

Adoption rules:
- Refuses when `status` is neither `'proposed'` nor `'reverted'` (a reverted proposal may be re-adopted), or kind is `advisory`, or the target path is
  outside the allowed roots (`~/.agents`, `<root>`), or the file changed since the
  proposal was created (recompute `beforeSha` at adopt time and compare with the
  proposal's recorded one; mismatch → error `target-changed`).
- `revert` restores `backupPath` content and deletes the appended marker block; for
  `prompt-section` removes the stored text; for `skill-candidate` deletes the file only
  if its sha still matches `afterSha`.
- Adoption never runs automatically. `config.autoAdopt` defaults `false`, and even when
  true it only applies `prompt-section` proposals, at most 1 per run.

---

## 7. Module boundaries and exports

Every module is zero-dependency ESM Node (`node:fs`, `node:path`, `node:crypto`,
`node:zlib`, `node:os` only). No imports from `@deepseek-ai/*` anywhere.

### 7.0 `workspace-archive.js`

```js
export async function readHarnessArchive(dshHome) -> { archived: Set<string>, pinned: Set<string>, path, at, error }
export function annotate(entry, state) -> entry & { harnessArchived, harnessPinned }
export function filterByHarnessArchive(entries, state, mode) -> entries   // mode: true|false|undefined
```

Cached on `(mtimeMs, size)`. A missing or corrupt `workspace.json` yields empty sets plus
`error`, never a throw. Read-only by construction — do not add a writer.

### 7.1 `archive.js`

```js
export const DEFAULT_EDIT_TOOLS = ['write', 'edit'];
export const DEFAULT_CHECK_TOOLS = ['bash', 'pwsh', 'bash_persistent'];

export function scanZstdFrames(buffer) -> { frames: [{start,end}], tornStart?: number }
export function decodeSessionFile(file) -> { header, events, frames, tornStart }
export function computeFacts({ header, events, file, slug }) -> SessionFacts     // pure
export function renderTranscript(facts, events, { maxBytes }) -> string          // pure
export function deriveTitle({ header, events }) -> string
export function deriveAutoTags(facts, { cohortMedianTokens?, limit? }) -> string[]   // pure, DESIGN §10

export class ArchiveStore {
  constructor({ rootDir, sessionRoots, editTools, checkTools, maxTranscriptBytes })
  async init()                                     -> { created: boolean }
  async index()                                    -> ArchiveIndex (read-only view)
  async list({ query, tag, status, workspace, limit, offset, sort })  -> { total, entries }
  async get(id)                                    -> { entry, facts } | null
  async transcript(id)                             -> string | null   // renders + caches on demand (§4)
  async autotag({ id, dryRun })                    -> { entries, tags, total }  // recompute auto tags
  async sync({ refresh })                          -> { scanned, imported, refreshed, skipped, failed: [{file, error}] }
  async update(id, patch)                          -> entry        // {title?, tags?, status?, note?, pinned?}
  async remove(id, { purge })                      -> { removed, purged }
  async saveRun(run) / async getRun(id) / async listRuns({limit})
  async saveProposal(p) / async getProposal(id) / async listProposals({status, runId, limit})
  async saveBaseline(runId, metrics) / async readBaselines()
  async journal(action, subject, detail)           // append-only
  async lessonsText() / async writeLessons(text)
  get rootDir()
}
```

`sessionRoots` default: `[join(dshHome(), 'sessions')]`. Discovery walks
`<root>/<slug>/<sessionId>/session.<ver>.jsonl.zstd` (accept `.jsonl.zstd` and
`.jsonl`; prefer the highest `v<ver>`), so unknown future versions degrade gracefully.
Reading a plain `.jsonl` needs no zstd.

`sync()` must be idempotent: a session whose compressed `digest` and `updatedAt`
match the index is skipped; a changed file is re-decoded and its facts/transcript
rewritten. A corrupt file records `failed` and never aborts the whole sync.
`refresh: true` re-decodes **every discovered file** regardless of digest, so on an
unchanged corpus it reports `refreshed: N` and `skipped: 0` — `refreshed` counts
files actually re-decoded, `imported` only files new to the index.

### 7.2 `alchemy.js`

```js
export const DEFAULT_TARGETS = [...];
export const RUN_STATUSES = ['planned', 'running', 'checked', 'closed'];
export const RUN_STALE_MS = 10 * 60 * 1000;                                  // a running run stalls after this
export function deriveFindings(metrics, factsList, cohort) -> Finding[]     // pure, R1..R10
export function cohortMetrics(factsList) -> CohortMetrics                   // pure
export function median(xs) -> number          // === percentile(xs, 0.5): even-length lists take the LOWER middle element
export function percentile(xs, p) -> number                                  // nearest-rank
export function planRun({ cohort, targets, baselineRunId }) -> PdcaRun      // pure
export function executeDo(run, factsList) -> PdcaRun                        // fills do (pure)
export function executeCheck(run, factsList, baselineMetrics) -> PdcaRun    // fills check (pure)
export function summarizeRun(run, { now?, staleMs? }) -> object             // pure; §5 summary shape
export function planProposals(run, { existing? })
   -> { proposals, reused, skipped }                                        // §6.2 dedupe, pure
export function proposalFingerprint(proposal) -> string                     // §6.2 content identity
export function proposalsFor(run) -> Proposal[]                             // pure; evidence ids kept
export function evaluateAdoptions(proposals, factsList, { minSessions })
   -> Proposal[]                                                            // fills evaluation, pure
export function applyProposal(proposal, { rootDir, agentsFile, skillsRoot })
   -> Promise<Proposal>                                                     // performs the write
export function revertProposal(proposal, { rootDir, agentsFile, skillsRoot })
   -> Promise<Proposal>
export function slugifySkill(name) -> string
```

`RUN_STATUSES` / `RUN_STALE_MS` / `summarizeRun` implement the §5 lifecycle: `summarizeRun` never
mutates and never reads the clock unless the caller injects `now`. `status` is derived from `phase`
(`plan`→`planned`, `do`→`running`, `check`/`act`→`checked`, `closed`→`closed`) when a run carries none.
`executeCheck` itself stamps `status:'checked'` and `finishedAt`, so callers that skip `finishCheck`
cannot persist a run that says it is still running.

**`executeCheck` also fills `run.act.findings = deriveFindings(run.check.metrics, factsList, run.cohort)`**
and leaves `run.act.proposalIds = []` for `planProposals` to fill later. `run.phase` becomes `'act'`
after a check; `index.js` closes it after the proposals are written, and `actOnRun` decides what is
new, what was reused and what an adoption suppresses (§6.2).

`planProposals` maps findings to proposals (`proposalsFor` is the same list with dedupe against
nothing stored):
- R1/R2 → `advisory` (tool description/schema) — target `''`, title names the tool.
- R4 → `prompt-section` (verification rule) with metric `verificationGapRate`.
- R5 → `prompt-section` (ask-before-assume / confirm-the-intent rule) or `skill-candidate`
  when corrections cluster on one topic keyword.
- R6 → `prompt-section` (context discipline rule).
- R7 → `advisory` (tool catalog pruning) + `prompt-section` (do not re-read avoided tools)?
  No: R7 → `advisory` only.
- R8 → `agents-md-rule` (check the model/tier before long mechanical work).
- R3 → `prompt-section`.
- R9/R10 → `advisory`.
Every proposal must carry `evidence` taken verbatim from the finding.

`evaluateAdoptions` needs `factsList` covering sessions on both sides of `adoptedAt`;
`minSessions` default 3 per side, otherwise `inconclusive`.

### 7.3 `index.js` (host plugin)

Wires config, tools, web routes, prompt section (static protocol + lessons), dynamic
context, and `sync` on boot (debounced, background, never throws).

**Continuous loop.** A plugin cannot schedule itself without claiming a reminder session, so
continuity is anchored to process lifetime: on boot, after the incremental sync, if the newest
run is older than `autoRunEveryDays` the plugin runs plan+do+check once in the background and
(unless `autoPropose` is off) writes the proposals. It never adopts anything except, with
`autoAdopt: true`, one `prompt-section` lesson — text that lives in the plugin's own root.
Journal actions: `run.auto`, `run.act` (with `auto: true`).

Agent tools (11). `execute(args, exec)`; every handler validates args itself and returns
a plain JSON-serializable object. All tool errors are returned as `{ ok: false, error: { code, message } }`
— never thrown (the harness would turn a throw into a generic tool failure).

| tool | args | returns |
|---|---|---|
| `archive_list` | `{ query?, tag?, status?, workspace?, archived?, limit?, offset? }` | `{ ok, total, harnessArchive, entries: [{id,title,createdAt,workspace,origin,status,harnessArchived,harnessPinned,tags,metrics}] }` — `archived` filters on the Harness flag |
| `archive_get` | `{ id, transcript?: boolean, maxChars?, offset? }` | `{ ok, entry, facts, transcript?, transcriptOffset?, transcriptTotal?, transcriptTruncated? }` — the transcript is paged like §4: `maxChars` default 12000, clamped to [1000, 400000], `offset` default 0; page with `offset = transcriptOffset + transcript.length` until `transcriptTruncated` is false |
| `archive_sync` | `{ refresh?: boolean }` | `{ ok, scanned, imported, refreshed, skipped, failed }` |
| `archive_update` | `{ id, title?, tags?, status?, note? }` | `{ ok, entry }` |
| `archive_autotag` | `{ id?, dryRun?, limit? }` | `{ ok, updated, total, sample: [{id, autoTags}] }` — recompute the §10 tags for one entry or the whole archive |
| `archive_delete` | `{ id, purge?: boolean }` | `{ ok, removed, purged }` |
| `rsi_plan` | `{ days?, workspace?, tag?, limit?, targets? }` | `{ ok, run }` |
| `rsi_run` | `{ runId?, days?, workspace?, tag?, limit?, targets? }` | `{ ok, run }` — plan+do+check in one call; the cohort is the Harness-archived set unless `cohort.source` says `all` |
| `rsi_act` | `{ runId }` | `{ ok, run, proposals }` |
| `rsi_status` | `{ runId?, limit? }` | `{ ok, corpus, run, runs, status: { running, lastRun, autoRun: { enabled, everyDays, dueAt, due } }, proposals, openProposals, adopted }` — additive; `status.lastRun` is the §5 summary |
| `rsi_adopt` | `{ proposalId, revert?: boolean, dryRun?: boolean }` | `{ ok, proposal }` |

Plugin exports: `inject = ['tools', 'systemPrompt']` plus a deferred `ctx.inject(['webServer'], …)` child
for the panel routes, so a headless/SDK composition still gets the tools.

Web routes under `/api/archive-rsi` (all fail-closed via `ctx.connection.requestRejection`;
`503` when the connection service is absent, `401/403` matching its verdict). JSON only;
Query limits: an absent/zero `limit` (or `maxChars`) means the route default — `Number(null) === 0`
must never degrade a list to one row or a transcript to one character.

body cap 256 KiB; `{ok:false,error:{code,message}}` on failure; status codes:
`400 bad-argument|invalid-tag|invalid-status`, `404 not-found`, `409 not-adoptable|target-changed|path-outside-root`.

| route | notes |
|---|---|
| `GET /overview` | corpus counts, tag/workspace vocabulary, `lastRun` (§5 summary, not the full run), `autoRun:{enabled,everyDays,dueAt,due}`, proposal counts, root path |
| `GET /sessions?query&tag&status&workspace&limit&offset&sort` | list |
| `GET /sessions/:id?transcript=1&maxChars=&offset=` | entry + facts + transcript slice: `transcript`, `transcriptOffset`, `transcriptTotal`, `transcriptTruncated` (§4); `maxChars` default 24000, clamped to [1000, 400000] |
| `PATCH /sessions/:id` | `{title?,note?,tags?,status?}` |
| `DELETE /sessions/:id?purge=0\|1` | trash or purge the archive entry |
| `POST /sync` | `{refresh?}` |
| `POST /autotag` | `{id?,dryRun?,limit?}` — recompute §10 tags (panel button) |
| `GET /runs?limit=` / `GET /runs/:id` | list / one |
| `POST /runs` | plan+do+check from body `{days?,workspace?,tag?,status?,limit?}`; reuses `runOnce` (same `run.do`/`run.check` journal, same baseline choice and same cohort defaults as `rsi_run`: `days 30`, `limit 40`, retention `archived + pinned`), returns `{ok:true, run}` with `status`. Before planning it retires a head run left `running` for longer than `RUN_STALE_MS` as `failed`, and it takes its baseline from the newest *finished* run (falling back to the newest `baselines.json` entry), so a crashed or plan-only run can neither steal the baseline nor postpone the next auto run |
| `POST /runs/:id/act` | generate proposals for that run (rsi_act semantics, §6.2 dedupe); returns `{ok, run, proposals, created, reused, skipped}` and is idempotent per run |
| `GET /proposals?status&runId&limit` | list |
| `POST /proposals/:id/reject` | mark rejected |
| `POST /proposals/:id/adopt` | apply; `{"revert":true}` reverts |
| `GET /metrics` | per-session headline series + baseline series |

Prompt contribution:
- one static section (`order: getSectionOrder('TOOL_SESSION_QUERY') + 10`, name `tool:archive-rsi`)
  of ≤ 120 words describing the two-layer contract, disabled by `config.protocolSection`.
- lessons text appended to that section (max 4 KiB) when `<root>/lessons.md` is non-empty.
- no `systemPrompt.context` in v1 (keep the RSI surface quiet).

### 7.4 `client.js`

`window.__ModuleLoader__.load({ id: 'dsh-archive-rsi', factory(require) {...} })`,
`inject: ['slots','locale']`, registers `sidebar.panellist` (icon) and `main` (page).
Page = three tabs (归档 Archive / 炼金 PDCA / 提案 Proposals) driven entirely by
`fetch('/api/archive-rsi/...')`. Plain `React.createElement`, no external imports.
No config schema on the client (it cannot have one).

The Archive tab also carries a **Re-derive tags** action next to Sync, which posts
`/autotag {dryRun:false}` and reports `{updated, tags}` (§10). Auto tags are rendered as ordinary
chips in the existing tag column, so no new client-side state machine is needed.

**Layout contract (both content tabs).** Every scroll region needs a definite height in the chain,
so `.archive` / `.pdca` declare `grid-template-rows: minmax(0,1fr)` (an implicit `auto` row would
shrink the panes to their min-content height and clip them instead of scrolling), and the PDCA
panel area declares `grid-auto-rows: max-content` for the same reason — the area scrolls, the cards
keep their natural height. The Act card spans the full width (`[data-phase="act"]{grid-column:1/-1}`)
because findings are long, and the run header always carries the **生成提案 / 重新生成提案** action,
so the act entry point is reachable without scrolling to the bottom of the findings list.

---

## 8. Config (host, `readConfig(raw)` with defaults + warnings)

```js
{
  rootDir: '',              // '' → <dshHome>/archive-rsi
  sessionsDir: '',          // '' → <dshHome>/sessions
  protocolSection: true,
  lessonsSection: true,
  syncOnBoot: true,
  maxTranscriptBytes: 262144,
  days: 30,
  limit: 40,
  agentsFile: '',           // '' → ~/.agents/AGENTS.md
  skillsRoot: '',           // '' → ~/.agents/skills
  autoAdopt: false,          // even when true: at most one prompt-section lesson per run
  autoRunEveryDays: 7,       // 0 disables the boot-time continuous run
  autoTag: true,             // derive §10 tags on every sync
  autoTagLimit: 8,           // max auto tags per session (manual tags are extra)
  autoPropose: true,         // auto run also writes proposals (never adoptions)
  editTools: [...DEFAULT_EDIT_TOOLS],
  checkTools: [...DEFAULT_CHECK_TOOLS]
}
```
Unknown keys → warning, ignored. Never throw on bad config; clamp numbers.

---

## 9. Acceptance evidence (what the verifier must show)

1. `node --check` clean on every `.js`.
2. `.verify-host.mjs` green with a stubbed context: config clamps; real zstd fixture
   decode incl. a torn trailing frame; `computeFacts` on a hand-built event fixture
   matches an expected object field by field; sync idempotency (second sync imports 0);
   archive update/delete/trash/purge; `cohortMetrics` on 3 synthetic facts matches
   hand-computed values; R1–R10 each fire on a crafted metric set and stay silent on a
   clean one; plan→do→check→act produce a run whose `check.verdicts` are consistent with
   its own metrics; adopt writes the marker to a temp AGENTS.md and revert removes it
   byte-identically; `target-changed` refusal; web routes 503 without connection and 401
   on rejection; every tool returns `{ok:false,...}` (not a throw) on bad args.
3. Real-corpus smoke (separate script or flag): sync the actual `~/.dsh/sessions`,
   decode ≥ 1 real session, print headline metrics; must not modify anything under `~/.dsh`.
4. `.verify-client.mjs`: loads `client.js` under a stub module loader with a stub
   `react`, asserts both slot registrations and that the page component renders
   (renderToString-level smoke, no DOM required).
5. Automatic tags: the §10.3 checks, plus "every derived tag matches
   `/^auto:(?:[a-z0-9._:-]|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])+$/` and is <= 32 characters" over the real corpus.

---

## 10. Automatic tags

Every sync (and the `archive_autotag` tool) derives a deterministic tag set from
`SessionFacts`. No model is called: a tag is either a fact of the log or it is not
written, and every rule below is a predicate on numbers already in §3.

### 10.1 Namespace and lifecycle

- Auto tags live in the `auto:` prefix and are recorded in `entry.autoTags`.
- Recomputation is `tags := (tags − previousAutoTags) ∪ nextAutoTags`, deduped, then capped at
  24 total by dropping the *auto* tail first. Manual tags therefore survive every sync, and an
  auto tag whose predicate stopped holding disappears.
- The plugin never writes auto tags through `update()`, so `strictTags` (§2.1) keeps rejecting
  caller-supplied tags that are not `[a-z0-9._:-]` plus Han. Auto tags are built from already-safe
  fragments: every fragment is lowercased and every character outside `[a-z0-9._:-]` and the Han
  blocks (U+3400–U+4DBF, U+4E00–U+9FFF, U+F900–U+FAFF) becomes `-`; the whole tag is truncated to 32
  characters. `strictTags` accepts Han and still rejects spaces/punctuation; `normalizeTags` keeps Han
  (it is the lossy search needle).
- `autoTagLimit` (default 8) caps the auto set; rules are applied in the priority order below
  and the list is truncated.

### 10.2 Rules (exact predicates; all read `SessionFacts`)

| # | tag | predicate | notes |
|---|---|---|---|
| T1 | `auto:预设:<preset>` | `agentPreset` is a non-empty string | the preset the session ran under |
| T2 | `auto:来源:<直接对话\|子代理\|其他>` | `origin` normalized; `origin === 'subagent'` or `delegationDepth > 0` → `子代理`; `origin === 'user'` → `直接对话`; empty/unknown → `其他` | |
| T3 | `auto:错误热点:<中文错误名>` | a single `tools[].errorCodes` entry with `count >= 3`, or the whole session's `toolErrorRate` **and** that code is the modal one | one tag only, the modal code; known codes map to Chinese names (`FS_STALE_VERSION`→文件版本过期, `FS_NOT_FOUND`→文件不存在, `FS_NOT_OBSERVED`→未先读取文件, `AUTO_REVIEW_FAILED`→自动审查失败, `TEAM_MEMBER_NOT_FOUND`→团队成员不存在, `INVALID_ARGS`→参数不合法, `SEARCH_FAILED`→搜索失败, `unknown`→未知错误); unlisted codes keep their lowercase code (`_` kept) |
| T4 | `auto:验证缺口` | `edits.count > 0 && afterLastEditChecks === 0` | the R4 predicate |
| T5 | `auto:轮次异常` | `turnEnds.error + turnEnds['max-tokens'] + turnEnds.aborted + turnEnds.interrupted > 0` | |
| T6 | `auto:重复调用` | `repeated.length > 0` | identical call re-issued |
| T7 | `auto:用户纠正` | `counters.corrections > 0` **or** at least one `humanTexts[]` entry matching the §5.1 correction pattern | |
| T8 | `auto:上下文吃紧` | `peakContextRatio >= 0.6` | |
| T9 | `auto:上下文偏重` | `0.3 <= peakContextRatio < 0.6` | mutually exclusive with T8 |
| T10 | `auto:成本偏高` | `cohortMedianTokens > 0 && usage.totalTokens >= 3 * cohortMedianTokens && usage.totalTokens >= 200000` | needs the cohort median; when it is unavailable the rule is skipped |
| T11 | `auto:长任务` | `counters.steps >= 100` | |
| T12 | `auto:常用工具:<name>` | for the top `min(2, …)` tools by `calls` with `calls >= 5` | the fragment is charset-safe per §10.1, so `mcp__x__y` stays `mcp__x__y` (`_` is allowed); only characters outside the allowed set become `-` |
| T13 | `auto:语言:中文` / `auto:语言:英文` | over `humanTexts[].text`: `中文` when CJK characters ≥ 30% of all letters, `英文` when ASCII letters ≥ 70% of all letters; the two predicates are independent, so a genuinely mixed session gets **both**, a pure session gets exactly one | no human text, or < 20 letters → no tag |

Priority order for truncation: **T3, T4, T5, T6, T7, T2, T1, T8, T9, T10, T11, T12, T13.**

### 10.3 Acceptance checks (added to the harness)

- A crafted facts object with a modal error code and no post-edit check yields both
  `auto:错误热点:<中文错误名>` and `auto:验证缺口`, in that order before any tool tag.
- A clean session yields `auto:来源:*` plus at most one scale/lang tag and no health tag.
- Recompute keeps a manual tag: `update({tags:['manual-x']})` then `autotag` → `manual-x` still
  present, stale auto tags gone.
- `dryRun: true` writes nothing (the index file's sha is unchanged) but reports the tags.
- `autoTag: false` disables derivation during `sync` while leaving existing tags untouched.

---
