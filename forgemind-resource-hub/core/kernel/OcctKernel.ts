import { SweepContact, SweepMode, type OcctKernel as OcctWasmRuntime, type ShapeHandle } from "occt-wasm";

import { DEFAULT_CAD_TOLERANCE } from "../cad/Tolerance.ts";
import type { Vec3 } from "../cad/CadTypes.ts";
import type { ProfileSegment } from "../sketch/SketchProfile.ts";
import { rationalBSplineSections, validateRationalBSplineSections } from "../surface/RationalBSplineSections.ts";
import { validateTensorProductNurbs } from "../surface/TensorProductNurbs.ts";
import { validateNurbsCurve2D } from "../curve/NurbsCurve.ts";
import { validateMechanicalDetail } from "../mechanical/MechanicalDetail.ts";
import { createTensorProductNurbsBrep } from "./TensorNurbsBrep.ts";
import type { CadKernel } from "./CadKernel.ts";
import type { KernelCapabilities } from "./KernelCapabilities.ts";
import {
  KernelError,
  KernelInitializationError,
  KernelOperationError,
  KernelReferenceError,
  KernelValidationError,
} from "./KernelErrors.ts";
import type {
  KernelEdgePolyline,
  KernelEdgeInfo,
  KernelEdgeGeometry,
  KernelExtrudeOptions,
  KernelFaceDescriptor,
  KernelFaceInfo,
  KernelAxis,
  KernelMirrorPlane,
  KernelConicalToolOptions,
  KernelProfileInput,
  KernelPathInput,
  KernelSweepOptions,
  KernelLoftOptions,
  KernelSurfaceLoftOptions,
  KernelRevolveOptions,
  KernelShapeProperties,
  KernelShapeRef,
  KernelTessellation,
  KernelTessellationOptions,
  KernelTopologyRef,
  KernelValidationResult,
  KernelStepImportResult,
  KernelCylinderToolOptions,
  KernelBSplineSurfaceInput,
  KernelSurfaceContinuityAnalysis,
  KernelSurfacePointAnalysis,
  KernelSurfaceGridAnalysis,
  KernelEdgeContinuityAnalysis,
  KernelBoundarySurfaceOptions,
  KernelMechanicalDetailInput,
} from "./KernelTypes.ts";

const FACE_HASH_UPPER_BOUND = 2_147_483_647;

interface ShapeRuntimeRecord {
  handle: ShapeHandle;
  revision: number;
  released: boolean;
  topology?: ShapeTopologyCache;
}

interface RuntimeTopologyRecord<TInfo> {
  handle: ShapeHandle;
  info: TInfo;
}

interface ShapeTopologyCache {
  faces: Map<string, RuntimeTopologyRecord<KernelFaceInfo>>;
  faceIdsByHash: Map<number, string>;
  edges: Map<string, RuntimeTopologyRecord<KernelEdgeInfo>>;
  edgeIdsByHash: Map<number, string>;
  edgePolylines?: KernelEdgePolyline[];
}

export interface OcctKernelOptions {
  /** Optional explicit source for non-browser integration tests. Browser builds use Vite's asset URL. */
  wasm?: string | URL | ArrayBuffer | Uint8Array;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const samePoint = (left: [number, number], right: [number, number]): boolean =>
  Math.abs(left[0] - right[0]) <= DEFAULT_CAD_TOLERANCE.sketch
  && Math.abs(left[1] - right[1]) <= DEFAULT_CAD_TOLERANCE.sketch;

const hasFinitePoint = (point: [number, number]): boolean =>
  Number.isFinite(point[0]) && Number.isFinite(point[1]);

const vectorLength = (vector: Vec3): number => Math.hypot(vector.x, vector.y, vector.z);

const normalised = (vector: Vec3): Vec3 => {
  const length = vectorLength(vector);
  if (!Number.isFinite(length) || length <= DEFAULT_CAD_TOLERANCE.geometry) {
    throw new KernelValidationError("extrude", "Profile plane normal must be a non-zero finite vector.", "INVALID_PROFILE_NORMAL");
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const unavailable = (operation: string): never => {
  throw new KernelOperationError(
    operation,
    `${operation} is not enabled in the Browser OcctKernel MVP.`,
    "KERNEL_CAPABILITY_UNAVAILABLE",
  );
};

/**
 * Browser-only OpenCascade adapter. OCCT handles never escape this arena: the
 * public boundary contains only ForgeMind-generated shape ids and revisions.
 */
export class OcctKernel implements CadKernel {
  private runtime?: OcctWasmRuntime;
  private initPromise?: Promise<void>;
  /** B-Rep skeleton for exact tensor NURBS. Capture it before modeling starts:
   * occt-wasm 4.3.1 cannot safely serialize a newly created patch after some
   * variable-radius fillet operations. */
  private tensorNurbsTemplateBrep?: string;
  private readonly shapes = new Map<string, ShapeRuntimeRecord>();
  /** Immutable master B-Reps for repeated standard parts; callers always receive an owned copy. */
  private readonly mechanicalDetailCache = new Map<string, ShapeHandle>();
  private nextShapeNumber = 1;
  private readonly options: OcctKernelOptions;

  constructor(options: OcctKernelOptions = {}) {
    this.options = options;
  }

  async init(): Promise<void> {
    if (this.runtime) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = undefined;
    }
  }

  private async initialize(): Promise<void> {
    try {
      const { OcctKernel: OcctWasmKernel } = await import("occt-wasm");
      // The Vite-only URL import remains lazy. Node tests pass an explicit
      // file URL, so they never attempt to resolve Vite's `?url` suffix.
      // Fetching the immutable Vite asset ourselves avoids relying on a host's
      // WebAssembly MIME mapping. That is important for `vinext start`, where
      // static media may be served as application/octet-stream.
      const wasm = this.options.wasm ?? await this.loadBrowserWasm();
      this.runtime = await OcctWasmKernel.init({ wasm });
      const template = this.runtime.bsplineSurface([
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 },
      ], 2, 2);
      try {
        this.tensorNurbsTemplateBrep = this.runtime.toBREP(template);
      } finally {
        this.releaseHandle(this.runtime, template);
      }
    } catch (error) {
      throw new KernelInitializationError(
        `Unable to initialize the ForgeMind CAD kernel: ${errorMessage(error)}`,
        "OCCT_INITIALIZATION_FAILED",
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.initPromise) await this.initPromise.catch(() => undefined);
    const runtime = this.runtime;
    if (!runtime) return;

    for (const record of this.shapes.values()) {
      if (record.released) continue;
      this.releaseTopology(runtime, record);
      this.releaseHandle(runtime, record.handle);
      record.released = true;
    }
    this.shapes.clear();
    for (const handle of this.mechanicalDetailCache.values()) this.releaseHandle(runtime, handle);
    this.mechanicalDetailCache.clear();
    this.tensorNurbsTemplateBrep = undefined;
    runtime[Symbol.dispose]();
    this.runtime = undefined;
  }

  async disposeShape(shape: KernelShapeRef): Promise<void> {
    const record = this.shapes.get(shape.id);
    if (!record || record.revision !== shape.revision || record.released) return;
    const runtime = this.runtime;
    if (runtime) {
      this.releaseTopology(runtime, record);
      this.releaseHandle(runtime, record.handle);
    }
    record.released = true;
  }

  async getCapabilities(): Promise<KernelCapabilities> {
    return {
      backend: "occt-wasm",
      version: "4.3.1",
      brep: true,
      extrude: true,
      revolve: true,
      sweep: true,
      loft: true,
      mechanicalDetail: true,
      booleanUnion: true,
      booleanCut: true,
      booleanIntersect: true,
      fillet: true,
      // The WASM binding exposes this operation, but it destabilizes B-Rep
      // serialization after use on common profile-extruded solids.
      variableFillet: false,
      chamfer: true,
      shell: true,
      surfacePatch: true,
      surfaceExtrude: true,
      surfaceRevolve: true,
      surfaceSweep: true,
      surfaceLoft: true,
      surfaceExtract: true,
      surfaceOffset: true,
      surfaceSew: true,
      surfaceThicken: true,
      surfaceEnclose: true,
      surfaceFill: true,
      surfaceTrim: true,
      surfaceBSpline: true,
      surfaceCurvature: true,
      surfaceBoundary: true,
      surfaceContinuityAnalysis: true,
      surfaceSplit: true,
      surfaceReplaceFace: true,
      surfaceIntersection: true,
      validation: true,
      healing: true,
      tessellation: true,
      stepImport: true,
      stepExport: true,
    };
  }

  /** Lightweight lifecycle probe for regression tests; never persisted or exposed as CAD design data. */
  getRuntimeDiagnostics(): { ownedShapes: number; topologySubshapeHandles: number } {
    let topologySubshapeHandles = 0;
    for (const record of this.shapes.values()) if (!record.released) topologySubshapeHandles += (record.topology?.faces.size ?? 0) + (record.topology?.edges.size ?? 0);
    return { ownedShapes: [...this.shapes.values()].filter((record) => !record.released).length, topologySubshapeHandles };
  }

  /** Test/telemetry-only count; cached handles never enter CadDocument or history. */
  getMechanicalDetailCacheSize(): number { return this.mechanicalDetailCache.size; }

  async importStep(data: Uint8Array): Promise<KernelStepImportResult> {
    if (!data.byteLength) throw new KernelOperationError("importStep", "STEP source is empty.", "STEP_IMPORT_FAILED");
    const runtime = this.requireRuntime("importStep"); let root: ShapeHandle | undefined; const extracted: ShapeHandle[] = []; let sourceChildren: ShapeHandle[] = [];
    try {
      root = runtime.importStep(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      if (runtime.isNull(root)) throw new Error("OCCT returned a null STEP root shape.");
      const candidates = runtime.isSolid(root) ? [root] : (sourceChildren = runtime.getSubShapes(root, "solid"));
      if (!candidates.length) throw new KernelOperationError("importStep", "STEP contains no solid bodies.", "STEP_NO_SOLID_BODY");
      const solids = candidates.map((candidate, ordinal) => {
        // getSubShapes handles are tied to their root. Copy every source shape
        // so imported Feature runtime ownership is fully independent.
        const owned = runtime.copy(candidate); extracted.push(owned); return { shape: this.registerShape(owned), ordinal };
      });
      extracted.length = 0; // registered arena records now own these handles.
      return { solids, warnings: [] };
    } catch (error) {
      if (error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("importStep", errorMessage(error), "STEP_IMPORT_FAILED");
    } finally {
      for (const handle of extracted) this.releaseHandle(runtime, handle);
      for (const handle of sourceChildren) this.releaseHandle(runtime, handle);
      if (root !== undefined) this.releaseHandle(runtime, root);
    }
  }

  async exportStep(shapes: readonly KernelShapeRef[]): Promise<Uint8Array> {
    if (!shapes.length) throw new KernelOperationError("exportStep", "STEP export requires at least one Body shape.", "STEP_EXPORT_EMPTY");
    const { runtime } = this.resolveShape(shapes[0], "exportStep"); const records = shapes.map((shape) => this.resolveShape(shape, "exportStep").record); let compound: ShapeHandle | undefined;
    try {
      const root = records.length === 1 ? records[0].handle : (compound = runtime.makeCompound(records.map((record) => record.handle)));
      const step = runtime.exportStep(root);
      return new TextEncoder().encode(step);
    } catch (error) { throw new KernelOperationError("exportStep", errorMessage(error), "STEP_EXPORT_FAILED"); }
    finally { if (compound !== undefined) this.releaseHandle(runtime, compound); }
  }

  async extrude(profile: KernelProfileInput, options: KernelExtrudeOptions): Promise<KernelShapeRef> {
    if (Math.abs(options.distanceMm) <= DEFAULT_CAD_TOLERANCE.geometry) {
      throw new KernelValidationError("extrude", "Extrude distance must be greater than the geometry tolerance.", "ZERO_EXTRUDE_DISTANCE");
    }
    if (!Number.isFinite(options.distanceMm)) {
      throw new KernelValidationError("extrude", "Extrude distance must be finite.", "INVALID_EXTRUDE_DISTANCE");
    }
    if (options.direction === "symmetric") {
      unavailable("extrude.symmetric");
    }
    if (profile.profile.holes.length > 0) {
      unavailable("extrude.holes");
    }

    const normal = normalised(profile.plane.normal);
    const sign = options.direction === "negative" ? -1 : 1;
    let face: ShapeHandle | undefined;
    let temporaryHandles: ShapeHandle[] = [];

    try {
      const built = this.createProfileFace(profile, "extrude");
      face = built.face;
      temporaryHandles = built.temporaryHandles;
      const runtime = built.runtime;
      const handle = runtime.extrude(
        face,
        normal.x * options.distanceMm * sign,
        normal.y * options.distanceMm * sign,
        normal.z * options.distanceMm * sign,
      );
      return this.registerShape(handle);
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("extrude", errorMessage(error), "OCCT_EXTRUDE_FAILED");
    } finally {
      const runtime = this.runtime;
      if (runtime) {
        for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle);
        if (face !== undefined) this.releaseHandle(runtime, face);
      }
    }
  }

  async revolve(profile: KernelProfileInput, options: KernelRevolveOptions): Promise<KernelShapeRef> {
    if (!Number.isFinite(options.angleDeg) || Math.abs(options.angleDeg) <= DEFAULT_CAD_TOLERANCE.geometry || Math.abs(options.angleDeg) > 360 + DEFAULT_CAD_TOLERANCE.geometry) {
      throw new KernelValidationError("revolve", "Revolve angle must be finite, non-zero, and no greater than 360 degrees.", "INVALID_REVOLVE_ANGLE");
    }
    const axis = normalised(options.axis.direction);
    let face: ShapeHandle | undefined;
    let temporaryHandles: ShapeHandle[] = [];
    try {
      const built = this.createProfileFace(profile, "revolve");
      face = built.face;
      temporaryHandles = built.temporaryHandles;
      const handle = built.runtime.revolve(face, {
        point: options.axis.origin,
        direction: axis,
      }, options.angleDeg * Math.PI / 180);
      const result = this.registerSolidResult(built.runtime, handle, "revolve");
      return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("revolve", errorMessage(error), "OCCT_REVOLVE_FAILED");
    } finally {
      const runtime = this.runtime;
      if (runtime) {
        for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle);
        if (face !== undefined) this.releaseHandle(runtime, face);
      }
    }
  }

  async sweep(profile: KernelProfileInput, path: KernelPathInput, options: KernelSweepOptions): Promise<KernelShapeRef> {
    if (options.orientation !== "followPath") throw new KernelValidationError("sweep", "Sweep V1 supports Follow Path orientation only.", "INVALID_SWEEP_ORIENTATION");
    const start = this.pathStart(path); const planeDistance = Math.abs((start.x - profile.plane.origin.x) * profile.plane.normal.x + (start.y - profile.plane.origin.y) * profile.plane.normal.y + (start.z - profile.plane.origin.z) * profile.plane.normal.z);
    if (planeDistance > DEFAULT_CAD_TOLERANCE.geometry * 100) throw new KernelValidationError("sweep", "Profile plane must pass through the path start.", "SWEEP_PROFILE_PLACEMENT_INVALID");
    let profileWire: ShapeHandle | undefined; let pathWire: ShapeHandle | undefined; const temporaryHandles: ShapeHandle[] = [];
    try {
      const profileBuilt = this.createProfileWire(profile, "sweep"); profileWire = profileBuilt.wire; temporaryHandles.push(...profileBuilt.temporaryHandles);
      const pathBuilt = this.createPathWire(path, "sweep"); pathWire = pathBuilt.wire; temporaryHandles.push(...pathBuilt.temporaryHandles);
      // OCCT PipeShell with a corrected parallel-transport frame preserves
      // the exact path curves and supplies a deterministic right-corner rule.
      const result = profileBuilt.runtime.sweepAdvanced(profileWire, pathWire, { transitionMode: 1, withCorrection: true });
      return this.registerSolidResult(profileBuilt.runtime, result, "sweep");
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("sweep", errorMessage(error), "OCCT_SWEEP_FAILED");
    } finally { const runtime = this.runtime; if (runtime) for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle); }
  }

  async loft(sections: KernelProfileInput[], options: KernelLoftOptions): Promise<KernelShapeRef> {
    if (sections.length < 2) throw new KernelValidationError("loft", "Loft requires at least two closed sections.", "LOFT_REQUIRES_SECTIONS");
    if (!options.solid) throw new KernelValidationError("loft", "Loft V1 produces solids only.", "LOFT_REQUIRES_SOLID");
    const temporaryHandles: ShapeHandle[] = [];
    try {
      const first = this.createProfileWire(sections[0], "loft"); temporaryHandles.push(...first.temporaryHandles);
      const wires = [first.wire];
      for (const section of sections.slice(1)) { const built = this.createProfileWire(section, "loft"); if (built.runtime !== first.runtime) throw new KernelOperationError("loft", "Loft sections belong to different runtimes.", "LOFT_RUNTIME_MISMATCH"); wires.push(built.wire); temporaryHandles.push(...built.temporaryHandles); }
      const result = first.runtime.loft(wires, true, options.ruled);
      return this.registerSolidResult(first.runtime, result, "loft");
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("loft", errorMessage(error), "OCCT_LOFT_FAILED");
    } finally { const runtime = this.runtime; if (runtime) for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle); }
  }

