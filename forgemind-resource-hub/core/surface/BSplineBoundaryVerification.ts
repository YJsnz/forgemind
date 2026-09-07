import type { BSplineSurfaceBoundaryMatch } from "../features/BSplineSurfaceFeature.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelShapeRef, KernelSurfaceGridAnalysis, KernelSurfacePointAnalysis } from "../kernel/KernelTypes.ts";
import type { BSplineEdge } from "./BSplineControlNet.ts";

const sampleCount = 11;

/** Public control-net columns are U; OCCT's template parameters run rows first. */
const boundarySamples = (grid: KernelSurfaceGridAnalysis, edge: BSplineEdge): KernelSurfacePointAnalysis[] => {
  const fixed = edge.startsWith("u") ? "v" : "u";
  const along = fixed === "u" ? "v" : "u";
  const values = grid.samples.map((sample) => sample[fixed]);
  const limit = edge.endsWith("Min") ? Math.min(...values) : Math.max(...values);
  const result = grid.samples.filter((sample) => Math.abs(sample[fixed] - limit) <= 1e-10).sort((a, b) => a[along] - b[along]);
  if (grid.rejectedSampleCount || result.length !== sampleCount) throw new Error("曲面边界采样不完整，暂不能确认连续性。");
  return result;
};

const sampleShape = async (kernel: CadKernel, shape: KernelShapeRef): Promise<KernelSurfaceGridAnalysis> => {
  const faces = await kernel.getFaces(shape);
  if (faces.length !== 1) throw new Error("边界控制网匹配需要单张未裁剪曲面。");
  return kernel.analyzeSurfaceGrid(faces[0].topology, sampleCount, sampleCount);
};

/** Checks the actual reconstructed B-Rep, not merely the authored control bands. */
export const verifyBSplineSurfaceBoundaries = async (
  kernel: CadKernel,
  target: KernelShapeRef,
  supports: readonly { shape: KernelShapeRef; relation: BSplineSurfaceBoundaryMatch }[],
  positionToleranceMm: number,
): Promise<void> => {
  if (!supports.length) return;
  const targetGrid = await sampleShape(kernel, target);
  const sourceGrids = new Map<string, KernelSurfaceGridAnalysis>();
  for (const { shape, relation } of supports) {
    const key = `${shape.id}:${shape.revision}`;
    let sourceGrid = sourceGrids.get(key);
    if (!sourceGrid) { sourceGrid = await sampleShape(kernel, shape); sourceGrids.set(key, sourceGrid); }
    const left = boundarySamples(sourceGrid, relation.sourceEdge);
    if (relation.reverse) left.reverse();
    const right = boundarySamples(targetGrid, relation.targetEdge);
    for (let i = 0; i < sampleCount; i += 1) {
      const a = left[i], b = right[i];
      const gap = Math.hypot(a.pointMm.x - b.pointMm.x, a.pointMm.y - b.pointMm.y, a.pointMm.z - b.pointMm.z);
      let accepted = Number.isFinite(gap) && gap <= positionToleranceMm;
      const cosine = a.normal.x * b.normal.x + a.normal.y * b.normal.y + a.normal.z * b.normal.z;
      if (relation.continuity !== "G0") accepted &&= Number.isFinite(cosine) && Math.acos(Math.min(1, Math.max(0, Math.abs(cosine)))) * 180 / Math.PI <= .5;
      if (relation.continuity === "G2") {
        // Align oriented normals before comparing signed principal curvatures.
        // Absolute values would incorrectly accept convex/concave mismatches.
        const sign = cosine < 0 ? -1 : 1;
        const ca = [a.curvature.min, a.curvature.max].sort((x, y) => x - y);
        const cb = [b.curvature.min * sign, b.curvature.max * sign].sort((x, y) => x - y);
        accepted &&= ca.every((value, index) => Number.isFinite(value) && Number.isFinite(cb[index]) && Math.abs(value - cb[index]) <= 1e-3);
      }
      if (!accepted) throw new Error(`${relation.targetEdge} 未通过 ${relation.continuity} 实际曲面检查（第 ${i + 1}/${sampleCount} 点，间隙 ${gap.toPrecision(3)} mm）。请检查方向、节点、权重或调整连续性等级。`);
    }
  }
};
