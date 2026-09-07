import { createCadDocument, type CadDocument } from "../cad/CadDocument.ts";
import { legacyPartToCadBody, type LegacyPartLike } from "../cad/LegacyCadAdapter.ts";
import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import { legacySketchToDomain, type LegacySketchEntityKind, type LegacySketchOutline, type LegacySketchPlane } from "../sketch/LegacySketchAdapter.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { ExtrudeFeature } from "./ExtrudeFeature.ts";
import type { Feature } from "./Feature.ts";
import { normalizedFeatureState } from "./FeatureState.ts";
import type { PatternFeature } from "./PatternFeature.ts";
import type { PocketFeature } from "./PocketFeature.ts";
import type { RevolveFeature } from "./RevolveFeature.ts";

export type LegacyFeatureOperation = "extrude" | "pocket" | "revolve";
export type LegacyPatternMode = "circular" | "linear";

/** Structural mirror of the legacy UI's embedded feature data. Length values are metres. */
export interface LegacyEmbeddedFeature {
  operation: LegacyFeatureOperation;
  depth: number;
  bevel: number;
  enabled: boolean;
  targetId?: UUID;
  angle?: number;
  patternCount?: number;
  patternAngle?: number;
  patternMode?: LegacyPatternMode;
  patternSpacing?: number;
}

export interface LegacyFeatureSketch extends Omit<LegacySketchOutline, "feature"> {
  plane: LegacySketchPlane;
  kind?: LegacySketchEntityKind;
  feature?: LegacyEmbeddedFeature;
}

export interface LegacyFeatureAdapterOptions {
  /** Legacy defaults are the existing React state defaults and are in metres. */
  sketchDepthM?: number;
  sketchBevelM?: number;
}

/** Data retained for audit only; Feature evaluation must never depend on it. */
export interface LegacyFeatureMetadata {
  sourceSketchId: UUID;
  bevelM?: number;
  storedDepthM?: number;
}

export interface LegacyFeatureAdapterResult {
  features: Record<UUID, Feature>;
  featureOrder: UUID[];
  legacyMetadata: Record<UUID, LegacyFeatureMetadata>;
  warnings: string[];
}

export interface LegacyFeatureProject {
  id: UUID;
  name: string;
  parts: readonly LegacyPartLike[];
  strokes: readonly LegacyFeatureSketch[];
  activePartId?: UUID;
  updatedAt?: number;
}

export type ForgeMindCadDocument = CadDocument<Sketch, Feature>;

const DEFAULT_SKETCH_DEPTH_M = 1;
const DEFAULT_SKETCH_BEVEL_M = .035;
const WORLD_Y_AXIS: Vec3 = { x: 0, y: 1, z: 0 };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

const metreToMillimetres = (value: number, fallbackM: number): number =>
  (Number.isFinite(value) && value > 0 ? value : fallbackM) * 1000;

const positiveDegrees = (value: number | undefined, fallback: number): number =>
  Math.max(.1, Math.min(360, Number.isFinite(value) ? value as number : fallback));

const positiveCount = (value: number | undefined): number =>
  Math.max(1, Math.min(24, Math.round(Number.isFinite(value) ? value as number : 1)));

const isClosedLegacyProfile = (kind: LegacySketchEntityKind | undefined): boolean =>
  ["rectangle", "circle", "spline"].includes(kind ?? "spline");

const operationFor = (sketch: LegacyFeatureSketch): LegacyFeatureOperation =>
  sketch.feature?.operation ?? "extrude";

export const featureIdForLegacySketch = (sketchId: UUID, operation: LegacyFeatureOperation): UUID =>
  `${sketchId}:${operation}`;

const featureNameFor = (operation: LegacyFeatureOperation, sketchId: UUID): string =>
  `${operation[0].toUpperCase()}${operation.slice(1)} ${sketchId}`;

const enabledFor = (feature: LegacyEmbeddedFeature | undefined): boolean => feature?.enabled !== false;

const legacyDirectionForSketchPlane = (plane: LegacySketchPlane): Vec3 => {
  if (plane === "right") return { x: 0, y: 0, z: -1 };
  return { x: 1, y: 0, z: 0 };
};

const legacyPlaneNormal = (plane: LegacySketchPlane): Vec3 => {
  if (plane === "top") return { x: 0, y: 1, z: 0 };
  if (plane === "right") return { x: 1, y: 0, z: 0 };
  return { x: 0, y: 0, z: 1 };
};

const baseFor = (sketch: LegacyFeatureSketch, operation: LegacyFeatureOperation) => {
  const enabled = enabledFor(sketch.feature);
  return {
    id: featureIdForLegacySketch(sketch.id, operation),
    name: featureNameFor(operation, sketch.id),
    enabled,
    state: normalizedFeatureState(enabled),
    dependencies: [] as UUID[],
  };
};

/**
 * Converts a single embedded Legacy feature. Missing Legacy operation defaults
 * to a positive, new-body extrusion because that is how the existing renderer
 * treats closed sketches without an explicit feature object.
 */
