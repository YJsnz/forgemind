import type { UUID } from "../cad/CadTypes.ts";
import type { SketchPointRef } from "./SketchConstraint.ts";

export type SketchDimensionType =
  | "distance"
  | "horizontalDistance"
  | "verticalDistance"
  | "radius"
  | "diameter"
  | "angle";

export interface SketchDimension {
  id: UUID;
  type: SketchDimensionType;
  entityIds: UUID[];
  value: number;
  driving: boolean;
  name?: string;
  pointRefs?: SketchPointRef[];
}
