import type { Vec2 } from "../cad/CadTypes.ts";
import { NURBS_PARAMETER_TOLERANCE, nurbsParameterTolerance } from "./NurbsTolerance.ts";

export { NURBS_PARAMETER_TOLERANCE } from "./NurbsTolerance.ts";

export interface RationalNurbsCurve2D {
  degree: number;
  rational?: boolean;
  periodic: boolean;
  knots: number[];
  multiplicities: number[];
  controlPoints: Vec2[];
  weights: number[];
  firstParameter: number;
  lastParameter: number;
}

export interface NurbsCurveSamplingOptions {
  /** Maximum allowed midpoint-to-chord error in sketch units (millimetres). */
  chordTolerance?: number;
  minSegments?: number;
  maxSegments?: number;
  maxDepth?: number;
}

export interface CompiledNurbsCurve2D {
  firstParameter: number;
  lastParameter: number;
  evaluate: (parameter: number) => Vec2;
  evaluateTangent: (parameter: number) => Vec2;
}

export interface ClosestNurbsCurvePoint2D { parameter: number; point: Vec2; distance: number; }

const finitePoint = (point: Vec2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

export const expandedNurbsKnots = (knots: number[], multiplicities: number[]): number[] => {
  if (knots.length !== multiplicities.length) throw new Error("NURBS knot and multiplicity counts differ.");
  return knots.flatMap((knot, index) => {
    const count = multiplicities[index];
    if (!Number.isInteger(count) || count <= 0) throw new Error("NURBS knot multiplicities must be positive integers.");
    return Array.from({ length: count }, () => knot);
  });
};

export const validateNurbsCurve2D = (curve: RationalNurbsCurve2D): void => {
  const { degree, knots, multiplicities, controlPoints, weights, firstParameter, lastParameter } = curve;
  if (!Number.isInteger(degree) || degree < 1 || degree > 25 || controlPoints.length < degree + 1) throw new Error("NURBS degree or control-point count is invalid.");
  if (!controlPoints.every(finitePoint) || weights.length !== controlPoints.length || !weights.every((weight) => Number.isFinite(weight) && weight > 0)) throw new Error("NURBS control points or weights are invalid.");
  if (curve.rational === false && weights.some((weight) => Math.abs(weight - 1) > NURBS_PARAMETER_TOLERANCE)) throw new Error("A non-rational NURBS curve must use unit weights.");
  if (!knots.length || knots.length !== multiplicities.length || !knots.every(Number.isFinite)) throw new Error("NURBS knots must be finite and match their multiplicities.");
  const knotTolerance = nurbsParameterTolerance(knots[0], knots.at(-1)!);
  if (knots.some((knot, index) => index > 0 && knot - knots[index - 1] <= knotTolerance)) throw new Error("NURBS knots must be strictly increasing and separated by the parameter tolerance.");
  if (multiplicities.some((value, index) => !Number.isInteger(value) || value < 1 || value > degree + (curve.periodic ? 0 : index === 0 || index === multiplicities.length - 1 ? 1 : 0))) throw new Error("NURBS knot multiplicity exceeds the degree boundary.");
  if (curve.periodic && multiplicities[0] !== multiplicities.at(-1)) throw new Error("Periodic NURBS endpoint multiplicities must agree.");
  const expanded = expandedNurbsKnots(knots, multiplicities);
  if ((!curve.periodic && expanded.length !== controlPoints.length + degree + 1)
    || (curve.periodic && multiplicities.slice(0, -1).reduce((sum, value) => sum + value, 0) !== controlPoints.length)) throw new Error("NURBS knot vector does not match its degree and control points.");
  const domainStart = curve.periodic ? knots[0] : expanded[degree];
  const domainEnd = curve.periodic ? knots.at(-1)! : expanded[controlPoints.length];
  const domainTolerance = nurbsParameterTolerance(domainStart, domainEnd);
  if (!Number.isFinite(firstParameter) || !Number.isFinite(lastParameter) || lastParameter - firstParameter <= domainTolerance || firstParameter < domainStart - domainTolerance || lastParameter > domainEnd + domainTolerance) throw new Error("NURBS edge parameter range must have a positive span inside its curve domain.");
};

const findSpan = (knots: number[], degree: number, controlPointCount: number, parameter: number, tolerance: number): number => {
  const last = controlPointCount - 1;
  if (parameter >= knots[last + 1] - tolerance) return last;
  let low = degree;
  let high = last + 1;
  let middle = Math.floor((low + high) / 2);
  while (parameter < knots[middle] || parameter >= knots[middle + 1]) {
    if (parameter < knots[middle]) high = middle;
    else low = middle;
    middle = Math.floor((low + high) / 2);
  }
  return middle;
};

type HomogeneousPoint = { x: number; y: number; w: number };
type HomogeneousJet = HomogeneousPoint & { dx: number; dy: number; dw: number };
const deBoor = (degree: number, knots: number[], span: number, parameter: number, source: HomogeneousPoint[], tolerance: number): { point: Vec2; tangent: Vec2 } => {
  const work: HomogeneousJet[] = source.map((point) => ({ ...point, dx: 0, dy: 0, dw: 0 }));
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const knotIndex = span - degree + index;
      const denominator = knots[knotIndex + degree - level + 1] - knots[knotIndex];
      const alpha = Math.abs(denominator) <= tolerance ? 0 : (parameter - knots[knotIndex]) / denominator;
      const alphaDerivative = Math.abs(denominator) <= tolerance ? 0 : 1 / denominator;
      const left = work[index - 1]; const right = work[index];
      work[index] = {
        x: (1 - alpha) * left.x + alpha * right.x,
        y: (1 - alpha) * left.y + alpha * right.y,
        w: (1 - alpha) * left.w + alpha * right.w,
        dx: (1 - alpha) * left.dx + alpha * right.dx + alphaDerivative * (right.x - left.x),
        dy: (1 - alpha) * left.dy + alpha * right.dy + alphaDerivative * (right.y - left.y),
        dw: (1 - alpha) * left.dw + alpha * right.dw + alphaDerivative * (right.w - left.w),
      };
    }
  }
  const result = work[degree];
  if (Math.abs(result.w) <= tolerance) throw new Error("NURBS evaluation produced a zero homogeneous weight.");
  const weightSquared = result.w * result.w;
  return {
    point: { x: result.x / result.w, y: result.y / result.w },
    tangent: { x: (result.dx * result.w - result.x * result.dw) / weightSquared, y: (result.dy * result.w - result.y * result.dw) / weightSquared },
  };
};

