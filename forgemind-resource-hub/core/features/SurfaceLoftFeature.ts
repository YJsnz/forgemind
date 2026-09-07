import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";
import type { LoftEndCondition } from "./LoftEndCondition.ts";

export interface SurfaceLoftFeature extends BaseFeature {
  type: "surfaceLoft";
  sectionSketchIds: UUID[];
  ruled?: boolean;
  closed?: boolean;
  startCondition?: LoftEndCondition;
  endCondition?: LoftEndCondition;
}
