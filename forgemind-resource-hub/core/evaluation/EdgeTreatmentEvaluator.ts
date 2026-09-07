import type { ChamferFeature } from "../features/ChamferFeature.ts";
import type { FilletFeature } from "../features/FilletFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";

type EdgeFeature = FilletFeature | ChamferFeature;
export const evaluateEdgeTreatment = async (feature: EdgeFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const operation = feature.type === "fillet" ? "Fillet" : "Chamfer";
  const value = feature.type === "fillet" ? feature.radiusMm : feature.distanceMm;
  const errorCode = feature.type === "fillet" ? "FILLET_FAILED" : "CHAMFER_FAILED";
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", `Suppressed ${operation} features are not evaluated.`);
  if (!Number.isFinite(value) || value <= context.tolerance.geometry) return featureEvaluationFailure(feature.id, errorCode, `${operation} value must be finite and greater than tolerance.`);
  if (!feature.edges.length) return featureEvaluationFailure(feature.id, errorCode, `${operation} requires at least one Edge.`);
  if (feature.type === "fillet" && feature.endRadiusMm !== undefined && (!Number.isFinite(feature.endRadiusMm) || feature.endRadiusMm <= context.tolerance.geometry)) return featureEvaluationFailure(feature.id, errorCode, "Variable Fillet end radius must be finite and greater than tolerance.");
  if (feature.type === "fillet" && feature.endRadiusMm !== undefined && feature.edges.length !== 1) return featureEvaluationFailure(feature.id, errorCode, "Variable Fillet requires exactly one Edge so its start and end radii are unambiguous.");
  const runtime = context.runtime; const target = runtime ? getRuntimeFeatureShape(runtime, feature.targetFeatureId) : undefined;
  if (!runtime || !target || !feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", `${operation} requires an evaluated target Feature.`);
  try {
    const edges = await Promise.all(feature.edges.map((edge) => resolvePersistentTopologyRef(edge, runtime, context.kernel)));
    if (edges.some((edge) => edge.shapeId !== target.id || edge.shapeRevision !== target.revision)) return featureEvaluationFailure(feature.id, "TOPOLOGY_REFERENCE_LOST", `${operation} Edge belongs to another Feature result.`);
    const shape = feature.type === "fillet"
      ? feature.endRadiusMm === undefined
        ? await context.kernel.fillet(target, edges, value)
        : await context.kernel.filletVariable(target, edges[0], value, feature.endRadiusMm)
      : await context.kernel.chamfer(target, edges, value);
    const validation = await context.kernel.validate(shape); if (!validation.valid) { await context.kernel.disposeShape(shape); return featureEvaluationFailure(feature.id, "INVALID_RESULT", `${operation} returned an invalid B-Rep.`); }
    return { status: "success", featureId: feature.id, shape, validation, warnings: [] };
  } catch (error) {
    if (error instanceof TopologyResolutionError) return featureEvaluationFailure(feature.id, error.code, error.message, error);
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, errorCode, error.message, error, error.code);
    return featureEvaluationFailure(feature.id, errorCode, error instanceof Error ? error.message : String(error), error);
  }
};
