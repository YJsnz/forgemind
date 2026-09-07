/**
 * The Legacy canvas persists positions as viewport-normalized coordinates.
 * One complete canvas span represents this many millimetres in the CAD domain.
 */
export const LEGACY_SKETCH_CANVAS_SPAN_MM = 5000;

export const legacySketchDistanceToMillimetres = (distance: number): number =>
  distance * LEGACY_SKETCH_CANVAS_SPAN_MM;

export const millimetresToLegacySketchDistance = (distanceMm: number): number =>
  distanceMm / LEGACY_SKETCH_CANVAS_SPAN_MM;
