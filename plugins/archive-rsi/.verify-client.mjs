#!/usr/bin/env node
/**
 * Loader smoke test for the `dsh-archive-rsi` client half.
 *
 * `client.js` is a classic script that registers one lazy CJS factory with the
 * page's module loader. This harness reproduces exactly that much of the
 * browser: a stub `window.__ModuleLoader__`, a stub `require('react')`, and a
 * stub slot/locale service. It then asserts the contract from DESIGN §7.4:
 *
 *   - one registration whose id is the package name;
 *   - `factory()` returns `{inject, apply}` with slots + locale injected;
 *   - `apply` registers `sidebar.panellist` and `main`;
 *   - `locale.register` receives zh and en with >100 identical keys;
 *   - the page component renders a non-empty tree.
 *
 * It deliberately makes no claim about visual behaviour in a real browser.
 *
 * Two failure modes are gated, per the acceptance list:
 *   - any module imported other than `react`;
 *   - a module-scope `document` reference that breaks a DOM-less load.
 *
 * Usage: node archive-rsi/.verify-client.mjs
 * Exit code 0 only when every check passes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_NAME = 'dsh-archive-rsi';
const CLIENT = path.join(HERE, 'client.js');
const SOURCE = readFileSync(CLIENT, 'utf8');

// ------------------------------------------------------------------- results

const SUMMARY = { pass: 0, fail: 0, failures: [] };

function printPass(id, description, detail) {
  SUMMARY.pass += 1;
  console.log(`PASS  ${id}  ${description}${detail ? `  [${detail}]` : ''}`);
}

function printFail(id, description, detail) {
  SUMMARY.fail += 1;
  SUMMARY.failures.push(`${id} ${description} — ${detail}`);
  console.log(`FAIL  ${id}  ${description}  [${detail}]`);
}

function check(id, description, fn) {
  try {
    const detail = fn();
    printPass(id, description, typeof detail === 'string' ? detail : '');
  } catch (error) {
    printFail(id, description, (error && error.message) || String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function lineOf(offset) {
  return SOURCE.slice(0, offset).split('\n').length;
}

// Recursively search a stub-react element tree for a text needle. The stub's
// `createElement` keeps children as a nested array/string/null mix, so walking
// it this way is the only reliable way to assert a label survived rendering.
function hasText(node, needle) {
  if (node === null || node === undefined) return false;
  if (typeof node === 'string' || typeof node === 'number') return String(node).indexOf(needle) !== -1;
  if (Array.isArray(node)) return node.some((child) => hasText(child, needle));
  if (typeof node === 'object' && node.children) return hasText(node.children, needle);
  return false;
}

// ------------------------------------------------------------------ stub react

/**
 * Minimal `react`: `createElement` records elements so a component can be called
 * like a function and still yield a tree; hooks return inert values. Returns a
 * fresh module object per factory call so no state leaks between checks.
 */
function makeReact() {
  const created = [];
  const react = {
    created,
    createElement(type, props, ...children) {
      const element = { $$element: true, type, props: props || {}, children };
      created.push(element);
      return element;
    },
    Fragment: Symbol('Fragment'),
    StrictMode: Symbol('StrictMode'),
    createContext(defaultValue) {
      return { $$context: true, defaultValue, Provider: Symbol('Provider') };
    },
    createRef() {
      return { current: null };
    },
    memo(component) {
      return component;
    },
    forwardRef(render) {
      return (props) => render(props, null);
    },
    Children: {
      map(children, fn) {
        return Array.isArray(children) ? children.map(fn) : [];
      },
      toArray(children) {
        return Array.isArray(children) ? children : [children];
      },
      forEach(children, fn) {
        if (Array.isArray(children)) children.forEach(fn);
      },
      count(children) {
        return Array.isArray(children) ? children.length : 0;
      },
      only(children) {
        return children;
      },
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useReducer(reducer, initial, init) {
      return [typeof init === 'function' ? init(initial) : initial, () => {}];
    },
    useEffect() {},
    useLayoutEffect() {},
    useInsertionEffect() {},
    useMemo(factory) {
      return typeof factory === 'function' ? factory() : undefined;
    },
    useCallback(fn) {
      return fn;
    },
    useRef(initial) {
      return { current: typeof initial === 'function' ? initial() : initial };
    },
    useContext(context) {
      return context && 'defaultValue' in context ? context.defaultValue : undefined;
    },
    useId() {
      return ':r0:';
    },
    useTransition() {
      return [false, (fn) => (typeof fn === 'function' ? fn() : undefined)];
    },
    useDeferredValue(value) {
      return value;
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return typeof getSnapshot === 'function' ? getSnapshot() : undefined;
    },
    useImperativeHandle() {},
  };
  react.default = react;
  return react;
}

function requireOnlyReact(react, requested) {
  return (specifier) => {
    requested.push(specifier);
    if (specifier === 'react') return react;
    throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
  };
}

// ------------------------------------------------------------- stub documents

function makeDocumentStub() {
  // `apply` inserts the plugin stylesheet; record it so a check can assert the
  // layout contract that keeps the PDCA panels scrollable.
  const styles = [];
  return {
    __styles: styles,
    querySelector() {
      return null;
    },
    createElement(tagName) {
      const element = { tagName, dataset: {}, textContent: '', remove() {} };
      if (tagName === 'style') styles.push(element);
      return element;
    },
    head: {
      appendChild() {},
    },
  };
}

/**
 * Load `client.js` as a classic script in a fresh vm context.
 * `withDocument:false` is the DOM-less load the acceptance list asks about.
 */
function loadClient({ withDocument }) {
  const registrations = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    TextEncoder,
    TextDecoder,
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration);
        },
      },
    },
  };
  if (withDocument) sandbox.document = makeDocumentStub();
  vm.createContext(sandbox);
  new vm.Script(SOURCE, { filename: 'client.js' }).runInContext(sandbox);
  return { registrations, sandbox };
}

