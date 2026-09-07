import type { Vec3 } from "../cad/CadTypes.ts";

export type BSplineDirection = "u" | "v";
export type BSplineEdge = "uMin" | "uMax" | "vMin" | "vMax";
export type BSplineMatchContinuity = "G0" | "G1" | "G2";

const clonePoint = (point: Vec3): Vec3 => ({ x: point.x, y: point.y, z: point.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (point: Vec3, factor: number): Vec3 => ({ x: point.x * factor, y: point.y * factor, z: point.z * factor });
const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), .5);
const squaredLength = (point: Vec3): number => point.x * point.x + point.y * point.y + point.z * point.z;

export const validateBSplineControlNet = (controlNet: Vec3[][]): { rows: number; cols: number } => {
  const rows = controlNet.length;
  const cols = controlNet[0]?.length ?? 0;
  if (rows < 2 || cols < 2 || controlNet.some((row) => row.length !== cols)) {
    throw new Error("控制网必须是至少 2×2 的矩形网格。");
  }
  if (controlNet.flat().some((point) => !point || typeof point !== "object" || ![point.x, point.y, point.z].every(Number.isFinite))) {
    throw new Error("控制点坐标必须是有限数值。");
  }
  return { rows, cols };
};

/** Uniformly densifies the authored control net. This is an intentional shape edit, not knot insertion. */
export const refineBSplineControlNet = (controlNet: Vec3[][], direction: BSplineDirection): Vec3[][] => {
  validateBSplineControlNet(controlNet);
  if (direction === "u") {
    return controlNet.map((row) => row.flatMap((point, index) =>
      index === row.length - 1 ? [clonePoint(point)] : [clonePoint(point), midpoint(point, row[index + 1])],
    ));
  }
  return controlNet.flatMap((row, index) =>
    index === controlNet.length - 1
      ? [row.map(clonePoint)]
      : [row.map(clonePoint), row.map((point, col) => midpoint(point, controlNet[index + 1][col]))],
  );
};

export interface SmoothBSplineControlNetOptions {
  strength: number;
  iterations: number;
  preserveBoundary: boolean;
}

/** Laplacian fairness pass over control points; boundaries can remain fixed for downstream matching. */
export const smoothBSplineControlNet = (
  controlNet: Vec3[][],
  options: SmoothBSplineControlNetOptions,
): Vec3[][] => {
  const { rows, cols } = validateBSplineControlNet(controlNet);
  const strength = Number.isFinite(options.strength) ? Math.max(0, Math.min(1, options.strength)) : .35;
  const iterations = Number.isFinite(options.iterations) ? Math.max(1, Math.min(50, Math.round(options.iterations))) : 1;
  let result = controlNet.map((row) => row.map(clonePoint));
  for (let pass = 0; pass < iterations; pass += 1) {
    const current = result;
    result = current.map((row, r) => row.map((point, c) => {
      const boundary = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      if (options.preserveBoundary && boundary) return clonePoint(point);
      const neighbors = [
        r > 0 ? current[r - 1][c] : undefined,
        r + 1 < rows ? current[r + 1][c] : undefined,
        c > 0 ? current[r][c - 1] : undefined,
        c + 1 < cols ? current[r][c + 1] : undefined,
      ].filter((entry): entry is Vec3 => Boolean(entry));
      const average = scale(neighbors.reduce(add, { x: 0, y: 0, z: 0 }), 1 / neighbors.length);
      return add(scale(point, 1 - strength), scale(average, strength));
    }));
  }
  return result;
};

/** Mean squared second difference. Lower values indicate a fairer control net. */
export const bsplineControlNetFairness = (controlNet: Vec3[][]): number => {
  const { rows, cols } = validateBSplineControlNet(controlNet);
  const samples: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      samples.push(squaredLength(add(subtract(controlNet[r][c - 1], scale(controlNet[r][c], 2)), controlNet[r][c + 1])));
    }
  }
  for (let c = 0; c < cols; c += 1) {
    for (let r = 1; r < rows - 1; r += 1) {
      samples.push(squaredLength(add(subtract(controlNet[r - 1][c], scale(controlNet[r][c], 2)), controlNet[r + 1][c])));
    }
  }
  return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
};

const edgeLength = (controlNet: Vec3[][], edge: BSplineEdge): number =>
  edge === "uMin" || edge === "uMax" ? controlNet.length : controlNet[0].length;

const edgeDepth = (controlNet: Vec3[][], edge: BSplineEdge): number =>
  edge === "uMin" || edge === "uMax" ? controlNet[0].length : controlNet.length;

