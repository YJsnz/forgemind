import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/** Copies one or more exact B-Rep faces into a new surface Body. */
export interface ExtractSurfaceFeature extends BaseFeature {
  type: "extractSurface";
  targetFeatureId: UUID;
  faces: PersistentFaceRef[];
  toleranceMm: number;
}
