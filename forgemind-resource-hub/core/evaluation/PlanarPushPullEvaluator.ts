import { buildPlanarFaceProfile, PlanarPushPullError } from "../direct-edit/PlanarPushPull.ts";
import type { PlanarPushPullFeature } from "../features/PlanarPushPullFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

export const evaluatePlanarPushPullFeature=async(feature:PlanarPushPullFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{
  if(!feature.enabled||feature.state==="suppressed") return featureEvaluationFailure(feature.id,"FEATURE_UNSUPPORTED","Suppressed Push/Pull features are not evaluated.");
  const runtime=context.runtime,target=runtime?getRuntimeFeatureShape(runtime,feature.targetFeatureId):undefined;
  if(!runtime||!target||!feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id,"FEATURE_DEPENDENCY_NOT_EVALUATED","Planar Push/Pull requires an evaluated target Feature.");
  if(!Number.isFinite(feature.distanceMm)||Math.abs(feature.distanceMm)<=context.tolerance.geometry) return featureEvaluationFailure(feature.id,"INVALID_INPUT","Push/Pull distance must be finite and larger than geometry tolerance.");
  const owned:KernelShapeRef[]=[];
  let result:KernelShapeRef|undefined;
  try{
    const topology=await resolvePersistentTopologyRef(feature.planarFace,runtime,context.kernel);
    const face=await context.kernel.getFaceInfo(topology);
    const {loopInputs}=await buildPlanarFaceProfile(face,context.kernel);
    const positive=feature.distanceMm>0;
    const direction=positive?"positive":"negative" as const;
    const extruded:KernelShapeRef[]=[];
    for(const input of loopInputs){const shape=await context.kernel.extrude(input,{distanceMm:Math.abs(feature.distanceMm),direction});owned.push(shape);extruded.push(shape);}
    let tool=extruded[0];
    if(!tool) throw new PlanarPushPullError("PUSH_PULL_BOUNDARY_UNAVAILABLE","Push/Pull could not create an outer tool solid.");
    if(extruded.length>1){
      const annular=await context.kernel.booleanCut(tool,extruded.slice(1));owned.push(annular);tool=annular;
    }
    result=positive?await context.kernel.booleanUnion(target,[tool]):await context.kernel.booleanCut(target,[tool]);
    const validation=await context.kernel.validate(result);
    if(!validation.valid){await context.kernel.disposeShape(result);result=undefined;return featureEvaluationFailure(feature.id,"INVALID_RESULT","Planar Push/Pull produced an invalid B-Rep.");}
    return {status:"success",featureId:feature.id,shape:result,validation,warnings:[]};
  }catch(error){
    if(result) await context.kernel.disposeShape(result).catch(()=>undefined);
    if(error instanceof PlanarPushPullError) return featureEvaluationFailure(feature.id,"INVALID_INPUT",error.message,error);
    if(error instanceof TopologyResolutionError) return featureEvaluationFailure(feature.id,error.code,error.message,error);
    if(error instanceof KernelError) return featureEvaluationFailure(feature.id,"KERNEL_FAILURE",error.message,error,error.code);
    return featureEvaluationFailure(feature.id,"KERNEL_FAILURE",error instanceof Error?error.message:String(error),error);
  }finally{
    const unique=new Map(owned.map((shape)=>[shape.id,shape]));
    for(const shape of unique.values()) await context.kernel.disposeShape(shape).catch(()=>undefined);
  }
};
