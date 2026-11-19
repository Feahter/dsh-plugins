import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCoreBackend, createCore3D, CORE_STATE_STYLE, projectRing } from '../src/client/core3d.js';

const EPS = 1e-9;
function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < EPS, `${label}: expected ${expected}, got ${actual}`);
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.textContent = '';
    this.parentNode = null;
    this._handlers = new Map();
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] == null ? null : this.attrs[name]; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const set = this._handlers.get(type);
    if (set) set.delete(fn);
  }
}

function makeDoc(options = {}) {
  const context = options.context;
  const canvases = [];
  const doc = {
    head: new FakeNode('head'),
    body: new FakeNode('body'),
    hidden: false,
    _canvases: canvases,
    _listeners: new Map(),
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') {
        const canvas = new FakeNode('canvas');
        canvas.width = 0;
        canvas.height = 0;
        if (typeof context === 'function') canvas.getContext = (kind) => context(kind, canvas);
        canvases.push(canvas);
        return canvas;
      }
      return new FakeNode(tag);
    },
    addEventListener(type, fn) { this._listeners.set(type, fn); },
    removeEventListener(type, fn) {
      if (this._listeners.get(type) === fn) this._listeners.delete(type);
    },
  };
  return doc;
}

function makeWin(extra = {}) {
  const raf = [];
  const cancelled = [];
  const listeners = new Map();
  let seq = 0;
  return {
    devicePixelRatio: 2,
    performance: { now: () => 0 },
    requestAnimationFrame(cb) { raf.push(cb); seq += 1; return seq; },
    cancelAnimationFrame(id) { cancelled.push(id); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    _raf: raf,
    _cancelled: cancelled,
    _listeners: listeners,
    ...extra,
  };
}

function fake2D() {
  const calls = { fill: 0, stroke: 0, arc: 0 };
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() { calls.stroke += 1; },
    fill() { calls.fill += 1; },
    arc() { calls.arc += 1; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
}

function fakeGL(options = {}) {
  const calls = { draw: 0, uniform1f: 0, uniform2f: 0, uniform3f: 0, programs: 0, buffers: 0, shaderSources: [], compileFail: !!options.compileFail };
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, BLEND: 8, SRC_ALPHA: 9, ONE: 10,
    TRIANGLE_STRIP: 11, COLOR_BUFFER_BIT: 12,
    calls,
    createShader(type) { return { type, src: '' }; },
    shaderSource(shader, source) { shader.src = source; calls.shaderSources.push(source); },
    compileShader() {},
    getShaderParameter() { return !calls.compileFail; },
    deleteShader() {},
    createProgram() { calls.programs += 1; return {}; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true; },
    deleteProgram() {},
    getUniformLocation(program, name) { return { name }; },
    getAttribLocation() { return 0; },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    createBuffer() { calls.buffers += 1; return {}; },
    bindBuffer() {},
    bufferData() {},
    useProgram() {},
    enable() {},
    blendFunc() {},
    uniform1f() { calls.uniform1f += 1; },
    uniform2f() { calls.uniform2f += 1; },
    uniform3f() { calls.uniform3f += 1; },
    viewport() {},
    clearColor() {},
    clear() {},
    drawArrays() { calls.draw += 1; },
    deleteBuffer() {},
  };
}

test('pickCoreBackend walks the ladder and honours off/dom', () => {
  assert.equal(pickCoreBackend({ webgl2: true, webgl1: true, canvas2d: true }), 'webgl2');
  assert.equal(pickCoreBackend({ webgl2: false, webgl1: true, canvas2d: true }), 'webgl1');
  assert.equal(pickCoreBackend({ webgl2: false, webgl1: false, canvas2d: true }), 'canvas2d');
  assert.equal(pickCoreBackend({ webgl2: false, webgl1: false, canvas2d: false }), 'css');
  assert.equal(pickCoreBackend({ canvas2d: true, quality: 'off' }), 'none');
  assert.equal(pickCoreBackend({ webgl2: true, dom: false }), 'none');
  assert.equal(pickCoreBackend(), 'css');
});

test('projectRing places points on the squashed circle with depth', () => {
  const ring = projectRing(0, 10, 0.5, 0, 4);
  assert.equal(ring.length, 4);
  close(ring[0].angle, 0, 'angle 0');
  close(ring[0].x, 10, 'x0');
  close(ring[0].y, 0, 'y0');
  close(ring[0].depth, 0.5, 'depth0');
  close(ring[0].scale, 0.825, 'scale0');
  close(ring[1].angle, Math.PI / 2, 'angle 1');
  close(ring[1].x, 0, 'x1');
  close(ring[1].y, 5, 'y1');
  close(ring[1].depth, 1, 'depth1');
  close(ring[1].scale, 1, 'scale1');
  close(ring[2].x, -10, 'x2');
  close(ring[2].y, 0, 'y2');
  close(ring[3].x, 0, 'x3');
  close(ring[3].y, -5, 'y3');
  close(ring[3].depth, 0, 'depth3');
  close(ring[3].scale, 0.65, 'scale3');

  assert.equal(projectRing(0, 1, 1, 0).length, 48);
  close(projectRing(0, 1, 1, 0)[0].depth, 0.5, 'default depth');
  assert.equal(projectRing(0, 1, 1, 0, 0).length, 48);
  assert.equal(projectRing(0, 1, 1, 0, -3).length, 48);
  assert.equal(projectRing(0, 1, 1, 0, 2.9).length, 2);
  assert.equal(projectRing(0, 1, 1, 0, 1000).length, 512);
  close(projectRing(0.5, 1, 1, 0.25, 8)[0].angle, 0.75, 'phase offset');

  const fallback = projectRing(NaN, NaN, NaN, NaN, NaN);
  assert.equal(fallback.length, 48);
  close(fallback[0].x, 0, 'bad radius x');
  close(fallback[0].y, 0, 'bad radius y');
});

test('CORE_STATE_STYLE has all five states with six numeric knobs', () => {
  assert.deepEqual(Object.keys(CORE_STATE_STYLE).sort(), ['error', 'idle', 'listening', 'speaking', 'thinking']);
  for (const [name, style] of Object.entries(CORE_STATE_STYLE)) {
    for (const key of ['spin', 'ring', 'glow', 'jitter', 'desat', 'pulse']) {
      assert.equal(typeof style[key], 'number', `${name}.${key}`);
    }
  }
  assert.equal(CORE_STATE_STYLE.idle.spin, 0.65);
  assert.equal(CORE_STATE_STYLE.listening.ring, 1.35);
  assert.equal(CORE_STATE_STYLE.thinking.spin, 2.6);
  assert.equal(CORE_STATE_STYLE.speaking.pulse, 0.4);
  assert.equal(CORE_STATE_STYLE.error.jitter, 1);
  assert.equal(CORE_STATE_STYLE.error.desat, 0.85);
});

test('createCore3D falls back to css when the document has no canvas getContext', () => {
  const doc = makeDoc();
  const win = makeWin();
  const mount = new FakeNode('div');
  const app = createCore3D({ doc, win, mount, reducedMotion: true });
  assert.equal(app.kind, 'css');
  assert.equal(app.root.getAttribute('data-kind'), 'css');
  assert.equal(app.root.children.length, 1);
  assert.equal(app.root.children[0].children.length, 4);
  assert.equal(doc.head.children.length, 1);
  assert.match(doc.head.children[0].textContent, /@keyframes/);
  assert.match(doc.head.children[0].textContent, /\.vc-core-css-/);

  assert.equal(app.setState('listening'), 'listening');
  assert.equal(app.setState('bogus'), 'idle');
  assert.equal(app.setTheme({ core: { palette: { idle: ['#000', '#111', '#222'] } } }).core.palette.idle[0], '#000');
  assert.doesNotThrow(() => app.resize());

  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
  assert.equal(app.dispose(), false);
  assert.equal(doc.head.children.length, 0);
  assert.equal(mount.children.length, 0);
  assert.equal(app.frameStats().disposed, true);
  assert.equal(app.kind, 'none');
});

test('createCore3D survives doc.createElement("canvas").getContext throwing', () => {
  const doc = makeDoc({
    context() { throw new Error('blocked by privacy mode'); },
  });
  const win = makeWin();
  const mount = new FakeNode('div');
  const seen = [];
  const app = createCore3D({ doc, win, mount, reducedMotion: true, onError: (msg) => seen.push(msg) });
  assert.equal(app.kind, 'css');
  assert.equal(app.root.getAttribute('data-kind'), 'css');
  assert.ok(doc._canvases.length >= 1);
  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
});

test('createCore3D uses canvas2d when only 2d contexts exist', () => {
  const ctx = fake2D();
  const doc = makeDoc({ context: (kind) => (kind === '2d' ? ctx : null) });
  const win = makeWin();
  const mount = new FakeNode('div');
  mount.clientWidth = 240;
  mount.clientHeight = 180;
  const app = createCore3D({ doc, win, mount, reducedMotion: true });
  assert.equal(app.kind, 'canvas2d');
  assert.equal(app.root.getAttribute('data-kind'), 'canvas2d');
  assert.equal(app.root.children.length, 1);
  assert.ok(ctx.calls.fill > 0, 'gradients painted');
  assert.ok(ctx.calls.stroke > 0, 'rings stroked');
  const canvas = doc._canvases[doc._canvases.length - 1];
  assert.equal(canvas.width, 480);
  assert.equal(canvas.height, 360);
  assert.equal(canvas.style.width, '240px');

  assert.equal(app.setLevel(0.5), 0.5);
  assert.equal(app.setLevel(2), 1);
  assert.equal(app.setLevel(-1), 0);
  assert.equal(app.setLevel('nope'), 0);
  assert.equal(app.setState('speaking'), 'speaking');
  assert.equal(app.frameStats().kind, 'canvas2d');
  assert.ok(app.frameStats().frames >= 1);

  mount.clientWidth = 320;
  mount.clientHeight = 200;
  app.resize();
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 400);

  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
  assert.equal(mount.children.length, 0);
});

