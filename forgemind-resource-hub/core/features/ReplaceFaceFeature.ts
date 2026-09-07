import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";
/** Conservative solid-face replacement: sew every retained target face with the replacement Surface and solidify. */
export interface ReplaceFaceFeature extends BaseFeature { type:"replaceFace"; targetFeatureId:UUID; targetFace:PersistentFaceRef; replacementFeatureId:UUID; toleranceMm:number; }
