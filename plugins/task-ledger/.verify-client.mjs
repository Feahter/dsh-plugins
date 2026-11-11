#!/usr/bin/env node
/**
 * Client-side contract cross-check for the `dsh-task-ledger` bundle.
 *
 * Static, install-free: it verifies that `client.js` is syntactically valid,
 * loads through the Harness Web module loader with the expected id, calls the
 * same `/api/task-ledger/*` routes the host half implements, ships valid
 * locale metadata, a well-formed icon, no Harness package imports, and no
 * hard-coded colors outside artwork (theme tokens instead).
 *
 * Usage: node task-ledger/.verify-client.mjs
 * Exit code 0 only when every check passes.
 */

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, 'client.js');
const HOST = path.join(HERE, 'index.js');
const LOCALES = ['zh', 'en'].map((name) => ({ name, file: path.join(HERE, 'locale', `${name}.json`) }));
const ICON = path.join(HERE, 'icon.svg');

const results = [];
let pass = 0;
let fail = 0;

function ok(id, description, detail) {
  pass += 1;
  results.push({ id, description, ok: true, detail });
  console.log(`PASS  ${id}  ${description}${detail ? `  [${detail}]` : ''}`);
}

function ko(id, description, detail) {
  fail += 1;
  results.push({ id, description, ok: false, detail });
  console.log(`FAIL  ${id}  ${description}  [${detail}]`);
}