test('createCore3D runs the webgl2 SDF pass and destroy stops rAF/listeners', () => {
  const gl = fakeGL();
  const doc = makeDoc({ context: (kind) => (kind === 'webgl2' ? gl : null) });
  const win = makeWin();
  const mount = new FakeNode('div');
  const app = createCore3D({ doc, win, mount });
  assert.equal(app.kind, 'webgl2');
  assert.equal(win._raf.length, 1);
  assert.equal(gl.calls.draw, 0);
  const canvas = doc._canvases[0];
  assert.equal(canvas.width, 440);
  assert.equal(canvas.style.width, '220px');

  win._raf[0](16);
  assert.equal(gl.calls.draw, 1);
  assert.ok(gl.calls.uniform1f > 0);
  assert.ok(gl.calls.uniform3f >= 3);
  assert.equal(win._raf.length, 2);

  app.setState('speaking');
  assert.equal(app.root.getAttribute('data-state'), 'speaking');
  win._raf[1](48);
  assert.equal(gl.calls.draw, 2);
  assert.ok(app.frameStats().frames >= 2);

  const fragment = gl.calls.shaderSources.find((src) => src.startsWith('precision highp float;'));
  assert.ok(fragment, 'fragment shader supplied');
  assert.match(fragment, /for \(int i = 0; i < 40; i\+\+\)/);
  assert.match(fragment, /sdScene/);
  assert.match(fragment, /uPulse/);

  const stale = win._raf[1];
  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
  assert.equal(win._listeners.has('resize'), false);
  assert.equal(doc._listeners.has('visibilitychange'), false);
  assert.equal(canvas._handlers.get('webglcontextlost').size, 0);
  assert.ok(win._cancelled.length >= 1);
  const scheduled = win._raf.length;
  stale(64);
  assert.equal(win._raf.length, scheduled);
  assert.equal(mount.children.length, 0);
  assert.equal(app.kind, 'none');
});

