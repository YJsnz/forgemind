import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** A single-body, symmetric open-sketch rib. All dimensions are millimetres. */
export interface RibFeature extends BaseFeature {
  type: "rib";
  targetFeatureId: UUID;
  sketchId: UUID;
  thicknessMm: number;
  heightMm: number;
  direction?: "positive" | "negative";
}
