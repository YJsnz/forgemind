import type { UUID } from "../cad/CadTypes.ts";

export type SketchPointRole = "start" | "end" | "center" | "position" | "curve";
/** Explicit semantic point reference; never an implicit point-array index. */
export interface SketchPointRef {
  entityId: UUID;
  role: SketchPointRole;
  /** Exact native parameter retained only when role is `curve`. */
  parameter?: number;
}

export type SketchConstraintType =
  | "horizontal"
  | "vertical"
  | "fixed"
  | "coincident"
  | "parallel"
  | "perpendicular"
  | "tangent"
  | "concentric"
  | "equal"
  | "midpoint"
  | "symmetric";

export interface SketchConstraint {
  id: UUID;
  type: SketchConstraintType;
  entityIds: UUID[];
  enabled: boolean;
  pointRefs?: SketchPointRef[];
}
