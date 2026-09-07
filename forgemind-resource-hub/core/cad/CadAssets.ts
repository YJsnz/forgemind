import type { UUID } from "./CadTypes.ts";

export interface StepSolidSignature { volumeMm3?: number; surfaceAreaMm2?: number; centerOfMassMm?: [number, number, number]; boundingBox: { min: [number, number, number]; max: [number, number, number] }; }
export interface StepImportManifestSolid { solidKey: string; sourceOrdinal: number; signature: StepSolidSignature; }
export interface StepImportManifest { solids: StepImportManifestSolid[]; }
export interface StepAsset { id: UUID; kind: "step"; fileName: string; byteLength: number; contentHash: string; data: Uint8Array; manifest?: StepImportManifest; }
export interface CadAssetStore { readonly assets: ReadonlyMap<UUID, StepAsset>; }

const hash = (data: Uint8Array): string => { let value = 2166136261; for (const byte of data) { value ^= byte; value = Math.imul(value, 16777619); } return `step-${(value >>> 0).toString(16).padStart(8, "0")}`; };
export const createCadAssetStore = (assets: readonly StepAsset[] = []): CadAssetStore => ({ assets: new Map(assets.map((asset) => [asset.id, { ...asset, data: new Uint8Array(asset.data) }])) });
/** Immutable source deduplication; a content hash is never a geometry identity. */
export const addStepAsset = (store: CadAssetStore, fileName: string, data: Uint8Array): { store: CadAssetStore; asset: StepAsset; deduplicated: boolean } => {
  const contentHash = hash(data); const existing = [...store.assets.values()].find((asset) => asset.kind === "step" && asset.contentHash === contentHash && asset.byteLength === data.byteLength && asset.data.every((byte, index) => byte === data[index]));
  if (existing) return { store, asset: existing, deduplicated: true };
  const asset: StepAsset = { id: `step-${contentHash.slice(5)}`, kind: "step", fileName, byteLength: data.byteLength, contentHash, data: new Uint8Array(data) };
  return { store: createCadAssetStore([...store.assets.values(), asset]), asset, deduplicated: false };
};
export const withStepImportManifest = (store: CadAssetStore, assetId: UUID, manifest: StepImportManifest): CadAssetStore => {
  const asset = store.assets.get(assetId); if (!asset) throw new Error(`STEP asset ${assetId} is unavailable.`);
  const replacement: StepAsset = { ...asset, manifest: { solids: manifest.solids.map((solid) => ({ ...solid, signature: { ...solid.signature, boundingBox: { min: [...solid.signature.boundingBox.min] as [number, number, number], max: [...solid.signature.boundingBox.max] as [number, number, number] }, centerOfMassMm: solid.signature.centerOfMassMm ? [...solid.signature.centerOfMassMm] as [number, number, number] : undefined } })) } };
  return createCadAssetStore([...store.assets.values()].map((entry) => entry.id === assetId ? replacement : entry));
};
export const getStepAsset = (store: CadAssetStore | undefined, assetId: UUID): StepAsset | undefined => store?.assets.get(assetId);
