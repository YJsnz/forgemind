/** Shared tolerance policy for NURBS knot and parameter comparisons. */
export const NURBS_PARAMETER_TOLERANCE = 1e-12;

export const nurbsParameterTolerance = (start: number, end: number): number =>
  NURBS_PARAMETER_TOLERANCE * Math.max(1, Math.abs(start), Math.abs(end), Math.abs(end - start));