// ===================================================================== checks

console.log('dsh-archive-rsi client verification — stub module loader');
console.log(`client: ${CLIENT}`);

let registration = null;

check('CLI.1', 'client.js loads DOM-less and registers exactly one module', () => {
  let loaded;
  try {
    loaded = loadClient({ withDocument: false });
  } catch (error) {
    const message = (error && error.message) || String(error);
    if (/document/.test(message)) {
      throw new Error(`module-scope document reference breaks a DOM-less load: ${message}`);
    }
    throw new Error(`DOM-less load threw: ${message}`);
  }
  assert(loaded.registrations.length === 1, `expected exactly 1 registration, got ${loaded.registrations.length}`);
  registration = loaded.registrations[0];
  assert(registration && typeof registration === 'object', 'the registration is not an object');
  return 'no document needed at module scope';
});

check('CLI.2', 'the module id equals the package name', () => {
  assert(registration, 'prerequisite: CLI.1 failed');
  assert(registration.id === PACKAGE_NAME, `expected ${JSON.stringify(PACKAGE_NAME)}, got ${JSON.stringify(registration.id)}`);
  assert(typeof registration.factory === 'function', `factory is ${typeof registration.factory}`);
  return registration.id;
});

check('CLI.3', 'client.js imports nothing but react', () => {
  const requires = [...SOURCE.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  const unexpected = [...new Set(requires.filter((specifier) => specifier !== 'react'))];
  assert(unexpected.length === 0, `unexpected require() target(s): ${unexpected.join(', ')}`);
  const esmImports = [...SOURCE.matchAll(/^\s*import\s.+?from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert(esmImports.length === 0, `client.js used ESM import(s) in a classic script: ${esmImports.join(', ')}`);
  const harnessPackages = [...SOURCE.matchAll(/@deepseek-ai\/[A-Za-z0-9._/-]+/g)].map((match) => match[0]);
  assert(harnessPackages.length === 0, `client.js references Harness package(s): ${[...new Set(harnessPackages)].join(', ')}`);
  return `require=[${[...new Set(requires)].join(', ')}]`;
});

check('CLI.4', 'factory() returns {inject, apply} with slots and locale injected', () => {
  assert(registration, 'prerequisite: CLI.1 failed');
  const requested = [];
  const exported = registration.factory(requireOnlyReact(makeReact(), requested));
  assert(exported && typeof exported === 'object', 'factory did not return an object');
  assert(typeof exported.apply === 'function', 'apply is not a function');
  assert(Array.isArray(exported.inject), 'inject is not an array');
  for (const service of ['slots', 'locale']) {
    assert(exported.inject.includes(service), `inject is missing ${JSON.stringify(service)} (got ${JSON.stringify(exported.inject)})`);
  }
  const unexpected = [...new Set(requested.filter((specifier) => specifier !== 'react'))];
  assert(unexpected.length === 0, `factory required unexpected module(s): ${unexpected.join(', ')}`);
  return `inject=[${exported.inject.join(', ')}]`;
});

let applied = null;

check('CLI.5', 'apply() registers sidebar.panellist and main', () => {
  assert(registration, 'prerequisite: CLI.1 failed');
  const react = makeReact();
  const exported = registration.factory(requireOnlyReact(react, []));
  const slots = [];
  const locales = [];
  const ctx = {
    // `apply` runs in a real page, so the document stub is legitimate here; the
    // DOM-less guarantee is asserted at module scope in CLI.1.
    document: makeDocumentStub(),
    effect(fn) {
      const disposer = fn();
      return () => {
        if (typeof disposer === 'function') disposer();
      };
    },
    slots: {
      injected: [],
      inject(name, callback) {
        this.injected.push(name);
        callback();
      },
      register(options, component) {
        slots.push({ options, component });
        return () => {};
      },
    },
    locale: {
      register(namespace, dictionaries) {
        locales.push({ namespace, dictionaries });
      },
    },
  };
  exported.apply(ctx);
  assert(slots.length === 2, `expected 2 slot registrations, got ${slots.length}`);
  for (const name of ['sidebar.panellist', 'main']) {
    assert(ctx.slots.injected.includes(name), `slots.inject was not called for ${name} (got ${ctx.slots.injected.join(', ')})`);
    const entry = slots.find((slot) => slot.options && slot.options.name === name);
    assert(entry, `no registration whose name is ${name} (got ${slots.map((slot) => slot.options && slot.options.name).join(', ')})`);
    assert(typeof entry.component === 'function', `${name} component is not a function`);
  }
  applied = { slots, locales, ctx, react };
  return '2 slots';
});

check('CLI.6', 'locale.register receives zh and en with >100 identical keys', () => {
  assert(applied, 'prerequisite: CLI.5 failed');
  assert(applied.locales.length === 1, `expected 1 locale registration, got ${applied.locales.length}`);
  const [{ namespace, dictionaries }] = applied.locales;
  assert(namespace === 'archive-rsi', `locale namespace: expected "archive-rsi", got ${JSON.stringify(namespace)}`);
  assert(dictionaries && typeof dictionaries === 'object', 'locale.register did not receive a dictionary object');
  for (const language of ['zh', 'en']) {
    const dictionary = dictionaries[language];
    assert(dictionary && typeof dictionary === 'object', `locale.register did not receive a ${language} dictionary`);
    const keys = Object.keys(dictionary);
    assert(keys.length > 100, `${language} dictionary has only ${keys.length} keys, expected >100`);
  }
  const zhKeys = Object.keys(dictionaries.zh).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  const missingInEn = zhKeys.filter((key) => !enKeys.includes(key));
  const missingInZh = enKeys.filter((key) => !zhKeys.includes(key));
  assert(missingInEn.length === 0, `en is missing ${missingInEn.length} key(s): ${missingInEn.slice(0, 5).join(', ')}`);
  assert(missingInZh.length === 0, `zh is missing ${missingInZh.length} key(s): ${missingInZh.slice(0, 5).join(', ')}`);
  return `${zhKeys.length} keys in zh and en`;
});

check('CLI.7', 'the main page component renders a non-empty tree', () => {
  assert(applied, 'prerequisite: CLI.5 failed');
  const main = applied.slots.find((slot) => slot.options && slot.options.name === 'main');
  assert(main, 'no main slot registration');
  // The component closes over the react instance its factory received, so this
  // check must reuse that instance's createElement recorder.
  const react = applied.react;
  react.created.length = 0;
  let tree;
  try {
    tree = main.component({});
  } catch (error) {
    throw new Error(`page component threw while rendering: ${(error && error.message) || error}`);
  }
  assert(tree !== null && tree !== undefined, 'page component returned null/undefined');
  assert(typeof tree === 'object', `page component returned ${typeof tree}`);
  const roots = Array.isArray(tree) ? tree : [tree];
  assert(roots.length > 0, 'page component returned an empty array');
  assert(roots.some((node) => node && typeof node === 'object'), 'page component returned no element objects');
  assert(react.created.length > 0, 'page component created no elements');
  const typed = react.created.filter((element) => element && element.type !== undefined);
  assert(typed.length > 0, 'no created element carried a type');
  return `${react.created.length} elements created`;
});

check('CLI.8', 'the PDCA layout keeps its scroll contract and both locales carry the act labels', () => {
  assert(applied, 'prerequisite: CLI.5 failed');
  // `insertStyles` reads the *global* document, so load a sandbox that has a
  // recording DOM stub and apply the plugin there.
  const loaded = loadClient({ withDocument: true });
  assert(loaded.registrations.length === 1, 'the with-document load did not register the module');
  const exported = loaded.registrations[0].factory(requireOnlyReact(makeReact(), []));
  const ctx = {
    document: loaded.sandbox.document,
    effect(fn) { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    slots: { inject(_name, callback) { callback(); }, register() { return () => {}; } },
    locale: { register() {} },
  };
  exported.apply(ctx);
  const styles = (loaded.sandbox.document && loaded.sandbox.document.__styles) || [];
  const sheet = styles.map((style) => style.textContent || '').join('\n');
  assert(sheet.length > 1000, `the plugin stylesheet was not captured (${sheet.length} chars)`);

  const rules = [
    ['.dsh-archive-rsi-pdca{', 'grid-template-rows:minmax(0,1fr)'],
    ['.dsh-archive-rsi-archive{', 'grid-template-rows:minmax(0,1fr)'],
    ['.dsh-archive-rsi-panels{', 'grid-auto-rows:max-content'],
    ['.dsh-archive-rsi-panel[data-phase="act"]', 'grid-column:1/-1'],
    ['.dsh-archive-rsi-runActBtn', 'margin-left:auto'],
  ];
  const missing = [];
  for (const [selector, declaration] of rules) {
    const start = sheet.indexOf(selector);
    if (start === -1) { missing.push(`${selector} rule missing`); continue; }
    const end = sheet.indexOf('}', start);
    const block = sheet.slice(start, end === -1 ? sheet.length : end);
    if (!block.includes(declaration)) missing.push(`${selector} lacks ${declaration}`);
  }
  const dict = applied.locales[0] && applied.locales[0].dictionaries;
  for (const language of ['zh', 'en']) {
    const table = dict && dict[language];
    if (!table) { missing.push(`no ${language} dictionary`); continue; }
    for (const key of ['generateProposals', 'regenerateProposals', 'proposalsReused', 'runStatusFailed', 'tagAutoHint']) {
      if (typeof table[key] !== 'string' || !table[key]) missing.push(`${language}.${key} missing`);
    }
  }
  if (missing.length) throw new Error(missing.join('; '));
  return `stylesheet ${sheet.length} chars; scroll contract + act labels present in zh/en`;
});

check('CLI.9', 'the transcript viewer grows to a real reading window and keeps its toolbar', () => {
  // Re-apply with a recording DOM stub so the stylesheet is captured, the same
  // way CLI.8 reads the PDCA scroll contract.
  const loaded = loadClient({ withDocument: true });
  assert(loaded.registrations.length === 1, 'the with-document load did not register the module');
  const exported = loaded.registrations[0].factory(requireOnlyReact(makeReact(), []));
  const ctx = {
    document: loaded.sandbox.document,
    effect(fn) { const disposer = fn(); return () => { if (typeof disposer === 'function') disposer(); }; },
    slots: { inject(_name, callback) { callback(); }, register() { return () => {}; } },
    locale: { register() {} },
  };
  exported.apply(ctx);
  const styles = (loaded.sandbox.document && loaded.sandbox.document.__styles) || [];
  const sheet = styles.map((style) => style.textContent || '').join('\n');

  const transcriptStart = sheet.indexOf('.dsh-archive-rsi-transcript{');
  assert(transcriptStart !== -1, '.dsh-archive-rsi-transcript rule missing');
  const transcriptEnd = sheet.indexOf('}', transcriptStart);
  const block = sheet.slice(transcriptStart, transcriptEnd === -1 ? sheet.length : transcriptEnd);
  assert(!/max-height:260px/.test(block), 'the transcript rule still caps height at max-height:260px');
  assert(/min-height:240px/.test(block), 'the transcript rule lacks the min-height:240px floor');
  assert(/height:min\(58vh,640px\)/.test(block), 'the transcript rule lacks height:min(58vh,640px)');
  assert(/white-space:pre-wrap/.test(block), 'the transcript rule lost white-space:pre-wrap');
  assert(/user-select:text/.test(block), 'the transcript rule lost user-select:text');
  assert(sheet.indexOf('.dsh-archive-rsi-transcriptToolbar{') !== -1, '.dsh-archive-rsi-transcriptToolbar rule missing');
  return 'height:min(58vh,640px) with a 240px floor; toolbar present';
});

check('CLI.10', 'the new transcript-viewer keys exist in inline zh/en and in zh/en.json', () => {
  assert(applied, 'prerequisite: CLI.5 failed');
  const NEW_KEYS = ['transcriptLoadMore', 'transcriptLoading', 'transcriptProgress', 'transcriptAllLoaded', 'transcriptLoadFailed'];
  const dict = applied.locales[0] && applied.locales[0].dictionaries;
  assert(dict && dict.zh && dict.en, 'no inline locale dictionaries');
  for (const language of ['zh', 'en']) {
    const inline = dict[language];
    for (const key of NEW_KEYS) {
      assert(typeof inline[key] === 'string' && inline[key].length > 0, `inline ${language}.${key} is missing or empty`);
    }
    let file;
    try {
      file = JSON.parse(readFileSync(path.join(HERE, 'locale', language + '.json'), 'utf8'));
    } catch (error) {
      throw new Error(`cannot parse locale/${language}.json: ${(error && error.message) || error}`);
    }
    for (const key of NEW_KEYS) {
      assert(typeof file[key] === 'string' && file[key].length > 0, `${language}.json.${key} is missing or empty`);
    }
    const inlineSet = NEW_KEYS.filter((key) => inline[key] !== undefined).sort().join('|');
    const fileSet = NEW_KEYS.filter((key) => file[key] !== undefined).sort().join('|');
    assert(inlineSet === fileSet, `${language} transcript key set differs between inline and ${language}.json`);
  }
  return '5 transcript keys consistent across all four dictionaries';
});

check('CLI.11', 'a truncated transcript renders a load-more button that requests an offset', () => {
  // Load in a sandbox that records `fetch` so clicking the real viewer's button
  // can be asserted against the exact URL the chunk loader sends.
  const react = makeReact();
  const registrations = [];
  const requests = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    TextEncoder,
    TextDecoder,
    fetch(url, options) {
      requests.push({ url: String(url), options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { transcript: 'more', transcriptOffset: 24000, transcriptTotal: 100000, transcriptTruncated: false },
        }),
      });
    },
    window: {
      __ModuleLoader__: {
        load(registration) { registrations.push(registration); },
      },
    },
  };
  vm.createContext(sandbox);
  new vm.Script(SOURCE, { filename: 'client.js' }).runInContext(sandbox);
  assert(registrations.length === 1, 'the fetch-enabled load did not register the module');
  const exported = registrations[0].factory(requireOnlyReact(react, []));
  assert(exported && exported.__verify, 'no __verify test surface on the factory return');
  assert(typeof exported.__verify.TranscriptCard === 'function', '__verify.TranscriptCard is not a function');
  assert(typeof exported.__verify.fetchTranscriptChunk === 'function', '__verify.fetchTranscriptChunk is not a function');

  // Render the real viewer in a truncated state and walk the recorded tree.
  react.created.length = 0;
  let clicked = false;
  exported.__verify.TranscriptCard({
    t: (key) => key,
    localeId: 'en',
    transcript: 'x'.repeat(24000),
    transcriptOffset: 0,
    transcriptTotal: 100000,
    transcriptTruncated: true,
    transcriptLoading: false,
    transcriptError: '',
    onLoadMore: () => {
      clicked = true;
      return exported.__verify.fetchTranscriptChunk('session-abc', 24000, 200000);
    },
  });
  const button = react.created.find((element) =>
    element && element.type === 'button' && hasText(element.children, 'transcriptLoadMore'));
  assert(button, 'no load-more button rendered for a truncated transcript');
  assert(typeof button.props.onClick === 'function', 'the load-more button has no onClick');
  button.props.onClick();
  assert(clicked, 'the load-more button is not wired to onLoadMore');
  assert(requests.length === 1, `expected 1 request after clicking load-more, got ${requests.length}`);
  const url = requests[0].url;
  assert(url.indexOf('offset=24000') !== -1, `load-more request is missing the offset parameter: ${url}`);
  assert(url.indexOf('maxChars=200000') !== -1, `load-more request is missing the maxChars parameter: ${url}`);
  return 'load-more button renders; click requests offset=24000&maxChars=200000';
});

// --------------------------------------------------------------------- summary

console.log('');
for (const failure of SUMMARY.failures) console.log(`FAILED  ${failure}`);
console.log(`checks: ${SUMMARY.pass + SUMMARY.fail}   PASS: ${SUMMARY.pass}   FAIL: ${SUMMARY.fail}`);
console.log(`verify-client: ${SUMMARY.pass} pass / ${SUMMARY.fail} fail`);
process.exit(SUMMARY.fail === 0 ? 0 : 1);
