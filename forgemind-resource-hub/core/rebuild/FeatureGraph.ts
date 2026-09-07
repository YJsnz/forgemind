import type { UUID } from "../cad/CadTypes.ts";
import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import { bsplineSurfaceBoundaryMatches } from "../features/BSplineSurfaceFeature.ts";

export class FeatureGraphError extends Error { readonly code: "FEATURE_DEPENDENCY_MISSING" | "FEATURE_DEPENDENCY_MISMATCH" | "FEATURE_DEPENDENCY_CYCLE"; constructor(code: "FEATURE_DEPENDENCY_MISSING" | "FEATURE_DEPENDENCY_MISMATCH" | "FEATURE_DEPENDENCY_CYCLE", message: string) { super(message); this.name = "FeatureGraphError"; this.code = code; } }
export interface FeatureGraph { dependencies: Map<UUID, Set<UUID>>; dependents: Map<UUID, Set<UUID>>; sketchConsumers: Map<UUID, Set<UUID>>; order: UUID[]; }

export const collectFeatureDependencies = (feature: Feature): UUID[] => {
  const semantic = (() => {
    if (feature.type === "extrude") return feature.operation === "new" ? [] : feature.targetFeatureId ? [feature.targetFeatureId] : [];
    if (feature.type === "pocket") return feature.targetFeatureId ? [feature.targetFeatureId] : [];
    if (feature.type === "hole") return [feature.targetFeatureId, feature.targetFace.sourceFeatureId];
    if (feature.type === "fillet" || feature.type === "chamfer") return [feature.targetFeatureId, ...feature.edges.map((edge) => edge.sourceFeatureId)];
    if (feature.type === "shell") return [feature.targetFeatureId, ...feature.removeFaces.map((face) => face.sourceFeatureId)];
    if (feature.type === "draft") return [feature.targetFeatureId, ...feature.faces.map((face) => face.sourceFeatureId)];
    if (feature.type === "removeHole") return [feature.targetFeatureId, feature.cylindricalFace.sourceFeatureId];
    if (feature.type === "offsetBody") return [feature.targetFeatureId];
    if (feature.type === "planarPushPull") return [feature.targetFeatureId, feature.planarFace.sourceFeatureId];
    if (feature.type === "deleteFace") return [feature.targetFeatureId, ...feature.faces.map((face) => face.sourceFeatureId)];
    if (feature.type === "healHolePattern") return [feature.targetFeatureId, ...feature.cylindricalFaces.map((face) => face.sourceFeatureId)];
    if (feature.type === "rib") return [feature.targetFeatureId];
    if (feature.type === "bodyTransform") return [feature.inputFeatureId];
    if (feature.type === "bodyBoolean") return [feature.target.featureId, ...feature.tools.map((tool) => tool.featureId)];
    if (feature.type === "linearPattern" || feature.type === "circularPattern" || feature.type === "mirror") return [feature.targetFeatureId, ...feature.seedFeatureIds];
    if (feature.type === "pattern") return feature.sourceFeatureIds;
    if (feature.type === "extractSurface") return [feature.targetFeatureId, ...feature.faces.map((face) => face.sourceFeatureId)];
    if (feature.type === "offsetSurface" || feature.type === "thickenSurface") return [feature.targetFeatureId];
    if (feature.type === "sewSurface" || feature.type === "encloseSurface") return feature.sourceFeatureIds;
    if (feature.type === "fillSurface" || feature.type === "boundarySurface") return [...new Set(feature.boundaryEdges.map((edge) => edge.sourceFeatureId))];
    if (feature.type === "trimSurface" || feature.type === "splitSurface") return [feature.targetFeatureId, feature.toolFeatureId];
    if (feature.type === "surfaceIntersection") return feature.sourceFeatureIds;
    if (feature.type === "replaceFace") return [feature.targetFeatureId, feature.targetFace.sourceFeatureId, feature.replacementFeatureId];
    if (feature.type === "bsplineSurface") return bsplineSurfaceBoundaryMatches(feature).map((match) => match.sourceFeatureId);
    return [];
  })();
  const unique = [...new Set(semantic)];
  if (unique.length > 1 && ["hole", "fillet", "chamfer", "shell", "draft", "removeHole", "planarPushPull", "deleteFace", "healHolePattern", "extractSurface"].includes(feature.type)) throw new FeatureGraphError("FEATURE_DEPENDENCY_MISMATCH", `${feature.id} topology references must belong to target Feature ${feature.type === "hole" || feature.type === "fillet" || feature.type === "chamfer" || feature.type === "shell" || feature.type === "draft" || feature.type === "removeHole" || feature.type === "planarPushPull" || feature.type === "deleteFace" || feature.type === "healHolePattern" || feature.type === "extractSurface" ? feature.targetFeatureId : ""}.`);
  const explicit = [...new Set(feature.dependencies)];
  if (unique.some((id) => !explicit.includes(id)) || explicit.some((id) => !unique.includes(id))) throw new FeatureGraphError("FEATURE_DEPENDENCY_MISMATCH", `${feature.id}.dependencies must exactly match its semantic Feature references.`);
  return unique;
};

