import type { Vec3, UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface SurfaceRevolveFeature extends BaseFeature {
  type: "surfaceRevolve";
  sketchId: UUID;
  axis: { origin: Vec3; direction: Vec3 };
  angleDeg: number;
}
