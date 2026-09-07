import type { OffsetBodyFeature } from "../features/OffsetBodyFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";

export const evaluateOffsetBodyFeature = async (feature: OffsetBodyFeature, context: FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{
  if(!feature.enabled||feature.state==="suppressed") return featureEvaluationFailure(feature.id,"FEATURE_UNSUPPORTED","Suppressed Offset Body features are not evaluated.");
  const target=context.runtime?getRuntimeFeatureShape(context.runtime,feature.targetFeatureId):undefined;
  if(!target||!feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id,"FEATURE_DEPENDENCY_NOT_EVALUATED","Offset Body requires an evaluated target Feature.");
  if(!Number.isFinite(feature.distanceMm)||Math.abs(feature.distanceMm)<=context.tolerance.geometry) return featureEvaluationFailure(feature.id,"INVALID_INPUT","Offset distance must be finite and larger than geometry tolerance.");
  let result;
  try{
    result=await context.kernel.offset(target,feature.distanceMm,Math.max(context.tolerance.geometry,1e-6));
    const validation=await context.kernel.validate(result);
    if(!validation.valid){await context.kernel.disposeShape(result);return featureEvaluationFailure(feature.id,"INVALID_RESULT","OCCT Offset returned an invalid B-Rep.");}
    return {status:"success",featureId:feature.id,shape:result,validation,warnings:[]};
  }catch(error){
    if(result) await context.kernel.disposeShape(result).catch(()=>undefined);
    if(error instanceof KernelError) return featureEvaluationFailure(feature.id,"KERNEL_FAILURE",error.message,error,error.code);
    return featureEvaluationFailure(feature.id,"KERNEL_FAILURE",error instanceof Error?error.message:String(error),error);
  }
};
