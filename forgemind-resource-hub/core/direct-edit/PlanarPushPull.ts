import type { Vec2, Vec3 } from "../cad/CadTypes.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelEdgeGeometry, KernelFaceInfo, KernelPlaneFrame, KernelProfileInput, KernelTopologyRef } from "../kernel/KernelTypes.ts";
import type { ClosedProfile, ProfileSegment, ProfileSegmentArc, ProfileSegmentCircle, ProfileSegmentLine } from "../sketch/SketchProfile.ts";
import { getPlanarFaceFrame, worldToFaceLocal } from "../topology/PlanarFaceFrame.ts";

const EPS = 1e-6;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const same3 = (a: Vec3, b: Vec3): boolean => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) <= EPS;
const pair = (value: Vec2): [number, number] => [value.x, value.y];
const dot3 = (a: Vec3,b: Vec3):number=>a.x*b.x+a.y*b.y+a.z*b.z;

export class PlanarPushPullError extends Error {
  readonly code:
    | "PUSH_PULL_REQUIRES_PLANAR_FACE"
    | "PUSH_PULL_BOUNDARY_UNAVAILABLE"
    | "PUSH_PULL_UNSUPPORTED_BOUNDARY"
    | "PUSH_PULL_OPEN_BOUNDARY"
    | "PUSH_PULL_AMBIGUOUS_BOUNDARY";
  constructor(code: PlanarPushPullError["code"], message: string) { super(message); this.name="PlanarPushPullError"; this.code=code; }
}

type OpenCurve3 = Extract<KernelEdgeGeometry,{type:"line"}|{type:"arc"}>;
type RawBoundary = { localId:string; geometry:KernelEdgeGeometry };
type OrientedOpen = { localId:string; geometry:OpenCurve3; reversed:boolean; start:Vec3; end:Vec3 };

const orientOpen=(entry:RawBoundary,reversed=false):OrientedOpen=>{
  const geometry=entry.geometry;
  if(geometry.type!=="line"&&geometry.type!=="arc") throw new PlanarPushPullError("PUSH_PULL_UNSUPPORTED_BOUNDARY",`Boundary edge ${entry.localId} is ${geometry.type}.`);
  const start=reversed?geometry.endMm:geometry.startMm;
  const end=reversed?geometry.startMm:geometry.endMm;
  return {localId:entry.localId,geometry,reversed,start,end};
};

const buildOpenLoops=(entries:RawBoundary[]):OrientedOpen[][]=>{
  const remaining=[...entries];
  const loops:OrientedOpen[][]=[];
  while(remaining.length){
    const first=remaining.shift()!;
    const firstOriented=orientOpen(first,false);
    const loop=[firstOriented];
    let end=firstOriented.end;
    while(!same3(end,loop[0].start)){
      const index=remaining.findIndex((entry)=>{
        if(entry.geometry.type!=="line"&&entry.geometry.type!=="arc") return false;
        return same3(entry.geometry.startMm,end)||same3(entry.geometry.endMm,end);
      });
      if(index<0) throw new PlanarPushPullError("PUSH_PULL_OPEN_BOUNDARY",`Boundary chain beginning with ${first.localId} is open.`);
      const [next]=remaining.splice(index,1);
      const forward=orientOpen(next,false);
      const curve=same3(forward.start,end)?forward:orientOpen(next,true);
      loop.push(curve); end=curve.end;
      if(loop.length>entries.length+1) throw new PlanarPushPullError("PUSH_PULL_AMBIGUOUS_BOUNDARY","Planar Face boundary traversal did not converge.");
    }
    loops.push(loop);
  }
  return loops;
};

const angleDeg=(center:Vec2,point:Vec2):number=>Math.atan2(point.y-center.y,point.x-center.x)*RADIANS_TO_DEGREES;
const arcSegment=(curve:OrientedOpen,frame:KernelPlaneFrame):ProfileSegmentArc=>{
  if(curve.geometry.type!=="arc") throw new Error("arcSegment requires an arc");
  const center=worldToFaceLocal(frame,curve.geometry.centerMm);
  const start=worldToFaceLocal(frame,curve.start);
  const end=worldToFaceLocal(frame,curve.end);
  const sourceClockwise=curve.geometry.clockwise;
  const sameNormal=dot3(curve.geometry.normal,frame.normal)>=0;
  const clockwiseInFrame=(sameNormal?sourceClockwise:!sourceClockwise)!==curve.reversed;
  return {type:"arc",center:pair(center),radius:curve.geometry.radiusMm,startAngleDeg:angleDeg(center,start),endAngleDeg:angleDeg(center,end),clockwise:clockwiseInFrame};
};
const openSegment=(curve:OrientedOpen,frame:KernelPlaneFrame):ProfileSegment=>curve.geometry.type==="line"
  ? {type:"line",start:pair(worldToFaceLocal(frame,curve.start)),end:pair(worldToFaceLocal(frame,curve.end))} satisfies ProfileSegmentLine
  : arcSegment(curve,frame);
const circleSegment=(geometry:Extract<KernelEdgeGeometry,{type:"circle"}>,frame:KernelPlaneFrame):ProfileSegmentCircle=>({type:"circle",center:pair(worldToFaceLocal(frame,geometry.centerMm)),radius:geometry.radiusMm});