const edgePoint = (controlNet: Vec3[][], edge: BSplineEdge, index: number, depth: number): Vec3 => {
  const rows = controlNet.length, cols = controlNet[0].length;
  if (edge === "uMin") return controlNet[index][depth];
  if (edge === "uMax") return controlNet[index][cols - 1 - depth];
  if (edge === "vMin") return controlNet[depth][index];
  return controlNet[rows - 1 - depth][index];
};

const setEdgePoint = (controlNet: Vec3[][], edge: BSplineEdge, index: number, depth: number, point: Vec3): void => {
  const rows = controlNet.length, cols = controlNet[0].length;
  if (edge === "uMin") controlNet[index][depth] = point;
  else if (edge === "uMax") controlNet[index][cols - 1 - depth] = point;
  else if (edge === "vMin") controlNet[depth][index] = point;
  else controlNet[rows - 1 - depth][index] = point;
};

export const bsplineBoundaryPoleCount = edgeLength;
export const bsplineBoundaryRequiredDepth = (continuity: BSplineMatchContinuity): number => continuity === "G2" ? 3 : continuity === "G1" ? 2 : 1;
export const bsplineBoundaryPoleAddress = (controlNet: Vec3[][], edge: BSplineEdge, index: number, depth: number): { row: number; col: number } => {
  const rows = controlNet.length, cols = controlNet[0].length;
  if (edge === "uMin") return { row: index, col: depth };
  if (edge === "uMax") return { row: index, col: cols - 1 - depth };
  if (edge === "vMin") return { row: depth, col: index };
  return { row: rows - 1 - depth, col: index };
};

export interface MatchBSplineBoundaryOptions {
  sourceEdge: BSplineEdge;
  targetEdge: BSplineEdge;
  continuity: BSplineMatchContinuity;
  reverse?: boolean;
  tangentScale?: number;
  /** Resamples the target net along the selected boundary when pole counts differ. */
  adaptTargetBoundaryCount?: boolean;
  /** Internal network-solver mode: derivative bands are reparameterized when opposite supports require a deeper target net. */
  allowDifferentNormalDepth?: boolean;
}

const lerp = (a: Vec3, b: Vec3, ratio: number): Vec3 => add(scale(a, 1 - ratio), scale(b, ratio));

/** Bilinearly resamples an authored net. This aligns editable pole counts; it is not exact knot insertion. */
export const resampleBSplineControlNet = (controlNet: Vec3[][], rows: number, cols: number): Vec3[][] => {
  const source = validateBSplineControlNet(controlNet);
  const nextRows = Math.max(2, Math.round(rows)), nextCols = Math.max(2, Math.round(cols));
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || nextRows > 64 || nextCols > 64) {
    throw new Error("控制网目标行列数必须是 2～64 之间的有限整数。");
  }
  return Array.from({ length: nextRows }, (_, row) => Array.from({ length: nextCols }, (_, col) => {
    const sourceRow = nextRows === 1 ? 0 : row * (source.rows - 1) / (nextRows - 1);
    const sourceCol = nextCols === 1 ? 0 : col * (source.cols - 1) / (nextCols - 1);
    const r0 = Math.floor(sourceRow), r1 = Math.min(source.rows - 1, r0 + 1);
    const c0 = Math.floor(sourceCol), c1 = Math.min(source.cols - 1, c0 + 1);
    const upper = lerp(controlNet[r0][c0], controlNet[r0][c1], sourceCol - c0);
    const lower = lerp(controlNet[r1][c0], controlNet[r1][c1], sourceCol - c0);
    return lerp(upper, lower, sourceRow - r0);
  }));
};

