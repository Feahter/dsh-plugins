// Voice companion avatar: the character stage inside a fixed glass HUD panel.
//
// Pure ESM, zero dependencies, no build step. Everything (styles, headers, the
// picker) is created from code so the component works from HTTP, from an
// Electron app, or from a file:// page without fetching an asset.
//
// The artwork itself lives in characters.js — this file only knows the cast
// contract: pick one, swap the stage, keep the mouth in sync with the audio
// level. assets/fish.svg is the canonical static art of the whale; keep the two
// in sync when the silhouette changes.

import {
  listCharacters,
  mouthPathFor,
  nextCharacterId,
  renderCharacter,
  resolveCharacter,
} from './characters.js';

const SUBTITLE_MAX = 60;
const BLINK_MIN_MS = 3000;
const BLINK_MAX_MS = 6000;
const BLINK_HOLD_MS = 150;

// ------------------------------------------------------------------- styling

const STYLE_TEXT = `
[data-vc-avatar]{--vc-accent:#6b85ff;position:fixed;right:18px;bottom:18px;z-index:2147483000;width:320px;box-sizing:border-box;color:#edf2ff;font:13px/1.45 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-user-select:none;user-select:none;text-align:left}
[data-vc-avatar] *{box-sizing:border-box}
[data-vc-avatar] .vc-panel{position:relative;height:260px;padding:9px 12px 8px;display:flex;flex-direction:column;gap:6px;border-radius:20px;border:1px solid rgba(120,150,255,.18);background:linear-gradient(160deg,rgba(20,32,66,.88),rgba(8,14,30,.94));box-shadow:0 18px 44px rgba(2,7,16,.5),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);overflow:hidden;transition:transform .18s ease,box-shadow .3s ease}
[data-vc-avatar] .vc-head{display:flex;align-items:center;gap:6px;min-height:22px;flex:none;font-size:11px;letter-spacing:.02em;color:#cfd9f5}
[data-vc-avatar] .vc-dot{width:6px;height:6px;border-radius:50%;background:#8b93a7;flex:none;transition:background .2s ease,box-shadow .2s ease}
[data-vc-avatar] .vc-label{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
[data-vc-avatar] .vc-picker{display:flex;gap:4px;flex:none}
[data-vc-avatar] .vc-chip{appearance:none;width:21px;height:21px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#c3d0f7;font:600 11px/1 "PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer;display:grid;place-items:center;transition:transform .12s ease,background .15s ease,border-color .15s ease}
[data-vc-avatar] .vc-chip:hover{background:rgba(255,255,255,.12)}
[data-vc-avatar] .vc-chip:active{transform:translateY(1px)}
[data-vc-avatar] .vc-chip:focus-visible{outline:2px solid #9db4ff;outline-offset:2px}
[data-vc-avatar] .vc-chip[aria-pressed="true"]{background:linear-gradient(180deg,#7d95ff,#4d6bfe);border-color:rgba(200,216,255,.55);color:#fff;box-shadow:0 0 0 1px rgba(120,150,255,.35)}
[data-vc-avatar] .vc-mode{appearance:none;flex:none;height:21px;padding:0 8px;border-radius:11px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#c3d0f7;font:600 11px/1 "PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer;letter-spacing:.02em;transition:background .15s ease,border-color .15s ease}
[data-vc-avatar] .vc-mode:hover{background:rgba(255,255,255,.12)}
[data-vc-avatar] .vc-mode[data-mode="dictation"]{background:linear-gradient(180deg,#5fd0a8,#22a37a);border-color:rgba(180,255,224,.5);color:#04241b}
[data-vc-avatar] .vc-mode:focus-visible{outline:2px solid #9db4ff;outline-offset:2px}
[data-vc-avatar] .vc-actions{margin-left:auto;display:flex;gap:6px;flex:none}

/* The panel floats above the app, so it must never become a roadblock: the head
   is a drag handle, the top-right button folds the whole thing into a pill. */
[data-vc-avatar] .vc-head{cursor:grab;touch-action:none}
[data-vc-avatar][data-dragging] .vc-head{cursor:grabbing}
[data-vc-avatar][data-dragging] .vc-panel{transition:none}
[data-vc-avatar] .vc-min{appearance:none;flex:none;width:21px;height:21px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#c3d0f7;font:600 13px/1 system-ui,sans-serif;cursor:pointer;display:grid;place-items:center;transition:background .15s ease,border-color .15s ease}
[data-vc-avatar] .vc-min:hover{background:rgba(255,255,255,.14)}
[data-vc-avatar] .vc-min:focus-visible{outline:2px solid #9db4ff;outline-offset:2px}
[data-vc-avatar][data-collapsed]{width:max-content;max-width:min(320px,calc(100vw - 36px))}
[data-vc-avatar][data-collapsed] .vc-panel{height:auto;width:auto;padding:6px 10px;border-radius:999px}
[data-vc-avatar][data-collapsed] .vc-head{width:auto}
[data-vc-avatar][data-collapsed] .vc-stage,
[data-vc-avatar][data-collapsed] .vc-bubble,
[data-vc-avatar][data-collapsed] .vc-partial,
[data-vc-avatar][data-collapsed] .vc-picker,
[data-vc-avatar][data-collapsed] .vc-mode,
[data-vc-avatar][data-collapsed] .vc-actions{display:none}
[data-vc-avatar][data-collapsed] .vc-head{min-height:20px;gap:7px}
[data-vc-avatar][data-collapsed] .vc-label{white-space:nowrap}
[data-vc-avatar] .vc-btn{appearance:none;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:5px 11px;font:600 11px/1.2 inherit;color:#eef3ff;background:rgba(255,255,255,.08);cursor:pointer;transition:transform .12s ease,filter .15s ease,background .15s ease}
[data-vc-avatar] .vc-btn:hover{filter:brightness(1.08)}
[data-vc-avatar] .vc-btn:active{transform:translateY(1px)}
[data-vc-avatar] .vc-btn:focus-visible{outline:2px solid #9db4ff;outline-offset:2px}
[data-vc-avatar] .vc-start{background:linear-gradient(180deg,#7d95ff,#4d6bfe);border-color:rgba(190,210,255,.4);color:#ffffff}
[data-vc-avatar] .vc-end{background:rgba(255,104,104,.16);border-color:rgba(255,128,128,.38);color:#ffc4c4}
[data-vc-avatar] .vc-start,[data-vc-avatar] .vc-end{display:none}
[data-vc-avatar][data-state="idle"] .vc-start,[data-vc-avatar][data-state="error"] .vc-start{display:inline-flex}
[data-vc-avatar][data-state="listening"] .vc-end,[data-vc-avatar][data-state="thinking"] .vc-end,[data-vc-avatar][data-state="speaking"] .vc-end{display:inline-flex}
[data-vc-avatar] .vc-stage{position:relative;flex:1 1 auto;min-height:118px;display:grid;place-items:center;overflow:hidden;border-radius:14px}
[data-vc-avatar] .vc-fish{position:relative;display:grid;place-items:center;filter:drop-shadow(0 10px 18px rgba(0,0,0,.35));transition:filter .3s ease,transform .3s ease}
[data-vc-avatar] .vc-fish-svg{display:block;width:186px;height:155px;overflow:visible}
[data-vc-avatar] .vc-swap{animation:vc-swap .32s ease-out}
[data-vc-avatar] .vc-ripple{position:absolute;left:50%;top:50%;width:196px;height:196px;margin:-98px 0 0 -98px;border-radius:50%;border:2px solid rgba(107,133,255,.55);opacity:0;display:none;pointer-events:none}
[data-vc-avatar][data-state="listening"] .vc-ripple{display:block;animation:vc-ripple 2.6s ease-out infinite}
[data-vc-avatar][data-state="listening"] .vc-ripple-2{animation-delay:1.3s}
[data-vc-avatar] .vc-dots{position:absolute;top:0;left:56%;transform:translateX(-50%);display:none;gap:5px}
[data-vc-avatar][data-state="thinking"] .vc-dots{display:flex}
[data-vc-avatar] .vc-dots i{display:block;width:6px;height:6px;border-radius:50%;background:#93a9ff;animation:vc-think 1s ease-in-out infinite}
[data-vc-avatar] .vc-dots i:nth-child(2){animation-delay:.15s}
[data-vc-avatar] .vc-dots i:nth-child(3){animation-delay:.3s}
[data-vc-avatar] .vc-bubble{flex:none;min-height:30px;max-height:34px;padding:6px 9px;border-radius:12px;border:1px solid rgba(140,170,255,.14);background:rgba(120,150,255,.10);font-size:12px;line-height:1.4;color:#e8eeff;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;transition:background .2s ease}
[data-vc-avatar] .vc-bubble[data-role="user"]{background:rgba(140,170,255,.06);color:#9fb0d6;font-style:italic}
[data-vc-avatar] .vc-partial{flex:none;height:16px;font-size:11px;color:#9db4ff;opacity:0;transition:opacity .2s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-vc-avatar] .vc-partial[data-visible="1"]{opacity:.9}
[data-vc-avatar] .vc-eye{transform-box:fill-box;transform-origin:center;transition:transform .1s ease}
[data-vc-avatar] .vc-pupil{transition:transform .25s ease}
[data-vc-avatar] .vc-whale{transform-box:fill-box;transform-origin:58% 55%;transition:transform .3s ease}
[data-vc-avatar][data-state="idle"] .vc-whale{animation:vc-sway 5.4s ease-in-out infinite}
[data-vc-avatar][data-state="listening"] .vc-whale{transform:rotate(-2.5deg) translateY(-2px)}
[data-vc-avatar] .vc-spout{opacity:0;transition:opacity .25s ease}
[data-vc-avatar][data-state="speaking"] .vc-spout{opacity:1}
[data-vc-avatar] .vc-spout circle{transform-box:fill-box;transform-origin:center}
[data-vc-avatar][data-state="speaking"] .vc-spout circle{animation:vc-spout 1.9s ease-out infinite}
[data-vc-avatar][data-state="speaking"] .vc-spout circle:nth-child(2){animation-delay:.3s}
[data-vc-avatar][data-state="speaking"] .vc-spout circle:nth-child(3){animation-delay:.6s}
[data-vc-avatar][data-blink="1"] .vc-eye{transform:scaleY(.06)}
[data-vc-avatar][data-state="thinking"] .vc-pupil{transform:translateY(-7px)}
[data-vc-avatar][data-state="error"] .vc-eye{transform:scaleY(.5)}
[data-vc-avatar][data-state="error"] .vc-whale{transform:translateY(5px)}
[data-vc-avatar][data-state="idle"] .vc-fish{animation:vc-breathe 3.8s ease-in-out infinite}
[data-vc-avatar][data-state="speaking"] .vc-fish{animation:vc-bob .4s ease-in-out infinite alternate}
[data-vc-avatar][data-state="error"] .vc-panel{transform:translateY(2px)}
[data-vc-avatar][data-state="error"] .vc-fish{filter:grayscale(.6) brightness(.82) drop-shadow(0 8px 14px rgba(0,0,0,.4))}
[data-vc-avatar][data-state="listening"] .vc-dot{background:#7fe3a8;box-shadow:0 0 8px rgba(127,227,168,.7)}
[data-vc-avatar][data-state="thinking"] .vc-dot{background:#9db4ff;box-shadow:0 0 8px rgba(157,180,255,.7)}
[data-vc-avatar][data-state="speaking"] .vc-dot{background:#8fa6ff;box-shadow:0 0 8px rgba(143,166,255,.7)}
[data-vc-avatar][data-state="error"] .vc-dot{background:#ff7676;box-shadow:0 0 8px rgba(255,118,118,.6)}
@keyframes vc-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
@keyframes vc-bob{from{transform:translateY(0)}to{transform:translateY(-3px)}}
@keyframes vc-sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
@keyframes vc-swap{from{opacity:0;transform:translateY(6px) scale(.96)}to{opacity:1;transform:none}}
@keyframes vc-spout{0%{opacity:0;transform:translateY(9px) scale(.55)}30%{opacity:.95}100%{opacity:0;transform:translateY(-13px) scale(1.1)}}
@keyframes vc-ripple{0%{opacity:.55;transform:scale(.72)}70%{opacity:0;transform:scale(1.35)}100%{opacity:0;transform:scale(1.35)}}
@keyframes vc-think{0%,100%{transform:translateY(0);opacity:.55}40%{transform:translateY(-6px);opacity:1}}
@media (prefers-reduced-motion:reduce){[data-vc-avatar],[data-vc-avatar] *{animation:none!important;transition:none!important}}
`;

