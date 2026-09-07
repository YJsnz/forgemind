import type { CadToleranceSettings } from "../cad/Tolerance.ts";
import type { PocketFeature } from "../features/PocketFeature.ts";
import { KernelError, KernelReferenceError } from "../kernel/KernelErrors.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { KernelPlaneFrame, KernelShapeProperties, KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { selectSingleProfile } from "./ExtrudeEvaluator.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { extrudeClosedProfile } from "./ProfileExtrusion.ts";

const THROUGH_ALL_MARGIN_RATIO = .01;

const dot = (point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }): number =>
  point.x * normal.x + point.y * normal.y + point.z * normal.z;

const projectedBounds = (properties: KernelShapeProperties, normal: KernelPlaneFrame["normal"]): { min: number; max: number } => {
  const { min, max } = properties.boundingBox;
  const values = [
    { x: min.x, y: min.y, z: min.z }, { x: min.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z }, { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: min.z }, { x: max.x, y: max.y, z: max.z },
  ].map((corner) => dot(corner, normal));
  return { min: Math.min(...values), max: Math.max(...values) };
};

const throughAllToolFrame = (
  frame: KernelPlaneFrame,
  target: KernelShapeProperties,
  tolerance: CadToleranceSettings,
): { plane: KernelPlaneFrame; distanceMm: number } => {
  const extent = projectedBounds(target, frame.normal);
  const span = extent.max - extent.min;
  const margin = Math.max(tolerance.geometry * 10, span * THROUGH_ALL_MARGIN_RATIO);
  const start = extent.min - margin;
  const originProjection = dot(frame.origin, frame.normal);
  const offset = start - originProjection;
  return {
    plane: {
      ...frame,
      origin: {
        x: frame.origin.x + frame.normal.x * offset,
        y: frame.origin.y + frame.normal.y * offset,
        z: frame.origin.z + frame.normal.z * offset,
      },
    },
    distanceMm: span + margin * 2,
  };
};

const volumeTolerance = (volume: number, tolerance: CadToleranceSettings): number =>
  Math.max(tolerance.boolean, Math.abs(volume) * Number.EPSILON * 64);

const enclosesBoundingBox = (
  outer: KernelShapeProperties["boundingBox"],
  inner: KernelShapeProperties["boundingBox"],
  tolerance: number,
): boolean =>
  outer.min.x <= inner.min.x + tolerance && outer.min.y <= inner.min.y + tolerance && outer.min.z <= inner.min.z + tolerance
    && outer.max.x >= inner.max.x - tolerance && outer.max.y >= inner.max.y - tolerance && outer.max.z >= inner.max.z - tolerance;

/** Exact cutter construction shared with feature-level Pattern and Mirror. */
export const createPocketTool = async (
  feature: PocketFeature,
  targetShape: KernelShapeRef,
  context: FeatureEvaluationContext,
): Promise<{ tool: KernelShapeRef; warnings: string[] }> => {
  const profileSelection = selectSingleProfile(feature.id, feature.sketchId, context);
  if ("status" in profileSelection) throw profileSelection.error;
  const sketch = context.document.sketches[feature.sketchId];
  if (!sketch) throw new KernelError({ operation: "pocket", message: `Sketch ${feature.sketchId} was not found.`, code: "SKETCH_NOT_FOUND" });
  const frame = await resolveSketchPlaneFrame(sketch.plane, context);
  if (feature.depth.type === "blind") {
    if (!Number.isFinite(feature.depth.value) || feature.depth.value <= context.tolerance.geometry) throw new KernelError({ operation: "pocket", message: "Blind Pocket depth must exceed geometry tolerance.", code: "POCKET_DEPTH_UNSUPPORTED" });
    const shape = await extrudeClosedProfile(
      context.kernel,
      profileSelection.profile,
      frame,
      { distanceMm: feature.depth.value, direction: feature.direction ?? "negative" },
    );
    return { tool: shape, warnings: profileSelection.warnings };
  }
  const targetProperties = await context.kernel.getShapeProperties(targetShape);
  const tool = throughAllToolFrame(frame, targetProperties, context.tolerance);
  const shape = await extrudeClosedProfile(context.kernel, profileSelection.profile, tool.plane, { distanceMm: tool.distanceMm, direction: "positive" });
  return { tool: shape, warnings: profileSelection.warnings };
};

