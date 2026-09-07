import type { Feature } from "../features/Feature.ts";
import type { SurfacePatchFeature } from "../features/SurfacePatchFeature.ts";
import type { SurfaceExtrudeFeature } from "../features/SurfaceExtrudeFeature.ts";
import type { SurfaceRevolveFeature } from "../features/SurfaceRevolveFeature.ts";
import type { SurfaceSweepFeature } from "../features/SurfaceSweepFeature.ts";
import type { SurfaceLoftFeature } from "../features/SurfaceLoftFeature.ts";
import type { ExtractSurfaceFeature } from "../features/ExtractSurfaceFeature.ts";
import type { OffsetSurfaceFeature } from "../features/OffsetSurfaceFeature.ts";
import type { SewSurfaceFeature } from "../features/SewSurfaceFeature.ts";
import type { ThickenSurfaceFeature } from "../features/ThickenSurfaceFeature.ts";
import type { EncloseSurfaceFeature } from "../features/EncloseSurfaceFeature.ts";
import type { FillSurfaceFeature } from "../features/FillSurfaceFeature.ts";
import type { TrimSurfaceFeature } from "../features/TrimSurfaceFeature.ts";
import type { BSplineSurfaceFeature } from "../features/BSplineSurfaceFeature.ts";
import { bsplineSurfaceBoundaryMatches } from "../features/BSplineSurfaceFeature.ts";
import { reconcileRationalBSplineSections } from "../surface/RationalBSplineSections.ts";
import { reconcileTensorProductNurbs } from "../surface/TensorProductNurbs.ts";
import { resolveBSplineFeatureControlNet } from "../surface/BSplineFeatureControlNet.ts";
import { verifyBSplineSurfaceBoundaries } from "../surface/BSplineBoundaryVerification.ts";
import type { BoundarySurfaceFeature } from "../features/BoundarySurfaceFeature.ts";
import type { SplitSurfaceFeature } from "../features/SplitSurfaceFeature.ts";
import type { ReplaceFaceFeature } from "../features/ReplaceFaceFeature.ts";
import type { SurfaceIntersectionFeature } from "../features/SurfaceIntersectionFeature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelPathInput, KernelShapeRef, KernelTopologyRef } from "../kernel/KernelTypes.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { selectSingleProfile } from "./ExtrudeEvaluator.ts";
import { resolveSketchPlaneFrame } from "./SketchPlaneResolver.ts";
import { adaptiveToleranceValues, runAdaptiveBrepRecovery } from "./AdaptiveBrepRecovery.ts";
import { applyLoftEndConditions } from "./LoftEndConditions.ts";

const success = async (featureId: string, shape: KernelShapeRef, context: FeatureEvaluationContext, warnings: string[] = []): Promise<FeatureEvaluationResult> => {
  const validation = await context.kernel.validate(shape);
  if (!validation.valid) {
    await context.kernel.disposeShape(shape).catch(() => undefined);
    return featureEvaluationFailure(featureId, "INVALID_RESULT", "Surface operation returned an invalid B-Rep.");
  }
  return { status: "success", featureId, shape, validation, warnings };
};

const targetShape = (featureId: string, targetFeatureId: string, context: FeatureEvaluationContext): KernelShapeRef | FeatureEvaluationResult => {
  const shape = context.runtime ? getRuntimeFeatureShape(context.runtime, targetFeatureId) : undefined;
  return shape ?? featureEvaluationFailure(featureId, "FEATURE_DEPENDENCY_NOT_EVALUATED", `Surface feature requires evaluated target Feature ${targetFeatureId}.`);
};

