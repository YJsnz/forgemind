import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface OffsetSurfaceFeature extends BaseFeature {
  type: "offsetSurface";
  targetFeatureId: UUID;
  distanceMm: number;
  toleranceMm: number;
}
