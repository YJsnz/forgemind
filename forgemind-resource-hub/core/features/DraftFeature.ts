import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";
export interface DraftFeature extends BaseFeature { type:"draft"; targetFeatureId:UUID; faces:PersistentFaceRef[]; pullDirection:Vec3; angleDeg:number; reverse?:boolean; }
