import type { CadDocument } from "./CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "./CadDocumentPersistence.ts";
import type { CadAssetStore, StepAsset } from "./CadAssets.ts";
import { createCadAssetStore } from "./CadAssets.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export const CAD_PROJECT_BUNDLE_VERSION = 1 as const;
export interface SerializedStepAsset { id: string; kind: "step"; fileName: string; byteLength: number; contentHash: string; base64: string; manifest?: StepAsset["manifest"]; }
export interface CadProjectBundle { version: typeof CAD_PROJECT_BUNDLE_VERSION; document: ReturnType<typeof serializeCadDocument>; assets: SerializedStepAsset[]; }
const encode = (data: Uint8Array) => { let binary = ""; for (const byte of data) binary += String.fromCharCode(byte); return btoa(binary); };
const decode = (base64: string) => { const binary = atob(base64); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); };
const referenced = (document: CadDocument<Sketch, Feature>) => new Set(Object.values(document.features).filter((feature) => feature.type === "importedStep").map((feature) => feature.stepAssetId));
/** Current design plus only assets it references; History is never serialized. */
export const serializeCadProjectBundle = (document: CadDocument<Sketch, Feature>, store: CadAssetStore): CadProjectBundle => ({ version: CAD_PROJECT_BUNDLE_VERSION, document: serializeCadDocument(document), assets: [...store.assets.values()].filter((asset) => referenced(document).has(asset.id)).map((asset) => ({ id: asset.id, kind: "step", fileName: asset.fileName, byteLength: asset.byteLength, contentHash: asset.contentHash, base64: encode(asset.data), manifest: asset.manifest })) });
export const deserializeCadProjectBundle = (input: unknown): { document: CadDocument<Sketch, Feature>; assets: CadAssetStore } => {
  if (!input || typeof input !== "object") throw new Error("CAD project bundle must be an object."); const source = input as Partial<CadProjectBundle>;
  if (source.version === undefined) return { document: deserializeCadDocument(input), assets: createCadAssetStore() };
  if (source.version !== CAD_PROJECT_BUNDLE_VERSION || !Array.isArray(source.assets)) throw new Error("CAD project bundle version is unsupported.");
  const assets: StepAsset[] = source.assets.map((asset) => { if (!asset || asset.kind !== "step" || typeof asset.base64 !== "string") throw new Error("STEP asset is malformed."); const data = decode(asset.base64); if (data.byteLength !== asset.byteLength) throw new Error("STEP asset byte length is malformed."); return { id: asset.id, kind: "step", fileName: asset.fileName, byteLength: asset.byteLength, contentHash: asset.contentHash, data, manifest: asset.manifest }; });
  return { document: deserializeCadDocument(source.document), assets: createCadAssetStore(assets) };
};
