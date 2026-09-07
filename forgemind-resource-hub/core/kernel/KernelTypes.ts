import type { Vec3 } from "../cad/CadTypes.ts";
import type { ClosedProfile, ProfileSegment } from "../sketch/SketchProfile.ts";
import type { MechanicalDetailDefinition } from "../mechanical/MechanicalDetail.ts";

/** Runtime-only identifier. Never persist it in CadDocument or Project JSON. */
export type KernelShapeId = string;

/** Immutable operation output. A changed shape receives a new id or revision. */
export interface KernelShapeRef {
  id: KernelShapeId;
  revision: number;
  /** Runtime-only notices produced while creating this shape. Never persisted. */
  operationWarnings?: string[];
}

export type KernelTopologyKind = "solid" | "shell" | "face" | "wire" | "edge" | "vertex";

/**
 * Ephemeral topology reference, valid only for the current KernelShapeRef
 * revision. It is not persistent naming and must never enter Project JSON.
 */
export interface KernelTopologyRef {
  shapeId: KernelShapeId;
  shapeRevision: number;
  kind: KernelTopologyKind;
  localId: string;
}

/** A right-handed placement of a two-dimensional sketch profile in mm space. */
export interface KernelPlaneFrame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
}

/** ClosedProfile coordinates are mm; ProfileSegmentArc angles are degrees. */
export interface KernelProfileInput {
  profile: ClosedProfile;
  plane: KernelPlaneFrame;
}

/** An ordered, open exact path wire in a placement frame. */
export interface KernelPathInput {
  /** Runtime validation rejects a full Circle; the wider type keeps profile extraction interoperable. */
  segments: ProfileSegment[];
  plane: KernelPlaneFrame;
  /** Optional native OCCT interpolation path. When present, segments must be empty. */
  splinePoints?: Array<[number, number]>;
  splinePeriodic?: boolean;
  /** Optional clamped interpolation directions in the path plane. */
  splineStartTangent?: [number, number];
  splineEndTangent?: [number, number];
}

export interface KernelSweepOptions {
  orientation: "followPath" | "fixedUp" | "guide";
  /** Constant binormal used by fixedUp orientation. */
  upDirection?: Vec3;
  /** Auxiliary exact path wire used by guide orientation. */
  guidePath?: KernelPathInput;
}
export interface KernelLoftOptions { solid: true; ruled: boolean; closed?: boolean; }
export interface KernelSurfaceLoftOptions { ruled: boolean; closed?: boolean; }

  export interface KernelBSplineSurfaceInput {
    /** Rectangular Part-local control net, indexed [row][column]. */
    controlNet: Vec3[][];
    /** Exact rational section curves; the transverse direction is built by OCCT loft. */
    rationalSections?: import("../surface/RationalBSplineSections.ts").RationalBSplineSectionDefinition;
    /** Exact tensor-product NURBS basis and per-pole rational weights. */
    tensorNurbs?: import("../surface/TensorProductNurbs.ts").TensorProductNurbsDefinition;
  }

export interface KernelSurfaceContinuitySample {
  pointMm: Vec3;
  normalAngleDeg: number;
  /** Dimensionless diagnostic delta from the kernel curvature vector. */
  curvatureDelta?: number;
}

export interface KernelSurfaceContinuityAnalysis {
  connected: boolean;
  sharedEdgeCount: number;
  samples: KernelSurfaceContinuitySample[];
  g1ToleranceDeg: number;
  g2Tolerance: number;
}

export interface KernelBoundarySurfaceOptions {
  continuity: "G0" | "G1" | "G2";
  sampleCount?: number;
  angularToleranceDeg?: number;
  curvatureTolerance?: number;
}

export interface KernelAxis {
  origin: Vec3;
  direction: Vec3;
}

export interface KernelMirrorPlane {
  origin: Vec3;
  normal: Vec3;
}

/** Exact conical/frustum primitive. Its axis is the supplied plane normal. */
export interface KernelConicalToolOptions {
  plane: KernelPlaneFrame;
  startRadiusMm: number;
  endRadiusMm: number;
  heightMm: number;
}
export interface KernelCylinderToolOptions { plane: KernelPlaneFrame; radiusMm: number; heightMm: number; }

/** Exact, local-Y-axis mechanical component input. */
export interface KernelMechanicalDetailInput {
  detail: MechanicalDetailDefinition;
}



