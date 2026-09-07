import type { BodyTransformFeature } from "../features/BodyTransformFeature.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

const axisVector = (axis: "X" | "Y" | "Z") => axis === "X" ? { x: 1, y: 0, z: 0 } : axis === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };

export const evaluateBodyTransformFeature = async (feature: BodyTransformFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const input = context.runtime && getRuntimeFeatureShape(context.runtime, feature.inputFeatureId);
  if (!input) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Body Transform input has not been evaluated.");
  if (![feature.translationMm.x, feature.translationMm.y, feature.translationMm.z].every(Number.isFinite)) return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Body Transform translation must be finite millimetres.");
  let transformed;
  try {
    transformed = await context.kernel.translate(input, feature.translationMm);
    if (feature.rotation && (!Number.isFinite(feature.rotation.angleDeg))) throw new Error("Body Transform rotation must be finite degrees.");
    if (feature.rotation && feature.rotation.angleDeg !== 0) {
      const rotated = await context.kernel.rotate(transformed, { origin: { x: 0, y: 0, z: 0 }, direction: axisVector(feature.rotation.axis) }, feature.rotation.angleDeg);
      await context.kernel.disposeShape(transformed); transformed = rotated;
    }
    const validation = await context.kernel.validate(transformed);
    if (!validation.valid) { await context.kernel.disposeShape(transformed); return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Body Transform returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape: transformed, validation, warnings: [] };
  } catch (error) {
    if (transformed) await context.kernel.disposeShape(transformed).catch(() => undefined);
    return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error instanceof Error ? error.message : String(error), error);
  }
};
