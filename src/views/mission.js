import { HABITATS, MATERIALS } from '../data.js';
import { env, setEnv, onEnv } from '../state.js';
import { slider, select, h, legend, pct } from '../ui.js';
import { gauge, lineChart } from '../charts.js';
import { assessInventory, cabinRisk, generateInsights } from '../insights.js';
import { predict, riskLevel } from '../model.js';

const SERIES_COLORS = ['#ff9a3c', '#5ab0ff', '#c58bff'];

export function renderMission(root, models) {
  root.append(h(`<div><h1>Mission fire risk</h1><p class="lede">Pick a spacecraft or habitat atmosphere and airflow. The AI model, trained on microgravity combustion behavior, predicts which cabin materials would keep burning, how fast flames spread, and what the crew should do about it.</p></div>`));
  const grid = h('<div class="grid cols-3"></div>');
  root.append(grid);

  // Controls
  const ctrl = h('<section class="card"><h2>Cabin environment</h2></section>');
  const habSel = select({
    label: 'Habitat preset',
    value: env.habitat,
    options: [...HABITATS.map((x) => ({ value: x.id, label: x.name })), { value: 'custom', label: 'Custom' }],
    onChange: (id) => {
      const hb = HABITATS.find((x) => x.id === id);
      if (hb) setEnv({ habitat: id, o2: hb.o2, pressure: hb.pressure, gravity: hb.gravity, flow: hb.flow });
      else setEnv({ habitat: 'custom' });
    },
  });
  const habNote = h('<p class="note"></p>');
  const custom = () => ({ habitat: 'custom' });
  const sO2 = slider({ label: 'Oxygen', min: 14, max: 100, step: 0.5, value: env.o2, unit: '%', onInput: (v) => setEnv({ ...custom(), o2: v }) });
  const sP = slider({ label: 'Cabin pressure', min: 30, max: 103, step: 0.1, value: env.pressure, unit: ' kPa', onInput: (v) => setEnv({ ...custom(), pressure: v }) });
  const sF = slider({ label: 'Ventilation flow', min: 0, max: 50, step: 0.5, value: env.flow, unit: ' cm/s', onInput: (v) => setEnv({ ...custom(), flow: v }) });
  const sG = slider({ label: 'Gravity', min: 0, max: 1, step: 0.005, value: env.gravity, unit: ' g', fmt: (v) => v.toFixed(3), onInput: (v) => setEnv({ ...custom(), gravity: v }) });
  ctrl.append(habSel, habNote, sO2, sP, sF, sG);
  ctrl.append(h('<p class="note">Tip: drag ventilation from 0 → 50 cm/s in microgravity and watch risk peak around typical fan speeds.</p>'));

  const gaugeCard = h('<section class="card"><div class="card-head"><h2>Cabin fire risk index</h2><span class="pill" id="lvl"></span></div><div class="gauge-wrap" id="gw"></div></section>');
  const insightsCard = h('<section class="card"><div class="card-head"><h2>AI safety insights</h2><span class="muted small">auto-generated</span></div><div class="insights" id="ins"></div></section>');
  grid.append(ctrl, gaugeCard, insightsCard);

  const tableCard = h(`<section class="card span-2"><div class="card-head"><h2>Material inventory</h2><span class="muted small">AI burn probability · whisker = model uncertainty</span></div>
    <div style="overflow-x:auto"><table><thead><tr><th>Material</th><th>Burn probability</th><th class="num">Spread</th><th class="num">O₂ limit</th><th>Status</th></tr></thead><tbody id="tb"></tbody></table></div></section>`);
  const sweepCard = h('<section class="card"><div class="card-head"><h2>Risk vs ventilation</h2><span class="muted small">top 3 hazards</span></div><div id="sw"></div></section>');
  const grid2 = h('<div class="grid" style="grid-template-columns:1.4fr 1fr;margin-top:16px"></div>');
  tableCard.classList.remove('span-2');
  grid2.append(tableCard, sweepCard);
  root.append(grid2);

  function update() {
    const hb = HABITATS.find((x) => x.id === env.habitat);
    habSel.set(env.habitat);
    habNote.textContent = hb ? hb.note : 'Custom atmosphere';
    sO2.set(env.o2); sP.set(env.pressure); sF.set(env.flow); sG.set(env.gravity);

    const a = assessInventory(models, env);
    const risk = cabinRisk(a);
    const lvl = riskLevel(risk);
    const lvlEl = gaugeCard.querySelector('#lvl');
    lvlEl.textContent = lvl.label;
    lvlEl.style.background = lvl.color;
    const gw = gaugeCard.querySelector('#gw');
    gw.innerHTML = '';
    gw.append(gauge(risk, { color: lvl.color, label: 'risk / 100' }));
    const burning = a.filter((x) => x.prob >= 0.5);
    const fastest = burning.length ? Math.max(...burning.map((x) => x.spread)) : 0;
    const ppO2 = (env.o2 / 100) * env.pressure;
    gw.append(h(`<div class="kpis">
      <div class="kpi"><b>${burning.length}/${a.length}</b><span>materials can burn</span></div>
      <div class="kpi"><b>${fastest.toFixed(2)}</b><span>fastest spread, mm/s</span></div>
      <div class="kpi"><b>${ppO2.toFixed(1)}</b><span>O₂ partial pressure, kPa</span></div>
      <div class="kpi"><b>${(30 * Math.sqrt(env.gravity)).toFixed(0)}</b><span>buoyant flow, cm/s</span></div>
    </div>`));

    const tb = tableCard.querySelector('#tb');
    tb.innerHTML = '';
    for (const x of a) {
      const l = riskLevel(x.prob);
      const lo = Math.max(0, x.prob - x.std);
      const hi = Math.min(1, x.prob + x.std);
      tb.append(h(`<tr>
        <td><div class="mat-name">${x.material.name}${x.material.thin ? '<span class="tag">thin</span>' : '<span class="tag">thick</span>'}</div><div class="mat-use">${x.material.use}</div></td>
        <td><div style="display:flex;align-items:center;gap:8px"><div class="mini-bar" style="flex:1"><span style="width:${x.prob * 100}%;background:${l.color}"></span><i style="left:${lo * 100}%;width:${Math.max((hi - lo) * 100, 0.6)}%"></i></div><span class="mono small" style="width:38px;text-align:right">${pct(x.prob)}</span></div></td>
        <td class="num">${x.prob >= 0.5 ? x.spread.toFixed(2) + ' mm/s' : '—'}</td>
        <td class="num">${x.loi.toFixed(1)}%</td>
        <td><span class="pill" style="background:${l.color}">${l.label}</span></td>
      </tr>`));
    }

    const ins = insightsCard.querySelector('#ins');
    ins.innerHTML = '';
    for (const i of generateInsights(models, env, a)) ins.append(h(`<div class="insight ${i.kind}"><h3>${i.title}</h3><p>${i.body}</p></div>`));

    // Sweep: burn probability vs flow for top hazards (prefer ones not already at 100% everywhere).
    const top = a.slice(0, 3).map((x) => x.material);
    const series = top.map((m, k) => ({
      name: m.name,
      color: SERIES_COLORS[k],
      points: Array.from({ length: 51 }, (_, f) => [f, predict(models, m, { ...env, flow: f }).prob * 100]),
    }));
    const sw = sweepCard.querySelector('#sw');
    sw.innerHTML = '';
    sw.append(lineChart({ series, xLabel: 'Ventilation flow (cm/s)', yLabel: 'Burn probability (%)', yMin: 0, yMax: 100, xMin: 0, xMax: 50, height: 300, bands: [{ x0: 5, x1: 20, color: '#5ab0ff', label: 'typical cabin fans' }], markers: [{ x: env.flow, label: 'now' }] }));
    sw.append(legend(series));
  }

  update();
  return onEnv(update);
}