test('createCore3D downgrades when shader compilation fails', () => {
  const gl = fakeGL({ compileFail: true });
  const doc = makeDoc({ context: (kind) => (kind === 'webgl2' ? gl : null) });
  const win = makeWin();
  const mount = new FakeNode('div');
  const errors = [];
  const app = createCore3D({ doc, win, mount, reducedMotion: true, onError: (msg) => errors.push(msg) });
  assert.equal(app.kind, 'css');
  assert.equal(app.root.getAttribute('data-kind'), 'css');
  assert.equal(app.frameStats().reason, 'shader');
  assert.ok(app.frameStats().downgrades >= 1);
  assert.deepEqual(errors, ['shader']);
  assert.equal(gl.calls.programs, 0);
  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
});

test('createCore3D with quality off never touches a canvas', () => {
  const gl = fakeGL();
  const doc = makeDoc({ context: (kind) => (kind === 'webgl2' ? gl : null) });
  const win = makeWin();
  const mount = new FakeNode('div');
  const app = createCore3D({ doc, win, mount, quality: 'off' });
  assert.equal(app.kind, 'none');
  assert.equal(app.root.getAttribute('data-kind'), 'none');
  assert.equal(doc._canvases.length, 0);
  assert.equal(gl.calls.programs, 0);
  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
});

