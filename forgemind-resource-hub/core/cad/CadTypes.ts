/**
 * Stable primitives shared by the CAD domain. These types deliberately do not
 * depend on React, Three.js, or a specific CAD kernel.
 */
export type UUID = string;

export type LengthUnit = "mm";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform3D {
  position: Vec3;
  rotation: Vec3;
}

export type TopologyKind =
  | "solid"
  | "shell"
  | "face"
  | "wire"
  | "edge"
  | "vertex";

/**
 * Legacy meshes and future B-Rep bodies coexist during the migration. A
 * backend identifies the source of truth; it is not a rendering preference.
 */
export type GeometryBackend = "legacy-mesh" | "brep";

export interface CadBodyAppearance {
  color?: string;
  metalness?: number;
  roughness?: number;
}

export interface CadBodyEngineering {
  material?: string;
  densityKgM3?: number;
  toleranceMm?: number;
  process?: string;
  group?: string;
}

export interface CadBodySourceResource {
  resourceId: string;
  resourceCode: string;
  resourceTitle: string;
  sourcePartId?: string;
}

export type CadBodyType = "solid" | "surface" | "curve";

export interface CadBody {
  id: UUID;
  name: string;
  backend: GeometryBackend;
  /** Design-level body category. Omitted legacy data is treated as solid. */
  bodyType?: CadBodyType;
  visible: boolean;
  /** Persistent presentation metadata; geometry remains kernel-owned. */
  appearance?: CadBodyAppearance;
  /** Engineering metadata follows the Body through save/load and resource instancing. */
  engineering?: CadBodyEngineering;
  /** Durable provenance for Resource Hub -> B-Rep workflows. */
  sourceResource?: CadBodySourceResource;
  /** The last solid-producing feature owned by this Body, if any. */
  tipFeatureId?: UUID;

  /**
   * Runtime-only kernel reference. Project serializers must omit this field;
   * it can represent a kernel-managed shape, never a persisted WASM handle.
   */
  runtimeShapeId?: string;
}

export type SerializableCadBody = Omit<CadBody, "runtimeShapeId">;
