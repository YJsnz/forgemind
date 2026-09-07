import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/**
 * Exact OCCT defeaturing operation. The selected faces identify a complete
 * removable feature (hole/boss/chamfer/fillet) and OCCT heals surrounding faces.
 * Arbitrary face deletion is intentionally not promised by this Feature.
 */
export interface DeleteFaceFeature extends BaseFeature {
  type: "deleteFace";
  targetFeatureId: string;
  faces: PersistentFaceRef[];
  /** Additional fuzzy tolerance. Zero delegates to OCCT defaults. */
  toleranceMm: number;
}