  async createMechanicalDetail(input: KernelMechanicalDetailInput): Promise<KernelShapeRef> {
    const operation = "mechanicalDetail";
    const issues = validateMechanicalDetail(input.detail);
    if (issues.length) throw new KernelValidationError(operation, issues.join(" "), "INVALID_MECHANICAL_DETAIL");
    const runtime = this.requireRuntime(operation);
    const cacheKey = JSON.stringify(input.detail);
    const cached = this.mechanicalDetailCache.get(cacheKey);
    if (cached) return this.registerShape(runtime.copy(cached));
    const owned: ShapeHandle[] = [];
    let result: ShapeHandle | undefined;
    const keep = (handle: ShapeHandle) => { owned.push(handle); return handle; };
    const forget = (handle: ShapeHandle) => { const index = owned.indexOf(handle); if (index >= 0) owned.splice(index, 1); };
    const replaceBinary = (left: ShapeHandle, right: ShapeHandle, next: ShapeHandle) => {
      forget(left); forget(right); this.releaseHandle(runtime, left); this.releaseHandle(runtime, right); return keep(next);
    };
    const toLocalYAxis = (shape: ShapeHandle, lengthMm: number) => runtime.transform(shape, [1, 0, 0, 0, 0, 0, 1, -lengthMm / 2, 0, 1, 0, 0]);
    try {
      const detail = input.detail;
      if (detail.kind === "externalThread") {
        const majorRadius = detail.majorDiameterMm / 2;
        const coreRadius = majorRadius - detail.threadDepthMm * .85;
        const profileRadius = detail.threadDepthMm * .62;
        const helixRadius = majorRadius - profileRadius;
        const threadedLength = detail.threadedLengthMm ?? detail.lengthMm;
        const endClearance = Math.min(threadedLength * .2, Math.max(detail.pitchMm * .08, profileRadius * 1.1));
        let base = keep(runtime.makeCylinder(coreRadius, detail.lengthMm));
        const spine = keep(runtime.makeHelixWireHanded({ x: 0, y: 0, z: endClearance }, { x: 0, y: 0, z: 1 }, detail.pitchMm, Math.max(detail.pitchMm * .75, threadedLength - endClearance * 2), helixRadius, detail.leftHanded ?? false));
        const tangent = normalised({ x: 0, y: (detail.leftHanded ? -1 : 1) * Math.PI * 2 * helixRadius, z: detail.pitchMm });
        const profileEdge = keep(runtime.makeCircleEdge({ x: helixRadius, y: 0, z: endClearance }, tangent, profileRadius));
        const profileWire = keep(runtime.makeWire([profileEdge]));
        const profileFace = keep(runtime.makeFace(profileWire));
        const ridge = keep(runtime.pipe(profileFace, spine));
        base = replaceBinary(base, ridge, runtime.fuse(base, ridge));
        const transformed = toLocalYAxis(base, detail.lengthMm);
        forget(base); this.releaseHandle(runtime, base); result = transformed;
      } else if (detail.kind === "spurGear") {
        const pitchRadius = detail.moduleMm * detail.teeth / 2;
        const outerRadius = pitchRadius + detail.moduleMm;
        const rootRadius = pitchRadius - 1.25 * detail.moduleMm;
        const baseRadius = pitchRadius * Math.cos(detail.pressureAngleDeg * Math.PI / 180);
        const flankStartRadius = Math.max(rootRadius, baseRadius);
        const involute = (radius: number) => { const t = Math.sqrt(Math.max(0, radius * radius / (baseRadius * baseRadius) - 1)); return t - Math.atan(t); };
        const pitchInvolute = involute(pitchRadius);
        const halfPitch = Math.PI / detail.teeth;
        const polar = (radius: number, angle: number): Vec3 => ({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: 0 });
        const edges: ShapeHandle[] = [];
        for (let tooth = 0; tooth < detail.teeth; tooth += 1) {
          const center = tooth * Math.PI * 2 / detail.teeth;
          const flankAngle = (radius: number) => halfPitch * .5 + pitchInvolute - involute(radius);
          const leftFlank = Array.from({ length: 6 }, (_, index) => { const radius = flankStartRadius + (outerRadius - flankStartRadius) * index / 5; return polar(radius, center - flankAngle(radius)); });
          const rightFlank = Array.from({ length: 6 }, (_, index) => { const radius = outerRadius - (outerRadius - flankStartRadius) * index / 5; return polar(radius, center + flankAngle(radius)); });
          const rootLeft = polar(rootRadius, center - flankAngle(flankStartRadius));
          const rootRight = polar(rootRadius, center + flankAngle(flankStartRadius));
          if (rootRadius < flankStartRadius - 1e-7) edges.push(keep(runtime.makeLineEdge(rootLeft, leftFlank[0])));
          edges.push(keep(runtime.interpolatePoints(leftFlank, false)));
          edges.push(keep(runtime.makeLineEdge(leftFlank.at(-1)!, rightFlank[0])));
          edges.push(keep(runtime.interpolatePoints(rightFlank, false)));
          if (rootRadius < flankStartRadius - 1e-7) edges.push(keep(runtime.makeLineEdge(rightFlank.at(-1)!, rootRight)));
          const nextCenter = (tooth + 1) * Math.PI * 2 / detail.teeth;
          edges.push(keep(runtime.makeLineEdge(rootRight, polar(rootRadius, nextCenter - flankAngle(flankStartRadius)))));
        }
        const wire = keep(runtime.makeWire(edges));
        const face = keep(runtime.makeFace(wire));
        let gear = keep(runtime.extrude(face, 0, 0, detail.thicknessMm));
        if (detail.boreDiameterMm > 0) {
          const bore = keep(runtime.makeCylinder(detail.boreDiameterMm / 2, detail.thicknessMm));
          gear = replaceBinary(gear, bore, runtime.cut(gear, bore));
        }
        const transformed = toLocalYAxis(gear, detail.thicknessMm);
        forget(gear); this.releaseHandle(runtime, gear); result = transformed;
      } else if (detail.kind === "bearing") {
        const radialGap = (detail.outerDiameterMm - detail.innerDiameterMm) / 2;
        const raceThickness = Math.max(.4, radialGap * .28);
        const outer = keep(runtime.makeCylinder(detail.outerDiameterMm / 2, detail.widthMm));
        const outerBore = keep(runtime.makeCylinder(detail.outerDiameterMm / 2 - raceThickness, detail.widthMm));
        const outerRace = replaceBinary(outer, outerBore, runtime.cut(outer, outerBore));
        const innerBlank = keep(runtime.makeCylinder(detail.innerDiameterMm / 2 + raceThickness, detail.widthMm));
        const innerBore = keep(runtime.makeCylinder(detail.innerDiameterMm / 2, detail.widthMm));
        const innerRace = replaceBinary(innerBlank, innerBore, runtime.cut(innerBlank, innerBore));
        const ballRadius = Math.min(detail.widthMm * .3, Math.max(.3, (radialGap - raceThickness * 2) * .48));
        const ballTrackRadius = (detail.outerDiameterMm + detail.innerDiameterMm) / 4;
        const members = [outerRace, innerRace];
        for (let index = 0; index < detail.ballCount; index += 1) {
          const angle = index * Math.PI * 2 / detail.ballCount;
          const sphere = keep(runtime.makeSphere(ballRadius));
          const placed = keep(runtime.translate(sphere, Math.cos(angle) * ballTrackRadius, Math.sin(angle) * ballTrackRadius, detail.widthMm / 2));
          forget(sphere); this.releaseHandle(runtime, sphere); members.push(placed);
        }
        const compound = runtime.makeCompound(members);
        for (const member of members) { forget(member); this.releaseHandle(runtime, member); }
        result = toLocalYAxis(compound, detail.widthMm); this.releaseHandle(runtime, compound);
      } else {
        const points = detail.pathPointsMm;
        const tangent = normalised({ x: points[1].x - points[0].x, y: points[1].y - points[0].y, z: points[1].z - points[0].z });
        const spineEdge = keep(runtime.interpolatePoints(points, false));
        const spine = keep(runtime.makeWire([spineEdge]));
        const profileEdge = keep(runtime.makeCircleEdge(points[0], tangent, detail.diameterMm / 2));
        const profileWire = keep(runtime.makeWire([profileEdge]));
        const profileFace = keep(runtime.makeFace(profileWire));
        result = runtime.pipe(profileFace, spine);
      }
      if (!result || runtime.isNull(result)) throw new KernelOperationError(operation, "Mechanical detail produced an empty shape.", "MECHANICAL_DETAIL_EMPTY_RESULT");
      if (!runtime.isValid(result)) throw new KernelValidationError(operation, "Mechanical detail produced an invalid B-Rep.", "MECHANICAL_DETAIL_INVALID_RESULT");
      const registered = input.detail.kind === "bearing" ? this.registerShape(result) : this.registerSolidResult(runtime, result, operation);
      const registeredHandle = this.resolveShape(registered, operation).record.handle;
      this.mechanicalDetailCache.set(cacheKey, runtime.copy(registeredHandle));
      result = undefined; return registered;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_MECHANICAL_DETAIL_FAILED");
    } finally {
      if (result !== undefined) this.releaseHandle(runtime, result);
      for (const handle of owned.reverse()) this.releaseHandle(runtime, handle);
    }
  }

