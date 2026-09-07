import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface BodyTransformFeature extends BaseFeature {
  type: "bodyTransform";
  bodyId: UUID;
  inputFeatureId: UUID;
  translationMm: Vec3;
  rotation?: { axis: "X" | "Y" | "Z"; angleDeg: number };
}
