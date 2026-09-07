import type { Vec3 } from "../cad/CadTypes.ts";
import type { Quaternion, RigidTransform } from "./AssemblyTypes.ts";

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const addVec3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const subVec3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scaleVec3 = (a: Vec3, scalar: number): Vec3 => ({ x: a.x * scalar, y: a.y * scalar, z: a.z * scalar });
export const dotVec3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const crossVec3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const lengthVec3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalizeVec3 = (a: Vec3): Vec3 => {
  const length = lengthVec3(a);
  if (!Number.isFinite(length) || length <= 1e-15) throw new Error("A direction vector must have non-zero finite length.");
  return scaleVec3(a, 1 / length);
};

export const IDENTITY_QUATERNION: Quaternion = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const IDENTITY_RIGID_TRANSFORM: RigidTransform = Object.freeze({ translationMm: Object.freeze({ x: 0, y: 0, z: 0 }), rotation: IDENTITY_QUATERNION });

export const normalizeQuaternion = (q: Quaternion): Quaternion => {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length <= 1e-15) throw new Error("Quaternion must have non-zero finite length.");
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
};

export const multiplyQuaternion = (a: Quaternion, b: Quaternion): Quaternion => normalizeQuaternion({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

export const conjugateQuaternion = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export const quaternionFromAxisAngle = (axis: Vec3, angleRad: number): Quaternion => {
  if (!Number.isFinite(angleRad)) throw new Error("Rotation angle must be finite.");
  if (Math.abs(angleRad) <= 1e-15) return { ...IDENTITY_QUATERNION };
  const direction = normalizeVec3(axis); const half = angleRad / 2; const sine = Math.sin(half);
  return normalizeQuaternion({ x: direction.x * sine, y: direction.y * sine, z: direction.z * sine, w: Math.cos(half) });
};

export const quaternionFromRotationVector = (rotation: Vec3): Quaternion => {
  const angle = lengthVec3(rotation);
  return angle <= 1e-15 ? { ...IDENTITY_QUATERNION } : quaternionFromAxisAngle(scaleVec3(rotation, 1 / angle), angle);
};

/** UI helper only; the resulting normalized quaternion remains the domain design truth. XYZ inputs are degrees. */
export const quaternionFromEulerDegrees = (xDeg: number, yDeg: number, zDeg: number): Quaternion => {
  if (![xDeg, yDeg, zDeg].every(Number.isFinite)) throw new Error("Euler display angles must be finite.");
  const qx = quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, xDeg * Math.PI / 180);
  const qy = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, yDeg * Math.PI / 180);
  const qz = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, zDeg * Math.PI / 180);
  return multiplyQuaternion(qz, multiplyQuaternion(qy, qx));
};

/** Display helper matching quaternionFromEulerDegrees (intrinsic XYZ / qz*qy*qx). */
export const eulerDegreesFromQuaternion = (input: Quaternion): { xDeg: number; yDeg: number; zDeg: number } => {
  const q = normalizeQuaternion(input);
  const sinPitch = 2 * (q.w * q.y - q.z * q.x);
  const pitch = Math.asin(Math.max(-1, Math.min(1, sinPitch)));
  const roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return { xDeg: roll * 180 / Math.PI, yDeg: pitch * 180 / Math.PI, zDeg: yaw * 180 / Math.PI };
};

export const rotateVec3 = (qInput: Quaternion, point: Vec3): Vec3 => {
  const q = normalizeQuaternion(qInput);
  const u = { x: q.x, y: q.y, z: q.z };
  const uv = crossVec3(u, point); const uuv = crossVec3(u, uv);
  return addVec3(point, addVec3(scaleVec3(uv, 2 * q.w), scaleVec3(uuv, 2)));
};

export const transformPoint = (transform: RigidTransform, point: Vec3): Vec3 => addVec3(rotateVec3(transform.rotation, point), transform.translationMm);
export const transformDirection = (transform: RigidTransform, direction: Vec3): Vec3 => normalizeVec3(rotateVec3(transform.rotation, direction));

export const cloneRigidTransform = (transform: RigidTransform): RigidTransform => ({ translationMm: { ...transform.translationMm }, rotation: { ...transform.rotation } });

export const validateRigidTransform = (transform: RigidTransform): RigidTransform => {
  const values = [transform.translationMm.x, transform.translationMm.y, transform.translationMm.z, transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w];
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Rigid transform values must be finite.");
  return { translationMm: { ...transform.translationMm }, rotation: normalizeQuaternion(transform.rotation) };
};

/** Applies an absolute solver delta to an immutable nominal placement. */
export const applyRigidDelta = (base: RigidTransform, translationDelta: Vec3, rotationVectorRad: Vec3): RigidTransform => ({
  translationMm: addVec3(base.translationMm, translationDelta),
  rotation: multiplyQuaternion(quaternionFromRotationVector(rotationVectorRad), base.rotation),
});

export const quaternionAngularDistanceRad = (aInput: Quaternion, bInput: Quaternion): number => {
  const a = normalizeQuaternion(aInput); const b = normalizeQuaternion(bInput);
  const cosineHalf = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(cosineHalf);
};
