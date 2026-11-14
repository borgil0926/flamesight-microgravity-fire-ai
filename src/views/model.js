import { CAMPAIGNS, datasetToCsv } from '../data.js';
import { h, legend } from '../ui.js';
import { barList, lineChart, el } from '../charts.js';

export function renderModel(root, models) {
  const m = models.metrics;
  const rows = models.rows;
  root.append(h(`<div><h1>AI model</h1><p class="lede">FlameSight trains a Random Forest (40 trees, written from scratch in JavaScript) directly in your browser in ${(m.trainMs / 1000).toFixed(2)} s. Inputs are the environment (O₂, pressure, airflow, gravity) plus material descriptors, so it can score materials it has never seen. A second forest predicts flame spread rate. Tree-to-tree disagreement gives an uncertainty for every prediction.</p></div>`));

  const kpis = h(`<div class="kpis" style="margin-bottom:16px">
    <div class="kpi"><b>${(m.accuracy * 100).toFixed(1)}%</b><span>burn / no-burn accuracy (held-out)</span></div>
    <div class="kpi"><b>${m.auc.toFixed(3)}</b><span>ROC AUC</span></div>
    <div class="kpi"><b>${m.spreadR2.toFixed(3)}</b><span>spread-rate R² (log scale)</span></div>
    <div class="kpi"><b>${m.spreadRmse.toFixed(2)}</b><span>spread RMSE, mm/s</span></div>
    <div class="kpi"><b>${rows.length.toLocaleString()}</b><span>burn tests (${m.nTrain} train / ${m.nTest} test)</span></div>
    <div class="kpi"><b>${(avg(m.lomo.map((x) => x.accuracy)) * 100).toFixed(1)}%</b><span>accuracy on unseen materials</span></div>
  </div>`);
  root.append(kpis);

  const grid = h('<div class="grid cols-even"></div>');
  root.append(grid);

  const imp = h('<section class="card"><div class="card-head"><h2>What drives flammability?</h2><span class="muted small">impurity-based feature importance</span></div></section>');
  imp.append(barList(m.importance.map((f) => ({ label: f.label, value: f.value, text: (f.value * 100).toFixed(1) + '%', color: 'linear-gradient(90deg,#5ab0ff,#8d7dff)' })), { max: m.importance[0].value }));
  imp.append(h('<p class="note">O₂ level and the material\'s own flammability dominate; airflow and gravity matter because they set the transport of oxygen to the flame, the core microgravity effect.</p>'));

  const rocCard = h('<section class="card"><div class="card-head"><h2>ROC curve & confusion matrix</h2><span class="muted small">held-out 20%</span></div><div class="grid" style="grid-template-columns:1.3fr 1fr;align-items:center"><div id="roc"></div><div id="cm"></div></div></section>');
  rocCard.querySelector('#roc').append(lineChart({ series: [{ name: 'diag', color: 'rgba(154,166,207,0.4)', dash: '4 4', points: [[0, 0], [1, 1]] }, { name: 'ROC', color: '#ff9a3c', points: m.roc }], xLabel: 'False positive rate', yLabel: 'True positive rate', xMin: 0, xMax: 1, yMin: 0, yMax: 1, height: 240, width: 360 }));
  const c = m.confusion;
  rocCard.querySelector('#cm').append(h(`<div class="confusion">
    <div class="h"></div><div class="h">pred. burns</div><div class="h">pred. out</div>
    <div class="h">burned</div><div style="background:rgba(61,220,151,.2)">${c.tp}</div><div style="background:rgba(255,90,106,.25)" title="missed fires">${c.fn}</div>
    <div class="h">went out</div><div style="background:rgba(255,159,67,.18)">${c.fp}</div><div style="background:rgba(61,220,151,.2)">${c.tn}</div>
  </div><p class="note">Bottom-left = false alarms; top-right = missed fires (the costly error). Physics-only baseline accuracy: ${(m.physicsAccuracy * 100).toFixed(1)}%, the AI learns the same boundary from data alone.</p>`));

  const lomo = h('<section class="card"><div class="card-head"><h2>Generalization to unseen materials</h2><span class="muted small">leave-one-material-out</span></div></section>');
  lomo.append(barList(m.lomo.map((x) => ({ label: x.material.name, value: x.accuracy, text: (x.accuracy * 100).toFixed(0) + '%', color: x.accuracy > 0.85 ? 'var(--ok)' : x.accuracy > 0.7 ? 'var(--caution)' : 'var(--warn)' }))));
  lomo.append(h('<p class="note">Each bar is a model trained without that material at all. Lower scores mark materials whose properties sit at the edge of the training set; that is exactly where a new microgravity test would add the most information.</p>'));

  const sc = h('<section class="card"><div class="card-head"><h2>Spread rate: predicted vs measured</h2><span class="muted small">held-out burning samples</span></div><div id="sc"></div></section>');
  sc.querySelector('#sc').append(scatter(m.spreadPairs));
  sc.append(legend([{ name: 'microgravity', color: '#5ab0ff' }, { name: 'partial g', color: '#c58bff' }, { name: 'Earth 1 g', color: '#9aa6cf' }]));

  const ds = h('<section class="card span-2"><div class="card-head"><h2>Training data</h2><button type="button" class="primary" id="dl">Download CSV</button></div><div style="overflow-x:auto"><table><thead><tr><th>Campaign (analog of)</th><th class="num">Tests</th><th class="num">Burned</th><th>Conditions</th></tr></thead><tbody id="cb"></tbody></table></div><p class="note">Physics-informed synthetic tests: a reduced-order flammability model calibrated to trends reported by NASA microgravity experiments, with measurement noise. Real NASA PSI measurements with the same columns can replace it (see README).</p></section>');
  const desc = { bass: 'μg, 0–40 cm/s, 14–26% O₂, 1 atm', sofie: 'μg, 0–50 cm/s, 15–40% O₂, 50–101 kPa', saffire: 'μg, 15–25 cm/s, ~21% O₂, large samples', partial: 'Moon / Mars g, 0–40 cm/s, 15–35% O₂', earth: '1 g, upward burning, 15–40% O₂' };
  const cb = ds.querySelector('#cb');
  for (const cp of CAMPAIGNS) {
    const r = rows.filter((x) => x.campaign === cp.id);
    cb.append(h(`<tr><td>${cp.name}</td><td class="num">${r.length}</td><td class="num">${Math.round((r.filter((x) => x.burned).length / r.length) * 100)}%</td><td class="muted">${desc[cp.id]}</td></tr>`));
  }
  ds.querySelector('#dl').addEventListener('click', () => {
    const blob = new Blob([datasetToCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flamesight_burn_tests.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  grid.append(imp, rocCard, lomo, sc, ds);
}

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;

function scatter(pairs) {
  const W = 520, H = 260, m = { l: 48, r: 12, t: 10, b: 38 };
  const max = Math.max(...pairs.flatMap((p) => [p[0], p[1]])) * 1.05;
  const lg = (v) => Math.log10(v + 0.01);
  const lo = lg(0), hi = lg(max);
  const sx = (v) => m.l + ((lg(v) - lo) / (hi - lo)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((lg(v) - lo) / (hi - lo)) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  svg.append(el('line', { x1: sx(0), y1: sy(0), x2: sx(max), y2: sy(max), stroke: 'rgba(154,166,207,0.4)', 'stroke-dasharray': '4 4' }));
  for (const t of [0.1, 1, 10]) {
    if (t > max) continue;
    svg.append(el('text', { x: sx(t), y: H - m.b + 16, class: 'tick', 'text-anchor': 'middle' }, String(t)));
    svg.append(el('text', { x: m.l - 6, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, String(t)));
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: 'grid' }));
  }
  for (const [t, p, g] of pairs) {
    const col = g === 0 ? '#5ab0ff' : g < 0.5 ? '#c58bff' : '#9aa6cf';
    svg.append(el('circle', { cx: sx(t), cy: sy(p), r: 2.6, fill: col, opacity: 0.6 }));
  }
  svg.append(el('text', { x: (W + m.l) / 2, y: H - 4, class: 'axis-label', 'text-anchor': 'middle' }, 'Measured spread (mm/s, log)'));
  svg.append(el('text', { x: 12, y: H / 2, class: 'axis-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${H / 2})` }, 'Predicted (mm/s, log)'));
  return svg;
}
