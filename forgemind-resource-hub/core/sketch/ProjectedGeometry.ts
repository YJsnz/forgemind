import type { CadKernel } from "../kernel/CadKernel.ts";
import type { CadRuntimeState } from "../evaluation/CadRuntimeState.ts";
import type { KernelPlaneFrame } from "../kernel/KernelTypes.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import { worldToFaceLocal } from "../topology/PlanarFaceFrame.ts";
import { validateNurbsCurve2D } from "../curve/NurbsCurve.ts";
import type { ProjectedSketchArc, ProjectedSketchBSpline, ProjectedSketchCircle, ProjectedSketchLine } from "./SketchEntity.ts";
import type { Sketch } from "./Sketch.ts";
import type { PersistentTopologyRef } from "../topology/PersistentTopologyRef.ts";

export class ProjectGeometryError extends Error { readonly code:"PROJECT_GEOMETRY_CURVE_UNSUPPORTED"|"REFERENCE_LOST"|"REFERENCE_AMBIGUOUS"; constructor(code:"PROJECT_GEOMETRY_CURVE_UNSUPPORTED"|"REFERENCE_LOST"|"REFERENCE_AMBIGUOUS",message:string){super(message);this.name="ProjectGeometryError";this.code=code;} }
export type ProjectedSketchGeometry = ProjectedSketchLine | ProjectedSketchCircle | ProjectedSketchArc | ProjectedSketchBSpline;
const dot=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>a.x*b.x+a.y*b.y+a.z*b.z;
const planeDistance=(frame:KernelPlaneFrame,point:{x:number;y:number;z:number})=>Math.abs(dot({x:point.x-frame.origin.x,y:point.y-frame.origin.y,z:point.z-frame.origin.z},frame.normal));
const finiteVec3=(value:{x:number;y:number;z:number})=>[value.x,value.y,value.z].every(Number.isFinite);
/** Projects exact coplanar Line/Circle/Arc/NURBS B-Rep geometry. Curves are retained as
 * external references and never converted to display polylines. */