const arcSweepRad=(arc:ProfileSegmentArc):number=>{
  let sweep=(arc.endAngleDeg-arc.startAngleDeg)/RADIANS_TO_DEGREES;
  if(arc.clockwise){while(sweep>=0)sweep-=Math.PI*2;}else{while(sweep<=0)sweep+=Math.PI*2;}
  return sweep;
};
const loopSignedArea=(segments:ProfileSegment[]):number=>segments.reduce((sum,segment)=>{
  if(segment.type==="line") return sum+(segment.start[0]*segment.end[1]-segment.end[0]*segment.start[1])/2;
  if(segment.type==="circle") return sum+Math.PI*segment.radius*segment.radius;
  const start=segment.startAngleDeg/RADIANS_TO_DEGREES;
  const sweep=arcSweepRad(segment); const end=start+sweep;
  const [cx,cy]=segment.center; const r=segment.radius;
  return sum+.5*(r*cx*(Math.sin(end)-Math.sin(start))-r*cy*(Math.cos(end)-Math.cos(start))+r*r*sweep);
},0);

const reverseSegment=(segment:ProfileSegment):ProfileSegment=>{
  if(segment.type==="line") return {...segment,start:segment.end,end:segment.start};
  if(segment.type==="circle") return segment;
  return {...segment,startAngleDeg:segment.endAngleDeg,endAngleDeg:segment.startAngleDeg,clockwise:!segment.clockwise};
};
const normaliseLoopOrientation=(segments:ProfileSegment[],wantPositive:boolean):ProfileSegment[]=>{
  const area=loopSignedArea(segments);
  if(Math.abs(area)<=EPS) throw new PlanarPushPullError("PUSH_PULL_AMBIGUOUS_BOUNDARY","Planar Face boundary has zero/ambiguous enclosed area.");
  if((area>0)===wantPositive) return segments;
  return [...segments].reverse().map(reverseSegment);
};

/**
 * Reconstructs exact OCCT planar-face wires from analytic Line/Arc/Circle edges.
 * The largest-area loop becomes the outer boundary; remaining loops are holes.
 * No tessellated approximation is accepted.
 */
export const buildPlanarFaceProfile = async (
  face: KernelFaceInfo,
  kernel: CadKernel,
): Promise<{ input: KernelProfileInput; frame: KernelPlaneFrame; profile: ClosedProfile; loopInputs: KernelProfileInput[] }> => {
  if(face.surfaceType!=="plane") throw new PlanarPushPullError("PUSH_PULL_REQUIRES_PLANAR_FACE","Push/Pull requires an exact planar Face.");
  const edgeIds=[...new Set(face.boundaryEdgeIds ?? [])];
  if(!edgeIds.length) throw new PlanarPushPullError("PUSH_PULL_BOUNDARY_UNAVAILABLE","OCCT face boundary edges are unavailable for the selected Face.");
  const boundaries:RawBoundary[]=[];
  for(const localId of edgeIds){
    const topology:KernelTopologyRef={shapeId:face.topology.shapeId,shapeRevision:face.topology.shapeRevision,kind:"edge",localId};
    const geometry=await kernel.getEdgeGeometry(topology);
    if(geometry.type==="unsupported"||geometry.type==="bspline") throw new PlanarPushPullError("PUSH_PULL_UNSUPPORTED_BOUNDARY",`Boundary edge ${localId} uses unsupported exact curve type ${geometry.type==="unsupported"?geometry.curveType:geometry.type}.`);
    boundaries.push({localId,geometry});
  }
  const frame=getPlanarFaceFrame(face);
  const circles=boundaries.filter((entry):entry is RawBoundary&{geometry:Extract<KernelEdgeGeometry,{type:"circle"}>}=>entry.geometry.type==="circle");
  const open=boundaries.filter((entry)=>entry.geometry.type!=="circle");
  const loops:ProfileSegment[][]=[
    ...circles.map(({geometry})=>[circleSegment(geometry,frame)]),
    ...buildOpenLoops(open).map((loop)=>loop.map((curve)=>openSegment(curve,frame))),
  ];
  if(!loops.length) throw new PlanarPushPullError("PUSH_PULL_BOUNDARY_UNAVAILABLE","No exact planar boundary loops could be reconstructed.");
  const ranked=loops.map((segments,index)=>({segments,index,area:Math.abs(loopSignedArea(segments))})).sort((a,b)=>b.area-a.area);
  if(ranked[0].area<=EPS) throw new PlanarPushPullError("PUSH_PULL_AMBIGUOUS_BOUNDARY","Selected Face has no measurable outer boundary.");
  const outer=normaliseLoopOrientation(ranked[0].segments,true);
  const holes=ranked.slice(1).map((entry)=>normaliseLoopOrientation(entry.segments,false));
  const profile:ClosedProfile={id:`push-pull:${face.topology.localId}`,outer,holes};
  const input:KernelProfileInput={profile,plane:frame};
  const loopInputs:KernelProfileInput[]=[
    {profile:{id:`${profile.id}:outer`,outer,holes:[]},plane:frame},
    ...holes.map((hole,index)=>({profile:{id:`${profile.id}:hole-${index+1}`,outer:normaliseLoopOrientation(hole,true),holes:[]},plane:frame})),
  ];
  return {input,frame,profile,loopInputs};
};
