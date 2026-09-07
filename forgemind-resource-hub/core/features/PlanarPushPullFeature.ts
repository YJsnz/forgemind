import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/**
 * Conservative direct edit for a single-loop planar Face.
 * Positive distance pushes outward; negative distance pulls inward.
 */
export interface PlanarPushPullFeature extends BaseFeature {
  type: "planarPushPull";
  targetFeatureId: string;
  planarFace: PersistentFaceRef;
  distanceMm: number;
}
