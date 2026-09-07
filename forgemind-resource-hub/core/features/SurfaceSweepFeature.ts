import type { UUID } from "../cad/CadTypes.ts";
import type { Vec3 } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface SurfaceSweepFeature extends BaseFeature {
  type: "surfaceSweep";
  profileSketchId: UUID;
  pathSketchId: UUID;
  guideSketchId?: UUID;
  orientation: "followPath" | "fixedUp" | "guide";
  upDirection?: Vec3;
}
