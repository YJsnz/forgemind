import type { Vec3 } from "../cad/CadTypes.ts";
import { NURBS_PARAMETER_TOLERANCE, nurbsParameterTolerance } from "../curve/NurbsTolerance.ts";
import { createClampedUniformBSplineDefinition, createUnitWeightGrid } from "./RationalBSplineSections.ts";

export interface NurbsAxisDefinition {
  degree: number;
  knots: number[];
  multiplicities: number[];
}

/** Complete non-periodic tensor-product NURBS surface design data. */
export interface TensorProductNurbsDefinition {
  u: NurbsAxisDefinition;
  v: NurbsAxisDefinition;
  weights: number[][];
}

export interface TensorProductNurbsValidation { valid: boolean; issues: string[]; }
export interface TensorProductNurbsInsertionResult { controlNet: Vec3[][]; definition: TensorProductNurbsDefinition; }

export const createDefaultTensorProductNurbs = (controlNet: Vec3[][], preferredDegree = 3): TensorProductNurbsDefinition => ({
  u: createClampedUniformBSplineDefinition(controlNet[0]?.length ?? 0, preferredDegree),
  v: createClampedUniformBSplineDefinition(controlNet.length, preferredDegree),
  weights: createUnitWeightGrid(controlNet.length, controlNet[0]?.length ?? 0),
});

const validateAxis = (axis: NurbsAxisDefinition, poleCount: number, label: string): string[] => {
  const issues: string[] = [];
  if (!Number.isInteger(axis.degree) || axis.degree < 1 || axis.degree > 25 || axis.degree >= poleCount) issues.push(`${label} 次数必须是 1～${Math.max(1, poleCount - 1)} 的整数。`);
  if (!Array.isArray(axis.knots) || axis.knots.length < 2 || axis.knots.some((value) => !Number.isFinite(value))) issues.push(`${label} 节点必须包含至少两个有限数值。`);
  else {
    const tolerance = nurbsParameterTolerance(axis.knots[0], axis.knots.at(-1)!);
    if (axis.knots.some((value, index) => index > 0 && value - axis.knots[index - 1] <= tolerance)) issues.push(`${label} 节点必须严格递增，并大于参数容差。`);
    if (Math.abs(axis.knots[0]) > tolerance || Math.abs(axis.knots.at(-1)! - 1) > tolerance) issues.push(`${label} 节点范围必须标准化为 0～1。`);
  }
  if (!Array.isArray(axis.multiplicities) || axis.multiplicities.length !== axis.knots.length || axis.multiplicities.some((value) => !Number.isInteger(value) || value < 1)) issues.push(`${label} 节点与重数必须一一对应，且重数为正整数。`);
  else if (Number.isInteger(axis.degree)) {
    if (axis.multiplicities[0] !== axis.degree + 1 || axis.multiplicities.at(-1) !== axis.degree + 1) issues.push(`${label} 当前仅接受端点夹持曲面，首尾重数必须为次数加一。`);
    if (axis.multiplicities.slice(1, -1).some((value) => value > axis.degree)) issues.push(`${label} 内部节点重数不能大于次数。`);
    if (axis.multiplicities.reduce((sum, value) => sum + value, 0) !== poleCount + axis.degree + 1) issues.push(`${label} 节点重数总和与控制点数量、次数不匹配。`);
  }
  return issues;
};

export const validateTensorProductNurbs = (controlNet: Vec3[][], definition: TensorProductNurbsDefinition): TensorProductNurbsValidation => {
  const issues: string[] = [];
  const rows = controlNet.length, cols = controlNet[0]?.length ?? 0;
  if (rows < 2 || cols < 2 || controlNet.some((row) => row.length !== cols)) issues.push("完整 NURBS 需要至少 2×2 的矩形控制网。");
  if (!definition || typeof definition !== "object") return { valid: false, issues: ["完整 NURBS 参数缺失。"] };
  issues.push(...validateAxis(definition.u, cols, "U 向"), ...validateAxis(definition.v, rows, "V 向"));
  if (!Array.isArray(definition.weights) || definition.weights.length !== rows || definition.weights.some((row) => !Array.isArray(row) || row.length !== cols || row.some((value) => !Number.isFinite(value) || value <= 0))) issues.push("NURBS 权重必须与控制网同尺寸，且全部大于 0。");
  return { valid: issues.length === 0, issues };
};

