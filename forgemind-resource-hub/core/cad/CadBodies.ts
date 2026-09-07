import type { CadDocument } from "./CadDocument.ts";
import type { CadBody, UUID } from "./CadTypes.ts";
import type { Feature } from "../features/Feature.ts";

export const DEFAULT_LEGACY_BODY_ID = "Body01";

// Legacy source contract: bodyType: "solid" | "surface" = "solid".
export const createCadBody = (id: UUID, name = id, bodyType: "solid" | "surface" | "curve" = "solid"): CadBody => ({
  id, name, backend: "brep", bodyType, visible: true,
});

/** A feature owns a Body once multi-body authoring begins. Legacy documents
 * intentionally fall back to their deterministic migrated Body01. */
export const featureBodyId = (feature: Feature, fallback?: UUID): UUID | undefined =>
  feature.bodyId ?? (feature.type === "extrude" ? feature.targetBodyId : undefined) ?? fallback;

export const bodyFeatureIds = (document: CadDocument<unknown, Feature>, bodyId: UUID): UUID[] =>
  document.featureOrder.filter((id) => {
    const feature = document.features[id];
    return !!feature && featureBodyId(feature, document.activeBodyId) === bodyId;
  });

export const deriveBodyTipFeatureId = (document: CadDocument<unknown, Feature>, bodyId: UUID): UUID | undefined => {
  const ids = bodyFeatureIds(document, bodyId);
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const feature = document.features[ids[index]];
    if (feature && feature.enabled && feature.state !== "suppressed") return feature.id;
  }
  return undefined;
};

export const withDerivedBodyTips = <TSketch>(document: CadDocument<TSketch, Feature>): CadDocument<TSketch, Feature> => ({
  ...document,
  bodies: Object.fromEntries(Object.entries(document.bodies).map(([id, body]) => [id, {
    ...body,
    tipFeatureId: deriveBodyTipFeatureId(document as CadDocument<unknown, Feature>, id),
  }])),
});
