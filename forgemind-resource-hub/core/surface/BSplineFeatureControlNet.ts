import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import { bsplineSurfaceBoundaryMatches } from "../features/BSplineSurfaceFeature.ts";
import { solveBSplineSurfaceNetwork } from "./BSplineControlNet.ts";
import type { Vec3 } from "../cad/CadTypes.ts";

const cloneNet = (net: Vec3[][]): Vec3[][] => net.map((row) => row.map((point) => ({ ...point })));

/** Resolves the effective net for a B-Spline feature, including chained boundary relations. */
export const resolveBSplineFeatureControlNet = (
  document: CadDocument<unknown, Feature>,
  featureId: string,
  visiting: ReadonlySet<string> = new Set(),
  resolved: Map<string, Vec3[][]> = new Map(),
): Vec3[][] => {
  const cached = resolved.get(featureId);
  if (cached) return cloneNet(cached);
  const feature = document.features[featureId];
  if (!feature || feature.type !== "bsplineSurface") throw new Error(`B-Spline 特征 ${featureId} 不存在。`);
  if (visiting.has(featureId)) throw new Error(`B-Spline 曲面匹配存在循环依赖：${[...visiting, featureId].join(" → ")}。`);
  const relations = bsplineSurfaceBoundaryMatches(feature); let result: Vec3[][];
  if (!relations.length) result = cloneNet(feature.controlNet);
  else {
    const nextVisiting = new Set(visiting); nextVisiting.add(featureId);
    // Fairing is an explicit editor action. Rebuild only reimposes the driven
    // bands, otherwise every save/reopen would relax the interior again.
    result = solveBSplineSurfaceNetwork(feature.controlNet, relations.map((relation) => ({ sourceControlNet: resolveBSplineFeatureControlNet(document, relation.sourceFeatureId, nextVisiting, resolved), options: relation })), { iterations: 0 });
  }
  resolved.set(featureId, cloneNet(result));
  return cloneNet(result);
};
