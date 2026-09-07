import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Extrudes a sketch boundary as a sheet/shell, not a capped solid. */
export interface SurfaceExtrudeFeature extends BaseFeature {
  type: "surfaceExtrude";
  sketchId: UUID;
  distanceMm: number;
  direction: "positive" | "negative" | "symmetric";
}
