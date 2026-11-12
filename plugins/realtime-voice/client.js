window.__ModuleLoader__.load({
  id: 'dsh-realtime-voice',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'realtime-voice';
    const VERSION = '0.3.0';
    const SAMPLE_RATE = 16000;
    const FRAME = 320; // 20 ms @ 16 kHz
    const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;
    const SETTINGS_KEY = 'dsh.realtime-voice.settings.v2';
    const REFINE_PATH = '/plugins/realtime-voice/refine';
    const HEALTH_PATH = '/plugins/realtime-voice/health';

    // ---------------------------------------------------------------- locale
    const zh = {
      open: '实时语音输入',
      stop: '停止',
      starting: '正在打开麦克风…',
      listening: '正在听…',
      idle: '已停止',
      partialHint: '识别中',
      empty: '没有识别到语音',
      insert: '插入',
      pending: '草稿已变化，结果已保留',
      failed: '失败：{message}',
      permissionDenied: '麦克风权限被拒绝，请在系统设置里允许后重试。',
      unavailable: '当前环境无法录音。',
      notReady: '本地语音模型尚未就绪，请先在插件管理里完成"语音输入"的模型准备。',
      preparing: '正在准备本地语音模型…',
      noInput: '输入框不可用，暂时无法插入文字。',
      stopped: '已停止',
      settings: '实时语音设置',
      close: '关闭',
      tabInput: '输入',
      tabPolish: '润色',
      tabTranslate: '翻译',
      tabDictionary: '词典',
      langLabel: '识别语言',
      langAuto: '自动',
      modeDictate: '听写',
      modeTranslate: '翻译',
      modeHintDictate: '说中文写中文，停顿即断句插入',
      modeHintTranslate: '说的内容进模型翻译后插入',
      targetLabel: '翻译成',
      polishLabel: '语音后自动排版与纠错',
      polishHint: '去口头语、合并重复、修正自我更改、补标点、口述命令转格式',
      fillerLabel: '去掉"嗯/呃/那个"',
      repeatsLabel: '合并重复词',
      correctionsLabel: '采纳自我更正（保留最后意图）',
      punctuationLabel: '自动补标点',
      commandsLabel: '口述格式命令（换行/逗号/列表）',
      soundsLabel: '起停提示音',
      contextLabel: '连句校正',
      contextHint: '相邻两句一起排版：跨句去重、接住「不对，我是说…」的更正、不把句子从中间断开。代价是每句晚一拍插入',
      flushLabel: '等下一句的时长',
      flush800: '较快 · 0.8 秒',
      flush1400: '标准 · 1.4 秒',
      flush2200: '较慢 · 2.2 秒',
      waitingNext: '等下一句一起校正',
      partialLabel: '实时字幕预览',
      dictLabel: '自定义词典（每行：原词=替换词）',
      dictHint: '识别后按顺序替换，可用于纠正人名、术语',
      translateUnavailable: '翻译失败，已插入原文',
      translateOffline: '已关闭在线翻译，按原文插入',
      onlineLabel: '在线翻译',
      onlineHint: '仅翻译模式使用；开启后这句话的文字会发往翻译服务（本机未装翻译插件时走 Google 匿名接口）',
      fallbackLabel: '翻译失败时阻断插入',
      fallbackHint: '关闭时插入原文并提示；开启时这一句不插入，只报错',
      translateReady: '翻译服务可用',
      translateMissing: '翻译服务未就绪（需宿主侧插件）',
      previewLabel: '润色预览',
      undo: '撤销这一句',
      undoHint: '把刚插入的这一句移除',
      micLabel: '麦克风',
      advanced: '高级',
      capYes: '可用',
      capNo: '不可用',
      copied: '已复制',
      hintHotkey: '点击麦克风开始，再点一次结束；结果插入到光标处',
    };
    const en = {
      open: 'Realtime voice input',
      stop: 'Stop',
      starting: 'Opening the microphone…',
      listening: 'Listening…',
      idle: 'Stopped',
      partialHint: 'Recognizing',
      empty: 'No speech recognized',
      insert: 'Insert',
      pending: 'Your draft changed; result kept',
      failed: 'Failed: {message}',
      permissionDenied: 'Microphone permission was denied. Allow it and try again.',
      unavailable: 'Recording is unavailable in this environment.',
      notReady: 'The local speech model is not ready. Prepare it in the voice-input plugin first.',
      preparing: 'Preparing the local speech model…',
      noInput: 'The input is unavailable; cannot insert text.',
      stopped: 'Stopped',
      settings: 'Realtime voice settings',
      close: 'Close',
      tabInput: 'Input',
      tabPolish: 'Polish',
      tabTranslate: 'Translate',
      tabDictionary: 'Dictionary',
      langLabel: 'Speech language',
      langAuto: 'Auto',
      modeDictate: 'Dictate',
      modeTranslate: 'Translate',
      modeHintDictate: 'Speak, pause, and the sentence lands in the composer',
      modeHintTranslate: 'Speech is translated before insertion',
      targetLabel: 'Translate into',
      polishLabel: 'Auto-format and correct after speech',
      polishHint: 'Drop fillers, merge repeats, resolve self-corrections, add punctuation, spoken formatting',
      fillerLabel: 'Remove "um/uh/like"',
      repeatsLabel: 'Merge repeated words',
      correctionsLabel: 'Keep the final intent on self-correction',
      punctuationLabel: 'Add punctuation',
      commandsLabel: 'Spoken formatting (newline/comma/list)',
      soundsLabel: 'Start/stop earcons',
      contextLabel: 'Join adjacent phrases',
      contextHint: 'Polish two phrases together: drop the repeated seam, follow a self-correction across the pause, never split a sentence. Each phrase lands one beat later',
      flushLabel: 'Hold window',
      flush800: 'Fast · 0.8 s',
      flush1400: 'Standard · 1.4 s',
      flush2200: 'Patient · 2.2 s',
      waitingNext: 'Waiting for the next phrase',
      partialLabel: 'Live transcript preview',
      dictLabel: 'Custom dictionary (one "from=to" per line)',
      dictHint: 'Applied after recognition; fixes names and jargon',
      translateUnavailable: 'Translation failed; inserted the source text',
      translateOffline: 'Online translation is off; inserted the source text',
      onlineLabel: 'Online translation',
      onlineHint: 'Translate mode only. When on, the text of each sentence is sent to a translation service (Google’s anonymous endpoint when no translator plugin is installed).',
      fallbackLabel: 'Block insertion when translation fails',
      fallbackHint: 'Off inserts the source text with a warning; on reports the error and inserts nothing.',
      translateReady: 'Translation service available',
      translateMissing: 'Translation service not ready (host plugin required)',
      previewLabel: 'Preview',
      undo: 'Undo this sentence',
      undoHint: 'Remove the sentence just inserted',
      micLabel: 'Microphone',
      advanced: 'Advanced',
      capYes: 'available',
      capNo: 'unavailable',
      copied: 'Copied',
      hintHotkey: 'Click the mic to start, click again to stop; the result lands at the caret',
    };

    // ---------------------------------------------------------------- helpers
    function concatFloat(parts) {
      let length = 0;
      for (const part of parts) length += part.length;
      const out = new Float32Array(length);
      let at = 0;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    }

    function rms(frame) {
      let sum = 0;
      for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
      return Math.sqrt(sum / frame.length);
    }

    function float32ToPcm16(samples) {
      const out = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        out[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
      }
      return out;
    }

    function pcm16ToWav(pcm) {
      const bytes = new Uint8Array(44 + pcm.length * 2);
      const view = new DataView(bytes.buffer);
      const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i); };
      text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE');
      text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
      for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, pcm[i], true);
      return bytes;
    }

    function bytesToBase64(bytes) {
      let text = '';
      const CHUNK = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        text += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
      }
      return btoa(text);
    }

    /** Keep successive partial transcripts of one growing buffer; snapshots may revise. */
    function reconcilePartial(previous, next) {
      if (!next) return previous || '';
      if (!previous) return next;
      if (next === previous || next.startsWith(previous)) return next;
      if (previous.startsWith(next)) return previous;
      return next;
    }

    function debugNote(step, detail) {
      const debug = (typeof window !== 'undefined')
        ? (window.__realtimeVoiceDebug = window.__realtimeVoiceDebug || { steps: [], error: null })
        : { steps: [], error: null };
      const line = detail === undefined ? step : step + ' ' + (() => {
        try { return JSON.stringify(detail); } catch (_) { return String(detail); }
      })();
      debug.steps.push(line);
      if (debug.steps.length > 120) debug.steps.shift();
      try { console.info('[realtime-voice]', line); } catch (_) {}
    }

    // --------------------------------------------------------------- settings
    const DEFAULT_SETTINGS = {
      version: 2,
      enabled: true,
      micDeviceId: '',
      language: 'auto',
      mode: 'dictate',
      targetLanguage: 'en',
      polish: true,
      filler: true,
      repeats: true,
      corrections: true,
      punctuation: true,
      spokenCommands: true,
      sounds: true,
      partialPreview: true,
      dictionary: [],
      translateFallback: 'source',
      onlineTranslate: true,
      cadenceMs: 700,
      contextMode: 'pair',
      flushMs: 1400,
    };

    const LANGUAGES = [
      { id: 'auto', label: '自动 / Auto' },
      { id: 'zh', label: '中文' },
      { id: 'en', label: 'English' },
      { id: 'ja', label: '日本語' },
      { id: 'ko', label: '한국어' },
      { id: 'yue', label: '粤语' },
    ];

    const TARGET_LANGUAGES = [
      { id: 'en', label: 'English' },
      { id: 'zh', label: '中文' },
      { id: 'ja', label: '日本語' },
      { id: 'ko', label: '한국어' },
      { id: 'fr', label: 'Français' },
      { id: 'de', label: 'Deutsch' },
      { id: 'es', label: 'Español' },
    ];

    /** Normalize anything read back from disk into a complete, valid settings object. */
    function normalizeSettings(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const out = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (source[key] === undefined) continue;
        const fallback = DEFAULT_SETTINGS[key];
        if (typeof fallback === 'boolean') out[key] = source[key] !== false && source[key] !== 'false';
        else if (typeof fallback === 'number') {
          const value = Number(source[key]);
          out[key] = Number.isFinite(value) ? Math.min(4000, Math.max(200, value)) : fallback;
        } else if (Array.isArray(fallback)) out[key] = Array.isArray(source[key]) ? source[key].slice() : fallback;
        else out[key] = String(source[key]);
      }
      out.mode = out.mode === 'translate' ? 'translate' : 'dictate';
      out.translateFallback = out.translateFallback === 'block' ? 'block' : 'source';
      out.contextMode = out.contextMode === 'off' ? 'off' : 'pair';
      if (typeof out.dictionary === 'string') out.dictionary = parseDictionary(out.dictionary);
      out.dictionary = (out.dictionary || []).filter((entry) => entry && typeof entry.from === 'string' && entry.from.length > 0);
      return out;
    }

    function parseDictionary(text) {
      const rows = String(text || '').split('\n');
      const out = [];
      for (const row of rows) {
        const line = row.trim();
        if (!line || line.startsWith('#')) continue;
        const at = line.indexOf('=');
        if (at <= 0) continue;
        const from = line.slice(0, at).trim();
        const to = line.slice(at + 1).trim();
        if (from) out.push({ from, to });
      }
      return out;
    }

    function formatDictionary(entries) {
      return (entries || []).map((entry) => entry.from + '=' + entry.to).join('\n');
    }

    function createSettingsStore(initial) {
      let state = normalizeSettings(initial);
      const listeners = new Set();
      return {
        get: () => state,
        patch(patch) {
          state = normalizeSettings({ ...state, ...patch });
          for (const listener of listeners) listener(state);
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
          } catch (_storageError) { /* private mode */ }
          return state;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      };
    }

    function loadSettings() {
      try {
        if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
        const text = localStorage.getItem(SETTINGS_KEY);
        if (!text) return DEFAULT_SETTINGS;
        return normalizeSettings(JSON.parse(text));
      } catch (_readError) { return DEFAULT_SETTINGS; }
    }

    // --------------------------------------------------------- text pipeline
    // Every function here is pure: (text, options) -> text. The engine composes
    // them, tests call them directly through `__test`.

    const FILLER_ZH = /(?:^|[，。！？、,.!?\s])(?:嗯+|呃+|额+|啊+|哦+|唉+|诶+|那个+|就是说)(?=[，。！？、,.!?\s]|$)/g;
    const FILLER_EN = /\b(?:um+|uh+|er+|ah+|hmm+|you know|i mean)\b[,，]?\s*/gi;

    function stripFillers(text) {
      let out = String(text || '');
      out = out.replace(FILLER_ZH, (match) => (/^[，。！？、,.!?\s]/.test(match) ? match[0] : ''));
      out = out.replace(FILLER_EN, '');
      out = out.replace(/([，,])\s*\1+/g, '$1');
      out = out.replace(/^[，,、\s]+/, '');
      return out;
    }

    /** Collapse immediately repeated characters (zh) and words (latin). */
    function collapseRepeats(text) {
      let out = String(text || '');
      out = out.replace(/([\u4e00-\u9fff]{1,3})\1+/g, '$1');
      out = out.replace(/\b([A-Za-z]+)(?:\s+\1\b)+/gi, '$1');
      return out;
    }

    /**
     * Self-correction: "不对，我是说 X" / "no wait, X" keeps the final intent.
     * Only the segment after the marker survives; text before it is dropped.
     */
    function resolveSelfCorrections(text) {
      const source = String(text || '');
      const pattern = /(?:不对|不是|说错了|我重说|重来)[，,]?\s*(?:我是说|就是说|应该是|而是)?\s*/g;
      let lastIndex = -1;
      let lastEnd = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) { lastIndex = match.index; lastEnd = match.index + match[0].length; }
      if (lastIndex < 0) {
        const english = /\b(?:no wait|i mean|sorry,? i meant|rather)\b[,，]?\s*/gi;
        while ((match = english.exec(source)) !== null) { lastIndex = match.index; lastEnd = match.index + match[0].length; }
        if (lastIndex < 0) return source;
      }
      const tail = source.slice(lastEnd).trim();
      if (!tail) return source;
      // Keep the sentence that preceded the correction only when it is a different clause.
      const head = source.slice(0, lastIndex).replace(/[，,、\s]+$/, '');
      return head && /[。！？.!?]$/.test(head) ? head + tail : tail;
    }

    const SPELLED_PUNCT = [
      [/换行|new line|newline/gi, '\n'],
      [/另起一段|新段落|new paragraph/gi, '\n\n'],
      [/逗号|comma/gi, '，'],
      [/句号|period|full stop/gi, '。'],
      [/问号|question mark/gi, '？'],
      [/感叹号|exclamation mark/gi, '！'],
      [/冒号|colon/gi, '：'],
      [/分号|semicolon/gi, '；'],
      [/顿号/gi, '、'],
    ];

    function applySpokenCommands(text) {
      let out = String(text || '');
      for (const [pattern, replacement] of SPELLED_PUNCT) out = out.replace(pattern, replacement);
      out = out.replace(/列表|以下三点|bullet list/gi, '\n- ');
      return out;
    }

    const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

    function isCjkText(text) {
      const sample = String(text || '');
      if (!sample) return false;
      const cjk = (sample.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
      return cjk > 0 && cjk / Math.max(1, sample.replace(/\s/g, '').length) >= 0.2;
    }

    function fixPunctuation(text) {
      let out = String(text || '').replace(/\s+/g, ' ').trim();
      if (!out) return out;
      const cjk = isCjkText(out);
      // Collapse duplicated punctuation and stray latin commas in CJK runs.
      out = out.replace(/([，。！？、：；,])[，。！？、：；,]+/g, '$1');
      if (cjk) {
        out = out.replace(/([。！？])\s+/g, '$1');
        out = out.replace(/,/g, '，').replace(/;/g, '；').replace(/:/g, '：').replace(/\?/g, '？').replace(/!/g, '！');
        out = out.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
        if (!/[。！？…]$/.test(out)) out += '。';
      } else {
        out = out.replace(/([.!?])\s+/g, '$1 ');
        if (!/[.!?…]$/.test(out)) out += '.';
        out = out.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix, letter) => prefix + letter.toUpperCase());
        out = out.replace(/\bi\b/g, 'I');
      }
      return out;
    }

    function applyDictionary(text, entries) {
      let out = String(text || '');
      for (const entry of entries || []) {
        if (!entry || !entry.from) continue;
        const escaped = entry.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped, 'gi'), entry.to);
      }
      return out;
    }

    /**
     * Compose the local post-processing stage.
     * @returns {{ text: string, notes: string[] }} normalized text plus applied stage names.
     */
    function polish(text, options) {
      const settings = normalizeSettings(options);
      let value = String(text || '').trim();
      const notes = [];
      if (!value) return { text: '', notes };
      if (settings.spokenCommands) { const next = applySpokenCommands(value); if (next !== value) { notes.push('commands'); value = next; } }
      if (settings.filler) { const next = stripFillers(value); if (next !== value) { notes.push('filler'); value = next; } }
      if (settings.repeats) { const next = collapseRepeats(value); if (next !== value) { notes.push('repeats'); value = next; } }
      if (settings.corrections) { const next = resolveSelfCorrections(value); if (next !== value) { notes.push('corrections'); value = next; } }
      value = applyDictionary(value, settings.dictionary);
      if (settings.punctuation) { const next = fixPunctuation(value); if (next !== value) { notes.push('punctuation'); value = next; } }
      return { text: value.trim(), notes };
    }

    // ---------------------------------------------------------- context merge
    const TERMINAL = '。！？!?…';
    const SOFT = '，,、；;：:';
    const CORRECTION_LEAD = /^(?:不对|不是|不，|不,|呃不|哦不|我是说|我意思是|我的意思是|更正|纠正|应该是|确切地说)[，,、。：:\s]*/;
    const CHAR_LIMIT = '\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af';

    /** True when the seam between two segments should take a space. */
    function seamNeedsSpace(left, right) {
      const a = left[left.length - 1] || '';
      const b = right[0] || '';
      if (!a || !b) return false;
      if (new RegExp('[' + CHAR_LIMIT + ']').test(a) || new RegExp('[' + CHAR_LIMIT + ']').test(b)) return false;
      if (SOFT.includes(a) || TERMINAL.includes(a) || a === '.') return true;
      return /[A-Za-z0-9)\]"'”’]/.test(a) && /[A-Za-z0-9(\["'“‘]/.test(b);
    }

    /**
     * Merge a fresh segment into the one before it, so the correction sees two
     * utterances instead of one. Recognition is the weakest link, and most of
     * its failures are seam-shaped: the tail of one segment is repeated at the
     * head of the next, a self-correction straddles the pause ("…周三" / "不对
     * 是周四"), or the pause lands mid-sentence and the next segment restarts it
     * with a capital and a dangling punctuation mark.
     * @param {string} previous - the segment finalized just before this one.
     * @param {string} next - the segment about to be inserted.
     * @param {object} [options] - normalized settings (uses `corrections`).
     * @returns {{ text: string, notes: string[] }} merged text plus applied rules.
     */
    function mergeSegments(previous, next, options) {
      const settings = normalizeSettings(options);
      const notes = [];
      const head = String(previous || '').trim();
      let tail = String(next || '').trim();
      if (!head) return { text: tail, notes };
      if (!tail) return { text: head, notes };

      // 1. A correction that opens the new segment retires both the marker and
      //    the clause it supersedes: "会议定在周三" + "不对，是周四" → "会议定在周四".
      let corrected = head;
      if (settings.corrections !== false && CORRECTION_LEAD.test(tail)) {
        tail = tail.replace(CORRECTION_LEAD, '');
        tail = tail.replace(/^(?:是|改成|改为|换成|换为)[，,、\s]*/, '');
        const cut = Math.max(corrected.lastIndexOf('，'), corrected.lastIndexOf(','), corrected.lastIndexOf('、'),
          corrected.lastIndexOf('。'), corrected.lastIndexOf('；'), corrected.lastIndexOf(';'), corrected.lastIndexOf(' '));
        if (cut > 0) corrected = corrected.slice(0, cut);
        // No delimiter to anchor on ("会议定在周三"): a short replacement is
        // nearly always a noun/numeral swap, so retire the last two characters
        // ("周三" → "周四") instead of stacking both. Longer replacements are
        // left alone: dropping more than that guesses at the speaker's grammar.
        else if (tail.length <= 8) corrected = corrected.slice(0, Math.max(0, corrected.length - 2));
        notes.push('cross-correction');
      }

      // 2. Overlap at the seam. The recognizer often re-emits the tail of the
      //    previous segment as the head of the next; keep one copy.
      const maxOverlap = Math.min(24, corrected.length, tail.length);
      for (let size = maxOverlap; size >= 3; size -= 1) {
        if (corrected.slice(corrected.length - size) === tail.slice(0, size)) {
          tail = tail.slice(size).replace(/^[\s，,、；;]+/, '');
          notes.push('seam-overlap');
          break;
        }
      }

      // 3. A segment that begins mid-sentence must not restart the sentence.
      if (tail && !TERMINAL.includes(corrected[corrected.length - 1]) && corrected[corrected.length - 1] !== '.'
        && /^[A-Z][a-z]/.test(tail) && seamNeedsSpace(corrected, tail)) {
        tail = tail[0].toLowerCase() + tail.slice(1);
        notes.push('seam-case');
      }

      // 4. Do not stack punctuation at the seam ("…，" + "，下一句").
      if (tail && (SOFT.includes(tail[0]) || TERMINAL.includes(tail[0]))
        && (SOFT.includes(corrected[corrected.length - 1]) || TERMINAL.includes(corrected[corrected.length - 1]))) {
        tail = tail.replace(/^[\s，,、；;：:。！？!?…]+/, '');
        notes.push('seam-punctuation');
      }

      if (!tail) return { text: corrected, notes };
      return { text: corrected + (seamNeedsSpace(corrected, tail) ? ' ' : '') + tail, notes };
    }

    // ------------------------------------------------------------ host bridge
    /** Local (host-side) refinement: polish with a model or translate. Degrades to offline. */
    function createHostBridge() {
      let capabilities = null;
      let probing = null;

      async function fetchJson(path, init, timeoutMs) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const response = await fetch(path, {
            ...init,
            ...(controller ? { signal: controller.signal } : {}),
          });
          const text = await response.text();
          let body = null;
          try { body = text ? JSON.parse(text) : null; } catch (_parseError) { body = { ok: false, code: 'invalid', message: text.slice(0, 200) }; }
          return { status: response.status, body };
        } finally {
          if (timer !== null) clearTimeout(timer);
        }
      }

      // Capabilities expire: the host half may be installed or reloaded while
      // the page stays open. A missing route is retried soon, a working one later.
      const RETRY_MISS_MS = 15000;
      const RETRY_HIT_MS = 300000;
      let probedAt = 0;
      return {
        get capabilities() { return capabilities; },
        forget() { capabilities = null; probedAt = 0; },
        async probe() {
          const ttl = capabilities && capabilities.reason ? RETRY_MISS_MS : RETRY_HIT_MS;
          if (capabilities && Date.now() - probedAt < ttl) return capabilities;
          if (probing) return probing;
          probing = (async () => {
            try {
              const { status, body } = await fetchJson(HEALTH_PATH, { method: 'GET', headers: { accept: 'application/json' } }, 2500);
              capabilities = status === 200 && body && body.ok === true
                ? { translate: !!(body.capabilities && body.capabilities.translate), cleanup: !!(body.capabilities && body.capabilities.cleanup), providers: (body.capabilities && body.capabilities.providers) || [] }
                : { translate: false, cleanup: false, providers: [], reason: 'http-' + status };
            } catch (error) {
              capabilities = { translate: false, cleanup: false, providers: [], reason: (error && error.message) || String(error) };
            } finally {
              probing = null;
            }
            probedAt = Date.now();
            debugNote('host:probe', capabilities);
            return capabilities;
          })();
          return probing;
        },
        async refine(request) {
          const { status, body } = await fetchJson(REFINE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(request),
          }, 25000);
          if (status === 200 && body && body.ok === true) return { ok: true, text: String(body.text || ''), provider: body.provider || 'host' };
          return { ok: false, code: (body && body.code) || 'http-' + status, message: (body && body.message) || 'refine failed' };
        },
      };
    }

    // ------------------------------------------------------------------- VAD
    /**
     * Energy VAD with pre-roll, pause endpointing and a calibration window.
     * The first ~250 ms only estimates the noise floor, so a loud room cannot
     * open a segment before the device level is known.
     */
    function createVad(config) {
      const preRollFrames = Math.max(1, Math.round(config.preRollMs / FRAME_MS));
      const CALIBRATION_MS = 250;
      const noiseWindow = [];
      let pre = [];
      let segment = [];
      let voicedMs = 0;
      let silentMs = 0;
      let segmentMs = 0;
      let active = false;
      let elapsedMs = 0;
      let threshold = config.threshold;

      function calibrate(level) {
        noiseWindow.push(level);
        while (noiseWindow.length > 25) noiseWindow.shift();
        if (noiseWindow.length < 8) return;
        const sorted = noiseWindow.slice().sort((a, b) => a - b);
        const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
        threshold = Math.min(0.03, Math.max(0.006, p90 * 3));
      }

      function take() {
        const samples = concatFloat(segment);
        pre = []; segment = []; voicedMs = 0; silentMs = 0; segmentMs = 0; active = false;
        noiseWindow.length = 0;
        threshold = config.threshold;
        return samples;
      }

      return {
        get active() { return active; },
        current() { return concatFloat(segment); },
        reset() {
          pre = []; segment = []; voicedMs = 0; silentMs = 0; segmentMs = 0; active = false;
          elapsedMs = 0; noiseWindow.length = 0; threshold = config.threshold;
        },
        push(frame) {
          const copy = frame.slice();
          const level = rms(copy);
          if (!active && elapsedMs < CALIBRATION_MS) {
            elapsedMs += FRAME_MS;
            calibrate(level);
            pre.push(copy);
            while (pre.length > preRollFrames) pre.shift();
            return { level, calibrating: true };
          }
          const voiced = level >= threshold;
          if (!active) {
            elapsedMs += FRAME_MS;
            pre.push(copy);
            while (pre.length > preRollFrames) pre.shift();
            voicedMs = voiced ? voicedMs + FRAME_MS : 0;
            if (voicedMs >= config.minSpeechMs) {
              active = true;
              segment = pre.slice();
              pre = [];
              segmentMs = segment.length * FRAME_MS;
              silentMs = 0;
              return { level, started: true };
            }
            if (!voiced) calibrate(level);
            return { level };
          }
          segment.push(copy);
          segmentMs += FRAME_MS;
          silentMs = voiced ? 0 : silentMs + FRAME_MS;
          if (silentMs >= config.minSilenceMs) return { level, segment: take(), reason: 'pause' };
          if (segmentMs >= config.maxSegmentMs) return { level, segment: take(), reason: 'limit' };
          return { level };
        },
      };
    }

    // ----------------------------------------------------------------- state
    /** One observable store per input surface (`composer`, or a third-party surface id). */
    function createStore() {
      let state = {
        phase: 'idle', partial: '', level: 0, error: '', pending: '', segmentActive: false, busyText: '',
        lastInserted: '', translated: false, warning: '', seconds: 0, waiting: false,
      };
      const listeners = new Set();
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        set(patch) {
          const next = { ...state, ...patch };
          let changed = false;
          for (const key of Object.keys(patch)) if (next[key] !== state[key]) changed = true;
          if (!changed) return;
          state = next;
          for (const listener of listeners) listener();
        },
      };
    }

    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    function createRuntime() {
      return {
        dict: zh,
        speech: null,
        settings: null,
        bridge: null,
        composerActions: null,
        surfaces: new Map(),
        stores: new Map(),
        engines: new Map(),
        audioContext: null,
      };
    }

    let runtime = createRuntime();

    function fallbackTranslate(key, vars) {
      const dict = runtime && runtime.dict;
      if (!dict) return key;
      const text = dict[key] === undefined ? key : dict[key];
      if (!vars) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
    }

    function settingsStore() {
      if (!runtime.settings) runtime.settings = createSettingsStore(loadSettings());
      return runtime.settings;
    }

    function storeFor(surfaceId) {
      let store = runtime.stores.get(surfaceId);
      if (!store) { store = createStore(); runtime.stores.set(surfaceId, store); }
      return store;
    }

    // ---------------------------------------------------------------- engine
    function createEngine(surfaceId) {
      const store = storeFor(surfaceId);
      const vadConfig = {
        threshold: 0.01,
        minSpeechMs: 120,
        minSilenceMs: 600,
        preRollMs: 300,
        maxSegmentMs: 15000,
      };
      const partialWindowMs = 12000;
      const slowCadenceMs = 1200;

      let media = null;
      let audioContext = null;
      let source = null;
      let processor = null;
      let sink = null;
      let vad = null;
      let ticker = null;
      let leftover = new Float32Array(0);
      let frameScratch = new Float32Array(FRAME);
      let generation = 0;
      let inFlight = false;
      let held = null;
      let heldTimer = null;
      let lastCallAt = 0;
      let lastPartial = '';
      let previousInsert = '';
      let span = null;
      let levelFrames = 0;
      let callController = null;
      let selection = null;
      let running = false;
      let startedAt = 0;
      let clock = null;

      const surface = () => runtime.surfaces.get(surfaceId) || null;

      function actions() {
        const current = surface();
        if (current && current.actions) return current.actions;
        // Only the composer may borrow the slot-provided actions. A foreign
        // surface that has not attached yet must fail its insert and fall back
        // to `pending`, never write into somebody else's field.
        return surfaceId === 'composer' ? runtime.composerActions : null;
      }

      function translate(key, vars) { return fallbackTranslate(key, vars); }

      function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error((label || 'call') + ' timed out after ' + ms + ' ms'));
          }, ms);
          Promise.resolve(promise).then((value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); resolve(value);
          }, (error) => {
            if (settled) return;
            settled = true; clearTimeout(timer); reject(error);
          });
        });
      }

      function reportError(message) {
        store.set({ phase: 'error', error: message, partial: '', level: 0, busyText: '', segmentActive: false });
      }

      function playEarcon(kind) {
        const settings = settingsStore().get();
        if (!settings.sounds) return;
        try {
          if (!runtime.audioContext) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return;
            runtime.audioContext = new Ctor();
          }
          const ctx = runtime.audioContext;
          if (ctx.state === 'suspended') void ctx.resume();
          const now = ctx.currentTime;
          const tones = kind === 'start' ? [[880, 0], [1320, 0.07]] : [[660, 0], [440, 0.08]];
          for (const [freq, offset] of tones) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.06, now + offset + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.09);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(now + offset); osc.stop(now + offset + 0.11);
          }
        } catch (_audioError) { /* earcons are optional */ }
      }

      async function transcribe(samples) {
        const wav = pcm16ToWav(float32ToPcm16(samples));
        const request = { audioBase64: bytesToBase64(wav) };
        const settings = settingsStore().get();
        const providerId = selection && selection.providerId;
        if (providerId) request.providerId = providerId;
        const language = settings.language !== 'auto' ? settings.language : (selection && selection.language);
        if (language) request.language = language;
        const signal = callController ? callController.signal : undefined;
        const service = runtime.speech;
        if (!service || typeof service.transcribe !== 'function') {
          return { ok: false, error: { code: 'not-mounted', message: translate('notReady') } };
        }
        return await service.transcribe(request, signal);
      }

      function insert(text) {
        if (!text) return true;
        const api = actions();
        if (!api) return false;
        let target = span || api.captureInsertion();
        if (api.insertText(text, target)) { span = api.captureInsertion(); previousInsert = text; return true; }
        target = api.captureInsertion();
        if (api.insertText(text, target)) { span = api.captureInsertion(); previousInsert = text; return true; }
        return false;
      }

      function withSeparator(text) {
        if (!previousInsert || !text) return text;
        const tail = previousInsert[previousInsert.length - 1];
        const head = text[0];
        if (/[A-Za-z0-9]$/.test(tail) && /^[A-Za-z0-9]/.test(head)) return ' ' + text;
        return text;
      }

      /** Compose the local pipeline and the optional host stage for one recognized segment. */
      async function processSegment(raw) {
        const settings = settingsStore().get();
        const local = settings.polish ? polish(raw, settings) : { text: String(raw || '').trim(), notes: [] };
        let text = local.text;
        if (!text) return { ok: false, reason: 'empty' };
        if (settings.mode !== 'translate') return { ok: true, text, notes: local.notes, translated: false };
        // Translation is the one stage that leaves the machine, so it stays
        // opt-out: with it off the segment is inserted in the spoken language.
        if (settings.onlineTranslate === false) {
          return {
            ok: true, text, notes: local.notes, translated: false,
            warning: translate('translateOffline'),
          };
        }
        const caps = await runtime.bridge.probe();
        if (!caps.translate) {
          return {
            ok: true, text, notes: local.notes, translated: false,
            warning: translate('translateUnavailable'),
          };
        }
        try {
          const result = await runtime.bridge.refine({
            text, mode: 'translate',
            targetLanguage: settings.targetLanguage,
            sourceLanguage: settings.language === 'auto' ? undefined : settings.language,
          });
          if (result.ok && result.text) return { ok: true, text: result.text, notes: local.notes, translated: true, provider: result.provider };
          if (settings.translateFallback === 'block') return { ok: false, reason: 'translate-failed', message: result.message };
          return { ok: true, text, notes: local.notes, translated: false, warning: translate('translateUnavailable') + ' (' + result.code + ')' };
        } catch (error) {
          if (settings.translateFallback === 'block') return { ok: false, reason: 'translate-failed', message: (error && error.message) || String(error) };
          return { ok: true, text, notes: local.notes, translated: false, warning: translate('translateUnavailable') };
        }
      }

      async function finalize(samples, reason) {
        const settings = settingsStore().get();
        const run = ++generation;
        inFlight = false;
        if (vad) vad.reset();
        store.set({ partial: '', segmentActive: false });
        if (!samples || samples.length < SAMPLE_RATE * 0.2) return;
        inFlight = true;
        try {
          const result = await withTimeout(transcribe(samples), 20000, 'speech transcribe');
          if (run !== generation) return;
          if (!result || result.ok !== true) {
            const message = result && result.error ? result.error.message : 'unknown';
            reportError(translate('failed', { message }));
            return;
          }
          const text = (result.value && result.value.text ? result.value.text : '').trim();
          if (!text) { store.set({ partial: '' }); return; }
          const processed = await processSegment(text);
          if (run !== generation) return;
          if (!processed.ok) {
            if (processed.reason === 'empty') { store.set({ partial: '' }); return; }
            reportError(processed.message || translate('failed', { message: processed.reason || 'error' }));
            return;
          }
          const chunk = withSeparator(processed.text);
          if (settings.contextMode === 'pair') {
            // Hold this segment for one beat so the next one can correct it:
            // the recognizer's mistakes are mostly seam-shaped, and only the
            // pair carries the evidence.
            if (held) {
              const previousText = held.text;
              const merged = mergeSegments(previousText, processed.text, settings);
              const mergedText = withSeparator(merged.text);
              clearTimeout(heldTimer);
              held = null; heldTimer = null;
              store.set({ waiting: false });
              debugNote('merge', { notes: merged.notes });
              commit(mergedText, { translated: !!processed.translated, warning: processed.warning || '', reason });
            } else {
              held = { text: processed.text, translated: !!processed.translated, warning: processed.warning || '' };
              const wait = Math.max(400, Number(settings.flushMs) || 1400);
              heldTimer = setTimeout(() => { void flushHeld(); }, wait);
              store.set({ waiting: true, partial: '' });
              if (reason === 'limit') store.set({ phase: 'listening' });
            }
          } else {
            commit(chunk, { translated: !!processed.translated, warning: processed.warning || '', reason });
          }
        } catch (error) {
          if (run === generation) reportError(translate('failed', { message: (error && error.message) || String(error) }));
        } finally {
          if (run === generation) inFlight = false;
        }
      }

      /** Insert one finalized chunk and fold its result into the panel state. */
      function commit(chunk, meta) {
        if (!chunk) return;
        if (insert(chunk)) {
          store.set({
            pending: '', partial: '', lastInserted: chunk,
            translated: !!meta.translated, warning: meta.warning || '',
          });
        } else {
          store.set({ pending: chunk, partial: '', translated: !!meta.translated, warning: '' });
        }
      }

      /** Insert a held segment once the pair never arrived (pause, limit, stop). */
      async function flushHeld() {
        const current = held;
        if (!current) return;
        held = null;
        clearTimeout(heldTimer);
        heldTimer = null;
        store.set({ waiting: false });
        commit(withSeparator(current.text), { translated: !!current.translated, warning: current.warning || '' });
      }

      async function tick() {
        if (!vad || !vad.active || inFlight) return;
        if (store.get().phase !== 'listening') return;
        const settings = settingsStore().get();
        if (!settings.partialPreview) return;
        const now = Date.now();
        const full = vad.current();
        if (full.length < SAMPLE_RATE * 0.45) return;
        const cadence = full.length > SAMPLE_RATE * 8 ? Math.max(slowCadenceMs, settings.cadenceMs) : settings.cadenceMs;
        if (now - lastCallAt < cadence) return;
        const truncated = full.length > SAMPLE_RATE * (partialWindowMs / 1000);
        const samples = truncated ? full.subarray(full.length - SAMPLE_RATE * (partialWindowMs / 1000)) : full;
        lastCallAt = now;
        inFlight = true;
        const run = ++generation;
        try {
          const result = await withTimeout(transcribe(samples), 20000, 'speech transcribe');
          if (run !== generation) return;
          if (!result || result.ok !== true) {
            const message = result && result.error ? result.error.message : 'unknown';
            reportError(translate('failed', { message }));
            return;
          }
          const text = (result.value && result.value.text ? result.value.text : '').trim();
          lastPartial = reconcilePartial(truncated ? '' : lastPartial, text);
          const preview = settings.polish && lastPartial ? polish(lastPartial, settings).text : lastPartial;
          store.set({ partial: truncated && preview ? '…' + preview : preview });
        } catch (error) {
          if (run === generation) reportError(translate('failed', { message: (error && error.message) || String(error) }));
        } finally {
          if (run === generation) inFlight = false;
        }
      }

      function onFrame(frame) {
        if (!vad) return;
        const outcome = vad.push(frame);
        levelFrames += 1;
        if (levelFrames % 3 === 0) store.set({ level: Math.min(1, outcome.level * 9) });
        if (outcome.started) {
          lastPartial = '';
          store.set({ segmentActive: true, partial: '' });
        }
        if (outcome.segment) void finalize(outcome.segment, outcome.reason);
      }

      function feed(samples) {
        let data = samples;
        if (leftover.length) {
          const merged = new Float32Array(leftover.length + data.length);
          merged.set(leftover, 0); merged.set(data, leftover.length);
          data = merged;
        }
        let offset = 0;
        while (data.length - offset >= FRAME) {
          frameScratch.set(data.subarray(offset, offset + FRAME));
          offset += FRAME;
          onFrame(frameScratch);
        }
        leftover = data.subarray(offset).slice();
      }

      function resampleTo16k(input, sourceRate) {
        if (sourceRate === SAMPLE_RATE) return input;
        const ratio = sourceRate / SAMPLE_RATE;
        const length = Math.max(1, Math.floor(input.length / ratio));
        const out = new Float32Array(length);
        for (let i = 0; i < length; i += 1) {
          const position = i * ratio;
          const base = Math.floor(position);
          const fraction = position - base;
          const a = input[base] || 0;
          const b = input[base + 1] || a;
          out[i] = a + (b - a) * fraction;
        }
        return out;
      }

      async function release() {
        if (ticker !== null) { clearInterval(ticker); ticker = null; }
        if (clock !== null) { clearInterval(clock); clock = null; }
        if (processor) { try { processor.disconnect(); } catch (_) {} processor.onaudioprocess = null; processor = null; }
        if (source) { try { source.disconnect(); } catch (_) {} source = null; }
        if (sink) { try { sink.disconnect(); } catch (_) {} sink = null; }
        if (audioContext) { try { await audioContext.close(); } catch (_) {} audioContext = null; }
        if (media) { for (const track of media.getTracks()) { try { track.stop(); } catch (_) {} } media = null; }
        vad = null;
        leftover = new Float32Array(0);
      }

      async function ensureModel() {
        const speech = runtime.speech;
        if (!speech) return { ok: false, message: translate('notReady') };
        let catalog = await withTimeout(speech.catalog(), 6000, 'speech catalog');
        const summary = () => (catalog && catalog.ok === true
          ? ((catalog.value && catalog.value.providers) || []).map((p) => p.id + ':' + ((p.preparation && p.preparation.phase) || '?')).join(',')
          : (catalog && catalog.error && catalog.error.message) || 'unknown');
        if (!catalog || catalog.ok !== true) {
          const message = catalog && catalog.error ? catalog.error.message : 'unknown';
          return { ok: false, message: translate('failed', { message }) };
        }
        const phaseOf = (provider) => (provider.preparation && provider.preparation.phase) || '?';
        const isReady = () => ((catalog.value && catalog.value.providers) || [])
          .some((provider) => phaseOf(provider) === 'ready' || phaseOf(provider) === 'standby');
        if (!isReady() && ((catalog.value && catalog.value.providers) || []).length > 0) {
          const target = catalog.value.providers[0];
          store.set({ busyText: translate('preparing') });
          try { await withTimeout(speech.prepare(target.id), 15000, 'speech prepare'); } catch (error) { debugNote('prepare:error', (error && error.message) || String(error)); }
          for (let attempt = 0; attempt < 120 && running; attempt += 1) {
            if (isReady()) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
            const next = await withTimeout(speech.catalog(), 6000, 'speech catalog').catch(() => null);
            if (next && next.ok === true) catalog = next;
          }
          store.set({ busyText: '' });
        }
        if (!isReady()) return { ok: false, message: translate('notReady') + ' [' + summary() + ']' };
        selection = (catalog.value && catalog.value.selection) || null;
        return { ok: true };
      }

      async function start() {
        debugNote('start', store.get().phase);
        if (running) return { ok: true, alreadyRunning: true };
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof window.AudioContext === 'undefined') {
          const message = translate('unavailable');
          reportError(message);
          return { ok: false, message };
        }
        running = true;
        clearTimeout(heldTimer);
        heldTimer = null;
        held = null;
        store.set({ phase: 'starting', error: '', partial: '', pending: '', level: 0, warning: '', lastInserted: '', translated: false, waiting: false });
        try {
          const ready = await ensureModel();
          if (!ready.ok) { reportError(ready.message); return { ok: false, message: ready.message }; }
          if (!running) return { ok: false, message: 'cancelled' };
          callController = new AbortController();
          const settings = settingsStore().get();
          const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
          if (settings.micDeviceId) audio.deviceId = { exact: settings.micDeviceId };
          media = await navigator.mediaDevices.getUserMedia({ audio, video: false });
          if (!running) return { ok: false, message: 'cancelled' };
          try {
            audioContext = new window.AudioContext({ sampleRate: SAMPLE_RATE });
          } catch (_unsupportedRate) {
            audioContext = new window.AudioContext();
          }
          source = audioContext.createMediaStreamSource(media);
          processor = audioContext.createScriptProcessor(1024, 1, 1);
          sink = audioContext.createGain();
          sink.gain.value = 0;
          processor.onaudioprocess = (event) => {
            if (store.get().phase !== 'listening') return;
            const channel = event.inputBuffer.getChannelData(0);
            feed(resampleTo16k(channel, audioContext.sampleRate));
          };
          source.connect(processor);
          processor.connect(sink);
          sink.connect(audioContext.destination);
          await audioContext.resume();
          const track = media.getAudioTracks()[0];
          if (track && typeof track.addEventListener === 'function') {
            track.addEventListener('ended', () => { void stop(); });
          }
          debugNote('audio', { sampleRate: audioContext.sampleRate, state: audioContext.state });
          vad = createVad(vadConfig);
          leftover = new Float32Array(0);
          lastPartial = '';
          lastCallAt = 0;
          startedAt = Date.now();
          const api = actions();
          span = api ? api.captureInsertion() : null;
          previousInsert = '';
          store.set({ phase: 'listening', error: '', partial: '', pending: '', segmentActive: false, seconds: 0 });
          playEarcon('start');
          ticker = setInterval(() => { void tick(); }, 120);
          clock = setInterval(() => { store.set({ seconds: Math.round((Date.now() - startedAt) / 1000) }); }, 1000);
          debugNote('listening');
          return { ok: true };
        } catch (error) {
          const name = error && error.name;
          const message = name === 'NotAllowedError'
            ? translate('permissionDenied')
            : translate('failed', { message: (error && error.message) || String(error) });
          reportError(message);
          return { ok: false, message };
        } finally {
          // Any failure path must drop the microphone, otherwise the next start() no-ops.
          if (store.get().phase !== 'listening') {
            running = false;
            await release();
            if (callController) { try { callController.abort(); } catch (_) {} callController = null; }
          }
        }
      }

      /** Stop the microphone, committing anything the user already said. */
      async function stop() {
        if (!running) {
          store.set({ phase: 'idle', partial: '', level: 0, segmentActive: false, busyText: '', seconds: 0 });
          return;
        }
        running = false;
        const pendingSamples = vad ? vad.current() : null;
        store.set({ phase: 'starting', segmentActive: false, level: 0, busyText: '' });
        await release();
        playEarcon('stop');
        if (pendingSamples && pendingSamples.length > SAMPLE_RATE * 0.2) {
          await finalize(pendingSamples, 'stop');
        }
        await flushHeld();
        if (callController) { try { callController.abort(); } catch (_) {} callController = null; }
        const state = store.get();
        store.set({
          phase: state.phase === 'error' ? 'error' : 'idle',
          partial: '', level: 0, segmentActive: false, busyText: '', seconds: 0,
        });
      }

      return {
        store,
        surfaceId,
        isRunning: () => running,
        async toggle() {
          try {
            const phase = store.get().phase;
            if (phase === 'listening' || phase === 'starting') { await stop(); return { ok: true, phase: 'idle' }; }
            return await start();
          } catch (error) {
            debugNote('toggle:error', (error && error.stack) || String(error));
            const message = translate('failed', { message: (error && error.message) || String(error) });
            reportError(message);
            return { ok: false, message };
          }
        },
        async start() {
          try { return await start(); } catch (error) {
            const message = translate('failed', { message: (error && error.message) || String(error) });
            reportError(message);
            return { ok: false, message };
          }
        },
        async stop() { try { await stop(); } catch (_stopError) { /* already stopped */ } },
        async insertPending() {
          const pending = store.get().pending;
          if (!pending) return;
          if (insert(pending)) store.set({ pending: '', lastInserted: pending });
        },
        undoLast() {
          const api = actions();
          const last = store.get().lastInserted;
          if (!api || !last) return false;
          if (typeof api.replaceText === 'function' && span) {
            if (api.replaceText('', span)) { store.set({ lastInserted: '' }); return true; }
          }
          return false;
        },
        async dispose() { await stop(); },
      };
    }

    function engineFor(surfaceId) {
      let engine = runtime.engines.get(surfaceId);
      if (!engine) {
        engine = createEngine(surfaceId);
        runtime.engines.set(surfaceId, engine);
      }
      return engine;
    }

    // ------------------------------------------------------------- public API
    /**
     * `voiceInput` is the integration seam for other input surfaces. Any plugin
     * that owns a text field can attach it and get the same dictation pipeline:
     *
     *   const handle = ctx.voiceInput.attach({
     *     id: 'my-field',
     *     insertText: (text, target) => true,
     *     captureInsertion: () => token,
     *   })
     *   await handle.start()
     */
    function createVoiceInputApi() {
      const listeners = new Set();
      function emit(event) {
        for (const listener of listeners) {
          try { listener(event); } catch (_listenerError) { /* isolated */ }
        }
      }
      function attach(surface) {
        if (!surface || typeof surface.id !== 'string' || !surface.id) throw new Error('voiceInput.attach: id is required');
        const record = {
          id: surface.id,
          label: surface.label || surface.id,
          actions: {
            insertText: typeof surface.insertText === 'function' ? surface.insertText : () => false,
            captureInsertion: typeof surface.captureInsertion === 'function' ? surface.captureInsertion : () => null,
            replaceText: typeof surface.replaceText === 'function' ? surface.replaceText : undefined,
          },
          onState: typeof surface.onState === 'function' ? surface.onState : null,
        };
        runtime.surfaces.set(record.id, record);
        const store = storeFor(record.id);
        const unsubscribe = record.onState ? store.subscribe(() => record.onState(store.get())) : () => {};
        const engine = engineFor(record.id);
        emit({ type: 'attach', surfaceId: record.id });
        return {
          id: record.id,
          store,
          start: () => engine.start(),
          stop: () => engine.stop(),
          toggle: () => engine.toggle(),
          insertPending: () => engine.insertPending(),
          detach() {
            unsubscribe();
            runtime.surfaces.delete(record.id);
            void engine.dispose();
            emit({ type: 'detach', surfaceId: record.id });
          },
        };
      }
      return {
        version: VERSION,
        attach,
        surfaces: () => [...runtime.surfaces.keys()],
        settings: {
          get: () => settingsStore().get(),
          patch: (patch) => settingsStore().patch(patch),
          subscribe: (listener) => settingsStore().subscribe(listener),
        },
        state: (surfaceId) => storeFor(surfaceId || 'composer').get(),
        open: (surfaceId) => engineFor(surfaceId || 'composer').start(),
        close: (surfaceId) => engineFor(surfaceId || 'composer').stop(),
        toggle: (surfaceId) => engineFor(surfaceId || 'composer').toggle(),
        on: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      };
    }

    // ------------------------------------------------------------- components
    const MIC_ICON = h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      h('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }),
      h('path', { d: 'M5 11a7 7 0 0 0 14 0' }),
      h('path', { d: 'M12 18v3' }),
      h('path', { d: 'M8.5 21h7' }));

    const STOP_ICON = h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': 'true' },
      h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 }));

    const GEAR_ICON = h('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
      h('circle', { cx: 12, cy: 12, r: 3 }),
      h('path', { d: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4' }));

    function useSettings() {
      const store = settingsStore();
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    function useTranslator(props) {
      return typeof props.t === 'function' ? props.t : fallbackTranslate;
    }

    function SurfaceActions(props) {
      // Every slot that owns an input hands us insertion actions; remember them so
      // the mic (which may live in a different slot) can insert into that input.
      const actions = props.inputActions || props.actions;
      React.useEffect(() => {
        if (!actions) return;
        runtime.composerActions = actions;
        engineFor('composer');
        const existing = runtime.surfaces.get('composer');
        runtime.surfaces.set('composer', {
          id: 'composer',
          label: 'composer',
          actions: {
            insertText: actions.insertText,
            captureInsertion: actions.captureInsertion,
            replaceText: actions.replaceText,
          },
          onState: existing ? existing.onState : null,
        });
      }, [actions]);
      return null;
    }

    function MicButton(props) {
      const { sessionId } = props;
      const translate = useTranslator(props);
      const store = storeFor('composer');
      const state = useStore(store);
      const engineRef = React.useRef(null);
      engineRef.current = engineFor('composer');
      const settings = useSettings();
      React.useEffect(() => {
        const engine = engineRef.current;
        return () => { void engine.stop(); };
      }, []);
      if (!settings.enabled) return null;
      const active = state.phase === 'listening' || state.phase === 'starting';
      const label = active ? translate('stop') : translate('open');
      return h(React.Fragment, null,
        h(SurfaceActions, { key: 'surface', inputActions: props.inputActions || props.actions }),
        h('button', {
          key: 'mic',
          type: 'button',
          className: 'rv-mic',
          'data-active': active ? 'true' : 'false',
          'data-phase': state.phase,
          'aria-label': label,
          'aria-pressed': active ? 'true' : 'false',
          title: label + ' — ' + translate('hintHotkey'),
          onClick: () => {
            debugNote('click', { sessionId });
            void engineRef.current.toggle();
          },
          onContextMenu: (event) => {
            event.preventDefault();
            setSettingsOpen(true);
          },
        }, active ? (state.phase === 'starting' ? h('span', { className: 'rv-spinner' }) : STOP_ICON) : MIC_ICON));
    }

    let settingsOpenSetter = null;
    let settingsOpenState = false;
    const settingsOpenListeners = new Set();
    function setSettingsOpen(next) {
      settingsOpenState = next;
      for (const listener of settingsOpenListeners) listener(next);
    }
    function useSettingsOpen() {
      const open = React.useSyncExternalStore(
        (listener) => { settingsOpenListeners.add(listener); return () => settingsOpenListeners.delete(listener); },
        () => settingsOpenState,
        () => settingsOpenState,
      );
      if (!settingsOpenSetter) settingsOpenSetter = setSettingsOpen;
      return open;
    }

    function Toggle(props) {
      return h('label', { className: 'rv-toggle' + (props.disabled ? ' rv-toggle-disabled' : '') },
        h('input', {
          type: 'checkbox',
          checked: !!props.checked,
          disabled: !!props.disabled,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        h('span', { className: 'rv-toggle-track' }, h('span', { className: 'rv-toggle-thumb' })),
        h('span', { className: 'rv-toggle-label' }, props.label),
        props.hint ? h('span', { className: 'rv-toggle-hint' }, props.hint) : null);
    }

    function SettingsView(props) {
      const translate = useTranslator(props);
      const settings = useSettings();
      const [tab, setTab] = React.useState('input');
      const [capabilities, setCapabilities] = React.useState(null);
      const [dictText, setDictText] = React.useState(formatDictionary(settings.dictionary));
      React.useEffect(() => {
        let cancelled = false;
        void runtime.bridge.probe().then((caps) => { if (!cancelled) setCapabilities(caps); });
        return () => { cancelled = true; };
      }, []);
      const patch = (next) => settingsStore().patch(next);
      const tabs = [
        ['input', translate('tabInput')],
        ['polish', translate('tabPolish')],
        ['translate', translate('tabTranslate')],
        ['dictionary', translate('tabDictionary')],
      ];
      const body = [];
      if (tab === 'input') {
        body.push(h('div', { key: 'lang', className: 'rv-field' },
          h('span', { className: 'rv-fieldLabel' }, translate('langLabel')),
          h('select', {
            className: 'rv-select',
            value: settings.language,
            onChange: (event) => patch({ language: event.target.value }),
          }, LANGUAGES.map((row) => h('option', { key: row.id, value: row.id }, row.label)))));
        body.push(h(Toggle, {
          key: 'sounds', checked: settings.sounds, label: translate('soundsLabel'),
          onChange: (value) => patch({ sounds: value }),
        }));
        body.push(h(Toggle, {
          key: 'partial', checked: settings.partialPreview, label: translate('partialLabel'),
          onChange: (value) => patch({ partialPreview: value }),
        }));
        body.push(h(Toggle, {
          key: 'context', checked: settings.contextMode !== 'off', label: translate('contextLabel'),
          hint: translate('contextHint'),
          onChange: (value) => patch({ contextMode: value ? 'pair' : 'off' }),
        }));
        if (settings.contextMode !== 'off') {
          body.push(h('div', { key: 'flush', className: 'rv-field' },
            h('span', { className: 'rv-fieldLabel' }, translate('flushLabel')),
            h('select', {
              className: 'rv-select',
              value: String(settings.flushMs),
              onChange: (event) => patch({ flushMs: Number(event.target.value) }),
            }, ['800', '1400', '2200'].map((ms) => h('option', { key: ms, value: ms }, translate(`flush${ms}`))))));
        }
      }
      if (tab === 'polish') {
        body.push(h(Toggle, {
          key: 'polish', checked: settings.polish, label: translate('polishLabel'), hint: translate('polishHint'),
          onChange: (value) => patch({ polish: value }),
        }));
        const stages = [
          ['filler', 'fillerLabel'], ['repeats', 'repeatsLabel'], ['corrections', 'correctionsLabel'],
          ['punctuation', 'punctuationLabel'], ['spokenCommands', 'commandsLabel'],
        ];
        for (const [key, label] of stages) {
          body.push(h(Toggle, {
            key, checked: !!settings[key], label: translate(label), disabled: !settings.polish,
            onChange: (value) => patch({ [key]: value }),
          }));
        }
      }
      if (tab === 'translate') {
        body.push(h('div', { key: 'mode', className: 'rv-field' },
          h('span', { className: 'rv-fieldLabel' }, translate('tabTranslate')),
          h('div', { className: 'rv-segment' }, ['dictate', 'translate'].map((mode) => h('button', {
            key: mode,
            type: 'button',
            className: 'rv-segmentItem',
            'data-active': settings.mode === mode ? 'true' : 'false',
            onClick: () => patch({ mode }),
          }, translate(mode === 'dictate' ? 'modeDictate' : 'modeTranslate'))))));
        body.push(h('div', { key: 'hint', className: 'rv-note' },
          translate(settings.mode === 'dictate' ? 'modeHintDictate' : 'modeHintTranslate')));
        body.push(h('div', { key: 'target', className: 'rv-field' },
          h('span', { className: 'rv-fieldLabel' }, translate('targetLabel')),
          h('select', {
            className: 'rv-select',
            value: settings.targetLanguage,
            disabled: settings.mode !== 'translate',
            onChange: (event) => patch({ targetLanguage: event.target.value }),
          }, TARGET_LANGUAGES.map((row) => h('option', { key: row.id, value: row.id }, row.label)))));
        body.push(h('div', { key: 'cap', className: 'rv-note' },
          capabilities === null ? '…'
            : capabilities.translate ? translate('translateReady') : translate('translateMissing')));
        body.push(h('div', { key: 'online', className: 'rv-field' },
          h(Toggle, {
            checked: settings.onlineTranslate !== false,
            disabled: settings.mode !== 'translate',
            label: translate('onlineLabel'),
            onChange: (value) => patch({ onlineTranslate: value }),
          })));
        body.push(h('div', { key: 'onlineHint', className: 'rv-note' }, translate('onlineHint')));
        body.push(h('div', { key: 'fallback', className: 'rv-field' },
          h(Toggle, {
            checked: settings.translateFallback === 'block',
            disabled: settings.mode !== 'translate',
            label: translate('fallbackLabel'),
            onChange: (value) => patch({ translateFallback: value ? 'block' : 'source' }),
          })));
        body.push(h('div', { key: 'fallbackHint', className: 'rv-note' }, translate('fallbackHint')));
      }
      if (tab === 'dictionary') {
        body.push(h('div', { key: 'hint', className: 'rv-note' }, translate('dictHint')));
        body.push(h('textarea', {
          key: 'dict',
          className: 'rv-textarea',
          rows: 6,
          value: dictText,
          placeholder: '卡兹克=Kazik\n飞书=Feishu',
          onChange: (event) => { setDictText(event.target.value); patch({ dictionary: parseDictionary(event.target.value) }); },
        }));
      }
      return h('div', { className: 'rv-settings' },
        h('div', { className: 'rv-tabs' }, tabs.map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: 'rv-tab',
          'data-active': tab === id ? 'true' : 'false',
          onClick: () => setTab(id),
        }, label))),
        body,
        h('div', { className: 'rv-settingsFoot' }, h('span', { className: 'rv-version' }, 'v' + VERSION)));
    }

    function VoiceBar(props) {
      const translate = useTranslator(props);
      const settings = useSettings();
      const store = storeFor('composer');
      const state = useStore(store);
      const engine = engineFor('composer');
      const open = useSettingsOpen();
      const [caps, setCaps] = React.useState(null);
      React.useEffect(() => {
        void runtime.bridge.probe().then(setCaps);
      }, []);
      const listening = state.phase === 'listening';
      const busy = state.phase === 'starting';
      const visible = listening || busy || state.phase === 'error' || !!state.pending || !!state.lastInserted || open;
      if (!visible) return null;
      const bars = [];
      for (let index = 0; index < 5; index += 1) {
        bars.push(h('span', { key: index, 'data-on': state.level >= (index + 1) / 6 ? 'true' : 'false' }));
      }
      const status = state.busyText
        || (busy ? translate('starting') : listening ? translate('listening') + ' ' + state.seconds + 's' : '');
      const children = [
        h('div', { key: 'head', className: 'rv-head' },
          h('span', { key: 'dot', className: 'rv-dot', 'data-active': listening ? 'true' : 'false' }),
          h('span', { key: 'status', className: 'rv-status' }, status),
          h('span', { key: 'bars', className: 'rv-bars', 'data-hidden': listening ? 'false' : 'true' }, bars),
          settings.mode === 'translate'
            ? h('span', { key: 'mode', className: 'rv-chip' }, translate('targetLabel') + ' ' + (settings.targetLanguage || 'en'))
            : null,
          h('button', {
            key: 'gear',
            type: 'button',
            className: 'rv-iconBtn',
            title: translate('settings'),
            'aria-label': translate('settings'),
            onClick: () => setSettingsOpen(!open),
          }, GEAR_ICON),
          listening || busy
            ? h('button', {
              key: 'stop',
              type: 'button',
              className: 'rv-iconBtn rv-stop',
              title: translate('stop'),
              'aria-label': translate('stop'),
              onClick: () => { void engine.stop(); },
            }, STOP_ICON)
            : null),
      ];
      if (listening || (state.partial && !open)) {
        children.push(h('div', { key: 'partial', className: 'rv-partial', 'data-empty': state.partial ? 'false' : 'true' },
          state.partial || (state.segmentActive ? translate('partialHint') + '…' : '…')));
      }
      if (state.waiting && !open) children.push(h('div', { key: 'waiting', className: 'rv-waiting' }, translate('waitingNext') + '…'));
      if (state.warning && !open) children.push(h('div', { key: 'warn', className: 'rv-warn' }, state.warning));
      if (state.error && !open) children.push(h('div', { key: 'error', className: 'rv-error' }, state.error));
      if (state.pending && !open) {
        children.push(h('div', { key: 'pending', className: 'rv-pending' },
          h('span', { className: 'rv-pendingText' }, translate('pending')),
          h('button', {
            type: 'button',
            className: 'rv-insert',
            onClick: () => { void engine.insertPending(); },
          }, translate('insert')),
          h('span', { className: 'rv-pendingBody' }, state.pending)));
      }
      if (open) {
        children.push(h(SettingsView, { key: 'settings', t: props.t }));
        children.push(h('div', { key: 'close', className: 'rv-foot' },
          h('span', { className: 'rv-note' },
            caps ? (caps.translate ? translate('translateReady') : translate('translateMissing')) : ''),
          h('button', {
            type: 'button',
            className: 'rv-insert',
            onClick: () => setSettingsOpen(false),
          }, translate('close'))));
      }
      return h('div', { className: 'rv-panel', role: 'status', 'aria-live': 'polite' },
        h(SurfaceActions, { key: 'surface', inputActions: props.inputActions || props.actions }),
        children);
    }

    // ----------------------------------------------------------------- styles
    const CSS = [
      '.rv-mic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:none;padding:0;border:0.5px solid var(--dsw-alias-border-l1);border-radius:50%;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-secondary);cursor:pointer;position:relative}',
      '.rv-mic:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}',
      '.rv-mic[data-active="true"]{background:var(--dsw-alias-state-error-primary);color:#fff;box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, transparent)}',
      '.rv-spinner{width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:rv-spin .8s linear infinite}',
      '@keyframes rv-spin{to{transform:rotate(360deg)}}',
      '.rv-panel{display:flex;flex-direction:column;gap:8px;margin:6px 10px 8px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.rv-head{display:flex;align-items:center;gap:8px;min-width:0}',
      '.rv-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}',
      '.rv-dot[data-active="true"]{background:var(--dsw-alias-state-error-primary);animation:rv-pulse 1.2s ease-in-out infinite}',
      '@keyframes rv-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.rv-status{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rv-bars{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex:none}',
      '.rv-bars[data-hidden="true"]{display:none}',
      '.rv-bars>span{width:3px;height:12px;border-radius:1px;background:var(--dsw-alias-border-l1);transition:background .08s linear}',
      '.rv-bars>span[data-on="true"]{background:var(--dsw-alias-state-success-primary)}',
      '.rv-chip{flex:none;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.rv-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.rv-iconBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.rv-stop{color:var(--dsw-alias-state-error-primary)}',
      '.rv-waiting{color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.rv-partial{color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;max-height:84px;overflow:auto;overflow-wrap:anywhere}',
      '.rv-partial[data-empty="true"]{color:var(--dsw-alias-label-secondary);opacity:.7}',
      '.rv-warn{color:var(--dsw-alias-state-warning-primary,#b7791f);overflow-wrap:anywhere}',
      '.rv-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.rv-pending{display:flex;align-items:center;gap:8px;flex-wrap:wrap;overflow-wrap:anywhere}',
      '.rv-pendingText{flex:none}',
      '.rv-pendingBody{flex:1;min-width:120px;color:var(--dsw-alias-label-primary)}',
      '.rv-insert{flex:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:20px;padding:0 10px;cursor:pointer}',
      '.rv-insert:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.rv-settings{display:flex;flex-direction:column;gap:8px;border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:8px}',
      '.rv-tabs{display:flex;gap:4px;flex-wrap:wrap}',
      '.rv-tab{border:0;padding:3px 9px;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}',
      '.rv-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.rv-field{display:flex;align-items:center;gap:8px;justify-content:space-between}',
      '.rv-fieldLabel{flex:none}',
      '.rv-select{flex:1;max-width:150px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:0.5px solid var(--dsw-alias-border-l1);border-radius:6px;padding:2px 6px;font-size:12px}',
      '.rv-textarea{width:100%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;font-size:12px;line-height:18px;resize:vertical;font-family:inherit}',
      '.rv-toggle{display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer}',
      '.rv-toggle-disabled{opacity:.45;cursor:default}',
      '.rv-toggle input{position:absolute;opacity:0;width:0;height:0}',
      '.rv-toggle-track{width:30px;height:17px;border-radius:999px;background:var(--dsw-alias-border-l1);position:relative;flex:none;transition:background .12s ease}',
      '.rv-toggle input:checked+.rv-toggle-track{background:var(--dsw-alias-state-success-primary)}',
      '.rv-toggle-thumb{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:transform .12s ease}',
      '.rv-toggle input:checked+.rv-toggle-track .rv-toggle-thumb{transform:translateX(13px)}',
      '.rv-toggle-label{flex:none}',
      '.rv-toggle-hint{flex-basis:100%;color:var(--dsw-alias-label-secondary);opacity:.75;font-size:11px;line-height:15px}',
      '.rv-segment{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px}',
      '.rv-segmentItem{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:2px 10px;border-radius:6px;cursor:pointer}',
      '.rv-segmentItem[data-active="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.rv-note{color:var(--dsw-alias-label-secondary);opacity:.8;font-size:11px;line-height:16px}',
      '.rv-settingsFoot{display:flex;justify-content:space-between;align-items:center}',
      '.rv-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}',
      '.rv-version{opacity:.5;font-size:11px}',
    ].join('\n');

    // ------------------------------------------------------------------ mount
    function registerUi(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }));
      ctx.effect(() => {
        const tagId = 'dsh-realtime-voice/style';
        if (typeof document === 'undefined') return () => {};
        if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return () => {};
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-realtime-voice';
        tag.dataset.pluginCss = tagId;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      });

      let localeId = '';
      try {
        const snapshot = ctx.locale.getLocale ? ctx.locale.getLocale() : undefined;
        const active = snapshot && (snapshot.active || snapshot.id || snapshot.locale);
        localeId = String(active || '').toLowerCase();
        if (!localeId && typeof navigator !== 'undefined') localeId = String(navigator.language || '').toLowerCase();
      } catch (_localeError) { localeId = ''; }
      runtime.dict = localeId.startsWith('zh') ? zh : en;

      ctx.effect(() => () => {
        for (const engine of runtime.engines.values()) void engine.dispose();
        runtime.engines.clear();
        runtime.surfaces.clear();
      });

      // One microphone, in the slot the shipped voice input already owns. A lower
      // priority replaces it instead of stacking a second button beside it.
      const micSlot = () => {
        try {
          return ctx.slots.register({ name: 'conversation.input.activity', priority: -1, locale: NS }, MicButton);
        } catch (_activityError) {
          return ctx.slots.register({ name: 'conversation.input.right', id: 'realtime-voice', order: 35, locale: NS }, MicButton);
        }
      };
      ctx.slots.inject('conversation.input.activity', micSlot);
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'realtime-voice-live',
        order: 36,
        locale: NS,
      }, VoiceBar));
      // The shipped bundle renders its own settings card through this keyed slot;
      // ours keeps the same address so the plugin page shows one entry.
      try {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-realtime-voice',
          locale: NS,
        }, SettingsView));
      } catch (_settingsSlotError) { debugNote('settings-slot:unavailable'); }
      // A first-class page in the settings panel, so the entry does not depend on
      // right-clicking the microphone. The slot only exists while ui-settings is
      // composed, and `inject` defers registration until it is.
      try {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'realtime-voice',
          order: 72,
          label: (runtime.dict && runtime.dict.settings) || 'Realtime voice settings',
          locale: NS,
        }, SettingsView));
      } catch (_sectionSlotError) { debugNote('settings-section:unavailable'); }
    }

    const inject = ['remote', 'slots', 'locale'];

    function apply(ctx) {
      runtime = createRuntime();
      runtime.bridge = createHostBridge();
      settingsStore();
      registerUi(ctx);

      // `remote.speech` is a guarded namespace service: it can only be read through an
      // inject scope that names it. The shipped voice-input client mounts it at boot.
      const speech = ctx.inject(['remote.speech'], (scope) => {
        try { runtime.speech = scope.remote.speech; } catch (_scopeError) { return () => {}; }
        debugNote('speech:scope-ready');
        return () => { if (runtime) runtime.speech = null; };
      });

      // Integration seam: other plugins own the field, we own capture + pipeline.
      const api = createVoiceInputApi();
      let disposeApi = () => {};
      try {
        if (typeof ctx.provide === 'function') disposeApi = ctx.provide('voiceInput', api) || (() => {});
      } catch (_provideError) { debugNote('voiceInput:provide-failed'); }
      try { if (typeof window !== 'undefined') window.__dshVoiceInput = api; } catch (_exposeError) {}
      runtime.bridge.probe();
      return () => {
        try { disposeApi(); } catch (_disposeApi) {}
        try { if (speech && typeof speech.dispose === 'function') speech.dispose(); } catch (_disposeSpeech) {}
      };
    }

    return {
      inject,
      apply,
      // Exposed for the offline harness: pure functions only, no side effects.
      __test: {
        normalizeSettings, parseDictionary, formatDictionary, polish,
        stripFillers, collapseRepeats, resolveSelfCorrections, applySpokenCommands,
        fixPunctuation, applyDictionary, isCjkText, reconcilePartial,
        mergeSegments, seamNeedsSpace,
      },
    };
  },
});
