import type { KernelCapabilities } from "./KernelCapabilities.ts";
import type { Vec3 } from "../cad/CadTypes.ts";
import type {
  KernelEdgePolyline,
  KernelEdgeInfo,
  KernelExtrudeOptions,
  KernelFaceInfo,
  KernelProfileInput,
  KernelRevolveOptions,
  KernelShapeProperties,
  KernelShapeRef,
  KernelTessellation,
  KernelTessellationOptions,
  KernelBSplineSurfaceInput,
  KernelSurfaceContinuityAnalysis,
  KernelTopologyRef,
  KernelValidationResult,
} from "./KernelTypes.ts";

/**
 * The only permitted future boundary for CAD geometry work. Every mutating
 * semantic operation returns a new shape reference and leaves inputs unchanged.
 * All lengths are mm and all angles are degrees.
 */
export interface CadKernel {
  init(): Promise<void>;
  dispose(): Promise<void>;
  /** Idempotent at the contract boundary: disposing an absent shape must be safe. */
  disposeShape(shape: KernelShapeRef): Promise<void>;
  getCapabilities(): Promise<KernelCapabilities>;

  importStep(data: Uint8Array): Promise<import("./KernelTypes.ts").KernelStepImportResult>;
  exportStep(shapes: readonly KernelShapeRef[]): Promise<Uint8Array>;

  extrude(profile: KernelProfileInput, options: KernelExtrudeOptions): Promise<KernelShapeRef>;
  revolve(profile: KernelProfileInput, options: KernelRevolveOptions): Promise<KernelShapeRef>;
  sweep(profile: KernelProfileInput, path: import("./KernelTypes.ts").KernelPathInput, options: import("./KernelTypes.ts").KernelSweepOptions): Promise<KernelShapeRef>;
  loft(sections: KernelProfileInput[], options: import("./KernelTypes.ts").KernelLoftOptions): Promise<KernelShapeRef>;
  /** Rebuild a detailed thread, gear, bearing or routed cable from persisted engineering parameters. */
  createMechanicalDetail(input: import("./KernelTypes.ts").KernelMechanicalDetailInput): Promise<KernelShapeRef>;

  /** Exact sheet/surface modeling operations. Outputs may be Face, Shell, Compound, or Solid. */
  surfacePatch(profile: KernelProfileInput): Promise<KernelShapeRef>;
  surfaceExtrude(profile: KernelProfileInput, options: KernelExtrudeOptions): Promise<KernelShapeRef>;
  surfaceRevolve(profile: KernelProfileInput, options: KernelRevolveOptions): Promise<KernelShapeRef>;
  surfaceSweep(profile: KernelProfileInput, path: import("./KernelTypes.ts").KernelPathInput, options: import("./KernelTypes.ts").KernelSweepOptions): Promise<KernelShapeRef>;
  surfaceLoft(sections: KernelProfileInput[], options: import("./KernelTypes.ts").KernelSurfaceLoftOptions): Promise<KernelShapeRef>;
  extractSurface(shape: KernelShapeRef, faces: KernelTopologyRef[], toleranceMm: number): Promise<KernelShapeRef>;
  offsetSurface(shape: KernelShapeRef, distanceMm: number, toleranceMm: number): Promise<KernelShapeRef>;
  sewSurfaces(shapes: KernelShapeRef[], toleranceMm: number): Promise<KernelShapeRef>;
  thickenSurface(shape: KernelShapeRef, thicknessMm: number, toleranceMm: number): Promise<KernelShapeRef>;
  encloseSurfaces(shapes: KernelShapeRef[], toleranceMm: number): Promise<KernelShapeRef>;
  fillSurface(boundaryEdges: KernelTopologyRef[], toleranceMm: number): Promise<KernelShapeRef>;
  trimSurface(surface: KernelShapeRef, tool: KernelShapeRef, keep: "outside" | "inside", toleranceMm: number): Promise<KernelShapeRef>;
  /** Exact section curve between two B-Rep shapes. The result is an edge compound, never a display polyline. */
  surfaceIntersection(first: KernelShapeRef, second: KernelShapeRef, toleranceMm: number): Promise<KernelShapeRef>;
  /** Curvature sample on an exact B-Rep face at its area center. */
  analyzeSurface(topology: KernelTopologyRef): Promise<import("./KernelTypes.ts").KernelSurfacePointAnalysis>;
  /** Dense UV sampling on the exact B-Rep face; invalid trimmed-domain samples are reported, not guessed. */
  analyzeSurfaceGrid(topology: KernelTopologyRef, uSamples?: number, vSamples?: number): Promise<import("./KernelTypes.ts").KernelSurfaceGridAnalysis>;
  /** Shared-edge positional/tangent/curvature diagnostic across multiple stations. */
  analyzeEdgeContinuity(topology: KernelTopologyRef, angularToleranceDeg?: number, curvatureTolerance?: number, sampleCount?: number): Promise<import("./KernelTypes.ts").KernelEdgeContinuityAnalysis>;
  bsplineSurface(input: KernelBSplineSurfaceInput): Promise<KernelShapeRef>;
  /** Exact boundary construction. G1/G2 results are committed only after multi-station verification against adjacent support faces. */
  boundarySurface(boundaryEdges: KernelTopologyRef[], toleranceMm: number, options?: import("./KernelTypes.ts").KernelBoundarySurfaceOptions): Promise<KernelShapeRef>;
  analyzeSurfaceContinuity(faceA: KernelTopologyRef, faceB: KernelTopologyRef, sampleCount?: number): Promise<KernelSurfaceContinuityAnalysis>;
  /** Exact BOPAlgo split; output may be a compound of surface fragments. */
  splitSurface(target: KernelShapeRef, tool: KernelShapeRef, toleranceMm: number): Promise<KernelShapeRef>;
  /** Conservative replacement: retained solid faces + replacement sheet must sew into a valid closed solid. */
  replaceFace(target: KernelShapeRef, targetFace: KernelTopologyRef, replacementSurface: KernelShapeRef, toleranceMm: number): Promise<KernelShapeRef>;