/** Validates and expands the curve once, then returns a reusable exact evaluator. */
export const compileNurbsCurve2D = (curve: RationalNurbsCurve2D): CompiledNurbsCurve2D => {
  validateNurbsCurve2D(curve);
  const tolerance = nurbsParameterTolerance(curve.knots[0], curve.knots.at(-1)!);
  const homogeneous = curve.controlPoints.map((point, index) => ({ x: point.x * curve.weights[index], y: point.y * curve.weights[index], w: curve.weights[index] }));
  if (!curve.periodic) {
    const fullKnots = expandedNurbsKnots(curve.knots, curve.multiplicities);
    const evaluateJet = (parameter: number) => {
      const u = Math.min(curve.lastParameter, Math.max(curve.firstParameter, parameter));
      const span = findSpan(fullKnots, curve.degree, curve.controlPoints.length, u, tolerance);
      return deBoor(curve.degree, fullKnots, span, u, Array.from({ length: curve.degree + 1 }, (_, index) => homogeneous[span - curve.degree + index]), tolerance);
    };
    return {
      firstParameter: curve.firstParameter,
      lastParameter: curve.lastParameter,
      evaluate: (parameter) => evaluateJet(parameter).point,
      evaluateTangent: (parameter) => evaluateJet(parameter).tangent,
    };
  }

  const periodStart = curve.knots[0];
  const periodEnd = curve.knots.at(-1)!;
  const period = periodEnd - periodStart;
  if (period <= tolerance) throw new Error("Periodic NURBS requires a positive parameter period.");
  const onePeriod = curve.knots.slice(0, -1).flatMap((knot, index) => Array.from({ length: curve.multiplicities[index] }, () => knot));
  const fullKnots = [-2, -1, 0, 1, 2].flatMap((cycle) => onePeriod.map((knot) => knot + cycle * period));
  const phase = curve.degree - curve.multiplicities[0] + 1;
  const modulo = (value: number, count: number) => (value % count + count) % count;
  const evaluateJet = (parameter: number) => {
    const bounded = Math.min(curve.lastParameter, Math.max(curve.firstParameter, parameter));
    const u = bounded >= periodEnd - tolerance ? periodStart : periodStart + ((bounded - periodStart) % period + period) % period;
    let low = 0; let high = fullKnots.length;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (fullKnots[middle] <= u) low = middle + 1; else high = middle; }
    const span = low - 1;
    if (span < curve.degree) throw new Error("Periodic NURBS parameter span is unavailable.");
    const source = Array.from({ length: curve.degree + 1 }, (_, index) => homogeneous[modulo(span - curve.degree + index + phase, homogeneous.length)]);
    return deBoor(curve.degree, fullKnots, span, u, source, tolerance);
  };
  return {
    firstParameter: curve.firstParameter,
    lastParameter: curve.lastParameter,
    evaluate: (parameter) => evaluateJet(parameter).point,
    evaluateTangent: (parameter) => evaluateJet(parameter).tangent,
  };
};

