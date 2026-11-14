// Materials, habitat atmospheres, NASA experiment catalog and the physics-informed dataset.
import { burnProbability, spreadRate, flameTemperature, limitingO2 } from './physics.js';

// Typical literature values. loi1g = limiting oxygen index (%, ASTM D2863-style, 1 g);
// vref = reference opposed/concurrent spread rate (mm/s) at 21% O2, 1 atm, 30 cm/s.
export const MATERIALS = [
  { id: 'sibal', name: 'Cotton-fiberglass (SIBAL)', use: 'Saffire / BASS test fabric', thin: true, thickness: 0.3, density: 300, heatComb: 15, loi1g: 18.5, vref: 2.6 },
  { id: 'cotton', name: 'Cotton fabric', use: 'Clothing, towels', thin: true, thickness: 0.25, density: 400, heatComb: 16.5, loi1g: 18.4, vref: 3.4 },
  { id: 'paper', name: 'Paper / Kimwipes', use: 'Wipes, notes, packaging', thin: true, thickness: 0.08, density: 650, heatComb: 16, loi1g: 18.8, vref: 4.2 },
  { id: 'pmma', name: 'PMMA (acrylic)', use: 'Windows, BASS & SoFIE fuel', thin: false, thickness: 10, density: 1190, heatComb: 25, loi1g: 17.3, vref: 0.16 },
  { id: 'pe', name: 'Polyethylene', use: 'Bags, wire insulation', thin: false, thickness: 2, density: 950, heatComb: 43, loi1g: 17.4, vref: 0.22 },
  { id: 'pom', name: 'Delrin (POM)', use: 'Gears, latches', thin: false, thickness: 5, density: 1410, heatComb: 15.5, loi1g: 15.5, vref: 0.2 },
  { id: 'puf', name: 'Polyurethane foam', use: 'Padding, packing foam', thin: true, thickness: 1.5, density: 30, heatComb: 26, loi1g: 17.0, vref: 5.0 },
  { id: 'nylon', name: 'Nylon 6,6 (Velcro)', use: 'Velcro, straps', thin: true, thickness: 0.5, density: 1140, heatComb: 30, loi1g: 23.5, vref: 1.4 },
  { id: 'pc', name: 'Polycarbonate', use: 'Housings, visors', thin: false, thickness: 3, density: 1200, heatComb: 30, loi1g: 26, vref: 0.12 },
  { id: 'silicone', name: 'Silicone rubber', use: 'Seals, gaskets', thin: false, thickness: 2, density: 1150, heatComb: 15, loi1g: 28, vref: 0.1 },
  { id: 'nomex', name: 'Nomex (aramid)', use: 'Flight suits, bags', thin: true, thickness: 0.3, density: 380, heatComb: 27, loi1g: 29, vref: 0.9 },
  { id: 'kapton', name: 'Kapton (polyimide)', use: 'Wire insulation, MLI', thin: true, thickness: 0.05, density: 1420, heatComb: 25, loi1g: 37, vref: 0.8 },
];

export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

// Habitat presets. Exploration atmosphere values follow NASA's Exploration Atmospheres Working Group.
export const HABITATS = [
  { id: 'iss', name: 'ISS (sea-level air)', o2: 21, pressure: 101.3, gravity: 0, flow: 12, note: '101.3 kPa, 21% O₂, ventilation ~5–20 cm/s' },
  { id: 'orion', name: 'Orion / Gateway exploration atm.', o2: 34, pressure: 56.5, gravity: 0, flow: 12, note: '8.2 psia (56.5 kPa), 34% O₂ to shorten EVA pre-breathe' },
  { id: 'lunar', name: 'Lunar surface habitat', o2: 34, pressure: 56.5, gravity: 0.165, flow: 8, note: '1/6 g buoyancy + exploration atmosphere' },
  { id: 'mars', name: 'Mars surface habitat', o2: 26.5, pressure: 70.3, gravity: 0.38, flow: 8, note: '10.2 psia, 26.5% O₂, 0.38 g' },
  { id: 'apollo', name: 'Apollo CM in space (historic)', o2: 100, pressure: 34.5, gravity: 0, flow: 10, note: '5 psia pure O₂ (post-Apollo 1 launch atm. was 60/40 O₂/N₂)' },
];

