import type { UUID, Vec3 } from "../cad/CadTypes.ts";

/** V1 is retained only for deterministic load migration. It never contains runtime IDs. */
export interface FaceTopologySignatureV1 {
  kind: "face";
  surfaceType: string;
  normal?: Vec3;
  normalizedCenter: Vec3;
  areaRatio?: number;
}

export interface EdgeTopologySignatureV1 {
  kind: "edge";
  curveType: string;
  normalizedMidpoint: Vec3;
  direction?: Vec3;
  lengthRatio?: number;
  adjacentSurfaceTypes?: string[];
}

export interface NurbsEdgeFingerprint {
  degree: number;
  rational: boolean;
  periodic: boolean;
  poleCount: number;
  /** Knot positions normalized to the full curve parameter domain. */
  normalizedKnots: number[];
  multiplicities: number[];
  /** A bounded set of control poles normalized to the owning shape box. */
  normalizedPoles: Vec3[];
}

export interface PersistentFaceRefV1 {
  version: 1;
  sourceFeatureId: UUID;
  kind: "face";
  signature: FaceTopologySignatureV1;
}

export interface PersistentEdgeRefV1 {
  version: 1;
  sourceFeatureId: UUID;
  kind: "edge";
  signature: EdgeTopologySignatureV1;
}

/** V2 stores only durable semantic evidence. Kernel/local IDs, hashes and mesh
 * indexes are deliberately absent. Adjacent data is supplied only when OCCT
 * exposes it directly through the kernel boundary. */
export interface FaceTopologySignatureV2 extends FaceTopologySignatureV1 {
  boundaryEdgeCount?: number;
  adjacentSurfaceTypes?: string[];
}
export interface EdgeTopologySignatureV2 extends EdgeTopologySignatureV1 {
  adjacentFaceSurfaceTypes?: string[];
  adjacentFaceNormals?: Vec3[];
  boundaryRole?: "boundary" | "interior";
  nurbsFingerprint?: NurbsEdgeFingerprint;
}
export interface PersistentTopologyProvenance { sourceOperation?: string; semanticRole?: string; legacySignature?: true; }
export interface PersistentFaceRefV2 { version: 2; sourceFeatureId: UUID; kind: "face"; signature: FaceTopologySignatureV2; provenance?: PersistentTopologyProvenance; }
export interface PersistentEdgeRefV2 { version: 2; sourceFeatureId: UUID; kind: "edge"; signature: EdgeTopologySignatureV2; provenance?: PersistentTopologyProvenance; }

export type PersistentFaceRef = PersistentFaceRefV1 | PersistentFaceRefV2;
export type PersistentEdgeRef = PersistentEdgeRefV1 | PersistentEdgeRefV2;
export type PersistentTopologyRef = PersistentFaceRef | PersistentEdgeRef;
export type PersistentTopologyRefV2 = PersistentFaceRefV2 | PersistentEdgeRefV2;

/** Pure, deterministic migration. Resolve never calls this to mutate a document. */
export const migratePersistentTopologyRefV1ToV2 = (reference: PersistentTopologyRef): PersistentTopologyRefV2 => {
  if (reference.version === 2) return reference;
  return { ...reference, version: 2, signature: { ...reference.signature }, provenance: { legacySignature: true } } as PersistentTopologyRefV2;
};
