import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import { rebuildDocument, type RebuildEngineContext } from "../rebuild/RebuildEngine.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import { commitCadHistory, type CadHistory, type CadHistoryTransition, redoCadHistory, undoCadHistory } from "./CadHistory.ts";

export type CadHistoryRebuildContext = Omit<RebuildEngineContext, "document">;
export interface CadHistoryRebuildResult { success: boolean; history: CadHistory<Sketch, Feature>; document: CadDocument<Sketch, Feature>; code?: "HISTORY_RESTORE_REBUILD_FAILED"; }

/** Candidate edits are remembered only after the production staged rebuild succeeds. */
export const commitCadHistoryEdit = async (history: CadHistory<Sketch, Feature>, current: CadDocument<Sketch, Feature>, candidate: CadDocument<Sketch, Feature>, context: CadHistoryRebuildContext): Promise<CadHistoryRebuildResult> => {
  const rebuilt = await rebuildDocument({ ...context, document: candidate }, { full: true });
  if (!rebuilt.success) return { success: false, history, document: current, code: "HISTORY_RESTORE_REBUILD_FAILED" };
  return { success: true, history: commitCadHistory(history, candidate), document: candidate };
};

const restore = async (transition: CadHistoryTransition<Sketch, Feature> | undefined, history: CadHistory<Sketch, Feature>, current: CadDocument<Sketch, Feature>, context: CadHistoryRebuildContext): Promise<CadHistoryRebuildResult> => {
  if (!transition) return { success: false, history, document: current, code: "HISTORY_RESTORE_REBUILD_FAILED" };
  const rebuilt = await rebuildDocument({ ...context, document: transition.document }, { full: true });
  if (!rebuilt.success) return { success: false, history, document: current, code: "HISTORY_RESTORE_REBUILD_FAILED" };
  return { success: true, history: transition.history, document: transition.document };
};

export const undoCadHistoryRebuild = (history: CadHistory<Sketch, Feature>, current: CadDocument<Sketch, Feature>, context: CadHistoryRebuildContext) => restore(undoCadHistory(history), history, current, context);
export const redoCadHistoryRebuild = (history: CadHistory<Sketch, Feature>, current: CadDocument<Sketch, Feature>, context: CadHistoryRebuildContext) => restore(redoCadHistory(history), history, current, context);