export const GRAVITY_LEVELS = [
  { id: 'ug', name: 'Microgravity', g: 0 },
  { id: 'moon', name: 'Moon (0.165 g)', g: 0.165 },
  { id: 'mars', name: 'Mars (0.38 g)', g: 0.38 },
  { id: 'earth', name: 'Earth (1 g)', g: 1 },
];

// NASA microgravity combustion experiments this project builds on.
export const EXPERIMENTS = [
  {
    id: 'flex', name: 'FLEX / FLEX-2', full: 'Flame Extinguishment Experiment', where: 'ISS · Combustion Integrated Rack', since: 'from 2009',
    finding: 'Large n-heptane droplets kept burning after the visible flame went out, as an invisible low-temperature "cool flame". Extinction by diluents (CO₂, He) behaves differently than on Earth.',
    used: 'Droplet Lab: d²-law burning, radiative extinction and cool-flame phase.',
  },
  {
    id: 'bass', name: 'BASS / BASS-II', full: 'Burning and Suppression of Solids', where: 'ISS · Microgravity Science Glovebox', since: 'from 2011',
    finding: 'Many solids (PMMA, cotton-fiberglass, Delrin) burn in microgravity at low forced flow; flames are dim, blue and very sensitive to flow speed and O₂.',
    used: 'Flow-velocity dependence of flammability and spread rate in the training set.',
  },
  {
    id: 'saffire', name: 'Saffire I–VI', full: 'Spacecraft Fire Safety Experiment', where: 'Cygnus cargo vehicle (after leaving ISS)', since: 'from 2016',
    finding: 'First large-scale fires in spacecraft: meter-scale fabric samples burned with steady spread under ~20 cm/s flow; flame size and spread did not scale like small coupons.',
    used: 'Large-sample, ventilation-flow scenarios ("Saffire-like" campaign) in the dataset.',
  },
  {
    id: 'sofie', name: 'SoFIE', full: 'Solid Fuel Ignition and Extinction', where: 'ISS · Combustion Integrated Rack', since: 'from 2022',
    finding: 'Maps ignition, growth and extinction limits for solids across O₂, pressure and flow, including exploration-atmosphere conditions (reduced pressure, elevated O₂).',
    used: 'Pressure and elevated-O₂ ranges; exploration atmosphere risk scenarios.',
  },
  {
    id: 'acme', name: 'ACME', full: 'Advanced Combustion via Microgravity Experiments', where: 'ISS · Combustion Integrated Rack', since: 'from 2017',
    finding: 'Gaseous flames (laminar jets, soot, electric-field effects, burning-rate emulator) show how microgravity flames radiate, soot and extinguish without buoyancy.',
    used: 'Cooler, radiation-limited flame temperatures; burning-rate emulator ideas.',
  },
];

// ---------------------------------------------------------------------------------------------
// Physics-informed synthetic dataset

