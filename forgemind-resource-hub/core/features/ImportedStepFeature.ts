import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface ImportedSolidSignature { volumeMm3?: number; surfaceAreaMm2?: number; centerOfMassMm?: [number, number, number]; boundingBox: { min: [number, number, number]; max: [number, number, number] }; }
export interface ImportedStepFeature extends BaseFeature {
  type: "importedStep";
  bodyId: UUID;
  stepAssetId: UUID;
  /** Stable source identity resolved through the asset manifest, never an OCCT handle. */
  solidKey: string;
  solidOrdinal: number;
  sourceSignature: ImportedSolidSignature;
}