/** Exact homogeneous de Boor evaluation. */
export const evaluateNurbsCurve2D = (curve: RationalNurbsCurve2D, parameter: number): Vec2 => compileNurbsCurve2D(curve).evaluate(parameter);

/** Computes both trimmed endpoints from one compiled curve definition. */
export const nurbsCurveEndpoints2D = (curve: RationalNurbsCurve2D): { start: Vec2; end: Vec2 } => {
  const compiled = compileNurbsCurve2D(curve);
  return { start: compiled.evaluate(curve.firstParameter), end: compiled.evaluate(curve.lastParameter) };
};

/** Finds a stable persistent curve parameter for cursor snapping. */
const closestPointCompiledCache = new WeakMap<object, CompiledNurbsCurve2D>();
export const closestNurbsCurvePoint2D = (curve: RationalNurbsCurve2D, target: Vec2, coarseSegments = 64): ClosestNurbsCurvePoint2D => {
  if (!finitePoint(target)) throw new Error("NURBS closest-point target must be finite.");
  let compiled=closestPointCompiledCache.get(curve);
  if(!compiled){compiled=compileNurbsCurve2D(curve);closestPointCompiledCache.set(curve,compiled);}
  const count = Math.max(16, Math.min(256, Math.floor(coarseSegments)));
  const parameters = [curve.firstParameter, curve.lastParameter, ...curve.knots.filter((knot) => knot > curve.firstParameter && knot < curve.lastParameter), ...Array.from({ length: count - 1 }, (_, index) => curve.firstParameter + (curve.lastParameter - curve.firstParameter) * (index + 1) / count)]
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value - values[index - 1] > nurbsParameterTolerance(curve.firstParameter, curve.lastParameter));
  const squaredDistance = (parameter: number): number => { const point = compiled.evaluate(parameter); const dx = point.x - target.x; const dy = point.y - target.y; return dx * dx + dy * dy; };
  let bestIndex = 0; let bestDistance = Infinity;
  parameters.forEach((parameter, index) => { const distance = squaredDistance(parameter); if (distance < bestDistance) { bestDistance = distance; bestIndex = index; } });
  let low = parameters[Math.max(0, bestIndex - 1)]; let high = parameters[Math.min(parameters.length - 1, bestIndex + 1)];
  const golden = (Math.sqrt(5) - 1) / 2;
  let left = high - (high - low) * golden; let right = low + (high - low) * golden;
  let leftDistance = squaredDistance(left); let rightDistance = squaredDistance(right);
  for (let iteration = 0; iteration < 28; iteration += 1) {
    if (leftDistance <= rightDistance) { high = right; right = left; rightDistance = leftDistance; left = high - (high - low) * golden; leftDistance = squaredDistance(left); }
    else { low = left; left = right; leftDistance = rightDistance; right = low + (high - low) * golden; rightDistance = squaredDistance(right); }
  }
  const candidates = [parameters[bestIndex], (low + high) / 2, curve.firstParameter, curve.lastParameter];
  const parameter = candidates.reduce((best, candidate) => squaredDistance(candidate) < squaredDistance(best) ? candidate : best, candidates[0]);
  const point = compiled.evaluate(parameter);
  return { parameter, point, distance: Math.hypot(point.x - target.x, point.y - target.y) };
};

