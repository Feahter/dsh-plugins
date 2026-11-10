/**
 * Minimal, dependency-free YAML frontmatter support for SKILL.md files.
 *
 * DSH reads `name`, `description`, `whenToUse` and optional nested metadata
 * from the YAML block. This module intentionally implements only the YAML
 * subset skill files actually use: top-level scalar keys, single/double
 * quoted scalars (including line-wrapped ones), and literal/folded block
 * scalars. Anything nested is ignored rather than guessed at.
 */

export class FrontmatterError extends Error {
  constructor(message, code = 'invalid-frontmatter') {
    super(message);
    this.name = 'FrontmatterError';
    this.code = code;
  }
}

/** Detect the dominant line ending so rewrites do not silently flip it. */
function lineEnding(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Split a SKILL.md into frontmatter lines and body lines.
 * @param {string} raw
 * @returns {{ lines: string[], frontmatter: string[], bodyLines: string[], bodyStartLine: number, eol: string }}
 */
export function splitFrontmatter(raw) {
  const source = String(raw ?? '').replace(/^\uFEFF/, '');
  const eol = lineEnding(source);
  const lines = source.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    throw new FrontmatterError('SKILL.md must start with a --- frontmatter block');
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close < 0) throw new FrontmatterError('frontmatter is missing its closing ---');
  return {
    lines,
    frontmatter: lines.slice(1, close),
    bodyLines: lines.slice(close + 1),
    bodyStartLine: close + 2, // 1-based first body line
    eol,
  };
}

function unescapeDoubleQuoted(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parseQuoted(lines, startIndex, rest) {
  const quote = rest[0];
  let value = rest.slice(1);
  let index = startIndex;
  // A closing quote is an unescaped " for double quotes, or two '' in a row
  // (YAML's escape) for single quotes.
  const isClosed = (text) => {
    if (quote === '"') {
      let escaped = false;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') return i;
      }
      return -1;
    }
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") { i += 1; continue; }
        return i;
      }
    }
    return -1;
  };

  let close = isClosed(value);
  while (close < 0 && index + 1 < lines.length) {
    index += 1;
    value += '\n' + lines[index];
    close = isClosed(value);
  }
  if (close < 0) throw new FrontmatterError('unterminated quoted frontmatter value');
  const inner = value.slice(0, close);
  return {
    value: quote === '"' ? unescapeDoubleQuoted(inner) : inner.replace(/''/g, "'"),
    endIndex: index,
  };
}

function parseBlockScalar(lines, startIndex, marker) {
  const folded = marker.startsWith('>');
  const chomp = marker.includes('-') ? 'strip' : marker.includes('+') ? 'keep' : 'clip';
  const raw = [];
  let index = startIndex;
  let indent = null;
  while (index + 1 < lines.length) {
    const next = lines[index + 1];
    if (next.trim() === '') {
      raw.push('');
      index += 1;
      continue;
    }
    const leading = next.match(/^(\s*)/)[1].length;
    if (leading === 0) break;
    if (indent === null) indent = leading;
    if (leading < indent) break;
    raw.push(next.slice(indent));
    index += 1;
  }
  let value;
  if (folded) {
    value = '';
    raw.forEach((line, i) => {
      if (i === 0) value = line;
      else if (line === '') value += '\n';
      else value += (value.endsWith('\n') ? '' : ' ') + line;
    });
  } else {
    value = raw.join('\n');
  }
  if (chomp === 'strip') value = value.replace(/\n+$/, '');
  else if (chomp === 'clip') value = value.replace(/\n*$/, '\n');
  return { value, endIndex: index };
}

function stripInlineComment(value) {
  // YAML comments need a preceding space; do not eat URLs or `#` anchors.
  return value.replace(/\s+#[^\n]*$/, '').trim();
}

/**
 * Parse a SKILL.md frontmatter block.
 * @param {string} raw
 * @returns {{ data: Record<string, unknown>, body: string, bodyStartLine: number, frontmatterRaw: string }}
 */
export function parseSkillMarkdown(raw) {
  const split = splitFrontmatter(raw);
  const data = {};
  const lines = split.frontmatter;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s/.test(line)) continue; // nested values are ignored
    const match = /^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(line);
    if (!match) continue;
    const [, key, rawValue = ''] = match;
    const value = rawValue.trim();
    if (value === '') {
      data[key] = '';
      continue;
    }
    if (/^[|>][+-]?\s*$/.test(value)) {
      const block = parseBlockScalar(lines, i, value);
      data[key] = block.value;
      i = block.endIndex;
      continue;
    }
    if (value[0] === '"' || value[0] === "'") {
      const quoted = parseQuoted(lines, i, value);
      data[key] = quoted.value;
      i = quoted.endIndex;
      continue;
    }
    data[key] = stripInlineComment(value);
  }
  const body = split.bodyLines.join('\n');
  return {
    data,
    body,
    bodyStartLine: split.bodyStartLine,
    frontmatterRaw: split.frontmatter.join('\n'),
  };
}

/** Quote a scalar as a single-line YAML double-quoted string. */
export function quoteYaml(value) {
  return JSON.stringify(String(value ?? ''));
}

/**
 * Locate the line span of a top-level key inside frontmatter.
 * @returns {{ start: number, end: number } | null} indexes into the frontmatter array
 */
function fieldSpan(lines, key) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(line);
    if (!match || match[1] !== key) continue;
    const value = (match[2] || '').trim();
    if (/^[|>][+-]?\s*$/.test(value)) {
      const block = parseBlockScalar(lines, i, value);
      return { start: i, end: block.endIndex };
    }
    if (value[0] === '"' || value[0] === "'") {
      const quoted = parseQuoted(lines, i, value);
      return { start: i, end: quoted.endIndex };
    }
    return { start: i, end: i };
  }
  return null;
}

/**
 * Replace one top-level scalar field, preserving every other byte of the
 * document (apart from the field's own lines).
 * @param {string} raw
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
export function replaceField(raw, key, value) {
  const split = splitFrontmatter(raw);
  const fm = split.frontmatter.slice();
  const span = fieldSpan(fm, key);
  const rendered = `${key}: ${quoteYaml(value)}`;
  if (span) fm.splice(span.start, span.end - span.start + 1, rendered);
  else fm.push(rendered);
  const lines = ['---', ...fm, '---', ...split.bodyLines];
  return lines.join(split.eol);
}

/**
 * Replace the body of a SKILL.md, keeping the frontmatter block verbatim.
 * @param {string} raw
 * @param {string} body
 * @returns {string}
 */
export function replaceBody(raw, body) {
  const split = splitFrontmatter(raw);
  const bodyLines = String(body ?? '').split(/\r?\n/);
  const lines = [...split.lines.slice(0, split.bodyStartLine - 1), ...bodyLines];
  return lines.join(split.eol);
}

/** Render a fresh SKILL.md from fields (used by tests and future templates). */
export function renderSkillMarkdown({ name, description, body = '', extra = {} }) {
  const fm = [`name: ${quoteYaml(name)}`, `description: ${quoteYaml(description)}`];
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) fm.push(`${key}: ${quoteYaml(value)}`);
  }
  return ['---', ...fm, '---', '', String(body).replace(/^\n+/, '')].join('\n');
}
