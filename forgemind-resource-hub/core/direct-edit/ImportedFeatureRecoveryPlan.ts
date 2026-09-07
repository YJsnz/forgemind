import type {
  ImportedFeatureReconstructionReport,
  ImportedFeatureReviewItem,
  ReconstructionReadiness,
} from "./ImportedFeatureReconstructionReport.ts";

export type ImportedRecoveryPhase = "shape" | "repetition" | "detail" | "review";

export interface ImportedFeatureRecoveryStep {
  id: string;
  order: number;
  phase: ImportedRecoveryPhase;
  item: ImportedFeatureReviewItem;
  action: "reconstruct" | "confirm" | "review" | "skip-covered";
  coveredByStepId?: string;
  requiresReanalysis: boolean;
}

export interface ImportedFeatureRecoveryPlan {
  generatedAt: number;
  steps: ImportedFeatureRecoveryStep[];
  actionable: number;
  confirmationRequired: number;
  reviewOnly: number;
  coveredCandidates: number;
  summary: string;
}

const readinessAction = (readiness: ReconstructionReadiness): ImportedFeatureRecoveryStep["action"] =>
  readiness === "native-reconstructable" ? "reconstruct" : readiness === "user-confirmation" ? "confirm" : "review";

const phaseFor = (item: ImportedFeatureReviewItem): ImportedRecoveryPhase => {
  if (item.kind === "prismatic") return "shape";
  if (item.kind === "pattern") return "repetition";
  if (item.kind === "hole" || item.kind === "fillet" || item.kind === "chamfer") return "detail";
  return "review";
};

const phaseRank: Record<ImportedRecoveryPhase, number> = { shape: 0, repetition: 1, detail: 2, review: 3 };

/**
 * Turns recognition evidence into a deterministic, conservative recovery queue.
 * Pattern members cover their individual Hole candidates so a repeated set is
 * never reconstructed twice. Every committed topology-changing step is followed
 * by a re-analysis gate; stale imported Face/Edge references are not reused.
 */
export const buildImportedFeatureRecoveryPlan = (report: ImportedFeatureReconstructionReport): ImportedFeatureRecoveryPlan => {
  const patternItems = report.items.filter((item) => item.kind === "pattern");
  const coveredHoleFaces = new Map<string, string>();
  for (const pattern of patternItems) for (const topologyId of pattern.topologyLocalIds) coveredHoleFaces.set(topologyId, pattern.id);

  const provisional = report.items.map((item): Omit<ImportedFeatureRecoveryStep, "order"> => {
    if (item.kind === "hole") {
      const owner = item.topologyLocalIds.map((id) => coveredHoleFaces.get(id)).find(Boolean);
      if (owner) return { id: item.id, phase: "detail", item, action: "skip-covered", coveredByStepId: owner, requiresReanalysis: false };
    }
    const action = readinessAction(item.readiness);
    return { id: item.id, phase: action === "review" ? "review" : phaseFor(item), item, action, requiresReanalysis: action !== "review" };
  });

  provisional.sort((a, b) =>
    phaseRank[a.phase] - phaseRank[b.phase]
    || (a.action === "reconstruct" ? 0 : a.action === "confirm" ? 1 : a.action === "review" ? 2 : 3)
      - (b.action === "reconstruct" ? 0 : b.action === "confirm" ? 1 : b.action === "review" ? 2 : 3)
    || b.item.confidence - a.item.confidence
    || a.id.localeCompare(b.id),
  );
  const steps = provisional.map((step, index) => ({ ...step, order: index + 1 }));
  const actionable = steps.filter((step) => step.action === "reconstruct").length;
  const confirmationRequired = steps.filter((step) => step.action === "confirm").length;
  const reviewOnly = steps.filter((step) => step.action === "review").length;
  const coveredCandidates = steps.filter((step) => step.action === "skip-covered").length;
  const summary = `${actionable} 项可直接重构 · ${confirmationRequired} 项需确认 · ${reviewOnly} 项仅审查${coveredCandidates ? ` · ${coveredCandidates} 个重复孔由阵列统一恢复` : ""}`;
  return { generatedAt: Date.now(), steps, actionable, confirmationRequired, reviewOnly, coveredCandidates, summary };
};

export const nextImportedFeatureRecoveryStep = (plan: ImportedFeatureRecoveryPlan): ImportedFeatureRecoveryStep | undefined =>
  plan.steps.find((step) => step.action === "reconstruct" || step.action === "confirm");
