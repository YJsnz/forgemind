import { createCadDocument, type CadDocument } from "./CadDocument.ts";
import type { CadBody, GeometryBackend, UUID } from "./CadTypes.ts";

/**
 * Minimum shape shared by current ParametricPart records and imported legacy
 * project JSON. The optional backend keeps old files valid without rewriting
 * ProjectSnapshot or introducing a second mutable project state.
 */
export interface LegacyPartLike {
  id: UUID;
  label: string;
  hidden?: boolean;
  backend?: GeometryBackend;
}

export interface LegacyProjectLike<TSketch = unknown, TFeature = unknown> {
  id: UUID;
  name: string;
  parts: readonly LegacyPartLike[];
  sketches?: Record<UUID, TSketch>;
  features?: Record<UUID, TFeature>;
  featureOrder?: UUID[];
  activePartId?: UUID;
  updatedAt?: number;
}

/** Old data has no backend marker, so it always remains legacy-mesh. */
export const legacyPartToCadBody = (part: LegacyPartLike): CadBody => ({
  id: part.id,
  name: part.label,
  backend: part.backend ?? "legacy-mesh",
  visible: !part.hidden,
});

/**
 * Creates a transient domain view for legacy data. It is deliberately not
 * connected to React state or ProjectSnapshot persistence in Milestone 1.
 */
export const adaptLegacyProjectToCadDocument = <TSketch = unknown, TFeature = unknown>(
  project: LegacyProjectLike<TSketch, TFeature>,
): CadDocument<TSketch, TFeature> => createCadDocument({
  id: project.id,
  name: project.name,
  sketches: project.sketches,
  features: project.features,
  featureOrder: project.featureOrder,
  bodies: Object.fromEntries(project.parts.map((part) => [part.id, legacyPartToCadBody(part)])),
  activeBodyId: project.activePartId,
  updatedAt: project.updatedAt,
});
