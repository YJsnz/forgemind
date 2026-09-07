import type { PersistentEdgeRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/** Builds an exact OCCT filling face from a user-confirmed closed B-Rep edge loop. */
export interface FillSurfaceFeature extends BaseFeature {
  type: "fillSurface";
  boundaryEdges: PersistentEdgeRef[];
  toleranceMm: number;
}
