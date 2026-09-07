import type { BodyBooleanFeature } from "../features/BodyBooleanFeature.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

export const evaluateBodyBooleanFeature = async (feature: BodyBooleanFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (feature.target.bodyId !== feature.bodyId) return featureEvaluationFailure(feature.id, "FEATURE_BODY_MISMATCH", "Body Boolean target must be owned by its target Body.");
  if (!feature.tools.length) return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Body Boolean requires at least one tool Body.");
  if (feature.tools.some((tool) => tool.bodyId === feature.target.bodyId)) return featureEvaluationFailure(feature.id, "BODY_BOOLEAN_SELF_REFERENCE", "A Body cannot Boolean against itself.");
  if (new Set(feature.tools.map((tool) => tool.bodyId)).size !== feature.tools.length) return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Body Boolean tool Bodies must be unique.");
  const runtime = context.runtime;
  const target = runtime && getRuntimeFeatureShape(runtime, feature.target.featureId);
  const tools = runtime ? feature.tools.map((tool) => getRuntimeFeatureShape(runtime, tool.featureId)) : [];
  if (!target || tools.some((tool) => !tool)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Body Boolean references an unevaluated Body state.");
  let shape;
  try {
    shape = feature.operation === "union" ? await context.kernel.booleanUnion(target, tools as NonNullable<typeof tools[number]>[]) : feature.operation === "cut" ? await context.kernel.booleanCut(target, tools as NonNullable<typeof tools[number]>[]) : await context.kernel.booleanIntersect(target, tools as NonNullable<typeof tools[number]>[]);
    const validation = await context.kernel.validate(shape);
    if (!validation.valid) { await context.kernel.disposeShape(shape); return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Body Boolean returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape, validation, warnings: [] };
  } catch (error) {
    if (shape) await context.kernel.disposeShape(shape).catch(() => undefined);
    return featureEvaluationFailure(feature.id, feature.operation === "intersect" ? "BODY_BOOLEAN_EMPTY_RESULT" : "BODY_BOOLEAN_FAILED", error instanceof Error ? error.message : String(error), error);
  }
};
