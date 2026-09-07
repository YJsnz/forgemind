export type FeatureState =
  | "clean"
  | "dirty"
  | "rebuilding"
  | "failed"
  | "suppressed";

/** Keeps the persisted enabled flag and derived execution state coherent. */
export const normalizedFeatureState = (enabled: boolean, state?: FeatureState): FeatureState =>
  enabled ? (state === "suppressed" ? "clean" : state ?? "clean") : "suppressed";
