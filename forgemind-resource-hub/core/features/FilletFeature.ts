import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentEdgeRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

export interface FilletFeature extends BaseFeature {
  type: "fillet";
  targetFeatureId: UUID;
  edges: PersistentEdgeRef[];
  /** Start radius. When endRadiusMm is present, exactly one edge is blended with a varying radius. */
  radiusMm: number;
  endRadiusMm?: number;
}
