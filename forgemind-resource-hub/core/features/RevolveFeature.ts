import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface RevolveFeature extends BaseFeature {
  type: "revolve";
  sketchId: UUID;
  axis: { origin: Vec3; direction: Vec3 };
  /** Degrees at the document parameter layer. */
  angleDeg: number;
  operation: "new" | "add" | "remove" | "intersect";
  /** Omitted means every material region currently found in the Sketch. */
  profileIds?: UUID[];
  /** Required for add/remove/intersect so history rebuilds the same target. */
  targetFeatureId?: UUID;
  targetBodyId?: UUID;
}
