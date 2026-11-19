export const THEME_VERSION = 1;
const FONT_STACKS = {
  system: 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
  serif: 'Georgia,serif',
  mono: 'ui-monospace,monospace',
  rounded: '"SF Pro Rounded","PingFang SC",system-ui,sans-serif',
};
// [group, [key, type, 0.3-literal, extra?]...] — order drives CSS output and the settings panel.
const TOKEN_GROUPS = [
  ['board', ['board.bgFrom','color','rgba(20,32,66,.88)'],['board.bgTo','color','rgba(8,14,30,.94)'],
    ['board.bgAngle','length','160deg'],['board.borderColor','color','rgba(120,150,255,.18)'],
    ['board.borderWidth','length','1px'],['board.radius','length','20px'],['board.blur','length','14px'],
    ['board.saturate','length','140%'],['board.shadow','shadow','0 18px 44px rgba(2,7,16,.5)'],
    ['board.innerLight','color','rgba(255,255,255,.08)'],['board.padding','css','9px 12px 8px'],
    ['board.gap','length','6px'],['board.width','length','340px'],['board.height','length','316px'],
    ['board.z','number', 2147483000, { min: 0, max: 2147483647 }]],
  ['type', ['type.font','enum','system', { options: ['system','serif','mono','rounded'] }],
    ['type.size','length','13px'],['type.lineHeight','number', 1.45, { min: 0.8, max: 3 }]],
  ['text', ['text.primary','color','#edf2ff'],['text.secondary','color','#cfd9f5'],
    ['text.muted','color','#9fb0d6'],['text.onAccent','color','#04241b']],
  ['accent', ['accent.base','color','#6b85ff'],['accent.strong','color','#4d6bfe'],['accent.soft','color','#7d95ff']],
  ['dot', ['dot.size','length','6px'],['dot.idle','color','#8b93a7'],['dot.listening','color','#7fe3a8'],
    ['dot.thinking','color','#9db4ff'],['dot.speaking','color','#8fa6ff'],['dot.error','color','#ff7676'],
    ['chip.size','length','21px'],['chip.bg','color','rgba(255,255,255,.06)']],
  ['button', ['btn.bg','color','rgba(255,255,255,.08)'],['btn.border','color','rgba(255,255,255,.16)'],
    ['btn.color','color','#eef3ff'],['btn.radius','length','999px'],['btn.padding','css','5px 11px'],
    ['btn.fontSize','length','11px'],['btn.focusRing','color','#9db4ff'],
    ['start.from','color','#7d95ff'],['start.to','color','#4d6bfe'],
    ['end.bg','color','rgba(255,104,104,.16)'],['end.border','color','rgba(255,128,128,.38)'],
    ['end.color','color','#ffc4c4'],['mode.dictationFrom','color','#5fd0a8'],['mode.dictationTo','color','#22a37a']],
  ['stage', ['stage.height','length','152px'],['stage.radius','length','14px'],['stage.bg','color','transparent'],
    ['core.width','length','264px'],['core.height','length','140px'],['core.spin','duration','8s'],
    ['core.glow','number', 0.55, { min: 0, max: 1 }],['core.displace','number', 0.18, { min: 0, max: 1 }],
    ['core.rim','color','#8fb4ff'],['core.quality','enum','auto', { options: ['auto','high','low','off'] }],
    ['core.palette.idle','css','#e2fcff,#63d8ef,#2878ad', { parts: 3 }],
    ['core.palette.listening','css','#d8ffe9,#7fe3a8,#2fbf86', { parts: 3 }],
    ['core.palette.thinking','css','#efe7ff,#bba0fa,#6d52d1', { parts: 3 }],
    ['core.palette.speaking','css','#f0f7ff,#8cbaff,#5266eb', { parts: 3 }],
    ['core.palette.error','css','#ffd9d9,#ff7676,#7a2020', { parts: 3 }]],
  ['surface', ['bubble.bg','color','rgba(120,150,255,.10)'],['bubble.border','color','rgba(140,170,255,.14)'],
    ['bubble.color','color','#e8eeff'],['bubble.radius','length','12px'],['bubble.fontSize','length','12px'],
    ['bubble.userBg','color','rgba(140,170,255,.06)'],['partial.color','color','#9db4ff'],
    ['receipt.bg','color','rgba(103,226,166,.12)'],['receipt.color','color','#8ff0c4'],
    ['sheet.bgFrom','color','rgba(15,24,50,.97)'],['sheet.bgTo','color','rgba(6,11,24,.98)'],
    ['sheet.radius','length','18px'],['sheet.scrim','color','rgba(2,5,12,.55)'],
    ['field.bg','color','rgba(255,255,255,.06)'],['field.border','color','rgba(255,255,255,.14)'],
    ['field.color','color','#dfe8ff'],['ripple.color','color','rgba(107,133,255,.55)'],
    ['ripple.size','length','196px'],['ripple.duration','duration','2.6s'],
    ['think.color','color','#93a9ff'],['think.duration','duration','1s'],
    ['motion.speed','number', 1, { min: 0.1, max: 4 }],['motion.easing','easing','cubic-bezier(.2,.8,.2,1)'],
    ['motion.idleFps','number', 30, { min: 1, max: 240 }],
    ['motion.reducedMotion','enum','respect', { options: ['respect','static','off'] }]],
];
export const TOKEN_SCHEMA = {};
for (const [group, ...entries] of TOKEN_GROUPS) for (const [key, type, def, extra] of entries) TOKEN_SCHEMA[key] = { key, group, type, default: def, ...(extra || {}) };
const tokenDefaults = () => { const out = {}; for (const key in TOKEN_SCHEMA) out[key] = TOKEN_SCHEMA[key].default; return out; };
export const DEFAULT_THEME = Object.freeze({ v: THEME_VERSION, name: '默认', tokens: Object.freeze(tokenDefaults()), css: Object.freeze({}) });

