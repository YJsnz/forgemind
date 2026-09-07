import type { HoleFeature, HoleStyle } from "../features/HoleFeature.ts";
import { KernelError, KernelOperationError } from "../kernel/KernelErrors.ts";
import type { KernelPlaneFrame, KernelShapeProperties, KernelShapeRef } from "../kernel/KernelTypes.ts";
import { getPlanarFaceFrame, PlanarFaceFrameError, faceLocalToWorld } from "../topology/PlanarFaceFrame.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
const corners = (properties: KernelShapeProperties) => { const { min, max } = properties.boundingBox; return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => ({ x, y, z })))); };

const toolPlane = (frame: KernelPlaneFrame, center: { x: number; y: number }, target: KernelShapeProperties, throughAll: boolean, depth: number, margin: number): { plane: KernelPlaneFrame; distance: number } => {
  const world = faceLocalToWorld(frame, center); const inward = { x: -frame.normal.x, y: -frame.normal.y, z: -frame.normal.z };
  const start = { x: world.x + frame.normal.x * margin, y: world.y + frame.normal.y * margin, z: world.z + frame.normal.z * margin };
  const distance = throughAll ? Math.max(...corners(target).map((corner) => dot({ x: corner.x - world.x, y: corner.y - world.y, z: corner.z - world.z }, inward))) + margin * 2 : depth + margin;
  return { plane: { origin: start, xAxis: frame.xAxis, yAxis: { x: -frame.yAxis.x, y: -frame.yAxis.y, z: -frame.yAxis.z }, normal: inward }, distance };
};

/** Builds the exact circular cutter used by Hole and feature-level repetition. */
const holeStyle = (feature: Pick<HoleFeature, "style">): HoleStyle => feature.style ?? { type: "simple" };

export const countersinkDepthMm = (mainDiameterMm: number, outerDiameterMm: number, includedAngleDeg: number): number =>
  (outerDiameterMm / 2 - mainDiameterMm / 2) / Math.tan(includedAngleDeg * Math.PI / 360);

const validateStyle = (feature: Pick<HoleFeature, "diameterMm" | "style">, tolerance: number): string | undefined => {
  const style = holeStyle(feature);
  if (style.type === "simple") return undefined;
  if (!Number.isFinite(style.diameterMm) || style.diameterMm <= feature.diameterMm + tolerance) return "Advanced Hole outer diameter must be finite and greater than the main diameter.";
  if (style.type === "counterbore" && (!Number.isFinite(style.depthMm) || style.depthMm <= tolerance)) return "Counterbore depth must be finite and greater than tolerance.";
  if (style.type === "countersink" && (!Number.isFinite(style.includedAngleDeg) || style.includedAngleDeg <= tolerance || style.includedAngleDeg >= 180 - tolerance || !Number.isFinite(countersinkDepthMm(feature.diameterMm, style.diameterMm, style.includedAngleDeg)) || countersinkDepthMm(feature.diameterMm, style.diameterMm, style.includedAngleDeg) <= tolerance)) return "Countersink included angle must be strictly between 0 and 180 degrees.";
  return undefined;
};

/** Builds the main bore plus exact entrance tool(s) used by Hole and patterns. */
export const createHoleTools = async (
  feature: Pick<HoleFeature, "id" | "diameterMm" | "depth" | "center" | "style">,
  frame: KernelPlaneFrame,
  target: KernelShapeProperties,
  context: FeatureEvaluationContext,
): Promise<KernelShapeRef[]> => {
  const margin = Math.max(context.tolerance.boolean * 10, context.tolerance.geometry * 10);
  const specification = toolPlane(frame, feature.center, target, feature.depth.type === "throughAll", feature.depth.type === "blind" ? feature.depth.valueMm : 0, margin);
  const main = await context.kernel.extrude({ profile: { id: `${feature.id}-tool`, outer: [{ type: "circle", center: [0, 0], radius: feature.diameterMm / 2 }], holes: [] }, plane: specification.plane }, { distanceMm: specification.distance, direction: "positive" });
  const style = holeStyle(feature);
  if (style.type === "simple") return [main];
  try {
    if (style.type === "counterbore") {
      const entry = await context.kernel.extrude({ profile: { id: `${feature.id}-counterbore`, outer: [{ type: "circle", center: [0, 0], radius: style.diameterMm / 2 }], holes: [] }, plane: specification.plane }, { distanceMm: style.depthMm + margin, direction: "positive" });
      return [main, entry];
    }
    const depth = countersinkDepthMm(feature.diameterMm, style.diameterMm, style.includedAngleDeg);
    const entry = await context.kernel.conicalTool({ plane: specification.plane, startRadiusMm: style.diameterMm / 2, endRadiusMm: feature.diameterMm / 2, heightMm: depth + margin });
    return [main, entry];
  } catch (error) { await context.kernel.disposeShape(main).catch(() => undefined); throw error; }
};

