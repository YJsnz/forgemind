import type { DeleteFaceFeature } from "../features/DeleteFaceFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelShapeRef, KernelTopologyRef } from "../kernel/KernelTypes.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

export const evaluateDeleteFaceFeature = async (feature: DeleteFaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Delete Face features are not evaluated.");
  const runtime = context.runtime, target = runtime ? getRuntimeFeatureShape(runtime, feature.targetFeatureId) : undefined;
  if (!runtime || !target || !feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Delete Face requires an evaluated target Feature.");
  if (!feature.faces.length) return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Delete Face requires at least one persistent Face reference.");
  if (!Number.isFinite(feature.toleranceMm) || feature.toleranceMm < 0) return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Delete Face tolerance must be finite and non-negative.");
  let result: KernelShapeRef | undefined;
  try {
    const resolved: KernelTopologyRef[] = [];
    for (const face of feature.faces) resolved.push(await resolvePersistentTopologyRef(face, runtime, context.kernel));
    result = await context.kernel.defeature(target, resolved, feature.toleranceMm);
    const validation = await context.kernel.validate(result);
    if (!validation.valid) { await context.kernel.disposeShape(result); result = undefined; return featureEvaluationFailure(feature.id, "INVALID_RESULT", "OCCT Defeature returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape: result, validation, warnings: [] };
  } catch (error) {
    if (result) await context.kernel.disposeShape(result).catch(() => undefined);
    if (error instanceof TopologyResolutionError) return featureEvaluationFailure(feature.id, error.code, error.message, error);
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error.message, error, error.code);
    return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error instanceof Error ? error.message : String(error), error);
  }
};