const P = {
  color: /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([-+0-9.%\s,/a-z]*\)|[a-z]{3,20})$/i,
  length: /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|vh|vw|vmin|vmax|ch|ex|pt|cm|mm|deg|rad|turn|s|ms))$/,
  number: /^-?(?:\d+(?:\.\d+)?|\.\d+)$/,
  easing: /^(?:linear|ease(-in|-out|-in-out)?|step-start|step-end|cubic-bezier\([-\d.,\s]+\)|steps\([^)]*\))$/,
  value: /^[-0-9a-zA-Z#.,%()/'"\s_+:]+$/,
};
P.shadow = P.value;
const FORBIDDEN = ['@','url(','expression(','javascript:','behavior:','-moz-binding','/*','*/','<','>','{','}',';','\\','!important'];
const clean = (v) => String(v).trim().replace(/\s+/g, ' ');
const safe = (text) => { const lower = String(text).toLowerCase(); return FORBIDDEN.every((bad) => !lower.includes(bad)); };
const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function normalize(schema, raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = clean(raw);
  if (!text || text.length > 200 || !safe(text)) return null;
  if (schema.type === 'number') {
    if (!P.number.test(text)) return null;
    const n = Number(text);
    return (schema.min === undefined || n >= schema.min) && (schema.max === undefined || n <= schema.max) ? n : null;
  }
  if (schema.type === 'css') {
    if (!P.value.test(text)) return null;
    if (!schema.parts) return text;
    const parts = text.split(',').map((part) => part.trim());
    return parts.length === schema.parts && parts.every((part) => P.color.test(part)) ? parts.join(',') : null;
  }
  if (schema.type === 'font') return FONT_STACKS[text] !== undefined ? text : null;
  if (schema.type === 'enum') return (schema.options || []).includes(text) ? text : null;
  return (P[schema.type] || P.value).test(text) ? text : null;
}

const CSS_PARTS = 'root panel head dot label chip mode gear min start end stage bubble partial receipt sheet field ripple thinkDots core'.split(' ');
const BLOCKED_PROP = /^(?:position|inset|top|right|bottom|left|z-index|display|pointer-events|content|visibility|float|cursor|user-select|min-width|min-height|max-width|max-height|width|height|margin|overflow|flex|grid)(?:-|$)/;
const ALLOWED_PROP = /^(?:color|background|border|box-shadow|text-shadow|font|letter-spacing|line-height|opacity|filter|backdrop-filter|mix-blend-mode|transform|animation|transition|padding|gap|outline)(?:-|$)/;
function sanitizePart(part, source, dropped) {
  const keep = [];
  for (const raw of String(source).split(';')) {
    const piece = raw.trim();
    if (!piece) continue;
    const at = piece.indexOf(':');
    if (at < 0) { dropped.push(`css:${part}:syntax`); continue; }
    const prop = piece.slice(0, at).trim().toLowerCase();
    const value = clean(piece.slice(at + 1));
    if (!prop || !value || value.length > 160 || !safe(value) || BLOCKED_PROP.test(prop) || !ALLOWED_PROP.test(prop)
      || !P.value.test(value) || value.replace(/var\(--vc-[a-z0-9-]+\)/g, '').includes('var(')) {
      dropped.push(`css:${part}:${prop}`);
      continue;
    }
    keep.push(`${prop}:${value}`);
  }
  const out = keep.slice(0, 12).join(';');
  if (keep.length > 12) dropped.push(`css:${part}:count`);
  if (out.length > 300) { dropped.push(`css:${part}:length`); return ''; }
  return out;
}

