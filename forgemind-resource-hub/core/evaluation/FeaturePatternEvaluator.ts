import type { Vec3 } from "../cad/CadTypes.ts";
import type { FeaturePatternFeature, MirrorPlane } from "../features/FeaturePatternFeature.ts";
import type { Feature } from "../features/Feature.ts";
import { KernelError } from "../kernel/KernelErrors.ts";
import type { KernelMirrorPlane, KernelShapeRef } from "../kernel/KernelTypes.ts";
import { getPlanarFaceFrame, PlanarFaceFrameError } from "../topology/PlanarFaceFrame.ts";
import { resolvePersistentTopologyRef, TopologyResolutionError } from "../topology/TopologyResolver.ts";
import { getRuntimeFeatureShape } from "./CadRuntimeState.ts";
import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";
import { featureEvaluationFailure } from "./FeatureEvaluation.ts";
import { createHoleTools } from "./HoleEvaluator.ts";
import { createPocketTool } from "./PocketEvaluator.ts";

type Operation = { type: "translate"; offset: Vec3 } | { type: "rotate"; axis: { origin: Vec3; direction: Vec3 }; angleDeg: number } | { type: "mirror"; plane: KernelMirrorPlane };

const directionVector = (direction: "X" | "Y" | "Z" | Vec3): Vec3 => {
  if (direction === "X") return { x: 1, y: 0, z: 0 };
  if (direction === "Y") return { x: 0, y: 1, z: 0 };
  if (direction === "Z") return { x: 0, y: 0, z: 1 };
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12) return { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  return { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude };
};
const finiteVector = (value: Vec3) => [value.x, value.y, value.z].every(Number.isFinite);
const plane = (value: MirrorPlane): KernelMirrorPlane => {
  if (value === "XY") return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
  if (value === "YZ") return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
  if (value === "XZ") return { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
  return value;
};

const operationPlan = (feature: FeaturePatternFeature, tolerance: number): Operation[] | string => {
  if (!feature.seedFeatureIds.length) return "Pattern requires at least one seed Feature.";
  if (feature.type === "linearPattern") {
    if (!Number.isInteger(feature.count) || feature.count < 2) return "Linear Pattern count must be an integer of at least 2.";
    if (!Number.isFinite(feature.spacingMm) || feature.spacingMm <= tolerance) return "Linear Pattern spacing must be greater than geometry tolerance.";
    if (feature.seedIndex !== undefined && (!Number.isInteger(feature.seedIndex) || feature.seedIndex < 0 || feature.seedIndex >= feature.count)) return "Linear Pattern seedIndex must reference one recovered member.";
    const vector = directionVector(feature.direction);
    if (!finiteVector(vector)) return "Linear Pattern direction must be a finite non-zero axis.";
    const origin = feature.symmetric ? -(feature.count - 1) / 2 : -(feature.seedIndex ?? 0);
    return Array.from({ length: feature.count }, (_, index) => {
      const magnitude = (origin + index) * feature.spacingMm;
      return { type: "translate" as const, offset: { x: vector.x * magnitude, y: vector.y * magnitude, z: vector.z * magnitude } };
    });
  }
  if (feature.type === "circularPattern") {
    if (!Number.isInteger(feature.count) || feature.count < 2) return "Circular Pattern count must be an integer of at least 2.";
    if (!Number.isFinite(feature.angleDeg) || feature.angleDeg <= 0 || feature.angleDeg > 360 || !finiteVector(feature.axis.origin) || !finiteVector(feature.axis.direction) || Math.hypot(feature.axis.direction.x, feature.axis.direction.y, feature.axis.direction.z) <= tolerance) return "Circular Pattern requires a finite non-zero axis and 0 < angle ≤ 360 degrees.";
    const divisor = Math.abs(feature.angleDeg - 360) <= tolerance ? feature.count : feature.count - 1;
    return Array.from({ length: feature.count }, (_, index) => ({ type: "rotate" as const, axis: feature.axis, angleDeg: feature.angleDeg * index / divisor }));
  }
  const mirrorPlane = plane(feature.plane);
  if (!finiteVector(mirrorPlane.origin) || !finiteVector(mirrorPlane.normal) || Math.hypot(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z) <= tolerance) return "Mirror Plane requires a finite origin and non-zero normal.";
  // A feature mirror retains the seed and adds exactly one reflected instance.
  return [{ type: "translate", offset: { x: 0, y: 0, z: 0 } }, { type: "mirror", plane: mirrorPlane }];
};

const transform = async (shape: KernelShapeRef, operation: Operation, context: FeatureEvaluationContext): Promise<KernelShapeRef> => {
  if (operation.type === "translate") return context.kernel.translate(shape, operation.offset);
  if (operation.type === "rotate") return context.kernel.rotate(shape, operation.axis, operation.angleDeg);
  return context.kernel.mirror(shape, operation.plane);
};

const buildSeedTools = async (seed: Feature, target: KernelShapeRef, context: FeatureEvaluationContext): Promise<KernelShapeRef[]> => {
  if (seed.type === "pocket") return [(await createPocketTool(seed, target, context)).tool];
  if (seed.type !== "hole") throw new Error(`${seed.type} is not a subtractive Feature seed.`);
  const runtime = context.runtime!;
  const topology = await resolvePersistentTopologyRef(seed.targetFace, runtime, context.kernel);
  const frame = getPlanarFaceFrame(await context.kernel.getFaceInfo(topology));
  return createHoleTools(seed, frame, await context.kernel.getShapeProperties(target), context);
};

/** Evaluates exact repeated Hole/Pocket cutters and connected additive Extrude seeds. */
export const evaluateFeaturePattern = async (feature: FeaturePatternFeature, context: FeatureEvaluationContext): Promise<FeatureEvaluationResult> => {
  if (!feature.enabled || feature.state === "suppressed") return featureEvaluationFailure(feature.id, "FEATURE_UNSUPPORTED", "Suppressed Pattern features are not evaluated.");
  const operations = operationPlan(feature, context.tolerance.geometry);
  if (typeof operations === "string") return featureEvaluationFailure(feature.id, "PATTERN_INVALID_PARAMETERS", operations);
  const runtime = context.runtime; const target = runtime ? getRuntimeFeatureShape(runtime, feature.targetFeatureId) : undefined;
  if (!runtime || !target) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", "Pattern requires an evaluated target Feature.");
  const seeds = feature.seedFeatureIds.map((id) => context.document.features[id]);
  if (seeds.some((seed) => !seed)) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_MISSING", "Pattern contains an unknown seed Feature.");
  const typedSeeds = seeds as Feature[];
  for (const seed of typedSeeds) {
    if ((seed.type === "hole" || seed.type === "pocket") && seed.targetFeatureId !== feature.targetFeatureId) return featureEvaluationFailure(feature.id, "PATTERN_TARGET_MISMATCH", "Pattern seed and Pattern target must reference the same base Feature.");
  }

  const tools: KernelShapeRef[] = [];
  let result: KernelShapeRef | undefined;
  try {
    const subtractive = typedSeeds.every((seed) => seed.type === "hole" || seed.type === "pocket");
    if (subtractive) {
      for (const seed of typedSeeds) for (const operation of operations) {
        const sourceTools = await buildSeedTools(seed, target, context);
        try { for (const sourceTool of sourceTools) tools.push(await transform(sourceTool, operation, context)); } finally { for (const sourceTool of sourceTools) await context.kernel.disposeShape(sourceTool); }
      }
      result = await context.kernel.booleanCut(target, tools);
    } else if (typedSeeds.every((seed) => seed.type === "extrude" && seed.operation === "new")) {
      for (const seed of typedSeeds) {
        const source = getRuntimeFeatureShape(runtime, seed.id);
        if (!source) return featureEvaluationFailure(feature.id, "FEATURE_DEPENDENCY_NOT_EVALUATED", `Pattern seed ${seed.id} has not been evaluated.`);
        for (const operation of operations) tools.push(await transform(source, operation, context));
      }
      result = await context.kernel.booleanUnion(target, tools);
    } else return featureEvaluationFailure(feature.id, "PATTERN_SEED_UNSUPPORTED", "Pattern V1 supports Hole, Through-All Pocket, and additive new Extrude seeds.");
    const validation = await context.kernel.validate(result);
    if (!validation.valid) { await context.kernel.disposeShape(result); result = undefined; return featureEvaluationFailure(feature.id, "INVALID_RESULT", "Pattern Boolean returned an invalid B-Rep."); }
    return { status: "success", featureId: feature.id, shape: result, validation, warnings: [] };
  } catch (error) {
    if (error instanceof TopologyResolutionError) return featureEvaluationFailure(feature.id, error.code, error.message, error);
    if (error instanceof PlanarFaceFrameError) return featureEvaluationFailure(feature.id, "HOLE_REQUIRES_PLANAR_FACE", error.message, error);
    if (error instanceof KernelError) return featureEvaluationFailure(feature.id, "PATTERN_FAILED", error.message, error, error.code);
    return featureEvaluationFailure(feature.id, "PATTERN_FAILED", error instanceof Error ? error.message : String(error), error);
  } finally {
    for (const tool of tools) await context.kernel.disposeShape(tool).catch(() => undefined);
  }
};
