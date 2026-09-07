import type { ImportedStepFeature } from "../features/ImportedStepFeature.ts";
import { getStepAsset } from "../cad/CadAssets.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

const close = (left: number, right: number) => Math.abs(left - right) <= Math.max(.001, Math.abs(right) * 1e-7);
const signature = (properties: Awaited<ReturnType<FeatureEvaluationContext["kernel"]["getShapeProperties"]>>) => ({ volumeMm3: properties.volumeMm3, surfaceAreaMm2: properties.surfaceAreaMm2, centerOfMassMm: properties.centerOfMassMm ? [properties.centerOfMassMm.x, properties.centerOfMassMm.y, properties.centerOfMassMm.z] as [number, number, number] : undefined, boundingBox: { min: [properties.boundingBox.min.x, properties.boundingBox.min.y, properties.boundingBox.min.z] as [number, number, number], max: [properties.boundingBox.max.x, properties.boundingBox.max.y, properties.boundingBox.max.z] as [number, number, number] } });
const keyOf = (value: ReturnType<typeof signature>) => [value.centerOfMassMm ?? [0, 0, 0], value.boundingBox.min, value.boundingBox.max, value.volumeMm3 ?? 0, value.surfaceAreaMm2 ?? 0].flat().map((entry) => Math.round(Number(entry) * 1e6)).join(":");
const matches = (actual: ReturnType<typeof signature>, expected: ReturnType<typeof signature>) => [actual.volumeMm3, actual.surfaceAreaMm2, ...(actual.centerOfMassMm ?? []), ...actual.boundingBox.min, ...actual.boundingBox.max].every((value, index) => close(value ?? NaN, [expected.volumeMm3, expected.surfaceAreaMm2, ...(expected.centerOfMassMm ?? []), ...expected.boundingBox.min, ...expected.boundingBox.max][index] ?? NaN));
export const evaluateImportedStepFeature = async (feature: ImportedStepFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const asset = getStepAsset(context.assets, feature.stepAssetId); if (!asset) return featureEvaluationFailure(feature.id, "STEP_ASSET_MISSING", `STEP asset ${feature.stepAssetId} is unavailable.`);
  try { const imported = await context.kernel.importStep(asset.data); const candidates = await Promise.all(imported.solids.map(async (solid) => ({ solid, sourceSignature: signature(await context.kernel.getShapeProperties(solid.shape)) }))); candidates.sort((left, right) => keyOf(left.sourceSignature).localeCompare(keyOf(right.sourceSignature)));
    const manifest = asset.manifest?.solids.find((solid) => solid.solidKey === feature.solidKey);
    const expected = manifest?.signature ?? feature.sourceSignature; const selectedCandidates = candidates.filter((candidate) => matches(candidate.sourceSignature, expected));
    if (selectedCandidates.length !== 1) { for (const candidate of candidates) await context.kernel.disposeShape(candidate.solid.shape); return featureEvaluationFailure(feature.id, selectedCandidates.length ? "STEP_SOLID_MAPPING_AMBIGUOUS" : "STEP_SOLID_MAPPING_MISMATCH", selectedCandidates.length ? "STEP solid mapping is ambiguous for identical co-located solids." : "STEP source no longer matches the persisted solid signature."); }
    const selected = selectedCandidates[0].solid;
    const validation = await context.kernel.validate(selected.shape); if (!validation.valid) { await context.kernel.disposeShape(selected.shape); return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Imported STEP solid is invalid."); }
    for (const candidate of candidates) if (candidate.solid !== selected) await context.kernel.disposeShape(candidate.solid.shape);
    return { status: "success", featureId: feature.id, shape: selected.shape, validation, warnings: imported.warnings };
  } catch (error) { return featureEvaluationFailure(feature.id, "STEP_IMPORT_FAILED", error instanceof Error ? error.message : String(error), error); }
};
