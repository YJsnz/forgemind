import type { UUID } from "../cad/CadTypes.ts";

export type FeatureEvaluationErrorCode =
  | "SKETCH_NOT_FOUND"
  | "PROFILE_INVALID"
  | "PROFILE_OPEN"
  | "PROFILE_UNSUPPORTED"
  | "PROFILE_UNSUPPORTED_MULTIPLE"
  | "PROFILE_HOLES_UNSUPPORTED"
  | "FEATURE_UNSUPPORTED"
  | "FEATURE_OPERATION_UNSUPPORTED"
  | "FEATURE_DEPENDENCY_MISSING"
  | "FEATURE_DEPENDENCY_NOT_EVALUATED"
  | "TARGET_FEATURE_NOT_EVALUATED"
  | "PLANE_UNSUPPORTED"
  | "INVALID_INPUT"
  | "KERNEL_FAILURE"
  | "INVALID_RESULT"
  | "POCKET_DEPTH_UNSUPPORTED"
  | "POCKET_NO_INTERSECTION"
  | "POCKET_REMOVES_ENTIRE_BODY"
  | "TOPOLOGY_REFERENCE_LOST"
  | "TOPOLOGY_REFERENCE_AMBIGUOUS"
  | "HOLE_REQUIRES_PLANAR_FACE"
  | "HOLE_INVALID_DIAMETER"
  | "HOLE_INVALID_DEPTH"
  | "HOLE_INVALID_CENTER"
  | "HOLE_FAILED"
  | "FILLET_FAILED"
  | "CHAMFER_FAILED"
  | "SHELL_FAILED"
  | "SHELL_INVALID_THICKNESS"
  | "SHELL_NO_FACES"
  | "PATTERN_INVALID_PARAMETERS"
  | "PATTERN_TARGET_MISMATCH"
  | "PATTERN_SEED_UNSUPPORTED"
  | "PATTERN_FAILED"
  | "SWEEP_PATH_NOT_CONTINUOUS"
  | "SWEEP_PATH_BRANCHING_UNSUPPORTED"
  | "SWEEP_PATH_SPLINE_UNSUPPORTED"
  | "SWEEP_PATH_SPLINE_AMBIGUOUS"
  | "SWEEP_PATH_SPLINE_INVALID"
  | "SWEEP_PROFILE_PLACEMENT_INVALID"
  | "SWEEP_FAILED"
  | "LOFT_REQUIRES_CLOSED_SECTION"
  | "LOFT_INVALID_SECTION"
  | "LOFT_FAILED"
  | "DRAFT_FAILED"
  | "RIB_REQUIRES_OPEN_SKETCH"
  | "RIB_REQUIRES_SINGLE_LINE"
  | "RIB_INVALID_THICKNESS"
  | "RIB_INVALID_HEIGHT"
  | "RIB_FAILED"
  | "FEATURE_BODY_MISMATCH"
  | "BODY_BOOLEAN_SELF_REFERENCE"
  | "BODY_BOOLEAN_EMPTY_RESULT"
  | "BODY_BOOLEAN_FAILED"
  | "STEP_ASSET_MISSING"
  | "STEP_SOLID_MAPPING_MISMATCH"
  | "STEP_SOLID_MAPPING_AMBIGUOUS"
  | "STEP_IMPORT_FAILED"
  | "SURFACE_PROFILE_INVALID"
  | "SURFACE_HOLES_UNSUPPORTED"
  | "SURFACE_TARGET_INVALID"
  | "SURFACE_SEW_FAILED"
  | "SURFACE_THICKEN_FAILED"
  | "SURFACE_ENCLOSE_FAILED"
  | "SURFACE_OPERATION_FAILED";

export interface FeatureEvaluationErrorInfo {
  code: FeatureEvaluationErrorCode;
  featureId: UUID;
  message: string;
  cause?: unknown;
  kernelCode?: string;
}

/** A structured, non-persistent failure returned by the evaluation boundary. */
export class FeatureEvaluationError extends Error {
  readonly code: FeatureEvaluationErrorCode;
  readonly featureId: UUID;
  readonly cause?: unknown;
  readonly kernelCode?: string;

  constructor(info: FeatureEvaluationErrorInfo) {
    super(info.message);
    this.name = "FeatureEvaluationError";
    this.code = info.code;
    this.featureId = info.featureId;
    this.cause = info.cause;
    this.kernelCode = info.kernelCode;
  }
}