const resampleLine = (source: number[], count: number): number[] => Array.from({ length: count }, (_, index) => {
  if (source.length <= 1) return source[0] ?? 1;
  const position = count <= 1 ? 0 : index * (source.length - 1) / (count - 1);
  const left = Math.floor(position), right = Math.min(source.length - 1, left + 1), fraction = position - left;
  return source[left] * (1 - fraction) + source[right] * fraction;
});

/** Bilinear weight resampling plus axis-wise knot preservation when dimensions remain compatible. */
export const reconcileTensorProductNurbs = (controlNet: Vec3[][], definition: TensorProductNurbsDefinition): TensorProductNurbsDefinition => {
  const generated = createDefaultTensorProductNurbs(controlNet, Math.max(definition.u.degree, definition.v.degree));
  const rowResampled = definition.weights.map((row) => resampleLine(row, controlNet[0]?.length ?? 0));
  generated.weights = Array.from({ length: controlNet.length }, (_, rowIndex) => {
    if (rowResampled.length <= 1) return [...(rowResampled[0] ?? generated.weights[rowIndex])];
    const position = controlNet.length <= 1 ? 0 : rowIndex * (rowResampled.length - 1) / (controlNet.length - 1);
    const top = Math.floor(position), bottom = Math.min(rowResampled.length - 1, top + 1), fraction = position - top;
    return rowResampled[top].map((value, col) => value * (1 - fraction) + rowResampled[bottom][col] * fraction);
  });
  const authored = { u: { ...definition.u, knots: [...definition.u.knots], multiplicities: [...definition.u.multiplicities] }, v: { ...definition.v, knots: [...definition.v.knots], multiplicities: [...definition.v.multiplicities] }, weights: generated.weights };
  const uCandidate = { ...generated, u: authored.u };
  if (validateTensorProductNurbs(controlNet, uCandidate).valid) generated.u = authored.u;
  const vCandidate = { ...generated, v: authored.v };
  if (validateTensorProductNurbs(controlNet, vCandidate).valid) generated.v = authored.v;
  return generated;
};

type HomogeneousPole = [number, number, number, number];
const blendPole = (left: HomogeneousPole, right: HomogeneousPole, alpha: number): HomogeneousPole => [
  (1 - alpha) * left[0] + alpha * right[0],
  (1 - alpha) * left[1] + alpha * right[1],
  (1 - alpha) * left[2] + alpha * right[2],
  (1 - alpha) * left[3] + alpha * right[3],
];
const expandedKnots = (axis: NurbsAxisDefinition): number[] => axis.knots.flatMap((knot, index) => Array.from({ length: axis.multiplicities[index] }, () => knot));

/** One exact Boehm knot insertion in rational homogeneous coordinates. */
const insertCurveKnot = (poles: Vec3[], weights: number[], axis: NurbsAxisDefinition, knot: number): { poles: Vec3[]; weights: number[] } => {
  const fullKnots = expandedKnots(axis), degree = axis.degree, n = poles.length - 1;
  const tolerance = nurbsParameterTolerance(axis.knots[0], axis.knots.at(-1)!);
  let span = fullKnots.length - degree - 2;
  for (let index = degree; index < fullKnots.length - degree - 1; index += 1) {
    if (knot >= fullKnots[index] - tolerance && knot < fullKnots[index + 1] - tolerance) { span = index; break; }
  }
  const multiplicity = fullKnots.reduce((count, value) => count + (Math.abs(value - knot) <= tolerance ? 1 : 0), 0);
  const source = poles.map((pole, index): HomogeneousPole => [pole.x * weights[index], pole.y * weights[index], pole.z * weights[index], weights[index]]);
  const result = Array.from({ length: source.length + 1 }) as HomogeneousPole[];
  for (let index = 0; index <= span - degree; index += 1) result[index] = source[index];
  for (let index = span - multiplicity; index <= n; index += 1) result[index + 1] = source[index];
  for (let index = span - degree + 1; index <= span - multiplicity; index += 1) {
    const denominator = fullKnots[index + degree] - fullKnots[index];
    const alpha = Math.abs(denominator) <= 1e-15 ? 0 : (knot - fullKnots[index]) / denominator;
    result[index] = blendPole(source[index - 1], source[index], alpha);
  }
  return {
    weights: result.map((pole) => pole[3]),
    poles: result.map((pole) => ({ x: pole[0] / pole[3], y: pole[1] / pole[3], z: pole[2] / pole[3] })),
  };
};

