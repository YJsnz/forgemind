import type { CadRuntimeState } from "../evaluation/CadRuntimeState.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelTopologyRef } from "../kernel/KernelTypes.ts";
import { capturePersistentTopologyRef } from "../topology/TopologyResolver.ts";
import type { AssemblyTopologyRef } from "./AssemblyTypes.ts";

/** Captures one runtime Part topology selection as a durable Assembly reference. */
export const captureAssemblyTopologyRef = async (
  instanceId: string,
  bodyId: string,
  sourceFeatureId: string,
  topology: KernelTopologyRef,
  partRuntime: CadRuntimeState,
  kernel: CadKernel,
): Promise<AssemblyTopologyRef> => ({
  instanceId,
  bodyId,
  topologyRef: await capturePersistentTopologyRef(sourceFeatureId, topology, partRuntime, kernel),
});
