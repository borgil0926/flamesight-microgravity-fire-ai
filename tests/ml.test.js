import { describe, it, expect } from 'vitest';
import { RandomForest, roc, accuracy, r2, trainTestSplit } from '../src/ml.js';
import { generateDataset, MATERIALS } from '../src/data.js';
import { trainModels, predict } from '../src/model.js';
import { assessInventory, cabinRisk, generateInsights, safeO2 } from '../src/insights.js';

describe('random forest', () => {
  it('learns a simple non-linear rule', () => {
    const X = [], y = [];
    for (let i = 0; i < 600; i++) {
      const a = (i * 37) % 100, b = (i * 61) % 100;
      X.push([a, b]);
      y.push(a > 50 && b < 40 ? 1 : 0);
    }
    const rf = new RandomForest({ nTrees: 15, maxDepth: 6 }).fit(X, y);
    expect(rf.predict([80, 10])).toBeGreaterThan(0.8);
    expect(rf.predict([20, 80])).toBeLessThan(0.2);
    const { std } = rf.predictWithUncertainty([80, 10]);
    expect(std).toBeGreaterThanOrEqual(0);
  });
  it('computes AUC 1 for perfect ranking and accuracy', () => {
    expect(roc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]).auc).toBeCloseTo(1);
    expect(accuracy([1, 0], [0.9, 0.6])).toBe(0.5);
    expect(r2([1, 2, 3], [1, 2, 3])).toBe(1);
    const s = trainTestSplit(100, 0.2);
    expect(s.test).toHaveLength(20);
    expect(new Set([...s.train, ...s.test]).size).toBe(100);
  });
});

describe('FlameSight models', () => {
  const models = trainModels({ n: 2400, nTrees: 20, loMo: false });
  it('dataset is deterministic and balanced', () => {
    const a = generateDataset(300, 1), b = generateDataset(300, 1);
    expect(a).toEqual(b);
    const rate = models.rows.filter((r) => r.burned).length / models.rows.length;
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.8);
  });
  it('reaches strong held-out accuracy', () => {
    expect(models.metrics.accuracy).toBeGreaterThan(0.88);
    expect(models.metrics.auc).toBeGreaterThan(0.95);
    expect(models.metrics.spreadR2).toBeGreaterThan(0.85);
  });
  it('learns physically sensible trends', () => {
    const cotton = MATERIALS.find((m) => m.id === 'cotton');
    const lowO2 = predict(models, cotton, { o2: 15, pressure: 101.3, gravity: 0, flow: 10 });
    const highO2 = predict(models, cotton, { o2: 30, pressure: 101.3, gravity: 0, flow: 10 });
    expect(highO2.prob).toBeGreaterThan(lowO2.prob);
    expect(highO2.prob).toBeGreaterThan(0.9);
  });
  it('physics guardrail applies outside the training envelope', () => {
    const kapton = MATERIALS.find((m) => m.id === 'kapton');
    const r = predict(models, kapton, { o2: 100, pressure: 34.5, gravity: 0, flow: 10 });
    expect(r.outOfDomain).toBe(true);
    expect(r.prob).toBeGreaterThanOrEqual(r.physicsProb);
  });
  it('produces cabin risk and insights', () => {
    const env = { o2: 34, pressure: 56.5, gravity: 0, flow: 12 };
    const a = assessInventory(models, env);
    expect(a).toHaveLength(MATERIALS.length);
    expect(cabinRisk(a)).toBeGreaterThan(0.7);
    const ins = generateInsights(models, env, a);
    expect(ins.length).toBeGreaterThan(2);
    expect(ins.some((i) => /ventilation/i.test(i.title))).toBe(true);
    const so = safeO2(models, env);
    expect(so === null || so < 34).toBe(true);
  });
});
