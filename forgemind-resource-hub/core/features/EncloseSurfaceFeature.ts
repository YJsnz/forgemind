import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Seams a closed set of faces/shells and solidifies the enclosed volume. */
export interface EncloseSurfaceFeature extends BaseFeature {
  type: "encloseSurface";
  sourceFeatureIds: UUID[];
  toleranceMm: number;
}
