import { describe, it, expect } from 'vitest';
import { limitingO2, burnProbability, spreadRate, worstCaseFlow, dropletBurn, dropletStateAt, effectiveVelocity } from '../src/physics.js';
import { MATERIAL_BY_ID } from '../src/data.js';

const pmma = MATERIAL_BY_ID.pmma;

describe('solid flammability physics', () => {
  it('reproduces the 1 g LOI at Earth buoyant flow', () => {
    expect(limitingO2(pmma, { gravity: 1, flow: 0, pressure: 101.3 })).toBeCloseTo(pmma.loi1g, 5);
  });
  it('is U-shaped in microgravity: quench at no flow, minimum at cabin-fan speeds', () => {
    const quiescent = limitingO2(pmma, { gravity: 0, flow: 0 });
    const { flow, loi } = worstCaseFlow(pmma, { gravity: 0, pressure: 101.3 });
    expect(quiescent).toBeGreaterThan(40);
    expect(flow).toBeGreaterThan(3);
    expect(flow).toBeLessThan(20);
    expect(loi).toBeLessThan(pmma.loi1g);
  });
  it('partial gravity is more flammable than Earth', () => {
    expect(limitingO2(pmma, { gravity: 0.165, flow: 0 })).toBeLessThan(limitingO2(pmma, { gravity: 1, flow: 0 }));
  });
  it('exploration atmosphere is more hazardous than ISS air', () => {
    const iss = { o2: 21, pressure: 101.3, gravity: 0, flow: 12 };
    const orion = { o2: 34, pressure: 56.5, gravity: 0, flow: 12 };
    const nomex = MATERIAL_BY_ID.nomex;
    expect(burnProbability(nomex, orion)).toBeGreaterThan(burnProbability(nomex, iss));
    expect(spreadRate(MATERIAL_BY_ID.cotton, orion)).toBeGreaterThan(spreadRate(MATERIAL_BY_ID.cotton, iss));
  });
  it('no spread below the limit; flame-resistant materials resist ISS air', () => {
    expect(spreadRate(MATERIAL_BY_ID.kapton, { o2: 21, pressure: 101.3, gravity: 0, flow: 10 })).toBe(0);
    expect(burnProbability(MATERIAL_BY_ID.kapton, { o2: 21, pressure: 101.3, gravity: 0, flow: 10 })).toBeLessThan(0.01);
  });
  it('combines forced and buoyant flow', () => {
    expect(effectiveVelocity(0, 1)).toBeCloseTo(30);
    expect(effectiveVelocity(40, 0)).toBe(40);
  });
});

describe('droplet combustion (FLEX)', () => {
  it('large heptane droplets show a cool-flame phase after radiative extinction', () => {
    const plan = dropletBurn({ fuel: 'heptane', d0: 3.5, o2: 21 });
    expect(plan.phases.map((p) => p.phase)).toEqual(['hot', 'cool']);
    expect(plan.residual).toBeGreaterThan(0.3);
  });
  it('small droplets burn nearly to completion following the d² law', () => {
    const plan = dropletBurn({ fuel: 'heptane', d0: 2, o2: 21 });
    expect(plan.phases).toHaveLength(1);
    const half = plan.phases[0].t1 / 2;
    const d = dropletStateAt(plan, half).d;
    expect(d * d).toBeCloseTo((4 + 0.01) / 2, 1);
  });
  it('methanol has no cool flame and enough CO₂ prevents ignition', () => {
    expect(dropletBurn({ fuel: 'methanol', d0: 4.8, o2: 21 }).phases.some((p) => p.phase === 'cool')).toBe(false);
    expect(dropletBurn({ fuel: 'heptane', d0: 3, o2: 21, diluent: 'CO2', dilPct: 40 }).ignites).toBe(false);
  });
});