  async surfacePatch(profile: KernelProfileInput): Promise<KernelShapeRef> {
    const operation = "surfacePatch";
    const temporaryHandles: ShapeHandle[] = [];
    let face: ShapeHandle | undefined;
    try {
      const outer = this.createCurveWire(this.validateProfile(profile.profile.outer, operation), profile.plane, operation);
      temporaryHandles.push(...outer.temporaryHandles);
      face = outer.runtime.makeFace(outer.wire);
      if (profile.profile.holes.length) {
        const holeWires: ShapeHandle[] = [];
        for (const hole of profile.profile.holes) {
          const built = this.createCurveWire(this.validateProfile(hole, operation), profile.plane, operation);
          if (built.runtime !== outer.runtime) throw new KernelOperationError(operation, "Surface loops belong to different runtimes.", "SURFACE_RUNTIME_MISMATCH");
          temporaryHandles.push(...built.temporaryHandles);
          holeWires.push(built.wire);
        }
        const withHoles = outer.runtime.addHolesInFace(face, holeWires);
        this.releaseHandle(outer.runtime, face);
        face = withHoles;
      }
      const result = this.registerSurfaceResult(outer.runtime, face, operation);
      face = undefined;
      return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_SURFACE_PATCH_FAILED");
    } finally {
      const runtime = this.runtime;
      if (runtime) {
        for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle);
        if (face !== undefined) this.releaseHandle(runtime, face);
      }
    }
  }

  async surfaceExtrude(profile: KernelProfileInput, options: KernelExtrudeOptions): Promise<KernelShapeRef> {
    const operation = "surfaceExtrude";
    if (!Number.isFinite(options.distanceMm) || Math.abs(options.distanceMm) <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError(operation, "Surface Extrude distance must be finite and non-zero.", "INVALID_SURFACE_EXTRUDE_DISTANCE");
    if (options.direction === "symmetric") throw new KernelValidationError(operation, "Surface Extrude V1 supports positive or negative direction only.", "SURFACE_SYMMETRIC_UNSUPPORTED");
    if (profile.profile.holes.length) throw new KernelValidationError(operation, "Surface Extrude V1 expects one boundary loop; use separate surfaces + Sew for inner loops.", "SURFACE_HOLES_UNSUPPORTED");
    const normal = normalised(profile.plane.normal); const sign = options.direction === "negative" ? -1 : 1;
    const temporaryHandles: ShapeHandle[] = []; let raw: ShapeHandle | undefined;
    try {
      const built = this.createCurveWire(this.validateProfile(profile.profile.outer, operation), profile.plane, operation); temporaryHandles.push(...built.temporaryHandles);
      raw = built.runtime.extrude(built.wire, normal.x * options.distanceMm * sign, normal.y * options.distanceMm * sign, normal.z * options.distanceMm * sign);
      const result = this.registerSurfaceResult(built.runtime, raw, operation); raw = undefined; return result;
    } catch (error) { if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error; throw new KernelOperationError(operation, errorMessage(error), "OCCT_SURFACE_EXTRUDE_FAILED"); }
    finally { const runtime=this.runtime; if(runtime){ for(const handle of temporaryHandles.reverse()) this.releaseHandle(runtime,handle); if(raw!==undefined)this.releaseHandle(runtime,raw); } }
  }

  async surfaceRevolve(profile: KernelProfileInput, options: KernelRevolveOptions): Promise<KernelShapeRef> {
    const operation = "surfaceRevolve";
    if (!Number.isFinite(options.angleDeg) || Math.abs(options.angleDeg) <= DEFAULT_CAD_TOLERANCE.geometry || Math.abs(options.angleDeg) > 360 + DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError(operation, "Surface Revolve angle must be finite, non-zero, and no greater than 360 degrees.", "INVALID_SURFACE_REVOLVE_ANGLE");
    if (profile.profile.holes.length) throw new KernelValidationError(operation, "Surface Revolve V1 expects one boundary loop.", "SURFACE_HOLES_UNSUPPORTED");
    const axis = normalised(options.axis.direction); const temporaryHandles: ShapeHandle[]=[]; let raw:ShapeHandle|undefined;
    try { const built=this.createCurveWire(this.validateProfile(profile.profile.outer,operation),profile.plane,operation); temporaryHandles.push(...built.temporaryHandles); raw=built.runtime.revolve(built.wire,{point:options.axis.origin,direction:axis},options.angleDeg*Math.PI/180); const result=this.registerSurfaceResult(built.runtime,raw,operation); raw=undefined; return result; }
    catch(error){ if(error instanceof KernelValidationError||error instanceof KernelOperationError)throw error; throw new KernelOperationError(operation,errorMessage(error),"OCCT_SURFACE_REVOLVE_FAILED"); }
    finally{ const runtime=this.runtime; if(runtime){for(const handle of temporaryHandles.reverse())this.releaseHandle(runtime,handle); if(raw!==undefined)this.releaseHandle(runtime,raw);} }
  }

  async surfaceSweep(profile: KernelProfileInput, path: KernelPathInput, options: KernelSweepOptions): Promise<KernelShapeRef> {
    const operation="surfaceSweep";
    if(!["followPath","fixedUp","guide"].includes(options.orientation))throw new KernelValidationError(operation,"Surface Sweep orientation is invalid.","INVALID_SURFACE_SWEEP_ORIENTATION");
    if(options.orientation==="fixedUp"&&!options.upDirection)throw new KernelValidationError(operation,"Fixed Direction sweep requires a non-zero up direction.","SURFACE_SWEEP_UP_DIRECTION_REQUIRED");
    if(options.orientation==="guide"&&!options.guidePath)throw new KernelValidationError(operation,"Guide sweep requires an auxiliary guide path.","SURFACE_SWEEP_GUIDE_REQUIRED");
    if(profile.profile.holes.length)throw new KernelValidationError(operation,"Surface Sweep V1 expects one boundary loop.","SURFACE_HOLES_UNSUPPORTED");
    const temporaryHandles:ShapeHandle[]=[]; const sweptSheets:ShapeHandle[]=[]; let raw:ShapeHandle|undefined;
    try {
      const pathBuilt=this.createPathWire(path,"sweep"); temporaryHandles.push(...pathBuilt.temporaryHandles);
      const guideBuilt=options.guidePath?this.createPathWire(options.guidePath,"sweep"):undefined;if(guideBuilt)temporaryHandles.push(...guideBuilt.temporaryHandles);
      const up=options.upDirection?normalised(options.upDirection):undefined;
      const boundary=this.validateProfile(profile.profile.outer,operation).flatMap((segment):ProfileSegment[]=>segment.type!=="circle"?[segment]:[0,90,180,270].map((start)=>({type:"arc",center:segment.center,radius:segment.radius,startAngleDeg:start,endAngleDeg:start+90,clockwise:false})));
      for(const segment of boundary){
        const section=this.createCurveWire([segment],profile.plane,operation);temporaryHandles.push(...section.temporaryHandles);
        const swept=options.orientation==="followPath"
          ?section.runtime.sweep(section.wire,pathBuilt.wire,1)
          :options.orientation==="fixedUp"
            ?section.runtime.sweepOriented(section.wire,pathBuilt.wire,SweepMode.FixedUp,up)
            :section.runtime.sweepOriented(section.wire,pathBuilt.wire,SweepMode.Auxiliary,undefined,guideBuilt!.wire,{curvilinearEquivalence:false,contact:SweepContact.None});
        sweptSheets.push(swept);
      }
      if(sweptSheets.some((sheet)=>!pathBuilt.runtime.isValid(sheet)))throw new KernelOperationError(operation,"One swept boundary sheet is invalid.","OCCT_SURFACE_SWEEP_SHEET_INVALID");
      if(sweptSheets.length===1){raw=sweptSheets[0];sweptSheets.length=0;}else{const sewn=pathBuilt.runtime.sew(sweptSheets,DEFAULT_CAD_TOLERANCE.boolean);if(pathBuilt.runtime.isValid(sewn))raw=sewn;else{this.releaseHandle(pathBuilt.runtime,sewn);raw=pathBuilt.runtime.makeCompound(sweptSheets);}}
      const result=this.registerSurfaceResult(pathBuilt.runtime,raw,operation);raw=undefined;return result;
    }
    catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_SURFACE_SWEEP_FAILED");}
    finally{const runtime=this.runtime;if(runtime){for(const handle of sweptSheets.reverse())this.releaseHandle(runtime,handle);for(const handle of temporaryHandles.reverse())this.releaseHandle(runtime,handle);if(raw!==undefined)this.releaseHandle(runtime,raw);}}
  }

  async surfaceLoft(sections: KernelProfileInput[], options: KernelSurfaceLoftOptions): Promise<KernelShapeRef> {
    const operation="surfaceLoft";
    if(sections.length<2)throw new KernelValidationError(operation,"Surface Loft requires at least two sections.","SURFACE_LOFT_REQUIRES_SECTIONS");
    const temporaryHandles:ShapeHandle[]=[]; let raw:ShapeHandle|undefined;
    try { const first=this.createCurveWire(this.validateProfile(sections[0].profile.outer,operation),sections[0].plane,operation); if(sections[0].profile.holes.length)throw new KernelValidationError(operation,"Surface Loft V1 does not support profile holes.","SURFACE_HOLES_UNSUPPORTED"); temporaryHandles.push(...first.temporaryHandles); const wires=[first.wire]; for(const section of sections.slice(1)){if(section.profile.holes.length)throw new KernelValidationError(operation,"Surface Loft V1 does not support profile holes.","SURFACE_HOLES_UNSUPPORTED");const built=this.createCurveWire(this.validateProfile(section.profile.outer,operation),section.plane,operation);temporaryHandles.push(...built.temporaryHandles);wires.push(built.wire);} raw=first.runtime.loft(wires,false,options.ruled); const result=this.registerSurfaceResult(first.runtime,raw,operation); raw=undefined; return result; }
    catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_SURFACE_LOFT_FAILED");}
    finally{const runtime=this.runtime;if(runtime){for(const handle of temporaryHandles.reverse())this.releaseHandle(runtime,handle);if(raw!==undefined)this.releaseHandle(runtime,raw);}}
  }

  async extractSurface(shape: KernelShapeRef, faces: KernelTopologyRef[], toleranceMm: number): Promise<KernelShapeRef> {
    const operation="extractSurface";
    if(!faces.length)throw new KernelValidationError(operation,"Extract Surface requires at least one Face.","SURFACE_NO_FACES");
    if(!Number.isFinite(toleranceMm)||toleranceMm<0)throw new KernelValidationError(operation,"Extract Surface tolerance must be finite and non-negative.","INVALID_SURFACE_TOLERANCE");
    const {runtime}=this.resolveShape(shape,operation); const copies:ShapeHandle[]=[]; let raw:ShapeHandle|undefined;
    try { for(const face of faces){if(face.shapeId!==shape.id||face.shapeRevision!==shape.revision)throw new KernelReferenceError(operation,"All extracted Faces must belong to the target shape revision.","SURFACE_FACE_TARGET_MISMATCH");const resolved=this.resolveTopologyRef<KernelFaceInfo>(face,"face",operation);copies.push(runtime.copy(resolved.handle));} raw=copies.length===1?copies[0]:runtime.sew(copies,toleranceMm||DEFAULT_CAD_TOLERANCE.boolean); if(copies.length===1)copies.length=0; const result=this.registerSurfaceResult(runtime,raw,operation);raw=undefined;return result; }
    catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError||error instanceof KernelReferenceError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_EXTRACT_SURFACE_FAILED");}
    finally{for(const handle of copies.reverse())this.releaseHandle(runtime,handle);if(raw!==undefined)this.releaseHandle(runtime,raw);}
  }

  async offsetSurface(shape: KernelShapeRef, distanceMm: number, toleranceMm: number): Promise<KernelShapeRef> {
    const operation="offsetSurface"; if(!Number.isFinite(distanceMm)||Math.abs(distanceMm)<=DEFAULT_CAD_TOLERANCE.geometry)throw new KernelValidationError(operation,"Offset Surface distance must be finite and non-zero.","INVALID_SURFACE_OFFSET");
    const {runtime,record}=this.resolveShape(shape,operation);let raw:ShapeHandle|undefined;
    try{raw=runtime.offset(record.handle,distanceMm,toleranceMm);const result=this.registerSurfaceResult(runtime,raw,operation);raw=undefined;return result;}catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError||error instanceof KernelReferenceError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_OFFSET_SURFACE_FAILED");}finally{if(raw!==undefined)this.releaseHandle(runtime,raw);}
  }

  async sewSurfaces(shapes: KernelShapeRef[], toleranceMm: number): Promise<KernelShapeRef> {
    const operation="sewSurfaces";if(shapes.length<2)throw new KernelValidationError(operation,"Sew requires at least two surface shapes.","SURFACE_SEW_REQUIRES_MULTIPLE");
    const resolved=shapes.map((shape)=>this.resolveShape(shape,operation));const runtime=resolved[0].runtime;if(resolved.some((entry)=>entry.runtime!==runtime))throw new KernelOperationError(operation,"Surface shapes belong to different runtimes.","SURFACE_RUNTIME_MISMATCH");let raw:ShapeHandle|undefined;
    try{raw=runtime.sew(resolved.map((entry)=>entry.record.handle),toleranceMm);const result=this.registerSurfaceResult(runtime,raw,operation);raw=undefined;return result;}catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError||error instanceof KernelReferenceError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_SEW_SURFACE_FAILED");}finally{if(raw!==undefined)this.releaseHandle(runtime,raw);}
  }

  async thickenSurface(shape: KernelShapeRef, thicknessMm: number, toleranceMm: number): Promise<KernelShapeRef> {
    const operation="thickenSurface";if(!Number.isFinite(thicknessMm)||Math.abs(thicknessMm)<=DEFAULT_CAD_TOLERANCE.geometry)throw new KernelValidationError(operation,"Thicken distance must be finite and non-zero.","INVALID_SURFACE_THICKNESS");
    const {runtime,record}=this.resolveShape(shape,operation);let raw:ShapeHandle|undefined;
    try{raw=runtime.thicken(record.handle,thicknessMm,toleranceMm);const result=this.registerSolidResult(runtime,raw,operation);raw=undefined;return result;}catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError||error instanceof KernelReferenceError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_THICKEN_SURFACE_FAILED");}finally{if(raw!==undefined)this.releaseHandle(runtime,raw);}
  }

  async encloseSurfaces(shapes: KernelShapeRef[], toleranceMm: number): Promise<KernelShapeRef> {
    const operation="encloseSurfaces";if(shapes.length<2)throw new KernelValidationError(operation,"Enclose requires at least two surface shapes.","SURFACE_ENCLOSE_REQUIRES_MULTIPLE");
    const resolved=shapes.map((shape)=>this.resolveShape(shape,operation));const runtime=resolved[0].runtime;if(resolved.some((entry)=>entry.runtime!==runtime))throw new KernelOperationError(operation,"Surface shapes belong to different runtimes.","SURFACE_RUNTIME_MISMATCH");let sewn:ShapeHandle|undefined;let solid:ShapeHandle|undefined;
    try{sewn=runtime.sew(resolved.map((entry)=>entry.record.handle),toleranceMm);solid=runtime.makeSolid(sewn);const result=this.registerSolidResult(runtime,solid,operation);solid=undefined;return result;}catch(error){if(error instanceof KernelValidationError||error instanceof KernelOperationError||error instanceof KernelReferenceError)throw error;throw new KernelOperationError(operation,errorMessage(error),"OCCT_ENCLOSE_SURFACE_FAILED");}finally{if(solid!==undefined)this.releaseHandle(runtime,solid);if(sewn!==undefined)this.releaseHandle(runtime,sewn);}
  }

  async fillSurface(boundaryEdges: KernelTopologyRef[], toleranceMm: number): Promise<KernelShapeRef> {
    const operation = "fillSurface";
    if (!boundaryEdges.length) throw new KernelValidationError(operation, "Fill Surface requires at least one closed boundary Edge.", "SURFACE_FILL_BOUNDARY_EMPTY");
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError(operation, "Fill Surface tolerance must be finite and non-negative.", "INVALID_SURFACE_TOLERANCE");
    const runtime = this.requireRuntime(operation); let wire: ShapeHandle | undefined; let raw: ShapeHandle | undefined;
    try {
      const handles = boundaryEdges.map((edge) => this.resolveTopologyRef<KernelEdgeInfo>(edge, "edge", operation).handle);
      wire = runtime.makeWire(handles);
      raw = runtime.makeNonPlanarFace(wire);
      const result = this.registerSurfaceResult(runtime, raw, operation); raw = undefined; return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_FILL_SURFACE_FAILED");
    } finally { if (raw !== undefined) this.releaseHandle(runtime, raw); if (wire !== undefined) this.releaseHandle(runtime, wire); }
  }

  async trimSurface(surface: KernelShapeRef, tool: KernelShapeRef, keep: "outside" | "inside", toleranceMm: number): Promise<KernelShapeRef> {
    const operation = "trimSurface";
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError(operation, "Trim Surface tolerance must be finite and non-negative.", "INVALID_SURFACE_TOLERANCE");
    const target = this.resolveShape(surface, operation), cutter = this.resolveShape(tool, operation);
    if (target.runtime !== cutter.runtime) throw new KernelOperationError(operation, "Trim target and tool belong to different runtimes.", "SURFACE_RUNTIME_MISMATCH");
    let raw: ShapeHandle | undefined;
    try {
      raw = keep === "inside" ? target.runtime.common(target.record.handle, cutter.record.handle) : target.runtime.cut(target.record.handle, cutter.record.handle);
      const result = this.registerSurfaceResult(target.runtime, raw, operation); raw = undefined; return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_TRIM_SURFACE_FAILED");
    } finally { if (raw !== undefined) this.releaseHandle(target.runtime, raw); }
  }

  async surfaceIntersection(first: KernelShapeRef, second: KernelShapeRef, toleranceMm: number): Promise<KernelShapeRef> {
    const operation = "surfaceIntersection";
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError(operation, "Intersection tolerance must be finite and non-negative.", "INVALID_SURFACE_INTERSECTION_TOLERANCE");
    const left = this.resolveShape(first, operation); const right = this.resolveShape(second, operation);
    if (left.runtime !== right.runtime) throw new KernelOperationError(operation, "Intersection inputs belong to different runtimes.", "SURFACE_RUNTIME_MISMATCH");
    let raw: ShapeHandle | undefined;
    try {
      raw = left.runtime.section(left.record.handle, right.record.handle);
      if (left.runtime.isNull(raw)) throw new KernelOperationError(operation, "The selected bodies do not produce an intersection curve.", "SURFACE_INTERSECTION_EMPTY");
      const result = this.registerShape(raw); raw = undefined;
      const edges = await this.getEdges(result);
      if (!edges.length) { await this.disposeShape(result); throw new KernelOperationError(operation, "The selected bodies do not produce an intersection edge.", "SURFACE_INTERSECTION_EMPTY"); }
      return result;
    } catch (error) {
      if (error instanceof KernelError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_SURFACE_INTERSECTION_FAILED");
    } finally { if (raw !== undefined) this.releaseHandle(left.runtime, raw); }
  }

  async bsplineSurface(input: KernelBSplineSurfaceInput): Promise<KernelShapeRef> {
    const operation = "bsplineSurface";
    const rows = input.controlNet.length;
    const cols = input.controlNet[0]?.length ?? 0;
    if (rows < 2 || cols < 2 || input.controlNet.some((row) => row.length !== cols)) {
      throw new KernelValidationError(operation, "B-spline Surface requires a rectangular control net of at least 2 × 2 points.", "INVALID_BSPLINE_CONTROL_NET");
    }
    const controlPoints = input.controlNet.flat();
    if (controlPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z))) {
      throw new KernelValidationError(operation, "B-spline Surface control points must be finite Part-local coordinates.", "INVALID_BSPLINE_CONTROL_POINT");
    }
    if (input.rationalSections && input.tensorNurbs) {
      throw new KernelValidationError(operation, "Choose either tensor-product NURBS or legacy rational sections, not both.", "CONFLICTING_BSPLINE_DEFINITION");
    }
    if (input.rationalSections) {
      const validation = validateRationalBSplineSections(input.controlNet, input.rationalSections);
      if (!validation.valid) throw new KernelValidationError(operation, validation.issues.join(" "), "INVALID_RATIONAL_BSPLINE_SECTIONS");
    }
    if (input.tensorNurbs) {
      const validation = validateTensorProductNurbs(input.controlNet, input.tensorNurbs);
      if (!validation.valid) throw new KernelValidationError(operation, validation.issues.join(" "), "INVALID_TENSOR_PRODUCT_NURBS");
    }
    const runtime = this.requireRuntime(operation); const temporaryHandles: ShapeHandle[] = []; let raw: ShapeHandle | undefined;
    try {
      if (input.tensorNurbs) {
        const template = this.tensorNurbsTemplateBrep;
        if (!template) throw new KernelInitializationError("Tensor NURBS template is unavailable.", "OCCT_NURBS_TEMPLATE_UNAVAILABLE");
        raw = runtime.fromBREP(createTensorProductNurbsBrep(template, input.controlNet, input.tensorNurbs));
      } else if (input.rationalSections) {
        const definition = input.rationalSections;
        const wires = rationalBSplineSections(input.controlNet, definition).map((section) => {
          const edge = runtime.makeBSplineEdge(section.poles, section.weights, definition.knots, definition.multiplicities, definition.degree, false);
          temporaryHandles.push(edge);
          const wire = runtime.makeWire([edge]);
          temporaryHandles.push(wire);
          return wire;
        });
        raw = runtime.loft(wires, false, false);
      } else raw = runtime.bsplineSurface(controlPoints, rows, cols);
      const result = this.registerSurfaceResult(runtime, raw, operation); raw = undefined; return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_BSPLINE_SURFACE_FAILED");
    } finally {
      for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle);
      if (raw !== undefined) this.releaseHandle(runtime, raw);
    }
  }

  async boundarySurface(boundaryEdges: KernelTopologyRef[], toleranceMm: number, options: KernelBoundarySurfaceOptions = { continuity: "G0" }): Promise<KernelShapeRef> {
    const operation = "boundarySurface";
    if (boundaryEdges.length < 2) throw new KernelValidationError(operation, "Boundary Surface requires an ordered closed B-Rep edge loop.", "SURFACE_BOUNDARY_EMPTY");
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError(operation, "Boundary Surface tolerance must be finite and non-negative.", "INVALID_SURFACE_TOLERANCE");
    const runtime = this.requireRuntime(operation); let wire: ShapeHandle | undefined; let raw: ShapeHandle | undefined;
    try {
      const handles = boundaryEdges.map((edge) => this.resolveTopologyRef<KernelEdgeInfo>(edge, "edge", operation).handle);
      wire = runtime.makeWire(handles);
      raw = runtime.makeNonPlanarFace(wire);
      if (options.continuity !== "G0") this.verifyBoundarySurfaceContinuity(runtime, raw, boundaryEdges, options);
      const result = this.registerSurfaceResult(runtime, raw, operation); raw = undefined; return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), "OCCT_BOUNDARY_SURFACE_FAILED");
    } finally { if (raw !== undefined) this.releaseHandle(runtime, raw); if (wire !== undefined) this.releaseHandle(runtime, wire); }
  }

  async analyzeSurfaceContinuity(faceA: KernelTopologyRef, faceB: KernelTopologyRef, sampleCount = 5): Promise<KernelSurfaceContinuityAnalysis> {
    const operation = "analyzeSurfaceContinuity";
    if (faceA.kind !== "face" || faceB.kind !== "face") throw new KernelValidationError(operation, "Continuity analysis requires two Face references.", "SURFACE_CONTINUITY_REQUIRES_FACES");
    if (faceA.shapeId !== faceB.shapeId || faceA.shapeRevision !== faceB.shapeRevision) {
      return { connected: false, sharedEdgeCount: 0, samples: [], g1ToleranceDeg: .5, g2Tolerance: 1e-3 };
    }
    const runtime = this.requireRuntime(operation);
    const shapeRef: KernelShapeRef = { id: faceA.shapeId, revision: faceA.shapeRevision };
    const record = this.resolveShape(shapeRef, operation).record;
    const cache = this.ensureTopologyCache(runtime, record, shapeRef);
    const a = cache.faces.get(faceA.localId), b = cache.faces.get(faceB.localId);
    if (!a || !b) throw new KernelReferenceError(operation, "A selected Face no longer exists in the current B-Rep revision.", "OCCT_TOPOLOGY_REFERENCE_LOST");
    const aEdges = new Set(a.info.boundaryEdgeIds ?? []);
    const shared = (b.info.boundaryEdgeIds ?? []).filter((id) => aEdges.has(id));
    if (!shared.length) return { connected: false, sharedEdgeCount: 0, samples: [], g1ToleranceDeg: .5, g2Tolerance: 1e-3 };
    const samples: KernelSurfaceContinuityAnalysis["samples"] = [];
    const count = Math.max(2, Math.min(21, Math.trunc(sampleCount)));
    for (const edgeId of shared) {
      const edge = cache.edges.get(edgeId); if (!edge) continue;
      const parameters = runtime.curveParameters(edge.handle);
      for (let index = 0; index < count; index += 1) {
        const t = count === 1 ? .5 : index / (count - 1);
        const parameter = parameters.first + (parameters.last - parameters.first) * t;
        const point = runtime.curvePointAtParam(edge.handle, parameter);
        const uvA = runtime.uvFromPoint(a.handle, point), uvB = runtime.uvFromPoint(b.handle, point);
        const normalA = normalised(runtime.surfaceNormal(a.handle, uvA.u, uvA.v));
        const normalB = normalised(runtime.surfaceNormal(b.handle, uvB.u, uvB.v));
        const cosine = Math.min(1, Math.max(-1, Math.abs(normalA.x * normalB.x + normalA.y * normalB.y + normalA.z * normalB.z)));
        const normalAngleDeg = Math.acos(cosine) * 180 / Math.PI;
        let curvatureDelta: number | undefined;
        try {
          const curvatureA = runtime.surfaceCurvature(a.handle, uvA.u, uvA.v);
          const curvatureB = runtime.surfaceCurvature(b.handle, uvB.u, uvB.v);
          curvatureDelta = Math.max(Math.abs(Math.abs(curvatureA.min) - Math.abs(curvatureB.min)), Math.abs(Math.abs(curvatureA.max) - Math.abs(curvatureB.max)));
        } catch { curvatureDelta = undefined; }
        samples.push({ pointMm: point, normalAngleDeg, curvatureDelta });
      }
    }
    return { connected: true, sharedEdgeCount: shared.length, samples, g1ToleranceDeg: .5, g2Tolerance: 1e-3 };
  }


  async analyzeSurface(topology: KernelTopologyRef): Promise<KernelSurfacePointAnalysis> {
    const operation = "analyzeSurface";
    const resolved = this.resolveTopologyRef<KernelFaceInfo>(topology, "face", operation);
    const runtime = this.requireRuntime(operation);
    const uv = runtime.uvBounds(resolved.handle);
    const u = (uv.uMin + uv.uMax) / 2, v = (uv.vMin + uv.vMax) / 2;
    const pointMm = runtime.pointOnSurface(resolved.handle, u, v);
    const normal = normalised(runtime.surfaceNormal(resolved.handle, u, v));
    const curvature = runtime.surfaceCurvature(resolved.handle, u, v);
    return { pointMm, normal, u, v, surfaceType: resolved.info.surfaceType, curvature: { min: curvature.min, max: curvature.max, gaussian: curvature.gaussian, mean: curvature.mean } };
  }

  async analyzeSurfaceGrid(topology: KernelTopologyRef, uSamples = 7, vSamples = 7): Promise<KernelSurfaceGridAnalysis> {
    const operation = "analyzeSurfaceGrid";
    const resolved = this.resolveTopologyRef<KernelFaceInfo>(topology, "face", operation);
    const runtime = this.requireRuntime(operation);
    const bounds = runtime.uvBounds(resolved.handle);
    const uCount = Math.max(3, Math.min(31, Math.trunc(uSamples)));
    const vCount = Math.max(3, Math.min(31, Math.trunc(vSamples)));
    const samples: KernelSurfacePointAnalysis[] = [];
    let rejectedSampleCount = 0;
    for (let uIndex = 0; uIndex < uCount; uIndex += 1) {
      const u = bounds.uMin + (bounds.uMax - bounds.uMin) * uIndex / (uCount - 1);
      for (let vIndex = 0; vIndex < vCount; vIndex += 1) {
        const v = bounds.vMin + (bounds.vMax - bounds.vMin) * vIndex / (vCount - 1);
        if (runtime.classifyPointOnFace(resolved.handle, u, v) === "out") { rejectedSampleCount += 1; continue; }
        try {
          const curvature = runtime.surfaceCurvature(resolved.handle, u, v);
          samples.push({ pointMm: runtime.pointOnSurface(resolved.handle, u, v), normal: normalised(runtime.surfaceNormal(resolved.handle, u, v)), u, v, surfaceType: resolved.info.surfaceType, curvature: { min: curvature.min, max: curvature.max, gaussian: curvature.gaussian, mean: curvature.mean } });
        } catch { rejectedSampleCount += 1; }
      }
    }
    if (!samples.length) throw new KernelOperationError(operation, "No valid samples were found inside the trimmed face domain.", "SURFACE_GRID_EMPTY");
    return { face: topology, uSamples: uCount, vSamples: vCount, samples, rejectedSampleCount };
  }

  async analyzeEdgeContinuity(topology: KernelTopologyRef, angularToleranceDeg = 0.5, curvatureTolerance = 1e-3, sampleCount = 9): Promise<KernelEdgeContinuityAnalysis> {
    const operation = "analyzeEdgeContinuity";
    const { runtime, record } = this.resolveShape({ id: topology.shapeId, revision: topology.shapeRevision }, operation);
    const cache = this.ensureTopologyCache(runtime, record, { id: topology.shapeId, revision: topology.shapeRevision });
    const edge = this.resolveTopologyRef<KernelEdgeInfo>(topology, "edge", operation);
    const faceIds = edge.info.adjacentFaceIds ?? [];
    const parameters = runtime.curveParameters(edge.handle);
    const pointMm = runtime.curvePointAtParam(edge.handle, (parameters.first + parameters.last) / 2);
    const samples: KernelSurfacePointAnalysis[] = [];
    for (const faceId of faceIds.slice(0, 2)) {
      const face = cache.faces.get(faceId); if (!face) continue;
      const uv = runtime.uvFromPoint(face.handle, pointMm);
      const normal = normalised(runtime.surfaceNormal(face.handle, uv.u, uv.v));
      const curvature = runtime.surfaceCurvature(face.handle, uv.u, uv.v);
      samples.push({ pointMm: runtime.pointOnSurface(face.handle, uv.u, uv.v), normal, u: uv.u, v: uv.v, surfaceType: face.info.surfaceType, curvature: { min: curvature.min, max: curvature.max, gaussian: curvature.gaussian, mean: curvature.mean } });
    }
    const stations: KernelEdgeContinuityAnalysis["stations"] = [];
    const count = Math.max(3, Math.min(31, Math.trunc(sampleCount)));
    for (let index = 0; index < count; index += 1) {
      const ratio = index / (count - 1), parameter = parameters.first + (parameters.last - parameters.first) * ratio;
      const point = runtime.curvePointAtParam(edge.handle, parameter);
      if (faceIds.length < 2) { stations.push({ pointMm: point, parameterRatio: ratio, grade: "boundary" }); continue; }
      try {
        const leftFace = cache.faces.get(faceIds[0]), rightFace = cache.faces.get(faceIds[1]);
        if (!leftFace || !rightFace) { stations.push({ pointMm: point, parameterRatio: ratio, grade: "boundary" }); continue; }
        const uvLeft = runtime.uvFromPoint(leftFace.handle, point), uvRight = runtime.uvFromPoint(rightFace.handle, point);
        const leftNormal = normalised(runtime.surfaceNormal(leftFace.handle, uvLeft.u, uvLeft.v)), rightNormal = normalised(runtime.surfaceNormal(rightFace.handle, uvRight.u, uvRight.v));
        const dot = Math.max(-1, Math.min(1, Math.abs(leftNormal.x * rightNormal.x + leftNormal.y * rightNormal.y + leftNormal.z * rightNormal.z)));
        const angle = Math.acos(dot) * 180 / Math.PI;
        const left = runtime.surfaceCurvature(leftFace.handle, uvLeft.u, uvLeft.v), right = runtime.surfaceCurvature(rightFace.handle, uvRight.u, uvRight.v);
        const delta = { min: Math.abs(Math.abs(left.min) - Math.abs(right.min)), max: Math.abs(Math.abs(left.max) - Math.abs(right.max)), gaussian: Math.abs(left.gaussian - right.gaussian), mean: Math.abs(Math.abs(left.mean) - Math.abs(right.mean)) };
        const sign = leftNormal.x * rightNormal.x + leftNormal.y * rightNormal.y + leftNormal.z * rightNormal.z < 0 ? -1 : 1;
        const combDirection = normalised({ x: leftNormal.x + rightNormal.x * sign, y: leftNormal.y + rightNormal.y * sign, z: leftNormal.z + rightNormal.z * sign });
        const combMagnitude = Math.max(Math.abs(left.min), Math.abs(left.max), Math.abs(right.min), Math.abs(right.max));
        stations.push({ pointMm: point, parameterRatio: ratio, normalAngleDeg: angle, curvatureDelta: delta, combDirection, combMagnitude, grade: angle > angularToleranceDeg ? "G0" : delta.min > curvatureTolerance || delta.max > curvatureTolerance ? "G1" : "G2" });
      } catch { stations.push({ pointMm: point, parameterRatio: ratio, grade: "G0" }); }
    }
    const comparable = stations.filter((station) => station.grade !== "boundary");
    const normalAngleDeg = comparable.length ? Math.max(...comparable.map((station) => station.normalAngleDeg ?? Number.POSITIVE_INFINITY)) : undefined;
    const deltaStations = comparable.map((station) => station.curvatureDelta).filter((delta): delta is NonNullable<typeof delta> => !!delta);
    const curvatureDelta = deltaStations.length ? { min: Math.max(...deltaStations.map((delta) => delta.min)), max: Math.max(...deltaStations.map((delta) => delta.max)), gaussian: Math.max(...deltaStations.map((delta) => delta.gaussian)), mean: Math.max(...deltaStations.map((delta) => delta.mean)) } : undefined;
    const g1 = comparable.length === count && comparable.every((station) => station.grade === "G1" || station.grade === "G2");
    const curvatureMatched = comparable.length === count && comparable.every((station) => station.grade === "G2");
    return { edge: topology, adjacentFaces: faceIds.slice(0, 2).map((localId) => ({ shapeId: topology.shapeId, shapeRevision: topology.shapeRevision, kind: "face" as const, localId })), pointMm, normalAngleDeg, g0: faceIds.length >= 2, g1, curvatureMatched, curvatureDelta, samples, stations };
  }

  async splitSurface(targetShape: KernelShapeRef, toolShape: KernelShapeRef, toleranceMm: number): Promise<KernelShapeRef> {
    const operation = "splitSurface";
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError(operation, "Surface split tolerance must be finite and non-negative.", "INVALID_SURFACE_TOLERANCE");
    const target = this.resolveShape(targetShape, operation), tool = this.resolveShape(toolShape, operation);
    if (target.runtime !== tool.runtime) throw new KernelOperationError(operation, "Surface split shapes belong to different runtimes.", "SURFACE_RUNTIME_MISMATCH");
    let raw: ShapeHandle | undefined;
    try { raw = target.runtime.split(target.record.handle, [tool.record.handle]); const result = this.registerSurfaceResult(target.runtime, raw, operation); raw = undefined; return result; }
    catch (error) { if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error; throw new KernelOperationError(operation, errorMessage(error), "OCCT_SPLIT_SURFACE_FAILED"); }
    finally { if (raw !== undefined) this.releaseHandle(target.runtime, raw); }
  }

  async replaceFace(targetShape: KernelShapeRef, targetFace: KernelTopologyRef, replacementShape: KernelShapeRef, toleranceMm: number): Promise<KernelShapeRef> {
    const operation = "replaceFace";
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError(operation, "Replace Face tolerance must be finite and non-negative.", "INVALID_SURFACE_TOLERANCE");
    const target = this.resolveShape(targetShape, operation), replacement = this.resolveShape(replacementShape, operation);
    if (target.runtime !== replacement.runtime) throw new KernelOperationError(operation, "Replace Face shapes belong to different runtimes.", "SURFACE_RUNTIME_MISMATCH");
    if (targetFace.shapeId !== targetShape.id || targetFace.shapeRevision !== targetShape.revision || targetFace.kind !== "face") throw new KernelReferenceError(operation, "Replace Face target must belong to the selected solid revision.", "SURFACE_FACE_TARGET_MISMATCH");
    const runtime = target.runtime; const targetCache = this.ensureTopologyCache(runtime, target.record, targetShape); const replacementCache = this.ensureTopologyCache(runtime, replacement.record, replacementShape);
    if (!targetCache.faces.has(targetFace.localId)) throw new KernelReferenceError(operation, "The target Face no longer exists.", "OCCT_TOPOLOGY_REFERENCE_LOST");
    if (!replacementCache.faces.size) throw new KernelValidationError(operation, "Replacement Surface has no B-Rep faces.", "SURFACE_REPLACEMENT_EMPTY");
    const copies: ShapeHandle[] = []; let sewn: ShapeHandle | undefined; let solid: ShapeHandle | undefined;
    try {
      for (const [localId, entry] of targetCache.faces) if (localId !== targetFace.localId) copies.push(runtime.copy(entry.handle));
      for (const entry of replacementCache.faces.values()) copies.push(runtime.copy(entry.handle));
      sewn = runtime.sew(copies, toleranceMm);
      solid = runtime.makeSolid(sewn);
      const result = this.registerSolidResult(runtime, solid, operation); solid = undefined; return result;
    } catch (error) { if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error; throw new KernelOperationError(operation, `${errorMessage(error)} Replacement surface must share a sewable boundary with the removed Face.`, "OCCT_REPLACE_FACE_FAILED"); }
    finally { for (const handle of copies.reverse()) this.releaseHandle(runtime, handle); if (solid !== undefined) this.releaseHandle(runtime, solid); if (sewn !== undefined) this.releaseHandle(runtime, sewn); }
  }

  async booleanUnion(target: KernelShapeRef, tools: KernelShapeRef[]): Promise<KernelShapeRef> {
    if (tools.length === 0) {
      throw new KernelValidationError("booleanUnion", "Boolean operations require at least one tool shape.", "EMPTY_BOOLEAN_TOOLS");
    }
    const { runtime, record: targetRecord } = this.resolveShape(target, "booleanUnion");
    const toolRecords = tools.map((tool) => this.resolveShape(tool, "booleanUnion").record);
    let current: ShapeHandle | undefined;
    try {
      current = runtime.fuse(targetRecord.handle, toolRecords[0].handle);
      for (const tool of toolRecords.slice(1)) {
        const next = runtime.fuse(current, tool.handle);
        runtime.release(current);
        current = next;
      }
      const result = this.registerSolidResult(runtime, current, "booleanUnion");
      current = undefined;
      return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError("booleanUnion", errorMessage(error), "OCCT_BOOLEAN_FAILED");
    } finally {
      if (current !== undefined) this.releaseHandle(runtime, current);
    }
  }

  async booleanCut(target: KernelShapeRef, tools: KernelShapeRef[]): Promise<KernelShapeRef> {
    return this.executeBoolean("booleanCut", target, tools, (runtime, targetHandle, toolHandles) =>
      runtime.cutAll(targetHandle, toolHandles));
  }

  async booleanIntersect(target: KernelShapeRef, tools: KernelShapeRef[]): Promise<KernelShapeRef> {
    if (tools.length === 0) {
      throw new KernelValidationError("booleanIntersect", "Boolean operations require at least one tool shape.", "EMPTY_BOOLEAN_TOOLS");
    }
    const { runtime, record: targetRecord } = this.resolveShape(target, "booleanIntersect");
    const toolRecords = tools.map((tool) => this.resolveShape(tool, "booleanIntersect").record);
    let current: ShapeHandle | undefined;
    try {
      current = runtime.common(targetRecord.handle, toolRecords[0].handle);
      for (const tool of toolRecords.slice(1)) {
        const next = runtime.common(current, tool.handle);
        runtime.release(current);
        current = next;
      }
      const result = this.registerSolidResult(runtime, current, "booleanIntersect");
      current = undefined;
      return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError("booleanIntersect", errorMessage(error), "OCCT_BOOLEAN_FAILED");
    } finally {
      if (current !== undefined) this.releaseHandle(runtime, current);
    }
  }

  async translate(shape: KernelShapeRef, offsetMm: Vec3): Promise<KernelShapeRef> {
    if (![offsetMm.x, offsetMm.y, offsetMm.z].every(Number.isFinite)) {
      throw new KernelValidationError("translate", "Translation offset must be finite.", "INVALID_TRANSFORM");
    }
    return this.transformSolid("translate", shape, (runtime, handle) => runtime.translate(handle, offsetMm.x, offsetMm.y, offsetMm.z));
  }

  async rotate(shape: KernelShapeRef, axis: KernelAxis, angleDeg: number): Promise<KernelShapeRef> {
    if (![axis.origin.x, axis.origin.y, axis.origin.z, axis.direction.x, axis.direction.y, axis.direction.z, angleDeg].every(Number.isFinite) || vectorLength(axis.direction) <= DEFAULT_CAD_TOLERANCE.geometry) {
      throw new KernelValidationError("rotate", "Rotation axis and angle must be finite and the axis must be non-zero.", "INVALID_TRANSFORM");
    }
    return this.transformSolid("rotate", shape, (runtime, handle) => runtime.rotate(handle, { point: axis.origin, direction: axis.direction }, angleDeg * Math.PI / 180));
  }

  async mirror(shape: KernelShapeRef, plane: KernelMirrorPlane): Promise<KernelShapeRef> {
    if (![plane.origin.x, plane.origin.y, plane.origin.z, plane.normal.x, plane.normal.y, plane.normal.z].every(Number.isFinite) || vectorLength(plane.normal) <= DEFAULT_CAD_TOLERANCE.geometry) {
      throw new KernelValidationError("mirror", "Mirror plane must have a finite origin and non-zero normal.", "INVALID_TRANSFORM");
    }
    return this.transformSolid("mirror", shape, (runtime, handle) => runtime.mirror(handle, plane.origin, plane.normal));
  }

  async conicalTool(options: KernelConicalToolOptions): Promise<KernelShapeRef> {
    const values = [options.startRadiusMm, options.endRadiusMm, options.heightMm, options.plane.origin.x, options.plane.origin.y, options.plane.origin.z, options.plane.xAxis.x, options.plane.xAxis.y, options.plane.xAxis.z, options.plane.yAxis.x, options.plane.yAxis.y, options.plane.yAxis.z, options.plane.normal.x, options.plane.normal.y, options.plane.normal.z];
    if (!values.every(Number.isFinite) || options.startRadiusMm <= DEFAULT_CAD_TOLERANCE.geometry || options.endRadiusMm < 0 || options.heightMm <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError("conicalTool", "Conical tool dimensions and plane must be finite and positive.", "INVALID_CONICAL_TOOL");
    const normal = normalised(options.plane.normal); const xAxis = normalised(options.plane.xAxis); const yAxis = normalised(options.plane.yAxis);
    if (Math.abs(xAxis.x * yAxis.x + xAxis.y * yAxis.y + xAxis.z * yAxis.z) > 1e-5 || Math.abs(xAxis.x * normal.x + xAxis.y * normal.y + xAxis.z * normal.z) > 1e-5 || Math.abs(yAxis.x * normal.x + yAxis.y * normal.y + yAxis.z * normal.z) > 1e-5) throw new KernelValidationError("conicalTool", "Conical tool plane axes must be orthogonal.", "INVALID_CONICAL_TOOL_PLANE");
    const runtime = this.requireRuntime("conicalTool"); let raw: ShapeHandle | undefined; let transformed: ShapeHandle | undefined;
    try {
      raw = runtime.makeCone(options.startRadiusMm, options.endRadiusMm, options.heightMm);
      transformed = runtime.transform(raw, [xAxis.x, yAxis.x, normal.x, options.plane.origin.x, xAxis.y, yAxis.y, normal.y, options.plane.origin.y, xAxis.z, yAxis.z, normal.z, options.plane.origin.z]);
      const result = this.registerSolidResult(runtime, transformed, "conicalTool"); transformed = undefined; return result;
    } catch (error) {
      if (error instanceof KernelError) throw error;
      throw new KernelOperationError("conicalTool", errorMessage(error), "OCCT_CONICAL_TOOL_FAILED");
    } finally { if (transformed !== undefined) this.releaseHandle(runtime, transformed); if (raw !== undefined) this.releaseHandle(runtime, raw); }
  }

  async cylindricalTool(options: KernelCylinderToolOptions): Promise<KernelShapeRef> {
    if (!Number.isFinite(options.radiusMm) || !Number.isFinite(options.heightMm) || options.radiusMm <= DEFAULT_CAD_TOLERANCE.geometry || options.heightMm <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError("cylindricalTool", "Cylinder radius and height must be positive finite millimetres.", "INVALID_CYLINDER_TOOL");
    const normal = normalised(options.plane.normal); const xAxis = normalised(options.plane.xAxis); const yAxis = normalised(options.plane.yAxis); const runtime = this.requireRuntime("cylindricalTool"); let raw: ShapeHandle | undefined; let transformed: ShapeHandle | undefined;
    try { raw = runtime.makeCylinder(options.radiusMm, options.heightMm); transformed = runtime.transform(raw, [xAxis.x, yAxis.x, normal.x, options.plane.origin.x, xAxis.y, yAxis.y, normal.y, options.plane.origin.y, xAxis.z, yAxis.z, normal.z, options.plane.origin.z]); const result = this.registerSolidResult(runtime, transformed, "cylindricalTool"); transformed = undefined; return result; }
    catch (error) { throw new KernelOperationError("cylindricalTool", errorMessage(error), "OCCT_CYLINDER_TOOL_FAILED"); }
    finally { if (transformed !== undefined) this.releaseHandle(runtime, transformed); if (raw !== undefined) this.releaseHandle(runtime, raw); }
  }

  async draft(shape: KernelShapeRef, faces: KernelTopologyRef[], angleDeg: number, pullDirection: Vec3, reverse = false): Promise<KernelShapeRef> {
    if (!faces.length || !Number.isFinite(angleDeg) || angleDeg <= DEFAULT_CAD_TOLERANCE.geometry || angleDeg >= 89 || ![pullDirection.x,pullDirection.y,pullDirection.z].every(Number.isFinite) || vectorLength(pullDirection) <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError("draft", "Draft requires faces, 0 < angle < 89 degrees, and a non-zero pull direction.", "INVALID_DRAFT");
    const { runtime } = this.resolveShape(shape, "draft");
    // The WASM wrapper drafts one face at a time. Every call returns a new
    // TopoDS shape, so later calls must resolve the corresponding face on that
    // new shape rather than passing a stale subshape handle from the source.
    const selections = faces.map((face) => this.resolveTopologyRef<KernelFaceInfo>(face, "face", "draft").info);
    let current = shape; let ownsCurrent = false;
    try {
      for (const selection of selections) {
        const candidates = await this.getFaces(current);
        const nextFace = candidates
          .filter((candidate) => candidate.surfaceType === "plane" && candidate.normal && selection.normal)
          .sort((left, right) => {
            const score = (value: KernelFaceInfo) => (value.normal!.x * selection.normal!.x + value.normal!.y * selection.normal!.y + value.normal!.z * selection.normal!.z)
              - Math.hypot((value.centerMm?.x ?? 0) - (selection.centerMm?.x ?? 0), (value.centerMm?.y ?? 0) - (selection.centerMm?.y ?? 0), (value.centerMm?.z ?? 0) - (selection.centerMm?.z ?? 0)) * 1e-6;
            return score(right) - score(left);
          })[0];
        if (!nextFace) throw new KernelReferenceError("draft", "A selected Draft face no longer belongs to the intermediate solid.", "OCCT_TOPOLOGY_REFERENCE_INVALID");
        const currentRecord = this.resolveShape(current, "draft").record;
        const handle = this.resolveTopologyRef<KernelFaceInfo>(nextFace.topology, "face", "draft").handle;
        const raw = runtime.draft(currentRecord.handle, handle, (reverse ? -1 : 1) * angleDeg * Math.PI / 180, pullDirection);
        let next: KernelShapeRef | undefined;
        try { next = this.registerSolidResult(runtime, raw, "draft"); } catch (error) { this.releaseHandle(runtime, raw); throw error; }
        if (ownsCurrent) await this.disposeShape(current);
        current = next; ownsCurrent = true;
      }
      return current;
    } catch(error) { if (ownsCurrent) await this.disposeShape(current); if(error instanceof KernelError)throw error;throw new KernelOperationError("draft",errorMessage(error),"OCCT_DRAFT_FAILED"); }
  }

  async offset(shape: KernelShapeRef, distanceMm: number, toleranceMm: number): Promise<KernelShapeRef> {
    if (!Number.isFinite(distanceMm) || Math.abs(distanceMm) <= DEFAULT_CAD_TOLERANCE.geometry) {
      throw new KernelValidationError("offset", "Offset distance must be finite and larger than geometry tolerance.", "INVALID_OFFSET_DISTANCE");
    }
    if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) {
      throw new KernelValidationError("offset", "Offset tolerance must be positive and finite.", "INVALID_OFFSET_TOLERANCE");
    }
    const { runtime, record } = this.resolveShape(shape, "offset");
    let raw: ShapeHandle | undefined;
    try {
      raw = runtime.offset(record.handle, distanceMm, toleranceMm);
      const result = this.registerSolidResult(runtime, raw, "offset");
      raw = undefined;
      return result;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("offset", errorMessage(error), "OCCT_OFFSET_FAILED");
    } finally {
      if (raw !== undefined) this.releaseHandle(runtime, raw);
    }
  }

  async defeature(shape: KernelShapeRef, faces: KernelTopologyRef[], toleranceMm: number): Promise<KernelShapeRef> {
    if (!faces.length) throw new KernelValidationError("defeature", "At least one Face is required.");
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) throw new KernelValidationError("defeature", "Tolerance must be finite and non-negative.");
    const { runtime, record } = this.resolveShape(shape, "defeature");
    const handles = faces.map((face) => this.resolveTopologyRef<KernelFaceInfo>(face, "face", "defeature").handle);
    let raw: ShapeHandle | undefined;
    try {
      raw = runtime.defeature(record.handle, handles, toleranceMm);
      const result = this.registerSolidResult(runtime, raw, "defeature");
      raw = undefined;
      return result;
    } catch (error) {
      if (raw) this.releaseHandle(runtime, raw);
      if (error instanceof KernelError) throw error;
      throw new KernelOperationError("defeature", errorMessage(error), "OCCT_DEFEATURE_FAILED");
    }
  }

  async fillet(shape: KernelShapeRef, edges: KernelTopologyRef[], radiusMm: number): Promise<KernelShapeRef> {
    if (!Number.isFinite(radiusMm) || radiusMm <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError("fillet", "Fillet radius must be finite and greater than tolerance.", "INVALID_FILLET_RADIUS");
    if (!edges.length) throw new KernelValidationError("fillet", "Fillet requires at least one Edge.", "FILLET_NO_EDGES");
    const { runtime, record } = this.resolveShape(shape, "fillet");
    let result: ShapeHandle | undefined;
    try {
      const handles = edges.map((edge) => this.resolveTopologyRef<KernelEdgeInfo>(edge, "edge", "fillet").handle);
      result = runtime.fillet(record.handle, handles, radiusMm);
      const registered = this.registerSolidResult(runtime, result, "fillet"); result = undefined;
      return registered;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError("fillet", errorMessage(error), "KERNEL_FILLET_FAILED");
    } finally { if (result !== undefined) this.releaseHandle(runtime, result); }
  }

  async filletVariable(shape: KernelShapeRef, edge: KernelTopologyRef, startRadiusMm: number, endRadiusMm: number): Promise<KernelShapeRef> {
    const operation = "filletVariable";
    if (![startRadiusMm, endRadiusMm].every((value) => Number.isFinite(value) && value > DEFAULT_CAD_TOLERANCE.geometry)) {
      throw new KernelValidationError(operation, "Variable Fillet radii must be finite and greater than tolerance.", "INVALID_VARIABLE_FILLET_RADIUS");
    }
    this.resolveShape(shape, operation);
    if (edge.shapeId !== shape.id || edge.shapeRevision !== shape.revision) throw new KernelReferenceError(operation, "所选边不属于当前实体，请重新选择需要圆角的边。", "OCCT_TOPOLOGY_REFERENCE_LOST");
    throw new KernelOperationError(operation, "当前浏览器 CAD 内核的可变圆角会影响后续曲面重建，已暂时关闭。请使用恒定圆角，或在相邻曲面间建立 NURBS 过渡。", "VARIABLE_FILLET_UNAVAILABLE");
  }

  async chamfer(shape: KernelShapeRef, edges: KernelTopologyRef[], distanceMm: number): Promise<KernelShapeRef> {
    if (!Number.isFinite(distanceMm) || distanceMm <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError("chamfer", "Chamfer distance must be finite and greater than tolerance.", "INVALID_CHAMFER_DISTANCE");
    if (!edges.length) throw new KernelValidationError("chamfer", "Chamfer requires at least one Edge.", "CHAMFER_NO_EDGES");
    const { runtime, record } = this.resolveShape(shape, "chamfer");
    let result: ShapeHandle | undefined;
    try {
      const handles = edges.map((edge) => this.resolveTopologyRef<KernelEdgeInfo>(edge, "edge", "chamfer").handle);
      result = runtime.chamfer(record.handle, handles, distanceMm);
      const registered = this.registerSolidResult(runtime, result, "chamfer"); result = undefined;
      return registered;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelReferenceError) throw error;
      throw new KernelOperationError("chamfer", errorMessage(error), "KERNEL_CHAMFER_FAILED");
    } finally { if (result !== undefined) this.releaseHandle(runtime, result); }
  }

  async shell(shape: KernelShapeRef, removeFaces: KernelTopologyRef[], thicknessMm: number): Promise<KernelShapeRef> {
    if (!Number.isFinite(thicknessMm) || thicknessMm <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError("shell", "Shell thickness must be finite and greater than tolerance.", "INVALID_SHELL_THICKNESS");
    if (!removeFaces.length) throw new KernelValidationError("shell", "Shell requires at least one Face to remove.", "SHELL_NO_FACES");
    const { runtime, record } = this.resolveShape(shape, "shell"); let result: ShapeHandle | undefined; let healed: ShapeHandle | undefined; let healedFaces: ShapeHandle[] = [];
    const handles = removeFaces.map((face) => this.resolveTopologyRef<KernelFaceInfo>(face, "face", "shell").handle);
    const descriptors = handles.map((face) => ({ type: runtime.surfaceType(face), center: runtime.getSurfaceCenterOfMass(face) }));
    try {
      // occt-wasm's MakeThickSolid wrapper uses a positive offset to keep the
      // source outer skin and offset the cavity inward. ForgeMind therefore
      // keeps its public positive-thickness=inward contract without leaking a
      // kernel-specific sign into Feature design data.
      result = runtime.shell(record.handle, handles, thicknessMm, DEFAULT_CAD_TOLERANCE.boolean);
      const registered = this.registerShape(result); result = undefined;
      const validation = await this.validate(registered);
      if (!validation.valid) { await this.disposeShape(registered); throw new Error("OCCT Shell returned an invalid B-Rep."); }
      return registered;
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelReferenceError || error instanceof KernelOperationError) throw error;
      // Keep the requested wall thickness unchanged. If the source contains
      // small sewing/tolerance defects, heal it and re-identify the removal
      // faces by analytic type and surface centroid before retrying.
      try {
        healed = runtime.healSolid(record.handle, DEFAULT_CAD_TOLERANCE.boolean);
        const candidates = runtime.getSubShapes(healed, "face"); healedFaces = candidates;
        const available = new Set(candidates);
        const distance = (a: Vec3,b: Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
        const matched = descriptors.map((descriptor) => {
          const ranked = [...available].filter((face)=>runtime.surfaceType(face)===descriptor.type).map((face)=>({face,distance:distance(runtime.getSurfaceCenterOfMass(face),descriptor.center)})).sort((a,b)=>a.distance-b.distance);
          const selected = ranked[0]?.face; if (selected !== undefined) available.delete(selected); return selected;
        });
        if (matched.some((face)=>face===undefined)) throw error;
        result = runtime.shell(healed, matched as ShapeHandle[], thicknessMm, DEFAULT_CAD_TOLERANCE.boolean);
        const registered = this.registerShape(result); result = undefined;
        const validation = await this.validate(registered);
        if (!validation.valid) { await this.disposeShape(registered); throw error; }
        registered.operationWarnings = ["抽壳已修复输入面的连接和容差，原设计壁厚保持不变。"];
        return registered;
      } catch { throw new KernelOperationError("shell", errorMessage(error), "KERNEL_SHELL_FAILED"); }
    } finally {
      if (result !== undefined) this.releaseHandle(runtime, result);
      healedFaces.forEach((face)=>this.releaseHandle(runtime,face));
      if (healed !== undefined) this.releaseHandle(runtime,healed);
    }
  }

  async validate(shape: KernelShapeRef): Promise<KernelValidationResult> {
    const { runtime, record } = this.resolveShape(shape, "validate");
    try {
      const valid = runtime.isValid(record.handle);
      return valid
        ? { valid: true, issues: [] }
        : {
            valid: false,
            issues: [{ severity: "error", code: "OCCT_INVALID_SHAPE", message: "OpenCascade reports invalid shape." }],
          };
    } catch (error) {
      throw new KernelOperationError("validate", errorMessage(error), "OCCT_VALIDATE_FAILED");
    }
  }

  async heal(shape: KernelShapeRef): Promise<KernelShapeRef> {
    const { runtime, record } = this.resolveShape(shape, "heal");
    try {
      return this.registerShape(runtime.fixShape(record.handle));
    } catch (error) {
      throw new KernelOperationError("heal", errorMessage(error), "OCCT_HEAL_FAILED");
    }
  }

  async getShapeProperties(shape: KernelShapeRef): Promise<KernelShapeProperties> {
    const { runtime, record } = this.resolveShape(shape, "getShapeProperties");
    try {
      const boundingBox = runtime.getBoundingBox(record.handle);
      const center = runtime.getCenterOfMass(record.handle);
      return {
        boundingBox: {
          min: { x: boundingBox.xmin, y: boundingBox.ymin, z: boundingBox.zmin },
          max: { x: boundingBox.xmax, y: boundingBox.ymax, z: boundingBox.zmax },
        },
        volumeMm3: runtime.getVolume(record.handle),
        surfaceAreaMm2: runtime.getSurfaceArea(record.handle),
        centerOfMassMm: { x: center.x, y: center.y, z: center.z },
      };
    } catch (error) {
      throw new KernelOperationError("getShapeProperties", errorMessage(error), "OCCT_PROPERTIES_FAILED");
    }
  }

  async getFaces(shape: KernelShapeRef): Promise<KernelFaceInfo[]> {
    const { runtime, record } = this.resolveShape(shape, "getFaces");
    const cache = this.ensureTopologyCache(runtime, record, shape);
    return [...cache.faces.values()].map(({ info }) => info);
  }

  async getFaceInfo(topology: KernelTopologyRef): Promise<KernelFaceInfo> {
    return this.resolveTopologyRef<KernelFaceInfo>(topology, "face", "getFaceInfo").info;
  }

  async getEdges(shape: KernelShapeRef): Promise<KernelEdgeInfo[]> {
    const { runtime, record } = this.resolveShape(shape, "getEdges");
    const cache = this.ensureTopologyCache(runtime, record, shape);
    return [...cache.edges.values()].map(({ info }) => info);
  }

  async getEdgeInfo(topology: KernelTopologyRef): Promise<KernelEdgeInfo> {
    return this.resolveTopologyRef<KernelEdgeInfo>(topology, "edge", "getEdgeInfo").info;
  }

  async getEdgeGeometry(topology: KernelTopologyRef): Promise<KernelEdgeGeometry> {
    const runtime = this.requireRuntime("getEdgeGeometry");
    const { handle, info } = this.resolveTopologyRef<KernelEdgeInfo>(topology, "edge", "getEdgeGeometry");
    if (info.curveType === "line" && info.startMm && info.endMm) return { type: "line", startMm: info.startMm, endMm: info.endMm };
    if (info.curveType === "bspline") {
      try {
        const data = runtime.getNurbsCurveData(handle);
        const parameters = runtime.curveParameters(handle);
        const poleCount = data.poles.length / 3;
        const weights = data.rational ? [...data.weights] : Array.from({ length: poleCount }, () => 1);
        const valid = Number.isInteger(data.degree) && data.degree >= 1
          && Number.isInteger(poleCount) && poleCount >= data.degree + 1
          && weights.length === poleCount
          && data.knots.length === data.multiplicities.length && data.knots.length > 0
          && data.poles.every(Number.isFinite) && weights.every((weight) => Number.isFinite(weight) && weight > 0)
          && data.knots.every(Number.isFinite) && data.multiplicities.every((value) => Number.isInteger(value) && value > 0)
          && Number.isFinite(parameters.first) && Number.isFinite(parameters.last);
        if (!valid) return { type: "unsupported", curveType: "bspline" };
        const polesMm = Array.from({ length: poleCount }, (_, index) => ({ x: data.poles[index * 3], y: data.poles[index * 3 + 1], z: data.poles[index * 3 + 2] }));
        return { type: "bspline", degree: data.degree, rational: data.rational, periodic: data.periodic, knots: [...data.knots], multiplicities: [...data.multiplicities], polesMm, weights, firstParameter: parameters.first, lastParameter: parameters.last };
      } catch {
        return { type: "unsupported", curveType: "bspline" };
      }
    }
    if (info.curveType !== "circle") return { type: "unsupported", curveType: info.curveType ?? "other" };
    const parameters = runtime.curveParameters(handle); const first = parameters.first; const last = parameters.last;
    const point = (parameter: number) => runtime.curvePointAtParam(handle, parameter);
    const a = point(first); const b = point(first + (last - first) / 3); const c = point(first + (last - first) * 2 / 3);
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = normalised({ x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x });
    const ab2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z, ac2 = ac.x * ac.x + ac.y * ac.y + ac.z * ac.z;
    const crossNab = { x: normal.y * ab.z - normal.z * ab.y, y: normal.z * ab.x - normal.x * ab.z, z: normal.x * ab.y - normal.y * ab.x };
    const denominator = 2 * (ab.x * (ac.y * normal.z - ac.z * normal.y) + ab.y * (ac.z * normal.x - ac.x * normal.z) + ab.z * (ac.x * normal.y - ac.y * normal.x));
    if (Math.abs(denominator) <= DEFAULT_CAD_TOLERANCE.geometry) return { type: "unsupported", curveType: "circle" };
    const crossAcN = { x: ac.y * normal.z - ac.z * normal.y, y: ac.z * normal.x - ac.x * normal.z, z: ac.x * normal.y - ac.y * normal.x };
    const center = { x: a.x + (ac2 * crossNab.x + ab2 * crossAcN.x) / denominator, y: a.y + (ac2 * crossNab.y + ab2 * crossAcN.y) / denominator, z: a.z + (ac2 * crossNab.z + ab2 * crossAcN.z) / denominator };
    const radiusMm = vectorLength({ x: a.x - center.x, y: a.y - center.y, z: a.z - center.z }); const startMm = point(first); const endMm = point(last);
    if (runtime.curveIsClosed(handle)) return { type: "circle", centerMm: center, normal, radiusMm };
    const tangent = runtime.curveTangent(handle, first); const radial = { x: startMm.x - center.x, y: startMm.y - center.y, z: startMm.z - center.z }; const orientation = radial.x * tangent.y * normal.z + radial.y * tangent.z * normal.x + radial.z * tangent.x * normal.y - radial.x * tangent.z * normal.y - radial.y * tangent.x * normal.z - radial.z * tangent.y * normal.x;
    return { type: "arc", centerMm: center, normal, radiusMm, startMm, endMm, clockwise: orientation < 0 };
  }

  async tessellate(shape: KernelShapeRef, options: KernelTessellationOptions): Promise<KernelTessellation> {
    if (options.linearDeflectionMm <= 0 || options.angularDeflectionDeg <= 0) {
      throw new KernelValidationError("tessellate", "Tessellation deflection values must be positive.", "INVALID_TESSELLATION_OPTIONS");
    }
    const { runtime, record } = this.resolveShape(shape, "tessellate");
    try {
      const mesh = runtime.meshShape(record.handle, {
        linearDeflection: options.linearDeflectionMm,
        angularDeflection: options.angularDeflectionDeg * Math.PI / 180,
      });
      const triangleCount = mesh.indices.length / 3;
      if (!Number.isInteger(triangleCount)) {
        throw new KernelOperationError("tessellate", "OCCT returned an incomplete triangle index buffer.", "INVALID_TESSELLATION_INDICES");
      }
      const faceGroups = mesh.faceGroups;
      if (!faceGroups || faceGroups.length === 0 || faceGroups.length % 3 !== 0) {
        throw new KernelOperationError("tessellate", "OCCT did not return usable face mapping data.", "FACE_MAPPING_UNAVAILABLE");
      }
      const cache = this.ensureTopologyCache(runtime, record, shape);
      const triangleFaceIndices = new Uint32Array(triangleCount);
      const mapped = new Uint8Array(triangleCount);
      const faces: KernelFaceDescriptor[] = [];

      for (let groupIndex = 0; groupIndex < faceGroups.length; groupIndex += 3) {
        // occt-wasm 4.3.1 returns face-group offsets and counts in the flat
        // index buffer (not in triangle units), despite its high-level label.
        const indexStart = faceGroups[groupIndex];
        const indexCount = faceGroups[groupIndex + 1];
        const faceHash = faceGroups[groupIndex + 2];
        const localId = cache.faceIdsByHash.get(faceHash);
        if (localId === undefined) {
          throw new KernelOperationError("tessellate", `OCCT face hash ${faceHash} has no matching subshape.`, "FACE_MAPPING_MISSING");
        }
        if (indexStart < 0 || indexCount <= 0 || indexStart % 3 !== 0 || indexCount % 3 !== 0 || indexStart + indexCount > mesh.indices.length) {
          throw new KernelOperationError("tessellate", "OCCT returned an invalid face triangle range.", "INVALID_FACE_GROUP_RANGE");
        }
        const triangleStart = indexStart / 3;
        const groupTriangleCount = indexCount / 3;
        let faceIndex = faces.findIndex((face) => face.topology.localId === localId);
        if (faceIndex < 0) {
          faceIndex = faces.length;
          faces.push({
            index: faceIndex,
            topology: { shapeId: shape.id, shapeRevision: shape.revision, kind: "face", localId },
          });
        }
        for (let triangle = triangleStart; triangle < triangleStart + groupTriangleCount; triangle += 1) {
          if (mapped[triangle]) {
            throw new KernelOperationError("tessellate", "OCCT face groups overlap.", "OVERLAPPING_FACE_GROUPS");
          }
          mapped[triangle] = 1;
          triangleFaceIndices[triangle] = faceIndex;
        }
      }
      if (mapped.some((value) => value === 0)) {
        throw new KernelOperationError("tessellate", "OCCT did not map every triangle to a face.", "INCOMPLETE_FACE_MAPPING");
      }
      return {
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        triangleFaceIndices,
        faces,
      };
    } catch (error) {
      if (error instanceof KernelOperationError || error instanceof KernelValidationError) throw error;
      throw new KernelOperationError("tessellate", errorMessage(error), "OCCT_TESSELLATION_FAILED");
    }
  }

  async getEdgePolylines(shape: KernelShapeRef): Promise<KernelEdgePolyline[]> {
    const { runtime, record } = this.resolveShape(shape, "getEdgePolylines");
    const cache = this.ensureTopologyCache(runtime, record, shape);
    if (cache.edgePolylines) return cache.edgePolylines;
    try {
      const wireframe = runtime.wireframe(record.handle, DEFAULT_CAD_TOLERANCE.tessellation.linearDeflection);
      if (wireframe.edgeGroups.length % 3 !== 0) {
        throw new KernelOperationError("getEdgePolylines", "OCCT returned invalid edge wireframe groups.", "INVALID_EDGE_GROUPS");
      }
      const polylines: KernelEdgePolyline[] = [];
      for (let index = 0; index < wireframe.edgeGroups.length; index += 3) {
        const pointStart = wireframe.edgeGroups[index];
        const pointCount = wireframe.edgeGroups[index + 1];
        const hash = wireframe.edgeGroups[index + 2];
        const localId = cache.edgeIdsByHash.get(hash);
        if (!localId || pointStart < 0 || pointCount < 6 || pointStart + pointCount > wireframe.points.length || pointStart % 3 !== 0 || pointCount % 3 !== 0) {
          throw new KernelOperationError("getEdgePolylines", "OCCT returned an unusable edge wireframe range.", "INVALID_EDGE_GROUP_RANGE");
        }
        polylines.push({
          topology: { shapeId: shape.id, shapeRevision: shape.revision, kind: "edge", localId },
          positions: wireframe.points.slice(pointStart, pointStart + pointCount),
        });
      }
      cache.edgePolylines = polylines;
      return polylines;
    } catch (error) {
      if (error instanceof KernelOperationError) throw error;
      throw new KernelOperationError("getEdgePolylines", errorMessage(error), "OCCT_EDGE_WIREFRAME_FAILED");
    }
  }

  private createProfileFace(profile: KernelProfileInput, operation: "extrude" | "revolve"): { runtime: OcctWasmRuntime; face: ShapeHandle; temporaryHandles: ShapeHandle[] } {
    if (profile.profile.holes.length > 0) unavailable(`${operation}.holes`);
    const segments = this.validateProfile(profile.profile.outer, operation);
    const built = this.createCurveWire(segments, profile.plane, operation);
    try {
      return { runtime: built.runtime, face: built.runtime.makeFace(built.wire), temporaryHandles: built.temporaryHandles };
    } catch (error) {
      for (const handle of built.temporaryHandles.reverse()) this.releaseHandle(built.runtime, handle);
      if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error;
      throw new KernelOperationError(operation, errorMessage(error), `OCCT_${operation.toUpperCase()}_PROFILE_FAILED`);
    }
  }

  private createProfileWire(profile: KernelProfileInput, operation: "sweep" | "loft"): { runtime: OcctWasmRuntime; wire: ShapeHandle; temporaryHandles: ShapeHandle[] } {
    if (profile.profile.holes.length > 0) unavailable(`${operation}.holes`);
    const segments = this.validateProfile(profile.profile.outer, operation);
    return this.createCurveWire(segments, profile.plane, operation);
  }

  private createPathWire(path: KernelPathInput, operation: "sweep"): { runtime: OcctWasmRuntime; wire: ShapeHandle; temporaryHandles: ShapeHandle[] } {
    if (path.splinePoints) {
      if (path.segments.length) throw new KernelValidationError(operation, "A sweep path cannot mix an interpolated Spline with Line/Arc segments.", "SWEEP_PATH_MIXED_CURVES");
      if (path.splinePoints.length < 3 || path.splinePoints.some((point) => !hasFinitePoint(point))) throw new KernelValidationError(operation, "An interpolated Spline path requires at least three finite points.", "SWEEP_PATH_SPLINE_INVALID");
      const runtime = this.requireRuntime(operation); const temporaryHandles: ShapeHandle[] = [];
      try {
        const worldPoints = path.splinePoints.map((point) => this.toWorldPoint(point, path.plane));
        const hasTangents = !!path.splineStartTangent && !!path.splineEndTangent;
        if ((path.splineStartTangent && !path.splineEndTangent) || (!path.splineStartTangent && path.splineEndTangent)) throw new KernelValidationError(operation, "Both start and end spline tangents are required together.", "SWEEP_PATH_SPLINE_TANGENTS_INCOMPLETE");
        const planeVector = (vector: [number, number]): Vec3 => ({ x: path.plane.xAxis.x * vector[0] + path.plane.yAxis.x * vector[1], y: path.plane.xAxis.y * vector[0] + path.plane.yAxis.y * vector[1], z: path.plane.xAxis.z * vector[0] + path.plane.yAxis.z * vector[1] });
        const startTangent = hasTangents ? planeVector(path.splineStartTangent!) : undefined;
        const endTangent = hasTangents ? planeVector(path.splineEndTangent!) : undefined;
        if ((startTangent && (![startTangent.x,startTangent.y,startTangent.z].every(Number.isFinite) || vectorLength(startTangent) <= DEFAULT_CAD_TOLERANCE.geometry)) || (endTangent && (![endTangent.x,endTangent.y,endTangent.z].every(Number.isFinite) || vectorLength(endTangent) <= DEFAULT_CAD_TOLERANCE.geometry))) throw new KernelValidationError(operation, "Spline endpoint tangents must be finite non-zero directions.", "SWEEP_PATH_SPLINE_TANGENT_INVALID");
        const edge = hasTangents ? runtime.interpolatePointsWithTangents(worldPoints, startTangent!, endTangent!) : runtime.interpolatePoints(worldPoints, path.splinePeriodic ?? false);
        temporaryHandles.push(edge);
        const wire = runtime.makeWire([edge]); temporaryHandles.push(wire);
        return { runtime, wire, temporaryHandles };
      } catch (error) { for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle); if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error; throw new KernelOperationError(operation, errorMessage(error), "OCCT_SWEEP_SPLINE_WIRE_FAILED"); }
    }
    const segments = path.segments;
    if (!segments.length) throw new KernelValidationError(operation, "Sweep path must contain an open Line or Arc chain.", "SWEEP_PATH_EMPTY");
    if (segments.some((segment) => segment.type === "circle" || segment.type === "bspline")) throw new KernelValidationError(operation, "Sweep segment paths accept Line/Arc chains; use splinePoints for B-Spline paths.", "SWEEP_PATH_BRANCHING_UNSUPPORTED");
    const endpoints = segments.map((segment) => segment.type === "line" ? { start: segment.start, end: segment.end } : { start: this.arcPoint(segment as Extract<ProfileSegment,{type:"arc"}>, (segment as Extract<ProfileSegment,{type:"arc"}>).startAngleDeg), end: this.arcPoint(segment as Extract<ProfileSegment,{type:"arc"}>, (segment as Extract<ProfileSegment,{type:"arc"}>).endAngleDeg) });
    for (let index = 0; index < endpoints.length; index += 1) {
      const endpoint = endpoints[index];
      if (!endpoint || !hasFinitePoint(endpoint.start) || !hasFinitePoint(endpoint.end) || Math.hypot(endpoint.end[0] - endpoint.start[0], endpoint.end[1] - endpoint.start[1]) <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError(operation, "Sweep path contains an invalid curve.", "SWEEP_PATH_INVALID");
      if (index && !samePoint(endpoints[index - 1].end, endpoint.start)) throw new KernelValidationError(operation, "Sweep path endpoints are not continuous.", "SWEEP_PATH_NOT_CONTINUOUS");
    }
    return this.createCurveWire(segments, path.plane, operation);
  }

  private createCurveWire(segments: ProfileSegment[], plane: KernelPlaneFrame, operation: string): { runtime: OcctWasmRuntime; wire: ShapeHandle; temporaryHandles: ShapeHandle[] } {
    const runtime = this.requireRuntime(operation); const temporaryHandles: ShapeHandle[] = [];
    try {
      const normal = normalised(plane.normal); const edges = segments.map((segment) => {
        let edge: ShapeHandle;
        if (segment.type === "line") edge = runtime.makeLineEdge(this.toWorldPoint(segment.start, plane), this.toWorldPoint(segment.end, plane));
        else if (segment.type === "circle") edge = runtime.makeCircleEdge(this.toWorldPoint(segment.center, plane), normal, segment.radius);
        else if (segment.type === "bspline") {
          const points = segment.fitPoints.map((point) => this.toWorldPoint(point, plane));
          if (segment.nurbs) {
            validateNurbsCurve2D({
              degree: segment.nurbs.degree,
              rational: segment.nurbs.weights.some((weight) => Math.abs(weight - 1) > 1e-12),
              periodic: segment.periodic,
              knots: segment.nurbs.knots,
              multiplicities: segment.nurbs.multiplicities,
              controlPoints: segment.fitPoints.map(([x, y]) => ({ x, y })),
              weights: segment.nurbs.weights,
              firstParameter: segment.nurbs.firstParameter,
              lastParameter: segment.nurbs.lastParameter,
            });
            edge = runtime.makeBSplineEdge(
              points.flatMap((point) => [point.x, point.y, point.z]),
              segment.nurbs.weights,
              segment.nurbs.knots,
              segment.nurbs.multiplicities,
              segment.nurbs.degree,
              segment.periodic,
            );
          }
          else if (segment.periodic) edge = runtime.interpolatePoints(points, true);
          else if (segment.startTangent && segment.endTangent) {
            const vector = (value: [number, number]): Vec3 => ({ x: plane.xAxis.x * value[0] + plane.yAxis.x * value[1], y: plane.xAxis.y * value[0] + plane.yAxis.y * value[1], z: plane.xAxis.z * value[0] + plane.yAxis.z * value[1] });
            edge = runtime.interpolatePointsWithTangents(points, vector(segment.startTangent), vector(segment.endTangent));
          } else edge = runtime.interpolatePoints(points, false);
        } else edge = runtime.makeArcEdge(this.toWorldPoint(this.arcPoint(segment, segment.startAngleDeg), plane), this.toWorldPoint(this.arcPoint(segment, this.arcMidAngle(segment)), plane), this.toWorldPoint(this.arcPoint(segment, segment.endAngleDeg), plane));
        temporaryHandles.push(edge); return edge;
      });
      const wire = runtime.makeWire(edges); temporaryHandles.push(wire); return { runtime, wire, temporaryHandles };
    } catch (error) { for (const handle of temporaryHandles.reverse()) this.releaseHandle(runtime, handle); if (error instanceof KernelValidationError || error instanceof KernelOperationError) throw error; throw new KernelOperationError(operation, errorMessage(error), `OCCT_${operation.toUpperCase()}_WIRE_FAILED`); }
  }

  private validateProfile(segments: ProfileSegment[], operation: string): ProfileSegment[] {
    if (segments.length === 0) throw new KernelValidationError(operation, "A closed profile needs at least one exact curve or a closed boundary.", "OPEN_PROFILE");
    if (segments.some((segment) => segment.type === "circle")) {
      const circle = segments[0];
      if (segments.length !== 1 || !circle || circle.type !== "circle") {
        throw new KernelValidationError(operation, "A full circle must be the only segment in its closed profile.", "INVALID_CIRCLE_PROFILE");
      }
      if (!hasFinitePoint(circle.center) || !Number.isFinite(circle.radius) || circle.radius <= DEFAULT_CAD_TOLERANCE.geometry) {
        throw new KernelValidationError(operation, "Circle centre and radius must be finite, with a positive radius.", "INVALID_CIRCLE_PROFILE");
      }
      return segments;
    }
    if (segments.some((segment) => segment.type === "bspline")) {
      const curve = segments[0];
      if (segments.length !== 1 || !curve || curve.type !== "bspline") throw new KernelValidationError(operation, "A B-Spline profile must be one standalone closed curve.", "INVALID_BSPLINE_PROFILE");
      if (curve.fitPoints.length < 3 || curve.fitPoints.some((point) => !hasFinitePoint(point))) throw new KernelValidationError(operation, "A periodic B-Spline profile requires at least three finite fit points.", "INVALID_BSPLINE_PROFILE");
      if (!curve.periodic) {
        const first = curve.fitPoints[0], last = curve.fitPoints.at(-1)!;
        if (!curve.nurbs || !samePoint(first, last)) throw new KernelValidationError(operation, "A non-periodic NURBS profile must have coincident first and last control poles.", "INVALID_BSPLINE_PROFILE");
      }
      if (curve.startTangent || curve.endTangent) throw new KernelValidationError(operation, "Closed B-Spline profiles cannot use endpoint tangents.", "INVALID_BSPLINE_PROFILE");
      if (curve.nurbs) validateNurbsCurve2D({ degree: curve.nurbs.degree, rational: curve.nurbs.weights.some((weight) => Math.abs(weight - 1) > 1e-12), periodic: curve.periodic, knots: curve.nurbs.knots, multiplicities: curve.nurbs.multiplicities, controlPoints: curve.fitPoints.map(([x,y]) => ({x,y})), weights: curve.nurbs.weights, firstParameter: curve.nurbs.firstParameter, lastParameter: curve.nurbs.lastParameter });
      const area = curve.fitPoints.reduce((sum, point, index) => { const next = curve.fitPoints[(index + 1) % curve.fitPoints.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2;
      if (Math.abs(area) <= DEFAULT_CAD_TOLERANCE.geometry) throw new KernelValidationError(operation, "Periodic B-Spline fit points do not enclose a usable area.", "INVALID_BSPLINE_PROFILE");
      return segments;
    }
    if (segments.length < 2) throw new KernelValidationError(operation, "A non-circular closed profile needs at least two boundary segments.", "OPEN_PROFILE");
    const endpoints = segments.map((segment) => {
      if (segment.type === "line") {
        if (!hasFinitePoint(segment.start) || !hasFinitePoint(segment.end) || Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) <= DEFAULT_CAD_TOLERANCE.geometry) {
          throw new KernelValidationError(operation, "Profile contains an invalid line segment.", "INVALID_PROFILE_POINT");
        }
        return { start: segment.start, end: segment.end };
      }
      if (segment.type === "arc") {
        if (!hasFinitePoint(segment.center) || !Number.isFinite(segment.radius) || segment.radius <= DEFAULT_CAD_TOLERANCE.geometry || !Number.isFinite(segment.startAngleDeg) || !Number.isFinite(segment.endAngleDeg) || Math.abs(this.arcSweep(segment)) <= DEFAULT_CAD_TOLERANCE.geometry) {
          throw new KernelValidationError(operation, "Profile contains an invalid arc segment.", "INVALID_ARC_PROFILE");
        }
        return { start: this.arcPoint(segment, segment.startAngleDeg), end: this.arcPoint(segment, segment.endAngleDeg) };
      }
      throw new KernelValidationError(operation, "Circle segments must be standalone closed profiles.", "INVALID_CIRCLE_PROFILE");
    });
    for (let index = 0; index < endpoints.length; index += 1) {
      if (!samePoint(endpoints[index].end, endpoints[(index + 1) % endpoints.length].start)) {
        throw new KernelValidationError(operation, "Profile loop is not closed.", "OPEN_PROFILE");
      }
    }
    return segments;
  }

  private arcSweep(segment: Extract<ProfileSegment, { type: "arc" }>): number {
    const raw = segment.endAngleDeg - segment.startAngleDeg;
    if (segment.clockwise) return raw >= 0 ? raw - 360 : raw;
    return raw <= 0 ? raw + 360 : raw;
  }

  private arcMidAngle(segment: Extract<ProfileSegment, { type: "arc" }>): number {
    return segment.startAngleDeg + this.arcSweep(segment) / 2;
  }

  private arcPoint(segment: Extract<ProfileSegment, { type: "arc" }>, angleDeg: number): [number, number] {
    const angle = angleDeg * Math.PI / 180;
    return [segment.center[0] + segment.radius * Math.cos(angle), segment.center[1] + segment.radius * Math.sin(angle)];
  }

  private pathStart(path: KernelPathInput): Vec3 {
    if (path.splinePoints?.length) return this.toWorldPoint(path.splinePoints[0], path.plane);
    const first = path.segments[0]; if (!first) throw new KernelValidationError("sweep", "Sweep path is empty.", "SWEEP_PATH_EMPTY");
    const local = first.type === "line" ? first.start : first.type === "arc" ? this.arcPoint(first, first.startAngleDeg) : first.type === "bspline" ? first.fitPoints[0] : first.center; return this.toWorldPoint(local, path.plane);
  }

  private verifyBoundarySurfaceContinuity(runtime: OcctWasmRuntime, patch: ShapeHandle, boundaryEdges: KernelTopologyRef[], options: KernelBoundarySurfaceOptions): void {
    const operation = "boundarySurface";
    const count = Math.max(3, Math.min(21, Math.trunc(options.sampleCount ?? 7)));
    const angularTolerance = options.angularToleranceDeg ?? .5;
    const curvatureTolerance = options.curvatureTolerance ?? 1e-3;
    const failures: string[] = [];
    for (const topology of boundaryEdges) {
      const resolvedEdge = this.resolveTopologyRef<KernelEdgeInfo>(topology, "edge", operation);
      const { record } = this.resolveShape({ id: topology.shapeId, revision: topology.shapeRevision }, operation);
      const cache = this.ensureTopologyCache(runtime, record, { id: topology.shapeId, revision: topology.shapeRevision });
      const mappedSupportFaces = (resolvedEdge.info.adjacentFaceIds ?? []).map((id) => cache.faces.get(id)).filter((entry): entry is RuntimeTopologyRecord<KernelFaceInfo> => !!entry);
      const supportFaces = mappedSupportFaces.length ? mappedSupportFaces : cache.faces.size === 1 ? [...cache.faces.values()] : [];
      if (!supportFaces.length) { failures.push(`${topology.localId}: no adjacent support face`); continue; }
      const parameters = runtime.curveParameters(resolvedEdge.handle);
      let best: { face: RuntimeTopologyRecord<KernelFaceInfo>; maxAngle: number; maxCurvature: number } | undefined;
      for (const face of supportFaces) {
        let maxAngle = 0, maxCurvature = 0, valid = true;
        for (let index = 0; index < count; index += 1) {
          const ratio = (index + 1) / (count + 1);
          const point = runtime.curvePointAtParam(resolvedEdge.handle, parameters.first + (parameters.last - parameters.first) * ratio);
          try {
            const patchUv = runtime.uvFromPoint(patch, point), supportUv = runtime.uvFromPoint(face.handle, point);
            const patchNormal = normalised(runtime.surfaceNormal(patch, patchUv.u, patchUv.v)), supportNormal = normalised(runtime.surfaceNormal(face.handle, supportUv.u, supportUv.v));
            const dot = Math.max(-1, Math.min(1, Math.abs(patchNormal.x * supportNormal.x + patchNormal.y * supportNormal.y + patchNormal.z * supportNormal.z)));
            maxAngle = Math.max(maxAngle, Math.acos(dot) * 180 / Math.PI);
            if (options.continuity === "G2") {
              const patchCurvature = runtime.surfaceCurvature(patch, patchUv.u, patchUv.v), supportCurvature = runtime.surfaceCurvature(face.handle, supportUv.u, supportUv.v);
              maxCurvature = Math.max(maxCurvature, Math.abs(Math.abs(patchCurvature.min) - Math.abs(supportCurvature.min)), Math.abs(Math.abs(patchCurvature.max) - Math.abs(supportCurvature.max)));
            }
          } catch { valid = false; break; }
        }
        if (valid && (!best || maxAngle < best.maxAngle || maxAngle === best.maxAngle && maxCurvature < best.maxCurvature)) best = { face, maxAngle, maxCurvature };
      }
      if (!best) failures.push(`${topology.localId}: support evaluation failed`);
      else if (best.maxAngle > angularTolerance) failures.push(`${topology.localId}: normal delta ${best.maxAngle.toFixed(4)}° > ${angularTolerance}°`);
      else if (options.continuity === "G2" && best.maxCurvature > curvatureTolerance) failures.push(`${topology.localId}: curvature delta ${best.maxCurvature.toExponential(3)} > ${curvatureTolerance.toExponential(3)}`);
    }
    if (failures.length) throw new KernelValidationError(operation, `${options.continuity} continuity target was not met; no feature was committed. ${failures.join("; ")}`, "SURFACE_CONTINUITY_TARGET_NOT_MET");
  }

  private executeBoolean(
    operation: "booleanUnion" | "booleanCut",
    target: KernelShapeRef,
    tools: KernelShapeRef[],
    operationFn: (runtime: OcctWasmRuntime, target: ShapeHandle, tools: ShapeHandle[]) => ShapeHandle,
  ): Promise<KernelShapeRef> {
    if (tools.length === 0) {
      return Promise.reject(new KernelValidationError(operation, "Boolean operations require at least one tool shape.", "EMPTY_BOOLEAN_TOOLS"));
    }
    try {
      const { runtime, record: targetRecord } = this.resolveShape(target, operation);
      const toolHandles = tools.map((tool) => this.resolveShape(tool, operation).record.handle);
      let resultHandle: ShapeHandle | undefined = operationFn(runtime, targetRecord.handle, toolHandles);
      try {
        const result = this.registerSolidResult(runtime, resultHandle, operation);
        resultHandle = undefined;
        return Promise.resolve(result);
      } finally {
        if (resultHandle !== undefined) this.releaseHandle(runtime, resultHandle);
      }
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) return Promise.reject(error);
      return Promise.reject(new KernelOperationError(operation, errorMessage(error), "OCCT_BOOLEAN_FAILED"));
    }
  }

  private transformSolid(
    operation: "translate" | "rotate" | "mirror",
    shape: KernelShapeRef,
    transform: (runtime: OcctWasmRuntime, handle: ShapeHandle) => ShapeHandle,
  ): Promise<KernelShapeRef> {
    try {
      const { runtime, record } = this.resolveShape(shape, operation);
      let transformed: ShapeHandle | undefined = transform(runtime, record.handle);
      try {
        let result: KernelShapeRef;
        if (runtime.isCompound(transformed)) {
          const solids = runtime.getSubShapes(transformed, "solid");
          try {
            if (!solids.length || !runtime.isValid(transformed)) throw new KernelValidationError(operation, "Body transform produced an invalid compound.", "TRANSFORM_INVALID_COMPOUND");
          } finally { for (const solid of solids) this.releaseHandle(runtime, solid); }
          result = this.registerShape(transformed);
        } else result = this.registerSolidResult(runtime, transformed, operation);
        transformed = undefined;
        return Promise.resolve(result);
      } finally {
        if (transformed !== undefined) this.releaseHandle(runtime, transformed);
      }
    } catch (error) {
      if (error instanceof KernelValidationError || error instanceof KernelOperationError || error instanceof KernelReferenceError) return Promise.reject(error);
      return Promise.reject(new KernelOperationError(operation, errorMessage(error), "OCCT_TRANSFORM_FAILED"));
    }
  }

  /** Registers a valid Face/Shell/Compound surface result without forcing a Solid downcast. */
  private registerSurfaceResult(runtime: OcctWasmRuntime, rawResult: ShapeHandle, operation: string): KernelShapeRef {
    if (runtime.isNull(rawResult)) throw new KernelOperationError(operation, "Surface operation produced an empty shape.", "SURFACE_EMPTY_RESULT");
    if (!runtime.isValid(rawResult)) throw new KernelValidationError(operation, "Surface operation produced an invalid B-Rep.", "SURFACE_INVALID_RESULT");
    if (runtime.isSolid(rawResult)) throw new KernelOperationError(operation, "Surface operation unexpectedly produced a solid.", "SURFACE_RESULT_IS_SOLID");
    return this.registerShape(rawResult);
  }

  /** Converts an OCCT operation output to exactly one valid solid owned by this arena. */
  private registerSolidResult(
    runtime: OcctWasmRuntime,
    rawResult: ShapeHandle,
    operation: "booleanUnion" | "booleanCut" | "booleanIntersect" | "revolve" | "sweep" | "loft" | "translate" | "rotate" | "mirror" | "draft" | "offset" | "defeature" | "conicalTool" | "cylindricalTool" | "thickenSurface" | "encloseSurfaces" | "mechanicalDetail" | "fillet" | "filletVariable" | "chamfer",
  ): KernelShapeRef {
    let resultHandle = rawResult;
    if (runtime.isNull(resultHandle)) {
      throw new KernelOperationError(operation, "Boolean operation produced an empty shape.", "BOOLEAN_EMPTY_RESULT");
    }
    if (runtime.isCompound(resultHandle)) {
      const solids = runtime.getSubShapes(resultHandle, "solid");
      let extractedSolid: ShapeHandle | undefined;
      try {
        if (solids.length !== 1 && operation !== "mechanicalDetail") {
          throw new KernelOperationError(operation, "Boolean result contains multiple solids and cannot represent one body.", "BOOLEAN_COMPOUND_MULTIPLE_SOLIDS");
        }
        if (!solids.length) throw new KernelOperationError(operation, "Operation result does not contain a solid.", "BOOLEAN_RESULT_NOT_SOLID");
        // A helical machining cut can leave microscopic detached chips at its
        // open ends. They are manufacturing waste, not part of the component.
        extractedSolid = operation === "mechanicalDetail" && solids.length > 1
          ? solids.reduce((largest, candidate) => runtime.getVolume(candidate) > runtime.getVolume(largest) ? candidate : largest)
          : solids[0];
        resultHandle = extractedSolid;
      } finally {
        for (const solid of solids) {
          if (solid !== extractedSolid) this.releaseHandle(runtime, solid);
        }
        this.releaseHandle(runtime, rawResult);
      }
    }
    if (!runtime.isSolid(resultHandle)) {
      throw new KernelOperationError(operation, "Boolean result is not a solid.", "BOOLEAN_RESULT_NOT_SOLID");
    }
    if (!runtime.isValid(resultHandle)) {
      throw new KernelValidationError(operation, "Boolean operation produced an invalid shape.", "BOOLEAN_INVALID_RESULT");
    }
    return this.registerShape(resultHandle);
  }

  private releaseHandle(runtime: OcctWasmRuntime, handle: ShapeHandle): void {
    try {
      runtime.release(handle);
    } catch {
      // Cleanup is intentionally best-effort; callers still receive the primary error.
    }
  }

  private async loadBrowserWasm(): Promise<Uint8Array> {
    const wasmUrl = (await import("occt-wasm/dist/occt-wasm.wasm?url")).default;
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`WASM asset request failed with HTTP ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private toWorldPoint(point: [number, number], plane: KernelProfileInput["plane"]): Vec3 {
    return {
      x: plane.origin.x + plane.xAxis.x * point[0] + plane.yAxis.x * point[1],
      y: plane.origin.y + plane.xAxis.y * point[0] + plane.yAxis.y * point[1],
      z: plane.origin.z + plane.xAxis.z * point[0] + plane.yAxis.z * point[1],
    };
  }

  private registerShape(handle: ShapeHandle): KernelShapeRef {
    const id = `shape-${this.nextShapeNumber}`;
    this.nextShapeNumber += 1;
    const revision = 1;
    this.shapes.set(id, { handle, revision, released: false });
    return { id, revision };
  }

  private requireRuntime(operation: string): OcctWasmRuntime {
    if (!this.runtime) {
      throw new KernelInitializationError(`Cannot ${operation} before the OCCT runtime is initialized.`, "OCCT_NOT_INITIALIZED");
    }
    return this.runtime;
  }

  private resolveShape(shape: KernelShapeRef, operation: string): { runtime: OcctWasmRuntime; record: ShapeRuntimeRecord } {
    const runtime = this.requireRuntime(operation);
    const record = this.shapes.get(shape.id);
    if (!record || record.revision !== shape.revision || record.released) {
      throw new KernelReferenceError(operation, `Shape ${shape.id} is unavailable in the current OCCT arena.`, "OCCT_SHAPE_RELEASED");
    }
    return { runtime, record };
  }

  /** getSubShapes materialises owned arena handles; this cache owns and releases them with the parent Shape. */
  private ensureTopologyCache(runtime: OcctWasmRuntime, record: ShapeRuntimeRecord, shape: KernelShapeRef): ShapeTopologyCache {
    if (record.topology) return record.topology;
    const cache: ShapeTopologyCache = { faces: new Map(), faceIdsByHash: new Map(), edges: new Map(), edgeIdsByHash: new Map() };
    const faces = runtime.getSubShapes(record.handle, "face");
    const edges = runtime.getSubShapes(record.handle, "edge");
    try {
      faces.forEach((handle, index) => {
        const hash = runtime.hashCode(handle, FACE_HASH_UPPER_BOUND);
        if (cache.faceIdsByHash.has(hash)) throw new KernelOperationError("getFaces", `OCCT face hash collision: ${hash}.`, "FACE_HASH_COLLISION");
        const localId = `face-${index + 1}`;
        const bounds = runtime.uvBounds(handle);
        // occt-wasm 4.3.1's surfaceNormal(face, u, v) already reflects the
        // TopoDS face orientation (verified on both Box caps); do not flip it twice.
        const normal = normalised(runtime.surfaceNormal(handle, (bounds.uMin + bounds.uMax) / 2, (bounds.vMin + bounds.vMax) / 2));
        const surface = runtime.surfaceType(handle);
        const surfaceType = ["plane", "cylinder", "cone", "sphere", "torus", "bspline"].includes(surface) ? surface as KernelFaceInfo["surfaceType"] : "other";
        const topology: KernelTopologyRef = { shapeId: shape.id, shapeRevision: shape.revision, kind: "face", localId };
        const centerMm = runtime.getSurfaceCenterOfMass(handle);
        let cylindricalFrame: KernelFaceInfo["cylindricalFrame"];
        if (surfaceType === "cylinder") {
          const cylinder = runtime.getFaceCylinderData(handle);
          if (cylinder && Number.isFinite(cylinder.radius) && cylinder.radius > DEFAULT_CAD_TOLERANCE.geometry) {
            const u = (bounds.uMin + bounds.uMax) / 2;
            const vSpan = bounds.vMax - bounds.vMin;
            if (Number.isFinite(vSpan) && Math.abs(vSpan) > DEFAULT_CAD_TOLERANCE.geometry) {
              const p1 = runtime.pointOnSurface(handle, u, bounds.vMin + vSpan * .25);
              const p2 = runtime.pointOnSurface(handle, u, bounds.vMin + vSpan * .75);
              const axisDirection = normalised({ x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z });
              const surfacePoint = runtime.pointOnSurface(handle, u, (bounds.vMin + bounds.vMax) / 2);
              const minus = { x: surfacePoint.x - normal.x * cylinder.radius, y: surfacePoint.y - normal.y * cylinder.radius, z: surfacePoint.z - normal.z * cylinder.radius };
              const plus = { x: surfacePoint.x + normal.x * cylinder.radius, y: surfacePoint.y + normal.y * cylinder.radius, z: surfacePoint.z + normal.z * cylinder.radius };
              const distanceSquared = (point: Vec3) => (point.x - centerMm.x) ** 2 + (point.y - centerMm.y) ** 2 + (point.z - centerMm.z) ** 2;
              cylindricalFrame = { axisOriginMm: distanceSquared(minus) <= distanceSquared(plus) ? minus : plus, axisDirection, radiusMm: cylinder.radius };
            }
          }
        }
        cache.faces.set(localId, { handle, info: {
          topology, hash, areaMm2: runtime.getSurfaceArea(handle), centerMm, surfaceType, normal, cylindricalFrame,
        } });
        cache.faceIdsByHash.set(hash, localId);
      });
      edges.forEach((handle, index) => {
        const hash = runtime.hashCode(handle, FACE_HASH_UPPER_BOUND);
        if (cache.edgeIdsByHash.has(hash)) throw new KernelOperationError("getEdges", `OCCT edge hash collision: ${hash}.`, "EDGE_HASH_COLLISION");
        const localId = `edge-${index + 1}`;
        const parameters = runtime.curveParameters(handle);
        const curve = runtime.curveType(handle);
        const curveType = ["line", "circle", "ellipse", "bspline"].includes(curve) ? curve as KernelEdgeInfo["curveType"] : "other";
        const topology: KernelTopologyRef = { shapeId: shape.id, shapeRevision: shape.revision, kind: "edge", localId };
        cache.edges.set(localId, { handle, info: {
          topology, hash, lengthMm: runtime.curveLength(handle), curveType,
          startMm: runtime.curvePointAtParam(handle, parameters.first), endMm: runtime.curvePointAtParam(handle, parameters.last),
        } });
        cache.edgeIdsByHash.set(hash, localId);
      });
      // OCCT exposes this relationship from the B-Rep itself. V2 signatures
      // use it as runtime adjacency evidence and never infer it from triangles.
      const edgeFaces = runtime.edgeToFaceMap(record.handle, FACE_HASH_UPPER_BOUND);
      const faceEdges = new Map<string, string[]>();
      for (let index = 0; index + 1 < edgeFaces.length; index += 2) {
        const edgeId = cache.edgeIdsByHash.get(edgeFaces[index]); const faceId = cache.faceIdsByHash.get(edgeFaces[index + 1]);
        if (!edgeId || !faceId) continue;
        const entries = faceEdges.get(faceId) ?? []; entries.push(edgeId); faceEdges.set(faceId, entries);
      }
      // Some OCCT builds return an empty/partial edgeToFaceMap for otherwise
      // valid solids. Reconstruct only the missing relationships from exact
      // TopoDS Face sub-edges; this is still B-Rep topology, never tessellation.
      for (const [faceId, face] of cache.faces) {
        if ((faceEdges.get(faceId)?.length ?? 0) > 0) continue;
        const faceSubEdges = runtime.getSubShapes(face.handle, "edge");
        try {
          const entries: string[] = [];
          for (const subEdge of faceSubEdges) {
            const hash = runtime.hashCode(subEdge, FACE_HASH_UPPER_BOUND);
            let edgeId = cache.edgeIdsByHash.get(hash);
            if (!edgeId) edgeId = [...cache.edges].find(([, candidate]) => runtime.isSame(candidate.handle, subEdge))?.[0];
            if (edgeId && !entries.includes(edgeId)) entries.push(edgeId);
          }
          if (entries.length) faceEdges.set(faceId, entries);
        } finally { for (const subEdge of faceSubEdges) this.releaseHandle(runtime, subEdge); }
      }
      for (const [edgeId, edge] of cache.edges) {
        const adjacent = [...faceEdges.entries()].filter(([, edgeIds]) => edgeIds.includes(edgeId)).map(([faceId]) => cache.faces.get(faceId)?.info).filter(Boolean) as KernelFaceInfo[];
        const adjacentFaceIds = [...faceEdges.entries()].filter(([, edgeIds]) => edgeIds.includes(edgeId)).map(([faceId]) => faceId).sort();
        edge.info.adjacentFaceIds = adjacentFaceIds;
        edge.info.adjacentFaceSurfaceTypes = [...new Set(adjacent.map((face) => face.surfaceType ?? "other"))].sort();
        edge.info.adjacentFaceNormals = adjacent.map((face) => face.normal).filter((normal): normal is Vec3 => Boolean(normal));
        edge.info.boundaryRole = adjacent.length <= 1 ? "boundary" : "interior";
      }
      for (const [faceId, edgeIds] of faceEdges) {
        const face = cache.faces.get(faceId)?.info; if (!face) continue;
        const neighbours = new Set<string>();
        for (const edgeId of edgeIds) for (const adjacentFaceId of faceEdges.keys()) {
          if (adjacentFaceId !== faceId && faceEdges.get(adjacentFaceId)!.includes(edgeId)) neighbours.add(cache.faces.get(adjacentFaceId)?.info.surfaceType ?? "other");
        }
        face.boundaryEdgeCount = edgeIds.length;
        face.boundaryEdgeIds = [...new Set(edgeIds)];
        const adjacentFaceIds = new Set<string>();
        for (const edgeId of edgeIds) for (const adjacentFaceId of faceEdges.keys()) {
          if (adjacentFaceId !== faceId && faceEdges.get(adjacentFaceId)!.includes(edgeId)) adjacentFaceIds.add(adjacentFaceId);
        }
        face.adjacentFaceIds = [...adjacentFaceIds].sort();
        face.adjacentSurfaceTypes = [...neighbours].sort();
      }
      record.topology = cache;
      return cache;
    } catch (error) {
      this.releaseTopology(runtime, { ...record, topology: cache });
      if (error instanceof KernelOperationError || error instanceof KernelValidationError) throw error;
      throw new KernelOperationError("getTopology", errorMessage(error), "OCCT_TOPOLOGY_ENUMERATION_FAILED");
    }
  }

  private resolveTopologyRef<TInfo extends KernelFaceInfo | KernelEdgeInfo>(
    topology: KernelTopologyRef,
    kind: "face" | "edge",
    operation: string,
  ): RuntimeTopologyRecord<TInfo> {
    if (topology.kind !== kind) throw new KernelReferenceError(operation, `Topology ${topology.localId} is not a ${kind}.`, "OCCT_TOPOLOGY_KIND_MISMATCH");
    const { runtime, record } = this.resolveShape({ id: topology.shapeId, revision: topology.shapeRevision }, operation);
    const cache = this.ensureTopologyCache(runtime, record, { id: topology.shapeId, revision: topology.shapeRevision });
    const entry = (kind === "face" ? cache.faces.get(topology.localId) : cache.edges.get(topology.localId)) as RuntimeTopologyRecord<TInfo> | undefined;
    if (!entry) throw new KernelReferenceError(operation, `Topology ${topology.localId} is unavailable for the current Shape revision.`, "OCCT_TOPOLOGY_REFERENCE_INVALID");
    return entry;
  }

  private releaseTopology(runtime: OcctWasmRuntime, record: ShapeRuntimeRecord): void {
    const cache = record.topology;
    if (!cache) return;
    for (const { handle } of cache.faces.values()) this.releaseHandle(runtime, handle);
    for (const { handle } of cache.edges.values()) this.releaseHandle(runtime, handle);
    cache.faces.clear();
    cache.edges.clear();
    cache.faceIdsByHash.clear();
    cache.edgeIdsByHash.clear();
    cache.edgePolylines = undefined;
    record.topology = undefined;
  }
}