/** Matches compatible uniform control-net boundaries and their first/second derivative rows. */
export const matchBSplineControlNetBoundary = (
  source: Vec3[][],
  target: Vec3[][],
  options: MatchBSplineBoundaryOptions,
): Vec3[][] => {
  validateBSplineControlNet(source);
  validateBSplineControlNet(target);
  const sourceCount = edgeLength(source, options.sourceEdge);
  let preparedTarget = target;
  let targetCount = edgeLength(preparedTarget, options.targetEdge);
  if (sourceCount !== targetCount && options.adaptTargetBoundaryCount) {
    const { rows, cols } = validateBSplineControlNet(preparedTarget);
    preparedTarget = options.targetEdge === "uMin" || options.targetEdge === "uMax"
      ? resampleBSplineControlNet(preparedTarget, sourceCount, cols)
      : resampleBSplineControlNet(preparedTarget, rows, sourceCount);
    targetCount = sourceCount;
  }
  if (sourceCount !== targetCount) throw new Error(`两条边界控制点数量不同（${sourceCount} / ${targetCount}），请启用自动对齐或先调整控制网。`);
  const requiredDepth = bsplineBoundaryRequiredDepth(options.continuity);
  if (edgeDepth(source, options.sourceEdge) < requiredDepth || edgeDepth(preparedTarget, options.targetEdge) < requiredDepth) {
    throw new Error(`${options.continuity} 匹配要求边界法向至少有 ${requiredDepth} 排控制点。`);
  }
  if (options.continuity === "G2" && edgeDepth(source, options.sourceEdge) !== edgeDepth(preparedTarget, options.targetEdge) && !options.allowDifferentNormalDepth) {
    throw new Error("G2 匹配要求两张曲面在边界法向使用相同数量的控制点，以保持一致的曲率参数化。");
  }

  const result = preparedTarget.map((row) => row.map(clonePoint));
  const tangentScale = Number.isFinite(options.tangentScale) ? Math.max(.01, Math.min(100, options.tangentScale ?? 1)) : 1;
  const sourceNormalDegree = Math.max(1, edgeDepth(source, options.sourceEdge) - 1);
  const targetNormalDegree = Math.max(1, edgeDepth(preparedTarget, options.targetEdge) - 1);
  const firstDerivativeScale = tangentScale * sourceNormalDegree / targetNormalDegree;
  const secondDerivativeScale = tangentScale * tangentScale * sourceNormalDegree * Math.max(1, sourceNormalDegree - 1) / (targetNormalDegree * Math.max(1, targetNormalDegree - 1));
  for (let index = 0; index < targetCount; index += 1) {
    const sourceIndex = options.reverse ? sourceCount - 1 - index : index;
    const boundary = clonePoint(edgePoint(source, options.sourceEdge, sourceIndex, 0));
    setEdgePoint(result, options.targetEdge, index, 0, boundary);
    if (requiredDepth < 2) continue;
    const sourceInner = edgePoint(source, options.sourceEdge, sourceIndex, 1);
    const tangent = scale(subtract(boundary, sourceInner), firstDerivativeScale);
    const targetInner = add(boundary, tangent);
    setEdgePoint(result, options.targetEdge, index, 1, targetInner);
    if (requiredDepth < 3) continue;
    const sourceSecond = edgePoint(source, options.sourceEdge, sourceIndex, 2);
    const sourceCurvature = scale(add(subtract(boundary, scale(sourceInner, 2)), sourceSecond), secondDerivativeScale);
    setEdgePoint(result, options.targetEdge, index, 2, add(add(sourceCurvature, scale(targetInner, 2)), scale(boundary, -1)));
  }
  return result;
};

export interface BSplineBoundaryMatchInput {
  sourceControlNet: Vec3[][];
  options: MatchBSplineBoundaryOptions;
}

export interface SolveBSplineSurfaceNetworkOptions {
  fairnessStrength?: number;
  iterations?: number;
}

const pointDistance = (left: Vec3, right: Vec3): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

/**
 * Applies several adjacent-surface relations as one transaction. Target pole
 * counts are adapted once and overlapping corner/derivative bands must agree.
 */
