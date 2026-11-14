// Smoke test for the browser half: load the built client.js bundle in Node with a
// fake module loader / React / DOM, then run apply() against a stub context and
// assert the slot + locale registrations. No browser required.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const bundle = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let registration = null
globalThis.window = globalThis
globalThis.__ModuleLoader__ = { load(r) { registration = r } }

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {}, useLayoutEffect() {}, useInsertionEffect() {},
  useMemo: (fn) => fn(), useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
  memo: (component) => component,
  forwardRef: (render) => render,
  createContext: (value) => ({ Provider: null, _value: value }),
}
globalThis.document = {
  getElementById: () => null,
  createElement: (tag) => ({ tag, id: '', textContent: '', remove() {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
}

// The esbuild wrapper calls the factory with a require shim; only react is external.
new Function('require', 'module', 'exports', bundle)(
  (id) => { if (id === 'react') return React; throw new Error('unexpected external: ' + id) },
  { exports: {} },
  {},
)

const failures = []
const check = (ok, label) => { if (!ok) failures.push(label) }

check(registration !== null, 'bundle calls __ModuleLoader__.load')
check(registration.id === 'dsh-context-lib', 'bundle id is dsh-context-lib')

const exportsValue = typeof registration.factory === 'function' ? registration.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected external: ' + id)
}) : null

check(Array.isArray(exportsValue?.inject), 'exports.inject is an array')
check(exportsValue?.inject?.includes('slots') && exportsValue?.inject?.includes('locale'), 'inject declares slots + locale')
check(typeof exportsValue?.apply === 'function', 'exports.apply is a function')

const registered = []
let styleInjected = 0
const dictionaries = []
const ctx = {
  effect(fn) { fn() },
  locale: {
    bind: () => (key) => key,
    getLocale: () => ({ active: 'zh' }),
    register(ns, dict) { dictionaries.push([ns, dict]) },
  },
  slots: {
    register(definition, component) { registered.push({ definition, component }); return () => {} },
    inject(name, register) { register() },
  },
  get(name) { return name === 'layout' ? { selectPanel() {} } : undefined },
}
const origAppend = globalThis.document.head.appendChild
globalThis.document.head.appendChild = () => { styleInjected += 1 }

try {
  exportsValue.apply(ctx)
} catch (error) {
  failures.push('apply threw: ' + error.message)
}
globalThis.document.head.appendChild = origAppend

const panel = registered.find((r) => r.definition?.name === 'sidebar.panellist')
const page = registered.find((r) => r.definition?.name === 'main')
check(!!panel, 'registers sidebar.panellist')
check(panel?.definition?.id === 'context-lib', 'panel id is context-lib')
check(typeof panel?.component === 'function', 'panel icon component is a function')
check(!!page, 'registers main page')
check(page?.definition?.key === 'context-lib', 'page key is context-lib')
check(typeof page?.component === 'function', 'page component is a function')
check(styleInjected === 1, 'injects stylesheet once')
check(dictionaries.some(([ns, dict]) => ns === 'context-lib' && dict && ('zh' in dict || 'panelTitle' in dict)), 'registers zh dictionary')

if (failures.length) {
  console.error('client smoke failed:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log(`client smoke passed: ${registered.length} slots, ${dictionaries.length} dictionary/locale registrations, ${bundle.length} bytes`)
