import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Creates an exact planar B-Rep Face from one closed sketch profile. */
export interface SurfacePatchFeature extends BaseFeature {
  type: "surfacePatch";
  sketchId: UUID;
}
