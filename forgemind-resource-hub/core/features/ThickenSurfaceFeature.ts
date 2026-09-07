import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Converts a Face/Shell into a solid using exact OCCT offset/thickening. */
export interface ThickenSurfaceFeature extends BaseFeature {
  type: "thickenSurface";
  targetFeatureId: UUID;
  thicknessMm: number;
  toleranceMm: number;
}
