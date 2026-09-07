import type { LengthUnit } from "./CadTypes.ts";

/** ForgeMind CAD documents use millimetres as their internal design unit. */
export const CAD_INTERNAL_LENGTH_UNIT: LengthUnit = "mm";

export const isLengthUnit = (value: unknown): value is LengthUnit => value === "mm";
