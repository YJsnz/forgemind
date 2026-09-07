import { recognizeImportedHolePatterns, type RecognizedHolePatternCandidate } from "./ImportedPatternRecognition.ts";
import type { Vec3 } from "../cad/CadTypes.ts";
import type { KernelFaceInfo, KernelShapeProperties } from "../kernel/KernelTypes.ts";

export interface RecognizedHoleCandidate {
  kind: "hole";
  face: KernelFaceInfo;
  diameterMm: number;
  axialLengthMm: number;
  confidence: number;
  reason: string;
  depthCondition?: { type: "throughAll"; confidence: number; reason: string } | { type: "blind"; valueMm: number; confidence: number; reason: string };
}

export interface RecognizedRoundCandidate {
  kind: "round";
  face: KernelFaceInfo;
  radiusMm: number;
  /** Conservative connected same-radius analytic cylinder chain for one-click defeature. */
  relatedFaceLocalIds: string[];
  confidence: number;
  reason: string;
}

export interface RecognizedConeCandidate {
  kind: "cone";
  face: KernelFaceInfo;
  /** Conservative connected conical chain. Confirmation is still required before defeature. */
  relatedFaceLocalIds: string[];
  confidence: number;
  reason: string;
}

/**
 * V6 conservative prismatic candidate. It intentionally does not auto-label
 * Boss vs Pocket because convex/concave classification needs a stronger
 * oriented-edge/dihedral proof. The candidate is a review object only.
 */
export interface RecognizedPrismaticCandidate {
  kind: "prismatic";
  capFace: KernelFaceInfo;
  sideFaceLocalIds: string[];
  profileEdgeLocalIds: string[];
  estimatedDepthMm?: number;
  /** V7: promoted only when oriented cap/side evidence agrees. */
  classification?: "boss" | "pocket";
  /** Direction from the cap plane into the original feature volume/cavity. */
  extrusionDirection?: "positive" | "negative";
  classificationConfidence?: number;
  classificationEvidence?: string[];
  confidence: number;
  reason: string;
}

export interface ImportedGeometryRecognition {
  holes: RecognizedHoleCandidate[];
  rounds: RecognizedRoundCandidate[];
  cones: RecognizedConeCandidate[];
  prisms: RecognizedPrismaticCandidate[];
  patterns?: RecognizedHolePatternCandidate[];
  planarFaces: KernelFaceInfo[];
  cylindricalFaces: KernelFaceInfo[];
  conicalFaces: KernelFaceInfo[];
}

const dot=(a:Vec3,b:Vec3):number=>a.x*b.x+a.y*b.y+a.z*b.z;
const unit=(v:Vec3):Vec3|undefined=>{const length=Math.hypot(v.x,v.y,v.z);return Number.isFinite(length)&&length>1e-9?{x:v.x/length,y:v.y/length,z:v.z/length}:undefined;};
const subtract=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const scale=(a:Vec3,s:number):Vec3=>({x:a.x*s,y:a.y*s,z:a.z*s});


const connectedAnalyticGroup = (seed: KernelFaceInfo, candidates: readonly KernelFaceInfo[], compatible: (a: KernelFaceInfo, b: KernelFaceInfo) => boolean): string[] => {
  const byId = new Map(candidates.map((face) => [face.topology.localId, face]));
  const visited = new Set<string>();
  const queue = [seed.topology.localId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    const face = byId.get(id); if (!face) continue;
    visited.add(id);
    for (const adjacentId of face.adjacentFaceIds ?? []) {
      const adjacent = byId.get(adjacentId);
      if (adjacent && !visited.has(adjacentId) && compatible(face, adjacent)) queue.push(adjacentId);
    }
  }
  return [...visited].sort();
};

const sameCylinderRadius = (a: KernelFaceInfo, b: KernelFaceInfo): boolean => {
  const ar=a.cylindricalFrame?.radiusMm, br=b.cylindricalFrame?.radiusMm;
  if(!ar||!br) return false;
  return Math.abs(ar-br) <= Math.max(1e-4, Math.max(ar,br)*1e-4);
};

