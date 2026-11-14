// Trains the FlameSight models and exposes a single prediction API to the UI.
import { generateDataset, rowToFeatures, featureVector, MATERIALS, FEATURES } from './data.js';
import { RandomForest, accuracy, confusion, roc, r2, rmse, trainTestSplit } from './ml.js';
import { limitingO2, burnProbability, spreadRate } from './physics.js';

export function trainModels({ n = 4800, seed = 2026, nTrees = 40, loMo = true, rows: customRows = null } = {}) {
  const t0 = performance.now();
  // Pass `rows` (same columns as generateDataset, e.g. parsed from NASA PSI data) to train on real tests.
  const rows = customRows ?? generateDataset(n, seed);
  const X = rows.map(rowToFeatures);
  const yBurn = rows.map((r) => r.burned);
  const { train, test } = trainTestSplit(rows.length, 0.2);

  const burnModel = new RandomForest({ nTrees, maxDepth: 12, minLeaf: 3, seed: 3 }).fit(
    train.map((i) => X[i]),
    train.map((i) => yBurn[i]),
  );
  const testProb = test.map((i) => burnModel.predict(X[i]));
  const testY = test.map((i) => yBurn[i]);

  // Spread-rate regressor on burning samples, trained on log1p(mm/s) for stability.
  const burnTrain = train.filter((i) => rows[i].burned);
  const burnTest = test.filter((i) => rows[i].burned);
  const spreadModel = new RandomForest({ nTrees, maxDepth: 12, minLeaf: 3, seed: 5 }).fit(
    burnTrain.map((i) => X[i]),
    burnTrain.map((i) => Math.log1p(rows[i].spread)),
  );
  const spreadPred = burnTest.map((i) => Math.expm1(spreadModel.predict(X[i])));
  const spreadTrue = burnTest.map((i) => rows[i].spread);

  // Physics-only baseline (what the margin model alone would say).
  const physProb = test.map((i) => {
    const r = rows[i];
    return burnProbability(MATERIALS.find((m) => m.id === r.material), r);
  });

  // Leave-one-material-out: can the model generalize to a material it has never seen?
  const lomo = [];
  if (loMo) {
    for (const mat of MATERIALS) {
      const tr = [];
      const te = [];
      rows.forEach((r, i) => (r.material === mat.id ? te : tr).push(i));
      const m = new RandomForest({ nTrees: 15, maxDepth: 12, minLeaf: 3, seed: 9 }).fit(
        tr.map((i) => X[i]),
        tr.map((i) => yBurn[i]),
      );
      const p = te.map((i) => m.predict(X[i]));
      lomo.push({ material: mat, accuracy: accuracy(te.map((i) => yBurn[i]), p), n: te.length });
    }
  }

  const ms = performance.now() - t0;
  const rocRes = roc(testY, testProb);
  return {
    rows,
    burnModel,
    spreadModel,
    metrics: {
      trainMs: ms,
      nTrain: train.length,
      nTest: test.length,
      accuracy: accuracy(testY, testProb),
      physicsAccuracy: accuracy(testY, physProb),
      auc: rocRes.auc,
      roc: rocRes.points,
      confusion: confusion(testY, testProb),
      spreadR2: r2(spreadTrue.map(Math.log1p), spreadPred.map(Math.log1p)),
      spreadRmse: rmse(spreadTrue, spreadPred),
      spreadPairs: burnTest.map((i, k) => [spreadTrue[k], spreadPred[k], rows[i].gravity]),
      importance: FEATURES.map((f, j) => ({ ...f, value: burnModel.importance[j] })).sort((a, b) => b.value - a.value),
      lomo,
    },
  };
}

/** Predict fire behavior of one material in one environment. */
export function predict(models, material, env) {
  const x = featureVector(material, env);
  const { mean, std } = models.burnModel.predictWithUncertainty(x);
  const spread = Math.expm1(models.spreadModel.predict(x));
  const physicsProb = burnProbability(material, env);
  // Safety guardrail: outside the training envelope, never report less risk than physics does.
  const outOfDomain = env.o2 > 40 || env.o2 < 14 || env.pressure < 50 || env.pressure > 103 || env.flow > 50;
  const prob = outOfDomain ? Math.max(mean, physicsProb) : mean;
  return {
    prob,
    aiProb: mean,
    outOfDomain,
    std,
    spread: Math.max(spread, 0),
    expectedSpread: Math.max(spread, 0) * prob,
    loi: limitingO2(material, env),
    physicsProb,
    physicsSpread: spreadRate(material, env),
  };
}

export function riskLevel(p) {
  if (p >= 0.75) return { id: 'critical', label: 'Critical', color: 'var(--danger)' };
  if (p >= 0.45) return { id: 'high', label: 'High', color: 'var(--warn)' };
  if (p >= 0.15) return { id: 'elevated', label: 'Elevated', color: 'var(--caution)' };
  return { id: 'low', label: 'Low', color: 'var(--ok)' };
}