  /** Empty tool arrays must reject with KernelValidationError, never return target. */
  booleanUnion(target: KernelShapeRef, tools: KernelShapeRef[]): Promise<KernelShapeRef>;
  booleanCut(target: KernelShapeRef, tools: KernelShapeRef[]): Promise<KernelShapeRef>;
  booleanIntersect(target: KernelShapeRef, tools: KernelShapeRef[]): Promise<KernelShapeRef>;

  /** Exact rigid transformations used by feature-level repetition. */
  translate(shape: KernelShapeRef, offsetMm: Vec3): Promise<KernelShapeRef>;
  rotate(shape: KernelShapeRef, axis: import("./KernelTypes.ts").KernelAxis, angleDeg: number): Promise<KernelShapeRef>;
  mirror(shape: KernelShapeRef, plane: import("./KernelTypes.ts").KernelMirrorPlane): Promise<KernelShapeRef>;
  conicalTool(options: import("./KernelTypes.ts").KernelConicalToolOptions): Promise<KernelShapeRef>;
  cylindricalTool(options: import("./KernelTypes.ts").KernelCylinderToolOptions): Promise<KernelShapeRef>;
  draft(shape: KernelShapeRef, faces: KernelTopologyRef[], angleDeg: number, pullDirection: Vec3, reverse?: boolean): Promise<KernelShapeRef>;
  /** Exact OCCT whole-solid offset. Positive grows; negative shrinks. */
  offset(shape: KernelShapeRef, distanceMm: number, toleranceMm: number): Promise<KernelShapeRef>;
  /** OCCT BRepAlgoAPI_Defeaturing: remove complete features and heal surrounding faces. */
  defeature(shape: KernelShapeRef, faces: KernelTopologyRef[], toleranceMm: number): Promise<KernelShapeRef>;

  fillet(shape: KernelShapeRef, edges: KernelTopologyRef[], radiusMm: number): Promise<KernelShapeRef>;
  /** Exact OCCT law fillet. The radius varies continuously from one edge end to the other. */
  filletVariable(shape: KernelShapeRef, edge: KernelTopologyRef, startRadiusMm: number, endRadiusMm: number): Promise<KernelShapeRef>;
  chamfer(shape: KernelShapeRef, edges: KernelTopologyRef[], distanceMm: number): Promise<KernelShapeRef>;
  shell(shape: KernelShapeRef, removeFaces: KernelTopologyRef[], thicknessMm: number): Promise<KernelShapeRef>;

  validate(shape: KernelShapeRef): Promise<KernelValidationResult>;
  heal(shape: KernelShapeRef): Promise<KernelShapeRef>;
  getShapeProperties(shape: KernelShapeRef): Promise<KernelShapeProperties>;
  getFaces(shape: KernelShapeRef): Promise<KernelFaceInfo[]>;
  getFaceInfo(topology: KernelTopologyRef): Promise<KernelFaceInfo>;
  getEdges(shape: KernelShapeRef): Promise<KernelEdgeInfo[]>;
  getEdgeInfo(topology: KernelTopologyRef): Promise<KernelEdgeInfo>;
  getEdgeGeometry(topology: KernelTopologyRef): Promise<import("./KernelTypes.ts").KernelEdgeGeometry>;
  tessellate(shape: KernelShapeRef, options: KernelTessellationOptions): Promise<KernelTessellation>;
  getEdgePolylines(shape: KernelShapeRef): Promise<KernelEdgePolyline[]>;
}
