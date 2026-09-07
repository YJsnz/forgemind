import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";
import type { LoftEndCondition } from "./LoftEndCondition.ts";

export interface LoftFeature extends BaseFeature {
  type: "loft";
  /** Explicit order; never inferred from ids or world position. */
  sectionSketchIds: UUID[];
  solid: true;
  ruled?: boolean;
  closed?: boolean;
  operation?: "new" | "add" | "remove" | "intersect";
  /** One selected material-region list for every section Sketch. */
  sectionProfileIds?: UUID[][];
  targetFeatureId?: UUID;
  targetBodyId?: UUID;
  startCondition?: LoftEndCondition;
  endCondition?: LoftEndCondition;
}
