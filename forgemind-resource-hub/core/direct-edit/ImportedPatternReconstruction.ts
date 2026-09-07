import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { HoleStyle } from "../features/HoleFeature.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { RecognizedHolePatternCandidate } from "./ImportedPatternRecognition.ts";

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const ensureFreeId=(document:CadDocument<Sketch,Feature>,prefix:string):string=>{let index=1;let id=prefix;while(document.features[id])id=`${prefix}${++index}`;return id;};

export interface ImportedHolePatternPreview {
  document: CadDocument<Sketch, Feature>;
  baseFeatureId: string;
  healFeatureId: string;
  bodyId: string;
  sourceLabel: string;
  pattern: RecognizedHolePatternCandidate;
  memberFaces: PersistentFaceRef[];
  seedMemberIndex: number;
  diameterMm: number;
}

export interface ImportedHolePatternReconstruction extends ImportedHolePatternPreview {
  seedFeatureId: string;
  patternFeatureId: string;
}

/** Stage 1: remove every repeated imported cylindrical hole in one source-state aware Feature. */
export const createImportedHolePatternPreview=(options:{
  document:CadDocument<Sketch,Feature>;
  bodyId:string;
  targetFeatureId:string;
  sourceLabel:string;
  pattern:RecognizedHolePatternCandidate;
  memberFaces:PersistentFaceRef[];
  seedMemberIndex?:number;
}):ImportedHolePatternPreview=>{
  if(!options.document.features[options.targetFeatureId]||!options.document.bodies[options.bodyId])throw new Error("Imported Pattern reconstruction target is missing.");
  if(options.memberFaces.length!==options.pattern.count||options.memberFaces.length<3)throw new Error("Imported Pattern member Face count must match the recognized pattern count.");
  if(options.memberFaces.some((face)=>face.sourceFeatureId!==options.targetFeatureId))throw new Error("Every imported Pattern member must belong to the same source Feature state.");
  const seedMemberIndex=options.seedMemberIndex??0;
  if(!Number.isInteger(seedMemberIndex)||seedMemberIndex<0||seedMemberIndex>=options.pattern.count)throw new Error("Imported Pattern seed member index is invalid.");
  const document=clone(options.document);const healFeatureId=ensureFreeId(document,"RecognizedPatternHeal");
  document.features[healFeatureId]={id:healFeatureId,name:`${options.sourceLabel} · Heal repeated holes`,type:"healHolePattern",bodyId:options.bodyId,targetFeatureId:options.targetFeatureId,cylindricalFaces:clone(options.memberFaces),enabled:true,state:"clean",dependencies:[options.targetFeatureId]};
  document.featureOrder.push(healFeatureId);document.updatedAt=Date.now();
  return{document,baseFeatureId:options.targetFeatureId,healFeatureId,bodyId:options.bodyId,sourceLabel:options.sourceLabel,pattern:clone(options.pattern),memberFaces:clone(options.memberFaces),seedMemberIndex,diameterMm:options.pattern.diameterMm};
};

/**
 * Stage 2: create one native seed Hole on the healed body and one native Pattern.
 * The selected target Face must belong to the heal preview state, which prevents
 * stale source topology from leaking into reconstructed parametric history.
 */
export const completeImportedHolePatternReconstruction=(options:{
  preview:ImportedHolePatternPreview;
  targetFace:PersistentFaceRef;
  center:{x:number;y:number};
  depth:{type:"throughAll"}|{type:"blind";valueMm:number};
  style?:HoleStyle;
}):ImportedHolePatternReconstruction=>{
  if(options.targetFace.sourceFeatureId!==options.preview.healFeatureId)throw new Error("Pattern seed target Face must come from the healed preview state.");
  if(!Number.isFinite(options.center.x)||!Number.isFinite(options.center.y))throw new Error("Pattern seed center must be finite.");
  if(options.depth.type==="blind"&&(!Number.isFinite(options.depth.valueMm)||options.depth.valueMm<=0))throw new Error("Blind Pattern seed depth must be positive and finite.");
  const document=clone(options.preview.document);const seedFeatureId=ensureFreeId(document,"ReconstructedPatternSeedHole");
  document.features[seedFeatureId]={id:seedFeatureId,name:`Pattern Seed Hole Ø${options.preview.diameterMm}`,type:"hole",bodyId:options.preview.bodyId,targetFeatureId:options.preview.healFeatureId,targetFace:clone(options.targetFace),center:{...options.center},diameterMm:options.preview.diameterMm,depth:clone(options.depth),style:clone(options.style??{type:"simple"}),enabled:true,state:"clean",dependencies:[options.preview.healFeatureId]};
  document.featureOrder.push(seedFeatureId);
  const patternFeatureId=ensureFreeId(document,options.preview.pattern.kind==="linear-hole-pattern"?"ReconstructedLinearPattern":"ReconstructedCircularPattern");
  document.features[patternFeatureId]=options.preview.pattern.kind==="linear-hole-pattern"?{
    id:patternFeatureId,name:`Reconstructed Linear Pattern · ${options.preview.pattern.count} × ${options.preview.pattern.spacingMm.toFixed(3)} mm`,type:"linearPattern",bodyId:options.preview.bodyId,targetFeatureId:options.preview.healFeatureId,seedFeatureIds:[seedFeatureId],direction:clone(options.preview.pattern.direction),count:options.preview.pattern.count,spacingMm:options.preview.pattern.spacingMm,seedIndex:options.preview.seedMemberIndex,enabled:true,state:"clean",dependencies:[options.preview.healFeatureId,seedFeatureId]
  }:{
    id:patternFeatureId,name:`Reconstructed Circular Pattern · ${options.preview.pattern.count} × ${options.preview.pattern.angleDeg.toFixed(1)}°`,type:"circularPattern",bodyId:options.preview.bodyId,targetFeatureId:options.preview.healFeatureId,seedFeatureIds:[seedFeatureId],axis:clone(options.preview.pattern.axis),count:options.preview.pattern.count,angleDeg:options.preview.pattern.angleDeg,enabled:true,state:"clean",dependencies:[options.preview.healFeatureId,seedFeatureId]
  };
  document.featureOrder.push(patternFeatureId);document.updatedAt=Date.now();
  return{...options.preview,document,seedFeatureId,patternFeatureId};
};
