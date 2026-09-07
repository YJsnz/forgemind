import type { KernelShapeRef, KernelTopologyRef } from "../kernel/KernelTypes.ts";

export type CadSelectionMode = "body" | "face" | "edge";

/** Runtime-only viewport selection. It must never enter CadDocument or Project JSON. */
export type CadSelection =
  | { kind: "body"; shape: KernelShapeRef }
  | { kind: "face"; topology: KernelTopologyRef }
  | { kind: "edge"; topology: KernelTopologyRef };
