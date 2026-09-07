import type { CadDocument } from "../cad/CadDocument.ts";
import type { UUID } from "../cad/CadTypes.ts";
import type { Feature } from "../features/Feature.ts";
import { buildFeatureGraph, type FeatureGraph } from "../rebuild/FeatureGraph.ts";

export type FeatureHistoryManagementErrorCode =
  | "FEATURE_NOT_FOUND"
  | "FEATURE_NAME_EMPTY"
  | "FEATURE_ORDER_INVALID"
  | "FEATURE_REORDER_BLOCKED";

export class FeatureHistoryManagementError extends Error {
  readonly code: FeatureHistoryManagementErrorCode;

  constructor(code: FeatureHistoryManagementErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "FeatureHistoryManagementError";
  }
}

export interface FeatureHistoryRelations {
  dependencies: UUID[];
  dependents: UUID[];
  upstream: UUID[];
  downstream: UUID[];
}

export interface FeatureHistoryMutation<TSketch> {
  document: CadDocument<TSketch, Feature>;
  affectedFeatureIds: UUID[];
}

export interface FeatureHistoryDeletion<TSketch> {
  document: CadDocument<TSketch, Feature>;
  deletedFeatureIds: UUID[];
}

const cloneDocument = <TSketch>(document: CadDocument<TSketch, Feature>): CadDocument<TSketch, Feature> => structuredClone(document);

const touchDocument = <TSketch>(document: CadDocument<TSketch, Feature>): CadDocument<TSketch, Feature> => ({
  ...document,
  updatedAt: Date.now(),
});

const requireFeature = (document: CadDocument<unknown, Feature>, featureId: UUID): Feature => {
  const feature = document.features[featureId];
  if (!feature) throw new FeatureHistoryManagementError("FEATURE_NOT_FOUND", `特征 ${featureId} 不存在。`);
  return feature;
};

const orderedIds = (document: CadDocument<unknown, Feature>, ids: Iterable<UUID>): UUID[] => {
  const requested = new Set(ids);
  return document.featureOrder.filter((id) => requested.has(id));
};

const transitiveClosure = (start: UUID, links: ReadonlyMap<UUID, ReadonlySet<UUID>>): Set<UUID> => {
  const visited = new Set<UUID>();
  const pending = [...(links.get(start) ?? [])];
  while (pending.length) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(links.get(id) ?? []));
  }
  return visited;
};

const graphFor = <TSketch>(document: CadDocument<TSketch, Feature>): FeatureGraph =>
  buildFeatureGraph(document as CadDocument<unknown, Feature>);

const assertCompleteFeatureOrder = <TSketch>(document: CadDocument<TSketch, Feature>): void => {
  const featureIds = Object.keys(document.features);
  const ordered = new Set(document.featureOrder);
  if (ordered.size !== document.featureOrder.length || featureIds.length !== ordered.size || featureIds.some((id) => !ordered.has(id))) {
    throw new FeatureHistoryManagementError("FEATURE_ORDER_INVALID", "特征顺序与当前模型内容不一致，不能调整顺序。");
  }
};

const assertDependencyOrder = <TSketch>(document: CadDocument<TSketch, Feature>): void => {
  const graph = graphFor(document);
  const rank = new Map(document.featureOrder.map((id, index) => [id, index]));
  for (const [featureId, dependencies] of graph.dependencies) {
    for (const dependencyId of dependencies) {
      if ((rank.get(dependencyId) ?? -1) >= (rank.get(featureId) ?? -1)) {
        throw new FeatureHistoryManagementError("FEATURE_REORDER_BLOCKED", "不能把特征移动到它所依赖的内容之前。");
      }
    }
  }
};

export const featureHistoryRelations = (
  document: CadDocument<unknown, Feature>,
  featureId: UUID,
): FeatureHistoryRelations => {
  requireFeature(document, featureId);
  const graph = graphFor(document);
  return {
    dependencies: orderedIds(document, graph.dependencies.get(featureId) ?? []),
    dependents: orderedIds(document, graph.dependents.get(featureId) ?? []),
    upstream: orderedIds(document, transitiveClosure(featureId, graph.dependencies)),
    downstream: orderedIds(document, transitiveClosure(featureId, graph.dependents)),
  };
};

export const renameHistoryFeature = <TSketch>(
  document: CadDocument<TSketch, Feature>,
  featureId: UUID,
  name: string,
): CadDocument<TSketch, Feature> => {
  const feature = requireFeature(document as CadDocument<unknown, Feature>, featureId);
  const trimmedName = name.trim();
  if (!trimmedName) throw new FeatureHistoryManagementError("FEATURE_NAME_EMPTY", "特征名称不能为空。");
  if (trimmedName === feature.name) return document;
  const next = cloneDocument(document);
  next.features[featureId].name = trimmedName;
  return touchDocument(next);
};

