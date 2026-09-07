import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Exact BRepAlgoAPI_Section result between two rebuilt surfaces/solids.
 * The resulting edge compound can be selected, projected into a sketch and
 * used as a persistent reference by downstream curve/surface operations. */
export interface SurfaceIntersectionFeature extends BaseFeature {
  type: "surfaceIntersection";
  sourceFeatureIds: [UUID, UUID];
  toleranceMm: number;
}
