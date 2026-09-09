import type { CadDocument } from "../cad/CadDocument.ts";
import type { CadToleranceSettings } from "../cad/Tolerance.ts";
import { type CadRuntimeState, getRuntimeFeatureShape, recordFeatureEvaluationResult } from "../evaluation/CadRuntimeState.ts";
import { evaluateFeature, type FeatureEvaluationResult } from "../evaluation/FeatureEvaluation.ts";
import type { SketchProfileBuilder } from "../evaluation/FeatureEvaluationContext.ts";
import type { Feature } from "../features/Feature.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import { buildFeatureGraph, FeatureGraphError } from "./FeatureGraph.ts";
import { computeDirtyFeatures } from "./DirtyPropagation.ts";
import { type RebuildRequest, type RebuildResult, type RebuildRuntimeState } from "./RebuildTypes.ts";
import { computeCadDocumentFingerprint } from "../cad/CadDocumentPersistence.ts";
import { deriveBodyTipFeatureId } from "../cad/CadBodies.ts";
import type { CadAssetStore } from "../cad/CadAssets.ts";

const same = (a: KernelShapeRef, b: KernelShapeRef) => a.id === b.id && a.revision === b.revision;
const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
const yieldToBrowser = async (): Promise<void> => {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
};

export interface RebuildEngineContext { document: CadDocument<Sketch, Feature>; runtime: CadRuntimeState; rebuildRuntime: RebuildRuntimeState; kernel: CadKernel; tolerance: CadToleranceSettings; buildProfiles: SketchProfileBuilder; assets?: CadAssetStore; }

/** Staged runtime lookup: evaluators see new upstream Shapes before active runtime changes. */
const stagedRuntime = (active: CadRuntimeState, staged: Map<string, KernelShapeRef>, aliases: Map<string, string>): CadRuntimeState => ({ ...active, featureShapes: new Map([...active.featureShapes, ...staged]), featureAliases: new Map([...active.featureAliases, ...aliases]) });

const rollback = async (kernel: CadKernel, staged: Map<string, KernelShapeRef>) => { for (const shape of staged.values()) await kernel.disposeShape(shape).catch(() => undefined); };
const commitRebuildBatch = async (active: CadRuntimeState, kernel: CadKernel, staged: Map<string, KernelShapeRef>, aliases: Map<string, string>, results: Map<string, FeatureEvaluationResult>): Promise<void> => {
  const old = new Map<string, KernelShapeRef>(); for (const [id, shape] of staged) { const previous = active.featureShapes.get(id); if (previous && !same(previous, shape)) old.set(id, previous); }
  // All mutations happen before releases, so no caller can observe a partially released plan.
  for (const [id, shape] of staged) active.featureShapes.set(id, shape);
  for (const [id, target] of aliases) { const previous = active.featureShapes.get(id); if (previous) old.set(id, previous); active.featureShapes.delete(id); active.featureAliases.set(id, target); active.featureResults.delete(id); }
  for (const id of staged.keys()) active.featureAliases.delete(id);
  for (const result of results.values()) recordFeatureEvaluationResult(active, result);
  for (const previous of old.values()) await kernel.disposeShape(previous);
};

/** Body runtime results are non-owning views onto feature output shapes. Feature
 * ownership remains the single disposal authority, while the Body map gives
 * viewport code a deterministic multi-body render source. */
const deriveRuntimeBodies = (document: CadDocument<Sketch, Feature>, runtime: CadRuntimeState): void => {
  runtime.bodyShapes.clear();
  for (const bodyId of Object.keys(document.bodies)) {
    const tip = deriveBodyTipFeatureId(document, bodyId);
    const shape = tip ? getRuntimeFeatureShape(runtime, tip) : undefined;
    if (shape) runtime.bodyShapes.set(bodyId, shape);
  }
};

