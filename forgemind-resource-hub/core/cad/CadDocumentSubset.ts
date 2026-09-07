import { createCadDocument, type CadDocument } from "./CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export interface CadDocumentSubsetOptions {
  id: string;
  name: string;
  sourcePartIds: readonly string[];
}

/**
 * Builds a self-contained Part document from selected resource parts.
 *
 * A selected Body can depend on a Feature owned by another Body (for example,
 * a thickened solid depending on its hidden B-spline source surface). The
 * dependency closure is included as hidden support geometry so an assembly
 * definition can always be deserialized and rebuilt independently.
 */
export const extractCadDocumentPart = (
  source: CadDocument<Sketch, Feature>,
  options: CadDocumentSubsetOptions,
): CadDocument<Sketch, Feature> => {
  const requestedPartIds = new Set(options.sourcePartIds);
  const selectedBodyIds = new Set(
    Object.entries(source.bodies)
      .filter(([, body]) => requestedPartIds.has(body.sourceResource?.sourcePartId ?? ""))
      .map(([bodyId]) => bodyId),
  );

  const includedFeatureIds = new Set(
    source.featureOrder.filter((featureId) => selectedBodyIds.has(source.features[featureId]?.bodyId ?? "")),
  );
  const pending = [...includedFeatureIds];
  while (pending.length) {
    const feature = source.features[pending.pop() ?? ""];
    if (!feature) continue;
    for (const dependencyId of feature.dependencies ?? []) {
      if (!source.features[dependencyId] || includedFeatureIds.has(dependencyId)) continue;
      includedFeatureIds.add(dependencyId);
      pending.push(dependencyId);
    }
  }

  const featureOrder = source.featureOrder.filter((featureId) => includedFeatureIds.has(featureId));
  const features = Object.fromEntries(
    featureOrder.map((featureId) => [featureId, structuredClone(source.features[featureId])]),
  ) as Record<string, Feature>;
  const includedBodyIds = new Set(
    Object.values(features).map((feature) => feature.bodyId).filter((bodyId): bodyId is string => Boolean(bodyId)),
  );
  const bodies = Object.fromEntries(
    Object.entries(source.bodies)
      .filter(([bodyId]) => includedBodyIds.has(bodyId))
      .map(([bodyId, body]) => [
        bodyId,
        { ...structuredClone(body), visible: selectedBodyIds.has(bodyId) ? body.visible : false },
      ]),
  );
  const sketchIds = new Set(
    Object.values(features).flatMap((feature) =>
      "sketchId" in feature && typeof feature.sketchId === "string" ? [feature.sketchId] : [],
    ),
  );
  const sketches = Object.fromEntries(
    [...sketchIds]
      .filter((sketchId) => source.sketches[sketchId])
      .map((sketchId) => [sketchId, structuredClone(source.sketches[sketchId])]),
  ) as Record<string, Sketch>;

  return createCadDocument<Sketch, Feature>({
    id: options.id,
    name: options.name,
    unit: source.unit,
    sketches,
    features,
    featureOrder,
    bodies,
    activeBodyId: [...selectedBodyIds].find((bodyId) => includedBodyIds.has(bodyId)),
  });
};
