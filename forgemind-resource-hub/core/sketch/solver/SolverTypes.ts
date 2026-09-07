import type { UUID } from "../../cad/CadTypes.ts";
import type { SketchEntity } from "../SketchEntity.ts";

export type SketchSolveStatus = "solved" | "under-constrained" | "fully-constrained" | "over-constrained" | "conflicting" | "failed";
export interface SketchSolverDiagnostic { code: string; message: string; constraintId?: UUID; dimensionId?: UUID; entityId?: UUID; severity: "warning" | "error"; }
export interface SketchSolveResult { status: SketchSolveStatus; entities: Record<UUID, SketchEntity>; degreesOfFreedom: number; residual: number; iterations: number; diagnostics: SketchSolverDiagnostic[]; conflictingConstraintIds: UUID[]; conflictingDimensionIds: UUID[]; }
export interface SketchSolverOptions { maxIterations?: number; residualTolerance?: number; parameterTolerance?: number; damping?: number; }
export const DEFAULT_SKETCH_SOLVER_OPTIONS: Required<SketchSolverOptions> = { maxIterations: 80, residualTolerance: 1e-6, parameterTolerance: 1e-8, damping: 1e-5 };
