import type { UUID } from "../cad/CadTypes.ts";
import { cloneRigidTransform, validateRigidTransform } from "./RigidTransform.ts";
import type { AssemblyDocument, AssemblyMate, ComponentInstance, RigidTransform } from "./AssemblyTypes.ts";

export class AssemblyOperationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "AssemblyOperationError"; this.code = code; }
}

const touch = (document: AssemblyDocument): AssemblyDocument => ({ ...document, updatedAt: Date.now() });
const requireComponent = (document: AssemblyDocument, componentId: UUID): ComponentInstance => {
  const component = document.components[componentId];
  if (!component) throw new AssemblyOperationError("ASSEMBLY_COMPONENT_MISSING", `Component ${componentId} does not exist.`);
  return component;
};
const requireMate = (document: AssemblyDocument, mateId: UUID): AssemblyMate => {
  const mate = document.mates[mateId];
  if (!mate) throw new AssemblyOperationError("ASSEMBLY_MATE_MISSING", `Mate ${mateId} does not exist.`);
  return mate;
};

export const insertComponent = (document: AssemblyDocument, component: ComponentInstance): AssemblyDocument => {
  if (document.components[component.id]) throw new AssemblyOperationError("ASSEMBLY_COMPONENT_DUPLICATE", `Component ${component.id} already exists.`);
  const normalized = { ...component, nominalPlacement: validateRigidTransform(component.nominalPlacement) };
  return touch({ ...document, components: { ...document.components, [component.id]: normalized }, componentOrder: [...document.componentOrder, component.id] });
};

export const removeComponent = (document: AssemblyDocument, componentId: UUID): AssemblyDocument => {
  requireComponent(document, componentId);
  if (Object.values(document.mates).some((mate) => mate.type === "fixed" ? mate.componentId === componentId : mate.a.instanceId === componentId || mate.b.instanceId === componentId)) {
    throw new AssemblyOperationError("COMPONENT_IN_USE_BY_MATE", `Component ${componentId} is referenced by an Assembly Mate.`);
  }
  const components = { ...document.components }; delete components[componentId];
  return touch({ ...document, components, componentOrder: document.componentOrder.filter((id) => id !== componentId) });
};

export const renameComponent = (document: AssemblyDocument, componentId: UUID, name: string): AssemblyDocument => {
  const component = requireComponent(document, componentId); const trimmed = name.trim();
  if (!trimmed) throw new AssemblyOperationError("ASSEMBLY_COMPONENT_NAME_EMPTY", "Component name cannot be empty.");
  return touch({ ...document, components: { ...document.components, [componentId]: { ...component, name: trimmed } } });
};

export const setComponentGrounded = (document: AssemblyDocument, componentId: UUID, grounded: boolean): AssemblyDocument => {
  const component = requireComponent(document, componentId);
  return touch({ ...document, components: { ...document.components, [componentId]: { ...component, grounded } } });
};

export const setComponentVisibility = (document: AssemblyDocument, componentId: UUID, visible: boolean): AssemblyDocument => {
  const component = requireComponent(document, componentId);
  return touch({ ...document, components: { ...document.components, [componentId]: { ...component, visible } } });
};

export const updateComponentNominalPlacement = (document: AssemblyDocument, componentId: UUID, placement: RigidTransform): AssemblyDocument => {
  const component = requireComponent(document, componentId);
  return touch({ ...document, components: { ...document.components, [componentId]: { ...component, nominalPlacement: validateRigidTransform(placement) } } });
};

/** Retargets one instance to a new immutable PartDefinition revision. */
export const updateComponentDefinitionId = (document: AssemblyDocument, componentId: UUID, definitionId: UUID): AssemblyDocument => {
  const component=requireComponent(document,componentId);
  if(!definitionId.trim()) throw new AssemblyOperationError("ASSEMBLY_DEFINITION_ID_EMPTY","Part definition id cannot be empty.");
  return touch({...document,components:{...document.components,[componentId]:{...component,definitionId}}});
};

/** Creates an independent instance while retaining the immutable Part definition. */
export const duplicateComponent = (document: AssemblyDocument, sourceId: UUID, newId: UUID, name?: string): AssemblyDocument => {
  const source = requireComponent(document, sourceId);
  const offset = 40 + document.componentOrder.length * 5;
  return insertComponent(document, { ...cloneComponent(source), id: newId, name: name?.trim() || `${source.name} 副本`, grounded: false, nominalPlacement: { ...cloneRigidTransform(source.nominalPlacement), translationMm: { ...source.nominalPlacement.translationMm, x: source.nominalPlacement.translationMm.x + offset } } });
};

