// ---------------------------------------------------------------------------
// characters.js — the cast of the voice companion.
//
// Every character owns its own artwork, its own name, its own spoken labels and
// its own voice preference. avatar.js only knows this contract:
//
//   { id, name, tagline, voice, labels, build(doc) -> { svg, mouth, mouthPath } }
//
// `mouth` is a live <path>; `mouthPath(level)` returns the `d` for a 0..1 mouth
// opening. Everything is built from live SVG nodes (no innerHTML) so the same
// code runs in the browser, in the offline harness and in the bundler.
// ---------------------------------------------------------------------------

const ART_NS = 'http://www.w3.org/2000/svg';

function artNode(doc, tag, attrs) {
  const node = doc.createElementNS(ART_NS, tag);
  if (attrs) {
    for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  }
  return node;
}

function artGroup(doc, className, transform) {
  const attrs = { class: className };
  if (transform) attrs.transform = transform;
  return artNode(doc, 'g', attrs);
}

function artLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function artPath(doc, d, attrs) {
  const merged = Object.assign({ d }, attrs || {});
  return artNode(doc, 'path', merged);
}

function artEllipse(doc, cx, cy, rx, ry, attrs) {
  return artNode(doc, 'ellipse', Object.assign({ cx, cy, rx, ry }, attrs || {}));
}

function artCircle(doc, cx, cy, r, attrs) {
  return artNode(doc, 'circle', Object.assign({ cx, cy, r }, attrs || {}));
}

function artRect(doc, x, y, width, height, attrs) {
  return artNode(doc, 'rect', Object.assign({ x, y, width, height }, attrs || {}));
}

function artGradient(doc, id, x1, y1, x2, y2, stops) {
  const gradient = artNode(doc, 'linearGradient', { id, x1, y1, x2, y2 });
  for (const stop of stops) {
    gradient.appendChild(artNode(doc, 'stop', {
      offset: stop[0],
      'stop-color': stop[1],
      ...(stop[2] ? { 'stop-opacity': String(stop[2]) } : {}),
    }));
  }
  return gradient;
}

