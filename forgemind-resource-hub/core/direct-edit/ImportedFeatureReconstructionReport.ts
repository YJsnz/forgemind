import type { ImportedGeometryRecognition } from "./ImportedFeatureRecognition.ts";

export type ImportedFeatureReviewKind = "hole" | "fillet" | "chamfer" | "prismatic" | "pattern";
export type ReconstructionReadiness = "native-reconstructable" | "user-confirmation" | "candidate-only";

export interface ImportedFeatureReviewItem {
  id: string;
  kind: ImportedFeatureReviewKind;
  label: string;
  confidence: number;
  readiness: ReconstructionReadiness;
  evidence: string[];
  topologyLocalIds: string[];
  recommendedAction: string;
  blockingReason?: string;
}

export interface ImportedFeatureReconstructionReport {
  generatedAt: number;
  items: ImportedFeatureReviewItem[];
  counts: Record<ReconstructionReadiness, number>;
  summary: string;
}

export const buildImportedFeatureReconstructionReport = (recognition: ImportedGeometryRecognition): ImportedFeatureReconstructionReport => {
  const items: ImportedFeatureReviewItem[] = [
    ...recognition.holes.map((candidate, index): ImportedFeatureReviewItem => ({
      id: `hole-${candidate.face.topology.localId}-${index}`,
      kind: "hole",
      label: `Hole Ø${candidate.diameterMm.toFixed(3)} × ${candidate.axialLengthMm.toFixed(3)} mm${candidate.depthCondition ? ` · ${candidate.depthCondition.type === "throughAll" ? "Through All" : `Blind ${candidate.depthCondition.valueMm.toFixed(3)} mm`}` : ""}`,
      confidence: candidate.confidence,
      readiness: "native-reconstructable",
      evidence: [candidate.reason, "exact analytic cylinder axis/radius", "concave oriented face normal", ...(candidate.depthCondition ? [candidate.depthCondition.reason] : [])],
      topologyLocalIds: [candidate.face.topology.localId],
      recommendedAction: "Remove/Heal → confirm entrance planar Face → reconstruct Native Hole",
    })),
    ...recognition.rounds.map((candidate, index): ImportedFeatureReviewItem => ({
      id: `fillet-${candidate.face.topology.localId}-${index}`,
      kind: "fillet",
      label: `Fillet / Round R${candidate.radiusMm.toFixed(3)}`,
      confidence: candidate.confidence,
      readiness: "user-confirmation",
      evidence: [candidate.reason, `connected analytic cylinder group: ${candidate.relatedFaceLocalIds.length} face(s)`],
      topologyLocalIds: candidate.relatedFaceLocalIds,
      recommendedAction: "Defeature/Heal → confirm one or more healed sharp Edges → reconstruct Native multi-edge Fillet",
    })),
    ...recognition.cones.map((candidate, index): ImportedFeatureReviewItem => ({
      id: `chamfer-${candidate.face.topology.localId}-${index}`,
      kind: "chamfer",
      label: `Chamfer / Cone ${index + 1}`,
      confidence: candidate.confidence,
      readiness: "user-confirmation",
      evidence: [candidate.reason, `connected conical group: ${candidate.relatedFaceLocalIds.length} face(s)`],
      topologyLocalIds: candidate.relatedFaceLocalIds,
      recommendedAction: "Defeature/Heal → confirm one or more healed sharp Edges → reconstruct Native multi-edge Chamfer",
    })),
    ...(recognition.patterns ?? []).map((candidate, index): ImportedFeatureReviewItem => ({
      id: `pattern-${candidate.kind}-${index}`,
      kind: "pattern",
      label: candidate.kind === "linear-hole-pattern"
        ? `Linear Hole Pattern · ${candidate.count} × Ø${candidate.diameterMm.toFixed(3)} · ${candidate.spacingMm.toFixed(3)} mm`
        : `Circular Hole Pattern · ${candidate.count} × Ø${candidate.diameterMm.toFixed(3)} · R${candidate.radiusMm.toFixed(3)}`,
      confidence: candidate.confidence,
      readiness: "user-confirmation",
      evidence: [candidate.reason, "analytic cylindrical axes / radii only; no tessellated point-cloud inference"],
      topologyLocalIds: candidate.memberFaceLocalIds,
      recommendedAction: "Heal repeated imported holes → confirm healed seed entrance Face → create Native Seed Hole + Native Pattern",
      blockingReason: "Pattern geometry and a deterministic seed member are proven; only the healed planar entrance Face must be confirmed before committing native History.",
    })),
    ...recognition.prisms.map((candidate, index): ImportedFeatureReviewItem => ({
      id: `prismatic-${candidate.capFace.topology.localId}-${index}`,
      kind: "prismatic",
      label: candidate.classification
        ? `Prismatic ${candidate.classification === "boss" ? "Boss" : "Pocket"} ${index + 1}${candidate.estimatedDepthMm ? ` · depth≈${candidate.estimatedDepthMm.toFixed(3)} mm` : ""}`
        : `Prismatic Boss/Pocket ${index + 1}${candidate.estimatedDepthMm ? ` · depth≈${candidate.estimatedDepthMm.toFixed(3)} mm` : ""}`,
      confidence: candidate.classificationConfidence ?? candidate.confidence,
      readiness: candidate.classification ? "native-reconstructable" : "candidate-only",
      evidence: [candidate.reason, ...(candidate.classificationEvidence ?? []), `cap boundary: ${candidate.profileEdgeLocalIds.length} edge(s)`, `side group: ${candidate.sideFaceLocalIds.length} face(s)`],
      topologyLocalIds: [candidate.capFace.topology.localId, ...candidate.sideFaceLocalIds],
      recommendedAction: candidate.classification
        ? `Recover exact cap boundary → Defeature/Heal → reconstruct Native ${candidate.classification === "boss" ? "Boolean Extrude Add" : "Blind Pocket"}`
        : "Review cap/side group; confirm Boss vs Pocket before any reconstruction",
      blockingReason: candidate.classification ? undefined : "Oriented cap/side convex-concave proof is not strong enough to promote this candidate.",
    })),
  ].sort((a,b)=>b.confidence-a.confidence || a.kind.localeCompare(b.kind));

  const counts: Record<ReconstructionReadiness, number> = {"native-reconstructable":0,"user-confirmation":0,"candidate-only":0};
  for (const item of items) counts[item.readiness] += 1;
  const summary = `${items.length} candidate(s): ${counts["native-reconstructable"]} native-reconstructable · ${counts["user-confirmation"]} require topology confirmation · ${counts["candidate-only"]} review-only`;
  return { generatedAt: Date.now(), items, counts, summary };
};