const axisAfterInsertion = (axis: NurbsAxisDefinition, knot: number): NurbsAxisDefinition => {
  const next = { degree: axis.degree, knots: [...axis.knots], multiplicities: [...axis.multiplicities] };
  const tolerance = nurbsParameterTolerance(axis.knots[0], axis.knots.at(-1)!);
  const existing = next.knots.findIndex((value) => Math.abs(value - knot) <= tolerance);
  if (existing >= 0) next.multiplicities[existing] += 1;
  else {
    const index = next.knots.findIndex((value) => value > knot);
    const insertion = index < 0 ? next.knots.length : index;
    next.knots.splice(insertion, 0, knot); next.multiplicities.splice(insertion, 0, 1);
  }
  return next;
};

/**
 * Adds one U or V control line without changing the represented rational
 * surface. The knot must be internal and its resulting multiplicity may not
 * exceed the degree.
 */
export const insertTensorProductNurbsKnot = (controlNet: Vec3[][], definition: TensorProductNurbsDefinition, direction: "u" | "v", knot: number): TensorProductNurbsInsertionResult => {
  const validation = validateTensorProductNurbs(controlNet, definition);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  if (!Number.isFinite(knot) || knot <= NURBS_PARAMETER_TOLERANCE || knot >= 1 - NURBS_PARAMETER_TOLERANCE) throw new Error("插入位置必须位于 0 与 1 之间。 ");
  const axis = definition[direction], tolerance = nurbsParameterTolerance(axis.knots[0], axis.knots.at(-1)!);
  const existing = axis.knots.findIndex((value) => Math.abs(value - knot) <= tolerance);
  if (existing < 0 && axis.knots.some((value) => Math.abs(value - knot) <= tolerance * 2)) throw new Error(`${direction.toUpperCase()} 向插入位置与已有节点过近。`);
  if (existing >= 0 && axis.multiplicities[existing] >= axis.degree) throw new Error(`${direction.toUpperCase()} 向该节点的重数已达到次数上限。`);
  const nextDefinition = structuredClone(definition); nextDefinition[direction] = axisAfterInsertion(axis, knot);
  let nextControlNet: Vec3[][];
  if (direction === "u") {
    const inserted = controlNet.map((row, rowIndex) => insertCurveKnot(row, definition.weights[rowIndex], axis, knot));
    nextControlNet = inserted.map((entry) => entry.poles); nextDefinition.weights = inserted.map((entry) => entry.weights);
  } else {
    const inserted = Array.from({ length: controlNet[0].length }, (_, colIndex) => insertCurveKnot(controlNet.map((row) => row[colIndex]), definition.weights.map((row) => row[colIndex]), axis, knot));
    nextControlNet = Array.from({ length: controlNet.length + 1 }, (_, rowIndex) => inserted.map((entry) => entry.poles[rowIndex]));
    nextDefinition.weights = Array.from({ length: controlNet.length + 1 }, (_, rowIndex) => inserted.map((entry) => entry.weights[rowIndex]));
  }
  const resultValidation = validateTensorProductNurbs(nextControlNet, nextDefinition);
  if (!resultValidation.valid) throw new Error(resultValidation.issues.join(" "));
  return { controlNet: nextControlNet, definition: nextDefinition };
};

/** Midpoint of the widest parameter span, used for balanced local refinement. */
export const widestTensorNurbsSpanMidpoint = (axis: NurbsAxisDefinition): number => {
  let widestStart = axis.knots[0], widestEnd = axis.knots[1];
  for (let index = 1; index < axis.knots.length - 1; index += 1) {
    if (axis.knots[index + 1] - axis.knots[index] > widestEnd - widestStart) { widestStart = axis.knots[index]; widestEnd = axis.knots[index + 1]; }
  }
  return (widestStart + widestEnd) / 2;
};
