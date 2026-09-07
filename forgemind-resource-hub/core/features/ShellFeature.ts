import type { UUID } from "../cad/CadTypes.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { BaseFeature } from "./Feature.ts";

export interface ShellFeature extends BaseFeature {
  type: "shell";
  targetFeatureId: UUID;
  removeFaces: PersistentFaceRef[];
  thicknessMm: number;
}
