import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentEdgeRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

export interface ChamferFeature extends BaseFeature {
  type: "chamfer";
  targetFeatureId: UUID;
  edges: PersistentEdgeRef[];
  distanceMm: number;
}
