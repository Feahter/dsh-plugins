// Dictation insertion: polish a recognized segment and put it into the chat input.
//
// Audio capture / VAD / ASR live in audio.js. This module only owns the last
// mile: it registers a **render-less** slot component that captures the host's
// composer actions (`insertText` / `captureInsertion` / `replaceText`), exactly
// like `SurfaceActions` in dsh-plugins/plugins/realtime-voice/client.js:1359-1370,
// and inserts polished text. If insertion fails the text is kept in `pending`
// so the caller can retry or show it.
//
// React comes from the `require` the ModuleLoader factory hands in:
//   createDictation(hooks).install(ctx, require)
// When React is unavailable the module reports "输入框不可用" and stays inert —
// it never throws into the host's slot pipeline.

// Bundler note: scripts/build-client.mjs concatenates polish.js *before* this
// file, so the bundler strips this import line and the `polish` binding resolves
// to the concatenated function. Node's ESM loader uses it as written.
import { polish as polishText } from './polish.js';

const ACTIVITY_SLOT = 'conversation.input.activity';
const FALLBACK_SLOT = 'conversation.input.right';
const ERROR_NO_INPUT = '输入框不可用';
const ERROR_KEPT = '输入框不可用，文字已保留';

function safeCall(fn, arg) {
  if (typeof fn !== 'function') return undefined;
  try {
    return fn(arg);
  } catch (_callbackError) {
    // A throwing host callback must not break insertion.
    return undefined;
  }
}

function releaseHandle(handle) {
  try {
    if (typeof handle === 'function') handle();
    else if (handle && typeof handle.dispose === 'function') handle.dispose();
  } catch (_disposeError) { /* already released */ }
}

/**
 * @param {object} [hooks]
 * @param {(state: {ready: boolean, pending: string}) => void} [hooks.onStatus]
 * @param {(text: string) => void} [hooks.onSubtitle]  what was recognized (after polish)
 * @param {(text: string) => void} [hooks.onInserted]  what actually landed in the input
 * @param {(message: string) => void} [hooks.onError]
 */
export function createDictation(hooks = {}) {
  const { onStatus, onSubtitle, onInserted, onError } = hooks;

  let actions = null;
  let pending = '';
  let ready = false;
  let disposed = false;
  let installed = false;
  let registration = null;
  let SlotProbe = null;

  function status() {
    safeCall(onStatus, { ready, pending });
  }

  function fail(message) {
    safeCall(onError, message);
  }

  function setActions(next) {
    if (disposed) return false;
    if (!next || typeof next !== 'object') {
      actions = null;
      ready = false;
      status();
      return false;
    }
    // Keep the original object, not a copy of its methods: the host's
    // insertText may rely on `this` being the composer actions object.
    actions = next;
    ready = typeof next.insertText === 'function';
    status();
    return ready;
  }

  /**
   * Register a component that renders nothing and only captures the composer
   * actions. Success means "registered", not yet "ready" — actions arrive on
   * the first render of the input slot.
   * @returns {boolean} true when the slot was registered.
   */
  function install(ctx, require) {
    if (disposed || installed) return ready;
    installed = true;

    let React = null;
    try {
      React = typeof require === 'function' ? require('react') : null;
    } catch (_requireError) {
      React = null;
    }
    if (!React) {
      ready = false;
      fail(ERROR_NO_INPUT);
      status();
      return false;
    }

    SlotProbe = function VoiceCompanionSlotProbe(props) {
      const incoming = props ? (props.inputActions || props.actions) : null;
      // Capture during render as well as in the effect: the slot may be
      // mounted without effects having flushed (and the test harness has no
      // scheduler at all). Both paths are idempotent.
      setActions(incoming);
      const effect = React.useEffect;
      if (typeof effect === 'function') effect(() => { setActions(incoming); }, [incoming]);
      return null;
    };

    const slots = ctx && ctx.slots;
    if (!slots || typeof slots.register !== 'function') {
      ready = false;
      fail(ERROR_NO_INPUT);
      status();
      return false;
    }

    try {
      registration = slots.register({ name: ACTIVITY_SLOT, priority: -1 }, SlotProbe);
    } catch (_activityError) {
      registration = null;
      try {
        registration = slots.register({ name: FALLBACK_SLOT }, SlotProbe);
      } catch (_fallbackError) {
        registration = null;
      }
    }
    if (!registration) {
      ready = false;
      fail(ERROR_NO_INPUT);
      status();
      return false;
    }

    // Let the host tear us down with the plugin, if it offers an effect hook.
    if (typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => () => dispose());
      } catch (_effectError) { /* optional integration */ }
    }

    status();
    return true;
  }

  /**
   * Polish `text` and insert it. `true` only when the host accepted the text.
   * On failure (no actions, exception, host returned false) the polished text
   * stays in `pending` and `onError` fires with "输入框不可用，文字已保留".
   */
  function insert(text) {
    if (disposed) return false;
    const raw = String(text == null ? '' : text);
    let polished = '';
    try {
      polished = polishText(raw);
    } catch (_polishError) {
      polished = raw.trim();
    }
    if (!polished) return false;

    safeCall(onSubtitle, polished);

    if (!actions || typeof actions.insertText !== 'function') {
      pending = polished;
      fail(ERROR_KEPT);
      status();
      return false;
    }

    let accepted = false;
    try {
      let target;
      if (typeof actions.captureInsertion === 'function') {
        try { target = actions.captureInsertion(); } catch (_captureError) { target = undefined; }
      }
      accepted = target === undefined
        ? actions.insertText(polished) === true
        : actions.insertText(polished, target) === true;
    } catch (_insertError) {
      accepted = false;
    }

    if (accepted) {
      pending = '';
      safeCall(onInserted, polished);
      status();
      return true;
    }
    pending = polished;
    fail(ERROR_KEPT);
    status();
    return false;
  }

  function reset() {
    pending = '';
    status();
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    releaseHandle(registration);
    registration = null;
    actions = null;
    ready = false;
    return true;
  }

  return {
    install,
    setActions,
    insert,
    reset,
    dispose,
    get pending() { return pending; },
    get ready() { return ready; },
  };
}
