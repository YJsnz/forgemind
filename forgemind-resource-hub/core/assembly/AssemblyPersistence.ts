import type { PersistentTopologyRef } from "../topology/PersistentTopologyRef.ts";
import { migratePersistentTopologyRefV1ToV2 } from "../topology/PersistentTopologyRef.ts";
import {
  ASSEMBLY_DOCUMENT_SCHEMA_VERSION,
  type AssemblyDocument,
  type AssemblyMate,
  type ComponentInstance,
  type MateAlignment,
  type PartDefinition,
  type PartDefinitionStore,
  type Quaternion,
  type RigidTransform,
} from "./AssemblyTypes.ts";
import { createPartDefinitionStore } from "./PartDefinitions.ts";
import { validateRigidTransform } from "./RigidTransform.ts";

export const ASSEMBLY_PROJECT_BUNDLE_VERSION = 2 as const;
export interface AssemblyProjectBundle {
  version: typeof ASSEMBLY_PROJECT_BUNDLE_VERSION;
  assembly: SerializableAssemblyDocument;
  definitions: PartDefinition[];
}
export type SerializableAssemblyDocument = AssemblyDocument;

export class AssemblyDocumentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "AssemblyDocumentError"; this.code = code; }
}
const invalid = (message: string): never => { throw new AssemblyDocumentError("ASSEMBLY_DOCUMENT_INVALID", message); };
const record = (value: unknown, label: string): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid(`${label} must be an object.`);
const text = (value: unknown, label: string): string => typeof value === "string" && value.length > 0 ? value : invalid(`${label} must be a non-empty string.`);
const bool = (value: unknown, label: string): boolean => typeof value === "boolean" ? value : invalid(`${label} must be boolean.`);
const finite = (value: unknown, label: string): number => typeof value === "number" && Number.isFinite(value) ? value : invalid(`${label} must be finite.`);
const clone = <T>(value: T): T => structuredClone(value);
const stringArray = (value: unknown, label: string): string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : invalid(`${label} must contain string IDs.`);

const parseQuaternion = (value: unknown): Quaternion => {
  const q = record(value, "rotation");
  return { x: finite(q.x, "rotation.x"), y: finite(q.y, "rotation.y"), z: finite(q.z, "rotation.z"), w: finite(q.w, "rotation.w") };
};
const parseTransform = (value: unknown): RigidTransform => {
  const source = record(value, "placement"), translation = record(source.translationMm, "translationMm");
  return validateRigidTransform({ translationMm: { x: finite(translation.x, "translation.x"), y: finite(translation.y, "translation.y"), z: finite(translation.z, "translation.z") }, rotation: parseQuaternion(source.rotation) });
};
const parseRef = (value: unknown): { instanceId: string; bodyId: string; topologyRef: PersistentTopologyRef } => {
  const source = record(value, "Assembly topology reference");
  return { instanceId: text(source.instanceId, "Assembly topology reference instanceId"), bodyId: text(source.bodyId, "Assembly topology reference bodyId"), topologyRef: migratePersistentTopologyRefV1ToV2(record(source.topologyRef, "Part topology reference") as unknown as PersistentTopologyRef) };
};
const parseAlignment = (value: unknown, label: string): MateAlignment => value === "same" || value === "opposite" ? value : invalid(`${label} is invalid.`);
const parseConnectorRef=(value:unknown)=>{const source=record(value,"Assembly Mate Connector reference");return {instanceId:text(source.instanceId,"Connector reference instanceId"),connectorId:text(source.connectorId,"Connector reference connectorId")};};
const parseLimit=(value:unknown,label:string)=>{const source=record(value,label);const min=finite(source.min,`${label}.min`),max=finite(source.max,`${label}.max`);if(min>max)invalid(`${label} requires min <= max.`);return {enabled:bool(source.enabled,`${label}.enabled`),min,max};};

const parseMate = (value: unknown): AssemblyMate => {
  const source = record(value, "Mate"); const id = text(source.id, "Mate id"), name = text(source.name, "Mate name"), enabled = bool(source.enabled, "Mate enabled"); const type = text(source.type, "Mate type");
  const base = { id, name, enabled };
  switch (type) {
    case "fixed": return { ...base, type: "fixed", componentId: text(source.componentId, "Fixed Mate componentId"), lockedPlacement: parseTransform(source.lockedPlacement) };
    case "coincident": return { ...base, type: "coincident", a: parseRef(source.a), b: parseRef(source.b), alignment: parseAlignment(source.alignment, "Coincident Mate alignment") };
    case "distance": return { ...base, type: "distance", a: parseRef(source.a), b: parseRef(source.b), alignment: parseAlignment(source.alignment, "Distance Mate alignment"), distanceMm: finite(source.distanceMm, "distanceMm") };
    case "concentric": return { ...base, type: "concentric", a: parseRef(source.a), b: parseRef(source.b) };
    case "angle": { const angleDeg = finite(source.angleDeg, "angleDeg"); if (angleDeg < 0 || angleDeg > 180) invalid("Angle Mate must be within 0..180 degrees."); return { ...base, type: "angle", a: parseRef(source.a), b: parseRef(source.b), angleDeg }; }
    case "revolute": return {...base,type:"revolute",a:parseConnectorRef(source.a),b:parseConnectorRef(source.b),angleLimit:parseLimit(source.angleLimit,"Revolute angleLimit")};
    case "slider": return {...base,type:"slider",a:parseConnectorRef(source.a),b:parseConnectorRef(source.b),distanceLimit:parseLimit(source.distanceLimit,"Slider distanceLimit")};
    default: return invalid(`Unsupported Assembly Mate type ${type}.`);
  }
};

