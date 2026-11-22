/**
 * Prompt wording for `dsh-archive-rsi`.
 *
 * The static section is the contract the model needs before it can use the two
 * tool families; the lessons block is the RSI output that previous PDCA runs
 * adopted. Both live here so `index.js` stays wiring.
 */

export const SECTION_NAME = 'tool:archive-rsi';
export const LESSONS_TITLE = '## Archive lessons (adopted by RSI runs)';

/** Hard ceiling for the adopted-lessons block, in characters. */
export const MAX_LESSONS_CHARS = 4096;

/**
 * The static protocol section. Deliberately short: this plugin exists to shrink
 * context waste, so it must not become a new source of it.
 */
export function protocolText() {
  return [
    '## Session archive + PDCA alchemy',
    '',
    '`~/.dsh/sessions` is append-only history. Three tools curate and mine it:',
    '- `session_archive` — action: list | sync | read | update | autotag | delete.',
    '  Curation the harness lacks: tags, notes, pin/trash, transcript pages.',
    '- `rsi` — action: plan | run | status. `run` syncs, computes the cohort',
    '  metrics and compares them with targets and the previous run; `status`',
    '  re-measures adopted proposals against the sessions after adoption.',
    '- `rsi_apply` — action: act | adopt. `act` turns a run\'s findings into',
    '  proposals (prompt lessons, AGENTS.md rules, skill candidates); `adopt`',
    '  applies or reverts one (backup first, reversible).',
    '',
    'Prefer a `rsi` run over guessing when asked "why is this session style',
    'expensive". Never adopt a proposal without reading its evidence. Adopted',
    'lessons appear below.',
  ].join('\n');
}

/**
 * Clamp and frame the stored lessons text for prompt injection.
 *
 * @param text - contents of `<root>/lessons.md`, possibly empty.
 * @returns the block to append to the section, or `''` when there is nothing to say.
 */
export function lessonsBlock(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return '';
  const capped =
    trimmed.length > MAX_LESSONS_CHARS
      ? `${trimmed.slice(0, MAX_LESSONS_CHARS)}\n… [lessons truncated]`
      : trimmed;
  return `${LESSONS_TITLE}\n${capped}`;
}