async function check(id, description, fn) {
  try {
    const detail = await fn();
    ok(id, description, typeof detail === 'string' ? detail : '');
  } catch (error) {
    ko(id, description, (error && error.message) || String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Strict-enough XML well-formedness check for a small SVG: every tag is
 * balanced, there is exactly one root element, and it is <svg>. Attributes are
 * opaque (quoted), comments and the XML declaration are skipped.
 */
function checkSvg(text) {
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let rootCount = 0;
  let rootName = null;
  let match;
  let lastIndex = 0;
  while ((match = tagRe.exec(stripped))) {
    const between = stripped.slice(lastIndex, match.index);
    if (between.includes('<')) throw new Error(`stray "<" before tag at offset ${match.index}`);
    lastIndex = tagRe.lastIndex;
    const closing = match[1] === '/';
    const name = match[2];
    const selfClosing = match[4] === '/';
    if (closing) {
      const top = stack.pop();
      if (top !== name) throw new Error(`mismatched closing tag </${name}>, expected </${top || 'nothing'}>`);
    } else {
      if (stack.length === 0) {
        rootCount += 1;
        rootName = name;
      }
      if (!selfClosing) stack.push(name);
    }
  }
  const tail = stripped.slice(lastIndex);
  if (tail.includes('<')) throw new Error('stray "<" after the last tag');
  if (stack.length) throw new Error(`unclosed tag <${stack[stack.length - 1]}>`);
  if (rootCount !== 1) throw new Error(`expected exactly 1 root element, found ${rootCount}`);
  if (rootName !== 'svg') throw new Error(`root element is <${rootName}>, expected <svg>`);
  if (!/\sxmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(text)) throw new Error('root <svg> has no SVG xmlns');
}

async function main() {
  const clientSource = await fs.readFile(CLIENT, 'utf8');
  const hostSource = await fs.readFile(HOST, 'utf8');

  await check('C1', 'node --check client.js passes', async () => {
    execFileSync(process.execPath, ['--check', CLIENT], { encoding: 'utf8', timeout: 60_000 });
    return `${Buffer.byteLength(clientSource, 'utf8')} bytes`;
  });

  await check('C2', 'window.__ModuleLoader__.load receives {id:"dsh-task-ledger", factory}', async () => {
    const captured = [];
    const sandbox = {
      window: { __ModuleLoader__: { load(definition) { captured.push(definition); } } },
      console,
    };
    vm.runInNewContext(clientSource, sandbox);
    assertEqual(captured.length, 1, 'load() call count');
    const definition = captured[0];
    assertEqual(definition.id, 'dsh-task-ledger', 'module id');
    assertEqual(typeof definition.factory, 'function', 'factory type');
    const Exported = definition.factory((name) => {
      if (name === 'react') {
        return {
          createElement: () => null,
          useState: () => [null, () => {}],
          useEffect: () => {},
          useCallback: (fn) => fn,
          useMemo: (fn) => fn(),
          useRef: () => ({ current: null }),
          Fragment: 'fragment',
        };
      }
      throw new Error(`unexpected require(${JSON.stringify(name)}) at factory load`);
    });
    assert(Exported && typeof Exported === 'object', 'factory must return the plugin object');
    assert(Array.isArray(Exported.inject), 'plugin inject list missing');
    for (const service of ['slots', 'locale']) {
      assert(Exported.inject.includes(service), `plugin inject is missing "${service}"`);
    }
    assertEqual(typeof Exported.apply, 'function', 'plugin apply');
    return `inject=[${Exported.inject.join(', ')}]`;
  });

  await check('C3', 'client fetch paths match the four host /api/task-ledger routes', async () => {
    const prefixMatch = clientSource.match(/const\s+API_PREFIX\s*=\s*'([^']+)'/);
    assert(prefixMatch, 'API_PREFIX constant not found in client.js');
    assertEqual(prefixMatch[1], '/api/task-ledger', 'API_PREFIX');
    const clientPaths = [...clientSource.matchAll(/\bapi\(\s*'([^']+)'/g)].map((match) => match[1].split('?')[0]);
    const clientRoutes = new Set(clientPaths.map((entry) => entry.replace(/\/+$/, '')));
    assert(clientRoutes.size >= 4, `client calls only ${clientRoutes.size} distinct api paths: ${[...clientRoutes].join(', ')}`);
    const hostRoutes = new Set(
      [...hostSource.matchAll(/route === '([^']+)'/g)]
        .map((match) => match[1])
        .filter((route) => route !== '/'),
    );
    for (const route of hostRoutes) {
      assert(route.startsWith('/'), `unexpected host route form: ${route}`);
    }
    const missingOnHost = [...clientRoutes].filter((route) => !hostRoutes.has(route));
    const unusedOnClient = [...hostRoutes].filter((route) => !clientRoutes.has(route));
    assert(missingOnHost.length === 0, `client calls routes the host does not implement: ${missingOnHost.join(', ')}`);
    assert(unusedOnClient.length === 0, `host implements routes the client never calls: ${unusedOnClient.join(', ')}`);
    assert(clientSource.includes('credentials: \'same-origin\''), 'client fetch does not send same-origin credentials');
    return `client={${[...clientRoutes].join(',')}} host={${[...hostRoutes].join(',')}}`;
  });

  await check('C4', 'locale JSON is valid and carries meta.title/meta.description', async () => {
    const summary = [];
    for (const locale of LOCALES) {
      const text = await fs.readFile(locale.file, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(`${locale.name}.json is not valid JSON: ${error.message}`);
      }
      assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${locale.name}.json must be an object`);
      assert(parsed.meta && typeof parsed.meta === 'object', `${locale.name}.json has no meta object`);
      assert(typeof parsed.meta.title === 'string' && parsed.meta.title.trim(), `${locale.name}.meta.title missing/empty`);
      assert(typeof parsed.meta.description === 'string' && parsed.meta.description.trim().length > 10, `${locale.name}.meta.description missing/too short`);
      summary.push(`${locale.name}:"${parsed.meta.title}"`);
    }
    return summary.join(' ');
  });

  await check('C5', 'icon.svg is well-formed XML with an <svg> root', async () => {
    const text = await fs.readFile(ICON, 'utf8');
    checkSvg(text);
    assert(text.includes('currentColor'), 'icon does not inherit currentColor');
    return `${Buffer.byteLength(text, 'utf8')} bytes, root <svg>`;
  });

  await check('C6', 'client.js imports no @deepseek-ai/ packages', async () => {
    const matches = clientSource.match(/@deepseek-ai\/[A-Za-z0-9._/-]+/g) || [];
    assertEqual(matches.length, 0, `found Harness package references: ${[...new Set(matches)].join(', ')}`);
    const requires = [...clientSource.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
    const allowed = new Set(['react']);
    const unexpected = requires.filter((name) => !allowed.has(name));
    assertEqual(unexpected.length, 0, `unexpected require() targets: ${unexpected.join(', ')}`);
    return `requires=[${[...new Set(requires)].join(',')}]`;
  });

  await check('C7', 'no hard-coded colors outside artwork; theme tokens are used instead', async () => {
    const hex = clientSource.match(/(?<![\w&-])#[0-9a-fA-F]{3,8}\b/g) || [];
    const rgb = clientSource.match(/\brgba?\s*\(/g) || [];
    const hsl = clientSource.match(/\bhsla?\s*\(/g) || [];
    const literals = [...hex, ...rgb, ...hsl];
    const tokens = (clientSource.match(/--dsw-alias-[A-Za-z0-9-]+/g) || []);
    const tokenSet = new Set(tokens);
    assert(tokens.length > 0, 'client.js uses no --dsw-alias-* theme tokens');
    assertEqual(literals.length, 0, `hard-coded color literal(s): ${[...new Set(literals)].join(', ')}`);
    return `${tokenSet.size} theme token(s), 0 color literals`;
  });

  console.log(`\nclient checks: ${pass + fail}   PASS: ${pass}   FAIL: ${fail}`);
  if (fail > 0) {
    console.log('client RESULT: FAIL');
    for (const record of results) {
      if (!record.ok) console.log(`FAILED  ${record.id}  ${record.description} — ${record.detail}`);
    }
    process.exit(1);
  }
  console.log('client RESULT: PASS');
  process.exit(0);
}

main().catch((error) => {
  console.error('client verifier crashed:', (error && error.stack) || String(error));
  process.exit(1);
});
