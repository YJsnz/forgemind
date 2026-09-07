import type { HoleStyle } from "../features/HoleFeature.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelFaceInfo, KernelTopologyRef } from "../kernel/KernelTypes.ts";
import type { Vec3 } from "../cad/CadTypes.ts";
import type { RecognizedHoleCandidate } from "./ImportedFeatureRecognition.ts";

export interface RecognizedStyledHoleCandidate {
  primaryFaceLocalId: string;
  relatedFaceLocalIds: string[];
  diameterMm: number;
  axialLengthMm: number;
  style: HoleStyle;
  confidence: number;
  reason: string;
}

const dot=(a:Vec3,b:Vec3)=>a.x*b.x+a.y*b.y+a.z*b.z;
const sub=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const length=(v:Vec3)=>Math.hypot(v.x,v.y,v.z);
const unit=(v:Vec3):Vec3|undefined=>{const l=length(v);return l>1e-9&&Number.isFinite(l)?{x:v.x/l,y:v.y/l,z:v.z/l}:undefined;};
const axisDistance=(a:RecognizedHoleCandidate,b:RecognizedHoleCandidate):number=>{
  const af=a.face.cylindricalFrame,bf=b.face.cylindricalFrame;if(!af||!bf)return Infinity;
  const axis=unit(af.axisDirection);if(!axis)return Infinity;
  return length(cross(sub(bf.axisOriginMm,af.axisOriginMm),axis));
};
const axesParallel=(a:RecognizedHoleCandidate,b:RecognizedHoleCandidate):boolean=>{
  const aa=a.face.cylindricalFrame?.axisDirection,bb=b.face.cylindricalFrame?.axisDirection;if(!aa||!bb)return false;
  const ua=unit(aa),ub=unit(bb);return !!ua&&!!ub&&Math.abs(dot(ua,ub))>.9995;
};
const commonPlanarBridge=(a:KernelFaceInfo,b:KernelFaceInfo,faces:readonly KernelFaceInfo[]):KernelFaceInfo|undefined=>faces.find((face)=>face.surfaceType==="plane"&&(face.adjacentFaceIds??[]).includes(a.topology.localId)&&(face.adjacentFaceIds??[]).includes(b.topology.localId));

/**
 * V7 exact advanced-hole recognition. Counterbores are promoted only from two
 * coaxial concave cylinders connected by the same planar shoulder. Countersinks
 * require an adjacent analytic cone whose exact circular boundary edges prove
 * both entrance diameter and included angle. No tessellation is used.
 */
export const recognizeImportedHoleStyles = async (
  holes: readonly RecognizedHoleCandidate[],
  faces: readonly KernelFaceInfo[],
  kernel: CadKernel,
): Promise<RecognizedStyledHoleCandidate[]> => {
  const result:RecognizedStyledHoleCandidate[]=[];
  const faceById=new Map(faces.map((face)=>[face.topology.localId,face]));

  for(let i=0;i<holes.length;i++) for(let j=i+1;j<holes.length;j++){
    const a=holes[i]!,b=holes[j]!; if(!axesParallel(a,b)||axisDistance(a,b)>.05) continue;
    const bridge=commonPlanarBridge(a.face,b.face,faces); if(!bridge) continue;
    const small=a.diameterMm<=b.diameterMm?a:b,large=small===a?b:a;
    if(large.diameterMm-small.diameterMm<=1e-3) continue;
    const confidence=Math.min(.995,.86+.06*Math.min(a.confidence,b.confidence)+.05);
    result.push({
      primaryFaceLocalId:small.face.topology.localId,
      relatedFaceLocalIds:[small.face.topology.localId,large.face.topology.localId,bridge.topology.localId],
      diameterMm:small.diameterMm,
      axialLengthMm:small.axialLengthMm,
      style:{type:"counterbore",diameterMm:large.diameterMm,depthMm:large.axialLengthMm},
      confidence,
      reason:`two coaxial concave cylinders + shared planar shoulder; Ø${small.diameterMm.toFixed(3)} bore / Ø${large.diameterMm.toFixed(3)} counterbore`,
    });
  }

  for(const hole of holes){
    const frame=hole.face.cylindricalFrame;if(!frame)continue;
    const adjacentCones=(hole.face.adjacentFaceIds??[]).map((id)=>faceById.get(id)).filter((face):face is KernelFaceInfo=>face?.surfaceType==="cone");
    for(const cone of adjacentCones){
      const circles:{radius:number;center:Vec3}[]=[];
      for(const localId of cone.boundaryEdgeIds??[]){
        const topology:KernelTopologyRef={shapeId:cone.topology.shapeId,shapeRevision:cone.topology.shapeRevision,kind:"edge",localId};
        const geometry=await kernel.getEdgeGeometry(topology);
        if(geometry.type==="circle") circles.push({radius:geometry.radiusMm,center:geometry.centerMm});
      }
      if(circles.length<2)continue;
      circles.sort((x,y)=>x.radius-y.radius);
      const small=circles[0]!,large=circles.at(-1)!;
      const boreRadius=hole.diameterMm/2;
      if(Math.abs(small.radius-boreRadius)>Math.max(.05,boreRadius*.03)||large.radius-small.radius<=1e-3)continue;
      const axis=unit(frame.axisDirection);if(!axis)continue;
      const height=Math.abs(dot(sub(large.center,small.center),axis));
      if(height<=1e-6)continue;
      const includedAngleDeg=2*Math.atan((large.radius-small.radius)/height)*180/Math.PI;
      if(!Number.isFinite(includedAngleDeg)||includedAngleDeg<=1||includedAngleDeg>=179)continue;
      result.push({
        primaryFaceLocalId:hole.face.topology.localId,
        relatedFaceLocalIds:[hole.face.topology.localId,cone.topology.localId],
        diameterMm:hole.diameterMm,
        axialLengthMm:hole.axialLengthMm,
        style:{type:"countersink",diameterMm:large.radius*2,includedAngleDeg},
        confidence:Math.min(.995,.84+.1*hole.confidence),
        reason:`concave bore + adjacent analytic cone + two exact circular cone boundaries; countersink Ø${(large.radius*2).toFixed(3)} / ${includedAngleDeg.toFixed(2)}°`,
      });
    }
  }

  return result.sort((a,b)=>b.confidence-a.confidence||a.primaryFaceLocalId.localeCompare(b.primaryFaceLocalId));
};
