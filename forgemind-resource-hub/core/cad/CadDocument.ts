import type { CadBody, LengthUnit, SerializableCadBody, UUID } from "./CadTypes.ts";
import { CAD_INTERNAL_LENGTH_UNIT } from "./Units.ts";

export const CAD_DOCUMENT_SCHEMA_VERSION = 2 as const;

/**
 * The document is intentionally generic in Milestone 1. Existing ForgeMind
 * sketch and feature shapes remain the authoritative legacy data until their
 * domain models are introduced in later milestones.
 */
export interface CadDocument<TSketch = unknown, TFeature = unknown> {
  schemaVersion: typeof CAD_DOCUMENT_SCHEMA_VERSION;
  id: UUID;
  name: string;
  unit: LengthUnit;
  sketches: Record<UUID, TSketch>;
  features: Record<UUID, TFeature>;
  featureOrder: UUID[];
  bodies: Record<UUID, CadBody>;
  activeBodyId?: UUID;
  updatedAt: number;
}

export interface CreateCadDocumentOptions<TSketch = unknown, TFeature = unknown> {
  id: UUID;
  name: string;
  unit?: LengthUnit;
  sketches?: Record<UUID, TSketch>;
  features?: Record<UUID, TFeature>;
  featureOrder?: UUID[];
  bodies?: Record<UUID, CadBody>;
  activeBodyId?: UUID;
  updatedAt?: number;
}

export type SerializableCadDocument<TSketch = unknown, TFeature = unknown> = Omit<
  CadDocument<TSketch, TFeature>,
  "bodies"
> & {
  bodies: Record<UUID, SerializableCadBody>;
};

export const createCadDocument = <TSketch = unknown, TFeature = unknown>(
  options: CreateCadDocumentOptions<TSketch, TFeature>,
): CadDocument<TSketch, TFeature> => ({
  schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
  id: options.id,
  name: options.name,
  unit: options.unit ?? CAD_INTERNAL_LENGTH_UNIT,
  sketches: options.sketches ?? {},
  features: options.features ?? {},
  featureOrder: options.featureOrder ?? [],
  bodies: options.bodies ?? {},
  activeBodyId: options.activeBodyId,
  updatedAt: options.updatedAt ?? Date.now(),
});

/**
 * This is the only serializer supplied by the new domain layer at this stage.
 * It keeps runtime kernel references out of persisted project data by design.
 */
export const toSerializableCadDocument = <TSketch = unknown, TFeature = unknown>(
  document: CadDocument<TSketch, TFeature>,
): SerializableCadDocument<TSketch, TFeature> => ({
  ...document,
  // `state` is an evaluation/runtime hint on the current Feature model.  The
  // persisted design intent is `enabled`; retain an explicit suppression only
  // for backwards-compatible documents that use it as a design flag.
  features: Object.fromEntries(
    Object.entries(document.features).map(([id, feature]) => {
      if (!feature || typeof feature !== "object" || !("state" in feature)) return [id, feature];
      const { state, ...serializableFeature } = feature as TFeature & { state?: unknown };
      return [id, state === "suppressed" ? { ...serializableFeature, state } : serializableFeature];
    }),
  ) as Record<UUID, TFeature>,
  bodies: Object.fromEntries(
    Object.entries(document.bodies).map(([id, body]) => {
      // Whitelist the design contract instead of stripping known runtime keys:
      // this prevents future runtime caches/handles from leaking through a
      // shallow clone into persistence or CadHistory snapshots.
      const serializableBody: SerializableCadBody = {
        id: body.id,
        name: body.name,
        backend: body.backend,
        ...(body.bodyType ? { bodyType: body.bodyType } : {}),
        visible: body.visible,
        ...(body.appearance ? { appearance: { ...body.appearance } } : {}),
        ...(body.engineering ? { engineering: { ...body.engineering } } : {}),
        ...(body.sourceResource ? { sourceResource: { ...body.sourceResource } } : {}),
        ...(body.tipFeatureId ? { tipFeatureId: body.tipFeatureId } : {}),
      };
      return [id, serializableBody];
    }),
  ),
});