const cylinderHeight = (face: KernelFaceInfo): number | undefined => {
  const radius = face.cylindricalFrame?.radiusMm;
  if (!radius || !face.areaMm2 || radius <= 0) return undefined;
  const value = face.areaMm2 / (2 * Math.PI * radius);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/**
 * Returns radial normal sense for an analytic cylinder.
 * Negative = face normal points toward the cylinder axis (concave/internal).
 * Positive = face normal points away from the axis (convex/external).
 */
export const cylindricalNormalSense=(face:KernelFaceInfo):number|undefined=>{
  const frame=face.cylindricalFrame,normal=face.normal&&unit(face.normal),center=face.centerMm;
  if(!frame||!normal||!center) return undefined;
  const axis=unit(frame.axisDirection); if(!axis) return undefined;
  const fromAxis=subtract(center,frame.axisOriginMm);
  const radial=subtract(fromAxis,scale(axis,dot(fromAxis,axis)));
  const radialUnit=unit(radial); if(!radialUnit) return undefined;
  return dot(normal,radialUnit);
};


const median = (values: number[]): number | undefined => {
  const finite = values.filter((value) => Number.isFinite(value) && value > 1e-6).sort((a,b)=>a-b);
  if (!finite.length) return undefined;
  const middle = Math.floor(finite.length/2);
  return finite.length % 2 ? finite[middle] : (finite[middle-1] + finite[middle]) / 2;
};


const projectedBoundingRange=(properties:KernelShapeProperties,axis:Vec3):{min:number;max:number}=>{
  const {min,max}=properties.boundingBox;
  const values=[
    {x:min.x,y:min.y,z:min.z},{x:min.x,y:min.y,z:max.z},{x:min.x,y:max.y,z:min.z},{x:min.x,y:max.y,z:max.z},
    {x:max.x,y:min.y,z:min.z},{x:max.x,y:min.y,z:max.z},{x:max.x,y:max.y,z:min.z},{x:max.x,y:max.y,z:max.z},
  ].map((corner)=>dot(corner,axis));
  return {min:Math.min(...values),max:Math.max(...values)};
};

const inferHoleDepthCondition=(face:KernelFaceInfo,axialLengthMm:number,properties?:KernelShapeProperties):RecognizedHoleCandidate["depthCondition"]=>{
  const frame=face.cylindricalFrame,center=face.centerMm;if(!properties||!frame||!center)return;
  const axis=unit(frame.axisDirection);if(!axis)return;
  const body=projectedBoundingRange(properties,axis);const bodySpan=body.max-body.min;if(bodySpan<=1e-6)return;
  const centerT=dot(center,axis),half=axialLengthMm/2,cylinder={min:centerT-half,max:centerT+half};
  const tolerance=Math.max(.1,bodySpan*.0125,axialLengthMm*.015);
  const touchesMin=Math.abs(cylinder.min-body.min)<=tolerance,touchesMax=Math.abs(cylinder.max-body.max)<=tolerance;
  if(touchesMin&&touchesMax)return{type:"throughAll",confidence:.96,reason:`analytic cylinder spans both body projection bounds within ${tolerance.toFixed(3)} mm`};
  if(touchesMin||touchesMax)return{type:"blind",valueMm:axialLengthMm,confidence:.88,reason:`analytic cylinder opens on one body projection boundary and terminates internally; recovered depth ${axialLengthMm.toFixed(3)} mm`};
  return undefined;
};

const recognizePrismaticCandidates = (planarFaces: readonly KernelFaceInfo[], properties?: KernelShapeProperties): RecognizedPrismaticCandidate[] => {
  const byId = new Map(planarFaces.map((face)=>[face.topology.localId, face]));
  const bodyScale = properties ? Math.hypot(properties.boundingBox.max.x-properties.boundingBox.min.x, properties.boundingBox.max.y-properties.boundingBox.min.y, properties.boundingBox.max.z-properties.boundingBox.min.z) : undefined;
  const candidates: RecognizedPrismaticCandidate[] = [];
  for (const cap of planarFaces) {
    const normal = cap.normal && unit(cap.normal);
    if (!normal || !cap.centerMm || (cap.boundaryEdgeCount ?? 0) < 3) continue;
    const sideFaces = (cap.adjacentFaceIds ?? []).map((id)=>byId.get(id)).filter((face): face is KernelFaceInfo => Boolean(face?.normal && face?.centerMm)).filter((face)=>{
      const n=unit(face.normal!); return !!n && Math.abs(dot(normal,n)) < .15;
    });
    if (sideFaces.length < 3) continue;
    const depthSamples = sideFaces.map((face)=>Math.abs(dot(subtract(face.centerMm!,cap.centerMm!),normal))*2).filter((value)=>value>1e-5);
    const estimatedDepthMm = median(depthSamples);
    if (!estimatedDepthMm) continue;
    const spread = Math.max(...depthSamples.map((value)=>Math.abs(value-estimatedDepthMm))) / Math.max(estimatedDepthMm,1e-9);
    if (spread > .35) continue;
    const profileEdgeLocalIds = [...new Set(cap.boundaryEdgeIds ?? [])].sort();
    const scaleEvidence = bodyScale === undefined || estimatedDepthMm < bodyScale*.8;

    // V7 oriented-face proof. For an external boss, each side-face outward normal
    // points away from the cap centre (negative score below). For an internal
    // pocket wall, the oriented side normal points into the cavity and therefore
    // toward the cap centre (positive score). This is evaluated together with
    // signed cap-normal depth so a single flipped/degenerate face cannot promote
    // a candidate by itself.
    const sideSense = sideFaces.map((face)=>{
      const n=unit(face.normal!); if(!n||!face.centerMm) return 0;
      return dot(n,subtract(cap.centerMm!,face.centerMm));
    }).filter((value)=>Math.abs(value)>1e-6);
    const signedDepth = sideFaces.map((face)=>dot(subtract(face.centerMm!,cap.centerMm!),normal)*2).filter((value)=>Math.abs(value)>1e-6);
    const positiveSides=sideSense.filter((value)=>value>0).length, negativeSides=sideSense.filter((value)=>value<0).length;
    const positiveDepth=signedDepth.filter((value)=>value>0).length, negativeDepth=signedDepth.filter((value)=>value<0).length;
    const sideAgreement=sideSense.length ? Math.max(positiveSides,negativeSides)/sideSense.length : 0;
    const depthAgreement=signedDepth.length ? Math.max(positiveDepth,negativeDepth)/signedDepth.length : 0;
    const sideKind=sideAgreement>=.8 ? (positiveSides>negativeSides?"pocket":"boss") : undefined;
    const depthKind=depthAgreement>=.8 ? (positiveDepth>negativeDepth?"pocket":"boss") : undefined;
    const classification = sideKind && sideKind===depthKind ? sideKind : undefined;
    const classificationConfidence = classification ? Math.min(.995,.55+.22*sideAgreement+.18*depthAgreement+(spread<.08?.045:0)) : undefined;
    const classificationEvidence = classification ? [
      `${positiveSides}/${sideSense.length} side-normal tests point inward; ${negativeSides}/${sideSense.length} point outward`,
      `${positiveDepth}/${signedDepth.length} cap-normal depth samples are positive; ${negativeDepth}/${signedDepth.length} are negative`,
      `oriented cap/side evidence consistently proves ${classification === "boss" ? "external protrusion" : "internal cavity"}`,
    ] : undefined;
    const extrusionDirection = classification ? (classification === "boss" ? "negative" : "positive") : undefined;
    const confidence = Math.max(.4, Math.min(.98, .5 + Math.min(.18,sideFaces.length*.03) + (spread < .08 ? .16 : spread < .18 ? .09 : 0) + (scaleEvidence ? .06 : 0) + (classification ? .06 : 0)));
    candidates.push({kind:"prismatic",capFace:cap,sideFaceLocalIds:sideFaces.map((face)=>face.topology.localId).sort(),profileEdgeLocalIds,estimatedDepthMm,classification,extrusionDirection,classificationConfidence,classificationEvidence,confidence,reason:classification ? `planar cap + ${sideFaces.length} near-perpendicular planar side faces; depth consistency ${(1-spread)*100|0}%; oriented cap/side proof => ${classification}` : `planar cap + ${sideFaces.length} near-perpendicular planar side faces; depth consistency ${(1-spread)*100|0}%; Boss/Pocket classification remains unproven`});
  }
  return candidates.sort((a,b)=>b.confidence-a.confidence||(a.estimatedDepthMm??0)-(b.estimatedDepthMm??0));
};

/**
 * Conservative exact-face recognition for imported/native B-Rep.
 * No candidate is derived from tessellation. Concave analytic cylinders are
 * treated as hole candidates; convex cylinders are kept separate so shafts
 * are not accidentally offered to Remove Hole.
 */
export const recognizeImportedGeometry = (faces: readonly KernelFaceInfo[], properties?: KernelShapeProperties): ImportedGeometryRecognition => {
  const planarFaces = faces.filter((face) => face.surfaceType === "plane");
  const cylindricalFaces = faces.filter((face) => face.surfaceType === "cylinder" && !!face.cylindricalFrame);
  const conicalFaces = faces.filter((face) => face.surfaceType === "cone");
  const bodyScale = properties ? Math.hypot(properties.boundingBox.max.x-properties.boundingBox.min.x, properties.boundingBox.max.y-properties.boundingBox.min.y, properties.boundingBox.max.z-properties.boundingBox.min.z) : undefined;
  const holes:RecognizedHoleCandidate[]=[];
  const rounds:RecognizedRoundCandidate[]=[];
  for(const face of cylindricalFaces){
    const radius=face.cylindricalFrame?.radiusMm, axialLengthMm=cylinderHeight(face), sense=cylindricalNormalSense(face);
    if(!radius||!axialLengthMm||radius<=0) continue;
    const adjacent=face.adjacentSurfaceTypes??[];
    const capEvidence=adjacent.some((kind)=>kind==="plane"||kind==="cone");
    const scaleEvidence=bodyScale===undefined||radius*2<bodyScale*.75;
    if(sense!==undefined&&sense<-.15){
      const confidence=Math.max(.55,Math.min(.995,.68+(capEvidence?.16:0)+(scaleEvidence?.1:0)+Math.min(.045,-sense*.045)));
      holes.push({kind:"hole",face,diameterMm:radius*2,axialLengthMm,confidence,reason:`concave analytic cylinder (${sense.toFixed(2)})${capEvidence?" + planar/conical adjacency":""}; exact radius/axis from OCCT`,depthCondition:inferHoleDepthCondition(face,axialLengthMm,properties)});
      continue;
    }
    if(sense!==undefined&&sense>.15){
      const smallRadius=bodyScale===undefined||radius<bodyScale*.18;
      const adjacencyEvidence=adjacent.filter((kind)=>kind==="plane").length>=1;
      const confidence=Math.max(.35,Math.min(.9,.45+(smallRadius?.2:0)+(adjacencyEvidence?.15:0)+Math.min(.1,sense*.1)));
      rounds.push({kind:"round",face,radiusMm:radius,relatedFaceLocalIds:[],confidence,reason:`convex analytic cylinder (${sense.toFixed(2)})${smallRadius?"; small radius relative to body":""}; candidate only, not auto-converted`});
    }
  }
  holes.sort((a,b)=>b.confidence-a.confidence||a.diameterMm-b.diameterMm);
  const convexCylinderFaces = rounds.map((entry)=>entry.face);
  for(const round of rounds) round.relatedFaceLocalIds=connectedAnalyticGroup(round.face,convexCylinderFaces,sameCylinderRadius);
  rounds.sort((a,b)=>b.confidence-a.confidence||b.relatedFaceLocalIds.length-a.relatedFaceLocalIds.length||a.radiusMm-b.radiusMm);
  const cones=conicalFaces.map((face):RecognizedConeCandidate=>({kind:"cone",face,relatedFaceLocalIds:connectedAnalyticGroup(face,conicalFaces,()=>true),confidence:face.adjacentSurfaceTypes?.some((kind)=>kind==="plane"||kind==="cylinder")?.72:.48,reason:"exact conical OCCT face; chamfer/countersink candidate requires user confirmation"})).sort((a,b)=>b.confidence-a.confidence||b.relatedFaceLocalIds.length-a.relatedFaceLocalIds.length);
  const prisms=recognizePrismaticCandidates(planarFaces,properties);
  const patterns=recognizeImportedHolePatterns(holes);
  return {holes,rounds,cones,prisms,patterns,planarFaces,cylindricalFaces,conicalFaces};
};
