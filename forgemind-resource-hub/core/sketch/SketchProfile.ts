import type { UUID, Vec2 } from "../cad/CadTypes.ts";
import type { Sketch } from "./Sketch.ts";
import type { SketchArc, SketchBSpline, SketchCircle, SketchLine } from "./SketchEntity.ts";

export interface ProfileSegmentLine {
  type: "line";
  start: [number, number];
  end: [number, number];
}

/** Exact circular arc. Angles are degrees in the CAD profile boundary. */
export interface ProfileSegmentArc {
  type: "arc";
  center: [number, number];
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  /** False means counter-clockwise; this preserves source geometry when a chain is reversed. */
  clockwise?: boolean;
}

/** Exact full circle with no start/end ambiguity. */
export interface ProfileSegmentCircle {
  type: "circle";
  center: [number, number];
  radius: number;
}

/** Exact native interpolation B-Spline. Periodic segments are closed by OCCT,
 * while fit points remain the persisted design intent. */
export interface ProfileSegmentBSpline {
  type: "bspline";
  fitPoints: Array<[number, number]>;
  periodic: boolean;
  startTangent?: [number, number];
  endTangent?: [number, number];
  /** Exact authored NURBS basis. fitPoints are the control poles when this is
   * present; absence retains the interpolation B-Spline path. */
  nurbs?: {
    degree: number;
    knots: number[];
    multiplicities: number[];
    weights: number[];
    firstParameter: number;
    lastParameter: number;
  };
}

export type ProfileSegment = ProfileSegmentLine | ProfileSegmentArc | ProfileSegmentCircle | ProfileSegmentBSpline;

export interface ClosedProfile {
  id: UUID;
  outer: ProfileSegment[];
  holes: ProfileSegment[][];
}

export interface OpenProfileChain {
  id: UUID;
  entityIds: UUID[];
  segments: ProfileSegment[];
  reason: "open" | "unsupported-spline";
}

export interface ProfileBuildResult {
  profiles: ClosedProfile[];
  openChains: OpenProfileChain[];
  warnings: string[];
}

const PROFILE_EPSILON = 1e-6;
const RADIANS_TO_DEGREES = 180 / Math.PI;

const isSamePoint = (left: Vec2, right: Vec2): boolean =>
  Math.abs(left.x - right.x) <= PROFILE_EPSILON
  && Math.abs(left.y - right.y) <= PROFILE_EPSILON;

const pointAt = (center: [number, number], radius: number, angleDeg: number): Vec2 => {
  const angle = angleDeg / RADIANS_TO_DEGREES;
  return { x: center[0] + radius * Math.cos(angle), y: center[1] + radius * Math.sin(angle) };
};

const arcEndpoints = (arc: ProfileSegmentArc): { start: Vec2; end: Vec2 } => ({
  start: pointAt(arc.center, arc.radius, arc.startAngleDeg),
  end: pointAt(arc.center, arc.radius, arc.endAngleDeg),
});

const lineSegment = (line: SketchLine, reversed = false): ProfileSegmentLine => reversed
  ? { type: "line", start: [line.end.x, line.end.y], end: [line.start.x, line.start.y] }
  : { type: "line", start: [line.start.x, line.start.y], end: [line.end.x, line.end.y] };

const arcSegment = (arc: SketchArc, reversed = false): ProfileSegmentArc => {
  const startAngleDeg = arc.startAngle * RADIANS_TO_DEGREES;
  const endAngleDeg = arc.endAngle * RADIANS_TO_DEGREES;
  return reversed
    ? { type: "arc", center: [arc.center.x, arc.center.y], radius: arc.radius, startAngleDeg: endAngleDeg, endAngleDeg: startAngleDeg, clockwise: true }
    : { type: "arc", center: [arc.center.x, arc.center.y], radius: arc.radius, startAngleDeg, endAngleDeg, clockwise: false };
};

const circleSegment = (circle: SketchCircle): ProfileSegmentCircle => ({
  type: "circle", center: [circle.center.x, circle.center.y], radius: circle.radius,
});

const bsplineSegment = (curve: SketchBSpline): ProfileSegmentBSpline => ({
  type: "bspline",
  fitPoints: curve.fitPoints.map((point) => [point.x, point.y]),
  periodic: curve.closed,
  startTangent: curve.startTangent ? [curve.startTangent.x, curve.startTangent.y] : undefined,
  endTangent: curve.endTangent ? [curve.endTangent.x, curve.endTangent.y] : undefined,
  nurbs: curve.nurbs ? {
    degree: curve.nurbs.degree,
    knots: [...curve.nurbs.knots],
    multiplicities: [...curve.nurbs.multiplicities],
    weights: [...curve.nurbs.weights],
    firstParameter: curve.nurbs.firstParameter,
    lastParameter: curve.nurbs.lastParameter,
  } : undefined,
});

