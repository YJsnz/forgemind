import type { RibFeature } from "../features/RibFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { ClosedProfile } from "../sketch/SketchProfile.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import { featureEvaluationFailure, type FeatureEvaluationResult } from "./FeatureEvaluation.ts";

const ribProfile = (feature: RibFeature, context: FeatureEvaluationContext): ClosedProfile | FeatureEvaluationResult => {
  const sketch = context.document.sketches[feature.sketchId];
  if (!sketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Sketch ${feature.sketchId} was not found.`);
  const built = context.buildProfiles(sketch);
  if (built.profiles.length) return featureEvaluationFailure(feature.id, "RIB_REQUIRES_OPEN_SKETCH", "Rib requires one open sketch line, not a closed profile.");
  if (built.openChains.length !== 1 || built.openChains[0]!.reason !== "open") return featureEvaluationFailure(feature.id, "RIB_REQUIRES_OPEN_SKETCH", "Rib V1 requires exactly one open line chain.");
  const chain = built.openChains[0]!;
  if (chain.segments.length !== 1 || chain.segments[0]!.type !== "line") return featureEvaluationFailure(feature.id, "RIB_REQUIRES_SINGLE_LINE", "Rib V1 supports exactly one non-zero Line.");
  const line = chain.segments[0]; const dx = line.end[0] - line.start[0]; const dy = line.end[1] - line.start[1]; const length = Math.hypot(dx, dy);
  if (length <= context.tolerance.geometry) return featureEvaluationFailure(feature.id, "RIB_REQUIRES_SINGLE_LINE", "Rib center line must have positive length.");
  const offsetX = -dy / length * feature.thicknessMm / 2; const offsetY = dx / length * feature.thicknessMm / 2;
  return { id: `${feature.id}:strip`, outer: [
    { type: "line", start: [line.start[0] + offsetX, line.start[1] + offsetY], end: [line.end[0] + offsetX, line.end[1] + offsetY] },
    { type: "line", start: [line.end[0] + offsetX, line.end[1] + offsetY], end: [line.end[0] - offsetX, line.end[1] - offsetY] },
    { type: "line", start: [line.end[0] - offsetX, line.end[1] - offsetY], end: [line.start[0] - offsetX, line.start[1] - offsetY] },
    { type: "line", start: [line.start[0] - offsetX, line.start[1] - offsetY], end: [line.start[0] + offsetX, line.start[1] + offsetY] },
  ], holes: [] };
};

export const evaluateRibFeature = async (feature: RibFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Rib features are not evaluated.");
  if (!Number.isFinite(feature.thicknessMm) || feature.thicknessMm <= context.tolerance.geometry) return featureEvaluationFailure(feature.id, "RIB_INVALID_THICKNESS", "Rib thickness must be finite and greater than tolerance.");
  if (!Number.isFinite(feature.heightMm) || feature.heightMm <= context.tolerance.geometry) return featureEvaluationFailure(feature.id, "RIB_INVALID_HEIGHT", "Rib height must be finite and greater than tolerance.");
  const runtime = context.runtime; const target = runtime ? getRuntimeFeatureShape(runtime, feature.targetFeatureId) : undefined;
  if (!runtime || !target || !feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Rib requires an evaluated target Feature.");
  const profile = ribProfile(feature, context); if ("status" in profile) return profile;
  const sketch = context.document.sketches[feature.sketchId]!; let tool;
  try {
    const plane = await resolveSketchPlaneFrame(sketch.plane, context);
    tool = await context.kernel.extrude({ profile, plane }, { distanceMm: feature.heightMm, direction: feature.direction ?? "positive" });
    const shape = await context.kernel.booleanUnion(target, [tool]); const validation = await context.kernel.validate(shape);
    if (!validation.valid) { await context.kernel.disposeShape(shape); return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Rib Boolean returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape, validation, warnings: [] };
  } catch (error) {
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, "RIB_FAILED", error.message, error, error.code);
    return featureEvaluationFailure(feature.id, "RIB_FAILED", error instanceof Error ? error.message : String(error), error);
  } finally { if (tool) await context.kernel.disposeShape(tool).catch(() => undefined); }
};
