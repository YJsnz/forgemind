import type { Vec3 } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";
import type { MatchBSplineBoundaryOptions } from "../surface/BSplineControlNet.ts";
import type { RationalBSplineSectionDefinition } from "../surface/RationalBSplineSections.ts";
import type { TensorProductNurbsDefinition } from "../surface/TensorProductNurbs.ts";

export interface BSplineSurfaceBoundaryMatch extends MatchBSplineBoundaryOptions {
  sourceFeatureId: string;
}

/** Exact OCCT B-spline surface authored from a rectangular Part-local control net. */
export interface BSplineSurfaceFeature extends BaseFeature {
  type: "bsplineSurface";
  controlNet: Vec3[][];
  /** Optional exact rational section data. The transverse direction is an OCCT smooth loft. */
  rationalSections?: RationalBSplineSectionDefinition;
  /** Complete tensor-product NURBS design data with independent U/V bases and per-pole weights. */
  tensorNurbs?: TensorProductNurbsDefinition;
  /** Parametric boundary relation reapplied whenever the source surface changes. */
  boundaryMatch?: BSplineSurfaceBoundaryMatch;
  /** Multiple independent edge relations. Each target edge may be driven once. */
  boundaryMatches?: BSplineSurfaceBoundaryMatch[];
}

/** Reads the current multi-edge contract while keeping older saved projects valid. */
export const bsplineSurfaceBoundaryMatches = (feature: BSplineSurfaceFeature): BSplineSurfaceBoundaryMatch[] =>
  feature.boundaryMatches?.length ? feature.boundaryMatches : feature.boundaryMatch ? [feature.boundaryMatch] : [];
