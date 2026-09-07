import type { CadDocument } from "./CadDocument.ts";
import { deserializeCadDocument, serializeCadDocument } from "./CadDocumentPersistence.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredCadDocumentRecord {
  format: "forgemind-cad-handoff";
  version: 1;
  savedAt: number;
  sourceResourceId?: string;
  document: ReturnType<typeof serializeCadDocument>;
}

export interface StoredCadDocumentSummary {
  id: string;
  name: string;
  savedAt: number;
  sourceResourceId?: string;
}

const PREFIX = "forgemind:cad:";
const safeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";

export const cadDocumentStoreKey = (id: string) => `${PREFIX}document:${safeKey(id)}`;
export const cadResourceStoreKey = (resourceId: string) => `${PREFIX}resource:${safeKey(resourceId)}`;
export const CAD_LATEST_STORE_KEY = `${PREFIX}latest`;

const encodeRecord = (document: CadDocument<Sketch, Feature>, sourceResourceId?: string): string => JSON.stringify({
  format: "forgemind-cad-handoff",
  version: 1,
  savedAt: Date.now(),
  ...(sourceResourceId ? { sourceResourceId } : {}),
  document: serializeCadDocument(document),
} satisfies StoredCadDocumentRecord);

const decodeRecord = (raw: string | null): { record: StoredCadDocumentRecord; document: CadDocument<Sketch, Feature> } | undefined => {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Partial<StoredCadDocumentRecord>;
  if (parsed.format !== "forgemind-cad-handoff" || parsed.version !== 1 || !parsed.document) throw new Error("CAD handoff record format is unsupported.");
  return { record: parsed as StoredCadDocumentRecord, document: deserializeCadDocument(parsed.document) };
};

/**
 * Stores design-only CAD data. Runtime OCCT shape ids and Three.js objects are
 * excluded by serializeCadDocument before the record reaches Web Storage.
 */
export const saveCadDocumentHandoff = (
  storage: StorageLike,
  document: CadDocument<Sketch, Feature>,
  options: { sourceResourceId?: string } = {},
): { documentKey: string; resourceKey?: string } => {
  const raw = encodeRecord(document, options.sourceResourceId);
  const documentKey = cadDocumentStoreKey(document.id);
  storage.setItem(documentKey, raw);
  storage.setItem(CAD_LATEST_STORE_KEY, raw);
  let resourceKey: string | undefined;
  if (options.sourceResourceId) {
    resourceKey = cadResourceStoreKey(options.sourceResourceId);
    storage.setItem(resourceKey, raw);
  }
  return { documentKey, resourceKey };
};

export const loadCadDocumentHandoff = (
  storage: StorageLike,
  options: { documentId?: string; resourceId?: string; latest?: boolean } = {},
): { record: StoredCadDocumentRecord; document: CadDocument<Sketch, Feature> } | undefined => {
  const keys = [
    options.documentId ? cadDocumentStoreKey(options.documentId) : undefined,
    options.resourceId ? cadResourceStoreKey(options.resourceId) : undefined,
    options.latest ? CAD_LATEST_STORE_KEY : undefined,
  ].filter((value): value is string => Boolean(value));
  for (const key of keys) {
    const loaded = decodeRecord(storage.getItem(key));
    if (loaded) return loaded;
  }
  return undefined;
};

/** Lists locally stored work projects without exposing runtime geometry. */
export const listCadDocumentHandoffs = (storage: StorageLike): StoredCadDocumentSummary[] => {
  const enumerable = storage as StorageLike & { length?: number; key?: (index: number) => string | null };
  if (!Number.isFinite(enumerable.length) || typeof enumerable.key !== "function") return [];
  const projects = new Map<string, StoredCadDocumentSummary>();
  for (let index = 0; index < (enumerable.length ?? 0); index += 1) {
    const key = enumerable.key(index);
    if (!key?.startsWith(`${PREFIX}document:`)) continue;
    try {
      const loaded = decodeRecord(storage.getItem(key));
      if (!loaded) continue;
      const summary: StoredCadDocumentSummary = { id: loaded.document.id, name: loaded.document.name, savedAt: loaded.record.savedAt, sourceResourceId: loaded.record.sourceResourceId };
      const prior = projects.get(summary.id);
      if (!prior || summary.savedAt > prior.savedAt) projects.set(summary.id, summary);
    } catch { /* Ignore stale or malformed browser-storage entries. */ }
  }
  return [...projects.values()].sort((a, b) => b.savedAt - a.savedAt);
};

export const removeCadDocumentHandoff = (storage: StorageLike, documentId: string): void => {
  storage.removeItem(cadDocumentStoreKey(documentId));
};
