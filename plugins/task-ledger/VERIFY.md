# VERIFY — `dsh-task-ledger` (host half + client contract)

**Verdict: PASS — safe to keep installed.** All 52 gating host checks and all 7 client
contract checks pass against the current source. Six defects were found **outside** the
required check list and all six are fixed in 1.0.1. Details in
[Known defects](#known-defects-non-gating) and [Post-fix re-verification](#post-fix-re-verification-v101).

Verification is a stub-context harness: it imports `index.js`/`ledger.js` directly and
builds a fake Cordis context (tools / systemPrompt / webServer / commands / connection).
It never installs, and it never touches the real profile ledger. Test roots live under
`/tmp/dsh-task-ledger-verify-*` and are removed before exit.

中文摘要：必检项 52/52 通过、面板契约 7/7 通过；发现 6 个不在必检清单内的缺陷
（P1：并发/重复 `task_open` 会复用 id 并覆盖章程；P2：未知 task_id 报 ENOENT 而非
`task-not-found`，面板同一原因返回 500；P3：`runs` 重复计数；P4：未知任务详情应为
404 却返回 500；P5：`/index?status=` 非法值被静默接受）。P1 建议尽快修。

## Environment and artifacts

| Item | Value |
| --- | --- |
| Harness API baseline | DSH `0.2.1-rc.4` (verified API facts: `ctx.effect`, `ctx.tools.register`, `ctx.systemPrompt.section/context`, `ctx.on('agent/created')`, `ctx.inject(['webServer'/'commands'])`, `ctx.webServer.register({kind:'prefix'})`, `ctx.commands.register`) |
| Node | `v26.2.0` (darwin) |
| Verified at | 2026-11-06T00:0x+08:00 (Asia/Shanghai) |
| Host suite | `task-ledger/.verify-host.mjs` — 52 checks, exit 0 |
| Client suite | `task-ledger/.verify-client.mjs` — 7 checks, exit 0 |
| Temp roots | 8–9 mkdtemp dirs under `/tmp`, removed; 0 leftovers |

Source hashes at verification time (re-run the suites if any of these change):

| File | sha256 |
| --- | --- |
| `index.js` | `f1aa9a14fbaaf578eb625d03d2a247d8472ed3ddc83579606a20bd67dcc6b17b` |
| `ledger.js` | `65f0582f2fb58cef198aa3f428c8df04a4e99cdff019a6b6bd05d412a31fb452` |
| `index-md.js` | `14301a76db10ed4bb0ba3c19c9b62c1e32d517611ab2da9550c662993a1e8186` |
| `protocol.js` | `d5890c0fe8b7166fff60ea3879ac38a56d6ad9ca9c759b3087bf7e2c401155c2` |
| `client.js` | `4f5aee4d99ae8ba42863a3932e39a58c4b217f144b95bf3ddb9ca9023c696699` |
| `.verify-host.mjs` | `1a8540776c4d8405cfbe806a54274978e1183ea02fc00408fbc85055c8510a03` |
| `.verify-client.mjs` | `18523607f07cb4f8493d0000045cba761a02213bbe3b232fa932a5dbaffcbfaf` |

## How to run

```bash
cd task-ledger

# Gating suite (exit 0 only when every required check passes)
node .verify-host.mjs

# Client contract suite (run standalone for detail; also spawned by the host suite)
node .verify-client.mjs

# Non-gating probes for the six defects below (always exits 0; prints
# OBSERVED-BUG / FIXED per defect so a fix is detectable)
node .verify-host.mjs --defects
```

The host suite prints one `PASS`/`FAIL` line per check, then a `SUMMARY` section and a
final `RESULT: PASS|FAIL`. Exit code is `1` if any gating check fails.

## Required-check results

All required checks 1–14 from the task specification are implemented and pass.

| Required check | Checks executed | Result |
| --- | --- | --- |
| 1. Plugin applies cleanly (5 tools, 1 section, 1 context, route, command, listener, second apply) | 1.1–1.7 | **PASS** |
| 2. `task_list` on empty ledger | 2.1–2.2 | **PASS** |
| 3. `task_open` id/files/INDEX/duplicate suffix | 3.1–3.5 | **PASS** |
| 4. `task_resume` lease/brief + second-resume `task-leased` (+ 4.4 expired-lease takeover) | 4.1–4.4 | **PASS** |
| 5. `task_checkpoint` evidence/claims/version/conflicts/status-done refusal | 5.1–5.6 | **PASS** |
| 6. Evidence gate → blocked close, report, refutation → done, `force:true` override | 6.1–6.5 | **PASS** |
| 7. Cold start: new ctx/apply + new agent resumes by `task_id` only | 7.1 | **PASS** |
| 8. Prompt briefing text (active task; empty ledger → `''`) | 8.1–8.2 | **PASS** |
| 9. `/api/task-ledger/*` routes incl. 401/503/400/404 and pin/status | 9.1–9.10 | **PASS** |
| 10. Path safety (traversal id; no writes outside root) | 10.1–10.2 | **PASS** |
| 11. `/task` command (`list` success, unknown error, `active` pins) | 11.1–11.3 | **PASS** |
| 12. Config clamp (`leaseTtlSeconds:5` → ~60s) + unknown key audit | 12.1–12.3 | **PASS** |
| 13. Client cross-check (loader shape, route parity, locales, icon, imports, colors) | 13.1 + C1–C7 | **PASS** |
| 14. Cold Node process reads the same on-disk state | 14.1 | **PASS** |

### Check detail

| Check | Assertion | Evidence |
| --- | --- | --- |
| 1.1 | `inject === ['tools','systemPrompt']`; exactly 5 unique tools `task_list/open/resume/checkpoint/close`, each with description/execute/parameters/output.render | tools map size 5 |
| 1.2 | exactly 1 section `task-ledger-protocol`; finite numeric order; non-empty text; `interpolate === false` | order 2450 (`getSectionOrder('TOOL_GOAL')+50`) |
| 1.3 | exactly 1 context `task-ledger-briefing`; `text()` is sync; `interpolate === false` | — |
| 1.4 | exactly 1 route `{kind:'prefix', path:'/api/task-ledger', handler}`; `webServer` injected | — |
| 1.5 | exactly 1 command `{name:'task', handler}`; `commands` injected | — |
| 1.6 | exactly 1 `agent/created` listener | — |
| 1.7 | second `apply()` on a fresh stub ctx does not throw; that ctx registers 5/1/1/1/1 | — |
| 2.1 | empty ledger: `ok:true`, `tasks:[]`, `active_task_id:null`, all counts 0, resolved root | — |
| 2.2 | `task_list` render = one `text` block containing “no tasks match” and “pinned none” | — |
| 3.1 | `task_id` matches `^\d{4}-\d{2}-\d{2}-gate-test-task$` | slug from title |
| 3.2 | `task.json`, `state.json`, `decisions.jsonl`, `runs/`, `evidence/` exist; charter title/id; “Task opened” decision | — |
| 3.3 | `INDEX.md` at root, regenerated at open, contains task id | — |
| 3.4 | same title re-opened → id ends `-2`, different from first | — |
| 3.5 | `task_open` render names id, goal, and points at `task_resume` | — |
| 4.1 | `run_id` shape, `lease.run_id`, `session-a`, future `expires_at`; brief has goal + `status: open` | — |
| 4.2 | `state.json.lease` persisted; `last_run_id`; `active.json` pinned | — |
| 4.3 | second resume (session-b) returns object `ok:false`, `error.code:'task-leased'`; first lease untouched | no throw |
| 4.4 | simulated expired lease (`expires_at` past) can be taken over by another run; new session id | *(extra: takeover after lease TTL)* |
| 5.1 | checkpoint: version bumped, phase `evidence`, next_actions, claims 2 / decisions 2 (explicit+note) / evidence 1, gate fails | — |
| 5.2 | stored evidence file exists; file sha256 equals record sha256; content-addressed name prefix; `evidence/index.jsonl` record | — |
| 5.3 | `claim-source.evidence_name` resolved to `sha256:<64 hex>` == stored snapshot hash | — |
| 5.4 | stale `expected_version` → `ok:false`, `version-conflict`; version unchanged | — |
| 5.5 | bogus `run_id` → `ok:false`, `lease-mismatch` | — |
| 5.6 | checkpoint with `status:'done'` → `ok:false`, `invalid-argument` mentioning open/blocked | — |
| 6.1 | requested done + failing gate → `status:'blocked'`; `runs/<run_id>.md` exists, says `evidence gate: fail`, names `claims-resolved` | — |
| 6.2 | `state.json` blocked, gate-derived `blocked_reason`, lease released | — |
| 6.3 | resume again, refute same claim id, close → `done`, `gate.pass:true` | — |
| 6.4 | `claim-gate` history ≥ 2 records (superseded kept); latest = refuted; resolved counts refuted 1 / unverified 0 | latest-record-wins |
| 6.5 | `force:true` + failing gate → `done`; override decision appended with `approved_by:'caller-force'` | — |
| 7.1 | same root, brand-new ctx/apply + agent `session-cold`, only `task_id`: brief non-empty, has id/title/`last_run`/prior summary marker/prior next_actions | no in-memory state |
| 14.1 | `node --input-type=module -e` imports only `ledger.js`, `readTask()` returns same status/version/claims/evidence/runs as the parent process | process-agnostic store |
| 8.1 | empty ledger briefing text is `''` | — |
| 8.2 | after `task_resume` binds active: briefing eventually contains task id, title, “active task”, `task_resume` | polled, no fixed sleep dependency |
| 9.1 | GET `/index` 200; `{ok:true,data:{tasks,counts,activeTaskId,root}}`; content-type JSON; counts.open=2; root resolved | — |
| 9.2 | GET `/task?task_id=` 200; `data.task.summary.task_id`, charter.goal, claims array | — |
| 9.3 | `requestRejection → 401` ⇒ 401, `error.code:'unauthorized'`; `403` forwarded as 403 | — |
| 9.4 | `ctx.get` deleted ⇒ 503, `error.code:'unavailable'` | fails closed |
| 9.5 | POST `/active {task_id}` 200; `active.json.task_id` pinned | — |
| 9.6 | POST `/active {task_id:null}` 200; `active.json.task_id:null` | — |
| 9.7 | POST `/status {blocked,reason}` 200; `state.json` blocked + reason; decision `Status changed open -> blocked`, `approved_by:'panel'` | — |
| 9.8 | POST malformed JSON ⇒ 400 `invalid-argument` | — |
| 9.9 | POST `status:'nonsense'` ⇒ 400 `invalid-argument` | — |
| 9.10 | unknown GET and POST route ⇒ 404 | — |
| 10.1 | `task_resume {task_id:'../../etc'}` ⇒ `ok:false` `invalid-task-id`; `task_open` explicit traversal id likewise | — |
| 10.2 | temp base entries unchanged; no `base/etc`, no `base/tasks`; 0 tasks created | — |
| 11.1 | `/task list` → `{kind:'success'}` with task id and open count | — |
| 11.2 | unknown subcommand → `{kind:'error'}` with usage text | — |
| 11.3 | `/task active <id>` → success; `active.json.task_id` + session id | — |
| 12.1 | `apply()` with `leaseTtlSeconds:5` + unknown key does not throw; tools/section/route still registered | `apply()` returns nothing in this contract, so clamping is proven behaviourally in 12.2 |
| 12.2 | resume lease `expires_at` ≈ now+60s (50s < Δ < 120s), not 5s | clamp verified |
| 12.3 | `audit.jsonl` has `config-warning` naming the ignored key | — |
| 4.4 | expired `lease.expires_at` (past) can be taken over by a second run; old run_id not reused; new session id recorded | simulated clock |
| 13.1 | spawns `.verify-client.mjs`; 7/7 child checks pass, zero child FAIL | see below |

## Client cross-check (`.verify-client.mjs`)

| Check | Assertion | Result |
| --- | --- | --- |
| C1 | `node --check client.js` | **PASS** (75,393 bytes) |
| C2 | `window.__ModuleLoader__.load({id, factory})`, id `dsh-task-ledger`, factory returns `{inject:['slots','locale'], apply}` (vm sandbox, factory actually invoked with a fake `react`) | **PASS** |
| C3 | `API_PREFIX === '/api/task-ledger'`; client fetch paths `{/index,/task,/status,/active}` exactly equal the routes implemented in `index.js`; `credentials:'same-origin'` | **PASS** — no missing/unused route |
| C4 | `locale/zh.json` + `locale/en.json` parse; `meta.title` / `meta.description` non-empty | **PASS** (`任务账本`, `Task ledger`) |
| C5 | `icon.svg` well-formed XML, single `<svg>` root, SVG `xmlns`, `currentColor` | **PASS** (575 bytes) |
| C6 | no `@deepseek-ai/` references in `client.js`; only `require('react')` | **PASS** |
| C7 | 0 hard-coded color literals (`#rgb(a)`, `rgb()/hsl()`); 13 distinct `--dsw-alias-*` theme tokens used | **PASS** |

`client.js`: no contract defects found. The four fetched paths, response shapes it reads
(`data.tasks/counts/activeTaskId/root`, `data.task.summary|charter|claims`, `data.state`,
`data.activeTaskId`), locale/icon packaging and bundle metadata all line up with the host.

## Known defects (non-gating)

Found by `node .verify-host.mjs --defects`; not part of the required checklist, therefore
not counted as suite failures. Do **not** treat them as install blockers; P1 should be
fixed soon because it can silently destroy a charter.

### P1 — `task_open` is not id-atomic: concurrent same-title opens collide; explicit duplicate id overwrites the “immutable” charter

- File/function: `ledger.js` → `createTask()` (`ledger.js:298`) and
  `allocateTaskId()` (`ledger.js:348`); writer at `ledger.js:330`.
- Expected: the second open either allocates `-2`/`-3` or fails with a `LedgerError`
  (`task-exists`). A charter is immutable, so it must never be overwritten.
- Actual (probe D4): `Promise.all([task_open('Race Title', goal g1), task_open('Race Title', goal g2)])`
  → both return `ok:true` with the **same** `task_id`, one directory exists afterwards and
  the surviving `task.json.goal` is `g2` — the first task is silently lost.
- Actual (probe D6): `task_open({task_id:'explicit-dup-probe', goal:'original'})` twice →
  second call succeeds and `task.json.goal` becomes `'overwritten charter'`.
- Why: `allocateTaskId` checks `pathExists(...)` without a root-level lock; `createTask`
  then `mkdir -p` + `atomicWriteJson` with no `EEXIST`/presence guard, so two interleavings
  both pass the check and last-writer-wins. Same class for an explicit `task_id`.
- Suggested fix: allocate the id under a root-level lock (or retry on `EEXIST` with
  `fs.mkdir(taskDir, {recursive:false})` / `fs.open(task.json,'wx')`), and refuse an
  explicit `task_id` whose `task.json` already exists with `code:'task-exists'`.

### P2 — unknown-but-well-formed `task_id` surfaces a raw `ENOENT … .write.lock` instead of `task-not-found` (also causes a 500 on POST `/status`)

- File/function: `ledger.js` → `withTaskLock()` (`ledger.js:203`, `fs.open(lockPath,'wx')` at
  `ledger.js:209`) is called **before** any presence check in `resumeTask()`
  (`ledger.js:501`) and `setTaskStatus()` (`ledger.js:1131`).
- Expected: `LedgerError` with `code:'task-not-found'` (and HTTP 400/404 from the panel).
- Actual (probe D2): `task_resume({task_id:'2099-01-01-does-not-exist'})` →
  `{ok:false,error:{code:'task-ledger-error', message:"ENOENT: no such file or directory,
  open '…/tasks/2099-01-01-does-not-exist/.write.lock'"}}`; the hint tells the model to
  “report this in the run report”, which is misleading.
- Actual (probe D3): POST `/api/task-ledger/status` for the same id → HTTP **500** with
  `code:'ENOENT'` (route error mapping at `index.js:717`); `/task block <unknown-id>` returns
  the same raw ENOENT text.
- Suggested fix: read/presence-check the task (or `pathExists(taskDir)`) before
  `withTaskLock`, throwing `task-not-found`; alternatively have `withTaskLock` translate a
  missing task dir into `task-not-found`. Then let the route layer return 404 for
  `task-not-found` (see P4).

### P3 — `readTask().runs` / `summary.run_count` double-count every run

- File/function: `ledger.js` → `latestRuns()` (`ledger.js:376`) does not dedupe by
  `run_id`, while `resumeTask()` appends an “open” record (`ledger.js:533`) and
  `closeTask()` appends a second “closed” record (`ledger.js:918`) for the **same**
  `run_id`.
- Expected: one run entry per run (with `ended_at`/`summary` after close); `run_count: 1`
  for a task with one run; the brief's `last_run` unambiguous.
- Actual (probe D1): after one resume + one close, `readTask().runs.length === 2`,
  `summarizeTask().run_count === 2`, both entries carry the same `run_id`; the panel’s
  run count and `/task show` inherit the inflated number.
- Suggested fix: dedupe runs by `run_id` in `latestRuns()` preferring the record with
  `ended_at`/`summary` (or skip appending the open stub and write/update a single record).

### P4 — `GET /api/task-ledger/task` for an unknown task returns 500, expected 404

- File/function: `index.js` → `dispatchRoute()` error mapping (`index.js:717`) maps only
  `invalid-argument` / `invalid-task-id` to 400 and everything else to 500.
- Expected: HTTP 404 with `code:'task-not-found'` (the body already carries that code).
- Actual (probe D5): HTTP 500 `{ok:false,error:{message:"No task ledger named …",
  code:"task-not-found"}}`. The panel still shows the message, but the status is wrong and
  clients cannot distinguish “gone” from “server error”.
- Suggested fix: add `task-not-found` (and `run-not-found`) → 404 in the route mapping.

### P5 — `GET /api/task-ledger/index?status=<invalid>` is silently accepted

- File/function: `index.js` route `GET /index` (`index.js:679`) forwards the raw `status`
  query to `ledgerOverview()` → `listTasks()`, which filters by exact status; no
  validation (unlike `task_list`, which rejects invalid values).
- Expected: 400 `invalid-argument` (parity with the tool) or clamping to `all`.
- Actual: 200 with an empty/oddly filtered list. Low impact (the bundled panel always
  sends `status=all`), but it hides client bugs.

## Install-time / residual risks

These cannot be fully decided by a stub harness; the runtime test that decides each is
listed; they are post-install checks.

| Risk | Runtime test |
| --- | --- |
| Real Cordis may resolve `ctx.inject(['webServer'])` / `(['commands'])` **asynchronously** (stub calls the callback synchronously). If the services are not yet available, route/command registration may land later or not at all. | After restart: `/task list` returns success in a real session, and `GET /api/task-ledger/index` answers 200 (not 404/503). |
| Real `connection.requestRejection({headers})` admission semantics (cookie/session headers). Stub covers 401/403/missing only. | Load the panel in the Web UI while signed in; also request the route without a session and confirm 401/403, not 200. |
| Panel rendering, layout, locale switch, icon look, and interaction (pin/status buttons) are browser-only. | Open the Web UI, open the “任务账本” sidebar panel, pin/unpin a task, toggle a status, confirm the list/detail refresh and theme tokens render correctly. |
| Real Web UI module loader contract (`window.__ModuleLoader__.load`, id, `inject:['slots','locale']`, slot names `sidebar.panellist`/`main`) is exercised only structurally by the vm check. | Panel appears under the sidebar list and mounts its page; no console error on load. |
| Lease TTL expiry was verified with a simulated clock (4.4), not by waiting 60 min. | Optional: create a task, resume, wait TTL (or restart after expiry), resume from another session → should succeed and report a new `run_id`. |
| Real filesystem permission/profile path (`~/.dsh/task-ledger`) not exercised; harness roots are under `/tmp`. | After install, confirm the ledger root exists and `INDEX.md`/`audit.jsonl` appear at the configured `rootDir`. |

## Notes / observations (not defects)

- `apply()` currently returns `undefined` (no `{root, config}`). This is fine for the
  Cordis contract and is how the installed bundle behaves; the harness verifies config
  clamping behaviourally (12.2). If an external test expected the return value, it is gone.
- `task_list`'s render prints a literal `v?` placeholder for the version column
  (`index.js` `task_list` render). Cosmetic only; `task_list` data carries `version`.
- `task_checkpoint` may reject a verify attempt whose claims are validated before the task
  lock; no partial writes were observed in any negative test (5.4, 5.5, 5.6, 10.x).
- Temp roots are created with `fs.mkdtemp('/tmp/dsh-task-ledger-verify-*')`; the suite
  asserts they are gone before exit (0 leftovers observed).

## Raw suite output (tail)

```
# 12 config
PASS  12.1  apply() tolerates an unknown config key and an out-of-range leaseTtlSeconds
PASS  12.2  a resume lease uses the clamped TTL (about 60s), not the requested 5s
PASS  12.3  the ignored config key leaves a config-warning audit record

# 13 client bundle contract
PASS  C1  node --check client.js passes  [75393 bytes]
PASS  C2  window.__ModuleLoader__.load receives {id:"dsh-task-ledger", factory}  [inject=[slots, locale]]
PASS  C3  client fetch paths match the four host /api/task-ledger routes  [client={/index,/task,/status,/active} host={/index,/task,/status,/active}]
PASS  C4  locale JSON is valid and carries meta.title/meta.description  [zh:"任务账本" en:"Task ledger"]
PASS  C5  icon.svg is well-formed XML with an <svg> root  [575 bytes, root <svg>]
PASS  C6  client.js imports no @deepseek-ai/ packages  [requires=[react]]
PASS  C7  no hard-coded colors outside artwork; theme tokens are used instead  [13 theme token(s), 0 color literals]
PASS  13.1  client bundle cross-check passes (.verify-client.mjs)  [7 client checks passed]

cleanup: removed 8 temp root(s) under /tmp

================ SUMMARY ================
checks: 52   PASS: 52   FAIL: 0
RESULT: PASS
```

---

## Post-fix re-verification (v1.0.1)

All six known defects were fixed after the report above; the bundle was bumped to
`1.0.1`, and both suites plus the defect probes were re-run. Per-defect changes:

| Defect | Fix |
| --- | --- |
| P1 (`createTask` id race / charter overwrite) | task directory is claimed with a non-recursive `mkdir` (atomic reserve); auto ids retry `-2..-200` on `EEXIST`, explicit duplicate ids fail with `task-exists`; a failed write removes the claimed dir |
| P2 (raw `ENOENT .write.lock`) | `withTaskLock` maps a missing task directory to `task-not-found`; resume/status no longer leak ENOENT |
| P3 (runs double-counted) | `latestRuns` folds open/closed records by `run_id`, preferring the closed record |
| P4 (`task-not-found` → 500) | route error mapping: `invalid-*` → 400, `task-not-found`/`run-not-found` → 404, `task-exists`/`ledger-busy` → 409 |
| P5 (`?status=` unvalidated) | `GET /index` rejects unknown status values with 400 |
| `expected_version` UX (found in live cold-start) | `task_resume` render now prints `state version: N — use this as expected_version`; the conflict hint names the current version |

Re-run output (same commands as above):

```text
node .verify-client.mjs                  → client checks: 7  PASS: 7  FAIL: 0  RESULT: PASS
node .verify-host.mjs                    → checks: 52  PASS: 52  FAIL: 0  RESULT: PASS
node .verify-host.mjs --defects          → known defects: 0 observed, 6 fixed
                                           FIXED D1 D2 D3 D4 D5 D6
```

Updated source hashes (re-run the suites if any of these change again):

| File | sha256 |
| --- | --- |
| `index.js` | `70d62a082252499d9b4e6f0df87f5e95595fb9d5edd4ec3bf8cda0c6f5ba9b7e` |
| `ledger.js` | `850752736da504fe74bc9673422c9afcc1449980bb8a4e1cf0778e145b0e3d8f` |
| `client.js` | `4f5aee4d99ae8ba42863a3932e39a58c4b217f144b95bf3ddb9ca9023c696699` (unchanged) |

Live confirmation after reinstalling `1.0.1` (bundle is a linked directory, so the
running Harness kept the old module generation until remove+install): calling
`task_resume` with an unknown id now returns `code: task-not-found`, and the runtime
context run counter no longer doubles. The panel still needs a browser refresh to show
the v1.0.1 client module.