export const matchBSplineControlNetBoundaries = (target: Vec3[][], matches: readonly BSplineBoundaryMatchInput[]): Vec3[][] => {
  const dimensions = validateBSplineControlNet(target);
  if (!matches.length) return target.map((row) => row.map(clonePoint));
  if (matches.length > 4) throw new Error("一张曲面最多只能关联四条边界。");
  const targetEdges = new Set<BSplineEdge>();
  let requestedRows: number | undefined, requestedCols: number | undefined;
  for (const match of matches) {
    validateBSplineControlNet(match.sourceControlNet);
    if (targetEdges.has(match.options.targetEdge)) throw new Error(`当前曲面的 ${match.options.targetEdge} 已有边界关联。`);
    targetEdges.add(match.options.targetEdge);
    if (!match.options.adaptTargetBoundaryCount) continue;
    const count = edgeLength(match.sourceControlNet, match.options.sourceEdge);
    if (match.options.targetEdge === "uMin" || match.options.targetEdge === "uMax") {
      if (requestedRows !== undefined && requestedRows !== count) throw new Error("U 侧两条关联要求不同的边界控制点数量，无法同时保持连续。");
      requestedRows = count;
    } else {
      if (requestedCols !== undefined && requestedCols !== count) throw new Error("V 侧两条关联要求不同的边界控制点数量，无法同时保持连续。");
      requestedCols = count;
    }
  }
  const prepared = requestedRows !== undefined || requestedCols !== undefined
    ? resampleBSplineControlNet(target, requestedRows ?? dimensions.rows, requestedCols ?? dimensions.cols)
    : target.map((row) => row.map(clonePoint));
  const result = prepared.map((row) => row.map(clonePoint));
  const assigned = new Map<string, Vec3>();
  for (const match of matches) {
    const proposal = matchBSplineControlNetBoundary(match.sourceControlNet, prepared, { ...match.options, adaptTargetBoundaryCount: false });
    const count = edgeLength(proposal, match.options.targetEdge);
    const depth = bsplineBoundaryRequiredDepth(match.options.continuity);
    for (let index = 0; index < count; index += 1) {
      for (let offset = 0; offset < depth; offset += 1) {
        const address = bsplineBoundaryPoleAddress(proposal, match.options.targetEdge, index, offset);
        const key = `${address.row}:${address.col}`;
        const point = proposal[address.row][address.col];
        const previous = assigned.get(key);
        const scale = Math.max(1, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z), previous ? Math.abs(previous.x) : 0, previous ? Math.abs(previous.y) : 0, previous ? Math.abs(previous.z) : 0);
        if (previous && pointDistance(previous, point) > scale * 1e-8) throw new Error(`边界关联在控制点 R${address.row + 1}C${address.col + 1} 产生冲突，请调整边界方向或连续性。`);
        assigned.set(key, clonePoint(point));
      }
    }
  }
  for (const [key, point] of assigned) {
    const [row, col] = key.split(":").map(Number);
    result[row][col] = point;
  }
  return result;
};

/**
 * Actively solves a multi-edge surface network. Boundary position/tangent/
 * curvature bands are imposed first, then only unconstrained interior poles
 * are relaxed. Opposite G2 bands automatically receive enough pole columns so
 * they never overwrite each other.
 */
export const solveBSplineSurfaceNetwork = (
  target: Vec3[][],
  matches: readonly BSplineBoundaryMatchInput[],
  options: SolveBSplineSurfaceNetworkOptions = {},
): Vec3[][] => {
  const dimensions = validateBSplineControlNet(target);
  if (!matches.length) return target.map((row) => row.map(clonePoint));
  const depth = (edge: BSplineEdge): number => matches.filter((match) => match.options.targetEdge === edge).reduce((value, match) => Math.max(value, bsplineBoundaryRequiredDepth(match.options.continuity)), 0);
  const requestedRows = Math.max(dimensions.rows, depth("vMin") + depth("vMax") + (depth("vMin") && depth("vMax") ? 1 : 0));
  const requestedCols = Math.max(dimensions.cols, depth("uMin") + depth("uMax") + (depth("uMin") && depth("uMax") ? 1 : 0));
  let result = matchBSplineControlNetBoundaries(
    requestedRows === dimensions.rows && requestedCols === dimensions.cols ? target : resampleBSplineControlNet(target, requestedRows, requestedCols),
    matches.map((match) => ({ ...match, options: { ...match.options, allowDifferentNormalDepth: true } })),
  );
  if (result.length < depth("vMin") + depth("vMax") || result[0].length < depth("uMin") + depth("uMax")) {
    throw new Error("边界点数对齐后，连续性控制带发生重叠；请增加基准曲面的控制线后重新匹配。");
  }
  const locked = new Set<string>();
  for (const match of matches) {
    const count = edgeLength(result, match.options.targetEdge);
    const band = bsplineBoundaryRequiredDepth(match.options.continuity);
    for (let index = 0; index < count; index += 1) for (let offset = 0; offset < band; offset += 1) {
      const address = bsplineBoundaryPoleAddress(result, match.options.targetEdge, index, offset);
      locked.add(`${address.row}:${address.col}`);
    }
  }
  const strength = Number.isFinite(options.fairnessStrength) ? Math.max(0, Math.min(1, options.fairnessStrength ?? .35)) : .35;
  const iterations = Number.isFinite(options.iterations) ? Math.max(0, Math.min(50, Math.round(options.iterations ?? 6))) : 6;
  for (let pass = 0; pass < iterations; pass += 1) {
    const current = result;
    result = current.map((row, r) => row.map((point, c) => {
      if (locked.has(`${r}:${c}`)) return clonePoint(point);
      const neighbors = [r > 0 ? current[r - 1][c] : undefined, r + 1 < current.length ? current[r + 1][c] : undefined, c > 0 ? current[r][c - 1] : undefined, c + 1 < row.length ? current[r][c + 1] : undefined].filter((entry): entry is Vec3 => Boolean(entry));
      if (!neighbors.length) return clonePoint(point);
      const average = scale(neighbors.reduce(add, { x: 0, y: 0, z: 0 }), 1 / neighbors.length);
      return add(scale(point, 1 - strength), scale(average, strength));
    }));
  }
  return result;
};