/** Deterministic PRNG so the dataset (and model) is identical every run. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const uni = (rng, a, b) => a + (b - a) * rng();

// Test campaigns modeled on real facilities (ranges are representative).
export const CAMPAIGNS = [
  { id: 'bass', name: 'BASS-like (ISS glovebox)', weight: 0.25, gen: (r) => ({ gravity: 0, flow: uni(r, 0, 40), o2: uni(r, 14, 26), pressure: 101.3 }) },
  { id: 'sofie', name: 'SoFIE-like (ISS CIR)', weight: 0.25, gen: (r) => ({ gravity: 0, flow: uni(r, 0, 50), o2: uni(r, 15, 40), pressure: uni(r, 50, 101.3) }) },
  { id: 'saffire', name: 'Saffire-like (Cygnus)', weight: 0.1, gen: (r) => ({ gravity: 0, flow: uni(r, 15, 25), o2: uni(r, 19, 23), pressure: uni(r, 98, 103) }) },
  { id: 'partial', name: 'Partial-g (parabolic flight)', weight: 0.15, gen: (r) => ({ gravity: r() < 0.5 ? 0.165 : 0.38, flow: uni(r, 0, 40), o2: uni(r, 15, 35), pressure: uni(r, 55, 101.3) }) },
  { id: 'earth', name: 'NASA-STD-6001 (1 g)', weight: 0.25, gen: (r) => ({ gravity: 1, flow: uni(r, 0, 40), o2: uni(r, 15, 40), pressure: uni(r, 55, 101.3) }) },
];

export const FEATURES = [
  { key: 'o2', label: 'O₂ concentration (%)' },
  { key: 'pressure', label: 'Pressure (kPa)' },
  { key: 'flow', label: 'Forced flow (cm/s)' },
  { key: 'gravity', label: 'Gravity (g)' },
  { key: 'thickness', label: 'Sample thickness (mm)' },
  { key: 'loi1g', label: 'Material LOI at 1 g (%)' },
  { key: 'density', label: 'Material density (kg/m³)' },
  { key: 'heatComb', label: 'Heat of combustion (MJ/kg)' },
  { key: 'thin', label: 'Thermally thin (0/1)' },
];

/** Build the feature vector for a material in an environment. */
export function featureVector(material, env) {
  return [
    env.o2,
    env.pressure,
    env.flow,
    env.gravity,
    env.thickness ?? material.thickness,
    material.loi1g,
    material.density,
    material.heatComb,
    material.thin ? 1 : 0,
  ];
}

/**
 * Generate burn-test records. Each record: material, campaign, environment, burned (0/1),
 * spread (mm/s) and flame temperature (K), with measurement noise.
 */
export function generateDataset(n = 4800, seed = 2026) {
  const rng = mulberry32(seed);
  const totalW = CAMPAIGNS.reduce((s, c) => s + c.weight, 0);
  const rows = [];
  for (let i = 0; i < n; i++) {
    let pick = rng() * totalW;
    let camp = CAMPAIGNS[0];
    for (const c of CAMPAIGNS) {
      pick -= c.weight;
      if (pick <= 0) { camp = c; break; }
    }
    const mat = MATERIALS[Math.floor(rng() * MATERIALS.length)];
    const env = camp.gen(rng);
    const thickness = mat.thin ? mat.thickness : mat.thickness * Math.exp(uni(rng, -0.7, 0.7));
    const e = { ...env, thickness };
    const p = burnProbability(mat, e);
    const burned = rng() < p ? 1 : 0;
    let spread = 0;
    let temp = 0;
    if (burned) {
      const base = spreadRate(mat, e);
      // Marginal flames that still burned: give them a small but non-zero rate.
      spread = Math.max(base, 0.03 * mat.vref) * Math.exp(0.15 * gauss(rng));
      temp = Math.max(flameTemperature(mat, e), 1150) + 40 * gauss(rng);
    }
    rows.push({
      material: mat.id,
      campaign: camp.id,
      ...e,
      loi: limitingO2(mat, e),
      burned,
      spread,
      temp,
    });
  }
  return rows;
}

export function rowToFeatures(row) {
  return featureVector(MATERIAL_BY_ID[row.material], row);
}

export function datasetToCsv(rows) {
  const cols = ['material', 'campaign', 'o2', 'pressure', 'flow', 'gravity', 'thickness', 'burned', 'spread', 'temp'];
  const fmt = (v) => (typeof v === 'number' ? +v.toFixed(4) : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(','))].join('\n');
}
