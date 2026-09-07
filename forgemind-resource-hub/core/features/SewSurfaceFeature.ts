import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface SewSurfaceFeature extends BaseFeature {
  type: "sewSurface";
  sourceFeatureIds: UUID[];
  toleranceMm: number;
}
