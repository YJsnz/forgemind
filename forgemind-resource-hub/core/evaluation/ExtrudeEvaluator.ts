import type { ExtrudeFeature } from "../features/ExtrudeFeature.ts";
import { KernelError, KernelReferenceError } from "../kernel/KernelErrors.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { ClosedProfile } from "../sketch/SketchProfile.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationFailure, FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import { extrudeClosedProfile } from "./ProfileExtrusion.ts";
import { applySolidFeatureOperation } from "./SolidFeatureOperation.ts";

export const selectProfiles = (featureId: string, sketchId: string, context: FeatureEvaluationContext, requestedIds?: readonly string[]):
  | { profiles: ClosedProfile[]; warnings: string[] }
  | FeatureEvaluationFailure => {
  const sketch = context.document.sketches[sketchId];
  if (!sketch) return featureEvaluationFailure(featureId, "SKETCH_NOT_FOUND", `Sketch ${sketchId} was not found.`);
  const built = context.buildProfiles(sketch);
  if (!built.profiles.length) {
    const unsupportedSpline = built.openChains.some((chain) => chain.reason === "unsupported-spline");
    return featureEvaluationFailure(featureId, unsupportedSpline ? "PROFILE_UNSUPPORTED" : built.openChains.length ? "PROFILE_OPEN" : "PROFILE_INVALID", unsupportedSpline ? "Spline profiles are not supported by solid evaluation." : "Sketch does not contain a valid closed material region.");
  }
  if (!requestedIds?.length) return { profiles: built.profiles, warnings: built.warnings };
  const requested = new Set(requestedIds);
  const profiles = built.profiles.filter((profile) => requested.has(profile.id));
  if (profiles.length !== requested.size) return featureEvaluationFailure(featureId, "PROFILE_INVALID", "One or more selected Sketch regions no longer exist after the Sketch changed.");
  return { profiles, warnings: built.warnings };
};

const invalidInput = (feature: ExtrudeFeature, message: string): FeatureEvaluationResult =>
  featureEvaluationFailure(feature.id, "INVALID_INPUT", message);

export const selectSingleProfile = (featureId: string, sketchId: string, context: FeatureEvaluationContext):
  | { profile: ClosedProfile; warnings: string[] }
  | FeatureEvaluationFailure => {
  const selected = selectProfiles(featureId, sketchId, context);
  if ("status" in selected) return selected;
  if (selected.profiles.length !== 1) {
    return featureEvaluationFailure(featureId, "PROFILE_UNSUPPORTED_MULTIPLE", "Feature Evaluation v1 supports exactly one closed profile.");
  }
  return { profile: selected.profiles[0], warnings: selected.warnings };
};

/** Pocket v1 intentionally stays on its existing line-only boundary. */
export const selectSingleLineProfile = (featureId: string, sketchId: string, context: FeatureEvaluationContext):
  | { profile: ClosedProfile; warnings: string[] }
  | FeatureEvaluationFailure => {
  const selection = selectSingleProfile(featureId, sketchId, context);
  if ("status" in selection) return selection;
  if (selection.profile.outer.some((segment) => segment.type !== "line")) {
    return featureEvaluationFailure(featureId, "PROFILE_UNSUPPORTED", "Pocket Evaluation v1 supports only closed line profiles.");
  }
  return selection;
};

const isFailure = (value: FeatureEvaluationFailure | { profile?: ClosedProfile; profiles?: ClosedProfile[]; warnings: string[] }): value is FeatureEvaluationFailure =>
  "status" in value && value.status === "failed";

/** Runs the first real Domain Sketch -> B-Rep Extrude pipeline without mutating the document. */
export const evaluateExtrudeFeature = async (
  feature: ExtrudeFeature,
  context: FeatureEvaluationContext,
): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") {
    return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Extrude features are not evaluated.");
  }
  if (feature.operation !== "new") {
    if (!feature.targetFeatureId || !feature.dependencies.includes(feature.targetFeatureId)) {
      return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_MISSING", `Extrude ${feature.operation} requires an explicit target Feature dependency.`);
    }
    if (!context.runtime) return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Extrude ${feature.operation} requires CadRuntimeState.`);
  }
  const direction = feature.direction ?? "positive";
  if (!Number.isFinite(feature.distance) || feature.distance <= context.tolerance.geometry) {
    return invalidInput(feature, "Extrude distance must be finite and greater than the geometry tolerance.");
  }
  if (direction === "twoSided" && (!Number.isFinite(feature.secondDistance) || feature.secondDistance! <= context.tolerance.geometry)) return invalidInput(feature, "Two-sided Extrude requires a positive opposite-side distance.");

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
    for (const profile of profileSelection.profiles) tools.push(await extrudeClosedProfile(context.kernel, profile, plane, { distanceMm: feature.distance, direction, secondDistanceMm: feature.secondDistance }));
    const target = feature.operation === "new" ? undefined : getRuntimeFeatureShape(context.runtime!, feature.targetFeatureId!);
    if (feature.operation !== "new" && !target) {
      for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined);
      return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Target Feature ${feature.targetFeatureId} has not been evaluated.`);
    }
    shape = await applySolidFeatureOperation(context.kernel, tools, feature.operation, target);
    const validation = await context.kernel.validate(shape);
    if (!validation.valid) {
      await context.kernel.disposeShape(shape);
      return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Kernel returned an invalid B-Rep result.");
    }
    return { status: "success", featureId: feature.id, shape, validation, warnings: profileSelection.warnings };
  } catch (error) {
    if (shape) await context.kernel.disposeShape(shape).catch(() => undefined);
    if (error instanceof KernelReferenceError) {
      return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", error.message, error, error.code);
    }
    if (error instanceof KernelError) {
      return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error.message, error, error.code);
    }
    return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error instanceof Error ? error.message : String(error), error);
  }
};