type ChainEntity = { id: UUID; entity: SketchLine | SketchArc };
type OrientedCurve = { id: UUID; segment: ProfileSegmentLine | ProfileSegmentArc; start: Vec2; end: Vec2 };
type ExactLoop = { id: UUID; segments: ProfileSegment[]; entityIds: UUID[]; area: number; parent?: number; depth: number };

const orientEntity = (entry: ChainEntity, reversed: boolean): OrientedCurve => {
  const segment = entry.entity.type === "line" ? lineSegment(entry.entity, reversed) : arcSegment(entry.entity, reversed);
  const endpoints = segment.type === "line"
    ? { start: { x: segment.start[0], y: segment.start[1] }, end: { x: segment.end[0], y: segment.end[1] } }
    : arcEndpoints(segment);
  return { id: entry.id, segment, ...endpoints };
};

const buildCurveChains = (entries: ChainEntity[]): OrientedCurve[][] => {
  const remaining = [...entries];
  const chains: OrientedCurve[][] = [];
  while (remaining.length) {
    const first = remaining.shift();
    if (!first) break;
    const firstCurve = orientEntity(first, false);
    const chain = [firstCurve];
    let end = firstCurve.end;
    while (remaining.length) {
      const nextIndex = remaining.findIndex(({ entity }) => {
        const forward = orientEntity({ id: "probe", entity }, false);
        return isSamePoint(forward.start, end) || isSamePoint(forward.end, end);
      });
      if (nextIndex < 0) break;
      const [next] = remaining.splice(nextIndex, 1);
      const forward = orientEntity(next, false);
      const oriented = orientEntity(next, isSamePoint(forward.end, end));
      chain.push(oriented);
      end = oriented.end;
      if (isSamePoint(end, firstCurve.start)) break;
    }
    chains.push(chain);
  }
  return chains;
};


const arcSweepRad = (arc: ProfileSegmentArc): number => {
  let sweep = (arc.endAngleDeg - arc.startAngleDeg) / RADIANS_TO_DEGREES;
  if (arc.clockwise) { while (sweep >= 0) sweep -= Math.PI * 2; }
  else { while (sweep <= 0) sweep += Math.PI * 2; }
  return sweep;
};

/** Exact signed area for Line/Arc/Circle loops; used only for nesting/orientation decisions. */
export const profileLoopSignedArea = (segments: readonly ProfileSegment[]): number => segments.reduce((sum, segment) => {
  if (segment.type === "line") return sum + (segment.start[0] * segment.end[1] - segment.end[0] * segment.start[1]) / 2;
  if (segment.type === "circle") return sum + Math.PI * segment.radius * segment.radius;
  if (segment.type === "bspline") return sum + segment.fitPoints.reduce((area, point, index) => { const next = segment.fitPoints[(index + 1) % segment.fitPoints.length]; return area + (point[0] * next[1] - next[0] * point[1]) / 2; }, 0);
  const start = segment.startAngleDeg / RADIANS_TO_DEGREES;
  const sweep = arcSweepRad(segment);
  const end = start + sweep;
  const [cx, cy] = segment.center;
  const r = segment.radius;
  return sum + .5 * (r * cx * (Math.sin(end) - Math.sin(start)) - r * cy * (Math.cos(end) - Math.cos(start)) + r * r * sweep);
}, 0);

/**
 * Samples analytic loops only for containment classification. The returned
 * profile geometry remains exact Line/Arc/Circle data and is never replaced by
 * this polygon in the CAD kernel path.
 */
const sampleLoopForContainment = (segments: readonly ProfileSegment[]): Vec2[] => {
  const points: Vec2[] = [];
  for (const segment of segments) {
    if (segment.type === "line") {
      if (!points.length) points.push({ x: segment.start[0], y: segment.start[1] });
      points.push({ x: segment.end[0], y: segment.end[1] });
      continue;
    }
    if (segment.type === "circle") {
      for (let index = 0; index < 32; index += 1) {
        const angle = index / 32 * Math.PI * 2;
        points.push({ x: segment.center[0] + Math.cos(angle) * segment.radius, y: segment.center[1] + Math.sin(angle) * segment.radius });
      }
      continue;
    }
    if (segment.type === "bspline") {
      points.push(...segment.fitPoints.map(([x, y]) => ({ x, y })));
      continue;
    }
    const sweep = arcSweepRad(segment);
    const start = segment.startAngleDeg / RADIANS_TO_DEGREES;
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
    for (let index = points.length ? 1 : 0; index <= steps; index += 1) {
      const angle = start + sweep * index / steps;
      points.push({ x: segment.center[0] + Math.cos(angle) * segment.radius, y: segment.center[1] + Math.sin(angle) * segment.radius });
    }
  }
  if (points.length > 1 && isSamePoint(points[0], points[points.length - 1])) points.pop();
  return points;
};

