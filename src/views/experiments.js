import { EXPERIMENTS } from '../data.js';
import { h } from '../ui.js';

export function renderExperiments(root) {
  root.append(h(`<div><h1>NASA microgravity combustion data</h1><p class="lede">FlameSight is built on two decades of NASA fire research on the International Space Station and on Cygnus cargo vehicles. Each experiment below shaped part of the model or the app.</p></div>`));
  const grid = h('<div class="exp-grid"></div>');
  for (const e of EXPERIMENTS) {
    grid.append(h(`<article class="card exp"><h2>${e.name}</h2><div class="meta">${e.full} · ${e.where} · ${e.since}</div><p>${e.finding}</p><div class="used"><b>In FlameSight:</b> ${e.used}</div></article>`));
  }
  root.append(grid);

  root.append(h(`<section class="card" style="margin-top:16px"><h2>Why this matters</h2>
    <div class="grid cols-even" style="gap:24px">
      <div><h3>The problem</h3><p class="muted small">Spacecraft materials are screened on Earth (NASA-STD-6001 Test 1: upward burning in 1 g). But without buoyancy, flames are fed only by ventilation and diffusion. At the low airflows found in cabins, some materials burn at lower oxygen levels than in any Earth test, and future habitats plan richer, lower-pressure atmospheres. There is no fire department in orbit, and a crew may have minutes to react.</p></div>
      <div><h3>The approach</h3><p class="muted small">Learn the flammability boundary across O₂, pressure, airflow and gravity from microgravity-style burn data, then turn it into decisions: which items to stow or replace, which airflow is most dangerous, whether shutting off fans will put a fire out, how far to lower O₂, and where the model is uncertain enough that a new ISS test is worth flying.</p></div>
    </div></section>`));

  root.append(h(`<section class="card" style="margin-top:16px"><h2>Open data sources</h2>
    <ul class="muted small" style="margin:0;padding-left:18px;line-height:1.9">
      <li><a href="https://psi.nasa.gov" target="_blank" rel="noopener">NASA Physical Sciences Informatics (PSI)</a>: raw and processed data from ISS combustion experiments (FLEX, BASS, ACME, SoFIE and others).</li>
      <li><a href="https://www.nasa.gov/mission/station/research-explorer/" target="_blank" rel="noopener">ISS Research Explorer</a>: experiment descriptions, publications and results.</li>
      <li><a href="https://ntrs.nasa.gov" target="_blank" rel="noopener">NASA Technical Reports Server</a>: Saffire, BASS and spacecraft fire safety papers.</li>
    </ul>
    <p class="note">The bundled dataset is physics-informed and synthetic so the app runs offline; to use real PSI-derived measurements, feed rows with the same columns into <code>trainModels</code> (see README).</p></section>`));
}
