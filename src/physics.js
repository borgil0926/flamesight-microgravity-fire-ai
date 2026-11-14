// Reduced-order combustion physics used to (1) generate the physics-informed training set
// and (2) draw the "physics boundary" next to the AI prediction.
//
// The shapes follow trends reported by NASA microgravity combustion research:
//  - Solid-fuel flammability in microgravity is U-shaped in flow velocity: flames quench
//    at very low flow (oxygen transport / radiative loss) and blow off at high flow.
//    The most flammable condition sits at a few to ~10 cm/s, i.e. typical spacecraft
//    ventilation, and can be MORE flammable than Earth's buoyant flow (BASS, SoFIE, T'ien maps).
//  - Partial gravity (Moon, Mars) produces buoyant flows close to that worst case.
//  - Exploration atmospheres (lower pressure, higher O2 fraction) raise flammability.
//  - Liquid droplets follow the d^2 law; large n-alkane droplets show radiative extinction
//    followed by low-temperature "cool flame" burning (FLEX discovery).
// Numbers are calibrated to be realistic in magnitude, not to reproduce any single test.

/** Buoyancy-induced flow speed near a flame, cm/s, for gravity in Earth-g units. */
export function buoyantVelocity(g) {
  return 30 * Math.sqrt(Math.max(g, 0));
}

/** Combined forced + buoyant flow the flame "sees", cm/s. */
export function effectiveVelocity(flow, g) {
  const ub = buoyantVelocity(g);
  return Math.sqrt(flow * flow + ub * ub);
}

const QUENCH_A = 4;
const BLOWOFF_B = 20;
const BLOWOFF_U = 150;

function flowShape(ue, thin) {
  const uq = thin ? 1.5 : 3.0;
  const u = Math.max(ue, 0.05);
  return QUENCH_A * Math.pow(uq / u, 1.5) + BLOWOFF_B * Math.pow(u / BLOWOFF_U, 1.3);
}

/**
 * Limiting oxygen concentration (% by volume) below which the material will not sustain a flame
 * for the given environment.
 */
export function limitingO2(material, env) {
  const { flow = 0, gravity = 0, pressure = 101.3 } = env;
  const thickness = env.thickness ?? material.thickness;
  const ue = effectiveVelocity(flow, gravity);
  // Anchor: at Earth buoyant flow (30 cm/s) the curve passes through the 1 g LOI.
  const base = material.loi1g - flowShape(30, material.thin);
  let loi = base + flowShape(ue, material.thin);
  if (!material.thin) loi += 1.2 * Math.log10(Math.max(thickness, 0.05) / material.thickness);
  loi *= Math.pow(101.3 / Math.max(pressure, 10), 0.12);
  return loi;
}

/** O2 margin above the limit (percentage points). Positive means the flame can survive. */
export function burnMargin(material, env) {
  return env.o2 - limitingO2(material, env);
}

/** Smooth probability that a flame is sustained, from the physics margin. */
export function burnProbability(material, env) {
  const m = burnMargin(material, env);
  return 1 / (1 + Math.exp(-m / 0.7));
}

/** Flame spread rate in mm/s (0 if the flame cannot be sustained). */
export function spreadRate(material, env) {
  const m = burnMargin(material, env);
  if (m <= 0) return 0;
  const { flow = 0, gravity = 0, pressure = 101.3, o2 } = env;
  const ue = effectiveVelocity(flow, gravity);
  const flowFactor = (ue / (ue + 8)) * Math.exp(-ue / 400) / ((30 / 38) * Math.exp(-30 / 400));
  return (
    material.vref *
    Math.pow(o2 / 21, 1.8) *
    Math.pow(pressure / 101.3, 0.5) *
    flowFactor *
    (1 - Math.exp(-m / 1.2))
  );
}

/** Rough peak flame temperature (K). Microgravity flames run cooler and closer to extinction. */
export function flameTemperature(material, env) {
  const m = burnMargin(material, env);
  if (m <= 0) return 0;
  const ue = effectiveVelocity(env.flow ?? 0, env.gravity ?? 0);
  return Math.round(1250 + 900 * (1 - Math.exp(-m / 6)) - 200 * (1 - ue / (ue + 10)));
}

