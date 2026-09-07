import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

/** Direct-edit semantic for imported/native B-Rep: fill a selected cylindrical cavity. */
export interface RemoveHoleFeature extends BaseFeature {
  type: "removeHole";
  targetFeatureId: string;
  cylindricalFace: PersistentFaceRef;
  /** Extra axial overlap on both sides to make the union robust. */
  axialMarginMm?: number;
}
