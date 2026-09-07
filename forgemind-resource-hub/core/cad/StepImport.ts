import type { CadDocument } from "./CadDocument.ts";
import { addStepAsset, withStepImportManifest, type CadAssetStore, type StepSolidSignature } from "./CadAssets.ts";
import { createCadBody } from "./CadBodies.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

const nextId = (taken: Record<string, unknown>, prefix: string) => { let index = 1; while (taken[`${prefix}${index}`]) index += 1; return `${prefix}${index}`; };
const signature = (properties: Awaited<ReturnType<CadKernel["getShapeProperties"]>>): StepSolidSignature => ({ volumeMm3: properties.volumeMm3, surfaceAreaMm2: properties.surfaceAreaMm2, centerOfMassMm: properties.centerOfMassMm ? [properties.centerOfMassMm.x, properties.centerOfMassMm.y, properties.centerOfMassMm.z] : undefined, boundingBox: { min: [properties.boundingBox.min.x, properties.boundingBox.min.y, properties.boundingBox.min.z], max: [properties.boundingBox.max.x, properties.boundingBox.max.y, properties.boundingBox.max.z] } });
const keyOf = (value: StepSolidSignature) => [value.centerOfMassMm ?? [0, 0, 0], value.boundingBox.min, value.boundingBox.max, value.volumeMm3 ?? 0, value.surfaceAreaMm2 ?? 0].flat().map((entry) => Math.round(Number(entry) * 1e6)).join(":");
const compare = (left: { sourceSignature: StepSolidSignature }, right: { sourceSignature: StepSolidSignature }) => keyOf(left.sourceSignature).localeCompare(keyOf(right.sourceSignature));
/** Atomic design import: parse/validate every solid first, then return one new
 * document and immutable asset store. Runtime source shapes are released. */
export const importStepIntoDocument = async (document: CadDocument<Sketch, Feature>, assets: CadAssetStore, kernel: CadKernel, fileName: string, data: Uint8Array): Promise<{ document: CadDocument<Sketch, Feature>; assets: CadAssetStore }> => {
  const added = addStepAsset(assets, fileName, data); const imported = await kernel.importStep(added.asset.data);
  try {
    const details = (await Promise.all(imported.solids.map(async (solid) => { const validation = await kernel.validate(solid.shape); if (!validation.valid) throw new Error(`STEP solid ${solid.ordinal} is invalid.`); return { ordinal: solid.ordinal, sourceSignature: signature(await kernel.getShapeProperties(solid.shape)) }; }))).sort(compare);
    const manifest = added.asset.manifest ?? { solids: details.map((detail, index) => ({ solidKey: `${added.asset.id}:solid:${index + 1}`, sourceOrdinal: detail.ordinal, signature: detail.sourceSignature })) };
    const store = added.asset.manifest ? added.store : withStepImportManifest(added.store, added.asset.id, manifest);
    const bodies = { ...document.bodies }; const features = { ...document.features }; const featureOrder = [...document.featureOrder]; let activeBodyId = document.activeBodyId;
    for (const [index] of details.entries()) { const bodyId = nextId(bodies, "ImportedBody"); const featureId = nextId(features, "ImportedStep"); const manifestSolid = manifest.solids[index]; bodies[bodyId] = createCadBody(bodyId, `${fileName} Body ${index + 1}`); features[featureId] = { id: featureId, name: `${fileName} Import ${index + 1}`, type: "importedStep", bodyId, stepAssetId: added.asset.id, solidKey: manifestSolid.solidKey, solidOrdinal: manifestSolid.sourceOrdinal, sourceSignature: manifestSolid.signature, enabled: true, state: "clean", dependencies: [] } as Feature; featureOrder.push(featureId); if (!activeBodyId) activeBodyId = bodyId; }
    return { assets: store, document: { ...document, bodies, features, featureOrder, activeBodyId, updatedAt: Date.now() } };
  } finally { for (const solid of imported.solids) await kernel.disposeShape(solid.shape); }
};
