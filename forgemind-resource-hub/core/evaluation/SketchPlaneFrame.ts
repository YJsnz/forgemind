import type { KernelPlaneFrame } from "../kernel/KernelTypes.ts";
import type { SketchPlane } from "../sketch/SketchPlane.ts";

const finiteOffset = (offset: number): number => {
  if (!Number.isFinite(offset)) throw new Error("Sketch plane offset must be finite.");
  return offset;
};

/**
 * Converts domain planes to explicit right-handed kernel frames. Offsets move
 * along the frame normal rather than an arbitrary global axis.
 */
export const sketchPlaneToKernelFrame = (plane: SketchPlane): KernelPlaneFrame => {
  if (plane.type === "XY") {
    return {
      origin: { x: 0, y: 0, z: finiteOffset(plane.offset) },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    };
  }
  if (plane.type === "XZ") {
    const offset = finiteOffset(plane.offset);
    return {
      origin: { x: 0, y: -offset, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: -1, z: 0 },
    };
  }
  if (plane.type === "YZ") {
    return {
      origin: { x: finiteOffset(plane.offset), y: 0, z: 0 },
      xAxis: { x: 0, y: 1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      normal: { x: 1, y: 0, z: 0 },
    };
  }
  throw new Error("Face-attached sketch planes are not supported by Feature Evaluation v1.");
};
