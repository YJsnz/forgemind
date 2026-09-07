import type { KernelEdgeContinuityAnalysis, KernelSurfacePointAnalysis } from "../kernel/KernelTypes.ts";

export type SurfaceContinuityLevel = "G0" | "G1" | "G2-candidate";

export interface SurfaceQualitySummary {
  surfaceType: string;
  gaussian: number;
  mean: number;
  minPrincipal: number;
  maxPrincipal: number;
  saddle: boolean;
  developableCandidate: boolean;
}

export const summarizeSurfacePoint = (sample: KernelSurfacePointAnalysis): SurfaceQualitySummary => ({
  surfaceType: sample.surfaceType ?? "other",
  gaussian: sample.curvature.gaussian,
  mean: sample.curvature.mean,
  minPrincipal: sample.curvature.min,
  maxPrincipal: sample.curvature.max,
  saddle: sample.curvature.gaussian < -1e-10,
  developableCandidate: Math.abs(sample.curvature.gaussian) <= 1e-8,
});

/** G2 remains a diagnostic candidate: principal-curvature agreement alone is not a boundary-condition proof. */
export const continuityLevel = (analysis: KernelEdgeContinuityAnalysis): SurfaceContinuityLevel =>
  analysis.g1 ? (analysis.curvatureMatched ? "G2-candidate" : "G1") : "G0";