const pointInPolygon = (point: Vec2, polygon: readonly Vec2[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const loopContainedBy = (inner: readonly ProfileSegment[], outer: readonly ProfileSegment[]): boolean => {
  const innerSamples = sampleLoopForContainment(inner);
  const outerPolygon = sampleLoopForContainment(outer);
  if (!innerSamples.length || outerPolygon.length < 3) return false;
  // Use several points instead of a centroid so concave exact loops are not
  // misclassified when their centroid happens to lie outside the region.
  const probes = innerSamples.filter((_, index) => index % Math.max(1, Math.floor(innerSamples.length / 7)) === 0).slice(0, 8);
  return probes.length > 0 && probes.filter((probe) => pointInPolygon(probe, outerPolygon)).length >= Math.ceil(probes.length * .75);
};

const groupNestedLoops = (loops: ExactLoop[]): ClosedProfile[] => {
  // Parent is the smallest enclosing loop. This creates a deterministic nesting
  // tree: even depth = material/profile island, odd depth = hole in its parent.
  loops.forEach((loop, index) => {
    const enclosing = loops
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate, candidateIndex }) => candidateIndex !== index && candidate.area > loop.area + PROFILE_EPSILON && loopContainedBy(loop.segments, candidate.segments))
      .sort((a, b) => a.candidate.area - b.candidate.area);
    loop.parent = enclosing[0]?.candidateIndex;
  });
  const depthOf = (index: number, seen = new Set<number>()): number => {
    if (seen.has(index)) return 0;
    seen.add(index);
    const parent = loops[index]?.parent;
    return parent === undefined ? 0 : 1 + depthOf(parent, seen);
  };
  loops.forEach((loop, index) => { loop.depth = depthOf(index); });

  return loops
    .map((loop, index) => ({ loop, index }))
    .filter(({ loop }) => loop.depth % 2 === 0)
    .map(({ loop, index }) => ({
      id: loop.id,
      outer: loop.segments,
      holes: loops
        .filter((candidate) => candidate.parent === index && candidate.depth === loop.depth + 1)
        .sort((a, b) => b.area - a.area)
        .map((candidate) => candidate.segments),
    }));
};

/**
 * Converts pure Sketch entities to exact profile primitives. Curves deliberately
 * remain curves: no line tessellation is used on the CAD profile path.
 *
 * V8 additionally builds a nesting tree so inner loops become true profile
 * holes instead of unrelated profiles. Sampling is used only to classify loop
 * containment; the kernel still receives the original exact analytic curves.
 */
export const buildSketchProfiles = (sketch: Sketch): ProfileBuildResult => {
  const openChains: OpenProfileChain[] = [];
  const warnings: string[] = [];
  const chainEntries: ChainEntity[] = [];
  const closedLoops: ExactLoop[] = [];

  for (const id of sketch.entityOrder) {
    const entity = sketch.entities[id];
    if (!entity || entity.construction) continue;
    if (entity.type === "circle") {
      const segments = [circleSegment(entity)];
      closedLoops.push({ id: `${sketch.id}:profile:${entity.id}`, segments, entityIds: [entity.id], area: Math.abs(profileLoopSignedArea(segments)), depth: 0 });
    } else if (entity.type === "line" || entity.type === "arc") {
      chainEntries.push({ id, entity });
    } else if (entity.type === "bspline") {
      const segment = bsplineSegment(entity);
      if (entity.closed) {
        const segments: ProfileSegment[] = [segment];
        closedLoops.push({ id: `${sketch.id}:profile:${entity.id}`, segments, entityIds: [entity.id], area: Math.abs(profileLoopSignedArea(segments)), depth: 0 });
      } else {
        openChains.push({ id: `${sketch.id}:open:${entity.id}`, entityIds: [entity.id], segments: [segment], reason: "open" });
        warnings.push(`Open B-Spline curve: ${entity.id}`);
      }
    } else if (entity.type === "spline") {
      const message = `Unsupported spline profile: ${entity.id}`;
      warnings.push(message);
      openChains.push({ id: `${sketch.id}:open:${entity.id}`, entityIds: [entity.id], segments: [], reason: "unsupported-spline" });
      if (entity.closed) warnings.push(`Spline ${entity.id} is closed but remains unsupported as a solid profile.`);
    }
  }

  buildCurveChains(chainEntries).forEach((chain, index) => {
    const segments = chain.map(({ segment }) => segment);
    const entityIds = chain.map(({ id }) => id);
    const first = chain[0];
    const last = chain[chain.length - 1];
    if (chain.length >= 2 && first && last && isSamePoint(first.start, last.end)) {
      closedLoops.push({ id: `${sketch.id}:profile:curve:${index}`, segments, entityIds, area: Math.abs(profileLoopSignedArea(segments)), depth: 0 });
      return;
    }
    openChains.push({ id: `${sketch.id}:open:curve:${index}`, entityIds, segments, reason: "open" });
    warnings.push(`Open curve chain: ${entityIds.join(", ")}`);
  });

  const measurable = closedLoops.filter((loop) => loop.area > PROFILE_EPSILON);
  if (measurable.length !== closedLoops.length) warnings.push("One or more closed sketch loops have zero/ambiguous area and were excluded from profile construction.");
  const profiles = groupNestedLoops(measurable);
  return { profiles, openChains, warnings };
};
