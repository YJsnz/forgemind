import type { UUID, Vec2 } from "../cad/CadTypes.ts";
import type { PersistentTopologyRef } from "../topology/PersistentTopologyRef.ts";

export interface SketchLine {
  id: UUID;
  type: "line";
  start: Vec2;
  end: Vec2;
  construction: boolean;
}

/** Exact external reference. It is fixed, excluded from profiles, and resolves from persistent topology on rebuild. */
export interface ProjectedSketchLine { id: UUID; type: "external-line"; start: Vec2; end: Vec2; construction: true; sourceFeatureId: UUID; sourceEdge: PersistentTopologyRef; projectionMode: "coplanar" | "orthogonal"; referenceStatus?: "current" | "lost" | "ambiguous"; }

/** Exact circular B-Rep reference projected into a coplanar sketch. */
export interface ProjectedSketchCircle { id: UUID; type: "external-circle"; center: Vec2; radius: number; construction: true; sourceFeatureId: UUID; sourceEdge: PersistentTopologyRef; projectionMode: "coplanar"; referenceStatus?: "current" | "lost" | "ambiguous"; }

/** Exact circular-arc B-Rep reference projected into a coplanar sketch. */
export interface ProjectedSketchArc { id: UUID; type: "external-arc"; center: Vec2; radius: number; startAngle: number; endAngle: number; clockwise: boolean; construction: true; sourceFeatureId: UUID; sourceEdge: PersistentTopologyRef; projectionMode: "coplanar"; referenceStatus?: "current" | "lost" | "ambiguous"; }

/** Exact rational B-Spline/NURBS B-Rep reference projected into a coplanar sketch. */
export interface ProjectedSketchBSpline { id: UUID; type: "external-bspline"; degree: number; rational: boolean; periodic: boolean; knots: number[]; multiplicities: number[]; controlPoints: Vec2[]; weights: number[]; firstParameter: number; lastParameter: number; construction: true; sourceFeatureId: UUID; sourceEdge: PersistentTopologyRef; projectionMode: "coplanar"; referenceStatus?: "current" | "lost" | "ambiguous"; }

export interface SketchCircle {
  id: UUID;
  type: "circle";
  center: Vec2;
  radius: number;
  construction: boolean;
}

export interface SketchArc {
  id: UUID;
  type: "arc";
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  construction: boolean;
}

export interface SketchPointEntity {
  id: UUID;
  type: "point";
  position: Vec2;
  construction: boolean;
}

/** Legacy freehand control points; this is not a NURBS/B-Spline definition. */
export interface SketchSpline {
  id: UUID;
  type: "spline";
  controlPoints: Vec2[];
  closed: boolean;
  construction: boolean;
}

/** Native interpolation B-Spline authored from ordered fit points.
 * Unlike the legacy freehand entity, these points are passed to OCCT exactly
 * and optional end tangents clamp the curve direction at both ends. */
export interface SketchBSpline {
  id: UUID;
  type: "bspline";
  fitPoints: Vec2[];
  closed: boolean;
  /** Optional exact NURBS basis. When present, fitPoints are interpreted as
   * control poles instead of interpolation points. This keeps one editable
   * sketch entity while preserving degree, knots and rational weights all the
   * way into the OCCT profile wire. */
  nurbs?: {
    degree: number;
    periodic: boolean;
    knots: number[];
    multiplicities: number[];
    weights: number[];
    firstParameter: number;
    lastParameter: number;
  };
  startTangent?: Vec2;
  endTangent?: Vec2;
  construction: boolean;
}

export type SketchEntity =
  | SketchLine
  | ProjectedSketchLine
  | ProjectedSketchCircle
  | ProjectedSketchArc
  | ProjectedSketchBSpline
  | SketchCircle
  | SketchArc
  | SketchPointEntity
  | SketchBSpline
  | SketchSpline;
