import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** Exact profile sweep. Follow-path orientation is kernel-owned. */
export interface SweepFeature extends BaseFeature {
  type: "sweep";
  profileSketchId: UUID;
  pathSketchId: UUID;
  operation: "new" | "add" | "remove" | "intersect";
  profileIds?: UUID[];
  targetFeatureId?: UUID;
  targetBodyId?: UUID;
  orientation: "followPath";
}
