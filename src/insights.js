// Turns model outputs into plain-language fire safety insights for crews and mission planners.
import { MATERIALS } from './data.js';
import { predict, riskLevel } from './model.js';
import { worstCaseFlow, limitingO2 } from './physics.js';

/** Assess every material in the inventory for an environment. */
export function assessInventory(models, env, materials = MATERIALS) {
  return materials
    .map((m) => ({ material: m, ...predict(models, m, env) }))
    .sort((a, b) => b.prob - a.prob || b.spread - a.spread);
}

/** Cabin-level risk: probability that at least one listed material sustains a flame, weighted by spread. */
export function cabinRisk(assessments) {
  if (!assessments.length) return 0;
  // Treat the top hazards as the risk driver; a single sustained flame is a cabin fire.
  const top = assessments.slice(0, 3);
  const pAny = 1 - top.reduce((acc, a) => acc * (1 - a.prob), 1);
  const severity = Math.min(1, Math.max(...top.map((a) => a.expectedSpread)) / 4);
  return Math.min(1, 0.8 * pAny + 0.2 * severity);
}

/** Smallest O2 % (in 0.5 steps) at which every material's AI burn probability is under `target`. */
export function safeO2(models, env, materials = MATERIALS, target = 0.15) {
  for (let o2 = env.o2; o2 >= 14; o2 -= 0.5) {
    const worst = Math.max(...materials.map((m) => predict(models, m, { ...env, o2 }).prob));
    if (worst < target) return o2;
  }
  return null;
}

export function generateInsights(models, env, assessments) {
  const out = [];
  const burning = assessments.filter((a) => a.prob >= 0.5);
  const top = assessments[0];
  const level = riskLevel(cabinRisk(assessments));

  if (burning.length === 0) {
    out.push({ kind: 'ok', title: 'No inventory material is predicted to sustain a flame', body: `Highest risk is ${top.material.name} at ${(top.prob * 100).toFixed(0)}%. Keep ignition sources controlled; margins can shrink quickly if O₂ rises.` });
  } else {
    const fast = [...burning].sort((a, b) => b.spread - a.spread)[0];
    out.push({ kind: level.id === 'critical' ? 'danger' : 'warn', title: `${burning.length} of ${assessments.length} materials can sustain a flame here`, body: `Fastest predicted spread: ${fast.material.name} at ${fast.spread.toFixed(2)} mm/s (${(fast.spread * 60 / 10).toFixed(1)} cm per minute). Stow or shield these first.` });
  }

  // Worst-case ventilation for the leading hazard.
  const wc = worstCaseFlow(top.material, env);
  const ue = env.gravity > 0 ? ' (buoyancy already supplies part of this flow)' : '';
  if (env.gravity < 0.5) {
    out.push({ kind: 'info', title: `Most flammable airflow for ${top.material.name}: ~${wc.flow.toFixed(0)} cm/s${ue}`, body: `Minimum O₂ to burn drops to ${wc.loi.toFixed(1)}% at that flow vs ${limitingO2(top.material, { ...env, gravity: 1, flow: 0 }).toFixed(1)}% on Earth. Typical cabin ventilation (5–20 cm/s) sits right in this window, so a flame that would die on Earth can survive in orbit.` });
  }

  // Ventilation shutdown, the first ISS fire response step.
  if (env.gravity === 0 && burning.length) {
    const still = assessments.filter((a) => predict(models, a.material, { ...env, flow: 0 }).prob >= 0.5);
    out.push({ kind: still.length ? 'warn' : 'ok', title: 'Fire response: turn off ventilation', body: still.length ? `With fans off, ${still.length} material(s) are still predicted to burn (${still.slice(0, 3).map((s) => s.material.name).join(', ')}). The elevated O₂ keeps flames alive without flow; use the CO₂ or water-mist extinguisher.` : 'With fans off, no material is predicted to keep burning: without buoyancy, the flame starves of oxygen. Isolate power and stop forced flow first.' });
  }

  // Atmosphere tuning.
  const so = safeO2(models, env);
  if (burning.length && so !== null && so < env.o2) {
    out.push({ kind: 'info', title: `Lower O₂ to ${so.toFixed(1)}% to keep all materials below 15% burn probability`, body: `That is ${(env.o2 - so).toFixed(1)} points below the current ${env.o2.toFixed(1)}% at ${env.pressure.toFixed(1)} kPa. Trade-off: a lower O₂ fraction lengthens EVA pre-breathe at this cabin pressure.` });
  } else if (burning.length && so === null) {
    out.push({ kind: 'warn', title: 'Atmosphere control alone cannot make this inventory safe', body: `Even at 14% O₂, the lowest tested level (already hypoxic for crew at this pressure), ${assessments[0].material.name} would still burn. Replace or enclose the leading hazards with flame-resistant alternatives (Nomex, Kapton, silicone).` });
  }

  // Partial gravity call-out.
  if (env.gravity > 0 && env.gravity < 0.5) {
    out.push({ kind: 'info', title: 'Partial gravity is close to the worst case', body: `At ${env.gravity} g, buoyant flow alone is ~${(30 * Math.sqrt(env.gravity)).toFixed(0)} cm/s, right where flames are most robust. Earth-based (1 g) material screening can underestimate risk for lunar and Martian habitats.` });
  }

  // Uncertainty / out-of-domain honesty.
  const unsure = assessments.filter((a) => a.std > 0.25);
  if (assessments.some((a) => a.outOfDomain)) {
    out.push({ kind: 'warn', title: 'Outside the training envelope: physics guardrail active', body: 'O₂, pressure or flow is beyond the tested range (O₂ 14–40%, 50–103 kPa, ≤ 50 cm/s). Risk shown is never lower than the physics model. Validate with a ground or ISS test before relying on it.' });
  } else if (unsure.length) {
    out.push({ kind: 'info', title: `Model is uncertain for ${unsure.map((u) => u.material.name).join(', ')}`, body: 'These are near their flammability limit: small changes in O₂ or airflow flip the outcome. Good candidates for a targeted microgravity test (e.g. SoFIE).' });
  }

  // Cool-flame hazard reminder when liquids are aboard.
  out.push({ kind: 'info', title: 'Hidden hazard: cool flames', body: 'FLEX showed fuel droplets can keep reacting after the visible flame is gone. Treat "extinguished" liquid fires as live until vapor is cleared (see Droplet Lab).' });
  return out;
}