export const deserializeAssemblyDocument = (input: unknown): AssemblyDocument => {
  const source = record(input, "Assembly document");
  const sourceVersion=source.schemaVersion;
  if (sourceVersion !== 1 && sourceVersion !== ASSEMBLY_DOCUMENT_SCHEMA_VERSION) {
    if (typeof sourceVersion === "number" && sourceVersion > ASSEMBLY_DOCUMENT_SCHEMA_VERSION) throw new AssemblyDocumentError("ASSEMBLY_DOCUMENT_VERSION_UNSUPPORTED", `Assembly schema ${sourceVersion} is newer than supported schema ${ASSEMBLY_DOCUMENT_SCHEMA_VERSION}.`);
    invalid("Unsupported Assembly schema version.");
  }
  const id = text(source.id, "Assembly id"), name = text(source.name, "Assembly name"); if (source.unit !== "mm") invalid("Assembly unit must be mm.");
  const componentsInput = record(source.components, "components"), matesInput = record(source.mates, "mates"), componentOrder = stringArray(source.componentOrder, "componentOrder"), mateOrder = stringArray(source.mateOrder, "mateOrder");
  if (new Set(componentOrder).size !== componentOrder.length) invalid("componentOrder contains duplicates."); if (new Set(mateOrder).size !== mateOrder.length) invalid("mateOrder contains duplicates.");
  const components: Record<string, ComponentInstance> = {};
  for (const [componentId, value] of Object.entries(componentsInput)) {
    const component = record(value, `Component ${componentId}`); if (component.id !== componentId) invalid(`Component key ${componentId} does not match its id.`);
    components[componentId] = { id: componentId, name: text(component.name, `Component ${componentId} name`), definitionId: text(component.definitionId, `Component ${componentId} definitionId`), grounded: bool(component.grounded, `Component ${componentId} grounded`), visible: bool(component.visible, `Component ${componentId} visible`), nominalPlacement: parseTransform(component.nominalPlacement) };
  }
  if (componentOrder.length !== Object.keys(components).length || componentOrder.some((componentId) => !components[componentId])) invalid("componentOrder must contain each Component exactly once.");
  const mates: Record<string, AssemblyMate> = {};
  for (const [mateId, value] of Object.entries(matesInput)) { const mate = parseMate(value); if (mate.id !== mateId) invalid(`Mate key ${mateId} does not match its id.`); mates[mateId] = mate; }
  if (mateOrder.length !== Object.keys(mates).length || mateOrder.some((mateId) => !mates[mateId])) invalid("mateOrder must contain each Mate exactly once.");
  for (const mate of Object.values(mates)) { const componentIds = mate.type === "fixed" ? [mate.componentId] : [mate.a.instanceId, mate.b.instanceId]; if (componentIds.some((componentId) => !components[componentId])) invalid(`Mate ${mate.id} references a missing Component.`); }
  return { schemaVersion: ASSEMBLY_DOCUMENT_SCHEMA_VERSION, id, name, unit: "mm", components, componentOrder, mates, mateOrder, updatedAt: finite(source.updatedAt ?? 0, "updatedAt") };
};

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().filter((key) => !["runtimeShapeId", "runtimeShape", "solvedPlacement", "solverState", "tessellation"].includes(key)).map((key) => [key, stable((value as Record<string, unknown>)[key])])) : value;
export const canonicalSerializeAssemblyDocument = (document: AssemblyDocument): string => JSON.stringify(stable(deserializeAssemblyDocument(document)));
export const serializeAssemblyDocument = (document: AssemblyDocument): SerializableAssemblyDocument => JSON.parse(canonicalSerializeAssemblyDocument(document)) as SerializableAssemblyDocument;
export const computeAssemblyDocumentFingerprint = (document: AssemblyDocument): string => { let hash = 2166136261; for (const character of canonicalSerializeAssemblyDocument(document)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `assembly-${(hash >>> 0).toString(16).padStart(8, "0")}`; };

export const serializeAssemblyProjectBundle = (assembly: AssemblyDocument, definitions: PartDefinitionStore): AssemblyProjectBundle => {
  const required = new Set(Object.values(assembly.components).map((component) => component.definitionId)); const selected: PartDefinition[] = [];
  for (const definitionId of required) { const definition = definitions.definitions.get(definitionId); if (!definition) throw new AssemblyDocumentError("ASSEMBLY_DEFINITION_MISSING", `Part definition ${definitionId} is unavailable.`); selected.push(clone(definition)); }
  return { version: ASSEMBLY_PROJECT_BUNDLE_VERSION, assembly: serializeAssemblyDocument(assembly), definitions: selected };
};

export const deserializeAssemblyProjectBundle = (input: unknown): { assembly: AssemblyDocument; definitions: PartDefinitionStore } => {
  const source = record(input, "Assembly project bundle"); if ((source.version !== 1 && source.version !== ASSEMBLY_PROJECT_BUNDLE_VERSION) || !Array.isArray(source.definitions)) throw new AssemblyDocumentError("ASSEMBLY_BUNDLE_VERSION_UNSUPPORTED", "Assembly project bundle version is unsupported.");
  const assembly = deserializeAssemblyDocument(source.assembly); const definitions = source.definitions.map((entry) => clone(entry as PartDefinition)); const store = createPartDefinitionStore(definitions);
  for (const component of Object.values(assembly.components)) if (!store.definitions.has(component.definitionId)) throw new AssemblyDocumentError("ASSEMBLY_DEFINITION_MISSING", `Part definition ${component.definitionId} is unavailable.`);
  return { assembly, definitions: store };
};