export const projectEdgeToSketch=async(id:string,sourceFeatureId:string,sourceEdge:PersistentTopologyRef,frame:KernelPlaneFrame,runtime:CadRuntimeState,kernel:CadKernel):Promise<ProjectedSketchGeometry>=>{try{const topology=await resolvePersistentTopologyRef(sourceEdge,runtime,kernel);const geometry=await kernel.getEdgeGeometry(topology);
  if(geometry.type==="line"){if(!finiteVec3(geometry.startMm)||!finiteVec3(geometry.endMm)||planeDistance(frame,geometry.startMm)>1e-5||planeDistance(frame,geometry.endMm)>1e-5)throw new ProjectGeometryError("PROJECT_GEOMETRY_CURVE_UNSUPPORTED","The selected line is invalid or not coplanar with this sketch.");return{id,type:"external-line",start:worldToFaceLocal(frame,geometry.startMm),end:worldToFaceLocal(frame,geometry.endMm),construction:true,sourceFeatureId,sourceEdge,projectionMode:"coplanar",referenceStatus:"current"};}
  if(geometry.type==="circle"){if(!finiteVec3(geometry.centerMm)||!finiteVec3(geometry.normal)||!Number.isFinite(geometry.radiusMm)||geometry.radiusMm<=1e-9||Math.abs(Math.abs(dot(geometry.normal,frame.normal))-1)>1e-6||planeDistance(frame,geometry.centerMm)>1e-5)throw new ProjectGeometryError("PROJECT_GEOMETRY_CURVE_UNSUPPORTED","The selected circle is invalid or not coplanar with this sketch.");return{id,type:"external-circle",center:worldToFaceLocal(frame,geometry.centerMm),radius:geometry.radiusMm,construction:true,sourceFeatureId,sourceEdge,projectionMode:"coplanar",referenceStatus:"current"};}
  if(geometry.type==="arc"){if(!finiteVec3(geometry.centerMm)||!finiteVec3(geometry.normal)||!finiteVec3(geometry.startMm)||!finiteVec3(geometry.endMm)||!Number.isFinite(geometry.radiusMm)||geometry.radiusMm<=1e-9||Math.abs(Math.abs(dot(geometry.normal,frame.normal))-1)>1e-6||planeDistance(frame,geometry.centerMm)>1e-5||planeDistance(frame,geometry.startMm)>1e-5||planeDistance(frame,geometry.endMm)>1e-5)throw new ProjectGeometryError("PROJECT_GEOMETRY_CURVE_UNSUPPORTED","The selected arc is invalid or not coplanar with this sketch.");const center=worldToFaceLocal(frame,geometry.centerMm),start=worldToFaceLocal(frame,geometry.startMm),end=worldToFaceLocal(frame,geometry.endMm),sameOrientation=dot(geometry.normal,frame.normal)>0;return{id,type:"external-arc",center,radius:geometry.radiusMm,startAngle:Math.atan2(start.y-center.y,start.x-center.x),endAngle:Math.atan2(end.y-center.y,end.x-center.x),clockwise:sameOrientation?geometry.clockwise:!geometry.clockwise,construction:true,sourceFeatureId,sourceEdge,projectionMode:"coplanar",referenceStatus:"current"};}
  if(geometry.type==="bspline"){
    if(!geometry.polesMm.length||!geometry.polesMm.every(finiteVec3)||geometry.polesMm.some((point)=>planeDistance(frame,point)>1e-5))throw new ProjectGeometryError("PROJECT_GEOMETRY_CURVE_UNSUPPORTED","The selected NURBS edge is invalid or not coplanar with this sketch.");
    const projected:ProjectedSketchBSpline={id,type:"external-bspline",degree:geometry.degree,rational:geometry.rational,periodic:geometry.periodic,knots:[...geometry.knots],multiplicities:[...geometry.multiplicities],controlPoints:geometry.polesMm.map((point)=>worldToFaceLocal(frame,point)),weights:[...geometry.weights],firstParameter:geometry.firstParameter,lastParameter:geometry.lastParameter,construction:true,sourceFeatureId,sourceEdge,projectionMode:"coplanar",referenceStatus:"current"};
    try{validateNurbsCurve2D(projected);}catch{throw new ProjectGeometryError("PROJECT_GEOMETRY_CURVE_UNSUPPORTED","The selected NURBS edge has an inconsistent exact curve definition.");}
    return projected;
  }
  throw new ProjectGeometryError("PROJECT_GEOMETRY_CURVE_UNSUPPORTED",`Exact ${geometry.curveType} edge projection is not available.`);
}catch(error){if(error instanceof ProjectGeometryError)throw error;if(error instanceof TopologyResolutionError)throw new ProjectGeometryError(error.code==="TOPOLOGY_REFERENCE_AMBIGUOUS"?"REFERENCE_AMBIGUOUS":"REFERENCE_LOST",error.message);throw error;}};

/** Backward-compatible name for existing callers. */
export const projectLineEdgeToSketch=projectEdgeToSketch;

export interface ProjectedGeometryRefreshResult { sketch: Sketch; refreshedEntityIds: string[]; failed: Array<{ entityId: string; code: ProjectGeometryError["code"]; message: string }>; }

/** Re-resolves every external curve against the current B-Rep revision before
 * a sketch is committed. Stale coordinates are retained only for display and
 * marked lost/ambiguous; callers can refuse the commit without corrupting the
 * last-good document. */
export const refreshProjectedSketchGeometry=async(sketch:Sketch,frame:KernelPlaneFrame,runtime:CadRuntimeState,kernel:CadKernel):Promise<ProjectedGeometryRefreshResult>=>{const next=structuredClone(sketch),refreshedEntityIds:string[]=[],failed:ProjectedGeometryRefreshResult["failed"]=[],resolved=new Map<string,ProjectedSketchGeometry>();for(const id of next.entityOrder){const entity=next.entities[id];if(!entity||!(entity.type==="external-line"||entity.type==="external-circle"||entity.type==="external-arc"||entity.type==="external-bspline"))continue;try{const cacheKey=JSON.stringify([entity.sourceFeatureId,entity.sourceEdge]);const cached=resolved.get(cacheKey);const refreshed=cached?{...structuredClone(cached),id:entity.id}:await projectEdgeToSketch(entity.id,entity.sourceFeatureId,entity.sourceEdge,frame,runtime,kernel);resolved.set(cacheKey,refreshed);next.entities[id]=refreshed;refreshedEntityIds.push(id);}catch(error){const code=error instanceof ProjectGeometryError?error.code:"REFERENCE_LOST";entity.referenceStatus=code==="REFERENCE_AMBIGUOUS"?"ambiguous":"lost";failed.push({entityId:id,code,message:error instanceof Error?error.message:String(error)});}}return{sketch:next,refreshedEntityIds,failed};};
