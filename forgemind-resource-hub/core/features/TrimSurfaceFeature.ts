import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Trims a Surface Body with an exact B-Rep tool using Cut/Common semantics. */
export interface TrimSurfaceFeature extends BaseFeature {
  type: "trimSurface";
  targetFeatureId: UUID;
  toolFeatureId: UUID;
  keep: "outside" | "inside";
  toleranceMm: number;
}
