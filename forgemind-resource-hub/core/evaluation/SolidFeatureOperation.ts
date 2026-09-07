import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelShapeRef } from "../kernel/KernelTypes.ts";

export type SolidFeatureOperation = "new" | "add" | "remove" | "intersect";

/**
 * Applies one or more exact tool solids to a feature target. Tool ownership is
 * consumed in every branch; the target remains owned by the rebuild runtime.
 */
export const applySolidFeatureOperation = async (
  kernel: CadKernel,
  tools: KernelShapeRef[],
  operation: SolidFeatureOperation,
  target?: KernelShapeRef,
): Promise<KernelShapeRef> => {
  if (!tools.length) throw new Error("Solid feature did not produce a tool body.");
  let combined: KernelShapeRef | undefined;
  try {
    if (operation === "new") {
      if (tools.length === 1) return tools.shift()!;
      combined = await kernel.booleanUnion(tools[0], tools.slice(1));
      return combined;
    }
    if (!target) throw new Error(`${operation} requires an evaluated target feature.`);
    if (operation === "add") return await kernel.booleanUnion(target, tools);
    if (operation === "remove") return await kernel.booleanCut(target, tools);
    if (tools.length === 1) return await kernel.booleanIntersect(target, tools);
    combined = await kernel.booleanUnion(tools[0], tools.slice(1));
    return await kernel.booleanIntersect(target, [combined]);
  } finally {
    for (const tool of tools) if (tool !== combined) await kernel.disposeShape(tool).catch(() => undefined);
    // When the union is only an intermediate intersection tool, it is not the
    // returned result and must be released here.
    if (combined && operation === "intersect") await kernel.disposeShape(combined).catch(() => undefined);
  }
};
