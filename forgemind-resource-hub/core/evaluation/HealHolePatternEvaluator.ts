import type { Vec3 } from "../cad/CadTypes.ts";
import type { HealHolePatternFeature } from "../features/HealHolePatternFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelPlaneFrame, KernelShapeRef } from "../kernel/KernelTypes.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { inferCylindricalFaceHeightMm } from "./RemoveHoleEvaluator.ts";

const length=(v:Vec3)=>Math.hypot(v.x,v.y,v.z);
const unit=(v:Vec3):Vec3=>{const n=length(v);if(!Number.isFinite(n)||n<=1e-12)throw new Error("Zero cylinder axis.");return{x:v.x/n,y:v.y/n,z:v.z/n};};
const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const scale=(v:Vec3,s:number):Vec3=>({x:v.x*s,y:v.y*s,z:v.z*s});
const add=(a:Vec3,b:Vec3):Vec3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const frameForCylinder=(center:Vec3,axisDirection:Vec3,height:number,margin:number):KernelPlaneFrame=>{
  const normal=unit(axisDirection);const seed:Vec3=Math.abs(normal.z)<.9?{x:0,y:0,z:1}:{x:0,y:1,z:0};
  const xAxis=unit(cross(seed,normal));const yAxis=unit(cross(normal,xAxis));
  return{origin:add(center,scale(normal,-(height/2+margin))),xAxis,yAxis,normal};
};

/** Fills every recognized cylindrical hole member against one immutable source state. */
export const evaluateHealHolePatternFeature=async(feature:HealHolePatternFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{
  if(!feature.enabled||feature.state==="suppressed")return featureEvaluationFailure(feature.id,"FEATURE_UNSUPPORTED","Suppressed Heal Hole Pattern features are not evaluated.");
  const runtime=context.runtime;const target=runtime?getRuntimeFeatureShape(runtime,feature.targetFeatureId):undefined;
  if(!runtime||!target)return featureEvaluationFailure(feature.id,"FEATURE_DEPENDENCY_NOT_EVALUATED","Heal Hole Pattern requires an evaluated target Feature.");
  if(feature.cylindricalFaces.length<2)return featureEvaluationFailure(feature.id,"INVALID_INPUT","Heal Hole Pattern requires at least two cylindrical member Faces.");
  const fillers:KernelShapeRef[]=[];
  try{
    for(const persistent of feature.cylindricalFaces){
      const topology=await resolvePersistentTopologyRef(persistent,runtime,context.kernel);const face=await context.kernel.getFaceInfo(topology);const cylinder=face.cylindricalFrame;
      if(face.surfaceType!=="cylinder"||!cylinder||!face.centerMm||!Number.isFinite(face.areaMm2)||!face.areaMm2) return featureEvaluationFailure(feature.id,"INVALID_INPUT","Every pattern member must resolve to an analytic cylindrical Face.");
      const height=inferCylindricalFaceHeightMm(face.areaMm2,cylinder.radiusMm);if(!Number.isFinite(height)||height<=context.tolerance.geometry)return featureEvaluationFailure(feature.id,"INVALID_INPUT","A pattern member has no usable axial extent.");
      const margin=Math.max(feature.axialMarginMm??context.tolerance.boolean*20,context.tolerance.geometry*20);
      fillers.push(await context.kernel.cylindricalTool({plane:frameForCylinder(face.centerMm,cylinder.axisDirection,height,margin),radiusMm:cylinder.radiusMm+margin*.05,heightMm:height+margin*2}));
    }
    const result=await context.kernel.booleanUnion(target,fillers);const validation=await context.kernel.validate(result);
    if(!validation.valid){await context.kernel.disposeShape(result);return featureEvaluationFailure(feature.id,"INVALID_RESULT","Heal Hole Pattern union returned an invalid B-Rep.");}
    return{status:"success",featureId:feature.id,shape:result,validation,warnings:[]};
  }catch(error){
    if(error instanceof TopologyResolutionError)return featureEvaluationFailure(feature.id,error.code,error.message,error);
    if(error instanceof KernelError)return featureEvaluationFailure(feature.id,"KERNEL_FAILURE",error.message,error,error.code);
    return featureEvaluationFailure(feature.id,"KERNEL_FAILURE",error instanceof Error?error.message:String(error),error);
  }finally{for(const filler of fillers)await context.kernel.disposeShape(filler).catch(()=>undefined);}
};