const sourceShapes = (featureId: string, ids: string[], context: FeatureEvaluationContext): KernelShapeRef[] | FeatureEvaluationResult => {
  if (!context.runtime) return featureEvaluationFailure(featureId, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Surface feature requires runtime Feature shapes.");
  const shapes: KernelShapeRef[] = [];
  for (const id of ids) {
    const shape = getRuntimeFeatureShape(context.runtime, id);
    if (!shape) return featureEvaluationFailure(featureId, "FEATURE_DEPENDENCY_NOT_EVALUATED", `Surface source Feature ${id} is not evaluated.`);
    shapes.push(shape);
  }
  return shapes;
};

const fail = (featureId: string, error: unknown): FeatureEvaluationResult => {
  if (error instanceof TopologyResolutionError) return featureEvaluationFailure(featureId, error.code, error.message, error);
  if (error instanceof KernelError) return featureEvaluationFailure(featureId, "SURFACE_OPERATION_FAILED", error.message, error, error.code);
  return featureEvaluationFailure(featureId, "SURFACE_OPERATION_FAILED", error instanceof Error ? error.message : String(error), error);
};

export const evaluateSurfacePatchFeature = async (feature: SurfacePatchFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const selected = selectSingleProfile(feature.id, feature.sketchId, context); if ("status" in selected) return selected;
  const sketch = context.document.sketches[feature.sketchId]; if (!sketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Sketch ${feature.sketchId} was not found.`);
  let shape: KernelShapeRef | undefined;
  try { shape = await context.kernel.surfacePatch({ profile: selected.profile, plane: await resolveSketchPlaneFrame(sketch.plane, context) }); return await success(feature.id, shape, context, selected.warnings); }
  catch (error) { if (shape) await context.kernel.disposeShape(shape).catch(() => undefined); return fail(feature.id, error); }
};

export const evaluateSurfaceExtrudeFeature = async (feature: SurfaceExtrudeFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const selected = selectSingleProfile(feature.id, feature.sketchId, context); if ("status" in selected) return selected;
  const sketch = context.document.sketches[feature.sketchId]; if (!sketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Sketch ${feature.sketchId} was not found.`);
  if (!Number.isFinite(feature.distanceMm) || Math.abs(feature.distanceMm) <= context.tolerance.geometry) return featureEvaluationFailure(feature.id, "INVALID_INPUT", "Surface Extrude distance must be finite and non-zero.");
  let shape: KernelShapeRef | undefined;
  try { shape = await context.kernel.surfaceExtrude({ profile: selected.profile, plane: await resolveSketchPlaneFrame(sketch.plane, context) }, { distanceMm: feature.distanceMm, direction: feature.direction }); return await success(feature.id, shape, context, selected.warnings); }
  catch (error) { if (shape) await context.kernel.disposeShape(shape).catch(() => undefined); return fail(feature.id, error); }
};

export const evaluateSurfaceRevolveFeature = async (feature: SurfaceRevolveFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const selected = selectSingleProfile(feature.id, feature.sketchId, context); if ("status" in selected) return selected;
  const sketch = context.document.sketches[feature.sketchId]; if (!sketch) return featureEvaluationFailure(feature.id, "SKETCH_NOT_FOUND", `Sketch ${feature.sketchId} was not found.`);
  let shape: KernelShapeRef | undefined;
  try { shape = await context.kernel.surfaceRevolve({ profile: selected.profile, plane: await resolveSketchPlaneFrame(sketch.plane, context) }, { axis: feature.axis, angleDeg: feature.angleDeg }); return await success(feature.id, shape, context, selected.warnings); }
  catch (error) { if (shape) await context.kernel.disposeShape(shape).catch(() => undefined); return fail(feature.id, error); }
};

const branching = (sketch: NonNullable<FeatureEvaluationContext["document"]["sketches"][string]>): boolean => {
  const keys = new Map<string, number>(); const key=(point:{x:number;y:number})=>`${Math.round(point.x*1e6)}:${Math.round(point.y*1e6)}`;
  for(const entity of Object.values(sketch.entities)){if(entity.construction||(entity.type!=="line"&&entity.type!=="arc"))continue;const points=entity.type==="line"?[entity.start,entity.end]:[{x:entity.center.x+entity.radius*Math.cos(entity.startAngle),y:entity.center.y+entity.radius*Math.sin(entity.startAngle)},{x:entity.center.x+entity.radius*Math.cos(entity.endAngle),y:entity.center.y+entity.radius*Math.sin(entity.endAngle)}];for(const point of points)keys.set(key(point),(keys.get(key(point))??0)+1);} return [...keys.values()].some((count)=>count>2);
};

const prepareSurfaceSweepPath = async (featureId: string, sketchId: string, context: FeatureEvaluationContext): Promise<{ path: KernelPathInput; warnings: string[] } | FeatureEvaluationResult> => {
  const sketch=context.document.sketches[sketchId]; if(!sketch)return featureEvaluationFailure(featureId,"SKETCH_NOT_FOUND",`Surface Sweep path Sketch ${sketchId} was not found.`);
  const pathEntities=sketch.entityOrder.map((id)=>sketch.entities[id]).filter((entity)=>entity&&!entity.construction);
  const splines=pathEntities.filter((entity): entity is Extract<(typeof pathEntities)[number],{type:"spline"}|{type:"bspline"}>=>entity.type==="spline"||entity.type==="bspline");
  const splinePath=splines.length===1&&pathEntities.length===1&&!splines[0].closed?splines[0]:undefined;
  const built=context.buildProfiles(sketch);
  if(splines.length&&!splinePath)return featureEvaluationFailure(featureId,"SWEEP_PATH_SPLINE_AMBIGUOUS","Each Surface Sweep path must be one open Spline or one continuous Line/Arc chain.");
  if(!splinePath&&(built.openChains.length!==1||built.profiles.length))return featureEvaluationFailure(featureId,branching(sketch)?"SWEEP_PATH_BRANCHING_UNSUPPORTED":"SWEEP_PATH_NOT_CONTINUOUS","Surface Sweep requires one continuous open path.");
  const fitPoints=splinePath?(splinePath.type==="bspline"?splinePath.fitPoints:splinePath.controlPoints):undefined;
  if(fitPoints&&fitPoints.length<3)return featureEvaluationFailure(featureId,"SWEEP_PATH_SPLINE_INVALID","A spline sweep path requires at least three interpolation points.");
  return {path:{segments:splinePath?[]:built.openChains[0].segments,splinePoints:fitPoints?.map((point)=>[point.x,point.y]),splinePeriodic:false,splineStartTangent:splinePath?.type==="bspline"&&splinePath.startTangent?[splinePath.startTangent.x,splinePath.startTangent.y]:undefined,splineEndTangent:splinePath?.type==="bspline"&&splinePath.endTangent?[splinePath.endTangent.x,splinePath.endTangent.y]:undefined,plane:await resolveSketchPlaneFrame(sketch.plane,context)},warnings:splinePath?[splinePath.type==="bspline"?"Path is a native clamped OCCT interpolation B-Spline.":"Legacy spline path was upgraded to native OCCT interpolation during rebuild."]:built.warnings};
};

export const evaluateSurfaceSweepFeature = async (feature: SurfaceSweepFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const profile = selectSingleProfile(feature.id, feature.profileSketchId, context); if ("status" in profile) return profile;
  const profileSketch=context.document.sketches[feature.profileSketchId]; if(!profileSketch)return featureEvaluationFailure(feature.id,"SKETCH_NOT_FOUND","Surface Sweep profile Sketch was not found.");
  const path=await prepareSurfaceSweepPath(feature.id,feature.pathSketchId,context);if("status" in path)return path;
  let guide:Awaited<ReturnType<typeof prepareSurfaceSweepPath>>|undefined;
  if(feature.orientation==="guide"){if(!feature.guideSketchId)return featureEvaluationFailure(feature.id,"INVALID_INPUT","Guide orientation requires a third Guide Sketch.");guide=await prepareSurfaceSweepPath(feature.id,feature.guideSketchId,context);if("status" in guide)return guide;}
  let shape:KernelShapeRef|undefined;
  try{shape=await context.kernel.surfaceSweep({profile:profile.profile,plane:await resolveSketchPlaneFrame(profileSketch.plane,context)},path.path,{orientation:feature.orientation,upDirection:feature.upDirection,guidePath:guide&&!("status" in guide)?guide.path:undefined});return await success(feature.id,shape,context,[...profile.warnings,...path.warnings,...(guide&&!("status" in guide)?guide.warnings:[])]);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateSurfaceLoftFeature = async (feature: SurfaceLoftFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if(feature.sectionSketchIds.length<2)return featureEvaluationFailure(feature.id,"LOFT_REQUIRES_CLOSED_SECTION","Surface Loft requires at least two section sketches.");
  const sections=[] as Array<{profile: ReturnType<typeof context.buildProfiles>["profiles"][number]; plane: Awaited<ReturnType<typeof resolveSketchPlaneFrame>>}>; const warnings:string[]=[];
  for(const id of feature.sectionSketchIds){const selected=selectSingleProfile(feature.id,id,context);if("status" in selected)return selected;const sketch=context.document.sketches[id];if(!sketch)return featureEvaluationFailure(feature.id,"SKETCH_NOT_FOUND",`Section Sketch ${id} was not found.`);sections.push({profile:selected.profile,plane:await resolveSketchPlaneFrame(sketch.plane,context)});warnings.push(...selected.warnings);}
  let shape:KernelShapeRef|undefined;
  try{shape=await context.kernel.surfaceLoft(applyLoftEndConditions(sections,feature.startCondition,feature.endCondition,feature),{ruled:feature.ruled??false,closed:feature.closed});return await success(feature.id,shape,context,warnings);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateExtractSurfaceFeature = async (feature: ExtractSurfaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const target=targetShape(feature.id,feature.targetFeatureId,context);if("status" in target)return target;if(!context.runtime)return featureEvaluationFailure(feature.id,"FEATURE_DEPENDENCY_NOT_EVALUATED","Extract Surface requires runtime topology.");
  let shape:KernelShapeRef|undefined;
  try{const faces:KernelTopologyRef[]=[];for(const ref of feature.faces)faces.push(await resolvePersistentTopologyRef(ref,context.runtime,context.kernel));shape=await context.kernel.extractSurface(target,faces,feature.toleranceMm);return await success(feature.id,shape,context);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateOffsetSurfaceFeature = async (feature: OffsetSurfaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const target=targetShape(feature.id,feature.targetFeatureId,context);if("status" in target)return target;let shape:KernelShapeRef|undefined;
  try{const recovered=await runAdaptiveBrepRecovery(context.kernel,target,"曲面偏移",adaptiveToleranceValues(feature.toleranceMm).map((toleranceMm,index)=>({label:index===0?"原始几何":`容差 ${toleranceMm.toExponential(1)} mm`,run:(input)=>context.kernel.offsetSurface(input,feature.distanceMm,toleranceMm)})));shape=recovered.shape;return await success(feature.id,shape,context,recovered.warnings);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateSewSurfaceFeature = async (feature:SewSurfaceFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{const shapes=sourceShapes(feature.id,feature.sourceFeatureIds,context);if(!Array.isArray(shapes))return shapes;let shape:KernelShapeRef|undefined;try{shape=await context.kernel.sewSurfaces(shapes,feature.toleranceMm);return await success(feature.id,shape,context);}catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}};
export const evaluateThickenSurfaceFeature = async (feature:ThickenSurfaceFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{const target=targetShape(feature.id,feature.targetFeatureId,context);if("status" in target)return target;let shape:KernelShapeRef|undefined;try{const recovered=await runAdaptiveBrepRecovery(context.kernel,target,"曲面加厚",adaptiveToleranceValues(feature.toleranceMm).map((toleranceMm,index)=>({label:index===0?"原始几何":`容差 ${toleranceMm.toExponential(1)} mm`,run:(input)=>context.kernel.thickenSurface(input,feature.thicknessMm,toleranceMm)})));shape=recovered.shape;return await success(feature.id,shape,context,recovered.warnings);}catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}};
export const evaluateEncloseSurfaceFeature = async (feature:EncloseSurfaceFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{const shapes=sourceShapes(feature.id,feature.sourceFeatureIds,context);if(!Array.isArray(shapes))return shapes;let shape:KernelShapeRef|undefined;try{shape=await context.kernel.encloseSurfaces(shapes,feature.toleranceMm);return await success(feature.id,shape,context);}catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}};

export const evaluateFillSurfaceFeature = async (feature:FillSurfaceFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{
  if(!context.runtime)return featureEvaluationFailure(feature.id,"FEATURE_DEPENDENCY_NOT_EVALUATED","Fill Surface requires runtime topology.");
  let shape:KernelShapeRef|undefined;
  try{const edges:KernelTopologyRef[]=[];for(const ref of feature.boundaryEdges)edges.push(await resolvePersistentTopologyRef(ref,context.runtime,context.kernel));shape=await context.kernel.fillSurface(edges,feature.toleranceMm);return await success(feature.id,shape,context);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateTrimSurfaceFeature = async (feature:TrimSurfaceFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{
  const target=targetShape(feature.id,feature.targetFeatureId,context);if("status" in target)return target;const tool=targetShape(feature.id,feature.toolFeatureId,context);if("status" in tool)return tool;let shape:KernelShapeRef|undefined;
  try{shape=await context.kernel.trimSurface(target,tool,feature.keep,feature.toleranceMm);return await success(feature.id,shape,context);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateSurfaceIntersectionFeature = async (feature:SurfaceIntersectionFeature,context:FeatureEvaluationContext):Promise<FeatureEvaluationResult>=>{
  const shapes=sourceShapes(feature.id,feature.sourceFeatureIds,context);if(!Array.isArray(shapes))return shapes;
  let shape:KernelShapeRef|undefined;
  try{shape=await context.kernel.surfaceIntersection(shapes[0],shapes[1],feature.toleranceMm);return await success(feature.id,shape,context,["Exact OCCT section edges remain selectable and projectable; no mesh approximation was stored."]);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateBSplineSurfaceFeature = async (feature: BSplineSurfaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  let shape: KernelShapeRef | undefined;
  try {
    const controlNet = resolveBSplineFeatureControlNet(context.document, feature.id);
    const rationalSections = feature.rationalSections ? reconcileRationalBSplineSections(controlNet, feature.rationalSections) : undefined;
    const tensorNurbs = feature.tensorNurbs ? reconcileTensorProductNurbs(controlNet, feature.tensorNurbs) : undefined;
    shape = await context.kernel.bsplineSurface({ controlNet, rationalSections: tensorNurbs ? undefined : rationalSections, tensorNurbs });
    const relations = bsplineSurfaceBoundaryMatches(feature);
    if (relations.length) {
      const hasRationalBoundaryRelation = relations.some((relation) => {
        const source = context.document.features[relation.sourceFeatureId];
        return Boolean(feature.rationalSections || (source?.type === "bsplineSurface" && source.rationalSections));
      });
      // Rational section lofts keep the authored weight profile, but their
      // section direction is not a stable OCCT UV parameter direction after
      // the boundary-follow resample. Keep these legacy documents rebuildable
      // and report the limitation instead of failing the whole feature.
      if (hasRationalBoundaryRelation) {
        return await success(feature.id, shape, context, [
          `${relations.length} 条曲面边界已重建；有理截面保留原有边界关系，暂跳过参数方向连续性检查。`,
        ]);
      }
      const supports = relations.map((relation) => {
        const sourceShape = context.runtime ? getRuntimeFeatureShape(context.runtime, relation.sourceFeatureId) : undefined;
        if (!sourceShape) throw new Error(`基准曲面 ${relation.sourceFeatureId} 尚未成功重建。`);
        return { shape: sourceShape, relation };
      });
      await verifyBSplineSurfaceBoundaries(context.kernel, shape, supports, context.tolerance.geometry);
    }
    return await success(feature.id, shape, context, relations.length ? [`${relations.length} 条曲面边界已重建，并通过实际几何的 11 点连续性检查。`] : []);
  }
  catch (error) { if (shape) await context.kernel.disposeShape(shape).catch(() => undefined); return fail(feature.id, error); }
};

export const evaluateBoundarySurfaceFeature = async (feature: BoundarySurfaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!context.runtime) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Boundary Surface requires runtime topology.");
  let shape: KernelShapeRef | undefined;
  try { const edges: KernelTopologyRef[] = []; for (const ref of feature.boundaryEdges) edges.push(await resolvePersistentTopologyRef(ref, context.runtime, context.kernel)); const verification=feature.verification??{sampleCount:7,angularToleranceDeg:.5,curvatureTolerance:1e-3}; shape = await context.kernel.boundarySurface(edges, feature.toleranceMm, { continuity: feature.continuity, ...verification }); return await success(feature.id, shape, context, feature.continuity === "G0" ? [] : [`${feature.continuity} accepted by native multi-station boundary verification.`]); }
  catch (error) { if (shape) await context.kernel.disposeShape(shape).catch(() => undefined); return fail(feature.id, error); }
};



export const evaluateSplitSurfaceFeature = async (feature: SplitSurfaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const target=targetShape(feature.id,feature.targetFeatureId,context);if("status" in target)return target;const tool=targetShape(feature.id,feature.toolFeatureId,context);if("status" in tool)return tool;let shape:KernelShapeRef|undefined;
  try{shape=await context.kernel.splitSurface(target,tool,feature.toleranceMm);return await success(feature.id,shape,context);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateReplaceFaceFeature = async (feature: ReplaceFaceFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  const target=targetShape(feature.id,feature.targetFeatureId,context);if("status" in target)return target;const replacement=targetShape(feature.id,feature.replacementFeatureId,context);if("status" in replacement)return replacement;if(!context.runtime)return featureEvaluationFailure(feature.id,"FEATURE_DEPENDENCY_NOT_EVALUATED","Replace Face requires runtime topology.");let shape:KernelShapeRef|undefined;
  try{const face=await resolvePersistentTopologyRef(feature.targetFace,context.runtime,context.kernel);shape=await context.kernel.replaceFace(target,face,replacement,feature.toleranceMm);return await success(feature.id,shape,context);}
  catch(error){if(shape)await context.kernel.disposeShape(shape).catch(()=>undefined);return fail(feature.id,error);}
};

export const evaluateSurfaceFeature = async (feature: Feature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if(!feature.enabled||feature.state==="suppressed")return featureEvaluationFailure(feature.id,"FEATURE_UNSUPPORTED","Suppressed Surface features are not evaluated.");
  switch(feature.type){
    case "surfacePatch": return evaluateSurfacePatchFeature(feature,context);
    case "surfaceExtrude": return evaluateSurfaceExtrudeFeature(feature,context);
    case "surfaceRevolve": return evaluateSurfaceRevolveFeature(feature,context);
    case "surfaceSweep": return evaluateSurfaceSweepFeature(feature,context);
    case "surfaceLoft": return evaluateSurfaceLoftFeature(feature,context);
    case "extractSurface": return evaluateExtractSurfaceFeature(feature,context);
    case "offsetSurface": return evaluateOffsetSurfaceFeature(feature,context);
    case "sewSurface": return evaluateSewSurfaceFeature(feature,context);
    case "thickenSurface": return evaluateThickenSurfaceFeature(feature,context);
    case "encloseSurface": return evaluateEncloseSurfaceFeature(feature,context);
    case "fillSurface": return evaluateFillSurfaceFeature(feature,context);
    case "trimSurface": return evaluateTrimSurfaceFeature(feature,context);
    case "bsplineSurface": return evaluateBSplineSurfaceFeature(feature,context);
    case "boundarySurface": return evaluateBoundarySurfaceFeature(feature,context);
    case "splitSurface": return evaluateSplitSurfaceFeature(feature,context);
    case "replaceFace": return evaluateReplaceFaceFeature(feature,context);
    case "surfaceIntersection": return evaluateSurfaceIntersectionFeature(feature,context);
    default: return featureEvaluationFailure(feature.id,"FEATURE_UNSUPPORTED",`Feature ${feature.type} is not a Surface feature.`);
  }
};
