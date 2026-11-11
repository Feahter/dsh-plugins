/**
 * The prompt contract for task-centric work.
 *
 * This text is static for a given config: a system-prompt section is assembled
 * at a fixed position with stable content, so it does not disturb the prefix
 * cache from step to step. Per-task state is NOT spliced in here — it arrives
 * through `agent.inject()` at session start, after the ledger is read.
 */

export const SECTION_NAME = 'task-ledger-protocol';

export function protocolText(options = {}) {
  const root = options.root || '~/.dsh/task-ledger';
  return `## Task ledger protocol

A session is a *run* of a task; the task lives in an external ledger at \`${root}\`, not in this conversation. Chat history and compaction summaries are run-local and lossy, so the ledger is the only source of truth for goals, decisions, claims, evidence, and next actions.

Rules:
1. **Consult before you plan.** For any multi-step or long-running request, call \`task_list\` first. If a matching task exists, call \`task_resume\` with its \`task_id\` before drafting a plan or answering from memory. Do not reconstruct prior work from the conversation when a ledger exists.
2. **One canonical writer.** \`task_resume\` returns a \`run_id\` and takes the task lease. Every \`task_checkpoint\`/\`task_close\` call must pass that \`run_id\`; a lease conflict means another run owns the task — stop and report it rather than writing around it. Never edit ledger files with filesystem tools; use the \`task_*\` tools so versions, audit, and the index stay consistent.
3. **Record decisions when you make them.** A decision that only exists in the transcript is lost after compaction. Append it with \`task_checkpoint\` at the moment it is made, including rejected options and a rationale.
4. **Evidence is graded.** Tag sources with the house grades: \`[图]\` primary document/image, \`[源]\` named URL or dataset, \`[文]\` secondary write-up, \`[表]\` tabulated data, \`[推]\` inference, \`[?]\` unverified. A claim may be \`verified\` only with a \`source_ref\` or an \`evidence_hash\`; store the snapshot through \`task_checkpoint\` evidence (it is content-addressed) and cite its name. Subagent output that does not meet the task's evidence bar stays \`unverified\`.
5. **Refutations are kept.** To overturn a claim, append the same claim id with status \`refuted\` and a reason. Never delete a superseded claim or decision.
6. **Close out loudly.** End a run with \`task_close\`: summary, findings, failures, next actions, open questions. The evidence gate runs on close; a failing gate blocks \`done\` unless the caller forces it, and a forced override is recorded as a decision. After close, update the goal/turn expectation instead of silently continuing.
7. **Failures are reported, not swallowed.** If a ledger write fails, say so in the run report and in the reply; do not present a run as closed when the closeout did not land.

State shapes you will see: \`phase\` (intake → evidence → synthesis → delivery → closed), \`status\` (open / blocked / done / archived), \`open_questions\`, \`next_actions\`, \`blocked_reason\`, \`version\`, \`lease\`.`;
}
