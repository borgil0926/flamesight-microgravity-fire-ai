import { MATERIALS, MATERIAL_BY_ID, GRAVITY_LEVELS } from '../data.js';
import { env, setEnv } from '../state.js';
import { slider, select, segmented, h } from '../ui.js';
import { predict } from '../model.js';
import { flameTemperature } from '../physics.js';

const SAMPLE_MM = 100;

export function renderFlameLab(root, models) {
  let matId = 'sibal';
  let leftG = env.gravity < 0.5 ? env.gravity : 0;
  let fansOff = false;
  const o2Init = Math.min(Math.max(env.o2, 14), 40);
  let o2 = o2Init;
  let flow = env.flow;

  root.append(h(`<div><h1>Flame Lab</h1><p class="lede">Ignite the same sample side by side in space and on Earth. Spread rate and survival come from the AI model; the visual follows what NASA cameras recorded: on Earth buoyancy pulls a tall yellow flame upward, while in microgravity the flame is a dim, blue, low dome that creeps <em>against</em> the airflow. Try “Fans off” to see the ISS fire response in action.</p></div>`));
  const grid = h('<div class="grid cols-2"></div>');
  root.append(grid);
  const ctrl = h('<section class="card"><h2>Test setup</h2></section>');
  const matSel = select({ label: 'Sample material', value: matId, options: MATERIALS.map((m) => ({ value: m.id, label: m.name })), onChange: (v) => { matId = v; reset(); } });
  const gSeg = segmented({ value: GRAVITY_LEVELS.find((g) => g.g === leftG)?.id ?? 'ug', options: GRAVITY_LEVELS.filter((g) => g.id !== 'earth').map((g) => ({ value: g.id, label: g.name.split(' (')[0] })), onChange: (v) => { leftG = GRAVITY_LEVELS.find((g) => g.id === v).g; refresh(); } });
  const sO2 = slider({ label: 'Oxygen', min: 14, max: 40, step: 0.5, value: o2, unit: '%', onInput: (v) => { o2 = v; setEnv({ habitat: 'custom', o2: v }); refresh(); } });
  const sF = slider({ label: 'Airflow (left → right)', min: 0, max: 50, step: 0.5, value: flow, unit: ' cm/s', onInput: (v) => { flow = v; fansOff = false; fanBtn.textContent = 'Fans off'; setEnv({ habitat: 'custom', flow: v }); refresh(); } });
  const igniteBtn = h('<button class="flame" type="button">🔥 Ignite both</button>');
  const fanBtn = h('<button type="button">Fans off</button>');
  const resetBtn = h('<button type="button">Reset</button>');
  const readout = h('<div class="insights" style="margin-top:14px"></div>');
  ctrl.append(matSel, h('<div class="control"><label><span>Space-side gravity</span></label></div>'), gSeg, h('<div style="height:12px"></div>'), sO2, sF, h('<div class="btn-row"></div>'));
  ctrl.lastChild.append(igniteBtn, fanBtn, resetBtn);
  ctrl.append(readout);

  const stage = h(`<section class="card"><div class="card-head"><h2>Side-by-side burn</h2><span class="muted small" id="speed"></span></div><div class="flame-stage">
    <div class="flame-pane"><canvas width="640" height="400"></canvas><div class="pane-title" id="t0"></div><div class="pane-stats"><span id="s0"></span><span class="status" id="st0"></span></div></div>
    <div class="flame-pane"><canvas width="640" height="400"></canvas><div class="pane-title" id="t1">Earth · 1 g</div><div class="pane-stats"><span id="s1"></span><span class="status" id="st1"></span></div></div>
  </div><p class="note">Sample: ${SAMPLE_MM} mm strip, ignited at the downstream (right) end. Playback is sped up so both panes share one time scale.</p></section>`);
  grid.append(ctrl, stage);

  const panes = [0, 1].map((k) => ({
    k,
    canvas: stage.querySelectorAll('canvas')[k],
    ctx: stage.querySelectorAll('canvas')[k].getContext('2d'),
    particles: [],
    state: 'idle',
    front: SAMPLE_MM,
    life: 0,
    fade: 1,
  }));

  function paneEnv(p) {
    return { o2, pressure: Math.min(Math.max(env.pressure, 50), 103), gravity: p.k === 0 ? leftG : 1, flow: p.k === 0 && fansOff ? 0 : flow };
  }

  function refresh() {
    const mat = MATERIAL_BY_ID[matId];
    for (const p of panes) {
      const e = paneEnv(p);
      const r = predict(models, mat, e);
      p.pred = r;
      p.temp = flameTemperature(mat, e);
      if (p.state === 'burning' && r.prob < 0.5) p.state = 'dying';
    }
    // Shared time scale: the faster flame crosses the sample in ~10 s of playback.
    const fastest = Math.max(...panes.map((p) => (p.pred.prob >= 0.5 ? p.pred.spread : 0)), 0.05);
    timeScale = SAMPLE_MM / (fastest * 10);
    stage.querySelector('#speed').textContent = `playback ×${timeScale >= 10 ? timeScale.toFixed(0) : timeScale.toFixed(1)}`;
    stage.querySelector('#t0').textContent = `${GRAVITY_LEVELS.find((g) => g.g === leftG)?.name ?? leftG + ' g'}${fansOff ? ' · fans OFF' : ''}`;
    const [a, b] = panes.map((p) => p.pred);
    readout.innerHTML = '';
    readout.append(h(`<div class="insight ${a.prob >= 0.5 ? 'warn' : 'ok'}"><h3>Space: ${a.prob >= 0.5 ? 'sustained flame' : 'flame cannot survive'} (${Math.round(a.prob * 100)}%)</h3><p>Spread ${a.prob >= 0.5 ? a.spread.toFixed(2) + ' mm/s' : '—'} · O₂ limit ${a.loi.toFixed(1)}% · peak ≈ ${panes[0].temp || '—'} K</p></div>`));
    readout.append(h(`<div class="insight ${b.prob >= 0.5 ? 'warn' : 'ok'}"><h3>Earth: ${b.prob >= 0.5 ? 'sustained flame' : 'flame cannot survive'} (${Math.round(b.prob * 100)}%)</h3><p>Spread ${b.prob >= 0.5 ? b.spread.toFixed(2) + ' mm/s' : '—'} · O₂ limit ${b.loi.toFixed(1)}% · peak ≈ ${panes[1].temp || '—'} K</p></div>`));
    if (a.prob >= 0.5 && b.prob < 0.5) readout.append(h('<div class="insight danger"><h3>Burns in space, not on Earth</h3><p>An Earth flammability screen would pass this material, yet it sustains a flame in this spacecraft condition.</p></div>'));
  }

  let timeScale = 1;
  function reset() {
    for (const p of panes) { p.state = 'idle'; p.front = SAMPLE_MM; p.particles = []; p.life = 0; p.fade = 1; }
    refresh();
  }
  igniteBtn.addEventListener('click', () => {
    for (const p of panes) { p.state = 'burning'; p.front = SAMPLE_MM; p.life = 0; p.fade = 1; p.particles = []; }
    refresh();
    for (const p of panes) if (p.pred.prob < 0.5) p.state = 'dying';
  });
  fanBtn.addEventListener('click', () => {
    fansOff = !fansOff;
    fanBtn.textContent = fansOff ? 'Fans on' : 'Fans off';
    refresh();
  });
  resetBtn.addEventListener('click', reset);

  // ------------------------------------------------------------------ rendering
  const W = 640, H = 400;
  const sampleY = 300, x0 = 40, x1 = 600;
  const mmToX = (mm) => x0 + (mm / SAMPLE_MM) * (x1 - x0);

  function step(p, dt) {
    const e = paneEnv(p);
    const earthLike = e.gravity;
    if (p.state === 'burning') {
      p.front = Math.max(0, p.front - p.pred.spread * dt * timeScale);
      p.life += dt;
      if (p.front <= 0) p.state = 'done';
    } else if (p.state === 'dying') {
      p.life += dt;
      p.fade = Math.max(0, p.fade - dt / 1.6);
      if (p.fade <= 0) p.state = 'out';
    }
    // Emit particles along the burning zone (front → a few mm downstream).
    const active = p.state === 'burning' || p.state === 'dying';
    if (active) {
      const zone = 6 + 10 * Math.min(1, p.pred.spread / 3);
      const n = Math.round((earthLike > 0.5 ? 22 : 14) * p.fade);
      for (let i = 0; i < n; i++) {
        const mm = p.front + Math.random() * zone;
        if (mm > SAMPLE_MM) continue;
        const g = earthLike;
        const buoy = 30 * Math.sqrt(g);
        const fl = e.flow;
        const earthP = g > 0.5;
        p.particles.push({
          x: mmToX(mm) + (Math.random() - 0.5) * (earthP ? 22 : 10),
          y: sampleY - 2,
          vx: earthP ? fl * 0.9 + (Math.random() - 0.5) * 20 : fl * 2.4 + (Math.random() - 0.5) * 40,
          vy: earthP ? -(buoy * 6 + 40 + Math.random() * 40) : -(buoy * 6 + 6 + Math.random() * 34),
          life: 0,
          max: earthP ? 0.8 + Math.random() * 0.5 : 0.6 + Math.random() * 0.5 + (fl < 3 ? 0.5 : 0),
          r: earthP ? 16 + Math.random() * 12 : 12 + Math.random() * 8,
          hot: Math.random(),
        });
      }
    }
    for (const q of p.particles) {
      q.life += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (earthLike > 0.5) { q.vy -= 220 * dt; q.vx *= 0.95; }
      else { q.vy *= 0.94; q.vx *= 0.97; }
    }
    p.particles = p.particles.filter((q) => q.life < q.max);
  }

  function draw(p) {
    const { ctx } = p;
    const e = paneEnv(p);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, W, H);
    // Flow arrows.
    if (e.flow > 0) {
      ctx.strokeStyle = 'rgba(90,176,255,0.18)';
      ctx.lineWidth = 2;
      const t = performance.now() / 1000;
      for (let row = 0; row < 4; row++) {
        const y = 80 + row * 55;
        const off = ((t * e.flow * 4) % 80);
        for (let x = -80 + off; x < W; x += 80) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.lineTo(x + 20, y - 5); ctx.moveTo(x + 26, y); ctx.lineTo(x + 20, y + 5); ctx.stroke();
        }
      }
    }
    // Sample: unburnt (left of front), charred (right of front).
    const fx = mmToX(p.front);
    ctx.fillStyle = '#c9b58f';
    ctx.fillRect(x0, sampleY, fx - x0, 8);
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(fx, sampleY, x1 - fx, 8);
    ctx.fillStyle = '#555c70';
    ctx.fillRect(x0 - 10, sampleY + 8, x1 - x0 + 20, 4);
    // Glowing pyrolysis zone.
    if (p.state === 'burning' || p.state === 'dying') {
      const grd = ctx.createLinearGradient(fx, 0, fx + 40, 0);
      grd.addColorStop(0, `rgba(255,120,40,${0.9 * p.fade})`);
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(fx, sampleY, 40, 8);
    }
    // Flame particles.
    ctx.globalCompositeOperation = 'lighter';
    const earth = e.gravity > 0.5;
    for (const q of p.particles) {
      const a = (1 - q.life / q.max) * p.fade;
      let col;
      if (earth) col = q.life < 0.12 && q.hot > 0.6 ? `rgba(110,140,255,${0.35 * a})` : `rgba(255,${120 + Math.round(100 * (1 - q.life / q.max))},40,${0.2 * a})`;
      else col = q.hot > 0.9 ? `rgba(255,170,90,${0.14 * a})` : `rgba(70,${120 + Math.round(70 * q.hot)},255,${0.22 * a})`;
      const r = q.r * (earth ? 1 - 0.4 * (q.life / q.max) : 1 + 0.6 * (q.life / q.max));
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Stats.
    const burnt = SAMPLE_MM - p.front;
    stage.querySelector(`#s${p.k}`).textContent = `${e.flow.toFixed(1)} cm/s · burnt ${burnt.toFixed(0)} mm`;
    const st = stage.querySelector(`#st${p.k}`);
    const label = { idle: 'ready', burning: 'BURNING', dying: 'extinguishing…', out: 'EXTINGUISHED', done: 'sample consumed' }[p.state];
    st.textContent = label;
    st.style.color = p.state === 'burning' ? 'var(--flame)' : p.state === 'out' ? 'var(--ok)' : 'var(--text-2)';
  }

  let raf = 0;
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const p of panes) { step(p, dt); draw(p); }
    raf = requestAnimationFrame(loop);
  }
  reset();
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
