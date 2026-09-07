import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";

/** World-space directions deliberately kept small for Pattern V1. */
export type PatternDirection = "X" | "Y" | "Z" | Vec3;

export interface PatternAxis {
  origin: Vec3;
  direction: Vec3;
}

export type MirrorPlane =
  | "XY"
  | "YZ"
  | "XZ"
  | { origin: Vec3; normal: Vec3 };

/**
 * Real B-Rep repetition, distinct from the historical `pattern` placeholder.
 * `count` always includes each seed instance at its original placement.
 */
export interface LinearPatternFeature extends BaseFeature {
  type: "linearPattern";
  targetFeatureId: UUID;
  seedFeatureIds: UUID[];
  direction: PatternDirection;
  count: number;
  spacingMm: number;
  symmetric?: boolean;
  /** V9 imported reconstruction: index of the confirmed seed inside the recovered sequence. */
  seedIndex?: number;
}

export interface CircularPatternFeature extends BaseFeature {
  type: "circularPattern";
  targetFeatureId: UUID;
  seedFeatureIds: UUID[];
  axis: PatternAxis;
  count: number;
  /** Sweep in degrees. 360° creates no duplicate instance at the endpoint. */
  angleDeg: number;
}

/** Mirrors every listed seed once across a world or explicitly-defined plane. */
export interface MirrorFeature extends BaseFeature {
  type: "mirror";
  targetFeatureId: UUID;
  seedFeatureIds: UUID[];
  plane: MirrorPlane;
}

export type FeaturePatternFeature = LinearPatternFeature | CircularPatternFeature | MirrorFeature;
