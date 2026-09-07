import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentTopologyRef } from "../topology/PersistentTopologyRef.ts";

/**
 * Forward-compatible reference for a future B-Rep face. Face-based sketches
 * are data-only in this milestone and do not resolve against a CAD kernel.
 */
export interface TopologyRef {
  id: UUID;
  kind: "face";
  sourceFeatureId: UUID;
  persistentName: string;
  signature?: unknown;
}

/** Persistent design attachment only: KernelTopologyRef and runtime frames are never saved here. */
export interface PlanarFaceAttachment { sourceFeatureId: UUID; persistent: PersistentTopologyRef; }
export interface DatumPlaneAttachment { datumPlaneId: UUID; base: "XY" | "XZ" | "YZ"; offsetMm: number; flipNormal?: boolean; }

export type SketchPlane =
  | { type: "XY"; offset: number }
  | { type: "XZ"; offset: number }
  | { type: "YZ"; offset: number }
  | { type: "face"; face: TopologyRef | PlanarFaceAttachment }
  | { type: "datum"; datum: DatumPlaneAttachment };
