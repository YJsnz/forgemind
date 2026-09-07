import type { Vec3 } from "../cad/CadTypes.ts";
import type { RecognizedHoleCandidate } from "./ImportedFeatureRecognition.ts";

export type RecognizedHolePatternCandidate =
  | {
      kind: "linear-hole-pattern";
      memberFaceLocalIds: string[];
      count: number;
      diameterMm: number;
      direction: Vec3;
      spacingMm: number;
      confidence: number;
      reason: string;
    }
  | {
      kind: "circular-hole-pattern";
      memberFaceLocalIds: string[];
      count: number;
      diameterMm: number;
      axis: { origin: Vec3; direction: Vec3 };
      radiusMm: number;
      angleDeg: number;
      confidence: number;
      reason: string;
    };

const EPS=1e-8;
const add=(a:Vec3,b:Vec3):Vec3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const scale=(a:Vec3,s:number):Vec3=>({x:a.x*s,y:a.y*s,z:a.z*s});
const dot=(a:Vec3,b:Vec3):number=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const length=(a:Vec3):number=>Math.hypot(a.x,a.y,a.z);
const unit=(a:Vec3):Vec3|undefined=>{const n=length(a);return n>EPS?scale(a,1/n):undefined;};
const distance=(a:Vec3,b:Vec3):number=>length(sub(a,b));
const canonicalAxis=(axis:Vec3):Vec3|undefined=>{const n=unit(axis);if(!n)return;const sign=Math.abs(n.x)>EPS?n.x:Math.abs(n.y)>EPS?n.y:n.z;return sign<0?scale(n,-1):n;};
const projectPerpendicular=(p:Vec3,axis:Vec3):Vec3=>sub(p,scale(axis,dot(p,axis)));
const median=(values:number[]):number=>{const ordered=[...values].sort((a,b)=>a-b);const middle=Math.floor(ordered.length/2);return ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2;};

interface HolePoint { hole: RecognizedHoleCandidate; axis: Vec3; point: Vec3; axial: number; }

const toHolePoint=(hole:RecognizedHoleCandidate):HolePoint|undefined=>{
  const frame=hole.face.cylindricalFrame;if(!frame)return;
  const axis=canonicalAxis(frame.axisDirection);if(!axis)return;
  const origin=frame.axisOriginMm;
  return {hole,axis,point:projectPerpendicular(origin,axis),axial:dot(origin,axis)};
};

const sameFamily=(a:HolePoint,b:HolePoint):boolean=>Math.abs(a.hole.diameterMm-b.hole.diameterMm)<=Math.max(.02,a.hole.diameterMm*.002)&&Math.abs(dot(a.axis,b.axis))>=.999;

const connectedFamilies=(points:HolePoint[]):HolePoint[][]=>{
  const remaining=[...points];const groups:HolePoint[][]=[];
  while(remaining.length){const seed=remaining.shift()!;const group=[seed];let changed=true;while(changed){changed=false;for(let i=remaining.length-1;i>=0;i--){if(group.some((entry)=>sameFamily(entry,remaining[i]))){group.push(...remaining.splice(i,1));changed=true;}}}groups.push(group);}return groups;
};