/** Compatibility helper retained for callers that require a simple cylindrical cutter. */
export const createHoleTool = async (
  feature: Pick<HoleFeature, "id" | "diameterMm" | "depth" | "center" | "style">,
  frame: KernelPlaneFrame,
  target: KernelShapeProperties,
  context: FeatureEvaluationContext,
): Promise<KernelShapeRef> => {
  const tools = await createHoleTools(feature, frame, target, context);
  if (tools.length !== 1) { for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined); throw new KernelOperationError("hole", "Advanced Hole requires the multi-tool evaluator path.", "HOLE_ADVANCED_MULTI_TOOL"); }
  return tools[0]!;
};

export const evaluateHoleFeature = async (feature: HoleFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Hole features are not evaluated.");
  if (!Number.isFinite(feature.diameterMm) || feature.diameterMm <= context.tolerance.geometry * 2) return featureEvaluationFailure(feature.id, "HOLE_INVALID_DIAMETER", "Hole diameter must be finite and greater than tolerance.");
  if (!Number.isFinite(feature.center.x) || !Number.isFinite(feature.center.y)) return featureEvaluationFailure(feature.id, "HOLE_INVALID_CENTER", "Hole center must be finite.");
  if (feature.depth.type === "blind" && (!Number.isFinite(feature.depth.valueMm) || feature.depth.valueMm <= context.tolerance.geometry)) return featureEvaluationFailure(feature.id, "HOLE_INVALID_DEPTH", "Blind hole depth must be finite and greater than tolerance.");
  const styleError = validateStyle(feature, context.tolerance.geometry);
  if (styleError) return featureEvaluationFailure(feature.id, "HOLE_INVALID_DIAMETER", styleError);
  const runtime = context.runtime; const target = runtime ? getRuntimeFeatureShape(runtime, feature.targetFeatureId) : undefined;
  if (!runtime || !target || !feature.dependencies.includes(feature.targetFeatureId)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Hole requires an evaluated target Feature.");
  const tools: KernelShapeRef[] = [];
  try {
    const topology = await resolvePersistentTopologyRef(feature.targetFace, runtime, context.kernel);
    const face = await context.kernel.getFaceInfo(topology); const frame = getPlanarFaceFrame(face);
    const properties = await context.kernel.getShapeProperties(target);
    tools.push(...await createHoleTools(feature, frame, properties, context));
    const result = await context.kernel.booleanCut(target, tools); const validation = await context.kernel.validate(result);
    if (!validation.valid) { await context.kernel.disposeShape(result); return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Hole Boolean returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape: result, validation, warnings: [] };
  } catch (error) {
    if (error instanceof TopologyResolutionError) return featureEvaluationFailure(feature.id, error.code, error.message, error);
    if (error instanceof PlanarFaceFrameError) return featureEvaluationFailure(feature.id, "HOLE_REQUIRES_PLANAR_FACE", error.message, error);
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, "HOLE_FAILED", error.message, error, error.code);
    return featureEvaluationFailure(feature.id, "HOLE_FAILED", error instanceof Error ? error.message : String(error), error);
  } finally { for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined); }
};
