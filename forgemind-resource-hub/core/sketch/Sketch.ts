import type { CadDocument } from "../cad/CadDocument.ts";
import type { UUID } from "../cad/CadTypes.ts";
import type { SketchConstraint } from "./SketchConstraint.ts";
import type { SketchDimension } from "./SketchDimension.ts";
import type { SketchEntity } from "./SketchEntity.ts";
import type { SketchPlane } from "./SketchPlane.ts";

/** Pure mathematical sketch data. Features intentionally do not belong here. */
export interface Sketch {
  id: UUID;
  name: string;
  plane: SketchPlane;
  entities: Record<UUID, SketchEntity>;
  entityOrder: UUID[];
  constraints: Record<UUID, SketchConstraint>;
  dimensions: Record<UUID, SketchDimension>;
}

/** A CadDocument carrying domain sketches without changing current React state. */
export type SketchCadDocument = CadDocument<Sketch, unknown>;
