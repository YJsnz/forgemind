import type { BaseFeature } from "./Feature.ts";

/** Exact whole-solid offset driven by OCCT BRepOffsetAPI. */
export interface OffsetBodyFeature extends BaseFeature {
  type: "offsetBody";
  targetFeatureId: string;
  /** Positive grows the solid, negative shrinks it. */
  distanceMm: number;
}
