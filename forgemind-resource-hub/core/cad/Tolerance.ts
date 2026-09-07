import type { LengthUnit } from "./CadTypes.ts";

/**
 * Numerical modelling tolerances, not manufacturing tolerances. They remain
 * independent from the display tessellation used by the Three.js viewport.
 */
export interface CadToleranceSettings {
  modelUnit: LengthUnit;
  sketch: number;
  geometry: number;
  boolean: number;
  tessellation: {
    linearDeflection: number;
    angularDeflection: number;
  };
}

export const DEFAULT_CAD_TOLERANCE: CadToleranceSettings = {
  modelUnit: "mm",
  sketch: 1e-6,
  geometry: 1e-7,
  boolean: 1e-6,
  tessellation: {
    linearDeflection: 0.05,
    angularDeflection: 0.2,
  },
};

export const isCadToleranceValid = (settings: CadToleranceSettings): boolean =>
  settings.modelUnit === "mm"
  && [
    settings.sketch,
    settings.geometry,
    settings.boolean,
    settings.tessellation.linearDeflection,
    settings.tessellation.angularDeflection,
  ].every((value) => Number.isFinite(value) && value > 0);
