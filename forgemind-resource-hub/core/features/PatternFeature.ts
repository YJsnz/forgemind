import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export type PatternDefinition =
  | { type: "linear"; direction: Vec3; count: number; spacing: number }
  | { type: "circular"; axis: { origin: Vec3; direction: Vec3 }; count: number; angleDeg: number };

export interface PatternFeature extends BaseFeature {
  type: "pattern";
  sourceFeatureIds: UUID[];
  definition: PatternDefinition;
}
