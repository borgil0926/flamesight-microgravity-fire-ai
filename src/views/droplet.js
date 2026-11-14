import { FUELS, dropletBurn, dropletStateAt } from '../physics.js';
import { slider, select, segmented, h, legend } from '../ui.js';
import { lineChart } from '../charts.js';

const PHASE = {
  hot: { label: 'Hot flame', color: '#5ab0ff' },
  cool: { label: 'Cool flame (invisible)', color: '#c58bff' },
  out: { label: 'Extinguished', color: '#3ddc97' },
  'no-ignition': { label: 'No ignition', color: '#9aa6cf' },
};

export function renderDroplet(root) {
  const s = { fuel: 'heptane', d0: 3.5, o2: 21, diluent: 'N2', dilPct: 0 };
  root.append(h(`<div><h1>Droplet Lab · FLEX</h1><p class="lede">In NASA's Flame Extinguishment Experiment, fuel droplets burned as perfect spheres with no buoyancy. The surprise: big n-heptane droplets kept burning after the visible flame went out, as a low-temperature <b>cool flame</b> you can't see. This reduced-order model reproduces the d²-law burn, radiative extinction and the cool-flame phase so crews and designers can see when “extinguished” isn't.</p></div>`));
  const grid = h('<div class="grid cols-3"></div>');
  root.append(grid);

  const ctrl = h('<section class="card"><h2>Droplet & atmosphere</h2></section>');
  ctrl.append(
    select({ label: 'Fuel', value: s.fuel, options: Object.entries(FUELS).map(([k, f]) => ({ value: k, label: f.name })), onChange: (v) => { s.fuel = v; plan(); } }),
    slider({ label: 'Initial diameter', min: 1, max: 5, step: 0.1, value: s.d0, unit: ' mm', fmt: (v) => v.toFixed(1), onInput: (v) => { s.d0 = v; plan(); } }),
    slider({ label: 'Oxygen', min: 10, max: 40, step: 0.5, value: s.o2, unit: '%', onInput: (v) => { s.o2 = v; plan(); } }),
    h('<div class="control"><label><span>Suppressant / diluent</span></label></div>'),
    segmented({ value: s.diluent, options: [{ value: 'N2', label: 'N₂' }, { value: 'CO2', label: 'CO₂' }, { value: 'He', label: 'He' }], onChange: (v) => { s.diluent = v; plan(); } }),
    h('<div style="height:12px"></div>'),
    slider({ label: 'Added diluent', min: 0, max: 40, step: 1, value: s.dilPct, unit: '%', onInput: (v) => { s.dilPct = v; plan(); } }),
  );
  const runBtn = h('<button class="flame" type="button">🔥 Ignite droplet</button>');
  ctrl.append(h('<div class="btn-row"></div>'));
  ctrl.lastChild.append(runBtn);
  const summary = h('<div class="insights" style="margin-top:14px"></div>');
  ctrl.append(summary);

  const viz = h('<section class="card"><div class="card-head"><h2>Burning droplet</h2><span class="mono small" id="clock"></span></div><canvas class="droplet-canvas" width="520" height="520"></canvas><div class="phase-chips" id="chips"></div></section>');
  const chart = h('<section class="card"><div class="card-head"><h2>d² history</h2><span class="muted small">diameter² vs time</span></div><div id="ch"></div><p class="note">A straight line is the classic d²-law; the slope (burning-rate constant K) drops when the hot flame dies and the cool flame takes over.</p></section>');
  grid.append(ctrl, viz, chart);

  let p = null;
  let t = 0;
  let running = false;
  let total = 1;

  function plan() {
    p = dropletBurn(s);
    total = Math.max(p.phases[p.phases.length - 1].t1, 0.001);
    t = 0;
    running = false;
    renderSummary();
    renderChart();
  }

  function renderSummary() {
    summary.innerHTML = '';
    if (!p.ignites) {
      summary.append(h('<div class="insight ok"><h3>No ignition</h3><p>Effective oxygen is too low after dilution. This diluent level would suppress a fire of this fuel.</p></div>'));
      return;
    }
    const hot = p.phases.find((x) => x.phase === 'hot');
    const cool = p.phases.find((x) => x.phase === 'cool');
    summary.append(h(`<div class="insight"><h3>Hot flame: ${hot.t1.toFixed(1)} s, K = ${p.kHot.toFixed(2)} mm²/s</h3><p>${s.d0 > p.dcrit ? `Droplet is larger than the ${p.dcrit.toFixed(1)} mm radiative limit, so the hot flame dies early at ${hot.d1.toFixed(2)} mm.` : 'Small enough to burn almost to completion.'}</p></div>`));
    if (cool) summary.append(h(`<div class="insight danger"><h3>Cool flame keeps going for ${(cool.t1 - cool.t0).toFixed(1)} s</h3><p>Invisible to the eye and cameras, still consuming fuel and making CO and aldehydes, until ${cool.d1.toFixed(2)} mm. Don't treat this as extinguished.</p></div>`));
    if (p.residual > 0.3) summary.append(h(`<div class="insight warn"><h3>Unburned fuel left: ${p.residual.toFixed(2)} mm droplet</h3><p>A vapor source that could re-ignite. Ventilate and capture before re-entry into the area.</p></div>`));
  }

  function renderChart(upTo = null) {
    const pts = [];
    const end = total * 1.05;
    for (let k = 0; k <= 200; k++) {
      const tt = (k / 200) * end;
      pts.push([tt, dropletStateAt(p, tt).d ** 2, dropletStateAt(p, tt).phase]);
    }
    const series = ['hot', 'cool', 'out', 'no-ignition'].map((ph) => ({ name: PHASE[ph].label, color: PHASE[ph].color, points: pts.filter((q) => q[2] === ph).map((q) => [q[0], q[1]]) })).filter((x) => x.points.length > 1);
    const el = chart.querySelector('#ch');
    el.innerHTML = '';
    el.append(lineChart({ series, xLabel: 'Time (s)', yLabel: 'd² (mm²)', xMin: 0, xMax: end, yMin: 0, yMax: s.d0 * s.d0 * 1.05, markers: upTo != null ? [{ x: upTo, label: '' }] : [] }));
    el.append(legend(series));
  }

  runBtn.addEventListener('click', () => { t = 0; running = true; });

  const cv = viz.querySelector('canvas');
  const ctx = cv.getContext('2d');
  let raf = 0;
  let last = performance.now();
  let chartTick = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // Play the whole burn in ~10 s.
    if (running) {
      t += dt * (total / 10);
      if (t > total * 1.05) running = false;
      chartTick += dt;
      if (chartTick > 0.2) { chartTick = 0; renderChart(t); }
    }
    const st = running || t > 0 ? dropletStateAt(p, t) : { d: s.d0, phase: 'idle' };
    drawDroplet(ctx, st, now / 1000);
    viz.querySelector('#clock').textContent = `t = ${t.toFixed(1)} s · d = ${st.d.toFixed(2)} mm`;
    const chips = viz.querySelector('#chips');
    chips.innerHTML = ['hot', 'cool', 'out'].map((ph) => `<span class="chip ${st.phase === ph ? 'on' : ''}" style="${st.phase === ph ? `background:${PHASE[ph].color}` : ''}">${PHASE[ph].label}</span>`).join('');
    raf = requestAnimationFrame(loop);
  }

  function drawDroplet(c, st, time) {
    const W = 520, cx = W / 2, cy = W / 2;
    c.fillStyle = '#03050c';
    c.fillRect(0, 0, W, W);
    const scale = 30; // px per mm
    const rd = (st.d / 2) * scale;
    // Support fiber (FLEX used tethers / free-floating droplets).
    c.strokeStyle = 'rgba(160,170,200,0.25)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, cy); c.lineTo(W, cy); c.stroke();
    if (st.phase === 'hot') {
      const rf = rd * 4.5 + 6 * Math.sin(time * 9) * 0.3;
      const g = c.createRadialGradient(cx, cy, rf * 0.75, cx, cy, rf * 1.12);
      g.addColorStop(0, 'rgba(40,80,255,0)');
      g.addColorStop(0.55, 'rgba(90,160,255,0.85)');
      g.addColorStop(0.75, 'rgba(255,170,80,0.35)');
      g.addColorStop(1, 'rgba(40,80,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, cy, rf * 1.15, 0, Math.PI * 2); c.fill();
    } else if (st.phase === 'cool') {
      const rf = rd * 2.6;
      const g = c.createRadialGradient(cx, cy, rf * 0.6, cx, cy, rf * 1.1);
      g.addColorStop(0, 'rgba(197,139,255,0)');
      g.addColorStop(0.7, `rgba(197,139,255,${0.16 + 0.05 * Math.sin(time * 4)})`);
      g.addColorStop(1, 'rgba(197,139,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, cy, rf * 1.1, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(197,139,255,0.8)';
      c.font = '14px Inter, sans-serif';
      c.textAlign = 'center';
      c.fillText('cool flame: shown enhanced, invisible to the eye', cx, W - 24);
    }
    // Droplet.
    const dg = c.createRadialGradient(cx - rd * 0.3, cy - rd * 0.3, rd * 0.1, cx, cy, rd);
    dg.addColorStop(0, '#f4f7ff');
    dg.addColorStop(1, '#7e8db8');
    c.fillStyle = dg;
    c.beginPath(); c.arc(cx, cy, Math.max(rd, 1), 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9aa6cf';
    c.font = '13px Inter, sans-serif';
    c.textAlign = 'left';
    c.fillText(`${FUELS[s.fuel].name} · ${s.o2}% O₂${s.dilPct ? ` · +${s.dilPct}% ${s.diluent}` : ''}`, 16, 26);
  }

  plan();
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
