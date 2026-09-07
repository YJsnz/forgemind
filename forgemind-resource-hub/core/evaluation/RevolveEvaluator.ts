import type { RevolveFeature } from "../features/RevolveFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { selectProfiles } from "./ExtrudeEvaluator.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import { revolveClosedProfile } from "./ProfileSolidConstruction.ts";
import { applySolidFeatureOperation } from "./SolidFeatureOperation.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";

const isFailure = (value: ReturnType<typeof selectProfiles>): value is Extract<FeatureEvaluationResult, { status: "failed" }> =>
  "status" in value && value.status === "failed";

/** Evaluates one new-body RevolveFeature against an exact domain profile. */
export const evaluateRevolveFeature = async (
  feature: RevolveFeature,
  context: FeatureEvaluationContext,
): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") {
    return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Revolve features are not evaluated.");
  }
  if (feature.operation !== "new" && (!feature.targetFeatureId || !feature.dependencies.includes(feature.targetFeatureId))) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_MISSING", `Revolve ${feature.operation} requires an explicit target Feature dependency.`);
  if (feature.operation !== "new" && !context.runtime) return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Revolve ${feature.operation} requires CadRuntimeState.`);
  if (!Number.isFinite(feature.angleDeg) || Math.abs(feature.angleDeg) <= context.tolerance.geometry || Math.abs(feature.angleDeg) > 360 + context.tolerance.geometry) {
    return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Revolve angle must be finite, non-zero, and no greater than 360 degrees.");
  }
  if (!Number.isFinite(feature.axis.origin.x) || !Number.isFinite(feature.axis.origin.y) || !Number.isFinite(feature.axis.origin.z)
    || !Number.isFinite(feature.axis.direction.x) || !Number.isFinite(feature.axis.direction.y) || !Number.isFinite(feature.axis.direction.z)) {
    return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Revolve axis origin and direction must be finite.");
  }

  const profileSelection = selectProfiles(feature.id, feature.sketchId, context, feature.profileIds);
  if (isFailure(profileSelection)) return profileSelection;
  const sketch = context.document.sketches[feature.sketchId];
  if (!sketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Sketch ${feature.sketchId} was not found.`);

  let plane;
  try {
    plane = await resolveSketchPlaneFrame(sketch.plane, context);
  } catch (error) {
    return featureEvaluationFailure(feature.id, "PLANE_UNSUPPORTED", error instanceof Error ? error.message : String(error), error);
  }

  let shape;
  try {
    const tools: KernelShapeRef[] = [];
    for (const profile of profileSelection.profiles) tools.push(await revolveClosedProfile(context.kernel, profile, plane, feature.axis, feature.angleDeg));
    const target = feature.operation === "new" ? undefined : getRuntimeFeatureShape(context.runtime!, feature.targetFeatureId!);
    if (feature.operation !== "new" && !target) {
      for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined);
      return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Target Feature ${feature.targetFeatureId} has not been evaluated.`);
    }
    shape = await applySolidFeatureOperation(context.kernel, tools, feature.operation, target);
    const validation = await context.kernel.validate(shape);
    if (!validation.valid) {
      await context.kernel.disposeShape(shape);
      return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Kernel returned an invalid B-Rep Revolve result.");
    }
    return { status: "success", featureId: feature.id, shape, validation, warnings: profileSelection.warnings };
  } catch (error) {
    if (shape) await context.kernel.disposeShape(shape).catch(() => undefined);
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error.message, error, error.code);
    return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error instanceof Error ? error.message : String(error), error);
  }
};