export function cssVarName(name) {
  const kebab = String(name == null ? '' : name).replace(/\./g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return kebab ? `--vc-${kebab}` : '';
}

export function sanitizeTheme(input) {
  const dropped = [];
  const theme = { v: THEME_VERSION, name: '默认', tokens: tokenDefaults(), css: {} };
  if (!plain(input)) { dropped.push('theme:not-an-object'); return { theme, dropped }; }
  if (input.v !== undefined && input.v !== THEME_VERSION) dropped.push('theme:v');
  if (typeof input.name === 'string' && input.name.trim()) theme.name = input.name.trim().slice(0, 40);
  else if (input.name !== undefined) dropped.push('theme:name');
  if (input.tokens !== undefined) {
    if (!plain(input.tokens)) dropped.push('theme:tokens');
    else for (const key of Object.keys(input.tokens)) {
      const value = TOKEN_SCHEMA[key] ? normalize(TOKEN_SCHEMA[key], input.tokens[key]) : null;
      if (value == null) dropped.push(`token:${key}`); else theme.tokens[key] = value;
    }
  }
  if (input.css !== undefined) {
    if (!plain(input.css)) dropped.push('css:not-an-object');
    else {
      let total = 0;
      for (const part of CSS_PARTS) {
        const source = input.css[part];
        if (source == null) continue;
        if (typeof source !== 'string') { dropped.push(`css:${part}:not-a-string`); continue; }
        const block = sanitizePart(part, source, dropped);
        if (!block) continue;
        if (total + block.length > 3000) { dropped.push(`css:${part}:budget`); continue; }
        total += block.length;
        theme.css[part] = block;
      }
    }
  }
  return { theme, dropped };
}

const HUD_TOKENS = 'board.z board.bgTo board.gap board.shadow text.primary type.size type.lineHeight type.font btn.radius btn.padding dot.idle dot.error dot.thinking dot.speaking dot.listening think.duration'.split(' ');
function decls(keys, tokens) {
  return keys.map((key) => `${cssVarName(key)}:${TOKEN_SCHEMA[key] && TOKEN_SCHEMA[key].type === 'font' ? FONT_STACKS[tokens[key]] || FONT_STACKS.system : tokens[key]}`).join(';');
}
export function themeToCss(input) {
  const { theme } = sanitizeTheme(input == null ? DEFAULT_THEME : input);
  const blocks = [`[data-vc-avatar]{${decls(Object.keys(TOKEN_SCHEMA), theme.tokens)}}`];
  for (const part of CSS_PARTS) {
    const block = theme.css[part];
    if (!block) continue;
    blocks.push(part === 'root' ? `[data-vc-avatar]{${block}}` : `[data-vc-avatar] .vc-${part === 'thinkDots' ? 'dots' : part}{${block}}`);
  }
  const hud = HUD_TOKENS.filter((key) => String(theme.tokens[key]) !== String(DEFAULT_THEME.tokens[key]));
  if (hud.length) blocks.push(`.vc-hotkey-hud{${decls(hud, theme.tokens)}}`);
  return blocks.join('\n');
}

export function ensureThemeStyle(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  for (const root of [doc.head, doc.body]) for (const node of (root && root.children) || []) if (node && typeof node.getAttribute === 'function' && node.getAttribute('data-vc-theme-style') !== null) return node;
  const parent = doc.head || doc.body;
  if (!parent || typeof parent.appendChild !== 'function') return null;
  const style = doc.createElement('style');
  style.setAttribute('data-vc-theme-style', '');
  parent.appendChild(style);
  return style;
}
export function applyTheme(doc, theme) {
  const result = sanitizeTheme(theme == null ? DEFAULT_THEME : theme);
  const css = themeToCss(result.theme);
  const node = ensureThemeStyle(doc);
  if (node) node.textContent = css;
  return { theme: result.theme, css, dropped: result.dropped };
}

export const LOCAL_STYLE_LEXICON = [
  {id:'cyberpunk', kw: ['赛博朋克'],t: { 'accent.base': '#ff2a4d','board.bgFrom': '#12040a' } },
  {id:'neon', kw: ['霓虹'],t: { 'accent.base': '#00e5ff','board.bgFrom': '#0b1020' } },
  {id:'minimal', kw: ['极简'],t: { 'board.bgFrom': 'rgba(255,255,255,.92)','text.primary': '#1b2230' } },
  {id:'glass', kw: ['玻璃'],t: { 'board.bgFrom': 'rgba(255,255,255,.16)','board.blur': '22px' } },
  {id:'dark', kw: ['暗黑'],t: { 'board.bgFrom': 'rgba(14,14,18,.94)','text.primary': '#eceff4' } },
  {id:'redblack', kw: ['红黑'],t: { 'board.bgFrom': 'rgba(26,6,10,.94)','accent.base': '#e0243f' } },
  {id:'warm', kw: ['暖色'],t: { 'board.bgFrom': 'rgba(46,28,16,.90)','accent.base': '#ff9a4d' } },
  {id:'cool', kw: ['冷色'],t: { 'board.bgFrom': 'rgba(12,28,44,.90)','accent.base': '#4dd0e1' } },
  {id:'large-type', kw: ['大字号'],t: { 'type.size': '15px','bubble.fontSize': '14px' } },
  {id:'small-radius', kw: ['小圆角'],t: { 'board.radius': '8px','bubble.radius': '6px' } },
  {id:'borderless', kw: ['无边框'],t: { 'board.borderWidth': '0px','bubble.border': 'rgba(0,0,0,0)' } },
  {id:'high-contrast', kw: ['高对比'],t: { 'board.bgFrom': 'rgba(0,0,0,.98)','text.primary': '#ffffff' } },
];