export const legacyFeatureToDomain = (
  sketch: LegacyFeatureSketch,
  options: LegacyFeatureAdapterOptions = {},
): ExtrudeFeature | PocketFeature | RevolveFeature => {
  const operation = operationFor(sketch);
  const base = baseFor(sketch, operation);
  const depthMm = metreToMillimetres(sketch.feature?.depth ?? options.sketchDepthM ?? DEFAULT_SKETCH_DEPTH_M, options.sketchDepthM ?? DEFAULT_SKETCH_DEPTH_M);
  if (operation === "pocket") {
    const targetFeatureId = sketch.feature?.targetId
      ? featureIdForLegacySketch(sketch.feature.targetId, "extrude")
      : undefined;
    return {
      ...base,
      type: "pocket",
      sketchId: sketch.id,
      targetFeatureId,
      dependencies: targetFeatureId ? [targetFeatureId] : [],
      // The legacy renderer adds holes to the target extrusion, so it has no
      // standalone blind depth even though an inherited depth value is stored.
      depth: { type: "throughAll" },
    };
  }
  if (operation === "revolve") {
    return {
      ...base,
      type: "revolve",
      sketchId: sketch.id,
      axis: { origin: { ...ORIGIN }, direction: { ...WORLD_Y_AXIS } },
      angleDeg: positiveDegrees(sketch.feature?.angle, 360),
      operation: "new",
    };
  }
  return {
    ...base,
    type: "extrude",
    sketchId: sketch.id,
    distance: depthMm,
    direction: "positive",
    operation: "new",
  };
};

const patternForLegacyPocket = (sketch: LegacyFeatureSketch, sourceFeatureId: UUID): PatternFeature | null => {
  const feature = sketch.feature;
  if (operationFor(sketch) !== "pocket" || !feature || positiveCount(feature.patternCount) < 2) return null;
  const id = `${sourceFeatureId}:pattern`;
  const enabled = enabledFor(feature);
  const count = positiveCount(feature.patternCount);
  const definition = feature.patternMode === "linear"
    ? {
        type: "linear" as const,
        direction: legacyDirectionForSketchPlane(sketch.plane),
        count,
        spacing: metreToMillimetres(feature.patternSpacing ?? .2, .2),
      }
    : {
        type: "circular" as const,
        axis: { origin: { ...ORIGIN }, direction: legacyPlaneNormal(sketch.plane) },
        count,
        angleDeg: positiveDegrees(feature.patternAngle, 360),
      };
  return {
    id,
    name: `Pattern ${sketch.id}`,
    type: "pattern",
    enabled,
    state: normalizedFeatureState(enabled),
    sourceFeatureIds: [sourceFeatureId],
    dependencies: [sourceFeatureId],
    definition,
  };
};

/** Extracts independent, deterministically named Features from Legacy strokes. */
export const adaptLegacyFeatures = (
  sketches: readonly LegacyFeatureSketch[],
  options: LegacyFeatureAdapterOptions = {},
): LegacyFeatureAdapterResult => {
  const features: Record<UUID, Feature> = {};
  const featureOrder: UUID[] = [];
  const legacyMetadata: Record<UUID, LegacyFeatureMetadata> = {};
  const warnings: string[] = [];
  const availableSketchIds = new Set(sketches.map((sketch) => sketch.id));

  sketches.forEach((sketch) => {
    if (!isClosedLegacyProfile(sketch.kind)) return;
    const feature = legacyFeatureToDomain(sketch, options);
    features[feature.id] = feature;
    featureOrder.push(feature.id);
    legacyMetadata[feature.id] = {
      sourceSketchId: sketch.id,
      bevelM: sketch.feature?.bevel ?? options.sketchBevelM ?? DEFAULT_SKETCH_BEVEL_M,
      storedDepthM: sketch.feature?.depth ?? options.sketchDepthM ?? DEFAULT_SKETCH_DEPTH_M,
    };
    if (feature.type === "pocket" && sketch.feature?.targetId && !availableSketchIds.has(sketch.feature.targetId)) {
      warnings.push(`Pocket ${feature.id} references missing Legacy sketch ${sketch.feature.targetId}.`);
    }
    const pattern = patternForLegacyPocket(sketch, feature.id);
    if (pattern) {
      features[pattern.id] = pattern;
      featureOrder.push(pattern.id);
    }
  });

  return { features, featureOrder, legacyMetadata, warnings };
};

/**
 * Creates a transient unified document for adapters and tests only. It does
 * not alter ProjectSnapshot or introduce a React-owned CadDocument state.
 */
export const adaptLegacyProjectToForgeMindCadDocument = (
  project: LegacyFeatureProject,
  options: LegacyFeatureAdapterOptions = {},
): ForgeMindCadDocument => {
  const sketches = Object.fromEntries(project.strokes.map((stroke) => [stroke.id, legacySketchToDomain(stroke)]));
  const adaptedFeatures = adaptLegacyFeatures(project.strokes, options);
  return createCadDocument<Sketch, Feature>({
    id: project.id,
    name: project.name,
    sketches,
    features: adaptedFeatures.features,
    featureOrder: adaptedFeatures.featureOrder,
    bodies: Object.fromEntries(project.parts.map((part) => [part.id, legacyPartToCadBody(part)])),
    activeBodyId: project.activePartId,
    updatedAt: project.updatedAt,
  });
};
