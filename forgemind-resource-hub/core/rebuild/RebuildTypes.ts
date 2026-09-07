import type { UUID } from "../cad/CadTypes.ts";
import type { FeatureEvaluationError } from "../evaluation/FeatureEvaluationError.ts";

export type RuntimeFeatureStatus = "clean" | "dirty" | "rebuilding" | "failed" | "blocked" | "suppressed";
export interface RuntimeFeatureState { featureId: UUID; status: RuntimeFeatureStatus; error?: FeatureEvaluationError; lastDurationMs?: number; }
/** Runtime-only build currency. `last-good` means document edits exist but the
 * active shape cache still deliberately represents the last successful build. */
export interface RebuildRuntimeState { features: Map<UUID, RuntimeFeatureState>; documentStatus: "current" | "last-good"; currentDocumentFingerprint?: string; lastSuccessfulDocumentFingerprint?: string; }
export interface RebuildRequest { full?: boolean; changedSketchIds?: UUID[]; changedFeatureIds?: UUID[]; }
export interface RebuildIssue { featureId: UUID; code: string; message: string; }
export interface RebuildResult { success: boolean; evaluatedFeatureIds: UUID[]; skippedFeatureIds: UUID[]; suppressedFeatureIds: UUID[]; failedFeatureIds: UUID[]; blockedFeatureIds: UUID[]; durationMs: number; errors: RebuildIssue[]; }
export const createRebuildRuntimeState = (): RebuildRuntimeState => ({ features: new Map(), documentStatus: "current" });
