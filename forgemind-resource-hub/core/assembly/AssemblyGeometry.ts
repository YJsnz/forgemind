import { deserializeCadProjectBundle } from "../cad/CadProjectBundle.ts";
import { DEFAULT_CAD_TOLERANCE } from "../cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, type CadRuntimeState } from "../evaluation/CadRuntimeState.ts";
import type { Feature } from "../features/Feature.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import { rebuildDocument } from "../rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../rebuild/RebuildTypes.ts";
import type { RebuildRuntimeState } from "../rebuild/RebuildTypes.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import { buildSketchProfiles } from "../sketch/SketchProfile.ts";
import { resolvePersistentTopologyRef } from "../topology/TopologyResolver.ts";
import type { CadDocument } from "../cad/CadDocument.ts";
import type { CadAssetStore } from "../cad/CadAssets.ts";
import type { AssemblyDocument, AssemblyGeometryProvider, AssemblyMateConnectorRef, AssemblyTopologyRef, LocalMateConnectorFrame, LocalMateGeometry, PartDefinitionStore } from "./AssemblyTypes.ts";
import { applyMateConnectorDefinition, mateConnectorFrameFromGeometry } from "./MateConnector.ts";

export interface PartDefinitionRuntime {
  definitionId: string;
  document: CadDocument<Sketch, Feature>;
  assets: CadAssetStore;
  runtime: CadRuntimeState;
  rebuildRuntime: RebuildRuntimeState;
}

/**
 * Shared local-coordinate Part runtime. A PartDefinition is rebuilt once per
 * kernel session and borrowed by every ComponentInstance that references it.
 */
export class PartDefinitionRuntimeCache {
  private readonly entries = new Map<string, PartDefinitionRuntime>();
  private disposed = false;
  private readonly definitions: PartDefinitionStore;
  private readonly kernel: CadKernel;
  constructor(definitions: PartDefinitionStore, kernel: CadKernel) { this.definitions = definitions; this.kernel = kernel; }

  async get(definitionId: string): Promise<PartDefinitionRuntime> {
    if (this.disposed) throw new Error("Part Definition runtime cache has been disposed.");
    const existing = this.entries.get(definitionId); if (existing) return existing;
    const definition = this.definitions.definitions.get(definitionId); if (!definition) throw Object.assign(new Error(`Part definition ${definitionId} is unavailable.`), { code: "ASSEMBLY_DEFINITION_MISSING" });
    const loaded = deserializeCadProjectBundle(definition.project); const runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState();
    const result = await rebuildDocument({ document: loaded.document, runtime, rebuildRuntime, kernel: this.kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: loaded.assets }, { full: true });
    if (!result.success) { await disposeCadRuntimeState(runtime, this.kernel); throw Object.assign(new Error(`Part definition ${definitionId} failed to rebuild: ${result.errors.map((error) => error.message).join("; ")}`), { code: "ASSEMBLY_DEFINITION_REBUILD_FAILED" }); }
    const created = { definitionId, document: loaded.document, assets: loaded.assets, runtime, rebuildRuntime }; this.entries.set(definitionId, created); return created;
  }

  peek(definitionId: string): PartDefinitionRuntime | undefined { return this.entries.get(definitionId); }
  get size(): number { return this.entries.size; }
  getSourceDefinition(definitionId:string) { const definition=this.definitions.definitions.get(definitionId); if(!definition) throw Object.assign(new Error(`Part definition ${definitionId} is unavailable.`),{code:"ASSEMBLY_DEFINITION_MISSING"}); return definition; }

  async dispose(): Promise<void> {
    if (this.disposed) return; this.disposed = true;
    for (const entry of this.entries.values()) await disposeCadRuntimeState(entry.runtime, this.kernel);
    this.entries.clear();
  }
}

/** Exact geometry bridge used by the Assembly solver. It resolves durable Part-local refs first, then transforms analytically in the solver. */
export class ExactAssemblyGeometryProvider implements AssemblyGeometryProvider {
  private readonly assembly: AssemblyDocument;
  private readonly definitions: PartDefinitionRuntimeCache;
  private readonly kernel: CadKernel;
  constructor(assembly: AssemblyDocument, definitions: PartDefinitionRuntimeCache, kernel: CadKernel) { this.assembly = assembly; this.definitions = definitions; this.kernel = kernel; }

  async resolve(reference: AssemblyTopologyRef): Promise<LocalMateGeometry> {
    const component = this.assembly.components[reference.instanceId]; if (!component) throw Object.assign(new Error(`Component ${reference.instanceId} is unavailable.`), { code: "ASSEMBLY_COMPONENT_MISSING" });
    const definition = await this.definitions.get(component.definitionId); if (!definition.document.bodies[reference.bodyId]) throw Object.assign(new Error(`Body ${reference.bodyId} is unavailable in Part definition ${component.definitionId}.`), { code: "ASSEMBLY_BODY_MISSING" });
    const topology = await resolvePersistentTopologyRef(reference.topologyRef, definition.runtime, this.kernel);
    if (topology.kind !== "face") throw Object.assign(new Error("Assembly V1 Mates require analytic Faces."), { code: "MATE_REQUIRES_FACE" });
    const face = await this.kernel.getFaceInfo(topology);
    if (face.surfaceType === "plane" && face.centerMm && face.normal) return { kind: "plane", pointMm: { ...face.centerMm }, normal: { ...face.normal } };
    if (face.surfaceType === "cylinder" && face.cylindricalFrame) return { kind: "cylinder", axisOriginMm: { ...face.cylindricalFrame.axisOriginMm }, axisDirection: { ...face.cylindricalFrame.axisDirection }, radiusMm: face.cylindricalFrame.radiusMm };
    throw Object.assign(new Error(`Face ${topology.localId} has unsupported surface type ${face.surfaceType ?? "unknown"} for Assembly Mates.`), { code: face.surfaceType === "cylinder" ? "MATE_CYLINDER_FRAME_UNAVAILABLE" : "MATE_UNSUPPORTED_SURFACE" });
  }

  async resolveConnector(reference: AssemblyMateConnectorRef): Promise<LocalMateConnectorFrame> {
    const component=this.assembly.components[reference.instanceId]; if(!component) throw Object.assign(new Error(`Component ${reference.instanceId} is unavailable.`),{code:"ASSEMBLY_COMPONENT_MISSING"});
    const definition=this.definitions.getSourceDefinition(component.definitionId); const connector=definition.mateConnectors[reference.connectorId];
    if(!connector) throw Object.assign(new Error(`Mate Connector ${reference.connectorId} is unavailable in Part definition ${component.definitionId}.`),{code:"MATE_CONNECTOR_MISSING"});
    const geometry=await this.resolve({instanceId:reference.instanceId,bodyId:connector.bodyId,topologyRef:connector.topologyRef});
    return applyMateConnectorDefinition(mateConnectorFrameFromGeometry(geometry),connector);
  }
}
