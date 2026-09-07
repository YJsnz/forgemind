import type { ShellFeature } from "../features/ShellFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";

export const evaluateShellFeature = async (feature: ShellFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Shell features are not evaluated.");
  if (!Number.isFinite(feature.thicknessMm) || feature.thicknessMm <= context.tolerance.geometry) return featureEvaluationFailure(feature.id, "SHELL_INVALID_THICKNESS", "Shell thickness must be finite and greater than tolerance.");
  if (!feature.removeFaces.length) return featureEvaluationFailure(feature.id, "SHELL_NO_FACES", "Shell requires at least one persisted Face reference.");
  const runtime = context.runtime; const target = runtime ? getRuntimeFeatureShape(runtime, feature.targetFeatureId) : undefined;
  if (!runtime || !target || !feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Shell requires an evaluated target Feature.");
  try {
    const faces = await Promise.all(feature.removeFaces.map((face) => resolvePersistentTopologyRef(face, runtime, context.kernel)));
    if (faces.some((face) => face.shapeId !== target.id || face.shapeRevision !== target.revision)) return featureEvaluationFailure(feature.id, "TOPOLOGY_REFERENCE_LOST", "Shell Face belongs to another Feature result.");
    const shape = await context.kernel.shell(target, faces, feature.thicknessMm); const validation = await context.kernel.validate(shape);
    if (!validation.valid) { await context.kernel.disposeShape(shape); return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Shell returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape, validation, warnings: shape.operationWarnings ?? [] };
  } catch (error) {
    if (error instanceof TopologyResolutionError) return featureEvaluationFailure(feature.id, error.code, error.message, error);
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, "SHELL_FAILED", error.message, error, error.code);
    return featureEvaluationFailure(feature.id, "SHELL_FAILED", error instanceof Error ? error.message : String(error), error);
  }
};
