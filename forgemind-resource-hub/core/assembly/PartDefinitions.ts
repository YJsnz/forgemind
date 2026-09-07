import type { CadAssetStore } from "../cad/CadAssets.ts";
import type { CadDocument } from "../cad/CadDocument.ts";
import { computeCadDocumentFingerprint } from "../cad/CadDocumentPersistence.ts";
import { serializeCadProjectBundle } from "../cad/CadProjectBundle.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { PartDefinition, PartDefinitionStore, PartMateConnectorDefinition } from "./AssemblyTypes.ts";

const connectorFingerprint = (connectors: Record<string, PartMateConnectorDefinition>, order: readonly string[]): string => {
  let hash=2166136261;
  const payload=JSON.stringify(order.map((id)=>connectors[id]));
  for(const character of payload){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,"0");
};

export const normalizePartDefinition = (definition: PartDefinition | (Omit<PartDefinition,"mateConnectors"|"mateConnectorOrder"> & {mateConnectors?:Record<string,PartMateConnectorDefinition>;mateConnectorOrder?:string[]})): PartDefinition => {
  const mateConnectors=structuredClone(definition.mateConnectors??{}); const mateConnectorOrder=[...(definition.mateConnectorOrder??Object.keys(mateConnectors))];
  return {...structuredClone(definition),mateConnectors,mateConnectorOrder} as PartDefinition;
};

export const createPartDefinitionStore = (definitions: readonly PartDefinition[] = []): PartDefinitionStore => ({ definitions: new Map(definitions.map((definition) => { const normalized=normalizePartDefinition(definition); return [normalized.id,normalized]; })) });

export const addPartDefinition = (store: PartDefinitionStore, definition: PartDefinition): PartDefinitionStore => {
  const normalized=normalizePartDefinition(definition); const existing = store.definitions.get(normalized.id);
  if (existing && existing.fingerprint !== normalized.fingerprint) throw new Error(`Part definition ${normalized.id} already exists with different design content.`);
  if (existing) return store;
  return createPartDefinitionStore([...store.definitions.values(), normalized]);
};

export const createPartDefinitionFromCadDocument = (id: string, name: string, document: CadDocument<Sketch, Feature>, assets: CadAssetStore): PartDefinition => ({
  id,
  name,
  fingerprint: computeCadDocumentFingerprint(document),
  project: serializeCadProjectBundle(document, assets),
  mateConnectors:{},
  mateConnectorOrder:[],
});

/** Creates a new immutable PartDefinition revision rather than mutating a definition used by other instances. */
export const createPartDefinitionRevisionWithMateConnector = (source:PartDefinition,newId:string,connector:PartMateConnectorDefinition):PartDefinition => {
  const current=normalizePartDefinition(source); if(current.mateConnectors[connector.id]) throw new Error(`Mate Connector ${connector.id} already exists in ${source.id}.`);
  const mateConnectors={...current.mateConnectors,[connector.id]:structuredClone(connector)}; const mateConnectorOrder=[...current.mateConnectorOrder,connector.id];
  return {...structuredClone(current),id:newId,name:`${current.name} · MC`,mateConnectors,mateConnectorOrder,fingerprint:`${current.fingerprint}-mc-${connectorFingerprint(mateConnectors,mateConnectorOrder)}`};
};

export const findEquivalentPartDefinition = (store: PartDefinitionStore, fingerprint: string): PartDefinition | undefined => [...store.definitions.values()].find((definition) => definition.fingerprint === fingerprint);
