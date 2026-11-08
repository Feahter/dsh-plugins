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
    '`~/.dsh/sessions` is append-only history. `archive_*` tools give it curation',
    'the harness lacks: sync, tag, note, pin, trash, read, delete.',
    '',
    '`rsi_*` tools run a PDCA loop over that archive:',
    '- `rsi_plan` fixes a cohort and target metrics; `rsi_run` does plan+do+check;',
    '- `rsi_act` turns findings into proposals; `rsi_adopt` applies one (reversible);',
    '- `rsi_status` re-evaluates adopted proposals against later sessions.',
    '',
    'Prefer a run over guessing when asked "why is this session style expensive".',
    'Never adopt a proposal without reading its evidence. Adopted lessons appear below.',
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