test('createCore3D without a document or canvas is inert', () => {
  const app = createCore3D({});
  assert.equal(app.kind, 'none');
  assert.equal(app.root, null);
  assert.equal(app.setState('thinking'), 'thinking');
  assert.equal(app.setLevel(0.3), 0);
  assert.equal(app.frameStats().reason, 'no-doc');
  assert.doesNotThrow(() => app.resize());
  assert.equal(app.dispose(), true);
  assert.equal(app.dispose(), false);
  assert.equal(app.destroy(), false);
});

test('createCore3D degrades to css with an avatar-harness style {drawImage} context', () => {
  const doc = makeDoc({ context: () => ({ drawImage() {} }) });
  const win = makeWin();
  const mount = new FakeNode('div');
  const app = createCore3D({ doc, win, mount, reducedMotion: true });
  assert.equal(app.kind, 'css');
  assert.equal(app.root.getAttribute('data-kind'), 'css');
  assert.equal(app.frameStats().downgrades, 3);
  assert.equal(app.destroy(), true);
  assert.equal(app.destroy(), false);
});

test('createCore3D falls back to setTimeout and destroy cancels the timer', () => {
  const timers = new Map();
  let seq = 0;
  const win = {
    devicePixelRatio: 1,
    performance: { now: () => 0 },
    setTimeout(fn) { seq += 1; timers.set(seq, fn); return seq; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {},
    removeEventListener() {},
  };
  const doc = makeDoc({ context: (kind) => (kind === '2d' ? fake2D() : null) });
  const mount = new FakeNode('div');
  const app = createCore3D({ doc, win, mount });
  assert.equal(app.kind, 'canvas2d');
  assert.equal(timers.size, 1);
  const id = [...timers.keys()][0];
  const tick = timers.get(id);
  timers.delete(id);
  tick(16);
  assert.equal(timers.size, 1);
  assert.equal(app.destroy(), true);
  assert.equal(timers.size, 0);
  assert.equal(app.destroy(), false);
});

test('createCore3D disconnect ResizeObserver and removes resize listener', () => {
  const instances = [];
  class FakeRO {
    constructor(cb) { this.cb = cb; this.target = null; this.disconnected = false; instances.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const doc = makeDoc();
  const win = makeWin({ ResizeObserver: FakeRO });
  const mount = new FakeNode('div');
  const app = createCore3D({ doc, win, mount, reducedMotion: true });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].target, mount);
  assert.equal(win._listeners.has('resize'), true);
  assert.equal(app.destroy(), true);
  assert.equal(instances[0].disconnected, true);
  assert.equal(win._listeners.has('resize'), false);
});
