import type { MechanicalDetailDefinition } from "../mechanical/MechanicalDetail.ts";
import type { BaseFeature } from "./Feature.ts";

/** A rebuildable mechanical component generated directly by the exact CAD kernel. */
export interface MechanicalDetailFeature extends BaseFeature {
  type: "mechanicalDetail";
  detail: MechanicalDetailDefinition;
}
