import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface ExtrudeFeature extends BaseFeature {
  type: "extrude";
  sketchId: UUID;
  /** Millimetres. */
  distance: number;
  direction?: "positive" | "negative" | "symmetric" | "twoSided";
  /** Opposite-side distance used only by twoSided extrusion. */
  secondDistance?: number;
  operation: "new" | "add" | "remove" | "intersect";
  /** Omitted means every material region currently found in the Sketch. */
  profileIds?: UUID[];
  /** Required for add/remove so the Boolean source is explicit and rebuildable. */
  targetFeatureId?: UUID;
  targetBodyId?: UUID;
}
