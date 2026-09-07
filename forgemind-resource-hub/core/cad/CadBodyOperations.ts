import type { CadDocument } from "./CadDocument.ts";
import { createCadBody, bodyFeatureIds } from "./CadBodies.ts";
import type { UUID } from "./CadTypes.ts";
import type { Feature } from "../features/Feature.ts";

export class CadBodyOperationError extends Error {
  readonly code: "BODY_EXISTS" | "BODY_MISSING" | "BODY_IN_USE";
  constructor(code: "BODY_EXISTS" | "BODY_MISSING" | "BODY_IN_USE", message: string) { super(message); this.code = code; }
}

const stamped = <TSketch>(document: CadDocument<TSketch, Feature>, patch: Partial<CadDocument<TSketch, Feature>>): CadDocument<TSketch, Feature> => ({ ...document, ...patch, updatedAt: Date.now() });

export const createBody = <TSketch>(document: CadDocument<TSketch, Feature>, id: UUID, name = id): CadDocument<TSketch, Feature> => {
  if (document.bodies[id]) throw new CadBodyOperationError("BODY_EXISTS", `Body ${id} already exists.`);
  return stamped(document, { bodies: { ...document.bodies, [id]: createCadBody(id, name) }, activeBodyId: id });
};

export const renameBody = <TSketch>(document: CadDocument<TSketch, Feature>, bodyId: UUID, name: string): CadDocument<TSketch, Feature> => {
  if (!document.bodies[bodyId]) throw new CadBodyOperationError("BODY_MISSING", `Body ${bodyId} was not found.`);
  return stamped(document, { bodies: { ...document.bodies, [bodyId]: { ...document.bodies[bodyId], name } } });
};

export const setActiveBody = <TSketch>(document: CadDocument<TSketch, Feature>, bodyId: UUID | undefined): CadDocument<TSketch, Feature> => {
  if (bodyId !== undefined && !document.bodies[bodyId]) throw new CadBodyOperationError("BODY_MISSING", `Body ${bodyId} was not found.`);
  return stamped(document, { activeBodyId: bodyId });
};

export const setBodyVisibility = <TSketch>(document: CadDocument<TSketch, Feature>, bodyId: UUID, visible: boolean): CadDocument<TSketch, Feature> => {
  if (!document.bodies[bodyId]) throw new CadBodyOperationError("BODY_MISSING", `Body ${bodyId} was not found.`);
  return stamped(document, { bodies: { ...document.bodies, [bodyId]: { ...document.bodies[bodyId], visible } } });
};

export const deleteBody = <TSketch>(document: CadDocument<TSketch, Feature>, bodyId: UUID): CadDocument<TSketch, Feature> => {
  if (!document.bodies[bodyId]) throw new CadBodyOperationError("BODY_MISSING", `Body ${bodyId} was not found.`);
  const owned = bodyFeatureIds(document as CadDocument<unknown, Feature>, bodyId);
  const referenced = Object.values(document.features).some((feature) => feature.type === "bodyBoolean" && (feature.target.bodyId === bodyId || feature.tools.some((tool) => tool.bodyId === bodyId)));
  if (owned.length || referenced) throw new CadBodyOperationError("BODY_IN_USE", `Body ${bodyId} still owns or is referenced by design features.`);
  const bodies = { ...document.bodies };
  delete bodies[bodyId];
  const nextActive = document.activeBodyId === bodyId ? Object.keys(bodies).sort()[0] : document.activeBodyId;
  return stamped(document, { bodies, activeBodyId: nextActive });
};