/** Flow velocity (cm/s) at which the limiting O2 is lowest, i.e. the most flammable flow. */
export function worstCaseFlow(material, env, maxFlow = 60) {
  let best = 0;
  let bestLoi = Infinity;
  for (let f = 0; f <= maxFlow; f += 0.25) {
    const l = limitingO2(material, { ...env, flow: f });
    if (l < bestLoi) {
      bestLoi = l;
      best = f;
    }
  }
  return { flow: best, loi: bestLoi };
}

// ---------------------------------------------------------------------------------------------
// Droplet combustion (FLEX-inspired)

export const FUELS = {
  heptane: { name: 'n-Heptane', k0: 0.65, coolFlame: true, dcrit: 2.8 },
  decane: { name: 'n-Decane', k0: 0.55, coolFlame: true, dcrit: 3.2 },
  methanol: { name: 'Methanol', k0: 0.5, coolFlame: false, dcrit: 4.5 },
  ethanol: { name: 'Ethanol', k0: 0.55, coolFlame: false, dcrit: 4.0 },
};

const DILUENT_STRENGTH = { N2: 0, CO2: 1.6, He: 0.9 };

/**
 * Plan the burn of an isolated droplet in microgravity.
 * Returns phase boundaries so the UI can animate it and tests can check it.
 * @param {{fuel:string,d0:number,o2:number,diluent?:'N2'|'CO2'|'He',dilPct?:number}} p
 */
export function dropletBurn({ fuel, d0, o2, diluent = 'N2', dilPct = 0 }) {
  const f = FUELS[fuel];
  if (!f) throw new Error(`unknown fuel ${fuel}`);
  const dil = Math.min(Math.max(dilPct, 0), 60) * DILUENT_STRENGTH[diluent] / 100;
  const oxEff = Math.max(o2 * (1 - dil), 0);
  // Ignition limit: too little oxidizer, no hot flame at all.
  if (oxEff < 11) {
    return { ignites: false, kHot: 0, kCool: 0, phases: [{ phase: 'no-ignition', t0: 0, t1: 0, d0, d1: d0 }], residual: d0 };
  }
  const kHot = f.k0 * Math.pow(oxEff / 21, 0.6);
  // Larger flames radiate more; below this diameter radiative loss can't extinguish the flame.
  const dcrit = f.dcrit * Math.pow(oxEff / 21, 1.5);
  const phases = [];
  let t = 0;
  let d = d0;
  if (d0 > dcrit) {
    // Radiative extinction happens early for big droplets in weak atmospheres.
    const dExt = Math.max(d0 * (0.55 + 0.4 * (dcrit / d0)), 0.2);
    const tExt = (d0 * d0 - dExt * dExt) / kHot;
    phases.push({ phase: 'hot', t0: t, t1: tExt, d0: d, d1: dExt });
    t = tExt;
    d = dExt;
    if (f.coolFlame && oxEff >= 14) {
      const kCool = kHot * 0.35;
      const dCoolExt = d * 0.45;
      const tc = (d * d - dCoolExt * dCoolExt) / kCool;
      phases.push({ phase: 'cool', t0: t, t1: t + tc, d0: d, d1: dCoolExt });
      t += tc;
      d = dCoolExt;
      return { ignites: true, kHot, kCool, dcrit, phases, residual: d };
    }
    return { ignites: true, kHot, kCool: 0, dcrit, phases, residual: d };
  }
  // Small droplet: burns nearly to completion (diffusive extinction at ~0.1 mm).
  const dEnd = fuel === 'methanol' ? Math.max(0.15 * d0, 0.1) : 0.1;
  const tEnd = (d0 * d0 - dEnd * dEnd) / kHot;
  phases.push({ phase: 'hot', t0: 0, t1: tEnd, d0, d1: dEnd });
  return { ignites: true, kHot, kCool: 0, dcrit, phases, residual: dEnd };
}

/** Droplet diameter (mm) and phase at time t (s) for a planned burn. */
export function dropletStateAt(plan, t) {
  for (const p of plan.phases) {
    if (t <= p.t1) {
      if (p.phase === 'no-ignition') return { d: p.d0, phase: 'no-ignition' };
      const k = (p.d0 * p.d0 - p.d1 * p.d1) / Math.max(p.t1 - p.t0, 1e-9);
      const d2 = p.d0 * p.d0 - k * (t - p.t0);
      return { d: Math.sqrt(Math.max(d2, 0)), phase: p.phase };
    }
  }
  return { d: plan.residual, phase: 'out' };
}