export const rebuildDocument = async (context: RebuildEngineContext, request: RebuildRequest = {}): Promise<RebuildResult> => {
  context.rebuildRuntime.currentDocumentFingerprint = computeCadDocumentFingerprint(context.document);
  const started = now(); const result: RebuildResult = { success: false, evaluatedFeatureIds: [], skippedFeatureIds: [], suppressedFeatureIds: [], failedFeatureIds: [], blockedFeatureIds: [], durationMs: 0, errors: [] };
  let graph; try { graph = buildFeatureGraph(context.document); } catch (error) { const issue = error instanceof FeatureGraphError ? error : new FeatureGraphError("FEATURE_DEPENDENCY_MISSING", String(error)); result.errors.push({ featureId: "graph", code: issue.code, message: issue.message }); result.durationMs = now() - started; return result; }
  const needsFull = request.full || context.runtime.featureShapes.size === 0; const dirty = needsFull ? new Set(graph.order) : computeDirtyFeatures(graph, request); const staged = new Map<string, KernelShapeRef>(); const aliases = new Map<string, string>(); const results = new Map<string, FeatureEvaluationResult>(); const failed = new Set<string>();
  let processedFeatureCount = 0;
  for (const id of graph.order) {
    const feature = context.document.features[id]; if (!dirty.has(id)) { result.skippedFeatureIds.push(id); continue; }
    if ([...graph.dependencies.get(id)!].some((dependency) => failed.has(dependency))) { result.blockedFeatureIds.push(id); context.rebuildRuntime.features.set(id, { featureId: id, status: "blocked" }); failed.add(id); continue; }
    if (!feature.enabled || feature.state === "suppressed") { const upstream = [...graph.dependencies.get(id)!][0]; if (!upstream || !getRuntimeFeatureShape(stagedRuntime(context.runtime, staged, aliases), upstream)) { result.blockedFeatureIds.push(id); context.rebuildRuntime.features.set(id, { featureId: id, status: "blocked" }); failed.add(id); } else { aliases.set(id, upstream); result.suppressedFeatureIds.push(id); context.rebuildRuntime.features.set(id, { featureId: id, status: "suppressed" }); } continue; }
    context.rebuildRuntime.features.set(id, { featureId: id, status: "rebuilding" }); const featureStarted = now();
    const evaluated = await evaluateFeature(id, { document: context.document, kernel: context.kernel, tolerance: context.tolerance, buildProfiles: context.buildProfiles, assets: context.assets, runtime: stagedRuntime(context.runtime, staged, aliases) }); results.set(id, evaluated);
    if (evaluated.status === "failed") { failed.add(id); result.failedFeatureIds.push(id); result.errors.push({ featureId: id, code: evaluated.error.code, message: evaluated.error.message }); context.rebuildRuntime.features.set(id, { featureId: id, status: "failed", error: evaluated.error, lastDurationMs: now() - featureStarted }); continue; }
    staged.set(id, evaluated.shape); result.evaluatedFeatureIds.push(id); context.rebuildRuntime.features.set(id, { featureId: id, status: "clean", lastDurationMs: now() - featureStarted });
    processedFeatureCount += 1;
    // OCCT runs on the browser main thread. Yield between small batches so
    // toolbars, cancellation and status feedback remain responsive while a
    // large imported/resource document is rebuilt.
    if (processedFeatureCount % 4 === 0) await yieldToBrowser();
  }
  if (failed.size) { await rollback(context.kernel, staged); context.rebuildRuntime.documentStatus = "last-good"; result.durationMs = now() - started; return result; }
  try { await commitRebuildBatch(context.runtime, context.kernel, staged, aliases, results); deriveRuntimeBodies(context.document, context.runtime); result.success = true; context.rebuildRuntime.documentStatus = "current"; context.rebuildRuntime.lastSuccessfulDocumentFingerprint = context.rebuildRuntime.currentDocumentFingerprint; } catch (error) { await rollback(context.kernel, staged); context.rebuildRuntime.documentStatus = "last-good"; result.errors.push({ featureId: "commit", code: "REBUILD_COMMIT_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  result.durationMs = now() - started; return result;
};
