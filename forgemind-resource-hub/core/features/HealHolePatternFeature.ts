import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/**
 * V9 imported-pattern healing Feature.
 * All member references remain anchored to the same imported/native source
 * Feature state so a complete repeated-hole set can be filled in one rebuild.
 */
export interface HealHolePatternFeature extends BaseFeature {
  type: "healHolePattern";
  targetFeatureId: UUID;
  cylindricalFaces: PersistentFaceRef[];
  axialMarginMm?: number;
}
