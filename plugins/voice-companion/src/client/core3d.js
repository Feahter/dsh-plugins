// core3d.js — "Jarvis" core for voice-companion: SDF ray-marched WebGL with
// 2D canvas and CSS fallbacks. No imports; build-client.mjs strips the exports
// and inlines this file. Nothing runs at module scope: all DOM/canvas probing
// happens inside createCore3D, which never throws. Ladder webgl2 -> webgl1 ->
// canvas2d -> css -> none; any failure demotes one rung silently. All rungs
// read CORE_STATE_STYLE, the single state->visual table.

const TAU = Math.PI * 2;
const FALLBACK = {
  idle: ['#e2fcff', '#63d8ef', '#2878ad'],
  listening: ['#d8ffe9', '#7fe3a8', '#2fbf86'],
  thinking: ['#efe7ff', '#bba0fa', '#6d52d1'],
  speaking: ['#f0f7ff', '#8cbaff', '#5266eb'],
  error: ['#ffd9d9', '#ff7676', '#7a2020'],
};
const KIND = { webgl2: 'webgl2', webgl1: 'webgl', canvas2d: '2d' };
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i;

export function pickCoreBackend(env) {
  const e = env || {};
  if (e.quality === 'off' || e.dom === false) return 'none';
  if (e.webgl2) return 'webgl2';
  if (e.webgl1) return 'webgl1';
  if (e.canvas2d) return 'canvas2d';
  return 'css';
}

export const CORE_STATE_STYLE = {
  idle: { spin: 0.65, ring: 1.0, glow: 0.45, jitter: 0, desat: 0, pulse: 0.10 },
  listening: { spin: 1.4, ring: 1.35, glow: 0.70, jitter: 0, desat: 0, pulse: 0.18 },
  thinking: { spin: 2.6, ring: 1.15, glow: 0.62, jitter: 0, desat: 0, pulse: 0.22 },
  speaking: { spin: 1.8, ring: 1.10, glow: 0.85, jitter: 0, desat: 0, pulse: 0.40 },
  error: { spin: 0.6, ring: 0.80, glow: 0.35, jitter: 1, desat: 0.85, pulse: 0.05 },
};