export const moveBSplineControlPointSoft = (
  controlNet: Vec3[][],
  row: number,
  col: number,
  delta: Vec3,
  radius = 1,
): Vec3[][] => {
  const dimensions = validateBSplineControlNet(controlNet);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= dimensions.rows || col < 0 || col >= dimensions.cols) throw new Error("软选择中心控制点超出控制网范围。");
  if (![delta.x, delta.y, delta.z, radius].every(Number.isFinite) || radius < 0) throw new Error("软选择位移和半径必须是有效数值。");
  const effectiveRadius = Math.max(0, radius);
  return controlNet.map((items, r) => items.map((point, c) => {
    const distance = Math.hypot(r - row, c - col);
    if (distance > effectiveRadius) return clonePoint(point);
    const weight = effectiveRadius <= 1e-12 ? (distance <= 1e-12 ? 1 : 0) : .5 + .5 * Math.cos(Math.PI * distance / (effectiveRadius + 1e-12));
    return add(point, scale(delta, weight));
  }));
};

/** Moves a complete editable isoparametric control line without changing its neighboring lines. */
export const translateBSplineIsoLine = (controlNet: Vec3[][], direction: BSplineDirection, index: number, delta: Vec3): Vec3[][] => {
  const { rows, cols } = validateBSplineControlNet(controlNet);
  const count = direction === "u" ? cols : rows;
  if (!Number.isInteger(index) || index < 0 || index >= count || ![delta.x, delta.y, delta.z].every(Number.isFinite)) throw new Error("等参控制线索引或位移无效。");
  return controlNet.map((row, r) => row.map((point, c) => direction === "u" ? (c === index ? add(point, delta) : clonePoint(point)) : (r === index ? add(point, delta) : clonePoint(point))));
};

/** Adds one naturally extrapolated boundary row/column (zero second difference). */
export const extendBSplineControlNet = (controlNet: Vec3[][], edge: BSplineEdge, factor = 1): Vec3[][] => {
  const { rows, cols } = validateBSplineControlNet(controlNet);
  if ((edge.startsWith("u") ? cols : rows) >= 64) throw new Error("单方向最多支持 64 条控制线，无法继续延伸。");
  if (!Number.isFinite(factor) || factor <= 0 || factor > 10) throw new Error("曲面延伸比例必须在 0～10 之间。");
  const extrapolate = (boundary: Vec3, inner: Vec3): Vec3 => add(boundary, scale(subtract(boundary, inner), factor));
  if (edge === "uMin") return controlNet.map((row) => [extrapolate(row[0], row[1]), ...row.map(clonePoint)]);
  if (edge === "uMax") return controlNet.map((row) => [...row.map(clonePoint), extrapolate(row[cols - 1], row[cols - 2])]);
  const boundary = edge === "vMin" ? controlNet[0] : controlNet[rows - 1];
  const inner = edge === "vMin" ? controlNet[1] : controlNet[rows - 2];
  const extension = boundary.map((point, col) => extrapolate(point, inner[col]));
  return edge === "vMin" ? [extension, ...controlNet.map((row) => row.map(clonePoint))] : [...controlNet.map((row) => row.map(clonePoint)), extension];
};

/** Removes one interior control line for local simplification. This is an intentional shape edit. */
export const reduceBSplineControlNet = (controlNet: Vec3[][], direction: BSplineDirection, index: number): Vec3[][] => {
  const { rows, cols } = validateBSplineControlNet(controlNet);
  const count = direction === "u" ? cols : rows;
  if (count <= 4) throw new Error("至少保留 4 条控制线，无法继续简化。");
  if (!Number.isInteger(index) || index <= 0 || index >= count - 1) throw new Error("只能移除内部控制线。");
  return direction === "u" ? controlNet.map((row) => row.filter((_, col) => col !== index).map(clonePoint)) : controlNet.filter((_, row) => row !== index).map((items) => items.map(clonePoint));
};