export interface KernelCurvatureData { min: number; max: number; gaussian: number; mean: number; }
export interface KernelSurfacePointAnalysis {
  pointMm: Vec3;
  normal: Vec3;
  u: number;
  v: number;
  surfaceType?: KernelFaceInfo["surfaceType"];
  curvature: KernelCurvatureData;
}
export interface KernelSurfaceGridAnalysis {
  face: KernelTopologyRef;
  uSamples: number;
  vSamples: number;
  samples: KernelSurfacePointAnalysis[];
  rejectedSampleCount: number;
}
export interface KernelEdgeContinuityStation {
  pointMm: Vec3;
  parameterRatio: number;
  normalAngleDeg?: number;
  curvatureDelta?: { min: number; max: number; gaussian: number; mean: number };
  /** Averaged adjacent-face normal used only to draw an engineering curvature comb. */
  combDirection?: Vec3;
  /** Maximum absolute principal curvature at this station, in 1/mm. */
  combMagnitude?: number;
  grade: "boundary" | "G0" | "G1" | "G2";
}
export interface KernelEdgeContinuityAnalysis {
  edge: KernelTopologyRef;
  adjacentFaces: KernelTopologyRef[];
  pointMm: Vec3;
  normalAngleDeg?: number;
  g0: boolean;
  g1: boolean;
  curvatureMatched: boolean;
  curvatureDelta?: { min: number; max: number; gaussian: number; mean: number };
  samples: KernelSurfacePointAnalysis[];
  stations: KernelEdgeContinuityStation[];
}

export interface KernelExtrudeOptions {
  distanceMm: number;
  direction: "positive" | "negative" | "symmetric" | "twoSided";
  /** Opposite-side distance used only by twoSided construction helpers. */
  secondDistanceMm?: number;
}

export interface KernelRevolveOptions {
  axis: KernelAxis;
  angleDeg: number;
}

export interface KernelBoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface KernelShapeProperties {
  boundingBox: KernelBoundingBox;
  volumeMm3?: number;
  surfaceAreaMm2?: number;
  centerOfMassMm?: Vec3;
}

export interface KernelValidationIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface KernelValidationResult {
  valid: boolean;
  issues: KernelValidationIssue[];
}

export interface KernelTessellationOptions {
  linearDeflectionMm: number;
  angularDeflectionDeg: number;
}

export interface KernelStepSolid {
  shape: KernelShapeRef;
  ordinal: number;
}

/** Exact OCCT STEP import result. Source units/metadata are intentionally
 * optional because the current wrapper does not guarantee them. */
export interface KernelStepImportResult {
  solids: KernelStepSolid[];
  warnings: string[];
}

export interface KernelFaceDescriptor {
  index: number;
  topology: KernelTopologyRef;
}

export interface KernelFaceInfo {
  topology: KernelTopologyRef;
  hash?: number;
  areaMm2?: number;
  centerMm?: Vec3;
  surfaceType?: "plane" | "cylinder" | "cone" | "sphere" | "torus" | "bspline" | "other";
  /** Omitted until a reliable OCCT planar-frame adapter is available. */
  planarFrame?: KernelPlaneFrame;
  normal?: Vec3;
  /** Exact analytic cylinder frame in Part-local coordinates. Runtime-only and never persisted. */
  cylindricalFrame?: { axisOriginMm: Vec3; axisDirection: Vec3; radiusMm: number };
  /** Direct OCCT adjacency evidence, runtime-only. */
  boundaryEdgeCount?: number;
  /** Runtime-only exact B-Rep boundary edges belonging to this face. Never persist. */
  boundaryEdgeIds?: string[];
  adjacentSurfaceTypes?: string[];
  /** Runtime-only exact neighboring Face local IDs from OCCT B-Rep adjacency. */
  adjacentFaceIds?: string[];
}

export interface KernelEdgeInfo {
  topology: KernelTopologyRef;
  hash?: number;
  lengthMm?: number;
  curveType?: "line" | "circle" | "ellipse" | "bspline" | "other";
  startMm?: Vec3;
  endMm?: Vec3;
  adjacentFaceSurfaceTypes?: string[];
  adjacentFaceNormals?: Vec3[];
  /** Runtime-only exact neighboring Face ids sharing this Edge. */
  adjacentFaceIds?: string[];
  boundaryRole?: "boundary" | "interior";
}
/** Exact curve DTO derived from OCCT's analytic edge evaluator, never from tessellation. */
export type KernelEdgeGeometry =
  | { type: "line"; startMm: Vec3; endMm: Vec3 }
  | { type: "circle"; centerMm: Vec3; normal: Vec3; radiusMm: number }
  | { type: "arc"; centerMm: Vec3; normal: Vec3; radiusMm: number; startMm: Vec3; endMm: Vec3; clockwise: boolean }
  | { type: "bspline"; degree: number; rational: boolean; periodic: boolean; knots: number[]; multiplicities: number[]; polesMm: Vec3[]; weights: number[]; firstParameter: number; lastParameter: number }
  | { type: "unsupported"; curveType: string };

/** Typed-array tessellation data remains in millimetres and has no viewport dependency. */
export interface KernelTessellation {
  positions: Float32Array | Float64Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleFaceIndices: Uint32Array;
  faces: KernelFaceDescriptor[];
}

export interface KernelEdgePolyline {
  topology: KernelTopologyRef;
  positions: Float32Array | Float64Array;
}
