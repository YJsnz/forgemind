import type { UUID } from "../cad/CadTypes.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { FeatureEvaluationResult } from "./FeatureEvaluation.ts";

/** Runtime-only evaluation cache. It is deliberately separate from CadDocument. */
export interface CadRuntimeState {
  featureShapes: Map<UUID, KernelShapeRef>;
  /** Runtime-only pass-through links; aliases never own or release a Shape. */
  featureAliases: Map<UUID, UUID>;
  bodyShapes: Map<UUID, KernelShapeRef>;
  featureResults: Map<UUID, FeatureEvaluationResult>;
}

export const createCadRuntimeState = (): CadRuntimeState => ({
  featureShapes: new Map(),
  featureAliases: new Map(),
  bodyShapes: new Map(),
  featureResults: new Map(),
});

export const getRuntimeFeatureShape = (state: CadRuntimeState, featureId: UUID): KernelShapeRef | undefined => {
  const seen = new Set<UUID>(); let current = featureId;
  // An alias takes precedence over a still-retained active shape while a
  // rebuild is staged. This prevents a suppressed modifier from accidentally
  // exposing its previous output to a downstream evaluator before commit.
  while (!seen.has(current)) { seen.add(current); const next = state.featureAliases.get(current); if (next) { current = next; continue; } const shape = state.featureShapes.get(current); if (shape) return shape; return undefined; }
  return undefined;
};

const sameShape = (left: KernelShapeRef, right: KernelShapeRef): boolean =>
  left.id === right.id && left.revision === right.revision;

/** Replaces a Feature-owned shape and releases the previous runtime-only result. */
export const replaceFeatureShape = async (
  state: CadRuntimeState,
  kernel: CadKernel,
  featureId: UUID,
  nextShape: KernelShapeRef,
): Promise<void> => {
  const previous = state.featureShapes.get(featureId);
  if (previous && !sameShape(previous, nextShape)) await kernel.disposeShape(previous);
  state.featureShapes.set(featureId, nextShape);
  state.featureAliases.delete(featureId);
};

export const recordFeatureEvaluationResult = (
  state: CadRuntimeState,
  result: FeatureEvaluationResult,
): void => {
  state.featureResults.set(result.featureId, result);
};

/** Releases every retained shape once, even when feature and body maps share it. */
export const disposeCadRuntimeState = async (state: CadRuntimeState, kernel: CadKernel): Promise<void> => {
  const uniqueShapes = new Map<string, KernelShapeRef>();
  for (const shape of [...state.featureShapes.values(), ...state.bodyShapes.values()]) {
    uniqueShapes.set(`${shape.id}:${shape.revision}`, shape);
  }
  for (const shape of uniqueShapes.values()) await kernel.disposeShape(shape);
  state.featureShapes.clear();
  state.featureAliases.clear();
  state.bodyShapes.clear();
  state.featureResults.clear();
};