function artCanvas(doc, className) {
  const svg = artNode(doc, 'svg', {
    class: 'vc-fish-svg',
    viewBox: '0 0 240 200',
    xmlns: ART_NS,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const defs = artNode(doc, 'defs');
  svg.appendChild(defs);
  const body = artGroup(doc, className || 'vc-fish-body');
  svg.appendChild(body);
  return { svg, defs, body };
}

function artMouthId(doc, path) {
  path.setAttribute('id', 'mouth');
  path.setAttribute('class', 'vc-mouth');
  return path;
}

let artUid = 0;

// --------------------------------------------------------------- 大肥鱼 whale

// Official DeepSeek whale silhouette (favicon.svg), split into the outer body
// and the white belly. Both are drawn inside one 50x50 -> 240x200 transform.
const WHALE_BODY_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479Z';
const WHALE_BELLY_PATH = 'M24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398Z';

// The face sits on the head (the big round end, on the left) and on the white
// jaw. It used to sit at (141,101)/(163,130) — on the tail end of the body,
// which is what the bug report called "eyes and mouth on the tail".
const WHALE_EYE = { cx: 64, cy: 70 };
const WHALE_PUPIL = { cx: 60.5, cy: 74, r: 8.2 };
const WHALE_GLINT = { cx: 57, cy: 70, r: 3.2 };
const WHALE_MOUTH = { cx: 68, cy: 110, half: 13 };

function whaleMouthPath(level) {
  const k = artLevel(level);
  const { cx, cy, half } = WHALE_MOUTH;
  const upper = cy + 4.5 + k * 18;
  const lower = cy + 1.2 + k * 3;
  return 'M' + (cx - half) + ' ' + cy +
    ' Q' + cx + ' ' + upper.toFixed(1) + ' ' + (cx + half) + ' ' + cy +
    ' Q' + cx + ' ' + lower.toFixed(1) + ' ' + (cx - half) + ' ' + cy + ' Z';
}

function buildWhale(doc) {
  const uid = 'vc-whale-' + (++artUid);
  const gradientId = uid + '-body';
  const { svg, defs, body } = artCanvas(doc, 'vc-fish-body');

  defs.appendChild(artGradient(doc, gradientId, '0.1', '0', '0.85', '1', [
    ['0', '#6b85ff'],
    ['0.55', '#4d6bfe'],
    ['1', '#3b55e0'],
  ]));

  const whale = artGroup(doc, 'vc-whale');
  const torso = artGroup(doc, null, 'translate(15 0) scale(4.2)');
  torso.appendChild(artPath(doc, WHALE_BODY_PATH, {
    fill: 'url(#' + gradientId + ')',
    stroke: '#a8b8ff',
    'stroke-opacity': '0.45',
    'stroke-width': '0.6',
    'stroke-linejoin': 'round',
  }));
  torso.appendChild(artPath(doc, WHALE_BELLY_PATH, { fill: '#f4f7ff' }));
  whale.appendChild(torso);

  // Blowhole on the back, feeding the spout that only shows while speaking.
  whale.appendChild(artEllipse(doc, 102, 42, 7, 3.2, {
    transform: 'rotate(-20 102 42)',
    fill: '#22307a',
  }));

  const eye = artGroup(doc, 'vc-eye');
  eye.appendChild(artCircle(doc, WHALE_EYE.cx, WHALE_EYE.cy, 17.5, {
    fill: '#ffffff',
    stroke: '#dce5ff',
    'stroke-width': '1.5',
  }));
  const pupil = artGroup(doc, 'vc-pupil');
  pupil.appendChild(artCircle(doc, WHALE_PUPIL.cx, WHALE_PUPIL.cy, WHALE_PUPIL.r, { fill: '#121b3a' }));
  pupil.appendChild(artCircle(doc, WHALE_GLINT.cx, WHALE_GLINT.cy, WHALE_GLINT.r, {
    fill: '#ffffff',
    opacity: '0.92',
  }));
  eye.appendChild(pupil);
  whale.appendChild(eye);

  const mouth = artMouthId(doc, artPath(doc, whaleMouthPath(0), {
    fill: '#0e1730',
    'stroke-linecap': 'round',
  }));
  whale.appendChild(mouth);

  const spout = artGroup(doc, 'vc-spout');
  for (const [cx, cy, r] of [[95, 28, 7], [107, 16, 5.5], [119, 6, 4.5]]) {
    spout.appendChild(artCircle(doc, cx, cy, r, { fill: '#cfe0ff', opacity: '0.9' }));
  }
  whale.appendChild(spout);

  body.appendChild(whale);
  return { svg, mouth, mouthPath: whaleMouthPath };
}

// ------------------------------------------------------------- 小肥鱼 chibi

// An original anime "kanban girl": twin tails, sailor uniform, the same headset
// the voice companion talks through. Drawn for the 240x200 stage at 186x155, so
// every shape stays bold enough to read at panel size.
const CHIBI_MOUTH = { cx: 120, cy: 137, half: 10 };

function chibiMouthPath(level) {
  const k = artLevel(level);
  const { cx, cy, half } = CHIBI_MOUTH;
  const upper = cy + 9 + k * 12;
  const lower = cy + 3 + k * 2;
  return 'M' + (cx - half) + ' ' + cy +
    ' Q' + cx + ' ' + upper.toFixed(1) + ' ' + (cx + half) + ' ' + cy +
    ' Q' + cx + ' ' + lower.toFixed(1) + ' ' + (cx - half) + ' ' + cy + ' Z';
}

function buildChibi(doc) {
  const uid = 'vc-chibi-' + (++artUid);
  const hairId = uid + '-hair';
  const irisId = uid + '-iris';
  const glowId = uid + '-glow';
  const uniformId = uid + '-uniform';
  const { svg, defs, body } = artCanvas(doc, 'vc-fish-body');
  // 半身像是竖构图，把取景框收到头肩，才不会在横构图的面板里显得只有一半大。
  svg.setAttribute('viewBox', '46 20 148 180');

  defs.appendChild(artGradient(doc, hairId, '0.15', '0', '0.85', '1', [
    ['0', '#b4c9ff'],
    ['0.5', '#6e8ff9'],
    ['1', '#4257c6'],
  ]));
  defs.appendChild(artGradient(doc, irisId, '0', '0', '0', '1', [
    ['0', '#8fb0ff'],
    ['0.55', '#3d63e8'],
    ['1', '#16246e'],
  ]));
  defs.appendChild(artGradient(doc, glowId, '0', '0', '0', '1', [
    ['0', '#cbd9ff', 0.5],
    ['1', '#7a97ff', 0],
  ]));
  defs.appendChild(artGradient(doc, uniformId, '0', '0', '0', '1', [
    ['0', '#33447f'],
    ['1', '#212e5e'],
  ]));

  const chibi = artGroup(doc, 'vc-whale');
  const hair = 'url(#' + hairId + ')';

  chibi.appendChild(artEllipse(doc, 120, 110, 84, 78, { fill: 'url(#' + glowId + ')' }));

  // Twin tails, then the hair mass behind the head.
  chibi.appendChild(artPath(doc, 'M60 116 C44 140 40 168 45 191 C46 198 56 198 58 191 C64 166 69 140 71 120 Z', { fill: hair }));
  chibi.appendChild(artPath(doc, 'M180 116 C196 140 200 168 195 191 C194 198 184 198 182 191 C176 166 171 140 169 120 Z', { fill: hair }));
  chibi.appendChild(artEllipse(doc, 120, 104, 57, 61, { fill: hair }));

  // Neck is drawn before the face so the chin hides its top edge.
  chibi.appendChild(artPath(doc, 'M108 132 h24 v34 c0 5 -5 8 -12 8 s-12 -3 -12 -8 z', { fill: '#efc3b1' }));
  chibi.appendChild(artEllipse(doc, 120, 106, 47, 49, { fill: '#ffe7da' }));

  // Sailor uniform and collar.
  chibi.appendChild(artPath(doc, 'M120 168 C98 168 74 176 62 189 C56 196 60 200 68 200 h104 c8 0 12 -4 6 -11 C166 176 142 168 120 168 Z', { fill: 'url(#' + uniformId + ')' }));
  chibi.appendChild(artPath(doc, 'M101 176 C92 182 85 190 82 200 h76 c-3 -10 -10 -18 -19 -24 z', { fill: '#f4f7ff' }));
  chibi.appendChild(artPath(doc, 'M101 180 C94 186 88 192 86 200 M139 180 C146 186 152 192 154 200', {
    fill: 'none',
    stroke: '#6e8ff9',
    'stroke-width': '2.4',
    'stroke-linecap': 'round',
  }));
  chibi.appendChild(artPath(doc, 'M120 178 l-11 -6 v12 z', { fill: '#4a63d8' }));
  chibi.appendChild(artPath(doc, 'M120 178 l11 -6 v12 z', { fill: '#4a63d8' }));
  chibi.appendChild(artCircle(doc, 120, 178, 3.6, { fill: '#8fb0ff' }));

  // Bob fringe with five soft tips, plus the two locks framing the face.
  chibi.appendChild(artPath(doc, 'M63 100 C61 58 88 37 120 37 C152 37 179 58 177 100 Q170 94 164 98 Q158 88 153 88 Q147 94 142 98 Q136 88 131 88 Q125 94 120 98 Q114 88 109 88 Q103 94 98 98 Q92 88 87 88 Q81 94 76 98 Q69 92 63 100 Z', { fill: hair }));
  chibi.appendChild(artPath(doc, 'M70 88 C63 112 65 136 60 154', {
    fill: 'none', stroke: hair, 'stroke-width': '14', 'stroke-linecap': 'round',
  }));
  chibi.appendChild(artPath(doc, 'M170 88 C177 112 175 136 180 154', {
    fill: 'none', stroke: hair, 'stroke-width': '14', 'stroke-linecap': 'round',
  }));
  chibi.appendChild(artPath(doc, 'M86 60 C94 51 107 46 120 45', {
    fill: 'none', stroke: '#d6e2ff', 'stroke-width': '3', 'stroke-linecap': 'round', opacity: '0.65',
  }));

  // Headset: the band rides over the hair, the cups sit on the ears.
  chibi.appendChild(artPath(doc, 'M62 106 C62 34 178 34 178 106', {
    fill: 'none', stroke: '#26325e', 'stroke-width': '9', 'stroke-linecap': 'round',
  }));
  chibi.appendChild(artRect(doc, 50, 98, 21, 34, {
    rx: 10.5, fill: '#3a4a8c', stroke: '#26325e', 'stroke-width': '2.5',
  }));
  chibi.appendChild(artRect(doc, 169, 98, 21, 34, {
    rx: 10.5, fill: '#3a4a8c', stroke: '#26325e', 'stroke-width': '2.5',
  }));
  chibi.appendChild(artCircle(doc, 60.5, 113, 2.6, { fill: '#8fb0ff' }));
  chibi.appendChild(artPath(doc, 'M129 54 C131 40 139 33 149 35', {
    fill: 'none', stroke: '#6e8ff9', 'stroke-width': '4.5', 'stroke-linecap': 'round',
  }));

  // Eyes: one group so the shared blink animation can squash both.
  const eyes = artGroup(doc, 'vc-eye');
  for (const cx of [100, 140]) {
    eyes.appendChild(artEllipse(doc, cx, 114, 13, 15, { fill: '#fff' }));
    eyes.appendChild(artEllipse(doc, cx, 115, 10.5, 12.5, { fill: 'url(#' + irisId + ')' }));
    eyes.appendChild(artEllipse(doc, cx, 117, 5, 6.5, { fill: '#131c3c' }));
    eyes.appendChild(artCircle(doc, cx - 4, 109, 3.6, { fill: '#fff', opacity: '0.95' }));
    eyes.appendChild(artCircle(doc, cx + 4, 122, 1.9, { fill: '#fff', opacity: '0.6' }));
  }
  eyes.appendChild(artPath(doc, 'M87 103 Q100 95 113 102', {
    fill: 'none', stroke: '#1b2340', 'stroke-width': '3.6', 'stroke-linecap': 'round',
  }));
  eyes.appendChild(artPath(doc, 'M127 102 Q140 95 153 103', {
    fill: 'none', stroke: '#1b2340', 'stroke-width': '3.6', 'stroke-linecap': 'round',
  }));
  chibi.appendChild(eyes);

  chibi.appendChild(artPath(doc, 'M92 84 Q100 81 108 83', {
    fill: 'none', stroke: '#6b7bc4', 'stroke-width': '2.6', 'stroke-linecap': 'round', opacity: '0.85',
  }));
  chibi.appendChild(artPath(doc, 'M132 83 Q140 81 148 84', {
    fill: 'none', stroke: '#6b7bc4', 'stroke-width': '2.6', 'stroke-linecap': 'round', opacity: '0.85',
  }));
  chibi.appendChild(artEllipse(doc, 81, 130, 9, 5, { fill: '#ff9fb0', opacity: '0.4' }));
  chibi.appendChild(artEllipse(doc, 159, 130, 9, 5, { fill: '#ff9fb0', opacity: '0.4' }));

  const mouth = artMouthId(doc, artPath(doc, chibiMouthPath(0), {
    fill: '#b4485f',
    'stroke-linecap': 'round',
  }));
  chibi.appendChild(mouth);

  body.appendChild(chibi);
  return { svg, mouth, mouthPath: chibiMouthPath };
}

// ----------------------------------------------------------------- the cast

const CHARACTERS = [
  {
    id: 'whale',
    name: '大肥鱼',
    tagline: '官方蓝鲸',
    voice: 'tide',
    labels: {
      idle: '大肥鱼待命中',
      listening: '大肥鱼在听',
      thinking: '大肥鱼在想',
      speaking: '大肥鱼在说',
      error: '信号不太好',
    },
    build: buildWhale,
  },
  {
    id: 'chibi',
    name: '小肥鱼',
    tagline: '二次元看板娘',
    voice: 'stella',
    labels: {
      idle: '小肥鱼待命中',
      listening: '小肥鱼在听',
      thinking: '小肥鱼在想',
      speaking: '小肥鱼在说',
      error: '信号不太好',
    },
    build: buildChibi,
  },
];

const DEFAULT_CHARACTER = CHARACTERS[0].id;

function listCharacters() {
  return CHARACTERS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    tagline: entry.tagline,
    voice: entry.voice,
  }));
}

function characterById(id) {
  const wanted = String(id === null || id === undefined ? '' : id);
  for (const entry of CHARACTERS) {
    if (entry.id === wanted) return entry;
  }
  return null;
}

function resolveCharacter(id) {
  return characterById(id) || CHARACTERS[0];
}

function nextCharacterId(id) {
  const index = CHARACTERS.findIndex((entry) => entry.id === String(id));
  return CHARACTERS[(index + 1) % CHARACTERS.length].id;
}

// Pure mouth geometry, no DOM: used by the offline tests to assert that the
// live <path> follows the audio level.
function mouthPathFor(id, level) {
  const character = resolveCharacter(id);
  return character.id === 'chibi' ? chibiMouthPath(level) : whaleMouthPath(level);
}

function renderCharacter(doc, id) {
  const character = resolveCharacter(id);
  const art = character.build(doc);
  return {
    id: character.id,
    name: character.name,
    labels: character.labels,
    character,
    svg: art.svg,
    mouth: art.mouth,
    mouthPath: art.mouthPath,
  };
}

export {
  CHARACTERS,
  DEFAULT_CHARACTER,
  characterById,
  listCharacters,
  mouthPathFor,
  nextCharacterId,
  renderCharacter,
  resolveCharacter,
};
