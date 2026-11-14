// Tiny SVG/canvas chart helpers (no dependencies). Colors come from CSS custom properties.

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of [].concat(children)) if (c != null) n.append(c);
  return n;
}

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : +v.toFixed(2) + '');

/**
 * Multi-series line chart.
 * series: [{ name, color, points: [[x,y],...], dash?, width? }]
 */
export function lineChart({ series, width = 560, height = 260, xLabel = '', yLabel = '', xMin, xMax, yMin, yMax, markers = [], bands = [] }) {
  const m = { l: 48, r: 14, t: 12, b: 38 };
  const all = series.flatMap((s) => s.points);
  const x0 = xMin ?? Math.min(...all.map((p) => p[0]));
  const x1 = xMax ?? Math.max(...all.map((p) => p[0]));
  const y0 = yMin ?? Math.min(0, ...all.map((p) => p[1]));
  const y1 = yMax ?? (Math.max(...all.map((p) => p[1])) * 1.08 || 1);
  const W = width - m.l - m.r;
  const H = height - m.t - m.b;
  const sx = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = (y) => m.t + H - ((Math.min(Math.max(y, y0), y1) - y0) / (y1 - y0 || 1)) * H;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' });

  for (const b of bands) {
    svg.append(el('rect', { x: sx(b.x0), y: m.t, width: Math.max(sx(b.x1) - sx(b.x0), 0), height: H, fill: b.color, opacity: b.opacity ?? 0.12 }));
    if (b.label) svg.append(el('text', { x: (sx(b.x0) + sx(b.x1)) / 2, y: m.t + 12, class: 'band-label', 'text-anchor': 'middle' }, b.label));
  }
  for (const t of niceTicks(y0, y1)) {
    svg.append(el('line', { x1: m.l, x2: m.l + W, y1: sy(t), y2: sy(t), class: 'grid' }));
    svg.append(el('text', { x: m.l - 6, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmt(t)));
  }
  for (const t of niceTicks(x0, x1, 6)) {
    svg.append(el('text', { x: sx(t), y: m.t + H + 16, class: 'tick', 'text-anchor': 'middle' }, fmt(t)));
  }
  svg.append(el('line', { x1: m.l, x2: m.l + W, y1: m.t + H, y2: m.t + H, class: 'axis' }));
  svg.append(el('text', { x: m.l + W / 2, y: height - 4, class: 'axis-label', 'text-anchor': 'middle' }, xLabel));
  svg.append(el('text', { x: 12, y: m.t + H / 2, class: 'axis-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + H / 2})` }, yLabel));

  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    svg.append(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 2.2, 'stroke-dasharray': s.dash ?? '', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  for (const mk of markers) {
    svg.append(el('line', { x1: sx(mk.x), x2: sx(mk.x), y1: m.t, y2: m.t + H, stroke: mk.color ?? 'var(--text-2)', 'stroke-dasharray': '4 4', 'stroke-width': 1.2 }));
    if (mk.label) svg.append(el('text', { x: sx(mk.x) + 4, y: m.t + H - 8, class: 'marker-label' }, mk.label));
  }
  return svg;
}

/** Horizontal bar list. items: [{ label, value, color, text }] values in [0, max]. */
export function barList(items, { max = 1 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'bars';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `<span class="bar-label">${it.label}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(1, it.value / max)) * 100}%;background:${it.color ?? 'var(--accent)'}"></span></span><span class="bar-val">${it.text ?? it.value.toFixed(2)}</span>`;
    wrap.append(row);
  }
  return wrap;
}

/** Map a probability 0..1 to a heat color (deep blue → violet → amber → red-orange). */
export function heatColor(p) {
  const stops = [
    [0, [14, 22, 48]],
    [0.35, [52, 58, 140]],
    [0.5, [140, 70, 170]],
    [0.7, [235, 120, 60]],
    [1, [255, 214, 120]],
  ];
  const v = Math.min(Math.max(p, 0), 1);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`;
    }
  }
  return 'rgb(255,214,120)';
}

/** Ring gauge for a 0..1 value. */
export function gauge(value, { size = 180, color = 'var(--accent)', label = '' } = {}) {
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const frac = Math.min(Math.max(value, 0), 1) * 0.75;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'gauge', width: size, height: size });
  const rot = `rotate(135 ${size / 2} ${size / 2})`;
  svg.append(el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': 12, 'stroke-dasharray': `${c * 0.75} ${c}`, transform: rot, 'stroke-linecap': 'round' }));
  svg.append(el('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': 12, 'stroke-dasharray': `${c * frac} ${c}`, transform: rot, 'stroke-linecap': 'round', class: 'gauge-fill' }));
  svg.append(el('text', { x: size / 2, y: size / 2 + 6, 'text-anchor': 'middle', class: 'gauge-value' }, `${Math.round(value * 100)}`));
  svg.append(el('text', { x: size / 2, y: size / 2 + 28, 'text-anchor': 'middle', class: 'gauge-label' }, label));
  return svg;
}
