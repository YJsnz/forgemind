import type { LoftFeature } from "../features/LoftFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { selectProfiles } from "./ExtrudeEvaluator.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import { loftClosedProfiles } from "./ProfileSolidConstruction.ts";
import { applySolidFeatureOperation } from "./SolidFeatureOperation.ts";
import { applyLoftEndConditions } from "./LoftEndConditions.ts";

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;

export const evaluateLoftFeature = async (feature: LoftFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Loft features are not evaluated.");
  if (feature.sectionSketchIds.length < 2) return featureEvaluationFailure(feature.id, "LOFT_REQUIRES_CLOSED_SECTION", "Loft requires at least two ordered closed sections.");
  const operation = feature.operation ?? "new";
  if (operation !== "new" && (!feature.targetFeatureId || !feature.dependencies.includes(feature.targetFeatureId))) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_MISSING", "Loft operation requires an explicit target Feature dependency.");
  if (operation !== "new" && !context.runtime) return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", "Loft operation requires CadRuntimeState.");
  const sections: Array<{ profiles: ReturnType<typeof context.buildProfiles>["profiles"]; plane: Awaited<ReturnType<typeof resolveSketchPlaneFrame>> }> = [];
  const warnings: string[] = [];
  let tools: KernelShapeRef[] = [];
  let shape: KernelShapeRef | undefined;
  try {
    for (let index = 0; index < feature.sectionSketchIds.length; index += 1) {
      const id = feature.sectionSketchIds[index];
      const selected = selectProfiles(feature.id, id, context, feature.sectionProfileIds?.[index]);
      if ("status" in selected) return featureEvaluationFailure(feature.id, "LOFT_REQUIRES_CLOSED_SECTION", selected.error.message, selected.error);
      const sketch = context.document.sketches[id];
      if (!sketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", "Section Sketch was not found.");
      sections.push({ profiles: selected.profiles, plane: await resolveSketchPlaneFrame(sketch.plane, context) });
      warnings.push(...selected.warnings);
    }
    const regionCount = sections[0].profiles.length;
    if (sections.some((section) => section.profiles.length !== regionCount)) return featureEvaluationFailure(feature.id, "LOFT_INVALID_SECTION", "Every Loft section must select the same number of material regions.");
    for (const section of sections.slice(1)) {
      if (Math.abs(Math.abs(dot(sections[0].plane.normal, section.plane.normal)) - 1) > 1e-6) return featureEvaluationFailure(feature.id, "LOFT_INVALID_SECTION", "Loft V1 requires parallel section planes.");
    }
    const target = operation === "new" ? undefined : getRuntimeFeatureShape(context.runtime!, feature.targetFeatureId!);
    if (operation !== "new" && !target) return featureEvaluationFailure(feature.id, "TARGET_FEATURE_NOT_EVALUATED", "Target Feature has not been evaluated.");
    for (let index = 0; index < regionCount; index += 1) {
      const prepared = applyLoftEndConditions(sections.map((section) => ({ profile: section.profiles[index], plane: section.plane })), feature.startCondition, feature.endCondition, feature);
      tools.push(await loftClosedProfiles(context.kernel, prepared, { ruled: feature.ruled ?? false, closed: feature.closed }));
    }
    const consumed = tools;
    tools = []; // The operation helper owns all tools, including on failure.
    shape = await applySolidFeatureOperation(context.kernel, consumed, operation, target);
    const validation = await context.kernel.validate(shape);
    if (!validation.valid) return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Loft returned an invalid B-Rep.");
    const result = { status: "success" as const, featureId: feature.id, shape, validation, warnings };
    shape = undefined; // Transfer only the validated result to the caller.
    return result;
  } catch (error) {
    return featureEvaluationFailure(feature.id, "LOFT_FAILED", error instanceof Error ? error.message : String(error), error, error instanceof KernelError ? error.code : undefined);
  } finally {
    if (shape) await context.kernel.disposeShape(shape).catch(() => undefined);
    for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined);
  }
};
