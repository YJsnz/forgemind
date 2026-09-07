import type { KernelSurfaceContinuityAnalysis } from "../kernel/KernelTypes.ts";

export type SurfaceContinuityGrade = "disconnected" | "G0" | "G1" | "G2";

export interface SurfaceContinuityReport extends KernelSurfaceContinuityAnalysis {
  grade: SurfaceContinuityGrade;
  summary: string;
}

/** Conservative grading: a higher grade is returned only when every sampled boundary point passes. */
export const gradeSurfaceContinuity = (analysis: KernelSurfaceContinuityAnalysis): SurfaceContinuityReport => {
  if (!analysis.connected || !analysis.samples.length) return { ...analysis, grade: "disconnected", summary: "No shared topological boundary was found." };
  const maxNormal = Math.max(...analysis.samples.map((sample) => sample.normalAngleDeg));
  const curvatureSamples = analysis.samples.filter((sample) => typeof sample.curvatureDelta === "number");
  const maxCurvatureDelta = curvatureSamples.length ? Math.max(...curvatureSamples.map((sample) => sample.curvatureDelta!)) : undefined;
  if (maxNormal > analysis.g1ToleranceDeg) return { ...analysis, grade: "G0", summary: `Position continuous only; max normal delta ${maxNormal.toFixed(3)}°.` };
  if (maxCurvatureDelta === undefined || maxCurvatureDelta > analysis.g2Tolerance) return { ...analysis, grade: "G1", summary: `Tangent continuous; max normal delta ${maxNormal.toFixed(3)}°${maxCurvatureDelta === undefined ? "; curvature unavailable" : `, curvature delta ${maxCurvatureDelta.toExponential(3)}`}.` };
  return { ...analysis, grade: "G2", summary: `Curvature continuous within diagnostic tolerance; max normal delta ${maxNormal.toFixed(3)}°, curvature delta ${maxCurvatureDelta.toExponential(3)}.` };
};
