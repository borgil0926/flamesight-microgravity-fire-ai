import { MATERIALS, MATERIAL_BY_ID, GRAVITY_LEVELS } from '../data.js';
import { env, setEnv } from '../state.js';
import { slider, select, segmented, h, legend } from '../ui.js';
import { heatColor, lineChart } from '../charts.js';
import { predict } from '../model.js';
import { limitingO2, worstCaseFlow } from '../physics.js';

const G_COLORS = { ug: '#5ab0ff', moon: '#c58bff', mars: '#ff7a5c', earth: '#9aa6cf' };

export function renderMap(root, models) {
  let matId = 'pmma';
  root.append(h(`<div><h1>Flammability map</h1><p class="lede">Where does a material burn? Each pixel is an AI prediction for one combination of oxygen and airflow. The white line is the physics flammability boundary; the dashed line is the same boundary on Earth. In microgravity the boundary is U-shaped: too little flow starves the flame, too much blows it off, and the danger zone sits at typical ventilation speeds.</p></div>`));
  const grid = h('<div class="grid cols-2"></div>');
  root.append(grid);

  const ctrl = h('<section class="card"><h2>Scenario</h2></section>');
  const matSel = select({ label: 'Material', value: matId, options: MATERIALS.map((m) => ({ value: m.id, label: m.name })), onChange: (v) => { matId = v; draw(); } });
  const gSeg = segmented({ value: gid(env.gravity), options: GRAVITY_LEVELS.map((g) => ({ value: g.id, label: g.name.split(' (')[0] })), onChange: (v) => { setEnv({ habitat: 'custom', gravity: GRAVITY_LEVELS.find((g) => g.id === v).g }); draw(); } });
  const sP = slider({ label: 'Pressure', min: 50, max: 103, step: 0.1, value: Math.min(Math.max(env.pressure, 50), 103), unit: ' kPa', onInput: (v) => { setEnv({ habitat: 'custom', pressure: v }); draw(); } });
  const info = h('<div class="insights" style="margin-top:12px"></div>');
  ctrl.append(matSel, h('<div class="control"><label><span>Gravity</span></label></div>'), gSeg, h('<div style="height:12px"></div>'), sP, info);

  const mapCard = h(`<section class="card"><div class="card-head"><h2>AI burn probability: O₂ × airflow</h2><span class="muted small" id="sub"></span></div>
    <div class="heat-wrap"><canvas width="900" height="460" aria-label="Flammability heat map"></canvas></div>
    <div class="heat-scale"></div><div class="heat-scale-labels"><span>0% · extinguishes</span><span>50%</span><span>100% · sustained flame</span></div></section>`);
  const boundCard = h('<section class="card"><div class="card-head"><h2>Limiting O₂ across gravity levels</h2><span class="muted small">physics model</span></div><div id="lb"></div></section>');
  const spreadCard = h('<section class="card"><div class="card-head"><h2>Predicted flame spread vs airflow</h2><span class="muted small" id="ssub"></span></div><div id="sp"></div></section>');
  grid.append(ctrl, mapCard);
  const grid2 = h('<div class="grid cols-even" style="margin-top:16px"></div>');
  grid2.append(boundCard, spreadCard);
  root.append(grid2);

  function gid(g) {
    return GRAVITY_LEVELS.reduce((best, x) => (Math.abs(x.g - g) < Math.abs(best.g - g) ? x : best)).id;
  }

  function draw() {
    const mat = MATERIAL_BY_ID[matId];
    const pressure = Math.min(Math.max(env.pressure, 50), 103);
    const gravity = env.gravity;
    const base = { pressure, gravity };
    gSeg.set(gid(gravity));
    mapCard.querySelector('#sub').textContent = `${mat.name} · ${gravity} g · ${pressure} kPa`;

    // Heat map.
    const cv = mapCard.querySelector('canvas');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const m = { l: 56, r: 14, t: 12, b: 44 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const wc0 = worstCaseFlow(mat, base);
    const F = [0, 50], O = [14, Math.min(40, Math.max(30, Math.ceil(wc0.loi + 14)))];
    const nx = 100, ny = 70;
    ctx.clearRect(0, 0, W, H);
    // Render predictions into a small offscreen image, then upscale smoothly.
    const off = document.createElement('canvas');
    off.width = nx; off.height = ny;
    const octx = off.getContext('2d');
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const flow = F[0] + ((i + 0.5) / nx) * (F[1] - F[0]);
        const o2 = O[0] + ((j + 0.5) / ny) * (O[1] - O[0]);
        octx.fillStyle = heatColor(predict(models, mat, { ...base, flow, o2 }).aiProb);
        octx.fillRect(i, ny - 1 - j, 1, 1);
      }
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, m.l, m.t, pw, ph);
    const sx = (f) => m.l + ((f - F[0]) / (F[1] - F[0])) * pw;
    const sy = (o) => m.t + ph - ((o - O[0]) / (O[1] - O[0])) * ph;
    const curve = (g, dash, color, width) => {
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.rect(m.l, m.t, pw, ph);
      ctx.clip();
      ctx.beginPath();
      for (let f = 0.25; f <= 50; f += 0.25) {
        const l = limitingO2(mat, { ...base, gravity: g, flow: f });
        f === 0.25 ? ctx.moveTo(sx(f), sy(l)) : ctx.lineTo(sx(f), sy(l));
      }
      ctx.stroke();
      ctx.restore();
    };
    curve(1, [8, 6], 'rgba(255,255,255,0.55)', 2);
    curve(gravity, [], '#ffffff', 3);
    // Typical ventilation band.
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(160,210,255,0.7)';
    ctx.lineWidth = 2;
    for (const f of [5, 20]) { ctx.beginPath(); ctx.moveTo(sx(f), m.t); ctx.lineTo(sx(f), m.t + ph); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(200,225,255,0.9)';
    ctx.font = '18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('cabin fans', sx(12.5), m.t + 24);
    // Axes.
    ctx.fillStyle = '#9aa6cf';
    ctx.font = '22px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let f = 0; f <= 50; f += 10) ctx.fillText(f, sx(f), H - m.b + 24);
    ctx.fillText('Airflow (cm/s)', m.l + pw / 2, H - 4);
    ctx.textAlign = 'right';
    for (let o = 15; o <= O[1]; o += 5) ctx.fillText(o, m.l - 8, sy(o) + 7);
    ctx.save();
    ctx.translate(16, m.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('O₂ (%)', 0, 0);
    ctx.restore();
    // Current cabin marker (clamped).
    if (env.o2 <= O[1]) {
      ctx.beginPath();
      ctx.arc(sx(Math.min(env.flow, 50)), sy(Math.max(env.o2, 14)), 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#3ddc97';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#3ddc97';
      ctx.textAlign = 'left';
      ctx.fillText('cabin', sx(Math.min(env.flow, 50)) + 14, sy(Math.max(env.o2, 14)) + 7);
    }

    // Insight text.
    const wc = worstCaseFlow(mat, base);
    const earth = limitingO2(mat, { ...base, gravity: 1, flow: 0 });
    const pNow = predict(models, mat, { ...env, pressure });
    info.innerHTML = '';
    info.append(h(`<div class="insight ${wc.loi < earth ? 'warn' : 'ok'}"><h3>Worst-case airflow: ${wc.flow.toFixed(1)} cm/s</h3><p>Minimum O₂ to burn there is <b>${wc.loi.toFixed(1)}%</b>, vs ${earth.toFixed(1)}% in Earth gravity. ${wc.loi < earth ? 'This material is more flammable here than any Earth test would show.' : 'Earth screening is conservative for this case.'}</p></div>`));
    info.append(h(`<div class="insight"><h3>Your cabin: ${Math.round(pNow.prob * 100)}% burn probability</h3><p>${env.o2}% O₂ at ${env.flow} cm/s. Physics O₂ limit ${pNow.loi.toFixed(1)}%, margin ${(env.o2 - pNow.loi).toFixed(1)} points.</p></div>`));

    // Limiting O2 per gravity.
    const series = GRAVITY_LEVELS.map((g) => ({ name: g.name, color: G_COLORS[g.id], dash: g.id === 'earth' ? '6 5' : '', points: Array.from({ length: 200 }, (_, k) => { const f = 0.25 + k * 0.25; return [f, limitingO2(mat, { pressure, gravity: g.g, flow: f })]; }) }));
    const lb = boundCard.querySelector('#lb');
    lb.innerHTML = '';
    lb.append(lineChart({ series, xLabel: 'Forced airflow (cm/s)', yLabel: 'Min. O₂ to burn (%)', xMin: 0, xMax: 50, yMin: Math.floor(wc.loi - 2), yMax: Math.ceil(wc.loi + 12), bands: [{ x0: 5, x1: 20, color: '#5ab0ff', label: 'cabin fans' }] }));
    lb.append(legend(series));

    // Spread vs flow (AI).
    const o2 = Math.min(Math.max(env.o2, 14), 40);
    spreadCard.querySelector('#ssub').textContent = `${mat.name} · ${o2}% O₂ · AI regression`;
    const sseries = GRAVITY_LEVELS.map((g) => ({ name: g.name, color: G_COLORS[g.id], dash: g.id === 'earth' ? '6 5' : '', points: Array.from({ length: 51 }, (_, f) => { const p = predict(models, mat, { pressure, gravity: g.g, flow: f, o2 }); return [f, p.spread * p.aiProb]; }) }));
    const sp = spreadCard.querySelector('#sp');
    sp.innerHTML = '';
    sp.append(lineChart({ series: sseries, xLabel: 'Forced airflow (cm/s)', yLabel: 'Expected spread (mm/s)', xMin: 0, xMax: 50, yMin: 0 }));
    sp.append(legend(sseries));
  }

  draw();
}
