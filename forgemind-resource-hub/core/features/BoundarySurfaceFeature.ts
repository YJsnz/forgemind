import type { PersistentEdgeRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

export type SurfaceBoundaryContinuity = "G0" | "G1" | "G2";

/**
 * User-confirmed exact B-Rep edge loop. G1/G2 are strict acceptance targets:
 * the generated patch is committed only when every boundary passes native
 * OCCT normal/curvature sampling against an adjacent support face.
 */
export interface BoundarySurfaceFeature extends BaseFeature {
  type: "boundarySurface";
  boundaryEdges: PersistentEdgeRef[];
  continuity: SurfaceBoundaryContinuity;
  toleranceMm: number;
  verification?: {
    sampleCount: number;
    angularToleranceDeg: number;
    curvatureTolerance: number;
  };
}
