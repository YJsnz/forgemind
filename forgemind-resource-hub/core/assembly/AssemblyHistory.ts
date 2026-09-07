import type { AssemblyDocument } from "./AssemblyTypes.ts";
import { deserializeAssemblyDocument, serializeAssemblyDocument, type SerializableAssemblyDocument } from "./AssemblyPersistence.ts";

export const DEFAULT_ASSEMBLY_HISTORY_CAPACITY = 100;
export interface AssemblyHistory { capacity: number; past: readonly SerializableAssemblyDocument[]; present: SerializableAssemblyDocument; future: readonly SerializableAssemblyDocument[]; }
export interface AssemblyHistoryTransition { history: AssemblyHistory; document: AssemblyDocument; }
const snapshot = (document: AssemblyDocument): SerializableAssemblyDocument => serializeAssemblyDocument(deserializeAssemblyDocument(serializeAssemblyDocument(document)));
const signature = (document: SerializableAssemblyDocument): string => JSON.stringify({ ...document, updatedAt: 0 });
const restore = (document: SerializableAssemblyDocument): AssemblyDocument => deserializeAssemblyDocument(document);
export const createAssemblyHistory = (initial: AssemblyDocument, capacity = DEFAULT_ASSEMBLY_HISTORY_CAPACITY): AssemblyHistory => { if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Assembly history capacity must be a positive integer."); return { capacity, past: [], present: snapshot(initial), future: [] }; };
export const currentAssemblyDocument = (history: AssemblyHistory): AssemblyDocument => restore(history.present);
export const commitAssemblyHistory = (history: AssemblyHistory, candidate: AssemblyDocument): AssemblyHistory => { const next = snapshot(candidate); if (signature(next) === signature(history.present)) return history; return { capacity: history.capacity, past: [...history.past, history.present].slice(-history.capacity), present: next, future: [] }; };
export const undoAssemblyHistory = (history: AssemblyHistory): AssemblyHistoryTransition | undefined => { const previous = history.past.at(-1); if (!previous) return undefined; return { history: { capacity: history.capacity, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, history.capacity) }, document: restore(previous) }; };
export const redoAssemblyHistory = (history: AssemblyHistory): AssemblyHistoryTransition | undefined => { const following = history.future[0]; if (!following) return undefined; return { history: { capacity: history.capacity, past: [...history.past, history.present].slice(-history.capacity), present: following, future: history.future.slice(1) }, document: restore(following) }; };