/** Suppression disables the selected node and every consumer. Restoration only enables required inputs. */
export const setHistoryFeatureSuppressed = <TSketch>(
  document: CadDocument<TSketch, Feature>,
  featureId: UUID,
  suppressed: boolean,
): FeatureHistoryMutation<TSketch> => {
  requireFeature(document as CadDocument<unknown, Feature>, featureId);
  const relations = featureHistoryRelations(document as CadDocument<unknown, Feature>, featureId);
  const targets = suppressed ? [featureId, ...relations.downstream] : [...relations.upstream, featureId];
  const next = cloneDocument(document);
  const affectedFeatureIds: UUID[] = [];

  for (const id of targets) {
    const feature = next.features[id];
    const needsChange = suppressed
      ? feature.enabled || feature.state !== "suppressed"
      : !feature.enabled || feature.state === "suppressed";
    if (!needsChange) continue;
    feature.enabled = !suppressed;
    feature.state = suppressed ? "suppressed" : "clean";
    affectedFeatureIds.push(id);
  }

  return {
    document: affectedFeatureIds.length ? touchDocument(next) : document,
    affectedFeatureIds,
  };
};

/** Creates an inspectable earlier model state by suppressing every node after the selected history position. */
export const rollbackHistoryToFeature = <TSketch>(
  document: CadDocument<TSketch, Feature>,
  featureId: UUID,
): FeatureHistoryMutation<TSketch> => {
  requireFeature(document as CadDocument<unknown, Feature>, featureId);
  const index = document.featureOrder.indexOf(featureId);
  if (index < 0) throw new FeatureHistoryManagementError("FEATURE_ORDER_INVALID", "所选特征不在当前历史顺序中。");
  const next = cloneDocument(document);
  const affectedFeatureIds: UUID[] = [];

  for (const id of document.featureOrder.slice(index + 1)) {
    const feature = next.features[id];
    if (!feature.enabled && feature.state === "suppressed") continue;
    feature.enabled = false;
    feature.state = "suppressed";
    affectedFeatureIds.push(id);
  }

  return {
    document: affectedFeatureIds.length ? touchDocument(next) : document,
    affectedFeatureIds,
  };
};

/** Deletes the selected node and every consumer, then repairs Body tip pointers to the latest surviving node. */
export const deleteHistoryFeatureCascade = <TSketch>(
  document: CadDocument<TSketch, Feature>,
  featureId: UUID,
): FeatureHistoryDeletion<TSketch> => {
  requireFeature(document as CadDocument<unknown, Feature>, featureId);
  const relations = featureHistoryRelations(document as CadDocument<unknown, Feature>, featureId);
  const deletedFeatureIds = [featureId, ...relations.downstream];
  const deleted = new Set(deletedFeatureIds);
  const next = cloneDocument(document);

  for (const id of deletedFeatureIds) delete next.features[id];
  next.featureOrder = next.featureOrder.filter((id) => !deleted.has(id));

  for (const body of Object.values(next.bodies)) {
    if (!body.tipFeatureId || !deleted.has(body.tipFeatureId)) continue;
    const replacement = [...next.featureOrder].reverse().find((id) => (next.features[id] as Feature & { bodyId?: UUID }).bodyId === body.id);
    if (replacement) body.tipFeatureId = replacement;
    else delete body.tipFeatureId;
  }

  return { document: touchDocument(next), deletedFeatureIds };
};

export const moveHistoryFeature = <TSketch>(
  document: CadDocument<TSketch, Feature>,
  featureId: UUID,
  direction: "up" | "down",
): CadDocument<TSketch, Feature> => {
  requireFeature(document as CadDocument<unknown, Feature>, featureId);
  assertCompleteFeatureOrder(document);
  const index = document.featureOrder.indexOf(featureId);
  const targetIndex = index + (direction === "up" ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= document.featureOrder.length) return document;

  const next = cloneDocument(document);
  [next.featureOrder[index], next.featureOrder[targetIndex]] = [next.featureOrder[targetIndex], next.featureOrder[index]];
  assertDependencyOrder(next);
  return touchDocument(next);
};

export const canMoveHistoryFeature = <TSketch>(
  document: CadDocument<TSketch, Feature>,
  featureId: UUID,
  direction: "up" | "down",
): boolean => {
  try {
    return moveHistoryFeature(document, featureId, direction) !== document;
  } catch {
    return false;
  }
};
