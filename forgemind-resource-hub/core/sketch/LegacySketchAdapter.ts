import type { UUID, Vec2 } from "../cad/CadTypes.ts";
import type { SketchConstraint } from "./SketchConstraint.ts";
import type { SketchDimension } from "./SketchDimension.ts";
import type { SketchArc, SketchCircle, SketchEntity, SketchLine, SketchPointEntity, SketchSpline } from "./SketchEntity.ts";
import type { SketchPlane } from "./SketchPlane.ts";
import type { Sketch } from "./Sketch.ts";
import { LEGACY_SKETCH_CANVAS_SPAN_MM } from "./LegacySketchUnits.ts";

export type LegacySketchPlane = "top" | "front" | "right";
export type LegacySketchEntityKind = "line" | "circle" | "arc" | "spline" | "rectangle" | "construction" | "point";
export type LegacySketchConstraintKind = "horizontal" | "vertical" | "fixed";

export interface LegacySketchPoint {
  x: number;
  y: number;
}

/** Structural copy of the existing UI shape; no React or viewport import. */
export interface LegacySketchOutline {
  id: UUID;
  plane: LegacySketchPlane;
  points: readonly LegacySketchPoint[];
  kind?: LegacySketchEntityKind;
  construction?: boolean;
  constraints?: readonly LegacySketchConstraintKind[];
  feature?: unknown;
}

const POINT_EPSILON = 1e-9;

const legacyPointToVec2 = (point: LegacySketchPoint): Vec2 => ({
  x: (point.x - .5) * LEGACY_SKETCH_CANVAS_SPAN_MM,
  y: (.5 - point.y) * LEGACY_SKETCH_CANVAS_SPAN_MM,
});

const toSketchPlane = (plane: LegacySketchPlane): SketchPlane => {
  if (plane === "front") return { type: "XZ", offset: 0 };
  if (plane === "right") return { type: "YZ", offset: 0 };
  return { type: "XY", offset: 0 };
};

const sameLegacyPoint = (left: LegacySketchPoint, right: LegacySketchPoint): boolean =>
  Math.abs(left.x - right.x) <= POINT_EPSILON && Math.abs(left.y - right.y) <= POINT_EPSILON;

const isClosedLegacyPath = (points: readonly LegacySketchPoint[]): boolean =>
  points.length > 2 && sameLegacyPoint(points[0], points[points.length - 1]);

const finitePoints = (points: readonly LegacySketchPoint[]): LegacySketchPoint[] =>
  points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

const boundsFor = (points: readonly LegacySketchPoint[]) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const rectangleEntities = (legacy: LegacySketchOutline, construction: boolean): SketchLine[] => {
  const points = finitePoints(legacy.points);
  const corners = points.length >= 4 ? points.slice(0, 4) : [];
  if (corners.length !== 4) return [];
  return corners.map((corner, index) => ({
    id: `${legacy.id}:line:${index}`,
    type: "line" as const,
    start: legacyPointToVec2(corner),
    end: legacyPointToVec2(corners[(index + 1) % corners.length]),
    construction,
  }));
};

