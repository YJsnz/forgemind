import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export type PocketDepth =
  | { type: "blind"; value: number }
  | { type: "throughAll" };

export interface PocketFeature extends BaseFeature {
  type: "pocket";
  sketchId: UUID;
  targetFeatureId?: UUID;
  targetBodyId?: UUID;
  depth: PocketDepth;
  direction?: "positive" | "negative";
}
