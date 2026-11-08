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
  return {
    querySelector() {
      return null;
    },
    createElement() {
      return { dataset: {}, textContent: '', remove() {} };
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

// --------------------------------------------------------------------- summary

console.log('');
for (const failure of SUMMARY.failures) console.log(`FAILED  ${failure}`);
console.log(`checks: ${SUMMARY.pass + SUMMARY.fail}   PASS: ${SUMMARY.pass}   FAIL: ${SUMMARY.fail}`);
console.log(`verify-client: ${SUMMARY.pass} pass / ${SUMMARY.fail} fail`);
process.exit(SUMMARY.fail === 0 ? 0 : 1);
