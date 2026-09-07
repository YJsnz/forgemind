import { createCadDocument, type CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

const collisions = (left: Record<string, unknown>, right: Record<string, unknown>): string[] =>
  Object.keys(right).filter((id) => Object.prototype.hasOwnProperty.call(left, id));

/**
 * Merges independent CAD documents that already carry globally unique design ids.
 * Runtime kernel state is intentionally absent; the combined document must be
 * rebuilt by the normal Feature Graph after handoff.
 */
export const mergeCadDocuments = (
  base: CadDocument<Sketch, Feature>,
  incoming: CadDocument<Sketch, Feature>,
): CadDocument<Sketch, Feature> => {
  const duplicateSketches = collisions(base.sketches, incoming.sketches);
  const duplicateFeatures = collisions(base.features, incoming.features);
  const duplicateBodies = collisions(base.bodies, incoming.bodies);
  const duplicates = [...duplicateSketches, ...duplicateFeatures, ...duplicateBodies];
  if (duplicates.length) throw new Error(`CAD document id collision: ${duplicates.slice(0, 8).join(", ")}`);
  return {
    ...base,
    sketches: { ...base.sketches, ...incoming.sketches },
    features: { ...base.features, ...incoming.features },
    featureOrder: [...base.featureOrder, ...incoming.featureOrder],
    bodies: { ...base.bodies, ...incoming.bodies },
    activeBodyId: incoming.activeBodyId ?? base.activeBodyId,
    updatedAt: Date.now(),
  };
};

export const createUnifiedCadDocument = (name = "未命名自由建模项目", id = `cad-${Date.now()}`): CadDocument<Sketch, Feature> =>
  createCadDocument<Sketch, Feature>({ id, name });
