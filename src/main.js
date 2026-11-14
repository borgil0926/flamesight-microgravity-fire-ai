import './style.css';
import { trainModels } from './model.js';
import { renderMission } from './views/mission.js';
import { renderMap } from './views/map.js';
import { renderFlameLab } from './views/flamelab.js';
import { renderDroplet } from './views/droplet.js';
import { renderModel } from './views/model.js';
import { renderExperiments } from './views/experiments.js';

const app = document.getElementById('app');
const routes = {
  mission: renderMission,
  map: renderMap,
  flame: renderFlameLab,
  droplet: renderDroplet,
  model: renderModel,
  experiments: renderExperiments,
};

let models = null;
let cleanup = null;

function route() {
  const id = (location.hash.replace('#', '') || 'mission').split('?')[0];
  const view = routes[id] ?? renderMission;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id in routes ? id : 'mission'}`));
  if (cleanup) cleanup();
  app.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'fade-in';
  app.append(root);
  cleanup = view(root, models) || null;
  window.scrollTo({ top: 0 });
}

app.innerHTML = `<div class="loading"><div><div class="loader"></div><h2>Training FlameSight AI…</h2><p class="muted small">Random Forest on 4,800 physics-informed burn tests (BASS · SoFIE · Saffire · partial-g · 1 g)</p></div></div>`;
// Let the loader paint before the (sub-second) training run.
setTimeout(() => {
  models = trainModels();
  window.addEventListener('hashchange', route);
  route();
}, 60);
