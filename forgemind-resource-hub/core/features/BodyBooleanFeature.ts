import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface BodyStateRef { bodyId: UUID; featureId: UUID; }

/** A target-owned, design-only cross-body Boolean. Body-state references are
 * fixed at authoring time, preventing a dependency on a future Body tip. */
export interface BodyBooleanFeature extends BaseFeature {
  type: "bodyBoolean";
  bodyId: UUID;
  operation: "union" | "cut" | "intersect";
  target: BodyStateRef;
  tools: BodyStateRef[];
  keepToolBody: boolean;
}