// -------------------------------------------------------------------- timers

// Kept module-wide so the test harness can assert that dispose() drains them.
const activeTimers = new Set();

function later(fn, ms) {
  const handle = setTimeout(() => {
    activeTimers.delete(handle);
    fn();
  }, ms);
  activeTimers.add(handle);
  return handle;
}

function cancel(handle) {
  if (handle === null || handle === undefined) return;
  clearTimeout(handle);
  activeTimers.delete(handle);
}

const styledDocuments = new WeakSet();

function ensureStyles(doc) {
  if (styledDocuments.has(doc)) return;
  styledDocuments.add(doc);
  const style = doc.createElement('style');
  style.setAttribute('data-vc-avatar-style', '');
  style.textContent = STYLE_TEXT;
  const host = doc.head || doc.body;
  if (host && typeof host.appendChild === 'function') host.appendChild(style);
}

// ---------------------------------------------------------------- component

function element(doc, tag, attrs, text) {
  const node = doc.createElement(tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function truncateSubtitle(text) {
  const value = String(text === null || text === undefined ? '' : text);
  if (value.length <= SUBTITLE_MAX) return value;
  return value.slice(0, SUBTITLE_MAX).trimEnd() + '…';
}

export function createAvatar(options = {}) {
  const mount = options && options.mount;
  if (!mount || typeof mount.appendChild !== 'function') {
    throw new TypeError('createAvatar: options.mount must be an element');
  }
  const onAction = typeof options.onAction === 'function' ? options.onAction : null;
  const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('createAvatar: no document available');

  ensureStyles(doc);

  const initial = resolveCharacter(options.character);

  const root = element(doc, 'div', {
    'data-vc-avatar': '',
    'data-state': 'idle',
    'data-character': initial.id,
    role: 'region',
    'aria-label': initial.name + '语音管家',
  });

  const panel = element(doc, 'div', { class: 'vc-panel' });
  const head = element(doc, 'div', { class: 'vc-head' });
  const dot = element(doc, 'span', { class: 'vc-dot', 'aria-hidden': 'true' });
  const label = element(doc, 'span', { class: 'vc-label' }, initial.labels.idle);

  // The cast picker: one round chip per character, first letter on the chip and
  // the full name in the accessible label.
  const picker = element(doc, 'div', { class: 'vc-picker', role: 'group', 'aria-label': '切换看板娘' });
  const chips = listCharacters().map((entry) => {
    const chip = element(doc, 'button', {
      class: 'vc-chip',
      type: 'button',
      'data-character': entry.id,
      'aria-pressed': entry.id === initial.id ? 'true' : 'false',
      'aria-label': entry.name,
      title: entry.name + ' · ' + entry.tagline,
    }, entry.name.slice(0, 1));
    if (typeof chip.addEventListener === 'function') {
      chip.addEventListener('click', () => selectCharacter(entry.id, true));
    }
    picker.appendChild(chip);
    return { id: entry.id, node: chip };
  });

  // 对话 / 听写: one microphone feed, two destinations. The switch is a button rather
  // than a setting so the current mode is always on screen.
  const modeButton = element(doc, 'button', {
    class: 'vc-mode',
    type: 'button',
    'data-mode': options.mode === 'dictation' ? 'dictation' : 'call',
    title: '切换 对话 / 听写',
  }, options.mode === 'dictation' ? '听写' : '对话');
  if (typeof modeButton.addEventListener === 'function') {
    modeButton.addEventListener('click', () => {
      const next = (modeButton.getAttribute('data-mode') === 'dictation') ? 'call' : 'dictation';
      if (onAction) onAction('mode', next);
    });
  }

  // Fold / unfold. Kept in the head so the same gesture that drags also hides it.
  const minButton = element(doc, 'button', {
    class: 'vc-min',
    type: 'button',
    'aria-expanded': 'true',
    'aria-label': '收起看板娘',
    title: '收起看板娘',
  }, '\u2212');

  const actions = element(doc, 'div', { class: 'vc-actions' });
  const startButton = element(doc, 'button', { class: 'vc-btn vc-start', type: 'button' }, '开始通话');
  const endButton = element(doc, 'button', { class: 'vc-btn vc-end', type: 'button' }, '结束');
  actions.appendChild(startButton);
  actions.appendChild(endButton);
  head.appendChild(dot);
  head.appendChild(label);
  head.appendChild(picker);
  head.appendChild(modeButton);
  head.appendChild(minButton);
  head.appendChild(actions);

  const stage = element(doc, 'div', { class: 'vc-stage' });
  const ripple1 = element(doc, 'span', { class: 'vc-ripple vc-ripple-1', 'aria-hidden': 'true' });
  const ripple2 = element(doc, 'span', { class: 'vc-ripple vc-ripple-2', 'aria-hidden': 'true' });
  const dots = element(doc, 'div', { class: 'vc-dots', 'aria-hidden': 'true' });
  dots.appendChild(element(doc, 'i'));
  dots.appendChild(element(doc, 'i'));
  dots.appendChild(element(doc, 'i'));

  const fishWrap = element(doc, 'div', { class: 'vc-fish' });

  stage.appendChild(ripple1);
  stage.appendChild(ripple2);
  stage.appendChild(dots);
  stage.appendChild(fishWrap);

  const bubble = element(doc, 'div', { class: 'vc-bubble', 'data-role': 'assistant', 'aria-live': 'polite' });
  const partial = element(doc, 'div', { class: 'vc-partial', 'aria-live': 'polite' });

  panel.appendChild(head);
  panel.appendChild(stage);
  panel.appendChild(bubble);
  panel.appendChild(partial);
  root.appendChild(panel);
  mount.appendChild(root);

  let state = 'idle';
  let blinkTimer = null;
  let disposed = false;
  let art = null;

  function clearStage() {
    while (fishWrap.children.length > 0) fishWrap.removeChild(fishWrap.children[0]);
  }

  function applyCharacter(id, animate) {
    const next = renderCharacter(doc, id);
    clearStage();
    if (animate) next.svg.setAttribute('class', 'vc-fish-svg vc-swap');
    fishWrap.appendChild(next.svg);
    art = next;
    root.setAttribute('data-character', next.id);
    root.setAttribute('aria-label', next.name + '语音管家');
    label.textContent = next.labels[state];
    for (const chip of chips) {
      chip.node.setAttribute('aria-pressed', chip.id === next.id ? 'true' : 'false');
      chip.node.setAttribute('data-selected', chip.id === next.id ? '1' : '0');
    }
    return next;
  }

  function characterId() {
    return art ? art.id : initial.id;
  }

  // Swaps the stage to another character. `notify` is only true for a real user
  // click, so restoring a saved character never fires onAction.
  function selectCharacter(id, notify) {
    if (disposed) return characterId();
    const wanted = resolveCharacter(id).id;
    if (art && art.id === wanted) return wanted;
    applyCharacter(wanted, true);
    if (notify && onAction) onAction('character', wanted);
    if (state !== 'speaking') setMouth(0);
    return wanted;
  }

  function cycleCharacter(notify) {
    return selectCharacter(nextCharacterId(characterId()), notify !== false);
  }

  const handleStart = () => {
    if (!disposed && onAction) onAction('start');
  };
  const handleEnd = () => {
    if (!disposed && onAction) onAction('end');
  };
  if (typeof startButton.addEventListener === 'function') {
    startButton.addEventListener('click', handleStart);
  }
  if (typeof endButton.addEventListener === 'function') {
    endButton.addEventListener('click', handleEnd);
  }

  // ------------------------------------------------------------ window state
  // The panel sits on top of the app, so it has to get out of the way: drag it by
  // the head, fold it to a pill, and remember both facts for next launch.
  const win = (doc && doc.defaultView) || null;
  const POS_KEY = 'dsh.voice-companion.pos';
  const FOLD_KEY = 'dsh.voice-companion.collapsed';

  function readStore(key) {
    try {
      if (win && win.localStorage) return win.localStorage.getItem(key);
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch (error) { /* private mode or quota: position is a nicety, not a need */ }
    return null;
  }

  function writeStore(key, value) {
    try {
      if (win && win.localStorage) { win.localStorage.setItem(key, value); return; }
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch (error) { /* ignore */ }
  }

  function viewport() {
    const width = win && typeof win.innerWidth === 'number' && win.innerWidth > 0 ? win.innerWidth : 1280;
    const height = win && typeof win.innerHeight === 'number' && win.innerHeight > 0 ? win.innerHeight : 800;
    return { width, height };
  }

  function px(value) {
    const n = parseFloat(String(value === undefined || value === null ? '' : value));
    return Number.isFinite(n) ? n : null;
  }

  // Where the panel currently is, in viewport pixels. Falls back to the CSS corner
  // (right/bottom 18px) when nothing has been measured yet.
  function measure() {
    if (typeof root.getBoundingClientRect === 'function') {
      const rect = root.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) {
        return { left: rect.left || 0, top: rect.top || 0, width: rect.width || 0, height: rect.height || 0 };
      }
    }
    const left = px(root.style.left);
    const top = px(root.style.top);
    if (left !== null && top !== null) {
      return { left, top, width: px(root.style.width) || 320, height: px(root.style.height) || 260 };
    }
    const box = viewport();
    return { left: box.width - 18 - 320, top: box.height - 18 - 260, width: 320, height: 260 };
  }

  // Absolute left/top, clamped so at least a strip of the panel stays reachable.
  function place(left, top) {
    const box = viewport();
    const size = measure();
    const maxLeft = Math.max(0, box.width - Math.min(size.width || 320, 120));
    const maxTop = Math.max(0, box.height - 40);
    const nextLeft = Math.max(0, Math.min(left, maxLeft));
    const nextTop = Math.max(0, Math.min(top, maxTop));
    root.style.left = nextLeft + 'px';
    root.style.top = nextTop + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    return { left: nextLeft, top: nextTop };
  }

  let drag = null;
  let dragged = false;

  // Chips and buttons live inside the head; pressing them must not start a drag.
  function isControl(node) {
    let current = node;
    while (current && current !== root) {
      const cls = current.getAttribute ? current.getAttribute('class') : null;
      if (cls && /(^|\s)(vc-chip|vc-btn|vc-mode|vc-min)(\s|$)/.test(cls)) return true;
      current = current.parentNode;
    }
    return false;
  }

  function eventPoint(event) {
    if (!event) return null;
    const x = typeof event.clientX === 'number' ? event.clientX : null;
    const y = typeof event.clientY === 'number' ? event.clientY : null;
    return x === null || y === null ? null : { x, y };
  }

  function onDragStart(event) {
    if (disposed || isControl(event && event.target)) return;
    const point = eventPoint(event);
    if (!point) return;
    const box = measure();
    drag = { x: point.x, y: point.y, left: box.left, top: box.top };
    dragged = false;
    root.setAttribute('data-dragging', '1');
    if (typeof event.preventDefault === 'function') event.preventDefault();
    bindDrag();
  }

  function onDragMove(event) {
    if (!drag) return;
    const point = eventPoint(event);
    if (!point) return;
    const dx = point.x - drag.x;
    const dy = point.y - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 3) return;
    dragged = true;
    place(drag.left + dx, drag.top + dy);
  }

  function onDragEnd() {
    if (!drag) return;
    drag = null;
    root.removeAttribute('data-dragging');
    const left = px(root.style.left);
    const top = px(root.style.top);
    if (left !== null && top !== null) writeStore(POS_KEY, JSON.stringify({ left, top }));
    unbindDrag();
    // A tap on the folded pill (no movement) opens it again.
    if (!dragged && isCollapsed()) setCollapsed(false);
  }

  function bindDrag() {
    if (!doc || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('pointermove', onDragMove);
    doc.addEventListener('pointerup', onDragEnd);
    doc.addEventListener('pointercancel', onDragEnd);
    doc.addEventListener('mousemove', onDragMove);
    doc.addEventListener('mouseup', onDragEnd);
  }

  function unbindDrag() {
    if (!doc || typeof doc.removeEventListener !== 'function') return;
    doc.removeEventListener('pointermove', onDragMove);
    doc.removeEventListener('pointerup', onDragEnd);
    doc.removeEventListener('pointercancel', onDragEnd);
    doc.removeEventListener('mousemove', onDragMove);
    doc.removeEventListener('mouseup', onDragEnd);
  }

  function isCollapsed() {
    return root.getAttribute('data-collapsed') === '1';
  }

  function setCollapsed(next) {
    if (disposed) return isCollapsed();
    const wanted = !!next;
    if (wanted) root.setAttribute('data-collapsed', '1');
    else root.removeAttribute('data-collapsed');
    minButton.textContent = wanted ? '\uff0b' : '\u2212';
    minButton.setAttribute('aria-expanded', wanted ? 'false' : 'true');
    minButton.setAttribute('aria-label', wanted ? '展开看板娘' : '收起看板娘');
    minButton.setAttribute('title', wanted ? '展开看板娘' : '收起看板娘');
    writeStore(FOLD_KEY, wanted ? '1' : '0');
    if (wanted) stopBlink();
    else if (state === 'idle') scheduleBlink();
    return wanted;
  }

  function toggleCollapsed() {
    return setCollapsed(!isCollapsed());
  }

  const handleFold = () => {
    if (!disposed) toggleCollapsed();
  };

  function onViewportResize() {
    const left = px(root.style.left);
    const top = px(root.style.top);
    if (left !== null && top !== null) place(left, top);
  }

  if (typeof minButton.addEventListener === 'function') {
    minButton.addEventListener('click', handleFold);
  }
  if (typeof head.addEventListener === 'function') {
    head.addEventListener('pointerdown', onDragStart);
    head.addEventListener('mousedown', onDragStart);
  }
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('resize', onViewportResize);
  }

  function stopBlink() {
    cancel(blinkTimer);
    blinkTimer = null;
    root.removeAttribute('data-blink');
  }

  function scheduleBlink() {
    if (disposed || state !== 'idle') return;
    // Re-arming (state bounce, unfold) must not stack a second chain behind the
    // first: only one handle is ever tracked, so an extra one would leak.
    cancel(blinkTimer);
    blinkTimer = null;
    const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
    blinkTimer = later(() => {
      blinkTimer = null;
      if (disposed || state !== 'idle') return;
      root.setAttribute('data-blink', '1');
      blinkTimer = later(() => {
        blinkTimer = null;
        root.removeAttribute('data-blink');
        if (!disposed && state === 'idle') scheduleBlink();
      }, BLINK_HOLD_MS);
    }, delay);
  }

  function setMouth(level) {
    if (!art) return;
    art.mouth.setAttribute('d', art.mouthPath(level));
  }

  function setState(next) {
    if (disposed) return;
    const labels = art ? art.labels : initial.labels;
    const wanted = Object.prototype.hasOwnProperty.call(labels, next) ? next : 'idle';
    state = wanted;
    root.setAttribute('data-state', wanted);
    label.textContent = labels[wanted];
    if (wanted !== 'speaking') setMouth(0);
    stopBlink();
    if (wanted === 'idle') scheduleBlink();
  }

  function setLevel(level) {
    if (disposed || state !== 'speaking') return;
    setMouth(level);
  }

  function setSubtitle(text, config = {}) {
    if (disposed) return;
    const role = config && config.role === 'user' ? 'user' : 'assistant';
    bubble.setAttribute('data-role', role);
    bubble.textContent = truncateSubtitle(text);
  }

  function setPartial(text) {
    if (disposed) return;
    const value = String(text === null || text === undefined ? '' : text);
    partial.textContent = value;
    if (value) partial.setAttribute('data-visible', '1');
    else partial.removeAttribute('data-visible');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopBlink();
    if (typeof startButton.removeEventListener === 'function') {
      startButton.removeEventListener('click', handleStart);
    }
    if (typeof endButton.removeEventListener === 'function') {
      endButton.removeEventListener('click', handleEnd);
    }
    unbindDrag();
    if (typeof minButton.removeEventListener === 'function') {
      minButton.removeEventListener('click', handleFold);
    }
    if (typeof head.removeEventListener === 'function') {
      head.removeEventListener('pointerdown', onDragStart);
      head.removeEventListener('mousedown', onDragStart);
    }
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('resize', onViewportResize);
    }
    if (root.parentNode && typeof root.parentNode.removeChild === 'function') {
      root.parentNode.removeChild(root);
    }
  }

  applyCharacter(initial.id, false);
  setState('idle');
  const savedPos = readStore(POS_KEY);
  if (savedPos) {
    try {
      const box = JSON.parse(savedPos);
      if (box && Number.isFinite(box.left) && Number.isFinite(box.top)) place(box.left, box.top);
    } catch (error) { /* corrupt value: keep the default corner */ }
  }
  setCollapsed(readStore(FOLD_KEY) === '1');

  return {
    root,
    setState,
    setLevel,
    setSubtitle,
    setPartial,
    setCharacter: (id) => selectCharacter(id, false),
    setCollapsed,
    toggleCollapsed,
    // Where the panel was left, so a caller can re-apply it after a remount.
    get position() {
      return { left: px(root.style.left), top: px(root.style.top) };
    },
    get collapsed() {
      return isCollapsed();
    },
    cycleCharacter,
    // The label switches together with the button so the two never disagree.
    setMode: (mode) => {
      const next = mode === 'dictation' ? 'dictation' : 'call';
      modeButton.setAttribute('data-mode', next);
      modeButton.textContent = next === 'dictation' ? '听写' : '对话';
      return next;
    },
    get character() {
      return characterId();
    },
    get mode() {
      return modeButton.getAttribute('data-mode');
    },
    dispose,
  };
}

// Helpers for offline tests (test/avatar-harness.mjs); not used at runtime.
export const __test = {
  pendingTimers: () => activeTimers.size,
  subtitleMax: SUBTITLE_MAX,
  mouthPathFor: (level, id = 'whale') => mouthPathFor(id, level),
};
