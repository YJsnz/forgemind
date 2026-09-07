import type { UUID } from "../cad/CadTypes.ts";
import type { FeatureGraph } from "./FeatureGraph.ts";
import type { RebuildRequest } from "./RebuildTypes.ts";
export const computeDirtyFeatures = (graph: FeatureGraph, request: RebuildRequest): Set<UUID> => { const dirty = new Set<UUID>(request.changedFeatureIds ?? []); for (const sketch of request.changedSketchIds ?? []) for (const feature of graph.sketchConsumers.get(sketch) ?? []) dirty.add(feature); const queue = [...dirty]; while (queue.length) for (const next of graph.dependents.get(queue.shift()!) ?? []) if (!dirty.has(next)) { dirty.add(next); queue.push(next); } return dirty; };