export const buildFeatureGraph = (document: CadDocument<unknown, Feature>): FeatureGraph => {
  const ids = Object.keys(document.features); const rank = new Map(document.featureOrder.map((id, index) => [id, index])); const dependencies = new Map<UUID, Set<UUID>>(); const dependents = new Map<UUID, Set<UUID>>(); const sketchConsumers = new Map<UUID, Set<UUID>>();
  for (const id of ids) { dependencies.set(id, new Set()); dependents.set(id, new Set()); }
  for (const feature of Object.values(document.features)) {
    const needed = collectFeatureDependencies(feature); for (const dependency of needed) { if (!document.features[dependency]) throw new FeatureGraphError("FEATURE_DEPENDENCY_MISSING", `${feature.id} depends on missing Feature ${dependency}.`); if (feature.type === "bodyBoolean" && (rank.get(dependency) ?? Infinity) >= (rank.get(feature.id) ?? Infinity)) throw new FeatureGraphError("FEATURE_DEPENDENCY_CYCLE", `${feature.id} cannot reference a future Body state ${dependency}.`); dependencies.get(feature.id)!.add(dependency); dependents.get(dependency)!.add(feature.id); }
    const sketchIds = feature.type === "surfaceSweep" ? [feature.profileSketchId, feature.pathSketchId, ...(feature.guideSketchId ? [feature.guideSketchId] : [])] : feature.type === "sweep" ? [feature.profileSketchId, feature.pathSketchId] : feature.type === "loft" || feature.type === "surfaceLoft" ? feature.sectionSketchIds : ["extrude", "revolve", "pocket", "rib", "surfacePatch", "surfaceExtrude", "surfaceRevolve"].includes(feature.type) ? [(feature as { sketchId: UUID }).sketchId] : [];
    for (const sketchId of sketchIds) { const consumers = sketchConsumers.get(sketchId) ?? new Set(); consumers.add(feature.id); sketchConsumers.set(sketchId, consumers); }
  }
  const indegree = new Map(ids.map((id) => [id, dependencies.get(id)!.size])); const pending = ids.filter((id) => !indegree.get(id)).sort((a,b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b)); const order: UUID[] = [];
  while (pending.length) { const id = pending.shift()!; order.push(id); for (const dependent of dependents.get(id)!) { indegree.set(dependent, indegree.get(dependent)! - 1); if (indegree.get(dependent) === 0) { pending.push(dependent); pending.sort((a,b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b)); } } }
  if (order.length !== ids.length) { const cycle = ids.filter((id) => !order.includes(id)); throw new FeatureGraphError("FEATURE_DEPENDENCY_CYCLE", `Feature dependency cycle: ${cycle.join(" → ")}.`); }
  return { dependencies, dependents, sketchConsumers, order };
};
