import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { KernelAxis, KernelPlaneFrame } from "../kernel/KernelTypes.ts";
import { sketchPlaneToKernelFrame } from "../evaluation/SketchPlaneFrame.ts";
import type { PersistentTopologyRef } from "../topology/PersistentTopologyRef.ts";

export interface DatumPlane { id: UUID; name: string; base: "XY" | "XZ" | "YZ"; offsetMm: number; flipNormal?: boolean; }
export interface DatumAxis { id: UUID; name: string; kind: "origin" | "linear-edge"; origin?: Vec3; direction?: Vec3; sourceFeatureId?: UUID; edge?: PersistentTopologyRef; }
export const datumPlaneFrame=(datum:DatumPlane):KernelPlaneFrame=>{const frame=sketchPlaneToKernelFrame({type:datum.base,offset:datum.offsetMm});return datum.flipNormal?{...frame,normal:{x:-frame.normal.x,y:-frame.normal.y,z:-frame.normal.z},yAxis:{x:-frame.yAxis.x,y:-frame.yAxis.y,z:-frame.yAxis.z}}:frame;};
export const originDatumAxis=(id:UUID,axis:"X"|"Y"|"Z"):DatumAxis=>({id,name:`Origin ${axis}`,kind:"origin",origin:{x:0,y:0,z:0},direction:axis==="X"?{x:1,y:0,z:0}:axis==="Y"?{x:0,y:1,z:0}:{x:0,y:0,z:1}});
export const datumAxisKernelAxis=(axis:DatumAxis):KernelAxis=>{if(!axis.origin||!axis.direction)throw new Error("Datum Axis requires a resolved origin and direction.");return{origin:axis.origin,direction:axis.direction};};
