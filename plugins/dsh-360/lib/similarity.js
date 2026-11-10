/**
 * Description similarity for routing-ambiguity detection.
 *
 * Plain Jaccard on long mixed-language descriptions is useless: it dilutes
 * every shared concept with hundreds of incidental n-grams (measured: 0 of
 * 378 real pairs scored ≥ 0.25). This module weights tokens by corpus IDF,
 * uses cosine similarity, and adds a small name-token bonus so skills in the
 * same family (`grilling` / `auto-grill` / `grill-me`) surface even when their
 * prose is deliberately differentiated.
 */
import { overlapTokens } from './util.js';

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function nameTokens(name) {
  return String(name || '').toLowerCase().split(/[-_.\s]+/).filter(Boolean);
}

function nameOverlap(a, b) {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const token of small) if (large.has(token)) shared += 1;
  return shared / small.size;
}

/**
 * @param {{name:string, description:string}[]} entries
 */
export function createSimilarityModel(entries) {
  const list = (entries || []).filter((entry) => entry && typeof entry.description === 'string');
  const keys = list.map((entry) => entry.name);
  const index = new Map(keys.map((name, i) => [name, i]));
  const tokenSets = list.map((entry) => overlapTokens(entry.description));
  const df = new Map();
  for (const set of tokenSets) {
    for (const token of set) df.set(token, (df.get(token) || 0) + 1);
  }
  const total = Math.max(1, list.length);
  const idf = (token) => Math.log(1 + total / (df.get(token) || 1));
  const vectors = tokenSets.map((set) => {
    const vector = new Map();
    for (const token of set) vector.set(token, idf(token));
    return vector;
  });

  function cosine(i, j) {
    const a = vectors[i];
    const b = vectors[j];
    if (!a || !b || a.size === 0 || b.size === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const [token, weight] of a) {
      normA += weight * weight;
      const other = b.get(token);
      if (other !== undefined) dot += weight * other;
    }
    for (const weight of b.values()) normB += weight * weight;
    if (normA === 0 || normB === 0) return 0;
    return dot / Math.sqrt(normA * normB);
  }

  const STOP_CHARS = new Set('的了是在和与或及等个这那我你他它们一不有无要会能可就都也还很更最把被让给对从到为以其中上下里外后前时候来去做用说看想写读跑'.split(''));
  const STOP_BIGRAMS = new Set(['的是', '一个', '可以', '用户', '使用', '时候', '需要', '已经', '这种', '如果', '因为', '所以', '没有', '什么', '怎么', '这个', '那个', '我们', '他们', '以及', '或者', '但是', '而且', '不是', '就是', '还是', '只是', '这样', '那样', '这些', '那些']);

  /** Readable shared key terms, strongest first. */
  function shared(aName, bName, limit = 6) {
    const i = index.get(aName);
    const j = index.get(bName);
    if (i === undefined || j === undefined) return [];
    const b = vectors[j];
    const scored = [];
    for (const [token, weight] of vectors[i]) {
      if (!b.has(token)) continue;
      const readable = token.replace(/^[qc]:/, '');
      if (readable.length < 2) continue;
      if (token.startsWith('c:')) {
        if (STOP_BIGRAMS.has(readable)) continue;
        if ([...readable].some((ch) => STOP_CHARS.has(ch))) continue;
      }
      scored.push({ term: readable, weight: Math.min(weight, b.get(token)) });
    }
    scored.sort((left, right) => right.weight - left.weight);
    return scored.slice(0, limit).map((entry) => entry.term);
  }

  /**
   * Similarity in 0..1. Cosine is square-rooted because raw IDF cosine
   * compresses the meaningful band (0.05–0.24) too close to zero; the name
   * bonus separates family members from unrelated skills that merely share
   * generic words.
   */
  function similarity(aName, bName) {
    const i = index.get(aName);
    const j = index.get(bName);
    if (i === undefined || j === undefined || i === j) return 0;
    const raw = Math.min(1, Math.max(0, cosine(i, j)));
    const bonus = 0.2 * nameOverlap(aName, bName);
    return Math.round(Math.min(1, Math.sqrt(raw) * (1 + bonus)) * 1000) / 1000;
  }

  return {
    size: list.length,
    similarity,
    shared,
    key: hashString(list.map((entry) => `${entry.name}\u0000${entry.description}`).join('\u0001')),
  };
}
