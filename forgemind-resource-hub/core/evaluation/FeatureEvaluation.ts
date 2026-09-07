import type { UUID } from "../cad/CadTypes.ts";
import type { Feature } from "../features/Feature.ts";
import type { KernelShapeRef, KernelValidationResult } from "../kernel/KernelTypes.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import { FeatureEvaluationError } from "./FeatureEvaluationError.ts";
import { evaluateExtrudeFeature } from "./ExtrudeEvaluator.ts";
import { evaluatePocketFeature } from "./PocketEvaluator.ts";
import { evaluateRevolveFeature } from "./RevolveEvaluator.ts";
import { evaluateHoleFeature } from "./HoleEvaluator.ts";
import { evaluateEdgeTreatment } from "./EdgeTreatmentEvaluator.ts";
import { evaluateShellFeature } from "./ShellEvaluator.ts";
import { evaluateFeaturePattern } from "./FeaturePatternEvaluator.ts";
import { evaluateSweepFeature } from "./SweepEvaluator.ts";
import { evaluateLoftFeature } from "./LoftEvaluator.ts";
import { evaluateDraftFeature } from "./DraftEvaluator.ts";
import { evaluateRibFeature } from "./RibEvaluator.ts";
import { evaluateBodyTransformFeature } from "./BodyTransformEvaluator.ts";
import { evaluateBodyBooleanFeature } from "./BodyBooleanEvaluator.ts";
import { evaluateImportedStepFeature } from "./ImportedStepEvaluator.ts";
import { evaluateRemoveHoleFeature } from "./RemoveHoleEvaluator.ts";
import { evaluateOffsetBodyFeature } from "./OffsetBodyEvaluator.ts";
import { evaluatePlanarPushPullFeature } from "./PlanarPushPullEvaluator.ts";
import { evaluateDeleteFaceFeature } from "./DeleteFaceEvaluator.ts";
import { evaluateHealHolePatternFeature } from "./HealHolePatternEvaluator.ts";
import { evaluateSurfaceFeature } from "./SurfaceFeatureEvaluator.ts";
import { evaluateMechanicalDetail } from "./MechanicalDetailEvaluator.ts";

export interface FeatureEvaluationSuccess {
  status: "success";
  featureId: UUID;
  shape: KernelShapeRef;
  validation: KernelValidationResult;
  warnings: string[];
}

export interface FeatureEvaluationFailure {
  status: "failed";
  featureId: UUID;
  error: FeatureEvaluationError;
}

export type FeatureEvaluationResult = FeatureEvaluationSuccess | FeatureEvaluationFailure;

export const featureEvaluationFailure = (
  featureId: UUID,
  code: ConstructorParameters<typeof FeatureEvaluationError>[0]["code"],
  message: string,
  cause?: unknown,
  kernelCode?: string,
): FeatureEvaluationFailure => ({
  status: "failed",
  featureId,
  error: new FeatureEvaluationError({ code, featureId, message, cause, kernelCode }),
});

/** Evaluates exactly one Feature; graph traversal and rebuild remain future work. */
export const evaluateFeature = async (
  featureId: UUID,
  context: FeatureEvaluationContext,
): Promise<FeatureEvaluationResult> => {
  const feature = context.document.features[featureId];
  if (!feature) return featureEvaluationFailure(featureId, "FEATURE_UNSUPPORTED", `Feature ${featureId} was not found in the document.`);
  return evaluateKnownFeature(feature, context);
};

const evaluateKnownFeature = async (
  feature: Feature,
  context: FeatureEvaluationContext,
): Promise<FeatureEvaluationResult> => {
  if (feature.type === "extrude") return evaluateExtrudeFeature(feature, context);
  if (feature.type === "pocket") return evaluatePocketFeature(feature, context);
  if (feature.type === "revolve") return evaluateRevolveFeature(feature, context);
  if (feature.type === "hole") return evaluateHoleFeature(feature, context);
  if (feature.type === "sweep") return evaluateSweepFeature(feature, context);
  if (feature.type === "loft") return evaluateLoftFeature(feature, context);
  if (feature.type === "draft") return evaluateDraftFeature(feature, context);
  if (feature.type === "rib") return evaluateRibFeature(feature, context);
  if (feature.type === "bodyTransform") return evaluateBodyTransformFeature(feature, context);
  if (feature.type === "bodyBoolean") return evaluateBodyBooleanFeature(feature, context);
  if (feature.type === "importedStep") return evaluateImportedStepFeature(feature, context);
  if (feature.type === "removeHole") return evaluateRemoveHoleFeature(feature, context);
  if (feature.type === "offsetBody") return evaluateOffsetBodyFeature(feature, context);
  if (feature.type === "planarPushPull") return evaluatePlanarPushPullFeature(feature, context);
  if (feature.type === "deleteFace") return evaluateDeleteFaceFeature(feature, context);
  if (feature.type === "healHolePattern") return evaluateHealHolePatternFeature(feature, context);
  if (feature.type === "mechanicalDetail") return evaluateMechanicalDetail(feature, context);
  if (["surfacePatch", "surfaceExtrude", "surfaceRevolve", "surfaceSweep", "surfaceLoft", "extractSurface", "offsetSurface", "sewSurface", "thickenSurface", "encloseSurface", "fillSurface", "trimSurface", "bsplineSurface", "boundarySurface", "splitSurface", "replaceFace", "surfaceIntersection"].includes(feature.type)) return evaluateSurfaceFeature(feature, context);
  if (feature.type === "linearPattern" || feature.type === "circularPattern" || feature.type === "mirror") return evaluateFeaturePattern(feature, context);
  if (feature.type === "fillet" || feature.type === "chamfer") return evaluateEdgeTreatment(feature, context);
  if (feature.type === "shell") return evaluateShellFeature(feature, context);
  return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", `Feature type ${feature.type} is not supported by Feature Evaluation v1.`);
};
