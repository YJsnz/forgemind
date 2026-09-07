import type { Vec3 } from "../cad/CadTypes.ts";

/** Additional true loft sections used to control the start/end flow. */
export interface LoftEndCondition {
  /** Legacy names for one/two guide sections; not a certified G1/G2 constraint. */
  continuity: "G1" | "G2";
  lengthMm: number;
  /** Optional world-space direction. The evaluator orients it toward the loft interior. */
  direction?: Vec3;
}
