import type { RebuildEngineContext } from "../../rebuild/RebuildEngine.ts";
import { rebuildDocument } from "../../rebuild/RebuildEngine.ts";
import { solveSketch } from "./SketchSolver.ts";
import type { SketchSolverOptions, SketchSolveResult } from "./SolverTypes.ts";

export interface SketchSolveAndRebuildResult { solve: SketchSolveResult; rebuildStarted: boolean; rebuild?: Awaited<ReturnType<typeof rebuildDocument>>; }
/** Explicit preview/commit boundary: invalid solves never enter the B-Rep rebuild. */
export const solveSketchAndRebuild = async (context: RebuildEngineContext, sketchId: string, options?: SketchSolverOptions): Promise<SketchSolveAndRebuildResult> => {
  const sketch = context.document.sketches[sketchId];
  if (!sketch) throw new Error(`Sketch ${sketchId} was not found.`);
  const solve = solveSketch(sketch, options);
  if (solve.status === "conflicting" || solve.status === "failed" || solve.status === "over-constrained") return { solve, rebuildStarted: false };
  const previous = context.document.sketches[sketchId];
  context.document.sketches[sketchId] = { ...previous, entities: solve.entities };
  const rebuild = await rebuildDocument(context, { changedSketchIds: [sketchId] });
  return { solve, rebuildStarted: true, rebuild };
};
