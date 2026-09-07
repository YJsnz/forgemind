import test from "node:test";
import assert from "node:assert/strict";

import { buildImportedFeatureRecoveryPlan, nextImportedFeatureRecoveryStep } from "../core/direct-edit/ImportedFeatureRecoveryPlan.ts";

const item = (id, kind, readiness, topologyLocalIds, confidence = .9) => ({
  id, kind, readiness, topologyLocalIds, confidence,
  label: id, evidence: ["exact analytic evidence"], recommendedAction: "recover",
});

test("import recovery plan restores shape-defining features before repeated and detail features", () => {
  const report = {
    generatedAt: 1,
    items: [
      item("fillet-1", "fillet", "user-confirmation", ["f1"], .8),
      item("hole-1", "hole", "native-reconstructable", ["h1"], .97),
      item("pattern-1", "pattern", "user-confirmation", ["h1", "h2", "h3"], .95),
      item("prismatic-1", "prismatic", "native-reconstructable", ["p1", "p2"], .94),
      item("prismatic-review", "prismatic", "candidate-only", ["p9"], .6),
    ],
    counts: { "native-reconstructable": 2, "user-confirmation": 2, "candidate-only": 1 },
    summary: "fixture",
  };
  const plan = buildImportedFeatureRecoveryPlan(report);
  assert.equal(plan.steps[0].id, "prismatic-1");
  assert.equal(plan.steps.find((step) => step.id === "hole-1").action, "skip-covered");
  assert.equal(plan.steps.find((step) => step.id === "hole-1").coveredByStepId, "pattern-1");
  assert.equal(nextImportedFeatureRecoveryStep(plan)?.id, "prismatic-1");
  assert.equal(plan.coveredCandidates, 1);
  assert.match(plan.summary, /重复孔由阵列统一恢复/);
});

test("every topology-changing recovery step requires fresh B-Rep analysis", () => {
  const plan = buildImportedFeatureRecoveryPlan({
    generatedAt: 1,
    items: [item("hole", "hole", "native-reconstructable", ["h"]), item("review", "prismatic", "candidate-only", ["p"])],
    counts: { "native-reconstructable": 1, "user-confirmation": 0, "candidate-only": 1 },
    summary: "fixture",
  });
  assert.equal(plan.steps.find((step) => step.id === "hole").requiresReanalysis, true);
  assert.equal(plan.steps.find((step) => step.id === "review").requiresReanalysis, false);
});