const circleEntity = (legacy: LegacySketchOutline, construction: boolean): SketchCircle | null => {
  const points = finitePoints(legacy.points);
  if (points.length < 2) return null;
  const bounds = boundsFor(points);
  const center = legacyPointToVec2({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
  const radius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * LEGACY_SKETCH_CANVAS_SPAN_MM / 2;
  return radius > 0 ? { id: `${legacy.id}:circle`, type: "circle", center, radius, construction } : null;
};

const arcEntity = (legacy: LegacySketchOutline, construction: boolean): SketchArc | null => {
  const points = finitePoints(legacy.points);
  if (points.length < 2) return null;
  const bounds = boundsFor(points);
  // The current Legacy arc tool samples a semicircle from its right endpoint
  // through the upper canvas half to the left endpoint. This reverses that
  // canvas Y axis into the CAD domain's Y-up coordinate system.
  const center = legacyPointToVec2({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY });
  const radius = Math.max((bounds.maxX - bounds.minX) / 2, bounds.maxY - bounds.minY) * LEGACY_SKETCH_CANVAS_SPAN_MM;
  if (radius <= 0) return null;
  const start = legacyPointToVec2(points[0]);
  const end = legacyPointToVec2(points[points.length - 1]);
  return {
    id: `${legacy.id}:arc`,
    type: "arc",
    center,
    radius,
    startAngle: Math.atan2(start.y - center.y, start.x - center.x),
    endAngle: Math.atan2(end.y - center.y, end.x - center.x),
    construction,
  };
};

const singleLineEntity = (legacy: LegacySketchOutline, construction: boolean): SketchLine | null => {
  const points = finitePoints(legacy.points);
  if (points.length < 2) return null;
  return {
    id: `${legacy.id}:${legacy.kind === "construction" ? "construction" : "line"}`,
    type: "line",
    start: legacyPointToVec2(points[0]),
    end: legacyPointToVec2(points[1]),
    construction,
  };
};

const splineEntity = (legacy: LegacySketchOutline, construction: boolean): SketchSpline | null => {
  const points = finitePoints(legacy.points);
  if (!points.length) return null;
  return {
    id: `${legacy.id}:spline`,
    type: "spline",
    controlPoints: points.map(legacyPointToVec2),
    closed: isClosedLegacyPath(points),
    construction,
  };
};

const pointEntity = (legacy: LegacySketchOutline, construction: boolean): SketchPointEntity | null => {
  const point = finitePoints(legacy.points)[0];
  return point ? { id: `${legacy.id}:point`, type: "point", position: legacyPointToVec2(point), construction } : null;
};

const entityIdsFor = (entities: readonly SketchEntity[]): UUID[] => entities.map((entity) => entity.id);

const constraintsFor = (legacy: LegacySketchOutline, entityIds: UUID[]): Record<UUID, SketchConstraint> =>
  (legacy.constraints ?? []).reduce<Record<UUID, SketchConstraint>>((constraints, type) => {
    constraints[`${legacy.id}:constraint:${type}`] = {
      id: `${legacy.id}:constraint:${type}`,
      type,
      entityIds: [...entityIds],
      enabled: true,
    };
    return constraints;
  }, {});

const dimensionsFor = (legacy: LegacySketchOutline, entities: readonly SketchEntity[]): Record<UUID, SketchDimension> => {
  const dimensions: Record<UUID, SketchDimension> = {};
  const add = (suffix: string, dimension: Omit<SketchDimension, "id">) => {
    dimensions[`${legacy.id}:dimension:${suffix}`] = { id: `${legacy.id}:dimension:${suffix}`, ...dimension };
  };
  const entityIds = entityIdsFor(entities);
  if (!entityIds.length) return dimensions;
  if ((legacy.kind ?? "spline") === "rectangle" && entities.length === 4) {
    const first = entities[0] as SketchLine;
    const second = entities[1] as SketchLine;
    add("width", { type: "horizontalDistance", entityIds: [first.id], value: Math.abs(first.end.x - first.start.x), driving: true, name: "width" });
    add("height", { type: "verticalDistance", entityIds: [second.id], value: Math.abs(second.end.y - second.start.y), driving: true, name: "height" });
  } else if (entities[0].type === "circle") {
    add("diameter", { type: "diameter", entityIds, value: entities[0].radius * 2, driving: true, name: "diameter" });
  } else if (entities[0].type === "arc") {
    add("radius", { type: "radius", entityIds, value: entities[0].radius, driving: true, name: "radius" });
  } else if (entities[0].type === "line") {
    const line = entities[0];
    add("length", { type: "distance", entityIds, value: Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y), driving: true, name: "length" });
  }
  return dimensions;
};

/**
 * Converts one current Legacy SketchOutline to a pure domain sketch. It never
 * mutates the input and deliberately ignores Legacy feature data.
 */
export const legacySketchToDomain = (legacy: LegacySketchOutline): Sketch => {
  const kind = legacy.kind ?? "spline";
  const construction = Boolean(legacy.construction) || kind === "construction";
  const entities: SketchEntity[] = kind === "rectangle"
    ? rectangleEntities(legacy, construction)
    : kind === "circle"
      ? [circleEntity(legacy, construction)].filter((entity): entity is SketchCircle => Boolean(entity))
      : kind === "arc"
        ? [arcEntity(legacy, construction)].filter((entity): entity is SketchArc => Boolean(entity))
        : kind === "line" || kind === "construction"
          ? [singleLineEntity(legacy, construction)].filter((entity): entity is SketchLine => Boolean(entity))
          : kind === "point"
            ? [pointEntity(legacy, construction)].filter((entity): entity is SketchPointEntity => Boolean(entity))
            : [splineEntity(legacy, construction)].filter((entity): entity is SketchSpline => Boolean(entity));
  const entityRecord = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
  const entityIds = entityIdsFor(entities);

  return {
    id: legacy.id,
    name: `Sketch ${legacy.id}`,
    plane: toSketchPlane(legacy.plane),
    entities: entityRecord,
    entityOrder: entityIds,
    constraints: constraintsFor(legacy, entityIds),
    dimensions: dimensionsFor(legacy, entities),
  };
};
