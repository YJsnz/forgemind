import type { CadKernel } from "../kernel/CadKernel.ts";
import { ExactAssemblyGeometryProvider, PartDefinitionRuntimeCache } from "./AssemblyGeometry.ts";
import { createAssemblyRuntimeState, solveAssemblyRuntime, type AssemblySolveResult } from "./AssemblySolver.ts";
import type { AssemblyDocument, AssemblyRuntimeState, PartDefinitionStore } from "./AssemblyTypes.ts";

/** Owns only Assembly-derived runtime state and the shared PartDefinition runtime cache. */
export class AssemblyRuntimeController {
  readonly runtime: AssemblyRuntimeState;
  readonly definitions: PartDefinitionRuntimeCache;
  private document: AssemblyDocument;
  private readonly kernel: CadKernel;
  constructor(document: AssemblyDocument, definitionStore: PartDefinitionStore, kernel: CadKernel) {
    this.document = document; this.kernel = kernel;
    this.runtime = createAssemblyRuntimeState(document);
    this.definitions = new PartDefinitionRuntimeCache(definitionStore, kernel);
  }

  async solve(document = this.document): Promise<AssemblySolveResult> {
    this.document = document;
    const geometry = new ExactAssemblyGeometryProvider(document, this.definitions, this.kernel);
    return solveAssemblyRuntime(document, geometry, this.runtime);
  }

  async dispose(): Promise<void> { await this.definitions.dispose(); this.runtime.solvedPlacements.clear(); this.runtime.lastGoodPlacements.clear(); this.runtime.diagnostics = []; }
}
