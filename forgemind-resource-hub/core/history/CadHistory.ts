import type { CadDocument, SerializableCadDocument } from "../cad/CadDocument.ts";
import { serializeCadDocument } from "../cad/CadDocumentPersistence.ts";
import { deserializeCadDocument } from "../cad/CadDocumentPersistence.ts";

/** Design-only session history. It deliberately has no kernel, viewport or UI dependency. */
export interface CadHistory<TSketch = unknown, TFeature = unknown> {
  readonly capacity: number;
  readonly past: readonly SerializableCadDocument<TSketch, TFeature>[];
  readonly present: SerializableCadDocument<TSketch, TFeature>;
  readonly future: readonly SerializableCadDocument<TSketch, TFeature>[];
}

export interface CadHistoryTransition<TSketch = unknown, TFeature = unknown> {
  history: CadHistory<TSketch, TFeature>;
  document: CadDocument<TSketch, TFeature>;
}

export const DEFAULT_CAD_HISTORY_CAPACITY = 100;

/** Routes every snapshot through the canonical document persistence boundary.
 * This both deep-clones design data and rejects/removes runtime-only fields. */
const snapshot = <TSketch, TFeature>(document: CadDocument<TSketch, TFeature>): SerializableCadDocument<TSketch, TFeature> =>
  serializeCadDocument(deserializeCadDocument(serializeCadDocument(document))) as SerializableCadDocument<TSketch, TFeature>;

const signature = (document: SerializableCadDocument): string => JSON.stringify(document);
const restore = <TSketch, TFeature>(document: SerializableCadDocument<TSketch, TFeature>): CadDocument<TSketch, TFeature> =>
  deserializeCadDocument(document) as CadDocument<TSketch, TFeature>;

export const createCadHistory = <TSketch, TFeature>(initial: CadDocument<TSketch, TFeature>, capacity = DEFAULT_CAD_HISTORY_CAPACITY): CadHistory<TSketch, TFeature> => {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("CAD history capacity must be a positive integer.");
  return { capacity, past: [], present: snapshot(initial), future: [] };
};

export const currentCadDocument = <TSketch, TFeature>(history: CadHistory<TSketch, TFeature>): CadDocument<TSketch, TFeature> => restore(history.present);
export const canUndoCadHistory = (history: CadHistory): boolean => history.past.length > 0;
export const canRedoCadHistory = (history: CadHistory): boolean => history.future.length > 0;

/** Commits exactly one effective design edit. Identical documents do not consume history capacity. */
export const commitCadHistory = <TSketch, TFeature>(history: CadHistory<TSketch, TFeature>, candidate: CadDocument<TSketch, TFeature>): CadHistory<TSketch, TFeature> => {
  const next = snapshot(candidate);
  if (signature(next) === signature(history.present)) return history;
  return { capacity: history.capacity, past: [...history.past, history.present].slice(-history.capacity), present: next, future: [] };
};

export const undoCadHistory = <TSketch, TFeature>(history: CadHistory<TSketch, TFeature>): CadHistoryTransition<TSketch, TFeature> | undefined => {
  const previous = history.past.at(-1); if (!previous) return undefined;
  const next = { capacity: history.capacity, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, history.capacity) };
  return { history: next, document: restore(previous) };
};

export const redoCadHistory = <TSketch, TFeature>(history: CadHistory<TSketch, TFeature>): CadHistoryTransition<TSketch, TFeature> | undefined => {
  const following = history.future[0]; if (!following) return undefined;
  const next = { capacity: history.capacity, past: [...history.past, history.present].slice(-history.capacity), present: following, future: history.future.slice(1) };
  return { history: next, document: restore(following) };
};

export const clearCadHistory = <TSketch, TFeature>(history: CadHistory<TSketch, TFeature>): CadHistory<TSketch, TFeature> => ({ ...history, past: [], future: [] });
