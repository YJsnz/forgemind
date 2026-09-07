import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

export interface BooleanFeature extends BaseFeature {
  type: "boolean";
  operation: "union" | "cut" | "intersect";
  targetBodyId: UUID;
  toolBodyIds: UUID[];
}
