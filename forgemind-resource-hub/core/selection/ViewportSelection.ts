import type { KernelEdgePolyline, KernelTessellation } from "../kernel/KernelTypes.ts";
import type { CadSelection } from "./SelectionTypes.ts";

/** Converts a Three.js intersection faceIndex back to its real runtime OCCT Face reference. */
export const faceSelectionFromTriangle = (tessellation: KernelTessellation, triangleIndex: number): CadSelection => {
  if (!Number.isInteger(triangleIndex) || triangleIndex < 0 || triangleIndex >= tessellation.triangleFaceIndices.length) {
    throw new RangeError("Triangle index is outside the kernel tessellation.");
  }
  const faceIndex = tessellation.triangleFaceIndices[triangleIndex];
  const face = tessellation.faces[faceIndex];
  if (!face || face.topology.kind !== "face") throw new Error("Triangle has no valid runtime Face mapping.");
  return { kind: "face", topology: face.topology };
};

export const edgeSelectionFromPolyline = (polyline: KernelEdgePolyline): CadSelection => {
  if (polyline.topology.kind !== "edge") throw new Error("Viewport polyline does not represent a runtime Edge.");
  return { kind: "edge", topology: polyline.topology };
};