// Point i sits at angle+phase+i*TAU/count; y is squashed into the orbital
// plane, depth is 0 (back) .. 1 (front). Count clamps to 1..512, else 48.
export function projectRing(angle, radius, squash, phase, count) {
  const n = Number(count);
  const total = Number.isFinite(n) && n >= 1 ? Math.min(512, Math.floor(n)) : 48;
  const r = Number.isFinite(Number(radius)) ? Number(radius) : 0;
  const sq = Number.isFinite(Number(squash)) ? Number(squash) : 1;
  const a0 = (Number.isFinite(Number(angle)) ? Number(angle) : 0) + (Number.isFinite(Number(phase)) ? Number(phase) : 0);
  const out = [];
  for (let i = 0; i < total; i += 1) {
    const a = a0 + (i / total) * TAU;
    const depth = (Math.sin(a) + 1) / 2;
    out.push({ angle: a, x: Math.cos(a) * r, y: Math.sin(a) * r * sq, depth, scale: 0.65 + 0.35 * depth });
  }
  return out;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const nowMs = (win) => {
  try {
    const p = win && win.performance;
    return p && typeof p.now === 'function' ? p.now() : Date.now();
  } catch (_) { return Date.now(); }
};
const pixelRatio = (win) => {
  try {
    const n = Number(win && win.devicePixelRatio);
    return Number.isFinite(n) && n > 0 ? Math.min(2, Math.max(1, n)) : 1;
  } catch (_) { return 1; }
};
function setAttr(node, name, value) {
  try { if (node && typeof node.setAttribute === 'function') node.setAttribute(name, String(value)); } catch (_) { /* ignore */ }
}
function styleSet(node, prop, value) {
  if (!node || !node.style) return;
  try {
    if (typeof node.style.setProperty === 'function') node.style.setProperty(prop, String(value));
    else node.style[prop] = String(value);
  } catch (_) { /* ignore */ }
}
function makeEl(doc, tag, cls) {
  try {
    if (!doc || typeof doc.createElement !== 'function') return null;
    const el = doc.createElement(tag);
    if (el && cls) setAttr(el, 'class', cls);
    return el || null;
  } catch (_) { return null; }
}
function clearKids(node) {
  if (!node || !Array.isArray(node.children) || typeof node.removeChild !== 'function') return;
  for (const kid of node.children.slice()) {
    try { node.removeChild(kid); } catch (_) { /* ignore */ }
  }
}
function parseColor(value) {
  if (Array.isArray(value)) {
    const nums = value.slice(0, 3).map(Number);
    return nums.every(Number.isFinite) ? nums.map((v) => clamp01(v > 1 ? v / 255 : v)) : null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  const hex = HEX.exec(text);
  if (hex) {
    const body = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    const n = parseInt(body, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = RGB.exec(text);
  return rgb ? [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255].map(clamp01) : null;
}
function toHex(rgb) {
  let out = '#';
  for (let i = 0; i < 3; i += 1) {
    const part = Math.round(clamp01(rgb[i]) * 255).toString(16);
    out += part.length < 2 ? '0' + part : part;
  }
  return out;
}
function rgba(entry, alpha) {
  const c = (entry && entry.rgb) || [1, 1, 1];
  const a = clamp01(alpha == null ? 1 : Number(alpha) || 0);
  return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')';
}
function paletteFor(theme, state) {
  const fb = FALLBACK[state] || FALLBACK.idle;
  // Themes speak the flat token language (`core.palette.idle` inside
  // `theme.tokens`); the nested `theme.core.palette[state]` shape is the older
  // one and stays readable so hand-written themes keep working.
  const fromTokens = theme && theme.tokens ? theme.tokens['core.palette.' + state] : undefined;
  const legacy = theme && theme.core && theme.core.palette ? theme.core.palette[state] : undefined;
  const raw = fromTokens !== undefined ? fromTokens : legacy;
  const own = Array.isArray(raw) ? raw.map(String).filter(Boolean)
    : (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    const rgb = parseColor(own[i]) || parseColor(fb[i]) || [1, 1, 1];
    out.push({ rgb, hex: toHex(rgb) });
  }
  return out;
}
// One outstanding tick, rAF or setTimeout; cancel() is idempotent.
function makeClock(win) {
  const c = { raf: 0, timer: 0 };
  c.schedule = (fn) => {
    if (c.raf || c.timer) return;
    try {
      if (win && typeof win.requestAnimationFrame === 'function') {
        c.raf = win.requestAnimationFrame((ts) => { c.raf = 0; fn(ts); });
        if (c.raf) return;
      }
    } catch (_) { c.raf = 0; }
    try {
      if (win && typeof win.setTimeout === 'function') c.timer = win.setTimeout(() => { c.timer = 0; fn(nowMs(win)); }, 33);
    } catch (_) { c.timer = 0; }
  };
  c.cancel = () => {
    try { if (c.raf && win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(c.raf); } catch (_) { /* ignore */ }
    try { if (c.timer && win && typeof win.clearTimeout === 'function') win.clearTimeout(c.timer); } catch (_) { /* ignore */ }
    c.raf = 0;
    c.timer = 0;
  };
  return c;
}

const VERT = 'attribute vec2 aPos;\nvarying vec2 vUv;\nvoid main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
// Fullscreen quad + one SDF scene. `steps` is baked in: GLSL ES 1.00 needs a
// constant loop bound, and LITE recompiles this same source with 24.
function frag(steps) {
  return `precision highp float;
varying vec2 vUv;
uniform vec2 uRes; uniform float uTime, uSpin, uRing, uGlow, uJitter, uDesat, uLevel, uPulse;
uniform vec3 uInner, uRim, uGlowColor;
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdScene(vec3 p) {
  float core = length(p) - (0.52 + 0.05 * sin(uTime * 1.7) + 0.14 * uLevel);
  // Two orbital planes that do not share an axis: the second ring is tilted out
  // of the first one's plane, so the projection reads as crossing orbits instead
  // of two concentric ovals.
  vec3 a = p; a.yz = rot2(0.62 + uTime * 0.45 * uSpin) * a.yz;
  vec3 b = p; b.xz = rot2(0.62) * b.xz; b.yz = rot2(-0.48 + uTime * 0.30 * uSpin) * b.yz;
  return min(core, min(sdTorus(a, vec2(0.80 * uRing, 0.012)), sdTorus(b, vec2(0.66 * uRing, 0.010))));
}
vec3 calcNormal(vec3 p) { vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * sdScene(p + e.xyy) + e.yyx * sdScene(p + e.yyx) + e.yxy * sdScene(p + e.yxy) + e.xxx * sdScene(p + e.xxx)); }
void main() {
  vec2 uv = vUv; uv.x += uJitter * sin(uTime * 91.0) * 0.004;
  vec2 q = uv * 2.0 - 1.0; q.x *= uRes.x / max(uRes.y, 1.0);
  vec3 ro = vec3(0.0, 0.0, 2.55), rd = normalize(vec3(q, -1.6));
  float t = 0.0, glow = 0.0, hit = 0.0;
  for (int i = 0; i < ${steps}; i++) {
    float d = sdScene(ro + rd * t);
    glow += 0.013 / (0.05 + abs(d));
    if (d < 0.0015) { hit = 1.0; break; }
    t += max(d * 0.8, 0.002); if (t > 6.0) break;
  }
  vec3 col = vec3(0.0); float alpha = 0.0;
  if (hit > 0.5) {
    vec3 n = calcNormal(ro + rd * t);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    float beat = 1.0 + uPulse * sin(uTime * 4.2);
    // A soft key light from the upper left keeps the sphere from reading as a
    // flat white disc once the volumetric glow is added on top.
    float key = 0.42 + 0.58 * smoothstep(-0.45, 0.85, dot(n, normalize(vec3(-0.55, 0.75, 0.65))));
    col = mix(uInner, uRim, fres) * (0.55 + 0.65 * fres) * beat * key + uRim * 0.12;
    alpha = clamp(0.65 + fres * 0.35, 0.0, 1.0);
  }
  float g = min(glow, 1.5);
  col += uGlowColor * g * uGlow * 0.13;
  alpha = clamp(alpha + g * uGlow * 0.12, 0.0, 1.0);
  col += vec3(sin(vUv.y * 220.0 + uTime * 6.0) * 0.02);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma), uDesat) * (1.0 - 0.25 * uDesat); alpha *= 1.0 - 0.35 * uDesat;
  gl_FragColor = vec4(col, alpha);
}`;
}

let cssSeq = 0;

export function createCore3D(options) {
  const o = options || {};
  const doc = o.doc || (typeof document === 'undefined' ? null : document);
  const win = o.win || (doc && doc.defaultView) || (typeof window === 'undefined' ? null : window);
  const quality = o.quality === 'high' || o.quality === 'low' || o.quality === 'off' ? o.quality : 'auto';
  const reduced = !!o.reducedMotion;
  const onError = typeof o.onError === 'function' ? o.onError : null;
  const stats = { kind: 'none', state: 'idle', frames: 0, avgMs: 0, downgrades: 0, reason: '', lite: false, quality, disposed: false };
  const root = makeEl(doc, 'div', 'vc-core3d');

  if (!root) {
    let dead = false;
    const inert = {
      root: null, kind: 'none',
      setState(next) { return Object.prototype.hasOwnProperty.call(CORE_STATE_STYLE, next) ? next : 'idle'; },
      setLevel() { return 0; },
      setTheme(value) { return value || null; },
      resize() {},
      frameStats() { return { kind: 'none', state: 'idle', frames: 0, avgMs: 0, downgrades: 0, reason: 'no-doc', lite: false, quality, disposed: dead }; },
      dispose() { if (dead) return false; dead = true; return true; },
    };
    inert.destroy = inert.dispose;
    return inert;
  }

  for (const [prop, value] of [['position', 'relative'], ['display', 'block'], ['width', '100%'], ['height', '100%'], ['pointer-events', 'none']]) styleSet(root, prop, value);
  setAttr(root, 'data-kind', 'pending');
  setAttr(root, 'data-state', 'idle');
  setAttr(root, 'aria-hidden', 'true');

  let state = 'idle';
  let level = 0;
  let theme = o.theme || null;
  let palette = paletteFor(theme, state);
  let disposed = false;
  let backend = null;
  let chain = [];
  let at = -1;
  let elapsed = 0;
  let last = 0;
  let lastDraw = -Infinity;
  let autoFrames = 0;
  let running = false;
  let notice = '';
  let observer = null;
  const probes = Object.create(null);
  const clock = makeClock(win);

  if (o.mount && typeof o.mount.appendChild === 'function') {
    try { o.mount.appendChild(root); } catch (_) { /* ignore */ }
  }

  function report(reason) {
    notice = String(reason == null ? '' : reason);
    stats.reason = notice;
    if (onError && notice) {
      try { onError(notice); } catch (_) { /* ignore */ }
    }
  }
  function measure() {
    const host = o.mount || root;
    let w = 0;
    let h = 0;
    try { w = Number(host && (host.clientWidth || host.offsetWidth)); h = Number(host && (host.clientHeight || host.offsetHeight)); } catch (_) { /* ignore */ }
    return { w: Number.isFinite(w) && w > 0 ? w : 220, h: Number.isFinite(h) && h > 0 ? h : 220 };
  }
  function view() {
    return { state, style: CORE_STATE_STYLE[state] || CORE_STATE_STYLE.idle, level, palette, time: elapsed / 1000 };
  }
  function probe(kind) {
    if (kind in probes) return probes[kind];
    let found = null;
    try {
      const canvas = typeof doc.createElement === 'function' ? doc.createElement('canvas') : null;
      if (canvas && typeof canvas.getContext === 'function') {
        const ctx = canvas.getContext(KIND[kind]);
        if (ctx) found = { canvas, ctx };
      }
    } catch (_) { found = null; }
    probes[kind] = found;
    return found;
  }
  function detect() {
    if (quality === 'off') return 'none';
    // Probe lazily down the ladder: a live webgl2 context makes the lower-rung
    // probes pointless, and extra live contexts count against the browser's
    // per-page limit. Later rungs are probed on demand if a build fails.
    const webgl2 = !!probe('webgl2');
    const webgl1 = webgl2 ? false : !!probe('webgl1');
    const canvas2d = webgl2 || webgl1 ? false : !!probe('canvas2d');
    if (!webgl2 && !webgl1 && !canvas2d) return 'css';
    return pickCoreBackend({ webgl2, webgl1, canvas2d, quality, dom: true });
  }

  function buildGL(entry, kind) {
    const canvas = entry.canvas;
    const gl = entry.ctx;
    if (!gl || typeof gl.createShader !== 'function') return null;
    let program = null;
    let buffer = null;
    let u = null;
    let lite = quality === 'low';
    const names = ['uRes', 'uTime', 'uSpin', 'uRing', 'uGlow', 'uJitter', 'uDesat', 'uLevel', 'uPulse', 'uInner', 'uRim', 'uGlowColor'];
    function fail(err) {
      try {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      } catch (_) { /* ignore */ }
      program = null;
      buffer = null;
      if (err) report(err.message || err);
      return null;
    }
    function compile(type, source) {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }
    function link(count) {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, frag(count));
      if (!vs || !fs) {
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        return null;
      }
      const prog = gl.createProgram();
      if (!prog) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return null;
      }
      return prog;
    }
    function bind(prog) {
      const map = Object.create(null);
      for (const name of names) map[name] = gl.getUniformLocation(prog, name);
      return map;
    }
    function setup() {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const slot = gl.getAttribLocation(program, 'aPos');
      if (slot >= 0) {
        gl.enableVertexAttribArray(slot);
        gl.vertexAttribPointer(slot, 2, gl.FLOAT, false, 0, 0);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    }
    function set1(name, value) { const loc = u[name]; if (loc != null) gl.uniform1f(loc, Number(value) || 0); }
    function set3(name, rgb) { const loc = u[name]; if (loc != null) gl.uniform3f(loc, rgb[0], rgb[1], rgb[2]); }
    try {
      program = link(40);
      if (!program) return fail('shader');
      buffer = gl.createBuffer();
      if (!buffer) return fail('buffer');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      u = bind(program);
      setup();
    } catch (err) {
      return fail(err);
    }
    function resize(w, h) {
      const dpr = pixelRatio(win);
      try {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      } catch (_) { /* ignore */ }
      styleSet(canvas, 'width', w + 'px');
      styleSet(canvas, 'height', h + 'px');
      styleSet(canvas, 'display', 'block');
    }
    function draw(v) {
      if (!program) return;
      const s = v.style;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      set1('uTime', v.time);
      set1('uSpin', s.spin);
      set1('uRing', s.ring);
      set1('uGlow', s.glow + v.level * 0.4);
      set1('uJitter', s.jitter);
      set1('uDesat', s.desat);
      set1('uLevel', v.level);
      set1('uPulse', s.pulse);
      set3('uInner', v.palette[0].rgb);
      set3('uRim', v.palette[1].rgb);
      set3('uGlowColor', v.palette[2].rgb);
      if (u.uRes != null && typeof gl.uniform2f === 'function') gl.uniform2f(u.uRes, canvas.width || 1, canvas.height || 1);
      gl.viewport(0, 0, canvas.width || 1, canvas.height || 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function setLite() {
      if (lite) return true;
      const next = link(24);
      if (!next) return false;
      if (program) gl.deleteProgram(program);
      program = next;
      u = bind(next);
      setup();
      lite = true;
      return true;
    }
    function onLost(event) {
      try { if (event && typeof event.preventDefault === 'function') event.preventDefault(); } catch (_) { /* ignore */ }
      if (!disposed) advance('contextlost');
    }
    if (typeof canvas.addEventListener === 'function') {
      try { canvas.addEventListener('webglcontextlost', onLost, false); } catch (_) { /* ignore */ }
    }
    return {
      kind, node: canvas, animate: true, get lite() { return lite; }, resize, draw, setLite,
      dispose() {
        if (typeof canvas.removeEventListener === 'function') {
          try { canvas.removeEventListener('webglcontextlost', onLost, false); } catch (_) { /* ignore */ }
        }
        try {
          if (buffer) gl.deleteBuffer(buffer);
          if (program) gl.deleteProgram(program);
        } catch (_) { /* ignore */ }
        program = null;
        buffer = null;
      },
    };
  }

  function build2D(entry) {
    const canvas = entry.canvas;
    const ctx = entry.ctx;
    if (!ctx || typeof ctx.clearRect !== 'function' || typeof ctx.beginPath !== 'function') return null;
    let w = 220;
    let h = 220;
    function resize(nw, nh) {
      w = Math.max(1, nw);
      h = Math.max(1, nh);
      const dpr = pixelRatio(win);
      try {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      } catch (_) { /* ignore */ }
      styleSet(canvas, 'width', w + 'px');
      styleSet(canvas, 'height', h + 'px');
      styleSet(canvas, 'display', 'block');
    }
    function ring(cx, cy, radius, squash, phase, count, entry2, glow) {
      const pts = projectRing(0, radius, squash, phase, count);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 1) {
        const x = cx + pts[i].x;
        const y = cy + pts[i].y;
        if (i === 0 && typeof ctx.moveTo === 'function') ctx.moveTo(x, y);
        else if (typeof ctx.lineTo === 'function') ctx.lineTo(x, y);
      }
      if (typeof ctx.closePath === 'function') ctx.closePath();
      ctx.strokeStyle = rgba(entry2, 0.16 + 0.62 * clamp01(glow));
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    function draw(v) {
      const s = v.style;
      const t = v.time;
      const dpr = pixelRatio(win);
      if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.30 * (1 + 0.05 * Math.sin(t * 1.7) + 0.14 * v.level) * (1 + s.pulse * Math.sin(t * 4.2));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      if (typeof ctx.createRadialGradient === 'function') {
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.1);
        if (halo && typeof halo.addColorStop === 'function') {
          halo.addColorStop(0, rgba(v.palette[2], 0.30 * (0.4 + s.glow)));
          halo.addColorStop(0.45, rgba(v.palette[1], 0.14 * s.glow));
          halo.addColorStop(1, rgba(v.palette[2], 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 2.1, 0, TAU);
          ctx.fill();
        }
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
        if (core && typeof core.addColorStop === 'function') {
          core.addColorStop(0, rgba(v.palette[0], 0.95));
          core.addColorStop(0.5, rgba(v.palette[1], 0.55));
          core.addColorStop(1, rgba(v.palette[2], 0));
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1, r), 0, TAU);
          ctx.fill();
        }
      }
      ring(cx, cy, Math.min(w, h) * 0.38 * s.ring, 0.44, t * 0.45 * s.spin, 64, v.palette[1], s.glow);
      ring(cx, cy, Math.min(w, h) * 0.31 * s.ring, 0.30, -t * 0.30 * s.spin, 56, v.palette[2], s.glow * 0.8);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    return { node: canvas, kind: 'canvas2d', animate: true, lite: false, resize, draw, dispose() {} };
  }

  function buildCSS() {
    cssSeq += 1;
    const id = cssSeq;
    const cls = 'vc-core-css-' + id;
    const kf = 'vc-core-kf-' + id;
    const frame = makeEl(doc, 'div', cls);
    const halo = makeEl(doc, 'div', cls + '-halo');
    const core = makeEl(doc, 'div', cls + '-core');
    const ringA = makeEl(doc, 'div', cls + '-ring');
    const ringB = makeEl(doc, 'div', cls + '-ring ' + cls + '-ring-b');
    const sheet = makeEl(doc, 'style', null);
    if (!frame || !halo || !core || !ringA || !ringB || !sheet) return null;
    const s = CORE_STATE_STYLE[state] || CORE_STATE_STYLE.idle;
    styleSet(frame, '--vc-inner', palette[0].hex);
    styleSet(frame, '--vc-rim', palette[1].hex);
    styleSet(frame, '--vc-glow', palette[2].hex);
    styleSet(frame, '--vc-spin', (8 / Math.max(0.2, s.spin)).toFixed(2) + 's');
    for (const node of [halo, core, ringA, ringB]) {
      if (node && typeof frame.appendChild === 'function') frame.appendChild(node);
    }
    const css = [
      '.' + cls + '{position:absolute;inset:0;overflow:hidden;pointer-events:none}',
      '.' + cls + '-halo{position:absolute;left:50%;top:50%;width:84%;height:84%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,var(--vc-rim),var(--vc-glow) 34%,transparent 70%);opacity:.2;animation:' + kf + '-b 2.6s ease-in-out infinite}',
      '.' + cls + '-core{position:absolute;left:50%;top:50%;width:52%;height:52%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle at 42% 38%,#fff,var(--vc-inner) 24%,var(--vc-rim) 58%,transparent 78%);box-shadow:0 0 22px var(--vc-glow),0 0 58px var(--vc-glow);animation:' + kf + '-b 2.6s ease-in-out infinite}',
      '.' + cls + '-ring{position:absolute;left:8%;top:38%;width:84%;height:24%;border-radius:50%;border:1px solid var(--vc-rim);box-shadow:0 0 12px var(--vc-glow);opacity:.75;animation:' + kf + '-s var(--vc-spin) linear infinite}',
      '.' + cls + '-ring-b{left:15%;top:29%;width:70%;height:18%;border-color:var(--vc-glow);opacity:.45;animation-direction:reverse}',
      '.vc-core3d[data-state="error"] .' + cls + '-core{filter:saturate(.15)}',
      '@keyframes ' + kf + '-b{0%,100%{transform:translate(-50%,-50%) scale(.97);opacity:.82}50%{transform:translate(-50%,-50%) scale(1.04);opacity:1}}',
      '@keyframes ' + kf + '-s{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
    ].join('\n');
    try { sheet.textContent = css; } catch (_) { /* ignore */ }
    const host = doc.head || doc.body || null;
    if (host && typeof host.appendChild === 'function') {
      try { host.appendChild(sheet); } catch (_) { /* ignore */ }
    }
    if (reduced) {
      for (const node of [halo, core, ringA, ringB]) styleSet(node, 'animation', 'none');
    }
    return {
      node: frame, kind: 'css', animate: false, resize() {},
      applyPalette(pal) {
        styleSet(frame, '--vc-inner', pal[0].hex);
        styleSet(frame, '--vc-rim', pal[1].hex);
        styleSet(frame, '--vc-glow', pal[2].hex);
      },
      setState(next, st) {
        setAttr(frame, 'data-state', next);
        styleSet(frame, '--vc-spin', (8 / Math.max(0.2, st.spin)).toFixed(2) + 's');
        styleSet(frame, 'filter', st.desat > 0 ? 'saturate(' + (1 - st.desat * 0.85).toFixed(2) + ')' : 'none');
      },
      dispose() {
        if (sheet.parentNode && typeof sheet.parentNode.removeChild === 'function') {
          try { sheet.parentNode.removeChild(sheet); } catch (_) { /* ignore */ }
        }
      },
    };
  }

  function build(kind) {
    try {
      if (kind === 'webgl2' || kind === 'webgl1') {
        const entry = probe(kind);
        return entry ? buildGL(entry, kind) : null;
      }
      if (kind === 'canvas2d') {
        const entry = probe('canvas2d');
        return entry ? build2D(entry) : null;
      }
      if (kind === 'css') return buildCSS();
    } catch (err) {
      report(err && err.message ? err.message : String(err));
    }
    return null;
  }
  function teardown() {
    if (!backend) return;
    const dying = backend;
    backend = null;
    try { dying.dispose(); } catch (_) { /* ignore */ }
    clearKids(root);
  }
  function repaint() {
    if (disposed || !backend || typeof backend.draw !== 'function') return;
    try {
      backend.draw(view());
      stats.frames += 1;
    } catch (_) { /* ignore */ }
  }
  function frame(ts) {
    if (disposed || !running || !backend) return;
    if (doc && doc.hidden) { stopLoop(); return; }
    const stamp = Number.isFinite(Number(ts)) ? Number(ts) : nowMs(win);
    elapsed += (last ? Math.min(96, Math.max(0, stamp - last)) : 16.67);
    last = stamp;
    if (state === 'idle' && !reduced && stamp - lastDraw < 32) {
      if (running) clock.schedule(frame);
      return;
    }
    lastDraw = stamp;
    const started = nowMs(win);
    try { backend.draw(view()); } catch (err) { advance(err && err.message ? err.message : 'draw'); return; }
    const cost = Math.max(0, nowMs(win) - started);
    stats.frames += 1;
    stats.avgMs = stats.avgMs ? stats.avgMs * 0.85 + cost * 0.15 : cost;
    stats.lite = backend.lite === true;
    if (quality === 'auto' && backend.animate && backend.kind !== 'canvas2d') {
      autoFrames += 1;
      if (autoFrames >= 30) {
        autoFrames = 0;
        if (stats.avgMs > 28) { advance('slow'); return; }
        if (stats.avgMs > 22 && typeof backend.setLite === 'function' && backend.lite !== true) {
          backend.setLite();
          stats.lite = backend.lite === true;
        }
      }
    }
    if (running) clock.schedule(frame);
  }
  function startLoop() {
    if (running || disposed || reduced || !backend || !backend.animate || (doc && doc.hidden)) return;
    running = true;
    last = 0;
    clock.schedule(frame);
  }
  function stopLoop() {
    running = false;
    clock.cancel();
  }
  function activate(index, reason) {
    teardown();
    at = index;
    const kind = chain[index];
    const built = build(kind);
    if (!built) {
      if (reason) report(reason);
      else if (!notice) report('unavailable:' + kind);
      return false;
    }
    backend = built;
    stats.kind = kind;
    if (built.node && typeof root.appendChild === 'function') {
      try { root.appendChild(built.node); } catch (_) { /* ignore */ }
    }
    setAttr(root, 'data-kind', kind);
    setAttr(root, 'data-state', state);
    if (typeof built.applyPalette === 'function') {
      try { built.applyPalette(palette); } catch (_) { /* ignore */ }
    }
    if (typeof built.setState === 'function') {
      try { built.setState(state, CORE_STATE_STYLE[state] || CORE_STATE_STYLE.idle); } catch (_) { /* ignore */ }
    }
    try { built.resize(measure().w, measure().h); } catch (_) { /* ignore */ }
    if (reduced) repaint();
    else startLoop();
    return true;
  }
  function boot() {
    const first = detect();
    if (first === 'none') {
      stats.kind = 'none';
      setAttr(root, 'data-kind', 'none');
      return;
    }
    const ladder = ['webgl2', 'webgl1', 'canvas2d', 'css'];
    chain = ladder.slice(Math.max(0, ladder.indexOf(first)));
    for (let i = 0; i < chain.length; i += 1) {
      if (activate(i, null)) { stats.kind = chain[i]; return; }
      stats.downgrades += 1;
    }
    stats.kind = 'none';
    setAttr(root, 'data-kind', 'none');
  }
  function advance(reason) {
    if (disposed) return;
    report(reason);
    stopLoop();
    for (let i = (at < 0 ? 0 : at + 1); i < chain.length; i += 1) {
      stats.downgrades += 1;
      if (activate(i, reason)) { stats.kind = chain[i]; return; }
    }
    stats.kind = 'none';
    setAttr(root, 'data-kind', 'none');
  }
  function setState(next) {
    if (disposed) return state;
    state = Object.prototype.hasOwnProperty.call(CORE_STATE_STYLE, next) ? next : 'idle';
    stats.state = state;
    palette = paletteFor(theme, state);
    setAttr(root, 'data-state', state);
    if (backend && typeof backend.setState === 'function') {
      try { backend.setState(state, CORE_STATE_STYLE[state]); } catch (_) { /* ignore */ }
    }
    if (reduced) repaint();
    return state;
  }
  function setLevel(value) {
    if (disposed) return level;
    const n = Number(value);
    level = Number.isFinite(n) ? clamp01(n) : 0;
    if (reduced) repaint();
    return level;
  }
  function setTheme(next) {
    if (disposed) return theme;
    theme = next || null;
    palette = paletteFor(theme, state);
    if (backend && typeof backend.applyPalette === 'function') {
      try { backend.applyPalette(palette); } catch (_) { /* ignore */ }
    }
    if (reduced) repaint();
    return theme;
  }
  function resize() {
    if (disposed) return;
    const box = measure();
    if (backend && typeof backend.resize === 'function') {
      try { backend.resize(box.w, box.h); } catch (_) { /* ignore */ }
    }
    if (reduced) repaint();
  }
  function frameStats() {
    return { kind: stats.kind, state, frames: stats.frames, avgMs: Math.round(stats.avgMs * 100) / 100, downgrades: stats.downgrades, reason: stats.reason, lite: backend ? backend.lite === true : false, quality, disposed };
  }
  function destroy() {
    if (disposed) return false;
    disposed = true;
    running = false;
    clock.cancel();
    if (observer) {
      try { observer.disconnect(); } catch (_) { /* ignore */ }
      observer = null;
    }
    if (win && typeof win.removeEventListener === 'function') {
      try { win.removeEventListener('resize', onResize); } catch (_) { /* ignore */ }
    }
    if (doc && typeof doc.removeEventListener === 'function') {
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) { /* ignore */ }
    }
    teardown();
    clearKids(root);
    if (root.parentNode && typeof root.parentNode.removeChild === 'function') {
      try { root.parentNode.removeChild(root); } catch (_) { /* ignore */ }
    }
    setAttr(root, 'data-kind', 'none');
    stats.kind = 'none';
    stats.disposed = true;
    stats.lite = false;
    return true;
  }
  function onResize() { resize(); }
  function onVisibility() {
    if (disposed) return;
    if (doc && doc.hidden) stopLoop();
    else startLoop();
  }
  if (win && typeof win.addEventListener === 'function') {
    try { win.addEventListener('resize', onResize); } catch (_) { /* ignore */ }
  }
  if (doc && typeof doc.addEventListener === 'function') {
    try { doc.addEventListener('visibilitychange', onVisibility); } catch (_) { /* ignore */ }
  }
  if (o.mount) {
    const RO = (win && typeof win.ResizeObserver === 'function') ? win.ResizeObserver
      : (typeof ResizeObserver === 'undefined' ? null : ResizeObserver);
    if (RO) {
      try {
        observer = new RO(() => resize());
        observer.observe(o.mount);
      } catch (_) { observer = null; }
    }
  }

  boot();

  return {
    root,
    get kind() { return stats.kind; },
    setState, setLevel, setTheme, resize, frameStats,
    dispose: destroy,
    destroy,
  };
}
