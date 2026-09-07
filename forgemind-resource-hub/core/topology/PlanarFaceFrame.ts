import type { Vec2, Vec3 } from "../cad/CadTypes.ts";
import type { KernelFaceInfo, KernelPlaneFrame } from "../kernel/KernelTypes.ts";

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalise = (value: Vec3): Vec3 => {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length <= 1e-12) throw new PlanarFaceFrameError("INVALID_FACE_NORMAL", "Planar face normal is not finite.");
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};

export class PlanarFaceFrameError extends Error {
  readonly code: "NOT_PLANAR_FACE" | "INVALID_FACE_NORMAL";
  constructor(code: "NOT_PLANAR_FACE" | "INVALID_FACE_NORMAL", message: string) { super(message); this.name = "PlanarFaceFrameError"; this.code = code; }
}

/** Deterministic right-handed frame derived from the oriented OCCT planar face. */
export const getPlanarFaceFrame = (face: KernelFaceInfo): KernelPlaneFrame => {
  if (face.surfaceType !== "plane") throw new PlanarFaceFrameError("NOT_PLANAR_FACE", "Hole placement requires a planar Face.");
  if (!face.centerMm || !face.normal) throw new PlanarFaceFrameError("INVALID_FACE_NORMAL", "Planar Face lacks a center or oriented normal.");
  const normal = normalise(face.normal);
  const candidate = Math.abs(dot({ x: 1, y: 0, z: 0 }, normal)) > .95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const projection = dot(candidate, normal);
  const xAxis = normalise({ x: candidate.x - normal.x * projection, y: candidate.y - normal.y * projection, z: candidate.z - normal.z * projection });
  return { origin: face.centerMm, xAxis, yAxis: normalise(cross(normal, xAxis)), normal };
};

export const faceLocalToWorld = (frame: KernelPlaneFrame, point: Vec2): Vec3 => ({
  x: frame.origin.x + frame.xAxis.x * point.x + frame.yAxis.x * point.y,
  y: frame.origin.y + frame.xAxis.y * point.x + frame.yAxis.y * point.y,
  z: frame.origin.z + frame.xAxis.z * point.x + frame.yAxis.z * point.y,
});

export const worldToFaceLocal = (frame: KernelPlaneFrame, point: Vec3): Vec2 => {
  const offset = { x: point.x - frame.origin.x, y: point.y - frame.origin.y, z: point.z - frame.origin.z };
  return { x: dot(offset, frame.xAxis), y: dot(offset, frame.yAxis) };
};