/** Evaluates a through-all or blind Pocket against an already-evaluated upstream feature. */
export const evaluatePocketFeature = async (
  feature: PocketFeature,
  context: FeatureEvaluationContext,
): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") {
    return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Pocket features are not evaluated.");
  }
  const targetFeatureId = feature.targetFeatureId;
  if (!targetFeatureId || !feature.dependencies.includes(targetFeatureId)) {
    return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_MISSING", "Pocket requires its target Feature as an explicit dependency.");
  }
  const runtimeState = context.runtime;
  if (!runtimeState) {
    return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", "Pocket evaluation requires CadRuntimeState.");
  }
  const targetShape = getRuntimeFeatureShape(runtimeState, targetFeatureId);
  if (!targetShape) {
    return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", `Target Feature ${targetFeatureId} has not been evaluated.`);
  }

  let toolShape: KernelShapeRef | undefined;
  try {
    const targetProperties = await context.kernel.getShapeProperties(targetShape);
    const targetVolume = targetProperties.volumeMm3;
    if (!Number.isFinite(targetVolume) || targetVolume <= volumeTolerance(targetVolume ?? 0, context.tolerance)) {
      return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Pocket target is not a non-empty solid.");
    }
    const created = await createPocketTool(feature, targetShape, context);
    toolShape = created.tool;
    const toolProperties = await context.kernel.getShapeProperties(toolShape);
    if (enclosesBoundingBox(toolProperties.boundingBox, targetProperties.boundingBox, context.tolerance.geometry)) {
      return featureEvaluationFailure(feature.id, "POCKET_REMOVES_ENTIRE_BODY", "Pocket tool encloses the target body's bounding box.");
    }
    const resultShape = await context.kernel.booleanCut(targetShape, [toolShape]);
    const [validation, resultProperties] = await Promise.all([
      context.kernel.validate(resultShape),
      context.kernel.getShapeProperties(resultShape),
    ]);
    if (!validation.valid) {
      await context.kernel.disposeShape(resultShape);
      return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Pocket Boolean Cut returned an invalid shape.");
    }
    const resultVolume = resultProperties.volumeMm3 ?? 0;
    if (resultVolume <= volumeTolerance(targetVolume, context.tolerance)) {
      await context.kernel.disposeShape(resultShape);
      return featureEvaluationFailure(feature.id, "POCKET_REMOVES_ENTIRE_BODY", "Pocket tool removes the entire target body.");
    }
    if (Math.abs(targetVolume - resultVolume) <= volumeTolerance(targetVolume, context.tolerance)) {
      await context.kernel.disposeShape(resultShape);
      return featureEvaluationFailure(feature.id, "POCKET_NO_INTERSECTION", "Pocket tool does not intersect the target body.");
    }
    return { status: "success", featureId: feature.id, shape: resultShape, validation, warnings: created.warnings };
  } catch (error) {
    if (error instanceof KernelReferenceError) {
      return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", error.message, error, error.code);
    }
    if (error instanceof KernelError) {
      const code = error.code === "BOOLEAN_EMPTY_RESULT" || error.code === "BOOLEAN_RESULT_NOT_SOLID"
        ? "POCKET_REMOVES_ENTIRE_BODY"
        : "KERNEL_FAILURE";
      return featureEvaluationFailure(feature.id, code, error.message, error, error.code);
    }
    return featureEvaluationFailure(feature.id, "KERNEL_FAILURE", error instanceof Error ? error.message : String(error), error);
  } finally {
    if (toolShape) await context.kernel.disposeShape(toolShape).catch(() => undefined);
  }
};
