import type { UUID, Vec2 } from "../cad/CadTypes.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/** Old projects omit this field; omission is deliberately equivalent to simple. */
export type HoleStyle =
  | { type: "simple" }
  | { type: "counterbore"; diameterMm: number; depthMm: number }
  | { type: "countersink"; diameterMm: number; includedAngleDeg: number };

export interface HoleFeature extends BaseFeature {
  type: "hole";
  targetFeatureId: UUID;
  targetFace: PersistentFaceRef;
  center: Vec2;
  diameterMm: number;
  depth: { type: "throughAll" } | { type: "blind"; valueMm: number };
  style?: HoleStyle;
}