const pointToChordDistance = (point: Vec2, start: Vec2, end: Vec2): number => {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
};

/** Curvature-adaptive display sampling; the persisted exact curve is untouched. */
export const sampleNurbsCurve2D = (curve: RationalNurbsCurve2D, options: number | NurbsCurveSamplingOptions = {}): Vec2[] => {
  const compiled = compileNurbsCurve2D(curve);
  if (typeof options === "number") {
    const count = Math.max(8, Math.floor(options));
    return Array.from({ length: count + 1 }, (_, index) => compiled.evaluate(curve.firstParameter + (curve.lastParameter - curve.firstParameter) * index / count));
  }
  const chordTolerance = options.chordTolerance ?? .12;
  const minSegments = Math.max(1, Math.floor(options.minSegments ?? 8));
  const maxSegments = Math.max(minSegments, Math.floor(options.maxSegments ?? 512));
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 10));
  if (!Number.isFinite(chordTolerance) || chordTolerance <= 0) throw new Error("NURBS display tolerance must be positive.");
  const span = curve.lastParameter - curve.firstParameter;
  const seeds = [curve.firstParameter, curve.lastParameter, ...curve.knots.filter((knot) => knot > curve.firstParameter && knot < curve.lastParameter), ...Array.from({ length: minSegments - 1 }, (_, index) => curve.firstParameter + span * (index + 1) / minSegments)]
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value - values[index - 1] > nurbsParameterTolerance(curve.firstParameter, curve.lastParameter));
  const cache = new Map<number, Vec2>();
  const pointAt = (parameter: number): Vec2 => { const existing = cache.get(parameter); if (existing) return existing; const point = compiled.evaluate(parameter); cache.set(parameter, point); return point; };
  const points: Vec2[] = [pointAt(seeds[0])];
  const refine = (startParameter: number, start: Vec2, endParameter: number, end: Vec2, depth: number): void => {
    if (points.length >= maxSegments || depth >= maxDepth) { points.push(end); return; }
    const interval = endParameter - startParameter;
    const quarterParameter = startParameter + interval * .25; const middleParameter = startParameter + interval * .5; const threeQuarterParameter = startParameter + interval * .75;
    const quarter = pointAt(quarterParameter); const middle = pointAt(middleParameter); const threeQuarter = pointAt(threeQuarterParameter);
    const error = Math.max(pointToChordDistance(quarter, start, end), pointToChordDistance(middle, start, end), pointToChordDistance(threeQuarter, start, end));
    if (error <= chordTolerance) { points.push(end); return; }
    refine(startParameter, start, middleParameter, middle, depth + 1);
    refine(middleParameter, middle, endParameter, end, depth + 1);
  };
  for (let index = 0; index < seeds.length - 1 && points.length <= maxSegments; index += 1) refine(seeds[index], pointAt(seeds[index]), seeds[index + 1], pointAt(seeds[index + 1]), 0);
  return points.slice(0, maxSegments + 1);
};
