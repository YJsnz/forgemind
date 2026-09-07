import type { SweepFeature } from "../features/SweepFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { selectProfiles } from "./ExtrudeEvaluator.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import { sweepClosedProfile } from "./ProfileSolidConstruction.ts";
import { applySolidFeatureOperation } from "./SolidFeatureOperation.ts";

const branching = (sketch: NonNullable<FeatureEvaluationContext["document"]["sketches"][string]>): boolean => {
  const keys = new Map<string, number>(); const key = (point:{x:number;y:number}) => `${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}`;
  for (const entity of Object.values(sketch.entities)) { if (entity.construction || (entity.type !== "line" && entity.type !== "arc")) continue; const points = entity.type === "line" ? [entity.start, entity.end] : [{x:entity.center.x+entity.radius*Math.cos(entity.startAngle),y:entity.center.y+entity.radius*Math.sin(entity.startAngle)},{x:entity.center.x+entity.radius*Math.cos(entity.endAngle),y:entity.center.y+entity.radius*Math.sin(entity.endAngle)}]; for (const point of points) keys.set(key(point),(keys.get(key(point))??0)+1); }
  return [...keys.values()].some((count) => count > 2);
};

export const evaluateSweepFeature = async (feature: SweepFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Sweep features are not evaluated.");
  if (feature.orientation !== "followPath") return featureEvaluationFailure(feature.id, "FEATURE_OPERATION_UNSUPPORTED", "Solid Sweep supports Follow Path orientation.");
  if (feature.operation !== "new" && (!feature.targetFeatureId || !feature.dependencies.includes(feature.targetFeatureId))) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_MISSING", `Sweep ${feature.operation} requires an explicit target Feature dependency.`);
  if (feature.operation !== "new" && !context.runtime) return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Sweep ${feature.operation} requires CadRuntimeState.`);
  const profile = selectProfiles(feature.id, feature.profileSketchId, context, feature.profileIds); if ("status" in profile) return profile;
  const pathSketch = context.document.sketches[feature.pathSketchId]; if (!pathSketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Path Sketch ${feature.pathSketchId} was not found.`);
  const built = context.buildProfiles(pathSketch);
  const authoredPathEntities = pathSketch.entityOrder.map((id) => pathSketch.entities[id]).filter((entity) => entity && !entity.construction);
  const splinePath = authoredPathEntities.length === 1 && (authoredPathEntities[0].type === "bspline" || authoredPathEntities[0].type === "spline") && !authoredPathEntities[0].closed ? authoredPathEntities[0] : undefined;
  if (!splinePath && (built.openChains.length !== 1 || built.profiles.length)) return featureEvaluationFailure(feature.id, branching(pathSketch) ? "SWEEP_PATH_BRANCHING_UNSUPPORTED" : "SWEEP_PATH_NOT_CONTINUOUS", "Sweep requires one continuous, non-branching open Line/Arc or B-Spline path.");
  const path = built.openChains[0];
  if (!splinePath && !path?.segments.length) return featureEvaluationFailure(feature.id, "SWEEP_PATH_NOT_CONTINUOUS", "Sweep path has no usable exact curves.");
  const profileSketch = context.document.sketches[feature.profileSketchId]; if (!profileSketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Profile Sketch ${feature.profileSketchId} was not found.`);
  let shape: KernelShapeRef | undefined;
  try {
    const [profilePlane, pathPlane] = await Promise.all([resolveSketchPlaneFrame(profileSketch.plane, context), resolveSketchPlaneFrame(pathSketch.plane, context)]);
    const fitPoints = splinePath?.type === "bspline" ? splinePath.fitPoints : splinePath?.type === "spline" ? splinePath.controlPoints : undefined;
    const pathInput = {
      segments: splinePath ? [] : path.segments,
      plane: pathPlane,
      splinePoints: fitPoints?.map((point) => [point.x, point.y]),
      splinePeriodic: false,
      splineStartTangent: splinePath?.type === "bspline" && splinePath.startTangent ? [splinePath.startTangent.x, splinePath.startTangent.y] : undefined,
      splineEndTangent: splinePath?.type === "bspline" && splinePath.endTangent ? [splinePath.endTangent.x, splinePath.endTangent.y] : undefined,
    } as import("../kernel/KernelTypes.ts").KernelPathInput;
    const tools: KernelShapeRef[] = [];
    for (const materialRegion of profile.profiles) tools.push(await sweepClosedProfile(context.kernel, materialRegion, profilePlane, pathInput));
    const target = feature.operation === "new" ? undefined : getRuntimeFeatureShape(context.runtime!, feature.targetFeatureId!);
    if (feature.operation !== "new" && !target) {
      for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined);
      return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Target Feature ${feature.targetFeatureId} has not been evaluated.`);
    }
    shape = await applySolidFeatureOperation(context.kernel, tools, feature.operation, target);
    const validation = await context.kernel.validate(shape); if (!validation.valid) { await context.kernel.disposeShape(shape); shape = undefined; return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Sweep returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape, validation, warnings: [...profile.warnings, ...built.warnings, ...(splinePath ? ["Sweep path rebuilt as a native smooth OCCT interpolation curve."] : [])] };
  } catch (error) {
    if (shape) await context.kernel.disposeShape(shape).catch(() => undefined);
    if (error instanceof KernelError) {
      const code = error.code === "SWEEP_PATH_NOT_CONTINUOUS" ? "SWEEP_PATH_NOT_CONTINUOUS" : error.code === "SWEEP_PROFILE_PLACEMENT_INVALID" ? "SWEEP_PROFILE_PLACEMENT_INVALID" : "SWEEP_FAILED";
      return featureEvaluationFailure(feature.id, code, error.message, error, error.code);
    }
    return featureEvaluationFailure(feature.id, "SWEEP_FAILED", error instanceof Error ? error.message : String(error), error);
  }
};
