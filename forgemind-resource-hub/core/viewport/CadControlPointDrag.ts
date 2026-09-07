export interface CadControlPointPosition { x: number; y: number; z: number }

/** Applies viewport editing aids in millimetres without changing CAD truth. */
export const constrainCadControlPointDrag = (
  startMm: CadControlPointPosition,
  nextMm: CadControlPointPosition,
  options: { axisLock: boolean; snapMm?: number },
): CadControlPointPosition => {
  const result = { ...nextMm }; let axis: "x" | "y" | "z" | undefined;
  if (options.axisLock) {
    const delta = { x: Math.abs(nextMm.x - startMm.x), y: Math.abs(nextMm.y - startMm.y), z: Math.abs(nextMm.z - startMm.z) };
    axis = delta.x >= delta.y && delta.x >= delta.z ? "x" : delta.y >= delta.z ? "y" : "z";
    if (axis !== "x") result.x = startMm.x; if (axis !== "y") result.y = startMm.y; if (axis !== "z") result.z = startMm.z;
  }
  const snap = options.snapMm;
  if (snap && Number.isFinite(snap) && snap > 0) {
    const round = (value: number) => Math.round(value / snap) * snap;
    if (axis) result[axis] = round(result[axis]); else { result.x = round(result.x); result.y = round(result.y); result.z = round(result.z); }
  }
  return result;
};