const detectLinear=(group:HolePoint[]):RecognizedHolePatternCandidate|undefined=>{
  if(group.length<3)return;
  let bestA=0,bestB=1,bestDistance=0;
  for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){const d=distance(group[i].point,group[j].point);if(d>bestDistance){bestDistance=d;bestA=i;bestB=j;}}
  const direction=unit(sub(group[bestB].point,group[bestA].point));if(!direction||bestDistance<EPS)return;
  const origin=group[bestA].point;
  const samples=group.map((entry)=>{const delta=sub(entry.point,origin);const t=dot(delta,direction);const residual=length(sub(delta,scale(direction,t)));return{entry,t,residual};}).sort((a,b)=>a.t-b.t);
  const spacings=samples.slice(1).map((sample,index)=>sample.t-samples[index].t);if(spacings.some((value)=>value<=EPS))return;
  const spacing=median(spacings);const residualLimit=Math.max(.03,spacing*.015);const spacingError=Math.max(...spacings.map((value)=>Math.abs(value-spacing)))/spacing;
  if(Math.max(...samples.map((sample)=>sample.residual))>residualLimit||spacingError>.025)return;
  const confidence=Math.min(.995,.77+Math.min(.12,group.length*.018)+Math.max(0,.09-spacingError*2));
  return {kind:"linear-hole-pattern",memberFaceLocalIds:samples.map(({entry})=>entry.hole.face.topology.localId),count:group.length,diameterMm:group[0].hole.diameterMm,direction,spacingMm:spacing,confidence,reason:`${group.length} coaxial-diameter hole axes form an equally spaced line; spacing spread ${(spacingError*100).toFixed(2)}%`};
};

const orthonormalBasis=(axis:Vec3):{u:Vec3;v:Vec3}=>{const helper=Math.abs(axis.z)<.8?{x:0,y:0,z:1}:{x:1,y:0,z:0};const u=unit(cross(axis,helper))!;return{u,v:unit(cross(axis,u))!};};
const detectCircular=(group:HolePoint[]):RecognizedHolePatternCandidate|undefined=>{
  if(group.length<3)return;
  const axis=group[0].axis;const center=scale(group.reduce((sum,entry)=>add(sum,entry.point),{x:0,y:0,z:0}),1/group.length);
  const radii=group.map((entry)=>distance(entry.point,center));const radius=median(radii);if(radius<=EPS)return;
  const radiusError=Math.max(...radii.map((value)=>Math.abs(value-radius)))/radius;if(radiusError>.025)return;
  const {u,v}=orthonormalBasis(axis);
  const angles=group.map((entry)=>{const d=sub(entry.point,center);let angle=Math.atan2(dot(d,v),dot(d,u));if(angle<0)angle+=Math.PI*2;return{entry,angle};}).sort((a,b)=>a.angle-b.angle);
  const gaps=angles.map((entry,index)=>{const next=angles[(index+1)%angles.length].angle+(index===angles.length-1?Math.PI*2:0);return next-entry.angle;});
  const expected=Math.PI*2/group.length;const angularError=Math.max(...gaps.map((gap)=>Math.abs(gap-expected)))/expected;if(angularError>.04)return;
  const meanAxial=group.reduce((sum,entry)=>sum+entry.axial,0)/group.length;const axisOrigin=add(center,scale(axis,meanAxial));
  const confidence=Math.min(.995,.75+Math.min(.12,group.length*.018)+Math.max(0,.1-radiusError*2-angularError));
  return {kind:"circular-hole-pattern",memberFaceLocalIds:angles.map(({entry})=>entry.hole.face.topology.localId),count:group.length,diameterMm:group[0].hole.diameterMm,axis:{origin:axisOrigin,direction:axis},radiusMm:radius,angleDeg:360,confidence,reason:`${group.length} equal-diameter parallel hole axes lie on one circle; radial spread ${(radiusError*100).toFixed(2)}%, angular spread ${(angularError*100).toFixed(2)}%`};
};

/** Exact analytic pattern recognition. It never uses tessellated vertex clouds. */
export const recognizeImportedHolePatterns=(holes:readonly RecognizedHoleCandidate[]):RecognizedHolePatternCandidate[]=>{
  const points=holes.map(toHolePoint).filter((entry):entry is HolePoint=>Boolean(entry));const results:RecognizedHolePatternCandidate[]=[];
  for(const group of connectedFamilies(points).filter((entry)=>entry.length>=3)){
    const linear=detectLinear(group);if(linear)results.push(linear);
    const circular=detectCircular(group);if(circular)results.push(circular);
  }
  return results.sort((a,b)=>b.confidence-a.confidence||b.count-a.count);
};