/** Deletes an instance and every Mate that references it as one undoable design edit. */
export const removeComponentCascade = (document: AssemblyDocument, componentId: UUID): AssemblyDocument => {
  requireComponent(document, componentId);
  const mateIds = document.mateOrder.filter((id) => mateReferences(document.mates[id]).includes(componentId));
  const mates = { ...document.mates }; for (const id of mateIds) delete mates[id];
  const components = { ...document.components }; delete components[componentId];
  return touch({ ...document, components, componentOrder: document.componentOrder.filter((id) => id !== componentId), mates, mateOrder: document.mateOrder.filter((id) => !mateIds.includes(id)) });
};

/** Isolates one component, or restores all components, without touching Mate definitions. */
export const setComponentIsolation = (document: AssemblyDocument, componentId?: UUID): AssemblyDocument => {
  if (componentId) requireComponent(document, componentId);
  const components = Object.fromEntries(document.componentOrder.map((id) => [id, { ...document.components[id], visible: componentId ? id === componentId : true }]));
  return touch({ ...document, components });
};

const mateReferences = (mate: AssemblyMate): UUID[] => mate.type === "fixed" ? [mate.componentId] : [mate.a.instanceId, mate.b.instanceId];
const validateMate = (document: AssemblyDocument, mate: AssemblyMate): AssemblyMate => {
  for (const componentId of mateReferences(mate)) requireComponent(document, componentId);
  if (mate.type !== "fixed" && mate.a.instanceId === mate.b.instanceId) throw new AssemblyOperationError("MATE_SAME_COMPONENT_UNSUPPORTED", "Assembly Mate references must belong to different Components.");
  if (mate.type === "distance" && !Number.isFinite(mate.distanceMm)) throw new AssemblyOperationError("MATE_DISTANCE_INVALID", "Distance Mate value must be finite.");
  if (mate.type === "angle" && (!Number.isFinite(mate.angleDeg) || mate.angleDeg < 0 || mate.angleDeg > 180)) throw new AssemblyOperationError("MATE_ANGLE_INVALID", "Angle Mate must be within 0..180 degrees.");
  if(mate.type === "revolute"){const l=mate.angleLimit;if(![l.min,l.max].every(Number.isFinite)||l.min>l.max)throw new AssemblyOperationError("MATE_LIMIT_INVALID","Revolute limit requires finite min <= max degrees.");}
  if(mate.type === "slider"){const l=mate.distanceLimit;if(![l.min,l.max].every(Number.isFinite)||l.min>l.max)throw new AssemblyOperationError("MATE_LIMIT_INVALID","Slider limit requires finite min <= max mm.");}
  return mate.type === "fixed" ? { ...mate, lockedPlacement: validateRigidTransform(mate.lockedPlacement) } : mate;
};

export const addMate = (document: AssemblyDocument, mate: AssemblyMate): AssemblyDocument => {
  if (document.mates[mate.id]) throw new AssemblyOperationError("ASSEMBLY_MATE_DUPLICATE", `Mate ${mate.id} already exists.`);
  const validated = validateMate(document, mate);
  return touch({ ...document, mates: { ...document.mates, [mate.id]: validated }, mateOrder: [...document.mateOrder, mate.id] });
};

export const updateMate = (document: AssemblyDocument, mate: AssemblyMate): AssemblyDocument => {
  requireMate(document, mate.id); const validated = validateMate(document, mate);
  return touch({ ...document, mates: { ...document.mates, [mate.id]: validated } });
};

export const setMateEnabled = (document: AssemblyDocument, mateId: UUID, enabled: boolean): AssemblyDocument => {
  const mate = requireMate(document, mateId);
  return touch({ ...document, mates: { ...document.mates, [mateId]: { ...mate, enabled } as AssemblyMate } });
};

export const removeMate = (document: AssemblyDocument, mateId: UUID): AssemblyDocument => {
  requireMate(document, mateId); const mates = { ...document.mates }; delete mates[mateId];
  return touch({ ...document, mates, mateOrder: document.mateOrder.filter((id) => id !== mateId) });
};

export const cloneComponent = (component: ComponentInstance): ComponentInstance => ({ ...component, nominalPlacement: cloneRigidTransform(component.nominalPlacement) });
