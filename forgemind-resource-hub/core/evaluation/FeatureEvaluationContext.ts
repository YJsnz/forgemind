import type { CadDocument } from "../cad/CadDocument.ts";
import type { CadAssetStore } from "../cad/CadAssets.ts";
import type { CadToleranceSettings } from "../cad/Tolerance.ts";
import type { Feature } from "../features/Feature.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { ProfileBuildResult } from "../sketch/SketchProfile.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { CadRuntimeState } from "./CadRuntimeState.ts";

export type SketchProfileBuilder = (sketch: Sketch) => ProfileBuildResult;

/** All pure design data and runtime services required for one feature evaluation. */
export interface FeatureEvaluationContext {
  document: CadDocument<Sketch, Feature>;
  kernel: CadKernel;
  tolerance: CadToleranceSettings;
  buildProfiles: SketchProfileBuilder;
  /** Required by dependency-driven evaluators such as Pocket; Extrude stays pure. */
  runtime?: CadRuntimeState;
  /** Immutable project assets live beside, never inside, CadDocument. */
  assets?: CadAssetStore;
}
