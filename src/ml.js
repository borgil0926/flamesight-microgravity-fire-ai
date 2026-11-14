// A small, dependency-free Random Forest (CART, histogram splits) that trains in the browser.
// Binary classification is handled as regression on {0,1}: variance reduction equals Gini/2,
// and leaf means are calibrated probabilities.
import { mulberry32 } from './data.js';

function quantileThresholds(values, bins) {
  const sorted = Float64Array.from(values).sort();
  const out = [];
  for (let b = 1; b < bins; b++) {
    const v = sorted[Math.floor((b / bins) * (sorted.length - 1))];
    if (out.length === 0 || v > out[out.length - 1]) out.push(v);
  }
  return out;
}

function binOf(thresholds, v) {
  // number of thresholds strictly below or equal: bin index in [0, thresholds.length]
  let lo = 0;
  let hi = thresholds.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v > thresholds[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class RandomForest {
  constructor({ nTrees = 40, maxDepth = 10, minLeaf = 3, mtry = null, bins = 64, seed = 7, sampleFrac = 1 } = {}) {
    Object.assign(this, { nTrees, maxDepth, minLeaf, mtry, bins, seed, sampleFrac });
    this.trees = [];
  }

  fit(X, y) {
    const n = X.length;
    const f = X[0].length;
    this.nFeatures = f;
    const mtry = this.mtry ?? Math.max(1, Math.round(Math.sqrt(f) + 1));
    this.thresholds = [];
    for (let j = 0; j < f; j++) this.thresholds.push(quantileThresholds(X.map((r) => r[j]), this.bins));
    // Pre-bin the data once.
    const Xb = new Uint8Array(n * f);
    for (let i = 0; i < n; i++) for (let j = 0; j < f; j++) Xb[i * f + j] = binOf(this.thresholds[j], X[i][j]);
    const Y = Float64Array.from(y);
    const rng = mulberry32(this.seed);
    this.importance = new Float64Array(f);
    this.trees = [];
    const m = Math.max(1, Math.round(n * this.sampleFrac));
    for (let t = 0; t < this.nTrees; t++) {
      const idx = new Uint32Array(m);
      for (let i = 0; i < m; i++) idx[i] = Math.floor(rng() * n);
      this.trees.push(this._grow(Xb, Y, f, idx, 0, mtry, rng));
    }
    const tot = this.importance.reduce((a, b) => a + b, 0) || 1;
    this.importance = Array.from(this.importance, (v) => v / tot);
    return this;
  }

  _grow(Xb, Y, f, idx, depth, mtry, rng) {
    const n = idx.length;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = Y[idx[i]];
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    const sse = sq - (sum * sum) / n;
    if (depth >= this.maxDepth || n < 2 * this.minLeaf || sse < 1e-9) return { v: mean, n };

    // Random feature subset.
    const feats = [];
    const pool = Array.from({ length: f }, (_, j) => j);
    for (let k = 0; k < mtry && pool.length; k++) feats.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);

    let best = null;
    const nb = this.bins + 1;
    const cnt = new Float64Array(nb);
    const s1 = new Float64Array(nb);
    const s2 = new Float64Array(nb);
    for (const j of feats) {
      cnt.fill(0); s1.fill(0); s2.fill(0);
      for (let i = 0; i < n; i++) {
        const r = idx[i];
        const b = Xb[r * f + j];
        const v = Y[r];
        cnt[b]++; s1[b] += v; s2[b] += v * v;
      }
      let cl = 0, l1 = 0, l2 = 0;
      const maxB = this.thresholds[j].length;
      for (let b = 0; b < maxB; b++) {
        cl += cnt[b]; l1 += s1[b]; l2 += s2[b];
        const cr = n - cl;
        if (cl < this.minLeaf || cr < this.minLeaf) continue;
        const r1 = sum - l1;
        const r2 = sq - l2;
        const child = (l2 - (l1 * l1) / cl) + (r2 - (r1 * r1) / cr);
        const gain = sse - child;
        if (gain > 1e-12 && (!best || gain > best.gain)) best = { j, b, gain };
      }
    }
    if (!best) return { v: mean, n };
    this.importance[best.j] += best.gain;
    let nl = 0;
    for (let i = 0; i < n; i++) if (Xb[idx[i] * f + best.j] <= best.b) nl++;
    const L = new Uint32Array(nl);
    const R = new Uint32Array(n - nl);
    let li = 0, ri = 0;
    for (let i = 0; i < n; i++) {
      const r = idx[i];
      if (Xb[r * f + best.j] <= best.b) L[li++] = r;
      else R[ri++] = r;
    }
    return {
      j: best.j,
      thr: this.thresholds[best.j][best.b],
      l: this._grow(Xb, Y, f, L, depth + 1, mtry, rng),
      r: this._grow(Xb, Y, f, R, depth + 1, mtry, rng),
    };
  }

  static _walk(node, x) {
    while (node.l) node = x[node.j] <= node.thr ? node.l : node.r;
    return node.v;
  }

  /** Per-tree predictions for a single sample. */
  treePredictions(x) {
    return this.trees.map((t) => RandomForest._walk(t, x));
  }

  predict(x) {
    const p = this.treePredictions(x);
    return p.reduce((a, b) => a + b, 0) / p.length;
  }

  /** Mean and spread across trees: a cheap epistemic-uncertainty estimate. */
  predictWithUncertainty(x) {
    const p = this.treePredictions(x);
    const mean = p.reduce((a, b) => a + b, 0) / p.length;
    const variance = p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length;
    return { mean, std: Math.sqrt(variance) };
  }
}

// ---------------------------------------------------------------------------------------------
// Metrics

export function accuracy(yTrue, prob, thr = 0.5) {
  let ok = 0;
  for (let i = 0; i < yTrue.length; i++) if ((prob[i] >= thr ? 1 : 0) === yTrue[i]) ok++;
  return ok / yTrue.length;
}

export function confusion(yTrue, prob, thr = 0.5) {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (let i = 0; i < yTrue.length; i++) {
    const p = prob[i] >= thr ? 1 : 0;
    if (p && yTrue[i]) c.tp++;
    else if (p && !yTrue[i]) c.fp++;
    else if (!p && !yTrue[i]) c.tn++;
    else c.fn++;
  }
  return c;
}

/** ROC curve points and AUC (trapezoid). */
export function roc(yTrue, prob) {
  const order = prob.map((p, i) => [p, yTrue[i]]).sort((a, b) => b[0] - a[0]);
  const P = yTrue.filter((v) => v).length;
  const N = yTrue.length - P;
  let tp = 0, fp = 0;
  const pts = [[0, 0]];
  let auc = 0;
  let prevFpr = 0, prevTpr = 0;
  for (let i = 0; i < order.length; i++) {
    if (order[i][1]) tp++;
    else fp++;
    if (i === order.length - 1 || order[i + 1][0] !== order[i][0]) {
      const fpr = fp / (N || 1);
      const tpr = tp / (P || 1);
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
      pts.push([fpr, tpr]);
      prevFpr = fpr;
      prevTpr = tpr;
    }
  }
  return { points: pts, auc };
}

export function r2(yTrue, yPred) {
  const mean = yTrue.reduce((a, b) => a + b, 0) / yTrue.length;
  let ssr = 0, sst = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssr += (yTrue[i] - yPred[i]) ** 2;
    sst += (yTrue[i] - mean) ** 2;
  }
  return 1 - ssr / (sst || 1);
}

export function rmse(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) s += (yTrue[i] - yPred[i]) ** 2;
  return Math.sqrt(s / yTrue.length);
}

/** Deterministic shuffled train/test split of indices. */
export function trainTestSplit(n, testFrac = 0.2, seed = 11) {
  const rng = mulberry32(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const nt = Math.round(n * testFrac);
  return { test: idx.slice(0, nt), train: idx.slice(nt) };
}
