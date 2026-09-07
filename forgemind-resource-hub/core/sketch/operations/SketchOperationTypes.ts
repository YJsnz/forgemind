import type { Vec2 } from "../../cad/CadTypes.ts";
import type { SketchEntity } from "../SketchEntity.ts";

export interface SketchIntersection { point: Vec2; entityAParameter: number; entityBParameter: number; tangent?: boolean; }
export type SketchOperationErrorCode = "SKETCH_TRIM_UNSUPPORTED_ENTITY" | "SKETCH_TRIM_NO_INTERSECTION" | "SKETCH_EXTEND_NO_INTERSECTION" | "SKETCH_OFFSET_INVALID_RADIUS" | "SKETCH_OFFSET_UNSUPPORTED_ENTITY";
export class SketchOperationError extends Error { readonly code: SketchOperationErrorCode; constructor(code: SketchOperationErrorCode, message: string) { super(message); this.name = "SketchOperationError"; this.code = code; } }
export interface SketchOperationResult { entities: Record<string, SketchEntity>; entityOrder: string[]; removedEntityIds: string[]; createdEntityIds: string[]; orphanConstraintIds: string[]; orphanDimensionIds: string[]; }
