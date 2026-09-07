import type { CadProjectBundle } from "../cad/CadProjectBundle.ts";
import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import type { PersistentTopologyRef } from "../topology/PersistentTopologyRef.ts";

export const ASSEMBLY_DOCUMENT_SCHEMA_VERSION = 2 as const;

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Part-local -> assembly-world rigid placement. All translation values are mm. */
export interface RigidTransform {
  translationMm: Vec3;
  rotation: Quaternion;
}

/** Durable explicit Mate Connector authored on immutable Part-definition geometry. */
export interface PartMateConnectorDefinition {
  id: UUID;
  name: string;
  bodyId: UUID;
  topologyRef: PersistentTopologyRef;
  /** Offsets are expressed in the analytic connector's local primary/secondary/tertiary frame. */
  offsetMm: { primary: number; secondary: number; tertiary: number };
  /** Spin around the primary axis after the analytic frame has been derived. */
  spinDeg: number;
  /** Reverses the primary direction while preserving a right-handed frame. */
  flipped: boolean;
}

/** Immutable source-level Part definition. Runtime B-Rep is intentionally absent. */
export interface PartDefinition {
  id: UUID;
  name: string;
  fingerprint: string;
  project: CadProjectBundle;
  mateConnectors: Record<UUID, PartMateConnectorDefinition>;
  mateConnectorOrder: UUID[];
}

export interface PartDefinitionStore {
  readonly definitions: ReadonlyMap<UUID, PartDefinition>;
}

export interface ComponentInstance {
  id: UUID;
  name: string;
  definitionId: UUID;
  nominalPlacement: RigidTransform;
  grounded: boolean;
  visible: boolean;
}

/** Durable assembly reference: component identity + Part-local persistent topology. */
export interface AssemblyTopologyRef {
  instanceId: UUID;
  bodyId: UUID;
  topologyRef: PersistentTopologyRef;
}

/** Durable assembly reference to an explicit Part-definition Mate Connector. */
export interface AssemblyMateConnectorRef {
  instanceId: UUID;
  connectorId: UUID;
}

export type MateAlignment = "same" | "opposite";

export interface BaseAssemblyMate {
  id: UUID;
  name: string;
  enabled: boolean;
}

export interface FixedMate extends BaseAssemblyMate {
  type: "fixed";
  componentId: UUID;
  lockedPlacement: RigidTransform;
}

export interface CoincidentMate extends BaseAssemblyMate {
  type: "coincident";
  a: AssemblyTopologyRef;
  b: AssemblyTopologyRef;
  alignment: MateAlignment;
}

export interface DistanceMate extends BaseAssemblyMate {
  type: "distance";
  a: AssemblyTopologyRef;
  b: AssemblyTopologyRef;
  distanceMm: number;
  alignment: MateAlignment;
}

export interface ConcentricMate extends BaseAssemblyMate {
  type: "concentric";
  a: AssemblyTopologyRef;
  b: AssemblyTopologyRef;
}

export interface AngleMate extends BaseAssemblyMate {
  type: "angle";
  a: AssemblyTopologyRef;
  b: AssemblyTopologyRef;
  angleDeg: number;
}

export interface MateLimit {
  enabled: boolean;
  min: number;
  max: number;
}

/** One rotational DOF around the shared connector primary axis. Limits are degrees. */
export interface RevoluteMate extends BaseAssemblyMate {
  type: "revolute";
  a: AssemblyMateConnectorRef;
  b: AssemblyMateConnectorRef;
  angleLimit: MateLimit;
}

/** One translational DOF along the shared connector primary axis. Limits are mm. */
export interface SliderMate extends BaseAssemblyMate {
  type: "slider";
  a: AssemblyMateConnectorRef;
  b: AssemblyMateConnectorRef;
  distanceLimit: MateLimit;
}

export type AssemblyMate = FixedMate | CoincidentMate | DistanceMate | ConcentricMate | AngleMate | RevoluteMate | SliderMate;

export interface AssemblyDocument {
  schemaVersion: typeof ASSEMBLY_DOCUMENT_SCHEMA_VERSION;
  id: UUID;
  name: string;
  unit: "mm";
  components: Record<UUID, ComponentInstance>;
  componentOrder: UUID[];
  mates: Record<UUID, AssemblyMate>;
  mateOrder: UUID[];
  updatedAt: number;
}

export interface LocalPlaneGeometry {
  kind: "plane";
  pointMm: Vec3;
  normal: Vec3;
}

export interface LocalCylinderGeometry {
  kind: "cylinder";
  axisOriginMm: Vec3;
  axisDirection: Vec3;
  radiusMm: number;
}

export type LocalMateGeometry = LocalPlaneGeometry | LocalCylinderGeometry;

export interface LocalMateConnectorFrame {
  originMm: Vec3;
  primaryAxis: Vec3;
  secondaryAxis: Vec3;
  tertiaryAxis: Vec3;
  sourceKind: LocalMateGeometry["kind"];
}

export interface AssemblyGeometryProvider {
  /** Returns exact Part-local analytic geometry; never mesh-fit geometry. */
  resolve(reference: AssemblyTopologyRef): Promise<LocalMateGeometry>;
  /** Resolves an explicit connector from immutable Part-definition data + persistent topology. */
  resolveConnector(reference: AssemblyMateConnectorRef): Promise<LocalMateConnectorFrame>;
}

export type AssemblySolveStatus = "solved" | "under-constrained" | "fully-constrained" | "conflict" | "degraded";

export interface AssemblySolveDiagnostic {
  code: string;
  message: string;
  mateId?: UUID;
}

export interface AssemblyRuntimeState {
  /** Derived runtime placements. Never serialize them into AssemblyDocument or history. */
  solvedPlacements: Map<UUID, RigidTransform>;
  lastGoodPlacements: Map<UUID, RigidTransform>;
  status: AssemblySolveStatus;
  dof: number;
  iterations: number;
  residualNorm: number;
  diagnostics: AssemblySolveDiagnostic[];
}
