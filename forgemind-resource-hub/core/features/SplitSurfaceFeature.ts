import type { UUID } from "../cad/CadTypes.ts";
import type { BaseFeature } from "./Feature.ts";
/** Exact B-Rep surface split. The output keeps all split fragments as one Surface Body compound. */
export interface SplitSurfaceFeature extends BaseFeature { type:"splitSurface"; targetFeatureId:UUID; toolFeatureId:UUID; toleranceMm:number; }
