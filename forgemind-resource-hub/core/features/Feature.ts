import type { UUID } from "../cad/CadTypes.ts";
import type { BooleanFeature } from "./BooleanFeature.ts";
import type { ChamferFeature } from "./ChamferFeature.ts";
import type { ExtrudeFeature } from "./ExtrudeFeature.ts";
import type { FeatureState } from "./FeatureState.ts";
import type { FilletFeature } from "./FilletFeature.ts";
import type { HoleFeature } from "./HoleFeature.ts";
import type { PatternFeature } from "./PatternFeature.ts";
import type { FeaturePatternFeature } from "./FeaturePatternFeature.ts";
import type { PocketFeature } from "./PocketFeature.ts";
import type { RevolveFeature } from "./RevolveFeature.ts";
import type { ShellFeature } from "./ShellFeature.ts";
import type { SweepFeature } from "./SweepFeature.ts";
import type { LoftFeature } from "./LoftFeature.ts";
import type { DraftFeature } from "./DraftFeature.ts";
import type { RibFeature } from "./RibFeature.ts";
import type { BodyTransformFeature } from "./BodyTransformFeature.ts";
import type { BodyBooleanFeature } from "./BodyBooleanFeature.ts";
import type { ImportedStepFeature } from "./ImportedStepFeature.ts";
import type { RemoveHoleFeature } from "./RemoveHoleFeature.ts";
import type { OffsetBodyFeature } from "./OffsetBodyFeature.ts";
import type { PlanarPushPullFeature } from "./PlanarPushPullFeature.ts";
import type { DeleteFaceFeature } from "./DeleteFaceFeature.ts";
import type { HealHolePatternFeature } from "./HealHolePatternFeature.ts";
import type { SurfacePatchFeature } from "./SurfacePatchFeature.ts";
import type { SurfaceExtrudeFeature } from "./SurfaceExtrudeFeature.ts";
import type { SurfaceRevolveFeature } from "./SurfaceRevolveFeature.ts";
import type { SurfaceSweepFeature } from "./SurfaceSweepFeature.ts";
import type { SurfaceLoftFeature } from "./SurfaceLoftFeature.ts";
import type { ExtractSurfaceFeature } from "./ExtractSurfaceFeature.ts";
import type { OffsetSurfaceFeature } from "./OffsetSurfaceFeature.ts";
import type { SewSurfaceFeature } from "./SewSurfaceFeature.ts";
import type { ThickenSurfaceFeature } from "./ThickenSurfaceFeature.ts";
import type { EncloseSurfaceFeature } from "./EncloseSurfaceFeature.ts";
import type { FillSurfaceFeature } from "./FillSurfaceFeature.ts";
import type { TrimSurfaceFeature } from "./TrimSurfaceFeature.ts";
import type { BSplineSurfaceFeature } from "./BSplineSurfaceFeature.ts";
import type { BoundarySurfaceFeature } from "./BoundarySurfaceFeature.ts";
import type { SplitSurfaceFeature } from "./SplitSurfaceFeature.ts";
import type { ReplaceFaceFeature } from "./ReplaceFaceFeature.ts";
import type { SurfaceIntersectionFeature } from "./SurfaceIntersectionFeature.ts";
import type { MechanicalDetailFeature } from "./MechanicalDetailFeature.ts";

export interface BaseFeature {
  id: UUID;
  name: string;
  type: string;
  enabled: boolean;
  state: FeatureState;
  /** Feature-to-feature dependencies only; a sketch input is held separately. */
  dependencies: UUID[];
  /** Stable design ownership; absence is supported for pre multi-body data. */
  bodyId?: UUID;
  createdAt?: number;
}

export type Feature =
  | ExtrudeFeature
  | PocketFeature
  | RevolveFeature
  | PatternFeature
  | FeaturePatternFeature
  | BooleanFeature
  | HoleFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | SweepFeature
  | LoftFeature
  | DraftFeature
  | RibFeature
  | BodyTransformFeature
  | BodyBooleanFeature
  | ImportedStepFeature
  | RemoveHoleFeature
  | OffsetBodyFeature
  | PlanarPushPullFeature
  | DeleteFaceFeature
  | HealHolePatternFeature
  | SurfacePatchFeature
  | SurfaceExtrudeFeature
  | SurfaceRevolveFeature
  | SurfaceSweepFeature
  | SurfaceLoftFeature
  | ExtractSurfaceFeature
  | OffsetSurfaceFeature
  | SewSurfaceFeature
  | ThickenSurfaceFeature
  | EncloseSurfaceFeature
  | FillSurfaceFeature
  | TrimSurfaceFeature
  | BSplineSurfaceFeature
  | BoundarySurfaceFeature
  | SplitSurfaceFeature
  | ReplaceFaceFeature
  | SurfaceIntersectionFeature
  | MechanicalDetailFeature;
